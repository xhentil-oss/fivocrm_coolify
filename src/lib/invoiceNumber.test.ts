import { describe, it, expect } from 'vitest';
import { parseInvoiceSeq, formatInvoiceNumber, nextInvoiceSeq } from './invoiceNumber';

describe('parseInvoiceSeq', () => {
  it('parses FAT-XXX numbers (with leading zeros)', () => {
    expect(parseInvoiceSeq('FAT-001')).toBe(1);
    expect(parseInvoiceSeq('FAT-027')).toBe(27);
    expect(parseInvoiceSeq('FAT-340')).toBe(340);
    expect(parseInvoiceSeq('FAT-1000')).toBe(1000);
    expect(parseInvoiceSeq('fat-042')).toBe(42); // case-insensitive
    expect(parseInvoiceSeq(' FAT-005 ')).toBe(5); // trimmed
  });

  it('returns 0 for non-FAT / empty / malformed values', () => {
    expect(parseInvoiceSeq(null)).toBe(0);
    expect(parseInvoiceSeq(undefined)).toBe(0);
    expect(parseInvoiceSeq('')).toBe(0);
    expect(parseInvoiceSeq('AUTO-2026-01-ABCDEF')).toBe(0);
    expect(parseInvoiceSeq('DRAFT-2026-02-XYZ')).toBe(0);
    expect(parseInvoiceSeq('INV-12')).toBe(0);
    expect(parseInvoiceSeq('abcdef12')).toBe(0);
  });
});

describe('formatInvoiceNumber', () => {
  it('zero-pads to at least 3 digits', () => {
    expect(formatInvoiceNumber(1)).toBe('FAT-001');
    expect(formatInvoiceNumber(27)).toBe('FAT-027');
    expect(formatInvoiceNumber(341)).toBe('FAT-341');
    expect(formatInvoiceNumber(1000)).toBe('FAT-1000');
  });

  it('round-trips with parseInvoiceSeq', () => {
    for (const seq of [1, 9, 27, 340, 999, 1234]) {
      expect(parseInvoiceSeq(formatInvoiceNumber(seq))).toBe(seq);
    }
  });
});

describe('nextInvoiceSeq', () => {
  it('starts at 1 when there is nothing yet', () => {
    expect(nextInvoiceSeq(0, [])).toBe(1);
    expect(nextInvoiceSeq(undefined, [])).toBe(1);
  });

  it('increments the stored counter when it is ahead', () => {
    expect(nextInvoiceSeq(340, ['FAT-100', 'FAT-200'])).toBe(341);
  });

  it('heals a stale/low counter by using the max existing number', () => {
    // The reported bug: 340 invoices exist but the counter drifted to 26 → without
    // the max() guard the next number would be FAT-027 (a collision).
    const existing = Array.from({ length: 340 }, (_, i) => formatInvoiceNumber(i + 1));
    expect(nextInvoiceSeq(26, existing)).toBe(341);
    expect(formatInvoiceNumber(nextInvoiceSeq(26, existing))).toBe('FAT-341');
  });

  it('ignores non-FAT numbers when computing the max', () => {
    expect(nextInvoiceSeq(0, ['AUTO-x', 'DRAFT-y', 'FAT-050', null, undefined])).toBe(51);
  });

  it('never produces a number that collides with an existing one', () => {
    const existing = ['FAT-001', 'FAT-002', 'FAT-027', 'FAT-340', 'AUTO-abc', null];
    const existingSeqs = new Set(existing.map(parseInvoiceSeq));
    for (const storedCounter of [0, 1, 26, 27, 100, 339, 340, 500]) {
      const next = nextInvoiceSeq(storedCounter, existing);
      // strictly greater than every existing number → no collision, no reuse
      expect(next).toBeGreaterThan(340);
      expect(existingSeqs.has(next)).toBe(false);
    }
  });

  it('advances monotonically across repeated issuance (simulating the counter)', () => {
    // Simulate the Firestore transaction: newLast = max(stored, fallbackMax) + 1,
    // persisting newLast back as the stored counter each time.
    let counter = 0;
    const issued: number[] = [];
    const existingMax = 340; // pretend 340 invoices already exist
    for (let i = 0; i < 5; i++) {
      counter = nextInvoiceSeq(counter, [formatInvoiceNumber(existingMax)]);
      issued.push(counter);
    }
    expect(issued).toEqual([341, 342, 343, 344, 345]);
    // strictly increasing, no duplicates
    expect(new Set(issued).size).toBe(issued.length);
  });
});
