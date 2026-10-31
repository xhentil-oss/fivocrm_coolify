import {
  addFrequency,
  recurrenceDayOfMonth,
  recurrenceDayOfWeek,
  zonedDate,
} from './recurringUtils';
import type { Task } from '../types';

// ── Seeding a NEW recurring task (the two create paths) ──────────────────────
//
// TasksView (useCreateTask) and ProjectDetailView each seeded
// `nextRecurringDate` from NOW with machine-local getters: "next Monday after
// today, 09:00". A task scheduled for a day later than today (the quick form
// plans up to ten working days ahead) therefore got a next cycle BEFORE its
// own start — and the engine (`buildNextRecurringTask`) carries the
// `nextRecurringDate − startDate` offset onto every child, so the series read
// as due a week early for the rest of its life. `recurringEndDate` was local
// midnight of the chosen day, which is a different calendar day on a browser
// outside Europe/Tirane.
//
// The law here is the panel's (`TaskRecurrenceSection.enableRecurring`): the
// next occurrence is the task's OWN start + one frequency, in the recurrence
// zone, rolled past `now` only when the start is already in the past. Both
// create paths call this one function.

export const RECURRING_FREQUENCIES = ['daily', 'weekly', 'monthly', 'yearly'] as const;
export type RecurringFrequency = (typeof RECURRING_FREQUENCIES)[number];

export function isRecurringFrequency(v: unknown): v is RecurringFrequency {
  return typeof v === 'string' && (RECURRING_FREQUENCIES as readonly string[]).includes(v);
}

export interface RecurrenceSeedInput {
  frequency: RecurringFrequency;
  interval?: number | null;
  /** Weekly: 0–6 (Sunday = 0). Missing → the start day's weekday. */
  dayOfWeek?: number | null;
  /** Monthly: 1–31. Missing → the start day's day-of-month. */
  dayOfMonth?: number | null;
  /** Daily: the weekdays the series runs on. Missing → Mon–Fri. */
  daysOfWeek?: number[] | null;
  /** The task's own start; falls back to its deadline, then `now`. */
  startDate?: Date | null;
  endDate?: Date | null;
  /** "Përsërit deri" as the form sends it: `YYYY-MM-DD`. */
  endDateRaw?: string | null;
  now?: Date;
}

export type RecurrenceSeedPatch = Pick<
  Task,
  | 'isRecurring'
  | 'recurringFrequency'
  | 'recurringInterval'
  | 'recurringDayOfWeek'
  | 'recurringDayOfMonth'
  | 'recurringDaysOfWeek'
  | 'recurringEndDate'
  | 'nextRecurringDate'
>;

const DEFAULT_DAILY_DAYS = [1, 2, 3, 4, 5];

function validDate(d: Date | null | undefined): Date | null {
  return d instanceof Date && !isNaN(d.getTime()) ? d : null;
}

/**
 * End of the chosen day in the recurrence zone. `recurrenceHasEnded` compares
 * on Tirane calendar days, so any instant inside that day works — the end of
 * it is the honest choice for "deri më". `null` for anything unparsable.
 */
export function recurringEndDateFromInput(raw: string | null | undefined): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(raw ?? '').trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (!(mo >= 1 && mo <= 12) || !(d >= 1 && d <= 31)) return null;
  const at = zonedDate(y, mo - 1, d, 23, 59, 59, 999);
  return isNaN(at.getTime()) ? null : at;
}

/**
 * The recurrence fields a NEW task is created with. The next occurrence is
 * `start + one frequency` (zone-explicit `addFrequency`, the same step the
 * engine takes), so it can never precede the task's own start; a start that
 * is already in the past seeds from `now` instead — the panel's rule, which
 * keeps the cron backstop from spawning the second cycle immediately.
 */
export function recurrenceSeedPatch(input: RecurrenceSeedInput): RecurrenceSeedPatch {
  const now = input.now ?? new Date();
  const base = validDate(input.startDate) ?? validDate(input.endDate) ?? now;
  const freq = input.frequency;
  const interval = Math.max(1, Math.round(Number(input.interval) || 1));

  const dow = freq === 'weekly'
    ? (input.dayOfWeek != null && input.dayOfWeek >= 0 && input.dayOfWeek <= 6 ? input.dayOfWeek : recurrenceDayOfWeek(base))
    : undefined;
  const dom = freq === 'monthly'
    ? (input.dayOfMonth != null && input.dayOfMonth >= 1 && input.dayOfMonth <= 31 ? input.dayOfMonth : recurrenceDayOfMonth(base))
    : undefined;
  const days = freq === 'daily'
    ? (Array.isArray(input.daysOfWeek) && input.daysOfWeek.length > 0
      ? [...new Set(input.daysOfWeek.filter(d => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b)
      : DEFAULT_DAILY_DAYS)
    : undefined;
  const daysOrDefault = days && days.length > 0 ? days : DEFAULT_DAILY_DAYS;

  const rawNext = addFrequency(base, freq, dow ?? null, dom ?? null, interval, daysOrDefault);
  const next = rawNext.getTime() < now.getTime()
    ? addFrequency(now, freq, dow ?? null, dom ?? null, interval, daysOrDefault)
    : rawNext;

  const endDate = recurringEndDateFromInput(input.endDateRaw);
  return {
    isRecurring: true,
    recurringFrequency: freq,
    recurringInterval: interval,
    recurringDayOfWeek: dow,
    recurringDayOfMonth: dom,
    recurringDaysOfWeek: days && days.length > 0 ? days : (freq === 'daily' ? DEFAULT_DAILY_DAYS : undefined),
    recurringEndDate: endDate ?? undefined,
    nextRecurringDate: next,
  };
}

/** Reads the quick form's recurrence fields off its FormData (shared parser). */
export function recurrenceSeedFromForm(
  formData: Pick<FormData, 'get'>,
  dates: { startDate?: Date | null; endDate?: Date | null },
  now?: Date,
): RecurrenceSeedPatch | null {
  if (formData.get('isRecurring') !== 'true') return null;
  const frequency = formData.get('recurringFrequency');
  if (!isRecurringFrequency(frequency)) return null;
  const num = (key: string): number | null => {
    const raw = formData.get(key);
    if (raw === null || raw === '') return null;
    const n = parseInt(String(raw), 10);
    return Number.isFinite(n) ? n : null;
  };
  let daysOfWeek: number[] | null = null;
  const daysRaw = formData.get('recurringDaysOfWeek');
  if (typeof daysRaw === 'string' && daysRaw) {
    try {
      const parsed = JSON.parse(daysRaw);
      if (Array.isArray(parsed)) daysOfWeek = parsed.map(Number);
    } catch { daysOfWeek = null; }
  }
  const endRaw = formData.get('recurringEndDate');
  return recurrenceSeedPatch({
    frequency,
    interval: num('recurringInterval'),
    dayOfWeek: num('recurringDayOfWeek'),
    dayOfMonth: num('recurringDayOfMonth'),
    daysOfWeek,
    endDateRaw: typeof endRaw === 'string' ? endRaw : null,
    startDate: dates.startDate ?? null,
    endDate: dates.endDate ?? null,
    now,
  });
}
