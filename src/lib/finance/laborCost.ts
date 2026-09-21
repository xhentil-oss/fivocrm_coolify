import type { TeamMember, TimeEntry } from '../../types';
import { getTimestampMs } from '../utils';
import { costRateFor, resolveFinanceSettings, type FinanceSettings } from './profitabilityCore';

/**
 * Internal labor cost per hour for a member (ALL).
 *
 * Explicit `hourlyCostRate` wins; otherwise the LOADED monthly cost (salary ×
 * (1 + employer contributions)) over the member's PRACTICAL client capacity
 * (`clientCapacityHours`, else the tenant default of 120 h — not 160/176: meetings,
 * admin, leave and internal work are not client hours). Rule and defaults live in
 * profitabilityCore.ts, which the cron `project-spend-rollup` (api/cron/run.ts)
 * imports as its byte-identical mirror — so the two can no longer drift.
 *
 * `settings` = `teamSettings.financeSettings`; omitted = the defaults.
 */
export function memberHourlyCost(
  m?: Pick<TeamMember, 'hourlyCostRate' | 'monthlySalary' | 'clientCapacityHours'> | null,
  settings?: Partial<FinanceSettings> | null,
): number {
  if (!m) return 0;
  return costRateFor({
    monthlySalary: m.monthlySalary || 0,
    hourlyCostRateOverride: m.hourlyCostRate,
    capacityHours: m.clientCapacityHours,
    settings: resolveFinanceSettings(settings),
  }).rate;
}

/** Billing rate per hour for a member (ALL); falls back to cost rate. */
export function memberBillRate(
  m?: Pick<TeamMember, 'hourlyBillRate' | 'hourlyCostRate' | 'monthlySalary' | 'clientCapacityHours'> | null,
  settings?: Partial<FinanceSettings> | null,
): number {
  if (m?.hourlyBillRate && m.hourlyBillRate > 0) return m.hourlyBillRate;
  return memberHourlyCost(m, settings);
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
  settings?: Partial<FinanceSettings> | null,
): ProjectLabor {
  let hours = 0, billableHours = 0, cost = 0, billableValue = 0;
  for (const e of entries) {
    const h = entryHours(e);
    if (h <= 0) continue;
    const member = membersByUserId.get(e.userId);
    const costRate = memberHourlyCost(member, settings);
    hours += h;
    cost += h * costRate;
    if (e.isBillable) {
      billableHours += h;
      const rate = (e.hourlyRate && e.hourlyRate > 0) ? e.hourlyRate : memberBillRate(member, settings);
      billableValue += h * rate;
    }
  }
  return { hours, billableHours, cost, billableValue };
}
