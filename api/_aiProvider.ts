/**
 * ONE AI provider resolution for the whole server.
 *
 * Before this file there were two private copies of "which key, which model,
 * Gemini or OpenAI": `api/ai-chat.ts` (chat, with fallback between providers)
 * and `api/_gmb.ts` (single-prompt text for review replies). The WhatsApp
 * "Sugjerim AI" draft needed a third, so the two were moved here instead.
 *
 * Resolution (same as before, now in one place):
 *   tenant `aiProvider` + `aiApiKey` (+ optional `aiModel`) from
 *   `getTeamConfig(teamId)` — the key lives in teamSecrets, never on the client —
 *   then the platform env keys (`GEMINI_API_KEY`, `OPENAI_API_KEY`) as fallback.
 *   The tenant's explicit provider goes first; if it throws and the other key
 *   exists, the call falls back once.
 *
 * `api/` never imports from `src/`; nothing here touches the request/response.
 */
import { getTeamConfig } from './_tenantConfig.js';

export type AiProviderName = 'gemini' | 'openai';
export type ChatMsg = { role: 'user' | 'assistant'; content: string };

export interface AiGenOptions {
  /** Hard cap on the answer length in tokens (default 400 for text, 1500 for chat). */
  maxTokens?: number;
  temperature?: number;
  /** Overrides the tenant/default model for this call. */
  model?: string;
  /** Request timeout (default 25s — Vercel functions are capped at 60s). */
  timeoutMs?: number;
}

export interface AiChatResult {
  reply: string;
  tokensUsed: number;
  model: string;
  provider: AiProviderName;
}

export interface ResolvedAiConfig {
  /** The tenant's explicit choice, when it has one. */
  preferred: AiProviderName | null;
  geminiKey: string;
  openaiKey: string;
  /** The tenant's model override (applies to its preferred provider). */
  model: string;
  hasKey: boolean;
}

const DEFAULT_GEMINI_MODEL = () => process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const DEFAULT_OPENAI_MODEL = () => process.env.OPENAI_MODEL || 'gpt-4o-mini';
const DEFAULT_TIMEOUT_MS = 25_000;

/**
 * Tenant keys merged over the platform env. Pass `null` to resolve the platform
 * keys only (e.g. a caller that has NOT proven membership of the team — the key
 * is server-side either way, this only prevents cross-tenant quota use).
 */
export async function resolveAiConfig(teamId: string | null | undefined): Promise<ResolvedAiConfig> {
  const cfg: Record<string, any> = teamId ? await getTeamConfig(teamId).catch(() => ({})) : {};
  const teamKey = typeof cfg.aiApiKey === 'string' ? cfg.aiApiKey.trim() : '';
  const preferred: AiProviderName | null = teamKey ? (cfg.aiProvider === 'openai' ? 'openai' : 'gemini') : null;
  const geminiKey = preferred === 'gemini' ? teamKey : (process.env.GEMINI_API_KEY || '');
  const openaiKey = preferred === 'openai' ? teamKey : (process.env.OPENAI_API_KEY || '');
  const model = typeof cfg.aiModel === 'string' ? cfg.aiModel.trim() : '';
  return { preferred, geminiKey, openaiKey, model, hasKey: !!(geminiKey || openaiKey) };
}

/** Does this tenant (or the platform) have any AI key at all? */
export async function hasAiKey(teamId: string | null | undefined): Promise<boolean> {
  return (await resolveAiConfig(teamId)).hasKey;
}

// ── Raw provider calls ────────────────────────────────────────────────────────

function httpError(provider: string, status: number, body: any): Error {
  const msg = typeof body === 'string' ? body.slice(0, 300) : (body?.error?.message || JSON.stringify(body || {}).slice(0, 300));
  const err: any = new Error(`${provider} ${status}: ${msg}`);
  err.status = status;
  err.statusCode = status;
  return err;
}

async function callGeminiChat(
  apiKey: string,
  system: string,
  msgs: ChatMsg[],
  model: string,
  opts: AiGenOptions = {},
): Promise<AiChatResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  // Gemini uses 'user' / 'model' roles instead of 'user' / 'assistant'.
  const contents = msgs.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...(system ? { system_instruction: { parts: [{ text: system }] } } : {}),
      contents,
      generationConfig: { temperature: opts.temperature ?? 0.7, maxOutputTokens: opts.maxTokens ?? 1500 },
    }),
    signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  });
  const json: any = await resp.json().catch(() => ({}));
  if (!resp.ok) throw httpError('Gemini', resp.status, json);
  const reply = json?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') || '';
  return { reply, tokensUsed: Number(json?.usageMetadata?.totalTokenCount) || 0, model, provider: 'gemini' };
}

