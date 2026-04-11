import React, { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useCollection, useMutation } from '../hooks/useFirestore';
import { useAuth } from '../contexts/AuthContext';
import { getStatusColor } from '../lib/statusColors';
import {
  ArrowLeft, Building2, Mail, Phone, FileText, DollarSign,
  ClipboardList, Calendar, Plus, Clock, Target, Calculator
} from 'lucide-react';
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
import type { Customer, Invoice, Project, ClientRequest, Activity, Task, Quote, Lead } from '../types';

const Customer360View: React.FC = () => {
  const { customerId } = useParams<{ customerId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [isActivityDialogOpen, setIsActivityDialogOpen] = useState(false);
  const [activityType, setActivityType] = useState<string>('note');
  const [activityTitle, setActivityTitle] = useState('');
  const [activityDesc, setActivityDesc] = useState('');

  // Data
  const { data: customers } = useCollection<Customer>('customers', { skipTeamFilter: true });
  const { data: invoices } = useCollection<Invoice>('invoices', { skipTeamFilter: true });
  const { data: projects } = useCollection<Project>('projects', { skipTeamFilter: true });
  const { data: requests } = useCollection<ClientRequest>('clientRequests', { skipTeamFilter: true });
  const { data: activities } = useCollection<Activity>('activities', { skipTeamFilter: true });
  const { data: tasks } = useCollection<Task>('tasks', { skipTeamFilter: true });
  const { data: quotes } = useCollection<Quote>('quotes', { skipTeamFilter: true });
  const { data: allLeads } = useCollection<Lead>('leads', { skipTeamFilter: true });
  const activityMutation = useMutation<Activity>('activities');

  const customer = customers?.find(c => c.id === customerId);

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

  const customerRequests = useMemo(() => {
    if (!requests) return [];
    return requests.filter(r => r.customerId === customerId).sort((a, b) => {
      const ta = a.createdAt instanceof Date ? a.createdAt.getTime() : (a.createdAt as any)?.toMillis?.() ?? 0;
      const tb = b.createdAt instanceof Date ? b.createdAt.getTime() : (b.createdAt as any)?.toMillis?.() ?? 0;
      return tb - ta;
    });
  }, [requests, customerId]);

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

  // Stats
  const totalRevenue = customerInvoices.reduce((s, i) => s + toAll(i.total ?? i.amount ?? 0, (i as any).currency), 0);
  const paidRevenue = customerInvoices.filter(i => i.status === 'Paid').reduce((s, i) => s + toAll(i.total ?? i.amount ?? 0, (i as any).currency), 0);
  const pendingAmount = customerInvoices.filter(i => i.status === 'Pending' || i.status === 'Overdue').reduce((s, i) => s + toAll(i.total ?? i.amount ?? 0, (i as any).currency), 0);
  const activeProjectCount = customerProjects.filter(p => p.status === 'Active').length;

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
            <FileText className="w-5 h-5 text-indigo-500" />
            <div>
              <p className="text-xs text-muted-foreground">Fatura Gjithsej</p>
              <p className="text-lg font-bold">{customerInvoices.length}</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="flex-wrap">
          <TabsTrigger value="overview">Përmbledhje</TabsTrigger>
          <TabsTrigger value="invoices">Faturat ({customerInvoices.length})</TabsTrigger>
          <TabsTrigger value="projects">Projektet ({customerProjects.length})</TabsTrigger>
          <TabsTrigger value="requests">Kërkesat ({customerRequests.length})</TabsTrigger>
          <TabsTrigger value="activities">Aktivitete ({customerActivities.length})</TabsTrigger>
          <TabsTrigger value="quotes">Preventiva ({customerQuotes.length})</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Customer Info */}
            <Card>
              <CardHeader><CardTitle className="text-base">Informacioni i Klientit</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm">
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
                           act.type === 'email_sent' ? <Mail className="w-3.5 h-3.5 text-purple-500" /> :
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
                <div className="overflow-x-auto">
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
            <CardContent className="pt-6">
              {customerRequests.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">Nuk ka kërkesa</p>
              ) : (
                <div className="space-y-3">
                  {customerRequests.map(req => (
                    <div key={req.id} className="flex items-center justify-between py-3 border-b last:border-0">
                      <div>
                        <p className="font-medium text-sm">{req.title}</p>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                          <span>{req.category}</span>
                          <span>•</span>
                          <span>{req.createdAt instanceof Date ? req.createdAt.toLocaleDateString('sq-AL') : ''}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs">{req.priority}</Badge>
                        <Badge className={getStatusColor(req.status)} variant="secondary">{req.status}</Badge>
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
                         act.type === 'email_sent' ? <Mail className="w-4 h-4 text-purple-500" /> :
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
                <div className="overflow-x-auto">
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
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
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
    </div>
  );
};

export default Customer360View;
