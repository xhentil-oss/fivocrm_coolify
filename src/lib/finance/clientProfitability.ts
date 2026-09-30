/**
 * Per-client profitability — the table the owner opens on the 1st of the month.
 *
 *   Revenue Earned (recognised by work done)
 *   − pass-through (ad spend the client reimburses)          = Net revenue (AGI)
 *   − direct labour (logged hours × cost rate)
 *   − direct expenses (freelancers, production, tagged to the client's projects)
 *   = GROSS PROFIT  (the decision figure: 🟢 ≥55 % · 🟡 ≥40 % · 🔴 below)
 *   − overhead (rent, software, admin AND the payroll no client hour absorbed),
 *     shared by labour hours — the client that consumes the team carries it
 *   = NET PROFIT
 *
 * Cash is a separate column set (invoiced / collected / outstanding): a client can
 * be profitable and still not pay. Unbilled earned revenue (WIP) and deferred
 * revenue come from revenueRecognition.ts.
 *
 * The totals FOOT with Financat: Σ client net profit + unallocated overhead ==
 * earned − (payroll + other expenses of the period) − direct expenses of
 * projects with no client row, because labour comes from ONE allocation
 * (laborAllocation.ts) and EVERY lek of it is either on a client row or in the
 * overhead pool: unabsorbed payroll, hours with no project, hours on internal
 * or out-of-period projects (`laborOutsideRows`). Nothing is dropped.
 * With no logged hours in the period the result says `basis: 'none'` and the
 * table shows the estimate label — never a silent fallback.
 */
import type { Customer, Expense, Invoice, Project, TeamMember, TimeEntry } from '../../types';
import { toAll } from '../utils';
import {
  EXPENSE_CATEGORY_SALARY,
  expenseIsCountable,
  getExpenseDate,
  getInvoiceBilledBetween,
  getInvoiceCollectedBetween,
  getInvoiceOutstandingAll,
  isProjectDirectExpense,
} from './financialAnalytics';
import { allocateLabor, laborByProjectForEntries, laborOutsideRows, type LaborAllocation, type MemberLaborLine, type ProjectLabor } from './laborAllocation';
import type { RateCardRole } from './costRates';
import { projectEarnedInPeriod, projectWip, recognitionMethodOf, plannedHoursOf, type RecognitionMethod } from './revenueRecognition';
import { billingTypeOf } from './projectPeriod';
import { projectEac, planVsActual } from './projectBudget';
import {
  classifyClient,
  marginStatus,
  median,
  pct,
  resolveFinanceSettings,
  type ClientCategory,
  type FinanceSettings,
  type MarginStatus,
  type BudgetAlertLevel,
} from './profitabilityCore';

export interface ClientProjectLine {
  id: string;
  name: string;
  status: Project['status'];
  billingType: 'one-time' | 'monthly';
  method: RecognitionMethod;
  earned: number;
  laborCost: number;
  hours: number;
  directExpenses: number;
  passThrough: number;
  grossProfit: number;
  grossMarginPct: number | null;
  invoiced: number;
  collected: number;
  /** All-time work-in-progress, as of the period end. */
  unbilledEarned: number;
  deferred: number;
  /** Plan vs actual (one-time projects with a staffing plan). */
  plannedHours: number;
  consumedPct: number | null;
  alertLevel: BudgetAlertLevel;
  eacMarginPct: number | null;
  byRole: Record<string, { hours: number; cost: number }>;
  byMember: MemberLaborLine[];
}

export interface ClientRow {
  customerId: string;
  name: string;
  contractValue: number;
  earned: number;
  passThrough: number;
  netRevenue: number;
  directLabor: number;
  directExpenses: number;
  grossProfit: number;
  grossMarginPct: number | null;
  overhead: number;
  netProfit: number;
  netMarginPct: number | null;
  hours: number;
  /** Earned revenue per logged hour (ALL/h). */
  effectiveHourlyRevenue: number | null;
  invoiced: number;
  collected: number;
  /** Still owed, all-time. */
  outstanding: number;
  unbilledEarned: number;
  deferred: number;
  /** Invoiced in the period on invoices with no project — billed but not "earned" by any project. */
  unlinkedInvoiced: number;
  status: MarginStatus;
  category: ClientCategory;
  byRole: Record<string, { hours: number; cost: number }>;
  projects: ClientProjectLine[];
  /** Projects that crossed a budget threshold this period. */
  projectsOverBudget: number;
}

