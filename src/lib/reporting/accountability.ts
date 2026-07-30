/**
 * Team accountability — employee metrics from data the CRM already holds.
 *
 * The product rule from the spec (§8) is deliberately encoded here: **do not reduce
 * a person to a productivity number.** So:
 *
 *   • `computeEmployeeMetrics()` returns ~20 contextual metrics, not a score.
 *   • `compositeScore()` exists because agencies ask for one, but it is opt-in, its
 *     weights are explicit, and it returns `null` when there isn't enough data to
 *     be fair. The UI that renders it must show `COMPOSITE_WARNING`.
 *   • Trends are first-class (`computeTrend`), because "3 missing reports" means
 *     something different for someone improving than for someone sliding.
 *
 * Pure functions over already-fetched arrays: the same code powers the dashboard and
 * the nightly rollup into `employeeReportScores`.
 */

import type {
  DailyReport,
  EmployeeAccountabilityMetrics,
  Report,
  ReportPeriod,
  Task,
  TimeEntry,
} from '../../types';
import { isWithinPeriod, workingDaysInPeriod } from './period';
// Reuse the existing time-tracking authority: minutes are ALWAYS derived from
// endTime − startTime, never from the denormalised `duration` field (see
// src/lib/timeTracking.ts for why).
import { entryDurationMinutes } from '../timeTracking';

/** Everything needed to evaluate one person over one period. */
export interface AccountabilityInput {
  userId: string;
  period: ReportPeriod;
  /** The person's daily reports (any range — filtered here). */
  dailyReports: DailyReport[];
  /** Rich reports authored by (or about) the person. */
  reports?: Report[];
  /** Tasks assigned to the person. */
  tasks?: Task[];
  /** Time entries logged by the person. */
  timeEntries?: TimeEntry[];
  /** Working weekdays (ISO 1–7). Defaults Mon–Fri. */
  workingDays?: number[];
  /** Tenant holidays (ISO dates) excluded from the expected-report denominator. */
  holidays?: string[];
  /** Contracted hours per working day, for utilisation. Defaults 8. */
  contractedHoursPerDay?: number;
  /** Project ids currently RAG-red/yellow, to count "projects at risk". */
  atRiskProjectIds?: string[];
  /** Reference "now" — injected so tests and cron runs are deterministic. */
  now: Date;
}

const MS_HOUR = 3_600_000;

/**
 * Compute the contextual metric set. Every counter is derived from real documents;
 * nothing is estimated.
 */
