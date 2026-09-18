import { describe, expect, it } from 'vitest';
import type { Invoice } from '../../types';
import { deriveInvoicePayments, missingPayments, totalsByMethod, refundState, isFullyRefunded } from './payments';
import { getInvoiceCollectedAll } from './financialAnalytics';

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

  it('produces nothing for a Cancelled invoice, even with instalments', () => {
    // Must agree with getInvoiceCollectedBetween/getInvoiceCollectedAll, which
    // return 0 for Draft and Cancelled: otherwise "Sinkronizo" writes receipts
    // for money the books say was never collected.
    const cancelled = inv({
      id: 'c', status: 'Cancelled', total: 1000,
      partialPayments: [{ amount: 400, paidAt: new Date('2026-06-05') } as any],
    });
    expect(deriveInvoicePayments(cancelled)).toHaveLength(0);
    expect(getInvoiceCollectedAll(cancelled)).toBe(0);

    const draft = inv({ id: 'd', status: 'Draft', total: 1000, paidAmount: 250 });
    expect(deriveInvoicePayments(draft)).toHaveLength(0);
    expect(getInvoiceCollectedAll(draft)).toBe(0);
  });

  it('derives a legacy Partial invoice that has only paidAmount', () => {
    const legacy = inv({
      id: 'L', status: 'Partial', total: 100000, paidAmount: 60000,
      paymentMethod: 'Bank', paidAt: new Date('2026-06-20'),
    });
    const p = deriveInvoicePayments(legacy);
    expect(p).toHaveLength(1);
    expect(p[0].amount).toBe(60000);
    expect(p[0].sourceKey).toBe('L#paidAmount');
    // The ledger and the collected figure agree on the same number.
    expect(p.reduce((s, e) => s + e.amount, 0)).toBe(getInvoiceCollectedAll(legacy));
  });

  it('closes a legacy paidAmount row when the invoice is later marked Paid', () => {
    // The two rows together must equal the total exactly once — no #full on top
    // of the #paidAmount row.
    const paid = inv({ id: 'L', status: 'Paid', total: 100000, paidAmount: 60000, paidAt: new Date('2026-07-01') });
    const p = deriveInvoicePayments(paid);
    expect(p.map(e => e.sourceKey)).toEqual(['L#paidAmount', 'L#pfinal']);
    expect(p.reduce((s, e) => s + e.amount, 0)).toBe(100000);
    expect(getInvoiceCollectedAll(paid)).toBe(100000);
  });

  it('ignores a zero/absent paidAmount on an open invoice', () => {
    expect(deriveInvoicePayments(inv({ status: 'Partial', total: 500, paidAmount: 0 }))).toHaveLength(0);
    expect(deriveInvoicePayments(inv({ status: 'Overdue', total: 500 }))).toHaveLength(0);
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

describe('refunds', () => {
  it('flags a full refund and leaves it out of the method totals', () => {
    const rows = [
      { amount: 100, currency: 'ALL' as const, method: 'Stripe' },
      { amount: 900, currency: 'ALL' as const, method: 'Stripe', refunded: true, refundedCents: 90000 },
    ];
    expect(refundState(rows[1])).toBe('full');
    expect(isFullyRefunded(rows[1])).toBe(true);
    const stripe = totalsByMethod(rows).find(r => r.method === 'Stripe')!;
    expect(stripe.total).toBe(100);
    expect(stripe.count).toBe(1);
  });

  it('flags a partial refund but still counts it (cents are in the charge currency)', () => {
    const row = { amount: 1000, currency: 'ALL' as const, method: 'Stripe', refundedCents: 500 };
    expect(refundState(row)).toBe('partial');
    expect(isFullyRefunded(row)).toBe(false);
    expect(totalsByMethod([row])[0].total).toBe(1000);
  });

  it('treats a row with no refund fields as money held', () => {
    expect(refundState({ amount: 10, currency: 'ALL', method: 'Cash' })).toBe('none');
  });
});
