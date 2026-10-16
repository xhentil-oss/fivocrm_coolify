/**
 * Time-entry primitives shared by the timesheet, the daily report and every
 * profitability engine: which DAY an entry belongs to, whether it falls inside a
 * period, and how the daily report's task rows become entries.
 *
 * Day math is Europe/Tirane-explicit (`toZoned`), never `setHours(0,0,0,0)`, for
 * the reason the rest of the finance code gives: the browser and the cron do not
 * share a machine zone, and "today" must mean the same day on both.
 */
import type { DailyTaskOutcome, TimeEntry } from '../../types';
import { getTimestampMs } from '../utils';
import { RECURRENCE_TIMEZONE, toZoned, fromZoned } from '../recurringUtils';
import { entryHours, DURATION_ONLY_SOURCES } from './laborCost';

export { entryHours, DURATION_ONLY_SOURCES };

/** `YYYY-MM-DD` of an instant in the business zone. */
export function dayKeyOf(d: Date, tz: string = RECURRENCE_TIMEZONE): string {
  const z = toZoned(d, tz);
  return `${z.getUTCFullYear()}-${String(z.getUTCMonth() + 1).padStart(2, '0')}-${String(z.getUTCDate()).padStart(2, '0')}`;
}

/**
 * Is `dayKey` a REAL calendar day in `YYYY-MM-DD` form? The shape alone is not
 * enough: `Date.UTC` silently rolls "2026-09-31" into 1 Oct and "2026-10-00"
 * into 30 Sep, so a malformed key used to be booked in a different month than
 * the one the rules' month lock keys on (`date[0:7]`). A key is valid only when
 * it round-trips through `Date.UTC` unchanged.
 */
export function isValidDayKey(dayKey: unknown): dayKey is string {
  if (typeof dayKey !== 'string') return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);
  if (!m) return false;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const t = new Date(Date.UTC(y, mo - 1, d, 12, 0, 0, 0));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

/** Local noon of a `YYYY-MM-DD` day, as a real instant (null for a key that is not a real day). */
export function dayKeyToNoon(dayKey: string, tz: string = RECURRENCE_TIMEZONE): Date | null {
  if (!isValidDayKey(dayKey)) return null;
  const [y, mo, d] = dayKey.split('-').map(Number);
  const zoned = new Date(Date.UTC(y, mo - 1, d, 12, 0, 0, 0));
  return fromZoned(zoned, tz);
}

/** `YYYY-MM` of a day key. */
export function monthKeyOfDay(dayKey: string): string {
  return (dayKey || '').slice(0, 7);
}

type EntryDateFields = Pick<TimeEntry, 'date' | 'startTime'> & { createdAt?: unknown };

/** The day an entry belongs to: its stored `date`, else the start instant's local day. */
export function entryDayKey(e: EntryDateFields): string | null {
  // A stored date that is not a real day ("2026-09-31") is treated as absent.
  if (isValidDayKey(e.date)) return e.date;
  const ms = entryInstantMs(e);
  return ms ? dayKeyOf(new Date(ms)) : null;
}

/**
 * The instant an entry is booked at.
 *
 * `date` IS the booking day: the rules' month lock is keyed on it, the timesheet
 * grid is keyed on it, the daily report writes it. So a well-formed `date` wins
 * and is read as local noon of that day. `startTime` used to win instead — and
 * the daily report writes `startTime = noon − minutes`, so a row of more than
 * 12 hours dated 1 Sep started on 31 Aug 23:00: every engine booked it in
 * AUGUST while the rules locked it with SEPTEMBER. Without a `date` the start
 * instant is used, then `createdAt`; a row with none of them has no instant.
 */
export function entryInstantMs(e: EntryDateFields): number | null {
  if (isValidDayKey(e.date)) {
    const d = dayKeyToNoon(e.date);
    if (d) return d.getTime();
  }
  const ms = getTimestampMs(e.startTime);
  if (ms) return ms;
  const created = getTimestampMs(e.createdAt);
  return created ? created : null;
}