export function computeEmployeeMetrics(input: AccountabilityInput): EmployeeAccountabilityMetrics {
  const { period, userId } = input;
  const workDays = workingDaysInPeriod(period, input.workingDays, input.holidays);
  const contracted = input.contractedHoursPerDay ?? 8;

  const mine = (input.dailyReports || []).filter(r => r.userId === userId && isWithinPeriod(r.date, period));
  const submitted = mine.filter(r => !r.generatedBySystem || !!r.submittedAt);

  // Expected reports only count working days that have already passed — a person is
  // not "missing" tomorrow's report.
  const todayIso = toIso(input.now);
  const elapsedWorkDays = workDays.filter(d => d <= todayIso);
  const reportedDates = new Set(submitted.map(r => r.date));
  const missing = elapsedWorkDays.filter(d => !reportedDates.has(d));

  const late = submitted.filter(r => r.wasLate === true
    || (r.submittedAt && r.dueAt && r.submittedAt.getTime() > r.dueAt.getTime()));

  const delays = submitted
    .map(r => (r.submittedAt && r.dueAt ? (r.submittedAt.getTime() - r.dueAt.getTime()) / 60000 : null))
    .filter((v): v is number => v !== null);

  // ── Tasks ──
  // FivoCRM has no `completedAt` column: a task is done when `status === 'Done'`,
  // and `updatedAt` is the completion moment. This is the same convention the
  // Momentum engine uses (src/lib/productivity/momentum.ts), so the two features
  // can never disagree about what "completed this week" means.
  const tasks = input.tasks || [];
  const doneAt = (t: Task): Date | undefined => (t.status === 'Done' ? t.updatedAt : undefined);
  const completedInPeriod = tasks.filter(t => {
    const d = doneAt(t);
    return !!d && isWithinPeriod(toIso(d), period);
  });
  const overdue = tasks.filter(t => t.status !== 'Done'
    && t.endDate && t.endDate.getTime() < input.now.getTime());
  const missedDeadlines = completedInPeriod.filter(t =>
    t.endDate && t.updatedAt.getTime() > t.endDate.getTime());
  // Reopen tracking does not exist on `tasks` yet (no status history is persisted).
  // The metric reads an optional counter so it lights up the day one is written,
  // and reports 0 — never a guess — until then. See REPORTING_MODULE.md §Limitations.
  const reopened = tasks.filter(t => Number((t as any).reopenCount || 0) > 0);

  const openAtEnd = completedInPeriod.length + overdue.length;
  const completionRate = openAtEnd > 0 ? completedInPeriod.length / openAtEnd : null;

  // ── Hours ──
  // Prefer time entries (the system of record); fall back to self-reported hours
  // from daily reports when no tracker was used.
  const entries = (input.timeEntries || []).filter(e =>
    e.userId === userId && e.startTime && isWithinPeriod(toIso(e.startTime), period));

  let hoursWorked = 0;
  let billableHours = 0;
  if (entries.length) {
    for (const e of entries) {
      const hrs = entryDurationMinutes(e) / 60;
      hoursWorked += hrs;
      if (e.isBillable !== false) billableHours += hrs;
    }
  } else {
    for (const r of submitted) {
      hoursWorked += r.hoursWorked || 0;
      billableHours += r.billableHours ?? 0;
    }
    // No per-report split recorded at all → billable is unknown, not zero.
    if (!submitted.some(r => r.billableHours !== undefined)) billableHours = 0;
  }
  const reportedNonBillable = submitted.reduce((s, r) => s + (r.nonBillableHours || 0), 0);
  const nonBillableHours = reportedNonBillable > 0
    ? reportedNonBillable
    : Math.max(0, round1(hoursWorked - billableHours));

  const capacity = elapsedWorkDays.length * contracted;
  const utilisationRate = capacity > 0 && hoursWorked > 0
    ? round2(billableHours / capacity)
    : null;

  // ── Blockers ──
  const withBlockers = submitted.filter(r => (r.blockers || '').trim().length > 0);
  const unresolved = withBlockers.filter(r => !r.blockerResolvedAt);
  const resolutionHours = withBlockers
    .filter(r => r.blockerResolvedAt)
    .map(r => (r.blockerResolvedAt!.getTime() - (r.submittedAt || r.createdAt).getTime()) / MS_HOUR)
    .filter(h => h >= 0);

  // ── Reports authored ──
  const weeklyReports = (input.reports || []).filter(r =>
    r.kind === 'weekly-staff'
    && (r.subjectUserId === userId || r.authorUserId === userId)
    && isWithinPeriod(r.period.start, period)
    && !!r.submittedAt);

  // ── Approval responsiveness (as a reviewer/approver) ──
  const awaitingMe = (input.reports || []).filter(r =>
    (r.reviewerUserId === userId || r.approverUserId === userId) && r.submittedAt);
  const approvalDelays = awaitingMe
    .map(r => {
      const end = r.internallyApprovedAt || r.reviewedAt || input.now;
      return (end.getTime() - r.submittedAt!.getTime()) / MS_HOUR;
    })
    .filter(h => h >= 0);

  const projectsAtRisk = countProjectsAtRisk(submitted, input.atRiskProjectIds || []);

  return {
    expectedDailyReports: elapsedWorkDays.length,
    submittedDailyReports: submitted.length,
    missingDailyReports: missing.length,
    lateDailyReports: late.length,
    submittedWeeklyReports: weeklyReports.length,
    avgSubmissionDelayMinutes: delays.length ? Math.round(mean(delays)) : null,
    tasksCompleted: completedInPeriod.length,
    tasksOverdue: overdue.length,
    completionRate: completionRate === null ? null : round2(completionRate),
    hoursWorked: round1(hoursWorked),
    billableHours: round1(billableHours),
    nonBillableHours: round1(nonBillableHours),
    utilisationRate,
    blockersReported: withBlockers.length,
    blockersUnresolved: unresolved.length,
    avgBlockerResolutionHours: resolutionHours.length ? round1(mean(resolutionHours)) : null,
    projectsAtRisk,
    reopenedTasks: reopened.length,
    missedDeadlines: missedDeadlines.length,
    approvalDelaysHours: approvalDelays.length ? round1(mean(approvalDelays)) : null,
  };
}

