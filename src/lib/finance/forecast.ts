// Next-month profit forecast for the owner dashboard.
//
// Revenue is projected from the PROJECT PIPELINE (not a trailing average):
//   recurring  = fee of every project the BILLING ENGINE will bill again
//                (`projectBillingBlockReason`), normalised to /month by its
//                cycle — a weekly retainer is ~4.33 fees a month, not one
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
import { projectBillingBlockReason, type ProjectBillingBlock } from './recurringBilling';
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
 * Block reasons that mean "the series is alive, it just is not due at the exact
 * instant we asked about". Everything else the engine returns — `not-recurring`,
 * `one-time`, `unsupported-frequency`, `paused`, `terminal-status`,
 * `series-ended` — means no money is coming, so the forecast must not count it.
 */
const TRANSIENT_BILLING_BLOCKS: ReadonlyArray<ProjectBillingBlock> = [
  'already-billed',       // this period's invoice is out; the next one still comes
  'before-billing-day',   // e.g. bills on the 25th, we asked on the 1st
];

/**
 * Will this project bill its retainer again next month?
 *
 * Answered by DELEGATING to the billing engine (`projectBillingBlockReason`),
 * not by a hand-written allow-list, because the hand-written one disagreed with
 * the engine in both directions:
 *   · it omitted `Completed` — but a completed retainer still bills ("this
 *     cycle's work is done"), so real MRR was under-reported;
 *   · it never asked `isRecurring`. `stopProjectBillingPatch()` deliberately
 *     leaves `billingType` alone, so switching "Projekt Periodik" off on a
 *     200 000 L/month retainer stopped the invoices while the MRR, the forecast
 *     and the cash-flow gap kept counting the money forever.
 * Delegating also picks up `one-time` and `unsupported-frequency` for free.
 *
 * A gap alarm that over- or under-reports is worse than no alarm: it is the one
 * number meant to warn the owner BEFORE the money runs out.
 */
function projectBillsNextMonth(p: Project, forecastMonthStart: Date): boolean {
  const reason = projectBillingBlockReason(p as any, forecastMonthStart);
  return reason === null || TRANSIENT_BILLING_BLOCKS.includes(reason);
}

/**
 * Recurring expense rows whose series has NOT already ended.
 *
 * `monthlyRecurringExpenseRate` is the shared commitment figure, but its
 * `isActiveRecurringParent` has no "repeat until" guard, while the generation
 * engine refuses exactly that case with `series-ended`. So a series that stopped
 * generating months ago kept inflating the fixed outflow, the cash-flow gap and
 * this forecast with money that will never leave the account.
 *
 * The filter lives here, at the CONSUMERS, because `recurringExpenses.ts` is
 * being edited elsewhere in this pass. TODO: fold this predicate into
 * `isActiveRecurringParent()` in `src/lib/finance/recurringExpenses.ts` (and its
 * mirror in `api/cron/run.ts`) and delete this helper — the rate function is the
 * right home for it, and every other consumer would get the fix for free.
 */
export function withoutEndedRecurringSeries<T extends Partial<Expense>>(
  expenses: T[] | undefined | null,
  at: Date = new Date(),
): T[] {
  return (expenses || []).filter(e => {
    const end = parseDate((e as any).recurringEndDate);
    if (!end) return true;
    // Mirrors `expenseGenerationBlockReason`: the series is over once the NEXT
    // occurrence would fall past the end date (no next date → judge by `at`).
    const next = parseDate((e as any).nextRecurringDate) ?? at;
    return next <= end;
  });
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
      // Normalised to /month exactly like the invoice loop below: the project
      // loop used to add the fee once per month whatever the cycle, so a
      // 50 000 L/WEEK retainer read as 50 000 MRR instead of ~216 500.
      const perMonth = FREQ_TO_MONTHLY[(p as any).recurringFrequency || 'monthly'];
      if (!perMonth) continue; // unknown cycle invents no money (see below)
      total += budget * perMonth;
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
    // An UNKNOWN frequency contributes nothing, never a default full month —
    // the same safe direction the expense side takes. `?? 1` let a junk cycle
    // invent a whole month of revenue out of a typo.
    const perMonth = FREQ_TO_MONTHLY[(i as any).recurringFrequency || 'monthly'];
    if (!perMonth) continue;
    total += getInvoiceTotalAll(i) * perMonth;
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
  const recurringExpenseCommitment = monthlyRecurringExpenseRate(withoutEndedRecurringSeries(exp, now));
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
