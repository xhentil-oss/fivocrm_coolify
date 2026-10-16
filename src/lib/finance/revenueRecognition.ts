/**
 * How much of a project has been EARNED by a date — Contract Value ≠ Revenue
 * Earned ≠ Invoiced ≠ Cash Collected, and this module owns the second one.
 *
 *   monthly        fee × months active (retainers — the projectPnl rule, reused)
 *   effort         contract × hours to date / hours at completion  (percentage of completion)
 *   straight-line  contract × elapsed share of startDate..endDate
 *   on-completion  the whole fee in the month the project was Completed (legacy)
 *
 * The method a project USES is `effectiveRecognitionMethod`: what it declares,
 * degraded to what its data can support. The math itself lives in
 * profitabilityCore.ts (mirrored for the cron); this file only turns Projects,
 * TimeEntries and Invoices into the numbers the core needs.
 */
import type { Project, TimeEntry, Invoice } from '../../types';
import { toAll } from '../utils';
import { parseDate, getInvoiceBilledBetween, getInvoiceCollectedBetween } from './financialAnalytics';
import { entryHours, entryDayKey, entryInstantMs } from './timeEntries';
import { billingTypeOf, retainerRevenueInPeriod, monthsBetween, monthlyFeeOf } from './projectPeriod';
import {
  earnedCumulative,
  earnedInPeriod,
  effectiveRecognitionMethod,
  type RecognitionFacts,
  type RecognitionMethod,
} from './profitabilityCore';

export type { RecognitionMethod };

/** The method the project DECLARES (or implies), before data availability is checked. */
export function declaredRecognitionMethod(p: Project): RecognitionMethod {
  if (billingTypeOf(p) === 'monthly') return 'monthly';
  const m = p.recognitionMethod;
  if (m === 'effort' || m === 'straight-line' || m === 'on-completion') return m;
  // Unset: the richest method the data supports.
  if ((p.plannedHours || 0) > 0 || (p.plannedRoles || []).some(r => (r.plannedHours || 0) > 0)) return 'effort';
  if (parseDate(p.startDate) && parseDate(p.endDate)) return 'straight-line';
  return 'on-completion';
}

export function plannedHoursOf(p: Project): number {
  if (p.plannedHours && p.plannedHours > 0) return p.plannedHours;
  return (p.plannedRoles || []).reduce((s, r) => s + (Number(r.plannedHours) || 0), 0);
}

/**
 * A retainer's fee PER MONTH in ALL. `budget` is per billing cycle and the Part 2
 * cron bills it every WEEK for a weekly retainer (see `monthlyFeeOf`).
 */
export function monthlyFeeAll(p: Project): number {
  return toAll(monthlyFeeOf(p), p.currency);
}

/** Everything the core needs about a project, in ALL and milliseconds. */
export function recognitionFacts(p: Project): RecognitionFacts {
  const completed = p.status === 'Completed' ? (parseDate(p.lastCompletedAt) || parseDate(p.updatedAt)) : null;
  return {
    contractValue: toAll(p.budget || 0, p.currency),
    method: declaredRecognitionMethod(p),
    startMs: parseDate(p.startDate)?.getTime() ?? parseDate(p.createdAt)?.getTime() ?? null,
    endMs: parseDate(p.endDate)?.getTime() ?? null,
    completedMs: completed ? completed.getTime() : null,
    cancelled: p.status === 'Cancelled',
    plannedHours: plannedHoursOf(p),
    remainingHoursEstimate: typeof p.remainingHoursEstimate === 'number' && p.remainingHoursEstimate >= 0
      ? p.remainingHoursEstimate
      : null,
  };
}

/** The method actually applied to this project today. */
export function recognitionMethodOf(p: Project): RecognitionMethod {
  return effectiveRecognitionMethod(recognitionFacts(p));
}

/** Hours logged on `projectId` up to and including `asOfMs`. */
export function projectHoursUpTo(entries: TimeEntry[] | null | undefined, projectId: string, asOfMs: number): number {
  let h = 0;
  for (const e of entries || []) {
    if (e.projectId !== projectId) continue;
    const at = entryInstantMs(e);
    if (at == null || at > asOfMs) continue;
    h += entryHours(e);
  }
  return h;
}

export interface Period { start: Date; end: Date }

/**
 * Revenue a project EARNED inside the period (ALL).
 * Retainers use the existing month rule; everything else goes through the core.
 */
export function projectEarnedInPeriod(p: Project, entries: TimeEntry[] | null | undefined, period: Period): number {
  const facts = recognitionFacts(p);
  if (facts.method === 'monthly') {
    const months = monthsBetween(period.start, period.end);
    return retainerRevenueInPeriod(p, monthlyFeeAll(p), period.start, period.end, months).revenue;
  }
  const startMs = period.start.getTime();
  const endMs = period.end.getTime();
  return earnedInPeriod(
    facts,
    startMs,
    endMs,
    projectHoursUpTo(entries, p.id, startMs - 1),
    projectHoursUpTo(entries, p.id, endMs),
  );
}

/** Cumulative earned revenue as of `asOf` (ALL). Retainers: fee × months since creation. */
export function projectEarnedToDate(p: Project, entries: TimeEntry[] | null | undefined, asOf: Date): number {
  const facts = recognitionFacts(p);
  if (facts.method === 'monthly') {
    const start = parseDate(p.createdAt) || asOf;
    const months = monthsBetween(start, asOf);
    return retainerRevenueInPeriod(p, monthlyFeeAll(p), start, asOf, months).revenue;
  }
  return earnedCumulative(facts, asOf.getTime(), projectHoursUpTo(entries, p.id, asOf.getTime()));
}

export interface ProjectWip {
  contractValue: number;
  earnedToDate: number;
  billedToDate: number;
  collectedToDate: number;
  /** Work done but not yet invoiced (earned − billed, when positive). */
  unbilledEarned: number;
  /** Invoiced ahead of the work (billed − earned, when positive). */
  deferred: number;
  percentComplete: number | null;
  method: RecognitionMethod;
}

/** The four figures side by side, as of `asOf`. */
export function projectWip(
  p: Project,
  entries: TimeEntry[] | null | undefined,
  invoices: Invoice[] | null | undefined,
  asOf: Date,
): ProjectWip {
  const facts = recognitionFacts(p);
  const earned = projectEarnedToDate(p, entries, asOf);
  const epoch = new Date(0);
  let billed = 0, collected = 0;
  for (const inv of invoices || []) {
    if (inv.projectId !== p.id) continue;
    if (inv.status === 'Draft' || inv.status === 'Cancelled') continue;
    billed += getInvoiceBilledBetween(inv, epoch, asOf);
    collected += getInvoiceCollectedBetween(inv, epoch, asOf);
  }
  const contract = facts.method === 'monthly' ? earned : facts.contractValue;
  return {
    contractValue: contract,
    earnedToDate: earned,
    billedToDate: billed,
    collectedToDate: collected,
    unbilledEarned: Math.max(0, earned - billed),
    deferred: Math.max(0, billed - earned),
    percentComplete: facts.method === 'monthly' ? null : (contract > 0 ? (earned / contract) * 100 : null),
    method: effectiveRecognitionMethod(facts),
  };
}

/** Human labels for the UI (Albanian). */
export const RECOGNITION_METHOD_LABELS: Record<RecognitionMethod, string> = {
  monthly: 'Tarifë mujore (retainer)',
  effort: 'Sipas punës së kryer (orë / orë të planifikuara)',
  'straight-line': 'Lineare nga fillimi te mbarimi',
  'on-completion': 'Në muajin e mbylljes',
};

export { entryDayKey };
