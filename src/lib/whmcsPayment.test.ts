import { describe, it, expect } from 'vitest';
import { instalmentKey, isWhmcsInvoice, whmcsPendingPatch, whmcsSyncState } from './whmcsPayment';
import type { Invoice } from '../types';

const whmcs = (over: Partial<Invoice> = {}): Partial<Invoice> => ({ source: 'whmcs', whmcsInvoiceId: '4711', ...over });

describe('isWhmcsInvoice', () => {
  it('needs both the source and the WHMCS id', () => {
    expect(isWhmcsInvoice(whmcs() as Invoice)).toBe(true);
    expect(isWhmcsInvoice({ source: 'whmcs' } as Invoice)).toBe(false);
    expect(isWhmcsInvoice({ source: 'manual', whmcsInvoiceId: '1' } as Invoice)).toBe(false);
    expect(isWhmcsInvoice(null)).toBe(false);
  });
});

describe('whmcsSyncState', () => {
  it('is none for a non-WHMCS invoice whatever the fields say', () => {
    expect(whmcsSyncState({ source: 'manual', whmcsPaymentSyncError: 'x' })).toBe('none');
  });
  it('pending while the queue is non-empty, error once WHMCS refused, synced after a success', () => {
    expect(whmcsSyncState(whmcs({ whmcsPendingPayments: [{ key: 'full' }] }))).toBe('pending');
    expect(whmcsSyncState(whmcs({ whmcsPendingPayments: [{ key: 'full' }], whmcsPaymentSyncError: 'Invoice ID Not Found' }))).toBe('error');
    expect(whmcsSyncState(whmcs({ whmcsPendingPayments: [], whmcsPaymentSyncedAt: new Date() }))).toBe('synced');
    expect(whmcsSyncState(whmcs({ whmcsPaymentSyncError: 'boom' }))).toBe('error');
    expect(whmcsSyncState(whmcs())).toBe('none');
  });
});

describe('whmcsPendingPatch', () => {
  it('appends the entry and stamps whmcsPaymentPendingAt', () => {
    const paidAt = new Date('2026-09-14T10:00:00Z');
    const patch = whmcsPendingPatch(whmcs(), { key: 'full', method: 'Cash', paidAt });
    expect(patch.whmcsPendingPayments).toEqual([{ key: 'full', method: 'Cash', paidAt }]);
    expect(patch.whmcsPaymentPendingAt).toBeInstanceOf(Date);
  });
  it('keeps earlier entries and never duplicates a key (re-mark after un-mark, double click)', () => {
    const inv = whmcs({ whmcsPendingPayments: [{ key: 'p0', amount: 100 }] });
    const patch = whmcsPendingPatch(inv, { key: 'p0', amount: 100 });
    expect(patch.whmcsPendingPayments).toEqual([{ key: 'p0', amount: 100 }]);
    const patch2 = whmcsPendingPatch(inv, { key: 'p1', amount: 50 });
    expect(patch2.whmcsPendingPayments?.map((p) => p.key)).toEqual(['p0', 'p1']);
  });
  it('does not re-queue a key WHMCS already has', () => {
    const inv = whmcs({ whmcsSyncedPaymentKeys: ['full'] });
    expect(whmcsPendingPatch(inv, { key: 'full' }).whmcsPendingPayments).toEqual([]);
  });
  it('instalment keys follow the ledger index', () => {
    expect(instalmentKey(0)).toBe('p0');
    expect(instalmentKey(3)).toBe('p3');
  });
});
