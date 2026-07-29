// Pure inventory logic for the shop module.
//
// Stock lives in two places by design: on the product (single-SKU products) and on
// each variant (products with options). `totalStock` collapses that difference so
// callers never have to branch, and every helper here treats
// `trackInventory !== true` as "unlimited" — a service/digital product must never
// be blocked by a stock number nobody maintains.

import type { Product, ProductVariant, ShopOrderItem, StockMovementType } from '../../types';
import { hasVariants, variantLabel } from './variants';
import { round2 } from './pricing';

export type StockState = 'untracked' | 'in_stock' | 'low' | 'out';

export const DEFAULT_LOW_STOCK_THRESHOLD = 5;

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function isTracked(product: Pick<Product, 'trackInventory'>): boolean {
  return product.trackInventory === true;
}

export function variantStock(variant: ProductVariant | null | undefined): number {
  return num(variant?.stockQty);
}

/** Stock on hand: the sum of active variants when the product has them, else its own. */
export function totalStock(product: Product): number {
  if (hasVariants(product)) {
    return (product.variants || [])
      .filter(v => v.isActive !== false)
      .reduce((s, v) => s + variantStock(v), 0);
  }
  return num(product.stockQty);
}

export function lowStockThreshold(
  product: Pick<Product, 'lowStockThreshold'>,
  variant?: ProductVariant | null,
): number {
  const v = variant?.lowStockThreshold;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const p = product.lowStockThreshold;
  if (typeof p === 'number' && Number.isFinite(p)) return p;
  return DEFAULT_LOW_STOCK_THRESHOLD;
}

/** Stock state for a product, or for one variant when given. */
export function stockState(product: Product, variant?: ProductVariant | null): StockState {
  if (!isTracked(product)) return 'untracked';
  const qty = variant ? variantStock(variant) : totalStock(product);
  if (qty <= 0) return 'out';
  return qty <= lowStockThreshold(product, variant) ? 'low' : 'in_stock';
}

/** Can the customer add `qty` to the cart right now? */
export function canFulfill(
  product: Product,
  variant: ProductVariant | null | undefined,
  qty: number,
): { ok: boolean; reason?: string; available?: number } {
  const want = Math.max(1, Math.floor(qty) || 1);
  const min = num(product.minOrderQty);
  const max = num(product.maxOrderQty);
  if (min > 0 && want < min) return { ok: false, reason: `Sasia minimale është ${min}.` };
  if (max > 0 && want > max) return { ok: false, reason: `Sasia maksimale është ${max}.` };
  if (!isTracked(product)) return { ok: true };

  const available = variant ? variantStock(variant) : totalStock(product);
  if (want <= available) return { ok: true, available };

  // Out of stock — the policy decides whether the sale is still allowed.
  switch (product.stockPolicy) {
    case 'backorder':
      return { ok: true, available, reason: 'Do të porositet (backorder).' };
    case 'preorder':
      return { ok: true, available, reason: 'Porosi paraprake (preorder).' };
    default:
      return {
        ok: false,
        available,
        reason: available > 0 ? `Vetëm ${available} në stok.` : 'Nuk ka stok.',
      };
  }
}

/**
 * Signed delta a movement applies to stock. The ledger stores `quantity` as the
 * magnitude for in/out/sale/return and as a SIGNED value for adjustment/transfer,
 * so the sign convention lives here rather than at every call site.
 */
export function movementDelta(type: StockMovementType, quantity: number): number {
  const q = num(quantity);
  switch (type) {
    case 'in':
    case 'return':
      return Math.abs(q);
    case 'out':
    case 'sale':
      return -Math.abs(q);
    case 'adjustment':
    case 'transfer':
      return q;
    default:
      return q;
  }
}

/** Stock level after applying a movement. Never returns a negative balance. */
export function nextBalance(current: number, type: StockMovementType, quantity: number): number {
  return Math.max(0, num(current) + movementDelta(type, quantity));
}

/** Apply a movement to a product/variant, returning the patch to persist. */
export function applyStockToProduct(
  product: Product,
  variantId: string | undefined | null,
  type: StockMovementType,
  quantity: number,
): { patch: Partial<Product>; balanceAfter: number } {
  if (variantId && (product.variants?.length || 0) > 0) {
    let balanceAfter = 0;
    const variants = (product.variants || []).map(v => {
      if (v.id !== variantId) return v;
      balanceAfter = nextBalance(variantStock(v), type, quantity);
      return { ...v, stockQty: balanceAfter };
    });
    return { patch: { variants }, balanceAfter };
  }
  const balanceAfter = nextBalance(num(product.stockQty), type, quantity);
  return { patch: { stockQty: balanceAfter }, balanceAfter };
}

/** Products that need attention: tracked and at/below their threshold. */
export function lowStockProducts(products: Product[]): Product[] {
  return (products || []).filter(p => {
    if (!isTracked(p) || p.status === 'Archived') return false;
    const state = stockState(p);
    return state === 'low' || state === 'out';
  });
}

/** Value of stock on hand at cost — the number finance cares about. */
export function inventoryValue(products: Product[]): number {
  return round2(
    (products || []).reduce((sum, p) => {
      if (!isTracked(p)) return sum;
      if (hasVariants(p)) {
        return sum + (p.variants || []).reduce((s, v) => {
          const cost = v.costPrice ?? p.costPrice;
          return s + (typeof cost === 'number' ? cost * variantStock(v) : 0);
        }, 0);
      }
      return sum + (typeof p.costPrice === 'number' ? p.costPrice * num(p.stockQty) : 0);
    }, 0),
  );
}

/** Retail value of stock on hand — what it would bring in if it all sold. */
export function inventoryRetailValue(products: Product[]): number {
  return round2(
    (products || []).reduce((sum, p) => {
      if (!isTracked(p)) return sum;
      if (hasVariants(p)) {
        return sum + (p.variants || []).reduce(
          (s, v) => s + (v.price ?? p.price ?? 0) * variantStock(v),
          0,
        );
      }
      return sum + (p.price || 0) * num(p.stockQty);
    }, 0),
  );
}

export interface StockAllocation {
  productId: string;
  productName: string;
  variantId?: string;
  variantLabel?: string;
  quantity: number;
}

/**
 * Which stock movements an order should produce. Only tracked products appear, so
 * fulfilling an order of services writes nothing.
 */
export function allocationsForOrder(items: ShopOrderItem[], products: Product[]): StockAllocation[] {
  const byId = new Map(products.map(p => [p.id, p]));
  const out: StockAllocation[] = [];
  for (const item of items || []) {
    const product = byId.get(item.productId);
    if (!product || !isTracked(product)) continue;
    const variant = item.variantId ? product.variants?.find(v => v.id === item.variantId) : undefined;
    out.push({
      productId: product.id,
      productName: product.name,
      ...(variant
        ? {
            variantId: variant.id,
            variantLabel: item.variantLabel || variantLabel(variant.optionValues, (product.options || []).map(o => o.name)),
          }
        : {}),
      quantity: Math.max(0, Math.floor(item.quantity) || 0),
    });
  }
  return out.filter(a => a.quantity > 0);
}

/** Suggested restock quantity when a product sits at/below its reorder point. */
export function reorderSuggestion(product: Product): number {
  if (!isTracked(product)) return 0;
  const point = num(product.reorderPoint) || lowStockThreshold(product);
  const onHand = totalStock(product);
  if (onHand > point) return 0;
  const qty = num(product.reorderQty);
  return qty > 0 ? qty : Math.max(1, point * 2 - onHand);
}
