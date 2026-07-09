import type { TeamMember, TimeEntry } from '../../types';
import { getTimestampMs } from '../utils';

// Assumed billable hours in a month when deriving an hourly cost from salary.
const DEFAULT_MONTHLY_HOURS = 160;

/**
 * Internal labor cost per hour for a member (ALL). Explicit `hourlyCostRate`
 * wins; otherwise derived from `monthlySalary / 160`; else 0.
 *
 * NOTE: the cron `project-spend-rollup` (api/cron/run.ts) mirrors this formula —
 * keep the two in sync.
 */
export function memberHourlyCost(m?: Pick<TeamMember, 'hourlyCostRate' | 'monthlySalary'> | null): number {
  if (!m) return 0;
  if (m.hourlyCostRate && m.hourlyCostRate > 0) return m.hourlyCostRate;
  if (m.monthlySalary && m.monthlySalary > 0) return m.monthlySalary / DEFAULT_MONTHLY_HOURS;
  return 0;
}

/** Billing rate per hour for a member (ALL); falls back to cost rate. */
export function memberBillRate(m?: Pick<TeamMember, 'hourlyBillRate' | 'hourlyCostRate' | 'monthlySalary'> | null): number {
  if (m?.hourlyBillRate && m.hourlyBillRate > 0) return m.hourlyBillRate;
  return memberHourlyCost(m);
}

/** Duration of a time entry in hours. Prefers stored `duration` (minutes),
 *  falls back to start/end delta. Ignores running (open) entries. */
export function entryHours(e: Pick<TimeEntry, 'duration' | 'startTime' | 'endTime'>): number {
  if (typeof e.duration === 'number' && e.duration > 0) return e.duration / 60;
  if (e.startTime && e.endTime) {
    const s = getTimestampMs(e.startTime);
    const en = getTimestampMs(e.endTime);
    if (en > s) return (en - s) / 3_600_000;
  }
  return 0;
}

export interface ProjectLabor {
  hours: number;          // total logged hours
  billableHours: number;  // hours flagged billable
  cost: number;           // Σ hours × member cost-rate (ALL)
  billableValue: number;  // Σ billable hours × member bill-rate (ALL)
}

/**
 * Roll up a set of time entries into labor cost/value using per-member rates.
 * `membersByUserId` maps userId → TeamMember.
 */
export function computeProjectLabor(
  entries: TimeEntry[],
  membersByUserId: Map<string, TeamMember>,
): ProjectLabor {
  let hours = 0, billableHours = 0, cost = 0, billableValue = 0;
  for (const e of entries) {
    const h = entryHours(e);
    if (h <= 0) continue;
    const member = membersByUserId.get(e.userId);
    const costRate = memberHourlyCost(member);
    hours += h;
    cost += h * costRate;
    if (e.isBillable) {
      billableHours += h;
      const rate = (e.hourlyRate && e.hourlyRate > 0) ? e.hourlyRate : memberBillRate(member);
      billableValue += h * rate;
    }
  }
  return { hours, billableHours, cost, billableValue };
}
