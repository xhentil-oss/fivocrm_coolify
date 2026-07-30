import { describe, expect, it } from 'vitest';
import {
  isPortalVisible,
  nextOrderNumber,
  parseCsvNumber,
  parseOrderSeq,
  primaryImage,
  productFromCsvRow,
  productHaystack,
  slugify,
  suggestSku,
  uniqueSlug,
  validateProduct,
} from './product';
import type { Product } from '../../types';

const base = (over: Partial<Product> = {}): Product => ({
  id: 'p1',
  name: 'Karrige Zyre',
  price: 100,
  createdAt: new Date(),
  updatedAt: new Date(),
  createdByUserId: null,
  ...over,
});

describe('slugify', () => {
  it('transliterates Albanian letters and normalizes separators', () => {
    expect(slugify('Çanta të Bardha ËË')).toBe('canta-te-bardha-ee');
    expect(slugify('  Karrige   Zyre  ')).toBe('karrige-zyre');
    expect(slugify('!!!')).toBe('');
  });
});

describe('uniqueSlug', () => {
  it('suffixes on collision', () => {
    expect(uniqueSlug('Karrige', ['karrige'])).toBe('karrige-2');
    expect(uniqueSlug('Karrige', ['karrige', 'karrige-2'])).toBe('karrige-3');
    expect(uniqueSlug('Karrige', [])).toBe('karrige');
  });

  it('falls back to a usable base for unslugifiable names', () => {
    expect(uniqueSlug('###', [])).toBe('produkt');
  });
});

describe('suggestSku', () => {
  it('builds a short code from the first two words', () => {
    expect(suggestSku('Karrige Zyre')).toBe('KAR-ZYR');
    expect(suggestSku('Karrige Zyre', '01')).toBe('KAR-ZYR-01');
    expect(suggestSku('###')).toBe('PRD');
  });
});

describe('order numbering', () => {
  it('parses only numbers from the requested year', () => {
    expect(parseOrderSeq('POR-2026-0007', 2026)).toBe(7);
    expect(parseOrderSeq('POR-2025-0007', 2026)).toBe(0);
    expect(parseOrderSeq('FAT-001', 2026)).toBe(0);
    expect(parseOrderSeq(null, 2026)).toBe(0);
  });

  it('continues after the highest existing number of that year', () => {
    expect(nextOrderNumber(['POR-2026-0001', 'POR-2026-0009', 'POR-2025-0099'], 2026)).toBe('POR-2026-0010');
  });

  it('starts a fresh sequence per year', () => {
    expect(nextOrderNumber(['POR-2025-0042'], 2026)).toBe('POR-2026-0001');
    expect(nextOrderNumber([], 2026)).toBe('POR-2026-0001');
  });
});

describe('primaryImage', () => {
  it('prefers the flagged primary, then position', () => {
    expect(primaryImage({ images: [{ url: 'a' }, { url: 'b', isPrimary: true }] })).toBe('b');
    expect(primaryImage({ images: [{ url: 'a', position: 2 }, { url: 'b', position: 1 }] })).toBe('b');
    expect(primaryImage({ images: [] })).toBeUndefined();
  });
});

describe('productHaystack', () => {
  it('includes SKU, tags and variant values', () => {
    const hay = productHaystack(base({
      sku: 'KAR-01',
      tags: ['Zbritje'],
      variants: [{ id: 'v1', optionValues: { Ngjyra: 'E Zezë' }, sku: 'KAR-BLK' }],
    }));
    expect(hay).toContain('kar-01');
    expect(hay).toContain('zbritje');
    expect(hay).toContain('e zezë');
    expect(hay).toContain('kar-blk');
  });
});

describe('isPortalVisible', () => {
  it('requires both the flag and an Active status', () => {
    expect(isPortalVisible(base({ visibleInPortal: true, status: 'Active' }))).toBe(true);
    expect(isPortalVisible(base({ visibleInPortal: true, status: 'Draft' }))).toBe(false);
    expect(isPortalVisible(base({ visibleInPortal: false, status: 'Active' }))).toBe(false);
    expect(isPortalVisible(base({ status: 'Active' }))).toBe(false);
  });
});

