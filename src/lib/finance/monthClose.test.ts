import { describe, it, expect } from 'vitest';
import {
  monthKeyOf,
  monthCloseBlockReason,
  isMonthClosable,
  closeMonthPatch,
  reopenMonthPatch,
  readCloseSnapshot,
  resultFromSnapshot,
  snapshotNetDrift,
} from './monthClose';
import type { ClientProfitabilityResult } from './clientProfitability';

describe('monthKeyOf (Europe/Tirane)', () => {
  it('reads the business calendar, not UTC', () => {
    // 22:30 UTC on 31 Aug = 00:30 local on 1 Sep (CEST)
    expect(monthKeyOf(new Date('2026-08-31T22:30:00Z'))).toBe('2026-09');
    expect(monthKeyOf(new Date('2026-08-31T21:30:00Z'))).toBe('2026-08');
  });
});

describe('monthCloseBlockReason', () => {
  const now = new Date('2026-09-10T08:00:00Z');
  it('a month that has ended can be closed', () => {
    expect(monthCloseBlockReason('2026-08', now)).toBeNull();
    expect(monthCloseBlockReason('2025-12', now)).toBeNull();
    expect(isMonthClosable('2026-08', now)).toBe(true);
  });
  it('the running month cannot — closing on the 10th would lock the rest of it', () => {
    expect(monthCloseBlockReason('2026-09', now)).toBe('running-month');
    expect(isMonthClosable('2026-09', now)).toBe(false);
  });
  it('the running month becomes closable the moment the next one starts, locally', () => {
    // 22:30 UTC on 30 Sep is already 1 Oct in Tirane
    expect(monthCloseBlockReason('2026-09', new Date('2026-09-30T22:30:00Z'))).toBeNull();
    expect(monthCloseBlockReason('2026-09', new Date('2026-09-30T21:30:00Z'))).toBe('running-month');
  });
  it('a future month and a non-month period are refused', () => {
    expect(monthCloseBlockReason('2026-10', now)).toBe('future-month');
    expect(monthCloseBlockReason(null, now)).toBe('invalid-key');
    expect(monthCloseBlockReason('2026-9', now)).toBe('invalid-key');
    expect(monthCloseBlockReason('year', now)).toBe('invalid-key');
  });
});

describe('close / reopen patches', () => {
  it('a close never carries the reopen fields, so an update keeps them', () => {
    const p = closeMonthPatch({ businessId: 'b1', periodKey: '2026-08', userId: 'u1', snapshot: { totals: {} }, warnings: ['x'], at: new Date('2026-09-02T08:00:00Z') });
    expect(p).toEqual({
      businessId: 'b1', periodKey: '2026-08', locked: true, closedAt: new Date('2026-09-02T08:00:00Z'),
      closedByUserId: 'u1', snapshot: { totals: {} }, warnings: ['x'],
    });
    expect('reopenedAt' in p).toBe(false);
  });
  it('a reopen unlocks and records who, without touching closedAt/snapshot', () => {
    const p = reopenMonthPatch('u2', new Date('2026-09-05T08:00:00Z'));
    expect(p).toEqual({ locked: false, reopenedAt: new Date('2026-09-05T08:00:00Z'), reopenedByUserId: 'u2' });
    expect(reopenMonthPatch(undefined).reopenedByUserId).toBeNull();
  });
});

const snapshot = {
  basis: 'hours',
  overheadBasis: 'labor-hours',
  totals: { earned: 1000, passThrough: 0, netRevenue: 1000, directLabor: 400, directExpenses: 100, grossProfit: 500, grossMarginPct: 50, overhead: 200, netProfit: 300, netMarginPct: 30, hours: 10, invoiced: 900, collected: 800, outstanding: 100, unbilledEarned: 100, contractValue: 0 },
  company: { otherFixed: 150, payroll: 600, payrollBasis: 'recorded', unabsorbedLabor: 200, overheadPool: 350, operatingProfit: 250 },
  clients: [
    { customerId: 'c1', name: 'Alfa', earned: 600, directLabor: 200, directExpenses: 50, grossProfit: 350, overhead: 100, netProfit: 250, hours: 6, invoiced: 600, collected: 500, outstanding: 100, category: 'A', status: 'healthy' },
    { customerId: 'c2', name: 'Beta', earned: 400, directLabor: 200, directExpenses: 50, grossProfit: 150, overhead: 100, netProfit: 50, hours: 4, invoiced: 300, collected: 300, outstanding: 0, category: 'C', status: 'watch' },
  ],
  warnings: { membersWithoutRate: [], projectsWithoutPlan: ['P'], hoursWithoutProject: 0, entriesWithoutMember: 0, unlinkedInvoices: { count: 0, amount: 0 }, expensesWithoutProject: { count: 0, amount: 0 }, customersWithoutProjects: 0 },
};

