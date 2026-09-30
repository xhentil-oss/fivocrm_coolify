/**
 * @vitest-environment node
 *
 * `api/_aiErrors.ts` is import-free, so it is loaded directly (same as the
 * emailIdentity mirror test).
 */
import { describe, it, expect } from 'vitest';
import {
  classifyAiError,
  inferProviderFromKey,
  redactAiSecrets,
  resolveProviderChoice,
} from '../../api/_aiErrors';

const GEMINI_KEY = 'AIzaSyD0123456789abcdefghijklmnopqrstuv';
const OPENAI_KEY = 'sk-proj-0123456789abcdefghijklmnop';

describe('inferProviderFromKey', () => {
  it('recognises the two key shapes and nothing else', () => {
    expect(inferProviderFromKey(GEMINI_KEY)).toBe('gemini');
    expect(inferProviderFromKey(OPENAI_KEY)).toBe('openai');
    expect(inferProviderFromKey('  ' + OPENAI_KEY + ' ')).toBe('openai');
    expect(inferProviderFromKey('hello')).toBeNull();
    expect(inferProviderFromKey('')).toBeNull();
    expect(inferProviderFromKey(undefined)).toBeNull();
  });
});

describe('resolveProviderChoice (the key decides where it can be used)', () => {
  it('keeps the stored provider when it agrees with the key', () => {
    expect(resolveProviderChoice('openai', OPENAI_KEY)).toEqual({ provider: 'openai', mismatch: null });
    expect(resolveProviderChoice('gemini', GEMINI_KEY)).toEqual({ provider: 'gemini', mismatch: null });
  });

  it('routes an OpenAI key stored under aiProvider=gemini to OpenAI, and reports the mismatch', () => {
    expect(resolveProviderChoice('gemini', OPENAI_KEY)).toEqual({ provider: 'openai', mismatch: 'gemini' });
    expect(resolveProviderChoice(undefined, OPENAI_KEY)).toEqual({ provider: 'openai', mismatch: 'gemini' });
    expect(resolveProviderChoice('openai', GEMINI_KEY)).toEqual({ provider: 'gemini', mismatch: 'openai' });
  });

  it('falls back to the stored choice (default Gemini) for an unrecognisable key', () => {
    expect(resolveProviderChoice('openai', 'weird-key')).toEqual({ provider: 'openai', mismatch: null });
    expect(resolveProviderChoice(undefined, 'weird-key')).toEqual({ provider: 'gemini', mismatch: null });
  });
});

describe('classifyAiError', () => {
  const withStatus = (status: number, message: string) => Object.assign(new Error(message), { status, statusCode: status });

  it('a Gemini 400 that talks about the key is an invalid key, not a bad request', () => {
    const c = classifyAiError(withStatus(400, 'Gemini 400: API key not valid. Please pass a valid API key.'));
    expect(c.code).toBe('invalid-key');
    expect(c.httpStatus).toBe(502);
    expect(c.message).toMatch(/Cilësimet/);
  });

  it('401/403 are an invalid key whatever the message says', () => {
    expect(classifyAiError(withStatus(401, 'OpenAI 401: Incorrect API key provided')).code).toBe('invalid-key');
    expect(classifyAiError(withStatus(403, 'Gemini 403: PERMISSION_DENIED')).code).toBe('invalid-key');
  });

  it('429 and quota messages are rate limiting and keep the 429 status', () => {
    const c = classifyAiError(withStatus(429, 'OpenAI 429: You exceeded your current quota'));
    expect(c.code).toBe('rate-limited');
    expect(c.httpStatus).toBe(429);
    expect(classifyAiError(withStatus(400, 'Gemini 400: RESOURCE_EXHAUSTED')).code).toBe('rate-limited');
  });

  it('a 404 or a "model not found" message is a model typo', () => {
    expect(classifyAiError(withStatus(404, 'Gemini 404: models/gemini-9 is not found')).code).toBe('model-not-found');
    expect(classifyAiError(withStatus(400, 'OpenAI 400: The model `gpt-9` does not exist')).code).toBe('model-not-found');
  });

  it('AbortSignal.timeout surfaces as a 504 timeout', () => {
    const e = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
    const c = classifyAiError(e);
    expect(c.code).toBe('timeout');
    expect(c.httpStatus).toBe(504);
  });

  it('the not-configured sentinel is a 503, other 4xx a bad request, everything else upstream', () => {
    expect(classifyAiError(new Error('AI nuk është konfiguruar (…)')).httpStatus).toBe(503);
    expect(classifyAiError(withStatus(422, 'OpenAI 422: messages[0] invalid')).code).toBe('bad-request');
    expect(classifyAiError(withStatus(500, 'Gemini 500: internal')).code).toBe('upstream');
    expect(classifyAiError(new TypeError('fetch failed')).code).toBe('upstream');
    expect(classifyAiError(undefined).code).toBe('upstream');
  });

  it('never echoes a key in the detail', () => {
    const c = classifyAiError(withStatus(400, `Gemini 400: bad key ${GEMINI_KEY} at ?key=${GEMINI_KEY}&x=1 and ${OPENAI_KEY}`));
    expect(c.detail).not.toContain(GEMINI_KEY);
    expect(c.detail).not.toContain(OPENAI_KEY);
    expect(c.detail.length).toBeLessThanOrEqual(240);
    expect(redactAiSecrets(`?key=${GEMINI_KEY}`)).toBe('?key=…');
  });
});
