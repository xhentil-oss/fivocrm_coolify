import type { Invoice, InvoiceItem, Project, Service } from '../../types';
import { getInvoiceCollectedBetween } from './financialAnalytics';
import { labelerFor, invoiceServiceMix, projectServiceMix } from './serviceMix';

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
  /** responsibleUserId (or, failing that, createdByUserId) → collected cash (ALL) */
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
  /**
   * Service catalogue + invoice lines. With them an invoice's cash is split
   * across departments by its own lines (SEO line → SEO, Ads line → Ads), the
   * same split computeDepartmentPnl uses — otherwise the two columns of one
   * department row would disagree. Without them: whole invoice → project.department.
   */
  lines: { services?: Service[] | null; invoiceItems?: InvoiceItem[] | null } = {},
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
  const servicesById = new Map((lines.services || []).map(s => [s.id, s]));
  const label = labelerFor(lines.services, projects);
  const itemsByInvoice = new Map<string, InvoiceItem[]>();
  for (const it of lines.invoiceItems || []) {
    if (!it.invoiceId) continue;
    const list = itemsByInvoice.get(it.invoiceId);
    if (list) list.push(it); else itemsByInvoice.set(it.invoiceId, [it]);
  }

  for (const inv of invoices) {
    // Same collected basis as the headline number, so the columns reconcile.
    // A REFUND (negative collected: a credit note, a reversed instalment) is
    // kept and reduces the department / person it came from — the department
    // P&L on the cash basis counts it, so skipping it here made the two columns
    // of one row disagree by exactly the refund.
    const collected = getInvoiceCollectedBetween(inv, window.start, window.end);
    if (!collected) continue;
    result.total += collected;

    const pid = inv.projectId;
    const project = pid ? projectById.get(pid) : undefined;
    if (!project) {
      // No project, or a dangling projectId — both mean "nobody owns this cash".
      result.unlinked.count += 1;
      result.unlinked.amount += collected;
      continue;
    }

    // Weights from the invoice's own lines (never signed), the sign applied by
    // multiplying the collected amount — identical to computeDepartmentPnl.
    const mix = invoiceServiceMix(
      itemsByInvoice.get(inv.id), servicesById, label, projectServiceMix(project, servicesById, label),
      label((project as any).department),
    );
    for (const s of mix) {
      result.byDepartment.set(s.line, (result.byDepartment.get(s.line) || 0) + collected * s.weight);
    }

    // Same fallback as the ACCRUAL row this column is read next to
    // (`computeProjectPnl` → `responsibleUserId || createdByUserId`). Reading
    // only `responsibleUserId` here made a legacy project — one with a creator
    // but no responsible — show revenue with zero collected, so the per-person
    // column did not add up to the cash actually banked.
    const uid = project.responsibleUserId || project.createdByUserId || '';
    if (uid) {
      result.byUser.set(uid, (result.byUser.get(uid) || 0) + collected);
    } else {
      result.withoutResponsible += collected;
    }
  }

  return result;
}
