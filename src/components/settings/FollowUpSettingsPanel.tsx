import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BellRing, Bot, Clock, Loader2, MessageSquareReply, Plus, Sparkles, UserPlus, X, Zap } from 'lucide-react';
import { Card } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Switch } from '../ui/switch';
import { Textarea } from '../ui/textarea';
import { Badge } from '../ui/badge';
import { useCollection } from '../../hooks/useFirestore';
import { saveTeamSettings, type TeamSettings } from '../../hooks/useTeamSettings';
import { useToast } from '../../hooks/use-toast';
import { FOLLOW_UP_LIMITS, normalizeCadenceDays, resolveFollowUpConfig } from '../../lib/crm/followUpConfig';
import type { WhatsAppTemplate } from '../../types';

/**
 * Cilësimet → Automatizimi → "Ndjekja & Përgjigjet automatike".
 *
 * ONE place for every follow-up / WhatsApp-reply knob that used to be spread over
 * the lead drawer, the WhatsApp inbox modal (WhatsappAutomation.tsx, deleted) and
 * hard-coded constants. Every section saves only its own keys through
 * `saveTeamSettings` (merge), so a half-edited card never clobbers another.
 * Numeric thresholds are validated by `resolveFollowUpConfig` — the same resolver
 * the UI (leadIntel) and the cron (api/_followUpConfig.ts) read them with.
 */
interface Props {
  teamId: string | null;
  settings: TeamSettings | null;
  canEdit: boolean;
}

type Draft = Partial<TeamSettings>;
const SECTION_KEYS = {
  followUp: ['leadCadenceDays', 'followUpSlaHours', 'followUpStaleDays', 'waResponseSlaMinutes'],
  autoReply: ['waGreetingEnabled', 'waGreetingText', 'waGreetingAfterDays', 'waAutoReplyEnabled', 'waAutoReplyText',
    'waBusinessStart', 'waBusinessEnd', 'waBusinessDays', 'waAutoReplyDebounceHours'],
  ai: ['waAiAssist', 'waAiContext', 'waAiDailyCap'],
  reminders: ['waFollowUpEnabled', 'waFollowUpTemplateId', 'waFollowUpChannelPhoneNumberId', 'waAutoReminderEnabled',
    'waAutoReminderDays', 'waAutoReminderStatuses', 'waAutoReminderTemplateId', 'waAutoReminderChannelPhoneNumberId',
    'waOverdueEnabled', 'waOverdueDays', 'waOverdueTemplateId', 'waOverdueChannelPhoneNumberId'],
  newLead: ['waAutoCreateLead', 'waAutoCreateLeadDailyCap'],
} as const satisfies Record<string, readonly (keyof TeamSettings)[]>;
type SectionId = keyof typeof SECTION_KEYS;

const WEEKDAYS: { value: number; label: string }[] = [
  { value: 1, label: 'Hën' }, { value: 2, label: 'Mar' }, { value: 3, label: 'Mër' }, { value: 4, label: 'Enj' },
  { value: 5, label: 'Pre' }, { value: 6, label: 'Sht' }, { value: 0, label: 'Die' },
];
const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'New', label: 'Të reja' }, { value: 'Contacted', label: 'Kontaktuara' }, { value: 'Qualified', label: 'Kualifikuara' },
  { value: 'Follow-up', label: 'Në ndjekje' }, { value: 'Proposal', label: 'Propozim' },
];
const SAMPLE_CONTACT = { firstName: 'Arben', name: 'Arben Hoxha', company: 'Hoxha Shpk' };

/** Preview-only token rendering ({{firstName}} {{name}} {{company}}; unknown → ''). */
function previewTokens(text: string): string {
  return (text || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, key: string) =>
    (SAMPLE_CONTACT as Record<string, string>)[key] ?? '');
}

