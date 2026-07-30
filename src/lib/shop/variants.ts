// Pure variant-matrix helpers for the shop module.
//
// A product declares up to 3 OPTIONS (axes) — "Madhësia", "Ngjyra", … — and the
// sellable VARIANTS are the cartesian product of their values. Regenerating the
// matrix must never lose per-variant data the user already typed (SKU, price,
// stock), so buildVariantMatrix matches existing variants by their option-value
// fingerprint and carries them over.

import type { ProductOption, ProductVariant } from '../../types';

/** UI cap: 3 axes stays readable and keeps the matrix from exploding. */
export const MAX_OPTIONS = 3;
/** Hard cap on generated combinations (Firestore doc size + UI sanity). */
export const MAX_VARIANTS = 250;

/** Drop empty axes/values and de-duplicate, preserving the author's order. */
export function normalizeOptions(options: ProductOption[] | undefined): ProductOption[] {
  if (!options?.length) return [];
  const out: ProductOption[] = [];
  for (const opt of options.slice(0, MAX_OPTIONS)) {
    const name = (opt?.name || '').trim();
    if (!name) continue;
    const seen = new Set<string>();
    const values: string[] = [];
    for (const raw of opt.values || []) {
      const v = (raw || '').trim();
      if (!v || seen.has(v.toLowerCase())) continue;
      seen.add(v.toLowerCase());
      values.push(v);
    }
    if (values.length) out.push({ name, values });
  }
  return out;
}

/**
 * Stable fingerprint for a combination. Keyed by option NAME order (not object key
 * order, which JSON.stringify would depend on) so it survives re-serialization.
 */
export function variantKey(optionValues: Record<string, string> | undefined, optionNames: string[]): string {
  return optionNames.map(n => `${n}=${(optionValues || {})[n] ?? ''}`).join('|');
}

/** Human label, e.g. "M / E zezë". Falls back to the raw values when names are unknown. */
export function variantLabel(
  optionValues: Record<string, string> | undefined,
  optionNames?: string[],
): string {
  const vals = optionValues || {};
  const names = optionNames?.length ? optionNames : Object.keys(vals);
  return names.map(n => vals[n]).filter(Boolean).join(' / ');
}

/** Cartesian product of value lists. `cartesian([])` is one empty combination. */
export function cartesian(lists: string[][]): string[][] {
  return lists.reduce<string[][]>(
    (acc, list) => acc.flatMap(prefix => list.map(v => [...prefix, v])),
    [[]],
  );
}

/** How many variants the given options would generate (before the cap). */
export function variantCount(options: ProductOption[] | undefined): number {
  const norm = normalizeOptions(options);
  if (!norm.length) return 0;
  return norm.reduce((n, o) => n * o.values.length, 1);
}

let _fallbackSeq = 0;
function defaultMakeId(): string {
  const c: any = typeof globalThis !== 'undefined' ? (globalThis as any).crypto : undefined;
  if (c?.randomUUID) return c.randomUUID();
  _fallbackSeq += 1;
  return `v${_fallbackSeq}-${Date.now().toString(36)}`;
}

/**
 * Rebuild the variant matrix for `options`, preserving data from `existing`.
 *
 * Combinations that still exist keep their id and every field the user filled in;
 * new combinations are appended as blank-but-active variants; combinations that no
 * longer exist are dropped. Truncated at MAX_VARIANTS.
 */
export function buildVariantMatrix(
  options: ProductOption[] | undefined,
  existing: ProductVariant[] = [],
  makeId: () => string = defaultMakeId,
): ProductVariant[] {
  const norm = normalizeOptions(options);
  if (!norm.length) return [];

  const names = norm.map(o => o.name);
  const byKey = new Map<string, ProductVariant>();
  for (const v of existing) byKey.set(variantKey(v.optionValues, names), v);

  const combos = cartesian(norm.map(o => o.values)).slice(0, MAX_VARIANTS);

  return combos.map((combo, index) => {
    const optionValues: Record<string, string> = {};
    names.forEach((n, i) => { optionValues[n] = combo[i]; });
    const prev = byKey.get(variantKey(optionValues, names));
    if (prev) return { ...prev, optionValues, position: index };
    return { id: makeId(), optionValues, isActive: true, position: index };
  });
}

/** Variants a customer may actually buy (explicitly deactivated ones are hidden). */
export function activeVariants(product: { variants?: ProductVariant[] }): ProductVariant[] {
  return (product.variants || []).filter(v => v.isActive !== false);
}

/** Find a variant by id, tolerating undefined ids (single-variant products). */
export function findVariant(
  product: { variants?: ProductVariant[] },
  variantId: string | undefined | null,
): ProductVariant | undefined {
  if (!variantId) return undefined;
  return (product.variants || []).find(v => v.id === variantId);
}

/** True when the product sells through variants rather than a single SKU. */
export function hasVariants(product: { options?: ProductOption[]; variants?: ProductVariant[] }): boolean {
  return normalizeOptions(product.options).length > 0 && (product.variants?.length || 0) > 0;
}
