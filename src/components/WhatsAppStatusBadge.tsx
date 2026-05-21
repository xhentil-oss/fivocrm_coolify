import React from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { useWhatsAppStatus, type AgentConnectionStatus } from '../hooks/useWhatsAppStatus';

type Variant = 'dot' | 'pill' | 'banner';

interface Props {
  variant?: Variant;
  className?: string;
  /** Show only Baileys channel relevance — hides when only Meta is in use. */
  baileysOnly?: boolean;
}

interface StatusVisual {
  color: string;     // dot bg + ring
  pulse: boolean;
  label: string;     // short label
  longLabel: string; // banner text
  tone: 'ok' | 'warn' | 'err' | 'idle';
}

function visualFor(
  serverOnline: boolean,
  anyConnected: boolean,
  worstAgentStatus: AgentConnectionStatus | null,
  loading: boolean,
): StatusVisual {
  if (loading) {
    return {
      color: 'bg-muted-foreground/40',
      pulse: false,
      label: 'Po kontrollohet…',
      longLabel: 'Po kontrollohet statusi i WhatsApp…',
      tone: 'idle',
    };
  }
  if (!serverOnline) {
    return {
      color: 'bg-red-500',
      pulse: true,
      label: 'Serveri off',
      longLabel: 'Serveri i WhatsApp (Baileys) nuk po përgjigjet. Dërgimi i mesazheve është i bllokuar.',
      tone: 'err',
    };
  }
  if (anyConnected) {
    return {
      color: 'bg-emerald-500',
      pulse: false,
      label: 'I lidhur',
      longLabel: 'WhatsApp Baileys i lidhur dhe gati për dërgim.',
      tone: 'ok',
    };
  }
  if (worstAgentStatus === 'qr_ready') {
    return {
      color: 'bg-amber-500',
      pulse: true,
      label: 'Skano QR',
      longLabel: 'Asnjë agjent i lidhur. Skano kodin QR në Cilësime për të aktivizuar WhatsApp-in.',
      tone: 'warn',
    };
  }
  if (worstAgentStatus === 'connecting') {
    return {
      color: 'bg-amber-500',
      pulse: true,
      label: 'Po lidhet…',
      longLabel: 'Po lidhet me WhatsApp-in… provoni përsëri pas pak sekondash.',
      tone: 'warn',
    };
  }
  return {
    color: 'bg-red-500',
    pulse: true,
    label: 'I shkëputur',
    longLabel: 'Asnjë agjent WhatsApp i lidhur për këtë ekip. Konfiguroni një numër nga Cilësimet.',
    tone: 'err',
  };
}

export const WhatsAppStatusBadge: React.FC<Props> = ({ variant = 'pill', className = '' }) => {
  const { serverOnline, agents, anyConnected, loading, refresh, fetchedAt } = useWhatsAppStatus();

  // Pick the "best representative" status for the badge.
  const worst: AgentConnectionStatus | null = agents.length === 0
    ? null
    : (agents.find((a) => a.status === 'qr_ready')?.status
        || agents.find((a) => a.status === 'connecting')?.status
        || 'disconnected');

  const v = visualFor(serverOnline, anyConnected, worst, loading);

  const lastChecked = fetchedAt
    ? new Date(fetchedAt).toLocaleTimeString('sq-AL', { hour: '2-digit', minute: '2-digit' })
    : '—';

  const title = `${v.longLabel}\nKontrolluar: ${lastChecked}`;

  if (variant === 'dot') {
    return (
      <span
        title={title}
        aria-label={v.longLabel}
        className={`inline-flex items-center ${className}`}
      >
        <span className="relative flex h-2 w-2">
          {v.pulse && (
            <span className={`absolute inline-flex h-full w-full rounded-full ${v.color} opacity-60 animate-ping`} />
          )}
          <span className={`relative inline-flex h-2 w-2 rounded-full ${v.color}`} />
        </span>
      </span>
    );
  }

  if (variant === 'banner') {
    // Don't show a banner when everything is fine — only when there's a real problem.
    if (loading || v.tone === 'ok') return null;
    const tonebg =
      v.tone === 'warn' ? 'bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-400' :
      v.tone === 'err' ? 'bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-400' :
                          'bg-muted border-border text-muted-foreground';
    return (
      <div
        role="status"
        aria-live="polite"
        className={`flex items-center gap-2 px-3 py-2 rounded-md border text-xs leading-snug ${tonebg} ${className}`}
      >
        <span className="relative flex h-2 w-2 shrink-0">
          {v.pulse && (
            <span className={`absolute inline-flex h-full w-full rounded-full ${v.color} opacity-60 animate-ping`} />
          )}
          <span className={`relative inline-flex h-2 w-2 rounded-full ${v.color}`} />
        </span>
        <span className="flex-1">{v.longLabel}</span>
        <button
          type="button"
          onClick={refresh}
          title="Rifresko statusin"
          className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/10 shrink-0"
        >
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
        </button>
      </div>
    );
  }

  // pill
  return (
    <button
      type="button"
      onClick={refresh}
      title={title}
      aria-label={v.longLabel}
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-border bg-background/80 hover:bg-muted text-[10px] font-medium text-foreground ${className}`}
    >
      <span className="relative flex h-1.5 w-1.5">
        {v.pulse && (
          <span className={`absolute inline-flex h-full w-full rounded-full ${v.color} opacity-60 animate-ping`} />
        )}
        <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${v.color}`} />
      </span>
      <span>{v.label}</span>
    </button>
  );
};

export default WhatsAppStatusBadge;
