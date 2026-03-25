import { useState, useEffect, useCallback, useSyncExternalStore } from 'react';
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  QueryConstraint,
  Timestamp,
  DocumentData
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';

// Types for query options
interface QueryOptions {
  where?: { field: string; operator: string; value: any }[];
  orderBy?: { field: string; direction?: 'asc' | 'desc' };
  skipTeamFilter?: boolean; // For portal views and hooks that handle their own scoping
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

/** React hook to reactively read global teamId (triggers re-render on change) */
function useGlobalTeamId(): string | null {
  return useSyncExternalStore(_subscribeTeamId, _getTeamIdSnapshot);
}

// Collections that require teamId-based data isolation
const teamScopedCollections = new Set([
  'tasks', 'invoices', 'customers', 'leads', 'services',
  'expenses', 'goals', 'timeEntries', 'channels', 'messages',
  'activities', 'clientRequests', 'invoiceItems', 'taskComments',
  'taskCollaborators', 'customIndustries', 'typingIndicators',
  'directMessages', 'milestones', 'serviceInquiries', 'projectComments',
  'workspaceFolders', 'workspaceDriveFiles', 'projects',
]);

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

  const reactiveTeamId = useGlobalTeamId();
  const isTeamScoped = teamScopedCollections.has(collectionName) && !options?.skipTeamFilter;

  // For non-team-scoped collections (teamMembers, teams, notifications, etc.) use a stable
  // null sentinel so that changes to globalTeamId don't cause their effects to re-run and
  // re-subscribe. This prevents a cascade where globalTeamId being set causes the
  // usePermissions Firestore subscriptions to recreate, which briefly re-evaluates permissions,
  // which can call setGlobalTeamId again, creating an oscillation loop.
  const globalTeamId = isTeamScoped ? reactiveTeamId : null;

  // Stable dependency keys to avoid excessive re-renders from new object references
  const whereKey = JSON.stringify(options?.where || null);
  const orderKey = JSON.stringify(options?.orderBy || null);
  const skipTeamFilter = options?.skipTeamFilter || false;

  useEffect(() => {
    // For team-scoped collections, don't query until teamId is available
    if (isTeamScoped && !globalTeamId) {
      setData([]);
      setLoading(true);
      return;
    }

    const constraints: QueryConstraint[] = [];

    // For team-scoped collections: fetch ALL docs, then filter client-side.
    // This ensures legacy documents (created before data-isolation, without teamId field)
    // still appear. Also avoids ALL composite index requirements.
    if (isTeamScoped && globalTeamId) {
      // No server-side constraints — everything handled client-side
    } else {
      // Non-team-scoped: use all constraints server-side as before
      if (options?.where) {
        options.where.forEach((w) => {
          constraints.push(where(w.field, w.operator as any, w.value));
        });
      }
      if (options?.orderBy) {
        constraints.push(orderBy(options.orderBy.field, options.orderBy.direction || 'asc'));
      }
    }

    const q = query(collection(db, collectionName), ...constraints);

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        let items = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...convertTimestamps(doc.data())
        })) as (T & { id: string })[];

        // Client-side teamId filtering: include docs belonging to this team
        // OR legacy docs without teamId (created before data-isolation)
        if (isTeamScoped && globalTeamId) {
          items = items.filter(item => {
            const docTeamId = (item as any).teamId;
            return docTeamId === globalTeamId || !docTeamId;
          });
        }

        // Client-side where filtering for team-scoped collections
        if (isTeamScoped && globalTeamId && options?.where) {
          items = items.filter(item => {
            return options.where!.every(w => {
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
            });
          });
        }

        // Client-side sorting for team-scoped collections
        if (isTeamScoped && globalTeamId && options?.orderBy) {
          const field = options.orderBy.field;
          const dir = options.orderBy.direction || 'asc';
          items = [...items].sort((a, b) => {
            const va = (a as any)[field];
            const vb = (b as any)[field];
            if (va == null && vb == null) return 0;
            if (va == null) return 1;
            if (vb == null) return -1;
            const ta = va instanceof Date ? va.getTime() : typeof va === 'string' ? va : Number(va);
            const tb = vb instanceof Date ? vb.getTime() : typeof vb === 'string' ? vb : Number(vb);
            if (ta < tb) return dir === 'asc' ? -1 : 1;
            if (ta > tb) return dir === 'asc' ? 1 : -1;
            return 0;
          });
        }

        setData(items);
        setLoading(false);
      },
      (err) => {
        console.error(`Error fetching ${collectionName}:`, err);
        setError(err);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [collectionName, whereKey, orderKey, skipTeamFilter, globalTeamId]);

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
function removeUndefined(obj: Record<string, any>): Record<string, any> {
  return Object.fromEntries(
    Object.entries(obj).filter(([_, value]) => value !== undefined)
  );
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
      const teamId = getGlobalTeamId();
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