export interface ClientProfitabilityResult {
  period: { start: Date; end: Date };
  settings: FinanceSettings;
  rows: ClientRow[];
  totals: {
    contractValue: number;
    earned: number;
    passThrough: number;
    netRevenue: number;
    directLabor: number;
    directExpenses: number;
    grossProfit: number;
    grossMarginPct: number | null;
    overhead: number;
    netProfit: number;
    netMarginPct: number | null;
    hours: number;
    invoiced: number;
    collected: number;
    outstanding: number;
    unbilledEarned: number;
  };
  /** The company view: everything, including what no client carries. */
  company: {
    /** Non-project, non-salary expenses of the period. */
    otherFixed: number;
    /** Payroll of the period (payroll.ts) and what the client hours absorbed of it. */
    payroll: number;
    payrollBasis: 'recorded' | 'profile' | 'mixed' | 'none';
    absorbedLabor: number;
    unabsorbedLabor: number;
    overAbsorbedLabor: number;
    /** Labour on projects that have no client (internal work). Part of `laborOutsideRows`. */
    internalProjectLabor: number;
    /**
     * Labour NO client row carries: hours with no project + hours on projects
     * without a row (internal, out of period, unknown id). Pooled, never dropped.
     */
    laborOutsideRows: number;
    /** unabsorbed + laborOutsideRows — the labour share of `overheadPool`. */
    poolLabor: number;
    /**
     * Direct + pass-through expenses tagged to projects that have no client row
     * (internal projects). They are in the operating result but in no row and in
     * no pool — the one term the reconciliation sentence has to name.
     */
    directOutsideRows: number;
    /** otherFixed + poolLabor — what gets shared. */
    overheadPool: number;
    /** Pool that no client carried (no client hours at all, or revenue basis with no revenue). */
    unallocatedOverhead: number;
    /** earned − payroll − other expenses − direct expenses: the period's operating result. */
    operatingProfit: number;
    operatingMarginPct: number | null;
  };
  labor: LaborAllocation;
  basis: 'hours' | 'none';
  revenueBasis: 'earned' | 'collected';
  overheadBasis: FinanceSettings['overheadBasis'];
  warnings: {
    membersWithoutRate: string[];
    projectsWithoutPlan: string[];
    hoursWithoutProject: number;
    entriesWithoutMember: number;
    unlinkedInvoices: { count: number; amount: number };
    expensesWithoutProject: { count: number; amount: number };
    customersWithoutProjects: number;
  };
}

export interface ClientProfitabilityInput {
  customers: Customer[] | null | undefined;
  projects: Project[] | null | undefined;
  timeEntries: TimeEntry[] | null | undefined;
  members: TeamMember[] | null | undefined;
  expenses: Expense[] | null | undefined;
  invoices: Invoice[] | null | undefined;
  period: { start: Date; end: Date };
  settings?: Partial<FinanceSettings> | null;
  rateCard?: RateCardRole[] | null;
  /** Reuse an allocation already computed for the same period (one answer everywhere). */
  labor?: LaborAllocation | null;
  /**
   * 'earned' (default): revenue recognised by the work done in the period.
   * 'collected': money that actually arrived in the period, per project — the
   * same toggle the rest of Financat exposes, so the tabs stop disagreeing.
   */
  revenueBasis?: 'earned' | 'collected';
}

const NO_CLIENT = '__none__';

/** One label for a period's payroll source (payroll.ts reports it per month). */
export function periodPayrollBasis(p: { monthsRecorded: number; monthsProfile: number }): 'recorded' | 'profile' | 'mixed' | 'none' {
  if (p.monthsRecorded > 0 && p.monthsProfile > 0) return 'mixed';
  if (p.monthsRecorded > 0) return 'recorded';
  if (p.monthsProfile > 0) return 'profile';
  return 'none';
}

