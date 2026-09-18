import React, { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePermissions } from '../contexts/PermissionsContext';
import { useCollection } from '../hooks/useFirestore';
import { Skeleton } from '../components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { cn, formatALL, formatCompact, toAll } from '../lib/utils';
import { saveOrShareFile } from '../lib/native';
import {
  AlertTriangle, ChevronDown, ChevronRight, Clock, Download, Info, Landmark,
  Percent, TrendingDown, TrendingUp, Wallet,
} from 'lucide-react';
import {
  ResponsiveContainer, ComposedChart, Area, Line, BarChart, Bar, XAxis, YAxis,
  Tooltip, CartesianGrid, ReferenceLine, LabelList,
} from 'recharts';
import type { Invoice, Expense, Customer, Project, TeamMember, Team, Subscription, Domain } from '../types';
import { hostingMonthlyRecurringRevenue, hostingRenewalsInWindow } from '../lib/hosting/finance';
import { useModules } from '../hooks/useModules';
import {
  getInvoiceCollectedBetween,
  getInvoiceCollectedAll,
  getInvoiceOutstandingAll,
  calculateExpensesBetween,
  calculateAccountsReceivable,
  parseDate,
  MONTH_LABELS_SQ,
} from '../lib/finance/financialAnalytics';
import { computeProjectPnl, type ProjectPnlOptions } from '../lib/finance/projectPnl';
import {
  payrollForMonth,
  payrollBasisLabel,
  type MonthPayroll,
} from '../lib/finance/payroll';
import { computeCashflowHealth } from '../lib/finance/cashflowAlarms';
import { forecastNextMonth } from '../lib/finance/forecast';
import { computeDepartmentPnl, buildDepartmentProfitTrend } from '../lib/finance/departmentPnl';
import { attributeCollectedRevenue, resolveCollectionWindow } from '../lib/finance/revenueAttribution';
import { useMemberCompensation } from '../hooks/useMemberCompensation';

// ── Financat — owner dashboard ────────────────────────────────────────────────
// Rebuilt against the hifi design reference "Financat FivoCRM.dc.html".
//
// LAYOUT CONTRACT — what keeps this page legible as panels get added:
//   · ONE hero: the navy net-profit card, carrying its own P&L derivation.
//     Nothing else on the page is allowed to compete with it visually.
//   · Four KPI cards beside it, never more. A fifth measure becomes a panel.
//   · Four tabs, one question each. Prose is folded into <Explain>; numbers
//     get the weight.
//   · ONE filter row per scope, rendered ABOVE the panels it scopes.
//   · Money is ALWAYS mono + tabular-nums, right-aligned in tables — so
//     columns of figures compare vertically without reading them.
//   · Status ink (green/red/amber) means profit-vs-loss ONLY. The blue ramp
//     carries series identity and never implies "good".
//
// Deviations from the reference, deliberate:
//   · Typography uses the app's own DM Sans / IBM Plex Mono rather than
//     Plus Jakarta Sans / JetBrains Mono — a second type system inside one app
//     shell reads as a bug, not as polish.
//   · Amounts keep `formatALL()` so this page agrees with Faturat/Shpenzimet.
//   · The header tile carries a wallet glyph, not the "F" mark: the sidebar
//     already brands the shell.

// ── Design tokens (page-local, from the reference) ──
const NAVY = '#08183A';
const NAVY_MID = '#0d2a63';
const BLUE = '#2f6fe0';        // primary series + action
const BLUE_LIGHT = '#7fb2f4';  // secondary series (WHMCS)
const GREEN = '#0f8a5f';
const RED = '#d64545';
const AXIS_INK = '#94a5bd';
const GRID_INK = '#edf1f7';

// Semantic ink, as Tailwind classes (arbitrary values keep them in one place).
const INK_POS = 'text-[#0f8a5f]';
const INK_NEG = 'text-[#d64545]';
const INK_WARN = 'text-[#9a6b0a]';
const INK_NAVY = 'text-[#08183A]';
const INK_MUTED = 'text-[#7286a3]';

/** White panel: the one card shape on this page. */
const CARD = 'rounded-[20px] border border-[#e3e9f2] bg-white shadow-[0_1px_3px_rgba(8,24,58,.05)]';
/** Every money figure on the page. */
const NUM = 'font-mono tabular-nums';
/** Shared column ruler — header, data rows and the totals row must agree. */
const COLS = 'grid grid-cols-[1.6fr_112px_112px_112px_74px] gap-x-2';

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

/** Short money for chart ticks/labels, where the full "1.234.567 L" never fits.
 *  Delegates to the shared helper so the Lek unit can never go missing again. */
const compactALL = (v: number) => formatCompact(v, 'ALL');

function monthWindow(base: Date, offset: number) {
  const d = new Date(base.getFullYear(), base.getMonth() + offset, 1);
  const start = new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
  return { start, end, monthIndex: d.getMonth(), year: d.getFullYear() };
}

/**
 * One financial snapshot for a month: money in − money out.
 *
 * `payroll` comes from `payrollForMonth` — the salaries ACTUALLY recorded for
 * the month when there are any, otherwise the figure on the member profiles.
 * `otherExpenses` excludes Salary-category rows (they are the recorded payroll),
 * so the two lines partition every expense row exactly once and the total
 * agrees with the Shpenzimet page.
 */
function monthProfit(
  invoices: Invoice[],
  expenses: Expense[],
  payroll: MonthPayroll,
  start: Date,
  end: Date,
) {
  const collected = invoices.reduce((s, inv) => s + getInvoiceCollectedBetween(inv, start, end), 0);
  const otherExpenses = calculateExpensesBetween(expenses, start, end);
  const profit = collected - otherExpenses - payroll.total;
  return {
    collected,
    otherExpenses,
    salary: payroll.total,
    salaryBasis: payroll.basis,
    salaryPlan: payroll.profile,
    profit,
  };
}

/** Prorate a payroll figure to the elapsed part of a month — but only when it
 *  is the PLAN. A recorded payment is what left the bank; scaling it by "days
 *  elapsed" would invent a number that was never paid. */
