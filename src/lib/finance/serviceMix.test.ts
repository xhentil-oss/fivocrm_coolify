import { describe, expect, it } from 'vitest';
import type { Project, Service, InvoiceItem, TeamMember, TimeEntry } from '../../types';
import {
  NO_SERVICE_LINE,
  createLineLabeler,
  labelerFor,
  projectServiceMix,
  invoiceServiceMix,
  memberServiceLines,
  memberLaborSplit,
  weightOf,
} from './serviceMix';
import { computeDepartmentPnl } from './departmentPnl';
import { attributeCollectedRevenue } from './revenueAttribution';
import { allocateLabor } from './laborAllocation';

const svc = (id: string, category: string | undefined, price: number, currency = 'ALL'): Service =>
  ({ id, name: id, category, price, currency, createdAt: new Date(), updatedAt: new Date(), createdByUserId: null } as Service);
const SERVICES = [svc('seo', 'SEO', 40_000), svc('ads', 'Ads', 60_000), svc('misc', undefined, 0)];
const BY_ID = new Map(SERVICES.map(s => [s.id, s]));

function mkP(p: Partial<Project>): Project {
  return {
    id: p.id || 'p', name: p.name || 'P', status: p.status || 'Completed',
    billingType: 'one-time', createdAt: new Date('2026-03-01'), updatedAt: new Date('2026-03-01'),
    createdByUserId: null, ...p,
  } as Project;
}
const item = (invoiceId: string, serviceId: string | undefined, totalPrice: number): InvoiceItem =>
  ({ id: `${invoiceId}-${serviceId}-${totalPrice}`, invoiceId, serviceId, quantity: 1, unitPrice: totalPrice, totalPrice, createdAt: new Date(), updatedAt: new Date() } as InvoiceItem);
const member = (id: string, salary: number, lines?: string[]): TeamMember =>
  ({ id, teamId: 't', userId: id, displayName: id, role: 'Member', status: 'Active', monthlySalary: salary, serviceLines: lines } as TeamMember);

const OPTS = { range: { start: new Date(2026, 2, 1), end: new Date('2026-03-31T23:59:59') }, mode: 'all' as const, now: new Date('2026-03-31T12:00:00') };

describe('createLineLabeler', () => {
  it('treats spelling variants as one line, first spelling wins', () => {
    const label = createLineLabeler(['SEO']);
    expect(label(' seo ')).toBe('SEO');
    expect(label('Social  Media')).toBe('Social Media');
    expect(label('social media')).toBe('Social Media');
    expect(label('')).toBe(NO_SERVICE_LINE);
    expect(label(undefined)).toBe(NO_SERVICE_LINE);
  });

  it('labelerFor seeds catalogue categories before project departments', () => {
    const label = labelerFor([{ category: 'SEO' }], [{ department: 'seo' }]);
    expect(label('seo')).toBe('SEO');
  });
});

describe('projectServiceMix', () => {
  const label = () => labelerFor(SERVICES, []);

  it('splits by the price of the services sold', () => {
    const mix = projectServiceMix(mkP({ serviceIds: ['seo', 'ads'], department: 'SEO' }), BY_ID, label());
    expect(weightOf(mix, 'SEO')).toBeCloseTo(0.4);
    expect(weightOf(mix, 'Ads')).toBeCloseTo(0.6);
  });

  it('an explicit serviceMix wins over the services', () => {
    const mix = projectServiceMix(mkP({ serviceIds: ['seo', 'ads'], serviceMix: [{ line: 'seo', pct: 70 }, { line: 'Ads', pct: 30 }] }), BY_ID, label());
    expect(weightOf(mix, 'SEO')).toBeCloseTo(0.7);
    expect(weightOf(mix, 'Ads')).toBeCloseTo(0.3);
  });

  it('a service with no category counts for the project department; no data = department', () => {
    const l = label();
    expect(projectServiceMix(mkP({ serviceIds: ['misc'], department: 'Web' }), BY_ID, l)).toEqual([{ line: 'Web', weight: 1 }]);
    expect(projectServiceMix(mkP({ department: 'Web' }), BY_ID, l)).toEqual([{ line: 'Web', weight: 1 }]);
    expect(projectServiceMix(mkP({}), BY_ID, l)).toEqual([{ line: NO_SERVICE_LINE, weight: 1 }]);
  });

  it('all-zero prices split equally; unknown service ids are ignored', () => {
    const zero = new Map([['a', svc('a', 'SEO', 0)], ['b', svc('b', 'Ads', 0)]]);
    const mix = projectServiceMix(mkP({ serviceIds: ['a', 'b', 'gone'] }), zero, createLineLabeler());
    expect(weightOf(mix, 'SEO')).toBeCloseTo(0.5);
    expect(weightOf(mix, 'Ads')).toBeCloseTo(0.5);
  });
});

