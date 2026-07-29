import { describe, expect, it } from 'vitest';
import {
  buildOrderItem,
  computeOrderTotals,
  discountPercent,
  grossUnitPrice,
  listedUnitPrice,
  marginPercent,
  netUnitPrice,
  orderCogs,
  round2,
  tierFor,
} from './pricing';
import type { Product, ProductVariant } from '../../types';

const base = (over: Partial<Product> = {}): Product => ({
  id: 'p1',
  name: 'Karrige Zyre',
  price: 100,
  createdAt: new Date(),
  updatedAt: new Date(),
  createdByUserId: null,
  ...over,
});

describe('round2', () => {
  it('rounds to two decimals and tolerates junk', () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(2.344999)).toBe(2.34);
    expect(round2(NaN)).toBe(0);
  });
});

describe('tierFor', () => {
  const tiers = [
    { minQty: 5, unitPrice: 90 },
    { minQty: 10, unitPrice: 80 },
  ];

  it('picks the highest tier the quantity reaches', () => {
    expect(tierFor(tiers, 12)?.unitPrice).toBe(80);
    expect(tierFor(tiers, 5)?.unitPrice).toBe(90);
  });

  it('returns nothing below the first tier', () => {
    expect(tierFor(tiers, 4)).toBeUndefined();
    expect(tierFor(undefined, 100)).toBeUndefined();
  });
});

describe('listedUnitPrice', () => {
  it('prefers a quantity tier over the variant override', () => {
    const product = base({ priceTiers: [{ minQty: 10, unitPrice: 70 }] });
    const variant: ProductVariant = { id: 'v1', optionValues: {}, price: 120 };
    expect(listedUnitPrice(product, variant, 10)).toBe(70);
    expect(listedUnitPrice(product, variant, 2)).toBe(120);
  });

  it('inherits the product price when the variant has none', () => {
    expect(listedUnitPrice(base(), { id: 'v1', optionValues: {} }, 1)).toBe(100);
  });

  it('treats a zero variant price as a real override, not "missing"', () => {
    // A free gift variant must stay free — `?? product.price` would break this.
    expect(listedUnitPrice(base(), { id: 'v1', optionValues: {}, price: 0 }, 1)).toBe(0);
  });
});

describe('net vs gross pricing', () => {
  it('extracts net from a tax-included price', () => {
    const product = base({ price: 120, taxRatePercent: 20, taxIncluded: true });
    expect(netUnitPrice(product)).toBe(100);
    expect(grossUnitPrice(product)).toBe(120);
  });

  it('adds tax on top of a net price', () => {
    const product = base({ price: 100, taxRatePercent: 20, taxIncluded: false });
    expect(netUnitPrice(product)).toBe(100);
    expect(grossUnitPrice(product)).toBe(120);
  });

  it('is a no-op without a tax rate', () => {
    const product = base({ price: 100 });
    expect(netUnitPrice(product)).toBe(100);
    expect(grossUnitPrice(product)).toBe(100);
  });
});

describe('margin and discount', () => {
  it('computes margin from cost', () => {
    expect(marginPercent(base({ price: 100, costPrice: 60 }))).toBe(40);
    expect(marginPercent(base({ price: 100 }))).toBeNull();
  });

  it('only reports a discount when compare-at is genuinely higher', () => {
    expect(discountPercent(base({ price: 80, compareAtPrice: 100 }))).toBe(20);
    expect(discountPercent(base({ price: 100, compareAtPrice: 100 }))).toBeNull();
    expect(discountPercent(base({ price: 100, compareAtPrice: 80 }))).toBeNull();
  });
});

describe('buildOrderItem', () => {
  it('snapshots a net price plus explicit tax', () => {
    const product = base({ id: 'p9', sku: 'KAR-01', price: 120, taxRatePercent: 20, taxIncluded: true });
    const item = buildOrderItem(product, null, 2);
    expect(item.unitPrice).toBe(100);
    expect(item.total).toBe(200);
    expect(item.taxAmount).toBe(40);
    expect(item.sku).toBe('KAR-01');
  });

  it('labels the variant and prefers its SKU', () => {
    const product = base({ options: [{ name: 'Ngjyra', values: ['E zezë'] }] });
    const variant: ProductVariant = { id: 'v1', optionValues: { Ngjyra: 'E zezë' }, sku: 'KAR-BLK', price: 110 };
    const item = buildOrderItem(product, variant, 1);
    expect(item.variantLabel).toBe('E zezë');
    expect(item.sku).toBe('KAR-BLK');
    expect(item.unitPrice).toBe(110);
  });

  it('floors quantity at 1 and applies the line discount', () => {
    const item = buildOrderItem(base(), null, 0, 25);
    expect(item.quantity).toBe(1);
    expect(item.total).toBe(75);
  });
});

describe('computeOrderTotals', () => {
  const items = [
    { productId: 'a', name: 'A', quantity: 2, unitPrice: 100, taxRatePercent: 20, total: 200 },
    { productId: 'b', name: 'B', quantity: 1, unitPrice: 50, total: 50 },
  ];

  it('sums lines, taxes only what is taxable, and adds shipping', () => {
    const t = computeOrderTotals(items, { shipping: 10 });
    expect(t.subtotal).toBe(250);
    expect(t.taxTotal).toBe(40); // 20% of the 200 line only
    expect(t.shippingTotal).toBe(10);
    expect(t.total).toBe(300);
    expect(t.itemCount).toBe(3);
  });

  it('spreads an order discount pro-rata before tax', () => {
    // 25 off 250 = 10% → the taxable base drops to 180, so tax is 36 not 40.
    const t = computeOrderTotals(items, { orderDiscount: 25 });
    expect(t.discountTotal).toBe(25);
    expect(t.taxTotal).toBe(36);
    expect(t.total).toBe(261);
  });

  it('clamps an oversized discount instead of going negative', () => {
    const t = computeOrderTotals(items, { orderDiscount: 9999 });
    expect(t.discountTotal).toBe(250);
    expect(t.total).toBe(0);
  });

  it('optionally taxes shipping at the highest line rate', () => {
    const t = computeOrderTotals(items, { shipping: 100, taxOnShipping: true });
    expect(t.taxTotal).toBe(60); // 40 on goods + 20 on shipping
  });

  it('handles an empty cart', () => {
    const t = computeOrderTotals([]);
    expect(t).toMatchObject({ subtotal: 0, total: 0, itemCount: 0 });
  });
});

describe('orderCogs', () => {
  it('sums cost across products and variants, skipping unknown costs', () => {
    const products = [
      base({ id: 'p1', costPrice: 60 }),
      base({ id: 'p2', variants: [{ id: 'v1', optionValues: {}, costPrice: 25 }] }),
      base({ id: 'p3' }),
    ];
    const items = [
      { productId: 'p1', name: 'A', quantity: 2, unitPrice: 100, total: 200 },
      { productId: 'p2', variantId: 'v1', name: 'B', quantity: 4, unitPrice: 40, total: 160 },
      { productId: 'p3', name: 'C', quantity: 1, unitPrice: 10, total: 10 },
    ];
    expect(orderCogs(items, products)).toBe(220);
  });
});
