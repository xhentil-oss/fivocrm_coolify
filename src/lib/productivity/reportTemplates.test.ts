import { describe, it, expect } from 'vitest';
import { getReportTemplate, normalizeServiceLine, summableFields, REPORT_TEMPLATES } from './reportTemplates';

describe('normalizeServiceLine', () => {
  it('maps direct keys and synonyms', () => {
    expect(normalizeServiceLine('SEO')).toBe('seo');
    expect(normalizeServiceLine('Google Ads')).toBe('ads');
    expect(normalizeServiceLine('Rrjetet Sociale')).toBe('social');
    expect(normalizeServiceLine('Dizajn')).toBe('design');
    expect(normalizeServiceLine('programim')).toBe('dev');
  });
  it('returns null for unknown / empty', () => {
    expect(normalizeServiceLine('accounting')).toBeNull();
    expect(normalizeServiceLine('')).toBeNull();
    expect(normalizeServiceLine(undefined)).toBeNull();
  });
});

describe('getReportTemplate', () => {
  it('returns the SEO template with fields', () => {
    const t = getReportTemplate('seo');
    expect(t?.label).toBe('SEO');
    expect(t?.fields.some((f) => f.key === 'backlinks')).toBe(true);
  });
  it('returns null for unknown serviceLine (→ standard fields only)', () => {
    expect(getReportTemplate('marketing-generic')).toBeNull();
  });
});

describe('summableFields', () => {
  it('only returns numeric summable fields', () => {
    const t = getReportTemplate('ads')!;
    const keys = summableFields(t).map((f) => f.key);
    expect(keys).toContain('adSpend');
    expect(keys).not.toContain('ctr'); // text
    expect(keys).not.toContain('optimizations'); // textarea
  });
});

describe('templates integrity', () => {
  it('every template has a unique key and at least one field', () => {
    const keys = new Set<string>();
    for (const t of REPORT_TEMPLATES) {
      expect(t.fields.length).toBeGreaterThan(0);
      expect(keys.has(t.key)).toBe(false);
      keys.add(t.key);
    }
  });
});
