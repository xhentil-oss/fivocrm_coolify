import React, { useState, useMemo } from 'react';
import { useCollection, useMutation } from '../hooks/useFirestore';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../contexts/PermissionsContext';
import { useTeamSettingsData } from '../hooks/useTeamSettings';
import { useToast } from '../hooks/use-toast';
import { X, Megaphone, Send, Loader2, Clock, AlertTriangle, Plus, Trash2, Play, Pause, Link2, Repeat } from 'lucide-react';
import { Button } from './ui/button';
import { Timestamp } from 'firebase/firestore';
import type { WhatsAppBroadcast, WhatsAppTemplate, WhatsAppMessageVariant, Lead, Customer, TeamMember, WhatsAppAccount } from '../types';
import {
  contactTags as entityTags, evaluateWaSegment, validateWaCampaign, WA_BLOCK_LABELS,
  type WaConditions, type WaBlockReason,
} from '../lib/marketing/waAutomation';

interface Props {
  onClose: () => void;
}

// Mirror the exact statuses the CRM uses (tabs in CRMView / PipelineBoard).
// 'Proposal'/'Won' exist in the type but are never assigned in the UI, so they
// are intentionally excluded here.

const LEAD_STATUSES: { value: string; label: string }[] = [
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
  completed: 'bg-[#25D366]/15 text-[#1da851]',
  failed: 'bg-destructive/15 text-destructive',
  active: 'bg-[#25D366]/15 text-[#1da851]',
  paused: 'bg-muted text-muted-foreground',
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
  // Leads and customers are loaded app-wide with skipTeamFilter (CRMView /
  // CustomersView do the same — neither is team-isolated, rules: read if isAuth),
  // so we mirror that here to show the full lists users see.
  const { data: leads } = useCollection<Lead>('leads', { skipTeamFilter: true });
  const { data: customers } = useCollection<Customer>('customers', { skipTeamFilter: true });
  // WHMCS-synced domain registrations (business-scoped) → target "has a domain".
  const { data: domains } = useCollection<any>('domains');
  const { data: teamMembers } = useCollection<TeamMember>('teamMembers', {
    where: [{ field: 'status', operator: '==', value: 'Active' }],
  });
  const { data: waAccounts } = useCollection<WhatsAppAccount>('whatsappAccounts');
  const mutation = useMutation<WhatsAppBroadcast>('waBroadcasts');

  const channels = settings?.metaChannels || [];
  const metaEnabled = !!settings?.metaEnabled && channels.length > 0;
  // The VPS secret lives in the server-only vault → check the presence marker.
  const vpsConfigured = !!settings?.whatsappVpsUrl && !!settings?.hasWhatsappVpsSecret;
  const connectedAgents = (waAccounts || []).filter((a) => a.enabled);

  // 'manual' = one-shot blast. 'dormant' = an evergreen rule that re-checks the
  // segment every day and messages whoever has gone quiet long enough.
  const [trigger, setTrigger] = useState<'manual' | 'dormant'>('manual');
  const [conditions, setConditions] = useState<WaConditions>({});
  const [variants, setVariants] = useState<WhatsAppMessageVariant[]>([]);
  const [landingUrl, setLandingUrl] = useState('');
  const [utmCampaign, setUtmCampaign] = useState('');
  const [sendChannel, setSendChannel] = useState<'meta' | 'baileys'>('meta');
  // Default to BOTH audiences so tags set on customers (not just leads) are counted
  // out of the box — otherwise a customer-only tag matches 0 and "doesn't show up".
  const [audience, setAudience] = useState<('leads' | 'customers')[]>(['leads', 'customers']);
  const [name, setName] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [channelId, setChannelId] = useState('');
  const [agentId, setAgentId] = useState('');
  const [statuses, setStatuses] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [tagMatch, setTagMatch] = useState<'any' | 'all'>('any');
  const [assignedTo, setAssignedTo] = useState('');
  const [source, setSource] = useState('');
  const [hasDomain, setHasDomain] = useState(false);
  const [scheduledAt, setScheduledAt] = useState('');
  const [busy, setBusy] = useState(false);

  // Union of all tags across leads + customers (normalized) for the picker.
  const allTags = useMemo(() => {
    const s = new Set<string>();
    (leads || []).forEach((l) => entityTags(l).forEach((t) => s.add(t)));
    (customers || []).forEach((c) => entityTags(c).forEach((t) => s.add(t)));
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [leads, customers]);

  // Distinct contact origins (Customer/Lead `source`) — powers the "Burimi"
  // filter, e.g. broadcast only to WHMCS-synced clients.
  const allSources = useMemo(() => {
    const s = new Set<string>();
    (leads || []).forEach((l) => { const v = (l as any).source; if (v) s.add(String(v)); });
    (customers || []).forEach((c) => { const v = (c as any).source; if (v) s.add(String(v)); });
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [leads, customers]);
  const sourceLabel = (s: string) => (
    { whmcs: 'WHMCS', manual: 'Manual', stripe: 'Stripe', landing: 'Landing Page' } as Record<string, string>
  )[s] || (s.charAt(0).toUpperCase() + s.slice(1));

  // customerIds that own at least one registered domain (for the "has domain" filter).
  const customerIdsWithDomain = useMemo(() => {
    const s = new Set<string>();
    (domains || []).forEach((d) => { if (d?.customerId) s.add(String(d.customerId)); });
    return s;
  }, [domains]);

  const toggleTag = (t: string) =>
    setSelectedTags((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));

  const segment = useMemo(() => ({
    audience,
    ...(statuses.length ? { statuses } : {}),
    ...(selectedTags.length ? { tags: selectedTags, tagMatch } : {}),
    ...(assignedTo ? { assignedToUserId: assignedTo } : {}),
    ...(source ? { source } : {}),
    ...(hasDomain ? { hasDomain: true } : {}),
  }), [audience, statuses, selectedTags, tagMatch, assignedTo, source, hasDomain]);

  const activeTemplate = templates?.find((t) => t.id === templateId);

  // The SAME engine the cron sends with (src/lib/marketing/waAutomation.ts), so
  // the number shown here is the number that goes out — and every excluded
  // contact is accounted for by reason instead of vanishing.
  //
  // One honest gap: the server also counts WhatsApp messages as "contact" via a
  // bounded Firestore lookup. The browser only has the CRM's own activity dates,
  // so a dormancy preview can read slightly HIGH. The note under the count says so.
  const preview = useMemo(() => evaluateWaSegment({
    leads: (leads || []) as any,
    customers: (customers || []) as any,
    segment,
    conditions,
    variants,
    fallbackBody: activeTemplate?.body,
    defaultLandingUrl: landingUrl,
    utm: { source: 'whatsapp', medium: 'crm', campaign: utmCampaign || name || undefined },
    now: new Date(),
    domainCustomerIds: customerIdsWithDomain,
  }), [leads, customers, segment, conditions, variants, activeTemplate?.body, landingUrl, utmCampaign, name, customerIdsWithDomain]);

  const targetCount = preview.targets.length;
  const blockedRows = useMemo(
    () => Object.entries(preview.blocked)
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1]) as [WaBlockReason, number][],
    [preview.blocked],
  );
  const usesDormancy = conditions.lastContactMinDays != null || conditions.lastContactMaxDays != null || !!conditions.requireContacted;

  const toggleAudience = (a: 'leads' | 'customers') =>
    setAudience((prev) => (prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a]));

  const resetForm = () => {
    setName(''); setTemplateId(''); setStatuses([]); setSelectedTags([]); setAssignedTo(''); setSource(''); setHasDomain(false); setScheduledAt('');
    setConditions({}); setVariants([]); setLandingUrl(''); setUtmCampaign(''); setTrigger('manual');
  };

  // Firestore rejects `undefined`, so every optional condition is stripped rather
  // than written empty.
  const cleanConditions = () => {
    const c: WaConditions = {};
    if (conditions.lastContactMinDays != null) c.lastContactMinDays = Number(conditions.lastContactMinDays);
    if (conditions.lastContactMaxDays != null) c.lastContactMaxDays = Number(conditions.lastContactMaxDays);
    if (conditions.requireContacted) c.requireContacted = true;
    if (conditions.requireNotes) c.requireNotes = true;
    if (conditions.dailyCap != null) c.dailyCap = Number(conditions.dailyCap);
    return c;
  };

  const buildPayload = (status: WhatsAppBroadcast['status']) => {
    const cleanVariants = variants
      .filter((v) => (v.body || '').trim())
      .map((v) => ({
        id: v.id,
        tags: (v.tags || []).filter(Boolean),
        body: v.body.trim(),
        ...(v.label?.trim() ? { label: v.label.trim() } : {}),
        ...(v.landingUrl?.trim() ? { landingUrl: v.landingUrl.trim() } : {}),
      }));
    const conds = cleanConditions();
    return {
      name: name.trim(),
      templateId,
      channel: sendChannel,
      channelPhoneNumberId: sendChannel === 'meta' ? (channelId || channels[0]?.phoneNumberId || '') : '',
      agentId: sendChannel === 'baileys' ? (agentId || connectedAgents[0]?.id || '') : '',
      segment,
      trigger,
      ...(Object.keys(conds).length ? { conditions: conds } : {}),
      ...(cleanVariants.length ? { variants: cleanVariants } : {}),
      ...(landingUrl.trim() ? { landingUrl: landingUrl.trim() } : {}),
      utm: { source: 'whatsapp', medium: 'crm', campaign: utmCampaign.trim() || name.trim() },
      scheduledAt: scheduledAt ? Timestamp.fromDate(new Date(scheduledAt)) : null,
      status,
      totalTargets: targetCount,
      sentCount: 0,
      createdByUserId: user?.uid || null,
    };
  };

  const validate = () => {
    if (sendChannel === 'meta' && !metaEnabled) { toast({ title: 'Meta s’është konfiguruar', description: 'Zgjidh Baileys ose aktivizo një kanal Meta.', variant: 'destructive' }); return false; }
    if (sendChannel === 'baileys' && (!vpsConfigured || connectedAgents.length === 0)) { toast({ title: 'Baileys s’është gati', description: 'Konfiguro VPS-në dhe një agjent te Cilësimet.', variant: 'destructive' }); return false; }
    if (!name.trim()) { toast({ title: 'Mungon emri', variant: 'destructive' }); return false; }
    // Meta only delivers approved templates outside the 24h window, so free-text
    // variants are a Baileys capability. Say so instead of failing in the cron.
    if (sendChannel === 'meta' && !templateId) {
      toast({ title: 'Meta kërkon një template', description: 'Variantet me tekst të lirë punojnë vetëm me Baileys.', variant: 'destructive' });
      return false;
    }
    const errs = validateWaCampaign({ variants, templateId, conditions: cleanConditions(), trigger });
    if (errs.length) { toast({ title: 'Kontrollo fushatën', description: errs[0], variant: 'destructive' }); return false; }
    if (audience.length === 0) { toast({ title: 'Zgjidh audiencën', description: 'Zgjidh të paktën Lead-et ose Klientët.', variant: 'destructive' }); return false; }
    if (targetCount === 0) { toast({ title: 'Asnjë target', description: 'Asnjë kontakt nuk kalon kushtet e vendosura.', variant: 'destructive' }); return false; }
    return true;
  };

  // An evergreen rule isn't "sent" — it's switched on, and the daily cron works it.
  const activateAutomation = async () => {
    if (!validate()) return;
    setBusy(true);
    try {
      await mutation.create(buildPayload('active') as any);
      toast({ title: 'Automatizimi u aktivizua', description: `Kontrollon segmentin çdo ditë (max ${conditions.dailyCap} dërgime/ekzekutim).` });
      resetForm();
    } catch (err: any) {
      toast({ title: 'Gabim', description: err?.message || 'Aktivizimi dështoi.', variant: 'destructive' });
    } finally { setBusy(false); }
  };

  const toggleRule = async (b: WhatsAppBroadcast) => {
    try {
      await mutation.update(b.id, { status: b.status === 'active' ? 'paused' : 'active', error: null } as any);
      toast({ title: b.status === 'active' ? 'Automatizimi u pauzua' : 'Automatizimi u riaktivizua' });
    } catch { toast({ title: 'Gabim', variant: 'destructive' }); }
  };

  const addVariant = () => setVariants((p) => [...p, {
    id: `v${Date.now().toString(36)}`, label: '', tags: [], body: '', landingUrl: '',
  }]);
  const updateVariant = (id: string, patch: Partial<WhatsAppMessageVariant>) =>
    setVariants((p) => p.map((v) => (v.id === id ? { ...v, ...patch } : v)));
  const removeVariant = (id: string) => setVariants((p) => p.filter((v) => v.id !== id));
  const toggleVariantTag = (id: string, tag: string) =>
    setVariants((p) => p.map((v) => v.id === id
      ? { ...v, tags: v.tags.includes(tag) ? v.tags.filter((t) => t !== tag) : [...v.tags, tag] }
      : v));

  const saveDraft = async () => {
    // A variant-driven campaign has no template, so text may come from either.
    const hasText = !!templateId || variants.some((v) => (v.body || '').trim());
    if (!name.trim() || !hasText) {
      toast({ title: 'Mungojnë fushat', description: 'Duhet emri dhe një tekst (template ose variant).', variant: 'destructive' });
      return;
    }
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

            {/* One-shot blast vs. an always-on rule */}
            <div className="flex gap-2">
              <button
                onClick={() => setTrigger('manual')}
                className={`flex-1 text-xs px-3 py-2 rounded-md border text-left ${trigger === 'manual' ? 'bg-[#25D366]/10 border-[#25D366]' : 'border-border hover:bg-muted'}`}>
                <span className="font-medium flex items-center gap-1.5"><Send className="w-3.5 h-3.5" /> Një herë</span>
                <span className="block text-[10px] text-muted-foreground mt-0.5">Dërgohet një herë te segmenti i tanishëm.</span>
              </button>
              <button
                onClick={() => {
                  setTrigger('dormant');
                  // An evergreen rule without these two would blast the whole list
                  // on its first run — seed the guardrails with sane defaults.
                  setConditions((c) => ({ ...c, lastContactMinDays: c.lastContactMinDays ?? 30, dailyCap: c.dailyCap ?? 20 }));
                }}
                className={`flex-1 text-xs px-3 py-2 rounded-md border text-left ${trigger === 'dormant' ? 'bg-[#25D366]/10 border-[#25D366]' : 'border-border hover:bg-muted'}`}>
                <span className="font-medium flex items-center gap-1.5"><Repeat className="w-3.5 h-3.5" /> Automatizim</span>
                <span className="block text-[10px] text-muted-foreground mt-0.5">Kontrollon çdo ditë; dërgon kur kushtet plotësohen.</span>
              </button>
            </div>

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
              <label className="text-xs font-medium block">Audienca</label>
              <div className="flex gap-2">
                <button onClick={() => toggleAudience('leads')}
                  className={`flex-1 text-xs px-3 py-1.5 rounded-md border ${audience.includes('leads') ? 'bg-[#25D366] text-white border-[#25D366]' : 'border-border text-muted-foreground hover:bg-muted'}`}>
                  Lead-et
                </button>
                <button onClick={() => toggleAudience('customers')}
                  className={`flex-1 text-xs px-3 py-1.5 rounded-md border ${audience.includes('customers') ? 'bg-[#25D366] text-white border-[#25D366]' : 'border-border text-muted-foreground hover:bg-muted'}`}>
                  Klientët
                </button>
              </div>

              {allSources.length > 0 && (
                <div>
                  <label className="text-[11px] text-muted-foreground block mb-1">Burimi (nga vjen kontakti)</label>
                  <select value={source} onChange={(e) => setSource(e.target.value)}
                    className="w-full px-3 py-2 bg-muted rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#25D366]/40">
                    <option value="">Të gjitha burimet</option>
                    {allSources.map((s) => <option key={s} value={s}>{sourceLabel(s)}</option>)}
                  </select>
                </div>
              )}

              {audience.includes('customers') && customerIdsWithDomain.size > 0 && (
                <label className="flex items-center gap-2 text-xs cursor-pointer pt-1">
                  <input type="checkbox" checked={hasDomain} onChange={(e) => setHasDomain(e.target.checked)}
                    className="rounded border-border accent-[#25D366]" />
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
                          className={`text-xs px-2 py-1 rounded-full border ${on ? 'bg-[#25D366] text-white border-[#25D366]' : 'border-border text-muted-foreground hover:bg-muted'}`}>
                          {s.label}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
              {audience.includes('customers') && (
                <p className="text-[11px] text-muted-foreground">
                  Klientët: të gjithë klientët me numër telefoni përfshihen{assignedTo ? ' (filtruar sipas agjentit)' : ''}.
                </p>
              )}
              {/* Tag picker (multi-select, works for leads + customers) */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[11px] text-muted-foreground">Etiketat (tags)</label>
                  {selectedTags.length > 1 && (
                    <div className="flex items-center gap-1 text-[10px]">
                      <button onClick={() => setTagMatch('any')}
                        className={`px-1.5 py-0.5 rounded ${tagMatch === 'any' ? 'bg-[#25D366] text-white' : 'bg-muted text-muted-foreground'}`}>Çdo</button>
                      <button onClick={() => setTagMatch('all')}
                        className={`px-1.5 py-0.5 rounded ${tagMatch === 'all' ? 'bg-[#25D366] text-white' : 'bg-muted text-muted-foreground'}`}>Të gjitha</button>
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
                          className={`text-xs px-2 py-1 rounded-full border ${on ? 'bg-[#25D366] text-white border-[#25D366]' : 'border-border text-muted-foreground hover:bg-muted'}`}>
                          {t}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              <div>
                <label className="text-[11px] text-muted-foreground block mb-1">Caktuar te</label>
                <select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}
                  className="w-full px-3 py-2 bg-muted rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#25D366]/40">
                  <option value="">Kushdo</option>
                  {teamMembers?.filter((m) => m.userId).map((m) => <option key={m.id} value={m.userId}>{memberName(m)}</option>)}
                </select>
              </div>
              <p className="text-[10px] text-muted-foreground">
                Ngarkuar: {leads?.length ?? 0} lead · {customers?.length ?? 0} klientë.
              </p>
            </div>

            {/* ── Conditions ───────────────────────────────────────────────── */}
            <div className="border-t border-border pt-3 space-y-2">
              <h4 className="text-xs font-semibold uppercase text-muted-foreground">Kushtet</h4>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] text-muted-foreground block mb-1">Të pakontaktuar prej (ditë)</label>
                  <input type="number" min={0} placeholder="p.sh. 30"
                    value={conditions.lastContactMinDays ?? ''}
                    onChange={(e) => setConditions((c) => ({ ...c, lastContactMinDays: e.target.value === '' ? undefined : Number(e.target.value) }))}
                    className="w-full px-3 py-2 bg-muted rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#25D366]/40" />
                </div>
                <div>
                  <label className="text-[11px] text-muted-foreground block mb-1">Por jo më vjetër se (ditë)</label>
                  <input type="number" min={0} placeholder="pa limit"
                    value={conditions.lastContactMaxDays ?? ''}
                    onChange={(e) => setConditions((c) => ({ ...c, lastContactMaxDays: e.target.value === '' ? undefined : Number(e.target.value) }))}
                    className="w-full px-3 py-2 bg-muted rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#25D366]/40" />
                </div>
              </div>
              {usesDormancy && (
                <p className="text-[10px] text-muted-foreground">
                  “Kontakt” = mesazh WhatsApp, aktivitet ose follow-up. Krijimi i lead-it NUK numërohet, ndaj një lead që
                  nuk e ka prekur kush lexohet si “kurrë i kontaktuar”.
                </p>
              )}
              <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                <label className="flex items-center gap-2 text-xs cursor-pointer">
                  <input type="checkbox" checked={!!conditions.requireNotes}
                    onChange={(e) => setConditions((c) => ({ ...c, requireNotes: e.target.checked || undefined }))}
                    className="rounded border-border accent-[#25D366]" />
                  <span>Vetëm kontakte me shënime <span className="text-muted-foreground">(për {'{{notes}}'})</span></span>
                </label>
                <label className="flex items-center gap-2 text-xs cursor-pointer">
                  <input type="checkbox" checked={!!conditions.requireContacted}
                    onChange={(e) => setConditions((c) => ({ ...c, requireContacted: e.target.checked || undefined }))}
                    className="rounded border-border accent-[#25D366]" />
                  <span>Vetëm kontakte të kontaktuar më parë</span>
                </label>
              </div>
              <div className="w-1/2">
                <label className="text-[11px] text-muted-foreground block mb-1">
                  Limiti për ekzekutim {trigger === 'dormant' && <span className="text-[#25D366]">*</span>}
                </label>
                <input type="number" min={1} placeholder={trigger === 'dormant' ? 'p.sh. 20' : 'pa limit'}
                  value={conditions.dailyCap ?? ''}
                  onChange={(e) => setConditions((c) => ({ ...c, dailyCap: e.target.value === '' ? undefined : Number(e.target.value) }))}
                  className="w-full px-3 py-2 bg-muted rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#25D366]/40" />
              </div>
            </div>

            {/* ── Per-service message variants ─────────────────────────────── */}
            <div className="border-t border-border pt-3 space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-semibold uppercase text-muted-foreground">Tekstet sipas shërbimit</h4>
                <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={addVariant}>
                  <Plus className="w-3 h-3 mr-1" /> Shto variant
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground">
                Varianti zgjidhet nga etiketat e KONTAKTIT — kështu një rregull i vetëm i shkruan njërit për SEO dhe
                tjetrit për Ads, secili me landing page-in e vet. Varianti pa etiketa është rezervë.
                {sendChannel === 'meta' && (
                  <span className="block text-amber-600 mt-0.5">
                    Meta dërgon vetëm template të aprovuar — teksti i lirë punon me Baileys. Në Meta, përdor
                    fushat <code>notes</code>/<code>link</code> te parametrat e template-it.
                  </span>
                )}
              </p>
              {variants.length === 0 && (
                <p className="text-[11px] text-muted-foreground">
                  Asnjë variant — do përdoret trupi i template-it{activeTemplate ? ` “${activeTemplate.name}”` : ''}.
                </p>
              )}
              {variants.map((v) => (
                <div key={v.id} className="border border-border rounded-lg p-2.5 space-y-2">
                  <div className="flex items-center gap-2">
                    <input value={v.label || ''} onChange={(e) => updateVariant(v.id, { label: e.target.value })}
                      placeholder="Emri i variantit (p.sh. SEO — riaktivizim)"
                      className="flex-1 px-2 py-1.5 bg-muted rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-[#25D366]/40" />
                    <button onClick={() => removeVariant(v.id)} className="text-muted-foreground hover:text-destructive shrink-0" aria-label="Fshi variantin">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground block mb-1">
                      Etiketat që e zgjedhin {v.tags.length === 0 && <span className="text-amber-600">— rezervë për të gjithë</span>}
                    </label>
                    {allTags.length === 0 ? (
                      <p className="text-[10px] text-muted-foreground">Asnjë etiketë te lead-et/klientët ende.</p>
                    ) : (
                      <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto">
                        {allTags.map((t) => (
                          <button key={t} onClick={() => toggleVariantTag(v.id, t)}
                            className={`text-[10px] px-1.5 py-0.5 rounded-full border ${v.tags.includes(t) ? 'bg-[#25D366] text-white border-[#25D366]' : 'border-border text-muted-foreground hover:bg-muted'}`}>
                            {t}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <textarea value={v.body} onChange={(e) => updateVariant(v.id, { body: e.target.value })}
                    rows={3} placeholder="Përshëndetje {{name}}, kishim folur për {{notes}}. Ja disa info: {{link}}"
                    className="w-full px-2 py-1.5 bg-muted rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-[#25D366]/40 resize-y" />
                  <div className="flex items-center gap-1.5">
                    <Link2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <input value={v.landingUrl || ''} onChange={(e) => updateVariant(v.id, { landingUrl: e.target.value })}
                      placeholder="https://… landing page për këtë shërbim"
                      className="flex-1 px-2 py-1.5 bg-muted rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-[#25D366]/40" />
                  </div>
                </div>
              ))}
              <p className="text-[10px] text-muted-foreground">
                Fushat: <code>{'{{name}}'}</code> <code>{'{{company}}'}</code> <code>{'{{notes}}'}</code>{' '}
                <code>{'{{service}}'}</code> <code>{'{{link}}'}</code>. Pa <code>{'{{link}}'}</code>, linku shtohet në fund.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] text-muted-foreground block mb-1">Landing page (rezervë)</label>
                  <input value={landingUrl} onChange={(e) => setLandingUrl(e.target.value)} placeholder="https://…"
                    className="w-full px-3 py-2 bg-muted rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#25D366]/40" />
                </div>
                <div>
                  <label className="text-[11px] text-muted-foreground block mb-1">UTM campaign</label>
                  <input value={utmCampaign} onChange={(e) => setUtmCampaign(e.target.value)} placeholder={name || 'emri i fushatës'}
                    className="w-full px-3 py-2 bg-muted rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#25D366]/40" />
                </div>
              </div>
            </div>

            {/* ── Live segment + message preview ───────────────────────────── */}
            <div className="border-t border-border pt-3 space-y-2">
              <p className="text-xs">
                Target: <span className="font-semibold text-[#25D366]">{targetCount}</span> kontakte
                {' '}nga <span className="font-semibold text-foreground">{preview.considered}</span> të shqyrtuar
                {preview.sendableNow < targetCount && (
                  <span className="text-muted-foreground">
                    {' '}· <span className="font-semibold text-foreground">{preview.sendableNow}</span> në ekzekutimin e parë
                    {trigger === 'dormant' ? ', pjesa tjetër në ditët në vijim' : ''}
                  </span>
                )}
              </p>
              {blockedRows.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {blockedRows.map(([reason, n]) => (
                    <span key={reason} className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                      {n} {WA_BLOCK_LABELS[reason] || reason}
                    </span>
                  ))}
                </div>
              )}
              {usesDormancy && (
                <p className="text-[10px] text-amber-600">
                  Kjo shifër numëron vetëm aktivitetin e CRM-së. Serveri numëron edhe mesazhet WhatsApp, ndaj targeti real
                  mund të jetë disa kontakte më i vogël.
                </p>
              )}
              {preview.targets[0]?.message && (
                <div>
                  <p className="text-[10px] text-muted-foreground mb-1">
                    Shembull — {preview.targets[0].contact.name || 'kontakt'}
                    {preview.targets[0].variant?.label ? ` · variant “${preview.targets[0].variant.label}”` : ''}:
                  </p>
                  <div className="rounded-lg rounded-tl-none bg-[#25D366]/10 border border-[#25D366]/30 px-3 py-2 text-xs whitespace-pre-wrap break-words">
                    {preview.targets[0].message}
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={saveDraft} disabled={busy}>Ruaj draft</Button>
              {trigger === 'dormant' ? (
                permissions.isAdmin && (
                  <Button size="sm" className="bg-[#25D366] hover:bg-[#1da851] text-white" onClick={activateAutomation} disabled={busy}>
                    {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Repeat className="w-3.5 h-3.5 mr-1" />} Aktivizo automatizimin
                  </Button>
                )
              ) : (
                <>
                  <Button variant="outline" size="sm" onClick={() => queue(false)} disabled={busy}>
                    <Clock className="w-3.5 h-3.5 mr-1" /> Vendos në radhë
                  </Button>
                  {permissions.isAdmin && (
                    <Button size="sm" className="bg-[#25D366] hover:bg-[#1da851] text-white" onClick={() => queue(true)} disabled={busy}>
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
            {(broadcasts || []).length === 0 && <p className="text-[11px] text-muted-foreground">Asnjë fushatë ende.</p>}
            {(broadcasts || []).map((b) => {
              const isRule = b.trigger === 'dormant';
              return (
                <div key={b.id} className="flex items-center justify-between gap-3 border border-border rounded-lg px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate flex items-center gap-1.5">
                      {isRule && <Repeat className="w-3 h-3 text-[#25D366] shrink-0" />}
                      {b.name}
                    </p>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {b.variants?.length ? `${b.variants.length} variante` : tplName(b.templateId)}
                      {' · '}{(b.channel || 'meta') === 'baileys' ? 'Baileys' : 'Meta'}
                      {' · '}{b.sentCount || 0}{isRule ? ' dërguar' : `/${b.totalTargets ?? '?'} dërguar`}
                      {isRule && b.conditions?.lastContactMinDays != null && ` · >${b.conditions.lastContactMinDays}d pa kontakt`}
                    </p>
                    {b.error && <p className="text-[10px] text-destructive truncate">{b.error}</p>}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${STATUS_BADGE[b.status] || ''}`}>
                      {b.status}
                    </span>
                    {isRule && permissions.isAdmin && (
                      <button onClick={() => toggleRule(b)} title={b.status === 'active' ? 'Pauzo' : 'Aktivizo'}
                        aria-label={b.status === 'active' ? 'Pauzo automatizimin' : 'Aktivizo automatizimin'}
                        className="text-muted-foreground hover:text-foreground">
                        {b.status === 'active' ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

export default WhatsappBroadcasts;
