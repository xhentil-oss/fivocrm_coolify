import { useEffect, useSyncExternalStore } from 'react';

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
  /**
   * Epoch ms after which the override stops applying.
   *
   * Standing access inside someone else's workspace is not something you want to rely
   * on remembering to end: an operator who forgets is one careless click from creating
   * records in the wrong tenant an hour later. The session expires on its own and can
   * be extended explicitly.
   */
  expiresAt?: number;
}

/** How long one "enter tenant" session lasts, and how much an extension adds. */
export const IMPERSONATION_MINUTES = 60;
export const IMPERSONATION_EXTEND_MINUTES = 30;

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
function readFresh(): TenantOverride | null {
  const v = read();
  // An expired override is the same as none — and it is cleared so the stale value
  // cannot come back on the next read.
  if (v?.expiresAt && Date.now() > v.expiresAt) {
    try { sessionStorage.removeItem(KEY); } catch { /* private mode */ }
    return null;
  }
  return v;
}

let _value: TenantOverride | null = readFresh();
let _listeners: (() => void)[] = [];

function notify() {
  for (const l of _listeners) l();
}

function subscribe(listener: () => void) {
  _listeners = [..._listeners, listener];
  return () => { _listeners = _listeners.filter(l => l !== listener); };
}

export function getTenantOverride(): TenantOverride | null {
  // Re-check expiry on every read: a tab left open overnight must not still be inside
  // another tenant's workspace.
  if (_value?.expiresAt && Date.now() > _value.expiresAt) {
    clearTenantOverride();
    return null;
  }
  return _value;
}

/** Minutes left in the current impersonation session (null when not impersonating). */
export function overrideMinutesLeft(now = Date.now()): number | null {
  const v = _value;
  if (!v?.expiresAt) return null;
  return Math.max(0, Math.ceil((v.expiresAt - now) / 60_000));
}

/** Push the expiry out — used by the "Zgjat" action in the banner. */
export function extendTenantOverride(minutes = IMPERSONATION_EXTEND_MINUTES): void {
  if (!_value) return;
  setTenantOverride({ ..._value, expiresAt: Date.now() + minutes * 60_000 });
}

export function setTenantOverride(value: TenantOverride): void {
  // Default expiry applied here, so no caller can create an endless session by
  // forgetting the field.
  const withExpiry: TenantOverride = {
    ...value,
    expiresAt: value.expiresAt ?? Date.now() + IMPERSONATION_MINUTES * 60_000,
  };
  value = withExpiry;
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
  const value = useSyncExternalStore(subscribe, getTenantOverride, () => null);

  // Tick once a minute while impersonating, so the countdown moves and the session
  // actually ends on its own instead of at the next unrelated re-render.
  useEffect(() => {
    if (!value?.expiresAt) return;
    const id = setInterval(() => {
      if (getTenantOverride() === null) notify();
      else notify();
    }, 30_000);
    return () => clearInterval(id);
  }, [value?.expiresAt]);

  return value;
}
