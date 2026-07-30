/**
 * Report scheduling — idempotent generation, reminders and escalations.
 *
 * The cron job that drives this is at-least-once, not exactly-once: Vercel can
 * retry, a deploy can overlap a run, and an admin can hit the manual trigger. So
 * *nothing here is allowed to depend on running exactly once*:
 *
 *   • `generationKey(schedule, periodKey)` is the idempotency key. The generator
 *     queries for it before writing, so a second run finds the report and stops.
 *     Rule 10 ("scheduled generation must not create duplicates") is enforced by
 *     that key, not by hoping the cron behaves.
 *
 *   • Reminder and escalation rungs are recorded on the report
 *     (`remindersSent` / `escalationsSent`) as the offsets already fired, so a
 *     replay re-derives "which rungs are due" and sends nothing twice.
 *
 * All functions take `now` explicitly — the cron passes the run time, the tests
 * pass fixed instants.
 */

import type {
  Report,
  ReportEscalationRule,
  ReportFrequency,
  ReportPeriod,
  ReportSchedule,
} from '../../types';
import {
  DEFAULT_TIMEZONE,
  addDays,
  buildPeriod,
  dueAtFor,
  isoWeekday,
  periodKeyFor,
  toIsoDate,
} from './period';

/**
 * UTC offset in hours for a tenant timezone.
 *
 * The module ships one reporting timezone (Europe/Tirane: UTC+1, UTC+2 in DST) and
 * resolves the offset from the actual date via `Intl`, so a schedule set for 09:00
 * still fires at 09:00 local after the clocks change. Unknown zones fall back to
 * UTC rather than guessing.
 */
export function utcOffsetHours(timezone: string | undefined, at: Date): number {
  const tz = timezone || DEFAULT_TIMEZONE;
  try {
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' });
    const part = fmt.formatToParts(at).find(p => p.type === 'timeZoneName')?.value || '';
    const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(part);
    if (!m) return 0;
    const sign = m[1] === '-' ? -1 : 1;
    return sign * (Number(m[2]) + Number(m[3] || 0) / 60);
  } catch {
    return 0;
  }
}

/** The tenant-local calendar date for an instant. */
export function localIsoDate(at: Date, timezone?: string): string {
  const shifted = new Date(at.getTime() + utcOffsetHours(timezone, at) * 3_600_000);
  return toIsoDate(shifted);
}

/** The tenant-local hour (0–23) for an instant. */
export function localHour(at: Date, timezone?: string): number {
  const shifted = new Date(at.getTime() + utcOffsetHours(timezone, at) * 3_600_000);
  return shifted.getUTCHours();
}

/**
 * The period a schedule should be reporting ON at time `now`.
 *
 * A report about a period is written AFTER that period ends, so a weekly schedule
 * running on Monday reports last week, and a monthly schedule running on the 1st
 * reports last month. Getting this backwards is the classic "the monthly report is
 * empty" bug.
 */
export function targetPeriodFor(schedule: Pick<ReportSchedule, 'frequency' | 'timezone'>, now: Date): ReportPeriod {
  const today = localIsoDate(now, schedule.timezone);
  const tz = schedule.timezone || DEFAULT_TIMEZONE;
  switch (schedule.frequency) {
    case 'daily':
      // A daily report covers the day just finished.
      return buildPeriod('daily', addDays(today, -1), tz);
    case 'weekly':
      return buildPeriod('weekly', addDays(today, -7), tz);
    case 'monthly':
      return buildPeriod('monthly', addDays(`${today.slice(0, 7)}-01`, -1), tz);
    case 'quarterly': {
      const q = buildPeriod('quarterly', today, tz);
      return buildPeriod('quarterly', addDays(q.start, -1), tz);
    }
    default:
      return buildPeriod('ad-hoc', today, tz);
  }
}

/** Is `iso` a working day for this schedule (weekday allow-list + holidays)? */
export function isWorkingDay(schedule: Pick<ReportSchedule, 'workingDays' | 'holidays'>, iso: string): boolean {
  const allowed = schedule.workingDays && schedule.workingDays.length ? schedule.workingDays : [1, 2, 3, 4, 5];
  if (!allowed.includes(isoWeekday(iso))) return false;
  return !(schedule.holidays || []).includes(iso);
}

/** First working day of the month containing `iso`. */
export function firstWorkingDayOfMonth(
  schedule: Pick<ReportSchedule, 'workingDays' | 'holidays'>,
  iso: string,
): string {
  let d = `${iso.slice(0, 7)}-01`;
  for (let i = 0; i < 10; i++) {
    if (isWorkingDay(schedule, d)) return d;
    d = addDays(d, 1);
  }
  return `${iso.slice(0, 7)}-01`;
}

/**
 * Should this schedule generate a report right now?
 *
 * Returns the reason it should NOT, which makes the cron log readable ("skipped:
 * wrong day") instead of silent.
 */
