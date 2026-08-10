import { doc, runTransaction, Timestamp } from 'firebase/firestore';
import { db } from './firebase';

/**
 * Atomically claim the right to spawn the next cycle of a recurring task.
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
 */
export async function claimTaskNextCycle(taskId: string): Promise<boolean> {
  return runTransaction(db, async (tx) => {
    const ref = doc(db, 'tasks', taskId);
    const snap = await tx.get(ref);
    if (!snap.exists()) return false;
    if (snap.data().nextCycleCreated === true) return false;
    tx.update(ref, { nextCycleCreated: true, updatedAt: Timestamp.now() });
    return true;
  });
}

/** Give the claim back when the child could not be created, so the cron
 *  backstop (or the next completion) can still produce the missing cycle. */
export async function releaseTaskNextCycle(taskId: string): Promise<void> {
  const ref = doc(db, 'tasks', taskId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) return;
    tx.update(ref, { nextCycleCreated: false, updatedAt: Timestamp.now() });
  });
}
