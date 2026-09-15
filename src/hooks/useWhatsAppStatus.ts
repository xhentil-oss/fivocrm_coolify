import { useEffect, useRef, useState } from 'react';
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

/**
 * Polls /api/whatsapp?action=status every 30s. Returns the latest health
 * snapshot of the Baileys VPS server and per-agent connection state for
 * the current team. Designed to never throw — failed fetches surface as
 * `serverOnline: false`.
 */
export function useWhatsAppStatus(): WhatsAppStatus {
  const { user } = useAuth();
  const [serverOnline, setServerOnline] = useState(false);
  const [agents, setAgents] = useState<AgentStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    let cancelled = false;

    const run = async () => {
      try {
        const teamId = getGlobalTeamId();
        const token = await user.getIdToken();
        const url = `/api/whatsapp?action=status${teamId ? `&teamId=${encodeURIComponent(teamId)}` : ''}`;
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled || !aliveRef.current) return;
        if (!res.ok) {
          setServerOnline(false);
          setAgents([]);
          setError(data?.error || `HTTP ${res.status}`);
        } else {
          setServerOnline(Boolean(data.serverOnline));
          setAgents(Array.isArray(data.agents) ? data.agents : []);
          setError(data?.error || null);
        }
        setFetchedAt(Date.now());
      } catch (err) {
        if (cancelled || !aliveRef.current) return;
        setServerOnline(false);
        setAgents([]);
        setError(err instanceof Error ? err.message : 'unreachable');
        setFetchedAt(Date.now());
      } finally {
        if (!cancelled && aliveRef.current) setLoading(false);
      }
    };

    run();
    const id = setInterval(run, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [user, tick]);

  return {
    serverOnline,
    agents,
    anyConnected: agents.some((a) => a.status === 'connected'),
    loading,
    error,
    fetchedAt,
    refresh: () => setTick((t) => t + 1),
  };
}
