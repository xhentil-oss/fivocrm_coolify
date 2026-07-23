import { describe, expect, it } from 'vitest';
import type { Invoice } from '../../types';
import { deriveInvoicePayments, missingPayments, totalsByMethod } from './payments';

function inv(p: Partial<Invoice>): Invoice {
  return { id: p.id || 'i1', amount: p.amount ?? 0, status: p.status ?? 'Pending',
    createdAt: p.createdAt ?? new Date('2026-06-01'), ...p } as Invoice;
}

describe('deriveInvoicePayments', () => {
  it('produces nothing for unpaid invoices', () => {
    expect(deriveInvoicePayments(inv({ status: 'Pending', total: 100 }))).toHaveLength(0);
    expect(deriveInvoicePayments(inv({ status: 'Draft', total: 100 }))).toHaveLength(0);
  });

  it('produces one full-total event for a paid invoice with no partials', () => {
    const p = deriveInvoicePayments(inv({ id: 'x', status: 'Paid', total: 500, paymentMethod: 'Bank', paidAt: new Date('2026-06-10') }));
    expect(p).toHaveLength(1);
    expect(p[0].amount).toBe(500);
    expect(p[0].method).toBe('Bank');
    expect(p[0].sourceKey).toBe('x#full');
  });

  it('maps each partial payment and closes the remainder when Paid', () => {
    const p = deriveInvoicePayments(inv({
      id: 'y', status: 'Paid', total: 1000, paymentMethod: 'Cash',
      partialPayments: [
        { amount: 400, paidAt: new Date('2026-06-05'), method: 'Cash' } as any,
        { amount: 300, paidAt: new Date('2026-06-15'), method: 'Bank' } as any,
      ],
    }));
    expect(p).toHaveLength(3);
    expect(p.map(e => e.sourceKey)).toEqual(['y#p0', 'y#p1', 'y#pfinal']);
    expect(p[2].amount).toBe(300); // 1000 − (400+300)
  });

  it('does not add a closing event when partials already cover the total', () => {
    const p = deriveInvoicePayments(inv({
      id: 'z', status: 'Partial', total: 700,
      partialPayments: [{ amount: 700, paidAt: new Date('2026-06-05') } as any],
    }));
    expect(p).toHaveLength(1);
    expect(p[0].sourceKey).toBe('z#p0');
  });
});

describe('missingPayments', () => {
  it('only returns events whose sourceKey is not already stored', () => {
    const invoices = [inv({ id: 'a', status: 'Paid', total: 100 })];
    expect(missingPayments(invoices, new Set())).toHaveLength(1);
    expect(missingPayments(invoices, new Set(['a#full']))).toHaveLength(0);
  });
});

describe('totalsByMethod', () => {
  it('groups and normalises to ALL', () => {
    const rows = totalsByMethod([
      { amount: 100, currency: 'ALL', method: 'Cash' },
      { amount: 1, currency: 'EUR', method: 'Cash' },   // ×100 default
      { amount: 50, currency: 'ALL', method: 'Bank' },
    ]);
    const cash = rows.find(r => r.method === 'Cash')!;
    expect(cash.count).toBe(2);
    expect(cash.total).toBe(200); // 100 + 100
  });
});
