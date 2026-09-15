// Next-month profit forecast for the owner dashboard.
//
// Revenue is projected from the PROJECT PIPELINE (not a trailing average):
//   recurring  = budget of monthly/recurring projects still active (each is a
//                monthly fee that will bill again next month)
//   new        = budget of one-time projects whose startDate falls in the
//                forecast month (a project kicking off next month)
// Costs stay grounded, and are split by how KNOWABLE they are:
//   salary     = next month's payroll (history-aware, exact)
//   recurring  = the known commitment rate of active recurring expense series
//                (the SAME number the cash-flow gap alarm uses — the two cards
//                used to predict the same month by two different methods and so
//                disagreed by construction)
//   one-off    = trailing 3-month average of expenses NOT in a recurring series
//   profit     = revenue − salary − recurring − one-off

import type { Expense, TeamMember, Project, Invoice, Subscription } from '../../types';
import {
  parseDate,
  calculateExpensesBetween,
  getInvoiceTotalAll,
} from './financialAnalytics';
import { forwardPayrollEstimate } from './payroll';
import {
  FREQ_TO_MONTHLY,
  monthlyRecurringExpenseRate,
  belongsToRecurringSeries,
} from './recurringExpenses';
import { TERMINAL_PROJECT_STATUSES } from './recurringBilling';
import { hostingMonthlyRecurringRevenue } from '../hosting/finance';
import { toAll } from '../utils';

export interface NextMonthForecast {
  year: number;
  monthIndex: number;          // 0-11 of the forecast month
  basisMonths: number;         // trailing months averaged for expenses
  recurringRevenue: number;    // monthly projects + active recurring invoices
  newProjectRevenue: number;   // one-time projects starting next month
  predictedRevenue: number;    // recurring + new
  predictedSalary: number;
  /** recurringExpenseCommitment + averaged one-offs — what the UI shows. */
  predictedOtherExpenses: number;
  /** Known commitment from active recurring series, per month. */
  recurringExpenseCommitment: number;
  /** Trailing average of expenses that are NOT part of a recurring series. */
  predictedOneOffExpenses: number;
  predictedProfit: number;
}

function monthWindow(base: Date, offset: number) {
  const d = new Date(base.getFullYear(), base.getMonth() + offset, 1);
  const start = new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
  return { start, end, monthIndex: d.getMonth(), year: d.getFullYear() };
}

function billingTypeOf(p: Project): 'one-time' | 'monthly' {
  if (p.billingType === 'monthly' || p.billingType === 'one-time') return p.billingType;
  return (p as any).isRecurring ? 'monthly' : 'one-time';
}

// One-time projects that could still start next month (a Completed/Cancelled/
// Archived project isn't "kicking off").
const ALIVE = new Set(['Active', 'Planning', 'In Review', 'On Hold']);

/**
 * Will this project bill its retainer again next month?
 *
 * Answered against the BILLING ENGINE's rules (`recurringBilling.ts`), not a
 * hand-written status allow-list, because the two disagreed in both directions:
 *   · the allow-list omitted `Completed` — but a completed retainer still bills
 *     ("this cycle's work is done"), so real MRR was under-reported;
 *   · it ignored `isRecurringPaused` and `recurringEndDate` — so a paused or
 *     expired retainer kept counting as predictable income, propping up the
 *     cash-flow gap alarm with money that will never arrive.
 * A gap alarm that under-reports is worse than no alarm: it is the one number
 * meant to warn the owner BEFORE the money runs out.
 */
function projectBillsNextMonth(p: Project, forecastMonthStart: Date): boolean {
  if (billingTypeOf(p) !== 'monthly') return false;
  if ((p as any).isRecurringPaused) return false;
  if (p.status && TERMINAL_PROJECT_STATUSES.includes(p.status)) return false;
  const end = parseDate((p as any).recurringEndDate);
  if (end && end < forecastMonthStart) return false;
  return true;
}

/**
 * Predictable monthly recurring revenue (in ALL), shared by the forecast and the
 * cashflow-health card so they never contradict each other:
 *   monthly-billing projects (active) + active recurring invoices, normalised
 *   to /month, with a recurring invoice skipped when its project is already
 *   counted (invoice.projectId) to avoid double counting.
 */
