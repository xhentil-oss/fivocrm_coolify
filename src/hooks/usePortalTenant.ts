import { useMemo } from 'react';
import { useDocument } from './useFirestore';

/**
 * `publicTenants/{subdomain}` — the ONLY world-readable slice of tenant metadata.
 * Written by the server (Relax CRM subdomain editor + the `tenant-hierarchy` job);
 * `read: if true`, `write: if false` in Firestore rules.
 */
export interface PublicTenant {
  businessId: string;
  teamId: string | null;
  name?: string | null;
  portalSubdomain?: string;
}

/**
 * Resolves the portal tenant from the current hostname (subdomain-per-tenant).
 *
 *   x.fivocrm.com/portal  → tenant whose Business.portalSubdomain === 'x'
 *   fivocrm.com/portal    → no subdomain → null (the agency's own portal; default
 *                           behavior is preserved, nothing is forced).
 *
 * The resolved businessId is used ONLY to stamp/scope a portal client's records
 * (which tenant they belong to) — it does NOT grant business-member access.
 * Portal read access stays gated by isPortalClientFor(customerId).
 */

// Base host the app is served under. Subdomains of this become tenant slugs.
const ROOT_DOMAIN = 'fivocrm.com';
// Subdomains that are NOT tenants (the app itself / infrastructure).
const RESERVED_SUBDOMAINS = new Set(['www', 'app', 'api', 'fivocrm', 'portal']);

/** Extract the tenant subdomain from a hostname, or null if there isn't one. */
export function extractPortalSubdomain(hostname: string): string | null {
  const h = (hostname || '').toLowerCase().split(':')[0]; // strip any port
  if (!h || h === 'localhost') return null;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) return null;          // raw IP
  if (h.endsWith('.vercel.app')) return null;                // vercel preview/prod host
  if (!h.endsWith(`.${ROOT_DOMAIN}`)) return null;           // not under our root (custom domains handled later)
  // h === 'x.fivocrm.com' → strip the root → 'x'; 'fivocrm.com' → '' → null
  const prefix = h.slice(0, h.length - ROOT_DOMAIN.length - 1); // remove '.fivocrm.com'
  if (!prefix) return null;                                  // apex (fivocrm.com)
  const sub = prefix.split('.')[0];                          // first label only
  if (!sub || RESERVED_SUBDOMAINS.has(sub)) return null;
  return sub;
}

export interface PortalTenant {
  /** The subdomain slug, or null on the apex/agency host. */
  subdomain: string | null;
  /** The tenant's businessId, or null when on apex or no match. */
  tenantBusinessId: string | null;
  /** A team belonging to that business (used as teamId for portal-created docs). */
  tenantTeamId: string | null;
  /** True while the subdomain lookup is still resolving. */
  loading: boolean;
}

export function usePortalTenant(): PortalTenant {
  const subdomain = useMemo(
    () => (typeof window !== 'undefined' ? extractPortalSubdomain(window.location.hostname) : null),
    []
  );

  // Resolved from `publicTenants/{subdomain}` — a deliberately minimal, PUBLIC map
  // (businessId, teamId, name) maintained by the server. Previously this read the
  // `businesses` and `teams` collections directly, which is exactly why both had to
  // stay `read: if isAuth()` (i.e. every tenant's record readable by anyone signed
  // in). With the map in its own collection, both can be locked to their members.
  const { data: tenantDoc, loading } = useDocument<PublicTenant>('publicTenants', subdomain || undefined);

  return {
    subdomain,
    tenantBusinessId: tenantDoc?.businessId || null,
    tenantTeamId: tenantDoc?.teamId || null,
    loading: !!subdomain && loading,
  };
}
