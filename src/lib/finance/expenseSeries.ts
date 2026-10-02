// A recurring EXPENSE as an entity: the series (its parent row + every booked
// occurrence) read as one period-by-period ledger.
//
// Until now a recurring expense was a row with a 🔄 badge: the owner could see
// "Qira — mujore" but never "which months did it actually book, what did it
// cost over the year, when did the amount change, which month is missing".
// This module answers those questions from the rows alone (nothing new is
// stored), so the detail page, the list badge and any future report agree.
//
// Laws it inherits from `recurringExpenses.ts`:
//   · the period KEY is the identity of an occurrence, never a timestamp;
//   · the parent row IS its own period's occurrence;
//   · a period with no row is reported, never backfilled by a job — the
//     "Shto manualisht" action here is the owner's decision, and it writes the
//     exact document the cron would have (same id, same shape), so the cron can
//     never add a second one.

import type { Expense, FinanceMonthClose } from '../../types';
import { toAll } from '../utils';
import { getExpenseDate, MONTH_LABELS_SQ } from './financialAnalytics';
import {
  expensePeriodKey,
  nextExpenseOccurrence,
  expenseGenerationBlockReason,
  toExpenseDate,
  FREQ_TO_MONTHLY,
  type ExpenseGenerationBlock,
} from './recurringExpenses';
import { zonedParts } from '../recurringUtils';

const MONTHS_LONG_SQ = ['Janar', 'Shkurt', 'Mars', 'Prill', 'Maj', 'Qershor', 'Korrik', 'Gusht', 'Shtator', 'Tetor', 'Nëntor', 'Dhjetor'];

export const EXPENSE_BLOCK_LABELS: Record<ExpenseGenerationBlock, string> = {
  'not-recurring': 'Përsëritja është ndalur — nuk gjeneron më',
  'auto-generated': 'Rresht i gjeneruar — serinë e drejton origjinali',
  'paused': 'Në pauzë — nuk gjeneron derisa të rinisë',
  'inactive': 'Joaktiv — nuk gjeneron derisa të aktivizohet',
  'unsupported-frequency': 'Frekuencë e pambështetur — seria nuk gjeneron',
  'no-next-date': 'Pa datë të ardhshme — seria nuk gjeneron',
  'not-due': 'Në pritje të datës së ardhshme',
  'series-ended': 'Seria ka mbaruar (data e fundit kaloi)',
  'already-generated': 'Periudha aktuale është regjistruar',
  'stale-period': 'Ka mbetur pas — periudha e humbur nuk rishkruhet, vazhdon me periudhën aktuale',
};

/** Blocks that mean "something is wrong with the series", not "waiting". */
export const EXPENSE_BLOCK_IS_PROBLEM: ReadonlyArray<ExpenseGenerationBlock> =
  ['unsupported-frequency', 'no-next-date', 'stale-period'];

export type SeriesPeriodState =
  /** At least one row is booked in the period. */
  | 'booked'
  /** The period is due (or past) and has no row. */
  | 'missing'
  /** The current period, due later than now — the cron will book it on its day. */
  | 'pending'
  /** A future period the series is expected to book. */
  | 'upcoming';

export type SeriesRowOrigin = 'parent' | 'auto' | 'manual';

export interface SeriesPeriod {
  key: string;
  label: string;
  /** The day the occurrence is (or was) scheduled for. */
  scheduledAt: Date;
  state: SeriesPeriodState;
  rows: Expense[];
  /** Sum of the countable (non-Rejected) rows, in the series' currency. */
  amount: number;
  /** Same, normalised to ALL. */
  amountAll: number;
  currency: string;
  /** All countable rows carry a `paidDate`. */
  paid: boolean;
  paidAt: Date | null;
  approval: 'Approved' | 'Submitted' | 'Rejected' | 'mixed' | null;
  /** More than one countable row for the same period. */
  duplicate: boolean;
  /** Change versus the previous BOOKED period (native currency); null when none. */
  delta: number | null;
  origin: SeriesRowOrigin | 'mixed' | null;
}

export interface AmountChange {
  periodKey: string;
  label: string;
  from: number;
  to: number;
  pct: number;
}

