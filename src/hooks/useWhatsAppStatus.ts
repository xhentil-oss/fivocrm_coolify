import { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import { useAuth } from '../contexts/AuthContext';
import { getGlobalTeamId } from './useFirestore';

export type AgentConnectionStatus = 'connected' | 'connecting' | 'qr_ready' | 'disconnected';

export interface AgentStatus {
  id: string;
  label: string;
  status: AgentConnectionStatus;
  teamId: string | null;
  assignedToUserId: string | null;
  /** The number the socket is logged in as — only while `status === 'connected'`. */
  connectedPhone?: string | null;
}

export interface WhatsAppStatus {
  serverOnline: boolean;
  agents: AgentStatus[];
  anyConnected: boolean;
  loading: boolean;
  error: string | null;
  fetchedAt: number | null;
  refresh: () => void;
}

const POLL_INTERVAL_MS = 30_000;

interface Snapshot {
  serverOnline: boolean;
  agents: AgentStatus[];
  loading: boolean;
  error: string | null;
  fetchedAt: number | null;
}

const INITIAL: Snapshot = { serverOnline: false, agents: [], loading: true, error: null, fetchedAt: null };

/**
 * ONE poller per tab. Every mounted `useWhatsAppStatus()` (the chat panel, every
 * status badge, Cilësimet) used to start its own 30 s interval against
 * `/api/whatsapp?action=status` — five components on a page meant five VPS calls
 * every 30 s. Now the hooks ref-count a module-level subscription: the first
 * subscriber starts the interval, the last one stops it, and nothing polls while
 * the tab is hidden (a visible tab refreshes immediately).
 */
const store = {
  snapshot: INITIAL as Snapshot,
  listeners: new Set<(s: Snapshot) => void>(),
  user: null as User | null,
  uid: null as string | null,
  timer: null as ReturnType<typeof setInterval> | null,
  inflight: false,
  visibilityBound: false,
};

function emit(next: Snapshot) {
  store.snapshot = next;
  store.listeners.forEach((l) => l(next));
}

async function runOnce() {
  const user = store.user;
  if (!user || store.inflight) return;
  store.inflight = true;
  try {
    const teamId = getGlobalTeamId();
    const token = await user.getIdToken();
    const url = `/api/whatsapp?action=status${teamId ? `&teamId=${encodeURIComponent(teamId)}` : ''}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json().catch(() => ({}));
    if (store.user !== user) return; // user changed mid-flight
    if (!res.ok) {
      emit({ serverOnline: false, agents: [], loading: false, error: data?.error || `HTTP ${res.status}`, fetchedAt: Date.now() });
    } else {
      emit({
        serverOnline: Boolean(data.serverOnline),
        agents: Array.isArray(data.agents) ? data.agents : [],
        loading: false,
        error: data?.error || null,
        fetchedAt: Date.now(),
      });
    }
  } catch (err) {
    if (store.user !== user) return;
    emit({ serverOnline: false, agents: [], loading: false, error: err instanceof Error ? err.message : 'unreachable', fetchedAt: Date.now() });
  } finally {
    store.inflight = false;
  }
}

function isHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

function stopTimer() {
  if (store.timer) {
    clearInterval(store.timer);
    store.timer = null;
  }
}

function startTimer() {
  if (store.timer || !store.user || store.listeners.size === 0 || isHidden()) return;
  store.timer = setInterval(() => { void runOnce(); }, POLL_INTERVAL_MS);
}

function onVisibility() {
  if (isHidden()) {
    stopTimer();
  } else if (store.listeners.size > 0 && store.user) {
    void runOnce();
    startTimer();
  }
}

function bindVisibility() {
  if (store.visibilityBound || typeof document === 'undefined') return;
  document.addEventListener('visibilitychange', onVisibility);
  store.visibilityBound = true;
}

function unbindVisibility() {
  if (!store.visibilityBound || typeof document === 'undefined') return;
  document.removeEventListener('visibilitychange', onVisibility);
  store.visibilityBound = false;
}

function setUser(user: User | null) {
  const uid = user?.uid ?? null;
  store.user = user;
  if (uid !== store.uid) {
    store.uid = uid;
    stopTimer();
    emit(user ? { ...INITIAL } : { ...INITIAL, loading: false });
    if (user && store.listeners.size > 0) {
      void runOnce();
      startTimer();
    }
  }
}

function subscribe(listener: (s: Snapshot) => void, user: User | null): () => void {
  const first = store.listeners.size === 0;
  store.listeners.add(listener);
  setUser(user);
  if (first) {
    bindVisibility();
    // Fresh enough? Reuse it — a re-mount must not re-hit the VPS.
    const stale = !store.snapshot.fetchedAt || Date.now() - store.snapshot.fetchedAt > POLL_INTERVAL_MS / 2;
    if (user && stale && !isHidden()) void runOnce();
    startTimer();
  }
  return () => {
    store.listeners.delete(listener);
    if (store.listeners.size === 0) {
      stopTimer();
      unbindVisibility();
    }
  };
}

/**
 * Health snapshot of the Baileys VPS server and per-agent connection state for
 * the current team (shared, see `store`). Designed to never throw — failed
 * fetches surface as `serverOnline: false`.
 */
export function useWhatsAppStatus(): WhatsAppStatus {
  const { user } = useAuth();
  const [snap, setSnap] = useState<Snapshot>(() => (user ? store.snapshot : { ...INITIAL, loading: false }));

  useEffect(() => {
    if (!user) {
      setSnap({ ...INITIAL, loading: false });
      return;
    }
    setSnap(store.snapshot);
    return subscribe(setSnap, user);
  }, [user]);

  return {
    serverOnline: snap.serverOnline,
    agents: snap.agents,
    anyConnected: snap.agents.some((a) => a.status === 'connected'),
    loading: snap.loading,
    error: snap.error,
    fetchedAt: snap.fetchedAt,
    refresh: () => { void runOnce(); },
  };
}
