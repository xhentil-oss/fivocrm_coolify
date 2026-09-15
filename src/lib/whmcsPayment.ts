import type { Invoice, WhmcsPendingPayment } from '../types';

/**
 * WHMCS write-back for payments recorded INSIDE FivoCRM (manual "Paguar",
 * partial instalments). Pure helpers — the network call is `pushWhmcsPayment`.
 *
 * Why a queue on the invoice and not just a fetch:
 *  - the ONLY thing that used to write to WHMCS was the Stripe webhook, so a
 *    payment marked by hand in FivoCRM never reached WHMCS, and the next
 *    `whmcs-sync` overwrote the local status from WHMCS ("Paid" → "Pending"
 *    overnight, `paidAt` erased);
 *  - the queue (`whmcsPendingPayments`) is written in the SAME update as the
 *    status change, so the sync sees "a local payment is awaiting WHMCS" and
 *    preserves the local status until WHMCS confirms — even when the browser
 *    never managed to call the endpoint (network, closed tab). The sync then
 *    drains the queue itself (api/_whmcsSync.ts) — no user action required.
 *
 * `key` is the idempotency token: `'full'` for a whole-invoice settlement,
 * `p<index>` for an instalment (index = position in `partialPayments`). The
 * server derives the WHMCS `transid` from it, and WHMCS refuses a duplicate
 * transid, so a retry can never double-post.
 */

export const isWhmcsInvoice = (inv: Pick<Invoice, 'source' | 'whmcsInvoiceId'> | null | undefined): boolean =>
  !!inv && inv.source === 'whmcs' && !!inv.whmcsInvoiceId;

export type WhmcsSyncState = 'none' | 'pending' | 'error' | 'synced';

/** What the UI should say about this invoice's payment write-back. */
export function whmcsSyncState(inv: Partial<Invoice> | null | undefined): WhmcsSyncState {
  if (!inv || !isWhmcsInvoice(inv as Invoice)) return 'none';
  const pending = Array.isArray(inv.whmcsPendingPayments) ? inv.whmcsPendingPayments : [];
  if (pending.length > 0) return inv.whmcsPaymentSyncError ? 'error' : 'pending';
  if (inv.whmcsPaymentSyncError) return 'error';
  if (inv.whmcsPaymentSyncedAt) return 'synced';
  return 'none';
}

/**
 * The patch to spread into the SAME update that marks the invoice paid (or
 * records an instalment). Never duplicates a key; keeps prior entries.
 */
export function whmcsPendingPatch(
  inv: Partial<Invoice> | null | undefined,
  entry: WhmcsPendingPayment,
): Pick<Invoice, 'whmcsPendingPayments' | 'whmcsPaymentPendingAt'> {
  const existing = Array.isArray(inv?.whmcsPendingPayments) ? inv!.whmcsPendingPayments! : [];
  const synced = Array.isArray(inv?.whmcsSyncedPaymentKeys) ? inv!.whmcsSyncedPaymentKeys! : [];
  const dup = existing.some((p) => p.key === entry.key) || synced.includes(entry.key);
  const next = dup ? existing : [...existing, entry];
  return { whmcsPendingPayments: next, whmcsPaymentPendingAt: new Date() };
}

/** Instalment key from the transaction's instalment index. */
export const instalmentKey = (index: number): string => `p${index}`;

export interface PushWhmcsPaymentResult {
  ok: boolean;
  alreadyRecorded?: boolean;
  error?: string;
}

/**
 * Ask the server to post the queued payment(s) to WHMCS. Never throws — the
 * FivoCRM write has already succeeded by the time this runs, and a red toast
 * that reads like "the payment failed" made users record it twice.
 */
export async function pushWhmcsPayment(
  getIdToken: () => Promise<string>,
  invoiceId: string,
): Promise<PushWhmcsPaymentResult> {
  try {
    const token = await getIdToken();
    const res = await fetch('/api/whmcs-payment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ invoiceId }),
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: json?.error || `HTTP ${res.status}` };
    return { ok: true, alreadyRecorded: !!json?.alreadyRecorded };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Lidhja me serverin dështoi' };
  }
}