async function callOpenAiChat(
  apiKey: string,
  system: string,
  msgs: ChatMsg[],
  model: string,
  opts: AiGenOptions = {},
): Promise<AiChatResult> {
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [
        ...(system ? [{ role: 'system', content: system }] : []),
        ...msgs.map((m) => ({ role: m.role, content: m.content })),
      ],
      max_tokens: opts.maxTokens ?? 1500,
      temperature: opts.temperature ?? 0.7,
    }),
    signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  });
  const json: any = await resp.json().catch(() => ({}));
  if (!resp.ok) throw httpError('OpenAI', resp.status, json);
  const reply = json?.choices?.[0]?.message?.content || '';
  return { reply, tokensUsed: Number(json?.usage?.total_tokens) || 0, model, provider: 'openai' };
}

/** Single-prompt Gemini text (kept for `_gmb.ts` callers). */
export async function callGeminiText(apiKey: string, model: string, prompt: string): Promise<string> {
  return (await callGeminiChat(apiKey, '', [{ role: 'user', content: prompt }], model, { maxTokens: 400 })).reply;
}

/** Single-prompt OpenAI text (kept for `_gmb.ts` callers). */
export async function callOpenAiText(apiKey: string, model: string, prompt: string): Promise<string> {
  return (await callOpenAiChat(apiKey, '', [{ role: 'user', content: prompt }], model, { maxTokens: 400 })).reply;
}

// ── The two public entry points ───────────────────────────────────────────────

export const AI_NOT_CONFIGURED_MESSAGE =
  'AI nuk është konfiguruar (vendos çelësin te Cilësimet → Integrime, ose GEMINI/OPENAI_API_KEY)';

/**
 * Chat completion with an already-resolved config. The preferred provider goes
 * first; on failure the other one is tried once when its key exists.
 */
export async function generateChatWith(
  cfg: ResolvedAiConfig,
  system: string,
  messages: ChatMsg[],
  opts: AiGenOptions = {},
): Promise<AiChatResult> {
  const { geminiKey, openaiKey } = cfg;
  if (!geminiKey && !openaiKey) throw new Error(AI_NOT_CONFIGURED_MESSAGE);
  const preferGemini = cfg.preferred ? cfg.preferred === 'gemini' : !!geminiKey;
  // The tenant's model override belongs to its preferred provider only — a Gemini
  // model name sent to OpenAI (or vice-versa) on the fallback leg would just 404.
  const modelFor = (p: AiProviderName) =>
    opts.model || (cfg.preferred === p && cfg.model ? cfg.model : (p === 'gemini' ? DEFAULT_GEMINI_MODEL() : DEFAULT_OPENAI_MODEL()));

  const gemini = () => callGeminiChat(geminiKey, system, messages, modelFor('gemini'), opts);
  const openai = () => callOpenAiChat(openaiKey, system, messages, modelFor('openai'), opts);

  if (preferGemini && geminiKey) {
    try { return await gemini(); } catch (err: any) {
      if (!openaiKey) throw err;
      console.error('[aiProvider] Gemini failed, falling back to OpenAI:', err?.message || err);
      return openai();
    }
  }
  if (openaiKey) {
    try { return await openai(); } catch (err: any) {
      if (!geminiKey) throw err;
      console.error('[aiProvider] OpenAI failed, falling back to Gemini:', err?.message || err);
      return gemini();
    }
  }
  return gemini();
}

/** Chat completion using the tenant's configured provider (env fallback). */
export async function generateChat(
  teamId: string | null | undefined,
  system: string,
  messages: ChatMsg[],
  opts: AiGenOptions = {},
): Promise<AiChatResult> {
  return generateChatWith(await resolveAiConfig(teamId), system, messages, opts);
}

/**
 * One AI text call using the tenant's configured provider (Settings → FivoAI).
 * Same contract as the old `_gmb.ts` function: trimmed text, throws when no key.
 */
export async function generateAiText(teamId: string | null | undefined, prompt: string): Promise<string> {
  const cfg = await resolveAiConfig(teamId);
  if (!cfg.hasKey) throw new Error(AI_NOT_CONFIGURED_MESSAGE);
  return (await generateChatWith(cfg, '', [{ role: 'user', content: prompt }], { maxTokens: 400 })).reply.trim();
}
