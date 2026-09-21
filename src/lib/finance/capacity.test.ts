import { describe, it, expect } from 'vitest';
import type { TeamMember, TimeEntry } from '../../types';
import { allocateLabor } from './laborAllocation';
import { computeCapacity } from './capacity';

const d = (iso: string) => new Date(iso);
const m = (userId: string, costRole: string, cap?: number): TeamMember => ({
  id: `t_${userId}`, teamId: 't', userId, displayName: userId, role: 'Member', status: 'Active', costRole, clientCapacityHours: cap,
  monthlySalary: 100_000, createdAt: d('2026-01-01'), updatedAt: d('2026-01-01'), createdByUserId: null,
} as TeamMember);
const e = (userId: string, projectId: string | undefined, hours: number): TimeEntry => ({
  id: `${userId}_${projectId}_${hours}`, userId, projectId, startTime: d('2026-09-10T09:00:00'), endTime: d('2026-09-10T17:00:00'),
  duration: hours * 60, createdAt: d('2026-09-10'), updatedAt: d('2026-09-10'),
} as TimeEntry);
const period = { start: new Date(2026, 8, 1), end: new Date(2026, 8, 30, 23, 59, 59, 999) };

describe('computeCapacity (§20)', () => {
  const members = [m('g1', 'Graphic', 200), m('g2', 'Graphic', 200), m('s1', 'SMM', 350), m('ph', 'Photo', 200)];
  const entries = [e('g1', 'c', 160), e('g2', 'c', 150), e('s1', 'c', 230), e('ph', 'c', 175), e('g1', undefined, 10)];
  const labor = allocateLabor({ timeEntries: entries, members, expenses: [], period, settings: { employerCostPct: 0 }, clientProjectIds: new Set(['c']) });
  const cap = computeCapacity(labor, members);

  it('rolls utilisation up per role: Graphic 77.5 %, SMM 65.7 %, Photo 87.5 %', () => {
    const by = Object.fromEntries(cap.roles.map(r => [r.role, r]));
    expect(by['Graphic'].capacityHours).toBe(400);
    expect(by['Graphic'].clientHours).toBe(310);
    expect(by['Graphic'].utilizationPct).toBeCloseTo(77.5, 5);
    expect(by['SMM'].utilizationPct).toBeCloseTo(65.71, 1);
    expect(by['Photo'].utilizationPct).toBe(87.5);
    expect(by['Photo'].status).toBe('overloaded');
    expect(by['Graphic'].status).toBe('ok');
    expect(by['Graphic'].internalHours).toBe(10);
    expect(by['Graphic'].idleHours).toBe(80);
  });
  it('a member with no hours is idle, not absent', () => {
    const c2 = computeCapacity(allocateLabor({ timeEntries: [], members, expenses: [], period, settings: { employerCostPct: 0 } }), members);
    expect(c2.members).toHaveLength(4);
    expect(c2.members.every(r => r.status === 'idle' && r.utilizationPct === 0)).toBe(true);
    expect(c2.totals.utilizationPct).toBe(0);
  });
});
