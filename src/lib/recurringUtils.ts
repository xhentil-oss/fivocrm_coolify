import type { Task } from '../types';

// ── Recurrence day arithmetic is timezone-EXPLICIT ───────────────────────────
//
// Recurrence asks CALENDAR questions — "the next Monday", "has the series passed
// its repeat-until date?" — and a calendar day only exists inside a timezone.
// This code used to read the MACHINE's timezone (`getDate`/`getDay`/`setHours`),
// which made the answer depend on where it ran:
//
//   A task starting 2026-08-03T22:00:00Z is Monday 00:00 in Tirana but Sunday
//   22:00 in UTC. For "weekly on Monday", the browser (UTC+2) saw Monday and
//   advanced exactly 7 days; the cron backstop on Vercel (UTC) saw Sunday and
//   snapped forward to the following Monday — a different next cycle for the
//   same task, from the same rule. The test suite only passed on a UTC+2 laptop
//   and had been failing in CI (UTC) since 2026-08-11 for exactly this reason.
//
// Fix: do the arithmetic in ONE declared timezone. Same technique as
// `src/lib/reporting/schedule.ts` — shift the instant by the zone's offset, then
// use the *UTC* getters, so the host's zone cannot influence the result.
// Europe/Tirane is the business timezone the rest of the app already stands on
// (reporting periods, DND windows, the VPS schedulers).
export const RECURRENCE_TIMEZONE = 'Europe/Tirane';

/** The zone's UTC offset in ms at a given instant (DST-aware). */
function zoneOffsetMs(at: Date, tz: string): number {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' });
    const part = fmt.formatToParts(at).find((p) => p.type === 'timeZoneName')?.value || '';
    const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(part);
    if (!m) return 0;
    const sign = m[1] === '-' ? -1 : 1;
    return sign * (Number(m[2]) * 60 + Number(m[3] || 0)) * 60_000;
  } catch {
    return 0; // unknown zone → behave as UTC rather than guess
  }
}

/** Civil (wall-clock) time in the zone, expressed through the UTC getters.
 *  Exported for other calendar-shaped modules (follow-up due dates) so they do
 *  the same zone-explicit arithmetic instead of re-implementing it. */
export function toZoned(at: Date, tz: string): Date {
  return new Date(at.getTime() + zoneOffsetMs(at, tz));
}

/**
 * Inverse of `toZoned`. Two passes because the offset depends on the instant we
 * are solving for: the first guess picks an offset, the second re-reads it at
 * that guess so a date landing on the other side of a DST switch still returns
 * the right wall-clock time.
 */
export function fromZoned(zoned: Date, tz: string): Date {
  const guess = new Date(zoned.getTime() - zoneOffsetMs(zoned, tz));
  return new Date(zoned.getTime() - zoneOffsetMs(guess, tz));
}

/** Start of the calendar day in the recurrence zone, as a comparable number. */
export function startOfRecurrenceDay(x: Date): number {
  const z = toZoned(x, RECURRENCE_TIMEZONE);
  z.setUTCHours(0, 0, 0, 0);
  return z.getTime();
}

/** Weekday (0–6, Sunday=0) of an instant, read in the recurrence zone — use this
 *  instead of `Date#getDay` when seeding `recurringDayOfWeek`, or a browser in
 *  another zone stores a weekday the engine will disagree with. */
export function recurrenceDayOfWeek(at: Date): number {
  return toZoned(at, RECURRENCE_TIMEZONE).getUTCDay();
}

/** Day-of-month of an instant, read in the recurrence zone (see above). */
export function recurrenceDayOfMonth(at: Date): number {
  return toZoned(at, RECURRENCE_TIMEZONE).getUTCDate();
}

// ── Zone-explicit calendar arithmetic for BILLING ────────────────────────────
//
// Billing asks the same calendar questions recurrence does — "which month is
// this?", "which Monday anchors this week?", "one month after the 31st" — and
// the billing engines (`finance/recurringBilling.ts`, `finance/recurringExpenses.ts`)
// answered them with the MACHINE's getters. The UI runs in Europe/Tirane and the
// cron body runs on Vercel in UTC, so the same instant produced different period
// keys on each side: `2026-07-31T22:00Z` (local midnight, 1 Aug) keys as
// '2026-08' in the browser and '2026-07' on the server. A series whose bill
// falls on the 1st then either blocks forever (`already-generated` against a key
// the client never claimed) or books the same month twice.
//
// These helpers are the billing counterpart of `toZoned`/`fromZoned` above, and
// are mirrored in `api/cron/run.ts` (which cannot import from `src/`).

