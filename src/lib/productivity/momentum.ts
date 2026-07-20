/**
 * Momentum — Productivity engine for FivoCRM.
 *
 * A single, pure, testable source of truth that turns the raw operational data
 * the CRM already stores (tasks, time entries, daily reports, standups, goals)
 * into the measures the best productivity literature says actually move output:
 *
 *  • 4 Disciplines of Execution (McChesney) — LEAD vs LAG measures + a scoreboard
 *    that answers "A po fitojmë?" at a glance. We reward the lead measures (focus
 *    hours, deep-work sessions, reporting cadence, planning discipline) because
 *    those are the levers a person controls day to day; the lags (throughput,
 *    on-time, cycle time) follow.
 *  • Deep Work (Newport) — deep-work hours & sessions (≥ one pomodoro long).
 *  • Atomic Habits (Clear) — cadence/consistency of reporting as a habit streak.
 *  • Getting Things Done / Kanban — estimation accuracy, cycle time, WIP
 *    (Little's Law: WIP ≈ throughput × cycle-time → chronic overload is visible).
 *
 * No React, no Firestore, no I/O — feed it plain arrays and a time window.
 */

import { getTimestampMs } from '../utils';
import { entryDurationMinutes } from '../timeTracking';
import type { Task, TimeEntry, DailyReport, Goal, StandupEntry } from '../../types';

// ────────────────────────────────────────────────────────────────────────────
// Config
// ────────────────────────────────────────────────────────────────────────────

export interface MomentumTargets {
  /** Deep-work hours per week considered "winning" (Newport: 15–20h is elite). */
  focusHours: number;
  /** Deep-work sessions (≥ minSessionMinutes) per week. */
  deepWorkSessions: number;
  /** Reporting/standup days per week (4DX cadence of accountability). */
  reportDays: number;
  /** Tasks completed per week (lag target). */
  throughput: number;
  /** Fraction of active tasks that carry an estimate (planning discipline). */
  estimateCoverage: number;
  /** A "deep-work" session must last at least this many minutes (1 pomodoro). */
  minSessionMinutes: number;
}

export const DEFAULT_TARGETS: MomentumTargets = {
  focusHours: 20,
  deepWorkSessions: 12,
  reportDays: 5,
  throughput: 8,
  estimateCoverage: 0.8,
  minSessionMinutes: 25,
};

/**
 * Score weights — deliberately lead-heavy. 4DX: you cannot manage a lag, only a
 * lead; so ~55% of the score comes from levers the person controls right now.
 * Must sum to 1.
 */
export const SCORE_WEIGHTS = {
  focus: 0.22,        // lead
  consistency: 0.18,  // lead
  deepWork: 0.15,     // lead
  onTime: 0.15,       // lag
  throughput: 0.15,   // lag
  estimation: 0.15,   // lead (planning quality)
} as const;

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

export interface MomentumMember {
  userId: string;
  name: string;
  role?: string;
}

export interface MomentumInput {
  members: MomentumMember[];
  tasks: Task[];
  timeEntries: TimeEntry[];
  dailyReports?: DailyReport[];
  standups?: StandupEntry[];
  goals?: Goal[];
  /** Window start (inclusive), epoch ms. */
  rangeStart: number;
  /** Window end (inclusive), epoch ms. */
  rangeEnd: number;
  targets?: Partial<MomentumTargets>;
}

export interface LeadMeasure {
  key: string;
  label: string;
  value: number;
  target: number;
  unit: string;
  /** value / target as a 0–100 percentage (capped at 100 for display bars). */
  pct: number;
  onTarget: boolean;
}

export type MemberStatus = 'winning' | 'ontrack' | 'behind';

export interface MemberMetrics {
  userId: string;
  name: string;
  role?: string;

  // ── Raw measures ──
  trackedHours: number;
  deepWorkHours: number;
  deepWorkSessions: number;
  reportDays: number;
  expectedReportDays: number;
  tasksCompleted: number;
  tasksCompletedPrev: number;
  /** null when there were no due-dated completed tasks in the window. */
  onTimeRate: number | null;
  /** Average days from start/created → done, for tasks completed in window. */
  cycleTimeDays: number | null;
  /** Fraction of currently-active tasks that carry an estimate. */
  estimateCoverage: number;
  /** 0–1 forecast quality (1 = estimate matched actual exactly). null if none. */
  estimationAccuracy: number | null;
  avgEstimatedHours: number | null;
  avgActualHours: number | null;
  /** Work in progress right now (In Progress status). */
  wip: number;
  /** deepWorkHours / trackedHours, 0–1. null if no tracked time. */
  focusRatio: number | null;

  // ── Sub-scores (0–100) ──
  scoreFocus: number;
  scoreConsistency: number;
  scoreDeepWork: number;
  scoreOnTime: number;
  scoreThroughput: number;
  scoreEstimation: number;

