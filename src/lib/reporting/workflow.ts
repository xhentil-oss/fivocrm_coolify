/**
 * Report lifecycle — the state machine and every business rule that guards it.
 *
 * Nothing in the UI decides whether a transition is legal: it asks
 * `canTransition()` and renders the answer. The server (api/_reports.ts) asks the
 * SAME function before writing, so an attacker calling the endpoint directly cannot
 * jump a report from `draft` straight to `published`.
 *
 * The rules encoded here are the ones from the module spec, §38:
 *   1. A client-facing report cannot be published before internal approval.
 *   3. A report cannot be approved by an unauthorised user.
 *   4. A user does not approve their own report when separation of duties is on.
 *   5/6. Publishing snapshots a version; editing a published report reopens a draft.
 *   9. Client approval always references an exact version.
 *   15. Historical values are never rewritten (enforced by version snapshots).
 */

import type { Report, ReportStatus } from '../../types';
import { hasClientContent } from './visibility';

/** Statuses from which no further work happens without an explicit restore. */
export const TERMINAL_STATUSES: ReadonlySet<ReportStatus> = new Set<ReportStatus>(['archived', 'cancelled']);

/** Statuses that mean "the client can see this". */
export const PUBLISHED_STATUSES: ReadonlySet<ReportStatus> = new Set<ReportStatus>([
  'published', 'sent', 'viewed', 'acknowledged', 'client_approved', 'client_rejected',
]);

/** Statuses where the author may still edit content freely. */
export const EDITABLE_STATUSES: ReadonlySet<ReportStatus> = new Set<ReportStatus>([
  'draft', 'in_progress', 'changes_requested',
]);

/** Statuses awaiting an internal decision. */
export const REVIEW_STATUSES: ReadonlySet<ReportStatus> = new Set<ReportStatus>([
  'submitted', 'under_review',
]);

export const STATUS_LABELS: Record<ReportStatus, string> = {
  draft: 'Draft',
  in_progress: 'Në punë',
  submitted: 'Dorëzuar',
  under_review: 'Në shqyrtim',
  changes_requested: 'Kërkohen ndryshime',
  internally_approved: 'Aprovuar brenda',
  scheduled: 'Planifikuar',
  published: 'Publikuar',
  sent: 'Dërguar klientit',
  viewed: 'Shikuar nga klienti',
  acknowledged: 'Konfirmuar nga klienti',
  client_approved: 'Aprovuar nga klienti',
  client_rejected: 'Refuzuar nga klienti',
  archived: 'Arkivuar',
  cancelled: 'Anuluar',
};

/** Badge tone, matching the tokens used elsewhere in the app. */
export const STATUS_TONE: Record<ReportStatus, 'neutral' | 'info' | 'warning' | 'success' | 'error'> = {
  draft: 'neutral',
  in_progress: 'info',
  submitted: 'info',
  under_review: 'info',
  changes_requested: 'warning',
  internally_approved: 'success',
  scheduled: 'info',
  published: 'success',
  sent: 'success',
  viewed: 'success',
  acknowledged: 'success',
  client_approved: 'success',
  client_rejected: 'error',
  archived: 'neutral',
  cancelled: 'neutral',
};

/**
 * Allowed edges. Anything not listed is rejected — the map is the whole contract.
 * `published → in_progress` is the "edit a published report" edge: it reopens a
 * draft and (per rule 6) requires re-approval before it can be published again.
 */
const TRANSITIONS: Record<ReportStatus, ReportStatus[]> = {
  draft: ['in_progress', 'submitted', 'cancelled', 'archived'],
  in_progress: ['draft', 'submitted', 'cancelled'],
  submitted: ['under_review', 'changes_requested', 'internally_approved', 'cancelled'],
  under_review: ['changes_requested', 'internally_approved', 'submitted', 'cancelled'],
  changes_requested: ['in_progress', 'submitted', 'cancelled'],
  internally_approved: ['scheduled', 'published', 'changes_requested', 'in_progress', 'archived'],
  scheduled: ['published', 'internally_approved', 'cancelled'],
  published: ['sent', 'viewed', 'acknowledged', 'client_approved', 'client_rejected', 'in_progress', 'archived'],
  sent: ['viewed', 'acknowledged', 'client_approved', 'client_rejected', 'in_progress', 'archived'],
  viewed: ['acknowledged', 'client_approved', 'client_rejected', 'in_progress', 'archived'],
  acknowledged: ['client_approved', 'client_rejected', 'in_progress', 'archived'],
  client_approved: ['archived', 'in_progress'],
  client_rejected: ['in_progress', 'changes_requested', 'archived'],
  archived: ['draft', 'internally_approved'],
  cancelled: ['draft'],
};

