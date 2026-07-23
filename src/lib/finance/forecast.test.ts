import { describe, expect, it } from 'vitest';
import type { Invoice, Expense, TeamMember } from '../../types';
import { forecastNextMonth } from './forecast';

const NOW = new Date('2026-07-15T12:00:00');

function paidInvoice(id: string, amount: number, paidAt: Date): Invoice {
  return { id, amount, total: amount, status: 'Paid', paidAt, createdAt: paidAt } as Invoice;
}
function mkExpense(id: string, amount: number, date: Date, category = 'Rent'): Expense {
  return { id, title: 'x', amount, category, currency: 'ALL', date } as Expense;
}
function mkMember(salary: number): TeamMember {
  return { id: 'm', teamId: 't', userId: 'u', role: 'Member', status: 'Active', monthlySalary: salary } as TeamMember;
}

describe('forecastNextMonth', () => {
  it('averages the trailing 3 months of revenue and expenses, uses next-month salary', () => {
    // Collected: Apr 100k, May 200k, Jun 300k → avg 200k.
    const invoices = [
      paidInvoice('a', 100_000, new Date('2026-04-10')),
      paidInvoice('b', 200_000, new Date('2026-05-10')),
      paidInvoice('c', 300_000, new Date('2026-06-10')),
    ];
    // Expenses: Apr 30k, May 30k, Jun 60k → avg 40k.
    const expenses = [
      mkExpense('e1', 30_000, new Date('2026-04-05')),
      mkExpense('e2', 30_000, new Date('2026-05-05')),
      mkExpense('e3', 60_000, new Date('2026-06-05')),
    ];
    const members = [mkMember(80_000)];

    const f = forecastNextMonth(invoices, expenses, members, NOW);
    expect(f.year).toBe(2026);
    expect(f.monthIndex).toBe(7); // August
    expect(f.predictedRevenue).toBe(200_000);
    expect(f.predictedOtherExpenses).toBe(40_000);
    expect(f.predictedSalary).toBe(80_000);
    expect(f.predictedProfit).toBe(200_000 - 80_000 - 40_000); // 80k
  });

  it('ignores the current (incomplete) month and future months', () => {
    const invoices = [
      paidInvoice('now', 999_000, new Date('2026-07-10')), // current month — excluded
      paidInvoice('jun', 300_000, new Date('2026-06-10')),
    ];
    const f = forecastNextMonth(invoices, [], [], NOW);
    // Only Jun contributes among the 3 trailing months → 300k/3 = 100k.
    expect(f.predictedRevenue).toBe(100_000);
  });
});
