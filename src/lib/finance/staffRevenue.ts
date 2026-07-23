// Per-employee revenue ("xhiro") from project values.
//
// Model (decided with the business owner):
//  - Each project has a value = `budget` (labeled "Të Ardhurat e Projektit").
//  - By default the FULL value is credited to the project's responsible person
//    (`responsibleUserId`, falling back to `createdByUserId`).
//  - The owner may override this per project via `profitSplit` — a manual
//    redistribution among staff whose percents sum to 100.
//  - Cost per member = their direct-expense share of the project + prorated salary
//    (monthlySalary × months, spread across the projects they are credited in).
//
// This is the single source of truth used by both ReportsView and StaffRevenueView.

import type { Project, TeamMember, Expense } from '../../types';
import { toAll } from '../utils';
import { parseDate } from './financialAnalytics';

export interface StaffRevenueOptions {
  /** 'completed' counts only Completed (or recurring-completed) projects; 'all' counts every project with a value. */
  mode: 'all' | 'completed';
  /** Explicit date window; takes precedence over year/allTime. Use for rolling ranges (last 1/3/6/12 months). */
  range?: { start: Date; end: Date };
  /** Restrict to a calendar year. Omit (or allTime) for no date restriction. */
  year?: number;
  allTime?: boolean;
  /** Months of salary to charge in the period (e.g. monthsElapsedInYear, or the window length). Defaults to 12. */
  months?: number;
}

export interface StaffRevenueProjectLine {
  id: string;
  name: string;
  value: number;      // this member's credited share of the project value
  percent: number;    // 0..100 — the share this member holds on the project
  isResponsible: boolean;
}

export interface StaffRevenueRow {
  key: string;
  userId?: string;
  name: string;
  role: string;
  projects: number;
  value: number;   // total xhiro credited to this member
  cost: number;    // direct-expense share + prorated salary
  profit: number;  // value − cost
  projectLines: StaffRevenueProjectLine[];
}

export interface StaffRevenueResult {
  rows: StaffRevenueRow[];
  totalValue: number;
  totalCost: number;
  totalProfit: number;
  /** Value that could not be matched to an active member (e.g. responsible left the team). */
  unattributed: { value: number; count: number };
  /** Projects that have participants credited but no `budget` set (their xhiro reads as 0). */
  missingBudget: { count: number; names: string[] };
}

const norm = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase() : '');

const memberIds = (m: TeamMember) =>
  new Set([m.userId, (m as any).email].map(norm).filter(Boolean));

/** Allocation of a project's value: [{ id, fraction }] where fractions sum to ~1. */
function allocationFor(p: Project): Array<{ id: string; fraction: number }> {
  const split = (p as any).profitSplit as Array<{ userId: string; percent: number }> | undefined;
  if (Array.isArray(split) && split.length > 0) {
    const total = split.reduce((s, e) => s + (Number(e.percent) || 0), 0);
    if (total > 0) {
      return split
        .filter(e => e.userId && (Number(e.percent) || 0) > 0)
        .map(e => ({ id: String(e.userId), fraction: (Number(e.percent) || 0) / total }));
    }
  }
  const owner = p.responsibleUserId || p.createdByUserId;
  return owner ? [{ id: String(owner), fraction: 1 }] : [];
}

function isCompleted(p: Project): boolean {
  return p.status === 'Completed' || (!!(p as any).isRecurring && !!(p as any).lastCompletedAt);
}

function projectDate(p: Project): Date | null {
  return parseDate((p as any).lastCompletedAt) || parseDate(p.updatedAt) || parseDate(p.createdAt);
}