describe('invoiceServiceMix', () => {
  const label = labelerFor(SERVICES, []);
  const fallback = [{ line: 'SEO', weight: 1 }];

  it('weights by the invoice lines, not by their absolute amounts', () => {
    const mix = invoiceServiceMix([item('i', 'seo', 30_000), item('i', 'ads', 90_000)], BY_ID, label, fallback);
    expect(weightOf(mix, 'SEO')).toBeCloseTo(0.25);
    expect(weightOf(mix, 'Ads')).toBeCloseTo(0.75);
  });

  it('a free-text line is spread by the fallback (the project mix)', () => {
    const mix = invoiceServiceMix(
      [item('i', 'ads', 50_000), item('i', undefined, 50_000)], BY_ID, label,
      [{ line: 'SEO', weight: 0.5 }, { line: 'Ads', weight: 0.5 }],
    );
    expect(weightOf(mix, 'Ads')).toBeCloseTo(0.75);
    expect(weightOf(mix, 'SEO')).toBeCloseTo(0.25);
  });

  it('no lines → the fallback', () => {
    expect(invoiceServiceMix([], BY_ID, label, fallback)).toEqual(fallback);
  });
});

describe('memberLaborSplit', () => {
  const mix = [{ line: 'Ads', weight: 0.6 }, { line: 'SEO', weight: 0.4 }];
  it('a specialist goes to their own line', () => {
    expect(memberLaborSplit(['SEO'], mix)).toEqual([{ line: 'SEO', weight: 1 }]);
  });
  it('someone on several of the project lines is split by the project weights', () => {
    const split = memberLaborSplit(['SEO', 'Ads', 'Social'], mix);
    expect(weightOf(split, 'Ads')).toBeCloseTo(0.6);
    expect(weightOf(split, 'SEO')).toBeCloseTo(0.4);
  });
  it('no line, or a line the project does not sell → the project mix', () => {
    expect(memberLaborSplit([], mix)).toBe(mix);
    expect(memberLaborSplit(['Social'], mix)).toBe(mix);
  });
  it('reads the legacy singular serviceLine', () => {
    expect(memberServiceLines({ serviceLine: 'seo' } as TeamMember, createLineLabeler(['SEO']))).toEqual(['SEO']);
  });
});

