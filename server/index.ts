/**
 * Self-hosted FivoCRM web server (Coolify / Docker) — the Vercel deployment, as one
 * Node process: the built SPA from `dist/` + the `/api` functions, UNCHANGED.
 *
 *   Vercel                         here
 *   ─────────────────────────────  ──────────────────────────────────────────────
 *   static files from dist/        serveStatic() (filesystem first, like Vercel)
 *   vercel.json rewrites/headers   read from vercel.json at boot (one source)
 *   one function per api/*.ts      ROUTES below, lazily imported per route
 *   maxDuration                    API_TIMEOUT_MS (default 300 s) → 504
 *
 * WhatsApp (Baileys) and the cron SCHEDULER stay on the VPS (`vps/server.ts`): the
 * scheduler only needs `CRM_BASE_URL` pointed at this server.
 *
 * Build: `npm run build && npm run build:server` → `node dist-server/index.mjs`.
 * Env: everything Vercel had, plus VERCEL_ENV=production (the Dockerfile sets it —
 * without it `platformHosts()` / the WhatsApp relay also trust localhost).
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {
  applyRewrites, augmentResponse, BodyError, compileHeaders, compileRewrites, headersFor,
  parseBody, parseQuery, readRawBody, wantsRawBody,
  type CompiledHeaders, type CompiledRewrite, type ShimRequest,
} from './vercelShim';

type Handler = (req: any, res: any) => unknown;
type HandlerModule = { default: Handler; config?: { api?: { bodyParser?: unknown } } };

/**
 * Every deployable function in `api/` (files starting with `_` are helpers, exactly
 * as on Vercel). Adding `api/foo.ts` means adding it here too — the server answers
 * 404 for an unknown route rather than guessing.
 *
 * Imports are lazy and isolated: on Vercel a module that throws at load time takes
 * down ONE function; here a top-level `import` would take down the whole server.
 * Every route is warmed at boot (`warmUp`); a failure answers 500 for that route and
 * turns `/healthz` into 503, so Coolify refuses the deploy and keeps the old
 * container instead of shipping a server with a dead endpoint. A failed module is
 * NOT retried — the bundle's module init does not re-run, the process must restart.
 */
const ROUTES: Record<string, () => Promise<HandlerModule>> = {
  '/api/ai-chat': () => import('../api/ai-chat'),
  '/api/create-checkout-session': () => import('../api/create-checkout-session'),
  '/api/daily-room': () => import('../api/daily-room'),
  '/api/email': () => import('../api/email'),
  '/api/landing': () => import('../api/landing'),
  '/api/meta-send': () => import('../api/meta-send'),
  '/api/meta-send-media': () => import('../api/meta-send-media'),
  '/api/meta-webhook': () => import('../api/meta-webhook'),
  '/api/stripe-webhook': () => import('../api/stripe-webhook'),
  '/api/whatsapp': () => import('../api/whatsapp'),
  '/api/whmcs-webhook': () => import('../api/whmcs-webhook'),
  '/api/cron/run': () => import('../api/cron/run'),
};

const PORT = Number(process.env.PORT) || 3000;
const ROOT = process.cwd();
const DIST_DIR = path.resolve(ROOT, process.env.DIST_DIR || 'dist');
const VERCEL_JSON = path.resolve(ROOT, process.env.VERCEL_JSON || 'vercel.json');
const API_TIMEOUT_MS = Number(process.env.API_TIMEOUT_MS) || 300_000;

const vercelConfig = JSON.parse(fs.readFileSync(VERCEL_JSON, 'utf8'));
const rewrites: CompiledRewrite[] = compileRewrites(vercelConfig.rewrites);
const headerRules: CompiledHeaders[] = compileHeaders(vercelConfig.headers);

const moduleCache = new Map<string, Promise<HandlerModule>>();
const failedRoutes = new Set<string>();
function loadRoute(route: string): Promise<HandlerModule> {
  let p = moduleCache.get(route);
  if (!p) {
    p = ROUTES[route]();
    p.catch(() => failedRoutes.add(route));
    moduleCache.set(route, p);
  }
  return p;
}

let warmedUp = false;
async function warmUp() {
  await Promise.allSettled(Object.keys(ROUTES).map((r) => loadRoute(r).catch((err) => {
    console.error(`[server] ✗ ${r} failed to load:`, (err as Error)?.message || err);
  })));
  warmedUp = true;
  if (failedRoutes.size) console.error(`[server] ${failedRoutes.size} route(s) unavailable — /healthz answers 503`);
  else console.log(`[server] all ${Object.keys(ROUTES).length} routes loaded`);
}

// ── static ───────────────────────────────────────────────────────────────────

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.map': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.avif': 'image/avif', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4',
  '.webm': 'video/webm', '.wav': 'audio/wav', '.pdf': 'application/pdf',
};

/** Resolves a URL path inside dist/, or null (missing, a directory, a dotfile, or outside dist). */
function staticFile(pathname: string): string | null {
  let decoded: string;
  try { decoded = decodeURIComponent(pathname); } catch { return null; }
  if (decoded.includes('\0') || decoded.split('/').some((seg) => seg.startsWith('.'))) return null;
  const file = path.resolve(DIST_DIR, '.' + decoded);
  if (file !== DIST_DIR && !file.startsWith(DIST_DIR + path.sep)) return null;
  try { return fs.statSync(file).isFile() ? file : null; } catch { return null; }
}

