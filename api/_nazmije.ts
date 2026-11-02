import type { VercelRequest, VercelResponse } from '@vercel/node';
import admin, { adminDb as db } from './_firebaseAdmin.js';
import {
  authenticate, activeMembership, businessIdOfTeam, hasAdminRole, isBusinessOwner, isPortalOnlyToken,
} from './_callerIdentity.js';
import { checkPersistentRateLimit } from './_rateLimit.js';
import { generateChatWith, resolveAiConfig, type ChatMsg } from './_aiProvider.js';
import { classifyAiError } from './_aiErrors.js';
import { notifyUser } from './_push.js';
import {
  NAZMIJE_AVATAR_PATH, NAZMIJE_LIMITS, NAZMIJE_TITLE, NAZMIJE_UID,
  albanianDateLabel, buildAfternoonDigest, buildMorningDigest, buildNazmijePrompt, buildWeeklyDigest,
  dayIndexOf, factsForAudience, humorLineForDay, humorModeFor, localParts, addressesNazmije, mondayOf,
  nazmijeBlockReason, nazmijePostDocId, nazmijeProfileDocId, nazmijeRoleOf, renderFactsForPrompt,
  resolveNazmijeSettings, sanitizeReply,
  type HumorMode, type NazmijeBlockReason, type NazmijeFacts, type NazmijeKind, type NazmijeRole, type NazmijeSettings,
  type PersonCount, type ProjectFact, type TaskFact,
} from './_nazmijeCore.js';

/**
 * Nazmije — the team's virtual secretary. Server side.
 *
 *   POST /api/nazmije  (?type=nazmije)   body.action:
 *     'ask'     — a staff member spoke to her: a DM (`text`, server writes BOTH rows)
 *                 or an @mention in a group (`messageId`, the browser wrote the row).
 *     'enable'  — Admin/owner switches her on for a team (profile, channel, settings, hello).
 *     'disable' — switches her off (nothing is deleted).
 *
 *   runNazmijeDigest(kind) — the scheduled posts (api/cron/run.ts → nazmije-morning /
 *   nazmije-afternoon / nazmije-weekly, from vps/server.ts, NOT in run-all).
 *
 * Laws enforced HERE (the core decides, this file only fetches and executes):
 *   • she has no Auth user and no teamMembers row — every message with
 *     `senderId: 'nazmije'` is written by this file through `postAsNazmije()`, and the
 *     rules refuse that senderId from any browser;
 *   • facts are read per tenant, scoped by businessId/teamId and capped (the cost
 *     rule), and filtered by the asker's ROLE and the AUDIENCE before the prompt;
 *   • the AI key is the tenant's (resolveAiConfig) — the platform key only for a caller
 *     with a proven staff tenant, like ai-chat;
 *   • every non-reply is a named NazmijeBlockReason, returned to the caller and (for
 *     digests) stamped on `teamSettings.nazmije.lastRun`.
 */

const TZ = 'Europe/Tirane';
const OPEN_TASK_STATUSES = ['Todo', 'In Progress', 'Review'];
const LIVE_PROJECT_STATUSES = ['Planning', 'Active', 'In Review', 'On Hold'];
const OPEN_LEAD_STATUSES = ['New', 'Contacted', 'Qualified', 'Follow-up', 'Proposal'];
const WON_LEAD_STATUSES = ['Won', 'Converted'];
const UNPAID_INVOICE_STATUSES = ['Pending', 'Overdue', 'Partial'];
const MAX_GROUP_FANOUT = 200;

/** Deterministic lines for the blocks a person should hear about (never silent in a DM). */
const BLOCK_REPLIES: Partial<Record<NazmijeBlockReason, string>> = {
  'no-ai-key': 'Më mungon çelësi AI, prandaj sot jam vetëm listë, jo bisedë. Admini e vendos te Cilësimet → Integrimet → FivoAI.',
  'rate-limited': 'Ngadalë — 20 pyetje në orë janë kufiri im. Pi një kafe dhe kthehu. ☕',
  'daily-cap': 'Për sot e kam mbushur kuotën e përgjigjeve. Nesër jam prapë e para në zyrë.',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function toMs(v: unknown): number | null {
  if (!v) return null;
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v.getTime() : null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') { const t = Date.parse(v); return Number.isFinite(t) ? t : null; }
  const o = v as { toMillis?: () => number; toDate?: () => Date; seconds?: number };
  if (typeof o.toMillis === 'function') return o.toMillis();
  if (typeof o.toDate === 'function') return o.toDate().getTime();
  if (typeof o.seconds === 'number') return o.seconds * 1000;
  return null;
}

/** YYYY-MM-DD in the office zone for any timestamp-ish value. */
function dateKeyOf(v: unknown): string | null {
  const ms = toMs(v);
  return ms === null ? null : localParts(new Date(ms), TZ).date;
}

function zoneOffsetMinutes(at: Date): number {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'longOffset' })
    .formatToParts(at).find(p => p.type === 'timeZoneName')?.value || 'GMT';
  const m = /GMT([+-])(\d{1,2})(?::?(\d{2}))?/.exec(name);
  if (!m) return 0;
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] || 0));
}

/** UTC instant of local midnight for a YYYY-MM-DD key. */
function zonedMidnightMs(dateKey: string): number {
  const [y, mo, d] = dateKey.split('-').map(Number);
  const guess = Date.UTC(y, mo - 1, d);
  return guess - zoneOffsetMinutes(new Date(guess)) * 60_000;
}

const str = (v: unknown, max = 200): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

async function readJsonBody(req: VercelRequest): Promise<Record<string, any> | null> {
  let body: any = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { return null; } }
  return body && typeof body === 'object' ? body : {};
}

const dmThreadId = (a: string, b: string) => [a, b].sort().join('__');
const dmTypingKey = (uid: string) => `dm-${[uid, NAZMIJE_UID].sort().join('-')}`;

interface TenantCtx {
  teamId: string;
  businessId: string;
  tenantName: string;
  tenantStatus: string | null;
  settings: NazmijeSettings;
}

