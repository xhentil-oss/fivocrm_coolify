// Payment ledger derivation. Invoices remain the system of record for how much
// was paid (partialPayments[] / paidAmount / status), but every payment event is
// mirrored into the `payments` collection with a stable `sourceKey` so backfill
// and real-time writes converge without duplicating rows.

import type { Invoice, Payment } from '../../types';
import { parseDate } from './financialAnalytics';
import { toAll } from '../utils';

/** A payment event derived from an invoice, ready to persist (no id/createdAt). */
export type DerivedPayment = Omit<Payment, 'id' | 'createdAt' | 'createdByUserId'>;

function baseFields(inv: Invoice): Pick<DerivedPayment, 'invoiceId' | 'invoiceNumber' | 'customerId' | 'currency' | 'teamId' | 'businessId'> {
  return {
    invoiceId: inv.id,
    invoiceNumber: inv.invoiceNumber,
    customerId: inv.customerId,
    currency: (inv as any).currency,
    teamId: inv.teamId,
    businessId: (inv as any).businessId,
  };
}

/**
 * The canonical set of payment events for an invoice:
 *  - each partialPayments[i] → one event (`#p{i}`)
 *  - if Paid and partials don't cover the total → a final event (`#pfinal`)
 *  - if Paid with no partials → one full-total event (`#full`)
 * Unpaid/Draft/Cancelled invoices produce nothing.
 */
export function deriveInvoicePayments(inv: Invoice): DerivedPayment[] {
  const out: DerivedPayment[] = [];
  const currencyNote = (inv as any).currency as string | undefined;
  const partials = Array.isArray(inv.partialPayments) ? inv.partialPayments : [];
  const totalNative = (inv.total ?? inv.amount ?? 0);

  if (partials.length > 0) {
    let sum = 0;
    partials.forEach((p, i) => {
      const amount = Number(p.amount) || 0;
      sum += amount;
      out.push({
        ...baseFields(inv),
        amount,
        method: p.method,
        paidAt: parseDate(p.paidAt) || parseDate(inv.paidAt) || parseDate(inv.createdAt) || new Date(0),
        note: p.note,
        source: 'partial',
        sourceKey: `${inv.id}#p${i}`,
      });
    });
    // Marked fully Paid but partials fall short → a closing payment for the rest.
    if (inv.status === 'Paid' && sum < totalNative - 0.5) {
      out.push({
        ...baseFields(inv),
        amount: totalNative - sum,
        method: inv.paymentMethod,
        paidAt: parseDate(inv.paidAt) || parseDate(inv.createdAt) || new Date(0),
        source: 'full',
        sourceKey: `${inv.id}#pfinal`,
      });
    }
    return out;
  }

  // No partials but fully paid → a single full-total payment.
  if (inv.status === 'Paid') {
    out.push({
      ...baseFields(inv),
      amount: totalNative,
      method: inv.paymentMethod,
      paidAt: parseDate(inv.paidAt) || parseDate(inv.createdAt) || new Date(0),
      source: (inv as any).source === 'stripe' ? 'stripe' : 'full',
      sourceKey: `${inv.id}#full`,
    });
    void currencyNote;
  }
  return out;
}

/** All missing payment events across invoices, given the sourceKeys already stored. */
export function missingPayments(invoices: Invoice[], existingKeys: Set<string>): DerivedPayment[] {
  const out: DerivedPayment[] = [];
  for (const inv of invoices) {
    for (const p of deriveInvoicePayments(inv)) {
      if (!existingKeys.has(p.sourceKey)) out.push(p);
    }
  }
  return out;
}

export interface MethodTotal { method: string; count: number; total: number }

/** Totals grouped by payment method, normalised to ALL. */
export function totalsByMethod(payments: Pick<Payment, 'amount' | 'currency' | 'method'>[]): MethodTotal[] {
  const map = new Map<string, MethodTotal>();
  for (const p of payments) {
    const method = p.method || 'Tjetër';
    const row = map.get(method) || { method, count: 0, total: 0 };
    row.count += 1;
    row.total += toAll(p.amount || 0, p.currency);
    map.set(method, row);
  }
  return Array.from(map.values()).sort((a, b) => b.total - a.total);
}
