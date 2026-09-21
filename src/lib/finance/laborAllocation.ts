/**
 * The ONE allocation of people's cost to projects — by the hours they logged.
 *
 * Every profitability surface (client table, project P&L, department P&L, bonus)
 * takes this object instead of inventing its own split, so a project's labour is
 * the same number on every screen and the totals foot:
 *
 *     absorbed (Σ project labour) + unabsorbed  ==  payrollBetween().total
 *
 * `unabsorbed` is the payroll the logged client hours did not cover — bench time,
 * meetings, admin, internal projects, people who logged nothing. It is real cost
 * and goes to the shared overhead pool; it is never dropped and never hidden.
 * When hours × rates exceed the payroll actually paid (rates set too high, a
 * freelancer logging hours without a salary row) the excess is reported as
 * `overAbsorbed` so the owner sees the rates are off, instead of a phantom loss.
 *
 * With NO entries in the period the result says `basis: 'none'` and every caller
 * falls back to its legacy rule and labels it — the same law as payroll's `basis`.
 */
import type { Expense, TeamMember, TimeEntry } from '../../types';
import { payrollBetween, type PeriodPayroll } from './payroll';
import { memberCostRate, memberCostRole, memberCapacityHours, type RateCardRole } from './costRates';
import { resolveFinanceSettings, type FinanceSettings, type CostRateBasis } from './profitabilityCore';
import { entryHours, entryInPeriod, entryInstantMs, entryIsOpen } from './timeEntries';
import { fractionalMonthsBetween, monthCoverage } from './projectPeriod';

export interface MemberLaborLine {
  userId: string;
  name: string;
  role: string;
  hours: number;
  cost: number;
}

export interface ProjectLabor {
  projectId: string;
  hours: number;
  cost: number;
  byMember: MemberLaborLine[];
  byRole: Record<string, { hours: number; cost: number }>;
}

export interface MemberLabor {
  userId: string;
  name: string;
  role: string;
  /** Hours on projects that have a client. */
  clientHours: number;
  /** Hours on internal projects or with no project. */
  internalHours: number;
  totalHours: number;
  /** Practical capacity over the period (monthly capacity × months). */
  capacityHours: number;
  utilizationPct: number | null;
  /** Cost of the CLIENT hours (ALL). */
  clientCost: number;
  /** Cost of every logged hour (ALL). */
  totalCost: number;
  /** Rate used for the last month of the period. */
  rate: number;
  rateBasis: CostRateBasis;
}

export interface LaborAllocation {
  basis: 'hours' | 'none';
  /** `months` is FRACTIONAL (1 Sep → 10 Sep = 0.32): capacity scales with elapsed time. */
  period: { start: Date; end: Date; months: number };
  settings: FinanceSettings;
  byProject: Map<string, ProjectLabor>;
  byMember: Map<string, MemberLabor>;
  /** Hours/cost logged with no project at all. */
  internal: { hours: number; cost: number };
  /** Σ labour cost of hours logged on projects (client or internal). */
  absorbed: number;
  /**
   * Payroll of the period. A month still in progress is charged at its
   * elapsed share ONLY when the month's basis is the PLAN — a recorded payment
   * is what left the bank and is never scaled (same law as the Financat hero).
   */
  payroll: PeriodPayroll;
  /** Payroll not covered by logged hours → shared overhead. */
  unabsorbed: number;
  /** Hours × rates beyond what payroll actually paid (rates too high / unpaid people). */
  overAbsorbed: number;
  totalHours: number;
  entriesConsidered: number;
  /** Entries whose userId is not a member — costed at 0 and counted here. */
  entriesWithoutMember: number;
  /** Members who logged hours but have no salary and no override. */
  membersWithoutRate: string[];
}

export interface LaborAllocationInput {
  timeEntries: TimeEntry[] | null | undefined;
  members: TeamMember[] | null | undefined;
  expenses: Expense[] | null | undefined;
  period: { start: Date; end: Date };
  settings?: Partial<FinanceSettings> | null;
  rateCard?: RateCardRole[] | null;
  /** projectId → has a customer (client work) — internal projects count as internal hours. */
  clientProjectIds?: Set<string> | null;
}

