/**
 * The two CYCLES of a recurring project, decided in one import-free place.
 *
 *   · the WORK cycle  (`workCycle`)        — when the project's tasks start again
 *                                            (weekly / monthly);
 *   · the BILLING cycle (`recurringFrequency`) — when the client is invoiced
 *                                            (weekly / monthly / quarterly / yearly).
 *
 * They used to be ONE switch (`isRecurring` + `recurringFrequency`), which made
 * "the work happens every month, the client pays once a year" impossible to
 * express, and made "Ndalo faturimin" silently stop the monthly task cycle too
 * (the reset job read `isRecurring == true`).
 *
 * This file is IMPORT-FREE on purpose: `api/_projectCycles.ts` is a
 * BYTE-IDENTICAL copy (test-enforced) used by the cron, so the browser and the
 * server can never disagree about a period key — the period key IS the
 * idempotency token of both the invoice and the task cycle.
 *
 * Calendar questions are answered in ONE declared zone (Europe/Tirane), never
 * with the machine's getters — see the note in src/lib/recurringUtils.ts.
 */

export const CYCLE_TIMEZONE = 'Europe/Tirane';

// ── Zone-explicit calendar helpers (private copies — this file imports nothing) ──

function zoneOffsetMs(at: Date): number {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone: CYCLE_TIMEZONE, timeZoneName: 'longOffset' });
    const part = fmt.formatToParts(at).find((p) => p.type === 'timeZoneName')?.value || '';
    const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(part);
    if (!m) return 0;
    const sign = m[1] === '-' ? -1 : 1;
    return sign * (Number(m[2]) * 60 + Number(m[3] || 0)) * 60_000;
  } catch {
    return 0;
  }
}

interface ZParts { year: number; month: number; day: number; hours: number; minutes: number; seconds: number; ms: number; weekday: number }

function zp(at: Date): ZParts {
  const z = new Date(at.getTime() + zoneOffsetMs(at));
  return {
    year: z.getUTCFullYear(), month: z.getUTCMonth(), day: z.getUTCDate(),
    hours: z.getUTCHours(), minutes: z.getUTCMinutes(), seconds: z.getUTCSeconds(),
    ms: z.getUTCMilliseconds(), weekday: z.getUTCDay(),
  };
}

function zd(year: number, month: number, day: number, hours = 0, minutes = 0, seconds = 0, ms = 0): Date {
  const zoned = new Date(Date.UTC(year, month, day, hours, minutes, seconds, ms));
  const guess = new Date(zoned.getTime() - zoneOffsetMs(zoned));
  return new Date(zoned.getTime() - zoneOffsetMs(guess));
}

