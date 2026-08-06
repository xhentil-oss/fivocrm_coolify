import React, { useMemo, useState } from 'react';
import { usePermissions } from '../contexts/PermissionsContext';
import { useCollection } from '../hooks/useFirestore';
import { Card } from '../components/ui/card';
import { formatALL, toAll } from '../lib/utils';
import {
  TrendingUp, TrendingDown, AlertTriangle, Wallet, Clock,
  ArrowDownRight, ArrowUpRight, Users, CheckCircle2, Repeat, XCircle, Briefcase, Layers,
} from 'lucide-react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
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
import { computeDepartmentPnl } from '../lib/finance/departmentPnl';

// ── Single-page, plain-language finance overview for the owner ──
// Answers one question: "Am I making money this month, where, and why?"
// Reuses financialAnalytics + per-client P&L logic (mirrors Customer360View).

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

const FinancesView: React.FC = () => {
  const permissions = usePermissions();
  const allowed = permissions.isOwner || permissions.isAdmin || permissions.isSuperAdmin;

  const { data: invoices, loading: lInv } = useCollection<Invoice>('invoices', { skipTeamFilter: true });
  const { data: expenses, loading: lExp } = useCollection<Expense>('expenses', { skipTeamFilter: true });
  const { data: customers } = useCollection<Customer>('customers', { skipTeamFilter: true });
  const { data: projects } = useCollection<Project>('projects', { skipTeamFilter: true });
  const { data: teamMembers } = useCollection<TeamMember>('teamMembers', { skipTeamFilter: true });

  const now = useMemo(() => new Date(), []);

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

  // ── Per-project P&L (revenue − direct cost − allocated fixed overhead) ──
  // Full-absorption: the fixed pool (salaries + non-project expenses) is spread
  // across projects by revenue weight. See lib/finance/projectPnl.ts.
  const [pnlPeriod, setPnlPeriod] = useState<'month' | 'year' | 'all'>('year');
  const projectPnl = useMemo(() => {
    let opts: ProjectPnlOptions;
    if (pnlPeriod === 'month') {
      const w = monthWindow(now, 0);
      opts = { range: { start: w.start, end: w.end }, mode: 'all', now };
    } else if (pnlPeriod === 'year') {
      opts = { year: now.getFullYear(), mode: 'all', now };
    } else {
      opts = { allTime: true, mode: 'all', now };
    }
    return computeProjectPnl(projects, teamMembers, expenses, opts);
  }, [projects, teamMembers, expenses, pnlPeriod, now]);

  // ── Department (service-line) P&L — real profit per Social/SEO/Web… ──
  const [expandedDept, setExpandedDept] = useState<string | null>(null);
  const departmentPnl = useMemo(() => {
    const opts = pnlPeriod === 'month'
      ? (() => { const w = monthWindow(now, 0); return { range: { start: w.start, end: w.end }, mode: 'all' as const, now }; })()
      : pnlPeriod === 'year'
      ? { year: now.getFullYear(), mode: 'all' as const, now }
      : { allTime: true, mode: 'all' as const, now };
    return computeDepartmentPnl(projects, teamMembers, expenses, opts);
  }, [projects, teamMembers, expenses, pnlPeriod, now]);

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
  // Has its own month filter (independent of the project-P&L card). Uses the
  // period-aware projectPnl engine (respects billingType) and keeps each
  // responsible's per-project breakdown so a row can expand to show it.
  const [staffMonth, setStaffMonth] = useState<string>('all');
  const [expandedStaff, setExpandedStaff] = useState<string | null>(null);

  const staffMonthOptions = useMemo(() => {
    const opts: { value: string; label: string }[] = [{ value: 'all', label: 'Të gjitha' }];
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      opts.push({ value: `${d.getFullYear()}-${d.getMonth()}`, label: `${MONTH_NAMES_FULL[d.getMonth()]} ${d.getFullYear()}` });
    }
    return opts;
  }, [now]);

  const staffRevenue = useMemo(() => {
    let opts: ProjectPnlOptions;
    if (staffMonth === 'all') {
      opts = { allTime: true, mode: 'all', now };
    } else {
      const [y, m] = staffMonth.split('-').map(Number);
      const start = new Date(y, m, 1, 0, 0, 0, 0);
      const end = new Date(y, m + 1, 0, 23, 59, 59, 999);
      opts = { range: { start, end }, mode: 'all', months: 1, now };
    }
    const pnl = computeProjectPnl(projects, teamMembers, expenses, opts);
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
  }, [projects, teamMembers, expenses, staffMonth, memberNameById, now]);

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

  if (!allowed) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        Kjo faqe është vetëm për pronarin.
      </div>
    );
  }

  const loading = lInv || lExp;
  if (loading) {
    return <div className="p-8 text-center text-muted-foreground">Duke ngarkuar financat…</div>;
  }

  const profitPositive = thisMonth.profit >= 0;
  const monthLabel = `${MONTH_NAMES_FULL[now.getMonth()]} ${now.getFullYear()}`;

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">Financat</h1>
        <p className="text-sm text-muted-foreground">
          Pamja e shpejtë: a po fiton para këtë muaj, ku, dhe pse.
        </p>
      </div>

      {/* 1 — The one number */}
      <Card className={`p-6 border-2 ${profitPositive ? 'border-emerald-500/40' : 'border-red-500/40'}`}>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground">Fitimi neto — {monthLabel}</p>
            <p className={`text-4xl sm:text-5xl font-extrabold tabular-nums break-words mt-1 ${profitPositive ? 'text-emerald-600' : 'text-red-600'}`}>
              {formatALL(thisMonth.profit)}
            </p>
            <p className="text-sm text-muted-foreground mt-2 max-w-md">
              {profitPositive
                ? 'Kaq para të kanë mbetur këtë muaj pasi zbrite rrogat dhe shpenzimet nga paraja që hyri.'
                : 'Këtë muaj shpenzimet dhe rrogat kaluan paranë që hyri — je në humbje.'}
            </p>
          </div>
          <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ${profitDelta >= 0 ? 'bg-emerald-500/10 text-emerald-600' : 'bg-red-500/10 text-red-600'}`}>
            {profitDelta >= 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
            {profitDelta >= 0 ? '+' : ''}{formatALL(profitDelta)} vs muaji i kaluar
          </div>
        </div>
      </Card>

      {/* 1b — Predicted profit next month */}
      <Card className="p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground flex items-center gap-1.5">
              {forecast.predictedProfit >= 0 ? <TrendingUp className="w-4 h-4 text-sky-600" /> : <TrendingDown className="w-4 h-4 text-red-600" />}
              Fitimi i parashikuar — {MONTH_NAMES_FULL[forecast.monthIndex]} {forecast.year}
            </p>
            <p className={`text-2xl sm:text-3xl font-bold tabular-nums break-words mt-1 ${forecast.predictedProfit >= 0 ? 'text-sky-600' : 'text-red-600'}`}>
              {formatALL(forecast.predictedProfit)}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Të ardhura {formatALL(forecast.predictedRevenue)} (mujore {formatALL(forecast.recurringRevenue)}
              {forecast.newProjectRevenue > 0 ? ` + projekte të reja ${formatALL(forecast.newProjectRevenue)}` : ''})
              {' '}− rroga {formatALL(forecast.predictedSalary)} − shpenzime {formatALL(forecast.predictedOtherExpenses)}.
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Të ardhurat nga projektet mujore që përsëriten + projektet një-herëshe që fillojnë atë muaj. Shpenzimet: mesatarja e {forecast.basisMonths} muajve.
            </p>
          </div>
          <div className={`rounded-lg px-3 py-2 text-xs font-medium ${forecast.predictedProfit >= lastMonth.profit ? 'bg-emerald-500/10 text-emerald-600' : 'bg-amber-500/10 text-amber-600'}`}>
            {forecast.predictedProfit >= lastMonth.profit ? '↑' : '↓'} vs muaji i shkuar ({formatALL(forecast.predictedProfit - lastMonth.profit)})
          </div>
        </div>
      </Card>

      {/* 2 — Where the number comes from */}
      <Card className="p-5">
        <h2 className="text-sm font-semibold mb-4">Nga del ky numër</h2>
        <div className="space-y-2.5">
          <BreakdownRow
            icon={<ArrowUpRight className="w-4 h-4 text-emerald-600" />}
            label="Para që hyri (arkëtuar)"
            hint="Fatura që klientët i paguan realisht këtë muaj"
            amount={thisMonth.collected}
            positive
          />
          <BreakdownRow
            icon={<ArrowDownRight className="w-4 h-4 text-red-600" />}
            label="− Rrogat"
            hint="Rrogat e ekipit aktiv (pjesa deri sot)"
            amount={-thisMonth.salary}
          />
          <BreakdownRow
            icon={<ArrowDownRight className="w-4 h-4 text-red-600" />}
            label="− Shpenzime të tjera"
            hint="Qira, softuer, marketing, etj."
            amount={-thisMonth.otherExpenses}
          />
          <div className="border-t pt-2.5">
            <BreakdownRow
              icon={profitPositive ? <TrendingUp className="w-4 h-4 text-emerald-600" /> : <TrendingDown className="w-4 h-4 text-red-600" />}
              label="= Fitimi neto"
              hint="Çfarë të mbeti"
              amount={thisMonth.profit}
              bold
              positive={profitPositive}
            />
          </div>
        </div>
      </Card>

      {/* 3 — Cash / receivables */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card className="p-5">
          <div className="flex items-center gap-2 mb-2">
            <Wallet className="w-4 h-4 text-sky-600" />
            <h2 className="text-sm font-semibold">Të pambledhura</h2>
          </div>
          <p className="text-2xl font-bold tabular-nums">{formatALL(receivables.outstanding)}</p>
          <p className="text-xs text-muted-foreground mt-1">
            Para që klientët të kanë borxh (fatura të papaguara ende).
          </p>
        </Card>
        <Card className={`p-5 ${receivables.overdueCount > 0 ? 'border-red-500/40' : ''}`}>
          <div className="flex items-center gap-2 mb-2">
            <Clock className={`w-4 h-4 ${receivables.overdueCount > 0 ? 'text-red-600' : 'text-muted-foreground'}`} />
            <h2 className="text-sm font-semibold">Të vonuara</h2>
          </div>
          <p className={`text-2xl font-bold tabular-nums ${receivables.overdueCount > 0 ? 'text-red-600' : ''}`}>
            {formatALL(receivables.overdueAmount)}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {receivables.overdueCount > 0
              ? `${receivables.overdueCount} fatura kaluan afatin — ndiqi për pagesë.`
              : 'Asnjë faturë e vonuar. 👍'}
          </p>
        </Card>
      </div>

      {/* 4 — Where you win / lose (per client, invoiced vs actual project cost) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-5">
          <div className="flex items-center gap-2 mb-0.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <h2 className="text-sm font-semibold">Ku fiton më shumë</h2>
          </div>
          <p className="text-[11px] text-muted-foreground mb-3">Bazë: fatura reale − kosto e projektit (punë + shpenzime). Ndryshe nga "Fitimi sipas projekti" (buxhet − overhead).</p>
          <ClientList rows={clientPnl.winners} emptyText="Ende pa të dhëna klientësh." />
        </Card>
        <Card className="p-5">
          <div className="flex items-center gap-2 mb-0.5">
            <AlertTriangle className="w-4 h-4 text-red-600" />
            <h2 className="text-sm font-semibold">Ku humb para</h2>
          </div>
          <p className="text-[11px] text-muted-foreground mb-3">Bazë: fatura reale − kosto e projektit (punë + shpenzime).</p>
          <ClientList rows={clientPnl.losers} emptyText="Asnjë klient në humbje. 👍" />
        </Card>
      </div>

      {/* 4b — Profit per project (full-absorption) */}
      <Card className="p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
          <div className="flex items-center gap-2">
            <Briefcase className="w-4 h-4 text-sky-600" />
            <h2 className="text-sm font-semibold">Fitimi sipas projekti</h2>
          </div>
          <div className="flex items-center gap-1 rounded-lg bg-muted/50 p-0.5">
            {([['month', 'Muaji'], ['year', 'Viti'], ['all', 'Gjithë']] as const).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setPnlPeriod(key)}
                className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                  pnlPeriod === key ? 'bg-background shadow-sm font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          Të ardhurat (buxheti) − kostot direkte (shpenzime të projektit) − pjesa e kostove fikse
          (rroga + qira + të tjera), e ndarë sipas peshës së të ardhurave.
        </p>

        <ProjectPnlBlock pnl={projectPnl} customerNameById={customerNameById} />
      </Card>

      {/* 4b2 — Department (service-line) P&L */}
      <Card className="p-5">
        <div className="flex items-center gap-2 mb-1">
          <Layers className="w-4 h-4 text-sky-600" />
          <h2 className="text-sm font-semibold">Fitimi sipas departamentit</h2>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          Sa fiton realisht nga çdo departament (Social, SEO, Web…) — të ardhura − kosto e njerëzve që punojnë aty − shpenzime − overhead. Sipas periudhës së zgjedhur lart. Kliko për projektet dhe stafin.
        </p>
        {departmentPnl.rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Ende pa projekte me departament. Cakto "Departamentin" te projektet për ta parë këtë ndarje.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {departmentPnl.rows.map(d => {
              const maxAbs = Math.max(...departmentPnl.rows.map(r => Math.abs(r.profit)), 1);
              const pct = Math.round((Math.abs(d.profit) / maxAbs) * 100);
              const open = expandedDept === d.department;
              return (
                <li key={d.department} className="rounded-lg border border-border/60">
                  <button
                    type="button"
                    onClick={() => setExpandedDept(open ? null : d.department)}
                    className="w-full text-left p-2.5 hover:bg-muted/30 rounded-lg transition-colors"
                    aria-expanded={open}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-sm text-foreground truncate flex-1 min-w-0 flex items-center gap-1.5 font-medium">
                        <span className={`text-muted-foreground transition-transform ${open ? 'rotate-90' : ''}`}>›</span>
                        {d.department}
                        <span className="text-xs text-muted-foreground font-normal">· {d.projects.length} {d.projects.length === 1 ? 'projekt' : 'projekte'}</span>
                      </span>
                      <span className={`text-sm font-semibold tabular-nums shrink-0 ${d.profit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {formatALL(d.profit)}
                        {d.margin != null && <span className="text-xs text-muted-foreground ml-1">({Math.round(d.margin * 100)}%)</span>}
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div className={`h-full rounded-full ${d.profit >= 0 ? 'bg-emerald-500/70' : 'bg-red-500/70'}`} style={{ width: `${Math.max(2, pct)}%` }} />
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                      <span>Të ardhura {formatALL(d.revenue)}</span>
                      <span>· Staf {formatALL(d.labor)}</span>
                      <span>· Shpenzime {formatALL(d.directCost)}</span>
                      <span>· Overhead {formatALL(d.overhead)}</span>
                    </div>
                  </button>
                  {open && (
                    <div className="px-3 pb-2.5 pt-0.5 space-y-2 border-t border-border/40">
                      {d.projects.map(p => (
                        <div key={p.id} className="pt-1.5">
                          <div className="flex items-center justify-between gap-2 text-xs">
                            <span className="text-foreground truncate flex-1 min-w-0">{p.name}</span>
                            <span className={`tabular-nums shrink-0 ${p.profit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{formatALL(p.profit)}</span>
                          </div>
                          <div className="text-[10px] text-muted-foreground">
                            Të ardhura {formatALL(p.revenue)} − staf {formatALL(p.labor)} − shpenzime {formatALL(p.directCost)} − overhead {formatALL(p.overhead)}
                          </div>
                          {p.participants.length > 0 && (
                            <div className="mt-0.5 flex flex-wrap gap-1">
                              {p.participants.map(pt => (
                                <span key={pt.userId} className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
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
          <p className="text-[11px] text-amber-600 mt-2">
            {formatALL(departmentPnl.unallocatedLabor.total)} rroga të stafit që s'punoi në asnjë projekt këtë periudhë (kosto e paalokuar te departamentet).
          </p>
        )}
      </Card>

      {/* 4c — Revenue per project responsible (own month filter + drill-down) */}
      <Card className="p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-sky-600" />
            <h2 className="text-sm font-semibold">Të ardhurat sipas përgjegjësit</h2>
          </div>
          <select
            value={staffMonth}
            onChange={(e) => { setStaffMonth(e.target.value); setExpandedStaff(null); }}
            className="h-8 px-2.5 text-xs rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {staffMonthOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          Të ardhurat që ka gjeneruar çdo përgjegjës. Kliko një person për të parë projektet e tij me vlerën e secilit.
        </p>
        {staffRevenue.rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Ende pa projekte me përgjegjës për këtë periudhë.</p>
        ) : (
          <ul className="space-y-1.5">
            {staffRevenue.rows.map(r => {
              const pct = staffRevenue.rows[0].revenue > 0 ? Math.round((r.revenue / staffRevenue.rows[0].revenue) * 100) : 0;
              const open = expandedStaff === r.userId;
              return (
                <li key={r.userId} className="rounded-lg border border-border/60">
                  <button
                    type="button"
                    onClick={() => setExpandedStaff(open ? null : r.userId)}
                    className="w-full text-left p-2.5 hover:bg-muted/30 rounded-lg transition-colors"
                    aria-expanded={open}
                  >
                    <div className="flex items-center justify-between gap-2 mb-0.5">
                      <span className="text-sm text-foreground truncate flex-1 min-w-0 flex items-center gap-1.5">
                        <span className={`text-muted-foreground transition-transform ${open ? 'rotate-90' : ''}`}>›</span>
                        {r.name} <span className="text-xs text-muted-foreground">· {r.projects.length} {r.projects.length === 1 ? 'projekt' : 'projekte'}</span>
                      </span>
                      <span className="text-sm font-semibold tabular-nums shrink-0">{formatALL(r.revenue)}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div className="h-full bg-sky-500/70 rounded-full" style={{ width: `${Math.max(2, pct)}%` }} />
                    </div>
                  </button>
                  {open && (
                    <ul className="px-3 pb-2.5 pt-0.5 space-y-1 border-t border-border/40">
                      {r.projects.map(p => (
                        <li key={p.id} className="flex items-center justify-between gap-2 text-xs pt-1.5">
                          <span className="text-muted-foreground truncate flex-1 min-w-0">{p.name}</span>
                          <span className="tabular-nums text-foreground shrink-0">{formatALL(p.revenue)}</span>
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
          <p className="text-[11px] text-amber-600 mt-2">
            {formatALL(staffRevenue.unattributed)} pa përgjegjës të caktuar — cakto një përgjegjës te projektet për t'i atribuar.
          </p>
        )}
      </Card>

      {/* 5 — Trend */}
      <Card className="p-5">
        <h2 className="text-sm font-semibold mb-3">Trendi i fitimit (6 muaj)</h2>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={trend} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 11 }} width={48} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
            <Tooltip formatter={(v: number) => formatALL(v)} />
            <Line type="monotone" dataKey="profit" stroke="#0EA5E9" strokeWidth={2.5} dot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
        <p className="text-xs text-muted-foreground mt-2">
          Vija tregon fitimin neto muaj pas muaji. Nëse bie vazhdimisht, diçka po të ha marzhin.
        </p>
      </Card>

      {/* Recurring-invoice health */}
      <Card className={`p-5 ${recurringHealth.stuck.length > 0 || recurringHealth.misconfigured.length > 0 ? 'border-red-500/40' : ''}`}>
        <div className="flex items-center gap-2 mb-1">
          <Repeat className="w-4 h-4 text-sky-600" />
          <h2 className="text-sm font-semibold">Fatura recurring që nuk u përsëritën</h2>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          Fatura që duhej të kopjoheshin automatikisht nga sistemi, por s'u gjeneruan (afati kaloi, pa kopje të re).
        </p>

        {recurringHealth.stuck.length === 0 && recurringHealth.misconfigured.length === 0 ? (
          <p className="text-sm text-emerald-600 flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4" />
            {recurringHealth.totalParents === 0
              ? 'Nuk ke fatura recurring.'
              : `Të gjitha ${recurringHealth.totalParents} faturat recurring janë në rregull.`}
          </p>
        ) : (
          <div className="space-y-4">
            {recurringHealth.stuck.length > 0 && (
              <ul className="space-y-2">
                {recurringHealth.stuck.map(s => (
                  <li key={s.id} className="flex items-center gap-2 text-sm">
                    <XCircle className="w-4 h-4 text-red-600 shrink-0" />
                    <span className="text-foreground truncate flex-1">
                      {s.name} <span className="text-muted-foreground">· {FREQ_LABEL[s.freq] || s.freq}</span>
                    </span>
                    <span className="text-xs text-red-600 font-medium shrink-0">
                      {s.daysOverdue} {s.daysOverdue === 1 ? 'ditë vonesë' : 'ditë vonesë'}
                    </span>
                    <span className="text-sm font-semibold tabular-nums shrink-0 ml-2">{formatALL(s.amount)}</span>
                  </li>
                ))}
              </ul>
            )}

            {recurringHealth.misconfigured.length > 0 && (
              <div>
                <p className="text-xs font-medium text-amber-600 mb-1.5">Konfigurim i paplotë (s'do gjenerohen kurrë):</p>
                <ul className="space-y-1.5">
                  {recurringHealth.misconfigured.map(m => (
                    <li key={m.id} className="flex items-center gap-2 text-sm">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                      <span className="text-foreground truncate flex-1">
                        {m.name} <span className="text-muted-foreground">· {m.reason}</span>
                      </span>
                      <span className="text-sm font-semibold tabular-nums shrink-0">{formatALL(m.amount)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <p className="text-[11px] text-muted-foreground">
              Rregullimi: hap faturën në <span className="font-medium">Faturat</span>, kontrollo frekuencën/datën e radhës,
              ose prit ciklin tjetër të cron-it. Faturat në pauzë ({recurringHealth.paused}) nuk numërohen si problem.
            </p>
          </div>
        )}
      </Card>

      {/* 5b — Cashflow health (recurring inflow vs fixed outflow) */}
      <Card className={`p-5 ${cashflow.gap < 0 ? 'border-red-500/40' : ''}`}>
        <div className="flex items-center gap-2 mb-1">
          <Wallet className={`w-4 h-4 ${cashflow.gap < 0 ? 'text-red-600' : 'text-emerald-600'}`} />
          <h2 className="text-sm font-semibold">Shëndeti i rrjedhës së parasë (mujore)</h2>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          A i mbulojnë të ardhurat e rregullta (kontratat mujore) kostot fikse çdo muaj?
        </p>
        <div className="grid grid-cols-3 gap-2 text-center mb-3">
          <PoolTile label="Të ardhura të rregullta" value={cashflow.monthlyInflow} tone="green" />
          <PoolTile
            label="Kosto fikse"
            value={cashflow.monthlyOutflow}
            tone="red"
            hint={`rroga ${formatALL(cashflow.salaries)} + periodike ${formatALL(cashflow.recurringExpenses)}`}
          />
          <PoolTile label={cashflow.gap >= 0 ? 'Tepricë mujore' : 'Mungesë mujore'} value={cashflow.gap} tone={cashflow.gap >= 0 ? 'green' : 'red'} bold />
        </div>
        {cashflow.alarms.length === 0 ? (
          <p className="text-sm text-emerald-600 flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4" /> Rrjedha e parasë duket e shëndetshme.
          </p>
        ) : (
          <ul className="space-y-2">
            {cashflow.alarms.map(a => (
              <li key={a.id} className="flex items-start gap-2 text-sm">
                <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${a.severity === 'red' ? 'bg-red-500' : 'bg-amber-500'}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-foreground font-medium">
                    {a.title}
                    {a.id === 'concentration' && a.customerId && (
                      <span className="text-muted-foreground font-normal"> — {customerNameById.get(a.customerId) || 'klient'}</span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">{a.detail}</p>
                </div>
                {a.amount != null && (
                  <span className={`text-sm font-semibold tabular-nums shrink-0 ${a.amount < 0 ? 'text-red-600' : 'text-foreground'}`}>
                    {formatALL(a.amount)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* 6 — Alarms */}
      {alarms.length > 0 && (
        <Card className="p-5">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            <h2 className="text-sm font-semibold">Çfarë kërkon vëmendje</h2>
          </div>
          <ul className="space-y-2">
            {alarms.map((a, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${a.tone === 'red' ? 'bg-red-500' : 'bg-amber-500'}`} />
                <span className="text-foreground">{a.text}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
};

// ── Sub-components ──

const BreakdownRow: React.FC<{
  icon: React.ReactNode;
  label: string;
  hint: string;
  amount: number;
  positive?: boolean;
  bold?: boolean;
}> = ({ icon, label, hint, amount, positive, bold }) => (
  <div className="flex items-center gap-3">
    <div className="shrink-0">{icon}</div>
    <div className="min-w-0 flex-1">
      <p className={`text-sm ${bold ? 'font-bold' : 'font-medium'} text-foreground`}>{label}</p>
      <p className="text-xs text-muted-foreground truncate">{hint}</p>
    </div>
    <p className={`tabular-nums shrink-0 ${bold ? 'text-base font-bold' : 'text-sm font-semibold'} ${
      positive === undefined
        ? amount < 0 ? 'text-red-600' : 'text-foreground'
        : positive ? 'text-emerald-600' : 'text-red-600'
    }`}>
      {formatALL(amount)}
    </p>
  </div>
);

const ClientList: React.FC<{
  rows: { id: string; name: string; revenue: number; margin: number; marginPct: number }[];
  emptyText: string;
}> = ({ rows, emptyText }) => {
  if (!rows.length) {
    return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  }
  return (
    <ul className="space-y-2.5">
      {rows.map(r => (
        <li key={r.id} className="flex items-center gap-2">
          <Users className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <span className="text-sm text-foreground truncate flex-1">{r.name}</span>
          <span className={`text-sm font-semibold tabular-nums shrink-0 ${r.margin < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
            {formatALL(r.margin)}
            {r.revenue > 0 && <span className="text-xs text-muted-foreground ml-1">({r.marginPct}%)</span>}
          </span>
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
    return <p className="text-sm text-muted-foreground">Ende pa projekte për këtë periudhë.</p>;
  }

  const { fixedPool, totals, allocationBasis } = pnl;

  return (
    <div className="space-y-3">
      {/* Fixed pool summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
        <PoolTile label="Të ardhura" value={totals.revenue} />
        <PoolTile label="Kosto direkte" value={totals.directCost} tone="red" />
        <PoolTile label="Kosto fikse" value={fixedPool.total} tone="red" hint={`rroga ${formatALL(fixedPool.salaries)} + fikse ${formatALL(fixedPool.otherFixed)}`} />
        <PoolTile label="Fitimi total" value={totals.profit} tone={totals.profit >= 0 ? 'green' : 'red'} bold />
      </div>

      {allocationBasis === 'equal' && (
        <p className="text-[11px] text-amber-600">
          ⚠ Asnjë projekt s'ka buxhet — kostot fikse u ndanë në mënyrë të barabartë. Vendos buxhetin te projektet për ndarje reale.
        </p>
      )}

      {/* Per-project table */}
      <div className="overflow-x-auto -mx-1">
        <table className="w-full text-sm min-w-[560px]">
          <thead>
            <tr className="text-xs text-muted-foreground border-b">
              <th className="text-left font-medium py-2 px-1">Projekti</th>
              <th className="text-right font-medium py-2 px-1">Të ardhura</th>
              <th className="text-right font-medium py-2 px-1">Direkte</th>
              <th className="text-right font-medium py-2 px-1">Fikse</th>
              <th className="text-right font-medium py-2 px-1">Fitimi</th>
              <th className="text-right font-medium py-2 px-1">Marzh</th>
            </tr>
          </thead>
          <tbody>
            {pnl.rows.map(r => (
              <tr key={r.id} className="border-b border-border/50 last:border-0">
                <td className="py-2 px-1 max-w-[180px]">
                  <p className="text-foreground truncate font-medium">{r.name}</p>
                  <p className="text-[11px] text-muted-foreground truncate">
                    {r.customerId ? (customerNameById.get(r.customerId) || 'Pa klient') : 'Pa klient'}
                    {r.billingType === 'monthly'
                      ? ` · mujore ×${r.activeMonths}`
                      : ' · njëherëshe'}
                  </p>
                </td>
                <td className="py-2 px-1 text-right tabular-nums">{formatALL(r.revenue)}</td>
                <td className="py-2 px-1 text-right tabular-nums text-muted-foreground">{formatALL(r.directCost)}</td>
                <td className="py-2 px-1 text-right tabular-nums text-muted-foreground">{formatALL(r.overhead)}</td>
                <td className={`py-2 px-1 text-right tabular-nums font-semibold ${r.profit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                  {formatALL(r.profit)}
                </td>
                <td className={`py-2 px-1 text-right tabular-nums ${r.margin == null ? 'text-muted-foreground' : r.margin >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                  {r.margin == null ? '—' : `${Math.round(r.margin * 100)}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted-foreground">
        "Fikse" = pjesa e rrogave dhe shpenzimeve të përgjithshme që i takon këtij projekti.
        Kostot variabile shtoji si Shpenzim i lidhur me projektin te faqja Shpenzimet.
      </p>
    </div>
  );
};

const PoolTile: React.FC<{
  label: string;
  value: number;
  tone?: 'green' | 'red' | 'default';
  bold?: boolean;
  hint?: string;
}> = ({ label, value, tone = 'default', bold, hint }) => (
  <div className="rounded-lg border bg-muted/20 p-2.5">
    <p className="text-[11px] text-muted-foreground">{label}</p>
    <p className={`tabular-nums ${bold ? 'text-base font-bold' : 'text-sm font-semibold'} ${
      tone === 'green' ? 'text-emerald-600' : tone === 'red' ? 'text-red-600' : 'text-foreground'
    }`}>
      {formatALL(value)}
    </p>
    {hint && <p className="text-[10px] text-muted-foreground mt-0.5 leading-tight">{hint}</p>}
  </div>
);

export default FinancesView;