const live = {
  period: { start: new Date('2026-08-01'), end: new Date('2026-08-31') },
  settings: { marginThresholds: { healthy: 55, watch: 40 } },
  rows: [],
  totals: { contractValue: 0, earned: 1200, passThrough: 0, netRevenue: 1200, directLabor: 400, directExpenses: 100, grossProfit: 700, grossMarginPct: 58, overhead: 200, netProfit: 500, netMarginPct: 42, hours: 10, invoiced: 900, collected: 800, outstanding: 100, unbilledEarned: 300 },
  company: { otherFixed: 150, payroll: 600, payrollBasis: 'recorded', absorbedLabor: 400, unabsorbedLabor: 200, overAbsorbedLabor: 0, internalProjectLabor: 0, overheadPool: 350, unallocatedOverhead: 0, operatingProfit: 450, operatingMarginPct: 37 },
  labor: {} as any,
  basis: 'hours',
  revenueBasis: 'earned',
  overheadBasis: 'labor-hours',
  warnings: { membersWithoutRate: ['X'], projectsWithoutPlan: [], hoursWithoutProject: 0, entriesWithoutMember: 0, unlinkedInvoices: { count: 0, amount: 0 }, expensesWithoutProject: { count: 0, amount: 0 }, customersWithoutProjects: 0 },
} as unknown as ClientProfitabilityResult;

describe('reading the snapshot back', () => {
  it('parses a stored snapshot and refuses junk', () => {
    const s = readCloseSnapshot(snapshot)!;
    expect(s.clients.map(c => c.name)).toEqual(['Alfa', 'Beta']);
    expect(s.totals.netProfit).toBe(300);
    expect(s.company.payrollBasis).toBe('recorded');
    expect(readCloseSnapshot(null)).toBeNull();
    expect(readCloseSnapshot('x')).toBeNull();
    expect(readCloseSnapshot({})).toBeNull();
  });
  it('resultFromSnapshot renders the CLOSED figures, not the live ones', () => {
    const r = resultFromSnapshot(snapshot, live)!;
    expect(r.totals.earned).toBe(1000);
    expect(r.totals.netProfit).toBe(300);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toMatchObject({ customerId: 'c1', earned: 600, netProfit: 250, hours: 6, status: 'healthy', category: 'A', projects: [], byRole: {} });
    // derived per row from the frozen figures
    expect(r.rows[1].grossMarginPct).toBeCloseTo(37.5);
    expect(r.rows[0].effectiveHourlyRevenue).toBe(100);
    // snapshot warnings win over live, settings stay live
    expect(r.warnings.projectsWithoutPlan).toEqual(['P']);
    expect(r.settings).toBe(live.settings);
    expect(r.company.operatingProfit).toBe(250);
    expect(r.company.absorbedLabor).toBe(400); // not in the snapshot → live
  });
  it('totals fall back to the row sums for a snapshot without them', () => {
    const r = resultFromSnapshot({ clients: snapshot.clients }, live)!;
    expect(r.totals.earned).toBe(1000);
    expect(r.totals.netProfit).toBe(300);
    expect(r.totals.hours).toBe(10);
    expect(r.totals.grossMarginPct).toBe(50);
  });
  it('snapshotNetDrift is live − closed, null without a snapshot', () => {
    expect(snapshotNetDrift(snapshot, live)).toBe(200);
    expect(snapshotNetDrift({ clients: snapshot.clients }, live)).toBe(200);
    expect(snapshotNetDrift(undefined, live)).toBeNull();
    expect(snapshotNetDrift({ totals: {} }, live)).toBeNull();
  });
});
