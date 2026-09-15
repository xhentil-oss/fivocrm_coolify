// Proactive cashflow health for the owner dashboard.
//
// Two structural signals plus a few threshold alarms, all derived from data we
// already have (no bank-balance input):
//   - Monthly recurring INFLOW  = active recurring invoices, normalised to /month.
//   - Monthly fixed OUTFLOW     = salaries (history-aware) + recurring expenses /month.
//   - gap = inflow − outflow. Negative = predictable income doesn't cover fixed
//     costs, the earliest warning of a structural cash problem.
// Alarms: negative gap, receivables aged >60d, revenue decline vs 3-month
// average, expense spike, single-client concentration.

import type { Invoice, Expense, TeamMember, Project, Subscription } from '../../types';
import { toAll } from '../utils';
import {
  parseDate,
  getInvoiceCollectedBetween,
  buildARAging,
  expenseIsCountable,
  EXPENSE_CATEGORY_SALARY,
} from './financialAnalytics';
import { forwardPayrollEstimate } from './payroll';
import { monthlyRecurringRevenue } from './forecast';
import { monthlyRecurringExpenseRate } from './recurringExpenses';

export interface CashflowAlarm {
  id: string;
  severity: 'red' | 'amber';
  title: string;
  detail: string;
  amount?: number;
  /** Present on the concentration alarm so the view can resolve the name. */
  customerId?: string;
}

export interface CashflowHealth {
  monthlyInflow: number;   // recurring invoice base, per month (ALL)
  monthlyOutflow: number;  // salaries + recurring expenses, per month (ALL)
  gap: number;             // inflow − outflow
  salaries: number;
  recurringExpenses: number;
  overdue60Plus: number;   // receivables aged > 60 days
  alarms: CashflowAlarm[];
}

function monthEnd(base: Date, offset: number): Date {
  return new Date(base.getFullYear(), base.getMonth() + offset + 1, 0, 23, 59, 59, 999);
}
function monthStart(base: Date, offset: number): Date {
  return new Date(base.getFullYear(), base.getMonth() + offset, 1, 0, 0, 0, 0);
}

// The recurring-commitment maths lives in recurringExpenses.ts so the forecast
// card can reuse it: this module already imports forecast.ts, so putting it here
// would have been an import cycle.
export { FREQ_TO_MONTHLY, isActiveRecurringParent, monthlyRecurringExpenseRate } from './recurringExpenses';

