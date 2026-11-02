import { auth } from './firebase';
import type { TenantCredentialField } from '../types';

/**
 * Client side of the tenant credential vault.
 *
 * Credentials (AI / ESP keys, SMTP password, WhatsApp VPS secret, Meta tokens, …)
 * belong to the TENANT (business) and live in `businessSecrets/{businessId}`, which
 * Firestore rules deny to every client. Since Nov 2026 they are PLATFORM-managed:
 * only a super-admin may set, rotate or clear them (`POST /api/tenant-secrets`
 * refuses anyone else with `code: 'platform-managed'`). A tenant's Owner/Admin sees
 * the status (`businesses.credentials`, the `has*` flags) and asks for a change
 * with `requestCredentialChange()`.
 *
 * Pass an empty string to clear a credential. Fields omitted are left untouched.
 */
export interface TenantSecretsInput {
  aiApiKey?: string;
  emailApiKey?: string;
  emailSmtpPass?: string;
  whatsappVpsSecret?: string;
  metaWebhookVerifyToken?: string;
  /** phoneNumberId → Meta page access token */
  metaChannelTokens?: Record<string, string>;
  /** Google OAuth client secret (GMB/Reviews module) */
  gmbClientSecret?: string;
  /** Dynadot registrar API key (hosting & domains module) */
  dynadotApiKey?: string;
  /** Google Places API key (sales agent prospecting) */
  googlePlacesApiKey?: string;
}

/** Human labels, shared by the console and the tenant's read-only cards. */
export const CREDENTIAL_LABELS: Record<TenantCredentialField, string> = {
  aiApiKey: 'Çelësi i AI-së (FivoAI)',
  emailApiKey: 'Çelësi API i email-it',
  emailSmtpPass: 'Fjalëkalimi SMTP',
  whatsappVpsSecret: 'Sekreti i WhatsApp VPS',
  metaWebhookVerifyToken: 'Token-i i webhook-ut Meta',
  metaChannelTokens: 'Token-at e kanaleve Meta',
  gmbClientSecret: 'Sekreti OAuth i Google Business',
  dynadotApiKey: 'Çelësi API i Dynadot',
  googlePlacesApiKey: 'Çelësi i Google Places',
};

async function post(body: Record<string, unknown>): Promise<Record<string, any>> {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Not authenticated');
  const res = await fetch('/api/tenant-secrets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({} as any));
  if (!res.ok) throw new Error(data?.error || 'Ruajtja e kredencialeve dështoi');
  return data;
}

/**
 * Super-admin only. `target` is a team id (resolved to its business server-side —
 * the Settings forms) or `{ businessId }` (the platform console).
 */
export async function saveTenantSecrets(
  target: string | { businessId: string },
  secrets: TenantSecretsInput,
): Promise<void> {
  const payload = Object.fromEntries(Object.entries(secrets).filter(([, v]) => v !== undefined));
  if (Object.keys(payload).length === 0) return;
  const scope = typeof target === 'string' ? { teamId: target } : { businessId: target.businessId };
  if (!scope.teamId && !('businessId' in scope && scope.businessId)) throw new Error('teamId/businessId required');
  await post({ ...scope, secrets: payload });
}

/** Tenant Owner/Admin/Manager → the platform: "please set/rotate this credential". */
export async function requestCredentialChange(field: TenantCredentialField | null, note?: string): Promise<void> {
  await post({ action: 'request-change', field, note: note || '' });
}