export function entryInPeriod(e: EntryDateFields, start: Date, end: Date): boolean {
  const at = entryInstantMs(e);
  return at != null && at >= start.getTime() && at <= end.getTime();
}

/**
 * An entry still running (timer not stopped) — never costed. No `endTime` is
 * open whatever `duration` says, unless the row is typed by hand
 * (`source: 'manual' | 'daily-report'`, which carries a duration only) — a
 * running timer that had a `duration` written used to be costed.
 */
export function entryIsOpen(e: Pick<TimeEntry, 'endTime' | 'duration' | 'source'>): boolean {
  if (e.endTime) return false;
  return !(DURATION_ONLY_SOURCES.has(String(e.source || '')) && typeof e.duration === 'number' && e.duration > 0);
}

// ── Daily report → time entries ─────────────────────────────────────────────

/** Deterministic id: one row per person per task per day, so a re-submitted report UPDATES, never duplicates. */
export function dailyReportEntryId(userId: string, taskKey: string, dayKey: string): string {
  return `${userId}_${taskKey}_${dayKey}`;
}

export interface OutcomeEntryContext {
  userId: string;
  dayKey: string;
  /** projectId → customerId, to stamp the client on the hour. */
  customerByProjectId?: Record<string, string | undefined>;
  /** The member's rate-card role at the time. */
  costRole?: string;
  teamId?: string;
  businessId?: string;
}

export interface OutcomeTimeEntry {
  id: string;
  data: Omit<TimeEntry, 'id' | 'createdAt' | 'updatedAt'>;
}

/**
 * The hours typed on the daily report's task rows, as time entries.
 * Rows without hours produce nothing; unplanned rows key on a slug of the title
 * so the same free-text row re-submitted the same day still updates in place.
 */
export function timeEntriesFromOutcomes(outcomes: DailyTaskOutcome[], ctx: OutcomeEntryContext): OutcomeTimeEntry[] {
  const out: OutcomeTimeEntry[] = [];
  const noon = dayKeyToNoon(ctx.dayKey) || new Date();
  for (const o of outcomes || []) {
    const hours = Number(o.hours);
    if (!(hours > 0)) continue;
    const taskKey = o.taskId || `free-${slug(o.title)}`;
    const minutes = Math.round(hours * 60);
    const customerId = o.customerId || (o.projectId ? ctx.customerByProjectId?.[o.projectId] : undefined) || undefined;
    out.push({
      id: dailyReportEntryId(ctx.userId, taskKey, ctx.dayKey),
      data: {
        userId: ctx.userId,
        taskId: o.taskId,
        projectId: o.projectId,
        customerId,
        description: o.title,
        startTime: new Date(noon.getTime() - minutes * 60_000),
        endTime: noon,
        duration: minutes,
        isBillable: !!o.projectId && !!customerId,
        isPomodoroSession: false,
        date: ctx.dayKey,
        source: 'daily-report',
        costRole: ctx.costRole,
        teamId: ctx.teamId,
        businessId: ctx.businessId,
      },
    });
  }
  return out;
}

function slug(s: string): string {
  return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'x';
}

/** Total hours per day key for a set of entries (the timesheet cell). */
export function hoursByDay(entries: TimeEntry[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of entries) {
    const k = entryDayKey(e);
    if (!k) continue;
    m.set(k, (m.get(k) || 0) + entryHours(e));
  }
  return m;
}

// ── Month close (lock) ──────────────────────────────────────────────────────

/** `financeMonthCloses/{businessId}_{YYYY-MM}`. */
export function monthCloseId(businessId: string, periodKey: string): string {
  return `${businessId}_${periodKey}`;
}

/** The `YYYY-MM` keys that are locked, from the tenant's close documents. */
export function lockedMonthSet(closes: Array<{ periodKey?: string; locked?: boolean }> | null | undefined): Set<string> {
  const s = new Set<string>();
  for (const c of closes || []) if (c.locked && c.periodKey) s.add(c.periodKey);
  return s;
}

export function isDayLocked(dayKey: string, locked: Set<string>): boolean {
  return locked.has(monthKeyOfDay(dayKey));
}
