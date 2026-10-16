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
//  - FIXED COSTS (the "overhead pool") = payroll for the period + every other
//    expense NOT tied to a specific project (rent, utilities, hosting,
//    marketing, …) in the period. Payroll comes from `payrollBetween()`
//    (lib/finance/payroll.ts): the salaries actually RECORDED for each month,
//    falling back to the member profiles only for months with none. Charging
//    the profile figure into every month regardless used to bill a full year of
//    payroll to a team hired mid-year, and ignored every payment made to
//    someone who is not on the member list.
//  - The fixed pool is ALLOCATED across projects by REVENUE weight
//    (full-absorption costing): a project earning 60% of total revenue absorbs
//    60% of overhead. If total revenue is 0, the pool is split equally instead.
//  - PROFIT per project = revenue − direct cost − allocated overhead.
//
// This mirrors the expense conventions in financialAnalytics.ts (Salary-category
// rows never counted as an expense — they ARE the recorded payroll, added once
// via payroll.ts) and is the single source of truth for per-project
// profitability.

import type { Project, TeamMember, Expense, Invoice } from '../../types';
import { toAll } from '../utils';
import { parseDate, monthsElapsedInYear, getInvoiceCollectedBetween } from './financialAnalytics';
import { payrollBetween } from './payroll';
import {
  isProjectCompleted as isCompleted,
  projectDate,
  monthsBetween,
  billingTypeOf,
  retainerEarningEnd,
  retainerRevenueInPeriod,
  memberOnPayrollBetween,
  monthlyFeeOf,
} from './projectPeriod';
import { laborOutsideRows, loadCreditOf, proratePlanPayroll, type LaborAllocation } from './laborAllocation';
import { projectEarnedInPeriod } from './revenueRecognition';

// Re-exported for the modules that import them from here (departmentPnl, views).
export { retainerEarningEnd, memberOnPayrollBetween };

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
  /** Revenue basis: 'budget' (plan, default) or 'invoiced' — which counts only
   *  money actually COLLECTED on invoices linked to the project. An issued-but-
   *  unpaid invoice (Pending/Overdue) is a receivable, not profit, so it never
   *  counts. Requires `invoices`. */
  revenueBasis?: 'budget' | 'invoiced';
  /** Invoices, needed when revenueBasis === 'invoiced'. */
  invoices?: Invoice[] | null;
  /**
   * Hours-based labour allocation for the same period (`allocateLabor`,
   * lib/finance/laborAllocation.ts). When supplied AND it has hours
   * (`basis: 'hours'`):
   *   · each project carries its OWN labour cost (hours × cost rate) as a direct
   *     cost, and the fixed pool holds only the UNABSORBED payroll (bench,
   *     meetings, people who logged nothing) plus non-project expenses;
   *   · the pool is allocated by labour HOURS (or revenue, per
   *     `settings.overheadBasis`), so the client that consumes the team carries
   *     the overhead;
   *   · a one-time project's revenue is EARNED by effort (percentage of
   *     completion) instead of booked whole in its completion month.
   * Omitted (or `basis: 'none'`): the legacy full-absorption model, unchanged.
   */
  labor?: LaborAllocation | null;
  /** Time entries, only needed with `labor` for effort-based revenue recognition. */
  timeEntries?: import('../../types').TimeEntry[] | null;
}

export interface ProjectPnlRow {
  id: string;
  name: string;
  customerId?: string;
  responsibleUserId?: string;
  billingType: 'one-time' | 'monthly';
  activeMonths: number; // months the project counted toward the period (monthly only; 1 for one-time)
  revenue: number;      // recognised revenue for the period (ALL)
  directCost: number;   // project-linked expenses (ALL) — PLUS hours × cost rate when `labor` was supplied
  /** Hours × cost rate for this project (0 on the legacy model). */
  laborCost: number;
  /** Logged hours inside the period (0 on the legacy model). */
  hours: number;
  overhead: number;     // allocated share of the fixed pool (ALL)
  cost: number;         // directCost + overhead
  profit: number;       // revenue − cost
  margin: number | null;// profit / revenue (0..1), null when revenue is 0
  overheadShare: number;// 0..1 — fraction of the pool this project absorbed
}

