import { useState, useEffect, useCallback } from 'react';

/**
 * P2.2 — named, reusable CRM lead filter sets ("segments"), persisted to
 * localStorage. (A Firestore-backed variant for cross-device sync can layer on
 * later via useMutation; localStorage is enough for a single-device workflow.)
 */
export interface LeadSegmentFilters {
  searchQuery: string;
  scoreFilter: string;
  assignedFilter: string;
  sourceFilter: string;
  tagFilter: string;
  sortBy: string;
  sortDir: string;
  activeTab: string;
}

export interface LeadSegment {
  name: string;
  filters: LeadSegmentFilters;
}

const KEY = 'fivocrm:crm:segments';

export function useSavedSegments() {
  const [segments, setSegments] = useState<LeadSegment[]>(() => {
    try {
      const raw = localStorage.getItem(KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(segments)); } catch { /* quota / private mode */ }
  }, [segments]);

  const saveSegment = useCallback((name: string, filters: LeadSegmentFilters) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSegments(prev => [...prev.filter(s => s.name !== trimmed), { name: trimmed, filters }]);
  }, []);

  const deleteSegment = useCallback((name: string) => {
    setSegments(prev => prev.filter(s => s.name !== name));
  }, []);

  return { segments, saveSegment, deleteSegment };
}
