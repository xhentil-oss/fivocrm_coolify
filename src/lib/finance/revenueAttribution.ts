import type { Invoice, Project } from '../../types';
import { getInvoiceCollectedBetween } from './financialAnalytics';

// ── Collected cash, attributed to a department and a responsible person ──
//
// The department/responsible P&L panels answer an ACCRUAL question: how much
// revenue did this department earn (its budget, or the invoices raised for it).
// That is the right basis for profit, but it says nothing about whether the
// money actually arrived. This module answers the CASH question over the same
// window: of the money that landed in the bank, whose work brought it in.
//
// The only bridge from an invoice to a person or a department is the project:
//   invoice.projectId → project.department / project.responsibleUserId
// So an invoice with no `projectId` — or one pointing at a project that no
// longer exists — is genuinely unattributable. It is never silently dropped:
// `unlinked` carries it out so the UI can say so, the same way the project P&L
// already warns about unlinked invoices.

/** Same fallback label the department P&L uses, so the two agree on keys. */
export const NO_DEPARTMENT = 'Pa departament';

export interface CollectionWindow { start: Date; end: Date }

export interface CollectedAttribution {
  /** department label → collected cash (ALL) */
  byDepartment: Map<string, number>;
  /** responsibleUserId → collected cash (ALL) */
  byUser: Map<string, number>;
  /**
   * Cash no project could absorb: the invoice carries no `projectId`, or one
   * that resolves to nothing. Counted, not hidden — otherwise the per-person and
   * per-department columns would quietly fail to add up to the money collected.
   */
  unlinked: { count: number; amount: number };
  /** Collected through a project that has no responsible user set. */
  withoutResponsible: number;
  /** Everything collected in the window, attributable or not. */
  total: number;
}

/** The department key for a project, matching `departmentPnl`'s derivation. */
export function departmentOf(project: Project | undefined): string {
  return ((project as any)?.department || '').trim() || NO_DEPARTMENT;
}

/**
 * Resolve a period into a concrete cash window.
 *
 * Mirrors `computeProjectPnl`'s own invoice window so the accrual column and the
 * cash column are always measured over the same span — if these two drifted, the
 * "still to collect" difference would be nonsense.
 */
export function resolveCollectionWindow(opts: {
  range?: { start: Date; end: Date };
  year?: number;
  allTime?: boolean;
  now?: Date;
}): CollectionWindow {
  const now = opts.now ?? new Date();
  if (opts.range) return opts.range;
  if (opts.year != null && !opts.allTime) {
    return {
      start: new Date(opts.year, 0, 1),
      end: opts.year === now.getFullYear() ? now : new Date(opts.year, 11, 31, 23, 59, 59, 999),
    };
  }
  return { start: new Date(0), end: now };
}

export function attributeCollectedRevenue(
  invoices: Invoice[] | undefined | null,
  projects: Project[] | undefined | null,
  window: CollectionWindow,
): CollectedAttribution {
  const result: CollectedAttribution = {
    byDepartment: new Map(),
    byUser: new Map(),
    unlinked: { count: 0, amount: 0 },
    withoutResponsible: 0,
    total: 0,
  };
  if (!invoices?.length) return result;

  const projectById = new Map((projects || []).map(p => [p.id, p]));

  for (const inv of invoices) {
    // Same collected basis as the headline number, so the columns reconcile.
    const collected = getInvoiceCollectedBetween(inv, window.start, window.end);
    if (collected <= 0) continue;
    result.total += collected;

    const pid = inv.projectId;
    const project = pid ? projectById.get(pid) : undefined;
    if (!project) {
      // No project, or a dangling projectId — both mean "nobody owns this cash".
      result.unlinked.count += 1;
      result.unlinked.amount += collected;
      continue;
    }

    const dept = departmentOf(project);
    result.byDepartment.set(dept, (result.byDepartment.get(dept) || 0) + collected);

    const uid = project.responsibleUserId;
    if (uid) {
      result.byUser.set(uid, (result.byUser.get(uid) || 0) + collected);
    } else {
      result.withoutResponsible += collected;
    }
  }

  return result;
}
