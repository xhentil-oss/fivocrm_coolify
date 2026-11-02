import type { VercelRequest, VercelResponse } from '@vercel/node';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb, Timestamp } from './_firebaseAdmin.js';
import { getTeamConfig } from './_tenantConfig.js';
import { timingSafeEqualStr } from './_callerIdentity.js';
import {
  findLeadForContact,
  findCustomerForContact,
  crossLinkLeadCustomer,
  closeLeadsForClient,
  phoneQueryVariants,
} from './_contactIdentity.js';
import { isClientCustomer, isOpenLeadStatus } from './_contactRoute.js';
import { toWaPhone, waPhoneVariants } from './_waPhone.js';
import { managerIdsForBusiness } from './_staffRecipients.js';
import { notifyUser } from './_push.js';
import { sendMetaText, sendBaileysText } from './_waSend.js';
import { decideAutoReply, isOptOutMessage, isOptInMessage, DEFAULT_WA_TIMEZONE, type AutoReplyBlockReason } from './_waAutoReply.js';
import { draftWaReply, type DraftBlockReason } from './_aiReply.js';
// Ana, the virtual sales agent: when the module owns WhatsApp she replaces BOTH the
// static auto-reply (step 7 → 'agent-active') and the legacy AI draft (step 8).
import { runSalesAgentOnInbound, type SalesAgentInboundSummary } from './_salesAgent.js';
import { resolveSalesAgentSettings } from './_salesAgentCore.js';
import { resolvePlaybooks, matchPlaybookByKeywords, matchPlaybookByTags, enrollPlaybookPatch, withPlaybookTag, normalizeKeywordText } from './_playbooks.js';

