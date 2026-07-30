import { describe, expect, it } from 'vitest';
import {
  allocationsForOrder,
  applyStockToProduct,
  canFulfill,
  inventoryRetailValue,
  inventoryValue,
  lowStockProducts,
  movementDelta,
  nextBalance,
  reorderSuggestion,
  stockState,
  totalStock,
} from './inventory';
import type { Product } from '../../types';

const base = (over: Partial<Product> = {}): Product => ({
  id: 'p1',
  name: 'Karrige',
  price: 100,
  createdAt: new Date(),
  updatedAt: new Date(),
  createdByUserId: null,
  ...over,
});

const withVariants = (over: Partial<Product> = {}) =>
  base({
    trackInventory: true,
    options: [{ name: 'Madhësia', values: ['S', 'M'] }],
    variants: [
      { id: 'v1', optionValues: { Madhësia: 'S' }, stockQty: 3 },
      { id: 'v2', optionValues: { Madhësia: 'M' }, stockQty: 8 },
    ],
    ...over,
  });

describe('totalStock', () => {
  it('sums active variants when the product has them', () => {
    expect(totalStock(withVariants())).toBe(11);
  });

  it('ignores deactivated variants', () => {
    const p = withVariants();
    p.variants![0].isActive = false;
    expect(totalStock(p)).toBe(8);
  });

  it('falls back to the product-level quantity', () => {
    expect(totalStock(base({ trackInventory: true, stockQty: 4 }))).toBe(4);
    expect(totalStock(base())).toBe(0);
  });
});

describe('stockState', () => {
  it('is untracked when inventory tracking is off', () => {
    expect(stockState(base({ stockQty: 0 }))).toBe('untracked');
  });

  it('flags low and out states against the threshold', () => {
    expect(stockState(base({ trackInventory: true, stockQty: 0 }))).toBe('out');
    expect(stockState(base({ trackInventory: true, stockQty: 3 }))).toBe('low'); // default threshold 5
    expect(stockState(base({ trackInventory: true, stockQty: 50 }))).toBe('in_stock');
  });

  it('prefers a variant threshold over the product one', () => {
    const p = base({ trackInventory: true, lowStockThreshold: 2 });
    const v = { id: 'v1', optionValues: {}, stockQty: 5, lowStockThreshold: 10 };
    expect(stockState(p, v)).toBe('low');
  });
});

describe('canFulfill', () => {
  it('allows anything for untracked products', () => {
    expect(canFulfill(base(), null, 9999).ok).toBe(true);
  });

  it('blocks beyond available stock by default', () => {
    const res = canFulfill(base({ trackInventory: true, stockQty: 2 }), null, 5);
    expect(res.ok).toBe(false);
    expect(res.available).toBe(2);
  });

  it('allows overselling under a backorder/preorder policy', () => {
    expect(canFulfill(base({ trackInventory: true, stockQty: 0, stockPolicy: 'backorder' }), null, 5).ok).toBe(true);
    expect(canFulfill(base({ trackInventory: true, stockQty: 0, stockPolicy: 'preorder' }), null, 5).ok).toBe(true);
  });

  it('enforces min/max order quantities before stock', () => {
    expect(canFulfill(base({ minOrderQty: 3 }), null, 2).ok).toBe(false);
    expect(canFulfill(base({ maxOrderQty: 4 }), null, 5).ok).toBe(false);
  });

  it('checks the chosen variant, not the product total', () => {
    const p = withVariants(); // 3 + 8 = 11 total, but S has only 3
    const s = p.variants![0];
    expect(canFulfill(p, s, 5).ok).toBe(false);
    expect(canFulfill(p, s, 3).ok).toBe(true);
  });
});

