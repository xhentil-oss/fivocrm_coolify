import type { VercelRequest, VercelResponse } from '@vercel/node';
import { adminAuth, adminDb, Timestamp } from './_firebaseAdmin.js';
import { checkPersistentRateLimit } from './_rateLimit.js';
import { activeMembership, businessIdOfTeam } from './_callerIdentity.js';
import { getTeamConfig } from './_tenantConfig.js';
import { markConversationAnswered, verifyContactRefs } from './_waInbound.js';
import { toWaPhone, sameWaPhone } from './_waPhone.js';

/**
 * Send a WhatsApp message via Meta Cloud API.
 *
 * POST body (text):     { to, message, leadId?, customerId?, leadName?, teamId, channelPhone? }
 * POST body (template): { to, template: { name, language?, components? }, teamId, channelPhone?, leadId?, customerId? }
 *
 * Reads Meta credentials from teamSettings/{teamId}:
 *   metaAccessToken, metaPhoneNumberId
 *
 * `to` goes through the shared normaliser (`_waPhone.ts`): Meta receives `355…`,
 * never `069…`. A body `leadId` / `customerId` is verified against the team's
 * business before it is written anywhere (`verifyContactRefs`).
 */

function validatePhoneStrict(raw: string): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const n = toWaPhone(raw);
  if (!n) return null;
  if (!/^\d+$/.test(n) || n.length < 8 || n.length > 15) return null;
  if (n.startsWith('355')) {
    if (!/^3556[6-9]\d{7}$/.test(n) && !/^3557\d{7,8}$/.test(n)) return null;
  } else if (n.startsWith('0')) {
    return null;
  }
  return n;
}

