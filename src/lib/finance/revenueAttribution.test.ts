import { describe, it, expect } from 'vitest';
import {
  attributeCollectedRevenue,
  resolveCollectionWindow,
  departmentOf,
  NO_DEPARTMENT,
} from './revenueAttribution';
import type { Invoice, Project } from '../../types';

const inv = (over: Partial<Invoice> & { id: string }): Invoice => ({
  status: 'Paid',
  total: 100,
  currency: 'ALL',
  ...over,
} as Invoice);

const proj = (over: Partial<Project> & { id: string }): Project => ({
  name: over.id,
  ...over,
} as Project);

const WINDOW = { start: new Date(2026, 0, 1), end: new Date(2026, 11, 31, 23, 59, 59, 999) };

describe('departmentOf', () => {
  it('trims and falls back to the shared no-department label', () => {
    expect(departmentOf(proj({ id: 'p', department: '  Social  ' }))).toBe('Social');
    expect(departmentOf(proj({ id: 'p', department: '   ' }))).toBe(NO_DEPARTMENT);
    expect(departmentOf(proj({ id: 'p' }))).toBe(NO_DEPARTMENT);
    expect(departmentOf(undefined)).toBe(NO_DEPARTMENT);
  });
});

describe('resolveCollectionWindow', () => {
  const now = new Date(2026, 7, 7); // 7 Aug 2026

  it('passes an explicit range straight through', () => {
    const range = { start: new Date(2026, 2, 1), end: new Date(2026, 2, 31) };
    expect(resolveCollectionWindow({ range, now })).toBe(range);
  });

  it('caps the CURRENT year at now, so a partial year is not read as a full one', () => {
    const w = resolveCollectionWindow({ year: 2026, now });
    expect(w.start).toEqual(new Date(2026, 0, 1));
    expect(w.end).toEqual(now);
  });

  it('runs a PAST year to its real end', () => {
    const w = resolveCollectionWindow({ year: 2025, now });
    expect(w.end).toEqual(new Date(2025, 11, 31, 23, 59, 59, 999));
  });

  it('opens the window from the epoch for all-time', () => {
    const w = resolveCollectionWindow({ allTime: true, now });
    expect(w.start.getTime()).toBe(0);
    expect(w.end).toEqual(now);
  });

  it('prefers an explicit range over a year, matching computeProjectPnl', () => {
    const range = { start: new Date(2024, 0, 1), end: new Date(2024, 0, 31) };
    expect(resolveCollectionWindow({ range, year: 2026, now })).toBe(range);
  });
});

