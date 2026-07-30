/**
 * ENTERPRISE REPORTING & ACCOUNTABILITY — domain types.
 *
 * Re-exported from `src/types/index.ts`, so consumers keep importing from
 * `'../types'` like every other entity. Split into its own file only because the
 * barrel is already ~1700 lines.
 *
 * Two stores, on purpose:
 *
 *   • `dailyReports` (pre-existing) stays the DAILY STAFF submission — one doc per
 *     user per day, department-specific fields, already wired into StaffDashboard,
 *     DailyReportPopup and the Momentum engine. It is EXTENDED (see
 *     `DailyReportAccountability` below, merged into `DailyReport`) rather than
 *     replaced, so nothing that reads it breaks.
 *
 *   • `reports` (new) is the RICH, VERSIONED, BLOCK-BASED document behind weekly /
 *     monthly / quarterly, project-status and client-facing reports. It carries a
 *     workflow, per-block visibility, approvals, publication and PDF/portal
 *     delivery. Daily reports FEED it (aggregation) — they are not duplicated by it.
 *
 * Firestore is document-oriented, so a report's blocks live INSIDE the report doc
 * (one read renders a whole report, no N+1). Everything that must be immutable or
 * append-only — versions, approvals, the audit/event trail — lives in its own
 * collection. Full ERD: `workspace/REPORTING_MODULE.md`.
 */

/** What kind of report this is. Drives default template, period and workflow. */
export type ReportKind =
  | 'weekly-staff'          // employee weekly summary (internal)
  | 'project-status'        // weekly client/project status (internal or client-facing)
  | 'client-monthly'        // the official monthly client performance report
  | 'qbr'                   // quarterly business review
  | 'project-completion'
  | 'campaign-completion'
  | 'website-launch'
  | 'incident'
  | 'client-risk'
  | 'custom';

/** Reporting cadence. `ad-hoc` reports have an explicit period only. */
export type ReportFrequency = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'ad-hoc';

/**
 * Report lifecycle. Transitions are NOT free-form — `src/lib/reporting/workflow.ts`
 * owns the state machine and every guard (internal approval before publish,
 * separation of duties, re-approval after editing a published report).
 */
export type ReportStatus =
  | 'draft'
  | 'in_progress'
  | 'submitted'
  | 'under_review'
  | 'changes_requested'
  | 'internally_approved'
  | 'scheduled'
  | 'published'
  | 'sent'
  | 'viewed'
  | 'acknowledged'
  | 'client_approved'
  | 'client_rejected'
  | 'archived'
  | 'cancelled';

/**
 * Who may see a block. `client` and `client_contacts` are the ONLY values that ever
 * cross the tenant→client boundary; everything else is internal by construction.
 * The single authority is `isBlockVisibleTo()` / `redactForAudience()`.
 */
export type ReportVisibility =
  | 'author'
  | 'internal'
  | 'department'
  | 'team_leader'
  | 'project_manager'
  | 'account_manager'
  | 'management'
  | 'client'
  | 'client_contacts'
  | 'custom_roles';

/** RAG project/report health. `blue` = completed, `grey` = paused/waiting. */
export type ReportHealth = 'green' | 'yellow' | 'red' | 'blue' | 'grey';

/** Agency service lines a report (or KPI) can be attributed to. */
export type ReportService =
  | 'seo' | 'web' | 'social' | 'ads' | 'marketing' | 'content'
  | 'design' | 'photo-video' | 'maintenance' | 'hosting' | 'other';

export type ReportBlockType =
  | 'title' | 'subtitle' | 'rich-text' | 'executive-summary'
  | 'kpi-cards' | 'comparison-cards' | 'goal-vs-actual' | 'progress'
  | 'table' | 'chart' | 'funnel'
  | 'work-completed' | 'task-list' | 'milestone-list' | 'timeline'
  | 'risk-register' | 'blocker-list' | 'recommendation' | 'next-steps'
  | 'client-action'
  | 'image' | 'gallery' | 'video-link' | 'attachment'
  | 'approval' | 'signature'
  | 'custom-html'
  | 'page-break';

/** Where a block's numbers come from. `auto:*` blocks are refreshed from the CRM. */
export type ReportBlockSource =
  | 'manual'
  | 'auto:tasks'
  | 'auto:milestones'
  | 'auto:time-entries'
  | 'auto:daily-reports'
  | 'auto:blockers'
  | 'auto:budget'
  | 'auto:kpis'
  | 'auto:social'
  | 'auto:invoices';

