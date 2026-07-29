import { auth } from './firebase';

/**
 * Client side of the tenant-claims layer.
 *
 * Firestore rules authorize a tenant read/write from the SIGNED ID token
 * (`token.bid` = businessId, `token.tid` = teamId, `token.roles`), falling back to
 * the older `users/{uid}` marker document only while a session still has no claims.
 * That means:
 *   - the tenant boundary no longer depends on a document the client can write,
 *   - rules stop paying a `get()` per document read (billed, and capped at 10 per
 *     request — which per-doc `get()`s were starting to hit).
 *
 * `ensureTenantClaims()` is the reconciliation step: whenever the app resolves a
 * different active tenant than the token carries, it asks the server to re-mint the
 * claims and force-refreshes the token so live Firestore listeners re-authorize.
 */

export interface TenantClaimValues {
  /** businessId — staff membership only. */
  bid: string | null;
  tid: string | null;
  roles: string[];
  /** customerId — portal clients only. */
  cid: string | null;
  /** Portal client's tenant (kept separate from `bid`, which means "staff"). */
  pbid: string | null;
  superAdmin: boolean;
}

export async function readTenantClaims(forceRefresh = false): Promise<TenantClaimValues | null> {
  const user = auth.currentUser;
  if (!user) return null;
  try {
    const res = await user.getIdTokenResult(forceRefresh);
    const c = res.claims as Record<string, any>;
    return {
      bid: (c.bid as string) || null,
      tid: (c.tid as string) || null,
      roles: Array.isArray(c.roles) ? (c.roles as string[]) : [],
      cid: (c.cid as string) || null,
      pbid: (c.pbid as string) || null,
      superAdmin: c.superAdmin === true,
    };
  } catch {
    return null;
  }
}

/** Ask the server to (re)mint tenant claims, then refresh the local ID token. */
export async function syncTenantClaims(opts?: { teamId?: string | null; businessId?: string | null }): Promise<TenantClaimValues | null> {
  const user = auth.currentUser;
  if (!user) return null;
  try {
    const token = await user.getIdToken();
    const res = await fetch('/api/sync-claims', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        ...(opts?.teamId ? { teamId: opts.teamId } : {}),
        ...(opts?.businessId ? { businessId: opts.businessId } : {}),
      }),
    });
    if (!res.ok) return null;
    // Force-refresh so the new claims are in the token the Firestore SDK sends.
    return await readTenantClaims(true);
  } catch {
    return null;
  }
}

// Avoid hammering the endpoint when several hook instances resolve at once.
let _inFlight: Promise<TenantClaimValues | null> | null = null;
let _lastSyncedKey: string | null = null;

/**
 * Reconcile the token's tenant claims with the tenant the app just resolved.
 * No-op when they already match (the common case — one call per session).
 */
export async function ensureTenantClaims(expected: { teamId: string | null; businessId: string | null }): Promise<void> {
  const user = auth.currentUser;
  if (!user || (!expected.teamId && !expected.businessId)) return;

  const key = `${user.uid}|${expected.teamId || ''}|${expected.businessId || ''}`;
  if (_lastSyncedKey === key) return;

  const current = await readTenantClaims();
  const matches =
    !!current &&
    (!expected.businessId || current.bid === expected.businessId) &&
    (!expected.teamId || current.tid === expected.teamId);
  if (matches) { _lastSyncedKey = key; return; }

  if (_inFlight) { await _inFlight; return; }
  _inFlight = syncTenantClaims({ teamId: expected.teamId });
  try {
    await _inFlight;
    _lastSyncedKey = key;
  } finally {
    _inFlight = null;
  }
}

/** Clear the in-memory guard (call on sign-out so the next user re-syncs). */
export function resetTenantClaimsCache(): void {
  _lastSyncedKey = null;
  _inFlight = null;
}
