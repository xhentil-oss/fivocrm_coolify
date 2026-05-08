import type { VercelRequest, VercelResponse } from '@vercel/node';
import { adminAuth } from './_firebaseAdmin.js';

function isValidPhone(phone: string): boolean {
  const digits = phone.replace(/[^\d]/g, '');
  return digits.length >= 7 && digits.length <= 15;
}

/** Normalize Albanian phone: 069… → 35569…, 355069… → 35569… */
function normalizeAlbanianPhone(raw: string): string {
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
  if (!token) {
    return res.status(401).json({ error: 'Missing authorization header' });
  }
  try {
    await adminAuth.verifyIdToken(token);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  const { to, message, leadId, leadName, teamId, jid, agentId } = req.body || {};

  if (!to || typeof to !== 'string') {
    return res.status(400).json({ error: 'Fusha "to" (numri i telefonit) është e detyrueshme' });
  }
  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'Fusha "message" është e detyrueshme' });
  }

  const hasValidJid = typeof jid === 'string' &&
    (jid.endsWith('@s.whatsapp.net') || jid.endsWith('@lid'));

  if (!hasValidJid && !isValidPhone(to)) {
    return res.status(400).json({ error: 'Numri i telefonit është i pavlefshëm' });
  }

  const vpsUrl = process.env.WHATSAPP_VPS_URL;
  const vpsSecret = process.env.WHATSAPP_VPS_SECRET;

  if (!vpsUrl || !vpsSecret) {
    return res.status(503).json({ error: 'WhatsApp nuk është konfiguruar. Shto WHATSAPP_VPS_URL dhe WHATSAPP_VPS_SECRET në Vercel.' });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    const vpsRes = await fetch(`${vpsUrl}/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': vpsSecret,
      },
      body: JSON.stringify({
        to: normalizeAlbanianPhone(to),
        message: message.trim(),
        leadId: leadId || null,
        leadName: leadName || null,
        teamId: teamId || null,
        jid: hasValidJid ? jid : undefined,
        agentId: agentId || undefined,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const text = await vpsRes.text();
    let data: Record<string, unknown> = {};
    try { data = JSON.parse(text); } catch { /* non-JSON response */ }

    if (!vpsRes.ok) {
      console.error('[send-whatsapp] VPS error:', vpsRes.status, text.slice(0, 300));
      return res.status(vpsRes.status).json({ error: (data as any)?.error || 'VPS server error' });
    }

    return res.status(200).json({ success: true, id: (data as any)?.id });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Lidhja me VPS dështoi';
    console.error('[send-whatsapp] Exception:', msg);
    return res.status(500).json({ error: msg });
  }
}
