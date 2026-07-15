import { useState, useEffect, useCallback, useMemo, useSyncExternalStore } from 'react';
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit as firestoreLimit,
  onSnapshot,
  getDoc,
  getDocs,
  QueryConstraint,
  Timestamp,
  DocumentData
} from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';

// Types for query options
interface QueryOptions {
  where?: { field: string; operator: string; value: any }[];
  orderBy?: { field: string; direction?: 'asc' | 'desc' };
  skipTeamFilter?: boolean; // For portal views and hooks that handle their own scoping
  limit?: number; // Server-side limit for non-team-scoped collections (ignored for team-scoped)
  skip?: boolean; // Skip the query entirely (e.g. when required params are not yet available)
  // Opt-in: for a TEAM-SCOPED collection, push the `where` constraints to the
  // server ALONGSIDE the teamId filter (default behaviour pushes only teamId and
  // filters `where` client-side). Lets a query stay teamId-constrained — so it
  // satisfies an `isTeamMember(resource.data.teamId)` read rule — while also
  // narrowing reads (e.g. teamId + customerId). REQUIRES a matching composite
  // index in firestore.indexes.json; deploy indexes BEFORE shipping a caller
  // that sets this. See workspace/SECURITY_RULES_MIGRATION.md.
  teamScopedWhere?: boolean;
  // Opt OUT of the forced businessId isolation (businessIsolatedAlways). Used by
  // usePermissions' identity queries (teamMembers by userId/email) which must read
  // the user's memberships unscoped to RESOLVE which business they belong to.
  skipBusinessFilter?: boolean;
}

// ---- Reactive global teamId for data isolation ----
let _globalTeamId: string | null = null;
let _teamIdListeners: (() => void)[] = [];

function _subscribeTeamId(listener: () => void) {
  _teamIdListeners = [..._teamIdListeners, listener];
  return () => {
    _teamIdListeners = _teamIdListeners.filter(l => l !== listener);
  };
}

function _getTeamIdSnapshot() {
  return _globalTeamId;
}

export function setGlobalTeamId(id: string | null) {
  if (_globalTeamId !== id) {
    _globalTeamId = id;
    for (const listener of _teamIdListeners) {
      listener();
    }
  }
}

export function getGlobalTeamId(): string | null {
  return _globalTeamId;
}

// ---- Reactive global businessId (the tenant / isolation boundary; Business > Team) ----
// In the two-level model this is the real isolation key. It falls back to the teamId
// wherever the business layer hasn't been set up yet, so behavior is preserved until
// the read scoping is flipped (Phase 3b).
let _globalBusinessId: string | null = null;
let _businessIdListeners: (() => void)[] = [];

function _subscribeBusinessId(listener: () => void) {
  _businessIdListeners = [..._businessIdListeners, listener];
  return () => { _businessIdListeners = _businessIdListeners.filter(l => l !== listener); };
}

function _getBusinessIdSnapshot() { return _globalBusinessId; }

export function setGlobalBusinessId(id: string | null) {
  if (_globalBusinessId !== id) {
    _globalBusinessId = id;
    for (const listener of _businessIdListeners) listener();
  }
}

export function getGlobalBusinessId(): string | null {
  return _globalBusinessId;
}

export function useGlobalBusinessId(): string | null {
  return useSyncExternalStore(_subscribeBusinessId, _getBusinessIdSnapshot);
}

// ---- Reactive super-admin flag — bypasses all team filters ----
let _isSuperAdmin: boolean = false;
let _superAdminListeners: (() => void)[] = [];

function _subscribeSuperAdmin(l: () => void) {
  _superAdminListeners = [..._superAdminListeners, l];
  return () => { _superAdminListeners = _superAdminListeners.filter(x => x !== l); };
}

function _getSuperAdminSnapshot() { return _isSuperAdmin; }

export function setSuperAdmin(val: boolean) {
  if (_isSuperAdmin !== val) {
    _isSuperAdmin = val;
    for (const l of _superAdminListeners) l();
  }
}

export function useIsSuperAdmin(): boolean {
  return useSyncExternalStore(_subscribeSuperAdmin, _getSuperAdminSnapshot);
}

