import type { VercelRequest, VercelResponse } from '@vercel/node';
import { adminDb, Timestamp } from './_firebaseAdmin.js';
import { getTeamConfig } from './_tenantConfig.js';
import {
  findLeadForContact,
  findCustomerForContact,
  crossLinkLeadCustomer,
  normContactPhone,
} from './_contactIdentity.js';
import { managerIdsForBusiness } from './_staffRecipients.js';
import { notifyUser } from './_push.js';
import { sendMetaText, sendBaileysText } from './_waSend.js';
import { decideAutoReply, isOptOutMessage, DEFAULT_WA_TIMEZONE, type AutoReplyBlockReason } from './_waAutoReply.js';
import { draftWaReply, type DraftBlockReason } from './_aiReply.js';
import { resolvePlaybooks, matchPlaybookByKeywords, matchPlaybookByTags, enrollPlaybookPatch, withPlaybookTag, normalizeKeywordText } from './_playbooks.js';

// `leadActivities.type` for the playbook enrolment row. A const (not an inline literal)
// so the notification-type registry scan does not mistake it for a notification type.
const PLAYBOOK_ACTIVITY_TYPE = 'field_updated';

/**
 * ONE inbound handler for both WhatsApp channels (Meta Cloud API + Baileys/VPS).
 *
 * Before this file, an inbound WhatsApp message notified nobody: the Meta
 * webhook linked only to a lead (never a customer, never through
 * `_contactIdentity`), the VPS wrote a row and stopped, `slaFirstResponseDueAt`
 * was written and never checked, and the auto-reply existed for Meta only.
 *
 * The channel (webhook / VPS) still writes the BARE `whatsappMessages` row first,
 * with id == waMessageId, so the record never depends on Vercel being up. Then:
 *   Meta  → `processWaEvent()` in-process (api/meta-webhook.ts)
 *   VPS   → `POST /api/wa-inbound` (Bearer CRON_SECRET) → `processWaEvent()`
 * A retried POST is harmless: every write below is an idempotent upsert keyed on
 * the conversation / message id, and the notification is burst-debounced.
 *
 * Inbound steps (the order matters — see the plan, B1):
 *   1. tenant (teams/{teamId}.businessId, getTeamConfig, suspended → skip)
 *   2. contact: lead ‖ customer via _contactIdentity, cross-link, auto-create lead
 *   3. enrich the message row { businessId, leadId, customerId, leadName }
 *   4. upsert conversations/wa-{teamId}-{phone} (owner chain, SLA on transition)
 *   5. stamp the contact(s) + one leadActivities row per awaitingReply transition
 *   6. notifyUser('whatsapp_message') → owner, else the tenant's managers
 *   7. auto-reply (decideAutoReply — pure: outside-hours | greeting) over the SAME
 *      channel; STOP/NDALO/HIQ/UNSUBSCRIBE sets `waOptOut` on the contact first
 *   8. AI draft (draftWaReply — "Sugjerim AI" stored on the conversation; never sent)
 *
 * Outbound events (staff answered from the PHONE, seen by Baileys as fromMe) go
 * to `markConversationAnswered()`, the single "staff replied" touch that the
 * three send endpoints call too.
 */

export interface WaEvent {
  channel: 'baileys' | 'meta';
  /** outbound = a fromMe message the VPS saw (staff replied from the phone). */
  direction: 'inbound' | 'outbound';
  teamId: string;
  agentId?: string | null;
  metaPhoneNumberId?: string | null;
  channelPhone: string;
  /** == the `whatsappMessages` document id the channel wrote. */
  waMessageId: string;
  phone: string;
  jid: string;
  isLid: boolean;
  text: string;
  kind: 'text' | 'media' | 'reaction' | 'system';
  pushName: string | null;
  isAutoReply?: boolean;
  /** ISO 8601. */
  timestamp: string;
  /** Outbound only: the staff uid when the sender is known (app sends). */
  sentByUid?: string | null;
}

export type WaInboundSkipReason =
  | 'invalid-event' | 'no-team' | 'suspended' | 'auto-reply-echo' | 'lid-unresolved';

export interface WaInboundResult {
  ok: boolean;
  skipped?: WaInboundSkipReason;
  leadId: string | null;
  customerId: string | null;
  conversationId: string | null;
  /** Recipients whose bell row was written. */
  notified: number;
  /** Named reason when a lead was NOT auto-created for an unknown number. */
  leadCreateBlocked?: 'disabled' | 'lead-cap' | 'not-a-message' | null;
  newLead?: boolean;
  autoReply: 'outside-hours' | 'greeting' | { blocked: AutoReplyBlockReason | 'send-failed' } | null;
  /** The contact opted out with this message (keyword) — `waOptOut: true` was stamped. */
  optedOut?: boolean;
  /** B3 — "Sugjerim AI" written to `conversations/{id}.suggestedReply` (or the named reason it was not). */
  aiDraft: { suggested: true; forMessageId: string | null; model: string } | { blocked: DraftBlockReason } | null;
  /** The lead was auto-enrolled into this follow-up playbook (id) by keyword / tag match. */
  playbookEnrolled?: string;
}

