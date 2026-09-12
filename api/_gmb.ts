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
 * A refresh token is PERMANENTLY BOUND to the OAuth client that minted it, so
 * the connect flow pins `oauthClientId` on the account doc and
 * `accessTokenForAccount()` refuses to refresh with a different client —
 * otherwise a tenant that later configures its own credentials would silently
 * break every previously connected location with invalid_grant.
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
import { managerIdsForBusiness } from './_staffRecipients.js';
import { generateAiText, callGeminiText, callOpenAiText } from './_aiProvider.js';

export const GMB_SCOPE = 'https://www.googleapis.com/auth/business.manage';
const ACCT_API = 'https://mybusinessaccountmanagement.googleapis.com/v1';
const INFO_API = 'https://mybusinessbusinessinformation.googleapis.com/v1';
const V4_API = 'https://mybusiness.googleapis.com/v4';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';

/** Where a tenant reports a review to Google by hand (no API exists for it). */
export const GMB_REPORT_URL = 'https://business.google.com/reviews';

const ENV_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID || '';
const ENV_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';

export interface GmbOAuthClientInfo { clientId: string; clientSecret: string; source: 'tenant' | 'env' }

/**
 * Per-tenant OAuth client (Settings → Google Reviews), env fallback. Pass an
 * already-loaded team config to avoid a redundant getTeamConfig read (the cron
 * caches configs per team).
 */
export async function gmbOAuthClient(teamId?: string | null, cfg?: Record<string, any>): Promise<GmbOAuthClientInfo> {
  const conf = cfg ?? (teamId ? await getTeamConfig(teamId) : {});
  if (conf.gmbClientId && conf.gmbClientSecret) {
    return { clientId: String(conf.gmbClientId), clientSecret: String(conf.gmbClientSecret), source: 'tenant' };
  }
  return { clientId: ENV_CLIENT_ID, clientSecret: ENV_CLIENT_SECRET, source: 'env' };
}

/**
 * Access token for a connected account, honoring the OAuth client the refresh
 * token was minted under (`oauthClientId`, pinned at connect time). A token
 * refreshed with a DIFFERENT client id always fails (invalid_grant), so when the
 * pinned client is no longer configured we fail with an actionable message
 * instead of an opaque Google error.
 */
