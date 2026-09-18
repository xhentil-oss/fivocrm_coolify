import { safeSenderAddress } from '../_emailIdentity.js';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import nodemailer from 'nodemailer';
import { buildInvoiceEmail, publicInvoicePayUrl } from '../_invoiceEmail.js';
import admin, { adminDb as db, adminAuth } from '../_firebaseAdmin.js';
import { runWhmcsSync, runWhmcsClientSync } from '../_whmcsSync.js';
import { sendBulkEmail, renderMergeTokens } from '../_mailer.js';
import { syncAllAccounts, currentPeriod } from '../_social.js';
import { sendReportsForPeriod } from '../_socialEmail.js';
import { syncAllGmbAccounts } from '../_gmb.js';
// Credentials live in `teamSecrets` (client-unreadable), NOT in `teamSettings`.
// Always resolve tenant config through getTeamConfig so secrets are merged in.
import { getTeamConfig, SECRET_FIELDS, writeTeamSecrets } from '../_tenantConfig.js';
// Follow-up thresholds (SLA hours, stale days, cadence) — byte-identical mirror
// of src/lib/crm/followUpConfig.ts; the UI resolves the same settings the same way.
import { resolveFollowUpConfig } from '../_followUpConfig.js';
import { resolvePlaybooks, nextPlaybookStep, renderPlaybookTemplate, type Playbook } from '../_playbooks.js';
import { syncTenantClaims } from '../_tenantClaims.js';
import { writeAudit } from '../_audit.js';
// Reporting module jobs. Kept in their own file: they are self-contained,
// idempotent, and this file is already 3.4k lines.
import { runReportSchedules, runReportReminders, runClientHealthRollup, runReportMetricsSocial } from '../_reportJobs.js';
import { runCrmAutomations } from '../_crmAutomationJob.js';
// Hosting & domains module (cPanel/WHM + Dynadot): lifecycle + sync. Own file — it
// talks to live servers and registrars and is NOT part of run-all.
import { runHostingLifecycle, runHostingSync, runHostingBackups, runHostingExpiryReport } from '../_hostingJobs.js';
// "Who are this tenant's managers" — one resolver, shared with _gmb and _waInbound.
import { managerIdsForBusiness } from '../_staffRecipients.js';
import { sendBaileysText } from '../_waSend.js';
import {
  INVOICE_WA_DEFAULT_TZ, resolveInvoiceWaConfig, invoiceWaDecision, invoiceWaStageField, invoiceWaDueText,
  renderInvoiceWaText, invoiceWaFirstName, normalizeInvoiceWaPhone, formatInvoiceWaAmount, tallyInvoiceWaBlocked,
  type InvoiceWaBlockReason,
} from '../_invoiceWaReminders.js';
// One delivery path for every notification — see the header of api/_push.ts.
import { notifyUser, getUserPrefs, isDndActive, isSilenced, escapeHtml, BASE_URL } from '../_push.js';
import { isTypeMutedByPrefs } from '../_notificationTypes.js';
// `.js` is NOT optional here: package.json declares "type": "module", so the
// deployed function runs as native ESM, where a relative specifier without an
// extension throws ERR_MODULE_NOT_FOUND at LOAD time — taking down every job in
// this file before the handler is even reached. `npm run typecheck:api` cannot
// catch it (tsconfig.api.json uses moduleResolution "node"), so the guard is
// src/lib/apiImports.test.ts.
import { formatMoney } from '../_money.js';

// ── Auth helper ───────────────────────────────────────────────────────────────
function authorize(req: VercelRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;
  return !!(cronSecret && req.headers.authorization === `Bearer ${cronSecret}`);
}

// Manual admin trigger: verify Firebase ID token + admin role
// Returns null on success, or an error string describing why auth failed.
async function authorizeManual(req: VercelRequest): Promise<string | null> {
  const authHeader = req.headers.authorization as string;
  if (!authHeader?.startsWith('Bearer ')) return 'Missing Authorization header';
  const token = authHeader.slice(7);
  let uid: string;
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    uid = decoded.uid;
  } catch (err: any) {
    const msg = err?.message || String(err);
    console.error('[manual-auth] verifyIdToken failed:', msg);
    return `Token invalid: ${msg}`;
  }
  try {
    const snap = await db.collection('teamMembers')
      .where('userId', '==', uid)
      .limit(10)
      .get();
    const roles = snap.docs.map(d => d.data().role as string);
    console.log(`[manual-auth] uid=${uid} roles=[${roles.join(', ') || 'none'}]`);
    // Accept Admin OR Owner — matches the Settings tab gating (isAdmin || isOwner).
    if (roles.some(r => r === 'Admin' || r === 'Owner')) return null;
    // Fallback: a team OWNER (createdByUserId) is privileged even without an Admin
    // teamMember role (or any teamMember doc) — covers the agency super-admin.
    const ownedTeam = await db.collection('teams').where('createdByUserId', '==', uid).limit(1).get();
    if (!ownedTeam.empty) return null;
    return `Not Admin/Owner and owns no team (roles: ${roles.join(', ') || 'none'})`;
  } catch (err: any) {
    const msg = err?.message || String(err);
    console.error('[manual-auth] Firestore query failed:', msg);
    return `Firestore error: ${msg}`;
  }
}

// Verify the caller holds the server-trustworthy super-admin custom claim.
// Used to gate destructive cross-tenant jobs (e.g. the member-key re-key migration)
// so a mere team Admin can't trigger them.
/** The uid behind a manual trigger, or null for the scheduled cron. */
async function callerUid(req: VercelRequest): Promise<string | null> {
  const authHeader = req.headers.authorization as string | undefined;
  if (!authHeader?.startsWith('Bearer ')) return null;
  try {
    const decoded = await adminAuth.verifyIdToken(authHeader.slice(7));
    return decoded.uid;
  } catch {
    return null;
  }
}

/**
 * The tenant a manual trigger belongs to, from the server-minted `bid` claim
 * (falling back to a membership lookup for tokens that predate the rollout).
 *
 * Money jobs must be scoped to it. `recurring-invoices` iterated `invoices` and
 * `projects` across EVERY tenant, so one tenant's Admin pressing "Gjenero
 * Periodike" generated — and emailed — invoices to every other tenant's
 * customers, at a moment those tenants never chose.
 */
async function callerBusinessId(req: VercelRequest): Promise<string | null> {
  const authHeader = req.headers.authorization as string | undefined;
  if (!authHeader?.startsWith('Bearer ')) return null;
  try {
    const decoded = await adminAuth.verifyIdToken(authHeader.slice(7));
    const bid = (decoded as any).bid;
    if (typeof bid === 'string' && bid) return bid;
    const snap = await db.collection('teamMembers')
      .where('userId', '==', decoded.uid).limit(10).get();
    for (const d of snap.docs) {
      const b = d.data().businessId;
      if (typeof b === 'string' && b) return b;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * The tenant a MANUAL run is confined to, or null when the run is the platform's
 * own scheduled tick (and for a super-admin). Returned as a sentinel rather than
 * throwing so each case can answer with its own Albanian message.
 *
 * `authorizeManual` accepts any Admin/Owner of any team, so without this a
 * tenant's own "Ekzekuto Tani" button reached every other tenant's data — and,
 * for the jobs that mail or WhatsApp, every other tenant's customers.
 */
const MANUAL_SCOPE_UNRESOLVED = '__manual_scope_unresolved__';
async function manualScopeId(req: VercelRequest, isManual: boolean): Promise<string | null> {
  if (!isManual) return null;
  if (await callerIsSuperAdmin(req)) return null;
  return (await callerBusinessId(req)) || MANUAL_SCOPE_UNRESOLVED;
}

async function callerIsSuperAdmin(req: VercelRequest): Promise<boolean> {
  const authHeader = req.headers.authorization as string;
  if (!authHeader?.startsWith('Bearer ')) return false;
  try {
    const decoded = await adminAuth.verifyIdToken(authHeader.slice(7));
    return decoded.superAdmin === true;
  } catch {
    return false;
  }
}

// ── settleAll: Promise.allSettled with error logging ─────────────────────────
async function settleAll(ops: Promise<any>[], jobName: string): Promise<void> {
  const results = await Promise.allSettled(ops);
  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      console.error(`[CRON:${jobName}] op[${i}] dështoi:`, r.reason);
    }
  });
}

// ── Notifications ─────────────────────────────────────────────────────────────
// Delivery lives in api/_push.ts and is shared with the browser choke point, so a
// cron notification now behaves exactly like one raised from the UI: it is written,
// pushed to EVERY registered device and emailed, through one set of preference
// gates. Twelve of the sites below used to write the document and nothing else,
// which made them invisible unless the user happened to open the app.
//
// Every former `db.collection('notifications').add(...)` + ad-hoc `sendPush` pair in
// this file is now a single notifyUser() call.

// ── SMTP helper ───────────────────────────────────────────────────────────────
function makeTransporter() {
  const smtpUser = safeSenderAddress(process.env.SMTP_USER);
  const smtpPass = process.env.SMTP_PASS;
  if (!smtpUser || !smtpPass) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'mail.fivoo.net',
    port: Number(process.env.SMTP_PORT) || 465,
    secure: true,
    auth: { user: smtpUser, pass: smtpPass },
  });
}

// ── addFrequency (for recurring tasks) ───────────────────────────────────────
// MIRROR of `addFrequency` in src/lib/recurringUtils.ts (api/ never imports from
// src/). That module carries the reasoning and the tests; two things were out of
// sync here and both changed the next cycle a task got:
//
//  1. The day math read the MACHINE's timezone. This process is UTC on Vercel
//     while the browser is UTC+2, so the same task resolved to a different
//     weekday in each — the client and this backstop disagreed about the next
//     cycle. Now both do the arithmetic in Europe/Tirane.
//  2. The weekly snap was `+ diff`, which can move the date BACKWARDS and yield
//     an interval shorter than 7 days. The client was fixed to `(diff + 7) % 7`
//     (forward only); this copy never got it.
const RECURRENCE_TIMEZONE = 'Europe/Tirane';

function recurrenceZoneOffsetMs(at: Date): number {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone: RECURRENCE_TIMEZONE, timeZoneName: 'longOffset' });
    const part = fmt.formatToParts(at).find((p) => p.type === 'timeZoneName')?.value || '';
    const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(part);
    if (!m) return 0;
    const sign = m[1] === '-' ? -1 : 1;
    return sign * (Number(m[2]) * 60 + Number(m[3] || 0)) * 60_000;
  } catch {
    return 0;
  }
}
/** Civil (wall-clock) time in the recurrence zone, read through the UTC getters. */
function toRecurrenceZone(at: Date): Date {
  return new Date(at.getTime() + recurrenceZoneOffsetMs(at));
}
/** Inverse; two passes so a date crossing a DST switch keeps its wall-clock time. */
function fromRecurrenceZone(zoned: Date): Date {
  const guess = new Date(zoned.getTime() - recurrenceZoneOffsetMs(zoned));
  return new Date(zoned.getTime() - recurrenceZoneOffsetMs(guess));
}
/** Start of the calendar day in the recurrence zone, as a comparable number. */
function startOfRecurrenceDay(x: Date): number {
  const z = toRecurrenceZone(x);
  z.setUTCHours(0, 0, 0, 0);
  return z.getTime();
}

/**
 * The per-tenant job switches from Cilësimet → Automatizime.
 *
 * They are stored on `teamSettings.cronSettings.<key>.enabled` and, until this
 * existed, were written by the UI and read by NOBODY — so a tenant who switched
 * "Kujtesa faturash" off kept dunning their customers every day, and a tenant
 * who switched recurring tasks off kept getting them. Absent means ON, matching
 * the UI's own `?? true` default, so a tenant that never touched a switch is
 * unaffected.
 *
 * Returns a cached per-run reader: one `teamSettings` read per team, not one
 * per document, because a job iterates thousands of rows across a few teams.
 */
type CronToggleKey = 'task_alerts' | 'task_reminders' | 'invoice_reminders' | 'whmcs_sync' | 'recurring_tasks';
function cronToggleReader(key: CronToggleKey) {
  const cache = new Map<string, boolean>();
  return async (teamId: string | null | undefined): Promise<boolean> => {
    if (!teamId) return true;
    const cached = cache.get(teamId);
    if (cached !== undefined) return cached;
    let enabled = true;
    try {
      const snap = await db.collection('teamSettings').doc(teamId).get();
      enabled = (snap.data() as any)?.cronSettings?.[key]?.enabled !== false;
    } catch { /* a failed lookup must never silence a job for everyone */ }
    cache.set(teamId, enabled);
    return enabled;
  };
}

/** Calendar fields of an instant, read in the business zone. Mirrors
 *  `zonedParts` in src/lib/recurringUtils.ts. */
function zonedParts(at: Date): {
  year: number; month: number; day: number;
  hours: number; minutes: number; seconds: number; ms: number; weekday: number;
} {
  const z = toRecurrenceZone(at);
  return {
    year: z.getUTCFullYear(), month: z.getUTCMonth(), day: z.getUTCDate(),
    hours: z.getUTCHours(), minutes: z.getUTCMinutes(),
    seconds: z.getUTCSeconds(), ms: z.getUTCMilliseconds(), weekday: z.getUTCDay(),
  };
}

/** The instant at which the business zone shows this wall-clock time. */
function zonedDate(year: number, month: number, day: number,
                   hours = 0, minutes = 0, seconds = 0, ms = 0): Date {
  return fromRecurrenceZone(new Date(Date.UTC(year, month, day, hours, minutes, seconds, ms)));
}

/** Days in the business zone's calendar month containing (year, month). */
function daysInZonedMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/** `from` shifted by whole zone days, keeping its wall-clock time of day. */
function addZonedDays(from: Date, days: number): Date {
  const p = zonedParts(from);
  return zonedDate(p.year, p.month, p.day + days, p.hours, p.minutes, p.seconds, p.ms);
}

/** `from` shifted by whole zone years, keeping its wall-clock time of day. */
function addZonedYears(from: Date, years: number): Date {
  const p = zonedParts(from);
  return zonedDate(p.year + years, p.month, p.day, p.hours, p.minutes, p.seconds, p.ms);
}

/** Add months in the business zone, clamped (31 Jan + 1 = 28/29 Feb, never 3 Mar). */
function addZonedMonthsClamped(from: Date, months: number, anchorDay?: number): Date {
  const p = zonedParts(from);
  const day = anchorDay ?? p.day;
  const targetYear = p.year + Math.floor((p.month + months) / 12);
  const targetMonth = ((p.month + months) % 12 + 12) % 12;
  const lastDay = daysInZonedMonth(targetYear, targetMonth);
  return zonedDate(targetYear, targetMonth, Math.min(day, lastDay), p.hours, p.minutes, p.seconds, p.ms);
}

/** Monday 00:00 (business zone) of the week `at` falls in. */
function startOfZonedWeek(at: Date): Date {
  const p = zonedParts(at);
  const backToMonday = p.weekday === 0 ? 6 : p.weekday - 1;
  return zonedDate(p.year, p.month, p.day - backToMonday);
}

/**
 * The last instant of a due DAY, in the business zone. A due date is a calendar
 * promise ("pay by the 30th"), so nothing is late until that day has ended
 * where the customer lives — comparing a local-midnight `dueDate` against `now`
 * marked an invoice overdue at 00:00 of the day it was due.
 */
function endOfBillingDay(x: Date): Date {
  const z = toRecurrenceZone(x);
  z.setUTCHours(23, 59, 59, 999);
  return fromRecurrenceZone(z);
}

function addFrequency(date: Date, frequency: string, dayOfWeek?: number, dayOfMonth?: number, interval = 1, daysOfWeek?: number[]): Date {
  const d = toRecurrenceZone(date);
  const step = Math.max(1, Math.round(interval));
  if (frequency === 'daily') {
    d.setUTCDate(d.getUTCDate() + step);
    // If specific weekdays are configured, advance until we land on one
    if (daysOfWeek && daysOfWeek.length > 0) {
      let tries = 0;
      while (!daysOfWeek.includes(d.getUTCDay()) && tries < 7) {
        d.setUTCDate(d.getUTCDate() + 1);
        tries++;
      }
    }
  } else if (frequency === 'weekly') {
    d.setUTCDate(d.getUTCDate() + 7 * step);
    if (dayOfWeek !== undefined && dayOfWeek !== null) {
      const diff = dayOfWeek - d.getUTCDay();
      // Forward only — see note 2 above.
      if (diff !== 0) d.setUTCDate(d.getUTCDate() + ((diff + 7) % 7));
    }
  } else if (frequency === 'monthly') {
    d.setUTCMonth(d.getUTCMonth() + step);
    if (dayOfMonth !== undefined && dayOfMonth !== null) {
      const maxDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
      d.setUTCDate(Math.min(dayOfMonth, maxDay));
    }
  } else if (frequency === 'yearly') {
    d.setUTCFullYear(d.getUTCFullYear() + step);
  }
  return fromRecurrenceZone(d);
}


/**
 * Tenant-scoped audience read for campaigns/broadcasts.
 *
 * These jobs used to read `leads`/`customers`/`domains` in FULL for every campaign,
 * on the (once-true, now false) assumption that those collections were not
 * tenant-isolated. Two problems: a tenant's broadcast could reach ANOTHER tenant's
 * contacts, and the read cost of one campaign scaled with the whole platform.
 * Everything now filters by the campaign's own businessId, with a teamId fallback for
 * legacy docs created before the business layer.
 */
async function tenantScopedDocs(
  collection: string,
  scope: { businessId?: string | null; teamId?: string | null },
): Promise<Array<{ id: string; data: any }>> {
  const out: Array<{ id: string; data: any }> = [];
  const seen = new Set<string>();
  const push = (snap: admin.firestore.QuerySnapshot) => {
    for (const d of snap.docs) {
      if (seen.has(d.id)) continue;
      seen.add(d.id);
      out.push({ id: d.id, data: d.data() });
    }
  };
  if (scope.businessId) {
    push(await db.collection(collection).where('businessId', '==', scope.businessId).get());
  }
  // Legacy docs stamped only with teamId (pre-businessId backfill).
  if (scope.teamId && scope.teamId !== scope.businessId) {
    push(await db.collection(collection).where('teamId', '==', scope.teamId).get());
  }
  if (!scope.businessId && !scope.teamId) {
    // Fail closed rather than fanning out across tenants.
    console.warn(`[cron] ${collection} audience skipped: campaign has no tenant key`);
  }
  return out;
}

