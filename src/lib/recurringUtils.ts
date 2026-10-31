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
    // NEVER `setUTCMonth(+step)`: it overflows BEFORE any clamp, so 31 Jan + 1
    // became "31 Feb" = 3 Mar, which the clamp then pinned to 31 MAR — every
    // short month (Feb/Apr/Jun/Sep) vanished from a month-end series. Same law
    // as the billing anchors: add months in the zone, clamped, anchor day kept.
    return addZonedMonthsClamped(date, step, dayOfMonth ?? undefined);
  } else if (frequency === 'yearly') {
    // 29 Feb + 1 year is 28 Feb, not 1 Mar — and the series must come BACK to
    // 29 Feb in the next leap year, so the anchor day (`recurringDayOfMonth`,
    // seeded by buildNextRecurringTask) wins over the clamped day.
    const p = zonedParts(date);
    const day = yearlyAnchorDay(p, dayOfMonth);
    const lastDay = daysInZonedMonth(p.year + step, p.month);
    return zonedDate(p.year + step, p.month, Math.min(day, lastDay), p.hours, p.minutes, p.seconds, p.ms);
  }
  return fromZoned(d, RECURRENCE_TIMEZONE);
}

/**
 * The day a yearly step lands on. The month never changes in a yearly series,
 * so the anchor DAY is all it needs. A stored anchor is honoured only when the
 * current date IS that anchor clamped to its month (28 Feb <- 29): a stale
 * `recurringDayOfMonth` left over from a monthly rule ("çdo muaj, ditën 15") on
 * a 3 March task must not move the series to the 15th.
 * MIRRORED in api/cron/run.ts (`yearlyAnchorDay`) — keep in sync.
 */
function yearlyAnchorDay(p: { year: number; month: number; day: number }, anchor?: number | null): number {
  if (anchor == null || !(anchor >= 1 && anchor <= 31)) return p.day;
  return Math.min(anchor, daysInZonedMonth(p.year, p.month)) === p.day ? anchor : p.day;
}

/**
 * The anchor day a monthly/yearly child carries. An explicit
 * `recurringDayOfMonth` wins; a series created without one is anchored on its
 * parent's start day, so a 31st (or 29 Feb) series survives its first clamp
 * instead of drifting to the 28th for good. Other frequencies carry nothing.
 * MIRRORED in api/cron/run.ts (`seriesAnchorDay`) — keep in sync.
 */
export function seriesAnchorDay(
  frequency: string | null | undefined,
  dayOfMonth: number | null | undefined,
  baseStart: Date,
): number | null {
  if (dayOfMonth != null) return dayOfMonth;
  if (frequency !== 'monthly' && frequency !== 'yearly') return null;
  return isNaN(baseStart.getTime()) ? null : recurrenceDayOfMonth(baseStart);
}

/**
 * The id every occurrence of one series shares: the root parent's id. Legacy
 * rows (before the field existed) are their own root. It is what the cron's
 * duplicate check and `hasLiveSeriesSibling` key on — a title/assignee match
 * used to be the only identity, so two distinct series with the same title
 * collided (one was silently closed) and a renamed occurrence forked.
 */
export function seriesIdOf(task: Pick<Task, 'id' | 'seriesId'>): string {
  return task.seriesId || task.id;
}

/**
 * The title as the legacy series identity compares it: case- and
 * whitespace-insensitive. MIRRORED in api/cron/run.ts (`legacyOccurrenceKey`,
 * `sameSeries`) — the cron normalised and this did not, so the two engines
 * could disagree about whether two legacy rows were one series.
 */
