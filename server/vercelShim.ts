/**
 * The small slice of the Vercel Node runtime our `/api` handlers rely on, so the
 * SAME files run on a plain Node server (Coolify / Docker) without a single change.
 *
 * Measured against the handlers (Nov 2026): they use `req.query`, `req.body`,
 * `req.method`, `req.headers`, `req.url`, `req.socket`, `req.on` (raw-body webhooks)
 * and `res.status().json/send/end`, `res.json`, `res.redirect`, `res.setHeader`.
 * Nothing else — if a handler starts using another helper (`req.cookies`, …), add it
 * here, or it is `undefined` on the self-hosted server only.
 *
 * `vercel.json` stays the ONE source of truth for rewrites and headers: the server
 * reads it at boot (`compileRewrites` / `compileHeaders`) instead of keeping a copy
 * that would drift the first time someone adds `/api/<new-action>`.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

export type Query = Record<string, string | string[]>;

export interface ShimRequest extends IncomingMessage {
  query: Query;
  body: unknown;
}

export interface ShimResponse extends ServerResponse {
  status(code: number): ShimResponse;
  json(body: unknown): ShimResponse;
  send(body: unknown): ShimResponse;
  redirect(statusOrUrl: number | string, url?: string): ShimResponse;
}

/** Vercel's body cap is 4.5 MB; a little headroom, but never unbounded. */
export const MAX_BODY_BYTES = 10 * 1024 * 1024;

// ── query ────────────────────────────────────────────────────────────────────

/** `?a=1&a=2&b=x` → `{ a: ['1','2'], b: 'x' }` — the shape Vercel gives `req.query`. */
export function parseQuery(search: string | URLSearchParams): Query {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  const out: Query = {};
  for (const [k, v] of params) {
    const prev = out[k];
    if (prev === undefined) out[k] = v;
    else out[k] = Array.isArray(prev) ? [...prev, v] : [prev, v];
  }
  return out;
}

// ── rewrites (from vercel.json) ──────────────────────────────────────────────

export interface RewriteRule { source: string; destination: string }
export interface CompiledRewrite { re: RegExp; destination: string }

/**
 * Our `vercel.json` sources are plain regex-shaped paths (`/api/hosting`,
 * `/api/(.*)`, `/((?!api).*)`), so they compile directly to an anchored RegExp.
 * A `:param` style source would need path-to-regexp — refused loudly at boot
 * rather than silently never matching.
 */
export function compileRewrites(rules: RewriteRule[] = []): CompiledRewrite[] {
  return rules.map((r) => {
    if (/(^|\/):[a-zA-Z]/.test(r.source)) {
      throw new Error(`vercel.json rewrite "${r.source}": :param sources are not supported by server/vercelShim.ts`);
    }
    return { re: new RegExp(`^${r.source}$`), destination: r.destination };
  });
}

/**
 * First matching rule wins (Vercel order). The destination's own query params are
 * MERGED over the original ones — `/api/hosting?x=1` → `/api/email?type=hosting&x=1`.
 * Returns the rewritten pathname + query, or null when nothing matched.
 */
export function applyRewrites(
  rules: CompiledRewrite[],
  pathname: string,
  search: URLSearchParams,
): { pathname: string; search: URLSearchParams } | null {
  for (const rule of rules) {
    const m = rule.re.exec(pathname);
    if (!m) continue;
    const dest = rule.destination.replace(/\$(\d+)/g, (_, i) => m[Number(i)] ?? '');
    const u = new URL(dest, 'http://local');
    const merged = new URLSearchParams(search);
    for (const [k, v] of u.searchParams) merged.set(k, v);
    return { pathname: u.pathname, search: merged };
  }
  return null;
}

// ── headers (from vercel.json) ───────────────────────────────────────────────

export interface HeaderRule { source: string; headers: { key: string; value: string }[] }
export interface CompiledHeaders { re: RegExp; headers: [string, string][] }

export function compileHeaders(rules: HeaderRule[] = []): CompiledHeaders[] {
  return rules.map((r) => ({ re: new RegExp(`^${r.source}$`), headers: r.headers.map((h) => [h.key, h.value]) }));
}

export function headersFor(rules: CompiledHeaders[], pathname: string): [string, string][] {
  const out: [string, string][] = [];
  for (const r of rules) if (r.re.test(pathname)) out.push(...r.headers);
  return out;
}

// ── body ─────────────────────────────────────────────────────────────────────

export class BodyError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function readRawBody(req: IncomingMessage, limit = MAX_BODY_BYTES): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new BodyError(413, 'Payload too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/**
 * Vercel's helper semantics: JSON → object (invalid JSON = 400), urlencoded →
 * object, text/* → string, anything else non-empty → Buffer, empty → undefined.
 */
export function parseBody(raw: Buffer, contentType: string | undefined): unknown {
  if (!raw.length) return undefined;
  const ct = (contentType || '').split(';')[0].trim().toLowerCase();
  if (ct === 'application/json' || ct.endsWith('+json')) {
    try { return JSON.parse(raw.toString('utf8')); } catch { throw new BodyError(400, 'Invalid JSON body'); }
  }
  if (ct === 'application/x-www-form-urlencoded') {
    return Object.fromEntries(new URLSearchParams(raw.toString('utf8')));
  }
  if (ct.startsWith('text/')) return raw.toString('utf8');
  return raw;
}

// ── response helpers ─────────────────────────────────────────────────────────

export function augmentResponse(res: ServerResponse): ShimResponse {
  const r = res as ShimResponse;
  r.status = (code: number) => { r.statusCode = code; return r; };
  r.json = (body: unknown) => {
    if (!r.getHeader('Content-Type')) r.setHeader('Content-Type', 'application/json; charset=utf-8');
    r.end(JSON.stringify(body));
    return r;
  };
  r.send = (body: unknown) => {
    if (body === undefined || body === null) { r.end(); return r; }
    if (Buffer.isBuffer(body)) {
      if (!r.getHeader('Content-Type')) r.setHeader('Content-Type', 'application/octet-stream');
      r.end(body);
      return r;
    }
    if (typeof body === 'object') return r.json(body);
    if (!r.getHeader('Content-Type')) r.setHeader('Content-Type', 'text/html; charset=utf-8');
    r.end(String(body));
    return r;
  };
  r.redirect = (statusOrUrl: number | string, url?: string) => {
    const code = typeof statusOrUrl === 'number' ? statusOrUrl : 307;
    const location = typeof statusOrUrl === 'string' ? statusOrUrl : String(url || '/');
    r.statusCode = code;
    r.setHeader('Location', location);
    r.end();
    return r;
  };
  return r;
}

/** True when a handler module opted out of body parsing (`export const config = { api: { bodyParser: false } }`). */
export function wantsRawBody(mod: { config?: { api?: { bodyParser?: unknown } } }): boolean {
  return mod?.config?.api?.bodyParser === false;
}