// ── JOB: task-deadline-alerts ─────────────────────────────────────────────────
async function runTaskDeadlineAlerts() {
  const transporter = makeTransporter();
  const smtpUser = safeSenderAddress(process.env.SMTP_USER);
  const alertsEnabledFor = cronToggleReader('task_alerts');
  let toggledOffSkipped = 0;
  const now = new Date();
  const alertThreshold = new Date(now);
  alertThreshold.setDate(alertThreshold.getDate() + 2);
  alertThreshold.setHours(23, 59, 59, 999);

  // Fetch tasks not yet fully alerted. We use TWO stage flags so a task that was
  // alerted as "due soon" still gets a fresh "overdue" alert once it passes its
  // deadline (the old single `dueNotificationSent` flag suppressed that). Legacy
  // tasks (missing overdueNotificationSent) are caught for a one-time overdue alert.
  // Only tasks whose deadline is already inside the alert window can produce an
  // alert, so the range filter does the work Firestore is good at. Previously this
  // read EVERY task of EVERY tenant on every run.
  //
  // Lower bound too: without it the read set was "every past-dated task ever,
  // platform-wide, incl. Done and already-alerted ones", growing forever. A task
  // overdue by 60+ days has either been alerted (flag set within the window) or
  // is dead — same-field range, so no composite index is needed.
  const overdueFloor = new Date(now);
  overdueFloor.setDate(overdueFloor.getDate() - 60);
  const tasksSnap = await db.collection('tasks')
    .where('endDate', '>=', admin.firestore.Timestamp.fromDate(overdueFloor))
    .where('endDate', '<=', admin.firestore.Timestamp.fromDate(alertThreshold))
    .get();
  let notified = 0;
  const ops: Promise<any>[] = [];

  for (const doc of tasksSnap.docs) {
    const task = doc.data();
    if (!(await alertsEnabledFor(task.teamId))) { toggledOffSkipped++; continue; }
    if (!task.endDate || task.status === 'Done') continue;
    const recipientId = task.assignedToUserId || task.createdByUserId;
    if (!recipientId) continue;
    const endDate: Date = task.endDate?.toDate ? task.endDate.toDate() : new Date(task.endDate);
    if (isNaN(endDate.getTime())) continue;

    const isOverdue = endDate < now;
    const isDueSoon = endDate <= alertThreshold;
    if (!isOverdue && !isDueSoon) continue;

    const dueSent = task.dueNotificationSent === true;
    const overdueSent = task.overdueNotificationSent === true;
    // Decide which alert (if any) is owed: overdue takes priority and fires once
    // even if a due-soon alert was already sent.
    let stage: 'overdue' | 'due_soon' | null = null;
    if (isOverdue && !overdueSent) stage = 'overdue';
    else if (isDueSoon && !isOverdue && !dueSent) stage = 'due_soon';
    if (!stage) continue;

    // CALENDAR days in the recurrence zone, not an hour-based ceil — Math.ceil
    // returned ≥1 for any future time-of-day, so "skadon sot" was unreachable
    // (a task due later today always said "për 1 ditë").
    const dayDiff = Math.round((startOfRecurrenceDay(endDate) - startOfRecurrenceDay(now)) / 86400000);
    const overdueByDays = Math.max(1, -dayDiff);
    const isOverdueAlert = stage === 'overdue';
    const notifTitle = isOverdueAlert ? `⚠️ Detyrë e skaduara: ${task.title}` : `⏰ Afati afrohet: ${task.title}`;
    const notifMessage = isOverdueAlert
      ? `Detyra "${task.title}" ka kaluar afatin prej ${overdueByDays} ditë.`
      : `Detyra "${task.title}" skadon ${dayDiff <= 0 ? 'sot' : `për ${dayDiff} ditë`}.`;

    // Doc + push (every registered device), through the shared preference gates.
    // Deep link to the task itself (mirrors taskDeepLink in src/lib/deepLinks.ts —
    // api/ never imports from src/): a project task opens on its project page.
    ops.push(notifyUser({
      userId: recipientId,
      type: isOverdueAlert ? 'task_overdue' : 'task_due_soon',
      title: notifTitle,
      message: notifMessage,
      actionUrl: task.projectId
        ? `/app/projects/${task.projectId}?taskId=${doc.id}`
        : `/app/tasks?taskId=${doc.id}`,
      actionLabel: 'Shiko Detyrën',
      businessId: task.businessId ?? null,
      teamId: task.teamId ?? null,
      projectId: task.projectId ?? null,
      email: false, // the richer, styled email is sent just below
    }));
    // Mark the stage(s) consumed. An overdue alert also implies due-soon is done.
    ops.push(doc.ref.update(isOverdueAlert ? { dueNotificationSent: true, overdueNotificationSent: true } : { dueNotificationSent: true }));

    // Email respects the channel toggle + Do-Not-Disturb + category mute (push is
    // already handled by notifyUser above).
    const prefs = await getUserPrefs(recipientId);

    if (transporter && smtpUser && prefs?.emailEnabled !== false
        && !isSilenced(prefs, isOverdueAlert ? 'task_overdue' : 'task_due_soon')) {
      try {
        const userRecord = await admin.auth().getUser(recipientId);
        if (userRecord.email) {
          ops.push(transporter.sendMail({ from: `"FivoCRM" <${smtpUser}>`, to: userRecord.email, subject: notifTitle, html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;"><h2 style="color:${isOverdueAlert ? '#ef4444' : '#f59e0b'}">${notifTitle}</h2><p>${notifMessage}</p><p style="color:#9ca3af;font-size:12px">FivoCRM – Njoftime automatike</p></div>` }));
        }
      } catch { /* skip */ }
    }
    notified++;
  }

  await settleAll(ops, 'task-deadline-alerts');
  return { notified, toggledOffSkipped };
}

// ── JOB: task-reminders ("Më kujto") ─────────────────────────────────────────
// Delivers the reminder a person set on their own task, at the moment they
// chose — Asana/Salesforce style. Runs every 5 minutes from the VPS (NOT in
// run-all: "15:00" is a wall-clock promise, a daily tick cannot keep it).
//
// Reads ONLY tasks whose reminderAt is inside [now − 48h, now]: a same-field
// range, so no composite index and no per-tenant fan-out. Anything older than
// the look-back was missed by a long outage and is stale, not owed — Salesforce
// drops those too. Idempotent per task via `reminderSentAt`.
//
// MIRRORS taskReminderBlockReason() in src/lib/taskReminders.ts — keep in sync.
const TASK_REMINDER_LOOKBACK_MS = 48 * 60 * 60 * 1000;

function taskReminderBlockReason(task: any, now: Date): string | null {
  if (task.reminderAt === null || task.reminderAt === undefined) return 'no-reminder';
  const at: Date | null = task.reminderAt?.toDate ? task.reminderAt.toDate() : new Date(task.reminderAt);
  if (!at || isNaN(at.getTime())) return 'invalid-date';
  if (task.status === 'Done') return 'task-done';
  if (task.reminderSentAt) return 'already-sent';
  if (at.getTime() > now.getTime()) return 'not-yet';
  return null;
}

async function runTaskReminders() {
  const remindersEnabledFor = cronToggleReader('task_reminders');
  let toggledOffSkipped = 0;
  const now = new Date();
  const floor = new Date(now.getTime() - TASK_REMINDER_LOOKBACK_MS);
  const snap = await db.collection('tasks')
    .where('reminderAt', '>=', admin.firestore.Timestamp.fromDate(floor))
    .where('reminderAt', '<=', admin.firestore.Timestamp.fromDate(now))
    .get();

  let sent = 0;
  const blocked: Record<string, number> = {};
  const ops: Promise<any>[] = [];
  const sqMonths = ['jan', 'shk', 'mar', 'pri', 'maj', 'qer', 'kor', 'gus', 'sht', 'tet', 'nën', 'dhj'];

  for (const doc of snap.docs) {
    const task = doc.data();
    if (!(await remindersEnabledFor(task.teamId))) { toggledOffSkipped++; continue; }
    const reason = taskReminderBlockReason(task, now);
    if (reason) { blocked[reason] = (blocked[reason] || 0) + 1; continue; }

    const recipientId = task.assignedToUserId || task.createdByUserId;
    if (!recipientId) {
      // Nobody to remind — mark it so the row leaves the window instead of being
      // re-read every 5 minutes for two days.
      ops.push(doc.ref.update({ reminderSentAt: admin.firestore.Timestamp.now() }));
      blocked['no-recipient'] = (blocked['no-recipient'] || 0) + 1;
      continue;
    }

    // The deadline, phrased in the recurrence zone (Europe/Tirane) — the server
    // clock is UTC, and "skadon sot 15:00" must mean the office's 15:00.
    const end: Date | null = task.endDate?.toDate ? task.endDate.toDate() : task.endDate ? new Date(task.endDate) : null;
    let deadline = '';
    if (end && !isNaN(end.getTime())) {
      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: RECURRENCE_TIMEZONE, day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
      }).formatToParts(end);
      const get = (t: string) => parts.find(p => p.type === t)?.value || '';
      const sameDay = startOfRecurrenceDay(end) === startOfRecurrenceDay(now);
      const dayLabel = sameDay ? 'sot' : `${get('day')} ${sqMonths[Number(get('month')) - 1] || ''}`;
      deadline = ` Afati: ${dayLabel} ${get('hour')}:${get('minute')}.`;
    }

    ops.push(notifyUser({
      userId: recipientId,
      type: 'task_reminder',
      title: `🔔 Kujtesë: ${task.title}`,
      message: `Ke kërkuar të të kujtojmë për këtë detyrë.${deadline}`,
      actionUrl: task.projectId
        ? `/app/projects/${task.projectId}?taskId=${doc.id}`
        : `/app/tasks?taskId=${doc.id}`,
      actionLabel: 'Hap Detyrën',
      businessId: task.businessId ?? null,
      teamId: task.teamId ?? null,
      projectId: task.projectId ?? null,
    }));
    // Mark BEFORE the send settles: a reminder that fires twice is worse than one
    // lost to a transient push failure (the bell row is still written by
    // notifyUser, and the task still shows the reminder as sent).
    ops.push(doc.ref.update({ reminderSentAt: admin.firestore.Timestamp.now() }));
    sent++;
  }

  await settleAll(ops, 'task-reminders');
  return { scanned: snap.size, sent, blocked, toggledOffSkipped };
}

// ── JOB: invoice-reminders ───────────────────────────────────────────────────
async function runInvoiceReminders(opts?: { businessId?: string | null }) {
  const transporter = makeTransporter();
  const smtpUser = safeSenderAddress(process.env.SMTP_USER);
  const now = new Date();
  const reminderThreshold = new Date(now);
  reminderThreshold.setDate(reminderThreshold.getDate() + 3);
  reminderThreshold.setHours(23, 59, 59, 999);

  // A manual run is scoped to the caller's tenant — same law as
  // `recurring-invoices`: this job SENDS EMAIL to customers, so an unscoped
  // manual trigger let any tenant Admin dun every other tenant's clients (the
  // "Ekzekuto Tani" button lives in every tenant's Cilësimet).
  const scopeId = opts?.businessId || null;
  const scoped = <T extends FirebaseFirestore.Query>(q: T): T =>
    (scopeId ? q.where('businessId', '==', scopeId) : q) as T;

  // A SUSPENDED tenant must not dun its customers in our name. The Admin SDK
  // bypasses `tenantActive()` in the rules, so the exclusion must live here.
  const suspendedBusinessIds = new Set<string>();
  try {
    const suspSnap = await db.collection('businesses').where('status', '==', 'suspended').get();
    suspSnap.docs.forEach(d => suspendedBusinessIds.add(d.id));
  } catch { /* a failed lookup must not stop reminders for everyone else */ }
  let suspendedSkipped = 0;

  // The per-tenant switch in Cilësimet → Automatizime is HONOURED here. It was
  // written to `teamSettings.cronSettings` and read by nobody, so a tenant who
  // turned "Kujtesa faturash" off kept dunning their customers every day. Absent
  // means on, matching the UI's `?? true` default, so nothing changes for a
  // tenant that never touched the switch.
  const remindersEnabledFor = cronToggleReader('invoice_reminders');
  let toggledOffSkipped = 0;

  const [pendingSnap, partialSnap] = await Promise.all([
    scoped(db.collection('invoices').where('status', '==', 'Pending')).get(),
    scoped(db.collection('invoices').where('status', '==', 'Partial')).get(),
  ]);
  const invoiceDocs = [...pendingSnap.docs, ...partialSnap.docs];
  let overdueMarked = 0, remindersSent = 0, reminder25Sent = 0, reminderLastDaySent = 0;
  const ops: Promise<any>[] = [];

  for (const doc of invoiceDocs) {
    const invoice = doc.data();
    if (invoice.businessId && suspendedBusinessIds.has(invoice.businessId)) { suspendedSkipped++; continue; }
    if (!(await remindersEnabledFor(invoice.teamId))) { toggledOffSkipped++; continue; }
    if (!invoice.dueDate) continue;
    const dueDate: Date = invoice.dueDate.toDate ? invoice.dueDate.toDate() : new Date(invoice.dueDate);
    const invoiceLabel = invoice.invoiceNumber || doc.id.slice(0, 8).toUpperCase();

    // An invoice is overdue only once its due DAY has ended in the tenant's
    // zone. `dueDate` is a local-midnight instant and this job ticks at 10:00
    // Tirane, so a bare `dueDate < now` flagged the invoice — and mailed the
    // creator "🔴 Faturë e skaduar" — on the morning of the day it was due,
    // while the client still had the whole day to pay.
    if (endOfBillingDay(dueDate) < now) {
      ops.push(doc.ref.update({ status: 'Overdue', updatedAt: admin.firestore.Timestamp.now() }));
      overdueMarked++;
      if (invoice.createdByUserId) {
        const ovTitle = `🔴 Faturë e skaduara: #${invoiceLabel}`;
        const ovMsg = `Fatura #${invoiceLabel} ka kaluar afatin e pagesës.`;
        ops.push(notifyUser({ userId: invoice.createdByUserId, type: 'invoice_overdue', title: ovTitle, message: ovMsg, actionUrl: '/app/invoices', actionLabel: 'Shiko Faturat', businessId: invoice.businessId ?? null, teamId: invoice.teamId ?? null, customerId: invoice.customerId ?? null }));
      }
    } else if (dueDate <= reminderThreshold && !invoice.reminderSent) {
      ops.push(doc.ref.update({ reminderSent: true, updatedAt: admin.firestore.Timestamp.now() }));
      remindersSent++;
      const daysLeft = Math.ceil((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      if (transporter && smtpUser && invoice.customerId) {
        const customerDoc = await db.collection('customers').doc(invoice.customerId).get();
        const customer = customerDoc.data();
        if (customer?.email) {
          ops.push(transporter.sendMail({ from: `"FivoCRM" <${smtpUser}>`, to: customer.email, subject: `Kujtesë pagese: Fatura #${invoiceLabel}`, html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;"><h2 style="color:#f59e0b">⏰ Kujtesë Pagese</h2><p>Fatura juaj <strong>#${invoiceLabel}</strong> skadon ${daysLeft === 0 ? 'sot' : `për ${daysLeft} ditë`}.</p><p style="color:#9ca3af;font-size:12px">FivoCRM – Njoftime automatike</p></div>` }));
        }
      }
      if (invoice.createdByUserId) ops.push(notifyUser({ userId: invoice.createdByUserId, type: 'invoice_reminder_sent', title: `📧 Kujtesë u dërgua: Fatura #${invoiceLabel}`, message: `Kujtesa e pagesës u dërgua te klienti.`, actionUrl: '/app/invoices', actionLabel: 'Shiko Faturat', businessId: invoice.businessId ?? null, teamId: invoice.teamId ?? null, customerId: invoice.customerId ?? null, email: false }));
    }
  }
  await settleAll(ops, 'invoice-reminders');

  // 25th/last-day recurring invoice reminders
  const todayDate = now.getDate();
  const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const is25th = todayDate === 25;
  const isLastDay = todayDate === lastDayOfMonth;

  if (is25th || isLastDay) {
    const flagField = is25th ? 'reminder25Sent' : 'reminderLastDaySent';
    const type = is25th ? 'reminder1' : 'reminder2';
    // The flag is filtered CLIENT-SIDE, not with `where(flagField,'==',false)`:
    // Firestore equality never matches a document where the field is absent, so
    // legacy/WHMCS invoices that predate these flags were silently never reminded.
    const recurringSnap = await scoped(db.collection('invoices').where('autoGenerated', '==', true).where('status', '==', 'Pending')).get();
    const reminderOps: Promise<any>[] = [];

    for (const doc of recurringSnap.docs) {
      const invoice = doc.data();
      if (invoice.businessId && suspendedBusinessIds.has(invoice.businessId)) { suspendedSkipped++; continue; }
      if (!(await remindersEnabledFor(invoice.teamId))) { toggledOffSkipped++; continue; }
      if (invoice[flagField] === true) continue;
      if (!invoice.customerId) continue;
      const invoiceLabel = invoice.invoiceNumber || doc.id.slice(0, 8).toUpperCase();
      const customerDoc = await db.collection('customers').doc(invoice.customerId).get();
      const customer = customerDoc.data();
      if (!customer?.email) continue;
      let projectName = 'Shërbim';
      if (invoice.projectId) { const pd = await db.collection('projects').doc(invoice.projectId).get(); if (pd.exists) projectName = pd.data()?.name || projectName; }
      const dueDate: Date = invoice.dueDate?.toDate ? invoice.dueDate.toDate() : invoice.dueDate ? new Date(invoice.dueDate) : now;
      const { subject, html } = buildInvoiceEmail({ customerName: customer.name || 'Klient', invoiceNumber: invoiceLabel, amount: invoice.total || invoice.amount || 0, paidAmount: invoice.paidAmount || 0, dueDate, projectName, type, currency: invoice.currency || 'ALL', paymentMethod: invoice.paymentMethod, bankName: invoice.bankName, bankIBAN: invoice.bankIBAN, bankSWIFT: invoice.bankSWIFT, bankAccountHolder: invoice.bankAccountHolder, bankCountry: invoice.bankCountry, payUrl: await publicInvoicePayUrl(doc.id, invoice) });
      if (transporter && smtpUser) reminderOps.push(transporter.sendMail({ from: `"FivoCRM" <${smtpUser}>`, to: customer.email, subject, html }).then(() => doc.ref.update({ [flagField]: true, updatedAt: admin.firestore.Timestamp.now() })));
      // The type used to be assembled as `invoice_${type}_sent`, producing values no
      // table knew about: no icon, no category, impossible to mute. The variant now
      // lives in the title, where it belongs, and the type is a registered one.
      if (invoice.createdByUserId) reminderOps.push(notifyUser({ userId: invoice.createdByUserId, type: 'invoice_reminder_sent', title: `📧 Kujtesë dërguar (${is25th ? '25' : 'dita e fundit'}): #${invoiceLabel}`, message: `Kujtesa e pagesës u dërgua te ${customer.name || 'klienti'}.`, actionUrl: '/app/invoices', actionLabel: 'Shiko Faturat', businessId: invoice.businessId ?? null, teamId: invoice.teamId ?? null, customerId: invoice.customerId ?? null, email: false }));
      is25th ? reminder25Sent++ : reminderLastDaySent++;
    }
    await settleAll(reminderOps, 'invoice-reminders-recurring');
  }

  return { overdueMarked, remindersSent, reminder25Sent, reminderLastDaySent, suspendedSkipped, toggledOffSkipped, scopedTo: scopeId };
}

// ── JOB: overdue-reminders ───────────────────────────────────────────────────
// Two things, both to the CUSTOMER:
//  1) the weekly overdue EMAIL (unchanged; unless the customer opted out via
//     `disableOverdueReminders`, or the tenant asked to skip WHMCS invoices —
//     WHMCS mails those itself, so FivoCRM's copy was a duplicate);
//  2) WhatsApp reminders in three stages (pre-due / due / overdue), decided by
//     `invoiceWaDecision()` in api/_invoiceWaReminders.ts — the byte-identical
//     mirror of src/lib/finance/invoiceWaReminders.ts. Every non-send is a NAMED
//     reason, tallied per tenant into `teamSettings.waInvoiceLastRun` so the
//     settings panel can show why nothing went out. Never add a filter inline.
// Runs every ~2h from the VPS; the local send window (default 09–19
// Europe/Tirane) is what keeps a 3 a.m. tick from messaging anyone.
async function runOverdueReminders(opts?: { businessId?: string | null }) {
  const transporter = makeTransporter();
  const smtpUser = safeSenderAddress(process.env.SMTP_USER);
  const now = Date.now();

  // Same law as `recurring-invoices` / `invoice-reminders`: this job EMAILS and
  // WhatsApps customers, so a manual trigger runs inside the caller's tenant
  // only. Unscoped, one tenant's Admin dunned every other tenant's clients.
  const scopeId = opts?.businessId || null;
  const scoped = <T extends FirebaseFirestore.Query>(q: T): T =>
    (scopeId ? q.where('businessId', '==', scopeId) : q) as T;

  // A suspended tenant must not keep chasing its customers in our name.
  const suspendedBusinessIds = new Set<string>();
  try {
    const suspSnap = await db.collection('businesses').where('status', '==', 'suspended').get();
    suspSnap.docs.forEach(d => suspendedBusinessIds.add(d.id));
  } catch { /* a failed lookup must not stop reminders for everyone else */ }
  let suspendedSkipped = 0;
  const ms = (v: any): number => (v?.toDate ? v.toDate().getTime() : (v ? new Date(v).getTime() : 0));
  const EMAIL_RENOTIFY_DAYS = 7;
  const MAX_PRE_DUE_DAYS = 30; // == INVOICE_WA_LIMITS.preDueDays.max

  // Overdue invoices (email + WA 'overdue' stage) …
  const overdueSnap = await scoped(db.collection('invoices').where('status', '==', 'Overdue')).get();
  // … plus open invoices whose due date is within the widest pre-due window
  // (WA 'pre-due' / 'due' stages; a Partial one past due also reaches the
  // 'overdue' stage here — it never flips to Overdue). Index: (status, dueDate).
  const horizon = admin.firestore.Timestamp.fromMillis(now + MAX_PRE_DUE_DAYS * 86_400_000);
  let openSnapDocs: admin.firestore.QueryDocumentSnapshot[] = [];
  try {
    const openSnap = await scoped(db.collection('invoices')
      .where('status', 'in', ['Pending', 'Partial'])
      .where('dueDate', '<=', horizon))
      .get();
    openSnapDocs = openSnap.docs;
  } catch (err: any) {
    // A missing index must not take the overdue emails down with it.
    console.error('[overdue-reminders] open-invoice query failed (index (status, dueDate) missing?):', err?.message || err);
  }
  const seen = new Set<string>();
  const invoiceDocs = [...overdueSnap.docs, ...openSnapDocs].filter((d) => (seen.has(d.id) ? false : (seen.add(d.id), true)));
  if (!invoiceDocs.length) return { emailsSent: 0, waSent: 0 };

  const custCache = new Map<string, any>();
  const tsCache = new Map<string, any>();
  const tplCache = new Map<string, any>();
  const getCustomer = async (id: string) => {
    if (custCache.has(id)) return custCache.get(id);
    const d = await db.collection('customers').doc(id).get();
    const data = d.exists ? d.data() : null;
    custCache.set(id, data);
    return data;
  };
  const getTeamSettings = async (teamId: string) => {
    if (tsCache.has(teamId)) return tsCache.get(teamId);
    const data = await getTeamConfig(teamId);
    tsCache.set(teamId, data);
    return data;
  };
  const getTemplate = async (id: string) => {
    if (tplCache.has(id)) return tplCache.get(id);
    const d = await db.collection('waTemplates').doc(id).get();
    const data = d.exists ? d.data() : null;
    tplCache.set(id, data);
    return data;
  };
  const whmcsBase = (() => {
    const raw = (process.env.WHMCS_API_URL || '').trim();
    if (!raw) return '';
    return (/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).replace(/\/$/, '');
  })();
  const dueFmt = new Intl.DateTimeFormat('sq-AL', { timeZone: INVOICE_WA_DEFAULT_TZ, day: '2-digit', month: '2-digit', year: 'numeric' });

  let emailsSent = 0, waSent = 0;
  const ops: Promise<any>[] = [];
  // Per-tenant WA tallies → teamSettings.waInvoiceLastRun.
  const perTeam = new Map<string, { sent: number; considered: number; blocked: InvoiceWaBlockReason[] }>();
  const tally = (teamId: string) => {
    let t = perTeam.get(teamId);
    if (!t) { t = { sent: 0, considered: 0, blocked: [] }; perTeam.set(teamId, t); }
    return t;
  };

  for (const doc of invoiceDocs) {
    const inv = doc.data();
    if (inv.businessId && suspendedBusinessIds.has(inv.businessId)) { suspendedSkipped++; continue; }
    if (!inv.customerId) continue;
    const customer = await getCustomer(inv.customerId);
    const settings = inv.teamId ? await getTeamSettings(inv.teamId) : null;
    const cfg = resolveInvoiceWaConfig(settings);

    const dueMs = ms(inv.dueDate);
    const daysOverdue = dueMs ? Math.floor((now - dueMs) / 86_400_000) : 0;
    const invoiceLabel = inv.invoiceNumber || doc.id.slice(0, 8).toUpperCase();
    const isWhmcs = inv.source === 'whmcs';

    // 1) Weekly overdue email to the customer (Overdue status only — unchanged).
    if (inv.status === 'Overdue' && customer && !customer.disableOverdueReminders && !(isWhmcs && cfg.emailSkipWhmcs)) {
      const lastEmail = ms(inv.overdueEmailSentAt);
      if (transporter && smtpUser && customer.email && (!lastEmail || (now - lastEmail) / 86_400_000 >= EMAIL_RENOTIFY_DAYS)) {
        const dueDate = dueMs ? new Date(dueMs) : new Date();
        const { html } = buildInvoiceEmail({
          customerName: customer.name || 'Klient', invoiceNumber: invoiceLabel,
          // `paidAmount` is NOT optional here: without it `_invoiceEmail.ts`
          // computes `settled = 0`, drops the "Paguar deri tani" row and dunned
          // the customer for the GROSS total — money they had already paid.
          amount: inv.total || inv.amount || 0, paidAmount: inv.paidAmount || 0,
          // `reminder2` is the FINAL NOTICE for the due day ("skadon sot"). This
          // job chases invoices that are ALREADY late, so it told a customer 45
          // days overdue that the deadline expired today — every single week.
          dueDate, projectName: '', type: 'overdue', daysOverdue,
          currency: inv.currency || 'ALL', paymentMethod: inv.paymentMethod,
          bankName: inv.bankName, bankIBAN: inv.bankIBAN, bankSWIFT: inv.bankSWIFT,
          bankAccountHolder: inv.bankAccountHolder, bankCountry: inv.bankCountry,
          payUrl: await publicInvoicePayUrl(doc.id, inv),
        });
        ops.push(
          transporter.sendMail({ from: `"FivoCRM" <${smtpUser}>`, to: customer.email, subject: `⚠️ Faturë e papaguar #${invoiceLabel} (${daysOverdue} ditë vonesë)`, html })
            .then(() => doc.ref.update({ overdueEmailSentAt: admin.firestore.Timestamp.now() }))
            .catch((e) => console.error('[overdue-email]', e))
        );
        emailsSent++;
      }
    }

    // 2) WhatsApp — the engine decides, the job only fetches facts + sends.
    if (!inv.teamId || !settings) continue;
    if (!cfg.enabled) continue; // not tallied: a disabled tenant has no run to report
    const t = tally(inv.teamId);
    t.considered++;

    let metaChannel: any = null;
    let tpl: any = null;
    let hasChannel = false;
    if (cfg.channel === 'meta') {
      const channels: any[] = settings.metaChannels || [];
      metaChannel = channels.find((c) => c.phoneNumberId === cfg.channelPhoneNumberId) || channels[0];
      hasChannel = !!(metaChannel?.accessToken && metaChannel?.phoneNumberId);
      tpl = cfg.templateId ? await getTemplate(cfg.templateId) : null;
    } else {
      hasChannel = !!(settings.whatsappVpsUrl && settings.whatsappVpsSecret);
    }

    const total = Number(inv.total ?? inv.amount ?? 0) || 0;
    const paidAmount = Number(inv.paidAmount || 0) || 0;
    const decision = invoiceWaDecision(
      {
        status: inv.status, source: inv.source || null, dueDateMs: dueMs || null, total, paidAmount,
        preDueWaSentAtMs: ms(inv.preDueWaSentAt) || null,
        dueWaSentAtMs: ms(inv.dueWaSentAt) || null,
        overdueWaSentAtMs: ms(inv.overdueWaSentAt) || null,
      },
      customer ? { phone: customer.phone, waOptOut: customer.waOptOut, disableOverdueReminders: customer.disableOverdueReminders } : null,
      cfg,
      { nowMs: now, timeZone: INVOICE_WA_DEFAULT_TZ, hasChannel, hasTemplate: !!tpl },
    );
    if (!decision.ok) { t.blocked.push(decision.reason); continue; }

    const phone = normalizeInvoiceWaPhone(customer.phone);
    const balance = Math.max(0, total - paidAmount);
    const link = await publicInvoicePayUrl(doc.id, inv);
    const ctx = {
      name: customer.name || '',
      firstName: invoiceWaFirstName(customer.name),
      company: settings.companyName || '',
      invoiceNumber: invoiceLabel,
      amount: balance,
      total,
      currency: inv.currency || 'ALL',
      dueDate: dueMs ? dueFmt.format(new Date(dueMs)) : '',
      dueText: invoiceWaDueText(decision.stage, decision.daysLate),
      daysLate: decision.daysLate,
      daysOverdue: Math.max(0, decision.daysLate),
      link,
      whmcsLink: isWhmcs && whmcsBase && inv.whmcsInvoiceId ? `${whmcsBase}/viewinvoice.php?id=${inv.whmcsInvoiceId}` : '',
    };
    const stampField = invoiceWaStageField(decision.stage);
    const stamp = () => doc.ref.update({ [stampField]: admin.firestore.Timestamp.now() });

    if (cfg.channel === 'meta') {
      // Template params come from `paramFields`; the pseudo-fields above
      // (dueText, daysLate, link, whmcsLink, firstName) are all addressable.
      const params: string[] = (tpl.paramFields || []).map((f: string) => {
        const v = f && f !== 'custom' ? (ctx as Record<string, any>)[f] : undefined;
        if (v === null || v === undefined) return '';
        return f === 'amount' || f === 'total' ? formatInvoiceWaAmount(Number(v)) : String(v);
      });
      ops.push(
        sendMetaBroadcastMessage(metaChannel, phone, tpl, params, inv.teamId, null, { id: doc.id, name: customer.name })
          .then(stamp)
          .catch((e) => console.error('[overdue-wa:meta]', e))
      );
    } else {
      const text = renderInvoiceWaText(cfg.text, ctx);
      ops.push(
        sendBaileysText(settings.whatsappVpsUrl, settings.whatsappVpsSecret, cfg.agentId || undefined, phone, text, { teamId: inv.teamId, leadName: customer.name || null })
          .then((r) => { if (r.ok) return stamp(); console.error('[overdue-wa:baileys]', r.error); })
          .catch((e) => console.error('[overdue-wa:baileys]', e))
      );
    }
    t.sent++;
    waSent++;
    if (inv.createdByUserId) {
      ops.push(notifyUser({ userId: inv.createdByUserId, type: 'invoice_reminder_sent', title: `💬 Kujtesë WhatsApp (${ctx.dueText}): #${invoiceLabel}`, message: `Kujtesa u dërgua në WhatsApp te ${customer.name || 'klienti'}.`, actionUrl: '/app/invoices', actionLabel: 'Shiko Faturat', businessId: inv.businessId ?? null, teamId: inv.teamId ?? null, customerId: inv.customerId ?? null, email: false }));
    }
  }

  // Per-tenant run summary for the settings panel (one merge write per enabled tenant).
  const waBlocked: Record<string, Record<string, number>> = {};
  for (const [teamId, t] of perTeam) {
    const blocked = tallyInvoiceWaBlocked(t.blocked);
    waBlocked[teamId] = blocked;
    ops.push(db.collection('teamSettings').doc(teamId).set({
      waInvoiceLastRun: { at: admin.firestore.Timestamp.now(), sent: t.sent, considered: t.considered, blocked },
    }, { merge: true }).catch((e) => console.error('[overdue-wa] lastRun write failed', e)));
  }

  await settleAll(ops, 'overdue-reminders');
  return { emailsSent, waSent, waBlocked, suspendedSkipped, scopedTo: scopeId };
}

// ── JOB: recurring-tasks ─────────────────────────────────────────────────────
async function runRecurringTasks() {
  const recurrenceEnabledFor = cronToggleReader('recurring_tasks');
  let toggledOffSkipped = 0;
  const now = new Date();
  const tasksSnap = await db.collection('tasks').where('isRecurring', '==', true).get();
  let created = 0;
  let skippedDuplicate = 0;
  const ops: Promise<any>[] = [];

  // Occurrence fingerprints that already exist. A recurring series that got
  // duplicated once (two parents Done and due) would otherwise have the cron
  // faithfully spawn one child EACH, every cycle, forever — that is how a single
  // double-click in July turned into a permanently doubled weekly series.
  // The set also absorbs children created earlier in this same run.
  const occurrenceKey = (t: any, start: Date) =>
    [t.businessId || '-', (t.title || '').toLowerCase().replace(/\s+/g, ' ').trim(),
     t.assignedToUserId || '-', t.projectId || '-', start.toISOString().slice(0, 10)].join('||');
  const existingOccurrences = new Set<string>();
  for (const d of tasksSnap.docs) {
    const t = d.data();
    const s: Date | null = t.startDate?.toDate ? t.startDate.toDate() : (t.startDate ? new Date(t.startDate) : null);
    if (s && !isNaN(s.getTime())) existingOccurrences.add(occurrenceKey(t, s));
  }

  const bizCache = new Map<string, string | null>();
  for (const doc of tasksSnap.docs) {
    const task = doc.data();
    if (!(await recurrenceEnabledFor(task.teamId))) { toggledOffSkipped++; continue; }
    // Self-heal: a recurring task must carry businessId or it disappears from the
    // business-scoped list & calendar. If it's missing, derive it from the project
    // (or team) and patch the source so it (and every future cycle) stays visible.
    if (!task.businessId) {
      let bid: string | null = null;
      if (task.projectId) {
        if (!bizCache.has('p:' + task.projectId)) {
          const p = await db.collection('projects').doc(task.projectId).get();
          bizCache.set('p:' + task.projectId, p.exists ? (p.data()!.businessId ?? null) : null);
        }
        bid = bizCache.get('p:' + task.projectId) ?? null;
      }
      if (!bid && task.teamId) {
        if (!bizCache.has('t:' + task.teamId)) {
          const tm = await db.collection('teamMembers').where('teamId', '==', task.teamId).limit(1).get();
          bizCache.set('t:' + task.teamId, tm.empty ? null : (tm.docs[0].data().businessId ?? null));
        }
        bid = bizCache.get('t:' + task.teamId) ?? null;
      }
      if (bid) {
        task.businessId = bid;
        ops.push(doc.ref.update({ businessId: bid, updatedAt: admin.firestore.Timestamp.now() }));
      }
    }
    if (!task.nextRecurringDate || !task.recurringFrequency) continue;
    // Skip if frontend already created the next cycle ("after completion" model)
    if (task.nextCycleCreated) continue;
    // Skip if the task hasn't been completed yet — no pile-up of duplicates
    if (task.status !== 'Done') continue;
    const nextRecurringDate: Date = task.nextRecurringDate?.toDate ? task.nextRecurringDate.toDate() : new Date(task.nextRecurringDate);
    if (isNaN(nextRecurringDate.getTime()) || nextRecurringDate > now) continue;
    // Tolerate a missing date anchor the way the UI does (parseDate falls back):
    // a tip with only one of startDate/endDate used to be skipped here forever —
    // a silently dead series the user could never see or fix.
    if (!task.startDate && !task.endDate) continue;
    const rawStart: Date = task.startDate?.toDate ? task.startDate.toDate() : new Date(task.startDate ?? NaN);
    const rawEnd: Date = task.endDate?.toDate ? task.endDate.toDate() : new Date(task.endDate ?? NaN);
    const startDate: Date = !isNaN(rawStart.getTime()) ? rawStart : rawEnd;
    const endDate: Date = !isNaN(rawEnd.getTime()) ? rawEnd : rawStart;
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) continue;

    // MIRRORS src/lib/recurringUtils.ts buildNextRecurringTask — keep in sync.
    // Only startDate follows the recurrence rule; endDate and nextRecurringDate
    // are re-derived from it by preserving their offset. Advancing each date
    // independently lets the `dayOfWeek` snap push them by a different number of
    // days, which produced 22 tasks whose end was up to 6 days BEFORE their start.
    const spanMs = Math.max(0, endDate.getTime() - startDate.getTime());
    const nextOffsetMs = nextRecurringDate.getTime() - startDate.getTime();

    let newStart = addFrequency(startDate, task.recurringFrequency, task.recurringDayOfWeek, task.recurringDayOfMonth, task.recurringInterval, task.recurringDaysOfWeek);

    // Day comparison in the recurrence zone, not this process's (UTC on Vercel) —
    // otherwise "is the next occurrence still in the past?" is answered on a
    // different calendar than the browser uses.
    const startOfDayMs = startOfRecurrenceDay;
    // Roll forward so a task completed (or picked up) late never spawns an
    // already-overdue occurrence — the next due date is always the first future
    // one (same behaviour as the client-side buildNextRecurringTask / Asana).
    const todayMs = startOfDayMs(now);
    let rollGuard = 0;
    while (startOfDayMs(newStart) < todayMs && rollGuard++ < 500) {
      newStart = addFrequency(newStart, task.recurringFrequency, task.recurringDayOfWeek, task.recurringDayOfMonth, task.recurringInterval, task.recurringDaysOfWeek);
    }

    const newEnd = new Date(newStart.getTime() + spanMs);
    const newNext = new Date(newStart.getTime() + nextOffsetMs);

    // Honor "repeat until": if the next occurrence is past recurringEndDate, stop
    // the series (mark done so it isn't reprocessed) without creating a new cycle.
    const recEnd: Date | null = task.recurringEndDate ? (task.recurringEndDate.toDate ? task.recurringEndDate.toDate() : new Date(task.recurringEndDate)) : null;
    if (recEnd && !isNaN(recEnd.getTime()) && startOfDayMs(newStart) > startOfDayMs(recEnd)) {
      ops.push(doc.ref.update({ nextCycleCreated: true, updatedAt: admin.firestore.Timestamp.now() }));
      continue;
    }

    // Someone else (the UI, or a duplicated sibling parent) already produced this
    // exact occurrence — close this parent out instead of doubling the series.
    const key = occurrenceKey(task, newStart);
    if (existingOccurrences.has(key)) {
      ops.push(doc.ref.update({ nextCycleCreated: true, updatedAt: admin.firestore.Timestamp.now() }));
      skippedDuplicate++;
      continue;
    }
    existingOccurrences.add(key);

    // Create new task ref first so we can reference its ID in the notification
    const newTaskRef = db.collection('tasks').doc();
    // MIRRORS buildNextRecurringTask's payload — keep in sync. The backstop's
    // child used to drop labels/section/collaborators/estimate/blockers, so a
    // series degraded (lost its board column, capacity estimate, 🔒 deps)
    // whenever THIS engine spawned the cycle instead of the UI.
    ops.push(newTaskRef.set({ title: task.title, description: task.description ?? null, status: 'Todo', priority: task.priority ?? null, projectId: task.projectId ?? null, assignedToUserId: task.assignedToUserId ?? null, labels: task.labels ?? null, section: task.section ?? null, collaboratorIds: task.collaboratorIds ?? null, estimatedHours: task.estimatedHours ?? null, dependsOn: task.dependsOn ?? null, startDate: admin.firestore.Timestamp.fromDate(newStart), endDate: admin.firestore.Timestamp.fromDate(newEnd), isRecurring: true, recurringFrequency: task.recurringFrequency, recurringInterval: task.recurringInterval ?? 1, recurringDayOfWeek: task.recurringDayOfWeek ?? null, recurringDayOfMonth: task.recurringDayOfMonth ?? null, recurringDaysOfWeek: task.recurringDaysOfWeek ?? null, recurringEndDate: recEnd ? admin.firestore.Timestamp.fromDate(recEnd) : null, nextRecurringDate: admin.firestore.Timestamp.fromDate(newNext), nextCycleCreated: false, dueNotificationSent: false, ...(task.reminderOffsetMinutes !== null && task.reminderOffsetMinutes !== undefined ? { reminderOffsetMinutes: task.reminderOffsetMinutes, reminderAt: admin.firestore.Timestamp.fromDate(new Date(newEnd.getTime() - Math.max(0, Number(task.reminderOffsetMinutes)) * 60_000)), reminderSentAt: null } : {}), parentTaskId: task.parentTaskId ?? null, createdByUserId: task.createdByUserId ?? null, teamId: task.teamId ?? null, businessId: task.businessId ?? null, customerId: task.customerId ?? null, createdAt: admin.firestore.Timestamp.now(), updatedAt: admin.firestore.Timestamp.now() }));
    ops.push(doc.ref.update({ nextCycleCreated: true, nextRecurringDate: admin.firestore.Timestamp.fromDate(newNext), updatedAt: admin.firestore.Timestamp.now() }));
    const notifRecipient = task.assignedToUserId || task.createdByUserId;
    if (notifRecipient) {
      const freqLabel: Record<string, string> = { daily: 'ditore', weekly: 'javore', monthly: 'mujore', yearly: 'vjetore' };
      const taskUrl = task.projectId
        ? `/app/projects/${task.projectId}?taskId=${newTaskRef.id}`
        : `/app/tasks?taskId=${newTaskRef.id}`;
      ops.push(notifyUser({ userId: notifRecipient, type: 'recurring_task_created', title: `🔄 Detyrë e re periodike: ${task.title}`, message: `Detyra periodike "${task.title}" (${freqLabel[task.recurringFrequency] ?? task.recurringFrequency}) u krijua automatikisht.`, actionUrl: taskUrl, actionLabel: 'Hap Detyrën', businessId: task.businessId ?? null, teamId: task.teamId ?? null, projectId: task.projectId ?? null }));
    }
    created++;
  }

  await settleAll(ops, 'recurring-tasks');
  return { created, skippedDuplicate, toggledOffSkipped };
}

// ── helpers for recurring-invoices ───────────────────────────────────────────
// Mirrors src/lib/finance/recurringInvoices.ts (unit-tested there) — keep in sync.
// The period KEY is the idempotency token, exactly as for recurring projects and
// recurring expenses. The old guard here compared the newest child's `createdAt`
// against the parent's `nextRecurringDate`: the first catch-up child is created
// "now", newer than every remaining past due date, so once a series lagged a
// single cycle the guard stayed true FOREVER and the retainer silently stopped
// billing. See workspace/INVOICES_AUDIT_2026_08.md.
const SUPPORTED_INVOICE_FREQUENCIES = ['weekly', 'monthly', 'quarterly', 'yearly'];
const PERMANENT_INVOICE_BLOCKS = ['series-ended', 'project-also-bills'];

/** Add `months`, preserving the day-of-month and clamping instead of overflowing. */
function addInvoiceMonthsClamped(from: Date, months: number, anchorDay?: number): Date {
  return addZonedMonthsClamped(from, months, anchorDay);
}

/**
 * The day-of-month the series bills on: the stored anchor, else the day of the
 * occurrence we advance from. Deriving it from the occurrence every time made one
 * February clamp permanent — 31 Jan → 28 Feb → 28 Mar → … — so a retainer billed
 * three days early for the rest of its life. Mirrors `resolveInvoiceAnchorDay`.
 */
function resolveInvoiceAnchorDay(invoice: any, scheduled: Date): number {
  const raw = invoice?.recurringAnchorDay;
  const n = raw == null || raw === '' ? NaN : Math.round(Number(raw));
  if (Number.isFinite(n) && n >= 1 && n <= 31) return n;
  return zonedParts(scheduled).day;
}

/** The due date one full cycle after `fromDate`. Never `setMonth(+1)`. */
function nextInvoiceDueDate(fromDate: Date, frequency: string, anchorDay?: number): Date {
  if (frequency === 'weekly') return addZonedDays(fromDate, 7);
  if (frequency === 'yearly') return addInvoiceMonthsClamped(fromDate, 12, anchorDay);
  if (frequency === 'quarterly') return addInvoiceMonthsClamped(fromDate, 3, anchorDay);
  return addInvoiceMonthsClamped(fromDate, 1, anchorDay);
}

function startOfInvoiceWeek(d: Date): Date {
  return startOfZonedWeek(d);
}

/** Idempotency token: one occurrence per (parent invoice, period key). */
function invoiceBillingPeriodKey(frequency: string, at: Date): string {
  const p2 = (n: number) => String(n).padStart(2, '0');
  if (frequency === 'weekly') {
    const m = zonedParts(startOfInvoiceWeek(at));
    return `W${m.year}-${p2(m.month + 1)}-${p2(m.day)}`;
  }
  const z = zonedParts(at);
  if (frequency === 'quarterly') return `Q${z.year}-${Math.floor(z.month / 3) + 1}`;
  if (frequency === 'yearly') return `Y${z.year}`;
  return `${z.year}-${p2(z.month + 1)}`;
}

/**
 * The date to bill on: the scheduled date while it is still inside the current
 * period (the cron merely ran late), else today. A series that lagged whole
 * periods bills the CURRENT one — back-dating an invoice into a closed month
 * rewrites reported books, and mailing a client six back-dated invoices at once
 * is worse than the gap. Skipped periods are recorded, never backfilled.
 */
function invoiceBillingDateFor(scheduled: Date, frequency: string, now: Date): Date {
  return invoiceBillingPeriodKey(frequency, scheduled) === invoiceBillingPeriodKey(frequency, now)
    ? scheduled
    : now;
}

/** How many whole periods the series fell behind (0 when on schedule). */
function invoicePeriodsSkipped(scheduled: Date, frequency: string, now: Date, anchorDay?: number): number {
  if (scheduled >= now) return 0;
  let count = 0;
  let cursor = new Date(scheduled);
  const anchor = anchorDay ?? zonedParts(scheduled).day;
  const nowKey = invoiceBillingPeriodKey(frequency, now);
  while (invoiceBillingPeriodKey(frequency, cursor) !== nowKey && count < 600) {
    cursor = nextInvoiceDueDate(cursor, frequency, anchor);
    count++;
  }
  return Math.max(0, count - 1);
}

/**
 * True when a `.create()` failed because the document already exists.
 *
 * That is the whole point of the deterministic occurrence id: a second run — or a
 * concurrent one, or a manual trigger racing the scheduled cron — cannot write a
 * duplicate invoice, it gets this error instead. Idempotency stops being "two
 * writes we hope both land" and becomes a property of the key.
 */
function isAlreadyExists(err: any): boolean {
  return err?.code === 6 || /ALREADY_EXISTS/i.test(String(err?.message || err?.details || ''));
}

/**
 * Document id of the occurrence covering `periodKey` of a series.
 *
 * Deterministic ON PURPOSE. The period key was already the idempotency token, but
 * it was only ever CHECKED — the occurrence itself went to a random id and the
 * claim was a separate, unordered write. If that claim failed (or the run died
 * between the two), the next pass billed the period again and emailed the client
 * a second invoice. With the key in the id, the database refuses the duplicate.
 */
function recurringOccurrenceId(prefix: 'rec' | 'auto', parentId: string, periodKey: string): string {
  return `${prefix}_${parentId}_${periodKey}`;
}

/** True when the linked project's OWN recurrence bills this retainer as well. */
function projectAlsoBills(project: any): boolean {
  if (!project?.isRecurring) return false;
  if (project.isRecurringPaused) return false;
  if (project.billingType === 'one-time') return false;
  if (project.status === 'Cancelled' || project.status === 'Archived') return false;
  return true;
}

/** Why this recurring invoice may not bill the period containing `now`, or null. */
function invoiceBillingBlockReason(invoice: any, now: Date, project?: any): string | null {
  if (!invoice.isRecurring) return 'not-recurring';
  if (invoice.autoGenerated) return 'auto-generated';

  const frequency: string | undefined = invoice.recurringFrequency;
  if (!frequency || !SUPPORTED_INVOICE_FREQUENCIES.includes(frequency)) return 'unsupported-frequency';
  // Before `paused`, so an overlap is reported (and switched off) even on a paused
  // series — resuming it later must not quietly resume the double bill.
  if (projectAlsoBills(project)) return 'project-also-bills';
  if (invoice.isRecurringPaused) return 'paused';

  const raw = invoice.nextRecurringDate;
  const scheduled: Date | null = raw
    ? (raw.toDate ? raw.toDate() : new Date(raw))
    : null;
  if (!scheduled || isNaN(scheduled.getTime())) return 'no-next-date';
  if (scheduled > now) return 'not-due';

  const billingDate = invoiceBillingDateFor(scheduled, frequency, now);

  const rawEnd = invoice.recurringEndDate;
  const endDate: Date | null = rawEnd ? (rawEnd.toDate ? rawEnd.toDate() : new Date(rawEnd)) : null;
  if (endDate && !isNaN(endDate.getTime()) && billingDate > endDate) return 'series-ended';

  if (invoice.lastGeneratedPeriodKey
      && invoice.lastGeneratedPeriodKey === invoiceBillingPeriodKey(frequency, billingDate)) {
    return 'already-generated';
  }
  return null;
}

/** Back-compat for parents predating `lastGeneratedPeriodKey`. */
function invoicePeriodAlreadyCovered(frequency: string, periodKey: string, children: any[]): boolean {
  return children.some(child => {
    if (child.periodKey) return child.periodKey === periodKey;
    const raw = child.invoiceDate || child.createdAt;
    const d: Date | null = raw ? (raw.toDate ? raw.toDate() : new Date(raw)) : null;
    return !!d && !isNaN(d.getTime()) && invoiceBillingPeriodKey(frequency, d) === periodKey;
  });
}

// ── Recurring PROJECT billing ────────────────────────────────────────────────
// Mirrors src/lib/finance/recurringBilling.ts (unit-tested there) — keep in sync.
// The period KEY is the idempotency token: exactly one invoice per
// (project, key). It replaced the old "lastInvoiceGeneratedAt is in the current
// calendar month?" check, which the UI-created first invoice bypassed entirely
// (it never recorded itself) — so every new retainer got billed twice.
const SUPPORTED_PROJECT_BILLING_FREQUENCIES = ['weekly', 'monthly'];
const TERMINAL_PROJECT_STATUSES = ['Cancelled', 'Archived'];
const PERMANENT_BILLING_BLOCKS = ['terminal-status', 'series-ended'];

function startOfBillingWeek(d: Date): Date {
  return startOfZonedWeek(d);
}

function projectBillingPeriodKey(frequency: string, at: Date): string {
  const p2 = (n: number) => String(n).padStart(2, '0');
  if (frequency === 'weekly') {
    const m = zonedParts(startOfBillingWeek(at));
    return `W${m.year}-${p2(m.month + 1)}-${p2(m.day)}`;
  }
  const z = zonedParts(at);
  return `${z.year}-${p2(z.month + 1)}`;
}

function projectBillingPeriodEnd(frequency: string, at: Date): Date {
  if (frequency === 'weekly') {
    const m = zonedParts(startOfBillingWeek(at));
    return zonedDate(m.year, m.month, m.day + 6, 23, 59, 59, 999);
  }
  const z = zonedParts(at);
  return zonedDate(z.year, z.month, daysInZonedMonth(z.year, z.month), 23, 59, 59, 999);
}

/**
 * Whole billing periods missed between `lastPeriodKey` and the period containing
 * `now`. Mirrors `projectPeriodsSkipped` in src/lib/finance/recurringBilling.ts.
 * Reports only — backfilling closed months is the owner's call.
 */
function projectPeriodsSkipped(frequency: string, lastPeriodKey: string | undefined | null, now: Date, maxLookback = 24): number {
  if (!lastPeriodKey) return 0;
  if (projectBillingPeriodKey(frequency, now) === lastPeriodKey) return 0;
  const start = zonedParts(now);
  let cursor = zonedDate(start.year, start.month, start.day);
  for (let i = 0; i < maxLookback; i++) {
    const c = zonedParts(cursor);
    cursor = frequency === 'weekly'
      ? zonedDate(c.year, c.month, c.day - 7)
      : zonedDate(c.year, c.month - 1, 1);
    if (projectBillingPeriodKey(frequency, cursor) === lastPeriodKey) return i;
  }
  return 0;
}

/** Why this project may not bill for the period containing `now`, or null when due. */
function projectBillingBlockReason(project: any, now: Date): string | null {
  if (!project.isRecurring) return 'not-recurring';
  const frequency: string = project.recurringFrequency || 'monthly';
  if (!SUPPORTED_PROJECT_BILLING_FREQUENCIES.includes(frequency)) return 'unsupported-frequency';
  if (project.status && TERMINAL_PROJECT_STATUSES.includes(project.status)) return 'terminal-status';

  const rawEnd = project.recurringEndDate;
  const endDate: Date | null = rawEnd
    ? (rawEnd.toDate ? rawEnd.toDate() : new Date(rawEnd))
    : null;
  if (endDate && !isNaN(endDate.getTime()) && now > endDate) return 'series-ended';

  if (project.isRecurringPaused) return 'paused';
  // A single deal value must never bill on a cycle, even if isRecurring got set.
  if (project.billingType === 'one-time') return 'one-time';

  const periodKey = projectBillingPeriodKey(frequency, now);
  if (project.lastInvoicePeriodKey) {
    if (project.lastInvoicePeriodKey === periodKey) return 'already-billed';
  } else if (project.lastInvoiceGeneratedAt) {
    const raw = project.lastInvoiceGeneratedAt;
    const last: Date = raw.toDate ? raw.toDate() : new Date(raw);
    if (!isNaN(last.getTime()) && projectBillingPeriodKey(frequency, last) === periodKey) return 'already-billed';
  }

  // Chosen billing day (monthly only): hold until that day of the month arrives,
  // clamped to the month's length. Transient — bills normally once reached.
  if (frequency === 'monthly' && project.billingDayOfMonth) {
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const day = Math.min(Math.max(1, Math.round(Number(project.billingDayOfMonth))), lastDay);
    if (now.getDate() < day) return 'before-billing-day';
  }
  return null;
}

// ── JOB: recurring-invoices ──────────────────────────────────────────────────
async function runRecurringInvoices(opts?: { businessId?: string | null }) {
  const transporter = makeTransporter();
  const smtpUser = safeSenderAddress(process.env.SMTP_USER);
  const now = new Date();
  let created = 0, skipped = 0;
  const ops: Promise<any>[] = [];

  // A manual run is scoped to the caller's tenant: this job SENDS EMAIL to
  // customers, so an unscoped manual trigger let any tenant Admin bill every
  // other tenant's clients. The scheduled run stays unscoped (it is the platform
  // acting for everyone, and legacy rows with no businessId must still bill).
  const scopeId = opts?.businessId || null;
  const scoped = <T extends FirebaseFirestore.Query>(q: T): T =>
    (scopeId ? q.where('businessId', '==', scopeId) : q) as T;

  // A SUSPENDED tenant must not keep invoicing its customers. `tenantActive()` in
  // firestore.rules blocks their writes, but the cron runs on the Admin SDK, which
  // bypasses rules entirely — so an unpaid tenant kept generating invoices and
  // emailing them to their clients in our name, for as long as the data existed.
  const suspendedBusinessIds = new Set<string>();
  try {
    const suspSnap = await db.collection('businesses').where('status', '==', 'suspended').get();
    suspSnap.docs.forEach(d => suspendedBusinessIds.add(d.id));
  } catch { /* a failed lookup must not stop billing for everyone else */ }
  let suspendedSkipped = 0;

  // ── Part 1: Invoice-based recurrence (user-created recurring invoices) ──────
  const invoicesSnap = await scoped(db.collection('invoices').where('isRecurring', '==', true)).get();
  const blockedReasons: Record<string, number> = {};

  // Linked projects in ONE round trip instead of one per series. Each is needed
  // by `projectAlsoBills` before the cheap blocks can even be evaluated, so this
  // used to be a guaranteed N+1: 200 retainers = 200 sequential reads before a
  // single invoice was written.
  const linkedProjects = new Map<string, any>();
  const projectIds = Array.from(new Set(
    invoicesSnap.docs.map(d => d.data().projectId).filter((x): x is string => typeof x === 'string' && !!x),
  ));
  for (let i = 0; i < projectIds.length; i += 300) {
    const refs = projectIds.slice(i, i + 300).map(id => db.collection('projects').doc(id));
    const got = await db.getAll(...refs).catch(() => [] as FirebaseFirestore.DocumentSnapshot[]);
    got.forEach(snapDoc => { if (snapDoc.exists) linkedProjects.set(snapDoc.id, snapDoc.data()); });
  }

  for (const doc of invoicesSnap.docs) {
    const invoice = doc.data();

    if (invoice.businessId && suspendedBusinessIds.has(invoice.businessId)) {
      suspendedSkipped++; skipped++; continue;
    }

    // One retainer, one engine. An invoice-driven series whose PROJECT bills its
    // own fee would double-bill the same money (Part 2 below does that project);
    // `scripts/stop-duplicate-invoice-engines.mjs` existed only to clean this up
    // by hand. The block reason needs the project, hence the bulk prefetch above.
    const linkedProject: any = invoice.projectId ? (linkedProjects.get(invoice.projectId) ?? null) : null;

    const block = invoiceBillingBlockReason(invoice, now, linkedProject);
    if (block) {
      blockedReasons[block] = (blockedReasons[block] || 0) + 1;
      // A permanently-blocked series is switched off so we stop re-evaluating it
      // on every run — and, for an overlap, so it can never resume the double bill.
      if (PERMANENT_INVOICE_BLOCKS.includes(block)) {
        ops.push(doc.ref.update({
          isRecurring: false,
          nextRecurringDate: null,
          recurringStoppedReason: block,
          recurringStoppedAt: admin.firestore.Timestamp.now(),
          updatedAt: admin.firestore.Timestamp.now(),
        }));
        if (invoice.createdByUserId) {
          ops.push(notifyUser({
            userId: invoice.createdByUserId,
            type: 'auto_invoice_created',
            title: `↻ Përsëritja u ndërpre: #${invoice.invoiceNumber || doc.id.slice(0, 8)}`,
            message: block === 'project-also-bills'
              ? 'Projekti i lidhur e fatura këtë retainer vetë — përsëritja e faturës u fik për të mos faturuar dyfish.'
              : 'Seria mbërriti datën e fundit dhe nuk gjeneron më fatura.',
            actionUrl: '/app/invoices',
            actionLabel: 'Shiko Faturat',
            businessId: invoice.businessId ?? null,
            teamId: invoice.teamId ?? null,
            customerId: invoice.customerId ?? null,
          }));
        }
      }
      skipped++; continue;
    }

    const freq: string = invoice.recurringFrequency;
    const scheduled: Date = invoice.nextRecurringDate.toDate
      ? invoice.nextRecurringDate.toDate()
      : new Date(invoice.nextRecurringDate);
    // The period this run bills. A lagging series bills the CURRENT period, so
    // the invoice never lands in a closed, already-reported month.
    const billingDate = invoiceBillingDateFor(scheduled, freq, now);
    const periodKey = invoiceBillingPeriodKey(freq, billingDate);
    const skippedPeriods = invoicePeriodsSkipped(scheduled, freq, now, resolveInvoiceAnchorDay(invoice, scheduled));

    // Back-compat for parents that predate `lastGeneratedPeriodKey`: derive
    // coverage from the occurrences that exist, so the first run after deploy
    // does not bill every live series a second time.
    //
    // Only for those parents: once the claim exists it is the authority, and this
    // query used to run for EVERY series on EVERY pass — reading the whole child
    // history of a two-year retainer just to re-derive a fact already stored.
    if (!invoice.lastGeneratedPeriodKey) {
      const existingChildSnap = await db.collection('invoices')
        .where('parentInvoiceId', '==', doc.id)
        .where('autoGenerated', '==', true)
        .get();
      if (invoicePeriodAlreadyCovered(freq, periodKey, existingChildSnap.docs.map(d => d.data()))) {
      // Record the key so the derivation runs once, not on every future run.
        ops.push(doc.ref.update({ lastGeneratedPeriodKey: periodKey, updatedAt: admin.firestore.Timestamp.now() }));
        blockedReasons['already-generated'] = (blockedReasons['already-generated'] || 0) + 1;
        skipped++; continue;
      }
    }

    // The anchor is a property of the SERIES, not of the last (clamped) occurrence.
    const anchorDay = resolveInvoiceAnchorDay(invoice, scheduled);
    const newDueDate = nextInvoiceDueDate(billingDate, freq, anchorDay);
    // Next trigger = newDueDate (i.e. generate again when that period ends). Since
    // billingDate is inside the current period, this is always in the future —
    // which is what makes a lagging series recover instead of freezing.
    const nextTrigger = new Date(newDueDate);

    // Number & date the invoice from the period actually being billed.
    const scheduledYear = billingDate.getFullYear();
    const scheduledMonth = billingDate.getMonth();
    const scheduledDay = billingDate.getDate();
    // Include the day so sub-monthly (weekly) children in the same month get
    // distinct numbers instead of colliding on REC-YYYY-MM-<parent>.
    const invoiceNumber = `REC-${scheduledYear}-${String(scheduledMonth + 1).padStart(2, '0')}-${String(scheduledDay).padStart(2, '0')}-${doc.id.slice(0, 6).toUpperCase()}`;
    // One occurrence per (parent, period) — enforced by the KEY, not by a check.
    const newInvoiceRef = db.collection('invoices').doc(recurringOccurrenceId('rec', doc.id, periodKey));

    // Awaited, and `create()` not `set()`: the database itself now refuses a
    // second invoice for this period. Everything after this line may assume the
    // occurrence is ours and exists — including the `emailSent` flag, which used
    // to be an `update()` racing an unordered `set()` in the same ops array (a
    // NOT_FOUND there left the invoice marked un-emailed, so the 25th/last-day
    // reminder job mailed the client all over again).
    const occurrence = {
      invoiceNumber,
      customerId: invoice.customerId || null,
      projectId: invoice.projectId || null,
      teamId: invoice.teamId || null,
      // Carry businessId so the child isn't orphaned (invisible to non-super
      // staff + wrong tenant attribution). Mirrors runRecurringExpenses/Tasks.
      businessId: invoice.businessId || null,
      amount: invoice.amount || 0,
      subtotal: invoice.subtotal || 0,
      total: invoice.total || 0,
      tax: invoice.tax || 0,
      discount: invoice.discount || 0,
      // 'percentage' is not a valid value — frontend uses 'fixed' | 'percent'
      discountType: invoice.discountType === 'percent' ? 'percent' : 'fixed',
      currency: invoice.currency || 'ALL',
      paymentMethod: invoice.paymentMethod || null,
      bankName: invoice.bankName || null,
      bankIBAN: invoice.bankIBAN || null,
      bankSWIFT: invoice.bankSWIFT || null,
      bankAccountHolder: invoice.bankAccountHolder || null,
      bankCountry: invoice.bankCountry || null,
      notes: invoice.notes || null,
      // Carry the products/services. invoiceItems (collection) are copied below,
      // but WHMCS/shop-origin invoices keep their products inline in the
      // `lineItems` array + `productSummary` — copy those too so the child isn't
      // left with no products.
      lineItems: invoice.lineItems || null,
      productSummary: invoice.productSummary || null,
      status: 'Pending',
      invoiceDate: admin.firestore.Timestamp.fromDate(billingDate),
      dueDate: admin.firestore.Timestamp.fromDate(newDueDate),
      isRecurring: false,   // children don't recurse — parent drives the cycle
      autoGenerated: true,
      parentInvoiceId: doc.id,
      // The period this occurrence covers. Written on the CHILD as well as the
      // parent so coverage survives even if the parent is later edited by hand.
      periodKey,
      emailSent: false,
      reminderSent: false,
      reminder25Sent: false,
      reminderLastDaySent: false,
      createdByUserId: invoice.createdByUserId || null,
      createdAt: admin.firestore.Timestamp.now(),
      updatedAt: admin.firestore.Timestamp.now(),
    };
    try {
      await newInvoiceRef.create(occurrence);
    } catch (err) {
      if (!isAlreadyExists(err)) throw err;
      // Someone (a concurrent run, a retried invocation) already billed this
      // period. Record the claim so the parent stops re-evaluating it, and move
      // on — never a second invoice, never a second email.
      ops.push(doc.ref.update({
        lastGeneratedPeriodKey: periodKey,
        recurringAnchorDay: invoice.recurringAnchorDay ?? anchorDay,
        updatedAt: admin.firestore.Timestamp.now(),
      }));
      blockedReasons['already-generated'] = (blockedReasons['already-generated'] || 0) + 1;
      skipped++; continue;
    }

    // Copy line items from parent (preserve serviceId so analytics stay linked).
    //
    // `businessId` and `customerId` are NOT optional here. `invoiceItems` is in
    // `businessIsolatedAlways`, so useCollection forces `where('businessId','==',…)`
    // AND the rule is `isBusinessMember(resource.data.businessId) ||
    // isPortalClientFor(resource.data.customerId)`. Items written with neither were
    // unreadable by anyone: every auto-generated invoice showed "Nuk ka artikuj"
    // to staff and to the portal client, and printed an empty PDF items table
    // against a correct total. The client-side useMutation stamps both; server
    // code has to do it by hand.
    const itemsSnap = await db.collection('invoiceItems').where('invoiceId', '==', doc.id).get();
    for (const itemDoc of itemsSnap.docs) {
      const item = itemDoc.data();
      ops.push(db.collection('invoiceItems').doc().set({
        invoiceId: newInvoiceRef.id,
        serviceId: item.serviceId || null,
        description: item.description || '',
        quantity: item.quantity || 1,
        unitPrice: item.unitPrice || 0,
        totalPrice: item.totalPrice || 0,
        teamId: item.teamId ?? invoice.teamId ?? null,
        businessId: item.businessId ?? invoice.businessId ?? null,
        customerId: item.customerId ?? invoice.customerId ?? null,
        createdAt: admin.firestore.Timestamp.now(),
        updatedAt: admin.firestore.Timestamp.now(),
      }));
    }

    // Record the period as billed (the idempotency token) and advance the trigger.
    // `lastGeneratedPeriodKey` is what makes this run repeatable: re-running the
    // job today can no longer produce a second invoice for the same period.
    ops.push(doc.ref.update({
      lastGeneratedPeriodKey: periodKey,
      lastGeneratedAt: admin.firestore.Timestamp.now(),
      nextRecurringDate: admin.firestore.Timestamp.fromDate(nextTrigger),
      // Backfill for series created before the anchor existed. Written ONCE (the
      // `??` never overwrites a stored anchor) — rewriting it from a clamped
      // occurrence is the drift this field exists to stop.
      recurringAnchorDay: invoice.recurringAnchorDay ?? anchorDay,
      // Surfaced, never backfilled — rewriting closed books is the owner's call.
      ...(skippedPeriods > 0
        ? {
            recurringPeriodsSkipped: skippedPeriods,
            recurringPeriodsSkippedAt: admin.firestore.Timestamp.now(),
          }
        : {}),
      updatedAt: admin.firestore.Timestamp.now(),
    }));

    if (skippedPeriods > 0 && invoice.createdByUserId) {
      ops.push(notifyUser({
        userId: invoice.createdByUserId,
        type: 'auto_invoice_created',
        title: `⚠️ ${skippedPeriods} periudhë pa faturë: #${invoice.invoiceNumber || doc.id.slice(0, 8)}`,
        message: `Seria kishte mbetur pas; u faturua periudha aktuale. ${skippedPeriods} periudhë të mëparshme NUK u faturuan — kontrollo dhe fatura manualisht nëse duhen.`,
        actionUrl: '/app/invoices',
        actionLabel: 'Shiko Faturat',
        businessId: invoice.businessId ?? null,
        teamId: invoice.teamId ?? null,
        customerId: invoice.customerId ?? null,
      }));
    }

    // Send invoice email to customer.
    //
    // NEVER mail a 0-value invoice. Part 2 has refused this since the finance
    // audit — a parent whose lines were cleared (or whose price lives only in
    // attached services) otherwise mailed the client a "Pending 0 L" invoice
    // every single period. The occurrence is still created and still claims its
    // period; only the email is withheld, and the owner is told why.
    const occurrenceAmount = Number(invoice.total ?? invoice.amount ?? 0) || 0;
    if (occurrenceAmount <= 0 && invoice.createdByUserId) {
      ops.push(notifyUser({
        userId: invoice.createdByUserId,
        type: 'auto_invoice_created',
        title: `⚠️ Faturë periodike me vlerë 0: #${invoiceNumber}`,
        message: 'Fatura u krijua por NUK iu dërgua klientit sepse vlera është 0. Kontrollo artikujt ose çmimin e serisë.',
        actionUrl: '/app/invoices',
        actionLabel: 'Shiko Faturat',
        businessId: invoice.businessId ?? null,
        teamId: invoice.teamId ?? null,
        customerId: invoice.customerId ?? null,
      }));
    }
    if (occurrenceAmount > 0 && transporter && smtpUser && invoice.customerId) {
      try {
        const customerDoc = await db.collection('customers').doc(invoice.customerId).get();
        const customer = customerDoc.data();
        if (customer?.email) {
          // The linked project is already in hand from the bulk prefetch — this
          // used to be a THIRD read of the same document in one iteration.
          const projectName = linkedProject?.name || 'Shërbim';
          const { subject, html } = buildInvoiceEmail({
            customerName: customer.name || 'Klient',
            invoiceNumber,
            amount: invoice.total || invoice.amount || 0,
            dueDate: newDueDate,
            projectName,
            type: 'initial',
            currency: invoice.currency || 'ALL',
            paymentMethod: invoice.paymentMethod,
            bankName: invoice.bankName,
            bankIBAN: invoice.bankIBAN,
            bankSWIFT: invoice.bankSWIFT,
            bankAccountHolder: invoice.bankAccountHolder,
            bankCountry: invoice.bankCountry,
            // Fresh doc: pass null so the helper mints the token without re-reading.
            payUrl: await publicInvoicePayUrl(newInvoiceRef.id, null),
          });
          ops.push(transporter.sendMail({
            from: `"FivoCRM" <${smtpUser}>`,
            to: customer.email,
            subject,
            html,
          }).then(() => newInvoiceRef.update({ emailSent: true, updatedAt: admin.firestore.Timestamp.now() })));
        }
      } catch { /* skip email on error */ }
    }

    // Notification to creator
    if (invoice.createdByUserId) {
      const freqLabel: Record<string, string> = { weekly: 'javore', monthly: 'mujore', quarterly: 'tremujore', yearly: 'vjetore' };
      ops.push(notifyUser({
        userId: invoice.createdByUserId,
        type: 'auto_invoice_created',
        title: `🧾 Faturë e re periodike: #${invoiceNumber}`,
        message: `Fatura ${freqLabel[freq] || freq} u gjenerua automatikisht (${formatMoney(invoice.total || invoice.amount || 0, invoice.currency)}).`,
        actionUrl: '/app/invoices',
        actionLabel: 'Shiko Faturat',
        businessId: invoice.businessId ?? null,
        teamId: invoice.teamId ?? null,
        customerId: invoice.customerId ?? null,
      }));
    }

    created++;
  }

  await settleAll(ops, 'recurring-invoices');

  // ── Part 2: Project-driven recurrence (a retainer bills its own fee) ─────────
  // Guarded by projectBillingBlockReason() so that, unlike before, a Cancelled or
  // Archived retainer stops for good, `weekly` actually bills, a paused/expired
  // series is honoured, and the period KEY makes the run idempotent against the
  // first invoice the UI creates at project-creation time.
  const legacyOps: Promise<any>[] = [];

  const projectsSnap = await scoped(db.collection('projects').where('isRecurring', '==', true)).get();
  let legacyCreated = 0;
  let zeroBudget = 0;
  let projectPeriodsMissed = 0;

  for (const projectDoc of projectsSnap.docs) {
    const project = projectDoc.data();
    if (project.businessId && suspendedBusinessIds.has(project.businessId)) {
      suspendedSkipped++; skipped++; continue;
    }
    const frequency: string = project.recurringFrequency || 'monthly';

    const block = projectBillingBlockReason(project, now);
    if (block) {
      // A permanently-blocked series is switched off so we stop reading — and
      // re-evaluating — it on every single run.
      if (PERMANENT_BILLING_BLOCKS.includes(block)) {
        legacyOps.push(projectDoc.ref.update({
          isRecurring: false,
          recurringBillingStoppedReason: block,
          // Remember that this WAS a retainer, exactly as `archiveProjectPatch`
          // does. Without the token, setting a project to Cancelled and then
          // reopening it gave back a project that silently never billed again —
          // the hazard src/lib/projectArchive.ts exists for, which until now was
          // only handled on the Archived path.
          ...(project.isRecurring ? { wasRecurringBeforeArchive: true } : {}),
          updatedAt: admin.firestore.Timestamp.now(),
        }));
      }
      // A contradictory setup ("periodic" + "one-time fee") must not fail silently:
      // such a project used to be billed monthly anyway, multiplying a single deal
      // value. Tell the owner once per period which setting to fix.
      if (block === 'one-time' || block === 'unsupported-frequency') {
        const noticeKey = `${block}:${projectBillingPeriodKey('monthly', now)}`;
        if (project.billingConfigNoticeKey !== noticeKey) {
          legacyOps.push(projectDoc.ref.update({ billingConfigNoticeKey: noticeKey, updatedAt: admin.firestore.Timestamp.now() }));
          const uid = project.responsibleUserId || project.createdByUserId;
          if (uid) {
            legacyOps.push(notifyUser({
              userId: uid,
              type: 'recurring_project_billing_misconfigured',
              title: `⚠️ Faturimi periodik i "${project.name}" është i ndalur`,
              message: block === 'one-time'
                ? 'Projekti është shënuar periodik, por lloji i faturimit është "një-herësh" — ndaj nuk gjenerohet faturë. Ndrysho llojin e faturimit në "mujore".'
                : `Frekuenca "${frequency}" nuk mbështetet për faturim automatik. Zgjidh "javore" ose "mujore".`,
              actionUrl: `/app/projects/${projectDoc.id}`,
              actionLabel: 'Hap Projektin',
              businessId: project.businessId ?? null,
              teamId: project.teamId ?? null,
              customerId: project.customerId ?? null,
              projectId: projectDoc.id,
            }));
          }
        }
      }
      skipped++;
      continue;
    }

    const periodKey = projectBillingPeriodKey(frequency, now);
    const periodEnd = projectBillingPeriodEnd(frequency, now);
    const budget = Number(project.budget) || 0;

    // NEVER email a 0-value invoice. A retainer priced only through attached
    // services (no budget) used to produce a "Pending 0 L" invoice and mail it to
    // the client. Warn the owner once per period instead, so it is not silent.
    if (budget <= 0) {
      zeroBudget++;
      if (project.zeroBudgetNoticePeriodKey !== periodKey) {
        legacyOps.push(projectDoc.ref.update({
          zeroBudgetNoticePeriodKey: periodKey,
          updatedAt: admin.firestore.Timestamp.now(),
        }));
        const notifyUid = project.responsibleUserId || project.createdByUserId;
        if (notifyUid) {
          legacyOps.push(notifyUser({
            userId: notifyUid,
            type: 'recurring_project_no_budget',
            title: `⚠️ Projekti periodik "${project.name}" nuk mund të faturohet`,
            message: 'Projekti është periodik por nuk ka buxhet (tarifë) të caktuar, ndaj nuk u gjenerua faturë. Vendos buxhetin për të rifilluar faturimin automatik.',
            actionUrl: `/app/projects/${projectDoc.id}`,
            actionLabel: 'Hap Projektin',
            businessId: project.businessId ?? null,
            teamId: project.teamId ?? null,
            customerId: project.customerId ?? null,
            projectId: projectDoc.id,
          }));
        }
      }
      skipped++;
      continue;
    }

    const periodLabel = frequency === 'weekly'
      ? `java ${startOfBillingWeek(now).toLocaleDateString('sq-AL', { day: '2-digit', month: 'long' })}`
      : now.toLocaleDateString('sq-AL', { month: 'long', year: 'numeric' });
    const currency: 'ALL' | 'EUR' = project.currency === 'EUR' ? 'EUR' : 'ALL';
    // Period key in the number so weekly children in the same month never collide.
    const invoiceLabel = `AUTO-${periodKey}-${projectDoc.id.slice(0, 6).toUpperCase()}`;
    // One invoice per (project, period), enforced by the id — see Part 1.
    const invoiceRef = db.collection('invoices').doc(recurringOccurrenceId('auto', projectDoc.id, periodKey));

    const projectOccurrence = { invoiceNumber: invoiceLabel, projectId: projectDoc.id, customerId: project.customerId || null, teamId: project.teamId || null, businessId: project.businessId || null, amount: budget, subtotal: budget, total: budget, tax: 0, discount: 0, discountType: 'fixed', currency, status: 'Pending', notes: `Faturë e gjeneruar automatikisht për projektin periodik "${project.name}" – ${periodLabel}.`, invoiceDate: admin.firestore.Timestamp.now(), dueDate: admin.firestore.Timestamp.fromDate(periodEnd), isRecurring: false, autoGenerated: true, billingPeriodKey: periodKey, emailSent: false, reminderSent: false, reminder25Sent: false, reminderLastDaySent: false, createdByUserId: project.createdByUserId || null, createdAt: admin.firestore.Timestamp.now(), updatedAt: admin.firestore.Timestamp.now() };
    try {
      await invoiceRef.create(projectOccurrence);
    } catch (err) {
      if (!isAlreadyExists(err)) throw err;
      // Already billed for this period (a concurrent run, or the invoice the UI
      // creates at project-creation time). Claim the period and move on.
      legacyOps.push(projectDoc.ref.update({
        lastInvoicePeriodKey: periodKey,
        updatedAt: admin.firestore.Timestamp.now(),
      }));
      skipped++; continue;
    }
    // businessId + customerId are mandatory: `invoiceItems` is business-isolated and
    // read by the portal via `isPortalClientFor(customerId)`. Without them the line
    // is unreadable by staff AND client — see the Part 1 copy above.
    legacyOps.push(db.collection('invoiceItems').doc().set({ invoiceId: invoiceRef.id, description: `${project.name} – ${periodLabel}`, quantity: 1, unitPrice: budget, totalPrice: budget, teamId: project.teamId || null, businessId: project.businessId || null, customerId: project.customerId || null, createdAt: admin.firestore.Timestamp.now(), updatedAt: admin.firestore.Timestamp.now() }));

    if (transporter && smtpUser && project.customerId) {
      try {
        const customerDoc = await db.collection('customers').doc(project.customerId).get();
        const customer = customerDoc.data();
        if (customer?.email) {
          const { subject, html } = buildInvoiceEmail({ customerName: customer.name || 'Klient', invoiceNumber: invoiceLabel, amount: budget, dueDate: periodEnd, projectName: project.name, type: 'initial', currency, paymentMethod: project.paymentMethod, bankName: project.bankName, bankIBAN: project.bankIBAN, bankSWIFT: project.bankSWIFT, bankAccountHolder: project.bankAccountHolder, bankCountry: project.bankCountry, payUrl: await publicInvoicePayUrl(invoiceRef.id, null) });
          legacyOps.push(transporter.sendMail({ from: `"FivoCRM" <${smtpUser}>`, to: customer.email, subject, html })
            .then(() => invoiceRef.update({ emailSent: true, updatedAt: admin.firestore.Timestamp.now() })));
        }
      } catch { /* skip */ }
    }

    // Periods this retainer never billed (cron downtime, a late deploy). The
    // invoice engine has always reported its gap; the project engine derives
    // everything from `now`, so a missed month simply vanished — the owner found
    // out, if at all, from an annual report.
    const missedPeriods = projectPeriodsSkipped(frequency, project.lastInvoicePeriodKey, now);

    // Record the period so no later run (and no UI action) bills it twice.
    legacyOps.push(projectDoc.ref.update({
      lastInvoicePeriodKey: periodKey,
      lastInvoiceGeneratedAt: admin.firestore.Timestamp.now(),
      ...(missedPeriods > 0
        ? { billingPeriodsSkipped: missedPeriods, billingPeriodsSkippedAt: admin.firestore.Timestamp.now() }
        : {}),
      updatedAt: admin.firestore.Timestamp.now(),
    }));
    if (missedPeriods > 0) {
      projectPeriodsMissed += missedPeriods;
      const missUid = project.responsibleUserId || project.createdByUserId;
      if (missUid) {
        legacyOps.push(notifyUser({
          userId: missUid,
          type: 'auto_invoice_created',
          title: `⚠️ ${missedPeriods} periudhë pa faturë: ${project.name}`,
          message: `Retaineri kishte mbetur pas — u faturua vetëm periudha aktuale. ${missedPeriods} periudhë të mëparshme NUK u faturuan; faturoji manualisht nëse duhen.`,
          actionUrl: `/app/projects/${projectDoc.id}`,
          actionLabel: 'Hap Projektin',
          businessId: project.businessId ?? null,
          teamId: project.teamId ?? null,
          customerId: project.customerId ?? null,
          projectId: projectDoc.id,
        }));
      }
    }
    const notifyUid = project.responsibleUserId || project.createdByUserId;
    if (notifyUid) legacyOps.push(notifyUser({ userId: notifyUid, type: 'auto_invoice_created', title: `🧾 Faturë e re automatike: ${project.name}`, message: `Fatura #${invoiceLabel} (${budget.toLocaleString('sq-AL')} ${currency}) u gjenerua automatikisht.`, actionUrl: '/app/invoices', actionLabel: 'Shiko Faturat', businessId: project.businessId ?? null, teamId: project.teamId ?? null, customerId: project.customerId ?? null, projectId: projectDoc.id }));

    legacyCreated++;
  }

  await settleAll(legacyOps, 'recurring-invoices-legacy');
  // `blocked` is what the manual "Gjenero Periodike" run reports back: a named
  // reason per skipped series instead of an opaque count, so "0 created" is
  // explainable ("3 already-generated, 1 paused") rather than alarming.
  return { created, legacyCreated, skipped, zeroBudget, blocked: blockedReasons, projectPeriodsMissed, suspendedSkipped, businessId: scopeId };
}

// ── JOB: project-completion-reminder ─────────────────────────────────────────
async function runProjectCompletionReminder() {
  const transporter = makeTransporter();
  const smtpUser = safeSenderAddress(process.env.SMTP_USER);
  const now = new Date();

  const projectsSnap = await db.collection('projects').where('status', 'in', ['Active', 'Planning', 'On Hold']).get();
  if (projectsSnap.empty) return { notified: 0 };

  const userProjectMap = new Map<string, { name: string; status: string }[]>();
  // Tenant stamp for the notification doc — without it the row escapes GDPR
  // export/delete. A responsible user's open projects are all in their business.
  const userBusinessMap = new Map<string, string>();
  for (const doc of projectsSnap.docs) {
    const p = doc.data();
    if (!p.responsibleUserId) continue;
    const existing = userProjectMap.get(p.responsibleUserId) || [];
    existing.push({ name: p.name || 'Pa emër', status: p.status });
    userProjectMap.set(p.responsibleUserId, existing);
    if (p.businessId && !userBusinessMap.has(p.responsibleUserId)) {
      userBusinessMap.set(p.responsibleUserId, p.businessId);
    }
  }

  let notified = 0;
  const ops: Promise<any>[] = [];

  // Dedup window: don't send a second open-projects reminder while the user still
  // has a recent unread one (guards against the job running more than once/week).
  const DEDUP_MS = 3 * 24 * 60 * 60 * 1000; // 3 days
  const cutoffMs = now.getTime() - DEDUP_MS;

  for (const [userId, userProjects] of userProjectMap) {
    // Bounded dedup check. This used to read the user's ENTIRE notification history
    // ("index-free") on every run, for every user, just to answer "did I already
    // remind them this week?". Now it asks the index that question directly:
    // userId + type + newest-first, capped at one document.
    // Requires the composite index (userId, type, createdAt DESC) — declared in
    // firestore.indexes.json.
    const existing = await db.collection('notifications')
      .where('userId', '==', userId)
      .where('type', '==', 'project_open_reminder')
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get();
    const hasRecentReminder = existing.docs.some(d => {
      const n = d.data();
      if (n.isRead) return false;
      const ms = typeof n.createdAt?.toMillis === 'function' ? n.createdAt.toMillis() : 0;
      return ms >= cutoffMs;
    });
    if (hasRecentReminder) continue;

    const prefs = await getUserPrefs(userId);
    ops.push(notifyUser({ userId, type: 'project_open_reminder', title: `📋 ${userProjects.length} projekt${userProjects.length > 1 ? 'e' : ''} akoma të hapura`, message: `Ke ${userProjects.length} projekt${userProjects.length > 1 ? 'e' : ''} të hapur${userProjects.length > 1 ? 'a' : ''} pa mbyllur këtë javë.`, actionUrl: '/app/projects', actionLabel: 'Shiko Projektet', businessId: userBusinessMap.get(userId) ?? null, prefs, email: false }));
    // The richer email below honours the same gates as everywhere else — this was
    // the LAST job that mailed users who had turned email off (no prefs check at all).
    if (transporter && smtpUser && prefs?.emailEnabled !== false && !isSilenced(prefs, 'project_open_reminder')) {
      try {
        const userRecord = await admin.auth().getUser(userId);
        if (userRecord.email) {
          const projectListHtml = userProjects.map(p => `<li><strong>${p.name}</strong> – <span style="color:#6b7280">${p.status}</span></li>`).join('');
          ops.push(transporter.sendMail({ from: `"FivoCRM" <${smtpUser}>`, to: userRecord.email, subject: `📋 Kujtesë javore: ${userProjects.length} projekt të hapur`, html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px"><h2 style="color:#667eea">📋 Kujtesë Javore e Projekteve</h2><ul>${projectListHtml}</ul><p style="color:#9ca3af;font-size:12px">FivoCRM – Kujtesë automatike javore</p></div>` }));
        }
      } catch { /* skip */ }
    }
    notified++;
  }

  await settleAll(ops, 'project-completion-reminder');
  return { notified, totalOpenProjects: projectsSnap.size };
}

// ── JOB: recurring-project-reset ─────────────────────────────────────────────
async function runRecurringProjectReset() {
  const now = new Date();
  const projectsSnap = await db.collection('projects').where('isRecurring', '==', true).get();
  if (projectsSnap.empty) return { reset: 0 };

  let resetCount = 0;
  const ops: Promise<any>[] = [];

  for (const projectDoc of projectsSnap.docs) {
    const project = projectDoc.data();
    const lastCompletedAt: Date | null = project.lastCompletedAt?.toDate ? project.lastCompletedAt.toDate() : project.lastCompletedAt ? new Date(project.lastCompletedAt) : null;
    if (!lastCompletedAt) continue;

    const frequency = project.recurringFrequency || 'monthly';
    const d = new Date(lastCompletedAt);
    let nextCycle: Date;
    if (frequency === 'weekly') { d.setDate(d.getDate() + 7); nextCycle = d; }
    else { d.setDate(1); d.setMonth(d.getMonth() + 1); d.setHours(0, 0, 0, 0); nextCycle = d; }

    if (now < nextCycle) continue;

    const tasksSnap = await db.collection('tasks').where('projectId', '==', projectDoc.id).get();
    if (tasksSnap.empty) continue;
    if (!tasksSnap.docs.every(t => t.data().status === 'Done')) continue;

    // BOTH alert flags reset — clearing only dueNotificationSent left reused
    // tasks unable to overdue-alert ever again.
    for (const taskDoc of tasksSnap.docs) ops.push(taskDoc.ref.update({ status: 'Todo', updatedAt: admin.firestore.Timestamp.now(), dueNotificationSent: false, overdueNotificationSent: false }));
    ops.push(projectDoc.ref.update({ status: 'Active', nextRecurringDate: nextCycle, updatedAt: admin.firestore.Timestamp.now() }));
    if (project.responsibleUserId) ops.push(notifyUser({ userId: project.responsibleUserId, type: 'project_cycle_reset', title: `🔄 Projekti "${project.name}" u riaktivizua`, message: `Cikli i ri ka filluar. Të gjitha detyrat janë rivendosur te "Për të bërë".`, actionUrl: `/app/projects/${projectDoc.id}`, actionLabel: 'Shiko Projektin', businessId: project.businessId ?? null, teamId: project.teamId ?? null, customerId: project.customerId ?? null, projectId: projectDoc.id }));
    resetCount++;
  }

  await settleAll(ops, 'recurring-project-reset');
  return { reset: resetCount };
}

// ── Recurring EXPENSES ───────────────────────────────────────────────────────
// Mirrors src/lib/finance/recurringExpenses.ts (unit-tested there) — keep in sync.
// The period KEY is the idempotency token, exactly as for project billing. The
// old guard compared the newest child's `createdAt` against the due date: as soon
// as a series lagged more than one cycle, the catch-up child was newer than every
// remaining due date, so the guard stayed true forever and the series died after
// one occurrence.
// `quarterly` is supported here too: it used to exist only in cashflowAlarms'
// FREQ_TO_MONTHLY table, so a quarterly series fed the cash-flow alarm with
// money this job then refused to generate — and `unsupported-frequency` had no
// UI surface, so the series was simply dead. Keep in sync with
// SUPPORTED_EXPENSE_FREQUENCIES in src/lib/finance/recurringExpenses.ts.
const SUPPORTED_EXPENSE_FREQUENCIES = ['weekly', 'monthly', 'quarterly', 'yearly'];

function expensePeriodKey(frequency: string, at: Date): string {
  const p2 = (n: number) => String(n).padStart(2, '0');
  if (frequency === 'weekly') {
    const m = zonedParts(startOfBillingWeek(at));
    return `W${m.year}-${p2(m.month + 1)}-${p2(m.day)}`;
  }
  const z = zonedParts(at);
  if (frequency === 'yearly') return `Y${z.year}`;
  if (frequency === 'quarterly') return `Q${z.year}-${Math.floor(z.month / 3) + 1}`;
  return `${z.year}-${p2(z.month + 1)}`;
}

/** +N months without the setMonth overflow (31 Jan → 28 Feb, never 3 Mar). */
function addMonthsClamped(from: Date, months: number, anchorDay?: number): Date {
  return addZonedMonthsClamped(from, months, anchorDay);
}

function nextExpenseOccurrence(from: Date, frequency: string, anchorDay?: number): Date {
  if (frequency === 'weekly') return addZonedDays(from, 7);
  if (frequency === 'yearly') return addZonedYears(from, 1);
  // Quarterly goes through the clamped adder too: 30 Nov + 3 months must be
  // 28/29 Feb, never 2 Mar.
  if (frequency === 'quarterly') return addMonthsClamped(from, 3, anchorDay);
  return addMonthsClamped(from, 1, anchorDay);
}

/** Why this series may not generate now, or null when an occurrence is due. */
function expenseGenerationBlockReason(expense: any, now: Date): string | null {
  if (!expense.isRecurring) return 'not-recurring';
  if (expense.autoGenerated) return 'auto-generated';
  const frequency: string = expense.recurringFrequency || 'monthly';
  if (!SUPPORTED_EXPENSE_FREQUENCIES.includes(frequency)) return 'unsupported-frequency';

  const rawNext = expense.nextRecurringDate;
  const nextDate: Date | null = rawNext ? (rawNext.toDate ? rawNext.toDate() : new Date(rawNext)) : null;
  if (!nextDate || isNaN(nextDate.getTime())) return 'no-next-date';

  const rawEnd = expense.recurringEndDate;
  const endDate: Date | null = rawEnd ? (rawEnd.toDate ? rawEnd.toDate() : new Date(rawEnd)) : null;
  if (endDate && !isNaN(endDate.getTime()) && nextDate > endDate) return 'series-ended';

  if (expense.isRecurringPaused) return 'paused';
  // Mirrors src/lib/finance/recurringExpenses.ts: the form's Active/Inactive
  // switch stops the series like a pause. It used to change nothing, so a
  // series the owner had switched off kept producing rows every month.
  if (expense.status && expense.status !== 'Active') return 'inactive';
  if (nextDate > now) return 'not-due';
  if (expense.lastGeneratedPeriodKey === expensePeriodKey(frequency, nextDate)) return 'already-generated';
  return null;
}

// ── JOB: recurring-expenses ──────────────────────────────────────────────────
async function runRecurringExpenses(opts?: { businessId?: string | null }) {
  const now = new Date();

  // A manual run stays inside the caller's tenant: this job WRITES rows into a
  // tenant's books and notifies their staff (bell + push + email), so an
  // unscoped manual trigger let one Admin book costs for every other tenant.
  const scopeId = opts?.businessId || null;
  const scoped = <T extends FirebaseFirestore.Query>(q: T): T =>
    (scopeId ? q.where('businessId', '==', scopeId) : q) as T;

  // A suspended tenant must not keep accruing costs and notifications. The
  // Admin SDK bypasses `tenantActive()`, so the exclusion belongs here.
  const suspendedBusinessIds = new Set<string>();
  try {
    const suspSnap = await db.collection('businesses').where('status', '==', 'suspended').get();
    suspSnap.docs.forEach(d => suspendedBusinessIds.add(d.id));
  } catch { /* a failed lookup must not stop generation for everyone else */ }
  let suspendedSkipped = 0;

  const expensesSnap = await scoped(db.collection('expenses').where('isRecurring', '==', true)).get();
  if (expensesSnap.empty) return { created: 0, healed: 0, ended: 0, suspendedSkipped, scopedTo: scopeId };

  let created = 0, healed = 0, ended = 0;
  const ops: Promise<any>[] = [];

  for (const doc of expensesSnap.docs) {
    const expense = doc.data();
    if (expense.businessId && suspendedBusinessIds.has(expense.businessId)) { suspendedSkipped++; continue; }
    const frequency: string = expense.recurringFrequency || 'monthly';
    const reason = expenseGenerationBlockReason(expense, now);

    // Self-heal: a series marked periodic with no due date never generated
    // anything at all (observed live on 4 salary series). Seeded FORWARD from
    // now — backfilling the months it missed would rewrite closed books, which
    // is the owner's call, not a cron job's.
    if (reason === 'no-next-date') {
      const rawOwn = expense.date || expense.createdAt;
      const ownRaw: Date = rawOwn?.toDate ? rawOwn.toDate() : (rawOwn ? new Date(rawOwn) : now);
      const own = isNaN(ownRaw.getTime()) ? now : ownRaw;
      const anchor = own > now ? own : now;
      // An EXISTING anchor is never rewritten. `own.getDate()` is the parent's
      // own day read in whatever zone the process runs in, so healing a 31st
      // series degraded it to the 30th for good — the exact drift the anchor
      // exists to prevent. Only a series that never had one gets a fresh anchor,
      // and that one is read in the business zone.
      const storedAnchorRaw = Number(expense.recurringAnchorDay);
      const storedAnchor = Number.isFinite(storedAnchorRaw) && storedAnchorRaw >= 1 && storedAnchorRaw <= 31
        ? Math.round(storedAnchorRaw) : null;
      const healAnchor = storedAnchor ?? zonedParts(own).day;
      const seeded = nextExpenseOccurrence(anchor, frequency, healAnchor);
      ops.push(doc.ref.update({
        nextRecurringDate: admin.firestore.Timestamp.fromDate(seeded),
        recurringAnchorDay: healAnchor,
        // The current period is already on the books (or deliberately not being
        // backfilled) — record it so the heal can never create a row for it.
        lastGeneratedPeriodKey: expensePeriodKey(frequency, anchor),
        updatedAt: admin.firestore.Timestamp.now(),
      }));
      healed++;
      continue;
    }

    // "Repeat until": the series is complete — stop generating. Past entries stay.
    if (reason === 'series-ended') {
      ops.push(doc.ref.update({ isRecurring: false, nextRecurringDate: null, updatedAt: admin.firestore.Timestamp.now() }));
      ended++;
      continue;
    }

    if (reason) continue;  // not-due / paused / already-generated / unsupported

    const rawNext = expense.nextRecurringDate;
    const nextDate: Date = rawNext.toDate ? rawNext.toDate() : new Date(rawNext);
    const periodKey = expensePeriodKey(frequency, nextDate);
    const anchorDay: number = expense.recurringAnchorDay || nextDate.getDate();

    // Belt and braces for series that predate `lastGeneratedPeriodKey`: refuse if
    // a child already sits in this period. One equality query, no composite index.
    const existingChildSnap = await db.collection('expenses')
      .where('parentExpenseId', '==', doc.id)
      .where('autoGenerated', '==', true)
      .get();
    const alreadyInPeriod = existingChildSnap.docs.some(d => {
      const c = d.data();
      if (c.periodKey) return c.periodKey === periodKey;
      const raw = c.date || c.createdAt;
      const cd: Date | null = raw?.toDate ? raw.toDate() : (raw ? new Date(raw) : null);
      return !!cd && !isNaN(cd.getTime()) && expensePeriodKey(frequency, cd) === periodKey;
    });
    if (alreadyInPeriod) {
      // Record the key and move on, so the next run advances instead of retrying.
      ops.push(doc.ref.update({
        lastGeneratedPeriodKey: periodKey,
        nextRecurringDate: admin.firestore.Timestamp.fromDate(nextExpenseOccurrence(nextDate, frequency, anchorDay)),
        updatedAt: admin.firestore.Timestamp.now(),
      }));
      continue;
    }

    const next = nextExpenseOccurrence(nextDate, frequency, anchorDay);

    // Create a new expense entry for this cycle. Use the SCHEDULED date (nextDate),
    // not today, so the occurrence lands in its planned month even if cron runs late.
    ops.push(db.collection('expenses').add({
      title: expense.title,
      description: expense.description || null,
      amount: expense.amount,
      currency: expense.currency || 'ALL',
      category: expense.category,
      teamId: expense.teamId || null,
      // Carry tenant scope forward so business-scoped queries don't drop the entry.
      businessId: expense.businessId || null,
      projectId: expense.projectId || null,
      departmentId: expense.departmentId || null,
      memberId: expense.memberId || null,
      isRecurring: false, // child entries are not recurring themselves
      autoGenerated: true,
      parentExpenseId: doc.id,
      periodKey,
      status: expense.status || 'Active',
      // INHERIT the parent's approval. A generated occurrence is the same
      // committed charge the parent was approved for, so forcing every one back
      // to 'Submitted' just parked an ever-growing "në pritje miratimi" badge on
      // rows that already count in every total — noise, with no accounting
      // effect (only 'Rejected' is excluded from the books).
      approvalStatus: expense.approvalStatus === 'Rejected' ? 'Submitted' : (expense.approvalStatus || 'Submitted'),
      approvedByUserId: expense.approvalStatus === 'Approved' ? (expense.approvedByUserId || null) : null,
      createdByUserId: expense.createdByUserId || null,
      date: admin.firestore.Timestamp.fromDate(nextDate),
      createdAt: admin.firestore.Timestamp.now(),
      updatedAt: admin.firestore.Timestamp.now(),
    }));

    // Advance the parent AND record the period — a failed write here used to be
    // invisible; now the key makes a retry idempotent instead of duplicating.
    ops.push(doc.ref.update({
      nextRecurringDate: admin.firestore.Timestamp.fromDate(next),
      lastGeneratedPeriodKey: periodKey,
      recurringAnchorDay: anchorDay,
      updatedAt: admin.firestore.Timestamp.now(),
    }));

    // Notify the creator
    if (expense.createdByUserId) {
      ops.push(notifyUser({
        userId: expense.createdByUserId,
        type: 'recurring_expense_created',
        title: `🔄 Shpenzim periodik: ${expense.title}`,
        message: `Shpenzimi periodik "${expense.title}" (${formatMoney(expense.amount, expense.currency)}) u krijua automatikisht.`,
        actionUrl: '/app/expenses',
        actionLabel: 'Shiko Shpenzimet',
        businessId: expense.businessId ?? null,
        teamId: expense.teamId ?? null,
      }));
    }
    created++;
  }

  await settleAll(ops, 'recurring-expenses');
  return { created, healed, ended, suspendedSkipped, scopedTo: scopeId };
}

// ── JOB: expire-invitations ───────────────────────────────────────────────────
async function runExpireInvitations() {
  const now = admin.firestore.Timestamp.fromDate(new Date());
  const invitesSnap = await db.collection('teamInvites').where('status', '==', 'Pending').get();
  if (invitesSnap.empty) return { expired: 0 };

  let expired = 0;
  const ops: Promise<any>[] = [];

  for (const doc of invitesSnap.docs) {
    const invite = doc.data();
    if (!invite.expiresAt) continue;
    const expiresAt: Date = invite.expiresAt?.toDate ? invite.expiresAt.toDate() : new Date(invite.expiresAt);
    if (isNaN(expiresAt.getTime()) || expiresAt > new Date()) continue;

    ops.push(doc.ref.update({ status: 'Expired', updatedAt: now }));
    expired++;
  }

  await settleAll(ops, 'expire-invitations');
  return { expired };
}

// ── JOB: goal-overdue-alerts ─────────────────────────────────────────────────
async function runGoalOverdueAlerts() {
  const now = new Date();
  const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  // A goal can only be overdue by dueDate, or (when it has none) by being older than
  // two weeks — two indexed range queries instead of reading every tenant's goals.
  const [byDue, byCreated] = await Promise.all([
    db.collection('goals').where('dueDate', '<=', admin.firestore.Timestamp.fromDate(now)).get(),
    db.collection('goals').where('createdAt', '<=', admin.firestore.Timestamp.fromDate(twoWeeksAgo)).get(),
  ]);
  const goalDocs = new Map<string, admin.firestore.QueryDocumentSnapshot>();
  for (const d of [...byDue.docs, ...byCreated.docs]) goalDocs.set(d.id, d);
  const goalsSnap = { empty: goalDocs.size === 0, docs: Array.from(goalDocs.values()) };
  if (goalsSnap.empty) return { notified: 0 };

  let notified = 0;
  const ops: Promise<any>[] = [];

  for (const goalDoc of goalsSnap.docs) {
    const goal = goalDoc.data();

    // Skip if already achieved or already notified
    if (goal.status === 'Achieved') continue;
    if (goal.goalOverdueSent) continue;

    // Determine the reference date (dueDate preferred, fall back to createdAt)
    const refDate: Date | null =
      goal.dueDate?.toDate?.() ? goal.dueDate.toDate()
      : goal.dueDate ? new Date(goal.dueDate)
      : goal.createdAt?.toDate?.() ? goal.createdAt.toDate()
      : goal.createdAt ? new Date(goal.createdAt)
      : null;

    if (!refDate || refDate > twoWeeksAgo) continue;

    const recipientId = goal.ownerId || goal.createdByUserId;
    if (!recipientId) continue;

    ops.push(goalDoc.ref.update({
      goalOverdueSent: true,
      updatedAt: admin.firestore.Timestamp.now(),
    }));
    const goalTitle = `⚠️ Objektiv i Vonuar: "${goal.title || 'Pa titull'}"`;
    const goalMsg = `Ky objektiv ka kaluar afatin prej më shumë se 2 javësh dhe ende nuk është arritur.`;
    ops.push(notifyUser({
      userId: recipientId,
      type: 'goal_overdue',
      title: goalTitle,
      message: goalMsg,
      actionUrl: '/app/goals',
      actionLabel: 'Shiko Objektivat',
      businessId: goal.businessId ?? null,
      teamId: goal.teamId ?? null,
    }));
    notified++;
  }

  await settleAll(ops, 'goal-overdue-alerts');
  return { notified };
}

// ── JOB: lead-follow-up-reminders (leads + customers) ────────────────────────
// Every morning at 08:30 Europe/Tirane (vps/server.ts, scheduleDailyInZone — NOT
// in run-all: "this morning" is a wall-clock promise) tell the owner of every
// contact whose next step is due today or overdue. Reads ONLY docs with
// `nextFollowUpDate <= end of today (local)` on `leads` AND `customers` — a
// single-field range, no composite index needed — instead of the old full
// `status in [...]` scan of the whole leads collection.
//
// Mirrors the day math of src/lib/crm/followUp.ts (`dueState`): calendar days
// in Europe/Tirane via startOfRecurrenceDay, never setHours(0,0,0,0) — the
// browser abroad and this UTC process must agree on what "today" is.
//
// Idempotency: `lastReminderSentAt` (23h debounce, so a retry the same morning
// is silent and tomorrow's run fires again for a still-open step).
//
// Note: the range compares Timestamps, so a legacy `nextFollowUpDate` stored as
// an ISO STRING is not matched (Firestore ranges are type-bound). Every current
// write path (src/lib/crm/followUp.ts) stores a Date → Timestamp.
const FOLLOW_UP_TYPE_LABEL: Record<string, string> = {
  call: 'Telefonatë', whatsapp: 'WhatsApp', email: 'Email', meeting: 'Takim', other: 'Tjetër',
};
const FOLLOW_UP_PAGE = 500;
const FOLLOW_UP_MAX_PAGES = 10; // 5 000 due contacts per collection per run — plenty, and bounded.

async function dueFollowUpDocs(
  collection: 'leads' | 'customers',
  endOfTodayMs: number,
  scopeBusinessId: string | null,
): Promise<admin.firestore.QueryDocumentSnapshot[]> {
  const cutoff = admin.firestore.Timestamp.fromMillis(endOfTodayMs);
  const build = (scoped: boolean) => {
    let q: admin.firestore.Query = db.collection(collection);
    if (scoped && scopeBusinessId) q = q.where('businessId', '==', scopeBusinessId);
    return q.where('nextFollowUpDate', '<=', cutoff).orderBy('nextFollowUpDate', 'asc');
  };
  const page = async (scoped: boolean) => {
    const out: admin.firestore.QueryDocumentSnapshot[] = [];
    let last: admin.firestore.QueryDocumentSnapshot | null = null;
    for (let i = 0; i < FOLLOW_UP_MAX_PAGES; i++) {
      let q = build(scoped).limit(FOLLOW_UP_PAGE);
      if (last) q = q.startAfter(last);
      const snap = await q.get();
      out.push(...snap.docs);
      if (snap.size < FOLLOW_UP_PAGE) break;
      last = snap.docs[snap.docs.length - 1];
    }
    if (out.length >= FOLLOW_UP_PAGE * FOLLOW_UP_MAX_PAGES) {
      console.warn(`[follow-up-reminders] ${collection}: hit the ${FOLLOW_UP_PAGE * FOLLOW_UP_MAX_PAGES}-doc cap — the rest waits for tomorrow`);
    }
    return out;
  };
  if (!scopeBusinessId) return page(false);
  try {
    // (businessId, nextFollowUpDate) composite index — declared in firestore.indexes.json.
    return await page(true);
  } catch (err: any) {
    // Index not deployed yet: fall back to the single-field range and filter in memory.
    console.warn(`[follow-up-reminders] scoped ${collection} read failed (${err?.message || err}) — falling back to unscoped range`);
    return (await page(false)).filter(d => d.data().businessId === scopeBusinessId);
  }
}

async function runFollowUpReminders(opts: { businessId?: string | null } = {}) {
  const now = new Date();
  const nowMs = now.getTime();
  const todayStartMs = startOfRecurrenceDay(now);
  const endOfTodayMs = todayStartMs + 86_400_000 - 1;
  const debounceCutoffMs = nowMs - 23 * 60 * 60 * 1000;
  const scope = opts.businessId || null;
  const ms = (v: any): number => (v?.toMillis ? v.toMillis() : (v?.toDate ? v.toDate().getTime() : (v ? new Date(v).getTime() : 0)));

  const [leadDocs, customerDocs] = await Promise.all([
    dueFollowUpDocs('leads', endOfTodayMs, scope),
    dueFollowUpDocs('customers', endOfTodayMs, scope),
  ]);

  // The Admin SDK bypasses tenantActive(): exclude suspended tenants ourselves.
  const suspendedBusinessIds = new Set<string>();
  try {
    const suspSnap = await db.collection('businesses').where('status', '==', 'suspended').get();
    suspSnap.docs.forEach(d => suspendedBusinessIds.add(d.id));
  } catch { /* fail-open on the read */ }

  let leadsNotified = 0, customersNotified = 0, waSent = 0;
  let skippedDebounce = 0, noRecipient = 0, suspendedSkipped = 0, skippedStatus = 0;
  const ops: Promise<any>[] = [];

  // Per-run caches so we read each team's settings / template only once.
  const tsCache = new Map<string, any>();
  const tplCache = new Map<string, any>();
  const getTeamSettings = async (teamId: string) => {
    if (!teamId) return null;
    if (tsCache.has(teamId)) return tsCache.get(teamId);
    const data = await getTeamConfig(teamId);
    tsCache.set(teamId, data);
    return data;
  };
  const getTemplate = async (id: string) => {
    if (!id) return null;
    if (tplCache.has(id)) return tplCache.get(id);
    const doc = await db.collection('waTemplates').doc(id).get();
    const data = doc.exists ? doc.data() : null;
    tplCache.set(id, data);
    return data;
  };

  const dueInfo = (dueMs: number): { overdue: boolean; days: number } => {
    const dayDiff = Math.round((startOfRecurrenceDay(new Date(dueMs)) - todayStartMs) / 86_400_000);
    return { overdue: dayDiff < 0, days: -dayDiff };
  };

  const process = async (kind: 'lead' | 'customer', doc: admin.firestore.QueryDocumentSnapshot) => {
    const c = doc.data();
    const dueMs = ms(c.nextFollowUpDate);
    if (!dueMs || dueMs > endOfTodayMs) return;                       // defensive: the query already bounds it

    if (kind === 'lead' && ['Won', 'Lost', 'Converted'].includes(c.status)) { skippedStatus++; return; }
    if (kind === 'customer' && ['Inactive', 'Suspended'].includes(c.status)) { skippedStatus++; return; }
    if (c.businessId && suspendedBusinessIds.has(c.businessId)) { suspendedSkipped++; return; }

    const lastSent = ms(c.lastReminderSentAt);
    if (lastSent && lastSent >= debounceCutoffMs) { skippedDebounce++; return; }

    const recipient: string | null = c.assignedToUserId || c.createdByUserId || null;
    if (!recipient) { noRecipient++; return; }

    const name = String(c.name || c.company || (kind === 'lead' ? 'lead' : 'klient'));
    const { overdue, days } = dueInfo(dueMs);
    const title = overdue ? `⚠ Vonuar ${days} ditë: ${name}` : `🔔 Rikontaktim sot: ${name}`;
    const typeLabel = FOLLOW_UP_TYPE_LABEL[String(c.nextFollowUpType || 'other')] || FOLLOW_UP_TYPE_LABEL.other;
    const message = (typeof c.followUpNote === 'string' && c.followUpNote.trim()) ? c.followUpNote.trim() : typeLabel;

    ops.push(notifyUser({
      userId: recipient,
      type: kind === 'lead' ? 'lead_follow_up' : 'customer_follow_up',
      title,
      message,
      actionUrl: `/app/follow-ups?focus=${kind}:${doc.id}`,
      actionLabel: 'Hap ndjekjen',
      businessId: c.businessId ?? null,
      teamId: c.teamId ?? null,
      ...(kind === 'customer' ? { customerId: doc.id } : {}),
    }).then((r) => { if (r.written) { if (kind === 'lead') leadsNotified++; else customersNotified++; } }));

    // Debounce future runs (stamped even when delivery was gated by the user's
    // prefs — the reminder was DUE and handled today).
    ops.push(doc.ref.update({ lastReminderSentAt: admin.firestore.Timestamp.now() }));

    // Optional: send a WhatsApp follow-up template if the team enabled it (leads only).
    if (kind !== 'lead') return;
    const phone = c.phone || c.phoneNumber;
    if (phone && c.teamId) {
      const settings = await getTeamSettings(c.teamId);
      if (settings?.waFollowUpEnabled && settings?.waFollowUpTemplateId && settings?.metaEnabled) {
        const tpl = await getTemplate(settings.waFollowUpTemplateId);
        const channels: any[] = settings.metaChannels || [];
        const channel = channels.find((ch) => ch.phoneNumberId === settings.waFollowUpChannelPhoneNumberId) || channels[0];
        if (tpl && channel?.accessToken && channel?.phoneNumberId) {
          const params: string[] = (tpl.paramFields || []).map((f: string) =>
            f && f !== 'custom' && c[f] != null ? String(c[f]) : ''
          );
          ops.push(
            sendMetaBroadcastMessage(channel, normalizeWaPhone(phone), tpl, params, c.teamId, null, { id: doc.id, name: c.name })
              .catch((e) => console.error('[follow-up-wa]', e))
          );
          waSent++;
        }
      }
    }
  };

  for (const d of leadDocs) await process('lead', d);
  for (const d of customerDocs) await process('customer', d);

  await settleAll(ops, 'lead-follow-up-reminders');
  return {
    scanned: { leads: leadDocs.length, customers: customerDocs.length },
    leadsNotified, customersNotified, skippedDebounce, noRecipient, suspendedSkipped, skippedStatus, waSent,
    // Legacy key — older run logs / the Settings cron card read `notified`.
    notified: leadsNotified + customersNotified,
    businessId: scope,
  };
}

// ── JOB: lead-sla-stale-alerts ───────────────────────────────────────────────
// Flags leads that breached the first-response SLA (no outbound touch within
// SLA_HOURS) and leads that went stale (no activity for STALE_DAYS), notifying
// the owner (or team admins if unassigned). Debounced via per-lead flags.
async function runLeadSlaAndStaleAlerts() {
  const STALE_RENOTIFY_DAYS = 7;
  const now = Date.now();
  const ms = (v: any): number => (v?.toDate ? v.toDate().getTime() : (v ? new Date(v).getTime() : 0));

  // SLA hours / stale days are tenant settings (Cilësimet → Automatizime →
  // Ndjekja), validated by the same resolver the UI's leadIntel uses — one
  // definition of "breached" and "i ftohur" on both sides. Defaults 24h / 14d.
  const cfgCache = new Map<string, ReturnType<typeof resolveFollowUpConfig>>();
  const teamCfg = async (teamId?: string | null) => {
    const key = teamId || '';
    const cached = cfgCache.get(key);
    if (cached) return cached;
    let cfg = resolveFollowUpConfig(null);
    if (teamId) {
      try { cfg = resolveFollowUpConfig(await getTeamConfig(teamId)); } catch { /* defaults */ }
    }
    cfgCache.set(key, cfg);
    return cfg;
  };

  // SLA/stale alerts don't apply to Lost/Converted (skipped below) — scope the read.
  const leadsSnap = await db.collection('leads')
    .where('status', 'in', ['New', 'Contacted', 'Qualified', 'Proposal', 'Follow-up', 'Won'])
    .get();
  const adminsByTeam: Record<string, string[]> = {};
  const getTeamAdmins = async (teamId?: string, businessId?: string | null): Promise<string[]> => {
    if (!teamId) return [];
    if (adminsByTeam[teamId]) return adminsByTeam[teamId];
    const ids = await managerIdsForBusiness(businessId ?? null, teamId);
    adminsByTeam[teamId] = ids;
    return ids;
  };

  let slaBreaches = 0, staleLeads = 0;
  const ops: Promise<any>[] = [];

  for (const doc of leadsSnap.docs) {
    const lead = doc.data();
    if (lead.status === 'Lost' || lead.status === 'Converted') continue;

    const recipients = lead.assignedToUserId ? [lead.assignedToUserId] : await getTeamAdmins(lead.teamId, lead.businessId);
    if (recipients.length === 0) continue;
    const { followUpSlaHours: SLA_HOURS, followUpStaleDays: STALE_DAYS } = await teamCfg(lead.teamId);

    // First-response SLA breach — notify once.
    const createdMs = ms(lead.createdAt);
    const hoursSinceCreated = createdMs ? (now - createdMs) / 3_600_000 : 0;
    if (!lead.firstResponseAt && hoursSinceCreated > SLA_HOURS && !lead.slaBreachNotified) {
      const title = `⏰ SLA: lead pa përgjigje — ${lead.name}`;
      const message = `Lead-i "${lead.name}" nuk ka marrë përgjigje brenda ${SLA_HOURS}h nga krijimi.`;
      for (const uid of recipients) {
        ops.push(notifyUser({ userId: uid, type: 'lead_follow_up', title, message, actionUrl: '/app/crm', actionLabel: 'Shiko CRM', businessId: lead.businessId ?? null, teamId: lead.teamId ?? null }));
      }
      ops.push(doc.ref.update({ slaBreachNotified: true }));
      slaBreaches++;
    }

    // Staleness — re-notify at most every STALE_RENOTIFY_DAYS.
    const lastMs = Math.max(ms(lead.lastActivityAt), ms(lead.lastFollowUpDate), ms(lead.updatedAt));
    const staleDays = lastMs ? (now - lastMs) / 86_400_000 : Infinity;
    const sinceStaleNotif = ms(lead.staleNotifiedAt) ? (now - ms(lead.staleNotifiedAt)) / 86_400_000 : Infinity;
    if (staleDays > STALE_DAYS && sinceStaleNotif > STALE_RENOTIFY_DAYS) {
      const title = `💤 Lead i ftohur — ${lead.name}`;
      const message = `Lead-i "${lead.name}" s'ka aktivitet prej ${Math.floor(staleDays)} ditësh.`;
      for (const uid of recipients) {
        ops.push(notifyUser({ userId: uid, type: 'lead_follow_up', title, message, actionUrl: '/app/crm', actionLabel: 'Shiko CRM', businessId: lead.businessId ?? null, teamId: lead.teamId ?? null }));
      }
      ops.push(doc.ref.update({ staleNotifiedAt: admin.firestore.Timestamp.now() }));
      staleLeads++;
    }
  }

  await settleAll(ops, 'lead-sla-stale-alerts');
  return { slaBreaches, staleLeads };
}

// ── JOB: conversation-sla ────────────────────────────────────────────────────
// A WhatsApp thread the customer wrote to and nobody answered within the tenant's
// `waResponseSlaMinutes` (default 120). `api/_waInbound.ts` arms the deadline
// (`slaFirstResponseDueAt`, once per unanswered burst) and every staff reply
// disarms it (`awaitingReply: false`, via markConversationAnswered); this job
// only reads what is already due and notifies ONCE per breach
// (`slaBreachNotified`). Every 15 min from the VPS — NOT in run-all: "two hours
// without an answer" must mean two hours.
// Index: conversations (awaitingReply, slaBreachNotified, slaFirstResponseDueAt).
async function runConversationSla() {
  const now = admin.firestore.Timestamp.now();
  const snap = await db.collection('conversations')
    .where('awaitingReply', '==', true)
    .where('slaBreachNotified', '==', false)
    .where('slaFirstResponseDueAt', '<=', now)
    .limit(200)
    .get();

  // The Admin SDK bypasses tenantActive(): exclude suspended tenants ourselves.
  const suspendedBusinessIds = new Set<string>();
  try {
    const suspSnap = await db.collection('businesses').where('status', '==', 'suspended').get();
    suspSnap.docs.forEach(d => suspendedBusinessIds.add(d.id));
  } catch { /* fail-open on the read, per-conversation skip below still applies to what we know */ }

  const managersByBusiness = new Map<string, string[]>();
  const managersFor = async (businessId: string | null, teamId: string | null): Promise<string[]> => {
    const key = `${businessId || ''}|${teamId || ''}`;
    const cached = managersByBusiness.get(key);
    if (cached) return cached;
    const ids = await managerIdsForBusiness(businessId, teamId);
    managersByBusiness.set(key, ids);
    return ids;
  };
  const ms = (v: any): number => (v?.toMillis ? v.toMillis() : (v?.toDate ? v.toDate().getTime() : (v ? new Date(v).getTime() : 0)));

  let breached = 0, notified = 0, suspendedSkipped = 0, noRecipient = 0;
  const ops: Promise<any>[] = [];

  for (const doc of snap.docs) {
    const conv = doc.data() as any;
    const businessId: string | null = conv.businessId || null;
    const teamId: string | null = conv.teamId || null;
    if (businessId && suspendedBusinessIds.has(businessId)) { suspendedSkipped++; continue; }

    const recipients = conv.ownerId
      ? Array.from(new Set([conv.ownerId, conv.managerId].filter(Boolean) as string[]))
      : await managersFor(businessId, teamId);
    // Mark the breach even with nobody to tell, otherwise the row is re-read every 15 min forever.
    if (recipients.length === 0) noRecipient++;

    const waitedMin = Math.max(1, Math.round((now.toMillis() - (ms(conv.lastInboundAt) || ms(conv.slaFirstResponseDueAt))) / 60_000));
    const name = String(conv.subject || conv.phone || 'kontakt');
    const phone = String(conv.phone || '');
    const title = `⏰ Pa përgjigje: ${name}`;
    const message = `Mesazhi WhatsApp pret përgjigje prej ${waitedMin} min.${conv.lastInboundText ? ` „${String(conv.lastInboundText).slice(0, 100)}“` : ''}`;

    for (const uid of recipients) {
      ops.push(notifyUser({
        userId: uid,
        type: 'conversation_sla',
        title,
        message,
        actionUrl: `/app/whatsapp?phone=${encodeURIComponent(phone)}`,
        actionLabel: 'Hap bisedën',
        businessId,
        teamId,
        customerId: conv.customerId || null,
        conversationKey: doc.id,
      }).then((r) => { if (r.written) notified++; }));
    }
    ops.push(doc.ref.set({ slaBreachNotified: true, slaBreachedAt: now, updatedAt: now }, { merge: true }));
    breached++;
  }

  await settleAll(ops, 'conversation-sla');
  return { checked: snap.size, breached, notified, suspendedSkipped, noRecipient };
}

// ── JOB: lead-wa-auto-reminders ──────────────────────────────────────────────
// Sends an automatic WhatsApp template to "waiting" leads (configured statuses)
// that have had no communication for waAutoReminderDays (default 7). Requires the
// team to enable it + configure a template/channel (Settings → WhatsApp automation).
async function runLeadWhatsappAutoReminders() {
  const now = Date.now();
  const ms = (v: any): number => (v?.toDate ? v.toDate().getTime() : (v ? new Date(v).getTime() : 0));

  // Auto-reminders target only open leads (Won/Lost/Converted skipped below) — scope the read.
  const leadsSnap = await db.collection('leads')
    .where('status', 'in', ['New', 'Contacted', 'Qualified', 'Proposal', 'Follow-up'])
    .get();
  if (leadsSnap.empty) return { sent: 0 };

  const tsCache = new Map<string, any>();
  const tplCache = new Map<string, any>();
  const getTeamSettings = async (teamId: string) => {
    if (tsCache.has(teamId)) return tsCache.get(teamId);
    const data = await getTeamConfig(teamId);
    tsCache.set(teamId, data);
    return data;
  };
  const getTemplate = async (id: string) => {
    if (tplCache.has(id)) return tplCache.get(id);
    const doc = await db.collection('waTemplates').doc(id).get();
    const data = doc.exists ? doc.data() : null;
    tplCache.set(id, data);
    return data;
  };

  let sent = 0;
  const ops: Promise<any>[] = [];

  for (const leadDoc of leadsSnap.docs) {
    const lead = leadDoc.data();
    if (['Won', 'Lost', 'Converted'].includes(lead.status)) continue;
    const phone = lead.phone || lead.phoneNumber;
    if (!phone || !lead.teamId) continue;

    const settings = await getTeamSettings(lead.teamId);
    if (!settings?.waAutoReminderEnabled || !settings?.metaEnabled || !settings?.waAutoReminderTemplateId) continue;

    const statuses: string[] = settings.waAutoReminderStatuses?.length ? settings.waAutoReminderStatuses : ['Follow-up', 'Proposal'];
    if (!statuses.includes(lead.status)) continue;

    const days = Number(settings.waAutoReminderDays) || 7;
    const lastComm = Math.max(ms(lead.lastActivityAt), ms(lead.lastFollowUpDate)) || ms(lead.createdAt);
    const daysSince = lastComm ? (now - lastComm) / 86_400_000 : Infinity;
    if (daysSince < days) continue;

    // Debounce: re-send at most once per `days` window.
    const lastAuto = ms(lead.waAutoReminderAt);
    if (lastAuto && (now - lastAuto) / 86_400_000 < days) continue;

    const tpl = await getTemplate(settings.waAutoReminderTemplateId);
    const channels: any[] = settings.metaChannels || [];
    const channel = channels.find((c) => c.phoneNumberId === settings.waAutoReminderChannelPhoneNumberId) || channels[0];
    if (!tpl || !channel?.accessToken || !channel?.phoneNumberId) continue;

    const params: string[] = (tpl.paramFields || []).map((f: string) =>
      f && f !== 'custom' && lead[f] != null ? String(lead[f]) : ''
    );
    ops.push(
      sendMetaBroadcastMessage(channel, normalizeWaPhone(phone), tpl, params, lead.teamId, null, { id: leadDoc.id, name: lead.name })
        .catch((e) => console.error('[wa-auto-reminder]', e))
    );
    // `businessId` is what the leadActivities read rule keys on — a row without
    // it exists in the database and is invisible in every timeline.
    ops.push(db.collection('leadActivities').add({
      leadId: leadDoc.id, teamId: lead.teamId, businessId: lead.businessId ?? null, type: 'whatsapp',
      title: 'WhatsApp automatik (rikujtues)',
      body: `Rikujtues pas ${Math.floor(daysSince)} ditësh pa komunikim.`,
      userId: null, userName: 'Sistemi', createdAt: admin.firestore.Timestamp.now(),
    }));
    ops.push(leadDoc.ref.update({
      waAutoReminderAt: admin.firestore.Timestamp.now(),
      lastFollowUpDate: admin.firestore.Timestamp.now(),
      lastActivityAt: admin.firestore.Timestamp.now(),
    }));
    const assignee = lead.assignedToUserId || lead.createdByUserId;
    if (assignee) {
      ops.push(notifyUser({
        userId: assignee, type: 'lead_follow_up',
        title: `📲 Rikujtues WhatsApp u dërgua — ${lead.name}`,
        message: `Rikujtues automatik WhatsApp u dërgua te ${lead.name} (${Math.floor(daysSince)} ditë pa komunikim).`,
        actionUrl: '/app/crm', actionLabel: 'Shiko CRM',
        businessId: lead.businessId ?? null, teamId: lead.teamId ?? null,
        email: false,
      }));
    }
    sent++;
  }

  await settleAll(ops, 'lead-wa-auto-reminders');
  return { sent };
}

// ── JOB: daily-report-check ──────────────────────────────────────────────────
// The escalation ladder behind the mandatory 16:50 daily report.
//
// The browser can prompt and nag, but it cannot do anything for the person who
// simply closed the laptop — which is precisely the case a mandatory report exists
// to catch. So the deadline is enforced here:
//
//   stage=remind    (run ~17:35) → tell the PERSON their report is missing
//   stage=escalate  (run ~18:35) → tell every Admin/Manager who is still missing
//
// The stage is explicit rather than derived from the clock: this file has no idea
// what timezone a tenant works in, and inventing one would be worse than letting
// the scheduler — which runs in the office's own timezone — decide. See the runbook
// in workspace/DAILY_REPORTS_V2.md for the two crontab lines.
//
// Idempotent per tenant per day per stage via `dailyReportMisses/{businessId}_{date}`:
// re-running the job (or running it twice by accident) notifies nobody twice.
async function runDailyReportCheck(opts?: { stage?: 'remind' | 'escalate'; businessId?: string; date?: string }) {
  const stage = opts?.stage === 'escalate' ? 'escalate' : 'remind';
  const now = new Date();
  const date = opts?.date
    || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  // Weekends are not reporting days — mirrors `isReportingDay` on the client.
  const weekday = new Date(`${date}T12:00:00`).getDay();
  if (weekday === 0 || weekday === 6) {
    console.log(`[daily-report-check] ${date} is a weekend — skipped`);
    return { stage, date, skipped: 'weekend' as const, tenants: 0, notified: 0 };
  }

  const businessIds: string[] = [];
  if (opts?.businessId) {
    businessIds.push(opts.businessId);
  } else {
    const bizSnap = await db.collection('businesses').get();
    for (const b of bizSnap.docs) businessIds.push(b.id);
  }

  let tenants = 0;
  let notified = 0;
  let missingTotal = 0;

  for (const businessId of businessIds) {
    try {
      const stateRef = db.collection('dailyReportMisses').doc(`${businessId}_${date}`);
      const stateSnap = await stateRef.get();
      const state = stateSnap.exists ? (stateSnap.data() as any) : null;
      // The idempotency token is the STAGE stamp, not a timestamp comparison: a job
      // that fires twice in one evening must not double-notify anybody.
      if (state && ((stage === 'remind' && state.remindedAt) || (stage === 'escalate' && state.escalatedAt))) {
        continue;
      }

      // Both reads are tenant-scoped — the project's cost rule forbids an unfiltered
      // collection read inside a cron.
      const [membersSnap, reportsSnap] = await Promise.all([
        db.collection('teamMembers').where('businessId', '==', businessId).where('status', '==', 'Active').get(),
        db.collection('dailyReports').where('businessId', '==', businessId).where('date', '==', date).get(),
      ]);
      if (membersSnap.empty) continue;
      tenants++;

      const reported = new Set<string>();
      for (const d of reportsSnap.docs) {
        const uid = (d.data() as any).userId;
        if (uid) reported.add(uid);
      }

      const members = membersSnap.docs
        .map(d => ({ id: d.id, ...(d.data() as any) }))
        .filter(m => !!m.userId);

      const missing = members.filter(m => !reported.has(m.userId));
      missingTotal += missing.length;

      const patch: Record<string, unknown> = {
        businessId,
        date,
        missingUserIds: missing.map(m => m.userId),
        expectedCount: members.length,
        submittedCount: members.length - missing.length,
        updatedAt: admin.firestore.Timestamp.now(),
      };
      if (!stateSnap.exists) patch.createdAt = admin.firestore.Timestamp.now();

      if (stage === 'remind') {
        for (const m of missing) {
          await notifyUser({
            userId: m.userId,
            type: 'daily_report_due',
            title: '⏰ Raporti i sotëm mungon',
            message: 'Afati ishte 17:30. Plotësoje tani — merr më pak se një minutë.',
            actionUrl: '/app/reports?side=internal&tab=daily',
            actionLabel: 'Plotëso raportin',
            businessId,
            teamId: m.teamId ?? null,
          }).catch(err => console.error(`[daily-report-check] remind ${m.userId} failed:`, err));
          notified++;
        }
        patch.remindedAt = admin.firestore.Timestamp.now();
      } else {
        if (missing.length) {
          const managers = members.filter(m =>
            (m.role === 'Admin' || m.role === 'Manager') && !missing.some(x => x.userId === m.userId));
          const names = missing
            .map(m => m.displayName || (m.email ? String(m.email).split('@')[0] : 'Anëtar'))
            .slice(0, 8);
          const extra = missing.length - names.length;
          const list = names.join(', ') + (extra > 0 ? ` +${extra}` : '');

          for (const mgr of managers) {
            await notifyUser({
              userId: mgr.userId,
              type: 'daily_report_missing',
              title: `${missing.length} raporte ditore mungojnë`,
              message: `Nuk raportuan sot: ${list}.`,
              actionUrl: '/app/reports?side=internal&tab=daily',
              actionLabel: 'Shiko raportet',
              businessId,
              teamId: mgr.teamId ?? null,
            }).catch(err => console.error(`[daily-report-check] escalate ${mgr.userId} failed:`, err));
            notified++;
          }
          patch.escalatedToUserIds = managers.map(m => m.userId);
        }
        patch.escalatedAt = admin.firestore.Timestamp.now();
      }

      await stateRef.set(patch, { merge: true });
    } catch (err) {
      console.error(`[daily-report-check] tenant ${businessId} failed:`, err);
    }
  }

  console.log(`[daily-report-check] stage=${stage} date=${date} tenants=${tenants} missing=${missingTotal} notified=${notified}`);
  return { stage, date, tenants, missing: missingTotal, notified };
}

// ── JOB: notification-digest ─────────────────────────────────────────────────
// Emails a summary of what a user has NOT read yet.
//
// Three things were wrong with the original:
//   1. It read `notifications where isRead == false` with no tenant filter and no
//      limit — a full, cross-tenant collection scan every single day, which the
//      project's own cost rule forbids ("a cron job must never read a collection
//      unfiltered"). Since the cleanup job was broken, that scan only grew.
//   2. It ignored `emailEnabled`, Do-Not-Disturb and category mutes. A user who had
//      switched email notifications OFF still got a daily digest — and it listed
//      notifications from categories they had explicitly muted.
//   3. It counted notifications the user can never see in the bell (muted
//      categories), so the "you have 14 unread" figure did not match the UI.
//
// It is now scoped per tenant, capped, and passes every notification through the
// same silence gates as the live channels.
async function runNotificationDigest(opts?: { businessId?: string }) {
  const transporter = makeTransporter();
  const smtpUser = safeSenderAddress(process.env.SMTP_USER);
  if (!transporter || !smtpUser) return { sent: 0, skipped: 'no SMTP config' };

  const MIN_UNREAD = 3;              // below this it is noise, not a digest
  const PER_TENANT_CAP = 2_000;      // newest unread considered per tenant
  const LOOKBACK_DAYS = 30;          // older than this is stale, not "pending"
  const since = admin.firestore.Timestamp.fromDate(
    new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000),
  );

  // Tenant list: one business when asked for, otherwise every active business.
  const businessIds: string[] = [];
  if (opts?.businessId) {
    businessIds.push(opts.businessId);
  } else {
    const bizSnap = await db.collection('businesses').get();
    for (const b of bizSnap.docs) businessIds.push(b.id);
  }

  const byUser = new Map<string, { title: string; message?: string; type?: string }[]>();
  let scanned = 0;
  let unstamped = 0;

  for (const businessId of businessIds) {
    // Scoped + bounded + newest-first. Requires the composite index
    // (businessId, isRead, createdAt DESC) declared in firestore.indexes.json.
    const snap = await db.collection('notifications')
      .where('businessId', '==', businessId)
      .where('isRead', '==', false)
      .orderBy('createdAt', 'desc')
      .limit(PER_TENANT_CAP)
      .get();
    scanned += snap.size;
    if (snap.size === PER_TENANT_CAP) {
      console.warn(`[CRON:notification-digest] tenant ${businessId} hit the ${PER_TENANT_CAP} cap — older unread rows were not considered`);
    }
    for (const d of snap.docs) {
      const n = d.data();
      if (!n.userId) continue;
      const createdAt = n.createdAt?.toMillis ? n.createdAt.toMillis() : 0;
      if (createdAt && createdAt < since.toMillis()) continue;
      const list = byUser.get(n.userId) || [];
      list.push({ title: n.title, message: n.message, type: n.type });
      byUser.set(n.userId, list);
    }
  }

  // Notifications written before businessId was stamped are invisible to the scoped
  // query above. Surfaced rather than silently dropped — `backfill-tenant-keys` is
  // the repair path.
  if (!opts?.businessId) {
    // OLDEST unread first: unstamped rows are by definition the old ones, and
    // ascending order reuses the (isRead, createdAt ASC) index the retention sweep
    // already needs — a DESC probe would have required a second composite index.
    const legacy = await db.collection('notifications')
      .where('isRead', '==', false)
      .orderBy('createdAt', 'asc')
      .limit(1)
      .get();
    unstamped = legacy.empty ? 0 : (legacy.docs[0].data()?.businessId ? 0 : 1);
  }

  let sent = 0;
  let skippedPrefs = 0;
  const ops: Promise<any>[] = [];

  for (const [userId, all] of byUser) {
    const prefs = await getUserPrefs(userId);

    // Respect the email channel toggle. This was missing entirely: turning email
    // notifications off silenced every live email but not the daily digest.
    if (prefs?.emailEnabled === false) { skippedPrefs++; continue; }

    // Drop muted categories BEFORE the threshold check, so the count in the email
    // matches the count in the bell.
    const notifs = all.filter(n => !isTypeMutedByPrefs(n.type, prefs));
    if (notifs.length < MIN_UNREAD) continue;

    // Do-Not-Disturb: hold the digest rather than waking someone at 03:00.
    if (isDndActive(prefs)) { skippedPrefs++; continue; }

    // Already sent in the last 23h?
    if (prefs?.digestSentAt) {
      const last: Date = prefs.digestSentAt?.toDate ? prefs.digestSentAt.toDate() : new Date(prefs.digestSentAt);
      const dayAgo = new Date(Date.now() - 23 * 60 * 60 * 1000);
      if (last > dayAgo) continue;
    }

    try {
      const userRecord = await admin.auth().getUser(userId);
      if (!userRecord.email) continue;

      const criticalCount = notifs.filter(n => ['task_overdue', 'invoice_overdue', 'goal_overdue'].includes(n.type || '')).length;
      const listHtml = notifs.slice(0, 10).map(n =>
        `<li style="margin-bottom:6px"><strong>${escapeHtml(n.title || '')}</strong>${n.message ? `<br><span style="color:#6b7280;font-size:13px">${escapeHtml(n.message)}</span>` : ''}</li>`
      ).join('');
      const moreCount = notifs.length > 10 ? `<p style="color:#6b7280;font-size:13px">... dhe ${notifs.length - 10} njoftime të tjera</p>` : '';

      ops.push(transporter.sendMail({
        from: `"FivoCRM" <${smtpUser}>`,
        to: userRecord.email,
        subject: `📬 Digest i njoftimeve: ${notifs.length} të palexuara${criticalCount > 0 ? ` (${criticalCount} urgjente)` : ''}`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px">
            <h2 style="color:#12468C">📬 Njoftime të Palexuara</h2>
            <p>Keni <strong>${notifs.length}</strong> njoftime të palexuara${criticalCount > 0 ? `, nga të cilat <strong style="color:#ef4444">${criticalCount} janë urgjente</strong>` : ''}.</p>
            <ul style="padding-left:16px;line-height:1.6">${listHtml}</ul>
            ${moreCount}
            <a href="${BASE_URL}/app" style="display:inline-block;margin-top:16px;padding:10px 20px;background:#12468C;color:white;border-radius:6px;text-decoration:none">Hap FivoCRM</a>
            <p style="color:#9ca3af;font-size:12px;margin-top:24px">FivoCRM – Digest ditor automatik. Mund ta çaktivizoni te Cilësimet → Njoftimet.</p>
          </div>
        `,
      }).then(() => {
        return db.collection('userPreferences').doc(userId).set(
          { digestSentAt: admin.firestore.Timestamp.now() },
          { merge: true }
        );
      }));
      sent++;
    } catch { /* skip user */ }
  }

  await settleAll(ops, 'notification-digest');
  return { sent, scanned, tenants: businessIds.length, skippedPrefs, unstampedLegacyRows: unstamped };
}

// ── JOB: cleanup-old-notifications ───────────────────────────────────────────
// Two sweeps, both paged and time-budgeted:
//   1. READ notifications older than 60 days — the normal retention rule.
//   2. ANY notification older than 365 days — an unread one is not a reason to keep
//      a document forever; without this the collection only ever grows, which is
//      what made the digest job's full scan progressively more expensive.
//
// `where(isRead) + where(createdAt <)` is an equality + range on DIFFERENT fields,
// so it REQUIRES the composite index (isRead ASC, createdAt ASC) — it is declared in
// firestore.indexes.json and must be deployed before this job can run at all.
// Without it the whole job failed with FAILED_PRECONDITION and nothing was ever
// purged. Pages are `limit()`-ed so a large backlog is drained over several runs
// instead of blowing the 60s function budget on one unbounded `.get()`.
async function runCleanupOldNotifications() {
  const PAGE = 400;
  const MAX_DELETES = 20_000;   // hard ceiling per invocation
  const BUDGET_MS = 45_000;     // leave headroom inside the 60s maxDuration
  const started = Date.now();

  const readCutoff = admin.firestore.Timestamp.fromDate(
    new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
  );
  const hardCutoff = admin.firestore.Timestamp.fromDate(
    new Date(Date.now() - 365 * 24 * 60 * 60 * 1000),
  );

  let deletedRead = 0;
  let deletedStale = 0;
  let truncated = false;

  const drain = async (
    build: () => FirebaseFirestore.Query,
    onDeleted: (n: number) => void,
  ) => {
    for (;;) {
      if (Date.now() - started > BUDGET_MS || deletedRead + deletedStale >= MAX_DELETES) {
        truncated = true;
        return;
      }
      const snap = await build().limit(PAGE).get();
      if (snap.empty) return;
      const batch = db.batch();
      for (const d of snap.docs) batch.delete(d.ref);
      await batch.commit();
      onDeleted(snap.size);
      if (snap.size < PAGE) return;
    }
  };

  // 1. Read + older than 60 days.
  await drain(
    () => db.collection('notifications')
      .where('isRead', '==', true)
      .where('createdAt', '<', readCutoff)
      .orderBy('createdAt', 'asc'),
    (n) => { deletedRead += n; },
  );

  // 2. Anything older than a year, read or not (single range → no composite index).
  await drain(
    () => db.collection('notifications')
      .where('createdAt', '<', hardCutoff)
      .orderBy('createdAt', 'asc'),
    (n) => { deletedStale += n; },
  );

  const deleted = deletedRead + deletedStale;
  console.log(`[CRON:cleanup-old-notifications] fshirë ${deleted} njoftime (${deletedRead} të lexuara >60d, ${deletedStale} >365d)${truncated ? ' — TRUNCATED, do të vazhdojë në run-in tjetër' : ''}`);
  return { deleted, deletedRead, deletedStale, truncated };
}

// ── WhatsApp automation rules engine ─────────────────────────────────────────
// MIRROR of src/lib/marketing/waAutomation.ts — the browser previews the segment
// with that module, the cron sends with this one. They must agree, or the count
// the user approved is not the count that goes out. Keep the two in sync (the
// module carries the tests and the full reasoning).
const WA_MS_PER_DAY = 86_400_000;

function waContactTags(e: any): string[] {
  const t = e?.tags;
  if (Array.isArray(t)) return t.map((x: any) => String(x).trim()).filter(Boolean);
  if (typeof t === 'string') return t.split(',').map((s: string) => s.trim()).filter(Boolean);
  return [];
}

/** Business category, with the aliases imported rows have written historically. */
function waContactCategory(e: any): string {
  const raw = e?.businessCategory ?? e?.category ?? e?.industry;
  return String(raw ?? '').trim();
}

/** Case-insensitive membership — categories are free text typed by the user. */
function waCategoryMatches(cat: string, want: string[]): boolean {
  if (!cat) return false;
  const c = cat.toLowerCase();
  return want.some((w) => String(w || '').trim().toLowerCase() === c);
}

function waToDate(v: any): Date | null {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  if (typeof v?.toDate === 'function') {
    const d = v.toDate();
    return d instanceof Date && !isNaN(d.getTime()) ? d : null;
  }
  if (typeof v === 'number' || typeof v === 'string') {
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/** Newest touch across every signal. `createdAt` is deliberately NOT a contact. */
function waResolveLastContactAt(e: any, lastMessageAt?: Date | null): Date | null {
  const c = [waToDate(lastMessageAt), waToDate(e?.lastActivityAt), waToDate(e?.lastFollowUpDate), waToDate(e?.firstResponseAt)]
    .filter((d): d is Date => !!d);
  return c.length ? c.reduce((a, b) => (b.getTime() > a.getTime() ? b : a)) : null;
}

function waDaysSince(d: Date | null, now: Date): number | null {
  return d ? Math.floor((now.getTime() - d.getTime()) / WA_MS_PER_DAY) : null;
}

/** Most specific matching variant wins; a tagless variant is the fallback. */
function waPickVariant(e: any, variants: any[] | undefined): any | null {
  const list = (variants || []).filter((v) => v && String(v.body || '').trim());
  if (!list.length) return null;
  const tags = waContactTags(e);
  let best: any = null;
  let bestScore = -1;
  for (const v of list) {
    const want: string[] = (v.tags || []).filter(Boolean);
    if (!want.length) { if (bestScore < 0) { best = v; bestScore = 0; } continue; }
    const hits = want.filter((t) => tags.includes(t)).length;
    if (hits > 0 && hits > bestScore) { best = v; bestScore = hits; }
  }
  return best;
}

function waVariantServiceLabel(e: any, v: any | null): string {
  if (!v) return '';
  const tags = waContactTags(e);
  return (v.tags || []).find((t: string) => tags.includes(t)) || v.label || '';
}

function waWithUtm(url: string | undefined, utm?: any): string {
  const raw = String(url || '').trim();
  if (!raw || !/^https?:\/\//i.test(raw)) return raw;
  try {
    const u = new URL(raw);
    const map: Record<string, string | undefined> = {
      utm_source: utm?.source, utm_medium: utm?.medium,
      utm_campaign: utm?.campaign, utm_content: utm?.content,
    };
    for (const [k, v] of Object.entries(map)) if (v && !u.searchParams.has(k)) u.searchParams.set(k, v);
    return u.toString();
  } catch { return raw; }
}

function waFirstName(name?: string): string {
  return String(name || '').trim().split(/\s+/)[0] || '';
}

/** First meaningful line of the notes, de-noised and capped — a quotable clause. */
function waSummarizeNotes(notes?: string, maxLen = 160): string {
  const first = String(notes || '')
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-•*]|\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?\s*[:-]?)\s*/, '').trim())
    .find((l) => l.length > 0);
  if (!first) return '';
  if (first.length <= maxLen) return first;
  const cut = first.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > maxLen * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[,;:.\s]+$/, '')}…`;
}

/** Named-token renderer. Unknown tokens render EMPTY — never leak `{{foo}}`. */
function waRenderMessage(body: string, e: any, ctx: { link?: string; service?: string } = {}): string {
  const vars: Record<string, string> = {
    name: waFirstName(e?.name),
    fullname: String(e?.name || '').trim(),
    company: String(e?.company || '').trim(),
    notes: waSummarizeNotes(e?.notes),
    link: ctx.link || '',
    service: ctx.service || '',
  };
  const hadLinkToken = /\{\{\s*link\s*\}\}/i.test(body || '');
  let out = String(body || '').replace(/\{\{\s*([a-zA-Z_][\w.]*)\s*\}\}/g, (_m, key: string) => {
    const v = vars[String(key).toLowerCase()];
    return v == null ? '' : v;
  });
  out = out.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  if (!hadLinkToken && ctx.link) out = `${out}\n\n${ctx.link}`;
  return out;
}

/** The ONE gate: null = send, otherwise the named reason. Cheapest checks first. */
function waBlockReason(
  e: any,
  segment: any,
  conditions: any,
  ctx: {
    now: Date;
    kind: 'lead' | 'customer';
    lastMessageByPhone?: Map<string, Date>;
    sentPhones?: Set<string>;
    domainCustomerIds?: Set<string> | null;
    /** contactId → category, for contacts whose own doc carries none (customers). */
    categoryByContactId?: Map<string, string>;
  },
  variants?: any[],
): string | null {
  const phone = normalizeWaPhone(e?.phone || e?.phoneNumber);
  if (phone.length < 7) return 'no-phone';

  if (ctx.kind === 'lead' && segment?.statuses?.length && !segment.statuses.includes(String(e.status || ''))) {
    return 'status-mismatch';
  }
  const wantTags: string[] = segment?.tags?.length ? segment.tags : (segment?.tag ? [segment.tag] : []);
  if (wantTags.length) {
    const has = waContactTags(e);
    const ok = segment.tagMatch === 'all' ? wantTags.every((t) => has.includes(t)) : wantTags.some((t) => has.includes(t));
    if (!ok) return 'tag-mismatch';
  }
  const wantCategories: string[] = (segment?.categories || []).filter(Boolean);
  if (wantCategories.length) {
    const cat = waContactCategory(e) || ctx.categoryByContactId?.get(String(e.id)) || '';
    if (!waCategoryMatches(cat, wantCategories)) return 'category-mismatch';
  }
  if (segment?.assignedToUserId && e.assignedToUserId !== segment.assignedToUserId) return 'assignee-mismatch';
  if (segment?.source && String(e.source || '') !== segment.source) return 'source-mismatch';
  if (segment?.hasDomain) {
    if (ctx.kind === 'lead') return 'domain-mismatch';
    if (ctx.domainCustomerIds && !ctx.domainCustomerIds.has(String(e.id))) return 'domain-mismatch';
  }
  if (ctx.sentPhones?.has(phone)) return 'already-sent';

  if (conditions?.requireNotes && !waSummarizeNotes(e.notes)) return 'no-notes';

  const hasDormancyRule =
    conditions?.lastContactMinDays != null || conditions?.lastContactMaxDays != null || !!conditions?.requireContacted;
  if (hasDormancyRule) {
    const age = waDaysSince(waResolveLastContactAt(e, ctx.lastMessageByPhone?.get(phone) || null), ctx.now);
    if (age == null) {
      // Never contacted = maximally dormant, so a min-days rule passes. An
      // explicit requireContacted, or a window CEILING (a statement about a real
      // past contact), excludes them.
      if (conditions.requireContacted) return 'never-contacted';
      if (conditions.lastContactMaxDays != null) return 'never-contacted';
    } else {
      if (conditions.lastContactMinDays != null && age < conditions.lastContactMinDays) return 'contacted-too-recently';
      if (conditions.lastContactMaxDays != null && age > conditions.lastContactMaxDays) return 'contact-too-old';
    }
  }

  if (variants?.length && !waPickVariant(e, variants)) return 'no-variant';
  return null;
}

/**
 * Phones contacted since `since`, newest date per phone.
 *
 * This is the inverse of the dormancy question, and it's why the condition is
 * cheap: we do NOT read every message ever sent, only the ones inside the
 * window — anyone absent from the result has not been contacted in it. Uses the
 * existing (teamId, createdAt DESC) index.
 */
async function recentWaContactsByPhone(teamId: string, since: Date): Promise<Map<string, Date>> {
  const MAX = 5000;
  const map = new Map<string, Date>();
  if (!teamId) return map;
  const snap = await db.collection('whatsappMessages')
    .where('teamId', '==', teamId)
    .where('createdAt', '>=', admin.firestore.Timestamp.fromDate(since))
    .orderBy('createdAt', 'desc')
    .limit(MAX)
    .get();
  for (const d of snap.docs) {
    const m = d.data() as any;
    const phone = normalizeWaPhone(m.phone);
    if (!phone) continue;
    const at = waToDate(m.createdAt);
    if (!at) continue;
    const prev = map.get(phone);
    if (!prev || at.getTime() > prev.getTime()) map.set(phone, at);
  }
  if (snap.size >= MAX) {
    // Truncated → some recent contacts are missing from the exclusion set, so a
    // few people could be messaged sooner than the rule intends. Loud, not silent.
    console.warn(`[cron:wa] recent-contact lookup TRUNCATED at ${MAX} for team ${teamId} — dormancy may under-exclude`);
  }
  return map;
}

// ── JOB: whatsapp-broadcasts ─────────────────────────────────────────────────
// Template-only bulk sends via Meta Cloud API.  Idempotent & resumable: each
// send is logged to whatsappMessages tagged with broadcastId; already-sent
// phones are skipped, so re-runs continue where they left off.  Processes up to
// PER_RUN targets per broadcast per invocation (function-timeout safety).
function normalizeWaPhone(p: string): string {
  return (p || '').replace(/\D/g, '');
}

async function sendMetaBroadcastMessage(
  channel: any,
  phone: string,
  tpl: any,
  params: string[],
  teamId: string,
  broadcastId: string | null,
  lead: { id: string; name?: string }
): Promise<void> {
  const components = params.length
    ? [{ type: 'body', parameters: params.map((p) => ({ type: 'text', text: p && p.trim() ? p : '-' })) }]
    : [];
  const payload = {
    messaging_product: 'whatsapp',
    to: phone,
    type: 'template',
    template: {
      name: tpl.metaTemplateName,
      language: { code: tpl.language || 'sq' },
      ...(components.length ? { components } : {}),
    },
  };
  const resp = await fetch(`https://graph.facebook.com/v21.0/${channel.phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${channel.accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data: any = await resp.json().catch(() => ({}));
  const waMessageId = data?.messages?.[0]?.id || null;
  const ok = resp.ok && !!waMessageId;
  // Render a display body by filling {{n}} placeholders for the inbox.
  const display = (tpl.body || tpl.metaTemplateName || '').replace(/\{\{(\d+)\}\}/g, (_m: string, n: string) => params[Number(n) - 1] || `{{${n}}}`);
  await db.collection('whatsappMessages').add({
    phone,
    jid: `${phone}@s.whatsapp.net`,
    direction: 'outbound',
    message: display,
    leadId: lead.id,
    leadName: lead.name || null,
    teamId,
    status: ok ? 'sent' : 'failed',
    channel: 'meta',
    channelPhone: channel.phone || null,
    metaPhoneNumberId: channel.phoneNumberId,
    isTemplate: true,
    templateName: tpl.metaTemplateName,
    ...(broadcastId ? { broadcastId } : {}),
    waMessageId,
    createdAt: admin.firestore.Timestamp.now(),
    updatedAt: admin.firestore.Timestamp.now(),
  });
  if (!ok) {
    throw new Error(`Meta send failed for ${phone}: ${data?.error?.message || resp.status}`);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Render a template body's {{n}} placeholders with the given params (free text,
// used for Baileys which has no template concept).
function renderTemplateBody(body: string, params: string[]): string {
  return (body || '').replace(/\{\{(\d+)\}\}/g, (_m, n: string) => params[Number(n) - 1] || '');
}

// Send one Baileys broadcast message via the team's VPS /send endpoint.  The
// VPS writes its own whatsappMessages doc (channel:'baileys'), so we don't.
// Returns true on success. The transport lives in api/_waSend.ts (shared with
// the inbound handler's auto-reply); a campaign is deliberately NOT an
// `isAutoReply` and never calls markConversationAnswered — it is not an answer.
async function sendBaileysBroadcastMessage(
  vpsUrl: string,
  vpsSecret: string,
  agentId: string,
  phone: string,
  message: string,
  teamId: string,
  lead: { id: string; name?: string }
): Promise<boolean> {
  const r = await sendBaileysText(vpsUrl, vpsSecret, agentId, phone, message, { teamId, leadId: lead.id, leadName: lead.name || null });
  if (!r.ok) console.error('[broadcast-baileys] send failed', r.error);
  return r.ok;
}

/**
 * Positional params for a Meta template.
 *
 * Meta only delivers APPROVED templates outside the 24h window, so variant free
 * text can't be sent there. What we can do is feed the same personalization
 * through the template's own placeholders: alongside real contact fields,
 * `paramFields` now understands the pseudo-fields `firstName`, `notes` (the
 * summarized clause), `service` and `link` (the UTM-tagged landing page). So an
 * approved "Përshëndetje {{1}}, për {{2}} shiko {{3}}" carries the whole idea.
 */
function waTemplateParams(tpl: any, t: any, ctx: { link?: string; service?: string }): string[] {
  return (tpl.paramFields || []).map((f: string) => {
    switch (f) {
      case 'firstName': return waFirstName(t.name);
      case 'notes': return waSummarizeNotes(t.notes);
      case 'service': return ctx.service || '';
      case 'link': return ctx.link || '';
      case 'custom': case '': case undefined: return '';
      default: return t[f] != null ? String(t[f]) : '';
    }
  });
}

/**
 * Resolve a campaign's segment to the messages that would go out, and account
 * for everyone excluded. Shared by the one-shot job and the evergreen one — the
 * only difference between them is what happens to the doc afterwards.
 */
async function resolveWaCampaignTargets(
  b: any,
  now: Date,
  opts: { skipSentPhones: boolean },
): Promise<{
  targets: Array<{ contact: any; phone: string; message: string; link: string; service: string; kind: 'lead' | 'customer' }>;
  blocked: Record<string, number>;
  considered: number;
}> {
  const seg = b.segment || {};
  const conditions = b.conditions || {};
  const variants: any[] = Array.isArray(b.variants) ? b.variants : [];
  const audience: string[] = seg.audience?.length ? seg.audience : ['leads'];
  const audienceScope = { businessId: b.businessId || null, teamId: b.teamId || null };

  const domainCustomerIds: Set<string> | null = seg.hasDomain
    ? new Set((await tenantScopedDocs('domains', audienceScope)).map((d) => d.data.customerId).filter(Boolean).map(String))
    : null;

  // Only pay for the recent-contact lookup when a dormancy rule needs it, and
  // only over the window it asks about.
  const windowDays = Math.max(
    Number(conditions.lastContactMinDays) || 0,
    conditions.requireContacted ? 1 : 0,
  );
  const lastMessageByPhone = windowDays > 0
    ? await recentWaContactsByPhone(b.teamId, new Date(now.getTime() - windowDays * WA_MS_PER_DAY))
    : undefined;

  const sentPhones = opts.skipSentPhones
    ? new Set<string>((b.sentPhones || []).map((p: string) => normalizeWaPhone(p)))
    : undefined;

  const blocked: Record<string, number> = {};
  const bump = (r: string) => { blocked[r] = (blocked[r] || 0) + 1; };
  const byPhone = new Map<string, {
    contact: any; phone: string; message: string; link: string; service: string; kind: 'lead' | 'customer';
  }>();
  let considered = 0;

  // A link depends only on the variant — build each one once, not per contact.
  const linkCache = new Map<string, string>();
  const linkFor = (raw: string | undefined) => {
    const key = raw || '';
    let v = linkCache.get(key);
    if (v === undefined) { v = waWithUtm(key, b.utm); linkCache.set(key, v); }
    return v;
  };

  // The audience is materialised BEFORE the loop because the category filter is
  // cross-record: the category lives on the LEAD, and a customer is filtered by
  // the category of the lead it was converted from. Leads are therefore loaded
  // for a customers-only audience too — but only when that filter is actually on.
  const wantCategories: string[] = (seg.categories || []).filter(Boolean);
  const needLeadDocs = audience.includes('leads') || (wantCategories.length > 0 && audience.includes('customers'));
  const leadDocs = needLeadDocs ? await tenantScopedDocs('leads', audienceScope) : [];
  const customerDocs = audience.includes('customers')
    ? await tenantScopedDocs('customers', audienceScope)
    : [];

  // contactId → category (mirror of buildCategoryIndex in src/lib/marketing/waAutomation.ts)
  let categoryByContactId: Map<string, string> | undefined;
  if (wantCategories.length) {
    categoryByContactId = new Map<string, string>();
    for (const { id, data } of leadDocs) {
      const cat = waContactCategory(data);
      if (!cat) continue;
      categoryByContactId.set(String(id), cat);
      if ((data as any).customerId) categoryByContactId.set(String((data as any).customerId), cat);
    }
    for (const { id, data } of customerDocs) {
      if (waContactCategory(data)) { categoryByContactId.set(String(id), waContactCategory(data)); continue; }
      const leadId = (data as any).leadId;
      const fromLead = leadId ? categoryByContactId.get(String(leadId)) : undefined;
      if (fromLead) categoryByContactId.set(String(id), fromLead);
    }
  }

  const consider = (raw: any, id: string, kind: 'lead' | 'customer') => {
    considered++;
    const e = { ...raw, id };
    const reason = waBlockReason(e, seg, conditions, { now, kind, lastMessageByPhone, sentPhones, domainCustomerIds, categoryByContactId }, variants);
    if (reason) { bump(reason); return; }
    const phone = normalizeWaPhone(e.phone || e.phoneNumber);
    if (byPhone.has(phone)) return;   // same person as lead AND customer → one chat
    const variant = waPickVariant(e, variants);
    const service = waVariantServiceLabel(e, variant);
    const link = linkFor(variant?.landingUrl || b.landingUrl);
    const body = variant?.body || '';
    byPhone.set(phone, {
      contact: e, phone, link, service, kind,
      message: body ? waRenderMessage(body, e, { link, service }) : '',
    });
  };

  if (audience.includes('leads')) {
    for (const { id, data } of leadDocs) consider(data, id, 'lead');
  }
  if (audience.includes('customers')) {
    for (const { id, data } of customerDocs) consider(data, id, 'customer');
  }

  return { targets: Array.from(byPhone.values()), blocked, considered };
}

const PER_RUN_META = 200;     // Meta: high throughput, parallel, safe
const PER_RUN_BAILEYS = 8;    // Baileys: tiny batch + paced to limit ban risk

/**
 * Record the touch on the LEAD after a campaign message lands.
 *
 * Two reasons, and the second one is a bug fix:
 *
 *  1. The CRM timeline should show that we reached out — a message the user can't
 *     see in the lead's history looks like it never happened.
 *  2. `lead-wa-auto-reminders` (the team-wide stale-lead reminder) decides from
 *     `lastActivityAt`/`lastFollowUpDate` ALONE — it never looks at
 *     `whatsappMessages`. Without this stamp, a campaign could message a lead and
 *     that job would message them AGAIN days later, both believing the lead had
 *     gone quiet. Stamping the same fields it reads (plus its own
 *     `waAutoReminderAt` debounce) makes the two suppress each other.
 *
 * Never allowed to fail the send — the message is already delivered by now.
 */
async function stampWaCampaignTouch(
  targets: Array<{ contact: any; kind: 'lead' | 'customer' }>,
  sentPhones: Set<string>,
  campaignName: string,
  teamId: string,
): Promise<void> {
  const now = admin.firestore.Timestamp.now();
  const ops: Promise<any>[] = [];
  // The timeline row must carry `businessId` (the leadActivities read rule keys
  // on it). Prefer the lead's own; fall back to the team's, read once per call.
  let teamBusinessId: string | null | undefined;
  const businessIdFor = async (contact: any): Promise<string | null> => {
    if (contact?.businessId) return String(contact.businessId);
    if (teamBusinessId === undefined) {
      try {
        const t = await db.collection('teams').doc(teamId).get();
        teamBusinessId = t.exists ? ((t.data() as any)?.businessId ?? null) : null;
      } catch { teamBusinessId = null; }
    }
    return teamBusinessId ?? null;
  };
  for (const t of targets) {
    if (t.kind !== 'lead' || !sentPhones.has(normalizeWaPhone(t.contact.phone || t.contact.phoneNumber))) continue;
    const businessId = await businessIdFor(t.contact);
    ops.push(db.collection('leads').doc(t.contact.id).update({
      lastActivityAt: now,
      lastFollowUpDate: now,
      waAutoReminderAt: now,   // shares the older job's debounce
      updatedAt: now,
    }).catch(() => {}));
    ops.push(db.collection('leadActivities').add({
      leadId: t.contact.id,
      teamId,
      businessId,
      type: 'whatsapp',
      title: 'WhatsApp automatik (fushatë)',
      body: `Fushata “${campaignName}”.`,
      userId: null,
      userName: 'Sistemi',
      createdAt: now,
    }).catch(() => {}));
  }
  await Promise.allSettled(ops);
}

/**
 * Send one campaign's next batch. Returns what happened; the CALLER decides what
 * that means for the doc (a one-shot completes, an evergreen rule never does).
 * Throws on a misconfiguration the caller should record as `failed`.
 */
async function sendWaCampaignBatch(
  bDoc: admin.firestore.QueryDocumentSnapshot,
  b: any,
  now: Date,
  opts: { skipSentPhones: boolean },
): Promise<{ total: number; succeeded: string[]; blocked: Record<string, number>; considered: number }> {
  const tplDoc = b.templateId ? await db.collection('waTemplates').doc(b.templateId).get() : null;
  const tpl = tplDoc?.exists ? (tplDoc.data() as any) : null;
  const variants: any[] = Array.isArray(b.variants) ? b.variants : [];
  const useBaileys = b.channel === 'baileys';

  // Text has to come from SOMEWHERE: a variant (Baileys) or a template (both).
  if (!tpl && !variants.some((v) => String(v?.body || '').trim())) {
    throw new Error('Template mungon');
  }
  if (!useBaileys && !tpl) {
    // Meta can only deliver approved templates — free-text variants are Baileys-only.
    throw new Error('Kanali Meta kërkon një template të aprovuar (variantet me tekst të lirë punojnë vetëm me Baileys)');
  }

  const settings = await getTeamConfig(b.teamId);
  let metaChannel: any = null;
  let vpsUrl = '';
  let vpsSecret = '';
  if (useBaileys) {
    vpsUrl = settings.whatsappVpsUrl || '';
    vpsSecret = settings.whatsappVpsSecret || '';
    if (!vpsUrl || !vpsSecret || !b.agentId) throw new Error('Konfigurimi i Baileys/VPS mungon');
  } else {
    const channels: any[] = settings.metaChannels || [];
    metaChannel = channels.find((c) => c.phoneNumberId === b.channelPhoneNumberId) || channels[0];
    if (!metaChannel?.accessToken || !metaChannel?.phoneNumberId) throw new Error('Kanali Meta mungon');
  }

  const { targets, blocked, considered } = await resolveWaCampaignTargets(b, now, opts);
  const total = targets.length;

  const cap = Number(b.conditions?.dailyCap) || 0;
  const perRun = Math.min(useBaileys ? PER_RUN_BAILEYS : PER_RUN_META, cap > 0 ? cap : Number.MAX_SAFE_INTEGER);
  const batch = targets.slice(0, perRun);
  const succeeded: string[] = [];

  if (useBaileys) {
    // Sequential + randomized pacing to look human and respect the VPS
    // 30/min per-agent limit (reduces — does not eliminate — ban risk).
    for (const t of batch) {
      // A variant's rendered body wins; otherwise the legacy positional template.
      const message = t.message
        || renderTemplateBody(tpl?.body || '', waTemplateParams(tpl || {}, t.contact, t));
      if (!message.trim()) { blocked['no-variant'] = (blocked['no-variant'] || 0) + 1; continue; }
      const ok = await sendBaileysBroadcastMessage(
        vpsUrl, vpsSecret, b.agentId, t.phone, message, b.teamId,
        { id: t.contact.id, name: t.contact.name },
      );
      if (ok) succeeded.push(t.phone);
      await sleep(1500 + Math.floor(Math.random() * 2500)); // 1.5–4s between sends
    }
  } else {
    const results = await Promise.allSettled(
      batch.map((t) => sendMetaBroadcastMessage(
        metaChannel, t.phone, tpl, waTemplateParams(tpl, t.contact, t), b.teamId, bDoc.id,
        { id: t.contact.id, name: t.contact.name },
      ).then(() => t.phone)),
    );
    for (const r of results) if (r.status === 'fulfilled') succeeded.push(r.value);
  }

  if (succeeded.length) {
    await stampWaCampaignTouch(batch, new Set(succeeded), b.name || 'pa emër', b.teamId);
  }

  return { total, succeeded, blocked, considered };
}

async function runWhatsappBroadcasts() {
  const now = new Date();
  const snap = await db.collection('waBroadcasts')
    .where('status', 'in', ['queued', 'sending'])
    .get();

  let processed = 0;
  let sent = 0;

  for (const bDoc of snap.docs) {
    const b = bDoc.data() as any;
    // Evergreen rules are driven by `whatsapp-automations`, not here.
    if (b.trigger === 'dormant') continue;
    try {
      // Respect scheduling.
      if (b.scheduledAt?.toDate && b.scheduledAt.toDate() > now) continue;

      // One-shot: `sentPhones` is the permanent exclusion list, so a re-run
      // resumes where it stopped instead of messaging anyone twice.
      const alreadySent = new Set<string>((b.sentPhones || []).map((p: string) => normalizeWaPhone(p)));
      const { total, succeeded, blocked } = await sendWaCampaignBatch(bDoc, b, now, { skipSentPhones: true });
      sent += succeeded.length;

      const newSentTotal = alreadySent.size + succeeded.length;
      const remaining = total - succeeded.length;
      await bDoc.ref.update({
        totalTargets: alreadySent.size + total,
        sentCount: newSentTotal,
        // arrayUnion requires ≥1 element — only include when something succeeded.
        ...(succeeded.length ? { sentPhones: admin.firestore.FieldValue.arrayUnion(...succeeded) } : {}),
        status: remaining > 0 ? 'sending' : 'completed',
        lastRunBlocked: blocked,
        lastRunAt: now,
        error: null,
        updatedAt: new Date(),
      });
      processed++;
    } catch (err: any) {
      console.error(`[CRON:whatsapp-broadcasts] broadcast ${bDoc.id} dështoi:`, err);
      await bDoc.ref.update({ status: 'failed', error: err?.message || 'Gabim', updatedAt: new Date() }).catch(() => {});
    }
  }

  return { processed, sent };
}

// ── JOB: whatsapp-automations ────────────────────────────────────────────────
// EVERGREEN WhatsApp rules (`trigger: 'dormant'`, `status: 'active'`): every run
// they re-resolve their segment and message whoever has gone quiet long enough —
// "leads tagged SEO we haven't touched in 30 days get the SEO re-engagement text
// plus its landing page".
//
// Unlike the one-shot job this NEVER completes and never accumulates
// `sentPhones`. The dormancy condition is the cooldown: sending resets the
// contact's last-contact date, so they drop out of the segment for the length of
// the window and re-enter only if they go quiet again. A permanent sent-list
// would turn a recurring rule into a once-per-contact-ever blast.
//
// Mirrors the email module's `purchase-campaigns` in spirit. NOT part of run-all
// on purpose — an evergreen sender should be scheduled deliberately, once a day.
async function runWhatsappAutomations() {
  const now = new Date();
  const snap = await db.collection('waBroadcasts').where('trigger', '==', 'dormant').get();
  const rules = snap.docs.filter((d) => (d.data() as any).status === 'active');
  if (!rules.length) return { rules: 0, processed: 0, sent: 0 };

  let processed = 0;
  let sent = 0;

  for (const bDoc of rules) {
    const b = bDoc.data() as any;
    try {
      if (b.scheduledAt?.toDate && b.scheduledAt.toDate() > now) continue;
      // A rule with no dormancy threshold would message the whole segment on
      // every run. Refuse rather than spam.
      if (b.conditions?.lastContactMinDays == null) {
        await bDoc.ref.update({
          status: 'paused',
          error: 'Automatizimi kërkon kushtin “Të pakontaktuar prej X ditësh”.',
          updatedAt: now,
        });
        continue;
      }

      const { total, succeeded, blocked, considered } = await sendWaCampaignBatch(bDoc, b, now, { skipSentPhones: false });
      sent += succeeded.length;
      await bDoc.ref.update({
        totalTargets: total,
        sentCount: admin.firestore.FieldValue.increment(succeeded.length),
        lastRunAt: now,
        lastRunBlocked: blocked,
        error: null,
        updatedAt: now,
      });
      console.log(`[CRON:whatsapp-automations] ${b.name}: ${succeeded.length} dërguar, ${total} të pranueshëm nga ${considered} kontakte`);
      processed++;
    } catch (err: any) {
      // A broken evergreen rule is PAUSED, not left retrying every run — it
      // would otherwise log the same failure forever with nobody looking.
      console.error(`[CRON:whatsapp-automations] rule ${bDoc.id} dështoi:`, err);
      await bDoc.ref.update({ status: 'paused', error: err?.message || 'Gabim', updatedAt: now }).catch(() => {});
    }
  }

  return { rules: rules.length, processed, sent };
}

// ── JOB: email-campaigns ─────────────────────────────────────────────────────
// Bulk email marketing sends via the ESP (Resend) or SMTP fallback. Mirrors the
// WhatsApp broadcast model: idempotent & resumable — already-emailed addresses
// are tracked on `sentEmails` and skipped, so re-runs continue where they left
// off. Processes up to PER_RUN recipients per campaign per invocation.
function normalizeEmail(e: string): string {
  return String(e || '').trim().toLowerCase();
}
const isValidCampaignEmail = (e: string): boolean =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && !e.includes('\n') && !e.includes('\r');

async function runEmailCampaigns() {
  const PER_RUN = 100; // matches Resend batch limit; safe for SMTP too
  const now = new Date();
  const snap = await db.collection('emailCampaigns')
    .where('status', 'in', ['queued', 'sending'])
    .get();

  let processed = 0;
  let sent = 0;

  for (const cDoc of snap.docs) {
    const c = cDoc.data() as any;
    try {
      // Respect scheduling.
      if (c.scheduledAt?.toDate && c.scheduledAt.toDate() > now) continue;

      // Resolve the email body: saved template or inline HTML.
      let subject: string = c.subject || '';
      let bodyHtml: string = c.htmlBody || '';
      if (c.templateId) {
        const tplDoc = await db.collection('emailTemplates').doc(c.templateId).get();
        if (tplDoc.exists) {
          const tpl = tplDoc.data() as any;
          bodyHtml = tpl.html || bodyHtml;
          if (!subject) subject = tpl.subject || '';
        } else if (!bodyHtml) {
          await cDoc.ref.update({ status: 'failed', error: 'Template mungon', updatedAt: now });
          continue;
        }
      }
      if (!bodyHtml || !subject) {
        await cDoc.ref.update({ status: 'failed', error: 'Subjekti ose përmbajtja mungon', updatedAt: now });
        continue;
      }

      // Per-team email provider config (Settings → Integrime); falls back to env.
      const ts = await getTeamConfig(c.teamId);
      const mailerConfig = {
        emailProvider: ts.emailProvider,
        emailApiKey: ts.emailApiKey,
        emailFromEmail: ts.emailFromEmail,
        emailFromName: ts.emailFromName,
        emailMailgunDomain: ts.emailMailgunDomain,
        emailMailgunRegion: ts.emailMailgunRegion,
        emailSmtpHost: ts.emailSmtpHost,
        emailSmtpPort: ts.emailSmtpPort,
        emailSmtpUser: ts.emailSmtpUser,
        emailSmtpPass: ts.emailSmtpPass,
      };

      // Resolve segment → recipients from leads and/or customers (filtered in
      // memory, matching the WhatsApp broadcast approach), deduped by email.
      const seg = c.segment || {};
      const audience: string[] = seg.audience?.length ? seg.audience : ['leads'];
      // "Has a registered domain" filter → set of customerIds owning a domain.
      const audienceScope = { businessId: (c as any).businessId || null, teamId: c.teamId || null };
      const domainCustomerIds: Set<string> | null = seg.hasDomain
        ? new Set((await tenantScopedDocs('domains', audienceScope)).map(d => d.data.customerId).filter(Boolean).map(String))
        : null;
      const wantTags: string[] = seg.tags?.length ? seg.tags : (seg.tag ? [seg.tag] : []);
      const tagMatchAll = seg.tagMatch === 'all';
      const entityTags = (e: any): string[] => {
        const t = e?.tags;
        if (Array.isArray(t)) return t.map((x: any) => String(x).trim()).filter(Boolean);
        if (typeof t === 'string') return t.split(',').map((s: string) => s.trim()).filter(Boolean);
        return [];
      };
      const matchesTags = (e: any): boolean => {
        if (!wantTags.length) return true;
        const et = entityTags(e);
        return tagMatchAll ? wantTags.every((t) => et.includes(t)) : wantTags.some((t) => et.includes(t));
      };

      const byEmail = new Map<string, { id: string; name?: string; company?: string; email: string }>();
      if (audience.includes('leads')) {
        // Leads of THIS tenant only — a campaign must never reach another tenant's list.
        for (const { id: leadId, data: l } of await tenantScopedDocs('leads', audienceScope)) {
          const d = { id: leadId };
          const email = normalizeEmail(l.email);
          if (!isValidCampaignEmail(email)) continue;
          if (seg.statuses?.length && !seg.statuses.includes(l.status)) continue;
          if (!matchesTags(l)) continue;
          if (seg.assignedToUserId && l.assignedToUserId !== seg.assignedToUserId) continue;
          if (seg.source && String(l.source || '') !== seg.source) continue;
          if (domainCustomerIds) continue; // leads never own a domain
          if (!byEmail.has(email)) byEmail.set(email, { id: d.id, name: l.name, company: l.company, email });
        }
      }
      if (audience.includes('customers')) {
        for (const { id: custId, data: cu } of await tenantScopedDocs('customers', audienceScope)) {
          const d = { id: custId };
          const email = normalizeEmail(cu.email);
          if (!isValidCampaignEmail(email)) continue;
          if (!matchesTags(cu)) continue;
          if (seg.assignedToUserId && cu.assignedToUserId !== seg.assignedToUserId) continue;
          if (seg.source && String(cu.source || '') !== seg.source) continue;
          if (domainCustomerIds && !domainCustomerIds.has(String(d.id))) continue;
          if (!byEmail.has(email)) byEmail.set(email, { id: d.id, name: cu.name, company: cu.company, email });
        }
      }

      // Idempotency: skip recipients already emailed.
      const alreadySent = new Set<string>((c.sentEmails || []).map((e: string) => normalizeEmail(e)));
      const total = byEmail.size;
      const targets = Array.from(byEmail.values()).filter((t) => !alreadySent.has(t.email));
      const batch = targets.slice(0, PER_RUN);

      const messages = batch.map((t) => ({
        to: t.email,
        subject: renderMergeTokens(subject, { name: t.name || '', company: t.company || '', email: t.email }),
        html: renderMergeTokens(bodyHtml, { name: t.name || '', company: t.company || '', email: t.email }),
      }));
      const results = messages.length ? await sendBulkEmail(messages, mailerConfig, c.fromName, cDoc.id) : [];
      const succeeded = results.filter((r) => r.ok).map((r) => normalizeEmail(r.to));
      const failed = results.filter((r) => !r.ok).length;
      sent += succeeded.length;

      const newSentTotal = alreadySent.size + succeeded.length;
      const remaining = total - newSentTotal;
      const lastError = results.find((r) => !r.ok)?.error || null;
      await cDoc.ref.update({
        totalTargets: total,
        sentCount: newSentTotal,
        failedCount: (c.failedCount || 0) + failed,
        ...(succeeded.length ? { sentEmails: admin.firestore.FieldValue.arrayUnion(...succeeded) } : {}),
        status: remaining > 0 ? 'sending' : 'completed',
        error: remaining > 0 ? lastError : (succeeded.length === 0 && failed > 0 ? lastError : null),
        updatedAt: new Date(),
      });
      processed++;
    } catch (err: any) {
      console.error(`[CRON:email-campaigns] campaign ${cDoc.id} dështoi:`, err);
      await cDoc.ref.update({ status: 'failed', error: err?.message || 'Gabim', updatedAt: new Date() }).catch(() => {});
    }
  }

  return { processed, sent };
}

// Per-team email provider config (Settings → Integrime) → MailerConfig, cached.
function makeTeamSettingsCache() {
  const cache = new Map<string, any>();
  const get = async (teamId: string) => {
    if (!teamId) return {};
    if (!cache.has(teamId)) cache.set(teamId, await getTeamConfig(teamId));
    return cache.get(teamId);
  };
  const cfgFor = async (teamId: string) => {
    const ts = await get(teamId);
    return {
      emailProvider: ts.emailProvider, emailApiKey: ts.emailApiKey, emailFromEmail: ts.emailFromEmail,
      emailFromName: ts.emailFromName, emailMailgunDomain: ts.emailMailgunDomain, emailMailgunRegion: ts.emailMailgunRegion,
      emailSmtpHost: ts.emailSmtpHost, emailSmtpPort: ts.emailSmtpPort, emailSmtpUser: ts.emailSmtpUser, emailSmtpPass: ts.emailSmtpPass,
    };
  };
  return { cfgFor };
}

// Normalize a campaign to a list of drip steps. A campaign with no explicit
// `steps` is a single day-0 email built from its subject/template/htmlBody.
function campaignSteps(c: any): { delayDays: number; subject?: string; templateId?: string; htmlBody?: string }[] {
  if (Array.isArray(c.steps) && c.steps.length) {
    return c.steps.map((s: any, i: number) => ({
      delayDays: Number(s.delayDays) || (i === 0 ? 0 : 0),
      subject: s.subject, templateId: s.templateId, htmlBody: s.htmlBody,
    }));
  }
  return [{ delayDays: 0, subject: c.subject, templateId: c.templateId, htmlBody: c.htmlBody }];
}

// ── JOB: purchase-campaigns ──────────────────────────────────────────────────
// Evergreen automations: when a customer PAYS an invoice, ENROLL them into any
// matching 'purchase' campaign (service filter empty = any purchase). Covers all
// payment paths (Stripe/WHMCS/manual) by scanning Paid invoices. Idempotent: the
// enrollment is recorded on the invoice's `marketingCampaignsSent`; only invoices
// paid AFTER the campaign was created are eligible (so activating an automation
// never blasts old buyers). The actual emails are delivered by runCampaignSteps.
async function runPurchaseCampaigns() {
  const now = new Date();
  const LOOKBACK_MS = 60 * 24 * 3600 * 1000; // safety cap: ignore purchases older than 60d
  const MAX_INVOICES = 300;                   // bound Firestore reads per run

  // Single-field query (no composite index); filter status in memory.
  const campSnap = await db.collection('emailCampaigns').where('trigger', '==', 'purchase').get();
  const campaigns = campSnap.docs
    .map((d) => ({ id: d.id, ...(d.data() as any) }))
    .filter((c) => c.status === 'active')
    .map((c) => ({
      ...c,
      _createdAt: c.createdAt?.toDate ? c.createdAt.toDate() : new Date(0),
      _wants: new Set<string>((c.triggerServiceIds || []).filter(Boolean)),
    }));
  if (campaigns.length === 0) return { campaigns: 0, enrolled: 0 };

  const invSnap = await db.collection('invoices').where('status', '==', 'Paid').limit(MAX_INVOICES).get();

  let enrolled = 0;
  for (const invDoc of invSnap.docs) {
    const inv = invDoc.data() as any;
    const paidAt = inv.paidAt?.toDate ? inv.paidAt.toDate() : (inv.updatedAt?.toDate ? inv.updatedAt.toDate() : null);
    if (!paidAt || now.getTime() - paidAt.getTime() > LOOKBACK_MS) continue;

    const already = new Set<string>(inv.marketingCampaignsSent || []);
    const candidates = campaigns.filter((c) => c.teamId === inv.teamId && !already.has(c.id) && paidAt >= c._createdAt);
    if (candidates.length === 0 || !inv.customerId) continue;

    const custDoc = await db.collection('customers').doc(inv.customerId).get();
    const email = normalizeEmail(custDoc.data()?.email);
    if (!isValidCampaignEmail(email)) continue;

    // Which services were on this invoice (only if a candidate filters by service).
    let serviceIds: Set<string> | null = null;
    if (candidates.some((c) => c._wants.size > 0)) {
      const itemsSnap = await db.collection('invoiceItems').where('invoiceId', '==', invDoc.id).get();
      serviceIds = new Set<string>(itemsSnap.docs.map((d) => (d.data() as any).serviceId).filter(Boolean));
    }

    for (const c of candidates) {
      if (c._wants.size > 0 && !(serviceIds && [...c._wants].some((id) => serviceIds!.has(id)))) continue;
      // Enroll the buyer; step 0 is due immediately (runCampaignSteps sends it).
      await db.collection('campaignEnrollments').add({
        teamId: inv.teamId,
        ...(inv.businessId ? { businessId: inv.businessId } : {}),
        campaignId: c.id,
        email,
        name: custDoc.data()?.name || '',
        company: custDoc.data()?.company || '',
        currentStep: 0,
        status: 'active',
        enrolledAt: admin.firestore.Timestamp.fromDate(now),
        nextSendAt: admin.firestore.Timestamp.fromDate(now),
        lastSentAt: null,
        sentSteps: [],
        sourceInvoiceId: invDoc.id,
        createdAt: admin.firestore.Timestamp.fromDate(now),
        updatedAt: admin.firestore.Timestamp.fromDate(now),
      });
      await invDoc.ref.update({ marketingCampaignsSent: admin.firestore.FieldValue.arrayUnion(c.id) }).catch(() => {});
      enrolled++;
    }
  }

  return { campaigns: campaigns.length, enrolled };
}

// ── JOB: campaign-steps ──────────────────────────────────────────────────────
// Delivers due drip-sequence steps for active enrollments. For each enrollment
// whose nextSendAt has passed: send the current step, advance to the next (with
// its delayDays from enrollment), or complete. Idempotent via `sentSteps`.
async function runCampaignSteps() {
  const now = new Date();
  const MAX = 200; // recipients processed per run
  const snap = await db.collection('campaignEnrollments').where('status', '==', 'active').limit(MAX).get();
  if (snap.empty) return { processed: 0, sent: 0 };

  const { cfgFor } = makeTeamSettingsCache();
  const campCache = new Map<string, any>();
  const getCampaign = async (id: string) => {
    if (!campCache.has(id)) campCache.set(id, (await db.collection('emailCampaigns').doc(id).get()).data() || null);
    return campCache.get(id);
  };
  const tplCache = new Map<string, any>();
  const getTpl = async (id: string) => {
    if (!tplCache.has(id)) tplCache.set(id, (await db.collection('emailTemplates').doc(id).get()).data() || null);
    return tplCache.get(id);
  };

  let processed = 0, sent = 0;
  for (const eDoc of snap.docs) {
    const e = eDoc.data() as any;
    const due = e.nextSendAt?.toDate ? e.nextSendAt.toDate() : now;
    if (due > now) continue;

    try {
      const camp = await getCampaign(e.campaignId);
      if (!camp || (camp.status !== 'active' && camp.status !== 'paused')) {
        await eDoc.ref.update({ status: 'stopped', updatedAt: now }); continue;
      }
      if (camp.status === 'paused') continue; // hold; resume when reactivated

      const steps = campaignSteps(camp);
      const idx: number = e.currentStep || 0;
      if (idx >= steps.length) { await eDoc.ref.update({ status: 'completed', updatedAt: now }); continue; }
      const step = steps[idx];
      const alreadySent = new Set<number>(e.sentSteps || []);

      // Resolve this step's subject + HTML (step → template → campaign fallback).
      let subject = step.subject || camp.subject || '';
      let html = step.htmlBody || '';
      if (step.templateId) {
        const tpl = await getTpl(step.templateId);
        if (tpl) { html = tpl.html || html; if (!subject) subject = tpl.subject || ''; }
      } else if (!html && camp.templateId) {
        const tpl = await getTpl(camp.templateId);
        if (tpl) { html = tpl.html || html; if (!subject) subject = tpl.subject || ''; }
      }
      if (!html) html = camp.htmlBody || '';

      let stepOk = alreadySent.has(idx); // if already sent, just advance
      if (!stepOk && subject && html) {
        const cfg = await cfgFor(e.teamId);
        const vars = { name: e.name || '', company: e.company || '', email: e.email };
        const results = await sendBulkEmail(
          [{ to: e.email, subject: renderMergeTokens(subject, vars), html: renderMergeTokens(html, vars) }],
          cfg, camp.fromName, e.campaignId,
        );
        stepOk = !!results[0]?.ok;
        if (stepOk) {
          sent++;
          await db.collection('emailCampaigns').doc(e.campaignId).update({
            sentCount: admin.firestore.FieldValue.increment(1),
            sentEmails: admin.firestore.FieldValue.arrayUnion(e.email),
            updatedAt: now,
          }).catch(() => {});
        }
      }

      if (stepOk) {
        const nextIdx = idx + 1;
        const enrolledAt = e.enrolledAt?.toDate ? e.enrolledAt.toDate() : now;
        if (nextIdx >= steps.length) {
          await eDoc.ref.update({
            status: 'completed', currentStep: nextIdx, lastSentAt: now,
            sentSteps: admin.firestore.FieldValue.arrayUnion(idx), updatedAt: now,
          });
        } else {
          const nextDue = new Date(enrolledAt.getTime() + (Number(steps[nextIdx].delayDays) || 0) * 86_400_000);
          await eDoc.ref.update({
            currentStep: nextIdx, lastSentAt: now,
            nextSendAt: admin.firestore.Timestamp.fromDate(nextDue),
            sentSteps: admin.firestore.FieldValue.arrayUnion(idx), updatedAt: now,
          });
        }
        processed++;
      }
    } catch (err: any) {
      console.error(`[CRON:campaign-steps] enrollment ${eDoc.id} dështoi:`, err);
    }
  }

  return { processed, sent };
}

// ── JOB: backfill-businessid (two-level tenancy, Phase 2) ────────────────────
// Stamps businessId onto every team-scoped doc via Admin SDK (bypasses rules, so
// it covers activities/messages/comments the client can't touch). Idempotent.
const BACKFILL_COLLECTIONS = [
  'tasks', 'invoices', 'invoiceItems', 'customers', 'leads', 'deals', 'leadActivities',
  'services', 'expenses', 'goals', 'timeEntries', 'channels', 'messages', 'activities',
  'clientRequests', 'taskComments', 'taskCollaborators', 'customIndustries', 'directMessages',
  'milestones', 'serviceInquiries', 'projectComments', 'workspaceFolders', 'workspaceDriveFiles',
  'projects', 'roleTemplates', 'dailyReports', 'standups', 'quotes', 'contracts', 'chatSnippets',
  // Identity/structure collections that are now business-scoped on read:
  'teamMembers', 'teamInvites',
  // WhatsApp collections excluded: their reads use skipTeamFilter (unaffected by the
  // Phase 3b businessId flip) and the owner doesn't need them tagged with businessId.
];

async function runBackfillBusinessId(opts?: { reset?: boolean }) {
  // Resumable + time-budgeted: each call processes as many collections as fit in the
  // budget, records completed ones in a state doc, and returns what's left. The client
  // calls repeatedly until done. Completed collections are SKIPPED (not re-read), so a
  // resumed run costs no extra Firestore reads — important on a quota-limited project.
  const stateRef = db.collection('migrations').doc('businessIdBackfill');
  const stateSnap = await stateRef.get();
  const done: string[] = (opts?.reset || !stateSnap.exists) ? [] : (stateSnap.data()?.done || []);

  const teamsSnap = await db.collection('teams').get();
  const teamToBusiness = new Map<string, string>();
  teamsSnap.docs.forEach(d => { const b = (d.data() as any).businessId; if (b) teamToBusiness.set(d.id, b); });
  if (teamToBusiness.size === 0) return { error: 'No teams linked to a business yet — run Phase 1 first.' };

  const pending = BACKFILL_COLLECTIONS.filter(c => !done.includes(c));
  const started = Date.now();
  const BUDGET_MS = 45000; // leave margin under the 60s function limit
  let totalUpdated = 0;
  const results: { collection: string; scanned: number; updated: number; error?: string }[] = [];

  for (const col of pending) {
    if (Date.now() - started > BUDGET_MS) break;
    let scanned = 0, updated = 0;
    try {
      const snap = await db.collection(col).get();
      scanned = snap.size;
      const toUpdate = snap.docs.filter(d => {
        const data = d.data() as any;
        const bid = data.teamId ? teamToBusiness.get(data.teamId) : undefined;
        return !!bid && data.businessId !== bid;
      });
      for (let i = 0; i < toUpdate.length; i += 400) {
        const batch = db.batch();
        toUpdate.slice(i, i + 400).forEach(d => batch.update(d.ref, { businessId: teamToBusiness.get((d.data() as any).teamId)! }));
        await batch.commit();
        updated += Math.min(400, toUpdate.length - i);
      }
      totalUpdated += updated;
      done.push(col);
      results.push({ collection: col, scanned, updated });
    } catch (err: any) {
      const msg = String(err?.message || err);
      console.error(`[backfill] ${col} failed:`, msg);
      results.push({ collection: col, scanned, updated: -1, error: msg.slice(0, 300) });
      // Stop on quota errors — there's no point hammering an exhausted project.
      if (msg.includes('RESOURCE_EXHAUSTED')) break;
    }
  }

  await stateRef.set({ done, updatedAt: admin.firestore.Timestamp.now() }, { merge: true });
  const remaining = BACKFILL_COLLECTIONS.filter(c => !done.includes(c));
  return { totalUpdated, businesses: teamToBusiness.size, results, completed: done.length, total: BACKFILL_COLLECTIONS.length, remaining };
}

// ── JOB: backfill-portal-customerid ──────────────────────────────────────────
// Mirrors each portal user's customerId onto users/{uid}.customerId so the
// isPortalClientFor() rule can grant them read access once reads are hardened.
async function runBackfillPortalCustomerId() {
  const snap = await db.collection('clientPortalAccess').get();
  const seen = new Set<string>();
  let updated = 0;
  for (const d of snap.docs) {
    const data = d.data() as any;
    const uid = data.userId; const cid = data.customerId;
    if (!uid || !cid || seen.has(uid)) continue;
    seen.add(uid);
    try {
      await db.collection('users').doc(uid).set({ customerId: cid, updatedAt: admin.firestore.Timestamp.now() }, { merge: true });
      updated++;
    } catch (err: any) { console.error(`[portal-backfill] ${uid} failed:`, err?.message || err); }
  }
  return { updated, total: snap.size };
}

// ── JOB: backfill-member-keys (tenant-isolation cutover, Step 1) ─────────────
// Re-keys every teamMembers doc to the DETERMINISTIC id `{teamId}_{uid}` so the
// hardened Firestore rules can validate a user's tenant key via exists()/get().
// Historically JoinInviteView used addDoc() (random ids) while createTenant used
// {teamId}_{uid}; this normalizes the legacy random-keyed docs. Idempotent:
// correctly-keyed docs are skipped, so re-runs are cheap. MUST complete before the
// hardened users/teamMembers rules are deployed (see SECURITY_RULES_CUTOVER_RUNBOOK).
async function runBackfillMemberKeys(opts?: { dryRun?: boolean }) {
  const snap = await db.collection('teamMembers').get();
  let alreadyKeyed = 0, reKeyed = 0, dedupedDuplicates = 0, skippedIncomplete = 0;
  const errors: string[] = [];

  for (const d of snap.docs) {
    const data = d.data() as any;
    const teamId = data.teamId as string | undefined;
    const uid = data.userId as string | undefined;
    if (!teamId || !uid) { skippedIncomplete++; continue; }

    const targetId = `${teamId}_${uid}`;
    if (d.id === targetId) { alreadyKeyed++; continue; }

    if (opts?.dryRun) { reKeyed++; continue; }

    try {
      const targetRef = db.collection('teamMembers').doc(targetId);
      const targetSnap = await targetRef.get();
      const batch = db.batch();
      if (targetSnap.exists) {
        // A deterministic doc already exists for this (team,user) — it wins; drop the
        // legacy duplicate so usePermissions no longer sees two memberships.
        batch.delete(d.ref);
        dedupedDuplicates++;
      } else {
        batch.set(targetRef, { ...data, updatedAt: admin.firestore.Timestamp.now() });
        batch.delete(d.ref);
        reKeyed++;
      }
      await batch.commit();
    } catch (err: any) {
      const msg = String(err?.message || err);
      console.error(`[backfill-member-keys] ${d.id} failed:`, msg);
      errors.push(`${d.id}: ${msg.slice(0, 200)}`);
    }
  }

  return { total: snap.size, alreadyKeyed, reKeyed, dedupedDuplicates, skippedIncomplete, errors, dryRun: !!opts?.dryRun };
}

// ── JOB: backfill-member-compensation ────────────────────────────────────────
// Copy `monthlySalary`, `salaryHistory` and `hourlyCostRate` out of every
// `teamMembers` row into `teamMemberComp/{teamId}_{userId}`.
//
// WHY: `teamMembers` is readable by the whole business (the roster is), so every
// employee could read every colleague's salary with one query. The new
// collection is restricted to the member themselves plus the tenant's
// admins/managers (firestore.rules).
//
// THIS JOB DOES NOT TOUCH THE ORIGINALS. The app is in a DUAL-READ / DUAL-WRITE
// period: the comp document wins where it exists, the legacy fields are the
// fallback (src/lib/finance/compensation.ts, mirrored in project-spend-rollup).
// Clearing the legacy fields is a separate, later step — see the runbook comment
// above the `teamMembers` read rule in firestore.rules. Reverse that order and
// either payroll breaks or the leak stays open.
//
// Idempotent and SAFE TO RUN TWICE: a member that already has a comp document is
// skipped, never overwritten — a second run must not undo an edit made in the
// app after the first one. Super-admin only (it reads every tenant's pay).
async function runBackfillMemberCompensation(opts?: { dryRun?: boolean }) {
  const [membersSnap, compSnap] = await Promise.all([
    db.collection('teamMembers').get(),
    db.collection('teamMemberComp').get(),
  ]);

  const existing = new Set<string>(compSnap.docs.map((d) => d.id));
  let written = 0, skippedExisting = 0, skippedNoPay = 0, skippedIncomplete = 0;
  const errors: string[] = [];
  const now = admin.firestore.Timestamp.now();

  let batch = db.batch();
  let pending = 0;
  const flush = async () => {
    if (!pending) return;
    await batch.commit();
    batch = db.batch();
    pending = 0;
  };

  for (const d of membersSnap.docs) {
    const data = d.data() as any;
    const teamId = data.teamId as string | undefined;
    const uid = data.userId as string | undefined;
    // The document id IS the data model here (it mirrors the membership id and
    // the rules pin it), so a row missing either half has no home to move to.
    // `backfill-member-keys` is the job that repairs those.
    if (!teamId || !uid) { skippedIncomplete++; continue; }

    const targetId = `${teamId}_${uid}`;
    if (existing.has(targetId)) { skippedExisting++; continue; }

    const hasHistory = Array.isArray(data.salaryHistory) && data.salaryHistory.length > 0;
    const hasPay = data.monthlySalary !== undefined || data.hourlyCostRate !== undefined || hasHistory;
    // No pay recorded → no document. An empty row would still be a row the
    // dual-read has to merge, and it says nothing the fallback does not.
    if (!hasPay) { skippedNoPay++; continue; }

    if (opts?.dryRun) { written++; continue; }

    try {
      batch.set(db.collection('teamMemberComp').doc(targetId), {
        businessId: data.businessId ?? null,
        teamId,
        userId: uid,
        ...(data.monthlySalary !== undefined ? { monthlySalary: data.monthlySalary } : {}),
        ...(hasHistory ? { salaryHistory: data.salaryHistory } : {}),
        ...(data.hourlyCostRate !== undefined ? { hourlyCostRate: data.hourlyCostRate } : {}),
        backfilledFrom: d.id,
        createdAt: now,
        updatedAt: now,
        updatedByUserId: null,
      });
      existing.add(targetId);
      written++;
      pending++;
      if (pending >= 400) await flush();
    } catch (err: any) {
      const msg = String(err?.message || err);
      console.error(`[backfill-member-compensation] ${d.id} failed:`, msg);
      errors.push(`${d.id}: ${msg.slice(0, 200)}`);
    }
  }

  try {
    await flush();
  } catch (err: any) {
    const msg = String(err?.message || err);
    console.error('[backfill-member-compensation] final commit failed:', msg);
    errors.push(`commit: ${msg.slice(0, 200)}`);
  }

  return {
    total: membersSnap.size,
    written,
    skippedExisting,
    skippedNoPay,
    skippedIncomplete,
    errors,
    dryRun: !!opts?.dryRun,
    note: 'Legacy teamMembers fields are left untouched on purpose (dual read).',
  };
}

// ── JOB: tenant-usage-rollup (platform console: is this tenant alive?) ───────
// Writes `businesses.usage` so the console can tell an engaged trial from a dead one,
// and see which tenant's volume drives platform cost — WITHOUT the operator's browser
// reading tenant data.
//
// Cost discipline: document counts use Firestore `count()` aggregations (billed per
// ~1000 index entries, not per document), and "last activity" is one
// `orderBy(updatedAt desc).limit(1)` per signal collection. That is a handful of reads
// per tenant regardless of how much data the tenant holds.
const USAGE_COUNT_COLLECTIONS = ['customers', 'leads', 'projects', 'tasks', 'invoices'];
const USAGE_SIGNAL_COLLECTIONS = ['tasks', 'invoices', 'activities', 'messages', 'projects'];

async function runTenantUsageRollup(opts?: { dryRun?: boolean }) {
  const now = admin.firestore.Timestamp.now();
  const sevenDaysAgo = admin.firestore.Timestamp.fromMillis(Date.now() - 7 * 86_400_000);
  const bizSnap = await db.collection('businesses').get();

  let updated = 0;
  const errors: string[] = [];
  const summary: Array<{ businessId: string; docs: number; activeUsers7d: number; lastActivityAt: string | null }> = [];

  for (const bizDoc of bizSnap.docs) {
    const businessId = bizDoc.id;
    try {
      // 1. Volume — count() aggregations, one per collection.
      const docCounts: Record<string, number> = {};
      await Promise.all(USAGE_COUNT_COLLECTIONS.map(async (coll) => {
        try {
          const agg = await db.collection(coll).where('businessId', '==', businessId).count().get();
          docCounts[coll] = agg.data().count;
        } catch {
          docCounts[coll] = -1; // missing index / permission — reported, never fatal
        }
      }));
      const docsTotal = Object.values(docCounts).reduce((n, v) => n + Math.max(0, v), 0);

      // 2. Freshness — newest write across the signal collections.
      let lastMs = 0;
      await Promise.all(USAGE_SIGNAL_COLLECTIONS.map(async (coll) => {
        try {
          const snap = await db.collection(coll)
            .where('businessId', '==', businessId)
            .orderBy('updatedAt', 'desc').limit(1).get();
          const v = snap.empty ? null : (snap.docs[0].data() as any)?.updatedAt;
          const ms = v?.toDate ? v.toDate().getTime() : 0;
          if (ms > lastMs) lastMs = ms;
        } catch { /* collection may lack the composite index — skip that signal */ }
      }));

      // 3. Engagement — distinct staff who wrote something in the last 7 days.
      const actors = new Set<string>();
      try {
        const recent = await db.collection('activities')
          .where('businessId', '==', businessId)
          .where('createdAt', '>=', sevenDaysAgo)
          .limit(500).get();
        for (const d of recent.docs) {
          const uid = (d.data() as any)?.createdByUserId;
          if (uid) actors.add(String(uid));
        }
      } catch { /* index missing → leave at 0 rather than guessing */ }

      const usage = {
        lastActivityAt: lastMs ? admin.firestore.Timestamp.fromMillis(lastMs) : null,
        activeUsers7d: actors.size,
        docCounts,
        docsTotal,
        computedAt: now,
      };

      // Denormalised structure counts. The console used to read EVERY tenant's
      // teamMembers and teams on each page view (and pulled salary fields into the
      // operator's browser) just to show a member count and find a team to enter.
      // count() keeps this cheap, and `defaultTeamId` removes the teams read entirely.
      let memberCount = 0;
      let teamCount = 0;
      let defaultTeamId: string | null = null;
      try {
        const [memberAgg, teamsSnap] = await Promise.all([
          db.collection('teamMembers')
            .where('businessId', '==', businessId).where('status', '==', 'Active').count().get(),
          db.collection('teams').where('businessId', '==', businessId).limit(50).get(),
        ]);
        memberCount = memberAgg.data().count;
        teamCount = teamsSnap.size;
        defaultTeamId = teamsSnap.docs[0]?.id || null;
      } catch { /* leave at 0 — the console falls back to a dash, never a wrong number */ }

      if (!opts?.dryRun) {
        await bizDoc.ref.set({
          usage, memberCount, teamCount, defaultTeamId, updatedAt: now,
        }, { merge: true });
      }
      updated++;
      summary.push({
        businessId,
        docs: docsTotal,
        activeUsers7d: actors.size,
        lastActivityAt: lastMs ? new Date(lastMs).toISOString() : null,
      });
    } catch (err: any) {
      errors.push(`${businessId}: ${String(err?.message || err).slice(0, 160)}`);
    }
  }

  return { tenants: bizSnap.size, updated, errors, summary, dryRun: !!opts?.dryRun };
}

// ── JOB: platform-metrics-rollup (platform console: are we growing?) ─────────
// One document per month at `platformMetrics/{YYYY-MM}`: signups, trial→paid
// conversions, churn, MRR. The tenant list can only ever show "now"; this is the
// history that says whether the business is growing.
//
// Idempotent: the current month is recomputed on every run, closed months keep the
// value they had when the month ended (they are only rewritten if explicitly asked).
async function runPlatformMetricsRollup(opts?: { dryRun?: boolean; month?: string; backfill?: boolean }) {
  const now = new Date();
  const nowTs = admin.firestore.Timestamp.now();
  const key = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  const target = opts?.month && /^\d{4}-\d{2}$/.test(opts.month) ? opts.month : key(now);

  const bizSnap = await db.collection('businesses').get();
  const toDate = (v: any): Date | null => (v?.toDate ? v.toDate() : (v ? new Date(v) : null));

  // Fallback price list for tenants with no `mrrCents` yet (mirrors tenantMrr in
  // src/lib/platformAdmin.ts, which prefers the real Stripe amount too).
  const MONTHLY_EUR: Record<string, number> = { starter: 29, pro: 79, business: 149, enterprise: 0 };

  const monthsToWrite = new Set<string>([target]);
  if (opts?.backfill) {
    // Rebuild history from the signup/activation/cancel stamps we already store.
    for (const d of bizSnap.docs) {
      const b = d.data() as any;
      for (const stamp of [b.createdAt, b.activatedAt, b.canceledAt, b.suspendedAt]) {
        const dt = toDate(stamp);
        if (dt) monthsToWrite.add(key(dt));
      }
    }
  }

  const written: string[] = [];
  for (const month of Array.from(monthsToWrite).sort()) {
    const [y, m] = month.split('-').map(Number);
    const monthStart = new Date(Date.UTC(y, m - 1, 1));
    const monthEnd = new Date(Date.UTC(y, m, 1));
    const inMonth = (v: any) => {
      const dt = toDate(v);
      return !!dt && dt >= monthStart && dt < monthEnd;
    };

    const doc: Record<string, any> = {
      month,
      tenantsTotal: 0, tenantsActive: 0, tenantsTrialing: 0,
      tenantsPastDue: 0, tenantsSuspended: 0, tenantsCanceled: 0,
      signups: 0, activated: 0, churned: 0, mrr: 0, arr: 0,
    };

    for (const d of bizSnap.docs) {
      const b = d.data() as any;
      const created = toDate(b.createdAt);
      // A tenant only counts towards a month's totals if it existed by then.
      if (created && created >= monthEnd) continue;
      doc.tenantsTotal++;
      switch (b.status) {
        case 'active': doc.tenantsActive++; break;
        case 'trialing': doc.tenantsTrialing++; break;
        case 'past_due': doc.tenantsPastDue++; break;
        case 'suspended': doc.tenantsSuspended++; break;
        case 'canceled': doc.tenantsCanceled++; break;
        default: break;
      }
      if (inMonth(b.createdAt)) doc.signups++;
      if (inMonth(b.activatedAt)) doc.activated++;
      if (inMonth(b.canceledAt) || inMonth(b.suspendedAt)) doc.churned++;
      // Prefer the real billed amount (webhook-maintained); fall back to list price.
      if (b.status === 'active') {
        doc.mrr += typeof b.mrrCents === 'number' && b.mrrCents > 0
          ? b.mrrCents / 100
          : (MONTHLY_EUR[b.plan || ''] ?? 0);
      }
    }
    doc.arr = doc.mrr * 12;
    doc.computedAt = nowTs;
    doc.updatedAt = nowTs;

    if (!opts?.dryRun) {
      await db.collection('platformMetrics').doc(month).set(doc, { merge: true });
    }
    written.push(month);
  }

  return { months: written, tenants: bizSnap.size, dryRun: !!opts?.dryRun };
}

// ── Tenant data lifecycle (GDPR / DPA) ───────────────────────────────────────
// Every collection that can hold a tenant's data, so "give me everything you have"
// and "delete everything you have" are answerable — a hard requirement in any
// enterprise DPA, and previously not implementable at all.
const TENANT_DATA_COLLECTIONS = [
  ...BACKFILL_COLLECTIONS,
  'payments', 'domains', 'dailyFocus', 'productivitySettings', 'weeklyReviews',
  // Hosting & domains module (all stamped with businessId).
  'subscriptions', 'hostingOrders', 'hostingEvents', 'hostingProducts', 'hostingServers', 'hostingServerSecrets',
  'domainTlds', 'hostingCoupons', 'hostingBackups',
  'emailCampaigns', 'emailTemplates', 'campaignEnrollments', 'waTemplates', 'waBroadcasts',
  'socialSnapshots', 'products', 'productCategories', 'productBrands', 'stockMovements',
  'shopOrders', 'conversations', 'auditLogs', 'notifications', 'dailyReportMisses',
  'gmbAccounts', 'gmbReviews', 'gmbPosts',
  'crmAutomationRules', 'crmAutomationRuns',
  // Reporting module — client deliverables, internal commentary and per-employee
  // accountability scores; all businessId-stamped but previously missing here,
  // so "delete everything" reported complete while every report survived.
  'reports', 'reportVersions', 'reportComments', 'reportApprovals', 'reportEvents',
  'reportTemplates', 'reportSchedules', 'reportKpis', 'reportMetrics',
  'clientHealthScores', 'employeeReportScores',
  // contactMerges holds the FULL snapshot of an absorbed contact (the only copy
  // once the duplicate is deleted) — personal data that must not survive erasure.
  'contactMerges',
  // Portal login records (client emails), staff profiles, per-tenant social OAuth
  // tokens, and the expense-dedupe archive — all businessId-stamped PII/credentials.
  'clientPortalAccess', 'userProfiles', 'socialAccounts', 'expenseDeduped',
  // Compensation, split out of `teamMembers` (which is already covered via
  // BACKFILL_COLLECTIONS). Salaries are a tenant's data like any other: they must
  // travel with an export and be erased with a deletion.
  'teamMemberComp',
];

/**
 * JOB: tenant-export — everything the platform holds for one tenant, as JSON.
 * Super-admin only. Time-budgeted: returns `truncated: true` with the collections it
 * did not reach, so a huge tenant can be exported in several calls.
 */
async function runTenantExport(businessId: string, opts?: { maxDocs?: number }) {
  if (!businessId) throw new Error('businessId required');
  const started = Date.now();
  const BUDGET_MS = 40_000;
  const maxDocs = opts?.maxDocs && opts.maxDocs > 0 ? opts.maxDocs : 20_000;

  const data: Record<string, any[]> = {};
  const counts: Record<string, number> = {};
  const skipped: string[] = [];
  let total = 0;

  // The tenant's own structure documents first.
  const bizSnap = await db.collection('businesses').doc(businessId).get();
  data.businesses = bizSnap.exists ? [{ id: bizSnap.id, ...(bizSnap.data() as any) }] : [];
  const teamsSnap = await db.collection('teams').where('businessId', '==', businessId).get();
  data.teams = teamsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
  // teamSettings is keyed by teamId; teamSecrets is deliberately NOT exported.
  data.teamSettings = [];
  for (const t of teamsSnap.docs) {
    const s = await db.collection('teamSettings').doc(t.id).get();
    if (s.exists) data.teamSettings.push({ id: s.id, ...(s.data() as any) });
  }

  for (const coll of TENANT_DATA_COLLECTIONS) {
    if (Date.now() - started > BUDGET_MS || total >= maxDocs) { skipped.push(coll); continue; }
    try {
      const snap = await db.collection(coll).where('businessId', '==', businessId).get();
      data[coll] = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
      counts[coll] = snap.size;
      total += snap.size;
    } catch (err: any) {
      counts[coll] = -1;
      console.error(`[tenant-export] ${coll} failed:`, err?.message || err);
    }
  }

  await writeAudit({
    businessId, actorUid: null, action: 'tenant.export',
    target: `business:${businessId}`, meta: { docs: total, truncated: skipped.length > 0 },
  });

  return {
    businessId, exportedAt: new Date().toISOString(), docs: total, counts,
    truncated: skipped.length > 0, skipped, data,
  };
}

/**
 * JOB: tenant-delete — irreversible erasure of one tenant.
 * Super-admin only AND requires `confirm` to equal the businessId, so it can never be
 * triggered by a stray request. Resumable + time-budgeted; the business document itself
 * is removed last, so an interrupted run can always be resumed.
 */
async function runTenantDelete(businessId: string, confirm: string, opts?: { dryRun?: boolean }) {
  if (!businessId) throw new Error('businessId required');
  if (confirm !== businessId) {
    throw new Error('Confirmation mismatch: pass confirm=<businessId> to delete a tenant');
  }
  const started = Date.now();
  const BUDGET_MS = 40_000;
  const deleted: Record<string, number> = {};
  let totalDeleted = 0;
  let exhausted = false;

  const deleteQuery = async (coll: string, snap: admin.firestore.QuerySnapshot) => {
    let n = 0;
    // Batches of 400 (Firestore limit is 500 writes per batch).
    for (let i = 0; i < snap.docs.length; i += 400) {
      if (Date.now() - started > BUDGET_MS) { exhausted = true; break; }
      const batch = db.batch();
      for (const d of snap.docs.slice(i, i + 400)) batch.delete(d.ref);
      if (!opts?.dryRun) await batch.commit();
      n += Math.min(400, snap.docs.length - i);
    }
    deleted[coll] = (deleted[coll] || 0) + n;
    totalDeleted += n;
  };

  for (const coll of TENANT_DATA_COLLECTIONS) {
    if (exhausted) break;
    try {
      const snap = await db.collection(coll).where('businessId', '==', businessId).limit(2000).get();
      if (!snap.empty) await deleteQuery(coll, snap);
      if (snap.size === 2000) exhausted = true; // more remain → resume with another call
    } catch (err: any) {
      console.error(`[tenant-delete] ${coll} failed:`, err?.message || err);
    }
  }

  // Structure + credentials last, and only once the data is gone.
  if (!exhausted) {
    const teamsSnap = await db.collection('teams').where('businessId', '==', businessId).get();
    // WhatsApp content is deliberately NOT businessId-stamped (reads are
    // team-scoped), so the businessId sweep above can never touch it — but it
    // is real conversations with real people and must not survive erasure.
    // Swept here by teamId, BEFORE the team docs go (they are the only link).
    for (const t of teamsSnap.docs) {
      for (const coll of ['whatsappMessages', 'whatsappThreads', 'whatsappAccounts', 'whatsappConversations']) {
        if (exhausted) break;
        try {
          const waSnap = await db.collection(coll).where('teamId', '==', t.id).limit(2000).get();
          if (!waSnap.empty) await deleteQuery(coll, waSnap);
          if (waSnap.size === 2000) exhausted = true;
        } catch (err: any) {
          console.error(`[tenant-delete] ${coll} (team ${t.id}) failed:`, err?.message || err);
        }
      }
    }
    for (const t of teamsSnap.docs) {
      if (exhausted) break;
      if (!opts?.dryRun) {
        await db.collection('teamSettings').doc(t.id).delete().catch(() => {});
        await db.collection('teamSecrets').doc(t.id).delete().catch(() => {});
        await t.ref.delete().catch(() => {});
      }
      totalDeleted += 3;
    }
    // publicTenants entry (subdomain → tenant) and finally the business itself —
    // but only when the WhatsApp sweep above finished too (resume otherwise).
    if (!exhausted) {
      const bizSnap = await db.collection('businesses').doc(businessId).get();
      const sub = bizSnap.exists ? (bizSnap.data() as any)?.portalSubdomain : null;
      if (sub && !opts?.dryRun) await db.collection('publicTenants').doc(String(sub)).delete().catch(() => {});
      if (!opts?.dryRun) await db.collection('businesses').doc(businessId).delete().catch(() => {});
    }
  }

  // The audit entry is written OUTSIDE the tenant (businessId kept for traceability)
  // and survives the deletion, which is what a DPA asks for.
  await writeAudit({
    businessId, actorUid: null, action: opts?.dryRun ? 'tenant.delete_dry_run' : 'tenant.delete',
    target: `business:${businessId}`, meta: { deleted, totalDeleted, complete: !exhausted },
  });

  return { businessId, deleted, totalDeleted, complete: !exhausted, dryRun: !!opts?.dryRun };
}

// ── JOB: subscription-lifecycle (the SaaS money loop) ────────────────────────
// Turns billing state into tenant state, every day:
//   trialing + trialEndsAt passed          → past_due (grace clock starts)
//   past_due for more than GRACE_DAYS      → suspended (rules freeze writes)
//   canceled + period ended                → suspended
// Owners are warned 3 days before the trial ends, on expiry, and on suspension.
// Idempotent: a tenant already in the target state is skipped.
const BILLING_GRACE_DAYS = 7;
async function runSubscriptionLifecycle(opts?: { dryRun?: boolean }) {
  const now = new Date();
  const nowTs = admin.firestore.Timestamp.now();
  // Cost rule: don't pull fat tenant docs whole. A `where('status', in …)` filter
  // would silently skip legacy docs with NO status field (treated as 'trialing'
  // below), so keep the full scan but project only the fields the loop reads.
  const snap = await db.collection('businesses')
    .select('status', 'ownerId', 'trialEndsAt', 'trialWarnedAt', 'pastDueSince', 'currentPeriodEnd', 'updatedAt')
    .get();

  let warned = 0, expired = 0, suspended = 0, skipped = 0;
  const actions: Array<{ businessId: string; action: string }> = [];

  const notifyOwner = async (businessId: string, ownerId: string | null, title: string, message: string) => {
    if (!ownerId || opts?.dryRun) return;
    await notifyUser({
      userId: ownerId,
      type: 'billing',
      title,
      message,
      actionUrl: '/app/billing',
      actionLabel: 'Hap Abonimin',
      businessId,
    }).catch(() => { /* non-critical */ });
  };

  for (const d of snap.docs) {
    const b = d.data() as any;
    const status: string = b.status || 'trialing';
    const ownerId: string | null = b.ownerId || null;

    // Paying tenants and already-frozen ones need nothing.
    if (status === 'active' || status === 'suspended') { skipped++; continue; }

    const toDate = (v: any): Date | null =>
      v?.toDate ? v.toDate() : (v ? new Date(v) : null);

    // 1. Trial expiry → past_due (grace), or a warning 3 days out.
    if (status === 'trialing') {
      const trialEndsAt = toDate(b.trialEndsAt);
      if (!trialEndsAt) { skipped++; continue; }
      const daysLeft = Math.ceil((trialEndsAt.getTime() - now.getTime()) / 86_400_000);
      if (daysLeft > 3) { skipped++; continue; }
      if (daysLeft > 0) {
        // Warn once per day-3 window (guarded by trialWarnedAt).
        const warnedAt = toDate(b.trialWarnedAt);
        if (warnedAt && now.getTime() - warnedAt.getTime() < 2 * 86_400_000) { skipped++; continue; }
        if (!opts?.dryRun) await d.ref.set({ trialWarnedAt: nowTs, updatedAt: nowTs }, { merge: true });
        await notifyOwner(d.id, ownerId,
          `Provja mbaron pas ${daysLeft} ditë${daysLeft === 1 ? '' : 'ësh'}`,
          'Zgjidh një plan për të vazhduar pa ndërprerje pas mbarimit të provës.');
        warned++; actions.push({ businessId: d.id, action: 'trial_warning' });
        continue;
      }
      // Trial is over and no subscription attached → grace period.
      if (!opts?.dryRun) {
        await d.ref.set({ status: 'past_due', pastDueSince: b.pastDueSince || nowTs, updatedAt: nowTs }, { merge: true });
      }
      await notifyOwner(d.id, ownerId, 'Provja mbaroi',
        `Hapësira mbetet aktive për ${BILLING_GRACE_DAYS} ditë. Aktivizo një plan për të mos u pezulluar.`);
      await writeAudit({ businessId: d.id, actorUid: null, action: 'billing.trial_expired', target: `business:${d.id}` });
      expired++; actions.push({ businessId: d.id, action: 'trial_expired' });
      continue;
    }

    // 2. Grace period exhausted → suspend (Firestore rules then deny writes).
    if (status === 'past_due' || status === 'canceled') {
      const since = toDate(b.pastDueSince) || toDate(b.currentPeriodEnd) || toDate(b.updatedAt);
      if (!since) { skipped++; continue; }
      const daysDue = Math.floor((now.getTime() - since.getTime()) / 86_400_000);
      if (daysDue < BILLING_GRACE_DAYS) { skipped++; continue; }
      if (!opts?.dryRun) {
        await d.ref.set({ status: 'suspended', suspendedAt: nowTs, updatedAt: nowTs }, { merge: true });
      }
      await notifyOwner(d.id, ownerId, 'Hapësira u pezullua',
        'Abonimi nuk është aktiv. Të dhënat ruhen; aktivizo pagesën për t\'i rikthyer shkrimet.');
      await writeAudit({ businessId: d.id, actorUid: null, action: 'billing.suspended', target: `business:${d.id}`, meta: { daysDue } });
      suspended++; actions.push({ businessId: d.id, action: 'suspended' });
    }
  }

  return { businesses: snap.size, warned, expired, suspended, skipped, actions, dryRun: !!opts?.dryRun };
}

// ── JOB: migrate-team-secrets (credential vault cutover) ─────────────────────
// Moves credentials out of `teamSettings` (readable by every member of the
// business) into `teamSecrets` (denied to ALL clients), mirrors `has*` markers and
// deletes the plaintext copies. Also strips `metaChannels[].accessToken` into
// `metaChannelTokens`. Idempotent — re-runs are no-ops once a team is clean.
async function runMigrateTeamSecrets(opts?: { dryRun?: boolean }) {
  const snap = await db.collection('teamSettings').get();
  const moved: Record<string, string[]> = {};
  let teamsTouched = 0, tokensMoved = 0;
  const errors: string[] = [];

  for (const d of snap.docs) {
    const s = d.data() as any;
    const secrets: Record<string, any> = {};
    for (const field of SECRET_FIELDS) {
      if (field === 'metaChannelTokens') continue;
      if (typeof s[field] === 'string' && s[field].trim()) secrets[field] = s[field].trim();
    }
    // Per-channel Meta access tokens → a single map in the vault.
    const channels: any[] = Array.isArray(s.metaChannels) ? s.metaChannels : [];
    const tokenMap: Record<string, string> = {};
    for (const ch of channels) {
      if (ch?.phoneNumberId && ch?.accessToken) tokenMap[ch.phoneNumberId] = ch.accessToken;
    }
    if (Object.keys(tokenMap).length) {
      secrets.metaChannelTokens = tokenMap;
      tokensMoved += Object.keys(tokenMap).length;
    }
    if (Object.keys(secrets).length === 0) continue;

    moved[d.id] = Object.keys(secrets);
    teamsTouched++;
    if (opts?.dryRun) continue;
    try {
      // writeTeamSecrets also mirrors has* flags and deletes the plaintext copies.
      await writeTeamSecrets(d.id, secrets);
    } catch (err: any) {
      const msg = String(err?.message || err);
      console.error(`[migrate-team-secrets] ${d.id} failed:`, msg);
      errors.push(`${d.id}: ${msg.slice(0, 200)}`);
    }
  }
  return { teams: snap.size, teamsTouched, tokensMoved, moved, errors, dryRun: !!opts?.dryRun };
}

// ── JOB: tenant-hierarchy (a team must live INSIDE a business) ───────────────
// Enforces the two-level model on existing data:
//   1. every `teams` doc gets a `businessId` pointing at a REAL `businesses` doc
//      (inherited from the owner's other teams / its members, else a business is
//      created for it),
//   2. `publicTenants/{subdomain}` — the minimal, public subdomain→tenant map — is
//      rebuilt, so `businesses` no longer has to be world-readable for the portal
//      to resolve its tenant.
async function runTenantHierarchy(opts?: { dryRun?: boolean }) {
  const now = admin.firestore.Timestamp.now();
  const [teamsSnap, bizSnap, membersSnap] = await Promise.all([
    db.collection('teams').get(),
    db.collection('businesses').get(),
    db.collection('teamMembers').get(),
  ]);

  const businessIds = new Set(bizSnap.docs.map((d) => d.id));
  const ownerToBusiness = new Map<string, string>();     // team owner uid → businessId
  const teamToBusiness = new Map<string, string>();      // teamId → businessId
  for (const d of teamsSnap.docs) {
    const t = d.data() as any;
    if (t.businessId && businessIds.has(t.businessId)) {
      teamToBusiness.set(d.id, t.businessId);
      if (t.createdByUserId) ownerToBusiness.set(t.createdByUserId, t.businessId);
    }
  }
  // Members can also reveal the business of a team that lost its own key.
  const memberBusinessByTeam = new Map<string, string>();
  for (const d of membersSnap.docs) {
    const m = d.data() as any;
    if (m.teamId && m.businessId && businessIds.has(m.businessId) && !memberBusinessByTeam.has(m.teamId)) {
      memberBusinessByTeam.set(m.teamId, m.businessId);
    }
  }

  let attached = 0, businessesCreated = 0, alreadyOk = 0;
  const errors: string[] = [];

  for (const d of teamsSnap.docs) {
    const t = d.data() as any;
    if (t.businessId && businessIds.has(t.businessId)) { alreadyOk++; continue; }

    let bid: string | null =
      memberBusinessByTeam.get(d.id)
      || (t.createdByUserId ? ownerToBusiness.get(t.createdByUserId) || null : null);

    // The team's stale businessId may point at a business that no longer exists, or
    // at the teamId itself (the legacy "no business layer" convention) — in both
    // cases the team needs a real parent business.
    if (!bid) {
      if (opts?.dryRun) { attached++; continue; }
      try {
        const bizRef = db.collection('businesses').doc();
        await bizRef.set({
          name: t.name || 'Biznes',
          ownerId: t.createdByUserId || null,
          status: 'active',
          createdAt: now,
          updatedAt: now,
          createdByUserId: t.createdByUserId || null,
          // Provenance so this is auditable after the fact.
          createdBy: 'tenant-hierarchy-migration',
          migratedFromTeamId: d.id,
        });
        bid = bizRef.id;
        businessIds.add(bid);
        businessesCreated++;
        if (t.createdByUserId) ownerToBusiness.set(t.createdByUserId, bid);
      } catch (err: any) {
        errors.push(`business for team ${d.id}: ${String(err?.message || err).slice(0, 200)}`);
        continue;
      }
    }
    if (opts?.dryRun) { attached++; continue; }
    try {
      await d.ref.set({ businessId: bid, updatedAt: now }, { merge: true });
      teamToBusiness.set(d.id, bid!);
      attached++;
    } catch (err: any) {
      errors.push(`team ${d.id}: ${String(err?.message || err).slice(0, 200)}`);
    }
  }

  // ── publicTenants: the ONLY world-readable slice of tenant metadata ──
  let subdomains = 0;
  if (!opts?.dryRun) {
    for (const d of bizSnap.docs) {
      const b = d.data() as any;
      const sub = typeof b.portalSubdomain === 'string' ? b.portalSubdomain.trim().toLowerCase() : '';
      if (!sub) continue;
      // A team of that business, so portal-created docs get a consistent teamId.
      let teamId: string | null = null;
      for (const [tid, bid] of teamToBusiness) if (bid === d.id) { teamId = tid; break; }
      try {
        await db.collection('publicTenants').doc(sub).set({
          businessId: d.id,
          teamId,
          name: b.name || null,
          portalSubdomain: sub,
          updatedAt: now,
        }, { merge: true });
        subdomains++;
      } catch (err: any) {
        errors.push(`publicTenants/${sub}: ${String(err?.message || err).slice(0, 200)}`);
      }
    }
  }

  return {
    teams: teamsSnap.size, alreadyOk, attached, businessesCreated, subdomains,
    errors, dryRun: !!opts?.dryRun,
  };
}

// ── JOB: backfill-tenant-keys ────────────────────────────────────────────────
// Stamps the tenant key on collections whose reads are being hardened but which
// were never part of the Phase-2 businessId backfill: `channels` (chat), and the
// identity/structure docs `userProfiles` + `clientPortalAccess`. A doc without the
// key is invisible to a business-scoped query, so this MUST run before the matching
// rules are deployed (see workspace/SECURITY_RULES_CUTOVER_RUNBOOK.md).
async function runBackfillTenantKeys(opts?: { dryRun?: boolean }) {
  const now = admin.firestore.Timestamp.now();
  const [teamsSnap, membersSnap, customersSnap] = await Promise.all([
    db.collection('teams').get(),
    db.collection('teamMembers').get(),
    db.collection('customers').get(),
  ]);
  const teamToBusiness = new Map<string, string>();
  for (const d of teamsSnap.docs) {
    const b = (d.data() as any).businessId;
    teamToBusiness.set(d.id, b || d.id);
  }
  const memberByUid = new Map<string, any>();
  for (const d of membersSnap.docs) {
    const m = d.data() as any;
    if (m.userId && !memberByUid.has(m.userId)) memberByUid.set(m.userId, m);
  }
  const customerById = new Map<string, any>();
  for (const d of customersSnap.docs) customerById.set(d.id, d.data());

  const results: Record<string, { scanned: number; updated: number; unresolved: number }> = {};

  // channels — tenant from the channel's teamId
  {
    const snap = await db.collection('channels').get();
    let updated = 0, unresolved = 0;
    for (const d of snap.docs) {
      const c = d.data() as any;
      if (c.businessId) continue;
      const bid = c.teamId ? teamToBusiness.get(c.teamId) || c.teamId : null;
      if (!bid) { unresolved++; continue; }
      if (!opts?.dryRun) await d.ref.set({ businessId: bid, updatedAt: now }, { merge: true });
      updated++;
    }
    results.channels = { scanned: snap.size, updated, unresolved };
  }

  // userProfiles — tenant from the user's membership
  {
    const snap = await db.collection('userProfiles').get();
    let updated = 0, unresolved = 0;
    for (const d of snap.docs) {
      const p = d.data() as any;
      if (p.businessId) continue;
      const m = p.userId ? memberByUid.get(p.userId) : null;
      const bid = m?.businessId || (m?.teamId ? teamToBusiness.get(m.teamId) : null);
      if (!bid) { unresolved++; continue; }
      if (!opts?.dryRun) {
        await d.ref.set({ businessId: bid, ...(m?.teamId ? { teamId: m.teamId } : {}), updatedAt: now }, { merge: true });
      }
      updated++;
    }
    results.userProfiles = { scanned: snap.size, updated, unresolved };
  }

  // clientPortalAccess — tenant from the linked customer
  {
    const snap = await db.collection('clientPortalAccess').get();
    let updated = 0, unresolved = 0;
    for (const d of snap.docs) {
      const a = d.data() as any;
      if (a.businessId) continue;
      const c = a.customerId ? customerById.get(a.customerId) : null;
      const bid = c?.businessId || (c?.teamId ? teamToBusiness.get(c.teamId) : null) || (a.teamId ? teamToBusiness.get(a.teamId) : null);
      if (!bid) { unresolved++; continue; }
      if (!opts?.dryRun) await d.ref.set({ businessId: bid, updatedAt: now }, { merge: true });
      updated++;
    }
    results.clientPortalAccess = { scanned: snap.size, updated, unresolved };
  }

  const totalUpdated = Object.values(results).reduce((n, r) => n + r.updated, 0);
  return { results, totalUpdated, dryRun: !!opts?.dryRun };
}

// ── JOB: sync-tenant-claims ─────────────────────────────────────────────────
// Materialises bid/tid/roles onto every member's Auth token, so Firestore rules can
// stop trusting the client-written users/{uid} document. Users must refresh their ID
// token (sign out/in, or the app's automatic getIdToken(true)) to pick it up.
async function runSyncTenantClaims(opts?: { dryRun?: boolean }) {
  const membersSnap = await db.collection('teamMembers').get();
  const uids = new Map<string, string>(); // uid → email
  for (const d of membersSnap.docs) {
    const m = d.data() as any;
    if (m.userId && m.status !== 'Inactive') uids.set(m.userId, m.email || '');
  }
  let synced = 0;
  const errors: string[] = [];
  for (const [uid, email] of uids) {
    if (opts?.dryRun) { synced++; continue; }
    try {
      await syncTenantClaims(uid, email || undefined);
      synced++;
    } catch (err: any) {
      errors.push(`${uid}: ${String(err?.message || err).slice(0, 160)}`);
    }
  }
  return { users: uids.size, synced, errors, dryRun: !!opts?.dryRun };
}

// ── JOB: backfill-customerid (Phase 4.3b Wave 3) ─────────────────────────────
// Stamps customerId onto parent-linked child records so portal clients can read
// their own data under server-side RLS (isPortalClientFor). Staff isolation uses
// businessId; the portal needs customerId on these collections, which carry none of
// their own — derived from the parent invoice / project / task. Resumable +
// time-budgeted, mirroring backfill-businessid. Order matters: tasks before
// taskComments (a comment's customerId comes from its task's, derived here too).
const CUSTOMERID_BACKFILL_COLLECTIONS = ['invoiceItems', 'tasks', 'projectComments', 'taskComments'];

async function runBackfillCustomerId(opts?: { reset?: boolean }) {
  const stateRef = db.collection('migrations').doc('customerIdBackfill');
  const stateSnap = await stateRef.get();
  const done: string[] = (opts?.reset || !stateSnap.exists) ? [] : (stateSnap.data()?.done || []);

  const pending = CUSTOMERID_BACKFILL_COLLECTIONS.filter(c => !done.includes(c));
  const started = Date.now();
  const BUDGET_MS = 45000;
  let totalUpdated = 0;
  const results: { collection: string; scanned: number; updated: number; error?: string }[] = [];

  // Parent → customerId maps, loaded once and cached across collections.
  let invoiceCustomer: Map<string, string> | null = null;
  let projectCustomer: Map<string, string> | null = null;
  let taskCustomer: Map<string, string> | null = null;

  const loadInvoices = async () => {
    if (!invoiceCustomer) {
      invoiceCustomer = new Map();
      (await db.collection('invoices').get()).docs.forEach(d => {
        const c = (d.data() as any).customerId; if (c) invoiceCustomer!.set(d.id, c);
      });
    }
    return invoiceCustomer;
  };
  const loadProjects = async () => {
    if (!projectCustomer) {
      projectCustomer = new Map();
      (await db.collection('projects').get()).docs.forEach(d => {
        const c = (d.data() as any).customerId; if (c) projectCustomer!.set(d.id, c);
      });
    }
    return projectCustomer;
  };
  const loadTasks = async () => {
    if (!taskCustomer) {
      const projMap = await loadProjects();
      taskCustomer = new Map();
      (await db.collection('tasks').get()).docs.forEach(d => {
        const data = d.data() as any;
        const c = data.customerId || (data.projectId ? projMap.get(data.projectId) : undefined);
        if (c) taskCustomer!.set(d.id, c);
      });
    }
    return taskCustomer;
  };

  for (const col of pending) {
    if (Date.now() - started > BUDGET_MS) break;
    let scanned = 0, updated = 0;
    try {
      // Preload the parent map this collection needs.
      let lookup: Map<string, string>; let parentKey: string;
      if (col === 'invoiceItems') { lookup = await loadInvoices(); parentKey = 'invoiceId'; }
      else if (col === 'taskComments') { lookup = await loadTasks(); parentKey = 'taskId'; }
      else { lookup = await loadProjects(); parentKey = 'projectId'; } // tasks, projectComments

      const snap = await db.collection(col).get();
      scanned = snap.size;
      const toUpdate: { ref: any; customerId: string }[] = [];
      snap.docs.forEach(d => {
        const data = d.data() as any;
        if (data.customerId) return;
        // taskComments: customerId IS the client-visibility switch (the portal
        // reads `customerId == mine`). Blanket-stamping it would publish every
        // internal staff comment on a client task to the portal — stamp only
        // comments the CLIENT authored; staff ones stay internal unless the
        // composer marked them client-visible (which sets customerId itself).
        if (col === 'taskComments' && data.senderType !== 'client') return;
        const pid = data[parentKey];
        const cid = pid ? lookup.get(pid) : undefined;
        if (cid) toUpdate.push({ ref: d.ref, customerId: cid });
      });
      for (let i = 0; i < toUpdate.length; i += 400) {
        const batch = db.batch();
        toUpdate.slice(i, i + 400).forEach(u => batch.update(u.ref, { customerId: u.customerId }));
        await batch.commit();
        updated += Math.min(400, toUpdate.length - i);
      }
      totalUpdated += updated;
      done.push(col);
      results.push({ collection: col, scanned, updated });
    } catch (err: any) {
      const msg = String(err?.message || err);
      console.error(`[backfill-customerid] ${col} failed:`, msg);
      results.push({ collection: col, scanned, updated: -1, error: msg.slice(0, 300) });
      if (msg.includes('RESOURCE_EXHAUSTED')) break;
    }
  }

  await stateRef.set({ done, updatedAt: admin.firestore.Timestamp.now() }, { merge: true });
  const remaining = CUSTOMERID_BACKFILL_COLLECTIONS.filter(c => !done.includes(c));
  return { totalUpdated, results, completed: done.length, total: CUSTOMERID_BACKFILL_COLLECTIONS.length, remaining };
}

// ── JOB: set-superadmin-claim ────────────────────────────────────────────────
// Sets a Firebase custom claim { superAdmin: true } on the caller IF their email
// is in the super-admin allowlist (server reads the same env the client uses).
// Needed before hardening rules so the super-admin's cross-tenant reads (and the
// isSuperAdmin() rule) keep working. Caller must sign out/in afterwards to refresh.
async function runSetSuperAdminClaim(req: VercelRequest) {
  const token = (req.headers.authorization as string | undefined)?.slice(7) || '';
  let decoded: any;
  try { decoded = await adminAuth.verifyIdToken(token); }
  catch (err: any) { return { error: `Token invalid: ${err?.message || err}` }; }
  const email = String(decoded.email || '').toLowerCase();
  const allow = String(process.env.SUPER_ADMIN_EMAILS || process.env.VITE_SUPER_ADMIN_EMAILS || '')
    .split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  if (!allow.includes(email)) {
    return { error: `Email "${email}" is not in the super-admin allowlist.` };
  }
  await adminAuth.setCustomUserClaims(decoded.uid, { superAdmin: true });
  return { success: true, uid: decoded.uid, email, note: 'Dil dhe hyr sërish që token-i të marrë claim-in.' };
}

// ── JOB: inquiry-materials-reminders ─────────────────────────────────────────
// Emails the CLIENT a gentle reminder listing the materials still missing from
// their submitted questionnaire (logo, photos, business services, description,
// website, socials). Opt-in per team via teamSettings.inquiryMaterialsReminderEnabled;
// re-sends every N days (default 3), up to 3 times. Mirrors the completeness
// logic in src/lib/inquiryBrief.ts (getInquiryCompleteness) — keep in sync.
function inquiryMissingMaterials(q: any): { key: string; label: string }[] {
  const isEmpty = (v: any) =>
    v == null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);
  const hasServices = Array.isArray(q.businessServices)
    && q.businessServices.some((s: any) => s && String(s.title || '').trim());
  const hasMaterials = (Array.isArray(q.materialFiles) && q.materialFiles.length > 0)
    || !isEmpty(q.googleDriveLink)
    || (Array.isArray(q.folderIncludes) && q.folderIncludes.length > 0);
  const hasSocial = !isEmpty(q.instagramLink) || !isEmpty(q.facebookLink)
    || !isEmpty(q.tiktokLink) || !isEmpty(q.linkedinLink);
  const items = [
    { key: 'logo', label: 'Logo e biznesit', done: !isEmpty(q.logoUrl) },
    { key: 'photos', label: 'Foto / materiale', done: hasMaterials },
    { key: 'services', label: 'Shërbimet e biznesit', done: hasServices },
    { key: 'description', label: 'Përshkrimi i biznesit', done: !isEmpty(q.businessDescription) },
    { key: 'website', label: 'Website', done: !isEmpty(q.website) },
    { key: 'social', label: 'Rrjetet sociale', done: hasSocial },
  ];
  return items.filter((i) => !i.done).map(({ key, label }) => ({ key, label }));
}

function buildInquiryMaterialsEmail(firstName: string, missingLabels: string[], link: string): string {
  const items = missingLabels.map((l) => `<li style="margin:4px 0;">${l}</li>`).join('');
  return `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#ffffff;">
      <h2 style="color:#12468C;margin:0 0 8px;">Plotësoni materialet e projektit tuaj</h2>
      <p style="font-size:15px;color:#374151;">Përshëndetje <strong>${firstName}</strong>,</p>
      <p style="font-size:15px;color:#4b5563;line-height:1.6;">
        Faleminderit që dërguat anketën! Për të nisur punën sa më mirë për ju, na mungojnë ende disa materiale:
      </p>
      <ul style="font-size:15px;color:#111827;padding-left:20px;">${items}</ul>
      <p style="margin:24px 0;">
        <a href="${link}" style="background:#0EA5E9;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;display:inline-block;">
          Plotëso tani
        </a>
      </p>
      <p style="font-size:13px;color:#9ca3af;">Nuk është e detyrueshme, por sa më shumë të dimë, aq më mirë punojmë për ju.</p>
      <p style="font-size:12px;color:#9ca3af;border-top:1px solid #e5e7eb;padding-top:12px;margin-top:24px;">FivoCRM — Kujtesë automatike</p>
    </div>
  `;
}

async function runInquiryMaterialsReminders() {
  const transporter = makeTransporter();
  const smtpUser = safeSenderAddress(process.env.SMTP_USER);
  if (!transporter || !smtpUser) return { sent: 0, skipped: 0 };

  const now = Date.now();
  const MAX_REMINDERS = 3;
  const PORTAL_BASE = process.env.APP_URL || 'https://fivocrm.com';
  const isValidEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && !e.includes('\n') && !e.includes('\r');
  const ms = (v: any): number => (v?.toDate ? v.toDate().getTime() : (v ? new Date(v).getTime() : 0));
  const daysSince = (t: number) => (t ? (now - t) / 86_400_000 : Infinity);

  const snap = await db.collection('serviceInquiries').get();
  if (snap.empty) return { sent: 0, skipped: 0 };

  const tsCache = new Map<string, any>();
  const getTeamSettings = async (teamId: string) => {
    if (tsCache.has(teamId)) return tsCache.get(teamId);
    const data = await getTeamConfig(teamId);
    tsCache.set(teamId, data);
    return data;
  };

  let sent = 0, skipped = 0;
  const ops: Promise<any>[] = [];

  for (const doc of snap.docs) {
    const q = doc.data();
    // Only submitted, still-open inquiries with a team + valid client email
    if (q.isDraft === true) { skipped++; continue; }
    if (q.status !== 'New' && q.status !== 'Reviewed') { skipped++; continue; }
    if (!q.teamId || !q.email || !isValidEmail(q.email)) { skipped++; continue; }

    const settings = await getTeamSettings(q.teamId);
    if (!settings?.inquiryMaterialsReminderEnabled) { skipped++; continue; }
    const days = Math.max(1, Number(settings.inquiryMaterialsReminderDays) || 3);

    const missing = inquiryMissingMaterials(q);
    if (missing.length === 0) { skipped++; continue; }

    const count = Number(q.materialsReminderCount) || 0;
    if (count >= MAX_REMINDERS) { skipped++; continue; }

    // Wait `days` since last activity (updatedAt) AND since the previous reminder.
    const lastActivity = ms(q.updatedAt) || ms(q.createdAt);
    const lastReminder = ms(q.materialsReminderSentAt);
    if (daysSince(lastActivity) < days) { skipped++; continue; }
    if (lastReminder && daysSince(lastReminder) < days) { skipped++; continue; }

    const firstName = String(q.contactName || q.businessName || 'Klient').split(' ')[0];
    const link = `${PORTAL_BASE}/portal/projects/inquiry/${doc.id}`;
    const html = buildInquiryMaterialsEmail(firstName, missing.map((m) => m.label), link);

    ops.push(
      transporter.sendMail({
        from: `"FivoCRM" <${smtpUser}>`,
        to: q.email,
        subject: 'Kujtesë: plotësoni materialet e projektit tuaj',
        html,
      })
        // Only touch the reminder fields — do NOT bump updatedAt (that would
        // reset the activity clock and delay the next reminder indefinitely).
        .then(() => doc.ref.update({
          materialsReminderSentAt: admin.firestore.Timestamp.now(),
          materialsReminderCount: count + 1,
        }))
        .catch((e) => console.error('[inquiry-materials-reminder]', e))
    );
    sent++;
  }

  await settleAll(ops, 'inquiry-materials-reminders');
  return { sent, skipped };
}

// ── JOB: lead-cadence-steps ──────────────────────────────────────────────────
// Automated follow-up sequences: for each lead with cadenceActive, create a
// follow-up task for the assigned rep at each configured day-offset (from
// cadenceStartedAt), advancing cadenceStep. Stops when steps run out or the
// lead reaches a terminal status (Won/Converted/Lost).
//
// Playbook-aware: a lead enrolled in a playbook (`lead.playbookId`, see
// `_playbooks.ts` — the byte-identical mirror of src/lib/crm/playbooks.ts) fires
// THAT playbook's steps (day offset, channel, title, rendered template) and sets
// the lead's next step so the Ndjekjet queue shows the right primary action.
// A lead without a playbook — or whose playbook was deleted/deactivated — falls
// back to the team's default `leadCadenceDays`. After the last playbook step an
// optional nurture reminder (`nurtureEveryDays`) re-surfaces the lead.
async function runLeadCadenceSteps() {
  const now = Date.now();
  const DAY = 86_400_000;
  const ms = (v: any): number => (v?.toDate ? v.toDate().getTime() : (v ? new Date(v).getTime() : 0));
  const TERMINAL = ['Won', 'Converted', 'Lost'];
  const CHANNEL_LABEL: Record<string, string> = {
    call: 'Telefonatë', whatsapp: 'WhatsApp', email: 'Email', meeting: 'Takim', other: 'Tjetër',
  };

  // One teamSettings read per team: `leadCadenceDays` is validated by the shared
  // resolver (sorted unique ints 1–90, ≤ 8 steps; anything invalid → the default
  // [1, 3, 7, 14]) — the same rule the Settings chips enforce, so a stray 0 or 200
  // can no longer create a task "today" or never. Playbooks come from the same
  // document via `resolvePlaybooks` (invalid entries dropped).
  type TeamCadence = { days: number[]; playbooks: Playbook[] };
  const tsCache = new Map<string, TeamCadence>();
  const teamCadence = async (teamId: string): Promise<TeamCadence> => {
    if (!teamId) return { days: resolveFollowUpConfig(null).leadCadenceDays, playbooks: [] };
    if (tsCache.has(teamId)) return tsCache.get(teamId)!;
    let out: TeamCadence = { days: resolveFollowUpConfig(null).leadCadenceDays, playbooks: [] };
    try {
      const d = await db.collection('teamSettings').doc(teamId).get();
      const data = d.exists ? (d.data() as any) : null;
      out = { days: resolveFollowUpConfig(data).leadCadenceDays, playbooks: resolvePlaybooks(data) };
    } catch { /* default */ }
    tsCache.set(teamId, out);
    return out;
  };

  // `{{staffName}}` in a template: one capped teamMembers read per business,
  // only when a template actually asks for it.
  const nameCache = new Map<string, Map<string, string>>();
  const staffName = async (businessId: string, userId: string): Promise<string> => {
    if (!businessId || !userId) return '';
    if (!nameCache.has(businessId)) {
      const names = new Map<string, string>();
      try {
        const snap = await db.collection('teamMembers').where('businessId', '==', businessId).limit(200).get();
        snap.docs.forEach(d => {
          const m = d.data() as any;
          if (!m.userId) return;
          const n = m.displayName || m.name || (m.email ? String(m.email).split('@')[0] : '');
          if (n) names.set(String(m.userId), String(n));
        });
      } catch { /* empty */ }
      nameCache.set(businessId, names);
    }
    return nameCache.get(businessId)!.get(userId) ?? '';
  };

  const snap = await db.collection('leads').where('cadenceActive', '==', true).get();
  if (snap.empty) return { created: 0, completed: 0, nurtured: 0, playbookSteps: 0, defaultSteps: 0 };

  let created = 0, completed = 0, nurtured = 0, playbookSteps = 0, defaultSteps = 0;
  const ops: Promise<any>[] = [];

  const taskBase = (lead: any, leadId: string, due: admin.firestore.Timestamp, recipientId: string | null) => ({
    status: 'Todo',
    priority: 'medium',
    assignedToUserId: recipientId,
    createdByUserId: lead.createdByUserId || null,
    teamId: lead.teamId || null,
    businessId: lead.businessId || null,
    startDate: due,
    endDate: due,
    dueDate: due,
    dueNotificationSent: false,
    relatedLeadId: leadId,
    createdAt: admin.firestore.Timestamp.now(),
    updatedAt: admin.firestore.Timestamp.now(),
  });

  for (const doc of snap.docs) {
    const lead = doc.data();
    if (TERMINAL.includes(lead.status)) {
      ops.push(doc.ref.update({ cadenceActive: false, updatedAt: admin.firestore.Timestamp.now() }));
      completed++;
      continue;
    }
    const { days, playbooks } = await teamCadence(lead.teamId);
    const step = Number(lead.cadenceStep) || 0;
    const startedMs = ms(lead.cadenceStartedAt) || ms(lead.createdAt);
    const recipientId: string | null = lead.assignedToUserId || lead.createdByUserId || null;
    const leadName: string = lead.name || 'Lead';
    const focusUrl = `/app/follow-ups?focus=lead:${doc.id}`;

    // ── Playbook path ── (a missing / deactivated playbook falls through to the default cadence)
    const pb = lead.playbookId ? playbooks.find(p => p.id === lead.playbookId && p.active) : undefined;
    if (pb) {
      const next = nextPlaybookStep(lead as any, playbooks);
      if (!next || next.playbook.id !== pb.id) {
        // Enrolled but every step already fired (or the playbook lost its steps).
        ops.push(doc.ref.update({ cadenceActive: false, updatedAt: admin.firestore.Timestamp.now() }));
        completed++;
        continue;
      }
      const s = next.step;
      const total = pb.steps.length;
      const dueMs = startedMs + s.day * DAY;
      if (now < dueMs) continue; // not due yet

      const due = admin.firestore.Timestamp.fromDate(new Date(now));
      const rendered = s.template
        ? renderPlaybookTemplate(s.template, {
            name: lead.name,
            company: lead.company,
            service: pb.name,
            staffName: /\{\{\s*staffName\s*\}\}/i.test(s.template) && recipientId
              ? await staffName(lead.businessId, recipientId)
              : '',
          })
        : '';
      const footer = `— Hapi ${step + 1}/${total} · Playbook ${pb.name} · Dërgo nga Ndjekjet`;
      const description = `${rendered || 'Nuk ka template'}\n\n${footer}`;

      ops.push(db.collection('tasks').add({
        title: `${s.title}: ${leadName}`,
        description,
        ...taskBase(lead, doc.id, due, recipientId),
      }));
      if (recipientId) {
        ops.push(notifyUser({
          userId: recipientId,
          type: 'lead_cadence_step',
          title: `🔁 ${s.title}: ${leadName}`,
          message: `Hapi ${step + 1}/${total} · Playbook ${pb.name} — ${CHANNEL_LABEL[s.channel] ?? s.channel}.`,
          actionUrl: focusUrl,
          actionLabel: 'Hap ndjekjen',
          businessId: lead.businessId ?? null,
          teamId: lead.teamId ?? null,
          email: false,
        }));
      }
      const nextStep = step + 1;
      const finished = nextStep >= total;
      const patch: Record<string, any> = {
        cadenceStep: nextStep,
        cadenceActive: !finished,
        nextFollowUpDate: due,
        nextFollowUpType: s.channel,
        followUpNote: s.title,
        updatedAt: admin.firestore.Timestamp.now(),
      };
      if (finished) {
        completed++;
        const nurtureDays = Number(pb.nurtureEveryDays) || 0;
        if (nurtureDays > 0) {
          // The playbook is over; re-surface the lead in the queue every N days.
          patch.nextFollowUpDate = admin.firestore.Timestamp.fromMillis(now + nurtureDays * DAY);
          patch.nextFollowUpType = 'whatsapp';
          patch.followUpNote = `Nurture ${pb.name}`;
          nurtured++;
        }
      }
      ops.push(doc.ref.update(patch));
      created++;
      playbookSteps++;
      continue;
    }

    // ── Default cadence path (team `leadCadenceDays`) ──
    if (step >= days.length) {
      ops.push(doc.ref.update({ cadenceActive: false, updatedAt: admin.firestore.Timestamp.now() }));
      completed++;
      continue;
    }
    const dueMs = startedMs + days[step] * DAY;
    if (now < dueMs) continue; // not due yet

    const due = admin.firestore.Timestamp.fromDate(new Date(now));
    ops.push(db.collection('tasks').add({
      title: `Ndjekje ${step + 1}: ${leadName}`,
      description: `Hapi ${step + 1}/${days.length} i sekuencës së ndjekjes. Rikontakto lead-in.`,
      ...taskBase(lead, doc.id, due, recipientId),
    }));
    if (recipientId) {
      ops.push(notifyUser({
        userId: recipientId,
        type: 'lead_cadence_step',
        title: `🔁 Ndjekje: ${leadName}`,
        message: `Hapi ${step + 1}/${days.length} i sekuencës — koha për rikontakt.`,
        actionUrl: focusUrl,
        actionLabel: 'Hap ndjekjen',
        businessId: lead.businessId ?? null,
        teamId: lead.teamId ?? null,
        email: false,
      }));
    }
    const nextStep = step + 1;
    ops.push(doc.ref.update({
      cadenceStep: nextStep,
      cadenceActive: nextStep < days.length,
      nextFollowUpDate: due,
      nextFollowUpType: 'call',
      followUpNote: `Ndjekje ${step + 1}`,
      updatedAt: admin.firestore.Timestamp.now(),
    }));
    created++;
    defaultSteps++;
    if (nextStep >= days.length) completed++;
  }

  await settleAll(ops, 'lead-cadence-steps');
  return { created, completed, nurtured, playbookSteps, defaultSteps };
}

// ── JOB: project-spend-rollup ────────────────────────────────────────────────
// Rolls logged time (hours × member cost-rate) + project-tagged expenses into
// each project's `spent`, so Reports/Customer360 margins reflect real labor cost
// instead of the stale creation-time 0. Also stores laborCost/billableValue/
// loggedHours for realization. Mirrors src/lib/finance/laborCost.ts — keep in sync.
async function runProjectSpendRollup(opts?: { full?: boolean }) {
  const DEFAULT_RATES: Record<string, number> = { EUR: 100, USD: 92, GBP: 118, ALL: 1, LEK: 1 };
  const ms = (v: any): number => (v?.toDate ? v.toDate().getTime() : (v ? new Date(v).getTime() : 0));
  const entryHours = (e: any): number => {
    if (typeof e.duration === 'number' && e.duration > 0) return e.duration / 60;
    const s = ms(e.startTime), en = ms(e.endTime);
    return (s && en && en > s) ? (en - s) / 3_600_000 : 0;
  };

  // ── INCREMENTAL by default ────────────────────────────────────────────────
  // The full version read EVERY project, time entry and expense on the platform on
  // every daily run — cost that grew with the number of tenants rather than with the
  // work actually done. Now we look at what changed since the last run and recompute
  // only the affected projects (a full pass still runs when there is no state yet, or
  // when ?full=1 is passed).
  const stateRef = db.collection('migrations').doc('projectSpendRollup');
  const stateSnap = await stateRef.get();
  const state = (stateSnap.exists ? stateSnap.data() : null) as any;

  // A FULL pass at least weekly, as a backstop.
  //
  // The incremental scan finds work through `expenses.updatedAt > lastRunAt`,
  // which structurally cannot see a DELETED expense (no document, no timestamp).
  // The client now flags the affected project (`spendRollupDirty`), but a flag
  // write can fail, and a row deleted straight from the console sets none — so
  // `spent` could drift upward forever until someone thought to pass ?full=1.
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  const lastFullMs = state?.lastFullRunAt?.toDate ? state.lastFullRunAt.toDate().getTime() : 0;
  const fullDue = Date.now() - lastFullMs > WEEK_MS;
  const forceFull = !!opts?.full || fullDue;

  const lastRunAt: admin.firestore.Timestamp | null =
    (!forceFull && stateSnap.exists ? state?.lastRunAt : null) || null;

  let projectDocs: admin.firestore.QueryDocumentSnapshot[];
  let entryDocs: admin.firestore.QueryDocumentSnapshot[];
  let expenseDocs: admin.firestore.QueryDocumentSnapshot[];
  let mode: 'full' | 'incremental' = 'full';

  // The cursor is stamped BEFORE the first read, never after. Taken afterwards,
  // anything written while this run was scanning fell into neither this run's
  // result set nor the next run's `updatedAt > lastRunAt` window, and was simply
  // lost until the weekly full pass.
  const scanStartedAt = admin.firestore.Timestamp.now();

  // `teamMemberComp` is ONE extra collection read per run (not per member): pay
  // moved out of `teamMembers`, which the whole business may read. Dual read —
  // the comp document wins where it exists, the legacy fields are the fallback —
  // mirroring src/lib/finance/compensation.ts. Keep the two in sync.
  const [membersSnap, tsSnap, compSnap] = await Promise.all([
    db.collection('teamMembers').get(),
    db.collection('teamSettings').get(),
    db.collection('teamMemberComp').get(),
  ]);
  // Keyed by the document id AND by `{teamId}_{userId}` rebuilt from the row's own
  // fields: a legacy membership created with addDoc carries a random id, so
  // neither key alone can be trusted to match (see indexCompensation).
  const compByKey = new Map<string, any>();
  for (const d of compSnap.docs) {
    const c = d.data() as any;
    compByKey.set(d.id, c);
    const derived = `${c.teamId || ''}_${c.userId || ''}`;
    if (derived !== '_' && !compByKey.has(derived)) compByKey.set(derived, c);
  }
  const compFor = (memberId: string, d: any) =>
    compByKey.get(`${d.teamId || ''}_${d.userId || ''}`) || compByKey.get(memberId) || null;

  if (lastRunAt) {
    mode = 'incremental';
    // Which projects were touched? Anything with a new/edited time entry or
    // expense — PLUS anything explicitly flagged. The flag is how a DELETED
    // expense (or one whose projectId moved AWAY from a project) gets noticed at
    // all: there is no document left to carry an `updatedAt`, so the project
    // that lost the cost was never recomputed and its `spent` stayed inflated.
    const [touchedEntries, touchedExpenses, dirtyProjects] = await Promise.all([
      db.collection('timeEntries').where('updatedAt', '>', lastRunAt).get(),
      db.collection('expenses').where('updatedAt', '>', lastRunAt).get(),
      db.collection('projects').where('spendRollupDirty', '==', true).get(),
    ]);
    const projectIds = new Set<string>();
    for (const d of [...touchedEntries.docs, ...touchedExpenses.docs]) {
      const pid = (d.data() as any).projectId;
      if (pid) projectIds.add(String(pid));
    }
    for (const d of dirtyProjects.docs) projectIds.add(d.id);
    if (projectIds.size === 0) {
      await stateRef.set({ lastRunAt: scanStartedAt }, { merge: true });
      return { updated: 0, projects: 0, mode, skipped: 'no-changes' };
    }
    // Recompute those projects from their COMPLETE history (totals must stay absolute,
    // not deltas), reading only the slices that belong to them.
    const ids = Array.from(projectIds);
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += 10) chunks.push(ids.slice(i, i + 10)); // Firestore `in` cap
    const projectChunks = await Promise.all(
      chunks.map((c) => db.collection('projects').where(admin.firestore.FieldPath.documentId(), 'in', c).get()),
    );
    const entryChunks = await Promise.all(
      chunks.map((c) => db.collection('timeEntries').where('projectId', 'in', c).get()),
    );
    const expenseChunks = await Promise.all(
      chunks.map((c) => db.collection('expenses').where('projectId', 'in', c).get()),
    );
    projectDocs = projectChunks.flatMap((s) => s.docs);
    entryDocs = entryChunks.flatMap((s) => s.docs);
    expenseDocs = expenseChunks.flatMap((s) => s.docs);
  } else {
    const [projectsSnapFull, entriesSnapFull, expensesSnapFull] = await Promise.all([
      db.collection('projects').get(),
      db.collection('timeEntries').get(),
      db.collection('expenses').get(),
    ]);
    projectDocs = projectsSnapFull.docs;
    entryDocs = entriesSnapFull.docs;
    expenseDocs = expensesSnapFull.docs;
  }

  const projectsSnap = { docs: projectDocs, size: projectDocs.length };
  const entriesSnap = { docs: entryDocs };
  const expensesSnap = { docs: expenseDocs };

  // Per-team exchange rates (admin-set) so `spent` matches the client's toAll().
  const ratesByTeam = new Map<string, Record<string, number>>();
  for (const d of tsSnap.docs) {
    const s = d.data();
    const eur = parseFloat(s.eurAllRate);
    const usd = parseFloat(s.usdAllRate);
    ratesByTeam.set(d.id, {
      ...DEFAULT_RATES,
      EUR: eur > 0 ? eur : DEFAULT_RATES.EUR,
      USD: usd > 0 ? usd : DEFAULT_RATES.USD,
    });
  }
  const toAllServer = (amount: number, currency?: string, teamId?: string) => {
    const rates = (teamId && ratesByTeam.get(teamId)) || DEFAULT_RATES;
    return (amount || 0) * (rates[(currency || 'ALL').toUpperCase()] ?? 1);
  };

  const costByUser = new Map<string, number>();
  for (const m of membersSnap.docs) {
    const d = m.data();
    // Dual read: the comp document states a field or says nothing about it
    // (`undefined`); an explicit `null` is a deliberate clear and must NOT fall
    // back to the legacy value (mergeMemberCompensation has the same rule).
    const c = compFor(m.id, d) || {};
    const hourly = c.hourlyCostRate === undefined ? d.hourlyCostRate : (c.hourlyCostRate ?? undefined);
    const salary = c.monthlySalary === undefined ? d.monthlySalary : (c.monthlySalary ?? undefined);
    const rate = (hourly && hourly > 0)
      ? hourly
      : (salary && salary > 0 ? salary / 160 : 0);
    if (d.userId) costByUser.set(d.userId, rate);
  }
  const billByUser = new Map<string, number>();
  for (const m of membersSnap.docs) {
    const d = m.data();
    if (d.userId) billByUser.set(d.userId, (d.hourlyBillRate && d.hourlyBillRate > 0) ? d.hourlyBillRate : (costByUser.get(d.userId) || 0));
  }

  const labor = new Map<string, { cost: number; billableValue: number; hours: number }>();
  for (const doc of entriesSnap.docs) {
    const e = doc.data();
    if (!e.projectId) continue;
    const h = entryHours(e);
    if (h <= 0) continue;
    const agg = labor.get(e.projectId) || { cost: 0, billableValue: 0, hours: 0 };
    agg.cost += h * (costByUser.get(e.userId) || 0);
    agg.hours += h;
    if (e.isBillable) agg.billableValue += h * ((e.hourlyRate && e.hourlyRate > 0) ? e.hourlyRate : (billByUser.get(e.userId) || 0));
    labor.set(e.projectId, agg);
  }

  const expByProject = new Map<string, number>();
  for (const doc of expensesSnap.docs) {
    const x = doc.data();
    if (!x.projectId) continue;
    if (x.category === 'Salary') continue;              // salary is not a project-direct cost (matches projectPnl)
    if (x.approvalStatus === 'Rejected') continue;      // rejected expenses never hit the books
    expByProject.set(x.projectId, (expByProject.get(x.projectId) || 0) + toAllServer(Number(x.amount) || 0, x.currency, x.teamId));
  }

  const now = admin.firestore.Timestamp.now();
  let updated = 0;
  const ops: Promise<any>[] = [];
  for (const doc of projectsSnap.docs) {
    const p = doc.data();
    const l = labor.get(doc.id) || { cost: 0, billableValue: 0, hours: 0 };
    const spent = Math.round(l.cost + (expByProject.get(doc.id) || 0));
    const laborCost = Math.round(l.cost);
    const billableValue = Math.round(l.billableValue);
    const loggedHours = Math.round(l.hours * 10) / 10;
    const changed = (p.spent || 0) !== spent
      || (p.laborCost || 0) !== laborCost
      || (p.billableValue || 0) !== billableValue;
    // Clear the recompute flag even when nothing changed, or the project stays
    // in the dirty set and is re-read on every single run from now on.
    if (changed || p.spendRollupDirty) {
      // Deliberately NOT touching `updatedAt`: projectPnl.projectDate() falls back
      // to it to decide which period a project belongs to, so bumping it here made
      // a single logged hour drag an un-completed one-time project into the current
      // month's P&L (and out of the month it was actually delivered in).
      ops.push(doc.ref.update({
        spent, laborCost, billableValue, loggedHours,
        spendRolledUpAt: now,
        spendRollupDirty: admin.firestore.FieldValue.delete(),
      }));
      if (changed) updated++;
    }
  }
  await settleAll(ops, 'project-spend-rollup');
  await stateRef.set(
    mode === 'full'
      ? { lastRunAt: scanStartedAt, lastFullRunAt: scanStartedAt }
      : { lastRunAt: scanStartedAt },
    { merge: true },
  );
  return { updated, projects: projectsSnap.size, mode };
}

// ── Social media analytics — monthly pull ────────────────────────────────────
// Triggered once a month (VPS scheduler fires it late on the last day of the
// month). Pulls Facebook/Instagram insights for every connected account and
// writes ONE socialSnapshots doc per account → negligible Firebase cost.
// Accepts ?period=YYYY-MM to backfill a specific month (defaults to current).
async function runSocialMonthlySync(period?: string, opts?: { email?: boolean }): Promise<Record<string, unknown>> {
  const p = period && /^\d{4}-\d{2}$/.test(period) ? period : currentPeriod();
  const results = await syncAllAccounts(p);
  const ok = results.filter((r) => !r.error).length;
  const failed = results.filter((r) => r.error);
  if (failed.length) console.error(`[CRON:social-monthly-sync] ${failed.length} dështuan:`, failed);
  // After the pull, email each client their monthly report (client only). Skipped
  // when explicitly disabled (?email=0) so a manual re-sync doesn't re-notify.
  let email: { sent: number; skipped: number; failed: number } | undefined;
  if (opts?.email !== false) {
    email = await sendReportsForPeriod(p);
  }
  return { period: p, accounts: results.length, synced: ok, failed: failed.length, email };
}

/**
 * Persist one job execution to `platformJobRuns` (super-admin readable, client-write
 * denied). Before this, a manual run reported into a toast that vanished: there was no
 * way to answer "did the migration run, when, and what did it change?".
 *
 * Kept small and best-effort — recording must never fail the job it records.
 */
async function recordJobRun(entry: {
  job: string;
  ok: boolean;
  ms: number;
  actorUid: string | null;
  manual: boolean;
  dryRun: boolean;
  summary?: Record<string, unknown>;
  error?: string;
}) {
  try {
    // Keep only scalar/short fields — a full result blob could be megabytes.
    const compact: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(entry.summary || {})) {
      if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') {
        compact[k] = typeof v === 'string' ? v.slice(0, 200) : v;
      } else if (Array.isArray(v)) {
        compact[k] = v.length;
      }
    }
    await db.collection('platformJobRuns').add({
      job: entry.job,
      ok: entry.ok,
      durationMs: entry.ms,
      actorUid: entry.actorUid,
      manual: entry.manual,
      dryRun: entry.dryRun,
      summary: compact,
      ...(entry.error ? { error: entry.error.slice(0, 500) } : {}),
      createdAt: admin.firestore.Timestamp.now(),
    });
  } catch { /* history is a convenience, never a dependency */ }
}

// ── Main handler ──────────────────────────────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const isManual = req.query.manual === '1';
  if (isManual) {
    const authError = await authorizeManual(req);
    if (authError) return res.status(401).json({ error: `Unauthorized: ${authError}` });
  } else {
    if (!authorize(req)) return res.status(401).json({ error: 'Unauthorized' });
  }

  const job = req.query.job as string;
  const startedAt = Date.now();
  const actorUid = await callerUid(req);

  try {
    let result: Record<string, unknown>;

    switch (job) {
      case 'task-deadline-alerts':
        result = await runTaskDeadlineAlerts();
        break;
      case 'task-reminders':
        result = await runTaskReminders();
        break;
      case 'invoice-reminders': {
        // Any job that SENDS something to a customer runs inside ONE tenant when
        // it is triggered by hand — see `recurring-invoices` below for the law.
        const scopeId = await manualScopeId(req, isManual);
        if (scopeId === MANUAL_SCOPE_UNRESOLVED) {
          return res.status(403).json({ error: 'Nuk u përcaktua biznesi i përdoruesit — kujtesat manuale u ndalën.' });
        }
        result = await runInvoiceReminders({ businessId: scopeId });
        break;
      }
      case 'recurring-tasks':
        result = await runRecurringTasks();
        break;
      case 'recurring-invoices': {
        // Manual = one tenant's Admin pressing the button: scope it to their
        // business unless they are a platform super-admin. The scheduled cron
        // (no Authorization header) keeps running for everyone.
        let scopeId: string | null = null;
        if (isManual && !(await callerIsSuperAdmin(req))) {
          scopeId = await callerBusinessId(req);
          if (!scopeId) {
            return res.status(403).json({ error: 'Nuk u përcaktua biznesi i përdoruesit — gjenerimi manual u ndal.' });
          }
        }
        result = await runRecurringInvoices({ businessId: scopeId });
        break;
      }
      case 'backfill-businessid':
        result = await runBackfillBusinessId({ reset: req.query.reset === '1' });
        break;
      case 'set-superadmin-claim':
        result = await runSetSuperAdminClaim(req);
        break;
      case 'backfill-portal-customerid':
        result = await runBackfillPortalCustomerId();
        break;
      case 'backfill-member-keys': {
        // Destructive re-key migration — restrict to a super-admin claim (not any
        // team Admin), even though it's a manual trigger. The scheduled cron path
        // (CRON_SECRET) is trusted and also allowed.
        if (isManual && !(await callerIsSuperAdmin(req))) {
          return res.status(403).json({ error: 'Forbidden: super-admin claim required' });
        }
        result = await runBackfillMemberKeys({ dryRun: req.query.dryRun === '1' });
        break;
      }
      case 'backfill-member-compensation': {
        // Reads every tenant's pay, so super-admin only — same gate as
        // tenant-export / backfill-member-keys. Idempotent; safe to run twice.
        if (isManual && !(await callerIsSuperAdmin(req))) {
          return res.status(403).json({ error: 'Forbidden: super-admin claim required' });
        }
        result = await runBackfillMemberCompensation({ dryRun: req.query.dryRun === '1' });
        break;
      }
      case 'backfill-customerid':
        result = await runBackfillCustomerId({ reset: req.query.reset === '1' });
        break;
      // ── Tenant-isolation hardening jobs (super-admin only: they rewrite tenant
      // keys, move credentials and mint custom claims across the whole platform) ──
      case 'subscription-lifecycle':
        result = await runSubscriptionLifecycle({ dryRun: req.query.dryRun === '1' });
        break;
      // ── Platform console analytics (super-admin only: they read across tenants) ──
      case 'tenant-usage-rollup': {
        if (isManual && !(await callerIsSuperAdmin(req))) {
          return res.status(403).json({ error: 'Forbidden: super-admin claim required' });
        }
        result = await runTenantUsageRollup({ dryRun: req.query.dryRun === '1' });
        break;
      }
      case 'platform-metrics-rollup': {
        if (isManual && !(await callerIsSuperAdmin(req))) {
          return res.status(403).json({ error: 'Forbidden: super-admin claim required' });
        }
        result = await runPlatformMetricsRollup({
          dryRun: req.query.dryRun === '1',
          month: typeof req.query.month === 'string' ? req.query.month : undefined,
          backfill: req.query.backfill === '1',
        });
        break;
      }
      // ── GDPR/DPA: export or erase one tenant. Super-admin only; delete also
      // requires confirm=<businessId> so it can never fire by accident. ──
      case 'tenant-export': {
        if (isManual && !(await callerIsSuperAdmin(req))) {
          return res.status(403).json({ error: 'Forbidden: super-admin claim required' });
        }
        result = await runTenantExport(String(req.query.businessId || ''), {
          maxDocs: req.query.maxDocs ? Number(req.query.maxDocs) : undefined,
        });
        break;
      }
      case 'tenant-delete': {
        if (isManual && !(await callerIsSuperAdmin(req))) {
          return res.status(403).json({ error: 'Forbidden: super-admin claim required' });
        }
        result = await runTenantDelete(
          String(req.query.businessId || ''),
          String(req.query.confirm || ''),
          { dryRun: req.query.dryRun === '1' },
        );
        break;
      }
      case 'migrate-team-secrets': {
        if (isManual && !(await callerIsSuperAdmin(req))) {
          return res.status(403).json({ error: 'Forbidden: super-admin claim required' });
        }
        result = await runMigrateTeamSecrets({ dryRun: req.query.dryRun === '1' });
        break;
      }
      case 'tenant-hierarchy': {
        if (isManual && !(await callerIsSuperAdmin(req))) {
          return res.status(403).json({ error: 'Forbidden: super-admin claim required' });
        }
        result = await runTenantHierarchy({ dryRun: req.query.dryRun === '1' });
        break;
      }
      case 'backfill-tenant-keys': {
        if (isManual && !(await callerIsSuperAdmin(req))) {
          return res.status(403).json({ error: 'Forbidden: super-admin claim required' });
        }
        result = await runBackfillTenantKeys({ dryRun: req.query.dryRun === '1' });
        break;
      }
      case 'sync-tenant-claims': {
        if (isManual && !(await callerIsSuperAdmin(req))) {
          return res.status(403).json({ error: 'Forbidden: super-admin claim required' });
        }
        result = await runSyncTenantClaims({ dryRun: req.query.dryRun === '1' });
        break;
      }
      case 'project-completion-reminder':
        result = await runProjectCompletionReminder();
        break;
      case 'recurring-project-reset':
        result = await runRecurringProjectReset();
        break;
      case 'goal-overdue-alerts':
        result = await runGoalOverdueAlerts();
        break;
      case 'recurring-expenses': {
        const scopeId = await manualScopeId(req, isManual);
        if (scopeId === MANUAL_SCOPE_UNRESOLVED) {
          return res.status(403).json({ error: 'Nuk u përcaktua biznesi i përdoruesit — gjenerimi manual u ndal.' });
        }
        result = await runRecurringExpenses({ businessId: scopeId });
        break;
      }
      case 'expire-invitations':
        result = await runExpireInvitations();
        break;
      case 'lead-follow-up-reminders': {
        // Leads + customers due today/overdue → owner. 08:30 Europe/Tirane from
        // the VPS, NOT in run-all. A manual run ("Ekzekuto tani") is scoped to the
        // caller's tenant unless they are a platform super-admin.
        let scopeId: string | null = null;
        if (isManual && !(await callerIsSuperAdmin(req))) {
          scopeId = await callerBusinessId(req);
          if (!scopeId) {
            return res.status(403).json({ error: 'Nuk u përcaktua biznesi i përdoruesit — ekzekutimi manual u ndal.' });
          }
        }
        result = await runFollowUpReminders({ businessId: scopeId });
        break;
      }
      case 'whatsapp-broadcasts':
        result = await runWhatsappBroadcasts();
        break;
      // Evergreen dormancy rules. NOT in run-all — schedule it once a day so an
      // always-on sender can never fire several times an hour.
      case 'whatsapp-automations':
        result = await runWhatsappAutomations();
        break;
      case 'email-campaigns':
        result = await runEmailCampaigns();
        break;
      case 'purchase-campaigns':
        result = await runPurchaseCampaigns();
        break;
      case 'campaign-steps':
        result = await runCampaignSteps();
        break;
      case 'lead-sla-stale-alerts':
        result = await runLeadSlaAndStaleAlerts();
        break;
      case 'conversation-sla':
        // Unanswered WhatsApp threads past the tenant's response SLA. Every 15 min
        // from the VPS, NOT in run-all (a wall-clock promise, like task-reminders).
        result = await runConversationSla();
        break;
      case 'lead-wa-auto-reminders':
        result = await runLeadWhatsappAutoReminders();
        break;
      case 'overdue-reminders': {
        const scopeId = await manualScopeId(req, isManual);
        if (scopeId === MANUAL_SCOPE_UNRESOLVED) {
          return res.status(403).json({ error: 'Nuk u përcaktua biznesi i përdoruesit — kujtesat manuale u ndalën.' });
        }
        result = await runOverdueReminders({ businessId: scopeId });
        break;
      }
      case 'whmcs-sync':
        result = await runWhmcsSync();
        break;
      case 'whmcs-clients':
        result = await runWhmcsClientSync();
        break;
      case 'cleanup-old-notifications':
        result = await runCleanupOldNotifications();
        break;
      case 'notification-digest':
        result = await runNotificationDigest();
        break;
      case 'daily-report-check':
        // Deliberately NOT part of run-all: it is time-of-day sensitive and must be
        // scheduled at ~17:35 (stage=remind) and ~18:35 (stage=escalate).
        result = await runDailyReportCheck({
          stage: req.query.stage === 'escalate' ? 'escalate' : 'remind',
          businessId: (req.query.businessId as string) || undefined,
          date: (req.query.date as string) || undefined,
        });
        break;
      case 'inquiry-materials-reminders':
        result = await runInquiryMaterialsReminders();
        break;
      case 'project-spend-rollup':
        result = await runProjectSpendRollup({ full: req.query.full === '1' });
        break;
      case 'lead-cadence-steps':
        result = await runLeadCadenceSteps();
        break;
      case 'hosting-lifecycle': {
        // Hosting & domains: renewal invoices, suspend/terminate on non-payment, domain
        // renewals at the registrar, provisioning of orders paid by hand. Hourly from
        // the VPS, NOT in run-all (it messages customers and touches live servers). A
        // manual run is scoped to the caller's tenant.
        let scopeId: string | null = null;
        if (isManual && !(await callerIsSuperAdmin(req))) {
          scopeId = await callerBusinessId(req);
          if (!scopeId) return res.status(403).json({ error: 'Nuk u përcaktua biznesi i përdoruesit — ekzekutimi manual u ndal.' });
        }
        result = await runHostingLifecycle({ businessId: scopeId });
        break;
      }
      case 'hosting-sync': {
        // Server health + registrar facts (expiry, NS, completed transfers), disk/drift
        // alerts, weekly TLD wholesale-cost refresh. Read-mostly.
        let scopeId: string | null = null;
        if (isManual && !(await callerIsSuperAdmin(req))) {
          scopeId = await callerBusinessId(req);
          if (!scopeId) return res.status(403).json({ error: 'Nuk u përcaktua biznesi i përdoruesit — ekzekutimi manual u ndal.' });
        }
        result = await runHostingSync({ businessId: scopeId });
        break;
      }
      case 'hosting-backups': {
        // Scheduled pkgacct backups, a couple of the most overdue accounts per run.
        let scopeId: string | null = null;
        if (isManual && !(await callerIsSuperAdmin(req))) {
          scopeId = await callerBusinessId(req);
          if (!scopeId) return res.status(403).json({ error: 'Nuk u përcaktua biznesi i përdoruesit — ekzekutimi manual u ndal.' });
        }
        result = await runHostingBackups({ businessId: scopeId });
        break;
      }
      case 'hosting-expiry-report': {
        // Weekly digest (Mondays 08:00 local from the VPS) to each tenant's managers.
        let scopeId: string | null = null;
        if (isManual && !(await callerIsSuperAdmin(req))) {
          scopeId = await callerBusinessId(req);
          if (!scopeId) return res.status(403).json({ error: 'Nuk u përcaktua biznesi i përdoruesit — ekzekutimi manual u ndal.' });
        }
        result = await runHostingExpiryReport({ businessId: scopeId });
        break;
      }
      case 'crm-automations': {
        // CRM automation rules (CRM → Automatizime). Hourly from the VPS, NOT in
        // run-all. A manual run ("Ekzekuto tani" in the builder) is scoped to the
        // caller's tenant — the job assigns, emails and creates tasks, so an
        // unscoped manual run would let one tenant's Admin act inside every other.
        let scopeId: string | null = null;
        if (isManual && !(await callerIsSuperAdmin(req))) {
          scopeId = await callerBusinessId(req);
          if (!scopeId) {
            return res.status(403).json({ error: 'Nuk u përcaktua biznesi i përdoruesit — ekzekutimi manual u ndal.' });
          }
        }
        result = await runCrmAutomations({
          businessId: scopeId,
          ruleId: (req.query.ruleId as string) || null,
          dryRun: req.query.dryRun === '1',
        });
        break;
      }
      case 'report-schedules':
        // Generate draft reports from active schedules. Idempotent via generationKey.
        result = await runReportSchedules();
        break;
      case 'report-reminders':
        // Deadline reminders + the overdue escalation ladder. Each rung fires once.
        result = await runReportReminders();
        break;
      case 'client-health-rollup':
        // Persist a client-health snapshot per tenant per month (trend history).
        result = await runClientHealthRollup();
        break;
      case 'report-metrics-social':
        // socialSnapshots → reportMetrics, so the monthly client report can carry
        // real social figures. Additive: /app/social keeps its own email.
        result = await runReportMetricsSocial(req.query.period as string | undefined);
        break;
      case 'social-monthly-sync':
        result = await runSocialMonthlySync(req.query.period as string | undefined, { email: req.query.email !== '0' });
        break;
      case 'gmb-sync': {
        // Google Reviews pull for every connected location (hourly, VPS-scheduled).
        // Scoped reads only: gmbAccounts where connected==true, then per-page
        // bounded diffs — writes are proportional to actual review change. Runs
        // under a time budget; a truncated run reports `skipped` and those
        // accounts go FIRST next hour (ordered by lastSyncedAt asc).
        const { results: gmbResults, skipped } = await syncAllGmbAccounts();
        const failed = gmbResults.filter((r) => r.error);
        if (failed.length) console.error(`[CRON:gmb-sync] ${failed.length} dështuan:`, failed);
        result = {
          locations: gmbResults.length,
          synced: gmbResults.filter((r) => !r.error).length,
          created: gmbResults.reduce((a, r) => a + (r.created || 0), 0),
          deleted: gmbResults.reduce((a, r) => a + (r.deleted || 0), 0),
          autoReplied: gmbResults.reduce((a, r) => a + (r.autoReplied || 0), 0),
          failed: failed.length,
          skipped,
        };
        break;
      }
      case 'run-all': {
        // `run-all` is the PLATFORM's scheduled tick: every job inside it runs
        // unscoped, across all tenants. That is correct for the cron (no
        // Authorization header, `authorize()` with CRON_SECRET) and a hole for a
        // manual trigger — `authorizeManual` accepts any Admin/Owner of any
        // team, so a tenant pressing this would have side-stepped every
        // per-job tenant scope below it and mailed every tenant's customers.
        if (isManual && !(await callerIsSuperAdmin(req))) {
          return res.status(403).json({ error: 'run-all është punë e platformës — nisni punët një nga një nga Cilësimet.' });
        }
        // Single daily cron that runs all jobs — works within Vercel Hobby 2-cron limit
        const [tasks, invoiceRem, overdueRem, recurTasks, recurInv, projCompl, projReset, goals, expenses, invites, leadSla, leadWaAuto, digest, waBroadcasts, emailCampaigns, purchaseCampaigns, campaignSteps, whmcs, inquiryReminders, projectRollup, leadCadence, subscriptions, reportSchedules, reportReminders, tenantUsage, platformMetricsRun, notifCleanup] = await Promise.allSettled([
          runTaskDeadlineAlerts(),
          runInvoiceReminders(),
          runOverdueReminders(),
          runRecurringTasks(),
          runRecurringInvoices(),
          runProjectCompletionReminder(),
          runRecurringProjectReset(),
          runGoalOverdueAlerts(),
          runRecurringExpenses(),
          runExpireInvitations(),
          // lead-follow-up-reminders is NOT here: it fires at 08:30 Europe/Tirane
          // from the VPS scheduler (a wall-clock promise, like task-reminders).
          runLeadSlaAndStaleAlerts(),
          runLeadWhatsappAutoReminders(),
          runNotificationDigest(),
          runWhatsappBroadcasts(),
          runEmailCampaigns(),
          runPurchaseCampaigns(),
          runCampaignSteps(),
          runWhmcsSync(),
          runInquiryMaterialsReminders(),
          runProjectSpendRollup(),
          runLeadCadenceSteps(),
          runSubscriptionLifecycle(),
          runReportSchedules(),
          runReportReminders(),
          runTenantUsageRollup(),
          runPlatformMetricsRollup(),
          // Retention used to hang off the VPS scheduler ALONE — if PM2 was down,
          // purging silently stopped and the collection only ever grew (which is
          // what made the digest's scans expensive). Paged + budgeted, so a second
          // daily run is cheap; deletes are idempotent.
          runCleanupOldNotifications(),
        ]);
        const settled = (r: PromiseSettledResult<any>) =>
          r.status === 'fulfilled' ? r.value : { error: (r.reason as Error)?.message || 'failed' };
        result = {
          tasks: settled(tasks),
          invoiceReminders: settled(invoiceRem),
          overdueReminders: settled(overdueRem),
          recurringTasks: settled(recurTasks),
          recurringInvoices: settled(recurInv),
          projectCompletionReminder: settled(projCompl),
          projectReset: settled(projReset),
          goalAlerts: settled(goals),
          recurringExpenses: settled(expenses),
          invites: settled(invites),
          leadSlaStale: settled(leadSla),
          leadWaAutoReminders: settled(leadWaAuto),
          digest: settled(digest),
          whatsappBroadcasts: settled(waBroadcasts),
          emailCampaigns: settled(emailCampaigns),
          purchaseCampaigns: settled(purchaseCampaigns),
          campaignSteps: settled(campaignSteps),
          whmcsSync: settled(whmcs),
          inquiryMaterialsReminders: settled(inquiryReminders),
          projectSpendRollup: settled(projectRollup),
          leadCadenceSteps: settled(leadCadence),
          subscriptions: settled(subscriptions),
          tenantUsage: settled(tenantUsage),
          platformMetrics: settled(platformMetricsRun),
          reportSchedules: settled(reportSchedules),
          reportReminders: settled(reportReminders),
          notificationCleanup: settled(notifCleanup),
        };
        break;
      }
      default:
        return res.status(400).json({ error: `Job i panjohur: "${job}". Vlerat e vlefshme: run-all, task-deadline-alerts, task-reminders, invoice-reminders, recurring-tasks, recurring-invoices, project-completion-reminder, recurring-project-reset, notification-digest, daily-report-check, whatsapp-broadcasts, whatsapp-automations, email-campaigns, purchase-campaigns, campaign-steps, whmcs-sync, whmcs-clients, report-schedules, report-reminders, client-health-rollup, report-metrics-social, gmb-sync, hosting-lifecycle, hosting-sync, hosting-backups, hosting-expiry-report` });
    }

    await recordJobRun({
      job, ok: true, ms: Date.now() - startedAt, actorUid, manual: isManual,
      dryRun: req.query.dryRun === '1', summary: result as Record<string, unknown>,
    });
    return res.status(200).json({ success: true, job, ...result, timestamp: new Date().toISOString() });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Gabim i panjohur';
    console.error(`[CRON] Gabim në job "${job}":`, err);
    await recordJobRun({
      job, ok: false, ms: Date.now() - startedAt, actorUid, manual: isManual,
      dryRun: req.query.dryRun === '1', error: msg,
    });
    return res.status(500).json({ error: msg, job });
  }
}
