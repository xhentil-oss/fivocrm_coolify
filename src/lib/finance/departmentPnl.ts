// Department (service-line) profit & loss.
//
// Answers "how much do I actually make from Social / SEO / Web …?" by costing
// each project with the REAL people on it, then rolling projects up by department:
//   revenue   = project budget (one-time) or budget × active months (monthly)
//   labor     = each participant's salary, split EQUALLY across the projects they
//               work on in the period (no time-tracking needed)
//   direct    = expenses tagged to the project (excl. Salary category / rejected)
//   overhead  = business-wide fixed expenses shared by revenue weight, PLUS the
//               department's own tagged expenses (`expense.departmentId`) spread
//               only inside that department
//   profit    = revenue − labor − direct − overhead
// Salaries of people not on any project this period are reported separately as
// "unallocated labor" so the totals still reconcile with the company P&L.
//
// Two ways cost used to leak out of this model, both now closed:
//   · an expense tagged to a project OUTSIDE the period landed in a per-project
//     bucket that had no row, and was not pooled either — the money vanished;
//   · `expense.departmentId` was never read by anything, so a cost belonging to
//     one department was spread by revenue weight across all of them.
// Both are pooled honestly now and reported (`unallocatedDirect`,
// `unmatchedDepartmentFixed`) rather than absorbed silently.

import type { Project, TeamMember, Expense, Invoice } from '../../types';
import { toAll } from '../utils';
import { parseDate, monthsElapsedInYear, MONTH_LABELS_SQ, getInvoiceCollectedBetween } from './financialAnalytics';
import { memberSalaryForMonth } from './salaryHistory';
import { payrollBetween } from './payroll';

export interface DepartmentPnlOptions {
  mode?: 'all' | 'completed';
  range?: { start: Date; end: Date };
  year?: number;
  allTime?: boolean;
  now?: Date;
  /** 'budget' (default) or 'invoiced' (actual billed invoices per project). */
  revenueBasis?: 'budget' | 'invoiced';
  invoices?: Invoice[] | null;
  /**
   * The tenant's teams, needed to make `expense.departmentId` mean something.
   *
   * A department here is the free-text `project.department`, while an expense
   * carries a `teams` document id — two different key spaces. Without the teams
   * list the two can never be joined, which is why `expense.departmentId` was
   * write-only for its whole life: the form collected it, the list displayed it,
   * and no report read it. Omit it and behaviour is exactly as before (every
   * non-project expense is global overhead).
   */
  teams?: Array<{ id: string; name?: string; department?: string }> | null;
}

export interface DeptParticipant { userId: string; name: string; cost: number }
export interface DeptProjectLine {
  id: string; name: string; customerId?: string;
  revenue: number; directCost: number; labor: number; overhead: number;
  cost: number; profit: number; margin: number | null;
  participants: DeptParticipant[];
}
export interface DepartmentRow {
  department: string;
  revenue: number; directCost: number; labor: number; overhead: number;
  cost: number; profit: number; margin: number | null;
  projects: DeptProjectLine[];
  /** The slice of `overhead` that came from expenses tagged to THIS department
   *  (rather than from the business-wide pool split by revenue weight). */
  departmentFixed: number;
}
export interface DepartmentPnlResult {
  rows: DepartmentRow[];
  unallocatedLabor: { total: number; members: { name: string; cost: number }[] };
  /** Business-wide fixed expenses, split across projects by revenue weight. */
  otherFixedPool: number;
  /** Fixed expenses charged to ONE department via `expense.departmentId`. */
  departmentFixedPool: Record<string, number>;
  /**
   * Expenses whose `departmentId` matched no department that has projects in
   * this period — they fall back to the business-wide pool. Surfaced because a
   * silent fallback is indistinguishable from correct attribution.
   */
  unmatchedDepartmentFixed: { count: number; amount: number };
  /** Expenses tagged to a project outside this period; pooled, not dropped. */
  unallocatedDirect: { count: number; amount: number };
  totals: { revenue: number; directCost: number; labor: number; overhead: number; cost: number; profit: number };
}

const CATEGORY_SALARY = 'Salary';
const NO_DEPT = 'Pa departament';

