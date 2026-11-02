import { createHash } from 'node:crypto';
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
  const [settingsSnap, secrets, biz] = await Promise.all([
    db.collection('teamSettings').doc(teamId).get(),
    getTeamSecrets(teamId),
    getBusinessLayerForTeam(teamId),
  ]);
  const settings: Record<string, any> = settingsSnap.exists ? ((settingsSnap.data() as any) || {}) : {};
  // Precedence: business vault (set by the platform) > legacy team vault > settings.
  const { metaChannelTokens: bizTokens, ...bizSecrets } = biz.secrets;
  const merged: Record<string, any> = { ...settings, ...stripUndefined(secrets), ...stripUndefined(bizSecrets) };

  // AI policy is the platform's (businesses/{bid}.aiPolicy): it overrides the
  // legacy per-team provider/model the tenant used to choose itself.
  const policy = biz.aiPolicy;
  if (policy.provider) merged.aiProvider = policy.provider;
  if (typeof policy.model === 'string' && policy.model.trim()) merged.aiModel = policy.model.trim();
  merged.aiAllowPlatformFallback = policy.allowPlatformFallback !== false;
  merged.aiDisabled = policy.disabled === true;

  const tokens = {
    ...((secrets.metaChannelTokens || {}) as Record<string, string>),
    ...((bizTokens || {}) as Record<string, string>),
  };
  if (Object.keys(tokens).length) merged.metaChannelTokens = tokens;
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

// ── Business-level vault (the platform owns tenant credentials) ──────────────
//
// A credential belongs to the TENANT (business), never to one of its teams: with
// one vault per team, switching the active team "lost" the AI key (it lived on the
// other department) and two departments could run on two different keys. Since
// Nov 2026 the vault is `businessSecrets/{businessId}` and ONLY a platform
// super-admin writes it (POST /api/tenant-secrets checks the `superAdmin` claim).
// The tenant sees status only: `businesses/{bid}.credentials.<field>` (configured,
// last4, fingerprint, who/when) and the legacy `has*` flags on every team's
// teamSettings, which the existing UI keeps reading. `teamSecrets/{teamId}` is
// still READ as a fallback for teams that were never consolidated.

/** AI policy decided by the platform for one tenant (`businesses/{bid}.aiPolicy`). */
export interface AiPolicy {
  provider?: 'gemini' | 'openai' | 'anthropic' | null;
  model?: string | null;
  /** May the platform's own env key serve this tenant when it has none? Default true. */
  allowPlatformFallback?: boolean;
  /** Kill switch: no AI at all for this tenant. */
  disabled?: boolean;
}

/** teams/{teamId}.businessId, falling back to the legacy `businessId == teamId`. */
export async function businessIdOfTeamId(teamId: string): Promise<string> {
  try {
    const t = await db.collection('teams').doc(teamId).get();
    const bid = t.exists ? (t.data() as any)?.businessId : null;
    return typeof bid === 'string' && bid ? bid : teamId;
  } catch {
    return teamId;
  }
}

/** Read `businessSecrets/{bid}` (Admin SDK only). Decrypt failures drop the field and log. */
export async function getBusinessSecrets(businessId: string): Promise<Record<string, any>> {
  if (!businessId) return {};
  try {
    const snap = await db.collection('businessSecrets').doc(businessId).get();
    return snap.exists ? decryptSecretFields(((snap.data() as any) || {})) : {};
  } catch {
    return {};
  }
}

async function getBusinessLayerForTeam(teamId: string): Promise<{
  businessId: string; secrets: Record<string, any>; aiPolicy: AiPolicy;
}> {
  const businessId = await businessIdOfTeamId(teamId);
  const [secrets, bizSnap] = await Promise.all([
    getBusinessSecrets(businessId),
    db.collection('businesses').doc(businessId).get().catch(() => null),
  ]);
  const raw = bizSnap && bizSnap.exists ? ((bizSnap.data() as any)?.aiPolicy || {}) : {};
  // Only the vault's credential fields — never its bookkeeping (businessId, updatedAt).
  const onlySecrets = Object.fromEntries(
    Object.entries(secrets).filter(([k]) => (SECRET_FIELDS as readonly string[]).includes(k)),
  );
  return { businessId, secrets: onlySecrets, aiPolicy: raw as AiPolicy };
}

/** Non-reversible identifier of a secret value, safe to show and to audit. */
export function secretFingerprint(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 12);
}

