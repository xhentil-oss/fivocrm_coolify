import React, { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useCollection, useDocument, useMutation } from '../hooks/useFirestore';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../hooks/use-toast';
import { getStatusColor } from '../lib/statusColors';
import {
  ArrowLeft, Building2, Mail, Phone, FileText, DollarSign,
  ClipboardList, Calendar, Plus, Clock, Target, Calculator, Send,
  Archive, Trash2, CheckSquare, Square, Eye, Download, Copy
} from 'lucide-react';
import { downloadQuotePdf } from '../lib/quotePdf';
import { usePermissions } from '../contexts/PermissionsContext';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Separator } from '../components/ui/separator';
import { safeHref, toAll } from '../lib/utils';
import type { Customer, Invoice, Project, ClientRequest, Activity, Task, Quote, Lead, Contract, Service } from '../types';

const Customer360View: React.FC = () => {
  const { customerId } = useParams<{ customerId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const permissions = usePermissions();
  const canPreviewAsCustomer = permissions.isOwner || permissions.isAdmin || (permissions as any).isSuperAdmin;
  const { toast } = useToast();
  const [isActivityDialogOpen, setIsActivityDialogOpen] = useState(false);
  const [activityType, setActivityType] = useState<string>('note');
  const [activityTitle, setActivityTitle] = useState('');
  const [activityDesc, setActivityDesc] = useState('');
  const [sendingQuoteId, setSendingQuoteId] = useState<string | null>(null);

  // Duplicate a quote as a new Draft revision (version+1, same root).
  const createQuoteVersion = async (q: Quote) => {
    const root = q.parentQuoteId || q.id;
    const siblings = customerQuotes.filter(x => (x.parentQuoteId || x.id) === root);
    const maxV = Math.max(1, ...siblings.map(x => x.version || 1));
    const { id, createdAt, updatedAt, ...rest } = q as any;
    try {
      await quoteMutation.create({ ...rest, status: 'Draft', version: maxV + 1, parentQuoteId: root });
      toast({ title: `Version i ri (v${maxV + 1}) u krijua si Draft` });
    } catch { toast({ title: 'Gabim', description: 'Versioni nuk u krijua', variant: 'destructive' }); }
  };
  const [sendingContractId, setSendingContractId] = useState<string | null>(null);
  const [selectedRequestIds, setSelectedRequestIds] = useState<Set<string>>(new Set());
  const [showArchivedRequests, setShowArchivedRequests] = useState(false);

  // Data
  // Single-customer query: filter by customerId server-side instead of loading
  // whole collections and filtering in the client. Cuts Firestore reads to this
  // customer's docs and shrinks cross-team exposure. (skipTeamFilter is kept so
  // the server constraint stays customerId-only and doesn't depend on every doc
  // already carrying a teamId — see workspace/SECURITY_RULES_MIGRATION.md.)
  const byCustomer = useMemo(() => ({
    where: [{ field: 'customerId', operator: '==' as const, value: customerId }],
    skipTeamFilter: true,
    skip: !customerId,
  }), [customerId]);

  // The customer itself is a single doc — fetch by id, not the whole collection.
  const { data: customer } = useDocument<Customer>('customers', customerId);
  const { data: invoices } = useCollection<Invoice>('invoices', byCustomer);
  const { data: projects } = useCollection<Project>('projects', byCustomer);
  const { data: requests } = useCollection<ClientRequest>('clientRequests', byCustomer);
  const { data: activities } = useCollection<Activity>('activities', byCustomer);
  // tasks (joined via projectId), quotes (customerId OR leadId), leads
  // (customerId OR email), services (full catalog) need broader reads — left
  // as full-collection loads filtered client-side below.
  const { data: tasks } = useCollection<Task>('tasks', { skipTeamFilter: true });
  const { data: quotes } = useCollection<Quote>('quotes', { skipTeamFilter: true });
  const { data: services } = useCollection<Service>('services', { skipTeamFilter: true });
  const { data: allLeads } = useCollection<Lead>('leads', { skipTeamFilter: true });
  const { data: allContracts } = useCollection<Contract>('contracts', byCustomer);
  const activityMutation = useMutation<Activity>('activities');
  const quoteMutation = useMutation<Quote>('quotes');
  const contractMutation = useMutation<Contract>('contracts');
  const requestMutation = useMutation<ClientRequest>('clientRequests');
  const customerMutation = useMutation<Customer>('customers');

  // Service label UI state
  const [isServiceDialogOpen, setIsServiceDialogOpen] = useState(false);
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(null);
  const [manualServiceLabel, setManualServiceLabel] = useState<string>('');
  const [isAutoDetecting, setIsAutoDetecting] = useState(false);
  const [savingService, setSavingService] = useState(false);

  // Collect all lead IDs linked to this customer
  const linkedLeadIds = useMemo(() => {
    const ids = new Set<string>();
    const custLeadId = (customer as any)?.leadId;
    if (custLeadId) ids.add(custLeadId);
    const custEmail = customer?.email?.toLowerCase();
    if (allLeads && customerId) {
      allLeads.forEach(l => {
        if ((l as any).customerId === customerId) ids.add(l.id);
        if (custEmail && l.email?.toLowerCase() === custEmail) ids.add(l.id);
      });
    }
    return ids;
  }, [allLeads, customerId, customer]);

  // Filter data for this customer
  const customerInvoices = useMemo(() => {
    if (!invoices) return [];
    return invoices.filter(i => i.customerId === customerId).sort((a, b) => {
      const ta = a.createdAt instanceof Date ? a.createdAt.getTime() : (a.createdAt as any)?.toMillis?.() ?? 0;
      const tb = b.createdAt instanceof Date ? b.createdAt.getTime() : (b.createdAt as any)?.toMillis?.() ?? 0;
      return tb - ta;
    });
  }, [invoices, customerId]);

  const customerProjects = useMemo(() => {
    if (!projects) return [];
    return projects.filter(p => p.customerId === customerId);
  }, [projects, customerId]);

  const allCustomerRequests = useMemo(() => {
    if (!requests) return [];
    return requests.filter(r => r.customerId === customerId).sort((a, b) => {
      const ta = a.createdAt instanceof Date ? a.createdAt.getTime() : (a.createdAt as any)?.toMillis?.() ?? 0;
      const tb = b.createdAt instanceof Date ? b.createdAt.getTime() : (b.createdAt as any)?.toMillis?.() ?? 0;
      return tb - ta;
    });
  }, [requests, customerId]);

  const customerRequests = useMemo(() =>
    allCustomerRequests.filter(r => showArchivedRequests ? r.status === 'Archived' : r.status !== 'Archived'),
    [allCustomerRequests, showArchivedRequests]
  );

  const archivedRequestsCount = useMemo(() =>
    allCustomerRequests.filter(r => r.status === 'Archived').length,
    [allCustomerRequests]
  );

  const handleBulkArchiveRequests = async () => {
    const ids = [...selectedRequestIds];
    await Promise.all(ids.map(id => requestMutation.update(id, { status: 'Archived' } as any)));
    setSelectedRequestIds(new Set());
    toast({ title: `${ids.length} kërkesa u arkivuan` });
  };

  const handleBulkDeleteRequests = async () => {
    if (!confirm(`Je i sigurt që dëshiron të fshish ${selectedRequestIds.size} kërkesa?`)) return;
    const ids = [...selectedRequestIds];
    await Promise.all(ids.map(id => requestMutation.remove(id)));
    setSelectedRequestIds(new Set());
    toast({ title: `${ids.length} kërkesa u fshinë` });
  };

  const toggleRequestSelection = (id: string) => {
    setSelectedRequestIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAllRequests = () => {
    if (selectedRequestIds.size === customerRequests.length) {
      setSelectedRequestIds(new Set());
    } else {
      setSelectedRequestIds(new Set(customerRequests.map(r => r.id)));
    }
  };

  const customerActivities = useMemo(() => {
    if (!activities) return [];
    return activities.filter(a => a.customerId === customerId).sort((a, b) => {
      const ta = a.createdAt instanceof Date ? a.createdAt.getTime() : (a.createdAt as any)?.toMillis?.() ?? 0;
      const tb = b.createdAt instanceof Date ? b.createdAt.getTime() : (b.createdAt as any)?.toMillis?.() ?? 0;
      return tb - ta;
    });
  }, [activities, customerId]);

  const customerQuotes = useMemo(() => {
    if (!quotes) return [];
    return quotes.filter(q =>
      q.customerId === customerId ||
      (q.leadId && linkedLeadIds.has(q.leadId))
    ).sort((a, b) => {
      const ta = a.createdAt instanceof Date ? a.createdAt.getTime() : (a.createdAt as any)?.toMillis?.() ?? 0;
      const tb = b.createdAt instanceof Date ? b.createdAt.getTime() : (b.createdAt as any)?.toMillis?.() ?? 0;
      return tb - ta;
    });
  }, [quotes, customerId, linkedLeadIds]);

  const customerContracts = useMemo(() => {
    if (!allContracts) return [];
    return allContracts.filter(c => c.customerId === customerId).sort((a, b) => {
      const ta = a.createdAt instanceof Date ? a.createdAt.getTime() : (a.createdAt as any)?.toMillis?.() ?? 0;
      const tb = b.createdAt instanceof Date ? b.createdAt.getTime() : (b.createdAt as any)?.toMillis?.() ?? 0;
      return tb - ta;
    });
  }, [allContracts, customerId]);

  // Stats — "revenue" excludes Draft/Cancelled invoices (they aren't billed income).
  const totalRevenue = customerInvoices
    .filter(i => i.status !== 'Draft' && i.status !== 'Cancelled')
    .reduce((s, i) => s + toAll(i.total ?? i.amount ?? 0, (i as any).currency), 0);
  const paidRevenue = customerInvoices.filter(i => i.status === 'Paid').reduce((s, i) => s + toAll(i.total ?? i.amount ?? 0, (i as any).currency), 0);
  const pendingAmount = customerInvoices.filter(i => i.status === 'Pending' || i.status === 'Overdue').reduce((s, i) => s + toAll(i.total ?? i.amount ?? 0, (i as any).currency), 0);
  const activeProjectCount = customerProjects.filter(p => p.status === 'Active').length;

  // Per-client P&L: billed revenue − cost (labor + project expenses, rolled up
  // daily onto each project's `spent`/`laborCost` by the project-spend-rollup cron).
  const clientPnl = useMemo(() => {
    const revenue = totalRevenue;
    const laborCost = customerProjects.reduce((s, p: any) => s + (Number(p.laborCost) || 0), 0);
    const cost = customerProjects.reduce((s, p: any) => s + (Number(p.spent) || 0), 0);
    const expensesCost = Math.max(0, cost - laborCost);
    const margin = revenue - cost;
    const marginPct = revenue > 0 ? Math.round((margin / revenue) * 100) : 0;
    return { revenue, cost, laborCost, expensesCost, margin, marginPct };
  }, [totalRevenue, customerProjects]);

  // Project task progress
  const projectProgress = useMemo(() => {
    return customerProjects.map(p => {
      const projectTasks = tasks?.filter(t => t.projectId === p.id) || [];
      const done = projectTasks.filter(t => t.status === 'Done').length;
      const total = projectTasks.length;
      return { ...p, done, total, pct: total > 0 ? Math.round((done / total) * 100) : 0 };
    });
  }, [customerProjects, tasks]);

  const timeAgo = (date: any) => {
    if (!date) return '';
    const d = date instanceof Date ? date : date?.toDate?.() ? date.toDate() : new Date(date);
    const seconds = Math.floor((new Date().getTime() - d.getTime()) / 1000);
    if (isNaN(seconds) || seconds < 0) return '';
    if (seconds < 60) return 'tani';
    if (seconds < 3600) return `${Math.floor(seconds / 60)} min`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} orë`;
    return `${Math.floor(seconds / 86400)} ditë`;
  };



  const handleAddActivity = async () => {
    if (!activityTitle.trim() || !user) return;
    await activityMutation.create({
      type: activityType as Activity['type'],
      title: activityTitle,
      description: activityDesc || undefined,
      entityType: 'customer',
      entityId: customerId,
      customerId: customerId,
      userId: user.uid,
      createdAt: new Date(),
    } as any);
    setActivityTitle('');
    setActivityDesc('');
    setActivityType('note');
    setIsActivityDialogOpen(false);
  };

  const handleSaveService = async () => {
    if (!customer) return;
    setSavingService(true);
    try {
      const svc = services?.find(s => s.id === selectedServiceId);
      const label = manualServiceLabel?.trim() || svc?.title || svc?.name || undefined;
      await customerMutation.update(customer.id, { serviceLabel: label, serviceId: selectedServiceId || undefined, serviceAuto: false } as any);
      toast({ title: 'Shërbimi u ruajt' });
      setIsServiceDialogOpen(false);
    } catch (e) {
      toast({ title: 'Gabim', description: 'Ndodhi një gabim gjatë ruajtjes', variant: 'destructive' });
    } finally {
      setSavingService(false);
    }
  };

  const handleAutoDetectService = async () => {
    if (!customer) return;
    setIsAutoDetecting(true);
    try {
      // Prefer accepted quotes, then most recent quote, then invoices
      const accepted = customerQuotes.find(q => q.status === 'Accepted');
      const recent = customerQuotes[0];
      let label: string | undefined;
      if (accepted) label = accepted.label || accepted.result?.suggestedLabel;
      else if (recent) label = recent.label || recent.result?.suggestedLabel;
      if (!label && customerInvoices.length > 0) {
        // Fallback to an invoice DESCRIPTION only — an invoice NUMBER (e.g. FAT-0007)
        // is meaningless as a service label, so don't stamp it.
        label = (customerInvoices[0] as any).description || undefined;
      }
      if (!label) {
        toast({ title: 'Nuk u gjet shërbim për tu vendosur automatikisht' });
        return;
      }
      await customerMutation.update(customer.id, { serviceLabel: label, serviceAuto: true } as any);
      toast({ title: 'Shërbimi u vendos automatikisht' });
      setIsServiceDialogOpen(false);
    } catch (e) {
      toast({ title: 'Gabim', description: 'Detaj gabimi i paqartë', variant: 'destructive' });
    } finally {
      setIsAutoDetecting(false);
    }
  };

  if (!customer) {
    return (
      <div className="text-center py-20">
        <p className="text-muted-foreground">Klienti nuk u gjet</p>
        <Button variant="outline" className="mt-4" onClick={() => navigate('/app/customers')}>
          Kthehu te klientët
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/app/customers')}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">{customer.name}</h1>
          <div className="flex items-center gap-3 text-sm text-muted-foreground mt-1 flex-wrap">
            {(customer as any).company && (
              <span className="flex items-center gap-1"><Building2 className="w-3.5 h-3.5" />{(customer as any).company}</span>
            )}
            {customer.email && (
              <span className="flex items-center gap-1"><Mail className="w-3.5 h-3.5" />{customer.email}</span>
            )}
            {customer.phone && (
              <span className="flex items-center gap-1"><Phone className="w-3.5 h-3.5" />{customer.phone}</span>
            )}
          </div>
        </div>
        {canPreviewAsCustomer && customerId && (
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => {
              permissions.setPreviewCustomer(customerId, customer.name);
              navigate('/portal');
            }}
            title="Hap portalin e klientit ashtu si e sheh ai"
          >
            <Eye className="w-4 h-4" />
            Shiko si klient
          </Button>
        )}
        <Badge className={getStatusColor((customer as any).status || 'Active')} variant="secondary">
          {(customer as any).status || 'Active'}
        </Badge>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <DollarSign className="w-5 h-5 text-green-500" />
            <div>
              <p className="text-xs text-muted-foreground">Të Ardhura</p>
              <p className="text-lg font-bold">{totalRevenue.toLocaleString()} ALL</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <Clock className="w-5 h-5 text-yellow-500" />
            <div>
              <p className="text-xs text-muted-foreground">Në Pritje</p>
              <p className="text-lg font-bold">{pendingAmount.toLocaleString()} ALL</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <Target className="w-5 h-5 text-blue-500" />
            <div>
              <p className="text-xs text-muted-foreground">Projekte Aktive</p>
              <p className="text-lg font-bold">{activeProjectCount}</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <FileText className="w-5 h-5 text-primary" />
            <div>
              <p className="text-xs text-muted-foreground">Fatura Gjithsej</p>
              <p className="text-lg font-bold">{customerInvoices.length}</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Per-client P&L */}
      <Card className="p-4">
        <div className="flex items-center justify-between gap-2 mb-3">
          <h3 className="text-sm font-semibold text-foreground">Fitim/Humbje (P&amp;L) e klientit</h3>
          <span className={`text-sm font-bold tabular-nums ${clientPnl.margin < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
            Marzh: {clientPnl.margin.toLocaleString()} ALL {clientPnl.revenue > 0 && `(${clientPnl.marginPct}%)`}
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Të ardhura (faturuar)</p>
            <p className="font-bold tabular-nums text-emerald-600">{clientPnl.revenue.toLocaleString()} ALL</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Kosto pune</p>
            <p className="font-bold tabular-nums">{clientPnl.laborCost.toLocaleString()} ALL</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Shpenzime</p>
            <p className="font-bold tabular-nums">{clientPnl.expensesCost.toLocaleString()} ALL</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Kosto totale</p>
            <p className="font-bold tabular-nums text-red-600">{clientPnl.cost.toLocaleString()} ALL</p>
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground mt-2">
          Kostoja e punës = orët e loguara × tarifa e kostos së anëtarit; përditësohet nga rollup-i ditor.
        </p>
      </Card>

      {/* Tabs */}
      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="flex-wrap">
          <TabsTrigger value="overview">Përmbledhje</TabsTrigger>
          <TabsTrigger value="invoices">Faturat ({customerInvoices.length})</TabsTrigger>
          <TabsTrigger value="projects">Projektet ({customerProjects.length})</TabsTrigger>
          <TabsTrigger value="requests">Kërkesat ({allCustomerRequests.filter(r => r.status !== 'Archived').length})</TabsTrigger>
          <TabsTrigger value="activities">Aktivitete ({customerActivities.length})</TabsTrigger>
          <TabsTrigger value="quotes">Preventiva ({customerQuotes.length})</TabsTrigger>
          <TabsTrigger value="contracts">Kontratat ({customerContracts.length})</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Customer Info */}
            <Card>
              <CardHeader><CardTitle className="text-base">Informacioni i Klientit</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm">
                {/* Service label display + edit */}
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Shërbimi</span>
                  <div className="flex items-center gap-2">
                    <span>{(customer as any).serviceLabel || '-'}</span>
                    <Button size="sm" variant="ghost" onClick={() => {
                      setSelectedServiceId((customer as any).serviceId || null);
                      setManualServiceLabel((customer as any).serviceLabel || '');
                      setIsServiceDialogOpen(true);
                    }}>Ndrysho</Button>
                  </div>
                </div>
                {customer.email && <div className="flex justify-between"><span className="text-muted-foreground">Email</span><span>{customer.email}</span></div>}
                {customer.phone && <div className="flex justify-between"><span className="text-muted-foreground">Telefon</span><span>{customer.phone}</span></div>}
                {(customer as any).company && <div className="flex justify-between"><span className="text-muted-foreground">Kompani</span><span>{(customer as any).company}</span></div>}
                {(customer as any).industry && <div className="flex justify-between"><span className="text-muted-foreground">Industri</span><span>{(customer as any).industry}</span></div>}
                {(customer as any).website && <div className="flex justify-between"><span className="text-muted-foreground">Website</span><a href={safeHref((customer as any).website)} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{(customer as any).website}</a></div>}
                {customer.address && <div className="flex justify-between"><span className="text-muted-foreground">Adresa</span><span>{customer.address}</span></div>}
                {(customer as any).taxId && <div className="flex justify-between"><span className="text-muted-foreground">NIPT</span><span>{(customer as any).taxId}</span></div>}
                {(customer as any).contactPerson && <div className="flex justify-between"><span className="text-muted-foreground">Kontakt</span><span>{(customer as any).contactPerson}</span></div>}
                {(customer as any).notes && <><Separator /><p className="text-muted-foreground">{(customer as any).notes}</p></>}
              </CardContent>
            </Card>

            {/* Recent Activity */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Aktiviteti i Fundit</CardTitle>
                  <Button size="sm" variant="outline" onClick={() => setIsActivityDialogOpen(true)}>
                    <Plus className="w-3.5 h-3.5 mr-1" /> Shto
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {customerActivities.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">Nuk ka aktivitet. Shtoni thirrje, takime, ose shënime.</p>
                ) : (
                  <div className="space-y-3">
                    {customerActivities.slice(0, 8).map(act => (
                      <div key={act.id} className="flex items-start gap-2 text-sm py-1.5 border-b last:border-0">
                        <div className="mt-0.5">
                          {act.type === 'call' ? <Phone className="w-3.5 h-3.5 text-orange-500" /> :
                           act.type === 'meeting' ? <Calendar className="w-3.5 h-3.5 text-blue-500" /> :
                           act.type === 'email_sent' ? <Mail className="w-3.5 h-3.5 text-primary" /> :
                           <ClipboardList className="w-3.5 h-3.5 text-gray-500" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium">{act.title}</p>
                          {act.description && <p className="text-muted-foreground text-xs mt-0.5">{act.description}</p>}
                        </div>
                        <span className="text-xs text-muted-foreground whitespace-nowrap">{timeAgo(act.createdAt)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Recent Invoices */}
            <Card>
              <CardHeader><CardTitle className="text-base">Faturat e Fundit</CardTitle></CardHeader>
              <CardContent>
                {customerInvoices.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">Nuk ka fatura</p>
                ) : (
                  <div className="space-y-2">
                    {customerInvoices.slice(0, 5).map(inv => (
                      <div key={inv.id} className="flex items-center justify-between text-sm py-1.5 border-b last:border-0">
                        <div>
                          <p className="font-medium">{inv.invoiceNumber || `INV-${inv.id.slice(0, 6)}`}</p>
                          <p className="text-xs text-muted-foreground">{inv.createdAt instanceof Date ? inv.createdAt.toLocaleDateString('sq-AL') : ''}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold">{(inv.total || inv.amount || 0).toLocaleString()} {(inv as any).currency === 'EUR' ? '€' : 'L'}</span>
                          <Badge className={getStatusColor(inv.status)} variant="secondary">{inv.status}</Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Active Projects */}
            <Card>
              <CardHeader><CardTitle className="text-base">Projektet</CardTitle></CardHeader>
              <CardContent>
                {projectProgress.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">Nuk ka projekte</p>
                ) : (
                  <div className="space-y-3">
                    {projectProgress.map(p => (
                      <div key={p.id} className="space-y-1.5">
                        <div className="flex items-center justify-between text-sm">
                          <span className="font-medium truncate max-w-[60%]">{p.name}</span>
                          <div className="flex items-center gap-2">
                            <Badge className={getStatusColor(p.status)} variant="secondary">{p.status}</Badge>
                            <span className="text-xs text-muted-foreground">{p.pct}%</span>
                          </div>
                        </div>
                        <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                          <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${p.pct}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Invoices Tab */}
        <TabsContent value="invoices">
          <Card>
            <CardContent className="pt-6">
              {customerInvoices.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">Nuk ka fatura për këtë klient</p>
              ) : (
                <>
                {/* Mobile: stacked cards */}
                <div className="sm:hidden space-y-2">
                  {customerInvoices.map(inv => (
                    <div key={inv.id} className="p-3 rounded-lg border bg-card">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-sm">{inv.invoiceNumber || inv.id.slice(0, 8)}</span>
                        <Badge className={getStatusColor(inv.status)} variant="secondary">{inv.status}</Badge>
                      </div>
                      <div className="mt-1 flex items-center justify-between text-sm">
                        <span className="font-semibold">{(inv.total || inv.amount || 0).toLocaleString()} {(inv as any).currency === 'EUR' ? '€' : 'L'}</span>
                        <span className="text-xs text-muted-foreground">Afati: {inv.dueDate instanceof Date ? inv.dueDate.toLocaleDateString('sq-AL') : '-'}</span>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {inv.createdAt instanceof Date ? inv.createdAt.toLocaleDateString('sq-AL') : ''} · {inv.paymentMethod || '-'}
                      </div>
                    </div>
                  ))}
                  <div className="flex items-center justify-between p-3 rounded-lg bg-muted font-semibold text-sm">
                    <span>Totali</span>
                    <span>{totalRevenue.toLocaleString()} ALL</span>
                  </div>
                </div>
                {/* Desktop: table */}
                <div className="hidden sm:block overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted">
                      <tr>
                        <th className="px-4 py-2 text-left">Fatura #</th>
                        <th className="px-4 py-2 text-left">Data</th>
                        <th className="px-4 py-2 text-left">Afati</th>
                        <th className="px-4 py-2 text-right">Shuma</th>
                        <th className="px-4 py-2 text-left">Statusi</th>
                        <th className="px-4 py-2 text-left">Pagesa</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {customerInvoices.map(inv => (
                        <tr key={inv.id} className="hover:bg-muted/50">
                          <td className="px-4 py-2.5 font-mono">{inv.invoiceNumber || inv.id.slice(0, 8)}</td>
                          <td className="px-4 py-2.5">{inv.createdAt instanceof Date ? inv.createdAt.toLocaleDateString('sq-AL') : ''}</td>
                          <td className="px-4 py-2.5">{inv.dueDate instanceof Date ? inv.dueDate.toLocaleDateString('sq-AL') : '-'}</td>
                          <td className="px-4 py-2.5 text-right font-semibold">{(inv.total || inv.amount || 0).toLocaleString()} {(inv as any).currency === 'EUR' ? '€' : 'L'}</td>
                          <td className="px-4 py-2.5"><Badge className={getStatusColor(inv.status)} variant="secondary">{inv.status}</Badge></td>
                          <td className="px-4 py-2.5">{inv.paymentMethod || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="border-t-2">
                      <tr>
                        <td colSpan={3} className="px-4 py-2 font-semibold">Totali</td>
                        <td className="px-4 py-2 text-right font-bold">{totalRevenue.toLocaleString()} ALL</td>
                        <td colSpan={2} className="px-4 py-2 text-sm text-muted-foreground">Paguar: {paidRevenue.toLocaleString()} ALL</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Projects Tab */}
        <TabsContent value="projects">
          <div className="space-y-4">
            {projectProgress.length === 0 ? (
              <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">Nuk ka projekte për këtë klient</CardContent></Card>
            ) : (
              projectProgress.map(p => (
                <Card key={p.id} className="p-5">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <h3 className="font-semibold">{p.name}</h3>
                      {p.description && <p className="text-sm text-muted-foreground mt-0.5">{p.description}</p>}
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge className={getStatusColor(p.status)} variant="secondary">{p.status}</Badge>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">{p.done}/{p.total} detyra të përfunduara</span>
                      <span className="font-medium">{p.pct}%</span>
                    </div>
                    <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${p.pct}%` }} />
                    </div>
                    {p.budget != null && (
                      <div className="flex justify-between text-xs text-muted-foreground mt-1">
                        <span>Buxheti: {p.budget.toLocaleString()} ALL</span>
                        <span>Shpenzuar: {(p.spent || 0).toLocaleString()} ALL</span>
                      </div>
                    )}
                  </div>
                </Card>
              ))
            )}
          </div>
        </TabsContent>

        {/* Requests Tab */}
        <TabsContent value="requests">
          <Card>
            <CardContent className="pt-4">
              {/* Toolbar */}
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <div className="flex items-center gap-2">
                  {selectedRequestIds.size > 0 && (
                    <>
                      <Button size="sm" variant="outline" onClick={handleBulkArchiveRequests} className="gap-1.5 text-xs">
                        <Archive className="w-3.5 h-3.5" /> Arkivo ({selectedRequestIds.size})
                      </Button>
                      <Button size="sm" variant="outline" onClick={handleBulkDeleteRequests} className="gap-1.5 text-xs text-red-600 border-red-200 hover:bg-red-50">
                        <Trash2 className="w-3.5 h-3.5" /> Fshi ({selectedRequestIds.size})
                      </Button>
                    </>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-xs text-muted-foreground"
                  onClick={() => { setShowArchivedRequests(v => !v); setSelectedRequestIds(new Set()); }}
                >
                  <Archive className="w-3.5 h-3.5 mr-1" />
                  {showArchivedRequests ? 'Shfaq aktive' : `Arkivi (${archivedRequestsCount})`}
                </Button>
              </div>

              {customerRequests.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  {showArchivedRequests ? 'Nuk ka kërkesa të arkivuara' : 'Nuk ka kërkesa'}
                </p>
              ) : (
                <div className="space-y-0.5">
                  {/* Select-all row */}
                  <div className="flex items-center gap-2 px-1 pb-2 border-b mb-1">
                    <button onClick={toggleAllRequests} className="text-muted-foreground hover:text-foreground">
                      {selectedRequestIds.size === customerRequests.length && customerRequests.length > 0
                        ? <CheckSquare className="w-4 h-4" />
                        : <Square className="w-4 h-4" />
                      }
                    </button>
                    <span className="text-xs text-muted-foreground">
                      {selectedRequestIds.size > 0 ? `${selectedRequestIds.size} zgjedhur` : 'Zgjidh të gjitha'}
                    </span>
                  </div>

                  {customerRequests.map(req => (
                    <div key={req.id} className="flex items-center gap-2 py-2.5 border-b last:border-0">
                      <button onClick={() => toggleRequestSelection(req.id)} className="flex-shrink-0 text-muted-foreground hover:text-foreground">
                        {selectedRequestIds.has(req.id)
                          ? <CheckSquare className="w-4 h-4 text-primary" />
                          : <Square className="w-4 h-4" />
                        }
                      </button>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{req.title}</p>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                          <span>{req.category}</span>
                          <span>•</span>
                          <span>{req.createdAt instanceof Date ? req.createdAt.toLocaleDateString('sq-AL') : ''}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <Badge variant="outline" className="text-xs">{req.priority}</Badge>
                        <Badge className={getStatusColor(req.status)} variant="secondary">{req.status}</Badge>
                        {!showArchivedRequests && (
                          <button
                            onClick={() => requestMutation.update(req.id, { status: 'Archived' } as any)}
                            className="p-1 text-muted-foreground hover:text-foreground rounded"
                            title="Arkivo"
                          >
                            <Archive className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          onClick={async () => {
                            if (!confirm('Fshi kërkesën?')) return;
                            await requestMutation.remove(req.id);
                            toast({ title: 'Kërkesa u fshi' });
                          }}
                          className="p-1 text-muted-foreground hover:text-red-600 rounded"
                          title="Fshi"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Activities Tab */}
        <TabsContent value="activities">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Histori Aktivitetesh</CardTitle>
                <Button size="sm" onClick={() => setIsActivityDialogOpen(true)}>
                  <Plus className="w-4 h-4 mr-1" /> Shto Aktivitet
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {customerActivities.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">Shtoni thirrje, takime, email, ose shënime për këtë klient.</p>
              ) : (
                <div className="space-y-3">
                  {customerActivities.map(act => (
                    <div key={act.id} className="flex items-start gap-3 py-2.5 border-b last:border-0">
                      <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0 mt-0.5">
                        {act.type === 'call' ? <Phone className="w-4 h-4 text-orange-500" /> :
                         act.type === 'meeting' ? <Calendar className="w-4 h-4 text-blue-500" /> :
                         act.type === 'email_sent' ? <Mail className="w-4 h-4 text-primary" /> :
                         <ClipboardList className="w-4 h-4 text-gray-500" />}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-sm">{act.title}</p>
                          <Badge variant="outline" className="text-xs">{
                            act.type === 'call' ? 'Thirrje' :
                            act.type === 'meeting' ? 'Takim' :
                            act.type === 'email_sent' ? 'Email' : 'Shënim'
                          }</Badge>
                        </div>
                        {act.description && <p className="text-sm text-muted-foreground mt-0.5">{act.description}</p>}
                        <p className="text-xs text-muted-foreground mt-1">{act.createdAt instanceof Date ? act.createdAt.toLocaleString('sq-AL') : ''}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Quotes / Preventiva Tab */}
        <TabsContent value="quotes">
          <Card>
            <CardContent className="pt-6">
              {customerQuotes.length === 0 ? (
                <div className="text-center py-8 space-y-3">
                  <FileText className="w-10 h-10 mx-auto text-muted-foreground/40" />
                  <p className="text-sm text-muted-foreground">Nuk ka preventiva për këtë klient.</p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => navigate('/app/price-calculator')}
                  >
                    <Calculator className="w-4 h-4 mr-1.5" />
                    Krijo Preventivë
                  </Button>
                </div>
              ) : (
                <>
                {/* Mobile: stacked cards (8-column table is too wide for a phone) */}
                <div className="sm:hidden space-y-2">
                  {customerQuotes.map(q => {
                    const cur = q.currency === 'EUR' ? '€' : q.currency === 'USD' ? '$' : 'L';
                    return (
                      <div key={q.id} className="p-3 rounded-lg border bg-card space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium truncate flex items-center gap-1.5">
                            {q.label || q.result?.suggestedLabel || '-'}
                            {q.version && q.version > 1 && <Badge variant="outline" className="text-[10px] px-1.5">v{q.version}</Badge>}
                          </span>
                          <Badge variant="secondary" className={
                            q.status === 'Accepted' ? 'bg-green-100 text-green-700' :
                            q.status === 'Rejected' ? 'bg-red-100 text-red-700' :
                            q.status === 'Sent' ? 'bg-blue-100 text-blue-700' :
                            'bg-gray-100 text-gray-700'
                          }>{q.status}</Badge>
                        </div>
                        <div className="flex items-center justify-between text-sm">
                          <span className="font-semibold tabular-nums">{(q.result?.grandTotal ?? 0).toLocaleString()} {cur}</span>
                          <span className="text-xs text-muted-foreground">{q.createdAt instanceof Date ? q.createdAt.toLocaleDateString('sq-AL') : ''}</span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          One-time: {(q.result?.totalOneTime ?? 0).toLocaleString()} {cur} · Mujore: {(q.result?.totalMonthly ?? 0).toLocaleString()} {cur} · {q.result?.enabledServicesCount ?? 0} shërbime
                        </div>
                        {q.status === 'Draft' && (
                          <Button size="sm" variant="outline" className="w-full h-9 gap-1 text-blue-600 border-blue-200 hover:bg-blue-50" disabled={sendingQuoteId === q.id} onClick={async () => {
                            setSendingQuoteId(q.id);
                            try { await quoteMutation.update(q.id, { status: 'Sent' }); toast({ title: '✅ Preventiva u dërgua te klienti!' }); }
                            catch { toast({ title: 'Gabim', description: 'Ndodhi një gabim', variant: 'destructive' }); }
                            finally { setSendingQuoteId(null); }
                          }}>
                            <Send className="w-3.5 h-3.5" /> Dërgo
                          </Button>
                        )}
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" className="flex-1 h-8 gap-1 text-xs" onClick={() => downloadQuotePdf(q)}>
                            <Download className="w-3.5 h-3.5" /> PDF
                          </Button>
                          <Button size="sm" variant="outline" className="flex-1 h-8 gap-1 text-xs" onClick={() => createQuoteVersion(q)}>
                            <Copy className="w-3.5 h-3.5" /> Version i ri
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {/* Desktop: table */}
                <div className="hidden sm:block overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted">
                      <tr>
                        <th className="px-4 py-2 text-left">Label</th>
                        <th className="px-4 py-2 text-left">Data</th>
                        <th className="px-4 py-2 text-right">One-time</th>
                        <th className="px-4 py-2 text-right">Mujore</th>
                        <th className="px-4 py-2 text-right">Grand Total</th>
                        <th className="px-4 py-2 text-left">Statusi</th>
                        <th className="px-4 py-2 text-center">Shërbime</th>
                        <th className="px-4 py-2 text-center">Veprime</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {customerQuotes.map(q => {
                        const cur = q.currency === 'EUR' ? '€' : q.currency === 'USD' ? '$' : 'L';
                        return (
                          <tr key={q.id} className="hover:bg-muted/50">
                            <td className="px-4 py-2.5 font-medium">{q.label || q.result?.suggestedLabel || '-'}</td>
                            <td className="px-4 py-2.5">{q.createdAt instanceof Date ? q.createdAt.toLocaleDateString('sq-AL') : ''}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums">{(q.result?.totalOneTime ?? 0).toLocaleString()} {cur}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums">{(q.result?.totalMonthly ?? 0).toLocaleString()} {cur}/muaj</td>
                            <td className="px-4 py-2.5 text-right font-semibold tabular-nums">{(q.result?.grandTotal ?? 0).toLocaleString()} {cur}</td>
                            <td className="px-4 py-2.5">
                              <Badge variant="secondary" className={
                                q.status === 'Accepted' ? 'bg-green-100 text-green-700' :
                                q.status === 'Rejected' ? 'bg-red-100 text-red-700' :
                                q.status === 'Sent' ? 'bg-blue-100 text-blue-700' :
                                'bg-gray-100 text-gray-700'
                              }>{q.status}</Badge>
                            </td>
                            <td className="px-4 py-2.5 text-center">{q.result?.enabledServicesCount ?? 0}</td>
                            <td className="px-4 py-2.5 text-center">
                              {q.status === 'Draft' && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="text-xs h-7 gap-1 text-blue-600 border-blue-200 hover:bg-blue-50"
                                  disabled={sendingQuoteId === q.id}
                                  onClick={async () => {
                                    setSendingQuoteId(q.id);
                                    try {
                                      await quoteMutation.update(q.id, { status: 'Sent' });
                                      toast({ title: '✅ Preventiva u dërgua te klienti!' });
                                    } catch {
                                      toast({ title: 'Gabim', description: 'Ndodhi një gabim', variant: 'destructive' });
                                    } finally {
                                      setSendingQuoteId(null);
                                    }
                                  }}
                                >
                                  <Send className="w-3 h-3" />
                                  Dërgo
                                </Button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Contracts Tab */}
        <TabsContent value="contracts">
          <Card>
            <CardContent className="pt-6">
              {customerContracts.length === 0 ? (
                <div className="text-center py-8 space-y-3">
                  <FileText className="w-10 h-10 mx-auto text-muted-foreground/40" />
                  <p className="text-sm text-muted-foreground">Nuk ka kontratat për këtë klient.</p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => navigate('/app/contracts')}
                  >
                    <Send className="w-4 h-4 mr-1.5" />
                    Krijo Kontratë
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex justify-end">
                    <Button variant="outline" size="sm" onClick={() => navigate('/app/contracts')}>
                      <Send className="w-3.5 h-3.5 mr-1.5" /> Krijo Kontratë të Re
                    </Button>
                  </div>
                  {/* Mobile: stacked cards */}
                  <div className="sm:hidden space-y-2">
                    {customerContracts.map(c => {
                      const fmtDate = (d: any) => { if (!d) return '—'; const date = d instanceof Date ? d : d?.toDate?.(); return date ? date.toLocaleDateString('sq-AL') : '—'; };
                      const statusLabel = c.status === 'Draft' ? 'Draft' : c.status === 'Sent' ? 'Dërguar' : c.status === 'Signed' ? 'Nënshkruar' : c.status === 'Rejected' ? 'Refuzuar' : 'Skaduar';
                      return (
                        <div key={c.id} className="p-3 rounded-lg border bg-card space-y-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium truncate">{c.title}</span>
                            <Badge variant="secondary" className={
                              c.status === 'Signed' ? 'bg-green-100 text-green-700' :
                              c.status === 'Rejected' ? 'bg-red-100 text-red-700' :
                              c.status === 'Sent' ? 'bg-blue-100 text-blue-700' :
                              c.status === 'Expired' ? 'bg-orange-100 text-orange-700' :
                              'bg-gray-100 text-gray-700'
                            }>{statusLabel}</Badge>
                          </div>
                          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                            <span>Krijuar: {fmtDate(c.createdAt)}</span>
                            {c.sentAt && <span>Dërguar: {fmtDate(c.sentAt)}</span>}
                            {c.signedAt && <span className="text-green-600 font-medium">Nënshkruar: {fmtDate(c.signedAt)}</span>}
                          </div>
                          {c.status === 'Draft' && (
                            <Button size="sm" variant="outline" className="w-full h-9 gap-1 text-blue-600 border-blue-200 hover:bg-blue-50" disabled={sendingContractId === c.id} onClick={async () => {
                              setSendingContractId(c.id);
                              try { await contractMutation.update(c.id, { status: 'Sent', sentAt: new Date(), updatedAt: new Date() } as any); toast({ title: '✅ Kontrata u dërgua te klienti!' }); }
                              catch { toast({ title: 'Gabim', variant: 'destructive' }); }
                              finally { setSendingContractId(null); }
                            }}>
                              <Send className="w-3.5 h-3.5" /> Dërgo
                            </Button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {/* Desktop: table */}
                  <div className="hidden sm:block overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted">
                        <tr>
                          <th className="px-4 py-2 text-left">Titulli</th>
                          <th className="px-4 py-2 text-left">Data</th>
                          <th className="px-4 py-2 text-left">Statusi</th>
                          <th className="px-4 py-2 text-left">Dërguar</th>
                          <th className="px-4 py-2 text-left">Nënshkruar</th>
                          <th className="px-4 py-2 text-center">Veprime</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {customerContracts.map(c => {
                          const fmtDate = (d: any) => {
                            if (!d) return '—';
                            const date = d instanceof Date ? d : d?.toDate?.();
                            return date ? date.toLocaleDateString('sq-AL') : '—';
                          };
                          return (
                            <tr key={c.id} className="hover:bg-muted/50">
                              <td className="px-4 py-2.5 font-medium max-w-[200px] truncate">{c.title}</td>
                              <td className="px-4 py-2.5">{fmtDate(c.createdAt)}</td>
                              <td className="px-4 py-2.5">
                                <Badge variant="secondary" className={
                                  c.status === 'Signed' ? 'bg-green-100 text-green-700' :
                                  c.status === 'Rejected' ? 'bg-red-100 text-red-700' :
                                  c.status === 'Sent' ? 'bg-blue-100 text-blue-700' :
                                  c.status === 'Expired' ? 'bg-orange-100 text-orange-700' :
                                  'bg-gray-100 text-gray-700'
                                }>
                                  {c.status === 'Draft' ? 'Draft' :
                                   c.status === 'Sent' ? 'Dërguar' :
                                   c.status === 'Signed' ? 'Nënshkruar' :
                                   c.status === 'Rejected' ? 'Refuzuar' : 'Skaduar'}
                                </Badge>
                              </td>
                              <td className="px-4 py-2.5">{fmtDate(c.sentAt)}</td>
                              <td className="px-4 py-2.5">
                                {c.signedAt ? (
                                  <span className="text-green-600 font-medium">{fmtDate(c.signedAt)}</span>
                                ) : '—'}
                              </td>
                              <td className="px-4 py-2.5 text-center">
                                {c.status === 'Draft' && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="text-xs h-7 gap-1 text-blue-600 border-blue-200 hover:bg-blue-50"
                                    disabled={sendingContractId === c.id}
                                    onClick={async () => {
                                      setSendingContractId(c.id);
                                      try {
                                        await contractMutation.update(c.id, { status: 'Sent', sentAt: new Date(), updatedAt: new Date() } as any);
                                        toast({ title: '✅ Kontrata u dërgua te klienti!' });
                                      } catch {
                                        toast({ title: 'Gabim', variant: 'destructive' });
                                      } finally {
                                        setSendingContractId(null);
                                      }
                                    }}
                                  >
                                    <Send className="w-3 h-3" />
                                    Dërgo
                                  </Button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Add Activity Dialog */}
      <Dialog open={isActivityDialogOpen} onOpenChange={setIsActivityDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Shto Aktivitet</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Lloji</Label>
              <Select value={activityType} onValueChange={setActivityType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="call">Thirrje Telefonike</SelectItem>
                  <SelectItem value="meeting">Takim</SelectItem>
                  <SelectItem value="email_sent">Email i Dërguar</SelectItem>
                  <SelectItem value="note">Shënim</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Titulli *</Label>
              <Input value={activityTitle} onChange={e => setActivityTitle(e.target.value)} placeholder="P.sh. Thirrje follow-up" />
            </div>
            <div>
              <Label>Përshkrimi</Label>
              <Textarea value={activityDesc} onChange={e => setActivityDesc(e.target.value)} placeholder="Detaje shtesë..." rows={3} />
            </div>
            <Button className="w-full" onClick={handleAddActivity} disabled={!activityTitle.trim()}>
              Ruaj Aktivitetin
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {/* Service label Dialog */}
      <Dialog open={isServiceDialogOpen} onOpenChange={setIsServiceDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Vendos Shërbimin për Klientin</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Zgjedh Shërbim nga lista</Label>
              <Select value={selectedServiceId || ''} onValueChange={(v) => setSelectedServiceId(v || null)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">(Asnjë)</SelectItem>
                  {services?.map(s => (
                    <SelectItem key={s.id} value={s.id}>{s.title || s.name || s.id}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Label Manual (opsionale)</Label>
              <Input value={manualServiceLabel} onChange={e => setManualServiceLabel(e.target.value)} placeholder="P.sh. Paketë SEO - 6 muaj" />
            </div>
            <div className="flex gap-2">
              <Button onClick={handleSaveService} disabled={savingService} className="flex-1">Ruaj</Button>
              <Button variant="outline" onClick={handleAutoDetectService} disabled={isAutoDetecting} className="flex-1">Zbulim Automatik</Button>
              <Button variant="ghost" onClick={() => setIsServiceDialogOpen(false)}>Anulo</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Customer360View;