// `leadActivities.type` for the playbook enrolment row. A const (not an inline literal)
// so the notification-type registry scan does not mistake it for a notification type.
const PLAYBOOK_ACTIVITY_TYPE = 'field_updated';
/** Same row type for the opt-out / opt-in (STOP / START) timeline entry. */
const OPT_ACTIVITY_TYPE = 'field_updated';

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
 *
 * Idempotency (Oct 2026): the VPS retries a POST that timed out while this
 * function was still running (up to 60 s), and Meta re-delivers webhooks. Every
 * event is CLAIMED first in `waInboundEvents/{key}` with `create()` (Admin SDK
 * only — server-only collection): ALREADY_EXISTS = duplicate, no side effects.
 * A claim stamped `failed` may be taken over after FAILED_RETRY_MS, a claim
 * still `processing` after CLAIM_STALE_MS (the run died without a stamp), a
 * `pending` one (Meta events left over by the webhook's time budget) at once.
 *
 * LID (privacy id, no phone yet): the VPS forwards `phone: ''` + `lid`. Such a
 * message never creates a lead; it is matched through `lidMappings` or a contact's
 * stored `waLid`, else routed to `conversations/wa-{teamId}-lid-{lid}`. A later
 * message carrying both stores `waLid` on the contact.
 */

export interface WaEvent {
  channel: 'baileys' | 'meta';
  /** outbound = a fromMe message the VPS saw (staff replied from the phone). */
  direction: 'inbound' | 'outbound';
  teamId: string;
  agentId?: string | null;
  metaPhoneNumberId?: string | null;
  channelPhone: string;
  /** The WhatsApp message id (Baileys key.id / Meta wamid). */
  waMessageId: string;
  /**
   * The `whatsappMessages` document id the channel wrote, when it differs from
   * `waMessageId` (the VPS moved Baileys rows to `${agentId}_${waMessageId}`).
   */
  messageDocId?: string | null;
  /** International digits (`toWaPhone`), or '' when only a LID is known. */
  phone: string;
  /** WhatsApp LID user part (digits, no `@lid`) — present when the VPS saw one. */
  lid?: string | null;
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

/** Returned instead of a result when the event was already claimed. */
export interface WaInboundDuplicate {
  ok: true;
  duplicate: true;
  /** Status of the existing claim: processing | done | failed | pending | dead. */
  status: string;
}

export interface WaInboundResult {
  ok: boolean;
  skipped?: WaInboundSkipReason;
  leadId: string | null;
  customerId: string | null;
  conversationId: string | null;
  /** Recipients whose bell row was written. */
  notified: number;
  /** Named reason when a lead was NOT auto-created for an unknown number. */
  leadCreateBlocked?: 'disabled' | 'lead-cap' | 'not-a-message' | 'no-phone' | null;
  newLead?: boolean;
  autoReply: 'outside-hours' | 'greeting' | { blocked: AutoReplyBlockReason | 'send-failed' } | null;
  /** The contact opted out with this message (keyword) — `waOptOut: true` was stamped on every record with this phone. */
  optedOut?: boolean;
  /** The contact resubscribed (START / FILLO / RIFILLO) — `waOptOut: false` stamped phone-wide. */
  optedIn?: boolean;
  /** Records stamped by the opt-out / opt-in (phone-level, same business). */
  optChanged?: { leads: number; customers: number };
  /** Only a LID was known — the message was routed to the LID conversation. */
  lidOnly?: boolean;
  /** B3 — "Sugjerim AI" written to `conversations/{id}.suggestedReply` (or the named reason it was not). */
  aiDraft: { suggested: true; forMessageId: string | null; model: string } | { blocked: DraftBlockReason } | null;
  /** The lead was auto-enrolled into this follow-up playbook (id) by keyword / tag match. */
  playbookEnrolled?: string;
  /** The virtual sales agent's decision for this message (api/_salesAgent.ts), when the module owns WhatsApp. */
  salesAgent?: SalesAgentInboundSummary | null;
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
/** Thread for a sender known only by LID (no deliverable phone yet). */
export const waLidConversationId = (teamId: string, lid: string) => `wa-${teamId}-lid-${lid}`;

/** `1234567@lid` / `1234567:12@lid` / `1234567` → `1234567`; '' when not a LID. */
export function normalizeLid(raw: unknown): string {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  const user = s.split('@')[0].split(':')[0];
  return /^\d{5,25}$/.test(user) ? user : '';
}

// ── Idempotency: waInboundEvents/{key} (server-only) ─────────────────────────

export const WA_INBOUND_EVENTS = 'waInboundEvents';
/** A `failed` claim may be retried after this long. */
export const FAILED_RETRY_MS = 2 * 60_000;
/** A `processing` claim older than this is a run that died without a stamp. */
export const CLAIM_STALE_MS = 2 * 60_000;
/** After this many attempts a claim is `dead` and only a person can replay it. */
export const MAX_INBOUND_ATTEMPTS = 3;
/** Claims are only needed while the senders still retry; `expireAt` is for a Firestore TTL policy. */
const INBOUND_EVENT_RETENTION_MS = 30 * 24 * 3_600_000;
const expireAt = () => Timestamp.fromMillis(Date.now() + INBOUND_EVENT_RETENTION_MS);

/** Firestore-safe document id for an idempotency key. */
export function inboundEventKey(raw: unknown): string {
  return String(raw ?? '').trim().replace(/[/\s]+/g, '_').replace(/^\.+/, '_').slice(0, 300);
}

const isAlreadyExists = (err: any): boolean =>
  err?.code === 6 || err?.code === 'already-exists' || /ALREADY_EXISTS/i.test(String(err?.message || ''));

export type InboundClaim = { claimed: true; attempt: number } | { claimed: false; status: string };

/**
 * Claim an event before ANY side effect. `create()` makes the first delivery win;
 * a retry of a failed/stale/pending claim takes it over in a transaction (so two
 * concurrent retries still produce one run).
 */
export async function claimInboundEvent(key: string, meta: Record<string, any> = {}): Promise<InboundClaim> {
  const ref = adminDb.collection(WA_INBOUND_EVENTS).doc(key);
  const now = Timestamp.now();
  try {
    await ref.create({ ...meta, status: 'processing', attempts: 1, claimedAt: now, createdAt: now, updatedAt: now, expireAt: expireAt() });
    return { claimed: true, attempt: 1 };
  } catch (err) {
    if (!isAlreadyExists(err)) throw err;
  }
  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const d = (snap.data() as any) || {};
    const status = String(d.status || 'unknown');
    const attempts = Number(d.attempts || 0);
    const nowMs = Date.now();
    const retryable =
      status === 'pending'
      || (status === 'failed' && nowMs - toMs(d.failedAt || d.updatedAt) >= FAILED_RETRY_MS)
      || (status === 'processing' && nowMs - toMs(d.claimedAt) >= CLAIM_STALE_MS);
    if (!retryable) return { claimed: false, status } as InboundClaim;
    if (attempts >= MAX_INBOUND_ATTEMPTS) {
      tx.update(ref, { status: 'dead', updatedAt: now });
      return { claimed: false, status: 'dead' } as InboundClaim;
    }
    tx.update(ref, { ...meta, status: 'processing', attempts: FieldValue.increment(1), claimedAt: now, updatedAt: now });
    return { claimed: true, attempt: attempts + 1 } as InboundClaim;
  });
}

/** Stamp the outcome of a claimed run. Never throws. */
export async function finishInboundEvent(
  key: string,
  status: 'done' | 'failed',
  extra: Record<string, any> = {},
): Promise<void> {
  const now = Timestamp.now();
  const patch: Record<string, any> = { ...extra, status, updatedAt: now };
  if (status === 'done') patch.doneAt = now;
  else patch.failedAt = now;
  await adminDb.collection(WA_INBOUND_EVENTS).doc(key).set(patch, { merge: true })
    .catch((err) => console.error('[waInbound] finishInboundEvent failed', { key, err }));
}

/**
 * Record an event that was NOT processed (the Meta webhook ran out of its time
 * budget) so the next webhook delivery drains it. Never overwrites an existing
 * claim. Never throws.
 */
export async function recordPendingInboundEvent(key: string, data: Record<string, any>): Promise<boolean> {
  const now = Timestamp.now();
  try {
    await adminDb.collection(WA_INBOUND_EVENTS).doc(key).create({
      ...data, status: 'pending', attempts: 0, createdAt: now, updatedAt: now, expireAt: expireAt(),
    });
    return true;
  } catch (err) {
    if (!isAlreadyExists(err)) console.error('[waInbound] recordPendingInboundEvent failed', { key, err });
    return false;
  }
}

/** Short, storable error text for a claim. */
export const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err)).slice(0, 500);

