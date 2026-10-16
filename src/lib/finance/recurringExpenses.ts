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
//
// MIRROR NOTE (Sep 2026): two rules the cron copy must carry as well —
//   · a yearly step is `addMonthsClamped(+12, anchorDay)`, never a raw year
//     bump: 29 Feb + 1 year overflowed to 1 Mar and the series lost its day;
//   · `'stale-period'`: a due date whose period key is BEFORE the current
//     period's is a period the series MISSED. The engine refuses to generate it
//     (backfilling rewrites closed books — the owner's call); the cron skips it,
//     reports it, and advances `nextRecurringDate` forward. It is not permanent.

import type { Expense, ExpenseFrequency } from '../../types';
import { toAll } from '../utils';
import { startOfBillingWeek } from './recurringBilling';
// Period keys are calendar questions and are answered in ONE declared zone —
// read with the machine's getters the browser (Europe/Tirane) and the cron body
// (Vercel, UTC) disagreed about which month an occurrence belonged to, which
// either blocked a series forever or booked its month twice. See recurringUtils.
import { zonedParts, addZonedDays, addZonedMonthsClamped } from '../recurringUtils';

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
  | 'inactive'
  | 'unsupported-frequency'
  | 'no-next-date'
  | 'not-due'
  | 'series-ended'
  | 'already-generated'
  /** The due date's period is already behind the current one — missed, never backfilled. */
  | 'stale-period'
  /**
   * The parent itself was REJECTED. A rejected cost is out of every total, yet the
   * series kept generating a fresh `Submitted` child every period — re-queuing
   * the very charge the approver had refused. Not permanent: re-approving the
   * parent resumes it.
   */
  | 'rejected';

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
    const m = zonedParts(startOfBillingWeek(at));
    return `W${m.year}-${pad2(m.month + 1)}-${pad2(m.day)}`;
  }
  const p = zonedParts(at);
  if (frequency === 'yearly') return `Y${p.year}`;
  if (frequency === 'quarterly') return `Q${p.year}-${Math.floor(p.month / 3) + 1}`;
  return `${p.year}-${pad2(p.month + 1)}`;
}

/**
 * Add months without the `setMonth` overflow: 31 Jan + 1 month is 28/29 Feb, not
 * 2/3 Mar. `anchorDay` keeps a month-end series pinned to its original day, so
 * Jan 31 → Feb 28 → Mar 31 instead of degrading to the 28th forever.
 */
export function addMonthsClamped(from: Date, months: number, anchorDay?: number): Date {
  return addZonedMonthsClamped(from, months, anchorDay);
}

