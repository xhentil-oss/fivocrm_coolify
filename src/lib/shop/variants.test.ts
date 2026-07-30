import { describe, expect, it } from 'vitest';
import {
  buildVariantMatrix,
  cartesian,
  hasVariants,
  normalizeOptions,
  variantCount,
  variantKey,
  variantLabel,
} from './variants';
import type { ProductVariant } from '../../types';

let seq = 0;
const makeId = () => `id${++seq}`;

describe('normalizeOptions', () => {
  it('drops empty axes/values and de-duplicates case-insensitively', () => {
    const out = normalizeOptions([
      { name: ' Madhësia ', values: ['S', 's', ' M ', ''] },
      { name: '', values: ['x'] },
      { name: 'Ngjyra', values: [] },
    ]);
    expect(out).toEqual([{ name: 'Madhësia', values: ['S', 'M'] }]);
  });

  it('caps at three axes', () => {
    const out = normalizeOptions([
      { name: 'a', values: ['1'] },
      { name: 'b', values: ['1'] },
      { name: 'c', values: ['1'] },
      { name: 'd', values: ['1'] },
    ]);
    expect(out.map(o => o.name)).toEqual(['a', 'b', 'c']);
  });
});

describe('cartesian', () => {
  it('produces every combination in order', () => {
    expect(cartesian([['S', 'M'], ['Zi', 'Bardhë']])).toEqual([
      ['S', 'Zi'], ['S', 'Bardhë'], ['M', 'Zi'], ['M', 'Bardhë'],
    ]);
  });

  it('returns a single empty combination for no axes', () => {
    expect(cartesian([])).toEqual([[]]);
  });
});

describe('variantKey / variantLabel', () => {
  it('keys by option-name order, not object key order', () => {
    const a = variantKey({ Ngjyra: 'Zi', Madhësia: 'M' }, ['Madhësia', 'Ngjyra']);
    const b = variantKey({ Madhësia: 'M', Ngjyra: 'Zi' }, ['Madhësia', 'Ngjyra']);
    expect(a).toBe(b);
  });

  it('labels in option order', () => {
    expect(variantLabel({ Ngjyra: 'Zi', Madhësia: 'M' }, ['Madhësia', 'Ngjyra'])).toBe('M / Zi');
  });
});

describe('buildVariantMatrix', () => {
  const options = [
    { name: 'Madhësia', values: ['S', 'M'] },
    { name: 'Ngjyra', values: ['Zi'] },
  ];

  it('generates one variant per combination', () => {
    seq = 0;
    const out = buildVariantMatrix(options, [], makeId);
    expect(out).toHaveLength(2);
    expect(out[0].optionValues).toEqual({ Madhësia: 'S', Ngjyra: 'Zi' });
    expect(out.every(v => v.isActive === true)).toBe(true);
  });

  it('preserves SKU/price/stock for combinations that still exist', () => {
    seq = 0;
    const existing: ProductVariant[] = [
      { id: 'keep', optionValues: { Madhësia: 'M', Ngjyra: 'Zi' }, sku: 'X-M', price: 42, stockQty: 7 },
    ];
    const out = buildVariantMatrix(options, existing, makeId);
    const kept = out.find(v => v.optionValues.Madhësia === 'M')!;
    expect(kept.id).toBe('keep');
    expect(kept.sku).toBe('X-M');
    expect(kept.price).toBe(42);
    expect(kept.stockQty).toBe(7);
  });

  it('drops variants whose combination no longer exists', () => {
    seq = 0;
    const existing: ProductVariant[] = [
      { id: 'gone', optionValues: { Madhësia: 'XL', Ngjyra: 'Zi' }, sku: 'X-XL' },
    ];
    const out = buildVariantMatrix(options, existing, makeId);
    expect(out.find(v => v.id === 'gone')).toBeUndefined();
  });

  it('returns nothing when there are no usable options', () => {
    expect(buildVariantMatrix([], [], makeId)).toEqual([]);
    expect(buildVariantMatrix(undefined, [], makeId)).toEqual([]);
  });
});

describe('variantCount / hasVariants', () => {
  it('multiplies the axes', () => {
    expect(variantCount([{ name: 'a', values: ['1', '2'] }, { name: 'b', values: ['x', 'y', 'z'] }])).toBe(6);
    expect(variantCount([])).toBe(0);
  });

  it('requires both options and generated variants', () => {
    expect(hasVariants({ options: [{ name: 'a', values: ['1'] }], variants: [] })).toBe(false);
    expect(hasVariants({ options: [], variants: [{ id: 'v', optionValues: {} }] })).toBe(false);
    expect(hasVariants({ options: [{ name: 'a', values: ['1'] }], variants: [{ id: 'v', optionValues: { a: '1' } }] })).toBe(true);
  });
});
