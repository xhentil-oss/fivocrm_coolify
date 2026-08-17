import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';
import { adminAuth, adminDb, Timestamp } from './_firebaseAdmin.js';
import { exchangeGoogleCode } from './_gsc.js';
import { getTeamConfig } from './_tenantConfig.js';
import {
  gmbOAuthClient, accessTokenForAccount, buildGmbAuthUrl, listGmbLocations,
  syncGmbAccount, syncAllGmbAccounts,
  publishGmbReply, generateAiText, gmbReplyPrompt, gmbReportPrompt, GMB_REPORT_URL,
} from './_gmb.js';

/**
 * Google Reviews (GMB) module API — each tenant connects its own Google Business
 * Profile locations, reads/answers reviews and publishes posts. One consolidated
 * handler (Vercel Hobby caps functions at 12) dispatched from api/email.ts as
 * ?type=gmb, sub-dispatching on `?action=`:
 *
 *   GET  ?action=oauth-url      &teamId&businessId       → Google consent URL (Bearer, Admin/Manager)
 *   GET  ?action=oauth-callback &code&state              → OAuth redirect target (public; state-signed)
 *   GET  ?action=list           &teamId&businessId       → connected locations, tokens stripped (Bearer, any member)
 *   GET  ?action=test           &teamId&businessId       → credential/connection check (Bearer, any member)
 *   POST ?action=sync-now       {teamId,businessId,accountId?}          → manual review pull (Bearer, Admin/Manager)
 *   POST ?action=reply          {reviewDocId,comment}                   → publish public reply on Google (Bearer, Admin/Manager)
 *   POST ?action=ai-suggest     {reviewDocId,kind:'reply'|'report'}     → AI draft, cached on the doc (Bearer, Admin/Manager)
 *   POST ?action=report         {reviewDocId,reason,argument?}          → INTERNAL report mark + Google link (Bearer, Admin/Manager)
 *   POST ?action=create-post    {accountId,summary,ctaType?,ctaUrl?,mediaUrl?} → GMB local post (Bearer, Admin/Manager)
 *   POST ?action=disconnect     {accountId}                             → soft-disconnect (Bearer, Admin/Manager)
 *
 * AUTHZ MODEL (deliberately stricter than api/_social-api.ts, whose OR-gate lets
 * a member of tenant A pass a foreign teamId alongside their own businessId):
 * EVERY provided scope key must be covered by the caller's own memberships —
 * teamId AND businessId when both are sent — and mutating actions additionally
 * require an Admin/Manager membership, mirroring the UI's canManage gate. The
 * connect flow requires businessId outright: businessId is THE tenant key, and a
 * connect without it mints reviews no rule or query can ever surface (the
 * documented "businessId orphan" failure mode).
 */

// HMAC key for the signed OAuth state (must be tenant-independent: the state is
// verified BEFORE we know the tenant). Reuses the platform secrets already set.
const STATE_KEY = process.env.GMB_STATE_SECRET || process.env.META_APP_SECRET || process.env.CRON_SECRET || '';

function appUrl(req: VercelRequest): string {
  const env = process.env.VITE_APP_URL || process.env.APP_URL;
  if (env) return env.replace(/\/$/, '');
  const host = req.headers.host || 'fivocrm.vercel.app';
  return `https://${host}`;
}

function redirectUri(req: VercelRequest): string {
  return process.env.GMB_OAUTH_REDIRECT || `${appUrl(req)}/api/gmb?action=oauth-callback`;
}

function signState(payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify({ ...payload, ts: Date.now() })).toString('base64url');
  const sig = crypto.createHmac('sha256', STATE_KEY).update(body).digest('base64url');
  return `${body}.${sig}`;
}
function verifyState(state: string): any | null {
  const [body, sig] = String(state || '').split('.');
  if (!body || !sig) return null;
  const expect = crypto.createHmac('sha256', STATE_KEY).update(body).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (!payload.ts || Date.now() - payload.ts > 15 * 60 * 1000) return null; // 15-min TTL
    return payload;
  } catch {
    return null;
  }
}

async function requireAuth(req: VercelRequest): Promise<string | null> {
  const h = req.headers.authorization;
  const token = h?.startsWith('Bearer ') ? h.slice(7).trim() : null;
  if (!token) return null;
  try {
    return (await adminAuth.verifyIdToken(token)).uid;
  } catch {
    return null;
  }
}

const MANAGER_ROLES = new Set(['Admin', 'Manager', 'Owner', 'SuperAdmin']);

