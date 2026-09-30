/**
 * Client & project profitability — the pure CORE (no Firestore, no React, no imports).
 *
 * Everything here works on plain numbers and millisecond timestamps, so the exact
 * same file can run in the browser (src/lib/finance/*) and in the cron
 * (api/_profitabilityCore.ts is a byte-identical copy — `profitabilityCore.test.ts`
 * fails the run on any difference). The typed wrappers around it are:
 *   costRates.ts           → what one hour of a person costs
 *   revenueRecognition.ts  → how much of a contract has been EARNED by a date
 *   projectBudget.ts       → plan vs actual, EAC, budget alarms
 *   clientProfitability.ts → the per-client table
 *
 * The model (decided with the owner, 2026-09-21):
 *   · direct labour = logged hours × internal cost rate, where the cost rate is the
 *     LOADED monthly cost (salary × (1 + employer contributions)) divided by the
 *     person's PRACTICAL client capacity (default 120 h, not 176 h — meetings,
 *     admin, leave and internal work are not client hours);
 *   · revenue is recognised when the work is done: a retainer earns its fee every
 *     month, a fixed-fee project earns contract × (hours to date / hours at
 *     completion) — percentage of completion by effort — never on invoice date;
 *   · gross profit first (revenue − labour − direct costs), overhead after it,
 *     allocated by labour hours, so the client that consumes the team carries it;
 *   · an overrun never inflates revenue — 400 h against 300 planned means the
 *     contract is still the contract and the cost is what grew.
 */

// ── Settings ────────────────────────────────────────────────────────────────

export type OverheadBasis = 'labor-hours' | 'revenue';

export interface FinanceSettings {
  /** Employer-side payroll contributions on top of the gross salary (0.167 = 16.7 %). */
  employerCostPct: number;
  /** Practical client-facing hours per person per month, when the member has none. */
  defaultClientCapacityHours: number;
  /** Expense categories passed through to the client (ad spend…): revenue and cost cancel. */
  passThroughExpenseCategories: string[];
  /** Gross-margin thresholds, in percent: ≥ healthy 🟢, ≥ watch 🟡, below 🔴. */
  marginThresholds: { healthy: number; watch: number };
  overheadBasis: OverheadBasis;
  /** Budget-consumed percentages that raise an alarm once each (ascending). */
  budgetAlertThresholds: number[];
  /** Utilisation bands, in percent: below `low` = idle capacity, above `high` = overloaded. */
  utilizationBands: { low: number; high: number };
}

export const DEFAULT_FINANCE_SETTINGS: FinanceSettings = {
  employerCostPct: 0.167,
  defaultClientCapacityHours: 120,
  passThroughExpenseCategories: [],
  marginThresholds: { healthy: 55, watch: 40 },
  overheadBasis: 'labor-hours',
  budgetAlertThresholds: [70, 85, 100],
  utilizationBands: { low: 60, high: 85 },
};

const num = (v: unknown, fallback: number, min: number, max: number): number => {
  const n = typeof v === 'string' ? parseFloat(v) : (v as number);
  // Out of range = a typo, not a preference: fall back rather than clamp, so a
  // capacity of -3 h never becomes 1 h and a 500 % payroll load never becomes 100 %.
  if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max) return fallback;
  return n;
};

/** Validated settings — every field falls back to the default when missing or out of range. */
export function resolveFinanceSettings(raw?: Partial<FinanceSettings> | null): FinanceSettings {
  const d = DEFAULT_FINANCE_SETTINGS;
  const r = raw || {};
  const healthy = num(r.marginThresholds?.healthy, d.marginThresholds.healthy, 0, 100);
  const watch = Math.min(healthy, num(r.marginThresholds?.watch, d.marginThresholds.watch, 0, 100));
  const alerts = Array.isArray(r.budgetAlertThresholds)
    ? Array.from(new Set(r.budgetAlertThresholds.map(x => num(x, NaN, 1, 500)).filter(x => Number.isFinite(x)))).sort((a, b) => a - b)
    : d.budgetAlertThresholds;
  const low = num(r.utilizationBands?.low, d.utilizationBands.low, 0, 100);
  const high = Math.max(low, num(r.utilizationBands?.high, d.utilizationBands.high, 0, 200));
  return {
    employerCostPct: num(r.employerCostPct, d.employerCostPct, 0, 1),
    defaultClientCapacityHours: num(r.defaultClientCapacityHours, d.defaultClientCapacityHours, 1, 400),
    passThroughExpenseCategories: Array.isArray(r.passThroughExpenseCategories)
      ? r.passThroughExpenseCategories.filter((c): c is string => typeof c === 'string' && c.trim() !== '').map(c => c.trim())
      : d.passThroughExpenseCategories,
    marginThresholds: { healthy, watch },
    overheadBasis: r.overheadBasis === 'revenue' ? 'revenue' : 'labor-hours',
    budgetAlertThresholds: alerts.length ? alerts : d.budgetAlertThresholds,
    utilizationBands: { low, high },
  };
}

