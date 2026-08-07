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
  | 'already-billed';

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

export interface ProjectBillingCandidate {
  status?: Project['status'];
  isRecurring?: boolean;
  isRecurringPaused?: boolean;
  billingType?: Project['billingType'];
  recurringFrequency?: string;
  recurringEndDate?: unknown;
  lastInvoicePeriodKey?: string;
  lastInvoiceGeneratedAt?: unknown;
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

  return null;
}

/** True when the block reason means the series is over (clear `isRecurring`). */
export function isPermanentBillingBlock(reason: ProjectBillingBlock | null): boolean {
  return !!reason && PERMANENT_BILLING_BLOCKS.includes(reason);
}
