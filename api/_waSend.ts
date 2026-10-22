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
 *   sendMetaTemplate — an approved template over the Meta Cloud API (cron
 *                      reminders/campaigns). Returns a structured result; the
 *                      caller writes the row with doc id == the returned wamid so
 *                      Meta's status callbacks land on it.
 *   isPermanentWaError — THE classifier: a permanent failure is never retried.
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

export interface MetaTemplateSendResult {
  ok: boolean;
  /** Meta's message id (wamid) — the `whatsappMessages` doc id for this send. */
  id: string | null;
  status: number;
  error?: string;
  /** Meta error code (e.g. 131026 undeliverable, 132000 param count). */
  code?: number | null;
}

/** POST one approved template. Never throws. Empty params are sent as '-' (Meta rejects ''). */
export async function sendMetaTemplate(
  channel: MetaChannelCreds,
  to: string,
  tpl: { metaTemplateName?: string; language?: string },
  params: string[],
): Promise<MetaTemplateSendResult> {
  if (!channel?.phoneNumberId || !channel?.accessToken) return { ok: false, id: null, status: 0, error: 'Kanali Meta mungon' };
  if (!tpl?.metaTemplateName) return { ok: false, id: null, status: 0, error: 'Template pa emër Meta', code: 132001 };
  const components = params.length
    ? [{ type: 'body', parameters: params.map((p) => ({ type: 'text', text: p && p.trim() ? p : '-' })) }]
    : [];
  try {
    const resp = await fetch(`${META_GRAPH}/${channel.phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${channel.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name: tpl.metaTemplateName,
          language: { code: tpl.language || 'sq' },
          ...(components.length ? { components } : {}),
        },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const data: any = await resp.json().catch(() => ({}));
    const id: string | null = data?.messages?.[0]?.id || null;
    if (!resp.ok || !id) {
      const code = typeof data?.error?.code === 'number' ? data.error.code : null;
      const sub = data?.error?.error_data?.details || data?.error?.error_user_msg || '';
      return { ok: false, id: null, status: resp.status, code, error: `${data?.error?.message || `Meta ${resp.status}`}${sub ? ` — ${sub}` : ''}`.slice(0, 300) };
    }
    return { ok: true, id, status: resp.status };
  } catch (err) {
    return { ok: false, id: null, status: 0, error: (err as Error)?.message || String(err) };
  }
}

/**
 * Is this send failure PERMANENT (retrying the same message to the same number can
 * never succeed)? One classifier for every WhatsApp job — a permanent failure is
 * recorded and never retried; anything else is transient and retried a bounded
 * number of times.
 *
 *   permanent: VPS 400 for an invalid number / 422 (`not-on-whatsapp`), opted-out,
 *              Meta 131026 (undeliverable / not on WhatsApp), 131047 (outside the
 *              24h window - the same free text will never be accepted), 131051
 *              (unsupported type), 131008/131009 (missing/invalid parameter),
 *              132xxx (template does not exist / param count / format), 100
 *              (invalid parameter), 470.
 *   transient: timeouts, 429, 5xx, 131049 (Meta chose not to deliver now),
 *              130429 (throughput), socket closed, "no agent connected".
 */
export function isPermanentWaError(err: unknown): boolean {
  if (!err) return false;
  const o = (typeof err === 'object' ? err : { error: String(err) }) as { status?: unknown; code?: unknown; error?: unknown; message?: unknown };
  const status = Number(o.status) || 0;
  const code = Number(o.code) || 0;
  const text = String(o.error ?? o.message ?? '').toLowerCase();
  // 400 is permanent only for a bad NUMBER (matched below): the VPS also answers
  // 400 for an agent/team mismatch, which is OUR config, not this recipient.
  if (status === 422) return true;
  if (code === 131026 || code === 131047 || code === 131051 || code === 131008 || code === 131009 || code === 100 || code === 470) return true;
  if (code >= 132000 && code < 133000) return true;
  return /not-on-whatsapp|not on whatsapp|opted[- ]?out|invalid (phone|number|parameter)|numri i telefonit është i pavlefshëm|template.*(does not exist|not found)/.test(text);
}

/**
 * Is this a CHANNEL failure (our side: VPS down/unreachable, agent not connected,
 * rate limit, Meta token/outage) rather than something about the recipient? A
 * channel failure must not count as an attempt against the recipient — when the
 * VPS was down for an hour, every target of a campaign used to burn its retries
 * and the campaign "completed" having sent nothing. Callers stop the batch,
 * release their claims and try again next run.
 */
export function isChannelWaError(err: unknown): boolean {
  if (!err || isPermanentWaError(err)) return false;
  const o = (typeof err === 'object' ? err : { error: String(err) }) as { status?: unknown; code?: unknown; error?: unknown; message?: unknown };
  const status = Number(o.status) || 0;
  const code = Number(o.code) || 0;
  const text = String(o.error ?? o.message ?? '').toLowerCase();
  // VPS contract: 400/404/429/503 = rejected BEFORE sending (our side, retryable);
  // 500/502 = the send was attempted and failed (counts as an attempt) unless the
  // text says the socket dropped. 0 = network/abort; 401/403 = auth.
  // A Meta 400 carries an error `code` and is about the recipient/message (e.g.
  // 131049) — only a code-less 400 is the VPS refusing before the send.
  if (status === 400 && !code) return true;
  if (status === 0 || status === 401 || status === 403 || status === 404 || status === 429 || status === 503 || status === 504) return true;
  if (status > 504) return true;
  if (code === 190 || code === 130429 || code === 131000 || code === 131016) return true;
  return /lidhja u ndërpre|jo i lidhur|nuk është i lidhur|nuk është konfiguruar|timeout|timed out|econn|fetch failed/.test(text);
}

/**
 * The narrower question: is the NUMBER undeliverable (not on WhatsApp, invalid,
 * opted out)? Only this may be recorded on the CONTACT (`waUndeliverablePhone`);
 * a template/parameter error is permanent for that MESSAGE but says nothing about
 * the person, and marking them would silence every future sender.
 */
export function isUndeliverableNumberError(err: unknown): boolean {
  if (!err) return false;
  const o = (typeof err === 'object' ? err : { error: String(err) }) as { status?: unknown; code?: unknown; error?: unknown; message?: unknown };
  const code = Number(o.code) || 0;
  const text = String(o.error ?? o.message ?? '').toLowerCase();
  if (code === 131026) return true;
  if (Number(o.status) === 422 && /not-on-whatsapp|not on whatsapp/.test(text)) return true;
  return /not-on-whatsapp|not on whatsapp|invalid (phone|number)|numri i telefonit është i pavlefshëm/.test(text);
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
  /** Automated outbound (cron / rules) - the row is labelled so nobody reads it as a staff message. */
  automated?: boolean;
  /** 'invoice-reminder' | 'campaign' | 'automation' | 'lead-reminder' | 'follow-up' | 'playbook' | 'auto-reply' ... */
  automationKind?: string | null;
  /** Who sent it ('cron', 'wa-inbound', ...). */
  source?: string | null;
  /** Deterministic key: the VPS never sends the same key twice within 24h. */
  idempotencyKey?: string | null;
  /** CRM links persisted on the outbound row. */
  customerId?: string | null;
  businessId?: string | null;
  invoiceId?: string | null;
  broadcastId?: string | null;
}

export interface BaileysSendResult {
  ok: boolean;
  /**
   * The `whatsappMessages` DOC id the VPS wrote — composite `${agentId}_${waMessageId}`
   * (not the bare WhatsApp message id; that is `waMessageId`).
   */
  id: string | null;
  /** The bare WhatsApp (Baileys) message id. */
  waMessageId?: string | null;
  teamId: string | null;
  status: number;
  error?: string;
  /** The VPS's verdict on a 200: 'sent' | 'pending' (no ack yet) | 'queued' — all ACCEPTED. */
  deliveryStatus?: string | null;
  /** Same idempotency key within 24h: the VPS returned the STORED outcome, nothing new went out. */
  duplicate?: boolean;
}

/**
 * POST `${vpsUrl}/send` with the VPS API key. Never throws. 10s abort (the VPS
 * waits ≤6s for the WhatsApp ack).
 *
 * VPS contract (final):
 *   200 {ok:true, id, waMessageId, status:'sent'|'pending'|'queued'}  accepted
 *   422 {ok:false, error:'not-on-whatsapp'}                           permanent
 *   500 / 502                                                         the send was attempted and failed
 *   400 / 404 / 429 / 503                                             rejected BEFORE sending (retryable, not remembered)
 *   a repeated idempotencyKey within 24h returns the stored outcome with `idempotent: true`.
 */
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
        ...(extra.automated ? { automated: true } : {}),
        ...(extra.automationKind ? { automationKind: extra.automationKind } : {}),
        ...(extra.source ? { source: extra.source } : {}),
        ...(extra.idempotencyKey ? { idempotencyKey: extra.idempotencyKey } : {}),
        ...(extra.customerId ? { customerId: extra.customerId } : {}),
        ...(extra.businessId ? { businessId: extra.businessId } : {}),
        ...(extra.invoiceId ? { invoiceId: extra.invoiceId } : {}),
        ...(extra.broadcastId ? { broadcastId: extra.broadcastId } : {}),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const raw = await resp.text();
    let data: any = {};
    try { data = JSON.parse(raw); } catch { /* non-JSON body */ }
    const duplicate = data?.idempotent === true;
    if (!resp.ok) {
      return {
        ok: false, id: data?.id || null, waMessageId: data?.waMessageId || null, teamId: null, status: resp.status,
        error: data?.error || raw.slice(0, 200) || `VPS ${resp.status}`, duplicate,
      };
    }
    // 200: 'sent' / 'pending' (no ack yet) / 'queued' are all ACCEPTED; only an
    // explicit failure in the body (e.g. a stored failed outcome) is not.
    const deliveryStatus: string | null = typeof data?.status === 'string' ? data.status : null;
    if (deliveryStatus === 'failed' || data?.ok === false || data?.success === false) {
      return {
        ok: false, id: data?.id || null, waMessageId: data?.waMessageId || null, teamId: data?.teamId || null,
        status: resp.status, error: data?.error || 'VPS: dërgimi dështoi', deliveryStatus, duplicate,
      };
    }
    return {
      ok: true, id: data?.id || null, waMessageId: data?.waMessageId || null, teamId: data?.teamId || null,
      status: resp.status, deliveryStatus, duplicate,
    };
  } catch (err) {
    const msg = (err as Error)?.message || String(err);
    console.error('[waSend] Baileys /send threw', msg);
    return { ok: false, id: null, teamId: null, status: 0, error: msg };
  }
}

// ── Agent ranking (used by api/_waAgent.ts; pure so it can be unit-tested) ────

export interface WaAgentRef {
  id: string;
  teamId: string;
  connected: boolean;
}

export function isConnectedWaStatus(s: unknown): boolean {
  return s === 'connected' || s === 'open';
}

/** Pure ranking — exported for tests / reuse. */
export function pickWaAgent(list: WaAgentRef[], teamId: string | null | undefined, preferredId?: string | null): WaAgentRef | null {
  if (!list.length) return null;
  const preferred = preferredId ? list.find((a) => a.id === preferredId) : undefined;
  if (preferred?.connected) return preferred;
  const rank = (a: WaAgentRef) => (a.connected ? 0 : 2) + (teamId && a.teamId === teamId ? 0 : 1);
  return [...list].sort((a, b) =>
    rank(a) - rank(b)
    || (a.id === preferredId ? -1 : b.id === preferredId ? 1 : 0)
    || a.id.localeCompare(b.id))[0] || null;
}
