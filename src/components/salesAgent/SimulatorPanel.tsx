import { useRef, useState } from 'react';
import { Bot, FlaskConical, Loader2, RotateCcw, Send } from 'lucide-react';
import { Card } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import { useToast } from '../../hooks/use-toast';
import { describeSalesAgentError, simulateConversation, type SimulateResult } from '../../lib/salesAgent/api';
import { QUALIFICATION_FIELDS, type AgentStage, type QualificationFieldKey } from '../../lib/salesAgent/core';
import { DECISION_LABELS, STAGE_BADGE_CLASS, STAGE_LABELS, reasonLabel } from './labels';

/**
 * "Simulo bisedë" — the admin plays the client; the SERVER runs the exact same
 * core + model path it would run on a real inbound, but nothing is sent, stamped
 * or logged against a contact. The point is to see the decision (send / draft /
 * handoff + the named reason), not only the reply text.
 */
interface Turn { role: 'client' | 'agent'; text: string; meta?: SimulateResult }

interface Props { personaName: string }

export default function SimulatorPanel({ personaName }: Props) {
  const { toast } = useToast();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [collected, setCollected] = useState<Record<string, string>>({});
  const [stage, setStage] = useState<AgentStage>('greeting');
  const listRef = useRef<HTMLDivElement>(null);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    const next: Turn[] = [...turns, { role: 'client', text }];
    setTurns(next); setInput(''); setBusy(true);
    try {
      const r = await simulateConversation({
        messages: next.map((t) => ({ role: t.role, text: t.text })),
        collected, stage,
      });
      setTurns([...next, { role: 'agent', text: r.output.reply || '(pa tekst)', meta: r }]);
      if (r.collected) setCollected(r.collected);
      if (r.stage) setStage(r.stage);
      setTimeout(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' }), 50);
    } catch (err) {
      toast({ title: 'Simulimi dështoi', description: describeSalesAgentError(err), variant: 'destructive' });
      setTurns(turns);
    } finally {
      setBusy(false);
    }
  };

  const reset = () => { setTurns([]); setCollected({}); setStage('greeting'); setInput(''); };

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold flex items-center gap-2"><FlaskConical className="w-4 h-4" />Simulo bisedë</h3>
          <p className="text-xs text-muted-foreground mt-1">Shkruaj si klient. {personaName} përgjigjet me të njëjtin motor si në WhatsApp — por asgjë nuk dërgohet dhe asnjë kontakt nuk preket.</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Badge className={STAGE_BADGE_CLASS[stage]}>{STAGE_LABELS[stage]}</Badge>
          <Button size="sm" variant="ghost" onClick={reset} disabled={!turns.length}><RotateCcw className="w-4 h-4 mr-1" />Rifillo</Button>
        </div>
      </div>

      <div ref={listRef} className="h-72 overflow-y-auto rounded-lg border bg-muted/20 p-3 space-y-2">
        {turns.length === 0 && <p className="text-sm text-muted-foreground text-center mt-24">P.sh. "Përshëndetje, sa kushton një website?"</p>}
        {turns.map((t, i) => (
          <div key={i} className={`flex ${t.role === 'client' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${t.role === 'client' ? 'bg-primary text-primary-foreground' : 'bg-background border'}`}>
              {t.role === 'agent' && <div className="text-[10px] text-muted-foreground mb-0.5 flex items-center gap-1"><Bot className="w-3 h-3" />{personaName}</div>}
              <p className="whitespace-pre-wrap break-words">{t.text}</p>
              {t.meta && (
                <div className="mt-2 pt-2 border-t text-[11px] text-muted-foreground space-y-1">
                  <div className="flex flex-wrap gap-1.5 items-center">
                    <Badge variant="outline" className="text-[10px]">{DECISION_LABELS[t.meta.decision.mode] || t.meta.decision.mode}</Badge>
                    {t.meta.decision.blockReason && <span>{reasonLabel(t.meta.decision.blockReason)}</span>}
                    {t.meta.decision.handoffReason && <span>{reasonLabel(t.meta.decision.handoffReason)}</span>}
                  </div>
                  <div>intent: <b>{t.meta.output.intent}</b> · besueshmëri: <b>{Math.round((t.meta.output.confidence || 0) * 100)}%</b>{t.meta.output.priceFromFacts ? ' · çmim nga faktet' : ''}</div>
                </div>
              )}
            </div>
          </div>
        ))}
        {busy && <div className="text-xs text-muted-foreground flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" />{personaName} po shkruan…</div>}
      </div>

      <div className="flex gap-2">
        <Input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void send(); } }} placeholder="Shkruaj si klient…" disabled={busy} />
        <Button onClick={send} disabled={busy || !input.trim()}><Send className="w-4 h-4" /></Button>
      </div>

      {Object.keys(collected).length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(collected) as QualificationFieldKey[]).map((k) => (
            <Badge key={k} variant="outline" className="text-[11px]">{QUALIFICATION_FIELDS[k]?.label || k}: {collected[k]}</Badge>
          ))}
        </div>
      )}
    </Card>
  );
}
