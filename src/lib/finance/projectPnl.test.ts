import { describe, expect, it } from 'vitest';
import type { Project, TeamMember, Expense, TimeEntry } from '../../types';
import { computeProjectPnl } from './projectPnl';
import { monthCoverage } from './projectPeriod';
import { allocateLabor } from './laborAllocation';
import { payrollBetween } from './payroll';

// Default fixture is a COMPLETED one-time project: that is the state in which a
// one-time deal's revenue is recognised (point in time), so cost-allocation tests
// below keep exercising real revenue. Recognition timing has its own tests.
function mkProject(p: Partial<Project>): Project {
  return {
    id: p.id || 'p1',
    name: p.name || 'Project',
    status: p.status || 'Completed',
    budget: p.budget,
    customerId: p.customerId,
    responsibleUserId: p.responsibleUserId,
    createdByUserId: p.createdByUserId ?? null,
    createdAt: p.createdAt ?? new Date('2026-03-01'),
    updatedAt: p.updatedAt ?? new Date('2026-03-01'),
    // No default lastCompletedAt: it would cap a MONTHLY project's active span.
    // A completed one-time project falls back to updatedAt for its recognition date.
    ...p,
  } as Project;
}

function mkMember(m: Partial<TeamMember>): TeamMember {
  return {
    id: m.id || 'm1',
    teamId: 't1',
    userId: m.userId || 'u1',
    role: m.role || 'Member',
    status: m.status || 'Active',
    monthlySalary: m.monthlySalary,
    ...m,
  } as TeamMember;
}

function mkExpense(e: Partial<Expense>): Expense {
  return {
    id: e.id || 'e1',
    title: e.title || 'Expense',
    amount: e.amount ?? 0,
    category: e.category || 'Other',
    currency: e.currency || 'ALL',
    projectId: e.projectId,
    date: e.date ?? new Date('2026-03-10'),
    ...e,
  } as Expense;
}