/** Read the draft from the stored settings, applying the documented defaults. */
function draftFrom(s: TeamSettings | null): Draft {
  const cfg = resolveFollowUpConfig(s);
  return {
    leadCadenceDays: cfg.leadCadenceDays,
    followUpSlaHours: s?.followUpSlaHours ?? cfg.followUpSlaHours,
    followUpStaleDays: s?.followUpStaleDays ?? cfg.followUpStaleDays,
    waResponseSlaMinutes: s?.waResponseSlaMinutes ?? cfg.waResponseSlaMinutes,
    waGreetingEnabled: !!s?.waGreetingEnabled,
    waGreetingText: s?.waGreetingText || '',
    waGreetingAfterDays: s?.waGreetingAfterDays ?? 7,
    waAutoReplyEnabled: !!s?.waAutoReplyEnabled,
    waAutoReplyText: s?.waAutoReplyText || '',
    waBusinessStart: s?.waBusinessStart || '09:00',
    waBusinessEnd: s?.waBusinessEnd || '17:00',
    waBusinessDays: Array.isArray(s?.waBusinessDays) && s!.waBusinessDays!.length ? s!.waBusinessDays! : [1, 2, 3, 4, 5],
    waAutoReplyDebounceHours: s?.waAutoReplyDebounceHours ?? 6,
    waAiAssist: s?.waAiAssist ?? (s?.hasAiApiKey ? 'draft' : 'off'),
    waAiContext: s?.waAiContext || '',
    waAiDailyCap: s?.waAiDailyCap ?? 200,
    waFollowUpEnabled: !!s?.waFollowUpEnabled,
    waFollowUpTemplateId: s?.waFollowUpTemplateId || '',
    waFollowUpChannelPhoneNumberId: s?.waFollowUpChannelPhoneNumberId || '',
    waAutoReminderEnabled: !!s?.waAutoReminderEnabled,
    waAutoReminderDays: s?.waAutoReminderDays ?? 7,
    waAutoReminderStatuses: s?.waAutoReminderStatuses ?? ['Follow-up', 'Proposal'],
    waAutoReminderTemplateId: s?.waAutoReminderTemplateId || '',
    waAutoReminderChannelPhoneNumberId: s?.waAutoReminderChannelPhoneNumberId || '',
    waOverdueEnabled: !!s?.waOverdueEnabled,
    waOverdueDays: s?.waOverdueDays ?? 60,
    waOverdueTemplateId: s?.waOverdueTemplateId || '',
    waOverdueChannelPhoneNumberId: s?.waOverdueChannelPhoneNumberId || '',
    waAutoCreateLead: s?.waAutoCreateLead !== false,
    waAutoCreateLeadDailyCap: s?.waAutoCreateLeadDailyCap ?? 50,
  };
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// ── Small building blocks ────────────────────────────────────────────────────

const SectionCard: React.FC<{
  icon: React.ReactNode; title: string; description: string; dirty: boolean; saving: boolean; canEdit: boolean;
  onSave: () => void; children: React.ReactNode;
}> = ({ icon, title, description, dirty, saving, canEdit, onSave, children }) => (
  <Card className="p-4 sm:p-6 space-y-4">
    <div className="flex items-start gap-3">
      <div className="p-2 bg-muted rounded-lg shrink-0">{icon}</div>
      <div className="min-w-0">
        <h3 className="font-semibold text-foreground">{title}</h3>
        <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
      </div>
    </div>
    <div className="space-y-4">{children}</div>
    {canEdit && (
      <div className="flex justify-end pt-1">
        <Button size="sm" onClick={onSave} disabled={!dirty || saving}>
          {saving && <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />}
          {dirty ? 'Ruaj ndryshimet' : 'E ruajtur'}
        </Button>
      </div>
    )}
  </Card>
);

const NumberField: React.FC<{
  label: string; value: number | undefined; onChange: (v: number) => void; min: number; max: number;
  suffix?: string; hint?: string; disabled?: boolean;
}> = ({ label, value, onChange, min, max, suffix, hint, disabled }) => {
  const invalid = value === undefined || !Number.isInteger(value) || value < min || value > max;
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <div className="flex items-center gap-2">
        <Input type="number" min={min} max={max} step={1} value={value ?? ''} disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
          className={`w-24 h-9 ${invalid ? 'border-destructive' : ''}`} />
        {suffix && <span className="text-xs text-muted-foreground">{suffix}</span>}
      </div>
      <p className={`text-[11px] ${invalid ? 'text-destructive' : 'text-muted-foreground'}`}>
        {invalid ? `Vlerë midis ${min} dhe ${max}` : hint}
      </p>
    </div>
  );
};

