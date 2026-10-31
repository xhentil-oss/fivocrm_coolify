// Pure decisions of the task detail panel (no React, no Firestore) — extracted
// so the audit fixes of Oct 2026 (B2/B3/B4/B5/B9/B10/B12/C15) are unit-tested.
import type { Task } from '../../../types';

type DateLike = Date | { toDate: () => Date } | string | number | null | undefined;

const toDate = (v: DateLike): Date | null => {
  if (!v) return null;
  const d = v instanceof Date ? v
    : typeof (v as any)?.toDate === 'function' ? (v as any).toDate()
    : new Date(v as any);
  return isNaN(d.getTime()) ? null : d;
};

/** A typed title is one line: Enter is captured, but paste is not — strip
 *  every line break (and collapse the surrounding whitespace) on the way in. */
export const sanitizeTitleInput = (raw: string): string => raw.replace(/\s*[\r\n]+\s*/g, ' ');

/**
 * What a title edit must write: the TRIMMED draft when it differs from the
 * stored title, nothing when it is empty or unchanged. The blur save used to
 * write the untrimmed draft while `dirty` compared the trimmed one, so a
 * trailing space from a mobile keyboard left "Ruaj" lit forever.
 */
export const titlePatch = (draft: string, current: string): { title: string } | null => {
  const t = draft.trim();
  if (!t || t === current) return null;
  return { title: t };
};

/** The deadline tile/value turn red only for a LIVE task — a Done task with an
 *  old deadline is finished, not late (the list never calls Done "vonuar"). */
export const isDueUrgent = (endDate: Date | null, status: string | undefined, now: Date = new Date()): boolean => {
  if (!endDate || status === 'Done') return false;
  return endDate.getTime() < now.getTime() || endDate.toDateString() === now.toDateString();
};

/**
 * "Dupliko": a fresh Todo with the same plan and none of the history. Dates are
 * copied only while they are still in the FUTURE — a verbatim copy of a past
 * deadline was born overdue (and `task-deadline-alerts` notified at once). A
 * duplicated subtask stays a subtask of the same parent, and a subtask never
 * carries `customerId` (the portal-visibility switch; the portal never shows
 * subtasks). `undefined` fields are dropped by the mutation layer.
 */
export const duplicateTaskDraft = (task: Task, now: Date = new Date()): Record<string, unknown> => {
  const start = toDate(task.startDate);
  const end = toDate(task.endDate);
  const endIsFuture = !!end && end.getTime() > now.getTime();
  const startIsFuture = !!start && start.getTime() > now.getTime();
  const t = task as any;
  return {
    title: `${task.title} (kopje)`,
    description: task.description || undefined,
    status: 'Todo',
    priority: task.priority,
    projectId: task.projectId || undefined,
    parentTaskId: task.parentTaskId || undefined,
    customerId: task.parentTaskId ? null : (task.customerId || undefined),
    assignedToUserId: task.assignedToUserId || undefined,
    startDate: startIsFuture ? start : undefined,
    endDate: endIsFuture ? end : undefined,
    labels: t.labels?.length ? [...t.labels] : undefined,
    section: task.section || undefined,
    estimatedHours: task.estimatedHours,
    dependsOn: task.dependsOn?.length ? [...task.dependsOn] : undefined,
    serviceLabel: task.serviceLabel,
    serviceId: task.serviceId,
    dueNotificationSent: false,
  };
};

/**
 * Who may DRIVE a recurring series (rules, Oct 2026): the engine flags
 * (`nextCycleCreated`, `recurringSkippedReason`, `reminderSentAt`,
 * `dueNotificationSent`, `overdueNotificationSent`) are changed only by the
 * task's assignee, its creator, Admin/Manager or a super-admin; other staff may
 * only RE-ARM the deadline alerts. Completing a recurring task claims the next
 * cycle, re-opening a Done tip or extending an ended series re-arms it — all
 * denied for anyone else, so the panel gates them up front.
 */
export const canDriveTaskSeries = (
  task: Pick<Task, 'assignedToUserId' | 'createdByUserId'>,
  who: { uid: string | undefined; isAdmin: boolean; isManager: boolean },
): boolean => {
  if (who.isAdmin || who.isManager) return true;
  if (!who.uid) return false;
  return task.assignedToUserId === who.uid || task.createdByUserId === who.uid;
};

export const SERIES_LOCK_NOTE = 'Vetëm përgjegjësi, krijuesi ose një menaxher mund ta mbyllë ose rihapë këtë seri.';

/** Status options the pill must not offer for a recurring task the user may not
 *  drive: Done (claims the next cycle) on a live tip, every re-open on a Done one. */
export const lockedStatusesFor = (task: Pick<Task, 'isRecurring' | 'status'>, canDrive: boolean, all: readonly string[]): string[] => {
  if (!task.isRecurring || canDrive) return [];
  return task.status === 'Done' ? all.filter(s => s !== 'Done') : ['Done'];
};

/** May this user duplicate the task? Without `canAssignTasks` the copy would be
 *  assigned to someone else and the rules refuse it — hide the dead action. */
export const canDuplicateTask = (task: Pick<Task, 'assignedToUserId'>, opts: { readOnly: boolean; canAssignTasks: boolean; uid: string | undefined }): boolean => {
  if (opts.readOnly) return false;
  if (opts.canAssignTasks) return true;
  return !task.assignedToUserId || task.assignedToUserId === opts.uid;
};

