/**
 * URL scheme filters for values that end up in `href` / `src`.
 *
 * Every attachment, media or link URL that comes out of Firestore (or a third-party
 * API) is untrusted: a row written straight to the database can carry a
 * `javascript:`, `data:` or `vbscript:` URI that executes on click / load. A regex on
 * the raw string is not enough — the URL parser strips tabs and newlines
 * (`java\tscript:` IS `javascript:`), so the only honest check is to PARSE the value
 * and look at the resulting protocol.
 */

export interface SafeExternalUrlOptions {
  /** Also accept `blob:` URLs (local object URLs created by THIS page). */
  allowBlob?: boolean;
}

const WEB_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * Returns the URL unchanged when it parses to an `http:` / `https:` URL (or `blob:`
 * when allowed), `null` for everything else — including relative paths, empty
 * strings and non-string values. Callers render nothing (or a disabled label) on
 * `null`; never fall back to the raw value.
 */
export function safeExternalUrl(u: unknown, opts: SafeExternalUrlOptions = {}): string | null {
  if (typeof u !== 'string') return null;
  const trimmed = u.trim();
  if (!trimmed) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (WEB_PROTOCOLS.has(parsed.protocol)) return trimmed;
  if (opts.allowBlob && parsed.protocol === 'blob:') return trimmed;
  return null;
}

/** Hosts that may receive a Firebase ID token with a file upload. */
export const TRUSTED_FILE_HOSTS = new Set(['vps.fivocrm.com', 'wa.fivocrm.com']);
const TRUSTED_FILE_HOST_SUFFIX = '.fivocrm.com';

/**
 * A tenant-editable upload host (`teamSettings.whatsappVpsUrl`) is honoured ONLY
 * when it is one of ours: an https origin on `vps.fivocrm.com`, `wa.fivocrm.com` or
 * any `*.fivocrm.com`. Anything else (another domain, http, a path-only value)
 * returns `null` so the caller falls through to the deployment default — the
 * upload request carries the user's Firebase ID token, and a team admin must not be
 * able to point that token at a server they control.
 */
export function trustedFileHost(u: unknown): string | null {
  if (typeof u !== 'string') return null;
  const trimmed = u.trim();
  if (!trimmed) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  const host = parsed.hostname.toLowerCase();
  if (!TRUSTED_FILE_HOSTS.has(host) && !host.endsWith(TRUSTED_FILE_HOST_SUFFIX)) return null;
  return parsed.origin;
}
