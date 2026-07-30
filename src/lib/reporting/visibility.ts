/**
 * Report visibility — the ONE authority on what leaves the agency.
 *
 * A single report carries internal and client-facing content side by side, so the
 * whole leak-prevention story reduces to one rule: **no client-facing output is
 * ever built from a raw `Report`.** The portal, the PDF renderer and the email
 * sender all call `redactForClient()` (or `redactForAudience()` with a client
 * audience) and render only what comes back.
 *
 * Design decisions that make that enforceable:
 *
 *   • `CLIENT_VISIBILITIES` is a closed allow-list. A visibility value that isn't
 *     in it is internal by construction, so adding a new internal level later can
 *     never accidentally become client-visible.
 *   • Redaction is *subtractive on a copy* — it never mutates the input, and it
 *     drops blocks, KPI values AND attachments in one pass, so there is no second
 *     place to forget.
 *   • `assertNoClientLeak()` is the assertion the tests (and the publish path) use
 *     to prove the invariant instead of trusting review.
 */

import type {
  Report,
  ReportBlock,
  ReportComment,
  ReportKpiValue,
  ReportVisibility,
  ReportAttachment,
} from '../../types';

/**
 * The ONLY visibility values that may cross the tenant→client boundary.
 * Everything not listed here is internal. Closed by design — do not widen without
 * also widening `assertNoClientLeak` and the portal Firestore rules.
 */
export const CLIENT_VISIBILITIES: ReadonlySet<ReportVisibility> = new Set<ReportVisibility>([
  'client',
  'client_contacts',
]);

/** Ordered, labelled visibility options for the block editor. */
export const VISIBILITY_OPTIONS: Array<{
  value: ReportVisibility;
  label: string;
  hint: string;
  client: boolean;
}> = [
  { value: 'author', label: 'Vetëm autori', hint: 'Shënime personale — nuk i sheh as menaxheri.', client: false },
  { value: 'internal', label: 'Ekipi i brendshëm', hint: 'Të gjithë punonjësit e biznesit.', client: false },
  { value: 'department', label: 'Vetëm departamenti', hint: 'Anëtarët e të njëjtit departament.', client: false },
  { value: 'team_leader', label: 'Team Leader', hint: 'Autori + team leader-i i tij.', client: false },
  { value: 'project_manager', label: 'Project Manager', hint: 'PM-ja e projektit + menaxhimi.', client: false },
  { value: 'account_manager', label: 'Account Manager', hint: 'AM-ja e klientit + menaxhimi.', client: false },
  { value: 'management', label: 'Vetëm menaxhimi', hint: 'Admin/Owner/Manager — përfshin të dhëna konfidenciale.', client: false },
  { value: 'custom_roles', label: 'Role të zgjedhura', hint: 'Lista e roleve që caktoni më poshtë.', client: false },
  { value: 'client', label: 'I dukshëm për klientin', hint: 'Publikohet në portal, PDF dhe email.', client: true },
  { value: 'client_contacts', label: 'Kontakte të zgjedhura', hint: 'Vetëm kontaktet e caktuara të klientit.', client: true },
];

/** Is this visibility ever shown to a client? */
export function isClientVisibility(v: ReportVisibility): boolean {
  return CLIENT_VISIBILITIES.has(v);
}

/** Who is asking. Built by `useReportAudience()` for staff, `useClientPortal` for clients. */
export interface ReportAudience {
  kind: 'staff' | 'client' | 'link';
  userId?: string | null;
  /** Team role strings (`Admin`, `Manager`, `Sales`, …) for `custom_roles`. */
  roles?: string[];
  department?: string | null;

  // Relationship to THIS report (resolved by the caller from the report doc).
  isAuthor?: boolean;
  isReviewer?: boolean;
  isApprover?: boolean;
  isProjectManager?: boolean;
  isAccountManager?: boolean;
  isTeamLeader?: boolean;
  /** Admin / Owner / Manager — sees `management` blocks. */
  isManagement?: boolean;

  /** Granular permission: may read `management`-level confidential sections. */
  canViewConfidential?: boolean;
  /** Granular permission: may read KPI values flagged `financial`. */
  canViewFinancial?: boolean;

  // Client audience only.
  customerId?: string | null;
  /** Customer contact id, for `client_contacts` blocks. */
  contactId?: string | null;
}

/** A client audience for a given customer (+ optional specific contact). */
export function clientAudience(customerId: string, contactId?: string | null): ReportAudience {
  return { kind: 'client', customerId, contactId: contactId ?? null };
}

