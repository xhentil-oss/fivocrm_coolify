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
// The calendar math (period keys, anchors, the block reason) lives in the
// import-free core `projectCycles.ts`, whose byte-identical copy
// `api/_projectCycles.ts` the cron uses — so browser and server can no longer
// drift. This module keeps the names the app already imports.
import {
  SUPPORTED_BILLING_FREQUENCIES,
  billingAnchorOf,
  billingBlockReason,
  billingFrequencyOf,
  billingPeriodEnd,
  billingPeriodKey,
  billingPeriodsSkipped,
  isAnchoredFrequency,
  materializeWorkCyclePatch,
  startOfCycleWeek,
  zonedMonthIndex,
  type BillingBlock,
  type BillingCandidate,
  type BillingFrequency,
} from './projectCycles';

export type ProjectBillingFrequency = BillingFrequency;

/** Frequencies a recurring project can actually be billed on. */
export const SUPPORTED_PROJECT_BILLING_FREQUENCIES: ReadonlyArray<ProjectBillingFrequency> = SUPPORTED_BILLING_FREQUENCIES;

/** Statuses that end a retainer for good — the series is cleared, not just skipped. */
export const TERMINAL_PROJECT_STATUSES: ReadonlyArray<Project['status']> = ['Cancelled', 'Archived'];

export type ProjectBillingBlock = BillingBlock;

/** Reasons that permanently end the series (the caller should clear `isRecurring`). */
export const PERMANENT_BILLING_BLOCKS: ReadonlyArray<ProjectBillingBlock> = ['terminal-status', 'series-ended'];

/** Monday 00:00 (business zone) of the week `d` falls in — the weekly anchor. */
export function startOfBillingWeek(d: Date): Date {
  return startOfCycleWeek(d);
}

/** The frequency a project bills on, defaulting to monthly (the legacy behaviour). */
export function projectBillingFrequency(project: Pick<Project, 'recurringFrequency'>): string {
  return billingFrequencyOf(project);
}

/**
 * The contract-year anchor of a quarterly / yearly retainer (null for weekly /
 * monthly, whose periods are calendar weeks / months).
 */
export function projectBillingAnchor(
  project: Pick<Project, 'recurringFrequency'> & { billingAnchorAt?: unknown; startDate?: unknown; createdAt?: unknown },
): Date | null {
  return isAnchoredFrequency(billingFrequencyOf(project)) ? billingAnchorOf(project) : null;
}

/**
 * Stable key for the billing period `at` falls in. Exactly one invoice may exist
 * per (project, key) — this is the idempotency token.
 *
 *   monthly   → '2026-08'
 *   weekly    → 'W2026-08-03'  (anchored on the Monday)
 *   quarterly → 'Q2026-03'     (first month of the quarter, anchored on the contract)
 *   yearly    → 'Y2026-03'     (first month of the contract year)
 */
export function projectBillingPeriodKey(frequency: string, at: Date, anchor?: Date | null): string {
  return billingPeriodKey(frequency, at, anchor);
}

/** Last day of the period `at` falls in. */
export function projectBillingPeriodEnd(frequency: string, at: Date, anchor?: Date | null): Date {
  return billingPeriodEnd(frequency, at, anchor);
}

/**
 * Legacy fallback for projects billed before `lastInvoicePeriodKey` existed:
 * decide from the raw `lastInvoiceGeneratedAt` timestamp whether the current
 * period was already billed.
 */
export function periodAlreadyBilledLegacy(frequency: string, lastGeneratedAt: Date, at: Date, anchor?: Date | null): boolean {
  return billingPeriodKey(frequency, lastGeneratedAt, anchor) === billingPeriodKey(frequency, at, anchor);
}

/**
 * The calendar day a monthly retainer bills in the month `at` falls in, clamped
 * to that month's length (a "31" setting bills on the 28th/30th in short months
 * rather than slipping into the next one).
 */
export function billingDayForMonth(day: number, at: Date): number {
  const idx = zonedMonthIndex(at);
  const year = Math.floor(idx / 12);
  const month = idx % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return Math.min(Math.max(1, Math.round(day)), lastDay);
}

export type ProjectBillingCandidate = BillingCandidate;

/**
 * Why this project may NOT be billed for the period containing `now`, or `null`
 * when it is due. Order matters: permanent blocks are reported before transient
 * ones so the caller can clear `isRecurring` and stop re-reading the project.
 */