export function normalizeSeriesTitle(title: string | null | undefined): string {
  return (title || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** True when two rows are occurrences of the same recurring series. */
export function sameSeries(a: Task, b: Task): boolean {
  if (a.seriesId || b.seriesId) return seriesIdOf(a) === seriesIdOf(b);
  // Legacy identity (rows that predate `seriesId`): the fields that do not
  // change from one occurrence to the next. Frequency is deliberately NOT one
  // of them — changing "çdo javë" to "çdo muaj" on a tip must not make its own
  // live child a stranger (that forked a second series).
  return normalizeSeriesTitle(a.title) === normalizeSeriesTitle(b.title) &&
    (a.assignedToUserId ?? '') === (b.assignedToUserId ?? '') &&
    (a.projectId ?? '') === (b.projectId ?? '');
}

/**
 * Why a Done tip produced no next occurrence of its own — stamped as
 * `recurringSkippedReason` by whichever engine decided it, so the row can say
 * so. MIRRORED in api/cron/run.ts (`RECURRING_SKIPPED_REASONS`) — keep in sync.
 *   · 'duplicate-occurrence' — the occurrence already existed (a sibling parent
 *     or the other engine produced it);
 *   · 'series-ended'        — the next occurrence falls after "deri më";
 *   · 'child-missing'       — the occurrence this tip recorded (`nextCycleTaskId`)
 *     no longer exists and the series has no live row: it was deleted, so the
 *     series is over unless someone re-opens / re-completes the tip
 *     (`reopenTaskPatch` / `nextCycleClaimIsStale`). Deleting the live
 *     occurrence is how people stop a series — the cron never resurrects it.
 */
export type RecurringSkippedReason = 'duplicate-occurrence' | 'series-ended' | 'child-missing';
export const RECURRING_SKIPPED_REASONS: ReadonlyArray<RecurringSkippedReason> = ['duplicate-occurrence', 'series-ended', 'child-missing'];

/** Claim bookkeeping written next to `nextCycleCreated` (not on the shared Task type yet). */
export type NextCycleClaimFields = {
  /** Id of the occurrence the claim produced; null when the series ended there. */
  nextCycleTaskId?: string | null;
  recurringSkippedReason?: RecurringSkippedReason | string | null;
};

/**
 * The child's blockers. `dependsOn` holds occurrence IDS, so a copied list points
 * at the blocker occurrence that was already Done: a recurring blocker blocked
 * only in cycle 1 and the 🔒 badge lied from then on. A Done recurring blocker
 * is re-pointed to its live sibling; a Done one-off blocker is dropped (it can
 * never block again); an unknown or still-open id is kept as is.
 * MIRRORED in api/cron/run.ts (`remapDependsOn`) — keep in sync.
 */
export function remapDependsOnForNextCycle(task: Task, allTasks?: readonly Task[] | null): string[] | undefined {
  const deps = task.dependsOn;
  if (!deps || deps.length === 0) return deps ?? undefined;
  if (!allTasks || allTasks.length === 0) return deps;
  const out: string[] = [];
  for (const id of deps) {
    const dep = allTasks.find(t => t.id === id);
    if (!dep || dep.status !== 'Done') { out.push(id); continue; }
    if (!dep.isRecurring) continue; // satisfied forever
    const live = allTasks.find(t => t.id !== dep.id && t.status !== 'Done' && t.isRecurring === true && sameSeries(dep, t));
    if (live && !out.includes(live.id)) out.push(live.id);
  }
  return out;
}

/** Build the data for the next cycle task from a completed recurring task.
 *  `allTasks` (when the caller has it) lets `dependsOn` follow the blockers'
 *  live occurrences instead of the finished ones. */
export function buildNextRecurringTask(
  task: Task,
  opts: { allTasks?: readonly Task[] | null } = {},
): Omit<Task, 'id' | 'createdAt' | 'updatedAt'> {
  const parseDate = (d: any): Date => {
    if (!d) return new Date();
    if (d instanceof Date) return d;
    if (d.toDate) return d.toDate();
    return new Date(d);
  };

  const freq = task.recurringFrequency!;
  const interval = task.recurringInterval ?? 1;
  const dow = task.recurringDayOfWeek ?? null;
  const dows = task.recurringDaysOfWeek ?? null;

  const baseStart = parseDate(task.startDate);
  const baseEnd = parseDate(task.endDate);
  const dom = seriesAnchorDay(freq, task.recurringDayOfMonth ?? null, baseStart);
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
    dependsOn: remapDependsOnForNextCycle(task, opts.allTasks),
    estimatedHours: task.estimatedHours ?? undefined,
    // Every occurrence carries the root parent's id — see `seriesIdOf`.
    seriesId: seriesIdOf(task),
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
          // The person who asked for the reminder keeps receiving it.
          reminderSetByUserId: task.reminderSetByUserId ?? null,
        }
      : {}),
    collaboratorIds: task.collaboratorIds ?? undefined,
    createdByUserId: task.createdByUserId,
    // `useMutation.create` stamps `createdByUserId` with the CALLER (whoever
    // completed the previous cycle) — the rules may require it, so it is not
    // overridden. The series' real author travels in its own field instead, and
    // the completion notifications include them (taskCompletionRecipients).
    // The cron writes the same field.
    ...seriesCreatorPatch(task),
  };
}