const DEFAULT_RESPONSE_SLA_MINUTES = 120;
const DEFAULT_LEAD_DAILY_CAP = 50;
const NOTIFY_DEBOUNCE_MS = 2 * 60_000;
const PREVIEW_LEN = 140;
const ACTIVITY_BODY_LEN = 200;

const toMs = (v: any): number => {
  if (!v) return 0;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v.toDate === 'function') return v.toDate().getTime();
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : 0;
};

const preview = (text: string, kind: WaEvent['kind']): string => {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (t) return t.length > PREVIEW_LEN ? `${t.slice(0, PREVIEW_LEN - 1)}…` : t;
  return kind === 'media' ? '[Foto]' : '';
};

/** yyyy-mm-dd of `d` in the office's zone — the daily lead cap is a business day. */
function dayKeyInZone(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

export const waConversationId = (teamId: string, phone: string) => `wa-${teamId}-${phone}`;

/** Owner + watchers routing (server mirror of src/lib/conversationRouting.ts). */
function buildWaRouting(
  members: Array<{ userId: string; teamId?: string; role?: string; status?: string }>,
  ownerId: string | null,
  teamId: string,
) {
  const active = members.filter((m) => (m.status ?? 'Active') === 'Active' && m.userId);
  const managerId = active.find((m) => m.teamId === teamId && m.role === 'Manager')?.userId || null;
  const teamMemberIds = active.filter((m) => m.teamId === teamId).map((m) => m.userId);
  const adminIds = active.filter((m) => m.role === 'Admin' || m.role === 'Owner').map((m) => m.userId);
  const fallbackManagers = !ownerId && !managerId ? active.filter((m) => m.role === 'Manager').map((m) => m.userId) : [];
  const watchers = Array.from(
    new Set([ownerId, ...teamMemberIds, managerId, ...adminIds, ...fallbackManagers].filter(Boolean) as string[]),
  );
  return { managerId, watchers, unassigned: !ownerId };
}

interface TenantCtx {
  teamId: string;
  businessId: string;
  settings: Record<string, any>;
}

async function resolveTenant(teamId: string): Promise<TenantCtx | { skipped: WaInboundSkipReason }> {
  const [teamSnap, settings] = await Promise.all([
    adminDb.collection('teams').doc(teamId).get(),
    getTeamConfig(teamId),
  ]);
  let businessId = (teamSnap.data() as any)?.businessId as string | undefined;
  if (!businessId) {
    // Legacy team without a business stamp: the tenant-hierarchy job normally
    // heals this; until then the team id is the best key we have (same fallback
    // the Meta webhook used). Logged, because docs stamped this way are invisible
    // to business-scoped queries.
    console.warn(`[waInbound] teams/${teamId} has no businessId — falling back to teamId`);
    businessId = teamId;
  } else {
    try {
      const biz = await adminDb.collection('businesses').doc(businessId).get();
      if ((biz.data() as any)?.status === 'suspended') return { skipped: 'suspended' };
    } catch { /* a missing business doc never blocks ingest */ }
  }
  return { teamId, businessId, settings };
}

/** `whatsappAccounts/{agentId}.assignedToUserId` (Baileys) or the Meta channel's assignee. */
async function resolveAgentOwner(event: WaEvent, settings: Record<string, any>): Promise<string | null> {
  try {
    if (event.channel === 'baileys' && event.agentId) {
      const snap = await adminDb.collection('whatsappAccounts').doc(event.agentId).get();
      return ((snap.data() as any)?.assignedToUserId as string | undefined) || null;
    }
    if (event.channel === 'meta' && event.metaPhoneNumberId) {
      const ch = (settings.metaChannels || []).find((c: any) => c?.phoneNumberId === event.metaPhoneNumberId);
      return (ch?.assignedToUserId as string | undefined) || null;
    }
  } catch { /* owner falls through to null */ }
  return null;
}

/**
 * Create a lead for an unknown number, guarded by a per-tenant daily cap.
 * The counter increment and the lead creation are ONE transaction, so a burst
 * of unknown numbers cannot overshoot the cap and a failed create cannot burn
 * a slot.
 */
async function autoCreateLead(args: {
  ctx: TenantCtx;
  event: WaEvent;
  ts: Date;
  agentOwner: string | null;
}): Promise<{ leadId: string | null; blocked: 'disabled' | 'lead-cap' | 'not-a-message' | null }> {
  const { ctx, event, ts, agentOwner } = args;
  if (event.kind === 'reaction' || event.kind === 'system') return { leadId: null, blocked: 'not-a-message' };
  if (ctx.settings.waAutoCreateLead === false) return { leadId: null, blocked: 'disabled' };

  const capRaw = Number(ctx.settings.waAutoCreateLeadDailyCap);
  const cap = Number.isFinite(capRaw) && capRaw > 0 ? Math.floor(capRaw) : DEFAULT_LEAD_DAILY_CAP;
  const day = dayKeyInZone(ts, DEFAULT_WA_TIMEZONE);
  const counterRef = adminDb.collection('waInboundCounters').doc(`${ctx.teamId}_${day}`);
  const leadRef = adminDb.collection('leads').doc();
  const now = Timestamp.now();
  const tsStamp = Timestamp.fromDate(ts);

  const created = await adminDb.runTransaction(async (tx) => {
    const counter = await tx.get(counterRef);
    const count = Number((counter.data() as any)?.leadsCreated || 0);
    if (count >= cap) return false;
    tx.set(counterRef, {
      teamId: ctx.teamId,
      businessId: ctx.businessId,
      date: day,
      leadsCreated: count + 1,
      updatedAt: now,
      ...(counter.exists ? {} : { createdAt: now }),
    }, { merge: true });
    tx.set(leadRef, {
      name: (event.pushName || '').trim() || event.phone,
      phoneNumber: event.phone,
      phone: event.phone,
      email: '',
      company: '',
      source: 'whatsapp',
      status: 'New',
      teamId: ctx.teamId,
      businessId: ctx.businessId,
      assignedToUserId: agentOwner ?? null,
      createdByUserId: null,
      awaitingReply: true,
      lastInboundAt: tsStamp,
      lastActivityAt: tsStamp,
      notes: '',
      tags: [],
      createdAt: now,
      updatedAt: now,
    });
    return true;
  });

  return created ? { leadId: leadRef.id, blocked: null } : { leadId: null, blocked: 'lead-cap' };
}

/** Resolve the VPS coordinates for a Baileys reply: tenant config first, platform env second. */
function baileysCoords(settings: Record<string, any>): { vpsUrl: string; vpsSecret: string } {
  return {
    vpsUrl: String(settings.whatsappVpsUrl || process.env.WHATSAPP_VPS_URL || ''),
    vpsSecret: String(settings.whatsappVpsSecret || process.env.WHATSAPP_VPS_SECRET || ''),
  };
}

function metaChannelFor(settings: Record<string, any>, phoneNumberId?: string | null) {
  const channels: any[] = Array.isArray(settings.metaChannels) ? settings.metaChannels : [];
  const ch = (phoneNumberId && channels.find((c) => c?.phoneNumberId === phoneNumberId)) || null;
  if (ch?.accessToken && ch?.phoneNumberId) return { phoneNumberId: String(ch.phoneNumberId), accessToken: String(ch.accessToken), phone: String(ch.phone || '') };
  if (settings.metaAccessToken && settings.metaPhoneNumberId && (!phoneNumberId || settings.metaPhoneNumberId === phoneNumberId)) {
    return { phoneNumberId: String(settings.metaPhoneNumberId), accessToken: String(settings.metaAccessToken), phone: '' };
  }
  return null;
}

// ── The single "staff replied" touch ──────────────────────────────────────────

export interface MarkAnsweredArgs {
  teamId: string;
  phone: string;
  /** Staff uid when known; null when the reply came from the phone itself. */
  byUid: string | null;
  source: 'phone' | 'app';
  /** Known contact ids (saves the identity lookup). */
  leadId?: string | null;
  customerId?: string | null;
}

/**
 * Called after EVERY staff reply (app text/media/template, or a fromMe message
 * seen by Baileys). Closes the awaitingReply window on the conversation and the
 * contact(s), stamps first response once. Never throws — a failed stamp must
 * never fail the send that triggered it. Deliberately NOT called by campaign
 * sends: a campaign is not an answer.
 *
 * Writes only the fields; the activity/timeline row for the send is written by
 * the client (A5) so a send never produces two rows.
 */
export async function markConversationAnswered(args: MarkAnsweredArgs): Promise<void> {
  const phone = normContactPhone(args.phone);
  if (!args.teamId || !phone) return;
  const now = Timestamp.now();
  try {
    const convRef = adminDb.collection('conversations').doc(waConversationId(args.teamId, phone));
    const convSnap = await convRef.get();
    const conv = (convSnap.data() as any) || null;

    let leadId = args.leadId ?? conv?.leadId ?? null;
    let customerId = args.customerId ?? conv?.customerId ?? null;
    let businessId: string | null = conv?.businessId ?? null;
    if (!leadId && !customerId) {
      if (!businessId) {
        try { businessId = ((await adminDb.collection('teams').doc(args.teamId).get()).data() as any)?.businessId || null; } catch { /* optional */ }
      }
      const [lead, customer] = await Promise.all([
        findLeadForContact(adminDb, { phone, teamId: args.teamId, businessId }),
        findCustomerForContact(adminDb, { phone, teamId: args.teamId, businessId }),
      ]);
      leadId = lead?.id ?? null;
      customerId = customer?.id ?? null;
    }

    const ops: Promise<unknown>[] = [];
    if (convSnap.exists) {
      const patch: Record<string, any> = {
        awaitingReply: false,
        lastOutboundAt: now,
        lastOutboundByUid: args.byUid ?? null,
        lastOutboundSource: args.source,
        lastMessageAt: now,
        updatedAt: now,
      };
      if (!conv?.firstResponseAt) patch.firstResponseAt = now;
      ops.push(convRef.set(patch, { merge: true }));
    }
    // The 24h-window tracker gets the outbound mark too: the auto-reply engine
    // reads it (with the conversation doc) to tell a first contact from a known one.
    ops.push(adminDb.collection('whatsappConversations').doc(`${args.teamId}_${phone}`).set({
      teamId: args.teamId,
      phone,
      lastOutboundAt: now,
      updatedAt: now,
    }, { merge: true }));
    if (leadId) {
      ops.push((async () => {
        const ref = adminDb.collection('leads').doc(leadId);
        const snap = await ref.get();
        if (!snap.exists) return;
        const lead = snap.data() as any;
        const patch: Record<string, any> = {
          awaitingReply: false,
          lastActivityAt: now,
          lastFollowUpDate: now,
          updatedAt: now,
        };
        if (!lead.firstResponseAt) patch.firstResponseAt = now;
        await ref.update(patch);
      })());
    }
    if (customerId) {
      ops.push(adminDb.collection('customers').doc(customerId).set({
        awaitingReply: false,
        lastActivityAt: now,
        updatedAt: now,
      }, { merge: true }));
    }
    const results = await Promise.allSettled(ops);
    results.forEach((r) => { if (r.status === 'rejected') console.error('[waInbound] markAnswered op failed', r.reason); });
  } catch (err) {
    console.error('[waInbound] markConversationAnswered failed', { teamId: args.teamId, phone, err });
  }
}

// ── Inbound ────────────────────────────────────────────────────────────────────

function validateEvent(raw: any): WaEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.channel !== 'baileys' && raw.channel !== 'meta') return null;
  if (raw.direction !== 'inbound' && raw.direction !== 'outbound') return null;
  if (typeof raw.teamId !== 'string' || !raw.teamId) return null;
  if (typeof raw.waMessageId !== 'string' || !raw.waMessageId) return null;
  const phone = normContactPhone(typeof raw.phone === 'string' ? raw.phone : '');
  if (!phone) return null;
  const kind: WaEvent['kind'] = ['text', 'media', 'reaction', 'system'].includes(raw.kind) ? raw.kind : 'text';
  const ts = raw.timestamp ? new Date(raw.timestamp) : new Date();
  return {
    channel: raw.channel,
    direction: raw.direction,
    teamId: raw.teamId,
    agentId: typeof raw.agentId === 'string' ? raw.agentId : null,
    metaPhoneNumberId: typeof raw.metaPhoneNumberId === 'string' ? raw.metaPhoneNumberId : null,
    channelPhone: typeof raw.channelPhone === 'string' ? raw.channelPhone : '',
    waMessageId: raw.waMessageId,
    phone,
    jid: typeof raw.jid === 'string' && raw.jid ? raw.jid : `${phone}@s.whatsapp.net`,
    isLid: !!raw.isLid,
    text: typeof raw.text === 'string' ? raw.text : '',
    kind,
    pushName: typeof raw.pushName === 'string' && raw.pushName.trim() ? raw.pushName.trim() : null,
    isAutoReply: !!raw.isAutoReply,
    timestamp: Number.isFinite(ts.getTime()) ? ts.toISOString() : new Date().toISOString(),
    sentByUid: typeof raw.sentByUid === 'string' && raw.sentByUid ? raw.sentByUid : null,
  };
}