export function computeClientProfitability(input: ClientProfitabilityInput): ClientProfitabilityResult {
  const settings = resolveFinanceSettings(input.settings);
  const { start, end } = input.period;
  const collectedBasis = input.revenueBasis === 'collected';
  // No archived filter here: projectPnl / departmentPnl have none either, and a
  // project with nothing in the period (no earned, hours, expenses or invoices)
  // is skipped below anyway. Two engines with two membership rules gave two
  // different overhead shares for every OTHER project.
  const projects = input.projects || [];
  const clientProjectIds = new Set(projects.filter(p => !!p.customerId).map(p => p.id));
  const labor = input.labor && input.labor.period.start.getTime() === start.getTime() && input.labor.period.end.getTime() === end.getTime()
    ? input.labor
    : allocateLabor({
        timeEntries: input.timeEntries, members: input.members, expenses: input.expenses,
        period: input.period, settings, rateCard: input.rateCard, clientProjectIds,
      });
  const passCats = new Set(settings.passThroughExpenseCategories.map(c => c.toLowerCase()));
  const entries = input.timeEntries || [];
  const invoices = input.invoices || [];

  // ── Expenses of the period: project-direct (split pass-through), or shared ──
  const directByProject = new Map<string, { direct: number; passThrough: number }>();
  // All-time direct expenses per project up to the period end, for the EAC
  // (the plan is for the whole engagement, not for a month). Pass-through
  // categories are out, as in the period figure.
  const directAllTimeByProject = new Map<string, number>();
  let otherFixed = 0;
  const expensesWithoutProject = { count: 0, amount: 0 };
  const projectIds = new Set(projects.map(p => p.id));
  const isPassThrough = (e: Expense) => passCats.has((e.category || '').toLowerCase());
  for (const e of input.expenses || []) {
    if (!expenseIsCountable(e)) continue;
    if (e.category === EXPENSE_CATEGORY_SALARY) continue;
    const d = getExpenseDate(e);
    if (!d || d > end) continue;
    const amt = toAll(e.amount || 0, e.currency);
    if (isProjectDirectExpense(e) && e.projectId && projectIds.has(e.projectId) && !isPassThrough(e)) {
      directAllTimeByProject.set(e.projectId, (directAllTimeByProject.get(e.projectId) || 0) + amt);
    }
    if (d < start) continue;
    if (e.projectId && projectIds.has(e.projectId)) {
      const cur = directByProject.get(e.projectId) || { direct: 0, passThrough: 0 };
      if (isPassThrough(e)) cur.passThrough += amt; else cur.direct += amt;
      directByProject.set(e.projectId, cur);
    } else {
      otherFixed += amt;
      expensesWithoutProject.count += 1; expensesWithoutProject.amount += amt;
    }
  }

  // ── All-time labour per project, as of the period end: the same rates as the
  // period allocation, over EVERY entry (`entryHours` semantics: open timers
  // skipped, duration or start/end). Plan vs actual, the budget alert and the
  // EAC compare against a plan made for the whole engagement, so feeding them
  // the period slice made a 90 %-consumed project read as 10 % in a quiet month
  // and a month with no hours but one invoice read as a 99 % EAC margin.
  const allTimeLabor = laborByProjectForEntries(entries, input.members, settings, input.rateCard, end);
  const emptyLabor = (id: string): ProjectLabor => ({ projectId: id, hours: 0, cost: 0, byMember: [], byRole: {} });

  // ── Invoices: per project (billed / collected in period) + unlinked per customer ──
  const invByProject = new Map<string, { invoiced: number; collected: number }>();
  const unlinkedByCustomer = new Map<string, number>();
  const unlinkedCollectedByCustomer = new Map<string, number>();
  const unlinkedInvoices = { count: 0, amount: 0 };
  const outstandingByCustomer = new Map<string, number>();
  let collectedAll = 0;
  for (const inv of invoices) {
    if (inv.status === 'Draft' || inv.status === 'Cancelled') continue;
    const billed = getInvoiceBilledBetween(inv, start, end);
    const collected = getInvoiceCollectedBetween(inv, start, end);
    collectedAll += collected;
    if (inv.customerId) outstandingByCustomer.set(inv.customerId, (outstandingByCustomer.get(inv.customerId) || 0) + getInvoiceOutstandingAll(inv));
    if (inv.projectId && projectIds.has(inv.projectId)) {
      const cur = invByProject.get(inv.projectId) || { invoiced: 0, collected: 0 };
      cur.invoiced += billed; cur.collected += collected;
      invByProject.set(inv.projectId, cur);
    } else {
      const key = inv.customerId || NO_CLIENT;
      if (billed > 0) {
        unlinkedInvoices.count += 1; unlinkedInvoices.amount += billed;
        unlinkedByCustomer.set(key, (unlinkedByCustomer.get(key) || 0) + billed);
      }
      if (collected > 0) unlinkedCollectedByCustomer.set(key, (unlinkedCollectedByCustomer.get(key) || 0) + collected);
    }
  }

  // ── Project lines ──
  const projectsWithoutPlan: string[] = [];
  const lines = new Map<string, ClientProjectLine[]>();
  const rowProjectIds = new Set<string>();
  let internalProjectLabor = 0;
  for (const p of projects) {
    const pl = labor.byProject.get(p.id);
    const dx = directByProject.get(p.id) || { direct: 0, passThrough: 0 };
    const iv = invByProject.get(p.id) || { invoiced: 0, collected: 0 };
    const earned = collectedBasis ? iv.collected : projectEarnedInPeriod(p, entries, input.period);
    const hours = pl?.hours || 0;
    const laborCost = pl?.cost || 0;
    if (!p.customerId) { internalProjectLabor += laborCost; continue; }
    if (earned === 0 && hours === 0 && dx.direct === 0 && dx.passThrough === 0 && iv.invoiced === 0 && iv.collected === 0) continue;
    rowProjectIds.add(p.id);
    const bt = billingTypeOf(p);
    const plannedHours = plannedHoursOf(p);
    if (bt === 'one-time' && hours > 0 && plannedHours === 0) projectsWithoutPlan.push(p.name);
    // Cumulative view for the plan: all-time hours × the real rates (never a
    // rate guessed from the period slice) and all-time direct expenses — the
    // same figures the `project-spend-rollup` cron alerts on.
    const allLabor = allTimeLabor.get(p.id) || emptyLabor(p.id);
    const pva = planVsActual(p, allLabor, settings);
    const eac = bt === 'one-time' && plannedHours > 0
      ? projectEac(p, { hours: allLabor.hours, cost: allLabor.cost }, directAllTimeByProject.get(p.id) || 0, settings)
      : null;
    const wip = projectWip(p, entries, invoices, end);
    const grossProfit = earned - dx.passThrough - laborCost - dx.direct;
    const line: ClientProjectLine = {
      id: p.id, name: p.name, status: p.status, billingType: bt, method: recognitionMethodOf(p),
      earned, laborCost, hours, directExpenses: dx.direct, passThrough: dx.passThrough,
      grossProfit, grossMarginPct: pct(grossProfit, earned - dx.passThrough),
      invoiced: iv.invoiced, collected: iv.collected,
      unbilledEarned: wip.unbilledEarned, deferred: wip.deferred,
      plannedHours, consumedPct: pva.consumedPct, alertLevel: pva.level,
      eacMarginPct: eac ? eac.expectedMarginPct : null,
      byRole: pl?.byRole || {}, byMember: pl?.byMember || [],
    };
    const arr = lines.get(p.customerId) || [];
    arr.push(line); lines.set(p.customerId, arr);
  }

  // ── Client rows (before overhead) ──
  const nameById = new Map((input.customers || []).map(c => [c.id, c.name || c.company || 'Pa emër']));
  const customerIds = new Set<string>([...lines.keys(), ...unlinkedByCustomer.keys(), ...unlinkedCollectedByCustomer.keys()].filter(k => k !== NO_CLIENT));
  const rows: ClientRow[] = [];
  for (const cid of customerIds) {
    const ls = (lines.get(cid) || []).sort((a, b) => b.earned - a.earned);
    const sum = (f: (l: ClientProjectLine) => number) => ls.reduce((s, l) => s + f(l), 0);
    // On the collected basis, cash on an invoice with no project is still this
    // client's revenue (it is in the hero's "Para që hyri"); on the earned basis no
    // project earned it, so it stays an `unlinkedInvoiced` note.
    const earned = sum(l => l.earned) + (collectedBasis ? (unlinkedCollectedByCustomer.get(cid) || 0) : 0);
    const passThrough = sum(l => l.passThrough);
    const netRevenue = earned - passThrough;
    const directLabor = sum(l => l.laborCost);
    const directExpenses = sum(l => l.directExpenses);
    const grossProfit = netRevenue - directLabor - directExpenses;
    const hours = sum(l => l.hours);
    const byRole: Record<string, { hours: number; cost: number }> = {};
    for (const l of ls) for (const [role, v] of Object.entries(l.byRole)) {
      const cur = byRole[role] || { hours: 0, cost: 0 };
      cur.hours += v.hours; cur.cost += v.cost; byRole[role] = cur;
    }
    const contractValue = ls.reduce((s, l) => {
      const p = projects.find(x => x.id === l.id);
      return s + (p ? toAll(p.budget || 0, p.currency) : 0);
    }, 0);
    rows.push({
      customerId: cid, name: nameById.get(cid) || 'Klient i panjohur',
      contractValue, earned, passThrough, netRevenue, directLabor, directExpenses,
      grossProfit, grossMarginPct: pct(grossProfit, netRevenue),
      overhead: 0, netProfit: grossProfit, netMarginPct: null,
      hours, effectiveHourlyRevenue: hours > 0 ? netRevenue / hours : null,
      invoiced: sum(l => l.invoiced) + (unlinkedByCustomer.get(cid) || 0),
      collected: sum(l => l.collected),
      outstanding: outstandingByCustomer.get(cid) || 0,
      unbilledEarned: sum(l => l.unbilledEarned), deferred: sum(l => l.deferred),
      unlinkedInvoiced: unlinkedByCustomer.get(cid) || 0,
      status: 'none', category: null, byRole, projects: ls,
      projectsOverBudget: ls.filter(l => l.alertLevel !== 'ok').length,
    });
  }

  // ── Overhead: other fixed + every lek of payroll no client row carries, shared by labour hours (or revenue) ──
  // `unabsorbed` is the payroll nobody logged; `laborOutsideRows` is the labour
  // that WAS logged but on no client row — no project, an internal project, a
  // project outside the period. Both are real cost of the period; pooling only
  // the first left the second in no row and no pool.
  const outside = laborOutsideRows(labor, rowProjectIds);
  const poolLabor = Math.max(0, labor.unabsorbed) + outside.total;
  const overheadPool = otherFixed + poolLabor;
  const totalHours = rows.reduce((s, r) => s + r.hours, 0);
  const totalNetRevenue = rows.reduce((s, r) => s + Math.max(0, r.netRevenue), 0);
  const useHours = settings.overheadBasis === 'labor-hours' && totalHours > 0;
  const useRevenue = !useHours && totalNetRevenue > 0;
  let allocated = 0;
  for (const r of rows) {
    const w = useHours ? r.hours / totalHours : useRevenue ? Math.max(0, r.netRevenue) / totalNetRevenue : 0;
    r.overhead = overheadPool * w;
    allocated += r.overhead;
    r.netProfit = r.grossProfit - r.overhead;
    r.netMarginPct = pct(r.netProfit, r.netRevenue);
    r.status = marginStatus(r.grossMarginPct, settings.marginThresholds);
  }
  const med = median(rows.map(r => r.effectiveHourlyRevenue).filter((x): x is number => x != null));
  for (const r of rows) r.category = classifyClient(r.grossMarginPct, r.effectiveHourlyRevenue, med, settings.marginThresholds);
  rows.sort((a, b) => b.netProfit - a.netProfit);

  const T = (f: (r: ClientRow) => number) => rows.reduce((s, r) => s + f(r), 0);
  const totals = {
    contractValue: T(r => r.contractValue), earned: T(r => r.earned), passThrough: T(r => r.passThrough),
    netRevenue: T(r => r.netRevenue), directLabor: T(r => r.directLabor), directExpenses: T(r => r.directExpenses),
    grossProfit: T(r => r.grossProfit), grossMarginPct: null as number | null,
    overhead: T(r => r.overhead), netProfit: T(r => r.netProfit), netMarginPct: null as number | null,
    hours: totalHours, invoiced: T(r => r.invoiced), collected: T(r => r.collected),
    outstanding: T(r => r.outstanding), unbilledEarned: T(r => r.unbilledEarned),
  };
  totals.grossMarginPct = pct(totals.grossProfit, totals.netRevenue);
  totals.netMarginPct = pct(totals.netProfit, totals.netRevenue);

  // Operating result of the period, company-wide: earned − pass-through − every
  // cost of the period (payroll + other expenses + project-direct expenses).
  const allDirect = Array.from(directByProject.values()).reduce((s, v) => s + v.direct, 0);
  const allPass = Array.from(directByProject.values()).reduce((s, v) => s + v.passThrough, 0);
  // Direct/pass-through money on projects with no client row (internal work):
  // in the operating result, in no row, in no pool — named so the
  // reconciliation can state it instead of silently not adding up.
  const directOutsideRows = allDirect + allPass - totals.directExpenses - totals.passThrough;
  // Company revenue: on the collected basis every lek that arrived (the hero's
  // "Para që hyri"); on the earned basis the clients' earned revenue — an
  // internal project's `budget` is never money a client will pay, so it is out.
  const allEarned = collectedBasis ? collectedAll : totals.earned;
  const operatingProfit = allEarned - allPass - labor.payroll.total - otherFixed - allDirect;

  return {
    period: input.period,
    settings,
    rows,
    totals,
    company: {
      otherFixed,
      payroll: labor.payroll.total,
      payrollBasis: periodPayrollBasis(labor.payroll),
      absorbedLabor: labor.absorbed,
      unabsorbedLabor: labor.unabsorbed,
      overAbsorbedLabor: labor.overAbsorbed,
      internalProjectLabor,
      laborOutsideRows: outside.total,
      poolLabor,
      directOutsideRows: Math.max(0, directOutsideRows),
      overheadPool,
      unallocatedOverhead: Math.max(0, overheadPool - allocated),
      operatingProfit,
      operatingMarginPct: pct(operatingProfit, allEarned - allPass),
    },
    labor,
    basis: labor.basis,
    revenueBasis: collectedBasis ? 'collected' : 'earned',
    overheadBasis: settings.overheadBasis,
    warnings: {
      membersWithoutRate: labor.membersWithoutRate,
      projectsWithoutPlan,
      hoursWithoutProject: labor.internal.hours,
      entriesWithoutMember: labor.entriesWithoutMember,
      unlinkedInvoices,
      expensesWithoutProject,
      customersWithoutProjects: Array.from(unlinkedByCustomer.keys()).filter(k => k !== NO_CLIENT && !lines.has(k)).length,
    },
  };
}

