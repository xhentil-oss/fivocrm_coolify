import type { VercelRequest, VercelResponse } from '@vercel/node';
import admin, { adminAuth } from './_firebaseAdmin.js';
import { syncTenantClaims } from './_tenantClaims.js';
import { writeAudit } from './_audit.js';

/**
 * POST /api/sync-claims
 * Header: Authorization: Bearer <Firebase ID token>
 * Body (optional): { teamId?: string, businessId?: string }
 *
 * Materialises the caller's tenant identity into custom claims (bid/tid/roles/cid)
 * from authoritative server data. The client calls this when its resolved tenant
 * differs from what its ID token carries, then refreshes the token.
 *
 *  - `teamId`  → switch the active department. Honored ONLY if the caller really is
 *                a member (or owner) of that team; otherwise the resolver ignores it.
 *  - `businessId` → super-admin "view as tenant". Honored ONLY for a super-admin and
 *                always written to the audit trail.
 *
 * Nothing here trusts the request body for authorization: every value is
 * re-derived from Firestore/Auth before it is signed into the token.
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

  const body = (req.body || {}) as { teamId?: unknown; businessId?: unknown };
  const preferTeamId = typeof body.teamId === 'string' && body.teamId ? body.teamId : null;
  const wantedBusinessId = typeof body.businessId === 'string' && body.businessId ? body.businessId : null;

  // Impersonation is a super-admin-only capability and is always audited.
  const isSuper = decoded.superAdmin === true;
  const preferBusinessId = isSuper ? wantedBusinessId : null;
  if (wantedBusinessId && !isSuper) {
    return res.status(403).json({ error: 'Only a platform super-admin may switch business context.' });
  }

  try {
    const claims = await syncTenantClaims(decoded.uid, decoded.email, { preferTeamId, preferBusinessId });

    if (preferBusinessId) {
      await writeAudit({
        businessId: preferBusinessId,
        actorUid: decoded.uid,
        actorEmail: decoded.email || null,
        action: 'claims.impersonate',
        target: `business:${preferBusinessId}`,
      });
    }

    return res.status(200).json({ success: true, claims });
  } catch (err: any) {
    console.error('[sync-claims] failed:', err?.message || err);
    return res.status(500).json({ error: 'Could not sync tenant claims' });
  }
}