export async function accessTokenForAccount(a: Record<string, any>, cfg?: Record<string, any>): Promise<string> {
  const tenant = await gmbOAuthClient(a.teamId, cfg);
  const candidates: GmbOAuthClientInfo[] = [];
  if (tenant.clientId && tenant.clientSecret) candidates.push(tenant);
  if (ENV_CLIENT_ID && ENV_CLIENT_SECRET && tenant.clientId !== ENV_CLIENT_ID) {
    candidates.push({ clientId: ENV_CLIENT_ID, clientSecret: ENV_CLIENT_SECRET, source: 'env' });
  }
  if (!candidates.length) throw new Error('Google OAuth nuk është konfiguruar (Client ID/Secret)');

  // Legacy docs (pre-pinning) have no oauthClientId — use the current resolution order.
  const pinned = a.oauthClientId
    ? candidates.find((c) => c.clientId === a.oauthClientId)
    : candidates[0];
  if (!pinned) {
    throw new Error('Kredencialet OAuth me të cilat u lidh ky profil nuk janë më të konfiguruara — shkëputeni dhe rilidheni profilin.');
  }
  return refreshGoogleToken(pinned.clientId, pinned.clientSecret, a.refreshToken);
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
  deleted?: number;
  autoReplied?: number;
  notified?: number;
  backfill?: boolean;
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

// ── AI drafting ───────────────────────────────────────────────────────────────
// The provider resolution (tenant key via getTeamConfig, env fallback, Gemini ⇄
// OpenAI) lives in api/_aiProvider.ts now — shared with ai-chat and the WhatsApp
// "Sugjerim AI" draft. Re-exported so existing callers keep their import.
export { generateAiText, callGeminiText, callOpenAiText };

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

/**
 * Admin/Manager userIds of a business (capped at 5 for review alerts) — resolved
 * once per sync, not per review. The resolver itself now lives in
 * api/_staffRecipients.ts and is shared with the inbound-WhatsApp handler and
 * the cron; re-exported so existing callers keep their import.
 */
export { managerIdsForBusiness };
async function businessManagerIds(businessId?: string | null): Promise<string[]> {
  return managerIdsForBusiness(businessId, null, { cap: 5 });
}

interface NewReviewSideEffectInput {
  docId: string;
  reviewId: string;
  stars: number;
  author: string;
  comment: string;
  hasReply: boolean;
}

/**
 * Pull one location's reviews and upsert gmbReviews docs.
 *
 * Invariants this function is responsible for:
 *  - Idempotent mirror: doc id is `${accountDocId}_${reviewId}`; unchanged
 *    reviews are skipped so Firestore writes stay proportional to real change.
 *  - Bounded reads: per fetched page we `getAll()` exactly those ≤50 mirror docs
 *    (never the whole mirror), and we STOP paging as soon as an entire page is
 *    unchanged — Google returns reviews newest-updated first, so nothing older
 *    changed either.
 *  - BACKFILL IS SILENT: on the first-ever sync (`lastSyncedAt == null`) every
 *    review is "new to the mirror" but not new in reality — no notifications and
 *    no AI auto-replies fire for historical reviews. Side effects only run once
 *    the account has completed at least one sync.
 *  - Ghost pruning: when a run has seen Google's FULL list (no remaining page
 *    token and no early stop), mirror docs absent from it are deleted — a review
 *    removed on Google (e.g. after a successful report) must not haunt the
 *    "Pa përgjigje" KPI forever.
 *  - Honest distribution: starCounts is only (re)written together with
 *    `starCountsComplete`, and left untouched on an early-stop run where the
 *    previously stored distribution is still the best known.
 */
export async function syncGmbAccount(
  accountDoc: QueryDocumentSnapshot,
  opts?: { accessToken?: string; maxPages?: number; config?: Record<string, any> },
): Promise<GmbSyncResult> {
  const a = accountDoc.data();
  const now = Timestamp.now();
  const base: GmbSyncResult = { accountId: accountDoc.id, location: a.name || a.locationName };
  try {
    const cfg = opts?.config ?? (a.teamId ? await getTeamConfig(a.teamId) : {});
    const accessToken = opts?.accessToken || await accessTokenForAccount(a, cfg);
    const isBackfill = !a.lastSyncedAt;

    let managersCache: string[] | null = null;
    const managerIds = async () => (managersCache ??= await businessManagerIds(a.businessId));

    const maxPages = opts?.maxPages ?? 4; // 4 × 50 = the 200 newest reviews
    let pageToken: string | undefined;
    let page = 0;
    let stoppedEarly = false;
    let averageRating: number | null = null;
    let totalReviewCount: number | null = null;
    const starCounts: Record<string, number> = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
    const seenIds = new Set<string>();
    let synced = 0, created = 0, deleted = 0, autoReplied = 0, notified = 0;

    do {
      const qs = new URLSearchParams({ pageSize: '50', ...(pageToken ? { pageToken } : {}) });
      const json = await gapi(`${V4_API}/${v4LocationPath(a)}/reviews?${qs}`, accessToken);
      if (page === 0) {
        averageRating = typeof json.averageRating === 'number' ? json.averageRating : null;
        totalReviewCount = typeof json.totalReviewCount === 'number' ? json.totalReviewCount : null;
      }
      const pageReviews: any[] = json.reviews || [];

      // Bounded diff: read exactly this page's mirror docs, nothing more.
      const entries = pageReviews
        .map((r) => ({ r, reviewId: String(r.reviewId || (r.name || '').split('/').pop() || '') }))
        .filter((e) => e.reviewId);
      const refs = entries.map((e) => adminDb.collection('gmbReviews').doc(`${accountDoc.id}_${e.reviewId}`));
      const prevSnaps = refs.length ? await adminDb.getAll(...refs) : [];
      const prevById = new Map<string, any>();
      prevSnaps.forEach((s) => { if (s.exists) prevById.set(s.id, s.data()); });

      const batch = adminDb.batch();
      let batchCount = 0;
      const newOnPage: NewReviewSideEffectInput[] = [];
      let pageChanged = false;

      for (const { r, reviewId } of entries) {
        const stars = STAR_NUM[r.starRating] || 0;
        if (stars) starCounts[String(stars)] = (starCounts[String(stars)] || 0) + 1;
        const docId = `${accountDoc.id}_${reviewId}`;
        seenIds.add(docId);
        synced++;
        const prev = prevById.get(docId);
        const replyComment = r.reviewReply?.comment || null;
        const updateTime = r.updateTime || r.createTime || null;
        if (prev && prev.googleUpdateTime === updateTime && (prev.replyComment || null) === replyComment) continue;

        pageChanged = true;
        batch.set(adminDb.collection('gmbReviews').doc(docId), {
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
        batchCount++;

        if (!prev) {
          created++;
          newOnPage.push({
            docId, reviewId, stars,
            author: r.reviewer?.displayName || 'Anonim',
            comment: r.comment || '',
            hasReply: !!replyComment,
          });
        }
      }

      if (batchCount) await batch.commit();

      // ── Side effects: only for genuinely new reviews, never for the backfill ──
      if (!isBackfill) {
        for (const nr of newOnPage) {
          if (nr.stars > 0 && nr.stars <= 2 && cfg.gmbNotifyNegative !== false) {
            const targets = await managerIds();
            const results = await Promise.allSettled(targets.map((userId) => notifyUser({
              userId,
              type: 'gmb_negative_review',
              title: `⭐ Review ${nr.stars}★ në Google: ${a.name || 'profili juaj'}`,
              message: `${nr.author}: "${(nr.comment || '(pa tekst)').slice(0, 140)}"`,
              actionUrl: '/app/gmb',
              actionLabel: 'Shiko Reviews',
              businessId: a.businessId ?? null,
              teamId: a.teamId ?? null,
            })));
            notified += results.filter((x) => x.status === 'fulfilled').length;
          }

          const mode = cfg.gmbAutoReply === 'all' || cfg.gmbAutoReply === 'positive' ? cfg.gmbAutoReply : 'off';
          const eligible = mode === 'all' || (mode === 'positive' && nr.stars >= 4);
          if (!nr.hasReply && eligible) {
            try {
              const text = await generateAiText(a.teamId, gmbReplyPrompt(
                { author: nr.author, starRating: nr.stars, comment: nr.comment },
                a.name || 'biznesi', typeof cfg.gmbAiContext === 'string' ? cfg.gmbAiContext : undefined,
              ));
              if (text) {
                await publishGmbReply(accessToken, a, nr.reviewId, text);
                await adminDb.collection('gmbReviews').doc(nr.docId).set({
                  replyComment: text, replyTime: new Date().toISOString(), repliedVia: 'ai-auto', updatedAt: Timestamp.now(),
                }, { merge: true });
                autoReplied++;
              }
            } catch (err) {
              // Auto-reply is best-effort — a failed draft must never fail the sync.
              console.error(`[gmb] auto-reply dështoi (${nr.docId}):`, (err as Error)?.message);
            }
          }
        }
      }

      pageToken = json.nextPageToken;
      page++;
      // Newest-updated-first ordering: a fully unchanged page (that had known
      // reviews at all) means every older page is unchanged too — stop paging.
      if (!pageChanged && entries.length > 0 && prevById.size === entries.length && pageToken) {
        stoppedEarly = true;
        break;
      }
    } while (pageToken && page < maxPages);

    const sawFullList = !pageToken && !stoppedEarly;

    // ── Prune ghosts: only when this run saw Google's complete list ──
    if (sawFullList) {
      const mirror = await adminDb.collection('gmbReviews').where('accountId', '==', accountDoc.id).get();
      const stale = mirror.docs.filter((d) => !seenIds.has(d.id));
      for (let i = 0; i < stale.length; i += 400) {
        const delBatch = adminDb.batch();
        stale.slice(i, i + 400).forEach((d) => delBatch.delete(d.ref));
        await delBatch.commit();
      }
      deleted = stale.length;
    }

    await accountDoc.ref.update({
      rating: averageRating,
      reviewCount: totalReviewCount ?? synced,
      // starCounts stays untouched on an early stop (previous value still valid);
      // otherwise it reflects what was fetched, flagged complete/partial honestly.
      ...(stoppedEarly ? {} : { starCounts, starCountsComplete: sawFullList }),
      lastSyncedAt: now,
      lastSyncError: null,
      updatedAt: now,
    });
    return { ...base, synced, created, deleted, autoReplied, notified, backfill: isBackfill || undefined };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'sync failed';
    await accountDoc.ref.update({ lastSyncError: msg, updatedAt: Timestamp.now() }).catch(() => {});
    return { ...base, error: msg };
  }
}

export interface GmbSyncAllResult {
  results: GmbSyncResult[];
  /** Accounts not reached before the time budget ran out (they go FIRST next run). */
  skipped: number;
}

/**
 * Sync every connected GMB location, optionally narrowed to one tenant scope.
 * Serial (Google per-minute quota is tight: ~300 QPM shared per project), but:
 *  - accounts are ordered by lastSyncedAt ASC (never-synced first), so a run
 *    that hits the time budget starves DIFFERENT accounts next hour instead of
 *    the same tail forever;
 *  - a time budget keeps the whole run inside Vercel's 60s maxDuration — a
 *    truncated run reports `skipped` instead of being killed mid-loop with no
 *    record at all.
 * Config is cached per team so a 10-location tenant costs one settings read.
 */
export async function syncAllGmbAccounts(
  scope?: { teamId?: string | null; businessId?: string | null },
  opts?: { budgetMs?: number },
): Promise<GmbSyncAllResult> {
  const started = Date.now();
  const budgetMs = opts?.budgetMs ?? 48_000;
  const col = adminDb.collection('gmbAccounts');
  const byId = new Map<string, QueryDocumentSnapshot>();
  if (scope?.teamId || scope?.businessId) {
    if (scope.businessId) (await col.where('businessId', '==', scope.businessId).get()).forEach((d) => byId.set(d.id, d as QueryDocumentSnapshot));
    if (scope.teamId) (await col.where('teamId', '==', scope.teamId).get()).forEach((d) => byId.set(d.id, d as QueryDocumentSnapshot));
  } else {
    (await col.where('connected', '==', true).get()).forEach((d) => byId.set(d.id, d as QueryDocumentSnapshot));
  }

  // Oldest-synced first; never-synced (null) at the very front.
  const ordered = [...byId.values()].sort((x, y) => {
    const mx = x.data().lastSyncedAt?.toMillis?.() ?? 0;
    const my = y.data().lastSyncedAt?.toMillis?.() ?? 0;
    return mx - my;
  });

  const cfgCache = new Map<string, Record<string, any>>();
  const results: GmbSyncResult[] = [];
  let skipped = 0;
  for (const doc of ordered) {
    const a = doc.data();
    if (a.connected === false) continue;
    if (Date.now() - started > budgetMs) { skipped++; continue; }
    let cfg = a.teamId ? cfgCache.get(a.teamId) : undefined;
    if (a.teamId && !cfg) {
      cfg = await getTeamConfig(a.teamId);
      cfgCache.set(a.teamId, cfg);
    }
    // Tenant opted out of the scheduled sync (manual sync still allowed via scope).
    if (!scope && cfg && cfg.gmbAutoSync === false) continue;
    results.push(await syncGmbAccount(doc, { config: cfg }));
  }
  if (skipped) console.warn(`[gmb] time budget hit — ${skipped} llogari shtyhen për run-in e ardhshëm (do të kenë përparësi)`);
  return { results, skipped };
}
