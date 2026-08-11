import { describe, it, expect } from 'vitest';
import { computeMomentum, computeMomentumTrend, SCORE_WEIGHTS } from './momentum';
import type { MomentumInput } from './momentum';
import type { Task, TimeEntry } from '../../types';

// Fixed clock so weekday/window math is deterministic.
// 2026-07-20 is a Monday 12:00 local.
const NOW = new Date('2026-07-20T12:00:00').getTime();
const WEEK = 7 * 86_400_000;
const RANGE_END = NOW;
const RANGE_START = NOW - WEEK + 1;

const d = (iso: string) => new Date(iso);

function task(p: Partial<Task>): Task {
  return {
    id: Math.random().toString(36).slice(2),
    title: 't',
    status: 'Todo',
    createdAt: d('2026-07-14T09:00:00'),
    updatedAt: d('2026-07-14T09:00:00'),
    createdByUserId: 'u1',
    ...p,
  } as Task;
}

function entry(p: Partial<TimeEntry>): TimeEntry {
  return {
    id: Math.random().toString(36).slice(2),
    userId: 'u1',
    startTime: d('2026-07-15T09:00:00'),
    endTime: d('2026-07-15T10:00:00'),
    createdAt: d('2026-07-15T09:00:00'),
    updatedAt: d('2026-07-15T10:00:00'),
    ...p,
  } as TimeEntry;
}

const baseInput = (over: Partial<MomentumInput> = {}): MomentumInput => ({
  members: [{ userId: 'u1', name: 'Ana' }],
  tasks: [],
  timeEntries: [],
  dailyReports: [],
  standups: [],
  rangeStart: RANGE_START,
  rangeEnd: RANGE_END,
  ...over,
});

describe('score weights', () => {
  it('sum to exactly 1', () => {
    const total = Object.values(SCORE_WEIGHTS).reduce((s, w) => s + w, 0);
    expect(total).toBeCloseTo(1, 10);
  });
});

describe('computeMomentum — empty', () => {
  it('gives a neutral-ish score with no data (never NaN)', () => {
    const t = computeMomentum(baseInput(), NOW);
    const m = t.members[0];
    expect(Number.isNaN(m.productivityScore)).toBe(false);
    // Only the neutral on-time (70) + estimation (70) sub-scores contribute.
    expect(m.productivityScore).toBe(Math.round(70 * SCORE_WEIGHTS.onTime + 70 * SCORE_WEIGHTS.estimation));
    expect(m.onTimeRate).toBeNull();
    expect(m.estimationAccuracy).toBeNull();
    expect(m.status).toBe('behind');
  });
});

describe('deep-work hours & sessions', () => {
  it('counts sessions ≥ 25 min or flagged pomodoro; excludes short/out-of-range', () => {
    const t = computeMomentum(
      baseInput({
        timeEntries: [
          entry({ startTime: d('2026-07-15T09:00:00'), endTime: d('2026-07-15T11:00:00') }), // 120m deep
          entry({ startTime: d('2026-07-16T09:00:00'), endTime: d('2026-07-16T09:10:00') }), // 10m shallow
          entry({ startTime: d('2026-07-16T14:00:00'), endTime: d('2026-07-16T14:10:00'), isPomodoroSession: true }), // pomodoro
          entry({ startTime: d('2026-07-01T09:00:00'), endTime: d('2026-07-01T11:00:00') }), // out of window
        ],
      }),
      NOW,
    );
    const m = t.members[0];
    expect(m.trackedHours).toBe(2.3); // round1((120+10+10)/60) — in-window only
    expect(m.deepWorkSessions).toBe(2); // 120m + pomodoro
    expect(m.deepWorkHours).toBe(2.2); // round1((120+10)/60)
  });
});