async function loadTenantCtx(teamId: string, businessIdHint?: string | null): Promise<TenantCtx | null> {
  const [teamSnap, settingsSnap] = await Promise.all([
    db.collection('teams').doc(teamId).get(),
    db.collection('teamSettings').doc(teamId).get(),
  ]);
  const team = teamSnap.exists ? (teamSnap.data() as any) : null;
  const businessId = (typeof team?.businessId === 'string' && team.businessId) || businessIdHint || (await businessIdOfTeam(teamId).catch(() => ''));
  if (!businessId) return null;
  const biz = await db.collection('businesses').doc(businessId).get().catch(() => null);
  const bizData = biz?.exists ? (biz.data() as any) : null;
  return {
    teamId,
    businessId,
    tenantName: str(bizData?.name) || str(team?.name) || 'ekipi',
    tenantStatus: typeof bizData?.status === 'string' ? bizData.status : null,
    settings: resolveNazmijeSettings(settingsSnap.exists ? (settingsSnap.data() as any)?.nazmije : null),
  };
}

// ── People ────────────────────────────────────────────────────────────────────

interface People { names: Map<string, string>; activeUids: string[] }

async function loadPeople(businessId: string): Promise<People> {
  const names = new Map<string, string>();
  const activeUids: string[] = [];
  const members = await db.collection('teamMembers').where('businessId', '==', businessId).where('status', '==', 'Active').get();
  const seen = new Set<string>();
  members.docs.forEach(d => {
    const m = d.data() as any;
    const uid = str(m.userId, 128);
    if (!uid || m.isBot) return;
    const name = str(m.displayName, 60) || str(m.email, 120).split('@')[0];
    if (name && !names.has(uid)) names.set(uid, name);
    if (!seen.has(uid)) { seen.add(uid); activeUids.push(uid); }
  });
  try {
    const profiles = await db.collection('userProfiles').where('businessId', '==', businessId).limit(300).get();
    profiles.docs.forEach(d => {
      const p = d.data() as any;
      const uid = str(p.userId, 128);
      const name = str(p.displayName, 60);
      if (uid && name && uid !== NAZMIJE_UID) names.set(uid, name);
    });
  } catch { /* names from memberships are enough */ }
  return { names, activeUids };
}

const nameOf = (people: People, uid: unknown): string => {
  const id = str(uid, 128);
  if (!id) return 'Pa përgjegjës';
  return people.names.get(id) || `Koleg (${id.slice(0, 5)})`;
};

// ── Facts (every read scoped + capped; a failed source is null, never "0") ────

/**
 * What an invoice still owes, in its own currency. MIRRORS
 * `getInvoiceOutstandingAll()` in src/lib/finance/financialAnalytics.ts (api/
 * cannot import src/): Paid / Draft / Cancelled owe nothing; otherwise total −
 * collected, where collected = Σ `partialPayments` when there are any, else
 * `paidAmount` — for EVERY unpaid status. The old inline sum added both (double
 * counting) and subtracted them only for `Partial`, so an Overdue invoice with
 * an instalment reported its full total as owed.
 */
function invoiceOutstanding(inv: any): number {
  const status = String(inv?.status || '');
  if (status === 'Paid' || status === 'Draft' || status === 'Cancelled') return 0;
  const gross = Number(inv?.total ?? inv?.amount) || 0;
  const instalments = Array.isArray(inv?.partialPayments) ? inv.partialPayments : [];
  const collected = instalments.length
    ? instalments.reduce((s: number, p: any) => s + (Number(p?.amount) || 0), 0)
    : (Number(inv?.paidAmount) || 0);
  return Math.max(0, gross - collected);
}

