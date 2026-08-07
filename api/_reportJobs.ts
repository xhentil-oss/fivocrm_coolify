import admin, { adminDb as db } from './_firebaseAdmin.js';

/**
 * Scheduled work for the reporting module, invoked from `api/cron/run.ts`:
 *
 *   ?job=report-schedules       generate draft reports from `reportSchedules`
 *   ?job=report-reminders       reminders + escalations for open/overdue reports
 *   ?job=client-health-rollup   persist a client-health snapshot per period
 *   ?job=report-metrics-social  socialSnapshots → reportMetrics (KPI source)
 *
 * ALL THREE ARE IDEMPOTENT. The cron is at-least-once (Vercel retries, deploys
 * overlap, admins press the manual trigger), so every job re-derives its work from
 * stored state rather than assuming it runs exactly once:
 *
 *   • generation is keyed on `generationKey = scheduleId:periodKey[:subjectId]` and
 *     the job queries for it before writing;
 *   • each reminder/escalation rung records itself in `remindersSent` /
 *     `escalationsSent`, so a replay sends nothing twice;
 *   • the health snapshot uses a deterministic document id, so a re-run overwrites
 *     its own row instead of appending a duplicate.
 *
 * COST RULE (per CLAUDE.md): no job reads a collection unfiltered. Generation walks
 * ACTIVE schedules and then reads only that schedule's tenant; the reminder sweep
 * uses a status + dueAt range that an index serves.
 *
 * The pure logic is intentionally re-implemented here in compact form rather than
 * imported from `src/lib/reporting/*`: `/api` is bundled separately by Vercel and
 * must not pull in the React-side module graph. Each mirrored function names its
 * counterpart so the pair stays in step.
 */

/**
 * Firestore (Admin SDK included, since `ignoreUndefinedProperties` is not enabled on
 * this app) rejects `undefined`. The report below is assembled from a stored template
 * whose blocks are bags of optional fields, so every payload is stripped first.
 * Mirrors `stripUndefined` in src/lib/reporting/blocks.ts — duplicated because /api
 * is bundled separately and must not import the React-side module graph.
 */
function stripUndefined<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(v => stripUndefined(v)) as unknown as T;
  if (typeof value !== 'object') return value;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return value; // Date / Timestamp
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v === undefined) continue;
    out[k] = stripUndefined(v);
  }
  return out as T;
}

// ── date helpers (mirror src/lib/reporting/period.ts) ─────────────────────────
const pad = (n: number) => String(n).padStart(2, '0');
const toIso = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

function fromIso(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function addDays(iso: string, days: number): string {
  const d = fromIso(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return toIso(d);
}
function isoWeekday(iso: string): number {
  const wd = fromIso(iso).getUTCDay();
  return wd === 0 ? 7 : wd;
}
function startOfIsoWeek(iso: string): string {
  return addDays(iso, -(isoWeekday(iso) - 1));
}
function isoWeekKey(iso: string): string {
  const thursday = fromIso(addDays(startOfIsoWeek(iso), 3));
  const year = thursday.getUTCFullYear();
  const week = Math.floor((thursday.getTime() - Date.UTC(year, 0, 1)) / 86_400_000 / 7) + 1;
  return `${year}-W${pad(week)}`;
}
function endOfMonth(iso: string): string {
  const d = fromIso(iso);
  return toIso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
}
function quarterOf(iso: string): number {
  return Math.floor(Number(iso.slice(5, 7)) / 3.0001) + 1;
}

interface Period { frequency: string; key: string; start: string; end: string; timezone?: string }

function buildPeriod(frequency: string, iso: string, timezone = 'Europe/Tirane'): Period {
  let start = iso;
  let end = iso;
  let key = iso;
  if (frequency === 'weekly') {
    start = startOfIsoWeek(iso);
    end = addDays(start, 6);
    key = isoWeekKey(iso);
  } else if (frequency === 'monthly') {
    start = `${iso.slice(0, 7)}-01`;
    end = endOfMonth(iso);
    key = iso.slice(0, 7);
  } else if (frequency === 'quarterly') {
    const q = quarterOf(iso);
    const year = iso.slice(0, 4);
    start = `${year}-${pad((q - 1) * 3 + 1)}-01`;
    end = endOfMonth(`${year}-${pad(q * 3)}-01`);
    key = `${year}-Q${q}`;
  }
  return { frequency, key, start, end, timezone };
}

/** UTC offset for a tenant zone at an instant (mirrors schedule.utcOffsetHours). */
function utcOffsetHours(timezone: string | undefined, at: Date): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone || 'Europe/Tirane', timeZoneName: 'longOffset',
    }).formatToParts(at);
    const name = parts.find(p => p.type === 'timeZoneName')?.value || '';
    const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(name);
    if (!m) return 0;
    return (m[1] === '-' ? -1 : 1) * (Number(m[2]) + Number(m[3] || 0) / 60);
  } catch {
    return 0;
  }
}
const localIso = (at: Date, tz?: string) => toIso(new Date(at.getTime() + utcOffsetHours(tz, at) * 3_600_000));
const localHour = (at: Date, tz?: string) =>
  new Date(at.getTime() + utcOffsetHours(tz, at) * 3_600_000).getUTCHours();

