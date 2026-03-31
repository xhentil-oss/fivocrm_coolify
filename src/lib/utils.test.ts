import { describe, it, expect } from 'vitest';
import { sanitizeHtml, cn, safeHref } from './utils';

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