export interface ReportAttachment {
  id: string;
  name: string;
  url: string;
  contentType?: string;
  size?: number;
  /** Confidential attachments are stripped from every client-facing output. */
  visibility: ReportVisibility;
  uploadedByUserId?: string | null;
  uploadedAt?: Date;
}

export interface ReportTableColumn {
  key: string;
  label: string;
  /** Number formatting hint; `currency` respects the report currency. */
  format?: 'text' | 'number' | 'percent' | 'currency' | 'hours' | 'date';
  align?: 'left' | 'right' | 'center';
}

/** One block of a report. Blocks are ordered and individually visibility-scoped. */
export interface ReportBlock {
  id: string;
  type: ReportBlockType;
  title?: string;
  description?: string;
  order: number;
  visibility: ReportVisibility;
  /** Roles allowed when `visibility === 'custom_roles'`. */
  visibleRoles?: string[];
  /** Customer contact ids allowed when `visibility === 'client_contacts'`. */
  visibleContactIds?: string[];
  /** Template-required: the author must fill it (quality check), can't delete it. */
  required?: boolean;
  /** Template-locked blocks cannot be removed or re-typed. */
  locked?: boolean;
  /** Per-output overrides (default: included in both). */
  inPdf?: boolean;
  inPortal?: boolean;

  // ── payload (only the fields relevant to `type` are used) ──
  text?: string;
  kpiIds?: string[];
  columns?: ReportTableColumn[];
  rows?: Array<Record<string, string | number | null>>;
  items?: string[];
  chart?: 'line' | 'bar' | 'area' | 'pie' | 'doughnut';
  progress?: number;                     // 0–100
  attachments?: ReportAttachment[];
  html?: string;                         // `custom-html`, admins only
  url?: string;                          // `video-link` / `image`

  source?: ReportBlockSource;
  dateRange?: { from?: string; to?: string };
  comparePeriod?: 'previous' | 'year-ago' | 'none';
  /** Hide the block automatically when its data is missing / at target. */
  conditional?: { kpiId?: string; when: 'missing' | 'below-target' | 'above-target' };
  /** AI-drafted content must be flagged and human-approved before publication. */
  aiSuggested?: boolean;
  aiApprovedByUserId?: string | null;
  settings?: Record<string, any>;
}

export type ReportKpiUnit = 'number' | 'percent' | 'currency' | 'hours' | 'days' | 'score' | 'ratio';

/** A metric value carried by a report, snapshotted so history never rewrites. */
export interface ReportKpiValue {
  kpiId: string;
  /** Denormalised so a historical report renders without the KPI definition. */
  label: string;
  unit: ReportKpiUnit;
  value: number | null;
  previousValue?: number | null;
  target?: number | null;
  higherIsBetter?: boolean;
  decimals?: number;
  currency?: string;
  /** Financial values are additionally permission-gated on render. */
  financial?: boolean;
  /** Client-visible KPIs may appear in client-facing blocks; others never do. */
  clientVisible?: boolean;
  /** Where the number came from — manual entry or a synced provider id. */
  origin?: 'manual' | string;
  syncedAt?: Date;
  note?: string;
}

/** Reporting period, normalised so comparisons and schedules are deterministic. */
export interface ReportPeriod {
  frequency: ReportFrequency;
  /** Canonical key: `2026-07-30` | `2026-W31` | `2026-07` | `2026-Q3`. */
  key: string;
  /** Inclusive ISO dates (YYYY-MM-DD) — always present, also for ad-hoc. */
  start: string;
  end: string;
  /** IANA zone the client's period is expressed in (defaults to Europe/Tirane). */
  timezone?: string;
}

/**
 * The report document (`reports`). Tenant key is `businessId`; `teamId` is the
 * owning department. Blocks live inline; immutable history lives in
 * `reportVersions` / `reportApprovals` / `reportEvents`.
 */
export interface Report {
  id: string;
  businessId: string;
  teamId?: string;

  kind: ReportKind;
  title: string;
  status: ReportStatus;
  period: ReportPeriod;
  service?: ReportService;

