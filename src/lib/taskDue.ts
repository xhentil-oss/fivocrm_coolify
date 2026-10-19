import type { Task } from '../types';
import { startOfRecurrenceDay, addZonedDays, zonedDate, zonedParts } from './recurringUtils';
import { taskDateMs, taskDueMs, taskCompletedMs } from './taskSort';

// ── "Is this overdue / due today?" — one answer, in Europe/Tirane days ────────
//
// A deadline is a calendar promise ("by Friday"), so every surface compares
// DAYS in the business zone, never instants: a task (or project) due today at
// 12:00 is not "vonuar" at 13:00, and a browser in another zone must not
// disagree with the cron about which day it is. `isOverdueDate` in TasksView
// is the original of this logic; the dashboards, project pages and progress
// helpers read it from here instead of re-deriving it with raw `getTime()`
// (instant math) or `setHours(0,0,0,0)` (machine-local midnight).

const DAY_MS = 86_400_000;

/** Start of the Tirane day of `v` (Date / Timestamp / ISO / ms), or null. */
export function dueDayMs(v: unknown): number | null {
  const ms = taskDateMs(v);
  return ms === null ? null : startOfRecurrenceDay(new Date(ms));
}

/**
 * Whole Tirane calendar days from `now`'s day to `v`'s day: 0 = today,
 * 1 = tomorrow, −1 = yesterday. Null when `v` is absent/invalid. Rounded,
 * because a DST day is 23 or 25 hours long.
 */
export function dayDiffFromToday(v: unknown, now: number = Date.now()): number | null {
  const d = dueDayMs(v);
  if (d === null) return null;
  return Math.round((d - startOfRecurrenceDay(new Date(now))) / DAY_MS);
}

/** The date's DAY is before today. Undated/invalid → false. */
export function isOverdueDate(v: unknown, now: number = Date.now()): boolean {
  const diff = dayDiffFromToday(v, now);
  return diff !== null && diff < 0;
}

/** The date falls on today's Tirane day. Undated/invalid → false. */
export function isDueTodayDate(v: unknown, now: number = Date.now()): boolean {
  return dayDiffFromToday(v, now) === 0;
}

/** Same Tirane day as `now` (any instant: completedAt, createdAt …). */
export function isSameDayAsToday(ms: number | null | undefined, now: number = Date.now()): boolean {
  if (ms === null || ms === undefined || isNaN(ms)) return false;
  return startOfRecurrenceDay(new Date(ms)) === startOfRecurrenceDay(new Date(now));
}

type DueTask = Pick<Task, 'status' | 'endDate' | 'dueDate'>;

/** Open task whose deadline DAY has passed. */
export function isTaskOverdue(task: DueTask, now: number = Date.now()): boolean {
  if (task.status === 'Done') return false;
  return isOverdueDate(taskDueMs(task), now);
}

/** Open task due on today's day. */
export function isTaskDueToday(task: DueTask, now: number = Date.now()): boolean {
  if (task.status === 'Done') return false;
  return isDueTodayDate(taskDueMs(task), now);
}

/** Task was marked Done on today's Tirane day (`completedAt`, legacy `updatedAt`). */
export function isTaskCompletedToday(
  task: Pick<Task, 'status' | 'updatedAt'> & { completedAt?: unknown },
  now: number = Date.now(),
): boolean {
  return isSameDayAsToday(taskCompletedMs(task), now);
}

/**
 * `count` consecutive Tirane calendar days starting at the day of `start`, each
 * at local midnight. Calendar steps (not `start + i·24h`), so a column never
 * drifts an hour — or a whole day — across a DST switch.
 */
export function zonedDayRange(start: Date, count: number): Date[] {
  const p = zonedParts(start);
  const first = zonedDate(p.year, p.month, p.day);
  const out: Date[] = [];
  for (let i = 0; i < count; i++) out.push(i === 0 ? first : addZonedDays(first, i));
  return out;
}
