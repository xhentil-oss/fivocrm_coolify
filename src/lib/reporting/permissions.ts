/**
 * Reporting capabilities — one place that turns "who is this user" into "what may
 * they do to THIS report".
 *
 * Two layers, deliberately:
 *
 *   1. **Coarse role capabilities** (`reportingCapabilitiesFor`) live on
 *      `UserPermissions` as seven optional flags, defaulted per role and
 *      overridable per team member. They answer "may this person review at all?".
 *
 *   2. **Per-report authority** (`reportActor`, `reportAudience`) combines those
 *      flags with the user's RELATIONSHIP to one report (author? reviewer? the
 *      account manager?) and hands the result to `workflow.canTransition()` and
 *      `visibility.redactForAudience()`.
 *
 * Keeping (2) out of the flags is what avoids a permission explosion: the spec's
 * long list ("edit own draft", "submit own", "view department reports") are all
 * (coarse flag × relationship), not 25 independent switches.
 *
 * The same functions run on the server (api/_reports.ts) against claims-derived
 * membership, so the UI and the endpoint can never disagree.
 */

import type { Report } from '../../types';
import type { ReportAudience } from './visibility';
import type { TransitionActor } from './workflow';

/** The seven coarse reporting capabilities. All optional — legacy records default. */
export interface ReportingCapabilities {
  /** Module access: see the Raportimi section and file your own reports. */
  canAccessReports: boolean;
  /** Review a submitted report and request changes. */
  canReviewReports?: boolean;
  /** Give the internal approval that unlocks publishing. */
  canApproveReports?: boolean;
  /** Publish to the client portal and send by email. */
  canPublishReports?: boolean;
  /** See other people's reports, not just your own and those you review. */
  canViewAllReports?: boolean;
  /** Read `management`-visibility blocks (internal risks, evaluations, margins). */
  canViewConfidentialReports?: boolean;
  /** Manage templates, KPI definitions and schedules. */
  canManageReportTemplates?: boolean;
  /** Read KPI values flagged `financial` (margin, CAC, pipeline value). */
  canViewFinancialMetrics?: boolean;
}

/** What a team-member record may carry to override the role defaults. */
export type ReportingOverrides = Partial<ReportingCapabilities>;

/**
 * Role defaults.
 *
 * `canAccessReports` is TRUE for every internal role: everyone files a daily and
 * weekly report — that is the point of the accountability half of the module. What
 * escalates by role is reviewing, approving, publishing and seeing other people's
 * data. `Guest` (an external collaborator on one project) is the only internal-ish
 * role with no reporting access at all.
 */
const ROLE_DEFAULTS: Record<string, ReportingCapabilities> = {
  Owner: {
    canAccessReports: true, canReviewReports: true, canApproveReports: true,
    canPublishReports: true, canViewAllReports: true, canViewConfidentialReports: true,
    canManageReportTemplates: true, canViewFinancialMetrics: true,
  },
  Admin: {
    canAccessReports: true, canReviewReports: true, canApproveReports: true,
    canPublishReports: true, canViewAllReports: true, canViewConfidentialReports: true,
    canManageReportTemplates: true, canViewFinancialMetrics: true,
  },
  Manager: {
    canAccessReports: true, canReviewReports: true, canApproveReports: true,
    canPublishReports: true, canViewAllReports: true, canViewConfidentialReports: true,
    canManageReportTemplates: true, canViewFinancialMetrics: false,
  },
  // Sales owns client relationships: they build and send client reports, but they
  // are not the internal approver of their own work (separation of duties), and
  // they do not read colleagues' accountability data.
  Sales: {
    canAccessReports: true, canReviewReports: false, canApproveReports: false,
    canPublishReports: true, canViewAllReports: false, canViewConfidentialReports: false,
    canManageReportTemplates: false, canViewFinancialMetrics: false,
  },
  SalesAgent: {
    canAccessReports: true, canReviewReports: false, canApproveReports: false,
    canPublishReports: false, canViewAllReports: false, canViewConfidentialReports: false,
    canManageReportTemplates: false, canViewFinancialMetrics: false,
  },
  Member: {
    canAccessReports: true, canReviewReports: false, canApproveReports: false,
    canPublishReports: false, canViewAllReports: false, canViewConfidentialReports: false,
    canManageReportTemplates: false, canViewFinancialMetrics: false,
  },
  Viewer: {
    canAccessReports: true, canReviewReports: false, canApproveReports: false,
    canPublishReports: false, canViewAllReports: false, canViewConfidentialReports: false,
    canManageReportTemplates: false, canViewFinancialMetrics: false,
  },
  Guest: {
    canAccessReports: false, canReviewReports: false, canApproveReports: false,
    canPublishReports: false, canViewAllReports: false, canViewConfidentialReports: false,
    canManageReportTemplates: false, canViewFinancialMetrics: false,
  },
};

