import crypto from 'crypto';
import type { VercelRequest } from '@vercel/node';
import admin, { adminAuth, adminDb as db } from './_firebaseAdmin.js';

/**
 * Shared caller-identity primitives for the `/api` endpoints.
 *
 * Every endpoint used to hand-roll three things, each slightly differently:
 *   1. "who is calling" — reading `bid`/`tid`/`roles`/`cid`/`pbid`/`superAdmin`
 *      off the ID token, with a `teamMembers` fallback for pre-rollout tokens;
 *   2. "is this membership usable" — most lookups forgot `status != 'Inactive'`,
 *      so a removed employee kept every server-side capability (send WhatsApp,
 *      email a customer, mint an AI reply, open a checkout) for as long as their
 *      Firebase account existed;
 *   3. "is this a platform URL" — four allowlists, two of which accepted
 *      `localhost` and the whole `*.vercel.app` wildcard in production, so an
 *      attacker-controlled preview deployment was a valid redirect/invite target.
 *
 * The rules of the module:
 *   - An email is identity only when Firebase says it is verified. An unverified
 *     email is treated as ABSENT (`verifiedEmail()` returns null), so nothing here
 *     ever matches a membership, a customer or the super-admin list on a
 *     self-declared address.
 *   - A token that carries `cid`/`pbid` but no `bid` is a portal client. It never
 *     falls back to a membership lookup: the claims are server-minted and already
 *     said "not staff".
 *   - Inactive memberships grant nothing. Filtered in code after the query, because
 *     legacy rows have no `status` at all (treated as Active, like the rules do).
 */

export interface CallerIdentity {
  uid: string;
  /** Verified email (lowercased) — null when Firebase has not verified it. */
  email: string | null;
  /** Staff tenant (custom claim `bid`). Null for a portal client. */
  bid: string | null;
  tid: string | null;
  roles: string[];
  /** Portal client's customerId (claim `cid`). */
  cid: string | null;
  /** Portal client's tenant (claim `pbid`) — deliberately not `bid`. */
  pbid: string | null;
  superAdmin: boolean;
  decoded: admin.auth.DecodedIdToken;
}

export interface Membership {
  id: string;
  userId: string;
  teamId: string | null;
  businessId: string | null;
  role: string | null;
  status: string | null;
  data: Record<string, any>;
}

const MANAGER_ROLES = new Set(['Admin', 'Manager', 'Owner', 'SuperAdmin']);
const ADMIN_ROLES = new Set(['Admin', 'Owner', 'SuperAdmin']);

/** The closed list of staff roles an invite / membership may carry. Case-sensitive. */
export const STAFF_ROLES = ['Admin', 'Manager', 'Sales', 'SalesAgent', 'Member', 'Viewer'] as const;
export type StaffRole = typeof STAFF_ROLES[number];
export function isStaffRole(v: unknown): v is StaffRole {
  return typeof v === 'string' && (STAFF_ROLES as readonly string[]).includes(v);
}

/** The token's email, but only when Firebase has verified it. Otherwise null. */
export function verifiedEmail(decoded: admin.auth.DecodedIdToken | null | undefined): string | null {
  if (!decoded) return null;
  const email = typeof decoded.email === 'string' ? decoded.email.trim().toLowerCase() : '';
  if (!email) return null;
  return decoded.email_verified === true ? email : null;
}

export function identityFromToken(decoded: admin.auth.DecodedIdToken): CallerIdentity {
  const d = decoded as any;
  const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
  return {
    uid: decoded.uid,
    email: verifiedEmail(decoded),
    bid: str(d.bid),
    tid: str(d.tid),
    roles: Array.isArray(d.roles) ? d.roles.map(String) : [],
    cid: str(d.cid),
    pbid: str(d.pbid),
    superAdmin: d.superAdmin === true,
    decoded,
  };
}

/** Verify the Bearer token on a request. Null when missing/invalid. */
export async function authenticate(req: VercelRequest): Promise<CallerIdentity | null> {
  const header = req.headers.authorization;
  const token = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return null;
  try {
    return identityFromToken(await adminAuth.verifyIdToken(token));
  } catch {
    return null;
  }
}

/** A token whose claims say "portal client, not staff". Never falls back to memberships. */
export function isPortalOnlyToken(c: CallerIdentity): boolean {
  return !c.bid && !c.superAdmin && (!!c.cid || !!c.pbid);
}

export function hasManagerRole(roles: readonly string[] | null | undefined): boolean {
  return !!roles?.some((r) => MANAGER_ROLES.has(String(r)) || /^(admin|manager|owner)$/i.test(String(r)));
}
export function hasAdminRole(roles: readonly string[] | null | undefined): boolean {
  return !!roles?.some((r) => ADMIN_ROLES.has(String(r)) || /^(admin|owner)$/i.test(String(r)));
}

