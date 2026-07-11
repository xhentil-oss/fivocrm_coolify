import React, { useState, useMemo } from 'react';
import { useCollection, useMutation } from '../hooks/useFirestore';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../contexts/PermissionsContext';
import { useToast } from '../hooks/use-toast';
import { Send, Loader2, Clock, Mail, Zap, Users, Play, Pause, ShoppingCart, Plus, Trash2, Eye, MousePointerClick } from 'lucide-react';
import { Button } from './ui/button';
import { Timestamp } from 'firebase/firestore';
import type { EmailCampaign, EmailTemplate, Lead, Customer, TeamMember, Service } from '../types';

// Normalize tags from either an array (leads) or a comma string (customers).
function entityTags(e: { tags?: unknown }): string[] {
  const t = e.tags;
  if (Array.isArray(t)) return t.map((x) => String(x).trim()).filter(Boolean);
  if (typeof t === 'string') return t.split(',').map((s) => s.trim()).filter(Boolean);
  return [];
}
const isValidEmail = (e?: string) => !!e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e).trim());
const serviceName = (s: Service) => s.name || s.title || 'Shërbim';

type StepDraft = { delayDays: number; subject: string; templateId: string; htmlBody: string };
const emptyStep = (delayDays = 0): StepDraft => ({ delayDays, subject: '', templateId: '', htmlBody: '' });

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
  active: 'bg-emerald-500/15 text-emerald-600',
  paused: 'bg-amber-500/15 text-amber-600',
};
const STATUS_LABEL: Record<string, string> = {
  draft: 'draft', queued: 'në radhë', sending: 'duke dërguar', completed: 'përfunduar',
  failed: 'dështoi', active: 'aktive', paused: 'pauzuar',
};
// Friendly labels for known contact origins (Customer/Lead `source`).
const SOURCE_LABEL: Record<string, string> = {
  whmcs: 'WHMCS', manual: 'Manual', stripe: 'Stripe', landing: 'Landing Page',
};
const sourceLabel = (s: string) => SOURCE_LABEL[s] || (s.charAt(0).toUpperCase() + s.slice(1));

