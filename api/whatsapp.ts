import type { VercelRequest, VercelResponse } from '@vercel/node';
import { adminDb as db } from './_firebaseAdmin.js';
import { markConversationAnswered } from './_waInbound.js';
import { checkPersistentRateLimit } from './_rateLimit.js';
import {
  authenticate, isPortalOnlyToken, resolveStaffTenant, hasManagerRole, businessIdOfTeam,
  type CallerIdentity, type StaffTenant,
} from './_callerIdentity.js';

/**
 * /api/whatsapp — Baileys (VPS) relay for STAFF.
 *
 *   POST                      send a message through one of the tenant's agents
 *   GET  ?action=status       live agent states — the CALLER's tenant only
 *   GET  ?agentId=…           QR / login state of one agent (Admin/Manager)
 *   POST ?action=reload       hot-reload the VPS agent set (Admin/Manager)
 *
 * Trust model (audit Sep 2026): the caller's tenant comes from the server-minted
 * claims (`bid`, membership-doc fallback for pre-rollout tokens), never from the
 * body. Every agent is a `whatsappAccounts` document and is loaded and compared
 * with that tenant before the VPS is called — before, `teamId` was checked only
 * when the body bothered to send it, `agentId` was never checked at all, `?status`
 * listed every tenant's agents and `?action=reload` was open to any token. A
 * portal client (token with `cid`/`pbid` and no `bid`) is refused outright.
 *
 * The VPS is told WHICH agent to use (`agentId` + the ACCOUNT's `teamId`); when the
 * client sends none, the tenant's own accounts are consulted here — never the
 * VPS's "first connected agent", which belonged to whoever scanned a QR last.
 */

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

// Persistent (Firestore-backed) ceilings — the old in-memory bucket was per
// instance and reset on every cold start, so it enforced nothing under fan-out.
const SEND_PER_HOUR = 200;
const RELOAD_PER_HOUR = 30;
const QR_PER_HOUR = 1500; // the QR dialog polls every 4s

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

interface Account {
  id: string;
  teamId: string | null;
  businessId: string | null;
  enabled: boolean;
  assignedToUserId: string | null;
  connectionStatus: string | null;
  createdAtMs: number;
}

function toAccount(id: string, d: Record<string, any>): Account {
  return {
    id,
    teamId: typeof d.teamId === 'string' && d.teamId ? d.teamId : null,
    businessId: typeof d.businessId === 'string' && d.businessId ? d.businessId : null,
    enabled: d.enabled !== false,
    assignedToUserId: typeof d.assignedToUserId === 'string' && d.assignedToUserId ? d.assignedToUserId : null,
    connectionStatus: typeof d.connectionStatus === 'string' ? d.connectionStatus : null,
    createdAtMs: typeof d.createdAt?.toMillis === 'function' ? d.createdAt.toMillis() : 0,
  };
}

/** Does this account belong to the caller's tenant? Legacy rows without `businessId` resolve through their team. */
async function accountInTenant(a: Account, tenant: StaffTenant): Promise<boolean> {
  if (a.businessId) return a.businessId === tenant.bid;
  if (a.teamId) return (await businessIdOfTeam(a.teamId)) === tenant.bid;
  return false;
}

/** Every account of the tenant (by businessId, plus legacy rows stamped only with the caller's team). */
async function tenantAccounts(tenant: StaffTenant): Promise<Account[]> {
  const byId = new Map<string, Account>();
  const col = db.collection('whatsappAccounts');
  const [byBiz, byTeam] = await Promise.all([
    col.where('businessId', '==', tenant.bid).limit(100).get(),
    tenant.tid ? col.where('teamId', '==', tenant.tid).limit(100).get() : Promise.resolve(null),
  ]);
  byBiz.forEach((d) => byId.set(d.id, toAccount(d.id, d.data() as any)));
  byTeam?.forEach((d) => {
    const a = toAccount(d.id, d.data() as any);
    // A team-stamped row that says another business is not ours.
    if (!a.businessId || a.businessId === tenant.bid) byId.set(d.id, a);
  });
  return [...byId.values()];
}

