/**
 * Reporting configuration — templates, KPI definitions and schedules.
 *
 * Also the module's INSTALLER: `seedReportingDefaults()` writes the 15 system
 * templates and the ~110-KPI catalog into the tenant on first use. Seeding is
 * idempotent (keyed on `key`), so pressing the button twice is safe and a tenant
 * that has customised a template never has it overwritten.
 *
 * System templates are read-only by design: editing one in place would silently
 * change the structure that already-generated reports were built from. The UI offers
 * "Duplicate" instead, which is the enterprise-correct answer to rule 11.
 */

import React, { useMemo, useState } from 'react';
import { Timestamp, doc, writeBatch } from 'firebase/firestore';
import {
  AlertTriangle, CalendarClock, Copy, Download, FileStack, Gauge, Lock, Plus,
  RefreshCw, Sparkles, Trash2,
} from 'lucide-react';
import { db } from '../lib/firebase';
import { Card } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Switch } from '../components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs';
import { toast } from '../hooks/use-toast';
import { useCollection, useMutation, useGlobalBusinessId, getGlobalTeamId } from '../hooks/useFirestore';
import { usePermissions } from '../contexts/PermissionsContext';
import { useAuth } from '../contexts/AuthContext';
import { KPI_CATALOG, formatKpiValue } from '../lib/reporting/kpi';
import { TEMPLATE_SEEDS, duplicateTemplate, templateFromSeed } from '../lib/reporting/templates';
// writeBatch bypasses useMutation's sanitiser, so every payload below is stripped
// explicitly — Firestore rejects `undefined` outright.
import { stripUndefined } from '../lib/reporting/blocks';
import { nextRunAt } from '../lib/reporting/schedule';
import type {
  Customer, ReportFrequency, ReportKind, ReportKpi, ReportSchedule, ReportService, ReportTemplate,
} from '../types';

const SERVICE_LABELS: Record<ReportService, string> = {
  seo: 'SEO', web: 'Web', social: 'Social Media', ads: 'Reklama', marketing: 'Marketing',
  content: 'Content', design: 'Design', 'photo-video': 'Foto/Video',
  maintenance: 'Mirëmbajtje', hosting: 'Hosting', other: 'Tjetër',
};

const FREQUENCY_LABELS: Record<ReportFrequency, string> = {
  daily: 'Ditore', weekly: 'Javore', monthly: 'Mujore', quarterly: 'Tremujore', 'ad-hoc': 'Sipas nevojës',
};

