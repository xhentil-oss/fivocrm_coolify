import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';
import { adminDb, Timestamp } from './_firebaseAdmin.js';
import {
  processWaEvent,
  claimInboundEvent,
  finishInboundEvent,
  recordPendingInboundEvent,
  inboundEventKey,
  errorText,
  WA_INBOUND_EVENTS,
} from './_waInbound.js';
import { timingSafeEqualStr } from './_callerIdentity.js';
import { toWaPhone } from './_waPhone.js';

/**
 * Meta WhatsApp Cloud API Webhook
 *
 * GET  — Webhook verification (Meta sends a challenge)
 * POST — Incoming messages from Meta Cloud API
 *
 * Requires env vars:
 *   META_WEBHOOK_VERIFY_TOKEN — a secret string you choose during webhook setup
 *   META_APP_SECRET           — Meta App Secret used to HMAC-sign POST bodies
 *
 * This file owns ONLY the channel: HMAC verification, team resolution, payload
 * parsing, the bare `whatsappMessages` row (id == Meta message id, idempotent),
 * the 24h-window tracker and delivery-status updates. Everything that makes the
 * message MEAN something — contact identity (lead ‖ customer), the
 * `conversations/wa-*` thread, notifications, auto-reply — lives in
 * api/_waInbound.ts and is shared with the Baileys channel.
 *
 * Meta is answered 200 AFTER processing (inside `maxDuration: 30`, vercel.json):
 * on Vercel, work after the response is not guaranteed to run, and the old
 * "respond first, then ~10 round-trips + a Meta send" silently lost auto-replies.
 * Any exception still returns 200 — Meta retries non-2xx.
 *
 * Bounded (Oct 2026): processing runs under a PROCESS_BUDGET_MS budget with a
 * per-event try/catch. An event the budget does not reach is written to
 * `waInboundEvents` as `pending` (with its raw payload) and drained by the NEXT
 * webhook delivery — there is no other consumer. Every message is claimed by
 * wamid first (`meta_<wamid>`), so a Meta re-delivery is a no-op.
 *
 * Status updates never regress (sent < delivered < read; `failed` only before
 * delivery) and land on `doc(wamid)` or, failing that, the row whose
 * `waMessageId == wamid` (Baileys rows live at `${agentId}_${id}`).
 */

// Disable Vercel's automatic body parser — we need the raw bytes to verify HMAC.
export const config = {
  api: { bodyParser: false },
};

/** Everything not processed within this budget is recorded as `pending` (maxDuration is 30 s). */
const PROCESS_BUDGET_MS = 20_000;
/** Pending / failed events drained per delivery, when budget remains. */
const DRAIN_LIMIT = 10;

/** Meta sends international digits; the shared normaliser keeps one rule set. */
const metaPhone = (raw: unknown): string => toWaPhone(raw) || String(raw ?? '').replace(/\D/g, '');

async function readRawBody(req: VercelRequest): Promise<Buffer> {
  return await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function verifyMetaSignature(raw: Buffer, signatureHeader: string | undefined, appSecret: string): boolean {
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) return false;
  const expected = crypto.createHmac('sha256', appSecret).update(raw).digest('hex');
  const provided = signatureHeader.slice(7);
  if (expected.length !== provided.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(provided, 'hex'));
  } catch {
    return false;
  }
}

/**
 * Which team owns this Meta phone number (multi-number array → legacy flat field
 * → WABA id). A `phone_number_id` is NOT unique across teamSettings (two teams
 * can paste the same number), so every candidate is read and ONE is chosen
 * deterministically — `metaEnabled` first, then the most recently updated, then
 * the id — and the collision is logged. Never fan out to several tenants.
 */
