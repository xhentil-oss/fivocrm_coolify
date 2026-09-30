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

export async function aiResponseError(res: Response): Promise<AiApiError> {
  const data = (await res.json().catch(() => null)) as { error?: string; code?: string; detail?: string } | null;
  const err = new Error(data?.error || `Gabim serveri (HTTP ${res.status})`) as AiApiError;
  err.status = res.status;
  if (data?.code) err.code = data.code;
  if (data?.detail) err.detail = data.detail;
  return err;
}
