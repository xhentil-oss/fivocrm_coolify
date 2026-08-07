import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePermissions } from '../contexts/PermissionsContext';
import { useCollection } from '../hooks/useFirestore';
import { Card } from '../components/ui/card';
import { Skeleton } from '../components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { cn, formatALL, toAll } from '../lib/utils';
import {
  TrendingUp, TrendingDown, AlertTriangle, Wallet, Clock,
  ArrowDownRight, ArrowUpRight, Users, CheckCircle2, Repeat, XCircle, Briefcase, Layers,
  Server, Building2, Info, ChevronDown, ChevronRight, Table2,
} from 'lucide-react';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip,
  CartesianGrid, ReferenceLine,
} from 'recharts';
import type { Invoice, Expense, Customer, Project, TeamMember } from '../types';
import {
  getInvoiceCollectedBetween,
  getInvoiceOutstandingAll,
  calculateExpensesBetween,
  calculateAccountsReceivable,
  parseDate,
  MONTH_LABELS_SQ,
} from '../lib/finance/financialAnalytics';
import { computeProjectPnl, type ProjectPnlOptions } from '../lib/finance/projectPnl';
import { totalSalaryForMonth } from '../lib/finance/salaryHistory';
import { computeCashflowHealth } from '../lib/finance/cashflowAlarms';
import { forecastNextMonth } from '../lib/finance/forecast';
import { computeDepartmentPnl, buildDepartmentProfitTrend } from '../lib/finance/departmentPnl';

// ── Single-page, plain-language finance overview for the owner ──
// Answers one question: "Am I making money this month, where, and why?"
// Reuses financialAnalytics + per-client P&L logic (mirrors Customer360View).
//
// LAYOUT CONTRACT — the page had grown to 12 equal-weight cards in one ~4000px
// scroll, so nothing read as more important than anything else. The rules that
// keep it legible as more panels get added:
//   · ONE hero figure (net profit). Everything else is a stat tile or a panel.
//   · Alarms sit at the TOP, never below the fold.
//   · Four tabs instead of one scroll — each tab answers one kind of question.
//   · ONE filter row per scope, rendered ABOVE the panels it scopes. Never a
//     control hidden inside a card that silently governs four cards below it.
//   · Prose lives in <Explain> disclosures. Numbers get the visual weight.

const FREQ_LABEL: Record<string, string> = {
  weekly: 'javore',
  monthly: 'mujore',
  quarterly: 'tremujore',
  yearly: 'vjetore',
};

const MONTH_NAMES_FULL = [
  'Janar', 'Shkurt', 'Mars', 'Prill', 'Maj', 'Qershor',
  'Korrik', 'Gusht', 'Shtator', 'Tetor', 'Nëntor', 'Dhjetor',
];

// ── Chart tokens ──
// Status ink (green/red/amber) is reserved for profit-vs-loss MEANING on this
// page, so the categorical series palette deliberately avoids those hues.
// Validated across all pairs against the light card surface for the lightness
// band, chroma floor, CVD separation, normal-vision separation and ≥3:1
// contrast — do not swap a hue without re-validating the set.
const SERIES = ['#0284C7', '#7C3AED', '#DB2777', '#EA580C'] as const;
// The folded tail of a long category list. Neutral on purpose: "Të tjera" is an
// aggregate, not an identity that deserves its own hue.
const SERIES_REST = '#64748B';
const AXIS_INK = '#6B7A93'; // = muted.foreground
const GRID_INK = '#ECEFF4'; // = border

// Profit/loss ink. A step darker than the emerald-600/amber-600 used before, so
// small bold figures actually clear WCAG AA against the card surface.
const INK_POS = 'text-emerald-700';
const INK_NEG = 'text-red-600';
const INK_WARN = 'text-amber-700';