function toMembership(doc: admin.firestore.DocumentSnapshot): Membership | null {
  if (!doc.exists) return null;
  const m = (doc.data() || {}) as Record<string, any>;
  return {
    id: doc.id,
    userId: typeof m.userId === 'string' ? m.userId : '',
    teamId: typeof m.teamId === 'string' && m.teamId ? m.teamId : null,
    businessId: typeof m.businessId === 'string' && m.businessId ? m.businessId : null,
    role: typeof m.role === 'string' && m.role ? m.role : null,
    status: typeof m.status === 'string' ? m.status : null,
    data: m,
  };
}

/** Legacy rows have no `status`; the rules treat that as Active, and so do we. */
export const isActiveMembership = (m: Membership | null | undefined): m is Membership =>
  !!m && m.status !== 'Inactive';

/**
 * Every ACTIVE membership of a user (by uid). Capped — nobody legitimately belongs
 * to more than a handful of teams.
 */
export async function activeMemberships(uid: string): Promise<Membership[]> {
  if (!uid) return [];
  try {
    const snap = await db.collection('teamMembers').where('userId', '==', uid).limit(50).get();
    return snap.docs.map(toMembership).filter(isActiveMembership);
  } catch {
    return [];
  }
}

/**
 * One ACTIVE membership of `uid`, optionally constrained to a team and/or a
 * business. Both constraints given → the row must satisfy both (AND).
 * Null when there is none — a removed employee does not count.
 */
export async function activeMembership(
  uid: string,
  scope: { teamId?: string | null; businessId?: string | null } = {},
): Promise<Membership | null> {
  if (!uid) return null;
  const teamId = scope.teamId || null;
  const businessId = scope.businessId || null;
  try {
    // Deterministic id first (accept-invite writes `{teamId}_{uid}`), then the query.
    if (teamId) {
      const direct = toMembership(await db.collection('teamMembers').doc(`${teamId}_${uid}`).get());
      if (isActiveMembership(direct) && direct.userId === uid && (!businessId || direct.businessId === businessId || !direct.businessId)) {
        return direct;
      }
    }
    let q: admin.firestore.Query = db.collection('teamMembers').where('userId', '==', uid);
    if (teamId) q = q.where('teamId', '==', teamId);
    else if (businessId) q = q.where('businessId', '==', businessId);
    const snap = await q.limit(20).get();
    for (const d of snap.docs) {
      const m = toMembership(d);
      if (!isActiveMembership(m)) continue;
      if (businessId && m.businessId && m.businessId !== businessId) continue;
      return m;
    }
  } catch { /* fall through */ }
  return null;
}

export interface StaffTenant {
  bid: string;
  tid: string | null;
  roles: string[];
  /** The membership row that proved it (null when proven by claims alone). */
  membership: Membership | null;
  source: 'claims' | 'membership' | 'super-admin';
}

/**
 * Resolve the caller's STAFF tenant: claims first (`bid`), then — only for a token
 * that predates the rollout and carries no portal claim either — an active
 * membership row. A portal-only token resolves to null, always.
 *
 * `teamId`, when given, must be the caller's team: the claim `tid` or an active
 * membership in that team; the returned `bid` is then that membership's tenant.
 */
export async function resolveStaffTenant(
  c: CallerIdentity,
  opts: { teamId?: string | null } = {},
): Promise<StaffTenant | null> {
  const wantedTeam = opts.teamId || null;
  if (c.superAdmin) {
    return { bid: c.bid || (wantedTeam ? await businessIdOfTeam(wantedTeam) : '') || '', tid: wantedTeam || c.tid, roles: c.roles.length ? c.roles : ['Admin'], membership: null, source: 'super-admin' };
  }
  if (isPortalOnlyToken(c)) return null;

  if (c.bid) {
    if (!wantedTeam || wantedTeam === c.tid) {
      return { bid: c.bid, tid: c.tid, roles: c.roles, membership: null, source: 'claims' };
    }
    // Another department of the same business is fine — prove it with a row.
    const m = await activeMembership(c.uid, { teamId: wantedTeam });
    if (!m) return null;
    const teamBid = m.businessId || (await businessIdOfTeam(wantedTeam));
    if (teamBid !== c.bid) return null;
    return { bid: c.bid, tid: wantedTeam, roles: m.role ? [m.role] : c.roles, membership: m, source: 'membership' };
  }

  // Pre-rollout token: membership doc is the only proof.
  const m = wantedTeam ? await activeMembership(c.uid, { teamId: wantedTeam }) : (await activeMemberships(c.uid))[0] || null;
  if (!m || !m.teamId) return null;
  const bid = m.businessId || (await businessIdOfTeam(m.teamId));
  if (!bid) return null;
  return { bid, tid: m.teamId, roles: m.role ? [m.role] : [], membership: m, source: 'membership' };
}

