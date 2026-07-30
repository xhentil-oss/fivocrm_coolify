import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';
import { adminDb, Timestamp } from './_firebaseAdmin.js';
import { getTeamConfig } from './_tenantConfig.js';

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
 * Per-team settings (from Firestore teamSettings):
 *   metaAccessToken, metaPhoneNumberId, metaBusinessAccountId
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

/**
 * Owner + watchers routing for a WhatsApp conversation (Request 1, server mirror
 * of src/lib/conversationRouting.ts). Given the team's members + a resolved owner
 * (from the matched lead), compute the manager, watcher list, and unassigned flag.
 */
function buildWaRouting(
  members: Array<{ userId: string; teamId?: string; role?: string; status?: string }>,
  ownerId: string | null,
  teamId: string,
) {
  const active = members.filter((m) => (m.status ?? 'Active') === 'Active');
  const managerId = active.find((m) => m.teamId === teamId && m.role === 'Manager')?.userId || null;
  const teamMemberIds = active.filter((m) => m.teamId === teamId).map((m) => m.userId);
  const adminIds = active.filter((m) => m.role === 'Admin').map((m) => m.userId);
  const fallbackManagers = !ownerId && !managerId ? active.filter((m) => m.role === 'Manager').map((m) => m.userId) : [];
  const watchers = Array.from(
    new Set([ownerId, ...teamMemberIds, managerId, ...adminIds, ...fallbackManagers].filter(Boolean) as string[]),
  );
  return { managerId, watchers, unassigned: !ownerId };
}

/** Idempotent upsert of the `wa-<teamId>-<phone>` conversation doc. */
async function upsertWaConversation(args: {
  teamId: string;
  businessId: string;
  phone: string;
  ownerId: string | null;
  leadId: string | null;
  subject: string | null;
  members: Array<{ userId: string; teamId?: string; role?: string; status?: string }>;
  ts: Date;
}): Promise<void> {
  const convId = `wa-${args.teamId}-${args.phone}`;
  const ref = adminDb.collection('conversations').doc(convId);
  const now = new Date();
  const routing = buildWaRouting(args.members, args.ownerId, args.teamId);
  try {
    const snap = await ref.get();
    if (!snap.exists) {
      await ref.set({
        channel: 'whatsapp',
        businessId: args.businessId,
        teamId: args.teamId,
        phone: args.phone,
        leadId: args.leadId,
        subject: args.subject,
        ownerId: args.ownerId,
        managerId: routing.managerId,
        salesAgentId: null,
        watchers: routing.watchers,
        unassigned: routing.unassigned,
        status: 'open',
        slaFirstResponseDueAt: Timestamp.fromDate(new Date(args.ts.getTime() + 2 * 3600_000)),
        slaBreachNotified: false,
        lastMessageAt: Timestamp.fromDate(args.ts),
        createdAt: Timestamp.fromDate(now),
        updatedAt: Timestamp.fromDate(now),
        createdByUserId: null,
      }, { merge: true });
      return;
    }
    const existing = snap.data() as any;
    const patch: any = { lastMessageAt: Timestamp.fromDate(args.ts), updatedAt: Timestamp.fromDate(now) };
    if (existing.unassigned && args.ownerId) {
      patch.ownerId = args.ownerId;
      patch.managerId = routing.managerId;
      patch.watchers = Array.from(new Set([...(existing.watchers || []), ...routing.watchers]));
      patch.unassigned = false;
    }
    await ref.set(patch, { merge: true });
  } catch { /* never block message ingest */ }
}

// Is `now` outside the configured business hours (Europe/Tirane)?
// start/end are "HH:MM" strings; an empty config means always-open (no reply).
function isOutsideBusinessHours(startStr?: string, endStr?: string): boolean {
  if (!startStr || !endStr) return false;
  const hhmm = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Tirane', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date());
  const [h, m] = hhmm.split(':').map(Number);
  const cur = h * 60 + m;
  const [sh, sm] = startStr.split(':').map(Number);
  const [eh, em] = endStr.split(':').map(Number);
  const start = sh * 60 + sm;
  const end = eh * 60 + em;
  // Normal daytime window (start < end): outside = before start OR at/after end.
  if (start <= end) return cur < start || cur >= end;
  // Overnight window (e.g. 22:00–06:00): outside = between end and start.
  return cur >= end && cur < start;
}

