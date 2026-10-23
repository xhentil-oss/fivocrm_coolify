import React, { useMemo, useState } from 'react';
import { Zap, Plus, Play, History, Pencil, Trash2, AlertTriangle, Sparkles, ChevronRight, X } from 'lucide-react';
import { Card } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Switch } from '../../components/ui/switch';
import { Textarea } from '../../components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '../../components/ui/alert-dialog';
import { useCollection, useMutation } from '../../hooks/useFirestore';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../hooks/use-toast';
import { getTimestampMs } from '../../lib/utils';
import { LEAD_STAGES, leadStageLabel } from '../../lib/leadStages';
import {
  ACTION_META, AUTOMATION_RECIPES, BLOCK_LABELS, CONDITION_META, OP_LABELS, TRIGGER_META,
  WA_DAILY_CAP_DEFAULT, customerFacts, describeRule, evaluateRule, leadFacts, overdueInvoiceFact, recipeToDraft, ruleSendsWhatsapp, validateRule,
  type AutomationAction, type AutomationActionType, type AutomationCondition, type AutomationEntity,
  type AutomationRule, type AutomationRun, type ConditionField, type ConditionOp, type EntityFacts,
  type OverdueInvoiceFact, type RuleDraft, type TriggerKind,
} from '../../lib/crm/automationRules';
import type { Customer, Invoice, Lead } from '../../types';

/**
 * CRM → Automatizime: the rule builder + the list of rules with their run stats.
 *
 * The preview ("Tani përputhen N nga M") runs the SAME pure engine the cron runs
 * (src/lib/crm/automationRules.ts ≡ api/_crmAutomationEngine.ts), over the records
 * already loaded on the CRM page. It ignores the firing history on purpose: it
 * answers "who qualifies right now", the cron answers "who has not been fired yet".
 */

type Member = { userId: string; name?: string; displayName?: string; email?: string; role?: string };

interface Props {
  leads: Lead[];
  customers: Customer[];
  teamMembers: Member[];
  getName: (id?: string, fallback?: string) => string;
  canManage: boolean;
}

const ENTITY_LABEL: Record<AutomationEntity, string> = { lead: 'Lead', customer: 'Klient' };

const emptyDraft = (entity: AutomationEntity): RuleDraft => ({
  name: '',
  description: '',
  entity,
  status: 'paused',
  trigger: { kind: entity === 'lead' ? 'lead_created' : 'customer_created' },
  conditions: [],
  actions: [],
  enrollExisting: false,
  cooldownDays: null,
  maxPerRun: null,
  maxPerDay: null,
});

const defaultAction = (type: AutomationActionType): AutomationAction => {
  switch (type) {
    case 'assign': return { type, mode: 'round_robin' };
    case 'create_task': return { type, title: 'Ndiq {{name}}', description: '', dueInDays: 1, priority: 'medium', assignTo: 'owner' };
    case 'notify': return { type, to: 'owner', title: '{{name}}', message: '' };
    case 'add_tags': return { type, tags: [] };
    case 'set_status': return { type, status: 'Contacted' };
    case 'start_cadence': return { type };
    case 'send_email': return { type, subject: 'Përshëndetje {{firstName}}', body: '' };
    case 'send_whatsapp': return { type, text: 'Përshëndetje {{firstName}}, ' };
    default: return { type: 'notify', to: 'owner', title: '' };
  }
};

const defaultCondition = (entity: AutomationEntity): AutomationCondition =>
  entity === 'lead' ? { field: 'status', op: 'in', values: [] } : { field: 'assigned', op: 'is', value: true };

