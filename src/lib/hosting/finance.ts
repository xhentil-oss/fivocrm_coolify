/**
 * Hosting & domains → Financat.
 *
 * "Will this bill?" has ONE answer per engine (CLAUDE.md law). For hosting that
 * answer is the subscription/domain lifecycle in `engine.ts`; this module turns it
 * into the two numbers Financat needs and nothing else:
 *   • `hostingMonthlyRecurringRevenue` — normalised /month, in ALL, for MRR and the
 *     cash-flow gap alarm (same definition, so the cards agree);
 *   • `hostingRenewalsInWindow` — what will be INVOICED inside a window (renewals
 *     falling due), for the next-month forecast and the expiry digest.
 * Only `source: 'fivocrm'` rows count: a WHMCS mirror row is WHMCS's revenue.
 */
import { toAll } from '../utils';
import { getTimestampMs } from '../utils';
import { CYCLE_MONTHS, isBillingCycle, type BillingCycle } from './engine';
import type { Domain, Subscription } from '../../types';

const toDate = (v: unknown): Date | null => { const ms = getTimestampMs(v); return ms ? new Date(ms) : null; };

/** A subscription that will produce its next renewal invoice (Active, or Suspended for non-payment but not cancelled). */
export function subscriptionBillsAgain(s: Pick<Subscription, 'source' | 'status' | 'cancelAtPeriodEnd' | 'billingCycle' | 'recurringAmount'>): boolean {
  if (s.source !== 'fivocrm') return false;
  if (s.status !== 'Active' && s.status !== 'Suspended') return false;
  if (s.cancelAtPeriodEnd) return false;
  if (!isBillingCycle(s.billingCycle)) return false;
  return (s.recurringAmount || 0) > 0;
}

/** Monthly-equivalent recurring revenue of hosting subscriptions, in ALL. */
export function hostingMonthlyRecurringRevenue(subs: ReadonlyArray<Subscription> | null | undefined): number {
  let total = 0;
  for (const s of subs || []) {
    if (!subscriptionBillsAgain(s)) continue;
    const months = CYCLE_MONTHS[s.billingCycle as BillingCycle];
    total += toAll(s.recurringAmount || 0, s.currency) / months;
  }
  return Math.round(total);
}

export interface HostingRenewalRow {
  kind: 'subscription' | 'domain';
  id: string;
  name: string;
  customerId?: string | null;
  dueDate: Date;
  amountAll: number;
}

/** Renewals (subscriptions + domains) whose due/expiry date falls inside [start, end]. */
export function hostingRenewalsInWindow(
  subs: ReadonlyArray<Subscription> | null | undefined,
  domains: ReadonlyArray<Domain> | null | undefined,
  start: Date,
  end: Date,
): { rows: HostingRenewalRow[]; totalAll: number } {
  const rows: HostingRenewalRow[] = [];
  for (const s of subs || []) {
    if (!subscriptionBillsAgain(s)) continue;
    const due = toDate(s.nextDueDate);
    if (!due || due < start || due > end) continue;
    rows.push({ kind: 'subscription', id: s.id, name: s.domain || s.productName, customerId: s.customerId ?? null, dueDate: due, amountAll: toAll(s.recurringAmount || 0, s.currency) });
  }
  for (const d of domains || []) {
    if (d.source !== 'fivocrm' || d.autoRenew === false) continue;
    if (['Expired', 'Cancelled', 'Transferred Away', 'Pending'].includes(String(d.status))) continue;
    const exp = toDate(d.expiryDate);
    if (!exp || exp < start || exp > end) continue;
    rows.push({ kind: 'domain', id: d.id, name: d.domainName, customerId: d.customerId ?? null, dueDate: exp, amountAll: toAll(d.recurringAmount || 0, d.currency) });
  }
  rows.sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
  return { rows, totalAll: Math.round(rows.reduce((s, r) => s + r.amountAll, 0)) };
}
