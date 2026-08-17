/**
 * Who hears about a task being completed, and what they receive.
 *
 * Closing a task was the most frequent silent mutation in the app: the assignee,
 * the creator and the collaborators learned about it only by looking. Every
 * completion surface (list toggle, quick-action, detail panel, kanban drag, the
 * dashboard checkbox) goes through `completeTask()` — and each of those callers
 * hands the outcome to this builder, so the recipient rule lives in ONE place.
 *
 * Rules:
 *   • The actor never notifies themselves.
 *   • Recipients: creator + assignee + collaborators, deduped.
 *   • The payload deep-links the task (`taskDeepLink`), so tapping the
 *     notification opens the task panel, not a bare list.
 *
 * Pure on purpose (no Firebase) — callers pass the rows to their own
 * `notificationMutation.create`, which stamps businessId and relays push+email.
 */

import { taskDeepLink } from './deepLinks';
import type { Task } from '../types';

export interface TaskCompletedNotification {
  userId: string;
  type: 'task_completed';
  title: string;
  message: string;
  isRead: boolean;
  actionUrl: string;
  actionLabel: string;
}

/** Everyone who should hear that `task` was closed by `actorUid`. */
export function taskCompletionRecipients(task: Task, actorUid: string): string[] {
  const targets = new Set<string>();
  if (task.createdByUserId) targets.add(task.createdByUserId);
  if (task.assignedToUserId) targets.add(task.assignedToUserId);
  for (const id of task.collaboratorIds || []) if (id) targets.add(id);
  targets.delete(actorUid);
  return [...targets];
}

/** One notification row per recipient. Empty when the actor closed their own solo task. */
export function taskCompletedNotifications(
  task: Task,
  actorUid: string,
  actorName?: string,
): TaskCompletedNotification[] {
  const link = taskDeepLink(task.id, task.projectId);
  return taskCompletionRecipients(task, actorUid).map(userId => ({
    userId,
    type: 'task_completed',
    title: `✅ Detyra u përfundua: ${task.title}`,
    message: actorName ? `${actorName} e mbylli detyrën.` : 'Detyra u shënua si e përfunduar.',
    isRead: false,
    actionUrl: link,
    actionLabel: 'Shiko Detyrën',
  }));
}