/**
 * Claim → process → stamp, for a `WaEvent`. A duplicate returns
 * `{ duplicate: true, status }` and does nothing else.
 */
export async function processWaEventOnce(
  rawEvent: WaEvent | Record<string, any>,
  idempotencyKey?: string | null,
): Promise<WaInboundResult | WaInboundDuplicate> {
  const event = validateEvent(rawEvent);
  if (!event) return emptyResult('invalid-event');
  const key = inboundEventKey(idempotencyKey || `${event.agentId || event.channel}_${event.waMessageId}`);
  const claim = await claimInboundEvent(key, {
    kind: 'wa-event',
    channel: event.channel,
    direction: event.direction,
    teamId: event.teamId,
    agentId: event.agentId ?? null,
    waMessageId: event.waMessageId,
  });
  if (!claim.claimed) return { ok: true, duplicate: true, status: claim.status };
  try {
    const result = await processWaEvent(event);
    await finishInboundEvent(key, 'done', {
      skipped: result.skipped ?? null,
      conversationId: result.conversationId ?? null,
      leadId: result.leadId ?? null,
      customerId: result.customerId ?? null,
    });
    return result;
  } catch (err) {
    await finishInboundEvent(key, 'failed', { error: errorText(err) });
    throw err;
  }
}

// ── Contact facts ────────────────────────────────────────────────────────────

type ContactDoc = FirebaseFirestore.QueryDocumentSnapshot | FirebaseFirestore.DocumentSnapshot;

/** Is this lead/customer document in the tenant? Legacy docs without businessId must carry the team. */
function docInTenant(data: any, ctx: { businessId: string; teamId: string }): boolean {
  if (!data) return false;
  if (data.businessId) return data.businessId === ctx.businessId;
  return data.teamId === ctx.teamId;
}

/** Every equality candidate for a stored phone (shared normaliser ∪ the identity helper's forms), max 10 for `in`. */
function phoneCandidates(phone: string): string[] {
  return Array.from(new Set([...waPhoneVariants(phone), ...phoneQueryVariants(phone)])).filter(Boolean).slice(0, 10);
}

/** All leads + customers of the business whose phone fields match `phone` in any stored form. */
async function contactsWithPhone(
  ctx: { businessId: string; teamId: string },
  phone: string,
): Promise<{ leads: ContactDoc[]; customers: ContactDoc[] }> {
  const variants = phoneCandidates(phone);
  if (!variants.length) return { leads: [], customers: [] };
  const q = (col: 'leads' | 'customers', field: string) =>
    adminDb.collection(col).where(field, 'in', variants).limit(50).get()
      .then((s) => s.docs)
      .catch((err) => { console.error(`[waInbound] ${col}.${field} phone query failed`, err); return [] as FirebaseFirestore.QueryDocumentSnapshot[]; });
  const [l1, l2, c1] = await Promise.all([q('leads', 'phoneNumber'), q('leads', 'phone'), q('customers', 'phone')]);
  const uniq = (docs: ContactDoc[]) => {
    const m = new Map<string, ContactDoc>();
    for (const d of docs) if (docInTenant(d.data(), ctx)) m.set(d.id, d);
    return [...m.values()];
  };
  return { leads: uniq([...l1, ...l2]), customers: uniq(c1) };
}

/**
 * STOP / NDALO / HIQ / UNSUBSCRIBE (optOut = true) or START / FILLO / RIFILLO
 * (optOut = false), applied to EVERY lead and customer of the business with this
 * phone — the person opted out, not one record of them. `known` adds the records
 * matched by id/LID (they may store the phone in a form no variant reaches).
 * One timeline row per lead whose state actually changed.
 */
async function setWaOptStatusForPhone(args: {
  ctx: { businessId: string; teamId: string };
  phone: string;
  optOut: boolean;
  at: FirebaseFirestore.Timestamp;
  known: { leads: ContactDoc[]; customers: ContactDoc[] };
  waMessageId: string;
  contactName: string;
}): Promise<{ leads: number; customers: number }> {
  const { ctx, phone, optOut, at, known } = args;
  const found = phone ? await contactsWithPhone(ctx, phone) : { leads: [], customers: [] };
  const merge = (a: ContactDoc[], b: ContactDoc[]) => {
    const m = new Map<string, ContactDoc>();
    for (const d of [...a, ...b]) if (d.exists && docInTenant(d.data(), ctx)) m.set(d.id, d);
    return [...m.values()];
  };
  const leads = merge(found.leads, known.leads);
  const customers = merge(found.customers, known.customers);
  const now = Timestamp.now();
  const patch: Record<string, any> = optOut
    ? { waOptOut: true, waOptOutAt: at, updatedAt: now }
    : { waOptOut: false, waOptInAt: at, updatedAt: now };
  const ops: Promise<unknown>[] = [];
  for (const d of leads) {
    const was = (d.data() as any)?.waOptOut === true;
    ops.push(adminDb.collection('leads').doc(d.id).set(patch, { merge: true }));
    if (was !== optOut) {
      ops.push(adminDb.collection('leadActivities').add({
        leadId: d.id,
        teamId: ctx.teamId,
        businessId: ctx.businessId,
        type: OPT_ACTIVITY_TYPE,
        title: optOut ? 'Çregjistrim nga mesazhet automatike WhatsApp' : 'Riregjistrim në mesazhet automatike WhatsApp',
        body: optOut ? 'Kontakti shkroi STOP / NDALO' : 'Kontakti shkroi START / FILLO',
        meta: { field: 'waOptOut', value: optOut, source: 'whatsapp-keyword', waMessageId: args.waMessageId },
        userId: null,
        userName: args.contactName || 'Sistemi',
        createdAt: at,
      }));
    }
  }
  for (const d of customers) ops.push(adminDb.collection('customers').doc(d.id).set(patch, { merge: true }));
  (await Promise.allSettled(ops)).forEach((r) => {
    if (r.status === 'rejected') console.error('[waInbound] opt status write failed', r.reason);
  });
  return { leads: leads.length, customers: customers.length };
}

