/**
 * What one hour of a person costs — the typed wrapper around profitabilityCore.
 *
 *   cost rate = loaded monthly cost / practical client capacity
 *   loaded monthly cost = salary in effect that month (salaryHistory.ts) × (1 + employer contributions)
 *
 * `hourlyCostRate` on the member stays an explicit OVERRIDE. Capacity comes from
 * the member, else the rate card for their role, else the tenant default (120 h).
 * Salary is read through `memberSalaryForMonth`, so a closed month is costed at
 * the salary — and therefore the rate — that applied then.
 */
import type { TeamMember } from '../../types';
import {
  groupMembersByPerson,
  personHourlyCostOverride,
  personIsActive,
  personOf,
  personSalaryForMonth,
  personSalaryRowForMonth,
  type PersonRecord,
} from './salaryHistory';
import {
  costRateFor,
  resolveFinanceSettings,
  type CostRate,
  type FinanceSettings,
} from './profitabilityCore';

export type { CostRate, FinanceSettings };

export interface RateCardRole {
  role: string;
  defaultCapacityHours?: number;
  /** Selling rate per hour (ALL), for quoting. Internal. */
  sellRate?: number;
}

export const UNASSIGNED_ROLE = 'Pa rol';

/** The rate-card role a member's hours are costed under. */
export function memberCostRole(m: Pick<TeamMember, 'costRole' | 'position' | 'role'> | null | undefined): string {
  if (!m) return UNASSIGNED_ROLE;
  const explicit = (m.costRole || '').trim();
  if (explicit) return explicit;
  const pos = (m.position || '').trim();
  if (pos) return pos;
  return UNASSIGNED_ROLE;
}

export function memberCapacityHours(
  m: Pick<TeamMember, 'clientCapacityHours' | 'costRole' | 'position' | 'role'> | null | undefined,
  settings: FinanceSettings,
  rateCard?: RateCardRole[] | null,
): number {
  if (m?.clientCapacityHours && m.clientCapacityHours > 0) return m.clientCapacityHours;
  const role = memberCostRole(m);
  const card = (rateCard || []).find(r => r.role.trim().toLowerCase() === role.toLowerCase());
  if (card?.defaultCapacityHours && card.defaultCapacityHours > 0) return card.defaultCapacityHours;
  return settings.defaultClientCapacityHours;
}

/** Cost per hour for ONE member row in the month ending at `monthEnd`. */
export function memberCostRate(
  member: TeamMember,
  monthEnd: Date,
  settings: FinanceSettings,
  rateCard?: RateCardRole[] | null,
): CostRate {
  return personCostRate(personOf(member), monthEnd, settings, rateCard);
}

/**
 * Cost per hour for a PERSON (all their rows) in the month ending at `monthEnd`:
 * that month's salary (the highest of their rows that month — salaryHistory.ts),
 * an explicit override from any row (an active row first), and the capacity of
 * the row that pays the salary that month (the profile otherwise). The rate in
 * month M is therefore always built from month M's salary.
 */
export function personCostRate(
  person: PersonRecord,
  monthEnd: Date,
  settings: FinanceSettings,
  rateCard?: RateCardRole[] | null,
): CostRate {
  const payer = personSalaryRowForMonth(person, monthEnd);
  const capacityFrom = payer && payer.clientCapacityHours && payer.clientCapacityHours > 0 ? payer : person.profile;
  return costRateFor({
    monthlySalary: personSalaryForMonth(person, monthEnd),
    hourlyCostRateOverride: personHourlyCostOverride(person),
    capacityHours: memberCapacityHours(capacityFrom, settings, rateCard),
    settings,
  });
}

export interface RateCardMember {
  userId: string;
  name: string;
  rate: number;
  basis: CostRate['basis'];
  capacityHours: number;
  loadedMonthlyCost: number;
}