export async function buildFacts(ctx: TenantCtx, now: Date, opts: { week?: boolean } = {}): Promise<NazmijeFacts> {
  const local = localParts(now, TZ);
  const todayIdx = dayIndexOf(local.date);
  const people = await loadPeople(ctx.businessId);
  const bid = ctx.businessId;

  // Open tasks — equality-only query (businessId + status in), served by merged single-field indexes.
  const openTasks: any[] = [];
  try {
    const snap = await db.collection('tasks').where('businessId', '==', bid).where('status', 'in', OPEN_TASK_STATUSES).limit(600).get();
    snap.docs.forEach(d => openTasks.push({ id: d.id, ...(d.data() as any) }));
  } catch (err) { console.error('[nazmije] tasks read failed', err); }

  // Live projects.
  const projectsRaw: any[] = [];
  try {
    const snap = await db.collection('projects').where('businessId', '==', bid).where('status', 'in', LIVE_PROJECT_STATUSES).limit(200).get();
    snap.docs.forEach(d => projectsRaw.push({ id: d.id, ...(d.data() as any) }));
  } catch (err) { console.error('[nazmije] projects read failed', err); }
  const projectName = new Map<string, string>(projectsRaw.map(p => [p.id, str(p.name, 80) || 'Projekt']));

  const toTaskFact = (t: any): TaskFact => {
    const due = dateKeyOf(t.endDate) || dateKeyOf(t.dueDate);
    return {
      id: t.id,
      title: str(t.title, 80) || 'Detyrë pa titull',
      assigneeName: nameOf(people, t.assignedToUserId),
      assigneeUid: str(t.assignedToUserId, 128) || null,
      due,
      daysLate: due ? Math.max(0, todayIdx - dayIndexOf(due)) : 0,
      priority: str(t.priority, 20) || null,
      projectName: t.projectId ? (projectName.get(String(t.projectId)) || null) : null,
    };
  };
  const dueToday: TaskFact[] = [];
  const overdue: TaskFact[] = [];
  const openByProject = new Map<string, { open: number; overdue: number }>();
  openTasks.forEach(t => {
    const f = toTaskFact(t);
    if (t.projectId) {
      const row = openByProject.get(String(t.projectId)) || { open: 0, overdue: 0 };
      row.open++;
      if (f.due && f.due < local.date) row.overdue++;
      openByProject.set(String(t.projectId), row);
    }
    if (!f.due) return;
    if (f.due === local.date) dueToday.push(f);
    else if (f.due < local.date) overdue.push(f);
  });
  overdue.sort((a, b) => (b.daysLate || 0) - (a.daysLate || 0));
  dueToday.sort((a, b) => a.assigneeName.localeCompare(b.assigneeName));

  const projects: ProjectFact[] = projectsRaw.map(p => {
    const endDate = dateKeyOf(p.endDate);
    const counts = openByProject.get(p.id) || { open: 0, overdue: 0 };
    return {
      id: p.id,
      name: projectName.get(p.id) || 'Projekt',
      status: str(p.status, 20),
      responsibleName: nameOf(people, p.responsibleUserId),
      openTasks: counts.open,
      overdueTasks: counts.overdue,
      endDate,
      daysLeft: endDate ? dayIndexOf(endDate) - todayIdx : null,
    };
  }).sort((a, b) => (a.daysLeft ?? 9999) - (b.daysLeft ?? 9999));

  // Done today — from the activity log (task_completed), per team, one range read on an existing index.
  let doneToday: PersonCount[] | null = null;
  const sinceToday = admin.firestore.Timestamp.fromMillis(zonedMidnightMs(local.date));
  try {
    const snap = await db.collection('activities').where('teamId', '==', ctx.teamId).where('createdAt', '>=', sinceToday)
      .orderBy('createdAt', 'desc').limit(400).get();
    const counts = new Map<string, number>();
    snap.docs.forEach(d => {
      const a = d.data() as any;
      if (a.type !== 'task_completed' || !a.userId) return;
      counts.set(String(a.userId), (counts.get(String(a.userId)) || 0) + 1);
    });
    doneToday = people.activeUids.map(uid => ({ uid, name: nameOf(people, uid), count: counts.get(uid) || 0 }));
    counts.forEach((count, uid) => { if (!people.activeUids.includes(uid)) doneToday!.push({ uid, name: nameOf(people, uid), count }); });
  } catch (err) { console.error('[nazmije] activities read failed', err); }

  // Daily reports for today.
  let reports: NazmijeFacts['reports'] = null;
  try {
    const snap = await db.collection('dailyReports').where('businessId', '==', bid).where('date', '==', local.date).get();
    const submittedUids = new Set<string>();
    snap.docs.forEach(d => { const uid = str((d.data() as any).userId, 128); if (uid) submittedUids.add(uid); });
    reports = {
      expected: people.activeUids.length,
      submitted: people.activeUids.filter(u => submittedUids.has(u)).map(u => nameOf(people, u)),
      missing: people.activeUids.filter(u => !submittedUids.has(u)).map(u => nameOf(people, u)),
    };
  } catch (err) { console.error('[nazmije] dailyReports read failed', err); }

  // Leads.
  let leads: NazmijeFacts['leads'] = null;
  const mondayKey = mondayOf(local.date);
  const mondayMs = zonedMidnightMs(mondayKey);
  let wonThisWeek = 0;
  try {
    const [open, won] = await Promise.all([
      db.collection('leads').where('businessId', '==', bid).where('status', 'in', OPEN_LEAD_STATUSES).limit(500).get(),
      db.collection('leads').where('businessId', '==', bid).where('status', 'in', WON_LEAD_STATUSES).limit(300).get(),
    ]);
    let newToday = 0, noNextStep = 0;
    open.docs.forEach(d => {
      const l = d.data() as any;
      if (dateKeyOf(l.createdAt) === local.date) newToday++;
      if (!l.nextFollowUpDate) noNextStep++;
    });
    won.docs.forEach(d => {
      const l = d.data() as any;
      const at = toMs(l.wonAt) ?? toMs(l.convertedAt) ?? toMs(l.updatedAt);
      if (at !== null && at >= mondayMs) wonThisWeek++;
    });
    leads = { newToday, noNextStep, wonThisWeek };
  } catch (err) { console.error('[nazmije] leads read failed', err); }

  // Finance (the core strips it for members / groups; it is read once here).
  let finance: NazmijeFacts['finance'] = null;
  try {
    const snap = await db.collection('invoices').where('businessId', '==', bid).where('status', 'in', UNPAID_INVOICE_STATUSES).limit(500).get();
    let overdueCount = 0, overdueAmountAll = 0, overdueAmountEur = 0, dueThisWeekCount = 0;
    const weekEndIdx = todayIdx + 7;
    snap.docs.forEach(d => {
      const inv = d.data() as any;
      const due = dateKeyOf(inv.dueDate);
      if (!due) return;
      const outstanding = invoiceOutstanding(inv);
      if (outstanding <= 0) return; // fully collected: owes nothing, is not "overdue"
      const dueIdx = dayIndexOf(due);
      if (dueIdx < todayIdx) {
        overdueCount++;
        if (inv.currency === 'EUR') overdueAmountEur += outstanding; else overdueAmountAll += outstanding;
      } else if (dueIdx < weekEndIdx) {
        dueThisWeekCount++;
      }
    });
    finance = { overdueCount, overdueAmountAll, overdueAmountEur, dueThisWeekCount };
  } catch (err) { console.error('[nazmije] invoices read failed', err); }

  // The week (weekly digest only).
  let week: NazmijeFacts['week'] = null;
  if (opts.week) {
    try {
      const sinceMonday = admin.firestore.Timestamp.fromMillis(mondayMs);
      const [acts, reps] = await Promise.all([
        db.collection('activities').where('teamId', '==', ctx.teamId).where('createdAt', '>=', sinceMonday).orderBy('createdAt', 'desc').limit(1500).get(),
        db.collection('dailyReports').where('businessId', '==', bid).where('date', '>=', mondayKey).limit(1000).get(),
      ]);
      const counts = new Map<string, number>();
      acts.docs.forEach(d => {
        const a = d.data() as any;
        if (a.type !== 'task_completed' || !a.userId) return;
        counts.set(String(a.userId), (counts.get(String(a.userId)) || 0) + 1);
      });
      const doneByPerson: PersonCount[] = Array.from(counts.entries()).map(([uid, count]) => ({ uid, name: nameOf(people, uid), count }));
      const doneTotal = doneByPerson.reduce((s, p) => s + p.count, 0);
      const workdaysElapsed = Math.min(5, Math.max(1, dayIndexOf(local.date) - dayIndexOf(mondayKey) + 1));
      week = {
        mondayKey,
        doneByPerson,
        doneTotal,
        leadsWon: wonThisWeek,
        reportsSubmitted: reps.docs.filter(d => { const r = d.data() as any; return r.date <= local.date && people.activeUids.includes(String(r.userId)); }).length,
        reportsExpected: people.activeUids.length * workdaysElapsed,
      };
    } catch (err) { console.error('[nazmije] week read failed', err); }
  }

  return {
    date: local.date,
    tenantName: ctx.tenantName,
    people: people.activeUids.map(uid => ({ uid, name: nameOf(people, uid) })),
    tasks: { dueToday, overdue, openTotal: openTasks.length, doneToday },
    projects,
    reports,
    leads,
    finance,
    week,
  };
}

