import { describe, expect, it } from 'vitest';
import {
  ATTAINMENT_CAP,
  KPI_CATALOG,
  KPI_SEED_BY_KEY,
  buildKpiValues,
  catalogForService,
  categoriesForService,
  findMetricContradictions,
  formatDelta,
  formatKpiValue,
  kpiCardModel,
  kpiDelta,
  kpiRag,
  resolveTarget,
  targetAttainment,
} from './kpi';
import type { ReportKpi, ReportKpiValue } from '../../types';

describe('catalog', () => {
  it('covers every service line the agency sells', () => {
    for (const svc of ['seo', 'web', 'ads', 'social', 'marketing', 'maintenance'] as const) {
      expect(catalogForService(svc).length, svc).toBeGreaterThan(0);
    }
  });

  it('has unique keys', () => {
    const keys = KPI_CATALOG.map(k => k.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('marks cost/margin metrics as internal', () => {
    expect(KPI_SEED_BY_KEY.gross_margin.clientVisible).toBe(false);
    expect(KPI_SEED_BY_KEY.tracking_issues.clientVisible).toBe(false);
  });

  it('marks lower-is-better metrics correctly', () => {
    expect(KPI_SEED_BY_KEY.cost_per_lead.higherIsBetter).toBe(false);
    expect(KPI_SEED_BY_KEY.avg_position.higherIsBetter).toBe(false);
    expect(KPI_SEED_BY_KEY.bugs_critical.higherIsBetter).toBe(false);
    expect(KPI_SEED_BY_KEY.organic_users.higherIsBetter).toBe(true);
  });

  it('groups a service into categories', () => {
    expect(categoriesForService('seo')).toContain('Fjalë kyçe');
  });
});

describe('formatKpiValue', () => {
  it('renders each unit', () => {
    expect(formatKpiValue(1234, 'number')).toBe('1.234');
    expect(formatKpiValue(12.5, 'percent', { decimals: 1 })).toBe('12,5%');
    expect(formatKpiValue(2, 'ratio', { decimals: 2 })).toBe('2,00×');
    expect(formatKpiValue(8, 'hours', { decimals: 0 })).toBe('8 h');
    expect(formatKpiValue(3, 'days', { decimals: 0 })).toBe('3 ditë');
  });

  it('renders currency symbols', () => {
    expect(formatKpiValue(1500, 'currency', { decimals: 0, currency: 'EUR' })).toBe('1.500 €');
    expect(formatKpiValue(1500, 'currency', { decimals: 0, currency: 'ALL' })).toBe('1.500 L');
  });

  it('renders missing data as an em dash, not zero', () => {
    expect(formatKpiValue(null, 'number')).toBe('—');
    expect(formatKpiValue(undefined, 'currency')).toBe('—');
    expect(formatKpiValue(NaN, 'number')).toBe('—');
    expect(formatKpiValue(0, 'number')).toBe('0');
  });
});

describe('kpiDelta — direction awareness', () => {
  it('marks growth as favourable for higher-is-better', () => {
    const d = kpiDelta(120, 100, true);
    expect(d).toMatchObject({ absolute: 20, direction: 'up', favourable: true });
    expect(d.relative).toBeCloseTo(0.2);
  });

  it('marks growth as UNfavourable for lower-is-better', () => {
    const d = kpiDelta(1.4, 1.0, false);
    expect(d.direction).toBe('up');
    expect(d.favourable).toBe(false);
  });

  it('marks a drop in CPL as favourable', () => {
    expect(kpiDelta(0.8, 1.0, false).favourable).toBe(true);
  });

  it('returns nulls when either side is missing', () => {
    expect(kpiDelta(null, 100)).toMatchObject({ absolute: null, favourable: null });
    expect(kpiDelta(100, undefined)).toMatchObject({ absolute: null, favourable: null });
  });

  it('handles a zero baseline without dividing by zero', () => {
    const d = kpiDelta(10, 0, true);
    expect(d.absolute).toBe(10);
    expect(d.relative).toBeNull();
  });

  it('reports no change as flat with no verdict', () => {
    expect(kpiDelta(5, 5)).toMatchObject({ direction: 'flat', favourable: null });
  });
});

describe('formatDelta', () => {
  it('prefers a relative percentage', () => {
    expect(formatDelta(kpiDelta(120, 100), 'number')).toBe('+20,0%');
    expect(formatDelta(kpiDelta(80, 100), 'number')).toBe('−20,0%');
  });

  it('falls back to absolute when there is no baseline', () => {
    expect(formatDelta(kpiDelta(10, 0), 'number', { decimals: 0 })).toBe('+10');
  });

  it('renders nothing measurable as an em dash', () => {
    expect(formatDelta(kpiDelta(null, null), 'number')).toBe('—');
  });
});

describe('targetAttainment', () => {
  it('is a plain ratio when higher is better', () => {
    expect(targetAttainment(90, 100, true)).toBeCloseTo(0.9);
    expect(targetAttainment(120, 100, true)).toBeCloseTo(1.2);
  });

  it('inverts for lower-is-better metrics', () => {
    // Spending 800 against a 1000 budget beats the target.
    expect(targetAttainment(800, 1000, false)).toBeCloseTo(1.25);
    expect(targetAttainment(1250, 1000, false)).toBeCloseTo(0.8);
  });

  it('caps an unbounded win instead of returning Infinity', () => {
    expect(targetAttainment(0, 1000, false)).toBe(ATTAINMENT_CAP);
    expect(Number.isFinite(targetAttainment(0, 1000, false)!)).toBe(true);
  });

  it('returns null without both numbers', () => {
    expect(targetAttainment(null, 100)).toBeNull();
    expect(targetAttainment(100, null)).toBeNull();
    expect(targetAttainment(100, 0)).toBeNull();
  });
});

describe('kpiRag', () => {
  it('maps attainment to RAG with the default thresholds', () => {
    expect(kpiRag(1.05)).toBe('green');
    expect(kpiRag(0.95)).toBe('green');
    expect(kpiRag(0.8)).toBe('yellow');
    expect(kpiRag(0.5)).toBe('red');
  });

  it('greys out unknown attainment rather than guessing', () => {
    expect(kpiRag(null)).toBe('grey');
  });

  it('honours custom thresholds', () => {
    expect(kpiRag(0.85, 0.8, 0.6)).toBe('green');
  });
});

describe('resolveTarget — narrowest scope wins', () => {
  const kpi: Pick<ReportKpi, 'targets'> = {
    targets: [
      { value: 100 },                                    // global
      { service: 'seo', value: 200 },
      { customerId: 'c1', value: 300 },
      { customerId: 'c1', periodKey: '2026-07', value: 350 },
      { projectId: 'p1', value: 400 },
    ],
  };

  it('falls back to the global target', () => {
    expect(resolveTarget(kpi, {})).toBe(100);
  });

  it('prefers the service target', () => {
    expect(resolveTarget(kpi, { service: 'seo' })).toBe(200);
  });

  it('prefers the customer target over the service one', () => {
    expect(resolveTarget(kpi, { service: 'seo', customerId: 'c1' })).toBe(300);
  });

  it('prefers a period-specific customer target', () => {
    expect(resolveTarget(kpi, { customerId: 'c1', periodKey: '2026-07' })).toBe(350);
  });

  it('prefers the project target over everything', () => {
    expect(resolveTarget(kpi, { customerId: 'c1', projectId: 'p1', periodKey: '2026-07' })).toBe(400);
  });

  it('ignores targets scoped to another customer', () => {
    expect(resolveTarget(kpi, { customerId: 'other' })).toBe(100);
  });

  it('returns null when there are no targets', () => {
    expect(resolveTarget({ targets: [] }, {})).toBeNull();
  });
});

describe('buildKpiValues', () => {
  const def = (over: Partial<ReportKpi>): ReportKpi => ({
    id: over.id || 'k1',
    businessId: 'biz1',
    key: over.key || 'organic_users',
    name: 'Vizitorë organikë',
    unit: 'number',
    higherIsBetter: true,
    clientVisible: true,
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  });

  it('snapshots label, unit and client visibility onto the value', () => {
    const values = buildKpiValues(
      [def({ id: 'k1', key: 'organic_users' })],
      { organic_users: 500 },
      { organic_users: 400 },
    );
    expect(values[0]).toMatchObject({
      kpiId: 'k1', label: 'Vizitorë organikë', unit: 'number',
      value: 500, previousValue: 400, clientVisible: true,
    });
  });

  it('records null for a KPI with no value collected', () => {
    const values = buildKpiValues([def({ key: 'organic_users' })], {});
    expect(values[0].value).toBeNull();
  });

  it('resolves the target from the scope', () => {
    const values = buildKpiValues(
      [def({ key: 'organic_users', targets: [{ customerId: 'c1', value: 900 }] })],
      { organic_users: 500 },
      {},
      { customerId: 'c1' },
    );
    expect(values[0].target).toBe(900);
  });

  it('records the origin of each number', () => {
    const values = buildKpiValues([def({ key: 'organic_users' })], { organic_users: 1 }, {}, {}, { organic_users: 'ga4' });
    expect(values[0].origin).toBe('ga4');
  });
});

describe('kpiCardModel', () => {
  it('assembles display, delta, attainment and RAG together', () => {
    const value: ReportKpiValue = {
      kpiId: 'cost_per_lead', label: 'Kosto për lead', unit: 'currency',
      value: 0.8, previousValue: 1.0, target: 1.0, higherIsBetter: false, decimals: 2, currency: 'EUR',
    };
    const m = kpiCardModel(value);
    expect(m.display).toBe('0,80 €');
    expect(m.delta.favourable).toBe(true);   // CPL fell
    expect(m.attainment).toBeCloseTo(1.25);
    expect(m.rag).toBe('green');
    expect(m.targetLabel).toBe('1,00 €');
  });

  it('greys a card with no target', () => {
    const m = kpiCardModel({ kpiId: 'x', label: 'X', unit: 'number', value: 5 });
    expect(m.rag).toBe('grey');
    expect(m.targetLabel).toBeNull();
  });
});

describe('findMetricContradictions', () => {
  const v = (kpiId: string, value: number): ReportKpiValue =>
    ({ kpiId, label: kpiId, unit: 'number', value });

  it('catches clicks exceeding impressions', () => {
    expect(findMetricContradictions([v('clicks', 100), v('impressions', 50)]))
      .toContain('Klikimet janë më shumë se impresionet.');
  });

  it('catches conversions exceeding clicks', () => {
    expect(findMetricContradictions([v('clicks', 10), v('conversions', 20)]))
      .toContain('Konvertimet janë më shumë se klikimet.');
  });

  it('catches a cost-per-lead that does not match spend/leads', () => {
    const issues = findMetricContradictions([v('ad_spend', 1000), v('leads_ads', 100), v('cost_per_lead', 50)]);
    expect(issues.some(i => i.includes('Kosto për lead'))).toBe(true);
  });

  it('accepts a consistent cost-per-lead', () => {
    expect(findMetricContradictions([v('ad_spend', 1000), v('leads_ads', 100), v('cost_per_lead', 10)])).toEqual([]);
  });

  it('catches follower arithmetic that does not add up', () => {
    expect(findMetricContradictions([v('followers_gained', 100), v('followers_lost', 20), v('net_follower_growth', 200)]))
      .toContain('Rritja neto e ndjekësve nuk përputhet me fituar − humbur.');
  });

  it('catches an impossible conversion rate', () => {
    expect(findMetricContradictions([v('conversion_rate', 250)]))
      .toContain('Norma e konvertimit është jashtë 0–100%.');
  });

  it('says nothing about an empty or consistent set', () => {
    expect(findMetricContradictions([])).toEqual([]);
    expect(findMetricContradictions([v('clicks', 10), v('impressions', 1000)])).toEqual([]);
  });
});