/** The original author of a series: carried, else the tip's own creator. */
export function seriesCreatorOf(task: Pick<Task, 'createdByUserId'> & { seriesCreatedByUserId?: string | null }): string | null {
  return task.seriesCreatedByUserId || task.createdByUserId || null;
}

// Not on the shared `Task` interface yet — spread through an untyped object so
// the builder's return type stays `Omit<Task, ...>`.
function seriesCreatorPatch(task: Task): Record<string, unknown> {
  const creator = seriesCreatorOf(task as Task & { seriesCreatedByUserId?: string | null });
  return creator ? { seriesCreatedByUserId: creator } : {};
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
    sameSeries(task, t),
  );
}

/** Result of a completion attempt — lets each caller render the right toast
 *  while the actual logic (blockers, recurrence, flags) lives in one place. */
export type CompleteTaskOutcome =
  | { kind: 'blocked'; blockers: number }
  | { kind: 'completed' }
  | { kind: 'recurring-created' }
  | { kind: 'recurring-ended' }
  /** The series is not over, but its PROJECT is (archived / cancelled): the task
   *  closes and no next cycle is spawned. Restoring the project resumes it. */
  | { kind: 'recurring-stopped'; reason: ProjectRecurrenceBlockReason }
  | { kind: 'error'; error: unknown };

/**
 * Everything the next-cycle claim must write IN ONE TRANSACTION with the claim
 * (see `claimTaskNextCycle`): the occurrence itself (or the fact that the
 * series ended) and the Done status of the tip. Before this the claim was
 * written first and the child + Done afterwards, so a closed tab / dropped
 * connection in between left a Todo tip with `nextCycleCreated: true` and no
 * child — the cron skipped it, a second Done could not re-open it, and nothing
 * said why.
 */
export interface NextCyclePlan {
  /** The occurrence to create with the claim; null = the series has ended. */
  child: Omit<Task, 'id' | 'createdAt' | 'updatedAt'> | null;
  /** Written as `recurringSkippedReason` when `child` is null. */
  skippedReason?: RecurringSkippedReason;
  /** The caller proved from its task list that the tip's recorded claim has no
   *  occurrence behind it (`nextCycleClaimIsStale`): the claim may be taken over. */
  rearm: boolean;
  /** The `nextCycleTaskId` the caller saw; a take-over is refused when it moved
   *  (someone else re-claimed in the meantime). */
  expectedChildId: string | null;
}

/**
 * `false` — lost: another completion holds the claim, create nothing.
 * `true`  — claim reserved ONLY (legacy / non-Firestore implementations): the
 *           caller creates the child and marks Done itself.
 * `'done'`— claim + child + Done landed in one transaction: nothing to create.
 */
export type ClaimNextCycleResult = boolean | 'done';

export interface CompleteTaskDeps {
  createTask: (data: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>) => Promise<unknown>;
  updateTask: (id: string, data: Partial<Task>) => Promise<unknown>;
  /** All tasks in scope — used to enforce the dependency (blocker) guard. */
  allTasks?: Task[];
  /** Projects in scope — a task whose project is archived/cancelled must not
   *  spawn its next cycle (`projectRecurrenceBlockReason`). Omitted = unknown =
   *  no block; every real caller has the list and passes it. */
  projects?: ReadonlyArray<RecurrenceProject> | null;
  /** Atomically reserve the next cycle (see `claimTaskNextCycle`) — and, given
   *  a plan, write the child and the Done status in the same transaction.
   *  Returns false when another completion already reserved it — the caller
   *  then skips creating a child. Omitted only in unit tests / non-Firestore
   *  callers. */
  claimNextCycle?: (taskId: string, plan?: NextCyclePlan) => Promise<ClaimNextCycleResult>;
  /** Undo a claim-only reservation when the child could not be created. */
  releaseNextCycle?: (taskId: string) => Promise<void>;
}

