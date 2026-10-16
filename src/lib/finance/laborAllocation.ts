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
 * A consumer's ROWS never cover every hour: entries with no project sit in
 * `internal`, and `absorbed` includes projects the consumer has no row for
 * (archived, outside its period, an unknown projectId). Pooling only
 * `unabsorbed` silently dropped both — labour that was real cost landed in no
 * row and no pool. `laborOutsideRows()` is the one answer to "what labour must
 * my overhead pool carry besides `unabsorbed`", so in every engine
 *
 *     Σ rows' labour + pool labour  ==  absorbed + internal + unabsorbed  ==  payroll
 *
 * (equality with payroll holds exactly when `overAbsorbed` is 0).
 *
 * Rows are charged at the LOADED rate (salary × (1 + employerCostPct) / capacity)
 * while `payroll` is what was paid (unloaded), so a normal month over-absorbs by
 * the employer load alone. That excess is NOT pooled as a negative cost — a
 * signed pool made overhead negative under the defaults (net > gross for every
 * client). The pool is `poolLabor()` = unabsorbed (≥ 0) + labour outside rows,
 * never negative, and the excess is reported on its own as `loadCredit`
 * (`loadCreditOf` = `overAbsorbed`), so exactly:
 *
 *     Σ rows' labour + poolLabor  ==  payroll + loadCredit
 *     Σ row profit − unallocated overhead + loadCredit  ==  operating profit
 *
 * "Kontrollo tarifat" is only a real signal beyond the employer load:
 * `overAbsorbedVsLoaded` compares against `loadedPayroll` = payroll × (1 + employerCostPct).
 *
 * With NO entries in the period the result says `basis: 'none'` and every caller
 * falls back to its legacy rule and labels it — the same law as payroll's `basis`.
 */
import type { Expense, TeamMember, TimeEntry } from '../../types';
import { payrollBetween, type PeriodPayroll } from './payroll';
import { personCostRate, memberCostRole, memberCapacityHours, type RateCardRole } from './costRates';
import { resolveFinanceSettings, type FinanceSettings, type CostRateBasis } from './profitabilityCore';
import { entryHours, entryInPeriod, entryInstantMs, entryIsOpen } from './timeEntries';
import { fractionalMonthsBetween, monthCoverage } from './projectPeriod';
import { groupMembersByPerson, personEmployedInMonth, personOf, type PersonRecord } from './salaryHistory';

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
  /** Payroll not covered by logged hours → shared overhead (≥ 0). */
  unabsorbed: number;
  /**
   * Hours × rates beyond what payroll actually paid (employer load, rates too
   * high, unpaid people) — ≥ 0. Never pooled as a negative cost: every consumer
   * reports it as its own reconciliation line (`loadCredit`), see the header.
   */
  overAbsorbed: number;
  /** payroll × (1 + employerCostPct) — what the loaded rates are calibrated to cover. */
  loadedPayroll: number;
  /** Hours × rates beyond the LOADED payroll — the real "kontrollo tarifat" signal. */
  overAbsorbedVsLoaded: number;
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

/**
 * Months (fractional, like `fractionalMonthsBetween`) of [start, end] in which
 * `member` was employed — whole-month convention, the same as salary: a month
 * counts when `memberEmployedInMonth` says so, at the share the period covers.
 * A Nov hire adds nothing to September; a March hire in a Jan–Dec view counts
 * from March.
 */
export function memberEmployedMonthsBetween(member: TeamMember | PersonRecord, start: Date, end: Date): number {
  if (end <= start) return 0;
  const person: PersonRecord = 'rows' in member ? member : personOf(member);
  let total = 0;
  let cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  const lastMonth = new Date(end.getFullYear(), end.getMonth(), 1);
  for (let guard = 0; cursor.getTime() <= lastMonth.getTime() && guard < 1200; guard++) {
    const y = cursor.getFullYear(), m = cursor.getMonth();
    const monthEnd = new Date(y, m + 1, 0, 23, 59, 59, 999);
    if (personEmployedInMonth(person, monthEnd)) total += monthCoverage(y, m, start, end);
    cursor = new Date(y, m + 1, 1);
  }
  return total;
}

/** userId → the person (all their rows). Rows without a userId cannot log hours and are skipped. */
function personsByUid(members: TeamMember[] | null | undefined): Map<string, PersonRecord> {
  const out = new Map<string, PersonRecord>();
  for (const p of groupMembersByPerson(members)) if (p.userId) out.set(p.userId, p);
  return out;
}

