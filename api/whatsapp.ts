import type { VercelRequest, VercelResponse } from '@vercel/node';
import { adminAuth, adminDb as db } from './_firebaseAdmin.js';
import { markConversationAnswered } from './_waInbound.js';

function isValidPhone(phone: string): boolean {
  const digits = phone.replace(/[^\d]/g, '');
  return digits.length >= 7 && digits.length <= 15;
}

function normalizeAlbanianPhone(raw: string): string {
  const digits = raw.replace(/[^\d]/g, '');
  if (/^3550[6-9]/.test(digits)) return '355' + digits.slice(4);
  if (/^0[6-9]/.test(digits)) return '355' + digits.slice(1);
  if (/^[6-9]\d{8}$/.test(digits)) return '355' + digits;
  return digits;
}

function validatePhoneStrict(raw: string): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const n = normalizeAlbanianPhone(raw);
  if (!/^\d+$/.test(n) || n.length < 8 || n.length > 15) return null;
  if (n.startsWith('355')) {
    if (!/^3556[6-9]\d{7}$/.test(n) && !/^3557\d{7,8}$/.test(n)) return null;
  } else if (n.startsWith('0')) {
    return null;
  }
  return n;
}

// ── Simple in-memory per-uid rate limiter ──
// 10 messages / minute per authenticated user.  Resets on cold-start, which
// is acceptable for an abuse limiter (and Vercel functions are short-lived).
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 10;
const rateBuckets: Map<string, number[]> = new Map();
function checkRateLimit(uid: string): boolean {
  const now = Date.now();
  const cutoff = now - RATE_LIMIT_WINDOW_MS;
  const recent = (rateBuckets.get(uid) || []).filter((t) => t > cutoff);
  if (recent.length >= RATE_LIMIT_MAX) {
    rateBuckets.set(uid, recent);
    return false;
  }
  recent.push(now);
  rateBuckets.set(uid, recent);
  return true;
}

