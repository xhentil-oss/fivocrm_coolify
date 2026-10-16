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
 *
 * CURRENT RATE ONLY: it reads ONE row's current `monthlySalary`, with no salary
 * history and no per-month payer row. Its only consumer is `memberBillRate`'s
 * fallback, used by ProjectDetailView for the display-only "billable value"
 * estimate. Any COST figure (P&L, client profitability, budgets, EAC) must go
 * through `personCostRate` (costRates.ts) per month via `allocateLabor` /
 * `laborForEntries` — never through this function.
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

/** Sources whose rows carry a typed `duration` only — no timer ever ran for them. */
export const DURATION_ONLY_SOURCES: ReadonlySet<string> = new Set(['manual', 'daily-report']);

/**
 * Duration of a time entry in hours — the same rule as `entryDurationMinutes`
 * (src/lib/timeTracking.ts): `endTime − startTime` is the source of truth.
 *
 *   · typed by hand (`source: 'manual' | 'daily-report'`) → `duration` is the
 *     figure the person entered; its start/end are synthesised FROM it
 *     (noon − minutes … noon), so there is no independent span to check.
 *   · otherwise (timer, pomodoro, legacy rows with no source), start AND end →
 *     the span. A stored `duration` may only SHORTEN it (a paused timer), never
 *     stretch it: a stale `duration` written against the wrong `startTime`
 *     (overlapping timers) once costed 11:17→13:11 as 49.9 h.
 *   · no `endTime` → a running timer, 0 — even when a `duration` was written.
 *
 * Mirrored by `timeEntryHoursServer` in api/cron/run.ts — keep the two in sync.
 */
export function entryHours(e: Pick<TimeEntry, 'duration' | 'startTime' | 'endTime' | 'source'>): number {
  const durH = typeof e.duration === 'number' && e.duration > 0 ? e.duration / 60 : 0;
  if (DURATION_ONLY_SOURCES.has(String(e.source || '')) && durH > 0) return durH;
  const s = e.startTime ? getTimestampMs(e.startTime) : 0;
  const en = e.endTime ? getTimestampMs(e.endTime) : 0;
  if (s && en) {
    if (en <= s) return 0;
    const spanH = (en - s) / 3_600_000;
    return durH > 0 ? Math.min(durH, spanH) : spanH;
  }
  if (!e.endTime) return 0;
  // An end with no start: only the typed duration can say anything.
  return durH;
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
