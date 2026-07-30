// Product identity, validation and CSV mapping — all pure, so they are unit-tested
// without Firestore. Albanian-language messages match the rest of the UI.

import type { Product, ProductStatus } from '../../types';
import { normalizeOptions, variantCount, MAX_VARIANTS } from './variants';

/** Albanian → ASCII, so slugs stay URL-safe (ë→e, ç→c). */
const DIACRITICS: Record<string, string> = { ë: 'e', Ë: 'e', ç: 'c', Ç: 'c' };

export function slugify(input: string): string {
  return (input || '')
    .trim()
    .replace(/[ëËçÇ]/g, ch => DIACRITICS[ch] || ch)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip combining accents left by NFD
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/** Slug unique within the tenant — appends -2, -3 … on collision. */
export function uniqueSlug(name: string, taken: Iterable<string | undefined>): string {
  const base = slugify(name) || 'produkt';
  const used = new Set(Array.from(taken).filter(Boolean) as string[]);
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

/** Deterministic SKU seed from the name, e.g. "Karrige Zyre" → "KAR-ZYR". */
export function suggestSku(name: string, suffix?: string): string {
  const parts = slugify(name).split('-').filter(Boolean).slice(0, 2);
  const base = parts.map(p => p.slice(0, 3).toUpperCase()).join('-') || 'PRD';
  return suffix ? `${base}-${suffix}` : base;
}

const ORDER_RE = /^POR-(\d{4})-0*(\d+)$/i;

/** Parse the sequence out of "POR-2026-0007". Returns 0 when it doesn't match the year. */
export function parseOrderSeq(orderNumber: string | null | undefined, year: number): number {
  const m = ORDER_RE.exec((orderNumber ?? '').trim());
  if (!m || Number(m[1]) !== year) return 0;
  const v = parseInt(m[2], 10);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/**
 * Next order number for `year`, strictly greater than every existing number in
 * that year. Per-year sequences reset each January, like the invoice numbering.
 */
export function nextOrderNumber(
  existing: Iterable<string | null | undefined>,
  year: number,
): string {
  let max = 0;
  for (const n of existing) {
    const v = parseOrderSeq(n, year);
    if (v > max) max = v;
  }
  return `POR-${year}-${String(max + 1).padStart(4, '0')}`;
}

/** Primary image URL, honouring `isPrimary` then position then insertion order. */
export function primaryImage(product: Pick<Product, 'images'>): string | undefined {
  const images = product.images || [];
  const primary = images.find(i => i.isPrimary);
  if (primary?.url) return primary.url;
  const sorted = [...images].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  return sorted[0]?.url;
}

/** Lowercased haystack for the list search box. */
export function productHaystack(product: Product): string {
  return [
    product.name,
    product.sku,
    product.barcode,
    product.categoryName,
    product.brandName,
    product.shortDescription,
    ...(product.tags || []),
    ...(product.variants || []).flatMap(v => [v.sku, v.barcode, ...Object.values(v.optionValues || {})]),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

/** Is the product sellable in the client portal right now? */
export function isPortalVisible(product: Product): boolean {
  return product.visibleInPortal === true && (product.status || 'Draft') === 'Active';
}

export const PRODUCT_STATUS_LABELS: Record<ProductStatus, string> = {
  Draft: 'Draft',
  Active: 'Aktiv',
  Archived: 'Arkivuar',
};

/**
 * Validate a product draft. Returns Albanian error messages (empty = valid).
 * Kept pure so both the form and the CSV importer reject the same things.
 */
export function validateProduct(draft: Partial<Product>): string[] {
  const errors: string[] = [];
  if (!draft.name || !draft.name.trim()) errors.push('Emri i produktit është i detyrueshëm.');
  const price = Number(draft.price);
  if (!Number.isFinite(price) || price < 0) errors.push('Çmimi duhet të jetë një numër >= 0.');
  if (draft.compareAtPrice != null && Number(draft.compareAtPrice) < price) {
    errors.push('Çmimi i krahasimit duhet të jetë më i lartë se çmimi aktual.');
  }
  if (draft.costPrice != null && Number(draft.costPrice) < 0) {
    errors.push('Kosto nuk mund të jetë negative.');
  }
  const tax = Number(draft.taxRatePercent ?? 0);
  if (!Number.isFinite(tax) || tax < 0 || tax > 100) errors.push('TVSH duhet të jetë 0–100%.');
  const min = Number(draft.minOrderQty ?? 0);
  const max = Number(draft.maxOrderQty ?? 0);
  if (min && max && max < min) errors.push('Sasia maksimale nuk mund të jetë nën minimalen.');
  if (variantCount(draft.options) > MAX_VARIANTS) {
    errors.push(`Kombinimet e opsioneve i kalojnë ${MAX_VARIANTS} — hiq disa vlera.`);
  }
  for (const opt of normalizeOptions(draft.options)) {
    if (opt.values.length === 0) errors.push(`Opsioni "${opt.name}" nuk ka vlera.`);
  }
  if (draft.type === 'digital' && draft.trackInventory && !draft.stockQty) {
    // Not fatal, but a digital product with tracked zero stock is never sellable.
    errors.push('Produkt digjital me inventar të gjurmuar duhet të ketë stok.');
  }
  const tiers = draft.priceTiers || [];
  if (tiers.some(t => !Number.isFinite(Number(t.minQty)) || Number(t.minQty) < 2)) {
    errors.push('Sasia e nivelit të çmimit duhet të jetë >= 2.');
  }
  return errors;
}

// ── CSV import/export ────────────────────────────────────────────────────────
// One flat row per product. Variants are intentionally NOT exported: a matrix
// doesn't survive a flat CSV round-trip, and a partial import would silently drop
// per-variant stock. Variant-heavy catalogs are edited in the app.

export const PRODUCT_CSV_HEADERS = [
  'Emri', 'SKU', 'Barkod', 'Kategoria', 'Marka', 'Çmimi', 'Çmimi i vjetër', 'Kosto',
  'Monedha', 'TVSH %', 'Stok', 'Njësia', 'Statusi', 'Në portal', 'Etiketa', 'Përshkrim i shkurtër',
] as const;

export function productToCsvRow(product: Product): (string | number)[] {
  return [
    product.name || '',
    product.sku || '',
    product.barcode || '',
    product.categoryName || '',
    product.brandName || '',
    product.price ?? 0,
    product.compareAtPrice ?? '',
    product.costPrice ?? '',
    product.currency || 'ALL',
    product.taxRatePercent ?? '',
    product.trackInventory ? (product.stockQty ?? 0) : '',
    product.unit || '',
    product.status || 'Draft',
    product.visibleInPortal ? 'Po' : 'Jo',
    (product.tags || []).join('; '),
    product.shortDescription || '',
  ];
}

/** Header synonyms for the importer's auto-mapping (Albanian + English). */
export const PRODUCT_IMPORT_FIELDS: {
  key: string;
  label: string;
  required?: boolean;
  synonyms: string[];
}[] = [
  { key: 'name', label: 'Emri', required: true, synonyms: ['emri', 'name', 'produkti', 'product', 'title', 'titulli'] },
  { key: 'sku', label: 'SKU', synonyms: ['sku', 'kodi', 'code', 'article', 'artikulli'] },
  { key: 'barcode', label: 'Barkod', synonyms: ['barkod', 'barcode', 'ean', 'upc', 'gtin'] },
  { key: 'categoryName', label: 'Kategoria', synonyms: ['kategoria', 'category', 'kategori'] },
  { key: 'brandName', label: 'Marka', synonyms: ['marka', 'brand', 'prodhuesi', 'manufacturer'] },
  { key: 'price', label: 'Çmimi', required: true, synonyms: ['çmimi', 'cmimi', 'price', 'shitje', 'çmim'] },
  { key: 'compareAtPrice', label: 'Çmimi i vjetër', synonyms: ['çmimi i vjetër', 'compare at price', 'old price', 'çmimi para'] },
  { key: 'costPrice', label: 'Kosto', synonyms: ['kosto', 'cost', 'cost price', 'blerje'] },
  { key: 'currency', label: 'Monedha', synonyms: ['monedha', 'currency', 'valuta'] },
  { key: 'taxRatePercent', label: 'TVSH %', synonyms: ['tvsh', 'tvsh %', 'tax', 'vat', 'tax rate'] },
  { key: 'stockQty', label: 'Stok', synonyms: ['stok', 'stock', 'sasia', 'quantity', 'qty', 'inventar'] },
  { key: 'unit', label: 'Njësia', synonyms: ['njësia', 'njesia', 'unit', 'uom'] },
  { key: 'shortDescription', label: 'Përshkrimi', synonyms: ['përshkrimi', 'pershkrimi', 'description', 'përshkrim i shkurtër'] },
  { key: 'tags', label: 'Etiketa', synonyms: ['etiketa', 'tags', 'tag', 'label'] },
];

const CURRENCIES = new Set(['ALL', 'EUR', 'USD', 'GBP']);

/**
 * Parse a price cell into a number, accepting both European ("1.299,50",
 * "1.200") and US ("1,299.50") conventions.
 *
 * The genuinely ambiguous case is a single separator followed by exactly three
 * digits: "1.200" is 1200 in sq-AL but 1.2 in en-US. We resolve it as THOUSANDS,
 * because Albanian catalogs price in whole Lekë and the alternative silently
 * imports a 1200-Lekë product as costing 1.2.
 */
export function parseCsvNumber(raw: unknown): number | undefined {
  if (raw == null || raw === '') return undefined;
  const cleaned = String(raw).replace(/[^\d.,-]/g, '').trim();
  if (!cleaned || !/\d/.test(cleaned)) return undefined;

  const dots = (cleaned.match(/\./g) || []).length;
  const commas = (cleaned.match(/,/g) || []).length;
  let s = cleaned;

  if (dots && commas) {
    // Whichever separator appears last is the decimal one; the other is grouping.
    s = cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.')
      ? cleaned.replace(/\./g, '').replace(',', '.')
      : cleaned.replace(/,/g, '');
  } else if (commas) {
    s = commas > 1 || /,\d{3}$/.test(cleaned)
      ? cleaned.replace(/,/g, '')
      : cleaned.replace(',', '.');
  } else if (dots) {
    s = dots > 1 || /\.\d{3}$/.test(cleaned) ? cleaned.replace(/\./g, '') : cleaned;
  }

  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

/** Map one mapped CSV row to a product draft (no Firestore fields). */
export function productFromCsvRow(row: Record<string, any>): Partial<Product> {
  const draft: Partial<Product> = {
    name: String(row.name ?? '').trim(),
    price: parseCsvNumber(row.price) ?? 0,
    status: 'Draft',
    type: 'physical',
    requiresShipping: true,
    visibleInPortal: false,
  };
  const sku = String(row.sku ?? '').trim();
  if (sku) draft.sku = sku;
  const barcode = String(row.barcode ?? '').trim();
  if (barcode) draft.barcode = barcode;
  const categoryName = String(row.categoryName ?? '').trim();
  if (categoryName) draft.categoryName = categoryName;
  const brandName = String(row.brandName ?? '').trim();
  if (brandName) draft.brandName = brandName;
  const unit = String(row.unit ?? '').trim();
  if (unit) draft.unit = unit;
  const shortDescription = String(row.shortDescription ?? '').trim();
  if (shortDescription) draft.shortDescription = shortDescription;

  const compareAt = parseCsvNumber(row.compareAtPrice);
  if (compareAt != null) draft.compareAtPrice = compareAt;
  const cost = parseCsvNumber(row.costPrice);
  if (cost != null) draft.costPrice = cost;
  const tax = parseCsvNumber(row.taxRatePercent);
  if (tax != null) draft.taxRatePercent = tax;

  const stock = parseCsvNumber(row.stockQty);
  if (stock != null) {
    draft.stockQty = stock;
    draft.trackInventory = true;
  }

  const currency = String(row.currency ?? '').trim().toUpperCase();
  if (CURRENCIES.has(currency)) draft.currency = currency as Product['currency'];

  const tags = String(row.tags ?? '')
    .split(/[;,|]/)
    .map(t => t.trim())
    .filter(Boolean);
  if (tags.length) draft.tags = tags;

  return draft;
}