/** Was the newest outbound row to this phone automated (reminder / campaign / automation)? Null = unknown. */
async function lastOutboundMessageFacts(teamId: string, phone: string): Promise<{ ms: number; automated: boolean } | null> {
  if (!phone) return null;
  try {
    const snap = await adminDb.collection('whatsappMessages')
      .where('teamId', '==', teamId)
      .where('phone', '==', phone)
      .orderBy('createdAt', 'desc')
      .limit(25)
      .get();
    const row = snap.docs.map((d) => d.data() as any).find((d) => d.direction === 'outbound');
    if (!row) return null;
    const automated = row.automated === true
      || (typeof row.automationKind === 'string' && !!row.automationKind)
      || !!row.campaignId || !!row.broadcastId || row.isCampaign === true;
    const ms = toMs(row.createdAt);
    return ms ? { ms, automated } : null;
  } catch (err) {
    console.warn('[waInbound] last-outbound facts unavailable', err);
    return null;
  }
}

/** The phone a LID maps to, from the VPS's `lidMappings` (written when Baileys learns it). */
async function phoneForLid(teamId: string, lid: string): Promise<string> {
  try {
    const snap = await adminDb.collection('lidMappings')
      .where('lid', '==', `${lid}@lid`)
      .where('teamId', '==', teamId)
      .limit(1)
      .get();
    const jid = (snap.docs[0]?.data() as any)?.phoneJid as string | undefined;
    return jid ? toWaPhone(jid.split('@')[0]) : '';
  } catch {
    return '';
  }
}

/** Leads / customers of the tenant that carry this `waLid`. */
async function contactsWithLid(ctx: { businessId: string; teamId: string }, lid: string) {
  const q = (col: 'leads' | 'customers') => adminDb.collection(col).where('waLid', '==', lid).limit(5).get()
    .then((s) => s.docs.filter((d) => docInTenant(d.data(), ctx)))
    .catch(() => [] as FirebaseFirestore.QueryDocumentSnapshot[]);
  const [leads, customers] = await Promise.all([q('leads'), q('customers')]);
  return { lead: leads[0] ?? null, customer: customers[0] ?? null };
}

/**
 * The `whatsappMessages` row the channel wrote: an explicit doc id, the VPS's
 * `${agentId}_${waMessageId}`, the bare id, else a `waMessageId` query. Null =
 * not found (never create a stray row from here).
 */
async function resolveMessageRef(event: WaEvent): Promise<FirebaseFirestore.DocumentReference | null> {
  const col = adminDb.collection('whatsappMessages');
  const ids = Array.from(new Set([
    event.messageDocId || '',
    event.agentId ? `${event.agentId}_${event.waMessageId}` : '',
    event.waMessageId,
  ].filter(Boolean)));
  try {
    const snaps = await adminDb.getAll(...ids.map((id) => col.doc(id)));
    const hit = snaps.find((s) => s.exists);
    if (hit) return hit.ref;
    const q = await col.where('waMessageId', '==', event.waMessageId).limit(1).get();
    return q.docs[0]?.ref ?? null;
  } catch {
    return null;
  }
}

// ── Body-supplied contact ids (send endpoints) ───────────────────────────────

export type ContactRefCheck =
  | { ok: true; leadId: string | null; customerId: string | null; leadName: string | null }
  | { ok: false; status: 400 | 403; error: string };

/**
 * A `leadId` / `customerId` from a request body is only a CLAIM: load each record
 * and prove it belongs to the caller's business (and, for a legacy record without
 * `businessId`, to a team of that business) before it is written anywhere.
 * Before this, a staff member could stamp another tenant's lead id onto a message
 * row and the "answered" stamp then wrote into that tenant's lead.
 */
