/**
 * In-app redirect targets taken from the URL (`/login?redirect=…`).
 *
 * A `redirect` parameter is attacker-controlled: `?redirect=https://evil.com` or the
 * scheme-relative `//evil.com` / `/\evil.com` (browsers treat `\` as `/` in http URLs)
 * would send a freshly signed-in user, with a trusted-looking origin in the address
 * bar, straight to a phishing page. Only a same-origin, single-slash path survives.
 */

const DEFAULT_ORIGIN = 'http://localhost';

function hasControlCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

function currentOrigin(): string {
  if (typeof window !== 'undefined' && window.location?.origin) return window.location.origin;
  return DEFAULT_ORIGIN;
}

/**
 * Returns `raw` when it is a safe in-app path, otherwise `fallback` (default `/`).
 * Safe means: starts with exactly one `/` (not `//` or `/\`), and resolving it
 * against the current origin stays on the current origin.
 */
export function safeRedirectPath(raw: string | null | undefined, fallback = '/'): string {
  if (typeof raw !== 'string') return fallback;
  const value = raw.trim();
  if (!value) return fallback;
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return fallback;
  // Control characters (tab/newline) are stripped by the URL parser and could turn
  // an innocent-looking path into something else — refuse them outright.
  if (hasControlCharacter(value)) return fallback;
  const origin = currentOrigin();
  try {
    const parsed = new URL(value, origin);
    if (parsed.origin !== origin) return fallback;
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return fallback;
  } catch {
    return fallback;
  }
  return value;
}