function isWorkingDay(sched: any, iso: string): boolean {
  const allowed: number[] = Array.isArray(sched.workingDays) && sched.workingDays.length
    ? sched.workingDays : [1, 2, 3, 4, 5];
  if (!allowed.includes(isoWeekday(iso))) return false;
  return !(Array.isArray(sched.holidays) ? sched.holidays : []).includes(iso);
}
function firstWorkingDayOfMonth(sched: any, iso: string): string {
  let d = `${iso.slice(0, 7)}-01`;
  for (let i = 0; i < 10; i++) {
    if (isWorkingDay(sched, d)) return d;
    d = addDays(d, 1);
  }
  return `${iso.slice(0, 7)}-01`;
}

/** The period a schedule reports ON now (mirrors schedule.targetPeriodFor). */
function targetPeriod(sched: any, now: Date): Period {
  const today = localIso(now, sched.timezone);
  const tz = sched.timezone || 'Europe/Tirane';
  switch (sched.frequency) {
    case 'daily': return buildPeriod('daily', addDays(today, -1), tz);
    case 'weekly': return buildPeriod('weekly', addDays(today, -7), tz);
    case 'monthly': return buildPeriod('monthly', addDays(`${today.slice(0, 7)}-01`, -1), tz);
    case 'quarterly': {
      const q = buildPeriod('quarterly', today, tz);
      return buildPeriod('quarterly', addDays(q.start, -1), tz);
    }
    default: return buildPeriod('ad-hoc', today, tz);
  }
}

/** Mirrors schedule.shouldRunNow — returns why it did NOT run, for the cron log. */
function shouldRunNow(sched: any, now: Date): { run: boolean; reason: string; period: Period } {
  const period = targetPeriod(sched, now);
  const today = localIso(now, sched.timezone);
  const hour = localHour(now, sched.timezone);

  if (!sched.active) return { run: false, reason: 'inactive', period };
  if (hour < Number(sched.hour ?? 9)) return { run: false, reason: `hour ${hour} < ${sched.hour}`, period };
  if (sched.lastRunPeriodKey === period.key) return { run: false, reason: `period ${period.key} done`, period };

  switch (sched.frequency) {
    case 'daily':
      if (!isWorkingDay(sched, today)) return { run: false, reason: 'non-working day', period };
      break;
    case 'weekly': {
      const want = Number(sched.dayOfWeek ?? 1);
      if (isoWeekday(today) !== want) return { run: false, reason: `weekday ${isoWeekday(today)} != ${want}`, period };
      break;
    }
    case 'monthly':
    case 'quarterly': {
      if (sched.frequency === 'quarterly' && ![1, 4, 7, 10].includes(Number(today.slice(5, 7)))) {
        return { run: false, reason: 'not a quarter month', period };
      }
      const want = Number(sched.dayOfMonth ?? 0);
      const target = want === 0
        ? firstWorkingDayOfMonth(sched, today)
        : `${today.slice(0, 7)}-${pad(Math.min(28, want))}`;
      if (today < target) return { run: false, reason: `${today} < ${target}`, period };
      break;
    }
    default:
      return { run: false, reason: 'ad-hoc', period };
  }
  return { run: true, reason: 'ready', period };
}