const monthEndOf = (ms: number): Date => {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
};

/**
 * A month the period only partly covers (month-to-date, or a range starting
 * mid-month) is charged at its elapsed share — but only where that month's
 * payroll is the PLAN. Charging a whole month of plan against ten days of hours
 * inflated `unabsorbed`, and with it every client's overhead, for the first
 * third of every month.
 */
export function proratePlanPayroll(p: PeriodPayroll, start: Date, end: Date): PeriodPayroll {
  let total = 0, profile = 0, changed = false;
  const months = p.months.map(m => {
    if (m.basis !== 'profile') { total += m.total; profile += m.profile; return m; }
    const share = monthCoverage(m.year, m.monthIndex, start, end);
    if (share >= 1 || share <= 0) { total += m.total; profile += m.profile; return m; }
    changed = true;
    const scaled = { ...m, total: m.total * share, profile: m.profile * share };
    total += scaled.total; profile += scaled.profile;
    return scaled;
  });
  return changed ? { ...p, total, profile, months } : p;
}

export function allocateLabor(input: LaborAllocationInput): LaborAllocation {
  const settings = resolveFinanceSettings(input.settings);
  const { start, end } = input.period;
  const months = fractionalMonthsBetween(start, end);
  const payroll = proratePlanPayroll(payrollBetween(input.members, input.expenses, start, end), start, end);
  const memberByUid = new Map<string, TeamMember>();
  for (const m of input.members || []) if (m.userId) memberByUid.set(m.userId, m);

  const byProject = new Map<string, ProjectLabor>();
  const byMember = new Map<string, MemberLabor>();
  const internal = { hours: 0, cost: 0 };
  let absorbed = 0, totalHours = 0, considered = 0, withoutMember = 0;
  const noRate = new Set<string>();
  const rateCache = new Map<string, { rate: number; basis: CostRateBasis }>();
  const rateFor = (m: TeamMember, atMs: number) => {
    const key = `${m.userId}|${new Date(atMs).getFullYear()}-${new Date(atMs).getMonth()}`;
    let r = rateCache.get(key);
    if (!r) {
      const cr = memberCostRate(m, monthEndOf(atMs), settings, input.rateCard);
      r = { rate: cr.rate, basis: cr.basis };
      rateCache.set(key, r);
    }
    return r;
  };
  const memberRow = (m: TeamMember): MemberLabor => {
    let row = byMember.get(m.userId);
    if (!row) {
      const lastRate = rateFor(m, end.getTime());
      row = {
        userId: m.userId, name: m.displayName || m.email || 'Pa emër', role: memberCostRole(m),
        clientHours: 0, internalHours: 0, totalHours: 0,
        capacityHours: memberCapacityHours(m, settings, input.rateCard) * months,
        utilizationPct: null, clientCost: 0, totalCost: 0, rate: lastRate.rate, rateBasis: lastRate.basis,
      };
      byMember.set(m.userId, row);
    }
    return row;
  };

  for (const e of input.timeEntries || []) {
    if (entryIsOpen(e)) continue;
    if (!entryInPeriod(e, start, end)) continue;
    const h = entryHours(e);
    if (h <= 0) continue;
    considered++;
    totalHours += h;
    const member = memberByUid.get(e.userId);
    if (!member) withoutMember++;
    const at = entryInstantMs(e) ?? end.getTime();
    const r = member ? rateFor(member, at) : { rate: 0, basis: 'none' as CostRateBasis };
    if (member && r.basis === 'none') noRate.add(member.displayName || member.email || member.userId);
    const cost = h * r.rate;
    const role = e.costRole || memberCostRole(member);
    const isClient = !!e.projectId && (!input.clientProjectIds || input.clientProjectIds.has(e.projectId));

    if (e.projectId) {
      let pl = byProject.get(e.projectId);
      if (!pl) { pl = { projectId: e.projectId, hours: 0, cost: 0, byMember: [], byRole: {} }; byProject.set(e.projectId, pl); }
      pl.hours += h; pl.cost += cost;
      const uid = e.userId || '?';
      let line = pl.byMember.find(l => l.userId === uid);
      if (!line) { line = { userId: uid, name: member ? (member.displayName || member.email || 'Pa emër') : 'I panjohur', role, hours: 0, cost: 0 }; pl.byMember.push(line); }
      line.hours += h; line.cost += cost;
      const br = pl.byRole[role] || { hours: 0, cost: 0 };
      br.hours += h; br.cost += cost; pl.byRole[role] = br;
      absorbed += cost;
    } else {
      internal.hours += h; internal.cost += cost;
    }

    if (member) {
      const row = memberRow(member);
      row.totalHours += h; row.totalCost += cost;
      if (isClient) { row.clientHours += h; row.clientCost += cost; } else { row.internalHours += h; }
    }
  }

  for (const row of byMember.values()) {
    row.utilizationPct = row.capacityHours > 0 ? (row.clientHours / row.capacityHours) * 100 : null;
  }
  for (const pl of byProject.values()) pl.byMember.sort((a, b) => b.cost - a.cost);

  // Internal-project hours are absorbed by a project row too (their cost is real);
  // only hours with NO project sit in `internal`. Both are covered by payroll.
  const covered = absorbed + internal.cost;
  const unabsorbed = Math.max(0, payroll.total - covered);
  const overAbsorbed = Math.max(0, covered - payroll.total);

  return {
    basis: considered > 0 ? 'hours' : 'none',
    period: { start, end, months },
    settings,
    byProject,
    byMember,
    internal,
    absorbed,
    payroll,
    unabsorbed,
    overAbsorbed,
    totalHours,
    entriesConsidered: considered,
    entriesWithoutMember: withoutMember,
    membersWithoutRate: Array.from(noRate).sort(),
  };
}

