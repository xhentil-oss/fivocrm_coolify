import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';
import { adminAuth, adminDb, Timestamp } from './_firebaseAdmin.js';
import { refreshGoogleToken, exchangeGoogleCode } from './_gsc.js';
import { getTeamConfig } from './_tenantConfig.js';
import {
  gmbOAuthClient, buildGmbAuthUrl, listGmbLocations, syncGmbAccount, syncAllGmbAccounts,
  publishGmbReply, generateAiText, gmbReplyPrompt, gmbReportPrompt, GMB_REPORT_URL,
} from './_gmb.js';

/**
 * Google Reviews (GMB) module API — each tenant connects its own Google Business
 * Profile locations, reads/answers reviews and publishes posts. One consolidated
 * handler (Vercel Hobby caps functions at 12) dispatched from api/email.ts as
 * ?type=gmb, sub-dispatching on `?action=`:
 *
 *   GET  ?action=oauth-url      &teamId&businessId       → Google consent URL (Bearer)
 *   GET  ?action=oauth-callback &code&state              → OAuth redirect target (public; state-signed)
 *   GET  ?action=list           &teamId&businessId       → connected locations, tokens stripped (Bearer)
 *   GET  ?action=test           &teamId&businessId       → credential/connection check (Bearer)
 *   POST ?action=sync-now       {teamId,businessId,accountId?}          → manual review pull (Bearer)
 *   POST ?action=reply          {reviewDocId,comment}                   → publish public reply on Google (Bearer)
 *   POST ?action=ai-suggest     {reviewDocId,kind:'reply'|'report'}     → AI draft, cached on the doc (Bearer)
 *   POST ?action=report         {reviewDocId,reason,argument?}          → INTERNAL report mark + Google link (Bearer)
 *   POST ?action=create-post    {accountId,summary,ctaType?,ctaUrl?,mediaUrl?} → GMB local post (Bearer)
 *   POST ?action=disconnect     {accountId}                             → soft-disconnect (Bearer)
 *
 * Reviews/locations credentials: per-tenant OAuth client (teamSettings.gmbClientId
 * + teamSecrets.gmbClientSecret) with GOOGLE_CLIENT_ID/SECRET as fallback. The
 * per-location refresh token lives on gmbAccounts (deny-all collection).
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

// Same membership rule as api/_social-api.ts: teamId OR businessId match.
async function memberOf(uid: string, teamId?: string | null, businessId?: string | null): Promise<boolean> {
  if (!teamId && !businessId) return false;
  const snap = await adminDb.collection('teamMembers').where('userId', '==', uid).limit(50).get();
  return snap.docs.some((d) => {
    const m = d.data();
    return (!!teamId && m.teamId === teamId) || (!!businessId && m.businessId === businessId);
  });
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
    lastSyncedAt: a.lastSyncedAt?.toDate?.()?.toISOString?.() ?? null,
    lastSyncError: a.lastSyncError ?? null,
  };
}

/** Load a review doc and authorize the caller against ITS tenant scope. */
async function authorizedReview(uid: string, reviewDocId: string) {
  const ref = adminDb.collection('gmbReviews').doc(String(reviewDocId || ''));
  const doc = await ref.get();
  const r = doc.data();
  if (!doc.exists || !r || !(await memberOf(uid, r.teamId, r.businessId))) return null;
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
      const customerId = String(req.query.customerId || '');
      if (!teamId && !businessId) return res.status(400).json({ error: 'teamId ose businessId mungon' });
      if (!(await memberOf(uid, teamId, businessId))) return res.status(403).json({ error: 'Nuk jeni anëtar i këtij ekipi' });
      const { clientId } = await gmbOAuthClient(teamId);
      if (!clientId) return res.status(503).json({ error: 'Google OAuth nuk është konfiguruar — vendos Client ID te Cilësimet e modulit' });
      const state = signState({ uid, teamId, businessId, customerId });
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
      const scopeKey = businessId || teamId;
      if (!scopeKey) return back(`error=${encodeURIComponent('Tenant-i nuk u identifikua')}`);

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
        await adminDb.collection('gmbAccounts').doc(`${scopeKey}_gmb_${safe}`).set({
          teamId, businessId, customerId: state.customerId || null,
          name: loc.title, address: loc.address ?? null,
          accountName: loc.accountName, locationName: loc.locationName,
          refreshToken,
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
      if (!(await memberOf(uid, teamId, businessId))) return res.status(403).json({ error: 'Nuk jeni anëtar i këtij ekipi' });
      const docs = await accountsForScope(teamId, businessId);
      return res.status(200).json({ accounts: docs.map((d) => publicAccount(d.id, d.data())).filter((a) => a.connected) });
    }

    // ── GET test (credentials + one live call) ─────────────────────────────────
    if (action === 'test') {
      const uid = await requireAuth(req);
      if (!uid) return res.status(401).json({ error: 'Missing or invalid token' });
      const teamId = String(req.query.teamId || '');
      const businessId = String(req.query.businessId || '');
      if (!(await memberOf(uid, teamId, businessId))) return res.status(403).json({ error: 'Nuk jeni anëtar i këtij ekipi' });
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
        await refreshGoogleToken(clientId, clientSecret, connectedDocs[0].data().refreshToken);
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
      if (!(await memberOf(uid, teamId, businessId))) return res.status(403).json({ error: 'Nuk jeni anëtar i këtij ekipi' });
      if (accountId) {
        const doc = await adminDb.collection('gmbAccounts').doc(String(accountId)).get();
        const a = doc.data();
        if (!doc.exists || !(await memberOf(uid, a?.teamId, a?.businessId))) return res.status(404).json({ error: 'Profili nuk u gjet' });
        const result = await syncGmbAccount(doc as any);
        return res.status(200).json({ success: true, results: [result] });
      }
      const results = await syncAllGmbAccounts({ teamId, businessId });
      return res.status(200).json({ success: true, results });
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
      const found = await authorizedReview(uid, reviewDocId);
      if (!found) return res.status(404).json({ error: 'Review nuk u gjet' });
      const acctDoc = await adminDb.collection('gmbAccounts').doc(found.review.accountId).get();
      const acct = acctDoc.data();
      if (!acctDoc.exists || !acct) return res.status(404).json({ error: 'Profili i lidhur nuk u gjet' });
      const { clientId, clientSecret } = await gmbOAuthClient(acct.teamId);
      const accessToken = await refreshGoogleToken(clientId, clientSecret, acct.refreshToken);
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
      const found = await authorizedReview(uid, reviewDocId);
      if (!found) return res.status(404).json({ error: 'Review nuk u gjet' });
      const r = found.review;
      const isReport = kind === 'report';
      // Serve the cached draft when we already generated one for this review.
      const cached = isReport ? r.aiReportAnalysis : r.aiSuggestion;
      if (typeof cached === 'string' && cached) return res.status(200).json({ text: cached, cached: true });
      const cfg: Record<string, any> = r.teamId ? await getTeamConfig(r.teamId) : {};
      const prompt = isReport
        ? gmbReportPrompt({ author: r.author, starRating: r.starRating, comment: r.comment }, r.locationTitle || 'biznesi')
        : gmbReplyPrompt({ author: r.author, starRating: r.starRating, comment: r.comment }, r.locationTitle || 'biznesi', typeof (cfg as any).gmbAiContext === 'string' ? (cfg as any).gmbAiContext : undefined);
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
      const found = await authorizedReview(uid, reviewDocId);
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
      if (!acctDoc.exists || !acct || !(await memberOf(uid, acct.teamId, acct.businessId))) {
        return res.status(404).json({ error: 'Profili nuk u gjet' });
      }
      const { clientId, clientSecret } = await gmbOAuthClient(acct.teamId);
      const accessToken = await refreshGoogleToken(clientId, clientSecret, acct.refreshToken);

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
      if (!doc.exists || !(await memberOf(uid, a?.teamId, a?.businessId))) {
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