/** Permissions + identity the guards need. Mirrors `ReportPermissions` in the hook. */
export interface TransitionActor {
  kind: 'staff' | 'client' | 'system';
  userId?: string | null;
  customerId?: string | null;
  isAuthor?: boolean;
  isReviewer?: boolean;
  isApprover?: boolean;
  isManagement?: boolean;
  canReview?: boolean;
  canApproveInternal?: boolean;
  canPublish?: boolean;
  canSend?: boolean;
  canArchive?: boolean;
  canDelete?: boolean;
}

export interface TransitionContext {
  actor: TransitionActor;
  /** Tenant setting: an approver may not be the author. Default ON. */
  separationOfDuties?: boolean;
  /** Provided when the transition needs a reason (override/reject/changes). */
  reason?: string;
}

export interface TransitionResult {
  ok: boolean;
  /** Albanian, user-facing — surfaced directly in a toast. */
  reason?: string;
}

const DENY = (reason: string): TransitionResult => ({ ok: false, reason });
const ALLOW: TransitionResult = { ok: true };

/** Client-driven statuses — only a portal client (or the system) may set these. */
const CLIENT_DRIVEN: ReadonlySet<ReportStatus> = new Set<ReportStatus>([
  'viewed', 'acknowledged', 'client_approved', 'client_rejected',
]);

/**
 * The single authority on "may this happen?".
 *
 * Order matters: edge legality first (cheap, absolute), then who the actor is,
 * then the content preconditions. That way the message a user sees names the real
 * blocker instead of the first check that happened to run.
 */
export function canTransition(
  report: Pick<Report, 'status' | 'blocks' | 'authorUserId' | 'customerId' | 'kind' | 'legalHold'> & Partial<Report>,
  to: ReportStatus,
  ctx: TransitionContext,
): TransitionResult {
  const from = report.status;
  const { actor } = ctx;

  if (from === to) return DENY('Raporti është tashmë në këtë status.');
  if (!(TRANSITIONS[from] || []).includes(to)) {
    return DENY(`Kalimi "${STATUS_LABELS[from]}" → "${STATUS_LABELS[to]}" nuk lejohet.`);
  }

  // The system (cron/scheduler) is trusted for the transitions it owns.
  if (actor.kind === 'system') {
    const systemOwned: ReportStatus[] = ['published', 'sent', 'archived', 'submitted', 'draft'];
    if (!systemOwned.includes(to)) return DENY('Automatizimi nuk e kryen këtë veprim.');
    return contentGuards(report, to, ctx);
  }

  // ── Client-driven transitions ──
  if (CLIENT_DRIVEN.has(to)) {
    if (actor.kind !== 'client') {
      // Staff may record a client decision only when acting on the client's behalf
      // is explicitly meaningful — acknowledging/approving is not. Deny.
      return DENY('Vetëm klienti mund të kryejë këtë veprim.');
    }
    if (!PUBLISHED_STATUSES.has(from)) return DENY('Raporti nuk është publikuar për klientin.');
    if (!report.customerId || report.customerId !== actor.customerId) {
      return DENY('Raporti nuk i përket këtij klienti.');
    }
    if ((to === 'client_rejected' || to === 'client_approved') && to === 'client_rejected' && !ctx.reason?.trim()) {
      return DENY('Shkruani arsyen e refuzimit.');
    }
    return ALLOW;
  }

  if (actor.kind === 'client') return DENY('Klienti nuk mund të ndryshojë statusin e brendshëm.');

  // ── Staff transitions ──
  switch (to) {
    case 'submitted':
      if (!actor.isAuthor && !actor.isManagement) return DENY('Vetëm autori mund të dorëzojë raportin.');
      break;

    case 'under_review':
    case 'changes_requested':
      if (!actor.canReview && !actor.isReviewer && !actor.isManagement) {
        return DENY('Ju nuk kini të drejtë të shqyrtoni raporte.');
      }
      if (to === 'changes_requested' && !ctx.reason?.trim()) {
        return DENY('Shkruani çfarë duhet ndryshuar.');
      }
      break;

    case 'internally_approved': {
      if (from === 'archived') {
        if (!actor.canArchive && !actor.isManagement) return DENY('Ju nuk kini të drejtë të riaktivizoni raporte.');
        break;
      }
      if (!actor.canApproveInternal && !actor.isApprover && !actor.isManagement) {
        return DENY('Ju nuk kini të drejtë të aprovoni raporte.');
      }
      // Rule 4 — separation of duties.
      if (ctx.separationOfDuties !== false && actor.isAuthor && actor.userId === report.authorUserId) {
        return DENY('Ndarja e detyrave: autori nuk mund të aprovojë raportin e vetes.');
      }
      break;
    }

    case 'scheduled':
    case 'published':
      if (!actor.canPublish && !actor.isManagement) return DENY('Ju nuk kini të drejtë të publikoni raporte.');
      break;

    case 'sent':
      if (!actor.canSend && !actor.isManagement) return DENY('Ju nuk kini të drejtë të dërgoni raporte.');
      break;

    case 'archived':
      if (!actor.canArchive && !actor.isManagement) return DENY('Ju nuk kini të drejtë të arkivoni raporte.');
      break;

    case 'cancelled':
      if (!actor.isAuthor && !actor.isManagement) return DENY('Vetëm autori ose menaxhimi mund të anulojë raportin.');
      if (report.legalHold) return DENY('Raporti është nën mbajtje ligjore dhe nuk anulohet.');
      break;

    case 'in_progress':
    case 'draft':
      // Reopening a published report is an edit of client-visible content.
      if (PUBLISHED_STATUSES.has(from) && !actor.canPublish && !actor.isManagement && !actor.isAuthor) {
        return DENY('Ju nuk kini të drejtë të rihapni një raport të publikuar.');
      }
      break;

    default:
      break;
  }

  return contentGuards(report, to, ctx);
}

