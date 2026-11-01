/**
 * ONE AI provider resolution for the whole server.
 *
 * Before this file there were two private copies of "which key, which model,
 * Gemini or OpenAI": `api/ai-chat.ts` (chat, with fallback between providers)
 * and `api/_gmb.ts` (single-prompt text for review replies). The WhatsApp
 * "Sugjerim AI" draft needed a third, so the two were moved here instead.
 * Anthropic (Claude) joined as the third provider in Oct 2026.
 *
 * Resolution (same as before, now in one place):
 *   tenant `aiProvider` + `aiApiKey` (+ optional `aiModel`) from
 *   `getTeamConfig(teamId)` — the key lives in teamSecrets, never on the client —
 *   then the platform env keys (`GEMINI_API_KEY`, `OPENAI_API_KEY`,
 *   `ANTHROPIC_API_KEY`) as fallback. The tenant's explicit provider goes first;
 *   if it throws, every other provider with a key is tried once, in order.
 *
 * Gemini and OpenAI are called with `fetch`; Anthropic through the official
 * `@anthropic-ai/sdk` (typed errors carry `status`, so `classifyAiError` reads them
 * exactly like the hand-built `httpError`). `api/` never imports from `src/`;
 * nothing here touches the request/response.
 */
import Anthropic from '@anthropic-ai/sdk';
import { getTeamConfig } from './_tenantConfig.js';
import { AI_PROVIDERS, classifyAiError, resolveProviderChoice, type AiProviderName } from './_aiErrors.js';

export type { AiProviderName } from './_aiErrors.js';
export type ChatMsg = { role: 'user' | 'assistant'; content: string };

/**
 * A system prompt, optionally split for prompt caching. `stable` must be
 * byte-identical between calls (persona, rules, facts) and is cached on Anthropic
 * (`cache_control` on that block, re-read at ~10 % of the input price within the
 * 5-min TTL); `dynamic` (clock, contact, state) follows the breakpoint. Gemini and
 * OpenAI receive the two joined; their own caching is automatic and prefix-based,
 * so the stable-first order helps there too.
 */
export type SystemPrompt = string | { stable: string; dynamic?: string };

export function systemPromptText(s: SystemPrompt): string {
  return typeof s === 'string' ? s : [s.stable, s.dynamic].filter(Boolean).join('\n\n');
}

export interface AiGenOptions {
  /** Hard cap on the answer length in tokens (default 400 for text, 1500 for chat). */
  maxTokens?: number;
  temperature?: number;
  /** Overrides the tenant/default model for this call. */
  model?: string;
  /** Request timeout per provider call (default 25s — Vercel functions are capped at 60s). */
  timeoutMs?: number;
  /**
   * Wall-clock budget for the WHOLE call including fallback legs (default 55s,
   * under `ai-chat`'s `maxDuration: 60`). With three providers, three full
   * timeouts in a row would outlive the function; a leg that cannot get at
   * least a few seconds is skipped and the primary error reported.
   */
  totalBudgetMs?: number;
}

export interface AiChatResult {
  reply: string;
  tokensUsed: number;
  /** Anthropic prompt caching: input tokens served from / written to the cache. */
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  model: string;
  provider: AiProviderName;
}

export interface ResolvedAiConfig {
  /** The tenant's explicit choice, when it has one. */
  preferred: AiProviderName | null;
  geminiKey: string;
  openaiKey: string;
  anthropicKey: string;
  /** The tenant's model override (applies to its preferred provider). */
  model: string;
  hasKey: boolean;
  /**
   * The stored `aiProvider` when the tenant key's SHAPE contradicted it (an OpenAI
   * `sk-…` key saved under "Gemini", or the reverse) — the key was routed by its
   * shape and the stored model override ignored, since it was typed for the other
   * provider. Null when everything agrees.
   */
  providerMismatch: AiProviderName | null;
}

const DEFAULT_GEMINI_MODEL = () => process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const DEFAULT_OPENAI_MODEL = () => process.env.OPENAI_MODEL || 'gpt-4o-mini';
const DEFAULT_ANTHROPIC_MODEL = () => process.env.ANTHROPIC_MODEL || 'claude-opus-5-5';
const DEFAULT_TIMEOUT_MS = 25_000;
const DEFAULT_TOTAL_BUDGET_MS = 55_000;
const MIN_LEG_MS = 4_000;

