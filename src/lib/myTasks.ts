// "Detyrat e mia" — the personal daily work view (/app/my-tasks).
//
// Pure bucketing logic, unit-tested in myTasks.test.ts. Every day comparison is
// a Europe/Tirane calendar day (src/lib/taskDue.ts) and every order is one of the
// shared total orders in src/lib/taskSort.ts — this module never re-derives
// "overdue" or "today" with instant math or machine-local midnight.

import type { Task } from '../types';
import { dayDiffFromToday, isTaskCompletedToday } from './taskDue';
import {
  taskDueMs,
  taskCompletedMs,
  compareTasksByDue,
  compareTasksByPriorityThenDue,
  compareTaskIds,
} from './taskSort';
import { zonedParts, zonedDate, addZonedDays, RECURRENCE_STOPPING_PROJECT_STATUSES } from './recurringUtils';

export type MyTaskBucket = 'overdue' | 'today' | 'tomorrow' | 'thisWeek' | 'later' | 'noDate';

/** Display order + Albanian labels of the buckets. */
export const MY_TASK_BUCKETS: ReadonlyArray<{ key: MyTaskBucket; label: string }> = [
  { key: 'overdue', label: 'Të vonuara' },
  { key: 'today', label: 'Sot' },
  { key: 'tomorrow', label: 'Nesër' },
  { key: 'thisWeek', label: 'Këtë javë' },
  { key: 'later', label: 'Më vonë' },
  { key: 'noDate', label: 'Pa afat' },
];

/**
 * The ids a person's tasks may carry: the uid AND the email — legacy teamMembers
 * rows keyed by email leaked email values into `assignedToUserId` (same reason
 * as useRoleFilteredData / StaffDashboard).
 */
export function myTaskIds(user: { uid?: string | null; email?: string | null } | null | undefined): string[] {
  if (!user?.uid) return [];
  return [user.uid, user.email].filter((v): v is string => !!v);
}

type Ids = ReadonlyArray<string> | ReadonlySet<string>;
const has = (ids: Ids, v: string) => (ids instanceof Set ? ids.has(v) : (ids as ReadonlyArray<string>).includes(v));

/** The task's assignee is me. */
export function isAssignedToMe(task: Pick<Task, 'assignedToUserId'>, ids: Ids): boolean {
  return !!task.assignedToUserId && has(ids, task.assignedToUserId);
}

/** I am a collaborator on someone else's task (not its assignee). */
export function isCollaborationOnly(task: Pick<Task, 'assignedToUserId' | 'collaboratorIds'>, ids: Ids): boolean {
  if (isAssignedToMe(task, ids)) return false;
  // Legacy rows store collaboratorIds as a non-array (string / map) — never trust the shape.
  const collab: unknown = task.collaboratorIds;
  return Array.isArray(collab) && collab.some(id => typeof id === 'string' && has(ids, id));
}

/**
 * Projects whose tasks are dead work (archived / cancelled) — the same statuses
 * that stop recurrence and billing. Their tasks must not count as overdue or
 * due today, or a shelved project keeps the list red forever (StaffDashboard).
 */
export function deadProjectIdsOf(projects: ReadonlyArray<{ id: string; status?: string | null }> | null | undefined): Set<string> {
  return new Set(
    (projects || [])
      .filter(p => !!p.status && RECURRENCE_STOPPING_PROJECT_STATUSES.includes(p.status))
      .map(p => p.id),
  );
}

export function isLiveTask(task: Pick<Task, 'projectId'>, deadProjectIds: ReadonlySet<string>): boolean {
  return !task.projectId || !deadProjectIds.has(task.projectId);
}

/**
 * Whole Tirane days from today to the last day (Sunday) of the current week
 * (Mon–Sun, the Albanian week). Monday → 6, Sunday → 0.
 */
export function daysLeftInWeek(now: number = Date.now()): number {
  const wd = zonedParts(new Date(now)).weekday; // 0 = Sunday
  return wd === 0 ? 0 : 7 - wd;
}

