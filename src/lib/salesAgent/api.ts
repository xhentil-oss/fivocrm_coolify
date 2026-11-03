/**
 * Browser client for `POST /api/sales-agent` (api/_salesAgent.ts).
 *
 * The server decides everything from the caller's claims (`bid`), never from
 * ids sent here. Every failure is surfaced with the server's `blockReason` /
 * `code` / `detail` so the UI can show the named reason instead of a bare 500.
 */
import { auth } from '../firebase';
import type { AgentModelOutput, DeliveryDecision, AgentStage, SalesAgentBlockReason } from './core';
import type { ColdWaBlockReason } from './core';
import type { SearchBlockReason } from './prospecting';

export class SalesAgentApiError extends Error {
  status: number;
  blockReason: string | null;
  code: string | null;
  detail: string | null;
  constructor(status: number, message: string, extra: { blockReason?: string | null; code?: string | null; detail?: string | null } = {}) {
    super(message);
    this.name = 'SalesAgentApiError';
    this.status = status;
    this.blockReason = extra.blockReason ?? null;
    this.code = extra.code ?? null;
    this.detail = extra.detail ?? null;
  }
}

export async function salesAgentApi<T = Record<string, unknown>>(action: string, params: Record<string, unknown> = {}): Promise<T> {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new SalesAgentApiError(401, 'Nuk jeni i identifikuar');
  const res = await fetch('/api/sales-agent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ action, ...params }),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new SalesAgentApiError(res.status, data?.error || `Kërkesa dështoi (${res.status})`, {
      blockReason: data?.blockReason ?? data?.blocked ?? null,
      code: data?.code ?? null,
      detail: data?.detail ?? null,
    });
  }
  return data as T;
}

export const describeSalesAgentError = (err: unknown): string => {
  if (err instanceof SalesAgentApiError) {
    const parts = [err.message];
    if (err.detail) parts.push(err.detail);
    return parts.join(' — ');
  }
  return (err as Error)?.message || 'Gabim i panjohur';
};

// ── Typed helpers for the actions the server implements ──────────────────────

export interface SettingsTestResult {
  ai: { ok: boolean; provider?: string | null; model?: string | null; code?: string | null; detail?: string | null };
  places: { ok: boolean; configured: boolean; source?: 'tenant' | 'env' | null; error?: string | null };
}

export const testSalesAgentSettings = () => salesAgentApi<SettingsTestResult>('settings.test');
export const enableSalesAgent = (teamId: string) => salesAgentApi<{ ok: boolean }>('enable', { teamId });
export const disableSalesAgent = (teamId: string) => salesAgentApi<{ ok: boolean }>('disable', { teamId });

export interface SearchCreateResult { id: string; estimatedRequests: number; blockReason?: SearchBlockReason | null }
export const createProspectSearch = (p: { query: string; city: string; maxResults: number }) => salesAgentApi<SearchCreateResult>('search.create', p);
export const cancelProspectSearch = (searchId: string) => salesAgentApi<{ ok: boolean }>('search.cancel', { searchId });

export interface RegisterResult {
  created: Array<{ prospectId: string; leadId: string }>;
  linked: Array<{ prospectId: string; contactId: string; kind: 'lead' | 'customer' }>;
  skipped: Array<{ prospectId: string; reason: string }>;
  outreach?: { wa?: Array<{ prospectId: string; blocked?: ColdWaBlockReason | null }>; email?: Array<{ prospectId: string; blocked?: string | null }> };
}
export const registerProspects = (prospectIds: string[], outreach?: { wa?: boolean; email?: boolean }) =>
  salesAgentApi<RegisterResult>('prospect.register', { prospectIds, ...(outreach ? { outreach } : {}) });
export const rejectProspect = (prospectId: string, reason?: string) => salesAgentApi<{ ok: boolean }>('prospect.reject', { prospectId, ...(reason ? { reason } : {}) });

export const handoffConversation = (conversationId: string) => salesAgentApi<{ ok: boolean }>('conversation.handoff', { conversationId });
export const resumeConversation = (conversationId: string) => salesAgentApi<{ ok: boolean }>('conversation.resume', { conversationId });

export interface SimulateResult {
  output: AgentModelOutput;
  decision: DeliveryDecision;
  stage: AgentStage;
  collected?: Record<string, string>;
  blocked?: SalesAgentBlockReason | null;
}
export const simulateConversation = (p: { messages: Array<{ role: 'client' | 'agent'; text: string }>; collected?: Record<string, string>; stage?: AgentStage }) =>
  salesAgentApi<SimulateResult>('conversation.simulate', p);

export const draftReply = (conversationId: string) => salesAgentApi<{ ok: boolean; blocked?: SalesAgentBlockReason | null; text?: string | null }>('reply.draft', { conversationId });
export const previewDigest = () => salesAgentApi<{ text: string | null }>('digest.preview');

export interface ColdWaTestResult {
  ok: boolean;
  sent: boolean;
  text: string;
  sender: { agentId: string; phone: string | null; connected: boolean } | null;
  coldWaEnabled?: boolean;
  messageId?: string | null;
}
/** The first cold message exactly as the job would send it; `send: true` delivers it to `phone` only. */
export const testColdWa = (p: { phone?: string; send?: boolean; sampleName?: string; sampleCategory?: string; sampleCity?: string }) =>
  salesAgentApi<ColdWaTestResult>('coldwa.test', p);