  // ── subject ──
  customerId?: string;
  customerName?: string;
  projectId?: string;
  projectName?: string;
  /** The staff member the report is ABOUT (weekly-staff reports). */
  subjectUserId?: string;
  department?: string;

  // ── people ──
  authorUserId: string;
  reviewerUserId?: string | null;
  approverUserId?: string | null;
  accountManagerUserId?: string | null;
  projectManagerUserId?: string | null;

  // ── content ──
  blocks: ReportBlock[];
  kpiValues?: ReportKpiValue[];
  currency?: string;

  // ── health ──
  health?: ReportHealth;
  /** System-suggested RAG + the factors behind it (never shown unexplained). */
  suggestedHealth?: ReportHealth;
  suggestedHealthReasons?: string[];
  healthOverrideReason?: string;
  progressPercent?: number;

  // ── template provenance (editing a template must not rewrite history) ──
  templateId?: string;
  templateKey?: string;
  templateVersion?: number;

  // ── workflow / versioning ──
  version: number;
  /** Version the client approved — sign-off always references an exact version. */
  clientApprovedVersion?: number;
  /** True while a published report has unpublished edits (needs re-approval). */
  hasUnpublishedChanges?: boolean;
  dueAt?: Date;
  submittedAt?: Date;
  reviewedAt?: Date;
  internallyApprovedAt?: Date;
  scheduledPublishAt?: Date;
  publishedAt?: Date;
  sentAt?: Date;
  firstViewedAt?: Date;
  lastViewedAt?: Date;
  viewCount?: number;
  acknowledgedAt?: Date;
  clientDecisionAt?: Date;
  clientDecisionByUserId?: string | null;
  archivedAt?: Date;

  /** Soft delete — reports tied to financial/legal records are never hard-deleted. */
  deletedAt?: Date | null;
  deletedByUserId?: string | null;
  /** Blocks hard deletion (invoice/contract linkage, client sign-off). */
  legalHold?: boolean;

  /** Cached quality score (recomputed on save; never blocks submission). */
  qualityScore?: number;
  /** Idempotency key for scheduled generation: `${scheduleId}:${period.key}`. */
  generationKey?: string;
  scheduleId?: string;
  tags?: string[];
  /** Escalation bookkeeping so a rung never fires twice. */
  remindersSent?: number[];
  escalationsSent?: number[];
  markedMissingAt?: Date;

  createdAt: Date;
  updatedAt: Date;
  createdByUserId?: string | null;
  /** Optimistic-locking guard for concurrent editing. */
  revision?: number;
}

/** Immutable snapshot of a report at a point in its life (`reportVersions`). */
export interface ReportVersion {
  id: string;
  businessId: string;
  reportId: string;
  /** Denormalised report customer, so the rules can authorise a portal read. */
  customerId?: string | null;
  version: number;
  /**
   * Why the snapshot was taken. Only `published` snapshots are readable by a
   * client — that is the exact artefact their sign-off refers to.
   */
  reason: 'submitted' | 'published' | 'manual' | 'reopened';
  title: string;
  status: ReportStatus;
  period: ReportPeriod;
  blocks: ReportBlock[];
  kpiValues?: ReportKpiValue[];
  health?: ReportHealth;
  templateKey?: string;
  templateVersion?: number;
  /** Storage path of the PDF rendered for THIS version, when one exists. */
  pdfPath?: string;
  createdAt: Date;
  createdByUserId?: string | null;
}

/** A reusable report template (`reportTemplates`). */
export interface ReportTemplate {
  id: string;
  businessId: string;
  teamId?: string;
  /** Stable key shared across versions, e.g. `monthly-seo`. */
  key: string;
  name: string;
  description?: string;
  kind: ReportKind;
  frequency: ReportFrequency;
  service?: ReportService;
  version: number;
  blocks: ReportBlock[];
  /** Assignment filters — which reports default to this template. */
  appliesToDepartments?: string[];
  appliesToCustomerIds?: string[];
  appliesToProjectTypes?: string[];
  isDefault?: boolean;
  /** Seeded system templates are read-only until duplicated. */
  isSystem?: boolean;
  archivedAt?: Date | null;
  usageCount?: number;
  createdAt: Date;
  updatedAt: Date;
  createdByUserId?: string | null;
}

