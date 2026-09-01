import { describe, expect, it } from 'vitest';
import type { Expense, TeamMember, Project, Invoice } from '../../types';
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
  it('counts every monthly project the billing engine will actually bill', () => {
    const projects = [
      mkProject({ id: 'a', budget: 30_000, billingType: 'monthly', status: 'Active' }),
      mkProject({ id: 'b', budget: 20_000, billingType: 'monthly', status: 'On Hold' }),
      // A COMPLETED retainer still bills — for a retainer, "Completed" means this
      // cycle's work is done, and projectBillingBlockReason lets it through. The
      // old status allow-list dropped it, so real MRR was under-reported.
      mkProject({ id: 'done', budget: 99_000, billingType: 'monthly', status: 'Completed' }),
    ];
    const f = forecastNextMonth(projects, [], [], [], NOW);
    expect(f.recurringRevenue).toBe(149_000);
    expect(f.newProjectRevenue).toBe(0);
    expect(f.monthIndex).toBe(7); // August
  });

  it('drops retainers that will NOT bill: paused, terminal, or past their end date', () => {
    const projects = [
      mkProject({ id: 'live', budget: 30_000, billingType: 'monthly', status: 'Active' }),
      mkProject({ id: 'paused', budget: 40_000, billingType: 'monthly', status: 'Active', isRecurringPaused: true } as any),
      mkProject({ id: 'cancelled', budget: 50_000, billingType: 'monthly', status: 'Cancelled' }),
      mkProject({ id: 'archived', budget: 60_000, billingType: 'monthly', status: 'Archived' }),
      // "Repeat until" already passed before the forecast month starts.
      mkProject({ id: 'ended', budget: 70_000, billingType: 'monthly', status: 'Active', recurringEndDate: new Date('2026-07-20') } as any),
    ];
    const f = forecastNextMonth(projects, [], [], [], NOW);
    expect(f.recurringRevenue).toBe(30_000);
  });

  it('drops a recurring invoice series past its end date', () => {
    const invoices: Invoice[] = [
      { id: 'live', total: 10_000, status: 'Pending', isRecurring: true, recurringFrequency: 'monthly', createdAt: new Date('2026-01-01') } as Invoice,
      { id: 'ended', total: 90_000, status: 'Pending', isRecurring: true, recurringFrequency: 'monthly', recurringEndDate: new Date('2026-07-01'), createdAt: new Date('2026-01-01') } as any,
    ];
    const f = forecastNextMonth([], invoices, [], [], NOW);
    expect(f.recurringRevenue).toBe(10_000);
  });

  it('counts a one-time project only when it starts in the forecast month', () => {
    const projects = [
      mkProject({ id: 'aug', budget: 200_000, billingType: 'one-time', status: 'Planning', startDate: new Date('2026-08-05') }),
      mkProject({ id: 'sep', budget: 500_000, billingType: 'one-time', status: 'Planning', startDate: new Date('2026-09-05') }), // future, excluded
      mkProject({ id: 'nostart', budget: 400_000, billingType: 'one-time', status: 'Planning' }), // no startDate, excluded
    ];
    const f = forecastNextMonth(projects, [], [], [], NOW);
    expect(f.newProjectRevenue).toBe(200_000);
    expect(f.recurringRevenue).toBe(0);
  });

  it('includes active recurring invoices (normalised /month), deduped vs counted projects', () => {
    const projects = [mkProject({ id: 'proj', budget: 30_000, billingType: 'monthly', status: 'Active' })];
    const invoices: Invoice[] = [
      // Monthly recurring invoice, not tied to a counted project → +50k.
      { id: 'r1', total: 50_000, status: 'Pending', isRecurring: true, recurringFrequency: 'monthly', createdAt: new Date('2026-01-01') } as Invoice,
      // Yearly recurring invoice → 120k/12 = 10k/month.
      { id: 'r2', total: 120_000, status: 'Pending', isRecurring: true, recurringFrequency: 'yearly', createdAt: new Date('2026-01-01') } as Invoice,
      // Recurring invoice tied to the counted project → skipped (no double count).
      { id: 'r3', total: 999_000, status: 'Pending', isRecurring: true, recurringFrequency: 'monthly', projectId: 'proj', createdAt: new Date('2026-01-01') } as Invoice,
      // Paused / auto-generated / draft → all excluded.
      { id: 'p', total: 40_000, status: 'Pending', isRecurring: true, isRecurringPaused: true, recurringFrequency: 'monthly', createdAt: new Date('2026-01-01') } as Invoice,
      { id: 'child', total: 40_000, status: 'Pending', isRecurring: true, autoGenerated: true, recurringFrequency: 'monthly', createdAt: new Date('2026-01-01') } as Invoice,
    ];
    const f = forecastNextMonth(projects, invoices, [], [], NOW);
    // 30k project + 50k + 10k = 90k.
    expect(f.recurringRevenue).toBe(90_000);
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
    const f = forecastNextMonth(projects, [], expenses, members, NOW);
    expect(f.predictedRevenue).toBe(100_000);
    expect(f.predictedSalary).toBe(40_000);
    expect(f.predictedOtherExpenses).toBe(30_000);
    expect(f.predictedProfit).toBe(100_000 - 40_000 - 30_000); // 30k
  });
});