function proratedPayroll(p: MonthPayroll, fraction: number): MonthPayroll {
  if (p.basis !== 'profile' || fraction >= 1) return p;
  return { ...p, total: p.total * fraction };
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '??';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

/** `'month' | 'year' | 'all' | 'YYYY-M'` — one period for every P&L breakdown. */
type Period = string;
const isPickedMonth = (p: Period) => /^\d{4}-\d{1,2}$/.test(p);

/**
 * Which month the hero reads.
 *
 * Before the 15th the current month is a handful of days of collections against
 * a whole month's payroll — a headline built on that is noise, so the CLOSED
 * month leads by default. From the 15th on, month-to-date leads. Either way the
 * owner can override, and the toggle says which one is showing.
 */
type MonthMode = 'auto' | 'prev' | 'cur';

const FinancesView: React.FC = () => {
  const navigate = useNavigate();
  const permissions = usePermissions();
  const allowed = permissions.isOwner || permissions.isAdmin || permissions.isSuperAdmin;

  const { data: invoices, loading: lInv } = useCollection<Invoice>('invoices', { skipTeamFilter: true });
  const { data: expenses, loading: lExp } = useCollection<Expense>('expenses', { skipTeamFilter: true });
  const { data: customers } = useCollection<Customer>('customers', { skipTeamFilter: true });
  const { data: projects } = useCollection<Project>('projects', { skipTeamFilter: true });
  const { data: rawTeamMembers } = useCollection<TeamMember>('teamMembers', { skipTeamFilter: true });
  // Pay lives in `teamMemberComp` now (a colleague's salary is not the whole
  // business's to read). Dual read: the comp document wins where it exists, the
  // legacy `teamMembers` fields are the fallback until the backfill has run —
  // every payroll engine below still takes plain TeamMember objects.
  const { members: teamMembers } = useMemberCompensation(rawTeamMembers);
  // Hosting module: subscriptions we bill are a recurring-revenue source too.
  const { isEnabled: moduleEnabled } = useModules();
  const hostingOn = moduleEnabled('hosting');
  const { data: hostingSubs } = useCollection<Subscription>('subscriptions', { skipTeamFilter: true, skip: !hostingOn });
  const { data: hostingDomains } = useCollection<Domain>('domains', { skipTeamFilter: true, skip: !hostingOn });
  // Needed to join `expense.departmentId` (a teams doc id) to the free-text
  // `project.department` the P&L groups by — without it a cost tagged to one
  // department is spread by revenue weight across all of them.
  const { data: teams } = useCollection<Team>('teams');

  const now = useMemo(() => new Date(), []);
  const [tab, setTab] = useState('overview');
  const [monthMode, setMonthMode] = useState<MonthMode>('auto');
  const usePrev = monthMode === 'auto' ? now.getDate() < 15 : monthMode === 'prev';

  // ── Month snapshots ──
  // Payroll per month comes from `payrollForMonth`: the salaries actually
  // recorded as expenses for that month, or the member profiles when the month
  // has none. Only the PROFILE figure is prorated to elapsed days (otherwise a
  // whole month's plan against a few days of collections shows a false loss
  // early each month) — a recorded payment is charged as paid. `prevToDate`
  // resolves the same way, giving the month-to-date hero a like-for-like base.
  const snapshots = useMemo(() => {
    const inv = invoices || [];
    const exp = expenses || [];
    const cur = monthWindow(now, 0);
    const prev = monthWindow(now, -1);
    const prev2 = monthWindow(now, -2);

    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const elapsedDay = now.getDate();
    const elapsedFraction = Math.min(1, elapsedDay / daysInMonth);
    // The recorded window is the WHOLE month, matching `otherExpenses` in
    // monthProfit: a salary row dated the 30th is as real as a rent row dated
    // the 30th, and counting one but not the other split the same month across
    // two bases.
    const curPay = proratedPayroll(
      payrollForMonth(teamMembers, exp, cur.start, cur.end),
      elapsedFraction,
    );

    const prevDays = new Date(now.getFullYear(), now.getMonth(), 0).getDate();
    const prevDay = Math.min(elapsedDay, prevDays);
    const prevToDateEnd = new Date(prev.start.getFullYear(), prev.start.getMonth(), prevDay, 23, 59, 59, 999);
    const prevPayToDate = proratedPayroll(
      payrollForMonth(teamMembers, exp, prev.start, prevToDateEnd, prev.end),
      Math.min(1, prevDay / prevDays),
    );

    return {
      cur, prev, prev2,
      current: monthProfit(inv, exp, curPay, cur.start, cur.end),
      prevFull: monthProfit(inv, exp, payrollForMonth(teamMembers, exp, prev.start, prev.end), prev.start, prev.end),
      prevToDate: monthProfit(inv, exp, prevPayToDate, prev.start, prevToDateEnd),
      prev2Full: monthProfit(inv, exp, payrollForMonth(teamMembers, exp, prev2.start, prev2.end), prev2.start, prev2.end),
    };
  }, [invoices, expenses, teamMembers, now]);

  const hero = useMemo(() => {
    const { cur, prev, prev2, current, prevFull, prevToDate, prev2Full } = snapshots;
    const data = usePrev ? prevFull : current;
    const base = usePrev ? prev2Full : prevToDate;
    const w = usePrev ? prev : cur;
    return {
      ...data,
      delta: data.profit - base.profit,
      title: `${MONTH_NAMES_FULL[w.monthIndex]} ${w.year}`,
      deltaVs: usePrev ? MONTH_NAMES_FULL[prev2.monthIndex] : 'e njëjta datë muajin e kaluar',
      marginPct: data.collected > 0 ? Math.round((data.profit / data.collected) * 100) : 0,
      closed: usePrev,
    };
  }, [snapshots, usePrev]);

  // Unpaid (outstanding) balance from WHMCS — a stock, not a flow: the current
  // sum still owed on WHMCS invoices, regardless of period.
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

  // ── Collections per month, split WHMCS vs direct (last 6 months) ──
  const incomeSourceByMonth = useMemo(() => {
    const inv = invoices || [];
    const out: { label: string; whmcs: number; direct: number; total: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const w = monthWindow(now, -i);
      let whmcs = 0, direct = 0;
      for (const x of inv) {
        const c = getInvoiceCollectedBetween(x, w.start, w.end);
        if (c <= 0) continue;
        if ((x as any).source === 'whmcs') whmcs += c; else direct += c;
      }
      out.push({ label: MONTH_LABELS_SQ[w.monthIndex], whmcs, direct, total: whmcs + direct });
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
      // The current month (i===0) is month-to-date → prorate its payroll just
      // like the hero (and only when it is the plan), so the last trend point
      // equals the headline number.
      const pay = proratedPayroll(
        payrollForMonth(teamMembers, exp, w.start, w.end),
        i === 0 ? elapsedFraction : 1,
      );
      const p = monthProfit(inv, exp, pay, w.start, w.end);
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

  // ── Per-client P&L (cash received − project cost) ──
  const clientPnl = useMemo(() => {
    const inv = invoices || [];
    const projs = projects || [];
    const rows = (customers || []).map(c => {
      // Profit counts only money actually RECEIVED — an issued-but-unpaid invoice
      // (Pending/Overdue) is a receivable, not profit. Partials count their paid part.
      const revenue = inv
        .filter(i => i.customerId === c.id)
        .reduce((s, i) => s + getInvoiceCollectedAll(i), 0);
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
  // Rendered as one control row above the panels it scopes, never buried inside
  // a card that silently governs the cards below it.
  const [period, setPeriod] = useState<Period>('year');
  // Default to the money actually COLLECTED ("Paguar"): profit should reflect cash
  // that arrived, not a plan. "Buxhet" stays available as the planning view.
  const [revenueBasis, setRevenueBasis] = useState<'budget' | 'invoiced'>('invoiced');

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

  // ── Collected cash, attributed to a department and a person ──
  // The accrual columns (budget/invoiced) say what was EARNED; this says what
  // actually arrived, over the same window. See lib/finance/revenueAttribution.ts.
  const collected = useMemo(
    () => attributeCollectedRevenue(invoices, projects, resolveCollectionWindow(periodOpts)),
    [invoices, projects, periodOpts],
  );

  // ── Department (service-line) P&L — real profit per Social/SEO/Web… ──
  const [expandedDept, setExpandedDept] = useState<string | null>(null);
  const [showPnlHelp, setShowPnlHelp] = useState(false);
  const departmentPnl = useMemo(
    () => computeDepartmentPnl(projects, teamMembers, expenses, { ...periodOpts, revenueBasis, invoices, teams }),
    [projects, teamMembers, expenses, invoices, periodOpts, revenueBasis, teams],
  );

  /**
   * Department rows carrying BOTH bases side by side.
   *
   * A department can appear in one basis and not the other: cash may land in
   * this window for work recognised earlier (so it has `collected` but no
   * accrual row). Those are merged in rather than dropped, otherwise the column
   * would not add up to the money actually collected.
   */
  const departmentRows = useMemo(() => {
    type Row = (typeof departmentPnl.rows)[number] & { collected: number };
    const byKey = new Map<string, Row>();
    for (const d of departmentPnl.rows) {
      byKey.set(d.department, { ...d, collected: collected.byDepartment.get(d.department) || 0 });
    }
    for (const [dept, amount] of collected.byDepartment) {
      if (byKey.has(dept)) continue;
      byKey.set(dept, {
        department: dept, revenue: 0, directCost: 0, labor: 0, overhead: 0,
        cost: 0, profit: 0, margin: null, projects: [], departmentFixed: 0,
        collected: amount,
      } as Row);
    }
    // Sorted by revenue now that the panel leads with revenue, not profit.
    const rows = [...byKey.values()].sort((a, b) => (b.revenue || b.collected) - (a.revenue || a.collected));
    const totals = rows.reduce(
      (t, r) => ({
        revenue: t.revenue + r.revenue,
        collected: t.collected + r.collected,
        cost: t.cost + r.cost,
        profit: t.profit + r.profit,
      }),
      { revenue: 0, collected: 0, cost: 0, profit: 0 },
    );
    const max = Math.max(...rows.map(r => Math.max(r.revenue, r.collected)), 1);
    return { rows, totals, max };
  }, [departmentPnl, collected]);

  // Monthly profit trend per department (last 6 months) — is Social growing or not?
  const departmentTrend = useMemo(
    () => buildDepartmentProfitTrend(projects, teamMembers, expenses, now, 6, { revenueBasis, invoices, teams }),
    [projects, teamMembers, expenses, invoices, revenueBasis, now, teams],
  );

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

  // ── Revenue, cash and profit generated per project responsible ──
  // Symmetric with the department panel: the same measures on the same period
  // and basis, so "who brought in what" reads the same either way you slice it.
  const [expandedStaff, setExpandedStaff] = useState<string | null>(null);
  const staffRevenue = useMemo(() => {
    type StaffRow = {
      userId: string; name: string; revenue: number; collected: number; cost: number; profit: number;
      projects: PnlLine[];
    };
    const pnl = computeProjectPnl(projects, teamMembers, expenses, { ...periodOpts, revenueBasis, invoices });
    const map = new Map<string, StaffRow>();
    let unattributed = 0;
    for (const r of pnl.rows) {
      const uid = r.responsibleUserId;
      if (!uid) { unattributed += r.revenue; continue; }
      const row = map.get(uid) || {
        userId: uid, name: memberNameById.get(uid) || 'I panjohur',
        revenue: 0, collected: 0, cost: 0, profit: 0, projects: [],
      };
      row.revenue += r.revenue;
      row.cost += r.cost;
      row.profit += r.profit;
      // The cost split travels with the line so the expanded row can show WHY a
      // project profited or lost, instead of only that it did.
      row.projects.push({
        id: r.id, name: r.name, revenue: r.revenue, cost: r.cost, profit: r.profit,
        directCost: r.directCost, overhead: r.overhead,
      });
      map.set(uid, row);
    }
    // Attach cash, and merge in anyone who only has cash in this window (their
    // accrual sits outside it) — same reasoning as the department rows.
    for (const [uid, amount] of collected.byUser) {
      const row = map.get(uid);
      if (row) { row.collected = amount; continue; }
      map.set(uid, {
        userId: uid, name: memberNameById.get(uid) || 'I panjohur',
        revenue: 0, collected: amount, cost: 0, profit: 0, projects: [],
      });
    }
    const rows = Array.from(map.values())
      .map(r => ({ ...r, projects: r.projects.sort((a, b) => b.revenue - a.revenue) }))
      .sort((a, b) => (b.revenue || b.collected) - (a.revenue || a.collected));
    const totals = rows.reduce(
      (t, r) => ({
        revenue: t.revenue + r.revenue,
        collected: t.collected + r.collected,
        cost: t.cost + r.cost,
        profit: t.profit + r.profit,
      }),
      { revenue: 0, collected: 0, cost: 0, profit: 0 },
    );
    return { rows, totals, unattributed };
  }, [projects, teamMembers, expenses, invoices, periodOpts, revenueBasis, memberNameById, collected]);

  // ── Forward-looking cashflow health (recurring inflow vs fixed outflow) ──
  const cashflow = useMemo(
    () => computeCashflowHealth(invoices, expenses, teamMembers, projects, now, hostingSubs),
    [invoices, expenses, teamMembers, projects, now, hostingSubs],
  );

  // ── Next-month profit forecast (project pipeline + recurring invoices) ──
  const forecast = useMemo(
    () => forecastNextMonth(projects, invoices, expenses, teamMembers, now, hostingSubs),
    [projects, invoices, expenses, teamMembers, now, hostingSubs],
  );
  const hostingFinance = useMemo(() => {
    if (!hostingOn) return null;
    const mrr = hostingMonthlyRecurringRevenue(hostingSubs);
    const start = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 2, 0, 23, 59, 59);
    const next = hostingRenewalsInWindow(hostingSubs, hostingDomains, start, end);
    const active = (hostingSubs || []).filter(s => s.source === 'fivocrm' && s.status === 'Active').length;
    return { mrr, nextMonth: next.totalAll, nextCount: next.rows.length, active };
  }, [hostingOn, hostingSubs, hostingDomains, now]);

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

  // ── Plain-language alarms, each tagged by kind ──
  const alarms = useMemo(() => {
    const items: { tag: string; text: string; tone: 'red' | 'amber' }[] = [];
    if (receivables.overdueCount > 0) {
      items.push({
        tag: 'Vonesë',
        tone: 'red',
        text: `${receivables.overdueCount} ${receivables.overdueCount === 1 ? 'faturë e vonuar' : 'fatura të vonuara'} = ${formatALL(receivables.overdueAmount)} pa mbledhur.`,
      });
    }
    if (hero.profit < 0) {
      items.push({
        tag: 'Humbje',
        tone: 'red',
        text: `${hero.title}: po humb para, ${formatALL(Math.abs(hero.profit))}.`,
      });
    }
    if (hero.profit >= 0 && hero.collected > 0 && hero.marginPct < 20) {
      items.push({
        tag: 'Marzh',
        tone: 'amber',
        text: `Marzhi i ${hero.title} është vetëm ${hero.marginPct}% — nën 20%.`,
      });
    }
    if (recurringHealth.stuck.length > 0) {
      items.push({
        tag: 'Recurring',
        tone: 'red',
        text: `${recurringHealth.stuck.length} ${recurringHealth.stuck.length === 1 ? 'faturë recurring nuk u gjenerua' : 'fatura recurring nuk u gjeneruan'} — automatizimi ngeci.`,
      });
    }
    if (recurringHealth.misconfigured.length > 0) {
      items.push({
        tag: 'Config',
        tone: 'amber',
        text: `${recurringHealth.misconfigured.length} faturë recurring e konfiguruar keq — s'do gjenerohet kurrë.`,
      });
    }
    for (const l of clientPnl.losers) {
      items.push({
        tag: 'Marzh',
        tone: 'amber',
        text: `Klienti "${l.name}" po humb para: ${formatALL(l.margin)} marzh.`,
      });
    }
    return items;
  }, [receivables, hero, clientPnl, recurringHealth]);

  // Badge on the "Rreziqet" tab — that tab holds everything broken.
  const riskCount = alarms.length + cashflow.alarms.length;

  // One-line summary above the alarm list, so the card is readable folded.
  const alarmSummary = useMemo(() => {
    const bits: string[] = [];
    if (receivables.overdueCount > 0) {
      bits.push(`${receivables.overdueCount} fatura të vonuara (${formatALL(receivables.overdueAmount)})`);
    }
    if (recurringHealth.stuck.length > 0) bits.push(`${recurringHealth.stuck.length} recurring ngeci`);
    if (clientPnl.losers.length > 0) bits.push(`${clientPnl.losers.length} klientë në humbje`);
    if (cashflow.gap < 0) bits.push(`mungesë mujore ${formatALL(Math.abs(cashflow.gap))}`);
    return bits.join(' · ');
  }, [receivables, recurringHealth, clientPnl, cashflow]);

  // ── CSV export of exactly what is on screen ──
  const exportCsv = useCallback(() => {
    const rows: (string | number)[][] = [
      ['Financat', hero.title, hero.closed ? 'muaj i mbyllur' : 'deri sot'],
      [],
      ['Para që hyri (arkëtuar)', Math.round(hero.collected)],
      ['Rrogat', -Math.round(hero.salary), payrollBasisLabel(hero.salaryBasis)],
      ['Shpenzime të tjera', -Math.round(hero.otherExpenses)],
      ['Gjithsej dalje', -Math.round(hero.salary + hero.otherExpenses)],
      ['Fitimi neto', Math.round(hero.profit)],
      ['Marzhi %', hero.marginPct],
      ['Të pambledhura', Math.round(receivables.outstanding)],
      ['Të vonuara', Math.round(receivables.overdueAmount), `${receivables.overdueCount} fatura`],
      [],
      [`Departamenti (${periodLabel})`, 'Të ardhura', 'Kosto', 'Fitimi', 'Marzhi %', 'Arkëtuar'],
      ...departmentRows.rows.map(d => [
        d.department, Math.round(d.revenue), Math.round(d.cost), Math.round(d.profit),
        d.margin == null ? '' : Math.round(d.margin * 100), Math.round(d.collected),
      ]),
      ['Gjithsej', Math.round(departmentRows.totals.revenue), Math.round(departmentRows.totals.cost), Math.round(departmentRows.totals.profit), '', Math.round(departmentRows.totals.collected)],
      [],
      ['Përgjegjësi', 'Të ardhura', 'Kosto', 'Fitimi', 'Arkëtuar'],
      ...staffRevenue.rows.map(r => [r.name, Math.round(r.revenue), Math.round(r.cost), Math.round(r.profit), Math.round(r.collected)]),
      [],
      ['Klienti', 'Të ardhura', 'Kosto', 'Marzhi'],
      ...[...clientPnl.winners, ...clientPnl.losers].map(c => [
        c.name, Math.round(c.revenue), Math.round(c.cost), Math.round(c.margin),
      ]),
    ];
    const csv = rows
      .map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\r\n');
    // BOM so Excel opens Albanian diacritics correctly.
    // saveOrShareFile, not a blob <a download>: on native the anchor download is a
    // no-op, so this button did nothing at all in the Android app - no file, no error.
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    void saveOrShareFile(blob, `financat-${hero.title.toLowerCase().replace(/\s+/g, '-')}.csv`, {
      shareTitle: 'Financat - FivoCRM',
    });
  }, [hero, receivables, departmentRows, staffRevenue, clientPnl, periodLabel]);

  if (!allowed) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        Kjo faqe është vetëm për pronarin.
      </div>
    );
  }

  if (lInv || lExp) return <FinancesSkeleton />;

  const deltaPositive = hero.delta >= 0;
  const prevMonthName = MONTH_NAMES_FULL[snapshots.prev.monthIndex];
  const curMonthName = MONTH_NAMES_FULL[snapshots.cur.monthIndex];

  return (
    /* The app shell already owns the ground colour and the page padding
       (`p-3 sm:p-6 lg:p-8` in App.tsx) — repeating either here would paint an
       inset panel of a near-identical grey with a visible seam. */
    <div className="pb-6">
      <div className="mx-auto max-w-[1140px]">

        {/* ── Header ── */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div
              className="flex h-10 w-10 items-center justify-center rounded-xl text-white shadow-[0_4px_12px_rgba(8,24,58,.25)]"
              style={{ background: `linear-gradient(135deg, #0c2456, ${NAVY})` }}
            >
              <Landmark className="h-[18px] w-[18px]" />
            </div>
            <h1 className={cn('text-[18px] font-extrabold tracking-[-0.01em]', INK_NAVY)}>Financat</h1>
          </div>

          <div className="flex items-center gap-2.5">
            {/* Which month the hero reads. Auto picks the closed month before the 15th. */}
            <Segmented
              value={usePrev ? 'prev' : 'cur'}
              onChange={setMonthMode}
              options={[
                ['prev', `${prevMonthName} (i mbyllur)`],
                ['cur', `${curMonthName} · deri sot`],
              ] as const}
            />
            <button
              type="button"
              onClick={exportCsv}
              className="inline-flex items-center gap-2 rounded-xl bg-[#2f6fe0] px-4 py-2.5 text-[13px] font-bold text-white shadow-[0_4px_12px_rgba(47,111,224,.3)] transition-all hover:-translate-y-px hover:bg-[#2258bb] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2f6fe0] focus-visible:ring-offset-2"
            >
              <Download className="h-4 w-4" />
              Eksporto
            </button>
          </div>
        </div>

        {/* ── Hero + KPI band ── */}
        {/* Tablet gets hero-full-width + a 2×2 KPI block; desktop puts the KPIs
            in two columns beside the hero, which then spans both rows. */}
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-[1.15fr_1fr_1fr]">

          {/* The one hero figure, carrying its own derivation. */}
          <div
            className="flex flex-col rounded-[20px] p-6 text-white shadow-[0_12px_32px_rgba(8,24,58,.28)] sm:col-span-2 sm:p-7 lg:col-span-1 lg:row-span-2"
            style={{ background: `linear-gradient(150deg, ${NAVY_MID} 0%, ${NAVY} 65%)` }}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-bold uppercase tracking-[.12em] text-[#93a9d1]">
                Fitimi neto
              </span>
              <span className="shrink-0 rounded-full bg-white/[.08] px-3 py-1 text-[11.5px] font-bold text-[#93a9d1]">
                {hero.title}
              </span>
            </div>

            {/* Proportional figures on purpose: tabular-nums makes a number this
                large read loose, since every digit gets the width of a "0". */}
            <p className="mt-4 break-words text-[38px] font-extrabold leading-none tracking-[-0.02em] sm:text-[44px]">
              {formatALL(hero.profit)}
            </p>

            <div
              className={cn(
                'mt-3.5 inline-flex max-w-full items-center gap-1.5 self-start rounded-full px-3 py-1.5 text-[12.5px] font-bold',
                deltaPositive ? 'bg-[#3ac48c]/[.16] text-[#5fd8a8]' : 'bg-[#e67070]/[.16] text-[#ef9f9f]',
              )}
            >
              {deltaPositive
                ? <TrendingUp className="h-3.5 w-3.5 shrink-0" />
                : <TrendingDown className="h-3.5 w-3.5 shrink-0" />}
              <span className="whitespace-nowrap">
                {deltaPositive ? '+' : '−'}{formatALL(Math.abs(hero.delta))}
              </span>
              <span className="min-w-0 truncate font-semibold opacity-70">vs {hero.deltaVs}</span>
            </div>

            <div className="mt-auto flex flex-col gap-2.5 pt-6">
              <HeroRow label="Para që hyri (arkëtuar)" amount={hero.collected} tone="pos" />
              <HeroRow
                label="− Rrogat"
                amount={-hero.salary}
                tone="neg"
                rule
                note={hero.salaryBasis === 'profile' && hero.salaryPlan > 0
                  ? 'nga lista e pagave — pa pagesa të regjistruara për këtë muaj'
                  : payrollBasisLabel(hero.salaryBasis)}
              />
              <HeroRow label="− Shpenzime të tjera" amount={-hero.otherExpenses} tone="neg" rule />
              <HeroRow label="= Fitimi neto" amount={hero.profit} tone="total" rule strong />

              {/* The reconciliation line. "Rrogat + Shpenzime të tjera" is
                  exactly what the Shpenzimet page totals for the same month —
                  unless this month's payroll is the PLAN, which is the one case
                  where the two pages legitimately differ. Saying which case it
                  is here is the whole point: the gap used to be silent. */}
              <p className="pt-1 text-[10.5px] font-medium leading-snug text-[#8fa3c4]">
                Gjithsej dalje {formatALL(hero.salary + hero.otherExpenses)}
                {hero.salaryBasis === 'profile' && hero.salaryPlan > 0
                  ? ` · faqja Shpenzimet tregon ${formatALL(hero.otherExpenses)} për këtë muaj, sepse pagat nuk janë regjistruar ende si shpenzim.`
                  : ' · e njëjta shifër që tregon faqja Shpenzimet për këtë muaj.'}
              </p>
            </div>
          </div>

          <KpiCard
            icon={<TrendingUp className="h-4 w-4" />}
            iconBg="#e3ecfb"
            iconInk="#2258bb"
            label={`Parashikim · ${MONTH_NAMES_FULL[forecast.monthIndex]}`}
            value={formatALL(forecast.predictedProfit)}
            sub="faturat mujore + projektet"
          />
          <KpiCard
            icon={<Percent className="h-4 w-4" />}
            iconBg="#e7f6ef"
            iconInk={GREEN}
            label="Marzhi i fitimit"
            value={`${hero.marginPct}%`}
            sub="mbi paranë e arkëtuar"
          />
          {hostingFinance && (
            <KpiCard
              icon={<TrendingUp className="h-4 w-4" />}
              iconBg="#e0f2fe"
              iconInk="#0369a1"
              label="Hosting & Domain-e · MRR"
              value={formatALL(hostingFinance.mrr)}
              sub={`${hostingFinance.active} llogari aktive · rinovime muajin tjetër ${formatALL(hostingFinance.nextMonth)} (${hostingFinance.nextCount})`}
            />
          )}
          <KpiCard
            icon={<Wallet className="h-4 w-4" />}
            iconBg="#fdf6e8"
            iconInk="#9a6b0a"
            label="Të pambledhura"
            value={formatALL(receivables.outstanding)}
            sub="para që klientët të kanë borxh"
          />
          <KpiCard
            icon={<Clock className="h-4 w-4" />}
            iconBg="#fdece9"
            iconInk={RED}
            label="Të vonuara"
            value={formatALL(receivables.overdueAmount)}
            sub={receivables.overdueCount > 0
              ? `${receivables.overdueCount} fatura kaluan afatin — ndiqi`
              : 'asnjë faturë e vonuar'}
            danger={receivables.overdueCount > 0}
          />
        </div>

        {/* ── Four questions, four tabs ── */}
        <Tabs value={tab} onValueChange={setTab} className="mt-6">
          <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto rounded-[14px] bg-[#e6ebf3] p-1 sm:w-fit">
            <PillTab value="overview">Përmbledhje</PillTab>
            <PillTab value="profit">Fitimi</PillTab>
            <PillTab value="clients">Klientët</PillTab>
            <PillTab value="risk" badge={riskCount}>Rreziqet</PillTab>
          </TabsList>

          {/* ── TAB 1 · Overview — the history, its projection, and the cash mix ── */}
          <TabsContent value="overview" className="mt-4 space-y-4">
            <section className={cn(CARD, 'px-5 py-6 sm:px-7')}>
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <div>
                  <h2 className={cn('text-base font-extrabold', INK_NAVY)}>Trendi i fitimit</h2>
                  <p className={cn('mt-0.5 text-[12.5px]', INK_MUTED)}>
                    6 muajt e fundit + parashikimi i muajit në vazhdim.
                  </p>
                </div>
                {/* Two series → a legend is mandatory; identity never rests on color alone. */}
                <ChartLegend items={[
                  { label: 'Realizuar', color: BLUE },
                  { label: 'Parashikim', color: NAVY, dashed: true },
                ]} />
              </div>

              <ResponsiveContainer width="100%" height={244}>
                <ComposedChart data={trendWithForecast} margin={{ top: 24, right: 16, left: 0, bottom: 4 }}>
                  <defs>
                    <linearGradient id="finArea" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={BLUE} stopOpacity={0.16} />
                      <stop offset="100%" stopColor={BLUE} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke={GRID_INK} vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: AXIS_INK, fontWeight: 700 }}
                    axisLine={{ stroke: '#d7dfeb' }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: AXIS_INK }}
                    width={58}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={compactALL}
                  />
                  {/* A profit chart crosses zero — say where zero is. */}
                  <ReferenceLine y={0} stroke="#d7dfeb" strokeWidth={1.5} />
                  <Tooltip content={<ChartTip />} />
                  <Area
                    name="Realizuar" type="monotone" dataKey="profit"
                    stroke={BLUE} strokeWidth={2.5} fill="url(#finArea)"
                    dot={{ r: 4.5, fill: BLUE, stroke: '#FFFFFF', strokeWidth: 2 }}
                    activeDot={{ r: 6, stroke: '#FFFFFF', strokeWidth: 2 }}
                    connectNulls={false}
                  >
                    <LabelList
                      dataKey="profit" position="top" offset={12}
                      className={NUM}
                      fill={BLUE} fontSize={10.5} fontWeight={800}
                      formatter={(v: number) => (v == null ? '' : compactALL(v))}
                    />
                  </Area>
                  <Line
                    name="Parashikim" type="monotone" dataKey="forecast"
                    stroke={NAVY} strokeWidth={2.5} strokeDasharray="6 5" strokeLinecap="round"
                    dot={{ r: 4.5, fill: NAVY, stroke: '#FFFFFF', strokeWidth: 2 }}
                    activeDot={{ r: 6, stroke: '#FFFFFF', strokeWidth: 2 }}
                    connectNulls={false}
                  >
                    <LabelList
                      dataKey="forecast" position="top" offset={12}
                      className={NUM}
                      fill={NAVY} fontSize={10.5} fontWeight={800}
                      formatter={(v: number) => (v == null ? '' : compactALL(v))}
                    />
                  </Line>
                </ComposedChart>
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
            </section>

            <section className={cn(CARD, 'px-5 py-6 sm:px-6')}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className={cn('text-[15px] font-extrabold', INK_NAVY)}>Arkëtimet sipas muajit</h2>
                <ChartLegend items={[
                  { label: 'Direkt', color: BLUE, square: true },
                  { label: 'WHMCS', color: BLUE_LIGHT, square: true },
                ]} />
              </div>

              {/* Stacked, not grouped: the question here is "how much came in",
                  with the source mix as a second read inside the same column. */}
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={incomeSourceByMonth} margin={{ top: 26, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke={GRID_INK} vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11.5, fill: '#7286a3', fontWeight: 700 }}
                    axisLine={{ stroke: '#e3e9f2' }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: AXIS_INK }}
                    width={58}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={compactALL}
                  />
                  <Tooltip content={<ChartTip />} cursor={{ fill: 'rgba(47,111,224,0.05)' }} />
                  <Bar name="Direkt" dataKey="direct" stackId="a" fill={BLUE} maxBarSize={46} />
                  <Bar name="WHMCS" dataKey="whmcs" stackId="a" fill={BLUE_LIGHT} radius={[6, 6, 0, 0]} maxBarSize={46}>
                    <LabelList
                      dataKey="total" position="top" offset={10}
                      className={NUM}
                      fill="#5a6d8a" fontSize={11} fontWeight={800}
                      formatter={(v: number) => compactALL(v)}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>

              {whmcsUnpaid.count > 0 && (
                <p className={cn('mt-3 border-t border-[#eef2f8] pt-3 text-xs', INK_MUTED)}>
                  Pa paguar nga WHMCS:{' '}
                  <strong className={cn(NUM, INK_WARN)}>{formatALL(whmcsUnpaid.amount)}</strong>
                  {' '}— {whmcsUnpaid.count} fatura ende të papaguara (jo pjesë e arkëtimeve më sipër).
                </p>
              )}
            </section>
          </TabsContent>

          {/* ── TAB 2 · Profit by dimension — every panel scoped by the one filter row ── */}
          <TabsContent value="profit" className="mt-4 space-y-3.5">

            {/* The one control row. */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5 rounded-[14px] border border-[#e3e9f2] bg-white px-4 py-2.5">
              <span className={cn('text-[11px] font-extrabold uppercase tracking-[.1em]', INK_MUTED)}>
                Periudha
              </span>
              <Segmented
                value={isPickedMonth(period) ? '' : period}
                onChange={setPeriod}
                options={[['month', 'Ky muaj'], ['year', 'Viti'], ['all', 'Gjithë']] as const}
                size="sm"
              />
              <select
                value={isPickedMonth(period) ? period : ''}
                onChange={(e) => { if (e.target.value) setPeriod(e.target.value); }}
                aria-label="Zgjidh një muaj të caktuar"
                className={cn(
                  'h-[30px] rounded-lg border px-2 text-xs font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2f6fe0]',
                  isPickedMonth(period)
                    ? 'border-[#2f6fe0] bg-[#e3ecfb] text-[#2258bb]'
                    : 'border-[#e3e9f2] bg-white text-[#7286a3]',
                )}
              >
                <option value="">Muaj i caktuar…</option>
                {monthOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>

              <span className="hidden h-5 w-px bg-[#e3e9f2] sm:block" />

              <span className={cn('text-[11px] font-extrabold uppercase tracking-[.1em]', INK_MUTED)}>
                Të ardhurat
              </span>
              <Segmented
                value={revenueBasis}
                onChange={setRevenueBasis}
                options={[['budget', 'Buxhet'], ['invoiced', 'Paguar']] as const}
                size="sm"
              />

              <p className={cn('ml-auto text-xs font-semibold', INK_MUTED)}>
                {periodLabel} · {revenueBasis === 'invoiced' ? 'vetëm faturat e paguara' : 'buxheti i projekteve'}
              </p>
            </div>

            {/* ── Departments ── */}
            <section className={cn(CARD, 'overflow-hidden')}>
              <div className="px-5 pb-1 pt-5 sm:px-6">
                <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1.5">
                  <div className="min-w-0">
                    <h2 className={cn('text-base font-extrabold', INK_NAVY)}>Fitimi sipas departamentit</h2>
                    <p className={cn('mt-0.5 text-[12.5px]', INK_MUTED)}>
                      Fitim i plotë: të ardhurat minus pagat, shpenzimet e projektit dhe kostot fikse.
                      Kliko një rresht për projektet e tij.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowPnlHelp(v => !v)}
                    aria-expanded={showPnlHelp}
                    className={cn(
                      'inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[#e3e9f2] px-2.5 py-1 text-[11.5px] font-bold transition-colors hover:bg-[#f6f9fd] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2f6fe0]',
                      showPnlHelp ? 'bg-[#e3ecfb] text-[#2258bb]' : INK_MUTED,
                    )}
                  >
                    <Info className="h-3.5 w-3.5" />
                    Si llogaritet
                  </button>
                </div>

                {showPnlHelp && (
                  <dl className="mt-2.5 grid gap-x-6 gap-y-2 rounded-xl border border-[#e3e9f2] bg-[#f6f9fd] px-4 py-3 text-[12px] leading-relaxed sm:grid-cols-2">
                    <div>
                      <dt className={cn('font-extrabold', INK_NAVY)}>Të ardhura</dt>
                      <dd className={INK_MUTED}>
                        {revenueBasis === 'invoiced'
                          ? 'Paratë e arkëtuara në këtë periudhë nga faturat e lidhura me projektet e departamentit. Faturat e palaguara nuk numërohen.'
                          : 'Buxheti i projekteve aktive në periudhë (tarifa mujore × muajt aktivë për abonimet).'}
                      </dd>
                    </div>
                    <div>
                      <dt className={cn('font-extrabold', INK_NAVY)}>Kosto</dt>
                      <dd className={INK_MUTED}>
                        Paga e secilit pjesëmarrës, e ndarë barazi mes projekteve ku punon
                        · shpenzimet e lidhura me projektin · pjesa e kostove fikse të biznesit.
                      </dd>
                    </div>
                    <div>
                      <dt className={cn('font-extrabold', INK_NAVY)}>Fitimi dhe marzhi</dt>
                      <dd className={INK_MUTED}>
                        Të ardhura − Kosto. Marzhi është fitimi si përqindje e të ardhurave.
                      </dd>
                    </div>
                    <div>
                      <dt className={cn('font-extrabold', INK_NAVY)}>Pse një projekt del negativ</dt>
                      <dd className={INK_MUTED}>
                        Sepse mbajti kohë të paguar pa faturë të arkëtuar në këtë periudhë — jo
                        sepse humbi para. Lidhe faturën me projektin ose arkivoje projektin e mbyllur.
                      </dd>
                    </div>
                  </dl>
                )}
                {/* `expense.departmentId` is finally read by this table. When a
                    tagged team matches no department that has projects here, the
                    cost silently becomes business-wide overhead — say so, or the
                    fallback is indistinguishable from correct attribution. */}
                {departmentPnl.unmatchedDepartmentFixed.count > 0 && (
                  <div className="mt-2">
                    <Notice tone="neutral">
                      <strong>{departmentPnl.unmatchedDepartmentFixed.count} shpenzim</strong> me departament
                      që nuk përputhet me asnjë departament projektesh në këtë periudhë
                      (<strong className={NUM}>{formatALL(departmentPnl.unmatchedDepartmentFixed.amount)}</strong>)
                      {' '}u ndanë si kosto e përbashkët. Emri i departamentit te ekipi duhet të përputhet
                      me fushën «Departamenti» te projektet.
                    </Notice>
                  </div>
                )}
              </div>

              {departmentRows.rows.length === 0 ? (
                <div className="px-5 pb-5 pt-3 sm:px-6">
                  <EmptyState text='Ende pa projekte me departament. Cakto "Departamentin" te projektet për ta parë këtë ndarje.' />
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <div className="min-w-[660px]">
                    <TableHead first="Departamenti" />
                    {departmentRows.rows.map(d => {
                      const open = expandedDept === d.department;
                      const pct = Math.round((Math.max(d.revenue, d.collected) / departmentRows.max) * 100);
                      return (
                        <div key={d.department}>
                          <button
                            type="button"
                            onClick={() => setExpandedDept(open ? null : d.department)}
                            aria-expanded={open}
                            className={cn(
                              COLS,
                              'w-full items-center border-b border-[#eef2f8] px-5 py-3.5 text-left transition-colors hover:bg-[#f6f9fd] sm:px-6',
                              open && 'bg-[#f6f9fd]',
                            )}
                          >
                            <div className="flex min-w-0 items-center gap-3">
                              <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 text-[#94a5bd] transition-transform', open && 'rotate-90')} />
                              <div className="min-w-0 flex-1">
                                <p className={cn('truncate text-[13.5px] font-bold', INK_NAVY)}>{d.department}</p>
                                {/* Cash, shown only where it can differ from the
                                    accrual column — on the paid-invoices basis the
                                    two are the same number by construction. */}
                                {Math.round(d.collected) !== Math.round(d.revenue) && (
                                  <p className={cn('truncate text-[11px] font-semibold', INK_MUTED)}>
                                    arkëtuar {formatALL(d.collected)}
                                    {d.revenue > d.collected
                                      && ` · ${formatALL(d.revenue - d.collected)} pa arkëtuar`}
                                  </p>
                                )}
                                <div className="mt-1.5 h-[5px] max-w-[210px] overflow-hidden rounded-full bg-[#edf1f7]">
                                  <div className="h-full rounded-full bg-[#2f6fe0]" style={{ width: `${Math.max(2, pct)}%` }} />
                                </div>
                              </div>
                            </div>
                            <Num value={d.revenue} strong />
                            <Num value={d.cost} muted />
                            <Num value={d.profit} strong tone={d.profit >= 0 ? 'pos' : 'neg'} />
                            <div className="text-right">
                              <MarginPill margin={d.margin} />
                            </div>
                          </button>

                          {open && (
                            <div className="border-b border-[#eef2f8] bg-[#f6f9fd] px-5 py-2 sm:px-6">
                              {/* Same five-column ruler as the parent row, so a
                                  project's revenue and profit sit UNDER their own
                                  headers instead of one column to the left. */}
                              <ProjectLines
                                lines={d.projects}
                                indent="pl-[26px]"
                                basis={revenueBasis}
                                emptyText="Pa projekte në këtë periudhë — vetëm arkëtime për punë të mëparshme."
                                onFixUnlinked={collected.unlinked.count > 0
                                  ? () => navigate('/app/invoices?project=none')
                                  : undefined}
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}

                    <div className={cn(COLS, 'items-center bg-[#f6f9fd] px-5 py-3.5 text-[13px] font-extrabold sm:px-6', INK_NAVY)}>
                      <span className="pl-[26px]">
                        Gjithsej
                        {Math.round(departmentRows.totals.collected) !== Math.round(departmentRows.totals.revenue) && (
                          <span className={cn('ml-2 text-[11px] font-semibold', INK_MUTED)}>
                            arkëtuar {formatALL(departmentRows.totals.collected)}
                          </span>
                        )}
                      </span>
                      <Num value={departmentRows.totals.revenue} strong />
                      <Num value={departmentRows.totals.cost} strong />
                      <Num value={departmentRows.totals.profit} strong tone={departmentRows.totals.profit >= 0 ? 'pos' : 'neg'} />
                      <span />
                    </div>
                  </div>
                </div>
              )}

              {/* Data-quality guards. Without these the numbers look authoritative
                  while quietly excluding revenue: an invoice with no projectId is
                  dropped from the collected basis, yet the FULL overhead pool is
                  still allocated — so unlinked invoices read as pure loss. */}
              {(collected.unlinked.amount > 0 || departmentPnl.unallocatedLabor.total > 0) && (
                <div className="space-y-1 border-t border-[#eef2f8] px-5 py-3 sm:px-6">
                  {collected.unlinked.amount > 0 && (
                    <p className={cn('text-xs leading-relaxed', INK_MUTED)}>
                      <strong className={NUM}>{formatALL(collected.unlinked.amount)}</strong> arkëtuar nga{' '}
                      <strong>{collected.unlinked.count}</strong> faturë pa projekt të lidhur — nuk i takon
                      asnjë departamenti apo personi. Kjo është arsyeja më e shpeshtë pse një projekt
                      del me fitim negativ pa pasur asnjë humbje reale.{' '}
                      <button
                        onClick={() => navigate('/app/invoices?project=none')}
                        className="font-bold text-[#2f6fe0] underline hover:no-underline"
                      >
                        Lidhi me projektet
                      </button>
                    </p>
                  )}
                  {departmentPnl.unallocatedLabor.total > 0 && (
                    <p className={cn('text-xs', INK_WARN)}>
                      <strong className={NUM}>{formatALL(departmentPnl.unallocatedLabor.total)}</strong> rroga
                      stafi që s'punoi në asnjë projekt këtë periudhë — kosto e paalokuar te departamentet.
                    </p>
                  )}
                </div>
              )}
            </section>

            {/* ── Responsibles ── */}
            <section className={cn(CARD, 'overflow-hidden')}>
              <div className="px-5 pb-1 pt-5 sm:px-6">
                <h2 className={cn('text-base font-extrabold', INK_NAVY)}>Të ardhurat sipas përgjegjësit</h2>
                <p className={cn('mt-0.5 text-[12.5px]', INK_MUTED)}>
                  Të njëjtat masa si te departamenti. Kliko një person për projektet e tij.
                </p>
              </div>

              {staffRevenue.rows.length === 0 ? (
                <div className="px-5 pb-5 pt-3 sm:px-6">
                  <EmptyState text="Ende pa projekte me përgjegjës për këtë periudhë." />
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <div className="min-w-[660px]">
                    <TableHead first="Përgjegjësi" />
                    {staffRevenue.rows.map(r => {
                      const open = expandedStaff === r.userId;
                      return (
                        <div key={r.userId}>
                          <button
                            type="button"
                            onClick={() => setExpandedStaff(open ? null : r.userId)}
                            aria-expanded={open}
                            className={cn(
                              COLS,
                              'w-full items-center border-b border-[#eef2f8] px-5 py-3 text-left transition-colors hover:bg-[#f6f9fd] sm:px-6',
                              open && 'bg-[#f6f9fd]',
                            )}
                          >
                            <div className="flex min-w-0 items-center gap-3">
                              <span
                                aria-hidden="true"
                                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#e3ecfb] text-[11.5px] font-extrabold text-[#2258bb]"
                              >
                                {initialsOf(r.name)}
                              </span>
                              <span className="min-w-0">
                                <span className={cn('block truncate text-[13.5px] font-bold', INK_NAVY)}>
                                  {r.name}
                                  <span className={cn('ml-1.5 text-xs font-medium', INK_MUTED)}>
                                    · {r.projects.length} {r.projects.length === 1 ? 'projekt' : 'projekte'}
                                  </span>
                                </span>
                                {Math.round(r.collected) !== Math.round(r.revenue) && (
                                  <span className={cn('block truncate text-[11px] font-semibold', INK_MUTED)}>
                                    arkëtuar {formatALL(r.collected)}
                                  </span>
                                )}
                              </span>
                            </div>
                            <Num value={r.revenue} strong />
                            <Num value={r.cost} muted />
                            <Num value={r.profit} strong tone={r.profit >= 0 ? 'pos' : 'neg'} />
                            <div className="text-right">
                              <MarginPill margin={r.revenue > 0 ? r.profit / r.revenue : null} />
                            </div>
                          </button>

                          {open && r.projects.length > 0 && (
                            <div className="border-b border-[#eef2f8] bg-[#f6f9fd] px-5 py-2 sm:px-6">
                              <ProjectLines
                                lines={r.projects}
                                indent="pl-11"
                                basis={revenueBasis}
                                // Here payroll is inside the shared fixed pool, not a
                                // separate labour line — say so, or "fikse" reads as
                                // rent only and the salary looks unaccounted for.
                                overheadLabel="fikse+paga"
                                emptyText="Pa projekte në këtë periudhë."
                                onFixUnlinked={collected.unlinked.count > 0
                                  ? () => navigate('/app/invoices?project=none')
                                  : undefined}
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}

                    <div className={cn(COLS, 'items-center bg-[#f6f9fd] px-5 py-3.5 text-[13px] font-extrabold sm:px-6', INK_NAVY)}>
                      <span className="pl-11">
                        Gjithsej
                        {Math.round(staffRevenue.totals.collected) !== Math.round(staffRevenue.totals.revenue) && (
                          <span className={cn('ml-2 text-[11px] font-semibold', INK_MUTED)}>
                            arkëtuar {formatALL(staffRevenue.totals.collected)}
                          </span>
                        )}
                      </span>
                      <Num value={staffRevenue.totals.revenue} strong />
                      <Num value={staffRevenue.totals.cost} strong />
                      <Num value={staffRevenue.totals.profit} strong tone={staffRevenue.totals.profit >= 0 ? 'pos' : 'neg'} />
                      <span />
                    </div>
                  </div>
                </div>
              )}

              {(staffRevenue.unattributed > 0 || collected.withoutResponsible > 0) && (
                <div className="space-y-1 border-t border-[#eef2f8] px-5 py-3 sm:px-6">
                  {staffRevenue.unattributed > 0 && (
                    <p className={cn('text-xs', INK_MUTED)}>
                      Pa atribuar: <strong className={cn(NUM, INK_WARN)}>{formatALL(staffRevenue.unattributed)}</strong>
                      {' '}— projekte pa përgjegjës të caktuar.
                    </p>
                  )}
                  {collected.withoutResponsible > 0 && (
                    <p className={cn('text-xs', INK_MUTED)}>
                      <strong className={cn(NUM, INK_WARN)}>{formatALL(collected.withoutResponsible)}</strong>
                      {' '}arkëtuar nga projekte pa përgjegjës — të njohura si departament, por pa person.
                    </p>
                  )}
                </div>
              )}

              <div className="px-5 pb-4 sm:px-6">
                <Explain label="Çfarë do të thotë «arkëtuar» nën emrin e rreshtit">
                  <p>
                    Kolona <strong>Të ardhura</strong> = {revenueBasis === 'invoiced' ? 'faturat e paguara' : 'buxheti i projektit'}
                    {' '}brenda periudhës — ajo që u <em>fitua</em> (accrual). Ndjek toggle-in lart.
                  </p>
                  <p>
                    Rreshti i vogël <em>arkëtuar</em> = paraja që <em>hyri</em> realisht në të njëjtën
                    periudhë (cash), atribuar faturë → projekt → person/departament. Shfaqet vetëm kur
                    ndryshon nga kolona e të ardhurave: në bazën «Paguar» të dyja janë e njëjta shifër.
                  </p>
                  <p>
                    Diferenca mes tyre është e pambledhur. Negative kur në këtë periudhë u arkëtua
                    para për punë të faturuar më parë — nuk është gabim.
                  </p>
                </Explain>
              </div>
            </section>

            {/* Deeper cuts, folded away: the same period + basis, one level down. */}
            <Fold label="Fitimi projekt për projekt dhe trendi i departamenteve">
              <div className="space-y-3.5 pt-3.5">
                <section className={cn(CARD, 'px-5 py-5 sm:px-6')}>
                  <h3 className={cn('text-[15px] font-extrabold', INK_NAVY)}>Fitimi sipas projekti</h3>
                  <p className={cn('mb-3 mt-0.5 text-[12.5px]', INK_MUTED)}>
                    Të ardhurat − kostot direkte − pjesa e kostove fikse, e ndarë sipas peshës së të ardhurave.
                  </p>

                  {projectPnl.unlinkedInvoices.count > 0 && (
                    <Notice tone={revenueBasis === 'invoiced' ? 'warning' : 'neutral'}>
                      <strong>{projectPnl.unlinkedInvoices.count} faturë</strong> pa projekt të lidhur
                      (<strong className={NUM}>{formatALL(projectPnl.unlinkedInvoices.amount)}</strong>).
                      {revenueBasis === 'invoiced'
                        ? ' Kjo vlerë NUK numërohet si e ardhur më poshtë, ndërsa kostot fikse ndahen plotësisht — ndaj fitimi duket më i vogël se realiteti.'
                        : ' Nuk prek llogaritjen mbi bazën "Buxhet", por do të mungojë nëse kalon te "Paguar".'}
                    </Notice>
                  )}
                  {/* A cost tagged to a project OUTSIDE this period. It used to
                      vanish from every total (neither charged nor pooled); it is
                      now overhead, which changes each project's absorbed share —
                      so it has to be said out loud. */}
                  {projectPnl.unallocatedDirect.count > 0 && (
                    <Notice tone="neutral">
                      <strong>{projectPnl.unallocatedDirect.count} shpenzim</strong> i lidhur me projekte
                      jashtë kësaj periudhe (<strong className={NUM}>{formatALL(projectPnl.unallocatedDirect.amount)}</strong>)
                      {' '}u llogarit si kosto fikse e përbashkët, sepse asnjë projekt i periudhës nuk mund t'i mbajë.
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
                </section>

                {departmentTrend.departments.length > 0 && (
                  <section className={cn(CARD, 'px-5 py-5 sm:px-6')}>
                    <h3 className={cn('text-[15px] font-extrabold', INK_NAVY)}>Trendi sipas departamentit</h3>
                    <p className={cn('mb-2 mt-0.5 text-[12.5px]', INK_MUTED)}>
                      6 muajt e fundit — a po rritet apo po bie secili. (Muaji aktual është deri sot.)
                    </p>
                    <DepartmentTrend trend={departmentTrend} />
                  </section>
                )}
              </div>
            </Fold>
          </TabsContent>

          {/* ── TAB 3 · Clients — a different revenue basis, so it gets its own tab ── */}
          <TabsContent value="clients" className="mt-4">
            <div className="grid gap-4 lg:grid-cols-2">
              <section className={cn(CARD, 'px-5 py-5 sm:px-6')}>
                <h2 className={cn('flex items-center gap-2 text-[15px] font-extrabold', INK_POS)}>
                  <TrendingUp className="h-4 w-4" />
                  Klientët më fitimprurës
                </h2>
                {clientPnl.winners.length === 0 ? (
                  <div className="mt-3"><EmptyState text="Ende pa të dhëna klientësh." /></div>
                ) : clientPnl.winners.map((w, i) => (
                  <div key={w.id} className="flex items-center gap-3.5 border-b border-[#eef2f8] py-3 last:border-0">
                    <span className={cn('w-6 shrink-0 text-xs font-bold text-[#94a5bd]', NUM)}>
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className={cn('truncate text-[13.5px] font-bold', INK_NAVY)}>{w.name}</p>
                      <p className={cn('mt-px truncate text-[11.5px]', INK_MUTED)}>
                        Ardhura {formatALL(w.revenue)} · Kosto {formatALL(w.cost)}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className={cn('text-[13.5px] font-bold', NUM, w.margin >= 0 ? INK_POS : INK_NEG)}>
                        {w.margin >= 0 ? '+' : ''}{formatALL(w.margin)}
                      </p>
                      <p className="text-[11.5px] font-extrabold text-[#6bbd97]">{w.marginPct}% marzh</p>
                    </div>
                  </div>
                ))}
              </section>

              <section className={cn(CARD, 'px-5 py-5 sm:px-6')}>
                <h2 className={cn('flex items-center gap-2 text-[15px] font-extrabold', INK_NEG)}>
                  <TrendingDown className="h-4 w-4" />
                  Klientët me humbje
                </h2>
                {clientPnl.losers.length === 0 ? (
                  <div className="mt-3"><EmptyState text="Asnjë klient në humbje. 👍" /></div>
                ) : clientPnl.losers.map(w => (
                  <div key={w.id} className="flex items-center gap-3.5 border-b border-[#eef2f8] py-3 last:border-0">
                    <AlertTriangle className={cn('h-4 w-4 shrink-0', INK_NEG)} />
                    <div className="min-w-0 flex-1">
                      <p className={cn('truncate text-[13.5px] font-bold', INK_NAVY)}>{w.name}</p>
                      <p className={cn('mt-px truncate text-[11.5px]', INK_MUTED)}>
                        Ardhura {formatALL(w.revenue)} · Kosto {formatALL(w.cost)}
                      </p>
                    </div>
                    <p className={cn('shrink-0 whitespace-nowrap text-[13.5px] font-bold', NUM, INK_NEG)}>
                      {formatALL(w.margin)}
                    </p>
                  </div>
                ))}
                <p className={cn('mt-3.5 text-xs leading-relaxed', INK_MUTED)}>
                  Fitimi këtu numëron vetëm paranë e arkëtuar realisht — faturat e papaguara janë
                  llogari e arkëtueshme, jo fitim.
                </p>
              </section>
            </div>

            <div className={cn(CARD, 'mt-4 px-5 py-4 sm:px-6')}>
              <Explain label="Pse numrat këtu nuk përputhen me tabin 'Fitimi'">
                <p>
                  Baza këtu: <strong>faturë e arkëtuar − kosto e projektit</strong> (punë + shpenzime), për
                  gjithë historikun e klientit.
                </p>
                <p>
                  Baza te "Fitimi": <strong>buxhet ose faturuar − overhead i alokuar</strong>, brenda
                  periudhës që zgjodhe. Dy pyetje të ndryshme, dy përgjigje të ndryshme.
                </p>
              </Explain>
            </div>
          </TabsContent>

          {/* ── TAB 4 · Everything that is broken or at risk ── */}
          <TabsContent value="risk" className="mt-4 space-y-4">
            {alarms.length > 0 ? (
              <section className={cn(CARD, 'border-[#f0d9d6] border-l-4 border-l-[#d64545] px-5 py-5 sm:px-6')}>
                <div className="flex items-center gap-2.5">
                  <AlertTriangle className={cn('h-4 w-4', INK_NEG)} />
                  <h2 className={cn('text-[15px] font-extrabold uppercase tracking-[.06em]', INK_NEG)}>
                    Çfarë kërkon vëmendje
                  </h2>
                  <span className="rounded-full bg-[#d64545] px-2 py-px text-[11px] font-extrabold text-white">
                    {alarms.length}
                  </span>
                </div>
                {alarmSummary && (
                  <p className="mt-2.5 text-[13.5px] font-semibold leading-relaxed text-[#24344d]">
                    {alarmSummary}
                  </p>
                )}
                <ul className="mt-3.5 space-y-2">
                  {alarms.map((a, i) => (
                    <li
                      key={i}
                      className={cn(
                        'flex items-center gap-3 rounded-xl border px-3.5 py-2.5',
                        a.tone === 'red'
                          ? 'border-[#f0d9d6] bg-[#fdf1f0]'
                          : 'border-[#f0dfb8] bg-[#fdf6e8]',
                      )}
                    >
                      <span
                        className={cn(
                          'shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-[.08em] text-white',
                          a.tone === 'red' ? 'bg-[#d64545]' : 'bg-[#b98a1e]',
                        )}
                      >
                        {a.tag}
                      </span>
                      <span className="text-[13px] font-semibold text-[#24344d]">{a.text}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : (
              <section className={cn(CARD, 'px-5 py-5 sm:px-6')}>
                <AllClear text="Asnjë alarm financiar. Gjithçka në rregull." />
              </section>
            )}

            <div className="grid gap-4 lg:grid-cols-2">
              {/* Recurring invoice health */}
              <section className={cn(CARD, 'px-5 py-5 sm:px-6')}>
                <h2 className={cn('text-[15px] font-extrabold', INK_NAVY)}>Faturat recurring</h2>
                <p className={cn('mt-0.5 text-xs', INK_MUTED)}>
                  {recurringHealth.totalParents} gjithsej · {recurringHealth.healthy} në rregull ·{' '}
                  {recurringHealth.paused} në pauzë
                </p>

                {recurringHealth.stuck.length === 0 && recurringHealth.misconfigured.length === 0 ? (
                  <div className="mt-3.5">
                    <AllClear
                      text={recurringHealth.totalParents === 0
                        ? 'Nuk ke fatura recurring.'
                        : 'Të gjitha faturat recurring janë në rregull.'}
                    />
                  </div>
                ) : (
                  <div className="mt-3.5 space-y-2">
                    {recurringHealth.stuck.map(s => (
                      <div key={s.id} className="rounded-xl border border-[#f0d9d6] bg-[#fdf1f0] px-4 py-3">
                        <div className="flex items-baseline justify-between gap-2.5">
                          <div className="min-w-0">
                            <p className={cn('truncate text-[13px] font-extrabold', INK_NAVY)}>{s.name}</p>
                            <p className={cn('text-[11.5px]', INK_MUTED)}>
                              {FREQ_LABEL[s.freq] || s.freq} · nuk u gjenerua
                            </p>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className={cn('text-[13px] font-bold', NUM, INK_NAVY)}>{formatALL(s.amount)}</p>
                            <p className={cn('text-[11.5px] font-extrabold', INK_NEG)}>{s.daysOverdue} ditë vonesë</p>
                          </div>
                        </div>
                      </div>
                    ))}
                    {recurringHealth.misconfigured.map(m => (
                      <div key={m.id} className="rounded-xl border border-[#f0dfb8] bg-[#fdf6e8] px-4 py-3">
                        <div className="flex items-baseline justify-between gap-2.5">
                          <div className="min-w-0">
                            <p className={cn('truncate text-[13px] font-extrabold', INK_NAVY)}>{m.name}</p>
                            <p className={cn('text-[11.5px]', INK_MUTED)}>
                              Konfigurim i paplotë — {m.reason}
                            </p>
                          </div>
                          <p className={cn('shrink-0 text-[13px] font-bold', NUM, INK_NAVY)}>{formatALL(m.amount)}</p>
                        </div>
                      </div>
                    ))}
                    <Explain label="Si rregullohet">
                      <p>
                        Hap faturën te <strong>Faturat</strong>, kontrollo frekuencën dhe datën e radhës,
                        ose prit ciklin tjetër të cron-it.
                      </p>
                      <p>Faturat në pauzë ({recurringHealth.paused}) nuk numërohen si problem.</p>
                    </Explain>
                  </div>
                )}
              </section>

              {/* Cashflow coverage */}
              <section className={cn(CARD, 'px-5 py-5 sm:px-6')}>
                <h2 className={cn('text-[15px] font-extrabold', INK_NAVY)}>Shëndeti i rrjedhës së parasë</h2>
                <p className={cn('mt-0.5 text-xs', INK_MUTED)}>
                  Hyrjet mujore të përsëritura kundrejt daljeve fikse.
                </p>

                <CoverageBar
                  inflow={cashflow.monthlyInflow}
                  outflow={cashflow.monthlyOutflow}
                  salaries={cashflow.salaries}
                  recurringExpenses={cashflow.recurringExpenses}
                  gap={cashflow.gap}
                />

                {cashflow.alarms.length > 0 && (
                  <ul className="mt-4 space-y-2.5 border-t border-[#eef2f8] pt-3.5">
                    {cashflow.alarms.map(a => (
                      <li key={a.id} className="flex items-start gap-2.5 text-[13px]">
                        <span className={cn(
                          'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full',
                          a.severity === 'red' ? 'bg-[#d64545]' : 'bg-[#e8b23b]',
                        )} />
                        <div className="min-w-0 flex-1">
                          <p className={cn('font-bold', INK_NAVY)}>
                            {a.title}
                            {a.id === 'concentration' && a.customerId && (
                              <span className={cn('font-medium', INK_MUTED)}>
                                {' '}— {customerNameById.get(a.customerId) || 'klient'}
                              </span>
                            )}
                          </p>
                          <p className={cn('text-[11.5px] leading-relaxed', INK_MUTED)}>{a.detail}</p>
                        </div>
                        {a.amount != null && (
                          <span className={cn(
                            'shrink-0 text-[13px] font-bold',
                            NUM,
                            a.amount < 0 ? INK_NEG : INK_NAVY,
                          )}>
                            {formatALL(a.amount)}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

// ── Layout primitives ──────────────────────────────────────────────────────

/** Pill tab, styled to the reference: active = solid navy. */
const PillTab: React.FC<{ value: string; badge?: number; children: React.ReactNode }> = ({
  value, badge, children,
}) => (
  <TabsTrigger
    value={value}
    className={cn(
      'gap-2 rounded-[11px] px-4 py-2 text-[13px] font-bold text-[#5a6d8a] transition-all sm:px-5',
      'data-[state=active]:bg-[#08183A] data-[state=active]:text-white',
      'data-[state=active]:shadow-[0_2px_6px_rgba(8,24,58,.25)]',
    )}
  >
    {children}
    {badge != null && badge > 0 && (
      <span className="rounded-full bg-[#d64545] px-1.5 py-px text-[10.5px] font-extrabold tabular-nums text-white">
        {badge}
      </span>
    )}
  </TabsTrigger>
);

/** One line of the hero's mini P&L. */
const HeroRow: React.FC<{
  label: string;
  amount: number;
  tone: 'pos' | 'neg' | 'total';
  rule?: boolean;
  strong?: boolean;
  /** Where the figure came from — shown under the label, because a payroll line
   *  read off the member profiles and one read off recorded payments are not the
   *  same claim and the difference used to be invisible. */
  note?: string;
}> = ({ label, amount, tone, rule, strong, note }) => (
  <div className={cn(
    'flex items-center justify-between gap-3.5',
    rule && 'border-t pt-2.5',
    rule && (strong ? 'border-white/20' : 'border-white/[.08]'),
  )}>
    <span className={cn(
      'min-w-0 text-[12.5px] font-semibold leading-tight',
      strong ? 'text-white' : 'text-[#c3d1e8]',
    )}>
      {label}
      {note && <span className="block text-[10.5px] font-medium text-[#8fa3c4]">{note}</span>}
    </span>
    <span className={cn(
      'shrink-0 whitespace-nowrap text-[12.5px] font-bold',
      NUM,
      tone === 'pos' && 'text-[#5fd8a8]',
      tone === 'neg' && 'text-[#ef9f9f]',
      tone === 'total' && 'text-white',
    )}>
      {/* Negating an empty pool yields -0, which formats as "-0 Lekë". */}
      {formatALL(amount === 0 ? 0 : amount)}
    </span>
  </div>
);

/** One of the four supporting measures beside the hero. */
const KpiCard: React.FC<{
  icon: React.ReactNode;
  iconBg: string;
  iconInk: string;
  label: string;
  value: string;
  sub: string;
  danger?: boolean;
}> = ({ icon, iconBg, iconInk, label, value, sub, danger }) => (
  <div className={cn(
    'flex flex-col gap-1.5 rounded-[20px] border p-5 shadow-[0_1px_3px_rgba(8,24,58,.05)]',
    danger ? 'border-[#f3d2cd] bg-[#fef5f3]' : 'border-[#e3e9f2] bg-white',
  )}>
    <div className="flex items-center gap-2.5">
      <span
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px]"
        style={{ background: iconBg, color: iconInk }}
        aria-hidden="true"
      >
        {icon}
      </span>
      <span className={cn('min-w-0 truncate text-xs font-bold', INK_MUTED)}>{label}</span>
    </div>
    <p className={cn(
      'break-words text-2xl font-extrabold leading-tight tracking-[-0.01em]',
      NUM,
      danger ? INK_NEG : INK_NAVY,
    )}>
      {value}
    </p>
    <p className={cn('text-xs font-semibold', danger ? INK_NEG : INK_MUTED)}>{sub}</p>
  </div>
);

/**
 * Column header for the department / responsible tables.
 *
 * The columns read as the arithmetic they are — `Të ardhura − Kosto = Fitimi` —
 * because profit appearing next to revenue with nothing between them is the one
 * thing nobody could check. "Arkëtuar" used to sit in the middle instead, and on
 * the (default) paid-invoices basis it is the revenue column by construction:
 * two identical columns of the same number, and no cost anywhere. Cash is still
 * shown, under the row's own name, on the basis where it can actually differ.
 */
const TableHead: React.FC<{ first: string }> = ({ first }) => (
  <div className={cn(
    COLS,
    'border-b border-[#e3e9f2] px-5 pb-2 pt-3 text-[11px] font-extrabold uppercase tracking-[.08em] text-[#94a5bd] sm:px-6',
  )}>
    <div>{first}</div>
    <div className="text-right">Të ardhura</div>
    <div className="text-right">Kosto</div>
    <div className="text-right">Fitimi</div>
    <div className="text-right">Marzhi</div>
  </div>
);

/** Right-aligned money cell. Mono + tabular so columns compare vertically. */
const Num: React.FC<{
  value: number;
  strong?: boolean;
  muted?: boolean;
  tone?: 'pos' | 'neg';
}> = ({ value, strong, muted, tone }) => (
  <span className={cn(
    'text-right text-[13px]',
    NUM,
    strong && 'font-bold',
    tone === 'pos' && INK_POS,
    tone === 'neg' && INK_NEG,
    !tone && (muted ? INK_MUTED : INK_NAVY),
  )}>
    {formatALL(value)}
  </span>
);

const MarginPill: React.FC<{ margin: number | null }> = ({ margin }) => {
  if (margin == null) return <span className={cn('text-xs', INK_MUTED)}>—</span>;
  const pct = Math.round(margin * 100);
  const pos = pct >= 0;
  return (
    <span className={cn(
      'inline-block rounded-full px-2.5 py-0.5 text-xs font-extrabold tabular-nums',
      pos ? 'bg-[#e7f6ef] text-[#0f8a5f]' : 'bg-[#fdece9] text-[#d64545]',
    )}>
      {pct}%
    </span>
  );
};

/** An amount with no currency tag — for the dense breakdown lines, where the
 *  column above has already established the unit. */
const plainAmount = (v: number) => Math.round(v).toLocaleString('sq-AL');

/**
 * One project inside an expanded department / person row.
 *
 * `labor` is optional because only the department P&L separates it: the
 * per-person table costs a project from the business-wide fixed pool, where
 * payroll is already inside `overhead`.
 */
export interface PnlLine {
  id: string;
  name: string;
  revenue: number;
  cost: number;
  profit: number;
  labor?: number;
  directCost?: number;
  overhead?: number;
}

/** "paga 5.646 · direkte 2.400 · fikse 2.290" — where the cost went. */
const CostSplit: React.FC<{ line: PnlLine; overheadLabel: string }> = ({ line, overheadLabel }) => {
  const parts: string[] = [];
  if (line.labor) parts.push(`paga ${plainAmount(line.labor)}`);
  if (line.directCost) parts.push(`direkte ${plainAmount(line.directCost)}`);
  if (line.overhead) parts.push(`${overheadLabel} ${plainAmount(line.overhead)}`);
  if (parts.length === 0) return null;
  return (
    <p className={cn('truncate text-[10.5px] font-medium leading-tight', INK_MUTED)}>
      {parts.join(' · ')}
    </p>
  );
};

const ProjectLine: React.FC<{
  line: PnlLine;
  indent: string;
  overheadLabel: string;
}> = ({ line, indent, overheadLabel }) => {
  const margin = line.revenue > 0 ? Math.round((line.profit / line.revenue) * 100) : null;
  return (
    <div className={cn(COLS, 'items-center py-1.5 text-[12.5px]')}>
      <div className={cn('min-w-0', indent)}>
        <p className="truncate font-semibold text-[#24344d]">{line.name}</p>
        <CostSplit line={line} overheadLabel={overheadLabel} />
      </div>
      <Num value={line.revenue} muted />
      <Num value={line.cost} muted />
      <Num value={line.profit} strong tone={line.profit >= 0 ? 'pos' : 'neg'} />
      <span className={cn(
        'text-right text-[11.5px] font-bold tabular-nums',
        margin == null ? INK_MUTED : margin >= 0 ? INK_POS : INK_NEG,
      )}>
        {margin == null ? '—' : `${margin}%`}
      </span>
    </div>
  );
};

/**
 * The projects inside an expanded department / person row.
 *
 * A project that billed nothing in the period still carries its slice of
 * somebody's salary, so it shows a loss exactly the size of that slice. The
 * arithmetic is right; what was missing is the REASON — and twenty identical
 * negative rows in a row read as a broken table, while burying the handful of
 * projects that actually earned. They are folded into one summary line that
 * names them and stays expandable, with the causes spelled out: a paid invoice
 * that was never linked to its project is by far the most common, and it is the
 * one the owner can fix.
 */
const ProjectLines: React.FC<{
  lines: PnlLine[];
  indent: string;
  emptyText: string;
  basis: 'budget' | 'invoiced';
  overheadLabel?: string;
  onFixUnlinked?: () => void;
}> = ({ lines, indent, emptyText, basis, overheadLabel = 'fikse', onFixUnlinked }) => {
  const earning = lines.filter(l => l.revenue > 0);
  const idle = lines.filter(l => l.revenue <= 0);
  const idleCost = idle.reduce((s, l) => s + l.cost, 0);
  // Folded by default — but only when there is something to fold it AWAY from.
  // A department whose projects all read zero would otherwise open into a single
  // summary line, hiding its entire contents behind a second click.
  const [showIdle, setShowIdle] = useState(earning.length === 0);

  if (lines.length === 0) {
    return <p className={cn('py-2 text-xs', indent, INK_MUTED)}>{emptyText}</p>;
  }

  return (
    <>
      {earning.map(l => (
        <ProjectLine key={l.id} line={l} indent={indent} overheadLabel={overheadLabel} />
      ))}

      {idle.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setShowIdle(v => !v)}
            aria-expanded={showIdle}
            className={cn(
              COLS,
              'w-full items-center rounded-lg py-1.5 text-left text-[12.5px] transition-colors hover:bg-[#e9eff8]',
              earning.length > 0 && 'mt-1 border-t border-dashed border-[#dde5f0] pt-2',
            )}
          >
            <span className={cn('flex min-w-0 items-center gap-1.5', indent)}>
              <ChevronRight className={cn(
                'h-3 w-3 shrink-0 text-[#94a5bd] transition-transform',
                showIdle && 'rotate-90',
              )} />
              <span className={cn('truncate font-bold', INK_MUTED)}>
                {idle.length} {idle.length === 1 ? 'projekt' : 'projekte'} pa të ardhura
              </span>
            </span>
            <span className={cn('text-right text-[13px]', NUM, INK_MUTED)}>—</span>
            <Num value={idleCost} muted />
            <Num value={-idleCost} strong tone={idleCost > 0 ? 'neg' : 'pos'} />
            <span />
          </button>

          {showIdle && (
            <>
              <div className={cn('py-1.5', indent)}>
                <p className={cn('max-w-[560px] text-[11px] leading-relaxed', INK_MUTED)}>
                  Nuk kanë {basis === 'invoiced' ? 'asnjë faturë të paguar' : 'buxhet'} në këtë
                  periudhë, por thithin një pjesë të pagës së stafit që punon mbi to — pra kjo nuk
                  është një humbje e re, është kohë e paguar pa të ardhura përkundrejt saj.
                  Zakonisht: faturë e paguar pa projektin e lidhur, punë e mbyllur e faturuar më
                  parë, ose projekt i brendshëm.
                  {onFixUnlinked && (
                    <>
                      {' '}
                      <button
                        type="button"
                        onClick={onFixUnlinked}
                        className="font-bold text-[#2f6fe0] underline hover:no-underline"
                      >
                        Shih faturat pa projekt
                      </button>
                    </>
                  )}
                </p>
              </div>
              {idle.map(l => (
                <ProjectLine key={l.id} line={l} indent={indent} overheadLabel={overheadLabel} />
              ))}
            </>
          )}
        </>
      )}
    </>
  );
};

function Segmented<T extends string>({ value, onChange, options, size = 'md' }: {
  value: T | '';
  onChange: (v: T) => void;
  options: readonly (readonly [T, string])[];
  size?: 'sm' | 'md';
}) {
  return (
    <div className={cn(
      'inline-flex items-center rounded-xl bg-[#e6ebf3] p-[3px]',
      size === 'sm' && 'rounded-[10px] bg-[#edf1f7]',
    )}>
      {options.map(([key, label]) => {
        const active = value === key;
        return (
          <button
            key={key}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(key)}
            className={cn(
              'whitespace-nowrap rounded-lg font-bold transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2f6fe0]',
              size === 'sm' ? 'px-3.5 py-1.5 text-xs' : 'px-4 py-2 text-[12.5px]',
              active
                ? 'bg-white text-[#08183A] shadow-[0_1px_3px_rgba(8,24,58,.12)]'
                : 'text-[#7286a3] hover:text-[#08183A]',
            )}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Collapsed explanation. Each card used to carry up to three paragraphs of prose
 * that drowned its numbers; the text is still here, just folded away.
 */
const Explain: React.FC<{ label?: string; children: React.ReactNode }> = ({
  label = 'Si llogaritet',
  children,
}) => (
  <details className="group mt-3.5">
    <summary className={cn(
      'flex w-fit cursor-pointer list-none items-center gap-1.5 text-[11px] font-bold transition-colors hover:text-[#08183A] [&::-webkit-details-marker]:hidden',
      INK_MUTED,
    )}>
      <Info className="h-3 w-3" />
      {label}
      <ChevronDown className="h-3 w-3 transition-transform group-open:rotate-180" />
    </summary>
    <div className={cn(
      'mt-2 space-y-1.5 border-l-2 border-[#e3e9f2] pl-3 text-[11.5px] leading-relaxed',
      INK_MUTED,
    )}>
      {children}
    </div>
  </details>
);

/** A whole section folded away — same mechanic as <Explain>, panel-sized. */
const Fold: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <details className="group">
    <summary className={cn(
      'flex w-fit cursor-pointer list-none items-center gap-2 rounded-xl border border-[#e3e9f2] bg-white px-4 py-2.5 text-[12.5px] font-bold transition-colors hover:text-[#08183A] [&::-webkit-details-marker]:hidden',
      INK_MUTED,
    )}>
      <ChevronRight className="h-3.5 w-3.5 transition-transform group-open:rotate-90" />
      {label}
    </summary>
    {children}
  </details>
);

const Notice: React.FC<{ tone: 'warning' | 'neutral'; children: React.ReactNode }> = ({ tone, children }) => (
  <div className={cn(
    'mb-3 rounded-xl border px-3.5 py-2.5 text-xs leading-relaxed',
    tone === 'warning'
      ? 'border-[#f0dfb8] bg-[#fdf6e8] text-[#7a5a12]'
      : 'border-[#e3e9f2] bg-[#f6f9fd] text-[#5a6d8a]',
  )}>
    {children}
  </div>
);

const AllClear: React.FC<{ text: string }> = ({ text }) => (
  <p className={cn('flex items-center gap-2 text-[13.5px] font-semibold', INK_POS)}>
    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#e7f6ef] text-[11px]">✓</span>
    {text}
  </p>
);

const EmptyState: React.FC<{ text: string }> = ({ text }) => (
  <p className={cn(
    'rounded-xl border border-dashed border-[#e3e9f2] px-4 py-5 text-center text-[13px]',
    INK_MUTED,
  )}>
    {text}
  </p>
);

/** Recurring inflow vs fixed outflow, as a coverage ratio. */
const CoverageBar: React.FC<{
  inflow: number;
  outflow: number;
  salaries: number;
  recurringExpenses: number;
  gap: number;
}> = ({ inflow, outflow, salaries, recurringExpenses, gap }) => {
  const pct = outflow > 0 ? Math.round((inflow / outflow) * 100) : 100;
  const covered = pct >= 100;
  const critical = pct < 75;
  return (
    <div className="mt-4 flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2 text-[13px]">
        <span className="font-bold text-[#24344d]">Hyrje të përsëritura</span>
        <span className={cn('font-bold', NUM, INK_POS)}>{formatALL(inflow)}</span>
      </div>
      <div className="flex items-baseline justify-between gap-2 text-[13px]">
        <span className="font-bold text-[#24344d]">Dalje fikse (rroga + shpenzime)</span>
        <span className={cn('font-bold', NUM, INK_NEG)}>{formatALL(outflow)}</span>
      </div>

      <div className="h-2.5 overflow-hidden rounded-full bg-[#edf1f7]">
        <div
          className="h-full rounded-full"
          style={{
            width: `${Math.max(2, Math.min(100, pct))}%`,
            background: covered
              ? 'linear-gradient(90deg, #3ac48c, #0f8a5f)'
              : critical
                ? 'linear-gradient(90deg, #e88b8b, #d64545)'
                : 'linear-gradient(90deg, #e8b23b, #d99a17)',
          }}
        />
      </div>

      <p className={cn(
        'text-[12.5px] font-bold leading-relaxed',
        covered ? INK_POS : critical ? INK_NEG : INK_WARN,
      )}>
        Mbulim {pct}% —{' '}
        {covered
          ? `hyrjet e sigurta i mbulojnë daljet fikse, me tepricë ${formatALL(gap)} në muaj.`
          : `hyrjet e sigurta nuk i mbulojnë daljet fikse; diferenca ${formatALL(Math.abs(gap))} varet nga projektet një-herëshe.`}
      </p>
      <p className={cn('text-[11.5px]', INK_MUTED)}>
        Dalje fikse = rroga {formatALL(salaries)} + shpenzime periodike {formatALL(recurringExpenses)}.
      </p>
    </div>
  );
};

// ── Chart primitives ───────────────────────────────────────────────────────

/** Tooltip: text stays ink, the dot carries series identity. */
const ChartTip: React.FC<any> = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  const rows = payload.filter((p: any) => p.value != null);
  if (!rows.length) return null;
  return (
    <div className="rounded-xl border border-[#e3e9f2] bg-white px-3.5 py-2.5 shadow-[0_12px_28px_-12px_rgba(8,24,58,.35)]">
      <p className={cn('mb-1.5 text-[11px] font-extrabold', INK_NAVY)}>{label}</p>
      <ul className="space-y-1">
        {rows.map((p: any) => (
          <li key={p.dataKey} className="flex items-center gap-2 text-[11px]">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: p.color || p.fill }} />
            <span className={INK_MUTED}>{p.name}</span>
            <span className={cn('ml-auto pl-3 font-bold', NUM, INK_NAVY)}>{formatALL(p.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};

const ChartLegend: React.FC<{
  items: { label: string; color: string; dashed?: boolean; square?: boolean }[];
}> = ({ items }) => (
  <ul className="flex flex-wrap items-center gap-x-4 gap-y-1">
    {items.map(it => (
      <li key={it.label} className={cn('flex items-center gap-2 text-xs font-bold', INK_MUTED)}>
        {it.dashed ? (
          <svg width="18" height="4" viewBox="0 0 18 4" aria-hidden="true">
            <line x1="0" y1="2" x2="18" y2="2" stroke={it.color} strokeWidth="3" strokeDasharray="5 4" />
          </svg>
        ) : it.square ? (
          <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: it.color }} />
        ) : (
          <span className="h-[3px] w-[18px] rounded-sm" style={{ background: it.color }} />
        )}
        {it.label}
      </li>
    ))}
  </ul>
);

// ── Data sub-components ────────────────────────────────────────────────────

/**
 * Per-department profit over the last 6 months.
 *
 * Capped at 4 named series with the tail folded into one "Të tjera" line: past
 * ~5 lines on a 6-point chart the hues stop separating and it reads as
 * spaghetti — folding beats cycling the palette.
 */
const DEPT_SERIES = ['#2f6fe0', '#7C3AED', '#DB2777', '#EA580C'] as const;
const DEPT_REST = '#64748B';

const DepartmentTrend: React.FC<{
  trend: ReturnType<typeof buildDepartmentProfitTrend>;
}> = ({ trend }) => {
  const view = useMemo(() => {
    const REST_KEY = 'Të tjera';
    const shown = trend.departments.slice(0, 4);
    const rest = trend.departments.slice(4);
    const data = trend.data.map(row => {
      const next: Record<string, number | string> = { label: row.label as string };
      for (const d of shown) next[d] = Number(row[d] || 0);
      if (rest.length) next[REST_KEY] = rest.reduce((s, d) => s + Number(row[d] || 0), 0);
      return next;
    });
    const series = [
      ...shown.map((d, i) => ({ key: d, color: DEPT_SERIES[i], delta: trend.deltas[d]?.delta ?? 0 })),
      ...(rest.length
        ? [{
            key: REST_KEY,
            color: DEPT_REST,
            delta: rest.reduce((s, d) => s + (trend.deltas[d]?.delta ?? 0), 0),
          }]
        : []),
    ];
    return { data, series, restCount: rest.length };
  }, [trend]);

  if (!view.series.length) return <EmptyState text="Ende pa departamente për të krahasuar." />;

  return (
    <>
      <ResponsiveContainer width="100%" height={230}>
        <ComposedChart data={view.data} margin={{ top: 12, right: 16, left: 0, bottom: 4 }}>
          <CartesianGrid stroke={GRID_INK} vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: AXIS_INK, fontWeight: 700 }} axisLine={{ stroke: '#d7dfeb' }} tickLine={false} />
          <YAxis tick={{ fontSize: 10, fill: AXIS_INK }} width={58} axisLine={false} tickLine={false} tickFormatter={compactALL} />
          <ReferenceLine y={0} stroke="#d7dfeb" strokeWidth={1.5} />
          <Tooltip content={<ChartTip />} />
          {view.series.map(s => (
            <Line
              key={s.key} name={s.key} type="monotone" dataKey={s.key}
              stroke={s.color} strokeWidth={2.5} strokeLinecap="round"
              dot={{ r: 3.5, fill: s.color, stroke: '#FFFFFF', strokeWidth: 2 }}
              activeDot={{ r: 6, stroke: '#FFFFFF', strokeWidth: 2 }}
            />
          ))}
        </ComposedChart>
      </ResponsiveContainer>

      {/* The legend doubles as the month-over-month delta list. */}
      <ul className="mt-3 grid grid-cols-1 gap-x-5 gap-y-1.5 sm:grid-cols-2">
        {view.series.map(s => {
          const up = s.delta >= 0;
          return (
            <li key={s.key} className="flex items-center gap-2 text-[13px]">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s.color }} />
              <span className={cn('min-w-0 flex-1 truncate font-semibold', INK_NAVY)}>{s.key}</span>
              <span className={cn('flex shrink-0 items-center gap-1 text-xs font-bold', NUM, up ? INK_POS : INK_NEG)}>
                {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                {up ? '+' : ''}{formatALL(s.delta)}
              </span>
            </li>
          );
        })}
      </ul>
      {view.restCount > 0 && (
        <p className={cn('mt-2 text-[11px]', INK_MUTED)}>
          "Të tjera" përmbledh {view.restCount} departamente të tjera më të vogla.
        </p>
      )}
    </>
  );
};

/** One project row of the detailed table — the earning list and the folded
 *  zero-revenue list render identically, so they share this. */
const PnlTableRow: React.FC<{
  row: ReturnType<typeof computeProjectPnl>['rows'][number];
  customerNameById: Map<string, string>;
}> = ({ row: r, customerNameById }) => (
  <tr className="border-b border-[#eef2f8] last:border-0 hover:bg-[#f6f9fd]">
    <td className="max-w-[180px] px-1 py-2">
      <p className={cn('truncate font-bold', INK_NAVY)}>{r.name}</p>
      <p className={cn('truncate text-[11px]', INK_MUTED)}>
        {r.customerId ? (customerNameById.get(r.customerId) || 'Pa klient') : 'Pa klient'}
        {r.billingType === 'monthly' ? ` · mujore ×${r.activeMonths}` : ' · njëherëshe'}
      </p>
    </td>
    <td className={cn('px-1 py-2 text-right', NUM, INK_NAVY)}>{formatALL(r.revenue)}</td>
    <td className={cn('px-1 py-2 text-right', NUM, INK_MUTED)}>{formatALL(r.directCost)}</td>
    <td className={cn('px-1 py-2 text-right', NUM, INK_MUTED)}>{formatALL(r.overhead)}</td>
    <td className={cn('px-1 py-2 text-right font-bold', NUM, r.profit >= 0 ? INK_POS : INK_NEG)}>
      {formatALL(r.profit)}
    </td>
    <td className={cn(
      'px-1 py-2 text-right',
      NUM,
      r.margin == null ? INK_MUTED : r.margin >= 0 ? INK_POS : INK_NEG,
    )}>
      {r.margin == null ? '—' : `${Math.round(r.margin * 100)}%`}
    </td>
  </tr>
);

const ProjectPnlBlock: React.FC<{
  pnl: ReturnType<typeof computeProjectPnl>;
  customerNameById: Map<string, string>;
}> = ({ pnl, customerNameById }) => {
  const { fixedPool, totals, allocationBasis } = pnl;
  const earning = pnl.rows.filter(r => r.revenue > 0);
  const idle = pnl.rows.filter(r => r.revenue <= 0);
  const idleProfit = idle.reduce((s, r) => s + r.profit, 0);
  const [showIdle, setShowIdle] = useState(earning.length === 0);

  // No projects in the period does NOT mean no cost: payroll and overhead were
  // still paid. Returning an empty state here hid the whole fixed pool, so the
  // period read as if nothing had been spent.
  if (pnl.rows.length === 0) {
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <PoolTile label="Të ardhura" value={0} />
          <PoolTile label="Kosto direkte" value={0} tone="neg" />
          <PoolTile
            label="Kosto fikse"
            value={fixedPool.total}
            tone="neg"
            hint={`rroga ${formatALL(fixedPool.salaries)} + fikse ${formatALL(fixedPool.otherFixed)}`}
          />
          <PoolTile label="Fitimi total" value={-fixedPool.total} tone="neg" bold />
        </div>
        <EmptyState text="Ende pa projekte për këtë periudhë — kostot fikse mbeten të pandara." />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <PoolTile label="Të ardhura" value={totals.revenue} />
        <PoolTile label="Kosto direkte" value={totals.directCost} tone="neg" />
        <PoolTile
          label="Kosto fikse"
          value={fixedPool.total}
          tone="neg"
          hint={`rroga ${formatALL(fixedPool.salaries)} + fikse ${formatALL(fixedPool.otherFixed)}`
            + (fixedPool.payrollFallbackMonths > 0
              ? ` · ${fixedPool.payrollFallbackMonths} muaj pa pagesa të regjistruara (nga lista e pagave)`
              : '')}
        />
        <PoolTile label="Fitimi total" value={totals.profit} tone={totals.profit >= 0 ? 'pos' : 'neg'} bold />
      </div>

      {allocationBasis === 'equal' && (
        <p className={cn('text-[11px] font-semibold', INK_WARN)}>
          ⚠ Asnjë projekt s'ka buxhet — kostot fikse u ndanë në mënyrë të barabartë. Vendos buxhetin
          te projektet për ndarje reale.
        </p>
      )}

      <div className="-mx-1 overflow-x-auto">
        <table className="w-full min-w-[580px] text-[13px]">
          <thead>
            <tr className="border-b border-[#e3e9f2] text-[11px] font-extrabold uppercase tracking-[.08em] text-[#94a5bd]">
              <th className="px-1 py-2 text-left">Projekti</th>
              <th className="px-1 py-2 text-right">Të ardhura</th>
              <th className="px-1 py-2 text-right">Direkte</th>
              <th className="px-1 py-2 text-right">Fikse</th>
              <th className="px-1 py-2 text-right">Fitimi</th>
              <th className="px-1 py-2 text-right">Marzh</th>
            </tr>
          </thead>
          <tbody>
            {earning.map(r => <PnlTableRow key={r.id} row={r} customerNameById={customerNameById} />)}

            {/* Same reasoning as the department drill-down: a project with no
                revenue in the period absorbs overhead and shows a loss the size
                of that share. Listed one by one they bury every project that
                earned, so they are summarised — and openable. */}
            {idle.length > 0 && (
              <tr className="border-b border-[#eef2f8] last:border-0">
                <td colSpan={6} className="px-1 py-1.5">
                  <button
                    type="button"
                    onClick={() => setShowIdle(v => !v)}
                    aria-expanded={showIdle}
                    className={cn('flex items-center gap-1.5 rounded-lg py-1 text-[12px] font-bold', INK_MUTED)}
                  >
                    <ChevronRight className={cn('h-3 w-3 transition-transform', showIdle && 'rotate-90')} />
                    {idle.length} {idle.length === 1 ? 'projekt' : 'projekte'} pa të ardhura
                    {' · '}
                    <span className={cn(NUM, INK_NEG)}>{formatALL(idleProfit)}</span>
                  </button>
                </td>
              </tr>
            )}
            {showIdle && idle.map(r => <PnlTableRow key={r.id} row={r} customerNameById={customerNameById} />)}
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
  <div className="rounded-xl border border-[#e3e9f2] bg-[#f6f9fd] px-3 py-2.5">
    <p className={cn('text-[11px] font-semibold', INK_MUTED)}>{label}</p>
    <p className={cn(
      NUM,
      bold ? 'text-base font-extrabold' : 'text-[13px] font-bold',
      tone === 'pos' && INK_POS,
      tone === 'neg' && INK_NEG,
      tone === 'default' && INK_NAVY,
    )}>
      {formatALL(value)}
    </p>
    {hint && <p className={cn('mt-0.5 text-[10px] leading-tight', INK_MUTED)}>{hint}</p>}
  </div>
);

const FinancesSkeleton: React.FC = () => (
  <div className="pb-6">
    <div className="mx-auto max-w-[1140px] space-y-4">
      <Skeleton className="h-10 w-44 rounded-xl" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[1.15fr_1fr_1fr]">
        <Skeleton className="h-[268px] rounded-[20px] sm:col-span-2 lg:col-span-1 lg:row-span-2" />
        <Skeleton className="h-[126px] rounded-[20px]" />
        <Skeleton className="h-[126px] rounded-[20px]" />
        <Skeleton className="h-[126px] rounded-[20px]" />
        <Skeleton className="h-[126px] rounded-[20px]" />
      </div>
      <Skeleton className="h-11 w-[380px] max-w-full rounded-[14px]" />
      <Skeleton className="h-72 w-full rounded-[20px]" />
    </div>
  </div>
);

export default FinancesView;
