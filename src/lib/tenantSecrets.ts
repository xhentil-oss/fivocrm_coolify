import { auth } from './firebase';

/**
 * Client-side writer for tenant credentials.
 *
 * Credentials (ESP/AI API keys, SMTP password, WhatsApp VPS secret, Meta page
 * access tokens) live in `teamSecrets/{teamId}`, which Firestore rules deny to
 * every client — they are written and read only by the Admin SDK. The browser
 * therefore POSTs them once to /api/tenant-secrets and never reads them back;
 * the UI shows the `has*` booleans mirrored onto `teamSettings` instead.
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

export async function saveTenantSecrets(teamId: string, secrets: TenantSecretsInput): Promise<void> {
  if (!teamId) throw new Error('teamId required');
  const payload = Object.fromEntries(Object.entries(secrets).filter(([, v]) => v !== undefined));
  if (Object.keys(payload).length === 0) return;

  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Not authenticated');

  const res = await fetch('/api/tenant-secrets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ teamId, secrets: payload }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({} as any));
    throw new Error(data?.error || 'Ruajtja e kredencialeve dështoi');
  }
}