/** Calendar fields of an instant, read in the recurrence zone. */
export function zonedParts(at: Date): {
  year: number; month: number; day: number;
  hours: number; minutes: number; seconds: number; ms: number; weekday: number;
} {
  const z = toZoned(at, RECURRENCE_TIMEZONE);
  return {
    year: z.getUTCFullYear(), month: z.getUTCMonth(), day: z.getUTCDate(),
    hours: z.getUTCHours(), minutes: z.getUTCMinutes(),
    seconds: z.getUTCSeconds(), ms: z.getUTCMilliseconds(), weekday: z.getUTCDay(),
  };
}

/** The instant at which the recurrence zone shows this wall-clock time. */
export function zonedDate(
  year: number, month: number, day: number,
  hours = 0, minutes = 0, seconds = 0, ms = 0,
): Date {
  return fromZoned(new Date(Date.UTC(year, month, day, hours, minutes, seconds, ms)), RECURRENCE_TIMEZONE);
}

/** Number of days in the zone's calendar month containing (year, month). */
export function daysInZonedMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/** `from` shifted by whole zone days, keeping its wall-clock time of day. */
export function addZonedDays(from: Date, days: number): Date {
  const p = zonedParts(from);
  return zonedDate(p.year, p.month, p.day + days, p.hours, p.minutes, p.seconds, p.ms);
}

/** `from` shifted by whole zone years, keeping its wall-clock time of day. */
export function addZonedYears(from: Date, years: number): Date {
  const p = zonedParts(from);
  return zonedDate(p.year + years, p.month, p.day, p.hours, p.minutes, p.seconds, p.ms);
}

/**
 * Add months in the recurrence zone without the `setMonth` overflow: 31 Jan + 1
 * month is 28/29 Feb, never 2/3 Mar. `anchorDay` keeps a month-end series pinned
 * to its original day, so Jan 31 → Feb 28 → Mar 31 rather than degrading to the
 * 28th for the rest of the contract.
 */
export function addZonedMonthsClamped(from: Date, months: number, anchorDay?: number): Date {
  const p = zonedParts(from);
  const day = anchorDay ?? p.day;
  const targetYear = p.year + Math.floor((p.month + months) / 12);
  const targetMonth = ((p.month + months) % 12 + 12) % 12;
  const lastDay = daysInZonedMonth(targetYear, targetMonth);
  return zonedDate(targetYear, targetMonth, Math.min(day, lastDay), p.hours, p.minutes, p.seconds, p.ms);
}

/** Monday 00:00 (recurrence zone) of the week `at` falls in. */
export function startOfZonedWeek(at: Date): Date {
  const p = zonedParts(at);
  const backToMonday = p.weekday === 0 ? 6 : p.weekday - 1;
  return zonedDate(p.year, p.month, p.day - backToMonday);
}

export function addFrequency(
  date: Date,
  frequency: string,
  dayOfWeek?: number | null,
  dayOfMonth?: number | null,
  interval = 1,
  daysOfWeek?: number[] | null,
): Date {
  // Work on the zone's wall clock, via the UTC getters (see the note above).
  const d = toZoned(date, RECURRENCE_TIMEZONE);
  const step = Math.max(1, Math.round(interval));

  if (frequency === 'daily') {
    d.setUTCDate(d.getUTCDate() + step);
    if (daysOfWeek && daysOfWeek.length > 0) {
      let tries = 0;
      while (!daysOfWeek.includes(d.getUTCDay()) && tries < 7) {
        d.setUTCDate(d.getUTCDate() + 1);
        tries++;
      }
    }
  } else if (frequency === 'weekly') {
    d.setUTCDate(d.getUTCDate() + 7 * step);
    if (dayOfWeek != null) {
      const diff = dayOfWeek - d.getUTCDay();
      // Only ever snap forward — a negative diff would pull the date backwards,
      // producing an interval shorter than 7 days. `(diff + 7) % 7` keeps it future.
      if (diff !== 0) d.setUTCDate(d.getUTCDate() + ((diff + 7) % 7));
    }
  } else if (frequency === 'monthly') {
    d.setUTCMonth(d.getUTCMonth() + step);
    if (dayOfMonth != null) {
      const maxDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
      d.setUTCDate(Math.min(dayOfMonth, maxDay));
    }
  } else if (frequency === 'yearly') {
    d.setUTCFullYear(d.getUTCFullYear() + step);
  }
  return fromZoned(d, RECURRENCE_TIMEZONE);
}

