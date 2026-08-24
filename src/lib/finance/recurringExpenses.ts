// Recurring EXPENSES — which period an occurrence belongs to, when the next one
// is due, and which rows are duplicates of each other inside one period.
//
// Background (audited against production data, Aug 2026): the expense recurrence
// engine had the same class of bug the project-billing engine had before
// `recurringBilling.ts` — the idempotency token was a TIMESTAMP, not a period:
//
//   · `lastChildCreatedAt >= nextRecurringDate` skips generation. When a series
//     lagged more than one cycle (cron downtime, a back-dated start), the first
//     catch-up child was created "now", which is newer than every remaining past
//     due date — so the guard stayed true forever and the series DIED silently
//     after one occurrence.
//   · a recurring parent is itself a real expense row that counts in its own
//     month. With `nextRecurringDate` inside that same month, the cron added a
//     second row for a period that was already covered (observed live:
//     "Migena" 70 000 ALL — parent 17 Jul + generated child 30 Jul).
//   · `isRecurring` with NO `nextRecurringDate` never generates anything at all
//     (observed live on 4 salary series ≈ 299 000 ALL/month simply missing).
//   · `setMonth(+1)` on the 31st overflows into the month after next, so a
//     month-end series silently skips months.
//
// Everything that decides "which period is this, and may it generate" now lives
// here, is unit-tested, and is mirrored by `expensePeriodKey` /
// `expenseGenerationBlockReason` in `api/cron/run.ts` — keep the two in sync.

import type { Expense, ExpenseFrequency } from '../../types';
import { toAll } from '../utils';
import { startOfBillingWeek } from './recurringBilling';

export type { ExpenseFrequency };

/**
 * `quarterly` is supported deliberately. It used to exist in HALF the system:
 * `FREQ_TO_MONTHLY` in cashflowAlarms.ts costed it at 1/3 of a month, while the
 * engine refused it with `unsupported-frequency` — so a legacy quarterly series
 * fed the cash-flow alarm with money that was never going to be booked, and sat
 * dead with no UI surface at all. Either half had to go; generating it is the
 * half the user actually wanted.
 */
export const SUPPORTED_EXPENSE_FREQUENCIES: ReadonlyArray<ExpenseFrequency> =
  ['weekly', 'monthly', 'quarterly', 'yearly'];

export type ExpenseGenerationBlock =
  | 'not-recurring'
  | 'auto-generated'
  | 'paused'
  | 'unsupported-frequency'
  | 'no-next-date'
  | 'not-due'
  | 'series-ended'
  | 'already-generated';

/** Blocks that end the series for good — the caller should clear `isRecurring`. */
export const PERMANENT_EXPENSE_BLOCKS: ReadonlyArray<ExpenseGenerationBlock> = ['series-ended'];

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function toExpenseDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  const ts = value as { toDate?: () => Date };
  if (typeof ts.toDate === 'function') {
    const d = ts.toDate();
    return d instanceof Date && !isNaN(d.getTime()) ? d : null;
  }
  const d = new Date(value as string | number);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Stable key for the period `at` falls in. At most ONE occurrence may exist per
 * (series, key) — this is the idempotency token that replaces the old
 * "is the last child newer than the due date?" comparison.
 *
 *   monthly → '2026-08'   weekly → 'W2026-08-03' (Monday anchor)
 *   quarterly → 'Q2026-3' yearly → 'Y2026'
 */
export function expensePeriodKey(frequency: string, at: Date): string {
  if (frequency === 'weekly') {
    const monday = startOfBillingWeek(at);
    return `W${monday.getFullYear()}-${pad2(monday.getMonth() + 1)}-${pad2(monday.getDate())}`;
  }
  if (frequency === 'yearly') return `Y${at.getFullYear()}`;
  if (frequency === 'quarterly') return `Q${at.getFullYear()}-${Math.floor(at.getMonth() / 3) + 1}`;
  return `${at.getFullYear()}-${pad2(at.getMonth() + 1)}`;
}

/**
 * Add months without the `setMonth` overflow: 31 Jan + 1 month is 28/29 Feb, not
 * 2/3 Mar. `anchorDay` keeps a month-end series pinned to its original day, so
 * Jan 31 → Feb 28 → Mar 31 instead of degrading to the 28th forever.
 */
export function addMonthsClamped(from: Date, months: number, anchorDay?: number): Date {
  const day = anchorDay ?? from.getDate();
  const out = new Date(from.getFullYear(), from.getMonth() + months, 1,
    from.getHours(), from.getMinutes(), from.getSeconds(), from.getMilliseconds());
  const lastDayOfTarget = new Date(out.getFullYear(), out.getMonth() + 1, 0).getDate();
  out.setDate(Math.min(day, lastDayOfTarget));
  return out;
}

