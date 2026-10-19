import { doc, getDoc, serverTimestamp, updateDoc, writeBatch } from 'firebase/firestore';
import { db } from './firebase';
import { shouldMarkAssigneeSeen } from './taskReceipts';

/**
 * The two "Parë" writes (decisions live in taskReceipts.ts). Raw Firestore on
 * purpose: useMutation stamps `updatedAt`, and being seen is not an edit — the
 * rules accept exactly these keys and nothing else (tests 83a, 83g–83i).
 */

/** The assignee opened the task. Throws on a rules denial — callers swallow it. */
export async function markAssigneeSeen(taskId: string, uid: string): Promise<void> {
  await updateDoc(doc(db, 'tasks', taskId), {
    assigneeSeenAt: serverTimestamp(),
    assigneeSeenFor: uid,
  });
}

/**
 * From a notification click (task_assigned): read the task first so the mark is
 * written once and only while this person is still the assignee.
 */
export async function markAssigneeSeenIfNeeded(taskId: string, uid: string): Promise<boolean> {
  try {
    const snap = await getDoc(doc(db, 'tasks', taskId));
    if (!snap.exists()) return false;
    const data = snap.data() as any;
    if (!shouldMarkAssigneeSeen(data, uid, { visible: true })) return false;
    await markAssigneeSeen(taskId, uid);
    return true;
  } catch (err) {
    console.warn('[Tasks] shënimi "Parë" nga njoftimi dështoi:', err);
    return false;
  }
}

/**
 * Adds `readBy.<uid>` to each comment, in batches. A batch is all-or-nothing, so
 * a failed one is retried per document (one odd row — e.g. a legacy comment with
 * no businessId — must not keep the rest unread). Resolves with the failed count.
 */
export async function markTaskCommentsRead(commentIds: readonly string[], uid: string): Promise<number> {
  let failed = 0;
  for (let i = 0; i < commentIds.length; i += 400) {
    const chunk = commentIds.slice(i, i + 400);
    const batch = writeBatch(db);
    for (const id of chunk) batch.update(doc(db, 'taskComments', id), { [`readBy.${uid}`]: serverTimestamp() });
    try {
      await batch.commit();
    } catch {
      const res = await Promise.allSettled(chunk.map(id =>
        updateDoc(doc(db, 'taskComments', id), { [`readBy.${uid}`]: serverTimestamp() })));
      failed += res.filter(r => r.status === 'rejected').length;
    }
  }
  return failed;
}