/** `teams/{id}.businessId`, falling back to the team id for legacy single-layer tenants. */
export async function businessIdOfTeam(teamId: string): Promise<string> {
  try {
    const snap = await db.collection('teams').doc(teamId).get();
    const bid = snap.exists ? (snap.data() as any)?.businessId : null;
    if (typeof bid === 'string' && bid) return bid;
  } catch { /* fall through */ }
  return teamId;
}

/** Is `uid` `businesses/{bid}.ownerId`? (The only meaning of "owner" on the server.) */
export async function isBusinessOwner(uid: string, businessId: string | null | undefined): Promise<boolean> {
  if (!uid || !businessId) return false;
  try {
    const snap = await db.collection('businesses').doc(businessId).get();
    return snap.exists && (snap.data() as any)?.ownerId === uid;
  } catch {
    return false;
  }
}

/** Platform super-admin by Auth claims (for a uid that is not the caller). */
export async function isSuperAdminUid(uid: string | null | undefined): Promise<boolean> {
  if (!uid) return false;
  try {
    const u = await adminAuth.getUser(uid);
    return u.customClaims?.superAdmin === true;
  } catch {
    return false;
  }
}

// ── Platform URL allowlist ──────────────────────────────────────────────────

const FIXED_PLATFORM_HOSTS = ['fivocrm.vercel.app', 'fivocrm.com', 'fivoo.net'];

function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try { return new URL(url).hostname.toLowerCase(); } catch { return null; }
}

/**
 * Hostnames a redirect / emailed link may point at. `fivocrm.vercel.app` exactly,
 * `fivocrm.com` / `fivoo.net` and their subdomains, whatever `APP_BASE_URL` /
 * `PUBLIC_APP_URL` / `VITE_APP_URL` name, plus the operator's `ALLOWED_HOSTS`.
 * `localhost` only outside production. NEVER a bare `vercel.app` wildcard: any
 * preview deployment of any project would qualify.
 */
export function platformHosts(): string[] {
  const hosts = new Set<string>(FIXED_PLATFORM_HOSTS);
  for (const v of [process.env.APP_BASE_URL, process.env.PUBLIC_APP_URL, process.env.VITE_APP_URL, process.env.VITE_APP_BASE_URL]) {
    const h = hostOf(v);
    if (h) hosts.add(h);
  }
  for (const h of (process.env.ALLOWED_HOSTS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)) {
    if (h === 'vercel.app' || h === 'localhost' || h === '127.0.0.1') continue; // never in production
    hosts.add(h);
  }
  if (process.env.VERCEL_ENV !== 'production') { hosts.add('localhost'); hosts.add('127.0.0.1'); }
  return [...hosts];
}

export function isPlatformHost(hostname: string): boolean {
  const h = String(hostname || '').toLowerCase();
  if (!h) return false;
  return platformHosts().some((allowed) => h === allowed || (allowed !== 'fivocrm.vercel.app' && h.endsWith(`.${allowed}`)));
}

/** True for an http(s) URL whose host is a platform host. */
export function isPlatformUrl(raw: unknown): boolean {
  if (typeof raw !== 'string' || !raw) return false;
  try {
    const u = new URL(raw);
    if (!['http:', 'https:'].includes(u.protocol)) return false;
    if (u.protocol === 'http:' && !/^(localhost|127\.0\.0\.1)$/.test(u.hostname)) return false;
    return isPlatformHost(u.hostname);
  } catch {
    return false;
  }
}

/** The platform's canonical base URL (env first, then the fixed production host). */
export function platformBaseUrl(): string {
  const env = process.env.APP_BASE_URL || process.env.PUBLIC_APP_URL || process.env.VITE_APP_BASE_URL || process.env.VITE_APP_URL;
  if (env && isPlatformUrl(env)) return env.replace(/\/$/, '');
  return 'https://fivocrm.vercel.app';
}

/**
 * A relative in-app path (`/app/...` or `/portal/...`). Rejects absolute URLs,
 * protocol-relative `//host`, backslashes and control characters.
 */
export function isSafeAppPath(raw: unknown, prefixes: readonly string[] = ['/app/', '/portal/']): raw is string {
  if (typeof raw !== 'string' || raw.length > 600) return false;
  if (raw.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(raw) || /^[a-z][a-z0-9+.-]*:/i.test(raw)) return false;
  return prefixes.some((p) => raw === p.slice(0, -1) || raw.startsWith(p));
}

// ── Misc ───────────────────────────────────────────────────────────────────

/** Constant-time string compare; false on a length mismatch or a non-string. */
export function timingSafeEqualStr(a: unknown, b: unknown): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/** Client IP as Vercel's edge reports it — for rate limiting only, never for authorization. */
export function clientIp(req: VercelRequest): string {
  const fwd = req.headers['x-forwarded-for'];
  const raw = Array.isArray(fwd) ? fwd[0] : fwd;
  const ip = raw ? String(raw).split(',')[0].trim() : '';
  return (ip || (req.socket as any)?.remoteAddress || 'unknown').replace(/[^0-9a-fA-F.:]/g, '').slice(0, 64) || 'unknown';
}