/**
 * True when the tip SAYS its next cycle exists (`nextCycleCreated`) but the
 * caller's task list proves nothing is behind the claim: the recorded
 * occurrence (`nextCycleTaskId`, when the claim recorded one) is not in the
 * list AND the series has no live row at all. Such a tip is re-armed when the
 * person completes it again — the same law `reopenTaskPatch` applies on
 * re-open. Without a list nothing can be proved, so it is never stale (the
 * safe side).
 */
export function nextCycleClaimIsStale(task: Task, allTasks: readonly Task[] | undefined | null): boolean {
  if (task.nextCycleCreated !== true || !task.isRecurring || !allTasks) return false;
  const childId = (task as Task & NextCycleClaimFields).nextCycleTaskId;
  if (childId && allTasks.some(t => t.id === childId)) return false;
  return !hasLiveSeriesSibling(task, allTasks as Task[]);
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
  // cheap pre-filter — the authoritative check is the atomic claim below. A
  // claim the list proves empty (`nextCycleClaimIsStale`) is taken over.
  const claimStale = nextCycleClaimIsStale(task, deps.allTasks);
  if (task.isRecurring && task.recurringFrequency && (!task.nextCycleCreated || claimStale)) {
    // A task inside an archived (or cancelled) project closes WITHOUT a next
    // cycle. The claim is deliberately NOT taken and `nextCycleCreated` stays
    // false: the tip keeps its `nextRecurringDate`, so if the project is ever
    // restored the cron backstop (which applies the same rule) resumes the
    // series from the first future occurrence. Claiming it here would kill the
    // series for good — the exact mistake `archiveProjectPatch` exists to avoid
    // for recurring billing.
    const projectBlock = projectRecurrenceBlockReason(task, deps.projects);
    if (projectBlock) {
      await deps.updateTask(task.id, { status: 'Done', completedAt: new Date() });
      return { kind: 'recurring-stopped', reason: projectBlock };
    }
    const ended = recurrenceHasEnded(task);
    const child = ended
      ? null
      : buildNextRecurringTask(task, { allTasks: deps.allTasks }) as Omit<Task, 'id' | 'createdAt' | 'updatedAt'>;
    // Reserve the cycle BEFORE creating anything. Losing the race means another
    // completion already spawned the child; we must not spawn a second one.
    // The plan lets the claim write child + Done in the SAME transaction, so
    // the three can never land half-way (a claim without its child).
    if (deps.claimNextCycle) {
      const claimed = await deps.claimNextCycle(task.id, {
        child,
        skippedReason: ended ? 'series-ended' : undefined,
        rearm: claimStale,
        expectedChildId: (task as Task & NextCycleClaimFields).nextCycleTaskId ?? null,
      });
      if (!claimed) {
        await deps.updateTask(task.id, { status: 'Done', completedAt: new Date() });
        return { kind: 'completed' };
      }
      if (claimed === 'done') {
        // Everything is already on the document. The Done write is repeated
        // through the caller's `updateTask` ONLY for its side effects (local
        // state, completion notifications, activity rows) — same values, and a
        // failure here changes nothing the database does not already say.
        try {
          await deps.updateTask(task.id, { status: 'Done', nextCycleCreated: true, completedAt: new Date() });
        } catch { /* the transaction is the truth */ }
        return ended ? { kind: 'recurring-ended' } : { kind: 'recurring-created' };
      }
    }
    // Claim-only reservation (no transaction available): child, then Done.
    try {
      if (child) await deps.createTask(child);
      await deps.updateTask(task.id, { status: 'Done', nextCycleCreated: true, completedAt: new Date() });
      return ended ? { kind: 'recurring-ended' } : { kind: 'recurring-created' };
    } catch (error) {
      // The child never landed — hand the claim back so the cron backstop can
      // still produce the missing cycle, then mark Done so the user isn't stuck.
      if (deps.releaseNextCycle) {
        try { await deps.releaseNextCycle(task.id); } catch { /* best effort */ }
      }
      await deps.updateTask(task.id, { status: 'Done', completedAt: new Date() });
      return { kind: 'error', error };
    }
  }

  // `completedAt` is THE "when was it done" (taskCompletedMs): `updatedAt`
  // moves on every edit and cron touch, so "completed today" read week-old
  // tasks. Every Done write in this function stamps it; reopenTaskPatch clears it.
  await deps.updateTask(task.id, { status: 'Done', completedAt: new Date() });
  return { kind: 'completed' };
}