/**
 * The origin a copied link must carry. Inside the Capacitor app
 * `window.location.origin` is `https://localhost`, which nobody can open — the
 * public web origin (the one the API base points at) is used there.
 */
export const shareOrigin = (isNative: boolean, windowOrigin: string, publicOrigin: string): string =>
  (isNative || !/^https?:\/\//i.test(windowOrigin) ? publicOrigin : windowOrigin).replace(/\/$/, '');

const DAY_NAMES_SHORT = ['Die', 'Hën', 'Mar', 'Mër', 'Enj', 'Pre', 'Sht'];
const DAY_NAMES = ['Diel', 'Hënë', 'Martë', 'Mërkurë', 'Enjte', 'Premte', 'Shtunë'];

/** Human description of the series ("Çdo javë, Hënë"). A weekly series with no
 *  stored weekday is described without one — it used to claim "Diel". */
export const describeRecurrence = (task: Task): string => {
  const n = task.recurringInterval ?? 1;
  const t = task as any;
  switch (task.recurringFrequency) {
    case 'daily': {
      const days = t.recurringDaysOfWeek as number[] | undefined;
      return days && days.length > 0 && days.length < 7 ? `Çdo ${days.map(d => DAY_NAMES_SHORT[d]).join(', ')}` : 'Çdo ditë';
    }
    case 'weekly': {
      const every = `Çdo ${n > 1 ? `${n} javë` : 'javë'}`;
      const dow = t.recurringDayOfWeek;
      return typeof dow === 'number' && DAY_NAMES[dow] ? `${every}, ${DAY_NAMES[dow]}` : every;
    }
    case 'monthly':
      return `Çdo ${n > 1 ? `${n} muaj` : 'muaj'}, ditën ${t.recurringDayOfMonth ?? 1}`;
    case 'yearly':
      return `Çdo ${n > 1 ? `${n} vite` : 'vit'}`;
    default:
      return 'Përsëritet';
  }
};

export interface SubtaskEditForm {
  title: string;
  description: string;
  status: string;
  priority: string;
  startDate: Date | null;
  endDate: Date | null;
  assignedToUserId: string;
}

/**
 * The subtask edit form writes ONLY what changed. A date the form shows as
 * empty is written as `null` (never today's date), and an emptied assignee as
 * `null` (never `''`). `undefined` would be stripped by removeUndefined() and
 * clear nothing.
 */
export const subtaskEditPatch = (sub: Task, form: SubtaskEditForm): Record<string, unknown> => {
  const patch: Record<string, unknown> = {};
  const title = form.title.trim();
  if (title && title !== sub.title) patch.title = title;
  if ((form.description || '') !== (sub.description || '')) patch.description = form.description;
  if (form.status !== sub.status) patch.status = form.status;
  if (form.priority !== (sub.priority as string | undefined)) patch.priority = form.priority;
  const sameDate = (a: Date | null, b: Date | null) => (a?.getTime() ?? null) === (b?.getTime() ?? null);
  const prevStart = toDate(sub.startDate);
  const prevEnd = toDate(sub.endDate);
  if (!sameDate(form.startDate, prevStart)) patch.startDate = form.startDate;
  if (!sameDate(form.endDate, prevEnd)) patch.endDate = form.endDate;
  const assignee = form.assignedToUserId || null;
  if (assignee !== (sub.assignedToUserId || null)) patch.assignedToUserId = assignee;
  return patch;
};

/**
 * The footer's "Ndryshuar …" line. The task document carries no updater id and
 * `updatedAt` moves on cron writes too (alarm flags, rollups), so a human edit
 * is claimed only from a reliable signal: `updatedByUserId` when a writer
 * stamped it, else the newest ACTIVITY row written by a person. With neither
 * (no activity logged for this task) the legacy `updatedAt − createdAt > 60 s`
 * heuristic stays — a plain title edit logs no activity, so an empty list
 * proves nothing either way.
 */
export const lastHumanEdit = (
  task: Pick<Task, 'updatedAt' | 'createdAt'> & { updatedByUserId?: string | null },
  activities: Array<{ createdByUserId?: string | null; createdAt?: DateLike }> | null | undefined,
): { byUserId: string | null; at: Date } | null => {
  const updatedAt = toDate(task.updatedAt as DateLike);
  const createdAt = toDate(task.createdAt as DateLike);
  if (task.updatedByUserId && updatedAt) return { byUserId: task.updatedByUserId, at: updatedAt };
  const human = (activities || [])
    .filter(a => !!a.createdByUserId && !!toDate(a.createdAt))
    .sort((a, b) => toDate(b.createdAt)!.getTime() - toDate(a.createdAt)!.getTime())[0];
  if (human) {
    const at = toDate(human.createdAt)!;
    // An activity older than the creation is impossible; the create itself is not an edit.
    if (!createdAt || at.getTime() - createdAt.getTime() > 60_000) return { byUserId: human.createdByUserId!, at };
    return null;
  }
  // No reliable signal (see above): keep the legacy heuristic.
  if (updatedAt && createdAt && updatedAt.getTime() - createdAt.getTime() > 60_000) return { byUserId: null, at: updatedAt };
  return null;
};
