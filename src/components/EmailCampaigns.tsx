import React, { useState, useMemo } from 'react';
import { useCollection, useMutation } from '../hooks/useFirestore';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../contexts/PermissionsContext';
import { useToast } from '../hooks/use-toast';
import { Send, Loader2, Clock, Mail } from 'lucide-react';
import { Button } from './ui/button';
import { Timestamp } from 'firebase/firestore';
import type { EmailCampaign, EmailTemplate, Lead, Customer, TeamMember } from '../types';

// Normalize tags from either an array (leads) or a comma string (customers).
function entityTags(e: { tags?: unknown }): string[] {
  const t = e.tags;
  if (Array.isArray(t)) return t.map((x) => String(x).trim()).filter(Boolean);
  if (typeof t === 'string') return t.split(',').map((s) => s.trim()).filter(Boolean);
  return [];
}
const isValidEmail = (e?: string) => !!e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e).trim());

const LEAD_STATUSES = [
  { value: 'New', label: 'Të reja' },
  { value: 'Contacted', label: 'Kontaktuara' },
  { value: 'Qualified', label: 'Kualifikuara' },
  { value: 'Follow-up', label: 'Në ndjekje' },
  { value: 'Converted', label: 'Konvertuara' },
  { value: 'Lost', label: 'Humbura' },
];
const STATUS_BADGE: Record<string, string> = {
  draft: 'bg-muted text-muted-foreground',
  queued: 'bg-amber-500/15 text-amber-600',
  sending: 'bg-blue-500/15 text-blue-600',
  completed: 'bg-emerald-500/15 text-emerald-600',
  failed: 'bg-destructive/15 text-destructive',
};

