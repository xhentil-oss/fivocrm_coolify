import type { VercelRequest, VercelResponse } from '@vercel/node';
import admin, { adminAuth, adminDb as db } from './_firebaseAdmin.js';
import { resolveTenantClaims, superAdminEmails, syncTenantClaims, type TenantClaims } from './_tenantClaims.js';
import { writeAudit } from './_audit.js';
import { verifiedEmail } from './_callerIdentity.js';
import { notifyUser } from './_push.js';

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
/**
 * A self-serve workspace is born with every optional module LOCKED and
 * `businesses.moduleSetup: 'pending'` (src/lib/createTenant.ts): which modules the
 * tenant gets is the PLATFORM's decision, made in the console's ModuleAccessEditor.
 * Nobody would know a tenant is waiting unless someone is told, so the one server
 * call the signup makes (this endpoint, right after the business doc exists) claims
 * `moduleSetupNotifiedAt` in a transaction and notifies every super-admin with a
 * deep link to the tenant page. Idempotent: the stamp is written before any send,
 * and `set-modules` is what clears `pending`.
 */
async function announcePendingModuleSetup(claims: TenantClaims, uid: string): Promise<void> {
  if (!claims.bid || !claims.roles.includes('owner')) return;
  const ref = db.collection('businesses').doc(claims.bid);
  const pending = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const b = snap.data() as Record<string, any>;
    if (b.moduleSetup !== 'pending' || b.moduleSetupNotifiedAt || b.ownerId !== uid) return null;
    tx.update(ref, { moduleSetupNotifiedAt: admin.firestore.Timestamp.now() });
    return { name: String(b.name || claims.bid), ownerEmail: String(b.ownerEmail || '') };
  });
  if (!pending) return;

  const admins = superAdminEmails();
  if (admins.length === 0) {
    console.error('[sync-claims] tenant waiting for module setup but SUPER_ADMIN_EMAILS is empty', { businessId: claims.bid });
    return;
  }
  for (const adminEmail of admins) {
    let target: { uid: string };
    try {
      target = await adminAuth.getUserByEmail(adminEmail);
    } catch {
      continue; // listed, never signed up — nothing to notify
    }
    // The bell is tenant-scoped: the row must carry the SUPER-ADMIN's own business,
    // not the newcomer's, or it would never show in their workspace.
    const own = await resolveTenantClaims(target.uid, adminEmail).catch(() => null);
    await notifyUser({
      userId: target.uid,
      type: 'platform_tenant_signup',
      title: `Tenant i ri: ${pending.name}`,
      message: `${pending.ownerEmail || 'Një pronar'} krijoi workspace-in "${pending.name}". Të gjitha modulet janë të kyçura — hap ato të kontratës nga konsola.`,
      actionUrl: `/superadmin/tenants/${claims.bid}`,
      businessId: own?.bid || null,
      teamId: own?.tid || null,
    }).catch((err: any) => console.error('[sync-claims] platform_tenant_signup notification failed:', err?.message || err));
  }
}

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

  const body = (req.body || {}) as { teamId?: unknown; businessId?: unknown; endImpersonation?: unknown };
  const preferTeamId = typeof body.teamId === 'string' && body.teamId ? body.teamId : null;
  const wantedBusinessId = typeof body.businessId === 'string' && body.businessId ? body.businessId : null;

  // Impersonation is a super-admin-only capability and is always audited.
  const isSuper = decoded.superAdmin === true;
  const preferBusinessId = isSuper ? wantedBusinessId : null;
  if (wantedBusinessId && !isSuper) {
    return res.status(403).json({ error: 'Only a platform super-admin may switch business context.' });
  }

  // Leaving a tenant is as interesting as entering one: without this the audit trail
  // shows an operator walking into a customer's workspace and never coming out.
  const endingImpersonation = body.endImpersonation === true;

  // An unverified email is not identity: the resolver re-checks it against the Auth
  // record anyway, but the hint (and the audit trail) must not carry a self-declared address.
  const email = verifiedEmail(decoded);

  try {
    const claims = await syncTenantClaims(decoded.uid, email, { preferTeamId, preferBusinessId });

    // A self-serve signup's only server hop (createTenant.ts step 6): if this owner's
    // business is still waiting for the platform to open its modules, tell the
    // super-admins — once. Never fails the claims sync.
    await announcePendingModuleSetup(claims, decoded.uid).catch((err: any) => {
      console.error('[sync-claims] pending-module announcement failed:', err?.message || err);
    });

    if (endingImpersonation) {
      await writeAudit({
        // The business being LEFT is what matters for that tenant's trail.
        businessId: (typeof body.businessId === 'string' && body.businessId) || null,
        actorUid: decoded.uid,
        actorEmail: email,
        action: 'claims.impersonate_end',
        target: 'business:left',
        meta: { backTo: claims.bid || null },
      });
    }

    if (preferBusinessId) {
      await writeAudit({
        businessId: preferBusinessId,
        actorUid: decoded.uid,
        actorEmail: email,
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
