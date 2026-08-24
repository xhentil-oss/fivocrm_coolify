import { describe, expect, it } from 'vitest';
import type { Project, TeamMember, Expense } from '../../types';
import { computeDepartmentPnl, buildDepartmentProfitTrend } from './departmentPnl';

// Default fixture is a COMPLETED one-time project — the state in which a one-time
// deal's revenue is recognised (point in time).
function mkP(p: Partial<Project>): Project {
  return {
    id: p.id || 'p', name: p.name || 'P', status: p.status || 'Completed',
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

describe('computeDepartmentPnl — invoiced basis', () => {
  it('uses COLLECTED invoices per project instead of budget (unpaid ≠ profit)', () => {
    const projects = [mkP({ id: 'a', department: 'Social', budget: 100_000, responsibleUserId: 'u1' })];
    const invoices = [
      { id: 'paid', projectId: 'a', total: 180_000, status: 'Paid', invoiceDate: new Date('2026-03-10'), paidAt: new Date('2026-03-12'), createdAt: new Date('2026-03-10') },
      { id: 'unpaid', projectId: 'a', total: 500_000, status: 'Overdue', invoiceDate: new Date('2026-03-10'), createdAt: new Date('2026-03-10') },
    ] as any;
    const res = computeDepartmentPnl(projects, [mkM('u1', 20_000)], [], { ...OPTS, revenueBasis: 'invoiced', invoices });
    const social = res.rows.find(r => r.department === 'Social')!;
    expect(social.revenue).toBe(180_000); // only the paid one, not 100k budget nor the 500k overdue
    expect(social.profit).toBe(180_000 - 20_000);
  });
});

describe('buildDepartmentProfitTrend', () => {
  it('returns monthly profit per department with growth deltas', () => {
    const now = new Date('2026-03-15T12:00:00');
    // A monthly Social project active since January → profit each month.
    const projects = [
      mkP({ id: 's', department: 'Social', budget: 100_000, billingType: 'monthly',
        responsibleUserId: 'u1', createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-03-01') }),
    ];
    const members = [mkM('u1', 20_000)];
    const t = buildDepartmentProfitTrend(projects, members, [], now, 3);
    expect(t.data).toHaveLength(3);                 // Jan, Feb, Mar
    expect(t.departments).toContain('Social');
    // Each month: 100k revenue − 20k labor = 80k profit.
    expect(t.data[0].Social).toBe(80_000);
    expect(t.deltas.Social.last).toBe(80_000);
  });
});

// ── Aug 2026 audit: expense.departmentId finally means something ────────────
describe('department-tagged expenses (expense.departmentId)', () => {
  it('charges a tagged cost to ONE department instead of splitting it across all', () => {
    // `expense.departmentId` was write-only for its whole life: the form
    // collected it, the list showed it, and no report read it — so the SEO
    // team's tools were spread by revenue weight over Social as well.
    const projects = [
      mkP({ id: 'seo1', department: 'SEO', budget: 100_000, responsibleUserId: 'u1' }),
      mkP({ id: 'soc1', department: 'Social', budget: 100_000, responsibleUserId: 'u2' }),
    ];
    const teams = [{ id: 'teamSeo', name: 'Ekipi SEO', department: 'SEO' }];
    const expenses = [mkE({ id: 'ahrefs', amount: 20_000, departmentId: 'teamSeo' })];

    const res = computeDepartmentPnl(projects, [mkM('u1', 0), mkM('u2', 0)], expenses, { ...OPTS, teams });
    const seo = res.rows.find(r => r.department === 'SEO')!;
    const social = res.rows.find(r => r.department === 'Social')!;

    expect(res.departmentFixedPool).toEqual({ SEO: 20_000 });
    expect(res.otherFixedPool).toBe(0);
    expect(seo.departmentFixed).toBe(20_000);
    expect(seo.overhead).toBe(20_000);
    expect(social.departmentFixed).toBe(0);
    expect(social.overhead).toBe(0);   // equal revenue, but not this cost
  });

  it('falls back to the business-wide pool when the team matches no department, and says so', () => {
    const projects = [mkP({ id: 'soc1', department: 'Social', budget: 100_000, responsibleUserId: 'u1' })];
    const teams = [{ id: 'teamGhost', name: 'Ekip i fshirë', department: 'Legal' }];
    const expenses = [mkE({ id: 'x', amount: 5_000, departmentId: 'teamGhost' })];

    const res = computeDepartmentPnl(projects, [mkM('u1', 0)], expenses, { ...OPTS, teams });
    expect(res.otherFixedPool).toBe(5_000);
    expect(res.departmentFixedPool).toEqual({});
    // A silent fallback is indistinguishable from correct attribution.
    expect(res.unmatchedDepartmentFixed).toEqual({ count: 1, amount: 5_000 });
  });

  it('behaves exactly as before when no teams list is supplied', () => {
    const projects = [mkP({ id: 'soc1', department: 'Social', budget: 100_000, responsibleUserId: 'u1' })];
    const expenses = [mkE({ id: 'x', amount: 5_000, departmentId: 'teamSeo' })];
    const res = computeDepartmentPnl(projects, [mkM('u1', 0)], expenses, OPTS);
    expect(res.otherFixedPool).toBe(5_000);
    expect(res.unmatchedDepartmentFixed.count).toBe(1);
  });

  it('a cost tagged to a project outside the period is pooled and reported, not dropped', () => {
    const projects = [mkP({ id: 'inP', department: 'Social', budget: 100_000, responsibleUserId: 'u1' })];
    const expenses = [
      mkE({ id: 'orphan', amount: 700, projectId: 'goneProject' }),
      mkE({ id: 'direct', amount: 300, projectId: 'inP' }),
    ];
    const res = computeDepartmentPnl(projects, [mkM('u1', 0)], expenses, OPTS);
    expect(res.totals.directCost).toBe(300);
    expect(res.otherFixedPool).toBe(700);
    expect(res.unallocatedDirect).toEqual({ count: 1, amount: 700 });
  });
});
