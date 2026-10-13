import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
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
import type { Invoice, InvoiceItem, Service, Expense, Customer, Project, TeamMember, Team, Subscription, Domain, TimeEntry, FinanceMonthClose } from '../types';
import { hostingMonthlyRecurringRevenue, hostingRenewalsInWindow } from '../lib/hosting/finance';
import { useModules } from '../hooks/useModules';
import {
  getInvoiceCollectedBetween,
  getInvoiceOutstandingAll,
  calculateExpensesBetween,
  calculateAccountsReceivable,
  parseDate,
  MONTH_LABELS_SQ,
} from '../lib/finance/financialAnalytics';
import { computeProjectPnl, type ProjectPnlOptions } from '../lib/finance/projectPnl';
import { invoiceBillingBlockReason, type InvoiceGenerationBlock } from '../lib/finance/recurringInvoices';
import { getExpenseDate } from '../lib/finance/financialAnalytics';
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
import { useTeamSettingsData } from '../hooks/useTeamSettings';
import { useMutation } from '../hooks/useFirestore';
import { useAuth } from '../contexts/AuthContext';
import { allocateLabor } from '../lib/finance/laborAllocation';
import { computeClientProfitability, monthCloseChecks, snapshotForClose } from '../lib/finance/clientProfitability';
import { computeCapacity } from '../lib/finance/capacity';
import { monthCloseId } from '../lib/finance/timeEntries';
import { closeMonthPatch, monthCloseBlockReason, reopenMonthPatch, resultFromSnapshot, snapshotNetDrift } from '../lib/finance/monthClose';
import { useToast } from '../hooks/use-toast';
import ClientProfitabilityPanel from '../components/finance/ClientProfitabilityPanel';
import CapacityCard from '../components/finance/CapacityCard';
import MonthCloseDialog from '../components/finance/MonthCloseDialog';

