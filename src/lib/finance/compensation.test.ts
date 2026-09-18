import { describe, expect, it } from 'vitest';
import type { MemberCompensation, TeamMember } from '../../types';
import {
  compensationForMember,
  compensationFieldsOf,
  hasCompensationData,
  indexCompensation,
  memberCompId,
  memberCompIdFor,
  mergeMemberCompensation,
  mergeMembersWithCompensation,
} from './compensation';

function mkMember(m: Partial<TeamMember> = {}): TeamMember {
  return {
    id: m.id || `${m.teamId || 't1'}_${m.userId || 'u1'}`,
    teamId: m.teamId || 't1',
    userId: m.userId || 'u1',
    businessId: (m as any).businessId || 'b1',
    role: m.role || 'Member',
    status: m.status || 'Active',
    ...m,
  } as TeamMember;
}

function mkComp(c: Partial<MemberCompensation> = {}): MemberCompensation & { id: string } {
  return {
    id: c.id || `${c.teamId || 't1'}_${c.userId || 'u1'}`,
    teamId: c.teamId || 't1',
    userId: c.userId || 'u1',
    businessId: c.businessId || 'b1',
    ...c,
  } as MemberCompensation & { id: string };
}

describe('memberCompId', () => {
  it('is the same {teamId}_{userId} shape teamMembers uses', () => {
    expect(memberCompId('t1', 'u1')).toBe('t1_u1');
    expect(memberCompIdFor(mkMember({ teamId: 'tX', userId: 'uY' }))).toBe('tX_uY');
  });
});

describe('mergeMemberCompensation', () => {
  it('the comp document WINS when it exists', () => {
    const member = mkMember({ monthlySalary: 50_000, hourlyCostRate: 300 });
    const comp = mkComp({ monthlySalary: 80_000, hourlyCostRate: 500 });
    const merged = mergeMemberCompensation(member, comp);
    expect(merged.monthlySalary).toBe(80_000);
    expect(merged.hourlyCostRate).toBe(500);
    // The source object is never mutated — screens hold the raw list too.
    expect(member.monthlySalary).toBe(50_000);
  });

  it('falls back to the LEGACY teamMembers fields when there is no comp document', () => {
    const member = mkMember({ monthlySalary: 50_000, hourlyCostRate: 300 });
    expect(mergeMemberCompensation(member, null).monthlySalary).toBe(50_000);
    expect(mergeMemberCompensation(member, undefined)).toBe(member);
  });

  it('a PARTIAL comp document only overrides what it actually states', () => {
    const history = [{ monthlySalary: 40_000, effectiveFrom: new Date(2026, 0, 1) }];
    const member = mkMember({ monthlySalary: 50_000, hourlyCostRate: 300, salaryHistory: history });
    // Says nothing about salary or history — those keep the legacy values.
    const merged = mergeMemberCompensation(member, mkComp({ hourlyCostRate: 700 }));
    expect(merged.hourlyCostRate).toBe(700);
    expect(merged.monthlySalary).toBe(50_000);
    expect(merged.salaryHistory).toBe(history);
  });

  it('neither present → the member is unchanged and nothing is invented', () => {
    const member = mkMember();
    const merged = mergeMemberCompensation(member, mkComp());
    expect(merged.monthlySalary).toBeUndefined();
    expect(merged.salaryHistory).toBeUndefined();
    expect(merged.hourlyCostRate).toBeUndefined();
    expect('monthlySalary' in (merged as any)).toBe(false);
  });

  it('an explicit null CLEARS the field — the legacy value must not resurrect it', () => {
    // Clearing a salary that keeps being charged forever is finance bug #30; the
    // fallback must not undo an erase.
    const member = mkMember({ monthlySalary: 50_000 });
    const merged = mergeMemberCompensation(member, mkComp({ monthlySalary: null }));
    expect(merged.monthlySalary).toBeUndefined();
    expect('monthlySalary' in (merged as any)).toBe(false);
  });

  it('an empty salaryHistory on the comp doc is a statement, not a silence', () => {
    const member = mkMember({ salaryHistory: [{ monthlySalary: 40_000, effectiveFrom: new Date(2026, 0, 1) }] });
    const merged = mergeMemberCompensation(member, mkComp({ salaryHistory: [] }));
    expect(merged.salaryHistory).toEqual([]);
  });
});

describe('indexCompensation / compensationForMember', () => {
  it('matches on the derived key even when the membership row has a legacy random id', () => {
    const comp = mkComp({ id: 't1_u1', monthlySalary: 90_000 });
    const index = indexCompensation([comp]);
    const legacyMember = mkMember({ id: 'RANDOM-ADDDOC-ID', teamId: 't1', userId: 'u1' });
    expect(compensationForMember(legacyMember, index)?.monthlySalary).toBe(90_000);
  });

  it('does not cross members of different teams', () => {
    const index = indexCompensation([mkComp({ teamId: 't1', userId: 'u1', monthlySalary: 10 })]);
    expect(compensationForMember(mkMember({ teamId: 't2', userId: 'u1' }), index)).toBeNull();
  });

  it('ignores a comp doc with neither team nor user', () => {
    const index = indexCompensation([{ monthlySalary: 5 } as any]);
    expect(index.size).toBe(0);
  });
});

describe('mergeMembersWithCompensation', () => {
  it('merges per member and leaves the list alone when there is nothing to merge', () => {
    const members = [
      mkMember({ userId: 'u1', monthlySalary: 50_000 }),
      mkMember({ id: 't1_u2', userId: 'u2', monthlySalary: 60_000 }),
    ];
    expect(mergeMembersWithCompensation(members, [])).toBe(members);
    expect(mergeMembersWithCompensation(members, null)).toBe(members);

    const merged = mergeMembersWithCompensation(members, [mkComp({ userId: 'u2', monthlySalary: 99_000 })]);
    expect(merged[0].monthlySalary).toBe(50_000); // legacy fallback
    expect(merged[1].monthlySalary).toBe(99_000); // comp wins
  });

  it('survives a null member list', () => {
    expect(mergeMembersWithCompensation(null, [mkComp()])).toEqual([]);
  });
});

describe('compensationFieldsOf / hasCompensationData', () => {
  it('copies only the fields that are actually present', () => {
    expect(compensationFieldsOf(mkMember({ monthlySalary: 10 }))).toEqual({ monthlySalary: 10 });
    expect(compensationFieldsOf(mkMember())).toEqual({});
  });

  it('an empty history is not data worth backfilling', () => {
    expect(hasCompensationData(mkMember())).toBe(false);
    expect(hasCompensationData(mkMember({ salaryHistory: [] }))).toBe(false);
    expect(hasCompensationData(mkMember({ monthlySalary: 0 }))).toBe(true);
    expect(hasCompensationData(mkMember({ hourlyCostRate: 5 }))).toBe(true);
  });
});
