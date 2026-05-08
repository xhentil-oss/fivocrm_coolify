import type { VercelRequest, VercelResponse } from '@vercel/node';
import { adminAuth } from './_firebaseAdmin.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  if (!token) return res.status(401).json({ error: 'Missing authorization header' });
  try { await adminAuth.verifyIdToken(token); } catch { return res.status(401).json({ error: 'Invalid token' }); }

  const agentId = req.query.agentId as string;
  if (!agentId) return res.status(400).json({ error: 'agentId mungon' });

  const vpsUrl = process.env.WHATSAPP_VPS_URL;
  const vpsSecret = process.env.WHATSAPP_VPS_SECRET;
  if (!vpsUrl || !vpsSecret) return res.status(503).json({ error: 'VPS nuk është konfiguruar' });

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    const vpsRes = await fetch(`${vpsUrl}/qr-data/${encodeURIComponent(agentId)}`, {
      headers: { 'x-api-key': vpsSecret },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const data = await vpsRes.json();
    return res.status(vpsRes.ok ? 200 : vpsRes.status).json(data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'VPS nuk u lidh';
    return res.status(500).json({ error: msg });
  }
}
