import { useSyncExternalStore } from 'react';

/**
 * Platform console → tenant workspace bridge.
 *
 * A super-admin has TWO identities that must never be the same thing:
 *   • the platform operator (console at /superadmin — sees every tenant), and
 *   • a normal member of ONE business (/app — sees that business only).
 *
 * Everything under /app is scoped by the active `businessId`. This module holds the
 * override a super-admin sets when they explicitly enter another tenant from the
 * console ("Hyr"), so `/app` renders that tenant instead of their own business.
 *
 * Deliberately sessionStorage, not localStorage: entering someone else's workspace
 * must not silently outlive the browser tab. A reload keeps it (so a refresh mid-task
 * isn't destructive), closing the tab drops it.
 *
 * The override is a UI/scoping preference only — it grants nothing. Authority still
 * comes from the server-minted `superAdmin` claim (api/_tenantClaims.ts), and the
 * switch itself is audited server-side as `claims.impersonate`.
 */

export interface TenantOverride {
  businessId: string;
  /** Default team (department) of that tenant — may be null if it has none. */
  teamId: string | null;
  /** Business name, for the banner. Display only. */
  name: string;
}

const KEY = 'fivocrm_platform_tenant';

function read(): TenantOverride | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed.businessId === 'string' ? parsed as TenantOverride : null;
  } catch {
    return null;
  }
}

// Module-level cache so getSnapshot returns a STABLE reference between renders —
// useSyncExternalStore would loop forever on a freshly parsed object each call.
let _value: TenantOverride | null = read();
let _listeners: (() => void)[] = [];

function notify() {
  for (const l of _listeners) l();
}

function subscribe(listener: () => void) {
  _listeners = [..._listeners, listener];
  return () => { _listeners = _listeners.filter(l => l !== listener); };
}

export function getTenantOverride(): TenantOverride | null {
  return _value;
}

export function setTenantOverride(value: TenantOverride): void {
  try { sessionStorage.setItem(KEY, JSON.stringify(value)); } catch { /* private mode */ }
  _value = value;
  notify();
}

export function clearTenantOverride(): void {
  try { sessionStorage.removeItem(KEY); } catch { /* private mode */ }
  if (_value === null) return;
  _value = null;
  notify();
}

/** Reactive read of the active tenant override (null = your own business). */
export function useTenantOverride(): TenantOverride | null {
  return useSyncExternalStore(subscribe, getTenantOverride, () => null);
}