/** The same table for ONE client (Customer360). */
export function clientRowFor(result: ClientProfitabilityResult, customerId: string): ClientRow | null {
  return result.rows.find(r => r.customerId === customerId) || null;
}

/** A compact copy for `financeMonthCloses.snapshot` — numbers only, no Maps. */
export function snapshotForClose(result: ClientProfitabilityResult) {
  const round = (n: number) => Math.round(n);
  return {
    basis: result.basis,
    overheadBasis: result.overheadBasis,
    totals: Object.fromEntries(Object.entries(result.totals).map(([k, v]) => [k, v == null ? null : round(v)])),
    company: {
      otherFixed: round(result.company.otherFixed), payroll: round(result.company.payroll), payrollBasis: result.company.payrollBasis,
      unabsorbedLabor: round(result.company.unabsorbedLabor), laborOutsideRows: round(result.company.laborOutsideRows),
      poolLabor: round(result.company.poolLabor), overheadPool: round(result.company.overheadPool),
      operatingProfit: round(result.company.operatingProfit),
    },
    clients: result.rows.map(r => ({
      customerId: r.customerId, name: r.name, earned: round(r.earned), directLabor: round(r.directLabor),
      directExpenses: round(r.directExpenses), grossProfit: round(r.grossProfit), overhead: round(r.overhead),
      netProfit: round(r.netProfit), hours: Math.round(r.hours * 10) / 10, invoiced: round(r.invoiced),
      collected: round(r.collected), outstanding: round(r.outstanding), category: r.category, status: r.status,
    })),
    warnings: result.warnings,
  };
}

