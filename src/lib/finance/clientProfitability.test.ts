import { describe, it, expect } from 'vitest';
import type { Customer, Expense, Invoice, Project, TeamMember, TimeEntry } from '../../types';
import { computeClientProfitability, monthCloseChecks, snapshotForClose } from './clientProfitability';
import { computeProjectPnl } from './projectPnl';
import { computeDepartmentPnl } from './departmentPnl';
import { allocateLabor } from './laborAllocation';
import { calculateExpensesBetween } from './financialAnalytics';
import { payrollBetween } from './payroll';

const d = (iso: string) => new Date(iso);
const period = { start: new Date(2026, 8, 1), end: new Date(2026, 8, 30, 23, 59, 59, 999) };
const settings = { employerCostPct: 0, defaultClientCapacityHours: 120 };

const member = (userId: string, monthlySalary: number, costRole: string): TeamMember => ({
  id: `t_${userId}`, teamId: 't', userId, displayName: userId, role: 'Member', status: 'Active', costRole,
  monthlySalary, createdAt: d('2026-01-01'), updatedAt: d('2026-01-01'), createdByUserId: null,
} as TeamMember);
const entry = (userId: string, projectId: string, hours: number, day = '2026-09-10'): TimeEntry => ({
  id: `${userId}_${projectId}_${day}_${hours}`, userId, projectId, startTime: d(`${day}T09:00:00`), endTime: d(`${day}T17:00:00`),
  duration: hours * 60, createdAt: d(day), updatedAt: d(day),
} as TimeEntry);
const retainer = (id: string, customerId: string, fee: number, extra: Partial<Project> = {}): Project => ({
  id, name: id, status: 'Active', customerId, budget: fee, currency: 'ALL', billingType: 'monthly', isRecurring: true,
  department: 'Social', createdAt: d('2026-01-05'), updatedAt: d('2026-01-05'), createdByUserId: null, responsibleUserId: 'smm', ...extra,
} as Project);
const expense = (id: string, amount: number, category: string, extra: Partial<Expense> = {}): Expense => ({
  id, title: id, amount, currency: 'ALL', category, date: d('2026-09-12'), createdAt: d('2026-09-12'), updatedAt: d('2026-09-12'), createdByUserId: null, ...extra,
} as Expense);
const invoice = (id: string, customerId: string, projectId: string | undefined, total: number, paid: number): Invoice => ({
  id, customerId, projectId, amount: total, total, currency: 'ALL', status: paid >= total ? 'Paid' : paid > 0 ? 'Partial' : 'Pending',
  paidAmount: paid, paidAt: paid > 0 ? d('2026-09-20') : undefined, invoiceDate: d('2026-09-05'),
  createdAt: d('2026-09-05'), updatedAt: d('2026-09-05'), createdByUserId: null,
} as Invoice);

// §8 / §18: Client X — 150 000 revenue, 39 000 labour, 6 000 production, overhead 25 000.
const smm = member('smm', 120_000, 'SMM');          // 1 000 L/h
const gd = member('gd', 108_000, 'Graphic Designer'); //   900 L/h
const photo = member('photo', 192_000, 'Photographer'); // 1 600 L/h
const pm = member('pm', 156_000, 'PM');              // 1 300 L/h
const members = [smm, gd, photo, pm];
const customers: Customer[] = [{ id: 'X', name: 'Client X' } as Customer, { id: 'Y', name: 'Client Y' } as Customer];