// ── Financat — owner dashboard ────────────────────────────────────────────────
// Rebuilt against the hifi design reference "Financat FivoCRM.dc.html".
//
// LAYOUT CONTRACT — what keeps this page legible as panels get added:
//   · ONE hero: the navy net-profit card, carrying its own P&L derivation.
//     Nothing else on the page is allowed to compete with it visually.
//   · Four KPI cards beside it, never more. A fifth measure becomes a panel
//     (hosting MRR rides on the forecast card and gets a line in Përmbledhje).
//   · Three tabs, one question each: what happened (Përmbledhje), where the
//     profit is (Fitimi: clients → service lines → capacity → responsible/trend),
//     what is broken (Rreziqet). Prose is folded into <Explain>; numbers
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
const isPickedMonth = (p: Period) => /^\d{4}-(0?\d|1[01])$/.test(p);

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
  // Logged hours — the base of every cost figure per client/project (laborAllocation.ts).
  const { data: timeEntries } = useCollection<TimeEntry>('timeEntries', { skipTeamFilter: true });
  const { data: monthCloses } = useCollection<FinanceMonthClose>('financeMonthCloses', { skipTeamFilter: true });
  // The service catalogue + invoice lines split ONE project across departments
  // (SEO + Ads on one engagement → each line to its own department; serviceMix.ts).
  const { data: services } = useCollection<Service>('services', { skipTeamFilter: true });
  const { data: invoiceItems } = useCollection<InvoiceItem>('invoiceItems', { skipTeamFilter: true });
  const tenantSettings = useTeamSettingsData();
  const { user } = useAuth();
  const closeMutation = useMutation<FinanceMonthClose>('financeMonthCloses');
  const { toast } = useToast();

  // "Now" ticks once a minute. Frozen at mount, a tab left open across midnight
  // (or month-end) kept reading yesterday's month: the hero, the trend, "Ky
  // muaj", the closable-month predicate and every overdue count went stale.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  // `?tab=clients&period=2026-8` — the day-2 report notification lands here.
  const [searchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') === 'clients' ? 'profit' : searchParams.get('tab');
  const [tab, setTab] = useState(initialTab && ['overview', 'profit', 'risk'].includes(initialTab) ? initialTab : 'overview');
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

    // Month-to-date means TO DATE: an expense entered today but dated the 30th
    // (prepaid rent) used to sit in the hero while its comparison base was
    // clamped to the same day last month — 30 days of outflow vs a few.
    const curEnd = cur.end > now ? now : cur.end;
    return {
      cur, prev, prev2,
      current: monthProfit(inv, exp, curPay, cur.start, curEnd),
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
      // …and cut its window at NOW like the hero does (`curEnd` in `snapshots`):
      // read to month-end, a prepaid expense dated the 30th sat in the trend's
      // last point but not in the headline, and the forecast segment — which is
      // anchored on that point — started from a number the page never showed.
      const end = i === 0 && w.end > now ? now : w.end;
      const p = monthProfit(inv, exp, pay, w.start, end);
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

  // ── Recurring-invoice health: which "repeats" failed to generate ──
  // Mirrors the cron's own generation guard (api/cron/run.ts runRecurringInvoices):
  // a PARENT recurring invoice should have spawned a child, but didn't.
  const recurringHealth = useMemo(() => {
    const inv = invoices || [];
    const nameById = new Map((customers || []).map(c => [c.id, c.name || 'Pa emër']));
    const projectById = new Map((projects || []).map(pr => [pr.id, pr]));
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).getTime();

    // Parents = originals that are (or were) a series. A series the cron switched
    // off for good (`recurringStoppedReason`) is listed too — it used to vanish
    // from this panel the moment it stopped, which is exactly when it matters.
    const parents = inv.filter(i => !(i as any).autoGenerated && (i.isRecurring === true || !!(i as any).recurringStoppedReason));
    const stuck: { id: string; name: string; amount: number; freq: string; daysOverdue: number }[] = [];
    const misconfigured: { id: string; name: string; amount: number; reason: string }[] = [];
    const stopped: { id: string; name: string; amount: number; reason: string }[] = [];
    let paused = 0;
    let healthy = 0;

    const REASON_LABEL: Partial<Record<InvoiceGenerationBlock, string>> = {
      'unsupported-frequency': 'pa frekuencë të mbështetur',
      'no-next-date': 'pa datën e radhës (nextRecurringDate)',
      'series-ended': 'seria mbaroi (repeat until)',
      'project-also-bills': 'projekti e faturon vetë — dyfishim',
    };

    for (const p of parents) {
      const amount = toAll(p.total ?? p.amount ?? 0, (p as any).currency);
      const name = p.customerId ? (nameById.get(p.customerId) || 'Pa klient') : 'Pa klient';
      if ((p as any).recurringStoppedReason && p.isRecurring !== true) {
        stopped.push({ id: p.id, name, amount, reason: String((p as any).recurringStoppedReason) });
        continue;
      }
      // The SAME predicate the cron runs (src/lib/finance/recurringInvoices.ts,
      // mirrored in api/cron/run.ts): `null` = due and not yet generated.
      const block = invoiceBillingBlockReason(p as any, now, p.projectId ? projectById.get(p.projectId) as any : null);
      if (block === 'paused') { paused++; continue; }
      if (block === 'not-due' || block === 'already-generated') { healthy++; continue; }
      if (block === 'unsupported-frequency' || block === 'no-next-date' || block === 'series-ended' || block === 'project-also-bills') {
        misconfigured.push({ id: p.id, name, amount, reason: REASON_LABEL[block] || block });
        continue;
      }
      if (block === null) {
        const nrd = parseDate(p.nextRecurringDate);
        const daysOverdue = nrd ? Math.max(0, Math.floor((startOfToday - nrd.getTime()) / 86_400_000)) : 0;
        // Due today is the cron's job, not an alarm; a day or more late is.
        if (daysOverdue === 0) { healthy++; continue; }
        stuck.push({ id: p.id, name, amount, freq: p.recurringFrequency || 'monthly', daysOverdue });
      }
    }

    stuck.sort((a, b) => b.daysOverdue - a.daysOverdue);
    return { stuck, misconfigured, stopped, paused, healthy, totalParents: parents.length };
  }, [invoices, customers, projects, now]);

  // ── ONE period + ONE revenue basis for every P&L breakdown ──
  // Rendered as one control row above the panels it scopes, never buried inside
  // a card that silently governs the cards below it.
  const [period, setPeriod] = useState<Period>(() => {
    const p = searchParams.get('period');
    return p && (p === 'month' || p === 'year' || p === 'all' || isPickedMonth(p)) ? p : 'year';
  });
  // ONE revenue basis for every P&L panel on the page:
  //   'earned'    — what the work of the period is worth (retainer fee × months;
  //                 fixed fee by hours done vs plan; legacy: completion month).
  //   'collected' — the cash that actually arrived in the period, per project.
  // The client table, the department table, the responsible table and the trend
  // all read the same toggle. Cash stays visible as its own columns either way.
  const [revenueBasis, setRevenueBasis] = useState<'earned' | 'collected'>('earned');
  /** The projectPnl/departmentPnl spelling of the same basis. */
  const pnlBasis: 'budget' | 'invoiced' = revenueBasis === 'collected' ? 'invoiced' : 'budget';

  // ONE concrete window for every engine (projectPnl, departmentPnl, allocateLabor,
  // clientProfitability), so hours, payroll, expenses and revenue are always cut
  // at the same two instants. "Ky muaj" ends NOW — a full month of payroll against
  // ten days of hours inflated every client's overhead until the 10th.
  const periodRange = useMemo((): { start: Date; end: Date } => {
    if (period === 'month') {
      const w = monthWindow(now, 0);
      return { start: w.start, end: w.end > now ? now : w.end };
    }
    if (isPickedMonth(period)) {
      const [y, m] = period.split('-').map(Number);
      return { start: new Date(y, m, 1, 0, 0, 0, 0), end: new Date(y, m + 1, 0, 23, 59, 59, 999) };
    }
    if (period === 'all') {
      // From the first thing the books know about — project, expense or invoice —
      // so no engine sees a cost the others were cut off from.
      let min = Infinity;
      for (const pr of projects || []) { const t = parseDate(pr.createdAt)?.getTime(); if (t && t < min) min = t; }
      for (const e of expenses || []) { const t = getExpenseDate(e)?.getTime(); if (t && t < min) min = t; }
      for (const i of invoices || []) { const t = (parseDate(i.invoiceDate) || parseDate(i.createdAt))?.getTime(); if (t && t < min) min = t; }
      return { start: Number.isFinite(min) ? new Date(min) : new Date(now.getFullYear(), 0, 1), end: now };
    }
    return { start: new Date(now.getFullYear(), 0, 1), end: now };
  }, [period, now, projects, expenses, invoices]);
  const periodOpts = useMemo((): ProjectPnlOptions => ({ range: periodRange, mode: 'all', now }), [periodRange, now]);

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

  /** `YYYY-MM` when the period is exactly one month — what "Mbyll muajin" locks. */
  const periodMonthKey = useMemo(() => {
    if (period === 'month') return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    if (isPickedMonth(period)) { const [y, m] = period.split('-').map(Number); return `${y}-${String(m + 1).padStart(2, '0')}`; }
    return null;
  }, [period, now]);

  // ── ONE labour allocation: hours × cost rate per project, unabsorbed payroll → overhead ──
  // Every engine below takes this object, so a project's labour is the same number on
  // every panel (client table, project P&L, department P&L). With no hours in the
  // period it says `basis: 'none'` and the engines fall back to their legacy split.
  const labor = useMemo(() => allocateLabor({
    timeEntries, members: teamMembers, expenses, period: periodRange,
    settings: tenantSettings?.financeSettings, rateCard: tenantSettings?.rateCard,
    clientProjectIds: new Set((projects || []).filter(p => !!p.customerId).map(p => p.id)),
  }), [timeEntries, teamMembers, expenses, periodRange, tenantSettings?.financeSettings, tenantSettings?.rateCard, projects]);

  // ── Per-project P&L (revenue − direct cost − allocated fixed overhead) ──
  // With logged hours: each project's own labour is direct cost and the pool is
  // shared by hours. Without: the legacy full-absorption model by revenue weight.
  const projectPnl = useMemo(
    () => computeProjectPnl(projects, teamMembers, expenses, { ...periodOpts, revenueBasis: pnlBasis, invoices, labor, timeEntries }),
    [projects, teamMembers, expenses, invoices, periodOpts, pnlBasis, labor, timeEntries],
  );

  // ── Per-client profitability: earned − labour − direct = gross; − overhead = net; cash apart ──
  const clientProfit = useMemo(() => computeClientProfitability({
    customers, projects, timeEntries, members: teamMembers, expenses, invoices, period: periodRange,
    settings: tenantSettings?.financeSettings, rateCard: tenantSettings?.rateCard, labor, revenueBasis,
  }), [customers, projects, timeEntries, teamMembers, expenses, invoices, periodRange, tenantSettings?.financeSettings, tenantSettings?.rateCard, labor, revenueBasis]);
  const capacity = useMemo(() => computeCapacity(labor, teamMembers, tenantSettings?.rateCard), [labor, teamMembers, tenantSettings?.rateCard]);
  const currentClose = useMemo(
    () => (periodMonthKey ? (monthCloses || []).find(c => c.periodKey === periodMonthKey) || null : null),
    [monthCloses, periodMonthKey],
  );
  const [closeOpen, setCloseOpen] = useState(false);
  const closeChecks = useMemo(() => monthCloseChecks(clientProfit), [clientProfit]);
  const businessIdForClose = ((teamMembers || []).find(m => (m as any).businessId) as any)?.businessId as string | undefined;
  const canCloseMonth = !!(permissions.isAdmin || permissions.isOwner) && !!businessIdForClose;
  // Only a month that has ENDED may be closed (src/lib/finance/monthClose.ts):
  // the running month's lock would freeze every timesheet for the rest of it
  // and sign off a partial table. The reason is shown on the button instead.
  const closeBlock = useMemo(() => monthCloseBlockReason(periodMonthKey, now), [periodMonthKey, now]);
  const confirmClose = useCallback(async (acknowledged: string[]) => {
    if (!periodMonthKey || !businessIdForClose) return;
    if (monthCloseBlockReason(periodMonthKey, new Date())) throw new Error('Muaji nuk ka mbaruar ende — mund të mbyllet pas fundit të muajit.');
    const patch = closeMonthPatch({
      businessId: businessIdForClose, periodKey: periodMonthKey, userId: user?.uid,
      snapshot: snapshotForClose(clientProfit), warnings: acknowledged,
    });
    const id = monthCloseId(businessIdForClose, periodMonthKey);
    // A month that was closed, reopened and is being closed AGAIN must keep its
    // `reopenedAt` / `reopenedByUserId`: `create` is a `setDoc` without merge and
    // wiped them (and the original `createdAt`), erasing the only evidence the
    // month had ever been reopened. The rules allow the update (periodKey pinned).
    if (currentClose) await closeMutation.update(currentClose.id || id, patch as any);
    else await closeMutation.create(patch as any, id);
  }, [periodMonthKey, businessIdForClose, closeMutation, user?.uid, clientProfit, currentClose]);
  // Admin/owner-only: unlock the month (timesheets become editable again). The
  // close record is UPDATED, never replaced — closedAt and the snapshot survive
  // as the audit trail, and a later re-close updates the same document.
  const [reopening, setReopening] = useState(false);
  const reopenMonth = useCallback(async () => {
    if (!currentClose || !canCloseMonth) return;
    if (!window.confirm(`Rihap ${periodLabel}? Orët e këtij muaji do të mund të ndryshohen përsëri; snapshot-i i mbylljes ruhet.`)) return;
    setReopening(true);
    try {
      await closeMutation.update(currentClose.id, reopenMonthPatch(user?.uid) as any);
      toast({ title: 'Muaji u rihap', description: 'Orët mund të ndryshohen përsëri. Mbylle sërish kur të jetë gati.' });
    } catch (err: any) {
      console.error('[Finances] reopen month failed:', err);
      toast({ title: 'Muaji nuk u rihap', description: `${err?.code ? `${err.code}: ` : ''}${err?.message || 'Nuk ke leje për këtë veprim ose ndodhi një gabim.'}`, variant: 'destructive' });
    } finally {
      setReopening(false);
    }
  }, [currentClose, canCloseMonth, periodLabel, closeMutation, user?.uid, toast]);
  // A LOCKED month shows the figures that were signed off, not the live ones —
  // the snapshot used to be write-only. The drift (live net − closed net) is
  // reported beside the pill: a non-zero drift means something dated inside the
  // closed month was written after the close, which the timesheet lock cannot stop.
  const frozenClientProfit = useMemo(
    () => (currentClose?.locked ? resultFromSnapshot(currentClose.snapshot, clientProfit) : null),
    [currentClose, clientProfit],
  );
  const closeDrift = useMemo(
    () => (currentClose?.locked ? snapshotNetDrift(currentClose.snapshot, clientProfit) : null),
    [currentClose, clientProfit],
  );

  // ── Collected cash, attributed to a department and a person ──
  // The accrual columns (budget/invoiced) say what was EARNED; this says what
  // actually arrived, over the same window. See lib/finance/revenueAttribution.ts.
  const collected = useMemo(
    () => attributeCollectedRevenue(invoices, projects, resolveCollectionWindow(periodOpts), { services, invoiceItems }),
    [invoices, projects, periodOpts, services, invoiceItems],
  );

  // ── Department (service-line) P&L — real profit per Social/SEO/Web… ──
  const [expandedDept, setExpandedDept] = useState<string | null>(null);
  const [showPnlHelp, setShowPnlHelp] = useState(false);
  const departmentPnl = useMemo(
    () => computeDepartmentPnl(projects, teamMembers, expenses, { ...periodOpts, revenueBasis: pnlBasis, invoices, teams, labor, timeEntries, services, invoiceItems }),
    [projects, teamMembers, expenses, invoices, periodOpts, pnlBasis, teams, labor, timeEntries, services, invoiceItems],
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
    () => buildDepartmentProfitTrend(projects, teamMembers, expenses, now, 6, {
      revenueBasis: pnlBasis, invoices, teams,
      // Hours per month, so the chart's September is the table's September.
      timeEntries, settings: tenantSettings?.financeSettings, rateCard: tenantSettings?.rateCard,
      services, invoiceItems,
    }),
    [projects, teamMembers, expenses, invoices, pnlBasis, now, teams, timeEntries, tenantSettings?.financeSettings, tenantSettings?.rateCard, services, invoiceItems],
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
    // The rows the project/department panels already computed — one engine run,
    // one set of numbers. A second `computeProjectPnl` here without `labor` gave
    // this table a different revenue AND cost for the same project.
    const map = new Map<string, StaffRow>();
    let unattributed = 0;
    for (const r of projectPnl.rows) {
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
        directCost: r.directCost - r.laborCost, overhead: r.overhead,
        ...(r.laborCost > 0 ? { labor: r.laborCost } : {}),
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
  }, [projectPnl, memberNameById, collected]);

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
  // ── ONE alarm list. Every item carries the window it was read on, because the
  // page mixes four: today (receivables, recurring), the hero month, the selected
  // period (clients) and next month (cash-flow). Before, the two halves lived in
  // two cards and the tab badge moved when the user changed the period elsewhere.
  const alarms = useMemo(() => {
    const items: { tag: string; text: string; tone: 'red' | 'amber'; scope: string }[] = [];
    if (receivables.overdueCount > 0) {
      items.push({
        tag: 'Vonesë', tone: 'red', scope: 'sot',
        text: `${receivables.overdueCount} ${receivables.overdueCount === 1 ? 'faturë e vonuar' : 'fatura të vonuara'} = ${formatALL(receivables.overdueAmount)} pa mbledhur.`,
      });
    }
    if (hero.profit < 0) {
      items.push({ tag: 'Humbje', tone: 'red', scope: hero.title, text: `Po humb para: ${formatALL(Math.abs(hero.profit))} (cash).` });
    }
    if (hero.profit >= 0 && hero.collected > 0 && hero.marginPct < 20) {
      items.push({ tag: 'Marzh', tone: 'amber', scope: hero.title, text: `Marzhi cash është vetëm ${hero.marginPct}% — nën 20%.` });
    }
    if (recurringHealth.stuck.length > 0) {
      items.push({
        tag: 'Recurring', tone: 'red', scope: 'sot',
        text: `${recurringHealth.stuck.length} ${recurringHealth.stuck.length === 1 ? 'faturë recurring nuk u gjenerua' : 'fatura recurring nuk u gjeneruan'} — automatizimi ngeci.`,
      });
    }
    if (recurringHealth.misconfigured.length > 0) {
      items.push({ tag: 'Config', tone: 'amber', scope: 'sot', text: `${recurringHealth.misconfigured.length} faturë recurring e konfiguruar keq — s'do gjenerohet kurrë.` });
    }
    const losing = clientProfit.rows.filter(r => r.netProfit < 0);
    for (const l of losing.slice(0, 5)) {
      items.push({ tag: 'Klient', tone: 'amber', scope: periodLabel, text: `"${l.name}" po humb para: ${formatALL(Math.round(l.netProfit))} neto.` });
    }
    if (losing.length > 5) items.push({ tag: 'Klient', tone: 'amber', scope: periodLabel, text: `+${losing.length - 5} klientë të tjerë me humbje — shiko tabelën te Fitimi.` });
    for (const a of cashflow.alarms) {
      items.push({
        tag: 'Cash-flow', tone: a.severity === 'red' ? 'red' : 'amber', scope: 'muaji tjetër',
        text: `${a.title}${a.id === 'concentration' && a.customerId ? ` — ${customerNameById.get(a.customerId) || 'klient'}` : ''}${a.amount != null ? ` (${formatALL(a.amount)})` : ''}. ${a.detail}`,
      });
    }
    return items;
  }, [receivables, hero, clientProfit, recurringHealth, periodLabel, cashflow, customerNameById]);

  // Badge on the "Rreziqet" tab — that tab holds everything broken.
  const riskCount = alarms.length;

  // One-line summary above the alarm list, so the card is readable folded.
  const alarmSummary = useMemo(() => {
    const bits: string[] = [];
    if (receivables.overdueCount > 0) {
      bits.push(`${receivables.overdueCount} fatura të vonuara (${formatALL(receivables.overdueAmount)})`);
    }
    if (recurringHealth.stuck.length > 0) bits.push(`${recurringHealth.stuck.length} recurring ngeci`);
    const losing = clientProfit.rows.filter(r => r.netProfit < 0).length;
    if (losing > 0) bits.push(`${losing} klientë në humbje (${periodLabel})`);
    if (cashflow.gap < 0) bits.push(`mungesë mujore ${formatALL(Math.abs(cashflow.gap))}`);
    return bits.join(' · ');
  }, [receivables, recurringHealth, clientProfit, cashflow, periodLabel]);

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
      ['Periudha e paneleve', periodLabel, 'Baza e të ardhurave', revenueBasis === 'collected' ? 'Arkëtuar' : 'Fituar', 'Kosto e punës', projectPnl.laborBasis === 'hours' ? 'orë × kosto/orë' : 'ndarje e pagës (pa orë)'],
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
      [`Klienti (${periodLabel})`, 'Të ardhura të fituara', 'Orë', 'Punë direkte', 'Kosto direkte', 'Fitimi bruto', 'Marzhi bruto %', 'Overhead', 'Fitimi neto', 'Faturuar', 'Arkëtuar', 'Pa arkëtuar'],
      ...clientProfit.rows.map(c => [
        c.name, Math.round(c.earned), Math.round(c.hours * 10) / 10, Math.round(c.directLabor), Math.round(c.directExpenses),
        Math.round(c.grossProfit), c.grossMarginPct == null ? '' : Math.round(c.grossMarginPct), Math.round(c.overhead),
        Math.round(c.netProfit), Math.round(c.invoiced), Math.round(c.collected), Math.round(c.outstanding),
      ]),
    ];
    const csv = rows
      .map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\r\n');
    // BOM so Excel opens Albanian diacritics correctly.
    // saveOrShareFile, not a blob <a download>: on native the anchor download is a
    // no-op, so this button did nothing at all in the Android app - no file, no error.
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    void saveOrShareFile(blob, `financat-${periodLabel.toLowerCase().replace(/[^a-z0-9ëç]+/gi, '-').replace(/^-+|-+$/g, '')}.csv`, {
      shareTitle: 'Financat - FivoCRM',
    });
  }, [hero, receivables, departmentRows, staffRevenue, clientProfit, periodLabel, revenueBasis, projectPnl.laborBasis]);

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
            sub={hostingFinance
              ? `faturat mujore + projektet · hosting MRR ${formatALL(hostingFinance.mrr)}`
              : 'faturat mujore + projektet'}
          />
          <KpiCard
            icon={<Percent className="h-4 w-4" />}
            iconBg="#e7f6ef"
            iconInk={GREEN}
            label="Marzhi i fitimit"
            value={`${hero.marginPct}%`}
            sub="mbi paranë e arkëtuar"
          />
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

        {/* ── Three questions, three tabs ── */}
        <Tabs value={tab} onValueChange={setTab} className="mt-6">
          <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto rounded-[14px] bg-[#e6ebf3] p-1 sm:w-fit">
            <PillTab value="overview">Përmbledhje</PillTab>
            <PillTab value="profit">Fitimi</PillTab>
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

              {hostingFinance && (
                <p className={cn('mt-3 border-t border-[#eef2f8] pt-3 text-xs', INK_MUTED)}>
                  Hosting & Domain-e: MRR <strong className={cn(NUM, INK_NAVY)}>{formatALL(hostingFinance.mrr)}</strong>
                  {' '}· {hostingFinance.active} llogari aktive · rinovime muajin tjetër {formatALL(hostingFinance.nextMonth)} ({hostingFinance.nextCount}).
                </p>
              )}
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
                options={[['earned', 'Fituar'], ['collected', 'Arkëtuar']] as const}
                size="sm"
              />

              <p className={cn('ml-auto text-xs font-semibold', INK_MUTED)}>
                {periodLabel} · {revenueBasis === 'collected' ? 'paraja e arkëtuar' : 'puna e fituar'}
                {' '}· orët nga <button type="button" className="underline" onClick={() => navigate('/app/timesheet')}>Orët</button>
              </p>
            </div>

            {/* The bridge between the two bases, so nobody has to flip the toggle to
                learn why the tables disagree with the hero. */}
            <p className={cn('px-1 text-[12px]', INK_MUTED)}>
              Fituar <strong className={cn(NUM, INK_NAVY)}>{formatALL(Math.round(clientProfit.revenueBasis === 'earned' ? clientProfit.totals.earned : clientProfit.totals.earned))}</strong>
              {' '}· arkëtuar në periudhë <strong className={cn(NUM, INK_NAVY)}>{formatALL(Math.round(clientProfit.totals.collected))}</strong>
              {clientProfit.totals.unbilledEarned > 0 && <> · punë e pafaturuar <strong className={cn(NUM, INK_WARN)}>{formatALL(Math.round(clientProfit.totals.unbilledEarned))}</strong></>}
              {' '}· hero-ja lart është cash i muajit, tabelat këtu janë {revenueBasis === 'collected' ? 'cash i periudhës' : 'puna e periudhës'}.
            </p>

            {/* ── Clients first: the owner's question is "sa fitoj nga çdo klient" ── */}
            <ClientProfitabilityPanel
              result={frozenClientProfit ?? clientProfit}
              periodLabel={periodLabel}
              monthKey={periodMonthKey}
              closeState={currentClose ? {
                locked: !!currentClose.locked,
                closedAt: parseDate(currentClose.closedAt),
                reopenedAt: parseDate(currentClose.reopenedAt),
                fromSnapshot: !!frozenClientProfit,
                liveNetDrift: closeDrift,
              } : null}
              canClose={canCloseMonth}
              closeBlock={closeBlock}
              onCloseMonth={() => setCloseOpen(true)}
              onReopenMonth={reopenMonth}
              reopening={reopening}
              onOpenCustomer={(id) => navigate(`/app/customers/${id}`)}
            />
            <MonthCloseDialog
              open={closeOpen}
              onClose={() => setCloseOpen(false)}
              periodLabel={periodLabel}
              checks={closeChecks}
              onConfirm={confirmClose}
            />

            {/* ── Departments (service lines) ── */}
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
                        {revenueBasis === 'collected'
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
                {departmentPnl.splitProjects > 0 && (
                  <div className="mt-2">
                    <Notice tone="neutral">
                      <strong>{departmentPnl.splitProjects} {departmentPnl.splitProjects === 1 ? 'projekt' : 'projekte'}</strong> me
                      disa shërbime u ndanë sipas shërbimit: secili departament merr pjesën e vet të
                      të ardhurave (sipas shërbimeve të faturës ose të projektit), orët e njerëzve të vet
                      dhe pjesën e vet të kostove. Pjesa shfaqet pas emrit të projektit (p.sh. «· 40%»).
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
                                // A project split across service lines shows here
                                // with only this department's share, so say so.
                                lines={d.projects.map(l => (l.share < 0.9995
                                  ? { ...l, name: `${l.name} · ${Math.round(l.share * 100)}%` }
                                  : l))}
                                indent="pl-[26px]"
                                basis={pnlBasis}
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

            {/* ── Team capacity — the same hours the P&L costs, as utilisation ── */}
            <CapacityCard capacity={capacity} periodLabel={periodLabel} bands={labor.settings.utilizationBands} />

            {/* Secondary cuts, folded: the same rows grouped by the person responsible,
                and the six-month trend per department. Same engine, same period, same basis. */}
            <Fold label="Sipas përgjegjësit dhe trendi i departamenteve">
              <div className="space-y-3.5 pt-3.5">
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
                                    basis={pnlBasis}
                                    // Here payroll is inside the shared fixed pool, not a
                                    // separate labour line — say so, or "fikse" reads as
                                    // rent only and the salary looks unaccounted for.
                                    overheadLabel={projectPnl.laborBasis === 'hours' ? 'fikse' : 'fikse+paga'}
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
                        Kolona <strong>Të ardhura</strong> = {revenueBasis === 'collected' ? 'paraja e arkëtuar për projektin' : 'puna e fituar (retainer: tarifa mujore; projekt fiks: sipas orëve ndaj planit)'}
                        {' '}brenda periudhës — ajo që u <em>fitua</em> (accrual). Ndjek toggle-in lart.
                      </p>
                      <p>
                        Rreshti i vogël <em>arkëtuar</em> = paraja që <em>hyri</em> realisht në të njëjtën
                        periudhë (cash), atribuar faturë → projekt → person/departament. Shfaqet vetëm kur
                        ndryshon nga kolona e të ardhurave: në bazën «Arkëtuar» të dyja janë e njëjta shifër.
                      </p>
                      <p>
                        Diferenca mes tyre është e pambledhur. Negative kur në këtë periudhë u arkëtua
                        para për punë të faturuar më parë — nuk është gabim.
                      </p>
                    </Explain>
                  </div>
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
                      <span className="min-w-0 flex-1 text-[13px] font-semibold text-[#24344d]">{a.text}</span>
                      <span className={cn('shrink-0 text-[10.5px] font-bold', INK_MUTED)}>{a.scope}</span>
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
                    {recurringHealth.stopped.length > 0 && (
                      <p className={cn('mt-2 text-xs', INK_MUTED)}>
                        {recurringHealth.stopped.length} seri u ndërprenë përgjithmonë nga automatizimi
                        ({Array.from(new Set(recurringHealth.stopped.map(x => x.reason))).join(', ')}) — {recurringHealth.stopped.slice(0, 3).map(x => x.name).join(', ')}
                        {recurringHealth.stopped.length > 3 ? '…' : ''}.
                      </p>
                    )}
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

                <p className={cn('mt-3 text-[11.5px]', INK_MUTED)}>
                  Alarmet e rrjedhës së parasë janë në listën lart, me shënimin «muaji tjetër».
                </p>
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
