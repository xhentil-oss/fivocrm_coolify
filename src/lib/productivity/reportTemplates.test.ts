import { describe, it, expect } from 'vitest';
import {
  getReportTemplate,
  normalizeServiceLine,
  summableFields,
  REPORT_TEMPLATES,
  positionOptions,
  positionLabel,
  fieldsByKind,
  requiredFields,
  perClientKey,
  parseFieldKey,
  sumFieldValue,
  valuesByCustomer,
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

describe('every craft is asked the same four movements', () => {
  it('has output and a next step — a report without a next step is a diary', () => {
    for (const t of REPORT_TEMPLATES) {
      expect(fieldsByKind(t, 'output').length, t.key).toBeGreaterThan(0);
      expect(fieldsByKind(t, 'next').length, t.key).toBeGreaterThan(0);
    }
  });

  it('makes the next step mandatory everywhere', () => {
    for (const t of REPORT_TEMPLATES) {
      expect(fieldsByKind(t, 'next').some((f) => f.required), t.key).toBe(true);
    }
  });

  it('asks about impact or risk — the two questions people skip unprompted', () => {
    for (const t of REPORT_TEMPLATES) {
      const reflective = fieldsByKind(t, 'impact').length + fieldsByKind(t, 'risk').length;
      expect(reflective, t.key).toBeGreaterThan(0);
    }
  });

  it('keeps the daily habit short — nobody answers 15 questions every evening', () => {
    for (const t of REPORT_TEMPLATES) {
      expect(t.fields.length, t.key).toBeLessThanOrEqual(12);
      expect(requiredFields(t).length, t.key).toBeLessThanOrEqual(4);
    }
  });
});

describe('field definitions are internally consistent', () => {
  it('has unique keys inside each template', () => {
    for (const t of REPORT_TEMPLATES) {
      const keys = t.fields.map((f) => f.key);
      expect(new Set(keys).size, t.key).toBe(keys.length);
    }
  });

  it('gives every select its options and no other type any', () => {
    for (const t of REPORT_TEMPLATES) {
      for (const f of t.fields) {
        if (f.type === 'select') expect(f.options?.length, `${t.key}.${f.key}`).toBeGreaterThan(1);
        else expect(f.options, `${t.key}.${f.key}`).toBeUndefined();
      }
    }
  });

  it('only puts minChars on written answers', () => {
    for (const t of REPORT_TEMPLATES) {
      for (const f of t.fields) {
        if (f.minChars !== undefined) expect(['text', 'textarea'], `${t.key}.${f.key}`).toContain(f.type);
      }
    }
  });

  it('never marks a rate or ratio summable — summing CPL across a week is nonsense', () => {
    const ads = getReportTemplate('ads')!;
    const keys = summableFields(ads).map((f) => f.key);
    expect(keys).toContain('adSpend');
    expect(keys).not.toContain('cpl');
    expect(keys).not.toContain('roas');
  });

  it('labels every field', () => {
    for (const t of REPORT_TEMPLATES) {
      for (const f of t.fields) expect(f.label.trim().length, `${t.key}.${f.key}`).toBeGreaterThan(0);
    }
  });
});

describe('per-client storage', () => {
  it('round-trips a key', () => {
    const k = perClientKey('backlinks', 'cust-1');
    expect(k).toBe('backlinks.cust-1');
    expect(parseFieldKey(k)).toEqual({ fieldKey: 'backlinks', customerId: 'cust-1' });
  });

  it('reads a plain key as having no client', () => {
    expect(parseFieldKey('backlinks')).toEqual({ fieldKey: 'backlinks' });
  });

  it('survives a customer id that itself contains a dot', () => {
    const k = perClientKey('posts', 'a.b.c');
    expect(parseFieldKey(k)).toEqual({ fieldKey: 'posts', customerId: 'a.b.c' });
  });

  it('sums a field across every client — the whole point of the helper', () => {
    // Reading `customFields.backlinks` directly would report 0 here, and the weekly
    // rollup would silently claim the SEO did nothing all week.
    const cf = { 'backlinks.c1': 3, 'backlinks.c2': 5, backlinks: 1, 'posts.c1': 9 };
    expect(sumFieldValue(cf, 'backlinks')).toBe(9);
    expect(sumFieldValue(cf, 'posts')).toBe(9);
    expect(sumFieldValue(cf, 'missing')).toBe(0);
    expect(sumFieldValue(undefined, 'backlinks')).toBe(0);
  });

  it('ignores non-numeric values when summing', () => {
    expect(sumFieldValue({ 'backlinks.c1': 'shumë' as any, 'backlinks.c2': 4 }, 'backlinks')).toBe(4);
  });

  it('lists values per client and drops the empty ones', () => {
    const cf = { 'awaitingApproval.c1': 'tekstet', 'awaitingApproval.c2': '', nextStep: 'X' };
    expect(valuesByCustomer(cf, 'awaitingApproval')).toEqual([{ customerId: 'c1', value: 'tekstet' }]);
    expect(valuesByCustomer(cf, 'nextStep')).toEqual([{ customerId: '', value: 'X' }]);
  });
});
