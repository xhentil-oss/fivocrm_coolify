import { describe, expect, it } from 'vitest';
import type { Expense, TeamMember, Project } from '../../types';
import { forecastNextMonth } from './forecast';

const NOW = new Date('2026-07-15T12:00:00'); // forecast month = August 2026

function mkProject(p: Partial<Project>): Project {
  return {
    id: p.id || 'p', name: p.name || 'P', status: p.status || 'Active',
    budget: p.budget, billingType: p.billingType, startDate: p.startDate,
    createdAt: p.createdAt ?? new Date('2026-01-01'), updatedAt: new Date('2026-01-01'),
    createdByUserId: null, ...p,
  } as Project;
}
function mkExpense(id: string, amount: number, date: Date): Expense {
  return { id, title: 'x', amount, category: 'Rent', currency: 'ALL', date } as Expense;
}
function mkMember(salary: number): TeamMember {
  return { id: 'm', teamId: 't', userId: 'u', role: 'Member', status: 'Active', monthlySalary: salary } as TeamMember;
}

describe('forecastNextMonth (project-based revenue)', () => {
  it('sums active monthly project fees as recurring revenue', () => {
    const projects = [
      mkProject({ id: 'a', budget: 30_000, billingType: 'monthly', status: 'Active' }),
      mkProject({ id: 'b', budget: 20_000, billingType: 'monthly', status: 'On Hold' }),
      mkProject({ id: 'done', budget: 99_000, billingType: 'monthly', status: 'Completed' }), // excluded
    ];
    const f = forecastNextMonth(projects, [], [], NOW);
    expect(f.recurringRevenue).toBe(50_000);
    expect(f.newProjectRevenue).toBe(0);
    expect(f.monthIndex).toBe(7); // August
  });

  it('counts a one-time project only when it starts in the forecast month', () => {
    const projects = [
      mkProject({ id: 'aug', budget: 200_000, billingType: 'one-time', status: 'Planning', startDate: new Date('2026-08-05') }),
      mkProject({ id: 'sep', budget: 500_000, billingType: 'one-time', status: 'Planning', startDate: new Date('2026-09-05') }), // future, excluded
      mkProject({ id: 'nostart', budget: 400_000, billingType: 'one-time', status: 'Planning' }), // no startDate, excluded
    ];
    const f = forecastNextMonth(projects, [], [], NOW);
    expect(f.newProjectRevenue).toBe(200_000);
    expect(f.recurringRevenue).toBe(0);
  });

  it('computes profit = project revenue − next-month salary − avg other expenses', () => {
    const projects = [mkProject({ id: 'a', budget: 100_000, billingType: 'monthly', status: 'Active' })];
    // Expenses Apr/May/Jun = 30k each → avg 30k.
    const expenses = [
      mkExpense('e1', 30_000, new Date('2026-04-05')),
      mkExpense('e2', 30_000, new Date('2026-05-05')),
      mkExpense('e3', 30_000, new Date('2026-06-05')),
    ];
    const members = [mkMember(40_000)];
    const f = forecastNextMonth(projects, expenses, members, NOW);
    expect(f.predictedRevenue).toBe(100_000);
    expect(f.predictedSalary).toBe(40_000);
    expect(f.predictedOtherExpenses).toBe(30_000);
    expect(f.predictedProfit).toBe(100_000 - 40_000 - 30_000); // 30k
  });
});
