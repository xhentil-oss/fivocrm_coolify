/**
 * Google Business Profile (GMB) helper — OAuth scope, review sync, AI drafting.
 *
 * Mirrors the shape of _social.ts / _gsc.ts: the per-account credential is a
 * Google REFRESH token stored on `gmbAccounts` (deny-all for clients — Admin SDK
 * only); each sync exchanges it for a short-lived access token.
 *
 * Credentials resolve per-tenant first (teamSettings.gmbClientId +
 * teamSecrets.gmbClientSecret via getTeamConfig), then fall back to the
 * platform's Google OAuth client (GOOGLE_CLIENT_ID/SECRET) — the same client
 * used for Search Console, with the business.manage scope added.
 *
 * API surface used (reviews and local posts still live on the v4 endpoint;
 * account/location management moved to the newer per-area APIs):
 *   accounts:   GET https://mybusinessaccountmanagement.googleapis.com/v1/accounts
 *   locations:  GET https://mybusinessbusinessinformation.googleapis.com/v1/{account}/locations
 *   reviews:    GET https://mybusiness.googleapis.com/v4/accounts/{a}/locations/{l}/reviews
 *   reply:      PUT  …/reviews/{reviewId}/reply
 *   localPosts: POST …/localPosts
 *
 * NOTE: Google has NO public API for reporting/flagging a review. "Raporto" is
 * therefore an internal workflow (reason + AI-built argument, stamped on the
 * gmbReviews doc) plus a deep link to Google's own reviews manager.
 */
import type { QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { adminDb, Timestamp } from './_firebaseAdmin.js';
import { refreshGoogleToken } from './_gsc.js';
import { getTeamConfig } from './_tenantConfig.js';
import { notifyUser } from './_push.js';

export const GMB_SCOPE = 'https://www.googleapis.com/auth/business.manage';
const ACCT_API = 'https://mybusinessaccountmanagement.googleapis.com/v1';
const INFO_API = 'https://mybusinessbusinessinformation.googleapis.com/v1';
const V4_API = 'https://mybusiness.googleapis.com/v4';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';

/** Where a tenant reports a review to Google by hand (no API exists for it). */
export const GMB_REPORT_URL = 'https://business.google.com/reviews';

const ENV_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID || '';
const ENV_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';

/** Per-tenant OAuth client (Settings → Google Reviews), env fallback. */
export async function gmbOAuthClient(teamId?: string | null): Promise<{ clientId: string; clientSecret: string; source: 'tenant' | 'env' }> {
  if (teamId) {
    const cfg = await getTeamConfig(teamId);
    if (cfg.gmbClientId && cfg.gmbClientSecret) {
      return { clientId: String(cfg.gmbClientId), clientSecret: String(cfg.gmbClientSecret), source: 'tenant' };
    }
  }
  return { clientId: ENV_CLIENT_ID, clientSecret: ENV_CLIENT_SECRET, source: 'env' };
}

export function buildGmbAuthUrl(clientId: string, redirectUri: string, state: string): string {
  const p = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GMB_SCOPE,
    access_type: 'offline',
    prompt: 'consent', // force refresh_token even on re-auth
    include_granted_scopes: 'true',
    state,
  });
  return `${AUTH_URL}?${p.toString()}`;
}

async function gapi(url: string, accessToken: string, init?: RequestInit): Promise<any> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json?.error?.message || `Google API ${res.status}`;
    throw new Error(msg);
  }
  return json;
}

export interface GmbLocationInfo {
  accountName: string;   // 'accounts/123'
  locationName: string;  // 'locations/456'
  title: string;
  address?: string;
}

/** Every location the authorized Google user manages, across all their accounts. */
export async function listGmbLocations(accessToken: string): Promise<GmbLocationInfo[]> {
  const acctJson = await gapi(`${ACCT_API}/accounts?pageSize=20`, accessToken);
  const accounts: any[] = acctJson.accounts || [];
  const out: GmbLocationInfo[] = [];
  for (const acct of accounts) {
    let pageToken: string | undefined;
    do {
      const qs = new URLSearchParams({
        readMask: 'name,title,storefrontAddress',
        pageSize: '100',
        ...(pageToken ? { pageToken } : {}),
      });
      const json = await gapi(`${INFO_API}/${acct.name}/locations?${qs}`, accessToken);
      for (const loc of json.locations || []) {
        const addr = loc.storefrontAddress
          ? [loc.storefrontAddress.addressLines?.join(', '), loc.storefrontAddress.locality].filter(Boolean).join(', ')
          : undefined;
        out.push({ accountName: acct.name, locationName: loc.name, title: loc.title || loc.name, address: addr });
      }
      pageToken = json.nextPageToken;
    } while (pageToken && out.length < 300);
  }
  return out;
}

