/**
 * Server mirror of `src/lib/messaging/waDisconnect.ts` (`waDisconnectReasonText`).
 * `whatsappAccounts.lastDisconnectReason` is a legacy string OR, since Baileys 7,
 * `{ code, name }` — `String(obj)` in a notification printed "[object Object]".
 */
export interface WaDisconnectReasonInfo {
  code: number | null;
  name: string;
}

export type WaDisconnectReasonField = string | WaDisconnectReasonInfo | null | undefined;

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
