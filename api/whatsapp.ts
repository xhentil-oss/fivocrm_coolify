import type { VercelRequest, VercelResponse } from '@vercel/node';
import { adminDb as db } from './_firebaseAdmin.js';
import { markConversationAnswered, verifyContactRefs, normalizeLid } from './_waInbound.js';
import { checkPersistentRateLimit } from './_rateLimit.js';
import { getTeamConfig } from './_tenantConfig.js';
import { toWaPhone } from './_waPhone.js';
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
 *   GET  ?action=template-status[&teamId=…]   Meta template approval states of the
 *        caller's team (also accepted as POST with `{ action, teamId }` in the body)
 *        → { templates: [{ name, language, status, category, rejectedReason }], … }
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

function validatePhoneStrict(raw: string): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const n = toWaPhone(raw);
  if (!n) return null;
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
const TEMPLATE_STATUS_PER_HOUR = 120;
const META_GRAPH = 'https://graph.facebook.com/v21.0';

/**
 * The VPS base URL, or the named reason it may not be called. https only — the
 * `x-api-key` secret travels with every call; plain http is allowed for a
 * loopback host outside production (dev). URL-parsed: the old prefix regex
 * accepted `http://localhost.evil.com`.
 */
function checkVpsUrl(raw: string): { ok: true; base: string } | { ok: false; error: string } {
  let u: URL;
  try { u = new URL(raw); } catch { return { ok: false, error: 'WHATSAPP_VPS_URL është i pavlefshëm' }; }
  if (u.username || u.password) return { ok: false, error: 'WHATSAPP_VPS_URL nuk duhet të përmbajë kredenciale' };
  const base = `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
  if (u.protocol === 'https:') return { ok: true, base };
  const loopback = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(u.hostname.toLowerCase());
  if (u.protocol === 'http:' && loopback && process.env.VERCEL_ENV !== 'production') return { ok: true, base };
  return { ok: false, error: 'WHATSAPP_VPS_URL duhet të jetë HTTPS' };
}

// ── Meta template approval status ─────────────────────────────────────────────

type TemplateErrorCode = 'not-configured' | 'invalid-token' | 'permission-denied' | 'bad-waba' | 'rate-limited' | 'timeout' | 'upstream';

const TEMPLATE_ERROR: Record<TemplateErrorCode, { status: number; error: string }> = {
  'not-configured': { status: 409, error: 'Meta WhatsApp nuk është konfiguruar për këtë ekip (WABA ID + token te Cilësimet → WhatsApp).' },
  'invalid-token': { status: 502, error: 'Token-i i Meta-s është i pavlefshëm ose ka skaduar.' },
  'permission-denied': { status: 502, error: 'Token-i i Meta-s nuk ka leje për template-t e këtij WABA (whatsapp_business_management).' },
  'bad-waba': { status: 502, error: 'ID-ja e WhatsApp Business Account (WABA) është e pasaktë.' },
  'rate-limited': { status: 429, error: 'Meta po kufizon kërkesat — provoni përsëri pas pak.' },
  'timeout': { status: 504, error: 'Meta nuk u përgjigj në kohë.' },
  'upstream': { status: 502, error: 'Meta ktheu një gabim gjatë leximit të template-ve.' },
};

function classifyMetaError(httpStatus: number, body: any): TemplateErrorCode {
  const e = body?.error || {};
  const code = Number(e.code);
  if (code === 190 || (e.type === 'OAuthException' && /token/i.test(String(e.message || '')))) return 'invalid-token';
  if ([4, 17, 32, 613, 80007, 130429].includes(code) || httpStatus === 429) return 'rate-limited';
  if ([10, 200, 294].includes(code) || (code >= 200 && code < 300)) return 'permission-denied';
  if (code === 100 || code === 803) return 'bad-waba';
  return 'upstream';
}

interface TemplateRow { name: string; language: string; status: string; category: string; rejectedReason: string | null; wabaId: string }

/** (wabaId → token) pairs of the team: every Meta channel that names its WABA, plus the legacy flat fields. */
function wabaCredentials(settings: Record<string, any>): Array<{ wabaId: string; token: string }> {
  const out = new Map<string, string>();
  const channels: any[] = Array.isArray(settings.metaChannels) ? settings.metaChannels : [];
  for (const ch of channels) {
    const waba = String(ch?.businessAccountId || '').trim();
    const token = String(ch?.accessToken || '').trim();
    if (waba && token && !out.has(waba)) out.set(waba, token);
  }
  const legacyWaba = String(settings.metaBusinessAccountId || '').trim();
  const legacyToken = String(settings.metaAccessToken || channels.find((c) => c?.accessToken)?.accessToken || '').trim();
  if (legacyWaba && legacyToken && !out.has(legacyWaba)) out.set(legacyWaba, legacyToken);
  // A WABA id is numeric — anything else would be a path segment we did not intend to call.
  return [...out.entries()].filter(([w]) => /^\d{5,25}$/.test(w)).slice(0, 5).map(([wabaId, token]) => ({ wabaId, token }));
}

async function fetchTemplates(wabaId: string, token: string): Promise<{ ok: true; rows: TemplateRow[] } | { ok: false; code: TemplateErrorCode; detail: string }> {
  const url = `${META_GRAPH}/${wabaId}/message_templates?fields=name,language,status,category,rejected_reason&limit=200`;
  let r: Response;
  try {
    r = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) });
  } catch (err) {
    const name = (err as any)?.name;
    return { ok: false, code: name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'upstream', detail: String((err as Error)?.message || err).slice(0, 200) };
  }
  const body: any = await r.json().catch(() => ({}));
  if (!r.ok) {
    return { ok: false, code: classifyMetaError(r.status, body), detail: String(body?.error?.message || `HTTP ${r.status}`).slice(0, 300) };
  }
  const rows: TemplateRow[] = (Array.isArray(body?.data) ? body.data : []).map((t: any) => ({
    name: String(t?.name || ''),
    language: String(t?.language || ''),
    status: String(t?.status || 'UNKNOWN'),
    category: String(t?.category || ''),
    rejectedReason: t?.rejected_reason && t.rejected_reason !== 'NONE' ? String(t.rejected_reason) : null,
    wabaId,
  })).filter((t: TemplateRow) => t.name);
  return { ok: true, rows };
}

async function vpsCall(vpsUrl: string, vpsSecret: string, path: string, method = 'GET'): Promise<Response> {
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

  // template-status talks to Meta, not to the VPS — dispatched before the VPS checks.
  const action = typeof req.query.action === 'string' ? req.query.action : (typeof body.action === 'string' ? body.action : '');
  if (action === 'template-status' && (req.method === 'GET' || req.method === 'POST')) {
    try {
      const teamId = tenant.tid;
      if (!teamId) return res.status(400).json({ error: 'teamId mungon', code: 'bad-request', templates: [] });
      if (!(await checkPersistentRateLimit('waTplStatus', c.uid, TEMPLATE_STATUS_PER_HOUR))) {
        return res.status(429).json({ error: TEMPLATE_ERROR['rate-limited'].error, code: 'rate-limited', templates: [] });
      }
      const creds = wabaCredentials(await getTeamConfig(teamId));
      if (!creds.length) {
        const e = TEMPLATE_ERROR['not-configured'];
        return res.status(e.status).json({ error: e.error, code: 'not-configured', templates: [] });
      }
      const results = await Promise.all(creds.map((x) => fetchTemplates(x.wabaId, x.token)));
      const templates = results.flatMap((r) => (r.ok ? r.rows : []));
      const errors = results.flatMap((r, i) => (r.ok ? [] : [{ wabaId: creds[i].wabaId, code: r.code, error: TEMPLATE_ERROR[r.code].error, detail: r.detail }]));
      if (!templates.length && errors.length === results.length) {
        const first = errors[0];
        return res.status(TEMPLATE_ERROR[first.code].status).json({ error: first.error, code: first.code, detail: first.detail, templates: [], errors });
      }
      return res.status(200).json({ teamId, templates, ...(errors.length ? { errors } : {}), fetchedAt: Date.now() });
    } catch (err) {
      console.error('[whatsapp] template-status failed:', err instanceof Error ? err.message : err);
      const e = TEMPLATE_ERROR.upstream;
      return res.status(e.status).json({ error: e.error, code: 'upstream', templates: [] });
    }
  }

  const vpsSecret = process.env.WHATSAPP_VPS_SECRET;
  if (!process.env.WHATSAPP_VPS_URL || !vpsSecret) {
    return res.status(503).json({ error: 'WhatsApp nuk është konfiguruar. Shto WHATSAPP_VPS_URL dhe WHATSAPP_VPS_SECRET në Vercel.' });
  }
  // HTTPS before ANY relay: the VPS secret travels in every request header.
  const vpsCheck = checkVpsUrl(process.env.WHATSAPP_VPS_URL);
  if (!vpsCheck.ok) {
    console.error('[whatsapp] Refusing to call the VPS:', vpsCheck.error);
    return res.status(500).json({ error: vpsCheck.error });
  }
  const vpsUrl = vpsCheck.base;

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
      // The VPS answers `{ agents: { [id]: {...} }, …health }` (vps/server.ts GET /status).
      const raw = data?.agents ?? data?.statuses;
      // Server-level health fields pass through untouched. `connectedPhone` at the
      // top level is "the first connected agent" — possibly another tenant's — so it is dropped.
      const { agents: _agents, statuses: _statuses, connectedPhone: _firstPhone, ...health } =
        (data && typeof data === 'object' && !Array.isArray(data) ? data : {}) as Record<string, any>;
      const statuses = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};

      // Tenant filter is decided HERE from Firestore, not from the VPS payload's
      // `teamId` (which a mislabelled agent could carry) and not from the query.
      const mine = await tenantAccounts(tenant);
      const mineById = new Map(mine.map((a) => [a.id, a]));
      const agents = Object.entries(statuses)
        .filter(([id]) => mineById.has(id))
        .map(([id, v]: [string, any]) => ({
          // Per-agent health fields (last error, reconnects, …) pass through; identity is ours.
          ...(v && typeof v === 'object' && !Array.isArray(v) ? v : {}),
          id,
          label: v?.label || id,
          status: v?.status || 'disconnected',
          teamId: mineById.get(id)?.teamId ?? (v?.teamId || null),
          assignedToUserId: mineById.get(id)?.assignedToUserId ?? (v?.assignedToUserId || null),
          connectedPhone: typeof v?.connectedPhone === 'string' && v.connectedPhone ? v.connectedPhone : null,
        }))
        .filter((a) => !requestedTeamId || a.teamId === requestedTeamId);
      return res.status(200).json({
        ...health,
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

      const { to, message, leadId: bodyLeadId, customerId: bodyCustomerId, leadName, jid, agentId } = body;

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

      // Body ids are claims: the lead / customer must belong to the caller's business.
      const refs = await verifyContactRefs({ leadId: bodyLeadId, customerId: bodyCustomerId, businessId: tenant.bid, teamId: account.teamId || tenant.tid });
      if (!refs.ok) return res.status(refs.status).json({ error: refs.error });
      const { leadId, customerId } = refs;

      const hasValidJid = typeof jid === 'string' &&
        (jid.endsWith('@s.whatsapp.net') || jid.endsWith('@lid'));

      // A `…@lid` jid has no phone: its user part must never be treated as one.
      const lid = hasValidJid && (jid as string).endsWith('@lid') ? normalizeLid(jid) : '';
      let normalizedTo = '';
      if (hasValidJid) {
        // JID path is trusted (came from Baileys) — still normalize phone for logging
        normalizedTo = toWaPhone(to) || to.replace(/\D/g, '');
      } else {
        const strict = validatePhoneStrict(to);
        if (!strict) {
          return res.status(400).json({ error: 'Numri i telefonit është i pavlefshëm' });
        }
        normalizedTo = strict;
      }
      const answeredPhone = lid && normalizedTo.replace(/\D/g, '') === lid ? '' : (toWaPhone(normalizedTo) || '');

      // The ACCOUNT's teamId is forwarded — never the body's.
      const sendTeamId = account.teamId || tenant.tid || null;
      const r = await fetch(`${vpsUrl}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': vpsSecret },
        body: JSON.stringify({
          to: normalizedTo,
          message: message.trim(),
          leadId,
          customerId,
          leadName: (typeof leadName === 'string' && leadName ? leadName.slice(0, 200) : null) || refs.leadName,
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
      if (answeredTeamId && (answeredPhone || lid)) {
        await markConversationAnswered({
          teamId: answeredTeamId, phone: answeredPhone, lid: lid || null, byUid: c.uid, source: 'app',
          leadId, customerId,
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
