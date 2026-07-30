import { describe, expect, it } from 'vitest';
import {
  COMPOSITE_WARNING,
  compositeScore,
  computeEmployeeMetrics,
  computeTrend,
  flagNeedsAttention,
  submissionRate,
  summariseTeam,
} from './accountability';
import { buildPeriod } from './period';
import type { DailyReport, Task, TimeEntry } from '../../types';

// The week Mon 2026-07-27 … Sun 2026-08-02. "Now" is Friday, so 5 working days
// have elapsed (Mon–Fri) and the weekend is not yet expected.
const WEEK = buildPeriod('weekly', '2026-07-30');
const FRIDAY = new Date('2026-07-31T18:00:00Z');

const daily = (date: string, over: Partial<DailyReport> = {}): DailyReport => ({
  id: `dr-${date}`,
  userId: 'u1',
  date,
  completedToday: 'punë',
  openItems: '',
  blockers: '',
  planTomorrow: '',
  createdAt: new Date(`${date}T17:00:00Z`),
  updatedAt: new Date(`${date}T17:00:00Z`),
  submittedAt: new Date(`${date}T17:00:00Z`),
  ...over,
});

const task = (over: Partial<Task> = {}): Task => ({
  id: over.id || 't1',
  title: 'Detyrë',
  status: over.status || 'Todo',
  createdAt: new Date('2026-07-20'),
  updatedAt: over.updatedAt || new Date('2026-07-29T12:00:00Z'),
  createdByUserId: null,
  ...over,
});

const entry = (start: string, minutes: number, isBillable = true): TimeEntry => ({
  id: `te-${start}-${minutes}`,
  userId: 'u1',
  startTime: new Date(`${start}T09:00:00Z`),
  endTime: new Date(new Date(`${start}T09:00:00Z`).getTime() + minutes * 60000),
  isBillable,
  createdAt: new Date(start),
  updatedAt: new Date(start),
});

describe('computeEmployeeMetrics — report compliance', () => {
  it('counts only ELAPSED working days as expected', () => {
    const m = computeEmployeeMetrics({ userId: 'u1', period: WEEK, dailyReports: [], now: FRIDAY });
    // Mon–Fri elapsed; Sat/Sun are neither elapsed nor working days.
    expect(m.expectedDailyReports).toBe(5);
    expect(m.missingDailyReports).toBe(5);
  });

  it('does not blame someone for a future day', () => {
    const monday = new Date('2026-07-27T10:00:00Z');
    const m = computeEmployeeMetrics({ userId: 'u1', period: WEEK, dailyReports: [], now: monday });
    expect(m.expectedDailyReports).toBe(1);
  });

  it('excludes tenant holidays from the expectation', () => {
    const m = computeEmployeeMetrics({
      userId: 'u1', period: WEEK, dailyReports: [], holidays: ['2026-07-29'], now: FRIDAY,
    });
    expect(m.expectedDailyReports).toBe(4);
  });

  it('counts submitted reports and ignores other users', () => {
    const m = computeEmployeeMetrics({
      userId: 'u1',
      period: WEEK,
      dailyReports: [
        daily('2026-07-27'),
        daily('2026-07-28'),
        daily('2026-07-29', { userId: 'someone-else' }),
      ],
      now: FRIDAY,
    });
    expect(m.submittedDailyReports).toBe(2);
    expect(m.missingDailyReports).toBe(3);
  });

  it('ignores reports outside the period', () => {
    const m = computeEmployeeMetrics({
      userId: 'u1', period: WEEK, dailyReports: [daily('2026-07-20')], now: FRIDAY,
    });
    expect(m.submittedDailyReports).toBe(0);
  });

  it('counts late reports from wasLate or the timestamps', () => {
    const m = computeEmployeeMetrics({
      userId: 'u1',
      period: WEEK,
      dailyReports: [
        daily('2026-07-27', { wasLate: true }),
        daily('2026-07-28', {
          dueAt: new Date('2026-07-28T17:00:00Z'),
          submittedAt: new Date('2026-07-28T19:30:00Z'),
        }),
        daily('2026-07-29', {
          dueAt: new Date('2026-07-29T17:00:00Z'),
          submittedAt: new Date('2026-07-29T16:00:00Z'),
        }),
      ],
      now: FRIDAY,
    });
    expect(m.lateDailyReports).toBe(2);
    // Only the two reports that carry a dueAt contribute: +150 min and −60 min.
    expect(m.avgSubmissionDelayMinutes).toBe(45);
  });
});