describe('estimation accuracy (measurability)', () => {
  it('is 1 when actual matches estimate, and joins time by taskId', () => {
    const done = task({
      id: 'T1',
      status: 'Done',
      assignedToUserId: 'u1',
      estimatedHours: 2,
      startDate: d('2026-07-15T09:00:00'),
      updatedAt: d('2026-07-16T09:00:00'),
    });
    const t = computeMomentum(
      baseInput({
        tasks: [done],
        timeEntries: [entry({ taskId: 'T1', startTime: d('2026-07-15T09:00:00'), endTime: d('2026-07-15T11:00:00') })], // 2h actual
      }),
      NOW,
    );
    const m = t.members[0];
    expect(m.estimationAccuracy).toBeCloseTo(1, 5);
    expect(m.avgEstimatedHours).toBe(2);
    expect(m.avgActualHours).toBe(2);
  });

  it('penalises a 2x overrun to 0 accuracy', () => {
    const done = task({ id: 'T2', status: 'Done', assignedToUserId: 'u1', estimatedHours: 1, updatedAt: d('2026-07-16T09:00:00') });
    const t = computeMomentum(
      baseInput({
        tasks: [done],
        timeEntries: [entry({ taskId: 'T2', startTime: d('2026-07-15T09:00:00'), endTime: d('2026-07-15T12:00:00') })], // 3h vs 1h est
      }),
      NOW,
    );
    expect(t.members[0].estimationAccuracy).toBeCloseTo(0, 5); // |1-3|/1 = 2 → clamped to 1 → accuracy 0
  });
});

describe('on-time rate & throughput trend', () => {
  it('computes on-time fraction and previous-window throughput', () => {
    const tasks = [
      task({ id: 'A', status: 'Done', assignedToUserId: 'u1', endDate: d('2026-07-18T23:59:00'), updatedAt: d('2026-07-17T10:00:00') }), // on time
      task({ id: 'B', status: 'Done', assignedToUserId: 'u1', endDate: d('2026-07-15T00:00:00'), updatedAt: d('2026-07-17T10:00:00') }), // late
      // previous window completion
      task({ id: 'C', status: 'Done', assignedToUserId: 'u1', updatedAt: d('2026-07-10T10:00:00') }),
    ];
    const t = computeMomentum(baseInput({ tasks }), NOW);
    const m = t.members[0];
    expect(m.tasksCompleted).toBe(2);
    expect(m.tasksCompletedPrev).toBe(1);
    expect(m.onTimeRate).toBeCloseTo(0.5, 5);
  });
});

describe('WIP (Little\'s Law)', () => {
  it('counts current In Progress tasks regardless of window', () => {
    const t = computeMomentum(
      baseInput({
        tasks: [
          task({ status: 'In Progress', assignedToUserId: 'u1' }),
          task({ status: 'In Progress', assignedToUserId: 'u1' }),
          task({ status: 'Todo', assignedToUserId: 'u1' }),
        ],
      }),
      NOW,
    );
    expect(t.members[0].wip).toBe(2);
  });
});

describe('a strong performer wins', () => {
  it('hits winning status with focus + cadence + throughput', () => {
    const timeEntries: TimeEntry[] = [];
    // 5 deep-work days × ~4.5h = 22.5h across 5 sessions... add more sessions.
    for (let day = 13; day <= 17; day++) {
      for (let s = 0; s < 3; s++) {
        timeEntries.push(
          entry({
            startTime: d(`2026-07-${day}T${9 + s * 2}:00:00`),
            endTime: d(`2026-07-${day}T${10 + s * 2}:30:00`), // 90 min each → deep
          }),
        );
      }
    }
    const tasks: Task[] = [];
    for (let i = 0; i < 9; i++) {
      tasks.push(task({ status: 'Done', assignedToUserId: 'u1', updatedAt: d('2026-07-16T10:00:00') }));
    }
    const dailyReports = [13, 14, 15, 16, 17].map((day) => ({
      id: `r${day}`,
      userId: 'u1',
      date: `2026-07-${day}`,
      completedToday: 'x',
      openItems: '',
      blockers: '',
      planTomorrow: '',
      createdAt: d(`2026-07-${day}T18:00:00`),
      updatedAt: d(`2026-07-${day}T18:00:00`),
    }));
    const t = computeMomentum(baseInput({ timeEntries, tasks, dailyReports }), NOW);
    const m = t.members[0];
    expect(m.status).toBe('winning');
    expect(m.productivityScore).toBeGreaterThanOrEqual(70);
    expect(t.winningCount).toBe(1);
  });
});

describe('computeMomentumTrend', () => {
  it('returns `weeks` points oldest-first', () => {
    const points = computeMomentumTrend(
      { members: [{ userId: 'u1', name: 'Ana' }], tasks: [], timeEntries: [] },
      RANGE_END,
      4,
      NOW,
    );
    expect(points).toHaveLength(4);
    // labels are day/month strings
    expect(points[3].label).toMatch(/^\d+\/\d+$/);
  });
});
