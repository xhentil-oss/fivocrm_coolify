import type { VercelRequest, VercelResponse } from '@vercel/node';
import { adminAuth } from './_firebaseAdmin.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  if (!token) return res.status(401).json({ error: 'Missing authorization header' });
  try { await adminAuth.verifyIdToken(token); } catch { return res.status(401).json({ error: 'Invalid token' }); }

  const vpsUrl = process.env.WHATSAPP_VPS_URL;
  const vpsSecret = process.env.WHATSAPP_VPS_SECRET;
  if (!vpsUrl || !vpsSecret) return res.status(503).json({ error: 'VPS nuk është konfiguruar' });

  const call = async (path: string, method = 'GET') => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    const r = await fetch(`${vpsUrl}${path}`, { method, headers: { 'x-api-key': vpsSecret }, signal: controller.signal });
    clearTimeout(timeout);
    return r;
  };

  try {
    // POST /api/whatsapp-qr?action=reload  — trigger hot-reload on VPS
    if (req.method === 'POST' && req.query.action === 'reload') {
      const r = await call('/reload', 'POST');
      return res.status(r.ok ? 200 : r.status).json(await r.json());
    }

    // GET /api/whatsapp-qr?agentId=xxx  — fetch QR data for one agent
    if (req.method === 'GET') {
      const agentId = req.query.agentId as string;
      if (!agentId) return res.status(400).json({ error: 'agentId mungon' });
      const r = await call(`/qr-data/${encodeURIComponent(agentId)}`);
      return res.status(r.ok ? 200 : r.status).json(await r.json());
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'VPS nuk u lidh';
    return res.status(500).json({ error: msg });
  }
}
