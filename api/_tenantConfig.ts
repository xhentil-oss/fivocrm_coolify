import { safeSenderAddress, safeSenderName } from './_emailIdentity.js';
import admin, { adminDb as db } from './_firebaseAdmin.js';
import { encryptSecretFields, decryptSecretFields } from './_secretCrypto.js';

/**
 * Per-tenant configuration, split into two documents:
 *
 *   teamSettings/{teamId}  — non-secret config. Readable by members of the team's
 *                            business (company identity, bank accounts, rates,
 *                            feature flags, channel metadata, `has*` markers).
 *   teamSecrets/{teamId}   — credentials. `allow read, write: if false` in Firestore
 *                            rules, so ONLY the Admin SDK can ever see them.
 *
 * Before this split, `teamSettings` was `allow read: if isAuth()` while holding
 * SMTP passwords, ESP/AI API keys, the WhatsApp VPS secret and Meta page access
 * tokens — i.e. every signed-in user of ANY tenant (including portal clients) could
 * read every tenant's credentials. Server code must therefore never read
 * `teamSettings` directly for a credential; call `getTeamConfig()` instead.
 */

/** Credential fields that live in `teamSecrets`, never in `teamSettings`. */
export const SECRET_FIELDS = [
  'aiApiKey',
  'emailApiKey',
  'emailSmtpPass',
  'whatsappVpsSecret',
  'metaWebhookVerifyToken',
  /** Map of phoneNumberId → Meta page access token (metaChannels keeps the metadata). */
  'metaChannelTokens',
  /** Google OAuth client secret for the GMB/Reviews module (gmbClientId stays in teamSettings — it is not secret). */
  'gmbClientSecret',
  /** Dynadot registrar API key (hosting & domains module). */
  'dynadotApiKey',
  /** Google Places API (New) key — the sales agent's Maps prospecting (api/_placesClient.ts). */
  'googlePlacesApiKey',
] as const;

/** Public boolean markers mirrored onto teamSettings so the UI can say "configured". */
export const SECRET_FLAGS: Record<string, string> = {
  aiApiKey: 'hasAiApiKey',
  emailApiKey: 'hasEmailApiKey',
  emailSmtpPass: 'hasEmailSmtpPass',
  whatsappVpsSecret: 'hasWhatsappVpsSecret',
  metaWebhookVerifyToken: 'hasMetaWebhookVerifyToken',
  metaChannelTokens: 'hasMetaChannelTokens',
  gmbClientSecret: 'hasGmbClientSecret',
  dynadotApiKey: 'hasDynadotApiKey',
  googlePlacesApiKey: 'hasGooglePlacesApiKey',
};

export interface TeamConfig extends Record<string, any> {}

/** Read the secrets document (Admin SDK only). */
export async function getTeamSecrets(teamId: string): Promise<Record<string, any>> {
  if (!teamId) return {};
  try {
    const snap = await db.collection('teamSecrets').doc(teamId).get();
    // Values are AES-GCM at rest when SECRETS_ENC_KEY is set; legacy plaintext passes through.
    return snap.exists ? decryptSecretFields(((snap.data() as any) || {})) : {};
  } catch {
    return {};
  }
}

/**
 * Fully-resolved tenant config: `teamSettings` merged with `teamSecrets`, with
 * `metaChannels[].accessToken` re-hydrated from `metaChannelTokens`. Drop-in
 * replacement for `(await db.collection('teamSettings').doc(id).get()).data()`.
 *
 * During the migration window a legacy secret still sitting on teamSettings is
 * honored (secrets win), so this is safe to deploy before the migration job runs.
 */
export async function getTeamConfig(teamId: string): Promise<TeamConfig> {
  if (!teamId) return {};
  const [settingsSnap, secrets] = await Promise.all([
    db.collection('teamSettings').doc(teamId).get(),
    getTeamSecrets(teamId),
  ]);
  const settings: Record<string, any> = settingsSnap.exists ? ((settingsSnap.data() as any) || {}) : {};
  const merged: Record<string, any> = { ...settings, ...stripUndefined(secrets) };

  const tokens = (secrets.metaChannelTokens || {}) as Record<string, string>;
  if (Array.isArray(settings.metaChannels)) {
    merged.metaChannels = settings.metaChannels.map((ch: any) => {
      const token = tokens[ch?.phoneNumberId] || ch?.accessToken || '';
      return { ...ch, accessToken: token };
    });
  }
  return merged;
}

