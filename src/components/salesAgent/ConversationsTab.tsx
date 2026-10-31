import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bot, ExternalLink, Hand, Loader2, Undo2 } from 'lucide-react';
import { Card } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { useCollection, useGlobalBusinessId } from '../../hooks/useFirestore';
import { useToast } from '../../hooks/use-toast';
import { describeSalesAgentError, handoffConversation, resumeConversation } from '../../lib/salesAgent/api';
import { QUALIFICATION_FIELDS, type QualificationFieldKey } from '../../lib/salesAgent/core';
import type { Conversation, ConversationAgentState } from '../../types';
import { STAGE_BADGE_CLASS, STAGE_LABELS, durationLabel, minutesSince, reasonLabel } from './labels';

/**
 * Bisedat: the threads Ana holds right now + the ones she handed to the team.
 * `conversations` is not a team-scoped collection in useFirestore, so both reads
 * carry the tenant predicate explicitly (rules: isBusinessMember(businessId)).
 * Indexes needed: conversations (businessId, agent.active) and (businessId, agent.stage).
 */
type AgentConversation = Conversation & { agent?: ConversationAgentState; leadName?: string; customerName?: string; contactName?: string };

interface Props { personaName: string; canAct: boolean }

export default function ConversationsTab({ personaName, canAct }: Props) {
  const { toast } = useToast();
  const businessId = useGlobalBusinessId();
  const { data: active, loading: l1 } = useCollection<AgentConversation>('conversations', {
    where: [{ field: 'businessId', operator: '==', value: businessId }, { field: 'agent.active', operator: '==', value: true }],
    limit: 100, skip: !businessId, live: true,
  });
  const { data: handed, loading: l2 } = useCollection<AgentConversation>('conversations', {
    where: [{ field: 'businessId', operator: '==', value: businessId }, { field: 'agent.stage', operator: '==', value: 'handoff' }],
    limit: 100, skip: !businessId, live: true,
  });
  const [busy, setBusy] = useState<string | null>(null);

  const rows = useMemo(() => {
    const byId = new Map<string, AgentConversation>();
    [...(handed || []), ...(active || [])].forEach((c) => byId.set(c.id, c));
    return [...byId.values()].sort((a, b) => {
      const ha = a.agent?.stage === 'handoff' ? 0 : 1; const hb = b.agent?.stage === 'handoff' ? 0 : 1;
      if (ha !== hb) return ha - hb;
      return (minutesSince(b.lastMessageAt) ?? 0) - (minutesSince(a.lastMessageAt) ?? 0);
    });
  }, [active, handed]);

  const act = async (c: AgentConversation, kind: 'handoff' | 'resume') => {
    setBusy(c.id);
    try {
      if (kind === 'handoff') { await handoffConversation(c.id); toast({ title: 'E more ti', description: `${personaName} hesht në këtë bisedë derisa t'ia kthesh.` }); }
      else { await resumeConversation(c.id); toast({ title: `Iu kthye ${personaName}s` }); }
    } catch (err) {
      toast({ title: 'Nuk u ndryshua', description: describeSalesAgentError(err), variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  const nameOf = (c: AgentConversation) => c.contactName || c.leadName || c.customerName || c.subject || c.phone || c.id;
  const openLink = (c: AgentConversation) => (c.channel === 'whatsapp' && c.phone ? `/app/whatsapp?phone=${encodeURIComponent(c.phone)}` : c.customerId ? `/app/customers/${c.customerId}` : c.leadId ? `/app/crm?lead=${c.leadId}` : null);

  if (l1 || l2) return <p className="text-sm text-muted-foreground p-4">Duke ngarkuar…</p>;
  if (!rows.length) {
    return <Card className="p-8 text-center text-sm text-muted-foreground"><Bot className="w-6 h-6 mx-auto mb-2 opacity-60" />{personaName} nuk mban asnjë bisedë tani. Kur një klient shkruan në WhatsApp, në portal ose nga një formular, biseda shfaqet këtu.</Card>;
  }

  return (
    <ul className="space-y-2">
      {rows.map((c) => {
        const a = c.agent;
        const stage = a?.stage || 'greeting';
        const isHandoff = stage === 'handoff';
        const openMin = isHandoff ? minutesSince(a?.handoffAt) : null;
        const collected = a?.collected || {};
        const link = openLink(c);
        return (
          <Card key={c.id} className={`p-3 ${isHandoff ? 'border-amber-300/70' : ''}`}>
            <div className="flex flex-wrap items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium truncate">{nameOf(c)}</span>
                  {c.phone && c.phone !== nameOf(c) && <span className="text-xs text-muted-foreground">{c.phone}</span>}
                  <Badge className={`${STAGE_BADGE_CLASS[stage]} text-[10px]`}>{STAGE_LABELS[stage]}</Badge>
                  <Badge variant="outline" className="text-[10px]">{c.channel}</Badge>
                  {a && <span className="text-[11px] text-muted-foreground">{a.turns || 0} kthesa</span>}
                </div>
                {isHandoff && (
                  <p className="text-xs text-amber-800 dark:text-amber-300 mt-1 flex items-center gap-1"><Hand className="w-3.5 h-3.5" />{reasonLabel(a?.handoffReason)}{openMin !== null ? ` · hapur prej ${durationLabel(openMin)}` : ''}</p>
                )}
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {(Object.keys(collected) as QualificationFieldKey[]).map((k) => (
                    <span key={k} className="text-[10px] px-1.5 py-0.5 rounded bg-muted"><b>{QUALIFICATION_FIELDS[k]?.label || k}:</b> {collected[k]}</span>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {canAct && (isHandoff || a?.active === false ? (
                  <Button size="sm" variant="outline" className="h-8 text-xs" disabled={busy === c.id} onClick={() => act(c, 'resume')}>{busy === c.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Undo2 className="w-3.5 h-3.5 mr-1" />}Ktheja {personaName}s</Button>
                ) : (
                  <Button size="sm" variant="outline" className="h-8 text-xs" disabled={busy === c.id} onClick={() => act(c, 'handoff')}>{busy === c.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Hand className="w-3.5 h-3.5 mr-1" />}Merre</Button>
                ))}
                {link && <Button asChild size="sm" variant="ghost" className="h-8 text-xs"><Link to={link}>Hap bisedën <ExternalLink className="w-3.5 h-3.5 ml-1" /></Link></Button>}
              </div>
            </div>
          </Card>
        );
      })}
    </ul>
  );
}