export function allocateLabor(input: LaborAllocationInput): LaborAllocation {
  const settings = resolveFinanceSettings(input.settings);
  const { start, end } = input.period;
  const months = fractionalMonthsBetween(start, end);
  const payroll = proratePlanPayroll(payrollBetween(input.members, input.expenses, start, end), start, end);
  // One record per PERSON — a member on two teams has two rows, and a
  // last-row-wins map costed their hours at 0 when the salary sat on the other.
  // The rate is resolved PER MONTH over all their rows (salaryHistory.ts).
  const memberByUid = personsByUid(input.members);

  const byProject = new Map<string, ProjectLabor>();
  const byMember = new Map<string, MemberLabor>();
  const internal = { hours: 0, cost: 0 };
  let absorbed = 0, totalHours = 0, considered = 0, withoutMember = 0;
  const noRate = new Set<string>();
  const rateCache = new Map<string, { rate: number; basis: CostRateBasis }>();
  const rateFor = (p: PersonRecord, atMs: number) => {
    const key = `${p.userId}|${new Date(atMs).getFullYear()}-${new Date(atMs).getMonth()}`;
    let r = rateCache.get(key);
    if (!r) {
      const cr = personCostRate(p, monthEndOf(atMs), settings, input.rateCard);
      r = { rate: cr.rate, basis: cr.basis };
      rateCache.set(key, r);
    }
    return r;
  };
  const memberRow = (p: PersonRecord): MemberLabor => {
    let row = byMember.get(p.userId);
    if (!row) {
      const m = p.profile;
      const lastRate = rateFor(p, end.getTime());
      row = {
        userId: p.userId, name: m.displayName || m.email || 'Pa emër', role: memberCostRole(m),
        clientHours: 0, internalHours: 0, totalHours: 0,
        // Only the months they were employed — not the whole period.
        capacityHours: memberCapacityHours(m, settings, input.rateCard) * memberEmployedMonthsBetween(p, start, end),
        utilizationPct: null, clientCost: 0, totalCost: 0, rate: lastRate.rate, rateBasis: lastRate.basis,
      };
      byMember.set(p.userId, row);
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
    if (member && r.basis === 'none') noRate.add(member.profile.displayName || member.profile.email || member.userId);
    const cost = h * r.rate;
    const role = e.costRole || memberCostRole(member?.profile);
    const isClient = !!e.projectId && (!input.clientProjectIds || input.clientProjectIds.has(e.projectId));

    if (e.projectId) {
      let pl = byProject.get(e.projectId);
      if (!pl) { pl = { projectId: e.projectId, hours: 0, cost: 0, byMember: [], byRole: {} }; byProject.set(e.projectId, pl); }
      pl.hours += h; pl.cost += cost;
      const uid = e.userId || '?';
      let line = pl.byMember.find(l => l.userId === uid);
      if (!line) { line = { userId: uid, name: member ? (member.profile.displayName || member.profile.email || 'Pa emër') : 'I panjohur', role, hours: 0, cost: 0 }; pl.byMember.push(line); }
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
  const loadedPayroll = payroll.total * (1 + Math.max(0, settings.employerCostPct || 0));
  const overAbsorbedVsLoaded = Math.max(0, covered - loadedPayroll);

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
    loadedPayroll,
    overAbsorbedVsLoaded,
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

export interface LaborOutsideRows {
  /** Cost of entries with no project at all (`alloc.internal.cost`). */
  internal: number;
  /** Cost of hours on projects the caller has NO row for (archived, out of period, unknown id). */
  absentProjects: number;
  absentHours: number;
  absentProjectIds: string[];
  /** internal + absentProjects — what the caller adds to its overhead pool next to `unabsorbed`. */
  total: number;
}

/**
 * Labour cost no row in `rowProjectIds` can carry. It is real cost of the
 * period and belongs in the shared overhead pool — a consumer that pools only
 * `unabsorbed` drops it (it used to: hours logged with no project, or on a
 * project outside the period, were in nobody's cost and nobody's overhead).
 */
export function laborOutsideRows(alloc: LaborAllocation, rowProjectIds: ReadonlySet<string>): LaborOutsideRows {
  let absentProjects = 0, absentHours = 0;
  const absentProjectIds: string[] = [];
  for (const pl of alloc.byProject.values()) {
    if (rowProjectIds.has(pl.projectId)) continue;
    absentProjects += pl.cost; absentHours += pl.hours; absentProjectIds.push(pl.projectId);
  }
  const internal = alloc.internal.cost;
  return { internal, absentProjects, absentHours, absentProjectIds, total: internal + absentProjects };
}

/**
 * The labour share of a consumer's overhead pool: the unabsorbed payroll (≥ 0)
 * + every hour no row carries. Never negative. Exactly:
 *     Σ rows' labour + poolLabor  ==  payroll + loadCreditOf(alloc)
 */
export function poolLabor(alloc: LaborAllocation, rowProjectIds: ReadonlySet<string>): number {
  return alloc.unabsorbed + laborOutsideRows(alloc, rowProjectIds).total;
}

/**
 * Labour charged to rows ABOVE the unloaded payroll (= `overAbsorbed`, ≥ 0) —
 * mostly the employer contributions the loaded rate carries. Every consumer
 * reports it as its own line so its identity is exact:
 *     Σ row profit − unallocated overhead + loadCredit == operating profit
 */
export function loadCreditOf(alloc: Pick<LaborAllocation, 'overAbsorbed'> | null | undefined): number {
  return alloc ? Math.max(0, alloc.overAbsorbed || 0) : 0;
}

/** projectId → labour, over ALL entries (no period, no payroll reconciliation). Entries with no project key on `''`. */
export function laborByProjectForEntries(
  entries: TimeEntry[] | null | undefined,
  members: TeamMember[] | null | undefined,
  rawSettings?: Partial<FinanceSettings> | null,
  rateCard?: RateCardRole[] | null,
  /** Only entries booked at or before this instant (a period end) count. */
  asOf?: Date | null,
): Map<string, ProjectLabor> {
  const settings = resolveFinanceSettings(rawSettings);
  const memberByUid = personsByUid(members);
  const out = new Map<string, ProjectLabor>();
  const rateCache = new Map<string, number>();
  const asOfMs = asOf ? asOf.getTime() : null;
  for (const e of entries || []) {
    if (entryIsOpen(e)) continue;
    const h = entryHours(e);
    if (h <= 0) continue;
    const at = entryInstantMs(e) ?? Date.now();
    if (asOfMs != null && at > asOfMs) continue;
    const member = memberByUid.get(e.userId);
    const key = `${e.userId}|${new Date(at).getFullYear()}-${new Date(at).getMonth()}`;
    let rate = rateCache.get(key);
    if (rate == null) {
      rate = member ? personCostRate(member, monthEndOf(at), settings, rateCard).rate : 0;
      rateCache.set(key, rate);
    }
    const cost = h * rate;
    const role = e.costRole || memberCostRole(member?.profile);
    const pid = e.projectId || '';
    let pl = out.get(pid);
    if (!pl) { pl = { projectId: pid, hours: 0, cost: 0, byMember: [], byRole: {} }; out.set(pid, pl); }
    pl.hours += h; pl.cost += cost;
    const br = pl.byRole[role] || { hours: 0, cost: 0 };
    br.hours += h; br.cost += cost; pl.byRole[role] = br;
    let line = pl.byMember.find(l => l.userId === e.userId);
    if (!line) { line = { userId: e.userId, name: member ? (member.profile.displayName || member.profile.email || 'Pa emër') : 'I panjohur', role, hours: 0, cost: 0 }; pl.byMember.push(line); }
    line.hours += h; line.cost += cost;
  }
  for (const pl of out.values()) pl.byMember.sort((a, b) => b.cost - a.cost);
  return out;
}

/**
 * Labour of ONE project over its whole life (for plan vs actual and EAC, which
 * compare against a plan made for the entire engagement, not for a month).
 * Same rates as `allocateLabor`, no payroll reconciliation. Without a
 * `projectId` every entry is summed into one line.
 */
export function laborForEntries(
  entries: TimeEntry[] | null | undefined,
  members: TeamMember[] | null | undefined,
  rawSettings?: Partial<FinanceSettings> | null,
  rateCard?: RateCardRole[] | null,
  projectId?: string,
  asOf?: Date | null,
): ProjectLabor {
  const scoped = projectId ? (entries || []).filter(e => e.projectId === projectId) : entries;
  const byProject = laborByProjectForEntries(scoped, members, rawSettings, rateCard, asOf);
  const out: ProjectLabor = { projectId: projectId || '', hours: 0, cost: 0, byMember: [], byRole: {} };
  for (const pl of byProject.values()) {
    out.hours += pl.hours; out.cost += pl.cost;
    for (const [role, v] of Object.entries(pl.byRole)) {
      const br = out.byRole[role] || { hours: 0, cost: 0 };
      br.hours += v.hours; br.cost += v.cost; out.byRole[role] = br;
    }
    for (const l of pl.byMember) {
      let line = out.byMember.find(x => x.userId === l.userId);
      if (!line) { line = { ...l, hours: 0, cost: 0 }; out.byMember.push(line); }
      line.hours += l.hours; line.cost += l.cost;
    }
  }
  out.byMember.sort((a, b) => b.cost - a.cost);
  return out;
}
