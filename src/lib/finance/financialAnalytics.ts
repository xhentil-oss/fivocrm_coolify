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
  const d = value instanceof Date ? value : new Date(value as string);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function getInvoicePaidDate(inv: Invoice): Date | null {
  return parseDate(inv.paidAt) || parseDate(inv.updatedAt) || parseDate(inv.createdAt);
}

export function getExpenseDate(exp: Expense): Date | null {
  return parseDate(exp.date) || parseDate(exp.createdAt);
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

export function buildExpensesByMonth(expenses: Expense[] | undefined, year: number, totalMonthlySalary = 0, monthLabels = MONTH_LABELS_SQ): ExpenseMonthPoint[] {
  return monthLabels.map((label, i) => {
    const monthExpenseTotal = (expenses ?? [])
      .filter(exp => {
        const d = getExpenseDate(exp);
        if (!d) return false;
        return d.getMonth() === i && d.getFullYear() === year;
      })
      .reduce((s, exp) => s + toAll(exp.amount ?? 0, exp.currency), 0);

    return { label, value: monthExpenseTotal + totalMonthlySalary };
  });
}

export function buildCashflowByMonth(
  invoices: Invoice[] | undefined,
  expenses: Expense[] | undefined,
  year: number,
  totalMonthlySalary = 0,
  monthLabels = MONTH_LABELS_SQ,
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
        const d = getExpenseDate(exp);
        if (!d) return false;
        return d.getMonth() === i && d.getFullYear() === year;
      })
      .reduce((s, exp) => s + toAll(exp.amount ?? 0, exp.currency), 0)
      + totalMonthlySalary;

    return { label, inflow, outflow, net: inflow - outflow };
  });
}

export function calculateCollectedRevenue(invoices?: Invoice[]): number {
  return invoices?.reduce((sum, inv) => {
    if (inv.status === 'Paid') return sum + toAll(inv.total ?? inv.amount ?? 0, inv.currency);
    if (inv.status === 'Partial') return sum + toAll(inv.paidAmount ?? 0, inv.currency);
    return sum;
  }, 0) || 0;
}

export function calculateProjectedRevenue(invoices?: Invoice[]): number {
  return invoices?.reduce((sum, inv) => {
    if (inv.status === 'Pending' || inv.status === 'Draft') return sum + toAll(inv.total ?? inv.amount ?? 0, inv.currency);
    if (inv.status === 'Partial') return sum + Math.max(0, toAll(inv.total ?? inv.amount ?? 0, inv.currency) - toAll(inv.paidAmount ?? 0, inv.currency));
    return sum;
  }, 0) || 0;
}

export function calculateTotalExpenses(expenses: Expense[] | undefined, totalMonthlySalary: number): number {
  return (expenses?.reduce((sum, exp) => sum + toAll(exp.amount ?? 0, exp.currency), 0) || 0) + totalMonthlySalary;
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