/**
 * The patch that RE-OPENS a task (Done -> any open status). One helper for every
 * surface (detail panel, list, board, daily report, subtask checkbox):
 *   · `completedAt: null` — it is no longer done (explicit null: removeUndefined
 *     would strip `undefined` and leave the old stamp);
 *   · a recurring tip gets `nextCycleCreated: false` back ONLY when the series
 *     has no live occurrence left (child deleted by mistake -> revive). Re-arming
 *     while the child is alive would double the series on re-complete — so
 *     without a task list to prove that, it is NOT re-armed (the safe side).
 * A task that is not Done gets just `{ status }`.
 */
export function reopenTaskPatch(
  task: Task,
  status: Task['status'],
  allTasks: Task[] | undefined | null,
): Partial<Task> {
  if (task.status !== 'Done' || status === 'Done') return { status };
  const rearm = !!task.isRecurring && !!allTasks && !hasLiveSeriesSibling(task, allTasks);
  return { status, completedAt: null, ...(rearm ? { nextCycleCreated: false } : {}) };
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

// ── Project status stops task recurrence ─────────────────────────────────────
//
// Archiving a project puts it on a shelf; its tasks stay (nothing is deleted)
// and a recurring one keeps its `isRecurring: true`. Neither `completeTask` nor
// the cron backstop used to look at the project at all, so completing such a
// task — or the cron noticing a Done tip — spawned the next occurrence into an
// archived project, forever. The rule now lives here and is MIRRORED in
// api/cron/run.ts (`runRecurringTasks`) — keep the two in sync.
//
// The statuses are the billing engine's `TERMINAL_PROJECT_STATUSES`
// (finance/recurringBilling.ts). That module imports from this one, so the list
// is repeated here rather than imported; `recurringUtils.test.ts` pins the two
// together.
export const RECURRENCE_STOPPING_PROJECT_STATUSES: ReadonlyArray<string> = ['Archived', 'Cancelled'];

/** The slice of a project the recurrence guard needs. */
export type RecurrenceProject = { id: string; status?: string | null };

export type ProjectRecurrenceBlockReason = 'project-archived' | 'project-cancelled';

/**
 * Why a task's project forbids the next cycle, or null when it does not.
 * A task without a project, or whose project is not in the given list, is never
 * blocked — an unknown project must not silently kill a series.
 */
export function projectRecurrenceBlockReason(
  task: Pick<Task, 'projectId'>,
  projects: ReadonlyArray<RecurrenceProject> | null | undefined,
): ProjectRecurrenceBlockReason | null {
  if (!task.projectId || !projects) return null;
  const project = projects.find(p => p.id === task.projectId);
  if (!project) return null;
  if (project.status === 'Archived') return 'project-archived';
  if (project.status === 'Cancelled') return 'project-cancelled';
  return null;
}

// ── Calendar projection (one engine for both calendars) ──────────────────────
//
// Recurring tasks materialise one cycle at a time, so future cycles have no doc
// yet. Both calendars (TasksView, ProjectDetailView) paint the series forward
// from its tip with the SAME engine that spawns the cycles. This used to be two
// hand-written copies; the project one never received the fixes (zone math,
// interval, fast-forward, archived project) the tasks one got.
//
// Contract: a recurring doc is rendered ONLY through this map (the day filter of
// the calendar excludes `isRecurring` rows), so:
//   · the tip's own anchor day is always included (it is a real doc);
//   · an old cycle (`nextCycleCreated`) or a series inside an archived/cancelled
//     project shows its anchor day and NOTHING further — the engine will not
//     spawn there, so the calendar must not promise it;
//   · a Done tip still projects forward (the series is alive).
export function recurringOccurrencesInMonth(
  tasks: readonly Task[],
  year: number,
  month: number,
  opts: { projects?: ReadonlyArray<RecurrenceProject> | null } = {},
): Map<number, Task[]> {
  const map = new Map<number, Task[]>();
  const daysInMo = new Date(year, month + 1, 0).getDate();
  // Cell keys via the recurrence zone (noon-local can't flip across a day
  // boundary for any real browser offset).
  const cellKeys = Array.from({ length: daysInMo }, (_, i) => startOfRecurrenceDay(new Date(year, month, i + 1, 12)));
  const monthEndKey = cellKeys[daysInMo - 1];
  const push = (key: number, task: Task) => {
    const dayIdx = cellKeys.indexOf(key);
    if (dayIdx < 0) return;
    const day = dayIdx + 1;
    if (!map.has(day)) map.set(day, []);
    map.get(day)!.push(task);
  };
  for (const task of tasks) {
    const t = task as any;
    if (!t.isRecurring || !t.recurringFrequency) continue;
    const anchor = task.endDate || task.startDate;
    if (!anchor) continue;
    const anchorDate = new Date(anchor as any);
    if (isNaN(anchorDate.getTime())) continue;
    const anchorKey = startOfRecurrenceDay(anchorDate);
    push(anchorKey, task);
    // The ENGINE advances startDate by the rule and keeps the start->end span
    // (buildNextRecurringTask). Walking the deadline through the rule instead
    // put the ghosts on the wrong day whenever start and end differ (a weekly
    // "Monday" task due Tuesday painted every Monday). So: walk the START,
    // paint start + span — the day the next occurrence's deadline will be on.
    const rawStart = task.startDate ? new Date(task.startDate as any) : null;
    const startDate = rawStart && !isNaN(rawStart.getTime()) ? rawStart : anchorDate;
    const spanMs = Math.max(0, anchorDate.getTime() - startDate.getTime());
    // Anchor only: the engine spawns nothing past this occurrence.
    if (t.nextCycleCreated === true) continue;
    if (projectRecurrenceBlockReason(task, opts.projects)) continue;
    if (anchorKey > monthEndKey) continue;

    const recEndKey = t.recurringEndDate ? startOfRecurrenceDay(new Date(t.recurringEndDate)) : null;
    let occ = startDate;
    // Fast-forward a stale anchor arithmetically (whole pattern-periods only, so
    // the phase is preserved) — otherwise the 500-step walk below exhausts itself
    // before ever reaching the viewed month for an old daily series.
    const interval = Math.max(1, t.recurringInterval ?? 1);
    const periodMs = t.recurringFrequency === 'daily' && interval === 1
      ? 7 * 86400000
      : t.recurringFrequency === 'weekly' ? interval * 7 * 86400000
      : 0;
    if (periodMs > 0) {
      const behindMs = cellKeys[0] - periodMs - occ.getTime();
      if (behindMs > 0) occ = new Date(occ.getTime() + Math.floor(behindMs / periodMs) * periodMs);
    }
    // Same anchor-day seeding as the engine (a 31st / 29 Feb series keeps its day).
    const dom = seriesAnchorDay(t.recurringFrequency, t.recurringDayOfMonth ?? null, startDate);
    let guard = 0;
    while (guard++ < 500) {
      occ = addFrequency(occ, t.recurringFrequency, t.recurringDayOfWeek ?? null, dom, interval, t.recurringDaysOfWeek ?? null);
      // "Repeat until" is checked on the START, exactly as recurrenceHasEnded does.
      if (recEndKey != null && startOfRecurrenceDay(occ) > recEndKey) break;
      const key = startOfRecurrenceDay(new Date(occ.getTime() + spanMs));
      if (key > monthEndKey) break;
      if (key === anchorKey) continue;
      push(key, task);
    }
  }
  return map;
}
