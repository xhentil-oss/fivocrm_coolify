import { describe, it, expect } from 'vitest';
import type { Expense, TeamMember, TimeEntry } from '../../types';
import { allocateLabor, laborOutsideRows, poolLabor, laborByProjectForEntries, laborForEntries } from './laborAllocation';
import { payrollBetween } from './payroll';

const d = (iso: string) => new Date(iso);
const member = (userId: string, monthlySalary: number, extra: Partial<TeamMember> = {}): TeamMember => ({
  id: `t_${userId}`, teamId: 't', userId, displayName: userId, role: 'Member', status: 'Active',
  monthlySalary, createdAt: d('2026-01-01'), updatedAt: d('2026-01-01'), createdByUserId: null, ...extra,
} as TeamMember);
const entry = (userId: string, projectId: string | undefined, hours: number, day = '2026-09-10', extra: Partial<TimeEntry> = {}): TimeEntry => ({
  id: `${userId}_${projectId}_${day}_${hours}`, userId, projectId, startTime: d(`${day}T09:00:00`), endTime: d(`${day}T17:00:00`),
  duration: hours * 60, createdAt: d(day), updatedAt: d(day), ...extra,
} as TimeEntry);
const period = { start: d('2026-09-01T00:00:00'), end: d('2026-09-30T23:59:59.999') };
// employer load 0 so the arithmetic is readable: 120 000 / 120 h = 1 000 L/h
const settings = { employerCostPct: 0, defaultClientCapacityHours: 120 };

describe('allocateLabor', () => {
  const ana = member('ana', 120_000);   // 1 000 L/h
  const besi = member('besi', 96_000);  //   800 L/h
  const members = [ana, besi];

  it('costs each project by the hours logged on it × the member cost rate', () => {
    const a = allocateLabor({
      timeEntries: [entry('ana', 'pX', 30), entry('besi', 'pX', 10), entry('ana', 'pY', 20)],
      members, expenses: [], period, settings, clientProjectIds: new Set(['pX', 'pY']),
    });
    expect(a.basis).toBe('hours');
    expect(a.byProject.get('pX')).toMatchObject({ hours: 40, cost: 30_000 + 8_000 });
    expect(a.byProject.get('pY')).toMatchObject({ hours: 20, cost: 20_000 });
    expect(a.byProject.get('pX')!.byRole['Pa rol']).toEqual({ hours: 40, cost: 38_000 });
    expect(a.absorbed).toBe(58_000);
  });

  it('INVARIANT: absorbed + unabsorbed == payroll of the period', () => {
    const entries = [entry('ana', 'pX', 30), entry('besi', 'pX', 10), entry('ana', undefined, 5)];
    const a = allocateLabor({ timeEntries: entries, members, expenses: [], period, settings });
    const payroll = payrollBetween(members, [], period.start, period.end).total;
    expect(payroll).toBe(216_000);
    // 38 000 on projects + 5 000 internal (no project) covered; the rest is bench
    expect(a.absorbed).toBe(38_000);
    expect(a.internal).toEqual({ hours: 5, cost: 5_000 });
    expect(a.absorbed + a.internal.cost + a.unabsorbed).toBeCloseTo(payroll, 6);
    expect(a.overAbsorbed).toBe(0);
  });

  it('rates above payroll are reported as over-absorption, never as a phantom pool', () => {
    const a = allocateLabor({
      timeEntries: [entry('ana', 'pX', 200)], members: [ana], expenses: [], period, settings,
    });
    expect(a.absorbed).toBe(200_000);
    expect(a.unabsorbed).toBe(0);
    expect(a.overAbsorbed).toBe(80_000);
  });

  it('a member without salary logs hours at cost 0 and is named; an unknown uid is counted', () => {
    const ghost = member('ghost', 0);
    const a = allocateLabor({
      timeEntries: [entry('ghost', 'pX', 8), entry('nobody', 'pX', 3)], members: [ana, ghost], expenses: [], period, settings,
    });
    expect(a.byProject.get('pX')!.cost).toBe(0);
    expect(a.membersWithoutRate).toEqual(['ghost']);
    expect(a.entriesWithoutMember).toBe(1);
  });

  it('ignores entries outside the period and running timers', () => {
    const a = allocateLabor({
      timeEntries: [
        entry('ana', 'pX', 10, '2026-08-31'),
        entry('ana', 'pX', 10, '2026-10-01'),
        { ...entry('ana', 'pX', 10), endTime: undefined, duration: undefined } as any,
        entry('ana', 'pX', 4),
      ],
      members, expenses: [], period, settings,
    });
    expect(a.byProject.get('pX')!.hours).toBe(4);
    expect(a.entriesConsidered).toBe(1);
  });

  it('no entries → basis none, everything unabsorbed', () => {
    const a = allocateLabor({ timeEntries: [], members, expenses: [], period, settings });
    expect(a.basis).toBe('none');
    expect(a.unabsorbed).toBe(216_000);
  });

  it('per-member utilisation = client hours / capacity; internal projects are not client hours', () => {
    const a = allocateLabor({
      timeEntries: [entry('ana', 'client', 60), entry('ana', 'internal', 30), entry('ana', undefined, 6)],
      members: [ana], expenses: [], period, settings, clientProjectIds: new Set(['client']),
    });
    const row = a.byMember.get('ana')!;
    expect(row.clientHours).toBe(60);
    expect(row.internalHours).toBe(36);
    expect(row.capacityHours).toBe(120);
    expect(row.utilizationPct).toBe(50);
    expect(row.clientCost).toBe(60_000);
  });

  it('a raise mid-period prices each month at the salary that applied then', () => {
    const raised = member('ana', 240_000, {
      salaryHistory: [
        { monthlySalary: 120_000, effectiveFrom: d('2026-01-01') },
        { monthlySalary: 240_000, effectiveFrom: d('2026-10-01') },
      ],
    });
    const twoMonths = { start: d('2026-09-01T00:00:00'), end: d('2026-10-31T23:59:59.999') };
    const a = allocateLabor({
      timeEntries: [entry('ana', 'pX', 10, '2026-09-10'), entry('ana', 'pX', 10, '2026-10-10')],
      members: [raised], expenses: [], period: twoMonths, settings,
    });
    // September hour = 1 000, October hour = 2 000
    expect(a.byProject.get('pX')!.cost).toBe(10_000 + 20_000);
  });

  it('recorded salary rows define the payroll the hours must foot to', () => {
    const rows: Expense[] = [{
      id: 'e1', title: 'Paga Ana', amount: 100_000, currency: 'ALL', category: 'Salary', date: d('2026-09-28'),
      createdAt: d('2026-09-28'), updatedAt: d('2026-09-28'), createdByUserId: null,
    } as Expense];
    const a = allocateLabor({ timeEntries: [entry('ana', 'pX', 30)], members: [ana], expenses: rows, period, settings });
    expect(a.payroll.total).toBe(100_000);
    expect(a.unabsorbed).toBe(70_000);
  });
});