export interface RateCardRow {
  role: string;
  headcount: number;
  /** Σ loaded monthly cost of the role's members (ALL). */
  monthlyCost: number;
  /** Σ practical capacity (h/month). */
  capacityHours: number;
  /** Role average: monthlyCost / capacityHours (weighted), or the mean of overrides. */
  costRate: number;
  sellRate?: number;
  /** Suggested margin per hour when a sell rate exists: (sell − cost) / sell. */
  hourMarginPct: number | null;
  members: RateCardMember[];
  /** Members with no salary and no override — their hours cost 0 and are flagged. */
  withoutRate: number;
}

/**
 * The internal rate card — one row per role, priced for the month ending at
 * `monthEnd`. Only members on payroll (`Active`, or an Inactive leaver still
 * priced by history) with a rate appear in the cost figures; those without one
 * are counted in `withoutRate` so the gap is visible, not silent.
 */
export function buildRateCard(
  members: TeamMember[] | null | undefined,
  rawSettings: Partial<FinanceSettings> | null | undefined,
  monthEnd: Date,
  rateCard?: RateCardRole[] | null,
): RateCardRow[] {
  const settings = resolveFinanceSettings(rawSettings);
  const rows = new Map<string, RateCardRow>();
  const cardByRole = new Map((rateCard || []).map(r => [r.role.trim().toLowerCase(), r]));
  // One row per PERSON — a member on two teams would otherwise be two heads.
  for (const person of groupMembersByPerson(members)) {
    const m = person.profile;
    if (!person.userId) continue;
    if (!person.rows.some(r => r.status === 'Active' || r.status === 'Inactive')) continue;
    const rate = personCostRate(person, monthEnd, settings, rateCard);
    if (!personIsActive(person) && rate.basis !== 'override' && rate.rate === 0) continue; // a leaver already off payroll
    const role = memberCostRole(m);
    const row = rows.get(role) || {
      role, headcount: 0, monthlyCost: 0, capacityHours: 0, costRate: 0,
      sellRate: cardByRole.get(role.toLowerCase())?.sellRate, hourMarginPct: null, members: [], withoutRate: 0,
    };
    row.headcount += 1;
    const loaded = rate.basis === 'derived' ? rate.loadedMonthlyCost : rate.rate * rate.capacityHours;
    if (rate.basis === 'none') row.withoutRate += 1;
    else { row.monthlyCost += loaded; row.capacityHours += rate.capacityHours; }
    row.members.push({
      userId: person.userId, name: m.displayName || m.email || 'Pa emër',
      rate: rate.rate, basis: rate.basis, capacityHours: rate.capacityHours, loadedMonthlyCost: loaded,
    });
    rows.set(role, row);
  }
  for (const row of rows.values()) {
    row.costRate = row.capacityHours > 0 ? row.monthlyCost / row.capacityHours : 0;
    row.hourMarginPct = row.sellRate && row.sellRate > 0 && row.costRate > 0
      ? ((row.sellRate - row.costRate) / row.sellRate) * 100
      : null;
    row.members.sort((a, b) => b.rate - a.rate);
  }
  // Roles that exist only on the rate card (no member yet) still show, so a
  // project can be budgeted with a freelance role before anyone is hired.
  for (const card of rateCard || []) {
    const key = card.role.trim();
    if (!key || rows.has(key)) continue;
    rows.set(key, {
      role: key, headcount: 0, monthlyCost: 0, capacityHours: 0, costRate: 0,
      sellRate: card.sellRate, hourMarginPct: null, members: [], withoutRate: 0,
    });
  }
  return Array.from(rows.values()).sort((a, b) => b.monthlyCost - a.monthlyCost || a.role.localeCompare(b.role));
}

/** Default cost rate for a role when planning a project: the rate card's average, else 0. */
export function roleCostRate(rows: RateCardRow[], role: string): number {
  const r = rows.find(x => x.role.toLowerCase() === role.trim().toLowerCase());
  return r ? r.costRate : 0;
}
