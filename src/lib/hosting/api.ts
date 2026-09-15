/**
 * Client for `POST /api/hosting` (see api/_hosting.ts for the action list).
 * Staff and portal share it — the server decides what the caller may do from
 * its claims, never from anything sent here.
 */
import { auth } from '../firebase';

export class HostingApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'HostingApiError';
    this.status = status;
  }
}

export async function hostingApi<T = Record<string, unknown>>(action: string, params: Record<string, unknown> = {}): Promise<T> {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new HostingApiError(401, 'Nuk jeni i identifikuar');
  const res = await fetch('/api/hosting', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ action, ...params }),
  });
  const data = await res.json().catch(() => ({} as any));
  if (!res.ok) throw new HostingApiError(res.status, (data as any)?.error || `Kërkesa dështoi (${res.status})`);
  return data as T;
}

export interface DomainCheckRow {
  domain: string;
  tld: string;
  sold: boolean;
  status: 'available' | 'taken' | 'unknown' | string;
  registerPrice: number | null;
  renewPrice: number | null;
  currency: 'ALL' | 'EUR' | null;
  cost?: number | null;
  costCurrency?: string | null;
}

export async function checkDomains(domains: string[], businessId?: string): Promise<{ results: DomainCheckRow[]; registrarError: string | null }> {
  return hostingApi('domain.check', { domains, ...(businessId ? { businessId } : {}) });
}