/** The due date one cycle after `from`. `anchorDay` guards against month-end drift. */
export function nextExpenseOccurrence(from: Date, frequency: string, anchorDay?: number): Date {
  if (frequency === 'weekly') {
    const out = new Date(from);
    out.setDate(out.getDate() + 7);
    return out;
  }
  if (frequency === 'yearly') {
    const out = new Date(from);
    out.setFullYear(out.getFullYear() + 1);
    return out;
  }
  // Quarterly and monthly both go through the clamped adder, never setMonth():
  // 30 Nov + 3 months must be 28/29 Feb, not 2 Mar.
  if (frequency === 'quarterly') return addMonthsClamped(from, 3, anchorDay);
  return addMonthsClamped(from, 1, anchorDay);
}

/**
 * The date the FIRST generated occurrence is due for a series created at
 * `createdAt`, given the date the user picked (which may be empty or inside the
 * period the parent row already covers).
 *
 * The parent expense is itself a real row that counts in its own month, so the
 * engine must start at the NEXT period — otherwise the month is billed twice.
 * A day the user explicitly picked is preserved; only the period moves forward.
 *
 * The result is ALWAYS in a period strictly after the parent's own. A single
 * `!==` comparison was not enough: a date typed in the PAST (a mistyped year, a
 * back-dated series) is also in a "different" period, so it was accepted as-is
 * and the cron then generated one row per missed period — silently rewriting
 * closed books, which `seedNextRecurringDate` documents as the owner's call and
 * never a cron job's.
 */
export function firstGenerationDate(createdAt: Date, frequency: string, picked?: Date | null): Date {
  if (!picked) return nextExpenseOccurrence(createdAt, frequency);
  const ownKey = expensePeriodKey(frequency, createdAt);
  const anchorDay = picked.getDate();
  let out = picked;
  // Advance whole cycles (never a raw month/day jump) so the chosen day-of-month
  // — and, for a yearly series, the chosen month — survive the move forward.
  for (let guard = 0; guard < 600; guard++) {
    if (out > createdAt && expensePeriodKey(frequency, out) !== ownKey) return out;
    out = nextExpenseOccurrence(out, frequency, anchorDay);
  }
  return out;
}

/**
 * Due date to seed onto a series that is marked recurring but has no
 * `nextRecurringDate` — it never generated anything at all.
 *
 * Seeded FORWARD from `now`, never from the parent's own date: backfilling the
 * months the series missed would rewrite closed books (and re-open every P&L,
 * cashflow alarm and report built on them). Which is the owner's call, not a
 * cron job's — the missing months are surfaced in the UI instead.
 */
export function seedNextRecurringDate(ownDate: Date, now: Date, frequency: string): Date {
  const anchor = ownDate > now ? ownDate : now;
  return nextExpenseOccurrence(anchor, frequency, ownDate.getDate());
}

export interface RecurringExpenseCandidate {
  isRecurring?: boolean;
  isRecurringPaused?: boolean;
  autoGenerated?: boolean;
  recurringFrequency?: string;
  nextRecurringDate?: unknown;
  recurringEndDate?: unknown;
  lastGeneratedPeriodKey?: string;
}

/**
 * Why this series may NOT generate right now, or `null` when an occurrence is
 * due. Order matters: permanent blocks come first so the caller can clear
 * `isRecurring` instead of re-reading the doc every run.
 */
export function expenseGenerationBlockReason(
  expense: RecurringExpenseCandidate,
  now: Date,
): ExpenseGenerationBlock | null {
  if (!expense.isRecurring) return 'not-recurring';
  // Children are plain rows — only the original drives the series.
  if (expense.autoGenerated) return 'auto-generated';

  const frequency = expense.recurringFrequency || 'monthly';
  if (!SUPPORTED_EXPENSE_FREQUENCIES.includes(frequency as ExpenseFrequency)) return 'unsupported-frequency';

  const nextDate = toExpenseDate(expense.nextRecurringDate);
  if (!nextDate) return 'no-next-date';

  // "Repeat until" is checked before the pause flag so an expired series is
  // always cleaned up rather than left dormant.
  const endDate = toExpenseDate(expense.recurringEndDate);
  if (endDate && nextDate > endDate) return 'series-ended';

  if (expense.isRecurringPaused) return 'paused';
  if (nextDate > now) return 'not-due';

  // The period key — not a timestamp — decides whether this cycle was covered.
  if (expense.lastGeneratedPeriodKey === expensePeriodKey(frequency, nextDate)) return 'already-generated';

  return null;
}

export function isPermanentExpenseBlock(reason: ExpenseGenerationBlock | null): boolean {
  return !!reason && PERMANENT_EXPENSE_BLOCKS.includes(reason);
}

// ── Known monthly commitment ────────────────────────────────────────────────
// Lives here, not in cashflowAlarms.ts, because that module imports forecast.ts
// and BOTH need this number — putting it there would have been an import cycle.

/**
 * Cycles per month, for normalising a recurring commitment to a monthly rate.
 *
 * Every key MUST be in `SUPPORTED_EXPENSE_FREQUENCIES`: `quarterly` used to sit
 * in this table while the engine refused to generate it, so the cash-flow alarm
 * costed money that was never going to leave the account. Anything absent
 * contributes nothing — the safe direction, since a junk frequency must not be
 * able to invent a fixed cost.
 */
