import type { VercelRequest, VercelResponse } from '@vercel/node';
import admin, { adminAuth, adminDb as db } from './_firebaseAdmin.js';
import { SECRET_FIELDS, SECRET_FLAGS, businessIdOfTeamId, writeBusinessSecrets } from './_tenantConfig.js';
import { writeAudit } from './_audit.js';
import { notifyUser } from './_push.js';
import { hasManagerRole, identityFromToken } from './_callerIdentity.js';
import { resolveTenantClaims, superAdminEmails } from './_tenantClaims.js';

/**
 * POST /api/tenant-secrets
 * Header: Authorization: Bearer <Firebase ID token of a PLATFORM SUPER-ADMIN>
 * Body: { businessId? | teamId?, secrets: { aiApiKey?, emailApiKey?, emailSmtpPass?,
 *         whatsappVpsSecret?, metaWebhookVerifyToken?, metaChannelTokens?, … } }
 *
 * The ONLY way tenant credentials are set. Since Nov 2026 they belong to the
 * TENANT (business), not to one of its teams, and only the platform operator sets,
 * rotates or clears them — a tenant's Owner/Admin sees their status (configured,
 * last 4, who/when) and asks FivoCRM for a change. `businessSecrets` and
 * `teamSecrets` are `read, write: if false` in the rules, so a credential never
 * travels to a browser.
 *
 * `teamId` is accepted for the existing Settings forms (a super-admin working
 * inside a tenant): it is resolved to its business — the write is never per-team.
 * An empty string clears a credential for the whole tenant.
 */
const MAX_SECRET_BYTES = 4096;
const MAX_META_CHANNEL_TOKENS = 20;

const FIELD_LABELS: Record<string, string> = {
  aiApiKey: 'çelësi i AI-së',
  emailApiKey: 'çelësi i email-it',
  emailSmtpPass: 'fjalëkalimi SMTP',
  whatsappVpsSecret: 'sekreti i WhatsApp VPS',
  metaWebhookVerifyToken: 'token-i i webhook-ut Meta',
  metaChannelTokens: 'token-at e kanaleve Meta',
  gmbClientSecret: 'sekreti i Google Business',
  dynadotApiKey: 'çelësi i Dynadot',
  googlePlacesApiKey: 'çelësi i Google Places',
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });

  let decoded: admin.auth.DecodedIdToken;
  try {
    decoded = await adminAuth.verifyIdToken(authHeader.slice(7));
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
  // The tenant's side of the process: ask the platform for a change. Never a write.
  if ((req.body || {}).action === 'request-change') {
    return requestChange(req, res, decoded);
  }

  // The signed claim is the only accepted proof. A tenant Owner/Admin is refused:
  // credentials are managed by the platform, not by the tenant.
  if (decoded.superAdmin !== true) {
    return res.status(403).json({
      error: 'Kredencialet menaxhohen nga FivoCRM. Kontaktoni administratorin e platformës për ndryshim.',
      code: 'platform-managed',
    });
  }

  const { businessId: rawBid, teamId, secrets } = (req.body || {}) as {
    businessId?: string; teamId?: string; secrets?: Record<string, any>;
  };
  if (!secrets || typeof secrets !== 'object') return res.status(400).json({ error: 'Missing secrets' });

  let businessId = typeof rawBid === 'string' ? rawBid.trim() : '';
  if (!businessId && typeof teamId === 'string' && teamId) {
    const team = await db.collection('teams').doc(teamId).get();
    if (!team.exists) return res.status(404).json({ error: 'Team not found' });
    businessId = await businessIdOfTeamId(teamId);
  }
  if (!businessId) return res.status(400).json({ error: 'Missing businessId' });
  const bizSnap = await db.collection('businesses').doc(businessId).get();
  // A legacy tenant may have no businesses doc but must have its team.
  if (!bizSnap.exists && !(await db.collection('teams').doc(businessId).get()).exists) {
    return res.status(404).json({ error: 'Ky tenant nuk ekziston.' });
  }
  const biz = bizSnap.exists ? (bizSnap.data() as any) : {};

  // Only known credential fields, each size-capped.
  const filtered: Record<string, any> = {};
  for (const field of SECRET_FIELDS) {
    if (!(field in secrets)) continue;
    const value = secrets[field];
    if (field === 'metaChannelTokens') {
      if (value === '' || value === null) { filtered[field] = value; continue; }
      if (typeof value !== 'object' || Array.isArray(value)) return res.status(400).json({ error: 'metaChannelTokens duhet të jetë një objekt' });
      const entries = Object.entries(value as Record<string, unknown>);
      if (entries.length > MAX_META_CHANNEL_TOKENS) return res.status(400).json({ error: `metaChannelTokens: maksimumi ${MAX_META_CHANNEL_TOKENS} kanale` });
      const cleaned: Record<string, string> = {};
      for (const [k, v] of entries) {
        if (!/^[A-Za-z0-9_-]{1,64}$/.test(k)) return res.status(400).json({ error: 'metaChannelTokens: phoneNumberId i pavlefshëm' });
        if (typeof v !== 'string' || Buffer.byteLength(v, 'utf8') > MAX_SECRET_BYTES) return res.status(400).json({ error: 'metaChannelTokens: token i pavlefshëm ose shumë i gjatë' });
        cleaned[k] = v.trim();
      }
      filtered[field] = cleaned;
      continue;
    }
    if (value !== '' && value !== null && (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > MAX_SECRET_BYTES)) {
      return res.status(400).json({ error: `${field}: vlera është e pavlefshme ose shumë e gjatë (max ${MAX_SECRET_BYTES} bytes)` });
    }
    filtered[field] = typeof value === 'string' ? value.trim() : value;
  }
  if (Object.keys(filtered).length === 0) {
    return res.status(400).json({ error: `No known secret fields. Allowed: ${SECRET_FIELDS.join(', ')}` });
  }

  try {
    const result = await writeBusinessSecrets(businessId, filtered, { uid: decoded.uid, email: decoded.email || null });
    await writeAudit({
      businessId,
      actorUid: decoded.uid,
      actorEmail: decoded.email || null,
      action: 'platform.secrets_update',
      target: `business:${businessId}`,
      // Field NAMES only — never values.
      meta: { set: result.written, cleared: result.cleared, teams: result.teams, viaTeam: teamId || null },
    });

    // The owner is told that FivoCRM changed their configuration — a credential
    // swapped silently is exactly what an enterprise customer must be able to see.
    if (typeof biz.ownerId === 'string' && biz.ownerId) {
      const names = [...result.written, ...result.cleared].map((f) => FIELD_LABELS[f] || f);
      await notifyUser({
        userId: biz.ownerId,
        actorUserId: decoded.uid,
        type: 'tenant_credentials_changed',
        title: 'Kredencialet u përditësuan nga FivoCRM',
        message: `${result.cleared.length && !result.written.length ? 'U hoq' : 'U përditësua'}: ${names.join(', ')}.`,
        actionUrl: '/app/settings?tab=integrations',
        businessId,
        teamId: typeof biz.defaultTeamId === 'string' ? biz.defaultTeamId : null,
      }).catch((err: any) => console.error('[tenant-secrets] owner notification failed:', err?.message || err));
    }

    const flags = Object.fromEntries(
      [...result.written, ...result.cleared]
        .map((f) => [SECRET_FLAGS[f], result.written.includes(f)])
        .filter(([k]) => !!k),
    );
    return res.status(200).json({ success: true, businessId, ...result, flags });
  } catch (err: any) {
    console.error('[tenant-secrets] write failed:', err?.message || err);
    return res.status(500).json({ error: 'Could not store credentials' });
  }
}