async function vpsCall(vpsUrl: string, vpsSecret: string, path: string, method = 'GET') {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  const r = await fetch(`${vpsUrl}${path}`, {
    method,
    headers: { 'x-api-key': vpsSecret },
    signal: controller.signal,
  });
  clearTimeout(timeout);
  return r;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Auth
  const token = (req.headers.authorization ?? '').startsWith('Bearer ')
    ? req.headers.authorization!.slice(7).trim()
    : null;
  if (!token) return res.status(401).json({ error: 'Missing authorization header' });
  let uid: string;
  try { const d = await adminAuth.verifyIdToken(token); uid = d.uid; }
  catch { return res.status(401).json({ error: 'Invalid or expired token' }); }

  const vpsUrl = process.env.WHATSAPP_VPS_URL;
  const vpsSecret = process.env.WHATSAPP_VPS_SECRET;
  if (!vpsUrl || !vpsSecret) {
    return res.status(503).json({ error: 'WhatsApp nuk është konfiguruar. Shto WHATSAPP_VPS_URL dhe WHATSAPP_VPS_SECRET në Vercel.' });
  }

  // Enforce HTTPS for the VPS URL unless explicitly running against localhost
  // (dev convenience).  Prevents accidental plaintext transmission of API key.
  const allowInsecure = /^https?:\/\/(localhost|127\.0\.0\.1)/i.test(vpsUrl);
  if (!vpsUrl.startsWith('https://') && !allowInsecure) {
    console.error('[whatsapp] Refusing to call non-HTTPS VPS URL:', vpsUrl);
    return res.status(500).json({ error: 'WHATSAPP_VPS_URL duhet të jetë HTTPS' });
  }

  try {
    // POST ?action=reload — hot-reload VPS
    if (req.method === 'POST' && req.query.action === 'reload') {
      const r = await vpsCall(vpsUrl, vpsSecret, '/reload', 'POST');
      return res.status(r.ok ? 200 : r.status).json(await r.json());
    }

    // GET ?action=status[&teamId=xxx] — health + per-agent connection state.
    // Returns { serverOnline, agents: [{id,label,status,teamId,connectedPhone?}], anyConnected, fetchedAt }
    // Never throws on VPS failure — that's the point of a status check.
    if (req.method === 'GET' && req.query.action === 'status') {
      const teamId = (req.query.teamId as string) || null;
      try {
        const r = await vpsCall(vpsUrl, vpsSecret, '/status');
        if (!r.ok) {
          return res.status(200).json({
            serverOnline: false,
            agents: [],
            anyConnected: false,
            error: `VPS status ${r.status}`,
            fetchedAt: Date.now(),
          });
        }
        const data: any = await r.json();
        // The VPS answers `{ agents: { [id]: {...} } }` (vps/server.ts GET /status).
        // This used to read `data.statuses`, so the app saw an empty list — and
        // "Lidhur" in Cilësimet was decided by a phone number stamped at first scan.
        const raw = data?.agents ?? data?.statuses;
        const statuses = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
        const all = Object.entries(statuses).map(([id, v]: [string, any]) => ({
          id,
          label: v?.label || id,
          status: v?.status || 'disconnected',
          teamId: v?.teamId || null,
          assignedToUserId: v?.assignedToUserId || null,
          connectedPhone: typeof v?.connectedPhone === 'string' && v.connectedPhone ? v.connectedPhone : null,
        }));
        const filtered = teamId ? all.filter((a) => a.teamId === teamId) : all;
        return res.status(200).json({
          serverOnline: true,
          agents: filtered,
          anyConnected: filtered.some((a) => a.status === 'connected'),
          fetchedAt: Date.now(),
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'VPS unreachable';
        return res.status(200).json({
          serverOnline: false,
          agents: [],
          anyConnected: false,
          error: msg,
          fetchedAt: Date.now(),
        });
      }
    }

    // GET ?agentId=xxx — fetch QR data for one agent
    if (req.method === 'GET') {
      const agentId = req.query.agentId as string;
      if (!agentId) return res.status(400).json({ error: 'agentId mungon' });
      const r = await vpsCall(vpsUrl, vpsSecret, `/qr-data/${encodeURIComponent(agentId)}`);
      return res.status(r.ok ? 200 : r.status).json(await r.json());
    }

    // POST (no special action) — send WhatsApp message
    if (req.method === 'POST') {
      // Per-uid rate limit (anti-spam guard)
      if (!checkRateLimit(uid)) {
        return res.status(429).json({ error: 'Limiti i dërgimeve u arrit. Provoni përsëri pas pak.' });
      }

      const { to, message, leadId, leadName, teamId, jid, agentId } = req.body || {};

      // Verify caller belongs to the requested team — prevents using another team's agents
      if (teamId) {
        const memberSnap = await db.collection('teamMembers')
          .where('teamId', '==', teamId)
          .where('userId', '==', uid)
          .limit(1)
          .get();
        if (memberSnap.empty) {
          return res.status(403).json({ error: 'Forbidden: nuk jeni anëtar i këtij ekipi' });
        }
      }

      if (!to || typeof to !== 'string') {
        return res.status(400).json({ error: 'Fusha "to" (numri i telefonit) është e detyrueshme' });
      }
      if (!message || typeof message !== 'string' || !message.trim()) {
        return res.status(400).json({ error: 'Fusha "message" është e detyrueshme' });
      }
      // Cap message length to prevent absurdly large payloads
      if (message.length > 4096) {
        return res.status(400).json({ error: 'Mesazhi është shumë i gjatë (max 4096 karaktere)' });
      }

      const hasValidJid = typeof jid === 'string' &&
        (jid.endsWith('@s.whatsapp.net') || jid.endsWith('@lid'));

      let normalizedTo = '';
      if (hasValidJid) {
        // JID path is trusted (came from Baileys) — still normalize phone for logging
        normalizedTo = normalizeAlbanianPhone(to);
      } else {
        const strict = validatePhoneStrict(to);
        if (!strict) {
          return res.status(400).json({ error: 'Numri i telefonit është i pavlefshëm' });
        }
        if (!isValidPhone(strict)) {
          return res.status(400).json({ error: 'Numri i telefonit është i pavlefshëm' });
        }
        normalizedTo = strict;
      }

      const r = await fetch(`${vpsUrl}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': vpsSecret },
        body: JSON.stringify({
          to: normalizedTo,
          message: message.trim(),
          leadId: leadId || null,
          leadName: leadName || null,
          teamId: teamId || null,
          jid: hasValidJid ? jid : undefined,
          agentId: agentId || undefined,
          // Persisted on the outbound row by the VPS — who answered, for the SLA/first-response stamps.
          sentByUid: uid,
        }),
        signal: AbortSignal.timeout(10_000),
      });

      const text = await r.text();
      let data: Record<string, unknown> = {};
      try { data = JSON.parse(text); } catch { /* non-JSON */ }

      if (!r.ok) {
        console.error('[whatsapp] VPS error:', r.status, text.slice(0, 300));
        return res.status(r.status).json({ error: (data as any)?.error || 'VPS server error' });
      }

      // A staff reply closes the "awaiting reply" window on the thread + contact(s).
      // Best-effort: the message is already delivered, a failed stamp must not fail the send.
      const answeredTeamId = (teamId as string | undefined) || ((data as any)?.teamId as string | undefined) || null;
      if (answeredTeamId && normalizedTo) {
        await markConversationAnswered({
          teamId: answeredTeamId, phone: normalizedTo, byUid: uid, source: 'app', leadId: leadId || null,
        }).catch(() => {});
      }

      return res.status(200).json({ success: true, id: (data as any)?.id });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Lidhja me VPS dështoi';
    console.error('[whatsapp] Exception:', msg);
    return res.status(500).json({ error: msg });
  }
}