/**
 * Per-tenant email identity ("E1: shared sending identity").
 *
 * Mail still leaves through the PLATFORM's SMTP (no DNS setup asked of the tenant),
 * but the recipient sees the tenant's own name and replies land in the tenant's
 * inbox — instead of every tenant's clients receiving mail signed "FivoCRM".
 *
 *   From:     "Agjencia Shembull" <platform-smtp-user>
 *   Reply-To: kontakt@agjencia-shembull.com
 *
 * A tenant that later configures its own verified domain (E2) overrides this by
 * setting emailFromEmail, which is then used as the envelope sender.
 */
export async function tenantEmailIdentity(
  teamId?: string | null,
  businessId?: string | null,
): Promise<{ fromName: string; replyTo?: string; fromEmail?: string }> {
  const fallback = { fromName: 'FivoCRM' as string, replyTo: undefined, fromEmail: undefined };
  try {
    if (teamId) {
      const s = await db.collection('teamSettings').doc(teamId).get();
      const d = s.exists ? ((s.data() as any) || {}) : {};
      const name = d.emailFromName || d.companyName;
      const reply = d.emailFromEmail || d.companyEmail;
      if (name || reply) {
        return {
          fromName: safeSenderName(name),
          replyTo: safeSenderAddress(reply),
          fromEmail: safeSenderAddress(d.emailFromEmail),
        };
      }
    }
    if (businessId) {
      const b = await db.collection('businesses').doc(businessId).get();
      const d = b.exists ? ((b.data() as any) || {}) : {};
      if (d.name) return { fromName: safeSenderName(d.name), replyTo: safeSenderAddress(d.ownerEmail), fromEmail: undefined };
    }
  } catch { /* fall through to the platform identity */ }
  return fallback;
}

function stripUndefined(obj: Record<string, any>): Record<string, any> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

/**
 * Persist credentials for a team: writes `teamSecrets/{teamId}`, mirrors `has*`
 * flags onto `teamSettings`, and DELETES any legacy plaintext copy that is still
 * on `teamSettings` (self-healing migration on every save).
 */
export async function writeTeamSecrets(
  teamId: string,
  secrets: Record<string, any>,
): Promise<{ written: string[]; cleared: string[] }> {
  const now = admin.firestore.Timestamp.now();
  const written: string[] = [];
  const cleared: string[] = [];

  const payload: Record<string, any> = { teamId, updatedAt: now };
  for (const field of SECRET_FIELDS) {
    if (!(field in secrets)) continue;
    const value = secrets[field];
    const isEmpty = value === '' || value === null || value === undefined
      || (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0);
    if (isEmpty) {
      payload[field] = admin.firestore.FieldValue.delete();
      cleared.push(field);
    } else {
      payload[field] = typeof value === 'string' ? encryptSecretFields({ v: value }).v : encryptSecretFields(value);
      written.push(field);
    }
  }
  if (written.length === 0 && cleared.length === 0) return { written, cleared };

  await db.collection('teamSecrets').doc(teamId).set(payload, { merge: true });

  // Mirror public flags + strip any plaintext legacy copy from teamSettings.
  const settingsPatch: Record<string, any> = { updatedAt: now };
  for (const field of [...written, ...cleared]) {
    const flag = SECRET_FLAGS[field];
    if (flag) settingsPatch[flag] = written.includes(field);
    settingsPatch[field] = admin.firestore.FieldValue.delete();
  }
  // metaChannels: keep metadata, never the token.
  try {
    const s = await db.collection('teamSettings').doc(teamId).get();
    const channels = (s.exists ? (s.data() as any)?.metaChannels : null) as any[] | null;
    if (Array.isArray(channels) && channels.some((c) => c?.accessToken)) {
      settingsPatch.metaChannels = channels.map(({ accessToken, ...rest }: any) => rest);
    }
  } catch { /* best-effort */ }

  await db.collection('teamSettings').doc(teamId).set(settingsPatch, { merge: true });
  return { written, cleared };
}
