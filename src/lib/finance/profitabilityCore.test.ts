/**
 * @vitest-environment node
 *
 * Node, not jsdom: the drift guard reads `api/_profitabilityCore.ts` off disk.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  DEFAULT_FINANCE_SETTINGS,
  resolveFinanceSettings,
  costRateFor,
  loadedMonthlyCost,
  suggestedPrice,
  marginStatus,
  classifyClient,
  median,
  effectiveRecognitionMethod,
  earnedCumulative,
  earnedInPeriod,
  estimateAtCompletion,
  nextBudgetAlert,
  budgetAlertLevel,
  utilizationStatus,
  type RecognitionFacts,
} from './profitabilityCore';

const S = DEFAULT_FINANCE_SETTINGS;
const ms = (iso: string) => new Date(iso).getTime();

describe('api mirror', () => {
  it('api/_profitabilityCore.ts is byte-identical to the canonical core', () => {
    const root = resolve(__dirname, '../../..');
    const canonical = readFileSync(resolve(root, 'src/lib/finance/profitabilityCore.ts'), 'utf8');
    const mirror = readFileSync(resolve(root, 'api/_profitabilityCore.ts'), 'utf8');
    expect(mirror).toBe(canonical);
  });
});

describe('resolveFinanceSettings', () => {
  it('falls back to defaults and clamps nonsense', () => {
    const s = resolveFinanceSettings({ employerCostPct: 5, defaultClientCapacityHours: -3, marginThresholds: { healthy: 30, watch: 50 } } as any);
    expect(s.employerCostPct).toBe(0.167);
    expect(s.defaultClientCapacityHours).toBe(120);
    // watch can never exceed healthy
    expect(s.marginThresholds).toEqual({ healthy: 30, watch: 30 });
    expect(s.budgetAlertThresholds).toEqual([70, 85, 100]);
    expect(resolveFinanceSettings(null)).toEqual(S);
  });
  it('dedupes and sorts alert thresholds', () => {
    expect(resolveFinanceSettings({ budgetAlertThresholds: [100, 70, 70, 85] }).budgetAlertThresholds).toEqual([70, 85, 100]);
  });
});

describe('cost rates (§3 of the owner brief)', () => {
  it('120 000 salary at 0 % load over 120 h = 1 000 L/h, not salary/176', () => {
    const r = costRateFor({ monthlySalary: 120_000, capacityHours: 120, settings: { ...S, employerCostPct: 0 } });
    expect(r.rate).toBe(1000);
    expect(r.basis).toBe('derived');
  });
  it('loads employer contributions onto the salary', () => {
    expect(loadedMonthlyCost(100_000, 0.167)).toBeCloseTo(116_700, 5);
    const r = costRateFor({ monthlySalary: 100_000, settings: S });
    expect(r.rate).toBeCloseTo(116_700 / 120, 5);
    expect(r.capacityHours).toBe(120);
  });
  it('an explicit override wins and a missing salary yields none', () => {
    expect(costRateFor({ monthlySalary: 100_000, hourlyCostRateOverride: 1500, settings: S })).toMatchObject({ rate: 1500, basis: 'override' });
    expect(costRateFor({ monthlySalary: 0, settings: S })).toMatchObject({ rate: 0, basis: 'none' });
  });
});

describe('pricing & margin (§6)', () => {
  it('100 000 direct cost at 55 % target → 222 222', () => {
    expect(Math.round(suggestedPrice(100_000, 55))).toBe(222_222);
    expect(suggestedPrice(0, 55)).toBe(0);
  });
  it('status bands', () => {
    expect(marginStatus(70, S.marginThresholds)).toBe('healthy');
    expect(marginStatus(45, S.marginThresholds)).toBe('watch');
    expect(marginStatus(12.5, S.marginThresholds)).toBe('investigate');
    expect(marginStatus(null, S.marginThresholds)).toBe('none');
  });
  it('classifies clients by margin × friction (§27)', () => {
    expect(classifyClient(70, 5000, 3000, S.marginThresholds)).toBe('A');
    expect(classifyClient(70, 2000, 3000, S.marginThresholds)).toBe('B');
    expect(classifyClient(20, 5000, 3000, S.marginThresholds)).toBe('C');
    expect(classifyClient(20, 2000, 3000, S.marginThresholds)).toBe('D');
    expect(classifyClient(null, 1, 1, S.marginThresholds)).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe('revenue recognition (§11–§12)', () => {
  const website: RecognitionFacts = {
    contractValue: 600_000, method: 'effort', startMs: ms('2026-09-15'), endMs: ms('2026-12-14'),
    completedMs: null, cancelled: false, plannedHours: 300, remainingHoursEstimate: null,
  };
  it('earns by effort: 80h/160h/0h/60h of 300 → 160k/320k/0/120k = 600k', () => {
    const m1 = earnedInPeriod(website, ms('2026-09-01'), ms('2026-09-30T23:59:59'), 0, 80);
    const m2 = earnedInPeriod(website, ms('2026-10-01'), ms('2026-10-31T23:59:59'), 80, 240);
    const m3 = earnedInPeriod(website, ms('2026-11-01'), ms('2026-11-30T23:59:59'), 240, 240);
    const done = { ...website, completedMs: ms('2026-12-20') };
    const m4 = earnedInPeriod(done, ms('2026-12-01'), ms('2026-12-31T23:59:59'), 240, 300);
    expect(Math.round(m1)).toBe(160_000);
    expect(Math.round(m2)).toBe(320_000);
    expect(m3).toBe(0);
    expect(Math.round(m4)).toBe(120_000);
    expect(Math.round(m1 + m2 + m3 + m4)).toBe(600_000);
  });
  it('an overrun caps at the contract — 400 h of 300 planned never earns 800k', () => {
    expect(earnedCumulative(website, ms('2026-12-01'), 400)).toBe(600_000);
  });
  it('the PM\'s remaining estimate stretches the denominator', () => {
    const f = { ...website, remainingHoursEstimate: 100 };
    // 200 to date + 100 remaining = 300 = plan → 2/3; 250 + 100 = 350 > plan → 250/350
    expect(earnedCumulative(f, ms('2026-11-01'), 200)).toBeCloseTo(400_000, 3);
    expect(earnedCumulative(f, ms('2026-11-01'), 250)).toBeCloseTo(600_000 * 250 / 350, 3);
  });
  it('Completed trues up to the contract; cancelled freezes', () => {
    expect(earnedCumulative({ ...website, completedMs: ms('2026-11-10') }, ms('2026-11-30'), 150)).toBe(600_000);
    expect(earnedCumulative({ ...website, completedMs: ms('2026-11-10') }, ms('2026-11-05'), 150)).toBe(300_000);
    expect(earnedCumulative({ ...website, cancelled: true, completedMs: ms('2026-11-10') }, ms('2026-12-01'), 150)).toBe(300_000);
  });
  it('straight-line by service days when there are no planned hours', () => {
    const f: RecognitionFacts = { ...website, plannedHours: 0, startMs: ms('2026-03-01'), endMs: ms('2026-03-31') };
    expect(effectiveRecognitionMethod(f)).toBe('straight-line');
    expect(earnedCumulative(f, ms('2026-03-16'), 0)).toBeCloseTo(300_000, 3);
    expect(earnedCumulative(f, ms('2026-02-01'), 0)).toBe(0);
    expect(earnedCumulative(f, ms('2026-05-01'), 0)).toBe(600_000);
  });
  it('degrades to on-completion without hours or dates (the legacy rule)', () => {
    const f: RecognitionFacts = { ...website, plannedHours: 0, startMs: null, endMs: null };
    expect(effectiveRecognitionMethod(f)).toBe('on-completion');
    expect(earnedCumulative(f, ms('2026-11-01'), 500)).toBe(0);
    expect(earnedCumulative({ ...f, completedMs: ms('2026-10-01') }, ms('2026-11-01'), 500)).toBe(600_000);
  });
  it('a retainer is never recognised here (the month loop owns it)', () => {
    expect(earnedCumulative({ ...website, method: 'monthly' }, ms('2026-11-01'), 500)).toBe(0);
  });
});

describe('budget, EAC and alarms (§12–§15)', () => {
  it('EAC: 600k contract, 220k to date, 180k remaining → 400k, 33.3 %', () => {
    const r = estimateAtCompletion({
      contractValue: 600_000, costToDate: 220_000, hoursToDate: 220, plannedHours: 300, plannedCost: 300_000,
      remainingHoursEstimate: 180, avgCostRate: 1000,
    });
    expect(r.hoursAtCompletion).toBe(400);
    expect(r.remainingCost).toBe(180_000);
    expect(r.eacCost).toBe(400_000);
    expect(r.expectedProfit).toBe(200_000);
    expect(r.expectedMarginPct).toBeCloseTo(33.33, 1);
    expect(r.consumedPct).toBeCloseTo(73.33, 1);
    expect(r.overrun).toBe(false);
  });
  it('planned 300h, worked 400h → overrun, revenue unchanged (the caller keeps the contract)', () => {
    const r = estimateAtCompletion({
      contractValue: 600_000, costToDate: 400_000, hoursToDate: 400, plannedHours: 300, plannedCost: 300_000,
      remainingHoursEstimate: 0, avgCostRate: 1000,
    });
    expect(r.overrun).toBe(true);
    expect(r.eacCost).toBe(400_000);
    expect(r.expectedProfit).toBe(200_000);
  });
  it('alerts fire once per threshold, highest first', () => {
    expect(nextBudgetAlert(72, S.budgetAlertThresholds, [])).toBe(70);
    expect(nextBudgetAlert(72, S.budgetAlertThresholds, [70])).toBeNull();
    expect(nextBudgetAlert(101, S.budgetAlertThresholds, [70])).toBe(100);
    expect(nextBudgetAlert(null, S.budgetAlertThresholds, [])).toBeNull();
    expect(budgetAlertLevel(50, S.budgetAlertThresholds)).toBe('ok');
    expect(budgetAlertLevel(72, S.budgetAlertThresholds)).toBe('warning');
    expect(budgetAlertLevel(90, S.budgetAlertThresholds)).toBe('review');
    expect(budgetAlertLevel(120, S.budgetAlertThresholds)).toBe('stop');
  });
  it('utilisation bands', () => {
    expect(utilizationStatus(40, S.utilizationBands)).toBe('idle');
    expect(utilizationStatus(77.5, S.utilizationBands)).toBe('ok');
    expect(utilizationStatus(95, S.utilizationBands)).toBe('overloaded');
    expect(utilizationStatus(null, S.utilizationBands)).toBe('none');
  });
});
