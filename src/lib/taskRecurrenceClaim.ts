import { collection, doc, runTransaction, Timestamp } from 'firebase/firestore';
import { auth, db } from './firebase';
import { getGlobalBusinessId, getGlobalTeamId } from '../hooks/useFirestore';
import type { ClaimNextCycleResult, NextCyclePlan } from './recurringUtils';

/**
 * Atomically claim the right to spawn the next cycle of a recurring task — and,
 * given a plan, spawn it IN THE SAME TRANSACTION.
 *
 * The `!task.nextCycleCreated` check in completeTask() reads a React snapshot,
 * and the child was created BEFORE the flag was written — so two completions of
 * the same task (double click, two surfaces, two devices) both saw `false` and
 * both spawned a cycle. Production shows exactly that: parent
 * 0lCjKKS9om69s1e7S1ls produced two children 14 seconds apart, and from then on
 * the cron faithfully doubled the series every week.
 *
 * The transaction re-reads the doc inside Firestore and only the first caller
 * wins. Returns false when someone else already claimed it (or the task is
 * gone), in which case the caller must NOT create a child.
 *
 * With a `plan` the transaction also writes the child occurrence, `Done` +
 * `completedAt` on the tip, and `nextCycleTaskId` (the child's id). The old
 * sequence — claim, then create, then Done, three round trips — left a Todo tip
 * with `nextCycleCreated: true` and no child whenever the tab closed in between:
 * the cron skipped it ("already claimed"), a second Done did nothing, and the
 * series was dead with no reason on the row. Now the claim cannot exist
 * without its child. Returns `'done'` on that path (nothing left to write).
 *
 * The child is stamped exactly as `useMutation('tasks').create` would stamp it
 * (tenant scope, createdAt/updatedAt, createdByUserId = the completer — the
 * create rule requires it), minus the project-derived customerId, which the
 * builder already copies from the tip.
 */
export async function claimTaskNextCycle(taskId: string, plan?: NextCyclePlan | null): Promise<ClaimNextCycleResult> {
  return runTransaction(db, async (tx) => {
    const ref = doc(db, 'tasks', taskId);
    const snap = await tx.get(ref);
    if (!snap.exists()) return false;
    const data = snap.data();
    if (data.nextCycleCreated === true) {
      // A claim the caller proved empty may be taken over — but only if nobody
      // re-claimed since the caller looked (the recorded child id is unchanged).
      const takeOver = !!plan?.rearm && (data.nextCycleTaskId ?? null) === (plan?.expectedChildId ?? null);
      if (!takeOver) return false;
    }
    const now = Timestamp.now();
    if (!plan) {
      tx.update(ref, { nextCycleCreated: true, updatedAt: now });
      return true;
    }
    const tip: Record<string, unknown> = {
      nextCycleCreated: true,
      status: 'Done',
      completedAt: now,
      updatedAt: now,
      ...(plan.rearm ? { recurringClaimRepairedAt: now } : {}),
    };
    if (plan.child) {
      const childRef = doc(collection(db, 'tasks'));
      tx.set(childRef, stampNewTask(plan.child));
      tx.update(ref, { ...tip, nextCycleTaskId: childRef.id, recurringSkippedReason: null });
    } else {
      tx.update(ref, { ...tip, nextCycleTaskId: null, recurringSkippedReason: plan.skippedReason ?? 'series-ended' });
    }
    return 'done';
  });
}

/** Give a claim-only reservation back when the child could not be created, so
 *  the cron backstop (or the next completion) can still produce the missing
 *  cycle. Never needed after a `'done'` claim — the child is already there. */
export async function releaseTaskNextCycle(taskId: string): Promise<void> {
  const ref = doc(db, 'tasks', taskId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) return;
    tx.update(ref, { nextCycleCreated: false, updatedAt: Timestamp.now() });
  });
}

/** MIRRORS the stamps of `useMutation.create` (src/hooks/useFirestore.ts) for a
 *  `tasks` row written inside a transaction. `undefined` values are dropped
 *  the way `removeUndefined` drops them — Firestore refuses them. */
function stampNewTask(data: Record<string, unknown>): Record<string, unknown> {
  const explicitTeamId = typeof data.teamId === 'string' && data.teamId ? data.teamId : null;
  const teamId = explicitTeamId || getGlobalTeamId() || undefined;
  const explicitBusinessId = typeof data.businessId === 'string' && data.businessId ? data.businessId : null;
  const businessId = explicitBusinessId || getGlobalBusinessId() || teamId || undefined;
  const now = Timestamp.now();
  return stripUndefined({
    ...(teamId ? { teamId } : {}),
    ...(businessId ? { businessId } : {}),
    ...data,
    createdAt: now,
    updatedAt: now,
    createdByUserId: auth.currentUser?.uid || null,
  }) as Record<string, unknown>;
}

function stripUndefined(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripUndefined);
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, stripUndefined(v)]),
    );
  }
  return value;
}
