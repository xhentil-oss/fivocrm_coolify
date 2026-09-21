import { describe, it, expect } from 'vitest';
import type { Project } from '../../types';
import { DEFAULT_FINANCE_SETTINGS } from './profitabilityCore';
import { normalizePlannedRoles, plannedEconomics, planVsActual, projectEac, pendingBudgetAlert, plannedFieldsPatch } from './projectBudget';
import type { ProjectLabor } from './laborAllocation';

const S = DEFAULT_FINANCE_SETTINGS;
const d = (iso: string) => new Date(iso);
// §5: the 300 000 L Social Media + Content project, 121 planned hours, 148 300 planned labour
const roles = [
  { role: 'Strategy', plannedHours: 6, costRate: 1800 },
  { role: 'PM', plannedHours: 15, costRate: 1600 },
  { role: 'SMM', plannedHours: 45, costRate: 1100 },
  { role: 'Designer', plannedHours: 40, costRate: 1000 },
  { role: 'Photographer', plannedHours: 15, costRate: 1600 },
];
const project = (extra: Partial<Project> = {}): Project => ({
  id: 'p', name: 'Social + Content', status: 'Active', budget: 300_000, currency: 'ALL', billingType: 'one-time',
  plannedRoles: roles, plannedDirectExpenses: 20_000, targetMarginPct: 55,
  createdAt: d('2026-09-01'), updatedAt: d('2026-09-01'), createdByUserId: null, ...extra,
} as Project);

describe('planning (§5–§6)', () => {
  it('normalises typed input', () => {
    expect(normalizePlannedRoles([{ role: ' SMM ', plannedHours: '10', costRate: '1100', sellRate: 0 }, { role: '', plannedHours: 5 }, null, { role: 'X', plannedHours: 0 }]))
      .toEqual([{ role: 'SMM', plannedHours: 10, costRate: 1100 }]);
  });
  it('planned labour 148 300 + 20 000 direct → 43.9 % margin at 300 000; price at 55 % = 373 999', () => {
    const e = plannedEconomics(project(), S);
    expect(e.plannedHours).toBe(121);
    expect(e.plannedLaborCost).toBe(148_300);
    expect(e.plannedDirectCost).toBe(168_300);
    expect(e.plannedGrossProfit).toBe(131_700);
    expect(e.plannedMarginPct).toBeCloseTo(43.9, 1);
    expect(e.plannedMarginStatus).toBe('watch');
    expect(Math.round(e.suggestedPrice)).toBe(374_000);
  });
  it('plannedFieldsPatch denormalises the sums the cron reads', () => {
    expect(plannedFieldsPatch(normalizePlannedRoles(roles), 20_000)).toMatchObject({ plannedHours: 121, plannedLaborCost: 148_300, plannedDirectExpenses: 20_000 });
    expect(plannedFieldsPatch([], undefined)).toEqual({ plannedRoles: [], plannedHours: 0, plannedLaborCost: 0, plannedDirectExpenses: 0 });
  });
});

describe('plan vs actual (§13)', () => {
  const labor: ProjectLabor = {
    projectId: 'p', hours: 100, cost: 115_000, byMember: [],
    byRole: { SMM: { hours: 34, cost: 37_400 }, Designer: { hours: 42, cost: 42_000 }, Photographer: { hours: 9, cost: 14_400 }, PM: { hours: 15, cost: 24_000 } },
  };
  const p = project({ plannedRoles: [
    { role: 'SMM', plannedHours: 30, costRate: 1100 }, { role: 'Designer', plannedHours: 25, costRate: 1000 },
    { role: 'Photographer', plannedHours: 10, costRate: 1600 }, { role: 'PM', plannedHours: 6, costRate: 1600 },
  ], plannedDirectExpenses: 0 });
  it('names the roles that blew the budget — Designer and PM, not the price', () => {
    const v = planVsActual(p, labor, S);
    expect(v.plannedHours).toBe(71);
    expect(v.actualHours).toBe(100);
    expect(v.overrunRoles).toEqual(expect.arrayContaining(['Designer', 'PM', 'SMM']));
    expect(v.roles.find(r => r.role === 'Photographer')!.over).toBe(false);
    expect(v.roles[0].role).toBe('Designer'); // biggest overrun first (42 000 vs 25 000)
    expect(v.level).toBe('stop');
  });
  it('a role that was never planned but logged hours is an overrun too', () => {
    const v = planVsActual(project({ plannedRoles: [{ role: 'SMM', plannedHours: 10, costRate: 1000 }] }), { ...labor, byRole: { SMM: { hours: 5, cost: 5000 }, Dev: { hours: 3, cost: 3000 } } }, S);
    expect(v.roles.find(r => r.role === 'Dev')!.over).toBe(true);
    expect(v.roles.find(r => r.role === 'Dev')!.consumedPct).toBeNull();
    expect(v.overrunRoles).toEqual([]); // unplanned roles are flagged on the row, not counted against a plan
  });
});

describe('EAC and alerts (§15, §14)', () => {
  it('prices remaining hours at the project\'s own average rate', () => {
    const p = project({ remainingHoursEstimate: 40 });
    const eac = projectEac(p, { hours: 100, cost: 130_000 }, 10_000, S);
    // plan 121 h; to date 100 + 40 remaining = 140 → 40 h × 1 300 = 52 000 remaining
    expect(eac.hoursAtCompletion).toBe(140);
    expect(eac.remainingCost).toBe(52_000);
    expect(eac.eacCost).toBe(192_000);
    expect(eac.expectedProfit).toBe(108_000);
    expect(eac.expectedMarginPct).toBeCloseTo(36, 5);
  });
  it('fires each threshold once', () => {
    expect(pendingBudgetAlert(project({ budgetAlertsSent: [] }), 88, S)).toBe(85);
    expect(pendingBudgetAlert(project({ budgetAlertsSent: [70, 85] }), 88, S)).toBeNull();
    expect(pendingBudgetAlert(project({ budgetAlertsSent: [70, 85] }), 100, S)).toBe(100);
  });
});