// ── Aug 2026 audit: the forecast and the cashflow card must agree ───────────
describe('expense forecast: commitment + one-offs, never both from an average', () => {
  it('takes a recurring series from its COMMITMENT rate, not the trailing average', () => {
    // A monthly retainer booked in only ONE of the last three months averaged to
    // a third of its real cost, while the cashflow card charged the full rate —
    // two cards on the same screen, two answers for the same month.
    const recurringParent = {
      id: 'rent', title: 'Qira', amount: 90_000, category: 'Rent', currency: 'ALL',
      isRecurring: true, recurringFrequency: 'monthly',
      date: new Date('2026-06-01'),
    } as Expense;

    const f = forecastNextMonth([], [], [recurringParent], [], NOW);
    expect(f.recurringExpenseCommitment).toBe(90_000);
    expect(f.predictedOneOffExpenses).toBe(0);   // the parent row is NOT averaged too
    expect(f.predictedOtherExpenses).toBe(90_000);
  });

  it('averages only expenses that are not part of a series', () => {
    const oneOffs = [
      mkExpense('a', 3_000, new Date('2026-06-10')),
      mkExpense('b', 3_000, new Date('2026-05-10')),
      mkExpense('c', 3_000, new Date('2026-04-10')),
    ];
    const f = forecastNextMonth([], [], oneOffs, [], NOW);
    expect(f.recurringExpenseCommitment).toBe(0);
    expect(f.predictedOneOffExpenses).toBe(3_000);
    expect(f.predictedOtherExpenses).toBe(3_000);
  });

  it('does not double-count a generated occurrence alongside its parent', () => {
    const parent = {
      id: 'p', title: 'Hosting', amount: 10_000, category: 'Hosting', currency: 'ALL',
      isRecurring: true, recurringFrequency: 'monthly', date: new Date('2026-04-01'),
    } as Expense;
    const children = ['2026-05-01', '2026-06-01'].map((d, i) => ({
      id: `c${i}`, title: 'Hosting', amount: 10_000, category: 'Hosting', currency: 'ALL',
      autoGenerated: true, parentExpenseId: 'p', date: new Date(d),
    } as Expense));

    const f = forecastNextMonth([], [], [parent, ...children], [], NOW);
    expect(f.recurringExpenseCommitment).toBe(10_000);
    expect(f.predictedOneOffExpenses).toBe(0);
    expect(f.predictedOtherExpenses).toBe(10_000);   // not 10k + 20k/3
  });

  it('a paused series is no longer a commitment', () => {
    const paused = {
      id: 'p', title: 'Reklama', amount: 50_000, category: 'Marketing', currency: 'ALL',
      isRecurring: true, isRecurringPaused: true, recurringFrequency: 'monthly',
      date: new Date('2026-06-01'),
    } as Expense;
    const f = forecastNextMonth([], [], [paused], [], NOW);
    expect(f.predictedOtherExpenses).toBe(0);
  });
});