/**
 * Core predicate. Deliberately written as an exhaustive switch so a newly added
 * `ReportVisibility` fails the type check here first, rather than silently
 * defaulting to "visible".
 */
export function isBlockVisibleTo(block: ReportBlock, audience: ReportAudience): boolean {
  const v = block.visibility;

  // ── Client / public-link audiences: allow-list only, nothing else. ──
  if (audience.kind === 'client' || audience.kind === 'link') {
    if (!CLIENT_VISIBILITIES.has(v)) return false;
    // A block explicitly excluded from the portal is not client content there.
    if (block.inPortal === false) return false;
    if (v === 'client_contacts') {
      const allowed = block.visibleContactIds || [];
      // No list configured → fall back to "all client contacts"; an explicit list
      // must contain the reader.
      if (allowed.length === 0) return true;
      return !!audience.contactId && allowed.includes(audience.contactId);
    }
    return true;
  }

  // ── Staff audience ──
  switch (v) {
    case 'author':
      return audience.isAuthor === true || audience.isManagement === true;
    case 'internal':
      return true; // any staff member of the tenant
    case 'department':
      return audience.isManagement === true
        || audience.isAuthor === true
        || (!!audience.department && !!block.settings?.department
            ? audience.department === block.settings.department
            : true);
    case 'team_leader':
      return audience.isAuthor === true || audience.isTeamLeader === true || audience.isManagement === true;
    case 'project_manager':
      return audience.isProjectManager === true || audience.isManagement === true || audience.isAuthor === true;
    case 'account_manager':
      return audience.isAccountManager === true || audience.isManagement === true || audience.isAuthor === true;
    case 'management':
      // The strictest internal level: management membership AND the granular
      // "view confidential sections" permission. An Admin whose role template
      // withholds that permission does not see it.
      return audience.isManagement === true && audience.canViewConfidential !== false;
    case 'custom_roles': {
      const allowed = block.visibleRoles || [];
      if (audience.isManagement === true) return true;
      if (allowed.length === 0) return true;
      return (audience.roles || []).some(r => allowed.includes(r));
    }
    case 'client':
    case 'client_contacts':
      // Client-facing content is of course also visible to staff.
      return true;
    default: {
      // Exhaustiveness guard: an unhandled visibility is treated as internal-only
      // AND is not shown, which is the fail-closed direction.
      const _never: never = v;
      void _never;
      return false;
    }
  }
}

/** Attachments follow exactly the same rule as blocks. */
export function isAttachmentVisibleTo(att: ReportAttachment, audience: ReportAudience): boolean {
  if (audience.kind === 'client' || audience.kind === 'link') return CLIENT_VISIBILITIES.has(att.visibility);
  return isBlockVisibleTo({ visibility: att.visibility } as ReportBlock, audience);
}

/** Comments: `internal: true` never reaches a client, full stop. */
export function isCommentVisibleTo(comment: ReportComment, audience: ReportAudience): boolean {
  if (audience.kind === 'client' || audience.kind === 'link') {
    if (comment.internal) return false;
    // A client only sees the thread of their OWN report; the caller already scoped
    // the query by reportId, and the report itself is customer-scoped.
    return true;
  }
  return true;
}

/** A KPI value is client-facing only when the definition says so. */
export function isKpiValueVisibleTo(kpi: ReportKpiValue, audience: ReportAudience): boolean {
  if (audience.kind === 'client' || audience.kind === 'link') return kpi.clientVisible === true;
  if (kpi.financial && audience.canViewFinancial === false) return false;
  return true;
}

export interface RedactOptions {
  /** Redact for the PDF pipeline: also drop blocks with `inPdf === false`. */
  target?: 'screen' | 'pdf' | 'portal';
  /** Drop AI-suggested blocks that no human approved yet (publish guard). */
  dropUnapprovedAi?: boolean;
}

/**
 * Return a copy of `report` containing only what `audience` may see.
 *
 * Subtractive and non-mutating: blocks, KPI values and attachments are all
 * filtered in one pass, and block `order` is re-normalised so a redacted report
 * renders without gaps.
 */