async function resolveTeamId(metaPhoneNumberId: string | undefined, wabaId: string | undefined): Promise<string> {
  const candidates = new Map<string, Record<string, any>>();
  const collect = async (field: string, op: '==' | 'array-contains', value: string) => {
    const snap = await adminDb.collection('teamSettings').where(field, op, value).limit(10).get();
    snap.docs.forEach((d) => candidates.set(d.id, (d.data() as any) || {}));
  };
  if (metaPhoneNumberId) {
    await Promise.all([
      collect('metaPhoneNumberIds', 'array-contains', metaPhoneNumberId),
      collect('metaPhoneNumberId', '==', metaPhoneNumberId),
    ]);
  }
  if (!candidates.size && wabaId) await collect('metaBusinessAccountId', '==', wabaId);
  if (!candidates.size) return '';
  const updatedMs = (d: Record<string, any>) => {
    const v = d.updatedAt;
    if (v && typeof v.toMillis === 'function') return v.toMillis();
    const t = v ? new Date(v).getTime() : 0;
    return Number.isFinite(t) ? t : 0;
  };
  const ranked = [...candidates.entries()].sort(([ia, a], [ib, b]) =>
    (b.metaEnabled === true ? 1 : 0) - (a.metaEnabled === true ? 1 : 0)
    || updatedMs(b) - updatedMs(a)
    || ia.localeCompare(ib));
  if (ranked.length > 1) {
    console.warn('[meta-webhook] phone_number_id claimed by several teams — routing to ONE', {
      metaPhoneNumberId, wabaId, chosen: ranked[0][0], others: ranked.slice(1).map(([id]) => id),
    });
  }
  return ranked[0][0];
}

interface ParsedMedia {
  text: string;
  /** What the shared handler sees: text-like replies (buttons, list picks) are `text`. */
  kind: 'text' | 'media' | 'system';
  mediaType: string | null;
  metaMediaId: string | null;
  mediaMimeType: string | null;
  mediaFilename: string | null;
}

/**
 * Text + media descriptors for one Meta message. `null` = nothing to store (a
 * reaction is not a message). Button / interactive replies are the customer's
 * words — "Po, konfirmoj" tapped on a template quick-reply must reach the same
 * handler as typed text (opt-out keywords, playbooks, AI draft).
 */