const emptyResult = (skipped?: WaInboundSkipReason): WaInboundResult => ({
  ok: !skipped, skipped, leadId: null, customerId: null, conversationId: null, notified: 0, autoReply: null, aiDraft: null,
});

export async function processWaEvent(rawEvent: WaEvent | Record<string, any>): Promise<WaInboundResult> {
  const event = validateEvent(rawEvent);
  if (!event) return emptyResult('invalid-event');
  // A LID-only jid carries no real phone yet; the VPS backfills the row when the
  // mapping arrives. Creating a lead on that number would be garbage.
  if (event.isLid) return emptyResult('lid-unresolved');

  // ── Outbound (fromMe from the phone, or an echo) ──
  if (event.direction === 'outbound') {
    if (event.isAutoReply) return emptyResult('auto-reply-echo');
    await markConversationAnswered({ teamId: event.teamId, phone: event.phone, byUid: event.sentByUid ?? null, source: event.sentByUid ? 'app' : 'phone' });
    return { ...emptyResult(), conversationId: waConversationId(event.teamId, event.phone) };
  }

  // 1. Tenant
  const tenant = await resolveTenant(event.teamId);
  if ('skipped' in tenant) return emptyResult(tenant.skipped);
  const ctx = tenant;
  const ts = new Date(event.timestamp);
  const tsStamp = Timestamp.fromDate(ts);
  const now = Timestamp.now();

  // 2. Contact — lead ‖ customer; both may exist, keep both ids.
  const lookup = { phone: event.phone, teamId: ctx.teamId, businessId: ctx.businessId };
  const [leadSnap, customerSnap, agentOwner] = await Promise.all([
    findLeadForContact(adminDb, lookup),
    findCustomerForContact(adminDb, lookup),
    resolveAgentOwner(event, ctx.settings),
  ]);
  let leadId = leadSnap?.id ?? null;
  const customerId = customerSnap?.id ?? null;
  const lead = (leadSnap?.data() as any) || null;
  const customer = (customerSnap?.data() as any) || null;
  if (leadId && customerId && (!lead?.customerId || !customer?.leadId)) {
    await crossLinkLeadCustomer(adminDb, leadId, customerId);
  }
  let leadCreateBlocked: WaInboundResult['leadCreateBlocked'] = null;
  let newLead = false;
  if (!leadId && !customerId) {
    try {
      const r = await autoCreateLead({ ctx, event, ts, agentOwner });
      leadId = r.leadId;
      leadCreateBlocked = r.blocked;
      newLead = !!r.leadId;
    } catch (err) {
      console.error('[waInbound] auto-create lead failed', err);
    }
  }
  const contactName: string = (lead?.name || customer?.name || event.pushName || event.phone) as string;

  // 2b. Follow-up playbook: the service interest the lead states in a text
  //     ("a bëni SEO?") — or a tag already on the lead — enrols it in the
  //     matching playbook (`teamSettings.followUpPlaybooks`, validated by
  //     `_playbooks.ts`). Leads only, never customers; never a closed lead;
  //     never re-enrols one that already has a playbook (a later message about
  //     another service is the salesperson's call, not the parser's).
  let playbookEnrolled: string | undefined;
  const PLAYBOOK_TERMINAL = ['Won', 'Lost', 'Converted'];
  if (leadId && event.kind === 'text' && !lead?.playbookId && !PLAYBOOK_TERMINAL.includes(String(lead?.status || ''))) {
    try {
      const playbooks = resolvePlaybooks(ctx.settings);
      if (playbooks.length) {
        const byKeyword = matchPlaybookByKeywords(event.text, playbooks);
        const pb = byKeyword ?? matchPlaybookByTags(lead?.tags, playbooks);
        if (pb) {
          const enrolledAt = new Date();
          await adminDb.collection('leads').doc(leadId).set({
            tags: withPlaybookTag(lead?.tags, pb),
            ...enrollPlaybookPatch(pb, enrolledAt),
            serviceInterest: pb.name,
            updatedAt: now,
          }, { merge: true });
          const matchedKeyword = byKeyword
            ? pb.keywords.find(k => ` ${normalizeKeywordText(event.text)} `.includes(` ${normalizeKeywordText(k)} `)) ?? null
            : null;
          await adminDb.collection('leadActivities').add({
            leadId,
            teamId: ctx.teamId,
            businessId: ctx.businessId,
            type: PLAYBOOK_ACTIVITY_TYPE, // leadActivities row type (not a notification)
            title: `Playbook ${pb.name} u aktivizua`,
            body: matchedKeyword ? `Fjalëkyç: ${matchedKeyword}` : 'Nga etiketa',
            meta: { playbookId: pb.id, source: byKeyword ? 'keyword' : 'tag', waMessageId: event.waMessageId },
            userId: null,
            userName: 'Sistemi',
            createdAt: now,
          });
          playbookEnrolled = pb.id;
        }
      }
    } catch (err) {
      console.error('[waInbound] playbook enrol failed', err);
    }
  }

  // 3. Enrich the message row (the channel wrote the bare row; a retry re-merges the same values).
  const enrich: Record<string, any> = { businessId: ctx.businessId, updatedAt: now };
  if (leadId) { enrich.leadId = leadId; enrich.leadName = contactName; }
  if (customerId) { enrich.customerId = customerId; if (!leadId) enrich.leadName = contactName; }
  await adminDb.collection('whatsappMessages').doc(event.waMessageId).set(enrich, { merge: true })
    .catch((err) => console.error('[waInbound] message enrich failed', err));

  // 4. Conversation upsert
  const conversationId = waConversationId(ctx.teamId, event.phone);
  const convRef = adminDb.collection('conversations').doc(conversationId);
  const [convSnap, threadSnap, membersSnap] = await Promise.all([
    convRef.get(),
    adminDb.collection('whatsappThreads').doc(`${ctx.teamId}_${event.phone}`).get(),
    adminDb.collection('teamMembers').where('businessId', '==', ctx.businessId).limit(200).get()
      .catch(() => null),
  ]);
  const existing = (convSnap.data() as any) || null;
  const wasAwaiting = existing?.awaitingReply === true;
  const ownerId: string | null =
    existing?.ownerId
    || (threadSnap.data() as any)?.assignedToUserId
    || lead?.assignedToUserId
    || customer?.assignedToUserId
    || agentOwner
    || null;
  const members = (membersSnap?.docs || []).map((d) => {
    const x = d.data() as any;
    return { userId: x.userId as string, teamId: x.teamId as string | undefined, role: x.role as string | undefined, status: x.status as string | undefined };
  });
  const routing = buildWaRouting(members, ownerId, ctx.teamId);
  const slaRaw = Number(ctx.settings.waResponseSlaMinutes);
  const slaMinutes = Number.isFinite(slaRaw) && slaRaw > 0 ? slaRaw : DEFAULT_RESPONSE_SLA_MINUTES;

  const convPatch: Record<string, any> = {
    channel: 'whatsapp',
    channelKind: event.channel,
    agentId: event.agentId ?? null,
    metaPhoneNumberId: event.metaPhoneNumberId ?? null,
    businessId: ctx.businessId,
    teamId: ctx.teamId,
    phone: event.phone,
    leadId: leadId ?? existing?.leadId ?? null,
    customerId: customerId ?? existing?.customerId ?? null,
    subject: contactName,
    ownerId,
    managerId: routing.managerId,
    watchers: Array.from(new Set([...(existing?.watchers || []), ...routing.watchers])),
    unassigned: routing.unassigned,
    status: 'open',
    awaitingReply: true,
    lastInboundAt: tsStamp,
    lastInboundText: preview(event.text, event.kind),
    // Never move lastMessageAt backwards (a replayed/late event must not reorder the inbox).
    lastMessageAt: ts.getTime() >= toMs(existing?.lastMessageAt) ? tsStamp : existing?.lastMessageAt,
    updatedAt: now,
  };
  if (!wasAwaiting) {
    // One burst = one deadline: the SLA clock starts on the FIRST unanswered message.
    convPatch.slaFirstResponseDueAt = Timestamp.fromMillis(ts.getTime() + slaMinutes * 60_000);
    convPatch.slaBreachNotified = false;
    convPatch.slaBreachedAt = null;
  }
  if (!convSnap.exists) {
    Object.assign(convPatch, {
      salesAgentId: null,
      createdAt: now,
      createdByUserId: null,
      firstResponseAt: null,
      lastOutboundAt: null,
      lastNotifiedAt: null,
    });
  }
  await convRef.set(convPatch, { merge: true });

  // 5. Stamp the contact(s); one timeline row per awaitingReply transition.
  //    A whole-message STOP / NDALO / HIQ / UNSUBSCRIBE opts the contact out of
  //    every automatic message (auto-reply, greeting) from now on.
  const optedOutNow = event.kind === 'text' && isOptOutMessage(event.text);
  const stampOps: Promise<unknown>[] = [];
  const contactStamp: Record<string, any> = { lastInboundAt: tsStamp, awaitingReply: true, lastActivityAt: tsStamp, updatedAt: now };
  if (optedOutNow) { contactStamp.waOptOut = true; contactStamp.waOptOutAt = tsStamp; }
  if (leadId && (!newLead || optedOutNow)) stampOps.push(adminDb.collection('leads').doc(leadId).set(contactStamp, { merge: true }));
  if (customerId) stampOps.push(adminDb.collection('customers').doc(customerId).set(contactStamp, { merge: true }));
  if (leadId && (!wasAwaiting || newLead)) {
    stampOps.push(adminDb.collection('leadActivities').add({
      leadId,
      teamId: ctx.teamId,
      businessId: ctx.businessId,
      type: 'whatsapp',
      title: 'Mesazh WhatsApp i marrë',
      body: (event.text || '').slice(0, ACTIVITY_BODY_LEN),
      meta: { direction: 'inbound', channel: event.channel, waMessageId: event.waMessageId, conversationId },
      userId: null,
      userName: contactName,
      createdAt: tsStamp,
    }));
  }
  (await Promise.allSettled(stampOps)).forEach((r) => {
    if (r.status === 'rejected') console.error('[waInbound] contact stamp failed', r.reason);
  });

  // 6. Notify — owner, else the tenant's managers. Burst debounce: a second
  //    message within 2 min of the last notification on a still-unanswered
  //    thread rings nobody twice.
  let notified = 0;
  const lastNotifiedMs = toMs(existing?.lastNotifiedAt);
  const debounced = wasAwaiting && lastNotifiedMs > 0 && Date.now() - lastNotifiedMs < NOTIFY_DEBOUNCE_MS;
  if (!debounced) {
    const recipients = ownerId ? [ownerId] : await managerIdsForBusiness(ctx.businessId, ctx.teamId);
    const title = newLead ? `Lead i ri nga WhatsApp: ${contactName}` : `💬 ${contactName}`;
    const message = preview(event.text, event.kind) || '[Mesazh]';
    const results = await Promise.allSettled(recipients.map((uid) => notifyUser({
      userId: uid,
      type: 'whatsapp_message',
      title,
      message,
      actionUrl: `/app/whatsapp?phone=${encodeURIComponent(event.phone)}`,
      actionLabel: 'Hap bisedën',
      businessId: ctx.businessId,
      teamId: ctx.teamId,
      customerId: customerId ?? null,
      conversationKey: conversationId,
      messageId: event.waMessageId,
    })));
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value.written) notified++;
      else if (r.status === 'rejected') console.error('[waInbound] notifyUser failed', r.reason);
    }
    if (notified > 0) {
      await convRef.set({ lastNotifiedAt: now }, { merge: true }).catch(() => {});
    }
  }

  // 7. Auto-reply — decision is pure; only the send lives here.
  //    History is what existed BEFORE this message: the conversation doc as read
  //    in step 4 (`existing`) plus the contact snapshots from step 2 (pre-stamp),
  //    so the greeting cannot be fooled by the stamps we just wrote. The channel
  //    already overwrote `whatsappConversations.lastInboundAt` with THIS message,
  //    which is why that field is not used for "inbound before". The contact's
  //    `lastActivityAt` / `lastFollowUpDate` count as prior contact too (either
  //    direction) — deliberately conservative: a greeting sent to a customer the
  //    team has talked to for months is the embarrassing failure, a missed
  //    greeting is not.
  let autoReply: WaInboundResult['autoReply'] = null;
  try {
    const waConvRef = adminDb.collection('whatsappConversations').doc(`${ctx.teamId}_${event.phone}`);
    const waConv = (await waConvRef.get()).data() as any;
    const maxMs = (...vals: any[]) => vals.reduce<number>((m, v) => Math.max(m, toMs(v)), 0) || null;
    const thisMs = ts.getTime();
    const before = (v: number | null) => (v && v < thisMs ? v : null);
    const decision = decideAutoReply({
      channel: event.channel,
      direction: event.direction,
      isAutoReply: !!event.isAutoReply,
      kind: event.kind,
      settings: ctx.settings,
      contact: {
        name: contactName,
        company: (lead?.company || customer?.company || '') as string,
        waOptOut: optedOutNow || lead?.waOptOut === true || customer?.waOptOut === true,
      },
      history: {
        lastInboundBeforeMs: before(maxMs(existing?.lastInboundAt, lead?.lastInboundAt, customer?.lastInboundAt)),
        lastOutboundMs: maxMs(existing?.lastOutboundAt, waConv?.lastOutboundAt, lead?.lastFollowUpDate, lead?.lastActivityAt, customer?.lastActivityAt),
        lastAutoReplyMs: toMs(waConv?.lastAutoReplyAt) || null,
      },
      nowMs: Date.now(),
      timeZone: DEFAULT_WA_TIMEZONE,
    });
    if ('blocked' in decision) {
      autoReply = decision;
    } else {
      let sent = false;
      if (event.channel === 'meta') {
        const ch = metaChannelFor(ctx.settings, event.metaPhoneNumberId);
        if (!ch) {
          autoReply = { blocked: 'no-channel' };
        } else {
          const replyId = await sendMetaText(ch, event.phone, decision.text);
          if (replyId) {
            sent = true;
            // Meta does not echo our own sends — the handler writes the row.
            await adminDb.collection('whatsappMessages').doc(replyId).set({
              phone: event.phone,
              jid: `${event.phone}@s.whatsapp.net`,
              direction: 'outbound',
              message: decision.text,
              waMessageId: replyId,
              leadId: leadId ?? null,
              customerId: customerId ?? null,
              leadName: contactName,
              teamId: ctx.teamId,
              businessId: ctx.businessId,
              status: 'sent',
              channel: 'meta',
              channelPhone: event.channelPhone || normContactPhone(ch.phone),
              metaPhoneNumberId: ch.phoneNumberId,
              isLid: false,
              isAutoReply: true,
              sentByUid: null,
              createdAt: now,
              updatedAt: now,
            }, { merge: true });
          }
        }
      } else {
        const { vpsUrl, vpsSecret } = baileysCoords(ctx.settings);
        if (!vpsUrl || !vpsSecret) {
          autoReply = { blocked: 'no-channel' };
        } else {
          // The VPS persists the echo row itself (isAutoReply: true) — never write it twice.
          const r = await sendBaileysText(vpsUrl, vpsSecret, event.agentId, event.phone, decision.text, {
            teamId: ctx.teamId, leadId, leadName: contactName, jid: event.jid, isAutoReply: true, sentByUid: null,
          });
          sent = r.ok;
          if (!r.ok) console.warn('[waInbound] Baileys auto-reply failed', r.error);
        }
      }
      if (sent) {
        autoReply = decision.kind;
        await waConvRef.set({
          teamId: ctx.teamId, phone: event.phone, lastAutoReplyAt: now, lastAutoReplyKind: decision.kind, lastOutboundAt: now, updatedAt: now,
        }, { merge: true });
        // An auto-reply is outbound traffic for the 24h/first-contact history, but
        // NOT a staff answer: awaitingReply stays true and markConversationAnswered
        // is deliberately not called.
        await convRef.set({ lastOutboundAt: now, lastAutoReplyAt: now, updatedAt: now }, { merge: true }).catch(() => {});
      } else if (autoReply === null) {
        autoReply = { blocked: 'send-failed' };
      }
    }
  } catch (err) {
    console.error('[waInbound] auto-reply failed', err);
    autoReply = { blocked: 'send-failed' };
  }

  // 8. AI draft — last, best-effort. Only a TEXT message gets a suggestion (a
  //    photo or an opt-out keyword has nothing to answer). `draftWaReply` checks
  //    `waAiAssist`, the key, the 60s burst guard and the team's daily cap itself,
  //    and never throws; it stores the text on `conversations/{id}.suggestedReply`.
  let aiDraft: WaInboundResult['aiDraft'] = null;
  if (event.kind === 'text' && !optedOutNow && ctx.settings.waAiAssist !== 'off') {
    try {
      const r = await draftWaReply(ctx.teamId, conversationId, {
        settings: ctx.settings,
        businessId: ctx.businessId,
        forMessageId: event.waMessageId,
        byUid: null,
      });
      aiDraft = r.ok ? { suggested: true, forMessageId: r.forMessageId, model: r.model } : { blocked: r.blocked };
    } catch (err) {
      console.error('[waInbound] AI draft failed', err);
      aiDraft = { blocked: 'error' };
    }
  } else if (ctx.settings.waAiAssist === 'off') {
    aiDraft = { blocked: 'off' };
  }

  return {
    ok: true,
    leadId,
    customerId,
    conversationId,
    notified,
    leadCreateBlocked,
    newLead,
    autoReply,
    ...(optedOutNow ? { optedOut: true } : {}),
    aiDraft,
    ...(playbookEnrolled ? { playbookEnrolled } : {}),
  };
}

// ── HTTP: POST /api/wa-inbound (VPS → Vercel), Bearer CRON_SECRET ─────────────

function authorized(req: VercelRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;
  return !!(cronSecret && req.headers.authorization === `Bearer ${cronSecret}`);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!authorized(req)) return res.status(401).json({ error: 'Unauthorized' });

  let body: any = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Invalid JSON' }); }
  }
  const event = validateEvent(body);
  if (!event) return res.status(400).json({ error: 'Invalid WaEvent (channel, direction, teamId, waMessageId, phone required)' });

  try {
    const result = await processWaEvent(event);
    return res.status(200).json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[wa-inbound] processing failed', { teamId: event.teamId, phone: event.phone, waMessageId: event.waMessageId, msg });
    return res.status(500).json({ ok: false, error: msg });
  }
}
