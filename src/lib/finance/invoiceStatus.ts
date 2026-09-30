// Invoice STATUS transitions — what else has to change when the status does.
//
// Three paths write `invoice.status` by hand (the row drawer, the full form,
// the delete dialog's "cancel a WHMCS mirror"), and each carried its own
// partial idea of the bookkeeping. Two things slipped through every one of
// them:
//
//   · reverting a Paid/Partial invoice to Pending/Draft/Cancelled left
//     `paidAt`, `paidAmount`, `partialPayments` AND the `payments` ledger rows
//     in place — the Arkëtimet page kept counting cash that was never received
//     (only the hard-delete cascade cleaned the ledger);
//   · cancelling a `source: 'whmcs'` invoice from the drawer or the form wrote
//     `status: 'Cancelled'` alone. Only the delete dialog set
//     `locallyCancelled`, which is the ONE flag the WHMCS sync honours — so the
//     next sync resurrected the invoice, and its revenue with it.
//
// This module is the single answer to "which fields does this transition
// reset". Pure, unit-tested; the ledger delete itself is the caller's I/O
// (`deleteInvoicePaymentRows`) and is requested via `clearPaymentLedger`.

import type { Invoice } from '../../types';

export type InvoiceStatus = Invoice['status'];

/** Statuses that carry a settlement (money was recorded against them). */
export const SETTLED_INVOICE_STATUSES: ReadonlyArray<InvoiceStatus> = ['Paid', 'Partial'];

/** Statuses that mean "nothing has been received (any more)". */
export const UNSETTLED_INVOICE_STATUSES: ReadonlyArray<InvoiceStatus> =
  ['Pending', 'Draft', 'Cancelled', 'Overdue'];

export interface InvoiceStatusTransition {
  /** Fields to spread into the SAME update as the status change. */
  patch: Record<string, unknown>;
  /** True when the caller must delete the invoice's `payments` ledger rows. */
  clearPaymentLedger: boolean;
  /** True when a settlement is being reverted (for the caller's toast/log). */
  revertsSettlement: boolean;
}

/**
 * Everything a status change implies, beyond `status` itself.
 *
 *  - Paid/Partial → Pending/Draft/Cancelled/Overdue: the settlement is
 *    withdrawn. `paidAt` / `paidAmount` are cleared with explicit `null`
 *    (`removeUndefined()` strips `undefined`, so `undefined` would clear
 *    nothing), `partialPayments` is emptied, and a WHMCS write-back that never
 *    reached WHMCS is dequeued — otherwise the sync would post a payment for
 *    an invoice that is no longer paid. The ledger rows are the caller's to
 *    delete (`clearPaymentLedger`). A payment already pushed to WHMCS is NOT
 *    reversed there — WHMCS is the source of truth for its own invoices.
 *  - Paid → Partial is not a revert (an instalment ledger stays valid).
 *  - Cancelled on a WHMCS mirror sets `locallyCancelled`; leaving Cancelled
 *    clears it, so the sync may follow WHMCS again.
 *
 * The status itself is included in `patch`, so callers can spread it as the
 * whole transition.
 */
export function invoiceStatusTransition(
  invoice: Pick<Invoice, 'status' | 'source' | 'whmcsInvoiceId'> | null | undefined,
  nextStatus: InvoiceStatus,
): InvoiceStatusTransition {
  const prev = invoice?.status;
  const patch: Record<string, unknown> = { status: nextStatus };

  const revertsSettlement =
    !!prev
    && prev !== nextStatus
    && SETTLED_INVOICE_STATUSES.includes(prev)
    && UNSETTLED_INVOICE_STATUSES.includes(nextStatus);

  if (revertsSettlement) {
    patch.paidAt = null;
    patch.paidAmount = null;
    patch.partialPayments = [];
    if (invoice?.source === 'whmcs') {
      patch.whmcsPendingPayments = [];
      patch.whmcsPaymentSyncError = null;
    }
  }

  if (invoice?.source === 'whmcs') {
    if (nextStatus === 'Cancelled') {
      patch.locallyCancelled = true;
    } else if (prev === 'Cancelled') {
      patch.locallyCancelled = false;
    }
  }

  return { patch, clearPaymentLedger: revertsSettlement, revertsSettlement };
}