const STAR_NUM: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

export interface GmbSyncResult {
  accountId: string;
  location: string;
  synced?: number;
  created?: number;
  autoReplied?: number;
  notified?: number;
  error?: string;
}

/** v4 review path: accounts/{a}/locations/{l} from the stored resource names. */
function v4LocationPath(a: { accountName?: string; locationName?: string }): string {
  return `${a.accountName}/${a.locationName}`;
}

/** Publish a reply to Google and stamp the gmbReviews doc. Shared by API + auto-reply. */
export async function publishGmbReply(
  accessToken: string,
  account: { accountName?: string; locationName?: string },
  reviewGoogleId: string,
  comment: string,
): Promise<void> {
  await gapi(
    `${V4_API}/${v4LocationPath(account)}/reviews/${encodeURIComponent(reviewGoogleId)}/reply`,
    accessToken,
    { method: 'PUT', body: JSON.stringify({ comment }) },
  );
}

// ── AI drafting (per-tenant key via getTeamConfig, env fallback) ──────────────

async function callGeminiText(apiKey: string, model: string, prompt: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error?.message || `Gemini ${res.status}`);
  return json?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') || '';
}

async function callOpenAiText(apiKey: string, model: string, prompt: string): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], max_tokens: 400 }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error?.message || `OpenAI ${res.status}`);
  return json?.choices?.[0]?.message?.content || '';
}

/** One AI text call using the tenant's configured provider (Settings → FivoAI). */
export async function generateAiText(teamId: string | null | undefined, prompt: string): Promise<string> {
  const cfg = teamId ? await getTeamConfig(teamId) : {};
  const provider = cfg.aiProvider === 'openai' ? 'openai' : 'gemini';
  const teamKey = typeof cfg.aiApiKey === 'string' ? cfg.aiApiKey : '';
  const geminiKey = provider === 'gemini' && teamKey ? teamKey : process.env.GEMINI_API_KEY || '';
  const openaiKey = provider === 'openai' && teamKey ? teamKey : process.env.OPENAI_API_KEY || '';
  const model = typeof cfg.aiModel === 'string' && cfg.aiModel ? cfg.aiModel : '';

  if (provider === 'openai' && openaiKey) return (await callOpenAiText(openaiKey, model || 'gpt-4o-mini', prompt)).trim();
  if (geminiKey) return (await callGeminiText(geminiKey, model || 'gemini-2.5-flash', prompt)).trim();
  if (openaiKey) return (await callOpenAiText(openaiKey, model || 'gpt-4o-mini', prompt)).trim();
  throw new Error('AI nuk është konfiguruar (vendos çelësin te Cilësimet → Integrime, ose GEMINI/OPENAI_API_KEY)');
}

export function gmbReplyPrompt(review: { author?: string; starRating?: number; comment?: string }, businessName: string, context?: string): string {
  return [
    `Je menaxheri i biznesit "${businessName}". Një klient la këtë review në Google (${review.starRating ?? '?'} yje):`,
    `Autori: ${review.author || 'Anonim'}`,
    `Teksti: ${review.comment || '(pa tekst — vetëm yje)'}`,
    context ? `Kontekst për biznesin: ${context}` : '',
    '',
    'Shkruaj një përgjigje publike profesionale, të ngrohtë dhe konkrete, në gjuhën në të cilën është shkruar review (nëse s\'ka tekst, në shqip).',
    'Maksimumi 2-3 fjali. Për review negative: kërko ndjesë, trego veprimin korrigjues dhe fto kontakt privat. Mos premto kompensime specifike. Kthe VETËM tekstin e përgjigjes, pa thonjëza.',
  ].filter(Boolean).join('\n');
}

export function gmbReportPrompt(review: { author?: string; starRating?: number; comment?: string }, businessName: string): string {
  return [
    `Je specialist i politikave të Google Maps për reviews. Biznesi "${businessName}" po vlerëson nëse ky review shkel politikat e Google (spam, përmbajtje e rreme, konflikt interesi, gjuhë ofenduese, jashtë teme):`,
    `Autori: ${review.author || 'Anonim'} · ${review.starRating ?? '?'} yje`,
    `Teksti: ${review.comment || '(pa tekst)'}`,
    '',
    'Analizo shkurt (2-4 fjali, në shqip): a ka bazë raportimi sipas politikave të Google, cila politikë konkretisht shkelet (nëse ndonjë), dhe sa është shansi i heqjes. Nëse duket përvojë reale klienti, thuaje qartë se raportimi s\'ka bazë dhe rekomandohet përgjigje publike. Kthe VETËM analizën.',
  ].join('\n');
}