function isCompleted(p: Project): boolean {
  return p.status === 'Completed' || (!!(p as any).isRecurring && !!(p as any).lastCompletedAt);
}
function projectDate(p: Project): Date | null {
  return parseDate((p as any).lastCompletedAt) || parseDate(p.updatedAt) || parseDate(p.createdAt);
}
function monthsBetween(a: Date, b: Date): number {
  return Math.max(1, (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()) + 1);
}
function billingTypeOf(p: Project): 'one-time' | 'monthly' {
  if (p.billingType === 'monthly' || p.billingType === 'one-time') return p.billingType;
  return (p as any).isRecurring ? 'monthly' : 'one-time';
}
const norm = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase() : '');

export function computeDepartmentPnl(
  projects: Project[] | undefined | null,
  teamMembers: TeamMember[] | undefined | null,
  expenses: Expense[] | undefined | null,
  opts: DepartmentPnlOptions = {},
): DepartmentPnlResult {
  const now = opts.now ?? new Date();
  const empty: DepartmentPnlResult = {
    rows: [], unallocatedLabor: { total: 0, members: [] }, otherFixedPool: 0,
    departmentFixedPool: {},
    unmatchedDepartmentFixed: { count: 0, amount: 0 },
    unallocatedDirect: { count: 0, amount: 0 },
    totals: { revenue: 0, directCost: 0, labor: 0, overhead: 0, cost: 0, profit: 0 },
  };
  if (!projects) return empty;

  // ── Period window ──
  let periodStart: Date, periodEnd: Date;
  if (opts.range) { periodStart = opts.range.start; periodEnd = opts.range.end; }
  else if (opts.year != null && !opts.allTime) {
    periodStart = new Date(opts.year, 0, 1);
    periodEnd = opts.year === now.getFullYear() ? now : new Date(opts.year, 11, 31, 23, 59, 59, 999);
  } else {
    const times = projects.map(projectDate).filter((d): d is Date => !!d).map(d => d.getTime());
    periodStart = times.length ? new Date(Math.min(...times)) : now;
    periodEnd = now;
  }
  const periodMonths = (opts.year != null && !opts.allTime && !opts.range)
    ? monthsElapsedInYear(opts.year, now)
    : monthsBetween(periodStart, periodEnd);

  // Invoiced-basis revenue per project (billed invoices linked to the project).
  const useInvoiced = opts.revenueBasis === 'invoiced';
  const invWindow = opts.allTime ? { start: new Date(0), end: now } : { start: periodStart, end: periodEnd };
  const invoicedByProject = new Map<string, number>();
  if (useInvoiced) {
    for (const inv of opts.invoices || []) {
      const pid = inv.projectId;
      if (!pid) continue;
      const amt = getInvoiceCollectedBetween(inv, invWindow.start, invWindow.end);
      if (amt) invoicedByProject.set(pid, (invoicedByProject.get(pid) || 0) + amt);
    }
  }

  const inPeriod = (d: Date | null) => {
    if (opts.range) return !!d && d >= opts.range.start && d <= opts.range.end;
    if (opts.allTime || opts.year == null) return true;
    return !!d && d.getFullYear() === opts.year;
  };
  const mode = opts.mode ?? 'all';
  const periodProjects = projects.filter(p => {
    if (mode === 'completed' && !isCompleted(p)) return false;
    if (useInvoiced && (invoicedByProject.get(p.id) || 0) !== 0) return true;
    // Monthly retainers earn in EVERY month their active span overlaps the
    // period (not only the month of their last update) — essential for a
    // per-month trend. One-time projects count in the period of their date.
    if (billingTypeOf(p) === 'monthly') {
      const start = parseDate(p.createdAt) ?? periodStart;
      const end = parseDate((p as any).lastCompletedAt) ?? periodEnd; // ongoing → now
      return start <= periodEnd && end >= periodStart;
    }
    return inPeriod(projectDate(p));
  });

  // ── Members: period salary (history + status aware) and lookup ──
  const activeMembers = (teamMembers ?? []).filter(m => m.status === 'Active');
  const memberById = new Map<string, TeamMember>();
  activeMembers.forEach(m => { if (m.userId) memberById.set(norm(m.userId), m); });

  /** What the member PROFILES say this member costs over the period. Used as an
   *  allocation weight, not as the amount — see `memberPeriodSalary`. */
  const memberPlanSalary = (m: TeamMember): number => {
    let sum = 0;
    const cur = new Date(periodStart.getFullYear(), periodStart.getMonth(), 1);
    const last = new Date(periodEnd.getFullYear(), periodEnd.getMonth(), 1);
    let guard = 0;
    while (cur.getTime() <= last.getTime() && guard < 600) {
      const monthEnd = new Date(cur.getFullYear(), cur.getMonth() + 1, 0, 23, 59, 59, 999);
      sum += memberSalaryForMonth(m, monthEnd);
      cur.setMonth(cur.getMonth() + 1);
      guard++;
    }
    return sum;
  };

  // ── Labour cost = the ACTUAL payroll of the period, split across members by
  // their plan salary.
  //
  // The period's payroll comes from `payrollBetween()` (recorded salary
  // payments, plan only for months with none) — the same figure projectPnl
  // charges into its fixed pool, so the two panels on Financat can no longer
  // disagree. It is not read per member because a recorded row identifies its
  // person only when `memberId` is set (most carry just a name in the title),
  // so the plan salaries are used as WEIGHTS and scaled to the real total.
  // With no plan at all, the payroll is split equally across active members —
  // otherwise recorded payroll would vanish from every department.
  const planTotal = activeMembers.reduce((s, m) => s + memberPlanSalary(m), 0);
  const actualPayroll = payrollBetween(teamMembers, expenses, periodStart, periodEnd).total;
  const payrollScale = planTotal > 0 ? actualPayroll / planTotal : 0;
  const equalShare = activeMembers.length > 0 ? actualPayroll / activeMembers.length : 0;

  const memberPeriodSalary = (m: TeamMember): number => (
    planTotal > 0 ? memberPlanSalary(m) * payrollScale : equalShare
  );

  const participantsOf = (p: Project): string[] => {
    const ids = new Set<string>();
    const owner = norm(p.responsibleUserId || p.createdByUserId || '');
    if (owner && memberById.has(owner)) ids.add(owner);
    ((p as any).memberUserIds || []).forEach((u: string) => { const k = norm(u); if (memberById.has(k)) ids.add(k); });
    return Array.from(ids);
  };

  // How many period-projects each member participates in (for equal split).
  const projectCountByMember = new Map<string, number>();
  periodProjects.forEach(p => participantsOf(p).forEach(id => {
    projectCountByMember.set(id, (projectCountByMember.get(id) || 0) + 1);
  }));

  // ── Which department does a project belong to? (free-text on the project) ──
  const deptOfProject = (p: Project): string => ((p as any).department || '').trim() || NO_DEPT;
  const departmentsInPeriod = new Set(periodProjects.map(deptOfProject));

  // ── expense.departmentId (a `teams` doc id) → department label ──
  // Prefer `team.department` (the same free-text field projects carry), fall
  // back to `team.name`. Only a label that actually has projects in this period
  // can absorb cost; anything else falls back to the business-wide pool and is
  // reported rather than silently reattributed.
  const deptLabelByTeamId = new Map<string, string>();
  for (const t of opts.teams ?? []) {
    const candidates = [(t.department || '').trim(), (t.name || '').trim()].filter(Boolean);
    const match = candidates.find(c => departmentsInPeriod.has(c));
    if (match) deptLabelByTeamId.set(t.id, match);
  }

  // ── Expenses: project-direct → department-fixed → business-wide pool ──
  const expDate = (e: Expense) => parseDate((e as any).date) || parseDate((e as any).createdAt);
  const expIn = (e: Expense) => (opts.allTime || (opts.year == null && !opts.range)) ? true : inPeriod(expDate(e));
  // A cost tagged to a project OUTSIDE the period had no row to land on and was
  // not pooled either, so it evaporated: directCost + otherFixedPool did not add
  // up to the period's expenses. It is a real cost of the period — pool it.
  const absorbable = new Set(periodProjects.map(p => p.id));
  const directByProject = new Map<string, number>();
  const departmentFixedPool = new Map<string, number>();
  const unmatchedDepartmentFixed = { count: 0, amount: 0 };
  const unallocatedDirect = { count: 0, amount: 0 };
  let otherFixedPool = 0;
  for (const e of expenses ?? []) {
    if (!expIn(e)) continue;
    if ((e as any).approvalStatus === 'Rejected') continue;
    if ((e as any).category === CATEGORY_SALARY) continue;
    const amt = toAll(e.amount || 0, (e as any).currency);
    const pid = (e as any).projectId as string | undefined;
    if (pid && absorbable.has(pid)) {
      directByProject.set(pid, (directByProject.get(pid) || 0) + amt);
      continue;
    }
    if (pid) {
      unallocatedDirect.count += 1;
      unallocatedDirect.amount += amt;
      otherFixedPool += amt;
      continue;
    }
    const deptId = (e as any).departmentId as string | undefined;
    const label = deptId ? deptLabelByTeamId.get(deptId) : undefined;
    if (label) {
      departmentFixedPool.set(label, (departmentFixedPool.get(label) || 0) + amt);
      continue;
    }
    if (deptId) { unmatchedDepartmentFixed.count += 1; unmatchedDepartmentFixed.amount += amt; }
    otherFixedPool += amt;
  }

  // ── Revenue per project ──
  const revenueOf = (p: Project): number => {
    if (useInvoiced) return invoicedByProject.get(p.id) || 0;
    const fee = toAll(p.budget || 0, (p as any).currency);
    if (fee <= 0) return 0;
    if (billingTypeOf(p) === 'one-time') {
      // Point-in-time recognition: a one-time deal is earned when DELIVERED, so it
      // is recognised in the month the project was completed — not while running.
      if (!isCompleted(p)) return 0;
      const done = parseDate((p as any).lastCompletedAt) || parseDate(p.updatedAt);
      return (!!done && done >= periodStart && done <= periodEnd) ? fee : 0;
    }
    const s = (parseDate(p.createdAt) ?? periodStart) > periodStart ? (parseDate(p.createdAt) as Date) : periodStart;
    const eRaw = parseDate((p as any).lastCompletedAt) ?? periodEnd;
    const e = eRaw < periodEnd ? eRaw : periodEnd;
    const active = e >= s ? Math.min(monthsBetween(s, e), periodMonths) : 1;
    return fee * active;
  };
  const revenueByProject = new Map<string, number>(periodProjects.map(p => [p.id, revenueOf(p)]));
  const totalRevenue = periodProjects.reduce((s, p) => s + (revenueByProject.get(p.id) || 0), 0);

  // ── Build project lines ──
  const memberName = (id: string) => {
    const m = memberById.get(id);
    return m ? (m.displayName || (m as any).email || 'Pa emër') : 'I panjohur';
  };
  // Revenue and project count per department — the weights a department-tagged
  // expense is spread by inside its own department (equal split when the
  // department earned nothing, mirroring the business-wide `allocationBasis`).
  const deptRevenue = new Map<string, number>();
  const deptProjectCount = new Map<string, number>();
  for (const p of periodProjects) {
    const d = deptOfProject(p);
    deptRevenue.set(d, (deptRevenue.get(d) || 0) + (revenueByProject.get(p.id) || 0));
    deptProjectCount.set(d, (deptProjectCount.get(d) || 0) + 1);
  }

  const projectLines: Array<DeptProjectLine & { departmentFixed: number }> = periodProjects.map(p => {
    const revenue = revenueByProject.get(p.id) || 0;
    const directCost = directByProject.get(p.id) || 0;
    const parts = participantsOf(p).map(id => {
      const m = memberById.get(id)!;
      const cnt = projectCountByMember.get(id) || 1;
      return { userId: id, name: memberName(id), cost: memberPeriodSalary(m) / cnt };
    });
    const labor = parts.reduce((s, x) => s + x.cost, 0);
    // Two overhead components: the business-wide pool by revenue weight, plus
    // this department's OWN tagged expenses spread only inside the department.
    const globalOverhead = totalRevenue > 0 ? otherFixedPool * (revenue / totalRevenue) : 0;
    const dept = deptOfProject(p);
    const deptPool = departmentFixedPool.get(dept) || 0;
    const dRev = deptRevenue.get(dept) || 0;
    const departmentFixed = deptPool === 0 ? 0
      : dRev > 0 ? deptPool * (revenue / dRev)
      : deptPool / (deptProjectCount.get(dept) || 1);
    const overhead = globalOverhead + departmentFixed;
    const cost = directCost + labor + overhead;
    const profit = revenue - cost;
    return {
      id: p.id, name: p.name, customerId: p.customerId,
      revenue, directCost, labor, overhead, cost, profit,
      margin: revenue > 0 ? profit / revenue : null,
      participants: parts.sort((a, b) => b.cost - a.cost),
      departmentFixed,
    };
  });

  // ── Group by department ──
  const deptMap = new Map<string, DepartmentRow>();
  const projectById = new Map(periodProjects.map(p => [p.id, p]));
  for (const line of projectLines) {
    const proj = projectById.get(line.id);
    const dept = proj ? deptOfProject(proj) : NO_DEPT;
    const row = deptMap.get(dept) || {
      department: dept, revenue: 0, directCost: 0, labor: 0, overhead: 0, cost: 0, profit: 0, margin: null,
      projects: [], departmentFixed: 0,
    };
    row.revenue += line.revenue; row.directCost += line.directCost; row.labor += line.labor;
    row.overhead += line.overhead; row.cost += line.cost; row.profit += line.profit;
    row.departmentFixed += line.departmentFixed;
    row.projects.push(line);
    deptMap.set(dept, row);
  }
  const rows = Array.from(deptMap.values()).map(r => ({
    ...r,
    margin: r.revenue > 0 ? r.profit / r.revenue : null,
    projects: r.projects.sort((a, b) => b.profit - a.profit),
  })).sort((a, b) => b.profit - a.profit);

  // ── Unallocated labor: active members on no period-project ──
  const unallocatedMembers = activeMembers
    .filter(m => (projectCountByMember.get(norm(m.userId || '')) || 0) === 0)
    .map(m => ({ name: m.displayName || (m as any).email || 'Pa emër', cost: memberPeriodSalary(m) }))
    .filter(x => x.cost > 0)
    .sort((a, b) => b.cost - a.cost);
  const unallocatedTotal = unallocatedMembers.reduce((s, x) => s + x.cost, 0);

  const totals = projectLines.reduce((t, l) => ({
    revenue: t.revenue + l.revenue, directCost: t.directCost + l.directCost, labor: t.labor + l.labor,
    overhead: t.overhead + l.overhead, cost: t.cost + l.cost, profit: t.profit + l.profit,
  }), { revenue: 0, directCost: 0, labor: 0, overhead: 0, cost: 0, profit: 0 });

  return {
    rows,
    unallocatedLabor: { total: unallocatedTotal, members: unallocatedMembers },
    otherFixedPool,
    departmentFixedPool: Object.fromEntries(departmentFixedPool),
    unmatchedDepartmentFixed,
    unallocatedDirect,
    totals,
  };
}

