/**
 * Portal — "Hosting & Domain-e": the client's hosting accounts and domains, plus a
 * small store (search a domain, pick a package, order → invoice → Stripe).
 *
 * Every read is constrained by the client's own keys (`customerId == cid`, or
 * `businessId == mine && portalVisible == true` for the catalog) — the rules deny
 * anything broader. Every write goes through POST /api/hosting, which re-checks
 * ownership; nothing here touches Firestore directly.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Globe, Server, ShoppingCart, ExternalLink, KeyRound, Search, Loader2, Plus, Trash2, CheckCircle2, AlertTriangle, Clock, Activity } from 'lucide-react';
import { Card } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Textarea } from '../../components/ui/textarea';
import { Switch } from '../../components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { CardGridSkeleton } from './PortalSkeletons';
import { useClientPortal } from '../../hooks/useClientPortal';
import { useCollection } from '../../hooks/useFirestore';
import { useToast } from '../../hooks/use-toast';
import { formatCurrency, getTimestampMs } from '../../lib/utils';
import { hostingApi, checkDomains, type DomainCheckRow } from '../../lib/hosting/api';
import { CYCLE_LABELS, ORDER_ERROR_LABELS, availableCycles, daysBetween, parseDomain, priceOrder, type BillingCycle, type OrderLineInput, type TldPricing } from '../../lib/hosting/engine';
import type { Domain, DomainTld, HostingOrder, HostingProduct, Subscription } from '../../types';

const toDate = (v: unknown): Date | null => { const ms = getTimestampMs(v); return ms ? new Date(ms) : null; };
const fmtDate = (v: unknown) => { const d = toDate(v); return d ? d.toLocaleDateString('sq-AL') : '—'; };
const cur = (c: unknown): 'ALL' | 'EUR' => (c === 'EUR' ? 'EUR' : 'ALL');
const STATUS: Record<string, { label: string; cls: string }> = {
  Pending: { label: 'Në pritje', cls: 'bg-amber-100 text-amber-800' },
  Active: { label: 'Aktiv', cls: 'bg-emerald-100 text-emerald-800' },
  Suspended: { label: 'Pezulluar', cls: 'bg-orange-100 text-orange-800' },
  Terminated: { label: 'Terminuar', cls: 'bg-red-100 text-red-800' },
  Cancelled: { label: 'Anuluar', cls: 'bg-muted text-muted-foreground' },
  Grace: { label: 'Skaduar (tolerancë)', cls: 'bg-orange-100 text-orange-800' },
  Expired: { label: 'Skaduar', cls: 'bg-red-100 text-red-800' },
  Paid: { label: 'Paguar', cls: 'bg-blue-100 text-blue-800' },
  Provisioning: { label: 'Aktivizohet…', cls: 'bg-blue-100 text-blue-800' },
  Failed: { label: 'Në shqyrtim', cls: 'bg-orange-100 text-orange-800' },
};
const StatusBadge: React.FC<{ status?: string }> = ({ status }) => { const s = STATUS[status || ''] || { label: status || '—', cls: 'bg-muted text-muted-foreground' }; return <Badge className={`${s.cls} border-0`}>{s.label}</Badge>; };

const PortalHostingView: React.FC = () => {
  const { customerId, businessId } = useClientPortal();
  const { toast } = useToast();
  const navigate = useNavigate();

  const { data: subscriptions, loading: l1 } = useCollection<Subscription>('subscriptions', { skip: !customerId, where: [{ field: 'customerId', operator: '==', value: customerId || '' }], skipTeamFilter: true, skipBusinessFilter: true });
  const { data: domains, loading: l2 } = useCollection<Domain>('domains', { skip: !customerId, where: [{ field: 'customerId', operator: '==', value: customerId || '' }], skipTeamFilter: true, skipBusinessFilter: true });
  const { data: orders } = useCollection<HostingOrder>('hostingOrders', { skip: !customerId, where: [{ field: 'customerId', operator: '==', value: customerId || '' }], skipTeamFilter: true, skipBusinessFilter: true });
  const { data: products } = useCollection<HostingProduct>('hostingProducts', { skip: !businessId, where: [{ field: 'businessId', operator: '==', value: businessId || '' }, { field: 'portalVisible', operator: '==', value: true }], skipTeamFilter: true, skipBusinessFilter: true });
  const { data: tlds } = useCollection<DomainTld>('domainTlds', { skip: !businessId, where: [{ field: 'businessId', operator: '==', value: businessId || '' }, { field: 'portalVisible', operator: '==', value: true }], skipTeamFilter: true, skipBusinessFilter: true });

  const activeProducts = useMemo(() => (products || []).filter((p) => p.status === 'Active').sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)), [products]);
  const activeTlds = useMemo(() => (tlds || []).filter((t) => t.status === 'Active'), [tlds]);
  const canOrder = activeProducts.length > 0 || activeTlds.length > 0;
  const [orderOpen, setOrderOpen] = useState(false);
  const [selSub, setSelSub] = useState<Subscription | null>(null);
  const [selDom, setSelDom] = useState<Domain | null>(null);
  const liveSub = selSub ? (subscriptions || []).find((s) => s.id === selSub.id) || selSub : null;
  const liveDom = selDom ? (domains || []).find((d) => d.id === selDom.id) || selDom : null;
  const now = new Date();

  if (l1 || l2) return <CardGridSkeleton />;
  const subs = [...(subscriptions || [])].sort((a, b) => (getTimestampMs(b.createdAt) || 0) - (getTimestampMs(a.createdAt) || 0));
  const doms = [...(domains || [])].sort((a, b) => (getTimestampMs(a.expiryDate) || Infinity) - (getTimestampMs(b.expiryDate) || Infinity));
  const ords = [...(orders || [])].sort((a, b) => (getTimestampMs(b.createdAt) || 0) - (getTimestampMs(a.createdAt) || 0));

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div><h1 className="text-h2 text-foreground">Hosting & Domain-e</h1><p className="text-body text-muted-foreground mt-1">{subs.filter((s) => s.status === 'Active').length} llogari aktive · {doms.filter((d) => d.status === 'Active' || d.status === 'Grace').length} domain-e</p></div>
        {canOrder && <Button className="bg-primary text-primary-foreground" onClick={() => setOrderOpen(true)}><Plus className="w-4 h-4 mr-2" />Porosit hosting / domain</Button>}
      </div>

      <Tabs defaultValue={subs.length || !doms.length ? 'hosting' : 'domains'} className="space-y-4">
        <TabsList className="bg-muted w-full overflow-x-auto flex-nowrap justify-start">
          <TabsTrigger value="hosting" className="min-w-fit"><Server className="w-4 h-4 mr-2" />Hosting</TabsTrigger>
          <TabsTrigger value="domains" className="min-w-fit"><Globe className="w-4 h-4 mr-2" />Domain-et</TabsTrigger>
          <TabsTrigger value="orders" className="min-w-fit"><ShoppingCart className="w-4 h-4 mr-2" />Porositë</TabsTrigger>
        </TabsList>

        <TabsContent value="hosting" className="space-y-2">
          {!subs.length && <Card className="p-8 text-center text-muted-foreground">Nuk keni ende llogari hosting.{canOrder ? ' Porositni një paketë më sipër.' : ''}</Card>}
          {subs.map((s) => (
            <Card key={s.id} className="p-4 cursor-pointer hover:border-primary/40" onClick={() => setSelSub(s)}>
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                <div className="flex-1 min-w-0"><div className="flex items-center gap-2 flex-wrap"><span className="font-semibold truncate">{s.domain || s.productName}</span><StatusBadge status={s.status} />{s.cancelAtPeriodEnd && <Badge variant="outline" className="text-xs">anulohet në fund të periudhës</Badge>}</div><p className="text-sm text-muted-foreground">{s.productName}{s.cpanelUsername ? ` · ${s.cpanelUsername}` : ''}</p></div>
                <div className="text-sm sm:text-right"><p className="font-medium">{formatCurrency(s.recurringAmount || 0, cur(s.currency))} <span className="text-muted-foreground">/ {CYCLE_LABELS[s.billingCycle as BillingCycle]?.toLowerCase() || s.billingCycle || ''}</span></p><p className="text-xs text-muted-foreground"><Clock className="w-3 h-3 inline mr-1" />rinovohet {fmtDate(s.nextDueDate)}</p></div>
              </div>
              {s.status === 'Suspended' && <p className="text-xs text-orange-700 mt-2 flex items-center gap-1"><AlertTriangle className="w-3 h-3" />Llogaria është e pezulluar{s.suspendReason === 'non-payment' ? ' për mospagesë — paguani faturën për ta riaktivizuar.' : '.'} <Link to="/portal/invoices" className="underline">Faturat</Link></p>}
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="domains" className="space-y-2">
          {!doms.length && <Card className="p-8 text-center text-muted-foreground">Nuk keni ende domain-e.</Card>}
          {doms.map((d) => { const exp = toDate(d.expiryDate); const days = exp ? daysBetween(now, exp) : null; return (
            <Card key={d.id} className="p-4 cursor-pointer hover:border-primary/40" onClick={() => setSelDom(d)}>
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                <div className="flex-1 min-w-0"><div className="flex items-center gap-2 flex-wrap"><span className="font-semibold">{d.domainName}</span><StatusBadge status={d.status} />{d.autoRenew === false && <Badge variant="outline" className="text-xs">pa rinovim automatik</Badge>}</div><p className="text-sm text-muted-foreground truncate">{d.nameservers?.length ? d.nameservers.join(', ') : 'nameservers: —'}</p></div>
                <div className="text-sm sm:text-right"><p className="font-medium">{formatCurrency(d.recurringAmount || 0, cur(d.currency))} <span className="text-muted-foreground">/ {d.years || 1} vit</span></p><p className={`text-xs ${days !== null && days <= 30 ? 'text-orange-600' : 'text-muted-foreground'}`}>skadon {fmtDate(d.expiryDate)}{days !== null && days >= 0 ? ` (${days} ditë)` : ''}</p></div>
              </div>
            </Card>
          ); })}
        </TabsContent>

        <TabsContent value="orders" className="space-y-2">
          {!ords.length && <Card className="p-8 text-center text-muted-foreground">Asnjë porosi ende.</Card>}
          {ords.map((o) => (
            <Card key={o.id} className="p-4">
              <div className="flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-4">
                <div className="flex-1 min-w-0"><div className="flex items-center gap-2 flex-wrap"><span className="font-semibold">{o.orderNumber}</span><StatusBadge status={o.status} /></div><p className="text-xs text-muted-foreground">{fmtDate(o.createdAt)}</p>
                  <ul className="text-sm mt-1 space-y-0.5">{(o.lines || []).map((l, i) => <li key={i} className="flex items-center gap-2">{l.provisionStatus === 'provisioned' ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> : <Clock className="w-3.5 h-3.5 text-muted-foreground" />}<span className="truncate">{l.description}</span><span className="text-muted-foreground ml-auto">{formatCurrency(l.total, l.currency)}</span></li>)}</ul></div>
                <div className="sm:text-right space-y-1"><p className="font-semibold">{formatCurrency(o.total, o.currency)}</p>{o.status === 'Pending' && o.invoiceId && <Button size="sm" onClick={() => navigate(`/portal/invoices?invoice=${o.invoiceId}`)}>Paguaj faturën</Button>}</div>
              </div>
            </Card>
          ))}
        </TabsContent>
      </Tabs>

      {liveSub && <PortalSubscriptionDialog sub={liveSub} onClose={() => setSelSub(null)} />}
      {liveDom && <PortalDomainDialog dom={liveDom} onClose={() => setSelDom(null)} />}
      <PortalOrderDialog open={orderOpen} onOpenChange={setOrderOpen} products={activeProducts} tlds={activeTlds} onCreated={(invoiceId) => { setOrderOpen(false); if (invoiceId) navigate(`/portal/invoices?invoice=${invoiceId}`); else toast({ title: 'Porosia u aktivizua' }); }} />
    </div>
  );
};

export default PortalHostingView;

const PortalSubscriptionDialog: React.FC<{ sub: Subscription; onClose: () => void }> = ({ sub, onClose }) => {
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [usage, setUsage] = useState<any>(null);
  const [password, setPassword] = useState<string | null>(null);
  const isOurs = sub.source === 'fivocrm';
  const run = async (k: string, fn: () => Promise<void>) => { setBusy(k); try { await fn(); } catch (e) { toast({ title: 'Gabim', description: (e as Error).message, variant: 'destructive' }); } finally { setBusy(null); } };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle className="flex items-center gap-2">{sub.domain || sub.productName} <StatusBadge status={sub.status} /></DialogTitle><DialogDescription>{sub.productName} · {formatCurrency(sub.recurringAmount || 0, cur(sub.currency))} / {CYCLE_LABELS[sub.billingCycle as BillingCycle]?.toLowerCase() || sub.billingCycle} · rinovohet {fmtDate(sub.nextDueDate)}</DialogDescription></DialogHeader>
        {sub.cpanelUsername && <p className="text-sm">Përdoruesi cPanel: <code className="font-mono">{sub.cpanelUsername}</code></p>}
        {isOurs ? (
          <>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={sub.status !== 'Active' || !!busy} onClick={() => run('sso', async () => { const r = await hostingApi<{ url: string }>('sub.sso', { subscriptionId: sub.id }); window.open(r.url, '_blank', 'noopener'); })}>{busy === 'sso' ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <ExternalLink className="w-4 h-4 mr-1" />}Hyr në cPanel</Button>
              <Button size="sm" variant="outline" disabled={!!busy || !sub.cpanelUsername} onClick={() => run('usage', async () => { const r = await hostingApi<{ usage: any }>('sub.usage', { subscriptionId: sub.id }); setUsage(r.usage || { missing: true }); })}><Activity className="w-4 h-4 mr-1" />Përdorimi i diskut</Button>
              <Button size="sm" variant="outline" disabled={sub.status !== 'Active' || !!busy} onClick={() => run('pw', async () => { const r = await hostingApi<{ password: string }>('sub.resetPassword', { subscriptionId: sub.id }); setPassword(r.password); })}><KeyRound className="w-4 h-4 mr-1" />Fjalëkalim i ri</Button>
            </div>
            {usage && <Card className="p-3 text-sm">{usage.missing ? 'Nuk u gjetën të dhëna.' : <>Disk: <strong>{usage.diskUsedMb ?? '?'} MB</strong> nga {usage.diskLimitMb ?? '∞'} MB</>}</Card>}
            {password && <Card className="p-3 text-sm bg-amber-50 border-amber-200">Fjalëkalimi i ri (ruajeni, shfaqet vetëm një herë): <code className="font-mono select-all">{password}</code></Card>}
            {sub.status !== 'Terminated' && sub.status !== 'Cancelled' && (
              <label className="flex items-center justify-between gap-2 text-sm pt-2 border-t"><span>Anulo në fund të periudhës aktuale<br /><span className="text-xs text-muted-foreground">Nuk lëshohet faturë tjetër; llogaria fshihet më {fmtDate(sub.nextDueDate)}.</span></span><Switch checked={!!sub.cancelAtPeriodEnd} disabled={!!busy} onCheckedChange={(v) => run('cancel', async () => { await hostingApi('sub.cancelAtPeriodEnd', { subscriptionId: sub.id, value: v }); toast({ title: v ? 'Kërkesa e anulimit u regjistrua' : 'Kërkesa e anulimit u tërhoq' }); })} /></label>
            )}
          </>
        ) : <p className="text-sm text-muted-foreground">Kjo llogari menaxhohet nga sistemi ynë i vjetër i faturimit. Për ndryshime, na kontaktoni nga chat-i.</p>}
      </DialogContent>
    </Dialog>
  );
};

const PortalDomainDialog: React.FC<{ dom: Domain; onClose: () => void }> = ({ dom, onClose }) => {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [ns, setNs] = useState((dom.nameservers || []).join('\n'));
  const [auth, setAuth] = useState<string | null>(null);
  const isOurs = dom.source === 'fivocrm' && dom.registrar === 'dynadot';
  const run = async (fn: () => Promise<void>) => { setBusy(true); try { await fn(); } catch (e) { toast({ title: 'Gabim', description: (e as Error).message, variant: 'destructive' }); } finally { setBusy(false); } };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle className="flex items-center gap-2">{dom.domainName} <StatusBadge status={dom.status} /></DialogTitle><DialogDescription>Regjistruar {fmtDate(dom.registrationDate)} · skadon {fmtDate(dom.expiryDate)} · rinovimi {formatCurrency(dom.recurringAmount || 0, cur(dom.currency))} / {dom.years || 1} vit</DialogDescription></DialogHeader>
        {isOurs ? (
          <div className="space-y-3">
            <div className="space-y-1"><Label className="text-xs">Nameservers (një për rresht)</Label><Textarea rows={3} value={ns} onChange={(e) => setNs(e.target.value)} /><Button size="sm" variant="outline" disabled={busy} onClick={() => run(async () => { await hostingApi('domain.setNameservers', { domainId: dom.id, nameservers: ns.split(/\s+/).filter(Boolean) }); toast({ title: 'Nameservers u ruajtën' }); })}>Ruaj nameservers</Button></div>
            <label className="flex items-center justify-between gap-2 text-sm"><span>Rinovim automatik<br /><span className="text-xs text-muted-foreground">Merrni faturën 30 ditë para skadencës; domain-i rinovohet kur paguhet.</span></span><Switch checked={dom.autoRenew !== false} disabled={busy} onCheckedChange={(v) => run(async () => { await hostingApi('domain.setAutoRenew', { domainId: dom.id, value: v }); })} /></label>
            <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={busy} onClick={() => run(async () => { const r = await hostingApi<{ authCode: string }>('domain.authCode', { domainId: dom.id }); setAuth(r.authCode); })}><KeyRound className="w-4 h-4 mr-1" />Kodi i transferimit (EPP)</Button></div>
            {auth && <Card className="p-3 text-sm bg-amber-50 border-amber-200">Kodi EPP: <code className="font-mono select-all">{auth}</code></Card>}
          </div>
        ) : <p className="text-sm text-muted-foreground">Ky domain menaxhohet nga sistemi ynë i vjetër. Për ndryshime, na kontaktoni nga chat-i.</p>}
      </DialogContent>
    </Dialog>
  );
};

type DraftLine = { kind: 'hosting' | 'domain-register' | 'domain-transfer'; productId?: string; cycle?: BillingCycle; domainName: string; years: number; authCode?: string };

const PortalOrderDialog: React.FC<{ open: boolean; onOpenChange: (o: boolean) => void; products: HostingProduct[]; tlds: DomainTld[]; onCreated: (invoiceId: string | null) => void }> = ({ open, onOpenChange, products, tlds, onCreated }) => {
  const { toast } = useToast();
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<DomainCheckRow[]>([]);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!open) { setLines([]); setSearch(''); setResults([]); } }, [open]);
  const tldPricing: TldPricing[] = tlds.map((t) => ({ tld: t.tld, currency: t.currency, registerPrice: t.registerPrice, renewPrice: t.renewPrice, transferPrice: t.transferPrice, minYears: t.minYears, maxYears: t.maxYears, status: 'Active' }));
  const inputs: OrderLineInput[] = lines.map((l) => { if (l.kind === 'hosting') { const p = products.find((x) => x.id === l.productId); return { kind: 'hosting', productId: p?.id, productName: p?.name, cycle: l.cycle, pricing: p ? { ...(p.pricing as any), currency: p.currency } : null, domainName: l.domainName }; } return { kind: l.kind, domainName: l.domainName, years: l.years, authCode: l.authCode }; });
  const priced = priceOrder(inputs, tldPricing);
  const setLine = (i: number, patch: Partial<DraftLine>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const doSearch = async () => {
    const p = parseDomain(search);
    if (!p) { toast({ title: 'Shkruaj një emër domain-i të vlefshëm', variant: 'destructive' }); return; }
    // The typed TLD plus our other TLDs with the same name — the classic domain-search UX.
    const names = Array.from(new Set([p.name, ...tlds.map((t) => `${p.sld}.${t.tld}`)])).slice(0, 8);
    setChecking(true);
    try { const r = await checkDomains(names); setResults(r.results); if (r.registrarError) toast({ title: 'Kontrolli i disponueshmërisë nuk funksionoi', description: 'Mund ta shtoni gjithsesi; stafi e verifikon.', variant: 'destructive' }); }
    catch (e) { toast({ title: 'Gabim', description: (e as Error).message, variant: 'destructive' }); }
    finally { setChecking(false); }
  };
  const submit = async () => {
    if (!priced.ok) { toast({ title: ORDER_ERROR_LABELS[priced.error], variant: 'destructive' }); return; }
    setBusy(true);
    try { const r = await hostingApi<{ invoiceId: string | null; orderNumber: string }>('order.create', { lines }); toast({ title: `Porosia ${r.orderNumber} u krijua`, description: r.invoiceId ? 'Paguani faturën për të aktivizuar shërbimet.' : undefined }); onCreated(r.invoiceId); }
    catch (e) { toast({ title: 'Gabim', description: (e as Error).message, variant: 'destructive' }); }
    finally { setBusy(false); }
  };
  const inCart = (name: string) => lines.some((l) => l.kind === 'domain-register' && parseDomain(l.domainName)?.name === name);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Porosit hosting / domain</DialogTitle><DialogDescription>Fatura krijohet menjëherë dhe mund ta paguani me kartë. Shërbimet aktivizohen automatikisht pas pagesës.</DialogDescription></DialogHeader>

        {tlds.length > 0 && (
          <Card className="p-3 space-y-2">
            <Label className="text-sm font-medium">Gjej domain</Label>
            <div className="flex gap-2"><Input placeholder="emri-juaj.com" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && doSearch()} /><Button onClick={doSearch} disabled={checking}>{checking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}</Button></div>
            {results.length > 0 && (
              <div className="divide-y text-sm">
                {results.filter((r) => r.sold).map((r) => (
                  <div key={r.domain} className="flex items-center justify-between py-1.5 gap-2">
                    <span className="font-medium">{r.domain}</span>
                    <span className={r.status === 'available' ? 'text-emerald-700' : r.status === 'taken' ? 'text-red-700' : 'text-muted-foreground'}>{r.status === 'available' ? 'I lirë' : r.status === 'taken' ? 'I zënë' : 'Nuk dihet'}</span>
                    <span className="text-muted-foreground">{formatCurrency(r.registerPrice || 0, r.currency || 'EUR')}/vit</span>
                    <Button size="sm" variant={inCart(r.domain) ? 'ghost' : 'outline'} disabled={r.status === 'taken' || inCart(r.domain)} onClick={() => setLines((ls) => [...ls, { kind: 'domain-register', domainName: r.domain, years: 1 }])}>{inCart(r.domain) ? 'Në shportë' : 'Shto'}</Button>
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}

        {products.length > 0 && (
          <div className="space-y-2">
            <Label className="text-sm font-medium">Paketat hosting</Label>
            <div className="grid sm:grid-cols-2 gap-2">
              {products.map((p) => { const cycles = availableCycles(p.pricing as any); const first = cycles[0]; return (
                <Card key={p.id} className="p-3 space-y-1">
                  <div className="flex items-center justify-between"><span className="font-semibold">{p.name}</span>{first && <span className="text-sm">{formatCurrency(p.pricing[first]!.price, p.currency)} <span className="text-xs text-muted-foreground">/ {CYCLE_LABELS[first].toLowerCase()}</span></span>}</div>
                  {p.description && <p className="text-xs text-muted-foreground">{p.description}</p>}
                  {p.features?.length ? <ul className="text-xs text-muted-foreground list-disc pl-4">{p.features.slice(0, 4).map((f, i) => <li key={i}>{f}</li>)}</ul> : null}
                  <Button size="sm" variant="outline" className="w-full" onClick={() => setLines((ls) => [...ls, { kind: 'hosting', productId: p.id, cycle: first, domainName: lines.find((l) => l.kind === 'domain-register')?.domainName || '', years: 1 }])}><Plus className="w-4 h-4 mr-1" />Shto</Button>
                </Card>
              ); })}
            </div>
          </div>
        )}

        {lines.length > 0 && (
          <div className="space-y-2">
            <Label className="text-sm font-medium">Shporta</Label>
            {lines.map((l, i) => (
              <Card key={i} className="p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium flex-1">{l.kind === 'hosting' ? `Hosting — ${products.find((p) => p.id === l.productId)?.name || ''}` : l.kind === 'domain-transfer' ? 'Transferim domain' : `Domain ${l.domainName}`}</span>
                  <Button variant="ghost" size="sm" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}><Trash2 className="w-4 h-4" /></Button>
                </div>
                {l.kind === 'hosting' ? (
                  <div className="grid sm:grid-cols-2 gap-2">
                    <Input placeholder="Domain-i i faqes suaj (p.sh. firma.com)" value={l.domainName} onChange={(e) => setLine(i, { domainName: e.target.value })} />
                    <Select value={l.cycle || ''} onValueChange={(v) => setLine(i, { cycle: v as BillingCycle })}><SelectTrigger><SelectValue placeholder="Cikli" /></SelectTrigger><SelectContent>{availableCycles(products.find((p) => p.id === l.productId)?.pricing as any).map((c) => { const p = products.find((x) => x.id === l.productId)!; return <SelectItem key={c} value={c}>{CYCLE_LABELS[c]} — {formatCurrency(p.pricing[c]!.price, p.currency)}</SelectItem>; })}</SelectContent></Select>
                  </div>
                ) : (
                  <div className="grid sm:grid-cols-2 gap-2">
                    <Select value={String(l.years)} onValueChange={(v) => setLine(i, { years: Number(v) })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{[1, 2, 3, 5].map((y) => <SelectItem key={y} value={String(y)}>{y} {y === 1 ? 'vit' : 'vjet'}</SelectItem>)}</SelectContent></Select>
                    {l.kind === 'domain-transfer' && <Input placeholder="Kodi EPP nga regjistruesi aktual" value={l.authCode || ''} onChange={(e) => setLine(i, { authCode: e.target.value })} />}
                  </div>
                )}
              </Card>
            ))}
            {tlds.length > 0 && <Button variant="ghost" size="sm" onClick={() => setLines((ls) => [...ls, { kind: 'domain-transfer', domainName: search, years: 1 }])}>Kam një domain — transferoje tek ju</Button>}
          </div>
        )}

        <Card className="p-3 text-sm">
          {lines.length === 0 ? <p className="text-muted-foreground">Shporta është bosh.</p> : priced.ok ? (<>{priced.order.lines.map((l, i) => <div key={i} className="flex justify-between"><span>{l.description}</span><span>{formatCurrency(l.total, l.currency)}</span></div>)}<div className="flex justify-between font-semibold border-t mt-2 pt-2"><span>Totali</span><span>{formatCurrency(priced.order.total, priced.order.currency)}</span></div></>) : <p className="text-orange-700">{ORDER_ERROR_LABELS[priced.error]}</p>}
        </Card>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Anulo</Button><Button onClick={submit} disabled={busy || !priced.ok}>{busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}Porosit dhe paguaj</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