const ReportingAdminView: React.FC = () => {
  const permissions = usePermissions();
  const { user } = useAuth();
  const businessId = useGlobalBusinessId();
  const canManage = permissions.canManageReportTemplates === true
    || permissions.isAdmin || permissions.isOwner || permissions.isSuperAdmin;

  const { data: templates, loading: templatesLoading } = useCollection<ReportTemplate>('reportTemplates');
  const { data: kpis } = useCollection<ReportKpi>('reportKpis');
  const { data: schedules } = useCollection<ReportSchedule>('reportSchedules');
  const { data: customers } = useCollection<Customer>('customers');

  const templatesApi = useMutation<ReportTemplate>('reportTemplates');
  const kpisApi = useMutation<ReportKpi>('reportKpis');
  const schedulesApi = useMutation<ReportSchedule>('reportSchedules');

  const [seeding, setSeeding] = useState(false);
  const [scheduleDialog, setScheduleDialog] = useState(false);

  const missingTemplates = useMemo(
    () => TEMPLATE_SEEDS.filter(s => !(templates || []).some(t => t.key === s.key)),
    [templates],
  );
  const missingKpis = useMemo(
    () => KPI_CATALOG.filter(s => !(kpis || []).some(k => k.key === s.key)),
    [kpis],
  );

  /**
   * Write the defaults, in batches, skipping anything already present.
   *
   * Firestore caps a batch at 500 writes and the KPI catalog alone is ~110, so the
   * work is chunked. `key` is the idempotency handle — re-running only fills gaps.
   */
  const seedReportingDefaults = async () => {
    if (!businessId) {
      toast({ title: 'Nuk u zgjodh biznesi aktiv', variant: 'destructive' });
      return;
    }
    setSeeding(true);
    try {
      const teamId = getGlobalTeamId() || undefined;
      const now = Timestamp.now();

      // KPIs first: templates reference catalog keys, and the resolver maps
      // key → document id, so the KPI documents must exist to be resolvable.
      const kpiIdByKey = new Map<string, string>();
      for (const k of kpis || []) kpiIdByKey.set(k.key, k.id);

      const chunks = <T,>(arr: T[], size: number): T[][] => {
        const out: T[][] = [];
        for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
        return out;
      };

      for (const chunk of chunks(missingKpis, 200)) {
        const batch = writeBatch(db);
        for (const seed of chunk) {
          const ref = doc(db, 'reportKpis', `${businessId}_${seed.key}`);
          batch.set(ref, stripUndefined({
            businessId,
            ...(teamId ? { teamId } : {}),
            key: seed.key,
            name: seed.name,
            description: seed.description || null,
            service: seed.service,
            category: seed.category,
            unit: seed.unit,
            decimals: seed.decimals ?? null,
            higherIsBetter: seed.higherIsBetter,
            clientVisible: seed.clientVisible,
            financial: seed.financial || false,
            comparison: 'previous',
            source: 'manual',
            active: true,
            targets: [],
            createdAt: now,
            updatedAt: now,
            createdByUserId: user?.uid || null,
          }));
          kpiIdByKey.set(seed.key, ref.id);
        }
        await batch.commit();
      }

      for (const chunk of chunks(missingTemplates, 20)) {
        const batch = writeBatch(db);
        for (const seed of chunk) {
          const body = templateFromSeed(seed, key => kpiIdByKey.get(key));
          const ref = doc(db, 'reportTemplates', `${businessId}_${seed.key}`);
          batch.set(ref, stripUndefined({
            ...body,
            businessId,
            ...(teamId ? { teamId } : {}),
            createdAt: now,
            updatedAt: now,
            createdByUserId: user?.uid || null,
          }));
        }
        await batch.commit();
      }

      toast({
        title: 'Konfigurimi bazë u instalua',
        description: `${missingTemplates.length} template, ${missingKpis.length} KPI.`,
      });
    } catch (err: any) {
      toast({ title: 'Instalimi dështoi', description: err?.message, variant: 'destructive' });
    } finally {
      setSeeding(false);
    }
  };

  const needsSeeding = missingTemplates.length > 0 || missingKpis.length > 0;

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-6xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Konfigurimi i raportimit</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Template-t, KPI-të dhe planifikimet automatike që fuqizojnë modulin.
        </p>
      </div>

      {!canManage && (
        <Card className="p-4 border-warning/40 bg-warning/5">
          <p className="text-sm text-warning flex items-start gap-2">
            <Lock className="w-4 h-4 shrink-0 mt-0.5" />
            Kini akses vetëm për lexim. Kërkoni të drejtën "Menaxho template & KPI".
          </p>
        </Card>
      )}

      {needsSeeding && canManage && (
        <Card className="p-4 border-primary/40 bg-primary/5 space-y-3">
          <div className="flex items-start gap-2.5">
            <Sparkles className="w-5 h-5 text-primary shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">Instaloni konfigurimin bazë</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {missingTemplates.length} template dhe {missingKpis.length} KPI standarde për SEO, web,
                social, reklama dhe marketing. Instalimi është idempotent — nuk mbishkruan asgjë ekzistuese.
              </p>
            </div>
          </div>
          <Button onClick={seedReportingDefaults} disabled={seeding} className="gap-1.5">
            {seeding ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            {seeding ? 'Duke instaluar…' : 'Instalo konfigurimin bazë'}
          </Button>
        </Card>
      )}

      <Tabs defaultValue="templates">
        <TabsList>
          <TabsTrigger value="templates" className="gap-1.5">
            <FileStack className="w-3.5 h-3.5" /> Template ({(templates || []).length})
          </TabsTrigger>
          <TabsTrigger value="kpis" className="gap-1.5">
            <Gauge className="w-3.5 h-3.5" /> KPI ({(kpis || []).length})
          </TabsTrigger>
          <TabsTrigger value="schedules" className="gap-1.5">
            <CalendarClock className="w-3.5 h-3.5" /> Planifikime ({(schedules || []).length})
          </TabsTrigger>
        </TabsList>

        {/* ── Templates ── */}
        <TabsContent value="templates" className="mt-4 space-y-2">
          {templatesLoading && <Card className="h-20 animate-pulse bg-muted/40" />}
          {(templates || []).length === 0 && !templatesLoading && (
            <Card className="p-8 text-center text-sm text-muted-foreground">
              Pa template. Instaloni konfigurimin bazë më lart.
            </Card>
          )}
          {[...(templates || [])]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(t => (
              <Card key={t.id} className={`p-4 ${t.archivedAt ? 'opacity-60' : ''}`}>
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium text-foreground">{t.name}</p>
                      <Badge variant="outline" className="text-[10px]">{FREQUENCY_LABELS[t.frequency]}</Badge>
                      {t.service && <Badge variant="outline" className="text-[10px]">{SERVICE_LABELS[t.service]}</Badge>}
                      <Badge variant="outline" className="text-[10px]">v{t.version}</Badge>
                      {t.isSystem && (
                        <Badge variant="outline" className="text-[10px] gap-1">
                          <Lock className="w-2.5 h-2.5" /> sistem
                        </Badge>
                      )}
                      {t.isDefault && (
                        <Badge variant="outline" className="text-[10px] bg-primary/10 text-primary border-primary/30">
                          parazgjedhur
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {t.description} · {t.blocks.length} blloke
                      {t.usageCount ? ` · përdorur ${t.usageCount}×` : ''}
                    </p>
                  </div>
                  {canManage && (
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Button
                        variant="outline" size="sm" className="gap-1.5"
                        onClick={async () => {
                          try {
                            await templatesApi.create(duplicateTemplate(t, `${t.name} (kopje)`) as any);
                            toast({ title: 'Template u kopjua' });
                          } catch (err: any) {
                            toast({ title: 'Nuk u kopjua', description: err?.message, variant: 'destructive' });
                          }
                        }}
                      >
                        <Copy className="w-3.5 h-3.5" /> Kopjo
                      </Button>
                      {!t.isSystem && (
                        <Button
                          variant="ghost" size="sm"
                          onClick={async () => {
                            await templatesApi.update(t.id, {
                              archivedAt: t.archivedAt ? null : (Timestamp.now() as any),
                            } as any);
                          }}
                        >
                          {t.archivedAt ? 'Riaktivizo' : 'Arkivo'}
                        </Button>
                      )}
                      <Button
                        variant="ghost" size="sm"
                        onClick={async () => {
                          await templatesApi.update(t.id, { isDefault: !t.isDefault } as any);
                        }}
                      >
                        {t.isDefault ? 'Hiq parazgjedhjen' : 'Bëj parazgjedhur'}
                      </Button>
                    </div>
                  )}
                </div>
                {t.isSystem && (
                  <p className="text-[11px] text-muted-foreground mt-2 flex items-start gap-1.5">
                    <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
                    Template-t e sistemit nuk redaktohen: raportet e prodhuara nga ky template do
                    ndryshonin strukturë retroaktivisht. Kopjoni dhe redaktoni kopjen.
                  </p>
                )}
              </Card>
            ))}
        </TabsContent>

        {/* ── KPIs ── */}
        <TabsContent value="kpis" className="mt-4">
          <KpiManager
            kpis={kpis || []}
            canManage={canManage}
            customers={customers || []}
            onUpdate={(id, patch) => kpisApi.update(id, patch as any)}
          />
        </TabsContent>

        {/* ── Schedules ── */}
        <TabsContent value="schedules" className="mt-4 space-y-2">
          {canManage && (
            <Button size="sm" variant="outline" className="gap-1.5 mb-2" onClick={() => setScheduleDialog(true)}>
              <Plus className="w-4 h-4" /> Planifikim i re
            </Button>
          )}
          {(schedules || []).length === 0 && (
            <Card className="p-8 text-center text-sm text-muted-foreground">
              Pa planifikime. Krijoni një për t'i lënë sistemit prodhimin automatik të draft-eve.
            </Card>
          )}
          {(schedules || []).map(s => {
            const next = nextRunAt(s, new Date());
            return (
              <Card key={s.id} className="p-4">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium text-foreground">{s.name}</p>
                      <Badge variant="outline" className="text-[10px]">{FREQUENCY_LABELS[s.frequency]}</Badge>
                      {!s.active && <Badge variant="outline" className="text-[10px]">jo aktiv</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Ora {String(s.hour).padStart(2, '0')}:00 ({s.timezone || 'Europe/Tirane'})
                      {s.customerName ? ` · ${s.customerName}` : ''}
                      {s.lastRunPeriodKey ? ` · e fundit: ${s.lastRunPeriodKey}` : ''}
                      {next ? ` · tjetra: ${next.toLocaleDateString('sq-AL')}` : ''}
                    </p>
                  </div>
                  {canManage && (
                    <div className="flex items-center gap-2 shrink-0">
                      <Switch
                        checked={s.active}
                        onCheckedChange={v => schedulesApi.update(s.id, { active: v } as any)}
                      />
                      <Button
                        variant="ghost" size="icon" className="text-error"
                        aria-label="Fshi planifikimin"
                        onClick={async () => {
                          if (!window.confirm('Fshi planifikimin?')) return;
                          await schedulesApi.remove(s.id);
                        }}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  )}
                </div>
              </Card>
            );
          })}
          <Card className="p-3 bg-muted/30">
            <p className="text-[11px] text-muted-foreground">
              Prodhimi automatik kryhet nga cron-i <code>?job=report-schedules</code>; kujtesat dhe
              eskalimet nga <code>?job=report-reminders</code>. Të dyja janë idempotente.
            </p>
          </Card>
        </TabsContent>
      </Tabs>

      <ScheduleDialog
        open={scheduleDialog}
        onClose={() => setScheduleDialog(false)}
        templates={templates || []}
        customers={customers || []}
        onCreate={async body => {
          try {
            await schedulesApi.create(body as any);
            toast({ title: 'Planifikimi u krijua' });
            setScheduleDialog(false);
          } catch (err: any) {
            toast({ title: 'Nuk u krijua', description: err?.message, variant: 'destructive' });
          }
        }}
      />
    </div>
  );
};

// ── KPI manager ─────────────────────────────────────────────────────────────────

const KpiManager: React.FC<{
  kpis: ReportKpi[];
  canManage: boolean;
  customers: Customer[];
  onUpdate: (id: string, patch: Partial<ReportKpi>) => Promise<void>;
}> = ({ kpis, canManage, customers, onUpdate }) => {
  const [service, setService] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [targetFor, setTargetFor] = useState<ReportKpi | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return kpis
      .filter(k => (service === 'all' || k.service === service))
      .filter(k => !q || k.name.toLowerCase().includes(q) || k.key.includes(q))
      .sort((a, b) => (a.category || '').localeCompare(b.category || '') || a.name.localeCompare(b.name));
  }, [kpis, service, search]);

  return (
    <div className="space-y-3">
      <div className="flex gap-2 flex-wrap">
        <Input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Kërko KPI…"
          className="max-w-xs text-base sm:text-sm"
        />
        <Select value={service} onValueChange={setService}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Të gjitha shërbimet</SelectItem>
            {(Object.keys(SERVICE_LABELS) as ReportService[]).map(s => (
              <SelectItem key={s} value={s}>{SERVICE_LABELS[s]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {filtered.length === 0 && (
        <Card className="p-8 text-center text-sm text-muted-foreground">Pa KPI që përputhen.</Card>
      )}

      <div className="space-y-1.5">
        {filtered.map(k => (
          <Card key={k.id} className={`p-3 ${k.active ? '' : 'opacity-60'}`}>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-medium text-foreground">{k.name}</p>
                  <Badge variant="outline" className="text-[10px]">{k.unit}</Badge>
                  {!k.higherIsBetter && (
                    <Badge variant="outline" className="text-[10px]">më e ulët = më mirë</Badge>
                  )}
                  {!k.clientVisible && (
                    <Badge variant="outline" className="text-[10px] gap-1 bg-muted">
                      <Lock className="w-2.5 h-2.5" /> brenda
                    </Badge>
                  )}
                  {k.financial && (
                    <Badge variant="outline" className="text-[10px] bg-warning/10 text-warning border-warning/30">
                      financiare
                    </Badge>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {k.category} · {k.key}
                  {k.targets?.length ? ` · ${k.targets.length} objektiv(a)` : ''}
                </p>
              </div>
              {canManage && (
                <div className="flex items-center gap-2 shrink-0">
                  <Button variant="ghost" size="sm" onClick={() => setTargetFor(k)}>Objektivat</Button>
                  <Switch checked={k.active} onCheckedChange={v => onUpdate(k.id, { active: v })} />
                </div>
              )}
            </div>
          </Card>
        ))}
      </div>

      <TargetDialog
        kpi={targetFor}
        customers={customers}
        onClose={() => setTargetFor(null)}
        onSave={async targets => {
          if (!targetFor) return;
          await onUpdate(targetFor.id, { targets });
          setTargetFor(null);
        }}
      />
    </div>
  );
};

const TargetDialog: React.FC<{
  kpi: ReportKpi | null;
  customers: Customer[];
  onClose: () => void;
  onSave: (targets: ReportKpi['targets']) => Promise<void>;
}> = ({ kpi, customers, onClose, onSave }) => {
  const [rows, setRows] = useState<NonNullable<ReportKpi['targets']>>([]);

  React.useEffect(() => { setRows(kpi?.targets ? [...kpi.targets] : []); }, [kpi]);

  if (!kpi) return null;

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Objektivat — {kpi.name}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Objektivi më i specifik fiton: projekt &gt; klient &gt; shërbim &gt; global.
          </p>
          {rows.map((t, i) => (
            <div key={i} className="grid grid-cols-[1fr_auto_auto] gap-2 items-end">
              <div className="space-y-1">
                <Label className="text-[11px]">Klienti (opsional)</Label>
                <Select
                  value={t.customerId || 'global'}
                  onValueChange={v => setRows(rows.map((r, idx) => (idx === i
                    ? { ...r, customerId: v === 'global' ? undefined : v } : r)))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="global">Global</SelectItem>
                    {customers.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1 w-28">
                <Label className="text-[11px]">Vlera</Label>
                <Input
                  type="number"
                  value={t.value}
                  onChange={e => setRows(rows.map((r, idx) => (idx === i
                    ? { ...r, value: Number(e.target.value) } : r)))}
                />
              </div>
              <Button variant="ghost" size="icon" onClick={() => setRows(rows.filter((_, idx) => idx !== i))}
                aria-label="Hiq objektivin">
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          ))}
          <Button variant="outline" size="sm" className="gap-1.5"
            onClick={() => setRows([...rows, { value: 0 }])}>
            <Plus className="w-3.5 h-3.5" /> Shto objektiv
          </Button>
          <p className="text-[11px] text-muted-foreground">
            Formati: {formatKpiValue(100, kpi.unit, { decimals: kpi.decimals, currency: kpi.currency })}
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>Anulo</Button>
            <Button onClick={() => void onSave(rows)}>Ruaj</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

const ScheduleDialog: React.FC<{
  open: boolean;
  onClose: () => void;
  templates: ReportTemplate[];
  customers: Customer[];
  onCreate: (body: Partial<ReportSchedule>) => Promise<void>;
}> = ({ open, onClose, templates, customers, onCreate }) => {
  const [name, setName] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [hour, setHour] = useState(9);
  const [dayOfWeek, setDayOfWeek] = useState(1);
  const [dayOfMonth, setDayOfMonth] = useState(0);

  const template = templates.find(t => t.id === templateId);
  const customer = customers.find(c => c.id === customerId);

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Planifikim i re</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Emri</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Raport mujor SEO — Klienti X" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Template</Label>
            <Select value={templateId} onValueChange={setTemplateId}>
              <SelectTrigger><SelectValue placeholder="Zgjidh…" /></SelectTrigger>
              <SelectContent>
                {templates.filter(t => !t.archivedAt).map(t => (
                  <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Klienti (opsional)</Label>
            <Select value={customerId} onValueChange={setCustomerId}>
              <SelectTrigger><SelectValue placeholder="Pa klient" /></SelectTrigger>
              <SelectContent>
                {customers.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Ora</Label>
              <Input type="number" min={0} max={23} value={hour} onChange={e => setHour(Number(e.target.value))} />
            </div>
            {template?.frequency === 'weekly' && (
              <div className="space-y-1.5 col-span-2">
                <Label className="text-xs">Dita e javës</Label>
                <Select value={String(dayOfWeek)} onValueChange={v => setDayOfWeek(Number(v))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['Hënë', 'Martë', 'Mërkurë', 'Enjte', 'Premte', 'Shtunë', 'Diel'].map((d, i) => (
                      <SelectItem key={d} value={String(i + 1)}>{d}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {(template?.frequency === 'monthly' || template?.frequency === 'quarterly') && (
              <div className="space-y-1.5 col-span-2">
                <Label className="text-xs">Dita e muajit (0 = dita e parë e punës)</Label>
                <Input type="number" min={0} max={28} value={dayOfMonth}
                  onChange={e => setDayOfMonth(Number(e.target.value))} />
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>Anulo</Button>
            <Button
              disabled={!template || !name.trim()}
              onClick={() => template && void onCreate({
                name: name.trim(),
                active: true,
                kind: template.kind as ReportKind,
                frequency: template.frequency,
                templateId: template.id,
                templateKey: template.key,
                service: template.service,
                customerId: customerId || undefined,
                customerName: customer?.name,
                hour,
                timezone: 'Europe/Tirane',
                dayOfWeek: template.frequency === 'weekly' ? dayOfWeek : undefined,
                dayOfMonth: (template.frequency === 'monthly' || template.frequency === 'quarterly')
                  ? dayOfMonth : undefined,
                prefillFromCrm: true,
                notifyAuthor: true,
                reminderOffsetsDays: [3, 1],
              })}
            >
              Krijo
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ReportingAdminView;
