import React, { useMemo, useState } from 'react';
import { Phone, Mail, MessageSquare, StickyNote, Users, Flag, UserCheck, Plus, CheckCircle2, RefreshCw, Pencil } from 'lucide-react';
import { useCollection, useMutation } from '../hooks/useFirestore';
import { useAuth } from '../contexts/AuthContext';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { useToast } from '../hooks/use-toast';
import { getTimestampMs } from '../lib/utils';
import type { LeadActivity, LeadActivityType } from '../types';

/** Append a lead activity. Exposed so non-UI callers (CRM handlers) can reuse it. */
export async function logLeadActivity(
  create: (data: any) => Promise<any>,
  entry: { leadId: string; type: LeadActivityType; title: string; body?: string; meta?: Record<string, any>; userName?: string }
): Promise<void> {
  try {
    await create({
      leadId: entry.leadId,
      type: entry.type,
      title: entry.title,
      body: entry.body || undefined,
      meta: entry.meta || undefined,
      userName: entry.userName || undefined,
    });
  } catch { /* non-critical */ }
}

const TYPE_META: Record<string, { icon: React.ReactNode; dot: string }> = {
  created:            { icon: <Plus className="w-3.5 h-3.5" />,         dot: 'bg-slate-400' },
  status_changed:     { icon: <RefreshCw className="w-3.5 h-3.5" />,    dot: 'bg-blue-500' },
  assigned:           { icon: <UserCheck className="w-3.5 h-3.5" />,    dot: 'bg-violet-500' },
  note:               { icon: <StickyNote className="w-3.5 h-3.5" />,   dot: 'bg-amber-500' },
  call:               { icon: <Phone className="w-3.5 h-3.5" />,        dot: 'bg-emerald-500' },
  email:              { icon: <Mail className="w-3.5 h-3.5" />,         dot: 'bg-sky-500' },
  whatsapp:           { icon: <MessageSquare className="w-3.5 h-3.5" />, dot: 'bg-green-500' },
  meeting:            { icon: <Users className="w-3.5 h-3.5" />,        dot: 'bg-indigo-500' },
  followup_scheduled: { icon: <Flag className="w-3.5 h-3.5" />,         dot: 'bg-orange-500' },
  converted:          { icon: <CheckCircle2 className="w-3.5 h-3.5" />, dot: 'bg-emerald-600' },
  lost:               { icon: <Flag className="w-3.5 h-3.5" />,         dot: 'bg-red-500' },
  field_updated:      { icon: <Pencil className="w-3.5 h-3.5" />,       dot: 'bg-slate-400' },
};

function relativeTime(d: Date): string {
  const diff = Date.now() - d.getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return 'tani';
  if (min < 60) return `${min} min më parë`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} orë më parë`;
  const days = Math.round(h / 24);
  if (days < 30) return `${days} ditë më parë`;
  return d.toLocaleDateString('sq-AL', { day: '2-digit', month: 'short', year: 'numeric' });
}

const COMPOSER_TYPES: { value: LeadActivityType; label: string }[] = [
  { value: 'note', label: 'Shënim' },
  { value: 'call', label: 'Telefonatë' },
  { value: 'email', label: 'Email' },
  { value: 'meeting', label: 'Takim' },
];

const CALL_OUTCOMES = ['U përgjigj', 'Nuk u përgjigj', 'La mesazh', 'I zënë', 'Numër gabim'];

const LeadTimeline: React.FC<{ leadId: string; onLogged?: (type: LeadActivityType) => void }> = ({ leadId, onLogged }) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const activityMutation = useMutation<LeadActivity>('leadActivities');
  const [composerType, setComposerType] = useState<LeadActivityType>('note');
  const [text, setText] = useState('');
  const [callOutcome, setCallOutcome] = useState(CALL_OUTCOMES[0]);
  const [saving, setSaving] = useState(false);

  const { data: activities, loading } = useCollection<LeadActivity>('leadActivities', {
    where: [{ field: 'leadId', operator: '==', value: leadId }],
    orderBy: { field: 'createdAt', direction: 'desc' },
  });

  const sorted = useMemo(
    () => (activities || []).slice().sort((a, b) => getTimestampMs(b.createdAt) - getTimestampMs(a.createdAt)),
    [activities]
  );

  const handleLog = async () => {
    if (!text.trim() && composerType !== 'call') return;
    setSaving(true);
    try {
      const label = COMPOSER_TYPES.find(t => t.value === composerType)?.label || 'Shënim';
      const title = composerType === 'call'
        ? `Telefonatë — ${callOutcome}`
        : composerType === 'email' ? 'Email i dërguar'
        : composerType === 'meeting' ? 'Takim'
        : 'Shënim';
      await logLeadActivity(activityMutation.create, {
        leadId,
        type: composerType,
        title,
        body: text.trim() || undefined,
        meta: composerType === 'call' ? { outcome: callOutcome } : undefined,
        userName: user?.displayName || user?.email || undefined,
      });
      setText('');
      onLogged?.(composerType);
      toast({ title: `${label} u regjistrua` });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Composer */}
      <div className="rounded-lg border border-border p-3 space-y-2 bg-muted/20">
        <div className="flex items-center gap-2">
          <Select value={composerType} onValueChange={(v) => setComposerType(v as LeadActivityType)}>
            <SelectTrigger className="h-8 w-[130px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {COMPOSER_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
            </SelectContent>
          </Select>
          {composerType === 'call' && (
            <Select value={callOutcome} onValueChange={setCallOutcome}>
              <SelectTrigger className="h-8 flex-1 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CALL_OUTCOMES.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
        </div>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={composerType === 'call' ? 'Shënime nga telefonata (opsionale)…' : 'Shkruaj…'}
          rows={2}
          className="text-sm resize-none"
        />
        <div className="flex justify-end">
          <Button size="sm" onClick={handleLog} disabled={saving || (!text.trim() && composerType !== 'call')}>
            <Plus className="w-3.5 h-3.5 mr-1" /> Regjistro
          </Button>
        </div>
      </div>

      {/* Timeline */}
      {loading ? (
        <p className="text-body-sm text-muted-foreground text-center py-6">Duke ngarkuar…</p>
      ) : sorted.length === 0 ? (
        <p className="text-body-sm text-muted-foreground text-center py-6">Asnjë aktivitet ende. Regjistro një veprim më sipër.</p>
      ) : (
        <div className="relative pl-5">
          <div className="absolute left-[7px] top-1 bottom-1 w-px bg-border" />
          <div className="space-y-4">
            {sorted.map((a) => {
              const meta = TYPE_META[a.type] || TYPE_META.note;
              const when = a.createdAt instanceof Date ? a.createdAt : new Date(getTimestampMs(a.createdAt));
              return (
                <div key={a.id} className="relative flex gap-3">
                  <div className={`absolute -left-5 mt-0.5 w-4 h-4 rounded-full flex items-center justify-center text-white ${meta.dot}`}>
                    <span className="scale-[0.6]">{meta.icon}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground font-medium">{a.title}</p>
                    {a.body && <p className="text-sm text-muted-foreground whitespace-pre-wrap mt-0.5">{a.body}</p>}
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {relativeTime(when)}{a.userName ? ` · ${a.userName}` : ''}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default LeadTimeline;
