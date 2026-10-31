import type { Task } from '../types';
import { startOfRecurrenceDay, addZonedDays, zonedDate, zonedParts } from './recurringUtils';
import { taskDateMs, taskDueMs, taskCompletedMs } from './taskSort';

// ── The ONE definition of a task's deadline ──────────────────────────────────
//
// `endDate`, falling back to the legacy `dueDate`. Every list surface (the
// Vonuar chip, the `overdue` filter, the row text, the "Sipas afatit" groups,
// the calendar, MyTasks) reads the deadline through `taskDeadline` /
// `taskDueMs` — the chip used to read `endDate` alone while the groups read
// `endDate ?? dueDate`, so a legacy task with only `dueDate` sat under
// "Të vonuara" but was missing from the Vonuar count and read "Pa afat".

/** The deadline as stored (`endDate` ?? `dueDate`), or null when undated. */
export function taskDeadline(task: Pick<Task, 'endDate' | 'dueDate'>): unknown {
  return task.endDate ?? task.dueDate ?? null;
}

/**
 * Today's Tirane day KEY — `startOfRecurrenceDay` of `now`, the value
 * `useTodayKey()` ticks across midnight and the calendar compares its cells to.
 * It is also a valid `now` for every helper in this module (the views pass it
 * as such): Europe/Tirane is UTC+1/+2, so the key read back as an instant is
 * 01:00–02:00 of the same Tirane day (tested).
 */
export function todayKeyOf(now: number = Date.now()): number {
  return startOfRecurrenceDay(new Date(now));
}

/**
 * The Tirane calendar day of a stored instant, as a machine-LOCAL midnight Date
 * (what a day-picker's `selected` understands). Undated/invalid → undefined.
 */
export function localDateOfZonedDay(v: unknown): Date | undefined {
  const ms = taskDateMs(v);
  if (ms === null) return undefined;
  const p = zonedParts(new Date(ms));
  return new Date(p.year, p.month, p.day);
}

/**
 * A deadline on the DAY a picker returned (its machine-local calendar fields
 * are the day the user clicked), at the previous deadline's Tirane time of day
 * — or `defaultHour` (17:00, the end of the working day: midnight read as
 * overdue from the first minute) when the task had none. Never `setHours`:
 * local 09:00 on a browser outside Albania is not 09:00 in Tirane.
 */
export function deadlineOnPickedDay(
  pickedDay: Date,
  previous: unknown,
  defaultHour = 17,
  defaultMinute = 0,
): Date {
  const prevMs = taskDateMs(previous);
  const t = prevMs === null ? { hours: defaultHour, minutes: defaultMinute } : zonedParts(new Date(prevMs));
  return zonedDate(pickedDay.getFullYear(), pickedDay.getMonth(), pickedDay.getDate(), t.hours, t.minutes);
}

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