describe('attributeCollectedRevenue', () => {
  const projects = [
    proj({ id: 'p1', department: 'Social', responsibleUserId: 'u1' }),
    proj({ id: 'p2', department: 'Social', responsibleUserId: 'u2' }),
    proj({ id: 'p3', department: 'SEO', responsibleUserId: 'u1' }),
    proj({ id: 'p4', department: 'SEO' }), // no responsible
    proj({ id: 'p5' }),                    // no department, no responsible
  ];

  it('returns an empty attribution for no invoices', () => {
    const r = attributeCollectedRevenue([], projects, WINDOW);
    expect(r.total).toBe(0);
    expect(r.byDepartment.size).toBe(0);
    expect(r.byUser.size).toBe(0);
  });

  it('splits collected cash across departments and people', () => {
    const r = attributeCollectedRevenue([
      inv({ id: 'a', projectId: 'p1', total: 1000, paidAt: '2026-03-10' }),
      inv({ id: 'b', projectId: 'p2', total: 500, paidAt: '2026-04-10' }),
      inv({ id: 'c', projectId: 'p3', total: 300, paidAt: '2026-05-10' }),
    ], projects, WINDOW);

    expect(r.total).toBe(1800);
    expect(r.byDepartment.get('Social')).toBe(1500);
    expect(r.byDepartment.get('SEO')).toBe(300);
    // u1 owns p1 (Social) and p3 (SEO) — a person spans departments.
    expect(r.byUser.get('u1')).toBe(1300);
    expect(r.byUser.get('u2')).toBe(500);
  });

  it('counts cash with no project as unlinked instead of dropping it', () => {
    const r = attributeCollectedRevenue([
      inv({ id: 'a', projectId: 'p1', total: 1000, paidAt: '2026-03-10' }),
      inv({ id: 'b', total: 400, paidAt: '2026-03-11' }),               // no projectId
      inv({ id: 'c', projectId: 'ghost', total: 250, paidAt: '2026-03-12' }), // dangling
    ], projects, WINDOW);

    expect(r.unlinked).toEqual({ count: 2, amount: 650 });
    // The total still accounts for every lek collected, attributable or not.
    expect(r.total).toBe(1650);
    const attributed = [...r.byDepartment.values()].reduce((s, v) => s + v, 0);
    expect(attributed + r.unlinked.amount).toBe(r.total);
  });

  it('tracks cash from projects with no responsible separately from unlinked', () => {
    const r = attributeCollectedRevenue([
      inv({ id: 'a', projectId: 'p4', total: 700, paidAt: '2026-03-10' }),
    ], projects, WINDOW);

    // The department is known, the person is not.
    expect(r.byDepartment.get('SEO')).toBe(700);
    expect(r.withoutResponsible).toBe(700);
    expect(r.byUser.size).toBe(0);
    expect(r.unlinked.count).toBe(0);
  });

  it('falls back to the creator when a project has no responsible user', () => {
    // The accrual row this column sits next to uses
    // `responsibleUserId || createdByUserId` (computeProjectPnl), so reading
    // only `responsibleUserId` here showed a legacy project with revenue and
    // zero cash collected, and the per-person column stopped adding up.
    const legacy = [proj({ id: 'old', department: 'Social', createdByUserId: 'creator' } as any)];
    const r = attributeCollectedRevenue(
      [inv({ id: 'a', projectId: 'old', total: 600, paidAt: new Date(2026, 2, 10) })],
      legacy, WINDOW,
    );
    expect(r.byUser.get('creator')).toBe(600);
    expect(r.withoutResponsible).toBe(0);
  });

  it('still reports cash from a project with neither responsible nor creator', () => {
    const orphan = [proj({ id: 'o', department: 'SEO', createdByUserId: null } as any)];
    const r = attributeCollectedRevenue(
      [inv({ id: 'a', projectId: 'o', total: 300, paidAt: new Date(2026, 2, 10) })],
      orphan, WINDOW,
    );
    expect(r.withoutResponsible).toBe(300);
    expect(r.byUser.size).toBe(0);
  });

  it('buckets a project with no department under the shared fallback label', () => {
    const r = attributeCollectedRevenue([
      inv({ id: 'a', projectId: 'p5', total: 200, paidAt: '2026-03-10' }),
    ], projects, WINDOW);
    expect(r.byDepartment.get(NO_DEPARTMENT)).toBe(200);
  });

  it('ignores cash collected outside the window', () => {
    const r = attributeCollectedRevenue([
      inv({ id: 'a', projectId: 'p1', total: 1000, paidAt: '2025-06-10' }), // before
      inv({ id: 'b', projectId: 'p1', total: 900, paidAt: '2026-06-10' }),  // inside
    ], projects, WINDOW);
    expect(r.total).toBe(900);
    expect(r.byDepartment.get('Social')).toBe(900);
  });

  it('ignores draft and cancelled invoices', () => {
    const r = attributeCollectedRevenue([
      inv({ id: 'a', projectId: 'p1', status: 'Draft', total: 1000, paidAt: '2026-03-10' }),
      inv({ id: 'b', projectId: 'p1', status: 'Cancelled', total: 800, paidAt: '2026-03-10' }),
    ], projects, WINDOW);
    expect(r.total).toBe(0);
    expect(r.unlinked.count).toBe(0);
  });

  it('credits only the part actually banked on a partially-paid invoice', () => {
    const r = attributeCollectedRevenue([
      inv({
        id: 'a', projectId: 'p1', status: 'Partial', total: 1000,
        partialPayments: [
          { amount: 300, paidAt: new Date(2026, 2, 10) },
          { amount: 200, paidAt: new Date(2026, 3, 10) },
          // Banked in a different year — must not leak into this window.
          { amount: 400, paidAt: new Date(2025, 3, 10) },
        ],
      }),
    ], projects, WINDOW);
    expect(r.byDepartment.get('Social')).toBe(500);
  });

  it('converts a EUR invoice into ALL so departments are comparable', () => {
    const all = attributeCollectedRevenue(
      [inv({ id: 'a', projectId: 'p1', total: 100, currency: 'ALL', paidAt: '2026-03-10' })],
      projects, WINDOW,
    );
    const eur = attributeCollectedRevenue(
      [inv({ id: 'b', projectId: 'p1', total: 100, currency: 'EUR', paidAt: '2026-03-10' })],
      projects, WINDOW,
    );
    // Same face value, different currency → the EUR one must be worth more lek.
    expect(eur.byDepartment.get('Social')!).toBeGreaterThan(all.byDepartment.get('Social')!);
  });

  it('survives a null project list by treating every invoice as unlinked', () => {
    const r = attributeCollectedRevenue([
      inv({ id: 'a', projectId: 'p1', total: 1000, paidAt: '2026-03-10' }),
    ], null, WINDOW);
    expect(r.unlinked).toEqual({ count: 1, amount: 1000 });
    expect(r.byDepartment.size).toBe(0);
  });
});