describe('computeClientProfitability', () => {
  const projects = [retainer('pX', 'X', 150_000), retainer('pY', 'Y', 100_000)];
  const entries = [
    entry('smm', 'pX', 15), entry('gd', 'pX', 12), entry('photo', 'pX', 5), entry('pm', 'pX', 4), // 39 000
    entry('smm', 'pY', 40), entry('gd', 'pY', 30),                                             // 67 000
  ];
  const expenses = [
    expense('prod', 6_000, 'Production', { projectId: 'pX' }),
    expense('ads', 20_000, 'Ad Spend', { projectId: 'pY' }),
    expense('rent', 100_000, 'Rent'),
    expense('pagaX', 200_000, 'Salary'),
  ];
  const invoices = [invoice('i1', 'X', 'pX', 150_000, 150_000), invoice('i2', 'Y', 'pY', 100_000, 40_000), invoice('i3', 'X', undefined, 30_000, 0)];

  const r = computeClientProfitability({
    customers, projects, timeEntries: entries, members, expenses, invoices, period,
    settings: { ...settings, passThroughExpenseCategories: ['Ad Spend'] },
  });
  const X = r.rows.find(x => x.customerId === 'X')!;
  const Y = r.rows.find(x => x.customerId === 'Y')!;

  it('gross profit = earned − labour − direct expenses (Client X: 150 000 − 39 000 − 6 000 = 105 000, 70 %)', () => {
    expect(X.earned).toBe(150_000);
    expect(X.directLabor).toBe(39_000);
    expect(X.directExpenses).toBe(6_000);
    expect(X.grossProfit).toBe(105_000);
    expect(X.grossMarginPct).toBeCloseTo(70, 5);
    expect(X.status).toBe('healthy');
    expect(X.byRole['SMM']).toEqual({ hours: 15, cost: 15_000 });
    expect(X.byRole['Photographer']).toEqual({ hours: 5, cost: 8_000 });
  });

  it('pass-through is netted out before the margin is judged', () => {
    expect(Y.passThrough).toBe(20_000);
    expect(Y.netRevenue).toBe(80_000);
    expect(Y.grossProfit).toBe(80_000 - 67_000);
    expect(Y.grossMarginPct).toBeCloseTo(16.25, 5);
    expect(Y.status).toBe('investigate');
  });

  it('overhead = other fixed + unabsorbed payroll, shared by hours', () => {
    // payroll recorded 200 000; absorbed 106 000 → unabsorbed 94 000; + rent 100 000 = 194 000
    expect(r.company.payroll).toBe(200_000);
    expect(r.company.payrollBasis).toBe('recorded');
    expect(r.company.unabsorbedLabor).toBe(94_000);
    expect(r.company.overheadPool).toBe(194_000);
    expect(X.overhead).toBeCloseTo(194_000 * 36 / 106, 5);
    expect(Y.overhead).toBeCloseTo(194_000 * 70 / 106, 5);
    expect(r.company.unallocatedOverhead).toBeCloseTo(0, 6);
  });

  it('FOOTS: Σ client net profit == company operating profit when every hour is a client hour', () => {
    const sumNet = r.rows.reduce((s, x) => s + x.netProfit, 0);
    const otherExpenses = calculateExpensesBetween(expenses, period.start, period.end); // rent + prod + ads (no salary)
    const payroll = payrollBetween(members, expenses, period.start, period.end).total;
    const expected = 250_000 - otherExpenses - payroll;
    expect(sumNet).toBeCloseTo(expected, 5);
    expect(r.company.operatingProfit).toBeCloseTo(expected, 5);
  });

  it('cash is a separate column set', () => {
    expect(X.invoiced).toBe(180_000);        // 150k linked + 30k unlinked
    expect(X.unlinkedInvoiced).toBe(30_000);
    expect(X.collected).toBe(150_000);
    expect(X.outstanding).toBe(30_000);
    expect(Y.collected).toBe(40_000);
    expect(Y.outstanding).toBe(60_000);
    expect(r.warnings.unlinkedInvoices).toEqual({ count: 1, amount: 30_000 });
  });

  it('effective hourly revenue and A–D class', () => {
    expect(X.effectiveHourlyRevenue).toBeCloseTo(150_000 / 36, 5);
    expect(Y.effectiveHourlyRevenue).toBeCloseTo(80_000 / 70, 5);
    expect(X.category).toBe('A');
    expect(Y.category).toBe('D');
  });

  it('rows are sorted by net profit, snapshot is plain numbers, checks are honest', () => {
    expect(r.rows[0].customerId).toBe('X');
    const snap = snapshotForClose(r);
    expect(snap.clients[0]).toMatchObject({ customerId: 'X', earned: 150_000 });
    expect(monthCloseChecks(r).some(w => w.includes('fatura pa projekt'))).toBe(true);
  });

  it('with no hours the basis is none and nothing pretends otherwise', () => {
    const empty = computeClientProfitability({ customers, projects, timeEntries: [], members, expenses, invoices, period, settings });
    expect(empty.basis).toBe('none');
    expect(empty.rows.find(x => x.customerId === 'X')!.directLabor).toBe(0);
    expect(monthCloseChecks(empty)[0]).toMatch(/Asnjë orë/);
  });
});

describe('one allocation, every engine', () => {
  const projects = [retainer('pX', 'X', 150_000), retainer('pY', 'Y', 100_000)];
  const entries = [entry('smm', 'pX', 30), entry('gd', 'pY', 60)];
  const expenses = [expense('rent', 50_000, 'Rent')];
  const labor = allocateLabor({ timeEntries: entries, members: [smm, gd], expenses, period, settings, clientProjectIds: new Set(['pX', 'pY']) });

  it('projectPnl with `labor` carries the same labour and hours as the client table', () => {
    const pnl = computeProjectPnl(projects, [smm, gd], expenses, { range: period, labor, timeEntries: entries });
    const client = computeClientProfitability({ customers, projects, timeEntries: entries, members: [smm, gd], expenses, invoices: [], period, settings, labor });
    const pX = pnl.rows.find(x => x.id === 'pX')!;
    expect(pnl.laborBasis).toBe('hours');
    expect(pnl.allocationBasis).toBe('labor-hours');
    expect(pX.laborCost).toBe(30_000);
    expect(pX.hours).toBe(30);
    expect(pX.directCost).toBe(30_000);
    expect(pnl.fixedPool.salaries).toBe(labor.unabsorbed);
    expect(pX.overhead).toBeCloseTo(client.rows.find(x => x.customerId === 'X')!.overhead, 5);
    expect(pnl.totals.profit).toBeCloseTo(client.totals.netProfit, 5);
  });

  it('departmentPnl with `labor` costs projects by hours and pools the unabsorbed payroll', () => {
    const dept = computeDepartmentPnl(projects, [smm, gd], expenses, { range: period, labor, timeEntries: entries });
    expect(dept.laborBasis).toBe('hours');
    const social = dept.rows.find(x => x.department === 'Social')!;
    expect(social.labor).toBe(84_000);
    expect(dept.unallocatedLabor.total).toBe(labor.unabsorbed);
    expect(dept.totals.profit).toBeCloseTo(250_000 - 84_000 - 50_000 - labor.unabsorbed, 5);
  });

  it('without `labor` both engines behave exactly as before', () => {
    const pnl = computeProjectPnl(projects, [smm, gd], expenses, { range: period });
    expect(pnl.laborBasis).toBe('legacy');
    expect(pnl.allocationBasis).toBe('revenue');
    expect(pnl.rows[0].laborCost).toBe(0);
    const dept = computeDepartmentPnl(projects, [smm, gd], expenses, { range: period });
    expect(dept.laborBasis).toBe('legacy');
  });
});
