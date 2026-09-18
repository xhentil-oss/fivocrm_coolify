// Pure pricing engine for the shop module.
//
// Money rules this file encodes, in one place so the back office, the portal cart
// and the invoice conversion can never disagree:
//
//  • A variant price OVERRIDES the product price; `undefined` inherits it.
//  • Quantity tiers (`priceTiers`) win over both when the ordered qty reaches them —
//    the highest matching `minQty` applies.
//  • `taxIncluded` products store a GROSS price; order lines always persist a NET
//    unitPrice + explicit tax, so totals stay auditable and invoice-compatible.
//  • Every persisted amount is rounded to 2 decimals at the point it's computed,
//    never at display time.

import type {
  Product,
  ProductPriceTier,
  ProductVariant,
  ShopOrderItem,
} from '../../types';
import { variantLabel } from './variants';

export function round2(n: number): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  const s = String(v);
  // Shift the decimal exponent via the string form rather than multiplying by 100:
  // 1.005 * 100 is 100.49999999999999 in binary, which rounds DOWN to 1.00 and
  // quietly loses a cent on every such price. `1.005e2` is exactly 100.5.
  if (s.includes('e') || s.includes('E')) return Math.round(v * 100) / 100;
  const shifted = Number(`${s}e2`);
  // Round halves away from zero, so -1.005 mirrors 1.005 (Math.round(-100.5) = -100).
  const rounded = (v < 0 ? -1 : 1) * Math.round(Math.abs(shifted));
  return Number(`${rounded}e-2`);
}

/** The tier that applies at `qty` — the highest minQty that qty reaches. */
export function tierFor(tiers: ProductPriceTier[] | undefined, qty: number): ProductPriceTier | undefined {
  if (!tiers?.length) return undefined;
  return tiers
    .filter(t => Number.isFinite(t?.minQty) && Number.isFinite(t?.unitPrice) && qty >= t.minQty)
    .sort((a, b) => b.minQty - a.minQty)[0];
}

/**
 * Listed unit price (as stored — gross when `taxIncluded`). Resolution order:
 * quantity tier → variant override → product price.
 */
export function listedUnitPrice(
  product: Pick<Product, 'price' | 'priceTiers'>,
  variant?: ProductVariant | null,
  qty = 1,
): number {
  const tier = tierFor(product.priceTiers, qty);
  if (tier) return round2(tier.unitPrice);
  if (variant && typeof variant.price === 'number' && Number.isFinite(variant.price)) {
    return round2(variant.price);
  }
  return round2(product.price || 0);
}

/**
 * Net (tax-exclusive) unit price — the per-unit figure shown and audited.
 *
 * Only ever a per-UNIT display value: a gross-listed 10.00 at 20 % has no exact
 * net unit (8.333…), so this necessarily rounds. Never multiply it by quantity to
 * get a line total — that is what `netLineTotal()` is for.
 */
export function netUnitPrice(
  product: Pick<Product, 'price' | 'priceTiers' | 'taxRatePercent' | 'taxIncluded'>,
  variant?: ProductVariant | null,
  qty = 1,
): number {
  const listed = listedUnitPrice(product, variant, qty);
  const rate = taxRate(product);
  if (!product.taxIncluded || rate <= 0) return listed;
  return round2(listed / (1 + rate / 100));
}

/**
 * Net (tax-exclusive) LINE total for `qty` units — the cent-exact figure an order
 * line stores.
 *
 * On a tax-inclusive product the customer is quoted the GROSS price, so the gross
 * line is the authoritative amount: round `listed × qty` once and back the tax out
 * of that. Rounding the unit net first (8.33 × 3 = 24.99 + 5.00 tax = 29.99) lost a
 * cent per line against a catalogue price of 10.00 × 3 = 30.00, and 0.40 at qty 100.
 */
export function netLineTotal(
  product: Pick<Product, 'price' | 'priceTiers' | 'taxRatePercent' | 'taxIncluded'>,
  variant: ProductVariant | null | undefined,
  qty: number,
): number {
  const units = Math.max(0, Math.floor(qty) || 0);
  const listed = listedUnitPrice(product, variant, units || 1);
  const rate = taxRate(product);
  const line = round2(listed * units);
  if (!product.taxIncluded || rate <= 0) return line;
  return round2(line / (1 + rate / 100));
}