// ── Cost rates ──────────────────────────────────────────────────────────────

export type CostRateBasis = 'override' | 'derived' | 'none';

export interface CostRate {
  /** ALL per hour. */
  rate: number;
  basis: CostRateBasis;
  /** Loaded monthly cost that produced a derived rate (0 for override/none). */
  loadedMonthlyCost: number;
  capacityHours: number;
}

/** Salary × (1 + employer contributions). */
export function loadedMonthlyCost(monthlySalary: number, employerCostPct: number): number {
  if (!(monthlySalary > 0)) return 0;
  return monthlySalary * (1 + Math.max(0, employerCostPct || 0));
}

/**
 * The internal cost of one hour of a person's work.
 * An explicit override wins; otherwise loaded monthly cost / practical capacity.
 */
export function costRateFor(input: {
  monthlySalary: number;
  hourlyCostRateOverride?: number | null;
  capacityHours?: number | null;
  settings: FinanceSettings;
}): CostRate {
  const capacity = input.capacityHours && input.capacityHours > 0
    ? input.capacityHours
    : input.settings.defaultClientCapacityHours;
  if (input.hourlyCostRateOverride && input.hourlyCostRateOverride > 0) {
    return { rate: input.hourlyCostRateOverride, basis: 'override', loadedMonthlyCost: 0, capacityHours: capacity };
  }
  const loaded = loadedMonthlyCost(input.monthlySalary, input.settings.employerCostPct);
  if (loaded <= 0) return { rate: 0, basis: 'none', loadedMonthlyCost: 0, capacityHours: capacity };
  return { rate: loaded / capacity, basis: 'derived', loadedMonthlyCost: loaded, capacityHours: capacity };
}

// ── Pricing & margin ────────────────────────────────────────────────────────

/** Price = direct cost / (1 − target margin). 100 000 at 55 % → 222 222. */
export function suggestedPrice(directCost: number, targetMarginPct: number): number {
  const m = Math.min(0.95, Math.max(0, (targetMarginPct || 0) / 100));
  if (!(directCost > 0)) return 0;
  return directCost / (1 - m);
}

export type MarginStatus = 'healthy' | 'watch' | 'investigate' | 'none';

export function marginStatus(marginPct: number | null | undefined, thresholds: FinanceSettings['marginThresholds']): MarginStatus {
  if (marginPct == null || !Number.isFinite(marginPct)) return 'none';
  if (marginPct >= thresholds.healthy) return 'healthy';
  if (marginPct >= thresholds.watch) return 'watch';
  return 'investigate';
}

export function pct(part: number, whole: number): number | null {
  return whole > 0 ? (part / whole) * 100 : null;
}

/**
 * A client's economic class — margin × friction, never invoice size.
 *   A: high margin, low friction (keep & grow)     B: high margin, high friction (strategic; watch the hours)
 *   C: low margin, low friction (raise the price)  D: low margin, high friction (renegotiate or exit)
 * Friction = the client's revenue per hour is below the company median.
 */
export type ClientCategory = 'A' | 'B' | 'C' | 'D' | null;

