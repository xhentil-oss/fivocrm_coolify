/**
 * @vitest-environment node
 *
 * Node, not jsdom: the drift guard reads `api/_projectInvoiceLines.ts` off disk.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { projectInvoiceLines, splitAmount, type InvoiceLineService } from './projectInvoiceLines';
import { cleanServiceMixInput, invoiceServiceMix, labelerFor, projectServiceMix, weightOf } from './serviceMix';
import type { InvoiceItem, Project, Service } from '../../types';
import { toAll } from '../utils';

const SERVICES: InvoiceLineService[] = [
  { id: 'seo', name: 'SEO Pro', category: 'SEO', price: 40_000, currency: 'ALL' },
  { id: 'ads', name: 'Google Ads', category: 'Ads', price: 60_000, currency: 'ALL' },
  { id: 'eur', name: 'Social', category: 'Social', price: 400, currency: 'EUR' },
  { id: 'free', name: 'Konsulencë', category: 'SEO', price: 0 },
];
const sum = (ls: { amount: number }[]) => Math.round(ls.reduce((t, l) => t + l.amount, 0) * 100) / 100;

describe('api/_projectInvoiceLines.ts', () => {
  it('is byte-identical to the canonical copy', () => {
    const root = resolve(__dirname, '../../..');
    expect(readFileSync(resolve(root, 'api/_projectInvoiceLines.ts'), 'utf8'))
      .toBe(readFileSync(resolve(root, 'src/lib/finance/projectInvoiceLines.ts'), 'utf8'));
  });
});

describe('splitAmount', () => {
  it('always sums to the total exactly (last line takes the rounding)', () => {
    const parts = splitAmount(100, [1, 1, 1]);
    expect(parts).toEqual([33.33, 33.33, 33.34]);
    expect(sum(parts.map(amount => ({ amount })))).toBe(100);
  });
});

describe('projectInvoiceLines', () => {
  it('splits the BUDGET by service price, not the catalogue prices themselves', () => {
    const lines = projectInvoiceLines({ total: 90_000, projectName: 'Acme', periodLabel: 'tetor 2026', serviceIds: ['seo', 'ads'], services: SERVICES });
    expect(lines).toEqual([
      { serviceId: 'seo', serviceLine: 'SEO', description: 'SEO Pro – tetor 2026', amount: 36_000 },
      { serviceId: 'ads', serviceLine: 'Ads', description: 'Google Ads – tetor 2026', amount: 54_000 },
    ]);
  });

  it('weights a EUR service in ALL, not 1:1', () => {
    const lines = projectInvoiceLines({ total: 100_000, projectName: 'Acme', serviceIds: ['seo', 'eur'], services: SERVICES });
    expect(lines[0].amount).toBe(50_000); // 40 000 L vs €400 ≈ 40 000 L
    expect(sum(lines)).toBe(100_000);
  });

  it('an explicit serviceMix wins and carries a sold service of that line', () => {
    const lines = projectInvoiceLines({
      total: 100_000, projectName: 'Acme', serviceIds: ['seo', 'ads'],
      serviceMix: [{ line: 'seo', pct: 70 }, { line: 'Ads', pct: 30 }, { line: 'Video', pct: 0 }], services: SERVICES,
    });
    expect(lines).toEqual([
      { serviceId: 'seo', serviceLine: 'seo', description: 'seo – Acme', amount: 70_000 },
      { serviceId: 'ads', serviceLine: 'Ads', description: 'Ads – Acme', amount: 30_000 },
    ]);
  });

  it('no services → one line with the project name; 0 total → none', () => {
    expect(projectInvoiceLines({ total: 5_000, projectName: 'Acme', periodLabel: 'tetor', services: SERVICES }))
      .toEqual([{ description: 'Acme – tetor', amount: 5_000 }]);
    expect(projectInvoiceLines({ total: 0, projectName: 'Acme', serviceIds: ['seo'], services: SERVICES })).toEqual([]);
  });

  it('all-zero prices split equally; unknown ids are ignored', () => {
    const lines = projectInvoiceLines({ total: 1_000, projectName: 'Acme', serviceIds: ['free', 'gone'], services: SERVICES });
    expect(lines).toEqual([{ serviceId: 'free', serviceLine: 'SEO', description: 'Konsulencë', amount: 1_000 }]);
  });

  it('the lines it writes are read back as the same split by the department P&L', () => {
    const lines = projectInvoiceLines({ total: 90_000, projectName: 'Acme', serviceIds: ['seo', 'ads'], services: SERVICES });
    const items = lines.map((l, i) => ({ id: String(i), invoiceId: 'inv', serviceId: l.serviceId, quantity: 1, unitPrice: l.amount, totalPrice: l.amount } as InvoiceItem));
    const services = SERVICES as Service[];
    const mix = invoiceServiceMix(items, new Map(services.map(s => [s.id, s])), labelerFor(services, []), []);
    expect(weightOf(mix, 'SEO')).toBeCloseTo(0.4);
    expect(weightOf(mix, 'Ads')).toBeCloseTo(0.6);
  });
});

describe('projectInvoiceLines — serviceLine + currency weights', () => {
  const toItems = (lines: ReturnType<typeof projectInvoiceLines>) =>
    lines.map((l, i) => ({ id: String(i), invoiceId: 'inv', serviceId: l.serviceId, serviceLine: l.serviceLine, quantity: 1, unitPrice: l.amount, totalPrice: l.amount } as InvoiceItem));

  it('an explicit split line with NO sold service is labelled, and read back as its own line', () => {
    // SEO 40 / Ads 60, only SEO sold: the Ads line has no serviceId.
    const lines = projectInvoiceLines({
      total: 100_000, projectName: 'Acme', serviceIds: ['seo'],
      serviceMix: [{ line: 'SEO', pct: 40 }, { line: 'Ads', pct: 60 }], services: SERVICES,
    });
    expect(lines.find(l => l.serviceLine === 'Ads')).toMatchObject({ amount: 60_000 });
    expect(lines.find(l => l.serviceLine === 'Ads')!.serviceId).toBeUndefined();
    const services = SERVICES as Service[];
    const label = labelerFor(services, []);
    const fallback = [{ line: 'SEO', weight: 0.4 }, { line: 'Ads', weight: 0.6 }];
    const mix = invoiceServiceMix(toItems(lines), new Map(services.map(s => [s.id, s])), label, fallback);
    // Was SEO 0.64 / Ads 0.36: the unlabelled Ads line was spread over the fallback.
    expect(weightOf(mix, 'SEO')).toBeCloseTo(0.4);
    expect(weightOf(mix, 'Ads')).toBeCloseTo(0.6);
  });

  it('a service with no category carries no serviceLine (the reader places it)', () => {
    const lines = projectInvoiceLines({ total: 100, projectName: 'Acme', serviceIds: ['nocat'], services: [{ id: 'nocat', name: 'X', price: 1 }] });
    expect(lines[0].serviceLine).toBeUndefined();
  });

  it('default currency weights agree with projectServiceMix (toAll) for a mixed-currency list', () => {
    const lines = projectInvoiceLines({ total: 100_000, projectName: 'Acme', serviceIds: ['seo', 'eur'], services: SERVICES });
    const services = SERVICES as Service[];
    const mix = projectServiceMix({ id: 'p', serviceIds: ['seo', 'eur'] } as Project, new Map(services.map(s => [s.id, s])), labelerFor(services, []));
    expect(lines[0].amount / 100_000).toBeCloseTo(weightOf(mix, 'SEO'));
    expect(lines[1].amount / 100_000).toBeCloseTo(weightOf(mix, 'Social'));
    expect(toAll(400, 'EUR')).toBe(40_000); // the shared default the two rely on
  });

  it('rateToAll overrides the default weights (configured rate)', () => {
    const lines = projectInvoiceLines({
      total: 100_000, projectName: 'Acme', serviceIds: ['seo', 'eur'], services: SERVICES,
      rateToAll: c => (c === 'EUR' ? 50 : 1), // €400 = 20 000 L vs 40 000 L
    });
    expect(lines.map(l => l.amount)).toEqual([66_666.67, 33_333.33]);
  });
});

describe('cleanServiceMixInput', () => {
  it('drops empty rows, merges spelling variants, keeps the first spelling', () => {
    expect(cleanServiceMixInput([
      { line: 'SEO', pct: 30 }, { line: ' seo ', pct: 10 }, { line: '', pct: 20 },
      { line: 'Ads', pct: NaN }, { line: 'Ads', pct: 60 }, { line: 'Web', pct: -5 },
    ])).toEqual([{ line: 'SEO', pct: 40 }, { line: 'Ads', pct: 60 }]);
    expect(cleanServiceMixInput(null)).toEqual([]);
  });
});
