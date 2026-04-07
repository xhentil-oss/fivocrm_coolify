import type { VercelRequest, VercelResponse } from '@vercel/node';
import { adminDb, Timestamp } from './_firebaseAdmin.js';

/**
 * Meta WhatsApp Cloud API Webhook
 *
 * GET  — Webhook verification (Meta sends a challenge)
 * POST — Incoming messages from Meta Cloud API
 *
 * Requires env vars:
 *   META_WEBHOOK_VERIFY_TOKEN — a secret string you choose during webhook setup
 *
 * Per-team settings (from Firestore teamSettings):
 *   metaAccessToken, metaPhoneNumberId, metaBusinessAccountId
 */

function normalizePhone(raw: string): string {
  const digits = raw.replace(/[^\d]/g, '');
  if (/^3550[6-9]/.test(digits)) return '355' + digits.slice(4);
  if (/^0[6-9]/.test(digits)) return '355' + digits.slice(1);
  return digits;
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

  // Always respond 200 quickly to Meta (they retry on non-2xx)
  res.status(200).json({ status: 'ok' });

  try {
    const body = req.body;
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

        // ── Process incoming messages ─────────────────────────────────────
        for (const msg of value.messages || []) {
          const from = normalizePhone(msg.from); // sender phone
          const waMessageId = msg.id;
          const ts = msg.timestamp ? new Date(Number(msg.timestamp) * 1000) : new Date();

          let text = '';
          if (msg.type === 'text') {
            text = msg.text?.body || '';
          } else if (msg.type === 'image') {
            text = msg.image?.caption || '[Foto]';
          } else if (msg.type === 'video') {
            text = msg.video?.caption || '[Video]';
          } else if (msg.type === 'audio') {
            text = '[Audio]';
          } else if (msg.type === 'document') {
            text = msg.document?.filename || '[Dokument]';
          } else if (msg.type === 'location') {
            text = '[Vendndodhje]';
          } else if (msg.type === 'contacts') {
            text = '[Kontakt]';
          } else if (msg.type === 'sticker') {
            text = '[Sticker]';
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
          try {
            const leadsSnap = await adminDb.collection('leads')
              .where('teamId', '==', teamId)
              .where('phoneNumber', '==', from)
              .limit(1)
              .get();
            if (!leadsSnap.empty) {
              autoLeadId = leadsSnap.docs[0].id;
              autoLeadName = leadsSnap.docs[0].data().name || null;
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
            createdAt: Timestamp.fromDate(ts),
            updatedAt: Timestamp.fromDate(new Date()),
          }, { merge: true });

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
