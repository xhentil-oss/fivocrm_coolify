// Per-project profit & loss (P&L) with full-absorption overhead allocation.
//
// Model (decided with the business owner):
//  - Each project's REVENUE derives from its `budget` field:
//      · one-time projects → budget as-is (a single deal value).
//      · monthly projects  → budget × months the project was active in the
//        period, so a recurring fee is compared against the same span of
//        salary cost (otherwise 1 month of fee vs N months of salary = nonsense).
//    Billing type comes from `billingType`, falling back to isRecurring.
//  - DIRECT (variable) COSTS = expenses linked to the project (`projectId`),
//    entered manually as they happen. Salary-category expenses are excluded here
//    to avoid double-counting fixed salary (which comes from monthlySalary below).
//  - FIXED COSTS (the "overhead pool") = staff salaries (Σ active member
//    monthlySalary × months) + every other expense NOT tied to a specific
//    project (rent, utilities, hosting, marketing, …) in the period.
//  - The fixed pool is ALLOCATED across projects by REVENUE weight
//    (full-absorption costing): a project earning 60% of total revenue absorbs
//    60% of overhead. If total revenue is 0, the pool is split equally instead.
//  - PROFIT per project = revenue − direct cost − allocated overhead.
//
// This mirrors the salary/expense conventions in financialAnalytics.ts
// (salary sourced from monthlySalary, Salary-category expenses excluded) and is
// the single source of truth for per-project profitability.

import type { Project, TeamMember, Expense, Invoice } from '../../types';
import { toAll } from '../utils';
import { parseDate, monthsElapsedInYear, getInvoiceBilledBetween } from './financialAnalytics';
import { totalSalaryForMonth } from './salaryHistory';

export interface ProjectPnlOptions {
  /** 'completed' counts only Completed (or recurring-completed) projects; 'all' counts every project. */
  mode?: 'all' | 'completed';
  /** Explicit date window; takes precedence over year/allTime. */
  range?: { start: Date; end: Date };
  /** Restrict to a calendar year. Omit (or allTime) for no date restriction. */
  year?: number;
  allTime?: boolean;
  /** Months of salary to charge into the fixed pool. Defaults derived from the period. */
  months?: number;
  /** Override "now" for deterministic tests. */
  now?: Date;
  /** Revenue basis: 'budget' (plan, default) or 'invoiced' (actual billed
   *  invoices linked to the project). 'invoiced' requires `invoices`. */
  revenueBasis?: 'budget' | 'invoiced';
  /** Invoices, needed when revenueBasis === 'invoiced'. */
  invoices?: Invoice[] | null;
}

export interface ProjectPnlRow {
  id: string;
  name: string;
  customerId?: string;
  responsibleUserId?: string;
  billingType: 'one-time' | 'monthly';
  activeMonths: number; // months the project counted toward the period (monthly only; 1 for one-time)
  revenue: number;      // recognised revenue for the period (ALL)
  directCost: number;   // project-linked expenses (ALL)
  overhead: number;     // allocated share of the fixed pool (ALL)
  cost: number;         // directCost + overhead
  profit: number;       // revenue − cost
  margin: number | null;// profit / revenue (0..1), null when revenue is 0
  overheadShare: number;// 0..1 — fraction of the pool this project absorbed
}

export interface ProjectPnlResult {
  rows: ProjectPnlRow[];
  fixedPool: { salaries: number; otherFixed: number; total: number };
  allocationBasis: 'revenue' | 'equal';
  totals: {
    revenue: number;
    directCost: number;
    overhead: number;   // = fixedPool.total when there is ≥1 project
    cost: number;
    profit: number;
  };
  /** Projects credited with cost/revenue but missing a budget (revenue reads 0). */
  missingBudget: { count: number; names: string[] };
}

function isCompleted(p: Project): boolean {
  return p.status === 'Completed' || (!!(p as any).isRecurring && !!(p as any).lastCompletedAt);
}

function projectDate(p: Project): Date | null {
  return parseDate((p as any).lastCompletedAt) || parseDate(p.updatedAt) || parseDate(p.createdAt);
}

/** Inclusive whole-month count between two dates (≥1). */
function monthsBetween(a: Date, b: Date): number {
  return Math.max(1, (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()) + 1);
}

/** Whether a project's `budget` is a monthly fee or a one-time value. */
function billingTypeOf(p: Project): 'one-time' | 'monthly' {
  if (p.billingType === 'monthly' || p.billingType === 'one-time') return p.billingType;
  return (p as any).isRecurring ? 'monthly' : 'one-time';
}

const CATEGORY_SALARY = 'Salary';

