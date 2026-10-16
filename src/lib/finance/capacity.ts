/**
 * Team capacity — who has room, who is overloaded, per person and per role.
 *   utilisation = client hours / practical capacity
 * Built from the same labour allocation the P&L uses, so "77 % utilised" and
 * "cost 1 000 L/h" describe the same hours.
 */
import type { TeamMember } from '../../types';
import { memberEmployedMonthsBetween, type LaborAllocation } from './laborAllocation';
import { memberCapacityHours, memberCostRole, type RateCardRole } from './costRates';
import { memberOnPayrollBetween } from './projectPeriod';
import { groupMembersByPerson } from './salaryHistory';
import { utilizationStatus, type UtilizationStatus } from './profitabilityCore';

export interface CapacityRow {
  key: string;
  name: string;
  role: string;
  headcount: number;
  capacityHours: number;
  clientHours: number;
  internalHours: number;
  /** Capacity not covered by logged hours (client or internal). */
  idleHours: number;
  utilizationPct: number | null;
  status: UtilizationStatus;
  clientCost: number;
  members?: CapacityRow[];
}

export interface CapacityResult {
  members: CapacityRow[];
  roles: CapacityRow[];
  totals: { capacityHours: number; clientHours: number; internalHours: number; idleHours: number; utilizationPct: number | null };
}

export function computeCapacity(
  labor: LaborAllocation,
  members: TeamMember[] | null | undefined,
  rateCard?: RateCardRole[] | null,
): CapacityResult {
  const s = labor.settings;
  const { start, end } = labor.period;
  const rows: CapacityRow[] = [];
  // One row per PERSON (a member on two teams has two rows — that counted 240 h
  // for one person), and capacity only over the months they were employed: a
  // November hire is not idle capacity in September.
  for (const person of groupMembersByPerson(members)) {
    if (!person.userId) continue;
    const m = person.profile;
    const l = labor.byMember.get(person.userId);
    // Employment is resolved over ALL the person's rows (salaryHistory.ts): an old
    // Inactive row next to their current team's row neither hides nor doubles them.
    const employedMonths = memberEmployedMonthsBetween(person, start, end);
    if (!person.rows.some(r => memberOnPayrollBetween(r, start, end))) continue;
    if (employedMonths <= 0 && !l) continue;
    const capacity = memberCapacityHours(m, s, rateCard) * employedMonths;
    const clientHours = l?.clientHours || 0;
    const internalHours = l?.internalHours || 0;
    const utilizationPct = capacity > 0 ? (clientHours / capacity) * 100 : null;
    rows.push({
      key: person.userId, name: m.displayName || m.email || 'Pa emër', role: memberCostRole(m), headcount: 1,
      capacityHours: capacity, clientHours, internalHours,
      idleHours: Math.max(0, capacity - clientHours - internalHours),
      utilizationPct, status: utilizationStatus(utilizationPct, s.utilizationBands),
      clientCost: l?.clientCost || 0,
    });
  }
  const byRole = new Map<string, CapacityRow>();
  for (const r of rows) {
    const g = byRole.get(r.role) || {
      key: r.role, name: r.role, role: r.role, headcount: 0, capacityHours: 0, clientHours: 0, internalHours: 0,
      idleHours: 0, utilizationPct: null, status: 'none' as UtilizationStatus, clientCost: 0, members: [],
    };
    g.headcount += 1; g.capacityHours += r.capacityHours; g.clientHours += r.clientHours;
    g.internalHours += r.internalHours; g.idleHours += r.idleHours; g.clientCost += r.clientCost;
    g.members!.push(r);
    byRole.set(r.role, g);
  }
  const roles = Array.from(byRole.values()).map(g => {
    const u = g.capacityHours > 0 ? (g.clientHours / g.capacityHours) * 100 : null;
    return { ...g, utilizationPct: u, status: utilizationStatus(u, s.utilizationBands), members: g.members!.sort((a, b) => (b.utilizationPct || 0) - (a.utilizationPct || 0)) };
  }).sort((a, b) => b.capacityHours - a.capacityHours);
  const cap = rows.reduce((x, r) => x + r.capacityHours, 0);
  const cl = rows.reduce((x, r) => x + r.clientHours, 0);
  const inH = rows.reduce((x, r) => x + r.internalHours, 0);
  return {
    members: rows.sort((a, b) => (b.utilizationPct || 0) - (a.utilizationPct || 0)),
    roles,
    totals: { capacityHours: cap, clientHours: cl, internalHours: inH, idleHours: Math.max(0, cap - cl - inH), utilizationPct: cap > 0 ? (cl / cap) * 100 : null },
  };
}