export const NO_REPORTING_CAPABILITIES: ReportingCapabilities = ROLE_DEFAULTS.Guest;

/**
 * Resolve capabilities for a role, with per-member overrides layered on top.
 *
 * An override may only ever be an explicit `true`/`false` on the member record —
 * `undefined` falls through to the role default, so adding a capability later
 * cannot silently revoke it for existing members.
 */
export function reportingCapabilitiesFor(
  role: string | null | undefined,
  overrides: ReportingOverrides = {},
): ReportingCapabilities {
  const base = ROLE_DEFAULTS[role || ''] || ROLE_DEFAULTS.Member;
  const out: ReportingCapabilities = { ...base };
  for (const key of Object.keys(base) as Array<keyof ReportingCapabilities>) {
    const override = overrides[key];
    if (typeof override === 'boolean') out[key] = override;
  }
  return out;
}

/** Labels for the role-template checkboxes in Cilësimet / Ekipet. */
export const REPORTING_CAPABILITY_LABELS: Array<{ key: keyof ReportingCapabilities; label: string; hint: string }> = [
  { key: 'canAccessReports', label: 'Raportimi', hint: 'Hyrje në modulin e raportimit; dorëzon raportet e vetes.' },
  { key: 'canReviewReports', label: 'Shqyrto raporte', hint: 'Shqyrton raportet e dorëzuara dhe kërkon ndryshime.' },
  { key: 'canApproveReports', label: 'Aprovo brenda', hint: 'Aprovimi i brendshëm që hap publikimin.' },
  { key: 'canPublishReports', label: 'Publiko & dërgo', hint: 'Publikon në portal dhe dërgon me email tek klienti.' },
  { key: 'canViewAllReports', label: 'Shiko të gjitha raportet', hint: 'Përndryshe shihen vetëm raportet e vetes.' },
  { key: 'canViewConfidentialReports', label: 'Seksione konfidenciale', hint: 'Rreziqe të brendshme, vlerësime, shënime menaxhimi.' },
  { key: 'canManageReportTemplates', label: 'Menaxho template & KPI', hint: 'Template-t, KPI-të dhe planifikimet automatike.' },
  { key: 'canViewFinancialMetrics', label: 'Metrika financiare', hint: 'Marzhi, CAC, vlera e pipeline-it.' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Per-report authority
// ─────────────────────────────────────────────────────────────────────────────

/** The identity bits the two builders need, independent of hook or server. */
export interface ReportViewer {
  userId: string | null;
  role?: string | null;
  /** Team role strings, for `custom_roles` blocks. */
  roles?: string[];
  department?: string | null;
  /** Admin / Owner / Manager. */
  isManagement?: boolean;
  capabilities: ReportingCapabilities;
}

/** Is this viewer related to the report as author / reviewer / approver / AM / PM? */
export function reportRelationship(report: Partial<Report>, viewer: ReportViewer) {
  const uid = viewer.userId;
  return {
    isAuthor: !!uid && report.authorUserId === uid,
    isReviewer: !!uid && report.reviewerUserId === uid,
    isApprover: !!uid && report.approverUserId === uid,
    isAccountManager: !!uid && report.accountManagerUserId === uid,
    isProjectManager: !!uid && report.projectManagerUserId === uid,
    // "Team leader" is modelled as the report's reviewer, plus anyone in management.
    isTeamLeader: (!!uid && report.reviewerUserId === uid) || viewer.isManagement === true,
    /** The report is ABOUT this person (weekly-staff). */
    isSubject: !!uid && report.subjectUserId === uid,
  };
}

/** Build the actor the workflow state machine expects. */
export function reportActor(report: Partial<Report>, viewer: ReportViewer): TransitionActor {
  const rel = reportRelationship(report, viewer);
  const c = viewer.capabilities;
  return {
    kind: 'staff',
    userId: viewer.userId,
    isAuthor: rel.isAuthor,
    isReviewer: rel.isReviewer,
    isApprover: rel.isApprover,
    isManagement: viewer.isManagement === true,
    canReview: c.canReviewReports === true,
    canApproveInternal: c.canApproveReports === true,
    canPublish: c.canPublishReports === true,
    canSend: c.canPublishReports === true,
    canArchive: c.canApproveReports === true || viewer.isManagement === true,
    canDelete: viewer.isManagement === true,
  };
}

/** Build the audience the visibility engine expects. */
export function reportAudience(report: Partial<Report>, viewer: ReportViewer): ReportAudience {
  const rel = reportRelationship(report, viewer);
  const c = viewer.capabilities;
  return {
    kind: 'staff',
    userId: viewer.userId,
    roles: viewer.roles,
    department: viewer.department ?? null,
    isAuthor: rel.isAuthor,
    isReviewer: rel.isReviewer,
    isApprover: rel.isApprover,
    isAccountManager: rel.isAccountManager,
    isProjectManager: rel.isProjectManager,
    isTeamLeader: rel.isTeamLeader,
    isManagement: viewer.isManagement === true,
    canViewConfidential: c.canViewConfidentialReports === true,
    canViewFinancial: c.canViewFinancialMetrics === true,
  };
}

/**
 * May this viewer see the report AT ALL (before block-level redaction)?
 *
 * Mirrors the list query: everyone sees their own reports and the ones they are
 * asked to review/approve or own the account for; `canViewAllReports` widens that
 * to the whole tenant. A report a viewer cannot list, they cannot open.
 */
export function canSeeReport(report: Partial<Report>, viewer: ReportViewer): boolean {
  if (!viewer.capabilities.canAccessReports) return false;
  if (viewer.capabilities.canViewAllReports) return true;
  if (viewer.isManagement) return true;
  const rel = reportRelationship(report, viewer);
  return rel.isAuthor || rel.isReviewer || rel.isApprover
    || rel.isAccountManager || rel.isProjectManager || rel.isSubject;
}

/** Filter a fetched list down to what the viewer may see. */
export function visibleReports<T extends Partial<Report>>(reports: T[], viewer: ReportViewer): T[] {
  // No module access → nothing, regardless of the wider flags.
  if (!viewer.capabilities.canAccessReports) return [];
  if (viewer.capabilities.canViewAllReports || viewer.isManagement) return reports;
  return reports.filter(r => canSeeReport(r, viewer));
}

/**
 * May this viewer read another person's accountability data? Employee metrics are
 * confidential employee information — self, or a manager, and nobody else.
 */
export function canSeeEmployeeMetrics(subjectUserId: string, viewer: ReportViewer): boolean {
  if (!viewer.capabilities.canAccessReports) return false;
  if (viewer.userId === subjectUserId) return true;
  return viewer.isManagement === true || viewer.capabilities.canViewAllReports === true;
}