/** Labour for one project (empty when none). */
export function projectLaborOf(alloc: LaborAllocation | null | undefined, projectId: string): ProjectLabor {
  return alloc?.byProject.get(projectId) || { projectId, hours: 0, cost: 0, byMember: [], byRole: {} };
}

/**
 * Labour of ONE project over its whole life (for plan vs actual and EAC, which
 * compare against a plan made for the entire engagement, not for a month).
 * Same rates as `allocateLabor`, no payroll reconciliation.
 */
export function laborForEntries(
  entries: TimeEntry[] | null | undefined,
  members: TeamMember[] | null | undefined,
  rawSettings?: Partial<FinanceSettings> | null,
  rateCard?: RateCardRole[] | null,
  projectId?: string,
): ProjectLabor {
  const settings = resolveFinanceSettings(rawSettings);
  const memberByUid = new Map<string, TeamMember>();
  for (const m of members || []) if (m.userId) memberByUid.set(m.userId, m);
  const out: ProjectLabor = { projectId: projectId || '', hours: 0, cost: 0, byMember: [], byRole: {} };
  const rateCache = new Map<string, number>();
  for (const e of entries || []) {
    if (projectId && e.projectId !== projectId) continue;
    if (entryIsOpen(e)) continue;
    const h = entryHours(e);
    if (h <= 0) continue;
    const member = memberByUid.get(e.userId);
    const at = entryInstantMs(e) ?? Date.now();
    const key = `${e.userId}|${new Date(at).getFullYear()}-${new Date(at).getMonth()}`;
    let rate = rateCache.get(key);
    if (rate == null) {
      rate = member ? memberCostRate(member, monthEndOf(at), settings, rateCard).rate : 0;
      rateCache.set(key, rate);
    }
    const cost = h * rate;
    const role = e.costRole || memberCostRole(member);
    out.hours += h; out.cost += cost;
    const br = out.byRole[role] || { hours: 0, cost: 0 };
    br.hours += h; br.cost += cost; out.byRole[role] = br;
    let line = out.byMember.find(l => l.userId === e.userId);
    if (!line) { line = { userId: e.userId, name: member ? (member.displayName || member.email || 'Pa emër') : 'I panjohur', role, hours: 0, cost: 0 }; out.byMember.push(line); }
    line.hours += h; line.cost += cost;
  }
  out.byMember.sort((a, b) => b.cost - a.cost);
  return out;
}