export async function verifyContactRefs(args: {
  leadId?: unknown;
  customerId?: unknown;
  businessId: string;
  /** Team the send runs in (for legacy docs without businessId). */
  teamId?: string | null;
}): Promise<ContactRefCheck> {
  const clean = (v: unknown): string | null => {
    if (v == null || v === '') return null;
    return typeof v === 'string' && v.length <= 128 && !v.includes('/') ? v : '\u0000';
  };
  const leadId = clean(args.leadId);
  const customerId = clean(args.customerId);
  if (leadId === '\u0000' || customerId === '\u0000') return { ok: false, status: 400, error: 'leadId / customerId i pavlefshëm' };
  if (!args.businessId) return { ok: false, status: 403, error: 'Forbidden' };

  const belongs = async (data: any): Promise<boolean> => {
    if (!data) return false;
    if (data.businessId) return data.businessId === args.businessId;
    if (typeof data.teamId === 'string' && data.teamId) {
      if (args.teamId && data.teamId === args.teamId) return true;
      try {
        const t = await adminDb.collection('teams').doc(data.teamId).get();
        return ((t.data() as any)?.businessId || data.teamId) === args.businessId;
      } catch { return false; }
    }
    return false;
  };
  const [leadSnap, customerSnap] = await Promise.all([
    leadId ? adminDb.collection('leads').doc(leadId).get() : Promise.resolve(null),
    customerId ? adminDb.collection('customers').doc(customerId).get() : Promise.resolve(null),
  ]);
  // 403 whether the record is missing or foreign — never confirm another tenant's id exists.
  if (leadId && !(leadSnap?.exists && await belongs(leadSnap.data()))) {
    return { ok: false, status: 403, error: 'Lead-i nuk i përket biznesit tuaj' };
  }
  if (customerId && !(customerSnap?.exists && await belongs(customerSnap.data()))) {
    return { ok: false, status: 403, error: 'Klienti nuk i përket biznesit tuaj' };
  }
  const name = ((leadSnap?.data() as any)?.name || (customerSnap?.data() as any)?.name || null) as string | null;
  return { ok: true, leadId, customerId, leadName: name };
}

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
  /** Known contact ids (saves the identity lookup). Callers must have VERIFIED them (`verifyContactRefs`). */
  leadId?: string | null;
  customerId?: string | null;
  /** The reply went to a LID jid (no deliverable phone) — closes `wa-{teamId}-lid-{lid}`. */
  lid?: string | null;
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
  const phone = toWaPhone(args.phone);
  const lid = normalizeLid(args.lid);
  if (!args.teamId || (!phone && !lid)) return;
  const now = Timestamp.now();
  try {
    const convRef = adminDb.collection('conversations').doc(
      phone ? waConversationId(args.teamId, phone) : waLidConversationId(args.teamId, lid),
    );
    const convSnap = await convRef.get();
    const conv = (convSnap.data() as any) || null;

    let leadId = args.leadId ?? conv?.leadId ?? null;
    let customerId = args.customerId ?? conv?.customerId ?? null;
    let businessId: string | null = conv?.businessId ?? null;
    if (!leadId && !customerId && phone) {
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
    if (phone) {
      ops.push(adminDb.collection('whatsappConversations').doc(`${args.teamId}_${phone}`).set({
        teamId: args.teamId,
        phone,
        lastOutboundAt: now,
        updatedAt: now,
      }, { merge: true }));
    }
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
        // The linked customer is the same person — its "awaiting reply" closes too.
        if (!customerId && typeof lead.customerId === 'string' && lead.customerId) {
          await adminDb.collection('customers').doc(lead.customerId).update({
            awaitingReply: false, lastActivityAt: now, updatedAt: now,
          }).catch(() => { /* deleted customer — nothing to close */ });
        }
      })());
    }
    if (customerId) {
      // update(), not set(): a stale id must not create a stray customer doc.
      ops.push(adminDb.collection('customers').doc(customerId).update({
        awaitingReply: false,
        lastActivityAt: now,
        updatedAt: now,
      }));
    }
    const results = await Promise.allSettled(ops);
    results.forEach((r) => { if (r.status === 'rejected') console.error('[waInbound] markAnswered op failed', r.reason); });
  } catch (err) {
    console.error('[waInbound] markConversationAnswered failed', { teamId: args.teamId, phone, lid, err });
  }
}

// ── Inbound ────────────────────────────────────────────────────────────────────

