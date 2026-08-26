import type { VercelRequest, VercelResponse } from '@vercel/node';
import admin, { adminAuth, adminDb as db } from './_firebaseAdmin.js';
import { syncTenantClaims } from './_tenantClaims.js';
import { writeAudit } from './_audit.js';
import { seatsForPlan } from './_billingPlans.js';

/**
 * POST /api/accept-invite
 * Body: { token: string }
 * Header: Authorization: Bearer <Firebase ID token>
 *
 * Server-side (Admin SDK) invite acceptance. This exists so that the
 * `teamMembers` create rule can be locked to the team owner only — the ONE
 * legitimate non-owner membership creation (accepting an invite) is validated
 * and performed here, where we can enforce token + email match. A client can no
 * longer self-insert a `teamMembers` doc into a victim tenant as Admin.
 *
 * Security invariants enforced here:
 *  - The caller's verified email MUST equal the invite's target email (blocks
 *    accepting someone else's Admin invite).
 *  - The invite must be Pending and unexpired.
 *  - The invite's PROVENANCE is verified: it must have been created by someone who
 *    is (still) an owner/Admin/Manager of that team. Without this, `teamInvites`
 *    being client-creatable meant anyone could forge an invite for their own email
 *    into ANY team and have this endpoint hand them an Admin membership — a full
 *    cross-tenant takeover. A Manager may not mint an Admin.
 *  - The membership is written with a DETERMINISTIC id `{teamId}_{uid}` so the
 *    hardened Firestore rules can validate tenant keys via exists().
 *  - The tenant keys on users/{uid} are written by the Admin SDK (server), never
 *    trusted from the client, and mirrored into custom claims (bid/tid/roles) so
 *    rules never have to trust a client-written document.
 */

