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

  window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    // String URL — the common case for the app's `fetch('/api/...')` calls.
    if (typeof input === 'string' && input.startsWith('/api/')) {
      return originalFetch(API_BASE + input, init);
    }
    // Request object with a same-origin /api path.
    if (input instanceof Request && input.url.startsWith(`${window.location.origin}/api/`)) {
      const rewritten = input.url.replace(window.location.origin, API_BASE);
      return originalFetch(new Request(rewritten, input), init);
    }
    return originalFetch(input as any, init);
  };
}
