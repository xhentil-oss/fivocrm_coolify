/**
 * Payroll cost for a period — the ONE answer to "what did the salaries cost".
 *
 * Two sources of truth existed and never met:
 *
 *   · `teamMembers.monthlySalary` (+ `salaryHistory`) — a PLAN. Financat charged
 *     it into every month of the period, whatever actually happened.
 *   · `expenses` rows with `category: 'Salary'` — actual PAYMENTS, one per
 *     person per month, entered by the owner (the expense form even has a staff
 *     picker for it). Every expense total in `financialAnalytics.ts` filters
 *     them out to avoid double-charging the plan, so on Financat this money
 *     appeared on NO line at all — while /app/expenses counted it in "Shpenzime
 *     Totale". The two pages disagreed by the whole payroll (2.96M ALL on the
 *     first tenant audited), and money paid to people who are NOT team members
 *     (freelancers, models) was invisible everywhere.
 *
 * The rule here: **a month that has recorded salary payments is costed from
 * those rows; a month with none falls back to the plan.** Recorded rows win
 * because they are what left the bank — including payments to people who were
 * never on the member list. The plan remains the fallback so a month the owner
 * simply has not entered yet is not reported as free.
 *
 * `basis` is returned, never hidden: the UI must be able to say which of the two
 * it is showing, otherwise the fallback looks like a bug (and it is exactly the
 * case where Financat and Shpenzimet still differ, on purpose).
 *
 * INVARIANT for callers: expense-row sums must keep excluding
 * `category: 'Salary'` (they all do, via `calculateExpensesBetween` /
 * `isProjectDirectExpense`). Adding the rows to an expense total AND the payroll
 * term here is the double-charge this module exists to prevent.
 */

import type { Expense, TeamMember } from '../../types';
import { toAll } from '../utils';
import {
  EXPENSE_CATEGORY_SALARY,
  expenseIsCountable,
  getExpenseDate,
} from './financialAnalytics';
import { totalSalaryForMonth } from './salaryHistory';

export type PayrollBasis = 'recorded' | 'profile' | 'none';

export interface MonthPayroll {
  /** What to charge for this month, in ALL. */
  total: number;
  basis: PayrollBasis;
  /** Sum of Salary-category expense rows inside the window, in ALL. */
  recorded: number;
  /** What `teamMembers.monthlySalary`/`salaryHistory` says the month costs. */
  profile: number;
  /** How many Salary rows fed `recorded`. */
  rowCount: number;
}

export interface PeriodPayroll {
  total: number;
  recorded: number;
  profile: number;
  rowCount: number;
  /** Months costed from recorded rows / from the plan. */
  monthsRecorded: number;
  monthsProfile: number;
  months: Array<MonthPayroll & { year: number; monthIndex: number }>;
  /** True when at least one month fell back to the plan — the only remaining
   *  reason Financat and Shpenzimet can disagree, so the UI can say so. */
  hasFallback: boolean;
}

/** Salary-category rows booked inside [start, end], in ALL. */
export function recordedPayrollBetween(
  expenses: Expense[] | undefined | null,
  start: Date,
  end: Date,
): { amount: number; count: number } {
  let amount = 0;
  let count = 0;
  for (const e of expenses ?? []) {
    if (e.category !== EXPENSE_CATEGORY_SALARY) continue;
    if (!expenseIsCountable(e)) continue;
    const d = getExpenseDate(e);
    if (!d || d < start || d > end) continue;
    amount += toAll(e.amount ?? 0, e.currency);
    count += 1;
  }
  return { amount, count };
}

/**
 * Payroll for one month window.
 *
 * `[monthStart, monthEnd]` bounds the recorded rows. `planAt` prices the plan
 * fallback and defaults to `monthEnd`; pass the real end of the month when the
 * window is month-to-date, so a mid-month view does not price the plan off a
 * date `salaryHistory` has not reached yet.
 */
export function payrollForMonth(
  members: TeamMember[] | undefined | null,
  expenses: Expense[] | undefined | null,
  monthStart: Date,
  monthEnd: Date,
  planAt: Date = monthEnd,
): MonthPayroll {
  const { amount: recorded, count } = recordedPayrollBetween(expenses, monthStart, monthEnd);
  const profile = totalSalaryForMonth(members, planAt);
  if (recorded > 0) {
    return { total: recorded, basis: 'recorded', recorded, profile, rowCount: count };
  }
  return {
    total: profile,
    basis: profile > 0 ? 'profile' : 'none',
    recorded: 0,
    profile,
    rowCount: 0,
  };
}

