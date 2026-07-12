import React, { useMemo, useState, Suspense, lazy } from 'react';
import { TrendingUp, TrendingDown, DollarSign, Users, CheckCircle, Clock, Building2, Receipt, Target, FileText, UserPlus, CreditCard, ClipboardList, FolderKanban, ListChecks } from 'lucide-react';
import { Card } from '../components/ui/card';
import { SkeletonLoader } from '../components/PageSkeleton';
import { useCollection, useGlobalTeamId, useGlobalBusinessId } from '../hooks/useFirestore';
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
import { toAll, getTimestampMs } from '../lib/utils';
import {
  MONTH_LABELS_SQ,
  buildCashflowByMonth,
  buildExpensesByMonth,
  buildRevenueByMonth,
  buildRevenueByMonthByBasis,
  buildReceivablesByMonth,
  buildARAging,
  calculateAccountsReceivable,
  calculateAccrualRevenueBetween,
  calculateCollectedRevenue,
  calculateRevenueBetween,
  calculateTotalExpenses,
  calculateExpensesBetween,
  monthsElapsedInYear,
  getFinancialAvailableYears,
  getInvoiceCollectedAll,
  getInvoiceCollectedBetween,
  getInvoiceBilledBetween,
  getInvoiceOutstandingAll,
  getInvoicePaidDate,
  getInvoiceRecognitionDate,
  getInvoiceTotalAll,
  parseDate,
  type AccountingBasis,
} from '../lib/finance/financialAnalytics';

const DailyReportsView = lazy(() => import('./DailyReportsView'));