export function shouldRunNow(
  schedule: ReportSchedule,
  now: Date,
): { run: boolean; reason: string; period: ReportPeriod } {
  const period = targetPeriodFor(schedule, now);
  const today = localIsoDate(now, schedule.timezone);
  const hour = localHour(now, schedule.timezone);

  if (!schedule.active) return { run: false, reason: 'jo aktiv', period };

  // The hour gate is a >= comparison, not an equality: if the cron misses its slot
  // (cold start, outage), the next run in the same day still generates. The
  // `lastRunPeriodKey` guard below prevents that from producing a duplicate.
  if (hour < schedule.hour) return { run: false, reason: `ora ${hour} < ${schedule.hour}`, period };

  if (schedule.lastRunPeriodKey === period.key) {
    return { run: false, reason: `periudha ${period.key} është prodhuar`, period };
  }

  switch (schedule.frequency) {
    case 'daily':
      if (!isWorkingDay(schedule, today)) return { run: false, reason: 'ditë pushimi', period };
      break;
    case 'weekly': {
      const want = schedule.dayOfWeek ?? 1; // Monday by default
      if (isoWeekday(today) !== want) return { run: false, reason: `dita ${isoWeekday(today)} ≠ ${want}`, period };
      break;
    }
    case 'monthly': {
      const want = schedule.dayOfMonth ?? 0;
      const target = want === 0 ? firstWorkingDayOfMonth(schedule, today) : `${today.slice(0, 7)}-${String(Math.min(28, want)).padStart(2, '0')}`;
      if (today < target) return { run: false, reason: `data ${today} < ${target}`, period };
      break;
    }
    case 'quarterly': {
      const month = Number(today.slice(5, 7));
      if (![1, 4, 7, 10].includes(month)) return { run: false, reason: 'jo muaj tremujori', period };
      const want = schedule.dayOfMonth ?? 0;
      const target = want === 0 ? firstWorkingDayOfMonth(schedule, today) : `${today.slice(0, 7)}-${String(Math.min(28, want)).padStart(2, '0')}`;
      if (today < target) return { run: false, reason: `data ${today} < ${target}`, period };
      break;
    }
    default:
      return { run: false, reason: 'kadencë ad-hoc', period };
  }

  return { run: true, reason: 'gati', period };
}

/**
 * THE idempotency key. Stored on the generated report as `generationKey` and
 * queried before every write, so a retried cron run is a no-op.
 *
 * `subjectId` distinguishes the per-member fan-out of a department schedule
 * (one weekly-staff report per person, same schedule, same period).
 */
export function generationKey(scheduleId: string, periodKey: string, subjectId?: string | null): string {
  return subjectId ? `${scheduleId}:${periodKey}:${subjectId}` : `${scheduleId}:${periodKey}`;
}

/** When the generated report is due, honouring the tenant's local hour. */
export function dueAtForSchedule(schedule: ReportSchedule, period: ReportPeriod, now: Date): Date {
  return dueAtFor(
    period,
    schedule.dueOffsetDays ?? defaultDueOffset(schedule.frequency),
    schedule.hour,
    utcOffsetHours(schedule.timezone, now),
  );
}

function defaultDueOffset(frequency: ReportFrequency): number {
  switch (frequency) {
    case 'daily': return 0;
    case 'weekly': return 2;
    case 'monthly': return 5;
    case 'quarterly': return 10;
    default: return 3;
  }
}

/**
 * Next time this schedule will fire, for the calendar and the "next run" chip.
 *
 * The subtlety is the day gate: `shouldRunNow` accepts any day at or after the
 * target date (so a missed cron slot still catches up), which means a naive scan
 * would answer "tomorrow" for a monthly schedule that already produced this
 * month's report. So the scan carries the period considered COVERED — the recorded
 * `lastRunPeriodKey`, or the period this very moment would produce when the
 * schedule is already runnable — and looks for the first slot that would produce a
 * DIFFERENT period.
 */
