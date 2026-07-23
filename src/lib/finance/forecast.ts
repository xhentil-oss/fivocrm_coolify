// Next-month profit forecast for the owner dashboard.
//
// Grounded and transparent: predicts next month from what we can actually see —
//   revenue      = trailing 3-month average of collected revenue
//   other costs  = trailing 3-month average of non-salary expenses
//   salary       = next month's payroll (history-aware, exact — not averaged)
//   profit       = revenue − salary − other costs
// It deliberately mirrors FinancesView's own monthProfit definition so the
// forecast is comparable to the actuals shown right above it.

import type { Invoice, Expense, TeamMember } from '../../types';
import { getInvoiceCollectedBetween, calculateExpensesBetween } from './financialAnalytics';
import { totalSalaryForMonth } from './salaryHistory';

export interface NextMonthForecast {
  year: number;
  monthIndex: number;        // 0-11 of the forecast month
  basisMonths: number;       // trailing months averaged
  predictedRevenue: number;
  predictedSalary: number;
  predictedOtherExpenses: number;
  predictedProfit: number;
}

function monthWindow(base: Date, offset: number) {
  const d = new Date(base.getFullYear(), base.getMonth() + offset, 1);
  const start = new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
  return { start, end, monthIndex: d.getMonth(), year: d.getFullYear() };
}

export function forecastNextMonth(
  invoices: Invoice[] | undefined | null,
  expenses: Expense[] | undefined | null,
  teamMembers: TeamMember[] | undefined | null,
  now: Date = new Date(),
): NextMonthForecast {
  const inv = invoices || [];
  const exp = expenses || [];

  // Trailing 3 full months (offsets -1, -2, -3).
  const OFFSETS = [-1, -2, -3];
  const collected: number[] = [];
  const otherExp: number[] = [];
  for (const off of OFFSETS) {
    const w = monthWindow(now, off);
    collected.push(inv.reduce((s, i) => s + getInvoiceCollectedBetween(i, w.start, w.end), 0));
    otherExp.push(calculateExpensesBetween(exp, w.start, w.end)); // excludes Salary category
  }
  const basisMonths = OFFSETS.length;
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

  const next = monthWindow(now, 1);
  const predictedRevenue = mean(collected);
  const predictedOtherExpenses = mean(otherExp);
  const predictedSalary = totalSalaryForMonth(teamMembers, next.end);
  const predictedProfit = predictedRevenue - predictedSalary - predictedOtherExpenses;

  return {
    year: next.year,
    monthIndex: next.monthIndex,
    basisMonths,
    predictedRevenue,
    predictedSalary,
    predictedOtherExpenses,
    predictedProfit,
  };
}