function serveStatic(req: http.IncomingMessage, res: http.ServerResponse, file: string, extraHeaders: [string, string][]) {
  const ext = path.extname(file).toLowerCase();
  const rel = path.relative(DIST_DIR, file).split(path.sep).join('/');
  res.statusCode = 200;
  for (const [k, v] of extraHeaders) res.setHeader(k, v);
  res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
  // Vite fingerprints everything under assets/ — cache forever. index.html and the
  // service worker must always be revalidated or a deploy never reaches the user.
  res.setHeader('Cache-Control', rel.startsWith('assets/')
    ? 'public, max-age=31536000, immutable'
    : 'public, max-age=0, must-revalidate');
  if (rel === 'firebase-messaging-sw.js') res.setHeader('Service-Worker-Allowed', '/');
  const stat = fs.statSync(file);
  res.setHeader('Content-Length', stat.size);
  if (req.method === 'HEAD') { res.end(); return; }
  fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
}

// ── api ──────────────────────────────────────────────────────────────────────

async function serveApi(
  req: http.IncomingMessage, res: http.ServerResponse, route: string, search: URLSearchParams,
  extraHeaders: [string, string][],
) {
  for (const [k, v] of extraHeaders) res.setHeader(k, v);
  const r = augmentResponse(res);
  let mod: HandlerModule;
  try {
    mod = await loadRoute(route);
  } catch (err) {
    console.error(`[server] failed to load ${route}`, err);
    r.status(500).json({ error: 'FUNCTION_LOAD_FAILED' });
    return;
  }

  const sreq = req as ShimRequest;
  sreq.query = parseQuery(search);
  // The handler sees the REWRITTEN url, as on Vercel (api/email.ts falls back to it).
  sreq.url = route + (search.toString() ? `?${search}` : '');
  if (wantsRawBody(mod)) {
    sreq.body = undefined; // the handler reads the stream itself (signature checks)
  } else if (req.method !== 'GET' && req.method !== 'HEAD') {
    try {
      sreq.body = parseBody(await readRawBody(req), req.headers['content-type']);
    } catch (err) {
      const status = err instanceof BodyError ? err.status : 400;
      r.status(status).json({ error: (err as Error).message });
      return;
    }
  } else {
    sreq.body = undefined;
  }

  const timer = setTimeout(() => {
    if (!res.headersSent) r.status(504).json({ error: 'FUNCTION_INVOCATION_TIMEOUT' });
    else res.end();
  }, API_TIMEOUT_MS);
  timer.unref();
  res.on('close', () => clearTimeout(timer));

  try {
    await mod.default(sreq, r);
  } catch (err) {
    console.error(`[server] ${req.method} ${route} threw`, err);
    if (!res.headersSent) r.status(500).json({ error: 'FUNCTION_INVOCATION_FAILED' });
    else if (!res.writableEnded) res.end();
  }
}

// ── router ───────────────────────────────────────────────────────────────────

async function handle(req: http.IncomingMessage, res: http.ServerResponse) {
  const url = new URL(req.url || '/', 'http://local');
  let pathname = url.pathname;
  if (pathname.length > 1 && pathname.endsWith('/')) pathname = pathname.slice(0, -1);

  if (pathname === '/healthz') {
    const ok = warmedUp && failedRoutes.size === 0;
    res.writeHead(ok ? 200 : 503, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(ok ? 'ok' : warmedUp ? `failed: ${[...failedRoutes].join(', ')}` : 'starting');
    return;
  }

  const extra = headersFor(headerRules, pathname);

  // Vercel order: the filesystem first, then rewrites. /api is never a file.
  if (!pathname.startsWith('/api/') && (req.method === 'GET' || req.method === 'HEAD')) {
    const file = staticFile(pathname);
    if (file) { serveStatic(req, res, file, extra); return; }
  }

  const rewritten = applyRewrites(rewrites, pathname, url.searchParams) ?? { pathname, search: url.searchParams };
  if (ROUTES[rewritten.pathname]) {
    await serveApi(req, res, rewritten.pathname, rewritten.search, extra);
    return;
  }
  if (!rewritten.pathname.startsWith('/api/')) {
    const file = staticFile(rewritten.pathname === '/' ? '/index.html' : rewritten.pathname);
    if (file && (req.method === 'GET' || req.method === 'HEAD')) { serveStatic(req, res, file, extra); return; }
  }
  for (const [k, v] of extra) res.setHeader(k, v);
  res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ error: 'NOT_FOUND' }));
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.error('[server] unhandled', err);
    if (!res.headersSent) { res.statusCode = 500; res.end(); } else res.destroy();
  });
});
// A cron job may legitimately run for minutes; the proxy in front decides the rest.
server.requestTimeout = API_TIMEOUT_MS + 30_000;
server.headersTimeout = 65_000;
server.keepAliveTimeout = 61_000;

// On Vercel a stray rejection dies with its invocation; here it must not kill the server.
process.on('unhandledRejection', (reason) => console.error('[server] unhandledRejection', reason));

let shuttingDown = false;
function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[server] ${signal} — draining`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 25_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

if (!process.env.VERCEL_ENV) {
  console.warn('[server] VERCEL_ENV is not set — localhost is trusted as a platform host. Set VERCEL_ENV=production in production.');
}
server.listen(PORT, () => {
  console.log(`[server] FivoCRM on :${PORT} (dist: ${DIST_DIR})`);
  void warmUp();
});
