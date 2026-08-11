import React, { useEffect, useRef } from 'react';
import { useClientPortal } from '../../hooks/useClientPortal';
import { useAuth } from '../../contexts/AuthContext';
import { useCollection, useDocument } from '../../hooks/useFirestore';
import { getStatusColor } from '../../lib/statusColors';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { FileText, ShoppingBag, ClipboardList, DollarSign, Clock, FolderKanban, CheckCircle2, Sparkles, Calculator, ArrowRight, MessageCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useToast } from '../../hooks/use-toast';
import { toAll } from '../../lib/utils';
import { DashboardSkeleton } from './PortalSkeletons';
import type { Invoice, InvoiceItem, Service, ClientRequest, Project, Task, Quote, Lead, ServiceInquiry } from '../../types';

const QUOTES = [
  'Suksesi nuk është çelësi i lumturisë. Lumturia është çelësi i suksesit.',
  'Çdo ditë është një mundësi e re për të arritur qëllimet tuaja.',
  'Rruga drejt suksesit fillon me një hap të vetëm.',
  'Investimi më i mirë që mund të bëni është investimi në veten tuaj.',
  'Bashkëpunimi ndërton ura; besimi i forcon ato.',
  'Cilësia kurrë nuk është rastësi — është gjithmonë rezultat i përpjekjes.',
  'Klienti i kënaqur është reklama më e mirë.',
  'Rritja fillon atje ku zona e rehatisë mbaron.',
  'Koha është malli juaj më i çmuar — shpenzojeni me mençuri.',
  'Sfidat e sotme janë arritjet e nesërme.',
];

// Icon + color for each timeline event kind.
const timelineVisual = (kind: string): { Icon: any; box: string } => {
  switch (kind) {
    case 'invoice': return { Icon: FileText, box: 'bg-blue-100 text-blue-600' };
    case 'paid': return { Icon: CheckCircle2, box: 'bg-green-100 text-green-600' };
    case 'quote': return { Icon: Calculator, box: 'bg-primary/15 text-primary' };
    case 'project': return { Icon: FolderKanban, box: 'bg-purple-100 text-purple-600' };
    case 'inquiry': return { Icon: ClipboardList, box: 'bg-amber-100 text-amber-600' };
    case 'message': return { Icon: MessageCircle, box: 'bg-pink-100 text-pink-600' };
    default: return { Icon: Sparkles, box: 'bg-muted text-muted-foreground' };
  }
};