/** Short money for chart ticks/labels, where the full "1.234.567 L" never fits. */
function compactALL(v: number): string {
  const a = Math.abs(v);
  if (a >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (a >= 1_000) return `${Math.round(v / 1_000)}k`;
  return `${Math.round(v)}`;
}

function monthWindow(base: Date, offset: number) {
  const d = new Date(base.getFullYear(), base.getMonth() + offset, 1);
  const start = new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
  return { start, end, monthIndex: d.getMonth(), year: d.getFullYear() };
}

/** One financial snapshot for a month: money in − money out. */
function monthProfit(
  invoices: Invoice[],
  expenses: Expense[],
  monthlySalary: number,
  start: Date,
  end: Date,
) {
  const collected = invoices.reduce((s, inv) => s + getInvoiceCollectedBetween(inv, start, end), 0);
  const otherExpenses = calculateExpensesBetween(expenses, start, end);
  const profit = collected - otherExpenses - monthlySalary;
  return { collected, otherExpenses, salary: monthlySalary, profit };
}

/** `'month' | 'year' | 'all' | 'YYYY-M'` — one period for every P&L breakdown. */
type Period = string;
const isPickedMonth = (p: Period) => /^\d{4}-\d{1,2}$/.test(p);

const FinancesView: React.FC = () => {
  const navigate = useNavigate();
  const permissions = usePermissions();
  const allowed = permissions.isOwner || permissions.isAdmin || permissions.isSuperAdmin;

  const { data: invoices, loading: lInv } = useCollection<Invoice>('invoices', { skipTeamFilter: true });
  const { data: expenses, loading: lExp } = useCollection<Expense>('expenses', { skipTeamFilter: true });
  const { data: customers } = useCollection<Customer>('customers', { skipTeamFilter: true });
  const { data: projects } = useCollection<Project>('projects', { skipTeamFilter: true });
  const { data: teamMembers } = useCollection<TeamMember>('teamMembers', { skipTeamFilter: true });

  const now = useMemo(() => new Date(), []);
  const [tab, setTab] = useState('overview');

  // ── This month vs last month ── (salary is resolved per month via history,
  // so past months use the salary that applied then, not today's.)
  // The CURRENT month is month-to-date, so its salary is prorated to elapsed
  // days — otherwise a full month's payroll vs a few days of collections would
  // show a false loss early each month.
  const { thisMonth, lastMonth, lastMonthToDate } = useMemo(() => {
    const inv = invoices || [];
    const exp = expenses || [];
    const cur = monthWindow(now, 0);
    const prev = monthWindow(now, -1);
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const elapsedDay = now.getDate();
    const elapsedFraction = Math.min(1, elapsedDay / daysInMonth);
    const curSalary = totalSalaryForMonth(teamMembers, cur.end) * elapsedFraction;

    // Last month up to the SAME day-of-month + salary prorated the same way — a
    // like-for-like "pace" baseline for the current (month-to-date) hero number.
    const prevDays = new Date(now.getFullYear(), now.getMonth(), 0).getDate();
    const prevDay = Math.min(elapsedDay, prevDays);
    const prevToDateEnd = new Date(prev.start.getFullYear(), prev.start.getMonth(), prevDay, 23, 59, 59, 999);
    const prevSalaryToDate = totalSalaryForMonth(teamMembers, prev.end) * Math.min(1, prevDay / prevDays);

    return {
      thisMonth: monthProfit(inv, exp, curSalary, cur.start, cur.end),
      lastMonth: monthProfit(inv, exp, totalSalaryForMonth(teamMembers, prev.end), prev.start, prev.end),
      lastMonthToDate: monthProfit(inv, exp, prevSalaryToDate, prev.start, prevToDateEnd),
    };
  }, [invoices, expenses, teamMembers, now]);

  // Compare month-to-date against last month AT THE SAME POINT (not a full month).
  const profitDelta = thisMonth.profit - lastMonthToDate.profit;

  // ── Income split by source (WHMCS vs direct) for the current month ──
  // WHMCS-synced invoices carry source:'whmcs'; everything else is billed
  // directly inside FivoCRM. Same collected basis as the hero number.
  const incomeBySource = useMemo(() => {
    const cur = monthWindow(now, 0);
    let whmcs = 0, direct = 0;
    for (const inv of invoices || []) {
      const c = getInvoiceCollectedBetween(inv, cur.start, cur.end);
      if (c <= 0) continue;
      if ((inv as any).source === 'whmcs') whmcs += c; else direct += c;
    }
    return { whmcs, direct, total: whmcs + direct };
  }, [invoices, now]);

  // Unpaid (outstanding) balance from WHMCS — not period-bound, it's the current
  // sum of what's still owed on WHMCS invoices (Pending/Overdue/Partial).
  const whmcsUnpaid = useMemo(() => {
    let amount = 0, count = 0;
    for (const inv of invoices || []) {
      if ((inv as any).source !== 'whmcs') continue;
      const out = getInvoiceOutstandingAll(inv);
      if (out <= 0) continue;
      amount += out;
      count++;
    }
    return { amount, count };
  }, [invoices]);

  // Same split, but per month for the last 6 months (WHMCS income over time).
  const incomeSourceByMonth = useMemo(() => {
    const inv = invoices || [];
    const out: { label: string; whmcs: number; direct: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const w = monthWindow(now, -i);
      let whmcs = 0, direct = 0;
      for (const x of inv) {
        const c = getInvoiceCollectedBetween(x, w.start, w.end);
        if (c <= 0) continue;
        if ((x as any).source === 'whmcs') whmcs += c; else direct += c;
      }
      out.push({ label: MONTH_LABELS_SQ[w.monthIndex], whmcs, direct });
    }
    return out;
  }, [invoices, now]);

  // ── 6-month profit trend ──
  const trend = useMemo(() => {
    const inv = invoices || [];
    const exp = expenses || [];
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const elapsedFraction = Math.min(1, now.getDate() / daysInMonth);
    const out: { label: string; profit: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const w = monthWindow(now, -i);
      // The current month (i===0) is month-to-date → prorate its salary just like
      // the hero, so the last trend point equals the headline number.
      const salary = totalSalaryForMonth(teamMembers, w.end) * (i === 0 ? elapsedFraction : 1);
      const p = monthProfit(inv, exp, salary, w.start, w.end);
      out.push({ label: MONTH_LABELS_SQ[w.monthIndex], profit: Math.round(p.profit) });
    }
    return out;
  }, [invoices, expenses, teamMembers, now]);

  // ── Receivables + overdue ──
  const receivables = useMemo(() => {
    const inv = invoices || [];
    const outstanding = calculateAccountsReceivable(inv);
    let overdueAmount = 0;
    let overdueCount = 0;
    for (const i of inv) {
      const out = getInvoiceOutstandingAll(i);
      if (out <= 0) continue;
      const due = parseDate(i.dueDate);
      if (due && due < now) {
        overdueAmount += out;
        overdueCount += 1;
      }
    }
    return { outstanding, overdueAmount, overdueCount };
  }, [invoices, now]);

  // ── Per-client P&L (revenue billed − project cost) ──
  const clientPnl = useMemo(() => {
    const inv = invoices || [];
    const projs = projects || [];
    const rows = (customers || []).map(c => {
      const revenue = inv
        .filter(i => i.customerId === c.id && i.status !== 'Draft' && i.status !== 'Cancelled')
        .reduce((s, i) => s + toAll(i.total ?? i.amount ?? 0, (i as any).currency), 0);
      const cost = projs
        .filter(p => p.customerId === c.id)
        .reduce((s, p) => s + (Number((p as any).spent) || 0), 0);
      const margin = revenue - cost;
      const marginPct = revenue > 0 ? Math.round((margin / revenue) * 100) : 0;
      return { id: c.id, name: c.name || 'Pa emër', revenue, cost, margin, marginPct };
    }).filter(r => r.revenue > 0 || r.cost > 0);

    const winners = [...rows].sort((a, b) => b.margin - a.margin).slice(0, 3);
    const losers = rows.filter(r => r.margin < 0).sort((a, b) => a.margin - b.margin).slice(0, 3);
    return { winners, losers };
  }, [invoices, projects, customers]);

  // ── Recurring-invoice health: which "repeats" failed to generate ──
  // Mirrors the cron's own generation guard (api/cron/run.ts runRecurringInvoices):
  // a PARENT recurring invoice should have spawned a child, but didn't.
  const recurringHealth = useMemo(() => {
    const inv = invoices || [];
    const nameById = new Map((customers || []).map(c => [c.id, c.name || 'Pa emër']));
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).getTime();

    // Latest auto-generated child createdAt per parent (the cron's idempotency key).
    const latestChildByParent = new Map<string, number>();
    for (const i of inv) {
      const parentId = (i as any).parentInvoiceId;
      if (!parentId || !(i as any).autoGenerated) continue;
      const created = parseDate((i as any).createdAt);
      const ms = created ? created.getTime() : 0;
      const prev = latestChildByParent.get(parentId) ?? 0;
      if (ms > prev) latestChildByParent.set(parentId, ms);
    }

    const parents = inv.filter(i => i.isRecurring === true && !(i as any).autoGenerated);
    const stuck: { id: string; name: string; amount: number; freq: string; daysOverdue: number }[] = [];
    const misconfigured: { id: string; name: string; amount: number; reason: string }[] = [];
    let paused = 0;
    let healthy = 0;

    for (const p of parents) {
      const amount = toAll(p.total ?? p.amount ?? 0, (p as any).currency);
      const name = p.customerId ? (nameById.get(p.customerId) || 'Pa klient') : 'Pa klient';
      const freq = p.recurringFrequency;
      const nrd = parseDate(p.nextRecurringDate);

      if (!nrd || !freq) {
        misconfigured.push({
          id: p.id, name, amount,
          reason: !freq ? 'pa frekuencë' : 'pa datën e radhës (nextRecurringDate)',
        });
        continue;
      }
      if (p.isRecurringPaused) { paused++; continue; }
      if (nrd.getTime() >= startOfToday) { healthy++; continue; } // future/today → OK

      const lastChild = latestChildByParent.get(p.id) ?? 0;
      if (lastChild >= nrd.getTime()) { healthy++; continue; } // already generated for this cycle

      const daysOverdue = Math.floor((startOfToday - nrd.getTime()) / 86_400_000);
      stuck.push({ id: p.id, name, amount, freq, daysOverdue });
    }

    stuck.sort((a, b) => b.daysOverdue - a.daysOverdue);
    return { stuck, misconfigured, paused, healthy, totalParents: parents.length };
  }, [invoices, customers, now]);

  // ── ONE period + ONE revenue basis for every P&L breakdown ──
  // Previously the project card owned a hidden month/year/all toggle that also
  // drove the department, trend and responsible cards, and the responsible card
  // owned a SECOND, independent month dropdown. Both are now one control row,
  // rendered above the panels it scopes. Dropping the responsible card's own
  // `months: 1` override changes nothing: it only reads `revenue` and
  // `responsibleUserId` off the rows, neither of which touches the salary pool.
  const [period, setPeriod] = useState<Period>('year');
  const [revenueBasis, setRevenueBasis] = useState<'budget' | 'invoiced'>('budget');

  const periodOpts = useMemo((): ProjectPnlOptions => {
    if (period === 'month') {
      const w = monthWindow(now, 0);
      return { range: { start: w.start, end: w.end }, mode: 'all', now };
    }
    if (period === 'all') return { allTime: true, mode: 'all', now };
    if (isPickedMonth(period)) {
      const [y, m] = period.split('-').map(Number);
      return {
        range: {
          start: new Date(y, m, 1, 0, 0, 0, 0),
          end: new Date(y, m + 1, 0, 23, 59, 59, 999),
        },
        mode: 'all',
        now,
      };
    }
    return { year: now.getFullYear(), mode: 'all', now };
  }, [period, now]);

  const periodLabel = useMemo(() => {
    if (period === 'month') return `${MONTH_NAMES_FULL[now.getMonth()]} ${now.getFullYear()} (deri sot)`;
    if (period === 'all') return 'Gjithë historiku';
    if (isPickedMonth(period)) {
      const [y, m] = period.split('-').map(Number);
      return `${MONTH_NAMES_FULL[m]} ${y}`;
    }
    return `Viti ${now.getFullYear()}`;
  }, [period, now]);

  // Past 12 months for the "specific month" picker. `month` already covers the
  // current month, so the list starts at the previous one.
  const monthOptions = useMemo(() => {
    const opts: { value: string; label: string }[] = [];
    for (let i = 1; i <= 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      opts.push({
        value: `${d.getFullYear()}-${d.getMonth()}`,
        label: `${MONTH_NAMES_FULL[d.getMonth()]} ${d.getFullYear()}`,
      });
    }
    return opts;
  }, [now]);

  // ── Per-project P&L (revenue − direct cost − allocated fixed overhead) ──
  // Full-absorption: the fixed pool (salaries + non-project expenses) is spread
  // across projects by revenue weight. See lib/finance/projectPnl.ts.
  const projectPnl = useMemo(
    () => computeProjectPnl(projects, teamMembers, expenses, { ...periodOpts, revenueBasis, invoices }),
    [projects, teamMembers, expenses, invoices, periodOpts, revenueBasis],
  );

  // ── Department (service-line) P&L — real profit per Social/SEO/Web… ──
  const [expandedDept, setExpandedDept] = useState<string | null>(null);
  const departmentPnl = useMemo(
    () => computeDepartmentPnl(projects, teamMembers, expenses, { ...periodOpts, revenueBasis, invoices }),
    [projects, teamMembers, expenses, invoices, periodOpts, revenueBasis],
  );

  // Monthly profit trend per department (last 6 months) — is Social growing or not?
  const departmentTrend = useMemo(
    () => buildDepartmentProfitTrend(projects, teamMembers, expenses, now, 6, { revenueBasis, invoices }),
    [projects, teamMembers, expenses, invoices, revenueBasis, now],
  );

  // Cap the trend at 4 named series and fold the tail into one "Të tjera" line.
  // Past ~5 lines on a 6-point chart the hues stop separating and it reads as
  // spaghetti — folding beats cycling the palette.
  const deptTrendView = useMemo(() => {
    const REST_KEY = 'Të tjera';
    const shown = departmentTrend.departments.slice(0, 4);
    const rest = departmentTrend.departments.slice(4);
    const data = departmentTrend.data.map(row => {
      const next: Record<string, number | string> = { label: row.label as string };
      for (const d of shown) next[d] = Number(row[d] || 0);
      if (rest.length) next[REST_KEY] = rest.reduce((s, d) => s + Number(row[d] || 0), 0);
      return next;
    });
    const series = [
      ...shown.map((d, i) => ({ key: d, color: SERIES[i], delta: departmentTrend.deltas[d]?.delta ?? 0 })),
      ...(rest.length
        ? [{
            key: REST_KEY,
            color: SERIES_REST,
            delta: rest.reduce((s, d) => s + (departmentTrend.deltas[d]?.delta ?? 0), 0),
          }]
        : []),
    ];
    return { data, series, restCount: rest.length };
  }, [departmentTrend]);

  const customerNameById = useMemo(
    () => new Map((customers || []).map(c => [c.id, c.name || 'Pa klient'])),
    [customers],
  );

  // userId → display name (for the per-responsible revenue card).
  const memberNameById = useMemo(() => {
    const m = new Map<string, string>();
    (teamMembers || []).forEach(tm => {
      if (tm.userId) m.set(tm.userId, tm.displayName || (tm as any).email || 'Pa emër');
    });
    return m;
  }, [teamMembers]);

  // ── Revenue generated per project responsible ──
  // Shares the page period + revenue basis; keeps each responsible's per-project
  // breakdown so a row can expand to show it.
  const [expandedStaff, setExpandedStaff] = useState<string | null>(null);
  const staffRevenue = useMemo(() => {
    const pnl = computeProjectPnl(projects, teamMembers, expenses, { ...periodOpts, revenueBasis, invoices });
    const map = new Map<string, { userId: string; name: string; revenue: number; projects: { id: string; name: string; revenue: number }[] }>();
    let unattributed = 0;
    for (const r of pnl.rows) {
      const uid = r.responsibleUserId;
      if (!uid) { unattributed += r.revenue; continue; }
      const row = map.get(uid) || { userId: uid, name: memberNameById.get(uid) || 'I panjohur', revenue: 0, projects: [] };
      row.revenue += r.revenue;
      row.projects.push({ id: r.id, name: r.name, revenue: r.revenue });
      map.set(uid, row);
    }
    const rows = Array.from(map.values())
      .map(r => ({ ...r, projects: r.projects.sort((a, b) => b.revenue - a.revenue) }))
      .sort((a, b) => b.revenue - a.revenue);
    return { rows, unattributed };
  }, [projects, teamMembers, expenses, invoices, periodOpts, revenueBasis, memberNameById]);

  // ── Forward-looking cashflow health (recurring inflow vs fixed outflow) ──
  const cashflow = useMemo(
    () => computeCashflowHealth(invoices, expenses, teamMembers, projects, now),
    [invoices, expenses, teamMembers, projects, now],
  );

  // ── Next-month profit forecast (project pipeline + recurring invoices) ──
  const forecast = useMemo(
    () => forecastNextMonth(projects, invoices, expenses, teamMembers, now),
    [projects, invoices, expenses, teamMembers, now],
  );

  // The trend and the forecast are one story, so they share one plot: six actual
  // months plus a dashed projected segment. The last actual value is duplicated
  // onto the forecast key so the projected segment connects instead of floating.
  const trendWithForecast = useMemo(() => {
    const rows: { label: string; profit: number | null; forecast: number | null }[] =
      trend.map(t => ({ label: t.label, profit: t.profit, forecast: null }));
    if (rows.length) rows[rows.length - 1].forecast = rows[rows.length - 1].profit;
    rows.push({
      label: MONTH_LABELS_SQ[forecast.monthIndex],
      profit: null,
      forecast: Math.round(forecast.predictedProfit),
    });
    return rows;
  }, [trend, forecast]);

  // ── Plain-language alarms ──
  const alarms = useMemo(() => {
    const items: { text: string; tone: 'red' | 'amber' }[] = [];
    if (receivables.overdueCount > 0) {
      items.push({
        tone: 'red',
        text: `${receivables.overdueCount} ${receivables.overdueCount === 1 ? 'faturë e vonuar' : 'fatura të vonuara'} = ${formatALL(receivables.overdueAmount)} pa mbledhur.`,
      });
    }
    if (thisMonth.profit < 0) {
      items.push({ tone: 'red', text: `Këtë muaj po humb para: ${formatALL(Math.abs(thisMonth.profit))}.` });
    }
    const marginPct = thisMonth.collected > 0 ? (thisMonth.profit / thisMonth.collected) * 100 : 0;
    if (thisMonth.profit >= 0 && thisMonth.collected > 0 && marginPct < 20) {
      items.push({ tone: 'amber', text: `Marzhi këtë muaj është vetëm ${Math.round(marginPct)}% — nën 20%.` });
    }
    if (recurringHealth.stuck.length > 0) {
      items.push({
        tone: 'red',
        text: `${recurringHealth.stuck.length} ${recurringHealth.stuck.length === 1 ? 'faturë recurring nuk u gjenerua' : 'fatura recurring nuk u gjeneruan'} — automatizimi ngeci.`,
      });
    }
    for (const l of clientPnl.losers) {
      items.push({ tone: 'amber', text: `Klienti "${l.name}" po humb para: ${formatALL(l.margin)} marzh.` });
    }
    return items;
  }, [receivables, thisMonth, clientPnl, recurringHealth]);

  // Badge on the "Rrjedha & rreziqe" tab — that tab holds everything broken.
  const riskCount = alarms.length + cashflow.alarms.length
    + recurringHealth.stuck.length + recurringHealth.misconfigured.length;

  if (!allowed) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        Kjo faqe është vetëm për pronarin.
      </div>
    );
  }

  if (lInv || lExp) return <FinancesSkeleton />;

  const profitPositive = thisMonth.profit >= 0;
  const monthLabel = `${MONTH_NAMES_FULL[now.getMonth()]} ${now.getFullYear()}`;

  /** The one control row. Rendered inside the tab whose panels it scopes. */
  const filterRow = (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-border bg-card px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Periudha</span>
        <Segmented
          value={isPickedMonth(period) ? '' : period}
          onChange={setPeriod}
          options={[['month', 'Ky muaj'], ['year', 'Viti'], ['all', 'Gjithë']] as const}
        />
        <select
          value={isPickedMonth(period) ? period : ''}
          onChange={(e) => { if (e.target.value) setPeriod(e.target.value); }}
          aria-label="Zgjidh një muaj të caktuar"
          className={cn(
            'h-7 rounded-md border px-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring',
            isPickedMonth(period)
              ? 'border-primary bg-accent font-medium text-accent-foreground'
              : 'border-input bg-background text-muted-foreground',
          )}
        >
          <option value="">Muaj i caktuar…</option>
          {monthOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Të ardhurat</span>
        <Segmented
          value={revenueBasis}
          onChange={setRevenueBasis}
          options={[['budget', 'Buxhet'], ['invoiced', 'Faturuar']] as const}
        />
      </div>
      <p className="ml-auto text-[11px] text-muted-foreground">
        {periodLabel} · {revenueBasis === 'invoiced' ? 'fatura reale të lidhura' : 'buxheti i projekteve'}
      </p>
    </div>
  );

  return (
    <div className="mx-auto max-w-6xl px-4 pb-10 sm:px-6">
      {/* Sticky page identity — the month never scrolls out of sight */}
      <header className="sticky top-0 z-20 -mx-4 mb-4 border-b border-border bg-background/85 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-xl font-bold text-foreground sm:text-2xl">Financat</h1>
          <p className="text-xs text-muted-foreground">{monthLabel} · a po fiton para, ku dhe pse</p>
        </div>
      </header>

      {/* Urgency first. This used to be the very last card on a ~4000px page. */}
      {alarms.length > 0 && <AlarmStrip alarms={alarms} onSeeAll={() => setTab('risk')} />}

      {/* ── The one hero figure, with its own derivation beside it ── */}
      <Card className="mt-4 overflow-hidden">
        <div className="grid lg:grid-cols-[1.05fr_1fr]">
          <div className="p-5 sm:p-6">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Fitimi neto · {monthLabel}
            </p>
            {/* Proportional figures on purpose: tabular-nums makes a number this
                large read loose, since every digit gets the width of a "0". */}
            <p className={cn(
              'mt-2 break-words text-[40px] font-bold leading-none sm:text-5xl',
              profitPositive ? INK_POS : INK_NEG,
            )}>
              {formatALL(thisMonth.profit)}
            </p>
            <div className={cn(
              'mt-3 inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium',
              profitDelta >= 0 ? 'bg-emerald-500/10 text-emerald-700' : 'bg-red-500/10 text-red-600',
            )}>
              {profitDelta >= 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
              {profitDelta >= 0 ? '+' : ''}{formatALL(profitDelta)}
              <span className="font-normal opacity-80">vs e njëjta datë muajin e kaluar</span>
            </div>
            <p className="mt-3 max-w-sm text-xs leading-relaxed text-muted-foreground">
              {profitPositive
                ? 'Kaq para të kanë mbetur këtë muaj pasi zbrite rrogat dhe shpenzimet nga paraja që hyri.'
                : 'Këtë muaj shpenzimet dhe rrogat kaluan paranë që hyri — je në humbje.'}
            </p>
          </div>

          {/* Money in − money out. Merged into the hero so the headline is never
              unexplained — and one whole card left the page. */}
          <div className="border-t border-border bg-muted/25 p-5 lg:border-l lg:border-t-0">
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Nga del ky numër
            </p>
            <div className="space-y-2">
              <BreakdownRow
                icon={<ArrowUpRight className="h-3.5 w-3.5 text-emerald-700" />}
                label="Para që hyri (arkëtuar)"
                hint="Fatura që klientët i paguan realisht"
                amount={thisMonth.collected}
                positive
              />
              <BreakdownRow
                icon={<ArrowDownRight className="h-3.5 w-3.5 text-red-600" />}
                label="− Rrogat"
                hint="Ekipi aktiv, pjesa deri sot"
                amount={-thisMonth.salary}
              />
              <BreakdownRow
                icon={<ArrowDownRight className="h-3.5 w-3.5 text-red-600" />}
                label="− Shpenzime të tjera"
                hint="Qira, softuer, marketing…"
                amount={-thisMonth.otherExpenses}
              />
              <div className="border-t border-border pt-2">
                <BreakdownRow
                  icon={profitPositive
                    ? <TrendingUp className="h-3.5 w-3.5 text-emerald-700" />
                    : <TrendingDown className="h-3.5 w-3.5 text-red-600" />}
                  label="= Fitimi neto"
                  hint="Çfarë të mbeti"
                  amount={thisMonth.profit}
                  bold
                  positive={profitPositive}
                />
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* ── Supporting stat tiles ── */}
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile
          icon={forecast.predictedProfit >= 0
            ? <TrendingUp className="h-4 w-4 text-sky-700" />
            : <TrendingDown className="h-4 w-4 text-red-600" />}
          label={`Parashikim · ${MONTH_NAMES_FULL[forecast.monthIndex]}`}
          value={forecast.predictedProfit}
          tone={forecast.predictedProfit >= 0 ? 'sky' : 'neg'}
          delta={{ value: forecast.predictedProfit - lastMonth.profit, label: 'vs muaji i shkuar' }}
        />
        <StatTile
          icon={<Wallet className="h-4 w-4 text-sky-700" />}
          label="Të pambledhura"
          value={receivables.outstanding}
          hint="Para që klientët të kanë borxh."
        />
        <StatTile
          icon={<Clock className={cn('h-4 w-4', receivables.overdueCount > 0 ? 'text-red-600' : 'text-muted-foreground')} />}
          label="Të vonuara"
          value={receivables.overdueAmount}
          tone={receivables.overdueCount > 0 ? 'neg' : 'default'}
          danger={receivables.overdueCount > 0}
          hint={receivables.overdueCount > 0
            ? `${receivables.overdueCount} fatura kaluan afatin — ndiqi për pagesë.`
            : 'Asnjë faturë e vonuar. 👍'}
        />
      </div>

      {/* ── Four questions, four tabs — instead of one endless scroll ── */}
      <Tabs value={tab} onValueChange={setTab} className="mt-5">
        <TabsList className="h-auto w-full justify-start gap-1 p-1 sm:w-auto">
          <TabsTrigger value="overview" className="text-xs sm:text-sm">Përmbledhje</TabsTrigger>
          <TabsTrigger value="profit" className="text-xs sm:text-sm">Fitimi</TabsTrigger>
          <TabsTrigger value="clients" className="text-xs sm:text-sm">Klientët</TabsTrigger>
          <TabsTrigger value="risk" className="gap-1.5 text-xs sm:text-sm">
            Rrjedha & rreziqe
            {riskCount > 0 && (
              <span className="rounded-full bg-red-500/15 px-1.5 py-px text-[10px] font-semibold tabular-nums text-red-600">
                {riskCount}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ── TAB 1 · Overview — the history, its projection, and where cash comes from ── */}
        <TabsContent value="overview" className="mt-4 space-y-4">
          <Panel
            title="Trendi i fitimit dhe parashikimi"
            icon={<TrendingUp className="h-4 w-4 text-sky-700" />}
            hint="6 muajt e fundit + muaji i ardhshëm. Muaji aktual është deri sot."
          >
            {/* Two series → a legend is mandatory; identity never rests on color alone. */}
            <ChartLegend items={[
              { label: 'Realizuar', color: SERIES[0] },
              { label: 'Parashikim', color: SERIES[0], dashed: true },
            ]} />
            <ResponsiveContainer width="100%" height={230}>
              <LineChart data={trendWithForecast} margin={{ top: 12, right: 16, left: 0, bottom: 4 }}>
                <CartesianGrid stroke={GRID_INK} vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: AXIS_INK }} axisLine={{ stroke: GRID_INK }} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: AXIS_INK }} width={46} axisLine={false} tickLine={false} tickFormatter={compactALL} />
                {/* A profit chart crosses zero — say where zero is. */}
                <ReferenceLine y={0} stroke={AXIS_INK} strokeWidth={1} />
                <Tooltip content={<ChartTip />} />
                <Line
                  name="Realizuar" type="monotone" dataKey="profit"
                  stroke={SERIES[0]} strokeWidth={2} strokeLinecap="round"
                  dot={{ r: 4, fill: SERIES[0], stroke: '#FFFFFF', strokeWidth: 2 }}
                  activeDot={{ r: 6, stroke: '#FFFFFF', strokeWidth: 2 }}
                  connectNulls={false}
                />
                <Line
                  name="Parashikim" type="monotone" dataKey="forecast"
                  stroke={SERIES[0]} strokeWidth={2} strokeDasharray="5 4" strokeLinecap="round"
                  dot={{ r: 4, fill: '#FFFFFF', stroke: SERIES[0], strokeWidth: 2 }}
                  activeDot={{ r: 6, stroke: '#FFFFFF', strokeWidth: 2 }}
                  connectNulls={false}
                />
              </LineChart>
            </ResponsiveContainer>
            <Explain label="Si ndërtohet parashikimi">
              <p>
                Të ardhura {formatALL(forecast.predictedRevenue)} (mujore {formatALL(forecast.recurringRevenue)}
                {forecast.newProjectRevenue > 0 ? ` + projekte të reja ${formatALL(forecast.newProjectRevenue)}` : ''})
                {' '}− rroga {formatALL(forecast.predictedSalary)} − shpenzime {formatALL(forecast.predictedOtherExpenses)}.
              </p>
              <p>
                Të ardhurat vijnë nga projektet mujore që përsëriten plus projektet një-herëshe që
                fillojnë atë muaj. Shpenzimet: mesatarja e {forecast.basisMonths} muajve.
              </p>
              <p>Nëse vija bie vazhdimisht, diçka po të ha marzhin.</p>
            </Explain>
          </Panel>

          <Panel
            title="Të ardhurat sipas burimit"
            icon={<Server className="h-4 w-4 text-sky-700" />}
            hint={`Arkëtimet e ${monthLabel}, ndarë sipas origjinës.`}
          >
            <div className="grid gap-5 lg:grid-cols-[minmax(0,270px)_1fr]">
              <div className="space-y-2.5">
                <SourceRow
                  color={SERIES[0]}
                  icon={<Server className="h-3.5 w-3.5 shrink-0" style={{ color: SERIES[0] }} />}
                  label="WHMCS"
                  amount={incomeBySource.whmcs}
                  total={incomeBySource.total}
                />
                <SourceRow
                  color={SERIES[1]}
                  icon={<Building2 className="h-3.5 w-3.5 shrink-0" style={{ color: SERIES[1] }} />}
                  label="Direkt (FivoCRM)"
                  amount={incomeBySource.direct}
                  total={incomeBySource.total}
                />
                <div className="flex items-baseline justify-between gap-2 border-t border-border pt-2">
                  <span className="text-xs font-semibold text-foreground">Gjithsej arkëtuar</span>
                  <span className="text-sm font-bold text-foreground">{formatALL(incomeBySource.total)}</span>
                </div>

                {/* Unpaid WHMCS balance — a stock, not a flow, so it is visually
                    separated from the collected split above it. */}
                <div className="flex items-center justify-between gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-2.5 py-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <Clock className="h-3.5 w-3.5 shrink-0 text-amber-600" />
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-foreground">Pa paguar nga WHMCS</p>
                      <p className="text-[10px] text-muted-foreground">
                        {whmcsUnpaid.count} fatura ende të papaguara
                      </p>
                    </div>
                  </div>
                  <p className={cn('shrink-0 text-sm font-bold tabular-nums', INK_WARN)}>
                    {formatALL(whmcsUnpaid.amount)}
                  </p>
                </div>
              </div>

              <div>
                <ChartLegend items={[
                  { label: 'WHMCS', color: SERIES[0] },
                  { label: 'Direkt', color: SERIES[1] },
                ]} />
                {/* Grouped, not stacked: the question is "which is bigger", and
                    adjacent bars get the 2px surface gap natively via barGap. */}
                <ResponsiveContainer width="100%" height={190}>
                  <BarChart data={incomeSourceByMonth} margin={{ top: 8, right: 8, left: 0, bottom: 4 }} barGap={2}>
                    <CartesianGrid stroke={GRID_INK} vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: AXIS_INK }} axisLine={{ stroke: GRID_INK }} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: AXIS_INK }} width={46} axisLine={false} tickLine={false} tickFormatter={compactALL} />
                    <Tooltip content={<ChartTip />} cursor={{ fill: 'rgba(12,27,51,0.04)' }} />
                    <Bar name="WHMCS" dataKey="whmcs" fill={SERIES[0]} radius={[4, 4, 0, 0]} maxBarSize={18} />
                    <Bar name="Direkt" dataKey="direct" fill={SERIES[1]} radius={[4, 4, 0, 0]} maxBarSize={18} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* The chart's table-view twin — every value readable without hover. */}
            <Disclosure label="Shfaq tabelën (6 muajt e fundit)" icon={<Table2 className="h-3 w-3" />}>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-[11px] text-muted-foreground">
                      <th className="px-1 py-1.5 text-left font-medium">Muaji</th>
                      <th className="px-1 py-1.5 text-right font-medium">WHMCS</th>
                      <th className="px-1 py-1.5 text-right font-medium">Direkt</th>
                      <th className="px-1 py-1.5 text-right font-medium">Gjithsej</th>
                    </tr>
                  </thead>
                  <tbody>
                    {incomeSourceByMonth.map((m, i) => (
                      <tr key={i} className="border-b border-border/50 last:border-0">
                        <td className="px-1 py-1.5 text-muted-foreground">{m.label}</td>
                        <td className="px-1 py-1.5 text-right font-medium tabular-nums text-foreground">{formatALL(m.whmcs)}</td>
                        <td className="px-1 py-1.5 text-right tabular-nums text-muted-foreground">{formatALL(m.direct)}</td>
                        <td className="px-1 py-1.5 text-right font-semibold tabular-nums text-foreground">{formatALL(m.whmcs + m.direct)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Disclosure>
          </Panel>
        </TabsContent>

        {/* ── TAB 2 · Profit by dimension — every panel scoped by the one filter row ── */}
        <TabsContent value="profit" className="mt-4 space-y-4">
          {filterRow}

          <Panel
            title="Fitimi sipas projekti"
            icon={<Briefcase className="h-4 w-4 text-sky-700" />}
            hint="Të ardhurat − kostot direkte − pjesa e kostove fikse, e ndarë sipas peshës së të ardhurave."
          >
            {/* Data-quality guards. Without these the numbers look authoritative
                while quietly excluding revenue: an invoice with no projectId is
                dropped from the 'Faturuar' basis, yet the FULL overhead pool is
                still allocated — so unlinked invoices read as pure loss. */}
            {projectPnl.unlinkedInvoices.count > 0 && (
              <Notice tone={revenueBasis === 'invoiced' ? 'warning' : 'neutral'}>
                <strong>{projectPnl.unlinkedInvoices.count} faturë</strong> pa projekt të lidhur
                (<strong>{formatALL(projectPnl.unlinkedInvoices.amount)}</strong>).
                {revenueBasis === 'invoiced'
                  ? ' Kjo vlerë NUK numërohet si e ardhur më poshtë, ndërsa kostot fikse ndahen plotësisht — ndaj fitimi duket më i vogël se realiteti.'
                  : ' Nuk prek llogaritjen mbi bazën "Buxhet", por do të mungojë nëse kalon te "Faturuar".'}
                {' '}
                <button
                  onClick={() => navigate('/app/invoices?project=none')}
                  className="font-medium underline hover:no-underline"
                >
                  Lidhi me projektet
                </button>
              </Notice>
            )}
            {projectPnl.missingBudget.count > 0 && (
              <Notice tone="warning">
                <strong>{projectPnl.missingBudget.count} projekt</strong> me të ardhura 0 thithin
                overhead pa sjellë asnjë të ardhur —{' '}
                {projectPnl.revenueBasis === 'invoiced'
                  ? 'nuk kanë faturë të lidhur në këtë periudhë.'
                  : 'nuk kanë buxhet të caktuar.'}
                {' '}({projectPnl.missingBudget.names.slice(0, 4).join(', ')}
                {projectPnl.missingBudget.names.length > 4 ? `, +${projectPnl.missingBudget.names.length - 4}` : ''})
              </Notice>
            )}

            <ProjectPnlBlock pnl={projectPnl} customerNameById={customerNameById} />

            <Explain>
              <p>
                "Fikse" = pjesa e rrogave dhe shpenzimeve të përgjithshme që i takon këtij projekti.
                Kostot variabile shtoji si Shpenzim i lidhur me projektin te faqja Shpenzimet.
              </p>
              <p>
                Ky panel është i ndryshëm nga tabi "Klientët" — atje baza është faturë reale − kosto
                e projektit; këtu është buxhet/faturuar − overhead i alokuar.
              </p>
            </Explain>
          </Panel>

          <Panel
            title="Fitimi sipas departamentit"
            icon={<Layers className="h-4 w-4 text-sky-700" />}
            hint="Sa fiton realisht nga Social, SEO, Web… Kliko një departament për projektet dhe stafin."
          >
            {departmentPnl.rows.length === 0 ? (
              <EmptyState text='Ende pa projekte me departament. Cakto "Departamentin" te projektet për ta parë këtë ndarje.' />
            ) : (
              <ul className="space-y-1.5">
                {departmentPnl.rows.map(d => {
                  const maxAbs = Math.max(...departmentPnl.rows.map(r => Math.abs(r.profit)), 1);
                  const pct = Math.round((Math.abs(d.profit) / maxAbs) * 100);
                  const open = expandedDept === d.department;
                  const pos = d.profit >= 0;
                  return (
                    <li key={d.department} className="rounded-lg border border-border">
                      <button
                        type="button"
                        onClick={() => setExpandedDept(open ? null : d.department)}
                        className="w-full rounded-lg p-2.5 text-left transition-colors hover:bg-muted/40"
                        aria-expanded={open}
                      >
                        <div className="mb-1.5 flex items-center justify-between gap-2">
                          <span className="flex min-w-0 flex-1 items-center gap-1 truncate text-sm font-medium text-foreground">
                            <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} />
                            {d.department}
                            <span className="text-xs font-normal text-muted-foreground">
                              · {d.projects.length} {d.projects.length === 1 ? 'projekt' : 'projekte'}
                            </span>
                          </span>
                          <span className={cn('shrink-0 text-sm font-semibold tabular-nums', pos ? INK_POS : INK_NEG)}>
                            {formatALL(d.profit)}
                            {d.margin != null && (
                              <span className="ml-1 text-xs font-normal text-muted-foreground">
                                ({Math.round(d.margin * 100)}%)
                              </span>
                            )}
                          </span>
                        </div>
                        <Meter pct={pct} tone={pos ? 'pos' : 'neg'} />
                        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                          <span>Të ardhura {formatALL(d.revenue)}</span>
                          <span>· Staf {formatALL(d.labor)}</span>
                          <span>· Shpenzime {formatALL(d.directCost)}</span>
                          <span>· Overhead {formatALL(d.overhead)}</span>
                        </div>
                      </button>
                      {open && (
                        <div className="space-y-2 border-t border-border/60 px-3 pb-2.5 pt-1">
                          {d.projects.map(p => (
                            <div key={p.id} className="pt-1.5">
                              <div className="flex items-center justify-between gap-2 text-xs">
                                <span className="min-w-0 flex-1 truncate text-foreground">{p.name}</span>
                                <span className={cn('shrink-0 tabular-nums', p.profit >= 0 ? INK_POS : INK_NEG)}>
                                  {formatALL(p.profit)}
                                </span>
                              </div>
                              <div className="text-[10px] text-muted-foreground">
                                Të ardhura {formatALL(p.revenue)} − staf {formatALL(p.labor)} − shpenzime {formatALL(p.directCost)} − overhead {formatALL(p.overhead)}
                              </div>
                              {p.participants.length > 0 && (
                                <div className="mt-1 flex flex-wrap gap-1">
                                  {p.participants.map(pt => (
                                    <span key={pt.userId} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                      {pt.name}: {formatALL(pt.cost)}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {departmentPnl.unallocatedLabor.total > 0 && (
              <p className={cn('mt-2 text-[11px]', INK_WARN)}>
                {formatALL(departmentPnl.unallocatedLabor.total)} rroga të stafit që s'punoi në asnjë
                projekt këtë periudhë (kosto e paalokuar te departamentet).
              </p>
            )}
          </Panel>

          {deptTrendView.series.length > 0 && (
            <Panel
              title="Trendi sipas departamentit"
              icon={<TrendingUp className="h-4 w-4 text-sky-700" />}
              hint="6 muajt e fundit — a po rritet apo po bie secili departament. (Muaji aktual është deri sot.)"
            >
              <ResponsiveContainer width="100%" height={230}>
                <LineChart data={deptTrendView.data} margin={{ top: 12, right: 16, left: 0, bottom: 4 }}>
                  <CartesianGrid stroke={GRID_INK} vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: AXIS_INK }} axisLine={{ stroke: GRID_INK }} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: AXIS_INK }} width={46} axisLine={false} tickLine={false} tickFormatter={compactALL} />
                  <ReferenceLine y={0} stroke={AXIS_INK} strokeWidth={1} />
                  <Tooltip content={<ChartTip />} />
                  {deptTrendView.series.map(s => (
                    <Line
                      key={s.key} name={s.key} type="monotone" dataKey={s.key}
                      stroke={s.color} strokeWidth={2} strokeLinecap="round"
                      dot={{ r: 3, fill: s.color, stroke: '#FFFFFF', strokeWidth: 2 }}
                      activeDot={{ r: 6, stroke: '#FFFFFF', strokeWidth: 2 }}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>

              {/* The legend doubles as the month-over-month delta list. */}
              <ul className="mt-3 grid grid-cols-1 gap-x-5 gap-y-1.5 sm:grid-cols-2">
                {deptTrendView.series.map(s => {
                  const up = s.delta >= 0;
                  return (
                    <li key={s.key} className="flex items-center gap-2 text-sm">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s.color }} />
                      <span className="min-w-0 flex-1 truncate text-foreground">{s.key}</span>
                      <span className={cn('flex shrink-0 items-center gap-0.5 text-xs font-medium tabular-nums', up ? INK_POS : INK_NEG)}>
                        {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                        {up ? '+' : ''}{formatALL(s.delta)}
                      </span>
                    </li>
                  );
                })}
              </ul>
              {deptTrendView.restCount > 0 && (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  "Të tjera" përmbledh {deptTrendView.restCount} departamente të tjera më të vogla.
                </p>
              )}
            </Panel>
          )}

          <Panel
            title="Të ardhurat sipas përgjegjësit"
            icon={<Users className="h-4 w-4 text-sky-700" />}
            hint="Kliko një person për të parë projektet e tij me vlerën e secilit."
          >
            {staffRevenue.rows.length === 0 ? (
              <EmptyState text="Ende pa projekte me përgjegjës për këtë periudhë." />
            ) : (
              <ul className="space-y-1.5">
                {staffRevenue.rows.map(r => {
                  const top = staffRevenue.rows[0].revenue;
                  const pct = top > 0 ? Math.round((r.revenue / top) * 100) : 0;
                  const open = expandedStaff === r.userId;
                  return (
                    <li key={r.userId} className="rounded-lg border border-border">
                      <button
                        type="button"
                        onClick={() => setExpandedStaff(open ? null : r.userId)}
                        className="w-full rounded-lg p-2.5 text-left transition-colors hover:bg-muted/40"
                        aria-expanded={open}
                      >
                        <div className="mb-1.5 flex items-center justify-between gap-2">
                          <span className="flex min-w-0 flex-1 items-center gap-1 truncate text-sm text-foreground">
                            <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} />
                            {r.name}
                            <span className="text-xs text-muted-foreground">
                              · {r.projects.length} {r.projects.length === 1 ? 'projekt' : 'projekte'}
                            </span>
                          </span>
                          <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">
                            {formatALL(r.revenue)}
                          </span>
                        </div>
                        <Meter pct={pct} tone="neutral" />
                      </button>
                      {open && (
                        <ul className="space-y-1 border-t border-border/60 px-3 pb-2.5 pt-1">
                          {r.projects.map(p => (
                            <li key={p.id} className="flex items-center justify-between gap-2 pt-1.5 text-xs">
                              <span className="min-w-0 flex-1 truncate text-muted-foreground">{p.name}</span>
                              <span className="shrink-0 tabular-nums text-foreground">{formatALL(p.revenue)}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {staffRevenue.unattributed > 0 && (
              <p className={cn('mt-2 text-[11px]', INK_WARN)}>
                {formatALL(staffRevenue.unattributed)} pa përgjegjës të caktuar — cakto një përgjegjës
                te projektet për t'i atribuar.
              </p>
            )}
          </Panel>
        </TabsContent>

        {/* ── TAB 3 · Clients — a different revenue basis, so it gets its own tab ── */}
        <TabsContent value="clients" className="mt-4 space-y-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Panel
              title="Ku fiton më shumë"
              icon={<CheckCircle2 className="h-4 w-4 text-emerald-700" />}
              hint="Top 3 klientët sipas marzhit."
            >
              <ClientList rows={clientPnl.winners} emptyText="Ende pa të dhëna klientësh." />
            </Panel>
            <Panel
              title="Ku humb para"
              icon={<AlertTriangle className="h-4 w-4 text-red-600" />}
              hint="Klientët me marzh negativ."
              tone={clientPnl.losers.length > 0 ? 'danger' : 'default'}
            >
              <ClientList rows={clientPnl.losers} emptyText="Asnjë klient në humbje. 👍" />
            </Panel>
          </div>
          <Card className="p-4">
            <Explain label="Pse numrat këtu nuk përputhen me tabin 'Fitimi'">
              <p>
                Baza këtu: <strong>fatura reale − kosto e projektit</strong> (punë + shpenzime), për
                gjithë historikun e klientit.
              </p>
              <p>
                Baza te "Fitimi": <strong>buxhet ose faturuar − overhead i alokuar</strong>, brenda
                periudhës që zgjodhe. Dy pyetje të ndryshme, dy përgjigje të ndryshme.
              </p>
            </Explain>
          </Card>
        </TabsContent>

        {/* ── TAB 4 · Cashflow & everything that is broken ── */}
        <TabsContent value="risk" className="mt-4 space-y-4">
          {alarms.length > 0 && (
            <Panel
              title="Çfarë kërkon vëmendje"
              icon={<AlertTriangle className="h-4 w-4 text-amber-600" />}
              tone="warning"
            >
              <ul className="space-y-2">
                {alarms.map((a, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-sm">
                    <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', a.tone === 'red' ? 'bg-red-500' : 'bg-amber-500')} />
                    <span className="text-foreground">{a.text}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          <Panel
            title="Shëndeti i rrjedhës së parasë (mujore)"
            icon={<Wallet className={cn('h-4 w-4', cashflow.gap < 0 ? 'text-red-600' : 'text-emerald-700')} />}
            hint="A i mbulojnë të ardhurat e rregullta (kontratat mujore) kostot fikse çdo muaj?"
            tone={cashflow.gap < 0 ? 'danger' : 'default'}
          >
            <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
              <PoolTile label="Të ardhura të rregullta" value={cashflow.monthlyInflow} tone="pos" />
              <PoolTile
                label="Kosto fikse"
                value={cashflow.monthlyOutflow}
                tone="neg"
                hint={`rroga ${formatALL(cashflow.salaries)} + periodike ${formatALL(cashflow.recurringExpenses)}`}
              />
              <PoolTile
                label={cashflow.gap >= 0 ? 'Tepricë mujore' : 'Mungesë mujore'}
                value={cashflow.gap}
                tone={cashflow.gap >= 0 ? 'pos' : 'neg'}
                bold
              />
            </div>
            {cashflow.alarms.length === 0 ? (
              <AllClear text="Rrjedha e parasë duket e shëndetshme." />
            ) : (
              <ul className="space-y-2">
                {cashflow.alarms.map(a => (
                  <li key={a.id} className="flex items-start gap-2.5 text-sm">
                    <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', a.severity === 'red' ? 'bg-red-500' : 'bg-amber-500')} />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-foreground">
                        {a.title}
                        {a.id === 'concentration' && a.customerId && (
                          <span className="font-normal text-muted-foreground">
                            {' '}— {customerNameById.get(a.customerId) || 'klient'}
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">{a.detail}</p>
                    </div>
                    {a.amount != null && (
                      <span className={cn('shrink-0 text-sm font-semibold tabular-nums', a.amount < 0 ? INK_NEG : 'text-foreground')}>
                        {formatALL(a.amount)}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel
            title="Fatura recurring që nuk u përsëritën"
            icon={<Repeat className="h-4 w-4 text-sky-700" />}
            hint="Fatura që duhej të kopjoheshin automatikisht, por s'u gjeneruan (afati kaloi, pa kopje të re)."
            tone={recurringHealth.stuck.length > 0 || recurringHealth.misconfigured.length > 0 ? 'danger' : 'default'}
          >
            {recurringHealth.stuck.length === 0 && recurringHealth.misconfigured.length === 0 ? (
              <AllClear
                text={recurringHealth.totalParents === 0
                  ? 'Nuk ke fatura recurring.'
                  : `Të gjitha ${recurringHealth.totalParents} faturat recurring janë në rregull.`}
              />
            ) : (
              <div className="space-y-4">
                {recurringHealth.stuck.length > 0 && (
                  <ul className="space-y-2">
                    {recurringHealth.stuck.map(s => (
                      <li key={s.id} className="flex items-center gap-2 text-sm">
                        <XCircle className="h-4 w-4 shrink-0 text-red-600" />
                        <span className="min-w-0 flex-1 truncate text-foreground">
                          {s.name} <span className="text-muted-foreground">· {FREQ_LABEL[s.freq] || s.freq}</span>
                        </span>
                        <span className={cn('shrink-0 text-xs font-medium tabular-nums', INK_NEG)}>
                          {s.daysOverdue} ditë vonesë
                        </span>
                        <span className="ml-2 shrink-0 text-sm font-semibold tabular-nums text-foreground">
                          {formatALL(s.amount)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}

                {recurringHealth.misconfigured.length > 0 && (
                  <div>
                    <p className={cn('mb-1.5 text-xs font-medium', INK_WARN)}>
                      Konfigurim i paplotë (s'do gjenerohen kurrë):
                    </p>
                    <ul className="space-y-1.5">
                      {recurringHealth.misconfigured.map(m => (
                        <li key={m.id} className="flex items-center gap-2 text-sm">
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                          <span className="min-w-0 flex-1 truncate text-foreground">
                            {m.name} <span className="text-muted-foreground">· {m.reason}</span>
                          </span>
                          <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">
                            {formatALL(m.amount)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <Explain label="Si rregullohet">
                  <p>
                    Hap faturën në <strong>Faturat</strong>, kontrollo frekuencën dhe datën e radhës,
                    ose prit ciklin tjetër të cron-it.
                  </p>
                  <p>Faturat në pauzë ({recurringHealth.paused}) nuk numërohen si problem.</p>
                </Explain>
              </div>
            )}
          </Panel>
        </TabsContent>
      </Tabs>
    </div>
  );
};

// ── Layout primitives ──────────────────────────────────────────────────────

/** Section card: one title row plus an optional one-line hint. */
const Panel: React.FC<{
  title: string;
  icon?: React.ReactNode;
  hint?: string;
  tone?: 'default' | 'danger' | 'warning';
  className?: string;
  children: React.ReactNode;
}> = ({ title, icon, hint, tone = 'default', className, children }) => (
  <Card className={cn(
    'p-4 sm:p-5',
    tone === 'danger' && 'border-red-500/40',
    tone === 'warning' && 'border-amber-500/40',
    className,
  )}>
    <div className="mb-3 min-w-0">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        {icon}
        {title}
      </h2>
      {hint && <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">{hint}</p>}
    </div>
    {children}
  </Card>
);

/**
 * Collapsed explanation. Each card used to carry up to three paragraphs of prose
 * that drowned its numbers; the text is still here, just folded away.
 */
const Explain: React.FC<{ label?: string; children: React.ReactNode }> = ({
  label = 'Si llogaritet',
  children,
}) => (
  <details className="group mt-3">
    <summary className="flex w-fit cursor-pointer list-none items-center gap-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
      <Info className="h-3 w-3" />
      {label}
      <ChevronDown className="h-3 w-3 transition-transform group-open:rotate-180" />
    </summary>
    <div className="mt-2 space-y-1.5 border-l-2 border-border pl-2.5 text-[11px] leading-relaxed text-muted-foreground">
      {children}
    </div>
  </details>
);

/** Same mechanic as <Explain>, for a table-view twin rather than prose. */
const Disclosure: React.FC<{ label: string; icon?: React.ReactNode; children: React.ReactNode }> = ({
  label, icon, children,
}) => (
  <details className="group mt-4 border-t border-border pt-3">
    <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
      {icon}
      {label}
      <ChevronDown className="h-3 w-3 transition-transform group-open:rotate-180" />
    </summary>
    <div className="mt-2.5">{children}</div>
  </details>
);

function Segmented<T extends string>({ value, onChange, options }: {
  value: T | '';
  onChange: (v: T) => void;
  options: readonly (readonly [T, string])[];
}) {
  return (
    <div className="inline-flex items-center gap-0.5 rounded-lg bg-muted p-0.5">
      {options.map(([key, label]) => (
        <button
          key={key}
          type="button"
          aria-pressed={value === key}
          onClick={() => onChange(key)}
          className={cn(
            'rounded-md px-2.5 py-1 text-xs transition-colors',
            value === key
              ? 'bg-background font-medium text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** Compact top-of-page urgency strip. Shows the first two, links to the rest. */
const AlarmStrip: React.FC<{
  alarms: { text: string; tone: 'red' | 'amber' }[];
  onSeeAll: () => void;
}> = ({ alarms, onSeeAll }) => {
  const worst = alarms.some(a => a.tone === 'red') ? 'red' : 'amber';
  const shown = alarms.slice(0, 2);
  return (
    <div className={cn(
      'rounded-xl border px-3.5 py-3',
      worst === 'red' ? 'border-red-500/35 bg-red-500/5' : 'border-amber-500/35 bg-amber-500/5',
    )}>
      <div className="flex items-start gap-2.5">
        <AlertTriangle className={cn('mt-0.5 h-4 w-4 shrink-0', worst === 'red' ? 'text-red-600' : 'text-amber-600')} />
        <div className="min-w-0 flex-1">
          <ul className="space-y-1">
            {shown.map((a, i) => (
              <li key={i} className="text-sm leading-snug text-foreground">{a.text}</li>
            ))}
          </ul>
          <button
            onClick={onSeeAll}
            className="mt-1.5 text-xs font-medium text-primary-hover underline hover:no-underline"
          >
            {alarms.length > shown.length ? `Shiko të gjitha (${alarms.length})` : 'Shiko detajet'}
          </button>
        </div>
      </div>
    </div>
  );
};

/** Stat tile — label, value in proportional figures, optional delta + hint. */
const StatTile: React.FC<{
  icon?: React.ReactNode;
  label: string;
  value: number;
  tone?: 'default' | 'pos' | 'neg' | 'sky';
  hint?: string;
  danger?: boolean;
  delta?: { value: number; label: string };
}> = ({ icon, label, value, tone = 'default', hint, danger, delta }) => (
  <Card className={cn('p-4', danger && 'border-red-500/40')}>
    <div className="flex items-center gap-2">
      {icon}
      <p className="truncate text-xs font-medium text-muted-foreground">{label}</p>
    </div>
    <p className={cn(
      'mt-1.5 break-words text-2xl font-bold leading-tight',
      tone === 'pos' && INK_POS,
      tone === 'neg' && INK_NEG,
      tone === 'sky' && 'text-sky-700',
      tone === 'default' && 'text-foreground',
    )}>
      {formatALL(value)}
    </p>
    {delta && (
      <p className={cn(
        'mt-1 flex items-center gap-1 text-[11px] font-medium tabular-nums',
        delta.value >= 0 ? INK_POS : INK_NEG,
      )}>
        {delta.value >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
        {delta.value >= 0 ? '+' : ''}{formatALL(delta.value)}
        <span className="font-normal text-muted-foreground">{delta.label}</span>
      </p>
    )}
    {hint && <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{hint}</p>}
  </Card>
);

/** Magnitude meter. The track is a lighter step of the fill's own ramp. */
const Meter: React.FC<{ pct: number; tone: 'pos' | 'neg' | 'neutral' }> = ({ pct, tone }) => (
  <div className={cn(
    'h-1.5 overflow-hidden rounded-full',
    tone === 'pos' && 'bg-emerald-600/15',
    tone === 'neg' && 'bg-red-600/15',
    tone === 'neutral' && 'bg-sky-600/15',
  )}>
    <div
      className={cn(
        'h-full rounded-full',
        tone === 'pos' && 'bg-emerald-600',
        tone === 'neg' && 'bg-red-600',
        tone === 'neutral' && 'bg-sky-600',
      )}
      style={{ width: `${Math.max(2, Math.min(100, pct))}%` }}
    />
  </div>
);

const Notice: React.FC<{ tone: 'warning' | 'neutral'; children: React.ReactNode }> = ({ tone, children }) => (
  <div className={cn(
    'mb-3 rounded-lg border p-2.5 text-xs leading-relaxed',
    tone === 'warning'
      ? 'border-amber-500/40 bg-amber-500/5 text-amber-900'
      : 'border-border bg-muted/40 text-muted-foreground',
  )}>
    {children}
  </div>
);

const AllClear: React.FC<{ text: string }> = ({ text }) => (
  <p className={cn('flex items-center gap-1.5 text-sm', INK_POS)}>
    <CheckCircle2 className="h-4 w-4" />
    {text}
  </p>
);

const EmptyState: React.FC<{ text: string }> = ({ text }) => (
  <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground">
    {text}
  </p>
);

// ── Chart primitives ───────────────────────────────────────────────────────

/** Tooltip in system tokens: text stays ink, the dot carries series identity. */
const ChartTip: React.FC<any> = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  const rows = payload.filter((p: any) => p.value != null);
  if (!rows.length) return null;
  return (
    <div className="rounded-lg border border-border-strong bg-popover px-3 py-2 shadow-lg">
      <p className="mb-1.5 text-[11px] font-semibold text-foreground">{label}</p>
      <ul className="space-y-1">
        {rows.map((p: any) => (
          <li key={p.dataKey} className="flex items-center gap-2 text-[11px]">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: p.color || p.fill }} />
            <span className="text-muted-foreground">{p.name}</span>
            <span className="ml-auto pl-3 font-semibold tabular-nums text-foreground">{formatALL(p.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};

const ChartLegend: React.FC<{ items: { label: string; color: string; dashed?: boolean }[] }> = ({ items }) => (
  <ul className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1">
    {items.map(it => (
      <li key={it.label} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {it.dashed ? (
          <svg width="14" height="4" viewBox="0 0 14 4" aria-hidden="true">
            <line x1="0" y1="2" x2="14" y2="2" stroke={it.color} strokeWidth="2" strokeDasharray="4 3" />
          </svg>
        ) : (
          <span className="h-2 w-2 rounded-full" style={{ background: it.color }} />
        )}
        {it.label}
      </li>
    ))}
  </ul>
);

// ── Data sub-components ────────────────────────────────────────────────────

const BreakdownRow: React.FC<{
  icon: React.ReactNode;
  label: string;
  hint: string;
  amount: number;
  positive?: boolean;
  bold?: boolean;
}> = ({ icon, label, hint, amount, positive, bold }) => (
  <div className="flex items-center gap-2.5">
    <div className="shrink-0">{icon}</div>
    <div className="min-w-0 flex-1">
      <p className={cn('text-xs text-foreground', bold ? 'font-bold' : 'font-medium')}>{label}</p>
      <p className="truncate text-[10px] text-muted-foreground">{hint}</p>
    </div>
    <p className={cn(
      'shrink-0 tabular-nums',
      bold ? 'text-sm font-bold' : 'text-xs font-semibold',
      positive === undefined
        ? amount < 0 ? INK_NEG : 'text-foreground'
        : positive ? INK_POS : INK_NEG,
    )}>
      {formatALL(amount)}
    </p>
  </div>
);

/** One income source: share meter + amount, so the proportion reads at a glance. */
const SourceRow: React.FC<{
  color: string;
  icon: React.ReactNode;
  label: string;
  amount: number;
  total: number;
}> = ({ color, icon, label, amount, total }) => {
  const pct = total > 0 ? Math.round((amount / total) * 100) : 0;
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 truncate text-xs font-medium text-foreground">
          {icon}
          {label}
        </span>
        <span className="shrink-0 text-xs font-semibold tabular-nums text-foreground">
          {formatALL(amount)}
          <span className="ml-1 font-normal text-muted-foreground">{pct}%</span>
        </span>
      </div>
      {/* Track = the fill's own hue at low alpha, so the meter reads as one ramp. */}
      <div className="mt-1 h-1.5 overflow-hidden rounded-full" style={{ background: `${color}26` }}>
        <div className="h-full rounded-full" style={{ width: `${Math.max(2, pct)}%`, background: color }} />
      </div>
    </div>
  );
};

const ClientList: React.FC<{
  rows: { id: string; name: string; revenue: number; margin: number; marginPct: number }[];
  emptyText: string;
}> = ({ rows, emptyText }) => {
  if (!rows.length) return <EmptyState text={emptyText} />;
  const maxAbs = Math.max(...rows.map(r => Math.abs(r.margin)), 1);
  return (
    <ul className="space-y-2.5">
      {rows.map(r => (
        <li key={r.id}>
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 flex-1 truncate text-sm text-foreground">{r.name}</span>
            <span className={cn('shrink-0 text-sm font-semibold tabular-nums', r.margin < 0 ? INK_NEG : INK_POS)}>
              {formatALL(r.margin)}
              {r.revenue > 0 && (
                <span className="ml-1 text-xs font-normal text-muted-foreground">({r.marginPct}%)</span>
              )}
            </span>
          </div>
          <div className="mt-1">
            <Meter pct={Math.round((Math.abs(r.margin) / maxAbs) * 100)} tone={r.margin < 0 ? 'neg' : 'pos'} />
          </div>
        </li>
      ))}
    </ul>
  );
};

const ProjectPnlBlock: React.FC<{
  pnl: ReturnType<typeof computeProjectPnl>;
  customerNameById: Map<string, string>;
}> = ({ pnl, customerNameById }) => {
  if (pnl.rows.length === 0) {
    return <EmptyState text="Ende pa projekte për këtë periudhë." />;
  }

  const { fixedPool, totals, allocationBasis } = pnl;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <PoolTile label="Të ardhura" value={totals.revenue} />
        <PoolTile label="Kosto direkte" value={totals.directCost} tone="neg" />
        <PoolTile
          label="Kosto fikse"
          value={fixedPool.total}
          tone="neg"
          hint={`rroga ${formatALL(fixedPool.salaries)} + fikse ${formatALL(fixedPool.otherFixed)}`}
        />
        <PoolTile label="Fitimi total" value={totals.profit} tone={totals.profit >= 0 ? 'pos' : 'neg'} bold />
      </div>

      {allocationBasis === 'equal' && (
        <p className={cn('text-[11px]', INK_WARN)}>
          ⚠ Asnjë projekt s'ka buxhet — kostot fikse u ndanë në mënyrë të barabartë. Vendos buxhetin
          te projektet për ndarje reale.
        </p>
      )}

      <div className="-mx-1 overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="px-1 py-2 text-left font-medium">Projekti</th>
              <th className="px-1 py-2 text-right font-medium">Të ardhura</th>
              <th className="px-1 py-2 text-right font-medium">Direkte</th>
              <th className="px-1 py-2 text-right font-medium">Fikse</th>
              <th className="px-1 py-2 text-right font-medium">Fitimi</th>
              <th className="px-1 py-2 text-right font-medium">Marzh</th>
            </tr>
          </thead>
          <tbody>
            {pnl.rows.map(r => (
              <tr key={r.id} className="border-b border-border/50 last:border-0 hover:bg-muted/30">
                <td className="max-w-[180px] px-1 py-2">
                  <p className="truncate font-medium text-foreground">{r.name}</p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {r.customerId ? (customerNameById.get(r.customerId) || 'Pa klient') : 'Pa klient'}
                    {r.billingType === 'monthly' ? ` · mujore ×${r.activeMonths}` : ' · njëherëshe'}
                  </p>
                </td>
                <td className="px-1 py-2 text-right tabular-nums text-foreground">{formatALL(r.revenue)}</td>
                <td className="px-1 py-2 text-right tabular-nums text-muted-foreground">{formatALL(r.directCost)}</td>
                <td className="px-1 py-2 text-right tabular-nums text-muted-foreground">{formatALL(r.overhead)}</td>
                <td className={cn('px-1 py-2 text-right font-semibold tabular-nums', r.profit >= 0 ? INK_POS : INK_NEG)}>
                  {formatALL(r.profit)}
                </td>
                <td className={cn(
                  'px-1 py-2 text-right tabular-nums',
                  r.margin == null ? 'text-muted-foreground' : r.margin >= 0 ? INK_POS : INK_NEG,
                )}>
                  {r.margin == null ? '—' : `${Math.round(r.margin * 100)}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const PoolTile: React.FC<{
  label: string;
  value: number;
  tone?: 'pos' | 'neg' | 'default';
  bold?: boolean;
  hint?: string;
}> = ({ label, value, tone = 'default', bold, hint }) => (
  <div className="rounded-lg border border-border bg-muted/25 p-2.5">
    <p className="text-[11px] text-muted-foreground">{label}</p>
    <p className={cn(
      bold ? 'text-base font-bold' : 'text-sm font-semibold',
      tone === 'pos' && INK_POS,
      tone === 'neg' && INK_NEG,
      tone === 'default' && 'text-foreground',
    )}>
      {formatALL(value)}
    </p>
    {hint && <p className="mt-0.5 text-[10px] leading-tight text-muted-foreground">{hint}</p>}
  </div>
);

const FinancesSkeleton: React.FC = () => (
  <div className="mx-auto max-w-6xl space-y-4 px-4 py-4 sm:px-6">
    <Skeleton className="h-8 w-40" />
    <Skeleton className="h-44 w-full rounded-xl" />
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <Skeleton className="h-24 rounded-xl" />
      <Skeleton className="h-24 rounded-xl" />
      <Skeleton className="h-24 rounded-xl" />
    </div>
    <Skeleton className="h-9 w-72 rounded-lg" />
    <Skeleton className="h-64 w-full rounded-xl" />
  </div>
);

export default FinancesView;
