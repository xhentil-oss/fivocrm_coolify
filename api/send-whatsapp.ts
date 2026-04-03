import type { VercelRequest, VercelResponse } from '@vercel/node';

function isValidPhone(phone: string): boolean {
  const digits = phone.replace(/[^\d]/g, '');
  return digits.length >= 7 && digits.length <= 15;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Basic auth check — must have an Authorization header (Bearer token from Firebase client)
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ') || !authHeader.slice(7).trim()) {
    return res.status(401).json({ error: 'Missing authorization header' });
  }

  const { to, message, leadId, leadName, teamId, jid } = req.body || {};

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
        to: to.replace(/[^\d]/g, ''),
        message: message.trim(),
        leadId: leadId || null,
        leadName: leadName || null,
        teamId: teamId || null,
        jid: hasValidJid ? jid : undefined,
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