export function classifyClient(
  grossMarginPct: number | null,
  effectiveHourlyRevenue: number | null,
  medianEffectiveHourlyRevenue: number | null,
  thresholds: FinanceSettings['marginThresholds'],
): ClientCategory {
  if (grossMarginPct == null) return null;
  const highMargin = grossMarginPct >= thresholds.watch;
  const highFriction = effectiveHourlyRevenue != null && medianEffectiveHourlyRevenue != null
    && medianEffectiveHourlyRevenue > 0 && effectiveHourlyRevenue < medianEffectiveHourlyRevenue;
  if (highMargin) return highFriction ? 'B' : 'A';
  return highFriction ? 'D' : 'C';
}

export function median(values: number[]): number | null {
  const v = values.filter(x => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

// ── Revenue recognition ─────────────────────────────────────────────────────

export type RecognitionMethod = 'monthly' | 'effort' | 'straight-line' | 'on-completion';

export interface RecognitionFacts {
  /** The contract value in ALL (a one-time project's whole fee). */
  contractValue: number;
  method: RecognitionMethod;
  startMs: number | null;
  endMs: number | null;
  /** When the project was marked Completed (null while running). */
  completedMs: number | null;
  cancelled: boolean;
  plannedHours: number;
  /** PM's latest estimate of hours still to go (null = unknown → planned hours rule). */
  remainingHoursEstimate: number | null;
}

/**
 * Which method a project actually uses, given what it declares and what it has.
 * `effort` needs planned hours, `straight-line` needs start AND end; anything
 * missing degrades to the next honest method, ending at on-completion (the
 * legacy behaviour: the whole fee in the month the project closed).
 */
export function effectiveRecognitionMethod(f: Pick<RecognitionFacts, 'method' | 'plannedHours' | 'startMs' | 'endMs'>): RecognitionMethod {
  if (f.method === 'monthly') return 'monthly';
  const hasDates = f.startMs != null && f.endMs != null && f.endMs > f.startMs;
  if (f.method === 'effort' && f.plannedHours > 0) return 'effort';
  if ((f.method === 'effort' || f.method === 'straight-line') && hasDates) return 'straight-line';
  return 'on-completion';
}

/** Hours at completion: the plan, or more when the PM says more is still to come. */
export function estimatedHoursAtCompletion(plannedHours: number, hoursToDate: number, remainingHoursEstimate: number | null): number {
  const remaining = remainingHoursEstimate != null && remainingHoursEstimate >= 0 ? remainingHoursEstimate : null;
  const viaEstimate = remaining != null ? hoursToDate + remaining : 0;
  return Math.max(plannedHours || 0, viaEstimate, hoursToDate || 0);
}

/**
 * Cumulative EARNED revenue of a one-time project as of `asOfMs`, given the hours
 * logged up to that instant. Monotonic in time and capped at the contract.
 *   effort        contract × min(1, hoursToDate / hoursAtCompletion); Completed → contract
 *   straight-line contract × elapsed share of start..end; Completed → contract
 *   on-completion contract once Completed, else 0
 * A cancelled project freezes: nothing more is earned after cancellation, and the
 * on-completion method earns nothing at all.
 */
export function earnedCumulative(f: RecognitionFacts, asOfMs: number, hoursToDate: number): number {
  const contract = Math.max(0, f.contractValue || 0);
  if (contract <= 0) return 0;
  const method = effectiveRecognitionMethod(f);
  if (method === 'monthly') return 0; // retainers are recognised per month by the caller
  const completed = f.completedMs != null && f.completedMs <= asOfMs && !f.cancelled;
  if (completed) return contract;
  if (method === 'on-completion') return 0;
  if (method === 'effort') {
    const eac = estimatedHoursAtCompletion(f.plannedHours, hoursToDate, f.remainingHoursEstimate);
    if (eac <= 0) return 0;
    return contract * Math.min(1, Math.max(0, hoursToDate) / eac);
  }
  // straight-line by elapsed time
  const start = f.startMs as number, end = f.endMs as number;
  if (asOfMs < start) return 0;
  if (asOfMs >= end) return contract;
  return contract * ((asOfMs - start) / (end - start));
}

/** Earned inside [startMs, endMs] = cumulative(end) − cumulative(just before start). */
export function earnedInPeriod(
  f: RecognitionFacts,
  periodStartMs: number,
  periodEndMs: number,
  hoursBeforePeriod: number,
  hoursThroughPeriodEnd: number,
): number {
  const before = earnedCumulative(f, periodStartMs - 1, hoursBeforePeriod);
  const through = earnedCumulative(f, periodEndMs, hoursThroughPeriodEnd);
  return Math.max(0, through - before);
}

// ── Budget: plan vs actual, EAC, alarms ─────────────────────────────────────

export interface EacInput {
  contractValue: number;
  costToDate: number;
  hoursToDate: number;
  plannedHours: number;
  plannedCost: number;
  remainingHoursEstimate: number | null;
  /** Cost rate to price the remaining hours; the project's own average so far, else the plan's. */
  avgCostRate: number;
}

export interface EacResult {
  hoursAtCompletion: number;
  remainingHours: number;
  remainingCost: number;
  eacCost: number;
  expectedProfit: number;
  expectedMarginPct: number | null;
  /** Planned cost consumed so far, in percent (null when nothing was planned). */
  consumedPct: number | null;
  overrun: boolean;
}

/** Estimate at completion — what the project will have cost when it is done. */
export function estimateAtCompletion(i: EacInput): EacResult {
  const hoursAtCompletion = estimatedHoursAtCompletion(i.plannedHours, i.hoursToDate, i.remainingHoursEstimate);
  const remainingHours = Math.max(0, hoursAtCompletion - (i.hoursToDate || 0));
  const remainingCost = remainingHours * Math.max(0, i.avgCostRate || 0);
  const eacCost = (i.costToDate || 0) + remainingCost;
  const expectedProfit = (i.contractValue || 0) - eacCost;
  return {
    hoursAtCompletion,
    remainingHours,
    remainingCost,
    eacCost,
    expectedProfit,
    expectedMarginPct: pct(expectedProfit, i.contractValue || 0),
    consumedPct: i.plannedCost > 0 ? (i.costToDate / i.plannedCost) * 100 : (i.plannedHours > 0 ? (i.hoursToDate / i.plannedHours) * 100 : null),
    overrun: i.plannedCost > 0 ? i.costToDate > i.plannedCost : (i.plannedHours > 0 && i.hoursToDate > i.plannedHours),
  };
}

/**
 * Every threshold now crossed that has not been announced yet, ascending. The
 * caller records ALL of them and announces only the highest — recording one at
 * a time made a single 60 % → 105 % jump fire three alarms on three runs.
 */
export function budgetAlertsDue(consumedPct: number | null, thresholds: number[], alreadySent: number[]): number[] {
  if (consumedPct == null) return [];
  const sent = new Set(alreadySent || []);
  return thresholds.filter(t => consumedPct >= t && !sent.has(t)).sort((a, b) => a - b);
}

/** The highest threshold now crossed that has not been announced yet (null = nothing to send). */
export function nextBudgetAlert(consumedPct: number | null, thresholds: number[], alreadySent: number[]): number | null {
  const due = budgetAlertsDue(consumedPct, thresholds, alreadySent);
  return due.length ? due[due.length - 1] : null;
}

export type BudgetAlertLevel = 'ok' | 'warning' | 'review' | 'stop';

/** 70 % → warning, 85 % → review by the PM, 100 % → no more hours without approval. */
export function budgetAlertLevel(consumedPct: number | null, thresholds: number[]): BudgetAlertLevel {
  if (consumedPct == null) return 'ok';
  const t = [...thresholds].sort((a, b) => a - b);
  const crossed = t.filter(x => consumedPct >= x).length;
  if (crossed === 0) return 'ok';
  if (crossed >= t.length) return 'stop';
  return crossed >= 2 ? 'review' : 'warning';
}

// ── Utilisation ─────────────────────────────────────────────────────────────

export type UtilizationStatus = 'idle' | 'ok' | 'overloaded' | 'none';

export function utilizationStatus(utilizationPct: number | null, bands: FinanceSettings['utilizationBands']): UtilizationStatus {
  if (utilizationPct == null) return 'none';
  if (utilizationPct < bands.low) return 'idle';
  if (utilizationPct > bands.high) return 'overloaded';
  return 'ok';
}

// ── Period keys ─────────────────────────────────────────────────────────────

/** `2026-09` from year + zero-based month. */
export function monthKey(year: number, monthIndex: number): string {
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
}