export interface ProjectPnlResult {
  rows: ProjectPnlRow[];
  fixedPool: {
    salaries: number;
    otherFixed: number;
    total: number;
    /** Months inside the period whose payroll came from the member profiles
     *  because no salary payment was recorded for them. > 0 is exactly when the
     *  pool and the Shpenzimet page disagree, so the UI can say why. */
    payrollFallbackMonths: number;
    /**
     * The slice of `salaries` (hours model only) that is labour NO ROW carries:
     * hours logged with no project, or on a project outside this period's set.
     * Real cost, pooled — it used to be dropped, so Σ rows + pool ≠ payroll.
     */
    laborOutsideRows: number;
    /**
     * Hours model only: labour the rows were charged ABOVE the unloaded payroll
     * (`allocateLabor().overAbsorbed` — mostly employer contributions at the
     * loaded rate). Not in the pool (which is never negative); reported so that
     * Σ row profit + loadCredit == revenue − expenses − payroll of the period.
     */
    loadCredit: number;
  };
  allocationBasis: 'revenue' | 'equal' | 'labor-hours';
  /** 'hours' when `opts.labor` carried logged hours; 'legacy' otherwise. */
  laborBasis: 'hours' | 'legacy';
  totals: {
    revenue: number;
    directCost: number;
    overhead: number;   // = fixedPool.total when there is ≥1 project
    cost: number;
    profit: number;
  };
  /** Projects credited with cost/revenue but missing a budget (revenue reads 0). */
  missingBudget: { count: number; names: string[] };
  /** Which basis produced `revenue` — the UI needs it to label a 0-revenue project
   *  correctly ("no budget" vs "no invoice linked"). */
  revenueBasis: 'budget' | 'invoiced';
  /**
   * Invoices carrying NO `projectId`. They are excluded from revenue on the
   * 'invoiced' basis while the full fixed pool is still allocated across projects,
   * so an unlinked invoice shows up as pure loss. Surfacing the count + value is
   * what makes that self-correctable instead of silently wrong.
   * Only populated when `invoices` are supplied.
   *
   * Includes invoices whose `projectId` points at a project that does not exist
   * (deleted, or another tenant's id) — their money is just as unattributable,
   * and on the invoiced basis it used to vanish without a trace. That subset is
   * also reported on its own in `unresolvedInvoices`.
   */
  unlinkedInvoices: { count: number; amount: number };
  /** Subset of `unlinkedInvoices`: a `projectId` that resolves to no project. */
  unresolvedInvoices: { count: number; amount: number };
  /**
   * Expenses tagged to a project that is NOT in this period's set (closed in an
   * earlier year, archived, or excluded by `mode: 'completed'`). They are real
   * costs of the period, so they are pooled as overhead rather than dropped —
   * but the user needs to know the money moved from "project cost" to "shared
   * overhead", because it changes every project's allocated share.
   */
  unallocatedDirect: { count: number; amount: number };
}

const CATEGORY_SALARY = 'Salary';

