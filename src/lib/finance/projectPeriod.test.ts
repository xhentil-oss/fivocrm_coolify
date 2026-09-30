import { describe, it, expect } from 'vitest';
import type { Project } from '../../types';
import { retainerRevenueInPeriod, monthCoverage } from './projectPeriod';

const p = (extra: Partial<Project> = {}): Project => ({
  id: 'r', name: 'R', status: 'Active', budget: 50_000, currency: 'ALL', billingType: 'monthly', isRecurring: true,
  createdAt: new Date(2026, 0, 10), updatedAt: new Date(2026, 0, 10), createdByUserId: null, ...extra,
} as Project);
const monthEnd = (m: number) => new Date(2026, m + 1, 0, 23, 59, 59, 999);

describe('retainerRevenueInPeriod', () => {
  it('a period ending on a month end is whole months — the legacy answer, byte for byte', () => {
    expect(retainerRevenueInPeriod(p(), 50_000, new Date(2026, 0, 1), monthEnd(8), 9)).toEqual({ revenue: 450_000, activeMonths: 9 });
    // 23:59:59 without millis is a month end too (the 1 s tolerance monthCoverage documents)
    expect(retainerRevenueInPeriod(p(), 50_000, new Date(2026, 8, 1), new Date(2026, 8, 30, 23, 59, 59), 1)).toEqual({ revenue: 50_000, activeMonths: 1 });
  });

  it('a month the period END cuts short earns its elapsed share', () => {
    const end = new Date(2026, 8, 10, 12);
    const share = monthCoverage(2026, 8, new Date(2026, 8, 1), end);
    expect(share).toBeCloseTo(9.5 / 30, 9);
    const one = retainerRevenueInPeriod(p(), 50_000, new Date(2026, 8, 1), end, 1);
    expect(one.activeMonths).toBeCloseTo(share, 9);
    expect(one.revenue).toBeCloseTo(50_000 * share, 6);
    // two whole months + the partial third
    const three = retainerRevenueInPeriod(p(), 50_000, new Date(2026, 6, 1), end, 3);
    expect(three.activeMonths).toBeCloseTo(2 + share, 9);
  });

  it("the retainer's OWN end mid-month keeps the whole month — the fee was billed whole", () => {
    const cancelled = p({ status: 'Cancelled', isRecurring: false, updatedAt: new Date(2026, 8, 10) });
    expect(retainerRevenueInPeriod(cancelled, 50_000, new Date(2026, 8, 1), new Date(2026, 8, 20, 12), 1)).toEqual({ revenue: 50_000, activeMonths: 1 });
  });

  it('a span that ended before the period earns nothing; a project created mid-month earns its first month whole', () => {
    const dead = p({ status: 'Cancelled', isRecurring: false, updatedAt: new Date(2026, 1, 20) });
    expect(retainerRevenueInPeriod(dead, 50_000, new Date(2026, 8, 1), monthEnd(8), 1)).toEqual({ revenue: 0, activeMonths: 0 });
    const fresh = p({ createdAt: new Date(2026, 8, 15) });
    expect(retainerRevenueInPeriod(fresh, 50_000, new Date(2026, 8, 1), monthEnd(8), 1)).toEqual({ revenue: 50_000, activeMonths: 1 });
  });
});
