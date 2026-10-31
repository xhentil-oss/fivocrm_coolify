// Pure helpers shared by the Tasks list, board and row components (extracted
// verbatim from TasksView — no behaviour change).
import { zonedParts } from '../../lib/recurringUtils';
import { taskDateMs } from '../../lib/taskSort';
import { dayDiffFromToday } from '../../lib/taskDue';
import type { Task } from '../../types';

/** Page size of the list view (flat and grouped). */
export const TASKS_PAGE_SIZE = 50;

/** Kanban columns, in display order. */
export const TASK_BOARD_COLUMNS = [
  { id: 'Todo', title: 'Për të bërë', status: 'Todo' },
  { id: 'In Progress', title: 'Në progres', status: 'In Progress' },
  { id: 'Review', title: 'Rishikim', status: 'Review' },
  { id: 'Done', title: 'Përfunduar', status: 'Done' },
] as const;

// "Is this overdue?" lives in src/lib/taskDue.ts (`isTaskOverdue`): the chip,
// the filter, the row, the board card and the groups all read the deadline
// through `taskDeadline` there — this module no longer has its own definition.

/** Generate a deterministic HSL background colour from a name string */
export function hashColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  const h = Math.abs(hash) % 360;
  return `hsl(${h}, 55%, 42%)`;
}

// Format a deadline compactly — always show the actual date; flag overdue with ⚠️.
// `deadline` is the STORED value (`taskDeadline(task)`: Date / Timestamp / ISO),
// `now` the instant (or `todayKey`) the Sot / Nesër / vonuar judgement is made at.
export const formatDateCompact = (deadline: unknown, status?: Task['status'], now: number = Date.now()) => {
  const ms = taskDateMs(deadline);
  if (ms === null) {
    return { text: 'Pa afat', overdue: false, className: 'text-muted-foreground' };
  }
  // Day and month read in Europe/Tirane — the zone every deadline is a promise
  // in — so a 23:30Z deadline is "20 Tet" on every browser, not "19 Tet" abroad.
  const p = zonedParts(new Date(ms));
  // Albanian month names — the UI is sq-AL, "May 5" amid Albanian labels was a leak.
  const months = ['Jan', 'Shk', 'Mar', 'Pri', 'Maj', 'Qer', 'Kor', 'Gush', 'Sht', 'Tet', 'Nën', 'Dhj'];
  const dateStr = `${p.day} ${months[p.month]}`;
  // A finished task is never "vonuar": it used to render red with ⚠️ in the
  // Përfunduar column because only the calendar day was looked at.
  if (status === 'Done') return { text: dateStr, overdue: false, className: 'text-muted-foreground' };
  // Compare CALENDAR days (ignore time-of-day) so a task due later today isn't
  // labeled "Nesër" — intra-day times made the hour-based diff round up.
  const diffDays = dayDiffFromToday(ms, now)!;
  if (diffDays < 0) return { text: dateStr, overdue: true, className: 'text-destructive font-medium' };
  if (diffDays === 0) return { text: 'Sot · ' + dateStr, overdue: false, className: 'text-warning font-medium' };
  if (diffDays === 1) return { text: 'Nesër · ' + dateStr, overdue: false, className: 'text-warning' };
  return { text: dateStr, overdue: false, className: 'text-muted-foreground' };
};

// ── Memo equality for row/card components ──
// Every Firestore snapshot rebuilds every task object (and its Date fields), so
// reference equality alone would re-render all rows on any change to any task.
// Two field values are "the same" when they are identical, two Dates/Timestamps
// at the same instant, or two arrays with identical elements.
function sameFieldValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!sameFieldValue(a[i], b[i])) return false;
    return true;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const am = (a as any).toMillis, bm = (b as any).toMillis;
    if (typeof am === 'function' && typeof bm === 'function') return (a as any).toMillis() === (b as any).toMillis();
    try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; }
  }
  return false;
}

/** Field-by-field equality of two task snapshots (see sameFieldValue). */
export function tasksShallowEqual(a: Task, b: Task): boolean {
  if (a === b) return true;
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    if (!sameFieldValue((a as any)[k], (b as any)[k])) return false;
  }
  return true;
}

/** React.memo comparator: every prop by reference, except `task` by value. */
export function taskPropsEqual<P extends { task: Task }>(prev: P, next: P): boolean {
  for (const k of Object.keys(next) as (keyof P)[]) {
    if (k === 'task') continue;
    if (prev[k] !== next[k]) return false;
  }
  if (Object.keys(prev).length !== Object.keys(next).length) return false;
  return tasksShallowEqual(prev.task, next.task);
}
