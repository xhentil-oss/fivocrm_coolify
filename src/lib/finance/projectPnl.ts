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
import { memberEndDate, memberSalaryForMonth } from './salaryHistory';
import { TERMINAL_PROJECT_STATUSES } from './recurringBilling';

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
  fixedPool: {
    salaries: number;
    otherFixed: number;
    total: number;
    /** Months inside the period whose payroll came from the member profiles
     *  because no salary payment was recorded for them. > 0 is exactly when the
     *  pool and the Shpenzimet page disagree, so the UI can say why. */
    payrollFallbackMonths: number;
  };
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
  /** Which basis produced `revenue` — the UI needs it to label a 0-revenue project
   *  correctly ("no budget" vs "no invoice linked"). */
  revenueBasis: 'budget' | 'invoiced';
  /**
   * Invoices carrying NO `projectId`. They are excluded from revenue on the
   * 'invoiced' basis while the full fixed pool is still allocated across projects,
   * so an unlinked invoice shows up as pure loss. Surfacing the count + value is
   * what makes that self-correctable instead of silently wrong.
   * Only populated when `invoices` are supplied.
   */
  unlinkedInvoices: { count: number; amount: number };
  /**
   * Expenses tagged to a project that is NOT in this period's set (closed in an
   * earlier year, archived, or excluded by `mode: 'completed'`). They are real
   * costs of the period, so they are pooled as overhead rather than dropped —
   * but the user needs to know the money moved from "project cost" to "shared
   * overhead", because it changes every project's allocated share.
   */
  unallocatedDirect: { count: number; amount: number };
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

/**
 * When does a MONTHLY retainer stop earning its fee?
 *
 * The period filter and the revenue calculation both used
 * `lastCompletedAt ?? periodEnd`, which is wrong in BOTH directions:
 *
 *  · too generous — a retainer cancelled in February and viewed in September
 *    still overlapped every month in between, so a 50 000/month fee credited
 *    450 000 of revenue that will never be billed, to the project, its
 *    department and its responsible person;
 *  · too mean — `lastCompletedAt` means "the last time every task on this
 *    project was done", not "the engagement ended". One all-done afternoon in
 *    March silently stopped a live retainer from earning for the rest of the
 *    year.
 *
 * So the span is derived from the BILLING SERIES wherever the data allows, and
 * `lastCompletedAt` is only consulted for a project whose series is not running
 * (legacy rows, which have no stop stamp at all). The candidates, all optional:
 *   · `recurringBillingStoppedAt` — `stopProjectBillingPatch()`; read only while
 *     the series is off, because restoring a project does not clear it;
 *   · `recurringEndDate` — "repeat until": nothing bills past it;
 *   · `archivedAt` — only while the project actually IS archived (same reason);
 *   · for a terminal status (Cancelled/Archived) the best evidence available,
 *     falling back to `updatedAt`, since cancelling is itself an update.
 * Nothing found = still running = `fallbackEnd` (the period end).
 *
 * `isRecurringPaused` deliberately does NOT end the span: a pause is temporary
 * and carries no timestamp, so there is nothing honest to end it at.
 */
export function retainerEarningEnd(p: Project, fallbackEnd: Date): Date {
  const ends: number[] = [fallbackEnd.getTime()];
  const push = (d: Date | null) => { if (d) ends.push(d.getTime()); };
  const running = !!(p as any).isRecurring;
  const terminal = !!p.status && TERMINAL_PROJECT_STATUSES.includes(p.status);

  if (!running) push(parseDate((p as any).recurringBillingStoppedAt));
  push(parseDate((p as any).recurringEndDate));
  if (p.status === 'Archived') push(parseDate((p as any).archivedAt));
  if (terminal) {
    push(parseDate((p as any).archivedAt)
      || parseDate((p as any).recurringBillingStoppedAt)
      || parseDate((p as any).lastCompletedAt)
      || parseDate(p.updatedAt)
      || parseDate(p.createdAt));
  }
  if (!running && !terminal) push(parseDate((p as any).lastCompletedAt));

  return new Date(Math.min(...ends));
}

