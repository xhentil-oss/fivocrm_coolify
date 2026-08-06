// Department (service-line) profit & loss.
//
// Answers "how much do I actually make from Social / SEO / Web …?" by costing
// each project with the REAL people on it, then rolling projects up by department:
//   revenue   = project budget (one-time) or budget × active months (monthly)
//   labor     = each participant's salary, split EQUALLY across the projects they
//               work on in the period (no time-tracking needed)
//   direct    = expenses tagged to the project (excl. Salary category / rejected)
//   overhead  = non-project fixed expenses (rent, tools…) shared by revenue weight
//   profit    = revenue − labor − direct − overhead
// Salaries of people not on any project this period are reported separately as
// "unallocated labor" so the totals still reconcile with the company P&L.

import type { Project, TeamMember, Expense } from '../../types';
import { toAll } from '../utils';
import { parseDate, monthsElapsedInYear, MONTH_LABELS_SQ } from './financialAnalytics';
import { memberSalaryForMonth } from './salaryHistory';

export interface DepartmentPnlOptions {
  mode?: 'all' | 'completed';
  range?: { start: Date; end: Date };
  year?: number;
  allTime?: boolean;
  now?: Date;
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
}
export interface DepartmentPnlResult {
  rows: DepartmentRow[];
  unallocatedLabor: { total: number; members: { name: string; cost: number }[] };
  otherFixedPool: number;
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

  const inPeriod = (d: Date | null) => {
    if (opts.range) return !!d && d >= opts.range.start && d <= opts.range.end;
    if (opts.allTime || opts.year == null) return true;
    return !!d && d.getFullYear() === opts.year;
  };
  const mode = opts.mode ?? 'all';
  const periodProjects = projects.filter(p => {
    if (mode === 'completed' && !isCompleted(p)) return false;
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

  const memberPeriodSalary = (m: TeamMember): number => {
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

  // ── Expenses: direct (per project) vs other fixed (pool) ──
  const expDate = (e: Expense) => parseDate((e as any).date) || parseDate((e as any).createdAt);
  const expIn = (e: Expense) => (opts.allTime || (opts.year == null && !opts.range)) ? true : inPeriod(expDate(e));
  const directByProject = new Map<string, number>();
  let otherFixedPool = 0;
  for (const e of expenses ?? []) {
    if (!expIn(e)) continue;
    if ((e as any).approvalStatus === 'Rejected') continue;
    if ((e as any).category === CATEGORY_SALARY) continue;
    const amt = toAll(e.amount || 0, (e as any).currency);
    const pid = (e as any).projectId as string | undefined;
    if (pid) directByProject.set(pid, (directByProject.get(pid) || 0) + amt);
    else otherFixedPool += amt;
  }

  // ── Revenue per project ──
  const revenueOf = (p: Project): number => {
    const fee = toAll(p.budget || 0, (p as any).currency);
    if (fee <= 0) return 0;
    if (billingTypeOf(p) === 'one-time') return fee;
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
  const projectLines: DeptProjectLine[] = periodProjects.map(p => {
    const revenue = revenueByProject.get(p.id) || 0;
    const directCost = directByProject.get(p.id) || 0;
    const parts = participantsOf(p).map(id => {
      const m = memberById.get(id)!;
      const cnt = projectCountByMember.get(id) || 1;
      return { userId: id, name: memberName(id), cost: memberPeriodSalary(m) / cnt };
    });
    const labor = parts.reduce((s, x) => s + x.cost, 0);
    const overhead = totalRevenue > 0 ? otherFixedPool * (revenue / totalRevenue) : 0;
    const cost = directCost + labor + overhead;
    const profit = revenue - cost;
    return {
      id: p.id, name: p.name, customerId: p.customerId,
      revenue, directCost, labor, overhead, cost, profit,
      margin: revenue > 0 ? profit / revenue : null,
      participants: parts.sort((a, b) => b.cost - a.cost),
    };
  });

  // ── Group by department ──
  const deptMap = new Map<string, DepartmentRow>();
  const projectById = new Map(periodProjects.map(p => [p.id, p]));
  for (const line of projectLines) {
    const dept = ((projectById.get(line.id) as any)?.department || '').trim() || NO_DEPT;
    const row = deptMap.get(dept) || {
      department: dept, revenue: 0, directCost: 0, labor: 0, overhead: 0, cost: 0, profit: 0, margin: null, projects: [],
    };
    row.revenue += line.revenue; row.directCost += line.directCost; row.labor += line.labor;
    row.overhead += line.overhead; row.cost += line.cost; row.profit += line.profit;
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
): DepartmentTrend {
  const monthly: { label: string; byDept: Map<string, number> }[] = [];
  const totals = new Map<string, number>();
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const start = new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
    const res = computeDepartmentPnl(projects, teamMembers, expenses, { range: { start, end }, mode: 'all', now });
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