  /** Weighted overall productivity score, 0–100. */
  productivityScore: number;
  status: MemberStatus;

  /** The 4DX scoreboard rows — the levers this person controls. */
  leadMeasures: LeadMeasure[];
}

export interface TeamMomentum {
  members: MemberMetrics[];
  teamScore: number;
  totalTrackedHours: number;
  totalDeepWorkHours: number;
  totalCompleted: number;
  totalCompletedPrev: number;
  avgOnTimeRate: number | null;
  avgCycleTimeDays: number | null;
  avgEstimationAccuracy: number | null;
  totalWip: number;
  winningCount: number;
  targets: MomentumTargets;
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const clamp100 = (n: number) => clamp(n, 0, 100);
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Local YYYY-MM-DD key (matches the app's `toLocaleDateString('sv')` convention). */
function dateKey(ms: number): string {
  return new Date(ms).toLocaleDateString('sv');
}

/** Count Mon–Fri days in [start, end], never past `now`. */
function weekdaysInRange(start: number, end: number, now: number): number {
  const last = Math.min(end, now);
  if (last < start) return 0;
  let count = 0;
  const d = new Date(start);
  d.setHours(0, 0, 0, 0);
  const lastDay = new Date(last);
  lastDay.setHours(0, 0, 0, 0);
  while (d.getTime() <= lastDay.getTime()) {
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) count++;
    d.setDate(d.getDate() + 1);
  }
  return count;
}

function inRange(ms: number, start: number, end: number): boolean {
  return ms >= start && ms <= end;
}

/** The primary due date the rest of the app uses (endDate wins over dueDate). */
function taskDue(task: Task): number {
  return getTimestampMs((task as any).endDate) || getTimestampMs(task.dueDate);
}

// ────────────────────────────────────────────────────────────────────────────
// Core
// ────────────────────────────────────────────────────────────────────────────

/**
 * Compute per-member and team-level momentum for a single time window.
 * `now` is injectable for testing; defaults to the current clock.
 */
export function computeMomentum(input: MomentumInput, now: number = Date.now()): TeamMomentum {
  const targets: MomentumTargets = { ...DEFAULT_TARGETS, ...(input.targets || {}) };
  const { rangeStart, rangeEnd } = input;
  const windowMs = Math.max(1, rangeEnd - rangeStart);
  const prevStart = rangeStart - windowMs;
  const prevEnd = rangeStart - 1;

  // Pre-index time entries by user and by task (actual = source-of-truth minutes).
  const tasks = input.tasks || [];
  const entries = input.timeEntries || [];
  const reports = input.dailyReports || [];
  const standups = input.standups || [];

  const actualMinutesByTask = new Map<string, number>();
  for (const e of entries) {
    if (!e.taskId) continue;
    actualMinutesByTask.set(e.taskId, (actualMinutesByTask.get(e.taskId) || 0) + entryDurationMinutes(e));
  }

  const members = input.members.map((m) =>
    computeMemberMetrics(m, {
      tasks,
      entries,
      reports,
      standups,
      actualMinutesByTask,
      rangeStart,
      rangeEnd,
      prevStart,
      prevEnd,
      now,
      targets,
    }),
  );

  members.sort((a, b) => b.productivityScore - a.productivityScore);

  // Team aggregates
  const totalTrackedHours = round1(sum(members, (m) => m.trackedHours));
  const totalDeepWorkHours = round1(sum(members, (m) => m.deepWorkHours));
  const totalCompleted = sum(members, (m) => m.tasksCompleted);
  const totalCompletedPrev = sum(members, (m) => m.tasksCompletedPrev);
  const totalWip = sum(members, (m) => m.wip);
  const teamScore = members.length ? Math.round(avg(members.map((m) => m.productivityScore))) : 0;

  const onTimeVals = members.map((m) => m.onTimeRate).filter((v): v is number => v != null);
  const cycleVals = members.map((m) => m.cycleTimeDays).filter((v): v is number => v != null);
  const estVals = members.map((m) => m.estimationAccuracy).filter((v): v is number => v != null);

  return {
    members,
    teamScore,
    totalTrackedHours,
    totalDeepWorkHours,
    totalCompleted,
    totalCompletedPrev,
    avgOnTimeRate: onTimeVals.length ? avg(onTimeVals) : null,
    avgCycleTimeDays: cycleVals.length ? round1(avg(cycleVals)) : null,
    avgEstimationAccuracy: estVals.length ? avg(estVals) : null,
    totalWip,
    winningCount: members.filter((m) => m.status === 'winning').length,
    targets,
  };
}

interface MemberCtx {
  tasks: Task[];
  entries: TimeEntry[];
  reports: DailyReport[];
  standups: StandupEntry[];
  actualMinutesByTask: Map<string, number>;
  rangeStart: number;
  rangeEnd: number;
  prevStart: number;
  prevEnd: number;
  now: number;
  targets: MomentumTargets;
}

function computeMemberMetrics(member: MomentumMember, ctx: MemberCtx): MemberMetrics {
  const { userId } = member;
  const { rangeStart, rangeEnd, prevStart, prevEnd, targets, now } = ctx;

  // ── Time: tracked & deep-work ──
  let trackedMinutes = 0;
  let deepWorkMinutes = 0;
  let deepWorkSessions = 0;
  const activeDayKeys = new Set<string>();
  for (const e of ctx.entries) {
    if (e.userId !== userId) continue;
    const start = getTimestampMs(e.startTime);
    if (!inRange(start, rangeStart, rangeEnd)) continue;
    const mins = entryDurationMinutes(e);
    if (mins <= 0) continue;
    trackedMinutes += mins;
    activeDayKeys.add(dateKey(start));
    if (mins >= targets.minSessionMinutes || e.isPomodoroSession) {
      deepWorkMinutes += mins;
      deepWorkSessions++;
    }
  }
  const trackedHours = round1(trackedMinutes / 60);
  const deepWorkHours = round1(deepWorkMinutes / 60);
  const focusRatio = trackedMinutes > 0 ? deepWorkMinutes / trackedMinutes : null;

  // ── Cadence: distinct reporting days (daily report or standup) in window ──
  const reportDayKeys = new Set<string>();
  for (const r of ctx.reports) {
    if (r.userId !== userId || !r.date) continue;
    const ms = new Date(r.date + 'T12:00:00').getTime();
    if (inRange(ms, rangeStart, rangeEnd)) reportDayKeys.add(r.date);
  }
  for (const s of ctx.standups) {
    if (s.userId !== userId || !s.date) continue;
    const ms = new Date(s.date + 'T12:00:00').getTime();
    if (inRange(ms, rangeStart, rangeEnd)) reportDayKeys.add(s.date);
  }
  const reportDays = reportDayKeys.size;
  const expectedReportDays = Math.max(1, Math.min(targets.reportDays, weekdaysInRange(rangeStart, rangeEnd, now)));

  // ── Task-derived measures ──
  const myTasks = ctx.tasks.filter((t) => t.assignedToUserId === userId && !t.parentTaskId);

  const completedInWindow = myTasks.filter(
    (t) => t.status === 'Done' && inRange(getTimestampMs(t.updatedAt), rangeStart, rangeEnd),
  );
  const completedPrev = myTasks.filter(
    (t) => t.status === 'Done' && inRange(getTimestampMs(t.updatedAt), prevStart, prevEnd),
  ).length;

  // On-time delivery (lag): of completed-with-a-due-date, fraction done on/before due.
  const dueCompleted = completedInWindow.filter((t) => taskDue(t) > 0);
  const onTimeRate = dueCompleted.length
    ? dueCompleted.filter((t) => getTimestampMs(t.updatedAt) <= endOfDay(taskDue(t))).length / dueCompleted.length
    : null;

  // Cycle time (lag): start/created → done, in days.
  const cycleDurations = completedInWindow
    .map((t) => {
      const from = getTimestampMs((t as any).startDate) || getTimestampMs(t.createdAt);
      const to = getTimestampMs(t.updatedAt);
      if (!from || !to || to < from) return null;
      return (to - from) / 86_400_000;
    })
    .filter((d): d is number => d != null);
  const cycleTimeDays = cycleDurations.length ? round1(avg(cycleDurations)) : null;

  // Planning discipline (lead): share of active tasks carrying an estimate.
  const activeTasks = myTasks.filter((t) => t.status !== 'Done');
  const estimateCoverage = activeTasks.length
    ? activeTasks.filter((t) => (t.estimatedHours ?? 0) > 0).length / activeTasks.length
    : 0;

  // WIP (Little's Law): tasks currently In Progress.
  const wip = myTasks.filter((t) => t.status === 'In Progress').length;

  // Estimation accuracy (measurability): completed tasks with both an estimate and
  // real tracked time. accuracy = 1 − clamp(|est − act| / est, 0, 1).
  const estimated: number[] = [];
  const actual: number[] = [];
  const accuracies: number[] = [];
  for (const t of completedInWindow) {
    const est = t.estimatedHours ?? 0;
    const actHours = (ctx.actualMinutesByTask.get(t.id) || 0) / 60;
    if (est > 0 && actHours > 0) {
      estimated.push(est);
      actual.push(actHours);
      accuracies.push(1 - clamp(Math.abs(est - actHours) / est, 0, 1));
    }
  }
  const estimationAccuracy = accuracies.length ? avg(accuracies) : null;
  const avgEstimatedHours = estimated.length ? round1(avg(estimated)) : null;
  const avgActualHours = actual.length ? round1(avg(actual)) : null;

  // ── Sub-scores (0–100) ──
  const scoreFocus = clamp100((deepWorkHours / targets.focusHours) * 100);
  const scoreConsistency = clamp100((reportDays / expectedReportDays) * 100);
  const scoreDeepWork = clamp100((deepWorkSessions / targets.deepWorkSessions) * 100);
  // Neutral (70) when there is nothing to judge yet — never penalise absence of data.
  const scoreOnTime = onTimeRate == null ? 70 : clamp100(onTimeRate * 100);
  const scoreThroughput = clamp100((completedInWindow.length / targets.throughput) * 100);
  const scoreEstimation = estimationAccuracy == null ? 70 : clamp100(estimationAccuracy * 100);

  const productivityScore = Math.round(
    scoreFocus * SCORE_WEIGHTS.focus +
      scoreConsistency * SCORE_WEIGHTS.consistency +
      scoreDeepWork * SCORE_WEIGHTS.deepWork +
      scoreOnTime * SCORE_WEIGHTS.onTime +
      scoreThroughput * SCORE_WEIGHTS.throughput +
      scoreEstimation * SCORE_WEIGHTS.estimation,
  );

  const status: MemberStatus =
    productivityScore >= 70 ? 'winning' : productivityScore >= 50 ? 'ontrack' : 'behind';

  const leadMeasures: LeadMeasure[] = [
    mkLead('focus', 'Orë Fokusi (Deep Work)', deepWorkHours, targets.focusHours, 'h'),
    mkLead('sessions', 'Sesione Deep Work', deepWorkSessions, targets.deepWorkSessions, ''),
    mkLead('cadence', 'Kadenca e raporteve', reportDays, expectedReportDays, 'ditë'),
    mkLead('planning', 'Planifikim (estimime)', Math.round(estimateCoverage * 100), Math.round(targets.estimateCoverage * 100), '%'),
  ];

  return {
    userId,
    name: member.name,
    role: member.role,
    trackedHours,
    deepWorkHours,
    deepWorkSessions,
    reportDays,
    expectedReportDays,
    tasksCompleted: completedInWindow.length,
    tasksCompletedPrev: completedPrev,
    onTimeRate,
    cycleTimeDays,
    estimateCoverage,
    estimationAccuracy,
    avgEstimatedHours,
    avgActualHours,
    wip,
    focusRatio,
    scoreFocus: Math.round(scoreFocus),
    scoreConsistency: Math.round(scoreConsistency),
    scoreDeepWork: Math.round(scoreDeepWork),
    scoreOnTime: Math.round(scoreOnTime),
    scoreThroughput: Math.round(scoreThroughput),
    scoreEstimation: Math.round(scoreEstimation),
    productivityScore,
    status,
    leadMeasures,
  };
}

function mkLead(key: string, label: string, value: number, target: number, unit: string): LeadMeasure {
  const pct = target > 0 ? clamp100((value / target) * 100) : 0;
  return { key, label, value: round1(value), target, unit, pct: Math.round(pct), onTarget: value >= target };
}

function endOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

// ────────────────────────────────────────────────────────────────────────────
// Trend — the same engine over N sliding weekly windows (for the line chart).
// ────────────────────────────────────────────────────────────────────────────

export interface TrendPoint {
  label: string;
  teamScore: number;
  completed: number;
  deepWorkHours: number;
}

/**
 * Compute momentum over the last `weeks` seven-day windows ending at `rangeEnd`.
 * Returns oldest-first. Reuses `computeMomentum` so the trend can never diverge
 * from the headline numbers.
 */
export function computeMomentumTrend(
  base: Omit<MomentumInput, 'rangeStart' | 'rangeEnd'>,
  rangeEnd: number,
  weeks: number,
  now: number = Date.now(),
): TrendPoint[] {
  const WEEK = 7 * 86_400_000;
  const points: TrendPoint[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const end = rangeEnd - i * WEEK;
    const start = end - WEEK + 1;
    const t = computeMomentum({ ...base, rangeStart: start, rangeEnd: end }, now);
    const d = new Date(end);
    points.push({
      label: `${d.getDate()}/${d.getMonth() + 1}`,
      teamScore: t.teamScore,
      completed: t.totalCompleted,
      deepWorkHours: t.totalDeepWorkHours,
    });
  }
  return points;
}

// ────────────────────────────────────────────────────────────────────────────
// Small numeric utils
// ────────────────────────────────────────────────────────────────────────────

function sum<T>(arr: T[], f: (t: T) => number): number {
  return arr.reduce((s, t) => s + f(t), 0);
}
function avg(arr: number[]): number {
  return arr.length ? arr.reduce((s, n) => s + n, 0) / arr.length : 0;
}