// ── The ONE writer of her messages ────────────────────────────────────────────

export interface PostAsNazmijeInput {
  businessId: string;
  teamId: string;
  content: string;
  kind: NazmijeKind;
  channelId?: string | null;
  directUserId?: string | null;
  displayName: string;
  /** The person she is answering — skipped in the fan-out (they are reading the thread). */
  actorUserId?: string | null;
  /** Reply to this row (ChatView renders the quote). */
  replyTo?: { id: string; content: string; senderName: string } | null;
}

export async function postAsNazmije(i: PostAsNazmijeInput): Promise<{ id: string }> {
  const now = admin.firestore.Timestamp.now();
  const content = i.content.trim() || '…';
  const ref = db.collection('messages').doc();
  const base: Record<string, unknown> = {
    content,
    senderId: NAZMIJE_UID,
    botId: NAZMIJE_UID,
    nazmijeKind: i.kind,
    isRead: false,
    businessId: i.businessId,
    teamId: i.teamId,
    createdByUserId: null,
    createdAt: now,
    updatedAt: now,
    ...(i.replyTo ? { replyToId: i.replyTo.id, replyToContent: i.replyTo.content.slice(0, 100), replyToSender: i.replyTo.senderName } : {}),
  };
  const preview = content.slice(0, 100);
  const ops: Promise<unknown>[] = [];

  if (i.directUserId) {
    await ref.set({ ...base, receiverId: i.directUserId });
    ops.push(db.collection('dmThreads').doc(dmThreadId(NAZMIJE_UID, i.directUserId)).set({
      participants: [NAZMIJE_UID, i.directUserId].sort(),
      businessId: i.businessId,
      lastMessage: { content: content.slice(0, 140), senderId: NAZMIJE_UID, createdAt: now, attachment: false },
      updatedAt: now,
    }, { merge: true }));
    ops.push(notifyUser({
      userId: i.directUserId,
      type: 'direct_message',
      title: i.displayName,
      message: preview,
      actionUrl: `/app/chat?directUserId=${NAZMIJE_UID}`,
      conversationKey: `dm:${NAZMIJE_UID}`,
      messageId: ref.id,
      businessId: i.businessId,
      teamId: i.teamId,
      actorUserId: null,
      // A reply lands while they are reading; the bell row is enough. Digests ring.
      push: i.kind !== 'reply',
      email: false,
    }));
  } else if (i.channelId) {
    await ref.set({ ...base, channelId: i.channelId });
    const ch = await db.collection('channels').doc(i.channelId).get();
    const chData = ch.exists ? (ch.data() as any) : null;
    const members: string[] = Array.isArray(chData?.members) ? chData.members.filter((m: any) => typeof m === 'string') : [];
    if (chData?.isGroup) {
      ops.push(ch.ref.update({ lastMessageAt: now, lastMessagePreview: content.slice(0, 140), lastMessageSenderId: NAZMIJE_UID }));
    }
    const targets = members.filter(uid => uid !== NAZMIJE_UID && uid !== i.actorUserId).slice(0, MAX_GROUP_FANOUT);
    targets.forEach(uid => ops.push(notifyUser({
      userId: uid,
      type: 'channel_message',
      title: `${i.displayName} · ${chData?.name || 'Kanali'}`,
      message: preview,
      linkTo: i.channelId!,
      conversationKey: `ch:${i.channelId}`,
      messageId: ref.id,
      businessId: i.businessId,
      teamId: i.teamId,
      actorUserId: null,
      email: false,
    })));
  } else {
    throw new Error('postAsNazmije: channelId or directUserId required');
  }

  const results = await Promise.allSettled(ops);
  results.forEach((r, idx) => { if (r.status === 'rejected') console.error(`[nazmije] side-effect[${idx}] failed`, r.reason); });
  return { id: ref.id };
}

async function setTyping(key: string, businessId: string, teamId: string, on: boolean): Promise<void> {
  const ref = db.collection('typingIndicators').doc(`${key}__${NAZMIJE_UID}`);
  try {
    if (on) await ref.set({ userId: NAZMIJE_UID, channelId: key, timestamp: admin.firestore.Timestamp.now(), businessId, teamId });
    else await ref.delete();
  } catch { /* cosmetic */ }
}

async function writeLastRun(teamId: string, patch: NonNullable<NazmijeSettings['lastRun']>): Promise<void> {
  await db.collection('teamSettings').doc(teamId).set({
    nazmije: { lastRun: { ...patch, at: admin.firestore.Timestamp.now() } },
  }, { merge: true }).catch(() => {});
}

/** Per-tenant daily reply budget: `nazmijeUsage/{bid}_{date}` — increments only when under the cap. */
async function claimDailyReply(businessId: string, dateKey: string, cap: number): Promise<boolean> {
  const ref = db.collection('nazmijeUsage').doc(`${businessId}_${dateKey}`);
  try {
    return await db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      const count = snap.exists ? Number((snap.data() as any)?.replies) || 0 : 0;
      if (count >= cap) return false;
      tx.set(ref, { businessId, date: dateKey, replies: count + 1, updatedAt: admin.firestore.Timestamp.now() }, { merge: true });
      return true;
    });
  } catch {
    return true; // fail-open, like the hourly limiter
  }
}

