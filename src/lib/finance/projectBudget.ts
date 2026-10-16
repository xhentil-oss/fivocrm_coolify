/**
 * A project is BUDGETED before it is sold, then watched against that budget:
 * hours per role × cost rate + direct costs → the price at the target margin;
 * during delivery, plan vs actual per role, the estimate at completion and the
 * 70 / 85 / 100 % alarms. Pure; the math is in profitabilityCore.ts.
 */
import type { Project, ProjectPlannedRole } from '../../types';
import { toAll } from '../utils';
import type { ProjectLabor } from './laborAllocation';
import { billingTypeOf, monthlyFeeOf } from './projectPeriod';
import {
  budgetAlertLevel,
  estimateAtCompletion,
  marginStatus,
  nextBudgetAlert,
  pct,
  suggestedPrice,
  type BudgetAlertLevel,
  type EacResult,
  type FinanceSettings,
  type MarginStatus,
} from './profitabilityCore';

/** Clean user input into a valid plan: positive hours, non-negative rates, trimmed roles. */
export function normalizePlannedRoles(raw: unknown): ProjectPlannedRole[] {
  if (!Array.isArray(raw)) return [];
  const out: ProjectPlannedRole[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const role = String((r as any).role || '').trim();
    const plannedHours = Number((r as any).plannedHours);
    if (!role || !(plannedHours > 0)) continue;
    const costRate = Math.max(0, Number((r as any).costRate) || 0);
    const sellRate = Number((r as any).sellRate);
    const userId = String((r as any).userId || '').trim() || undefined;
    out.push({ role, plannedHours, costRate, ...(sellRate > 0 ? { sellRate } : {}), ...(userId ? { userId } : {}) });
  }
  return out;
}

export interface PlanSummary {
  hours: number;
  laborCost: number;
  /** Σ hours × sellRate where a sell rate exists. */
  sellValue: number;
}

export function plannedRolesSummary(roles: ProjectPlannedRole[] | null | undefined): PlanSummary {
  let hours = 0, laborCost = 0, sellValue = 0;
  for (const r of roles || []) {
    hours += r.plannedHours || 0;
    laborCost += (r.plannedHours || 0) * (r.costRate || 0);
    if (r.sellRate && r.sellRate > 0) sellValue += (r.plannedHours || 0) * r.sellRate;
  }
  return { hours, laborCost, sellValue };
}

/** The fields the form denormalises onto the project from its planned roles. */
export function plannedFieldsPatch(roles: ProjectPlannedRole[], plannedDirectExpenses: number | undefined) {
  const s = plannedRolesSummary(roles);
  return {
    plannedRoles: roles.length ? roles : [],
    plannedHours: s.hours,
    plannedLaborCost: s.laborCost,
    plannedDirectExpenses: plannedDirectExpenses && plannedDirectExpenses > 0 ? plannedDirectExpenses : 0,
  };
}

export interface PlannedEconomics {
  plannedHours: number;
  plannedLaborCost: number;
  plannedDirectExpenses: number;
  plannedDirectCost: number;
  /** Contract value in ALL. */
  contractValue: number;
  plannedGrossProfit: number;
  plannedMarginPct: number | null;
  plannedMarginStatus: MarginStatus;
  /** Price at the target margin (0 when no target or no cost). */
  suggestedPrice: number;
}

/**
 * What the plan says the deal is worth — before anyone logs an hour.
 *
 * `contractValue` is the one-time contract, or — for a RETAINER — the fee per
 * MONTH (`monthlyFeeOf`: `budget` is the fee per billing cycle, so a weekly
 * retainer earns budget × 52/12 a month). Taking the raw weekly `budget` made a
 * weekly retainer's planned margin look ~4× worse than the engines' figure.
 */
export function plannedEconomics(p: Pick<Project, 'budget' | 'currency' | 'plannedRoles' | 'plannedHours' | 'plannedLaborCost' | 'plannedDirectExpenses' | 'targetMarginPct'> & Partial<Pick<Project, 'billingType' | 'isRecurring' | 'recurringFrequency'>>, settings: FinanceSettings): PlannedEconomics {
  const s = plannedRolesSummary(p.plannedRoles);
  const plannedHours = p.plannedHours && p.plannedHours > 0 ? p.plannedHours : s.hours;
  const plannedLaborCost = p.plannedLaborCost && p.plannedLaborCost > 0 ? p.plannedLaborCost : s.laborCost;
  const plannedDirectExpenses = Math.max(0, p.plannedDirectExpenses || 0);
  const plannedDirectCost = plannedLaborCost + plannedDirectExpenses;
  const fee = billingTypeOf(p as Project) === 'monthly' ? monthlyFeeOf(p) : (Number(p.budget) || 0);
  const contractValue = toAll(fee, p.currency);
  const plannedGrossProfit = contractValue - plannedDirectCost;
  const plannedMarginPct = pct(plannedGrossProfit, contractValue);
  return {
    plannedHours, plannedLaborCost, plannedDirectExpenses, plannedDirectCost, contractValue,
    plannedGrossProfit, plannedMarginPct,
    plannedMarginStatus: marginStatus(plannedMarginPct, settings.marginThresholds),
    suggestedPrice: p.targetMarginPct ? suggestedPrice(plannedDirectCost, p.targetMarginPct) : 0,
  };
}

