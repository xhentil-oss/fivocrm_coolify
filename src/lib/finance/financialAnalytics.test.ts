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
  calculateSalaryExpensesBetween,
  isProjectDirectExpense,
  sumProjectDirectExpenses,
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

describe('overdue invoices keep their partial payments', () => {
  it('credits collected/outstanding for a partially-paid invoice that flipped to Overdue', () => {
    const inv = mkInvoice({
      status: 'Overdue',
      total: 1000,
      paidAmount: 400,
      partialPayments: [{ amount: 400, paidAt: new Date('2026-06-10T12:00:00Z') }],
    });
    expect(getInvoiceOutstandingAll(inv)).toBe(600); // not the full 1000
    const collectedJune = getInvoiceCollectedBetween(inv, new Date('2026-06-01'), new Date('2026-06-30T23:59:59'));
    expect(collectedJune).toBe(400); // the banked 400 is not lost
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

    // Under accrual: value = billed (recognised); paid/pending are a NON-overlapping
    // split of it (collected vs outstanding) — an unpaid invoice is NOT counted as paid.
    expect(apr.value).toBe(1000); // April invoice recognised
    expect(apr.paid).toBe(1000); // fully collected
    expect(apr.pending).toBe(0);
    expect(may.paid).toBe(0); // payment month is irrelevant for accrual
    expect(feb.value).toBe(500);   // Feb invoice recognised (billed) in Feb
    expect(feb.paid).toBe(0);      // nothing collected → NOT shown as paid
    expect(feb.pending).toBe(500); // still outstanding
  });

  it('an Overdue (unpaid) invoice shows as pending only, never as paid (accrual)', () => {
    const invoices: Invoice[] = [
      mkInvoice({ id: 'ovd', status: 'Overdue', total: 40000, currency: 'ALL', invoiceDate: new Date('2026-08-01T10:00:00Z') }),
    ];
    const aug = buildRevenueByMonthAccrual(invoices, 2026, MONTH_LABELS_SQ)[7];
    expect(aug.value).toBe(40000);   // recognised
    expect(aug.paid).toBe(0);        // NOT counted as paid
    expect(aug.pending).toBe(40000); // shown only as pending
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

  it('keeps an instalment in ITS OWN month after the invoice is fully settled', () => {
    // REGRESSION: the `Paid` branch used to credit the whole total to `paidAt` and
    // ignore partialPayments, so settling in August retroactively emptied June —
    // cash-basis revenue of a closed, already-reported month changed by itself.
    const june = [new Date('2026-06-01T00:00:00Z'), new Date('2026-06-30T23:59:59Z')] as const;
    const august = [new Date('2026-08-01T00:00:00Z'), new Date('2026-08-31T23:59:59Z')] as const;
    const settled = mkInvoice({
      status: 'Paid', total: 100_000, currency: 'ALL',
      paidAt: new Date('2026-08-20T10:00:00Z'),
      partialPayments: [
        { amount: 50_000, paidAt: new Date('2026-06-10T10:00:00Z') },
        { amount: 50_000, paidAt: new Date('2026-08-20T10:00:00Z') },
      ],
    });
    expect(getInvoiceCollectedBetween(settled, june[0], june[1])).toBe(50_000);
    expect(getInvoiceCollectedBetween(settled, august[0], august[1])).toBe(50_000);
    // And the year still totals the invoice exactly once.
    expect(getInvoiceCollectedBetween(settled, new Date('2026-01-01'), new Date('2026-12-31T23:59:59')))
      .toBe(100_000);
  });

  it('credits the un-instalmented remainder on paidAt', () => {
    // Half recorded as cash in June, the rest closed by Stripe in August: the
    // webhook writes paidAmount/status but no partialPayments entry.
    const mixed = mkInvoice({
      status: 'Paid', total: 100_000, currency: 'ALL',
      paidAt: new Date('2026-08-20T10:00:00Z'),
      partialPayments: [{ amount: 40_000, paidAt: new Date('2026-06-10T10:00:00Z') }],
    });
    expect(getInvoiceCollectedBetween(mixed, new Date('2026-06-01'), new Date('2026-06-30T23:59:59')))
      .toBe(40_000);
    expect(getInvoiceCollectedBetween(mixed, new Date('2026-08-01'), new Date('2026-08-31T23:59:59')))
      .toBe(60_000);
  });

  it('never double-counts when instalments already cover the total', () => {
    const exact = mkInvoice({
      status: 'Paid', total: 1000, currency: 'ALL',
      paidAt: new Date('2026-03-01T10:00:00Z'),
      partialPayments: [{ amount: 1000, paidAt: new Date('2026-03-01T10:00:00Z') }],
    });
    expect(getInvoiceCollectedBetween(exact, new Date('2026-01-01'), new Date('2026-12-31T23:59:59')))
      .toBe(1000);
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

// ── Aug 2026 audit: one predicate for "what did this project cost" ─────────
describe('isProjectDirectExpense / sumProjectDirectExpenses', () => {
  const e = (o: any) => ({
    id: o.id, title: o.id, amount: o.amount, currency: o.currency ?? 'ALL',
    category: o.category ?? 'Office', projectId: o.projectId,
    approvalStatus: o.approvalStatus, date: new Date(2026, 6, 1),
  } as any);

  it('needs a project, a non-Salary category and a non-rejected verdict', () => {
    expect(isProjectDirectExpense(e({ id: 'a', amount: 10, projectId: 'P' }))).toBe(true);
    expect(isProjectDirectExpense(e({ id: 'b', amount: 10 }))).toBe(false);                       // no project
    expect(isProjectDirectExpense(e({ id: 'c', amount: 10, projectId: 'P', category: 'Salary' }))).toBe(false);
    expect(isProjectDirectExpense(e({ id: 'd', amount: 10, projectId: 'P', approvalStatus: 'Rejected' }))).toBe(false);
    // Submitted still hits the books — only Rejected does not.
    expect(isProjectDirectExpense(e({ id: 'f', amount: 10, projectId: 'P', approvalStatus: 'Submitted' }))).toBe(true);
  });

  it('sums in ALL and can narrow to one project', () => {
    // The project page used a bare reduce with NEITHER guard, so it disagreed
    // with project.spent (the cron) and with projectPnl.directCost.
    const rows = [
      e({ id: '1', amount: 100, projectId: 'P1' }),
      e({ id: '2', amount: 50, projectId: 'P2' }),
      e({ id: '3', amount: 999, projectId: 'P1', approvalStatus: 'Rejected' }),
      e({ id: '4', amount: 999, projectId: 'P1', category: 'Salary' }),
    ];
    expect(sumProjectDirectExpenses(rows)).toBe(150);
    expect(sumProjectDirectExpenses(rows, 'P1')).toBe(100);
    expect(sumProjectDirectExpenses(undefined)).toBe(0);
  });
});

describe('calculateSalaryExpensesBetween', () => {
  it('reports Salary rows separately — they are in no expense total', () => {
    // The form offers the Salary category with a staff picker, but payroll is
    // costed from salaryHistory, so the rows are excluded everywhere. Returning
    // the figure is what lets the UI say so instead of appearing to lose it.
    const rows = [
      { id: 's1', title: 'Paga', amount: 70_000, currency: 'ALL', category: 'Salary', date: new Date(2026, 6, 5) },
      { id: 's2', title: 'Paga', amount: 30_000, currency: 'ALL', category: 'Salary', date: new Date(2026, 6, 6), approvalStatus: 'Rejected' },
      { id: 'o1', title: 'Qira', amount: 10_000, currency: 'ALL', category: 'Rent', date: new Date(2026, 6, 5) },
    ] as any[];
    const start = new Date(2026, 6, 1);
    const end = new Date(2026, 6, 31, 23, 59, 59);
    expect(calculateSalaryExpensesBetween(rows, start, end)).toBe(70_000);
    expect(calculateExpensesBetween(rows, start, end)).toBe(10_000);   // salary excluded here
  });
});


describe('a cancelled invoice is not a receivable', () => {
  const cancelled = mkInvoice({
    id: 'void', status: 'Cancelled', total: 500_000, currency: 'ALL',
    invoiceDate: new Date('2026-01-10T12:00:00Z'),
    dueDate: new Date('2026-01-20T12:00:00Z'),
  });
  const live = mkInvoice({
    id: 'live', status: 'Overdue', total: 100_000, currency: 'ALL',
    invoiceDate: new Date('2026-01-10T12:00:00Z'),
    dueDate: new Date('2026-01-20T12:00:00Z'),
  });

  it('owes nothing', () => {
    expect(getInvoiceOutstandingAll(cancelled)).toBe(0);
  });

  it('stays out of the AR total', () => {
    expect(calculateAccountsReceivable([cancelled, live])).toBe(100_000);
  });

  it('stays out of the aging report — where a void invoice only gets louder', () => {
    const aging = buildARAging([cancelled, live], new Date('2026-06-01T12:00:00Z'));
    expect(aging['90+']).toBe(100_000);
  });
});

describe('calculateRevenueBetween matches the canonical collected helper', () => {
  const june = new Date('2026-06-01T00:00:00Z');
  const juneEnd = new Date('2026-06-30T23:59:59Z');

  it('keeps a June instalment in June after the invoice settles in August', () => {
    const inv = mkInvoice({
      status: 'Paid', total: 100_000, currency: 'ALL',
      paidAt: new Date('2026-08-05T12:00:00Z'),
      partialPayments: [
        { amount: 50_000, paidAt: new Date('2026-06-10T12:00:00Z') },
        { amount: 50_000, paidAt: new Date('2026-08-05T12:00:00Z') },
      ],
    });
    expect(calculateRevenueBetween([inv], june, juneEnd)).toBe(50_000);
  });

  it('still counts instalments after the cron flips Partial → Overdue', () => {
    const inv = mkInvoice({
      status: 'Overdue', total: 100_000, currency: 'ALL',
      partialPayments: [{ amount: 30_000, paidAt: new Date('2026-06-15T12:00:00Z') }],
    });
    expect(calculateRevenueBetween([inv], june, juneEnd)).toBe(30_000);
  });

  it('agrees with the cash-flow chart for the same month', () => {
    const inv = mkInvoice({
      status: 'Overdue', total: 100_000, currency: 'ALL',
      partialPayments: [{ amount: 30_000, paidAt: new Date('2026-06-15T12:00:00Z') }],
    });
    const cash = buildCashflowByMonth([inv], [], 2026, 0, MONTH_LABELS_SQ, new Date('2026-12-31T12:00:00Z'));
    const revenue = buildRevenueByMonth([inv], 2026);
    expect(cash[5].inflow).toBe(30_000);
    expect(cash[5].inflow).toBe(revenue[5].paid);
  });
});

// ── Sep 2026 audit: an instalment with no date is still money that arrived ──
describe('getInvoiceCollectedBetween dates a legacy instalment by the invoice', () => {
  const june = [new Date('2026-06-01'), new Date('2026-06-30T23:59:59')] as const;
  const march = [new Date('2026-03-01'), new Date('2026-03-31T23:59:59')] as const;

  it('an instalment without paidAt falls back to the invoice paidAt', () => {
    // Dated null, its amount used to be in NO month: present in the all-time
    // collected figure, absent from every period figure.
    const inv = mkInvoice({
      status: 'Partial', total: 1000, currency: 'ALL', paidAmount: 400,
      paidAt: new Date('2026-06-15T10:00:00Z'),
      partialPayments: [{ amount: 400 } as any],
    });
    expect(getInvoiceCollectedBetween(inv, june[0], june[1])).toBe(400);
    expect(getInvoiceCollectedBetween(inv, march[0], march[1])).toBe(0);
  });

  it('…then to createdAt, and a dated instalment keeps its own date', () => {
    const inv = mkInvoice({
      status: 'Paid', total: 1000, currency: 'ALL',
      createdAt: new Date('2026-03-05T10:00:00Z'),
      partialPayments: [{ amount: 300 } as any, { amount: 700, paidAt: new Date('2026-06-10T10:00:00Z') }],
    });
    expect(getInvoiceCollectedBetween(inv, march[0], march[1])).toBe(300);
    expect(getInvoiceCollectedBetween(inv, june[0], june[1])).toBe(700);
    expect(getInvoiceCollectedBetween(inv, new Date('2026-01-01'), new Date('2026-12-31T23:59:59'))).toBe(1000);
  });

  it('a Pending invoice with a cached paidAmount and no paidAt is credited on createdAt (documented)', () => {
    const inv = mkInvoice({ status: 'Pending', total: 1000, currency: 'ALL', paidAmount: 250, createdAt: new Date('2026-03-05T10:00:00Z') });
    expect(getInvoiceCollectedBetween(inv, march[0], march[1])).toBe(250);
    expect(getInvoiceCollectedBetween(inv, june[0], june[1])).toBe(0);
  });
});