describe('movementDelta / nextBalance', () => {
  it('normalizes the sign per movement type', () => {
    expect(movementDelta('in', 5)).toBe(5);
    expect(movementDelta('in', -5)).toBe(5);
    expect(movementDelta('sale', 5)).toBe(-5);
    expect(movementDelta('out', -5)).toBe(-5);
    expect(movementDelta('adjustment', -5)).toBe(-5);
    expect(movementDelta('adjustment', 5)).toBe(5);
  });

  it('never drops below zero', () => {
    expect(nextBalance(2, 'sale', 5)).toBe(0);
    expect(nextBalance(2, 'in', 5)).toBe(7);
  });
});

describe('applyStockToProduct', () => {
  it('patches the addressed variant only', () => {
    const p = withVariants();
    const { patch, balanceAfter } = applyStockToProduct(p, 'v1', 'sale', 2);
    expect(balanceAfter).toBe(1);
    expect(patch.variants!.find(v => v.id === 'v1')!.stockQty).toBe(1);
    expect(patch.variants!.find(v => v.id === 'v2')!.stockQty).toBe(8);
  });

  it('patches product stock when no variant is addressed', () => {
    const { patch, balanceAfter } = applyStockToProduct(base({ stockQty: 10 }), null, 'in', 5);
    expect(balanceAfter).toBe(15);
    expect(patch.stockQty).toBe(15);
  });
});

describe('lowStockProducts', () => {
  it('returns tracked, non-archived products at or below threshold', () => {
    const items = [
      base({ id: 'ok', trackInventory: true, stockQty: 100 }),
      base({ id: 'low', trackInventory: true, stockQty: 2 }),
      base({ id: 'out', trackInventory: true, stockQty: 0 }),
      base({ id: 'untracked', stockQty: 0 }),
      base({ id: 'archived', trackInventory: true, stockQty: 0, status: 'Archived' }),
    ];
    expect(lowStockProducts(items).map(p => p.id)).toEqual(['low', 'out']);
  });
});

describe('inventory valuation', () => {
  it('values stock at cost and at retail', () => {
    const items = [
      base({ id: 'a', trackInventory: true, stockQty: 10, costPrice: 60, price: 100 }),
      withVariants({ id: 'b', costPrice: 5, price: 12 }), // 11 units inherit product cost
      base({ id: 'c', stockQty: 999, costPrice: 1 }),     // untracked → excluded
    ];
    expect(inventoryValue(items)).toBe(655);       // 600 + 55
    expect(inventoryRetailValue(items)).toBe(1132); // 1000 + 132
  });
});

describe('allocationsForOrder', () => {
  it('emits one allocation per tracked line', () => {
    const products = [withVariants({ id: 'pv' }), base({ id: 'ps' })];
    const allocations = allocationsForOrder(
      [
        { productId: 'pv', variantId: 'v1', name: 'Karrige', quantity: 2, unitPrice: 10, total: 20 },
        { productId: 'ps', name: 'Shërbim', quantity: 1, unitPrice: 10, total: 10 },
        { productId: 'missing', name: 'X', quantity: 1, unitPrice: 1, total: 1 },
      ],
      products,
    );
    expect(allocations).toEqual([
      { productId: 'pv', productName: 'Karrige', variantId: 'v1', variantLabel: 'S', quantity: 2 },
    ]);
  });
});

describe('reorderSuggestion', () => {
  it('suggests the configured reorder quantity at/below the reorder point', () => {
    expect(reorderSuggestion(base({ trackInventory: true, stockQty: 2, reorderPoint: 5, reorderQty: 20 }))).toBe(20);
  });

  it('suggests topping up to twice the reorder point when no quantity is set', () => {
    expect(reorderSuggestion(base({ trackInventory: true, stockQty: 2, reorderPoint: 5 }))).toBe(8);
  });

  it('suggests nothing when stock is healthy or untracked', () => {
    expect(reorderSuggestion(base({ trackInventory: true, stockQty: 50, reorderPoint: 5 }))).toBe(0);
    expect(reorderSuggestion(base({ stockQty: 0 }))).toBe(0);
  });
});
