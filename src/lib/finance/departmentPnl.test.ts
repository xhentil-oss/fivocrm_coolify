import { describe, expect, it } from 'vitest';
import type { Project, TeamMember, Expense } from '../../types';
import { computeDepartmentPnl } from './departmentPnl';

function mkP(p: Partial<Project>): Project {
  return {
    id: p.id || 'p', name: p.name || 'P', status: p.status || 'Active',
    budget: p.budget, billingType: p.billingType || 'one-time', department: p.department,
    responsibleUserId: p.responsibleUserId, memberUserIds: p.memberUserIds,
    createdAt: p.createdAt ?? new Date('2026-03-01'), updatedAt: p.updatedAt ?? new Date('2026-03-01'),
    createdByUserId: null, ...p,
  } as Project;
}
function mkM(id: string, salary: number): TeamMember {
  return { id, teamId: 't', userId: id, role: 'Member', status: 'Active', monthlySalary: salary } as TeamMember;
}
function mkE(p: Partial<Expense>): Expense {
  return { id: p.id || 'e', title: 'x', amount: p.amount ?? 0, category: p.category || 'Other',
    currency: 'ALL', date: p.date ?? new Date('2026-03-10'), projectId: p.projectId, ...p } as Expense;
}

// One-month window so salary = 1× monthlySalary.
const OPTS = { range: { start: new Date('2026-03-01'), end: new Date('2026-03-31T23:59:59') }, mode: 'all' as const, now: new Date('2026-03-31T12:00:00') };

describe('computeDepartmentPnl', () => {
  it('splits a member cost equally across the projects they work on', () => {
    const projects = [
      mkP({ id: 'a', department: 'Social', budget: 100_000, responsibleUserId: 'u1' }),
      mkP({ id: 'b', department: 'SEO', budget: 100_000, responsibleUserId: 'u1' }),
    ];
    const members = [mkM('u1', 60_000)];
    const res = computeDepartmentPnl(projects, members, [], OPTS);
    const social = res.rows.find(r => r.department === 'Social')!;
    const seo = res.rows.find(r => r.department === 'SEO')!;
    expect(social.labor).toBe(30_000); // 60k / 2 projects
    expect(seo.labor).toBe(30_000);
    expect(social.profit).toBe(100_000 - 30_000);
  });

  it('sums multiple participants and groups by department', () => {
    const projects = [
      mkP({ id: 'a', department: 'Social', budget: 200_000, responsibleUserId: 'mgr', memberUserIds: ['des'] }),
    ];
    const members = [mkM('mgr', 80_000), mkM('des', 50_000)];
    const res = computeDepartmentPnl(projects, members, [], OPTS);
    const social = res.rows[0];
    expect(social.department).toBe('Social');
    expect(social.labor).toBe(130_000); // 80k + 50k (each on 1 project)
    expect(social.projects[0].participants).toHaveLength(2);
    expect(social.profit).toBe(200_000 - 130_000);
  });

  it('allocates non-project fixed expenses as overhead by revenue weight', () => {
    const projects = [
      mkP({ id: 'a', department: 'Social', budget: 300_000, responsibleUserId: 'u1' }),
      mkP({ id: 'b', department: 'SEO', budget: 100_000, responsibleUserId: 'u2' }),
    ];
    const members = [mkM('u1', 0), mkM('u2', 0)];
    const expenses = [mkE({ id: 'rent', amount: 40_000, category: 'Rent' })]; // no projectId → pool
    const res = computeDepartmentPnl(projects, members, expenses, OPTS);
    expect(res.otherFixedPool).toBe(40_000);
    const social = res.rows.find(r => r.department === 'Social')!;
    expect(social.overhead).toBe(30_000); // 75% of 40k
  });

  it('reports salaries of people on no project as unallocated labor', () => {
    const projects = [mkP({ id: 'a', department: 'Social', budget: 100_000, responsibleUserId: 'u1' })];
    const members = [mkM('u1', 40_000), mkM('idle', 25_000)];
    const res = computeDepartmentPnl(projects, members, [], OPTS);
    expect(res.rows[0].labor).toBe(40_000);
    expect(res.unallocatedLabor.total).toBe(25_000);
    expect(res.unallocatedLabor.members[0].name).toBeDefined();
  });

  it('buckets projects without a department under "Pa departament"', () => {
    const projects = [mkP({ id: 'a', budget: 50_000, responsibleUserId: 'u1' })];
    const res = computeDepartmentPnl(projects, [mkM('u1', 0)], [], OPTS);
    expect(res.rows[0].department).toBe('Pa departament');
  });
});
