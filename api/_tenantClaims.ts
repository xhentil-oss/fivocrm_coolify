import { adminAuth, adminDb as db } from './_firebaseAdmin.js';

/**
 * Server-authoritative tenant identity, materialised into Firebase Auth custom
 * claims.
 *
 * WHY: Firestore rules previously decided tenant membership by reading
 * `users/{uid}.businessId` — a document the client can write. That was patched by
 * validating the write against a real membership, but it still costs a `get()` per
 * rule evaluation (billed as a read, and capped at 10 per request), and it keeps
 * the tenant boundary dependent on app-written data.
 *
 * With claims, the boundary is a signed token issued by the server:
 *
 *   { bid, tid, roles[], cid, superAdmin }
 *
 *   bid   — businessId: THE tenant isolation key
 *   tid   — teamId: the department (sub-group) INSIDE that business
 *   roles — lowercased authority markers: 'owner' | 'admin' | 'manager' | 'member' | …
 *   cid   — customerId for portal clients (never set for staff)
 *   superAdmin — platform console (Relax CRM) access
 *
 * A team ALWAYS belongs to exactly one business, so `tid` is only ever meaningful
 * together with `bid`; the resolver derives `bid` from the team, never the reverse.
 */

export interface TenantClaims {
  /** businessId — STAFF membership only. Never set for a portal client. */
  bid: string | null;
  tid: string | null;
  roles: string[];
  /** customerId — portal clients only. */
  cid: string | null;
  /**
   * Portal client's tenant. Deliberately a SEPARATE claim from `bid`: rules treat
   * `bid` as proof of staff membership, so giving a client `bid` would promote them
   * to staff of that business (read access to expenses, salaries, reports).
   */
  pbid: string | null;
  superAdmin: boolean;
}

/** Role priority — lower index wins when a user belongs to several teams. */
const ROLE_ORDER = ['Admin', 'Manager', 'Sales', 'SalesAgent', 'Member', 'Viewer', 'Guest'];

function rolePriority(role?: string): number {
  const i = ROLE_ORDER.indexOf(role || '');
  return i === -1 ? 99 : i;
}

