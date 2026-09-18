import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from './firebase';
import type { User } from 'firebase/auth';
import { isTenantProvisioning } from './tenantProvisioning';

/**
 * "Is this signed-in person STAFF (or on their way to being staff)?"
 *
 * A team invite creates a `teamInvites` row and nothing else — the membership only
 * exists after the invite is accepted. In that window the person has no role, so
 * every "no membership → they must be a client" branch in the app treated an invited
 * COLLEAGUE as a customer: DefaultRedirect sent them to /portal, useClientPortal
 * auto-created a Customer + clientPortalAccess + Lead for them, and the CRM filled up
 * with the company's own staff as leads.
 *
 * This resolves that window from the two collections the person may legitimately read
 * about themselves. Both queries filter on `email ==` their OWN verified address,
 * which is exactly what the `teamMembers` / `teamInvites` read rules authorize — and,
 * because rules are evaluated against the QUERY SHAPE on a list, the predicate must
 * stay on `email` for the read to be provable.
 *
 * Deliberately a one-shot getDocs with a per-uid memo rather than a live listener:
 * it is consulted on a redirect decision and right before portal auto-create, both of
 * which happen once per session.
 */

export interface StaffIdentity {
  /** An Active staff membership already exists for this address. */
  isStaff: boolean;
  /** A pending, unexpired invite — they are staff-to-be, not a client. */
  pendingInviteToken: string | null;
  /** isStaff || pendingInviteToken — the "never treat as a client" answer. */
  isStaffOrInvited: boolean;
}

const NONE: StaffIdentity = { isStaff: false, pendingInviteToken: null, isStaffOrInvited: false };

const _cache = new Map<string, StaffIdentity>();
const _inFlight = new Map<string, Promise<StaffIdentity>>();

function toDate(value: any): Date | null {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function resolve(email: string): Promise<StaffIdentity> {
  let isStaff = false;
  let pendingInviteToken: string | null = null;

  try {
    const members = await getDocs(query(collection(db, 'teamMembers'), where('email', '==', email)));
    isStaff = members.docs.some((d) => (d.data() as any).status !== 'Inactive');
  } catch { /* denied/offline → fall through; the invite check still applies */ }

  try {
    const invites = await getDocs(query(collection(db, 'teamInvites'), where('email', '==', email)));
    const now = Date.now();
    const usable = invites.docs
      .map((d) => d.data() as any)
      .filter((i) => i.status !== 'Accepted' && i.status !== 'Cancelled')
      .filter((i) => {
        const exp = toDate(i.expiresAt);
        return !exp || exp.getTime() > now;
      });
    pendingInviteToken = usable.find((i) => typeof i.token === 'string' && i.token)?.token || null;
  } catch { /* denied/offline → treat as no invite */ }

  return { isStaff, pendingInviteToken, isStaffOrInvited: isStaff || !!pendingInviteToken };
}

/** Cached per uid for the session. Returns NONE for a user with no email. */
export async function getStaffIdentity(user: Pick<User, 'uid' | 'email'> | null): Promise<StaffIdentity> {
  const email = user?.email?.toLowerCase() || '';
  if (!user?.uid || !email) return NONE;
  // /signup is still writing this person's own tenant: they are its OWNER, not a
  // client. Deliberately not cached — once provisioning ends the membership row
  // answers for itself, and a cached "staff" here would hide a failed signup.
  if (isTenantProvisioning()) return { isStaff: true, pendingInviteToken: null, isStaffOrInvited: true };

  const cached = _cache.get(user.uid);
  if (cached) return cached;
  const running = _inFlight.get(user.uid);
  if (running) return running;

  const p = resolve(email)
    .then((result) => {
      _cache.set(user.uid, result);
      return result;
    })
    .finally(() => { _inFlight.delete(user.uid); });
  _inFlight.set(user.uid, p);
  return p;
}

/** Drop the memo — call after accepting an invite or on sign-out. */
export function resetStaffIdentity(uid?: string): void {
  if (uid) { _cache.delete(uid); _inFlight.delete(uid); return; }
  _cache.clear();
  _inFlight.clear();
}
