import { describe, it, expect } from 'vitest';
import type { Expense, TeamMember, TimeEntry } from '../../types';
import { allocateLabor, laborOutsideRows, loadCreditOf, poolLabor, laborByProjectForEntries, laborForEntries, memberEmployedMonthsBetween } from './laborAllocation';
import { entryHours } from './laborCost';
import { payrollBetween } from './payroll';

const d = (iso: string) => new Date(iso);
const member = (userId: string, monthlySalary: number, extra: Partial<TeamMember> = {}): TeamMember => ({
  id: `t_${userId}`, teamId: 't', userId, displayName: userId, role: 'Member', status: 'Active',
  monthlySalary, createdAt: d('2026-01-01'), updatedAt: d('2026-01-01'), createdByUserId: null, ...extra,
} as TeamMember);
const entry = (userId: string, projectId: string | undefined, hours: number, day = '2026-09-10', extra: Partial<TimeEntry> = {}): TimeEntry => ({
  id: `${userId}_${projectId}_${day}_${hours}`, userId, projectId, startTime: d(`${day}T09:00:00`), endTime: d(`${day}T17:00:00`),
  // `source: 'manual'`: the fixture's hours are a typed duration (the 09–17 span is synthetic).
  duration: hours * 60, source: 'manual', createdAt: d(day), updatedAt: d(day), ...extra,
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

// -- Oct 2026 audit ----------------------------------------------------------
describe('loaded rate vs unloaded payroll: the pool is never negative, the excess is loadCredit', () => {
  const p = member('p', 100_000);
  // defaults: employerCostPct 0.167, capacity 120 -> 116 700 / 120 = 972.5 L/h
  it('100 h client + 40 h no project: rows + poolLabor == payroll + loadCredit', () => {
    const a = allocateLabor({
      timeEntries: [entry('p', 'pX', 100), entry('p', undefined, 40)],
      members: [p], expenses: [], period, clientProjectIds: new Set(['pX']),
    });
    expect(a.absorbed + a.internal.cost).toBeCloseTo(136_150, 6);
    expect(a.overAbsorbed).toBeCloseTo(36_150, 6);
    expect(loadCreditOf(a)).toBeCloseTo(36_150, 6);
    expect(a.unabsorbed).toBe(0);
    const rows = new Set(['pX']);
    const rowLabor = a.byProject.get('pX')!.cost;
    expect(poolLabor(a, rows)).toBeCloseTo(38_900, 6);              // the 40 h no-project, never negative
    expect(rowLabor + poolLabor(a, rows)).toBeCloseTo(100_000 + loadCreditOf(a), 6);
    expect(a.loadedPayroll).toBeCloseTo(116_700, 6);
    // 140 h > 120 h practical capacity: THAT is the real signal, not the employer load
    expect(a.overAbsorbedVsLoaded).toBeCloseTo(136_150 - 116_700, 6);
  });
  it('a month at exactly the practical capacity over-absorbs only by the employer load -> no rates warning, pool 0', () => {
    const a = allocateLabor({ timeEntries: [entry('p', 'pX', 120)], members: [p], expenses: [], period });
    expect(a.overAbsorbed).toBeCloseTo(16_700, 6);
    expect(a.overAbsorbedVsLoaded).toBe(0);
    expect(poolLabor(a, new Set(['pX']))).toBe(0);
    expect(a.byProject.get('pX')!.cost + poolLabor(a, new Set(['pX'])) - loadCreditOf(a)).toBeCloseTo(100_000, 6);
  });
  it('per-month rate over a person\'s rows: the Inactive 80k row (left 1 Mar) does not price September hours', () => {
    const rowA = member('ana', 80_000, { id: 'tA_ana', teamId: 'tA', status: 'Inactive', leftAt: new Date(2026, 2, 1) } as any);
    const rowB = member('ana', 60_000, { id: 'tB_ana', teamId: 'tB', hiredAt: new Date(2026, 2, 1) } as any);
    const sept = allocateLabor({ timeEntries: [entry('ana', 'pX', 10)], members: [rowA, rowB], expenses: [], period, settings });
    expect(sept.byProject.get('pX')!.cost).toBe(5_000);          // 60 000 / 120 h × 10 h (the merge used 80 000)
    expect(sept.payroll.total).toBe(60_000);
    const jan = { start: d('2026-01-01T00:00:00'), end: d('2026-01-31T23:59:59.999') };
    const a = allocateLabor({ timeEntries: [entry('ana', 'pX', 12, '2026-01-15')], members: [rowA, rowB], expenses: [], period: jan, settings });
    expect(a.byProject.get('pX')!.cost).toBe(8_000);             // January: still the 80 000 row
  });
  it('an hourlyCostRate override on ANY of the person\'s rows is honoured', () => {
    const rowA = member('ana', 120_000, { id: 'tA_ana', teamId: 'tA' });
    const rowB = member('ana', 0, { id: 'tB_ana', teamId: 'tB', monthlySalary: undefined, hourlyCostRate: 1_500 });
    const a = allocateLabor({ timeEntries: [entry('ana', 'pX', 10)], members: [rowA, rowB], expenses: [], period, settings });
    expect(a.byProject.get('pX')!.cost).toBe(15_000);
  });
});

describe('one person, one record (rows per team are collapsed by userId)', () => {
  it('hours are costed with the salary on the OTHER team row, capacity counted once', () => {
    const rowA = member('ana', 120_000, { id: 'tA_ana', teamId: 'tA' });
    const rowB = member('ana', 0, { id: 'tB_ana', teamId: 'tB', monthlySalary: undefined });
    const a = allocateLabor({ timeEntries: [entry('ana', 'pX', 30)], members: [rowA, rowB], expenses: [], period, settings });
    expect(a.byProject.get('pX')!.cost).toBe(30_000);          // was 0: last row (no salary) won
    expect(a.payroll.total).toBe(120_000);
    expect(a.byMember.get('ana')!.capacityHours).toBe(120);
    const both = member('ana', 120_000, { id: 'tB_ana', teamId: 'tB' });
    expect(payrollBetween([rowA, both], [], period.start, period.end).total).toBe(120_000); // was 240 000
    expect(laborByProjectForEntries([entry('ana', 'pX', 10)], [rowA, rowB], settings).get('pX')!.cost).toBe(10_000);
  });
});

describe('capacity only over the months the person was employed', () => {
  it('a 1 Nov 2026 hire adds 0 to September; a March hire in a Jan-Dec view counts from March', () => {
    const nov = member('nov', 120_000, { hiredAt: d('2026-11-01T12:00:00') } as any);
    expect(memberEmployedMonthsBetween(nov, period.start, period.end)).toBe(0);
    const mar = member('mar', 120_000, { hiredAt: d('2026-03-01T12:00:00'), createdAt: d('2026-03-01T12:00:00') } as any);
    expect(memberEmployedMonthsBetween(mar, new Date(2026, 0, 1), new Date(2026, 11, 31, 23, 59, 59, 999))).toBeCloseTo(10, 6);
    const a = allocateLabor({ timeEntries: [entry('nov', 'pX', 1)], members: [nov], expenses: [], period, settings });
    expect(a.byMember.get('nov')!.capacityHours).toBe(0);
  });
});

describe('entryHours: the span is the truth (timeTracking.ts rule)', () => {
  it('11:17 -> 13:11 with a stale duration of 2993 min -> 1.9 h', () => {
    expect(entryHours({ startTime: d('2026-09-10T11:17:00'), endTime: d('2026-09-10T13:11:00'), duration: 2993, source: 'timer' } as any)).toBeCloseTo(1.9, 6);
    expect(entryHours({ startTime: d('2026-09-10T11:17:00'), endTime: d('2026-09-10T13:11:00'), duration: 2993 } as any)).toBeCloseTo(1.9, 6);
  });
  it('a paused timer: a duration SHORTER than the span wins', () => {
    expect(entryHours({ startTime: d('2026-09-10T09:00:00'), endTime: d('2026-09-10T11:00:00'), duration: 90, source: 'timer' } as any)).toBe(1.5);
  });
  it('no endTime + duration 500 + source timer -> 0 (running)', () => {
    expect(entryHours({ startTime: d('2026-09-10T09:00:00'), duration: 500, source: 'timer' } as any)).toBe(0);
    expect(entryHours({ startTime: d('2026-09-10T09:00:00'), duration: 500 } as any)).toBe(0);
  });
  it('manual with duration 90 and no endTime -> 1.5 h; daily-report likewise', () => {
    expect(entryHours({ startTime: d('2026-09-10T09:00:00'), duration: 90, source: 'manual' } as any)).toBe(1.5);
    expect(entryHours({ duration: 90, source: 'daily-report' } as any)).toBe(1.5);
  });
  it('allocateLabor skips a running timer that has a duration written', () => {
    const ana = member('ana', 120_000);
    const running = { ...entry('ana', 'pX', 5), endTime: undefined, source: 'timer' } as any;
    const a = allocateLabor({ timeEntries: [running], members: [ana], expenses: [], period, settings });
    expect(a.basis).toBe('none');
  });
});