export function computeProjectPnl(
  projects: Project[] | undefined | null,
  teamMembers: TeamMember[] | undefined | null,
  expenses: Expense[] | undefined | null,
  opts: ProjectPnlOptions = {},
): ProjectPnlResult {
  const now = opts.now ?? new Date();
  const empty: ProjectPnlResult = {
    rows: [],
    fixedPool: { salaries: 0, otherFixed: 0, total: 0 },
    allocationBasis: 'revenue',
    totals: { revenue: 0, directCost: 0, overhead: 0, cost: 0, profit: 0 },
    missingBudget: { count: 0, names: [] },
  };
  if (!projects) return empty;

  // ── Revenue basis: actual billed invoices per project (independent of the
  // all-time window, so no circular dependency with periodProjects). ──
  const useInvoiced = opts.revenueBasis === 'invoiced';
  const invWindow = opts.range
    ? opts.range
    : (opts.year != null && !opts.allTime)
      ? { start: new Date(opts.year, 0, 1), end: opts.year === now.getFullYear() ? now : new Date(opts.year, 11, 31, 23, 59, 59, 999) }
      : { start: new Date(0), end: now };
  const invoicedByProject = new Map<string, number>();
  if (useInvoiced) {
    for (const inv of opts.invoices || []) {
      const pid = inv.projectId;
      if (!pid) continue;
      const amt = getInvoiceBilledBetween(inv, invWindow.start, invWindow.end);
      if (amt) invoicedByProject.set(pid, (invoicedByProject.get(pid) || 0) + amt);
    }
  }

  // ── Period filter — explicit range wins, then calendar year, then all-time.
  const inPeriod = (d: Date | null): boolean => {
    if (opts.range) return !!d && d >= opts.range.start && d <= opts.range.end;
    if (opts.allTime || opts.year == null) return true;
    return !!d && d.getFullYear() === opts.year;
  };

  const mode = opts.mode ?? 'all';
  // Membership window for finite periods (range/year); null = all-time.
  const membershipWindow = opts.range
    ? { start: opts.range.start, end: opts.range.end }
    : (opts.year != null && !opts.allTime)
      ? { start: new Date(opts.year, 0, 1), end: opts.year === now.getFullYear() ? now : new Date(opts.year, 11, 31, 23, 59, 59, 999) }
      : null;
  const periodProjects = projects.filter(p => {
    if (mode === 'completed' && !isCompleted(p)) return false;
    // On invoiced basis, any project billed in the period belongs to it.
    if (useInvoiced && (invoicedByProject.get(p.id) || 0) !== 0) return true;
    if (!membershipWindow) return true; // all-time
    // Monthly retainers earn in every month their active span overlaps (not only
    // the month of their last update) so a single-month view still counts them.
    if (billingTypeOf(p) === 'monthly') {
      const start = parseDate(p.createdAt) ?? membershipWindow.start;
      const end = parseDate((p as any).lastCompletedAt) ?? membershipWindow.end;
      return start <= membershipWindow.end && end >= membershipWindow.start;
    }
    return inPeriod(projectDate(p));
  });

  // ── Resolve the period window [periodStart, periodEnd]. Used both for the
  // salary months charged into the pool AND for prorating monthly project fees,
  // so revenue and cost always cover the same span.
  let periodStart: Date;
  let periodEnd: Date;
  if (opts.range) {
    periodStart = opts.range.start;
    periodEnd = opts.range.end;
  } else if (opts.year != null && !opts.allTime) {
    periodStart = new Date(opts.year, 0, 1);
    periodEnd = opts.year === now.getFullYear()
      ? now
      : new Date(opts.year, 11, 31, 23, 59, 59, 999);
  } else {
    // All-time: from the earliest matched project up to now.
    const times = periodProjects.map(projectDate).filter((d): d is Date => !!d).map(d => d.getTime());
    periodStart = times.length > 0 ? new Date(Math.min(...times)) : now;
    periodEnd = now;
  }

  // Months of salary to charge into the fixed pool.
  let months = opts.months;
  if (months == null) {
    months = (opts.year != null && !opts.allTime && !opts.range)
      ? monthsElapsedInYear(opts.year, now)
      : monthsBetween(periodStart, periodEnd);
  }
  const periodMonths = months;

  // ── Fixed cost pool: salaries + non-project, non-salary expenses in the period.
  // With an explicit `months` override (tests), charge current active salaries ×
  // months. Otherwise sum the HISTORY-AWARE payroll for each calendar month in
  // the period, so a mid-period raise is reflected in the pool.
  let salaries: number;
  if (opts.months != null) {
    salaries = (teamMembers ?? [])
      .filter(m => m.status === 'Active')
      .reduce((s, m) => s + (m.monthlySalary || 0), 0) * months;
  } else {
    salaries = 0;
    const cur = new Date(periodStart.getFullYear(), periodStart.getMonth(), 1);
    const last = new Date(periodEnd.getFullYear(), periodEnd.getMonth(), 1);
    let guard = 0;
    while (cur.getTime() <= last.getTime() && guard < 600) {
      const monthEnd = new Date(cur.getFullYear(), cur.getMonth() + 1, 0, 23, 59, 59, 999);
      salaries += totalSalaryForMonth(teamMembers, monthEnd);
      cur.setMonth(cur.getMonth() + 1);
      guard++;
    }
  }

  const expDate = (e: Expense) => parseDate((e as any).date) || parseDate((e as any).createdAt);
  const expInPeriod = (e: Expense) => (opts.allTime || (opts.year == null && !opts.range)) ? true : inPeriod(expDate(e));

  let otherFixed = 0;
  const directByProject = new Map<string, number>();
  for (const e of expenses ?? []) {
    if (!expInPeriod(e)) continue;
    if ((e as any).approvalStatus === 'Rejected') continue; // rejected expenses never hit the books
    const amt = toAll(e.amount || 0, (e as any).currency);
    const pid = (e as any).projectId as string | undefined;
    const isSalary = (e as any).category === CATEGORY_SALARY;
    if (pid) {
      if (isSalary) continue; // salary handled via monthlySalary, never as project-direct
      directByProject.set(pid, (directByProject.get(pid) || 0) + amt);
    } else if (!isSalary) {
      otherFixed += amt;
    }
  }

  const poolTotal = salaries + otherFixed;

  // ── Recognised revenue per project.
  const revenueOf = (p: Project): { revenue: number; billingType: 'one-time' | 'monthly'; activeMonths: number } => {
    const bt = billingTypeOf(p);
    // Invoiced basis: actual billed invoices linked to this project.
    if (useInvoiced) return { revenue: invoicedByProject.get(p.id) || 0, billingType: bt, activeMonths: 1 };
    // Budget basis: one-time = budget; monthly = fee × active months.
    // Normalizo në ALL (kostot/pagat janë në ALL) që marzhi të jetë i saktë për EUR.
    const fee = toAll(p.budget || 0, p.currency);
    if (bt === 'one-time') return { revenue: fee, billingType: bt, activeMonths: 1 };
    const projStart = parseDate(p.createdAt) ?? periodStart;
    const projEnd = parseDate((p as any).lastCompletedAt) ?? periodEnd;
    const s = projStart > periodStart ? projStart : periodStart;
    const e = projEnd < periodEnd ? projEnd : periodEnd;
    const active = e >= s ? Math.min(monthsBetween(s, e), periodMonths) : 1;
    return { revenue: fee * active, billingType: bt, activeMonths: active };
  };
  const revInfo = new Map(periodProjects.map(p => [p.id, revenueOf(p)] as const));

  // ── Allocate the pool by revenue weight (equal split when no revenue).
  const totalRevenue = periodProjects.reduce((s, p) => s + revInfo.get(p.id)!.revenue, 0);
  const allocationBasis: 'revenue' | 'equal' = totalRevenue > 0 ? 'revenue' : 'equal';
  const equalShare = periodProjects.length > 0 ? 1 / periodProjects.length : 0;

  const missingBudget = { count: 0, names: [] as string[] };

  const rows: ProjectPnlRow[] = periodProjects.map(p => {
    const info = revInfo.get(p.id)!;
    const revenue = info.revenue;
    const directCost = directByProject.get(p.id) || 0;
    const share = allocationBasis === 'revenue'
      ? (totalRevenue > 0 ? revenue / totalRevenue : 0)
      : equalShare;
    const overhead = poolTotal * share;
    const cost = directCost + overhead;
    const profit = revenue - cost;
    if (revenue === 0) {
      missingBudget.count += 1;
      missingBudget.names.push(p.name);
    }
    return {
      id: p.id,
      name: p.name,
      customerId: p.customerId,
      responsibleUserId: p.responsibleUserId || p.createdByUserId || undefined,
      billingType: info.billingType,
      activeMonths: info.activeMonths,
      revenue,
      directCost,
      overhead,
      cost,
      profit,
      margin: revenue > 0 ? profit / revenue : null,
      overheadShare: share,
    };
  }).sort((a, b) => b.profit - a.profit);

  const totals = rows.reduce(
    (t, r) => ({
      revenue: t.revenue + r.revenue,
      directCost: t.directCost + r.directCost,
      overhead: t.overhead + r.overhead,
      cost: t.cost + r.cost,
      profit: t.profit + r.profit,
    }),
    { revenue: 0, directCost: 0, overhead: 0, cost: 0, profit: 0 },
  );

  return {
    rows,
    fixedPool: { salaries, otherFixed, total: poolTotal },
    allocationBasis,
    totals,
    missingBudget,
  };
}
