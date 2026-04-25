import { describe, expect, it } from 'vitest';
import type { Expense, Invoice } from '../../types';
import {
  MONTH_LABELS_SQ,
  buildCashflowByMonth,
  buildExpensesByMonth,
  buildRevenueByMonth,
  calculateCollectedRevenue,
  calculateProjectedRevenue,
  calculateRevenueBetween,
  calculateTotalExpenses,
  getFinancialAvailableYears,
} from './financialAnalytics';

function mkInvoice(partial?: Partial<Invoice>): Invoice {
  return {
    id: partial?.id || 'inv-1',
    amount: partial?.amount ?? 0,
    status: partial?.status ?? 'Draft',
    createdAt: partial?.createdAt ?? new Date('2026-01-01T10:00:00Z'),
    updatedAt: partial?.updatedAt ?? new Date('2026-01-01T10:00:00Z'),
    createdByUserId: partial?.createdByUserId ?? null,
    ...partial,
  };
}

function mkExpense(partial?: Partial<Expense>): Expense {
  return {
    id: partial?.id || 'exp-1',
    title: partial?.title || 'Expense',
    amount: partial?.amount ?? 0,
    category: partial?.category || 'General',
    createdAt: partial?.createdAt ?? new Date('2026-01-01T10:00:00Z'),
    updatedAt: partial?.updatedAt ?? new Date('2026-01-01T10:00:00Z'),
    createdByUserId: partial?.createdByUserId ?? null,
    ...partial,
  };
}

describe('financial analytics engine', () => {
  it('builds available years from invoices, partial payments and expenses', () => {
    const invoices: Invoice[] = [
      mkInvoice({
        status: 'Paid',
        paidAt: new Date('2025-03-10T12:00:00Z'),
      }),
      mkInvoice({
        id: 'inv-2',
        status: 'Partial',
        partialPayments: [{ amount: 300, paidAt: new Date('2024-08-12T12:00:00Z') }],
      }),
    ];
    const expenses: Expense[] = [mkExpense({ date: new Date('2023-05-15T12:00:00Z') })];

    const years = getFinancialAvailableYears(invoices, expenses, new Date('2026-04-25T10:00:00Z'));

    expect(years).toContain(2026);
    expect(years).toContain(2025);
    expect(years).toContain(2024);
    expect(years).toContain(2023);
  });

  it('places paid and partial revenues in the correct month', () => {
    const invoices: Invoice[] = [
      mkInvoice({
        id: 'inv-paid-mar',
        status: 'Paid',
        total: 1000,
        currency: 'ALL',
        paidAt: new Date('2026-03-11T12:00:00Z'),
      }),
      mkInvoice({
        id: 'inv-partial-mar',
        status: 'Partial',
        total: 2000,
        paidAmount: 500,
        currency: 'ALL',
        partialPayments: [{ amount: 500, paidAt: new Date('2026-03-20T12:00:00Z') }],
      }),
      mkInvoice({
        id: 'inv-partial-apr',
        status: 'Partial',
        total: 3000,
        paidAmount: 600,
        currency: 'ALL',
        partialPayments: [{ amount: 600, paidAt: new Date('2026-04-05T12:00:00Z') }],
      }),
    ];

    const byMonth = buildRevenueByMonth(invoices, 2026, MONTH_LABELS_SQ);
    const march = byMonth[2];
    const april = byMonth[3];

    expect(march.paid).toBe(1500);
    expect(april.paid).toBe(600);
  });

  it('uses expense.date (fallback createdAt) for monthly expenses and cashflow', () => {
    const expenses: Expense[] = [
      mkExpense({ id: 'exp-1', amount: 200, currency: 'ALL', date: new Date('2026-02-02T12:00:00Z') }),
      mkExpense({ id: 'exp-2', amount: 300, currency: 'ALL', createdAt: new Date('2026-02-03T12:00:00Z') }),
    ];

    const expenseByMonth = buildExpensesByMonth(expenses, 2026, 100, MONTH_LABELS_SQ);
    const february = expenseByMonth[1];

    expect(february.value).toBe(600);

    const invoices: Invoice[] = [
      mkInvoice({ status: 'Paid', total: 1000, currency: 'ALL', paidAt: new Date('2026-02-10T12:00:00Z') }),
    ];
    const cashflow = buildCashflowByMonth(invoices, expenses, 2026, 100, MONTH_LABELS_SQ);

    expect(cashflow[1].inflow).toBe(1000);
    expect(cashflow[1].outflow).toBe(600);
    expect(cashflow[1].net).toBe(400);
  });

  it('calculates totals and revenue ranges correctly', () => {
    const invoices: Invoice[] = [
      mkInvoice({ status: 'Paid', total: 1200, currency: 'ALL', paidAt: new Date('2026-03-01T12:00:00Z') }),
      mkInvoice({
        status: 'Partial',
        total: 1000,
        paidAmount: 300,
        currency: 'ALL',
        partialPayments: [{ amount: 300, paidAt: new Date('2026-03-15T12:00:00Z') }],
      }),
      mkInvoice({ status: 'Pending', total: 500, currency: 'ALL' }),
    ];
    const expenses: Expense[] = [mkExpense({ amount: 250, currency: 'ALL' })];

    expect(calculateCollectedRevenue(invoices)).toBe(1500);
    expect(calculateProjectedRevenue(invoices)).toBe(1200);
    expect(calculateTotalExpenses(expenses, 100)).toBe(350);

    const rangeRevenue = calculateRevenueBetween(
      invoices,
      new Date('2026-03-01T00:00:00Z'),
      new Date('2026-03-31T23:59:59Z'),
    );
    expect(rangeRevenue).toBe(1500);
  });
});
