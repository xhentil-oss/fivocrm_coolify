/**
 * Shared social-analytics sync logic — used by both api/social.ts ("sync now")
 * and api/cron/run.ts (monthly scheduled pull).  Kept separate so the Firestore
 * write shape lives in exactly one place.
 */
import type { QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { adminDb, Timestamp } from './_firebaseAdmin.js';
import { fetchSnapshot, monthRange } from './_meta-insights.js';

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
  error?: string;
}

// Pull one account's insights for `period` and upsert its socialSnapshots doc.
// Idempotent: the snapshot id is `${accountId}_${period}`, so re-running a month
// overwrites rather than duplicating.
export async function syncAccount(accountDoc: QueryDocumentSnapshot, period: string): Promise<SyncResult> {
  const a = accountDoc.data();
  try {
    const data = await fetchSnapshot(
      { accessToken: a.accessToken, externalId: a.externalId, platform: a.platform },
      period,
    );
    const { start, end } = monthRange(period);
    const now = Timestamp.now();
    const topPosts = data.topPosts.map((p) => ({
      ...p,
      timestamp: p.timestamp ? Timestamp.fromDate(p.timestamp) : null,
    }));

    await adminDb.collection('socialSnapshots').doc(`${accountDoc.id}_${period}`).set(
      {
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
        metrics: data.metrics,
        daily: data.daily,
        topPosts,
        demographics: data.demographics ?? null,
        fetchedAt: now,
        updatedAt: now,
        createdByUserId: null,
        createdAt: now,
      },
      { merge: true },
    );

    await accountDoc.ref.update({ lastSyncedAt: now, lastSyncError: null, updatedAt: now });
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

// Sync every connected account (optionally a single team) for a period.
export async function syncAllAccounts(period: string, teamId?: string): Promise<SyncResult[]> {
  let q = adminDb.collection('socialAccounts').where('connected', '==', true);
  if (teamId) q = q.where('teamId', '==', teamId);
  const snap = await q.get();
  const results: SyncResult[] = [];
  // Serial to stay gentle on Graph API rate limits — the set is small (per client).
  for (const doc of snap.docs) {
    results.push(await syncAccount(doc as QueryDocumentSnapshot, period));
  }
  return results;
}