export interface RoleVariance {
  role: string;
  plannedHours: number;
  actualHours: number;
  plannedCost: number;
  actualCost: number;
  /** Actual hours as % of planned (null when nothing was planned for the role). */
  consumedPct: number | null;
  over: boolean;
}

export interface PlanVsActual {
  roles: RoleVariance[];
  plannedHours: number;
  actualHours: number;
  plannedCost: number;
  actualCost: number;
  consumedPct: number | null;
  level: BudgetAlertLevel;
  overrunRoles: string[];
}

/** Plan vs actual per role — the table that says "the problem was Design + PM, not the price". */
export function planVsActual(p: Project, labor: ProjectLabor | null | undefined, settings: FinanceSettings): PlanVsActual {
  const planByRole = new Map<string, { hours: number; cost: number }>();
  for (const r of p.plannedRoles || []) {
    const cur = planByRole.get(r.role) || { hours: 0, cost: 0 };
    cur.hours += r.plannedHours || 0; cur.cost += (r.plannedHours || 0) * (r.costRate || 0);
    planByRole.set(r.role, cur);
  }
  const roles = new Set<string>([...planByRole.keys(), ...Object.keys(labor?.byRole || {})]);
  const rows: RoleVariance[] = [];
  for (const role of roles) {
    const plan = planByRole.get(role) || { hours: 0, cost: 0 };
    const act = labor?.byRole[role] || { hours: 0, cost: 0 };
    const consumedPct = plan.hours > 0 ? (act.hours / plan.hours) * 100 : null;
    rows.push({
      role, plannedHours: plan.hours, actualHours: act.hours, plannedCost: plan.cost, actualCost: act.cost,
      consumedPct, over: plan.hours > 0 ? act.hours > plan.hours : act.hours > 0,
    });
  }
  rows.sort((a, b) => (b.actualCost - b.plannedCost) - (a.actualCost - a.plannedCost));
  const plannedHours = rows.reduce((s, r) => s + r.plannedHours, 0);
  const actualHours = rows.reduce((s, r) => s + r.actualHours, 0);
  const plannedCost = rows.reduce((s, r) => s + r.plannedCost, 0);
  const actualCost = rows.reduce((s, r) => s + r.actualCost, 0);
  const consumedPct = plannedCost > 0 ? (actualCost / plannedCost) * 100 : (plannedHours > 0 ? (actualHours / plannedHours) * 100 : null);
  return {
    roles: rows, plannedHours, actualHours, plannedCost, actualCost, consumedPct,
    level: budgetAlertLevel(consumedPct, settings.budgetAlertThresholds),
    overrunRoles: rows.filter(r => r.over && r.plannedHours > 0).map(r => r.role),
  };
}

/** EAC for a project given the labour logged so far (all-time, not a period slice). */
export function projectEac(p: Project, laborToDate: { hours: number; cost: number }, directExpensesToDate: number, settings: FinanceSettings): EacResult {
  const plan = plannedEconomics(p, settings);
  const avgCostRate = laborToDate.hours > 0
    ? laborToDate.cost / laborToDate.hours
    : (plan.plannedHours > 0 ? plan.plannedLaborCost / plan.plannedHours : 0);
  return estimateAtCompletion({
    contractValue: plan.contractValue,
    costToDate: laborToDate.cost + directExpensesToDate,
    hoursToDate: laborToDate.hours,
    plannedHours: plan.plannedHours,
    plannedCost: plan.plannedDirectCost,
    remainingHoursEstimate: typeof p.remainingHoursEstimate === 'number' ? p.remainingHoursEstimate : null,
    avgCostRate,
  });
}

/** The alert the cron should send now, if any. */
export function pendingBudgetAlert(p: Project, consumedPct: number | null, settings: FinanceSettings): number | null {
  return nextBudgetAlert(consumedPct, settings.budgetAlertThresholds, p.budgetAlertsSent || []);
}