function countProjectsAtRisk(reports: DailyReport[], atRisk: string[]): number {
  if (!atRisk.length) return 0;
  const touched = new Set<string>();
  for (const r of reports) for (const p of r.projectIds || []) if (atRisk.includes(p)) touched.add(p);
  return touched.size;
}

/** Submission rate — the headline compliance number. Null when nothing was expected. */
export function submissionRate(m: EmployeeAccountabilityMetrics): number | null {
  if (m.expectedDailyReports <= 0) return null;
  return round2(Math.min(1, m.submittedDailyReports / m.expectedDailyReports));
}

/** Weights for the optional composite. Every term is visible and adjustable. */
export interface CompositeWeights {
  submission: number;
  punctuality: number;
  delivery: number;
  utilisation: number;
  blockerHygiene: number;
}

export const DEFAULT_COMPOSITE_WEIGHTS: CompositeWeights = {
  submission: 30,
  punctuality: 15,
  delivery: 30,
  utilisation: 15,
  blockerHygiene: 10,
};

/**
 * The warning any UI showing `compositeScore` must display verbatim. It is part of
 * the contract, not decoration: a single number about a person invites misuse.
 */
export const COMPOSITE_WARNING =
  'Rezultati është tregues, jo vlerësim. Interpretohet vetëm së bashku me kontekstin '
  + '(lejet, ngarkesa, tipi i punës) dhe me komentin e menaxherit.';

/**
 * Optional composite score, 0–100. Returns null when fewer than three components
 * have data — a "score" built from one metric is worse than no score.
 */
export function compositeScore(
  m: EmployeeAccountabilityMetrics,
  weights: CompositeWeights = DEFAULT_COMPOSITE_WEIGHTS,
): number | null {
  const parts: Array<{ w: number; v: number }> = [];

  const sub = submissionRate(m);
  if (sub !== null) parts.push({ w: weights.submission, v: sub });

  if (m.submittedDailyReports > 0) {
    parts.push({ w: weights.punctuality, v: 1 - Math.min(1, m.lateDailyReports / m.submittedDailyReports) });
  }
  if (m.completionRate !== null) parts.push({ w: weights.delivery, v: m.completionRate });
  if (m.utilisationRate !== null) {
    // Utilisation is not "higher is always better": 0.75–0.9 is healthy, above 1.0
    // means overload. Peak at 0.85, decaying either side.
    const u = m.utilisationRate;
    const v = u <= 0.85 ? u / 0.85 : Math.max(0, 1 - (u - 0.85) / 0.5);
    parts.push({ w: weights.utilisation, v: Math.max(0, Math.min(1, v)) });
  }
  if (m.blockersReported > 0) {
    parts.push({ w: weights.blockerHygiene, v: 1 - Math.min(1, m.blockersUnresolved / m.blockersReported) });
  }

  if (parts.length < 3) return null;
  const totalW = parts.reduce((s, p) => s + p.w, 0);
  return Math.round((parts.reduce((s, p) => s + p.v * p.w, 0) / totalW) * 100);
}

export type TrendDirection = 'improving' | 'stable' | 'declining' | 'unknown';