describe('computeProjectPnl', () => {
  it('allocates fixed overhead by revenue weight (full-absorption)', () => {
    const projects = [
      mkProject({ id: 'a', name: 'A', budget: 600_000 }),
      mkProject({ id: 'b', name: 'B', budget: 400_000 }),
    ];
    // Fixed pool = 1 salary of 400k × 1 month + 100k rent (no project) = 500k.
    const members = [mkMember({ monthlySalary: 400_000 })];
    const expenses = [
      mkExpense({ id: 'rent', amount: 100_000, category: 'Rent' }), // non-project → pool
    ];

    const res = computeProjectPnl(projects, members, expenses, { months: 1 });

    expect(res.fixedPool.total).toBe(500_000);
    expect(res.allocationBasis).toBe('revenue');

    const a = res.rows.find(r => r.id === 'a')!;
    const b = res.rows.find(r => r.id === 'b')!;
    // A earns 60% → absorbs 60% of 500k = 300k; B absorbs 200k.
    expect(a.overhead).toBe(300_000);
    expect(b.overhead).toBe(200_000);
    expect(a.profit).toBe(600_000 - 300_000); // 300k
    expect(b.profit).toBe(400_000 - 200_000); // 200k
    // Whole pool is allocated.
    expect(res.totals.overhead).toBe(500_000);
  });

  it('charges project-linked expenses as direct variable cost', () => {
    const projects = [mkProject({ id: 'a', name: 'A', budget: 300_000 })];
    const expenses = [
      mkExpense({ id: 'ad', amount: 50_000, category: 'Marketing', projectId: 'a' }),
    ];
    const res = computeProjectPnl(projects, [], expenses, { months: 1 });
    const a = res.rows[0];
    expect(a.directCost).toBe(50_000);
    expect(res.fixedPool.otherFixed).toBe(0); // project-linked → not in pool
    expect(a.profit).toBe(300_000 - 50_000);
  });

  it('excludes Salary-category expenses from direct cost (no double count)', () => {
    const projects = [mkProject({ id: 'a', name: 'A', budget: 300_000 })];
    const expenses = [
      mkExpense({ id: 's', amount: 99_000, category: 'Salary', projectId: 'a' }),
    ];
    const res = computeProjectPnl(projects, [], expenses, { months: 1 });
    expect(res.rows[0].directCost).toBe(0);
  });

  it('falls back to equal split when no project has revenue', () => {
    const projects = [
      mkProject({ id: 'a', name: 'A', budget: 0 }),
      mkProject({ id: 'b', name: 'B', budget: 0 }),
    ];
    const expenses = [mkExpense({ id: 'rent', amount: 100_000, category: 'Rent' })];
    const res = computeProjectPnl(projects, [], expenses, { months: 1 });
    expect(res.allocationBasis).toBe('equal');
    expect(res.rows[0].overhead).toBe(50_000);
    expect(res.rows[1].overhead).toBe(50_000);
    expect(res.missingBudget.count).toBe(2);
  });

  it('multiplies salary by the number of months charged', () => {
    const projects = [mkProject({ id: 'a', name: 'A', budget: 100_000 })];
    const members = [mkMember({ monthlySalary: 50_000 })];
    const res = computeProjectPnl(projects, members, [], { months: 6 });
    expect(res.fixedPool.salaries).toBe(300_000);
  });

  it('filters projects by calendar year', () => {
    const projects = [
      mkProject({ id: 'old', name: 'Old', budget: 100_000, updatedAt: new Date('2025-05-01'), createdAt: new Date('2025-05-01') }),
      mkProject({ id: 'new', name: 'New', budget: 200_000, updatedAt: new Date('2026-05-01'), createdAt: new Date('2026-05-01') }),
    ];
    const res = computeProjectPnl(projects, [], [], { year: 2026, now: new Date('2026-07-23') });
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].id).toBe('new');
  });

  it('prorates a monthly project fee across the period months', () => {
    const projects = [
      mkProject({ id: 'seo', name: 'SEO', budget: 30_000, billingType: 'monthly', createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-07-01') }),
    ];
    // A period that ends on a month end is whole months: Jan..Jul = 7 → 30k × 7.
    const res = computeProjectPnl(projects, [], [], { year: 2026, now: new Date(2026, 6, 31, 23, 59, 59, 999) });
    expect(res.rows[0].billingType).toBe('monthly');
    expect(res.rows[0].activeMonths).toBe(7);
    expect(res.rows[0].revenue).toBe(210_000);
  });

  it('a month the period END cuts short earns its elapsed share, never the whole fee', () => {
    // "Ky vit" viewed on 23 July: six whole months plus 22 days of July. A whole
    // July fee against 22 days of July cost read as a margin nobody had.
    const now = new Date('2026-07-23');
    const projects = [
      mkProject({ id: 'seo', name: 'SEO', budget: 30_000, billingType: 'monthly', createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-07-01') }),
    ];
    const res = computeProjectPnl(projects, [], [], { year: 2026, now });
    const july = monthCoverage(2026, 6, new Date(2026, 0, 1), now);
    expect(july).toBeGreaterThan(0.7);
    expect(july).toBeLessThan(0.75);
    expect(res.rows[0].activeMonths).toBeCloseTo(6 + july, 9);
    expect(res.rows[0].revenue).toBeCloseTo(30_000 * (6 + july), 6);
  });

  it('infers monthly billing from isRecurring when billingType is unset', () => {
    const projects = [
      mkProject({ id: 'r', name: 'R', budget: 10_000, isRecurring: true, createdAt: new Date('2026-05-01'), updatedAt: new Date('2026-05-01') }),
    ];
    const res = computeProjectPnl(projects, [], [], { year: 2026, now: new Date(2026, 6, 31, 23, 59, 59, 999) });
    // Active May..Jul = 3 months → 30k.
    expect(res.rows[0].billingType).toBe('monthly');
    expect(res.rows[0].activeMonths).toBe(3);
    expect(res.rows[0].revenue).toBe(30_000);
  });

  it('makes the aggregate realistic once monthly fees are annualised', () => {
    // 1 salary of 100k × 7 months = 700k pool. Two monthly projects at 30k+70k
    // fee → (30k+70k) × 7 = 700k revenue → break-even overall, not -83%.
    const projects = [
      mkProject({ id: 'a', name: 'A', budget: 30_000, billingType: 'monthly', createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-07-01') }),
      mkProject({ id: 'b', name: 'B', budget: 70_000, billingType: 'monthly', createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-07-01') }),
    ];
    const members = [mkMember({ monthlySalary: 100_000 })];
    const res = computeProjectPnl(projects, members, [], { year: 2026, now: new Date(2026, 6, 31, 23, 59, 59, 999) });
    expect(res.totals.revenue).toBe(700_000);
    expect(res.fixedPool.total).toBe(700_000);
    expect(res.totals.profit).toBeCloseTo(0, 3);
  });

  it('stays break-even on a month-to-date view: the cut month is prorated on BOTH sides', () => {
    // Revenue of July is its elapsed share — and so is the PLAN payroll of July
    // (a recorded payment would never be scaled). Prorating only one side would
    // have turned a break-even year into a loss for three weeks of every month.
    const now = new Date('2026-07-23');
    const projects = [
      mkProject({ id: 'a', name: 'A', budget: 30_000, billingType: 'monthly', createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-07-01') }),
      mkProject({ id: 'b', name: 'B', budget: 70_000, billingType: 'monthly', createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-07-01') }),
    ];
    const members = [mkMember({ monthlySalary: 100_000 })];
    const res = computeProjectPnl(projects, members, [], { year: 2026, now });
    const july = monthCoverage(2026, 6, new Date(2026, 0, 1), now);
    expect(res.totals.revenue).toBeCloseTo(100_000 * (6 + july), 6);
    expect(res.fixedPool.total).toBeCloseTo(100_000 * (6 + july), 6);
    expect(res.totals.profit).toBeCloseTo(0, 3);
  });

  it('counts only COLLECTED money on the invoiced basis (unpaid ≠ profit)', () => {
    const projects = [mkProject({ id: 'a', name: 'A', budget: 100_000, billingType: 'one-time', createdAt: new Date('2026-03-01'), updatedAt: new Date('2026-03-01') })];
    const invoices = [
      { id: 'paid', projectId: 'a', total: 250_000, status: 'Paid', invoiceDate: new Date('2026-03-10'), paidAt: new Date('2026-03-15'), createdAt: new Date('2026-03-10') },
      { id: 'pending', projectId: 'a', total: 400_000, status: 'Pending', invoiceDate: new Date('2026-03-10'), createdAt: new Date('2026-03-10') },
      { id: 'overdue', projectId: 'a', total: 300_000, status: 'Overdue', invoiceDate: new Date('2026-03-10'), createdAt: new Date('2026-03-10') },
      { id: 'draft', projectId: 'a', total: 999_000, status: 'Draft', invoiceDate: new Date('2026-03-10'), createdAt: new Date('2026-03-10') },
    ] as any;
    const res = computeProjectPnl(projects, [], [], { year: 2026, now: new Date('2026-07-23'), revenueBasis: 'invoiced', invoices });
    // Only the PAID invoice counts — Pending/Overdue are receivables, not profit.
    expect(res.rows[0].revenue).toBe(250_000);
  });

  it('credits the paid part of a partially-paid invoice', () => {
    const projects = [mkProject({ id: 'a', name: 'A', budget: 0, billingType: 'one-time', createdAt: new Date('2026-03-01'), updatedAt: new Date('2026-03-01') })];
    const invoices = [
      { id: 'p', projectId: 'a', total: 100_000, status: 'Partial', invoiceDate: new Date('2026-03-10'), createdAt: new Date('2026-03-10'),
        partialPayments: [{ amount: 40_000, paidAt: new Date('2026-03-20') }] },
    ] as any;
    const res = computeProjectPnl(projects, [], [], { year: 2026, now: new Date('2026-07-23'), revenueBasis: 'invoiced', invoices });
    expect(res.rows[0].revenue).toBe(40_000);
  });

  describe('one-time revenue recognition (point in time)', () => {
    const now = new Date('2026-07-23');

    it('recognises nothing while the project is still in progress', () => {
      const projects = [mkProject({ id: 'wip', name: 'WIP', budget: 300_000, billingType: 'one-time',
        status: 'Active', lastCompletedAt: undefined, createdAt: new Date('2026-03-01'), updatedAt: new Date('2026-06-01') })];
      const res = computeProjectPnl(projects, [], [], { year: 2026, now });
      expect(res.rows[0].revenue).toBe(0);
      expect(res.rows[0].activeMonths).toBe(0);
    });

    it('recognises the full value in the month it was completed', () => {
      const projects = [mkProject({ id: 'done', name: 'Done', budget: 300_000, billingType: 'one-time',
        status: 'Completed', lastCompletedAt: new Date('2026-05-20') })];
      // May window → recognised
      const may = computeProjectPnl(projects, [], [], { range: { start: new Date(2026, 4, 1), end: new Date(2026, 4, 31, 23, 59, 59) }, months: 1, now });
      expect(may.rows[0]?.revenue).toBe(300_000);
      // June window → nothing (already earned in May)
      const jun = computeProjectPnl(projects, [], [], { range: { start: new Date(2026, 5, 1), end: new Date(2026, 5, 30, 23, 59, 59) }, months: 1, now });
      expect(jun.rows.reduce((s, r) => s + r.revenue, 0)).toBe(0);
    });

    it('does not drift with updatedAt once a completion date exists', () => {
      const projects = [mkProject({ id: 'd', name: 'D', budget: 100_000, billingType: 'one-time',
        status: 'Completed', lastCompletedAt: new Date('2026-04-10'), updatedAt: new Date('2026-07-20') })];
      const apr = computeProjectPnl(projects, [], [], { range: { start: new Date(2026, 3, 1), end: new Date(2026, 3, 30, 23, 59, 59) }, months: 1, now });
      expect(apr.rows[0]?.revenue).toBe(100_000); // stays in April despite a July edit
    });

    it('does not apply to monthly retainers (they earn every active month)', () => {
      const projects = [mkProject({ id: 'm', name: 'M', budget: 50_000, billingType: 'monthly',
        status: 'Active', lastCompletedAt: undefined, createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-07-01') })];
      const res = computeProjectPnl(projects, [], [], { range: { start: new Date(2026, 6, 1), end: new Date(2026, 6, 31, 23, 59, 59) }, months: 1, now });
      expect(res.rows[0].revenue).toBe(50_000);
    });
  });

  it('returns null margin for zero-revenue projects', () => {
    const projects = [mkProject({ id: 'a', name: 'A', budget: 0 })];
    const res = computeProjectPnl(projects, [], [], { months: 1 });
    expect(res.rows[0].margin).toBeNull();
  });

  // The 'invoiced' basis silently dropped every invoice without a projectId while
  // still allocating the FULL fixed pool across projects, so unlinked revenue read
  // as pure loss with no indication why. These guard that it is now reported.
  describe('unlinkedInvoices', () => {
    const now = new Date('2026-07-23');
    const projects = [mkProject({ id: 'a', name: 'A', budget: 100_000, billingType: 'one-time' })];

    it('reports COLLECTED invoices that carry no projectId', () => {
      const invoices = [
        { id: 'i1', projectId: 'a', total: 250_000, status: 'Paid', invoiceDate: new Date('2026-03-10'), paidAt: new Date('2026-03-12'), createdAt: new Date('2026-03-10') },
        { id: 'i2', total: 80_000, status: 'Paid', invoiceDate: new Date('2026-04-10'), paidAt: new Date('2026-04-12'), createdAt: new Date('2026-04-10') },
        // Unpaid + unlinked: not collected, so it is NOT reported as lost revenue.
        { id: 'i3', projectId: '', total: 20_000, status: 'Overdue', invoiceDate: new Date('2026-05-10'), createdAt: new Date('2026-05-10') },
      ] as any;
      const res = computeProjectPnl(projects, [], [], { year: 2026, now, revenueBasis: 'invoiced', invoices });
      expect(res.unlinkedInvoices).toEqual({ count: 1, amount: 80_000 });
      expect(res.rows[0].revenue).toBe(250_000); // unlinked value is NOT credited
    });

    it('ignores Draft and Cancelled invoices when counting unlinked ones', () => {
      const invoices = [
        { id: 'd', total: 500_000, status: 'Draft', invoiceDate: new Date('2026-03-10'), createdAt: new Date('2026-03-10') },
        { id: 'c', total: 500_000, status: 'Cancelled', invoiceDate: new Date('2026-03-10'), createdAt: new Date('2026-03-10') },
      ] as any;
      const res = computeProjectPnl(projects, [], [], { year: 2026, now, revenueBasis: 'invoiced', invoices });
      expect(res.unlinkedInvoices).toEqual({ count: 0, amount: 0 });
    });

    it('excludes unlinked invoices outside the period', () => {
      const invoices = [
        { id: 'old', total: 90_000, status: 'Paid', invoiceDate: new Date('2025-03-10'), createdAt: new Date('2025-03-10') },
      ] as any;
      const res = computeProjectPnl(projects, [], [], { year: 2026, now, revenueBasis: 'invoiced', invoices });
      expect(res.unlinkedInvoices.count).toBe(0);
    });

    it('reports them on the budget basis too, so the toggle holds no surprise', () => {
      const invoices = [
        { id: 'i2', total: 80_000, status: 'Paid', invoiceDate: new Date('2026-04-10'), createdAt: new Date('2026-04-10') },
      ] as any;
      const res = computeProjectPnl(projects, [], [], { year: 2026, now, revenueBasis: 'budget', invoices });
      expect(res.revenueBasis).toBe('budget');
      expect(res.unlinkedInvoices).toEqual({ count: 1, amount: 80_000 });
      expect(res.rows[0].revenue).toBe(100_000); // budget basis untouched
    });

    it('stays empty when no invoices are supplied', () => {
      const res = computeProjectPnl(projects, [], [], { months: 1 });
      expect(res.unlinkedInvoices).toEqual({ count: 0, amount: 0 });
    });

    it('labels the basis so a 0-revenue project can be explained correctly', () => {
      const res = computeProjectPnl(projects, [], [], { year: 2026, now, revenueBasis: 'invoiced', invoices: [] });
      expect(res.revenueBasis).toBe('invoiced');
      expect(res.missingBudget.count).toBe(1); // has a budget, but nothing invoiced
      expect(res.missingBudget.names).toEqual(['A']);
    });
  });
});

// ── Aug 2026 audit: cost must never evaporate ───────────────────────────────
describe('a project-linked expense outside the period is pooled, not lost', () => {
  const proj = (o: any) => ({
    id: o.id, name: o.id, status: o.status ?? 'Active', budget: o.budget ?? 0, currency: 'ALL',
    billingType: o.billingType ?? 'one-time', createdAt: o.createdAt, updatedAt: o.updatedAt,
    lastCompletedAt: o.lastCompletedAt,
  } as any);
  const exp = (o: any) => ({
    id: o.id, title: o.id, amount: o.amount, currency: 'ALL',
    category: o.category ?? 'Office', projectId: o.projectId, date: o.date, createdAt: o.date,
  } as any);

  it('reconciles: directCost + otherFixed equals the period expenses', () => {
    // Before the fix this cost landed in a per-project bucket that had no row
    // (the project closed in 2025) and was not added to the pool either — so
    // 500 ALL simply disappeared from every total on the page.
    const projects = [
      proj({ id: 'P2025', status: 'Completed', budget: 1000,
        createdAt: new Date(2025, 0, 1), updatedAt: new Date(2025, 5, 1), lastCompletedAt: new Date(2025, 5, 1) }),
      proj({ id: 'P2026', status: 'Completed', budget: 4000,
        createdAt: new Date(2026, 0, 1), updatedAt: new Date(2026, 3, 1), lastCompletedAt: new Date(2026, 3, 1) }),
    ];
    const expenses = [
      exp({ id: 'orphan', amount: 500, projectId: 'P2025', date: new Date(2026, 2, 10) }),
      exp({ id: 'direct', amount: 200, projectId: 'P2026', date: new Date(2026, 2, 10) }),
      exp({ id: 'rent', amount: 300, date: new Date(2026, 2, 10) }),
    ];
    const r = computeProjectPnl(projects, [], expenses, { year: 2026, mode: 'all', now: new Date(2026, 7, 22) });

    expect(r.totals.directCost).toBe(200);
    expect(r.fixedPool.otherFixed).toBe(800);           // 300 rent + the 500 orphan
    expect(r.totals.directCost + r.fixedPool.otherFixed).toBe(1000);
    // And the move is REPORTED, not silent: the money changed meaning from
    // "project cost" to "shared overhead", which shifts every project's share.
    expect(r.unallocatedDirect).toEqual({ count: 1, amount: 500 });
  });

  it('reports nothing when every tagged project is in the period', () => {
    const projects = [proj({ id: 'P', status: 'Completed', budget: 1000,
      createdAt: new Date(2026, 0, 1), updatedAt: new Date(2026, 1, 1), lastCompletedAt: new Date(2026, 1, 1) })];
    const r = computeProjectPnl(projects, [],
      [exp({ id: 'e', amount: 100, projectId: 'P', date: new Date(2026, 1, 2) })],
      { year: 2026, mode: 'all', now: new Date(2026, 7, 22) });
    expect(r.unallocatedDirect).toEqual({ count: 0, amount: 0 });
    expect(r.totals.directCost).toBe(100);
  });
});

describe('computeProjectPnl — payroll in the fixed pool', () => {
  const projects = [mkProject({ id: 'a', name: 'A', budget: 1_000_000,
    createdAt: new Date(2026, 2, 1), updatedAt: new Date(2026, 2, 15), lastCompletedAt: new Date(2026, 2, 15) })];

  it('costs a month from its RECORDED salary payments, not the profile figure', () => {
    const members = [mkMember({ monthlySalary: 100_000 })];
    const expenses = [
      mkExpense({ id: 's1', amount: 62_000, category: 'Salary', date: new Date(2026, 2, 30) }),
      mkExpense({ id: 's2', amount: 5_000, category: 'Salary', date: new Date(2026, 2, 30) }),
    ];
    const r = computeProjectPnl(projects, members, expenses, {
      range: { start: new Date(2026, 2, 1), end: new Date(2026, 2, 31, 23, 59, 59, 999) },
      mode: 'all', now: new Date(2026, 2, 31),
    });
    expect(r.fixedPool.salaries).toBe(67_000);
    // The Salary rows are NOT also counted as expenses — that would double-charge.
    expect(r.fixedPool.otherFixed).toBe(0);
    expect(r.fixedPool.payrollFallbackMonths).toBe(0);
  });

  it('falls back to the profile figure for a month with no recorded payment, and says so', () => {
    const members = [mkMember({ monthlySalary: 100_000 })];
    const r = computeProjectPnl(projects, members, [], {
      range: { start: new Date(2026, 2, 1), end: new Date(2026, 2, 31, 23, 59, 59, 999) },
      mode: 'all', now: new Date(2026, 2, 31),
    });
    expect(r.fixedPool.salaries).toBe(100_000);
    expect(r.fixedPool.payrollFallbackMonths).toBe(1);
  });

  it('charges nobody for months that ended before the member existed', () => {
    // The live bug: a year-to-date pool billed 8 months of payroll to a team
    // whose first member record was created in March.
    const members = [mkMember({ monthlySalary: 100_000, createdAt: new Date(2026, 2, 19) })];
    const r = computeProjectPnl(projects, members, [], {
      range: { start: new Date(2026, 0, 1), end: new Date(2026, 3, 30, 23, 59, 59, 999) },
      mode: 'all', now: new Date(2026, 3, 30),
    });
    expect(r.fixedPool.salaries).toBe(200_000); // March + April only
  });

  it('counts payroll paid to someone who is not a team member at all', () => {
    const expenses = [mkExpense({ id: 'f', amount: 5_000, category: 'Salary',
      title: 'Modele Lugina', date: new Date(2026, 2, 20) })];
    const r = computeProjectPnl(projects, [], expenses, {
      range: { start: new Date(2026, 2, 1), end: new Date(2026, 2, 31, 23, 59, 59, 999) },
      mode: 'all', now: new Date(2026, 2, 31),
    });
    expect(r.fixedPool.salaries).toBe(5_000);
  });
});

// ── Sep 2026 audit: a retainer earns for as long as its BILLING SERIES ran ──
// `lastCompletedAt ?? periodEnd` was wrong in both directions: it let a dead
// retainer book full budget revenue forever, and it stopped a live one the first
// time every task happened to be done.
describe('monthly retainer active span', () => {
  const now = new Date('2026-09-20');
  const sep = { start: new Date(2026, 8, 1), end: new Date(2026, 8, 30, 23, 59, 59, 999) };

  const retainer = (over: Partial<Project>) => mkProject({
    id: 'r', name: 'Retainer', budget: 50_000, billingType: 'monthly',
    createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01'),
    status: 'Active', isRecurring: true, ...over,
  } as Partial<Project>);

  it('books nothing in September for a retainer cancelled in February', () => {
    // The live bug: 50 000/month × 7 months = 450 000 of revenue that will never
    // be billed, credited to the project, its department and its owner.
    const cancelled = retainer({ status: 'Cancelled', isRecurring: false, updatedAt: new Date('2026-02-20') } as any);
    const res = computeProjectPnl([cancelled], [], [], { range: sep, months: 1, now });
    expect(res.rows).toHaveLength(0);
    expect(res.totals.revenue).toBe(0);
  });

  it('still books the months it DID run (Jan–Feb) in a full-year view', () => {
    const cancelled = retainer({ status: 'Cancelled', isRecurring: false, updatedAt: new Date('2026-02-20') } as any);
    const res = computeProjectPnl([cancelled], [], [], { year: 2026, now });
    expect(res.rows[0].activeMonths).toBe(2);
    expect(res.rows[0].revenue).toBe(100_000);
  });

  it('ends an archived retainer at archivedAt', () => {
    const archived = retainer({ status: 'Archived', isRecurring: false,
      archivedAt: new Date('2026-04-10'), updatedAt: new Date('2026-09-01') } as any);
    expect(computeProjectPnl([archived], [], [], { range: sep, months: 1, now }).rows).toHaveLength(0);
    // …and counts Jan–Apr in the year view, not Jan–Sep.
    expect(computeProjectPnl([archived], [], [], { year: 2026, now }).rows[0].activeMonths).toBe(4);
  });

  it('ends a series the owner switched off at recurringBillingStoppedAt', () => {
    // stopProjectBillingPatch() leaves the project Active and billingType alone.
    const stopped = retainer({ isRecurring: false, recurringBillingStoppedReason: 'manual',
      recurringBillingStoppedAt: new Date('2026-05-31') } as any);
    expect(computeProjectPnl([stopped], [], [], { range: sep, months: 1, now }).rows).toHaveLength(0);
    expect(computeProjectPnl([stopped], [], [], { year: 2026, now }).rows[0].activeMonths).toBe(5);
  });

  it('ends a series at its "repeat until" date', () => {
    const ending = retainer({ recurringEndDate: new Date('2026-06-30') } as any);
    expect(computeProjectPnl([ending], [], [], { range: sep, months: 1, now }).rows).toHaveLength(0);
    expect(computeProjectPnl([ending], [], [], { year: 2026, now }).rows[0].activeMonths).toBe(6);
  });

  it('keeps a LIVE retainer earning after an all-tasks-done moment', () => {
    // `lastCompletedAt` means "the last time every task was done", not "the
    // engagement ended" — reading it as the end stopped a running retainer from
    // earning for the rest of the year.
    const live = retainer({ lastCompletedAt: new Date('2026-03-20') } as any);
    const res = computeProjectPnl([live], [], [], { year: 2026, now: new Date(2026, 6, 31, 23, 59, 59, 999) });
    expect(res.rows[0].activeMonths).toBe(7);   // Jan..Jul, not Jan..Mar
    expect(res.rows[0].revenue).toBe(350_000);
  });

  it('still honours lastCompletedAt for a legacy row with no series flags', () => {
    // Nothing says when this one stopped except the completion stamp, so it is
    // the only evidence there is.
    const legacy = retainer({ isRecurring: false, lastCompletedAt: new Date('2026-03-20') } as any);
    expect(computeProjectPnl([legacy], [], [], { year: 2026, now: new Date('2026-07-23') }).rows[0].activeMonths).toBe(3);
  });
});

// ── Sep 2026 audit: labour no row carries is pooled, never dropped ──────────
describe('hours model: labour outside the period rows', () => {
  const period = { start: new Date(2026, 8, 1), end: new Date(2026, 8, 30, 23, 59, 59, 999) };
  const settings = { employerCostPct: 0, defaultClientCapacityHours: 120 }; // 120 000 / 120 h = 1 000 L/h
  const ana = mkMember({ id: 'ana', userId: 'ana', displayName: 'ana', monthlySalary: 120_000 });
  const entry = (projectId: string | undefined, hours: number): TimeEntry => ({
    id: `${projectId}-${hours}`, userId: 'ana', projectId, startTime: new Date('2026-09-10T09:00:00'), endTime: new Date('2026-09-10T17:00:00'),
    source: 'manual', duration: hours * 60, createdAt: new Date('2026-09-10'), updatedAt: new Date('2026-09-10'),
  } as TimeEntry);

  it('hours with no project and hours on a project with no row both land in the fixed pool', () => {
    const inRow = mkProject({ id: 'pX', name: 'X', status: 'Active', budget: 200_000, billingType: 'monthly', createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01') });
    const labor = allocateLabor({ timeEntries: [entry('pX', 30), entry(undefined, 5), entry('gone', 10)], members: [ana], expenses: [], period, settings });
    const res = computeProjectPnl([inRow], [ana], [], { range: period, labor, timeEntries: [] });
    // payroll 120 000; on the row 30 000; no project 5 000; 'gone' 10 000; bench 75 000
    expect(res.laborBasis).toBe('hours');
    expect(res.rows[0].laborCost).toBe(30_000);
    expect(res.fixedPool.laborOutsideRows).toBe(15_000);
    expect(res.fixedPool.salaries).toBe(75_000 + 15_000);
    const payroll = payrollBetween([ana], [], period.start, period.end).total;
    expect(res.rows[0].laborCost + res.fixedPool.salaries).toBeCloseTo(payroll, 6);
    // and the whole pool reaches the one row
    expect(res.rows[0].overhead).toBeCloseTo(90_000, 6);
  });
});

// ── Oct 2026 audit ──────────────────────────────────────────────────────────
describe('hours model: a one-time project earns in the period its hours are logged', () => {
  const period = { start: new Date(2026, 8, 1), end: new Date(2026, 8, 30, 23, 59, 59, 999) };
  const settings = { employerCostPct: 0, defaultClientCapacityHours: 120 }; // 1 000 L/h
  const ana = mkMember({ id: 'ana', userId: 'ana', displayName: 'ana', monthlySalary: 120_000 });
  const entry = (projectId: string, hours: number): TimeEntry => ({
    id: `${projectId}-${hours}`, userId: 'ana', projectId, date: '2026-09-10', startTime: new Date('2026-09-10T09:00:00'),
    source: 'manual', duration: hours * 60, createdAt: new Date('2026-09-10'), updatedAt: new Date('2026-09-10'),
  } as TimeEntry);
  // Created and last edited in JULY; 50 of 100 planned hours logged in SEPTEMBER.
  const fixedFee = mkProject({
    id: 'ff', name: 'Fixed fee', status: 'Active', billingType: 'one-time', budget: 100_000, plannedHours: 100,
    createdAt: new Date('2026-07-05'), updatedAt: new Date('2026-07-20'),
  });
  const entries = [entry('ff', 50)];

  it('September carries its row: 50 000 earned, its own 50 h of labour (not pooled onto others)', () => {
    const labor = allocateLabor({ timeEntries: entries, members: [ana], expenses: [], period, settings, clientProjectIds: new Set(['ff']) });
    const res = computeProjectPnl([fixedFee], [ana], [], { range: period, labor, timeEntries: entries });
    expect(res.rows.map(r => r.id)).toEqual(['ff']);
    expect(res.rows[0].revenue).toBeCloseTo(50_000);
    expect(res.rows[0].laborCost).toBeCloseTo(50_000);
    expect(res.rows[0].hours).toBe(50);
    expect(res.fixedPool.laborOutsideRows).toBe(0);
  });

  it('legacy model (no hours) is unchanged: not in September', () => {
    const res = computeProjectPnl([fixedFee], [ana], [], { range: period, timeEntries: entries });
    expect(res.rows).toEqual([]);
  });
});

describe('invoices pointing at a deleted project are reported, not lost', () => {
  it('counts an unresolved projectId as unlinked (and separately as unresolved)', () => {
    const now = new Date('2026-07-23');
    const projects = [mkProject({ id: 'a', name: 'A', budget: 100_000, billingType: 'one-time' })];
    const invoices = [
      { id: 'ok', projectId: 'a', total: 50_000, status: 'Paid', invoiceDate: new Date('2026-03-10'), paidAt: new Date('2026-03-12'), createdAt: new Date('2026-03-10') },
      { id: 'ghost', projectId: 'deleted', total: 30_000, status: 'Paid', invoiceDate: new Date('2026-04-10'), paidAt: new Date('2026-04-12'), createdAt: new Date('2026-04-10') },
      { id: 'none', total: 20_000, status: 'Paid', invoiceDate: new Date('2026-04-10'), paidAt: new Date('2026-04-12'), createdAt: new Date('2026-04-10') },
    ] as any;
    const res = computeProjectPnl(projects, [], [], { year: 2026, now, revenueBasis: 'invoiced', invoices });
    expect(res.unlinkedInvoices).toEqual({ count: 2, amount: 50_000 });
    expect(res.unresolvedInvoices).toEqual({ count: 1, amount: 30_000 });
    expect(res.rows.map(r => r.id)).toEqual(['a']);
    expect(res.rows[0].revenue).toBe(50_000);
  });
});

describe('weekly retainer: budget is a WEEKLY fee (the cron bills it every week)', () => {
  it('earns budget × 52/12 per month, the same as MRR', () => {
    const weekly = mkProject({
      id: 'w', name: 'W', status: 'Active', billingType: 'monthly', isRecurring: true, recurringFrequency: 'weekly',
      budget: 12_000, createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01'),
    } as any);
    const monthly = mkProject({ ...weekly, id: 'm', recurringFrequency: 'monthly' } as any);
    const range = { start: new Date(2026, 2, 1), end: new Date(2026, 2, 31, 23, 59, 59, 999) };
    const res = computeProjectPnl([weekly, monthly], [], [], { range, now: new Date('2026-06-01') });
    expect(res.rows.find(r => r.id === 'w')!.revenue).toBeCloseTo(52_000);
    expect(res.rows.find(r => r.id === 'm')!.revenue).toBeCloseTo(12_000);
  });
});
