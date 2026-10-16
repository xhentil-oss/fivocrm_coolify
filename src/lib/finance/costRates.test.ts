import { describe, it, expect } from 'vitest';
import type { TeamMember } from '../../types';
import { buildRateCard, memberCostRate, memberCostRole, memberCapacityHours, roleCostRate } from './costRates';
import { DEFAULT_FINANCE_SETTINGS, resolveFinanceSettings } from './profitabilityCore';

const d = (iso: string) => new Date(iso);
const m = (userId: string, extra: Partial<TeamMember> = {}): TeamMember => ({
  id: `t_${userId}`, teamId: 't', userId, displayName: userId, role: 'Member', status: 'Active',
  createdAt: d('2026-01-01'), updatedAt: d('2026-01-01'), createdByUserId: null, ...extra,
} as TeamMember);
const S0 = resolveFinanceSettings({ employerCostPct: 0, defaultClientCapacityHours: 120 });
const sept = d('2026-09-30T23:59:59');

describe('costRates', () => {
  it('role: costRole → position → "Pa rol"', () => {
    expect(memberCostRole(m('a', { costRole: 'SMM', position: 'social' }))).toBe('SMM');
    expect(memberCostRole(m('a', { position: 'design' }))).toBe('design');
    expect(memberCostRole(m('a'))).toBe('Pa rol');
  });
  it('capacity: member → rate card role → default', () => {
    expect(memberCapacityHours(m('a', { clientCapacityHours: 100 }), S0)).toBe(100);
    expect(memberCapacityHours(m('a', { costRole: 'PM' }), S0, [{ role: 'pm', defaultCapacityHours: 110 }])).toBe(110);
    expect(memberCapacityHours(m('a'), S0)).toBe(120);
  });
  it('§4 rate card: 120k/120h = 1 000, 160k/100h = 1 600, 180k/110h = 1 636', () => {
    const rows = buildRateCard([
      m('gd', { costRole: 'Graphic Designer', monthlySalary: 120_000 }),
      m('ph', { costRole: 'Photographer', monthlySalary: 160_000, clientCapacityHours: 100 }),
      m('pm', { costRole: 'PM', monthlySalary: 180_000, clientCapacityHours: 110 }),
      m('none', { costRole: 'PM' }),
    ], { employerCostPct: 0, defaultClientCapacityHours: 120 }, sept, [{ role: 'PM', sellRate: 3000 }, { role: 'SEO', defaultCapacityHours: 115 }]);
    const by = Object.fromEntries(rows.map(r => [r.role, r]));
    expect(by['Graphic Designer'].costRate).toBe(1000);
    expect(by['Photographer'].costRate).toBe(1600);
    expect(by['PM'].costRate).toBeCloseTo(1636.36, 1);
    expect(by['PM'].headcount).toBe(2);
    expect(by['PM'].withoutRate).toBe(1);
    expect(by['PM'].hourMarginPct).toBeCloseTo((3000 - 1636.36) / 3000 * 100, 0);
    expect(by['SEO']).toMatchObject({ headcount: 0, costRate: 0 }); // card-only role still listed
    expect(roleCostRate(rows, 'photographer')).toBe(1600);
  });
  it('loads employer contributions and honours salary history', () => {
    const member = m('a', {
      monthlySalary: 200_000,
      salaryHistory: [{ monthlySalary: 100_000, effectiveFrom: d('2026-01-01') }, { monthlySalary: 200_000, effectiveFrom: d('2026-10-01') }],
    });
    const r = memberCostRate(member, sept, DEFAULT_FINANCE_SETTINGS);
    expect(r.rate).toBeCloseTo(100_000 * 1.167 / 120, 5);
    expect(memberCostRate(member, d('2026-10-31'), DEFAULT_FINANCE_SETTINGS).rate).toBeCloseTo(200_000 * 1.167 / 120, 5);
    expect(memberCostRate(m('b', { monthlySalary: 100_000, hourlyCostRate: 900 }), sept, S0)).toMatchObject({ rate: 900, basis: 'override' });
  });
  it('a leaver already off payroll does not appear on the card', () => {
    const rows = buildRateCard([m('gone', { costRole: 'SMM', monthlySalary: 100_000, status: 'Inactive', leftAt: d('2026-06-30') })], S0, sept);
    expect(rows).toEqual([]);
  });
});

describe('one person, several team rows (per-month resolution)', () => {
  it('buildRateCard prices a mover at the CURRENT row (60k), one head, not the old Inactive 80k row', () => {
    const rows = buildRateCard([
      m('ana', { id: 'tA_ana', costRole: 'SMM', monthlySalary: 80_000, status: 'Inactive', leftAt: d('2026-03-01T00:00:00') } as any),
      m('ana', { id: 'tB_ana', costRole: 'SMM', monthlySalary: 60_000, hiredAt: d('2026-03-01T00:00:00') } as any),
    ], { employerCostPct: 0, defaultClientCapacityHours: 120 }, sept);
    const smm = rows.find(r => r.role === 'SMM')!;
    expect(smm.headcount).toBe(1);
    expect(smm.costRate).toBe(500);
  });
  it('the override on any row wins over the derived rate', () => {
    const rows = buildRateCard([
      m('ana', { id: 'tA_ana', costRole: 'SMM', monthlySalary: 120_000 }),
      m('ana', { id: 'tB_ana', costRole: 'SMM', hourlyCostRate: 1_400 }),
    ], { employerCostPct: 0, defaultClientCapacityHours: 120 }, sept);
    expect(rows.find(r => r.role === 'SMM')!.members[0]).toMatchObject({ rate: 1_400, basis: 'override' });
  });
});
