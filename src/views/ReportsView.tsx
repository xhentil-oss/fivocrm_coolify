import React, { useMemo } from 'react';
import { TrendingUp, TrendingDown, DollarSign, Users, CheckCircle, Clock, Building2, Receipt, Target, FileText, UserPlus, CreditCard, ClipboardList } from 'lucide-react';
import { Card } from '../components/ui/card';
import { useCollection } from '../hooks/useFirestore';
import { Badge } from '../components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import type { Invoice, Project, Team, Expense, Service, InvoiceItem, Task, Lead, Customer, Activity } from '../types';

// ── Simple SVG Bar Chart ──
const BarChart: React.FC<{ data: { label: string; value: number; color?: string }[]; height?: number }> = ({ data, height = 200 }) => {
  if (!data.length) return <div className="text-muted-foreground text-center py-8">Nuk ka të dhëna</div>;
  const maxVal = Math.max(...data.map(d => d.value), 1);
  const barWidth = Math.min(60, Math.floor(500 / data.length));
  const gap = 8;
  const chartWidth = data.length * (barWidth + gap);
  
  return (
    <div className="overflow-x-auto">
      <svg height={height + 40} className="w-full min-w-[280px]" viewBox={`0 0 ${Math.max(chartWidth, 300)} ${height + 40}`} preserveAspectRatio="xMidYEnd meet">
        {data.map((d, i) => {
          const barH = (d.value / maxVal) * height;
          const x = i * (barWidth + gap) + gap;
          return (
            <g key={i}>
              <rect x={x} y={height - barH} width={barWidth} height={barH} rx={4} fill={d.color || '#6366f1'} opacity={0.85} />
              <text x={x + barWidth / 2} y={height - barH - 6} textAnchor="middle" className="fill-foreground text-[10px] font-medium">
                {d.value >= 1000 ? `${(d.value / 1000).toFixed(1)}k` : d.value.toLocaleString()}
              </text>
              <text x={x + barWidth / 2} y={height + 16} textAnchor="middle" className="fill-muted-foreground text-[10px]">
                {d.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
};

// ── Simple SVG Line Chart ──
const LineChart: React.FC<{ data: { label: string; value: number }[]; height?: number; color?: string }> = ({ data, height = 180, color = '#22c55e' }) => {
  if (!data.length) return <div className="text-muted-foreground text-center py-8">Nuk ka të dhëna</div>;
  const maxVal = Math.max(...data.map(d => d.value), 1);
  const padding = 30;
  const w = Math.max(data.length * 60, 300);
  
  const points = data.map((d, i) => {
    const x = padding + (i / Math.max(data.length - 1, 1)) * (w - 2 * padding);
    const y = height - padding - (d.value / maxVal) * (height - 2 * padding);
    return { x, y, ...d };
  });
  
  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const areaPath = `${linePath} L ${points[points.length - 1].x} ${height - padding} L ${points[0].x} ${height - padding} Z`;
  
  return (
    <div className="overflow-x-auto">
      <svg height={height + 20} className="w-full min-w-[280px]" viewBox={`0 0 ${w} ${height + 20}`} preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id={`grad-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.3} />
            <stop offset="100%" stopColor={color} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <path d={areaPath} fill={`url(#grad-${color.replace('#', '')})`} />
        <path d={linePath} fill="none" stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
        {points.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r={4} fill="white" stroke={color} strokeWidth={2} />
            <text x={p.x} y={p.y - 12} textAnchor="middle" className="fill-foreground text-[10px] font-medium">
              {p.value >= 1000 ? `${(p.value / 1000).toFixed(0)}k` : p.value}
            </text>
            <text x={p.x} y={height + 12} textAnchor="middle" className="fill-muted-foreground text-[10px]">
              {p.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
};

// ── Donut Chart ──
const DonutChart: React.FC<{ segments: { label: string; value: number; color: string }[]; size?: number }> = ({ segments, size = 160 }) => {
  const total = segments.reduce((s, seg) => s + seg.value, 0) || 1;
  const r = (size - 20) / 2;
  const cx = size / 2;
  const cy = size / 2;
  let cumAngle = -90;
  
  return (
    <div className="flex items-center gap-4">
      <svg width={size} height={size}>
        {segments.map((seg, i) => {
          const angle = (seg.value / total) * 360;
          const startRad = (cumAngle * Math.PI) / 180;
          const endRad = ((cumAngle + angle) * Math.PI) / 180;
          const largeArc = angle > 180 ? 1 : 0;
          const x1 = cx + r * Math.cos(startRad);
          const y1 = cy + r * Math.sin(startRad);
          const x2 = cx + r * Math.cos(endRad);
          const y2 = cy + r * Math.sin(endRad);
          cumAngle += angle;
          if (seg.value === 0) return null;
          return (
            <path
              key={i}
              d={`M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`}
              fill={seg.color}
              stroke="white"
              strokeWidth={2}
            />
          );
        })}
        <circle cx={cx} cy={cy} r={r * 0.55} fill="var(--card)" />
        <text x={cx} y={cy - 6} textAnchor="middle" className="fill-foreground text-lg font-bold">{total}</text>
        <text x={cx} y={cy + 12} textAnchor="middle" className="fill-muted-foreground text-[10px]">Gjithsej</text>
      </svg>
      <div className="space-y-1.5">
        {segments.map((seg, i) => (
          <div key={i} className="flex items-center gap-2 text-sm">
            <div className="w-3 h-3 rounded-sm" style={{ background: seg.color }} />
            <span className="text-muted-foreground">{seg.label}</span>
            <span className="font-medium ml-auto">{seg.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

const ReportsView: React.FC = () => {
  const { data: invoices, loading: invoicesLoading } = useCollection<Invoice>('invoices');
  const { data: projects, loading: projectsLoading } = useCollection<Project>('projects');
  const { data: teams } = useCollection<Team>('teams');
  const { data: expenses, loading: expensesLoading } = useCollection<Expense>('expenses');
  const { data: services } = useCollection<Service>('services');
  const { data: invoiceItems } = useCollection<InvoiceItem>('invoiceItems');
  const { data: tasks } = useCollection<Task>('tasks');
  const { data: leads } = useCollection<Lead>('leads');
  const { data: customers } = useCollection<Customer>('customers');
  const { data: activities } = useCollection<Activity>('activities');

  // ── Revenue by Month (last 6 months) ──
  const revenueByMonth = useMemo(() => {
    if (!invoices) return [];
    const months: { label: string; value: number }[] = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const label = d.toLocaleDateString('sq-AL', { month: 'short' });
      const monthInvoices = invoices.filter(inv => {
        const cd = inv.createdAt instanceof Date ? inv.createdAt : new Date(inv.createdAt);
        return inv.status === 'Paid' && cd.getMonth() === d.getMonth() && cd.getFullYear() === d.getFullYear();
      });
      months.push({ label, value: monthInvoices.reduce((s, inv) => s + (inv.total ?? inv.amount ?? 0), 0) });
    }
    return months;
  }, [invoices]);

  // ── Expenses by Month ──
  const expensesByMonth = useMemo(() => {
    if (!expenses) return [];
    const months: { label: string; value: number }[] = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const label = d.toLocaleDateString('sq-AL', { month: 'short' });
      const monthExpenses = expenses.filter(exp => {
        const cd = exp.createdAt instanceof Date ? exp.createdAt : new Date(exp.createdAt);
        return cd.getMonth() === d.getMonth() && cd.getFullYear() === d.getFullYear();
      });
      months.push({ label, value: monthExpenses.reduce((s, exp) => s + (exp.amount ?? 0), 0) });
    }
    return months;
  }, [expenses]);

  // ── Lead Funnel ──
  const leadFunnel = useMemo(() => {
    if (!leads) return [];
    const statuses = [
      { status: 'New', label: 'Të Reja', color: '#3b82f6' },
      { status: 'Contacted', label: 'Kontaktuar', color: '#8b5cf6' },
      { status: 'Qualified', label: 'Kualifikuar', color: '#f59e0b' },
      { status: 'Proposal', label: 'Propozim', color: '#6366f1' },
      { status: 'Won', label: 'Fituar', color: '#22c55e' },
      { status: 'Lost', label: 'Humbur', color: '#ef4444' },
    ];
    return statuses.map(s => ({
      label: s.label,
      value: leads.filter(l => l.status === s.status).length,
      color: s.color,
    }));
  }, [leads]);

  // ── Invoice Status Distribution ──
  const invoiceStatusDist = useMemo(() => {
    if (!invoices) return [];
    return [
      { label: 'Paguar', value: invoices.filter(i => i.status === 'Paid').length, color: '#22c55e' },
      { label: 'Në Pritje', value: invoices.filter(i => i.status === 'Pending').length, color: '#f59e0b' },
      { label: 'Vonuar', value: invoices.filter(i => i.status === 'Overdue').length, color: '#ef4444' },
      { label: 'Draft', value: invoices.filter(i => i.status === 'Draft').length, color: '#94a3b8' },
    ];
  }, [invoices]);

  // ── Project Performance (real) ──
  const projectPerformance = useMemo(() => {
    if (!projects || !tasks) return [];
    return projects
      .filter(p => p.status === 'Active' || p.status === 'Planning')
      .slice(0, 6)
      .map(p => {
        const projectTasks = tasks.filter(t => t.projectId === p.id);
        const done = projectTasks.filter(t => t.status === 'Done').length;
        const total = projectTasks.length;
        const pct = total > 0 ? Math.round((done / total) * 100) : 0;
        return { name: p.name, progress: pct, done, total, budget: p.budget, spent: p.spent };
      });
  }, [projects, tasks]);

  // ── Revenue by Department ──
  const revenueByDepartment = useMemo(() => {
    if (!invoices || !invoiceItems || !services) return [];
    const deptMap = new Map<string, { total: number; paid: number; count: number }>();
    invoices.forEach(invoice => {
      const items = invoiceItems.filter(item => item.invoiceId === invoice.id);
      items.forEach(item => {
        const service = services.find(s => s.id === item.serviceId);
        const dept = service?.category || 'General';
        const current = deptMap.get(dept) || { total: 0, paid: 0, count: 0 };
        current.total += item.totalPrice;
        current.count++;
        if (invoice.status === 'Paid') current.paid += item.totalPrice;
        deptMap.set(dept, current);
      });
    });
    return Array.from(deptMap.entries()).map(([dept, stats]) => ({ department: dept, ...stats })).sort((a, b) => b.total - a.total);
  }, [invoices, invoiceItems, services]);

  // ── KPI Calculations ──
  const totalRevenue = invoices?.filter(inv => inv.status === 'Paid').reduce((sum, inv) => sum + (inv.total ?? inv.amount ?? 0), 0) || 0;
  const paidRevenue = totalRevenue;
  const projectedRevenue = invoices?.filter(inv => inv.status === 'Pending' || inv.status === 'Draft').reduce((sum, inv) => sum + (inv.total ?? inv.amount ?? 0), 0) || 0;
  const totalExpenses = expenses?.reduce((sum, exp) => sum + (exp.amount ?? 0), 0) || 0;
  const profit = paidRevenue - totalExpenses;
  const activeProjects = projects?.filter(p => p.status === 'Active').length || 0;
  const totalCustomers = customers?.length || 0;
  const wonLeads = leads?.filter(l => l.status === 'Won').length || 0;
  const totalLeads = leads?.length || 0;
  const conversionRate = totalLeads > 0 ? Math.round((wonLeads / totalLeads) * 100) : 0;

  // ── Last month comparison for trends ──
  const lastMonthRevenue = useMemo(() => {
    if (!invoices) return 0;
    const now = new Date();
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
    return invoices.filter(inv => {
      const cd = inv.createdAt instanceof Date ? inv.createdAt : new Date(inv.createdAt);
      return cd >= lastMonth && cd <= lastMonthEnd;
    }).reduce((s, inv) => s + (inv.total || inv.amount || 0), 0);
  }, [invoices]);

  const thisMonthRevenue = useMemo(() => {
    if (!invoices) return 0;
    const now = new Date();
    const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    return invoices.filter(inv => {
      const cd = inv.createdAt instanceof Date ? inv.createdAt : new Date(inv.createdAt);
      return cd >= thisMonth;
    }).reduce((s, inv) => s + (inv.total || inv.amount || 0), 0);
  }, [invoices]);

  const revenueChange = lastMonthRevenue > 0 ? Math.round(((thisMonthRevenue - lastMonthRevenue) / lastMonthRevenue) * 100) : 0;

  // ── Real Activity Feed ──
  const recentActivities = useMemo(() => {
    if (!activities) return [];
    return [...activities].sort((a, b) => {
      const ta = a.createdAt instanceof Date ? a.createdAt.getTime() : 0;
      const tb = b.createdAt instanceof Date ? b.createdAt.getTime() : 0;
      return tb - ta;
    }).slice(0, 10);
  }, [activities]);

  const timeAgo = (date: Date) => {
    const seconds = Math.floor((new Date().getTime() - new Date(date).getTime()) / 1000);
    if (seconds < 60) return 'tani';
    if (seconds < 3600) return `${Math.floor(seconds / 60)} min`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} orë`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)} ditë`;
    return new Date(date).toLocaleDateString('sq-AL');
  };

  const getActivityIcon = (type: string) => {
    switch (type) {
      case 'invoice_created': case 'invoice_paid': return <FileText className="w-4 h-4 text-blue-500" />;
      case 'lead_created': case 'lead_converted': return <UserPlus className="w-4 h-4 text-purple-500" />;
      case 'task_completed': return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'project_created': return <Target className="w-4 h-4 text-indigo-500" />;
      case 'customer_created': return <Users className="w-4 h-4 text-teal-500" />;
      case 'expense_added': return <Receipt className="w-4 h-4 text-red-500" />;
      case 'meeting': case 'call': return <Clock className="w-4 h-4 text-orange-500" />;
      default: return <ClipboardList className="w-4 h-4 text-gray-500" />;
    }
  };

  const isLoading = invoicesLoading || projectsLoading || expensesLoading;

  if (isLoading) {
    return (
      <div className="space-y-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="p-6 bg-card rounded-lg border space-y-3">
              <div className="h-4 w-28 skeleton rounded" />
              <div className="h-8 w-24 skeleton rounded" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 lg:gap-6">
        <Card className="p-5 space-y-2 border-l-4 border-l-green-500">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">Të Ardhura (Paguar)</p>
            <DollarSign className="w-5 h-5 text-green-500" />
          </div>
          <p className="text-2xl font-bold">{totalRevenue.toLocaleString()} ALL</p>
          <div className="flex items-center gap-1 text-xs">
            {revenueChange >= 0 ? <TrendingUp className="w-3 h-3 text-green-500" /> : <TrendingDown className="w-3 h-3 text-red-500" />}
            <span className={revenueChange >= 0 ? 'text-green-600' : 'text-red-600'}>{revenueChange >= 0 ? '+' : ''}{revenueChange}%</span>
            <span className="text-muted-foreground">nga muaji i kaluar</span>
          </div>
        </Card>
        <Card className="p-5 space-y-2 border-l-4 border-l-amber-400">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">Parashikuara</p>
            <TrendingUp className="w-5 h-5 text-amber-400" />
          </div>
          <p className="text-2xl font-bold text-amber-500">{projectedRevenue.toLocaleString()} ALL</p>
          <p className="text-xs text-muted-foreground">Fatura Draft + Në Pritje</p>
        </Card>
        <Card className="p-5 space-y-2 border-l-4 border-l-red-500">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">Shpenzime</p>
            <Receipt className="w-5 h-5 text-red-500" />
          </div>
          <p className="text-2xl font-bold">{totalExpenses.toLocaleString()} ALL</p>
          <p className="text-xs text-muted-foreground">Kosto operative</p>
        </Card>
        <Card className="p-5 space-y-2 border-l-4 border-l-indigo-500">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">Fitimi Neto</p>
            <TrendingUp className="w-5 h-5 text-indigo-500" />
          </div>
          <p className={`text-2xl font-bold ${profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>{profit.toLocaleString()} ALL</p>
          <p className="text-xs text-muted-foreground">Paguar - Shpenzime</p>
        </Card>
        <Card className="p-5 space-y-2 border-l-4 border-l-blue-500">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">Konvertim Lead</p>
            <Target className="w-5 h-5 text-blue-500" />
          </div>
          <p className="text-2xl font-bold">{conversionRate}%</p>
          <p className="text-xs text-muted-foreground">{wonLeads} / {totalLeads} leads · {totalCustomers} klientë</p>
        </Card>
      </div>

      {/* Charts Tabs */}
      <Tabs defaultValue="revenue" className="space-y-4">
        <TabsList>
          <TabsTrigger value="revenue">Të Ardhura</TabsTrigger>
          <TabsTrigger value="expenses">Shpenzime</TabsTrigger>
          <TabsTrigger value="leads">Lead Funnel</TabsTrigger>
          <TabsTrigger value="invoices">Faturat</TabsTrigger>
        </TabsList>

        <TabsContent value="revenue">
          <Card className="p-6">
            <h3 className="text-lg font-semibold mb-4">Të Ardhurat - 6 Muajt e Fundit</h3>
            <LineChart data={revenueByMonth} color="#22c55e" />
          </Card>
        </TabsContent>
        <TabsContent value="expenses">
          <Card className="p-6">
            <h3 className="text-lg font-semibold mb-4">Shpenzimet - 6 Muajt e Fundit</h3>
            <BarChart data={expensesByMonth.map(d => ({ ...d, color: '#ef4444' }))} />
          </Card>
        </TabsContent>
        <TabsContent value="leads">
          <Card className="p-6">
            <h3 className="text-lg font-semibold mb-4">Lead Pipeline</h3>
            <BarChart data={leadFunnel} />
          </Card>
        </TabsContent>
        <TabsContent value="invoices">
          <Card className="p-6">
            <h3 className="text-lg font-semibold mb-4">Statusi i Faturave</h3>
            <DonutChart segments={invoiceStatusDist} />
          </Card>
        </TabsContent>
      </Tabs>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Real Project Performance */}
        <Card className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">Performanca e Projekteve</h3>
            <Badge variant="secondary">{activeProjects} aktive</Badge>
          </div>
          {projectPerformance.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">Nuk ka projekte aktive</p>
          ) : (
            <div className="space-y-4">
              {projectPerformance.map(p => (
                <div key={p.name} className="space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium truncate max-w-[60%]">{p.name}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">{p.done}/{p.total} detyra</span>
                      <span className="font-semibold">{p.progress}%</span>
                    </div>
                  </div>
                  <div className="w-full h-2.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${p.progress}%`,
                        background: p.progress >= 80 ? '#22c55e' : p.progress >= 40 ? '#6366f1' : '#f59e0b'
                      }}
                    />
                  </div>
                  {p.budget != null && (
                    <div className="text-xs text-muted-foreground flex justify-between">
                      <span>Buxheti: {p.budget.toLocaleString()} ALL</span>
                      <span>Shpenzuar: {(p.spent || 0).toLocaleString()} ALL ({p.budget > 0 ? Math.round(((p.spent || 0) / p.budget) * 100) : 0}%)</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Real Activity Timeline */}
        <Card className="p-6 space-y-4">
          <h3 className="text-lg font-semibold">Aktiviteti i Fundit</h3>
          {recentActivities.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">Nuk ka aktivitet akoma. Veprimet do shfaqen automatikisht ketu.</p>
          ) : (
            <div className="space-y-3">
              {recentActivities.map(act => (
                <div key={act.id} className="flex items-start gap-3 py-2 border-b last:border-0">
                  <div className="mt-0.5">{getActivityIcon(act.type)}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{act.title}</p>
                    {act.description && <p className="text-xs text-muted-foreground mt-0.5">{act.description}</p>}
                  </div>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">{timeAgo(act.createdAt)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Revenue by Department */}
      <Card className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Të Ardhura sipas Departamentit</h3>
          <Badge variant="secondary">{revenueByDepartment.length} departamente</Badge>
        </div>
        {revenueByDepartment.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">Krijoni fatura me shërbime për të parë ndarjen.</p>
        ) : (
          <div className="space-y-3">
            {revenueByDepartment.map(dept => {
              const paidPct = dept.total > 0 ? (dept.paid / dept.total) * 100 : 0;
              return (
                <div key={dept.department} className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Building2 className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">{dept.department}</span>
                      <Badge variant="outline" className="text-xs">{dept.count} fatura</Badge>
                    </div>
                    <div className="text-right">
                      <span className="font-semibold">{dept.total.toLocaleString()} ALL</span>
                      <div className="text-xs text-muted-foreground">{dept.paid.toLocaleString()} paguar</div>
                    </div>
                  </div>
                  <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-green-500 rounded-full transition-all" style={{ width: `${paidPct}%` }} />
                  </div>
                </div>
              );
            })}
            <div className="pt-3 border-t space-y-2">
              <div className="flex justify-between text-sm font-semibold">
                <span>Totale</span>
                <span>{totalRevenue.toLocaleString()} ALL</span>
              </div>
              <div className="flex justify-between text-sm font-semibold">
                <span>Fitimi Neto</span>
                <span className={profit >= 0 ? 'text-green-600' : 'text-red-600'}>{profit.toLocaleString()} ALL</span>
              </div>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
};

export default ReportsView;