// ── Review sync ────────────────────────────────────────────────────────────────

/** Notify the tenant's Admin/Manager staff (capped) — used for negative reviews. */
async function notifyBusinessManagers(
  businessId: string,
  teamId: string | null,
  build: (userId: string) => Parameters<typeof notifyUser>[0],
): Promise<number> {
  if (!businessId) return 0;
  const snap = await adminDb.collection('teamMembers').where('businessId', '==', businessId).limit(50).get();
  const seen = new Set<string>();
  const targets: string[] = [];
  for (const d of snap.docs) {
    const m = d.data();
    const role = String(m.role || '');
    if (!m.userId || seen.has(m.userId)) continue;
    if (m.status === 'Inactive') continue;
    if (!['Admin', 'Manager', 'Owner', 'SuperAdmin'].includes(role)) continue;
    seen.add(m.userId);
    targets.push(m.userId);
    if (targets.length >= 5) break;
  }
  const results = await Promise.allSettled(targets.map((uid) => notifyUser(build(uid))));
  return results.filter((r) => r.status === 'fulfilled').length;
}

/**
 * Pull one location's reviews and upsert gmbReviews docs. Idempotent: doc id is
 * `${accountDocId}_${reviewId}`; unchanged reviews (same updateTime + reply) are
 * skipped to keep Firestore writes proportional to actual change. Also refreshes
 * rating/reviewCount/starCounts on the account doc (Google returns the real
 * totals with the first page, so the UI never depends on how many we mirrored).
 */
export async function syncGmbAccount(
  accountDoc: QueryDocumentSnapshot,
  opts?: { accessToken?: string; maxPages?: number; config?: Record<string, any> },
): Promise<GmbSyncResult> {
  const a = accountDoc.data();
  const now = Timestamp.now();
  const base: GmbSyncResult = { accountId: accountDoc.id, location: a.name || a.locationName };
  try {
    const { clientId, clientSecret } = await gmbOAuthClient(a.teamId);
    if (!clientId || !clientSecret) throw new Error('Google OAuth nuk është konfiguruar (Client ID/Secret)');
    const accessToken = opts?.accessToken
      || await refreshGoogleToken(clientId, clientSecret, a.refreshToken);
    const cfg = opts?.config ?? (a.teamId ? await getTeamConfig(a.teamId) : {});

    // Existing mirror (one single-field query) so we can diff instead of rewriting.
    const existingSnap = await adminDb.collection('gmbReviews').where('accountId', '==', accountDoc.id).get();
    const existing = new Map<string, any>();
    existingSnap.forEach((d) => existing.set(d.id, d.data()));

    const maxPages = opts?.maxPages ?? 4; // 4 × 50 = the 200 newest reviews
    let pageToken: string | undefined;
    let page = 0;
    let averageRating: number | null = null;
    let totalReviewCount: number | null = null;
    const starCounts: Record<string, number> = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
    let synced = 0, created = 0, autoReplied = 0, notified = 0;

    do {
      const qs = new URLSearchParams({ pageSize: '50', ...(pageToken ? { pageToken } : {}) });
      const json = await gapi(`${V4_API}/${v4LocationPath(a)}/reviews?${qs}`, accessToken);
      if (page === 0) {
        averageRating = typeof json.averageRating === 'number' ? json.averageRating : null;
        totalReviewCount = typeof json.totalReviewCount === 'number' ? json.totalReviewCount : null;
      }
      for (const r of json.reviews || []) {
        const reviewId = String(r.reviewId || (r.name || '').split('/').pop() || '');
        if (!reviewId) continue;
        const stars = STAR_NUM[r.starRating] || 0;
        if (stars) starCounts[String(stars)] = (starCounts[String(stars)] || 0) + 1;
        const docId = `${accountDoc.id}_${reviewId}`;
        const prev = existing.get(docId);
        const replyComment = r.reviewReply?.comment || null;
        const updateTime = r.updateTime || r.createTime || null;
        const unchanged = prev && prev.googleUpdateTime === updateTime && (prev.replyComment || null) === replyComment;
        synced++;
        if (unchanged) continue;

        await adminDb.collection('gmbReviews').doc(docId).set({
          teamId: a.teamId ?? null,
          businessId: a.businessId ?? null,
          customerId: a.customerId ?? null,
          accountId: accountDoc.id,
          locationTitle: a.name || '',
          reviewId,
          author: r.reviewer?.displayName || 'Anonim',
          authorPhotoUrl: r.reviewer?.profilePhotoUrl || null,
          starRating: stars,
          comment: r.comment || '',
          googleCreateTime: r.createTime || null,
          googleUpdateTime: updateTime,
          replyComment,
          replyTime: r.reviewReply?.updateTime || null,
          ...(prev ? {} : { firstSyncedAt: now, repliedVia: null, reported: null, aiSuggestion: null, aiReportAnalysis: null, createdAt: now }),
          updatedAt: now,
        }, { merge: true });

        if (!prev) {
          created++;
          // ── New NEGATIVE review → notify the tenant's managers ──
          if (stars > 0 && stars <= 2 && cfg.gmbNotifyNegative !== false) {
            notified += await notifyBusinessManagers(a.businessId, a.teamId ?? null, (userId) => ({
              userId,
              type: 'gmb_negative_review',
              title: `⭐ Review ${stars}★ në Google: ${a.name || 'profili juaj'}`,
              message: `${r.reviewer?.displayName || 'Anonim'}: "${String(r.comment || '(pa tekst)').slice(0, 140)}"`,
              actionUrl: '/app/gmb',
              actionLabel: 'Shiko Reviews',
              businessId: a.businessId ?? null,
              teamId: a.teamId ?? null,
            }));
          }
          // ── AI auto-reply (opt-in; 'positive' = only 4-5★, 'all' = every new one) ──
          const mode = cfg.gmbAutoReply === 'all' || cfg.gmbAutoReply === 'positive' ? cfg.gmbAutoReply : 'off';
          const eligible = mode === 'all' || (mode === 'positive' && stars >= 4);
          if (!replyComment && eligible && mode !== 'off') {
            try {
              const text = await generateAiText(a.teamId, gmbReplyPrompt(
                { author: r.reviewer?.displayName, starRating: stars, comment: r.comment },
                a.name || 'biznesi', typeof cfg.gmbAiContext === 'string' ? cfg.gmbAiContext : undefined,
              ));
              if (text) {
                await publishGmbReply(accessToken, a, reviewId, text);
                await adminDb.collection('gmbReviews').doc(docId).set({
                  replyComment: text, replyTime: new Date().toISOString(), repliedVia: 'ai-auto', updatedAt: Timestamp.now(),
                }, { merge: true });
                autoReplied++;
              }
            } catch (err) {
              // Auto-reply is best-effort — a failed draft must never fail the sync.
              console.error(`[gmb] auto-reply dështoi (${docId}):`, (err as Error)?.message);
            }
          }
        }
      }
      pageToken = json.nextPageToken;
      page++;
    } while (pageToken && page < maxPages);

    await accountDoc.ref.update({
      rating: averageRating,
      reviewCount: totalReviewCount ?? synced,
      starCounts,
      lastSyncedAt: now,
      lastSyncError: null,
      updatedAt: now,
    });
    return { ...base, synced, created, autoReplied, notified };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'sync failed';
    await accountDoc.ref.update({ lastSyncError: msg, updatedAt: Timestamp.now() }).catch(() => {});
    return { ...base, error: msg };
  }
}

