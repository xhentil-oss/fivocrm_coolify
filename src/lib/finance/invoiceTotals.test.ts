import { describe, it, expect } from 'vitest';
import { computeInvoiceTotals, storedInvoiceTotals } from './invoiceTotals';

describe('computeInvoiceTotals', () => {
  it('adds tax after the discount', () => {
    const t = computeInvoiceTotals({ subtotal: 1000, discount: 100, discountType: 'fixed', tax: 180 });
    expect(t.discountAmount).toBe(100);
    expect(t.total).toBe(1080);
  });

  it('reads a percentage discount off the subtotal', () => {
    const t = computeInvoiceTotals({ subtotal: 1000, discount: 20, discountType: 'percent', tax: 0 });
    expect(t.discountAmount).toBe(200);
    expect(t.total).toBe(800);
  });

  // The regression: the form clamped, the detail view and the PDF did not, so a
  // fixed discount larger than the subtotal printed "−5000" under a total of 0.
  it('never discounts more than the subtotal', () => {
    const t = computeInvoiceTotals({ subtotal: 1000, discount: 5000, discountType: 'fixed', tax: 0 });
    expect(t.discountAmount).toBe(1000);
    expect(t.total).toBe(0);
    expect(t.subtotal - t.discountAmount + t.tax).toBe(t.total);
  });

  it('never discounts more than 100 per cent', () => {
    const t = computeInvoiceTotals({ subtotal: 1000, discount: 250, discountType: 'percent', tax: 0 });
    expect(t.discountAmount).toBe(1000);
    expect(t.total).toBe(0);
  });

  it('treats a missing or negative discount as none', () => {
    expect(computeInvoiceTotals({ subtotal: 500, tax: 0 }).total).toBe(500);
    expect(computeInvoiceTotals({ subtotal: 500, discount: -50, discountType: 'fixed', tax: 0 }).total).toBe(500);
  });

  it('always produces a box that adds up', () => {
    const cases = [
      { subtotal: 1234.56, discount: 7, discountType: 'percent', tax: 98.4 },
      { subtotal: 0, discount: 10, discountType: 'fixed', tax: 0 },
      { subtotal: 99.99, discount: 100, discountType: 'fixed', tax: 20 },
    ];
    for (const c of cases) {
      const t = computeInvoiceTotals(c);
      expect(t.subtotal - t.discountAmount + t.tax).toBeCloseTo(t.total, 6);
    }
  });
});

describe('storedInvoiceTotals', () => {
  it('uses the stored subtotal when there is one', () => {
    const t = storedInvoiceTotals({ subtotal: 1000, total: 1080, tax: 180, discount: 100, discountType: 'fixed' } as any);
    expect(t.subtotal).toBe(1000);
    expect(t.total).toBe(1080);
  });

  // A legacy invoice has no `subtotal`. The PDF used to fall back to the TOTAL,
  // which printed "Nëntotali = Totali" and a discount line under it — a box
  // contradicting itself. The subtotal is reconstructed instead.
  it('reconstructs a missing subtotal from a fixed discount', () => {
    const t = storedInvoiceTotals({ total: 1080, tax: 180, discount: 100, discountType: 'fixed' } as any);
    expect(t.subtotal).toBe(1000);
    expect(t.subtotal - t.discountAmount + t.tax).toBeCloseTo(t.total, 6);
  });

  it('reconstructs a missing subtotal from a percentage discount', () => {
    const t = storedInvoiceTotals({ total: 800, tax: 0, discount: 20, discountType: 'percent' } as any);
    expect(t.subtotal).toBeCloseTo(1000, 6);
    expect(t.subtotal - t.discountAmount + t.tax).toBeCloseTo(t.total, 6);
  });

  it('keeps the stored total as the figure owed, whatever the box says', () => {
    // The stored total is what was issued and paid against; only the breakdown
    // is reconstructed.
    const t = storedInvoiceTotals({ total: 777, tax: 0, discount: 0 } as any);
    expect(t.total).toBe(777);
  });

  it('falls back to `amount` for invoices written before `total` existed', () => {
    const t = storedInvoiceTotals({ amount: 500, tax: 0 } as any);
    expect(t.total).toBe(500);
    expect(t.subtotal).toBe(500);
  });
});

describe('computeInvoiceTotals rounding', () => {
  it('rounds every figure to cents', () => {
    const t = computeInvoiceTotals({ subtotal: 100, discount: 33.3333, discountType: 'percent', tax: 0 });
    expect(t.discountAmount).toBe(33.33);
    expect(t.total).toBe(66.67);
    const f = computeInvoiceTotals({ subtotal: 0.1 + 0.2, tax: 0 });
    expect(f.total).toBe(0.3);
    expect(computeInvoiceTotals({ subtotal: 10.005, tax: 0 }).total).toBe(10.01);
  });
});