/** The caller's active memberships (one query, reused across checks). */
async function memberships(uid: string): Promise<Array<Record<string, any>>> {
  const snap = await adminDb.collection('teamMembers').where('userId', '==', uid).limit(50).get();
  return snap.docs.map((d) => d.data()).filter((m) => m.status !== 'Inactive');
}

/**
 * Every PROVIDED scope key must be covered by the caller's own memberships.
 * (AND across keys — an attacker cannot smuggle a foreign teamId next to their
 * own businessId; each leg is checked against real membership.)
 */
function scopeMember(ms: Array<Record<string, any>>, teamId?: string | null, businessId?: string | null): boolean {
  if (!teamId && !businessId) return false;
  const coversTeam = !teamId || ms.some((m) => m.teamId === teamId);
  const coversBiz = !businessId || ms.some((m) => m.businessId === businessId);
  return coversTeam && coversBiz;
}

/** Same coverage rule, but only Admin/Manager memberships count (UI's canManage). */
function scopeManager(ms: Array<Record<string, any>>, teamId?: string | null, businessId?: string | null): boolean {
  return scopeMember(ms.filter((m) => MANAGER_ROLES.has(String(m.role || ''))), teamId, businessId);
}

async function accountsForScope(teamId?: string | null, businessId?: string | null) {
  const byId = new Map<string, any>();
  const col = adminDb.collection('gmbAccounts');
  if (businessId) (await col.where('businessId', '==', businessId).get()).forEach((d) => byId.set(d.id, d));
  if (teamId) (await col.where('teamId', '==', teamId).get()).forEach((d) => byId.set(d.id, d));
  return [...byId.values()];
}

/** Strip the refresh token before returning a location to the browser. */
function publicAccount(id: string, a: any) {
  return {
    id,
    name: a.name,
    address: a.address ?? null,
    customerId: a.customerId ?? null,
    connected: a.connected !== false,
    rating: typeof a.rating === 'number' ? a.rating : null,
    reviewCount: a.reviewCount ?? 0,
    starCounts: a.starCounts ?? null,
    /** false → the distribution covers only the newest mirrored reviews. */
    starCountsComplete: a.starCountsComplete ?? null,
    lastSyncedAt: a.lastSyncedAt?.toDate?.()?.toISOString?.() ?? null,
    lastSyncError: a.lastSyncError ?? null,
  };
}

