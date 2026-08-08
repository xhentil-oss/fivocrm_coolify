/**
 * Same-day workload detection for task assignment.
 *
 * When you assign a task to someone on a date where that person already has work,
 * the UI asks for confirmation instead of silently stacking another task on the
 * same day. Pure logic (no Firestore) so it can be unit-tested and reused by any
 * create/edit path.
 */

/** Start-of-day timestamp (local time) for anything Firestore may hand us
 * (Date, ISO string, ms number). Returns null for missing/invalid values. */
export function startOfDay(value: any): number | null {
  if (value === null || value === undefined || value === '') return null;
  const d = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Minimal shape needed to detect a same-day conflict — keeps the helper usable
 * with `Task`, a draft, or any partial record. */
export interface SchedulableTask {
  id?: string;
  title?: string;
  status?: string;
  startDate?: any;
  endDate?: any;
  assignedToUserId?: string;
  parentTaskId?: string;
}

export interface SameDayOptions {
  /** Who the new task is being assigned to. */
  assigneeId?: string;
  /** The date being scheduled (usually the due date). */
  date: any;
  /** Task being edited — never conflicts with itself. */
  excludeTaskId?: string;
  /** Completed work is not a scheduling conflict; pass true to count it anyway. */
  includeDone?: boolean;
}

/**
 * Tasks already assigned to `assigneeId` that occupy the calendar day of `date`.
 *
 * A task occupies every day of its start→due range (a task running Mon–Wed
 * conflicts with Tuesday too), and a task with only one of the two dates
 * occupies that single day. Undated tasks never conflict.
 */
export function findSameDayTasks<T extends SchedulableTask>(
  tasks: T[] | null | undefined,
  { assigneeId, date, excludeTaskId, includeDone = false }: SameDayOptions
): T[] {
  const target = startOfDay(date);
  if (target === null || !assigneeId) return [];

  return (tasks || [])
    .filter(t => {
      if (!t) return false;
      if (excludeTaskId && t.id === excludeTaskId) return false;
      if (t.assignedToUserId !== assigneeId) return false;
      if (!includeDone && t.status === 'Done') return false;

      const start = startOfDay(t.startDate);
      const end = startOfDay(t.endDate);
      if (start === null && end === null) return false;
      const from = Math.min(start ?? end!, end ?? start!);
      const to = Math.max(start ?? end!, end ?? start!);
      return target >= from && target <= to;
    })
    .sort((a, b) => (startOfDay(a.endDate) ?? startOfDay(a.startDate) ?? 0) - (startOfDay(b.endDate) ?? startOfDay(b.startDate) ?? 0));
}
