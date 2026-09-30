import { describe, it, expect } from 'vitest';
import { invoiceStatusTransition } from './invoiceStatus';
import type { Invoice } from '../../types';

const inv = (over: Partial<Invoice> = {}) => ({ status: 'Pending', ...over }) as Invoice;

describe('invoiceStatusTransition', () => {
  it('a plain status change touches nothing else', () => {
    const t = invoiceStatusTransition(inv(), 'Overdue');
    expect(t.patch).toEqual({ status: 'Overdue' });
    expect(t.clearPaymentLedger).toBe(false);
  });

  it('reverting Paid → Pending withdraws the settlement and asks for the ledger delete', () => {
    const t = invoiceStatusTransition(inv({ status: 'Paid' }), 'Pending');
    expect(t.patch).toEqual({ status: 'Pending', paidAt: null, paidAmount: null, partialPayments: [] });
    expect(t.clearPaymentLedger).toBe(true);
    expect(t.revertsSettlement).toBe(true);
  });

  it('Partial → Cancelled / Draft revert too; Paid → Partial and Paid → Paid do not', () => {
    expect(invoiceStatusTransition(inv({ status: 'Partial' }), 'Cancelled').clearPaymentLedger).toBe(true);
    expect(invoiceStatusTransition(inv({ status: 'Partial' }), 'Draft').clearPaymentLedger).toBe(true);
    expect(invoiceStatusTransition(inv({ status: 'Paid' }), 'Partial').clearPaymentLedger).toBe(false);
    expect(invoiceStatusTransition(inv({ status: 'Paid' }), 'Paid').clearPaymentLedger).toBe(false);
    expect(invoiceStatusTransition(inv({ status: 'Paid' }), 'Paid').patch).toEqual({ status: 'Paid' });
  });

  it('clears with explicit null, never undefined (removeUndefined would drop it)', () => {
    const t = invoiceStatusTransition(inv({ status: 'Paid' }), 'Pending');
    expect('paidAt' in t.patch && t.patch.paidAt === null).toBe(true);
    expect('paidAmount' in t.patch && t.patch.paidAmount === null).toBe(true);
  });

  it('cancelling a WHMCS mirror sets locallyCancelled so the sync does not resurrect it', () => {
    const t = invoiceStatusTransition(inv({ source: 'whmcs', whmcsInvoiceId: '1' }), 'Cancelled');
    expect(t.patch.locallyCancelled).toBe(true);
    // A FivoCRM invoice never carries the flag.
    expect(invoiceStatusTransition(inv(), 'Cancelled').patch.locallyCancelled).toBeUndefined();
  });

  it('un-cancelling a WHMCS mirror clears the flag; other transitions leave it alone', () => {
    expect(invoiceStatusTransition(inv({ source: 'whmcs', status: 'Cancelled' }), 'Pending').patch.locallyCancelled).toBe(false);
    expect(invoiceStatusTransition(inv({ source: 'whmcs', status: 'Pending' }), 'Paid').patch.locallyCancelled).toBeUndefined();
  });

  it('a reverted WHMCS payment is dequeued from the write-back', () => {
    const t = invoiceStatusTransition(inv({ source: 'whmcs', status: 'Paid' }), 'Cancelled');
    expect(t.patch.whmcsPendingPayments).toEqual([]);
    expect(t.patch.whmcsPaymentSyncError).toBeNull();
    expect(t.patch.locallyCancelled).toBe(true);
  });
});
