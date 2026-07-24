import { describe, expect, it } from 'vitest';
import type { Expense, Invoice } from '../../types';
import {
  MONTH_LABELS_SQ,
  buildARAging,
  buildCashflowByMonth,
  buildExpensesByMonth,
  buildRevenueByMonth,
  buildRevenueByMonthAccrual,
  buildRevenueByMonthByBasis,
  calculateAccountsReceivable,
  calculateAccrualRevenueBetween,
  calculateCollectedRevenue,
  calculateProjectedRevenue,
  calculateRevenueBetween,
  calculateTotalExpenses,
  calculateExpensesBetween,
  getInvoiceCollectedBetween,
  monthHasOccurred,
  monthsElapsedInYear,
  getFinancialAvailableYears,
  getInvoiceOutstandingAll,
  parseDate,
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

describe('parseDate', () => {
  it('handles Firestore Timestamp-like values', () => {
    const iso = '2026-06-15T00:00:00.000Z';
    expect(parseDate({ toDate: () => new Date(iso) })?.toISOString()).toBe(iso);
    expect(parseDate({ seconds: Math.floor(new Date(iso).getTime() / 1000) })?.getUTCFullYear()).toBe(2026);
    expect(parseDate({ _seconds: Math.floor(new Date(iso).getTime() / 1000) })?.getUTCFullYear()).toBe(2026);
    expect(parseDate(new Date(iso))?.toISOString()).toBe(iso);
    expect(parseDate(null)).toBeNull();
    expect(parseDate('not-a-date')).toBeNull();
  });
});

describe('rejected-expense exclusion', () => {
  const start = new Date('2026-06-01'), end = new Date('2026-06-30T23:59:59');
  it('excludes rejected expenses from calculateExpensesBetween and calculateTotalExpenses', () => {
    const expenses: Expense[] = [
      mkExpense({ id: 'ok', amount: 100, category: 'Rent', date: new Date('2026-06-10') }),
      mkExpense({ id: 'rej', amount: 500, category: 'Rent', date: new Date('2026-06-10'), approvalStatus: 'Rejected' } as any),
    ];
    expect(calculateExpensesBetween(expenses, start, end)).toBe(100);
    expect(calculateTotalExpenses(expenses, 0)).toBe(100);
  });
});

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

describe('ERP-grade accounting helpers (accrual + AR)', () => {
  it('attributes accrual revenue to invoice month regardless of payment', () => {
    const invoices: Invoice[] = [
      // Invoiced in April, paid in May — should count for April under accrual.
      mkInvoice({
        id: 'a',
        status: 'Paid',
        total: 1000,
        currency: 'ALL',
        invoiceDate: new Date('2026-04-15T10:00:00Z'),
        paidAt: new Date('2026-05-03T10:00:00Z'),
      }),
      // Pending invoice in February — counted as outstanding for Feb.
      mkInvoice({
        id: 'b',
        status: 'Pending',
        total: 500,
        currency: 'ALL',
        invoiceDate: new Date('2026-02-10T10:00:00Z'),
      }),
      // Draft — should be ignored.
      mkInvoice({
        id: 'c',
        status: 'Draft',
        total: 999,
        currency: 'ALL',
        invoiceDate: new Date('2026-04-20T10:00:00Z'),
      }),
    ];

    const months = buildRevenueByMonthAccrual(invoices, 2026, MONTH_LABELS_SQ);
    const feb = months[1];
    const apr = months[3];
    const may = months[4];

    // Under accrual: paid = total billed for that month, pending = outstanding.
    expect(apr.paid).toBe(1000); // April invoice billed (and fully collected)
    expect(apr.pending).toBe(0);
    expect(may.paid).toBe(0); // payment month is irrelevant for accrual
    expect(feb.paid).toBe(500); // Feb invoice billed at full value
    expect(feb.pending).toBe(500); // still outstanding
  });

  it('dispatches buildRevenueByMonthByBasis correctly', () => {
    const invoices: Invoice[] = [
      mkInvoice({
        id: 'p1',
        status: 'Paid',
        total: 700,
        currency: 'ALL',
        invoiceDate: new Date('2026-04-15T10:00:00Z'),
        paidAt: new Date('2026-05-03T10:00:00Z'),
      }),
    ];
    const accrual = buildRevenueByMonthByBasis('accrual', invoices, 2026, MONTH_LABELS_SQ);
    const cash = buildRevenueByMonthByBasis('cash', invoices, 2026, MONTH_LABELS_SQ);
    expect(accrual[3].paid).toBe(700); // April
    expect(accrual[4].paid).toBe(0);
    expect(cash[3].paid).toBe(0);
    expect(cash[4].paid).toBe(700); // May
  });

  it('computes outstanding correctly per status', () => {
    expect(getInvoiceOutstandingAll(mkInvoice({ status: 'Paid', total: 1000, currency: 'ALL' }))).toBe(0);
    expect(getInvoiceOutstandingAll(mkInvoice({ status: 'Draft', total: 1000, currency: 'ALL' }))).toBe(0);
    expect(getInvoiceOutstandingAll(mkInvoice({ status: 'Pending', total: 1000, currency: 'ALL' }))).toBe(1000);
    expect(
      getInvoiceOutstandingAll(
        mkInvoice({ status: 'Partial', total: 1000, paidAmount: 300, currency: 'ALL' }),
      ),
    ).toBe(700);
  });

  it('sums total accounts receivable across statuses', () => {
    const invoices: Invoice[] = [
      mkInvoice({ id: '1', status: 'Pending', total: 500, currency: 'ALL' }),
      mkInvoice({ id: '2', status: 'Overdue', total: 300, currency: 'ALL' }),
      mkInvoice({ id: '3', status: 'Partial', total: 1000, paidAmount: 400, currency: 'ALL' }),
      mkInvoice({ id: '4', status: 'Paid', total: 9999, currency: 'ALL' }),
      mkInvoice({ id: '5', status: 'Draft', total: 9999, currency: 'ALL' }),
    ];
    expect(calculateAccountsReceivable(invoices)).toBe(500 + 300 + 600);
  });

  it('classifies AR into aging buckets', () => {
    const asOf = new Date('2026-06-30T12:00:00Z');
    const invoices: Invoice[] = [
      mkInvoice({
        id: 'fresh',
        status: 'Pending',
        total: 100,
        currency: 'ALL',
        invoiceDate: new Date('2026-06-15T10:00:00Z'), // 15 days
      }),
      mkInvoice({
        id: 'mid',
        status: 'Pending',
        total: 200,
        currency: 'ALL',
        invoiceDate: new Date('2026-05-15T10:00:00Z'), // ~46 days
      }),
      mkInvoice({
        id: 'older',
        status: 'Overdue',
        total: 300,
        currency: 'ALL',
        invoiceDate: new Date('2026-04-15T10:00:00Z'), // ~76 days
      }),
      mkInvoice({
        id: 'ancient',
        status: 'Overdue',
        total: 400,
        currency: 'ALL',
        invoiceDate: new Date('2026-01-15T10:00:00Z'), // ~166 days
      }),
    ];
    const aging = buildARAging(invoices, asOf);
    expect(aging['0-30']).toBe(100);
    expect(aging['31-60']).toBe(200);
    expect(aging['61-90']).toBe(300);
    expect(aging['90+']).toBe(400);
    const total = aging['0-30'] + aging['31-60'] + aging['61-90'] + aging['90+'];
    expect(total).toBe(1000);
  });

  it('scopes salary to elapsed months only (no salary for future months)', () => {
    const now = new Date('2026-06-15T10:00:00Z'); // mid-June 2026
    // Current year: salary applies Jan–Jun, not Jul–Dec.
    expect(monthHasOccurred(2026, 5, now)).toBe(true);  // June
    expect(monthHasOccurred(2026, 6, now)).toBe(false); // July (future)
    expect(monthHasOccurred(2025, 11, now)).toBe(true); // past year
    expect(monthHasOccurred(2027, 0, now)).toBe(false); // future year

    expect(monthsElapsedInYear(2026, now)).toBe(6); // Jan–Jun
    expect(monthsElapsedInYear(2025, now)).toBe(12);
    expect(monthsElapsedInYear(2027, now)).toBe(0);

    const byMonth = buildExpensesByMonth([], 2026, 1000, MONTH_LABELS_SQ, now);
    expect(byMonth[5].value).toBe(1000); // June — salary counted
    expect(byMonth[6].value).toBe(0);    // July — future, no salary
  });

  it('sums expenses within a date range with currency normalization', () => {
    const expenses: Expense[] = [
      mkExpense({ id: 'e1', amount: 100, currency: 'ALL', date: new Date('2026-03-10T10:00:00Z') }),
      mkExpense({ id: 'e2', amount: 200, currency: 'ALL', date: new Date('2026-05-10T10:00:00Z') }),
      mkExpense({ id: 'e3', amount: 999, currency: 'ALL', date: new Date('2025-12-31T10:00:00Z') }),
    ];
    const total = calculateExpensesBetween(
      expenses,
      new Date('2026-01-01T00:00:00Z'),
      new Date('2026-12-31T23:59:59Z'),
    );
    expect(total).toBe(300); // only the two 2026 expenses
  });

  it('attributes collected amounts to the payment period only', () => {
    const start = new Date('2026-01-01T00:00:00Z');
    const end = new Date('2026-12-31T23:59:59Z');
    // Paid in 2025 → 0 collected in 2026.
    const paid2025 = mkInvoice({ status: 'Paid', total: 1000, currency: 'ALL', paidAt: new Date('2025-12-20T10:00:00Z') });
    expect(getInvoiceCollectedBetween(paid2025, start, end)).toBe(0);
    // Paid in 2026 → full.
    const paid2026 = mkInvoice({ status: 'Paid', total: 1000, currency: 'ALL', paidAt: new Date('2026-03-01T10:00:00Z') });
    expect(getInvoiceCollectedBetween(paid2026, start, end)).toBe(1000);
    // Partial: only the 2026 payment counts.
    const partial = mkInvoice({
      status: 'Partial', total: 2000, currency: 'ALL',
      partialPayments: [
        { amount: 300, paidAt: new Date('2025-11-01T10:00:00Z') },
        { amount: 500, paidAt: new Date('2026-02-01T10:00:00Z') },
      ],
    });
    expect(getInvoiceCollectedBetween(partial, start, end)).toBe(500);
  });

  it('calculates accrual revenue in a date range', () => {
    const invoices: Invoice[] = [
      mkInvoice({
        id: 'in-range',
        status: 'Pending',
        total: 500,
        currency: 'ALL',
        invoiceDate: new Date('2026-04-10T10:00:00Z'),
      }),
      mkInvoice({
        id: 'out-of-range',
        status: 'Pending',
        total: 999,
        currency: 'ALL',
        invoiceDate: new Date('2026-07-01T10:00:00Z'),
      }),
      mkInvoice({
        id: 'draft-ignored',
        status: 'Draft',
        total: 999,
        currency: 'ALL',
        invoiceDate: new Date('2026-04-10T10:00:00Z'),
      }),
    ];
    const total = calculateAccrualRevenueBetween(
      invoices,
      new Date('2026-04-01T00:00:00Z'),
      new Date('2026-04-30T23:59:59Z'),
    );
    expect(total).toBe(500);
  });
});
