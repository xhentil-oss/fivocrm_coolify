import { describe, expect, it } from 'vitest';
import { checkReportQuality, qualityBand } from './quality';
import { expandBlocks, TEMPLATE_SEED_BY_KEY } from './templates';
import type { Report, ReportBlock, ReportKpiValue } from '../../types';

const block = (over: Partial<ReportBlock> = {}): ReportBlock => ({
  id: over.id || `b-${over.type || 'rich-text'}`,
  type: over.type || 'rich-text',
  order: over.order ?? 0,
  visibility: over.visibility || 'internal',
  ...over,
});

const rep = (over: Partial<Report> = {}): Report => ({
  id: 'r1',
  businessId: 'biz1',
  kind: 'client-monthly',
  title: 'Raport',
  status: 'draft',
  period: { frequency: 'monthly', key: '2026-07', start: '2026-07-01', end: '2026-07-31' },
  authorUserId: 'u1',
  blocks: [],
  version: 1,
  createdAt: new Date('2026-08-01'),
  updatedAt: new Date('2026-08-01'),
  ...over,
});

const NOW = new Date('2026-08-05T10:00:00Z');

describe('checkReportQuality — advisory by design', () => {
  it('only ever blocks on genuinely missing required fields', () => {
    const r = rep({
      blocks: [block({ id: 'req', type: 'executive-summary', required: true, title: 'Përmbledhje' })],
    });
    const q = checkReportQuality(r, { now: NOW });
    expect(q.blockers).toHaveLength(1);
    expect(q.blockers[0].key).toBe('required-fields');
    // Everything else is advice, not a gate.
    expect(q.suggestions.filter(s => s.blocking).length).toBe(1);
  });

  it('has no blockers once required fields are filled, however thin the report', () => {
    const r = rep({
      blocks: [block({ type: 'executive-summary', required: true, text: 'Shkurt.' })],
    });
    const q = checkReportQuality(r, { now: NOW });
    expect(q.blockers).toEqual([]);
    expect(q.suggestions.length).toBeGreaterThan(0); // still plenty of advice
  });

  it('scores an empty report low', () => {
    expect(checkReportQuality(rep(), { now: NOW }).score).toBeLessThan(30);
  });

  it('scores a complete report high', () => {
    const kpis: ReportKpiValue[] = [
      { kpiId: 'a', label: 'A', unit: 'number', value: 100, previousValue: 80, target: 90, clientVisible: true, syncedAt: NOW },
      { kpiId: 'b', label: 'B', unit: 'percent', value: 12, previousValue: 10, target: 10, clientVisible: true, syncedAt: NOW },
    ];
    const r = rep({
      internallyApprovedAt: NOW,
      kpiValues: kpis,
      blocks: [
        block({ id: '1', type: 'executive-summary', visibility: 'client', text: 'Rezultate të mira.', order: 0 }),
        block({ id: '2', type: 'work-completed', visibility: 'client', items: ['Faqe të optimizuara'], order: 1 }),
        block({ id: '3', type: 'rich-text', visibility: 'client', text: 'Problemet: një vonesë në materiale.', order: 2 }),
        block({ id: '4', type: 'recommendation', visibility: 'client', text: 'Shtoni buxhet.', order: 3 }),
        block({ id: '5', type: 'next-steps', visibility: 'client', text: 'Faza 2.', order: 4 }),
        block({ id: '6', type: 'client-action', visibility: 'client', text: 'Aprovoni tekstet.', order: 5 }),
        block({ id: '7', type: 'kpi-cards', visibility: 'client', kpiIds: ['a', 'b'], order: 6 }),
      ],
    });
    const q = checkReportQuality(r, { now: NOW });
    expect(q.score).toBeGreaterThanOrEqual(90);
    expect(q.blockers).toEqual([]);
  });
});