export function computeStaffRevenue(
  projects: Project[] | undefined | null,
  teamMembers: TeamMember[] | undefined | null,
  expenses: Expense[] | undefined | null,
  opts: StaffRevenueOptions,
): StaffRevenueResult {
  const empty: StaffRevenueResult = {
    rows: [], totalValue: 0, totalCost: 0, totalProfit: 0,
    unattributed: { value: 0, count: 0 }, missingBudget: { count: 0, names: [] },
  };
  if (!projects || !teamMembers) return empty;

  let months = opts.months ?? 12;
  const activeMembers = teamMembers.filter(m => m.status === 'Active');

  // Period filter — explicit range wins, then calendar year, then all-time.
  const inYear = (d: Date | null): boolean => {
    if (opts.range) {
      if (!d) return false;
      return d >= opts.range.start && d <= opts.range.end;
    }
    if (opts.allTime || opts.year == null) return true;
    if (!d) return false;
    return d.getFullYear() === opts.year;
  };
  const periodProjects = projects.filter(p => {
    if (opts.mode === 'completed' && !isCompleted(p)) return false;
    return inYear(projectDate(p));
  });

  // All-time: charge salary for the ACTUAL span the matched projects cover
  // rather than a hardcoded 12 months. Otherwise multi-year project value is
  // compared against only one year of salary cost, inflating profit.
  if (opts.allTime && opts.months == null) {
    const times = periodProjects
      .map(projectDate)
      .filter((d): d is Date => !!d)
      .map(d => d.getTime());
    if (times.length > 0) {
      const min = new Date(Math.min(...times));
      const max = new Date(Math.max(...times));
      const span = (max.getFullYear() - min.getFullYear()) * 12 + (max.getMonth() - min.getMonth()) + 1;
      months = Math.max(1, span);
    }
  }

  // Resolve an allocation id (uid or email) to an active member.
  const memberFor = (id: string): TeamMember | undefined => {
    const key = norm(id);
    if (!key) return undefined;
    return activeMembers.find(m => memberIds(m).has(key));
  };

  const expDate = (e: Expense) => parseDate((e as any).date) || parseDate((e as any).createdAt);
  const directExpensesOf = (projectId: string): number =>
    (expenses ?? [])
      // Match projectPnl: salary is not a project-direct cost, and rejected
      // expenses never hit the books.
      .filter(e => (e as any).projectId === projectId
        && (e as any).category !== 'Salary'
        && (e as any).approvalStatus !== 'Rejected'
        && inYear(expDate(e)))
      .reduce((s, e) => s + toAll(e.amount || 0, (e as any).currency), 0);

  const memberKey = (m: TeamMember) => m.userId || (m as any).email || m.id;

  // Pass 1: how many credited projects each member has (to prorate salary).
  const projCount = new Map<string, number>();
  periodProjects.forEach(p => {
    allocationFor(p).forEach(a => {
      const m = memberFor(a.id);
      if (!m) return;
      const k = memberKey(m);
      projCount.set(k, (projCount.get(k) || 0) + 1);
    });
  });

  const acc = new Map<string, StaffRevenueRow>();
  const unattributed = { value: 0, count: 0 };
  const missingBudget = { count: 0, names: [] as string[] };

  periodProjects.forEach(p => {
    const value = p.budget || 0;
    const alloc = allocationFor(p);
    if (alloc.length === 0) return;
    const directExp = directExpensesOf(p.id);
    const ownerId = norm(p.responsibleUserId || p.createdByUserId || '');

    let creditedToSomeone = false;
    alloc.forEach(a => {
      const m = memberFor(a.id);
      const shareValue = value * a.fraction;
      const shareExp = directExp * a.fraction;
      if (!m) {
        unattributed.value += shareValue;
        return;
      }
      creditedToSomeone = true;
      const k = memberKey(m);
      const cnt = projCount.get(k) || 1;
      const salaryShare = ((m.monthlySalary || 0) * months) / cnt;
      const row = acc.get(k) || {
        key: k, userId: m.userId, name: m.displayName || (m as any).email || 'Pa emër',
        role: m.role, projects: 0, value: 0, cost: 0, profit: 0, projectLines: [],
      };
      row.projects += 1;
      row.value += shareValue;
      row.cost += shareExp + salaryShare;
      row.projectLines.push({
        id: p.id, name: p.name, value: shareValue,
        percent: Math.round(a.fraction * 100),
        isResponsible: norm(a.id) === ownerId,
      });
      acc.set(k, row);
    });

    if (alloc.some(a => !memberFor(a.id))) unattributed.count += 1;
    if (creditedToSomeone && value === 0) {
      missingBudget.count += 1;
      missingBudget.names.push(p.name);
    }
  });

  const rows = Array.from(acc.values())
    .map(r => ({ ...r, profit: r.value - r.cost }))
    .sort((a, b) => b.value - a.value);

  return {
    rows,
    totalValue: rows.reduce((s, r) => s + r.value, 0),
    totalCost: rows.reduce((s, r) => s + r.cost, 0),
    totalProfit: rows.reduce((s, r) => s + r.profit, 0),
    unattributed,
    missingBudget,
  };
}
