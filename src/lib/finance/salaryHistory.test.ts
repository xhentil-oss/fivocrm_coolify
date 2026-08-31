import { describe, expect, it } from 'vitest';
import type { TeamMember } from '../../types';
import { memberSalaryForMonth, totalSalaryForMonth, appendSalaryChange } from './salaryHistory';

function mkMember(m: Partial<TeamMember>): TeamMember {
  return {
    id: m.id || 'm1', teamId: 't1', userId: m.userId || 'u1',
    role: m.role || 'Member', status: m.status || 'Active',
    monthlySalary: m.monthlySalary, salaryHistory: m.salaryHistory,
    ...m,
  } as TeamMember;
}

const end = (y: number, mIdx: number) => new Date(y, mIdx + 1, 0, 23, 59, 59, 999);

describe('memberSalaryForMonth', () => {
  it('falls back to current salary for active members without history', () => {
    const m = mkMember({ monthlySalary: 50_000 });
    expect(memberSalaryForMonth(m, end(2026, 0))).toBe(50_000);
  });

  it('charges nothing for a month that ended before the member existed', () => {
    // Without this the fallback billed today's salary back to the beginning of
    // time: a 2026 year-to-date P&L charged 8 months of payroll to a team whose
    // first member record was created on 19 March.
    const m = mkMember({ monthlySalary: 50_000, createdAt: new Date(2026, 2, 19) });
    expect(memberSalaryForMonth(m, end(2026, 0))).toBe(0);      // January
    expect(memberSalaryForMonth(m, end(2026, 1))).toBe(0);      // February
    expect(memberSalaryForMonth(m, end(2026, 2))).toBe(50_000); // joined mid-March
    expect(memberSalaryForMonth(m, end(2026, 3))).toBe(50_000);
  });

  it('prefers an explicit hiredAt over createdAt', () => {
    // Someone employed before the app was adopted.
    const m = mkMember({
      monthlySalary: 50_000,
      createdAt: new Date(2026, 2, 19),
      hiredAt: new Date(2025, 0, 1),
    });
    expect(memberSalaryForMonth(m, end(2026, 0))).toBe(50_000);
  });

  it('returns 0 for inactive members without history', () => {
    const m = mkMember({ monthlySalary: 50_000, status: 'Inactive' });
    expect(memberSalaryForMonth(m, end(2026, 0))).toBe(0);
  });

  it('uses the salary in effect for each month', () => {
    const m = mkMember({
      monthlySalary: 80_000,
      salaryHistory: [
        { monthlySalary: 50_000, effectiveFrom: new Date('2026-01-01') },
        { monthlySalary: 80_000, effectiveFrom: new Date('2026-06-01') },
      ],
    });
    expect(memberSalaryForMonth(m, end(2026, 2))).toBe(50_000); // March → old
    expect(memberSalaryForMonth(m, end(2026, 6))).toBe(80_000); // July → new
    expect(memberSalaryForMonth(m, end(2026, 5))).toBe(80_000); // June → new (effective 1 Jun)
  });

  it('returns 0 for inactive members even when they have history', () => {
    const m = mkMember({
      status: 'Inactive',
      monthlySalary: 60_000,
      salaryHistory: [{ monthlySalary: 60_000, effectiveFrom: new Date('2026-01-01') }],
    });
    expect(memberSalaryForMonth(m, end(2026, 5))).toBe(0);
  });

  it('parses Firestore Timestamp-like effectiveFrom (toDate / seconds)', () => {
    const asTs = (iso: string) => ({ toDate: () => new Date(iso), seconds: Math.floor(new Date(iso).getTime() / 1000) });
    const m = mkMember({
      monthlySalary: 80_000,
      salaryHistory: [
        { monthlySalary: 50_000, effectiveFrom: asTs('2026-01-01') as any },
        { monthlySalary: 80_000, effectiveFrom: asTs('2026-06-01') as any },
      ],
    });
    expect(memberSalaryForMonth(m, end(2026, 2))).toBe(50_000);
    expect(memberSalaryForMonth(m, end(2026, 6))).toBe(80_000);
  });

  it('returns 0 for months before the earliest history entry (not yet hired)', () => {
    const m = mkMember({
      monthlySalary: 60_000,
      salaryHistory: [{ monthlySalary: 60_000, effectiveFrom: new Date('2026-04-01') }],
    });
    expect(memberSalaryForMonth(m, end(2026, 0))).toBe(0);      // Jan → before hire
    expect(memberSalaryForMonth(m, end(2026, 3))).toBe(60_000); // Apr → hired
  });
});

describe('totalSalaryForMonth', () => {
  it('sums per-member salaries for the given month', () => {
    const members = [
      mkMember({ id: 'a', monthlySalary: 50_000 }),
      mkMember({ id: 'b', monthlySalary: 30_000, status: 'Inactive' }), // excluded (no history)
      mkMember({
        id: 'c', monthlySalary: 40_000,
        salaryHistory: [{ monthlySalary: 40_000, effectiveFrom: new Date('2026-05-01') }],
      }),
    ];
    expect(totalSalaryForMonth(members, end(2026, 0))).toBe(50_000);           // Jan: a only
    expect(totalSalaryForMonth(members, end(2026, 5))).toBe(50_000 + 40_000);  // Jun: a + c
  });
});

describe('appendSalaryChange', () => {
  it('seeds the old salary as a baseline before the first change', () => {
    const m = mkMember({ monthlySalary: 50_000 });
    const hist = appendSalaryChange(m, 80_000, new Date('2026-06-01'));
    expect(hist).toHaveLength(2);
    expect(hist[0].monthlySalary).toBe(50_000); // baseline
    expect(hist[1].monthlySalary).toBe(80_000); // change
    // A member built this way costs the old salary before June, new after.
    const rebuilt = mkMember({ monthlySalary: 80_000, salaryHistory: hist });
    expect(memberSalaryForMonth(rebuilt, end(2026, 2))).toBe(50_000);
    expect(memberSalaryForMonth(rebuilt, end(2026, 6))).toBe(80_000);
  });

  it('appends to existing history without reseeding', () => {
    const m = mkMember({
      monthlySalary: 80_000,
      salaryHistory: [
        { monthlySalary: 50_000, effectiveFrom: new Date('2026-01-01') },
        { monthlySalary: 80_000, effectiveFrom: new Date('2026-06-01') },
      ],
    });
    const hist = appendSalaryChange(m, 100_000, new Date('2026-09-01'));
    expect(hist).toHaveLength(3);
    expect(hist[2].monthlySalary).toBe(100_000);
  });
});