function parseMessage(msg: any): ParsedMedia | null {
  const out: ParsedMedia = { text: '', kind: 'media', mediaType: null, metaMediaId: null, mediaMimeType: null, mediaFilename: null };
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  switch (msg?.type) {
    case 'text':
      out.text = str(msg.text?.body);
      out.kind = 'text';
      break;
    case 'button':
      // Template quick-reply: `text` is the label the customer tapped, `payload` is ours.
      out.text = str(msg.button?.text) || str(msg.button?.payload) || '[Buton]';
      out.kind = 'text';
      break;
    case 'interactive': {
      const i = msg.interactive || {};
      out.text = str(i.button_reply?.title) || str(i.list_reply?.title)
        || str(i.button_reply?.id) || str(i.list_reply?.id) || '[Përgjigje interaktive]';
      out.kind = 'text';
      break;
    }
    case 'image':
      out.text = str(msg.image?.caption) || '[Foto]';
      out.mediaType = 'image'; out.metaMediaId = msg.image?.id || null; out.mediaMimeType = msg.image?.mime_type || null;
      break;
    case 'video':
      out.text = str(msg.video?.caption) || '[Video]';
      out.mediaType = 'video'; out.metaMediaId = msg.video?.id || null; out.mediaMimeType = msg.video?.mime_type || null;
      break;
    case 'audio':
      out.text = msg.audio?.voice ? '[Mesazh zanor]' : '[Audio]';
      out.mediaType = 'audio'; out.metaMediaId = msg.audio?.id || null; out.mediaMimeType = msg.audio?.mime_type || null;
      break;
    case 'document':
      out.text = str(msg.document?.caption) || str(msg.document?.filename) || '[Dokument]';
      out.mediaType = 'document'; out.metaMediaId = msg.document?.id || null;
      out.mediaMimeType = msg.document?.mime_type || null; out.mediaFilename = msg.document?.filename || null;
      break;
    case 'location': {
      const l = msg.location || {};
      const where = [str(l.name), str(l.address)].filter(Boolean).join(', ');
      const lat = Number(l.latitude);
      const lng = Number(l.longitude);
      const map = l.latitude != null && l.longitude != null && Number.isFinite(lat) && Number.isFinite(lng)
        ? `https://maps.google.com/?q=${lat},${lng}` : '';
      out.text = ['📍 Vendndodhje', where, map].filter(Boolean).join(' — ');
      break;
    }
    case 'contacts': {
      const list: any[] = Array.isArray(msg.contacts) ? msg.contacts : [];
      const parts = list.slice(0, 5).map((c) => {
        const name = str(c?.name?.formatted_name) || [str(c?.name?.first_name), str(c?.name?.last_name)].filter(Boolean).join(' ');
        const phone = str(c?.phones?.[0]?.phone) || str(c?.phones?.[0]?.wa_id);
        return [name, phone].filter(Boolean).join(' ');
      }).filter(Boolean);
      out.text = parts.length ? `👤 Kontakt: ${parts.join('; ')}` : '[Kontakt]';
      break;
    }
    case 'sticker':
      out.text = '[Sticker]';
      out.mediaType = 'sticker'; out.metaMediaId = msg.sticker?.id || null; out.mediaMimeType = msg.sticker?.mime_type || null;
      break;
    case 'reaction':
      return null;
    case 'system':
      out.text = str(msg.system?.body) || '[Sistem]';
      out.kind = 'system';
      break;
    default:
      out.text = `[${msg?.type || 'Media'}]`;
  }
  return out;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // ── GET: Webhook verification ───────────────────────────────────────────────
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    const verifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN;
    if (!verifyToken) {
      console.error('[meta-webhook] META_WEBHOOK_VERIFY_TOKEN not configured');
      return res.status(500).send('Server not configured');
    }

    if (mode === 'subscribe' && timingSafeEqualStr(Array.isArray(token) ? token[0] : token, verifyToken)) {
      console.log('[meta-webhook] Webhook verified');
      return res.status(200).send(challenge);
    }
    return res.status(403).send('Forbidden');
  }

  // ── POST: Incoming messages ─────────────────────────────────────────────────
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const startedAt = Date.now();

  // Read raw body for HMAC verification (bodyParser is disabled above).
  let raw: Buffer;
  try {
    raw = await readRawBody(req);
  } catch (e) {
    console.error('[meta-webhook] Failed to read body:', e);
    return res.status(400).send('Bad body');
  }

  // Verify Meta's X-Hub-Signature-256. If META_APP_SECRET is missing we reject
  // outright (fail CLOSED) — webhook MUST be authenticated to prevent fake message injection.
  const appSecret = process.env.META_APP_SECRET;
  if (!appSecret) {
    console.error('[meta-webhook] META_APP_SECRET not configured — rejecting POST');
    return res.status(503).send('Server not configured');
  }
  const sigHeader = (req.headers['x-hub-signature-256'] as string | undefined) ||
    (req.headers['X-Hub-Signature-256'] as unknown as string | undefined);
  if (!verifyMetaSignature(raw, sigHeader, appSecret)) {
    console.warn('[meta-webhook] Invalid or missing X-Hub-Signature-256 — rejecting');
    return res.status(403).send('Invalid signature');
  }

  let body: any;
  try {
    body = JSON.parse(raw.toString('utf8'));
  } catch {
    return res.status(400).send('Invalid JSON');
  }

  // Process FIRST (bounded), answer 200 after — see the header. Wrapped so that an
  // exception anywhere still yields a 200 (Meta retries non-2xx; leftovers are
  // recorded as `pending` and drained by the next delivery).
  const deadline = startedAt + PROCESS_BUDGET_MS;
  try {
    await processPayload(body, deadline);
  } catch (err) {
    console.error('[meta-webhook] Processing error:', err);
  }
  try {
    if (Date.now() < deadline) await drainPending(deadline);
  } catch (err) {
    console.error('[meta-webhook] Drain error:', err);
  }
  return res.status(200).json({ status: 'ok' });
}

// ── Pipeline ─────────────────────────────────────────────────────────────────

interface TeamCtx { teamId: string; businessId: string }

interface MessageJob {
  kind: 'meta-message';
  key: string;
  team: TeamCtx;
  metadata: { phone_number_id: string | null; display_phone_number: string | null };
  msg: any;
  contactName: string | null;
}

interface StatusJob {
  kind: 'meta-status';
  key: string;
  status: any;
}

type Job = MessageJob | StatusJob;

