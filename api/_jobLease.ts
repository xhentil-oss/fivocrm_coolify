/**
 * Job leases — "only one copy of this job may run at a time".
 *
 * The VPS scheduler, run-all and a manual "Nis tani" can all fire the same job
 * at once (`overdue-reminders` and `whatsapp-broadcasts` are ALSO in run-all).
 * For a job that messages real people two overlapping runs read the same
 * "not yet sent" state and both send. A lease is claimed in a transaction on
 * `jobLeases/{job}_{scope}` with an `expiresAt`; a second run finds it held and
 * returns `{ skipped: 'lease-held' }` without touching anything. The TTL is the
 * safety net for a run that dies: the lease simply expires.
 *
 * A SCOPED run (one tenant's manual trigger) also refuses while the GLOBAL lease
 * (`{job}_all`) is held. (The reverse is not checked — a global run does not scan
 * for scoped leases; the per-record claims/stamps inside each job cover that rare
 * overlap.)
 *
 * `jobLeases` is server-only: written by the Admin SDK, no client rule matches it
 * (Firestore denies by default). The same collection carries short alert-throttle
 * claims (`claimWindow`).
 */
import crypto from 'node:crypto';
import admin, { adminDb as db } from './_firebaseAdmin.js';

export type LeaseHeld = {
  skipped: 'lease-held';
  job: string;
  scope: string;
  heldUntil: string | null;
  [key: string]: unknown;
};

const COLLECTION = 'jobLeases';

function leaseId(job: string, scope: string): string {
  return `${job}_${scope}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 300);
}

function expiresMs(snap: admin.firestore.DocumentSnapshot): number {
  const v = snap.exists ? (snap.data() as any)?.expiresAt : null;
  return v?.toMillis ? v.toMillis() : 0;
}

export async function withJobLease<T>(
  job: string,
  scopeId: string | null | undefined,
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<T | LeaseHeld> {
  const scope = scopeId || 'all';
  const ref = db.collection(COLLECTION).doc(leaseId(job, scope));
  const globalRef = scope === 'all' ? null : db.collection(COLLECTION).doc(leaseId(job, 'all'));
  const holder = crypto.randomUUID();
  let heldUntil = 0;
  try {
    const acquired = await db.runTransaction(async (tx) => {
      const now = Date.now();
      const [own, global] = await Promise.all([tx.get(ref), globalRef ? tx.get(globalRef) : Promise.resolve(null)]);
      const until = Math.max(expiresMs(own), global ? expiresMs(global) : 0);
      if (until > now) { heldUntil = until; return false; }
      tx.set(ref, {
        job, scope, holder,
        acquiredAt: admin.firestore.Timestamp.fromMillis(now),
        expiresAt: admin.firestore.Timestamp.fromMillis(now + ttlMs),
      });
      return true;
    });
    if (!acquired) {
      console.warn(`[jobLease] ${job}/${scope} held until ${new Date(heldUntil).toISOString()} — skipped`);
      return { skipped: 'lease-held', job, scope, heldUntil: heldUntil ? new Date(heldUntil).toISOString() : null };
    }
  } catch (err) {
    // A lease we cannot evaluate must not silently become "two senders": refuse.
    console.error(`[jobLease] ${job}/${scope} claim failed — skipped`, (err as Error)?.message || err);
    return { skipped: 'lease-held', job, scope, heldUntil: null };
  }

  try {
    return await fn();
  } finally {
    // Release only OUR lease (an expired-and-reclaimed one belongs to someone else).
    try {
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (snap.exists && (snap.data() as any)?.holder === holder) tx.delete(ref);
      });
    } catch (err) {
      console.warn(`[jobLease] ${job}/${scope} release failed (expires by TTL)`, (err as Error)?.message || err);
    }
  }
}

export function isLeaseHeld(v: unknown): v is LeaseHeld {
  return !!v && typeof v === 'object' && (v as any).skipped === 'lease-held';
}

/**
 * At most once per `windowMs` for `key` (alert throttling). Returns true when the
 * caller won the window and should act. Fails CLOSED (false) on an error — a
 * missed alert is better than an alert storm.
 */
export async function claimWindow(key: string, windowMs: number): Promise<boolean> {
  const ref = db.collection(COLLECTION).doc(leaseId('window', key));
  try {
    return await db.runTransaction(async (tx) => {
      const now = Date.now();
      const snap = await tx.get(ref);
      if (expiresMs(snap) > now) return false;
      tx.set(ref, {
        job: 'window', scope: key,
        acquiredAt: admin.firestore.Timestamp.fromMillis(now),
        expiresAt: admin.firestore.Timestamp.fromMillis(now + windowMs),
      });
      return true;
    });
  } catch (err) {
    console.warn(`[jobLease] window ${key} failed`, (err as Error)?.message || err);
    return false;
  }
}
