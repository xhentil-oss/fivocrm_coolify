import { describe, expect, it } from 'vitest';
import type { Project, TeamMember, Expense, TimeEntry } from '../../types';
import { computeProjectPnl } from './projectPnl';
import { allocateLabor } from './laborAllocation';
import { monthCoverage } from './projectPeriod';
import { computeDepartmentPnl, buildDepartmentProfitTrend, PAYROLL_WITHOUT_MEMBER } from './departmentPnl';

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

// One-month window so salary = 1× monthlySalary. Local midnight, not `new Date('2026-03-01')`
// (UTC midnight = 01:00 local): a range that starts an hour into the month is a
// partial month, and the plan payroll of a partial month is charged at its share.
const OPTS = { range: { start: new Date(2026, 2, 1), end: new Date('2026-03-31T23:59:59') }, mode: 'all' as const, now: new Date('2026-03-31T12:00:00') };

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
    // Each whole month: 100k revenue − 20k labor = 80k profit. The current month
    // runs to NOW, so both its fee and its plan payroll are the elapsed share.
    expect(t.data[0].Social).toBe(80_000);
    const share = monthCoverage(2026, 2, new Date(2026, 2, 1), now);
    expect(t.deltas.Social.last).toBeCloseTo(80_000 * share, 6);
    expect(t.deltas.Social.prev).toBe(80_000);
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

