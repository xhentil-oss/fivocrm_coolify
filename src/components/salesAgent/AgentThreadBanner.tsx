import { useMemo, useState } from 'react';
import { Bot, Hand, Loader2, Undo2 } from 'lucide-react';
import { useToast } from '../../hooks/use-toast';
import { useTeamSettingsData } from '../../hooks/useTeamSettings';
import { describeSalesAgentError, handoffConversation, resumeConversation } from '../../lib/salesAgent/api';
import { resolveSalesAgentSettings } from '../../lib/salesAgent/core';
import type { ConversationAgentState } from '../../types';
import { STAGE_LABELS, durationLabel, minutesSince, reasonLabel } from './labels';

/**
 * Slim banner above the WhatsApp composer when Ana is (or was) in this thread.
 * Reads `conversation.agent` defensively — legacy threads have none.
 */
interface Props {
  agent: Partial<ConversationAgentState> | null | undefined;
  conversationId: string | undefined;
}

/** "10:42" in the viewer's clock, or null for a missing/past-tense value. */
function dueClock(v: unknown): string | null {
  const d = v instanceof Date ? v : (v as any)?.toDate?.() instanceof Date ? (v as any).toDate() : null;
  if (!d || d.getTime() < Date.now()) return null;
  return d.toLocaleTimeString('sq-AL', { hour: '2-digit', minute: '2-digit' });
}

export default function AgentThreadBanner({ agent, conversationId }: Props) {
  const { toast } = useToast();
  const settings = useTeamSettingsData();
  const persona = useMemo(() => resolveSalesAgentSettings(settings?.salesAgent).persona, [settings?.salesAgent]);
  const [busy, setBusy] = useState(false);
  if (!agent || !conversationId || typeof agent !== 'object') return null;
  const stage = agent.stage || 'greeting';
  const isHandoff = stage === 'handoff' || agent.active === false;
  if (!isHandoff && !agent.active) return null;
  if (stage === 'closed') return null;

  const run = async (kind: 'handoff' | 'resume') => {
    setBusy(true);
    try {
      if (kind === 'handoff') await handoffConversation(conversationId); else await resumeConversation(conversationId);
    } catch (err) {
      toast({ title: 'Nuk u ndryshua', description: describeSalesAgentError(err), variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const openMin = isHandoff ? minutesSince(agent.handoffAt) : null;
  // Level 1 in office hours: say WHEN Ana will answer, so silence is never a mystery.
  const pendingMin = !isHandoff && agent.pendingSend ? minutesSince(agent.pendingDueAt) : null;
  const pendingAt = !isHandoff && agent.pendingSend ? dueClock(agent.pendingDueAt) : null;
  return (
    <div className={`mb-2 px-3 py-2 rounded-md border text-[11px] leading-snug flex items-center justify-between gap-2 ${isHandoff ? 'bg-amber-500/10 border-amber-500/30 text-amber-800 dark:text-amber-300' : 'bg-sky-500/10 border-sky-500/30 text-sky-800 dark:text-sky-300'}`}>
      <span className="flex items-center gap-1.5 min-w-0">
        {isHandoff ? <Hand className="w-3.5 h-3.5 shrink-0" /> : <Bot className="w-3.5 h-3.5 shrink-0" />}
        <span className="truncate">
          {isHandoff
            ? `${persona.name} ia dorëzoi ekipit: ${reasonLabel(agent.handoffReason)}${openMin !== null ? ` · ${durationLabel(openMin)}` : ''}`
            : pendingAt && pendingMin === 0
              ? `${persona.name} i përgjigjet vetë në ${pendingAt} nëse nuk përgjigjesh ti`
              : `${persona.name} po e mban bisedën · faza: ${STAGE_LABELS[stage] || stage}`}
        </span>
      </span>
      <button type="button" disabled={busy} onClick={() => { void run(isHandoff ? 'resume' : 'handoff'); }}
        className="shrink-0 px-2 py-1 rounded border border-current/40 hover:bg-background/60 font-medium inline-flex items-center gap-1">
        {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : isHandoff ? <Undo2 className="w-3 h-3" /> : <Hand className="w-3 h-3" />}
        {isHandoff ? `Ktheja ${persona.name}s` : 'Merre'}
      </button>
    </div>
  );
}