describe('computeDepartmentPnl — one project, two service lines', () => {
  const project = mkP({ id: 'acme', department: 'SEO', budget: 100_000, serviceIds: ['seo', 'ads'], responsibleUserId: 'seoGuy', memberUserIds: ['adsGal'] });

  it('earned: SEO and Ads each get their share of revenue, and their OWN people', () => {
    const members = [member('seoGuy', 20_000, ['SEO']), member('adsGal', 30_000, ['Ads'])];
    const res = computeDepartmentPnl([project], members, [], { ...OPTS, services: SERVICES });
    const seo = res.rows.find(r => r.department === 'SEO')!;
    const ads = res.rows.find(r => r.department === 'Ads')!;
    expect(seo.revenue).toBeCloseTo(40_000);
    expect(ads.revenue).toBeCloseTo(60_000);
    expect(seo.labor).toBeCloseTo(20_000);
    expect(ads.labor).toBeCloseTo(30_000);
    expect(seo.projects[0]).toMatchObject({ id: 'acme', share: 0.4, splitAcross: ['Ads', 'SEO'] });
    expect(res.splitProjects).toBe(1);
    // The split moves money between rows; it never creates or loses any.
    expect(res.totals.revenue).toBeCloseTo(100_000);
    expect(res.totals.labor).toBeCloseTo(50_000);
    expect(seo.profit + ads.profit).toBeCloseTo(res.totals.profit);
  });

  it('direct cost and overhead follow the revenue weights', () => {
    const expenses = [
      { id: 'tool', title: 'x', amount: 10_000, category: 'Software', currency: 'ALL', date: new Date('2026-03-10'), projectId: 'acme' },
      { id: 'rent', title: 'x', amount: 50_000, category: 'Rent', currency: 'ALL', date: new Date('2026-03-10') },
    ] as any;
    const res = computeDepartmentPnl([project], [], expenses, { ...OPTS, services: SERVICES });
    const seo = res.rows.find(r => r.department === 'SEO')!;
    expect(seo.directCost).toBeCloseTo(4_000);
    expect(seo.overhead).toBeCloseTo(20_000);
    expect(res.totals.overhead).toBeCloseTo(50_000);
  });

  it('without the catalogue the project stays whole in its department (old result)', () => {
    const res = computeDepartmentPnl([project], [], [], OPTS);
    expect(res.rows.map(r => r.department)).toEqual(['SEO']);
    expect(res.rows[0].revenue).toBe(100_000);
    expect(res.rows[0].projects[0].share).toBe(1);
    expect(res.splitProjects).toBe(0);
  });

  it('collected: each invoice is split by its own lines', () => {
    const invoices = [{ id: 'inv', projectId: 'acme', total: 90_000, status: 'Paid', invoiceDate: new Date('2026-03-10'), paidAt: new Date('2026-03-12'), createdAt: new Date('2026-03-10') }] as any;
    const items = [item('inv', 'seo', 40_000), item('inv', 'ads', 60_000)]; // lines sum 100k, discounted to 90k
    const res = computeDepartmentPnl([project], [], [], { ...OPTS, revenueBasis: 'invoiced', invoices, services: SERVICES, invoiceItems: items });
    expect(res.rows.find(r => r.department === 'SEO')!.revenue).toBeCloseTo(36_000);
    expect(res.rows.find(r => r.department === 'Ads')!.revenue).toBeCloseTo(54_000);

    const cash = attributeCollectedRevenue(invoices, [project], { start: OPTS.range.start, end: OPTS.range.end }, { services: SERVICES, invoiceItems: items });
    expect(cash.byDepartment.get('SEO')).toBeCloseTo(36_000);
    expect(cash.byDepartment.get('Ads')).toBeCloseTo(54_000);
    expect(cash.total).toBe(90_000);
  });

  it('hours model: logged hours land on the logger’s line, overhead by line hours', () => {
    const period = { start: new Date(2026, 8, 1), end: new Date(2026, 8, 30, 23, 59, 59, 999) };
    const settings = { employerCostPct: 0, defaultClientCapacityHours: 120, overheadBasis: 'labor-hours' as const };
    const seoGuy = member('seoGuy', 120_000, ['SEO']); // 1 000 L/h
    const adsGal = member('adsGal', 120_000, ['Ads']);
    const entry = (userId: string, hours: number): TimeEntry => ({
      id: `${userId}-${hours}`, userId, projectId: 'ret', date: '2026-09-10', startTime: new Date('2026-09-10T09:00:00'),
      duration: hours * 60, createdAt: new Date('2026-09-10'), updatedAt: new Date('2026-09-10'),
    } as TimeEntry);
    const retainer = mkP({ id: 'ret', status: 'Active', billingType: 'monthly', budget: 100_000, serviceIds: ['seo', 'ads'], createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01') });
    const labor = allocateLabor({ timeEntries: [entry('seoGuy', 10), entry('adsGal', 30)], members: [seoGuy, adsGal], expenses: [], period, settings, clientProjectIds: new Set(['ret']) });
    const res = computeDepartmentPnl([retainer], [seoGuy, adsGal], [], { range: period, labor, timeEntries: [], services: SERVICES });
    const seo = res.rows.find(r => r.department === 'SEO')!;
    const ads = res.rows.find(r => r.department === 'Ads')!;
    expect(seo.labor).toBeCloseTo(10_000);
    expect(ads.labor).toBeCloseTo(30_000);
    // Payroll 240k: 40k absorbed, 200k unabsorbed → shared pool, spread 10h : 30h.
    expect(seo.overhead / ads.overhead).toBeCloseTo(1 / 3);
    expect(res.totals.labor + res.totals.overhead).toBeCloseTo(240_000);
  });
});
