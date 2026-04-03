import type { VercelRequest, VercelResponse } from '@vercel/node';
import { adminAuth } from './_firebaseAdmin.js';

function isValidPhone(phone: string): boolean {
  const digits = phone.replace(/[^\d]/g, '');
  return digits.length >= 7 && digits.length <= 15;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify Firebase token
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization header' });
  }
  try {
    await adminAuth.verifyIdToken(authHeader.slice(7));
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  const { to, message, leadId, leadName, teamId } = req.body || {};

  if (!to || typeof to !== 'string') {
    return res.status(400).json({ error: 'Fusha "to" (numri i telefonit) është e detyrueshme' });
  }
  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'Fusha "message" është e detyrueshme' });
  }
  if (!isValidPhone(to)) {
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
        to: to.replace(/[^\d]/g, ''),
        message: message.trim(),
        leadId: leadId || null,
        leadName: leadName || null,
        teamId: teamId || null,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const data = await vpsRes.json().catch(() => ({}));
    if (!vpsRes.ok) {
      return res.status(vpsRes.status).json({ error: (data as any)?.error || 'VPS server error' });
    }

    return res.status(200).json({ success: true, id: (data as any)?.id });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Lidhja me VPS dështoi';
    return res.status(500).json({ error: msg });
  }
}
