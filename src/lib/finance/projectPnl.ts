// Per-project profit & loss (P&L) with full-absorption overhead allocation.
//
// Model (decided with the business owner):
//  - Each project's REVENUE = its `budget` field ("Të Ardhurat e Projektit").
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

import type { Project, TeamMember, Expense } from '../../types';
import { toAll } from '../utils';
import { parseDate, monthsElapsedInYear } from './financialAnalytics';

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
}

export interface ProjectPnlRow {
  id: string;
  name: string;
  customerId?: string;
  responsibleUserId?: string;
  revenue: number;      // project budget (ALL)
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

  // ── Period filter — explicit range wins, then calendar year, then all-time.
  const inPeriod = (d: Date | null): boolean => {
    if (opts.range) return !!d && d >= opts.range.start && d <= opts.range.end;
    if (opts.allTime || opts.year == null) return true;
    return !!d && d.getFullYear() === opts.year;
  };

  const mode = opts.mode ?? 'all';
  const periodProjects = projects.filter(p => {
    if (mode === 'completed' && !isCompleted(p)) return false;
    return inPeriod(projectDate(p));
  });

  // ── How many months of salary to charge into the fixed pool.
  let months = opts.months;
  if (months == null) {
    if (opts.range) {
      const s = opts.range.start, e = opts.range.end;
      months = Math.max(1, (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth()) + 1);
    } else if (opts.year != null && !opts.allTime) {
      months = monthsElapsedInYear(opts.year, now);
    } else {
      // All-time: span the matched projects actually cover.
      const times = periodProjects.map(projectDate).filter((d): d is Date => !!d).map(d => d.getTime());
      if (times.length > 0) {
        const min = new Date(Math.min(...times));
        const max = new Date(Math.max(...times));
        months = Math.max(1, (max.getFullYear() - min.getFullYear()) * 12 + (max.getMonth() - min.getMonth()) + 1);
      } else {
        months = 12;
      }
    }
  }

  // ── Fixed cost pool: salaries + non-project, non-salary expenses in the period.
  const salaries = (teamMembers ?? [])
    .filter(m => m.status === 'Active')
    .reduce((s, m) => s + (m.monthlySalary || 0), 0) * months;

  const expDate = (e: Expense) => parseDate((e as any).date) || parseDate((e as any).createdAt);
  const expInPeriod = (e: Expense) => (opts.allTime || (opts.year == null && !opts.range)) ? true : inPeriod(expDate(e));

  let otherFixed = 0;
  const directByProject = new Map<string, number>();
  for (const e of expenses ?? []) {
    if (!expInPeriod(e)) continue;
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

  // ── Allocate the pool by revenue weight (equal split when no revenue).
  const totalRevenue = periodProjects.reduce((s, p) => s + (p.budget || 0), 0);
  const allocationBasis: 'revenue' | 'equal' = totalRevenue > 0 ? 'revenue' : 'equal';
  const equalShare = periodProjects.length > 0 ? 1 / periodProjects.length : 0;

  const missingBudget = { count: 0, names: [] as string[] };

  const rows: ProjectPnlRow[] = periodProjects.map(p => {
    const revenue = p.budget || 0;
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