/** What the tenant may see about a credential — never the value. */
export function secretStatusOf(field: string, value: unknown): Record<string, any> {
  if (field === 'metaChannelTokens' && value && typeof value === 'object') {
    const n = Object.keys(value as object).length;
    return { configured: n > 0, count: n };
  }
  const s = typeof value === 'string' ? value : '';
  return {
    configured: !!s,
    last4: s.length >= 8 ? s.slice(-4) : null,
    fingerprint: s ? secretFingerprint(s) : null,
  };
}

/**
 * Persist credentials for a whole tenant (super-admin path). Writes
 * `businessSecrets/{bid}`, records the status on `businesses/{bid}.credentials`,
 * mirrors the `has*` flags onto EVERY team of the business and removes the field
 * from every legacy `teamSecrets` doc — after this, the business vault is the one
 * answer for that field, so a cleared key cannot resurface from an old team copy.
 *
 * `metaChannelTokens` is a map keyed by phoneNumberId: the new entries are MERGED
 * into what the business (and its teams) already hold, so saving one department's
 * channel never drops another's.
 */
export async function writeBusinessSecrets(
  businessId: string,
  secrets: Record<string, any>,
  actor: { uid: string | null; email?: string | null },
): Promise<{ written: string[]; cleared: string[]; teams: number }> {
  const now = admin.firestore.Timestamp.now();
  const written: string[] = [];
  const cleared: string[] = [];

  const teamsSnap = await db.collection('teams').where('businessId', '==', businessId).get();
  const teamIds = new Set(teamsSnap.docs.map((d) => d.id));
  // Legacy tenants: businessId == teamId and the team doc may not carry the field.
  if ((await db.collection('teams').doc(businessId).get()).exists) teamIds.add(businessId);

  const payload: Record<string, any> = { businessId, updatedAt: now, updatedBy: actor.uid || null };
  const statusPatch: Record<string, any> = {};

  for (const field of SECRET_FIELDS) {
    if (!(field in secrets)) continue;
    let value = secrets[field];
    const isEmpty = value === '' || value === null || value === undefined
      || (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0);

    if (isEmpty) {
      payload[field] = admin.firestore.FieldValue.delete();
      cleared.push(field);
      statusPatch[`credentials.${field}`] = { configured: false, updatedAt: now, updatedBy: actor.email || actor.uid || null };
      continue;
    }

    if (field === 'metaChannelTokens') {
      // Fold the legacy per-team maps and the current business map in first.
      const existing = (await getBusinessSecrets(businessId)).metaChannelTokens || {};
      const fromTeams: Record<string, string> = {};
      for (const tid of teamIds) Object.assign(fromTeams, (await getTeamSecrets(tid)).metaChannelTokens || {});
      value = { ...fromTeams, ...existing, ...(value as Record<string, string>) };
    }

    payload[field] = typeof value === 'string' ? encryptSecretFields({ v: value }).v : encryptSecretFields(value);
    written.push(field);
    statusPatch[`credentials.${field}`] = {
      ...secretStatusOf(field, value),
      updatedAt: now,
      updatedBy: actor.email || actor.uid || null,
    };
  }
  if (written.length === 0 && cleared.length === 0) return { written, cleared, teams: 0 };

  await db.collection('businessSecrets').doc(businessId).set(payload, { merge: true });
  await db.collection('businesses').doc(businessId).set(
    { ...unflattenTopLevel(statusPatch), credentialsUpdatedAt: now },
    { merge: true },
  );

  // Consolidate: flags on every team, no field left behind in a team vault or in
  // a plaintext teamSettings copy.
  const touched = [...written, ...cleared];
  const batch = db.batch();
  for (const tid of teamIds) {
    const flags: Record<string, any> = { updatedAt: now };
    const strip: Record<string, any> = { updatedAt: now };
    for (const field of touched) {
      const flag = SECRET_FLAGS[field];
      if (flag) flags[flag] = written.includes(field);
      flags[field] = admin.firestore.FieldValue.delete();
      strip[field] = admin.firestore.FieldValue.delete();
    }
    batch.set(db.collection('teamSettings').doc(tid), flags, { merge: true });
    batch.set(db.collection('teamSecrets').doc(tid), strip, { merge: true });
  }
  await batch.commit();

  return { written, cleared, teams: teamIds.size };
}

/** `{ 'credentials.aiApiKey': x }` → `{ credentials: { aiApiKey: x } }` for set({merge}). */
function unflattenTopLevel(patch: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(patch)) {
    const [head, ...rest] = k.split('.');
    if (!rest.length) { out[head] = v; continue; }
    out[head] = out[head] || {};
    out[head][rest.join('.')] = v;
  }
  return out;
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
