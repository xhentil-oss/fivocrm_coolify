// One set of task comparators for every list, board, calendar and dashboard.
//
// Every surface used to hand-roll its own sort, and each had a different hole:
// `a.endDate - b.endDate` on values that might be a Date, a Firestore Timestamp
// or an ISO string; a `?.getTime()` that threw on a string; a missing date that
// mapped to the epoch (top of an ascending list) in one place and to 99999 in
// another; comparators with no tie-breaker, so equal rows reshuffled on every
// snapshot. These are total orders: deterministic, null-safe, and they end in
// the document id so two renders of the same data always agree.

import type { Task } from '../types';

/** ms since epoch for a Date / Firestore Timestamp / ISO string / number; null when absent or invalid. */
export function taskDateMs(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) { const t = v.getTime(); return isNaN(t) ? null : t; }
  const anyV = v as any;
  if (typeof anyV.toMillis === 'function') return anyV.toMillis();
  if (typeof anyV.toDate === 'function') { const t = anyV.toDate()?.getTime?.(); return typeof t === 'number' && !isNaN(t) ? t : null; }
  if (typeof v === 'number') return isNaN(v) ? null : v;
  if (typeof v === 'string') { const t = Date.parse(v); return isNaN(t) ? null : t; }
  return null;
}

/** The task's deadline: `endDate`, falling back to the legacy `dueDate`. */
export function taskDueMs(task: Pick<Task, 'endDate' | 'dueDate'>): number | null {
  return taskDateMs(task.endDate) ?? taskDateMs(task.dueDate);
}

/** The day a task sits on for calendars: deadline, else start. */
export function taskAnchorMs(task: Pick<Task, 'endDate' | 'dueDate' | 'startDate'>): number | null {
  return taskDueMs(task) ?? taskDateMs(task.startDate);
}

export const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
export function priorityRank(p: string | undefined | null): number {
  return p && p in PRIORITY_RANK ? PRIORITY_RANK[p] : 2; // unknown/missing = medium
}

/** Stable last-resort tie-breaker so equal rows never flicker between renders. */
export function compareTaskIds(a: Pick<Task, 'id'>, b: Pick<Task, 'id'>): number {
  return (a.id || '').localeCompare(b.id || '');
}

/** Deadline ascending; tasks with no deadline LAST; then id. */
export function compareTasksByDue(a: Task, b: Task): number {
  const da = taskDueMs(a), db = taskDueMs(b);
  if (da === null && db === null) return compareTaskIds(a, b);
  if (da === null) return 1;
  if (db === null) return -1;
  return da - db || compareTaskIds(a, b);
}

/** Urgent first, then earliest deadline, then id — the board-column order. */
export function compareTasksByPriorityThenDue(a: Task, b: Task): number {
  return priorityRank(a.priority) - priorityRank(b.priority) || compareTasksByDue(a, b);
}

/** Time-of-day of the anchor (for one calendar day), then priority, then id. */
export function compareTasksByTimeOfDayThenPriority(a: Task, b: Task): number {
  const ta = taskAnchorMs(a), tb = taskAnchorMs(b);
  const minuteOfDay = (ms: number | null) => (ms === null ? Number.POSITIVE_INFINITY : (() => { const d = new Date(ms); return d.getHours() * 60 + d.getMinutes(); })());
  const ma = minuteOfDay(ta), mb = minuteOfDay(tb);
  if (ma !== mb) return ma < mb ? -1 : 1;
  return compareTasksByPriorityThenDue(a, b);
}

/**
 * Section (Asana-style phase) alphabetically in Albanian collation, tasks WITHOUT
 * a section LAST; inside a section by deadline; then id. The old comparator used
 * `'~~~'` as the "no section" key and ICU sorts `~` before every letter, so the
 * unsectioned tasks landed on top — the opposite of what the comment promised.
 */
export function compareTasksBySectionThenDue(a: Task, b: Task): number {
  const sa = (a.section || '').trim(), sb = (b.section || '').trim();
  if (!sa && sb) return 1;
  if (sa && !sb) return -1;
  const bySection = sa.localeCompare(sb, 'sq', { sensitivity: 'base' });
  return bySection || compareDoneLast(a, b) || compareTasksByDue(a, b);
}

/** Open tasks before completed ones; 0 when both are on the same side. */
export function compareDoneLast(a: Pick<Task, 'status'>, b: Pick<Task, 'status'>): number {
  return (a.status === 'Done' ? 1 : 0) - (b.status === 'Done' ? 1 : 0);
}

/**
 * A completed task sinks below every open one, keeping the incoming order on
 * each side (stable) — so ticking a task off moves it out of the way without
 * disturbing the manual/createdAt order of the rest.
 */
export function doneLast<T extends Pick<Task, 'status'>>(arr: T[]): T[] {
  return [...arr].sort(compareDoneLast);
}

/**
 * Manual drag order. Ids not in the saved order (tasks created after the last
 * drag) keep their INCOMING relative order (the query's `createdAt desc`) and go
 * FIRST — a brand-new task must never sink to the last page because someone
 * dragged a row three months ago. Array.prototype.sort is stable, so equal keys
 * preserve the incoming order.
 */
export function sortByManualOrder<T extends Pick<Task, 'id'>>(arr: T[], orderMap: Map<string, number>): T[] {
  if (orderMap.size === 0) return arr;
  return [...arr].sort((a, b) => {
    const ai = orderMap.has(a.id) ? orderMap.get(a.id)! : -1;
    const bi = orderMap.has(b.id) ? orderMap.get(b.id)! : -1;
    return ai - bi;
  });
}

/** A saved manual order with ids that no longer exist removed (it only ever grew). */
export function pruneManualOrder(order: string[], live: Iterable<Pick<Task, 'id'>>): string[] {
  const alive = new Set<string>();
  for (const t of live) alive.add(t.id);
  return order.filter(id => alive.has(id));
}
