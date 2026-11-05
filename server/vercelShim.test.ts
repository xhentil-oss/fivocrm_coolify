// @vitest-environment node
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  applyRewrites, augmentResponse, compileHeaders, compileRewrites, headersFor, parseBody,
  parseQuery, wantsRawBody,
} from './vercelShim';

const ROOT = path.resolve(__dirname, '..');
const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
const rewrites = compileRewrites(vercel.rewrites);

function rewrite(pathname: string, search = '') {
  return applyRewrites(rewrites, pathname, new URLSearchParams(search));
}

describe('vercel.json rewrites, applied by the self-hosted server', () => {
  it('routes an action alias to the email dispatcher and keeps the caller query', () => {
    const r = rewrite('/api/hosting', 'action=order.quote&x=1')!;
    expect(r.pathname).toBe('/api/email');
    expect(r.search.get('type')).toBe('hosting');
    expect(r.search.get('action')).toBe('order.quote');
    expect(r.search.get('x')).toBe('1');
  });

  it('the destination type wins over a caller-supplied one (same as Vercel)', () => {
    expect(rewrite('/api/send-invite', 'type=billing')!.search.get('type')).toBe('invite');
  });

  it('a real function path maps to itself, nested paths included', () => {
    expect(rewrite('/api/stripe-webhook')!.pathname).toBe('/api/stripe-webhook');
    expect(rewrite('/api/cron/run', 'job=run-all')!.pathname).toBe('/api/cron/run');
  });

  it('every non-api path falls back to the SPA', () => {
    expect(rewrite('/app/finances')!.pathname).toBe('/');
    expect(rewrite('/portal/invoices')!.pathname).toBe('/');
  });

  it('every rewrite destination is a function the server knows (or the SPA)', () => {
    const index = fs.readFileSync(path.join(ROOT, 'server/index.ts'), 'utf8');
    const routes = new Set([...index.matchAll(/'(\/api\/[a-z0-9/-]+)': \(\) => import/g)].map((m) => m[1]));
    for (const r of vercel.rewrites as { destination: string }[]) {
      const dest = new URL(r.destination.replace(/\$\d+/g, 'x'), 'http://l').pathname;
      if (dest === '/' || dest === '/api/x') continue;
      expect(routes, `rewrite → ${dest}`).toContain(dest);
    }
  });

  it('every deployable api/*.ts file is routed by server/index.ts', () => {
    const index = fs.readFileSync(path.join(ROOT, 'server/index.ts'), 'utf8');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name.startsWith('_') || e.name.startsWith('.')) continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith('.ts') && !e.name.endsWith('.test.ts') && !e.name.endsWith('.d.ts')) files.push(p);
      }
    };
    walk(path.join(ROOT, 'api'));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const route = '/' + path.relative(ROOT, f).split(path.sep).join('/').replace(/\.ts$/, '');
      expect(index, `api file ${route} has no route in server/index.ts`).toContain(`'${route}': () => import('..${route}')`);
    }
  });

  it('refuses a :param source it cannot honour instead of never matching', () => {
    expect(() => compileRewrites([{ source: '/api/:id', destination: '/api/x' }])).toThrow();
  });
});

describe('vercel.json headers', () => {
  it('every response gets the security headers (CSP, HSTS, frame deny)', () => {
    const keys = headersFor(compileHeaders(vercel.headers), '/app/x').map(([k]) => k);
    expect(keys).toEqual(expect.arrayContaining(['Content-Security-Policy', 'Strict-Transport-Security', 'X-Frame-Options']));
    expect(headersFor(compileHeaders(vercel.headers), '/api/email').length).toBe(keys.length);
  });
});

describe('request shim', () => {
  it('parses repeated query keys into arrays, like req.query on Vercel', () => {
    expect(parseQuery('a=1&a=2&b=x')).toEqual({ a: ['1', '2'], b: 'x' });
  });

  it('parses bodies by content type', () => {
    expect(parseBody(Buffer.from('{"a":1}'), 'application/json; charset=utf-8')).toEqual({ a: 1 });
    expect(parseBody(Buffer.from('a=1&b=2'), 'application/x-www-form-urlencoded')).toEqual({ a: '1', b: '2' });
    expect(parseBody(Buffer.from('hi'), 'text/plain')).toBe('hi');
    expect(Buffer.isBuffer(parseBody(Buffer.from([1, 2]), 'application/octet-stream'))).toBe(true);
    expect(parseBody(Buffer.alloc(0), 'application/json')).toBeUndefined();
    expect(() => parseBody(Buffer.from('{bad'), 'application/json')).toThrow(/Invalid JSON/);
  });

  it('honours bodyParser:false (webhooks verify the raw bytes)', () => {
    expect(wantsRawBody({ config: { api: { bodyParser: false } } })).toBe(true);
    expect(wantsRawBody({})).toBe(false);
  });

  it('the three signature-checked webhooks still opt out of body parsing', () => {
    for (const f of ['stripe-webhook', 'meta-webhook', 'whmcs-webhook']) {
      const src = fs.readFileSync(path.join(ROOT, 'api', `${f}.ts`), 'utf8');
      expect(src, f).toMatch(/bodyParser:\s*false/);
    }
  });
});

describe('response shim', () => {
  function fakeRes() {
    const headers: Record<string, unknown> = {};
    const res: any = {
      statusCode: 200, body: undefined as unknown,
      setHeader: (k: string, v: unknown) => { headers[k.toLowerCase()] = v; },
      getHeader: (k: string) => headers[k.toLowerCase()],
      end: (b?: unknown) => { res.body = b; },
    };
    return { res: augmentResponse(res) as any, headers };
  }

  it('status().json() sets code, type and body', () => {
    const { res, headers } = fakeRes();
    res.status(201).json({ ok: true });
    expect(res.statusCode).toBe(201);
    expect(headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toBe('{"ok":true}');
  });

  it('redirect(status, url) and redirect(url)', () => {
    const a = fakeRes(); a.res.redirect(302, '/app/gmb?x=1');
    expect(a.res.statusCode).toBe(302); expect(a.headers.location).toBe('/app/gmb?x=1');
    const b = fakeRes(); b.res.redirect('/y');
    expect(b.res.statusCode).toBe(307); expect(b.headers.location).toBe('/y');
  });

  it('send() handles strings, objects and buffers', () => {
    const a = fakeRes(); a.res.send('<b>hi</b>'); expect(a.headers['content-type']).toMatch(/text\/html/);
    const b = fakeRes(); b.res.send({ a: 1 }); expect(b.res.body).toBe('{"a":1}');
    const c = fakeRes(); c.res.send(Buffer.from('x')); expect(c.headers['content-type']).toBe('application/octet-stream');
  });
});
