// Recurring PROJECT billing — which period a retainer is in, and whether it may
// bill at all.
//
// Background: a project with `isRecurring` bills its fee once per period. That
// decision used to live only inside the cron and consisted of a single check
// (`lastInvoiceGeneratedAt` in the current calendar month), which let three real
// bugs through:
//   · the UI created the first invoice at project creation without recording it,
//     so the cron billed the same month a second time and emailed the client twice;
//   · a Cancelled/Archived retainer kept billing forever;
//   · `weekly` was silently dropped (only 'monthly' was handled).
//
// Everything that decides "may this project bill, and for which period" now lives
// here, is unit-tested, and is mirrored by `projectBillingPeriodKey` /
// `projectBillingBlockReason` in `api/cron/run.ts` — keep the two in sync.

import type { Project } from '../../types';

export type ProjectBillingFrequency = 'weekly' | 'monthly';

/** Frequencies a recurring project can actually be billed on. */
export const SUPPORTED_PROJECT_BILLING_FREQUENCIES: ReadonlyArray<ProjectBillingFrequency> = ['weekly', 'monthly'];

/** Statuses that end a retainer for good — the series is cleared, not just skipped. */
export const TERMINAL_PROJECT_STATUSES: ReadonlyArray<Project['status']> = ['Cancelled', 'Archived'];

export type ProjectBillingBlock =
  | 'not-recurring'
  | 'unsupported-frequency'
  | 'terminal-status'
  | 'paused'
  | 'one-time'
  | 'series-ended'
  | 'already-billed'
  /** Monthly retainer whose chosen billing day (e.g. the 25th) hasn't arrived yet. */
  | 'before-billing-day';

/** Reasons that permanently end the series (the caller should clear `isRecurring`). */
export const PERMANENT_BILLING_BLOCKS: ReadonlyArray<ProjectBillingBlock> = ['terminal-status', 'series-ended'];

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  // Firestore Timestamp (client or admin SDK).
  const ts = value as { toDate?: () => Date };
  if (typeof ts.toDate === 'function') {
    const d = ts.toDate();
    return d instanceof Date && !isNaN(d.getTime()) ? d : null;
  }
  const d = new Date(value as string | number);
  return isNaN(d.getTime()) ? null : d;
}

/** Monday 00:00 (local) of the week `d` falls in — the weekly period anchor. */
export function startOfBillingWeek(d: Date): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = out.getDay();              // 0 = Sunday
  const backToMonday = dow === 0 ? 6 : dow - 1;
  out.setDate(out.getDate() - backToMonday);
  return out;
}

/** The frequency a project bills on, defaulting to monthly (the legacy behaviour). */
export function projectBillingFrequency(project: Pick<Project, 'recurringFrequency'>): string {
  return (project.recurringFrequency as string) || 'monthly';
}

/**
 * Stable key for the billing period `at` falls in. Exactly one invoice may exist
 * per (project, key) — this is the idempotency token that replaces the old
 * "same calendar month?" comparison.
 *
 *   monthly → '2026-08'
 *   weekly  → '2026-W-2026-08-03'  (anchored on the Monday, so it is comparable
 *             across month boundaries without ISO week-number edge cases)
 */
export function projectBillingPeriodKey(frequency: string, at: Date): string {
  if (frequency === 'weekly') {
    const monday = startOfBillingWeek(at);
    return `W${monday.getFullYear()}-${pad2(monday.getMonth() + 1)}-${pad2(monday.getDate())}`;
  }
  return `${at.getFullYear()}-${pad2(at.getMonth() + 1)}`;
}

/** Last day of the period `at` falls in — the natural due date for that invoice. */
export function projectBillingPeriodEnd(frequency: string, at: Date): Date {
  if (frequency === 'weekly') {
    const monday = startOfBillingWeek(at);
    return new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6, 23, 59, 59, 999);
  }
  return new Date(at.getFullYear(), at.getMonth() + 1, 0, 23, 59, 59, 999);
}

/**
 * Legacy fallback for projects billed before `lastInvoicePeriodKey` existed:
 * decide from the raw `lastInvoiceGeneratedAt` timestamp whether the current
 * period was already billed.
 */
export function periodAlreadyBilledLegacy(frequency: string, lastGeneratedAt: Date, at: Date): boolean {
  return projectBillingPeriodKey(frequency, lastGeneratedAt) === projectBillingPeriodKey(frequency, at);
}

