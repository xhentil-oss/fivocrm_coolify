import React from 'react';
import { useClientPortal } from '../../hooks/useClientPortal';
import { useCollection } from '../../hooks/useFirestore';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { FileText, ShoppingBag, ClipboardList, DollarSign, Clock, FolderKanban, CheckCircle2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { Invoice, InvoiceItem, Service, ClientRequest, Project, Task } from '../../types';

const PortalDashboard: React.FC = () => {
  const { customerId } = useClientPortal();

  const { data: rawInvoices } = useCollection<Invoice>('invoices', {
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

  const { data: invoiceItems } = useCollection<InvoiceItem>('invoiceItems', { skipTeamFilter: true });
  useCollection<Service>('services', { skipTeamFilter: true });

  const { data: rawRequests } = useCollection<ClientRequest>('clientRequests', {
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

  // Projects for this customer
  const { data: rawProjects } = useCollection<Project>('projects', {
    where: [{ field: 'customerId', operator: '==', value: customerId || '' }],
    skipTeamFilter: true,
  });
  const { data: allTasks } = useCollection<Task>('tasks', { skipTeamFilter: true });

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

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Paid': return 'bg-green-100 text-green-800';
      case 'Pending': return 'bg-yellow-100 text-yellow-800';
      case 'Overdue': return 'bg-red-100 text-red-800';
      case 'New': return 'bg-blue-100 text-blue-800';
      case 'In Progress': return 'bg-purple-100 text-purple-800';
      case 'Completed': return 'bg-green-100 text-green-800';
      case 'Rejected': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground mt-1">
          Mirë se vini në portalin tuaj të klientit
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
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

        <Link to="/portal/requests">
          <Card className="hover:shadow-md transition-shadow cursor-pointer">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-orange-100 rounded-lg">
                  <ClipboardList className="h-5 w-5 text-orange-600" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Kërkesa Aktive</p>
                  <p className="text-2xl font-bold">{activeRequests}</p>
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

        {/* Recent Requests */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">Kërkesat e Fundit</CardTitle>
              <Link to="/portal/requests" className="text-sm text-primary hover:underline">
                Shiko të gjitha
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {recentRequests.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                Nuk ka kërkesa akoma
              </p>
            ) : (
              <div className="space-y-3">
                {recentRequests.map(req => (
                  <div key={req.id} className="flex items-center justify-between py-2 border-b last:border-0">
                    <div>
                      <p className="font-medium text-sm">{req.title}</p>
                      <p className="text-xs text-muted-foreground">{req.category}</p>
                    </div>
                    <Badge className={getStatusColor(req.status)} variant="secondary">
                      {req.status}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
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
    </div>
  );
};

export default PortalDashboard;