// ── Reply ─────────────────────────────────────────────────────────────────────

interface Thread {
  audience: 'group' | 'dm';
  channelId: string | null;
  directUserId: string | null;
  /** The row she is answering. */
  message: { id: string; content: string };
}

async function threadContext(t: Thread, uid: string, people: People): Promise<ChatMsg[]> {
  const rows: { senderId: string; content: string; createdAt: number }[] = [];
  const push = (snap: admin.firestore.QuerySnapshot) => snap.docs.forEach(d => {
    const m = d.data() as any;
    if (m.deletedAt || m.isDeleted || typeof m.content !== 'string') return;
    rows.push({ senderId: String(m.senderId || ''), content: m.content.slice(0, 600), createdAt: toMs(m.createdAt) || 0 });
  });
  try {
    if (t.audience === 'dm') {
      const [a, b] = await Promise.all([
        db.collection('messages').where('senderId', '==', uid).where('receiverId', '==', NAZMIJE_UID).orderBy('createdAt', 'desc').limit(NAZMIJE_LIMITS.contextMessages).get(),
        db.collection('messages').where('senderId', '==', NAZMIJE_UID).where('receiverId', '==', uid).orderBy('createdAt', 'desc').limit(NAZMIJE_LIMITS.contextMessages).get(),
      ]);
      push(a); push(b);
    } else if (t.channelId) {
      push(await db.collection('messages').where('channelId', '==', t.channelId).orderBy('createdAt', 'desc').limit(NAZMIJE_LIMITS.contextMessages).get());
    }
  } catch (err) {
    console.warn('[nazmije] thread context unavailable', (err as Error)?.message);
  }
  rows.sort((a, b) => a.createdAt - b.createdAt);
  const recent = rows.slice(-NAZMIJE_LIMITS.contextMessages).filter(r => r.content.trim());
  // Ensure the row being answered is last (the group read may not include it yet).
  if (!recent.some(r => r.content === t.message.content)) recent.push({ senderId: uid, content: t.message.content, createdAt: Date.now() });
  const msgs: ChatMsg[] = [];
  for (const r of recent) {
    if (r.senderId === NAZMIJE_UID) {
      if (msgs.length && msgs[msgs.length - 1].role === 'assistant') msgs[msgs.length - 1].content += '\n' + r.content;
      else msgs.push({ role: 'assistant', content: r.content });
    } else {
      const who = t.audience === 'group' ? `${nameOf(people, r.senderId)}: ` : '';
      const line = who + r.content;
      if (msgs.length && msgs[msgs.length - 1].role === 'user') msgs[msgs.length - 1].content += '\n' + line;
      else msgs.push({ role: 'user', content: line });
    }
  }
  if (!msgs.length || msgs[0].role !== 'user') msgs.unshift({ role: 'user', content: t.message.content });
  if (msgs[msgs.length - 1].role !== 'user') msgs.push({ role: 'user', content: t.message.content });
  return msgs;
}