// ── Sep 2026 audit: labour no row carries goes to the pool, never nowhere ──
describe('laborOutsideRows / poolLabor', () => {
  const ana = member('ana', 120_000);   // 1 000 L/h
  const besi = member('besi', 96_000);  //   800 L/h
  const members = [ana, besi];

  it('hours with no project and hours on a project outside the rows are both pooled', () => {
    const a = allocateLabor({
      timeEntries: [
        entry('ana', 'pX', 30),          // a row the consumer has
        entry('ana', undefined, 5),      // no project at all
        entry('besi', 'archived', 10),   // a project the consumer has no row for
      ],
      members, expenses: [], period, settings,
    });
    const rows = new Set(['pX']);
    const outside = laborOutsideRows(a, rows);
    expect(outside.internal).toBe(5_000);
    expect(outside.absentProjects).toBe(8_000);
    expect(outside.absentHours).toBe(10);
    expect(outside.absentProjectIds).toEqual(['archived']);
    expect(outside.total).toBe(13_000);
    // Σ rows' labour + pool labour == payroll (no over-absorption here).
    const payroll = payrollBetween(members, [], period.start, period.end).total;
    const rowLabor = a.byProject.get('pX')!.cost;
    expect(rowLabor + poolLabor(a, rows)).toBeCloseTo(payroll, 6);
    // Pooling `unabsorbed` alone would have dropped 13 000 of real cost.
    expect(rowLabor + a.unabsorbed).toBeLessThan(payroll);
  });

  it('with every project on a row, only the internal hours are outside', () => {
    const a = allocateLabor({ timeEntries: [entry('ana', 'pX', 30), entry('besi', undefined, 2)], members, expenses: [], period, settings });
    const outside = laborOutsideRows(a, new Set(['pX']));
    expect(outside).toMatchObject({ internal: 1_600, absentProjects: 0, absentHours: 0, absentProjectIds: [], total: 1_600 });
  });
});

describe('laborByProjectForEntries / laborForEntries (all-time, as of a date)', () => {
  const ana = member('ana', 120_000);
  it('costs every entry up to `asOf` with the real rates, grouped by project, `entryHours` semantics', () => {
    const entries = [
      entry('ana', 'web', 40, '2026-08-10'),
      entry('ana', 'web', 10, '2026-09-10'),
      entry('ana', 'web', 99, '2026-10-10'),                              // after asOf → out
      { ...entry('ana', 'web', 5, '2026-09-11'), endTime: undefined, duration: undefined } as any, // open timer → out
      { ...entry('ana', 'web', 0, '2026-09-12'), duration: undefined, startTime: d('2026-09-12T09:00:00'), endTime: d('2026-09-12T12:00:00') } as any, // start/end only → 3 h
      entry('ana', 'other', 7, '2026-09-13'),
      entry('ana', undefined, 2, '2026-09-14'),
    ];
    const byProject = laborByProjectForEntries(entries, [ana], settings, null, period.end);
    expect(byProject.get('web')).toMatchObject({ hours: 53, cost: 53_000 });
    expect(byProject.get('other')).toMatchObject({ hours: 7, cost: 7_000 });
    expect(byProject.get('')).toMatchObject({ hours: 2, cost: 2_000 });
    expect(laborForEntries(entries, [ana], settings, null, 'web', period.end)).toMatchObject({ hours: 53, cost: 53_000 });
    expect(laborForEntries(entries, [ana], settings, null, undefined, period.end).hours).toBe(62);
  });
});