export function computeCashflowHealth(
  invoices: Invoice[] | undefined | null,
  expenses: Expense[] | undefined | null,
  teamMembers: TeamMember[] | undefined | null,
  projects: Project[] | undefined | null,
  now: Date = new Date(),
  hostingSubscriptions?: Subscription[] | null,
): CashflowHealth {
  const inv = invoices || [];
  const exp = expenses || [];

  // ── Monthly recurring inflow — SAME definition as the forecast card (monthly
  // projects + active recurring invoices, deduped) so the two cards agree and a
  // retainer modelled as a monthly project doesn't trigger a false gap alarm.
  const monthlyInflow = monthlyRecurringRevenue(projects, invoices, now, hostingSubscriptions);

  // ── Monthly fixed outflow: payroll + recurring expenses.
  // Payroll for a month that has not happened yet is the PLAN — but a tenant who
  // records salaries only as expense rows has no plan, and used to get a gap
  // alarm with no payroll in it at all. `forwardPayrollEstimate` falls back to
  // what was actually paid in recent months. Recurring Salary-category rows are
  // excluded from `monthlyRecurringExpenseRate`, so nothing is counted twice.
  const salaries = forwardPayrollEstimate(teamMembers, exp, now).amount; // next month
  const recurringExpenses = monthlyRecurringExpenseRate(exp);
  const monthlyOutflow = salaries + recurringExpenses;

  const gap = monthlyInflow - monthlyOutflow;

  // ── Receivables aged > 60 days.
  const aging = buildARAging(inv, now);
  const overdue60Plus = aging['61-90'] + aging['90+'];

  const alarms: CashflowAlarm[] = [];

  if (monthlyOutflow > 0 && gap < 0) {
    alarms.push({
      id: 'cashflow-gap',
      severity: 'red',
      title: 'Të ardhurat e rregullta nuk mbulojnë kostot fikse',
      detail: `Çdo muaj kostot fikse (rroga + shpenzime periodike) kalojnë të ardhurat e rregullta me kaq. Ke nevojë për arkëtime një-herëshe ose kontrata të reja për ta mbuluar.`,
      amount: gap,
    });
  }

  if (overdue60Plus > 0) {
    alarms.push({
      id: 'overdue-60',
      severity: 'red',
      title: 'Arkëtime të vonuara mbi 60 ditë',
      detail: 'Sa më e vjetër fatura, aq më e vështirë arkëtimi — ndiqi këto tani.',
      amount: overdue60Plus,
    });
  }

  // ── Revenue decline: last full month vs trailing 3-month average (months -2..-4).
  const collectedIn = (offset: number) =>
    inv.reduce((s, i) => s + getInvoiceCollectedBetween(i, monthStart(now, offset), monthEnd(now, offset)), 0);
  const lastMonthCollected = collectedIn(-1);
  const trailingAvg = (collectedIn(-2) + collectedIn(-3) + collectedIn(-4)) / 3;
  if (trailingAvg > 0 && lastMonthCollected < trailingAvg * 0.7) {
    const dropPct = Math.round((1 - lastMonthCollected / trailingAvg) * 100);
    alarms.push({
      id: 'revenue-decline',
      severity: 'amber',
      title: `Arkëtimet ranë ${dropPct}% nën mesataren`,
      detail: 'Muaji i fundit i mbyllur ishte dukshëm nën mesataren 3-mujore të arkëtimeve.',
      amount: lastMonthCollected - trailingAvg,
    });
  }

  // ── Expense spike: this month's expenses > 1.5× trailing 3-month average.
  const expensesIn = (offset: number) =>
    exp.reduce((s, e) => {
      if ((e as any).category === EXPENSE_CATEGORY_SALARY || !expenseIsCountable(e)) return s;
      const d = parseDate((e as any).date) || parseDate((e as any).createdAt);
      if (!d || d < monthStart(now, offset) || d > monthEnd(now, offset)) return s;
      return s + toAll(e.amount || 0, (e as any).currency);
    }, 0);
  const thisMonthExp = expensesIn(0);
  const expTrailingAvg = (expensesIn(-1) + expensesIn(-2) + expensesIn(-3)) / 3;
  if (expTrailingAvg > 0 && thisMonthExp > expTrailingAvg * 1.5) {
    alarms.push({
      id: 'expense-spike',
      severity: 'amber',
      title: 'Shpenzimet këtë muaj janë shumë mbi normalen',
      detail: `Këtë muaj ke shpenzuar dukshëm më shumë se mesatarja e 3 muajve të fundit (${Math.round(expTrailingAvg).toLocaleString()} L).`,
      amount: thisMonthExp,
    });
  }

  // ── Client concentration: one client > 40% of last-3-month collected.
  const start3 = monthStart(now, -3);
  const byCustomer = new Map<string, number>();
  let total3 = 0;
  for (const i of inv) {
    if (!i.customerId) continue;
    const c = getInvoiceCollectedBetween(i, start3, now);
    if (c <= 0) continue;
    byCustomer.set(i.customerId, (byCustomer.get(i.customerId) || 0) + c);
    total3 += c;
  }
  if (total3 > 0) {
    let topId = '';
    let topVal = 0;
    for (const [id, v] of byCustomer) if (v > topVal) { topVal = v; topId = id; }
    const share = topVal / total3;
    if (share > 0.4 && byCustomer.size > 1) {
      alarms.push({
        id: 'concentration',
        severity: 'amber',
        title: 'Përqendrim i lartë te një klient',
        detail: `${Math.round(share * 100)}% e arkëtimeve të 3 muajve të fundit vjen nga një klient i vetëm — rrezik nëse largohet.`,
        amount: topVal,
        customerId: topId,
      });
    }
  }

  return { monthlyInflow, monthlyOutflow, gap, salaries, recurringExpenses, overdue60Plus, alarms };
}