/** Resolve an actor's authority over a team: 'owner' | 'Admin' | 'Manager' | null. */
async function teamAuthority(teamId: string, uid: string | null | undefined): Promise<string | null> {
  if (!uid) return null;
  try {
    const teamSnap = await db.collection('teams').doc(teamId).get();
    if (teamSnap.exists && (teamSnap.data() as any)?.createdByUserId === uid) return 'owner';
  } catch { /* fall through to membership */ }
  try {
    const direct = await db.collection('teamMembers').doc(`${teamId}_${uid}`).get();
    const m = direct.exists ? (direct.data() as any) : null;
    if (m && m.status !== 'Inactive') return m.role || null;
    // Legacy random-id membership.
    const legacy = await db.collection('teamMembers')
      .where('teamId', '==', teamId).where('userId', '==', uid).limit(1).get();
    if (!legacy.empty) {
      const l = legacy.docs[0].data() as any;
      if (l.status !== 'Inactive') return l.role || null;
    }
  } catch { /* no authority */ }
  return null;
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

  const { token } = req.body || {};
  if (!token || typeof token !== 'string') return res.status(400).json({ error: 'Missing token' });

  const callerEmail = (decoded.email || '').toLowerCase();
  if (!callerEmail) return res.status(403).json({ error: 'Account has no verified email' });

  // Look up the invite by token.
  const inviteSnap = await db.collection('teamInvites').where('token', '==', token).limit(1).get();
  if (inviteSnap.empty) return res.status(404).json({ error: 'Ftesa nuk u gjet.' });
  const inviteDoc = inviteSnap.docs[0];
  const invite = inviteDoc.data() as any;

  if (invite.status === 'Accepted') return res.status(409).json({ error: 'Kjo ftesë është pranuar tashmë.' });
  if (invite.status === 'Cancelled') return res.status(409).json({ error: 'Kjo ftesë është anuluar.' });

  // Expiry check.
  const expiresAt: Date | null = invite.expiresAt?.toDate
    ? invite.expiresAt.toDate()
    : (invite.expiresAt ? new Date(invite.expiresAt) : null);
  if (!expiresAt || expiresAt.getTime() < Date.now()) {
    return res.status(410).json({ error: 'Kjo ftesë ka skaduar.' });
  }

  // HARD email match — the caller must be the invited person. (JoinInviteView
  // previously only *warned* on a mismatch; enforcement now lives here.)
  if ((invite.email || '').toLowerCase() !== callerEmail) {
    return res.status(403).json({ error: 'Kjo ftesë i përket një adrese tjetër email.' });
  }

  const teamId: string = invite.teamId;
  if (!teamId) return res.status(422).json({ error: 'Invite has no teamId' });

  // ── PROVENANCE: the invite must come from someone with authority over the team.
  // `teamInvites` is client-creatable, so without this check a forged invite for
  // the attacker's own email would mint them a membership in any tenant.
  const inviterUid: string | null = invite.invitedByUserId || invite.createdByUserId || null;
  const inviterAuthority = await teamAuthority(teamId, inviterUid);
  if (!inviterAuthority || !['owner', 'Admin', 'Manager'].includes(inviterAuthority)) {
    return res.status(403).json({ error: 'Ftesa nuk është e vlefshme (nuk u lëshua nga një administrator i ekipit).' });
  }
  // A Manager may not mint an Admin (no silent privilege escalation via invite).
  const requestedRole: string = invite.role || 'Member';
  if (inviterAuthority === 'Manager' && requestedRole === 'Admin') {
    return res.status(403).json({ error: 'Ftesa kërkon rol Admin, por lëshuesi nuk ka të drejtë të caktojë Admin.' });
  }

  // Resolve the tenant (businessId) from the team doc; the team is the child of a
  // business, so the membership's tenant key comes from there — never from the invite.
  let businessId: string = teamId;
  try {
    const teamSnap = await db.collection('teams').doc(teamId).get();
    if (teamSnap.exists && (teamSnap.data() as any)?.businessId) businessId = (teamSnap.data() as any).businessId;
  } catch { /* fall back to teamId */ }

  const uid = decoded.uid;
  const now = admin.firestore.Timestamp.now();

  // ── SEAT LIMIT: the plan the tenant pays for decides how many people can join.
  // Enforced here (server-side) because the client cannot be trusted to count, and
  // because this endpoint is the ONLY path that creates a membership.
  try {
    const bizSnap = await db.collection('businesses').doc(businessId).get();
    const biz = bizSnap.exists ? (bizSnap.data() as any) : null;
    if (biz) {
      if (biz.status === 'suspended') {
        return res.status(402).json({ error: 'Hapësira është e pezulluar. Aktivizo abonimin për të shtuar anëtarë.' });
      }
      const seatCap = (biz.limits?.seats as number) || (biz.seats as number) || seatsForPlan(biz.plan);
      const membersSnap = await db.collection('teamMembers').where('businessId', '==', businessId).get();
      const activeUids = new Set<string>();
      membersSnap.forEach((d) => {
        const m = d.data() as any;
        if (m.status !== 'Inactive' && m.userId) activeUids.add(m.userId);
      });
      // Re-accepting an existing membership must never be blocked by the cap.
      if (!activeUids.has(uid) && activeUids.size >= seatCap) {
        return res.status(402).json({
          error: `Plani aktual përfshin ${seatCap} vende dhe të gjitha janë të zëna. Përmirëso planin për të shtuar anëtarë.`,
          code: 'seat_limit_reached',
          seats: seatCap,
        });
      }
    }
  } catch (err: any) {
    console.error('[accept-invite] seat check failed:', err?.message || err);
    // Fail CLOSED on an unexpected error: better to ask the user to retry than to
    // silently hand out a seat the tenant has not paid for.
    return res.status(500).json({ error: 'Kontrolli i vendeve dështoi. Provo përsëri.' });
  }

  // Deterministic membership id so hardened rules can validate via exists().
  const memberRef = db.collection('teamMembers').doc(`${teamId}_${uid}`);
  const existing = await memberRef.get();

  if (!existing.exists) {
    // Also guard against a legacy random-id membership for the same (team,user).
    const legacy = await db.collection('teamMembers')
      .where('userId', '==', uid).where('teamId', '==', teamId).limit(1).get();
    if (legacy.empty) {
      await memberRef.set({
        userId: uid,
        email: callerEmail || invite.email || '',
        displayName: decoded.name || (callerEmail ? callerEmail.split('@')[0] : ''),
        teamId,
        businessId,
        role: invite.role || 'Member',
        canAccessProjects: invite.canAccessProjects ?? false,
        canAccessTasks: invite.canAccessTasks ?? false,
        canAccessCRM: invite.canAccessCRM ?? false,
        canAccessInvoices: invite.canAccessInvoices ?? false,
        canAccessReports: invite.canAccessReports ?? false,
        canAccessSettings: invite.canAccessSettings ?? false,
        canAccessGoals: invite.canAccessGoals ?? false,
        canAccessTeams: invite.canAccessTeams ?? false,
        canAccessChat: invite.canAccessChat ?? false,
        canAccessCustomers: invite.canAccessCustomers ?? false,
        canAccessServices: invite.canAccessServices ?? false,
        canAccessExpenses: invite.canAccessExpenses ?? false,
        canAccessProfile: invite.canAccessProfile ?? false,
        // Capability, not a module gate — carried across so an invite that
        // granted "may assign work to colleagues" still means that after accept.
        canAssignTasks: invite.canAssignTasks ?? false,
        invitedByUserId: invite.invitedByUserId || null,
        invitedAt: now,
        status: 'Active',
        createdAt: now,
        updatedAt: now,
        createdByUserId: uid,
      });
    }
  }

  // Keep the console's denormalised member count fresh without waiting for the daily
  // rollup (it is recomputed there, so an increment can never drift permanently).
  try {
    await db.collection('businesses').doc(businessId).set({
      memberCount: admin.firestore.FieldValue.increment(1),
      updatedAt: now,
    }, { merge: true });
  } catch { /* non-critical: the rollup reconciles it */ }

  // Mark the invite accepted (idempotent).
  await inviteDoc.ref.update({
    status: 'Accepted',
    acceptedByUserId: uid,
    acceptedAt: now,
    updatedAt: now,
  }).catch(() => {});

  // Server-authoritative tenant keys on the user doc (Admin SDK bypasses rules).
  await db.collection('users').doc(uid).set(
    { teamId, businessId, updatedAt: now },
    { merge: true },
  ).catch(() => {});

  // Ensure a userProfile exists (so the member appears in @mentions). Stamped with
  // the tenant keys so the directory can be business-scoped like everything else.
  try {
    const profiles = await db.collection('userProfiles').where('userId', '==', uid).limit(1).get();
    if (profiles.empty) {
      await db.collection('userProfiles').add({
        userId: uid,
        displayName: decoded.name || (callerEmail ? callerEmail.split('@')[0] : ''),
        teamId,
        businessId,
        createdAt: now,
        updatedAt: now,
        createdByUserId: uid,
      });
    } else {
      await profiles.docs[0].ref.set({ teamId, businessId, updatedAt: now }, { merge: true });
    }
  } catch { /* best-effort */ }

  // Server-signed tenant identity (bid/tid/roles) — the client refreshes its ID
  // token right after, so Firestore rules stop depending on a client-written doc.
  try {
    await syncTenantClaims(uid, callerEmail, { preferTeamId: teamId });
  } catch { /* the users/{uid} fallback path still works */ }

  await writeAudit({
    businessId,
    actorUid: uid,
    actorEmail: callerEmail,
    action: 'invite.accept',
    target: `team:${teamId}`,
    meta: { role: requestedRole, invitedBy: inviterUid, inviterAuthority },
  });

  return res.status(200).json({
    success: true,
    teamId,
    teamName: invite.teamName || 'Ekip',
    role: invite.role || 'Member',
  });
}
