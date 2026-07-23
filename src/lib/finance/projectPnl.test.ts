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

  it('returns null margin for zero-revenue projects', () => {
    const projects = [mkProject({ id: 'a', name: 'A', budget: 0 })];
    const res = computeProjectPnl(projects, [], [], { months: 1 });
    expect(res.rows[0].margin).toBeNull();
  });
});
