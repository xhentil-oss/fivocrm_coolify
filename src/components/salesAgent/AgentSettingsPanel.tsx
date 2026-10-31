import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Bot, KeyRound, Loader2, Save, ShieldCheck, Sparkles, Wifi } from 'lucide-react';
import { Card } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Switch } from '../ui/switch';
import { Badge } from '../ui/badge';
import { Textarea } from '../ui/textarea';
import { Checkbox } from '../ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { useCollection } from '../../hooks/useFirestore';
import { saveTeamSettings, type TeamSettings } from '../../hooks/useTeamSettings';
import { useToast } from '../../hooks/use-toast';
import { saveTenantSecrets } from '../../lib/tenantSecrets';
import { describeSalesAgentError, disableSalesAgent, enableSalesAgent, testSalesAgentSettings, type SettingsTestResult } from '../../lib/salesAgent/api';
import {
  AUTONOMY_LABELS, QUALIFICATION_FIELDS, QUALIFICATION_ORDER, SALES_AGENT_LIMITS, SALES_AGENT_MAX_AUTONOMY,
  resolveSalesAgentSettings, type QualificationFieldKey, type SalesAgentAutonomy, type SalesAgentSettings,
} from '../../lib/salesAgent/core';
import type { WhatsAppAccount } from '../../types';
import KnowledgePanel from './KnowledgePanel';
import SimulatorPanel from './SimulatorPanel';

/**
 * /app/sales-agent?tab=settings — everything the owner decides about Ana.
 *
 * `enabled` flips through POST /api/sales-agent (enable/disable: the server creates
 * her profile and validates the keys); everything else is one `teamSettings.salesAgent`
 * merge. Autonomy ≥ 1 and the cold-WhatsApp switch are owner/Admin decisions — a
 * Manager sees the panel read-only (the rules deny the write anyway).
 */
interface Props {
  teamId: string | null;
  settings: TeamSettings | null;
  canEdit: boolean;
}

type Draft = Omit<SalesAgentSettings, 'enabled'>;
const draftFrom = (s: SalesAgentSettings): Draft => { const { enabled: _e, ...rest } = s; return rest; };

function TagInput({ value, onChange, placeholder, disabled }: { value: string[]; onChange: (v: string[]) => void; placeholder: string; disabled?: boolean }) {
  const [text, setText] = useState('');
  const add = () => {
    const parts = text.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
    if (!parts.length) return;
    onChange([...new Set([...value, ...parts])].slice(0, 50));
    setText('');
  };
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1">
        {value.map((v) => (
          <Badge key={v} variant="outline" className="text-[11px] gap-1">
            {v}
            {!disabled && <button type="button" className="ml-0.5 text-muted-foreground hover:text-foreground" onClick={() => onChange(value.filter((x) => x !== v))} aria-label={`Hiq ${v}`}>×</button>}
          </Badge>
        ))}
      </div>
      {!disabled && (
        <Input value={text} onChange={(e) => setText(e.target.value)} onBlur={add} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); } }} placeholder={placeholder} />
      )}
    </div>
  );
}

const Num = ({ label, value, min, max, onChange, disabled, hint }: { label: string; value: number; min: number; max: number; onChange: (n: number) => void; disabled?: boolean; hint?: string }) => (
  <div className="space-y-1">
    <Label className="text-xs">{label}</Label>
    <Input type="number" min={min} max={max} value={value} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))} />
    {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
  </div>
);