/** The due date one cycle after `from`. `anchorDay` guards against month-end drift. */
export function nextExpenseOccurrence(from: Date, frequency: string, anchorDay?: number): Date {
  if (frequency === 'weekly') return addZonedDays(from, 7);
  // A year is twelve clamped months, not a raw year bump: 29 Feb 2028 + 1 year
  // is 28 Feb 2029 (and 29 Feb 2032 again through `anchorDay`), never 1 Mar.
  if (frequency === 'yearly') return addMonthsClamped(from, 12, anchorDay);
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
  const anchorDay = zonedParts(picked).day;
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
 * Heal plan for a series that is marked recurring but has no
 * `nextRecurringDate` — it never generated anything at all.
 *
 * Never BACKWARDS: the periods it missed before the current one are not
 * generated (backfilling rewrites closed books — the owner's call, offered as
 * "Shto manualisht" on the series page). But the CURRENT period is a period like
 * any other: the old heal claimed it and seeded `now + 1 cycle`, so the month
 * the heal ran in was never booked and never reported anywhere. Now the pointer
 * lands on the series' occurrence INSIDE the current period, and the engine's
 * own law ("only the period containing now is generated") decides: due day
 * passed → generated on this run; still ahead → generated on its day.
 *
 * The parent row covers its own period, so when that period is the current one
 * (or later) the series starts after it, exactly like `firstGenerationDate`.
 * The claim only ever moves FORWARD — never onto a period nobody booked.
 * Mirrored by the `no-next-date` heal in `api/cron/run.ts`.
 */
export function healMissingNextDate(
  ownDate: Date,
  now: Date,
  frequency: string,
  anchorDay?: number,
  claim?: string | null,
): { next: Date; claim: string } {
  const anchor = anchorDay || zonedParts(ownDate).day;
  const ownKey = expensePeriodKey(frequency, ownDate);
  const floor = claim && sameKeyShape(claim, ownKey) && claim > ownKey ? claim : ownKey;
  const first = nextExpenseOccurrence(ownDate, frequency, anchor);
  const next = advanceToCurrentPeriod(first, frequency, anchor, now, floor);
  return { next, claim: floor };
}

/** The due date `healMissingNextDate` seeds. Kept for callers that only need the date. */
export function seedNextRecurringDate(ownDate: Date, now: Date, frequency: string): Date {
  return healMissingNextDate(ownDate, now, frequency).next;
}

export interface RecurringExpenseCandidate {
  isRecurring?: boolean;
  isRecurringPaused?: boolean;
  /** 'Active' | 'Inactive' — the form's own on/off switch. */
  status?: string;
  autoGenerated?: boolean;
  recurringFrequency?: string;
  nextRecurringDate?: unknown;
  recurringEndDate?: unknown;
  lastGeneratedPeriodKey?: string;
  approvalStatus?: string;
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
  // The form's Active/Inactive switch used to change nothing at all: a series
  // switched off kept generating rows every month AND kept feeding the
  // cash-flow gap. Treated like a pause — reversible, and it never touches the
  // occurrences already booked.
  if (expense.status && expense.status !== 'Active') return 'inactive';
  // A refused parent must not keep re-submitting itself every period.
  if (expense.approvalStatus === 'Rejected') return 'rejected';
  if (nextDate > now) return 'not-due';

  // The period key — not a timestamp — decides whether this cycle was covered.
  const dueKey = expensePeriodKey(frequency, nextDate);
  if (expense.lastGeneratedPeriodKey === dueKey) return 'already-generated';

  // A due date whose PERIOD is already behind today's is a period the series
  // missed (cron downtime across a month end, a series revived months later).
  // It is never generated here: backfilling a closed month rewrites books that
  // were already reported — the owner's decision, never a job's. Keys of one
  // frequency sort lexicographically ('2026-08' < '2026-09', 'W2026-08-24' <
  // 'W2026-08-31', 'Q2026-2' < 'Q2026-3', 'Y2026' < 'Y2027'), so a plain string
  // comparison is the period order. The cron skips, reports and advances.
  if (dueKey < expensePeriodKey(frequency, now)) return 'stale-period';

  return null;
}

export function isPermanentExpenseBlock(reason: ExpenseGenerationBlock | null): boolean {
  return !!reason && PERMANENT_EXPENSE_BLOCKS.includes(reason);
}

/**
 * The next due date for a series that RESUMES (pause → run, Inactive → Active):
 * the first occurrence in or after the CURRENT period, and past the period the
 * series already claimed.
 *
 * Resuming with the stored `nextRecurringDate` untouched left it pointing into
 * the first paused month, and the cron — which advances the date one cycle per
 * generated row — then backfilled every month the series had been paused,
 * rewriting closed books. Same law as `seedNextRecurringDate`: never backwards.
 * The anchor day is the SERIES' anchor (`recurringAnchorDay`), never re-read
 * from a clamped cursor, so a 31st series is still a 31st series afterwards.
 */
export function advanceToCurrentPeriod(
  from: Date,
  frequency: string,
  anchorDay: number | undefined,
  now: Date,
  claim: string | null | undefined,
): Date {
  const currentKey = expensePeriodKey(frequency, now);
  const anchor = anchorDay || zonedParts(from).day;
  let cursor = from;
  for (let guard = 0; guard < 600; guard++) {
    const key = expensePeriodKey(frequency, cursor);
    if (key >= currentKey && (!claim || key > claim)) return cursor;
    cursor = nextExpenseOccurrence(cursor, frequency, anchor);
  }
  return cursor;
}

/**
 * The write that pauses or resumes a series. Resume re-seeds the next date
 * FORWARD (see `advanceToCurrentPeriod`) so the paused months are never
 * generated; pause touches nothing but the flag. Shared by the list and the
 * series page so the two can never disagree about where a resumed series lands.
 */
export function togglePausePlan(
  expense: {
    isRecurring?: boolean; isRecurringPaused?: boolean; recurringFrequency?: string;
    nextRecurringDate?: unknown; recurringAnchorDay?: number; lastGeneratedPeriodKey?: string;
    date?: unknown; createdAt?: unknown;
  },
  now: Date,
): { paused: boolean; patch: Record<string, unknown>; resumedNext: Date | null; moved: boolean } {
  const paused = !expense.isRecurringPaused;
  let resumedNext: Date | null = null;
  if (!paused && expense.isRecurring) {
    const freq = expense.recurringFrequency || 'monthly';
    const stored = toExpenseDate(expense.nextRecurringDate);
    const own = toExpenseDate(expense.date) || toExpenseDate(expense.createdAt) || now;
    const anchor = expense.recurringAnchorDay || zonedParts(stored || own).day;
    const from = stored || nextExpenseOccurrence(own, freq, anchor);
    resumedNext = advanceToCurrentPeriod(from, freq, anchor, now, expense.lastGeneratedPeriodKey);
  }
  const moved = !!resumedNext && resumedNext.getTime() !== (toExpenseDate(expense.nextRecurringDate)?.getTime() ?? -1);
  const patch: Record<string, unknown> = { isRecurringPaused: paused };
  if (moved && resumedNext) {
    patch.nextRecurringDate = resumedNext;
    patch.recurringAnchorDay = expense.recurringAnchorDay || zonedParts(resumedNext).day;
  }
  return { paused, patch, resumedNext, moved };
}

/** The period key one cycle BEFORE the one containing `now`. */
export function previousExpensePeriodKey(frequency: string, now: Date): string {
  const back = frequency === 'weekly' ? addZonedDays(now, -7)
    : frequency === 'yearly' ? addMonthsClamped(now, -12)
      : frequency === 'quarterly' ? addMonthsClamped(now, -3)
        : addMonthsClamped(now, -1);
  return expensePeriodKey(frequency, back);
}

/** Keys of one frequency share a shape ('2026-08' / 'W…' / 'Q…' / 'Y…'). */
function sameKeyShape(a: string, b: string): boolean {
  const shape = (k: string) => (/^[WQY]/.test(k) ? k[0] : 'M');
  return shape(a) === shape(b);
}

/**
 * Turning recurrence ON for a row that is not (or no longer) a series — the
 * edit form's switch, including RE-ENABLING a series that was stopped.
 *
 * The next date used to be computed from the PARENT's own date, so a series
 * stopped in February and re-enabled in October pointed at March: the cron then
 * walked the "missed" periods and told the owner "8 periudhë pa shpenzim" for
 * months the series had been deliberately off. Same law as resume: the start is
 * the LAST COVERED period (the parent's own, or its newest occurrence), pulled
 * forward to the current period, and the claim is the PREVIOUS period (or the
 * last covered one, if newer) so nothing older reads as skipped and the current
 * period books once — unless it is already covered.
 */
export function reenableRecurrencePlan(input: {
  frequency: string;
  ownDate: Date;
  /** Booking dates of the series' existing occurrences (any origin). */
  occurrenceDates?: Array<Date | null | undefined>;
  /** Period keys the occurrences carry (`periodKey`). */
  occurrenceKeys?: Array<string | null | undefined>;
  /** A stored claim — honoured only when it is in the same frequency. */
  storedClaim?: string | null;
  picked?: Date | null;
  anchorDay?: number | null;
  now: Date;
}): { nextDate: Date; claim: string; anchorDay: number } {
  const { frequency: freq, ownDate, now } = input;
  let lastCovered = ownDate;
  for (const dt of input.occurrenceDates || []) if (dt && dt > lastCovered) lastCovered = dt;
  let claim = expensePeriodKey(freq, lastCovered);
  const candidates = [...(input.occurrenceKeys || []), input.storedClaim];
  for (const k of candidates) if (k && sameKeyShape(k, claim) && k > claim) claim = k;
  const prev = previousExpensePeriodKey(freq, now);
  if (prev > claim) claim = prev;
  const anchor = input.picked ? zonedParts(input.picked).day : (input.anchorDay || zonedParts(ownDate).day);
  const from = input.picked
    ? firstGenerationDate(lastCovered, freq, input.picked)
    : nextExpenseOccurrence(lastCovered, freq, anchor);
  const nextDate = advanceToCurrentPeriod(from, freq, anchor, now, claim);
  return { nextDate, claim, anchorDay: anchor };
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

/**
 * A parent series that is still generating (not paused, not a generated child).
 *
 * `status: 'Inactive'` also stops it. That flag never affected any figure, so a
 * series the owner had explicitly switched off kept feeding the cash-flow gap
 * and the profit forecast with money nobody intended to spend. It deliberately
 * does NOT remove already-booked occurrences from historical totals — a bill
 * that was paid stays paid; this is about FUTURE commitment only.
 */
export function isActiveRecurringParent(d: {
  isRecurring?: boolean; isRecurringPaused?: boolean; autoGenerated?: boolean; status?: string;
  recurringEndDate?: unknown; nextRecurringDate?: unknown;
}, at: Date = new Date()): boolean {
  if (d.status && d.status !== 'Active') return false;
  if (!d.isRecurring || d.isRecurringPaused || d.autoGenerated) return false;
  // A series past its "repeat until" date commits nothing more. The generation
  // engine has always refused it (`series-ended`), but this predicate did not,
  // so between the last occurrence and the cron's clearing pass an ended series
  // still fed the cash-flow gap and the forecast — and a series whose
  // `nextRecurringDate` is missing or stale never reaches that clearing pass at
  // all, so it fed them forever. Same test as `expenseGenerationBlockReason`.
  const endDate = toExpenseDate(d.recurringEndDate);
  if (endDate) {
    const next = toExpenseDate(d.nextRecurringDate) ?? at;
    if (next > endDate) return false;
  }
  return true;
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
  at: Date = new Date(),
): number {
  return (expenses || []).reduce((s, e) => {
    if (!isActiveRecurringParent(e, at)) return s;
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
  memberId?: string | null;
  projectId?: string | null;
  category?: string | null;
};

/**
 * The identity two rows must share to be "the same expense twice": normalised
 * title, amount, currency, period — AND who/where it is for (`memberId`,
 * `projectId`, `category`). Without the last three, two people on the same
 * salary ("Paga" 60 000 for Ana and for Besa) or one subscription billed to two
 * different projects were flagged as a double entry, and the dedupe script then
 * deleted a REAL salary. `scripts/dedupe-expenses.mjs` builds the same key.
 */
export function duplicateExpenseKey(exp: DuplicateCandidate, frequency: string = 'monthly'): string | null {
  if (exp.approvalStatus === 'Rejected') return null;
  const d = toExpenseDate((exp as any).date) || toExpenseDate((exp as any).createdAt);
  if (!d) return null;
  const title = (exp.title || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!title) return null;
  const amount = Number(exp.amount) || 0;
  if (amount <= 0) return null;
  const currency = (exp as any).currency || 'ALL';
  return [
    title, amount, currency, expensePeriodKey(frequency, d),
    exp.memberId || '', exp.projectId || '', exp.category || '',
  ].join('|');
}

/**
 * Rows that look like the same expense recorded twice in one period (see
 * `duplicateExpenseKey` for what "the same" means).
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
    const key = duplicateExpenseKey(exp, frequency);
    if (!key) return;
    const bucket = groups.get(key);
    if (bucket) bucket.push(exp); else groups.set(key, [exp]);
  });

  const out: DuplicateExpenseGroup<T>[] = [];
  groups.forEach((list, key) => {
    if (list.length < 2) return;
    // The title is the only field that may contain '|', so read the tail from the end.
    const parts = key.split('|');
    const amountRaw = parts[parts.length - 6];
    const currency = parts[parts.length - 5];
    const periodKey = parts[parts.length - 4];
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
