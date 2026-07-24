import type { Expense, Invoice } from '../../types';
import { toAll } from '../utils';

export const MONTH_LABELS_SQ = ['Jan', 'Shk', 'Mar', 'Pri', 'Maj', 'Qer', 'Kor', 'Gus', 'Sht', 'Tet', 'Nën', 'Dhj'];

export type RevenueMonthPoint = {
  label: string;
  value: number;
  paid: number;
  pending: number;
  count: number;
};

export type ExpenseMonthPoint = {
  label: string;
  value: number;
};

export type CashflowMonthPoint = {
  label: string;
  inflow: number;
  outflow: number;
  net: number;
};

export function parseDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  // Firestore Timestamp — client SDK exposes toDate(); serialized/admin form has seconds.
  const v = value as any;
  if (typeof v.toDate === 'function') {
    const d = v.toDate();
    return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;
  }
  // Client SDK: { seconds }. Admin SDK Timestamp.toJSON(): { _seconds }.
  const secs = typeof v.seconds === 'number' ? v.seconds
    : (typeof v._seconds === 'number' ? v._seconds : null);
  if (secs != null) {
    const d = new Date(secs * 1000);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(value as string);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function getInvoicePaidDate(inv: Invoice): Date | null {
  // Prefer the explicit payment date. Fall back to createdAt (immutable) rather
  // than updatedAt — using updatedAt would re-bucket revenue to another
  // month/year on any unrelated edit, making financial reports unstable.
  return parseDate(inv.paidAt) || parseDate(inv.createdAt);
}

/**
 * Recognition date for accrual accounting:
 * the date the invoice was ISSUED (i.e. revenue was earned), regardless
 * of payment status. Used for IFRS/GAAP-style revenue recognition.
 */
export function getInvoiceRecognitionDate(inv: Invoice): Date | null {
  return parseDate(inv.invoiceDate) || parseDate(inv.createdAt);
}

/** Gross billed amount on an invoice (in ALL). */
export function getInvoiceTotalAll(inv: Invoice): number {
  return toAll(inv.total ?? inv.amount ?? 0, inv.currency);
}

/** Amount already received against an invoice, in ALL. Status-robust: a
 *  partially-paid invoice that later flips to Overdue must still credit the
 *  amount already banked (the cron transitions Partial → Overdue when late). */
export function getInvoiceCollectedAll(inv: Invoice): number {
  if (inv.status === 'Draft' || inv.status === 'Cancelled') return 0;
  if (inv.status === 'Paid') return getInvoiceTotalAll(inv);
  // Pending/Partial/Overdue: credit any recorded partial payments.
  if (inv.partialPayments?.length) {
    return inv.partialPayments.reduce((s, p) => s + toAll(p.amount ?? 0, inv.currency), 0);
  }
  return toAll(inv.paidAmount ?? 0, inv.currency);
}

/** Amount still outstanding on an invoice (Accounts Receivable contribution), in ALL. */
export function getInvoiceOutstandingAll(inv: Invoice): number {
  if (inv.status === 'Paid' || inv.status === 'Draft') return 0;
  return Math.max(0, getInvoiceTotalAll(inv) - getInvoiceCollectedAll(inv));
}

export function getExpenseDate(exp: Expense): Date | null {
  return parseDate(exp.date) || parseDate(exp.createdAt);
}

/** Amount collected on an invoice with payment date within [start, end], in ALL.
 *  Used for period-accurate cash-basis attribution (e.g. per staff member). */
export function getInvoiceCollectedBetween(inv: Invoice, start: Date, end?: Date): number {
  const inRange = (d: Date | null) => !!d && d >= start && (!end || d <= end);
  if (inv.status === 'Draft' || inv.status === 'Cancelled') return 0;
  if (inv.status === 'Paid') {
    return inRange(getInvoicePaidDate(inv)) ? getInvoiceTotalAll(inv) : 0;
  }
  // Partial/Overdue (and any Pending with recorded payments): attribute each
  // recorded partial to its own payment date.
  if (inv.partialPayments?.length) {
    return inv.partialPayments.reduce((s, p) => {
      return inRange(parseDate(p.paidAt)) ? s + toAll(p.amount ?? 0, inv.currency) : s;
    }, 0);
  }
  return inRange(getInvoicePaidDate(inv)) ? toAll(inv.paidAmount ?? 0, inv.currency) : 0;
}

/** Billed (full invoice) amount if recognized within [start, end], in ALL (accrual). */
export function getInvoiceBilledBetween(inv: Invoice, start: Date, end?: Date): number {
  if (!ACCRUAL_REVENUE_STATUSES.includes(inv.status)) return 0;
  const rd = getInvoiceRecognitionDate(inv);
  if (!rd || rd < start || (end && rd > end)) return 0;
  return getInvoiceTotalAll(inv);
}

/** Has month `i` (0-based) of `year` already occurred relative to `now`? */
export function monthHasOccurred(year: number, i: number, now = new Date()): boolean {
  if (year < now.getFullYear()) return true;
  if (year > now.getFullYear()) return false;
  return i <= now.getMonth();
}

/** Number of months of `year` that have elapsed (12 for past years, 0 for future). */
export function monthsElapsedInYear(year: number, now = new Date()): number {
  if (year < now.getFullYear()) return 12;
  if (year > now.getFullYear()) return 0;
  return now.getMonth() + 1;
}

/** An expense hits the books unless it was explicitly rejected in the approval
 *  workflow. (Submitted/Approved/undefined all count.) */
export function expenseIsCountable(exp: Expense): boolean {
  return (exp as any).approvalStatus !== 'Rejected';
}

/** Total expenses (in ALL) with a date within [start, end].
 *  Excludes `category === 'Salary'` — salary is accounted for separately via the
 *  monthlySalary term, so counting it here too would double-subtract it —
 *  and excludes rejected expenses. */
export function calculateExpensesBetween(expenses: Expense[] | undefined, start: Date, end?: Date): number {
  return (expenses ?? []).reduce((s, exp) => {
    if (exp.category === 'Salary') return s;
    if (!expenseIsCountable(exp)) return s;
    const d = getExpenseDate(exp);
    if (!d) return s;
    if (d < start) return s;
    if (end && d > end) return s;
    return s + toAll(exp.amount ?? 0, exp.currency);
  }, 0);
}

export function getFinancialAvailableYears(invoices?: Invoice[], expenses?: Expense[], now = new Date()): number[] {
  const years = new Set<number>([now.getFullYear()]);

  (invoices ?? []).forEach(inv => {
    const paidDate = getInvoicePaidDate(inv);
    if (paidDate) years.add(paidDate.getFullYear());
    (inv.partialPayments ?? []).forEach(p => {
      const pd = parseDate(p.paidAt);
      if (pd) years.add(pd.getFullYear());
    });
  });

  (expenses ?? []).forEach(exp => {
    const d = getExpenseDate(exp);
    if (d) years.add(d.getFullYear());
  });

  return Array.from(years).sort((a, b) => b - a).slice(0, 8);
}

export function buildRevenueByMonth(invoices: Invoice[] | undefined, year: number, monthLabels = MONTH_LABELS_SQ): RevenueMonthPoint[] {
  if (!invoices) {
    return monthLabels.map(label => ({ label, value: 0, paid: 0, pending: 0, count: 0 }));
  }

  return monthLabels.map((label, i) => {
    const paidInvs = invoices.filter(inv => {
      if (inv.status !== 'Paid') return false;
      const pd = getInvoicePaidDate(inv);
      if (!pd) return false;
      return pd.getMonth() === i && pd.getFullYear() === year;
    });

    const pendingInvs = invoices.filter(inv => {
      if (inv.status !== 'Pending' && inv.status !== 'Overdue') return false;
      const cd = parseDate(inv.createdAt);
      if (!cd) return false;
      return cd.getMonth() === i && cd.getFullYear() === year;
    });

    const partialForMonth = invoices
      .filter(inv => inv.status === 'Partial')
      .reduce((s, inv) => {
        // Prefer individual payment records (time-accurate)
        if (inv.partialPayments?.length) {
          const monthPartials = inv.partialPayments.filter(p => {
            const pd = parseDate(p.paidAt);
            if (!pd) return false;
            return pd.getMonth() === i && pd.getFullYear() === year;
          });
          return s + monthPartials.reduce((ms, p) => ms + toAll(p.amount, inv.currency), 0);
        }
        // Fallback: no payment records, but paidAmount is set — assign to updatedAt/createdAt month
        if (inv.paidAmount && inv.paidAmount > 0) {
          const pd = getInvoicePaidDate(inv);
          if (pd && pd.getMonth() === i && pd.getFullYear() === year) {
            return s + toAll(inv.paidAmount, inv.currency);
          }
        }
        return s;
      }, 0);

    const paid = paidInvs.reduce((s, inv) => s + toAll(inv.total ?? inv.amount ?? 0, inv.currency), 0) + partialForMonth;
    const pending = pendingInvs.reduce((s, inv) => s + toAll(inv.total ?? inv.amount ?? 0, inv.currency), 0);
    return { label, value: paid, paid, pending, count: paidInvs.length };
  });
}

export function buildExpensesByMonth(expenses: Expense[] | undefined, year: number, totalMonthlySalary = 0, monthLabels = MONTH_LABELS_SQ, now = new Date()): ExpenseMonthPoint[] {
  return monthLabels.map((label, i) => {
    const monthExpenseTotal = (expenses ?? [])
      .filter(exp => {
        if (exp.category === 'Salary') return false; // salary added separately below
        if (!expenseIsCountable(exp)) return false;
        const d = getExpenseDate(exp);
        if (!d) return false;
        return d.getMonth() === i && d.getFullYear() === year;
      })
      .reduce((s, exp) => s + toAll(exp.amount ?? 0, exp.currency), 0);

    // Salary only applies to months that have actually occurred (no salary
    // cost for future months of the current year, or any month of a future year).
    const salary = monthHasOccurred(year, i, now) ? totalMonthlySalary : 0;
    return { label, value: monthExpenseTotal + salary };
  });
}

export function buildCashflowByMonth(
  invoices: Invoice[] | undefined,
  expenses: Expense[] | undefined,
  year: number,
  totalMonthlySalary = 0,
  monthLabels = MONTH_LABELS_SQ,
  now = new Date(),
): CashflowMonthPoint[] {
  return monthLabels.map((label, i) => {
    const partialInflow = (invoices ?? [])
      .filter(inv => inv.status === 'Partial')
      .reduce((s, inv) => {
        if (inv.partialPayments?.length) {
          const monthPartials = inv.partialPayments.filter(p => {
            const pd = parseDate(p.paidAt);
            if (!pd) return false;
            return pd.getMonth() === i && pd.getFullYear() === year;
          });
          return s + monthPartials.reduce((ms, p) => ms + toAll(p.amount, inv.currency), 0);
        }
        if (inv.paidAmount && inv.paidAmount > 0) {
          const pd = getInvoicePaidDate(inv);
          if (pd && pd.getMonth() === i && pd.getFullYear() === year) {
            return s + toAll(inv.paidAmount, inv.currency);
          }
        }
        return s;
      }, 0);

    const inflow = (invoices ?? [])
      .filter(inv => {
        if (inv.status !== 'Paid') return false;
        const pd = getInvoicePaidDate(inv);
        if (!pd) return false;
        return pd.getMonth() === i && pd.getFullYear() === year;
      })
      .reduce((s, inv) => s + toAll(inv.total ?? inv.amount ?? 0, inv.currency), 0)
      + partialInflow;

    const outflow = (expenses ?? [])
      .filter(exp => {
        if (exp.category === 'Salary') return false; // salary added once via totalMonthlySalary below
        if (!expenseIsCountable(exp)) return false;
        const d = getExpenseDate(exp);
        if (!d) return false;
        return d.getMonth() === i && d.getFullYear() === year;
      })
      .reduce((s, exp) => s + toAll(exp.amount ?? 0, exp.currency), 0)
      + (monthHasOccurred(year, i, now) ? totalMonthlySalary : 0);

    return { label, inflow, outflow, net: inflow - outflow };
  });
}

export function calculateCollectedRevenue(invoices?: Invoice[]): number {
  // Use the canonical helper so this matches per-invoice math everywhere
  // (partialPayments sum is preferred over the cached paidAmount field).
  return invoices?.reduce((sum, inv) => sum + getInvoiceCollectedAll(inv), 0) || 0;
}

export function calculateProjectedRevenue(invoices?: Invoice[]): number {
  return invoices?.reduce((sum, inv) => {
    // Drafts are not yet revenue — they haven't been issued to a customer.
    if (inv.status === 'Pending' || inv.status === 'Overdue') {
      return sum + getInvoiceOutstandingAll(inv);
    }
    if (inv.status === 'Partial') return sum + getInvoiceOutstandingAll(inv);
    return sum;
  }, 0) || 0;
}

export function calculateTotalExpenses(expenses: Expense[] | undefined, totalMonthlySalary: number): number {
  // Skip Salary-category (counted once via totalMonthlySalary) and rejected expenses.
  return (expenses?.reduce((sum, exp) =>
    (exp.category === 'Salary' || !expenseIsCountable(exp)) ? sum : sum + toAll(exp.amount ?? 0, exp.currency), 0) || 0)
    + totalMonthlySalary;
}

export function calculateRevenueBetween(invoices: Invoice[] | undefined, start: Date, end?: Date): number {
  if (!invoices) return 0;

  const paidTotal = invoices
    .filter(inv => {
      if (inv.status !== 'Paid') return false;
      const d = getInvoicePaidDate(inv);
      if (!d) return false;
      return end ? d >= start && d <= end : d >= start;
    })
    .reduce((s, inv) => s + toAll(inv.total ?? inv.amount ?? 0, inv.currency), 0);

  const partialTotal = invoices
    .filter(inv => inv.status === 'Partial' && inv.partialPayments?.length)
    .reduce((s, inv) => {
      const monthPartials = (inv.partialPayments ?? []).filter(p => {
        const pd = parseDate(p.paidAt);
        if (!pd) return false;
        return end ? pd >= start && pd <= end : pd >= start;
      });
      return s + monthPartials.reduce((ms, p) => ms + toAll(p.amount, inv.currency), 0);
    }, 0);

  return paidTotal + partialTotal;
}

// ─────────────────────────────────────────────────────────────────────────────
// ACCRUAL ACCOUNTING (IFRS / US GAAP style)
// Revenue is recognized on the INVOICE DATE — regardless of when payment lands.
// This is the standard for businesses with proper bookkeeping, VAT reporting,
// and investor-facing P&L statements.
// ─────────────────────────────────────────────────────────────────────────────

/** Statuses that count as recognized revenue under accrual accounting. */
const ACCRUAL_REVENUE_STATUSES: ReadonlyArray<Invoice['status']> = ['Paid', 'Pending', 'Overdue', 'Partial'];

/**
 * Accrual revenue by month: every issued (non-Draft, non-Cancelled) invoice
 * is attributed to the month of its `invoiceDate`, at its FULL value.
 * Use this for P&L / "shitje" / "of the books" reporting.
 */
export function buildRevenueByMonthAccrual(invoices: Invoice[] | undefined, year: number, monthLabels = MONTH_LABELS_SQ): RevenueMonthPoint[] {
  if (!invoices) {
    return monthLabels.map(label => ({ label, value: 0, paid: 0, pending: 0, count: 0 }));
  }

  return monthLabels.map((label, i) => {
    const monthInvs = invoices.filter(inv => {
      if (!ACCRUAL_REVENUE_STATUSES.includes(inv.status)) return false;
      const rd = getInvoiceRecognitionDate(inv);
      if (!rd) return false;
      return rd.getMonth() === i && rd.getFullYear() === year;
    });

    const billed = monthInvs.reduce((s, inv) => s + getInvoiceTotalAll(inv), 0);
    const collected = monthInvs.reduce((s, inv) => s + getInvoiceCollectedAll(inv), 0);
    const outstanding = Math.max(0, billed - collected);

    return { label, value: billed, paid: billed, pending: outstanding, count: monthInvs.length };
  });
}

/**
 * Cash inflow by month: pure payment-receipt timing.
 * Identical semantics to the existing `buildRevenueByMonth` cash basis.
 * Use this for cash-flow reporting (paratë reale të hyra).
 */
export function buildCashInflowByMonth(invoices: Invoice[] | undefined, year: number, monthLabels = MONTH_LABELS_SQ): RevenueMonthPoint[] {
  return buildRevenueByMonth(invoices, year, monthLabels);
}

/** Total Accounts Receivable (still owed by customers) in ALL. */
export function calculateAccountsReceivable(invoices?: Invoice[]): number {
  return invoices?.reduce((s, inv) => s + getInvoiceOutstandingAll(inv), 0) || 0;
}

/**
 * Accounts Receivable aged into the month each invoice was issued.
 * Useful for visualising "old debts" — bars stay tall in months where
 * customers still owe us money.
 */
export function buildReceivablesByMonth(invoices: Invoice[] | undefined, year: number, monthLabels = MONTH_LABELS_SQ): ExpenseMonthPoint[] {
  if (!invoices) return monthLabels.map(label => ({ label, value: 0 }));

  return monthLabels.map((label, i) => {
    const monthOutstanding = invoices.reduce((s, inv) => {
      const outstanding = getInvoiceOutstandingAll(inv);
      if (outstanding <= 0) return s;
      const rd = getInvoiceRecognitionDate(inv);
      if (!rd) return s;
      if (rd.getMonth() !== i || rd.getFullYear() !== year) return s;
      return s + outstanding;
    }, 0);
    return { label, value: monthOutstanding };
  });
}

/** Standard AR aging buckets (in days). */
export type ARAgingBucket = '0-30' | '31-60' | '61-90' | '90+';
export type ARAgingSummary = Record<ARAgingBucket, number>;

/**
 * Classic accounts-receivable aging report:
 * how much is owed, bucketed by how overdue the invoice is from `asOf`.
 */
export function buildARAging(invoices: Invoice[] | undefined, asOf: Date = new Date()): ARAgingSummary {
  const buckets: ARAgingSummary = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
  if (!invoices) return buckets;

  for (const inv of invoices) {
    const outstanding = getInvoiceOutstandingAll(inv);
    if (outstanding <= 0) continue;
    const refDate = parseDate(inv.dueDate) || getInvoiceRecognitionDate(inv);
    if (!refDate) continue;
    const ageDays = Math.floor((asOf.getTime() - refDate.getTime()) / 86_400_000);
    if (ageDays <= 30) buckets['0-30'] += outstanding;
    else if (ageDays <= 60) buckets['31-60'] += outstanding;
    else if (ageDays <= 90) buckets['61-90'] += outstanding;
    else buckets['90+'] += outstanding;
  }
  return buckets;
}

/** Accrual revenue between two dates (IFRS/GAAP-style). */
export function calculateAccrualRevenueBetween(invoices: Invoice[] | undefined, start: Date, end?: Date): number {
  if (!invoices) return 0;
  return invoices
    .filter(inv => {
      if (!ACCRUAL_REVENUE_STATUSES.includes(inv.status)) return false;
      const rd = getInvoiceRecognitionDate(inv);
      if (!rd) return false;
      return end ? rd >= start && rd <= end : rd >= start;
    })
    .reduce((s, inv) => s + getInvoiceTotalAll(inv), 0);
}

/** Accounting basis selector for hybrid views. */
export type AccountingBasis = 'accrual' | 'cash';

/** Convenience: build revenue by month with either basis. */
export function buildRevenueByMonthByBasis(
  basis: AccountingBasis,
  invoices: Invoice[] | undefined,
  year: number,
  monthLabels = MONTH_LABELS_SQ,
): RevenueMonthPoint[] {
  return basis === 'accrual'
    ? buildRevenueByMonthAccrual(invoices, year, monthLabels)
    : buildRevenueByMonth(invoices, year, monthLabels);
}

