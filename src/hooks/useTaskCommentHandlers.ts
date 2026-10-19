import { useAuth } from '../contexts/AuthContext';
import { useMutation } from './useFirestore';
import { toast } from './use-toast';
import type { Task, TaskComment } from '../types';

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
    // explicitly marked the comment client-visible.
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
    const current: Record<string, string[]> = { ...((c as any)?.reactions || {}) };
    const arr = Array.isArray(current[emoji]) ? [...current[emoji]] : [];
    const i = arr.indexOf(user.uid);
    if (i >= 0) arr.splice(i, 1); else arr.push(user.uid);
    if (arr.length) current[emoji] = arr; else delete current[emoji];
    // Never fail silently: a reaction on someone else's comment is a rules-level
    // write (see the `reactions`-only branch on taskComments), so a stale rules
    // deploy shows up as nothing happening at all unless we say so.
    try {
      await commentMutation.update(commentId, { reactions: current } as any);
    } catch (err: any) {
      toast({ title: 'Reagimi nuk u ruajt', description: err?.message || 'Provo përsëri.', variant: 'destructive' });
    }
  };

  return { handleAddComment, handleEditComment, handleDeleteComment, handleToggleReaction };
}
