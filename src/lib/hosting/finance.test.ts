import { describe, it, expect } from 'vitest';
import { hostingMonthlyRecurringRevenue, hostingRenewalsInWindow, domainBillsAgain } from './finance';
import type { Domain, Subscription } from '../../types';

const sub = (over: Partial<Subscription> = {}) => ({
  id: 's1', source: 'fivocrm', status: 'Active', billingCycle: 'monthly', recurringAmount: 1_000,
  currency: 'ALL', domain: 'a.al', productName: 'Hosting', ...over,
}) as unknown as Subscription;

const dom = (over: Partial<Domain> = {}) => ({
  id: 'd1', source: 'fivocrm', status: 'Active', domainName: 'a.al', recurringAmount: 12_000,
  currency: 'ALL', autoRenew: true, ...over,
}) as unknown as Domain;

describe('hostingMonthlyRecurringRevenue', () => {
  it('includes the domains we renew (yearly → /12)', () => {
    expect(hostingMonthlyRecurringRevenue([sub()], [dom()])).toBe(1_000 + 1_000);
    // Back-compat: no domains passed → subscriptions only.
    expect(hostingMonthlyRecurringRevenue([sub()])).toBe(1_000);
  });

  it('excludes WHMCS mirrors, auto-renew off and terminal domains', () => {
    expect(hostingMonthlyRecurringRevenue([], [
      dom({ source: 'whmcs' }), dom({ autoRenew: false }), dom({ status: 'Expired' }), dom({ status: 'Pending' }),
    ])).toBe(0);
    expect(domainBillsAgain(dom())).toBe(true);
  });
});

describe('hostingRenewalsInWindow', () => {
  const start = new Date('2026-11-01T00:00:00Z');
  const end = new Date('2026-11-30T23:59:59Z');

  it('does not count a renewal whose invoice already exists (it is a receivable now)', () => {
    const due = new Date('2026-11-10T12:00:00Z');
    const r = hostingRenewalsInWindow(
      [sub({ nextDueDate: due, lastInvoicedDueKey: '2026-11-10' } as any), sub({ id: 's2', nextDueDate: due } as any)],
      [dom({ expiryDate: due, lastInvoicedExpiryKey: '2026-11-10' } as any), dom({ id: 'd2', expiryDate: due } as any)],
      start, end,
    );
    expect(r.rows.map(x => x.id).sort()).toEqual(['d2', 's2']);
    expect(r.totalAll).toBe(1_000 + 12_000);
    expect(r.alreadyInvoicedAll).toBe(1_000 + 12_000);
  });
});
