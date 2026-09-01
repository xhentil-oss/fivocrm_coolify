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

/** Amount still outstanding on an invoice (Accounts Receivable contribution), in ALL.
 *
 *  `Cancelled` owes nothing. It was missing from this guard while
 *  `getInvoiceCollectedAll` DID return 0 for it — so a cancelled invoice reported
 *  its full value as money owed, in the AR total, in the aging report, and in the
 *  ">60 ditë" cash alarm, which is where a voided invoice is most misleading:
 *  the older it gets, the louder it shouts. */
export function getInvoiceOutstandingAll(inv: Invoice): number {
  if (inv.status === 'Paid' || inv.status === 'Draft' || inv.status === 'Cancelled') return 0;
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

  // Every recorded instalment is attributed to ITS OWN payment date, whatever the
  // current status. The `Paid` branch used to credit the whole total to `paidAt`
  // and ignore `partialPayments` entirely, so settling an invoice retroactively
  // MOVED cash out of an already-reported month: 50k banked in June + 50k in
  // August reported as 0 for June and 100k for August. Cash-basis figures for a
  // closed month must not change when a later payment lands.
  const instalments = inv.partialPayments?.length
    ? inv.partialPayments.reduce((s, p) => (
        inRange(parseDate(p.paidAt)) ? s + toAll(p.amount ?? 0, inv.currency) : s
      ), 0)
    : 0;

  if (inv.status === 'Paid') {
    const total = getInvoiceTotalAll(inv);
    const recorded = (inv.partialPayments || []).reduce(
      (s, p) => s + toAll(p.amount ?? 0, inv.currency), 0);
    // Whatever the instalments do not account for settled on `paidAt` (a Stripe
    // payment, or an invoice simply marked Paid with no instalment history).
    const remainder = Math.max(0, total - recorded);
    return instalments + (inRange(getInvoicePaidDate(inv)) ? remainder : 0);
  }

  // Pending/Partial/Overdue.
  if (inv.partialPayments?.length) return instalments;
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

/** The one category that is NOT costed from the expense rows themselves —
 *  payroll comes from `salaryHistory`/`monthlySalary`, so counting a
 *  Salary-category row too would double-subtract it. */
export const EXPENSE_CATEGORY_SALARY = 'Salary';

/**
 * A project-DIRECT cost: charged to exactly one project instead of the shared
 * overhead pool.
 *
 * This predicate exists because five readers each had their own copy of it and
 * one of them (ProjectDetailView's budget burn-down) had neither guard — so the
 * project page's "Shpenzime" counted rejected rows and payroll, and disagreed
 * with `project.spent` (written by the `project-spend-rollup` cron) and with
 * `projectPnl.directCost` on the same screen's Financat. Mirrored in
 * `api/cron/run.ts` — keep the two in sync.
 */
export function isProjectDirectExpense(exp: Expense): boolean {
  return expenseIsCountable(exp)
    && !!exp.projectId
    && exp.category !== EXPENSE_CATEGORY_SALARY;
}

/** Total project-direct cost in ALL, optionally narrowed to one project. */
export function sumProjectDirectExpenses(
  expenses: Expense[] | undefined | null,
  projectId?: string,
): number {
  return (expenses ?? []).reduce((s, e) => {
    if (!isProjectDirectExpense(e)) return s;
    if (projectId != null && e.projectId !== projectId) return s;
    return s + toAll(e.amount ?? 0, e.currency);
  }, 0);
}

/**
 * Salary-category expenses recorded in [start, end], in ALL.
 *
 * NOT part of any expense total on purpose (see EXPENSE_CATEGORY_SALARY), but
 * the form offers the category — complete with a staff-member picker — so the
 * rows exist and users reasonably expect to see them somewhere. Returning the
 * figure separately lets the UI say "tracked via payroll, not added here"
 * instead of silently dropping it.
 */
export function calculateSalaryExpensesBetween(
  expenses: Expense[] | undefined,
  start: Date,
  end?: Date,
): number {
  return (expenses ?? []).reduce((s, exp) => {
    if (exp.category !== EXPENSE_CATEGORY_SALARY) return s;
    if (!expenseIsCountable(exp)) return s;
    const d = getExpenseDate(exp);
    if (!d || d < start || (end && d > end)) return s;
    return s + toAll(exp.amount ?? 0, exp.currency);
  }, 0);
}

/** Total expenses (in ALL) with a date within [start, end].
 *  Excludes `category === 'Salary'` — salary is accounted for separately via the
 *  monthlySalary term, so counting it here too would double-subtract it —
 *  and excludes rejected expenses. */
export function calculateExpensesBetween(expenses: Expense[] | undefined, start: Date, end?: Date): number {
  return (expenses ?? []).reduce((s, exp) => {
    if (exp.category === EXPENSE_CATEGORY_SALARY) return s;
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

    // Bucketed by the ISSUE date, like every other series in the finance module.
    // This one read `createdAt`, so one chart carried three different date bases
    // (payment date, creation date, invoice date) and a back-dated invoice landed
    // in the month it was typed rather than the month it belongs to.
    const pendingInvs = invoices.filter(inv => {
      if (inv.status !== 'Pending' && inv.status !== 'Overdue') return false;
      const rd = getInvoiceRecognitionDate(inv);
      if (!rd) return false;
      return rd.getMonth() === i && rd.getFullYear() === year;
    });

    // Cash collected in this month — status-robust via the canonical helper, so a
    // partial payment counts even after the invoice later flips to Overdue/Pending
    // (matches getInvoiceCollectedAll and the InvoicesView "collected" hero).
    const mStart = new Date(year, i, 1, 0, 0, 0, 0);
    const mEnd = new Date(year, i + 1, 0, 23, 59, 59, 999);
    const paid = invoices.reduce((s, inv) => s + getInvoiceCollectedBetween(inv, mStart, mEnd), 0);
    const pending = pendingInvs.reduce((s, inv) => s + toAll(inv.total ?? inv.amount ?? 0, inv.currency), 0);
    return { label, value: paid, paid, pending, count: paidInvs.length };
  });
}

/**
 * Payroll for the month ending at `monthEnd`.
 *
 * Passed in as a callback rather than read directly, because `salaryHistory.ts`
 * imports `parseDate` from this module — importing it back would be a cycle.
 * Callers hand in `(end) => totalSalaryForMonth(teamMembers, end)`.
 */
export type SalaryForMonth = (monthEnd: Date) => number;

/** Resolve payroll for month `i` of `year`: history-aware when a resolver is
 *  given, otherwise the flat figure. Future months cost nothing. */
function monthSalary(
  year: number,
  i: number,
  now: Date,
  flat: number,
  resolver?: SalaryForMonth,
): number {
  if (!monthHasOccurred(year, i, now)) return 0;
  if (!resolver) return flat;
  return resolver(new Date(year, i + 1, 0, 23, 59, 59, 999));
}

/**
 * Expenses per month for `year`, with payroll folded in.
 *
 * Prefer passing `salaryForMonth`: without it every past month of every past
 * year is charged TODAY's payroll, which fabricates history (a member hired
 * last month appears to have been paid all of last year, and a raise rewrites
 * every closed month). `salaryHistory.ts` exists precisely to answer this
 * per-month; the flat parameter is kept only so existing callers still compile.
 */
export function buildExpensesByMonth(
  expenses: Expense[] | undefined,
  year: number,
  totalMonthlySalary = 0,
  monthLabels = MONTH_LABELS_SQ,
  now = new Date(),
  salaryForMonth?: SalaryForMonth,
): ExpenseMonthPoint[] {
  return monthLabels.map((label, i) => {
    const monthExpenseTotal = (expenses ?? [])
      .filter(exp => {
        if (exp.category === EXPENSE_CATEGORY_SALARY) return false; // salary added separately below
        if (!expenseIsCountable(exp)) return false;
        const d = getExpenseDate(exp);
        if (!d) return false;
        return d.getMonth() === i && d.getFullYear() === year;
      })
      .reduce((s, exp) => s + toAll(exp.amount ?? 0, exp.currency), 0);

    return { label, value: monthExpenseTotal + monthSalary(year, i, now, totalMonthlySalary, salaryForMonth) };
  });
}

/** Cash in/out per month. `salaryForMonth` carries the same warning as
 *  `buildExpensesByMonth`: without it, past months are charged today's payroll. */
export function buildCashflowByMonth(
  invoices: Invoice[] | undefined,
  expenses: Expense[] | undefined,
  year: number,
  totalMonthlySalary = 0,
  monthLabels = MONTH_LABELS_SQ,
  now = new Date(),
  salaryForMonth?: SalaryForMonth,
): CashflowMonthPoint[] {
  return monthLabels.map((label, i) => {
    const mStart = new Date(year, i, 1, 0, 0, 0, 0);
    const mEnd = new Date(year, i + 1, 0, 23, 59, 59, 999);
    // One definition of "cash in", shared with buildRevenueByMonth. Inflow used to
    // be computed here from scratch (full total on `paidAt`, instalments only while
    // the status was literally `Partial`), so the cash-flow chart and the revenue
    // chart disagreed about the same month by construction.
    const inflow = (invoices ?? []).reduce(
      (s, inv) => s + getInvoiceCollectedBetween(inv, mStart, mEnd), 0);

    const outflow = (expenses ?? [])
      .filter(exp => {
        if (exp.category === EXPENSE_CATEGORY_SALARY) return false; // salary added once below
        if (!expenseIsCountable(exp)) return false;
        const d = getExpenseDate(exp);
        if (!d) return false;
        return d.getMonth() === i && d.getFullYear() === year;
      })
      .reduce((s, exp) => s + toAll(exp.amount ?? 0, exp.currency), 0)
      + monthSalary(year, i, now, totalMonthlySalary, salaryForMonth);

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

/**
 * Expense rows + a payroll term.
 *
 * CAUTION on units: the expense side is every row given (typically all-time),
 * while `totalMonthlySalary` is ONE month. Pass a payroll figure covering the
 * same span as the rows — `totalSalaryForMonth(...) × months`, or 0 and add
 * payroll yourself. Passing a single month against an all-time expense list
 * understates payroll by a factor of the number of months.
 */
export function calculateTotalExpenses(expenses: Expense[] | undefined, totalMonthlySalary: number): number {
  // Skip Salary-category (counted once via the payroll term) and rejected expenses.
  return (expenses?.reduce((sum, exp) =>
    (exp.category === EXPENSE_CATEGORY_SALARY || !expenseIsCountable(exp)) ? sum : sum + toAll(exp.amount ?? 0, exp.currency), 0) || 0)
    + totalMonthlySalary;
}

/**
 * Cash collected in [start, end], in ALL.
 *
 * Delegates to `getInvoiceCollectedBetween` — it used to re-implement the same
 * question and get two things wrong that the canonical helper had already fixed:
 * it credited a `Paid` invoice's WHOLE total to `paidAt` (so settling in August
 * moved June's instalment into August, mutating a closed month), and it counted
 * instalments only while the status was still `Partial`, dropping them the moment
 * the cron flipped the invoice to `Overdue`.
 */
export function calculateRevenueBetween(invoices: Invoice[] | undefined, start: Date, end?: Date): number {
  if (!invoices) return 0;
  return invoices.reduce((s, inv) => s + getInvoiceCollectedBetween(inv, start, end), 0);
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

    // `value` = recognised (billed) revenue for the month. `paid`/`pending` are a
    // NON-overlapping split of it (collected vs still-outstanding) — previously
    // `paid` was set to `billed`, so an unpaid invoice showed up as BOTH paid AND
    // pending (double counted in the chart/tooltip).
    return { label, value: billed, paid: collected, pending: outstanding, count: monthInvs.length };
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