const generationKey = (scheduleId: string, periodKey: string, subjectId?: string | null) =>
  (subjectId ? `${scheduleId}:${periodKey}:${subjectId}` : `${scheduleId}:${periodKey}`);

function dueAtFor(period: Period, offsetDays: number, hour: number, offset: number): Date {
  const base = fromIso(addDays(period.end, Math.max(0, Math.round(offsetDays))));
  base.setUTCHours(hour - offset, 0, 0, 0);
  return base;
}
function defaultDueOffset(frequency: string): number {
  return frequency === 'daily' ? 0 : frequency === 'weekly' ? 2 : frequency === 'monthly' ? 5 : 10;
}

// ─────────────────────────────────────────────────────────────────────────────
// JOB: report-schedules — generate draft reports
// ─────────────────────────────────────────────────────────────────────────────

export async function runReportSchedules(): Promise<{ created: number; skipped: number; failed: number }> {
  const now = new Date();
  let created = 0;
  let skipped = 0;
  let failed = 0;

  // Only ACTIVE schedules — never a full-collection scan.
  const schedules = await db.collection('reportSchedules').where('active', '==', true).get();

  for (const doc of schedules.docs) {
    const sched = { id: doc.id, ...(doc.data() as any) };
    const verdict = shouldRunNow(sched, now);
    if (!verdict.run) {
      skipped++;
      continue;
    }

    try {
      const template = sched.templateId
        ? await db.collection('reportTemplates').doc(sched.templateId).get()
        : null;
      if (!template?.exists) {
        console.warn(`[report-schedules] ${sched.id}: template missing`);
        await appendEvent(sched.businessId, null, 'generation-failed', {
          meta: { scheduleId: sched.id, reason: 'template-missing' },
        });
        failed++;
        continue;
      }
      const tmpl = template.data() as any;

      // Fan out per department member for staff-report schedules; otherwise one report.
      const subjects: Array<{ userId: string | null; name?: string }> = [];
      if (sched.perDepartmentMember && sched.department) {
        const members = await db.collection('teamMembers')
          .where('businessId', '==', sched.businessId)
          .where('status', '==', 'Active')
          .get();
        for (const m of members.docs) {
          const data = m.data() as any;
          // Match on the member's CRAFT first (`position`), falling back to the P&L
          // service line for members who predate it — same precedence as the daily
          // report, so "the Design department" means one thing across the product.
          const craft = data.position || data.serviceLine;
          if (craft && craft !== sched.department) continue;
          subjects.push({ userId: data.userId, name: data.displayName });
        }
      } else {
        subjects.push({ userId: null });
      }

      for (const subject of subjects) {
        const key = generationKey(sched.id, verdict.period.key, subject.userId);

        // THE idempotency check — a retried run finds the report and stops.
        const existing = await db.collection('reports')
          .where('businessId', '==', sched.businessId)
          .where('generationKey', '==', key)
          .limit(1)
          .get();
        if (!existing.empty) {
          skipped++;
          continue;
        }

        const offset = utcOffsetHours(sched.timezone, now);
        const dueAt = dueAtFor(
          verdict.period,
          Number(sched.dueOffsetDays ?? defaultDueOffset(sched.frequency)),
          Number(sched.hour ?? 9),
          offset,
        );

        const authorUserId = subject.userId || sched.authorUserId || null;
        const blocks = Array.isArray(tmpl.blocks)
          ? tmpl.blocks.map((b: any, i: number) => ({ ...b, id: `${b.type}-${i}`, order: i }))
          : [];

        const titleSubject = subject.name || sched.customerName || sched.projectName || '';
        const now2 = admin.firestore.Timestamp.now();

        await db.collection('reports').add(stripUndefined({
          businessId: sched.businessId,
          ...(sched.teamId ? { teamId: sched.teamId } : {}),
          kind: sched.kind || tmpl.kind,
          title: `${tmpl.name}${titleSubject ? ` — ${titleSubject}` : ''} · ${verdict.period.key}`,
          status: 'draft',
          period: verdict.period,
          service: sched.service || tmpl.service || null,
          customerId: sched.customerId || null,
          customerName: sched.customerName || null,
          projectId: sched.projectId || null,
          projectName: sched.projectName || null,
          subjectUserId: subject.userId,
          department: sched.department || null,
          authorUserId,
          reviewerUserId: sched.reviewerUserId || null,
          approverUserId: sched.approverUserId || null,
          blocks,
          kpiValues: [],
          currency: 'EUR',
          templateId: template.id,
          templateKey: tmpl.key,
          templateVersion: tmpl.version || 1,
          version: 1,
          revision: 1,
          viewCount: 0,
          dueAt: admin.firestore.Timestamp.fromDate(dueAt),
          scheduleId: sched.id,
          generationKey: key,
          deletedAt: null,
          // The ladders are COPIED onto the report, not looked up from the schedule
          // at reminder time. Two reasons: `runReportReminders` sweeps reports by
          // status+dueAt and would otherwise need a schedule read per report, and a
          // schedule edited mid-period must not retroactively change how an
          // already-generated report escalates.
          //
          // Before this, neither field was written at all, so `runReportReminders`
          // always fell back to its defaults and every ladder a tenant configured was
          // silently ignored.
          ...(Array.isArray(sched.reminderOffsetsDays) && sched.reminderOffsetsDays.length
            ? { reminderOffsetsDays: sched.reminderOffsetsDays } : {}),
          ...(Array.isArray(sched.escalation) && sched.escalation.length
            ? { escalation: sched.escalation } : {}),
          remindersSent: [],
          escalationsSent: [],
          createdAt: now2,
          updatedAt: now2,
          createdByUserId: null,
        }));
        created++;

        if (sched.notifyAuthor !== false && authorUserId) {
          await notify(authorUserId, sched.businessId, 'Raport i re për plotësim',
            `${tmpl.name} për ${verdict.period.key} pret plotësimin.`, null);
        }
      }

      await doc.ref.update({
        lastRunAt: admin.firestore.Timestamp.now(),
        lastRunPeriodKey: verdict.period.key,
        updatedAt: admin.firestore.Timestamp.now(),
      });
    } catch (err) {
      failed++;
      console.error(`[report-schedules] ${sched.id} failed:`, err);
    }
  }

  console.log(`[report-schedules] created=${created} skipped=${skipped} failed=${failed}`);
  return { created, skipped, failed };
}