// ── Sep 2026 audit ─────────────────────────────────────────────────────────
describe('a retainer stops earning for its department when its series ends', () => {
  const now = new Date('2026-09-20');
  const sep = { range: { start: new Date(2026, 8, 1), end: new Date(2026, 8, 30, 23, 59, 59, 999) }, mode: 'all' as const, now };

  it('books nothing in September for a retainer cancelled in February', () => {
    const cancelled = mkP({ id: 'r', department: 'Social', budget: 50_000, billingType: 'monthly',
      status: 'Cancelled', isRecurring: false,
      createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-02-20') } as any);
    const res = computeDepartmentPnl([cancelled], [mkM('u1', 0)], [], sep);
    expect(res.rows).toHaveLength(0);
    expect(res.totals.revenue).toBe(0);
  });

  it('keeps a live retainer earning after an all-tasks-done moment', () => {
    const live = mkP({ id: 'r', department: 'Social', budget: 50_000, billingType: 'monthly',
      status: 'Active', isRecurring: true, lastCompletedAt: new Date('2026-03-20'),
      createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-03-20') } as any);
    const res = computeDepartmentPnl([live], [mkM('u1', 0)], [], sep);
    expect(res.rows[0].revenue).toBe(50_000);
  });
});

describe('recorded payroll with no active member is reported, not lost', () => {
  it('routes it to unallocated labor instead of dropping it from every row', () => {
    // With zero Active members both the plan weight and the equal share are 0,
    // so the whole actual payroll silently disappeared from the department rows
    // AND from unallocatedLabor (which filters to active members too).
    const projects = [mkP({ id: 'a', department: 'Social', budget: 100_000 })];
    const salaries = [
      mkE({ id: 's1', amount: 62_000, category: 'Salary', date: new Date('2026-03-30') }),
      mkE({ id: 's2', amount: 8_000, category: 'Salary', date: new Date('2026-03-30') }),
    ];
    const res = computeDepartmentPnl(projects, [], salaries, OPTS);
    expect(res.totals.labor).toBe(0);                      // nobody to charge it to
    expect(res.unallocatedLabor.total).toBe(70_000);       // …but it still exists
    expect(res.unallocatedLabor.members[0].name).toBe(PAYROLL_WITHOUT_MEMBER);
    // The Salary rows are not double-counted as ordinary expenses either.
    expect(res.otherFixedPool).toBe(0);
  });

  it('changes nothing when there IS an active member to carry the payroll', () => {
    const projects = [mkP({ id: 'a', department: 'Social', budget: 100_000, responsibleUserId: 'u1' })];
    const salaries = [mkE({ id: 's1', amount: 70_000, category: 'Salary', date: new Date('2026-03-30') })];
    const res = computeDepartmentPnl(projects, [mkM('u1', 50_000)], salaries, OPTS);
    expect(res.rows[0].labor).toBe(70_000);
    expect(res.unallocatedLabor.total).toBe(0);
  });
});

// ── Sep 2026: leaving payroll is an event with a DATE, not a status ─────────
describe('a leaver still costs the months they worked', () => {
  const now = new Date('2026-09-20');
  const june = { start: new Date(2026, 5, 1), end: new Date(2026, 5, 30, 23, 59, 59, 999) };
  const JUNE = { range: june, mode: 'all' as const, now };

  // Marked Inactive when they left on 1 September.
  const leaver = { ...mkM('u1', 60_000), status: 'Inactive', leftAt: new Date('2026-09-01') } as any as TeamMember;
  const juneProject = (over: Partial<Project> = {}) => mkP({
    id: 'a', department: 'Social', budget: 100_000, responsibleUserId: 'u1',
    createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-06-15'),
    lastCompletedAt: new Date('2026-06-15'), ...over,
  } as Partial<Project>);

  it('keeps them on the June department labour line', () => {
    // Filtering on today's status BEFORE calling memberSalaryForMonth erased
    // this cost the day the dropdown changed — the past year's profit silently
    // improved, which is the bug salaryHistory.ts was fixed for.
    const res = computeDepartmentPnl([juneProject()], [leaver], [], JUNE);
    expect(res.rows[0].labor).toBe(60_000);
    expect(res.unallocatedLabor.total).toBe(0);
  });

  it('keeps them in the June project fixed pool, on both payroll paths', () => {
    const projects = [juneProject()];
    expect(computeProjectPnl(projects, [leaver], [], { range: june, now }).fixedPool.salaries).toBe(60_000);
    // …and on the explicit-months override, which had its own status filter.
    expect(computeProjectPnl(projects, [leaver], [], { months: 1, now }).fixedPool.salaries).toBe(60_000);
  });

  it('stops costing them once the period is after they left', () => {
    const sep = { start: new Date(2026, 8, 1), end: new Date(2026, 8, 30, 23, 59, 59, 999) };
    const res = computeProjectPnl([juneProject({ lastCompletedAt: new Date('2026-09-15'), updatedAt: new Date('2026-09-15') })],
      [leaver], [], { range: sep, now });
    expect(res.fixedPool.salaries).toBe(0);
  });

  it('never charges an invite that was never accepted', () => {
    const pending = { ...mkM('u2', 90_000), status: 'Pending' } as any as TeamMember;
    const res = computeDepartmentPnl([juneProject()], [leaver, pending], [], JUNE);
    expect(res.rows[0].labor).toBe(60_000);          // the leaver only
    expect(res.unallocatedLabor.total).toBe(0);
    expect(computeProjectPnl([juneProject()], [leaver, pending], [], { range: june, now })
      .fixedPool.salaries).toBe(60_000);
  });

  it('keeps the documented invariant: department labour + unallocated == project fixed pool', () => {
    const members = [leaver, mkM('u2', 40_000)];     // u2 is on no project
    const projects = [juneProject()];
    const dept = computeDepartmentPnl(projects, members, [], JUNE);
    const proj = computeProjectPnl(projects, members, [], { range: june, now });
    expect(dept.totals.labor + dept.unallocatedLabor.total).toBe(proj.fixedPool.salaries);
    expect(proj.fixedPool.salaries).toBe(100_000);
    expect(dept.totals.labor).toBe(60_000);
    expect(dept.unallocatedLabor.total).toBe(40_000);
  });

  it('holds the same invariant when the payroll is RECORDED, not planned', () => {
    const members = [leaver, mkM('u2', 40_000)];
    const projects = [juneProject()];
    const paid = [mkE({ id: 's', amount: 85_000, category: 'Salary', date: new Date(2026, 5, 28) })];
    const dept = computeDepartmentPnl(projects, members, paid, JUNE);
    const proj = computeProjectPnl(projects, members, paid, { range: june, now });
    expect(proj.fixedPool.salaries).toBe(85_000);    // what actually left the bank
    expect(dept.totals.labor + dept.unallocatedLabor.total).toBeCloseTo(85_000, 6);
  });
});

// ── Sep 2026 audit ─────────────────────────────────────────────────────────
describe('the shared pool is never dropped', () => {
  it('splits the pool equally when nobody earned anything, instead of charging it to no one', () => {
    // `totalRevenue > 0 ? … : 0` sent the whole pool nowhere in a month of pure
    // delivery — every department read as pool-free.
    const projects = [
      mkP({ id: 'a', department: 'Social', budget: 0, responsibleUserId: 'u1' }),
      mkP({ id: 'b', department: 'SEO', budget: 0, responsibleUserId: 'u2' }),
    ];
    const expenses = [mkE({ id: 'rent', amount: 90_000, category: 'Rent' })];
    const res = computeDepartmentPnl(projects, [mkM('u1', 0), mkM('u2', 0)], expenses, OPTS);
    expect(res.allocationBasis).toBe('equal');
    expect(res.unallocatedOverhead).toBe(0);
    expect(res.rows.find(r => r.department === 'Social')!.overhead).toBe(45_000);
    expect(res.rows.find(r => r.department === 'SEO')!.overhead).toBe(45_000);
    expect(res.totals.overhead).toBe(90_000);
  });

  it('reports the pool as unallocated only when there is no project at all', () => {
    const res = computeDepartmentPnl([], [], [mkE({ id: 'rent', amount: 90_000, category: 'Rent' })], OPTS);
    expect(res.rows).toHaveLength(0);
    expect(res.unallocatedOverhead).toBe(90_000);
  });

  it('hours model: labour with no project or on a project outside the period is pooled and listed', () => {
    const period = { start: new Date(2026, 8, 1), end: new Date(2026, 8, 30, 23, 59, 59, 999) };
    const settings = { employerCostPct: 0, defaultClientCapacityHours: 120 }; // 1 000 L/h
    const ana = { ...mkM('ana', 120_000), displayName: 'ana' } as TeamMember;
    const entry = (projectId: string | undefined, hours: number): TimeEntry => ({
      id: `${projectId}-${hours}`, userId: 'ana', projectId, startTime: new Date('2026-09-10T09:00:00'), endTime: new Date('2026-09-10T17:00:00'),
      source: 'manual', duration: hours * 60, createdAt: new Date('2026-09-10'), updatedAt: new Date('2026-09-10'),
    } as TimeEntry);
    const inRow = mkP({ id: 'pX', department: 'Social', status: 'Active', budget: 200_000, billingType: 'monthly', responsibleUserId: 'ana', createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01') } as any);
    const labor = allocateLabor({ timeEntries: [entry('pX', 30), entry(undefined, 5), entry('gone', 10)], members: [ana], expenses: [], period, settings });
    const res = computeDepartmentPnl([inRow], [ana], [], { range: period, labor, timeEntries: [] });
    expect(res.laborBasis).toBe('hours');
    expect(res.laborOutsideRows).toBe(15_000);
    expect(res.rows[0].labor).toBe(30_000);
    expect(res.rows[0].overhead).toBeCloseTo(75_000 + 15_000, 6);            // bench + outside, all on the one row
    expect(res.totals.labor + res.rows[0].overhead).toBeCloseTo(120_000, 6); // == payroll
    expect(res.unallocatedLabor.total).toBeCloseTo(90_000, 6);
    expect(res.unallocatedLabor.members.map(m => m.name)).toEqual([
      'Punë e paabsorbuar (orë të paregjistruara / bench)', 'Orë pa projekt', 'Orë në projekte jashtë periudhës',
    ]);
  });
});

// ── Oct 2026 audit ──────────────────────────────────────────────────────────
describe('hours model: a one-time project earns for its department in the period its hours are logged', () => {
  const period = { start: new Date(2026, 8, 1), end: new Date(2026, 8, 30, 23, 59, 59, 999) };
  const settings = { employerCostPct: 0, defaultClientCapacityHours: 120 }; // 1 000 L/h
  const ana = { ...mkM('ana', 120_000), displayName: 'ana' } as TeamMember;
  const entries = [{
    id: 'e1', userId: 'ana', projectId: 'ff', date: '2026-09-10', startTime: new Date('2026-09-10T09:00:00'),
    source: 'manual', duration: 50 * 60, createdAt: new Date('2026-09-10'), updatedAt: new Date('2026-09-10'),
  } as TimeEntry];
  // Created/updated in JULY, 50 of 100 planned hours in SEPTEMBER.
  const fixedFee = mkP({
    id: 'ff', department: 'Web', status: 'Active', billingType: 'one-time', budget: 100_000, plannedHours: 100,
    createdAt: new Date('2026-07-05'), updatedAt: new Date('2026-07-20'),
  } as any);

  it('the department row carries the earned revenue and the labour of those hours', () => {
    const labor = allocateLabor({ timeEntries: entries, members: [ana], expenses: [], period, settings, clientProjectIds: new Set(['ff']) });
    const res = computeDepartmentPnl([fixedFee], [ana], [], { range: period, labor, timeEntries: entries });
    const web = res.rows.find(r => r.department === 'Web')!;
    expect(web.revenue).toBeCloseTo(50_000);
    expect(web.labor).toBeCloseTo(50_000);
    expect(res.laborOutsideRows).toBe(0);
    // Same answer as the project engine.
    const pnl = computeProjectPnl([fixedFee], [ana], [], { range: period, labor, timeEntries: entries });
    expect(res.totals.revenue).toBeCloseTo(pnl.totals.revenue);
  });

  it('legacy model (no hours) is unchanged', () => {
    const res = computeDepartmentPnl([fixedFee], [ana], [], { range: period, timeEntries: entries });
    expect(res.rows).toEqual([]);
  });
});

describe('weekly retainer earns its weekly fee × 52/12 per month', () => {
  it('department revenue for a month', () => {
    const weekly = mkP({
      id: 'w', department: 'Ads', status: 'Active', billingType: 'monthly', isRecurring: true, recurringFrequency: 'weekly',
      budget: 12_000, createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01'),
    } as any);
    const res = computeDepartmentPnl([weekly], [], [], OPTS);
    expect(res.rows[0].revenue).toBeCloseTo(52_000);
  });
});