async function handleAsk(req: VercelRequest, res: VercelResponse, c: NonNullable<Awaited<ReturnType<typeof authenticate>>>, body: Record<string, any>) {
  const uid = c.uid;
  const messageId = str(body.messageId, 128);
  const text = typeof body.text === 'string' ? body.text.trim().slice(0, 4000) : '';
  let teamId = str(body.teamId, 128);

  // Resolve the thread she is being spoken to in.
  let thread: Thread;
  let businessId = '';
  let groupReplyToId = '';
  if (messageId) {
    const snap = await db.collection('messages').doc(messageId).get();
    if (!snap.exists) return res.status(404).json({ error: 'Mesazhi nuk u gjet' });
    const m = snap.data() as any;
    if (m.senderId !== uid) return res.status(403).json({ error: 'Vetëm dërguesi i mesazhit mund ta thërrasë Nazmijen' });
    const channelId = str(m.channelId, 200);
    const receiverId = str(m.receiverId, 128);
    if (!channelId && receiverId !== NAZMIJE_UID) return res.status(409).json({ error: 'Mesazhi nuk i drejtohej Nazmijes', blocked: 'not-addressed' });
    if (channelId && channelId.startsWith('client-')) return res.status(409).json({ error: 'Nazmija nuk flet në bisedat me klientët', blocked: 'not-addressed' });
    groupReplyToId = channelId ? str(m.replyToId, 128) : '';
    businessId = str(m.businessId, 128);
    teamId = teamId || str(m.teamId, 128);
    thread = { audience: channelId ? 'group' : 'dm', channelId: channelId || null, directUserId: channelId ? null : uid, message: { id: snap.id, content: String(m.content || '') } };
  } else {
    if (!text) return res.status(400).json({ error: 'Teksti mungon' });
    thread = { audience: 'dm', channelId: null, directUserId: uid, message: { id: '', content: text } };
  }

  // Tenant proof: an active membership of the team (claims first, then the row).
  if (!teamId && c.tid) teamId = c.tid;
  if (!teamId) return res.status(400).json({ error: 'teamId mungon' });
  const membership = await activeMembership(uid, { teamId });
  if (!membership && !c.superAdmin) return res.status(403).json({ error: 'Nuk jeni anëtar i këtij ekipi' });
  const ctx = await loadTenantCtx(teamId, businessId || membership?.businessId || c.bid);
  if (!ctx) return res.status(404).json({ error: 'Ekipi nuk u gjet' });
  if (businessId && businessId !== ctx.businessId) return res.status(403).json({ error: 'Mesazhi nuk i përket këtij ekipi' });
  if (c.bid && c.bid !== ctx.businessId && !c.superAdmin) return res.status(403).json({ error: 'Jashtë hapësirës suaj' });
  if (thread.channelId) {
    const ch = await db.collection('channels').doc(thread.channelId).get();
    const chData = ch.exists ? (ch.data() as any) : null;
    if (!chData || chData.businessId !== ctx.businessId) return res.status(403).json({ error: 'Kanali nuk i përket këtij ekipi' });
    if (chData.isGroup && !(Array.isArray(chData.members) && chData.members.includes(uid))) return res.status(403).json({ error: 'Nuk jeni anëtar i këtij grupi' });
  }

  const settings = ctx.settings;
  // A group row is for her when it @mentions either of her names or answers one of
  // her rows in THIS channel — checked here because her display name is a setting.
  if (thread.channelId) {
    let repliesToNazmije = false;
    if (groupReplyToId) {
      const prev = await db.collection('messages').doc(groupReplyToId).get().catch(() => null);
      const p = prev?.exists ? (prev.data() as any) : null;
      repliesToNazmije = !!p && p.senderId === NAZMIJE_UID && p.channelId === thread.channelId;
    }
    if (!addressesNazmije({ text: thread.message.content, displayName: settings.displayName, repliesToNazmije })) {
      return res.status(409).json({ error: 'Mesazhi nuk e përmend Nazmijen', blocked: 'not-addressed' });
    }
  }
  const now = new Date();
  const local = localParts(now, TZ);
  const prefs = await db.collection('userPreferences').doc(uid).get().catch(() => null);
  const userOptOut = !!(prefs?.exists && (prefs.data() as any)?.nazmijeOptOut === true);
  const cfg = await resolveAiConfig(teamId);
  const rateLimited = settings.enabled ? !(await checkPersistentRateLimit('nazmije', uid, NAZMIJE_LIMITS.replyPerUserPerHour)) : false;
  const dailyCapReached = settings.enabled && !rateLimited ? !(await claimDailyReply(ctx.businessId, local.date, settings.dailyReplyCap)) : false;

  const blocked = nazmijeBlockReason({
    kind: 'reply', settings, tenantStatus: ctx.tenantStatus, local, isDm: thread.audience === 'dm',
    hasAiKey: cfg.hasKey, userOptOut, rateLimited, dailyCapReached,
  });

  // The DM path: the person's own row is written by us (the rules cannot prove a
  // bot uid is "a user of the tenant"), unless she is off for this tenant.
  if (!messageId && blocked !== 'module-off' && blocked !== 'tenant-suspended') {
    const nowTs = admin.firestore.Timestamp.now();
    const ref = db.collection('messages').doc();
    await ref.set({
      content: text, senderId: uid, receiverId: NAZMIJE_UID, isRead: true, businessId: ctx.businessId, teamId,
      createdByUserId: uid, createdAt: nowTs, updatedAt: nowTs,
    });
    thread.message.id = ref.id;
    await db.collection('dmThreads').doc(dmThreadId(uid, NAZMIJE_UID)).set({
      participants: [uid, NAZMIJE_UID].sort(), businessId: ctx.businessId,
      lastMessage: { content: text.slice(0, 140), senderId: uid, createdAt: nowTs, attachment: false }, updatedAt: nowTs,
    }, { merge: true }).catch(() => {});
  }

  const post = (content: string, replyToName?: string) => postAsNazmije({
    businessId: ctx.businessId, teamId, content, kind: 'reply', displayName: settings.displayName,
    channelId: thread.channelId, directUserId: thread.directUserId, actorUserId: uid,
    replyTo: thread.audience === 'group' && thread.message.id ? { id: thread.message.id, content: thread.message.content, senderName: replyToName || 'Koleg' } : null,
  });

  if (blocked) {
    const line = BLOCK_REPLIES[blocked];
    let replyId: string | null = null;
    if (line) replyId = (await post(line)).id;
    return res.status(line ? 200 : 409).json({ ok: !!line, blocked, replyId, userMessageId: thread.message.id || null });
  }

  const people = await loadPeople(ctx.businessId);
  const askerName = nameOf(people, uid);
  const role: NazmijeRole = nazmijeRoleOf(c.roles, membership?.role);
  const typingKey = thread.channelId || dmTypingKey(uid);
  await setTyping(typingKey, ctx.businessId, teamId, true);
  try {
    const facts = factsForAudience(await buildFacts(ctx, now), role, thread.audience);
    const system = buildNazmijePrompt({
      displayName: settings.displayName,
      tenantName: ctx.tenantName,
      askerName,
      askerRole: role,
      audience: thread.audience,
      humor: humorModeFor(settings.humor, 'reply', thread.audience),
      factsText: renderFactsForPrompt(facts),
      nowLabel: `${albanianDateLabel(local.date)}, ${local.hhmm}`,
    });
    const msgs = await threadContext(thread, uid, people);
    const result = await generateChatWith(cfg, system, msgs, { maxTokens: 450, temperature: 0.6 });
    const reply = sanitizeReply(result.reply) || 'Më iku fjala. Pyetmë prapë, më shkurt.';
    const posted = await post(reply, askerName);
    return res.status(200).json({ ok: true, blocked: null, replyId: posted.id, userMessageId: thread.message.id || null, model: (result as any).model || null });
  } catch (err: any) {
    const classified = classifyAiError(err);
    console.error('[nazmije] reply failed', classified.code, classified.detail || err?.message);
    const line = classified.code === 'rate-limited'
      ? 'Ofruesi i AI-së më tha "ngadalë". Provo pas një minute.'
      : 'Më fal, më iku kafja (AI-ja nuk u përgjigj). Provo pas pak — ose pyet një koleg, ata s\'kanë nevojë për çelës API.';
    const posted = await post(line, askerName).catch(() => null);
    return res.status(200).json({ ok: false, blocked: null, aiError: classified.code, replyId: posted?.id || null, userMessageId: thread.message.id || null });
  } finally {
    await setTyping(typingKey, ctx.businessId, teamId, false);
  }
}

// ── Enable / disable ──────────────────────────────────────────────────────────

type AdminGate = { error: string; status: 403 | 404 } | { ctx: TenantCtx };

