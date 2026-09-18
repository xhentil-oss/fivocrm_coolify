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
 *  - no instalment array but a legacy `paidAmount` → one event (`#paidAmount`)
 *  - if Paid and the above fall short of the total → a closing event (`#pfinal`)
 *  - if Paid with nothing recorded at all → one full-total event (`#full`)
 * Draft and Cancelled invoices produce nothing.
 *
 * This set must agree, row for row, with `getInvoiceCollectedBetween()` in
 * `financialAnalytics.ts` — that helper is the one definition of "cash collected
 * in a window", and the ledger is only a mirror of it. Two gaps used to break
 * that: the instalments of a Draft/Cancelled invoice were emitted as receipts
 * (the helper returns 0 for both), and a legacy `Partial` invoice carrying only
 * `paidAmount` was counted as collected but never entered the ledger.
 */
export function deriveInvoicePayments(inv: Invoice): DerivedPayment[] {
  const out: DerivedPayment[] = [];
  const currencyNote = (inv as any).currency as string | undefined;
  const partials = Array.isArray(inv.partialPayments) ? inv.partialPayments : [];
  const totalNative = (inv.total ?? inv.amount ?? 0);

  // A voided or never-issued invoice banked nothing, whatever it carries in
  // `partialPayments`/`paidAmount`. Without this the "Sinkronizo" button wrote
  // receipts for a cancelled invoice's instalments while Financat counted 0.
  if (inv.status === 'Draft' || inv.status === 'Cancelled') return out;

  let recorded = 0;

  if (partials.length > 0) {
    partials.forEach((p, i) => {
      const amount = Number(p.amount) || 0;
      recorded += amount;
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
  } else if ((Number(inv.paidAmount) || 0) > 0) {
    // Legacy / imported row: money banked against the invoice with no instalment
    // history. `recordInvoicePartialPayment` writes both `partialPayments` and
    // `paidAmount`, so only pre-existing and imported (WHMCS) invoices land here —
    // but `getInvoiceCollectedBetween` counts exactly this case, so the ledger has
    // to as well or the two pages disagree about the same month.
    const amount = Number(inv.paidAmount) || 0;
    recorded = amount;
    out.push({
      ...baseFields(inv),
      amount,
      method: inv.paymentMethod,
      paidAt: parseDate(inv.paidAt) || parseDate(inv.createdAt) || new Date(0),
      source: 'partial',
      sourceKey: `${inv.id}#paidAmount`,
    });
  }

  if (inv.status === 'Paid') {
    if (recorded <= 0) {
      // Nothing recorded → a single full-total payment (the ordinary case).
      out.push({
        ...baseFields(inv),
        amount: totalNative,
        method: inv.paymentMethod,
        paidAt: parseDate(inv.paidAt) || parseDate(inv.createdAt) || new Date(0),
        source: (inv as any).source === 'stripe' ? 'stripe' : 'full',
        sourceKey: `${inv.id}#full`,
      });
    } else if (recorded < totalNative - 0.5) {
      // Marked fully Paid but what is recorded falls short → close the rest.
      out.push({
        ...baseFields(inv),
        amount: totalNative - recorded,
        method: inv.paymentMethod,
        paidAt: parseDate(inv.paidAt) || parseDate(inv.createdAt) || new Date(0),
        source: 'full',
        sourceKey: `${inv.id}#pfinal`,
      });
    }
  }

  void currencyNote;
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

/** A ledger row as the Stripe webhook leaves it after a refund. The fields are
 *  written by `api/stripe-webhook.ts` and were read by nothing at all, so a fully
 *  refunded receipt stayed in every Arkëtimet total with no badge anywhere. */
export type RefundableRow = Pick<Payment, 'amount' | 'currency' | 'method'> & {
  refunded?: boolean;
  refundedCents?: number;
};

export type RefundState = 'none' | 'partial' | 'full';

/** How much of a receipt Stripe gave back.
 *
 *  `refundedCents` is denominated in the STRIPE charge currency, which need not
 *  be the invoice's native currency (an ALL invoice is charged in EUR), so a
 *  PARTIAL refund cannot be netted off the row safely — it is flagged for the
 *  human and still counted. A FULL refund (`refunded: true`, stamped only when
 *  the charge is entirely reversed) is unambiguous: nothing was banked. */
export function refundState(p: RefundableRow): RefundState {
  if (p.refunded === true) return 'full';
  return (Number(p.refundedCents) || 0) > 0 ? 'partial' : 'none';
}

/** Is this receipt money the business no longer holds? (Excluded from totals.) */
export function isFullyRefunded(p: RefundableRow): boolean {
  return refundState(p) === 'full';
}

export interface MethodTotal { method: string; count: number; total: number }

/** Totals grouped by payment method, normalised to ALL. Fully refunded rows are
 *  not money collected, so they are left out of both the count and the total. */
export function totalsByMethod(payments: RefundableRow[]): MethodTotal[] {
  const map = new Map<string, MethodTotal>();
  for (const p of payments) {
    if (isFullyRefunded(p)) continue;
    const method = p.method || 'Tjetër';
    const row = map.get(method) || { method, count: 0, total: 0 };
    row.count += 1;
    row.total += toAll(p.amount || 0, p.currency);
    map.set(method, row);
  }
  return Array.from(map.values()).sort((a, b) => b.total - a.total);
}