function dim(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Firestore Timestamp | Date | ISO | ms → Date (null when unusable). */
export function cycleDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  const ts = value as { toDate?: () => Date };
  if (typeof ts.toDate === 'function') {
    const d = ts.toDate();
    return d instanceof Date && !isNaN(d.getTime()) ? d : null;
  }
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

/** Monday 00:00 (business zone) of the week `at` falls in. */
export function startOfCycleWeek(at: Date): Date {
  const p = zp(at);
  const back = p.weekday === 0 ? 6 : p.weekday - 1;
  return zd(p.year, p.month, p.day - back);
}

/** Absolute month number (year × 12 + month) of an instant, in the business zone. */
export function zonedMonthIndex(at: Date): number {
  const p = zp(at);
  return p.year * 12 + p.month;
}

/** The 1st of (year, month) 00:00 in the business zone. */
export function monthStartInZone(year: number, month: number): Date {
  return zd(year, month, 1);
}

/** 'YYYY-MM' of an instant in the business zone (the value of an `<input type="month">`). */
export function zonedMonthValue(at: Date): string {
  const p = zp(at);
  return `${p.year}-${pad2(p.month + 1)}`;
}

/** `from` + n months in the business zone, clamped (31 Jan + 1 = 28/29 Feb). */
export function addCycleMonths(from: Date, months: number, anchorDay?: number): Date {
  const p = zp(from);
  const total = p.month + months;
  const y = p.year + Math.floor(total / 12);
  const m = ((total % 12) + 12) % 12;
  const day = Math.min(anchorDay ?? p.day, dim(y, m));
  return zd(y, m, day, p.hours, p.minutes, p.seconds, p.ms);
}

/** `from` + n zone days, keeping the wall-clock time. */
export function addCycleDays(from: Date, days: number): Date {
  const p = zp(from);
  return zd(p.year, p.month, p.day + days, p.hours, p.minutes, p.seconds, p.ms);
}

// ════════════════════════════════════════════════════════════════════════════
// BILLING cycle
// ════════════════════════════════════════════════════════════════════════════

export type BillingFrequency = 'weekly' | 'monthly' | 'quarterly' | 'yearly';

/** Every cycle a recurring project can actually be invoiced on. */
export const SUPPORTED_BILLING_FREQUENCIES: ReadonlyArray<BillingFrequency> = ['weekly', 'monthly', 'quarterly', 'yearly'];

/** Months one invoice covers (weekly is expressed per month: 12 / 52). */
export const CYCLE_MONTHS: Record<BillingFrequency, number> = {
  weekly: 12 / 52,
  monthly: 1,
  quarterly: 3,
  yearly: 12,
};

export function isSupportedBillingFrequency(f: unknown): f is BillingFrequency {
  return typeof f === 'string' && (SUPPORTED_BILLING_FREQUENCIES as ReadonlyArray<string>).includes(f);
}

/** The frequency a project bills on, defaulting to monthly (the legacy behaviour). */
export function billingFrequencyOf(project: { recurringFrequency?: unknown }): string {
  return (typeof project.recurringFrequency === 'string' && project.recurringFrequency) || 'monthly';
}

/** True for the cycles whose period is anchored on the contract's start month. */
export function isAnchoredFrequency(f: string): boolean {
  return f === 'quarterly' || f === 'yearly';
}

/**
 * The month a quarterly / yearly contract year starts on. Precedence:
 * `billingAnchorAt` (written by the form) → `startDate` → `createdAt`.
 * Unknown = January (a calendar year), never "now" — a moving anchor would move
 * the period key and bill the same year twice.
 */
export function billingAnchorOf(project: { billingAnchorAt?: unknown; startDate?: unknown; createdAt?: unknown }): Date | null {
  return cycleDate(project.billingAnchorAt) || cycleDate(project.startDate) || cycleDate(project.createdAt);
}

/**
 * First instant (business zone, the 1st 00:00 — or Monday 00:00 for weekly) of
 * the billing period that contains `at`.
 */
export function billingPeriodStart(frequency: string, at: Date, anchor?: Date | null): Date {
  if (frequency === 'weekly') return startOfCycleWeek(at);
  const p = zp(at);
  if (!isAnchoredFrequency(frequency)) return zd(p.year, p.month, 1);
  const len = frequency === 'yearly' ? 12 : 3;
  const anchorIdx = anchor ? zonedMonthIndex(anchor) : 0; // 0 → January-based
  const idx = p.year * 12 + p.month;
  const offset = ((idx - anchorIdx) % len + len) % len;
  const startIdx = idx - offset;
  return zd(Math.floor(startIdx / 12), ((startIdx % 12) + 12) % 12, 1);
}

/**
 * Stable key of the billing period `at` falls in — exactly one invoice per
 * (project, key):
 *
 *   weekly    'W2026-08-03'   (the Monday)
 *   monthly   '2026-08'
 *   quarterly 'Q2026-03'      (the first month of the quarter, anchored)
 *   yearly    'Y2026-03'      (the first month of the contract year, anchored)
 *
 * Keys of different frequencies are never equal — a frequency change must
 * RE-EXPRESS the claim (see `reexpressBillingClaim`).
 */
export function billingPeriodKey(frequency: string, at: Date, anchor?: Date | null): string {
  const s = zp(billingPeriodStart(frequency, at, anchor));
  const ym = `${s.year}-${pad2(s.month + 1)}`;
  if (frequency === 'weekly') return `W${ym}-${pad2(s.day)}`;
  if (frequency === 'quarterly') return `Q${ym}`;
  if (frequency === 'yearly') return `Y${ym}`;
  return ym;
}

/** Last instant of the billing period `at` falls in. */
export function billingPeriodEnd(frequency: string, at: Date, anchor?: Date | null): Date {
  const s = zp(billingPeriodStart(frequency, at, anchor));
  if (frequency === 'weekly') return zd(s.year, s.month, s.day + 6, 23, 59, 59, 999);
  const len = frequency === 'yearly' ? 12 : frequency === 'quarterly' ? 3 : 1;
  const lastIdx = s.year * 12 + s.month + len - 1;
  const y = Math.floor(lastIdx / 12);
  const m = lastIdx % 12;
  return zd(y, m, dim(y, m), 23, 59, 59, 999);
}

/** Start of the period AFTER the one containing `at`. */
export function nextBillingPeriodStart(frequency: string, at: Date, anchor?: Date | null): Date {
  const end = billingPeriodEnd(frequency, at, anchor);
  return new Date(end.getTime() + 1);
}

/** Start of the period BEFORE the one containing `at`. */
export function previousBillingPeriodStart(frequency: string, at: Date, anchor?: Date | null): Date {
  const start = billingPeriodStart(frequency, at, anchor);
  return billingPeriodStart(frequency, new Date(start.getTime() - 1), anchor);
}

/**
 * The day of the period's FIRST month on which its invoice is issued
 * (`billingDayOfMonth`, clamped to that month's length). Weekly ignores it.
 * A quarterly / yearly invoice is issued in the first month of its period —
 * "the month the contract started" — on that day.
 */
export function billingIssueDate(frequency: string, at: Date, anchor: Date | null, billingDayOfMonth?: number | null): Date {
  const start = billingPeriodStart(frequency, at, anchor);
  if (frequency === 'weekly' || !billingDayOfMonth) return start;
  const s = zp(start);
  const day = Math.min(Math.max(1, Math.round(billingDayOfMonth)), dim(s.year, s.month));
  return zd(s.year, s.month, day);
}

/**
 * Due date of a period's invoice. `invoiceDueDays` set → issue day + N days
 * (end of that day). Unset → the legacy rule for weekly/monthly (the period's
 * last day) and 15 days for quarterly/yearly — a yearly invoice due at the END
 * of the year it pays for would give the client twelve months to pay.
 */
export const DEFAULT_LONG_CYCLE_DUE_DAYS = 15;

export function billingDueDate(frequency: string, issuedAt: Date, periodEnd: Date, invoiceDueDays?: number | null): Date {
  const days = typeof invoiceDueDays === 'number' && invoiceDueDays >= 0
    ? Math.round(invoiceDueDays)
    : isAnchoredFrequency(frequency) ? DEFAULT_LONG_CYCLE_DUE_DAYS : null;
  if (days === null) return periodEnd;
  const p = zp(issuedAt);
  const due = zd(p.year, p.month, p.day + days, 23, 59, 59, 999);
  return due < periodEnd ? due : periodEnd;
}

/**
 * Whole billing periods missed between `lastPeriodKey` and the period containing
 * `now` (0 when on schedule, or when the gap cannot be resolved). Reports only —
 * backfilling closed months is the owner's call.
 */
export function billingPeriodsSkipped(
  frequency: string,
  lastPeriodKey: string | undefined | null,
  now: Date,
  anchor?: Date | null,
  maxLookback = 24,
): number {
  if (!lastPeriodKey) return 0;
  if (billingPeriodKey(frequency, now, anchor) === lastPeriodKey) return 0;
  let cursor = billingPeriodStart(frequency, now, anchor);
  for (let i = 0; i < maxLookback; i++) {
    cursor = previousBillingPeriodStart(frequency, cursor, anchor);
    if (billingPeriodKey(frequency, cursor, anchor) === lastPeriodKey) return i;
  }
  return 0;
}

/**
 * Re-express a period claim in another frequency (the law: a frequency change
 * never keeps the old key — keys of different frequencies never match, so a kept
 * claim guards nothing and the cron bills a period that was already invoiced).
 * The last occurrence's DATE is what gets re-expressed; no date → `fallback`
 * (callers pass "now", the conservative end).
 */
export function reexpressBillingClaim(
  nextFrequency: string,
  lastGeneratedAt: Date | null,
  fallback: Date,
  anchor?: Date | null,
): string {
  return billingPeriodKey(nextFrequency, lastGeneratedAt || fallback, anchor);
}

// ── Prices ──────────────────────────────────────────────────────────────────

/**
 * `budget` is the fee PER BILLING CYCLE (weekly fee, monthly fee, the whole
 * quarter, the whole year). Every earned-revenue engine counts in MONTHS, so a
 * cycle fee is expressed per month first. An unsupported frequency bills
 * nothing and its fee is left as-is (never invented).
 */
export function monthlyFeeFromCycleFee(cycleFee: number, frequency: string): number {
  const fee = Number(cycleFee) || 0;
  if (!isSupportedBillingFrequency(frequency)) return fee;
  return fee / CYCLE_MONTHS[frequency];
}

/**
 * The cycle fee the form writes as `budget`: monthly fee × months in the cycle
 * × (1 − prepay discount). Weekly ignores the discount (it is a prepayment
 * incentive for LONGER cycles). Rounded to cents.
 */
export function cycleFeeFromMonthly(monthlyFee: number, frequency: string, prepayDiscountPct?: number | null): number {
  const fee = Number(monthlyFee) || 0;
  if (!isSupportedBillingFrequency(frequency)) return fee;
  const months = CYCLE_MONTHS[frequency];
  const pct = isAnchoredFrequency(frequency) ? Math.min(100, Math.max(0, Number(prepayDiscountPct) || 0)) : 0;
  return Math.round(fee * months * (1 - pct / 100) * 100) / 100;
}

// ── May this project bill now? ──────────────────────────────────────────────

export type BillingBlock =
  | 'not-recurring'
  | 'unsupported-frequency'
  | 'terminal-status'
  | 'paused'
  | 'one-time'
  | 'series-ended'
  | 'already-billed'
  /** The period's issue day (billingDayOfMonth in its first month) hasn't arrived yet. */
  | 'before-billing-day'
  /** A quarterly / yearly contract whose first period starts in the future. */
  | 'before-contract-start';

export const TERMINAL_STATUSES: ReadonlyArray<string> = ['Cancelled', 'Archived'];
export const PERMANENT_BILLING_BLOCK_LIST: ReadonlyArray<BillingBlock> = ['terminal-status', 'series-ended'];

export interface BillingCandidate {
  status?: string;
  isRecurring?: boolean;
  isRecurringPaused?: boolean;
  billingType?: string;
  recurringFrequency?: unknown;
  recurringEndDate?: unknown;
  lastInvoicePeriodKey?: string;
  lastInvoiceGeneratedAt?: unknown;
  billingDayOfMonth?: number | null;
  billingAnchorAt?: unknown;
  startDate?: unknown;
  createdAt?: unknown;
}

/**
 * Why this project may NOT be billed for the period containing `now`, or `null`
 * when it is due. Permanent blocks first, so the caller can clear `isRecurring`.
 */
export function billingBlockReason(project: BillingCandidate, now: Date): BillingBlock | null {
  if (!project.isRecurring) return 'not-recurring';
  const frequency = billingFrequencyOf(project);
  if (!isSupportedBillingFrequency(frequency)) return 'unsupported-frequency';
  if (project.status && TERMINAL_STATUSES.includes(project.status)) return 'terminal-status';
  const endDate = cycleDate(project.recurringEndDate);
  if (endDate && now > endDate) return 'series-ended';
  if (project.isRecurringPaused) return 'paused';
  // A single deal value never bills on a cycle — the two settings contradict.
  if (project.billingType === 'one-time') return 'one-time';

  const anchor = isAnchoredFrequency(frequency) ? billingAnchorOf(project) : null;
  // Without this, a contract signed today to start next month sat in the period
  // that ENDS this month (anchored periods repeat backwards too) and was billed
  // for a year that never happened.
  if (anchor && now < billingPeriodStart(frequency, anchor, anchor)) return 'before-contract-start';
  const periodKey = billingPeriodKey(frequency, now, anchor);
  if (project.lastInvoicePeriodKey) {
    if (project.lastInvoicePeriodKey === periodKey) return 'already-billed';
  } else {
    const last = cycleDate(project.lastInvoiceGeneratedAt);
    if (last && billingPeriodKey(frequency, last, anchor) === periodKey) return 'already-billed';
  }

  if (frequency !== 'weekly' && project.billingDayOfMonth) {
    if (now < billingIssueDate(frequency, now, anchor, project.billingDayOfMonth)) return 'before-billing-day';
  }
  return null;
}

// ════════════════════════════════════════════════════════════════════════════
// WORK cycle (tasks)
// ════════════════════════════════════════════════════════════════════════════

export type WorkCycle = 'weekly' | 'monthly';

export interface WorkCycleCandidate {
  workCycle?: unknown;
  isRecurring?: boolean;
  recurringFrequency?: unknown;
  status?: string;
  /** The period CLAIMED (server-owned, written first, in a transaction). */
  workCycleLastPeriodKey?: string | null;
  /** The period whose task writes COMPLETED (server-owned, written last). A
   *  claim without it is a run that died half-way and is resumed, not skipped. */
  workCycleTasksAppliedKey?: string | null;
  lastCompletedAt?: unknown;
  nextRecurringDate?: unknown;
}

/**
 * The project's work cycle. `workCycle` wins when present (`null` / 'none' =
 * explicitly no cycle). A project written before the field existed falls back
 * to the legacy coupling: recurring billing ⇒ the same cycle for the work
 * (weekly stays weekly, every other cycle repeats the work monthly).
 */
export function projectWorkCycle(project: WorkCycleCandidate): WorkCycle | null {
  const w = project.workCycle;
  if (w === 'weekly' || w === 'monthly') return w;
  if (w === null || w === 'none' || w === '') return null;
  if (!project.isRecurring) return null;
  return project.recurringFrequency === 'weekly' ? 'weekly' : 'monthly';
}

/**
 * `{ workCycle }` written explicitly when the project still relies on the
 * legacy fallback — call it before anything switches `isRecurring` off (stop
 * billing, archive), or the fallback would read "no cycle" afterwards and the
 * monthly work would stop with the invoices.
 */
export function materializeWorkCyclePatch(project: WorkCycleCandidate): { workCycle?: WorkCycle | null } {
  if (project.workCycle !== undefined) return {};
  return { workCycle: projectWorkCycle(project) };
}

/** Key of the work period `at` falls in: '2026-10' or 'W2026-10-12'. */
export function workPeriodKey(cycle: WorkCycle, at: Date): string {
  return billingPeriodKey(cycle, at, null);
}

export function workPeriodStart(cycle: WorkCycle, at: Date): Date {
  return billingPeriodStart(cycle, at, null);
}

export function nextWorkPeriodStart(cycle: WorkCycle, at: Date): Date {
  return nextBillingPeriodStart(cycle, at, null);
}

/**
 * Whole work periods from `fromKey` to the period containing `now` (≥ 1 when a
 * new cycle is due), or null when `fromKey` cannot be read. Used to move task
 * dates by the right number of cycles after a gap (the job was down, the
 * project was on hold) instead of always +1.
 */
export function workPeriodsSince(cycle: WorkCycle, fromKey: string, now: Date): number | null {
  if (cycle === 'monthly') {
    const m = /^(\d{4})-(\d{2})$/.exec(fromKey);
    if (!m) return null;
    return zonedMonthIndex(now) - (Number(m[1]) * 12 + Number(m[2]) - 1);
  }
  const m = /^W(\d{4})-(\d{2})-(\d{2})$/.exec(fromKey);
  if (!m) return null;
  const from = zd(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const to = startOfCycleWeek(now);
  return Math.round((to.getTime() - from.getTime()) / (7 * 86_400_000));
}

/**
 * The work period a project is considered to be IN when the job first meets it
 * (no `workCycleLastPeriodKey` yet). Seeding with the CURRENT period makes the
 * rollout a no-op for every live project — nothing is reopened mid-month — with
 * one exception that keeps the old behaviour: a project that is `Completed` with
 * its last completion in an EARLIER period was waiting for the old job's reset,
 * so it is seeded with that earlier period and cycles on this run.
 */
export function seedWorkPeriodKey(cycle: WorkCycle, project: WorkCycleCandidate, now: Date): string {
  const current = workPeriodKey(cycle, now);
  if (project.status === 'Completed') {
    const done = cycleDate(project.lastCompletedAt);
    if (done) {
      if (done < workPeriodStart(cycle, now)) return workPeriodKey(cycle, done);
    }
  }
  return current;
}

export type WorkCycleBlock =
  | 'no-work-cycle'
  | 'terminal-status'
  /** On Hold: the client paused the work; nothing restarts until it is resumed. */
  | 'on-hold'
  /** Planning: the engagement hasn't started, there is no cycle to repeat yet. */
  | 'not-started'
  /** First meeting with the job: the current period was recorded, nothing reopened. */
  | 'seeded'
  | 'already-cycled'
  /** No tasks to repeat (set by the job after reading them). */
  | 'no-tasks';

export const WORK_CYCLE_BLOCK_LABELS: Record<WorkCycleBlock, string> = {
  'no-work-cycle': 'Projekti nuk ka cikël pune',
  'terminal-status': 'Projekti është anuluar ose arkivuar',
  'on-hold': 'Projekti është në pritje — cikli i ri nuk hapet',
  'not-started': 'Projekti është në planifikim — cikli nuk ka nisur',
  'seeded': 'Cikli aktual u regjistrua — i riu hapet në fillim të periudhës tjetër',
  'already-cycled': 'Cikli i kësaj periudhe është hapur',
  'no-tasks': 'Projekti nuk ka detyra për të përsëritur',
};

export function workCycleBlockLabel(reason: string | null | undefined): string {
  if (!reason) return 'Cikli i ri hapet në fillim të periudhës';
  return (WORK_CYCLE_BLOCK_LABELS as Record<string, string>)[reason] ?? reason;
}

/**
 * Why the project's work cycle does NOT start a new period now, or null when
 * it is due. The job seeds on 'seeded' and stamps every other reason.
 */
export function workCycleBlockReason(project: WorkCycleCandidate, now: Date): WorkCycleBlock | null {
  const cycle = projectWorkCycle(project);
  if (!cycle) return 'no-work-cycle';
  if (project.status && TERMINAL_STATUSES.includes(project.status)) return 'terminal-status';
  if (project.status === 'On Hold') return 'on-hold';
  if (project.status === 'Planning') return 'not-started';
  if (!project.workCycleLastPeriodKey) {
    return seedWorkPeriodKey(cycle, project, now) === workPeriodKey(cycle, now) ? 'seeded' : null;
  }
  if (project.workCycleLastPeriodKey === workPeriodKey(cycle, now)) {
    return workCycleClaimUnfinished(project, workPeriodKey(cycle, now)) ? null : 'already-cycled';
  }
  return null;
}

/**
 * The period was CLAIMED but its task writes never completed (the job died
 * between the claim and the last write): `workCycleTasksAppliedKey` is a
 * string that still names an OLDER period. A project that never carried the
 * field (claimed by the job before it existed) is taken as applied — the old
 * job wrote everything in one go.
 */
export function workCycleClaimUnfinished(project: WorkCycleCandidate, periodKey: string): boolean {
  if (project.workCycleLastPeriodKey !== periodKey) return false;
  const applied = project.workCycleTasksAppliedKey;
  return typeof applied === 'string' && applied !== periodKey;
}

export interface WorkCycleTask {
  id?: string;
  status?: string;
  isRecurring?: boolean;
  parentTaskId?: string | null;
  startDate?: unknown;
  endDate?: unknown;
  dueDate?: unknown;
  reminderOffsetMinutes?: number | null;
  /** Day-of-month anchors kept across month clamps (server-written). */
  cycleAnchorStartDay?: number | null;
  cycleAnchorEndDay?: number | null;
  cycleAnchorDueDay?: number | null;
  /** The last work period this task was reopened/carried INTO (server-written):
   *  the per-task idempotency token of the cycle. */
  workCycleAppliedPeriodKey?: string | null;
}

/**
 * What a new work period does to one task:
 *   · 'reopen'            — Done last cycle → Todo, dates moved into the new cycle;
 *   · 'carry'             — not finished → stays open (status kept), dates moved
 *                           into the new cycle and marked "mbartur" — an
 *                           unfinished task never blocks the next month (it used
 *                           to: one open task and the cycle never restarted,
 *                           silently);
 *   · 'own-series'        — a recurring TASK has its own engine (seriesId, after
 *                           completion); reopening it here would fork its series;
 *   · 'parent-own-series' — a SUBTASK of such a tip: it belongs to the
 *                           occurrence it was done under. Reopening it put a Todo
 *                           subtask under a Done parent whose series had already
 *                           moved on to a new occurrence (which has its own
 *                           subtasks or none) — "Done → Todo" is applied to a
 *                           parent and its subtasks together, never to the
 *                           subtasks alone;
 *   · 'applied'           — already reopened/carried into THIS period (a re-run
 *                           after a half-applied run): nothing to write again.
 */
export type WorkCycleTaskAction = 'reopen' | 'carry' | 'own-series' | 'parent-own-series' | 'applied';

export function workCycleTaskAction(
  task: WorkCycleTask,
  opts: { parent?: WorkCycleTask | null; periodKey?: string | null } = {},
): WorkCycleTaskAction {
  if (task.isRecurring) return 'own-series';
  if (task.parentTaskId && opts.parent?.isRecurring) return 'parent-own-series';
  if (opts.periodKey && task.workCycleAppliedPeriodKey === opts.periodKey) return 'applied';
  return task.status === 'Done' ? 'reopen' : 'carry';
}

/**
 * A task date moved by `periods` work cycles (months clamped, never setMonth).
 * `anchorDay` keeps a month-end task on its day: without it 31 Jan -> 28 Feb ->
 * 28 Mar -> ... and the task drifted to the 28th for the rest of the contract.
 */
export function shiftByWorkCycles(value: unknown, cycle: WorkCycle, periods: number, anchorDay?: number | null): Date | null {
  const d = cycleDate(value);
  if (!d || periods <= 0) return d;
  return cycle === 'weekly' ? addCycleDays(d, 7 * periods) : addCycleMonths(d, periods, anchorDay ?? undefined);
}

/**
 * The day-of-month a cycled task date is anchored on. A stored anchor counts
 * only while the date still IS that anchor clamped to its month (28 Feb <- 31):
 * once a person moves the date by hand, the new day becomes the anchor. Null
 * when the date is unusable.
 */
export function resolveCycleAnchorDay(value: unknown, storedAnchor?: number | null): number | null {
  const d = cycleDate(value);
  if (!d) return null;
  const p = zp(d);
  if (typeof storedAnchor === 'number' && storedAnchor >= 1 && storedAnchor <= 31
    && Math.min(storedAnchor, dim(p.year, p.month)) === p.day) return storedAnchor;
  return p.day;
}

/**
 * How many work periods THIS task must move to land in the period containing
 * `now`: the periods between its OWN period (deadline, else start) and the
 * current one. 0 when it is already dated in the current or a later period, or
 * has no usable date — such a task is not moved. Shifting every task by the
 * project's gap pushed a task already planned for this month into next month.
 */
export function taskPeriodsBehind(task: WorkCycleTask, cycle: WorkCycle, now: Date): number {
  const ref = cycleDate(task.endDate) || cycleDate(task.dueDate) || cycleDate(task.startDate);
  if (!ref) return 0;
  if (ref >= workPeriodStart(cycle, now)) return 0;
  const n = workPeriodsSince(cycle, workPeriodKey(cycle, ref), now);
  return n && n > 0 ? n : 0;
}

/** The dates (and month anchors) a cycled task is rewritten with. */
export interface WorkCycleDatePatch {
  startDate?: Date;
  endDate?: Date;
  dueDate?: Date;
  cycleAnchorStartDay?: number;
  cycleAnchorEndDay?: number;
  cycleAnchorDueDay?: number;
}

/**
 * Every date field the task ACTUALLY HAS, moved by `periods` work cycles — each
 * on its own month anchor. `taskPeriodsBehind` reads `endDate ‖ dueDate ‖
 * startDate`, but the job used to rewrite `dueDate` only as a copy of a moved
 * `endDate`: a legacy task that carries only `dueDate` was therefore found
 * "behind" every period, carried again (`carriedOverCount` + 1) and never
 * re-dated. Nothing is invented: a field the task does not have stays absent.
 * `periods <= 0` → `{}` (a task already in the current period is not moved).
 */
export function shiftTaskDatesByWorkCycles(task: WorkCycleTask, cycle: WorkCycle, periods: number): WorkCycleDatePatch {
  if (periods <= 0) return {};
  const out: WorkCycleDatePatch = {};
  const monthly = cycle === 'monthly';
  const move = (value: unknown, storedAnchor: number | null | undefined): { date: Date; anchor: number | null } | null => {
    const anchor = monthly ? resolveCycleAnchorDay(value, storedAnchor) : null;
    const date = shiftByWorkCycles(value, cycle, periods, anchor);
    return date ? { date, anchor } : null;
  };
  const start = move(task.startDate, task.cycleAnchorStartDay);
  if (start) { out.startDate = start.date; if (start.anchor) out.cycleAnchorStartDay = start.anchor; }
  const end = move(task.endDate, task.cycleAnchorEndDay);
  if (end) { out.endDate = end.date; if (end.anchor) out.cycleAnchorEndDay = end.anchor; }
  const due = move(task.dueDate, task.cycleAnchorDueDay);
  if (due) { out.dueDate = due.date; if (due.anchor) out.cycleAnchorDueDay = due.anchor; }
  return out;
}