export function monthlyRecurringRevenue(
  projects: Project[] | undefined | null,
  invoices: Invoice[] | undefined | null,
  now: Date = new Date(),
  hostingSubscriptions?: Subscription[] | null,
): number {
  const forecastMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0);
  const countedProjectIds = new Set<string>();
  let total = 0;
  for (const p of projects || []) {
    const budget = toAll(p.budget || 0, (p as any).currency);
    if (budget <= 0) continue;
    if (projectBillsNextMonth(p, forecastMonthStart)) {
      total += budget;
      countedProjectIds.add(p.id);
    }
  }
  for (const i of invoices || []) {
    if (!(i as any).isRecurring || (i as any).autoGenerated || (i as any).isRecurringPaused) continue;
    if (i.status === 'Draft' || i.status === 'Cancelled') continue;
    // A series past its "repeat until" date generates nothing — the cron clears
    // isRecurring on its next pass, but until then it inflated the forecast.
    const seriesEnd = parseDate((i as any).recurringEndDate);
    if (seriesEnd && seriesEnd < forecastMonthStart) continue;
    if (i.projectId && countedProjectIds.has(i.projectId)) continue;
    total += getInvoiceTotalAll(i) * (FREQ_TO_MONTHLY[(i as any).recurringFrequency || 'monthly'] ?? 1);
  }
  // Third engine: hosting subscriptions we bill ourselves (`source: 'fivocrm'`).
  // Their renewal invoices are `autoGenerated` and never `isRecurring`, so the loop
  // above cannot see them — without this line a reseller's MRR was missing entirely.
  total += hostingMonthlyRecurringRevenue(hostingSubscriptions);
  return total;
}

export function forecastNextMonth(
  projects: Project[] | undefined | null,
  invoices: Invoice[] | undefined | null,
  expenses: Expense[] | undefined | null,
  teamMembers: TeamMember[] | undefined | null,
  now: Date = new Date(),
  hostingSubscriptions?: Subscription[] | null,
): NextMonthForecast {
  const projs = projects || [];
  const exp = expenses || [];
  const next = monthWindow(now, 1);

  // Recurring part = the shared definition (also used by the cashflow card).
  const recurringRevenue = monthlyRecurringRevenue(projs, invoices, now, hostingSubscriptions);

  // New one-time projects that START in the forecast month.
  let newProjectRevenue = 0;
  for (const p of projs) {
    if (billingTypeOf(p) === 'monthly') continue;
    const budget = toAll(p.budget || 0, (p as any).currency);
    if (budget <= 0) continue;
    const start = parseDate((p as any).startDate);
    if (start && start >= next.start && start <= next.end && ALIVE.has(p.status)) {
      newProjectRevenue += budget;
    }
  }

  const predictedRevenue = recurringRevenue + newProjectRevenue;

  // ── Expenses, split by how knowable they are ──
  // A recurring series is a COMMITMENT, not a statistic: take it from the same
  // rate the cash-flow gap alarm uses. Only genuinely irregular spending is
  // averaged — and those rows are excluded from the average, or a retainer would
  // be counted twice (once as commitment, once inside its own trailing months).
  const recurringExpenseCommitment = monthlyRecurringExpenseRate(exp);
  const oneOffs = exp.filter(e => !belongsToRecurringSeries(e));

  const OFFSETS = [-1, -2, -3];
  const basisMonths = OFFSETS.length;
  const predictedOneOffExpenses = OFFSETS.reduce((sum, off) => {
    const w = monthWindow(now, off);
    return sum + calculateExpensesBetween(oneOffs, w.start, w.end); // excludes Salary category
  }, 0) / basisMonths;

  const predictedOtherExpenses = recurringExpenseCommitment + predictedOneOffExpenses;
  // Same forward basis as the cash-flow gap alarm: the plan, or what was
  // actually paid recently when no plan is recorded.
  const predictedSalary = forwardPayrollEstimate(teamMembers, exp, now).amount;
  const predictedProfit = predictedRevenue - predictedSalary - predictedOtherExpenses;

  return {
    year: next.year,
    monthIndex: next.monthIndex,
    basisMonths,
    recurringRevenue,
    newProjectRevenue,
    predictedRevenue,
    predictedSalary,
    predictedOtherExpenses,
    recurringExpenseCommitment,
    predictedOneOffExpenses,
    predictedProfit,
  };
}