async function requireTenantAdmin(c: NonNullable<Awaited<ReturnType<typeof authenticate>>>, teamId: string): Promise<AdminGate> {
  const membership = await activeMembership(c.uid, { teamId });
  const ctx = await loadTenantCtx(teamId, membership?.businessId || c.bid);
  if (!ctx) return { error: 'Ekipi nuk u gjet', status: 404 };
  if (c.bid && c.bid !== ctx.businessId && !c.superAdmin) return { error: 'Jashtë hapësirës suaj', status: 403 };
  const admin_ = c.superAdmin || hasAdminRole(c.roles) || membership?.role === 'Admin' || (await isBusinessOwner(c.uid, ctx.businessId));
  if (!admin_) return { error: 'Vetëm një Admin ose pronari mund ta aktivizojë Nazmijen', status: 403 };
  if (!membership && !c.superAdmin) return { error: 'Nuk jeni anëtar i këtij ekipi', status: 403 };
  return { ctx };
}

async function handleEnable(res: VercelResponse, c: NonNullable<Awaited<ReturnType<typeof authenticate>>>, body: Record<string, any>) {
  const teamId = str(body.teamId, 128) || c.tid || '';
  if (!teamId) return res.status(400).json({ error: 'teamId mungon' });
  const gate = await requireTenantAdmin(c, teamId);
  if ('error' in gate) return res.status(gate.status).json({ error: gate.error });
  const { ctx } = gate;
  if (ctx.tenantStatus === 'suspended') return res.status(402).json({ error: 'Hapësira është e pezulluar' });
  const now = admin.firestore.Timestamp.now();
  const incoming = resolveNazmijeSettings({ ...ctx.settings, ...(body.settings && typeof body.settings === 'object' ? body.settings : {}), enabled: true });

  // 1. Her profile in this tenant (name + avatar for every chat surface).
  await db.collection('userProfiles').doc(nazmijeProfileDocId(ctx.businessId)).set({
    userId: NAZMIJE_UID, displayName: incoming.displayName, avatarUrl: NAZMIJE_AVATAR_PATH, jobTitle: NAZMIJE_TITLE,
    bio: 'Sekretarja virtuale e ekipit. Di afatet, detyrat dhe raportet; nuk shpik asgjë.',
    businessId: ctx.businessId, teamId, isBot: true, updatedAt: now, createdAt: now,
  }, { merge: true });

  // 2. The group channel for her digests: an existing group of this tenant, or a new one.
  // A re-enable without an explicit pick reuses the stored group (never a second "Zyra").
  let channelId = str(body.channelId, 200) || null;
  if (!channelId && ctx.settings.channelId) {
    const prev = await db.collection('channels').doc(ctx.settings.channelId).get();
    if (prev.exists && (prev.data() as any)?.businessId === ctx.businessId && (prev.data() as any)?.isGroup) channelId = prev.id;
  }
  if (channelId) {
    const ch = await db.collection('channels').doc(channelId).get();
    const chData = ch.exists ? (ch.data() as any) : null;
    if (!chData || chData.businessId !== ctx.businessId || !chData.isGroup) return res.status(400).json({ error: 'Kanali i zgjedhur nuk është grup i këtij ekipi' });
    await ch.ref.update({ members: admin.firestore.FieldValue.arrayUnion(NAZMIJE_UID), updatedAt: now });
  } else if (body.createChannel !== false) {
    const people = await loadPeople(ctx.businessId);
    const name = str(body.channelName, 60) || 'Zyra';
    const ref = db.collection('channels').doc();
    await ref.set({
      name, description: `Kanali i ekipit me ${incoming.displayName}n — plani i ditës, "ku jemi", përmbledhja e javës.`,
      isGroup: true, isPrivate: true,
      members: Array.from(new Set([...people.activeUids, c.uid, NAZMIJE_UID])),
      admins: [c.uid],
      businessId: ctx.businessId, teamId, createdByUserId: c.uid, createdAt: now, updatedAt: now,
    });
    channelId = ref.id;
  }

  // 3. Settings (merge at field level so an older `lastRun` survives).
  const { lastRun: _lr, ...toStore } = { ...incoming, channelId };
  await db.collection('teamSettings').doc(teamId).set({ nazmije: toStore, updatedAt: now }, { merge: true });

  // 4. Hello — an explicit admin action, so it bypasses the clock gate on purpose.
  let helloId: string | null = null;
  if (channelId && body.hello !== false) {
    const hasKey = (await resolveAiConfig(teamId)).hasKey;
    const hello = [
      `Mirëdita! Unë jam ${incoming.displayName}, sekretarja e re e zyrës. S'pi kafe, por e numëroj.`,
      `Çdo mëngjes ju them çfarë ka afat sot, pasdite ku jemi, dhe të premten javën në shifra. Më shkruani @${incoming.displayName} këtu ose në DM kur doni të dini ku jemi me një projekt a detyrë.`,
      hasKey ? 'Nuk shpik asgjë: nëse s\'është në FivoCRM, për mua s\'ekziston.' : 'Vërejtje: pa çelës AI (Cilësimet → Integrimet) jam vetëm listë, jo bisedë — por lista ime është e saktë.',
    ].join('\n');
    helloId = (await postAsNazmije({
      businessId: ctx.businessId, teamId, channelId, content: hello, kind: 'event', displayName: incoming.displayName, actorUserId: c.uid,
    })).id;
  }
  return res.status(200).json({ ok: true, channelId, helloId, settings: { ...toStore } });
}

async function handleDisable(res: VercelResponse, c: NonNullable<Awaited<ReturnType<typeof authenticate>>>, body: Record<string, any>) {
  const teamId = str(body.teamId, 128) || c.tid || '';
  if (!teamId) return res.status(400).json({ error: 'teamId mungon' });
  const gate = await requireTenantAdmin(c, teamId);
  if ('error' in gate) return res.status(gate.status).json({ error: gate.error });
  await db.collection('teamSettings').doc(teamId).set({ nazmije: { enabled: false }, updatedAt: admin.firestore.Timestamp.now() }, { merge: true });
  return res.status(200).json({ ok: true });
}