// ─────────────────────────────────────────────────────────────────────────────
// JOB: report-reminders — reminders + escalations
// ─────────────────────────────────────────────────────────────────────────────

const OPEN_STATUSES = ['draft', 'in_progress', 'changes_requested', 'submitted', 'under_review'];

const DEFAULT_ESCALATION = [
  { afterMinutes: 0, notify: 'author' },
  { afterMinutes: 30, notify: 'reviewer' },
  { afterMinutes: 120, notify: 'approver' },
  { afterMinutes: 480, notify: 'management', markMissing: true },
];

export async function runReportReminders(): Promise<{ reminded: number; escalated: number; missing: number }> {
  const now = new Date();
  let reminded = 0;
  let escalated = 0;
  let missing = 0;

  // Range query on an indexed field: only reports whose deadline is within the next
  // 7 days (or already past) can possibly need a nudge. Never a full scan.
  const horizon = new Date(now.getTime() + 7 * 86_400_000);
  const snap = await db.collection('reports')
    .where('status', 'in', OPEN_STATUSES)
    .where('dueAt', '<=', admin.firestore.Timestamp.fromDate(horizon))
    .get();

  for (const doc of snap.docs) {
    const r = { id: doc.id, ...(doc.data() as any) };
    if (r.deletedAt) continue;
    const dueAt: Date | null = r.dueAt?.toDate?.() || null;
    if (!dueAt) continue;

    const overdueMinutes = Math.floor((now.getTime() - dueAt.getTime()) / 60000);

    try {
      if (overdueMinutes < 0) {
        // ── before the deadline: one reminder rung per run, closest first ──
        const offsets: number[] = Array.isArray(r.reminderOffsetsDays) && r.reminderOffsetsDays.length
          ? r.reminderOffsetsDays
          : [3, 1];
        const sent: number[] = Array.isArray(r.remindersSent) ? r.remindersSent : [];
        const daysToDue = -overdueMinutes / 1440;
        const dueRung = offsets
          .filter(o => o > 0 && !sent.includes(o) && daysToDue <= o)
          .sort((a, b) => a - b)[0];
        if (dueRung === undefined) continue;

        await notify(r.authorUserId, r.businessId, 'Raporti afron afatin',
          `"${r.title}" duhet dorëzuar brenda ${Math.max(1, Math.ceil(daysToDue))} ditë.`, r.id);
        await doc.ref.update({
          remindersSent: admin.firestore.FieldValue.arrayUnion(dueRung),
          updatedAt: admin.firestore.Timestamp.now(),
        });
        await appendEvent(r.businessId, r.id, 'reminded', { meta: { offsetDays: dueRung } });
        reminded++;
        continue;
      }

      // ── overdue: highest rung reached, once ──
      const ladder = Array.isArray(r.escalation) && r.escalation.length ? r.escalation : DEFAULT_ESCALATION;
      const fired: number[] = Array.isArray(r.escalationsSent) ? r.escalationsSent : [];
      const rung = ladder
        .filter((x: any) => !fired.includes(x.afterMinutes) && overdueMinutes >= x.afterMinutes)
        .sort((a: any, b: any) => a.afterMinutes - b.afterMinutes)
        .slice(-1)[0];
      if (!rung) continue;

      const recipients = await resolveEscalationTargets(r, rung.notify);
      const hoursLate = Math.floor(overdueMinutes / 60);
      for (const uid of recipients) {
        await notify(uid, r.businessId, 'Raport i vonuar',
          `"${r.title}" është ${hoursLate >= 1 ? `${hoursLate} orë` : `${overdueMinutes} min`} pas afatit.`, r.id);
      }

      const patch: Record<string, unknown> = {
        escalationsSent: admin.firestore.FieldValue.arrayUnion(rung.afterMinutes),
        updatedAt: admin.firestore.Timestamp.now(),
      };
      if (rung.markMissing && !r.markedMissingAt) {
        // "Missing" is recorded on the report so the management dashboard can show it
        // without recomputing; the status itself stays open (the work is still owed).
        patch.markedMissingAt = admin.firestore.Timestamp.now();
        missing++;
      }
      await doc.ref.update(patch);
      await appendEvent(r.businessId, r.id, 'escalated', {
        meta: { afterMinutes: rung.afterMinutes, notify: rung.notify, recipients: recipients.length },
      });
      escalated++;
    } catch (err) {
      console.error(`[report-reminders] ${doc.id} failed:`, err);
    }
  }

  console.log(`[report-reminders] reminded=${reminded} escalated=${escalated} missing=${missing}`);
  return { reminded, escalated, missing };
}