/** Firestore cannot store `undefined`; Meta JSON has none, but a round-trip makes sure. */
const plain = (v: unknown): any => JSON.parse(JSON.stringify(v ?? null));

async function processPayload(body: any, deadline: number): Promise<void> {
  if (body?.object !== 'whatsapp_business_account') return;

  // teams/{teamId}.businessId, resolved once per request per team.
  const businessIdByTeam = new Map<string, string>();
  const businessIdFor = async (teamId: string): Promise<string> => {
    const cached = businessIdByTeam.get(teamId);
    if (cached) return cached;
    let businessId = teamId;
    try {
      const teamDoc = await adminDb.collection('teams').doc(teamId).get();
      businessId = ((teamDoc.data() as any)?.businessId as string | undefined) || teamId;
    } catch { /* legacy fallback: teamId */ }
    businessIdByTeam.set(teamId, businessId);
    return businessId;
  };

  // 1. Flatten the payload into jobs (team resolution is cheap and needed for the pending record).
  const jobs: Job[] = [];
  for (const entry of body.entry || []) {
    const wabaId = entry?.id; // WhatsApp Business Account ID
    for (const change of entry?.changes || []) {
      if (change?.field !== 'messages') continue;
      const value = change.value;
      if (!value) continue;
      const metaPhoneNumberId: string | undefined = value.metadata?.phone_number_id;

      for (const status of value.statuses || []) {
        if (!status?.id || !status?.status) continue;
        jobs.push({ kind: 'meta-status', key: inboundEventKey(`meta_status_${status.id}_${status.status}`), status: plain(status) });
      }

      const messages: any[] = Array.isArray(value.messages) ? value.messages : [];
      if (!messages.length) continue;
      let teamId = '';
      try {
        teamId = await resolveTeamId(metaPhoneNumberId, wabaId);
      } catch (err) {
        console.error('[meta-webhook] team resolution failed', { metaPhoneNumberId, wabaId, err });
      }
      if (!teamId) {
        console.warn(`[meta-webhook] No team found for phoneNumberId=${metaPhoneNumberId}, wabaId=${wabaId} — ${messages.length} message(s) dropped`);
        continue;
      }
      const team = { teamId, businessId: await businessIdFor(teamId) };
      for (const msg of messages) {
        if (!msg?.id) continue;
        if (msg.type === 'reaction') continue; // reactions carry nothing to store or answer
        jobs.push({
          kind: 'meta-message',
          key: inboundEventKey(`meta_${msg.id}`),
          team,
          metadata: {
            phone_number_id: metaPhoneNumberId || null,
            display_phone_number: value.metadata?.display_phone_number || null,
          },
          msg: plain(msg),
          contactName: value.contacts?.find((c: any) => c?.wa_id === msg.from)?.profile?.name || null,
        });
      }
    }
  }

  // 2. Run them inside the budget; record the rest.
  let deferred = 0;
  for (const job of jobs) {
    if (Date.now() >= deadline) {
      const recorded = await recordPendingInboundEvent(job.key, pendingRecord(job));
      deferred++;
      if (!recorded) console.warn('[meta-webhook] could not record deferred event', job.key);
      continue;
    }
    try {
      if (job.kind === 'meta-status') await applyStatus(job.status);
      else await runMessageJob(job);
    } catch (err) {
      // Per-event isolation: one bad event never costs the others.
      console.error(`[meta-webhook] ${job.kind} ${job.key} failed:`, err);
    }
  }
  if (deferred) console.warn(`[meta-webhook] time budget exhausted — ${deferred} event(s) recorded as pending in ${WA_INBOUND_EVENTS}`);
}

function pendingRecord(job: Job): Record<string, any> {
  if (job.kind === 'meta-status') {
    return { kind: 'meta-status', channel: 'meta', payload: { status: job.status } };
  }
  return {
    kind: 'meta-message',
    channel: 'meta',
    teamId: job.team.teamId,
    businessId: job.team.businessId,
    waMessageId: job.msg?.id || null,
    payload: { metadata: job.metadata, msg: job.msg, contactName: job.contactName },
  };
}

