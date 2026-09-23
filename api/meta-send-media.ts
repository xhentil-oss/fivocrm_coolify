import type { VercelRequest, VercelResponse } from '@vercel/node';
import { adminAuth, adminDb, Timestamp } from './_firebaseAdmin.js';
import { checkPersistentRateLimit } from './_rateLimit.js';
import { activeMembership } from './_callerIdentity.js';
import { getTeamConfig } from './_tenantConfig.js';
import { markConversationAnswered } from './_waInbound.js';

/**
 * Send a WhatsApp media message via Meta Cloud API.
 *
 * POST body: {
 *   to, teamId,
 *   mediaUrl,            // already-uploaded Firebase Storage URL
 *   mediaType,           // 'image' | 'video' | 'audio' | 'document'
 *   mediaMime,           // e.g. 'image/jpeg', 'application/pdf'
 *   filename?,           // required for documents
 *   caption?,            // optional caption (image / video / document only)
 *   leadId?, leadName?, channelPhone?
 * }
 *
 * Flow:
 *  1. Fetch the file from mediaUrl.
 *  2. Upload to Meta Media API → get media_id.
 *  3. Send a message of type=mediaType referencing that media_id.
 *  4. Persist the outbound message in `whatsappMessages`.
 */

function normalizePhone(raw: string): string {
  const digits = (raw || '').replace(/[^\d]/g, '');
  if (/^3550[6-9]/.test(digits)) return '355' + digits.slice(4);
  if (/^0[6-9]/.test(digits)) return '355' + digits.slice(1);
  if (/^[6-9]\d{8}$/.test(digits)) return '355' + digits;
  return digits;
}

function validatePhoneStrict(raw: string): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const n = normalizePhone(raw);
  if (!/^\d+$/.test(n) || n.length < 8 || n.length > 15) return null;
  if (n.startsWith('355')) {
    if (!/^3556[6-9]\d{7}$/.test(n) && !/^3557\d{7,8}$/.test(n)) return null;
  } else if (n.startsWith('0')) {
    return null;
  }
  return n;
}

// Persistent (Firestore-backed) per-uid ceiling — shared semantics with /api/meta-send.
const SEND_PER_HOUR = 120;

const ALLOWED_TYPES = new Set(['image', 'video', 'audio', 'document']);
const MAX_BYTES = 16 * 1024 * 1024; // Meta limit for most media types

/**
 * Hosts the server will FETCH media from. Platform-controlled only: Firebase
 * Storage, the platform file host (`vps.fivocrm.com`) and the hosts named by the
 * platform env (`WHATSAPP_VPS_URL`, `VPS_FILES_URL`). A host taken from a tenant's
 * own `teamSettings.whatsappVpsUrl` used to qualify — that field is written from
 * the browser by any Admin, so it was an SSRF primitive (point it at 169.254.169.254
 * or an internal service and have Vercel fetch it).
 */
function platformMediaHosts(): Set<string> {
  const hosts = new Set<string>(['firebasestorage.googleapis.com', 'storage.googleapis.com', 'vps.fivocrm.com']);
  for (const v of [process.env.WHATSAPP_VPS_URL, process.env.VPS_FILES_URL, process.env.VITE_VPS_FILES_URL]) {
    if (!v) continue;
    try { const h = new URL(v).hostname.toLowerCase(); if (h && !/^(localhost|127\.0\.0\.1)$/.test(h)) hosts.add(h); } catch { /* ignore */ }
  }
  return hosts;
}