/** Gross (tax-inclusive) unit price — what the portal shows the customer. */
export function grossUnitPrice(
  product: Pick<Product, 'price' | 'priceTiers' | 'taxRatePercent' | 'taxIncluded'>,
  variant?: ProductVariant | null,
  qty = 1,
): number {
  const listed = listedUnitPrice(product, variant, qty);
  const rate = taxRate(product);
  if (product.taxIncluded || rate <= 0) return listed;
  return round2(listed * (1 + rate / 100));
}

export function taxRate(product: Pick<Product, 'taxRatePercent'>): number {
  const r = Number(product.taxRatePercent);
  return Number.isFinite(r) && r > 0 ? r : 0;
}

/** The strike-through "was" price, only when it genuinely exceeds the current one. */
export function effectiveCompareAt(
  product: Pick<Product, 'price' | 'compareAtPrice'>,
  variant?: ProductVariant | null,
): number | undefined {
  const compare = variant?.compareAtPrice ?? product.compareAtPrice;
  const price = variant?.price ?? product.price;
  if (typeof compare !== 'number' || !Number.isFinite(compare)) return undefined;
  return compare > (price || 0) ? round2(compare) : undefined;
}

/** Discount vs. the compare-at price, as a whole percent. null when not on sale. */
export function discountPercent(
  product: Pick<Product, 'price' | 'compareAtPrice'>,
  variant?: ProductVariant | null,
): number | null {
  const compare = effectiveCompareAt(product, variant);
  if (!compare) return null;
  const price = variant?.price ?? product.price ?? 0;
  return Math.round(((compare - price) / compare) * 100);
}

/** Gross margin percent from cost price. null when cost is unknown or price is 0. */
export function marginPercent(
  product: Pick<Product, 'price' | 'costPrice'>,
  variant?: ProductVariant | null,
): number | null {
  const cost = variant?.costPrice ?? product.costPrice;
  const price = variant?.price ?? product.price;
  if (typeof cost !== 'number' || !Number.isFinite(cost) || !price) return null;
  return round2(((price - cost) / price) * 100);
}

/** Absolute profit per unit. null when cost is unknown. */
export function unitProfit(
  product: Pick<Product, 'price' | 'costPrice'>,
  variant?: ProductVariant | null,
): number | null {
  const cost = variant?.costPrice ?? product.costPrice;
  const price = variant?.price ?? product.price;
  if (typeof cost !== 'number' || !Number.isFinite(cost)) return null;
  return round2((price || 0) - cost);
}

/** Build an order line — a price SNAPSHOT that later catalog edits never rewrite. */
export function buildOrderItem(
  product: Product,
  variant: ProductVariant | null | undefined,
  quantity: number,
  discount = 0,
): ShopOrderItem {
  const qty = Math.max(1, Math.floor(quantity) || 1);
  const unitPrice = netUnitPrice(product, variant, qty);
  const rate = taxRate(product);
  // The LINE is the authoritative amount, not unitPrice × qty — see netLineTotal().
  const netAfterDiscount = Math.max(0, round2(netLineTotal(product, variant, qty) - (discount || 0)));
  const optionNames = (product.options || []).map(o => o.name);
  return {
    productId: product.id,
    ...(variant ? { variantId: variant.id, variantLabel: variantLabel(variant.optionValues, optionNames) } : {}),
    name: product.name,
    sku: variant?.sku || product.sku || undefined,
    quantity: qty,
    unitPrice,
    ...(discount ? { discount: round2(discount) } : {}),
    ...(rate ? { taxRatePercent: rate, taxAmount: round2((netAfterDiscount * rate) / 100) } : {}),
    total: netAfterDiscount,
    imageUrl: variant?.imageUrl || product.images?.find(i => i.isPrimary)?.url || product.images?.[0]?.url,
  };
}

