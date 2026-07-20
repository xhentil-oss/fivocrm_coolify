/**
 * Gamification — Atomic Habits (James Clear) applied to the Momentum system.
 *
 * Turns the dry MemberMetrics into momentum points, a level, a streak, and
 * earnable badges. The point of the game is behaviour change: make the good
 * habit (deep work, finishing, showing up every day) visible and rewarding.
 *
 * Pure functions — feed it a MemberMetrics + a streak length.
 */

import type { MemberMetrics } from './momentum';

export interface Badge {
  key: string;
  label: string;
  emoji: string;
  earned: boolean;
  hint: string;
}

export interface Level {
  level: number;
  label: string;
  /** Points at which this level starts. */
  floor: number;
  /** Points at which the next level starts (Infinity for the top level). */
  ceil: number;
}

export interface Gamification {
  points: number;
  level: number;
  levelLabel: string;
  /** Points needed to reach the next level (0 if maxed). */
  toNextLevel: number;
  /** 0–100 progress within the current level band. */
  progressToNext: number;
  streakDays: number;
  badges: Badge[];
  earnedCount: number;
}

// Weekly point bands → level. Cumulative-feeling progression without needing to
// persist lifetime totals: your level reflects this window's momentum.
const LEVELS: Level[] = [
  { level: 1, label: 'Fillestar', floor: 0, ceil: 40 },
  { level: 2, label: 'Në ngritje', floor: 40, ceil: 80 },
  { level: 3, label: 'Konsistent', floor: 80, ceil: 140 },
  { level: 4, label: 'Performues', floor: 140, ceil: 220 },
  { level: 5, label: 'Elitë', floor: 220, ceil: 320 },
  { level: 6, label: 'Legjendë', floor: 320, ceil: Infinity },
];

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/**
 * Momentum points for a window. Rewards results (finishing), deep work, showing
 * up (streak) and hitting the levers you control (on-target lead measures).
 */
export function computePoints(m: MemberMetrics, streakDays: number): number {
  const onTargetLeads = m.leadMeasures.filter((l) => l.onTarget).length;
  return Math.round(
    m.productivityScore +          // 0–100 base
      m.tasksCompleted * 3 +        // finishing
      m.deepWorkHours * 1 +         // focus
      onTargetLeads * 5 +           // hitting lead measures (4DX)
      streakDays * 2,               // consistency (Atomic Habits)
  );
}

export function levelForPoints(points: number): Level {
  return LEVELS.find((l) => points >= l.floor && points < l.ceil) || LEVELS[LEVELS.length - 1];
}

/**
 * Streak = consecutive days up to and including today (or yesterday, so a streak
 * survives until end-of-day) that appear in `activeDayKeys` (YYYY-MM-DD, local).
 */
export function computeStreakFromDays(activeDayKeys: Iterable<string>, now: number = Date.now()): number {
  const set = activeDayKeys instanceof Set ? activeDayKeys : new Set(activeDayKeys);
  if (set.size === 0) return 0;
  const key = (d: Date) => d.toLocaleDateString('sv');
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  // Allow the streak to "hold" through today even if today has no activity yet:
  // start counting from today if active, else from yesterday.
  const cursor = new Date(today);
  if (!set.has(key(cursor))) cursor.setDate(cursor.getDate() - 1);

  let streak = 0;
  while (set.has(key(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function buildBadges(m: MemberMetrics, streakDays: number): Badge[] {
  const defs: Omit<Badge, 'earned'>[] = [
    { key: 'deep-worker', label: 'Punëtor i Thellë', emoji: '🧠', hint: '15+ orë deep work në javë' },
    { key: 'streak', label: 'Zjarr', emoji: '🔥', hint: '5+ ditë rresht aktiv' },
    { key: 'on-time', label: 'Në Kohë', emoji: '⏰', hint: '90%+ dorëzime në afat' },
    { key: 'estimator', label: 'Parashikues', emoji: '🎯', hint: '80%+ saktësi estimimi' },
    { key: 'finisher', label: 'Mbarues', emoji: '✅', hint: '8+ detyra të përfunduara' },
    { key: 'winner', label: 'Fitues', emoji: '🏆', hint: 'Score ≥ 70 (po fiton)' },
    { key: 'rising', label: 'Në Ngritje', emoji: '📈', hint: 'Më shumë detyra se javën e kaluar' },
  ];
  const earned: Record<string, boolean> = {
    'deep-worker': m.deepWorkHours >= 15,
    streak: streakDays >= 5,
    'on-time': m.onTimeRate != null && m.onTimeRate >= 0.9,
    estimator: m.estimationAccuracy != null && m.estimationAccuracy >= 0.8,
    finisher: m.tasksCompleted >= 8,
    winner: m.status === 'winning',
    rising: m.tasksCompleted > m.tasksCompletedPrev && m.tasksCompleted > 0,
  };
  return defs.map((d) => ({ ...d, earned: !!earned[d.key] }));
}

export function computeGamification(m: MemberMetrics, streakDays: number): Gamification {
  const points = computePoints(m, streakDays);
  const lvl = levelForPoints(points);
  const bandSize = lvl.ceil === Infinity ? 1 : lvl.ceil - lvl.floor;
  const intoBand = points - lvl.floor;
  const progressToNext = lvl.ceil === Infinity ? 100 : Math.round(clamp((intoBand / bandSize) * 100, 0, 100));
  const toNextLevel = lvl.ceil === Infinity ? 0 : Math.max(0, lvl.ceil - points);
  const badges = buildBadges(m, streakDays);

  return {
    points,
    level: lvl.level,
    levelLabel: lvl.label,
    toNextLevel,
    progressToNext,
    streakDays,
    badges,
    earnedCount: badges.filter((b) => b.earned).length,
  };
}
