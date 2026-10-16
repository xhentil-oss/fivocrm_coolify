import { describe, expect, it } from 'vitest';
import type { TeamMember } from '../../types';
import {
  memberSalaryForMonth, totalSalaryForMonth, appendSalaryChange, leftAtForStatusChange,
  groupMembersByPerson, personEmployedInMonth, personHourlyCostOverride, personSalaryRowForMonth,
} from './salaryHistory';

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

  // ── Item 2: leaving payroll is an event with a DATE ──────────────────────
  it('keeps the cost of months that ended before leftAt', () => {
    // The bug: flipping someone to Inactive retro-zeroed eight closed months.
    const m = mkMember({
      status: 'Inactive',
      monthlySalary: 60_000,
      createdAt: new Date(2026, 0, 1),
      leftAt: new Date(2026, 5, 30), // left end of June
    } as any);
    expect(memberSalaryForMonth(m, end(2026, 1))).toBe(60_000); // February — closed, still costs
    expect(memberSalaryForMonth(m, end(2026, 4))).toBe(60_000); // May
    expect(memberSalaryForMonth(m, end(2026, 5))).toBe(0);      // June ends on/after leftAt
    expect(memberSalaryForMonth(m, end(2026, 6))).toBe(0);      // July — gone
  });

  it('honours leftAt on top of an effective-dated history', () => {
    const m = mkMember({
      status: 'Inactive',
      monthlySalary: 80_000,
      createdAt: new Date(2026, 0, 1),
      salaryHistory: [
        { monthlySalary: 50_000, effectiveFrom: new Date('2026-01-01') },
        { monthlySalary: 80_000, effectiveFrom: new Date('2026-04-01') },
      ],
      leftAt: new Date(2026, 6, 1),
    } as any);
    expect(memberSalaryForMonth(m, end(2026, 1))).toBe(50_000); // Feb → old rate
    expect(memberSalaryForMonth(m, end(2026, 4))).toBe(80_000); // May → new rate
    expect(memberSalaryForMonth(m, end(2026, 6))).toBe(0);      // Jul → left
  });

  it('falls back to updatedAt when a leaver has no leftAt', () => {
    // No termination date recorded, so the only observable signal is when the
    // row was last written — the moment the status was flipped.
    const m = mkMember({
      status: 'Inactive',
      monthlySalary: 60_000,
      createdAt: new Date(2026, 0, 1),
      updatedAt: new Date(2026, 5, 15), // marked Inactive mid-June
    } as any);
    expect(memberSalaryForMonth(m, end(2026, 3))).toBe(60_000); // April — closed book
    expect(memberSalaryForMonth(m, end(2026, 4))).toBe(60_000); // May — closed book
    expect(memberSalaryForMonth(m, end(2026, 5))).toBe(0);      // June ends after the flip
    expect(memberSalaryForMonth(m, end(2026, 6))).toBe(0);
  });

  it('never charges a Pending member, whatever the dates', () => {
    const m = mkMember({
      status: 'Pending',
      monthlySalary: 60_000,
      createdAt: new Date(2026, 0, 1),
      updatedAt: new Date(2026, 8, 1),
    } as any);
    expect(memberSalaryForMonth(m, end(2026, 3))).toBe(0);
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
      mkMember({ id: 'a', userId: 'ua', monthlySalary: 50_000 }),
      mkMember({ id: 'b', userId: 'ub', monthlySalary: 30_000, status: 'Inactive' }), // excluded (no history)
      mkMember({
        id: 'c', userId: 'uc', monthlySalary: 40_000,
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

  // ── Item 3: clearing (or zeroing) a salary must actually stop the charge ──
  it('records a zero entry so a cleared salary stops costing money', () => {
    const m = mkMember({ monthlySalary: 60_000 });
    const hist = appendSalaryChange(m, 0, new Date(2026, 8, 1, 12));
    const rebuilt = mkMember({ monthlySalary: undefined, salaryHistory: hist });
    expect(memberSalaryForMonth(rebuilt, end(2026, 5))).toBe(60_000); // June — before the change
    expect(memberSalaryForMonth(rebuilt, end(2026, 8))).toBe(0);      // September — cleared
    expect(memberSalaryForMonth(rebuilt, end(2026, 9))).toBe(0);
  });

  it('a zero entry supersedes a non-empty history (the old amount is not sticky)', () => {
    const m = mkMember({
      monthlySalary: 80_000,
      salaryHistory: [
        { monthlySalary: 50_000, effectiveFrom: new Date('2026-01-01') },
        { monthlySalary: 80_000, effectiveFrom: new Date('2026-06-01') },
      ],
    });
    const hist = appendSalaryChange(m, 0, new Date(2026, 8, 1, 12));
    const rebuilt = mkMember({ monthlySalary: undefined, salaryHistory: hist });
    expect(memberSalaryForMonth(rebuilt, end(2026, 7))).toBe(80_000); // August
    expect(memberSalaryForMonth(rebuilt, end(2026, 8))).toBe(0);      // September
  });

  // ── Item 4: the de-dupe day is the BUSINESS day, not the UTC day ─────────
  it('keeps two changes on consecutive local days apart (Europe/Tirane)', () => {
    // Local midnight on 1 September is 31 August 22:00 UTC. Under the old
    // `toISOString().slice(0,10)` de-dupe this collapsed into the 31 August
    // entry and one of the two salary changes was silently lost.
    const aug31 = new Date(Date.UTC(2026, 7, 31, 10, 0, 0));  // 31 Aug 12:00 Tirane
    const sep1 = new Date(Date.UTC(2026, 7, 31, 22, 0, 0));   // 1 Sep 00:00 Tirane
    const hist = appendSalaryChange(
      { monthlySalary: 50_000, salaryHistory: [{ monthlySalary: 60_000, effectiveFrom: aug31 }] },
      70_000,
      sep1,
    );
    expect(hist).toHaveLength(2);
    expect(hist.map(h => h.monthlySalary)).toEqual([60_000, 70_000]);

  });

  it('still collapses two changes made on the same local day', () => {
    const hist = appendSalaryChange(
      {
        monthlySalary: 50_000,
        salaryHistory: [{ monthlySalary: 60_000, effectiveFrom: new Date(Date.UTC(2026, 7, 31, 6, 0, 0)) }],
      },
      70_000,
      new Date(Date.UTC(2026, 7, 31, 10, 0, 0)), // same 31 Aug in Tirane
    );
    expect(hist).toHaveLength(1);
    expect(hist[0].monthlySalary).toBe(70_000);
  });
});

describe('one person, several rows (groupMembersByPerson + per-month resolution)', () => {
  it('groups rows per userId; the profile prefers the Active row and fills empty fields; a row without userId is its own person', () => {
    const rows = [
      mkMember({ id: 'tA', userId: 'u', monthlySalary: 90_000, status: 'Inactive', clientCapacityHours: 90, leftAt: new Date('2026-01-01') } as any),
      mkMember({ id: 'tB', userId: 'u', monthlySalary: 80_000, status: 'Active', displayName: 'Ana' } as any),
      { ...mkMember({ id: 'solo', monthlySalary: 10_000 }), userId: '' } as TeamMember,
    ];
    const out = groupMembersByPerson(rows);
    expect(out).toHaveLength(2);
    const u = out.find(p => p.userId === 'u')!;
    expect(u.rows).toHaveLength(2);
    expect(u.profile.id).toBe('tB');                      // the Active row, not the higher-paid Inactive one
    expect(u.profile.clientCapacityHours).toBe(90);       // filled from the other row
    expect(out.find(p => !p.userId)!.rows[0].monthlySalary).toBe(10_000);
  });
  it('totalSalaryForMonth counts a salary carried on two rows of the same person ONCE', () => {
    const rows = [mkMember({ id: 'a', userId: 'u', monthlySalary: 50_000 }), mkMember({ id: 'b', userId: 'u', monthlySalary: 50_000 })];
    expect(totalSalaryForMonth(rows, end(2026, 5))).toBe(50_000);
  });
  it('(a) an Inactive 80k row (left 1 Mar) next to an Active 60k row hired in March: September costs 60k, January 80k', () => {
    const rows = [
      mkMember({ id: 'A', userId: 'u', monthlySalary: 80_000, status: 'Inactive', leftAt: new Date(2026, 2, 1) } as any),
      mkMember({ id: 'B', userId: 'u', monthlySalary: 60_000, status: 'Active', hiredAt: new Date(2026, 2, 1) } as any),
    ];
    expect(totalSalaryForMonth(rows, end(2026, 8))).toBe(60_000);  // Sept — the merge charged 80k and dropped leftAt
    expect(totalSalaryForMonth(rows, end(2026, 0))).toBe(80_000);  // Jan — still on the old row
    expect(totalSalaryForMonth(rows, end(2026, 1))).toBe(80_000);  // Feb
    const p = groupMembersByPerson(rows)[0];
    expect(personEmployedInMonth(p, end(2026, 8))).toBe(true);
    expect(personSalaryRowForMonth(p, end(2026, 8))!.id).toBe('B');
  });
  it("(b) one row's history does not erase the other row's months: January keeps 50k", () => {
    const rows = [
      mkMember({ id: 'A', userId: 'u', monthlySalary: 50_000, status: 'Active' } as any),
      mkMember({ id: 'B', userId: 'u', monthlySalary: 70_000, status: 'Active',
        salaryHistory: [{ monthlySalary: 70_000, effectiveFrom: new Date(2026, 3, 1) }] } as any),
    ];
    expect(totalSalaryForMonth(rows, end(2026, 0))).toBe(50_000);  // the merge took B's history -> 0
    expect(totalSalaryForMonth(rows, end(2026, 4))).toBe(70_000);  // May: B's history applies, max wins
  });
  it('a person is employed in a month when ANY row is; nobody employed -> not', () => {
    const rows = [
      mkMember({ id: 'A', userId: 'u', monthlySalary: 1, status: 'Inactive', leftAt: new Date(2026, 2, 1) } as any),
      mkMember({ id: 'B', userId: 'u', monthlySalary: 1, status: 'Active', hiredAt: new Date(2026, 5, 1) } as any),
    ];
    const p = groupMembersByPerson(rows)[0];
    expect(personEmployedInMonth(p, end(2026, 1))).toBe(true);   // Feb: row A
    expect(personEmployedInMonth(p, end(2026, 3))).toBe(false);  // Apr: between rows
    expect(personEmployedInMonth(p, end(2026, 6))).toBe(true);   // Jul: row B
  });
  it('the hourlyCostRate override comes from any row, an Active row first', () => {
    const p1 = groupMembersByPerson([
      mkMember({ id: 'A', userId: 'u', monthlySalary: 90_000, status: 'Active' } as any),
      mkMember({ id: 'B', userId: 'u', status: 'Active', hourlyCostRate: 950 } as any),
    ])[0];
    expect(personHourlyCostOverride(p1)).toBe(950);
    const p2 = groupMembersByPerson([
      mkMember({ id: 'A', userId: 'u', status: 'Inactive', hourlyCostRate: 700, leftAt: new Date(2026, 0, 1) } as any),
      mkMember({ id: 'B', userId: 'u', status: 'Active', hourlyCostRate: 800 } as any),
    ])[0];
    expect(personHourlyCostOverride(p2)).toBe(800);
    const p3 = groupMembersByPerson([mkMember({ id: 'A', userId: 'u', status: 'Inactive', hourlyCostRate: 700 } as any)])[0];
    expect(personHourlyCostOverride(p3)).toBe(700);
  });
});

describe('leaving payroll is stamped with a date (leftAtForStatusChange)', () => {
  const now = new Date('2026-10-16T10:00:00Z');
  it('Active -> Inactive with no date picked stamps NOW, so a later edit cannot resurrect past salaries', () => {
    const prev = { status: 'Active', updatedAt: new Date('2026-01-01') } as any;
    const left = leftAtForStatusChange(prev, 'Inactive', null, now)!;
    expect(left).toEqual(now);
    // Later edit: updatedAt moves to December, leftAt does not.
    const m = mkMember({ monthlySalary: 60_000, status: 'Inactive', leftAt: left, updatedAt: new Date('2026-12-20') } as any);
    expect(memberSalaryForMonth(m, end(2026, 8))).toBe(60_000);   // Sep: before leaving
    expect(memberSalaryForMonth(m, end(2026, 10))).toBe(0);       // Nov: after leaving - the edit did not resurrect it
  });
  it('a picked date wins; reactivation clears with an explicit null; nothing to say -> undefined', () => {
    const picked = new Date('2026-08-31T12:00:00');
    expect(leftAtForStatusChange({ status: 'Active' } as any, 'Inactive', picked, now)).toEqual(picked);
    expect(leftAtForStatusChange({ status: 'Inactive', leftAt: picked } as any, 'Active', null, now)).toBeNull();
    expect(leftAtForStatusChange({ status: 'Active' } as any, 'Active', null, now)).toBeUndefined();
  });
  it('an Inactive member whose stored date the owner EMPTIED leaves from now ("Bosh = nga sot e tutje")', () => {
    // The form pre-fills the stored leftAt, so an empty box is the owner clearing it.
    const picked = new Date('2026-08-31T12:00:00');
    expect(leftAtForStatusChange({ status: 'Inactive', leftAt: picked } as any, 'Inactive', null, now)).toEqual(now);
  });
  it('a LEGACY Inactive row without leftAt freezes its pre-edit updatedAt', () => {
    const was = new Date('2026-04-15T09:00:00Z');
    expect(leftAtForStatusChange({ status: 'Inactive', updatedAt: was } as any, 'Inactive', null, now)).toEqual(was);
  });
  it('documents the legacy hazard: without leftAt, a later edit (updatedAt) moves the leave date', () => {
    const m = mkMember({ monthlySalary: 60_000, status: 'Inactive', updatedAt: new Date('2026-12-20') } as any);
    expect(memberSalaryForMonth(m, end(2026, 10))).toBe(60_000);  // why TeamsView must stamp leftAt
  });
});
