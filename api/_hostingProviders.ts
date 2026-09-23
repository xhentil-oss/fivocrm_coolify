/**
 * Hosting & domains — provider drivers (server-only).
 *
 *   • cPanel/WHM  — WHM API 1 over HTTPS :2087, `Authorization: whm user:token`.
 *   • Dynadot     — API v3 (`api3.json`), `key=` + `command=`.
 *
 * Both providers whitelist CALLER IPs (WHM firewalls do, Dynadot requires it), and
 * Vercel has no static egress IP — so every call can be relayed through the VPS
 * (`/provider-proxy`, same static IP + `x-api-key` as the WHMCS relay). Set
 * `HOSTING_PROXY_URL` (or `WHMCS_PROXY_URL`, whose `/whmcs-proxy` path is rewritten)
 * to enable it; unset = direct fetch (fine for a dev box whose IP is whitelisted).
 *
 * Rules:
 *   • Every call is POST with a form body — passwords and tokens never travel in a
 *     query string that lands in access logs.
 *   • A provider "error" response is a thrown `ProviderError` with the provider's
 *     own reason, so the caller can store it on the record and show it to staff.
 *   • Drivers know NOTHING about Firestore. `api/_hostingJobs.ts` decides what to
 *     do with the result.
 */

import { lookup as dnsLookup } from 'dns/promises';

export class ProviderError extends Error {
  provider: 'whm' | 'dynadot' | 'proxy';
  code?: string;
  constructor(provider: ProviderError['provider'], message: string, code?: string) {
    super(message);
    this.name = 'ProviderError';
    this.provider = provider;
    this.code = code;
  }
}

// ── Transport (direct or via the VPS relay) ────────────────────────────────────

interface RawResponse {
  status: number;
  text: string;
}

function proxyUrl(): string | null {
  const explicit = process.env.HOSTING_PROXY_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, '');
  const whmcs = process.env.WHMCS_PROXY_URL?.trim();
  if (whmcs) return whmcs.replace(/\/whmcs-proxy\/?$/, '') + '/provider-proxy';
  return null;
}

export function providerProxyConfigured(): boolean {
  return !!proxyUrl();
}

// ── Direct-mode SSRF guard ─────────────────────────────────────────────────────
// In proxy mode the VPS relay enforces this (vps/server.ts: isPrivateIp /
// resolvesToPrivate + the host/port allow-list). In DIRECT mode nothing did:
// `server.hostname` is tenant-editable, so a hostname resolving to 10.x / the
// metadata endpoint / localhost:2087 would have been fetched with the WHM token
// attached. Same predicate as the VPS copy — keep the two in sync.

/**
 * Private / loopback / link-local / unspecified / CGNAT / multicast, v4 and v6,
 * including the `::ffff:a.b.c.d` IPv4-mapped forms a dual-stack resolver returns.
 */