export function nextRunAt(schedule: ReportSchedule, now: Date): Date | null {
  if (!schedule.active || schedule.frequency === 'ad-hoc') return null;
  const runnableNow = shouldRunNow(schedule, now);
  const covered = schedule.lastRunPeriodKey || (runnableNow.run ? runnableNow.period.key : undefined);
  const probe = { ...schedule, lastRunPeriodKey: covered } as ReportSchedule;

  for (let i = 0; i < 400; i++) {
    const iso = addDays(localIsoDate(now, schedule.timezone), i);
    const candidate = new Date(`${iso}T00:00:00Z`);
    // The slot hour is local, so shift it into UTC using that day's own offset —
    // a DST change between now and the slot must not move the local time.
    candidate.setUTCHours(schedule.hour - utcOffsetHours(schedule.timezone, candidate), 0, 0, 0);
    if (candidate.getTime() <= now.getTime()) continue;
    if (shouldRunNow(probe, candidate).run) return candidate;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Reminders & escalations
// ─────────────────────────────────────────────────────────────────────────────

/** Sensible default ladders per report kind, used when a schedule defines none. */
export const DEFAULT_REMINDER_OFFSETS: Record<'staff' | 'client', number[]> = {
  staff: [1],           // one day before the deadline
  client: [5, 3, 1],    // owner, reviewer, account manager
};

/**
 * The daily-report ladder from the spec §13: nudge, deadline, leader after 30
 * minutes, department manager after 2 hours, mark missing at end of day.
 */
export const DEFAULT_DAILY_ESCALATION: ReportEscalationRule[] = [
  { afterMinutes: 0, notify: 'author', channel: 'both' },
  { afterMinutes: 30, notify: 'team_leader', channel: 'in-app' },
  { afterMinutes: 120, notify: 'department_manager', channel: 'both' },
  { afterMinutes: 480, notify: 'management', channel: 'in-app', markMissing: true },
];

/** The client-report ladder from the spec §13. */
export const DEFAULT_CLIENT_ESCALATION: ReportEscalationRule[] = [
  { afterMinutes: 0, notify: 'author', channel: 'both' },
  { afterMinutes: 60 * 24, notify: 'reviewer', channel: 'both' },
  { afterMinutes: 60 * 48, notify: 'account_manager', channel: 'both' },
  { afterMinutes: 60 * 72, notify: 'management', channel: 'both', markMissing: true },
];

/** Statuses that still owe someone work — only these can be reminded/escalated. */
const OPEN_STATUSES = new Set<Report['status']>([
  'draft', 'in_progress', 'changes_requested', 'submitted', 'under_review',
]);

export interface DueReminder {
  /** Offset in DAYS before the due date that this reminder represents. */
  offsetDays: number;
}

/**
 * Which "before the deadline" reminders are due now and have not been sent.
 * `report.remindersSent` holds the offsets already fired.
 */
export function dueReminders(
  report: Pick<Report, 'status' | 'dueAt' | 'remindersSent'>,
  offsets: number[],
  now: Date,
): DueReminder[] {
  if (!report.dueAt || !OPEN_STATUSES.has(report.status)) return [];
  const already = new Set(report.remindersSent || []);
  const msToDue = report.dueAt.getTime() - now.getTime();
  if (msToDue < 0) return []; // past due → escalation territory, not reminders
  const daysToDue = msToDue / 86_400_000;
  return offsets
    .filter(o => o > 0 && !already.has(o) && daysToDue <= o)
    // Fire only the closest un-sent rung per run, so a long outage doesn't
    // deliver three reminders at once.
    .sort((a, b) => a - b)
    .slice(0, 1)
    .map(offsetDays => ({ offsetDays }));
}

export interface DueEscalation {
  rule: ReportEscalationRule;
  /** Minutes overdue at evaluation time — goes into the notification copy. */
  overdueMinutes: number;
}

/**
 * Which escalation rungs are due now and have not been fired.
 * `report.escalationsSent` holds the `afterMinutes` values already fired.
 */
export function dueEscalations(
  report: Pick<Report, 'status' | 'dueAt' | 'escalationsSent'>,
  ladder: ReportEscalationRule[],
  now: Date,
): DueEscalation[] {
  if (!report.dueAt || !OPEN_STATUSES.has(report.status)) return [];
  const overdueMinutes = Math.floor((now.getTime() - report.dueAt.getTime()) / 60000);
  if (overdueMinutes < 0) return [];
  const already = new Set(report.escalationsSent || []);
  return ladder
    .filter(r => !already.has(r.afterMinutes) && overdueMinutes >= r.afterMinutes)
    .sort((a, b) => a.afterMinutes - b.afterMinutes)
    // Highest rung reached wins: skipping straight to the manager after a long
    // outage is right, spamming every rung is not.
    .slice(-1)
    .map(rule => ({ rule, overdueMinutes }));
}

/** Is the report overdue right now? */
export function isOverdue(report: Pick<Report, 'status' | 'dueAt'>, now: Date): boolean {
  if (!report.dueAt) return false;
  if (!OPEN_STATUSES.has(report.status)) return false;
  return report.dueAt.getTime() < now.getTime();
}

/** Human "3 ditë e vonuar" / "nesër" label for lists and the calendar. */
export function dueLabel(dueAt: Date | undefined, now: Date): string {
  if (!dueAt) return '—';
  const diffDays = Math.round((dueAt.getTime() - now.getTime()) / 86_400_000);
  if (diffDays < -1) return `${Math.abs(diffDays)} ditë e vonuar`;
  if (diffDays === -1) return 'Vonuar dje';
  if (diffDays === 0) return 'Afati sot';
  if (diffDays === 1) return 'Afati nesër';
  return `${diffDays} ditë`;
}

/** Period key of the period a schedule most recently produced, for display. */
export function lastProducedPeriodKey(schedule: ReportSchedule, now: Date): string {
  return schedule.lastRunPeriodKey || periodKeyFor(schedule.frequency, localIsoDate(now, schedule.timezone));
}
