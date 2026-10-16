import type { Invoice } from '../../types';

// ── The invoice money box, computed ONE way ──────────────────────────────────
//
// Subtotal → discount → tax → total was hand-rolled three times (the form, the
// detail view, the PDF) and the three disagreed: only the form clamped a FIXED
// discount to the subtotal, so a 150 L discount on a 100 L subtotal printed
// "−150.00" under a total of 0 — a box that visibly does not add up — and only
// the form clamped a percentage to 100.
export interface InvoiceTotalsInput {
  subtotal: number;
  discount?: number | null;
  discountType?: string | null;
  tax?: number | null;
}

export interface InvoiceTotals {
  subtotal: number;
  discountAmount: number;
  tax: number;
  total: number;
}

/** Round to cents (half away from zero, float-noise safe). */
export function roundToCents(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.sign(n) * Math.round((Math.abs(n) + Number.EPSILON) * 100) / 100;
}

/**
 * Every figure is rounded to cents: an unrounded box (e.g. 33.333… after a
 * percentage discount) stored a total no payment could ever match exactly, so
 * a fully-paid invoice read as 0.0033 outstanding and never flipped to Paid.
 */
export function computeInvoiceTotals(input: InvoiceTotalsInput): InvoiceTotals {
  const subtotal = roundToCents(Number(input.subtotal) || 0);
  const tax = roundToCents(Number(input.tax) || 0);
  const raw = Number(input.discount) || 0;
  const discountAmount = raw <= 0
    ? 0
    : input.discountType === 'percent'
      ? subtotal * (Math.min(raw, 100) / 100)
      // A discount can never exceed what is being discounted.
      : Math.min(raw, Math.max(0, subtotal));
  const discount = roundToCents(discountAmount);
  return { subtotal, discountAmount: discount, tax, total: roundToCents(subtotal - discount + tax) };
}

/**
 * The totals box of a STORED invoice — used by the detail view and the PDF, so
 * the two can never print different arithmetic for the same document.
 *
 * `subtotal` is missing on legacy invoices. The PDF used to fall back to
 * `invoice.total`, which prints "Nëntotali = Totali" and then a discount line
 * below it, i.e. a box that contradicts itself. Reconstructing the subtotal
 * from the total instead keeps the box internally consistent, and the TOTAL
 * line stays the stored total — that is the figure the client owes and the one
 * every payment helper works from.
 */
export function storedInvoiceTotals(invoice: Pick<Invoice,
  'subtotal' | 'total' | 'amount' | 'discount' | 'discountType' | 'tax'>): InvoiceTotals {
  const total = Number(invoice.total ?? invoice.amount ?? 0) || 0;
  const tax = Number(invoice.tax) || 0;
  const rawDiscount = Number(invoice.discount) || 0;
  const percent = invoice.discountType === 'percent';
  const stored = Number(invoice.subtotal);

  let subtotal: number;
  if (Number.isFinite(stored) && stored > 0) {
    subtotal = stored;
  } else {
    const net = total - tax; // = subtotal − discount
    const pct = Math.min(Math.max(rawDiscount, 0), 100);
    subtotal = rawDiscount <= 0
      ? net
      : percent
        ? (pct >= 100 ? net : net / (1 - pct / 100))
        : net + rawDiscount;
  }

  const box = computeInvoiceTotals({ subtotal, discount: rawDiscount, discountType: invoice.discountType, tax });
  // The stored total wins: it is what was issued, invoiced and paid against.
  return { ...box, total };
}