/**
 * Payroll across every calendar month touched by [start, end].
 *
 * Each month is resolved independently, so a period can mix "March: what we
 * actually paid" with "April: what the plan says" — which is exactly what the
 * data looks like in practice. The first and last month are clamped to the
 * range, so a month-to-date period only counts rows already booked.
 */
export function payrollMonths(
  members: TeamMember[] | undefined | null,
  expenses: Expense[] | undefined | null,
  start: Date,
  end: Date,
): Array<MonthPayroll & { year: number; monthIndex: number }> {
  const out: Array<MonthPayroll & { year: number; monthIndex: number }> = [];
  if (end < start) return out;
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  const lastMonth = new Date(end.getFullYear(), end.getMonth(), 1);
  let guard = 0;
  while (cursor.getTime() <= lastMonth.getTime() && guard < 600) {
    const y = cursor.getFullYear();
    const m = cursor.getMonth();
    const rawStart = new Date(y, m, 1, 0, 0, 0, 0);
    const rawEnd = new Date(y, m + 1, 0, 23, 59, 59, 999);
    // Clamp to the requested range so a partial first/last month only counts
    // the rows inside it, while the plan is still priced off the month's end.
    const winStart = rawStart < start ? start : rawStart;
    const winEnd = rawEnd > end ? end : rawEnd;
    const month = payrollForMonth(members, expenses, winStart, winEnd, rawEnd);
    out.push({ year: y, monthIndex: m, ...month });
    cursor.setMonth(cursor.getMonth() + 1);
    guard++;
  }
  return out;
}

/** Aggregate of `payrollMonths` — the figure to charge for the whole period. */
export function payrollBetween(
  members: TeamMember[] | undefined | null,
  expenses: Expense[] | undefined | null,
  start: Date,
  end: Date,
): PeriodPayroll {
  const months = payrollMonths(members, expenses, start, end);
  let total = 0, recorded = 0, profile = 0, rowCount = 0, monthsRecorded = 0, monthsProfile = 0;
  for (const m of months) {
    total += m.total;
    recorded += m.recorded;
    profile += m.profile;
    rowCount += m.rowCount;
    if (m.basis === 'recorded') monthsRecorded += 1;
    else if (m.basis === 'profile') monthsProfile += 1;
  }
  return {
    total, recorded, profile, rowCount, months,
    monthsRecorded, monthsProfile,
    hasFallback: monthsProfile > 0,
  };
}

/**
 * Payroll to EXPECT next month — a forward commitment, not history.
 *
 * Same precedence as `payrollForMonth`: what was actually PAID wins. The average
 * of the last `monthsBack` complete months with recorded salary rows is what next
 * month will most likely cost (it includes the freelancers and models the plan
 * structurally cannot); the plan (`monthlySalary`) is the fallback when nothing
 * has been recorded. The old order (plan first) made the forecast and the
 * cash-flow gap read a stale 500 000 plan while the hero, two rows above, charged
 * the 2 000 000 that really left the bank every month.
 */
export function forwardPayrollEstimate(
  members: TeamMember[] | undefined | null,
  expenses: Expense[] | undefined | null,
  now: Date,
  monthsBack = 3,
): { amount: number; basis: PayrollBasis } {
  let sum = 0;
  let months = 0;
  for (let i = 1; i <= monthsBack; i++) {
    const s = new Date(now.getFullYear(), now.getMonth() - i, 1, 0, 0, 0, 0);
    const e = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59, 999);
    const { amount } = recordedPayrollBetween(expenses, s, e);
    if (amount > 0) { sum += amount; months += 1; }
  }
  if (months > 0) return { amount: sum / months, basis: 'recorded' };

  const nextMonthEnd = new Date(now.getFullYear(), now.getMonth() + 2, 0, 23, 59, 59, 999);
  const plan = totalSalaryForMonth(members, nextMonthEnd);
  if (plan > 0) return { amount: plan, basis: 'profile' };
  return { amount: 0, basis: 'none' };
}

/** Short Albanian label for a basis — used wherever a payroll figure is shown. */
export function payrollBasisLabel(basis: PayrollBasis): string {
  if (basis === 'recorded') return 'pagesa të regjistruara';
  if (basis === 'profile') return 'nga lista e pagave';
  return 'pa pagë';
}