describe('computeEmployeeMetrics — tasks', () => {
  it('uses status Done + updatedAt as completion, matching the Momentum engine', () => {
    const m = computeEmployeeMetrics({
      userId: 'u1',
      period: WEEK,
      dailyReports: [],
      tasks: [
        task({ id: 'a', status: 'Done', updatedAt: new Date('2026-07-29T10:00:00Z') }),
        task({ id: 'b', status: 'Done', updatedAt: new Date('2026-07-20T10:00:00Z') }), // outside
        task({ id: 'c', status: 'In Progress' }),
      ],
      now: FRIDAY,
    });
    expect(m.tasksCompleted).toBe(1);
  });

  it('counts overdue open tasks', () => {
    const m = computeEmployeeMetrics({
      userId: 'u1',
      period: WEEK,
      dailyReports: [],
      tasks: [
        task({ id: 'a', status: 'Todo', endDate: new Date('2026-07-25') }),
        task({ id: 'b', status: 'Todo', endDate: new Date('2026-08-30') }),
        task({ id: 'c', status: 'Done', endDate: new Date('2026-07-25') }),
      ],
      now: FRIDAY,
    });
    expect(m.tasksOverdue).toBe(1);
  });

  it('counts missed deadlines among completed tasks', () => {
    const m = computeEmployeeMetrics({
      userId: 'u1',
      period: WEEK,
      dailyReports: [],
      tasks: [task({ status: 'Done', endDate: new Date('2026-07-28'), updatedAt: new Date('2026-07-30T10:00:00Z') })],
      now: FRIDAY,
    });
    expect(m.missedDeadlines).toBe(1);
  });

  it('returns a null completion rate when there are no tasks at all', () => {
    const m = computeEmployeeMetrics({ userId: 'u1', period: WEEK, dailyReports: [], now: FRIDAY });
    expect(m.completionRate).toBeNull();
  });
});

describe('computeEmployeeMetrics — hours', () => {
  it('prefers time entries and derives minutes from start/end', () => {
    const m = computeEmployeeMetrics({
      userId: 'u1',
      period: WEEK,
      dailyReports: [daily('2026-07-27', { hoursWorked: 99 })], // must be ignored
      timeEntries: [entry('2026-07-27', 240), entry('2026-07-28', 120, false)],
      now: FRIDAY,
    });
    expect(m.hoursWorked).toBe(6);
    expect(m.billableHours).toBe(4);
    expect(m.nonBillableHours).toBe(2);
  });

  it('ignores running entries with no end time', () => {
    const running: TimeEntry = {
      id: 'run', userId: 'u1', startTime: new Date('2026-07-27T09:00:00Z'),
      createdAt: new Date(), updatedAt: new Date(),
    };
    const m = computeEmployeeMetrics({
      userId: 'u1', period: WEEK, dailyReports: [], timeEntries: [running], now: FRIDAY,
    });
    expect(m.hoursWorked).toBe(0);
  });

  it('falls back to self-reported hours when no tracker was used', () => {
    const m = computeEmployeeMetrics({
      userId: 'u1',
      period: WEEK,
      dailyReports: [daily('2026-07-27', { hoursWorked: 8, billableHours: 6, nonBillableHours: 2 })],
      now: FRIDAY,
    });
    expect(m.hoursWorked).toBe(8);
    expect(m.billableHours).toBe(6);
  });

  it('computes utilisation against elapsed capacity', () => {
    const m = computeEmployeeMetrics({
      userId: 'u1',
      period: WEEK,
      dailyReports: [],
      timeEntries: [entry('2026-07-27', 60 * 20)], // 20 billable hours
      contractedHoursPerDay: 8,
      now: FRIDAY,
    });
    // 20 billable / (5 elapsed days × 8h) = 0.5
    expect(m.utilisationRate).toBe(0.5);
  });

  it('returns null utilisation when nothing was logged', () => {
    const m = computeEmployeeMetrics({ userId: 'u1', period: WEEK, dailyReports: [], now: FRIDAY });
    expect(m.utilisationRate).toBeNull();
  });
});

describe('computeEmployeeMetrics — blockers', () => {
  it('counts reported vs unresolved and averages resolution time', () => {
    const m = computeEmployeeMetrics({
      userId: 'u1',
      period: WEEK,
      dailyReports: [
        daily('2026-07-27', {
          blockers: 'Pres aksesin',
          submittedAt: new Date('2026-07-27T10:00:00Z'),
          blockerResolvedAt: new Date('2026-07-27T14:00:00Z'),
        }),
        daily('2026-07-28', { blockers: 'Pres materialet' }),
        daily('2026-07-29', { blockers: '   ' }), // whitespace is not a blocker
      ],
      now: FRIDAY,
    });
    expect(m.blockersReported).toBe(2);
    expect(m.blockersUnresolved).toBe(1);
    expect(m.avgBlockerResolutionHours).toBe(4);
  });
});

describe('submissionRate', () => {
  it('is null when nothing was expected', () => {
    const m = computeEmployeeMetrics({
      userId: 'u1', period: WEEK, dailyReports: [], workingDays: [], now: FRIDAY,
    });
    expect(submissionRate(m)).toBeNull();
  });

  it('caps at 1 when someone filed extra reports', () => {
    const m = computeEmployeeMetrics({
      userId: 'u1',
      period: WEEK,
      dailyReports: ['2026-07-27', '2026-07-28', '2026-07-29', '2026-07-30', '2026-07-31', '2026-08-01']
        .map(d => daily(d)),
      now: FRIDAY,
    });
    expect(submissionRate(m)).toBe(1);
  });
});

