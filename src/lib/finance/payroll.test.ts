import { describe, expect, it } from 'vitest';
import type { Expense, TeamMember } from '../../types';
import {
  payrollBetween,
  payrollForMonth,
  payrollMonths,
  recordedPayrollBetween,
} from './payroll';

const mkMember = (m: Partial<TeamMember>): TeamMember => ({
  id: 'm1', teamId: 't1', userId: 'u1', role: 'Member', status: 'Active',
  createdAt: new Date(2020, 0, 1), updatedAt: new Date(2020, 0, 1), createdByUserId: null,
  ...m,
} as TeamMember);

const mkExpense = (e: Partial<Expense>): Expense => ({
  id: 'e1', title: 'x', amount: 0, category: 'Salary', ...e,
} as Expense);

const start = (y: number, m: number) => new Date(y, m, 1, 0, 0, 0, 0);
const end = (y: number, m: number) => new Date(y, m + 1, 0, 23, 59, 59, 999);

describe('recordedPayrollBetween', () => {
  it('sums only countable Salary rows inside the window, normalised to ALL', () => {
    const rows = [
      mkExpense({ amount: 50_000, date: new Date(2026, 6, 10) }),
      mkExpense({ amount: 300, currency: 'EUR', date: new Date(2026, 6, 11) }),   // 30 000 ALL
      mkExpense({ amount: 99_000, date: new Date(2026, 6, 12), approvalStatus: 'Rejected' }),
      mkExpense({ amount: 99_000, date: new Date(2026, 7, 1) }),                  // next month
      mkExpense({ amount: 99_000, category: 'Rent', date: new Date(2026, 6, 12) }),
    ];
    const r = recordedPayrollBetween(rows, start(2026, 6), end(2026, 6));
    expect(r.amount).toBe(80_000);
    expect(r.count).toBe(2);
  });

  it('falls back to createdAt when the row has no explicit date', () => {
    const rows = [mkExpense({ amount: 40_000, createdAt: new Date(2026, 6, 5) as any })];
    expect(recordedPayrollBetween(rows, start(2026, 6), end(2026, 6)).amount).toBe(40_000);
  });
});

describe('payrollForMonth', () => {
  const members = [
    mkMember({ id: 'a', userId: 'a', monthlySalary: 100_000 }),
    mkMember({ id: 'b', userId: 'b', monthlySalary: 70_000 }),
  ];

  it('a month WITH recorded payments is costed from those rows', () => {
    const rows = [
      mkExpense({ amount: 100_000, date: new Date(2026, 6, 30) }),
      mkExpense({ amount: 62_000, date: new Date(2026, 6, 30) }),
    ];
    const p = payrollForMonth(members, rows, start(2026, 6), end(2026, 6));
    expect(p.basis).toBe('recorded');
    expect(p.total).toBe(162_000);
    expect(p.profile).toBe(170_000); // reported, but not charged
  });

  it('a month with NO recorded payments falls back to the plan', () => {
    const p = payrollForMonth(members, [], start(2026, 3), end(2026, 3));
    expect(p.basis).toBe('profile');
    expect(p.total).toBe(170_000);
    expect(p.recorded).toBe(0);
  });

  it('reports basis "none" when there is no plan and no payment', () => {
    const p = payrollForMonth([], [], start(2026, 3), end(2026, 3));
    expect(p.basis).toBe('none');
    expect(p.total).toBe(0);
  });

  it('includes payments to people who are not team members at all', () => {
    // The freelancer/model case: no matching member, so the plan can never
    // account for it. Before this module the money was on no Financat line.
    const rows = [mkExpense({ amount: 5_000, title: 'Modele Lugina', date: new Date(2026, 7, 30) })];
    const p = payrollForMonth([], rows, start(2026, 7), end(2026, 7));
    expect(p.total).toBe(5_000);
    expect(p.basis).toBe('recorded');
  });

  it('prices the plan off `planAt`, not the (clamped) window end', () => {
    const m = [mkMember({
      monthlySalary: 90_000,
      salaryHistory: [
        { monthlySalary: 50_000, effectiveFrom: new Date(2026, 0, 1) },
        { monthlySalary: 90_000, effectiveFrom: new Date(2026, 6, 20) },
      ],
    })];
    // Month-to-date window ending the 10th, but the month itself ends the 31st.
    const mtd = payrollForMonth(m, [], start(2026, 6), new Date(2026, 6, 10), end(2026, 6));
    expect(mtd.total).toBe(90_000);
  });
});

describe('payrollMonths / payrollBetween', () => {
  const members = [mkMember({ monthlySalary: 100_000 })];

  it('resolves every month independently and flags the fallback', () => {
    const rows = [
      mkExpense({ amount: 80_000, date: new Date(2026, 5, 28) }), // June: recorded
      // July: nothing recorded → plan
      mkExpense({ amount: 95_000, date: new Date(2026, 7, 30) }), // August: recorded
    ];
    const p = payrollBetween(members, rows, start(2026, 5), end(2026, 7));
    expect(p.months.map(m => m.basis)).toEqual(['recorded', 'profile', 'recorded']);
    expect(p.total).toBe(80_000 + 100_000 + 95_000);
    expect(p.monthsRecorded).toBe(2);
    expect(p.monthsProfile).toBe(1);
    expect(p.hasFallback).toBe(true);
  });

  it('clamps the first and last month to the requested range', () => {
    const rows = [
      mkExpense({ amount: 50_000, date: new Date(2026, 6, 5) }),  // before the range start
      mkExpense({ amount: 30_000, date: new Date(2026, 6, 20) }), // inside
    ];
    const p = payrollBetween(members, rows, new Date(2026, 6, 10), new Date(2026, 6, 25));
    expect(p.recorded).toBe(30_000);
    expect(p.total).toBe(30_000);
  });

  it('charges nobody for months that ended before they were hired', () => {
    const hired = [mkMember({ monthlySalary: 100_000, createdAt: new Date(2026, 2, 19) })];
    const p = payrollBetween(hired, [], start(2026, 0), end(2026, 3));
    // Jan + Feb = 0, March (joined the 19th) + April = charged.
    expect(p.months.map(m => m.total)).toEqual([0, 0, 100_000, 100_000]);
    expect(p.total).toBe(200_000);
  });

  it('returns nothing for an inverted range', () => {
    expect(payrollMonths(members, [], end(2026, 6), start(2026, 6))).toEqual([]);
  });

  it('never double-counts: recorded months contribute rows once', () => {
    const rows = [mkExpense({ amount: 40_000, date: new Date(2026, 6, 15) })];
    const p = payrollBetween(members, rows, start(2026, 6), end(2026, 6));
    expect(p.total).toBe(40_000);
    expect(p.rowCount).toBe(1);
  });
});
