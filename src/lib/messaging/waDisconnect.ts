/**
 * `whatsappAccounts.lastDisconnectReason` — ONE reader for both shapes.
 *
 * The VPS used to stamp a bare string ('logged_out', '401', …); since the
 * Baileys 7 migration it writes `{ code, name }` (the Boom status code + the
 * DisconnectReason name). Rendering that object as a React child crashed
 * Cilësimet (minified error #31), so every consumer goes through here and
 * never touches the raw field.
 */
export interface WaDisconnectReasonInfo {
  code: number | null;
  name: string;
}

export type WaDisconnectReasonField = string | WaDisconnectReasonInfo | null | undefined;

/** Plain text for a tooltip / notification: `loggedOut (401)` or the legacy string. Never an object. */
export function waDisconnectReasonText(reason: WaDisconnectReasonField): string | null {
  if (reason == null) return null;
  if (typeof reason === 'string') return reason.trim() || null;
  if (typeof reason === 'object') {
    const name = typeof reason.name === 'string' ? reason.name.trim() : '';
    const code = typeof reason.code === 'number' && Number.isFinite(reason.code) ? reason.code : null;
    if (name && code != null) return `${name} (${code})`;
    return name || (code != null ? String(code) : null);
  }
  return String(reason);
}

/** Albanian label for the staff UI; falls back to the raw text, never to the object. */
export function waDisconnectLabel(reason: WaDisconnectReasonField): string | null {
  const text = waDisconnectReasonText(reason);
  if (!text) return null;
  const code = typeof reason === 'object' && reason ? reason.code : null;
  const r = text.toLowerCase();
  const has = (...keys: string[]) => keys.some((k) => r === k || r.startsWith(`${k} `) || r.startsWith(`${k}(`));
  if (code === 401 || has('logged_out', 'loggedout', '401')) return 'U shkëput nga telefoni — skano QR';
  if (code === 440 || has('replaced', 'connectionreplaced', '440')) return 'U hap në një pajisje tjetër';
  if (code === 403 || has('banned', 'forbidden', '403')) return 'Numri u bllokua nga WhatsApp';
  if (code === 515 || has('restart_required', 'restartrequired', '515')) return 'Po rinis lidhjen';
  if (code === 408 || code === 428 || has('timed_out', 'timedout', 'connectionlost', 'connectionclosed', '408', '428')) return 'Lidhja ra — po rilidhet';
  if (code === 500 || has('badsession', 'bad_session')) return 'Sesioni u prish — skano QR';
  return text;
}
