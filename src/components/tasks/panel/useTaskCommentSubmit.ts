import { useMutation } from '../../../hooks/useFirestore';
import { useAuth } from '../../../contexts/AuthContext';
import { toast } from '../../../hooks/use-toast';
import { resolvePortalUserId } from '../../../lib/notifyClient';
import { commentMentionUids, commentToPlainText } from '../../../lib/commentMarkdown';
import { taskDeepLink, portalProjectCommentDeepLink } from '../../../lib/deepLinks';
import type { Task, TaskComment } from '../../../types';

/** Two quick "rib-bit" pulses — the comment-sent chirp (Web Audio, no asset). */
function playFrogSound() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const playRibbit = (startTime: number) => {
      // Frequency sweep: high → low (the "rib" part)
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(900, startTime);
      osc1.frequency.exponentialRampToValueAtTime(300, startTime + 0.12);
      gain1.gain.setValueAtTime(0, startTime);
      gain1.gain.linearRampToValueAtTime(0.18, startTime + 0.01);
      gain1.gain.exponentialRampToValueAtTime(0.001, startTime + 0.13);
      osc1.start(startTime);
      osc1.stop(startTime + 0.14);

      // Second harmonic for texture
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(1600, startTime);
      osc2.frequency.exponentialRampToValueAtTime(600, startTime + 0.10);
      gain2.gain.setValueAtTime(0, startTime);
      gain2.gain.linearRampToValueAtTime(0.07, startTime + 0.01);
      gain2.gain.exponentialRampToValueAtTime(0.001, startTime + 0.11);
      osc2.start(startTime);
      osc2.stop(startTime + 0.12);
    };
    // Two quick "rib-bit" pulses
    playRibbit(ctx.currentTime);
    playRibbit(ctx.currentTime + 0.18);
  } catch {
    // Audio not supported — fail silently
  }
}

interface UseTaskCommentSubmitArgs {
  task: Task;
  comments: TaskComment[];
  readOnly: boolean;
  onAddComment: (taskId: string, content: string, opts?: { visibleToClient?: boolean }) => void | Promise<any>;
  commentVisibleToClient: boolean;
  setCommentVisibleToClient: (v: boolean) => void;
}

/**
 * Posting a task comment (extracted verbatim from TaskDetailPanel): save first,
 * then the follower update, mention / participant notifications and — only for
 * an explicitly client-visible reply — the portal client.
 */