/** Resolve an escalation rung to concrete uids, never leaving the report's tenant. */
async function resolveEscalationTargets(report: any, notifyTarget: string): Promise<string[]> {
  const direct: Record<string, string | null | undefined> = {
    author: report.authorUserId,
    reviewer: report.reviewerUserId,
    approver: report.approverUserId,
    account_manager: report.accountManagerUserId,
    project_manager: report.projectManagerUserId,
  };
  if (direct[notifyTarget]) return [String(direct[notifyTarget])];

  // team_leader / department_manager / management → the tenant's managers+admins.
  const roles = notifyTarget === 'management' ? ['Admin', 'Owner'] : ['Manager', 'Admin', 'Owner'];
  try {
    const snap = await db.collection('teamMembers')
      .where('businessId', '==', report.businessId)
      .where('role', 'in', roles)
      .limit(8)
      .get();
    const uids = snap.docs
      .filter(d => (d.data()?.status ?? 'Active') !== 'Inactive')
      .map(d => String(d.data()?.userId || ''))
      .filter(Boolean);
    return Array.from(new Set(uids));
  } catch {
    return report.authorUserId ? [String(report.authorUserId)] : [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// JOB: client-health-rollup — persist a snapshot per client per month
// ─────────────────────────────────────────────────────────────────────────────

export async function runClientHealthRollup(): Promise<{ written: number; tenants: number }> {
  const now = new Date();
  const periodKey = toIso(now).slice(0, 7);
  let written = 0;

  // Walk businesses, then read each tenant's own data — never a cross-tenant scan.
  const businesses = await db.collection('businesses').get();

  for (const biz of businesses.docs) {
    const businessId = biz.id;
    if ((biz.data()?.status || 'active') === 'suspended') continue;

    try {
      const [customers, reports, invoices, requests] = await Promise.all([
        db.collection('customers').where('businessId', '==', businessId).get(),
        db.collection('reports').where('businessId', '==', businessId).get(),
        db.collection('invoices').where('businessId', '==', businessId).get(),
        db.collection('clientRequests').where('businessId', '==', businessId).get(),
      ]);
      if (customers.empty) continue;

      const byCustomer = <T extends admin.firestore.QuerySnapshot>(snap: T, cid: string) =>
        snap.docs.filter(d => d.data()?.customerId === cid);

      const batch = db.batch();
      let batched = 0;

      for (const custDoc of customers.docs) {
        const cid = custDoc.id;
        const cust = custDoc.data() as any;

        const custReports = byCustomer(reports, cid).map(d => d.data() as any);
        const published = custReports.filter(r => PUBLISHED_SET.has(String(r.status)));
        const periodReports = custReports.filter(r => String(r.period?.key || '').startsWith(periodKey));
        const overdueInvoices = byCustomer(invoices, cid)
          .filter(d => {
            const inv = d.data() as any;
            const due = inv.dueDate?.toDate?.();
            return inv.status !== 'Paid' && due && due.getTime() < now.getTime();
          }).length;
        const openRequests = byCustomer(requests, cid)
          .filter(d => (d.data()?.status || '') !== 'Completed').length;
        const pendingApprovals = published
          .filter(r => !r.acknowledgedAt && !r.clientDecisionAt).length;

        const latest = published
          .sort((a, b) => (b.publishedAt?.toMillis?.() || 0) - (a.publishedAt?.toMillis?.() || 0))[0];
        const attainments: number[] = (latest?.kpiValues || [])
          .filter((k: any) => k.clientVisible && typeof k.value === 'number'
            && typeof k.target === 'number' && k.target !== 0)
          .map((k: any) => (k.higherIsBetter === false
            ? Math.min(2, k.target / Math.max(1e-9, k.value))
            : k.value / k.target));

        const health = computeHealth({
          kpiAttainment: attainments.length
            ? attainments.reduce((a, b) => a + b, 0) / attainments.length : null,
          reportsDelivered: periodReports.filter(r => PUBLISHED_SET.has(String(r.status))).length,
          reportsDue: periodReports.length,
          openIssues: openRequests,
          overdueClientApprovals: pendingApprovals,
          overdueInvoices,
        });
        if (!health.factors.length) continue;

        // Deterministic id → a re-run overwrites its own row, never duplicates.
        const ref = db.collection('clientHealthScores').doc(`${businessId}_${cid}_${periodKey}`);
        batch.set(ref, {
          businessId,
          customerId: cid,
          customerName: cust.name || null,
          periodKey,
          score: health.score,
          category: health.category,
          factors: health.factors,
          computedAt: admin.firestore.Timestamp.now(),
          createdAt: admin.firestore.Timestamp.now(),
          updatedAt: admin.firestore.Timestamp.now(),
          createdByUserId: null,
        }, { merge: true });
        batched++;
        written++;

        if (batched >= 400) {
          await batch.commit();
          batched = 0;
        }
      }
      if (batched > 0) await batch.commit();
    } catch (err) {
      console.error(`[client-health-rollup] ${businessId} failed:`, err);
    }
  }

  console.log(`[client-health-rollup] written=${written} tenants=${businesses.size}`);
  return { written, tenants: businesses.size };
}

const PUBLISHED_SET = new Set([
  'published', 'sent', 'viewed', 'acknowledged', 'client_approved', 'client_rejected',
]);

/** Compact mirror of src/lib/reporting/health.ts `computeClientHealth`. */
function computeHealth(s: {
  kpiAttainment: number | null;
  reportsDelivered: number;
  reportsDue: number;
  openIssues: number;
  overdueClientApprovals: number;
  overdueInvoices: number;
}) {
  const weights = { results: 22, reporting: 12, issues: 8, approvals: 6, payments: 8 };
  const decay = (count: number, tolerance: number) =>
    (count <= 0 ? 1 : Math.max(0, Math.min(1, 1 - count / Math.max(1, tolerance))));

  const factors: Array<{ key: string; label: string; detail: string; score: number; weight: number; impact: number }> = [];
  const add = (key: keyof typeof weights, label: string, score: number | null, detail: string) => {
    if (score === null || Number.isNaN(score)) return;
    factors.push({ key, label, detail, score: Math.max(0, Math.min(1, score)), weight: weights[key], impact: 0 });
  };

  if (s.kpiAttainment !== null) {
    add('results', 'Rezultatet ndaj objektivave', Math.min(1, s.kpiAttainment),
      `${Math.round(s.kpiAttainment * 100)}% e targetit`);
  }
  if (s.reportsDue > 0) {
    add('reporting', 'Konsistenca e raportimit', Math.min(1, s.reportsDelivered / s.reportsDue),
      `${s.reportsDelivered}/${s.reportsDue} raporte`);
  }
  add('issues', 'Probleme të hapura', decay(s.openIssues, 4), `${s.openIssues} probleme`);
  add('approvals', 'Aprovime të vonuara', decay(s.overdueClientApprovals, 3), `${s.overdueClientApprovals} aprovime`);
  add('payments', 'Pagesa në kohë', decay(s.overdueInvoices, 2), `${s.overdueInvoices} fatura vonuar`);

  const totalWeight = factors.reduce((a, f) => a + f.weight, 0);
  if (!totalWeight) return { score: 0, category: 'attention' as const, factors: [] };
  const score = Math.round((factors.reduce((a, f) => a + f.score * f.weight, 0) / totalWeight) * 100);
  const withImpact = factors.map(f => ({
    ...f, impact: Math.round((f.score * f.weight / totalWeight) * 1000) / 10,
  }));
  const category = score >= 85 ? 'excellent'
    : score >= 70 ? 'healthy'
      : score >= 55 ? 'attention'
        : score >= 35 ? 'at_risk' : 'critical';
  return { score, category, factors: withImpact };
}

// ─────────────────────────────────────────────────────────────────────────────
// JOB: report-metrics-social — socialSnapshots → reportMetrics
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Turns the monthly Facebook/Instagram snapshots into reporting KPI values, so a
 * monthly client report can carry real social figures instead of hand-typed ones.
 *
 * Purely ADDITIVE: `/app/social` keeps sending its own monthly email exactly as
 * before (the owner chose to keep it), and this job only writes `reportMetrics`.
 * Nothing here reads or changes that email path.
 *
 * Idempotent: the document id is `${businessId}_customer:${customerId}_${periodKey}`,
 * so a re-run overwrites its own row. `merge: true` means a re-run also cannot wipe
 * metrics that another source (manual entry, a future GA4 adapter) put in the same
 * period — only the social keys are rewritten.
 *
 * Mirrors src/lib/reporting/sources/social.ts. Duplicated because /api is bundled
 * separately and must not import the React-side module graph; the unit tests over
 * there are the specification for these numbers.
 */
const SOCIAL_KPI_KEYS = [
  'social_reach', 'social_impressions', 'engagement', 'engagement_rate',
  'followers_gained', 'followers_lost', 'net_follower_growth',
  'profile_visits', 'link_clicks', 'posts_published',
] as const;

function sumOrNull(list: any[], pick: (m: any) => unknown): number | null {
  let total = 0;
  let seen = false;
  for (const s of list) {
    const v = pick(s.metrics || {});
    if (typeof v === 'number' && Number.isFinite(v)) { total += v; seen = true; }
  }
  return seen ? total : null;
}

/** Mirror of mapSocialSnapshotsToKpis. A metric the platform did not return stays null. */
function mapSocialToKpis(list: any[]): Record<string, number | null> {
  const reach = sumOrNull(list, m => m.reach);
  const engagement = sumOrNull(list, m => m.engagement);

  let gained = 0, lost = 0, net = 0, growthSeen = false;
  for (const s of list) {
    const g = (s.metrics || {}).followerGrowth;
    if (typeof g !== 'number' || !Number.isFinite(g)) continue;
    growthSeen = true;
    net += g;
    if (g >= 0) gained += g; else lost += Math.abs(g);
  }

  return {
    social_reach: reach,
    social_impressions: sumOrNull(list, m => m.impressions),
    engagement,
    // Recomputed from the sums — averaging two ratios over different audience sizes
    // describes neither account.
    engagement_rate: engagement !== null && reach !== null && reach > 0
      ? Math.round((engagement / reach) * 10000) / 100
      : null,
    followers_gained: growthSeen ? gained : null,
    followers_lost: growthSeen ? lost : null,
    net_follower_growth: growthSeen ? net : null,
    profile_visits: sumOrNull(list, m => m.profileViews),
    link_clicks: sumOrNull(list, m => m.linkClicks),
    posts_published: sumOrNull(list, m => m.postsCount),
  };
}

export async function runReportMetricsSocial(
  periodKey?: string,
): Promise<{ written: number; skipped: number; period: string }> {
  // Default to the month that just ended, which is what the social sync fetches.
  const now = new Date();
  const target = periodKey || (() => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
  })();

  // Range-free equality on an indexed field, scoped to one period — never a scan of
  // every snapshot ever taken.
  const snaps = await db.collection('socialSnapshots').where('period', '==', target).get();
  if (snaps.empty) {
    console.log(`[report-metrics-social] no snapshots for ${target}`);
    return { written: 0, skipped: 0, period: target };
  }

  // Group by tenant + customer. A client usually has both a page and an IG account.
  const groups = new Map<string, any[]>();
  for (const d of snaps.docs) {
    const data = d.data() as any;
    const businessId = data.businessId || data.teamId;
    if (!businessId || !data.customerId) continue;
    const key = `${businessId}|${data.customerId}`;
    groups.set(key, [...(groups.get(key) || []), data]);
  }

  let written = 0;
  let skipped = 0;

  for (const [key, list] of groups) {
    const [businessId, customerId] = key.split('|');
    const values = mapSocialToKpis(list);

    // Every metric null means the API returned nothing usable. Writing that row would
    // claim "we measured and found nothing", which is not what happened.
    if (!Object.values(values).some(v => v !== null)) { skipped++; continue; }

    const origins: Record<string, string> = {};
    for (const k of SOCIAL_KPI_KEYS) if (values[k] !== null) origins[k] = 'social:meta';

    const first = list[0];
    const ref = db.collection('reportMetrics').doc(`${businessId}_customer:${customerId}_${target}`);
    try {
      await ref.set(stripUndefined({
        businessId,
        customerId,
        service: 'social',
        periodKey: target,
        periodStart: `${target}-01`,
        periodEnd: toIso(new Date(Date.UTC(
          Number(target.slice(0, 4)), Number(target.slice(5, 7)), 0,
        ))),
        // Dotted paths would be needed to merge INTO maps; instead the whole social
        // slice is rewritten while `merge: true` preserves sibling top-level fields.
        values,
        origins,
        syncedAt: admin.firestore.Timestamp.now(),
        updatedAt: admin.firestore.Timestamp.now(),
        createdAt: admin.firestore.Timestamp.now(),
        createdByUserId: null,
      }), { merge: true });
      written++;
    } catch (err) {
      console.error(`[report-metrics-social] ${key} failed:`, err);
    }
  }

  console.log(`[report-metrics-social] period=${target} written=${written} skipped=${skipped}`);
  return { written, skipped, period: target };
}

// ── shared helpers ────────────────────────────────────────────────────────────

async function notify(
  userId: string | null | undefined,
  businessId: string,
  title: string,
  message: string,
  reportId: string | null,
) {
  if (!userId) return;
  try {
    await db.collection('notifications').add({
      userId,
      type: 'report',
      title,
      message,
      ...(reportId ? { actionUrl: `/app/reports/${reportId}`, actionLabel: 'Hap raportin' } : {}),
      isRead: false,
      businessId,
      createdAt: admin.firestore.Timestamp.now(),
    });
  } catch (err) {
    console.error('[reportJobs] notify failed', err);
  }
}

async function appendEvent(
  businessId: string,
  reportId: string | null,
  kind: string,
  extra: Record<string, unknown> = {},
) {
  try {
    await db.collection('reportEvents').add({
      businessId,
      reportId: reportId || null,
      kind,
      actorType: 'system',
      actorUserId: null,
      createdAt: admin.firestore.Timestamp.now(),
      createdByUserId: null,
      ...extra,
    });
  } catch { /* auditing must never break the job */ }
}
