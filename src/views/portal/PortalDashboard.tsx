import React, { useEffect, useRef } from 'react';
import { useClientPortal } from '../../hooks/useClientPortal';
import { useAuth } from '../../contexts/AuthContext';
import { useCollection, useDocument } from '../../hooks/useFirestore';
import { getStatusColor } from '../../lib/statusColors';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { FileText, ShoppingBag, ClipboardList, DollarSign, Clock, FolderKanban, CheckCircle2, Sparkles, Calculator, MessageSquare } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useToast } from '../../hooks/use-toast';
import type { Invoice, InvoiceItem, Service, ClientRequest, Project, Task, Quote, Lead } from '../../types';

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

const PortalDashboard: React.FC = () => {
  const { customerId } = useClientPortal();
  const { user } = useAuth();
  const navigate = useNavigate();
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
  const { data: portalUserNotifs } = useCollection<any>('notifications', {
    skip: !user,
    where: user ? [{ field: 'userId', operator: '==', value: user.uid }] : undefined,
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
        title: '🐦 Mesazh i ri nga ekipi!',
        description: 'Klikoni zogun për të parë mesazhin.',
      });
    }
    prevStaffMsgCountRef.current = unreadStaffMsgs;
  }, [unreadStaffMsgs]);

  const { data: rawInvoices } = useCollection<Invoice>('invoices', {
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
  useCollection<Service>('services', { skipTeamFilter: true });

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
  const totalOwed = invoices
    ?.filter(i => i.status === 'Pending' || i.status === 'Overdue')
    .reduce((sum, i) => sum + (i.total ?? i.amount ?? 0), 0) || 0;

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
  const { data: allQuotes } = useCollection<Quote>('quotes', {
    skip: !customerId,
    skipTeamFilter: true,
  });
  const { data: allLeads } = useCollection<Lead>('leads', {
    skip: !customerId,
    skipTeamFilter: true,
  });
  // Read only the client's own customer doc (server-side RLS: isPortalClientDoc).
  const { data: myCustomer } = useDocument<any>('customers', customerId || undefined);
  const customerEmail = myCustomer?.email?.toLowerCase();

  const linkedLeadIds = React.useMemo(() => {
    const ids = new Set<string>();
    if ((myCustomer as any)?.leadId) ids.add((myCustomer as any).leadId);
    if (allLeads && customerId) {
      allLeads.forEach(l => {
        if ((l as any).customerId === customerId) ids.add(l.id);
        if (customerEmail && l.email?.toLowerCase() === customerEmail) ids.add(l.id);
      });
    }
    return ids;
  }, [allLeads, customerId, myCustomer, customerEmail]);

  const myQuotes = React.useMemo(() => {
    if (!allQuotes) return [];
    return allQuotes
      .filter(q =>
        q.customerId === customerId ||
        (q.leadId && linkedLeadIds.has(q.leadId))
      )
      .filter(q => q.status !== 'Draft');
  }, [allQuotes, customerId, linkedLeadIds]);

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

  // Payment history
  const paidInvoices = React.useMemo(() => {
    return invoices?.filter(i => i.status === 'Paid').sort((a, b) => {
      const ta = (a as any).paidAt instanceof Date ? (a as any).paidAt.getTime() : a.createdAt instanceof Date ? a.createdAt.getTime() : 0;
      const tb = (b as any).paidAt instanceof Date ? (b as any).paidAt.getTime() : b.createdAt instanceof Date ? b.createdAt.getTime() : 0;
      return tb - ta;
    }) || [];
  }, [invoices]);

  const totalPaid = paidInvoices.reduce((s, i) => s + (i.total ?? i.amount ?? 0), 0);

  const recentInvoices = invoices?.slice(0, 5) || [];
  const recentRequests = requests?.slice(0, 5) || [];



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
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
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
                <div className="p-2 bg-purple-100 rounded-lg">
                  <ShoppingBag className="h-5 w-5 text-purple-600" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Shërbime të Blera</p>
                  <p className="text-2xl font-bold">{purchasedServicesCount}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </Link>

        <Link to="/portal/chat">
          <Card className="hover:shadow-md transition-shadow cursor-pointer">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-orange-100 rounded-lg">
                  <MessageSquare className="h-5 w-5 text-orange-600" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Mbështetje</p>
                  <p className="text-base font-semibold">Na shkruani</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </Link>

        <Link to="/portal/preventiva">
          <Card className="hover:shadow-md transition-shadow cursor-pointer">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-indigo-100 rounded-lg">
                  <Calculator className="h-5 w-5 text-indigo-600" />
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

      {/* Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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
                        {(invoice.total || invoice.amount || 0).toLocaleString()} ALL
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

        {/* Support via chat */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <MessageSquare className="w-5 h-5 text-primary" />
              Mbështetje
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              Keni një pyetje ose kërkesë? Na shkruani direkt — ekipi përgjegjës ju përgjigjet sa më shpejt.
            </p>
            <Link to="/portal/chat">
              <Button className="w-full">
                <MessageSquare className="w-4 h-4 mr-2" /> Hap bisedën
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>

      {/* Project Progress */}
      {customerProjects.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                <FolderKanban className="w-5 h-5 text-primary" />
                Projektet Tuaja
              </CardTitle>
              <Link to="/portal/projects" className="text-sm text-primary hover:underline">
                Shiko të gjitha
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {customerProjects.map(p => (
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
                  <span className="font-semibold text-green-600">{(inv.total || inv.amount || 0).toLocaleString()} ALL</span>
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

      {/* ── Floating Bird Widget: unread staff messages ── */}
      {unreadStaffMsgs > 0 && (
        <button
          onClick={() => navigate('/portal/chat')}
          className="fixed bottom-6 right-6 z-50 flex items-center gap-3 bg-white dark:bg-gray-900 rounded-2xl shadow-xl px-4 py-3 border border-primary/20 dark:border-primary/30 hover:shadow-lg hover:scale-105 transition-all duration-200 animate-bird-enter"
          title="Mesazh i ri nga ekipi — klikoni për chat"
        >
          {/* Bird + pulse ring */}
          <div className="relative flex-shrink-0 w-9 h-9 flex items-center justify-center">
            <div className="absolute inset-0 rounded-full bg-primary/20 animate-pulse-ring" />
            <span className="text-2xl block animate-bird-fly select-none">🐦</span>
            <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] bg-red-500 rounded-full flex items-center justify-center text-white text-[9px] font-bold px-0.5 shadow">
              {unreadStaffMsgs > 9 ? '9+' : unreadStaffMsgs}
            </span>
          </div>
          {/* Label */}
          <div className="text-left">
            <div className="text-xs font-semibold text-foreground whitespace-nowrap leading-tight">Mesazh nga ekipi</div>
            <div className="text-[10px] text-primary font-medium mt-0.5">
              {unreadStaffMsgs} të palexuar · Hap chat →
            </div>
          </div>
        </button>
      )}
    </div>
  );
};

export default PortalDashboard;
