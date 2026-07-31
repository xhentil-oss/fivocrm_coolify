import React, { useMemo, useState } from 'react';
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors, useDraggable, useDroppable,
  type DragStartEvent, type DragEndEvent,
} from '@dnd-kit/core';
import { useCollection, useMutation, useGlobalBusinessId } from '../hooks/useFirestore';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../contexts/PermissionsContext';
import { useUserNames } from '../hooks/useUserNames';
import { useUniqueTeamMembers } from '../hooks/useRoleFilteredData';
import { useToast } from '../hooks/use-toast';
import { getTimestampMs } from '../lib/utils';
import { DEAL_STAGES, OPEN_STAGES, dealProbability, dealAmountAll, dealWeightedAll, curSymbol } from '../lib/dealStages';
import { Card } from '../components/ui/card';
import { SkeletonLoader } from '../components/PageSkeleton';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Badge } from '../components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { DollarSign, TrendingUp, Trophy, Plus, GripVertical, Percent, CalendarDays, Trash2 } from 'lucide-react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { Deal, DealStage, Customer, TeamMember, Lead } from '../types';

const fmt = (n: number) => Math.round(n).toLocaleString('sq-AL');

function DealCard({ deal, getName, onClick }: { deal: Deal; getName: (id?: string) => string; onClick: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: deal.id });
  const cur = curSymbol(deal.currency);
  const close = deal.expectedCloseDate ? new Date(getTimestampMs(deal.expectedCloseDate)) : null;
  // Overdue only once the close date has fully passed — compare against end-of-day
  // so a deal closing *today* isn't flagged (avoids UTC-midnight vs local-time skew).
  const closeEod = close ? new Date(close.getFullYear(), close.getMonth(), close.getDate(), 23, 59, 59, 999) : null;
  const overdue = closeEod && OPEN_STAGES.includes(deal.stage) && closeEod.getTime() < Date.now();
  return (
    <div ref={setNodeRef} className={`bg-card border border-border rounded-md p-3 shadow-sm hover:shadow-md transition-shadow ${isDragging ? 'opacity-30' : ''}`}>
      <div className="flex items-start gap-1.5">
        <button type="button" className="text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing touch-none shrink-0 mt-0.5" aria-label="Tërhiq" {...listeners} {...attributes}>
          <GripVertical className="w-4 h-4" />
        </button>
        <button type="button" onClick={onClick} className="flex-1 min-w-0 text-left">
          <p className="font-medium text-foreground text-sm truncate">{deal.title}</p>
          {deal.customerName && <p className="text-xs text-muted-foreground truncate">{deal.customerName}</p>}
          <div className="flex flex-wrap items-center gap-1.5 mt-2">
            <span className="text-xs font-semibold tabular-nums text-foreground">{fmt(deal.amount || 0)} {cur}</span>
            <Badge variant="outline" className="h-5 px-1.5 text-[10px] gap-0.5"><Percent className="w-2.5 h-2.5" /><span className="tabular-nums">{dealProbability(deal)}%</span></Badge>
            {close && <Badge variant="outline" className={`h-5 px-1.5 text-[10px] gap-0.5 ${overdue ? 'text-red-600 border-red-300' : ''}`}><CalendarDays className="w-2.5 h-2.5" />{close.toLocaleDateString('sq-AL', { day: 'numeric', month: 'short' })}</Badge>}
          </div>
          {deal.ownerId && <p className="text-[11px] text-muted-foreground mt-1">→ {getName(deal.ownerId)}</p>}
        </button>
      </div>
    </div>
  );
}