// ---- Reactive WhatsApp enabled flag ----
let _waEnabled: boolean = localStorage.getItem('whatsapp_enabled') === 'true';
let _waEnabledListeners: (() => void)[] = [];

function _subscribeWaEnabled(listener: () => void) {
  _waEnabledListeners = [..._waEnabledListeners, listener];
  return () => { _waEnabledListeners = _waEnabledListeners.filter(l => l !== listener); };
}

function _getWaEnabledSnapshot() { return _waEnabled; }

export function setGlobalWaEnabled(val: boolean) {
  if (_waEnabled !== val) {
    _waEnabled = val;
    for (const l of _waEnabledListeners) l();
  }
}

export function useWhatsappEnabled(): boolean {
  return useSyncExternalStore(_subscribeWaEnabled, _getWaEnabledSnapshot);
}

/** React hook to reactively read global teamId (triggers re-render on change) */
export function useGlobalTeamId(): string | null {
  return useSyncExternalStore(_subscribeTeamId, _getTeamIdSnapshot);
}

// Collections that require teamId-based data isolation
const teamScopedCollections = new Set([
  'tasks', 'invoices', 'customers', 'leads', 'services',
  'expenses', 'goals', 'timeEntries', 'channels', 'messages',
  'activities', 'clientRequests', 'invoiceItems', 'taskComments', 'leadActivities', 'deals',
  'taskCollaborators', 'customIndustries', 'typingIndicators',
  'directMessages', 'milestones', 'serviceInquiries', 'projectComments',
  'workspaceFolders', 'workspaceDriveFiles', 'projects', 'dailyReports',
  'roleTemplates', 'standups', 'quotes', 'contracts',
  'chatSnippets', 'whatsappAccounts', 'whatsappThreads', 'waTemplates', 'waBroadcasts',
  'emailCampaigns', 'emailTemplates', 'campaignEnrollments',
  // whatsappMessages reads pass skipTeamFilter (they scope by teamId+phone
  // explicitly), so being in this set only enforces teamId on create.
  'whatsappMessages',
  // Identity/structure collections — scoped to the business so a tenant only sees
  // its own staff/invites (usePermissions opts out via skipBusinessFilter).
  'teamMembers', 'teamInvites',
]);

// Multi-tenant isolation: tenant data is ALWAYS scoped by teamId for normal users
// (the "mandatory tenant predicate" big CRMs enforce). This set was a single-org
// leftover that forced customers/leads/invoices/quotes/contracts/services to be
// read across ALL teams — which leaked one tenant's data into another. Now empty:
// nothing escapes team scoping client-side. Super-admins still bypass (they read
// every team for the Relax CRM panel); portal views still pass skipTeamFilter
// explicitly. Legacy docs without teamId are backfilled by useTeamDataMigration.
const globalReadCollections = new Set<string>([]);

// CRM/business "record" collections that must ALWAYS be isolated to the active
// business for a staff user — even when a call passes skipTeamFilter (many views do,
// a single-org leftover that now leaks one tenant's data into another). Excludes the
// cross-cutting chat/comm collections (messages, channels, directMessages, etc.),
// which ChatView scopes itself and reads cross-team by design. Portal clients (no
// businessId) and super-admins are unaffected — see isTeamScoped below.
const businessIsolatedAlways = new Set<string>([
  'leads', 'projects', 'invoices', 'invoiceItems', 'customers', 'deals', 'leadActivities',
  'services', 'expenses', 'goals', 'quotes', 'contracts', 'tasks', 'taskComments',
  'taskCollaborators', 'milestones', 'projectComments', 'clientRequests', 'serviceInquiries',
  'timeEntries', 'standups', 'dailyReports', 'customIndustries', 'activities',
  'emailCampaigns', 'emailTemplates', 'campaignEnrollments',
  'domains',
  'teamMembers', 'teamInvites',
]);

// Identity/structure collections a super-admin reads cross-business (the agency
// owner manages teams platform-wide). `teams` is already unscoped; scoping only
// teamMembers/teamInvites made member counts show 0 for the owner. DATA collections
// are NOT here, so they stay strictly business-scoped even for super-admins.
const SUPER_ADMIN_BYPASS_COLLECTIONS = new Set<string>(['teamMembers', 'teamInvites']);

