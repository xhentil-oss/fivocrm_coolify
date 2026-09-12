/**
 * Outbound WhatsApp primitives shared by the inbound handler (auto-reply), the
 * cron (broadcasts) and the send endpoints.
 *
 *   sendMetaText     — free text over the Meta Cloud API. Valid only inside the
 *                      24h customer-service window, which a fresh inbound message
 *                      guarantees; the caller persists the echo row.
 *   sendBaileysText  — free text through the team's VPS `/send`. The VPS writes
 *                      its own `whatsappMessages` row (channel 'baileys'), so the
 *                      caller must NOT write a second one.
 *
 * Both were private copies before (meta-webhook.ts / cron/run.ts); this is the
 * one place they live now.
 */

export interface MetaChannelCreds {
  phoneNumberId: string;
  accessToken: string;
}

const META_GRAPH = 'https://graph.facebook.com/v21.0';

/** Returns Meta's message id on success, null on any failure (never throws). */
export async function sendMetaText(channel: MetaChannelCreds, to: string, bodyText: string): Promise<string | null> {
  if (!channel?.phoneNumberId || !channel?.accessToken) return null;
  try {
    const resp = await fetch(`${META_GRAPH}/${channel.phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${channel.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: bodyText } }),
      signal: AbortSignal.timeout(15_000),
    });
    const data: any = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      console.error('[waSend] Meta text failed', resp.status, data?.error?.message || '');
      return null;
    }
    return data?.messages?.[0]?.id || null;
  } catch (err) {
    console.error('[waSend] Meta text threw', (err as Error)?.message || err);
    return null;
  }
}

export interface BaileysSendExtra {
  teamId?: string | null;
  leadId?: string | null;
  leadName?: string | null;
  /** Baileys JID when known (`…@s.whatsapp.net` or `…@lid`). */
  jid?: string | null;
  /** Persisted on the outbound row; an auto-reply echo must never count as a staff answer. */
  isAutoReply?: boolean;
  /** The staff member who pressed send (null for automation). */
  sentByUid?: string | null;
}

export interface BaileysSendResult {
  ok: boolean;
  /** The `whatsappMessages` doc id the VPS wrote (== Baileys message id when available). */
  id: string | null;
  teamId: string | null;
  status: number;
  error?: string;
}

/** POST `${vpsUrl}/send` with the VPS API key. Never throws. */
export async function sendBaileysText(
  vpsUrl: string,
  vpsSecret: string,
  agentId: string | null | undefined,
  phone: string,
  text: string,
  extra: BaileysSendExtra = {},
): Promise<BaileysSendResult> {
  if (!vpsUrl || !vpsSecret) return { ok: false, id: null, teamId: null, status: 0, error: 'VPS nuk është konfiguruar' };
  try {
    const resp = await fetch(`${vpsUrl.replace(/\/$/, '')}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': vpsSecret },
      body: JSON.stringify({
        to: phone,
        message: text,
        teamId: extra.teamId ?? null,
        agentId: agentId || undefined,
        leadId: extra.leadId ?? null,
        leadName: extra.leadName ?? null,
        jid: extra.jid || undefined,
        ...(extra.isAutoReply ? { isAutoReply: true } : {}),
        ...(extra.sentByUid ? { sentByUid: extra.sentByUid } : {}),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const raw = await resp.text();
    let data: any = {};
    try { data = JSON.parse(raw); } catch { /* non-JSON body */ }
    if (!resp.ok) {
      return { ok: false, id: null, teamId: null, status: resp.status, error: data?.error || raw.slice(0, 200) || `VPS ${resp.status}` };
    }
    return { ok: true, id: data?.id || null, teamId: data?.teamId || null, status: resp.status };
  } catch (err) {
    const msg = (err as Error)?.message || String(err);
    console.error('[waSend] Baileys /send threw', msg);
    return { ok: false, id: null, teamId: null, status: 0, error: msg };
  }
}
