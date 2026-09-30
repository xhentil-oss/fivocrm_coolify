import { zonedParts } from '../recurringUtils';
import type { ClientProfitabilityResult, ClientRow } from './clientProfitability';

/**
 * Month close — the pure half of "Mbyll muajin" / "Rihap muajin".
 *
 * A close is a LOCK (the rules refuse every timeEntries write inside the month
 * from then on) plus a SNAPSHOT of the client table. Both only make sense for a
 * month that has ended: closing on the 10th froze every timesheet for the rest
 * of the month and signed off a table built on a third of the hours. So the
 * predicate lives here, is read in the business zone (Europe/Tirane — the same
 * calendar the rules and `timeEntries.date` use) and is unit-tested.
 *
 * The snapshot written by `snapshotForClose` (clientProfitability.ts) used to be
 * write-only. `resultFromSnapshot` turns it back into the shape the client table
 * renders, so a locked month shows the figures that were signed off, and
 * `snapshotNetDrift` says by how much the live numbers have moved since.
 */

/** `YYYY-MM` of an instant, read in the recurrence/business zone. */
export function monthKeyOf(at: Date): string {
  const p = zonedParts(at);
  return `${p.year}-${String(p.month + 1).padStart(2, '0')}`;
}

export type MonthCloseBlock = 'invalid-key' | 'running-month' | 'future-month';

export const MONTH_CLOSE_BLOCK_LABELS: Record<MonthCloseBlock, string> = {
  'invalid-key': 'Periudha nuk është një muaj i vetëm',
  'running-month': 'Mund të mbyllet pas fundit të muajit',
  'future-month': 'Muaji nuk ka filluar ende',
};

/**
 * Why `monthKey` cannot be closed right now — `null` means it can.
 * A month is closable only once it has ENDED: its key sorts strictly before the
 * current month's. Keys are zero-padded `YYYY-MM`, so string order is date order.
 */
export function monthCloseBlockReason(monthKey: string | null | undefined, now: Date): MonthCloseBlock | null {
  if (!monthKey || !/^\d{4}-\d{2}$/.test(monthKey)) return 'invalid-key';
  const current = monthKeyOf(now);
  if (monthKey < current) return null;
  if (monthKey === current) return 'running-month';
  return 'future-month';
}

export function isMonthClosable(monthKey: string | null | undefined, now: Date): boolean {
  return monthCloseBlockReason(monthKey, now) === null;
}

// ── Close / reopen patches ──

export interface CloseMonthPatchInput {
  businessId: string;
  periodKey: string;
  userId: string | null | undefined;
  snapshot: Record<string, unknown>;
  warnings: string[];
  at?: Date;
}

/**
 * Fields a close writes. The same patch serves a first close (create) and a
 * re-close after a reopen (update): `reopenedAt` / `reopenedByUserId` are NOT in
 * it, so an update keeps the audit trail of the reopen — the old `setDoc` without
 * merge wiped them, and with them the only record that the month had been
 * reopened at all.
 */
export function closeMonthPatch(input: CloseMonthPatchInput) {
  return {
    businessId: input.businessId,
    periodKey: input.periodKey,
    locked: true as const,
    closedAt: input.at ?? new Date(),
    closedByUserId: input.userId ?? null,
    snapshot: input.snapshot,
    warnings: input.warnings,
  };
}

/** Fields a reopen writes — `closedAt` and `snapshot` stay, so history survives. */
export function reopenMonthPatch(userId: string | null | undefined, at: Date = new Date()) {
  return {
    locked: false as const,
    reopenedAt: at,
    reopenedByUserId: userId ?? null,
  };
}

// ── Reading the snapshot back ──

export interface SnapshotClient {
  customerId: string;
  name: string;
  earned: number;
  directLabor: number;
  directExpenses: number;
  grossProfit: number;
  overhead: number;
  netProfit: number;
  hours: number;
  invoiced: number;
  collected: number;
  outstanding: number;
  category: ClientRow['category'];
  status: ClientRow['status'];
}

export interface CloseSnapshot {
  basis: ClientProfitabilityResult['basis'];
  overheadBasis: ClientProfitabilityResult['overheadBasis'] | undefined;
  totals: Partial<ClientProfitabilityResult['totals']>;
  company: Partial<ClientProfitabilityResult['company']>;
  clients: SnapshotClient[];
  warnings: ClientProfitabilityResult['warnings'] | undefined;
}