/** Build the data for the next cycle task from a completed recurring task. */
export function buildNextRecurringTask(task: Task): Omit<Task, 'id' | 'createdAt' | 'updatedAt'> {
  const parseDate = (d: any): Date => {
    if (!d) return new Date();
    if (d instanceof Date) return d;
    if (d.toDate) return d.toDate();
    return new Date(d);
  };

  const freq = task.recurringFrequency!;
  const interval = task.recurringInterval ?? 1;
  const dow = task.recurringDayOfWeek ?? null;
  const dom = task.recurringDayOfMonth ?? null;
  const dows = task.recurringDaysOfWeek ?? null;

  const baseStart = parseDate(task.startDate);
  const baseEnd = parseDate(task.endDate);
  const baseNext = task.nextRecurringDate ? parseDate(task.nextRecurringDate) : new Date();

  // ONLY startDate is advanced by the recurrence rule; endDate and
  // nextRecurringDate are re-derived from it by preserving their offset.
  //
  // Running addFrequency() on each date independently destroys the task: the
  // `dayOfWeek` snap moves each one to the configured weekday on its own, so a
  // start and end that sit on *different* weekdays get pushed by a different
  // number of days. In production this turned a 20-hour task into one whose end
  // was 6 days BEFORE its start (22 rows), and made the series jump 13 days
  // instead of 7.
  const spanMs = Math.max(0, baseEnd.getTime() - baseStart.getTime());
  const nextOffsetMs = baseNext.getTime() - baseStart.getTime();

  let newStart = addFrequency(baseStart, freq, dow, dom, interval, dows);

  // Roll forward so the next occurrence never lands in the past — matches how
  // Asana/Todoist behave when a recurring task is completed late: the next due
  // date is always the first *future* one, not blindly (previous due + interval).
  const sod = startOfRecurrenceDay;
  const todayMs = sod(new Date());
  let guard = 0;
  while (sod(newStart) < todayMs && guard++ < 500) {
    newStart = addFrequency(newStart, freq, dow, dom, interval, dows);
  }

  const newEnd = new Date(newStart.getTime() + spanMs);
  const newNext = new Date(newStart.getTime() + nextOffsetMs);

  return {
    title: task.title,
    description: task.description ?? undefined,
    status: 'Todo',
    priority: task.priority ?? undefined,
    teamId: task.teamId ?? undefined,
    // Carry the tenant/customer scope forward — without businessId the generated
    // cycle falls outside the business-scoped task query and vanishes from the
    // list & calendar.
    businessId: (task as any).businessId ?? undefined,
    customerId: (task as any).customerId ?? undefined,
    projectId: task.projectId ?? undefined,
    assignedToUserId: task.assignedToUserId ?? undefined,
    // Carry board organisation forward so the next cycle keeps its labels & column.
    labels: (task as any).labels ?? undefined,
    section: (task as any).section ?? undefined,
    startDate: newStart,
    endDate: newEnd,
    parentTaskId: task.parentTaskId ?? undefined,
    dependsOn: task.dependsOn ?? undefined,
    estimatedHours: task.estimatedHours ?? undefined,
    isRecurring: true,
    recurringFrequency: freq,
    recurringInterval: interval,
    recurringDayOfWeek: dow ?? undefined,
    recurringDaysOfWeek: dows ?? undefined,
    recurringDayOfMonth: dom ?? undefined,
    recurringEndDate: task.recurringEndDate ?? undefined,
    nextRecurringDate: newNext,
    nextCycleCreated: false,
    dueNotificationSent: false,
    // A RELATIVE reminder ("1 orë para") is part of the series: the next cycle
    // gets it re-resolved against its own deadline. A custom absolute reminder
    // belongs to the occurrence it was set on and is not carried.
    ...(task.reminderOffsetMinutes !== null && task.reminderOffsetMinutes !== undefined
      ? {
          reminderOffsetMinutes: task.reminderOffsetMinutes,
          reminderAt: new Date(newEnd.getTime() - Math.max(0, task.reminderOffsetMinutes) * 60_000),
        }
      : {}),
    collaboratorIds: task.collaboratorIds ?? undefined,
    createdByUserId: task.createdByUserId,
  };
}

/**
 * True when an OPEN occurrence of the same series (other than `task` itself)
 * already exists. Used by the re-open paths: re-arming `nextCycleCreated` on a
 * Done tip whose child is still alive would let the next completion spawn a
 * SECOND identical child (the mis-click → undo → re-complete flow). Re-arm only
 * when the series has no live occurrence — i.e. the child was deleted and the
 * series would otherwise be dead.
 */