/** Pre-close checklist: what is still missing before the month can honestly be closed. */
export function monthCloseChecks(result: ClientProfitabilityResult): string[] {
  const w = result.warnings;
  const out: string[] = [];
  if (result.basis === 'none') out.push('Asnjë orë e regjistruar në këtë muaj — tabela është vlerësim.');
  if (w.membersWithoutRate.length) out.push(`Pa kosto/orë: ${w.membersWithoutRate.join(', ')} (vendos pagën ose tarifën).`);
  if (w.projectsWithoutPlan.length) out.push(`Projekte pa buxhet orësh: ${w.projectsWithoutPlan.slice(0, 5).join(', ')}${w.projectsWithoutPlan.length > 5 ? '…' : ''}.`);
  if (w.hoursWithoutProject > 0) out.push(`${Math.round(w.hoursWithoutProject)} orë pa projekt (kosto e brendshme, në overhead).`);
  if (w.unlinkedInvoices.count) out.push(`${w.unlinkedInvoices.count} fatura pa projekt (${Math.round(w.unlinkedInvoices.amount).toLocaleString()} L).`);
  if (result.company.overAbsorbedLabor > 0) out.push(`Orët × tarifat e kalojnë pagën reale me ${Math.round(result.company.overAbsorbedLabor).toLocaleString()} L — kontrollo tarifat/kapacitetin.`);
  if (result.company.payrollBasis === 'profile') out.push('Pagat e këtij muaji janë nga plani, jo nga pagesa të regjistruara.');
  return out;
}