/**
 * Sync every connected GMB location, optionally narrowed to one tenant scope.
 * Serial (Google per-minute quota is tight: ~300 QPM shared per project) and
 * config is cached per team so a 10-location tenant costs one settings read.
 */
export async function syncAllGmbAccounts(
  scope?: { teamId?: string | null; businessId?: string | null },
): Promise<GmbSyncResult[]> {
  const col = adminDb.collection('gmbAccounts');
  const byId = new Map<string, QueryDocumentSnapshot>();
  if (scope?.teamId || scope?.businessId) {
    if (scope.businessId) (await col.where('businessId', '==', scope.businessId).get()).forEach((d) => byId.set(d.id, d as QueryDocumentSnapshot));
    if (scope.teamId) (await col.where('teamId', '==', scope.teamId).get()).forEach((d) => byId.set(d.id, d as QueryDocumentSnapshot));
  } else {
    (await col.where('connected', '==', true).get()).forEach((d) => byId.set(d.id, d as QueryDocumentSnapshot));
  }
  const cfgCache = new Map<string, Record<string, any>>();
  const results: GmbSyncResult[] = [];
  for (const doc of byId.values()) {
    const a = doc.data();
    if (a.connected === false) continue;
    let cfg = a.teamId ? cfgCache.get(a.teamId) : undefined;
    if (a.teamId && !cfg) {
      cfg = await getTeamConfig(a.teamId);
      cfgCache.set(a.teamId, cfg);
    }
    // Tenant opted out of the scheduled sync (manual sync still allowed via scope).
    if (!scope && cfg && cfg.gmbAutoSync === false) continue;
    results.push(await syncGmbAccount(doc, { config: cfg }));
  }
  return results;
}
