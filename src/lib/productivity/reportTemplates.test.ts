import { describe, it, expect } from 'vitest';
import {
  getReportTemplate,
  normalizeServiceLine,
  summableFields,
  REPORT_TEMPLATES,
  positionOptions,
  positionLabel,
} from './reportTemplates';

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

describe('crafts (positions)', () => {
  it('web design is its own craft, not development', () => {
    // It used to alias to `dev`, so a Web Designer's daily report asked about bugs
    // fixed. Programming synonyms must stay on `dev`.
    expect(normalizeServiceLine('Web')).toBe('web');
    expect(normalizeServiceLine('UI/UX')).toBe('web');
    expect(normalizeServiceLine('Web Development')).toBe('dev');
    expect(normalizeServiceLine('zhvillim')).toBe('dev');

    const web = getReportTemplate('web')!;
    const keys = web.fields.map((f) => f.key);
    expect(keys).toContain('prototypes');
    expect(keys).not.toContain('bugsFixed');
  });

  it('resolves photo/video and regjia, in Albanian too', () => {
    expect(normalizeServiceLine('Foto & Video')).toBe('photo-video');
    expect(normalizeServiceLine('montazh')).toBe('photo-video');
    expect(normalizeServiceLine('Regji')).toBe('regjia');
    expect(getReportTemplate('regjia')?.fields.some((f) => f.key === 'storyboards')).toBe(true);
  });

  it('offers an honest option to people who deliver no client work', () => {
    // Declaring a position is mandatory at login. Without this option an owner or
    // accountant would have to claim a craft they don't practise — and would then be
    // asked about backlinks forever.
    expect(positionOptions().some((o) => o.key === 'management')).toBe(true);
    expect(normalizeServiceLine('Menaxhim')).toBe('management');
    expect(getReportTemplate('management')?.fields.some((f) => f.key === 'blockersRemoved')).toBe(true);
  });

  it('positionOptions mirrors the template registry exactly', () => {
    // The two must not drift: a position with no template = a blank daily report.
    expect(positionOptions().map((o) => o.key)).toEqual(REPORT_TEMPLATES.map((t) => t.key));
    for (const o of positionOptions()) {
      expect(o.label).toBeTruthy();
      expect(o.emoji).toBeTruthy();
    }
  });

  it('positionLabel resolves keys and synonyms, and is null when unset', () => {
    expect(positionLabel('web')).toContain('Web Design');
    expect(positionLabel('Rrjetet Sociale')).toContain('Social Media');
    expect(positionLabel(undefined)).toBeNull();
    expect(positionLabel('')).toBeNull();
    expect(positionLabel('accounting')).toBeNull();
  });
});