/** Threaded comment on a report (`reportComments`). */
export interface ReportComment {
  id: string;
  businessId: string;
  reportId: string;
  /**
   * The report's customer, denormalised onto every comment.
   *
   * Firestore rules cannot follow a reference, so without this a client-visible
   * comment could only be authorised by reading the parent report — one extra
   * get() per comment, and no way to express it as a single narrowed query. With
   * it, "a client reads non-internal comments on their own report" is one clause.
   */
  customerId?: string | null;
  /** Root comment id for a reply, else null. */
  parentId?: string | null;
  /** Optional anchor to a specific block. */
  blockId?: string | null;
  body: string;
  /** TRUE = never leaves the agency. The portal query filters on this field. */
  internal: boolean;
  authorUserId: string;
  authorName?: string;
  /** Set when the comment was written by a portal client. */
  authorCustomerId?: string | null;
  mentionUserIds?: string[];
  assignedToUserId?: string | null;
  resolvedAt?: Date | null;
  resolvedByUserId?: string | null;
  editedAt?: Date | null;
  attachments?: ReportAttachment[];
  createdAt: Date;
  updatedAt: Date;
  createdByUserId?: string | null;
}

export type ReportApprovalDecision =
  | 'approved' | 'changes_requested' | 'rejected' | 'acknowledged' | 'delegated';

export type ReportApprovalStage =
  | 'team_leader' | 'department_manager' | 'account_manager' | 'management' | 'client';

/** An approval/sign-off record (`reportApprovals`). Append-only. */
export interface ReportApproval {
  id: string;
  businessId: string;
  reportId: string;
  /** The exact version the decision applies to. */
  version: number;
  /** Position in the configured chain (0-based). */
  step: number;
  stage: ReportApprovalStage;
  decision: ReportApprovalDecision;
  approverUserId: string;
  approverName?: string;
  /** Set when the approver is a portal client. */
  approverCustomerId?: string | null;
  comment?: string;
  delegatedToUserId?: string | null;
  signatureDataUrl?: string;
  ip?: string | null;
  userAgent?: string | null;
  createdAt: Date;
  createdByUserId?: string | null;
}

export type ReportEventKind =
  | 'created' | 'updated' | 'block-added' | 'block-removed' | 'block-reordered'
  | 'visibility-changed' | 'status-changed' | 'submitted' | 'changes-requested'
  | 'approved' | 'published' | 'unpublished' | 'viewed' | 'pdf-downloaded'
  | 'emailed' | 'email-failed' | 'client-acknowledged' | 'client-approved'
  | 'client-rejected' | 'commented' | 'archived' | 'restored' | 'deleted'
  | 'generated' | 'generation-failed' | 'reminded' | 'escalated'
  | 'ai-suggested' | 'sync-failed';

/**
 * Append-only report event stream (`reportEvents`) — status history, audit trail,
 * views and delivery log in ONE collection.
 *
 * The spec models these as five tables. On Firestore a single discriminated stream
 * is the safer enterprise choice: one composite index serves the whole timeline,
 * "who did what when" is a single query, and there is no chance of a partial audit
 * trail because a writer forgot one of five collections.
 */
export interface ReportEvent {
  id: string;
  businessId: string;
  reportId: string;
  kind: ReportEventKind;
  /** Version in force when the event happened. */
  version?: number;
  actorUserId?: string | null;
  actorName?: string;
  /** Set when the actor is a portal client (never a staff uid). */
  actorCustomerId?: string | null;
  actorType: 'staff' | 'client' | 'system';
  field?: string;
  fromValue?: string | number | null;
  toValue?: string | number | null;
  reason?: string;
  comment?: string;
  /** Recorded for legally meaningful actions only (approve/ack/view/download). */
  ip?: string | null;
  userAgent?: string | null;
  customerId?: string | null;
  projectId?: string | null;
  meta?: Record<string, any>;
  createdAt: Date;
  createdByUserId?: string | null;
}

/** A delivery recipient snapshot, embedded in the `emailed` event's meta. */
export interface ReportRecipient {
  email: string;
  name?: string;
  role: 'to' | 'cc' | 'bcc';
  contactId?: string;
}

/** One rung of an escalation ladder. */
export interface ReportEscalationRule {
  /** Minutes after the due moment (0 = at the deadline). */
  afterMinutes: number;
  /** Who gets told. Roles resolve against the tenant's team roles. */
  notify: 'author' | 'reviewer' | 'approver' | 'team_leader' | 'department_manager'
    | 'account_manager' | 'project_manager' | 'management';
  /** Also mark the report as missing at this rung. */
  markMissing?: boolean;
  channel?: 'in-app' | 'email' | 'both';
}