/** Editable, sorted, unique cadence day chips (1–90, max 8). */
const DayChips: React.FC<{ days: number[]; onChange: (d: number[]) => void; disabled?: boolean }> = ({ days, onChange, disabled }) => {
  const [input, setInput] = useState('');
  const { min, max, maxEntries } = FOLLOW_UP_LIMITS.leadCadenceDays;
  const add = () => {
    const next = normalizeCadenceDays([...days, input]);
    if (next) { onChange(next); setInput(''); }
  };
  const canAdd = !disabled && days.length < maxEntries && normalizeCadenceDays([...days, input]) !== null;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {days.map((d) => (
          <span key={d} className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-full bg-primary/10 text-primary border border-primary/20">
            Dita {d}
            {!disabled && days.length > 1 && (
              <button type="button" aria-label={`Hiq ditën ${d}`} onClick={() => onChange(days.filter((x) => x !== d))}
                className="hover:text-destructive"><X className="w-3 h-3" /></button>
            )}
          </span>
        ))}
        {days.length === 0 && <span className="text-xs text-muted-foreground">Asnjë hap</span>}
      </div>
      {!disabled && (
        <div className="flex items-center gap-2">
          <Input type="number" min={min} max={max} value={input} placeholder="p.sh. 21" className="w-24 h-8 text-sm"
            onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
          <Button type="button" size="sm" variant="outline" className="h-8" onClick={add} disabled={!canAdd}>
            <Plus className="w-3.5 h-3.5 mr-1" /> Shto ditë
          </Button>
          <span className="text-[11px] text-muted-foreground">{days.length}/{maxEntries} hapa · 1–{max} ditë</span>
        </div>
      )}
    </div>
  );
};

const WeekdayToggle: React.FC<{ value: number[]; onChange: (v: number[]) => void; disabled?: boolean }> = ({ value, onChange, disabled }) => (
  <div className="flex flex-wrap gap-1.5">
    {WEEKDAYS.map((d) => {
      const on = value.includes(d.value);
      return (
        <button key={d.value} type="button" disabled={disabled} aria-pressed={on}
          onClick={() => onChange(on ? value.filter((x) => x !== d.value) : [...value, d.value].sort((a, b) => a - b))}
          className={`px-2.5 py-1 text-xs rounded-full border transition-colors disabled:opacity-50 ${
            on ? 'bg-primary text-primary-foreground border-primary' : 'bg-background border-border hover:bg-muted'}`}>
          {d.label}
        </button>
      );
    })}
  </div>
);

const NativeSelect: React.FC<React.SelectHTMLAttributes<HTMLSelectElement>> = ({ className = '', ...rest }) => (
  <select {...rest}
    className={`w-full h-9 px-3 bg-muted rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50 ${className}`} />
);

const ToggleRow: React.FC<{ label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }> =
  ({ label, hint, checked, onChange, disabled }) => (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        {hint && <p className="text-[11px] text-muted-foreground mt-0.5">{hint}</p>}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </div>
  );

// ── Panel ────────────────────────────────────────────────────────────────────