/** One message: claim by wamid → bare row → 24h tracker → shared handler → stamp. */
async function runMessageJob(job: MessageJob, alreadyClaimed = false): Promise<void> {
  if (!alreadyClaimed) {
    const claim = await claimInboundEvent(job.key, {
      kind: 'meta-message', channel: 'meta', teamId: job.team.teamId, businessId: job.team.businessId, waMessageId: job.msg?.id || null,
    });
    if (!claim.claimed) return; // Meta re-delivery (or in flight) — no side effects
  }
  try {
    await ingestMessage(job);
    await finishInboundEvent(job.key, 'done');
  } catch (err) {
    // Keep the payload so the drain can retry it after FAILED_RETRY_MS.
    await finishInboundEvent(job.key, 'failed', { error: errorText(err), ...pendingRecord(job) });
    throw err;
  }
}

async function ingestMessage(job: MessageJob): Promise<void> {
  const { teamId, businessId } = job.team;
  const msg = job.msg;
  const parsed = parseMessage(msg);
  if (!parsed) return;

  const metaPhoneNumberId = job.metadata.phone_number_id || null;
  const channelPhone = toWaPhone(job.metadata.display_phone_number || '');
  const from = metaPhone(msg.from); // sender phone
  const waMessageId: string = msg.id;
  const tsSec = Number(msg.timestamp);
  const ts = Number.isFinite(tsSec) && tsSec > 0 ? new Date(tsSec * 1000) : new Date();
  const contactName = job.contactName;

  // The bare row — written by the channel first, so the record never depends on
  // the rest of the pipeline. `_waInbound` merges identity onto it.
  await adminDb.collection('whatsappMessages').doc(waMessageId).set({
    phone: from,
    jid: `${from}@s.whatsapp.net`,
    direction: 'inbound' as const,
    message: parsed.text,
    messageType: msg.type || null,
    // The template button the customer tapped (its payload is ours, the text is theirs).
    ...(msg.type === 'button' && msg.button?.payload ? { buttonPayload: String(msg.button.payload).slice(0, 256) } : {}),
    // A reply to one of our messages carries its id — the thread can show what was answered.
    ...(msg.context?.id ? { replyToWaMessageId: String(msg.context.id) } : {}),
    waMessageId,
    leadName: contactName,
    pushName: contactName,
    teamId,
    businessId,
    status: 'received',
    channel: 'meta',
    channelPhone,
    metaPhoneNumberId,
    isLid: false,
    mediaType: parsed.mediaType,
    metaMediaId: parsed.metaMediaId,
    mediaMimeType: parsed.mediaMimeType,
    mediaFilename: parsed.mediaFilename,
    createdAt: Timestamp.fromDate(ts),
    updatedAt: Timestamp.fromDate(new Date()),
  }, { merge: true });

  // ── 24-hour customer-service window tracking ────────────────────────
  try {
    await adminDb.collection('whatsappConversations').doc(`${teamId}_${from}`).set({
      teamId,
      phone: from,
      lastInboundAt: Timestamp.fromDate(ts),
      channel: 'meta',
      updatedAt: Timestamp.fromDate(new Date()),
    }, { merge: true });
  } catch (e) {
    console.warn('[meta-webhook] conv tracker update failed:', e);
  }

  // ── Identity → conversation → notify → auto-reply (shared handler) ──
  // Not wrapped: a throw marks the claim `failed` so the drain retries it.
  await processWaEvent({
    channel: 'meta',
    direction: 'inbound',
    teamId,
    agentId: null,
    metaPhoneNumberId,
    channelPhone,
    waMessageId,
    messageDocId: waMessageId,
    phone: from,
    jid: `${from}@s.whatsapp.net`,
    isLid: false,
    text: parsed.text,
    kind: parsed.kind,
    pushName: contactName,
    isAutoReply: false,
    timestamp: ts.toISOString(),
  });

  console.log(`[meta-webhook] ← ${from.slice(0, 5)}…: ${parsed.text.slice(0, 80)}`);
}

// ── Delivery status (monotonic) ───────────────────────────────────────────────

const STATUS_RANK: Record<string, number> = { pending: 0, received: 0, sent: 1, delivered: 2, read: 3, played: 3 };