export function redactForAudience(
  report: Report,
  audience: ReportAudience,
  opts: RedactOptions = {},
): Report {
  const target = opts.target ?? 'screen';

  const blocks = (report.blocks || [])
    .filter(b => isBlockVisibleTo(b, audience))
    .filter(b => (target === 'pdf' ? b.inPdf !== false : true))
    .filter(b => (target === 'portal' ? b.inPortal !== false : true))
    .filter(b => !(opts.dropUnapprovedAi && b.aiSuggested && !b.aiApprovedByUserId))
    // `custom-html` is admin-authored raw markup. Keep it out of client outputs
    // entirely — a client-visible HTML block would bypass the sanitiser the rest
    // of the renderer relies on.
    .filter(b => !(b.type === 'custom-html' && (audience.kind === 'client' || audience.kind === 'link')))
    .map(b => ({
      ...b,
      attachments: (b.attachments || []).filter(a => isAttachmentVisibleTo(a, audience)),
    }))
    .sort((a, b) => a.order - b.order)
    .map((b, i) => ({ ...b, order: i }));

  const kpiValues = (report.kpiValues || []).filter(k => isKpiValueVisibleTo(k, audience));

  const redacted: Report = { ...report, blocks, kpiValues };

  // Internal-only report metadata that must not travel with a client payload.
  if (audience.kind === 'client' || audience.kind === 'link') {
    delete (redacted as any).healthOverrideReason;
    delete (redacted as any).suggestedHealth;
    delete (redacted as any).suggestedHealthReasons;
    delete (redacted as any).qualityScore;
    delete (redacted as any).reviewerUserId;
    delete (redacted as any).approverUserId;
    delete (redacted as any).subjectUserId;
    delete (redacted as any).department;
    delete (redacted as any).remindersSent;
    delete (redacted as any).escalationsSent;
    delete (redacted as any).markedMissingAt;
    delete (redacted as any).generationKey;
    delete (redacted as any).scheduleId;
    delete (redacted as any).tags;
  }

  return redacted;
}

/**
 * The single entry point for every client-facing render: portal, PDF, email.
 * Prefer this over `redactForAudience` so client paths cannot accidentally pass a
 * staff audience.
 */
export function redactForClient(
  report: Report,
  customerId: string,
  contactId?: string | null,
  opts: Omit<RedactOptions, 'target'> & { target?: 'pdf' | 'portal' } = {},
): Report {
  return redactForAudience(report, clientAudience(customerId, contactId), {
    ...opts,
    target: opts.target ?? 'portal',
    dropUnapprovedAi: opts.dropUnapprovedAi ?? true,
  });
}

/**
 * Assertion used by the tests and by the publish path: a payload about to be
 * handed to a client must contain nothing internal. Returns the offending items
 * instead of throwing, so callers can log precisely what would have leaked.
 */
export function findClientLeaks(payload: Report): string[] {
  const leaks: string[] = [];
  for (const b of payload.blocks || []) {
    if (!CLIENT_VISIBILITIES.has(b.visibility)) leaks.push(`block:${b.id}:${b.visibility}`);
    if (b.type === 'custom-html') leaks.push(`block:${b.id}:custom-html`);
    if (b.inPortal === false) leaks.push(`block:${b.id}:inPortal=false`);
    if (b.aiSuggested && !b.aiApprovedByUserId) leaks.push(`block:${b.id}:unapproved-ai`);
    for (const a of b.attachments || []) {
      if (!CLIENT_VISIBILITIES.has(a.visibility)) leaks.push(`attachment:${a.id}:${a.visibility}`);
    }
  }
  for (const k of payload.kpiValues || []) {
    if (k.clientVisible !== true) leaks.push(`kpi:${k.kpiId}`);
  }
  for (const field of ['healthOverrideReason', 'qualityScore', 'suggestedHealth', 'subjectUserId'] as const) {
    if ((payload as any)[field] !== undefined) leaks.push(`field:${field}`);
  }
  return leaks;
}

/** Throwing variant, used on the publish/send path as a last line of defence. */
export function assertNoClientLeak(payload: Report): void {
  const leaks = findClientLeaks(payload);
  if (leaks.length) {
    throw new Error(`Përmbajtje e brendshme në raportin për klientin: ${leaks.join(', ')}`);
  }
}

/** Does the report have ANY content a client could see? Guards useless publishes. */
export function hasClientContent(report: Report): boolean {
  return (report.blocks || []).some(b => CLIENT_VISIBILITIES.has(b.visibility) && b.inPortal !== false);
}

/** Count of blocks per audience side — powers the "3 të brendshme / 8 për klientin" chip. */
export function countByAudience(report: Report): { internal: number; client: number } {
  let internal = 0;
  let client = 0;
  for (const b of report.blocks || []) {
    if (CLIENT_VISIBILITIES.has(b.visibility)) client++;
    else internal++;
  }
  return { internal, client };
}
