import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';
import { adminAuth, adminDb, Timestamp } from './_firebaseAdmin.js';
import {
  buildLoginUrl, exchangeCodeForToken, exchangeForLongLived, listManagedAccounts,
} from './_meta-insights.js';
import { syncAccount, syncAllAccounts, currentPeriod } from './_social.js';

/**
 * Social Media module API — connect Facebook/Instagram accounts and pull their
 * analytics. One consolidated function (Vercel Hobby caps functions at 12) that
 * dispatches on `?action=`:
 *
 *   GET  ?action=oauth-url      &teamId&customerId   → Facebook Login URL (Bearer auth)
 *   GET  ?action=oauth-callback &code&state          → OAuth redirect target (public; state-signed)
 *   GET  ?action=list           &teamId              → connected accounts, tokens stripped (Bearer)
 *   POST ?action=disconnect     {accountId,teamId}   → soft-disconnect an account (Bearer)
 *   POST ?action=sync-now       {teamId,accountId?,period?} → manual pull (Bearer)
 *
 * Meta credentials come from env (META_APP_ID / META_APP_SECRET); per-account
 * long-lived Page tokens are stored in the socialAccounts collection.
 */

const APP_ID = process.env.META_APP_ID || process.env.FACEBOOK_APP_ID || '';
const APP_SECRET = process.env.META_APP_SECRET || process.env.FACEBOOK_APP_SECRET || '';

function appUrl(req: VercelRequest): string {
  const env = process.env.VITE_APP_URL || process.env.APP_URL;
  if (env) return env.replace(/\/$/, '');
  const host = req.headers.host || 'fivocrm.vercel.app';
  return `https://${host}`;
}

function redirectUri(req: VercelRequest): string {
  return process.env.SOCIAL_OAUTH_REDIRECT || `${appUrl(req)}/api/social?action=oauth-callback`;
}

// ── Signed OAuth state (survives the round-trip through Facebook) ─────────────
function signState(payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify({ ...payload, ts: Date.now() })).toString('base64url');
  const sig = crypto.createHmac('sha256', APP_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}
function verifyState(state: string): any | null {
  const [body, sig] = String(state || '').split('.');
  if (!body || !sig) return null;
  const expect = crypto.createHmac('sha256', APP_SECRET).update(body).digest('base64url');
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
    const decoded = await adminAuth.verifyIdToken(token);
    return decoded.uid;
  } catch {
    return null;
  }
}

async function isTeamMember(uid: string, teamId: string): Promise<boolean> {
  const snap = await adminDb.collection('teamMembers')
    .where('teamId', '==', teamId).where('userId', '==', uid).limit(1).get();
  return !snap.empty;
}