/**
 * May `next` overwrite `current`? sent < delivered < read, never backwards.
 * `failed` only before delivery; after a `failed`, only delivered/read win
 * (a late `sent` must not hide the failure).
 */
export function metaStatusAdvances(current: string | null | undefined, next: string): boolean {
  const cur = String(current || '');
  if (cur === next) return false;
  if (next === 'failed') return !(STATUS_RANK[cur] >= 2);
  if (!(next in STATUS_RANK)) return false;
  if (cur === 'failed') return STATUS_RANK[next] >= 2;
  return STATUS_RANK[next] > (STATUS_RANK[cur] ?? -1);
}

async function applyStatus(status: any): Promise<void> {
  const wamid = typeof status?.id === 'string' ? status.id : '';
  const next = ({ sent: 'sent', delivered: 'delivered', read: 'read', failed: 'failed' } as Record<string, string>)[status?.status];
  if (!wamid || !next) return;

  const col = adminDb.collection('whatsappMessages');
  let ref = col.doc(wamid);
  let snap = await ref.get();
  if (!snap.exists) {
    const q = await col.where('waMessageId', '==', wamid).limit(1).get();
    if (q.empty) return;
    ref = q.docs[0].ref;
  }

  await adminDb.runTransaction(async (tx) => {
    snap = await tx.get(ref);
    if (!snap.exists) return;
    const current = (snap.data() as any)?.status as string | undefined;
    if (!metaStatusAdvances(current, next)) return;
    const now = Timestamp.now();
    const tsSec = Number(status.timestamp);
    const at = Number.isFinite(tsSec) && tsSec > 0 ? Timestamp.fromMillis(tsSec * 1000) : now;
    const patch: Record<string, any> = { status: next, updatedAt: now, [`${next}At`]: at };
    if (next === 'failed') {
      const e = Array.isArray(status.errors) ? status.errors[0] : null;
      patch.error = e
        ? {
          code: typeof e.code === 'number' || typeof e.code === 'string' ? e.code : null,
          title: String(e.title || e.message || '').slice(0, 300) || null,
          message: String(e.message || '').slice(0, 300) || null,
          details: String(e.error_data?.details || '').slice(0, 500) || null,
        }
        : { code: null, title: 'Dështoi (pa detaje nga Meta)', message: null, details: null };
    }
    tx.update(ref, patch);
  });
}

// ── Drain: events a previous delivery could not reach ─────────────────────────

async function drainPending(deadline: number): Promise<void> {
  const col = adminDb.collection(WA_INBOUND_EVENTS);
  const [pending, failed] = await Promise.all([
    // `channel == meta`: a failed Baileys claim has no payload to replay and must not fill the page.
    col.where('status', '==', 'pending').where('channel', '==', 'meta').limit(DRAIN_LIMIT).get(),
    col.where('status', '==', 'failed').where('channel', '==', 'meta').limit(DRAIN_LIMIT).get(),
  ]);
  const docs = [...pending.docs, ...failed.docs].filter((d) => {
    const k = (d.data() as any)?.kind;
    return (k === 'meta-message' || k === 'meta-status') && (d.data() as any)?.payload;
  });
  for (const d of docs) {
    if (Date.now() >= deadline) return;
    const data = d.data() as any;
    try {
      // Same claim as a live event: a failed one waits FAILED_RETRY_MS, attempts are capped.
      const claim = await claimInboundEvent(d.id);
      if (!claim.claimed) continue;
      if (data.kind === 'meta-status') {
        await applyStatus(data.payload.status);
        await finishInboundEvent(d.id, 'done');
      } else {
        await runMessageJob({
          kind: 'meta-message',
          key: d.id,
          team: { teamId: data.teamId, businessId: data.businessId || data.teamId },
          metadata: data.payload.metadata || { phone_number_id: null, display_phone_number: null },
          msg: data.payload.msg,
          contactName: data.payload.contactName ?? null,
        }, true);
      }
    } catch (err) {
      console.error(`[meta-webhook] drain ${d.id} failed:`, err);
      if (data.kind === 'meta-status') await finishInboundEvent(d.id, 'failed', { error: errorText(err) });
    }
  }
}
