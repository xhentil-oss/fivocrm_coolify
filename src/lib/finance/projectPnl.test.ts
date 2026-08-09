import { describe, expect, it } from 'vitest';
import type { Project, TeamMember, Expense } from '../../types';
import { computeProjectPnl } from './projectPnl';

function mkProject(p: Partial<Project>): Project {
  return {
    id: p.id || 'p1',
    name: p.name || 'Project',
    status: p.status || 'Active',
    budget: p.budget,
    customerId: p.customerId,
    responsibleUserId: p.responsibleUserId,
    createdByUserId: p.createdByUserId ?? null,
    createdAt: p.createdAt ?? new Date('2026-03-01'),
    updatedAt: p.updatedAt ?? new Date('2026-03-01'),
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
    const res = computeProjectPnl(projects, [], [], { year: 2026, now: new Date('2026-07-23') });
    // Jan..Jul = 7 months elapsed → 30k × 7.
    expect(res.rows[0].billingType).toBe('monthly');
    expect(res.rows[0].activeMonths).toBe(7);
    expect(res.rows[0].revenue).toBe(210_000);
  });

  it('infers monthly billing from isRecurring when billingType is unset', () => {
    const projects = [
      mkProject({ id: 'r', name: 'R', budget: 10_000, isRecurring: true, createdAt: new Date('2026-05-01'), updatedAt: new Date('2026-05-01') }),
    ];
    const res = computeProjectPnl(projects, [], [], { year: 2026, now: new Date('2026-07-23') });
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
    const res = computeProjectPnl(projects, members, [], { year: 2026, now: new Date('2026-07-23') });
    expect(res.totals.revenue).toBe(700_000);
    expect(res.fixedPool.total).toBe(700_000);
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
