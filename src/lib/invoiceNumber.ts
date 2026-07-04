// Pure, side-effect-free invoice-numbering helpers.
//
// Invoice numbers are fiscally sensitive: they must be unique and strictly
// increasing, and must never reuse a number already issued — including for
// invoices that were later deleted. The monotonic Firestore counter
// (counters/invoices_{teamId}) is the source of truth for "already issued",
// while the max parsed from existing invoice numbers is a self-healing guard in
// case the counter ever drifts behind reality (e.g. imported/manual invoices, or
// a counter that was seeded too low before the invoice list had loaded).

const FAT_RE = /^FAT-0*(\d+)$/i;

/** Parse the numeric sequence from a "FAT-027" style number. Returns 0 when it doesn't match. */
export function parseInvoiceSeq(n: string | null | undefined): number {
  const m = FAT_RE.exec((n ?? '').trim());
  if (!m) return 0;
  const v = parseInt(m[1], 10);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/** Format a sequence number as a zero-padded invoice number (min 3 digits). */
export function formatInvoiceNumber(seq: number): string {
  return `FAT-${String(seq).padStart(3, '0')}`;
}

/**
 * The next sequence number: strictly greater than the stored counter AND greater
 * than every existing FAT-number. This guarantees the result never collides with
 * any number currently in use, and heals a stale/low counter instead of reissuing.
 */
export function nextInvoiceSeq(
  storedCounter: number | null | undefined,
  existingNumbers: Iterable<string | null | undefined> = [],
): number {
  let max = typeof storedCounter === 'number' && Number.isFinite(storedCounter) && storedCounter > 0
    ? Math.floor(storedCounter)
    : 0;
  for (const n of existingNumbers) {
    const v = parseInvoiceSeq(n);
    if (v > max) max = v;
  }
  return max + 1;
}
