import { useCallback, useEffect, useRef, useState } from 'react';
import {
  collection, query, where, orderBy, limit as fsLimit, startAfter,
  getDocs, Timestamp, type QueryConstraint, type QueryDocumentSnapshot, type DocumentData,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useGlobalBusinessId } from './useFirestore';

/**
 * Server-side, cursor-paginated tenant reads.
 *
 * `useCollection` fetches a tenant's ENTIRE collection and pages it in memory
 * (`usePaginatedCollection` slices `allData`). That is fine at a few hundred documents
 * and ruinous at fifty thousand: every visit to the list costs one read per document,
 * so a tenant's own growth degrades their app and the platform's margin.
 *
 * This hook reads one page at a time with `limit()` + `startAfter()`, so cost is
 * proportional to what the user actually looks at. It is deliberately a SEPARATE hook:
 * silently truncating the existing views would hide data.
 *
 * Requirements when adopting it for a collection:
 *   1. a composite index on (businessId, <orderByField>) — add it to
 *      firestore.indexes.json and deploy indexes BEFORE shipping the caller;
 *   2. sorting/filtering must move server-side (client-side filters would only ever
 *      see the current page).
 */

export interface CursorOptions {
  /** Field to order by (must be indexed together with businessId). */
  orderByField?: string;
  direction?: 'asc' | 'desc';
  pageSize?: number;
  /** Extra server-side equality filters, e.g. [{ field: 'status', value: 'Pending' }]. */
  filters?: { field: string; operator?: any; value: any }[];
  /** Skip the query entirely (e.g. while a required parameter is missing). */
  skip?: boolean;
}

export interface CursorResult<T> {
  items: (T & { id: string })[];
  loading: boolean;
  /** True while a `loadMore()` is in flight (as opposed to the first page). */
  loadingMore: boolean;
  error: Error | null;
  hasMore: boolean;
  loadMore: () => void;
  /** Re-read from the first page (after a write, or a filter change). */
  reload: () => void;
  /** How many documents have actually been read so far. */
  readCount: number;
}

function convert(data: DocumentData): DocumentData {
  const out: DocumentData = {};
  for (const k in data) {
    const v = data[k];
    out[k] = v instanceof Timestamp ? v.toDate() : v;
  }
  return out;
}

export function useCursorCollection<T = DocumentData>(
  collectionName: string,
  options?: CursorOptions,
): CursorResult<T> {
  const businessId = useGlobalBusinessId();
  const {
    orderByField = 'createdAt',
    direction = 'desc',
    pageSize = 25,
    filters,
    skip,
  } = options || {};

  const [items, setItems] = useState<(T & { id: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const cursorRef = useRef<QueryDocumentSnapshot | null>(null);
  const filterKey = JSON.stringify(filters || null);

  const buildConstraints = useCallback((): QueryConstraint[] => {
    const cs: QueryConstraint[] = [where('businessId', '==', businessId)];
    for (const f of filters || []) cs.push(where(f.field, (f.operator || '==') as any, f.value));
    cs.push(orderBy(orderByField, direction));
    cs.push(fsLimit(pageSize));
    return cs;
  }, [businessId, filterKey, orderByField, direction, pageSize]);

  const fetchPage = useCallback(async (mode: 'first' | 'more') => {
    if (!businessId) return;
    if (mode === 'first') { setLoading(true); cursorRef.current = null; } else setLoadingMore(true);
    try {
      const cs = buildConstraints();
      if (mode === 'more' && cursorRef.current) cs.push(startAfter(cursorRef.current));
      const snap = await getDocs(query(collection(db, collectionName), ...cs));
      const page = snap.docs.map((d) => ({ id: d.id, ...convert(d.data()) })) as (T & { id: string })[];
      cursorRef.current = snap.docs[snap.docs.length - 1] || cursorRef.current;
      // A full page means there is probably another one; a short page is the end.
      setHasMore(snap.docs.length === pageSize);
      setItems((prev) => (mode === 'first' ? page : [...prev, ...page]));
      setError(null);
    } catch (err) {
      console.error(`[useCursorCollection] ${collectionName} failed:`, err);
      setError(err as Error);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [businessId, collectionName, buildConstraints, pageSize]);

  useEffect(() => {
    if (skip) { setItems([]); setLoading(false); setHasMore(false); return; }
    if (!businessId) { setItems([]); setLoading(true); return; }
    void fetchPage('first');
  }, [skip, businessId, collectionName, filterKey, orderByField, direction, pageSize]);

  return {
    items,
    loading,
    loadingMore,
    error,
    hasMore,
    loadMore: () => { if (!loadingMore && hasMore) void fetchPage('more'); },
    reload: () => { void fetchPage('first'); },
    readCount: items.length,
  };
}