// "Reference" collections that change rarely but are subscribed on almost every
// screen. Reading them with a live onSnapshot keeps an open stream + re-reads the
// whole list on every (re)mount. Instead we read them ONCE via getDocs and serve
// from a shared cache for STATIC_TTL_MS. Writes invalidate the cache (see
// invalidateCollectionCache) so edits still show up immediately. Net effect: far
// fewer Firestore reads, at the cost of up-to-TTL staleness for passive viewers.
const staticCollections = new Set([
  'teamMembers', 'teams', 'userProfiles', 'services',
]);
const STATIC_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Module-level cache: reuse listeners for identical queries across components.
// Key = "{collectionName}|{whereKey}|{orderKey}|{limit}|{skipTeamFilter}|{teamId}"
interface CacheEntry {
  data: (DocumentData & { id: string })[];
  listeners: Set<(data: (DocumentData & { id: string })[]) => void>;
  unsubscribe: () => void;
  refCount: number;
  isStatic?: boolean;        // true → cached one-time read, no live listener
  fetchedAt?: number;        // last getDocs time (static entries only)
  refetch?: () => void;      // re-run the one-time read + notify (static entries only)
}
const _collectionCache = new Map<string, CacheEntry>();

// Drop / refresh cached reads for a static collection after a write, so edits are
// reflected immediately instead of waiting for the TTL. Mounted views (refCount>0)
// are refreshed in place; unused entries are dropped and re-fetched on next mount.
export function invalidateCollectionCache(collectionName: string) {
  const prefix = `${collectionName}|`;
  for (const [key, entry] of _collectionCache) {
    if (!key.startsWith(prefix) || !entry.isStatic) continue;
    if (entry.refCount > 0 && entry.refetch) {
      entry.fetchedAt = 0;
      entry.refetch();
    } else {
      _collectionCache.delete(key);
    }
  }
}

function buildCacheKey(
  collectionName: string,
  whereKey: string,
  orderKey: string,
  limit: number | undefined,
  skipTeamFilter: boolean,
  teamId: string | null
): string {
  return `${collectionName}|${whereKey}|${orderKey}|${limit ?? ''}|${skipTeamFilter}|${teamId ?? ''}`;
}

// Convert Firestore timestamps to Date
function convertTimestamps(data: DocumentData): DocumentData {
  const converted: DocumentData = { ...data };
  for (const key in converted) {
    if (converted[key] instanceof Timestamp) {
      converted[key] = converted[key].toDate();
    }
  }
  return converted;
}