describe('validateProduct', () => {
  it('accepts a minimal valid draft', () => {
    expect(validateProduct({ name: 'X', price: 10 })).toEqual([]);
  });

  it('rejects a missing name and a negative price', () => {
    const errs = validateProduct({ name: '  ', price: -1 });
    expect(errs).toHaveLength(2);
  });

  it('rejects a compare-at price below the selling price', () => {
    expect(validateProduct({ name: 'X', price: 100, compareAtPrice: 80 })).toHaveLength(1);
    expect(validateProduct({ name: 'X', price: 100, compareAtPrice: 120 })).toEqual([]);
  });

  it('rejects an out-of-range tax rate and inverted order quantities', () => {
    expect(validateProduct({ name: 'X', price: 1, taxRatePercent: 150 })).toHaveLength(1);
    expect(validateProduct({ name: 'X', price: 1, minOrderQty: 5, maxOrderQty: 2 })).toHaveLength(1);
  });

  it('rejects a price tier starting below 2 units', () => {
    expect(validateProduct({ name: 'X', price: 1, priceTiers: [{ minQty: 1, unitPrice: 1 }] })).toHaveLength(1);
  });

  it('rejects an option matrix beyond the cap', () => {
    const values = Array.from({ length: 20 }, (_, i) => `v${i}`);
    const errs = validateProduct({
      name: 'X',
      price: 1,
      options: [{ name: 'a', values }, { name: 'b', values }],
    });
    expect(errs.some(e => e.includes('Kombinimet'))).toBe(true);
  });
});

describe('parseCsvNumber', () => {
  it('handles both European and US separators', () => {
    expect(parseCsvNumber('1.299,50')).toBe(1299.5);
    expect(parseCsvNumber('1,299.50')).toBe(1299.5);
    expect(parseCsvNumber('1299.5')).toBe(1299.5);
    expect(parseCsvNumber('1299,5')).toBe(1299.5);
  });

  it('reads a single separator with three trailing digits as thousands', () => {
    // sq-AL prices in whole Lekë: "1.200" is 1200, never 1.2.
    expect(parseCsvNumber('2,500')).toBe(2500);
    expect(parseCsvNumber('1.200')).toBe(1200);
    expect(parseCsvNumber('1.234.567')).toBe(1234567);
    expect(parseCsvNumber('10.5')).toBe(10.5);
  });

  it('strips currency noise and rejects junk', () => {
    expect(parseCsvNumber('1 200 ALL')).toBe(1200);
    expect(parseCsvNumber('')).toBeUndefined();
    expect(parseCsvNumber(null)).toBeUndefined();
    expect(parseCsvNumber('abc')).toBeUndefined();
  });
});

describe('productFromCsvRow', () => {
  it('maps a full row and turns on tracking when stock is present', () => {
    const draft = productFromCsvRow({
      name: ' Karrige ',
      sku: 'KAR-01',
      price: '1.200',
      costPrice: '800',
      currency: 'eur',
      stockQty: '15',
      tags: 'zbritje; zyre',
      taxRatePercent: '20',
    });
    expect(draft).toMatchObject({
      name: 'Karrige',
      sku: 'KAR-01',
      price: 1200,
      costPrice: 800,
      currency: 'EUR',
      stockQty: 15,
      trackInventory: true,
      taxRatePercent: 20,
      status: 'Draft',
      visibleInPortal: false,
    });
    expect(draft.tags).toEqual(['zbritje', 'zyre']);
  });

  it('imports as a draft and leaves unknown currencies alone', () => {
    const draft = productFromCsvRow({ name: 'X', price: '5', currency: 'XYZ' });
    expect(draft.currency).toBeUndefined();
    expect(draft.trackInventory).toBeUndefined();
    expect(draft.status).toBe('Draft');
  });
});