// Send a free-text WhatsApp message via Meta (used for auto-replies; valid only
// inside the 24h window, which a fresh inbound message guarantees).
async function sendMetaText(channel: any, to: string, bodyText: string): Promise<string | null> {
  const resp = await fetch(`https://graph.facebook.com/v21.0/${channel.phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${channel.accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: bodyText } }),
  });
  const data: any = await resp.json().catch(() => ({}));
  return resp.ok ? (data?.messages?.[0]?.id || null) : null;
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

  // Always respond 200 quickly to Meta (they retry on non-2xx)
  res.status(200).json({ status: 'ok' });

  try {
    if (body?.object !== 'whatsapp_business_account') return;

    for (const entry of body.entry || []) {
      const wabaId = entry.id; // WhatsApp Business Account ID

      for (const change of entry.changes || []) {
        if (change.field !== 'messages') continue;
        const value = change.value;
        if (!value) continue;

        const metaPhoneNumberId = value.metadata?.phone_number_id;
        const displayPhone = value.metadata?.display_phone_number;

        // Look up which team owns this phone number
        // First try denormalized metaPhoneNumberIds array (supports multi-number)
        let teamId = '';
        const idsSnap = await adminDb.collection('teamSettings')
          .where('metaPhoneNumberIds', 'array-contains', metaPhoneNumberId)
          .limit(1)
          .get();
        if (!idsSnap.empty) {
          teamId = idsSnap.docs[0].id;
        }

        if (!teamId) {
          // Fallback: legacy flat field
          const teamSnap = await adminDb.collection('teamSettings')
            .where('metaPhoneNumberId', '==', metaPhoneNumberId)
            .limit(1)
            .get();
          if (!teamSnap.empty) teamId = teamSnap.docs[0].id;
        }

        if (!teamId) {
          // Try by WABA ID
          const wabaSnap = await adminDb.collection('teamSettings')
            .where('metaBusinessAccountId', '==', wabaId)
            .limit(1)
            .get();
          if (!wabaSnap.empty) teamId = wabaSnap.docs[0].id;
        }

        if (!teamId) {
          console.warn(`[meta-webhook] No team found for phoneNumberId=${metaPhoneNumberId}, wabaId=${wabaId}`);
          continue;
        }

        // Load team settings once (used for auto-reply automation).
        const teamSettings = await getTeamConfig(teamId);
        const autoReplyChannel = (teamSettings.metaChannels || []).find((c: any) => c.phoneNumberId === metaPhoneNumberId);

        // Load team members + business once for conversation owner/watchers routing.
        let convBusinessId = teamId;
        let convMembers: Array<{ userId: string; teamId?: string; role?: string; status?: string }> = [];
        try {
          const teamDoc = await adminDb.collection('teams').doc(teamId).get();
          convBusinessId = (teamDoc.data() as any)?.businessId || teamId;
          const membersSnap = await adminDb.collection('teamMembers').where('teamId', '==', teamId).get();
          convMembers = membersSnap.docs.map((d) => {
            const x = d.data() as any;
            return { userId: x.userId, teamId: x.teamId, role: x.role, status: x.status };
          });
        } catch { /* routing degrades to unassigned if this fails */ }

        // ── Process incoming messages ─────────────────────────────────────
        for (const msg of value.messages || []) {
          const from = normalizePhone(msg.from); // sender phone
          const waMessageId = msg.id;
          const ts = msg.timestamp ? new Date(Number(msg.timestamp) * 1000) : new Date();

          let text = '';
          let mediaType: string | null = null;
          let metaMediaId: string | null = null;
          let mediaMimeType: string | null = null;
          let mediaFilename: string | null = null;
          if (msg.type === 'text') {
            text = msg.text?.body || '';
          } else if (msg.type === 'image') {
            text = msg.image?.caption || '[Foto]';
            mediaType = 'image';
            metaMediaId = msg.image?.id || null;
            mediaMimeType = msg.image?.mime_type || null;
          } else if (msg.type === 'video') {
            text = msg.video?.caption || '[Video]';
            mediaType = 'video';
            metaMediaId = msg.video?.id || null;
            mediaMimeType = msg.video?.mime_type || null;
          } else if (msg.type === 'audio') {
            text = '[Audio]';
            mediaType = 'audio';
            metaMediaId = msg.audio?.id || null;
            mediaMimeType = msg.audio?.mime_type || null;
          } else if (msg.type === 'document') {
            text = msg.document?.filename || '[Dokument]';
            mediaType = 'document';
            metaMediaId = msg.document?.id || null;
            mediaMimeType = msg.document?.mime_type || null;
            mediaFilename = msg.document?.filename || null;
          } else if (msg.type === 'location') {
            text = '[Vendndodhje]';
          } else if (msg.type === 'contacts') {
            text = '[Kontakt]';
          } else if (msg.type === 'sticker') {
            text = '[Sticker]';
            mediaType = 'sticker';
            metaMediaId = msg.sticker?.id || null;
            mediaMimeType = msg.sticker?.mime_type || null;
          } else if (msg.type === 'reaction') {
            continue; // Skip reactions
          } else {
            text = `[${msg.type || 'Media'}]`;
          }

          // Contact name from Meta
          const contactName = value.contacts?.find((c: any) => c.wa_id === msg.from)?.profile?.name || null;

          // Try to find matching lead
          let autoLeadId: string | null = null;
          let autoLeadName: string | null = null;
          let autoLeadOwnerId: string | null = null;
          try {
            const leadsSnap = await adminDb.collection('leads')
              .where('teamId', '==', teamId)
              .where('phoneNumber', '==', from)
              .limit(1)
              .get();
            if (!leadsSnap.empty) {
              autoLeadId = leadsSnap.docs[0].id;
              autoLeadName = leadsSnap.docs[0].data().name || null;
              autoLeadOwnerId = (leadsSnap.docs[0].data() as any).assignedToUserId || null;
            }
            if (!autoLeadId) {
              const snap2 = await adminDb.collection('leads')
                .where('teamId', '==', teamId)
                .where('phone', '==', from)
                .limit(1)
                .get();
              if (!snap2.empty) {
                autoLeadId = snap2.docs[0].id;
                autoLeadName = snap2.docs[0].data().name || null;
                autoLeadOwnerId = (snap2.docs[0].data() as any).assignedToUserId || null;
              }
            }
          } catch { /* non-critical */ }

          const docId = waMessageId || adminDb.collection('whatsappMessages').doc().id;

          await adminDb.collection('whatsappMessages').doc(docId).set({
            phone: from,
            jid: `${from}@s.whatsapp.net`,
            direction: 'inbound' as const,
            message: text,
            waMessageId,
            leadId: autoLeadId,
            leadName: autoLeadName || contactName,
            pushName: contactName,
            teamId,
            status: 'received',
            channel: 'meta',
            channelPhone: normalizePhone(displayPhone || ''),
            metaPhoneNumberId,
            isLid: false,
            mediaType,
            metaMediaId,
            mediaMimeType,
            mediaFilename,
            createdAt: Timestamp.fromDate(ts),
            updatedAt: Timestamp.fromDate(new Date()),
          }, { merge: true });

          // ── 24-hour customer-service window tracking ────────────────────
          // Keep a per-(team,phone) doc with the timestamp of the last inbound
          // message so the UI can warn before sending premium messages outside
          // the 24h window.
          try {
            const convId = `${teamId}_${from}`;
            await adminDb.collection('whatsappConversations').doc(convId).set({
              teamId,
              phone: from,
              lastInboundAt: Timestamp.fromDate(ts),
              channel: 'meta',
              updatedAt: Timestamp.fromDate(new Date()),
            }, { merge: true });
          } catch (e) {
            console.warn('[meta-webhook] conv tracker update failed:', e);
          }

          // ── Owner + watchers conversation (Request 1) ───────────────────
          // Unify the WhatsApp thread with the same owner/watchers model as the
          // portal, so it appears in the responsible person's chat with manager +
          // admin supervision. Owner is inherited from the matched lead when known.
          await upsertWaConversation({
            teamId,
            businessId: convBusinessId,
            phone: from,
            ownerId: autoLeadOwnerId,
            leadId: autoLeadId,
            subject: autoLeadName || contactName,
            members: convMembers,
            ts,
          });

          // ── Auto-reply outside business hours ───────────────────────────
          // Sends a one-off welcome text when a customer writes outside hours.
          // Debounced to once per 6h per phone so we never spam a conversation.
          try {
            if (
              teamSettings.waAutoReplyEnabled &&
              teamSettings.waAutoReplyText &&
              autoReplyChannel?.accessToken &&
              msg.type !== 'reaction' &&
              isOutsideBusinessHours(teamSettings.waBusinessStart, teamSettings.waBusinessEnd)
            ) {
              const convId = `${teamId}_${from}`;
              const convSnap = await adminDb.collection('whatsappConversations').doc(convId).get();
              const lastAuto = convSnap.data()?.lastAutoReplyAt?.toDate?.();
              const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);
              if (!lastAuto || lastAuto < sixHoursAgo) {
                const replyId = await sendMetaText(autoReplyChannel, from, teamSettings.waAutoReplyText);
                if (replyId) {
                  await adminDb.collection('whatsappMessages').doc(replyId).set({
                    phone: from,
                    jid: `${from}@s.whatsapp.net`,
                    direction: 'outbound' as const,
                    message: teamSettings.waAutoReplyText,
                    waMessageId: replyId,
                    leadId: autoLeadId,
                    leadName: autoLeadName || contactName,
                    teamId,
                    status: 'sent',
                    channel: 'meta',
                    channelPhone: normalizePhone(displayPhone || ''),
                    metaPhoneNumberId,
                    isAutoReply: true,
                    createdAt: Timestamp.fromDate(new Date()),
                    updatedAt: Timestamp.fromDate(new Date()),
                  }, { merge: true });
                  await adminDb.collection('whatsappConversations').doc(convId).set(
                    { lastAutoReplyAt: Timestamp.fromDate(new Date()) },
                    { merge: true }
                  );
                }
              }
            }
          } catch (e) {
            console.warn('[meta-webhook] auto-reply failed:', e);
          }

          console.log(`[meta-webhook] ← ${from}: ${text.slice(0, 80)}`);
        }

        // ── Process status updates ────────────────────────────────────────
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
  } catch (err) {
    console.error('[meta-webhook] Processing error:', err);
  }
}