const EmailCampaigns: React.FC = () => {
  const { user } = useAuth();
  const permissions = usePermissions();
  const { toast } = useToast();

  const { data: campaigns } = useCollection<EmailCampaign>('emailCampaigns', {
    orderBy: { field: 'createdAt', direction: 'desc' },
  });
  const { data: templates } = useCollection<EmailTemplate>('emailTemplates');
  const { data: leads } = useCollection<Lead>('leads', { skipTeamFilter: true });
  const { data: customers } = useCollection<Customer>('customers', { skipTeamFilter: true });
  const { data: teamMembers } = useCollection<TeamMember>('teamMembers', {
    where: [{ field: 'status', operator: '==', value: 'Active' }],
  });
  const mutation = useMutation<EmailCampaign>('emailCampaigns');

  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [fromName, setFromName] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [htmlBody, setHtmlBody] = useState('');
  const [audience, setAudience] = useState<('leads' | 'customers')[]>(['leads', 'customers']);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [tagMatch, setTagMatch] = useState<'any' | 'all'>('any');
  const [assignedTo, setAssignedTo] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [busy, setBusy] = useState(false);

  const selectedTpl = templates?.find((t) => t.id === templateId);
  const effectiveHtml = templateId ? (selectedTpl?.html || '') : htmlBody;

  const allTags = useMemo(() => {
    const s = new Set<string>();
    (leads || []).forEach((l) => entityTags(l).forEach((t) => s.add(t)));
    (customers || []).forEach((c) => entityTags(c).forEach((t) => s.add(t)));
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [leads, customers]);

  const tagsMatch = (list: string[]) => {
    if (selectedTags.length === 0) return true;
    return tagMatch === 'all' ? selectedTags.every((t) => list.includes(t)) : selectedTags.some((t) => list.includes(t));
  };
  const toggleTag = (t: string) => setSelectedTags((p) => (p.includes(t) ? p.filter((x) => x !== t) : [...p, t]));
  const toggleAudience = (a: 'leads' | 'customers') => setAudience((p) => (p.includes(a) ? p.filter((x) => x !== a) : [...p, a]));

  // Counts across selected audiences, deduped by email.
  const stats = useMemo(() => {
    let matched = 0;
    const emails = new Set<string>();
    if (audience.includes('leads')) {
      for (const l of leads || []) {
        if (statuses.length && !statuses.includes(l.status)) continue;
        if (!tagsMatch(entityTags(l))) continue;
        if (assignedTo && l.assignedToUserId !== assignedTo) continue;
        matched++;
        if (isValidEmail(l.email)) emails.add(String(l.email).trim().toLowerCase());
      }
    }
    if (audience.includes('customers')) {
      for (const c of customers || []) {
        if (!tagsMatch(entityTags(c))) continue;
        if (assignedTo && c.assignedToUserId !== assignedTo) continue;
        matched++;
        if (isValidEmail(c.email)) emails.add(String(c.email).trim().toLowerCase());
      }
    }
    return { matched, withEmail: emails.size };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leads, customers, audience, statuses, selectedTags, tagMatch, assignedTo]);
  const targetCount = stats.withEmail;

  const resetForm = () => {
    setName(''); setSubject(''); setTemplateId(''); setHtmlBody(''); setStatuses([]); setSelectedTags([]); setAssignedTo(''); setScheduledAt('');
  };

  const buildPayload = (status: EmailCampaign['status']) => ({
    name: name.trim(),
    subject: subject.trim() || selectedTpl?.subject || '',
    fromName: fromName.trim() || undefined,
    ...(templateId ? { templateId } : { htmlBody }),
    trigger: 'manual' as const,
    segment: {
      audience,
      ...(statuses.length ? { statuses } : {}),
      ...(selectedTags.length ? { tags: selectedTags, tagMatch } : {}),
      ...(assignedTo ? { assignedToUserId: assignedTo } : {}),
    },
    scheduledAt: scheduledAt ? Timestamp.fromDate(new Date(scheduledAt)) : null,
    status,
    totalTargets: targetCount,
    sentCount: 0,
    createdByUserId: user?.uid || null,
  });

  const validate = () => {
    const subj = subject.trim() || selectedTpl?.subject || '';
    if (!name.trim()) { toast({ title: 'Mungon emri i fushatës', variant: 'destructive' }); return false; }
    if (!subj) { toast({ title: 'Mungon subjekti', variant: 'destructive' }); return false; }
    if (!effectiveHtml.trim()) { toast({ title: 'Mungon përmbajtja', description: 'Zgjidh një shabllon ose shkruaj HTML.', variant: 'destructive' }); return false; }
    if (audience.length === 0) { toast({ title: 'Zgjidh audiencën', variant: 'destructive' }); return false; }
    if (targetCount === 0) { toast({ title: 'Asnjë target', description: 'Asnjë kontakt me email në këtë segment.', variant: 'destructive' }); return false; }
    return true;
  };

  const saveDraft = async () => {
    if (!name.trim()) { toast({ title: 'Mungon emri', variant: 'destructive' }); return; }
    setBusy(true);
    try { await mutation.create(buildPayload('draft') as any); toast({ title: 'Drafti u ruajt' }); resetForm(); }
    catch { toast({ title: 'Gabim', variant: 'destructive' }); }
    finally { setBusy(false); }
  };

  const queue = async (sendNow: boolean) => {
    if (!validate()) return;
    setBusy(true);
    try {
      const created = await mutation.create(buildPayload('queued') as any);
      if (sendNow) {
        const token = await user!.getIdToken();
        const resp = await fetch('/api/cron/run?job=email-campaigns&manual=1', {
          method: 'POST', headers: { Authorization: `Bearer ${token}` },
        });
        if (!resp.ok) { const e = await resp.json().catch(() => ({})); throw new Error(e?.error || `HTTP ${resp.status}`); }
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
  const tplName = (id?: string) => templates?.find((t) => t.id === id)?.name || (id ? id : 'HTML i lirë');

  return (
    <div className="space-y-4">
      {/* New campaign form */}
      <div className="border border-border rounded-lg p-4 space-y-3">
        <h3 className="text-xs font-semibold uppercase text-muted-foreground">Fushatë e re Email</h3>

        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium block mb-1">Emri i fushatës *</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="p.sh. Oferta e Marsit"
              className="w-full px-3 py-2 bg-muted rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
          </div>
          <div>
            <label className="text-xs font-medium block mb-1">Emri i dërguesit</label>
            <input value={fromName} onChange={(e) => setFromName(e.target.value)} placeholder="p.sh. Ekipi FivoCRM"
              className="w-full px-3 py-2 bg-muted rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
          </div>
          <div>
            <label className="text-xs font-medium block mb-1">Shablloni</label>
            <select value={templateId} onChange={(e) => setTemplateId(e.target.value)}
              className="w-full px-3 py-2 bg-muted rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/40">
              <option value="">— HTML i lirë —</option>
              {templates?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium block mb-1">Planifiko (opsionale)</label>
            <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)}
              className="w-full px-3 py-2 bg-muted rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
          </div>
        </div>

        <div>
          <label className="text-xs font-medium block mb-1">Subjekti {templateId ? '(lër bosh për ta marrë nga shablloni)' : '*'}</label>
          <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={selectedTpl?.subject || 'Subjekti i email-it, {{name}}'}
            className="w-full px-3 py-2 bg-muted rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
        </div>

        {!templateId && (
          <div>
            <label className="text-xs font-medium block mb-1">Përmbajtja (HTML) *</label>
            <textarea value={htmlBody} onChange={(e) => setHtmlBody(e.target.value)} rows={8} placeholder="<h2>Përshëndetje {{name}}…</h2>"
              className="w-full px-3 py-2 bg-muted rounded-md text-xs font-mono focus:outline-none focus:ring-2 focus:ring-primary/40" />
          </div>
        )}
        {effectiveHtml.trim() && (
          <div>
            <p className="text-[11px] text-muted-foreground mb-1">Pamja paraprake:</p>
            <div className="border border-border rounded-md p-3 bg-white max-h-48 overflow-auto" dangerouslySetInnerHTML={{ __html: effectiveHtml }} />
          </div>
        )}

        {/* Segment */}
        <div className="space-y-2 pt-1">
          <label className="text-xs font-medium block">Audienca</label>
          <div className="flex gap-2">
            <button onClick={() => toggleAudience('leads')}
              className={`flex-1 text-xs px-3 py-1.5 rounded-md border ${audience.includes('leads') ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:bg-muted'}`}>Lead-et</button>
            <button onClick={() => toggleAudience('customers')}
              className={`flex-1 text-xs px-3 py-1.5 rounded-md border ${audience.includes('customers') ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:bg-muted'}`}>Klientët</button>
          </div>

          {audience.includes('leads') && (
            <>
              <label className="text-[11px] text-muted-foreground block pt-1">Statusi i lead-eve (lër bosh = të gjitha)</label>
              <div className="flex flex-wrap gap-1.5">
                {LEAD_STATUSES.map((s) => {
                  const on = statuses.includes(s.value);
                  return (
                    <button key={s.value} onClick={() => setStatuses((p) => on ? p.filter((x) => x !== s.value) : [...p, s.value])}
                      className={`text-xs px-2 py-1 rounded-full border ${on ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:bg-muted'}`}>{s.label}</button>
                  );
                })}
              </div>
            </>
          )}

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[11px] text-muted-foreground">Etiketat (tags)</label>
              {selectedTags.length > 1 && (
                <div className="flex items-center gap-1 text-[10px]">
                  <button onClick={() => setTagMatch('any')} className={`px-1.5 py-0.5 rounded ${tagMatch === 'any' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>Çdo</button>
                  <button onClick={() => setTagMatch('all')} className={`px-1.5 py-0.5 rounded ${tagMatch === 'all' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>Të gjitha</button>
                </div>
              )}
            </div>
            {allTags.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">Asnjë etiketë te lead-et/klientët ende.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                {allTags.map((t) => {
                  const on = selectedTags.includes(t);
                  return (
                    <button key={t} onClick={() => toggleTag(t)}
                      className={`text-xs px-2 py-1 rounded-full border ${on ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:bg-muted'}`}>{t}</button>
                  );
                })}
              </div>
            )}
          </div>

          <div>
            <label className="text-[11px] text-muted-foreground block mb-1">Caktuar te</label>
            <select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}
              className="w-full px-3 py-2 bg-muted rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/40">
              <option value="">Kushdo</option>
              {teamMembers?.filter((m) => m.userId).map((m) => <option key={m.id} value={m.userId}>{memberName(m)}</option>)}
            </select>
          </div>

          <p className="text-xs text-muted-foreground">
            Target: <span className="font-semibold text-foreground">{stats.withEmail}</span> me email
            {' '}nga <span className="font-semibold text-foreground">{stats.matched}</span> gjithsej në segment.
            {stats.matched > stats.withEmail && (
              <span className="block text-[11px] text-amber-600 mt-0.5">{stats.matched - stats.withEmail} kontakte s’kanë email dhe nuk dërgohen dot.</span>
            )}
          </p>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={saveDraft} disabled={busy}>Ruaj draft</Button>
          <Button variant="outline" size="sm" onClick={() => queue(false)} disabled={busy}><Clock className="w-3.5 h-3.5 mr-1" /> Vendos në radhë</Button>
          {permissions.isAdmin && (
            <Button size="sm" onClick={() => queue(true)} disabled={busy}>
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Send className="w-3.5 h-3.5 mr-1" />} Dërgo tani
            </Button>
          )}
        </div>
      </div>

      {/* Existing campaigns */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase text-muted-foreground">Fushatat ekzistuese</h3>
        {(campaigns || []).length === 0 && <p className="text-[11px] text-muted-foreground">Asnjë fushatë ende.</p>}
        {(campaigns || []).map((c) => (
          <div key={c.id} className="flex items-center justify-between gap-3 border border-border rounded-lg px-3 py-2">
            <div className="min-w-0">
              <p className="text-sm font-medium truncate flex items-center gap-1.5"><Mail className="w-3.5 h-3.5 text-primary shrink-0" /> {c.name}</p>
              <p className="text-[11px] text-muted-foreground truncate">
                {tplName(c.templateId)} · {c.sentCount || 0}/{c.totalTargets ?? '?'} dërguar
                {c.failedCount ? ` · ${c.failedCount} dështuan` : ''}
              </p>
            </div>
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${STATUS_BADGE[c.status] || ''}`}>{c.status}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default EmailCampaigns;