function defaultModelFor(p: AiProviderName): string {
  if (p === 'gemini') return DEFAULT_GEMINI_MODEL();
  if (p === 'openai') return DEFAULT_OPENAI_MODEL();
  return DEFAULT_ANTHROPIC_MODEL();
}

function keyFor(cfg: ResolvedAiConfig, p: AiProviderName): string {
  if (p === 'gemini') return cfg.geminiKey;
  if (p === 'openai') return cfg.openaiKey;
  return cfg.anthropicKey;
}

/**
 * Tenant keys merged over the platform env. Pass `null` to resolve the platform
 * keys only (e.g. a caller that has NOT proven membership of the team — the key
 * is server-side either way, this only prevents cross-tenant quota use).
 */
export async function resolveAiConfig(teamId: string | null | undefined): Promise<ResolvedAiConfig> {
  // A vault read that fails (e.g. a secret encrypted under a SECRETS_ENC_KEY this
  // process does not have) must be visible in the logs — silently falling back to
  // the platform key made it look like the tenant had never saved one.
  const cfg: Record<string, any> = teamId
    ? await getTeamConfig(teamId).catch((e: any) => {
        console.error(`[aiProvider] team ${teamId}: could not read team config/secrets:`, e?.message || e);
        return {};
      })
    : {};
  const teamKey = typeof cfg.aiApiKey === 'string' ? cfg.aiApiKey.trim() : '';
  // The key's shape wins over the stored `aiProvider`: a key sent to the wrong
  // provider is just "invalid" there, and the UI then showed an opaque 500.
  const choice = teamKey ? resolveProviderChoice(cfg.aiProvider, teamKey) : null;
  const preferred: AiProviderName | null = choice?.provider ?? null;
  const providerMismatch = choice?.mismatch ?? null;
  if (providerMismatch) {
    console.warn(`[aiProvider] team ${teamId}: aiProvider=${providerMismatch} but the key looks like a ${preferred} key — using ${preferred}`);
  }
  const geminiKey = preferred === 'gemini' ? teamKey : (process.env.GEMINI_API_KEY || '');
  const openaiKey = preferred === 'openai' ? teamKey : (process.env.OPENAI_API_KEY || '');
  const anthropicKey = preferred === 'anthropic' ? teamKey : (process.env.ANTHROPIC_API_KEY || '');
  // A model typed for the OTHER provider would only 404 here.
  const model = !providerMismatch && typeof cfg.aiModel === 'string' ? cfg.aiModel.trim() : '';
  return {
    preferred, geminiKey, openaiKey, anthropicKey, model,
    hasKey: !!(geminiKey || openaiKey || anthropicKey),
    providerMismatch,
  };
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

// ── Anthropic (Claude) — official SDK ────────────────────────────────────────

/**
 * Models that take `output_config.effort` and think by default (Claude 4.6+).
 * Older ids a tenant may type (`claude-haiku-4-5`, `claude-sonnet-4-5`) reject
 * `effort`, so for them the request is kept to the fields every model accepts.
 */
function anthropicSupportsEffort(model: string): boolean {
  return /^claude-(opus-4-[6-9]|opus-5|sonnet-4-6|sonnet-5|haiku-5|fable-5|mythos-5)/.test(model);
}

/**
 * Models with server-side refusal fallback (`fallbacks: 'default'`, beta
 * `server-side-fallback-2026-07-01`): a safety decline is re-run on another
 * Claude inside the same call instead of coming back as `stop_reason: 'refusal'`.
 */
function anthropicSupportsFallbacks(model: string): boolean {
  return /^claude-(opus-5|fable-5|sonnet-5-5)/.test(model);
}

/** Room for the model's own thinking, which counts against `max_tokens` on 4.6+. */
const ANTHROPIC_THINKING_HEADROOM = 2048;

async function callAnthropicChat(
  apiKey: string,
  system: SystemPrompt,
  msgs: ChatMsg[],
  model: string,
  opts: AiGenOptions = {},
): Promise<AiChatResult> {
  // Retries stay off: the caller's own fallback (other model / other provider) is
  // the retry, and a second attempt inside the SDK would blow the 25 s budget.
  const client = new Anthropic({ apiKey, timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, maxRetries: 0 });
  // Anthropic needs a `user` first turn and non-empty text; consecutive same-role
  // turns are merged server-side.
  const messages: Anthropic.MessageParam[] = msgs
    .filter((m) => m.content && m.content.trim())
    .map((m) => ({ role: m.role, content: m.content }));
  while (messages.length && messages[0].role !== 'user') messages.shift();
  if (!messages.length) messages.push({ role: 'user', content: '…' });

  const replyCap = opts.maxTokens ?? 1500;
  const modern = anthropicSupportsEffort(model);
  // `temperature` is deliberately NOT sent: the 5.x models reject sampling
  // parameters, and the defaults are right for an assistant.
  // Prompt caching: a split prompt caches its stable block (5-min ephemeral TTL,
  // refreshed on every hit). Below the model's minimum prefix (512–4096 tokens) the
  // marker is silently ignored: no error, just no cache. A plain string is sent as
  // before, because caching a prompt that changes every call only adds the 25 %
  // write surcharge with no reads.
  const systemParam: string | Anthropic.TextBlockParam[] | undefined = typeof system === 'string'
    ? (system || undefined)
    : [
        { type: 'text', text: system.stable, cache_control: { type: 'ephemeral' } },
        ...(system.dynamic ? [{ type: 'text' as const, text: system.dynamic }] : []),
      ];
  const params: Anthropic.MessageCreateParamsNonStreaming = {
    model,
    max_tokens: modern ? replyCap + ANTHROPIC_THINKING_HEADROOM : replyCap,
    ...(systemParam ? { system: systemParam } : {}),
    messages,
    ...(modern ? { output_config: { effort: 'low' } } : {}),
  };

  const response = anthropicSupportsFallbacks(model)
    ? await client.beta.messages.create({
        ...params,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      })
    : await client.messages.create(params);

  const reply = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
  if (response.stop_reason === 'refusal' && !reply) {
    const category = (response as any).stop_details?.category;
    const err: any = new Error(`Anthropic refusal${category ? ` (${category})` : ''}`);
    err.code = 'ai-refusal';
    throw err;
  }
  const usage: any = response.usage || {};
  const cacheReadTokens = Number(usage.cache_read_input_tokens) || 0;
  const cacheWriteTokens = Number(usage.cache_creation_input_tokens) || 0;
  return {
    reply,
    // `input_tokens` excludes cached tokens, so the total adds both cache legs.
    tokensUsed: (Number(usage.input_tokens) || 0) + (Number(usage.output_tokens) || 0) + cacheReadTokens + cacheWriteTokens,
    cacheReadTokens,
    cacheWriteTokens,
    // `response.model` is the model that actually answered (a fallback may have).
    model: response.model || model,
    provider: 'anthropic',
  };
}

/** Single-prompt Gemini text (kept for `_gmb.ts` callers). */
export async function callGeminiText(apiKey: string, model: string, prompt: string): Promise<string> {
  return (await callGeminiChat(apiKey, '', [{ role: 'user', content: prompt }], model, { maxTokens: 400 })).reply;
}

/** Single-prompt OpenAI text (kept for `_gmb.ts` callers). */
export async function callOpenAiText(apiKey: string, model: string, prompt: string): Promise<string> {
  return (await callOpenAiChat(apiKey, '', [{ role: 'user', content: prompt }], model, { maxTokens: 400 })).reply;
}

/** Single-prompt Anthropic text (same contract as the two above). */
export async function callAnthropicText(apiKey: string, model: string, prompt: string): Promise<string> {
  return (await callAnthropicChat(apiKey, '', [{ role: 'user', content: prompt }], model, { maxTokens: 400 })).reply;
}

function callProviderChat(
  p: AiProviderName,
  apiKey: string,
  system: SystemPrompt,
  msgs: ChatMsg[],
  model: string,
  opts: AiGenOptions,
): Promise<AiChatResult> {
  if (p === 'gemini') return callGeminiChat(apiKey, systemPromptText(system), msgs, model, opts);
  if (p === 'openai') return callOpenAiChat(apiKey, systemPromptText(system), msgs, model, opts);
  return callAnthropicChat(apiKey, system, msgs, model, opts);
}

// ── The two public entry points ───────────────────────────────────────────────

export const AI_NOT_CONFIGURED_MESSAGE =
  'AI nuk është konfiguruar (vendos çelësin te Cilësimet → Integrime, ose GEMINI/OPENAI/ANTHROPIC_API_KEY)';

/**
 * The providers to try, in order: the tenant's preferred one first, then every
 * other provider that has a key (platform env), in registry order.
 */
export function providerOrder(cfg: ResolvedAiConfig): AiProviderName[] {
  const withKey = AI_PROVIDERS.filter((p) => !!keyFor(cfg, p));
  if (cfg.preferred && withKey.includes(cfg.preferred)) {
    return [cfg.preferred, ...withKey.filter((p) => p !== cfg.preferred)];
  }
  return withKey;
}

/**
 * Chat completion with an already-resolved config. The preferred provider goes
 * first; on failure every other provider with a key is tried once, in order.
 */
export async function generateChatWith(
  cfg: ResolvedAiConfig,
  system: SystemPrompt,
  messages: ChatMsg[],
  opts: AiGenOptions = {},
): Promise<AiChatResult> {
  const order = providerOrder(cfg);
  if (!order.length) throw new Error(AI_NOT_CONFIGURED_MESSAGE);
  // The tenant's model override belongs to its preferred provider only — a Gemini
  // model name sent to OpenAI (or Anthropic) on the fallback leg would just 404.
  const modelFor = (p: AiProviderName) =>
    opts.model || (cfg.preferred === p && cfg.model ? cfg.model : defaultModelFor(p));

  // A model name the provider no longer serves (a retired `gemini-1.5-*`, a typo in
  // Cilësimet → FivoAI) must not take the assistant down: when the CONFIGURED model
  // 404s, the same key is retried once with the provider's current default. Any
  // other failure (key, quota, timeout) is rethrown untouched — it is not about the
  // model. The reply then reports the model that actually answered.
  const deadline = Date.now() + (opts.totalBudgetMs ?? DEFAULT_TOTAL_BUDGET_MS);
  const legOpts = (): AiGenOptions => ({
    ...opts,
    timeoutMs: Math.min(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, Math.max(MIN_LEG_MS, deadline - Date.now())),
  });

  const withModelFallback = async (p: AiProviderName): Promise<AiChatResult> => {
    const call = (m: string) => callProviderChat(p, keyFor(cfg, p), system, messages, m, legOpts());
    const model = modelFor(p);
    const fallbackModel = defaultModelFor(p);
    try { return await call(model); } catch (err: any) {
      if (model === fallbackModel || classifyAiError(err).code !== 'model-not-found') throw err;
      console.warn(`[aiProvider] model "${model}" not found at ${p} — retrying with the default "${fallbackModel}"`);
      return call(fallbackModel);
    }
  };

  // When every leg fails, the PRIMARY error is the one to report: it is about the
  // key the tenant configured, which is what they can act on.
  let primaryError: unknown = null;
  for (let i = 0; i < order.length; i++) {
    const p = order[i];
    if (i > 0 && deadline - Date.now() < MIN_LEG_MS) {
      console.error(`[aiProvider] no time left for the ${p} fallback leg`);
      break;
    }
    try {
      return await withModelFallback(p);
    } catch (err: any) {
      const last = i === order.length - 1;
      if (primaryError === null) {
        primaryError = err;
        if (!last) console.error(`[aiProvider] ${p} failed, falling back:`, err?.message || err);
      } else {
        console.error(`[aiProvider] fallback ${p} failed too:`, err?.message || err);
      }
    }
  }
  throw primaryError;
}

/** Chat completion using the tenant's configured provider (env fallback). */
export async function generateChat(
  teamId: string | null | undefined,
  system: SystemPrompt,
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
