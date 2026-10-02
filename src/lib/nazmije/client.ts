/**
 * Browser client for `POST /api/nazmije` (api/_nazmije.ts).
 *
 * Nazmije has no Auth user, so the browser can never write a row AS her, and the
 * rules cannot prove "a DM to 'nazmije' stays inside my tenant" — which is why a
 * DM to her is sent THROUGH this endpoint (the server writes the person's row and
 * her reply) while a group @mention is written by ChatView as usual and only the
 * reply is requested here.
 */
import { auth } from '../firebase';
import type { NazmijeBlockReason, NazmijeSettings } from './core';

export class NazmijeApiError extends Error {
  status: number;
  blocked: NazmijeBlockReason | null;
  constructor(status: number, message: string, blocked: NazmijeBlockReason | null = null) {
    super(message);
    this.name = 'NazmijeApiError';
    this.status = status;
    this.blocked = blocked;
  }
}

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new NazmijeApiError(401, 'Nuk jeni i identifikuar');
  const res = await fetch('/api/nazmije', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new NazmijeApiError(res.status, data?.error || `Kërkesa dështoi (${res.status})`, data?.blocked ?? null);
  return data as T;
}

export interface AskResult {
  ok: boolean;
  blocked: NazmijeBlockReason | null;
  replyId: string | null;
  userMessageId: string | null;
  aiError?: string;
}

/** A DM (`text`) or a group @mention already written by the browser (`messageId`). */
export function askNazmije(input: { teamId: string | null; text?: string; messageId?: string }): Promise<AskResult> {
  return call<AskResult>({ action: 'ask', ...input });
}

export interface EnableResult { ok: boolean; channelId: string | null; helloId: string | null; settings: Partial<NazmijeSettings> }

export function enableNazmije(input: {
  teamId: string;
  /** An existing group to post into; omit to create "Zyra" with every active member. */
  channelId?: string | null;
  createChannel?: boolean;
  channelName?: string;
  settings?: Partial<NazmijeSettings>;
  hello?: boolean;
}): Promise<EnableResult> {
  return call<EnableResult>({ action: 'enable', ...input });
}

export function disableNazmije(teamId: string): Promise<{ ok: boolean }> {
  return call({ action: 'disable', teamId });
}
