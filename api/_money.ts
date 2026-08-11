/**
 * Server-side mirror of `currencySymbol` in `src/lib/utils.ts`.
 *
 * Cron and webhook code cannot import from `src/` (different tsconfig, different
 * bundle), and it writes user-facing text: notification bodies, emails, activity
 * entries. Those used to interpolate `invoice.currency || 'ALL'` straight into the
 * sentence, so a tenant got "Fatura u gjenerua (50.000 ALL)" — the ISO code, not
 * the Lek sign the rest of the product shows.
 *
 * Keep this in sync with the client helper: Lek is the house currency, so an
 * absent or unrecognised code is Lek, never the raw string.
 */
export function currencySymbol(currency?: string | null): string {
  switch (currency) {
    case 'EUR': return '€';
    case 'USD': return '$';
    case 'GBP': return '£';
    default: return 'L';
  }
}

/** An amount formatted the way the UI shows it: "50.000 L". */
export function formatMoney(amount: number, currency?: string | null): string {
  const value = typeof amount === 'number' && isFinite(amount) ? amount : 0;
  return `${value.toLocaleString('sq-AL')} ${currencySymbol(currency)}`;
}