// ── HTTP entry ────────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const c = await authenticate(req);
  if (!c) return res.status(401).json({ error: 'Missing or invalid token' });
  if (isPortalOnlyToken(c)) return res.status(403).json({ error: 'Nazmija flet vetëm me stafin' });
  const body = await readJsonBody(req);
  if (!body) return res.status(400).json({ error: 'Invalid JSON' });
  const action = str(body.action, 20);
  try {
    switch (action) {
      case 'ask': return await handleAsk(req, res, c, body);
      case 'enable': return await handleEnable(res, c, body);
      case 'disable': return await handleDisable(res, c, body);
      default: return res.status(400).json({ error: 'Unknown action', detail: 'Expected action=ask|enable|disable' });
    }
  } catch (err: any) {
    console.error('[nazmije]', action, 'failed', err);
    return res.status(500).json({ error: 'Nazmija pati një gabim', detail: err?.message || String(err) });
  }
}

// ── Scheduled digests (cron) ──────────────────────────────────────────────────

export type DigestKind = Extract<NazmijeKind, 'morning' | 'afternoon' | 'weekly'>;

/** One optional AI-improvised joke line for `humor: 'full'`; the bank on any failure. */
async function aiHumorLine(teamId: string, kind: DigestKind, dayIndex: number, weekday: number): Promise<string | null> {
  const bank = humorLineForDay(weekday === 1 ? 'monday' : weekday === 5 ? 'friday' : kind === 'weekly' ? 'friday' : 'morning', dayIndex)?.text || null;
  try {
    const cfg = await resolveAiConfig(teamId);
    if (!cfg.hasKey) return bank;
    const r = await generateChatWith(cfg,
      'Ti je Nazmija, sekretare zyre shqiptare, e thekur dhe vetë-ironike për faktin që je robot. Shkruaj NJË fjali humori të lehtë (max 120 karaktere) për kafen, të hënën/të premten, robotët ose afatet në përgjithësi. KURRË për një person, pagë, mungesa, shëndet. Pa emoji, pa thonjëza, vetëm fjalia.',
      [{ role: 'user', content: kind === 'weekly' ? 'Është e premte pasdite, java mbaroi.' : weekday === 1 ? 'Është e hënë në mëngjes.' : 'Është mëngjes dite pune.' }],
      { maxTokens: 60, temperature: 0.9 });
    const line = sanitizeReply(r.reply).split('\n')[0].trim();
    if (!line || line.length > 160 || /\b(pag[aë]|rrog[aë]|s[eë]mur|mungesa)\b/i.test(line)) return bank;
    return line;
  } catch {
    return bank;
  }
}

export async function runNazmijeDigest(kind: DigestKind, opts: { businessId?: string | null; now?: Date } = {}) {
  const now = opts.now || new Date();
  const scopeId = opts.businessId || null;
  const local = localParts(now, TZ);
  const blocked: Record<string, number> = {};
  const block = (r: string) => { blocked[r] = (blocked[r] || 0) + 1; };
  let scanned = 0, posted = 0, errors = 0;

  const snap = await db.collection('teamSettings').where('nazmije.enabled', '==', true).limit(500).get();
  for (const d of snap.docs) {
    const teamId = d.id;
    scanned++;
    try {
      const ctx = await loadTenantCtx(teamId);
      if (!ctx) { block('team-missing'); continue; }
      if (scopeId && ctx.businessId !== scopeId) { block('out-of-scope'); continue; }
      const s = ctx.settings;

      let channelExists: boolean | undefined;
      if (s.channelId) {
        const ch = await db.collection('channels').doc(s.channelId).get();
        channelExists = ch.exists && (ch.data() as any)?.businessId === ctx.businessId;
      }
      const reason = nazmijeBlockReason({ kind, settings: s, tenantStatus: ctx.tenantStatus, local, channelExists });
      if (reason) {
        block(reason);
        if (reason !== 'off-day' && reason !== 'not-friday' && reason !== 'quiet-hours') await writeLastRun(teamId, { kind, posted: false, blocked: reason, error: null });
        continue;
      }

      const facts = factsForAudience(await buildFacts(ctx, now, { week: kind === 'weekly' }), 'admin', 'group');
      const mode: HumorMode = humorModeFor(s.humor, kind, 'group');
      const dayIndex = dayIndexOf(local.date);
      const digestOpts = { humor: mode === 'ai' ? 'none' as const : mode, dayIndex, weekday: local.weekday };
      let text = kind === 'morning' ? buildMorningDigest(facts, digestOpts)
        : kind === 'afternoon' ? buildAfternoonDigest(facts, digestOpts)
        : buildWeeklyDigest(facts, digestOpts);
      if (!text) {
        block('nothing-to-say');
        await writeLastRun(teamId, { kind, posted: false, blocked: 'nothing-to-say', error: null });
        continue;
      }
      if (mode === 'ai') {
        const joke = await aiHumorLine(teamId, kind, dayIndex, local.weekday);
        if (joke) text += '\n' + joke;
      }

      // Claim the day BEFORE posting: two schedulers (the 14 Sep incident) cannot say
      // "mirëmëngjes" twice. ALREADY_EXISTS = someone else posted; move on.
      try {
        await db.collection('nazmijePosts').doc(nazmijePostDocId(ctx.businessId, local.date, kind)).create({
          businessId: ctx.businessId, teamId, date: local.date, kind, createdAt: admin.firestore.Timestamp.now(),
        });
      } catch (err: any) {
        if (err?.code === 6 || /ALREADY_EXISTS/i.test(String(err?.message))) { block('already-posted'); continue; }
        throw err;
      }
      await postAsNazmije({ businessId: ctx.businessId, teamId, channelId: s.channelId, content: text, kind, displayName: s.displayName });
      posted++;
      await writeLastRun(teamId, { kind, posted: true, blocked: null, error: null });
    } catch (err: any) {
      errors++;
      console.error(`[CRON:nazmije-${kind}] team ${teamId} failed`, err);
      await writeLastRun(teamId, { kind, posted: false, blocked: null, error: String(err?.message || err).slice(0, 300) });
    }
  }
  return { kind, date: local.date, scanned, posted, blocked, errors };
}