export interface OrderTotals {
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  shippingTotal: number;
  total: number;
  itemCount: number;
}

export interface OrderTotalsOptions {
  /** Order-level discount, applied on top of per-line discounts. */
  orderDiscount?: number;
  shipping?: number;
  /** Charge tax on shipping too (off by default — Albanian practice). */
  taxOnShipping?: boolean;
  /** Rate used when taxOnShipping is on; defaults to the highest line rate. */
  shippingTaxRatePercent?: number;
}

/**
 * The line's net amount BEFORE its own discount.
 *
 * The line's stored `total` is the snapshot and therefore the authority: on a
 * tax-inclusive product it is derived from the gross line, so `unitPrice × qty`
 * can legitimately be a cent short of it. Only when a caller hands us a line with
 * no usable total do we fall back to the multiplication.
 */
function lineNetBeforeDiscount(item: ShopOrderItem): number {
  const total = Number(item?.total);
  if (Number.isFinite(total)) return round2(total + (Number(item?.discount) || 0));
  return round2((item?.unitPrice || 0) * (item?.quantity || 0));
}

/**
 * Roll order lines up to a payable total.
 *
 * `subtotal` is gross-of-discount so the UI can show a discount row; an
 * order-level discount is spread across lines PRO-RATA before tax, so the tax
 * base always matches what the customer actually pays.
 */
export function computeOrderTotals(
  items: ShopOrderItem[],
  opts: OrderTotalsOptions = {},
): OrderTotals {
  const lines = items || [];
  const subtotal = round2(lines.reduce((s, i) => s + lineNetBeforeDiscount(i), 0));
  const lineDiscounts = round2(lines.reduce((s, i) => s + (i.discount || 0), 0));
  const netAfterLineDiscounts = Math.max(0, round2(subtotal - lineDiscounts));

  // Clamp the order discount so a fat-fingered value can't produce a negative bill.
  const orderDiscount = Math.min(
    Math.max(0, round2(opts.orderDiscount || 0)),
    netAfterLineDiscounts,
  );
  const discountTotal = round2(lineDiscounts + orderDiscount);
  const ratio = netAfterLineDiscounts > 0 ? (netAfterLineDiscounts - orderDiscount) / netAfterLineDiscounts : 0;

  // Rounded PER LINE, then summed: with no order discount (ratio 1) this reproduces
  // each line's own `taxAmount` exactly, so the invoice and the order agree cent
  // for cent instead of differing by the rounding of the aggregate.
  let taxTotal = round2(
    lines.reduce((s, i) => {
      const rate = i.taxRatePercent || 0;
      if (!rate) return s;
      const lineNet = Math.max(0, lineNetBeforeDiscount(i) - (i.discount || 0));
      return s + round2((lineNet * ratio * rate) / 100);
    }, 0),
  );

  const shippingTotal = round2(Math.max(0, opts.shipping || 0));
  if (opts.taxOnShipping && shippingTotal > 0) {
    const rate = opts.shippingTaxRatePercent
      ?? Math.max(0, ...lines.map(i => i.taxRatePercent || 0));
    if (rate > 0) taxTotal = round2(taxTotal + (shippingTotal * rate) / 100);
  }

  return {
    subtotal,
    discountTotal,
    taxTotal,
    shippingTotal,
    total: round2(netAfterLineDiscounts - orderDiscount + taxTotal + shippingTotal),
    itemCount: lines.reduce((n, i) => n + (i.quantity || 0), 0),
  };
}

/** Total cost of goods for an order — needs the catalog to look costs up. */
export function orderCogs(items: ShopOrderItem[], products: Product[]): number {
  const byId = new Map(products.map(p => [p.id, p]));
  return round2(
    (items || []).reduce((sum, item) => {
      const product = byId.get(item.productId);
      if (!product) return sum;
      const variant = item.variantId ? product.variants?.find(v => v.id === item.variantId) : undefined;
      const cost = variant?.costPrice ?? product.costPrice;
      if (typeof cost !== 'number' || !Number.isFinite(cost)) return sum;
      return sum + cost * (item.quantity || 0);
    }, 0),
  );
}
