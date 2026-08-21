import admin, { adminDb } from './_firebaseAdmin.js';

/**
 * Firestore-backed hourly rate limit, shared across serverless instances.
 *
 * The in-memory Maps in the endpoints are only a fast local path: each Vercel
 * instance has its own Map and concurrent requests fan out across instances, so
 * an in-memory counter alone enforces nothing. This counter is one doc per
 * (scope, caller) — `rateLimits/{scope}_{uid}` — reset by hour key, so it never
 * accumulates documents. One transactional read+write per call.
 *
 * Fail-open on infra errors: rate limiting must never turn a Firestore blip into
 * dropped legitimate notifications.
 */
export async function checkPersistentRateLimit(
  scope: string,
  uid: string,
  maxPerHour: number,
): Promise<boolean> {
  const hourKey = new Date().toISOString().slice(0, 13); // '2026-08-21T14'
  const ref = adminDb.collection('rateLimits').doc(`${scope}_${uid}`);
  try {
    return await adminDb.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.exists ? (snap.data() as any) : undefined;
      const count = data?.hourKey === hourKey ? Number(data.count) || 0 : 0;
      if (count >= maxPerHour) return false;
      tx.set(ref, {
        hourKey,
        count: count + 1,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return true;
    });
  } catch {
    return true; // fail-open
  }
}
