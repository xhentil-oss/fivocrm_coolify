import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';
import { adminDb, Timestamp } from './_firebaseAdmin.js';
import { processWaEvent } from './_waInbound.js';

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
 * Any exception still returns 200 — Meta retries non-2xx, and a retry would only
 * re-run idempotent upserts.
 */

// Disable Vercel's automatic body parser — we need the raw bytes to verify HMAC.
export const config = {
  api: { bodyParser: false },
};

function normalizePhone(raw: string): string {
  const digits = raw.replace(/[^\d]/g, '');
  if (/^3550[6-9]/.test(digits)) return '355' + digits.slice(4);
  if (/^0[6-9]/.test(digits)) return '355' + digits.slice(1);
  return digits;
}

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

/** Which team owns this Meta phone number (multi-number array → legacy flat field → WABA id). */
async function resolveTeamId(metaPhoneNumberId: string | undefined, wabaId: string | undefined): Promise<string> {
  if (metaPhoneNumberId) {
    const idsSnap = await adminDb.collection('teamSettings')
      .where('metaPhoneNumberIds', 'array-contains', metaPhoneNumberId)
      .limit(1)
      .get();
    if (!idsSnap.empty) return idsSnap.docs[0].id;

    const teamSnap = await adminDb.collection('teamSettings')
      .where('metaPhoneNumberId', '==', metaPhoneNumberId)
      .limit(1)
      .get();
    if (!teamSnap.empty) return teamSnap.docs[0].id;
  }
  if (wabaId) {
    const wabaSnap = await adminDb.collection('teamSettings')
      .where('metaBusinessAccountId', '==', wabaId)
      .limit(1)
      .get();
    if (!wabaSnap.empty) return wabaSnap.docs[0].id;
  }
  return '';
}

interface ParsedMedia {
  text: string;
  mediaType: string | null;
  metaMediaId: string | null;
  mediaMimeType: string | null;
  mediaFilename: string | null;
}

