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
  'activities', 'clientRequests', 'invoiceItems', 'taskComments', 'leadActivities',
  'taskCollaborators', 'customIndustries', 'typingIndicators',
  'directMessages', 'milestones', 'serviceInquiries', 'projectComments',
  'workspaceFolders', 'workspaceDriveFiles', 'projects', 'dailyReports',
  'roleTemplates', 'standups', 'quotes', 'contracts',
  'chatSnippets', 'whatsappAccounts', 'whatsappThreads', 'waTemplates', 'waBroadcasts',
  // whatsappMessages reads pass skipTeamFilter (they scope by teamId+phone
  // explicitly), so being in this set only enforces teamId on create.
  'whatsappMessages',
]);

// CRM "record" collections that are NOT team-isolated in practice: most views
// already load them with skipTeamFilter, many docs (legacy / portal / landing)
// have no teamId, and the rules allow `read: if isAuth()`. We force their READS
// to be global (full list everywhere, regardless of the skipTeamFilter prop) to
// avoid incomplete lists, while CREATE still stamps teamId (they stay in
// teamScopedCollections above). Single-org deployments see no behavior change.
const globalReadCollections = new Set([
  'customers', 'leads', 'invoices', 'quotes', 'contracts', 'services',
]);

// Module-level cache: reuse listeners for identical queries across components.
// Key = "{collectionName}|{whereKey}|{orderKey}|{limit}|{skipTeamFilter}|{teamId}"
interface CacheEntry {
  data: (DocumentData & { id: string })[];
  listeners: Set<(data: (DocumentData & { id: string })[]) => void>;
  unsubscribe: () => void;
  refCount: number;
}
const _collectionCache = new Map<string, CacheEntry>();

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
  const reactiveTeamId = useGlobalTeamId();
  const superAdmin = useIsSuperAdmin();
  const isTeamScoped = teamScopedCollections.has(collectionName)
    && !options?.skipTeamFilter
    && !superAdmin
    && !globalReadCollections.has(collectionName);
  const globalTeamId = isTeamScoped ? reactiveTeamId : null;

  // teamScopedWhere is folded into the cache key so a server-pushed variant
  // doesn't collide with a client-filtered one sharing the same `where`.
  const whereKey = JSON.stringify({ w: options?.where || null, tsw: options?.teamScopedWhere || false });
  const orderKey = JSON.stringify(options?.orderBy || null);
  const skipTeamFilter = options?.skipTeamFilter || false;
  const limitVal = options?.limit;

  useEffect(() => {
    if (options?.skip) { setData([]); setLoading(false); return; }
    if (!user) { setData([]); setLoading(false); return; }
    if (isTeamScoped && !globalTeamId) { setData([]); setLoading(true); return; }

    const cacheKey = buildCacheKey(collectionName, whereKey, orderKey, limitVal, skipTeamFilter, globalTeamId);

    // Register listener on existing cache entry
    if (_collectionCache.has(cacheKey)) {
      const entry = _collectionCache.get(cacheKey)!;
      entry.refCount++;
      const listener = (d: (DocumentData & { id: string })[]) => {
        setData(d as (T & { id: string })[]);
        setLoading(false);
      };
      entry.listeners.add(listener);
      // Deliver current data immediately
      setData(entry.data as (T & { id: string })[]);
      setLoading(false);
      return () => {
        entry.listeners.delete(listener);
        entry.refCount--;
        if (entry.refCount <= 0) {
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

    (auth.currentUser?.getIdToken() ?? Promise.resolve()).then(() => {
      if (cancelled) return;

      const constraints: QueryConstraint[] = [];
      if (isTeamScoped && globalTeamId) {
        // Server-side teamId filter — reduces Firestore reads to this team's documents only.
        // Additional where/orderBy/limit are applied client-side to avoid composite index requirements.
        constraints.push(where('teamId', '==', globalTeamId));
        // Opt-in: also push the caller's where constraints server-side (needs a
        // composite index). The client-side pass below still re-applies them.
        if (options?.teamScopedWhere && options?.where) {
          options.where.forEach(w => constraints.push(where(w.field, w.operator as any, w.value)));
        }
      } else {
        if (options?.where) options.where.forEach(w => constraints.push(where(w.field, w.operator as any, w.value)));
        if (options?.orderBy) constraints.push(orderBy(options.orderBy.field, options.orderBy.direction || 'asc'));
        if (options?.limit && options.limit > 0) constraints.push(firestoreLimit(options.limit));
      }

      const q = query(collection(db, collectionName), ...constraints);
      unsubFn = onSnapshot(q, (snapshot) => {
        let items = snapshot.docs.map(d => ({ id: d.id, ...convertTimestamps(d.data()) })) as (DocumentData & { id: string })[];
        if (isTeamScoped && globalTeamId) {
          items = items.filter(item => (item as any).teamId === globalTeamId);
        }
        if (isTeamScoped && globalTeamId && options?.where) {
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
        if (isTeamScoped && globalTeamId && options?.orderBy) {
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
        // Update cache and notify all listeners
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
  }, [collectionName, whereKey, orderKey, skipTeamFilter, limitVal, globalTeamId, superAdmin, options?.skip, user?.uid]);

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
      const autoTeamId = teamScopedCollections.has(collectionName) && teamId
        ? { teamId }
        : {};
      const docData = removeUndefined({
        ...autoTeamId,
        ...data,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
        createdByUserId: user?.uid || null
      });
      const docRef = await addDoc(collection(db, collectionName), docData);

      // Email delivery for in-app notifications — single choke point covering
      // every notification creation site. Fire-and-forget; the server endpoint
      // resolves the recipient's email and honors their preferences (emailEnabled,
      // category mute, Do-Not-Disturb) and skips self-notifications. Cron-created
      // notifications use the admin SDK directly and bypass this path (no dupes).
      if (collectionName === 'notifications' && (docData as any).userId && (docData as any).title) {
        (async () => {
          try {
            const token = await auth.currentUser?.getIdToken();
            if (!token) return;
            await fetch('/api/send-notification-email', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
              body: JSON.stringify({
                userId: (docData as any).userId,
                type: (docData as any).type,
                title: (docData as any).title,
                message: (docData as any).message,
                actionUrl: (docData as any).actionUrl,
                actionLabel: (docData as any).actionLabel,
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
      await updateDoc(docRef, removeUndefined({
        ...data,
        updatedAt: Timestamp.now()
      }) as any);
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
