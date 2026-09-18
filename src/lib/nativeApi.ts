import { Capacitor } from '@capacitor/core';

/**
 * On native platforms (Android/iOS via Capacitor) the WebView origin is
 * `https://localhost`, so relative `/api/...` requests resolve to a host that
 * does not exist. The serverless functions live on the deployed web origin.
 *
 * This patches the global `fetch` once at startup so any request to a path that
 * starts with `/api/` is rewritten to the absolute API base. It is a no-op on
 * web, where relative paths already resolve correctly.
 *
 * Override the base with `VITE_API_BASE_URL` (e.g. a preview deployment).
 */
const API_BASE = (
  (import.meta.env.VITE_API_BASE_URL as string | undefined) || 'https://fivocrm.vercel.app'
).replace(/\/$/, '');

export function getApiBase(): string {
  return Capacitor.isNativePlatform() ? API_BASE : '';
}

/** Resolve an `/api/...` path to an absolute URL on native, relative on web. */
export function apiUrl(path: string): string {
  if (Capacitor.isNativePlatform() && path.startsWith('/api/')) {
    return API_BASE + path;
  }
  return path;
}

let installed = false;

export function installNativeApiBase(): void {
  if (installed || !Capacitor.isNativePlatform()) return;
  installed = true;

  const originalFetch = window.fetch.bind(window);
  const SAME_ORIGIN_API = `${window.location.origin}/api/`;

  window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    // String URL — the common case for the app's `fetch('/api/...')` calls.
    if (typeof input === 'string') {
      if (input.startsWith('/api/')) return originalFetch(API_BASE + input, init);
      if (input.startsWith(SAME_ORIGIN_API)) {
        return originalFetch(API_BASE + input.slice(window.location.origin.length), init);
      }
      return originalFetch(input, init);
    }
    // A URL object was not handled at all before, so `fetch(new URL('/api/x',
    // location.origin))` went straight to https://localhost/api/x and failed.
    if (input instanceof URL) {
      return originalFetch(
        input.href.startsWith(SAME_ORIGIN_API)
          ? API_BASE + input.href.slice(window.location.origin.length)
          : input,
        init
      );
    }
    // Request object with a same-origin /api path. Rebuilding it field by field:
    // `new Request(url, oldRequest)` reads `body` off the old request as a
    // ReadableStream, which Chrome rejects without `duplex: 'half'` — so every
    // POST made through a Request object threw instead of being rewritten.
    if (input instanceof Request && input.url.startsWith(SAME_ORIGIN_API)) {
      const rewritten = API_BASE + input.url.slice(window.location.origin.length);
      const hasBody = input.method !== 'GET' && input.method !== 'HEAD';
      return (hasBody ? input.clone().arrayBuffer() : Promise.resolve(undefined)).then((body) =>
        originalFetch(rewritten, {
          method: input.method,
          headers: input.headers,
          body: body ?? null,
          mode: input.mode === 'navigate' ? undefined : input.mode,
          credentials: input.credentials,
          cache: input.cache,
          redirect: input.redirect,
          referrer: input.referrer,
          integrity: input.integrity,
          signal: input.signal,
          ...init,
        })
      );
    }
    return originalFetch(input as any, init);
  };
}