function superAdminEmails(): string[] {
  const raw = process.env.SUPER_ADMIN_EMAILS || process.env.VITE_SUPER_ADMIN_EMAILS || '';
  return raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

/** Resolve the businessId a team belongs to (the tenant of that department). */
export async function businessOfTeam(teamId: string): Promise<string> {
  try {
    const snap = await db.collection('teams').doc(teamId).get();
    const bid = snap.exists ? (snap.data() as any)?.businessId : null;
    if (bid) return bid;
  } catch { /* fall through */ }
  // Legacy team with no business layer yet: the team id doubles as the tenant key.
  return teamId;
}

const ADMIN_MEMBERSHIP_ROLES = new Set(['Admin', 'Owner', 'SuperAdmin']);

/**
 * Compute the tenant claims for a user from AUTHORITATIVE server data
 * (memberships + business ownership + portal access). Never trusts client input
 * beyond an optional `preferTeamId`, which must still resolve to a membership.
 *
 * Identity rules (audit Sep 2026):
 *  - The email used for the legacy by-email membership match and for the
 *    super-admin list is the Auth record's email, and only when Firebase says it
 *    is VERIFIED. The `email` argument is a hint that must agree with it; an
 *    unverified or disagreeing address is treated as absent.
 *  - `bid` comes from the TEAM document (`teams/{tid}.businessId`, immutable by
 *    the rules), never from the membership row. A disagreeing membership is
 *    logged and the team's value wins.
 *  - A team the user CREATED grants Admin/owner authority ONLY when the user is
 *    `businesses/{bid}.ownerId` of that team's business, or already holds an
 *    Admin/Owner membership there. Otherwise the ownership is ignored: an owned
 *    team must never raise a Member above their membership role (before this, any
 *    `teams` doc with `createdByUserId == uid` minted `roles: ['admin','owner']`
 *    and let `preferTeamId` switch into it).
 */
export async function resolveTenantClaims(
  uid: string,
  email?: string | null,
  opts?: { preferTeamId?: string | null; preferBusinessId?: string | null },
): Promise<TenantClaims> {
  // ── verified identity ──
  let lowerEmail = '';
  try {
    const authUser = await adminAuth.getUser(uid);
    const authEmail = (authUser.email || '').toLowerCase();
    if (authUser.emailVerified && authEmail) lowerEmail = authEmail;
  } catch { /* no auth record → no email identity */ }
  const hint = (email || '').toLowerCase();
  if (hint && lowerEmail && hint !== lowerEmail) {
    console.warn('[tenantClaims] email hint disagrees with the verified Auth email; using Auth', { uid });
  }
  const isSuper = !!lowerEmail && superAdminEmails().includes(lowerEmail);

  // ── memberships (by uid, plus a legacy by-VERIFIED-email fallback) ──
  const memberships: any[] = [];
  try {
    const byUid = await db.collection('teamMembers').where('userId', '==', uid).get();
    byUid.forEach((d) => memberships.push({ id: d.id, ...(d.data() as any) }));
  } catch { /* ignore */ }
  if (lowerEmail) {
    try {
      const byEmail = await db.collection('teamMembers').where('email', '==', lowerEmail).get();
      byEmail.forEach((d) => {
        if (!memberships.some((m) => m.id === d.id)) memberships.push({ id: d.id, ...(d.data() as any) });
      });
    } catch { /* ignore */ }
  }
  const active = memberships.filter((m) => m.status !== 'Inactive' && m.teamId);

  // Team → business, from the TEAM document (cached per call).
  const teamBusinessCache = new Map<string, string>();
  const bidOfTeam = async (teamId: string): Promise<string> => {
    const cached = teamBusinessCache.get(teamId);
    if (cached) return cached;
    const bid = await businessOfTeam(teamId);
    teamBusinessCache.set(teamId, bid);
    return bid;
  };

  // ── owned teams, honoured only with real authority over their business ──
  const ownedTeams: { id: string; businessId: string }[] = [];
  try {
    const owned = await db.collection('teams').where('createdByUserId', '==', uid).get();
    for (const d of owned.docs) {
      const t = d.data() as any;
      const teamBid: string = (typeof t.businessId === 'string' && t.businessId) || d.id;
      teamBusinessCache.set(d.id, teamBid);
      let authoritative = active.some((m) => ADMIN_MEMBERSHIP_ROLES.has(String(m.role || ''))
        && (m.businessId === teamBid || m.teamId === d.id));
      if (!authoritative) {
        try {
          const biz = await db.collection('businesses').doc(teamBid).get();
          authoritative = biz.exists && (biz.data() as any)?.ownerId === uid;
        } catch { /* not authoritative */ }
      }
      if (authoritative) ownedTeams.push({ id: d.id, businessId: teamBid });
    }
  } catch { /* ignore */ }

  // ── pick the active team ──
  let chosen: { teamId: string; role?: string } | null = null;
  if (opts?.preferTeamId) {
    const wanted = opts.preferTeamId;
    const m = active.find((x) => x.teamId === wanted);
    if (m) chosen = { teamId: wanted, role: m.role };
    else if (ownedTeams.some((t) => t.id === wanted)) chosen = { teamId: wanted, role: 'Admin' };
  }
  if (!chosen && active.length) {
    const best = [...active].sort((a, b) => rolePriority(a.role) - rolePriority(b.role))[0];
    chosen = { teamId: best.teamId, role: best.role };
  }
  if (!chosen && ownedTeams.length) {
    chosen = { teamId: ownedTeams[0].id, role: 'Admin' };
  }

  let tid: string | null = chosen?.teamId || null;
  let bid: string | null = null;
  if (tid) {
    bid = await bidOfTeam(tid);
    const membership = active.find((m) => m.teamId === tid);
    if (membership?.businessId && membership.businessId !== bid) {
      console.warn('[tenantClaims] membership.businessId disagrees with teams/{tid}.businessId; using the team', {
        uid, tid, membershipBusinessId: membership.businessId, teamBusinessId: bid,
      });
    }
  }

  const roles: string[] = [];
  if (chosen?.role) roles.push(String(chosen.role).toLowerCase());
  if (tid && ownedTeams.some((t) => t.id === tid)) {
    if (!roles.includes('owner')) roles.push('owner');
    if (!roles.includes('admin')) roles.push('admin');
  }

  // Super-admin impersonation ("view as tenant") — only ever honored for a real
  // super-admin, and audited by the caller.
  if (isSuper && opts?.preferBusinessId) {
    const target = opts.preferBusinessId;
    if (bid !== target) {
      // `tid` must live inside `bid`. Left alone it would still point at the
      // operator's OWN department, so a team-scoped rule would authorize against
      // the wrong tenant while the rest of the app reads the visited one. Keep the
      // requested team only when it genuinely belongs to the target business.
      const wanted = opts.preferTeamId || null;
      tid = wanted && (await bidOfTeam(wanted)) === target ? wanted : null;
    }
    bid = target;
  }

  // ── portal client identity ──
  let cid: string | null = null;
  try {
    const u = await db.collection('users').doc(uid).get();
    const fromUser = u.exists ? (u.data() as any)?.customerId : null;
    if (fromUser) cid = fromUser;
  } catch { /* ignore */ }
  if (!cid) {
    try {
      const pa = await db.collection('clientPortalAccess').where('userId', '==', uid).limit(5).get();
      const authEmail = lowerEmail; // verified Auth email, '' when unverified
      for (const d of pa.docs) {
        const a = d.data() as any;
        if (a.status !== 'Active' || !a.customerId) continue;
        // A row the CLIENT created for themselves (portal bootstrap) is only proof of
        // identity when the customer it points at carries the same address as the
        // Auth account — the rules now require a verified email for such a create, but
        // rows written before that (or by a spoofed bootstrap) must not mint `cid` for
        // somebody else's customer. Staff-created rows are trusted as written.
        if (a.createdByUserId === uid) {
          const c = await db.collection('customers').doc(String(a.customerId)).get();
          const cEmail = String((c.data() as any)?.email || '').toLowerCase();
          const rowEmail = String(a.email || '').toLowerCase();
          const authRecordEmail = authEmail || (await adminAuth.getUser(uid).then((u) => (u.email || '').toLowerCase()).catch(() => ''));
          if (!c.exists || !cEmail || cEmail !== authRecordEmail || (rowEmail && rowEmail !== cEmail)) {
            console.warn('[tenantClaims] self-created clientPortalAccess row does not corroborate the customer email; ignored', { uid, access: d.id });
            continue;
          }
        }
        cid = a.customerId;
        break;
      }
    } catch { /* ignore */ }
  }
  // A portal client's tenant goes into `pbid`, NOT `bid`: `bid` is the staff
  // membership proof in Firestore rules, and a client is not staff.
  let pbid: string | null = null;
  if (cid) {
    try {
      const c = await db.collection('customers').doc(cid).get();
      const cBid = c.exists ? (c.data() as any)?.businessId : null;
      if (cBid) pbid = cBid;
    } catch { /* ignore */ }
  }

  return { bid: bid || null, tid: tid || null, roles, cid: cid || null, pbid, superAdmin: isSuper };
}

/**
 * Write the claims onto the Auth user, preserving any unrelated custom claims.
 * Returns the claims actually applied. Callers should have the client refresh its
 * ID token (`getIdToken(true)`) afterwards.
 */
export async function applyTenantClaims(uid: string, claims: TenantClaims): Promise<TenantClaims> {
  const user = await adminAuth.getUser(uid);
  const existing: Record<string, any> = { ...(user.customClaims || {}) };

  const next: Record<string, any> = { ...existing };
  if (claims.bid) next.bid = claims.bid; else delete next.bid;
  if (claims.tid) next.tid = claims.tid; else delete next.tid;
  if (claims.roles.length) next.roles = claims.roles; else delete next.roles;
  if (claims.cid) next.cid = claims.cid; else delete next.cid;
  if (claims.pbid) next.pbid = claims.pbid; else delete next.pbid;
  // superAdmin stays sticky: it is granted out-of-band (scripts/set-super-admin-claims.cjs
  // or the env list) and must never be dropped by a routine resync.
  if (claims.superAdmin) next.superAdmin = true;

  const changed = JSON.stringify(next) !== JSON.stringify(existing);
  if (changed) await adminAuth.setCustomUserClaims(uid, next);
  return claims;
}

/** Resolve + apply in one step (used by accept-invite, tenant signup, /api/sync-claims). */
export async function syncTenantClaims(
  uid: string,
  email?: string | null,
  opts?: { preferTeamId?: string | null; preferBusinessId?: string | null },
): Promise<TenantClaims> {
  const claims = await resolveTenantClaims(uid, email, opts);
  return applyTenantClaims(uid, claims);
}
