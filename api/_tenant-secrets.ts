import type { VercelRequest, VercelResponse } from '@vercel/node';
import admin, { adminAuth, adminDb as db } from './_firebaseAdmin.js';
import { SECRET_FIELDS, SECRET_FLAGS, writeTeamSecrets } from './_tenantConfig.js';
import { writeAudit } from './_audit.js';

/**
 * POST /api/tenant-secrets
 * Header: Authorization: Bearer <Firebase ID token>
 * Body: { teamId, secrets: { aiApiKey?, emailApiKey?, emailSmtpPass?,
 *         whatsappVpsSecret?, metaWebhookVerifyToken?, metaChannelTokens? } }
 *
 * The ONLY way a client can set tenant credentials. `teamSecrets` is
 * `read, write: if false` in Firestore rules, so credentials never travel to
 * another user's browser — the UI only ever sees `has*` booleans.
 *
 * Authorization: the caller must be the team owner or an Admin/Manager of that team.
 * An empty string clears a credential.
 */
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

  const { teamId, secrets } = (req.body || {}) as { teamId?: string; secrets?: Record<string, any> };
  if (!teamId || typeof teamId !== 'string') return res.status(400).json({ error: 'Missing teamId' });
  if (!secrets || typeof secrets !== 'object') return res.status(400).json({ error: 'Missing secrets' });

  // ── authorize: owner or Admin/Manager of THIS team (super-admin may manage any) ──
  let authorized = decoded.superAdmin === true;
  let businessId: string | null = null;
  try {
    const teamSnap = await db.collection('teams').doc(teamId).get();
    if (!teamSnap.exists) return res.status(404).json({ error: 'Team not found' });
    const team = teamSnap.data() as any;
    businessId = team.businessId || teamId;
    if (team.createdByUserId === decoded.uid) authorized = true;
    if (!authorized) {
      const direct = await db.collection('teamMembers').doc(`${teamId}_${decoded.uid}`).get();
      const m = direct.exists ? (direct.data() as any) : null;
      if (m && m.status !== 'Inactive' && ['Admin', 'Manager'].includes(m.role)) authorized = true;
      if (!authorized) {
        const legacy = await db.collection('teamMembers')
          .where('teamId', '==', teamId).where('userId', '==', decoded.uid).limit(1).get();
        const l = legacy.empty ? null : (legacy.docs[0].data() as any);
        if (l && l.status !== 'Inactive' && ['Admin', 'Manager'].includes(l.role)) authorized = true;
      }
    }
  } catch {
    return res.status(500).json({ error: 'Authorization check failed' });
  }
  if (!authorized) return res.status(403).json({ error: 'Vetëm administratori i ekipit mund të ruajë kredencialet.' });

  // Only known credential fields are accepted (no arbitrary writes into the vault).
  const filtered: Record<string, any> = {};
  for (const field of SECRET_FIELDS) {
    if (field in secrets) filtered[field] = secrets[field];
  }
  if (Object.keys(filtered).length === 0) {
    return res.status(400).json({ error: `No known secret fields. Allowed: ${SECRET_FIELDS.join(', ')}` });
  }

  try {
    const result = await writeTeamSecrets(teamId, filtered);
    await writeAudit({
      businessId,
      actorUid: decoded.uid,
      actorEmail: decoded.email || null,
      action: 'secrets.update',
      target: `team:${teamId}`,
      // Field NAMES only — never values.
      meta: { set: result.written, cleared: result.cleared },
    });
    const flags = Object.fromEntries(
      [...result.written, ...result.cleared]
        .map((f) => [SECRET_FLAGS[f], result.written.includes(f)])
        .filter(([k]) => !!k),
    );
    return res.status(200).json({ success: true, ...result, flags });
  } catch (err: any) {
    console.error('[tenant-secrets] write failed:', err?.message || err);
    return res.status(500).json({ error: 'Could not store credentials' });
  }
}