/** Load a review doc and authorize the caller (Admin/Manager) against ITS tenant scope. */
async function managedReview(ms: Array<Record<string, any>>, reviewDocId: string) {
  const ref = adminDb.collection('gmbReviews').doc(String(reviewDocId || ''));
  const doc = await ref.get();
  const r = doc.data();
  if (!doc.exists || !r || !scopeManager(ms, r.teamId, r.businessId)) return null;
  return { ref, review: r };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const action = String(req.query.action || '');

  if (!STATE_KEY && (action === 'oauth-url' || action === 'oauth-callback')) {
    if (action === 'oauth-callback') {
      return res.redirect(302, `${appUrl(req)}/app/gmb?error=${encodeURIComponent('Serveri s\'ka çelës për OAuth state (GMB_STATE_SECRET/META_APP_SECRET/CRON_SECRET)')}`);
    }
    return res.status(503).json({ error: 'Serveri s\'ka çelës për OAuth state (vendos GMB_STATE_SECRET ose META_APP_SECRET)' });
  }

  try {
    // ── GET oauth-url ──────────────────────────────────────────────────────────
    if (action === 'oauth-url') {
      const uid = await requireAuth(req);
      if (!uid) return res.status(401).json({ error: 'Missing or invalid token' });
      const teamId = String(req.query.teamId || '');
      const businessId = String(req.query.businessId || '');
      // businessId is THE tenant key — a connect without it mints reviews no
      // rule/query can surface. Fail loudly instead of storing businessId:null.
      if (!businessId) return res.status(400).json({ error: 'businessId mungon — rifreskoni faqen dhe provoni sërish' });
      const ms = await memberships(uid);
      if (!scopeManager(ms, teamId || null, businessId)) return res.status(403).json({ error: 'Vetëm Admin/Manager i këtij biznesi mund të lidhë profile' });
      const { clientId } = await gmbOAuthClient(teamId);
      if (!clientId) return res.status(503).json({ error: 'Google OAuth nuk është konfiguruar — vendos Client ID te Cilësimet e modulit' });
      const state = signState({ uid, teamId, businessId, customerId: String(req.query.customerId || '') });
      return res.status(200).json({ url: buildGmbAuthUrl(clientId, redirectUri(req), state) });
    }

    // ── GET oauth-callback (browser redirect from Google) ─────────────────────
    if (action === 'oauth-callback') {
      const back = (params: string) => res.redirect(302, `${appUrl(req)}/app/gmb?${params}`);
      if (req.query.error) return back(`error=${encodeURIComponent(String(req.query.error_description || req.query.error))}`);
      const state = verifyState(String(req.query.state || ''));
      if (!state) return back(`error=${encodeURIComponent('Sesioni skadoi ose është i pavlefshëm — provoni sërish')}`);
      const code = String(req.query.code || '');
      if (!code) return back(`error=${encodeURIComponent('Kodi i autorizimit mungon')}`);

      const teamId = state.teamId || null;
      const businessId = state.businessId || null;
      if (!businessId) return back(`error=${encodeURIComponent('Tenant-i (businessId) nuk u identifikua — provoni sërish')}`);

      const { clientId, clientSecret } = await gmbOAuthClient(teamId);
      if (!clientId || !clientSecret) return back(`error=${encodeURIComponent('Google OAuth nuk është konfiguruar (Client ID/Secret)')}`);
      const { accessToken, refreshToken } = await exchangeGoogleCode(clientId, clientSecret, redirectUri(req), code);
      if (!refreshToken) return back(`error=${encodeURIComponent('Google nuk ktheu refresh token — provoni sërish dhe lejoni aksesin')}`);

      const locations = await listGmbLocations(accessToken);
      if (!locations.length) return back(`error=${encodeURIComponent('Asnjë profil biznesi në këtë llogari Google (Business Profile)')}`);

      const now = Timestamp.now();
      let connected = 0;
      for (const loc of locations) {
        const safe = loc.locationName.replace(/[^a-zA-Z0-9]/g, '_');
        await adminDb.collection('gmbAccounts').doc(`${businessId}_gmb_${safe}`).set({
          teamId, businessId, customerId: state.customerId || null,
          name: loc.title, address: loc.address ?? null,
          accountName: loc.accountName, locationName: loc.locationName,
          refreshToken,
          // Refresh tokens are client-bound: pin the minting client so a later
          // credential change cannot silently break this account's refresh.
          oauthClientId: clientId,
          connected: true, lastSyncedAt: null, lastSyncError: null,
          updatedAt: now, createdByUserId: state.uid, createdAt: now,
        }, { merge: true });
        connected++;
      }
      return back(`connected=${connected}`);
    }

    // ── GET list ───────────────────────────────────────────────────────────────
    if (action === 'list') {
      const uid = await requireAuth(req);
      if (!uid) return res.status(401).json({ error: 'Missing or invalid token' });
      const teamId = String(req.query.teamId || '');
      const businessId = String(req.query.businessId || '');
      if (!teamId && !businessId) return res.status(400).json({ error: 'teamId ose businessId mungon' });
      const ms = await memberships(uid);
      if (!scopeMember(ms, teamId || null, businessId || null)) return res.status(403).json({ error: 'Nuk jeni anëtar i këtij ekipi' });
      const docs = await accountsForScope(teamId, businessId);
      return res.status(200).json({ accounts: docs.map((d) => publicAccount(d.id, d.data())).filter((a) => a.connected) });
    }

    // ── GET test (credentials + one live call) ─────────────────────────────────
    if (action === 'test') {
      const uid = await requireAuth(req);
      if (!uid) return res.status(401).json({ error: 'Missing or invalid token' });
      const teamId = String(req.query.teamId || '');
      const businessId = String(req.query.businessId || '');
      if (!teamId && !businessId) return res.status(400).json({ error: 'teamId ose businessId mungon' });
      const ms = await memberships(uid);
      if (!scopeMember(ms, teamId || null, businessId || null)) return res.status(403).json({ error: 'Nuk jeni anëtar i këtij ekipi' });
      const { clientId, clientSecret, source } = await gmbOAuthClient(teamId);
      if (!clientId || !clientSecret) {
        return res.status(200).json({ ok: false, error: 'Client ID/Secret mungojnë — vendosini te Cilësimet' });
      }
      const docs = await accountsForScope(teamId, businessId);
      const connectedDocs = docs.filter((d) => d.data().connected !== false);
      if (!connectedDocs.length) {
        return res.status(200).json({ ok: true, source, locations: 0, note: 'Kredencialet janë vendosur — lidh profilin e parë me Google OAuth' });
      }
      const started = Date.now();
      try {
        await accessTokenForAccount(connectedDocs[0].data());
        return res.status(200).json({ ok: true, source, locations: connectedDocs.length, ms: Date.now() - started });
      } catch (err) {
        return res.status(200).json({ ok: false, source, locations: connectedDocs.length, error: (err as Error)?.message || 'Token refresh dështoi' });
      }
    }

    // ── POST sync-now ──────────────────────────────────────────────────────────
    if (action === 'sync-now') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      const uid = await requireAuth(req);
      if (!uid) return res.status(401).json({ error: 'Missing or invalid token' });
      const { teamId, businessId, accountId } = req.body || {};
      if (!teamId && !businessId) return res.status(400).json({ error: 'teamId ose businessId mungon' });
      const ms = await memberships(uid);
      if (!scopeManager(ms, teamId || null, businessId || null)) return res.status(403).json({ error: 'Vetëm Admin/Manager mund të sinkronizojë' });
      if (accountId) {
        const doc = await adminDb.collection('gmbAccounts').doc(String(accountId)).get();
        const a = doc.data();
        if (!doc.exists || !scopeManager(ms, a?.teamId, a?.businessId)) return res.status(404).json({ error: 'Profili nuk u gjet' });
        const result = await syncGmbAccount(doc as any);
        return res.status(200).json({ success: true, results: [result] });
      }
      const { results, skipped } = await syncAllGmbAccounts({ teamId, businessId });
      return res.status(200).json({ success: true, results, skipped });
    }

    // ── POST reply (publish public reply on Google) ────────────────────────────
    if (action === 'reply') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      const uid = await requireAuth(req);
      if (!uid) return res.status(401).json({ error: 'Missing or invalid token' });
      const { reviewDocId, comment } = req.body || {};
      const text = String(comment || '').trim();
      if (!reviewDocId || !text) return res.status(400).json({ error: 'reviewDocId dhe comment janë të detyrueshëm' });
      if (text.length > 4000) return res.status(400).json({ error: 'Përgjigjja është shumë e gjatë (max 4000)' });
      const ms = await memberships(uid);
      const found = await managedReview(ms, reviewDocId);
      if (!found) return res.status(404).json({ error: 'Review nuk u gjet' });
      const acctDoc = await adminDb.collection('gmbAccounts').doc(found.review.accountId).get();
      const acct = acctDoc.data();
      if (!acctDoc.exists || !acct) return res.status(404).json({ error: 'Profili i lidhur nuk u gjet' });
      const accessToken = await accessTokenForAccount(acct);
      await publishGmbReply(accessToken, acct, found.review.reviewId, text);
      await found.ref.set({
        replyComment: text,
        replyTime: new Date().toISOString(),
        repliedVia: 'manual',
        repliedByUserId: uid,
        updatedAt: Timestamp.now(),
      }, { merge: true });
      return res.status(200).json({ success: true });
    }

    // ── POST ai-suggest (draft a reply or a report argument) ───────────────────
    if (action === 'ai-suggest') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      const uid = await requireAuth(req);
      if (!uid) return res.status(401).json({ error: 'Missing or invalid token' });
      const { reviewDocId, kind } = req.body || {};
      const ms = await memberships(uid);
      const found = await managedReview(ms, reviewDocId);
      if (!found) return res.status(404).json({ error: 'Review nuk u gjet' });
      const r = found.review;
      const isReport = kind === 'report';
      // Serve the cached draft when we already generated one for this review.
      const cached = isReport ? r.aiReportAnalysis : r.aiSuggestion;
      if (typeof cached === 'string' && cached) return res.status(200).json({ text: cached, cached: true });
      const cfg: Record<string, any> = r.teamId ? await getTeamConfig(r.teamId) : {};
      const prompt = isReport
        ? gmbReportPrompt({ author: r.author, starRating: r.starRating, comment: r.comment }, r.locationTitle || 'biznesi')
        : gmbReplyPrompt({ author: r.author, starRating: r.starRating, comment: r.comment }, r.locationTitle || 'biznesi', typeof cfg.gmbAiContext === 'string' ? cfg.gmbAiContext : undefined);
      const text = await generateAiText(r.teamId, prompt);
      await found.ref.set({ [isReport ? 'aiReportAnalysis' : 'aiSuggestion']: text, updatedAt: Timestamp.now() }, { merge: true });
      return res.status(200).json({ text });
    }

    // ── POST report (INTERNAL mark — Google has no report API) ────────────────
    if (action === 'report') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      const uid = await requireAuth(req);
      if (!uid) return res.status(401).json({ error: 'Missing or invalid token' });
      const { reviewDocId, reason, argument } = req.body || {};
      if (!reviewDocId || !reason) return res.status(400).json({ error: 'reviewDocId dhe reason janë të detyrueshëm' });
      const ms = await memberships(uid);
      const found = await managedReview(ms, reviewDocId);
      if (!found) return res.status(404).json({ error: 'Review nuk u gjet' });
      await found.ref.set({
        reported: {
          reason: String(reason).slice(0, 120),
          argument: String(argument || '').slice(0, 2000),
          reportedAt: Timestamp.now(),
          reportedByUserId: uid,
        },
        updatedAt: Timestamp.now(),
      }, { merge: true });
      // No API exists for flagging — hand back Google's own reviews manager so the
      // user can file it there with the prepared argument.
      return res.status(200).json({ success: true, googleReportUrl: GMB_REPORT_URL });
    }

    // ── POST create-post (GMB local post) ─────────────────────────────────────
    if (action === 'create-post') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      const uid = await requireAuth(req);
      if (!uid) return res.status(401).json({ error: 'Missing or invalid token' });
      const { accountId, summary, ctaType, ctaUrl, mediaUrl } = req.body || {};
      const text = String(summary || '').trim();
      if (!accountId || !text) return res.status(400).json({ error: 'accountId dhe summary janë të detyrueshëm' });
      if (text.length > 1500) return res.status(400).json({ error: 'Postimi është shumë i gjatë (max 1500)' });
      const acctDoc = await adminDb.collection('gmbAccounts').doc(String(accountId)).get();
      const acct = acctDoc.data();
      const ms = await memberships(uid);
      if (!acctDoc.exists || !acct || !scopeManager(ms, acct.teamId, acct.businessId)) {
        return res.status(404).json({ error: 'Profili nuk u gjet' });
      }
      const accessToken = await accessTokenForAccount(acct);

      const CTA_TYPES = ['LEARN_MORE', 'BOOK', 'ORDER', 'SHOP', 'SIGN_UP', 'CALL'];
      const body: Record<string, any> = { languageCode: 'sq', topicType: 'STANDARD', summary: text };
      if (ctaType && CTA_TYPES.includes(String(ctaType))) {
        body.callToAction = { actionType: String(ctaType), ...(ctaType !== 'CALL' && ctaUrl ? { url: String(ctaUrl) } : {}) };
      }
      if (mediaUrl && /^https:\/\//.test(String(mediaUrl))) {
        body.media = [{ mediaFormat: 'PHOTO', sourceUrl: String(mediaUrl) }];
      }
      const resp = await fetch(
        `https://mybusiness.googleapis.com/v4/${acct.accountName}/${acct.locationName}/localPosts`,
        { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      );
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) return res.status(502).json({ error: json?.error?.message || `Google localPosts ${resp.status}` });

      const now = Timestamp.now();
      const postRef = await adminDb.collection('gmbPosts').add({
        teamId: acct.teamId ?? null,
        businessId: acct.businessId ?? null,
        accountId: acctDoc.id,
        locationTitle: acct.name || '',
        summary: text,
        ctaType: body.callToAction?.actionType ?? null,
        ctaUrl: body.callToAction?.url ?? null,
        mediaUrl: body.media?.[0]?.sourceUrl ?? null,
        googleName: json.name ?? null,
        state: json.state ?? 'LIVE',
        searchUrl: json.searchUrl ?? null,
        createdByUserId: uid,
        createdAt: now,
        updatedAt: now,
      });
      return res.status(200).json({ success: true, postId: postRef.id, state: json.state ?? 'LIVE', searchUrl: json.searchUrl ?? null });
    }

    // ── POST disconnect ────────────────────────────────────────────────────────
    if (action === 'disconnect') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      const uid = await requireAuth(req);
      if (!uid) return res.status(401).json({ error: 'Missing or invalid token' });
      const { accountId } = req.body || {};
      if (!accountId) return res.status(400).json({ error: 'accountId është i detyrueshëm' });
      const ref = adminDb.collection('gmbAccounts').doc(String(accountId));
      const doc = await ref.get();
      const a = doc.data();
      const ms = await memberships(uid);
      if (!doc.exists || !scopeManager(ms, a?.teamId, a?.businessId)) {
        return res.status(404).json({ error: 'Profili nuk u gjet' });
      }
      // Soft-disconnect: drop the credential but keep the mirrored reviews readable.
      await ref.update({ connected: false, refreshToken: '', updatedAt: Timestamp.now() });
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: `Veprim i panjohur: "${action}"` });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Gabim i panjohur';
    console.error(`[gmb] action="${action}" exception:`, msg);
    if (action === 'oauth-callback') {
      return res.redirect(302, `${appUrl(req)}/app/gmb?error=${encodeURIComponent(msg)}`);
    }
    return res.status(500).json({ error: msg });
  }
}
