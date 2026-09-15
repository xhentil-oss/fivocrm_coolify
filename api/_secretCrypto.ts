/**
 * Encryption at rest for tenant credentials (`teamSecrets`, `hostingServerSecrets`).
 *
 * Firestore rules already deny these documents to every client; this layer is for
 * the OTHER failure mode — a leaked service account or a Firestore export. With
 * `SECRETS_ENC_KEY` set (32 random bytes, base64), every string secret is stored as
 *
 *     enc:v1:<iv b64>:<tag b64>:<ciphertext b64>        (AES-256-GCM)
 *
 * and decrypted only inside the server process. Without the env the vault keeps
 * writing plaintext (so an existing deployment never breaks) and logs one warning
 * per process. `decryptSecret` accepts BOTH shapes, so the key can be introduced
 * at any time: old plaintext rows keep working and are re-encrypted on their next
 * write.
 *
 * Rotating the key: set `SECRETS_ENC_KEY_PREVIOUS` to the old value; reads try the
 * current key first, then the previous one.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const PREFIX = 'enc:v1:';
let warned = false;

function keyFromEnv(name: string): Buffer | null {
  const raw = process.env[name]?.trim();
  if (!raw) return null;
  try {
    const buf = Buffer.from(raw, 'base64');
    if (buf.length === 32) return buf;
    const hex = Buffer.from(raw, 'hex');
    if (hex.length === 32) return hex;
  } catch { /* fall through */ }
  console.error(`[secrets] ${name} must be 32 bytes (base64 or hex) — ignoring it`);
  return null;
}

export function secretsEncryptionEnabled(): boolean {
  return !!keyFromEnv('SECRETS_ENC_KEY');
}

export function isEncryptedSecret(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

/** Encrypt a string secret; returns the input unchanged when no key is configured. */
export function encryptSecret(plain: string): string {
  const key = keyFromEnv('SECRETS_ENC_KEY');
  if (!key) {
    if (!warned) { warned = true; console.warn('[secrets] SECRETS_ENC_KEY not set — tenant credentials are stored in plaintext'); }
    return plain;
  }
  if (isEncryptedSecret(plain)) return plain;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
}

/** Decrypt a stored secret; plaintext (legacy) values pass through unchanged. */
export function decryptSecret(value: string): string {
  if (!isEncryptedSecret(value)) return value;
  const [, , ivB64, tagB64, ctB64] = value.split(':');
  const keys = [keyFromEnv('SECRETS_ENC_KEY'), keyFromEnv('SECRETS_ENC_KEY_PREVIOUS')].filter((k): k is Buffer => !!k);
  if (!keys.length) throw new Error('Kredenciali është i enkriptuar por SECRETS_ENC_KEY mungon');
  let lastErr: unknown;
  for (const key of keys) {
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
      decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
      return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
    } catch (err) { lastErr = err; }
  }
  throw new Error(`Kredenciali nuk u dekriptua: ${lastErr instanceof Error ? lastErr.message : 'çelës i gabuar'}`);
}

/** Encrypt every string leaf of a secrets object (maps like metaChannelTokens included). */
export function encryptSecretFields<T extends Record<string, any>>(obj: T): T {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string') out[k] = v ? encryptSecret(v) : v;
    else if (v && typeof v === 'object' && !Array.isArray(v) && typeof (v as any).toDate !== 'function' && !(v as any)._methodName) out[k] = encryptSecretFields(v);
    else out[k] = v;
  }
  return out as T;
}

/** Decrypt every string leaf; a value that fails to decrypt is dropped (never returned corrupt). */
export function decryptSecretFields<T extends Record<string, any>>(obj: T): T {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string') {
      try { out[k] = decryptSecret(v); } catch (err) { console.error(`[secrets] cannot decrypt field ${k}:`, err instanceof Error ? err.message : err); }
    } else if (v && typeof v === 'object' && !Array.isArray(v) && typeof (v as any).toDate !== 'function') out[k] = decryptSecretFields(v);
    else out[k] = v;
  }
  return out as T;
}