const EmailCampaigns: React.FC = () => {
  const { user } = useAuth();
  const permissions = usePermissions();
  const { toast } = useToast();

  const { data: campaigns } = useCollection<EmailCampaign>('emailCampaigns', {
    orderBy: { field: 'createdAt', direction: 'desc' },
  });
  const { data: templates } = useCollection<EmailTemplate>('emailTemplates');
  const { data: services } = useCollection<Service>('services', { skipTeamFilter: true });
  const { data: leads } = useCollection<Lead>('leads', { skipTeamFilter: true });
  const { data: customers } = useCollection<Customer>('customers', { skipTeamFilter: true });
  // WHMCS-synced domain registrations (business-scoped) → target "has a domain".
  const { data: domains } = useCollection<any>('domains');
  const { data: teamMembers } = useCollection<TeamMember>('teamMembers', {
    where: [{ field: 'status', operator: '==', value: 'Active' }],
  });
  const mutation = useMutation<EmailCampaign>('emailCampaigns');

  const [campaignType, setCampaignType] = useState<'manual' | 'purchase'>('manual');
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [fromName, setFromName] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [htmlBody, setHtmlBody] = useState('');
  const [audience, setAudience] = useState<('leads' | 'customers')[]>(['leads', 'customers']);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [tagMatch, setTagMatch] = useState<'any' | 'all'>('any');
  const [source, setSource] = useState('');
  const [hasDomain, setHasDomain] = useState(false);
  const [assignedTo, setAssignedTo] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [triggerServiceIds, setTriggerServiceIds] = useState<string[]>([]);
  const [steps, setSteps] = useState<StepDraft[]>([emptyStep(0)]);
  const [busy, setBusy] = useState(false);

  const selectedTpl = templates?.find((t) => t.id === templateId);
  const effectiveHtml = templateId ? (selectedTpl?.html || '') : htmlBody;
  const isPurchase = campaignType === 'purchase';
  const tplHtml = (id: string) => templates?.find((t) => t.id === id)?.html || '';
  const stepHtml = (s: StepDraft) => (s.templateId ? tplHtml(s.templateId) : s.htmlBody);

  const allTags = useMemo(() => {
    const s = new Set<string>();
    (leads || []).forEach((l) => entityTags(l).forEach((t) => s.add(t)));
    (customers || []).forEach((c) => entityTags(c).forEach((t) => s.add(t)));
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [leads, customers]);

  // Distinct contact origins present in the data — powers the "Burimi" filter
  // (e.g. target only WHMCS-synced clients for a WHMCS-specific campaign).
  const allSources = useMemo(() => {
    const s = new Set<string>();
    (leads || []).forEach((l) => { const v = (l as any).source; if (v) s.add(String(v)); });
    (customers || []).forEach((c) => { const v = (c as any).source; if (v) s.add(String(v)); });
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [leads, customers]);

  // customerIds that own at least one registered domain (for the "has domain" filter).
  const customerIdsWithDomain = useMemo(() => {
    const s = new Set<string>();
    (domains || []).forEach((d) => { if (d?.customerId) s.add(String(d.customerId)); });
    return s;
  }, [domains]);

  const tagsMatch = (list: string[]) => {
    if (selectedTags.length === 0) return true;
    return tagMatch === 'all' ? selectedTags.every((t) => list.includes(t)) : selectedTags.some((t) => list.includes(t));
  };
  const toggleTag = (t: string) => setSelectedTags((p) => (p.includes(t) ? p.filter((x) => x !== t) : [...p, t]));
  const toggleAudience = (a: 'leads' | 'customers') => setAudience((p) => (p.includes(a) ? p.filter((x) => x !== a) : [...p, a]));
  const toggleService = (id: string) => setTriggerServiceIds((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const updateStep = (i: number, patch: Partial<StepDraft>) =>
    setSteps((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  const addStep = () => setSteps((prev) => [...prev, emptyStep((prev[prev.length - 1]?.delayDays || 0) + 3)]);
  const removeStep = (i: number) => setSteps((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev));

  // Counts across selected audiences, deduped by email (manual campaigns only).
  const stats = useMemo(() => {
    let matched = 0;
    const emails = new Set<string>();
    if (audience.includes('leads')) {
      for (const l of leads || []) {
        if (hasDomain) continue; // leads never own a domain
        if (statuses.length && !statuses.includes(l.status)) continue;
        if (!tagsMatch(entityTags(l))) continue;
        if (assignedTo && l.assignedToUserId !== assignedTo) continue;
        if (source && String((l as any).source || '') !== source) continue;
        matched++;
        if (isValidEmail(l.email)) emails.add(String(l.email).trim().toLowerCase());
      }
    }
    if (audience.includes('customers')) {
      for (const c of customers || []) {
        if (!tagsMatch(entityTags(c))) continue;
        if (assignedTo && c.assignedToUserId !== assignedTo) continue;
        if (source && String((c as any).source || '') !== source) continue;
        if (hasDomain && !customerIdsWithDomain.has(String(c.id))) continue;
        matched++;
        if (isValidEmail(c.email)) emails.add(String(c.email).trim().toLowerCase());
      }
    }
    return { matched, withEmail: emails.size };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leads, customers, audience, statuses, selectedTags, tagMatch, assignedTo, source, hasDomain, customerIdsWithDomain]);
  const targetCount = stats.withEmail;

  const resetForm = () => {
    setName(''); setSubject(''); setTemplateId(''); setHtmlBody(''); setStatuses([]); setSelectedTags([]);
    setAssignedTo(''); setSource(''); setHasDomain(false); setScheduledAt(''); setTriggerServiceIds([]); setSteps([emptyStep(0)]);
  };

  const buildManualPayload = (status: EmailCampaign['status']) => ({
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
      ...(source ? { source } : {}),
      ...(hasDomain ? { hasDomain: true } : {}),
    },
    scheduledAt: scheduledAt ? Timestamp.fromDate(new Date(scheduledAt)) : null,
    status,
    totalTargets: targetCount,
    sentCount: 0,
    createdByUserId: user?.uid || null,
  });

  const buildPurchasePayload = (status: EmailCampaign['status']) => {
    const cleanSteps = steps.map((s) => ({
      delayDays: Math.max(0, Number(s.delayDays) || 0),
      ...(s.subject.trim() ? { subject: s.subject.trim() } : {}),
      ...(s.templateId ? { templateId: s.templateId } : s.htmlBody.trim() ? { htmlBody: s.htmlBody } : {}),
    }));
    const first = steps[0];
    return {
      name: name.trim(),
      subject: (first?.subject.trim() || templates?.find((t) => t.id === first?.templateId)?.subject || name.trim()),
      fromName: fromName.trim() || undefined,
      ...(first?.templateId ? { templateId: first.templateId } : first?.htmlBody.trim() ? { htmlBody: first.htmlBody } : {}),
      trigger: 'purchase' as const,
      triggerServiceIds,
      steps: cleanSteps,
      segment: {},
      status,
      sentCount: 0,
      createdByUserId: user?.uid || null,
    };
  };

  const validateManual = () => {
    const subj = subject.trim() || selectedTpl?.subject || '';
    if (!name.trim()) { toast({ title: 'Mungon emri i fushatës', variant: 'destructive' }); return false; }
    if (!subj) { toast({ title: 'Mungon subjekti', variant: 'destructive' }); return false; }
    if (!effectiveHtml.trim()) { toast({ title: 'Mungon përmbajtja', description: 'Zgjidh një shabllon ose shkruaj HTML.', variant: 'destructive' }); return false; }
    if (audience.length === 0) { toast({ title: 'Zgjidh audiencën', variant: 'destructive' }); return false; }
    if (targetCount === 0) { toast({ title: 'Asnjë target', description: 'Asnjë kontakt me email në këtë segment.', variant: 'destructive' }); return false; }
    return true;
  };

  const validatePurchaseContent = () => {
    if (!name.trim()) { toast({ title: 'Mungon emri i fushatës', variant: 'destructive' }); return false; }
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      const subj = s.subject.trim() || templates?.find((t) => t.id === s.templateId)?.subject || '';
      const html = stepHtml(s);
      if (!subj || !html.trim()) {
        toast({ title: `Hapi ${i + 1} i paplotë`, description: 'Çdo hap kërkon subjekt dhe përmbajtje (shabllon ose HTML).', variant: 'destructive' });
        return false;
      }
    }
    return true;
  };

  const saveDraft = async () => {
    if (!name.trim()) { toast({ title: 'Mungon emri', variant: 'destructive' }); return; }
    setBusy(true);
    try { await mutation.create(buildManualPayload('draft') as any); toast({ title: 'Drafti u ruajt' }); resetForm(); }
    catch { toast({ title: 'Gabim', variant: 'destructive' }); }
    finally { setBusy(false); }
  };

  const queue = async (sendNow: boolean) => {
    if (!validateManual()) return;
    setBusy(true);
    try {
      const created = await mutation.create(buildManualPayload('queued') as any);
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

  const saveAutomation = async (active: boolean) => {
    if (!validatePurchaseContent()) return;
    setBusy(true);
    try {
      await mutation.create(buildPurchasePayload(active ? 'active' : 'paused') as any);
      toast({ title: active ? 'Automatizimi u aktivizua' : 'Automatizimi u ruajt (pauzuar)', description: active ? 'Do dërgohet automatikisht kur një klient blen shërbimin.' : undefined });
      resetForm();
    } catch { toast({ title: 'Gabim', variant: 'destructive' }); }
    finally { setBusy(false); }
  };

  const toggleCampaignStatus = async (c: EmailCampaign) => {
    const next = c.status === 'active' ? 'paused' : 'active';
    try { await mutation.update(c.id, { status: next } as any); toast({ title: next === 'active' ? 'Aktivizuar' : 'Pauzuar' }); }
    catch { toast({ title: 'Gabim', variant: 'destructive' }); }
  };

  const memberName = (m: TeamMember) => m.displayName || m.email || 'Pa emër';
  const tplName = (id?: string) => templates?.find((t) => t.id === id)?.name || (id ? id : 'HTML i lirë');
  const svcName = (id: string) => (services?.find((s) => s.id === id) ? serviceName(services.find((s) => s.id === id)!) : id);

  return (
    <div className="space-y-4">
      {/* New campaign form */}
      <div className="border border-border rounded-lg p-4 space-y-3">
        <h3 className="text-xs font-semibold uppercase text-muted-foreground">Fushatë e re Email</h3>

        {/* Campaign type */}
        <div className="flex gap-2">
          <button onClick={() => setCampaignType('manual')}
            className={`flex-1 flex items-center justify-center gap-1.5 text-xs px-3 py-2 rounded-md border ${!isPurchase ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:bg-muted'}`}>
            <Users className="w-3.5 h-3.5" /> Manuale (dërgim te një segment)
          </button>
          <button onClick={() => setCampaignType('purchase')}
            className={`flex-1 flex items-center justify-center gap-1.5 text-xs px-3 py-2 rounded-md border ${isPurchase ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:bg-muted'}`}>
            <Zap className="w-3.5 h-3.5" /> Automatike (kur blen shërbim)
          </button>
        </div>
        {isPurchase && (
          <div className="flex gap-2 px-3 py-2 rounded-md bg-primary/5 border border-primary/20 text-[11px] text-muted-foreground">
            <ShoppingCart className="w-4 h-4 shrink-0 mt-0.5 text-primary" />
            <span>Sekuencë <strong>drip</strong>: kur klienti paguan një faturë me shërbimin e zgjedhur, futet në sekuencë dhe merr çdo hap sipas ditëve të caktuara. Aktivizohet vetëm për blerjet e ardhshme.</span>
          </div>
        )}

        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium block mb-1">Emri i fushatës *</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={isPurchase ? 'p.sh. Onboarding pas blerjes' : 'p.sh. Oferta e Marsit'}
              className="w-full px-3 py-2 bg-muted rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
          </div>
          <div>
            <label className="text-xs font-medium block mb-1">Emri i dërguesit</label>
            <input value={fromName} onChange={(e) => setFromName(e.target.value)} placeholder="p.sh. Ekipi FivoCRM"
              className="w-full px-3 py-2 bg-muted rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
          </div>
        </div>

        {/* ── Manual: single email + segment ───────────────────────────── */}
        {!isPurchase && (
          <>
            <div className="grid sm:grid-cols-2 gap-3">
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

            <div className="space-y-2 pt-1">
              <label className="text-xs font-medium block">Audienca</label>
              <div className="flex gap-2">
                <button onClick={() => toggleAudience('leads')}
                  className={`flex-1 text-xs px-3 py-1.5 rounded-md border ${audience.includes('leads') ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:bg-muted'}`}>Lead-et</button>
                <button onClick={() => toggleAudience('customers')}
                  className={`flex-1 text-xs px-3 py-1.5 rounded-md border ${audience.includes('customers') ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:bg-muted'}`}>Klientët</button>
              </div>

              {allSources.length > 0 && (
                <div>
                  <label className="text-[11px] text-muted-foreground block mb-1">Burimi (nga vjen kontakti)</label>
                  <select value={source} onChange={(e) => setSource(e.target.value)}
                    className="w-full px-3 py-2 bg-muted rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/40">
                    <option value="">Të gjitha burimet</option>
                    {allSources.map((s) => <option key={s} value={s}>{sourceLabel(s)}</option>)}
                  </select>
                </div>
              )}

              {audience.includes('customers') && customerIdsWithDomain.size > 0 && (
                <label className="flex items-center gap-2 text-xs cursor-pointer pt-1">
                  <input type="checkbox" checked={hasDomain} onChange={(e) => setHasDomain(e.target.checked)}
                    className="rounded border-border" />
                  <span>Vetëm klientë me domain të regjistruar <span className="text-muted-foreground">({customerIdsWithDomain.size})</span></span>
                </label>
              )}

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
          </>
        )}

        {/* ── Purchase: service trigger + drip steps ───────────────────── */}
        {isPurchase && (
          <>
            <div className="space-y-2">
              <label className="text-xs font-medium block">Nis kur blihet shërbimi</label>
              {(services || []).length === 0 ? (
                <p className="text-[11px] text-muted-foreground">Asnjë shërbim në katalog ende.</p>
              ) : (
                <>
                  <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
                    {(services || []).map((s) => {
                      const on = triggerServiceIds.includes(s.id);
                      return (
                        <button key={s.id} onClick={() => toggleService(s.id)}
                          className={`text-xs px-2 py-1 rounded-full border ${on ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:bg-muted'}`}>
                          {serviceName(s)}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    {triggerServiceIds.length === 0 ? 'Asnjë i zgjedhur = çdo blerje (çdo faturë e paguar).' : `${triggerServiceIds.length} shërbim(e) të zgjedhura.`}
                  </p>
                </>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium block">Sekuenca e email-eve</label>
              {steps.map((s, i) => (
                <div key={i} className="border border-border rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-foreground">Hapi {i + 1}</span>
                    <div className="flex items-center gap-2">
                      <label className="text-[11px] text-muted-foreground flex items-center gap-1">
                        {i === 0 ? 'Menjëherë' : 'Pas'}
                        {i > 0 && (
                          <input type="number" min={0} value={s.delayDays}
                            onChange={(e) => updateStep(i, { delayDays: Number(e.target.value) })}
                            className="w-14 px-1.5 py-0.5 bg-muted rounded text-xs text-center focus:outline-none" />
                        )}
                        {i > 0 && 'ditë'}
                      </label>
                      {steps.length > 1 && (
                        <button onClick={() => removeStep(i)} className="p-1 rounded hover:bg-destructive/10 text-destructive"><Trash2 className="w-3.5 h-3.5" /></button>
                      )}
                    </div>
                  </div>
                  <div className="grid sm:grid-cols-2 gap-2">
                    <input value={s.subject} onChange={(e) => updateStep(i, { subject: e.target.value })} placeholder="Subjekti *"
                      className="w-full px-3 py-2 bg-muted rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
                    <select value={s.templateId} onChange={(e) => updateStep(i, { templateId: e.target.value })}
                      className="w-full px-3 py-2 bg-muted rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/40">
                      <option value="">— HTML i lirë —</option>
                      {templates?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </div>
                  {!s.templateId && (
                    <textarea value={s.htmlBody} onChange={(e) => updateStep(i, { htmlBody: e.target.value })} rows={5} placeholder="<h2>Përshëndetje {{name}}…</h2>"
                      className="w-full px-3 py-2 bg-muted rounded-md text-xs font-mono focus:outline-none focus:ring-2 focus:ring-primary/40" />
                  )}
                  {stepHtml(s).trim() && (
                    <div className="border border-border rounded-md p-2 bg-white max-h-32 overflow-auto" dangerouslySetInnerHTML={{ __html: stepHtml(s) }} />
                  )}
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={addStep} className="w-full"><Plus className="w-3.5 h-3.5 mr-1" /> Shto hap</Button>
            </div>
          </>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-2">
          {isPurchase ? (
            <>
              <Button variant="outline" size="sm" onClick={() => saveAutomation(false)} disabled={busy}>
                <Pause className="w-3.5 h-3.5 mr-1" /> Ruaj (pauzuar)
              </Button>
              <Button size="sm" onClick={() => saveAutomation(true)} disabled={busy}>
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Zap className="w-3.5 h-3.5 mr-1" />} Aktivizo
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" size="sm" onClick={saveDraft} disabled={busy}>Ruaj draft</Button>
              <Button variant="outline" size="sm" onClick={() => queue(false)} disabled={busy}><Clock className="w-3.5 h-3.5 mr-1" /> Vendos në radhë</Button>
              {permissions.isAdmin && (
                <Button size="sm" onClick={() => queue(true)} disabled={busy}>
                  {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Send className="w-3.5 h-3.5 mr-1" />} Dërgo tani
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Existing campaigns */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase text-muted-foreground">Fushatat ekzistuese</h3>
        {(campaigns || []).length === 0 && <p className="text-[11px] text-muted-foreground">Asnjë fushatë ende.</p>}
        {(campaigns || []).map((c) => {
          const purchase = c.trigger === 'purchase';
          return (
            <div key={c.id} className="flex items-center justify-between gap-3 border border-border rounded-lg px-3 py-2">
              <div className="min-w-0">
                <p className="text-sm font-medium truncate flex items-center gap-1.5">
                  {purchase ? <Zap className="w-3.5 h-3.5 text-primary shrink-0" /> : <Mail className="w-3.5 h-3.5 text-primary shrink-0" />} {c.name}
                </p>
                <p className="text-[11px] text-muted-foreground truncate">
                  {purchase
                    ? <>Automatike · {c.triggerServiceIds?.length ? c.triggerServiceIds.map(svcName).join(', ') : 'çdo blerje'}{c.steps?.length ? ` · ${c.steps.length} hap` : ''} · {c.sentCount || 0} dërguar</>
                    : <>{tplName(c.templateId)} · {c.sentCount || 0}/{c.totalTargets ?? '?'} dërguar{c.failedCount ? ` · ${c.failedCount} dështuan` : ''}</>}
                  {(c.openCount || c.clickCount) ? (
                    <span className="inline-flex items-center gap-2 ml-1">
                      <span className="inline-flex items-center gap-0.5"><Eye className="w-3 h-3" />{c.openCount || 0}</span>
                      <span className="inline-flex items-center gap-0.5"><MousePointerClick className="w-3 h-3" />{c.clickCount || 0}</span>
                    </span>
                  ) : null}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${STATUS_BADGE[c.status] || ''}`}>{STATUS_LABEL[c.status] || c.status}</span>
                {purchase && (c.status === 'active' || c.status === 'paused') && (
                  <button onClick={() => toggleCampaignStatus(c)} title={c.status === 'active' ? 'Pauzo' : 'Aktivizo'}
                    className="p-1 rounded hover:bg-muted text-muted-foreground">
                    {c.status === 'active' ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default EmailCampaigns;
