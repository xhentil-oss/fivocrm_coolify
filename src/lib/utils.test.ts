import { describe, it, expect } from 'vitest';
import {
  sanitizeHtml, cn, safeHref,
  toAll, fromAll, formatCurrency, formatEUR, formatALL, parseLocalDate,
  currencySymbol, formatCompact, formatCompactRange,
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

// Lek is the house currency: the abbreviated forms used to drop the unit
// entirely ("50k"), which read as an unlabelled number beside a formatted one.
describe('currencySymbol', () => {
  it('maps the four supported codes', () => {
    expect(currencySymbol('ALL')).toBe('L');
    expect(currencySymbol('EUR')).toBe('€');
    expect(currencySymbol('USD')).toBe('$');
    expect(currencySymbol('GBP')).toBe('£');
  });

  it('falls back to Lek for missing or unknown codes, never the ISO string', () => {
    expect(currencySymbol(undefined)).toBe('L');
    expect(currencySymbol(null)).toBe('L');
    expect(currencySymbol('')).toBe('L');
    expect(currencySymbol('XYZ')).toBe('L');
  });
});

describe('formatCompact', () => {
  it('always names the currency', () => {
    expect(formatCompact(50_000)).toBe('50k L');
    expect(formatCompact(500)).toBe('500 L');
    expect(formatCompact(1_250_000)).toBe('1,3M L');
    expect(formatCompact(50_000, 'EUR')).toBe('50k €');
  });

  it('keeps the sign on negatives and survives junk input', () => {
    expect(formatCompact(-50_000)).toBe('-50k L');
    expect(formatCompact(-2_000_000)).toBe('-2,0M L');
    expect(formatCompact(NaN)).toBe('0 L');
    expect(formatCompact(Infinity)).toBe('0 L');
  });
});

describe('formatCompactRange', () => {
  it('prints the unit once, at the end', () => {
    expect(formatCompactRange(318_000, 450_000)).toBe('318k / 450k L');
    expect(formatCompactRange(0, 240_000)).toBe('0 / 240k L');
    expect(formatCompactRange(1_000, 2_000_000, 'EUR')).toBe('1k / 2,0M €');
  });
});

describe('sanitizeHtml — bypasses of the old hand-rolled walker', () => {
  it('re-sanitizes children promoted out of a stripped tag (<form><img onerror>)', () => {
    const out = sanitizeHtml('<form><img src=x onerror=alert(1)></form>');
    expect(out).not.toContain('onerror');
    expect(out).not.toContain('<form');
  });

  it('strips javascript: hrefs even when wrapped in an unknown tag', () => {
    const out = sanitizeHtml('<x><a href="javascript:alert(1)">c</a></x>');
    expect(out).not.toMatch(/javascript:/i);
    expect(out).toContain('c');
  });

  it('strips javascript: hidden behind an HTML entity (java&#9;script:)', () => {
    const out = sanitizeHtml('<a href="java&#9;script:alert(1)">t</a>');
    expect(out).not.toMatch(/script:/i);
    expect(out).not.toContain('href=');
    expect(out).toContain('t');
  });

  it('drops style attributes everywhere', () => {
    const out = sanitizeHtml('<div style="position:fixed;top:0">x</div><p style="color:red">y</p>');
    expect(out).not.toContain('style=');
    expect(out).toContain('<div>x</div>');
  });

  it('drops data: image sources', () => {
    const out = sanitizeHtml('<img src="data:text/html,<script>alert(1)</script>" alt="a">');
    expect(out).not.toMatch(/data:/i);
    expect(out).not.toContain('<script');
  });

  it('drops other non-web schemes and event handlers on allowed tags', () => {
    expect(sanitizeHtml('<a href="vbscript:msgbox(1)">v</a>')).not.toMatch(/vbscript/i);
    expect(sanitizeHtml('<a href="data:text/html,x">d</a>')).not.toMatch(/data:/i);
    expect(sanitizeHtml('<p onclick="alert(1)">p</p>')).not.toContain('onclick');
    expect(sanitizeHtml('<p data-x="1">p</p>')).not.toContain('data-x');
  });

  it('keeps a benign document and hardens its links', () => {
    const out = sanitizeHtml('<p><strong>ok</strong> <a href="https://x.y">l</a></p>');
    expect(out).toContain('<strong>ok</strong>');
    expect(out).toContain('href="https://x.y"');
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).toContain('>l</a>');
  });

  it('keeps mailto links, relative links and http(s) images', () => {
    expect(sanitizeHtml('<a href="mailto:a@b.c">m</a>')).toContain('href="mailto:a@b.c"');
    expect(sanitizeHtml('<a href="/app/x">r</a>')).toContain('href="/app/x"');
    expect(sanitizeHtml('<img src="https://x.y/a.png" alt="a" width="10" height="10">')).toContain('src="https://x.y/a.png"');
  });

  it('returns an empty string for empty input', () => {
    expect(sanitizeHtml('')).toBe('');
  });
});

describe('safeHref — parsed, not regex-matched', () => {
  it('allows http, https, mailto, tel and same-origin relative paths', () => {
    expect(safeHref('http://example.com/a')).toBe('http://example.com/a');
    expect(safeHref('mailto:a@b.c')).toBe('mailto:a@b.c');
    expect(safeHref('tel:+355691234567')).toBe('tel:+355691234567');
    expect(safeHref('/app/dashboard?x=1')).toBe('/app/dashboard?x=1');
    expect(safeHref('invoices/1')).toBe('invoices/1');
    expect(safeHref('#top')).toBe('#top');
  });

  it('refuses scheme tricks and paths that leave the origin', () => {
    expect(safeHref('java\tscript:alert(1)')).toBe('#');
    expect(safeHref('JAVASCRIPT:alert(1)')).toBe('#');
    expect(safeHref('data:text/html,x')).toBe('#');
    expect(safeHref('vbscript:x')).toBe('#');
    expect(safeHref('file:///etc/passwd')).toBe('#');
    expect(safeHref('//evil.com/x')).toBe('#');
    expect(safeHref('/\\evil.com/x')).toBe('#');
    expect(safeHref('   ')).toBe('#');
  });
});
