import type { VercelRequest, VercelResponse } from '@vercel/node';
import { adminAuth } from './_firebaseAdmin.js';

/**
 * POST /api/daily-room
 * Body: { name: string }   (a deterministic room name per conversation)
 * Header: Authorization: Bearer <Firebase ID token>
 *
 * Returns { url } for a Daily.co room — creates it if it doesn't exist yet.
 * Requires DAILY_API_KEY in the environment.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Missing authorization header' });
  try {
    await adminAuth.verifyIdToken(authHeader.split('Bearer ')[1]);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  const apiKey = process.env.DAILY_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: 'Video calls not configured', detail: 'DAILY_API_KEY is missing' });
  }

  // Daily room names allow [A-Za-z0-9_-]. Sanitize + cap length.
  const name = String(req.body?.name || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60);
  if (!name) return res.status(400).json({ error: 'Missing room name' });

  const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };

  try {
    // Reuse the room if it already exists.
    const getRes = await fetch(`https://api.daily.co/v1/rooms/${name}`, { headers });
    if (getRes.ok) {
      const r = await getRes.json();
      return res.status(200).json({ url: r.url, name: r.name });
    }

    // Otherwise create it. Auto-expires after 4h so rooms self-clean.
    const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 4;
    const createRes = await fetch('https://api.daily.co/v1/rooms', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name,
        privacy: 'public',
        properties: { exp, eject_at_room_exp: true, enable_screenshare: true, enable_chat: true },
      }),
    });
    if (!createRes.ok) {
      const detail = (await createRes.text()).slice(0, 300);
      return res.status(502).json({ error: 'Failed to create room', detail });
    }
    const room = await createRes.json();
    return res.status(200).json({ url: room.url, name: room.name });
  } catch (err: any) {
    return res.status(500).json({ error: 'Daily request failed', detail: err?.message || 'unknown' });
  }
}
