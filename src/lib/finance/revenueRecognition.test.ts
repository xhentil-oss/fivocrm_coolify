import { describe, it, expect } from 'vitest';
import type { Invoice, Project, TimeEntry } from '../../types';
import {
  declaredRecognitionMethod,
  recognitionMethodOf,
  projectEarnedInPeriod,
  projectEarnedToDate,
  projectWip,
} from './revenueRecognition';

const d = (iso: string) => new Date(iso);
const project = (extra: Partial<Project> = {}): Project => ({
  id: 'web', name: 'Website', status: 'Active', budget: 600_000, currency: 'ALL', billingType: 'one-time',
  createdAt: d('2026-09-15'), updatedAt: d('2026-09-15'), createdByUserId: null, ...extra,
} as Project);
const hours = (h: number, day: string): TimeEntry => ({
  id: `${day}-${h}`, userId: 'u', projectId: 'web', startTime: d(`${day}T09:00:00`), endTime: d(`${day}T18:00:00`),
  duration: h * 60, createdAt: d(day), updatedAt: d(day),
} as TimeEntry);
const month = (y: number, m: number) => ({ start: new Date(y, m - 1, 1), end: new Date(y, m, 0, 23, 59, 59, 999) });

describe('method resolution', () => {
  it('monthly billing always means the retainer rule', () => {
    expect(declaredRecognitionMethod(project({ billingType: 'monthly' }))).toBe('monthly');
  });
  it('unset → effort with planned hours, straight-line with dates, else on-completion', () => {
    expect(declaredRecognitionMethod(project({ plannedHours: 300 }))).toBe('effort');
    expect(declaredRecognitionMethod(project({ plannedRoles: [{ role: 'SMM', plannedHours: 10, costRate: 1 }] }))).toBe('effort');
    expect(declaredRecognitionMethod(project({ startDate: d('2026-09-15'), endDate: d('2026-12-14') }))).toBe('straight-line');
    expect(declaredRecognitionMethod(project())).toBe('on-completion');
  });
  it('a declared effort method with no plan degrades honestly', () => {
    expect(recognitionMethodOf(project({ recognitionMethod: 'effort' }))).toBe('on-completion');
    expect(recognitionMethodOf(project({ recognitionMethod: 'effort', startDate: d('2026-09-15'), endDate: d('2026-12-14') }))).toBe('straight-line');
  });
});

describe('projectEarnedInPeriod — the §11 website', () => {
  const p = project({ plannedHours: 300, startDate: d('2026-09-15'), endDate: d('2026-12-14') });
  const entries = [hours(80, '2026-09-20'), hours(160, '2026-10-15'), hours(60, '2026-12-05')];

  it('earns 160k / 320k / 0 / 120k across the four months', () => {
    expect(Math.round(projectEarnedInPeriod(p, entries, month(2026, 9)))).toBe(160_000);
    expect(Math.round(projectEarnedInPeriod(p, entries, month(2026, 10)))).toBe(320_000);
    expect(projectEarnedInPeriod(p, entries, month(2026, 11))).toBe(0);
    const done = project({ ...p, status: 'Completed', lastCompletedAt: d('2026-12-20') });
    expect(Math.round(projectEarnedInPeriod(done, entries, month(2026, 12)))).toBe(120_000);
  });

  it('never exceeds the contract when hours overrun', () => {
    const over = [...entries, hours(200, '2026-12-08')];
    const total = [9, 10, 11, 12].reduce((s, m) => s + projectEarnedInPeriod(p, over, month(2026, m)), 0);
    expect(Math.round(total)).toBe(600_000);
  });

  it('a retainer earns its fee per active month, EUR converted to ALL', () => {
    const ret = project({ billingType: 'monthly', budget: 500, currency: 'EUR', createdAt: d('2026-01-10') });
    const fee = projectEarnedInPeriod(ret, [], month(2026, 9));
    expect(fee).toBeGreaterThan(0);
    expect(projectEarnedInPeriod(ret, [], { start: new Date(2026, 8, 1), end: new Date(2026, 9, 31, 23, 59, 59) })).toBeCloseTo(fee * 2, 6);
  });

  it('legacy: no plan and no dates → whole fee in the completion month only', () => {
    const legacy = project({ status: 'Completed', lastCompletedAt: d('2026-10-20') });
    expect(projectEarnedInPeriod(legacy, entries, month(2026, 9))).toBe(0);
    expect(projectEarnedInPeriod(legacy, entries, month(2026, 10))).toBe(600_000);
    expect(projectEarnedInPeriod(legacy, entries, month(2026, 11))).toBe(0);
  });
});

describe('projectWip — the four figures', () => {
  const p = project({ plannedHours: 300 });
  const entries = [hours(150, '2026-09-20')];
  const inv = (total: number, paid: number, day: string): Invoice => ({
    id: `i${day}`, projectId: 'web', customerId: 'c', amount: total, total, status: paid >= total ? 'Paid' : paid > 0 ? 'Partial' : 'Pending',
    paidAmount: paid, invoiceDate: d(day), paidAt: paid > 0 ? d(day) : undefined, currency: 'ALL',
    createdAt: d(day), updatedAt: d(day), createdByUserId: null,
  } as Invoice);

  it('earned 300k, billed 400k, collected 200k → deferred 100k, unbilled 0', () => {
    const w = projectWip(p, entries, [inv(400_000, 200_000, '2026-09-25')], d('2026-09-30T23:59:59'));
    expect(w.contractValue).toBe(600_000);
    expect(w.earnedToDate).toBe(300_000);
    expect(w.billedToDate).toBe(400_000);
    expect(w.collectedToDate).toBe(200_000);
    expect(w.deferred).toBe(100_000);
    expect(w.unbilledEarned).toBe(0);
    expect(w.percentComplete).toBe(50);
  });
  it('work ahead of invoicing shows as unbilled earned revenue', () => {
    const w = projectWip(p, entries, [], d('2026-09-30'));
    expect(w.unbilledEarned).toBe(300_000);
    expect(projectEarnedToDate(p, entries, d('2026-09-30'))).toBe(300_000);
  });
});