export function projectBillingBlockReason(
  project: ProjectBillingCandidate,
  now: Date,
): ProjectBillingBlock | null {
  return billingBlockReason(project, now);
}

/**
 * How many whole billing periods a retainer missed between `lastPeriodKey` and the
 * period containing `now` (0 when on schedule, or when the gap cannot be resolved).
 * Like the invoice engine, this only REPORTS. Backfilling closed months is the
 * owner's call.
 */
export function projectPeriodsSkipped(
  frequency: string,
  lastPeriodKey: string | undefined | null,
  now: Date,
  maxLookback = 24,
  anchor?: Date | null,
): number {
  return billingPeriodsSkipped(frequency, lastPeriodKey, now, anchor, maxLookback);
}

// ── Billing controls (pause / stop) ─────────────────────────────────────────
// The three ways a human stops a retainer's automatic invoicing, as PATCHES —
// same law as projectArchive.ts: nothing writes these fields by hand, because a
// hand-written stop leaves contradictions (isRecurring off but paused on, no
// stopped-reason, a stale end date) that the engine then has to guess around.
// Before these existed the ONLY ways to stop billing a live client were to
// archive the project or cancel it — and the edit form's own switch silently
// did nothing (`isRecurring || undefined` is stripped by the write layer).

/** Temporarily halt automatic invoicing; the series stays configured. */
export function pauseProjectBillingPatch(): Partial<Project> {
  return { isRecurringPaused: true };
}

/** Resume a paused series. */
export function resumeProjectBillingPatch(): Partial<Project> {
  return { isRecurringPaused: false };
}

/**
 * End the series for good, keeping the project alive (unlike archive/cancel).
 * Every issued invoice stays. `recurringFrequency` is kept so switching the
 * series back on later remembers its cycle.
 */
export function stopProjectBillingPatch(
  at: Date = new Date(),
  project?: Partial<Pick<Project, 'isRecurring' | 'recurringFrequency' | 'workCycle'>> | null,
): Partial<Project> {
  return {
    // Stopping the INVOICES never stops the WORK: a project that still relied
    // on the legacy coupling (no `workCycle`) gets its cycle written down first.
    ...(project ? materializeWorkCyclePatch(project) : {}),
    isRecurring: false,
    isRecurringPaused: false,
    recurringBillingStoppedReason: 'manual',
    recurringBillingStoppedAt: at,
  };
}

/** True when the block reason means the series is over (clear `isRecurring`). */
export function isPermanentBillingBlock(reason: ProjectBillingBlock | null): boolean {
  return !!reason && PERMANENT_BILLING_BLOCKS.includes(reason);
}

// ── Human labels for the block reasons ──────────────────────────────────────
// The cron stamps `billingLastBlock` + `billingLastCheckedAt` on every recurring
// project it evaluates, and the Faturimi panel shows them read-only. One label
// table, so the panel, the list tooltip and any future notification say the
// same thing for the same reason.

export const PROJECT_BILLING_BLOCK_LABELS: Record<ProjectBillingBlock, string> = {
  'not-recurring': 'Projekti nuk faturohet periodikisht',
  'unsupported-frequency': 'Frekuencë e pambështetur (javore / mujore / tremujore / vjetore)',
  'terminal-status': 'Projekti është anuluar ose arkivuar',
  'paused': 'Faturimi është në pauzë',
  'one-time': 'Lloji i faturimit është një-herësh',
  'series-ended': 'Seria mbaroi (data e fundit e përsëritjes kaloi)',
  'already-billed': 'Periudha u faturua',
  'before-billing-day': 'Pret ditën e faturimit',
  'before-contract-start': 'Kontrata nuk ka nisur ende',
};

/**
 * Albanian label for a block reason, with the project's own numbers filled in
 * (`before-billing-day` → "Pret ditën e faturimit (25)"). An unknown string —
 * a reason added to the cron before this table learns it — is shown verbatim
 * rather than as nothing. `null` means the project may bill right now.
 */
export function projectBillingBlockLabel(
  reason: ProjectBillingBlock | string | null | undefined,
  project?: Pick<ProjectBillingCandidate, 'billingDayOfMonth'> | null,
): string {
  if (!reason) return 'Gati për faturim';
  if (reason === 'before-billing-day') {
    const day = project?.billingDayOfMonth;
    return day ? `Pret ditën e faturimit (${day})` : PROJECT_BILLING_BLOCK_LABELS[reason];
  }
  return (PROJECT_BILLING_BLOCK_LABELS as Record<string, string>)[reason] ?? reason;
}