// Persistent (Firestore-backed) per-uid ceiling. The old in-memory bucket was per
// instance and reset on every cold start, so it enforced nothing under fan-out.
const SEND_PER_HOUR = 200;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify Firebase ID token
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  if (!token) return res.status(401).json({ error: 'Missing authorization header' });
  let uid: string;
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    uid = decoded.uid;
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  if (!(await checkPersistentRateLimit('metaSend', uid, SEND_PER_HOUR))) {
    return res.status(429).json({ error: 'Limiti i dërgimeve u arrit. Provoni përsëri pas pak.' });
  }

  const { to, message, template, leadId: bodyLeadId, customerId: bodyCustomerId, leadName, teamId, channelPhone } = req.body || {};

  if (!to || typeof to !== 'string') {
    return res.status(400).json({ error: 'Fusha "to" është e detyrueshme' });
  }
  // Either text message or template required
  const hasTemplate = template && typeof template === 'object' && typeof template.name === 'string';
  if (!hasTemplate && (!message || typeof message !== 'string' || !message.trim())) {
    return res.status(400).json({ error: 'Fusha "message" ose "template" është e detyrueshme' });
  }
  if (message && typeof message === 'string' && message.length > 4096) {
    return res.status(400).json({ error: 'Mesazhi është shumë i gjatë (max 4096 karaktere)' });
  }
  if (!teamId) {
    return res.status(400).json({ error: 'teamId mungon' });
  }

  const strict = validatePhoneStrict(to);
  if (!strict) {
    return res.status(400).json({ error: 'Numri i telefonit është i pavlefshëm' });
  }

  // Verify the caller is an ACTIVE member of the requested team — prevents using
  // another team's Meta credentials (and a removed employee keeping the capability).
  if (typeof teamId !== 'string' || !(await activeMembership(uid, { teamId }))) {
    return res.status(403).json({ error: 'Forbidden: nuk jeni anëtar i këtij ekipi' });
  }

  // Body ids are claims: the lead / customer must be in THIS team's business.
  const businessId = await businessIdOfTeam(teamId);
  const refs = await verifyContactRefs({ leadId: bodyLeadId, customerId: bodyCustomerId, businessId, teamId });
  if (!refs.ok) return res.status(refs.status).json({ error: refs.error });
  const { leadId, customerId } = refs;

  // Load Meta credentials from team settings
  // Access tokens live in teamSecrets (client-unreadable) — getTeamConfig merges them.
  const settings = await getTeamConfig(teamId);
  if (!settings || Object.keys(settings).length === 0) {
    return res.status(404).json({ error: 'Team settings nuk u gjetën' });
  }

  // If channelPhone is specified, find matching channel. Otherwise use first channel.
  let accessToken: string | undefined;
  let phoneNumberId: string | undefined;
  let senderPhone = '';

  // Support multiple Meta numbers stored as metaChannels array
  if (settings.metaChannels && Array.isArray(settings.metaChannels) && settings.metaChannels.length > 0) {
    let ch = settings.metaChannels[0]; // default to first
    if (channelPhone) {
      const found = settings.metaChannels.find((c: any) => sameWaPhone(c?.phone, channelPhone));
      if (found) ch = found;
    }
    accessToken = ch.accessToken;
    phoneNumberId = ch.phoneNumberId;
    senderPhone = ch.phone || '';
  }

  // Fallback to legacy flat fields
  if (!accessToken) accessToken = settings.metaAccessToken;
  if (!phoneNumberId) phoneNumberId = settings.metaPhoneNumberId;

  if (!accessToken || !phoneNumberId) {
    return res.status(503).json({ error: 'Meta WhatsApp API nuk është konfiguruar për këtë ekip' });
  }

  const cleanPhone = strict;

  try {
    // ── 24-hour customer-service window awareness ─────────────────────────
    // For free-text (non-template) sends, look up the last inbound timestamp
    // and refuse if we're outside the 24h window — outside the window Meta
    // requires an approved template.
    let lastInboundAt: Date | null = null;
    if (!hasTemplate) {
      try {
        const convSnap = await adminDb.collection('whatsappConversations')
          .doc(`${teamId}_${cleanPhone}`)
          .get();
        if (convSnap.exists) {
          const li = convSnap.data()?.lastInboundAt;
          if (li && typeof li.toDate === 'function') lastInboundAt = li.toDate();
        }
      } catch { /* non-critical */ }

      if (lastInboundAt) {
        const ageMs = Date.now() - lastInboundAt.getTime();
        if (ageMs > 24 * 60 * 60 * 1000) {
          return res.status(409).json({
            error: 'Jashtë dritares 24-orëshe të Meta-s. Përdorni një template të aprovuar.',
            code: 'WINDOW_EXPIRED',
            lastInboundAt: lastInboundAt.toISOString(),
          });
        }
      } else {
        // No inbound on record at all — first contact, requires template
        return res.status(409).json({
          error: 'Klienti s\'ka shkruar më parë. Përdorni një template të aprovuar për kontaktin e parë.',
          code: 'NO_INBOUND',
        });
      }
    }

    // Build Meta payload — either text or template
    let metaPayload: any;
    if (hasTemplate) {
      metaPayload = {
        messaging_product: 'whatsapp',
        to: cleanPhone,
        type: 'template',
        template: {
          name: String(template.name),
          language: { code: String(template.language?.code || 'sq') },
          ...(Array.isArray(template.components) ? { components: template.components } : {}),
        },
      };
    } else {
      metaPayload = {
        messaging_product: 'whatsapp',
        to: cleanPhone,
        type: 'text',
        text: { body: (message as string).trim() },
      };
    }

    // Send via Meta Cloud API
    const metaRes = await fetch(
      `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(metaPayload),
      }
    );

    const metaData = await metaRes.json();

    if (!metaRes.ok) {
      console.error('[meta-send] Meta API error:', metaData);
      const errMsg = metaData?.error?.message || 'Meta API dështoi';
      return res.status(metaRes.status).json({ error: errMsg });
    }

    const waMessageId = metaData.messages?.[0]?.id || null;
    const docId = waMessageId || adminDb.collection('whatsappMessages').doc().id;

    const messageText = hasTemplate
      ? `[Template: ${template.name}]`
      : (message as string).trim();

    await adminDb.collection('whatsappMessages').doc(docId).set({
      phone: cleanPhone,
      jid: `${cleanPhone}@s.whatsapp.net`,
      direction: 'outbound',
      message: messageText,
      waMessageId,
      leadId: leadId || null,
      customerId: customerId || null,
      leadName: (typeof leadName === 'string' && leadName ? leadName.slice(0, 200) : null) || refs.leadName,
      teamId,
      businessId,
      status: 'sent',
      channel: 'meta',
      channelPhone: toWaPhone(senderPhone),
      metaPhoneNumberId: phoneNumberId,
      isLid: false,
      isTemplate: hasTemplate,
      templateName: hasTemplate ? String(template.name) : null,
      sentByUid: uid,
      createdAt: Timestamp.fromDate(new Date()),
      updatedAt: Timestamp.fromDate(new Date()),
    });

    // A staff reply (text OR template) closes the "awaiting reply" window. Best-effort.
    await markConversationAnswered({ teamId, phone: cleanPhone, byUid: uid, source: 'app', leadId, customerId }).catch(() => {});

    console.log(`[meta-send] → ${cleanPhone}: ${messageText.slice(0, 80)}`);
    return res.status(200).json({ success: true, id: docId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Dërgimi dështoi';
    console.error('[meta-send] Exception:', msg);
    return res.status(500).json({ error: msg });
  }
}
