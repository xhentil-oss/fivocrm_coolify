import React, { useMemo, useState, Suspense, lazy } from 'react';
import { TrendingUp, TrendingDown, DollarSign, Users, CheckCircle, Clock, Building2, Receipt, Target, FileText, UserPlus, CreditCard, ClipboardList, FolderKanban, ListChecks } from 'lucide-react';
import { Card } from '../components/ui/card';
import { useCollection, useGlobalTeamId } from '../hooks/useFirestore';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../contexts/PermissionsContext';
import { Badge } from '../components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import {
  BarChart as RechartsBarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart as RechartsLineChart, Line, Area, AreaChart,
  PieChart, Pie, Cell, Legend,
  ComposedChart,
} from 'recharts';
import type { Invoice, Project, Team, Expense, Service, InvoiceItem, Task, Lead, Customer, Activity, TeamMember } from '../types';
import { toAll } from '../lib/utils';
import {
  MONTH_LABELS_SQ,
  buildCashflowByMonth,
  buildExpensesByMonth,
  buildRevenueByMonth,
  calculateCollectedRevenue,
  calculateProjectedRevenue,
  calculateRevenueBetween,
  calculateTotalExpenses,
  getFinancialAvailableYears,
  getInvoicePaidDate,
  parseDate,
} from '../lib/finance/financialAnalytics';

const DailyReportsView = lazy(() => import('./DailyReportsView'));

// ── Recharts Bar Chart ──
const BarChart: React.FC<{ data: { label: string; value: number; color?: string }[]; height?: number }> = ({ data, height = 200 }) => {
  if (!data.length) return <div className="text-muted-foreground text-center py-8">Nuk ka të dhëna</div>;
  const defaultColor = '#6366f1';
  return (
    <ResponsiveContainer width="100%" height={height}>
      <RechartsBarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
        <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
        <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={40} tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)} />
        <Tooltip formatter={(value: number) => value.toLocaleString()} />
        <Bar dataKey="value" radius={[4, 4, 0, 0]}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.color || defaultColor} fillOpacity={0.85} />
          ))}
        </Bar>
      </RechartsBarChart>
    </ResponsiveContainer>
  );
};

// ── Recharts Area/Line Chart ──
const LineChart: React.FC<{ data: { label: string; value: number }[]; height?: number; color?: string }> = ({ data, height = 180, color = '#22c55e' }) => {
  if (!data.length) return <div className="text-muted-foreground text-center py-8">Nuk ka të dhëna</div>;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={`grad-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.3} />
            <stop offset="100%" stopColor={color} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
        <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={40} tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)} />
        <Tooltip formatter={(value: number) => value.toLocaleString()} />
        <Area type="monotone" dataKey="value" stroke={color} strokeWidth={2.5} fill={`url(#grad-${color.replace('#', '')})`} dot={{ r: 4, fill: '#fff', stroke: color, strokeWidth: 2 }} />
      </AreaChart>
    </ResponsiveContainer>
  );
};

// ── Recharts Cashflow Chart (Bars + Net Line) ──
const CashflowChart: React.FC<{ data: { label: string; inflow: number; outflow: number; net: number }[] }> = ({ data }) => {
  if (!data.length) return <div className="text-muted-foreground text-center py-8">Nuk ka të dhëna</div>;
  return (
    <ResponsiveContainer width="100%" height={240}>
      <ComposedChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
        <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
        <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={46} tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)} />
        <Tooltip formatter={(value: number, name: string) => [value.toLocaleString() + ' ALL', name === 'inflow' ? 'Të Ardhura' : name === 'outflow' ? 'Shpenzime' : 'Neto']} />
        <Legend formatter={(value: string) => value === 'inflow' ? 'Të Ardhura' : value === 'outflow' ? 'Shpenzime' : 'Neto'} />
        <Bar dataKey="inflow" fill="#22c55e" fillOpacity={0.85} radius={[3, 3, 0, 0]} />
        <Bar dataKey="outflow" fill="#ef4444" fillOpacity={0.85} radius={[3, 3, 0, 0]} />
        <Line type="monotone" dataKey="net" stroke="#6366f1" strokeWidth={2.5} dot={{ r: 4, fill: '#fff', stroke: '#6366f1', strokeWidth: 2 }} />
      </ComposedChart>
    </ResponsiveContainer>
  );
};

