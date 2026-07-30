/**
 * Reporting periods — the deterministic spine of the module.
 *
 * Every schedule run, every period-over-period comparison and every idempotency
 * key resolves through here, so a report can only ever be generated ONCE per
 * (schedule, period) and "the previous month" always means the same thing.
 *
 * Pure functions on ISO date strings (`YYYY-MM-DD`) and canonical period keys:
 *
 *     daily      2026-07-30
 *     weekly     2026-W31      (ISO-8601 week, Monday-start)
 *     monthly    2026-07
 *     quarterly  2026-Q3
 *
 * Dates are handled as *calendar* values, deliberately without a Date-with-timezone
 * round trip: a client's July is July regardless of where the server runs. The only
 * place a timezone matters is deciding *when* a job fires, which is
 * `schedule.ts`'s job (it takes the tenant's UTC offset explicitly).
 */

import type { ReportFrequency, ReportPeriod } from '../../types';

/** Default reporting timezone for the agency (Albania). */
export const DEFAULT_TIMEZONE = 'Europe/Tirane';

const pad = (n: number) => String(n).padStart(2, '0');

/** `YYYY-MM-DD` for a Date, read in UTC so the calendar day can't drift. */
export function toIsoDate(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Parse `YYYY-MM-DD` into a UTC-midnight Date. Throws on malformed input. */
export function fromIsoDate(iso: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new Error(`Datë e pavlefshme: "${iso}" (pritej YYYY-MM-DD)`);
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(d.getTime())) throw new Error(`Datë e pavlefshme: "${iso}"`);
  return d;
}