// Hook to fetch a collection with real-time updates
// Auto-injects teamId filter for team-scoped collections (unless skipTeamFilter is set)
export function useCollection<T = DocumentData>(
  collectionName: string,
  options?: QueryOptions
) {
  const [data, setData] = useState<(T & { id: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const { user } = useAuth();
  // Two-level tenancy: isolation is by businessId (the tenant). teamId is now a
  // sub-group (department) within a business, so it no longer scopes reads.
  const reactiveBusinessId = useGlobalBusinessId();
  const superAdmin = useIsSuperAdmin();
  // Tenant isolation applies to everyone for DATA collections (customers, invoices,
  // leads, …) — scoped to the active business; cross-tenant reads need an explicit
  // skipBusinessFilter (Relax CRM console). EXCEPTION: super-admins bypass scoping for
  // IDENTITY/structure collections (teamMembers/teamInvites) so the agency owner can
  // manage teams across the platform — `teams` is already unscoped, so scoping only
  // teamMembers made member counts wrongly show 0. Data collections stay scoped, so
  // no tenant's records leak into another tenant's /app.
  const superAdminBypass = superAdmin && SUPER_ADMIN_BYPASS_COLLECTIONS.has(collectionName);
  const forceBusinessScope = !!reactiveBusinessId && businessIsolatedAlways.has(collectionName) && !options?.skipBusinessFilter && !superAdminBypass;
  const isTeamScoped = teamScopedCollections.has(collectionName)
    && !globalReadCollections.has(collectionName)
    && !superAdminBypass
    && (forceBusinessScope || !options?.skipTeamFilter);
  const scopeId = isTeamScoped ? reactiveBusinessId : null;

  // teamScopedWhere is folded into the cache key so a server-pushed variant
  // doesn't collide with a client-filtered one sharing the same `where`.
  const whereKey = JSON.stringify({ w: options?.where || null, tsw: options?.teamScopedWhere || false });
  const orderKey = JSON.stringify(options?.orderBy || null);
  const skipTeamFilter = options?.skipTeamFilter || false;
  const limitVal = options?.limit;

  useEffect(() => {
    if (options?.skip) { setData([]); setLoading(false); return; }
    if (!user) { setData([]); setLoading(false); return; }
    if (isTeamScoped && !scopeId) { setData([]); setLoading(true); return; }

    // Reset any error from a previous query params set — otherwise a stale error
    // (e.g. permission-denied from a prior channel) bleeds into the new query and
    // can trip consumers that react to `error` (e.g. ChatView clearing the channel).
    setError(null);

    const cacheKey = buildCacheKey(collectionName, whereKey, orderKey, limitVal, skipTeamFilter, scopeId);
    const isStatic = staticCollections.has(collectionName);

    // Build the Firestore query identically for the live and static paths.
    const buildQuery = () => {
      const constraints: QueryConstraint[] = [];
      if (isTeamScoped && scopeId) {
        // Server-side businessId filter — scopes reads to the active tenant's docs.
        // Additional where/orderBy/limit are applied client-side to avoid composite index requirements.
        constraints.push(where('businessId', '==', scopeId));
        if (options?.teamScopedWhere && options?.where) {
          options.where.forEach(w => constraints.push(where(w.field, w.operator as any, w.value)));
        }
      } else {
        if (options?.where) options.where.forEach(w => constraints.push(where(w.field, w.operator as any, w.value)));
        if (options?.orderBy) constraints.push(orderBy(options.orderBy.field, options.orderBy.direction || 'asc'));
        if (options?.limit && options.limit > 0) constraints.push(firestoreLimit(options.limit));
      }
      return query(collection(db, collectionName), ...constraints);
    };

    // Client-side teamId/where/order shaping (only needed for team-scoped reads;
    // for non-team-scoped reads the constraints above are already applied server-side).
    const processItems = (raw: (DocumentData & { id: string })[]) => {
      let items = raw;
      if (isTeamScoped && scopeId) {
        items = items.filter(item => (item as any).businessId === scopeId);
        if (options?.where) {
          items = items.filter(item => options.where!.every(w => {
            const val = (item as any)[w.field];
            switch (w.operator) {
              case '==': return val === w.value;
              case '!=': return val !== w.value;
              case '<': return val < w.value;
              case '<=': return val <= w.value;
              case '>': return val > w.value;
              case '>=': return val >= w.value;
              case 'in': return Array.isArray(w.value) && w.value.includes(val);
              case 'not-in': return Array.isArray(w.value) && !w.value.includes(val);
              case 'array-contains': return Array.isArray(val) && val.includes(w.value);
              case 'array-contains-any': return Array.isArray(val) && Array.isArray(w.value) && w.value.some((v: any) => val.includes(v));
              default: return true;
            }
          }));
        }
        if (options?.orderBy) {
          const field = options.orderBy.field;
          const dir = options.orderBy.direction || 'asc';
          items = [...items].sort((a, b) => {
            const va = (a as any)[field]; const vb = (b as any)[field];
            if (va == null && vb == null) return 0;
            if (va == null) return 1; if (vb == null) return -1;
            const ta = va instanceof Date ? va.getTime() : typeof va === 'string' ? va : Number(va);
            const tb = vb instanceof Date ? vb.getTime() : typeof vb === 'string' ? vb : Number(vb);
            if (ta < tb) return dir === 'asc' ? -1 : 1;
            if (ta > tb) return dir === 'asc' ? 1 : -1;
            return 0;
          });
        }
      }
      return items;
    };

    // Register on an existing cache entry (shared live listener or cached static data).
    if (_collectionCache.has(cacheKey)) {
      const entry = _collectionCache.get(cacheKey)!;
      entry.refCount++;
      const listener = (d: (DocumentData & { id: string })[]) => {
        setData(d as (T & { id: string })[]);
        setLoading(false);
      };
      entry.listeners.add(listener);
      setData(entry.data as (T & { id: string })[]);
      setLoading(false);
      // Static entry past its TTL → refresh in the background (stale-while-revalidate).
      if (isStatic && entry.refetch && entry.fetchedAt !== undefined && Date.now() - entry.fetchedAt > STATIC_TTL_MS) {
        entry.refetch();
      }
      return () => {
        entry.listeners.delete(listener);
        entry.refCount--;
        // Live entries are torn down when unused; static entries persist for TTL reuse.
        if (entry.refCount <= 0 && !entry.isStatic) {
          entry.unsubscribe();
          _collectionCache.delete(cacheKey);
        }
      };
    }

    let cancelled = false;
    let unsubFn: (() => void) | undefined;

    // Placeholder so concurrent mounts share the same entry
    const entry: CacheEntry = {
      data: [],
      listeners: new Set(),
      unsubscribe: () => { unsubFn?.(); },
      refCount: 1,
    };
    const selfListener = (d: (DocumentData & { id: string })[]) => {
      setData(d as (T & { id: string })[]);
      setLoading(false);
    };
    entry.listeners.add(selfListener);
    _collectionCache.set(cacheKey, entry);

    if (isStatic) {
      // One-time read + TTL cache (no live stream) for rarely-changing reference data.
      entry.isStatic = true;
      entry.fetchedAt = 0;
      const refetch = () => {
        (auth.currentUser?.getIdToken() ?? Promise.resolve())
          .then(() => getDocs(buildQuery()))
          .then((snap) => {
            const items = processItems(snap.docs.map(d => ({ id: d.id, ...convertTimestamps(d.data()) })) as (DocumentData & { id: string })[]);
            const e = _collectionCache.get(cacheKey);
            if (e) { e.data = items; e.fetchedAt = Date.now(); e.listeners.forEach(l => l(items)); }
            if (!cancelled) setError(null);
          })
          .catch((err) => {
            console.error(`Error fetching ${collectionName}:`, err);
            if (!cancelled) { setError(err as Error); setLoading(false); }
          });
      };
      entry.refetch = refetch;
      refetch();
      return () => {
        cancelled = true;
        entry.listeners.delete(selfListener);
        entry.refCount--;
        // Keep the static entry (refCount may hit 0) so navigation reuses it within the TTL.
      };
    }

    // Live path (onSnapshot) — default for all non-static collections.
    (auth.currentUser?.getIdToken() ?? Promise.resolve()).then(() => {
      if (cancelled) return;
      unsubFn = onSnapshot(buildQuery(), (snapshot) => {
        const items = processItems(snapshot.docs.map(d => ({ id: d.id, ...convertTimestamps(d.data()) })) as (DocumentData & { id: string })[]);
        if (_collectionCache.has(cacheKey)) {
          const e = _collectionCache.get(cacheKey)!;
          e.data = items;
          e.listeners.forEach(l => l(items));
        }
        setError(null);
      }, (err) => {
        console.error(`Error fetching ${collectionName}:`, err);
        setError(err);
        setLoading(false);
      });
    }).catch(() => { setData([]); setLoading(false); });

    return () => {
      cancelled = true;
      if (_collectionCache.has(cacheKey)) {
        const e = _collectionCache.get(cacheKey)!;
        e.listeners.delete(selfListener);
        e.refCount--;
        if (e.refCount <= 0) {
          e.unsubscribe();
          _collectionCache.delete(cacheKey);
        }
      }
    };
  }, [collectionName, whereKey, orderKey, skipTeamFilter, limitVal, scopeId, superAdmin, options?.skip, user?.uid]);

  return { data, loading, error };
}

// Hook to fetch a single document
export function useDocument<T = DocumentData>(
  collectionName: string,
  documentId: string | undefined
) {
  const [data, setData] = useState<(T & { id: string }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!documentId) {
      setLoading(false);
      return;
    }

    const docRef = doc(db, collectionName, documentId);
    
    const unsubscribe = onSnapshot(
      docRef,
      (snapshot) => {
        if (snapshot.exists()) {
          setData({
            id: snapshot.id,
            ...convertTimestamps(snapshot.data())
          } as T & { id: string });
        } else {
          setData(null);
        }
        setLoading(false);
      },
      (err) => {
        console.error(`Error fetching document:`, err);
        setError(err);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [collectionName, documentId]);

  return { data, loading, error };
}

// Helper to remove undefined values (Firebase doesn't accept undefined)
function removeUndefined(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(removeUndefined);
  if (obj instanceof Date || obj instanceof Timestamp) return obj;
  if (typeof obj === 'object') {
    return Object.fromEntries(
      Object.entries(obj)
        .filter(([_, v]) => v !== undefined)
        .map(([k, v]) => [k, removeUndefined(v)])
    );
  }
  return obj;
}

// Hook for mutations (create, update, delete)
// Auto-injects teamId on create for team-scoped collections
export function useMutation<T = DocumentData>(collectionName: string) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // createdAt, updatedAt, createdByUserId are auto-injected — callers don't need to provide them
  const create = useCallback(async (data: Partial<Pick<T & Record<string, any>, 'createdAt' | 'updatedAt' | 'createdByUserId'>> & Omit<T, 'id' | 'createdAt' | 'updatedAt' | 'createdByUserId'>) => {
    setLoading(true);
    setError(null);
    try {
      // Prefer a teamId explicitly provided by the caller (e.g. a super-admin
      // creating within a specific project/team context — they have no global
      // active team), otherwise fall back to the global active team.
      const explicitTeamId = (data as any)?.teamId as string | undefined;
      const teamId = explicitTeamId || getGlobalTeamId();
      if (teamScopedCollections.has(collectionName) && !teamId) {
        throw new Error(`Cannot create ${collectionName} document without an active team`);
      }
      // Two-level tenancy: stamp businessId (isolation key) alongside teamId. Prefer
      // an explicit value, else the active business, else fall back to the teamId so
      // single-level data stays self-consistent until the business layer is set up.
      const explicitBusinessId = (data as any)?.businessId as string | undefined;
      const businessId = explicitBusinessId || getGlobalBusinessId() || teamId || undefined;
      const autoScope = teamScopedCollections.has(collectionName) && teamId
        ? { teamId, ...(businessId ? { businessId } : {}) }
        : {};

      // Phase 4.3b Wave 3: derive customerId on parent-linked child records so a
      // portal client can read their own data under server-side RLS
      // (isPortalClientFor). Staff isolation uses businessId (autoScope above); the
      // portal needs customerId on these collections, which have no customerId of
      // their own — pull it from the parent. Skipped when the caller already set it.
      let derivedCustomerId = (data as any)?.customerId as string | undefined;
      if (!derivedCustomerId) {
        try {
          const d = data as any;
          if (collectionName === 'invoiceItems' && d.invoiceId) {
            derivedCustomerId = (await getDoc(doc(db, 'invoices', d.invoiceId))).data()?.customerId;
          } else if ((collectionName === 'tasks' || collectionName === 'projectComments') && d.projectId) {
            derivedCustomerId = (await getDoc(doc(db, 'projects', d.projectId))).data()?.customerId;
          } else if (collectionName === 'taskComments' && d.taskId) {
            derivedCustomerId = (await getDoc(doc(db, 'tasks', d.taskId))).data()?.customerId;
          }
        } catch { /* parent missing/unreadable — leave customerId unset, backfill covers it */ }
      }

      const docData = removeUndefined({
        ...autoScope,
        ...(derivedCustomerId ? { customerId: derivedCustomerId } : {}),
        ...data,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
        createdByUserId: user?.uid || null
      });
      // Normalize email to lowercase so client login (Google/email) reliably
      // matches existing customers/leads/portal-access records regardless of the
      // case a staff member typed. Emails are case-insensitive by spec.
      if (typeof (docData as any).email === 'string') {
        (docData as any).email = (docData as any).email.trim().toLowerCase();
      }
      const docRef = await addDoc(collection(db, collectionName), docData);
      if (staticCollections.has(collectionName)) invalidateCollectionCache(collectionName);

      // Push + email delivery for in-app notifications — single choke point
      // covering every notification creation site. Fire-and-forget; the server
      // endpoint sends an FCM push (arrives even when the app is closed) AND an
      // email, honoring per-channel prefs (pushEnabled/emailEnabled) + category
      // mute + Do-Not-Disturb, and skips self-notifications. Cron-created
      // notifications use the admin SDK directly and bypass this path (no dupes).
      if (collectionName === 'notifications' && (docData as any).userId && (docData as any).title) {
        (async () => {
          try {
            const token = await auth.currentUser?.getIdToken();
            if (!token) return;
            // Deep-link target: prefer an explicit actionUrl; otherwise derive one
            // from linkTo. A linkTo that isn't a path is a chat channel id, so open
            // the chat with it (mirrors NotificationsCenter click behavior). This is
            // read as a query param by ChatView so push taps land on the channel.
            const rawLink = (docData as any).actionUrl ?? (docData as any).linkTo;
            const resolvedUrl = rawLink
              ? (String(rawLink).startsWith('/') ? String(rawLink) : `/app/chat?channel=${encodeURIComponent(String(rawLink))}`)
              : undefined;
            await fetch('/api/send-notification-email', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
              body: JSON.stringify({
                userId: (docData as any).userId,
                type: (docData as any).type,
                title: (docData as any).title,
                message: (docData as any).message,
                actionUrl: resolvedUrl,
                actionLabel: (docData as any).actionLabel,
                // Sender avatar → shown in the push (WhatsApp/Airbnb style). Optional.
                imageUrl: (docData as any).imageUrl ?? (docData as any).avatarUrl,
              }),
            });
          } catch { /* non-critical: in-app notification already saved */ }
        })();
      }

      setLoading(false);
      return { id: docRef.id, ...docData };
    } catch (err) {
      setError(err as Error);
      setLoading(false);
      throw err;
    }
  }, [collectionName, user]);

  const update = useCallback(async (id: string, data: Partial<T>) => {
    setLoading(true);
    setError(null);
    try {
      const docRef = doc(db, collectionName, id);
      const updateData = removeUndefined({
        ...data,
        updatedAt: Timestamp.now()
      }) as any;
      if (typeof updateData.email === 'string') updateData.email = updateData.email.trim().toLowerCase();
      await updateDoc(docRef, updateData);
      if (staticCollections.has(collectionName)) invalidateCollectionCache(collectionName);
      setLoading(false);
    } catch (err) {
      setError(err as Error);
      setLoading(false);
      throw err;
    }
  }, [collectionName]);

  const remove = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const docRef = doc(db, collectionName, id);
      await deleteDoc(docRef);
      if (staticCollections.has(collectionName)) invalidateCollectionCache(collectionName);
      setLoading(false);
    } catch (err) {
      setError(err as Error);
      setLoading(false);
      throw err;
    }
  }, [collectionName]);

  return { create, update, remove, loading, error };
}

