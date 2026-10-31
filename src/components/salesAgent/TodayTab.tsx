import React, { useEffect, useMemo, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { Bot, CalendarCheck, Hand, Loader2, MessageSquare, Search, Sparkles } from 'lucide-react';
import { Card } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { db } from '../../lib/firebase';
import { useCollection, useGlobalBusinessId } from '../../hooks/useFirestore';
import { useToast } from '../../hooks/use-toast';
import { getTimestampMs } from '../../lib/utils';
import { describeSalesAgentError, enableSalesAgent } from '../../lib/salesAgent/api';
import { localParts } from '../../lib/salesAgent/core';
import type { Conversation, ConversationAgentState, Prospect, SalesAgentRun } from '../../types';
import { DECISION_LABELS, reasonLabel } from './labels';

/**
 * Sot: what Ana did and did not do, and where a HUMAN is needed. Every number here
 * is a count of documents — the "Pse nuk veproi" list is the run log of the last 24h
 * grouped by its named reason (law 3: nothing is ever a silent skip).
 *
 * Reads (all tenant-scoped):
 *   conversations (businessId, agent.stage == 'handoff') · (businessId, agent.active == true)
 *   prospects (businessId) — status filtered client-side
 *   salesAgentRuns (businessId, createdAt >= now-24h) order createdAt desc limit 300 (teamScopedWhere)
 *   salesAgentUsage/{bid}_{YYYY-MM-DD} and /{bid}_{YYYY-MM} (getDoc)
 */
interface Props {
  enabled: boolean;
  personaName: string;
  canEnable: boolean;
  teamId: string | null;
  lastRun?: Record<string, unknown> | null;
  dailyReplyCap: number;
  placesBudget: number;
  onUsage?: (u: { repliesToday: number; placesRequestsMonth: number }) => void;
}

const Stat = ({ icon: Icon, label, value, tone }: { icon: React.ComponentType<{ className?: string }>; label: string; value: number; tone?: 'warn' | 'ok' }) => (
  <Card className={`p-4 ${tone === 'warn' && value > 0 ? 'border-amber-300/70' : ''}`}>
    <div className="flex items-center justify-between">
      <span className="text-xs text-muted-foreground">{label}</span>
      <Icon className={`w-4 h-4 ${tone === 'warn' && value > 0 ? 'text-amber-600' : 'text-muted-foreground'}`} />
    </div>
    <div className="text-2xl font-semibold mt-1 tabular-nums">{value}</div>
  </Card>
);

export default function TodayTab({ enabled, personaName, canEnable, teamId, lastRun, dailyReplyCap, placesBudget, onUsage }: Props) {
  const { toast } = useToast();
  const businessId = useGlobalBusinessId();
  const [enabling, setEnabling] = useState(false);
  const since = useMemo(() => new Date(Date.now() - 24 * 3_600_000), []);
  const weekAgo = useMemo(() => Date.now() - 7 * 86_400_000, []);

  const { data: handoffs } = useCollection<Conversation & { agent?: ConversationAgentState }>('conversations', {
    where: [{ field: 'businessId', operator: '==', value: businessId }, { field: 'agent.stage', operator: '==', value: 'handoff' }], limit: 100, skip: !businessId || !enabled, live: true,
  });
  const { data: held } = useCollection<Conversation & { agent?: ConversationAgentState }>('conversations', {
    where: [{ field: 'businessId', operator: '==', value: businessId }, { field: 'agent.active', operator: '==', value: true }], limit: 200, skip: !businessId || !enabled, live: true,
  });
  const { data: prospects } = useCollection<Prospect>('prospects', { skip: !enabled });
  const { data: runs } = useCollection<SalesAgentRun>('salesAgentRuns', {
    where: [{ field: 'createdAt', operator: '>=', value: since }], orderBy: { field: 'createdAt', direction: 'desc' }, limit: 300, teamScopedWhere: true, skip: !enabled,
  });

  const [usage, setUsage] = useState<{ repliesToday: number; placesRequestsMonth: number }>({ repliesToday: 0, placesRequestsMonth: 0 });
  useEffect(() => {
    if (!businessId) return;
    const lp = localParts(new Date(), 'Europe/Tirane');
    let cancelled = false;
    (async () => {
      try {
        const [d, m] = await Promise.all([
          getDoc(doc(db, 'salesAgentUsage', `${businessId}_${lp.date}`)),
          getDoc(doc(db, 'salesAgentUsage', `${businessId}_${lp.date.slice(0, 7)}`)),
        ]);
        if (cancelled) return;
        const u = { repliesToday: Number((d.data() as any)?.replies || 0), placesRequestsMonth: Number((m.data() as any)?.placesRequests || 0) };
        setUsage(u); onUsage?.(u);
      } catch { /* a missing doc or a denied read leaves the counters at 0 */ }
    })();
    return () => { cancelled = true; };
  }, [businessId, onUsage]);

  const awaiting = useMemo(() => (prospects || []).filter((p) => p.status === 'new').length, [prospects]);
  const registeredWeek = useMemo(() => (prospects || []).filter((p) => p.status === 'registered' && getTimestampMs(p.registeredAt) >= weekAgo).length, [prospects, weekAgo]);
  const booked = useMemo(() => (runs || []).filter((r) => r.kind === 'book' && r.decision === 'send').length, [runs]);

  const grouped = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of runs || []) {
      const key = r.decision === 'send' ? null : r.blockReason || r.handoffReason || (r.decision === 'draft' ? 'autonomy-draft' : null);
      if (!key) continue;
      m.set(`${r.decision}|${key}`, (m.get(`${r.decision}|${key}`) || 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => { const [decision, reason] = k.split('|'); return { decision, reason, n }; });
  }, [runs]);
  const sent = useMemo(() => (runs || []).filter((r) => r.decision === 'send').length, [runs]);

  const handleEnable = async () => {
    if (!teamId) return;
    setEnabling(true);
    try { await enableSalesAgent(teamId); toast({ title: `${personaName} u aktivizua`, description: 'Fillon në nivelin 0 (vetëm sugjerime) derisa ta ndryshosh te Cilësimet.' }); }
    catch (err) { toast({ title: 'Nuk u aktivizua', description: describeSalesAgentError(err), variant: 'destructive' }); }
    finally { setEnabling(false); }
  };

  if (!enabled) {
    return (
      <Card className="p-6 sm:p-8 text-center space-y-3">
        <div className="w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center mx-auto"><Bot className="w-6 h-6" /></div>
        <h3 className="text-lg font-semibold">Aktivizo {personaName}n</h3>
        <p className="text-sm text-muted-foreground max-w-xl mx-auto">
          {personaName} gjen prospekte në Google Maps, u përgjigjet klientëve që shkruajnë në WhatsApp/portal/formular, i kualifikon me pyetje të thjeshta dhe ia dorëzon ekipit kur duhet një person. Fillon në nivelin 0: vetëm sugjerime, asgjë nuk dërgohet pa ty.
        </p>
        {canEnable ? (
          <Button onClick={handleEnable} disabled={enabling || !teamId}>{enabling ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}Aktivizo {personaName}n</Button>
        ) : (
          <p className="text-xs text-amber-700">Kërko Adminit ose pronarit ta aktivizojë.</p>
        )}
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat icon={Hand} label="Presin një person" value={(handoffs || []).length} tone="warn" />
        <Stat icon={MessageSquare} label={`Biseda që i mban ${personaName}`} value={(held || []).length} />
        <Stat icon={Search} label="Prospekte për shqyrtim" value={awaiting} />
        <Stat icon={CalendarCheck} label="Takime (24 orë)" value={booked} />
      </div>

      <div className="grid lg:grid-cols-[2fr_1fr] gap-4">
        <Card className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Pse nuk veproi (24 orët e fundit)</h3>
            <span className="text-xs text-muted-foreground">{sent} dërgime · {(runs || []).length} vendime</span>
          </div>
          {grouped.length === 0 ? (
            <p className="text-sm text-muted-foreground">{(runs || []).length ? `Çdo vendim i ${personaName}s ishte një dërgim.` : 'Asnjë vendim ende — kur klientët të shkruajnë, çdo arsye mos-veprimi shfaqet këtu me emër.'}</p>
          ) : (
            <ul className="divide-y">
              {grouped.map((g) => (
                <li key={`${g.decision}-${g.reason}`} className="py-2 flex items-center justify-between gap-3 text-sm">
                  <div className="flex items-center gap-2 min-w-0"><Badge variant="outline" className="text-[10px] shrink-0">{DECISION_LABELS[g.decision] || g.decision}</Badge><span className="truncate">{reasonLabel(g.reason)}</span></div>
                  <span className="tabular-nums font-medium">×{g.n}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="p-4 space-y-2 text-sm">
          <h3 className="font-semibold">Kostoja sot</h3>
          <div className="flex justify-between"><span className="text-muted-foreground">Përgjigje AI sot</span><span className="tabular-nums">{usage.repliesToday}/{dailyReplyCap}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Kërkesa Places këtë muaj</span><span className="tabular-nums">{usage.placesRequestsMonth}/{placesBudget}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Lead të regjistruar (7 ditë)</span><span className="tabular-nums">{registeredWeek}</span></div>
          {lastRun && Object.keys(lastRun).length > 0 && (
            <div className="pt-2 border-t text-xs text-muted-foreground space-y-0.5">
              <div className="font-medium text-foreground">Ekzekutimi i fundit</div>
              {Object.entries(lastRun).slice(0, 6).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-2"><span className="truncate">{k}</span><span className="truncate max-w-[55%] text-right">{typeof v === 'object' && v ? JSON.stringify(v).slice(0, 60) : String(v ?? '')}</span></div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
