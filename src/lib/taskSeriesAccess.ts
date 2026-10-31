// Who may act on a RECURRING task's series — the UI side of the rules.
//
// The engine flags on `tasks` (`nextCycleCreated`, `recurringSkippedReason`,
// `reminderSentAt`, `dueNotificationSent`, `overdueNotificationSent`) may be
// CHANGED only by the task's assignee, its creator, an Admin/Manager or a
// super-admin (firestore.rules, Oct 2026); any other non-Viewer staff may only
// re-arm them. Completing a recurring task writes `nextCycleCreated` through
// the claim transaction, and re-opening a Done tip writes it back — so for a
// plain Member who is neither assignee nor creator both are DENIED by the
// rules. These helpers let every surface refuse up front (and name the reason)
// instead of leaving the UI half-updated after a thrown write.

import type { Task } from '../types';

export interface SeriesActor {
  uid?: string | null;
  /** Legacy rows keep an email in `assignedToUserId` (see `myTaskIds`). */
  email?: string | null;
  isAdmin?: boolean;
  isManager?: boolean;
  isOwner?: boolean;
  isSuperAdmin?: boolean;
}

export const SERIES_DENIED_TITLE = 'Nuk ke të drejtë për këtë seri';
export const SERIES_DENIED_MESSAGE = 'Vetëm përgjegjësi ose menaxheri mund ta mbyllë këtë seri';

type SeriesTask = Pick<Task, 'isRecurring' | 'assignedToUserId' | 'createdByUserId'>;

/** Assignee, creator, Admin/Manager/owner or super-admin of the task. */
export function canManageTaskSeries(task: SeriesTask, actor: SeriesActor | null | undefined): boolean {
  if (!actor) return false;
  if (actor.isAdmin || actor.isManager || actor.isOwner || actor.isSuperAdmin) return true;
  const ids = [actor.uid, actor.email].filter((v): v is string => !!v);
  if (ids.length === 0) return false;
  return (!!task.assignedToUserId && ids.includes(task.assignedToUserId))
    || (!!task.createdByUserId && ids.includes(task.createdByUserId));
}

/**
 * True when completing / re-opening this task would be refused: it is a
 * recurring task and the actor is none of the people above. A non-recurring
 * task is never blocked here (its status change writes no engine flag).
 */
export function seriesActionBlocked(task: SeriesTask, actor: SeriesActor | null | undefined): boolean {
  return !!task.isRecurring && !canManageTaskSeries(task, actor);
}

/** A Firestore rules refusal (`permission-denied`), whatever wrapped it. */
export function isPermissionDenied(err: unknown): boolean {
  const e = err as { code?: unknown; message?: unknown } | null;
  if (!e) return false;
  if (e.code === 'permission-denied') return true;
  return typeof e.message === 'string' && /permission-denied|insufficient permissions/i.test(e.message);
}
