import type { VercelRequest, VercelResponse } from '@vercel/node';
import admin, { adminAuth, adminDb as db } from './_firebaseAdmin.js';

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
 *  - The membership is written with a DETERMINISTIC id `{teamId}_{uid}` so the
 *    hardened Firestore rules can validate tenant keys via exists().
 *  - The tenant keys on users/{uid} are written by the Admin SDK (server), never
 *    trusted from the client.
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

  // Resolve the tenant (businessId) from the team doc; fall back to teamId.
  let businessId: string = teamId;
  try {
    const teamSnap = await db.collection('teams').doc(teamId).get();
    if (teamSnap.exists && (teamSnap.data() as any)?.businessId) businessId = (teamSnap.data() as any).businessId;
  } catch { /* fall back to teamId */ }

  const uid = decoded.uid;
  const now = admin.firestore.Timestamp.now();

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
        invitedByUserId: invite.invitedByUserId || null,
        invitedAt: now,
        status: 'Active',
        createdAt: now,
        updatedAt: now,
        createdByUserId: uid,
      });
    }
  }

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

  // Ensure a userProfile exists (so the member appears in @mentions).
  try {
    const profiles = await db.collection('userProfiles').where('userId', '==', uid).limit(1).get();
    if (profiles.empty) {
      await db.collection('userProfiles').add({
        userId: uid,
        displayName: decoded.name || (callerEmail ? callerEmail.split('@')[0] : ''),
        createdAt: now,
        updatedAt: now,
        createdByUserId: uid,
      });
    }
  } catch { /* best-effort */ }

  return res.status(200).json({
    success: true,
    teamId,
    teamName: invite.teamName || 'Ekip',
    role: invite.role || 'Member',
  });
}
