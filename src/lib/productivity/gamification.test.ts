import { describe, it, expect } from 'vitest';
import { computeGamification, computePoints, levelForPoints, computeStreakFromDays } from './gamification';
import type { MemberMetrics } from './momentum';

const NOW = new Date('2026-07-20T12:00:00').getTime(); // Monday

function metrics(p: Partial<MemberMetrics> = {}): MemberMetrics {
  return {
    userId: 'u1', name: 'Ana',
    trackedHours: 0, deepWorkHours: 0, deepWorkSessions: 0,
    reportDays: 0, expectedReportDays: 5,
    tasksCompleted: 0, tasksCompletedPrev: 0,
    onTimeRate: null, cycleTimeDays: null,
    estimateCoverage: 0, estimationAccuracy: null, avgEstimatedHours: null, avgActualHours: null,
    wip: 0, focusRatio: null,
    scoreFocus: 0, scoreConsistency: 0, scoreDeepWork: 0, scoreOnTime: 0, scoreThroughput: 0, scoreEstimation: 0,
    productivityScore: 0, status: 'behind',
    leadMeasures: [
      { key: 'focus', label: 'f', value: 0, target: 20, unit: 'h', pct: 0, onTarget: false },
      { key: 'sessions', label: 's', value: 0, target: 12, unit: '', pct: 0, onTarget: false },
      { key: 'cadence', label: 'c', value: 0, target: 5, unit: 'ditë', pct: 0, onTarget: false },
      { key: 'planning', label: 'p', value: 0, target: 80, unit: '%', pct: 0, onTarget: false },
    ],
    ...p,
  };
}

describe('computeStreakFromDays', () => {
  it('counts consecutive days ending today', () => {
    expect(computeStreakFromDays(['2026-07-20', '2026-07-19', '2026-07-18'], NOW)).toBe(3);
  });
  it('holds through today when only yesterday is active', () => {
    expect(computeStreakFromDays(['2026-07-19', '2026-07-18'], NOW)).toBe(2);
  });
  it('breaks on a gap', () => {
    expect(computeStreakFromDays(['2026-07-20', '2026-07-18'], NOW)).toBe(1);
  });
  it('is 0 for empty', () => {
    expect(computeStreakFromDays([], NOW)).toBe(0);
  });
});

describe('levelForPoints', () => {
  it('maps bands', () => {
    expect(levelForPoints(0).level).toBe(1);
    expect(levelForPoints(39).level).toBe(1);
    expect(levelForPoints(40).level).toBe(2);
    expect(levelForPoints(999).level).toBe(6);
  });
});

describe('computePoints', () => {
  it('rewards score, finishing, focus, streak, on-target leads', () => {
    const m = metrics({
      productivityScore: 50,
      tasksCompleted: 5,
      deepWorkHours: 10,
      leadMeasures: metrics().leadMeasures.map((l, i) => ({ ...l, onTarget: i < 2 })), // 2 on target
    });
    // 50 + 5*3 + 10*1 + 2*5 + 3*2 = 50+15+10+10+6 = 91
    expect(computePoints(m, 3)).toBe(91);
  });
});

describe('computeGamification badges', () => {
  it('awards badges for a strong performer', () => {
    const m = metrics({
      productivityScore: 80,
      status: 'winning',
      deepWorkHours: 20,
      tasksCompleted: 10,
      tasksCompletedPrev: 4,
      onTimeRate: 0.95,
      estimationAccuracy: 0.85,
    });
    const g = computeGamification(m, 6);
    const earned = new Set(g.badges.filter(b => b.earned).map(b => b.key));
    expect(earned.has('deep-worker')).toBe(true);
    expect(earned.has('streak')).toBe(true);
    expect(earned.has('on-time')).toBe(true);
    expect(earned.has('estimator')).toBe(true);
    expect(earned.has('finisher')).toBe(true);
    expect(earned.has('winner')).toBe(true);
    expect(earned.has('rising')).toBe(true);
    expect(g.earnedCount).toBe(7);
    expect(g.level).toBeGreaterThanOrEqual(4);
  });

  it('awards nothing for an empty week and stays level 1', () => {
    const g = computeGamification(metrics(), 0);
    expect(g.earnedCount).toBe(0);
    expect(g.level).toBe(1);
    expect(g.progressToNext).toBeGreaterThanOrEqual(0);
  });
});
