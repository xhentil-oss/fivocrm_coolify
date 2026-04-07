import type { VercelRequest, VercelResponse } from '@vercel/node';
import { adminAuth, adminDb, Timestamp } from './_firebaseAdmin.js';

/**
 * Send a WhatsApp message via Meta Cloud API.
 *
 * POST body: { to, message, leadId?, leadName?, teamId, channelPhone? }
 *
 * Reads Meta credentials from teamSettings/{teamId}:
 *   metaAccessToken, metaPhoneNumberId
 */

function normalizePhone(raw: string): string {
  const digits = raw.replace(/[^\d]/g, '');
  if (/^3550[6-9]/.test(digits)) return '355' + digits.slice(4);
  if (/^0[6-9]/.test(digits)) return '355' + digits.slice(1);
  return digits;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify Firebase ID token
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  if (!token) return res.status(401).json({ error: 'Missing authorization header' });
  try {
    await adminAuth.verifyIdToken(token);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  const { to, message, leadId, leadName, teamId, channelPhone } = req.body || {};

  if (!to || typeof to !== 'string') {
    return res.status(400).json({ error: 'Fusha "to" është e detyrueshme' });
  }
  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'Fusha "message" është e detyrueshme' });
  }
  if (!teamId) {
    return res.status(400).json({ error: 'teamId mungon' });
  }

  // Load Meta credentials from team settings
  const settingsSnap = await adminDb.collection('teamSettings').doc(teamId).get();
  if (!settingsSnap.exists) {
    return res.status(404).json({ error: 'Team settings nuk u gjetën' });
  }
  const settings = settingsSnap.data()!;

  // If channelPhone is specified, find matching channel. Otherwise use first channel.
  let accessToken: string | undefined;
  let phoneNumberId: string | undefined;
  let senderPhone = '';

  // Support multiple Meta numbers stored as metaChannels array
  if (settings.metaChannels && Array.isArray(settings.metaChannels) && settings.metaChannels.length > 0) {
    let ch = settings.metaChannels[0]; // default to first
    if (channelPhone) {
      const found = settings.metaChannels.find((c: any) => normalizePhone(c.phone) === normalizePhone(channelPhone));
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

  const cleanPhone = normalizePhone(String(to));

  try {
    // Send via Meta Cloud API
    const metaRes = await fetch(
      `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: cleanPhone,
          type: 'text',
          text: { body: message.trim() },
        }),
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

    await adminDb.collection('whatsappMessages').doc(docId).set({
      phone: cleanPhone,
      jid: `${cleanPhone}@s.whatsapp.net`,
      direction: 'outbound',
      message: message.trim(),
      waMessageId,
      leadId: leadId || null,
      leadName: leadName || null,
      teamId,
      status: 'sent',
      channel: 'meta',
      channelPhone: normalizePhone(senderPhone),
      metaPhoneNumberId: phoneNumberId,
      isLid: false,
      createdAt: Timestamp.fromDate(new Date()),
      updatedAt: Timestamp.fromDate(new Date()),
    });

    console.log(`[meta-send] → ${cleanPhone}: ${message.trim().slice(0, 80)}`);
    return res.status(200).json({ success: true, id: docId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Dërgimi dështoi';
    console.error('[meta-send] Exception:', msg);
    return res.status(500).json({ error: msg });
  }
}