/** Content preconditions, shared by the staff and system paths. */
function contentGuards(
  report: Pick<Report, 'status' | 'blocks' | 'kind'> & Partial<Report>,
  to: ReportStatus,
  _ctx: TransitionContext,
): TransitionResult {
  if (to === 'submitted') {
    const missing = (report.blocks || []).filter(b => b.required && isBlockEmpty(b));
    if (missing.length) {
      return DENY(`Plotësoni fushat e detyrueshme: ${missing.map(b => b.title || b.type).join(', ')}`);
    }
  }

  if (to === 'published' || to === 'scheduled' || to === 'sent') {
    // Rule 1 — a client-facing report is never published before internal approval.
    // `published` may only be reached from `internally_approved` or `scheduled`
    // (already enforced by the edge map), so here we only check the payload.
    if (isClientFacingKind(report.kind as Report['kind']) && !hasClientContent(report as Report)) {
      return DENY('Raporti nuk ka asnjë seksion të dukshëm për klientin.');
    }
    const unapprovedAi = (report.blocks || []).filter(b => b.aiSuggested && !b.aiApprovedByUserId);
    if (unapprovedAi.length) {
      return DENY(`Aprovoni ose fshini përmbajtjen e sugjeruar nga AI (${unapprovedAi.length}) përpara publikimit.`);
    }
  }

  return ALLOW;
}

/** Report kinds that are delivered to a client by default. */
export function isClientFacingKind(kind: Report['kind']): boolean {
  return kind === 'client-monthly'
    || kind === 'qbr'
    || kind === 'project-status'
    || kind === 'project-completion'
    || kind === 'campaign-completion'
    || kind === 'website-launch';
}

/** Is a required block still unfilled? Type-aware so a chart isn't "empty". */
export function isBlockEmpty(block: Report['blocks'][number]): boolean {
  switch (block.type) {
    case 'title':
    case 'subtitle':
      return !block.title?.trim() && !block.text?.trim();
    case 'rich-text':
    case 'executive-summary':
    case 'recommendation':
    case 'next-steps':
    case 'client-action':
    case 'work-completed':
      return !block.text?.trim() && !(block.items || []).some(i => i.trim());
    case 'kpi-cards':
    case 'comparison-cards':
    case 'goal-vs-actual':
    case 'chart':
    case 'funnel':
      return (block.kpiIds || []).length === 0;
    case 'table':
      return (block.rows || []).length === 0;
    case 'task-list':
    case 'milestone-list':
    case 'timeline':
    case 'risk-register':
    case 'blocker-list':
      return (block.items || []).length === 0 && (block.rows || []).length === 0;
    case 'progress':
      return block.progress === undefined || block.progress === null;
    case 'image':
    case 'video-link':
      return !block.url?.trim();
    case 'gallery':
    case 'attachment':
      return (block.attachments || []).length === 0;
    case 'custom-html':
      return !block.html?.trim();
    case 'approval':
    case 'signature':
    case 'page-break':
      return false; // structural — nothing to fill
    default:
      return !block.text?.trim();
  }
}