const FollowUpSettingsPanel: React.FC<Props> = ({ teamId, settings, canEdit }) => {
  const { toast } = useToast();
  const { data: templates } = useCollection<WhatsAppTemplate>('waTemplates');
  const channels = settings?.metaChannels || [];
  const [draft, setDraft] = useState<Draft>(() => draftFrom(settings));
  const [saving, setSaving] = useState<SectionId | null>(null);
  const [touched, setTouched] = useState<Set<keyof TeamSettings>>(new Set());

  // Follow the document for keys the user has NOT touched (another admin may save).
  useEffect(() => {
    const fresh = draftFrom(settings);
    setDraft((prev) => {
      const next: Draft = { ...fresh };
      touched.forEach((k) => { (next as Record<string, unknown>)[k] = prev[k]; });
      return next;
    });
  }, [settings]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = <K extends keyof TeamSettings>(key: K, value: TeamSettings[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setTouched((t) => new Set(t).add(key));
  };
  const ro = !canEdit;
  const stored = useMemo(() => draftFrom(settings), [settings]);
  const isDirty = (id: SectionId) => SECTION_KEYS[id].some((k) => !sameJson(draft[k], stored[k]));

  const save = async (id: SectionId) => {
    if (!teamId) return;
    setSaving(id);
    try {
      const patch: Record<string, unknown> = {};
      for (const k of SECTION_KEYS[id]) patch[k] = draft[k] ?? null;
      if (id === 'followUp') {
        // Write only what the resolver accepts — the cron reads through the same one.
        const cfg = resolveFollowUpConfig(draft);
        const corrected = SECTION_KEYS.followUp.some((k) => !sameJson(draft[k], cfg[k]));
        Object.assign(patch, cfg);
        if (corrected) toast({ title: 'Disa vlera u korrigjuan në kufijtë e lejuar' });
      }
      if (id === 'autoReply') {
        patch.waGreetingText = String(draft.waGreetingText || '').trim();
        patch.waAutoReplyText = String(draft.waAutoReplyText || '').trim();
      }
      if (id === 'ai') patch.waAiContext = String(draft.waAiContext || '').trim();
      await saveTeamSettings(teamId, patch as Partial<TeamSettings>);
      setTouched((t) => { const n = new Set(t); SECTION_KEYS[id].forEach((k) => n.delete(k)); return n; });
      toast({ title: 'U ruajt' });
    } catch (err) {
      console.error('[FollowUpSettingsPanel] save failed', err);
      toast({ title: 'Gabim', description: 'Ruajtja dështoi (vetëm pronari/admin i ekipit mund t’i ndryshojë).', variant: 'destructive' });
    } finally {
      setSaving(null);
    }
  };

  const sectionProps = (id: SectionId) => ({ dirty: isDirty(id), saving: saving === id, canEdit, onSave: () => void save(id) });
  const templateOptions = (
    <>
      <option value="">— Zgjidh —</option>
      {templates?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
    </>
  );
  const channelSelect = (value: string, onChange: (v: string) => void, disabled: boolean) => channels.length > 1 && (
    <div className="space-y-1.5">
      <Label className="text-xs">Kanali Meta</Label>
      <NativeSelect value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
        <option value="">I pari</option>
        {channels.map((c) => <option key={c.phoneNumberId} value={c.phoneNumberId}>{c.label || c.phone}</option>)}
      </NativeSelect>
    </div>
  );
  const templateBlock = (tplKey: 'waFollowUpTemplateId' | 'waAutoReminderTemplateId' | 'waOverdueTemplateId',
    chKey: 'waFollowUpChannelPhoneNumberId' | 'waAutoReminderChannelPhoneNumberId' | 'waOverdueChannelPhoneNumberId', disabled: boolean) => (
    <div className="grid sm:grid-cols-2 gap-3">
      <div className="space-y-1.5">
        <Label className="text-xs">Template</Label>
        <NativeSelect value={draft[tplKey] || ''} onChange={(e) => set(tplKey, e.target.value)} disabled={disabled}>{templateOptions}</NativeSelect>
      </div>
      {channelSelect(draft[chKey] || '', (v) => set(chKey, v), disabled)}
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <BellRing className="w-5 h-5 text-primary" />
        <h2 className="text-lg font-semibold">Ndjekja & Përgjigjet automatike</h2>
        {!canEdit && <Badge variant="secondary" className="ml-auto">Vetëm lexim</Badge>}
      </div>

      {/* 1 · Ndjekja */}
      <SectionCard icon={<Clock className="w-5 h-5 text-primary" />} title="Ndjekja"
        description="Pragjet që ndajnë një lead “në kohë” nga një “i vonuar” — të njëjtat për CRM-në, radhën Ndjekjet dhe njoftimet." {...sectionProps('followUp')}>
        <div className="space-y-1.5">
          <Label className="text-xs">Kadenca e ndjekjes së lead-eve (ditë nga regjistrimi)</Label>
          <DayChips days={draft.leadCadenceDays || []} onChange={(d) => set('leadCadenceDays', d)} disabled={ro} />
          <p className="text-[11px] text-muted-foreground">Për lead-et me kadencë aktive krijohet një detyrë ndjekjeje në secilën nga këto ditë.</p>
        </div>
        <div className="grid sm:grid-cols-3 gap-4">
          <NumberField label="SLA e përgjigjes së parë" value={draft.followUpSlaHours} onChange={(v) => set('followUpSlaHours', v)}
            min={FOLLOW_UP_LIMITS.followUpSlaHours.min} max={FOLLOW_UP_LIMITS.followUpSlaHours.max} suffix="orë" hint="Lead pa kontakt → alarm SLA" disabled={ro} />
          <NumberField label="Lead “i ftohur” pas" value={draft.followUpStaleDays} onChange={(v) => set('followUpStaleDays', v)}
            min={FOLLOW_UP_LIMITS.followUpStaleDays.min} max={FOLLOW_UP_LIMITS.followUpStaleDays.max} suffix="ditë" hint="Pa asnjë aktivitet" disabled={ro} />
          <NumberField label="SLA e përgjigjes WhatsApp" value={draft.waResponseSlaMinutes} onChange={(v) => set('waResponseSlaMinutes', v)}
            min={FOLLOW_UP_LIMITS.waResponseSlaMinutes.min} max={FOLLOW_UP_LIMITS.waResponseSlaMinutes.max} suffix="min" hint="Mesazh hyrës pa përgjigje" disabled={ro} />
        </div>
        <p className="text-xs text-muted-foreground flex items-center gap-1.5 bg-muted/60 rounded-md px-3 py-2">
          <BellRing className="w-3.5 h-3.5 shrink-0" /> Kujtesat e ditës (lead-e dhe klientë me hap për sot ose të vonuar) dërgohen çdo mëngjes në 08:30 (ora e Tiranës).
        </p>
      </SectionCard>

      {/* 2 · Përgjigje automatike WhatsApp */}
      <SectionCard icon={<MessageSquareReply className="w-5 h-5 text-[#25D366]" />} title="Përgjigje automatike WhatsApp"
        description="Të vetmet mesazhe që dërgohen pa njeri: përshëndetja e kontaktit të parë dhe mesazhi jashtë orarit. Tokenët: {{firstName}} {{name}} {{company}}." {...sectionProps('autoReply')}>
        <ToggleRow label="Përshëndetje për kontaktin e parë" checked={!!draft.waGreetingEnabled} onChange={(v) => set('waGreetingEnabled', v)} disabled={ro}
          hint="Dërgohet një herë kur na shkruan një numër pa histori." />
        <Textarea rows={2} value={draft.waGreetingText || ''} onChange={(e) => set('waGreetingText', e.target.value)} disabled={ro || !draft.waGreetingEnabled}
          placeholder="Përshëndetje {{firstName}}! Faleminderit që na kontaktuat — një koleg do t’ju përgjigjet shpejt." />
        <NumberField label="Kontakt “i ri” pas heshtjes prej" value={draft.waGreetingAfterDays} onChange={(v) => set('waGreetingAfterDays', v)}
          min={1} max={365} suffix="ditë" hint="Pas kësaj periudhe përshëndetja dërgohet sërish" disabled={ro || !draft.waGreetingEnabled} />
        <div className="border-t border-border" />
        <ToggleRow label="Mesazh jashtë orarit" checked={!!draft.waAutoReplyEnabled} onChange={(v) => set('waAutoReplyEnabled', v)} disabled={ro}
          hint="Kur një klient shkruan jashtë orarit të punës (ora e Tiranës)." />
        <Textarea rows={2} value={draft.waAutoReplyText || ''} onChange={(e) => set('waAutoReplyText', e.target.value)} disabled={ro || !draft.waAutoReplyEnabled}
          placeholder="Faleminderit që na shkruat! Jemi jashtë orarit; do t’ju përgjigjemi sa më parë." />
        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Orari i punës</Label>
            <div className="flex items-center gap-2">
              <Input type="time" className="w-28 h-9" value={draft.waBusinessStart || ''} onChange={(e) => set('waBusinessStart', e.target.value)} disabled={ro || !draft.waAutoReplyEnabled} />
              <span className="text-xs text-muted-foreground">deri</span>
              <Input type="time" className="w-28 h-9" value={draft.waBusinessEnd || ''} onChange={(e) => set('waBusinessEnd', e.target.value)} disabled={ro || !draft.waAutoReplyEnabled} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Ditët e punës</Label>
            <WeekdayToggle value={draft.waBusinessDays || []} onChange={(v) => set('waBusinessDays', v)} disabled={ro || !draft.waAutoReplyEnabled} />
          </div>
        </div>
        <NumberField label="Jo më shpesh se një herë në" value={draft.waAutoReplyDebounceHours} onChange={(v) => set('waAutoReplyDebounceHours', v)}
          min={1} max={168} suffix="orë për kontakt" hint="Vlen për të dy mesazhet automatike" disabled={ro} />
        {(draft.waGreetingEnabled || draft.waAutoReplyEnabled) && (
          <div className="rounded-lg bg-muted/60 p-3 space-y-2">
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Pamje paraprake · {SAMPLE_CONTACT.name}</p>
            {draft.waGreetingEnabled && (
              <div className="text-sm bg-[#dcf8c6] dark:bg-emerald-900/40 text-foreground rounded-lg rounded-tl-none px-3 py-2 max-w-md whitespace-pre-wrap">
                {previewTokens(draft.waGreetingText || '') || <span className="text-muted-foreground italic">Përshëndetja është bosh</span>}
              </div>
            )}
            {draft.waAutoReplyEnabled && (
              <div className="text-sm bg-[#dcf8c6] dark:bg-emerald-900/40 text-foreground rounded-lg rounded-tl-none px-3 py-2 max-w-md whitespace-pre-wrap">
                {previewTokens(draft.waAutoReplyText || '') || <span className="text-muted-foreground italic">Mesazhi jashtë orarit është bosh</span>}
              </div>
            )}
          </div>
        )}
      </SectionCard>

      {/* 3 · Asistenti AI */}
      <SectionCard icon={<Bot className="w-5 h-5 text-primary" />} title="Asistenti AI"
        description="AI propozon, njeriu dërgon: për çdo mesazh hyrës përgatitet një draft që stafi e shqyrton dhe e dërgon. Asgjë nuk shkon te klienti pa një klik." {...sectionProps('ai')}>
        {!settings?.hasAiApiKey && (
          <p className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-md px-3 py-2">
            Nuk ka çelës AI të konfiguruar — draftet nuk gjenerohen.{' '}
            <Link to="/app/settings?tab=integrations" className="underline font-medium">Shto çelësin te Integrimet →</Link>
          </p>
        )}
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Mënyra</Label>
            <NativeSelect value={draft.waAiAssist || 'off'} onChange={(e) => set('waAiAssist', e.target.value as 'off' | 'draft')} disabled={ro}>
              <option value="off">Fikur</option>
              <option value="draft">Draft — AI propozon, njeriu dërgon</option>
            </NativeSelect>
          </div>
          <NumberField label="Kufi ditor draftesh" value={draft.waAiDailyCap} onChange={(v) => set('waAiDailyCap', v)} min={1} max={5000} suffix="/ditë" disabled={ro || draft.waAiAssist === 'off'} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Konteksti i biznesit për AI</Label>
          <Textarea rows={4} value={draft.waAiContext || ''} onChange={(e) => set('waAiContext', e.target.value)} disabled={ro}
            placeholder="Përshkrimi i biznesit, shërbimet, orari, politika e çmimeve (p.sh. “çmimet jepen vetëm pas takimit”)." />
          <p className="text-[11px] text-muted-foreground flex items-center gap-1"><Sparkles className="w-3 h-3" /> Kurrë fjalëkalime, çelësa apo të dhëna klientësh — teksti futet në prompt.</p>
        </div>
      </SectionCard>

      {/* 4 · Rikujtues automatikë (moved from WhatsappAutomation.tsx, same keys) */}
      <SectionCard icon={<Zap className="w-5 h-5 text-[#25D366]" />} title="Rikujtues automatikë WhatsApp"
        description="Template-e Meta që dërgohen nga cron-i: në datën e rikontaktit, pas X ditësh heshtjeje dhe për fatura të vonuara." {...sectionProps('reminders')}>
        <ToggleRow label="Follow-up automatik me template" checked={!!draft.waFollowUpEnabled} onChange={(v) => set('waFollowUpEnabled', v)} disabled={ro}
          hint="Kur një lead arrin datën e rikontaktit, dërgohet template-i i zgjedhur (përveç njoftimit te agjenti)." />
        {templateBlock('waFollowUpTemplateId', 'waFollowUpChannelPhoneNumberId', ro || !draft.waFollowUpEnabled)}
        <div className="border-t border-border" />
        <ToggleRow label="Rikujtues për lead në pritje" checked={!!draft.waAutoReminderEnabled} onChange={(v) => set('waAutoReminderEnabled', v)} disabled={ro}
          hint="Lead në statuset e zgjedhura, pa komunikim prej X ditësh → template automatik." />
        <div className="flex flex-wrap items-end gap-4">
          <NumberField label="Pas" value={draft.waAutoReminderDays} onChange={(v) => set('waAutoReminderDays', v)} min={1} max={90} suffix="ditësh pa komunikim" disabled={ro || !draft.waAutoReminderEnabled} />
          <div className="space-y-1.5 pb-5">
            <Label className="text-xs">Statuset</Label>
            <div className="flex flex-wrap gap-1.5">
              {STATUS_OPTIONS.map((s) => {
                const on = (draft.waAutoReminderStatuses || []).includes(s.value);
                return (
                  <button key={s.value} type="button" disabled={ro || !draft.waAutoReminderEnabled} aria-pressed={on}
                    onClick={() => set('waAutoReminderStatuses', on ? (draft.waAutoReminderStatuses || []).filter((x) => x !== s.value) : [...(draft.waAutoReminderStatuses || []), s.value])}
                    className={`px-2.5 py-1 text-xs rounded-full border transition-colors disabled:opacity-50 ${on ? 'bg-[#25D366] text-white border-[#25D366]' : 'bg-background border-border hover:bg-muted'}`}>
                    {s.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        {templateBlock('waAutoReminderTemplateId', 'waAutoReminderChannelPhoneNumberId', ro || !draft.waAutoReminderEnabled)}
        <div className="border-t border-border" />
        <ToggleRow label="Eskalim për fatura të vonuara" checked={!!draft.waOverdueEnabled} onChange={(v) => set('waOverdueEnabled', v)} disabled={ro}
          hint="Faturë e papaguar (Overdue) më shumë se X ditë → template te klienti (përveç email-it javor). Klientët me opsionin e fikur anashkalohen." />
        <NumberField label="Pas" value={draft.waOverdueDays} onChange={(v) => set('waOverdueDays', v)} min={1} max={365} suffix="ditësh vonesë (60 ≈ 2 muaj)" disabled={ro || !draft.waOverdueEnabled} />
        {templateBlock('waOverdueTemplateId', 'waOverdueChannelPhoneNumberId', ro || !draft.waOverdueEnabled)}
      </SectionCard>

      {/* 5 · Lead i ri nga WhatsApp */}
      <SectionCard icon={<UserPlus className="w-5 h-5 text-primary" />} title="Lead i ri nga WhatsApp"
        description="Një numër i panjohur që na shkruan bëhet automatikisht lead (burimi: whatsapp), i caktuar te agjenti i kanalit." {...sectionProps('newLead')}>
        <ToggleRow label="Krijo lead për numra të panjohur" checked={draft.waAutoCreateLead !== false} onChange={(v) => set('waAutoCreateLead', v)} disabled={ro}
          hint="Mesazhi ruhet gjithsesi; vetëm krijimi i lead-it varet nga ky çelës." />
        <NumberField label="Kufi ditor lead-esh të reja" value={draft.waAutoCreateLeadDailyCap} onChange={(v) => set('waAutoCreateLeadDailyCap', v)}
          min={1} max={1000} suffix="/ditë" hint="Mbrojtje nga spam-i; mbi kufi mesazhi ruhet pa lead" disabled={ro || draft.waAutoCreateLead === false} />
      </SectionCard>
    </div>
  );
};

export default FollowUpSettingsPanel;
