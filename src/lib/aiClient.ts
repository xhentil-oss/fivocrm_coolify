/**
 * Shared error reading for every `/api/ai-chat` caller.
 *
 * The endpoint answers a failed provider call with `{ error, code, detail }`
 * (`api/_aiErrors.ts`): `error` is the actionable Albanian sentence, `code` the
 * named reason, `detail` the provider's own (redacted) message. Before this,
 * every call site threw `HTTP 500` and the user had nothing to act on.
 */
export interface AiApiError extends Error {
  code?: string;
  detail?: string;
  status: number;
}

export type AiConnectionTest =
  | { ok: true; provider: string; model: string }
  | { ok: false; status: number; message: string; code?: string; detail?: string };

/**
 * "Does the SAVED key work?" — one trivial round trip through `/api/ai-chat`
 * (the same path the assistant uses, so the answer is the real one), reported
 * with the provider's reason instead of a bare `502` in the browser console.
 */
export async function testAiConnection(token: string, teamId: string | null): Promise<AiConnectionTest> {
  const res = await fetch('/api/ai-chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      messages: [{ role: 'user', content: 'Përgjigju vetëm me fjalën "OK".' }],
      context: { userRole: 'staff' },
      teamId,
    }),
  });
  if (!res.ok) {
    const err = await aiResponseError(res);
    return { ok: false, status: err.status, message: err.message, code: err.code, detail: err.detail };
  }
  const data = (await res.json().catch(() => ({}))) as { provider?: string; model?: string };
  return { ok: true, provider: data.provider || '—', model: data.model || '—' };
}

export async function aiResponseError(res: Response): Promise<AiApiError> {
  const data = (await res.json().catch(() => null)) as { error?: string; code?: string; detail?: string } | null;
  const err = new Error(data?.error || `Gabim serveri (HTTP ${res.status})`) as AiApiError;
  err.status = res.status;
  if (data?.code) err.code = data.code;
  if (data?.detail) err.detail = data.detail;
  return err;
}