/**
 * Field patch for a legal transition. Pure: returns what to write, so both the
 * client hook and the server endpoint produce identical documents.
 *
 * `now` is injected rather than read from the clock so the tests are deterministic.
 */
export function transitionPatch(
  report: Pick<Report, 'status' | 'version' | 'viewCount' | 'firstViewedAt'> & Partial<Report>,
  to: ReportStatus,
  ctx: TransitionContext & { now: Date },
): Partial<Report> {
  const now = ctx.now;
  const patch: Partial<Report> = { status: to, updatedAt: now };

  switch (to) {
    case 'submitted':
      patch.submittedAt = now;
      break;
    case 'under_review':
      patch.reviewedAt = now;
      break;
    case 'changes_requested':
      patch.reviewedAt = now;
      break;
    case 'internally_approved':
      patch.internallyApprovedAt = now;
      break;
    case 'published':
      patch.publishedAt = now;
      patch.hasUnpublishedChanges = false;
      // A publish always pins a version — client sign-off references it (rule 9).
      patch.version = (report.version || 1);
      break;
    case 'sent':
      patch.sentAt = now;
      break;
    case 'viewed':
      patch.lastViewedAt = now;
      patch.viewCount = (report.viewCount || 0) + 1;
      if (!report.firstViewedAt) patch.firstViewedAt = now;
      break;
    case 'acknowledged':
      patch.acknowledgedAt = now;
      break;
    case 'client_approved':
      patch.clientDecisionAt = now;
      patch.clientApprovedVersion = report.version || 1;
      patch.clientDecisionByUserId = ctx.actor.userId || null;
      // A signed-off report is a record — protect it from hard deletion.
      patch.legalHold = true;
      break;
    case 'client_rejected':
      patch.clientDecisionAt = now;
      patch.clientDecisionByUserId = ctx.actor.userId || null;
      break;
    case 'archived':
      patch.archivedAt = now;
      break;
    case 'in_progress':
      // Rule 6: editing a published report opens a NEW draft version and forces
      // re-approval. The published version stays readable in `reportVersions`.
      if (PUBLISHED_STATUSES.has(report.status)) {
        patch.version = (report.version || 1) + 1;
        patch.hasUnpublishedChanges = true;
        patch.internallyApprovedAt = undefined;
      }
      break;
    case 'draft':
      if (report.status === 'archived' || report.status === 'cancelled') {
        patch.archivedAt = undefined;
      }
      break;
    default:
      break;
  }

  return patch;
}

/** May the content of this report still be edited by `actor`? */
export function canEditContent(report: Pick<Report, 'status' | 'authorUserId'>, actor: TransitionActor): boolean {
  if (actor.kind !== 'staff') return false;
  if (!EDITABLE_STATUSES.has(report.status)) return false;
  return actor.isAuthor === true || actor.isManagement === true || actor.canReview === true;
}

/**
 * Hard delete is only ever allowed for a report with no client/legal footprint
 * (rule 8). Everything else soft-deletes.
 */
export function canHardDelete(report: Pick<Report, 'status' | 'legalHold' | 'publishedAt'>, actor: TransitionActor): boolean {
  if (!actor.canDelete && !actor.isManagement) return false;
  if (report.legalHold) return false;
  if (report.publishedAt) return false;
  return true;
}

/** The primary action to offer a staff user, given where the report stands. */
export function nextStaffAction(
  report: Pick<Report, 'status' | 'blocks' | 'authorUserId' | 'kind' | 'customerId'> & Partial<Report>,
  actor: TransitionActor,
): { to: ReportStatus; label: string } | null {
  const candidates: Array<{ to: ReportStatus; label: string }> = [
    { to: 'submitted', label: 'Dorëzo për shqyrtim' },
    { to: 'internally_approved', label: 'Aprovo brenda' },
    { to: 'published', label: 'Publiko për klientin' },
    { to: 'sent', label: 'Dërgo me email' },
  ];
  for (const c of candidates) {
    if (canTransition(report, c.to, { actor }).ok) return c;
  }
  return null;
}
