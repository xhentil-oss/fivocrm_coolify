import React, { useState, useMemo } from 'react';
import { useCollection, useGlobalTeamId } from '../hooks/useFirestore';
import { useUserNames } from '../hooks/useUserNames';
import { getTimestampMs } from '../lib/utils';
import { X, BarChart3 } from 'lucide-react';
import type { WhatsAppMessage, WhatsAppBroadcast, TeamMember } from '../types';

interface Props {
  onClose: () => void;
}

const PERIODS = [
  { key: 7, label: '7 ditë' },
  { key: 30, label: '30 ditë' },
  { key: 90, label: '90 ditë' },
];

function fmtDuration(ms: number): string {
  if (!ms || ms < 0) return '—';
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const rem = min % 60;
  return rem ? `${h}h ${rem}min` : `${h}h`;
}

const WhatsappAnalytics: React.FC<Props> = ({ onClose }) => {
  const teamId = useGlobalTeamId();
  const [days, setDays] = useState(30);

  const { data: messages } = useCollection<WhatsAppMessage>('whatsappMessages', {
    skip: !teamId,
    where: teamId ? [{ field: 'teamId', operator: '==', value: teamId }] : undefined,
    skipTeamFilter: true,
  });
  const { data: broadcasts } = useCollection<WhatsAppBroadcast>('waBroadcasts');
  const { data: teamMembers } = useCollection<TeamMember>('teamMembers');
  const { getName } = useUserNames(teamMembers || []);

  const cutoff = useMemo(() => Date.now() - days * 24 * 60 * 60 * 1000, [days]);

  const scoped = useMemo(
    () => (messages || []).filter((m) => getTimestampMs(m.createdAt) >= cutoff),
    [messages, cutoff]
  );

  const stats = useMemo(() => {
    let inbound = 0, outbound = 0, meta = 0, baileys = 0;
    const phones = new Set<string>();
    const perAgent = new Map<string, number>();
    for (const m of scoped) {
      phones.add(m.phone);
      if (m.direction === 'inbound') inbound++;
      else {
        outbound++;
        const who = (m as any).sentByUid || (m as any).agentId || (m.isTemplate ? '__template__' : '__system__');
        perAgent.set(who, (perAgent.get(who) || 0) + 1);
      }
      if (m.channel === 'meta') meta++;
      else if (m.channel === 'baileys') baileys++;
    }

    // First-response time: per conversation, time from an unanswered inbound to
    // the next outbound. Ignore gaps > 48h as outliers.
    const byPhone = new Map<string, WhatsAppMessage[]>();
    for (const m of scoped) {
      const arr = byPhone.get(m.phone) || [];
      arr.push(m);
      byPhone.set(m.phone, arr);
    }
    const deltas: number[] = [];
    for (const arr of byPhone.values()) {
      arr.sort((a, b) => getTimestampMs(a.createdAt) - getTimestampMs(b.createdAt));
      let pendingInboundMs: number | null = null;
      for (const m of arr) {
        const ms = getTimestampMs(m.createdAt);
        if (m.direction === 'inbound') {
          if (pendingInboundMs == null) pendingInboundMs = ms;
        } else if (pendingInboundMs != null) {
          const d = ms - pendingInboundMs;
          if (d >= 0 && d <= 48 * 60 * 60 * 1000) deltas.push(d);
          pendingInboundMs = null;
        }
      }
    }
    const avgResponse = deltas.length ? deltas.reduce((a, b) => a + b, 0) / deltas.length : 0;
    const responseRate = inbound > 0 ? Math.min(100, Math.round((deltas.length / inbound) * 100)) : 0;

    const agents = Array.from(perAgent.entries())
      .map(([k, v]) => ({
        key: k,
        name: k === '__template__' ? 'Template/Broadcast' : k === '__system__' ? 'Sistemi' : getName(k),
        count: v,
      }))
      .sort((a, b) => b.count - a.count);

    return { inbound, outbound, meta, baileys, conversations: phones.size, avgResponse, responseRate, agents };
  }, [scoped, getName]);

  const broadcastStats = useMemo(() => {
    // Delivered/read counts from messages tagged with broadcastId.
    const delivered = new Map<string, number>();
    const read = new Map<string, number>();
    for (const m of messages || []) {
      const bid = (m as any).broadcastId;
      if (!bid) continue;
      if (m.status === 'read') { read.set(bid, (read.get(bid) || 0) + 1); delivered.set(bid, (delivered.get(bid) || 0) + 1); }
      else if (m.status === 'delivered') delivered.set(bid, (delivered.get(bid) || 0) + 1);
    }
    return (broadcasts || []).map((b) => ({
      ...b,
      delivered: delivered.get(b.id) || 0,
      read: read.get(b.id) || 0,
    }));
  }, [broadcasts, messages]);

  const Card = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <div className="border border-border rounded-lg p-3">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="text-xl font-bold mt-0.5">{value}</p>
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-background border border-border rounded-2xl w-full max-w-2xl max-h-[88vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-[#25D366]" /> Statistika WhatsApp
          </h2>
          <div className="flex items-center gap-2">
            <div className="flex gap-1">
              {PERIODS.map((p) => (
                <button key={p.key} onClick={() => setDays(p.key)}
                  className={`text-xs px-2 py-1 rounded-full border ${days === p.key ? 'bg-[#25D366] text-white border-[#25D366]' : 'border-border text-muted-foreground hover:bg-muted'}`}>
                  {p.label}
                </button>
              ))}
            </div>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Card label="Mesazhe hyrëse" value={stats.inbound} />
            <Card label="Mesazhe dalëse" value={stats.outbound} />
            <Card label="Biseda unike" value={stats.conversations} />
            <Card label="Koha mes. e përgjigjes" value={fmtDuration(stats.avgResponse)} />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Card label="Norma e përgjigjes" value={`${stats.responseRate}%`} />
            <Card label="Meta" value={stats.meta} />
            <Card label="Baileys" value={stats.baileys} />
          </div>

          {/* Per agent */}
          <section>
            <h3 className="text-xs font-semibold uppercase text-muted-foreground mb-2">Dalëse për agjent</h3>
            <div className="space-y-1">
              {stats.agents.length === 0 && <p className="text-[11px] text-muted-foreground">Asnjë mesazh dalës.</p>}
              {stats.agents.map((a) => (
                <div key={a.key} className="flex items-center justify-between text-sm">
                  <span className="truncate">{a.name}</span>
                  <span className="font-medium">{a.count}</span>
                </div>
              ))}
            </div>
          </section>

          {/* Broadcasts */}
          <section>
            <h3 className="text-xs font-semibold uppercase text-muted-foreground mb-2">Performanca e fushatave</h3>
            {broadcastStats.length === 0 && <p className="text-[11px] text-muted-foreground">Asnjë fushatë.</p>}
            <div className="space-y-1.5">
              {broadcastStats.map((b) => (
                <div key={b.id} className="flex items-center justify-between gap-3 text-sm border border-border rounded-md px-3 py-1.5">
                  <span className="truncate flex-1">{b.name}</span>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {b.sentCount || 0} dërguar · {b.delivered} dorëzuar · {b.read} lexuar
                  </span>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};

export default WhatsappAnalytics;