export interface ExpenseSeriesLedger {
  frequency: string;
  currency: string;
  periods: SeriesPeriod[];
  bookedCount: number;
  missingCount: number;
  duplicateCount: number;
  paidCount: number;
  unpaidCount: number;
  totalAll: number;
  /** Total in the series currency — only meaningful when every row shares it. */
  totalNative: number;
  mixedCurrency: boolean;
  averageAll: number;
  firstBookedAt: Date | null;
  lastBookedAt: Date | null;
  amountChanges: AmountChange[];
  /** Rows that claim the series (parentExpenseId) but fall outside its cadence. */
  strayRows: Expense[];
}

export interface SeriesHealth {
  block: ExpenseGenerationBlock | null;
  label: string;
  isProblem: boolean;
  nextDueAt: Date | null;
  endsAt: Date | null;
  /** Known commitment per month / per year, in ALL (0 when the series is not running). */
  monthlyAll: number;
  yearlyAll: number;
  running: boolean;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Human label for a period key: '2026-09' → 'Shtator 2026', 'Q2026-3' → 'T3 2026'. */
export function periodLabel(key: string): string {
  if (/^\d{4}-\d{2}$/.test(key)) {
    const [y, m] = key.split('-').map(Number);
    return `${MONTHS_LONG_SQ[m - 1] || key} ${y}`;
  }
  if (key.startsWith('W')) {
    const [y, m, d] = key.slice(1).split('-').map(Number);
    return `Java e ${d} ${MONTH_LABELS_SQ[m - 1] || ''} ${y}`;
  }
  if (key.startsWith('Q')) {
    const [y, q] = key.slice(1).split('-');
    return `T${q} ${y}`;
  }
  if (key.startsWith('Y')) return key.slice(1);
  return key;
}

/** Short label for a tight bar strip: '2026-09' → 'Sht 26'. */
export function periodShortLabel(key: string): string {
  if (/^\d{4}-\d{2}$/.test(key)) {
    const [y, m] = key.split('-').map(Number);
    return `${MONTH_LABELS_SQ[m - 1] || ''} ${String(y).slice(2)}`;
  }
  if (key.startsWith('W')) {
    const [, m, d] = key.slice(1).split('-').map(Number);
    return `${d} ${MONTH_LABELS_SQ[m - 1] || ''}`;
  }
  if (key.startsWith('Q')) {
    const [y, q] = key.slice(1).split('-');
    return `T${q} ${String(y).slice(2)}`;
  }
  if (key.startsWith('Y')) return key.slice(1);
  return key;
}

export function rowOrigin(row: Pick<Expense, 'isRecurring' | 'autoGenerated'>): SeriesRowOrigin {
  if (row.isRecurring && !row.autoGenerated) return 'parent';
  if (row.autoGenerated) return 'auto';
  return 'manual';
}

/** The period a row belongs to: the stamped key wins, else its booking date. */
export function rowPeriodKey(row: Expense, frequency: string): string | null {
  if (row.periodKey) return row.periodKey;
  const d = getExpenseDate(row);
  return d ? expensePeriodKey(frequency, d) : null;
}

const countable = (e: Expense) => e.approvalStatus !== 'Rejected';

export interface LedgerOptions {
  /** Future periods to list after the current one (default 2). */
  upcoming?: number;
  /** Hard cap on listed periods, oldest dropped first (default 240). */
  maxPeriods?: number;
}

/**
 * The series as a period-by-period ledger, oldest first.
 *
 * Walks the cadence from the parent's own period to the current one (or the
 * series' end, if earlier), then a few upcoming periods. A stopped, paused or
 * inactive series stops at its LAST BOOKED period: the months it was switched
 * off are not "missing", they were never promised.
 */
export function buildExpenseSeriesLedger(
  parent: Expense,
  children: Expense[],
  now: Date,
  opts: LedgerOptions = {},
): ExpenseSeriesLedger {
  const frequency = (parent.recurringFrequency as string) || 'monthly';
  const currency = parent.currency || 'ALL';
  const upcoming = opts.upcoming ?? 2;
  const maxPeriods = opts.maxPeriods ?? 240;

  const rows = [parent, ...children.filter(c => c.id !== parent.id)];
  const byKey = new Map<string, Expense[]>();
  const strayRows: Expense[] = [];
  for (const r of rows) {
    const key = rowPeriodKey(r, frequency);
    if (!key) { strayRows.push(r); continue; }
    const bucket = byKey.get(key);
    if (bucket) bucket.push(r); else byKey.set(key, [r]);
  }

  const ownDate = getExpenseDate(parent) || now;
  const anchor = parent.recurringAnchorDay || zonedParts(ownDate).day;
  const currentKey = expensePeriodKey(frequency, now);
  const endDate = toExpenseDate(parent.recurringEndDate);
  const endKey = endDate ? expensePeriodKey(frequency, endDate) : null;

  // Walk the cadence from the earliest booked period (normally the parent's own,
  // but a child may legitimately predate it after a merge or a manual link).
  let cursor = ownDate;
  const earliestKey = [...byKey.keys()].sort()[0];
  if (earliestKey && earliestKey < expensePeriodKey(frequency, ownDate)) {
    const fd = getExpenseDate(byKey.get(earliestKey)![0]);
    if (fd) cursor = fd;
  }

  const running = !!parent.isRecurring && !parent.isRecurringPaused && (!parent.status || parent.status === 'Active');
  const lastBookedKey = [...byKey.keys()].sort().slice(-1)[0] ?? null;
  // Where the expected walk stops: the current period for a running series,
  // the last booked period otherwise; never past the series' end.
  let stopKey = running ? currentKey : (lastBookedKey ?? currentKey);
  if (endKey && endKey < stopKey) stopKey = endKey;
  if (lastBookedKey && lastBookedKey > stopKey) stopKey = lastBookedKey;

  const periods: SeriesPeriod[] = [];
  const seen = new Set<string>();
  const push = (key: string, scheduledAt: Date, futureState: 'pending' | 'upcoming' | null) => {
    if (seen.has(key)) return;
    seen.add(key);
    const inPeriod = byKey.get(key) || [];
    const live = inPeriod.filter(countable);
    const amount = live.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const amountAll = live.reduce((s, r) => s + toAll(Number(r.amount) || 0, r.currency), 0);
    const approvals = new Set(inPeriod.map(r => r.approvalStatus || 'Submitted'));
    const origins = new Set(inPeriod.map(rowOrigin));
    const paidDates = live.map(r => toExpenseDate(r.paidDate)).filter((d): d is Date => !!d);
    const paid = live.length > 0 && paidDates.length === live.length;
    let state: SeriesPeriodState;
    if (inPeriod.length) state = 'booked';
    else if (futureState) state = futureState;
    else state = 'missing';
    periods.push({
      key,
      label: periodLabel(key),
      scheduledAt,
      state,
      rows: inPeriod,
      amount,
      amountAll,
      currency: live[0]?.currency || currency,
      paid,
      paidAt: paid ? paidDates.sort((a, b) => b.getTime() - a.getTime())[0] : null,
      approval: approvals.size === 0 ? null : approvals.size > 1 ? 'mixed' : ([...approvals][0] as SeriesPeriod['approval']),
      duplicate: live.length > 1,
      delta: null,
      origin: origins.size === 0 ? null : origins.size > 1 ? 'mixed' : [...origins][0],
    });
  };

  let guard = 0;
  let key = expensePeriodKey(frequency, cursor);
  while (guard++ < maxPeriods && key <= stopKey) {
    const isCurrent = key === currentKey;
    push(key, cursor, isCurrent && cursor > now ? 'pending' : null);
    cursor = nextExpenseOccurrence(cursor, frequency, anchor);
    key = expensePeriodKey(frequency, cursor);
  }
  // Booked rows outside the cadence walk (e.g. beyond the end date) still show.
  for (const [k, list] of byKey) {
    if (seen.has(k)) continue;
    const d = getExpenseDate(list[0]) || now;
    push(k, d, null);
  }
  if (running && (!endKey || key <= endKey)) {
    for (let i = 0; i < upcoming && guard++ < maxPeriods; i++) {
      if (endKey && key > endKey) break;
      push(key, cursor, 'upcoming');
      cursor = nextExpenseOccurrence(cursor, frequency, anchor);
      key = expensePeriodKey(frequency, cursor);
    }
  }
  periods.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  // Deltas and amount changes — between consecutive BOOKED periods only.
  const amountChanges: AmountChange[] = [];
  let prevBooked: SeriesPeriod | null = null;
  for (const p of periods) {
    if (p.state !== 'booked' || p.rows.filter(countable).length === 0) continue;
    if (prevBooked && prevBooked.currency === p.currency) {
      p.delta = p.amount - prevBooked.amount;
      if (p.delta !== 0 && !p.duplicate && !prevBooked.duplicate) {
        amountChanges.push({
          periodKey: p.key,
          label: p.label,
          from: prevBooked.amount,
          to: p.amount,
          pct: prevBooked.amount ? (p.delta / prevBooked.amount) * 100 : 0,
        });
      }
    }
    prevBooked = p;
  }

  const booked = periods.filter(p => p.state === 'booked');
  const live = booked.filter(p => p.rows.some(countable));
  const currencies = new Set(rows.filter(countable).map(r => r.currency || 'ALL'));
  const totalAll = live.reduce((s, p) => s + p.amountAll, 0);
  const bookedDates = booked.map(p => getExpenseDate(p.rows[0])).filter((d): d is Date => !!d).sort((a, b) => a.getTime() - b.getTime());

  return {
    frequency,
    currency,
    periods,
    bookedCount: booked.length,
    missingCount: periods.filter(p => p.state === 'missing').length,
    duplicateCount: periods.filter(p => p.duplicate).length,
    paidCount: live.filter(p => p.paid).length,
    unpaidCount: live.filter(p => !p.paid).length,
    totalAll,
    totalNative: live.reduce((s, p) => s + p.amount, 0),
    mixedCurrency: currencies.size > 1,
    averageAll: live.length ? totalAll / live.length : 0,
    firstBookedAt: bookedDates[0] ?? null,
    lastBookedAt: bookedDates[bookedDates.length - 1] ?? null,
    amountChanges,
    strayRows,
  };
}

/** Why the series is (not) generating, plus what it commits per month/year. */
export function expenseSeriesHealth(parent: Expense, now: Date): SeriesHealth {
  const block = expenseGenerationBlockReason(parent, now);
  const running = block === null || block === 'not-due' || block === 'already-generated';
  const perMonth = FREQ_TO_MONTHLY[(parent.recurringFrequency as string) || 'monthly'] || 0;
  const monthlyAll = running ? toAll(Number(parent.amount) || 0, parent.currency) * perMonth : 0;
  return {
    block,
    label: block ? EXPENSE_BLOCK_LABELS[block] : 'Gati — periudha aktuale do të regjistrohet në ekzekutimin e radhës',
    isProblem: !!block && EXPENSE_BLOCK_IS_PROBLEM.includes(block),
    nextDueAt: toExpenseDate(parent.nextRecurringDate),
    endsAt: toExpenseDate(parent.recurringEndDate),
    monthlyAll,
    yearlyAll: monthlyAll * 12,
    running,
  };
}

const normTitle = (t?: string) => (t || '').trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Rows with the same title + currency that are NOT part of this series: a month
 * someone typed by hand when the cron missed it, or a series that was deleted
 * and re-created. They are offered for linking, never linked automatically.
 */
export function findUnlinkedSiblings(parent: Expense, all: Expense[]): Expense[] {
  const title = normTitle(parent.title);
  if (!title) return [];
  const currency = parent.currency || 'ALL';
  return all.filter(e =>
    e.id !== parent.id
    && e.parentExpenseId !== parent.id
    && !(e.isRecurring && !e.autoGenerated)   // another series' parent
    && !e.parentExpenseId                      // already owned by a series
    && normTitle(e.title) === title
    && (e.currency || 'ALL') === currency
    && e.category === parent.category,
  ).sort((a, b) => (getExpenseDate(b)?.getTime() ?? 0) - (getExpenseDate(a)?.getTime() ?? 0));
}

/** Patch that adopts a hand-typed row into the series. */
export function linkSiblingPatch(parent: Expense, row: Expense): Partial<Expense> {
  const frequency = (parent.recurringFrequency as string) || 'monthly';
  return {
    parentExpenseId: parent.id,
    periodKey: rowPeriodKey(row, frequency) || undefined,
  };
}

/** Deterministic occurrence id — must match `recurringExpenseOccurrenceId` in api/cron/run.ts. */
export function recurringExpenseOccurrenceId(parentId: string, periodKey: string): string {
  return `rec_exp_${parentId}_${periodKey}`;
}

export type BackfillBlock = 'not-missing' | 'month-closed' | 'future' | 'approver-only';

/**
 * Why a missing period may not be added by hand right now. `isApprover`
 * mirrors the rules: a `Salary` row is payroll and only an approver may book one.
 */
export function backfillBlockReason(
  period: SeriesPeriod,
  parent: Expense,
  closes: Array<Pick<FinanceMonthClose, 'businessId' | 'periodKey' | 'locked'>> | undefined,
  now: Date,
  isApprover: boolean = true,
): BackfillBlock | null {
  if (period.state !== 'missing') return period.state === 'booked' ? 'not-missing' : 'future';
  if (period.scheduledAt > now) return 'future';
  if (parent.category === 'Salary' && !isApprover) return 'approver-only';
  const z = zonedParts(period.scheduledAt);
  const monthKey = `${z.year}-${pad2(z.month + 1)}`;
  const locked = (closes || []).some(c => c.locked && c.periodKey === monthKey && (!parent.businessId || c.businessId === parent.businessId));
  return locked ? 'month-closed' : null;
}

export const BACKFILL_BLOCK_LABELS: Record<BackfillBlock, string> = {
  'not-missing': 'Periudha është e regjistruar',
  'month-closed': 'Muaji është i mbyllur (Financat → Mbyllja e muajit)',
  'future': 'Periudha nuk ka ardhur ende',
  'approver-only': 'Një rresht page e shton vetëm një aprovues (Admin/Manager)',
};

/**
 * The document the cron WOULD have written for this period — same id, same
 * shape (mirror of the `child` literal in `api/cron/run.ts`), so a later cron
 * run finds the period claimed and never books it twice.
 */
export function backfillOccurrenceDraft(parent: Expense, period: SeriesPeriod, userId: string | null, isApprover: boolean = true) {
  // A non-approver may only SUBMIT (rules: approvalStatus must be 'Submitted'),
  // so the inherited approval is kept only when the caller could grant it.
  const inherited = parent.approvalStatus === 'Rejected' ? 'Submitted' : (parent.approvalStatus || 'Submitted');
  const approvalStatus = isApprover ? inherited : 'Submitted';
  return {
    id: recurringExpenseOccurrenceId(parent.id, period.key),
    data: {
      title: parent.title,
      description: parent.description || null,
      amount: parent.amount,
      currency: parent.currency || 'ALL',
      category: parent.category,
      // `undefined`, never `null`: `removeUndefined()` drops it and the mutation
      // hook stamps the active team/business — a literal null would survive and
      // fail the rules' `businessOfTeam(teamId)` check.
      teamId: parent.teamId || undefined,
      businessId: parent.businessId || undefined,
      projectId: parent.projectId || null,
      departmentId: parent.departmentId || null,
      memberId: parent.memberId || null,
      isRecurring: false,
      autoGenerated: true,
      parentExpenseId: parent.id,
      periodKey: period.key,
      status: parent.status || 'Active',
      approvalStatus,
      approvedByUserId: approvalStatus === 'Approved' ? (parent.approvedByUserId || userId || null) : null,
      date: period.scheduledAt,
      // Added by hand, by this person — the cron leaves `createdByUserId` as the
      // parent's; here the owner's decision is the fact worth recording.
      createdByUserId: userId,
      backfilledAt: new Date(),
    },
  };
}

/**
 * What the PARENT must learn after a manual backfill: the claim moves forward
 * only if this period is newer than the one already claimed, and the pointer
 * advances only if it was still sitting in or before this period. A backfill of
 * an OLD month never touches either (the audit script follows the same law).
 */
export function backfillParentPatch(parent: Expense, period: SeriesPeriod): Partial<Expense> | null {
  const frequency = (parent.recurringFrequency as string) || 'monthly';
  const patch: Partial<Expense> = {};
  const claim = parent.lastGeneratedPeriodKey;
  if (!claim || period.key > claim) patch.lastGeneratedPeriodKey = period.key;
  const next = toExpenseDate(parent.nextRecurringDate);
  if (parent.isRecurring && next && expensePeriodKey(frequency, next) <= period.key) {
    const anchor = parent.recurringAnchorDay || zonedParts(next).day;
    patch.nextRecurringDate = nextExpenseOccurrence(period.scheduledAt, frequency, anchor);
  }
  return Object.keys(patch).length ? patch : null;
}
