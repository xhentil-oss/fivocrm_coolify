/**
 * Hosting & Domain-e — staff console for the hosting module.
 *
 * Tabs: Shërbimet (subscriptions) · Domain-et · Porositë · Paketat · TLD-të ·
 * Serverët · Cilësimet · Aktiviteti. Catalog/config rows are written straight to
 * Firestore (rules: staff of the tenant); anything that touches a provider or money
 * (tokens, provisioning, suspend, SSO, orders) goes through `hostingApi()` →
 * POST /api/hosting. Decisions ("why is this not invoiced yet?") are explained with
 * the SAME engine the cron runs (`src/lib/hosting/engine.ts`).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Server, Globe, ShoppingCart, Package, Tag, Settings, Activity, Plus, RefreshCw, ExternalLink, KeyRound,
  Pause, Play, Trash2, AlertTriangle, CheckCircle2, Clock, Search, Shield, Loader2, Eye, EyeOff, Wand2, ArrowRightLeft, Ticket, HardDrive,
} from 'lucide-react';
import { Card } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Switch } from '../components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { SkeletonLoader } from '../components/PageSkeleton';
import { useCollection, useMutation, useGlobalTeamId } from '../hooks/useFirestore';
import { usePermissions } from '../contexts/PermissionsContext';
import { useToast } from '../hooks/use-toast';
import { formatCurrency, getTimestampMs } from '../lib/utils';
import { openExternal } from '../lib/native';
import { saveTeamSettings, useTeamSettingsData } from '../hooks/useTeamSettings';
import { hostingApi, checkDomains, type DomainCheckRow } from '../lib/hosting/api';
import {
  BILLING_CYCLES, CYCLE_LABELS, DEFAULT_LIFECYCLE, DOMAIN_BLOCK_LABELS, SUBSCRIPTION_BLOCK_LABELS, ORDER_ERROR_LABELS,
  availableCycles, daysBetween, decideDomain, decideSubscription, normalizeLifecycleConfig,
  parseDomain, priceOrder, suggestSellPrice, type BillingCycle, type OrderLineInput, type TldPricing,
} from '../lib/hosting/engine';
import { hostingMonthlyRecurringRevenue } from '../lib/hosting/finance';
import type {
  Customer, Domain, DomainTld, HostingEvent, HostingOrder, HostingProduct, HostingServer, Subscription, HostingCoupon, HostingBackup,
} from '../types';

// ── helpers ────────────────────────────────────────────────────────────────────

const toDate = (v: unknown): Date | null => {
  if (!v) return null;
  const ms = getTimestampMs(v);
  return ms ? new Date(ms) : null;
};
const fmtDate = (v: unknown) => { const d = toDate(v); return d ? d.toLocaleDateString('sq-AL') : '—'; };
const cur = (c: unknown): 'ALL' | 'EUR' => (c === 'EUR' ? 'EUR' : 'ALL');

const SUB_STATUS: Record<string, { label: string; cls: string }> = {
  Pending: { label: 'Në pritje', cls: 'bg-amber-100 text-amber-800' },
  Active: { label: 'Aktiv', cls: 'bg-emerald-100 text-emerald-800' },
  Suspended: { label: 'Pezulluar', cls: 'bg-orange-100 text-orange-800' },
  Terminated: { label: 'Terminuar', cls: 'bg-red-100 text-red-800' },
  Cancelled: { label: 'Anuluar', cls: 'bg-muted text-muted-foreground' },
  Grace: { label: 'Tolerancë', cls: 'bg-orange-100 text-orange-800' },
  Expired: { label: 'Skaduar', cls: 'bg-red-100 text-red-800' },
  'Transferred Away': { label: 'Transferuar', cls: 'bg-muted text-muted-foreground' },
  Paid: { label: 'Paguar', cls: 'bg-blue-100 text-blue-800' },
  Provisioning: { label: 'Aktivizohet…', cls: 'bg-blue-100 text-blue-800' },
  Failed: { label: 'Dështoi', cls: 'bg-red-100 text-red-800' },
};
const StatusBadge: React.FC<{ status?: string }> = ({ status }) => {
  const s = SUB_STATUS[status || ''] || { label: status || '—', cls: 'bg-muted text-muted-foreground' };
  return <Badge className={`${s.cls} border-0`}>{s.label}</Badge>;
};

/** Catalog delete (package / TLD / coupon): ask first, and surface a failed write instead of closing silently. */
const removeWithConfirm = async (message: string, remove: () => Promise<unknown>, toast: ReturnType<typeof useToast>['toast'], done: () => void) => {
  if (!window.confirm(message)) return;
  try { await remove(); toast({ title: 'U fshi' }); done(); }
  catch (e) { toast({ title: 'Gabim', description: (e as Error).message, variant: 'destructive' }); }
};

const useTab = (def: string) => {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || def;
  const setTab = (t: string) => { const p = new URLSearchParams(params); p.set('tab', t); setParams(p, { replace: true }); };
  return [tab, setTab] as const;
};

// ── main view ──────────────────────────────────────────────────────────────────

