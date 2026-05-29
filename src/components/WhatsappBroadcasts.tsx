import React, { useState, useMemo } from 'react';
import { useCollection, useMutation } from '../hooks/useFirestore';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../contexts/PermissionsContext';
import { useTeamSettingsData } from '../hooks/useTeamSettings';
import { useToast } from '../hooks/use-toast';
import { X, Megaphone, Send, Loader2, Clock, AlertTriangle } from 'lucide-react';
import { Button } from './ui/button';
import { Timestamp } from 'firebase/firestore';
import type { WhatsAppBroadcast, WhatsAppTemplate, Lead, TeamMember, WhatsAppAccount } from '../types';

interface Props {
  onClose: () => void;
}

const LEAD_STATUSES = ['New', 'Contacted', 'Qualified', 'Follow-up', 'Proposal', 'Won', 'Converted', 'Lost'];
const STATUS_BADGE: Record<string, string> = {
  draft: 'bg-muted text-muted-foreground',
  queued: 'bg-amber-500/15 text-amber-600',
  sending: 'bg-blue-500/15 text-blue-600',
  completed: 'bg-[#25D366]/15 text-[#1da851]',
  failed: 'bg-destructive/15 text-destructive',
};

const WhatsappBroadcasts: React.FC<Props> = ({ onClose }) => {
  const { user } = useAuth();
  const permissions = usePermissions();
  const settings = useTeamSettingsData();
  const { toast } = useToast();

  const { data: broadcasts } = useCollection<WhatsAppBroadcast>('waBroadcasts', {
    orderBy: { field: 'createdAt', direction: 'desc' },
  });
  const { data: templates } = useCollection<WhatsAppTemplate>('waTemplates');
  const { data: leads } = useCollection<Lead>('leads');
  const { data: teamMembers } = useCollection<TeamMember>('teamMembers', {
    where: [{ field: 'status', operator: '==', value: 'Active' }],
  });
  const { data: waAccounts } = useCollection<WhatsAppAccount>('whatsappAccounts');
  const mutation = useMutation<WhatsAppBroadcast>('waBroadcasts');

  const channels = settings?.metaChannels || [];
  const metaEnabled = !!settings?.metaEnabled && channels.length > 0;
  const vpsConfigured = !!settings?.whatsappVpsUrl && !!settings?.whatsappVpsSecret;
  const connectedAgents = (waAccounts || []).filter((a) => a.enabled);

  const [sendChannel, setSendChannel] = useState<'meta' | 'baileys'>('meta');
  const [name, setName] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [channelId, setChannelId] = useState('');
  const [agentId, setAgentId] = useState('');
  const [statuses, setStatuses] = useState<string[]>([]);
  const [tag, setTag] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [busy, setBusy] = useState(false);

  const allTags = useMemo(() => {
    const s = new Set<string>();
    (leads || []).forEach((l) => (l.tags || []).forEach((t) => s.add(t)));
    return Array.from(s).sort();
  }, [leads]);

  const targetCount = useMemo(() => {
    return (leads || []).filter((l) => {
      const phone = l.phone || (l as any).phoneNumber;
      if (!phone) return false;
      if (statuses.length && !statuses.includes(l.status)) return false;
      if (tag && !(l.tags || []).includes(tag)) return false;
      if (assignedTo && l.assignedToUserId !== assignedTo) return false;
      return true;
    }).length;
  }, [leads, statuses, tag, assignedTo]);

  const resetForm = () => {
    setName(''); setTemplateId(''); setStatuses([]); setTag(''); setAssignedTo(''); setScheduledAt('');
  };

  const buildPayload = (status: WhatsAppBroadcast['status']) => ({
    name: name.trim(),
    templateId,
    channel: sendChannel,
    channelPhoneNumberId: sendChannel === 'meta' ? (channelId || channels[0]?.phoneNumberId || '') : '',
    agentId: sendChannel === 'baileys' ? (agentId || connectedAgents[0]?.id || '') : '',
    segment: {
      ...(statuses.length ? { statuses } : {}),
      ...(tag ? { tag } : {}),
      ...(assignedTo ? { assignedToUserId: assignedTo } : {}),
    },
    scheduledAt: scheduledAt ? Timestamp.fromDate(new Date(scheduledAt)) : null,
    status,
    totalTargets: targetCount,
    sentCount: 0,
    createdByUserId: user?.uid || null,
  });

  const validate = () => {
    if (sendChannel === 'meta' && !metaEnabled) { toast({ title: 'Meta s’është konfiguruar', description: 'Zgjidh Baileys ose aktivizo një kanal Meta.', variant: 'destructive' }); return false; }
    if (sendChannel === 'baileys' && (!vpsConfigured || connectedAgents.length === 0)) { toast({ title: 'Baileys s’është gati', description: 'Konfiguro VPS-në dhe një agjent te Cilësimet.', variant: 'destructive' }); return false; }
    if (!name.trim() || !templateId) { toast({ title: 'Mungojnë fushat', description: 'Emri dhe template-i janë të detyrueshëm.', variant: 'destructive' }); return false; }
    if (targetCount === 0) { toast({ title: 'Asnjë target', description: 'Segmenti nuk përmban asnjë lead me numër.', variant: 'destructive' }); return false; }
    return true;
  };

  const saveDraft = async () => {
    if (!name.trim() || !templateId) { toast({ title: 'Mungojnë fushat', variant: 'destructive' }); return; }
    setBusy(true);
    try {
      await mutation.create(buildPayload('draft') as any);
      toast({ title: 'Drafti u ruajt' });
      resetForm();
    } catch { toast({ title: 'Gabim', variant: 'destructive' }); }
    finally { setBusy(false); }
  };

  const queue = async (sendNow: boolean) => {
    if (!validate()) return;
    setBusy(true);
    try {
      const created = await mutation.create(buildPayload('queued') as any);
      if (sendNow) {
        const token = await user!.getIdToken();
        const resp = await fetch('/api/cron/run?job=whatsapp-broadcasts&manual=1', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!resp.ok) {
          const e = await resp.json().catch(() => ({}));
          throw new Error(e?.error || `HTTP ${resp.status}`);
        }
        toast({ title: 'Fushata u nis', description: `${created.name} po dërgohet.` });
      } else {
        toast({ title: 'Fushata u vendos në radhë', description: 'Do dërgohet në ekzekutimin e radhës.' });
      }
      resetForm();
    } catch (err: any) {
      toast({ title: 'Gabim', description: err?.message || 'Dërgimi dështoi.', variant: 'destructive' });
    } finally { setBusy(false); }
  };

  const memberName = (m: TeamMember) => m.displayName || m.email || 'Pa emër';
  const tplName = (id: string) => templates?.find((t) => t.id === id)?.name || id;

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-background border border-border rounded-2xl w-full max-w-3xl max-h-[88vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Megaphone className="w-4 h-4 text-[#25D366]" /> Fushatat WhatsApp
          </h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* New campaign form */}
          <div className="border border-border rounded-lg p-3 space-y-3">
            <h3 className="text-xs font-semibold uppercase text-muted-foreground">Fushatë e re</h3>

            {/* Channel selector */}
            <div className="flex gap-2">
              <button
                onClick={() => setSendChannel('meta')}
                className={`flex-1 text-xs px-3 py-2 rounded-md border ${sendChannel === 'meta' ? 'bg-[#25D366] text-white border-[#25D366]' : 'border-border hover:bg-muted'}`}>
                Meta (zyrtar)
              </button>
              <button
                onClick={() => setSendChannel('baileys')}
                className={`flex-1 text-xs px-3 py-2 rounded-md border ${sendChannel === 'baileys' ? 'bg-amber-500 text-white border-amber-500' : 'border-border hover:bg-muted'}`}>
                Baileys (jozyrtar)
              </button>
            </div>

            {sendChannel === 'baileys' && (
              <div className="flex gap-2 px-3 py-2 rounded-md bg-amber-500/10 border border-amber-500/40 text-[11px] text-amber-700 dark:text-amber-400">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  <strong>Kujdes:</strong> dërgimi masiv përmes një numri personal (Baileys) mund të çojë në
                  <strong> bllokim të numrit nga WhatsApp</strong>. Dërgimi është i ngadaltë me qëllim (≈8 mesazhe/ekzekutim, me vonesa)
                  për të zvogëluar rrezikun — por nuk e eliminon. Përdore vetëm për lista të vogla e kontakte që të presin.
                </span>
              </div>
            )}
            {sendChannel === 'meta' && !metaEnabled && (
              <div className="px-3 py-2 rounded-md bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-700 dark:text-amber-400">
                Aktivizo një kanal Meta te Cilësimet, ose zgjidh Baileys.
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium block mb-1">Emri *</label>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="p.sh. Oferta e Marsit"
                  className="w-full px-3 py-2 bg-muted rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#25D366]/40" />
              </div>
              <div>
                <label className="text-xs font-medium block mb-1">Template *</label>
                <select value={templateId} onChange={(e) => setTemplateId(e.target.value)}
                  className="w-full px-3 py-2 bg-muted rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#25D366]/40">
                  <option value="">— Zgjidh —</option>
                  {templates?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              {sendChannel === 'meta' && channels.length > 1 && (
                <div>
                  <label className="text-xs font-medium block mb-1">Kanali Meta</label>
                  <select value={channelId} onChange={(e) => setChannelId(e.target.value)}
                    className="w-full px-3 py-2 bg-muted rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#25D366]/40">
                    {channels.map((c) => <option key={c.phoneNumberId} value={c.phoneNumberId}>{c.label || c.phone}</option>)}
                  </select>
                </div>
              )}
              {sendChannel === 'baileys' && (
                <div>
                  <label className="text-xs font-medium block mb-1">Agjenti Baileys</label>
                  <select value={agentId} onChange={(e) => setAgentId(e.target.value)}
                    className="w-full px-3 py-2 bg-muted rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/40">
                    <option value="">{connectedAgents[0] ? 'I pari' : '— Asnjë agjent —'}</option>
                    {connectedAgents.map((a) => <option key={a.id} value={a.id}>{a.label}{a.connectedPhone ? ` (${a.connectedPhone})` : ''}</option>)}
                  </select>
                </div>
              )}
              <div>
                <label className="text-xs font-medium block mb-1">Planifiko (opsionale)</label>
                <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)}
                  className="w-full px-3 py-2 bg-muted rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#25D366]/40" />
              </div>
            </div>

            {/* Segment */}
            <div className="space-y-2">
              <label className="text-xs font-medium block">Segmenti</label>
              <div className="flex flex-wrap gap-1.5">
                {LEAD_STATUSES.map((s) => {
                  const on = statuses.includes(s);
                  return (
                    <button key={s} onClick={() => setStatuses((p) => on ? p.filter((x) => x !== s) : [...p, s])}
                      className={`text-xs px-2 py-1 rounded-full border ${on ? 'bg-[#25D366] text-white border-[#25D366]' : 'border-border text-muted-foreground hover:bg-muted'}`}>
                      {s}
                    </button>
                  );
                })}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] text-muted-foreground block mb-1">Tag</label>
                  <input list="wa-bcast-tags" value={tag} onChange={(e) => setTag(e.target.value)} placeholder="çdo tag"
                    className="w-full px-3 py-2 bg-muted rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#25D366]/40" />
                  <datalist id="wa-bcast-tags">{allTags.map((t) => <option key={t} value={t} />)}</datalist>
                </div>
                <div>
                  <label className="text-[11px] text-muted-foreground block mb-1">Caktuar te</label>
                  <select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}
                    className="w-full px-3 py-2 bg-muted rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#25D366]/40">
                    <option value="">Kushdo</option>
                    {teamMembers?.filter((m) => m.userId).map((m) => <option key={m.id} value={m.userId}>{memberName(m)}</option>)}
                  </select>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Target: <span className="font-semibold text-foreground">{targetCount}</span> lead me numër telefoni.
              </p>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={saveDraft} disabled={busy}>Ruaj draft</Button>
              <Button variant="outline" size="sm" onClick={() => queue(false)} disabled={busy}>
                <Clock className="w-3.5 h-3.5 mr-1" /> Vendos në radhë
              </Button>
              {permissions.isAdmin && (
                <Button size="sm" className="bg-[#25D366] hover:bg-[#1da851] text-white" onClick={() => queue(true)} disabled={busy}>
                  {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Send className="w-3.5 h-3.5 mr-1" />} Dërgo tani
                </Button>
              )}
            </div>
          </div>

          {/* Existing campaigns */}
          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase text-muted-foreground">Fushatat ekzistuese</h3>
            {(broadcasts || []).length === 0 && <p className="text-[11px] text-muted-foreground">Asnjë fushatë ende.</p>}
            {(broadcasts || []).map((b) => (
              <div key={b.id} className="flex items-center justify-between gap-3 border border-border rounded-lg px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{b.name}</p>
                  <p className="text-[11px] text-muted-foreground truncate">
                    {tplName(b.templateId)} · {(b.channel || 'meta') === 'baileys' ? 'Baileys' : 'Meta'} · {b.sentCount || 0}/{b.totalTargets ?? '?'} dërguar
                  </p>
                </div>
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${STATUS_BADGE[b.status] || ''}`}>
                  {b.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default WhatsappBroadcasts;