function validateEvent(raw: any): WaEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.channel !== 'baileys' && raw.channel !== 'meta') return null;
  if (raw.direction !== 'inbound' && raw.direction !== 'outbound') return null;
  if (typeof raw.teamId !== 'string' || !raw.teamId) return null;
  if (typeof raw.waMessageId !== 'string' || !raw.waMessageId) return null;
  // Never treat a WhatsApp Channel (@newsletter), status (@broadcast) or group
  // (@g.us) as a contact — their ids are 18 digits and would otherwise become a
  // "lead" per post. Defence in depth: the VPS filters these too.
  const jidRaw = typeof raw.jid === 'string' ? raw.jid : '';
  if (/@(newsletter|broadcast|g\.us)$/.test(jidRaw)) return null;
  // LID: an explicit `lid`, else a `…@lid` jid. When the sender is a LID, the
  // `phone` the old VPS derived from it is NOT a phone — only trust an explicit
  // phone sent next to an explicit `lid` (the VPS resolved the mapping).
  const lid = normalizeLid(raw.lid) || (jidRaw.endsWith('@lid') ? normalizeLid(jidRaw) : '');
  const phoneTrusted = !(raw.isLid === true || jidRaw.endsWith('@lid')) || !!normalizeLid(raw.lid);
  const phone = phoneTrusted ? toWaPhone(typeof raw.phone === 'string' ? raw.phone : '') : '';
  if (!phone && !lid) return null;
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
    messageDocId: typeof raw.messageDocId === 'string' && raw.messageDocId && !raw.messageDocId.includes('/') ? raw.messageDocId : null,
    phone,
    lid: lid || null,
    jid: jidRaw || (phone ? `${phone}@s.whatsapp.net` : `${lid}@lid`),
    isLid: !phone,
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
  const validated = validateEvent(rawEvent);
  if (!validated) return emptyResult('invalid-event');
  const event: WaEvent = { ...validated };

  // A LID with no phone: the VPS's `lidMappings` may already know the number.
  if (!event.phone && event.lid) {
    const mapped = await phoneForLid(event.teamId, event.lid);
    if (mapped) event.phone = mapped;
  }

  // ── Outbound (fromMe from the phone, or an echo) ──
  if (event.direction === 'outbound') {
    if (event.isAutoReply) return emptyResult('auto-reply-echo');
    await markConversationAnswered({
      teamId: event.teamId, phone: event.phone, lid: event.lid ?? null,
      byUid: event.sentByUid ?? null, source: event.sentByUid ? 'app' : 'phone',
    });
    return {
      ...emptyResult(),
      conversationId: event.phone ? waConversationId(event.teamId, event.phone) : waLidConversationId(event.teamId, event.lid || ''),
    };
  }

  // 1. Tenant
  const tenant = await resolveTenant(event.teamId);
  if ('skipped' in tenant) return emptyResult(tenant.skipped);
  const ctx = tenant;
  const ts = new Date(event.timestamp);
  const tsStamp = Timestamp.fromDate(ts);
  const now = Timestamp.now();

  // 2. Contact — lead ‖ customer; both may exist, keep both ids.
  //    Phone known → identity by phone. LID only → a contact that stored this
  //    `waLid` earlier (its phone then routes the thread), else LID-only mode.
  let leadSnap: ContactDoc | null = null;
  let customerSnap: ContactDoc | null = null;
  let agentOwner: string | null;
  if (event.phone) {
    const lookup = { phone: event.phone, teamId: ctx.teamId, businessId: ctx.businessId };
    [leadSnap, customerSnap, agentOwner] = await Promise.all([
      findLeadForContact(adminDb, lookup),
      findCustomerForContact(adminDb, lookup),
      resolveAgentOwner(event, ctx.settings),
    ]);
  } else {
    const [byLid, owner] = await Promise.all([
      contactsWithLid(ctx, event.lid || ''),
      resolveAgentOwner(event, ctx.settings),
    ]);
    leadSnap = byLid.lead;
    customerSnap = byLid.customer;
    agentOwner = owner;
    const known = toWaPhone((leadSnap?.data() as any)?.phoneNumber || (leadSnap?.data() as any)?.phone || (customerSnap?.data() as any)?.phone || '');
    if (known) event.phone = known;
  }
  const lidOnly = !event.phone;
  let leadId = leadSnap?.id ?? null;
  const customerId = customerSnap?.id ?? null;
  const lead = (leadSnap?.data() as any) || null;
  const customer = (customerSnap?.data() as any) || null;
  if (leadId && customerId && (!lead?.customerId || !customer?.leadId)) {
    await crossLinkLeadCustomer(adminDb, leadId, customerId);
  }
  // A client never keeps an open lead (`_contactRoute.ts`): the message belongs
  // to the client, and the lead left open next to them is closed as converted —
  // so no playbook, cadence or lead SLA starts on someone who already buys.
  if (leadId && customerId && lead && isOpenLeadStatus(lead.status) && isClientCustomer({ id: customerId, status: customer?.status })) {
    if (await closeLeadsForClient(adminDb, [leadId], customerId)) lead.status = 'Converted';
  }
  let leadCreateBlocked: WaInboundResult['leadCreateBlocked'] = null;
  let newLead = false;
  if (!leadId && !customerId) {
    if (lidOnly) {
      // A LID is not a phone: a lead created on it could never be reached or deduped.
      leadCreateBlocked = 'no-phone';
    } else {
      try {
        const r = await autoCreateLead({ ctx, event, ts, agentOwner });
        leadId = r.leadId;
        leadCreateBlocked = r.blocked;
        newLead = !!r.leadId;
      } catch (err) {
        console.error('[waInbound] auto-create lead failed', err);
      }
    }
  }
  const contactName: string = (lead?.name || customer?.name || event.pushName || event.phone || `LID ${event.lid}`) as string;

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

  // 3. Enrich the message row the channel wrote (a retry re-merges the same values).
  //    Only an EXISTING row is enriched — never create a stray one from here.
  const enrich: Record<string, any> = { businessId: ctx.businessId, updatedAt: now };
  if (leadId) { enrich.leadId = leadId; enrich.leadName = contactName; }
  if (customerId) { enrich.customerId = customerId; if (!leadId) enrich.leadName = contactName; }
  if (event.phone && validated.phone !== event.phone) enrich.phone = event.phone; // LID resolved here
  if (event.lid) enrich.waLid = event.lid;
  const msgRef = await resolveMessageRef(event);
  if (msgRef) {
    await msgRef.set(enrich, { merge: true }).catch((err) => console.error('[waInbound] message enrich failed', err));
  } else {
    console.warn('[waInbound] message row not found for enrich', { teamId: ctx.teamId, waMessageId: event.waMessageId });
  }

  // 4. Conversation upsert
  const conversationId = lidOnly
    ? waLidConversationId(ctx.teamId, event.lid || '')
    : waConversationId(ctx.teamId, event.phone);
  const convRef = adminDb.collection('conversations').doc(conversationId);
  const [convSnap, threadSnap, membersSnap] = await Promise.all([
    convRef.get(),
    lidOnly ? Promise.resolve(null) : adminDb.collection('whatsappThreads').doc(`${ctx.teamId}_${event.phone}`).get(),
    adminDb.collection('teamMembers').where('businessId', '==', ctx.businessId).limit(200).get()
      .catch(() => null),
  ]);
  const existing = (convSnap.data() as any) || null;
  const wasAwaiting = existing?.awaitingReply === true;
  const ownerId: string | null =
    existing?.ownerId
    || (threadSnap?.data() as any)?.assignedToUserId
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
    lastInboundMessageId: event.waMessageId,
    // Ana coalesces a burst on the newest TEXT message; a photo must not swallow the question before it.
    lastInboundKind: event.kind,
    // Never move lastMessageAt backwards (a replayed/late event must not reorder the inbox).
    lastMessageAt: ts.getTime() >= toMs(existing?.lastMessageAt) ? tsStamp : existing?.lastMessageAt,
    updatedAt: now,
  };
  if (event.lid) { convPatch.waLid = event.lid; }
  if (lidOnly) { convPatch.jid = event.jid; convPatch.lidOnly = true; }
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

  // A LID thread opened earlier for this person now has a phone: point it at the real one.
  if (!lidOnly && event.lid) {
    const lidRef = adminDb.collection('conversations').doc(waLidConversationId(ctx.teamId, event.lid));
    lidRef.get().then((snap) => {
      if (!snap.exists || (snap.data() as any)?.resolvedConversationId === conversationId) return;
      return lidRef.set({ resolvedPhone: event.phone, resolvedConversationId: conversationId, awaitingReply: false, updatedAt: now }, { merge: true });
    }).catch((err) => console.warn('[waInbound] LID thread resolve failed', err));
  }

  // 5. Stamp the contact(s); one timeline row per awaitingReply transition.
  //    A whole-message STOP / NDALO / HIQ / UNSUBSCRIBE opts the PHONE out of
  //    every automatic message (auto-reply, greeting, reminders, campaigns) on
  //    every lead + customer of the business; START / FILLO / RIFILLO undoes it.
  //    No confirmation message is sent (none ever was for STOP — keep it that way).
  const optedOutNow = event.kind === 'text' && isOptOutMessage(event.text);
  const optedInNow = event.kind === 'text' && !optedOutNow && isOptInMessage(event.text);
  const stampOps: Promise<unknown>[] = [];
  const contactStamp: Record<string, any> = { lastInboundAt: tsStamp, awaitingReply: true, lastActivityAt: tsStamp, updatedAt: now };
  // Both a LID and a phone on one message: remember the LID, so a later LID-only message finds this contact.
  if (event.lid && !lidOnly) contactStamp.waLid = event.lid;
  const needsLidStamp = (d: any) => !!contactStamp.waLid && d?.waLid !== event.lid;
  if (leadId && (!newLead || needsLidStamp(lead))) stampOps.push(adminDb.collection('leads').doc(leadId).set(contactStamp, { merge: true }));
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
  let optChanged: { leads: number; customers: number } | undefined;
  if (optedOutNow || optedInNow) {
    try {
      // A lead created a moment ago is in `known` by id — a fresh snapshot is cheap.
      const knownLead = leadId ? await adminDb.collection('leads').doc(leadId).get() : null;
      optChanged = await setWaOptStatusForPhone({
        ctx,
        phone: event.phone,
        optOut: optedOutNow,
        at: tsStamp,
        known: { leads: knownLead ? [knownLead] : [], customers: customerSnap ? [customerSnap] : [] },
        waMessageId: event.waMessageId,
        contactName,
      });
    } catch (err) {
      console.error('[waInbound] opt status failed', err);
    }
  }

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
      actionUrl: lidOnly
        ? `/app/whatsapp?lid=${encodeURIComponent(event.lid || '')}`
        : `/app/whatsapp?phone=${encodeURIComponent(event.phone)}`,
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
  //    greeting is not. The newest OUTBOUND row decides `reply-to-automated`: a
  //    customer answering an invoice reminder ("e pagova sot") gets a person.
  let autoReply: WaInboundResult['autoReply'] = null;
  // The sales agent OWNS WhatsApp when enabled for the channel: one decision-maker per
  // inbound, never two motors answering the same message (static text + Ana).
  const salesAgentSettings = resolveSalesAgentSettings(ctx.settings.salesAgent);
  const agentOwnsWa = salesAgentSettings.enabled && salesAgentSettings.channels.whatsapp;
  if (lidOnly) {
    autoReply = { blocked: 'no-phone' };
  } else if (agentOwnsWa) {
    autoReply = { blocked: 'agent-active' };
  } else try {
    const waConvRef = adminDb.collection('whatsappConversations').doc(`${ctx.teamId}_${event.phone}`);
    const [waConvSnap, lastOut] = await Promise.all([
      waConvRef.get(),
      lastOutboundMessageFacts(ctx.teamId, event.phone),
    ]);
    const waConv = waConvSnap.data() as any;
    const maxMs = (...vals: any[]) => vals.reduce<number>((m, v) => Math.max(m, toMs(v)), 0) || null;
    const thisMs = ts.getTime();
    const before = (v: number | null) => (v && v < thisMs ? v : null);
    const priorOptOut = lead?.waOptOut === true || customer?.waOptOut === true;
    const decision = decideAutoReply({
      channel: event.channel,
      direction: event.direction,
      isAutoReply: !!event.isAutoReply,
      kind: event.kind,
      settings: ctx.settings,
      contact: {
        name: contactName,
        company: (lead?.company || customer?.company || '') as string,
        waOptOut: optedOutNow || (!optedInNow && priorOptOut),
      },
      history: {
        lastInboundBeforeMs: before(maxMs(existing?.lastInboundAt, lead?.lastInboundAt, customer?.lastInboundAt)),
        lastOutboundMs: maxMs(existing?.lastOutboundAt, waConv?.lastOutboundAt, lead?.lastFollowUpDate, lead?.lastActivityAt, customer?.lastActivityAt),
        lastAutoReplyMs: toMs(waConv?.lastAutoReplyAt) || null,
        lastOutboundMessageMs: lastOut?.ms ?? null,
        lastOutboundMessageAutomated: lastOut?.automated === true,
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
              channelPhone: event.channelPhone || toWaPhone(ch.phone),
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
  //    photo or an opt-out/opt-in keyword has nothing to answer), and never a
  //    LID-only thread (the drafter reads the thread by phone). `draftWaReply`
  //    checks `waAiAssist`, the key, the 60s burst guard and the team's daily cap
  //    itself, and never throws; it stores the text on `conversations/{id}.suggestedReply`.
  let aiDraft: WaInboundResult['aiDraft'] = null;
  let salesAgent: SalesAgentInboundSummary | null = null;
  if (agentOwnsWa) {
    // Ana decides (send / draft / handoff) — she gates opt-out, LID-only, media,
    // reply-to-automated, caps and bursts herself and never throws.
    salesAgent = await runSalesAgentOnInbound({
      teamId: ctx.teamId, businessId: ctx.businessId, cfg: ctx.settings,
      event: {
        channel: event.channel, agentId: event.agentId ?? null, metaPhoneNumberId: event.metaPhoneNumberId ?? null,
        phone: event.phone, jid: event.jid, channelPhone: event.channelPhone, text: event.text, kind: event.kind, waMessageId: event.waMessageId,
      },
      conversationId, leadId, customerId, lead, customer, contactName,
      optedOut: optedOutNow || (!optedInNow && (lead?.waOptOut === true || customer?.waOptOut === true)),
      lidOnly, conversationOwnerId: ownerId,
    });
  } else if (event.kind === 'text' && !optedOutNow && !optedInNow && !lidOnly && ctx.settings.waAiAssist !== 'off') {
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
    ...(optedInNow ? { optedIn: true } : {}),
    ...(optChanged ? { optChanged } : {}),
    ...(lidOnly ? { lidOnly: true } : {}),
    aiDraft,
    ...(salesAgent ? { salesAgent } : {}),
    ...(playbookEnrolled ? { playbookEnrolled } : {}),
  };
}

// ── HTTP: POST /api/wa-inbound (VPS → Vercel), Bearer CRON_SECRET ─────────────

function authorized(req: VercelRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  const header = typeof req.headers.authorization === 'string' ? req.headers.authorization : '';
  if (!header.startsWith('Bearer ')) return false;
  // Constant-time: a `===` on the secret leaks its length/prefix through timing.
  return timingSafeEqualStr(header.slice(7).trim(), cronSecret);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!authorized(req)) return res.status(401).json({ error: 'Unauthorized' });

  let body: any = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Invalid JSON' }); }
  }
  const event = validateEvent(body);
  if (!event) return res.status(400).json({ error: 'Invalid WaEvent (channel, direction, teamId, waMessageId, phone or lid required)' });

  // The VPS sends `Idempotency-Key: <agentId>_<msgId>`; without it the same key is derived.
  const headerKey = req.headers['idempotency-key'];
  const idempotencyKey = (Array.isArray(headerKey) ? headerKey[0] : headerKey) || null;

  try {
    const result = await processWaEventOnce(event, idempotencyKey);
    if ('duplicate' in result) {
      // A run that FAILED moments ago is not done — answer 5xx so the sender
      // logs it loudly instead of believing it was delivered. In-flight / done = 200.
      if (result.status === 'failed' || result.status === 'dead') {
        return res.status(503).json({ ...result, error: 'Ngjarja dështoi më parë — riprovohet pas 2 minutash' });
      }
      return res.status(200).json(result);
    }
    return res.status(200).json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[wa-inbound] processing failed', { teamId: event.teamId, phone: event.phone, waMessageId: event.waMessageId, msg });
    return res.status(500).json({ ok: false, error: msg });
  }
}