// Strip the access token before returning an account to the browser.
function publicAccount(id: string, a: any) {
  return {
    id,
    platform: a.platform,
    name: a.name,
    username: a.username ?? null,
    pictureUrl: a.pictureUrl ?? null,
    customerId: a.customerId,
    connected: a.connected !== false,
    lastSyncedAt: a.lastSyncedAt?.toDate?.()?.toISOString?.() ?? null,
    lastSyncError: a.lastSyncError ?? null,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const action = String(req.query.action || '');

  if (!APP_ID || !APP_SECRET) {
    // oauth-callback must still be able to report the misconfig to the user.
    if (action === 'oauth-callback') {
      return res.redirect(302, `${appUrl(req)}/app/social?error=${encodeURIComponent('Meta App nuk është konfiguruar (META_APP_ID/SECRET)')}`);
    }
    return res.status(503).json({ error: 'Meta App nuk është konfiguruar (vendos META_APP_ID dhe META_APP_SECRET)' });
  }

  try {
    // ── GET oauth-url ────────────────────────────────────────────────────────
    if (action === 'oauth-url') {
      const uid = await requireAuth(req);
      if (!uid) return res.status(401).json({ error: 'Missing or invalid token' });
      const teamId = String(req.query.teamId || '');
      const customerId = String(req.query.customerId || '');
      if (!teamId || !customerId) return res.status(400).json({ error: 'teamId dhe customerId janë të detyrueshëm' });
      if (!(await isTeamMember(uid, teamId))) return res.status(403).json({ error: 'Nuk jeni anëtar i këtij ekipi' });
      const state = signState({ uid, teamId, customerId });
      return res.status(200).json({ url: buildLoginUrl(APP_ID, redirectUri(req), state) });
    }

    // ── GET oauth-callback (browser redirect from Facebook) ────────────────────
    if (action === 'oauth-callback') {
      const back = (params: string) => res.redirect(302, `${appUrl(req)}/app/social?${params}`);
      if (req.query.error) {
        return back(`error=${encodeURIComponent(String(req.query.error_description || req.query.error))}`);
      }
      const state = verifyState(String(req.query.state || ''));
      if (!state) return back(`error=${encodeURIComponent('Sesioni skadoi ose është i pavlefshëm — provoni sërish')}`);
      const code = String(req.query.code || '');
      if (!code) return back(`error=${encodeURIComponent('Kodi i autorizimit mungon')}`);

      // Resolve the customer's tenant so snapshots land in the right business scope.
      const custSnap = await adminDb.collection('customers').doc(state.customerId).get();
      if (!custSnap.exists) return back(`error=${encodeURIComponent('Klienti nuk u gjet')}`);
      const cust = custSnap.data()!;
      const teamId = cust.teamId || state.teamId;
      const businessId = cust.businessId ?? null;

      const shortToken = await exchangeCodeForToken(APP_ID, APP_SECRET, redirectUri(req), code);
      const { token: longToken, expiresIn } = await exchangeForLongLived(APP_ID, APP_SECRET, shortToken);
      const pages = await listManagedAccounts(longToken);

      const now = Timestamp.now();
      // Page tokens obtained via a long-lived user token don't expire; only tag
      // an expiry when Meta returned one.
      const tokenExpiresAt = expiresIn ? Timestamp.fromDate(new Date(Date.now() + expiresIn * 1000)) : null;
      let connected = 0;

      for (const p of pages) {
        // Facebook Page
        const fbId = `${teamId}_facebook_${p.pageId}`;
        await adminDb.collection('socialAccounts').doc(fbId).set({
          teamId, businessId, customerId: state.customerId,
          platform: 'facebook', name: p.name, externalId: p.pageId,
          username: null, pictureUrl: p.picture ?? null,
          accessToken: p.pageAccessToken, tokenExpiresAt,
          connected: true, lastSyncedAt: null, lastSyncError: null,
          updatedAt: now, createdByUserId: state.uid, createdAt: now,
        }, { merge: true });
        connected++;

        // Linked Instagram business account (insights are mediated by the Page token)
        if (p.instagram?.id) {
          const igId = `${teamId}_instagram_${p.instagram.id}`;
          await adminDb.collection('socialAccounts').doc(igId).set({
            teamId, businessId, customerId: state.customerId,
            platform: 'instagram', name: p.instagram.username ? `@${p.instagram.username}` : p.name,
            externalId: p.instagram.id, pageId: p.pageId,
            username: p.instagram.username ?? null, pictureUrl: p.instagram.picture ?? null,
            accessToken: p.pageAccessToken, tokenExpiresAt,
            connected: true, lastSyncedAt: null, lastSyncError: null,
            updatedAt: now, createdByUserId: state.uid, createdAt: now,
          }, { merge: true });
          connected++;
        }
      }

      return back(`connected=${connected}`);
    }

    // ── GET list ───────────────────────────────────────────────────────────────
    if (action === 'list') {
      const uid = await requireAuth(req);
      if (!uid) return res.status(401).json({ error: 'Missing or invalid token' });
      const teamId = String(req.query.teamId || '');
      if (!teamId) return res.status(400).json({ error: 'teamId mungon' });
      if (!(await isTeamMember(uid, teamId))) return res.status(403).json({ error: 'Nuk jeni anëtar i këtij ekipi' });
      const snap = await adminDb.collection('socialAccounts').where('teamId', '==', teamId).get();
      const accounts = snap.docs
        .map((d) => publicAccount(d.id, d.data()))
        .filter((a) => a.connected);
      return res.status(200).json({ accounts });
    }

    // ── POST disconnect ──────────────────────────────────────────────────────
    if (action === 'disconnect') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      const uid = await requireAuth(req);
      if (!uid) return res.status(401).json({ error: 'Missing or invalid token' });
      const { accountId, teamId } = req.body || {};
      if (!accountId || !teamId) return res.status(400).json({ error: 'accountId dhe teamId janë të detyrueshëm' });
      if (!(await isTeamMember(uid, teamId))) return res.status(403).json({ error: 'Nuk jeni anëtar i këtij ekipi' });
      const ref = adminDb.collection('socialAccounts').doc(accountId);
      const doc = await ref.get();
      if (!doc.exists || doc.data()?.teamId !== teamId) return res.status(404).json({ error: 'Llogaria nuk u gjet' });
      // Soft-disconnect: revoke access but keep historical snapshots readable.
      await ref.update({ connected: false, accessToken: '', updatedAt: Timestamp.now() });
      return res.status(200).json({ success: true });
    }

    // ── POST sync-now ──────────────────────────────────────────────────────────
    if (action === 'sync-now') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      const uid = await requireAuth(req);
      if (!uid) return res.status(401).json({ error: 'Missing or invalid token' });
      const { teamId, accountId, period } = req.body || {};
      if (!teamId) return res.status(400).json({ error: 'teamId mungon' });
      if (!(await isTeamMember(uid, teamId))) return res.status(403).json({ error: 'Nuk jeni anëtar i këtij ekipi' });
      const p = typeof period === 'string' && /^\d{4}-\d{2}$/.test(period) ? period : currentPeriod();

      if (accountId) {
        const doc = await adminDb.collection('socialAccounts').doc(accountId).get();
        if (!doc.exists || doc.data()?.teamId !== teamId) return res.status(404).json({ error: 'Llogaria nuk u gjet' });
        const result = await syncAccount(doc as any, p);
        return res.status(200).json({ success: true, results: [result] });
      }
      const results = await syncAllAccounts(p, teamId);
      return res.status(200).json({ success: true, results });
    }

    return res.status(400).json({ error: `Veprim i panjohur: "${action}"` });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Gabim i panjohur';
    console.error(`[social] action="${action}" exception:`, msg);
    if (action === 'oauth-callback') {
      return res.redirect(302, `${appUrl(req)}/app/social?error=${encodeURIComponent(msg)}`);
    }
    return res.status(500).json({ error: msg });
  }
}