/** Which bucket an OPEN task falls into, in Tirane calendar days. */
export function bucketOf(task: Pick<Task, 'endDate' | 'dueDate'>, now: number = Date.now()): MyTaskBucket {
  const diff = dayDiffFromToday(taskDueMs(task), now);
  if (diff === null) return 'noDate';
  if (diff < 0) return 'overdue';
  if (diff === 0) return 'today';
  if (diff === 1) return 'tomorrow';
  if (diff <= daysLeftInWeek(now)) return 'thisWeek';
  return 'later';
}

/** Order inside each bucket. Overdue: oldest first. Today/tomorrow: urgent first. */
export const BUCKET_COMPARATORS: Record<MyTaskBucket, (a: Task, b: Task) => number> = {
  overdue: compareTasksByDue,
  today: compareTasksByPriorityThenDue,
  tomorrow: compareTasksByPriorityThenDue,
  thisWeek: compareTasksByDue,
  later: compareTasksByDue,
  // No deadline at all: priority, then id (compareTasksByDue on two nulls = id).
  noDate: compareTasksByPriorityThenDue,
};

export interface MyTasksOptions {
  /** uid (+ email) — see `myTaskIds`. */
  myIds: Ids;
  /** Projects that are archived/cancelled — see `deadProjectIdsOf`. */
  deadProjectIds?: ReadonlySet<string>;
  /** Also show tasks where I am only a collaborator. */
  includeCollaborations?: boolean;
  now?: number;
}

export interface MyTasksSummary {
  /** Open tasks assigned to me due today. */
  today: number;
  /** Open tasks assigned to me whose deadline day has passed. */
  overdue: number;
  /** Σ estimatedHours of today's open tasks assigned to me. */
  estimatedHoursToday: number;
  /** Tasks assigned to me completed on today's Tirane day. */
  completedToday: number;
}

export interface MyTasksResult {
  buckets: Record<MyTaskBucket, Task[]>;
  /** Done today (newest first) — the collapsible "Përfunduar sot". */
  completedToday: Task[];
  /** Ids of rows shown only because I collaborate on them. */
  collaborationIds: Set<string>;
  /** Number of open collaboration tasks (shown on the toggle even when it is off). */
  collaborationCount: number;
  summary: MyTasksSummary;
}

const emptyBuckets = (): Record<MyTaskBucket, Task[]> => ({
  overdue: [], today: [], tomorrow: [], thisWeek: [], later: [], noDate: [],
});

/**
 * The whole view in one pass: open tasks bucketed by deadline day, today's
 * completions, and the summary. The summary counts only tasks ASSIGNED to me, so
 * it does not jump when the collaboration toggle is flipped.
 */
export function buildMyTasks(tasks: ReadonlyArray<Task> | null | undefined, opts: MyTasksOptions): MyTasksResult {
  const now = opts.now ?? Date.now();
  const dead = opts.deadProjectIds ?? new Set<string>();
  const buckets = emptyBuckets();
  const completedToday: Task[] = [];
  const collaborationIds = new Set<string>();
  let collaborationCount = 0;
  const summary: MyTasksSummary = { today: 0, overdue: 0, estimatedHoursToday: 0, completedToday: 0 };

  for (const t of tasks || []) {
    if (!t || !isLiveTask(t, dead)) continue;
    const mine = isAssignedToMe(t, opts.myIds);
    const collab = !mine && isCollaborationOnly(t, opts.myIds);
    if (!mine && !collab) continue;

    if (t.status === 'Done') {
      if (!isTaskCompletedToday(t, now)) continue;
      if (mine) summary.completedToday++;
      if (mine || opts.includeCollaborations) {
        completedToday.push(t);
        if (collab) collaborationIds.add(t.id);
      }
      continue;
    }

    if (collab) collaborationCount++;
    const bucket = bucketOf(t, now);
    if (mine) {
      if (bucket === 'today') {
        summary.today++;
        const h = Number(t.estimatedHours);
        if (Number.isFinite(h) && h > 0) summary.estimatedHoursToday += h;
      } else if (bucket === 'overdue') {
        summary.overdue++;
      }
    }
    if (collab && !opts.includeCollaborations) continue;
    if (collab) collaborationIds.add(t.id);
    buckets[bucket].push(t);
  }

  for (const { key } of MY_TASK_BUCKETS) buckets[key].sort(BUCKET_COMPARATORS[key]);
  completedToday.sort((a, b) => (taskCompletedMs(b) ?? 0) - (taskCompletedMs(a) ?? 0) || compareTaskIds(a, b));
  summary.estimatedHoursToday = Math.round(summary.estimatedHoursToday * 100) / 100;

  return { buckets, completedToday, collaborationIds, collaborationCount, summary };
}