describe('checkReportQuality — individual checks', () => {
  it('asks for an executive summary', () => {
    const q = checkReportQuality(rep(), { now: NOW });
    expect(q.suggestions.map(s => s.key)).toContain('exec-summary');
  });

  it('asks for a comparison period', () => {
    const r = rep({
      kpiValues: [{ kpiId: 'a', label: 'A', unit: 'number', value: 10, clientVisible: true }],
    });
    const q = checkReportQuality(r, { now: NOW });
    expect(q.suggestions.map(s => s.key)).toContain('comparison');
  });

  it('is satisfied once a comparison exists', () => {
    const r = rep({
      kpiValues: [{ kpiId: 'a', label: 'A', unit: 'number', value: 10, previousValue: 8, clientVisible: true }],
    });
    const q = checkReportQuality(r, { now: NOW });
    expect(q.suggestions.map(s => s.key)).not.toContain('comparison');
  });

  it('flags contradictory metrics', () => {
    const r = rep({
      kpiValues: [
        { kpiId: 'clicks', label: 'Klikime', unit: 'number', value: 500, clientVisible: true },
        { kpiId: 'impressions', label: 'Impresione', unit: 'number', value: 100, clientVisible: true },
      ],
    });
    const q = checkReportQuality(r, { now: NOW });
    const check = q.checks.find(c => c.key === 'metric-consistency')!;
    expect(check.state).toBe('fail');
    expect(check.hint).toContain('Klikimet');
  });

  it('flags stale data', () => {
    const r = rep({
      kpiValues: [{
        kpiId: 'a', label: 'A', unit: 'number', value: 1, clientVisible: true,
        syncedAt: new Date('2026-05-01'),
      }],
    });
    expect(checkReportQuality(r, { now: NOW }).suggestions.map(s => s.key)).toContain('freshness');
  });

  it('does not judge freshness when nothing was synced', () => {
    const r = rep({ kpiValues: [{ kpiId: 'a', label: 'A', unit: 'number', value: 1, clientVisible: true }] });
    expect(checkReportQuality(r, { now: NOW }).checks.find(c => c.key === 'freshness')!.state).toBe('n/a');
  });

  it('warns when internal-sounding text sits in a client-visible block', () => {
    const r = rep({
      blocks: [block({ id: 'x', visibility: 'client', text: 'Marzhi i llogarisë është 12% — konfidencial.' })],
    });
    const check = checkReportQuality(r, { now: NOW }).checks.find(c => c.key === 'no-internal-in-client')!;
    expect(check.state).toBe('fail');
    expect(check.hint).toContain('dukshëm nga klienti');
  });

  it('does not warn when the same text is internal', () => {
    const r = rep({
      blocks: [block({ id: 'x', visibility: 'management', text: 'Marzhi i llogarisë është 12%.' })],
    });
    const check = checkReportQuality(r, { now: NOW }).checks.find(c => c.key === 'no-internal-in-client')!;
    expect(check.state).toBe('n/a');
  });

  it('flags unapproved AI content', () => {
    const r = rep({
      blocks: [block({ id: 'ai', visibility: 'client', aiSuggested: true, text: 'Draft AI' })],
    });
    const check = checkReportQuality(r, { now: NOW }).checks.find(c => c.key === 'ai-approved')!;
    expect(check.state).toBe('fail');
  });

  it('accepts approved AI content', () => {
    const r = rep({
      blocks: [block({ id: 'ai', visibility: 'client', aiSuggested: true, aiApprovedByUserId: 'u1', text: 'Ok' })],
    });
    expect(checkReportQuality(r, { now: NOW }).checks.find(c => c.key === 'ai-approved')!.state).toBe('pass');
  });

  it('flags a wall of text', () => {
    const long = Array.from({ length: 200 }, () => 'fjalë').join(' ');
    const r = rep({ blocks: [block({ id: 'x', type: 'rich-text', text: long })] });
    expect(checkReportQuality(r, { now: NOW }).suggestions.map(s => s.key)).toContain('readability');
  });

  it('skips client-specific checks for an internal report kind', () => {
    const q = checkReportQuality(rep({ kind: 'weekly-staff' }), { now: NOW });
    expect(q.checks.find(c => c.key === 'client-actions')!.state).toBe('n/a');
    expect(q.checks.find(c => c.key === 'client-content')!.state).toBe('n/a');
    expect(q.checks.find(c => c.key === 'approved')!.state).toBe('n/a');
  });

  it('asks a client-facing report for client-visible content', () => {
    const r = rep({ blocks: [block({ visibility: 'internal', text: 'vetëm brenda' })] });
    expect(checkReportQuality(r, { now: NOW }).suggestions.map(s => s.key)).toContain('client-content');
  });
});

describe('quality against the seeded templates', () => {
  it('scores a freshly instantiated monthly SEO template as incomplete but unblocked-until-submit', () => {
    const r = rep({ blocks: expandBlocks(TEMPLATE_SEED_BY_KEY['monthly-seo'].blocks) });
    const q = checkReportQuality(r, { now: NOW });
    // An empty template is not a finished report.
    expect(q.score).toBeLessThan(60);
    // …and the required blocks are exactly what it asks for.
    expect(q.blockers.map(b => b.key)).toEqual(['required-fields']);
  });
});

describe('qualityBand', () => {
  it('bands the score range', () => {
    expect(qualityBand(90).label).toBe('Shkëlqyer');
    expect(qualityBand(75).label).toBe('Mirë');
    expect(qualityBand(55).label).toBe('Për përmirësim');
    expect(qualityBand(20).label).toBe('I dobët');
  });
});