const HostingView: React.FC = () => {
  const permissions = usePermissions();
  const { toast } = useToast();
  const globalTeamId = useGlobalTeamId();
  const teamId = permissions.teamId || globalTeamId;
  const settings = useTeamSettingsData();
  const canEdit = permissions.canEdit === true;
  const isAdmin = permissions.isAdmin === true || permissions.isManager === true || (permissions as any).isOwner === true;
  const [tab, setTab] = useTab('subscriptions');

  const { data: subscriptions, loading: l1 } = useCollection<Subscription>('subscriptions', { orderBy: { field: 'createdAt', direction: 'desc' } });
  const { data: domains, loading: l2 } = useCollection<Domain>('domains', { orderBy: { field: 'createdAt', direction: 'desc' } });
  const { data: orders } = useCollection<HostingOrder>('hostingOrders', { orderBy: { field: 'createdAt', direction: 'desc' }, limit: 200 });
  const { data: products } = useCollection<HostingProduct>('hostingProducts', { orderBy: { field: 'createdAt', direction: 'desc' } });
  const { data: tlds } = useCollection<DomainTld>('domainTlds', { orderBy: { field: 'tld', direction: 'asc' } });
  const { data: servers } = useCollection<HostingServer>('hostingServers', { orderBy: { field: 'createdAt', direction: 'desc' } });
  const { data: events } = useCollection<HostingEvent>('hostingEvents', { orderBy: { field: 'createdAt', direction: 'desc' }, limit: 150 });
  const { data: coupons } = useCollection<HostingCoupon>('hostingCoupons', { orderBy: { field: 'createdAt', direction: 'desc' } });
  const { data: customers } = useCollection<Customer>('customers');
  const customerName = useMemo(() => {
    const m = new Map<string, string>();
    (customers || []).forEach((c) => m.set(c.id, c.name || (c as any).companyName || c.email || c.id));
    return (id?: string) => (id ? m.get(id) || id.slice(0, 6) : '—');
  }, [customers]);

  const lifecycle = useMemo(() => normalizeLifecycleConfig(settings?.hostingLifecycle), [settings?.hostingLifecycle]);

  const stats = useMemo(() => {
    const now = new Date();
    const subs = subscriptions || [];
    const doms = domains || [];
    const active = subs.filter((s) => s.status === 'Active');
    // Same definition as Financat (ALL, fivocrm rows only), so the two screens agree.
    const mrr = hostingMonthlyRecurringRevenue(subs, doms);
    const expiring = doms.filter((d) => { const e = toDate(d.expiryDate); return e && d.status !== 'Expired' && daysBetween(now, e) <= 30; }).length;
    return { active: active.length, suspended: subs.filter((s) => s.status === 'Suspended').length, domains: doms.filter((d) => d.status === 'Active' || d.status === 'Grace').length, expiring, mrr, pendingOrders: (orders || []).filter((o) => o.status === 'Pending' || o.status === 'Failed').length };
  }, [subscriptions, domains, orders]);

  const [orderOpen, setOrderOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const runLifecycle = async () => {
    setRunning(true);
    try {
      const r = await hostingApi<{ result: any }>('lifecycle.run');
      toast({ title: 'Cikli u ekzekutua', description: `${r.result.invoiced + r.result.domainsInvoiced} fatura, ${r.result.suspended} pezullime, ${r.result.renewed + r.result.domainsRenewed} rinovime, ${r.result.provisioned} aktivizime.` });
    } catch (e) { toast({ title: 'Gabim', description: (e as Error).message, variant: 'destructive' }); }
    finally { setRunning(false); }
  };

  if (l1 || l2) return <SkeletonLoader />;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-h2 text-foreground">Hosting & Domain-e</h1>
          <p className="text-body text-muted-foreground mt-1">
            {stats.active} llogari aktive · {stats.domains} domain-e · {stats.pendingOrders} porosi në pritje
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {isAdmin && (
            <Button variant="outline" onClick={runLifecycle} disabled={running}>
              {running ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}Ekzekuto ciklin
            </Button>
          )}
          {canEdit && (
            <Button className="bg-primary text-primary-foreground" onClick={() => setOrderOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />Porosi e re
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <Card className="p-4"><p className="text-xs text-muted-foreground">MRR hosting</p><p className="text-xl font-bold">{formatCurrency(stats.mrr, 'ALL')}</p><p className="text-xs text-muted-foreground">abonime + domain-e / muaj</p></Card>
        <Card className="p-4"><p className="text-xs text-muted-foreground">Llogari aktive</p><p className="text-xl font-bold">{stats.active}</p><p className="text-xs text-muted-foreground">{stats.suspended} të pezulluara</p></Card>
        <Card className="p-4"><p className="text-xs text-muted-foreground">Domain-e</p><p className="text-xl font-bold">{stats.domains}</p><p className={`text-xs ${stats.expiring ? 'text-orange-600' : 'text-muted-foreground'}`}>{stats.expiring} skadojnë brenda 30 ditësh</p></Card>
        <Card className="p-4"><p className="text-xs text-muted-foreground">Porosi në pritje</p><p className="text-xl font-bold">{stats.pendingOrders}</p><p className="text-xs text-muted-foreground">pagesë ose aktivizim</p></Card>
        <Card className="p-4"><p className="text-xs text-muted-foreground">Cikli i fundit</p><p className="text-sm font-semibold">{settings?.hostingLastRun?.at ? fmtDate(settings.hostingLastRun.at) : '—'}</p><p className="text-xs text-muted-foreground">{settings?.hostingLastRun ? `${settings.hostingLastRun.invoiced || 0} fatura · ${settings.hostingLastRun.errors || 0} gabime` : 'ende asnjë'}</p></Card>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <TabsList className="bg-muted w-full overflow-x-auto flex-nowrap justify-start">
          <TabsTrigger value="subscriptions" className="min-w-fit"><Server className="w-4 h-4 sm:mr-2" /><span className="hidden sm:inline">Shërbimet</span></TabsTrigger>
          <TabsTrigger value="domains" className="min-w-fit"><Globe className="w-4 h-4 sm:mr-2" /><span className="hidden sm:inline">Domain-et</span></TabsTrigger>
          <TabsTrigger value="orders" className="min-w-fit"><ShoppingCart className="w-4 h-4 sm:mr-2" /><span className="hidden sm:inline">Porositë</span></TabsTrigger>
          <TabsTrigger value="products" className="min-w-fit"><Package className="w-4 h-4 sm:mr-2" /><span className="hidden sm:inline">Paketat</span></TabsTrigger>
          <TabsTrigger value="tlds" className="min-w-fit"><Tag className="w-4 h-4 sm:mr-2" /><span className="hidden sm:inline">TLD-të</span></TabsTrigger>
          <TabsTrigger value="servers" className="min-w-fit"><Shield className="w-4 h-4 sm:mr-2" /><span className="hidden sm:inline">Serverët</span></TabsTrigger>
          <TabsTrigger value="settings" className="min-w-fit"><Settings className="w-4 h-4 sm:mr-2" /><span className="hidden sm:inline">Cilësimet</span></TabsTrigger>
          <TabsTrigger value="coupons" className="min-w-fit"><Ticket className="w-4 h-4 sm:mr-2" /><span className="hidden sm:inline">Kuponat</span></TabsTrigger>
          <TabsTrigger value="events" className="min-w-fit"><Activity className="w-4 h-4 sm:mr-2" /><span className="hidden sm:inline">Aktiviteti</span></TabsTrigger>
        </TabsList>

        <TabsContent value="subscriptions">
          <SubscriptionsTab subscriptions={subscriptions || []} products={products || []} servers={servers || []} customerName={customerName} lifecycle={lifecycle} canEdit={canEdit} isAdmin={isAdmin} />
        </TabsContent>
        <TabsContent value="domains">
          <DomainsTab domains={domains || []} customerName={customerName} lifecycle={lifecycle} canEdit={canEdit} isAdmin={isAdmin} />
        </TabsContent>
        <TabsContent value="orders">
          <OrdersTab orders={orders || []} customerName={customerName} canEdit={canEdit} />
        </TabsContent>
        <TabsContent value="products">
          <ProductsTab products={products || []} servers={servers || []} canEdit={canEdit} />
        </TabsContent>
        <TabsContent value="tlds">
          <TldsTab tlds={tlds || []} canEdit={canEdit} isAdmin={isAdmin} settings={settings} />
        </TabsContent>
        <TabsContent value="servers">
          <ServersTab servers={servers || []} canEdit={canEdit} isAdmin={isAdmin} />
        </TabsContent>
        <TabsContent value="settings">
          <SettingsTab teamId={teamId} settings={settings} isAdmin={isAdmin} />
        </TabsContent>
        <TabsContent value="coupons">
          <CouponsTab coupons={coupons || []} canEdit={canEdit} />
        </TabsContent>
        <TabsContent value="events">
          <EventsTab events={events || []} />
        </TabsContent>
      </Tabs>

      <NewOrderDialog open={orderOpen} onOpenChange={setOrderOpen} customers={customers || []} products={products || []} tlds={tlds || []} />
    </div>
  );
};

export default HostingView;

// ── Subscriptions ──────────────────────────────────────────────────────────────

const SubscriptionsTab: React.FC<{
  subscriptions: Subscription[]; products: HostingProduct[]; servers: HostingServer[];
  customerName: (id?: string) => string; lifecycle: ReturnType<typeof normalizeLifecycleConfig>; canEdit: boolean; isAdmin: boolean;
}> = ({ subscriptions, products, servers, customerName, lifecycle, canEdit, isAdmin }) => {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | 'fivocrm' | 'whmcs'>('all');
  const [selected, setSelected] = useState<Subscription | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const now = new Date();
  const rows = subscriptions.filter((s) => (filter === 'all' || (s.source || 'whmcs') === filter))
    .filter((s) => !q || `${s.productName} ${s.domain} ${customerName(s.customerId)} ${s.cpanelUsername}`.toLowerCase().includes(q.toLowerCase()));
  const live = selected ? subscriptions.find((s) => s.id === selected.id) || selected : null;
  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1"><Search className="w-4 h-4 absolute left-3 top-3 text-muted-foreground" /><Input className="pl-9" placeholder="Kërko domain, klient, username…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <Select value={filter} onValueChange={(v) => setFilter(v as any)}>
          <SelectTrigger className="w-full sm:w-52"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">Të gjitha</SelectItem><SelectItem value="fivocrm">Të menaxhuara nga FivoCRM</SelectItem><SelectItem value="whmcs">Pasqyrë WHMCS</SelectItem></SelectContent>
        </Select>
      </div>
      {canEdit && <div className="flex justify-end"><Button size="sm" variant="outline" onClick={() => setManualOpen(true)}><Plus className="w-4 h-4 mr-1" />Shto llogari ekzistuese</Button></div>}
      {rows.length === 0 && <Card className="p-8 text-center text-muted-foreground">Asnjë abonim. Krijo një porosi, shto një llogari ekzistuese, ose merr nën menaxhim një rresht nga pasqyra WHMCS.</Card>}
      <div className="grid gap-2">
        {rows.map((s) => {
          const due = toDate(s.nextDueDate);
          const decision = decideSubscription({ id: s.id, status: s.status, source: s.source, billingCycle: s.billingCycle, nextDueDate: due, recurringAmount: s.recurringAmount || 0, lastInvoicedDueKey: s.lastInvoicedDueKey ?? null, currentInvoice: s.currentInvoiceId ? { status: 'Pending' } : null, cancelAtPeriodEnd: s.cancelAtPeriodEnd, lifecycleHold: s.lifecycleHold, provisionStatus: s.provisionStatus }, now, lifecycle);
          return (
            <Card key={s.id} className="p-3 sm:p-4 cursor-pointer hover:border-primary/40" onClick={() => setSelected(s)}>
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold truncate">{s.domain || s.productName}</span>
                    <StatusBadge status={s.status} />
                    {(s.source || 'whmcs') === 'whmcs' && <Badge variant="outline" className="text-xs">WHMCS</Badge>}
                    {s.lifecycleHold && <Badge variant="outline" className="text-xs"><Pause className="w-3 h-3 mr-1" />hold</Badge>}
                    {s.cancelAtPeriodEnd && <Badge variant="outline" className="text-xs text-orange-700">anulohet në fund</Badge>}
                    {s.provisionStatus === 'failed' && <Badge className="bg-red-100 text-red-800 border-0 text-xs"><AlertTriangle className="w-3 h-3 mr-1" />aktivizimi dështoi</Badge>}
                  </div>
                  <p className="text-sm text-muted-foreground truncate">{s.productName} · {customerName(s.customerId)}{s.cpanelUsername ? ` · ${s.cpanelUsername}` : ''}</p>
                </div>
                <div className="text-sm sm:text-right">
                  <p className="font-medium">{formatCurrency(s.recurringAmount || 0, cur(s.currency))} <span className="text-muted-foreground">/ {s.billingCycle && CYCLE_LABELS[s.billingCycle as BillingCycle] ? CYCLE_LABELS[s.billingCycle as BillingCycle].toLowerCase() : s.billingCycle || '—'}</span></p>
                  <p className="text-xs text-muted-foreground"><Clock className="w-3 h-3 inline mr-1" />afati {fmtDate(s.nextDueDate)}{decision.reason ? ` · ${SUBSCRIPTION_BLOCK_LABELS[decision.reason]}` : decision.action ? ' · veprim sot' : ''}</p>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
      {live && <SubscriptionDialog sub={live} products={products} servers={servers} customerName={customerName} onClose={() => setSelected(null)} canEdit={canEdit} isAdmin={isAdmin} />}
      <ManualSubscriptionDialog open={manualOpen} onOpenChange={setManualOpen} products={products} servers={servers} />
    </div>
  );
};

const SubscriptionDialog: React.FC<{
  sub: Subscription; products: HostingProduct[]; servers: HostingServer[]; customerName: (id?: string) => string; onClose: () => void; canEdit: boolean; isAdmin: boolean;
}> = ({ sub, products, servers, customerName, onClose, canEdit, isAdmin }) => {
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [usage, setUsage] = useState<any>(null);
  const [password, setPassword] = useState<string | null>(null);
  const [confirmTerm, setConfirmTerm] = useState('');
  const [forceTerm, setForceTerm] = useState(false);
  const [quote, setQuote] = useState<any>(null);
  const { data: backups } = useCollection<HostingBackup>('hostingBackups', { where: [{ field: 'subscriptionId', operator: '==', value: sub.id }], limit: 10 });
  const [pkg, setPkg] = useState(sub.productId || '');
  const [cycle, setCycle] = useState<string>(sub.billingCycle || 'monthly');
  const [adopt, setAdopt] = useState({ serverId: sub.serverId || '', username: sub.cpanelUsername || '' });
  const isOurs = sub.source === 'fivocrm';

  const call = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try { await fn(); } catch (e) { toast({ title: 'Gabim', description: (e as Error).message, variant: 'destructive' }); }
    finally { setBusy(null); }
  };
  const act = (action: string, params: Record<string, unknown> = {}, ok?: string) => call(action, async () => {
    await hostingApi(action, { subscriptionId: sub.id, ...params });
    if (ok) toast({ title: ok });
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">{sub.domain || sub.productName} <StatusBadge status={sub.status} /></DialogTitle>
          <DialogDescription>{sub.productName} · {customerName(sub.customerId)} · {isOurs ? 'menaxhohet nga FivoCRM' : 'pasqyrë nga WHMCS (faturohet atje)'}</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
          <Info label="Çmimi" value={`${formatCurrency(sub.recurringAmount || 0, cur(sub.currency))} / ${CYCLE_LABELS[sub.billingCycle as BillingCycle] || sub.billingCycle || '—'}`} />
          <Info label="Afati tjetër" value={fmtDate(sub.nextDueDate)} />
          <Info label="Regjistruar" value={fmtDate(sub.registrationDate || sub.createdAt)} />
          <Info label="Server" value={servers.find((x) => x.id === sub.serverId)?.name || '—'} />
          <Info label="cPanel user" value={sub.cpanelUsername || '—'} />
          <Info label="Paketa WHM" value={sub.whmPackage || '—'} />
          {sub.lastInvoicedDueKey && <Info label="Faturuar për" value={sub.lastInvoicedDueKey} />}
          {sub.diskLimitMb != null && <Info label="Disku" value={`${sub.diskUsedMb ?? '?'} / ${sub.diskLimitMb} MB${sub.diskUsedMb && sub.diskLimitMb ? ` (${Math.round((sub.diskUsedMb / sub.diskLimitMb) * 100)}%)` : ''}`} />}
          <Info label="Backup i fundit" value={sub.lastBackupAt ? fmtDate(sub.lastBackupAt) : sub.lastBackupError ? <span className="text-red-700">dështoi</span> : '—'} />
          {sub.currentInvoiceId && <Info label="Fatura aktuale" value={<Link className="text-primary underline" to={`/app/invoices?invoice=${sub.currentInvoiceId}`}>hape</Link>} />}
          {sub.provisionError && <div className="col-span-full text-red-700 text-xs bg-red-50 p-2 rounded">{sub.provisionError}</div>}
        </div>

        {!isOurs && canEdit && (
          <Card className="p-3 space-y-2 border-dashed">
            <p className="text-sm font-medium flex items-center gap-2"><ArrowRightLeft className="w-4 h-4" />Merr nën menaxhim (migrim nga WHMCS)</p>
            <p className="text-xs text-muted-foreground">Faturimi dhe cikli i jetës kalojnë te FivoCRM: fatura për afatin aktual ({fmtDate(sub.nextDueDate)}) lëshohet nga FivoCRM. Zgjidh serverin ku jeton llogaria dhe username-in e cPanel-it, dhe anulo shërbimin (dhe faturën e papaguar) në WHMCS që të mos faturohet dy herë.</p>
            <div className="grid sm:grid-cols-2 gap-2">
              <Select value={adopt.serverId} onValueChange={(v) => setAdopt({ ...adopt, serverId: v })}><SelectTrigger><SelectValue placeholder="Serveri" /></SelectTrigger><SelectContent>{servers.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent></Select>
              <Input placeholder="cPanel username" value={adopt.username} onChange={(e) => setAdopt({ ...adopt, username: e.target.value })} />
            </div>
            <Button size="sm" disabled={!adopt.serverId || !adopt.username || busy === 'adopt'} onClick={() => call('adopt', async () => {
              // Server-side: the WHM account must exist AND serve this subscription's
              // domain before the row is bound to it (rules refuse the direct write).
              await hostingApi('sub.adoptWhmcs', { subscriptionId: sub.id, serverId: adopt.serverId, cpanelUsername: adopt.username.trim() });
              const due = toDate(sub.nextDueDate);
              toast({ title: 'U mor nën menaxhim', description: `Llogaria u verifikua në WHM. Fatura për afatin ${due ? due.toLocaleDateString('sq-AL') : 'e radhës'} do të lëshohet nga FivoCRM — anulo faturën e papaguar në WHMCS nëse ekziston.` });
            })}>Merr nën menaxhim</Button>
          </Card>
        )}

        {isOurs && (
          <>
            <div className="flex flex-wrap gap-2">
              {isAdmin && <Button size="sm" variant="outline" disabled={sub.status !== 'Active' || !!busy} title="Klienti njoftohet për çdo hyrje të stafit" onClick={() => call('sso', async () => { const r = await hostingApi<{ url: string }>('sub.sso', { subscriptionId: sub.id }); await openExternal(r.url); })}><ExternalLink className="w-4 h-4 mr-1" />Hyr në cPanel</Button>}
              <Button size="sm" variant="outline" disabled={!!busy || !sub.cpanelUsername} onClick={() => call('usage', async () => { const r = await hostingApi<{ usage: any }>('sub.usage', { subscriptionId: sub.id }); setUsage(r.usage || { missing: true }); })}><Activity className="w-4 h-4 mr-1" />Përdorimi</Button>
              {isAdmin && <Button size="sm" variant="outline" disabled={sub.status !== 'Active' || !!busy} title="Klienti njoftohet" onClick={() => call('pw', async () => { const r = await hostingApi<{ password: string }>('sub.resetPassword', { subscriptionId: sub.id }); setPassword(r.password); })}><KeyRound className="w-4 h-4 mr-1" />Fjalëkalim i ri</Button>}
              {canEdit && sub.status === 'Active' && <Button size="sm" variant="outline" disabled={!!busy} onClick={() => { if (!window.confirm(`Pezullo ${sub.domain || sub.cpanelUsername}? Faqja dhe email-et e klientit ndalojnë së punuari derisa të riaktivizohet.`)) return; act('sub.suspend', { reason: 'manual' }, 'Llogaria u pezullua'); }}><Pause className="w-4 h-4 mr-1" />Pezullo</Button>}
              {canEdit && sub.status === 'Suspended' && <Button size="sm" variant="outline" disabled={!!busy} onClick={() => act('sub.unsuspend', {}, 'Llogaria u riaktivizua')}><Play className="w-4 h-4 mr-1" />Riaktivizo</Button>}
              {canEdit && sub.provisionStatus === 'failed' && sub.orderId && <Button size="sm" disabled={!!busy} onClick={() => call('prov', async () => { await hostingApi('order.provision', { orderId: sub.orderId }); toast({ title: 'Aktivizimi u riprovua' }); })}><Wand2 className="w-4 h-4 mr-1" />Riprovo aktivizimin</Button>}
            </div>
            {usage && (
              <Card className="p-3 text-sm">
                {usage.missing ? 'Llogaria nuk u gjet në WHM.' : <>Disk: <strong>{usage.diskUsedMb ?? '?'} MB</strong> nga {usage.diskLimitMb ?? '∞'} MB · IP {usage.ip || '—'} · paketa {usage.plan || '—'} · {usage.suspended ? 'e pezulluar në WHM' : 'aktive në WHM'}</>}
              </Card>
            )}
            {password && (
              <Card className="p-3 text-sm bg-amber-50 border-amber-200">
                Fjalëkalimi i ri (shfaqet vetëm një herë): <code className="font-mono select-all">{password}</code>
              </Card>
            )}
            <Card className="p-3 text-sm space-y-1">
              <div className="flex items-center justify-between"><span className="font-medium flex items-center gap-1"><HardDrive className="w-4 h-4" />Backup-et (pkgacct)</span>{canEdit && <Button size="sm" variant="outline" disabled={!!busy || sub.status === 'Terminated'} onClick={() => call('bk', async () => { const r = await hostingApi<{ path?: string }>('backup.run', { subscriptionId: sub.id }); toast({ title: 'Backup u krye', description: r.path }); })}>{busy === 'bk' ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}Backup tani</Button>}</div>
              {!(backups || []).length ? <p className="text-xs text-muted-foreground">Asnjë backup i regjistruar. Backup-et e planifikuara bëhen sipas intervalit te Cilësimet.</p> : (
                <ul className="text-xs space-y-0.5">{[...(backups || [])].sort((a, b) => (getTimestampMs(b.createdAt) || 0) - (getTimestampMs(a.createdAt) || 0)).map((b) => <li key={b.id} className="flex justify-between gap-2"><span>{fmtDate(b.createdAt)} · {b.kind}</span><span className="font-mono truncate text-muted-foreground">{b.path || '—'}</span></li>)}</ul>
              )}
              {sub.lastBackupError && <p className="text-xs text-red-700">{sub.lastBackupError}</p>}
            </Card>

            {canEdit && (
              <div className="grid sm:grid-cols-2 gap-3 pt-2 border-t">
                <div className="space-y-2">
                  <Label className="text-xs">Ndrysho paketën</Label>
                  <Select value={pkg} onValueChange={(v) => { setPkg(v); setQuote(null); }}><SelectTrigger><SelectValue placeholder="Paketa" /></SelectTrigger><SelectContent>{products.filter((p) => p.status === 'Active' && (!sub.serverId || p.serverId === sub.serverId)).map((p) => <SelectItem key={p.id} value={p.id}>{p.name} ({p.whmPackage})</SelectItem>)}</SelectContent></Select>
                  <Select value={cycle} onValueChange={(v) => { setCycle(v); setQuote(null); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{BILLING_CYCLES.map((c) => <SelectItem key={c} value={c}>{CYCLE_LABELS[c]}</SelectItem>)}</SelectContent></Select>
                  {sub.pendingUpgrade ? (
                    <p className="text-xs text-amber-700">Upgrade në pritje të pagesës: {formatCurrency(sub.pendingUpgrade.amount, cur(sub.currency))} — <Link className="underline" to={`/app/invoices?invoice=${sub.pendingUpgrade.invoiceId}`}>fatura</Link></p>
                  ) : quote ? (
                    <div className="text-xs space-y-1">
                      <p>{quote.oldPrice} → <strong>{quote.newPrice}</strong> {quote.currency} / {CYCLE_LABELS[quote.cycle as BillingCycle]}</p>
                      <p>{quote.amount > 0 ? <>Diferenca për {quote.daysRemaining}/{quote.daysInPeriod} ditët e mbetura: <strong>{formatCurrency(quote.amount, quote.currency)}</strong> — faturohet tani, paketa ndryshon pas pagesës.</> : 'Asgjë për të paguar tani — ndryshimi aplikohet menjëherë, çmimi i ri nga fatura tjetër.'}</p>
                      <Button size="sm" disabled={!!busy} onClick={() => call('upg', async () => { const r = await hostingApi<{ applied: boolean; invoiceId?: string; amount: number }>('sub.requestUpgrade', { subscriptionId: sub.id, productId: pkg, cycle }); toast({ title: r.applied ? 'Paketa u ndryshua' : 'Fatura e upgrade-it u krijua', description: r.applied ? undefined : `${r.amount} — paketa ndryshon sapo paguhet.` }); setQuote(null); })}>{quote.amount > 0 ? 'Faturo diferencën' : 'Apliko'}</Button>
                    </div>
                  ) : (
                    <Button size="sm" variant="outline" disabled={!pkg || !!busy || (pkg === sub.productId && cycle === sub.billingCycle)} onClick={() => call('quote', async () => { const r = await hostingApi<{ quote: any }>('sub.quoteUpgrade', { subscriptionId: sub.id, productId: pkg, cycle }); setQuote(r.quote); })}>Kuoto (me proratë)</Button>
                  )}
                </div>
                <div className="space-y-3">
                  <label className="flex items-center justify-between gap-2 text-sm"><span>Hold (pa pezullim/terminim automatik)</span><Switch checked={!!sub.lifecycleHold} onCheckedChange={(v) => act('sub.setHold', { hold: v })} /></label>
                  <label className="flex items-center justify-between gap-2 text-sm"><span>Anulo në fund të periudhës</span><Switch checked={!!sub.cancelAtPeriodEnd} onCheckedChange={(v) => act('sub.cancelAtPeriodEnd', { value: v })} /></label>
                  {isAdmin && sub.status !== 'Terminated' && (
                    <div className="space-y-1 pt-2 border-t">
                      <Label className="text-xs text-red-700">Termino (fshin llogarinë dhe skedarët!)</Label>
                      <p className="text-[11px] text-muted-foreground">Bëhet backup i plotë (pkgacct) në server para fshirjes; nëse backup-i dështon, terminimi ndalet.</p>
                      <div className="flex gap-2">
                        <Input placeholder={`shkruaj "${sub.cpanelUsername || sub.domain}"`} value={confirmTerm} onChange={(e) => setConfirmTerm(e.target.value)} />
                        <Button size="sm" variant="destructive" disabled={!confirmTerm || !!busy} onClick={() => call('term', async () => { await hostingApi('sub.terminate', { subscriptionId: sub.id, confirm: confirmTerm, reason: 'manual', force: forceTerm }); toast({ title: 'Llogaria u terminua' }); onClose(); })}><Trash2 className="w-4 h-4" /></Button>
                      </div>
                      <label className="flex items-center gap-2 text-[11px] text-red-700"><Switch checked={forceTerm} onCheckedChange={setForceTerm} />Fshi edhe nëse backup-i dështon (force)</label>
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};

const Info: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div><p className="text-xs text-muted-foreground">{label}</p><p className="font-medium truncate">{value}</p></div>
);

// ── Domains ────────────────────────────────────────────────────────────────────

const DomainsTab: React.FC<{ domains: Domain[]; customerName: (id?: string) => string; lifecycle: ReturnType<typeof normalizeLifecycleConfig>; canEdit: boolean; isAdmin: boolean }> = ({ domains, customerName, lifecycle, canEdit, isAdmin }) => {
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<Domain | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const now = new Date();
  const rows = [...domains].filter((d) => !q || `${d.domainName} ${customerName(d.customerId)}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (getTimestampMs(a.expiryDate) || Infinity) - (getTimestampMs(b.expiryDate) || Infinity));
  const live = selected ? domains.find((d) => d.id === selected.id) || selected : null;
  return (
    <div className="space-y-3">
      <div className="relative"><Search className="w-4 h-4 absolute left-3 top-3 text-muted-foreground" /><Input className="pl-9" placeholder="Kërko domain ose klient…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      {canEdit && <div className="flex justify-end"><Button size="sm" variant="outline" onClick={() => setManualOpen(true)}><Plus className="w-4 h-4 mr-1" />Shto domain ekzistues</Button></div>}
      {rows.length === 0 && <Card className="p-8 text-center text-muted-foreground">Asnjë domain. Porosit një të ri, ose shto një ekzistues (Dynadot ose regjistrues tjetër, p.sh. .al).</Card>}
      <div className="grid gap-2">
        {rows.map((d) => {
          const exp = toDate(d.expiryDate);
          const days = exp ? daysBetween(now, exp) : null;
          const decision = decideDomain({ id: d.id, status: d.status, source: d.source, registrar: d.registrar, expiryDate: exp, years: d.years, recurringAmount: d.recurringAmount || 0, autoRenew: d.autoRenew !== false, lastInvoicedExpiryKey: d.lastInvoicedExpiryKey ?? null, currentInvoice: d.currentInvoiceId ? { status: 'Pending' } : null, lifecycleHold: d.lifecycleHold, renewedAtRegistrarForKey: d.renewedAtRegistrarForKey ?? null }, now, lifecycle);
          return (
            <Card key={d.id} className="p-3 sm:p-4 cursor-pointer hover:border-primary/40" onClick={() => setSelected(d)}>
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold">{d.domainName}</span>
                    <StatusBadge status={d.status} />
                    {(d.source || 'whmcs') === 'whmcs' && <Badge variant="outline" className="text-xs">WHMCS</Badge>}
                    {d.autoRenew === false && <Badge variant="outline" className="text-xs text-orange-700">pa rinovim auto</Badge>}
                    {d.provisionError && <Badge className="bg-red-100 text-red-800 border-0 text-xs"><AlertTriangle className="w-3 h-3 mr-1" />gabim</Badge>}
                  </div>
                  <p className="text-sm text-muted-foreground truncate">{customerName(d.customerId)}{d.nameservers?.length ? ` · ${d.nameservers.slice(0, 2).join(', ')}` : ''}</p>
                </div>
                <div className="text-sm sm:text-right">
                  <p className="font-medium">{formatCurrency(d.recurringAmount || 0, cur(d.currency))} <span className="text-muted-foreground">/ {d.years || 1} vit</span></p>
                  <p className={`text-xs ${days !== null && days <= 30 ? 'text-orange-600' : 'text-muted-foreground'}`}>skadon {fmtDate(d.expiryDate)}{days !== null ? ` (${days} ditë)` : ''}{decision.reason ? ` · ${DOMAIN_BLOCK_LABELS[decision.reason]}` : ''}</p>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
      {live && <DomainDialog dom={live} customerName={customerName} onClose={() => setSelected(null)} canEdit={canEdit} isAdmin={isAdmin} />}
      <ManualDomainDialog open={manualOpen} onOpenChange={setManualOpen} />
    </div>
  );
};

const DomainDialog: React.FC<{ dom: Domain; customerName: (id?: string) => string; onClose: () => void; canEdit: boolean; isAdmin: boolean }> = ({ dom, customerName, onClose, canEdit, isAdmin }) => {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [ns, setNs] = useState((dom.nameservers || []).join('\n'));
  const [auth, setAuth] = useState<string | null>(null);
  const isOurs = dom.source === 'fivocrm' && dom.registrar === 'dynadot';
  const run = async (fn: () => Promise<void>) => { setBusy(true); try { await fn(); } catch (e) { toast({ title: 'Gabim', description: (e as Error).message, variant: 'destructive' }); } finally { setBusy(false); } };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader><DialogTitle className="flex items-center gap-2">{dom.domainName} <StatusBadge status={dom.status} /></DialogTitle><DialogDescription>{customerName(dom.customerId)} · {isOurs ? 'Dynadot, menaxhohet nga FivoCRM' : dom.source === 'fivocrm' ? `regjistrues i jashtëm (${dom.registrar || 'manual'}) — faturohet nga FivoCRM, rinovohet me dorë` : 'pasqyrë nga WHMCS'}</DialogDescription></DialogHeader>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
          <Info label="Regjistruar" value={fmtDate(dom.registrationDate)} />
          <Info label="Skadon" value={fmtDate(dom.expiryDate)} />
          <Info label="Rinovimi" value={`${formatCurrency(dom.recurringAmount || 0, cur(dom.currency))} / ${dom.years || 1} vit`} />
          <Info label="Rinovim auto" value={dom.autoRenew === false ? 'Fikur' : 'Ndezur'} />
          <Info label="Lock" value={dom.locked === undefined ? '—' : dom.locked ? 'Po' : 'Jo'} />
          <Info label="Privatësi" value={dom.privacy === undefined ? '—' : dom.privacy ? 'Po' : 'Jo'} />
          {dom.currentInvoiceId && <Info label="Fatura rinovimi" value={<Link className="text-primary underline" to={`/app/invoices?invoice=${dom.currentInvoiceId}`}>hape</Link>} />}
          {dom.provisionError && <div className="col-span-full text-red-700 text-xs bg-red-50 p-2 rounded">{dom.provisionError}</div>}
        </div>
        {isOurs && canEdit && (
          <div className="space-y-3 pt-2 border-t">
            <div className="space-y-1">
              <Label className="text-xs">Nameservers (një për rresht)</Label>
              <Textarea rows={3} value={ns} onChange={(e) => setNs(e.target.value)} />
              <Button size="sm" variant="outline" disabled={busy} onClick={() => run(async () => { await hostingApi('domain.setNameservers', { domainId: dom.id, nameservers: ns.split(/\s+/).filter(Boolean) }); toast({ title: 'Nameservers u ruajtën te Dynadot' }); })}>Ruaj NS</Button>
            </div>
            <div className="flex flex-wrap gap-2 items-center">
              <label className="flex items-center gap-2 text-sm"><Switch checked={dom.autoRenew !== false} disabled={busy} onCheckedChange={(v) => { if (!v && !window.confirm(`Fik rinovimin automatik për ${dom.domainName}? Nuk do të lëshohet faturë rinovimi dhe domain-i skadon më ${fmtDate(dom.expiryDate)}.`)) return; run(async () => { await hostingApi('domain.setAutoRenew', { domainId: dom.id, value: v }); toast({ title: v ? 'Rinovimi automatik u ndez' : 'Rinovimi automatik u fik' }); }); }} />Rinovim automatik (me faturë)</label>
              <label className="flex items-center gap-2 text-sm"><Switch checked={!!dom.lifecycleHold} disabled={busy} onCheckedChange={(v) => run(async () => { await hostingApi('domain.setHold', { domainId: dom.id, hold: v }); toast({ title: v ? 'Domain-i u vu në hold' : 'Hold u hoq' }); })} />Hold</label>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => run(async () => { await hostingApi('domain.setPrivacy', { domainId: dom.id, option: dom.privacy ? 'off' : 'full' }); toast({ title: dom.privacy ? 'Privatësia u fik' : 'Privatësia u ndez' }); })}>{dom.privacy ? <EyeOff className="w-4 h-4 mr-1" /> : <Eye className="w-4 h-4 mr-1" />}WHOIS {dom.privacy ? 'publik' : 'privat'}</Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => run(async () => { const r = await hostingApi<{ authCode: string }>('domain.authCode', { domainId: dom.id }); setAuth(r.authCode); })}><KeyRound className="w-4 h-4 mr-1" />Kodi EPP</Button>
              {isAdmin && <Button size="sm" variant="ghost" disabled={busy} onClick={() => window.confirm(`Fik auto-renew te Dynadot për ${dom.domainName}? Pas kësaj domain-i rinovohet vetëm kur paguhet fatura jonë; nëse fatura mbetet e papaguar, domain-i skadon.`) && run(async () => { await hostingApi('domain.registrarAutoRenew', { domainId: dom.id, value: false }); toast({ title: 'Rinovimi automatik i Dynadot u fik', description: 'Rinovohet vetëm pas pagesës së faturës sonë.' }); })}>Fik auto-renew te Dynadot</Button>}
            </div>
            {auth && <Card className="p-3 text-sm bg-amber-50 border-amber-200">Kodi EPP: <code className="font-mono select-all">{auth}</code></Card>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

// ── Orders ─────────────────────────────────────────────────────────────────────

const OrdersTab: React.FC<{ orders: HostingOrder[]; customerName: (id?: string) => string; canEdit: boolean }> = ({ orders, customerName, canEdit }) => {
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const act = async (id: string, action: string) => {
    setBusy(id);
    try { const r = await hostingApi<any>(action, { orderId: id }); toast({ title: action === 'order.cancel' ? 'Porosia u anulua' : `Aktivizimi: ${r.status || 'ok'}`, description: r.errors?.length ? r.errors[0] : undefined, variant: r.errors?.length ? 'destructive' : undefined }); }
    catch (e) { toast({ title: 'Gabim', description: (e as Error).message, variant: 'destructive' }); }
    finally { setBusy(null); }
  };
  if (!orders.length) return <Card className="p-8 text-center text-muted-foreground">Asnjë porosi ende.</Card>;
  return (
    <div className="grid gap-2">
      {orders.map((o) => (
        <Card key={o.id} className="p-3 sm:p-4">
          <div className="flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap"><span className="font-semibold">{o.orderNumber}</span><StatusBadge status={o.status} /><Badge variant="outline" className="text-xs">{o.source === 'portal' ? 'portal' : 'staf'}</Badge></div>
              <p className="text-sm text-muted-foreground">{customerName(o.customerId)} · {fmtDate(o.createdAt)}</p>
              <ul className="text-sm mt-1 space-y-0.5">
                {(o.lines || []).map((l, i) => (
                  <li key={i} className="flex items-center gap-2">
                    {l.provisionStatus === 'provisioned' ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> : l.provisionStatus === 'failed' ? <AlertTriangle className="w-3.5 h-3.5 text-red-600" /> : <Clock className="w-3.5 h-3.5 text-muted-foreground" />}
                    <span className="truncate">{l.description}</span><span className="text-muted-foreground ml-auto">{formatCurrency(l.total, l.currency)}</span>
                  </li>
                ))}
              </ul>
              {o.lastError && <p className="text-xs text-red-700 mt-1">{o.lastError}</p>}
              {o.status === 'Failed' && <p className="text-xs text-muted-foreground mt-0.5">{o.retryExhausted ? `Ri-provat automatike u shteruan (${o.retryCount || 0}) — kërkohet ndërhyrje.` : `Ri-prova ${(o.retryCount || 0) + 1} automatikisht ${o.nextRetryAt ? `më ${toDate(o.nextRetryAt)?.toLocaleString('sq-AL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : 'së shpejti'}.`}</p>}
              {o.couponCode && <p className="text-xs text-emerald-700 mt-0.5">Kupon {o.couponCode}: −{formatCurrency(o.couponDiscount || 0, o.currency)}</p>}
            </div>
            <div className="sm:text-right space-y-2">
              <p className="font-semibold">{formatCurrency(o.total, o.currency)}</p>
              {o.invoiceId && <Link className="text-xs text-primary underline block" to={`/app/invoices?invoice=${o.invoiceId}`}>fatura</Link>}
              {canEdit && (
                <div className="flex gap-1 sm:justify-end">
                  {(o.status === 'Pending' || o.status === 'Paid' || o.status === 'Failed') && <Button size="sm" variant="outline" disabled={busy === o.id} onClick={() => act(o.id, 'order.provision')}><Wand2 className="w-3.5 h-3.5 mr-1" />Aktivizo</Button>}
                  {(o.status === 'Pending' || o.status === 'Failed') && <Button size="sm" variant="ghost" disabled={busy === o.id} onClick={() => act(o.id, 'order.cancel')}>Anulo</Button>}
                </div>
              )}
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
};

// ── New order dialog ───────────────────────────────────────────────────────────

type DraftLine = { kind: 'hosting' | 'domain-register' | 'domain-transfer'; productId?: string; cycle?: BillingCycle; domainName: string; years: number; authCode?: string };

const NewOrderDialog: React.FC<{ open: boolean; onOpenChange: (o: boolean) => void; customers: Customer[]; products: HostingProduct[]; tlds: DomainTld[]; portal?: false }> = ({ open, onOpenChange, customers, products, tlds }) => {
  const { toast } = useToast();
  const [customerId, setCustomerId] = useState('');
  const [custQ, setCustQ] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([{ kind: 'hosting', domainName: '', years: 1 }]);
  const [check, setCheck] = useState<Record<string, DomainCheckRow>>({});
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [couponCode, setCouponCode] = useState('');
  const [serverQuote, setServerQuote] = useState<{ order: any; couponError: string | null } | null>(null);
  useEffect(() => { if (!open) { setLines([{ kind: 'hosting', domainName: '', years: 1 }]); setCheck({}); setCustomerId(''); setCouponCode(''); setServerQuote(null); } }, [open]);
  useEffect(() => { setServerQuote(null); }, [lines, couponCode, customerId]);
  const fetchQuote = async () => {
    if (!customerId) { toast({ title: 'Zgjidh klientin', variant: 'destructive' }); return; }
    try { const r = await hostingApi<{ order: any; couponError: string | null }>('order.quote', { customerId, lines: lines.map((l) => ({ ...l, domainName: l.domainName.trim() })), couponCode }); setServerQuote(r); if (r.couponError) toast({ title: 'Kuponi', description: r.couponError, variant: 'destructive' }); }
    catch (e) { toast({ title: 'Gabim', description: (e as Error).message, variant: 'destructive' }); }
  };

  const activeProducts = products.filter((p) => p.status === 'Active');
  const tldPricing: TldPricing[] = tlds.filter((t) => t.status === 'Active').map((t) => ({ tld: t.tld, currency: t.currency, registerPrice: t.registerPrice, renewPrice: t.renewPrice, transferPrice: t.transferPrice, minYears: t.minYears, maxYears: t.maxYears, status: 'Active' }));
  const inputs: OrderLineInput[] = lines.map((l) => {
    if (l.kind === 'hosting') { const p = activeProducts.find((x) => x.id === l.productId); return { kind: 'hosting', productId: p?.id, productName: p?.name, cycle: l.cycle, pricing: p ? { ...(p.pricing as any), currency: p.currency } : null, domainName: l.domainName, freeDomainTlds: p?.freeDomainTlds || null, freeDomainMinCycle: p?.freeDomainMinCycle || null }; }
    return { kind: l.kind, domainName: l.domainName, years: l.years, authCode: l.authCode };
  });
  const priced = priceOrder(inputs, tldPricing);
  const filteredCustomers = customers.filter((c) => !custQ || `${c.name} ${c.email} ${(c as any).companyName || ''}`.toLowerCase().includes(custQ.toLowerCase())).slice(0, 30);

  const runCheck = async () => {
    const names = Array.from(new Set(lines.filter((l) => l.kind !== 'hosting').map((l) => parseDomain(l.domainName)?.name).filter((x): x is string => !!x)));
    if (!names.length) return;
    setChecking(true);
    try { const r = await checkDomains(names); const m: Record<string, DomainCheckRow> = {}; r.results.forEach((x) => { m[x.domain] = x; }); setCheck(m); if (r.registrarError) toast({ title: 'Regjistruesi', description: r.registrarError, variant: 'destructive' }); }
    catch (e) { toast({ title: 'Gabim', description: (e as Error).message, variant: 'destructive' }); }
    finally { setChecking(false); }
  };
  const submit = async () => {
    if (!customerId) { toast({ title: 'Zgjidh klientin', variant: 'destructive' }); return; }
    if (!priced.ok) { toast({ title: ORDER_ERROR_LABELS[priced.error], variant: 'destructive' }); return; }
    setBusy(true);
    try {
      const r = await hostingApi<{ orderId: string; orderNumber: string; invoiceId: string | null; provisioned?: any }>('order.create', { customerId, lines: lines.map((l) => ({ ...l, domainName: l.domainName.trim() })), couponCode: couponCode.trim() || undefined });
      toast({ title: `Porosia ${r.orderNumber} u krijua`, description: r.invoiceId ? 'Fatura u krijua dhe iu dërgua klientit. Aktivizimi nis pas pagesës.' : 'Porosi pa pagesë — aktivizimi nisi.' });
      onOpenChange(false);
    } catch (e) { toast({ title: 'Gabim', description: (e as Error).message, variant: 'destructive' }); }
    finally { setBusy(false); }
  };
  const setLine = (i: number, patch: Partial<DraftLine>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Porosi e re hosting / domain</DialogTitle><DialogDescription>Çmimet vijnë nga katalogu. Fatura krijohet menjëherë; llogaria dhe domain-i aktivizohen kur fatura paguhet.</DialogDescription></DialogHeader>
        <div className="space-y-2">
          <Label>Klienti</Label>
          <Input placeholder="Kërko klient…" value={custQ} onChange={(e) => setCustQ(e.target.value)} />
          <Select value={customerId} onValueChange={setCustomerId}><SelectTrigger><SelectValue placeholder="Zgjidh klientin" /></SelectTrigger><SelectContent>{filteredCustomers.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}{c.email ? ` · ${c.email}` : ''}</SelectItem>)}</SelectContent></Select>
        </div>
        <div className="space-y-3">
          {lines.map((l, i) => (
            <Card key={i} className="p-3 space-y-2">
              <div className="flex gap-2 items-center">
                <Select value={l.kind} onValueChange={(v) => setLine(i, { kind: v as any })}><SelectTrigger className="w-44"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="hosting">Hosting</SelectItem><SelectItem value="domain-register">Regjistrim domain</SelectItem><SelectItem value="domain-transfer">Transferim domain</SelectItem></SelectContent></Select>
                <Input className="flex-1" placeholder={l.kind === 'hosting' ? 'Domain-i kryesor i llogarisë' : 'shembull.com'} value={l.domainName} onChange={(e) => setLine(i, { domainName: e.target.value })} />
                <Button variant="ghost" size="sm" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} disabled={lines.length === 1}><Trash2 className="w-4 h-4" /></Button>
              </div>
              {l.kind === 'hosting' ? (
                <div className="grid sm:grid-cols-2 gap-2">
                  <Select value={l.productId || ''} onValueChange={(v) => { const p = activeProducts.find((x) => x.id === v); const cs = availableCycles(p?.pricing as any); setLine(i, { productId: v, cycle: cs.includes(l.cycle as BillingCycle) ? l.cycle : cs[0] }); }}><SelectTrigger><SelectValue placeholder="Paketa" /></SelectTrigger><SelectContent>{activeProducts.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent></Select>
                  <Select value={l.cycle || ''} onValueChange={(v) => setLine(i, { cycle: v as BillingCycle })}><SelectTrigger><SelectValue placeholder="Cikli" /></SelectTrigger><SelectContent>{availableCycles(activeProducts.find((x) => x.id === l.productId)?.pricing as any).map((c) => { const p = activeProducts.find((x) => x.id === l.productId)!; return <SelectItem key={c} value={c}>{CYCLE_LABELS[c]} — {formatCurrency(p.pricing[c]!.price, p.currency)}</SelectItem>; })}</SelectContent></Select>
                </div>
              ) : (
                <div className="grid sm:grid-cols-2 gap-2 items-center">
                  <Select value={String(l.years)} onValueChange={(v) => setLine(i, { years: Number(v) })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{[1, 2, 3, 5].map((y) => <SelectItem key={y} value={String(y)}>{y} {y === 1 ? 'vit' : 'vjet'}</SelectItem>)}</SelectContent></Select>
                  {l.kind === 'domain-transfer' ? <Input placeholder="Kodi EPP / Auth" value={l.authCode || ''} onChange={(e) => setLine(i, { authCode: e.target.value })} /> : (
                    (() => { const n = parseDomain(l.domainName)?.name; const c = n ? check[n] : undefined; return c ? <p className={`text-sm ${c.status === 'available' ? 'text-emerald-700' : c.status === 'taken' ? 'text-red-700' : 'text-muted-foreground'}`}>{c.status === 'available' ? 'I lirë' : c.status === 'taken' ? 'I zënë' : 'Nuk dihet'}{c.sold ? ` · ${formatCurrency(c.registerPrice || 0, c.currency || 'EUR')}/vit` : ' · TLD nuk shitet'}{c.cost != null ? ` · kosto ${c.cost} ${c.costCurrency || ''}` : ''}</p> : <p className="text-xs text-muted-foreground">Kontrollo disponueshmërinë →</p>; })()
                  )}
                </div>
              )}
            </Card>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => setLines((ls) => [...ls, { kind: 'domain-register', domainName: '', years: 1 }])}><Plus className="w-4 h-4 mr-1" />Shto rresht</Button>
            <Button variant="outline" size="sm" onClick={runCheck} disabled={checking}>{checking ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Search className="w-4 h-4 mr-1" />}Kontrollo domain-et</Button>
          </div>
        </div>
        <div className="flex gap-2 items-center">
          <Input className="uppercase" placeholder="Kod kuponi (opsional)" value={couponCode} onChange={(e) => setCouponCode(e.target.value.toUpperCase())} />
          <Button variant="outline" size="sm" onClick={fetchQuote} disabled={!priced.ok || !customerId}><Ticket className="w-4 h-4 mr-1" />Kuoto</Button>
        </div>
        <Card className="p-3 text-sm">
          {(() => { const o = serverQuote?.order || (priced.ok ? priced.order : null); if (!o) return <p className="text-muted-foreground">{!priced.ok ? ORDER_ERROR_LABELS[priced.error] + (priced.index !== undefined ? ` (rreshti ${priced.index + 1})` : '') : ''}</p>; return (
            <>
              {o.lines.map((l: any, i: number) => <div key={i} className="flex justify-between"><span>{l.description}{l.discount ? <span className="text-emerald-700 text-xs ml-1">−{formatCurrency(l.discount, l.currency)} {l.discountReason === 'free-domain' ? '(domain falas)' : ''}</span> : null}</span><span>{formatCurrency(l.total, l.currency)}</span></div>)}
              {o.couponCode && <div className="flex justify-between text-emerald-700"><span>Kupon {o.couponCode}</span><span>−{formatCurrency(o.couponDiscount || 0, o.currency)}</span></div>}
              <div className="flex justify-between font-semibold border-t mt-2 pt-2"><span>Totali{serverQuote ? ' (i konfirmuar)' : ''}</span><span>{formatCurrency(o.total, o.currency)}</span></div>
            </>
          ); })()}
        </Card>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Anulo</Button>
          <Button onClick={submit} disabled={busy || !priced.ok || !customerId}>{busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}Krijo porosinë + faturën</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// ── Products (packages) ────────────────────────────────────────────────────────

const ProductsTab: React.FC<{ products: HostingProduct[]; servers: HostingServer[]; canEdit: boolean }> = ({ products, servers, canEdit }) => {
  const { toast } = useToast();
  const mutation = useMutation<HostingProduct>('hostingProducts');
  const [editing, setEditing] = useState<Partial<HostingProduct> | null>(null);
  const removeEditing = () => editing?.id && removeWithConfirm(`Fshi paketën ${editing.name || ''}? Llogaritë ekzistuese mbeten në WHM, por paketa nuk shitet më dhe nuk mund të zgjidhet për upgrade.`, () => mutation.remove(editing.id!), toast, () => setEditing(null));
  const save = async () => {
    if (!editing) return;
    if (!editing.name?.trim() || !editing.serverId || !editing.whmPackage?.trim()) { toast({ title: 'Emri, serveri dhe paketa WHM janë të detyrueshme', variant: 'destructive' }); return; }
    const pricing: any = {};
    for (const c of BILLING_CYCLES) { const v = (editing.pricing as any)?.[c]; if (v && typeof v.price === 'number' && v.price >= 0) pricing[c] = { price: v.price, ...(v.setupFee ? { setupFee: v.setupFee } : {}) }; }
    if (!Object.keys(pricing).length) { toast({ title: 'Vendos të paktën një çmim', variant: 'destructive' }); return; }
    const payload = { name: editing.name.trim(), description: editing.description || '', serverId: editing.serverId, whmPackage: editing.whmPackage.trim(), status: editing.status || 'Active', currency: cur(editing.currency), pricing, features: (editing.features || []).filter(Boolean), portalVisible: editing.portalVisible !== false, diskGb: editing.diskGb ?? null, bandwidthGb: editing.bandwidthGb ?? null, freeDomainTlds: (editing.freeDomainTlds || []).filter(Boolean), freeDomainMinCycle: editing.freeDomainMinCycle || 'annually' };
    try {
      if (editing.id) await mutation.update(editing.id, payload as any); else await mutation.create(payload as any);
      toast({ title: 'Paketa u ruajt' }); setEditing(null);
    } catch (e) { toast({ title: 'Gabim', description: (e as Error).message, variant: 'destructive' }); }
  };
  const srv = servers.find((s) => s.id === editing?.serverId);
  return (
    <div className="space-y-3">
      {canEdit && <Button onClick={() => setEditing({ status: 'Active', currency: 'EUR', pricing: {}, portalVisible: true, serverId: servers[0]?.id })}><Plus className="w-4 h-4 mr-2" />Paketë e re</Button>}
      {!products.length && <Card className="p-8 text-center text-muted-foreground">Asnjë paketë. Shto një server te "Serverët", pastaj krijo paketat që u përgjigjen paketave të WHM-së.</Card>}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {products.map((p) => (
          <Card key={p.id} className="p-4 space-y-2 cursor-pointer hover:border-primary/40" onClick={() => canEdit && setEditing(p)}>
            <div className="flex items-center justify-between gap-2"><span className="font-semibold">{p.name}</span><div className="flex gap-1">{p.status === 'Archived' && <Badge variant="outline">Arkiv</Badge>}{p.portalVisible && <Badge variant="outline" className="text-xs">portal</Badge>}</div></div>
            <p className="text-xs text-muted-foreground">{servers.find((s) => s.id === p.serverId)?.name || '?'} · WHM: {p.whmPackage}</p>
            <div className="text-sm space-y-0.5">{availableCycles(p.pricing as any).map((c) => <div key={c} className="flex justify-between"><span className="text-muted-foreground">{CYCLE_LABELS[c]}</span><span>{formatCurrency(p.pricing[c]!.price, p.currency)}</span></div>)}</div>
            {p.freeDomainTlds?.length ? <p className="text-xs text-emerald-700">Domain falas (.{p.freeDomainTlds.join(', .')}) me {CYCLE_LABELS[p.freeDomainMinCycle || 'annually'].toLowerCase()}</p> : null}
          </Card>
        ))}
      </div>
      {editing && (
        <Dialog open onOpenChange={(o) => !o && setEditing(null)}>
          <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>{editing.id ? 'Ndrysho paketën' : 'Paketë e re'}</DialogTitle></DialogHeader>
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-1 sm:col-span-2"><Label>Emri</Label><Input value={editing.name || ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></div>
              <div className="space-y-1"><Label>Serveri</Label><Select value={editing.serverId || ''} onValueChange={(v) => setEditing({ ...editing, serverId: v })}><SelectTrigger><SelectValue placeholder="Serveri" /></SelectTrigger><SelectContent>{servers.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-1"><Label>Paketa WHM</Label>
                {srv?.packages?.length ? <Select value={editing.whmPackage || ''} onValueChange={(v) => setEditing({ ...editing, whmPackage: v })}><SelectTrigger><SelectValue placeholder="Zgjidh" /></SelectTrigger><SelectContent>{srv.packages.map((x) => <SelectItem key={x} value={x}>{x}</SelectItem>)}</SelectContent></Select> : <Input placeholder="emri i saktë në WHM" value={editing.whmPackage || ''} onChange={(e) => setEditing({ ...editing, whmPackage: e.target.value })} />}
              </div>
              <div className="space-y-1"><Label>Monedha</Label><Select value={editing.currency || 'EUR'} onValueChange={(v) => setEditing({ ...editing, currency: v as any })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="EUR">EUR</SelectItem><SelectItem value="ALL">ALL</SelectItem></SelectContent></Select></div>
              <div className="space-y-1"><Label>Statusi</Label><Select value={editing.status || 'Active'} onValueChange={(v) => setEditing({ ...editing, status: v as any })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Active">Aktive</SelectItem><SelectItem value="Archived">Arkiv</SelectItem></SelectContent></Select></div>
              <div className="space-y-1 sm:col-span-2"><Label>Përshkrimi</Label><Textarea rows={2} value={editing.description || ''} onChange={(e) => setEditing({ ...editing, description: e.target.value })} /></div>
              <div className="space-y-1 sm:col-span-2"><Label>Veçoritë (një për rresht)</Label><Textarea rows={3} value={(editing.features || []).join('\n')} onChange={(e) => setEditing({ ...editing, features: e.target.value.split('\n') })} /></div>
              <div className="sm:col-span-2 space-y-1">
                <Label>Çmimet për cikël (bosh = nuk shitet)</Label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {BILLING_CYCLES.map((c) => (
                    <div key={c} className="space-y-1"><span className="text-xs text-muted-foreground">{CYCLE_LABELS[c]}</span>
                      <Input type="number" min={0} step="0.01" value={(editing.pricing as any)?.[c]?.price ?? ''} onChange={(e) => { const v = e.target.value; setEditing({ ...editing, pricing: { ...(editing.pricing || {}), [c]: v === '' ? undefined : { ...((editing.pricing as any)?.[c] || {}), price: Number(v) } } as any }); }} />
                    </div>
                  ))}
                </div>
              </div>
              <div className="space-y-1"><Label>Domain falas — TLD (me presje, p.sh. com, net)</Label><Input placeholder="com, net" value={(editing.freeDomainTlds || []).join(', ')} onChange={(e) => setEditing({ ...editing, freeDomainTlds: e.target.value.split(',').map((x) => x.trim().toLowerCase().replace(/^\.+/, '')).filter(Boolean) })} /></div>
              <div className="space-y-1"><Label>…kur blihet me cikël ≥</Label><Select value={editing.freeDomainMinCycle || 'annually'} onValueChange={(v) => setEditing({ ...editing, freeDomainMinCycle: v as any })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{BILLING_CYCLES.map((c) => <SelectItem key={c} value={c}>{CYCLE_LABELS[c]}</SelectItem>)}</SelectContent></Select></div>
              <label className="flex items-center gap-2 text-sm sm:col-span-2"><Switch checked={editing.portalVisible !== false} onCheckedChange={(v) => setEditing({ ...editing, portalVisible: v })} />E dukshme në portalin e klientit</label>
            </div>
            <DialogFooter>
              {editing.id && <Button variant="ghost" className="text-red-700 mr-auto" onClick={removeEditing}>Fshi</Button>}
              <Button variant="outline" onClick={() => setEditing(null)}>Anulo</Button><Button onClick={save}>Ruaj</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
};

// ── TLDs ───────────────────────────────────────────────────────────────────────

const TldsTab: React.FC<{ tlds: DomainTld[]; canEdit: boolean; isAdmin: boolean; settings: ReturnType<typeof useTeamSettingsData> }> = ({ tlds, canEdit, isAdmin, settings }) => {
  const { toast } = useToast();
  const mutation = useMutation<DomainTld>('domainTlds');
  const [editing, setEditing] = useState<Partial<DomainTld> | null>(null);
  const removeEditing = () => editing?.id && removeWithConfirm(`Fshi TLD-në ${editing.tld || ''}? Domain-et ekzistuese nuk preken, por kjo TLD nuk shitet më.`, () => mutation.remove(editing.id!), toast, () => setEditing(null));
  const [margin, setMargin] = useState(settings?.hostingTldMarginPct ?? 40);
  const [syncing, setSyncing] = useState(false);
  const syncCosts = async () => {
    setSyncing(true);
    try { const r = await hostingApi<{ updated: number; unmatched: string[]; belowCost: string[]; currency: string | null }>('tld.syncCosts'); toast({ title: `Kostot u sinkronizuan (${r.updated} TLD${r.currency ? `, ${r.currency}` : ''})`, description: [r.unmatched.length ? `pa çmim te Dynadot: ${r.unmatched.join(', ')}` : '', r.belowCost.length ? `NËN KOSTO: ${r.belowCost.join(', ')}` : ''].filter(Boolean).join(' · ') || undefined, variant: r.belowCost.length ? 'destructive' : undefined }); }
    catch (e) { toast({ title: 'Gabim', description: (e as Error).message, variant: 'destructive' }); }
    finally { setSyncing(false); }
  };
  const applySuggested = async (t: DomainTld) => {
    if (t.suggestedRegisterPrice == null && t.suggestedRenewPrice == null) return;
    try { await mutation.update(t.id, { ...(t.suggestedRegisterPrice != null ? { registerPrice: t.suggestedRegisterPrice } : {}), ...(t.suggestedRenewPrice != null ? { renewPrice: t.suggestedRenewPrice } : {}), belowCost: false } as any); toast({ title: `.${t.tld}: çmimet e propozuara u aplikuan` }); }
    catch (e) { toast({ title: 'Gabim', description: (e as Error).message, variant: 'destructive' }); }
  };
  const save = async () => {
    if (!editing) return;
    const tld = String(editing.tld || '').trim().toLowerCase().replace(/^\.+/, '');
    if (!tld || !(Number(editing.registerPrice) >= 0) || !(Number(editing.renewPrice) >= 0)) { toast({ title: 'TLD dhe çmimet janë të detyrueshme', variant: 'destructive' }); return; }
    const payload = { tld, currency: cur(editing.currency), registerPrice: Number(editing.registerPrice), renewPrice: Number(editing.renewPrice), transferPrice: editing.transferPrice != null && editing.transferPrice !== ('' as any) ? Number(editing.transferPrice) : null, costRegister: editing.costRegister != null ? Number(editing.costRegister) : null, costRenew: editing.costRenew != null ? Number(editing.costRenew) : null, minYears: Number(editing.minYears) || 1, maxYears: Number(editing.maxYears) || 10, status: editing.status || 'Active', portalVisible: editing.portalVisible !== false };
    try { if (editing.id) await mutation.update(editing.id, payload as any); else await mutation.create(payload as any); toast({ title: 'TLD u ruajt' }); setEditing(null); }
    catch (e) { toast({ title: 'Gabim', description: (e as Error).message, variant: 'destructive' }); }
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 items-center">
        {canEdit && <Button onClick={() => setEditing({ status: 'Active', currency: 'EUR', minYears: 1, maxYears: 10, portalVisible: true })}><Plus className="w-4 h-4 mr-2" />TLD e re</Button>}
        {isAdmin && <Button variant="outline" onClick={syncCosts} disabled={syncing || !settings?.hasDynadotApiKey}>{syncing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}Sinkronizo kostot nga Dynadot</Button>}
        <span className="text-xs text-muted-foreground">{settings?.hostingTldCostsSyncedAt ? `Kostot u lexuan më ${fmtDate(settings.hostingTldCostsSyncedAt)} (automatikisht çdo javë, marzh ${settings?.hostingTldMarginPct ?? 40}%)` : 'Kostot lexohen automatikisht çdo javë nga Dynadot'}</span>
      </div>
      {tlds.some((t) => t.belowCost) && <Card className="p-3 border-red-300 bg-red-50 text-sm text-red-800 flex items-center gap-2"><AlertTriangle className="w-4 h-4" />TLD nën kosto: {tlds.filter((t) => t.belowCost).map((t) => `.${t.tld}`).join(', ')} — çmimi i shitjes është më i ulët se kostoja te Dynadot. Apliko propozimet.</Card>}
      {!tlds.length && <Card className="p-8 text-center text-muted-foreground">Asnjë TLD. Shto p.sh. <code>com</code>, <code>al</code>, <code>net</code> me çmimin e shitjes për regjistrim dhe rinovim.</Card>}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {tlds.map((t) => (
          <Card key={t.id} className="p-4 cursor-pointer hover:border-primary/40" onClick={() => canEdit && setEditing(t)}>
            <div className="flex items-center justify-between"><span className="font-semibold">.{t.tld}</span><div className="flex gap-1">{t.belowCost && <Badge className="bg-red-100 text-red-800 border-0 text-xs">nën kosto</Badge>}{t.status === 'Archived' && <Badge variant="outline">Arkiv</Badge>}</div></div>
            <div className="text-sm mt-1 space-y-0.5">
              <div className="flex justify-between"><span className="text-muted-foreground">Regjistrim</span><span>{formatCurrency(t.registerPrice, t.currency)}{t.costRegister != null ? <span className="text-xs text-muted-foreground"> (kosto {t.costRegister} {t.costCurrency || ''})</span> : null}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Rinovim</span><span>{formatCurrency(t.renewPrice, t.currency)}{t.costRenew != null ? <span className="text-xs text-muted-foreground"> (kosto {t.costRenew} {t.costCurrency || ''})</span> : null}</span></div>
              {t.transferPrice != null && <div className="flex justify-between"><span className="text-muted-foreground">Transferim</span><span>{formatCurrency(t.transferPrice, t.currency)}</span></div>}
              {(t.suggestedRegisterPrice != null || t.suggestedRenewPrice != null) && (t.suggestedRegisterPrice !== t.registerPrice || t.suggestedRenewPrice !== t.renewPrice) && (
                <div className="flex items-center justify-between pt-1 border-t mt-1 text-xs"><span className="text-muted-foreground">Propozim ({t.suggestedMarginPct ?? margin}%): {t.suggestedRegisterPrice ?? '—'} / {t.suggestedRenewPrice ?? '—'} {t.costCurrency || ''}{t.costCurrencyMismatch ? ' (monedhë tjetër)' : ''}</span>{canEdit && !t.costCurrencyMismatch && <Button size="sm" variant="ghost" className="h-6 px-2" onClick={(e) => { e.stopPropagation(); void applySuggested(t); }}><Wand2 className="w-3 h-3 mr-1" />Apliko</Button>}</div>
              )}
              {t.costSyncedAt && <p className="text-[10px] text-muted-foreground">kosto e lexuar {fmtDate(t.costSyncedAt)}</p>}
            </div>
          </Card>
        ))}
      </div>
      {editing && (
        <Dialog open onOpenChange={(o) => !o && setEditing(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>{editing.id ? `Ndrysho .${editing.tld}` : 'TLD e re'}</DialogTitle><DialogDescription>Kostoja është ajo që paguan te Dynadot; çmimi është ai që paguan klienti.</DialogDescription></DialogHeader>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label>TLD</Label><Input placeholder="com" value={editing.tld || ''} onChange={(e) => setEditing({ ...editing, tld: e.target.value })} /></div>
              <div className="space-y-1"><Label>Monedha</Label><Select value={editing.currency || 'EUR'} onValueChange={(v) => setEditing({ ...editing, currency: v as any })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="EUR">EUR</SelectItem><SelectItem value="ALL">ALL</SelectItem></SelectContent></Select></div>
              <div className="space-y-1"><Label>Kosto regjistrimi</Label><Input type="number" step="0.01" value={editing.costRegister ?? ''} onChange={(e) => setEditing({ ...editing, costRegister: e.target.value === '' ? undefined : Number(e.target.value) })} /></div>
              <div className="space-y-1"><Label>Kosto rinovimi</Label><Input type="number" step="0.01" value={editing.costRenew ?? ''} onChange={(e) => setEditing({ ...editing, costRenew: e.target.value === '' ? undefined : Number(e.target.value) })} /></div>
              <div className="col-span-2 flex items-center gap-2 text-sm"><Label className="text-xs">Marzhi %</Label><Input className="w-20" type="number" value={margin} onChange={(e) => setMargin(Number(e.target.value))} /><Button size="sm" variant="outline" disabled={!editing.costRegister} onClick={() => setEditing({ ...editing, registerPrice: suggestSellPrice(Number(editing.costRegister), margin), renewPrice: suggestSellPrice(Number(editing.costRenew ?? editing.costRegister), margin) })}><Wand2 className="w-4 h-4 mr-1" />Propozo çmimet</Button></div>
              <div className="space-y-1"><Label>Çmimi regjistrim / vit</Label><Input type="number" step="0.01" value={editing.registerPrice ?? ''} onChange={(e) => setEditing({ ...editing, registerPrice: Number(e.target.value) })} /></div>
              <div className="space-y-1"><Label>Çmimi rinovim / vit</Label><Input type="number" step="0.01" value={editing.renewPrice ?? ''} onChange={(e) => setEditing({ ...editing, renewPrice: Number(e.target.value) })} /></div>
              <div className="space-y-1"><Label>Çmimi transferim</Label><Input type="number" step="0.01" value={editing.transferPrice ?? ''} onChange={(e) => setEditing({ ...editing, transferPrice: e.target.value === '' ? (undefined as any) : Number(e.target.value) })} /></div>
              <div className="space-y-1"><Label>Vite min / max</Label><div className="flex gap-2"><Input type="number" min={1} value={editing.minYears ?? 1} onChange={(e) => setEditing({ ...editing, minYears: Number(e.target.value) })} /><Input type="number" min={1} value={editing.maxYears ?? 10} onChange={(e) => setEditing({ ...editing, maxYears: Number(e.target.value) })} /></div></div>
              <label className="flex items-center gap-2 text-sm"><Switch checked={editing.portalVisible !== false} onCheckedChange={(v) => setEditing({ ...editing, portalVisible: v })} />Në portal</label>
              <div className="space-y-1"><Label>Statusi</Label><Select value={editing.status || 'Active'} onValueChange={(v) => setEditing({ ...editing, status: v as any })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Active">Aktive</SelectItem><SelectItem value="Archived">Arkiv</SelectItem></SelectContent></Select></div>
            </div>
            <DialogFooter>
              {editing.id && <Button variant="ghost" className="text-red-700 mr-auto" onClick={removeEditing}>Fshi</Button>}
              <Button variant="outline" onClick={() => setEditing(null)}>Anulo</Button><Button onClick={save}>Ruaj</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
};

// ── Servers ────────────────────────────────────────────────────────────────────

const ServersTab: React.FC<{ servers: HostingServer[]; canEdit: boolean; isAdmin: boolean }> = ({ servers, canEdit, isAdmin }) => {
  const { toast } = useToast();
  const mutation = useMutation<HostingServer>('hostingServers');
  const [editing, setEditing] = useState<Partial<HostingServer> | null>(null);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const save = async () => {
    if (!editing) return;
    const hostname = String(editing.hostname || '').trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/[/:].*$/, '');
    if (!editing.name?.trim() || !hostname) { toast({ title: 'Emri dhe hostname janë të detyrueshme', variant: 'destructive' }); return; }
    const payload = { name: editing.name.trim(), hostname, port: Number(editing.port) || 2087, username: (editing.username || 'root').trim(), nameservers: (editing.nameservers || []).map((x) => x.trim().toLowerCase()).filter(Boolean), ipAddress: editing.ipAddress?.trim() || null, status: editing.status || 'Active' };
    try {
      let id = editing.id;
      if (id) await mutation.update(id, payload as any); else { const ref: any = await mutation.create({ ...payload, hasApiToken: false } as any); id = ref?.id; }
      if (token.trim() && id) {
        if (!isAdmin) toast({ title: 'Vetëm Admin/Manager mund të ruajë token-in', variant: 'destructive' });
        else { const r = await hostingApi<{ test: any }>('server.saveToken', { serverId: id, apiToken: token.trim() }); toast({ title: r.test?.ok ? `Lidhja OK — WHM ${r.test.version}, ${r.test.packages?.length || 0} paketa` : 'Token u ruajt, por lidhja dështoi', description: r.test?.error, variant: r.test?.ok ? undefined : 'destructive' }); }
      } else toast({ title: 'Serveri u ruajt' });
      setEditing(null); setToken('');
    } catch (e) { toast({ title: 'Gabim', description: (e as Error).message, variant: 'destructive' }); }
  };
  const test = async (id: string) => { setBusy(id); try { const r = await hostingApi<any>('server.test', { serverId: id }); toast({ title: r.ok ? `WHM ${r.version} · ${r.packages?.length || 0} paketa · ${r.accounts ?? '?'} llogari` : 'Lidhja dështoi', description: r.error, variant: r.ok ? undefined : 'destructive' }); } catch (e) { toast({ title: 'Gabim', description: (e as Error).message, variant: 'destructive' }); } finally { setBusy(null); } };
  return (
    <div className="space-y-3">
      {canEdit && <Button onClick={() => { setToken(''); setEditing({ status: 'Active', port: 2087, username: 'root', nameservers: [] }); }}><Plus className="w-4 h-4 mr-2" />Server i ri</Button>}
      {!servers.length && <Card className="p-8 text-center text-muted-foreground">Asnjë server. Shto serverin cPanel/WHM (hostname, porti 2087, user root ose reseller, API token nga WHM → Manage API Tokens).</Card>}
      <div className="grid sm:grid-cols-2 gap-3">
        {servers.map((s) => (
          <Card key={s.id} className="p-4 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0"><p className="font-semibold truncate">{s.name}</p><p className="text-xs text-muted-foreground truncate">{s.hostname}:{s.port || 2087} · {s.username}</p></div>
              <div className="flex items-center gap-1">{s.hasApiToken ? <Badge className="bg-emerald-100 text-emerald-800 border-0 text-xs">token ✓</Badge> : <Badge className="bg-amber-100 text-amber-800 border-0 text-xs">pa token</Badge>}{s.status === 'Inactive' && <Badge variant="outline">joaktiv</Badge>}</div>
            </div>
            <p className="text-xs text-muted-foreground">{s.lastCheckedAt ? <>{s.lastCheckOk ? <CheckCircle2 className="w-3 h-3 inline text-emerald-600 mr-1" /> : <AlertTriangle className="w-3 h-3 inline text-red-600 mr-1" />}{fmtDate(s.lastCheckedAt)} · WHM {s.whmVersion || '?'} · {s.accountsCount ?? '?'} llogari · {s.packages?.length || 0} paketa{s.lastCheckError ? ` · ${s.lastCheckError}` : ''}</> : 'Ende pa test'}</p>
            {s.nameservers?.length ? <p className="text-xs text-muted-foreground">NS: {s.nameservers.join(', ')}</p> : null}
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={busy === s.id || !s.hasApiToken} onClick={() => test(s.id)}>{busy === s.id ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-1" />}Testo</Button>
              {canEdit && <Button size="sm" variant="ghost" onClick={() => { setToken(''); setEditing(s); }}>Ndrysho</Button>}
            </div>
          </Card>
        ))}
      </div>
      {editing && (
        <Dialog open onOpenChange={(o) => !o && setEditing(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>{editing.id ? 'Ndrysho serverin' : 'Server i ri'}</DialogTitle><DialogDescription>Token-i ruhet i enkriptuar në server dhe lidhet me hostname-in + përdoruesin e këtij momenti: nëse ndryshon hostname-in, rifute token-in. Krijo një token me privilegje të kufizuara (jo root i plotë): create-acct, suspend-acct, kill-acct, passwd, list-accts, list-pkgs, create-user-session, basic-whm-functions. Lëre bosh për të mos e ndryshuar.</DialogDescription></DialogHeader>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1 col-span-2"><Label>Emri</Label><Input value={editing.name || ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></div>
              <div className="space-y-1 col-span-2"><Label>Hostname WHM</Label><Input placeholder="srv1.shembull.al" value={editing.hostname || ''} onChange={(e) => setEditing({ ...editing, hostname: e.target.value })} /></div>
              <div className="space-y-1"><Label>Porti</Label><Input type="number" value={editing.port ?? 2087} onChange={(e) => setEditing({ ...editing, port: Number(e.target.value) })} /></div>
              <div className="space-y-1"><Label>Përdoruesi WHM</Label><Input value={editing.username || 'root'} onChange={(e) => setEditing({ ...editing, username: e.target.value })} /></div>
              <div className="space-y-1 col-span-2"><Label>API token {editing.hasApiToken && <span className="text-xs text-emerald-700">(i ruajtur)</span>}</Label><Input type="password" placeholder={editing.hasApiToken ? '••••••••' : 'nga WHM → Development → Manage API Tokens'} value={token} onChange={(e) => setToken(e.target.value)} /></div>
              <div className="space-y-1 col-span-2"><Label>Nameservers (një për rresht)</Label><Textarea rows={2} value={(editing.nameservers || []).join('\n')} onChange={(e) => setEditing({ ...editing, nameservers: e.target.value.split('\n') })} /></div>
              <div className="space-y-1"><Label>IP publike</Label><Input value={editing.ipAddress || ''} onChange={(e) => setEditing({ ...editing, ipAddress: e.target.value })} /></div>
              <div className="space-y-1"><Label>Statusi</Label><Select value={editing.status || 'Active'} onValueChange={(v) => setEditing({ ...editing, status: v as any })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Active">Aktiv</SelectItem><SelectItem value="Inactive">Joaktiv</SelectItem></SelectContent></Select></div>
            </div>
            <DialogFooter><Button variant="outline" onClick={() => setEditing(null)}>Anulo</Button><Button onClick={save}>Ruaj</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
};

// ── Settings ───────────────────────────────────────────────────────────────────

const SettingsTab: React.FC<{ teamId: string | null; settings: ReturnType<typeof useTeamSettingsData>; isAdmin: boolean }> = ({ teamId, settings, isAdmin }) => {
  const { toast } = useToast();
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [lc, setLc] = useState(normalizeLifecycleConfig(settings?.hostingLifecycle));
  const [ns, setNs] = useState((settings?.hostingDefaultNameservers || []).join('\n'));
  const [dynCur, setDynCur] = useState(settings?.dynadotCurrency || 'USD');
  const [marginPct, setMarginPct] = useState(settings?.hostingTldMarginPct ?? 40);
  const [backupDays, setBackupDays] = useState(settings?.hostingBackupIntervalDays ?? 7);
  useEffect(() => { setLc(normalizeLifecycleConfig(settings?.hostingLifecycle)); setNs((settings?.hostingDefaultNameservers || []).join('\n')); setDynCur(settings?.dynadotCurrency || 'USD'); setMarginPct(settings?.hostingTldMarginPct ?? 40); setBackupDays(settings?.hostingBackupIntervalDays ?? 7); }, [settings?.hostingLifecycle, settings?.hostingDefaultNameservers, settings?.dynadotCurrency, settings?.hostingTldMarginPct, settings?.hostingBackupIntervalDays]);
  const run = async (label: string, fn: () => Promise<void>) => { setBusy(label); try { await fn(); } catch (e) { toast({ title: 'Gabim', description: (e as Error).message, variant: 'destructive' }); } finally { setBusy(null); } };
  if (!teamId) return <Card className="p-6 text-muted-foreground">Nuk u gjet ekipi aktiv.</Card>;
  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <Card className="p-4 space-y-3">
        <h3 className="font-semibold flex items-center gap-2"><Globe className="w-4 h-4" />Regjistruesi — Dynadot</h3>
        <p className="text-xs text-muted-foreground">Çelësi nga Dynadot → Tools → API. Dynadot lejon vetëm IP-të e whitelist-uara: shto IP-në e VPS-së (relay-i) te "API IP whitelist". {settings?.hasDynadotApiKey && <span className="text-emerald-700"><Shield className="w-3 h-3 inline" /> Çelës i ruajtur në kasafortë — lëre bosh për të mos e ndryshuar.</span>}</p>
        <Input type="password" placeholder={settings?.hasDynadotApiKey ? '••••••••' : 'Dynadot API key'} value={key} onChange={(e) => setKey(e.target.value)} disabled={!isAdmin} />
        <div className="flex items-center gap-2">
          <Label className="text-xs">Monedha e llogarisë Dynadot</Label>
          <Select value={dynCur} onValueChange={setDynCur}><SelectTrigger className="w-28"><SelectValue /></SelectTrigger><SelectContent>{['USD', 'EUR', 'GBP'].map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select>
        </div>
        <div className="flex gap-2">
          <Button size="sm" disabled={!isAdmin || busy === 'key'} onClick={() => run('key', async () => { await saveTeamSettings(teamId, { dynadotCurrency: dynCur }); if (key.trim()) { const r = await hostingApi<{ test: any }>('registrar.saveKey', { teamId, apiKey: key.trim() }); setKey(''); toast({ title: r.test?.ok ? `Dynadot OK (${r.test.username || ''})` : 'Çelësi u ruajt, por testi dështoi', description: r.test?.error || (r.test?.balances || []).map((b: any) => `${b.amount} ${b.currency}`).join(', '), variant: r.test?.ok ? undefined : 'destructive' }); } else toast({ title: 'U ruajt' }); })}>Ruaj</Button>
          <Button size="sm" variant="outline" disabled={!settings?.hasDynadotApiKey || busy === 'test'} onClick={() => run('test', async () => { const r = await hostingApi<any>('registrar.test', { teamId }); toast({ title: r.ok ? `Dynadot OK (${r.username || ''})` : 'Testi dështoi', description: r.error || (r.balances || []).map((b: any) => `balanca ${b.amount} ${b.currency}`).join(', '), variant: r.ok ? undefined : 'destructive' }); })}>Testo</Button>
        </div>
      </Card>
      <Card className="p-4 space-y-3">
        <h3 className="font-semibold flex items-center gap-2"><Clock className="w-4 h-4" />Cikli i jetës</h3>
        <div className="grid grid-cols-2 gap-3 text-sm">
          {([['invoiceDaysBefore', 'Fatura rinovimi, ditë para afatit'], ['suspendDaysAfter', 'Pezullim, ditë pas afatit të papaguar'], ['terminateDaysAfter', 'Terminim, ditë pas afatit (0 = kurrë)'], ['domainInvoiceDaysBefore', 'Fatura domain, ditë para skadencës'], ['domainGraceDays', 'Tolerancë domain pas skadencës, ditë']] as const).map(([k, label]) => (
            <div key={k} className="space-y-1"><Label className="text-xs">{label}</Label><Input type="number" min={0} value={lc[k]} onChange={(e) => setLc({ ...lc, [k]: Number(e.target.value) })} disabled={!isAdmin} /></div>
          ))}
        </div>
        <div className="space-y-1"><Label className="text-xs">Nameservers default për domain-et e reja (një për rresht)</Label><Textarea rows={2} value={ns} onChange={(e) => setNs(e.target.value)} disabled={!isAdmin} /></div>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="space-y-1"><Label className="text-xs">Marzhi % mbi koston Dynadot (propozimi i çmimeve TLD)</Label><Input type="number" min={0} max={500} value={marginPct} onChange={(e) => setMarginPct(Number(e.target.value))} disabled={!isAdmin} /></div>
          <div className="space-y-1"><Label className="text-xs">Backup automatik çdo N ditë (0 = fikur)</Label><Input type="number" min={0} max={90} value={backupDays} onChange={(e) => setBackupDays(Number(e.target.value))} disabled={!isAdmin} /></div>
        </div>
        <Button size="sm" disabled={!isAdmin || busy === 'lc'} onClick={() => run('lc', async () => { await saveTeamSettings(teamId, { hostingLifecycle: normalizeLifecycleConfig(lc), hostingDefaultNameservers: ns.split(/\s+/).filter(Boolean), hostingTldMarginPct: Math.max(0, marginPct), hostingBackupIntervalDays: Math.max(0, backupDays) }); toast({ title: 'Cilësimet u ruajtën' }); })}>Ruaj</Button>
        {settings?.hostingExpiryReport?.at && <p className="text-xs text-muted-foreground">Raporti javor i fundit ({fmtDate(settings.hostingExpiryReport.at)}): {settings.hostingExpiryReport.domains30 || 0} domain-e ≤30 ditë, {settings.hostingExpiryReport.domains60 || 0} 31–60 ditë, {settings.hostingExpiryReport.subsDue30 || 0} hosting me afat ≤30 ditë, {settings.hostingExpiryReport.unpaid || 0} të papaguara, {settings.hostingExpiryReport.suspended || 0} të pezulluara. Dërgohet çdo të hënë 08:00 te menaxherët.</p>}
        <p className="text-xs text-muted-foreground">Default: faturë {DEFAULT_LIFECYCLE.invoiceDaysBefore} ditë para, pezullim {DEFAULT_LIFECYCLE.suspendDaysAfter} ditë pas, terminim {DEFAULT_LIFECYCLE.terminateDaysAfter} = i fikur (fshirja e llogarisë është opt-in; kur ndizet, bëhet backup pkgacct para fshirjes). Cikli ekzekutohet çdo orë nga VPS (`hosting-lifecycle`); sinkronizimi me serverët dhe Dynadot çdo 6 orë (`hosting-sync`).</p>
        {settings?.hostingLastRun && (
          <div className="text-xs text-muted-foreground border-t pt-2">
            Ekzekutimi i fundit {fmtDate(settings.hostingLastRun.at)}: {settings.hostingLastRun.invoiced || 0} fatura, {settings.hostingLastRun.suspended || 0} pezullime, {settings.hostingLastRun.terminated || 0} terminime, {settings.hostingLastRun.renewed || 0} rinovime, {settings.hostingLastRun.provisioned || 0} aktivizime, {settings.hostingLastRun.errors || 0} gabime.
            {settings.hostingLastRun.blocked && Object.keys(settings.hostingLastRun.blocked).length > 0 && <div className="mt-1">Të bllokuara: {Object.entries(settings.hostingLastRun.blocked).map(([k, v]) => `${(SUBSCRIPTION_BLOCK_LABELS as any)[k] || (DOMAIN_BLOCK_LABELS as any)[k] || k} ×${v}`).join(', ')}</div>}
          </div>
        )}
      </Card>
    </div>
  );
};

// ── Events ─────────────────────────────────────────────────────────────────────

const EventsTab: React.FC<{ events: HostingEvent[] }> = ({ events }) => {
  if (!events.length) return <Card className="p-8 text-center text-muted-foreground">Asnjë aktivitet ende.</Card>;
  return (
    <Card className="divide-y">
      {events.map((e) => (
        <div key={e.id} className="p-3 flex items-start gap-3 text-sm">
          {e.ok ? <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" /> : <AlertTriangle className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />}
          <div className="min-w-0 flex-1"><p className="truncate"><span className="font-mono text-xs text-muted-foreground mr-2">{e.type}</span>{e.message}</p></div>
          <span className="text-xs text-muted-foreground whitespace-nowrap">{toDate(e.createdAt)?.toLocaleString('sq-AL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) || ''}</span>
        </div>
      ))}
    </Card>
  );
};

// ── Manual add (existing accounts / domains not born from an order) ────────────
// Migration path for anything that is NOT a WHMCS mirror row: an account that
// already lives on the server, or a domain at Dynadot / an external registrar (.al).
// Nothing is provisioned: the record is created as already provisioned, and the
// lifecycle invoices its NEXT due date normally (the current period is assumed paid
// up to that date — the form asks for exactly that date).

const ManualSubscriptionDialog: React.FC<{ open: boolean; onOpenChange: (o: boolean) => void; products: HostingProduct[]; servers: HostingServer[] }> = ({ open, onOpenChange, products, servers }) => {
  const { toast } = useToast();
  const { data: customers } = useCollection<Customer>('customers', { skip: !open });
  const [custQ, setCustQ] = useState('');
  const [f, setF] = useState({ customerId: '', productId: '', serverId: '', cpanelUsername: '', domain: '', cycle: 'monthly' as BillingCycle, amount: '', currency: 'EUR' as 'EUR' | 'ALL', nextDue: '', status: 'Active' as 'Active' | 'Suspended' });
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!open) setF({ customerId: '', productId: '', serverId: '', cpanelUsername: '', domain: '', cycle: 'monthly', amount: '', currency: 'EUR', nextDue: '', status: 'Active' }); }, [open]);
  const product = products.find((p) => p.id === f.productId);
  const pickProduct = (id: string) => {
    const p = products.find((x) => x.id === id);
    const cycles = availableCycles(p?.pricing as any);
    const c = cycles.includes(f.cycle) ? f.cycle : cycles[0] || 'monthly';
    setF({ ...f, productId: id, serverId: p?.serverId || f.serverId, cycle: c, currency: (p?.currency as any) || f.currency, amount: p?.pricing?.[c]?.price != null ? String(p.pricing[c]!.price) : f.amount });
  };
  const save = async () => {
    const dom = parseDomain(f.domain);
    const due = f.nextDue ? new Date(`${f.nextDue}T12:00:00Z`) : null;
    if (!f.customerId || !f.serverId || !f.cpanelUsername.trim() || !dom || !due || !(Number(f.amount) >= 0)) { toast({ title: 'Plotëso klientin, serverin, username-in, domain-in, afatin dhe çmimin', variant: 'destructive' }); return; }
    setBusy(true);
    try {
      // Server-side: the account must exist in WHM and serve exactly this domain.
      await hostingApi('sub.addExisting', {
        customerId: f.customerId, productId: f.productId || null, serverId: f.serverId, cpanelUsername: f.cpanelUsername,
        domain: dom.name, cycle: f.cycle, amount: Number(f.amount), currency: f.currency, nextDueDate: due.toISOString(), status: f.status,
      });
      toast({ title: 'Llogaria u shtua', description: `U verifikua në WHM. Fatura e parë e FivoCRM del ${DEFAULT_LIFECYCLE.invoiceDaysBefore} ditë para ${due.toLocaleDateString('sq-AL')}.` });
      onOpenChange(false);
    } catch (e) { toast({ title: 'Gabim', description: (e as Error).message, variant: 'destructive' }); }
    finally { setBusy(false); }
  };
  const filtered = (customers || []).filter((c) => !custQ || `${c.name} ${c.email} ${(c as any).companyName || ''}`.toLowerCase().includes(custQ.toLowerCase())).slice(0, 30);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Shto llogari ekzistuese</DialogTitle><DialogDescription>Për llogari që janë tashmë në server (nuk krijohet asgjë në WHM; serveri verifikon që llogaria ekziston dhe i përket këtij domain-i). Shkruaj datën kur klienti duhet të paguajë herën tjetër — fatura del automatikisht para saj.</DialogDescription></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1 col-span-2"><Label>Klienti</Label><Input placeholder="Kërko…" value={custQ} onChange={(e) => setCustQ(e.target.value)} /><Select value={f.customerId} onValueChange={(v) => setF({ ...f, customerId: v })}><SelectTrigger><SelectValue placeholder="Zgjidh klientin" /></SelectTrigger><SelectContent>{filtered.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}{c.email ? ` · ${c.email}` : ''}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-1"><Label>Paketa (opsionale)</Label><Select value={f.productId} onValueChange={pickProduct}><SelectTrigger><SelectValue placeholder="—" /></SelectTrigger><SelectContent>{products.filter((p) => p.status === 'Active').map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-1"><Label>Serveri</Label><Select value={f.serverId} onValueChange={(v) => setF({ ...f, serverId: v })}><SelectTrigger><SelectValue placeholder="Serveri" /></SelectTrigger><SelectContent>{servers.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-1"><Label>Domain-i kryesor</Label><Input placeholder="firma.com" value={f.domain} onChange={(e) => setF({ ...f, domain: e.target.value })} /></div>
          <div className="space-y-1"><Label>cPanel username</Label><Input value={f.cpanelUsername} onChange={(e) => setF({ ...f, cpanelUsername: e.target.value })} /></div>
          <div className="space-y-1"><Label>Cikli</Label><Select value={f.cycle} onValueChange={(v) => setF({ ...f, cycle: v as BillingCycle, amount: product?.pricing?.[v as BillingCycle]?.price != null ? String(product.pricing[v as BillingCycle]!.price) : f.amount })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{BILLING_CYCLES.map((c) => <SelectItem key={c} value={c}>{CYCLE_LABELS[c]}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-1"><Label>Çmimi për cikël</Label><div className="flex gap-2"><Input type="number" step="0.01" min={0} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /><Select value={f.currency} onValueChange={(v) => setF({ ...f, currency: v as any })}><SelectTrigger className="w-24"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="EUR">EUR</SelectItem><SelectItem value="ALL">ALL</SelectItem></SelectContent></Select></div></div>
          <div className="space-y-1"><Label>Afati i pagesës së radhës</Label><Input type="date" value={f.nextDue} onChange={(e) => setF({ ...f, nextDue: e.target.value })} /></div>
          <div className="space-y-1"><Label>Statusi tani</Label><Select value={f.status} onValueChange={(v) => setF({ ...f, status: v as any })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Active">Aktiv</SelectItem><SelectItem value="Suspended">I pezulluar</SelectItem></SelectContent></Select></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Anulo</Button><Button onClick={save} disabled={busy}>{busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}Shto</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const ManualDomainDialog: React.FC<{ open: boolean; onOpenChange: (o: boolean) => void }> = ({ open, onOpenChange }) => {
  const { toast } = useToast();
  const { data: customers } = useCollection<Customer>('customers', { skip: !open });
  const { data: tlds } = useCollection<DomainTld>('domainTlds', { skip: !open });
  const [custQ, setCustQ] = useState('');
  const [f, setF] = useState({ customerId: '', domainName: '', registrar: 'dynadot' as 'dynadot' | 'manual', registrarName: '', expiry: '', years: '1', amount: '', currency: 'EUR' as 'EUR' | 'ALL', autoRenew: true, nameservers: '' });
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!open) setF({ customerId: '', domainName: '', registrar: 'dynadot', registrarName: '', expiry: '', years: '1', amount: '', currency: 'EUR', autoRenew: true, nameservers: '' }); }, [open]);
  const onDomain = (v: string) => {
    const p = parseDomain(v);
    const t = p ? (tlds || []).find((x) => x.tld === p.tld) : undefined;
    setF({ ...f, domainName: v, ...(t && !f.amount ? { amount: String(t.renewPrice), currency: t.currency } : {}) });
  };
  const save = async () => {
    const dom = parseDomain(f.domainName);
    const exp = f.expiry ? new Date(`${f.expiry}T12:00:00Z`) : null;
    if (!f.customerId || !dom || (f.registrar === 'manual' && !exp) || !(Number(f.amount) >= 0)) { toast({ title: 'Plotëso klientin, domain-in, skadencën dhe çmimin e rinovimit', variant: 'destructive' }); return; }
    setBusy(true);
    try {
      // Server-side: a Dynadot domain must be in OUR account (facts are read from it).
      await hostingApi('domain.addExisting', {
        customerId: f.customerId, domainName: dom.name, registrar: f.registrar === 'manual' ? (f.registrarName.trim() || 'manual') : 'dynadot',
        expiryDate: exp ? exp.toISOString() : null, years: Math.max(1, Number(f.years) || 1), amount: Number(f.amount), currency: f.currency,
        autoRenew: f.autoRenew, nameservers: f.nameservers.split(/\s+/).filter(Boolean),
      });
      toast({ title: 'Domain-i u shtua', description: f.registrar === 'dynadot' ? 'U verifikua në Dynadot; skadenca dhe NS u lexuan nga regjistruesi.' : 'Rinovimi te regjistruesi i jashtëm bëhet me dorë; FivoCRM lëshon faturën dhe të njofton.' });
      onOpenChange(false);
    } catch (e) { toast({ title: 'Gabim', description: (e as Error).message, variant: 'destructive' }); }
    finally { setBusy(false); }
  };
  const filtered = (customers || []).filter((c) => !custQ || `${c.name} ${c.email} ${(c as any).companyName || ''}`.toLowerCase().includes(custQ.toLowerCase())).slice(0, 30);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Shto domain ekzistues</DialogTitle><DialogDescription>Për domain-e që janë tashmë të regjistruara: në llogarinë tuaj Dynadot (rinovohet automatikisht pas pagesës) ose te një regjistrues tjetër, p.sh. .al (FivoCRM lëshon faturën, rinovimin e bën stafi).</DialogDescription></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1 col-span-2"><Label>Klienti</Label><Input placeholder="Kërko…" value={custQ} onChange={(e) => setCustQ(e.target.value)} /><Select value={f.customerId} onValueChange={(v) => setF({ ...f, customerId: v })}><SelectTrigger><SelectValue placeholder="Zgjidh klientin" /></SelectTrigger><SelectContent>{filtered.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}{c.email ? ` · ${c.email}` : ''}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-1 col-span-2"><Label>Domain</Label><Input placeholder="firma.al" value={f.domainName} onChange={(e) => onDomain(e.target.value)} /></div>
          <div className="space-y-1"><Label>Regjistruesi</Label><Select value={f.registrar} onValueChange={(v) => setF({ ...f, registrar: v as any })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="dynadot">Dynadot (llogaria jonë)</SelectItem><SelectItem value="manual">Tjetër (manual)</SelectItem></SelectContent></Select></div>
          {f.registrar === 'manual' ? <div className="space-y-1"><Label>Emri i regjistruesit</Label><Input placeholder="p.sh. AKEP / Albtelecom" value={f.registrarName} onChange={(e) => setF({ ...f, registrarName: e.target.value })} /></div> : <div />}
          <div className="space-y-1"><Label>Skadon më {f.registrar === 'dynadot' && <span className="text-xs text-muted-foreground">(lexohet nga Dynadot)</span>}</Label><Input type="date" value={f.expiry} onChange={(e) => setF({ ...f, expiry: e.target.value })} /></div>
          <div className="space-y-1"><Label>Vite për rinovim</Label><Select value={f.years} onValueChange={(v) => setF({ ...f, years: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{[1, 2, 3, 5].map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-1"><Label>Çmimi i rinovimit (total)</Label><div className="flex gap-2"><Input type="number" step="0.01" min={0} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /><Select value={f.currency} onValueChange={(v) => setF({ ...f, currency: v as any })}><SelectTrigger className="w-24"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="EUR">EUR</SelectItem><SelectItem value="ALL">ALL</SelectItem></SelectContent></Select></div></div>
          <label className="flex items-center gap-2 text-sm"><Switch checked={f.autoRenew} onCheckedChange={(v) => setF({ ...f, autoRenew: v })} />Rinovim automatik (me faturë)</label>
          <div className="space-y-1 col-span-2"><Label>Nameservers (opsionale, një për rresht)</Label><Textarea rows={2} value={f.nameservers} onChange={(e) => setF({ ...f, nameservers: e.target.value })} /></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Anulo</Button><Button onClick={save} disabled={busy}>{busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}Shto</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// ── Coupons ────────────────────────────────────────────────────────────────────

const CouponsTab: React.FC<{ coupons: HostingCoupon[]; canEdit: boolean }> = ({ coupons, canEdit }) => {
  const { toast } = useToast();
  const mutation = useMutation<HostingCoupon>('hostingCoupons');
  const [editing, setEditing] = useState<Partial<HostingCoupon> | null>(null);
  const removeEditing = () => editing?.id && removeWithConfirm(`Fshi kuponin ${editing.code || ''}? Porositë që e kanë përdorur e ruajnë zbritjen, por kodi nuk pranohet më.`, () => mutation.remove(editing.id!), toast, () => setEditing(null));
  const save = async () => {
    if (!editing) return;
    const code = String(editing.code || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 32);
    if (!code || !(Number(editing.value) > 0)) { toast({ title: 'Kodi dhe vlera janë të detyrueshme', variant: 'destructive' }); return; }
    if (coupons.some((c) => c.code === code && c.id !== editing.id)) { toast({ title: 'Ky kod ekziston', variant: 'destructive' }); return; }
    const payload = {
      code, type: editing.type === 'fixed' ? 'fixed' : 'percent', value: Number(editing.value), currency: editing.type === 'fixed' ? cur(editing.currency) : null,
      appliesTo: editing.appliesTo || 'all', status: editing.status || 'Active',
      validFrom: editing.validFrom || null, validUntil: editing.validUntil || null,
      maxUses: editing.maxUses != null && editing.maxUses !== ('' as any) ? Number(editing.maxUses) : null, minTotal: editing.minTotal != null && editing.minTotal !== ('' as any) ? Number(editing.minTotal) : null,
      note: editing.note || '', ...(editing.id ? {} : { uses: 0 }),
    };
    try { if (editing.id) await mutation.update(editing.id, payload as any); else await mutation.create(payload as any); toast({ title: 'Kuponi u ruajt' }); setEditing(null); }
    catch (e) { toast({ title: 'Gabim', description: (e as Error).message, variant: 'destructive' }); }
  };
  const dateInput = (d: unknown) => { const x = toDate(d); return x ? x.toISOString().slice(0, 10) : ''; };
  return (
    <div className="space-y-3">
      {canEdit && <Button onClick={() => setEditing({ type: 'percent', appliesTo: 'all', status: 'Active', currency: 'EUR' })}><Plus className="w-4 h-4 mr-2" />Kupon i ri</Button>}
      {!coupons.length && <Card className="p-8 text-center text-muted-foreground">Asnjë kupon. Kuponi vlen për faturën e parë të një porosie (hosting dhe/ose domain); klienti e shkruan te shporta në portal.</Card>}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {coupons.map((c) => (
          <Card key={c.id} className="p-4 space-y-1 cursor-pointer hover:border-primary/40" onClick={() => canEdit && setEditing(c)}>
            <div className="flex items-center justify-between"><span className="font-mono font-semibold">{c.code}</span><div className="flex gap-1">{c.status === 'Archived' && <Badge variant="outline">Arkiv</Badge>}{c.maxUses != null && (c.uses || 0) >= c.maxUses && <Badge className="bg-muted text-muted-foreground border-0 text-xs">i shteruar</Badge>}</div></div>
            <p className="text-sm">{c.type === 'percent' ? `${c.value}%` : formatCurrency(c.value, c.currency || 'EUR')} zbritje · {c.appliesTo === 'hosting' ? 'vetëm hosting' : c.appliesTo === 'domains' ? 'vetëm domain-e' : 'gjithë porosia'}</p>
            <p className="text-xs text-muted-foreground">Përdorur {c.uses || 0}{c.maxUses != null ? `/${c.maxUses}` : ''}{c.validUntil ? ` · deri ${fmtDate(c.validUntil)}` : ''}{c.minTotal ? ` · min ${c.minTotal}` : ''}</p>
            {c.note && <p className="text-xs text-muted-foreground truncate">{c.note}</p>}
          </Card>
        ))}
      </div>
      {editing && (
        <Dialog open onOpenChange={(o) => !o && setEditing(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>{editing.id ? `Ndrysho ${editing.code}` : 'Kupon i ri'}</DialogTitle><DialogDescription>Vlen vetëm për faturën e parë të porosisë; rinovimet faturohen me çmim të plotë.</DialogDescription></DialogHeader>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label>Kodi</Label><Input className="uppercase" value={editing.code || ''} onChange={(e) => setEditing({ ...editing, code: e.target.value.toUpperCase() })} disabled={!!editing.id} /></div>
              <div className="space-y-1"><Label>Tipi</Label><Select value={editing.type || 'percent'} onValueChange={(v) => setEditing({ ...editing, type: v as any })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="percent">Përqindje</SelectItem><SelectItem value="fixed">Shumë fikse</SelectItem></SelectContent></Select></div>
              <div className="space-y-1"><Label>{editing.type === 'fixed' ? 'Shuma' : 'Përqindja'}</Label><Input type="number" min={0} step="0.01" value={editing.value ?? ''} onChange={(e) => setEditing({ ...editing, value: Number(e.target.value) })} /></div>
              {editing.type === 'fixed' ? <div className="space-y-1"><Label>Monedha</Label><Select value={editing.currency || 'EUR'} onValueChange={(v) => setEditing({ ...editing, currency: v as any })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="EUR">EUR</SelectItem><SelectItem value="ALL">ALL</SelectItem></SelectContent></Select></div> : <div />}
              <div className="space-y-1"><Label>Vlen për</Label><Select value={editing.appliesTo || 'all'} onValueChange={(v) => setEditing({ ...editing, appliesTo: v as any })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Gjithë porosinë</SelectItem><SelectItem value="hosting">Vetëm hosting</SelectItem><SelectItem value="domains">Vetëm domain-e</SelectItem></SelectContent></Select></div>
              <div className="space-y-1"><Label>Statusi</Label><Select value={editing.status || 'Active'} onValueChange={(v) => setEditing({ ...editing, status: v as any })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Active">Aktiv</SelectItem><SelectItem value="Archived">Arkiv</SelectItem></SelectContent></Select></div>
              <div className="space-y-1"><Label>Nga</Label><Input type="date" value={dateInput(editing.validFrom)} onChange={(e) => setEditing({ ...editing, validFrom: e.target.value ? new Date(`${e.target.value}T00:00:00Z`) : null })} /></div>
              <div className="space-y-1"><Label>Deri</Label><Input type="date" value={dateInput(editing.validUntil)} onChange={(e) => setEditing({ ...editing, validUntil: e.target.value ? new Date(`${e.target.value}T23:59:59Z`) : null })} /></div>
              <div className="space-y-1"><Label>Max përdorime</Label><Input type="number" min={0} value={editing.maxUses ?? ''} onChange={(e) => setEditing({ ...editing, maxUses: e.target.value === '' ? null : Number(e.target.value) })} /></div>
              <div className="space-y-1"><Label>Total minimal porosie</Label><Input type="number" min={0} step="0.01" value={editing.minTotal ?? ''} onChange={(e) => setEditing({ ...editing, minTotal: e.target.value === '' ? null : Number(e.target.value) })} /></div>
              <div className="space-y-1 col-span-2"><Label>Shënim (i brendshëm)</Label><Input value={editing.note || ''} onChange={(e) => setEditing({ ...editing, note: e.target.value })} /></div>
            </div>
            <DialogFooter>
              {editing.id && <Button variant="ghost" className="text-red-700 mr-auto" onClick={removeEditing}>Fshi</Button>}
              <Button variant="outline" onClick={() => setEditing(null)}>Anulo</Button><Button onClick={save}>Ruaj</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
};