function isPrivateAddress(raw: string): boolean {
  let ip = String(raw || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!ip) return true;
  const zone = ip.indexOf('%'); if (zone !== -1) ip = ip.slice(0, zone);
  const mappedDotted = /^(?:0*:)*:?ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(ip);
  if (mappedDotted) ip = mappedDotted[1];
  const mappedHex = /^(?:0*:)*:?ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(ip);
  if (mappedHex) {
    const hi = parseInt(mappedHex[1], 16); const lo = parseInt(mappedHex[2], 16);
    ip = `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
    const o = ip.split('.').map(Number);
    if (o.some((n) => n > 255)) return true;
    if (o[0] === 0 || o[0] === 10 || o[0] === 127) return true;
    if (o[0] === 169 && o[1] === 254) return true;
    if (o[0] === 172 && o[1] >= 16 && o[1] <= 31) return true;
    if (o[0] === 192 && o[1] === 168) return true;
    if (o[0] === 100 && o[1] >= 64 && o[1] <= 127) return true;
    if (o[0] === 192 && o[1] === 0 && (o[2] === 0 || o[2] === 2)) return true;
    if (o[0] === 198 && (o[1] === 18 || o[1] === 19)) return true;
    if (o[0] >= 224) return true;
    return false;
  }
  if (!ip.includes(':')) return true;
  const groups = ip.split(':').map((g) => g.replace(/^0+(?=[0-9a-f])/, ''));
  const norm = groups.join(':');
  if (norm === '::' || norm === '::1' || norm === '0:0:0:0:0:0:0:0' || norm === '0:0:0:0:0:0:0:1') return true;
  if (groups.every((g) => g === '' || g === '0')) return true;
  if (/(^|:)ffff:\d{1,3}\./.test(norm) || /(^|:)ffff:[0-9a-f]{1,4}:[0-9a-f]{1,4}$/.test(norm)) return true;
  const first = parseInt(groups[0] || '0', 16);
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10
  if ((first & 0xff00) === 0xff00) return true; // ff00::/8
  if (first === 0x2001 && /^2001:db8:/.test(norm)) return true;
  if (/^64:ff9b:/.test(norm)) return true;
  return false;
}

/**
 * Direct mode only: https, an allowed port (2087/2083 for WHM/cPanel, 443 for
 * Dynadot), and NO resolved address may be private. Resolves once, up front;
 * throws a ProviderError('proxy') with the reason so the caller stores it.
 */
async function assertSafeDirectTarget(url: string): Promise<void> {
  let target: URL;
  try { target = new URL(url); } catch { throw new ProviderError('proxy', 'URL e ofruesit e pavlefshme'); }
  if (target.protocol !== 'https:') throw new ProviderError('proxy', 'Ofruesi thirret vetëm përmes https');
  if (target.username || target.password) throw new ProviderError('proxy', 'URL me kredenciale e refuzuar');
  const host = target.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const port = target.port || '443';
  const isDynadot = host === 'api.dynadot.com';
  if (isDynadot ? port !== '443' : !(port === '2087' || port === '2083')) {
    throw new ProviderError('proxy', `Porta ${port} nuk lejohet për ofruesin (vetëm 2087/2083 për WHM, 443 për Dynadot)`);
  }
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new ProviderError('proxy', 'Hostname lokal i refuzuar');
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':')) {
    if (isPrivateAddress(host)) throw new ProviderError('proxy', 'Adresë private/loopback e refuzuar');
    return;
  }
  let addrs: Array<{ address: string }>;
  try { addrs = await dnsLookup(host, { all: true, verbatim: true }); }
  catch { throw new ProviderError('proxy', `Hostname-i ${host} nuk u zgjidh (DNS)`); }
  if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) {
    throw new ProviderError('proxy', 'Hostname-i i ofruesit zgjidhet në adresë private/loopback — refuzohet');
  }
}

async function providerFetch(
  url: string,
  init: { method?: 'GET' | 'POST'; headers?: Record<string, string>; body?: string; timeoutMs?: number },
): Promise<RawResponse> {
  const timeout = init.timeoutMs ?? 25_000;
  const proxy = proxyUrl();
  // Direct mode gets the same allow-list the relay enforces; proxy mode is unchanged
  // (the VPS validates the target itself and refuses redirects).
  if (!proxy) await assertSafeDirectTarget(url);
  try {
    if (proxy) {
      const r = await fetch(proxy, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.WHMCS_PROXY_SECRET || process.env.HOSTING_PROXY_SECRET || '',
        },
        body: JSON.stringify({ url, method: init.method || 'POST', headers: init.headers || {}, body: init.body ?? null }),
        signal: AbortSignal.timeout(timeout + 5_000),
      });
      const text = await r.text();
      if (!r.ok) {
        let msg = text;
        try { msg = JSON.parse(text)?.error || text; } catch { /* keep text */ }
        throw new ProviderError('proxy', `Relay (VPS) ktheu ${r.status}: ${String(msg).slice(0, 200)}`);
      }
      let parsed: any;
      try { parsed = JSON.parse(text); } catch { throw new ProviderError('proxy', 'Relay (VPS) ktheu përgjigje jo-JSON'); }
      return { status: Number(parsed.status) || 0, text: String(parsed.body ?? '') };
    }
    const r = await fetch(url, {
      method: init.method || 'POST',
      headers: init.headers,
      body: init.body,
      // Never follow a provider redirect: it would carry the Authorization header
      // to whatever host the redirect names, past the check above.
      redirect: 'manual',
      signal: AbortSignal.timeout(timeout),
    });
    if (r.status >= 300 && r.status < 400) throw new ProviderError('proxy', `Ofruesi ktheu ridrejtim (${r.status}) — nuk ndiqet`);
    return { status: r.status, text: await r.text() };
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new ProviderError('proxy', /abort|timeout/i.test(msg) ? 'Ofruesi nuk u përgjigj në kohë (timeout)' : `Lidhja me ofruesin dështoi: ${msg}`);
  }
}

function formBody(params: Record<string, string | number | boolean | undefined | null>): string {
  const b = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    b.set(k, typeof v === 'boolean' ? (v ? '1' : '0') : String(v));
  }
  return b.toString();
}

// ── cPanel / WHM ───────────────────────────────────────────────────────────────

export interface WhmServer {
  hostname: string;
  port?: number;
  username: string;
  apiToken: string;
}

export interface WhmAccount {
  user: string;
  domain: string;
  plan?: string;
  suspended: boolean;
  suspendReason?: string;
  diskUsedMb?: number | null;
  diskLimitMb?: number | null;
  ip?: string;
  email?: string;
  startDate?: string;
}

export function normalizeHostname(raw: string): string {
  return String(raw || '').trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/[/:].*$/, '');
}

async function whmCall(server: WhmServer, fn: string, params: Record<string, string | number | boolean | undefined | null> = {}): Promise<any> {
  const host = normalizeHostname(server.hostname);
  if (!host) throw new ProviderError('whm', 'Serveri nuk ka hostname');
  if (!server.apiToken) throw new ProviderError('whm', 'Serveri nuk ka API token të ruajtur');
  const port = server.port && server.port > 0 ? server.port : 2087;
  const url = `https://${host}:${port}/json-api/${fn}`;
  const res = await providerFetch(url, {
    method: 'POST',
    headers: {
      Authorization: `whm ${server.username || 'root'}:${server.apiToken}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: formBody({ 'api.version': 1, ...params }),
  });
  if (res.status === 401 || res.status === 403) throw new ProviderError('whm', 'WHM refuzoi kredencialet (401/403) — kontrollo user + API token', 'auth');
  let json: any;
  try { json = JSON.parse(res.text); } catch {
    throw new ProviderError('whm', `WHM ktheu përgjigje jo-JSON (HTTP ${res.status})`);
  }
  const meta = json?.metadata;
  if (!meta || Number(meta.result) !== 1) {
    const reason = String(meta?.reason || json?.cpanelresult?.error || 'Gabim i panjohur nga WHM').slice(0, 400);
    throw new ProviderError('whm', reason, 'whm-error');
  }
  return json.data ?? {};
}

export async function whmVersion(server: WhmServer): Promise<string> {
  const d = await whmCall(server, 'version');
  return String(d?.version || '');
}

export async function whmListPackages(server: WhmServer): Promise<string[]> {
  const d = await whmCall(server, 'listpkgs');
  const pkgs = Array.isArray(d?.pkg) ? d.pkg : [];
  return pkgs.map((p: any) => String(p?.name || '')).filter(Boolean);
}

function mbFromWhm(v: unknown): number | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim().toLowerCase();
  if (!s || s === 'unlimited') return null;
  const n = parseFloat(s.replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function mapAccount(a: any): WhmAccount {
  const s = a?.suspended;
  return {
    user: String(a?.user || ''),
    domain: String(a?.domain || ''),
    plan: a?.plan ? String(a.plan) : undefined,
    suspended: s === 1 || s === '1' || s === true,
    suspendReason: a?.suspendreason ? String(a.suspendreason) : undefined,
    diskUsedMb: mbFromWhm(a?.diskused),
    diskLimitMb: mbFromWhm(a?.disklimit),
    ip: a?.ip ? String(a.ip) : undefined,
    email: a?.email ? String(a.email) : undefined,
    startDate: a?.startdate ? String(a.startdate) : undefined,
  };
}

export async function whmListAccounts(server: WhmServer): Promise<WhmAccount[]> {
  const d = await whmCall(server, 'listaccts', { 'api.chunk.enable': 1, 'api.chunk.size': 500 });
  const rows = Array.isArray(d?.acct) ? d.acct : [];
  return rows.map(mapAccount);
}

export async function whmAccountSummary(server: WhmServer, user: string): Promise<WhmAccount | null> {
  try {
    const d = await whmCall(server, 'accountsummary', { user });
    const rows = Array.isArray(d?.acct) ? d.acct : [];
    return rows.length ? mapAccount(rows[0]) : null;
  } catch (err) {
    if (err instanceof ProviderError && /does not exist|not exist|no such user|not found/i.test(err.message)) return null;
    throw err;
  }
}

export interface WhmCreateInput {
  username: string;
  domain: string;
  plan: string;
  password: string;
  contactEmail?: string;
  /** Reseller owner (WHM user) — defaults to the API user. */
  owner?: string;
}

export interface WhmCreateResult {
  ip?: string;
  nameservers: string[];
  raw?: string;
}

export async function whmCreateAccount(server: WhmServer, input: WhmCreateInput): Promise<WhmCreateResult> {
  const d = await whmCall(server, 'createacct', {
    username: input.username,
    domain: input.domain,
    plan: input.plan,
    password: input.password,
    contactemail: input.contactEmail,
    owner: input.owner,
    // Never auto-provision a dedicated IP; never mail the raw output anywhere.
    ip: 'n',
  });
  const ns = [d?.nameserver, d?.nameserver2, d?.nameserver3, d?.nameserver4]
    .map((x: unknown) => String(x || '').trim())
    .filter(Boolean);
  return { ip: d?.ip ? String(d.ip) : undefined, nameservers: ns, raw: undefined };
}

export async function whmSuspendAccount(server: WhmServer, user: string, reason: string): Promise<void> {
  await whmCall(server, 'suspendacct', { user, reason: reason.slice(0, 200) });
}

export async function whmUnsuspendAccount(server: WhmServer, user: string): Promise<void> {
  await whmCall(server, 'unsuspendacct', { user });
}

/**
 * Full account backup (`pkgacct`) into /home on the server (cpmove-<user>.tar.gz).
 * Slow on big accounts, so the timeout is the whole function budget. The caller
 * REFUSES to terminate when this fails — data loss must never be silent.
 */
export async function whmBackupAccount(server: WhmServer, user: string): Promise<{ path?: string }> {
  const host = normalizeHostname(server.hostname);
  const port = server.port && server.port > 0 ? server.port : 2087;
  const res = await providerFetch(`https://${host}:${port}/json-api/pkgacct`, {
    method: 'POST',
    headers: { Authorization: `whm ${server.username || 'root'}:${server.apiToken}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formBody({ 'api.version': 1, user, skiphomedir: 0 }),
    timeoutMs: 55_000,
  });
  let json: any;
  try { json = JSON.parse(res.text); } catch { throw new ProviderError('whm', `pkgacct ktheu përgjigje jo-JSON (HTTP ${res.status})`); }
  if (Number(json?.metadata?.result) !== 1) throw new ProviderError('whm', String(json?.metadata?.reason || 'pkgacct dështoi'), 'whm-error');
  const raw = String(json?.metadata?.output?.raw || '');
  const m = /(\/home\S*cpmove-[^\s'"]+\.tar\.gz)/.exec(raw);
  return { path: m ? m[1] : undefined };
}

/** DESTRUCTIVE: removes the account and its files. Call `whmBackupAccount` first. */
export async function whmTerminateAccount(server: WhmServer, user: string): Promise<void> {
  await whmCall(server, 'removeacct', { user, keepdns: 0 });
}

export async function whmChangePackage(server: WhmServer, user: string, pkg: string): Promise<void> {
  await whmCall(server, 'changepackage', { user, pkg });
}

export async function whmSetPassword(server: WhmServer, user: string, password: string): Promise<void> {
  await whmCall(server, 'passwd', { user, password, db_pass_update: 1 });
}

/** One-time login URL into the customer's cPanel (valid for a few minutes). */
export async function whmCreateSession(server: WhmServer, user: string, service: 'cpaneld' | 'webmaild' = 'cpaneld'): Promise<string> {
  const d = await whmCall(server, 'create_user_session', { user, service });
  const url = String(d?.url || '');
  if (!/^https?:\/\//i.test(url)) throw new ProviderError('whm', 'WHM nuk ktheu URL sesioni');
  return url;
}

export function isWhmAccountExists(err: unknown): boolean {
  return err instanceof ProviderError && err.provider === 'whm'
    && /already exists|already in use|is already|exists on this server/i.test(err.message);
}

// ── Dynadot ────────────────────────────────────────────────────────────────────

const DYNADOT_API = 'https://api.dynadot.com/api3.json';

export interface DynadotSearchResult {
  domain: string;
  /** `available` | `taken` | `unknown` (offline TLD / error). */
  status: 'available' | 'taken' | 'unknown';
  /** Registrar price in the account currency, when `showPrice` was requested. */
  price?: number | null;
  priceCurrency?: string | null;
}

export interface DynadotDomainInfo {
  name: string;
  expiration: Date | null;
  registration: Date | null;
  nameservers: string[];
  nsType?: string;
  locked?: boolean;
  privacy?: string;
  renewOption?: string;
  status?: string;
}

async function dynadotCall(apiKey: string, command: string, params: Record<string, string | number | undefined | null> = {}): Promise<any> {
  if (!apiKey) throw new ProviderError('dynadot', 'Çelësi i API-së së Dynadot nuk është ruajtur');
  const res = await providerFetch(DYNADOT_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formBody({ key: apiKey, command, ...params }),
    timeoutMs: 40_000,
  });
  let json: any;
  try { json = JSON.parse(res.text); } catch {
    throw new ProviderError('dynadot', `Dynadot ktheu përgjigje jo-JSON (HTTP ${res.status})`);
  }
  // Every command answers `{ <Command>Response: { ResponseCode, Error?, Status?, ... } }`.
  const key = Object.keys(json || {}).find((k) => /Response$/i.test(k));
  const body = key ? json[key] : json;
  const code = Number(body?.ResponseCode ?? body?.responseCode ?? -1);
  if (code !== 0) {
    const reason = String(body?.Error || body?.error || body?.Status || 'Gabim i panjohur nga Dynadot').slice(0, 400);
    throw new ProviderError('dynadot', reason, 'dynadot-error');
  }
  return body;
}

export async function dynadotAccountInfo(apiKey: string): Promise<{ username?: string; balances: Array<{ currency: string; amount: number }> }> {
  const b = await dynadotCall(apiKey, 'account_info');
  const info = b?.AccountInfo || {};
  const balances = (Array.isArray(info.Balance) ? info.Balance : [])
    .map((x: any) => ({ currency: String(x?.Currency || ''), amount: Number(x?.Amount) || 0 }))
    .filter((x: any) => x.currency);
  return { username: info.Username ? String(info.Username) : undefined, balances };
}

function parseDynadotMoney(raw: unknown): { price: number | null; currency: string | null } {
  // "12.99 in USD" | "12.99" | { Price: ..., Currency: ... }
  if (raw === undefined || raw === null) return { price: null, currency: null };
  const s = String(raw);
  const m = /([0-9]+(?:\.[0-9]+)?)\s*(?:in\s+)?([A-Z]{3})?/i.exec(s);
  if (!m) return { price: null, currency: null };
  return { price: Number(m[1]), currency: m[2] ? m[2].toUpperCase() : null };
}

export async function dynadotSearch(apiKey: string, domains: string[], opts: { showPrice?: boolean; currency?: string } = {}): Promise<DynadotSearchResult[]> {
  const list = domains.slice(0, 20);
  if (!list.length) return [];
  const params: Record<string, string | number> = {};
  list.forEach((d, i) => { params[`domain${i}`] = d; });
  if (opts.showPrice) {
    params.show_price = 1;
    if (opts.currency) params.currency = opts.currency;
  }
  const b = await dynadotCall(apiKey, 'search', params);
  const rows = Array.isArray(b?.SearchResults) ? b.SearchResults : [];
  const byName = new Map<string, any>();
  for (const r of rows) byName.set(String(r?.DomainName || '').toLowerCase(), r);
  return list.map((d) => {
    const r = byName.get(d.toLowerCase());
    const avail = String(r?.Available || '').toLowerCase();
    const status: DynadotSearchResult['status'] = avail === 'yes' ? 'available' : avail === 'no' ? 'taken' : 'unknown';
    const money = parseDynadotMoney(r?.Price);
    return { domain: d, status, price: money.price, priceCurrency: money.currency };
  });
}

function dynadotDate(raw: unknown): Date | null {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) {
    // Milliseconds since epoch (Dynadot) — tolerate seconds too.
    const ms = n < 1e11 ? n * 1000 : n;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(String(raw));
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function dynadotRegister(apiKey: string, domain: string, years: number, opts: { currency?: string; registrantContactId?: string } = {}): Promise<{ expiration: Date | null }> {
  const b = await dynadotCall(apiKey, 'register', {
    domain,
    duration: Math.max(1, Math.min(10, Math.floor(years || 1))),
    currency: opts.currency,
    registrant_contact: opts.registrantContactId,
    admin_contact: opts.registrantContactId,
    technical_contact: opts.registrantContactId,
    billing_contact: opts.registrantContactId,
  });
  return { expiration: dynadotDate(b?.Expiration) };
}

export async function dynadotRenew(apiKey: string, domain: string, years: number, opts: { currency?: string } = {}): Promise<{ expiration: Date | null }> {
  const b = await dynadotCall(apiKey, 'renew', {
    domain,
    duration: Math.max(1, Math.min(10, Math.floor(years || 1))),
    currency: opts.currency,
  });
  return { expiration: dynadotDate(b?.Expiration) };
}

export async function dynadotTransfer(apiKey: string, domain: string, authCode: string, opts: { currency?: string } = {}): Promise<void> {
  await dynadotCall(apiKey, 'transfer', { domain, auth: authCode, currency: opts.currency });
}

export async function dynadotDomainInfo(apiKey: string, domain: string): Promise<DynadotDomainInfo | null> {
  let b: any;
  try {
    b = await dynadotCall(apiKey, 'domain_info', { domain });
  } catch (err) {
    if (err instanceof ProviderError && /not in your account|not found|does not exist|invalid domain/i.test(err.message)) return null;
    throw err;
  }
  const info = b?.DomainInfo || {};
  const nsBlock = info.NameServerSettings || {};
  const nsRaw = Array.isArray(nsBlock.NameServers) ? nsBlock.NameServers : [];
  const nameservers = nsRaw.map((x: any) => String(typeof x === 'string' ? x : x?.ServerName || x?.Name || '').trim().toLowerCase()).filter(Boolean);
  return {
    name: String(info.Name || domain),
    expiration: dynadotDate(info.Expiration),
    registration: dynadotDate(info.Registration),
    nameservers,
    nsType: nsBlock.Type ? String(nsBlock.Type) : undefined,
    locked: info.Locked !== undefined ? String(info.Locked).toLowerCase() === 'yes' : undefined,
    privacy: info.Privacy ? String(info.Privacy) : undefined,
    renewOption: info.RenewOption ? String(info.RenewOption) : undefined,
    status: info.Status ? String(info.Status) : undefined,
  };
}

export async function dynadotSetNameservers(apiKey: string, domain: string, nameservers: string[]): Promise<void> {
  const ns = nameservers.map((n) => normalizeHostname(n)).filter(Boolean).slice(0, 13);
  if (ns.length < 2) throw new ProviderError('dynadot', 'Duhen të paktën dy nameserver-a');
  const params: Record<string, string> = { domain };
  ns.forEach((n, i) => { params[`ns${i}`] = n; });
  await dynadotCall(apiKey, 'set_ns', params);
}

/** Point the apex + www at an IP using Dynadot DNS (alternative to custom nameservers). */
export async function dynadotSetDnsToIp(apiKey: string, domain: string, ip: string): Promise<void> {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) throw new ProviderError('dynadot', 'IP e pavlefshme');
  await dynadotCall(apiKey, 'set_dns2', {
    domain,
    main_record_type0: 'a',
    main_record0: ip,
    subdomain0: 'www',
    sub_record_type0: 'a',
    sub_record0: ip,
  });
}

export async function dynadotSetPrivacy(apiKey: string, domain: string, option: 'full' | 'partial' | 'off'): Promise<void> {
  await dynadotCall(apiKey, 'set_privacy', { domain, option });
}

export async function dynadotSetRenewOption(apiKey: string, domain: string, option: 'auto' | 'donot' | 'reset'): Promise<void> {
  await dynadotCall(apiKey, 'set_renew_option', { domain, renew_option: option });
}

export async function dynadotGetAuthCode(apiKey: string, domain: string): Promise<string> {
  const b = await dynadotCall(apiKey, 'get_transfer_auth_code', { domain });
  const code = String(b?.AuthCode || b?.auth_code || '');
  if (!code) throw new ProviderError('dynadot', 'Dynadot nuk ktheu kod transferimi');
  return code;
}

export async function dynadotListDomains(apiKey: string): Promise<Array<{ name: string; expiration: Date | null }>> {
  const b = await dynadotCall(apiKey, 'list_domain');
  const main = Array.isArray(b?.MainDomains) ? b.MainDomains : (Array.isArray(b?.DomainInfoList) ? b.DomainInfoList : []);
  return main.map((d: any) => ({ name: String(d?.Name || d?.DomainInfo?.Name || '').toLowerCase(), expiration: dynadotDate(d?.Expiration ?? d?.DomainInfo?.Expiration) })).filter((d: any) => d.name);
}

/** Redact anything that looks like a credential before it reaches an audit row. */
export function redactProviderError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.replace(/(token|password|key)=([^&\s]+)/gi, '$1=***').slice(0, 500);
}

// ── Dynadot TLD price list (wholesale costs) ───────────────────────────────────

export interface DynadotTldPrice {
  tld: string;
  register: number | null;
  renew: number | null;
  transfer: number | null;
  currency: string | null;
}

function pickPrice(obj: any, re: RegExp): { price: number | null; currency: string | null } {
  if (!obj || typeof obj !== 'object') return { price: null, currency: null };
  for (const [k, v] of Object.entries(obj)) {
    if (!re.test(k)) continue;
    if (v && typeof v === 'object') {
      const inner = (v as any).Price ?? (v as any).price ?? (v as any).Amount ?? null;
      const m = parseDynadotMoney(inner);
      return { price: m.price, currency: m.currency || ((v as any).Currency ? String((v as any).Currency) : null) };
    }
    return parseDynadotMoney(v);
  }
  return { price: null, currency: null };
}

/**
 * Wholesale price per TLD in the account currency. The response shape of
 * `get_tld_price` is parsed leniently (list key, nested Price objects or "x in USD"
 * strings) — the first live sync is where this gets confirmed. Unknown TLDs simply
 * do not appear; the caller keeps its hand-entered costs for them.
 */
export async function dynadotTldPrices(apiKey: string, currency?: string): Promise<DynadotTldPrice[]> {
  const b = await dynadotCall(apiKey, 'get_tld_price', { currency });
  const listKey = Object.keys(b || {}).find((k) => Array.isArray((b as any)[k]) && /tld|price/i.test(k));
  const list: any[] = listKey ? (b as any)[listKey] : [];
  const out: DynadotTldPrice[] = [];
  for (const x of list) {
    const tld = String(x?.Tld ?? x?.TLD ?? x?.tld ?? x?.Name ?? '').replace(/^\.+/, '').toLowerCase();
    if (!tld) continue;
    const priceObj = x?.Price && typeof x.Price === 'object' ? x.Price : x;
    const reg = pickPrice(priceObj, /^regist/i);
    const ren = pickPrice(priceObj, /^renew/i);
    const tra = pickPrice(priceObj, /^transfer/i);
    const cur = reg.currency || ren.currency || tra.currency || (x?.Currency ? String(x.Currency) : null) || (currency || null);
    out.push({ tld, register: reg.price, renew: ren.price, transfer: tra.price, currency: cur });
  }
  return out;
}
