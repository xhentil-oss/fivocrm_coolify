/**
 * Project ↔ period helpers shared by every P&L engine (projectPnl, departmentPnl,
 * revenueRecognition, clientProfitability). Moved here VERBATIM from projectPnl.ts
 * so revenue recognition can use them without a circular import; projectPnl
 * re-exports the two names other modules already import from it.
 */
import type { Project, TeamMember } from '../../types';
import { parseDate } from './financialAnalytics';
import { memberEndDate, memberSalaryForMonth } from './salaryHistory';
import { TERMINAL_PROJECT_STATUSES } from './recurringBilling';

export function isProjectCompleted(p: Project): boolean {
  return p.status === 'Completed' || (!!(p as any).isRecurring && !!(p as any).lastCompletedAt);
}

/** The date a one-time project "belongs to" for period membership. */
export function projectDate(p: Project): Date | null {
  return parseDate((p as any).lastCompletedAt) || parseDate(p.updatedAt) || parseDate(p.createdAt);
}

/** Inclusive whole-month count between two dates (≥1). */
export function monthsBetween(a: Date, b: Date): number {
  return Math.max(1, (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()) + 1);
}

/**
 * Months between two instants as a FRACTION: a period 1 Sep 00:00 → 10 Sep 12:00
 * is 0.32 months, not 1. Whole-month rules (retainer fees, payroll rows) keep
 * `monthsBetween`; this is for what scales with elapsed time — practical
 * capacity and the PLAN payroll of a month still in progress.
 */
export function fractionalMonthsBetween(start: Date, end: Date): number {
  if (end <= start) return 0;
  let total = 0;
  let cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  const lastMonth = new Date(end.getFullYear(), end.getMonth(), 1);
  for (let guard = 0; cursor.getTime() <= lastMonth.getTime() && guard < 1200; guard++) {
    const monthStart = cursor;
    const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    const from = start > monthStart ? start : monthStart;
    // A range ending at 23:59:59.999 IS the whole month — never 0.9999999.
    const to = end < monthEnd && monthEnd.getTime() - end.getTime() > 1000 ? end : monthEnd;
    if (to > from) total += (to.getTime() - from.getTime()) / (monthEnd.getTime() - monthStart.getTime());
    cursor = monthEnd;
  }
  return total;
}

/** Share of the calendar month `monthStart` that lies inside [start, end] (0..1). */
export function monthCoverage(monthYear: number, monthIndex: number, start: Date, end: Date): number {
  const monthStart = new Date(monthYear, monthIndex, 1);
  const monthEnd = new Date(monthYear, monthIndex + 1, 1);
  const from = start > monthStart ? start : monthStart;
  const to = end < monthEnd && monthEnd.getTime() - end.getTime() > 1000 ? end : monthEnd;
  if (to <= from) return 0;
  return Math.min(1, (to.getTime() - from.getTime()) / (monthEnd.getTime() - monthStart.getTime()));
}

/** Whether a project's `budget` is a monthly fee or a one-time value. */
export function billingTypeOf(p: Project): 'one-time' | 'monthly' {
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

/**
 * Months a monthly retainer was active inside a period, and the fee it earned
 * — the ONE rule projectPnl, departmentPnl, revenueRecognition and the client
 * table apply: span = createdAt..retainerEarningEnd, clipped to the period,
 * whole months, capped at the period's month count; a span that ended BEFORE
 * the period opened earns nothing.
 *
 * A month the PERIOD END cuts short ("Ky muaj" ends now, a year view ends
 * today) earns its elapsed share (`monthCoverage`), exactly as
 * `proratePlanPayroll` charges the plan payroll of a month still in progress —
 * a whole month of fee against ten days of cost read as a margin nobody had.
 * Two things stay whole on purpose: every month the period covers entirely,
 * and a month the RETAINER's own end cuts (cancelled on the 10th — the fee was
 * billed whole). A period that ends on a month end is byte-for-byte the
 * legacy result.
 */
export function retainerRevenueInPeriod(
  p: Project,
  feeAll: number,
  periodStart: Date,
  periodEnd: Date,
  periodMonths: number,
): { revenue: number; activeMonths: number } {
  const projStart = parseDate(p.createdAt) ?? periodStart;
  const projEnd = retainerEarningEnd(p, periodEnd);
  const s = projStart > periodStart ? projStart : periodStart;
  const e = projEnd < periodEnd ? projEnd : periodEnd;
  if (e < s) return { revenue: 0, activeMonths: 0 };
  let active = Math.min(monthsBetween(s, e), periodMonths);
  // Only the period end can cut the last month: `e === periodEnd` means the
  // retainer was still earning when the period closed.
  if (active >= 1 && projEnd.getTime() >= periodEnd.getTime()) {
    const share = monthCoverage(periodEnd.getFullYear(), periodEnd.getMonth(), periodStart, periodEnd);
    if (share > 0 && share < 1) active = active - 1 + share;
  }
  return { revenue: feeAll * active, activeMonths: active };
}