export function computeProjectPnl(
  projects: Project[] | undefined | null,
  teamMembers: TeamMember[] | undefined | null,
  expenses: Expense[] | undefined | null,
  opts: ProjectPnlOptions = {},
): ProjectPnlResult {
  const now = opts.now ?? new Date();
  const resolvedBasis: 'budget' | 'invoiced' = opts.revenueBasis === 'invoiced' ? 'invoiced' : 'budget';
  const empty: ProjectPnlResult = {
    rows: [],
    fixedPool: { salaries: 0, otherFixed: 0, total: 0, payrollFallbackMonths: 0, laborOutsideRows: 0, loadCredit: 0 },
    allocationBasis: 'revenue',
    laborBasis: 'legacy',
    totals: { revenue: 0, directCost: 0, overhead: 0, cost: 0, profit: 0 },
    missingBudget: { count: 0, names: [] },
    revenueBasis: resolvedBasis,
    unlinkedInvoices: { count: 0, amount: 0 },
    unresolvedInvoices: { count: 0, amount: 0 },
    unallocatedDirect: { count: 0, amount: 0 },
  };
  if (!projects) return empty;

  // ── Revenue basis: money actually COLLECTED per project (independent of the
  // all-time window, so no circular dependency with periodProjects). ──
  const useInvoiced = opts.revenueBasis === 'invoiced';
  const invWindow = opts.range
    ? opts.range
    : (opts.year != null && !opts.allTime)
      ? { start: new Date(opts.year, 0, 1), end: opts.year === now.getFullYear() ? now : new Date(opts.year, 11, 31, 23, 59, 59, 999) }
      : { start: new Date(0), end: now };
  const invoicedByProject = new Map<string, number>();
  // Tracked whenever invoices are supplied (not just on the invoiced basis) so the
  // UI can warn BEFORE the user flips the toggle and sees phantom losses.
  const unlinkedInvoices = { count: 0, amount: 0 };
  const unresolvedInvoices = { count: 0, amount: 0 };
  const knownProjectIds = new Set(projects.map(p => p.id));
  for (const inv of opts.invoices || []) {
    const amt = getInvoiceCollectedBetween(inv, invWindow.start, invWindow.end);
    const pid = inv.projectId;
    if (!pid || !knownProjectIds.has(pid)) {
      // A billed invoice with no project — or with a projectId that resolves to
      // nothing (the project was deleted): real revenue no project can absorb.
      if (amt) {
        unlinkedInvoices.count += 1; unlinkedInvoices.amount += amt;
        if (pid) { unresolvedInvoices.count += 1; unresolvedInvoices.amount += amt; }
      }
      continue;
    }
    if (useInvoiced && amt) invoicedByProject.set(pid, (invoicedByProject.get(pid) || 0) + amt);
  }

  // ── Period filter — explicit range wins, then calendar year, then all-time.
  const inPeriod = (d: Date | null): boolean => {
    if (opts.range) return !!d && d >= opts.range.start && d <= opts.range.end;
    if (opts.allTime || opts.year == null) return true;
    return !!d && d.getFullYear() === opts.year;
  };

  const mode = opts.mode ?? 'all';
  const labor = opts.labor && opts.labor.basis === 'hours' ? opts.labor : null;
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
      // The span ENDS where the billing series ended (cancelled, archived,
      // stopped, past its "repeat until") — see retainerEarningEnd. A cancelled
      // retainer used to overlap every later period and book full budget revenue.
      const end = retainerEarningEnd(p, membershipWindow.end);
      return start <= membershipWindow.end && end >= membershipWindow.start;
    }
    if (inPeriod(projectDate(p))) return true;
    // Hours model: a one-time project EARNS by effort in every period its people
    // log hours on it — not only in the period of its last update. Selecting it
    // by `projectDate` alone dropped a July fixed-fee project from September
    // (0 revenue, no row) while its September labour was pooled onto everyone
    // else. The client table (clientProfitability) always counted it.
    if (labor && !useInvoiced) {
      if ((labor.byProject.get(p.id)?.hours || 0) > 0) return true;
      if (projectEarnedInPeriod(p, opts.timeEntries || [], membershipWindow) !== 0) return true;
    }
    return false;
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
  let payrollFallbackMonths = 0;
  if (opts.months != null) {
    salaries = (teamMembers ?? [])
      // Date-aware, not status-aware: someone who left in September is still on
      // the June payroll (see memberOnPayrollBetween).
      .filter(m => memberOnPayrollBetween(m, periodStart, periodEnd))
      .reduce((s, m) => s + (m.monthlySalary || 0), 0) * months;
  } else {
    // Recorded salary payments per month, plan only where a month has none —
    // see lib/finance/payroll.ts. Charging the plan into every month regardless
    // billed 8 months of payroll to a team hired in March, and hid every
    // payment made to someone who is not on the member list.
    //
    // A month the period cuts short ("Ky muaj" ends now) is charged at its
    // elapsed share where its payroll is the PLAN — the same law as the hours
    // model (`allocateLabor`) and as the retainer fee of that month
    // (`retainerRevenueInPeriod`), so revenue and cost cover the same days. A
    // recorded payment is what left the bank and is never scaled.
    const pay = proratePlanPayroll(payrollBetween(teamMembers, expenses, periodStart, periodEnd), periodStart, periodEnd);
    salaries = pay.total;
    payrollFallbackMonths = pay.monthsProfile;
  }

  const expDate = (e: Expense) => parseDate((e as any).date) || parseDate((e as any).createdAt);
  const expInPeriod = (e: Expense) => (opts.allTime || (opts.year == null && !opts.range)) ? true : inPeriod(expDate(e));

  // Which projects can actually absorb a direct cost in this period? A cost
  // tagged to a project OUTSIDE the period (closed in an earlier year, archived,
  // or filtered out by mode:'completed') used to land in `directByProject` under
  // a key that no row exists for — and was not added to the pool either, so the
  // money simply evaporated: `directCost + otherFixed` did not equal the
  // period's expenses. Such a cost is real and belongs to the period; with no
  // project of its own to carry it, it is overhead.
  const absorbable = new Set(periodProjects.map(p => p.id));

  let otherFixed = 0;
  const directByProject = new Map<string, number>();
  const unallocatedDirect = { count: 0, amount: 0 };
  for (const e of expenses ?? []) {
    if (!expInPeriod(e)) continue;
    if ((e as any).approvalStatus === 'Rejected') continue; // rejected expenses never hit the books
    const isSalary = (e as any).category === CATEGORY_SALARY;
    if (isSalary) continue; // salary handled via monthlySalary/salaryHistory, never from rows
    const amt = toAll(e.amount || 0, (e as any).currency);
    const pid = (e as any).projectId as string | undefined;
    if (pid && absorbable.has(pid)) {
      directByProject.set(pid, (directByProject.get(pid) || 0) + amt);
    } else {
      if (pid) { unallocatedDirect.count += 1; unallocatedDirect.amount += amt; }
      otherFixed += amt;
    }
  }

  // ── Hours-based labour (opt-in). With logged hours, each project's own labour
  // is a DIRECT cost and only the unabsorbed remainder of payroll is shared.
  // (`labor` itself is resolved above, before the period filter.)
  const laborBasis: 'hours' | 'legacy' = labor ? 'hours' : 'legacy';
  // The pool's labour = unabsorbed payroll + every hour no row here carries
  // (no project, or a project outside `absorbable`). Pooling `unabsorbed` alone
  // dropped that labour from every row AND from the pool.
  const outside = labor ? laborOutsideRows(labor, absorbable) : null;
  // Never negative: hours × LOADED rates above the unloaded payroll are NOT a
  // credit inside the pool (that made overhead negative under the defaults);
  // they are reported apart as `loadCredit`, so
  //   Σ row profit + loadCredit == revenue − expenses − payroll  (exactly).
  if (labor) salaries = labor.unabsorbed + (outside?.total || 0);
  const loadCredit = loadCreditOf(labor);
  const poolTotal = salaries + otherFixed;

  // ── Recognised revenue per project.
  const revenueOf = (p: Project): { revenue: number; billingType: 'one-time' | 'monthly'; activeMonths: number } => {
    const bt = billingTypeOf(p);
    // Invoiced basis: actual billed invoices linked to this project.
    if (useInvoiced) return { revenue: invoicedByProject.get(p.id) || 0, billingType: bt, activeMonths: 1 };
    // Budget basis: one-time = budget; monthly = fee × active months.
    // Normalizo në ALL (kostot/pagat janë në ALL) që marzhi të jetë i saktë për EUR.
    const fee = toAll(p.budget || 0, p.currency);
    if (bt === 'one-time' && labor) {
      // Effort-based recognition (percentage of completion) — see revenueRecognition.ts.
      const earned = projectEarnedInPeriod(p, opts.timeEntries || [], { start: periodStart, end: periodEnd });
      return { revenue: earned, billingType: bt, activeMonths: earned > 0 ? 1 : 0 };
    }
    if (bt === 'one-time') {
      // Revenue recognition (IFRS 15, point in time): a one-time deal is EARNED
      // when the work is delivered, so its value is recognised in the month the
      // project was COMPLETED — never while it is still in progress. Recognising
      // it earlier booked profit for work not yet done, and (because the fallback
      // date was `updatedAt`) let the revenue drift between months on any edit.
      if (!isCompleted(p)) return { revenue: 0, billingType: bt, activeMonths: 0 };
      const done = parseDate((p as any).lastCompletedAt) || parseDate(p.updatedAt);
      const inPeriodNow = !membershipWindow
        || (!!done && done >= membershipWindow.start && done <= membershipWindow.end);
      return { revenue: inPeriodNow ? fee : 0, billingType: bt, activeMonths: 1 };
    }
    // Retainer: the shared rule (projectPeriod.ts) — span clipped to the period,
    // a dead span earns nothing, and the month the period end cuts short earns
    // its elapsed share. Inlining a copy here let the engines drift.
    // The fee PER MONTH: a weekly retainer bills `budget` every week (monthlyFeeOf).
    const ret = retainerRevenueInPeriod(p, toAll(monthlyFeeOf(p), p.currency), periodStart, periodEnd, periodMonths);
    return { revenue: ret.revenue, billingType: bt, activeMonths: ret.activeMonths };
  };
  const revInfo = new Map(periodProjects.map(p => [p.id, revenueOf(p)] as const));

  // ── Allocate the pool by revenue weight (equal split when no revenue).
  const totalRevenue = periodProjects.reduce((s, p) => s + revInfo.get(p.id)!.revenue, 0);
  const laborHoursOf = (id: string) => labor?.byProject.get(id)?.hours || 0;
  const totalLaborHours = labor ? periodProjects.reduce((s, p) => s + laborHoursOf(p.id), 0) : 0;
  const useHoursWeight = !!labor && labor.settings.overheadBasis === 'labor-hours' && totalLaborHours > 0;
  const allocationBasis: 'revenue' | 'equal' | 'labor-hours' = useHoursWeight
    ? 'labor-hours'
    : totalRevenue > 0 ? 'revenue' : 'equal';
  const equalShare = periodProjects.length > 0 ? 1 / periodProjects.length : 0;

  const missingBudget = { count: 0, names: [] as string[] };

  const rows: ProjectPnlRow[] = periodProjects.map(p => {
    const info = revInfo.get(p.id)!;
    const revenue = info.revenue;
    const laborCost = labor?.byProject.get(p.id)?.cost || 0;
    const hours = laborHoursOf(p.id);
    const directCost = (directByProject.get(p.id) || 0) + laborCost;
    const share = allocationBasis === 'labor-hours'
      ? hours / totalLaborHours
      : allocationBasis === 'revenue'
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
      laborCost,
      hours,
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
    fixedPool: { salaries, otherFixed, total: poolTotal, payrollFallbackMonths, laborOutsideRows: outside?.total || 0, loadCredit },
    allocationBasis,
    laborBasis,
    totals,
    missingBudget,
    revenueBasis: resolvedBasis,
    unlinkedInvoices,
    unresolvedInvoices,
    unallocatedDirect,
  };
}