// Client-side pagination hook for any collection (works with team-scoped fetch-all strategy)
export function usePaginatedCollection<T = DocumentData>(
  collectionName: string,
  options?: QueryOptions & { pageSize?: number }
) {
  const { pageSize = 25, ...queryOptions } = options || {};
  const { data: allData, loading, error } = useCollection<T>(collectionName, queryOptions);
  const [page, setPage] = useState(0);

  // Reset page when data changes significantly (e.g., filter change)
  const totalItems = allData.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

  // Clamp page to valid range — done in useEffect to avoid setState during render
  const safePage = Math.min(page, totalPages - 1);
  useEffect(() => {
    if (page >= totalPages && totalPages > 0) setPage(totalPages - 1);
  }, [totalPages, page]);

  const paginatedData = useMemo(() => {
    const start = safePage * pageSize;
    return allData.slice(start, start + pageSize);
  }, [allData, safePage, pageSize]);

  const nextPage = useCallback(() => {
    setPage(p => Math.min(p + 1, totalPages - 1));
  }, [totalPages]);

  const prevPage = useCallback(() => {
    setPage(p => Math.max(p - 1, 0));
  }, []);

  const goToPage = useCallback((target: number) => {
    setPage(Math.max(0, Math.min(target, totalPages - 1)));
  }, [totalPages]);

  return {
    data: paginatedData,
    allData,
    loading,
    error,
    page: safePage,
    totalPages,
    totalItems,
    pageSize,
    nextPage,
    prevPage,
    goToPage,
    hasNextPage: safePage < totalPages - 1,
    hasPrevPage: safePage > 0,
  };
}