export function hasLiveSeriesSibling(task: Task, allTasks: Task[] | undefined | null): boolean {
  if (!allTasks || !task.isRecurring) return false;
  return allTasks.some(t =>
    t.id !== task.id &&
    t.status !== 'Done' &&
    t.isRecurring === true &&
    t.recurringFrequency === task.recurringFrequency &&
    t.title === task.title &&
    (t.assignedToUserId ?? '') === (task.assignedToUserId ?? '') &&
    (t.projectId ?? '') === (task.projectId ?? ''),
  );
}

/** Result of a completion attempt — lets each caller render the right toast
 *  while the actual logic (blockers, recurrence, flags) lives in one place. */
export type CompleteTaskOutcome =
  | { kind: 'blocked'; blockers: number }
  | { kind: 'completed' }
  | { kind: 'recurring-created' }
  | { kind: 'recurring-ended' }
  | { kind: 'error'; error: unknown };

export interface CompleteTaskDeps {
  createTask: (data: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>) => Promise<unknown>;
  updateTask: (id: string, data: Partial<Task>) => Promise<unknown>;
  /** All tasks in scope — used to enforce the dependency (blocker) guard. */
  allTasks?: Task[];
  /** Atomically reserve the next cycle (see `claimTaskNextCycle`). Returns false
   *  when another completion already reserved it — the caller then skips
   *  creating a child. Omitted only in unit tests / non-Firestore callers. */
  claimNextCycle?: (taskId: string) => Promise<boolean>;
  /** Undo the claim when the child could not be created. */
  releaseNextCycle?: (taskId: string) => Promise<void>;
}

/**
 * Single source of truth for completing a task, used by every surface that can
 * mark one Done (list toggle, list quick-action, detail panel, kanban drag).
 *
 * It enforces the dependency guard, spawns the next recurring cycle ("after
 * completion" model, unless the "repeat until" date has passed), and sets
 * `nextCycleCreated` so the cron backstop never produces a duplicate. Callers
 * map the returned outcome to their own toast.
 */
export async function completeTask(task: Task, deps: CompleteTaskDeps): Promise<CompleteTaskOutcome> {
  // Dependency guard: cannot complete a task whose blockers are still open.
  if (task.dependsOn && task.dependsOn.length > 0 && deps.allTasks) {
    const openBlockers = task.dependsOn.filter(depId => {
      const dep = deps.allTasks!.find(t => t.id === depId);
      return dep && dep.status !== 'Done';
    });
    if (openBlockers.length > 0) return { kind: 'blocked', blockers: openBlockers.length };
  }

  // "After completion" recurring: on Done, immediately spawn the next cycle
  // (unless the recurrence has ended) and flag the current one so cron skips it.
  //
  // `task.nextCycleCreated` here is a possibly stale snapshot, so it is only a
  // cheap pre-filter — the authoritative check is the atomic claim below.
  if (task.isRecurring && task.recurringFrequency && !task.nextCycleCreated) {
    // Reserve the cycle BEFORE creating anything. Losing the race means another
    // completion already spawned the child; we must not spawn a second one.
    if (deps.claimNextCycle) {
      const claimed = await deps.claimNextCycle(task.id);
      if (!claimed) {
        await deps.updateTask(task.id, { status: 'Done' });
        return { kind: 'completed' };
      }
    }
    try {
      const ended = recurrenceHasEnded(task);
      if (!ended) {
        await deps.createTask(buildNextRecurringTask(task) as Omit<Task, 'id' | 'createdAt' | 'updatedAt'>);
      }
      await deps.updateTask(task.id, { status: 'Done', nextCycleCreated: true });
      return ended ? { kind: 'recurring-ended' } : { kind: 'recurring-created' };
    } catch (error) {
      // The child never landed — hand the claim back so the cron backstop can
      // still produce the missing cycle, then mark Done so the user isn't stuck.
      if (deps.releaseNextCycle) {
        try { await deps.releaseNextCycle(task.id); } catch { /* best effort */ }
      }
      await deps.updateTask(task.id, { status: 'Done' });
      return { kind: 'error', error };
    }
  }

  await deps.updateTask(task.id, { status: 'Done' });
  return { kind: 'completed' };
}

/** True when the next cycle would fall after the recurrence's "repeat until" date,
 *  i.e. the series is complete and no further occurrence should be created. */
export function recurrenceHasEnded(task: Task): boolean {
  if (!task.recurringEndDate || !task.recurringFrequency) return false;
  const parse = (d: any): Date => (d && d.toDate ? d.toDate() : new Date(d));
  // Day-level comparison in the recurrence zone: "until 11 August" is a calendar
  // statement, so an occurrence ON the 11th is still inside the series.
  const sod = startOfRecurrenceDay;
  const next = buildNextRecurringTask(task);
  return sod(parse(next.startDate)) > sod(parse(task.recurringEndDate));
}