// Compact Albanian relative time.
const timeAgo = (date: Date): string => {
  const s = Math.floor((Date.now() - date.getTime()) / 1000);
  if (s < 60) return 'tani';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min më parë`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} orë më parë`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} ditë më parë`;
  return date.toLocaleDateString('sq-AL', { day: 'numeric', month: 'short' });
};

const PortalDashboard: React.FC = () => {
  const { customerId, businessId: portalBusinessId, isLoading: portalLoading } = useClientPortal();
  const { user } = useAuth();
  const { toast } = useToast();

  // Greeting based on time of day
  const greeting = React.useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Mirëmëngjes';
    if (hour < 18) return 'Mirëdita';
    return 'Mirëmbrëma';
  }, []);

  // Stable daily quote
  const quote = React.useMemo(() => {
    const dayIndex = new Date().getDate() % QUOTES.length;
    return QUOTES[dayIndex];
  }, []);

  const displayName = user?.displayName || user?.email?.split('@')[0] || 'klient';

  // ── Unread staff messages via notifications ──
  // Same bounded query as PortalLayout, so the two share one cached listener
  // instead of opening a second unbounded stream over the same data.
  const { data: portalUserNotifs } = useCollection<any>('notifications', {
    skip: !user,
    where: user ? [{ field: 'userId', operator: '==', value: user.uid }] : undefined,
    orderBy: { field: 'createdAt', direction: 'desc' },
    limit: 50,
    skipTeamFilter: true,
  });
  const unreadStaffMsgs = React.useMemo(
    () => portalUserNotifs?.filter((n: any) => n.type === 'staff_message' && !n.isRead).length || 0,
    [portalUserNotifs]
  );

  // ── Toast when new staff message arrives ──
  const prevStaffMsgCountRef = useRef(0);
  const staffMsgFirstLoadRef = useRef(true);
  useEffect(() => {
    if (staffMsgFirstLoadRef.current) {
      staffMsgFirstLoadRef.current = false;
      prevStaffMsgCountRef.current = unreadStaffMsgs;
      return;
    }
    if (unreadStaffMsgs > prevStaffMsgCountRef.current) {
      toast({
        title: 'Mesazh i ri nga ekipi!',
        description: 'Hapni "Ndihmë e shpejtë" në menu për ta parë.',
      });
    }
    prevStaffMsgCountRef.current = unreadStaffMsgs;
  }, [unreadStaffMsgs]);

  const { data: rawInvoices, loading: invoicesLoading } = useCollection<Invoice>('invoices', {
    skip: !customerId,
    where: [{ field: 'customerId', operator: '==', value: customerId || '' }],
    skipTeamFilter: true,
  });

  // Sort client-side to avoid Firestore composite index requirement
  const invoices = React.useMemo(() => {
    if (!rawInvoices) return [];
    return [...rawInvoices].sort((a, b) => {
      const ta = a.createdAt instanceof Date ? a.createdAt.getTime() : (a.createdAt as any)?.toMillis?.() ?? 0;
      const tb = b.createdAt instanceof Date ? b.createdAt.getTime() : (b.createdAt as any)?.toMillis?.() ?? 0;
      return tb - ta;
    });
  }, [rawInvoices]);

  const { data: invoiceItems } = useCollection<InvoiceItem>('invoiceItems', {
    skip: !customerId,
    where: [{ field: 'customerId', operator: '==', value: customerId || '' }],
    skipTeamFilter: true,
  });
  useCollection<Service>('services', {
    // The service catalogue is tenant data: scope it to the client's OWN business.
    // Reading it unscoped (the old `skipTeamFilter` behaviour) returned every
    // tenant's catalogue and pricing to any signed-in client.
    skip: !portalBusinessId,
    where: portalBusinessId ? [{ field: 'businessId', operator: '==', value: portalBusinessId }] : undefined,
    skipTeamFilter: true,
    skipBusinessFilter: true,
  });

  const { data: rawRequests } = useCollection<ClientRequest>('clientRequests', {
    skip: !customerId,
    where: [{ field: 'customerId', operator: '==', value: customerId || '' }],
    skipTeamFilter: true,
  });

  const requests = React.useMemo(() => {
    if (!rawRequests) return [];
    return [...rawRequests].sort((a, b) => {
      const ta = a.createdAt instanceof Date ? a.createdAt.getTime() : (a.createdAt as any)?.toMillis?.() ?? 0;
      const tb = b.createdAt instanceof Date ? b.createdAt.getTime() : (b.createdAt as any)?.toMillis?.() ?? 0;
      return tb - ta;
    });
  }, [rawRequests]);

  // Calculate stats
  const totalInvoices = invoices?.length || 0;
  const pendingInvoices = invoices?.filter(i => i.status === 'Pending' || i.status === 'Overdue').length || 0;
  // Normalize each invoice to ALL before summing (invoices may be EUR or ALL) so the
  // fixed "ALL" label on the total is truthful.
  const totalOwed = invoices
    ?.filter(i => i.status === 'Pending' || i.status === 'Overdue')
    .reduce((sum, i) => sum + toAll(i.total ?? i.amount ?? 0, (i as any).currency), 0) || 0;

  // Get unique services purchased via invoice items
  const myServiceIds = new Set(
    invoiceItems
      ?.filter(item => invoices?.some(inv => inv.id === item.invoiceId))
      .map(item => item.serviceId)
      .filter(Boolean) || []
  );
  const purchasedServicesCount = myServiceIds.size;

  const activeRequests = requests?.filter(r => r.status !== 'Completed' && r.status !== 'Rejected').length || 0;

  // Quotes / Preventiva
  // Leads scoped server-side to this customer (server RLS only authorizes leads
  // stamped with the client's own customerId).
  const { data: leadsScoped } = useCollection<Lead>('leads', {
    skip: !customerId,
    where: [{ field: 'customerId', operator: '==', value: customerId || '' }],
    skipTeamFilter: true,
  });
  const leadIdList = React.useMemo(
    () => (leadsScoped || []).map(l => l.id).slice(0, 10),
    [leadsScoped]
  );

  // Two narrowed quote queries the server RLS authorizes (by customerId, by own leadIds).
  const { data: quotesByCustomer } = useCollection<Quote>('quotes', {
    skip: !customerId,
    where: [{ field: 'customerId', operator: '==', value: customerId || '' }],
    skipTeamFilter: true,
  });
  const { data: quotesByLead } = useCollection<Quote>('quotes', {
    skip: leadIdList.length === 0,
    where: [{ field: 'leadId', operator: 'in', value: leadIdList }],
    skipTeamFilter: true,
  });

  const myQuotes = React.useMemo(() => {
    const merged = [...(quotesByCustomer || []), ...(quotesByLead || [])];
    const seen = new Set<string>();
    return merged
      .filter(q => { if (seen.has(q.id)) return false; seen.add(q.id); return true; })
      .filter(q => q.status !== 'Draft');
  }, [quotesByCustomer, quotesByLead]);

  const quotesCount = myQuotes.length;

  // Projects for this customer (by customerId) or where user is a member
  const { data: projectsByCustomer } = useCollection<Project>('projects', {
    skip: !customerId,
    where: [{ field: 'customerId', operator: '==', value: customerId || '' }],
    skipTeamFilter: true,
  });
  const { data: projectsByMember } = useCollection<Project>('projects', {
    where: user?.uid ? [{ field: 'memberUserIds', operator: 'array-contains', value: user.uid }] : [{ field: 'customerId', operator: '==', value: '' }],
    skipTeamFilter: true,
  });
  const rawProjects = React.useMemo(() => {
    const all = [...(projectsByCustomer || []), ...(projectsByMember || [])];
    const seen = new Set<string>();
    return all.filter(p => { if (seen.has(p.id)) return false; seen.add(p.id); return true; });
  }, [projectsByCustomer, projectsByMember]);
  const { data: allTasks } = useCollection<Task>('tasks', {
    skip: !customerId,
    where: [{ field: 'customerId', operator: '==', value: customerId || '' }],
    skipTeamFilter: true,
  });

  const customerProjects = React.useMemo(() => {
    if (!rawProjects) return [];
    return rawProjects.map(p => {
      const projectTasks = allTasks?.filter(t => t.projectId === p.id) || [];
      const done = projectTasks.filter(t => t.status === 'Done').length;
      const total = projectTasks.length;
      return { ...p, done, total, pct: total > 0 ? Math.round((done / total) * 100) : 0 };
    });
  }, [rawProjects, allTasks]);

  // ── Client's submitted inquiries (anketa). A submitted inquiry counts as an
  // active project — the team is preparing the proposal — so it shows as a card
  // on the dashboard even before a real project doc exists. Draft = not yet
  // submitted; Converted = a real project now exists (shown via customerProjects).
  const { data: myInquiries } = useCollection<ServiceInquiry>('serviceInquiries', {
    skip: !user,
    where: user?.uid ? [{ field: 'clientUserId', operator: '==', value: user.uid }] : undefined,
    skipTeamFilter: true,
  });
  const activeInquiries = React.useMemo(
    () => (myInquiries || []).filter(i => i.status === 'New' || i.status === 'Reviewed'),
    [myInquiries]
  );
  const activeProjects = React.useMemo(
    () => customerProjects.filter(p => p.status !== 'Completed'),
    [customerProjects]
  );

  // Payment history
  const paidInvoices = React.useMemo(() => {
    return invoices?.filter(i => i.status === 'Paid').sort((a, b) => {
      const ta = (a as any).paidAt instanceof Date ? (a as any).paidAt.getTime() : a.createdAt instanceof Date ? a.createdAt.getTime() : 0;
      const tb = (b as any).paidAt instanceof Date ? (b as any).paidAt.getTime() : b.createdAt instanceof Date ? b.createdAt.getTime() : 0;
      return tb - ta;
    }) || [];
  }, [invoices]);

  const totalPaid = paidInvoices.reduce((s, i) => s + toAll(i.total ?? i.amount ?? 0, (i as any).currency), 0);

  const recentInvoices = invoices?.slice(0, 5) || [];
  const recentRequests = requests?.slice(0, 5) || [];

  // ── Unified activity timeline ──
  // Aggregate events from the collections already loaded above (no extra reads):
  // invoices created/paid, quotes sent, projects started, inquiries submitted, and
  // staff chat messages. Sorted newest-first, capped at 8.
  const timeline = React.useMemo(() => {
    type Ev = { id: string; kind: string; title: string; desc: string; date: Date; to: string };
    const evs: Ev[] = [];
    const toDate = (v: any): Date | null =>
      v instanceof Date ? v : (v?.toDate?.() ?? null);

    (invoices || []).forEach(inv => {
      const num = inv.invoiceNumber || `INV-${inv.id.slice(0, 6)}`;
      const cur = (inv as any).currency === 'EUR' ? '€' : 'L';
      const amount = `${(inv.total || inv.amount || 0).toLocaleString()} ${cur}`;
      const created = toDate(inv.createdAt);
      if (created) evs.push({ id: `inv-${inv.id}`, kind: 'invoice', title: `Faturë e re: ${num}`, desc: amount, date: created, to: '/portal/invoices' });
      const paidAt = toDate((inv as any).paidAt);
      if (inv.status === 'Paid' && paidAt) evs.push({ id: `paid-${inv.id}`, kind: 'paid', title: `Pagesa u konfirmua: ${num}`, desc: amount, date: paidAt, to: '/portal/invoices' });
    });

    myQuotes.forEach(q => {
      const created = toDate(q.createdAt);
      if (created) evs.push({ id: `q-${q.id}`, kind: 'quote', title: 'Preventivë e re', desc: q.label || q.result?.suggestedLabel || 'Ofertë', date: created, to: '/portal/preventiva' });
    });

    (rawProjects || []).forEach(p => {
      const created = toDate(p.createdAt);
      if (created) evs.push({ id: `proj-${p.id}`, kind: 'project', title: `Projekti "${p.name}"`, desc: 'Projekt i ri', date: created, to: `/portal/projects/${p.id}` });
    });

    (myInquiries || []).forEach(inq => {
      if (inq.status === 'Draft') return;
      const created = toDate(inq.createdAt);
      const title = (inq as any).serviceTitle || inq.servicesInterestedIn?.[0] || 'Kërkesë shërbimi';
      if (created) evs.push({ id: `inq-${inq.id}`, kind: 'inquiry', title: 'Kërkesë e dërguar', desc: title, date: created, to: `/portal/projects/inquiry/${inq.id}` });
    });

    (portalUserNotifs || []).forEach((n: any) => {
      if (n.type !== 'staff_message') return;
      const created = toDate(n.createdAt);
      if (created) evs.push({ id: `msg-${n.id}`, kind: 'message', title: 'Mesazh nga ekipi', desc: n.message || n.title || '', date: created, to: '/portal/chat' });
    });

    return evs.sort((a, b) => b.date.getTime() - a.date.getTime()).slice(0, 8);
  }, [invoices, myQuotes, rawProjects, myInquiries, portalUserNotifs]);

  // A brand-new client has no data at all yet — show a guided welcome instead of
  // a wall of zeros and empty cards.
  const isBrandNew =
    totalInvoices === 0 &&
    customerProjects.length === 0 &&
    activeInquiries.length === 0 &&
    quotesCount === 0 &&
    purchasedServicesCount === 0;

  // Show a skeleton while the portal is still resolving the client, or while the
  // first batch of invoice data is loading — otherwise the dashboard flashes zeros.
  if (portalLoading || (!!customerId && invoicesLoading && !rawInvoices)) {
    return <DashboardSkeleton />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
            {greeting}, {displayName}! 👋
          </h1>
          <p className="text-muted-foreground mt-1">
            Mirë se vini në portalin tuaj të klientit
          </p>
        </div>
        <div className="flex items-start gap-2 max-w-xs sm:max-w-sm bg-muted/50 rounded-lg px-4 py-3">
          <Sparkles className="h-4 w-4 text-primary shrink-0 mt-0.5" />
          <p className="text-sm text-muted-foreground italic leading-snug">{quote}</p>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        <Link to="/portal/invoices">
          <Card className="hover:shadow-md transition-shadow cursor-pointer">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-100 rounded-lg">
                  <FileText className="h-5 w-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Fatura Totale</p>
                  <p className="text-2xl font-bold">{totalInvoices}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </Link>

        <Link to="/portal/invoices">
          <Card className="hover:shadow-md transition-shadow cursor-pointer">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-yellow-100 rounded-lg">
                  <DollarSign className="h-5 w-5 text-yellow-600" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Për t'u Paguar</p>
                  <p className="text-2xl font-bold">
                    {totalOwed.toLocaleString()} ALL
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </Link>

        <Link to="/portal/services">
          <Card className="hover:shadow-md transition-shadow cursor-pointer">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-accent-soft rounded-lg">
                  <ShoppingBag className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Shërbime të Blera</p>
                  <p className="text-2xl font-bold">{purchasedServicesCount}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </Link>

        <Link to="/portal/preventiva">
          <Card className="hover:shadow-md transition-shadow cursor-pointer">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-accent-soft rounded-lg">
                  <Calculator className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Preventiva</p>
                  <p className="text-2xl font-bold">{quotesCount}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* Onboarding welcome — only for a brand-new client with no data yet */}
      {isBrandNew && (
        <Card className="border-primary/25 bg-gradient-to-b from-primary/[0.05] to-primary/[0.12]">
          <CardContent className="pt-6">
            <div className="flex flex-col sm:flex-row items-start gap-4">
              <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-brand-gradient shadow-md">
                <Sparkles className="h-6 w-6 text-white" />
              </div>
              <div className="flex-1 space-y-3">
                <div>
                  <h2 className="text-lg font-bold">Mirë se vini në portalin tuaj! 🎉</h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    Këtu do të gjeni faturat, projektet, preventivat dhe shërbimet tuaja — të gjitha në një vend.
                    Ja disa hapa për të filluar:
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <Link to="/portal/services" className="flex items-start gap-2.5 rounded-xl border bg-card p-3 hover:shadow-md transition-shadow">
                    <ShoppingBag className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-semibold">Shfleto shërbimet</p>
                      <p className="text-xs text-muted-foreground">Zbulo çfarë ofrojmë</p>
                    </div>
                  </Link>
                  <Link to="/portal/chat" className="flex items-start gap-2.5 rounded-xl border bg-card p-3 hover:shadow-md transition-shadow">
                    <MessageCircle className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-semibold">Kontakto ekipin</p>
                      <p className="text-xs text-muted-foreground">Përgjigje brenda 24 orëve</p>
                    </div>
                  </Link>
                  <Link to="/portal/projects" className="flex items-start gap-2.5 rounded-xl border bg-card p-3 hover:shadow-md transition-shadow">
                    <FolderKanban className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-semibold">Kërko një shërbim</p>
                      <p className="text-xs text-muted-foreground">Plotëso një anketë</p>
                    </div>
                  </Link>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Unified Activity Timeline */}
      {!isBrandNew && timeline.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Clock className="w-5 h-5 text-primary" />
              Aktiviteti i Fundit
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="relative pl-6">
              {/* vertical line */}
              <div className="absolute left-[9px] top-1 bottom-1 w-px bg-border" />
              <div className="space-y-4">
                {timeline.map(ev => {
                  const visual = timelineVisual(ev.kind);
                  const Icon = visual.Icon;
                  return (
                    <Link key={ev.id} to={ev.to} className="flex items-start gap-3 group -ml-6">
                      <div className={`relative z-10 flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded-full mt-0.5 ${visual.box}`}>
                        <Icon className="h-2.5 w-2.5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-medium truncate group-hover:text-primary transition-colors">{ev.title}</p>
                          <span className="text-xs text-muted-foreground flex-shrink-0">{timeAgo(ev.date)}</span>
                        </div>
                        {ev.desc && <p className="text-xs text-muted-foreground truncate">{ev.desc}</p>}
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recent Activity */}
      {!isBrandNew && (
      <div className="grid grid-cols-1 gap-6">
        {/* Recent Invoices */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">Faturat e Fundit</CardTitle>
              <Link to="/portal/invoices" className="text-sm text-primary hover:underline">
                Shiko të gjitha
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {recentInvoices.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                Nuk ka fatura akoma
              </p>
            ) : (
              <div className="space-y-3">
                {recentInvoices.map(invoice => (
                  <div key={invoice.id} className="flex flex-col sm:flex-row sm:items-center justify-between py-2 border-b last:border-0 gap-1 sm:gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate">
                        {invoice.invoiceNumber || `INV-${invoice.id.slice(0, 6)}`}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {invoice.createdAt instanceof Date
                          ? invoice.createdAt.toLocaleDateString('sq-AL')
                          : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
                      <span className="font-semibold text-sm">
                        {(invoice.total || invoice.amount || 0).toLocaleString()} {(invoice as any).currency === 'EUR' ? '€' : 'L'}
                      </span>
                      <Badge className={getStatusColor(invoice.status)} variant="secondary">
                        {invoice.status}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      )}

      {/* Active Projects — real active projects + submitted inquiries.
          A submitted anketë counts as an active project, so an inquiry-only
          client still sees a project card here. */}
      {(activeProjects.length > 0 || activeInquiries.length > 0) && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                <FolderKanban className="w-5 h-5 text-primary" />
                Projektet Aktive
              </CardTitle>
              <Link to="/portal/projects" className="text-sm text-primary hover:underline">
                Shiko të gjitha
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {/* Submitted inquiries shown as active projects (team preparing the proposal) */}
              {activeInquiries.map(inq => {
                const title = (inq as any).serviceTitle || inq.servicesInterestedIn?.[0] || 'Kërkesë shërbimi';
                return (
                  <Link key={`inq-${inq.id}`} to={`/portal/projects/inquiry/${inq.id}`} className="block hover:bg-muted/50 rounded-lg p-2 -m-2 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-primary/10">
                        <ClipboardList className="h-5 w-5 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium truncate">{title}</span>
                          <Badge variant="secondary" className="bg-blue-100 text-blue-800">Në shqyrtim</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">Ekipi po përgatit propozimin tuaj.</p>
                      </div>
                      <ArrowRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    </div>
                  </Link>
                );
              })}

              {/* Real active projects with progress */}
              {activeProjects.map(p => (
                <Link key={p.id} to={`/portal/projects/${p.id}`} className="block hover:bg-muted/50 rounded-lg p-2 -m-2 transition-colors">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium">{p.name}</span>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className={
                          p.status === 'Active' ? 'bg-green-100 text-green-800' :
                          p.status === 'Completed' ? 'bg-blue-100 text-blue-800' :
                          'bg-gray-100 text-gray-800'
                        }>{p.status}</Badge>
                        <span className="text-xs text-muted-foreground">{p.pct}%</span>
                      </div>
                    </div>
                    <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${p.pct}%` }} />
                    </div>
                    <p className="text-xs text-muted-foreground">{p.done}/{p.total} detyra të përfunduara</p>
                  </div>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Payment History */}
      {paidInvoices.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-green-500" />
                Histori Pagesash
              </CardTitle>
              <span className="text-sm font-semibold text-green-600">Totali: {totalPaid.toLocaleString()} ALL</span>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {paidInvoices.slice(0, 8).map(inv => (
                <div key={inv.id} className="flex items-center justify-between py-2 border-b last:border-0 text-sm">
                  <div>
                    <p className="font-medium">{inv.invoiceNumber || `INV-${inv.id.slice(0, 6)}`}</p>
                    <p className="text-xs text-muted-foreground">
                      {(inv as any).paidAt instanceof Date ? (inv as any).paidAt.toLocaleDateString('sq-AL') :
                       inv.createdAt instanceof Date ? inv.createdAt.toLocaleDateString('sq-AL') : ''}
                      {inv.paymentMethod ? ` • ${inv.paymentMethod}` : ''}
                    </p>
                  </div>
                  <span className="font-semibold text-green-600">{toAll(inv.total || inv.amount || 0, (inv as any).currency).toLocaleString()} ALL</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Pending Invoices Alert */}
      {pendingInvoices > 0 && (
        <Card className="border-yellow-200 bg-yellow-50 dark:bg-yellow-950/20">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Clock className="h-5 w-5 text-yellow-600" />
              <div>
                <p className="font-medium">
                  Keni {pendingInvoices} {pendingInvoices > 1 ? 'fatura' : 'faturë'} në pritje
                </p>
                <p className="text-sm text-muted-foreground">
                  Totali për t'u paguar: {totalOwed.toLocaleString()} ALL
                </p>
              </div>
              <Link to="/portal/invoices" className="ml-auto">
                <button className="text-sm text-primary font-medium hover:underline">
                  Shiko faturat →
                </button>
              </Link>
            </div>
          </CardContent>
        </Card>
      )}

    </div>
  );
};

export default PortalDashboard;