export interface DepartmentTrend {
  /** Recharts-ready rows: { label, <dept>: profit, … } — one per month, oldest first. */
  data: Array<Record<string, number | string>>;
  /** Departments ordered by total profit over the window (biggest first). */
  departments: string[];
  /** Per department: profit last month vs the month before (for the ↑/↓ badge). */
  deltas: Record<string, { last: number; prev: number; delta: number }>;
}

/** Monthly profit per department over the last `months` months (default 6). */
export function buildDepartmentProfitTrend(
  projects: Project[] | undefined | null,
  teamMembers: TeamMember[] | undefined | null,
  expenses: Expense[] | undefined | null,
  now: Date = new Date(),
  months = 6,
  extra: {
    revenueBasis?: 'budget' | 'invoiced';
    invoices?: Invoice[] | null;
    teams?: Array<{ id: string; name?: string; department?: string }> | null;
  } = {},
): DepartmentTrend {
  const monthly: { label: string; byDept: Map<string, number> }[] = [];
  const totals = new Map<string, number>();
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const start = new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
    const res = computeDepartmentPnl(projects, teamMembers, expenses, {
      range: { start, end }, mode: 'all', now,
      revenueBasis: extra.revenueBasis, invoices: extra.invoices, teams: extra.teams,
    });
    const byDept = new Map<string, number>();
    for (const row of res.rows) {
      byDept.set(row.department, row.profit);
      totals.set(row.department, (totals.get(row.department) || 0) + row.profit);
    }
    monthly.push({ label: MONTH_LABELS_SQ[d.getMonth()], byDept });
  }
  const departments = Array.from(totals.keys()).sort((a, b) => (totals.get(b) || 0) - (totals.get(a) || 0));
  const data = monthly.map(m => {
    const row: Record<string, number | string> = { label: m.label };
    for (const dept of departments) row[dept] = Math.round(m.byDept.get(dept) || 0);
    return row;
  });
  const deltas: Record<string, { last: number; prev: number; delta: number }> = {};
  for (const dept of departments) {
    const last = (monthly[monthly.length - 1]?.byDept.get(dept)) || 0;
    const prev = (monthly[monthly.length - 2]?.byDept.get(dept)) || 0;
    deltas[dept] = { last, prev, delta: last - prev };
  }
  return { data, departments, deltas };
}