/**
 * Was this member on payroll at any point inside [start, end]?
 *
 * Leaving payroll is an EVENT WITH A DATE, not a status — that is the whole
 * point of `memberEndDate()` / `memberSalaryForMonth()` in salaryHistory.ts. A
 * plain `status === 'Active'` filter placed BEFORE those functions defeats them
 * one layer up: the day a leaver is flipped to Inactive, every closed month's
 * labour line and fixed pool loses their salary and the past year's profit
 * silently improves. A month that has already been paid cannot become free.
 *
 * The rule itself is never re-derived here:
 *   · Active → on payroll (the salary function still zeroes any month after a
 *     `leftAt` that was recorded anyway);
 *   · a status that was never Active (a `Pending` invite nobody accepted) →
 *     never on payroll, unchanged;
 *   · Inactive WITH `leftAt` → on payroll for the period when they left after it
 *     opened (each month inside is then priced individually);
 *   · Inactive WITHOUT `leftAt` → ask `memberSalaryForMonth` month by month; a
 *     month it prices above 0 is a month this person was on payroll. That keeps
 *     salaryHistory.ts the single owner of the "when did they leave" fallback.
 */
export function memberOnPayrollBetween(member: TeamMember, start: Date, end: Date): boolean {
  if (member.status === 'Active') return true;
  if (member.status !== 'Inactive') return false;

  const left = memberEndDate(member);
  if (left) return left.getTime() > start.getTime();

  let cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  const lastMonth = new Date(end.getFullYear(), end.getMonth(), 1);
  for (let guard = 0; cursor.getTime() <= lastMonth.getTime() && guard < 600; guard++) {
    const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0, 23, 59, 59, 999);
    if (memberSalaryForMonth(member, monthEnd) > 0) return true;
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }
  return false;
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
    fixedPool: { salaries: 0, otherFixed: 0, total: 0, payrollFallbackMonths: 0 },
    allocationBasis: 'revenue',
    totals: { revenue: 0, directCost: 0, overhead: 0, cost: 0, profit: 0 },
    missingBudget: { count: 0, names: [] },
    revenueBasis: resolvedBasis,
    unlinkedInvoices: { count: 0, amount: 0 },
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
  for (const inv of opts.invoices || []) {
    const amt = getInvoiceCollectedBetween(inv, invWindow.start, invWindow.end);
    const pid = inv.projectId;
    if (!pid) {
      // A billed invoice with no project: real revenue that no project can absorb.
      if (amt) { unlinkedInvoices.count += 1; unlinkedInvoices.amount += amt; }
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
    const pay = payrollBetween(teamMembers, expenses, periodStart, periodEnd);
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

  const poolTotal = salaries + otherFixed;

  // ── Recognised revenue per project.
  const revenueOf = (p: Project): { revenue: number; billingType: 'one-time' | 'monthly'; activeMonths: number } => {
    const bt = billingTypeOf(p);
    // Invoiced basis: actual billed invoices linked to this project.
    if (useInvoiced) return { revenue: invoicedByProject.get(p.id) || 0, billingType: bt, activeMonths: 1 };
    // Budget basis: one-time = budget; monthly = fee × active months.
    // Normalizo në ALL (kostot/pagat janë në ALL) që marzhi të jetë i saktë për EUR.
    const fee = toAll(p.budget || 0, p.currency);
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
    const projStart = parseDate(p.createdAt) ?? periodStart;
    const projEnd = retainerEarningEnd(p, periodEnd);
    const s = projStart > periodStart ? projStart : periodStart;
    const e = projEnd < periodEnd ? projEnd : periodEnd;
    // A span that ended BEFORE the period opened earns nothing. It used to fall
    // back to 1, i.e. a whole month of a dead retainer's fee.
    const active = e >= s ? Math.min(monthsBetween(s, e), periodMonths) : 0;
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
    fixedPool: { salaries, otherFixed, total: poolTotal, payrollFallbackMonths },
    allocationBasis,
    totals,
    missingBudget,
    revenueBasis: resolvedBasis,
    unlinkedInvoices,
    unallocatedDirect,
  };
}