/** Report automation (`reportSchedules`). */
export interface ReportSchedule {
  id: string;
  businessId: string;
  teamId?: string;
  name: string;
  active: boolean;
  kind: ReportKind;
  frequency: ReportFrequency;
  templateId?: string;
  templateKey?: string;
  service?: ReportService;

  // ── target ──
  customerId?: string;
  customerName?: string;
  projectId?: string;
  projectName?: string;
  department?: string;
  /** Generate one report per member of this department (weekly-staff). */
  perDepartmentMember?: boolean;

  // ── people ──
  authorUserId?: string;
  reviewerUserId?: string | null;
  approverUserId?: string | null;

  // ── timing ──
  /** Local hour-of-day (0–23) the draft is generated. */
  hour: number;
  timezone?: string;
  /** Weekly: 1=Mon…7=Sun. */
  dayOfWeek?: number;
  /** Monthly/quarterly: day of month (1–28), or 0 = first working day. */
  dayOfMonth?: number;
  /** Only generate on these weekdays (daily cadence). 1=Mon…7=Sun. */
  workingDays?: number[];
  /** ISO dates skipped as holidays. */
  holidays?: string[];
  /** Days after period end when the report is due. */
  dueOffsetDays?: number;

  // ── automation ──
  prefillFromCrm?: boolean;
  notifyAuthor?: boolean;
  /** Days BEFORE the due date to remind (e.g. [5, 3, 1]). */
  reminderOffsetsDays?: number[];
  /** Escalation ladder applied once overdue. */
  escalation?: ReportEscalationRule[];
  autoPublishAfterApproval?: boolean;
  emailOnPublish?: boolean;
  generatePdfOnApproval?: boolean;
  archiveAfterDays?: number;
  recipients?: ReportRecipient[];

  lastRunAt?: Date;
  lastRunPeriodKey?: string;
  nextRunAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  createdByUserId?: string | null;
}

/** A target for a KPI, scoped as narrowly as the agency needs. */
export interface ReportKpiTarget {
  /** Narrowest matching scope wins: project > customer > service > global. */
  customerId?: string;
  projectId?: string;
  service?: ReportService;
  /** Period key the target applies to (`2026-07`, `2026-Q3`) or omitted = always. */
  periodKey?: string;
  value: number;
}

/** KPI definition (`reportKpis`). Targets live in `targets` keyed by scope. */
export interface ReportKpi {
  id: string;
  businessId: string;
  key: string;                 // stable slug, e.g. 'organic_users'
  name: string;
  description?: string;
  service?: ReportService;
  category?: string;
  unit: ReportKpiUnit;
  currency?: string;
  decimals?: number;
  /** Is a HIGHER number better? Drives RAG colouring and delta arrows. */
  higherIsBetter: boolean;
  /** Percent-of-target thresholds (0–1). Below warn → yellow, below critical → red. */
  warnAt?: number;
  criticalAt?: number;
  comparison?: 'previous' | 'year-ago' | 'target' | 'none';
  chart?: 'line' | 'bar' | 'area';
  source?: 'manual' | string;
  /** Client-visible KPIs may appear in client-facing blocks; others never do. */
  clientVisible: boolean;
  /** Financial KPIs additionally require the financial-metrics permission. */
  financial?: boolean;
  active: boolean;
  targets?: ReportKpiTarget[];
  createdAt: Date;
  updatedAt: Date;
  createdByUserId?: string | null;
}

/**
 * Actual metric values per subject+period (`reportMetrics`), independent of any
 * report. Dashboards and period-over-period comparison read from here, so deleting
 * or re-drafting a report never loses the underlying numbers.
 * Doc id convention: `${businessId}_${scopeKey}_${periodKey}`.
 */
export interface ReportMetricSet {
  id: string;
  businessId: string;
  customerId?: string;
  projectId?: string;
  service?: ReportService;
  periodKey: string;
  periodStart: string;
  periodEnd: string;
  /** kpiKey → value. Null means "collected but genuinely unknown". */
  values: Record<string, number | null>;
  /** kpiKey → provider that produced it ('manual' when typed in). */
  origins?: Record<string, string>;
  syncedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  createdByUserId?: string | null;
}

