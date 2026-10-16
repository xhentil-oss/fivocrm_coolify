/**
 * What the Faturimi panel says about a RECURRING project: which cycle it bills
 * on, whether the current period is invoiced, when the next invoice goes out,
 * and — for a quarterly / yearly cycle paid up front — how much of the money
 * received is still "paguar përpara, pa shërbyer" (deferred).
 *
 * Pure (unit-tested). The period grid is the billing engine's own
 * (projectCycles.ts), so the panel and the cron can never disagree.
 */
import type { Invoice, Project } from '../../types';
import {
  CYCLE_MONTHS,
  billingAnchorOf,
  billingBlockReason,
  billingFrequencyOf,
  billingIssueDate,
  billingPeriodEnd,
  billingPeriodKey,
  billingPeriodStart,
  isAnchoredFrequency,
  isSupportedBillingFrequency,
  monthlyFeeFromCycleFee,
  nextBillingPeriodStart,
  zonedMonthIndex,
} from './projectCycles';

export interface RetainerSummary {
  frequency: string;
  /** Fee per cycle (`budget`), in the project's currency. */
  cycleFee: number;
  /** The same fee per month. */
  monthlyFee: number;
  periodKey: string;
  periodStart: Date;
  periodEnd: Date;
  /** An issued (non-draft, non-cancelled) invoice exists for the current period. */
  currentPeriodBilled: boolean;
  /** When the next automatic invoice is expected (null when the series is stopped). */
  nextInvoiceAt: Date | null;
  /** Long cycles only: months of the current period already served (1..months). */
  monthsServed: number | null;
  monthsInCycle: number | null;
  /** Long cycles only: part of the billed cycle fee not yet served. */
  deferred: number | null;
}

const ISSUED = (i: Invoice) => i.status !== 'Draft' && i.status !== 'Cancelled';

export function retainerSummary(
  project: Project,
  invoices: Invoice[] | null | undefined,
  now: Date = new Date(),
): RetainerSummary | null {
  if (!project.isRecurring && !project.recurringFrequency) return null;
  const frequency = billingFrequencyOf(project);
  if (!isSupportedBillingFrequency(frequency)) return null;
  const anchor = isAnchoredFrequency(frequency) ? billingAnchorOf(project) : null;
  const cycleFee = Number(project.budget) || 0;
  const periodKey = billingPeriodKey(frequency, now, anchor);
  const periodStart = billingPeriodStart(frequency, now, anchor);
  const periodEnd = billingPeriodEnd(frequency, now, anchor);

  const currentPeriodBilled = (invoices || []).some(
    i => i.projectId === project.id && ISSUED(i) && i.billingPeriodKey === periodKey,
  ) || project.lastInvoicePeriodKey === periodKey;

  const block = billingBlockReason(project as any, now);
  const live = !!project.isRecurring && block !== 'paused' && block !== 'terminal-status'
    && block !== 'series-ended' && block !== 'one-time' && block !== 'not-recurring';
  let nextInvoiceAt: Date | null = null;
  if (live) {
    if (block === 'before-contract-start' && anchor) {
      nextInvoiceAt = billingIssueDate(frequency, anchor, anchor, project.billingDayOfMonth);
    } else if (currentPeriodBilled) {
      const next = nextBillingPeriodStart(frequency, now, anchor);
      nextInvoiceAt = billingIssueDate(frequency, next, anchor, project.billingDayOfMonth);
    } else {
      const issue = billingIssueDate(frequency, now, anchor, project.billingDayOfMonth);
      nextInvoiceAt = issue > now ? issue : now;
    }
  }

  let monthsServed: number | null = null;
  let monthsInCycle: number | null = null;
  let deferred: number | null = null;
  if (isAnchoredFrequency(frequency) && block !== 'before-contract-start') {
    monthsInCycle = CYCLE_MONTHS[frequency as 'quarterly' | 'yearly'];
    monthsServed = Math.min(monthsInCycle, Math.max(1, zonedMonthIndex(now) - zonedMonthIndex(periodStart) + 1));
    deferred = currentPeriodBilled ? (cycleFee * (monthsInCycle - monthsServed)) / monthsInCycle : 0;
  }

  return {
    frequency,
    cycleFee,
    monthlyFee: monthlyFeeFromCycleFee(cycleFee, frequency),
    periodKey,
    periodStart,
    periodEnd,
    currentPeriodBilled,
    nextInvoiceAt,
    monthsServed,
    monthsInCycle,
    deferred,
  };
}

export const BILLING_FREQUENCY_LABELS: Record<string, string> = {
  weekly: 'Javore',
  monthly: 'Mujore',
  quarterly: 'Tremujore',
  yearly: 'Vjetore',
};