// ── Recharts Donut/Pie Chart ──
const DonutChart: React.FC<{ segments: { label: string; value: number; color: string }[]; size?: number }> = ({ segments, size = 160 }) => {
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  return (
    <div className="flex items-center gap-4">
      <ResponsiveContainer width={size} height={size}>
        <PieChart>
          <Pie data={segments} dataKey="value" nameKey="label" cx="50%" cy="50%" innerRadius="55%" outerRadius="90%" paddingAngle={2} strokeWidth={0}>
            {segments.map((seg, i) => (
              <Cell key={i} fill={seg.color} />
            ))}
          </Pie>
          <Tooltip formatter={(value: number) => value.toLocaleString()} />
          <text x="50%" y="45%" textAnchor="middle" dominantBaseline="middle" className="fill-foreground text-lg font-bold">{total}</text>
          <text x="50%" y="60%" textAnchor="middle" dominantBaseline="middle" className="fill-muted-foreground text-[10px]">Gjithsej</text>
        </PieChart>
      </ResponsiveContainer>
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
  const { user } = useAuth();
  const permissions = usePermissions();
  const isManagerOrAbove = permissions.isAdmin || permissions.isOwner || permissions.isManager;
  // Sales sees revenue/leads/invoices but NOT expenses/profit
  const isSales = permissions.role === 'Sales';
  // Member/Viewer/unknown sees only personal stats (safe default)
  const isPersonalOnly = !isManagerOrAbove && !isSales;

  const [selectedRevenueYear, setSelectedRevenueYear] = useState(new Date().getFullYear());

  const { data: invoices, loading: invoicesLoading } = useCollection<Invoice>('invoices', { skipTeamFilter: true });
  const { data: projects, loading: projectsLoading } = useCollection<Project>('projects', { skipTeamFilter: true });
  const { data: teams } = useCollection<Team>('teams');
  const { data: expenses, loading: expensesLoading } = useCollection<Expense>('expenses', { skipTeamFilter: true });
  const { data: services } = useCollection<Service>('services', { skipTeamFilter: true });
  const { data: invoiceItems } = useCollection<InvoiceItem>('invoiceItems', { skipTeamFilter: true });
  const { data: tasks } = useCollection<Task>('tasks', { skipTeamFilter: true });
  const { data: leads } = useCollection<Lead>('leads', { skipTeamFilter: true });
  const { data: customers } = useCollection<Customer>('customers', { skipTeamFilter: true });
  const { data: activities } = useCollection<Activity>('activities', { skipTeamFilter: true });
  const { data: teamMembers } = useCollection<TeamMember>('teamMembers', {
    where: [{ field: 'status', operator: '==', value: 'Active' }],
  });

  // ── Personal stats for Member/Viewer ──
  const myTasks = useMemo(() => {
    if (!tasks || !user) return [];
    return tasks.filter(t => t.assignedToUserId === user.uid);
  }, [tasks, user]);

  const myProjects = useMemo(() => {
    if (!projects || !tasks || !user) return [];
    const myProjectIds = new Set(tasks.filter(t => t.assignedToUserId === user.uid).map(t => t.projectId).filter(Boolean));
    return projects.filter(p => myProjectIds.has(p.id));
  }, [projects, tasks, user]);

  const myTaskStats = useMemo(() => {
    const total = myTasks.length;
    const done = myTasks.filter(t => t.status === 'Done').length;
    const inProgress = myTasks.filter(t => t.status === 'In Progress').length;
    const overdue = myTasks.filter(t => {
      if (t.status === 'Done') return false;
      if (!t.dueDate) return false;
      const due = t.dueDate instanceof Date ? t.dueDate : new Date(t.dueDate);
      return due < new Date();
    }).length;
    return { total, done, inProgress, overdue, pct: total > 0 ? Math.round((done / total) * 100) : 0 };
  }, [myTasks]);

  const myProjectPerformance = useMemo(() => {
    return myProjects
      .filter(p => p.status === 'Active' || p.status === 'Planning')
      .slice(0, 8)
      .map(p => {
        const projectTasks = myTasks.filter(t => t.projectId === p.id);
        const done = projectTasks.filter(t => t.status === 'Done').length;
        const total = projectTasks.length;
        const pct = total > 0 ? Math.round((done / total) * 100) : 0;
        return { name: p.name, progress: pct, done, total };
      });
  }, [myProjects, myTasks]);

  // ── Monthly salary cost from all active team members ──
  const totalMonthlySalary = useMemo(() => {
    if (!teamMembers) return 0;
    return teamMembers.reduce((sum, m) => sum + (m.monthlySalary || 0), 0);
  }, [teamMembers]);

  // ── Revenue by Month (all 12 months for selected year) ──
  const MONTH_LABELS_RPT = MONTH_LABELS_SQ;
  const financialAvailableYears = useMemo(() => {
    return getFinancialAvailableYears(invoices, expenses);
  }, [invoices, expenses]);

  const revenueByMonth = useMemo(() => {
    return buildRevenueByMonth(invoices, selectedRevenueYear, MONTH_LABELS_RPT);
  }, [invoices, selectedRevenueYear]);
  const maxMonthRevRpt = useMemo(() => Math.max(...revenueByMonth.map(m => m.paid), 1), [revenueByMonth]);
  const yearTotalRevRpt = useMemo(() => revenueByMonth.reduce((s, m) => s + m.paid, 0), [revenueByMonth]);
  const revenueAvailableYears = financialAvailableYears;

  // ── Expenses by Month ──
  const expensesByMonth = useMemo(() => {
    return buildExpensesByMonth(expenses, selectedRevenueYear, totalMonthlySalary, MONTH_LABELS_RPT);
  }, [expenses, selectedRevenueYear, totalMonthlySalary]);

  // ── Expenses by Category ──
  const normalizeFinanceCategory = (raw?: string) => {
    const value = (raw || '').trim();
    if (!value) return 'General';
    if (value.toLowerCase().includes('seo')) return 'SEO';
    return value;
  };

  const expensesByCategory = useMemo(() => {
    if (!expenses) return [];
    const map = new Map<string, number>();
    expenses.forEach(exp => {
      const cat = normalizeFinanceCategory(exp.category || 'Të tjera');
      map.set(cat, (map.get(cat) || 0) + toAll(exp.amount || 0, (exp as any).currency));
    });
    return Array.from(map.entries())
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value);
  }, [expenses]);

  // ── Cashflow by Month (inflow vs outflow vs net) ──
  const cashflowByMonth = useMemo(() => {
    return buildCashflowByMonth(invoices, expenses, selectedRevenueYear, totalMonthlySalary, MONTH_LABELS_RPT);
  }, [invoices, expenses, selectedRevenueYear, totalMonthlySalary]);

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
      { label: 'Pjesore', value: invoices.filter(i => i.status === 'Partial').length, color: '#06b6d4' },
      { label: 'Në Pritje', value: invoices.filter(i => i.status === 'Pending').length, color: '#f59e0b' },
      { label: 'Vonuar', value: invoices.filter(i => i.status === 'Overdue').length, color: '#ef4444' },
      { label: 'Draft', value: invoices.filter(i => i.status === 'Draft').length, color: '#94a3b8' },
    ];
  }, [invoices]);

  // ── Project Financial + Delivery Performance ──
  const projectPerformance = useMemo(() => {
    if (!projects || !tasks) return [];
    return projects
      .filter(p => p.status === 'Active' || p.status === 'Planning')
      .map(p => {
        const projectTasks = tasks.filter(t => t.projectId === p.id);
        const done = projectTasks.filter(t => t.status === 'Done').length;
        const total = projectTasks.length;
        const pct = total > 0 ? Math.round((done / total) * 100) : 0;
        const projectInvoices = (invoices ?? []).filter(inv => inv.projectId === p.id);
        // Exclude Draft invoices from billed — they haven't been sent to the client yet;
        // including them inflates 'outstanding' with amounts not yet owed.
        const sentInvoices = projectInvoices.filter(inv => inv.status !== 'Draft');
        const billed = sentInvoices.reduce((s, inv) => s + toAll(inv.total ?? inv.amount ?? 0, (inv as any).currency), 0);
        const collected = sentInvoices.reduce((s, inv) => {
          if (inv.status === 'Paid') return s + toAll(inv.total ?? inv.amount ?? 0, (inv as any).currency);
          if (inv.status === 'Partial') return s + toAll(inv.paidAmount ?? 0, (inv as any).currency);
          return s;
        }, 0);
        const outstanding = Math.max(0, billed - collected);

        const overdueInvoices = sentInvoices.filter(inv => {
          if (inv.status === 'Overdue') return true;
          if (inv.status === 'Paid') return false;
          const due = parseDate(inv.dueDate);
          return !!due && due < new Date();
        });
        const overdue = overdueInvoices.reduce((s, inv) => {
          const invTotal = toAll(inv.total ?? inv.amount ?? 0, (inv as any).currency);
          const invPaid = inv.status === 'Partial' ? toAll(inv.paidAmount ?? 0, (inv as any).currency) : 0;
          return s + Math.max(0, invTotal - invPaid);
        }, 0);

        const collectionRate = billed > 0 ? Math.round((collected / billed) * 100) : 0;
        const margin = collected - (p.spent ?? 0);
        const marginRatio = collected > 0 ? margin / collected : 0;

        // Weighted health score used by top-performing services:
        // collection quality + delivery progress + margin quality - overdue penalty.
        const collectionScore = Math.min(100, collectionRate) * 0.45;
        const deliveryScore = Math.min(100, pct) * 0.25;
        const marginScore = Math.max(0, Math.min(100, ((marginRatio + 0.2) / 0.6) * 100)) * 0.30;
        const overduePenalty = billed > 0 ? Math.min(20, (overdue / billed) * 100 * 0.2) : 0;
        const healthScore = Math.max(0, Math.min(100, Math.round(collectionScore + deliveryScore + marginScore - overduePenalty)));

        return {
          id: p.id,
          name: p.name,
          progress: pct,
          done,
          total,
          budget: p.budget,
          spent: p.spent ?? 0,
          invoicesCount: projectInvoices.length,
          billed,
          collected,
          outstanding,
          overdue,
          collectionRate,
          margin,
          healthScore,
        };
      });
  }, [projects, tasks, invoices]);

  const projectPortfolioSummary = useMemo(() => {
    const totalBilled = projectPerformance.reduce((s, p) => s + p.billed, 0);
    const totalCollected = projectPerformance.reduce((s, p) => s + p.collected, 0);
    const totalOutstanding = projectPerformance.reduce((s, p) => s + p.outstanding, 0);
    const totalOverdue = projectPerformance.reduce((s, p) => s + p.overdue, 0);
    const avgHealth = projectPerformance.length > 0
      ? Math.round(projectPerformance.reduce((s, p) => s + p.healthScore, 0) / projectPerformance.length)
      : 0;
    const collectionRate = totalBilled > 0 ? Math.round((totalCollected / totalBilled) * 100) : 0;
    return { totalBilled, totalCollected, totalOutstanding, totalOverdue, avgHealth, collectionRate };
  }, [projectPerformance]);

  // ── Revenue by Department ──
  const revenueByDepartment = useMemo(() => {
    if (!invoices || !invoiceItems || !services) return [];
    const serviceById = new Map(services.map(s => [s.id, s]));
    const itemsByInvoiceId = new Map<string, InvoiceItem[]>();
    invoiceItems.forEach(item => {
      const arr = itemsByInvoiceId.get(item.invoiceId) || [];
      arr.push(item);
      itemsByInvoiceId.set(item.invoiceId, arr);
    });

    const deptMap = new Map<string, {
      total: number;
      paid: number;
      count: number;
      monthlyPaid: number[];
      _invoiceIds: Set<string>;
    }>();

    invoices.forEach(invoice => {
      const items = itemsByInvoiceId.get(invoice.id) || [];
      if (items.length === 0) return;

      const createdDate = parseDate(invoice.createdAt);
      const createdInYear = !!createdDate && createdDate.getFullYear() === selectedRevenueYear;
      const paidDate = getInvoicePaidDate(invoice);
      const paidInYear = !!paidDate && paidDate.getFullYear() === selectedRevenueYear;

      items.forEach(item => {
        const service = serviceById.get(item.serviceId);
        const dept = normalizeFinanceCategory(service?.category || 'General');
        const current = deptMap.get(dept) || { total: 0, paid: 0, count: 0, monthlyPaid: Array(12).fill(0), _invoiceIds: new Set<string>() };
        const itemValue = toAll(item.totalPrice, (invoice as any).currency);

        if (createdInYear) {
          current.total += itemValue;
        }

        current._invoiceIds.add(invoice.id);

        if (invoice.status === 'Paid' && paidInYear && paidDate) {
          current.paid += itemValue;
          current.monthlyPaid[paidDate.getMonth()] += itemValue;
        }

        if (invoice.status === 'Partial') {
          const invoiceTotal = toAll(invoice.total ?? invoice.amount ?? 0, (invoice as any).currency);
          const itemShare = invoiceTotal > 0 ? (itemValue / invoiceTotal) : 0;
          (invoice.partialPayments ?? []).forEach(p => {
            const pd = parseDate(p.paidAt);
            if (!pd || pd.getFullYear() !== selectedRevenueYear) return;
            const paidChunk = toAll(p.amount, (invoice as any).currency) * itemShare;
            current.paid += paidChunk;
            current.monthlyPaid[pd.getMonth()] += paidChunk;
          });
        }

        deptMap.set(dept, current);
      });
    });

    return Array.from(deptMap.entries())
      .map(([dept, stats]) => ({
        department: dept,
        total: stats.total,
        paid: stats.paid,
        count: stats._invoiceIds.size,
        monthlyPaid: stats.monthlyPaid,
      }))
      .sort((a, b) => b.paid - a.paid);
  }, [invoices, invoiceItems, services, selectedRevenueYear]);

  const seoFinanceSummary = useMemo(() => {
    const seoRevenue = revenueByDepartment
      .filter(d => normalizeFinanceCategory(d.department) === 'SEO')
      .reduce((s, d) => s + d.paid, 0);
    const seoExpenses = expensesByCategory
      .filter(c => normalizeFinanceCategory(c.label) === 'SEO')
      .reduce((s, c) => s + c.value, 0);
    const seoProfit = seoRevenue - seoExpenses;
    return { seoRevenue, seoExpenses, seoProfit };
  }, [revenueByDepartment, expensesByCategory]);

  const departmentYearTotal = useMemo(
    () => revenueByDepartment.reduce((s, dept) => s + dept.paid, 0),
    [revenueByDepartment]
  );

  // ── Revenue by Staff Member (Admin/Owner only) ──
  const currentTeamId = useGlobalTeamId();
  const scopedTeamMembers = useMemo(() => {
    if (!teamMembers) return [];
    const inTeam = teamMembers.filter(m => !currentTeamId || (m as any).teamId === currentTeamId);
    const seen = new Set<string>();
    return inTeam.filter(m => {
      const uid = (m as any).userId || (m as any).uid || (m as any).id;
      if (!uid) return true;
      if (seen.has(uid)) return false;
      seen.add(uid);
      return true;
    });
  }, [teamMembers, currentTeamId]);

  const revenueByStaff = useMemo(() => {
    if (!scopedTeamMembers || !projects || !invoices) return [];
    return scopedTeamMembers
      .map(member => {
        // Support legacy member records that may use uid/id instead of userId.
        const memberUserId = (member as any).userId || (member as any).uid || (member as any).id;
        const memberIdentifiers = new Set<string>(
          [memberUserId, (member as any).email]
            .map(v => (typeof v === 'string' ? v.trim() : ''))
            .filter(Boolean)
        );
        if (!memberUserId) {
          return {
            name: member.displayName || member.email || 'Pa emër',
            role: member.role,
            revenue: 0,
            outstanding: 0,
            projectCount: 0,
            taskCount: 0,
          };
        }

        // Revenue is attributed to one owner only to avoid double counting.
        // Fallbacks keep older records compatible.
        const memberOwnedProjects = projects.filter(p => {
          const responsible =
            p.responsibleUserId ||
            (p as any).ownerUserId ||
            (p as any).assignedToUserId ||
            (p as any).createdByUserId;
          if (!responsible || !memberIdentifiers.has(responsible)) return false;
          // Allow projects with no teamId (legacy records created before teamId field existed).
          // If project has a teamId set, it must match the current team.
          const projectTeamId = (p as any).teamId;
          return !projectTeamId || !currentTeamId || projectTeamId === currentTeamId;
        });
        const memberInvolvedProjects = projects.filter(p => {
          const projectTeamId = (p as any).teamId;
          const teamMatch = !projectTeamId || !currentTeamId || projectTeamId === currentTeamId;
          if (!teamMatch) return false;
          const owner =
            p.responsibleUserId ||
            (p as any).ownerUserId ||
            (p as any).assignedToUserId ||
            (p as any).createdByUserId;
          const collaborators = Array.isArray((p as any).memberUserIds) ? ((p as any).memberUserIds as string[]) : [];
          return (!!owner && memberIdentifiers.has(owner)) || collaborators.some(id => memberIdentifiers.has(id));
        });

        const ownedProjectIds = new Set(memberOwnedProjects.map(p => p.id));
        const memberTaskCount = (tasks ?? []).filter(t => {
          if (!t.assignedToUserId || !memberIdentifiers.has(t.assignedToUserId)) return false;
          const taskTeamId = (t as any).teamId;
          return !taskTeamId || !currentTeamId || taskTeamId === currentTeamId;
        }).length;
        const memberInvoices = invoices.filter(inv => {
          const invoiceTeamId = (inv as any).teamId;
          const teamMatch = !invoiceTeamId || !currentTeamId || invoiceTeamId === currentTeamId;
          if (!teamMatch) return false;
          if (inv.projectId && ownedProjectIds.has(inv.projectId)) return true;
          const invoiceOwner = (inv as any).responsibleUserId || (inv as any).createdByUserId;
          return !!invoiceOwner && memberIdentifiers.has(invoiceOwner);
        });
        const revenue = memberInvoices.reduce((s, inv) => {
          if (inv.status === 'Paid') return s + toAll(inv.total ?? inv.amount ?? 0, (inv as any).currency);
          if (inv.status === 'Partial') return s + toAll(inv.paidAmount ?? 0, (inv as any).currency);
          return s;
        }, 0);
        const outstanding = memberInvoices.reduce((s, inv) => {
          if (inv.status === 'Paid') return s;
          const total = toAll(inv.total ?? inv.amount ?? 0, (inv as any).currency);
          const paid = inv.status === 'Partial' ? toAll(inv.paidAmount ?? 0, (inv as any).currency) : 0;
          return s + Math.max(0, total - paid);
        }, 0);
        return {
          name: member.displayName || member.email || 'Pa emër',
          role: member.role,
          revenue,
          outstanding,
          projectCount: memberInvolvedProjects.length,
          taskCount: memberTaskCount,
        };
      })
      .sort((a, b) => b.revenue - a.revenue);
  }, [scopedTeamMembers, projects, invoices, tasks, currentTeamId]);

  // ── KPI Calculations ──
  const totalRevenue = calculateCollectedRevenue(invoices);
  const paidRevenue = totalRevenue;
  const projectedRevenue = calculateProjectedRevenue(invoices);
  const totalExpenses = calculateTotalExpenses(expenses, totalMonthlySalary);
  const profit = paidRevenue - totalExpenses;
  const activeProjects = projects?.filter(p => p.status === 'Active').length || 0;
  const totalCustomers = customers?.length || 0;
  const wonLeads = leads?.filter(l => l.status === 'Won').length || 0;
  const totalLeads = leads?.length || 0;
  const conversionRate = totalLeads > 0 ? Math.round((wonLeads / totalLeads) * 100) : 0;

  // ── Last month comparison for trends ──
  const lastMonthRevenue = useMemo(() => {
    const now = new Date();
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
    return calculateRevenueBetween(invoices, lastMonth, lastMonthEnd);
  }, [invoices]);

  const thisMonthRevenue = useMemo(() => {
    const now = new Date();
    const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    return calculateRevenueBetween(invoices, thisMonth);
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

  return (
    <Tabs defaultValue="overview" className="space-y-6">
      <TabsList>
        <TabsTrigger value="overview">Pamja e Përgjithshme</TabsTrigger>
        <TabsTrigger value="daily">Raportet Ditore</TabsTrigger>
      </TabsList>

      <TabsContent value="overview" className="mt-0">
        {isLoading ? (
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
        ) : isPersonalOnly ? (
    /* ── MEMBER / VIEWER: Personal Dashboard ── */
    <div className="space-y-8">
      {/* Personal KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card className="p-5 space-y-2 border-l-4 border-l-blue-500">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">Detyrat e mia</p>
            <ListChecks className="w-5 h-5 text-blue-500" />
          </div>
          <p className="text-2xl font-bold">{myTaskStats.total}</p>
          <p className="text-xs text-muted-foreground">{myTaskStats.done} përfunduar · {myTaskStats.inProgress} në progres</p>
        </Card>
        <Card className="p-5 space-y-2 border-l-4 border-l-green-500">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">Përfundimi</p>
            <CheckCircle className="w-5 h-5 text-green-500" />
          </div>
          <p className="text-2xl font-bold">{myTaskStats.pct}%</p>
          <div className="w-full h-2 bg-muted rounded-full overflow-hidden mt-1">
            <div className="h-full bg-green-500 rounded-full transition-all" style={{ width: `${myTaskStats.pct}%` }} />
          </div>
        </Card>
        <Card className="p-5 space-y-2 border-l-4 border-l-amber-400">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">Në progres</p>
            <Clock className="w-5 h-5 text-amber-400" />
          </div>
          <p className="text-2xl font-bold text-amber-500">{myTaskStats.inProgress}</p>
          <p className="text-xs text-muted-foreground">detyra aktive</p>
        </Card>
        <Card className="p-5 space-y-2 border-l-4 border-l-red-500">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">Të vonuara</p>
            <Clock className="w-5 h-5 text-red-500" />
          </div>
          <p className="text-2xl font-bold text-red-500">{myTaskStats.overdue}</p>
          <p className="text-xs text-muted-foreground">kaluan afatin</p>
        </Card>
      </div>

      {/* My Projects Performance */}
      <Card className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Projektet e Mia</h3>
          <Badge variant="secondary">{myProjectPerformance.length} projekte</Badge>
        </div>
        {myProjectPerformance.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">Nuk ke projekte aktive</p>
        ) : (
          <div className="space-y-4">
            {myProjectPerformance.map(p => (
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
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* My Recent Tasks */}
      <Card className="p-6 space-y-4">
        <h3 className="text-lg font-semibold">Detyrat e Fundit</h3>
        {myTasks.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">Nuk ke detyra akoma.</p>
        ) : (
          <div className="space-y-2">
            {myTasks.slice(0, 10).map(task => (
              <div key={task.id} className="flex items-center justify-between py-2 border-b last:border-0">
                <div className="flex items-center gap-2 min-w-0">
                  {task.status === 'Done' ? (
                    <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />
                  ) : (
                    <Clock className="w-4 h-4 text-amber-400 flex-shrink-0" />
                  )}
                  <span className={`text-sm truncate ${task.status === 'Done' ? 'line-through text-muted-foreground' : ''}`}>{task.title}</span>
                </div>
                <Badge variant={task.status === 'Done' ? 'secondary' : task.status === 'In Progress' ? 'default' : 'outline'} className="text-[10px] flex-shrink-0">
                  {task.status === 'Done' ? 'Përfunduar' : task.status === 'In Progress' ? 'Në Progres' : task.status === 'Review' ? 'Rishikim' : 'Për tu bërë'}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
        ) : (
    <div className="space-y-8">
      {/* KPI Cards */}
      <div className={`grid grid-cols-1 sm:grid-cols-2 ${isSales ? 'lg:grid-cols-3' : 'lg:grid-cols-5'} gap-4 lg:gap-6`}>
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
        {!isSales && (
        <Card className="p-5 space-y-2 border-l-4 border-l-red-500">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">Shpenzime (Gjithsej)</p>
            <Receipt className="w-5 h-5 text-red-500" />
          </div>
          <p className="text-2xl font-bold">{totalExpenses.toLocaleString()} ALL</p>
          <p className="text-xs text-muted-foreground">Shpenzime + Rroga ({totalMonthlySalary.toLocaleString()} ALL/muaj)</p>
        </Card>
        )}
        {!isSales && (
        <Card className="p-5 space-y-2 border-l-4 border-l-indigo-500">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">Fitimi Neto</p>
            <TrendingUp className="w-5 h-5 text-indigo-500" />
          </div>
          <p className={`text-2xl font-bold ${profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>{profit.toLocaleString()} ALL</p>
          <p className="text-xs text-muted-foreground">Paguar - Shpenzime</p>
        </Card>
        )}
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
          {!isSales && <TabsTrigger value="expenses">Shpenzime</TabsTrigger>}
          <TabsTrigger value="leads">Lead Funnel</TabsTrigger>
          <TabsTrigger value="invoices">Faturat</TabsTrigger>
          {!isSales && <TabsTrigger value="cashflow">Cashflow</TabsTrigger>}
        </TabsList>

        <TabsContent value="revenue">
          <Card className="p-4 sm:p-6 space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <h3 className="text-base font-semibold text-foreground">Të Ardhurat sipas Muajit</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Gjithsej {selectedRevenueYear}: <span className="font-semibold text-green-600">{yearTotalRevRpt.toLocaleString()} ALL</span>
                </p>
              </div>
              <div className="flex gap-1">
                {revenueAvailableYears.map(y => (
                  <button
                    key={y}
                    onClick={() => setSelectedRevenueYear(y)}
                    className={`h-7 px-3 text-xs rounded-full border font-medium transition-colors ${
                      selectedRevenueYear === y
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-background border-input text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    {y}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-12 gap-1.5 sm:gap-2">
              {revenueByMonth.map((m, i) => {
                const barH = maxMonthRevRpt > 0 ? Math.max((m.paid / maxMonthRevRpt) * 100, m.paid > 0 ? 4 : 0) : 0;
                const isCurMonth = i === new Date().getMonth() && selectedRevenueYear === new Date().getFullYear();
                return (
                  <div key={m.label} className="flex flex-col items-center gap-1 group relative">
                    <div className="w-full flex flex-col items-center justify-end" style={{ height: 72 }}>
                      {m.paid > 0 ? (
                        <div
                          className={`w-full rounded-t-sm transition-all duration-500 ${isCurMonth ? 'bg-green-500' : 'bg-green-400/75'}`}
                          style={{ height: `${barH}%`, minHeight: 4 }}
                        />
                      ) : m.pending > 0 ? (
                        <div className="w-full rounded-t-sm bg-amber-300/70" style={{ height: '8%', minHeight: 3 }} />
                      ) : (
                        <div className="w-full rounded-t-sm bg-muted" style={{ height: '4%', minHeight: 2 }} />
                      )}
                    </div>
                    <span className={`text-[9px] sm:text-[10px] font-medium ${isCurMonth ? 'text-green-600' : 'text-muted-foreground'}`}>
                      {m.label}
                    </span>
                    <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 hidden group-hover:flex flex-col items-center pointer-events-none z-10">
                      <div className="bg-popover border border-border rounded-md shadow-lg px-2.5 py-1.5 text-xs whitespace-nowrap min-w-[120px]">
                        <p className="font-semibold text-foreground">{m.label} {selectedRevenueYear}</p>
                        <p className="text-green-600">{m.paid.toLocaleString()} ALL paguar</p>
                        {m.pending > 0 && <p className="text-amber-500">{m.pending.toLocaleString()} ALL pritje</p>}
                        <p className="text-muted-foreground">{m.count} fatura</p>
                      </div>
                      <div className="w-2 h-2 bg-popover border-r border-b border-border rotate-45 -mt-1" />
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center gap-4 pt-2 border-t">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <div className="w-3 h-3 rounded-sm bg-green-400/75" />
                <span>E paguar</span>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <div className="w-3 h-3 rounded-sm bg-amber-300/70" />
                <span>Në pritje</span>
              </div>
            </div>
          </Card>
        </TabsContent>
        {!isSales && (
        <TabsContent value="expenses">
          <Card className="p-6">
            <h3 className="text-lg font-semibold mb-4">Shpenzimet sipas Muajit ({selectedRevenueYear})</h3>
            <BarChart data={expensesByMonth.map(d => ({ ...d, color: '#ef4444' }))} />
          </Card>
        </TabsContent>
        )}
        {!isSales && (
        <TabsContent value="cashflow">
          <Card className="p-6 space-y-6">
            <h3 className="text-lg font-semibold">Cashflow sipas Muajit ({selectedRevenueYear})</h3>
            <CashflowChart data={cashflowByMonth} />
            <div className="grid grid-cols-3 gap-4 pt-4 border-t">
              <div className="text-center">
                <p className="text-xs text-muted-foreground mb-1">Totale Hyrje</p>
                <p className="text-lg font-bold text-green-600">{cashflowByMonth.reduce((s, m) => s + m.inflow, 0).toLocaleString()} ALL</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-muted-foreground mb-1">Totale Dalje</p>
                <p className="text-lg font-bold text-red-500">{cashflowByMonth.reduce((s, m) => s + m.outflow, 0).toLocaleString()} ALL</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-muted-foreground mb-1">Neto</p>
                <p className={`text-lg font-bold ${cashflowByMonth.reduce((s, m) => s + m.net, 0) >= 0 ? 'text-indigo-600' : 'text-red-600'}`}>
                  {cashflowByMonth.reduce((s, m) => s + m.net, 0).toLocaleString()} ALL
                </p>
              </div>
            </div>
          </Card>
        </TabsContent>
        )}
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
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-2.5">
            <div className="rounded-md border p-2.5 bg-muted/30">
              <p className="text-[11px] text-muted-foreground">Arkëtimi</p>
              <p className="text-sm font-semibold text-green-600">{projectPortfolioSummary.collectionRate}%</p>
            </div>
            <div className="rounded-md border p-2.5 bg-muted/30">
              <p className="text-[11px] text-muted-foreground">Të Pambledhura</p>
              <p className="text-sm font-semibold text-amber-600">{projectPortfolioSummary.totalOutstanding.toLocaleString()} ALL</p>
            </div>
            <div className="rounded-md border p-2.5 bg-muted/30">
              <p className="text-[11px] text-muted-foreground">Të Vonuara</p>
              <p className="text-sm font-semibold text-red-600">{projectPortfolioSummary.totalOverdue.toLocaleString()} ALL</p>
            </div>
            <div className="rounded-md border p-2.5 bg-muted/30">
              <p className="text-[11px] text-muted-foreground">Health Score</p>
              <p className="text-sm font-semibold text-indigo-600">{projectPortfolioSummary.avgHealth}/100</p>
            </div>
          </div>
          {projectPerformance.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">Nuk ka projekte aktive</p>
          ) : (
            <div className="space-y-4">
              {projectPerformance
                .sort((a, b) => (b.outstanding + b.overdue) - (a.outstanding + a.overdue))
                .slice(0, 8)
                .map(p => (
                <div key={p.id} className="space-y-1.5 border rounded-md p-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium truncate max-w-[60%]">{p.name}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">{p.done}/{p.total} detyra</span>
                      <Badge variant="outline" className={p.healthScore >= 75 ? 'text-green-700' : p.healthScore >= 50 ? 'text-amber-600' : 'text-red-600'}>
                        Health {p.healthScore}
                      </Badge>
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
                  <div className="text-xs text-muted-foreground flex justify-between">
                    <span className="text-green-600 font-medium">Arkëtuar: {p.collected.toLocaleString()} ALL</span>
                    <span className="text-amber-600">Pambledhura: {p.outstanding.toLocaleString()} ALL</span>
                  </div>
                  <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full bg-green-500 transition-all duration-500"
                      style={{ width: `${Math.max(2, Math.min(100, p.collectionRate))}%` }}
                    />
                  </div>
                  <div className="text-[11px] text-muted-foreground flex justify-between">
                    <span>{p.invoicesCount} fatura · Arkëtim {p.collectionRate}%</span>
                    <span className={p.overdue > 0 ? 'text-red-600 font-medium' : ''}>
                      Të vonuara: {p.overdue.toLocaleString()} ALL
                    </span>
                  </div>
                  {(p.budget != null || p.spent > 0 || p.margin !== 0) && (
                    <div className="text-xs text-muted-foreground flex justify-between">
                      {p.budget != null && <span>Buxheti: {p.budget.toLocaleString()} ALL</span>}
                      {p.spent > 0 && <span>Shpenzuar: {p.spent.toLocaleString()} ALL</span>}
                      <span className={p.margin >= 0 ? 'text-green-600 font-medium' : 'text-red-600 font-medium'}>
                        Marzhi: {p.margin.toLocaleString()} ALL
                      </span>
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
          <div className="flex items-center gap-2">
            <Badge variant="secondary">{selectedRevenueYear}</Badge>
            <Badge variant="secondary">{revenueByDepartment.length} departamente</Badge>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          <div className="rounded-md border p-2.5 bg-green-50/50">
            <p className="text-[11px] text-muted-foreground">SEO - Të Ardhura</p>
            <p className="text-sm font-semibold text-green-700">{Math.round(seoFinanceSummary.seoRevenue).toLocaleString()} ALL</p>
          </div>
          <div className="rounded-md border p-2.5 bg-red-50/50">
            <p className="text-[11px] text-muted-foreground">SEO - Shpenzime</p>
            <p className="text-sm font-semibold text-red-700">{Math.round(seoFinanceSummary.seoExpenses).toLocaleString()} ALL</p>
          </div>
          <div className="rounded-md border p-2.5 bg-indigo-50/50">
            <p className="text-[11px] text-muted-foreground">SEO - Fitim Neto</p>
            <p className={`text-sm font-semibold ${seoFinanceSummary.seoProfit >= 0 ? 'text-green-700' : 'text-red-700'}`}>
              {Math.round(seoFinanceSummary.seoProfit).toLocaleString()} ALL
            </p>
          </div>
        </div>
        {revenueByDepartment.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">Krijoni fatura me shërbime për të parë ndarjen.</p>
        ) : (
          <div className="space-y-3">
            {revenueByDepartment.map(dept => {
              const paidPct = dept.total > 0 ? (dept.paid / dept.total) * 100 : 0;
              const monthMax = Math.max(...dept.monthlyPaid, 1);
              const thisMonthPaid = dept.monthlyPaid[new Date().getMonth()] || 0;
              return (
                <div key={dept.department} className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Building2 className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">{dept.department}</span>
                      <Badge variant="outline" className="text-xs">{dept.count} fatura</Badge>
                    </div>
                    <div className="text-right">
                      <span className="font-semibold">{dept.paid.toLocaleString()} ALL</span>
                      <div className="text-xs text-muted-foreground">nga {dept.total.toLocaleString()} ALL faturuar</div>
                    </div>
                  </div>
                  <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-green-500 rounded-full transition-all" style={{ width: `${paidPct}%` }} />
                  </div>
                  <div className="grid grid-cols-12 gap-1">
                    {dept.monthlyPaid.map((m, idx) => (
                      <div
                        key={`${dept.department}-${idx}`}
                        className="bg-green-400/70 rounded-sm"
                        style={{ height: `${Math.max(4, (m / monthMax) * 26)}px` }}
                        title={`${MONTH_LABELS_RPT[idx]} ${selectedRevenueYear}: ${Math.round(m).toLocaleString()} ALL`}
                      />
                    ))}
                  </div>
                  <div className="text-[11px] text-muted-foreground flex justify-between">
                    <span>Këtë muaj: {Math.round(thisMonthPaid).toLocaleString()} ALL</span>
                    <span>Arkëtim: {Math.round(paidPct)}%</span>
                  </div>
                </div>
              );
            })}
            <div className="pt-3 border-t space-y-2">
              <div className="flex justify-between text-sm font-semibold">
                <span>Totale Departamente ({selectedRevenueYear})</span>
                <span>{Math.round(departmentYearTotal).toLocaleString()} ALL</span>
              </div>
              {!isSales && (
              <div className="flex justify-between text-sm font-semibold">
                <span>Fitimi Neto</span>
                <span className={profit >= 0 ? 'text-green-600' : 'text-red-600'}>{profit.toLocaleString()} ALL</span>
              </div>
              )}
            </div>
          </div>
        )}
      </Card>

      {/* Revenue by Staff Member — Admin/Owner only */}
      {(permissions.isAdmin || permissions.isOwner) && revenueByStaff.length > 0 && (
        <Card className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">Të Ardhura sipas Stafit</h3>
            <Badge variant="secondary">{revenueByStaff.length} anëtarë</Badge>
          </div>
          <div className="space-y-3">
            {revenueByStaff.map((member, idx) => {
              const maxRevenue = revenueByStaff[0]?.revenue || 1;
              const revPct = maxRevenue > 0 ? (member.revenue / maxRevenue) * 100 : 0;
              return (
                <div key={`staff-${idx}`} className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Users className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">{member.name}</span>
                      <Badge variant="outline" className="text-xs">{member.role}</Badge>
                      <span className="text-xs text-muted-foreground">{member.projectCount} projekte · {member.taskCount} detyra</span>
                    </div>
                    <div className="text-right">
                      <span className="font-semibold text-green-700">{Math.round(member.revenue).toLocaleString()} ALL</span>
                      {member.outstanding > 0 && (
                        <div className="text-xs text-amber-600">+{Math.round(member.outstanding).toLocaleString()} ALL pa arkëtuar</div>
                      )}
                    </div>
                  </div>
                  <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-indigo-500 rounded-full transition-all" style={{ width: `${revPct}%` }} />
                  </div>
                </div>
              );
            })}
            <div className="pt-3 border-t flex justify-between text-sm font-semibold">
              <span>Total i Arkëtuar (Stafi)</span>
              <span className="text-green-700">{Math.round(revenueByStaff.reduce((s, m) => s + m.revenue, 0)).toLocaleString()} ALL</span>
            </div>
          </div>
        </Card>
      )}

      {/* Expenses by Department/Category */}
      {!isSales && (
      <Card className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Shpenzime sipas Departamentit</h3>
          <Badge variant="secondary">{expensesByCategory.length} kategori</Badge>
        </div>
        {expensesByCategory.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">Nuk ka shpenzime të regjistruara.</p>
        ) : (
          <div className="space-y-3">
            {expensesByCategory.map(cat => {
              const totalCatExp = expensesByCategory.reduce((s, c) => s + c.value, 0);
              const pct = totalCatExp > 0 ? (cat.value / totalCatExp) * 100 : 0;
              return (
                <div key={cat.label} className="space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <Receipt className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">{cat.label}</span>
                    </div>
                    <div className="text-right">
                      <span className="font-semibold">{cat.value.toLocaleString()} ALL</span>
                      <div className="text-xs text-muted-foreground">{pct.toFixed(1)}%</div>
                    </div>
                  </div>
                  <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-red-400 rounded-full transition-all" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
            <div className="pt-3 border-t">
              <div className="flex justify-between text-sm font-semibold">
                <span>Totale Shpenzime</span>
                <span className="text-red-600">{(expenses?.reduce((s, e) => s + (e.amount || 0), 0) || 0).toLocaleString()} ALL</span>
              </div>
            </div>
          </div>
        )}
      </Card>
      )}
    </div>
        )}
      </TabsContent>

      <TabsContent value="daily" className="mt-0">
        <Suspense fallback={
          <div className="space-y-6">
            <div className="h-8 w-48 skeleton rounded" />
            <div className="grid grid-cols-3 gap-4">
              {[1, 2, 3].map(i => <div key={i} className="h-24 skeleton rounded-lg" />)}
            </div>
          </div>
        }>
          <DailyReportsView />
        </Suspense>
      </TabsContent>
    </Tabs>
  );
};

export default ReportsView;