export interface ClientHealthFactor {
  key: string;
  label: string;
  /** Raw observation, e.g. "2 aprovime të vonuara". */
  detail?: string;
  /** Normalised 0–1 health for this factor. */
  score: number;
  /** Relative weight used in the blend. */
  weight: number;
  /** Points this factor added to / removed from the final score. */
  impact: number;
}

export type ClientHealthCategory =
  | 'excellent' | 'healthy' | 'attention' | 'at_risk' | 'critical' | 'paused';

/** Client health snapshot (`clientHealthScores`), one per customer per period. */
export interface ClientHealthScore {
  id: string;
  businessId: string;
  customerId: string;
  customerName?: string;
  periodKey: string;
  score: number;                       // 0–100
  category: ClientHealthCategory;
  /** Every contributing factor, so a score is never shown unexplained. */
  factors: ClientHealthFactor[];
  computedAt: Date;
  createdAt: Date;
  updatedAt: Date;
  createdByUserId?: string | null;
}

export interface EmployeeAccountabilityMetrics {
  expectedDailyReports: number;
  submittedDailyReports: number;
  missingDailyReports: number;
  lateDailyReports: number;
  submittedWeeklyReports: number;
  /** Mean minutes between the report deadline and actual submission. */
  avgSubmissionDelayMinutes: number | null;
  tasksCompleted: number;
  tasksOverdue: number;
  completionRate: number | null;      // 0–1
  hoursWorked: number;
  billableHours: number;
  nonBillableHours: number;
  utilisationRate: number | null;     // 0–1
  blockersReported: number;
  blockersUnresolved: number;
  avgBlockerResolutionHours: number | null;
  projectsAtRisk: number;
  reopenedTasks: number;
  missedDeadlines: number;
  approvalDelaysHours: number | null;
}

/** Employee accountability rollup (`employeeReportScores`), one per user per period. */
export interface EmployeeReportScore {
  id: string;
  businessId: string;
  userId: string;
  periodKey: string;
  metrics: EmployeeAccountabilityMetrics;
  /** Optional configurable composite. Never the whole story — see the UI warning. */
  compositeScore?: number;
  managerFeedback?: string;
  managerScore?: number;
  managerUserId?: string | null;
  computedAt: Date;
  createdAt: Date;
  updatedAt: Date;
  createdByUserId?: string | null;
}

/**
 * Accountability fields added to the EXISTING `dailyReports` document.
 *
 * `DailyReport` in the barrel intersects this, so every current reader keeps
 * working while the reporting module gets the structured data it needs. All
 * fields are optional — legacy docs are valid.
 */
export interface DailyReportAccountability {
  businessId?: string;
  /** Explicit daily status, distinct from the free-text `mood`. */
  dailyStatus?: 'on_track' | 'needs_attention' | 'blocked' | 'at_risk' | 'completed';
  workLocation?: 'office' | 'remote' | 'client_site' | 'field' | 'travel';
  workingStatus?: 'working' | 'partial' | 'leave' | 'sick' | 'holiday';
  /** Customers touched today (ids), alongside the existing `projectIds`. */
  customerIds?: string[];
  /** Tasks still in flight and planned next — the existing `openItems`/
   *  `planTomorrow` stay as the narrative version. */
  inProgressTaskIds?: string[];
  plannedTaskIds?: string[];
  helpNeeded?: string;
  risks?: string;
  clientDependencies?: string;
  internalDependencies?: string;
  billableHours?: number;
  nonBillableHours?: number;
  notes?: string;
  attachments?: ReportAttachment[];
  /** Set when the member pressed "submit" (vs. an autosaved draft). */
  submittedAt?: Date;
  /** The moment the report was due, for late/missing accounting. */
  dueAt?: Date;
  /** True when `submittedAt > dueAt`. Denormalised so dashboards don't recompute. */
  wasLate?: boolean;
  /** Manager review. */
  reviewedByUserId?: string | null;
  reviewedAt?: Date;
  managerFeedback?: string;
  /** Blocker lifecycle so "average resolution time" is measurable. */
  blockerResolvedAt?: Date;
  /** Created by the schedule generator rather than the member. */
  generatedBySystem?: boolean;
}