describe('compositeScore', () => {
  it('refuses to score from fewer than three signals', () => {
    const thin = computeEmployeeMetrics({ userId: 'u1', period: WEEK, dailyReports: [], now: FRIDAY });
    expect(compositeScore(thin)).toBeNull();
  });

  it('scores when enough dimensions have data', () => {
    const m = computeEmployeeMetrics({
      userId: 'u1',
      period: WEEK,
      dailyReports: ['2026-07-27', '2026-07-28', '2026-07-29', '2026-07-30', '2026-07-31']
        .map(d => daily(d, { blockers: 'x', blockerResolvedAt: new Date(`${d}T18:00:00Z`) })),
      tasks: [task({ status: 'Done', updatedAt: new Date('2026-07-29T10:00:00Z') })],
      timeEntries: [entry('2026-07-27', 60 * 34)],
      now: FRIDAY,
    });
    const score = compositeScore(m);
    expect(score).not.toBeNull();
    expect(score!).toBeGreaterThan(80);
  });

  it('treats overload as a penalty, not a bonus', () => {
    const base = computeEmployeeMetrics({
      userId: 'u1',
      period: WEEK,
      dailyReports: ['2026-07-27', '2026-07-28', '2026-07-29', '2026-07-30', '2026-07-31'].map(d => daily(d)),
      tasks: [task({ status: 'Done', updatedAt: new Date('2026-07-29T10:00:00Z') })],
      now: FRIDAY,
    });
    const healthy = compositeScore({ ...base, utilisationRate: 0.85 })!;
    const overloaded = compositeScore({ ...base, utilisationRate: 1.35 })!;
    expect(overloaded).toBeLessThan(healthy);
  });

  it('ships a warning string for the UI to display', () => {
    expect(COMPOSITE_WARNING).toContain('tregues, jo vlerësim');
  });
});

describe('computeTrend', () => {
  it('is direction-aware', () => {
    expect(computeTrend(10, 5, true).direction).toBe('improving');
    expect(computeTrend(10, 5, false).direction).toBe('declining');
    expect(computeTrend(5, 10, false).direction).toBe('improving');
  });

  it('calls small moves stable', () => {
    expect(computeTrend(102, 100, true).direction).toBe('stable');
  });

  it('admits when it does not know', () => {
    expect(computeTrend(null, 5).direction).toBe('unknown');
  });
});

describe('flagNeedsAttention', () => {
  const metrics = (over: Partial<ReturnType<typeof computeEmployeeMetrics>>) => ({
    ...computeEmployeeMetrics({ userId: 'u1', period: WEEK, dailyReports: [], now: FRIDAY }),
    ...over,
  });

  it('flags missing reports with the reason spelled out', () => {
    const flags = flagNeedsAttention([{ userId: 'u1', metrics: metrics({ missingDailyReports: 4 }) }]);
    expect(flags).toHaveLength(1);
    expect(flags[0].reasons[0]).toContain('4 raporte ditore mungojnë');
    expect(flags[0].severity).toBe('medium');
  });

  it('escalates to high when several signals stack', () => {
    const flags = flagNeedsAttention([{
      userId: 'u1',
      metrics: metrics({ missingDailyReports: 4, blockersUnresolved: 3, tasksOverdue: 6 }),
    }]);
    expect(flags[0].severity).toBe('high');
  });

  it('flags overload as needing attention too', () => {
    const flags = flagNeedsAttention([{ userId: 'u1', metrics: metrics({ utilisationRate: 1.4 }) }]);
    expect(flags[0].reasons.join(' ')).toContain('Mbingarkesë');
  });

  it('says nothing about someone who is fine', () => {
    const fine = metrics({ missingDailyReports: 0, blockersUnresolved: 0, tasksOverdue: 0, lateDailyReports: 0 });
    expect(flagNeedsAttention([{ userId: 'u1', metrics: fine }])).toEqual([]);
  });

  it('orders high severity first', () => {
    const flags = flagNeedsAttention([
      { userId: 'ok', metrics: metrics({ missingDailyReports: 1 }) },
      { userId: 'bad', metrics: metrics({ missingDailyReports: 5, blockersUnresolved: 3 }) },
    ]);
    expect(flags[0].userId).toBe('bad');
  });
});

describe('summariseTeam', () => {
  it('rolls up the team', () => {
    const base = computeEmployeeMetrics({ userId: 'u1', period: WEEK, dailyReports: [], now: FRIDAY });
    const s = summariseTeam([
      { userId: 'a', metrics: { ...base, expectedDailyReports: 5, submittedDailyReports: 5, hoursWorked: 40, billableHours: 32 } },
      { userId: 'b', metrics: { ...base, expectedDailyReports: 5, submittedDailyReports: 3, missingDailyReports: 2, hoursWorked: 30, billableHours: 15 } },
    ]);
    expect(s.members).toBe(2);
    expect(s.submissionRate).toBe(0.8);
    expect(s.totalHours).toBe(70);
    expect(s.billableUtilisation).toBe(0.67);
  });

  it('handles an empty team without dividing by zero', () => {
    const s = summariseTeam([]);
    expect(s.members).toBe(0);
    expect(s.submissionRate).toBeNull();
    expect(s.billableUtilisation).toBeNull();
  });
});