/** Text placeholder + media descriptors for one Meta message. `null` = skip (reaction). */
function parseMessage(msg: any): ParsedMedia | null {
  const out: ParsedMedia = { text: '', mediaType: null, metaMediaId: null, mediaMimeType: null, mediaFilename: null };
  switch (msg.type) {
    case 'text':
      out.text = msg.text?.body || '';
      break;
    case 'image':
      out.text = msg.image?.caption || '[Foto]';
      out.mediaType = 'image'; out.metaMediaId = msg.image?.id || null; out.mediaMimeType = msg.image?.mime_type || null;
      break;
    case 'video':
      out.text = msg.video?.caption || '[Video]';
      out.mediaType = 'video'; out.metaMediaId = msg.video?.id || null; out.mediaMimeType = msg.video?.mime_type || null;
      break;
    case 'audio':
      out.text = '[Audio]';
      out.mediaType = 'audio'; out.metaMediaId = msg.audio?.id || null; out.mediaMimeType = msg.audio?.mime_type || null;
      break;
    case 'document':
      out.text = msg.document?.filename || '[Dokument]';
      out.mediaType = 'document'; out.metaMediaId = msg.document?.id || null;
      out.mediaMimeType = msg.document?.mime_type || null; out.mediaFilename = msg.document?.filename || null;
      break;
    case 'location':
      out.text = '[Vendndodhje]';
      break;
    case 'contacts':
      out.text = '[Kontakt]';
      break;
    case 'sticker':
      out.text = '[Sticker]';
      out.mediaType = 'sticker'; out.metaMediaId = msg.sticker?.id || null; out.mediaMimeType = msg.sticker?.mime_type || null;
      break;
    case 'reaction':
      return null;
    default:
      out.text = `[${msg.type || 'Media'}]`;
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

    if (mode === 'subscribe' && token === verifyToken) {
      console.log('[meta-webhook] Webhook verified');
      return res.status(200).send(challenge);
    }
    return res.status(403).send('Forbidden');
  }

  // ── POST: Incoming messages ─────────────────────────────────────────────────
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Read raw body for HMAC verification (bodyParser is disabled above).
  let raw: Buffer;
  try {
    raw = await readRawBody(req);
  } catch (e) {
    console.error('[meta-webhook] Failed to read body:', e);
    return res.status(400).send('Bad body');
  }

  // Verify Meta's X-Hub-Signature-256. If META_APP_SECRET is missing we reject
  // outright — webhook MUST be authenticated to prevent fake message injection.
  const appSecret = process.env.META_APP_SECRET;
  if (!appSecret) {
    console.error('[meta-webhook] META_APP_SECRET not configured — rejecting POST');
    return res.status(500).send('Server not configured');
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

  // Process FIRST, answer 200 after — see the header. Wrapped so that an exception
  // anywhere still yields a 200 (Meta retries non-2xx; every write here is idempotent).
  try {
    await processPayload(body);
  } catch (err) {
    console.error('[meta-webhook] Processing error:', err);
  }
  return res.status(200).json({ status: 'ok' });
}

async function processPayload(body: any): Promise<void> {
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

  for (const entry of body.entry || []) {
    const wabaId = entry.id; // WhatsApp Business Account ID

    for (const change of entry.changes || []) {
      if (change.field !== 'messages') continue;
      const value = change.value;
      if (!value) continue;

      const metaPhoneNumberId: string | undefined = value.metadata?.phone_number_id;
      const displayPhone: string | undefined = value.metadata?.display_phone_number;
      const channelPhone = normalizePhone(displayPhone || '');

      const teamId = await resolveTeamId(metaPhoneNumberId, wabaId);
      if (!teamId) {
        console.warn(`[meta-webhook] No team found for phoneNumberId=${metaPhoneNumberId}, wabaId=${wabaId}`);
        continue;
      }
      const businessId = await businessIdFor(teamId);

      // ── Incoming messages ──────────────────────────────────────────────────
      for (const msg of value.messages || []) {
        const parsed = parseMessage(msg);
        if (!parsed) continue; // reactions carry nothing to store or answer

        const from = normalizePhone(msg.from); // sender phone
        const waMessageId: string | undefined = msg.id;
        const ts = msg.timestamp ? new Date(Number(msg.timestamp) * 1000) : new Date();
        const contactName: string | null = value.contacts?.find((c: any) => c.wa_id === msg.from)?.profile?.name || null;
        const docId = waMessageId || adminDb.collection('whatsappMessages').doc().id;

        // The bare row — written by the channel first, so the record never
        // depends on the rest of the pipeline. `_waInbound` merges identity onto it.
        await adminDb.collection('whatsappMessages').doc(docId).set({
          phone: from,
          jid: `${from}@s.whatsapp.net`,
          direction: 'inbound' as const,
          message: parsed.text,
          waMessageId: waMessageId || null,
          leadName: contactName,
          pushName: contactName,
          teamId,
          businessId,
          status: 'received',
          channel: 'meta',
          channelPhone,
          metaPhoneNumberId: metaPhoneNumberId || null,
          isLid: false,
          mediaType: parsed.mediaType,
          metaMediaId: parsed.metaMediaId,
          mediaMimeType: parsed.mediaMimeType,
          mediaFilename: parsed.mediaFilename,
          createdAt: Timestamp.fromDate(ts),
          updatedAt: Timestamp.fromDate(new Date()),
        }, { merge: true });

        // ── 24-hour customer-service window tracking ────────────────────────
        // Per-(team,phone) doc with the last inbound timestamp so the UI can warn
        // before sending premium messages outside the 24h window.
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
        try {
          await processWaEvent({
            channel: 'meta',
            direction: 'inbound',
            teamId,
            agentId: null,
            metaPhoneNumberId: metaPhoneNumberId || null,
            channelPhone,
            waMessageId: docId,
            phone: from,
            jid: `${from}@s.whatsapp.net`,
            isLid: false,
            text: parsed.text,
            kind: msg.type === 'text' ? 'text' : 'media',
            pushName: contactName,
            isAutoReply: false,
            timestamp: ts.toISOString(),
          });
        } catch (e) {
          console.error('[meta-webhook] processWaEvent failed:', e);
        }

        console.log(`[meta-webhook] ← ${from}: ${parsed.text.slice(0, 80)}`);
      }

      // ── Status updates ─────────────────────────────────────────────────────
      for (const status of value.statuses || []) {
        const waMessageId = status.id;
        if (!waMessageId) continue;

        const statusMap: Record<string, string> = {
          sent: 'sent',
          delivered: 'delivered',
          read: 'read',
          failed: 'failed',
        };
        const newStatus = statusMap[status.status];
        if (!newStatus) continue;

        try {
          const ref = adminDb.collection('whatsappMessages').doc(waMessageId);
          const doc = await ref.get();
          if (doc.exists) {
            await ref.update({
              status: newStatus,
              updatedAt: Timestamp.fromDate(new Date()),
            });
          }
        } catch (e) {
          console.error('[meta-webhook] Status update error:', e);
        }
      }
    }
  }
}
