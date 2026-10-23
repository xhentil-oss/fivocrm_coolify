/**
 * Pure helpers for the AI provider layer — import-free so `src/` tests can load
 * this file directly (same law as `_emailIdentity.ts`).
 *
 * Two questions live here:
 *
 *   1. WHICH provider does a key belong to? A Gemini key starts with `AIza`, an
 *      Anthropic key with `sk-ant-`, an OpenAI key with `sk-` (so Anthropic MUST be
 *      tested first — `sk-ant-…` also matches the OpenAI shape). The Settings form
 *      stores `aiProvider` separately from
 *      the key, and the save button was disabled without a key, so a tenant could
 *      end up with `aiProvider: 'gemini'` and an OpenAI key (or the reverse). Sent
 *      to the wrong provider the key is simply "invalid" — an opaque 500 in the UI
 *      with nothing to act on. The key's shape is the one fact that cannot be
 *      mis-clicked, so it wins over the stored choice.
 *
 *   2. WHAT does a failed provider call mean for the caller? `classifyAiError`
 *      turns a thrown error into a named code, an HTTP status the endpoint should
 *      return and an Albanian message that says what to fix. The provider's own
 *      message is kept as `detail` with anything key-shaped redacted.
 */
export type AiProviderName = 'gemini' | 'openai' | 'anthropic';

export const AI_PROVIDERS: readonly AiProviderName[] = ['gemini', 'openai', 'anthropic'];

/** The provider a key can be used with, from its shape; null when unrecognisable. */
export function inferProviderFromKey(key: string | null | undefined): AiProviderName | null {
  const k = (key || '').trim();
  if (/^AIza[0-9A-Za-z_-]{20,}$/.test(k)) return 'gemini';
  // Order matters: an Anthropic key is `sk-ant-…`, which the OpenAI shape also matches.
  if (/^sk-ant-[A-Za-z0-9_-]{10,}$/.test(k)) return 'anthropic';
  if (/^sk-[A-Za-z0-9_-]{10,}$/.test(k)) return 'openai';
  return null;
}

export interface ProviderChoice {
  /** The provider the key will actually be sent to. */
  provider: AiProviderName;
  /** The stored `aiProvider` when the key's shape contradicted it (for the log), else null. */
  mismatch: AiProviderName | null;
}

/**
 * Stored `aiProvider` reconciled with the key: the key's shape wins when it is
 * recognisable and contradicts the stored choice; an unrecognisable key keeps the
 * stored choice (default Gemini, as before).
 */
export function resolveProviderChoice(stored: unknown, key: string): ProviderChoice {
  const storedProvider: AiProviderName =
    stored === 'openai' ? 'openai' : stored === 'anthropic' ? 'anthropic' : 'gemini';
  const byKey = inferProviderFromKey(key);
  if (byKey && byKey !== storedProvider) return { provider: byKey, mismatch: storedProvider };
  return { provider: storedProvider, mismatch: null };
}

export type AiErrorCode =
  | 'not-configured'
  | 'invalid-key'
  | 'model-not-found'
  | 'rate-limited'
  | 'timeout'
  | 'bad-request'
  | 'refused'
  | 'upstream';

export interface ClassifiedAiError {
  code: AiErrorCode;
  /** What the endpoint returns to the browser. */
  httpStatus: number;
  /** Actionable, in Albanian — shown to the user as-is. */
  message: string;
  /** The provider's own message, redacted and capped; for the console, never the only thing shown. */
  detail: string;
}

const MESSAGES: Record<AiErrorCode, { httpStatus: number; message: string }> = {
  'not-configured': { httpStatus: 503, message: 'AI nuk është konfiguruar (Cilësimet → Integrime → FivoAI).' },
  'invalid-key': { httpStatus: 502, message: 'Ofruesi AI e refuzoi çelësin API — kontrolloni çelësin dhe ofruesin te Cilësimet → Integrime → FivoAI.' },
  'model-not-found': { httpStatus: 502, message: 'Modeli AI i konfiguruar nuk ekziston te ofruesi — lëreni bosh fushën "Modeli" te Cilësimet → Integrime → FivoAI.' },
  'rate-limited': { httpStatus: 429, message: 'Ofruesi AI është i ngarkuar ose kuota e çelësit ka mbaruar. Provoni përsëri pas pak.' },
  'timeout': { httpStatus: 504, message: 'AI nuk u përgjigj në kohë. Provoni përsëri, mundësisht me një kërkesë më të shkurtër.' },
  'bad-request': { httpStatus: 502, message: 'Ofruesi AI e refuzoi kërkesën.' },
  // Anthropic answers HTTP 200 with `stop_reason: 'refusal'` when its safety
  // classifiers decline — not an error of ours, nothing to "fix" in Cilësimet.
  'refused': { httpStatus: 502, message: 'Modeli AI e refuzoi këtë kërkesë. Riformuloni pyetjen.' },
  'upstream': { httpStatus: 502, message: 'Ofruesi AI ktheu gabim. Provoni përsëri pas pak.' },
};

/** Strip anything that looks like an API key or a `?key=` query from free text. */
export function redactAiSecrets(text: string): string {
  return String(text ?? '')
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, 'AIza…')
    .replace(/sk-ant-[A-Za-z0-9_-]{10,}/g, 'sk-ant-…')
    .replace(/sk-[A-Za-z0-9_-]{10,}/g, 'sk-…')
    .replace(/([?&]key=)[^&\s"']+/gi, '$1…');
}

function statusOf(err: any): number | null {
  const s = Number(err?.status ?? err?.statusCode);
  return Number.isFinite(s) && s > 0 ? s : null;
}

/**
 * Classify a thrown provider error. Order matters: a provider's 400 that TALKS
 * about the key is an invalid key, not a bad request; a 429 or a "quota" message
 * is rate limiting; a 404 (or "model … not found") is a model name typo.
 */
export function classifyAiError(err: unknown): ClassifiedAiError {
  const e: any = err ?? {};
  const rawMessage = String(e?.message ?? e ?? '');
  const detail = redactAiSecrets(rawMessage).slice(0, 240);
  const status = statusOf(e);
  const name = String(e?.name ?? '');
  const msg = rawMessage.toLowerCase();

  const finish = (code: AiErrorCode): ClassifiedAiError => ({ code, ...MESSAGES[code], detail });

  if (/nuk është konfiguruar/i.test(rawMessage)) return finish('not-configured');
  if (e?.code === 'ai-refusal') return finish('refused');
  if (name === 'TimeoutError' || name === 'AbortError' || /timed? ?out|aborted/.test(msg)) return finish('timeout');
  if (status === 401 || status === 403) return finish('invalid-key');
  if (/api[ _-]?key|invalid.*key|incorrect api|permission[_ ]denied|unauthenticated/.test(msg)) return finish('invalid-key');
  if (status === 429 || /quota|rate ?limit|resource[_ ]exhausted/.test(msg)) return finish('rate-limited');
  if (status === 404 || /model.*(not found|does not exist|is not supported|not exist)/.test(msg)) return finish('model-not-found');
  if (status !== null && status >= 400 && status < 500) return finish('bad-request');
  return finish('upstream');
}