const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Parse a stored `snapshot` (unknown JSON) into a typed view; `null` when it is not one. */
export function readCloseSnapshot(raw: unknown): CloseSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  const totalsRaw = (s.totals && typeof s.totals === 'object' ? s.totals : {}) as Record<string, unknown>;
  const companyRaw = (s.company && typeof s.company === 'object' ? s.company : {}) as Record<string, unknown>;
  const clientsRaw = Array.isArray(s.clients) ? s.clients : [];
  if (!Array.isArray(s.clients) && !s.totals) return null;

  const totals: Partial<ClientProfitabilityResult['totals']> = {};
  for (const [k, v] of Object.entries(totalsRaw)) {
    if (k === 'grossMarginPct' || k === 'netMarginPct') (totals as any)[k] = numOrNull(v);
    else if (typeof v === 'number') (totals as any)[k] = v;
  }
  const company: Partial<ClientProfitabilityResult['company']> = {};
  for (const [k, v] of Object.entries(companyRaw)) {
    if (k === 'payrollBasis') { if (typeof v === 'string') (company as any)[k] = v; }
    else if (typeof v === 'number') (company as any)[k] = v;
  }
  const clients: SnapshotClient[] = clientsRaw
    .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
    .map(c => ({
      customerId: String(c.customerId ?? ''),
      name: String(c.name ?? 'Pa emër'),
      earned: num(c.earned), directLabor: num(c.directLabor), directExpenses: num(c.directExpenses),
      grossProfit: num(c.grossProfit), overhead: num(c.overhead), netProfit: num(c.netProfit),
      hours: num(c.hours), invoiced: num(c.invoiced), collected: num(c.collected), outstanding: num(c.outstanding),
      category: (c.category ?? null) as ClientRow['category'],
      status: (typeof c.status === 'string' ? c.status : 'none') as ClientRow['status'],
    }));
  return {
    basis: s.basis === 'hours' ? 'hours' : 'none',
    overheadBasis: typeof s.overheadBasis === 'string' ? (s.overheadBasis as ClientProfitabilityResult['overheadBasis']) : undefined,
    totals,
    company,
    clients,
    warnings: s.warnings && typeof s.warnings === 'object' ? (s.warnings as ClientProfitabilityResult['warnings']) : undefined,
  };
}

const pct = (part: number, whole: number): number | null => (whole > 0 ? (part / whole) * 100 : null);

/**
 * The client table AS IT WAS CLOSED, in the shape the panel renders.
 *
 * Only what the snapshot holds is frozen: rows and totals. Per-project detail,
 * labour by role and the settings are not in it (it is a compact copy), so the
 * rows carry empty `projects` / `byRole` and the live settings/company fill the
 * rest. Every figure the table prints — earned, hours, direct cost, gross, GM,
 * overhead, net, L/h, invoiced, collected, outstanding — comes from the snapshot.
 */
export function resultFromSnapshot(raw: unknown, live: ClientProfitabilityResult): ClientProfitabilityResult | null {
  const snap = readCloseSnapshot(raw);
  if (!snap) return null;
  const rows: ClientRow[] = snap.clients.map(c => {
    const netRevenue = c.earned; // pass-through is not in the snapshot
    return {
      customerId: c.customerId, name: c.name, contractValue: 0,
      earned: c.earned, passThrough: 0, netRevenue,
      directLabor: c.directLabor, directExpenses: c.directExpenses,
      grossProfit: c.grossProfit, grossMarginPct: pct(c.grossProfit, netRevenue),
      overhead: c.overhead, netProfit: c.netProfit, netMarginPct: pct(c.netProfit, netRevenue),
      hours: c.hours, effectiveHourlyRevenue: c.hours > 0 ? netRevenue / c.hours : null,
      invoiced: c.invoiced, collected: c.collected, outstanding: c.outstanding,
      unbilledEarned: 0, deferred: 0, unlinkedInvoiced: 0,
      status: c.status, category: c.category, byRole: {}, projects: [], projectsOverBudget: 0,
    };
  });
  const sum = (k: keyof SnapshotClient) => rows.reduce((s, r) => s + num((r as any)[k]), 0);
  const t = snap.totals;
  const earned = t.earned ?? sum('earned');
  const netRevenue = t.netRevenue ?? earned - (t.passThrough ?? 0);
  const grossProfit = t.grossProfit ?? sum('grossProfit');
  const netProfit = t.netProfit ?? sum('netProfit');
  const totals: ClientProfitabilityResult['totals'] = {
    contractValue: t.contractValue ?? 0,
    earned,
    passThrough: t.passThrough ?? 0,
    netRevenue,
    directLabor: t.directLabor ?? sum('directLabor'),
    directExpenses: t.directExpenses ?? sum('directExpenses'),
    grossProfit,
    grossMarginPct: t.grossMarginPct === undefined ? pct(grossProfit, netRevenue) : t.grossMarginPct,
    overhead: t.overhead ?? sum('overhead'),
    netProfit,
    netMarginPct: t.netMarginPct === undefined ? pct(netProfit, netRevenue) : t.netMarginPct,
    hours: t.hours ?? sum('hours'),
    invoiced: t.invoiced ?? sum('invoiced'),
    collected: t.collected ?? sum('collected'),
    outstanding: t.outstanding ?? sum('outstanding'),
    unbilledEarned: t.unbilledEarned ?? 0,
  };
  return {
    ...live,
    rows,
    totals,
    company: { ...live.company, ...snap.company },
    basis: snap.basis,
    overheadBasis: snap.overheadBasis ?? live.overheadBasis,
    warnings: snap.warnings ?? live.warnings,
  };
}

/**
 * Live net total − closed net total, rounded. `null` when the snapshot has no
 * net figure (nothing to compare against). A non-zero drift means something
 * dated inside the closed month was written after the close — an expense, an
 * invoice payment, a salary row — which the lock on `timeEntries` cannot stop.
 */
export function snapshotNetDrift(raw: unknown, live: Pick<ClientProfitabilityResult, 'totals'>): number | null {
  const snap = readCloseSnapshot(raw);
  if (!snap) return null;
  const closedNet = snap.totals.netProfit ?? (snap.clients.length ? snap.clients.reduce((s, c) => s + c.netProfit, 0) : null);
  if (closedNet == null) return null;
  return Math.round(live.totals.netProfit) - Math.round(closedNet);
}
