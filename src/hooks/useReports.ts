/**
 * useReports — the single write path for the reporting module.
 *
 * Everything that changes a report goes through here, so the four things that must
 * always happen together cannot drift apart:
 *
 *   1. the field patch,
 *   2. an immutable `reportEvents` entry (audit trail + status history),
 *   3. a `reportVersions` snapshot when the transition requires one,
 *   4. the notification to whoever now owes work.
 *
 * The rules themselves live in `src/lib/reporting/*` and are shared with the server
 * (`api/_reports.ts`), so the endpoint and the UI can never disagree about whether a
 * transition is legal.
 */

import { useCallback, useMemo } from 'react';
import { Timestamp, doc, getDoc, getDocs, collection, query, where, limit, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../contexts/PermissionsContext';
import {
  useCollection,
  useMutation,
  getGlobalBusinessId,
  getGlobalTeamId,
  useGlobalBusinessId,
} from './useFirestore';
import {
  canTransition,
  transitionPatch,
  canEditContent,
  PUBLISHED_STATUSES,
  STATUS_LABELS,
  type TransitionActor,
} from '../lib/reporting/workflow';
import {
  reportActor,
  reportAudience,
  reportingCapabilitiesFor,
  visibleReports,
  type ReportViewer,
} from '../lib/reporting/permissions';
import { checkReportQuality } from '../lib/reporting/quality';
import { instantiateTemplate, pickTemplate } from '../lib/reporting/templates';
import { buildPeriod, parsePeriodKey, previousPeriod } from '../lib/reporting/period';
import { buildKpiValues } from '../lib/reporting/kpi';
import { reportDeepLink } from '../lib/deepLinks';
import type {
  Report,
  ReportApproval,
  ReportApprovalStage,
  ReportComment,
  ReportEvent,
  ReportEventKind,
  ReportFrequency,
  ReportKind,
  ReportKpi,
  ReportSchedule,
  ReportStatus,
  ReportTemplate,
  ReportVersion,
  ReportMetricSet,
} from '../types';

/** Snapshots are taken on submit and on publish — the two moments that matter. */
const SNAPSHOT_ON: Partial<Record<ReportStatus, ReportVersion['reason']>> = {
  submitted: 'submitted',
  published: 'published',
};

/** Maps a status change to the audit event kind that best describes it. */
const EVENT_FOR_STATUS: Partial<Record<ReportStatus, ReportEventKind>> = {
  submitted: 'submitted',
  changes_requested: 'changes-requested',
  internally_approved: 'approved',
  published: 'published',
  sent: 'emailed',
  viewed: 'viewed',
  acknowledged: 'client-acknowledged',
  client_approved: 'client-approved',
  client_rejected: 'client-rejected',
  archived: 'archived',
};

/** Which approval stage a transition records. */
const STAGE_FOR_STATUS: Partial<Record<ReportStatus, ReportApprovalStage>> = {
  changes_requested: 'team_leader',
  internally_approved: 'management',
  acknowledged: 'client',
  client_approved: 'client',
  client_rejected: 'client',
};

/**
 * How many reports the hub loads at once. Filters and tabs operate WITHIN this window,
 * so the number has to be comfortably above a working set — a year of weekly reports
 * for a 10-person team plus monthly client reports is a few hundred.
 */
export const REPORT_LIST_LIMIT = 300;

export interface UseReportsOptions {
  /**
   * Skip the reports LIST subscription. A detail view already holds its document
   * via `useDocument`, so re-subscribing to every report is pure waste.
   *
   * It does NOT skip the reference data (templates, KPIs, schedules). It used to —
   * a single `skip` flag gated all four queries — and the result was that the report
   * editor received `kpis: []`, so the KPI picker permanently claimed "Nuk ka KPI
   * aktive" even with the full 121-KPI catalog installed, and `pullMetrics` could
   * never match a referenced id and always threw. The editor cannot function without
   * that catalog, so it is always loaded.
   */
  skipList?: boolean;
}

export function useReports(options: UseReportsOptions = {}) {
  const { user } = useAuth();
  const permissions = usePermissions();
  const businessId = useGlobalBusinessId();

  const reportsApi = useMutation<Report>('reports');
  const versionsApi = useMutation<ReportVersion>('reportVersions');
  const eventsApi = useMutation<ReportEvent>('reportEvents');
  const approvalsApi = useMutation<ReportApproval>('reportApprovals');
  const commentsApi = useMutation<ReportComment>('reportComments');
  // Notifications go through the useMutation choke point on purpose: it fans out to
  // FCM push + email honouring per-user channel prefs and Do-Not-Disturb.
  const notificationsApi = useMutation<any>('notifications');

  const { data: rawReports, loading, error } = useCollection<Report>('reports', {
    skip: options.skipList,
    // Bounded on the SERVER (see teamScopedWhere): the list used to read every report
    // the tenant had ever produced, every time the hub opened. `REPORT_LIST_LIMIT` is
    // surfaced in the UI when it is reached — a silent cap would read as "you have no
    // older reports". Needs the (businessId, updatedAt desc) composite index.
    teamScopedWhere: true,
    orderBy: { field: 'updatedAt', direction: 'desc' },
    limit: REPORT_LIST_LIMIT,
  });
  // Reference data, always loaded — see UseReportsOptions.skipList for why.
  const { data: templates } = useCollection<ReportTemplate>('reportTemplates');
  const { data: kpis } = useCollection<ReportKpi>('reportKpis');
  const { data: schedules } = useCollection<ReportSchedule>('reportSchedules');

  /** The current user, as the reporting layer sees them. */
  const viewer: ReportViewer = useMemo(() => ({
    userId: user?.uid || null,
    role: permissions.role,
    roles: permissions.role ? [permissions.role] : [],
    department: (permissions as any).serviceLine ?? null,
    isManagement: permissions.isAdmin || permissions.isOwner || permissions.isManager || permissions.isSuperAdmin,
    capabilities: reportingCapabilitiesFor(permissions.role, permissions as any),
  }), [user?.uid, permissions]);

  /**
   * Soft-deleted reports never reach a screen, and the per-report visibility rule is
   * applied client-side on top of the tenant-scoped query (the Firestore rules cannot
   * express "reports I author or review" without an index per relationship).
   */
  const reports = useMemo(
    () => visibleReports((rawReports || []).filter(r => !r.deletedAt), viewer),
    [rawReports, viewer],
  );

  const actorFor = useCallback(
    (report: Partial<Report>): TransitionActor => reportActor(report, viewer),
    [viewer],
  );
  const audienceFor = useCallback(
    (report: Partial<Report>) => reportAudience(report, viewer),
    [viewer],
  );

  /** Append an audit event. Never throws into the caller — auditing must not break work. */
  const logEvent = useCallback(async (
    report: Pick<Report, 'id' | 'businessId' | 'version' | 'customerId' | 'projectId'>,
    kind: ReportEventKind,
    extra: Partial<ReportEvent> = {},
  ) => {
    try {
      await eventsApi.create({
        businessId: report.businessId,
        reportId: report.id,
        kind,
        version: report.version,
        actorUserId: user?.uid || null,
        actorName: user?.displayName || user?.email || undefined,
        actorType: 'staff',
        customerId: report.customerId || null,
        projectId: report.projectId || null,
        ...extra,
      } as any);
    } catch (err) {
      console.error('[useReports] audit event failed', err);
    }
  }, [eventsApi, user]);

  /** Take an immutable snapshot of the report as it stands. */
  const snapshotVersion = useCallback(async (
    report: Report,
    reason: ReportVersion['reason'],
  ) => {
    await versionsApi.create({
      businessId: report.businessId,
      reportId: report.id,
      customerId: report.customerId || null,
      version: report.version,
      reason,
      title: report.title,
      status: report.status,
      period: report.period,
      blocks: report.blocks,
      kpiValues: report.kpiValues,
      health: report.health,
      templateKey: report.templateKey,
      templateVersion: report.templateVersion,
    } as any);
  }, [versionsApi]);

  /** Notify a user in-app (which also pushes + emails via the mutation choke point). */
  const notify = useCallback(async (
    userId: string | null | undefined,
    title: string,
    message: string,
    reportId: string,
    /** When the notification is about a comment, link to that comment, not just the report. */
    commentId?: string | null,
  ) => {
    if (!userId || userId === user?.uid) return; // never self-notify
    try {
      await notificationsApi.create({
        userId,
        type: 'report',
        title,
        message,
        actionUrl: reportDeepLink(reportId, commentId),
        actionLabel: commentId ? 'Hap komentin' : 'Hap raportin',
      } as any);
    } catch (err) {
      console.error('[useReports] notification failed', err);
    }
  }, [notificationsApi, user?.uid]);

  // ── create ────────────────────────────────────────────────────────────────────

  const createFromTemplate = useCallback(async (args: {
    kind: ReportKind;
    frequency: ReportFrequency;
    periodDate?: string;
    templateId?: string;
    customerId?: string;
    customerName?: string;
    projectId?: string;
    projectName?: string;
    subjectUserId?: string;
    department?: string;
    service?: Report['service'];
    reviewerUserId?: string | null;
    approverUserId?: string | null;
    title?: string;
  }): Promise<Report> => {
    const bid = businessId || getGlobalBusinessId();
    if (!bid) throw new Error('Nuk u zgjodh biznesi aktiv.');
    if (!user?.uid) throw new Error('Nuk jeni i identifikuar.');

    const chosen = args.templateId
      ? (templates || []).find(t => t.id === args.templateId)
      : pickTemplate(templates || [], {
        kind: args.kind,
        frequency: args.frequency,
        service: args.service,
        customerId: args.customerId,
        department: args.department,
      });
    if (!chosen) {
      throw new Error('Nuk u gjet template për këtë tip raporti. Krijoni një në Cilësimet e raportimit.');
    }

    const today = args.periodDate || new Date().toISOString().slice(0, 10);
    const period = buildPeriod(args.frequency, today);

    const body = instantiateTemplate(chosen, {
      businessId: bid,
      teamId: getGlobalTeamId() || undefined,
      authorUserId: user.uid,
      period,
      title: args.title,
      customerId: args.customerId,
      customerName: args.customerName,
      projectId: args.projectId,
      projectName: args.projectName,
      subjectUserId: args.subjectUserId,
      department: args.department,
      reviewerUserId: args.reviewerUserId ?? null,
      approverUserId: args.approverUserId ?? null,
    });

    const created = await reportsApi.create(body as any) as unknown as Report;
    await logEvent(created as any, 'created');
    // Template usage is a product signal (which templates are actually used).
    try {
      await updateDoc(doc(db, 'reportTemplates', chosen.id), {
        usageCount: (chosen.usageCount || 0) + 1,
        updatedAt: Timestamp.now(),
      });
    } catch { /* non-critical */ }
    return created;
  }, [businessId, user, templates, reportsApi, logEvent]);

  // ── content edits ─────────────────────────────────────────────────────────────

  /**
   * Save content. Optimistic locking: the write only lands if `revision` still
   * matches what the editor loaded, so two people editing the same report cannot
   * silently overwrite each other.
   */
  const saveContent = useCallback(async (
    report: Report,
    patch: Partial<Report>,
    opts: { silent?: boolean } = {},
  ) => {
    if (!canEditContent(report, actorFor(report))) {
      throw new Error(`Raporti në statusin "${STATUS_LABELS[report.status]}" nuk redaktohet.`);
    }
    const quality = checkReportQuality({ ...report, ...patch } as Report);
    await reportsApi.update(report.id, {
      ...patch,
      qualityScore: quality.score,
      revision: (report.revision || 1) + 1,
      // Editing a published-then-reopened report keeps the "needs re-approval" flag.
      ...(PUBLISHED_STATUSES.has(report.status) ? { hasUnpublishedChanges: true } : {}),
    } as any);
    if (!opts.silent) await logEvent(report, 'updated');
  }, [reportsApi, actorFor, logEvent]);

  /** Health override — a contradiction of the system suggestion needs a reason. */
  const setHealth = useCallback(async (
    report: Report,
    health: Report['health'],
    reason?: string,
  ) => {
    if (report.suggestedHealth && report.suggestedHealth !== health && !reason?.trim()) {
      throw new Error('Shkruani arsyen pse ndryshoni statusin e sugjeruar.');
    }
    await reportsApi.update(report.id, {
      health,
      healthOverrideReason: reason?.trim() || undefined,
      revision: (report.revision || 1) + 1,
    } as any);
    await logEvent(report, 'updated', {
      field: 'health',
      fromValue: report.health || null,
      toValue: health || null,
      reason: reason?.trim(),
    });
  }, [reportsApi, logEvent]);

  // ── workflow ──────────────────────────────────────────────────────────────────

  /**
   * Move a report through its lifecycle. Rejects illegally, snapshots when needed,
   * records an approval when the transition is a decision, notifies the next owner.
   */
  const transition = useCallback(async (
    report: Report,
    to: ReportStatus,
    opts: { reason?: string; comment?: string } = {},
  ) => {
    const actor = actorFor(report);
    const verdict = canTransition(report, to, { actor, reason: opts.reason });
    if (!verdict.ok) throw new Error(verdict.reason || 'Kalimi nuk lejohet.');

    const now = new Date();
    const patch = transitionPatch(report, to, { actor, reason: opts.reason, now });

    // Snapshot BEFORE the patch lands, so the snapshot is the state that was
    // submitted/published rather than the state after the timestamps changed.
    const snapshotReason = SNAPSHOT_ON[to];
    if (snapshotReason) {
      await snapshotVersion({ ...report, status: to }, snapshotReason);
    }

    await reportsApi.update(report.id, {
      ...patch,
      revision: (report.revision || 1) + 1,
    } as any);

    await logEvent(report, EVENT_FOR_STATUS[to] || 'status-changed', {
      field: 'status',
      fromValue: report.status,
      toValue: to,
      reason: opts.reason,
      comment: opts.comment,
    });

    // A decision is evidence — record it against the exact version.
    const stage = STAGE_FOR_STATUS[to];
    if (stage) {
      await approvalsApi.create({
        businessId: report.businessId,
        reportId: report.id,
        version: report.version,
        step: to === 'changes_requested' ? 0 : 1,
        stage,
        decision: to === 'changes_requested' ? 'changes_requested'
          : to === 'client_rejected' ? 'rejected'
            : to === 'acknowledged' ? 'acknowledged' : 'approved',
        approverUserId: user?.uid || '',
        approverName: user?.displayName || user?.email || undefined,
        comment: opts.comment || opts.reason,
      } as any);
    }

    // Tell whoever now owes work.
    if (to === 'submitted') {
      await notify(report.reviewerUserId || report.approverUserId,
        'Raport për shqyrtim', `"${report.title}" pret shqyrtimin tuaj.`, report.id);
    } else if (to === 'changes_requested') {
      await notify(report.authorUserId,
        'Kërkohen ndryshime', opts.reason || `"${report.title}" kthehet për ndryshime.`, report.id);
    } else if (to === 'internally_approved') {
      await notify(report.authorUserId,
        'Raporti u aprovua', `"${report.title}" u aprovua brenda.`, report.id);
      if (report.accountManagerUserId) {
        await notify(report.accountManagerUserId,
          'Gati për publikim', `"${report.title}" është gati për klientin.`, report.id);
      }
    } else if (to === 'published') {
      await notify(report.authorUserId,
        'Raporti u publikua', `"${report.title}" është i dukshëm për klientin.`, report.id);
    }

    return patch;
  }, [actorFor, reportsApi, snapshotVersion, logEvent, approvalsApi, notify, user]);

  // ── soft delete / restore ─────────────────────────────────────────────────────

  const softDelete = useCallback(async (report: Report) => {
    if (report.legalHold) {
      throw new Error('Raporti është nën mbajtje ligjore (aprovuar nga klienti) dhe nuk fshihet.');
    }
    if (!viewer.isManagement && report.authorUserId !== viewer.userId) {
      throw new Error('Vetëm autori ose menaxhimi mund të fshijë raportin.');
    }
    await reportsApi.update(report.id, {
      deletedAt: Timestamp.now() as any,
      deletedByUserId: user?.uid || null,
    } as any);
    await logEvent(report, 'deleted');
  }, [reportsApi, logEvent, viewer, user]);

  const restore = useCallback(async (report: Report) => {
    if (!viewer.isManagement) throw new Error('Vetëm menaxhimi mund të riaktivizojë raporte.');
    await reportsApi.update(report.id, { deletedAt: null, deletedByUserId: null } as any);
    await logEvent(report, 'restored');
  }, [reportsApi, logEvent, viewer]);

  // ── comments ──────────────────────────────────────────────────────────────────

  const addComment = useCallback(async (
    report: Report,
    body: string,
    opts: { internal?: boolean; parentId?: string | null; blockId?: string | null; mentionUserIds?: string[] } = {},
  ) => {
    const text = body.trim();
    if (!text) throw new Error('Komenti është bosh.');
    const internal = opts.internal !== false; // internal is the SAFE default
    const created = await commentsApi.create({
      businessId: report.businessId,
      reportId: report.id,
      customerId: report.customerId || null,
      parentId: opts.parentId ?? null,
      blockId: opts.blockId ?? null,
      body: text,
      internal,
      authorUserId: user?.uid || '',
      authorName: user?.displayName || user?.email || undefined,
      mentionUserIds: opts.mentionUserIds || [],
      resolvedAt: null,
    } as any);
    await logEvent(report, 'commented', { meta: { internal } });
    const commentId = (created as any)?.id as string | undefined;
    for (const uid of opts.mentionUserIds || []) {
      await notify(uid, 'Ju përmendën në një raport', text.slice(0, 120), report.id, commentId);
    }
    // A client-visible comment is a message to the client, so tell them.
    if (!internal && report.customerId) {
      await notify(report.accountManagerUserId, 'Koment i dukshëm për klientin',
        text.slice(0, 120), report.id, commentId);
    }
    return created;
  }, [commentsApi, logEvent, notify, user]);

  const resolveComment = useCallback(async (commentId: string, resolved: boolean) => {
    await commentsApi.update(commentId, {
      resolvedAt: resolved ? (Timestamp.now() as any) : null,
      resolvedByUserId: resolved ? (user?.uid || null) : null,
    } as any);
  }, [commentsApi, user]);

  // ── metric ingestion ──────────────────────────────────────────────────────────

  /**
   * Fill the report's KPI snapshot from `reportMetrics` for its own period, plus the
   * previous period so every card can show a comparison.
   *
   * `reportMetrics` is written by the integration jobs (currently
   * `report-metrics-social`; GA4/Ads adapters will write the same shape), and it is
   * deliberately separate from the report: deleting or re-drafting a report never
   * loses the underlying numbers.
   *
   * Values are SNAPSHOTTED onto the report, not referenced — that is what makes rule
   * 15 true (a historical report keeps the figures it was published with, even if the
   * source is later re-synced).
   */
  const pullMetrics = useCallback(async (report: Report): Promise<{ filled: number }> => {
    const bid = report.businessId;
    const scopeKey = report.projectId ? `project:${report.projectId}`
      : report.customerId ? `customer:${report.customerId}` : null;
    if (!scopeKey) throw new Error('Raporti nuk ka klient apo projekt, ndaj nuk ka metrika për të marrë.');

    const prev = previousPeriodKey(report.period.key);
    const read = async (periodKey: string): Promise<Record<string, number | null>> => {
      const snap = await getDoc(doc(db, 'reportMetrics', `${bid}_${scopeKey}_${periodKey}`));
      return snap.exists() ? ((snap.data() as ReportMetricSet).values || {}) : {};
    };

    const [current, previous] = await Promise.all([read(report.period.key), prev ? read(prev) : Promise.resolve({})]);

    // Only KPIs the report actually references — pulling the whole catalog onto every
    // report would bloat the document and show the client metrics nobody chose.
    const referenced = new Set((report.blocks || []).flatMap(b => b.kpiIds || []));
    const relevant = (kpis || []).filter(k => referenced.has(k.id));
    if (!relevant.length) throw new Error('Asnjë bllok KPI në raport. Shtoni një bllok me KPI së pari.');

    const values = buildKpiValues(relevant, current, previous, {
      customerId: report.customerId,
      projectId: report.projectId,
      service: report.service,
      periodKey: report.period.key,
    });
    const filled = values.filter(v => v.value !== null && v.value !== undefined).length;

    await reportsApi.update(report.id, {
      kpiValues: values,
      revision: (report.revision || 1) + 1,
    } as any);
    await logEvent(report, 'updated', { field: 'kpiValues', meta: { filled, of: values.length } });

    return { filled };
  }, [kpis, reportsApi, logEvent]);

  // ── idempotency helper (shared with the cron) ─────────────────────────────────

  /** Has a report already been generated for this (schedule, period)? */
  const findByGenerationKey = useCallback(async (key: string): Promise<Report | null> => {
    const bid = businessId || getGlobalBusinessId();
    if (!bid) return null;
    const snap = await getDocs(query(
      collection(db, 'reports'),
      where('businessId', '==', bid),
      where('generationKey', '==', key),
      limit(1),
    ));
    if (snap.empty) return null;
    const d = snap.docs[0];
    return { id: d.id, ...(d.data() as any) } as Report;
  }, [businessId]);

  return {
    reports,
    /** True when the server window is full, i.e. older reports exist beyond it. */
    listTruncated: (rawReports || []).length >= REPORT_LIST_LIMIT,
    templates: templates || [],
    kpis: kpis || [],
    schedules: schedules || [],
    loading,
    error,
    viewer,
    actorFor,
    audienceFor,
    createFromTemplate,
    saveContent,
    setHealth,
    transition,
    softDelete,
    restore,
    addComment,
    resolveComment,
    logEvent,
    pullMetrics,
    findByGenerationKey,
  };
}

/**
 * One report + its thread, versions, approvals and audit trail.
 *
 * Every query sets `teamScopedWhere: true`, which is load-bearing rather than an
 * optimisation. These four collections are in `businessIsolatedAlways`, so by default
 * `useCollection` sends ONLY `businessId ==` to Firestore and filters `reportId`
 * client-side — meaning opening one report downloaded the tenant's ENTIRE
 * `reportComments`, `reportVersions`, `reportApprovals` and `reportEvents`. The last
 * of those is an append-only audit stream that grows forever, so the cost grew with
 * the tenant's whole history rather than with the report being read.
 *
 * With the flag, `businessId + reportId` both go to the server. That REQUIRES the
 * composite indexes `(businessId, reportId)` on each collection — deploy
 * firestore.indexes.json before this code, or the queries fail with
 * FAILED_PRECONDITION.
 */
export function useReport(reportId: string | undefined) {
  const byReport = reportId
    ? [{ field: 'reportId', operator: '==', value: reportId }]
    : undefined;

  const { data: comments, loading: commentsLoading } = useCollection<ReportComment>('reportComments', {
    skip: !reportId,
    where: byReport,
    teamScopedWhere: true,
  });
  const { data: versions } = useCollection<ReportVersion>('reportVersions', {
    skip: !reportId,
    where: byReport,
    teamScopedWhere: true,
  });
  const { data: approvals } = useCollection<ReportApproval>('reportApprovals', {
    skip: !reportId,
    where: byReport,
    teamScopedWhere: true,
  });
  const { data: events } = useCollection<ReportEvent>('reportEvents', {
    skip: !reportId,
    where: byReport,
    teamScopedWhere: true,
  });

  return {
    comments: useMemo(
      () => [...(comments || [])].sort((a, b) => tms(a.createdAt) - tms(b.createdAt)),
      [comments],
    ),
    versions: useMemo(() => [...(versions || [])].sort((a, b) => b.version - a.version), [versions]),
    approvals: useMemo(
      () => [...(approvals || [])].sort((a, b) => tms(b.createdAt) - tms(a.createdAt)),
      [approvals],
    ),
    events: useMemo(
      () => [...(events || [])].sort((a, b) => tms(b.createdAt) - tms(a.createdAt)),
      [events],
    ),
    loading: commentsLoading,
  };
}

const tms = (d: Date | undefined) => (d instanceof Date ? d.getTime() : 0);

/**
 * Previous period key for any canonical form.
 *
 * This was hand-rolled string arithmetic that only understood `YYYY-MM` and
 * `YYYY-Qn`, so a WEEKLY report silently got no comparison period and its KPI cards
 * showed no delta — the numbers looked collected but uncomparable. `parsePeriodKey`
 * + `previousPeriod` already handle every cadence (including the ISO week-year edge
 * cases) and are covered by the period tests, so this defers to them.
 */
function previousPeriodKey(key: string): string | null {
  try {
    return previousPeriod(parsePeriodKey(key)).key;
  } catch {
    // Ad-hoc periods have no canonical predecessor.
    return null;
  }
}

export default useReports;
