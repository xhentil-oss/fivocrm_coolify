import { describe, it, expect } from 'vitest';
import {
  sanitizeHtml, cn, safeHref,
  toAll, fromAll, formatCurrency, formatEUR, formatALL, parseLocalDate,
  normalizeAlbanianPhone, validatePhone,
} from './utils';

describe('cn', () => {
  it('merges class names', () => {
    expect(cn('foo', 'bar')).toBe('foo bar');
  });

  it('handles conditional classes', () => {
    const hide = false;
    expect(cn('base', hide && 'hidden', 'visible')).toBe('base visible');
  });
});

describe('sanitizeHtml', () => {
  it('strips script tags', () => {
    const result = sanitizeHtml('<p>Hello</p><script>alert("xss")</script>');
    expect(result).not.toContain('<script');
    expect(result).toContain('Hello');
  });

  it('strips event handlers', () => {
    const result = sanitizeHtml('<img src="x" onerror="alert(1)">');
    expect(result).not.toContain('onerror');
  });

  it('allows safe tags', () => {
    const result = sanitizeHtml('<strong>Bold</strong> <em>Italic</em>');
    expect(result).toContain('<strong>');
    expect(result).toContain('<em>');
  });
});

describe('safeHref', () => {
  it('returns # for javascript: URLs', () => {
    expect(safeHref('javascript:alert(1)')).toBe('#');
  });

  it('passes through https URLs', () => {
    expect(safeHref('https://example.com')).toBe('https://example.com');
  });

  it('returns # for null/undefined', () => {
    expect(safeHref(null)).toBe('#');
    expect(safeHref(undefined)).toBe('#');
  });
});

describe('toAll', () => {
  it('leaves ALL/undefined amounts unchanged', () => {
    expect(toAll(100)).toBe(100);
    expect(toAll(100, 'ALL')).toBe(100);
  });

  it('converts EUR to ALL using the configured rate', () => {
    // No localStorage value in jsdom defaults → DEFAULT_EUR_ALL_RATE (100)
    expect(toAll(5, 'EUR')).toBe(500);
  });
});

describe('fromAll', () => {
  it('leaves ALL/undefined amounts unchanged', () => {
    expect(fromAll(500)).toBe(500);
    expect(fromAll(500, 'ALL')).toBe(500);
  });

  it('expresses an ALL total in EUR', () => {
    expect(fromAll(500, 'EUR')).toBe(5);
  });

  it('round-trips with toAll', () => {
    expect(fromAll(toAll(37, 'EUR'), 'EUR')).toBeCloseTo(37, 6);
  });

  it('treats an unknown currency as ALL rather than dividing by zero', () => {
    expect(fromAll(250, 'XYZ')).toBe(250);
  });
});

describe('formatCurrency', () => {
  // Assertions stay tolerant of ICU/locale differences between CI and dev:
  // the symbol may render as '€' or the literal 'EUR' (fallback path).
  it('formats EUR with two decimals', () => {
    const out = formatEUR(1234.5);
    expect(out).toMatch(/€|EUR/);
    expect(out).toMatch(/[,.]50\b/); // cents present
  });

  it('formats ALL with no decimals', () => {
    const out = formatALL(1234.9);
    expect(out).not.toMatch(/[,.]\d{2}(?!\d)/); // no two-digit cents group
  });

  it('coerces NaN/Infinity to 0', () => {
    expect(formatCurrency(NaN)).toMatch(/0/);
    expect(formatCurrency(Infinity)).toMatch(/0/);
  });

  it('never throws', () => {
    expect(() => formatCurrency(10, 'EUR')).not.toThrow();
    expect(() => formatCurrency(10, 'ALL')).not.toThrow();
  });
});

describe('parseLocalDate', () => {
  it('parses YYYY-MM-DD at local midnight (no UTC shift)', () => {
    const d = parseLocalDate('2026-06-10')!;
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(5); // June (0-indexed)
    expect(d.getDate()).toBe(10);
    expect(d.getHours()).toBe(0);
  });

  it('returns null for empty/invalid input', () => {
    expect(parseLocalDate('')).toBeNull();
    expect(parseLocalDate(null)).toBeNull();
    expect(parseLocalDate('not-a-date')).toBeNull();
  });
});

describe('normalizeAlbanianPhone', () => {
  it('strips the trunk-prefix zero from 3550…', () => {
    expect(normalizeAlbanianPhone('3550691234567')).toBe('355691234567');
  });

  it('prepends country code to local 0… format', () => {
    expect(normalizeAlbanianPhone('0691234567')).toBe('355691234567');
  });

  it('prepends 355 to a bare 9-digit mobile', () => {
    expect(normalizeAlbanianPhone('691234567')).toBe('355691234567');
  });
});

describe('validatePhone', () => {
  it('accepts a valid Albanian mobile and returns normalized form', () => {
    expect(validatePhone('069 123 4567')).toBe('355691234567');
  });

  it('rejects garbage and too-short numbers', () => {
    expect(validatePhone('abc')).toBeNull();
    expect(validatePhone('123')).toBeNull();
    expect(validatePhone('')).toBeNull();
  });
});