/** Default working hours used for a deadline picked as a bare day (quick add). */
export const QUICK_ADD_START_HOUR = 9;
export const QUICK_ADD_END_HOUR = 17;

/**
 * "Shtyje → nesër": the new deadline is TOMORROW (Tirane) at the task's own
 * time of day; an undated task gets 17:00. Calendar step, so a DST night never
 * shifts the hour.
 */
export function snoozeToTomorrowDate(task: Pick<Task, 'endDate' | 'dueDate'>, now: number = Date.now()): Date {
  const tomorrow = zonedParts(addZonedDays(new Date(now), 1));
  const dueMs = taskDueMs(task);
  if (dueMs === null) return zonedDate(tomorrow.year, tomorrow.month, tomorrow.day, QUICK_ADD_END_HOUR, 0);
  const t = zonedParts(new Date(dueMs));
  return zonedDate(tomorrow.year, tomorrow.month, tomorrow.day, t.hours, t.minutes);
}

/**
 * Start/end for a quick-added task from an `<input type="date">` value
 * (`YYYY-MM-DD`), as Tirane wall-clock 09:00–17:00. Empty/invalid → undated.
 */
export function quickAddDates(dayValue: string | null | undefined): { startDate?: Date; endDate?: Date } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((dayValue || '').trim());
  if (!m) return {};
  const y = Number(m[1]), mo = Number(m[2]) - 1, d = Number(m[3]);
  if (mo < 0 || mo > 11 || d < 1 || d > 31) return {};
  return {
    startDate: zonedDate(y, mo, d, QUICK_ADD_START_HOUR, 0),
    endDate: zonedDate(y, mo, d, QUICK_ADD_END_HOUR, 0),
  };
}

/** `YYYY-MM-DD` of today / tomorrow in Tirane — values for the quick-add date chips. */
export function tiraneDayValue(offsetDays = 0, now: number = Date.now()): string {
  const p = zonedParts(addZonedDays(new Date(now), offsetDays));
  return `${p.year}-${String(p.month + 1).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** Short relative label for a row's deadline ("Sot 17:00", "2d vonuar", "Nesër", "24 tet"). */
export function dueLabel(task: Pick<Task, 'endDate' | 'dueDate'>, now: number = Date.now()): string {
  const ms = taskDueMs(task);
  if (ms === null) return '';
  const diff = dayDiffFromToday(ms, now)!;
  const p = zonedParts(new Date(ms));
  const hhmm = `${String(p.hours).padStart(2, '0')}:${String(p.minutes).padStart(2, '0')}`;
  const time = p.hours === 0 && p.minutes === 0 ? '' : ` ${hhmm}`;
  if (diff < 0) return `${Math.abs(diff)}d vonuar`;
  if (diff === 0) return `Sot${time}`;
  if (diff === 1) return `Nesër${time}`;
  const months = ['jan', 'shk', 'mar', 'pri', 'maj', 'qer', 'kor', 'gus', 'sht', 'tet', 'nën', 'dhj'];
  return `${p.day} ${months[p.month]}`;
}