/**
 * The calendar day a monthly retainer bills in the month `at` falls in, clamped
 * to that month's length (a "31" setting bills on the 28th/30th in short months
 * rather than slipping into the next one).
 */
export function billingDayForMonth(day: number, at: Date): number {
  const lastDay = new Date(at.getFullYear(), at.getMonth() + 1, 0).getDate();
  return Math.min(Math.max(1, Math.round(day)), lastDay);
}

export interface ProjectBillingCandidate {
  status?: Project['status'];
  isRecurring?: boolean;
  isRecurringPaused?: boolean;
  billingType?: Project['billingType'];
  recurringFrequency?: string;
  recurringEndDate?: unknown;
  lastInvoicePeriodKey?: string;
  lastInvoiceGeneratedAt?: unknown;
  /** Day of month a monthly retainer issues its invoice (e.g. 25). */
  billingDayOfMonth?: number;
}

/**
 * Why this project may NOT be billed for the period containing `now`, or `null`
 * when it is due. Order matters: permanent blocks are reported before transient
 * ones so the caller can clear `isRecurring` and stop re-reading the project.
 */
export function projectBillingBlockReason(
  project: ProjectBillingCandidate,
  now: Date,
): ProjectBillingBlock | null {
  if (!project.isRecurring) return 'not-recurring';

  const frequency = projectBillingFrequency(project);
  if (!SUPPORTED_PROJECT_BILLING_FREQUENCIES.includes(frequency as ProjectBillingFrequency)) {
    return 'unsupported-frequency';
  }

  // Terminal status ends the engagement — a cancelled retainer must never invoice.
  if (project.status && TERMINAL_PROJECT_STATUSES.includes(project.status)) return 'terminal-status';

  // "Repeat until" — checked before the pause flag so an expired series is always
  // cleaned up rather than left dormant.
  const endDate = toDate(project.recurringEndDate);
  if (endDate && now > endDate) return 'series-ended';

  if (project.isRecurringPaused) return 'paused';

  // A single deal value must never bill on a cycle, even if `isRecurring` got set
  // by mistake — the two settings are contradictory and one-time wins.
  if (project.billingType === 'one-time') return 'one-time';

  const periodKey = projectBillingPeriodKey(frequency, now);
  if (project.lastInvoicePeriodKey) {
    if (project.lastInvoicePeriodKey === periodKey) return 'already-billed';
  } else {
    const last = toDate(project.lastInvoiceGeneratedAt);
    if (last && periodAlreadyBilledLegacy(frequency, last, now)) return 'already-billed';
  }

  // Chosen billing day (monthly only): hold the invoice until that day arrives,
  // e.g. bill social-media retainers on the 25th instead of the 1st. Transient —
  // the same period bills normally once the day is reached.
  if (frequency === 'monthly' && project.billingDayOfMonth) {
    if (now.getDate() < billingDayForMonth(project.billingDayOfMonth, now)) return 'before-billing-day';
  }

  return null;
}

/**
 * How many whole billing periods a retainer missed between `lastPeriodKey` and the
 * period containing `now` (0 when on schedule, or when the gap cannot be resolved).
 *
 * Project-driven billing derives everything from `now`, so a period the cron never
 * ran in is simply never billed — silently. The invoice engine already reports its
 * gap (`recurringPeriodsSkipped`); a retainer losing a whole month of revenue with
 * no signal at all is the same fault, on the side that carries the recurring money.
 *
 * Like the invoice engine, this only REPORTS. Backfilling closed months is the
 * owner's call.
 */
export function projectPeriodsSkipped(
  frequency: string,
  lastPeriodKey: string | undefined | null,
  now: Date,
  maxLookback = 24,
): number {
  if (!lastPeriodKey) return 0;
  if (projectBillingPeriodKey(frequency, now) === lastPeriodKey) return 0;
  let cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  for (let i = 0; i < maxLookback; i++) {
    cursor = frequency === 'weekly'
      ? new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() - 7)
      // The 1st, so stepping back from the 31st cannot skip a short month.
      : new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1);
    if (projectBillingPeriodKey(frequency, cursor) === lastPeriodKey) return i;
  }
  // Older than the window (or a key from another frequency) — don't invent a number.
  return 0;
}

/** True when the block reason means the series is over (clear `isRecurring`). */
export function isPermanentBillingBlock(reason: ProjectBillingBlock | null): boolean {
  return !!reason && PERMANENT_BILLING_BLOCKS.includes(reason);
}