function isAllowedMediaUrl(u: string): boolean {
  try {
    const url = new URL(u);
    if (url.protocol !== 'https:') return false;
    if (url.username || url.password) return false;
    const host = url.hostname.toLowerCase();
    // Firebase Storage download URLs
    if (host.endsWith('.firebasestorage.app')) return true;
    return platformMediaHosts().has(host);
  } catch {
    return false;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

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

  if (!(await checkPersistentRateLimit('metaSendMedia', uid, SEND_PER_HOUR))) {
    return res.status(429).json({ error: 'Limiti i dërgimeve u arrit. Provoni përsëri pas pak.' });
  }

  const {
    to,
    teamId,
    mediaUrl,
    mediaType,
    mediaMime,
    filename,
    caption,
    leadId,
    leadName,
    channelPhone,
  } = req.body || {};

  if (!to || typeof to !== 'string') {
    return res.status(400).json({ error: 'Fusha "to" është e detyrueshme' });
  }
  if (!teamId) return res.status(400).json({ error: 'teamId mungon' });
  // Basic shape check here; the host whitelist (incl. the team's VPS) runs once
  // team settings are loaded below.
  if (!mediaUrl || typeof mediaUrl !== 'string') {
    return res.status(400).json({ error: 'mediaUrl i pavlefshëm' });
  }
  if (!mediaType || !ALLOWED_TYPES.has(String(mediaType))) {
    return res.status(400).json({ error: 'mediaType duhet image|video|audio|document' });
  }
  if (!mediaMime || typeof mediaMime !== 'string') {
    return res.status(400).json({ error: 'mediaMime mungon' });
  }
  if (mediaType === 'document' && (!filename || typeof filename !== 'string')) {
    return res.status(400).json({ error: 'filename është i detyrueshëm për document' });
  }
  if (caption && (typeof caption !== 'string' || caption.length > 1024)) {
    return res.status(400).json({ error: 'caption shumë i gjatë (max 1024 karaktere)' });
  }

  const strict = validatePhoneStrict(to);
  if (!strict) return res.status(400).json({ error: 'Numri i telefonit është i pavlefshëm' });
  const cleanPhone = strict;

  // Verify ACTIVE team membership (a removed employee keeps nothing).
  if (typeof teamId !== 'string' || !(await activeMembership(uid, { teamId }))) {
    return res.status(403).json({ error: 'Forbidden: nuk jeni anëtar i këtij ekipi' });
  }
  // Media-URL host allowlist is platform-only (see platformMediaHosts) — checked
  // before any tenant config is read so a tenant setting can never widen it.
  if (!isAllowedMediaUrl(mediaUrl)) {
    return res.status(400).json({ error: 'mediaUrl i pavlefshëm' });
  }

  // Load Meta credentials
  // Access tokens live in teamSecrets (client-unreadable) — getTeamConfig merges them.
  const settings = await getTeamConfig(teamId);
  if (!settings || Object.keys(settings).length === 0) return res.status(404).json({ error: 'Team settings nuk u gjetën' });


  let accessToken: string | undefined;
  let phoneNumberId: string | undefined;
  let senderPhone = '';
  if (settings.metaChannels && Array.isArray(settings.metaChannels) && settings.metaChannels.length > 0) {
    let ch = settings.metaChannels[0];
    if (channelPhone) {
      const found = settings.metaChannels.find(
        (c: any) => normalizePhone(c.phone) === normalizePhone(channelPhone),
      );
      if (found) ch = found;
    }
    accessToken = ch.accessToken;
    phoneNumberId = ch.phoneNumberId;
    senderPhone = ch.phone || '';
  }
  if (!accessToken) accessToken = settings.metaAccessToken;
  if (!phoneNumberId) phoneNumberId = settings.metaPhoneNumberId;
  if (!accessToken || !phoneNumberId) {
    return res.status(503).json({ error: 'Meta WhatsApp API nuk është konfiguruar për këtë ekip' });
  }

  // 24h window enforcement (same as meta-send for non-template)
  try {
    const convSnap = await adminDb.collection('whatsappConversations')
      .doc(`${teamId}_${cleanPhone}`)
      .get();
    let lastInboundAt: Date | null = null;
    if (convSnap.exists) {
      const li = convSnap.data()?.lastInboundAt;
      if (li && typeof li.toDate === 'function') lastInboundAt = li.toDate();
    }
    if (!lastInboundAt) {
      return res.status(409).json({
        error: 'Klienti s\'ka shkruar më parë. Përdorni një template për kontaktin e parë.',
        code: 'NO_INBOUND',
      });
    }
    if (Date.now() - lastInboundAt.getTime() > 24 * 60 * 60 * 1000) {
      return res.status(409).json({
        error: 'Jashtë dritares 24-orëshe të Meta-s.',
        code: 'WINDOW_EXPIRED',
        lastInboundAt: lastInboundAt.toISOString(),
      });
    }
  } catch { /* non-critical */ }

  try {
    // 1) Download from Firebase Storage
    const fileRes = await fetch(mediaUrl);
    if (!fileRes.ok) {
      return res.status(400).json({ error: 'Skedari nuk u shkarkua nga storage' });
    }
    const ab = await fileRes.arrayBuffer();
    if (ab.byteLength > MAX_BYTES) {
      return res.status(413).json({ error: `Skedari është më i madh se ${MAX_BYTES / (1024 * 1024)} MB` });
    }
    const fileBlob = new Blob([ab], { type: mediaMime });

    // 2) Upload to Meta Media API
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('type', mediaMime);
    form.append('file', fileBlob, filename || `upload.${mediaMime.split('/')[1] || 'bin'}`);

    const uploadRes = await fetch(
      `https://graph.facebook.com/v21.0/${phoneNumberId}/media`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
        body: form,
      },
    );
    const uploadData: any = await uploadRes.json();
    if (!uploadRes.ok || !uploadData?.id) {
      console.error('[meta-send-media] upload failed:', uploadData);
      return res.status(uploadRes.status || 500).json({
        error: uploadData?.error?.message || 'Ngarkimi te Meta dështoi',
      });
    }
    const metaMediaId = String(uploadData.id);

    // 3) Send message referencing the media_id
    const mediaPart: any = { id: metaMediaId };
    if (caption && (mediaType === 'image' || mediaType === 'video' || mediaType === 'document')) {
      mediaPart.caption = caption;
    }
    if (mediaType === 'document' && filename) {
      mediaPart.filename = filename;
    }
    const metaPayload = {
      messaging_product: 'whatsapp',
      to: cleanPhone,
      type: mediaType,
      [mediaType]: mediaPart,
    };

    const sendRes = await fetch(
      `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(metaPayload),
      },
    );
    const sendData: any = await sendRes.json();
    if (!sendRes.ok) {
      console.error('[meta-send-media] send failed:', sendData);
      return res.status(sendRes.status).json({
        error: sendData?.error?.message || 'Dërgimi i medias dështoi',
      });
    }

    const waMessageId = sendData.messages?.[0]?.id || null;
    const docId = waMessageId || adminDb.collection('whatsappMessages').doc().id;
    const summary = caption?.trim() || `[${mediaType}${filename ? `: ${filename}` : ''}]`;

    await adminDb.collection('whatsappMessages').doc(docId).set({
      phone: cleanPhone,
      jid: `${cleanPhone}@s.whatsapp.net`,
      direction: 'outbound',
      message: summary,
      waMessageId,
      leadId: leadId || null,
      leadName: leadName || null,
      teamId,
      status: 'sent',
      channel: 'meta',
      channelPhone: normalizePhone(senderPhone),
      metaPhoneNumberId: phoneNumberId,
      isLid: false,
      mediaType,
      mediaUrl,
      mediaMimeType: mediaMime,
      mediaFilename: filename || null,
      mediaSize: ab.byteLength,
      metaMediaId,
      sentByUid: uid,
      createdAt: Timestamp.fromDate(new Date()),
      updatedAt: Timestamp.fromDate(new Date()),
    });

    // A staff reply closes the "awaiting reply" window. Best-effort.
    await markConversationAnswered({ teamId, phone: cleanPhone, byUid: uid, source: 'app', leadId: leadId || null }).catch(() => {});

    console.log(`[meta-send-media] → ${cleanPhone} (${mediaType}, ${ab.byteLength}B)`);
    return res.status(200).json({ success: true, id: docId, metaMediaId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Dërgimi dështoi';
    console.error('[meta-send-media] Exception:', msg);
    return res.status(500).json({ error: msg });
  }
}