export function useTaskCommentSubmit({
  task,
  comments,
  readOnly,
  onAddComment,
  commentVisibleToClient,
  setCommentVisibleToClient,
}: UseTaskCommentSubmitArgs) {
  const { user } = useAuth();
  const taskMutation = useMutation<Task>('tasks');
  const notificationMutation = useMutation<any>('notifications');

  /** Resolves true once the comment is SAVED (the composer then clears) — a
   *  failed follower update afterwards must not keep the text for a duplicate send. */
  const handleAddCommentSubmit = async (text: string): Promise<boolean> => {
    // The composer already writes mentions as @[Name](uid) (lib/commentMarkdown).
    const finalText = text.trim();
    if (!finalText) return false;
    const mentionedUids = new Set<string>(commentMentionUids(finalText));
    let saved = false;

    // Captured BEFORE the save: the checkbox resets right after it.
    const clientVisible = commentVisibleToClient && !!(task as any).customerId;
    try {
      // Save comment first — then notify. The created id (when the parent hands it
      // back) turns every notification below into a link to THIS comment, not just
      // to the task.
      const created = await onAddComment(task.id, finalText, {
        visibleToClient: clientVisible,
      });
      saved = true;
      const newCommentId: string | undefined = (created as any)?.id;
      const commentLink = taskDeepLink(task.id, task.projectId, newCommentId);
      const taskLabel = task.projectId ? 'Shiko Detyrën' : 'Shiko Detyrat';
      setCommentVisibleToClient(false);
      playFrogSound();

      // Portal clients who commented on this task. They are reached ONLY by the
      // explicit client-visible branch at the end — never by mentions,
      // follower pings or the participant fan-out (see THE CLIENT BOUNDARY).
      const portalUids = new Set<string>();
      comments.forEach(c => {
        if ((c as any).senderType === 'client') {
          if (c.userId) portalUids.add(c.userId);
          if (c.createdByUserId) portalUids.add(c.createdByUserId);
        }
      });
      const mentionedArray = [...mentionedUids].filter(uid => uid !== user?.uid && !portalUids.has(uid));

      // Followers model (Asana / Linear / Salesforce Chatter): the people who get
      // notified on a record are its *followers*, not the whole team. You become a
      // follower by being assigned, @mentioned, or by commenting. `collaboratorIds`
      // is that follower list here.
      const currentCollaboratorIds: string[] = Array.isArray((task as any).collaboratorIds)
        ? (task as any).collaboratorIds
        : [];
      const wantedCollaborators = mentionedArray.filter(uid => !currentCollaboratorIds.includes(uid));
      // Commenting auto-follows YOU (so future replies reach you) — but you don't get
      // an "added as collaborator" ping for your own action.
      const senderFollows = !!user?.uid && !currentCollaboratorIds.includes(user.uid) && !wantedCollaborators.includes(user.uid);
      const collaboratorAdditions = [...wantedCollaborators, ...(senderFollows ? [user!.uid] : [])];
      // The follower write is a TASK update: a read-only panel (Viewer, guest) is
      // denied it by the rules, and the old code let that throw into the outer
      // catch — which returned before a single notification went out, so a
      // Viewer's comment notified nobody. Skip it there, and contain any other
      // failure: the comment is saved and must still be announced. When the
      // write did not happen, the mentioned people get the plain mention ping.
      let newCollaborators: string[] = [];
      if (collaboratorAdditions.length > 0 && !readOnly) {
        try {
          await taskMutation.update(task.id, {
            collaboratorIds: [...currentCollaboratorIds, ...collaboratorAdditions],
          });
          newCollaborators = wantedCollaborators;
        } catch (err) {
          console.warn('[Tasks] ndjekësit e detyrës nuk u përditësuan:', err);
        }
      }
      if (newCollaborators.length > 0) {
        // Notify newly-mentioned staff they now follow (and can see) the task.
        // allSettled everywhere below: the COMMENT is already saved. A rejected
        // notification must not land in the outer catch, which discards the comment
        // text as if the save had failed.
        await Promise.allSettled(newCollaborators.map(uid =>
          notificationMutation.create({
            userId: uid,
            type: 'task_collaborator_added',
            title: '📋 Shtuar si Bashkëpunëtor',
            message: `${user?.displayName || 'Dikush'} ju shtoi si bashkëpunëtor në detyrën: "${task.title}"`,
            isRead: false,
            actionUrl: commentLink,
            actionLabel: taskLabel,
          })
        ));
      }

      // Notify everyone mentioned who didn't already get the "added as collaborator" notification
      const alreadyNotified = new Set(newCollaborators);
      const senderName = user?.displayName || user?.email?.split('@')[0] || 'Dikush';
      const mentionNotifPromises = mentionedArray
        .filter(uid => !alreadyNotified.has(uid))
        .map(uid => notificationMutation.create({
          userId: uid,            // ← goes to RECIPIENT (mentioned person), never sender
          type: 'task_mention',
          title: `💬 ${senderName} ju përmendi`,
          message: `Në detyrën: "${task.title}"`,
          isRead: false,
          actionUrl: commentLink,
          actionLabel: taskLabel,
        }));
      await Promise.allSettled(mentionNotifPromises);

      // Notify the task's participants (assignee, creator, collaborators, previous
      // commenters) about the new comment — so a comment never goes unseen. Excludes
      // the sender and anyone already notified above (mentions/new collaborators), so
      // no one gets a double ping. This is scoped to people involved in the task, not
      // the whole team, to avoid notification spam.
      //
      // THE CLIENT BOUNDARY: portal users are only ever reached through the
      // explicit client-visible branch below. Staff comments carry their author
      // in `createdByUserId` (stamped by useMutation); only PORTAL comments carry
      // `userId` (senderType 'client'). Collecting `c.userId` used to gather
      // exactly the portal clients and push/email them the text of INTERNAL
      // comments — while staff commenters were never collected at all.
      const excluded = new Set<string>(
        [user?.uid, ...mentionedArray, ...newCollaborators].filter(Boolean) as string[],
      );
      const participantIds = new Set<string>();
      if (task.assignedToUserId) participantIds.add(task.assignedToUserId);
      if (task.createdByUserId) participantIds.add(task.createdByUserId);
      currentCollaboratorIds.forEach(uid => participantIds.add(uid));
      comments.forEach(c => {
        if ((c as any).senderType === 'client') return;
        const author = c.createdByUserId || c.userId;
        if (author) participantIds.add(author);
      });

      const commentPreview = commentToPlainText(finalText).replace(/\s*\n\s*/g, ' ').slice(0, 120);
      const participantNotifPromises = [...participantIds]
        .filter(uid => !excluded.has(uid) && !portalUids.has(uid))
        .map(uid => notificationMutation.create({
          userId: uid,
          type: 'task_comment',
          title: `💬 Koment i ri nga ${senderName}`,
          message: `"${task.title}": ${commentPreview}`,
          isRead: false,
          actionUrl: commentLink,
          actionLabel: taskLabel,
        }));
      await Promise.allSettled(participantNotifPromises);

      // A CLIENT-VISIBLE reply is the one case the client hears about it — via
      // the portal login resolved from the task's customerId, on the portal
      // project page (the only place the client can read task comments).
      if (clientVisible && task.projectId) {
        try {
          const portalUid = await resolvePortalUserId((task as any).customerId);
          if (portalUid && portalUid !== user?.uid) {
            await notificationMutation.create({
              userId: portalUid,
              type: 'project_comment',
              title: `💬 Përgjigje nga ekipi — ${task.title}`,
              message: commentPreview,
              isRead: false,
              actionUrl: portalProjectCommentDeepLink(task.projectId, newCommentId),
              actionLabel: 'Shiko Komentin',
            });
          }
        } catch (err) {
          console.error('[Notifications] njoftimi i klientit për komentin dështoi:', err);
        }
      }
      return true;
    } catch (err: any) {
      if (saved) {
        // The comment exists; only the follower update failed. Clearing the
        // composer is right — keeping the text invites a duplicate.
        console.error('[Tasks] komenti u ruajt, ndjekësit jo:', err);
        return true;
      }
      // Comment failed to save — keep the text so the user can retry, and SAY so.
      console.error('[Tasks] komenti nuk u ruajt:', err);
      toast({ title: 'Komenti nuk u ruajt', description: err?.message, variant: 'destructive' });
      return false;
    }
  };

  return handleAddCommentSubmit;
}
