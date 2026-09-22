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

export interface TaskAssignedNotification {
  userId: string;
  type: 'task_assigned';
  title: string;
  message: string;
  isRead: boolean;
  actionUrl: string;
  actionLabel: string;
}

/**
 * Re-assignment rows: the NEW assignee hears they got the task, the PREVIOUS one
 * hears it moved. The actor never notifies themselves. Used by the detail panel
 * and by the bulk "Cakto te" bar — the bar used to reassign in silence.
 */
export function taskAssignedNotifications(
  task: Task,
  newUserId: string,
  actorUid: string,
  opts: { actorName?: string; newAssigneeName?: string } = {},
): TaskAssignedNotification[] {
  const prev = task.assignedToUserId;
  if (!newUserId || newUserId === prev) return [];
  const link = taskDeepLink(task.id, task.projectId);
  const rows: TaskAssignedNotification[] = [];
  if (newUserId !== actorUid) {
    rows.push({
      userId: newUserId,
      type: 'task_assigned',
      title: 'Detyrë e Re e Caktuar',
      message: `${opts.actorName || 'Dikush'} ju caktoi detyrën: ${task.title}`,
      isRead: false,
      actionUrl: link,
      actionLabel: 'Shiko Detyrën',
    });
  }
  if (prev && prev !== newUserId && prev !== actorUid) {
    rows.push({
      userId: prev,
      type: 'task_assigned',
      title: 'Detyrë e Ri-caktuar',
      message: `Detyra "${task.title}" u ri-caktua te ${opts.newAssigneeName || 'një koleg'}`,
      isRead: false,
      actionUrl: link,
      actionLabel: 'Shiko Detyrën',
    });
  }
  return rows;
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