export const FREQ_TO_MONTHLY: Record<string, number> = {
  weekly: 52 / 12,   // ≈4.33
  monthly: 1,
  quarterly: 1 / 3,
  yearly: 1 / 12,
};

/** A parent series that is still generating (not paused, not a generated child). */
export function isActiveRecurringParent(d: {
  isRecurring?: boolean; isRecurringPaused?: boolean; autoGenerated?: boolean;
}): boolean {
  return !!d.isRecurring && !d.isRecurringPaused && !d.autoGenerated;
}

/**
 * Known fixed expense commitment per month, in ALL.
 *
 * The single definition shared by the cash-flow gap alarm and the profit
 * forecast. They used to derive next month's expenses two different ways — one
 * from active recurring parents, the other from a trailing 3-month average — so
 * two cards on the same screen disagreed by construction.
 *
 * Salary-category rows are excluded: payroll is costed from
 * `salaryHistory`/`monthlySalary`, so counting a row too would double-charge it.
 */
export function monthlyRecurringExpenseRate(
  expenses: Array<Partial<Expense>> | undefined | null,
): number {
  return (expenses || []).reduce((s, e) => {
    if (!isActiveRecurringParent(e)) return s;
    if (e.category === 'Salary') return s;
    if (e.approvalStatus === 'Rejected') return s;
    const perMonth = FREQ_TO_MONTHLY[e.recurringFrequency || 'monthly'];
    if (!perMonth) return s;
    return s + toAll(e.amount || 0, e.currency) * perMonth;
  }, 0);
}

/**
 * Does this row belong to a recurring series (the parent itself, or one of its
 * generated occurrences)?
 *
 * Used to keep the forecast honest: recurring cost is taken from the known
 * commitment rate above, so averaging the SAME rows into the trailing one-off
 * average would count them twice.
 */
export function belongsToRecurringSeries(e: {
  isRecurring?: boolean; autoGenerated?: boolean; parentExpenseId?: string | null;
}): boolean {
  return !!e.isRecurring || !!e.autoGenerated || !!e.parentExpenseId;
}

// ── Duplicate detection ─────────────────────────────────────────────────────
// Two rows for the same thing inside one month is the failure mode that actually
// costs money: it inflates the P&L, the cashflow alarms and every "sa shpenzuam"
// number. Detection only ever SUGGESTS — nothing is deleted automatically.

export type DuplicateExpenseKind = 'manual' | 'auto' | 'parent';

export interface DuplicateExpenseGroup<T> {
  key: string;
  title: string;
  currency: string;
  periodKey: string;
  amountAll: number;
  /** Money counted more than once by this group: (n − 1) × amount, in ALL. */
  wasteAll: number;
  expenses: T[];
}

export function expenseRowKind(exp: { autoGenerated?: boolean; isRecurring?: boolean }): DuplicateExpenseKind {
  if (exp.autoGenerated) return 'auto';
  if (exp.isRecurring) return 'parent';
  return 'manual';
}

type DuplicateCandidate = Pick<Expense, 'id' | 'title' | 'amount' | 'currency'> & {
  date?: unknown;
  createdAt?: unknown;
  approvalStatus?: string;
};

/**
 * Rows that look like the same expense recorded twice in one period: same
 * normalised title, same amount, same currency, same period.
 *
 * A `Rejected` row is excluded — it is already neutralised in every total, so
 * flagging it would be noise. The comparison is deliberately strict (exact
 * amount) so the panel never asks the user to review a false positive; a
 * near-miss is better left to the eye than guessed at.
 */
export function findDuplicateExpenseGroups<T extends DuplicateCandidate>(
  expenses: T[] | undefined,
  frequency: string = 'monthly',
): DuplicateExpenseGroup<T>[] {
  const groups = new Map<string, T[]>();

  (expenses || []).forEach(exp => {
    if (exp.approvalStatus === 'Rejected') return;
    const d = toExpenseDate((exp as any).date) || toExpenseDate((exp as any).createdAt);
    if (!d) return;
    const title = (exp.title || '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (!title) return;
    const amount = Number(exp.amount) || 0;
    if (amount <= 0) return;
    const currency = (exp as any).currency || 'ALL';
    const key = [title, amount, currency, expensePeriodKey(frequency, d)].join('|');
    const bucket = groups.get(key);
    if (bucket) bucket.push(exp); else groups.set(key, [exp]);
  });

  const out: DuplicateExpenseGroup<T>[] = [];
  groups.forEach((list, key) => {
    if (list.length < 2) return;
    const [, amountRaw, currency, periodKey] = key.split('|');
    const amountAll = toAll(Number(amountRaw), currency);
    out.push({
      key,
      title: (list[0].title || '').trim(),
      currency,
      periodKey,
      amountAll,
      wasteAll: amountAll * (list.length - 1),
      expenses: list,
    });
  });

  return out.sort((a, b) => b.wasteAll - a.wasteAll);
}

/** Total money double-counted across every duplicate group, in ALL. */
export function totalDuplicateWaste<T>(groups: DuplicateExpenseGroup<T>[]): number {
  return groups.reduce((s, g) => s + g.wasteAll, 0);
}