/** Compare two periods on one metric, direction-aware. */
export function computeTrend(
  current: number | null,
  previous: number | null,
  higherIsBetter = true,
  tolerance = 0.05,
): { direction: TrendDirection; change: number | null } {
  if (current === null || previous === null) return { direction: 'unknown', change: null };
  const change = current - previous;
  const base = Math.abs(previous) || 1;
  if (Math.abs(change) / base < tolerance) return { direction: 'stable', change };
  const better = higherIsBetter ? change > 0 : change < 0;
  return { direction: better ? 'improving' : 'declining', change };
}

/** A person who needs a manager's attention, with the reason spelled out. */
export interface AttentionFlag {
  userId: string;
  severity: 'high' | 'medium';
  reasons: string[];
}

/**
 * Who needs support this week. Ordered worst-first, with reasons — the team-leader
 * dashboard renders these directly rather than sorting by a score.
 */
export function flagNeedsAttention(
  entries: Array<{ userId: string; metrics: EmployeeAccountabilityMetrics }>,
): AttentionFlag[] {
  const flags: AttentionFlag[] = [];
  for (const { userId, metrics: m } of entries) {
    const reasons: string[] = [];
    let score = 0;

    if (m.missingDailyReports >= 3) { reasons.push(`${m.missingDailyReports} raporte ditore mungojnë`); score += 3; }
    else if (m.missingDailyReports > 0) { reasons.push(`${m.missingDailyReports} raporte ditore mungojnë`); score += 1; }

    if (m.blockersUnresolved >= 2) { reasons.push(`${m.blockersUnresolved} bllokues të pazgjidhur`); score += 3; }
    else if (m.blockersUnresolved === 1) { reasons.push('1 bllokues i pazgjidhur'); score += 1; }

    if (m.tasksOverdue >= 5) { reasons.push(`${m.tasksOverdue} detyra të vonuara`); score += 2; }
    if (m.projectsAtRisk > 0) { reasons.push(`${m.projectsAtRisk} projekte në rrezik`); score += 2; }
    if (m.utilisationRate !== null && m.utilisationRate > 1.1) {
      reasons.push(`Mbingarkesë: utilizim ${Math.round(m.utilisationRate * 100)}%`);
      score += 2;
    }
    if (m.lateDailyReports >= 3) { reasons.push(`${m.lateDailyReports} raporte të vonuara`); score += 1; }

    if (reasons.length) flags.push({ userId, severity: score >= 4 ? 'high' : 'medium', reasons });
  }
  return flags.sort((a, b) => (a.severity === b.severity ? b.reasons.length - a.reasons.length : a.severity === 'high' ? -1 : 1));
}

/** Team-level rollup for the team-leader dashboard. */
export interface TeamAccountabilitySummary {
  members: number;
  expectedReports: number;
  submittedReports: number;
  submissionRate: number | null;
  missingReports: number;
  lateReports: number;
  unresolvedBlockers: number;
  overdueTasks: number;
  totalHours: number;
  billableHours: number;
  billableUtilisation: number | null;
}

export function summariseTeam(
  entries: Array<{ userId: string; metrics: EmployeeAccountabilityMetrics }>,
): TeamAccountabilitySummary {
  const sum = (pick: (m: EmployeeAccountabilityMetrics) => number) =>
    entries.reduce((s, e) => s + pick(e.metrics), 0);

  const expected = sum(m => m.expectedDailyReports);
  const submitted = sum(m => m.submittedDailyReports);
  const hours = sum(m => m.hoursWorked);
  const billable = sum(m => m.billableHours);

  return {
    members: entries.length,
    expectedReports: expected,
    submittedReports: submitted,
    submissionRate: expected > 0 ? round2(Math.min(1, submitted / expected)) : null,
    missingReports: sum(m => m.missingDailyReports),
    lateReports: sum(m => m.lateDailyReports),
    unresolvedBlockers: sum(m => m.blockersUnresolved),
    overdueTasks: sum(m => m.tasksOverdue),
    totalHours: round1(hours),
    billableHours: round1(billable),
    billableUtilisation: hours > 0 ? round2(billable / hours) : null,
  };
}

// ── helpers ──
function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;