export default function AgentSettingsPanel({ teamId, settings, canEdit }: Props) {
  const { toast } = useToast();
  const resolved = useMemo(() => resolveSalesAgentSettings(settings?.salesAgent), [settings?.salesAgent]);
  const [draft, setDraft] = useState<Draft>(() => draftFrom(resolved));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<SettingsTestResult | null>(null);
  const [placesKey, setPlacesKey] = useState('');
  const [savingKey, setSavingKey] = useState(false);
  const { data: waAccounts } = useCollection<WhatsAppAccount>('whatsappAccounts');

  useEffect(() => { if (!dirty) setDraft(draftFrom(resolved)); }, [resolved, dirty]);

  const patch = (p: Partial<Draft>) => { setDraft((d) => ({ ...d, ...p })); setDirty(true); };
  const patchPersona = (p: Partial<Draft['persona']>) => patch({ persona: { ...draft.persona, ...p } });
  const patchCold = (p: Partial<Draft['coldWa']>) => patch({ coldWa: { ...draft.coldWa, ...p } });
  const patchIcp = (p: Partial<Draft['icp']>) => patch({ icp: { ...draft.icp, ...p } });
  const patchMeeting = (p: Partial<Draft['meeting']>) => patch({ meeting: { ...draft.meeting, ...p } });
  const patchChannels = (p: Partial<Draft['channels']>) => patch({ channels: { ...draft.channels, ...p } });

  const handleToggle = async (on: boolean) => {
    if (!teamId || !canEdit) return;
    setToggling(true);
    try {
      if (on) {
        if (dirty) await persist();
        await enableSalesAgent(teamId);
        toast({ title: `${draft.persona.name} u aktivizua`, description: 'Fillon në nivelin e autonomisë që ke zgjedhur.' });
      } else {
        await disableSalesAgent(teamId);
        toast({ title: `${draft.persona.name} u fik`, description: 'Asgjë nuk u fshi — mund ta rindizësh kur të duash.' });
      }
    } catch (err) {
      toast({ title: 'Nuk u ndryshua', description: describeSalesAgentError(err), variant: 'destructive' });
    } finally {
      setToggling(false);
    }
  };

  const persist = async () => {
    if (!teamId || !canEdit) return;
    const clean = resolveSalesAgentSettings({ ...draft, enabled: resolved.enabled });
    const { enabled: _e, ...toStore } = clean;
    await saveTeamSettings(teamId, { salesAgent: toStore } as any);
    setDirty(false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await persist();
      toast({ title: 'U ruajt', description: `Cilësimet e ${draft.persona.name}s u ruajtën.` });
    } catch (err) {
      toast({ title: 'Ruajtja dështoi', description: (err as Error)?.message || 'Provo përsëri.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      setTest(await testSalesAgentSettings());
    } catch (err) {
      toast({ title: 'Testi dështoi', description: describeSalesAgentError(err), variant: 'destructive' });
    } finally {
      setTesting(false);
    }
  };

  const handleSaveKey = async () => {
    if (!teamId || !canEdit || !placesKey.trim()) return;
    setSavingKey(true);
    try {
      await saveTenantSecrets(teamId, { googlePlacesApiKey: placesKey.trim() });
      setPlacesKey('');
      toast({ title: 'Çelësi u ruajt', description: 'Ruhet në kasafortë (teamSecrets); kufizoje në Google Console vetëm për Places API.' });
    } catch (err) {
      toast({ title: 'Nuk u ruajt', description: (err as Error)?.message, variant: 'destructive' });
    } finally {
      setSavingKey(false);
    }
  };

  const ro = !canEdit;
  const waOptions = (waAccounts || []).filter((a) => a.enabled !== false);

  return (
    <div className="space-y-4">
      {/* ── On/off + persona ── */}
      <Card className="p-4 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0"><Bot className="w-5 h-5" /></div>
            <div>
              <h3 className="font-semibold">{draft.persona.name} — asistentja virtuale e shitjeve</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Prezantohet gjithmonë si asistente virtuale (nuk çaktivizohet). Shifrat i thotë vetëm nga katalogu dhe njohuritë; çdo gjë tjetër ia kalon ekipit.</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Badge className={resolved.enabled ? 'bg-emerald-100 text-emerald-800 border-0' : 'bg-muted text-muted-foreground border-0'}>{resolved.enabled ? 'Aktive' : 'E fikur'}</Badge>
            <Switch checked={resolved.enabled} disabled={ro || toggling || !teamId} onCheckedChange={(v) => { void handleToggle(v); }} aria-label="Aktivizo agjenten" />
          </div>
        </div>
        {!canEdit && <p className="text-xs text-amber-700 flex items-center gap-1"><ShieldCheck className="w-3.5 h-3.5" />Vetëm pronari ose një Admin mund t'i ndryshojë këto cilësime.</p>}
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="space-y-1"><Label className="text-xs">Emri</Label><Input value={draft.persona.name} disabled={ro} maxLength={40} onChange={(e) => patchPersona({ name: e.target.value })} /></div>
          <div className="space-y-1"><Label className="text-xs">Biznesi (në prezantim)</Label><Input value={draft.persona.businessName} disabled={ro} maxLength={80} placeholder="Bos Marketing" onChange={(e) => patchPersona({ businessName: e.target.value })} /></div>
          <div className="space-y-1">
            <Label className="text-xs">Toni</Label>
            <Select value={draft.persona.tone} onValueChange={(v) => patchPersona({ tone: v as 'formal' | 'friendly' })} disabled={ro}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="friendly">I ngrohtë, profesional</SelectItem><SelectItem value="formal">Formal</SelectItem></SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Gjuhët (kodi, p.sh. sq, en, it)</Label>
            <TagInput value={draft.persona.languages} disabled={ro} placeholder="sq, en" onChange={(v) => patchPersona({ languages: v.map((l) => l.toLowerCase().slice(0, 2)).slice(0, 5) })} />
          </div>
        </div>
      </Card>

      {/* ── Autonomy ── */}
      <Card className="p-4 space-y-3">
        <h3 className="font-semibold">Niveli i autonomisë</h3>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
          {([0, 1, 2, 3] as SalesAgentAutonomy[]).map((lvl) => {
            const locked = lvl > SALES_AGENT_MAX_AUTONOMY;
            const active = draft.autonomy === lvl;
            return (
              <button key={lvl} type="button" disabled={ro || locked} onClick={() => patch({ autonomy: lvl })}
                className={`text-left rounded-lg border p-3 transition ${active ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-muted/50'} ${locked ? 'opacity-50 cursor-not-allowed' : ''}`}>
                <div className="flex items-center justify-between"><span className="text-sm font-semibold">Niveli {lvl}</span>{locked && <Badge variant="outline" className="text-[10px]">së shpejti</Badge>}</div>
                <div className="text-sm font-medium mt-1">{AUTONOMY_LABELS[lvl].label}</div>
                <p className="text-xs text-muted-foreground mt-1">{AUTONOMY_LABELS[lvl].detail}</p>
              </button>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground">Në çdo nivel: klienti që kërkon njeri, ankohet, ose pyet për çmim që nuk është në fakte → bisedën e merr një person menjëherë.</p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="space-y-1"><Label className="text-xs">Orari i zyrës nga</Label><Input type="time" value={draft.officeFrom} disabled={ro} onChange={(e) => patch({ officeFrom: e.target.value })} /></div>
          <div className="space-y-1"><Label className="text-xs">deri</Label><Input type="time" value={draft.officeTo} disabled={ro} onChange={(e) => patch({ officeTo: e.target.value })} /></div>
          <Num label="Pret një person (min, niveli 1)" value={draft.humanSilenceMinutes} min={1} max={240} disabled={ro} onChange={(n) => patch({ humanSilenceMinutes: n })} hint="Brenda orarit, Ana përgjigjet vetëm nëse askush nuk përgjigjet për kaq minuta." />
          <Num label="SLA e dorëzimit (min)" value={draft.handoffSlaMinutes} min={5} max={1440} disabled={ro} onChange={(n) => patch({ handoffSlaMinutes: n })} hint="Një dorëzim që nuk e merr askush brenda kësaj kohe shkon te menaxherët." />
        </div>
      </Card>

      {/* ── Channels + qualification ── */}
      <div className="grid lg:grid-cols-2 gap-4">
        <Card className="p-4 space-y-3">
          <h3 className="font-semibold">Kanalet</h3>
          {([['whatsapp', 'WhatsApp (inbound)'], ['email', 'Email (forma e landing-ut, sekuenca)'], ['portal', 'Chat-i i portalit të klientit'], ['landingForm', 'Formularët e landing page-ve']] as const).map(([k, label]) => (
            <div key={k} className="flex items-center justify-between gap-3">
              <Label className="text-sm font-normal">{label}</Label>
              <Switch checked={draft.channels[k]} disabled={ro} onCheckedChange={(v) => patchChannels({ [k]: v } as any)} />
            </div>
          ))}
          <div className="grid grid-cols-2 gap-3 pt-2">
            <Num label="Kuota ditore e përgjigjeve AI" value={draft.dailyReplyCap} min={10} max={SALES_AGENT_LIMITS.dailyReplyCapMax} disabled={ro} onChange={(n) => patch({ dailyReplyCap: n })} />
            <Num label="Kthesa pa përparim → dorëzim" value={draft.maxTurnsWithoutProgress} min={2} max={20} disabled={ro} onChange={(n) => patch({ maxTurnsWithoutProgress: n })} />
            <Num label="Kujtesa max për klient të heshtur" value={draft.maxNudges} min={0} max={5} disabled={ro} onChange={(n) => patch({ maxNudges: n })} />
            <Num label="Kujtesa pas (orë)" value={draft.nudgeAfterHours} min={1} max={168} disabled={ro} onChange={(n) => patch({ nudgeAfterHours: n })} />
          </div>
        </Card>
        <Card className="p-4 space-y-3">
          <h3 className="font-semibold">Kualifikimi (niveli 2)</h3>
          <p className="text-xs text-muted-foreground">Një pyetje për mesazh, në këtë rend. Me ≥ 3 përgjigje lead-i shënohet "i kualifikuar" dhe ekipi njoftohet.</p>
          {QUALIFICATION_ORDER.map((f) => (
            <div key={f} className="flex items-start gap-2">
              <Checkbox id={`qf-${f}`} checked={draft.qualificationFields.includes(f)} disabled={ro}
                onCheckedChange={(v) => patch({ qualificationFields: v ? QUALIFICATION_ORDER.filter((x) => x === f || draft.qualificationFields.includes(x)) as QualificationFieldKey[] : draft.qualificationFields.filter((x) => x !== f) })} />
              <div><Label htmlFor={`qf-${f}`} className="text-sm font-medium">{QUALIFICATION_FIELDS[f].label}</Label><p className="text-xs text-muted-foreground">{QUALIFICATION_FIELDS[f].question}</p></div>
            </div>
          ))}
          <div className="grid grid-cols-2 gap-3 pt-2">
            <Num label="Takimi (min)" value={draft.meeting.durationMin} min={15} max={120} disabled={ro} onChange={(n) => patchMeeting({ durationMin: n })} />
            <Num label="Orare të propozuara" value={draft.meeting.slotsToOffer} min={1} max={5} disabled={ro} onChange={(n) => patchMeeting({ slotsToOffer: n })} />
            <div className="space-y-1"><Label className="text-xs">Takime nga</Label><Input type="time" value={draft.meeting.hoursFrom} disabled={ro} onChange={(e) => patchMeeting({ hoursFrom: e.target.value })} /></div>
            <div className="space-y-1"><Label className="text-xs">deri</Label><Input type="time" value={draft.meeting.hoursTo} disabled={ro} onChange={(e) => patchMeeting({ hoursTo: e.target.value })} /></div>
          </div>
        </Card>
      </div>

      {/* ── ICP + Places ── */}
      <Card className="p-4 space-y-3">
        <h3 className="font-semibold">Profili i klientit ideal (Google Maps)</h3>
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="space-y-1"><Label className="text-xs">Kategoritë (fjalë kyçe)</Label><TagInput value={draft.icp.categories} disabled={ro} placeholder="dentist, klinikë, restorant…" onChange={(v) => patchIcp({ categories: v })} /></div>
          <div className="space-y-1"><Label className="text-xs">Qytetet</Label><TagInput value={draft.icp.cities} disabled={ro} placeholder="Tiranë, Durrës…" onChange={(v) => patchIcp({ cities: v })} /></div>
          <div className="space-y-1"><Label className="text-xs">Përjashto (fjalë kyçe)</Label><TagInput value={draft.icp.excludeKeywords} disabled={ro} placeholder="bank, spital…" onChange={(v) => patchIcp({ excludeKeywords: v })} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label className="text-xs">Vlerësimi min.</Label><Input type="number" step="0.1" min={0} max={5} value={draft.icp.minRating} disabled={ro} onChange={(e) => patchIcp({ minRating: Number(e.target.value) })} /></div>
            <Num label="Vlerësime min." value={draft.icp.minReviews} min={0} max={10000} disabled={ro} onChange={(n) => patchIcp({ minReviews: n })} />
          </div>
        </div>
        <div className="flex items-center justify-between gap-3">
          <Label className="text-sm font-normal">Preferoj biznese PA website (shes web/SEO)</Label>
          <Switch checked={draft.icp.preferNoWebsite} disabled={ro} onCheckedChange={(v) => patchIcp({ preferNoWebsite: v })} />
        </div>
        <div className="grid sm:grid-cols-[1fr_auto] gap-3 items-end pt-2 border-t">
          <div className="space-y-1">
            <Label className="text-xs flex items-center gap-1"><KeyRound className="w-3.5 h-3.5" />Çelësi Google Places (API New)</Label>
            <Input type="password" value={placesKey} disabled={ro} placeholder={settings?.hasGooglePlacesApiKey ? '•••••••• (i ruajtur — lëre bosh për të mos e ndryshuar)' : 'AIza…'} onChange={(e) => setPlacesKey(e.target.value)} />
            <p className="text-[11px] text-muted-foreground">Pa çelës të tenant-it përdoret çelësi i platformës me kuotë më të vogël. Çdo kërkim = deri në 3 kërkesa (20 biznese secila); 1 000 kërkesa/muaj janë falas te Google.</p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={ro || savingKey || !placesKey.trim()} onClick={handleSaveKey}>{savingKey ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}Ruaj çelësin</Button>
            <Num label="Buxheti mujor (kërkesa)" value={draft.placesMonthlyBudget} min={0} max={SALES_AGENT_LIMITS.placesBudgetMax} disabled={ro} onChange={(n) => patch({ placesMonthlyBudget: n })} />
          </div>
        </div>
      </Card>

      {/* ── Cold WhatsApp ── */}
      <Card className="p-4 space-y-3 border-amber-300/60">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold">Mesazhi i parë në WhatsApp (kontakt i ftohtë)</h3>
            <p className="text-xs text-muted-foreground mt-1">Për prospektet nga Google Maps që nuk na kanë shkruar kurrë.</p>
          </div>
          <Switch checked={draft.coldWa.enabled} disabled={ro} onCheckedChange={(v) => patchCold({ enabled: v })} aria-label="Lejo mesazhe të ftohta" />
        </div>
        <div className="rounded-md bg-amber-500/10 border border-amber-500/30 p-3 text-xs text-amber-800 dark:text-amber-300 flex gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p><b>Rrezik real:</b> mesazhet e pakërkuara janë shkaku kryesor që WhatsApp bllokon një numër — dhe me të humbet edhe historiku. Kufijtë më poshtë janë të fiksuar në motor, jo vetëm këtu: ≤ 10 në ditë dhe ≥ 1 orë mes mesazheve për numër, vetëm ditët e punës brenda dritares, kurrë në ditën e regjistrimit, prezantim + "NDALO" në çdo mesazh.</p>
            <p>1 bllokim/dështim në 24 orë e përgjysmon kuotën; 2 e ndalojnë numrin për 7 ditë. Rekomandim i fortë: përdor një numër të dedikuar, jo numrin kryesor të biznesit.</p>
          </div>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <Num label="Në ditë (max 10)" value={draft.coldWa.perDay} min={1} max={SALES_AGENT_LIMITS.coldWaPerDayMax} disabled={ro || !draft.coldWa.enabled} onChange={(n) => patchCold({ perDay: n })} />
          <Num label="Min. minuta mes mesazheve (≥ 60)" value={draft.coldWa.minGapMinutes} min={SALES_AGENT_LIMITS.coldWaMinGapMinutesMin} max={1440} disabled={ro || !draft.coldWa.enabled} onChange={(n) => patchCold({ minGapMinutes: n })} />
          <div className="space-y-1"><Label className="text-xs">Dritarja nga</Label><Input type="time" value={draft.coldWa.hoursFrom} disabled={ro || !draft.coldWa.enabled} onChange={(e) => patchCold({ hoursFrom: e.target.value })} /></div>
          <div className="space-y-1"><Label className="text-xs">deri</Label><Input type="time" value={draft.coldWa.hoursTo} disabled={ro || !draft.coldWa.enabled} onChange={(e) => patchCold({ hoursTo: e.target.value })} /></div>
          <Num label="Warm-up: në ditë (max 3)" value={draft.coldWa.warmupPerDay} min={1} max={SALES_AGENT_LIMITS.coldWaWarmupPerDayMax} disabled={ro || !draft.coldWa.enabled} onChange={(n) => patchCold({ warmupPerDay: n })} />
          <Num label="Warm-up: ditë" value={draft.coldWa.warmupDays} min={0} max={30} disabled={ro || !draft.coldWa.enabled} onChange={(n) => patchCold({ warmupDays: n })} />
          <div className="space-y-1 sm:col-span-2">
            <Label className="text-xs">Numri dërgues</Label>
            <Select value={draft.coldWa.senderAgentId || '__auto__'} onValueChange={(v) => patchCold({ senderAgentId: v === '__auto__' ? null : v })} disabled={ro || !draft.coldWa.enabled}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__auto__">Automatik (numri i lidhur i ekipit)</SelectItem>
                {waOptions.map((a) => <SelectItem key={a.id} value={a.id}>{a.label || a.id}{a.connectedPhone ? ` · ${a.connectedPhone}` : ''}{a.connectionStatus === 'connected' ? ' · lidhur' : ''}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex items-center justify-between gap-3">
          <Label className="text-sm font-normal">Vetëm ditët e punës (Hën–Pre)</Label>
          <Switch checked={draft.coldWa.weekdaysOnly} disabled={ro || !draft.coldWa.enabled} onCheckedChange={(v) => patchCold({ weekdaysOnly: v })} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Mesazhi i parë (template)</Label>
          <Textarea rows={3} value={draft.coldWa.template} disabled={ro || !draft.coldWa.enabled} maxLength={600} onChange={(e) => patchCold({ template: e.target.value })} />
          <p className="text-[11px] text-muted-foreground">Tokenë: {'{{name}} {{company}} {{agent}} {{business}} {{service}} {{city}}'}. Prezantimi dhe rreshti "NDALO" shtohen vetë nëse mungojnë.</p>
        </div>
      </Card>

      {/* ── Actions ── */}
      <div className="flex flex-wrap gap-2 items-center">
        <Button onClick={handleSave} disabled={ro || saving || !dirty}>{saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}Ruaj</Button>
        <Button variant="outline" onClick={handleTest} disabled={testing}>{testing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Wifi className="w-4 h-4 mr-2" />}Testo lidhjen</Button>
        {dirty && <span className="text-xs text-amber-700">Ndryshime të paruajtura</span>}
      </div>
      {test && (
        <Card className="p-3 text-sm space-y-1">
          <div className="flex items-center gap-2"><Sparkles className="w-4 h-4" /><b>AI:</b> {test.ai.ok ? <span className="text-emerald-700">OK{test.ai.provider ? ` · ${test.ai.provider}` : ''}{test.ai.model ? ` · ${test.ai.model}` : ''}</span> : <span className="text-red-700">{test.ai.code || 'dështoi'}{test.ai.detail ? ` — ${test.ai.detail}` : ''}</span>}</div>
          <div className="flex items-center gap-2"><KeyRound className="w-4 h-4" /><b>Google Places:</b> {test.places.ok ? <span className="text-emerald-700">OK · çelësi {test.places.source === 'tenant' ? 'i tenant-it' : 'i platformës'}</span> : <span className="text-red-700">{test.places.configured ? (test.places.error || 'dështoi') : 'pa çelës'}</span>}</div>
        </Card>
      )}

      <KnowledgePanel canEdit={canEdit} />
      <SimulatorPanel personaName={draft.persona.name} />
    </div>
  );
}
