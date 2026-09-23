/**
 * Everything a signed-out device must forget about the previous user's tenant.
 *
 * Called from AuthContext on `logout()` and whenever Firebase reports "no user"
 * (`onAuthStateChanged(null)`). Idempotent. Deliberately NOT cleared: `theme`,
 * language and the per-view UI preferences (`sidebar_collapsed`, `tasks_*`,
 * `products_view`, …) — they are the device's, not the tenant's.
 *
 * Kept in its own module (loaded lazily by AuthContext) because `useFirestore`
 * imports AuthContext — a static import here would create an import cycle.
 */
import { setGlobalBusinessId, setGlobalTeamId, clearCollectionCache } from '../hooks/useFirestore';
import { clearTenantOverride } from './platformContext';
import { resetStaffIdentity } from './staffIdentity';

/** Exact localStorage keys that hold tenant data or tenant-derived config. */
const TENANT_LOCAL_KEYS = [
  'whatsapp_vps_url',
  'whatsapp_enabled',
  'bank_accounts',
  'company_logo_data',
  'eur_all_rate',
  'usd_all_rate',
  'gbp_all_rate',
  'stripe_publishable_key',
  'stripe_mode',
  'cron_settings',
  'cron_last_runs',
];

/** Prefix families (`default_bank_iban`, `company_name`, `stripe_*`, `cron_*`). */
const TENANT_LOCAL_PREFIXES = ['default_bank_', 'company_', 'stripe_', 'cron_'];

/** sessionStorage keys — the role preview and the super-admin tenant pin. */
const TENANT_SESSION_KEYS = ['role_preview', 'fivocrm_platform_tenant'];

function removeMatching(storage: Storage, exact: string[], prefixes: string[]): void {
  const doomed = new Set(exact);
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key && prefixes.some((p) => key.startsWith(p))) doomed.add(key);
  }
  for (const key of doomed) storage.removeItem(key);
}

export function resetTenantSession(): void {
  // In-memory tenant context first, so no query still in flight scopes to the old
  // business; then the cached rows themselves.
  setGlobalBusinessId(null);
  setGlobalTeamId(null);
  clearCollectionCache();
  clearTenantOverride();
  resetStaffIdentity();

  try { removeMatching(localStorage, TENANT_LOCAL_KEYS, TENANT_LOCAL_PREFIXES); } catch { /* private mode */ }
  try { removeMatching(sessionStorage, TENANT_SESSION_KEYS, []); } catch { /* private mode */ }
}
