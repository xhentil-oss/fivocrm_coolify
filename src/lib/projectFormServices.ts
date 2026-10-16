// Pure helpers for the project form's "Shërbimet e Projektit" picker.
//
// Two bugs this exists to stop:
//  1. The catalogue total summed raw `price` values across currencies, so a €500
//     service on an ALL project read as 500 L — and that number overwrote the budget.
//  2. The total overwrote `budget` on EVERY save that had services selected. Once the
//     edit form preloads the project's services, that would reset a negotiated fee to
//     the catalogue sum each time anything was edited. The total may only replace the
//     budget when the person actually CHANGED the service selection.

import { toAll, fromAll } from './utils';

interface PricedService {
  id: string;
  price?: number;
  currency?: string;
}

/** Same ids regardless of order / duplicates. */
export function sameIdSet(a: readonly string[] | null | undefined, b: readonly string[] | null | undefined): boolean {
  const sa = new Set((a || []).filter(Boolean));
  const sb = new Set((b || []).filter(Boolean));
  if (sa.size !== sb.size) return false;
  for (const id of sa) if (!sb.has(id)) return false;
  return true;
}

/**
 * Catalogue total of the selected services, expressed in `currency` (each service
 * is normalised through ALL first). `null` when nothing is selected. Rounded to cents.
 */
export function servicesTotalIn(
  services: readonly PricedService[] | null | undefined,
  selectedIds: readonly string[],
  currency: string,
): number | null {
  if (!services || selectedIds.length === 0) return null;
  const wanted = new Set(selectedIds);
  const totalAll = services
    .filter(s => wanted.has(s.id))
    .reduce((sum, s) => sum + toAll(s.price || 0, s.currency), 0);
  return Math.round(fromAll(totalAll, currency) * 100) / 100;
}

/**
 * The value the services total should force into `budget`, or `null` when the
 * budget must be left as the user/record has it: nothing selected, or (on EDIT)
 * no permission to see the budget / the selection is unchanged from what was saved.
 *
 * On CREATE (`isCreate`) the total always sets the budget, whatever the permission:
 * a Member/Sales may create a project but cannot see the budget field, and without
 * the total the project was saved with budget 0 — so the recurring-billing cron
 * billed 0 from cycle two (a 0-value notification, no invoice, 0 revenue). There is
 * no negotiated fee to protect on a project that does not exist yet.
 */
export function serviceBudgetOverride(opts: {
  canSeeBudget: boolean;
  services: readonly PricedService[] | null | undefined;
  selectedIds: readonly string[];
  initialIds: readonly string[] | null | undefined;
  currency: string;
  /** True when the form creates a new project (no initialData). */
  isCreate?: boolean;
}): number | null {
  if (opts.isCreate) return servicesTotalIn(opts.services, opts.selectedIds, opts.currency);
  if (!opts.canSeeBudget) return null;
  if (sameIdSet(opts.selectedIds, opts.initialIds)) return null;
  return servicesTotalIn(opts.services, opts.selectedIds, opts.currency);
}

/**
 * Parse a JSON id list posted by the form for an UPDATE: an array (possibly `[]`,
 * which CLEARS the field — `undefined` would be stripped by removeUndefined and keep
 * the old ids), or `undefined` when the form did not send it (leave untouched).
 */
export function updateIdListValue(raw: unknown): string[] | undefined {
  if (typeof raw !== 'string' || !raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return undefined;
    return parsed.filter((x): x is string => typeof x === 'string' && x.length > 0);
  } catch {
    return undefined;
  }
}
