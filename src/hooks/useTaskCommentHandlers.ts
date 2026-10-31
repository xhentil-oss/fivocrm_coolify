import { arrayRemove, arrayUnion } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { useMutation } from './useFirestore';
import { toast } from './use-toast';
import type { Task, TaskComment } from '../types';

/**
 * The reaction toggle as ONE field-path write: `reactions.<emoji>` gets the
 * caller's uid added or removed atomically. The old read-modify-write of the
 * whole `reactions` map from the snapshot let two colleagues reacting within
 * the same latency window overwrite each other's reaction (the second write
 * carried a map that never saw the first). Same pattern as ChatView's message
 * reactions. `useMutation.update` passes a FieldValue sentinel through
 * untouched, and the dotted key is a Firestore field path.
 */
export function reactionTogglePatch(
  comment: { reactions?: Record<string, string[]> | null } | null | undefined,
  emoji: string,
  uid: string,
): Record<string, unknown> {
  const current = comment?.reactions?.[emoji];
  const already = Array.isArray(current) && current.includes(uid);
  return { [`reactions.${emoji}`]: already ? arrayRemove(uid) : arrayUnion(uid) };
}

/**
 * The comment callbacks TasksView hands to TaskDetailPanel (extracted verbatim).
 * `customerId` on a task comment IS the client-visibility switch.
 */
export function useTaskCommentHandlers(
  rawTasks: Task[] | undefined | null,
  comments: TaskComment[] | undefined | null,
) {
  const { user } = useAuth();
  const commentMutation = useMutation<TaskComment>('taskComments');

  const handleAddComment = async (taskId: string, content: string, opts?: { visibleToClient?: boolean }) => {
    // Return the created doc — the panel needs its id to deep-link the notifications.
    // customerId on a task comment IS the client-visibility switch (the portal
    // reads `customerId == mine`), so it is stamped ONLY when the composer
    // explicitly marked the comment client-visible — and always from the
    // TASK's customerId (the rules require `== task.customerId`); a task with
    // none cannot carry a client-visible comment at all.
    const task = (rawTasks || []).find(t => t.id === taskId);
    const customerId = opts?.visibleToClient ? (task as any)?.customerId : undefined;
    return commentMutation.create({
      taskId,
      content,
      ...(customerId ? { customerId, senderType: 'team' } : {}),
    } as any);
  };

  const handleEditComment = async (commentId: string, content: string) => {
    await commentMutation.update(commentId, { content, edited: true });
  };

  const handleDeleteComment = async (commentId: string) => {
    await commentMutation.remove(commentId);
  };

  const handleToggleReaction = async (commentId: string, emoji: string) => {
    if (!user?.uid) return;
    const c = comments?.find(x => x.id === commentId);
    // Never fail silently: a reaction on someone else's comment is a rules-level
    // write (see the `reactions`-only branch on taskComments), so a stale rules
    // deploy shows up as nothing happening at all unless we say so.
    try {
      await commentMutation.update(commentId, reactionTogglePatch(c as any, emoji, user.uid) as any);
    } catch (err: any) {
      toast({ title: 'Reagimi nuk u ruajt', description: err?.message || 'Provo përsëri.', variant: 'destructive' });
    }
  };

  return { handleAddComment, handleEditComment, handleDeleteComment, handleToggleReaction };
}