/** Load one agent and prove it belongs to the caller's tenant (404 either way — never confirm existence). */
async function loadTenantAccount(agentId: string, tenant: StaffTenant): Promise<Account | null> {
  if (!agentId || typeof agentId !== 'string' || agentId.length > 128) return null;
  const snap = await db.collection('whatsappAccounts').doc(agentId).get();
  if (!snap.exists) return null;
  const a = toAccount(snap.id, snap.data() as any);
  return (await accountInTenant(a, tenant)) ? a : null;
}

/**
 * Pick the agent to send through when the client named none: the one assigned
 * to the caller, else a connected one in the caller's team, else any enabled
 * account of the business. Deterministic (oldest first) so retries hit the same agent.
 */
function pickSendAccount(accounts: Account[], c: CallerIdentity, tenant: StaffTenant): Account | null {
  const enabled = accounts.filter((a) => a.enabled);
  if (!enabled.length) return null;
  const score = (a: Account) =>
    (a.assignedToUserId === c.uid ? 0 : 8)
    + (a.connectionStatus === 'connected' ? 0 : 4)
    + (tenant.tid && a.teamId === tenant.tid ? 0 : 2);
  return [...enabled].sort((x, y) => score(x) - score(y) || x.createdAtMs - y.createdAtMs || x.id.localeCompare(y.id))[0];
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const c = await authenticate(req);
  if (!c) return res.status(401).json({ error: 'Missing or invalid authorization' });
  // A portal client is never staff of anything — the claims already say so.
  if (isPortalOnlyToken(c)) return res.status(403).json({ error: 'Forbidden' });

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

  // The requested department (query or body) must be the caller's — inside their tenant.
  const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, any>;
  const requestedTeamId = typeof req.query.teamId === 'string' && req.query.teamId
    ? req.query.teamId
    : (typeof body.teamId === 'string' && body.teamId ? body.teamId : null);
  const tenant = await resolveStaffTenant(c, { teamId: requestedTeamId });
  if (!tenant || !tenant.bid) {
    return res.status(403).json({ error: 'Forbidden: nuk jeni anëtar aktiv i këtij ekipi' });
  }
  const canManage = c.superAdmin || hasManagerRole(tenant.roles);

  try {
    // POST ?action=reload — hot-reload VPS (Admin/Manager). The VPS reloads the whole
    // agent set, so this is a platform-wide operation gated by role, and audited by the VPS log.
    if (req.method === 'POST' && req.query.action === 'reload') {
      if (!canManage) return res.status(403).json({ error: 'Vetëm Admin/Manager mund të ringarkojë agjentët.' });
      if (!(await checkPersistentRateLimit('waReload', c.uid, RELOAD_PER_HOUR))) {
        return res.status(429).json({ error: 'Shumë kërkesa — provoni përsëri më vonë.' });
      }
      const r = await vpsCall(vpsUrl, vpsSecret, '/reload', 'POST');
      return res.status(r.ok ? 200 : r.status).json(await r.json());
    }

    // GET ?action=status[&teamId=xxx] — health + per-agent connection state, for the
    // CALLER's tenant only. Returns { serverOnline, agents: [...], anyConnected, fetchedAt }.
    // Never throws on VPS failure — that's the point of a status check.
    if (req.method === 'GET' && req.query.action === 'status') {
      const offline = (error: string) => res.status(200).json({ serverOnline: false, agents: [], anyConnected: false, error, fetchedAt: Date.now() });
      let r: Response;
      try {
        r = await vpsCall(vpsUrl, vpsSecret, '/status');
      } catch (err) {
        return offline(err instanceof Error ? err.message : 'VPS unreachable');
      }
      if (!r.ok) return offline(`VPS status ${r.status}`);
      const data: any = await r.json().catch(() => ({}));
      // The VPS answers `{ agents: { [id]: {...} } }` (vps/server.ts GET /status).
      const raw = data?.agents ?? data?.statuses;
      const statuses = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};

      // Tenant filter is decided HERE from Firestore, not from the VPS payload's
      // `teamId` (which a mislabelled agent could carry) and not from the query.
      const mine = await tenantAccounts(tenant);
      const mineById = new Map(mine.map((a) => [a.id, a]));
      const agents = Object.entries(statuses)
        .filter(([id]) => mineById.has(id))
        .map(([id, v]: [string, any]) => ({
          id,
          label: v?.label || id,
          status: v?.status || 'disconnected',
          teamId: mineById.get(id)?.teamId ?? (v?.teamId || null),
          assignedToUserId: mineById.get(id)?.assignedToUserId ?? (v?.assignedToUserId || null),
          connectedPhone: typeof v?.connectedPhone === 'string' && v.connectedPhone ? v.connectedPhone : null,
        }))
        .filter((a) => !requestedTeamId || a.teamId === requestedTeamId);
      return res.status(200).json({
        serverOnline: true,
        agents,
        anyConnected: agents.some((a) => a.status === 'connected'),
        fetchedAt: Date.now(),
      });
    }

    // GET ?agentId=xxx — QR / login state for one agent of the caller's tenant (Admin/Manager).
    if (req.method === 'GET') {
      const agentId = typeof req.query.agentId === 'string' ? req.query.agentId : '';
      if (!agentId) return res.status(400).json({ error: 'agentId mungon' });
      if (!canManage) return res.status(403).json({ error: 'Vetëm Admin/Manager mund të lidhë një agjent.' });
      const account = await loadTenantAccount(agentId, tenant);
      if (!account) return res.status(404).json({ error: 'Agjenti nuk u gjet' });
      if (!(await checkPersistentRateLimit('waQr', c.uid, QR_PER_HOUR))) {
        return res.status(429).json({ error: 'Shumë kërkesa — provoni përsëri më vonë.' });
      }
      const r = await vpsCall(vpsUrl, vpsSecret, `/qr-data/${encodeURIComponent(account.id)}`);
      return res.status(r.ok ? 200 : r.status).json(await r.json());
    }

    // POST (no special action) — send WhatsApp message
    if (req.method === 'POST') {
      if (!(await checkPersistentRateLimit('waSend', c.uid, SEND_PER_HOUR))) {
        return res.status(429).json({ error: 'Limiti i dërgimeve u arrit. Provoni përsëri pas pak.' });
      }

      const { to, message, leadId, leadName, jid, agentId } = body;

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

      // The agent: named by the client (and proven ours), or resolved from the tenant's own accounts.
      let account: Account | null;
      if (agentId != null && agentId !== '') {
        account = await loadTenantAccount(String(agentId), tenant);
        if (!account) return res.status(404).json({ error: 'Agjenti nuk u gjet' });
        if (!account.enabled) return res.status(409).json({ error: 'Ky agjent është i çaktivizuar' });
      } else {
        account = pickSendAccount(await tenantAccounts(tenant), c, tenant);
        if (!account) {
          return res.status(404).json({ error: 'Asnjë llogari WhatsApp e aktivizuar për ekipin tuaj (Cilësimet → WhatsApp).' });
        }
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

      // The ACCOUNT's teamId is forwarded — never the body's.
      const sendTeamId = account.teamId || tenant.tid || null;
      const r = await fetch(`${vpsUrl}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': vpsSecret },
        body: JSON.stringify({
          to: normalizedTo,
          message: message.trim(),
          leadId: typeof leadId === 'string' && leadId ? leadId : null,
          leadName: typeof leadName === 'string' && leadName ? leadName.slice(0, 200) : null,
          teamId: sendTeamId,
          jid: hasValidJid ? jid : undefined,
          agentId: account.id,
          // Persisted on the outbound row by the VPS — who answered, for the SLA/first-response stamps.
          sentByUid: c.uid,
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
      const answeredTeamId = sendTeamId || ((data as any)?.teamId as string | undefined) || null;
      if (answeredTeamId && normalizedTo) {
        await markConversationAnswered({
          teamId: answeredTeamId, phone: normalizedTo, byUid: c.uid, source: 'app',
          leadId: typeof leadId === 'string' && leadId ? leadId : null,
        }).catch(() => {});
      }

      return res.status(200).json({ success: true, id: (data as any)?.id, agentId: account.id });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err: unknown) {
    console.error('[whatsapp] Exception:', err instanceof Error ? err.message : err);
    return res.status(500).json({ error: 'Lidhja me VPS dështoi' });
  }
}
