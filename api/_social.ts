/**
 * Shared social-analytics sync logic — used by both api/social.ts ("sync now")
 * and api/cron/run.ts (monthly scheduled pull).  Kept separate so the Firestore
 * write shape lives in exactly one place.
 */
import type { QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { adminDb, Timestamp } from './_firebaseAdmin.js';
import { fetchSnapshot, monthRange } from './_meta-insights.js';
import { refreshGoogleToken, fetchSearchConsoleSnapshot } from './_gsc.js';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';

// Current month as 'YYYY-MM' in UTC.
export function currentPeriod(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export interface SyncResult {
  accountId: string;
  platform: string;
  period: string;
  followers?: number;
  reach?: number;
  clicks?: number;
  error?: string;
}

// Pull one account's insights for `period` and upsert its socialSnapshots doc.
// Idempotent: the snapshot id is `${accountId}_${period}`, so re-running a month
// overwrites rather than duplicating. Branches by platform: Meta (FB/IG) vs
// Google Search Console.
export async function syncAccount(accountDoc: QueryDocumentSnapshot, period: string): Promise<SyncResult> {
  const a = accountDoc.data();
  const { start, end } = monthRange(period);
  const now = Timestamp.now();
  const base = {
    teamId: a.teamId,
    businessId: a.businessId ?? null,
    customerId: a.customerId,
    accountId: accountDoc.id,
    platform: a.platform,
    accountName: a.name,
    username: a.username ?? null,
    pictureUrl: a.pictureUrl ?? null,
    period,
    periodStart: Timestamp.fromDate(start),
    periodEnd: Timestamp.fromDate(end),
    fetchedAt: now,
    updatedAt: now,
    createdByUserId: null,
    createdAt: now,
  };
  const snapRef = adminDb.collection('socialSnapshots').doc(`${accountDoc.id}_${period}`);

  try {
    if (a.platform === 'search-console') {
      // Google Search Console: refresh-token → access-token → search analytics.
      if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) throw new Error('Google OAuth nuk është konfiguruar (GOOGLE_CLIENT_ID/SECRET)');
      const accessToken = await refreshGoogleToken(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, a.accessToken);
      const seo = await fetchSearchConsoleSnapshot(a.externalId, accessToken, period);
      await snapRef.set({ ...base, seo: { metrics: seo.metrics, daily: seo.daily, topQueries: seo.topQueries, topPages: seo.topPages, countries: seo.countries ?? null, devices: seo.devices ?? null } }, { merge: true });
      const note = seo.errors && seo.errors.length ? seo.errors.join(' | ').slice(0, 500) : null;
      await accountDoc.ref.update({ lastSyncedAt: now, lastSyncError: note, updatedAt: now });
      return { accountId: accountDoc.id, platform: a.platform, period, clicks: seo.metrics.clicks };
    }

    // Meta (Facebook Pages + Instagram).
    const data = await fetchSnapshot(
      { accessToken: a.accessToken, externalId: a.externalId, platform: a.platform },
      period,
    );
    const topPosts = data.topPosts.map((p) => ({
      ...p,
      timestamp: p.timestamp ? Timestamp.fromDate(p.timestamp) : null,
    }));
    await snapRef.set({
      ...base,
      metrics: data.metrics,
      daily: data.daily,
      topPosts,
      demographics: data.demographics ?? null,
    }, { merge: true });

    // Surface non-fatal Graph API failures (deprecated metric, missing perm) so
    // the staff UI explains why a metric came back 0 instead of failing silently.
    const note = data.errors && data.errors.length ? data.errors.join(' | ').slice(0, 500) : null;
    await accountDoc.ref.update({ lastSyncedAt: now, lastSyncError: note, updatedAt: now });
    return {
      accountId: accountDoc.id, platform: a.platform, period,
      followers: data.metrics.followers, reach: data.metrics.reach,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'sync failed';
    await accountDoc.ref.update({ lastSyncError: msg, updatedAt: Timestamp.now() }).catch(() => {});
    return { accountId: accountDoc.id, platform: a.platform, period, error: msg };
  }
}

// Sync every connected account for a period. Optionally narrow to a tenant scope
// (businessId primary, teamId fallback — deduped by doc id). No scope = all
// connected accounts (used by the monthly cron).
export async function syncAllAccounts(
  period: string,
  scope?: { teamId?: string | null; businessId?: string | null },
): Promise<SyncResult[]> {
  const col = adminDb.collection('socialAccounts');
  const byId = new Map<string, QueryDocumentSnapshot>();
  // Single-field equality queries only (no composite index needed); `connected`
  // is filtered in memory below.
  if (scope?.teamId || scope?.businessId) {
    if (scope.businessId) (await col.where('businessId', '==', scope.businessId).get()).forEach((d) => byId.set(d.id, d as QueryDocumentSnapshot));
    if (scope.teamId) (await col.where('teamId', '==', scope.teamId).get()).forEach((d) => byId.set(d.id, d as QueryDocumentSnapshot));
  } else {
    (await col.where('connected', '==', true).get()).forEach((d) => byId.set(d.id, d as QueryDocumentSnapshot));
  }
  const results: SyncResult[] = [];
  // Serial to stay gentle on Graph API rate limits — the set is small (per client).
  for (const doc of byId.values()) {
    if (doc.data().connected === false) continue;
    results.push(await syncAccount(doc, period));
  }
  return results;
}