const relTime = (v: unknown): string => {
  const ms = getTimestampMs(v as any);
  if (!ms) return '—';
  const diff = Date.now() - ms;
  const m = Math.round(diff / 60_000);
  if (m < 1) return 'tani';
  if (m < 60) return `${m} min më parë`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} orë më parë`;
  return `${Math.round(h / 24)} ditë më parë`;
};

const splitList = (s: string): string[] => s.split(/[,\n;]/).map(x => x.trim()).filter(Boolean);

// ── Panel ─────────────────────────────────────────────────────────────────────

const AutomationRulesPanel: React.FC<Props> = ({ leads, customers, teamMembers, getName, canManage }) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const { data: rawRules } = useCollection<AutomationRule>('crmAutomationRules');
  const mutation = useMutation<AutomationRule>('crmAutomationRules');

  const rules = useMemo(
    () => [...(rawRules || [])].sort((a, b) => (getTimestampMs(b.createdAt as any) || 0) - (getTimestampMs(a.createdAt as any) || 0)),
    [rawRules],
  );

  const [editing, setEditing] = useState<{ id: string | null; draft: RuleDraft } | null>(null);
  const [showRecipes, setShowRecipes] = useState(false);
  const [historyRule, setHistoryRule] = useState<AutomationRule | null>(null);
  const [deleting, setDeleting] = useState<AutomationRule | null>(null);
  const [running, setRunning] = useState<string | null>(null);

  const toggleStatus = async (r: AutomationRule) => {
    if (!canManage) return;
    const next = r.status === 'active' ? 'paused' : 'active';
    if (next === 'active') {
      const errs = validateRule(r);
      if (errs.length) { toast({ title: 'Rregulli nuk mund të aktivizohet', description: errs[0], variant: 'destructive' }); return; }
    }
    try {
      await mutation.update(r.id, { status: next, error: null } as any);
      toast({ title: next === 'active' ? 'Rregulli u aktivizua' : 'Rregulli u pauzua', description: next === 'active' ? 'Ekzekutohet automatikisht çdo orë.' : undefined });
    } catch (e: any) {
      toast({ title: 'Gabim', description: e?.message, variant: 'destructive' });
    }
  };

  const runNow = async (r: AutomationRule) => {
    if (!user) return;
    setRunning(r.id);
    try {
      const token = await user.getIdToken();
      const resp = await fetch(`/api/cron/run?job=crm-automations&manual=1&ruleId=${encodeURIComponent(r.id)}`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` },
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json?.error || `HTTP ${resp.status}`);
      const res = json?.result || json;
      toast({
        title: r.status === 'active' ? 'Rregulli u ekzekutua' : 'Rregulli është i pauzuar',
        description: r.status === 'active'
          ? `${res?.fired ?? 0} ndezje nga ${res?.considered ?? 0} rekorde të shqyrtuara.`
          : 'Aktivizoje që të ekzekutohet.',
      });
    } catch (e: any) {
      toast({ title: 'Ekzekutimi dështoi', description: e?.message, variant: 'destructive' });
    } finally {
      setRunning(null);
    }
  };

  const saveDraft = async (id: string | null, draft: RuleDraft) => {
    const errs = validateRule(draft);
    if (errs.length) { toast({ title: 'Kontrollo rregullin', description: errs[0], variant: 'destructive' }); return false; }
    const payload: any = {
      name: draft.name.trim(),
      description: draft.description?.trim() || '',
      entity: draft.entity,
      status: draft.status,
      trigger: draft.trigger,
      conditions: draft.conditions,
      actions: draft.actions,
      enrollExisting: !!draft.enrollExisting,
      cooldownDays: draft.cooldownDays ?? null,
      maxPerRun: draft.maxPerRun ?? null,
      maxPerDay: draft.maxPerDay ?? null,
    };
    try {
      if (id) await mutation.update(id, payload);
      else await mutation.create({ ...payload, roundRobinCursor: 0, totalFired: 0, error: null });
      toast({ title: id ? 'Rregulli u ruajt' : 'Rregulli u krijua', description: draft.status === 'active' ? 'Aktiv — ekzekutohet çdo orë.' : 'I pauzuar — aktivizoje kur të jesh gati.' });
      return true;
    } catch (e: any) {
      toast({ title: 'Gabim', description: e?.message, variant: 'destructive' });
      return false;
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await mutation.remove(deleting.id);
      toast({ title: 'Rregulli u fshi' });
    } catch (e: any) {
      toast({ title: 'Gabim', description: e?.message, variant: 'destructive' });
    } finally {
      setDeleting(null);
    }
  };

  const activeCount = rules.filter(r => r.status === 'active').length;

  return (
    <div className="space-y-4">
      <Card className="p-4 sm:p-5">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
          <div className="flex items-start gap-3">
            <div className="h-9 w-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0"><Zap className="h-5 w-5" /></div>
            <div>
              <h2 className="font-semibold">Automatizimet e CRM</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Kur ndodh X, nëse Y, atëherë Z — për lead dhe klientë. Ekzekutohen çdo orë; çdo ndezje regjistrohet një herë.
                {rules.length > 0 && <> · <span className="font-medium text-foreground">{activeCount}</span> aktive nga {rules.length}</>}
              </p>
            </div>
          </div>
          {canManage && (
            <div className="flex gap-2 shrink-0">
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setShowRecipes(true)}>
                <Sparkles className="h-4 w-4" /> Receta
              </Button>
              <Button size="sm" className="gap-1.5" onClick={() => setEditing({ id: null, draft: emptyDraft('lead') })}>
                <Plus className="h-4 w-4" /> Rregull i ri
              </Button>
            </div>
          )}
        </div>
      </Card>

      {rules.length === 0 ? (
        <Card className="p-8 text-center">
          <Sparkles className="h-8 w-8 mx-auto text-muted-foreground/60" />
          <p className="mt-3 font-medium">Asnjë rregull ende</p>
          <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
            Nis me një recetë të gatshme: shpërndarja e lead-eve të reja me radhë, alarmi për propozimet e ngecura, onboarding-u i klientit të ri, arkëtimi i faturave të vonuara.
          </p>
          {canManage && (
            <Button className="mt-4 gap-1.5" onClick={() => setShowRecipes(true)}><Sparkles className="h-4 w-4" /> Shiko recetat</Button>
          )}
        </Card>
      ) : (
        <div className="grid gap-3">
          {rules.map(r => (
            <RuleCard
              key={r.id}
              rule={r}
              canManage={canManage}
              running={running === r.id}
              onToggle={() => toggleStatus(r)}
              onEdit={() => setEditing({ id: r.id, draft: { ...r, conditions: r.conditions || [], actions: r.actions || [] } })}
              onRun={() => runNow(r)}
              onHistory={() => setHistoryRule(r)}
              onDelete={() => setDeleting(r)}
            />
          ))}
        </div>
      )}

      {showRecipes && (
        <Dialog open onOpenChange={o => { if (!o) setShowRecipes(false); }}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle className="flex items-center gap-2"><Sparkles className="h-4 w-4" /> Receta të gatshme</DialogTitle></DialogHeader>
            <p className="text-xs text-muted-foreground -mt-2">Çdo recetë hapet në ndërtues, e pauzuar — rregulloje dhe aktivizoje kur të jesh gati.</p>
            <div className="grid sm:grid-cols-2 gap-3 mt-2">
              {AUTOMATION_RECIPES.map(rec => (
                <button
                  key={rec.key}
                  type="button"
                  className="text-left rounded-lg border p-3 hover:border-primary/60 hover:bg-primary/5 transition-colors"
                  onClick={() => { setShowRecipes(false); setEditing({ id: null, draft: recipeToDraft(rec) }); }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-sm">{rec.name}</span>
                    <Badge variant="outline" className="text-[10px]">{ENTITY_LABEL[rec.entity]}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{rec.description}</p>
                  <p className="text-[11px] text-primary mt-2 flex items-center gap-1">Përdor <ChevronRight className="h-3 w-3" /></p>
                </button>
              ))}
            </div>
          </DialogContent>
        </Dialog>
      )}

      {editing && (
        <RuleBuilderDialog
          id={editing.id}
          initial={editing.draft}
          leads={leads}
          customers={customers}
          teamMembers={teamMembers}
          getName={getName}
          onClose={() => setEditing(null)}
          onSave={async (draft) => { const ok = await saveDraft(editing.id, draft); if (ok) setEditing(null); }}
        />
      )}

      {historyRule && <RunHistoryDialog rule={historyRule} onClose={() => setHistoryRule(null)} />}

      <AlertDialog open={!!deleting} onOpenChange={o => { if (!o) setDeleting(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Fshi rregullin “{deleting?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Rregulli ndalon menjëherë. Detyrat, njoftimet dhe caktimet që ka bërë deri tani mbeten — historiku i ndezjeve ruhet.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Anulo</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Fshi</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default AutomationRulesPanel;

// ── Rule card ─────────────────────────────────────────────────────────────────

const RuleCard: React.FC<{
  rule: AutomationRule;
  canManage: boolean;
  running: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onRun: () => void;
  onHistory: () => void;
  onDelete: () => void;
}> = ({ rule, canManage, running, onToggle, onEdit, onRun, onHistory, onDelete }) => {
  const blocked = Object.entries(rule.lastRunBlocked || {}).filter(([, n]) => (n || 0) > 0) as [keyof typeof BLOCK_LABELS, number][];
  return (
    <Card className={`p-4 ${rule.status === 'active' ? '' : 'opacity-80'}`}>
      <div className="flex flex-col sm:flex-row sm:items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-medium truncate">{rule.name}</h3>
            <Badge variant="outline" className="text-[10px]">{ENTITY_LABEL[rule.entity]}</Badge>
            <Badge variant={rule.status === 'active' ? 'default' : 'secondary'} className="text-[10px]">{rule.status === 'active' ? 'Aktiv' : 'Pauzë'}</Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-1">{describeRule(rule)}</p>
          {rule.description && <p className="text-xs text-muted-foreground/80 mt-0.5">{rule.description}</p>}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-[11px] text-muted-foreground">
            <span>Ekzekutimi i fundit: <span className="text-foreground">{relTime(rule.lastRunAt)}</span></span>
            <span>Ndezur gjithsej: <span className="text-foreground font-medium tabular-nums">{rule.totalFired || 0}</span></span>
            {rule.lastRunAt != null && (
              <span>Herën e fundit: <span className="text-foreground tabular-nums">{rule.lastRunFired || 0}</span> nga {rule.lastRunConsidered || 0}</span>
            )}
          </div>
          {blocked.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {blocked.map(([k, n]) => (
                <span key={k} className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{n} {BLOCK_LABELS[k] || k}</span>
              ))}
            </div>
          )}
          {rule.error && (
            <div className="mt-2 flex items-start gap-1.5 text-xs text-destructive"><AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" /> <span>Pauzuar automatikisht: {rule.error}</span></div>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {canManage && <Switch checked={rule.status === 'active'} onCheckedChange={onToggle} aria-label="Aktiv" />}
          <Button variant="ghost" size="sm" className="h-8 px-2" onClick={onHistory} title="Historiku i ndezjeve"><History className="h-4 w-4" /></Button>
          {canManage && (
            <>
              <Button variant="ghost" size="sm" className="h-8 px-2" onClick={onRun} disabled={running} title="Ekzekuto tani"><Play className={`h-4 w-4 ${running ? 'animate-pulse' : ''}`} /></Button>
              <Button variant="ghost" size="sm" className="h-8 px-2" onClick={onEdit} title="Ndrysho"><Pencil className="h-4 w-4" /></Button>
              <Button variant="ghost" size="sm" className="h-8 px-2 text-destructive hover:text-destructive" onClick={onDelete} title="Fshi"><Trash2 className="h-4 w-4" /></Button>
            </>
          )}
        </div>
      </div>
    </Card>
  );
};

// ── Builder ───────────────────────────────────────────────────────────────────

const RuleBuilderDialog: React.FC<{
  id: string | null;
  initial: RuleDraft;
  leads: Lead[];
  customers: Customer[];
  teamMembers: Member[];
  getName: (id?: string, fallback?: string) => string;
  onClose: () => void;
  onSave: (draft: RuleDraft) => Promise<void>;
}> = ({ id, initial, leads, customers, teamMembers, getName, onClose, onSave }) => {
  const [draft, setDraft] = useState<RuleDraft>(initial);
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<RuleDraft>) => setDraft(d => ({ ...d, ...patch }));

  const needInvoices = draft.entity === 'customer';
  const { data: invoices } = useCollection<Invoice>('invoices', { skip: !needInvoices });

  const triggerMeta = TRIGGER_META[draft.trigger.kind];
  const triggerKinds = (Object.keys(TRIGGER_META) as TriggerKind[]).filter(k => TRIGGER_META[k].entity === draft.entity);
  const conditionFields = (Object.keys(CONDITION_META) as ConditionField[]).filter(f => CONDITION_META[f].entity === 'both' || CONDITION_META[f].entity === draft.entity);
  const actionTypes = (Object.keys(ACTION_META) as AutomationActionType[]).filter(t => ACTION_META[t].entity === 'both' || ACTION_META[t].entity === draft.entity);

  const sources = useMemo(() => [...new Set((draft.entity === 'lead' ? leads : customers).map((x: any) => String(x.source || '').trim()).filter(Boolean))].sort(), [draft.entity, leads, customers]);
  const allTags = useMemo(() => [...new Set((draft.entity === 'lead' ? leads : customers).flatMap((x: any) => Array.isArray(x.tags) ? x.tags.map((t: string) => String(t).trim().toLowerCase()) : []).filter(Boolean))].sort(), [draft.entity, leads, customers]);

  const changeEntity = (entity: AutomationEntity) => {
    if (entity === draft.entity) return;
    // Conditions/actions that only exist for leads are dropped, the rest kept.
    setDraft(d => ({
      ...d,
      entity,
      trigger: { kind: entity === 'lead' ? 'lead_created' : 'customer_created' },
      conditions: d.conditions.filter(c => CONDITION_META[c.field]?.entity === 'both'),
      actions: d.actions.filter(a => ACTION_META[a.type]?.entity === 'both'),
    }));
  };

  // Preview — the same engine, the same facts the cron builds, minus the run history.
  const preview = useMemo(() => {
    const now = Date.now();
    let population: EntityFacts[];
    if (draft.entity === 'lead') {
      population = leads.map(l => leadFacts(l.id, l as any, now));
    } else {
      const byCustomer = new Map<string, OverdueInvoiceFact[]>();
      const touch = new Map<string, number>();
      for (const inv of invoices || []) {
        const cid = String((inv as any).customerId || '');
        if (!cid) continue;
        const f = overdueInvoiceFact(inv.id, inv as any, now);
        if (f) byCustomer.set(cid, [...(byCustomer.get(cid) || []), f]);
        const t = Math.max(getTimestampMs((inv as any).createdAt) || 0, getTimestampMs((inv as any).updatedAt) || 0);
        if (t > (touch.get(cid) || 0)) touch.set(cid, t);
      }
      population = customers.map(c => customerFacts(c.id, c as any, { lastActivityMs: touch.get(c.id) ?? null, overdueInvoices: byCustomer.get(c.id) || [] }, now));
    }
    const rule: AutomationRule = { id: id || 'preview', businessId: '', createdAt: null, updatedAt: null, createdByUserId: null, ...draft } as AutomationRule;
    const errs = validateRule(draft);
    if (errs.length && !draft.actions.length) return { errs, result: null as ReturnType<typeof evaluateRule> | null };
    return { errs, result: evaluateRule({ ...rule, maxPerRun: 100000 }, population, { ruleCreatedAtMs: draft.enrollExisting ? null : Date.now() - 1 }, now) };
  }, [draft, leads, customers, invoices, id]);

  const updateCondition = (i: number, patch: Partial<AutomationCondition>) =>
    set({ conditions: draft.conditions.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  const updateAction = (i: number, patch: Partial<AutomationAction>) =>
    set({ actions: draft.actions.map((a, j) => (j === i ? ({ ...a, ...patch } as AutomationAction) : a)) });

  const submit = async (status: 'active' | 'paused') => {
    setSaving(true);
    try { await onSave({ ...draft, status }); } finally { setSaving(false); }
  };

  const members = teamMembers.filter(m => m.userId);
  const memberLabel = (uid: string) => getName(uid, uid);

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Zap className="h-4 w-4" /> {id ? 'Ndrysho rregullin' : 'Rregull i ri'}</DialogTitle>
        </DialogHeader>

        <div className="grid lg:grid-cols-[1fr_300px] gap-5">
          <div className="space-y-5">
            {/* Identity */}
            <section className="space-y-3">
              <div className="grid sm:grid-cols-[1fr_180px] gap-3">
                <div>
                  <Label className="text-xs">Emri i rregullit</Label>
                  <Input value={draft.name} onChange={e => set({ name: e.target.value })} placeholder="p.sh. Lead i ri → cakto me radhë" className="mt-1" />
                </div>
                <div>
                  <Label className="text-xs">Për</Label>
                  <div className="mt-1 inline-flex rounded-md border p-0.5 w-full">
                    {(['lead', 'customer'] as AutomationEntity[]).map(e => (
                      <button
                        key={e}
                        type="button"
                        onClick={() => changeEntity(e)}
                        className={`flex-1 px-3 py-1.5 text-xs font-medium rounded transition-colors ${draft.entity === e ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                        aria-pressed={draft.entity === e}
                      >
                        {ENTITY_LABEL[e]}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div>
                <Label className="text-xs">Përshkrim (opsional)</Label>
                <Input value={draft.description || ''} onChange={e => set({ description: e.target.value })} placeholder="Çfarë synon ky rregull" className="mt-1" />
              </div>
            </section>

            {/* Trigger */}
            <section className="rounded-lg border p-3 space-y-3">
              <h4 className="text-sm font-semibold flex items-center gap-2"><span className="h-5 w-5 rounded-full bg-primary/10 text-primary text-[11px] flex items-center justify-center font-bold">1</span> Kur</h4>
              <div className="grid sm:grid-cols-[1fr_160px] gap-3">
                <Select value={draft.trigger.kind} onValueChange={v => set({ trigger: { kind: v as TriggerKind } })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {triggerKinds.map(k => <SelectItem key={k} value={k}>{TRIGGER_META[k].label}</SelectItem>)}
                  </SelectContent>
                </Select>
                {triggerMeta?.needs === 'status' && (
                  <Select value={draft.trigger.status || ''} onValueChange={v => set({ trigger: { ...draft.trigger, status: v } })}>
                    <SelectTrigger><SelectValue placeholder="Faza" /></SelectTrigger>
                    <SelectContent>
                      {LEAD_STAGES.map(s => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
                {triggerMeta?.needs === 'days' && (
                  <div className="flex items-center gap-2">
                    <Input type="number" min={1} value={draft.trigger.days ?? ''} onChange={e => set({ trigger: { ...draft.trigger, days: Number(e.target.value) || undefined } })} placeholder="X" />
                    <span className="text-xs text-muted-foreground whitespace-nowrap">ditë</span>
                  </div>
                )}
                {triggerMeta?.needs === 'hours' && (
                  <div className="flex items-center gap-2">
                    <Input type="number" min={1} value={draft.trigger.hours ?? ''} onChange={e => set({ trigger: { ...draft.trigger, hours: Number(e.target.value) || undefined } })} placeholder="X" />
                    <span className="text-xs text-muted-foreground whitespace-nowrap">orë</span>
                  </div>
                )}
              </div>
              <p className="text-xs text-muted-foreground">{triggerMeta?.help}</p>
              <div className="flex flex-wrap gap-4 pt-1">
                {!triggerMeta?.recurring && (
                  <label className="flex items-center gap-2 text-xs">
                    <Switch checked={!!draft.enrollExisting} disabled={ruleSendsWhatsapp(draft) && !draft.enrollExisting} onCheckedChange={v => set({ enrollExisting: v })} />
                    Zbatoje edhe për rekordet ekzistuese
                    {ruleSendsWhatsapp(draft) && <span className="text-muted-foreground">(jo me WhatsApp — vetëm rekordet e reja)</span>}
                  </label>
                )}
                {ruleSendsWhatsapp(draft) && (
                  <div className="flex items-center gap-2 text-xs">
                    <span>Maks. mesazhe WhatsApp në 24 orë</span>
                    <Input type="number" min={1} max={200} className="h-8 w-20" value={draft.maxPerDay ?? ''} placeholder={String(WA_DAILY_CAP_DEFAULT)} onChange={e => set({ maxPerDay: e.target.value === '' ? null : Number(e.target.value) })} />
                  </div>
                )}
                {triggerMeta?.recurring && (
                  <div className="flex items-center gap-2 text-xs">
                    <span>Periudha e pritjes</span>
                    <Input type="number" min={0} className="h-8 w-20" value={draft.cooldownDays ?? ''} placeholder={String(draft.trigger.days || (draft.trigger.hours ? Math.max(1, Math.round((draft.trigger.hours || 24) / 24)) : 1))} onChange={e => set({ cooldownDays: e.target.value === '' ? null : Number(e.target.value) })} />
                    <span className="text-muted-foreground">ditë para se të ndizet sërish për të njëjtin rekord (bosh = dritarja e ndezësit)</span>
                  </div>
                )}
              </div>
            </section>

            {/* Conditions */}
            <section className="rounded-lg border p-3 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold flex items-center gap-2"><span className="h-5 w-5 rounded-full bg-primary/10 text-primary text-[11px] flex items-center justify-center font-bold">2</span> Nëse <span className="text-xs font-normal text-muted-foreground">(të gjitha duhen plotësuar)</span></h4>
                <Button type="button" variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => set({ conditions: [...draft.conditions, defaultCondition(draft.entity)] })}><Plus className="h-3 w-3" /> Kusht</Button>
              </div>
              {draft.conditions.length === 0 && <p className="text-xs text-muted-foreground">Pa kushte — rregulli zbatohet për çdo {ENTITY_LABEL[draft.entity].toLowerCase()} që plotëson ndezësin.</p>}
              {draft.conditions.map((c, i) => {
                const meta = CONDITION_META[c.field];
                const ops = meta.input === 'boolean' ? (['is'] as ConditionOp[]) : meta.ops;
                return (
                  <div key={i} className="grid sm:grid-cols-[170px_150px_1fr_32px] gap-2 items-start">
                    <Select value={c.field} onValueChange={v => { const m = CONDITION_META[v as ConditionField]; updateCondition(i, { field: v as ConditionField, op: m.ops[0], values: [], value: m.input === 'boolean' ? true : undefined }); }}>
                      <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>{conditionFields.map(f => <SelectItem key={f} value={f}>{CONDITION_META[f].label}</SelectItem>)}</SelectContent>
                    </Select>
                    <Select value={c.op} onValueChange={v => updateCondition(i, { op: v as ConditionOp })}>
                      <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>{ops.map(o => <SelectItem key={o} value={o}>{OP_LABELS[o]}</SelectItem>)}</SelectContent>
                    </Select>
                    <div>
                      {meta.input === 'number' && (
                        <Input type="number" className="h-9" value={typeof c.value === 'number' ? c.value : ''} onChange={e => updateCondition(i, { value: e.target.value === '' ? undefined : Number(e.target.value) })} />
                      )}
                      {meta.input === 'boolean' && (
                        <Select value={c.value === false ? 'false' : 'true'} onValueChange={v => updateCondition(i, { value: v === 'true' })}>
                          <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                          <SelectContent><SelectItem value="true">Po</SelectItem><SelectItem value="false">Jo</SelectItem></SelectContent>
                        </Select>
                      )}
                      {meta.input === 'users' && (
                        <UserMultiSelect value={c.values || []} members={members} label={memberLabel} onChange={values => updateCondition(i, { values })} />
                      )}
                      {meta.input === 'list' && meta.options && (
                        <ChipMultiSelect value={c.values || []} options={meta.options} render={c.field === 'status' ? (v => leadStageLabel(v as any)) : undefined} onChange={values => updateCondition(i, { values })} />
                      )}
                      {meta.input === 'list' && !meta.options && (
                        <ListInput
                          value={c.values || []}
                          suggestions={c.field === 'source' ? sources : c.field === 'tags' ? allTags : []}
                          onChange={values => updateCondition(i, { values })}
                        />
                      )}
                    </div>
                    <Button type="button" variant="ghost" size="sm" className="h-9 w-8 px-0" onClick={() => set({ conditions: draft.conditions.filter((_, j) => j !== i) })}><X className="h-4 w-4" /></Button>
                  </div>
                );
              })}
            </section>

            {/* Actions */}
            <section className="rounded-lg border p-3 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold flex items-center gap-2"><span className="h-5 w-5 rounded-full bg-primary/10 text-primary text-[11px] flex items-center justify-center font-bold">3</span> Atëherë</h4>
                <Select value="" onValueChange={v => set({ actions: [...draft.actions, defaultAction(v as AutomationActionType)] })}>
                  <SelectTrigger className="h-7 w-[170px] text-xs"><SelectValue placeholder="+ Shto veprim" /></SelectTrigger>
                  <SelectContent>{actionTypes.map(t => <SelectItem key={t} value={t}>{ACTION_META[t].label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              {draft.actions.length === 0 && <p className="text-xs text-muted-foreground">Shto të paktën një veprim.</p>}
              {draft.actions.map((a, i) => (
                <div key={i} className="rounded-md bg-muted/40 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-sm font-medium">{ACTION_META[a.type].label}</span>
                      <span className="text-xs text-muted-foreground ml-2">{ACTION_META[a.type].help}</span>
                    </div>
                    <Button type="button" variant="ghost" size="sm" className="h-7 w-7 px-0" onClick={() => set({ actions: draft.actions.filter((_, j) => j !== i) })}><X className="h-4 w-4" /></Button>
                  </div>
                  <ActionEditor action={a} members={members} label={memberLabel} onChange={patch => updateAction(i, patch)} />
                </div>
              ))}
              <p className="text-[11px] text-muted-foreground">Tokenë në tekste: {'{{name}} {{firstName}} {{company}} {{email}} {{phone}} {{status}} {{value}} {{days}} {{owner}} {{invoice}} {{amount}}'}</p>
            </section>
          </div>

          {/* Preview */}
          <aside className="space-y-3">
            <Card className="p-3">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pamje paraprake</h4>
              {preview.result ? (
                <>
                  <p className="text-2xl font-bold tabular-nums mt-1">{preview.result.fires.length}<span className="text-sm font-normal text-muted-foreground"> nga {preview.result.considered}</span></p>
                  <p className="text-[11px] text-muted-foreground">{ENTITY_LABEL[draft.entity]} që plotësojnë ndezësin dhe kushtet tani (pa historikun e ndezjeve).</p>
                  {Object.entries(preview.result.blocked).length > 0 && (
                    <ul className="mt-2 space-y-0.5">
                      {Object.entries(preview.result.blocked).map(([k, n]) => (
                        <li key={k} className="text-[11px] text-muted-foreground flex justify-between gap-2"><span>{BLOCK_LABELS[k as keyof typeof BLOCK_LABELS] || k}</span><span className="tabular-nums">{n}</span></li>
                      ))}
                    </ul>
                  )}
                  {Object.entries(preview.result.failedConditions).length > 0 && (
                    <p className="text-[11px] text-muted-foreground mt-1">Kushtet që s’plotësohen më shpesh: {Object.entries(preview.result.failedConditions).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([f, n]) => `${CONDITION_META[f as ConditionField]?.label || f} (${n})`).join(', ')}</p>
                  )}
                  {preview.result.fires.length > 0 && (
                    <div className="mt-2 border-t pt-2">
                      <p className="text-[11px] text-muted-foreground mb-1">Shembuj:</p>
                      <ul className="text-xs space-y-0.5">
                        {preview.result.fires.slice(0, 6).map((f, i) => <li key={i} className="truncate">• {f.facts.name}{f.facts.company ? ` · ${f.facts.company}` : ''}</li>)}
                        {preview.result.fires.length > 6 && <li className="text-muted-foreground">… +{preview.result.fires.length - 6}</li>}
                      </ul>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-xs text-muted-foreground mt-1">Plotëso ndezësin dhe shto një veprim për të parë kush përputhet.</p>
              )}
            </Card>
            {preview.errs.length > 0 && (
              <Card className="p-3 border-amber-300/60 bg-amber-50/40 dark:bg-amber-950/20">
                <ul className="text-xs space-y-1">
                  {preview.errs.map((e, i) => <li key={i} className="flex gap-1.5"><AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" /> {e}</li>)}
                </ul>
              </Card>
            )}
            <Card className="p-3 text-[11px] text-muted-foreground space-y-1">
              <p>• Ekzekutohet çdo orë nga serveri; “Ekzekuto tani” e nis menjëherë.</p>
              <p>• Çdo rekord ndizet një herë për çdo rast (faturë, fazë, dritare pritjeje) — asnjë email a detyrë dyfish.</p>
              <p>• Emailet dërgohen me ofruesin e konfiguruar në Cilësimet → Integrime.</p>
            </Card>
          </aside>
        </div>

        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2 border-t mt-2">
          <Button variant="ghost" onClick={onClose} disabled={saving}>Anulo</Button>
          <Button variant="outline" onClick={() => submit('paused')} disabled={saving || preview.errs.length > 0}>Ruaj pauzuar</Button>
          <Button onClick={() => submit('active')} disabled={saving || preview.errs.length > 0} className="gap-1.5"><Play className="h-4 w-4" /> Ruaj dhe aktivizo</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

// ── Inputs ────────────────────────────────────────────────────────────────────

const ChipMultiSelect: React.FC<{ value: string[]; options: string[]; render?: (v: string) => string; onChange: (v: string[]) => void }> = ({ value, options, render, onChange }) => {
  const lower = value.map(v => v.toLowerCase());
  return (
    <div className="flex flex-wrap gap-1">
      {options.map(o => {
        const on = lower.includes(o.toLowerCase());
        return (
          <button
            key={o}
            type="button"
            onClick={() => onChange(on ? value.filter(v => v.toLowerCase() !== o.toLowerCase()) : [...value, o])}
            className={`px-2 py-1 rounded text-xs border transition-colors ${on ? 'bg-primary text-primary-foreground border-primary' : 'bg-background text-muted-foreground hover:text-foreground'}`}
            aria-pressed={on}
          >
            {render ? render(o) : o}
          </button>
        );
      })}
    </div>
  );
};

const UserMultiSelect: React.FC<{ value: string[]; members: Member[]; label: (uid: string) => string; onChange: (v: string[]) => void }> = ({ value, members, label, onChange }) => (
  <div className="flex flex-wrap gap-1">
    {members.map(m => {
      const on = value.includes(m.userId);
      return (
        <button
          key={m.userId}
          type="button"
          onClick={() => onChange(on ? value.filter(v => v !== m.userId) : [...value, m.userId])}
          className={`px-2 py-1 rounded text-xs border transition-colors ${on ? 'bg-primary text-primary-foreground border-primary' : 'bg-background text-muted-foreground hover:text-foreground'}`}
          aria-pressed={on}
        >
          {label(m.userId)}
        </button>
      );
    })}
    {members.length === 0 && <span className="text-xs text-muted-foreground">Asnjë anëtar aktiv.</span>}
  </div>
);

const ListInput: React.FC<{ value: string[]; suggestions: string[]; onChange: (v: string[]) => void }> = ({ value, suggestions, onChange }) => {
  const [text, setText] = useState(value.join(', '));
  const unused = suggestions.filter(s => !value.map(v => v.toLowerCase()).includes(s.toLowerCase())).slice(0, 8);
  return (
    <div className="space-y-1">
      <Input
        className="h-9"
        value={text}
        placeholder="vlera, të ndara me presje"
        onChange={e => { setText(e.target.value); onChange(splitList(e.target.value)); }}
      />
      {unused.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {unused.map(s => (
            <button key={s} type="button" className="text-[11px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground hover:text-foreground" onClick={() => { const next = [...value, s]; setText(next.join(', ')); onChange(next); }}>+ {s}</button>
          ))}
        </div>
      )}
    </div>
  );
};

const ActionEditor: React.FC<{ action: AutomationAction; members: Member[]; label: (uid: string) => string; onChange: (patch: Partial<AutomationAction>) => void }> = ({ action: a, members, label, onChange }) => {
  const userSelect = (value: string | undefined, onPick: (uid: string) => void) => (
    <Select value={value || ''} onValueChange={onPick}>
      <SelectTrigger className="h-9"><SelectValue placeholder="Zgjidh personin" /></SelectTrigger>
      <SelectContent>{members.map(m => <SelectItem key={m.userId} value={m.userId}>{label(m.userId)}</SelectItem>)}</SelectContent>
    </Select>
  );
  switch (a.type) {
    case 'assign':
      return (
        <div className="grid sm:grid-cols-2 gap-2">
          <Select value={a.mode} onValueChange={v => onChange({ mode: v as 'user' | 'round_robin' } as any)}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="round_robin">Me radhë (round-robin)</SelectItem><SelectItem value="user">Një person i caktuar</SelectItem></SelectContent>
          </Select>
          {a.mode === 'user' ? userSelect(a.userId, uid => onChange({ userId: uid } as any)) : (
            <div>
              <p className="text-[11px] text-muted-foreground mb-1">Radha (bosh = gjithë ekipi i shitjes):</p>
              <UserMultiSelect value={a.userIds || []} members={members} label={label} onChange={userIds => onChange({ userIds } as any)} />
            </div>
          )}
        </div>
      );
    case 'create_task':
      return (
        <div className="grid sm:grid-cols-2 gap-2">
          <Input className="h-9 sm:col-span-2" value={a.title} placeholder="Titulli i detyrës" onChange={e => onChange({ title: e.target.value } as any)} />
          <Textarea className="sm:col-span-2 min-h-[56px]" value={a.description || ''} placeholder="Përshkrim (opsional)" onChange={e => onChange({ description: e.target.value } as any)} />
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground whitespace-nowrap">Afati pas</span>
            <Input type="number" min={0} className="h-9 w-20" value={a.dueInDays} onChange={e => onChange({ dueInDays: Number(e.target.value) || 0 } as any)} />
            <span className="text-xs text-muted-foreground">ditësh</span>
          </div>
          <Select value={a.priority || 'medium'} onValueChange={v => onChange({ priority: v } as any)}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="low">Ulët</SelectItem><SelectItem value="medium">Mesatar</SelectItem><SelectItem value="high">I lartë</SelectItem><SelectItem value="urgent">Urgjent</SelectItem></SelectContent>
          </Select>
          <Select value={a.assignTo} onValueChange={v => onChange({ assignTo: v } as any)}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="owner">Pronarit të rekordit</SelectItem><SelectItem value="user">Një personi të caktuar</SelectItem></SelectContent>
          </Select>
          {a.assignTo === 'user' && userSelect(a.userId, uid => onChange({ userId: uid } as any))}
        </div>
      );
    case 'notify':
      return (
        <div className="grid sm:grid-cols-2 gap-2">
          <Select value={a.to} onValueChange={v => onChange({ to: v } as any)}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="owner">Pronarin (ose menaxherët nëse s’ka)</SelectItem><SelectItem value="managers">Menaxherët/adminët</SelectItem><SelectItem value="users">Persona të zgjedhur</SelectItem></SelectContent>
          </Select>
          {a.to === 'users' ? <UserMultiSelect value={a.userIds || []} members={members} label={label} onChange={userIds => onChange({ userIds } as any)} /> : <div />}
          <Input className="h-9 sm:col-span-2" value={a.title} placeholder="Titulli i njoftimit" onChange={e => onChange({ title: e.target.value } as any)} />
          <Input className="h-9 sm:col-span-2" value={a.message || ''} placeholder="Mesazhi (opsional)" onChange={e => onChange({ message: e.target.value } as any)} />
        </div>
      );
    case 'add_tags':
      return <ListInput value={a.tags || []} suggestions={[]} onChange={tags => onChange({ tags } as any)} />;
    case 'set_status':
      return (
        <Select value={a.status} onValueChange={v => onChange({ status: v } as any)}>
          <SelectTrigger className="h-9 sm:w-64"><SelectValue /></SelectTrigger>
          <SelectContent>{LEAD_STAGES.filter(s => s.key !== 'Won').map(s => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}</SelectContent>
        </Select>
      );
    case 'start_cadence':
      return <p className="text-xs text-muted-foreground">Nis sekuencën e ndjekjes me ditët e konfiguruara në Cilësimet → CRM (kadenca).</p>;
    case 'send_email':
      return (
        <div className="space-y-2">
          <Input className="h-9" value={a.subject} placeholder="Subjekti" onChange={e => onChange({ subject: e.target.value } as any)} />
          <Textarea className="min-h-[96px]" value={a.body} placeholder={'Përshëndetje {{firstName}},\n\n…'} onChange={e => onChange({ body: e.target.value } as any)} />
        </div>
      );
    case 'send_whatsapp':
      return (
        <div className="space-y-1.5">
          <Textarea className="min-h-[140px]" value={a.text} maxLength={1500} placeholder={'Përshëndetje {{firstName}},'} onChange={e => onChange({ text: e.target.value } as any)} />
          <div className="flex justify-between gap-2 text-[11px] text-muted-foreground">
            <span>Tokenë: {'{{firstName}} {{name}} {{company}} {{owner}}'} · del nga numri i lidhur i biznesit, 09:00–20:00, një herë për kontakt.</span>
            <span className="tabular-nums whitespace-nowrap">{(a.text || '').length}/1500</span>
          </div>
        </div>
      );
    default:
      return null;
  }
};

// ── Run history ───────────────────────────────────────────────────────────────

const RunHistoryDialog: React.FC<{ rule: AutomationRule; onClose: () => void }> = ({ rule, onClose }) => {
  const { data: runs, loading } = useCollection<AutomationRun>('crmAutomationRuns', {
    where: [{ field: 'ruleId', operator: '==', value: rule.id }],
    orderBy: { field: 'firedAt', direction: 'desc' },
    limit: 30,
    teamScopedWhere: true,
  });
  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><History className="h-4 w-4" /> Ndezjet: {rule.name}</DialogTitle></DialogHeader>
        {loading ? (
          <p className="text-sm text-muted-foreground">Po ngarkohet…</p>
        ) : !runs?.length ? (
          <p className="text-sm text-muted-foreground">Asnjë ndezje ende. {rule.status === 'active' ? 'Ekzekutohet çdo orë.' : 'Rregulli është i pauzuar.'}</p>
        ) : (
          <ul className="divide-y">
            {runs.map(r => (
              <li key={r.id} className="py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium truncate">{r.entityName || r.entityId}</span>
                  <span className="text-[11px] text-muted-foreground whitespace-nowrap">{relTime(r.firedAt)}</span>
                </div>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {(r.results || []).map((x, i) => (
                    <span key={i} className={`text-[10px] px-1.5 py-0.5 rounded ${x.ok ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : 'bg-destructive/10 text-destructive'}`}>
                      {ACTION_META[x.type]?.label || x.type}{x.detail ? ` · ${x.detail}` : ''}
                    </span>
                  ))}
                  {(r.results || []).length === 0 && <span className="text-[10px] text-muted-foreground">në ekzekutim…</span>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
};