const REQUEST_COOLDOWN_MS = 10 * 60 * 1000;

/**
 * POST { action: 'request-change', field?, note? } — an Owner/Admin/Manager of the
 * caller's OWN tenant (`bid` claim) asks the platform to set/rotate a credential.
 * Notifies every super-admin with a deep link to the tenant page. One request per
 * tenant per 10 minutes (stamp claimed in a transaction before any send).
 */
async function requestChange(req: VercelRequest, res: VercelResponse, decoded: admin.auth.DecodedIdToken) {
  const c = identityFromToken(decoded);
  if (!c.bid || !hasManagerRole(c.roles)) {
    return res.status(403).json({ error: 'Vetëm pronari ose administratori i biznesit mund të kërkojë ndryshim.' });
  }
  const body = (req.body || {}) as Record<string, any>;
  const field = typeof body.field === 'string' && (SECRET_FIELDS as readonly string[]).includes(body.field) ? body.field : null;
  const note = typeof body.note === 'string' ? body.note.replace(/[\r\n]+/g, ' ').trim().slice(0, 300) : '';

  const ref = db.collection('businesses').doc(c.bid);
  const claimed = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const b = snap.exists ? (snap.data() as any) : {};
    const last = b.credentialsChangeRequestedAt?.toMillis?.() ?? 0;
    if (Date.now() - last < REQUEST_COOLDOWN_MS) return null;
    tx.set(ref, {
      credentialsChangeRequestedAt: admin.firestore.Timestamp.now(),
      credentialsChangeRequest: { field, note: note || null, byUid: c.uid, byEmail: c.email || null },
    }, { merge: true });
    return { name: String(b.name || c.bid) };
  });
  if (!claimed) return res.status(429).json({ error: 'Kërkesa u dërgua pak më parë. FivoCRM do t’ju kontaktojë.' });

  const what = field ? FIELD_LABELS[field] || field : 'kredencialet';
  for (const adminEmail of superAdminEmails()) {
    let target: { uid: string };
    try { target = await adminAuth.getUserByEmail(adminEmail); } catch { continue; }
    const own = await resolveTenantClaims(target.uid, adminEmail).catch(() => null);
    await notifyUser({
      userId: target.uid,
      type: 'credentials_change_requested',
      title: `Kërkesë për kredenciale: ${claimed.name}`,
      message: `${c.email || 'Një administrator'} kërkon ndryshim për ${what}${note ? ` — "${note}"` : ''}.`,
      actionUrl: `/superadmin/tenants/${c.bid}`,
      businessId: own?.bid || null,
      teamId: own?.tid || null,
    }).catch((err: any) => console.error('[tenant-secrets] request notification failed:', err?.message || err));
  }
  await writeAudit({
    businessId: c.bid,
    actorUid: c.uid,
    actorEmail: c.email || null,
    action: 'secrets.change_requested',
    target: `business:${c.bid}`,
    meta: { field },
  });
  return res.status(200).json({ success: true });
}