function StageColumn({ stage, children }: { stage: DealStage; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  return <div ref={setNodeRef} className={`flex flex-col min-w-[80vw] sm:min-w-[280px] flex-shrink-0 rounded-lg p-1 transition-colors ${isOver ? 'bg-primary/5 ring-1 ring-primary/30' : ''}`}>{children}</div>;
}

const emptyForm = (): Partial<Deal> => ({ title: '', amount: 0, currency: 'EUR', stage: 'Qualification', customerId: '', notes: '' });

const DealsView: React.FC = () => {
  const { user } = useAuth();
  const permissions = usePermissions();
  const { toast } = useToast();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const { data: deals, loading } = useCollection<Deal>('deals', { orderBy: { field: 'createdAt', direction: 'desc' } });
  const { data: customers } = useCollection<Customer>('customers', { skipTeamFilter: true });
  const { data: rawMembers } = useCollection<TeamMember>('teamMembers', { where: [{ field: 'status', operator: '==', value: 'Active' }] });
  const teamMembers = useUniqueTeamMembers(rawMembers);
  // Defence in depth: reads are already business-scoped, but the owner/assignee picker
  // re-checks businessId anyway.
  const activeBusinessId = useGlobalBusinessId();
  const scopedMembers = useMemo(
    () => (teamMembers || []).filter((m: any) => !activeBusinessId || !m.businessId || m.businessId === activeBusinessId),
    [teamMembers, activeBusinessId]
  );
  const { getName } = useUserNames(teamMembers || []);
  const dealMutation = useMutation<Deal>('deals');
  const leadMutation = useMutation<Lead>('leads');

  // Keep the origin lead in sync when a deal is won/lost (single source of truth).
  const syncLeadStage = async (leadId?: string, stage?: DealStage) => {
    if (!leadId || (stage !== 'Won' && stage !== 'Lost')) return;
    try {
      const snap = await getDoc(doc(db, 'leads', leadId));
      if (!snap.exists()) return;
      const cur = (snap.data() as any).status;
      if (cur === 'Converted' || cur === stage) return; // don't downgrade / no-op
      await leadMutation.update(leadId, { status: stage } as any);
    } catch { /* best-effort */ }
  };

  const [activeId, setActiveId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<Partial<Deal>>(emptyForm());
  const [editId, setEditId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const byStage = useMemo(() => {
    const map: Record<string, Deal[]> = {};
    DEAL_STAGES.forEach(s => { map[s.key] = []; });
    (deals || []).forEach(d => { (map[d.stage] || (map[d.stage] = [])).push(d); });
    return map;
  }, [deals]);

  const kpis = useMemo(() => {
    const all = deals || [];
    const open = all.filter(d => OPEN_STAGES.includes(d.stage));
    const won = all.filter(d => d.stage === 'Won');
    const lost = all.filter(d => d.stage === 'Lost');
    const pipeline = open.reduce((s, d) => s + dealAmountAll(d), 0);
    const weighted = open.reduce((s, d) => s + dealWeightedAll(d), 0);
    const wonTotal = won.reduce((s, d) => s + dealAmountAll(d), 0);
    const winRate = (won.length + lost.length) ? (won.length / (won.length + lost.length)) * 100 : 0;
    return { openCount: open.length, pipeline, weighted, wonTotal, wonCount: won.length, winRate };
  }, [deals]);

  const openCreate = () => { setForm(emptyForm()); setEditId(null); setDialogOpen(true); };
  const openEdit = (d: Deal) => {
    setForm({
      title: d.title, amount: d.amount, currency: d.currency || 'EUR', stage: d.stage,
      customerId: d.customerId || '', ownerId: d.ownerId, notes: d.notes,
      expectedCloseDate: d.expectedCloseDate, probability: d.probability,
    });
    setEditId(d.id); setDialogOpen(true);
  };

  const handleDragEnd = async (e: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = e;
    if (!over) return;
    const deal = (deals || []).find(d => d.id === String(active.id));
    const newStage = String(over.id) as DealStage;
    if (!deal || deal.stage === newStage || !DEAL_STAGES.some(s => s.key === newStage)) return;
    const patch: any = { stage: newStage, lastActivityAt: new Date() };
    if (newStage === 'Won') patch.wonAt = new Date();
    if (newStage === 'Lost') patch.lostAt = new Date();
    try {
      await dealMutation.update(deal.id, patch);
      syncLeadStage(deal.leadId, newStage);
    }
    catch { toast({ title: 'Gabim', description: 'Faza nuk u ndryshua', variant: 'destructive' }); }
  };

  const save = async () => {
    if (!form.title?.trim()) { toast({ title: 'Mungon titulli', variant: 'destructive' }); return; }
    // Mandatory owner: a deal without a responsible rep stalls the pipeline.
    if (!form.ownerId) { toast({ title: 'Cakto një përgjegjës', description: 'Marrëveshja duhet të ketë një owner.', variant: 'destructive' }); return; }
    setSaving(true);
    try {
      const customer = customers?.find(c => c.id === form.customerId);
      const payload: any = {
        title: form.title.trim(),
        amount: Number(form.amount) || 0,
        currency: form.currency || 'EUR',
        stage: form.stage || 'Qualification',
        customerId: form.customerId || undefined,
        customerName: customer?.name || form.customerName || undefined,
        ownerId: form.ownerId || undefined,
        notes: form.notes?.trim() || undefined,
        probability: form.probability,
        expectedCloseDate: form.expectedCloseDate ? new Date(getTimestampMs(form.expectedCloseDate)) : undefined,
        lastActivityAt: new Date(),
      };
      if (editId) {
        await dealMutation.update(editId, payload);
        const leadId = (deals || []).find(d => d.id === editId)?.leadId;
        syncLeadStage(leadId, payload.stage);
      } else {
        await dealMutation.create(payload);
      }
      toast({ title: editId ? 'Marrëveshja u përditësua' : 'Marrëveshje u krijua' });
      setDialogOpen(false);
    } catch {
      toast({ title: 'Gabim', description: 'Ruajtja dështoi', variant: 'destructive' });
    } finally { setSaving(false); }
  };

  const remove = async () => {
    if (!editId) return;
    await dealMutation.remove(editId).catch(() => {});
    toast({ title: 'Marrëveshja u fshi' });
    setDialogOpen(false);
  };

  const activeDeal = activeId ? (deals || []).find(d => d.id === activeId) : null;

  return (
    <div className="w-full min-w-0 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Marrëveshjet</h1>
          <p className="text-sm text-muted-foreground">{(deals || []).length} marrëveshje · pipeline {fmt(kpis.pipeline)} L</p>
        </div>
        {permissions.canEdit && (
          <Button onClick={openCreate}><Plus className="w-4 h-4 mr-2" />Marrëveshje e Re</Button>
        )}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="p-4"><div className="flex items-center gap-2 text-muted-foreground mb-1"><DollarSign className="w-4 h-4" /><span className="text-xs">Pipeline (hapur)</span></div><p className="text-2xl font-bold tabular-nums">{fmt(kpis.pipeline)} L</p><p className="text-[11px] text-muted-foreground">{kpis.openCount} marrëveshje</p></Card>
        <Card className="p-4"><div className="flex items-center gap-2 text-muted-foreground mb-1"><TrendingUp className="w-4 h-4" /><span className="text-xs">Forecast i ponderuar</span></div><p className="text-2xl font-bold tabular-nums">{fmt(kpis.weighted)} L</p></Card>
        <Card className="p-4"><div className="flex items-center gap-2 text-muted-foreground mb-1"><Trophy className="w-4 h-4" /><span className="text-xs">Fituar</span></div><p className="text-2xl font-bold tabular-nums text-emerald-600">{fmt(kpis.wonTotal)} L</p><p className="text-[11px] text-muted-foreground">{kpis.wonCount} marrëveshje</p></Card>
        <Card className="p-4"><div className="flex items-center gap-2 text-muted-foreground mb-1"><Percent className="w-4 h-4" /><span className="text-xs">Win rate</span></div><p className="text-2xl font-bold tabular-nums">{kpis.winRate.toFixed(0)}%</p></Card>
      </div>

      {/* Pipeline board */}
      {loading ? (
        <SkeletonLoader variant="kanban" />
      ) : (
        <DndContext sensors={sensors} onDragStart={(e: DragStartEvent) => setActiveId(String(e.active.id))} onDragEnd={handleDragEnd}>
          <div className="flex gap-3 overflow-x-auto pb-4">
            {DEAL_STAGES.map(s => {
              const items = byStage[s.key] || [];
              const total = items.reduce((sum, d) => sum + dealAmountAll(d), 0);
              return (
                <StageColumn key={s.key} stage={s.key}>
                  <div className="flex items-center gap-2 mb-2 px-1">
                    <span className={`w-2 h-2 rounded-full ${s.color}`} />
                    <h3 className="text-sm font-medium">{s.label}</h3>
                    <span className="text-xs text-muted-foreground ml-auto tabular-nums">{items.length} · {fmt(total)} L</span>
                  </div>
                  <div className="space-y-2 min-h-[60px]">
                    {items.map(d => <DealCard key={d.id} deal={d} getName={getName} onClick={() => openEdit(d)} />)}
                  </div>
                </StageColumn>
              );
            })}
          </div>
          <DragOverlay>
            {activeDeal ? (
              <Card className="p-3 shadow-xl rotate-1 opacity-90"><p className="text-sm font-medium">{activeDeal.title}</p></Card>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      {/* Create / edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editId ? 'Edito Marrëveshjen' : 'Marrëveshje e Re'}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Titulli</Label>
              <Input value={form.title || ''} onChange={(e) => setForm(f => ({ ...f, title: e.target.value }))} placeholder="p.sh. Website + SEO — Kompania X" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label>Vlera</Label>
                <Input type="number" value={form.amount ?? 0} onChange={(e) => setForm(f => ({ ...f, amount: Number(e.target.value) }))} />
              </div>
              <div>
                <Label>Monedha</Label>
                <Select value={form.currency || 'EUR'} onValueChange={(v) => setForm(f => ({ ...f, currency: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="EUR">EUR (€)</SelectItem><SelectItem value="ALL">ALL (L)</SelectItem><SelectItem value="USD">USD ($)</SelectItem></SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label>Faza</Label>
                <Select value={form.stage || 'Qualification'} onValueChange={(v) => setForm(f => ({ ...f, stage: v as DealStage }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{DEAL_STAGES.map(s => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Data e mbylljes</Label>
                <Input type="date"
                  value={form.expectedCloseDate ? new Date(getTimestampMs(form.expectedCloseDate)).toISOString().slice(0, 10) : ''}
                  onChange={(e) => setForm(f => ({ ...f, expectedCloseDate: e.target.value ? new Date(e.target.value) : undefined }))} />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label>Klienti</Label>
                <Select value={form.customerId || '__none__'} onValueChange={(v) => setForm(f => ({ ...f, customerId: v === '__none__' ? '' : v }))}>
                  <SelectTrigger><SelectValue placeholder="Zgjidh" /></SelectTrigger>
                  <SelectContent className="max-h-72">
                    <SelectItem value="__none__">— Asnjë —</SelectItem>
                    {(customers || []).map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Përgjegjësi</Label>
                <Select value={form.ownerId || '__none__'} onValueChange={(v) => setForm(f => ({ ...f, ownerId: v === '__none__' ? undefined : v }))}>
                  <SelectTrigger><SelectValue placeholder="Zgjidh" /></SelectTrigger>
                  <SelectContent className="max-h-72">
                    <SelectItem value="__none__">— Asnjë —</SelectItem>
                    {scopedMembers.map(m => <SelectItem key={m.userId} value={m.userId}>{getName(m.userId)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Shënime</Label>
              <Textarea rows={3} value={form.notes || ''} onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
            <div className="flex justify-between gap-2 pt-2">
              {editId ? (
                <Button variant="outline" className="text-destructive border-destructive/30" onClick={remove} disabled={saving}>
                  <Trash2 className="w-4 h-4 mr-1" />Fshi
                </Button>
              ) : <span />}
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>Anulo</Button>
                <Button onClick={save} disabled={saving}>{saving ? 'Duke ruajtur…' : 'Ruaj'}</Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default DealsView;