export function addDays(iso: string, days: number): string {
  const d = fromIsoDate(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return toIsoDate(d);
}

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export function isoWeekday(iso: string): number {
  const wd = fromIsoDate(iso).getUTCDay();
  return wd === 0 ? 7 : wd;
}

/** Monday of the ISO week containing `iso`. */
export function startOfIsoWeek(iso: string): string {
  return addDays(iso, -(isoWeekday(iso) - 1));
}

/**
 * ISO-8601 week number + week-year. The week-year is NOT always the calendar year:
 * 2026-01-01 falls in week 1 of 2026, but 2027-01-01 belongs to 2026-W53. Getting
 * this wrong is the classic source of "the first weekly report of the year is
 * missing / duplicated".
 */
export function isoWeekParts(iso: string): { year: number; week: number } {
  // Thursday of the current week decides the week-year (ISO rule).
  const thursday = fromIsoDate(addDays(startOfIsoWeek(iso), 3));
  const year = thursday.getUTCFullYear();
  const jan1 = Date.UTC(year, 0, 1);
  const week = Math.floor((thursday.getTime() - jan1) / 86_400_000 / 7) + 1;
  return { year, week };
}

export function isoWeekKey(iso: string): string {
  const { year, week } = isoWeekParts(iso);
  return `${year}-W${pad(week)}`;
}

/** First day of the month containing `iso`. */
export function startOfMonth(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

/** Last day of the month containing `iso`. */
export function endOfMonth(iso: string): string {
  const d = fromIsoDate(iso);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  return toIsoDate(last);
}

/** Quarter (1–4) of the month containing `iso`. */
export function quarterOf(iso: string): number {
  return Math.floor(Number(iso.slice(5, 7)) / 3.0001) + 1;
}

/**
 * Canonical period key for a date at a given cadence. `ad-hoc` has no canonical
 * key, so the raw date is used — callers that need uniqueness must add their own
 * discriminator.
 */
export function periodKeyFor(frequency: ReportFrequency, iso: string): string {
  switch (frequency) {
    case 'daily': return iso;
    case 'weekly': return isoWeekKey(iso);
    case 'monthly': return iso.slice(0, 7);
    case 'quarterly': return `${iso.slice(0, 4)}-Q${quarterOf(iso)}`;
    default: return iso;
  }
}

/** Build a fully-resolved period for the cadence containing `iso`. */
export function buildPeriod(
  frequency: ReportFrequency,
  iso: string,
  timezone: string = DEFAULT_TIMEZONE,
): ReportPeriod {
  let start = iso;
  let end = iso;
  if (frequency === 'weekly') {
    start = startOfIsoWeek(iso);
    end = addDays(start, 6);
  } else if (frequency === 'monthly') {
    start = startOfMonth(iso);
    end = endOfMonth(iso);
  } else if (frequency === 'quarterly') {
    const q = quarterOf(iso);
    const year = iso.slice(0, 4);
    start = `${year}-${pad((q - 1) * 3 + 1)}-01`;
    end = endOfMonth(`${year}-${pad(q * 3)}-01`);
  }
  return { frequency, key: periodKeyFor(frequency, iso), start, end, timezone };
}

/** Parse a canonical key back into a period. Inverse of `periodKeyFor`. */
export function parsePeriodKey(key: string, timezone: string = DEFAULT_TIMEZONE): ReportPeriod {
  const week = /^(\d{4})-W(\d{2})$/.exec(key);
  if (week) {
    const year = Number(week[1]);
    const wk = Number(week[2]);
    // Jan 4 is always in ISO week 1 — walk back to its Monday, then forward.
    const jan4 = `${year}-01-04`;
    const start = addDays(startOfIsoWeek(jan4), (wk - 1) * 7);
    return { frequency: 'weekly', key, start, end: addDays(start, 6), timezone };
  }
  const quarter = /^(\d{4})-Q([1-4])$/.exec(key);
  if (quarter) {
    return buildPeriod('quarterly', `${quarter[1]}-${pad((Number(quarter[2]) - 1) * 3 + 1)}-01`, timezone);
  }
  if (/^\d{4}-\d{2}$/.test(key)) return buildPeriod('monthly', `${key}-01`, timezone);
  if (/^\d{4}-\d{2}-\d{2}$/.test(key)) return buildPeriod('daily', key, timezone);
  throw new Error(`Periudhë e panjohur: "${key}"`);
}

/**
 * The period immediately before `period` — the comparison baseline for every
 * "vs. previous period" card. For ad-hoc periods it shifts by the same length,
 * which is the only defensible answer for an arbitrary range.
 */
export function previousPeriod(period: ReportPeriod): ReportPeriod {
  const { frequency } = period;
  if (frequency === 'daily') return buildPeriod('daily', addDays(period.start, -1), period.timezone);
  if (frequency === 'weekly') return buildPeriod('weekly', addDays(period.start, -7), period.timezone);
  if (frequency === 'monthly') return buildPeriod('monthly', addDays(period.start, -1), period.timezone);
  if (frequency === 'quarterly') return buildPeriod('quarterly', addDays(period.start, -1), period.timezone);
  const len = daysBetween(period.start, period.end) + 1;
  const start = addDays(period.start, -len);
  return { frequency, key: start, start, end: addDays(period.end, -len), timezone: period.timezone };
}

/** Same period one year earlier (year-over-year comparison). */
export function yearAgoPeriod(period: ReportPeriod): ReportPeriod {
  const shift = (iso: string) => `${Number(iso.slice(0, 4)) - 1}${iso.slice(4)}`;
  if (period.frequency === 'weekly') {
    // Week numbers, not dates: 2026-W31 → 2025-W31 (2025 may only have 52 weeks).
    const { year, week } = isoWeekParts(period.start);
    const prevYear = year - 1;
    const maxWeek = isoWeekParts(`${prevYear}-12-28`).week; // Dec 28 is always in the last ISO week
    return parsePeriodKey(`${prevYear}-W${pad(Math.min(week, maxWeek))}`, period.timezone);
  }
  if (period.frequency === 'monthly') return buildPeriod('monthly', shift(period.start), period.timezone);
  if (period.frequency === 'quarterly') return buildPeriod('quarterly', shift(period.start), period.timezone);
  if (period.frequency === 'daily') return buildPeriod('daily', shift(period.start), period.timezone);
  return { ...period, key: shift(period.key), start: shift(period.start), end: shift(period.end) };
}

/** Inclusive day count between two ISO dates (`a` ≤ `b` assumed). */
export function daysBetween(a: string, b: string): number {
  return Math.round((fromIsoDate(b).getTime() - fromIsoDate(a).getTime()) / 86_400_000);
}

/** Every ISO date in the period, inclusive. Safe for periods up to a year. */
export function datesInPeriod(period: Pick<ReportPeriod, 'start' | 'end'>): string[] {
  const out: string[] = [];
  const total = daysBetween(period.start, period.end);
  if (total < 0 || total > 400) return out;
  for (let i = 0; i <= total; i++) out.push(addDays(period.start, i));
  return out;
}

/**
 * Working days in the period — the denominator for "expected daily reports" and
 * utilisation. `workingDays` uses ISO weekdays (default Mon–Fri); `holidays` are
 * ISO dates that are skipped even when they fall on a working weekday.
 */
export function workingDaysInPeriod(
  period: Pick<ReportPeriod, 'start' | 'end'>,
  workingDays: number[] = [1, 2, 3, 4, 5],
  holidays: string[] = [],
): string[] {
  const holidaySet = new Set(holidays);
  return datesInPeriod(period).filter(d => workingDays.includes(isoWeekday(d)) && !holidaySet.has(d));
}

/** Is `iso` inside the period (inclusive)? */
export function isWithinPeriod(iso: string, period: Pick<ReportPeriod, 'start' | 'end'>): boolean {
  return iso >= period.start && iso <= period.end;
}

const MONTHS_SQ = [
  'Janar', 'Shkurt', 'Mars', 'Prill', 'Maj', 'Qershor',
  'Korrik', 'Gusht', 'Shtator', 'Tetor', 'Nëntor', 'Dhjetor',
];

/** Human label for a period, in Albanian (the product language). */
export function formatPeriodLabel(period: ReportPeriod): string {
  const [y, m, d] = period.start.split('-');
  switch (period.frequency) {
    case 'daily':
      return `${d}/${m}/${y}`;
    case 'weekly': {
      const [, wk] = period.key.split('-W');
      const [ey, em, ed] = period.end.split('-');
      return `Java ${Number(wk)}, ${y} (${d}/${m} – ${ed}/${em}${ey !== y ? `/${ey}` : ''})`;
    }
    case 'monthly':
      return `${MONTHS_SQ[Number(m) - 1]} ${y}`;
    case 'quarterly':
      return `Tremujori ${quarterOf(period.start)} ${y}`;
    default: {
      const [, em, ed] = period.end.split('-');
      return `${d}/${m} – ${ed}/${em}/${y}`;
    }
  }
}

/**
 * When a report for this period is due: `dueOffsetDays` after the period ends,
 * at the given local hour. Returned as a UTC Date shifted by the tenant's offset,
 * so "09:00 in Tirana" is a real instant rather than a server-local guess.
 */
export function dueAtFor(
  period: Pick<ReportPeriod, 'end'>,
  dueOffsetDays: number,
  localHour: number,
  utcOffsetHours: number,
): Date {
  const dueDate = addDays(period.end, Math.max(0, Math.round(dueOffsetDays)));
  const base = fromIsoDate(dueDate);
  base.setUTCHours(localHour - utcOffsetHours, 0, 0, 0);
  return base;
}