// ── Recharts Bar Chart ──
const BarChart: React.FC<{ data: { label: string; value: number; color?: string }[]; height?: number }> = ({ data, height = 200 }) => {
  if (!data.length) return <div className="text-muted-foreground text-center py-8">Nuk ka të dhëna</div>;
  const defaultColor = '#0EA5E9';
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
        <Line type="monotone" dataKey="net" stroke="#0EA5E9" strokeWidth={2.5} dot={{ r: 4, fill: '#fff', stroke: '#0EA5E9', strokeWidth: 2 }} />
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
  // Default to ERP-grade accrual basis (IFRS/GAAP standard).
  // Cash basis still available via the toggle for cash-flow analysis.
  const [accountingBasis, setAccountingBasis] = useState<AccountingBasis>('accrual');
  // Period filter for "Të Ardhura sipas Stafit": current year vs all-time.
  const [staffPeriod, setStaffPeriod] = useState<'year' | 'all'>('year');

  const { data: invoices, loading: invoicesLoading } = useCollection<Invoice>('invoices', { skipTeamFilter: true });
  const { data: projects, loading: projectsLoading } = useCollection<Project>('projects', { skipTeamFilter: true });
  const reportsBusinessId = useGlobalBusinessId();
  const { data: allTeamsRaw } = useCollection<Team>('teams');
  const teams = useMemo(
    () => (allTeamsRaw || []).filter(t => !reportsBusinessId || (t as any).businessId === reportsBusinessId),
    [allTeamsRaw, reportsBusinessId],
  );
  const { data: expenses, loading: expensesLoading } = useCollection<Expense>('expenses', { skipTeamFilter: true });
  const { data: services } = useCollection<Service>('services', { skipTeamFilter: true });
  const { data: invoiceItems } = useCollection<InvoiceItem>('invoiceItems', { skipTeamFilter: true });
  const { data: tasks } = useCollection<Task>('tasks', { skipTeamFilter: true });
  const { data: leads } = useCollection<Lead>('leads', { skipTeamFilter: true });
  const { data: customers } = useCollection<Customer>('customers', { skipTeamFilter: true });
  const { data: activities } = useCollection<Activity>('activities', { skipTeamFilter: true });
  // NOTE: We deliberately do NOT filter by status here. The staff-revenue card
  // must surface former employees too (with an "Inaktiv" badge); salary totals
  // below explicitly restrict to Active members.
  // Load all members (like usePermissions/CRM/Chat); many member docs have an
  // inconsistent/absent teamId, so a team-scoped load hid most of them. We scope
  // to the current team (or teamless members) in `scopedTeamMembers` below.
  const { data: teamMembers } = useCollection<TeamMember>('teamMembers', { skipTeamFilter: true });

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
    return teamMembers
      .filter(m => m.status === 'Active')
      .reduce((sum, m) => sum + (m.monthlySalary || 0), 0);
  }, [teamMembers]);

  // ── Revenue by Month (all 12 months for selected year) ──
  const MONTH_LABELS_RPT = MONTH_LABELS_SQ;
  const financialAvailableYears = useMemo(() => {
    return getFinancialAvailableYears(invoices, expenses);
  }, [invoices, expenses]);

  const revenueByMonth = useMemo(() => {
    return buildRevenueByMonthByBasis(accountingBasis, invoices, selectedRevenueYear, MONTH_LABELS_RPT);
  }, [accountingBasis, invoices, selectedRevenueYear]);
  const maxMonthRevRpt = useMemo(() => Math.max(...revenueByMonth.map(m => m.paid), 1), [revenueByMonth]);
  const yearTotalRevRpt = useMemo(() => revenueByMonth.reduce((s, m) => s + m.paid, 0), [revenueByMonth]);
  const revenueAvailableYears = financialAvailableYears;

  // ── Accounts Receivable (Të Arkëtueshme) ──
  const receivablesByMonth = useMemo(() => {
    return buildReceivablesByMonth(invoices, selectedRevenueYear, MONTH_LABELS_RPT);
  }, [invoices, selectedRevenueYear]);
  const totalAR = useMemo(() => calculateAccountsReceivable(invoices), [invoices]);
  const arAging = useMemo(() => buildARAging(invoices), [invoices]);

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
      { status: 'Contacted', label: 'Kontaktuar', color: '#0EA5E9' },
      { status: 'Qualified', label: 'Kualifikuar', color: '#f59e0b' },
      { status: 'Proposal', label: 'Propozim', color: '#0369A1' },
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
        // Exclude Draft (not sent) and Cancelled (voided) invoices from billed —
        // they don't represent amounts actually owed.
        const sentInvoices = projectInvoices.filter(inv => inv.status !== 'Draft' && inv.status !== 'Cancelled');
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
      const currency = (invoice as any).currency;
      const invoiceTotal = toAll(invoice.total ?? invoice.amount ?? 0, currency);
      const rawItems = itemsByInvoiceId.get(invoice.id) || [];
      // Item-less / manual invoices still count — attributed to "Të tjera" so the
      // per-service totals reconcile with company revenue (no lost revenue).
      const effItems = rawItems.length > 0
        ? rawItems.map(it => ({
            dept: normalizeFinanceCategory(serviceById.get(it.serviceId)?.category || 'General'),
            value: toAll(it.totalPrice, currency),
          }))
        : [{ dept: 'Të tjera', value: invoiceTotal }];
      // Allocate partial payments by each line's share of the SUM OF LINES (not
      // the invoice total) so the shares always add up to 100% even with
      // discounts/VAT/rounding differences between line items and the total.
      const itemsSum = effItems.reduce((s, it) => s + it.value, 0);

      const createdDate = parseDate(invoice.createdAt);
      const createdInYear = !!createdDate && createdDate.getFullYear() === selectedRevenueYear;
      const paidDate = getInvoicePaidDate(invoice);
      const paidInYear = !!paidDate && paidDate.getFullYear() === selectedRevenueYear;

      effItems.forEach(item => {
        const dept = item.dept;
        const current = deptMap.get(dept) || { total: 0, paid: 0, count: 0, monthlyPaid: Array(12).fill(0), _invoiceIds: new Set<string>() };
        const itemValue = item.value;

        if (createdInYear) {
          current.total += itemValue;
        }

        current._invoiceIds.add(invoice.id);

        if (invoice.status === 'Paid' && paidInYear && paidDate) {
          current.paid += itemValue;
          current.monthlyPaid[paidDate.getMonth()] += itemValue;
        }

        if (invoice.status === 'Partial') {
          const itemShare = itemsSum > 0 ? (itemValue / itemsSum) : 0;
          (invoice.partialPayments ?? []).forEach(p => {
            const pd = parseDate(p.paidAt);
            if (!pd || pd.getFullYear() !== selectedRevenueYear) return;
            const paidChunk = toAll(p.amount, currency) * itemShare;
            current.paid += paidChunk;
            current.monthlyPaid[pd.getMonth()] += paidChunk;
          });
        }

        deptMap.set(dept, current);
      });
    });

    // Year-scoped expenses grouped by the SAME normalized category, so profit
    // per service line = service revenue (collected, this year) − direct
    // expenses tagged with that category (this year). Company-wide salaries are
    // overhead and intentionally excluded → this is gross margin per service.
    const expenseByDept = new Map<string, number>();
    (expenses ?? []).forEach(exp => {
      const d = parseDate(exp.date) || parseDate(exp.createdAt);
      if (!d || d.getFullYear() !== selectedRevenueYear) return;
      const cat = normalizeFinanceCategory(exp.category || 'General');
      expenseByDept.set(cat, (expenseByDept.get(cat) || 0) + toAll(exp.amount || 0, (exp as any).currency));
    });

    return Array.from(deptMap.entries())
      .map(([dept, stats]) => {
        const deptExpenses = expenseByDept.get(dept) || 0;
        return {
          department: dept,
          total: stats.total,
          paid: stats.paid,
          expenses: deptExpenses,
          profit: stats.paid - deptExpenses,
          count: stats._invoiceIds.size,
          monthlyPaid: stats.monthlyPaid,
        };
      })
      .sort((a, b) => b.paid - a.paid);
  }, [invoices, invoiceItems, services, expenses, selectedRevenueYear]);

  const seoFinanceSummary = useMemo(() => {
    const seo = revenueByDepartment.find(d => normalizeFinanceCategory(d.department) === 'SEO');
    return {
      seoRevenue: seo?.paid ?? 0,
      seoExpenses: seo?.expenses ?? 0,
      seoProfit: seo?.profit ?? 0,
    };
  }, [revenueByDepartment]);

  const departmentYearTotal = useMemo(
    () => revenueByDepartment.reduce((s, dept) => s + dept.paid, 0),
    [revenueByDepartment]
  );

  // ── Service-line P&L (enterprise full-absorption costing) ──
  // Each service line carries: its revenue (collected, this year), its direct
  // costs (expenses tagged with that category), and an allocated share of
  // company overhead (all salaries + expenses not tied to any service line),
  // distributed by revenue weight. By construction the sum of per-service net
  // profit reconciles to the company net profit (cash basis).
  const servicePnl = useMemo(() => {
    const lines = revenueByDepartment;
    const serviceCats = new Set(lines.map(l => l.department));
    const yStart = new Date(selectedRevenueYear, 0, 1);
    const yEnd = new Date(selectedRevenueYear, 11, 31, 23, 59, 59, 999);

    // Overhead = expenses NOT tied to a revenue-generating service line.
    let overheadExpenses = 0;
    (expenses ?? []).forEach(exp => {
      const d = parseDate(exp.date) || parseDate(exp.createdAt);
      if (!d || d < yStart || d > yEnd) return;
      const cat = normalizeFinanceCategory(exp.category || 'General');
      if (serviceCats.has(cat)) return; // direct cost, already on the service line
      overheadExpenses += toAll(exp.amount || 0, (exp as any).currency);
    });
    // Direct labor: a member assigned to a service line (serviceLine matching a
    // revenue category) charges their salary as a DIRECT cost of that service.
    // Unassigned members' salaries stay in the shared overhead pool.
    const monthsEl = monthsElapsedInYear(selectedRevenueYear);
    const directLaborByCat = new Map<string, number>();
    let assignedSalary = 0;
    (teamMembers ?? []).forEach(m => {
      if (m.status !== 'Active') return;
      // A member can serve multiple service lines — split salary equally across
      // the selected lines. Shares for lines without revenue stay in overhead.
      const raw: string[] = Array.isArray((m as any).serviceLines) && (m as any).serviceLines.length
        ? (m as any).serviceLines
        : ((m as any).serviceLine ? [(m as any).serviceLine] : []);
      const memberLines = raw.map((x: string) => normalizeFinanceCategory(x));
      if (!memberLines.length) return; // unassigned → overhead
      const perLine = ((m.monthlySalary || 0) * monthsEl) / memberLines.length;
      memberLines.forEach(line => {
        if (!serviceCats.has(line)) return; // share for a non-revenue line → overhead
        directLaborByCat.set(line, (directLaborByCat.get(line) || 0) + perLine);
        assignedSalary += perLine;
      });
    });

    // Remaining (unassigned) salaries + non-service expenses = shared overhead.
    const overheadSalaries = Math.max(0, totalMonthlySalary * monthsEl - assignedSalary);
    const overheadPool = overheadExpenses + overheadSalaries;
    const totalRev = lines.reduce((s, l) => s + l.paid, 0);

    const rows = lines.map(l => {
      const allocatedOverhead = totalRev > 0
        ? overheadPool * (l.paid / totalRev)
        : (lines.length ? overheadPool / lines.length : 0);
      const directLabor = directLaborByCat.get(l.department) || 0;
      const directCost = l.expenses + directLabor;
      const net = l.paid - directCost - allocatedOverhead;
      return {
        department: l.department,
        revenue: l.paid,
        directCost,
        allocatedOverhead,
        net,
        marginPct: l.paid > 0 ? (net / l.paid) * 100 : 0,
        count: l.count,
      };
    }).sort((a, b) => b.net - a.net);

    const totals = {
      revenue: totalRev,
      directCost: rows.reduce((s, r) => s + r.directCost, 0),
      overhead: overheadPool,
      net: rows.reduce((s, r) => s + r.net, 0),
    };
    return { rows, totals, overheadExpenses, overheadSalaries, overheadPool };
  }, [revenueByDepartment, expenses, teamMembers, totalMonthlySalary, selectedRevenueYear]);

  // ── Revenue by Staff Member (Admin/Owner only) ──
  const currentTeamId = useGlobalTeamId();
  const scopedTeamMembers = useMemo(() => {
    if (!teamMembers) return [];
    // Members are not team-isolated in practice (teamId is inconsistent/absent
    // across records), so show ALL of them — same approach as customers/leads.
    // Revenue attribution below still scopes invoices to the current team.
    const inTeam = teamMembers;
    const seen = new Set<string>();
    return inTeam.filter(m => {
      // Dedup by email first (stable identity): the same person can have one doc
      // keyed by email and another by uid — keying on email avoids double-counting.
      const email = ((m as any).email || '').trim().toLowerCase();
      const key = email || (m as any).userId || (m as any).uid || (m as any).id;
      if (!key) return true;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [teamMembers, currentTeamId]);

  // Pre-compute customer → assigned rep so invoices created by an admin
  // still flow to the rep who owns the customer relationship.
  // IMPORTANT: customers is fetched with skipTeamFilter, so scope to the
  // current team here to avoid leaking cross-team ownership into revenue.
  const customerOwnerById = useMemo(() => {
    const map = new Map<string, string>();
    (customers ?? []).forEach(c => {
      const customerTeamId = (c as any).teamId;
      if (currentTeamId && customerTeamId && customerTeamId !== currentTeamId) return;
      const owner = (c as any).assignedToUserId || (c as any).ownerUserId;
      if (c.id && owner) map.set(c.id, owner);
    });
    return map;
  }, [customers, currentTeamId]);

  const staffRevenueComputation = useMemo(() => {
    const empty = { rows: [] as any[], unattributed: { billed: 0, collected: 0, outstanding: 0, invoiceCount: 0 } };
    if (!scopedTeamMembers || !projects || !invoices) return empty;

    const yearStart = new Date(selectedRevenueYear, 0, 1);
    const yearEnd = new Date(selectedRevenueYear, 11, 31, 23, 59, 59, 999);
    const isInYear = (d: Date | null) => !!d && d >= yearStart && d <= yearEnd;

    // Determine if an invoice belongs to the selected period.
    const inSelectedPeriod = (inv: Invoice) => {
      if (staffPeriod === 'all') return true;
      const recDate = getInvoiceRecognitionDate(inv);
      const paidDate = getInvoicePaidDate(inv);
      return isInYear(recDate) || isInYear(paidDate);
    };

    const attributedInvoiceIds = new Set<string>();

    const rows = scopedTeamMembers
      .map(member => {
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
            status: member.status,
            revenue: 0,
            billed: 0,
            collected: 0,
            outstanding: 0,
            salaryCost: 0,
            netProfit: 0,
            invoiceCount: 0,
            avgDeal: 0,
            wonLeads: 0,
            projectCount: 0,
            taskCount: 0,
          };
        }

        const memberOwnedProjects = projects.filter(p => {
          const responsible =
            p.responsibleUserId ||
            (p as any).ownerUserId ||
            (p as any).assignedToUserId ||
            (p as any).createdByUserId;
          if (!responsible || !memberIdentifiers.has(responsible)) return false;
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
          // Drafts never count as revenue/AR.
          if (inv.status === 'Draft') return false;
          if (!inSelectedPeriod(inv)) return false;
          // Attribution chain (any one match wins):
          //  1. Member owns the invoice's project.
          //  2. Member is explicitly set on the invoice
          //     (responsible/assigned/createdBy).
          //  3. Member is the rep assigned to the invoice's customer.
          const projectOwned = !!(inv.projectId && ownedProjectIds.has(inv.projectId));
          const invoiceOwner =
            (inv as any).responsibleUserId ||
            (inv as any).assignedToUserId ||
            (inv as any).createdByUserId;
          const explicitOwned = !!invoiceOwner && memberIdentifiers.has(invoiceOwner);
          const customerOwner = inv.customerId ? customerOwnerById.get(inv.customerId) : undefined;
          const customerOwned = !!customerOwner && memberIdentifiers.has(customerOwner);
          if (!projectOwned && !explicitOwned && !customerOwned) return false;
          attributedInvoiceIds.add(inv.id);
          return true;
        });

        // Period-accurate money math: for a selected year, billed counts only
        // invoices recognized that year (accrual) and collected counts only
        // payments received that year (cash) — so years don't double-count.
        const billed = memberInvoices.reduce((s, inv) =>
          s + (staffPeriod === 'all' ? getInvoiceTotalAll(inv) : getInvoiceBilledBetween(inv, yearStart, yearEnd)), 0);
        const collected = memberInvoices.reduce((s, inv) =>
          s + (staffPeriod === 'all' ? getInvoiceCollectedAll(inv) : getInvoiceCollectedBetween(inv, yearStart, yearEnd)), 0);
        const outstanding = memberInvoices.reduce((s, inv) => s + getInvoiceOutstandingAll(inv), 0);

        const wonLeads = (leads ?? []).filter(l => {
          if (l.status !== 'Won') return false;
          if (!l.assignedToUserId || !memberIdentifiers.has(l.assignedToUserId)) return false;
          const leadTeamId = (l as any).teamId;
          if (leadTeamId && currentTeamId && leadTeamId !== currentTeamId) return false;
          if (staffPeriod === 'all') return true;
          // Approximate close date by updatedAt.
          const closeDate = parseDate((l as any).updatedAt) || parseDate((l as any).createdAt);
          return isInYear(closeDate);
        }).length;

        // The headline number depends on basis: accrual → billed; cash → collected.
        const revenue = accountingBasis === 'accrual' ? billed : collected;
        const avgDeal = memberInvoices.length > 0 ? billed / memberInvoices.length : 0;

        // Net profit per employee = their revenue − their salary cost for the
        // period. Salary (monthlySalary, assumed ALL) × elapsed months in the
        // selected year, or 12 (annualized) when viewing "all time".
        // Only active members carry a salary cost (inactive = no longer paid),
        // keeping staff totals consistent with the company KPI (active-only).
        const monthlySalary = member.status === 'Active' ? ((member as any).monthlySalary || 0) : 0;
        const monthsInPeriod = staffPeriod === 'all' ? 12 : monthsElapsedInYear(selectedRevenueYear);
        const salaryCost = monthlySalary * monthsInPeriod;
        const netProfit = revenue - salaryCost;

        return {
          name: member.displayName || member.email || 'Pa emër',
          role: member.role,
          status: member.status,
          revenue,
          billed,
          collected,
          outstanding,
          salaryCost,
          netProfit,
          invoiceCount: memberInvoices.length,
          avgDeal,
          wonLeads,
          projectCount: memberInvolvedProjects.length,
          taskCount: memberTaskCount,
        };
      })
      .sort((a, b) => b.revenue - a.revenue);

    // Invoices that no team member claimed (e.g. customer rep deleted, no
    // project ownership and no createdBy match). Surfacing them avoids the
    // "where did this revenue go?" question.
    const unattributed = { billed: 0, collected: 0, outstanding: 0, invoiceCount: 0 };
    invoices.forEach(inv => {
      const invoiceTeamId = (inv as any).teamId;
      const teamMatch = !invoiceTeamId || !currentTeamId || invoiceTeamId === currentTeamId;
      if (!teamMatch) return;
      if (inv.status === 'Draft') return;
      if (!inSelectedPeriod(inv)) return;
      if (attributedInvoiceIds.has(inv.id)) return;
      unattributed.billed += staffPeriod === 'all' ? getInvoiceTotalAll(inv) : getInvoiceBilledBetween(inv, yearStart, yearEnd);
      unattributed.collected += staffPeriod === 'all' ? getInvoiceCollectedAll(inv) : getInvoiceCollectedBetween(inv, yearStart, yearEnd);
      unattributed.outstanding += getInvoiceOutstandingAll(inv);
      unattributed.invoiceCount += 1;
    });

    return { rows, unattributed };
  }, [scopedTeamMembers, projects, invoices, tasks, leads, customerOwnerById, currentTeamId, accountingBasis, staffPeriod, selectedRevenueYear]);

  const revenueByStaff = staffRevenueComputation.rows;
  const unattributedStaffRevenue = staffRevenueComputation.unattributed;

  // Sum totals for the staff footer.
  const staffTotals = useMemo(() => ({
    billed: revenueByStaff.reduce((s, m) => s + m.billed, 0),
    collected: revenueByStaff.reduce((s, m) => s + m.collected, 0),
    outstanding: revenueByStaff.reduce((s, m) => s + m.outstanding, 0),
    salaryCost: revenueByStaff.reduce((s, m) => s + (m.salaryCost || 0), 0),
    netProfit: revenueByStaff.reduce((s, m) => s + (m.netProfit || 0), 0),
  }), [revenueByStaff]);

  // ── Profit by squad (grouped by role) ──
  const profitBySquad = useMemo(() => {
    const map = new Map<string, { role: string; revenue: number; salaryCost: number; netProfit: number; count: number }>();
    revenueByStaff.forEach(m => {
      const key = m.role || 'Pa rol';
      const g = map.get(key) || { role: key, revenue: 0, salaryCost: 0, netProfit: 0, count: 0 };
      g.revenue += m.revenue || 0;
      g.salaryCost += m.salaryCost || 0;
      g.netProfit += m.netProfit || 0;
      g.count += 1;
      map.set(key, g);
    });
    return Array.from(map.values()).sort((a, b) => b.netProfit - a.netProfit);
  }, [revenueByStaff]);

  // ── Profit per member from the projects they participate in ──
  // Management lens (not sales): each project's profit = value (budget) − direct
  // expenses − labor, where each member's salary is prorated across the projects
  // they're on. Project profit is split equally among its participants (owner +
  // collaborators), so a member sees their share of every project they touch.
  const staffProjectProfit = useMemo(() => {
    if (!projects || !teamMembers) return { rows: [] as any[], totalProfit: 0 };
    const months = staffPeriod === 'all' ? 12 : monthsElapsedInYear(selectedRevenueYear);
    const yStart = new Date(selectedRevenueYear, 0, 1);
    const yEnd = new Date(selectedRevenueYear, 11, 31, 23, 59, 59, 999);
    const inYear = (d: Date | null) => !!d && d >= yStart && d <= yEnd;
    const expDate = (e: any) => parseDate(e.date) || parseDate(e.createdAt);

    const activeMembers = teamMembers.filter(m => m.status === 'Active');
    const idsOf = (m: any) => new Set(
      [m.userId, m.email].filter(Boolean).map((x: string) => String(x).trim().toLowerCase())
    );
    const memberKey = (m: any) => (m.userId || m.email || m.id);

    const periodProjects = staffPeriod === 'all'
      ? projects
      : projects.filter(p => inYear(parseDate((p as any).lastCompletedAt) || parseDate(p.updatedAt) || parseDate(p.createdAt)));

    const participantsOf = (p: any) => {
      const owner = p.responsibleUserId || (p as any).ownerUserId || p.createdByUserId;
      const collab = (Array.isArray(p.memberUserIds) ? p.memberUserIds : []).map((x: string) => String(x).toLowerCase());
      return activeMembers.filter(m => {
        const ids = idsOf(m);
        if (owner && ids.has(String(owner).toLowerCase())) return true;
        return collab.some((c: string) => ids.has(c));
      });
    };

    // How many period projects each member participates in (to prorate salary).
    const projCount = new Map<string, number>();
    periodProjects.forEach(p => participantsOf(p).forEach(m => {
      const k = memberKey(m); projCount.set(k, (projCount.get(k) || 0) + 1);
    }));

    const acc = new Map<string, { name: string; role: string; projects: number; value: number; cost: number; profit: number }>();
    periodProjects.forEach(p => {
      const parts = participantsOf(p);
      if (parts.length === 0) return;
      const value = (p.budget || 0); // project value (ALL — projects have no currency)
      const directExp = (expenses ?? [])
        .filter(e => (e as any).projectId === p.id && inYear(expDate(e)))
        .reduce((s, e) => s + toAll(e.amount || 0, (e as any).currency), 0);
      const labor = parts.reduce((s, m) => {
        const cnt = projCount.get(memberKey(m)) || 1;
        return s + ((m.monthlySalary || 0) * months) / cnt;
      }, 0);
      const profit = value - directExp - labor;
      const shareValue = value / parts.length;
      const shareCost = (directExp + labor) / parts.length;
      const shareProfit = profit / parts.length;
      parts.forEach(m => {
        const k = memberKey(m);
        const a = acc.get(k) || { name: m.displayName || m.email || 'Pa emër', role: m.role, projects: 0, value: 0, cost: 0, profit: 0 };
        a.projects += 1;
        a.value += shareValue;
        a.cost += shareCost;
        a.profit += shareProfit;
        acc.set(k, a);
      });
    });
    const rows = Array.from(acc.values()).sort((a, b) => b.profit - a.profit);
    return { rows, totalProfit: rows.reduce((s, r) => s + r.profit, 0) };
  }, [projects, teamMembers, expenses, staffPeriod, selectedRevenueYear]);

  // ── KPI Calculations ──
  const totalRevenue = calculateCollectedRevenue(invoices);
  const paidRevenue = totalRevenue;
  // Accrual revenue YTD (IFRS/GAAP): everything billed since Jan 1 of current year.
  const accrualRevenueYTD = useMemo(() => {
    const now = new Date();
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    return calculateAccrualRevenueBetween(invoices, startOfYear, now);
  }, [invoices]);
  // Year + basis-scoped P&L (drives the "Shpenzime" and "Fitimi Neto" KPIs so
  // they respect the year selector and the accrual/cash toggle). Salary is
  // counted only for the months of the year that have actually elapsed.
  const periodPnl = useMemo(() => {
    const start = new Date(selectedRevenueYear, 0, 1);
    const end = new Date(selectedRevenueYear, 11, 31, 23, 59, 59, 999);
    const revenue = accountingBasis === 'accrual'
      ? calculateAccrualRevenueBetween(invoices, start, end)
      : calculateRevenueBetween(invoices, start, end);
    const salaryCost = totalMonthlySalary * monthsElapsedInYear(selectedRevenueYear);
    const expensesTotal = calculateExpensesBetween(expenses, start, end) + salaryCost;
    return { revenue, expenses: expensesTotal, salaryCost, profit: revenue - expensesTotal };
  }, [invoices, expenses, selectedRevenueYear, accountingBasis, totalMonthlySalary]);
  const totalExpenses = periodPnl.expenses;
  const profit = periodPnl.profit;
  const activeProjects = projects?.filter(p => p.status === 'Active').length || 0;
  const totalCustomers = customers?.length || 0;
  // A lead counts as "converted" when it reached a closed-won state. The CRM
  // conversion flow marks leads as 'Converted' (a customer is spun up); older/manual
  // deals may use 'Won'. Count both so this matches the CRM module's converted count.
  const wonLeads = leads?.filter(l => l.status === 'Won' || l.status === 'Converted').length || 0;
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
    return [...activities].sort((a, b) => getTimestampMs(b.createdAt) - getTimestampMs(a.createdAt)).slice(0, 10);
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
      case 'lead_created': case 'lead_converted': return <UserPlus className="w-4 h-4 text-primary" />;
      case 'task_completed': return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'project_created': return <Target className="w-4 h-4 text-primary" />;
      case 'customer_created': return <Users className="w-4 h-4 text-teal-500" />;
      case 'expense_added': return <Receipt className="w-4 h-4 text-red-500" />;
      case 'meeting': case 'call': return <Clock className="w-4 h-4 text-orange-500" />;
      default: return <ClipboardList className="w-4 h-4 text-gray-500" />;
    }
  };

  const isLoading = invoicesLoading || projectsLoading || expensesLoading;

  return (
    <Tabs defaultValue="overview" className="space-y-6">
      <TabsList className="overflow-x-auto flex-nowrap w-full">
        <TabsTrigger value="overview">Pamja e Përgjithshme</TabsTrigger>
        <TabsTrigger value="daily">Raportet Ditore</TabsTrigger>
      </TabsList>

      <TabsContent value="overview" className="mt-0">
        {isLoading ? (
          <SkeletonLoader variant="page" />
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
                      background: p.progress >= 80 ? '#22c55e' : p.progress >= 40 ? '#0EA5E9' : '#f59e0b'
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
      <div className={`grid grid-cols-1 sm:grid-cols-2 ${isSales ? 'lg:grid-cols-4' : 'lg:grid-cols-3 xl:grid-cols-6'} gap-4 lg:gap-6`}>
        <Card className="p-5 space-y-2 border-l-4 border-l-emerald-600">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">Të Faturuara (YTD)</p>
            <FileText className="w-5 h-5 text-emerald-600" />
          </div>
          <p className="text-2xl font-bold">{Math.round(accrualRevenueYTD).toLocaleString()} ALL</p>
          <p className="text-xs text-muted-foreground">Bazë Akruale (IFRS/GAAP)</p>
        </Card>
        <Card className="p-5 space-y-2 border-l-4 border-l-green-500">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">Të Arkëtuara</p>
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
            <p className="text-sm text-muted-foreground">Të Arkëtueshme</p>
            <Clock className="w-5 h-5 text-amber-400" />
          </div>
          <p className="text-2xl font-bold text-amber-500">{Math.round(totalAR).toLocaleString()} ALL</p>
          <p className="text-xs text-muted-foreground">Pa paguar nga klientët (AR)</p>
        </Card>
        {!isSales && (
        <Card className="p-5 space-y-2 border-l-4 border-l-red-500">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">Shpenzime ({selectedRevenueYear})</p>
            <Receipt className="w-5 h-5 text-red-500" />
          </div>
          <p className="text-2xl font-bold">{Math.round(totalExpenses).toLocaleString()} ALL</p>
          <p className="text-xs text-muted-foreground">Shpenzime + Rroga ({totalMonthlySalary.toLocaleString()} ALL/muaj)</p>
        </Card>
        )}
        {!isSales && (
        <Card className="p-5 space-y-2 border-l-4 border-l-primary">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">Fitimi Neto ({selectedRevenueYear})</p>
            <TrendingUp className="w-5 h-5 text-primary" />
          </div>
          <p className={`text-2xl font-bold ${profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>{Math.round(profit).toLocaleString()} ALL</p>
          <p className="text-xs text-muted-foreground">{accountingBasis === 'accrual' ? 'Të faturuara' : 'Të arkëtuara'} − Shpenzime</p>
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
        <TabsList className="overflow-x-auto flex-nowrap w-full">
          <TabsTrigger value="revenue">Të Ardhura</TabsTrigger>
          {!isSales && <TabsTrigger value="receivables">Të Arkëtueshme</TabsTrigger>}
          {!isSales && <TabsTrigger value="expenses">Shpenzime</TabsTrigger>}
          <TabsTrigger value="leads">Lead Funnel</TabsTrigger>
          <TabsTrigger value="invoices">Faturat</TabsTrigger>
          {!isSales && <TabsTrigger value="cashflow">Cashflow</TabsTrigger>}
        </TabsList>

        <TabsContent value="revenue">
          <Card className="p-4 sm:p-6 space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <h3 className="text-base font-semibold text-foreground">
                  Të Ardhurat sipas Muajit
                  <span className="ml-2 text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
                    ({accountingBasis === 'accrual' ? 'Bazë Akruale' : 'Bazë Arke'})
                  </span>
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Gjithsej {selectedRevenueYear}: <span className="font-semibold text-green-600">{yearTotalRevRpt.toLocaleString()} ALL</span>
                  <span className="ml-2 text-[10px]">
                    {accountingBasis === 'accrual'
                      ? '• sipas datës së faturës (IFRS/GAAP)'
                      : '• sipas datës së pagesës (cash flow)'}
                  </span>
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {/* Basis toggle: Accrual vs Cash */}
                <div className="inline-flex rounded-full border border-input bg-background p-0.5 text-[11px] font-medium">
                  <button
                    onClick={() => setAccountingBasis('accrual')}
                    className={`h-6 px-2.5 rounded-full transition-colors ${
                      accountingBasis === 'accrual'
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:bg-muted'
                    }`}
                    title="Të ardhurat njihen në muajin e faturës (standardi kontabël)"
                  >
                    Akruale
                  </button>
                  <button
                    onClick={() => setAccountingBasis('cash')}
                    className={`h-6 px-2.5 rounded-full transition-colors ${
                      accountingBasis === 'cash'
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:bg-muted'
                    }`}
                    title="Të ardhurat njihen në muajin e pagesës (paratë reale)"
                  >
                    Arkë
                  </button>
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
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-6 md:grid-cols-12 gap-1.5 sm:gap-2">
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
                <span>{accountingBasis === 'accrual' ? 'E faturuar' : 'E paguar'}</span>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <div className="w-3 h-3 rounded-sm bg-amber-300/70" />
                <span>{accountingBasis === 'accrual' ? 'E papaguar (AR)' : 'Në pritje'}</span>
              </div>
            </div>
          </Card>
        </TabsContent>
        {!isSales && (
        <TabsContent value="receivables">
          <Card className="p-4 sm:p-6 space-y-6">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <h3 className="text-base font-semibold text-foreground">Të Arkëtueshme (Accounts Receivable)</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Totali që klientët na detyrojnë: <span className="font-semibold text-amber-600">{Math.round(totalAR).toLocaleString()} ALL</span>
                </p>
              </div>
            </div>

            {/* Aging buckets */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {(['0-30', '31-60', '61-90', '90+'] as const).map((bucket, idx) => {
                const value = arAging[bucket];
                const colors = ['bg-green-50 text-green-700 border-green-200', 'bg-amber-50 text-amber-700 border-amber-200', 'bg-orange-50 text-orange-700 border-orange-200', 'bg-red-50 text-red-700 border-red-200'];
                const labels = ['0-30 ditë', '31-60 ditë', '61-90 ditë', 'Mbi 90 ditë'];
                return (
                  <div key={bucket} className={`rounded-lg border p-3 ${colors[idx]}`}>
                    <p className="text-[10px] uppercase tracking-wide font-semibold opacity-75">{labels[idx]}</p>
                    <p className="text-lg font-bold mt-1">{Math.round(value).toLocaleString()} ALL</p>
                    <p className="text-[10px] opacity-75 mt-0.5">
                      {totalAR > 0 ? `${Math.round((value / totalAR) * 100)}% e totalit` : '—'}
                    </p>
                  </div>
                );
              })}
            </div>

            {/* AR by issue month */}
            <div>
              <h4 className="text-sm font-semibold text-foreground mb-3">
                Të papaguara sipas muajit të faturës ({selectedRevenueYear})
              </h4>
              <BarChart data={receivablesByMonth.map(d => ({ ...d, color: '#f59e0b' }))} />
              <p className="text-[10px] text-muted-foreground mt-2">
                Tregon shumën që klientët akoma na detyrojnë, ndarë sipas muajit kur është prerë fatura.
              </p>
            </div>
          </Card>
        </TabsContent>
        )}
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
                <p className={`text-lg font-bold ${cashflowByMonth.reduce((s, m) => s + m.net, 0) >= 0 ? 'text-primary' : 'text-red-600'}`}>
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
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2.5">
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
              <p className="text-sm font-semibold text-primary">{projectPortfolioSummary.avgHealth}/100</p>
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
                        background: p.progress >= 80 ? '#22c55e' : p.progress >= 40 ? '#0EA5E9' : '#f59e0b'
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
          <h3 className="text-lg font-semibold">Të Ardhura sipas Shërbimit</h3>
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
          <div className="rounded-md border p-2.5 bg-accent-soft">
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
                  <div className="grid grid-cols-6 md:grid-cols-12 gap-1">
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
            </div>
          </div>
        )}
      </Card>

      {/* Profit & Loss per service line — full-absorption, Admin/Owner only */}
      {!isSales && servicePnl.rows.length > 0 && (
      <Card className="p-6 space-y-4">
        <div>
          <h3 className="text-lg font-semibold">Fitimi sipas Shërbimit (P&L) — {selectedRevenueYear}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Bazë arkë (të arkëtuara) − kosto direkte − pjesa e overhead-it (rroga + shpenzime,
            ndarë sipas peshës së të ardhurave). Shuma barazohet me fitimin neto të kompanisë në bazë arkë.
          </p>
        </div>
        <div className="w-full min-w-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted-foreground border-b">
                <th className="text-left font-medium py-2">Shërbimi</th>
                <th className="text-right font-medium py-2">Të ardhura</th>
                <th className="text-right font-medium py-2">Kosto direkte</th>
                <th className="text-right font-medium py-2">Overhead</th>
                <th className="text-right font-medium py-2">Fitimi neto</th>
                <th className="text-right font-medium py-2">Marzh</th>
              </tr>
            </thead>
            <tbody>
              {servicePnl.rows.map(r => (
                <tr key={r.department} className="border-b border-border/50">
                  <td className="py-2">
                    <span className="font-medium">{r.department}</span>
                    <span className="text-[11px] text-muted-foreground ml-1">· {r.count} fatura</span>
                  </td>
                  <td className="text-right tabular-nums">{Math.round(r.revenue).toLocaleString()}</td>
                  <td className="text-right tabular-nums text-red-600">−{Math.round(r.directCost).toLocaleString()}</td>
                  <td className="text-right tabular-nums text-amber-600">−{Math.round(r.allocatedOverhead).toLocaleString()}</td>
                  <td className={`text-right tabular-nums font-semibold ${r.net >= 0 ? 'text-primary' : 'text-red-600'}`}>
                    {Math.round(r.net).toLocaleString()}
                  </td>
                  <td className={`text-right tabular-nums ${r.net >= 0 ? 'text-primary' : 'text-red-600'}`}>
                    {r.marginPct.toFixed(0)}%
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold border-t">
                <td className="py-2">Totale (kompania)</td>
                <td className="text-right tabular-nums">{Math.round(servicePnl.totals.revenue).toLocaleString()}</td>
                <td className="text-right tabular-nums text-red-600">−{Math.round(servicePnl.totals.directCost).toLocaleString()}</td>
                <td className="text-right tabular-nums text-amber-600">−{Math.round(servicePnl.totals.overhead).toLocaleString()}</td>
                <td className={`text-right tabular-nums ${servicePnl.totals.net >= 0 ? 'text-primary' : 'text-red-600'}`}>
                  {Math.round(servicePnl.totals.net).toLocaleString()}
                </td>
                <td className="text-right tabular-nums text-muted-foreground">
                  {servicePnl.totals.revenue > 0 ? Math.round((servicePnl.totals.net / servicePnl.totals.revenue) * 100) : 0}%
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div className="text-[11px] text-muted-foreground space-y-0.5">
          <p>Overhead i alokuar gjithsej: <span className="font-medium text-foreground">{Math.round(servicePnl.overheadPool).toLocaleString()} ALL</span> (rroga {Math.round(servicePnl.overheadSalaries).toLocaleString()} + shpenzime të përgjithshme {Math.round(servicePnl.overheadExpenses).toLocaleString()}).</p>
          <p>Kosto direkte = shpenzimet me kategori të njëjtë me shërbimin + rrogat e punëtorëve të caktuar te ai shërbim (Ekipet → edito anëtarin → "Shërbimi"). Punëtorët pa shërbim trajtohen si overhead.</p>
        </div>
      </Card>
      )}

      {/* Revenue by Staff Member — Admin/Owner only */}
      {(permissions.isAdmin || permissions.isOwner) && revenueByStaff.length > 0 && (
        <Card className="p-6 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h3 className="text-lg font-semibold">Të Ardhura sipas Stafit <span className="font-normal text-muted-foreground text-sm">(sipas përgjegjësit)</span></h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                {accountingBasis === 'accrual' ? 'Bazë akruale · data e faturës' : 'Bazë arkë · data e pagesës'}
                {' · '}
                {staffPeriod === 'year' ? `Viti ${selectedRevenueYear}` : 'Të gjitha kohërat'}
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Vlera e plotë i shkon përgjegjësit të faturës/projektit. Stafi i dorëzimit (p.sh. ekipi i Social Media) shihet si <span className="text-primary">Kontribues</span> — vlera e tyre matet te P&L-ja sipas shërbimit (rroga = kosto e shërbimit).
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="inline-flex rounded-full border border-input bg-background p-0.5 text-[11px] font-medium">
                <button
                  onClick={() => setStaffPeriod('year')}
                  className={`h-6 px-2.5 rounded-full transition-colors ${staffPeriod === 'year' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}
                >
                  {selectedRevenueYear}
                </button>
                <button
                  onClick={() => setStaffPeriod('all')}
                  className={`h-6 px-2.5 rounded-full transition-colors ${staffPeriod === 'all' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}
                >
                  Të gjitha
                </button>
              </div>
              <Badge variant="secondary">{revenueByStaff.length} anëtarë</Badge>
            </div>
          </div>
          <div className="space-y-3">
            {revenueByStaff.map((member, idx) => {
              const maxRevenue = revenueByStaff[0]?.revenue || 1;
              const revPct = maxRevenue > 0 ? (member.revenue / maxRevenue) * 100 : 0;
              const teamTotal = accountingBasis === 'accrual' ? staffTotals.billed : staffTotals.collected;
              const shareOfTeam = teamTotal > 0 ? (member.revenue / teamTotal) * 100 : 0;
              return (
                <div key={`staff-${idx}`} className="space-y-1.5">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2 min-w-0">
                      <Users className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span className={`font-medium truncate ${member.status === 'Inactive' ? 'text-muted-foreground' : ''}`}>{member.name}</span>
                      <Badge variant="outline" className="text-xs">{member.role}</Badge>
                      {member.status === 'Inactive' && (
                        <Badge variant="outline" className="text-xs border-muted-foreground/40 text-muted-foreground">Inaktiv</Badge>
                      )}
                      {member.revenue === 0 && (member.projectCount > 0 || member.taskCount > 0) && (
                        <Badge variant="outline" className="text-xs border-primary/30 text-primary">Kontribues</Badge>
                      )}
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {member.invoiceCount} fatura · {member.wonLeads} lead · {member.projectCount} projekte · {member.taskCount} detyra
                      </span>
                    </div>
                    <div className="text-right">
                      <div className="flex items-baseline gap-2 justify-end">
                        <span className="font-semibold text-green-700">{Math.round(member.revenue).toLocaleString()} ALL</span>
                        <span className="text-[10px] text-muted-foreground">{shareOfTeam.toFixed(1)}%</span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Mes/faturë: {Math.round(member.avgDeal).toLocaleString()} ALL
                        {member.outstanding > 0 && (
                          <span className="text-amber-600"> · AR {Math.round(member.outstanding).toLocaleString()} ALL</span>
                        )}
                      </div>
                      {!isSales && member.salaryCost > 0 && (
                        <div className="text-xs">
                          <span className={member.netProfit >= 0 ? 'text-primary font-medium' : 'text-red-600 font-medium'}>
                            Fitim neto: {Math.round(member.netProfit).toLocaleString()} ALL
                          </span>
                          <span className="text-muted-foreground"> (pagë {Math.round(member.salaryCost).toLocaleString()})</span>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${revPct}%` }} />
                  </div>
                </div>
              );
            })}
            {unattributedStaffRevenue.invoiceCount > 0 && (
              <div className="space-y-1.5 rounded-md border border-dashed border-amber-300/60 bg-amber-50/40 p-2.5">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2 min-w-0">
                    <Users className="h-4 w-4 text-amber-600 shrink-0" />
                    <span className="font-medium text-amber-900">Pa atribuim</span>
                    <span className="text-xs text-amber-800/80 whitespace-nowrap">
                      {unattributedStaffRevenue.invoiceCount} fatura pa shitës/pronar
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="font-semibold text-amber-700">
                      {Math.round(accountingBasis === 'accrual' ? unattributedStaffRevenue.billed : unattributedStaffRevenue.collected).toLocaleString()} ALL
                    </span>
                    {unattributedStaffRevenue.outstanding > 0 && (
                      <div className="text-[11px] text-amber-700/80">
                        AR {Math.round(unattributedStaffRevenue.outstanding).toLocaleString()} ALL
                      </div>
                    )}
                  </div>
                </div>
                <p className="text-[11px] text-amber-800/80">
                  Cakto një shitës te klienti ose projekti për t'i përfshirë në statistikat e stafit.
                </p>
              </div>
            )}
            <div className="pt-3 border-t grid grid-cols-3 gap-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Të Faturuara</p>
                <p className="font-semibold text-foreground">{Math.round(staffTotals.billed).toLocaleString()} ALL</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Të Arkëtuara</p>
                <p className="font-semibold text-green-700">{Math.round(staffTotals.collected).toLocaleString()} ALL</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Të Arkëtueshme</p>
                <p className="font-semibold text-amber-600">{Math.round(staffTotals.outstanding).toLocaleString()} ALL</p>
              </div>
            </div>
            {!isSales && staffTotals.salaryCost > 0 && (
              <div className="pt-2 flex justify-between text-sm">
                <span className="text-muted-foreground">Fitim neto i stafit (të ardhura − pagat)</span>
                <span className={`font-semibold ${staffTotals.netProfit >= 0 ? 'text-primary' : 'text-red-600'}`}>
                  {Math.round(staffTotals.netProfit).toLocaleString()} ALL
                </span>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* Profit per member from the projects they participate in (management lens) */}
      {!isSales && staffProjectProfit.rows.length > 0 && (
      <Card className="p-6 space-y-4">
        <div>
          <h3 className="text-lg font-semibold">Fitimi sipas Stafit (nga projektet)</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Sa fitim gjeneron secili anëtar nga projektet ku merr pjesë. Fitimi i çdo projekti
            (vlera − shpenzime direkte − pagat e ekipit) ndahet baras mes pjesëmarrësve. Bazuar në
            buxhetin e projektit; rroga ndahet sipas numrit të projekteve të anëtarit.
          </p>
        </div>
        <div className="w-full min-w-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted-foreground border-b">
                <th className="text-left font-medium py-2">Anëtari</th>
                <th className="text-right font-medium py-2">Projekte</th>
                <th className="text-right font-medium py-2">Vlera (pjesa)</th>
                <th className="text-right font-medium py-2">Kosto (pjesa)</th>
                <th className="text-right font-medium py-2">Fitimi</th>
              </tr>
            </thead>
            <tbody>
              {staffProjectProfit.rows.map((r, i) => (
                <tr key={`spp-${i}`} className="border-b border-border/50">
                  <td className="py-2">
                    <span className="font-medium">{r.name}</span>
                    <span className="text-[11px] text-muted-foreground ml-1">· {r.role}</span>
                  </td>
                  <td className="text-right tabular-nums">{r.projects}</td>
                  <td className="text-right tabular-nums">{Math.round(r.value).toLocaleString()}</td>
                  <td className="text-right tabular-nums text-red-600">−{Math.round(r.cost).toLocaleString()}</td>
                  <td className={`text-right tabular-nums font-semibold ${r.profit >= 0 ? 'text-primary' : 'text-red-600'}`}>
                    {Math.round(r.profit).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold border-t">
                <td className="py-2" colSpan={4}>Fitimi total nga projektet</td>
                <td className={`text-right tabular-nums ${staffProjectProfit.totalProfit >= 0 ? 'text-primary' : 'text-red-600'}`}>
                  {Math.round(staffProjectProfit.totalProfit).toLocaleString()} ALL
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>
      )}

      {/* Profit by Squad (grouped by role) */}
      {!isSales && profitBySquad.length > 0 && (
      <Card className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Fitimi sipas Skuadrës (rolit)</h3>
          <Badge variant="secondary">{profitBySquad.length} role</Badge>
        </div>
        <div className="space-y-3">
          {profitBySquad.map(squad => {
            const maxNet = Math.max(...profitBySquad.map(s => Math.abs(s.netProfit)), 1);
            const pct = (Math.abs(squad.netProfit) / maxNet) * 100;
            return (
              <div key={squad.role} className="space-y-1.5">
                <div className="flex items-center justify-between text-sm flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <Users className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium">{squad.role}</span>
                    <span className="text-xs text-muted-foreground">{squad.count} persona</span>
                  </div>
                  <div className="text-right">
                    <span className={`font-semibold ${squad.netProfit >= 0 ? 'text-primary' : 'text-red-600'}`}>
                      {Math.round(squad.netProfit).toLocaleString()} ALL
                    </span>
                    <div className="text-[11px] text-muted-foreground">
                      Të ardhura {Math.round(squad.revenue).toLocaleString()} · Pagë {Math.round(squad.salaryCost).toLocaleString()}
                    </div>
                  </div>
                </div>
                <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                  <div className={`h-full rounded-full transition-all ${squad.netProfit >= 0 ? 'bg-primary' : 'bg-red-400'}`} style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Fitimi neto = të ardhurat e atribuara ({accountingBasis === 'accrual' ? 'të faturuara' : 'të arkëtuara'}) − pagat e periudhës.
        </p>
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
                <span className="text-red-600">{expensesByCategory.reduce((s, c) => s + c.value, 0).toLocaleString()} ALL</span>
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