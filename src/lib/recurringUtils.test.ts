import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildNextRecurringTask, completeTask, recurrenceHasEnded, addFrequency, startOfRecurrenceDay } from './recurringUtils';
import type { Task } from '../types';

const baseTask = (over: Partial<Task> = {}): Task => ({
  id: 't1',
  title: 'Mirembajtje webi',
  status: 'Todo',
  isRecurring: true,
  recurringFrequency: 'weekly',
  recurringInterval: 1,
  recurringDayOfWeek: 1,
  startDate: new Date('2026-08-03T22:00:00Z'),
  endDate: new Date('2026-08-03T18:00:00Z'),
  nextRecurringDate: new Date('2026-08-10T07:00:00Z'),
  createdByUserId: 'u1',
  ...over,
} as Task);

describe('buildNextRecurringTask — date integrity', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-08-09T12:00:00Z')); });
  afterEach(() => { vi.useRealTimers(); });

  it('never produces an endDate before the startDate (prod regression)', () => {
    // Real production row Kp0Ewe0mllp5DuTFe8Yd: the old code advanced start and
    // end independently, each snapping to recurringDayOfWeek on its own, and
    // returned start 2026-08-16 with end 2026-08-10 — six days earlier.
    const next = buildNextRecurringTask(baseTask());
    expect(new Date(next.endDate as any).getTime())
      .toBeGreaterThanOrEqual(new Date(next.startDate as any).getTime());
  });

  it('preserves the duration of the occurrence', () => {
    const task = baseTask({
      startDate: new Date('2026-08-03T06:00:00Z'),
      endDate: new Date('2026-08-03T16:16:00Z'), // 10h16m span
    });
    const next = buildNextRecurringTask(task);
    const span = new Date(next.endDate as any).getTime() - new Date(next.startDate as any).getTime();
    expect(span).toBe(10 * 3600_000 + 16 * 60_000);
  });

  it('preserves the nextRecurringDate offset relative to the start', () => {
    const task = baseTask({
      startDate: new Date('2026-08-03T06:00:00Z'),
      endDate: new Date('2026-08-03T16:16:00Z'),
      nextRecurringDate: new Date('2026-08-03T07:00:00Z'), // start + 1h
    });
    const next = buildNextRecurringTask(task);
    const offset = new Date(next.nextRecurringDate as any).getTime() - new Date(next.startDate as any).getTime();
    expect(offset).toBe(3600_000);
  });

  it('advances a weekly series by exactly one week when already aligned', () => {
    const task = baseTask({
      startDate: new Date('2026-08-10T06:00:00Z'), // Monday
      endDate: new Date('2026-08-10T16:00:00Z'),
      recurringDayOfWeek: new Date('2026-08-10T06:00:00Z').getDay(),
    });
    const next = buildNextRecurringTask(task);
    const days = (new Date(next.startDate as any).getTime() - task.startDate!.getTime()) / 86_400_000;
    expect(days).toBe(7);
  });

  it('rolls a late series forward to the first future occurrence', () => {
    const task = baseTask({
      startDate: new Date('2026-06-01T06:00:00Z'),
      endDate: new Date('2026-06-01T16:00:00Z'),
      recurringDayOfWeek: new Date('2026-06-01T06:00:00Z').getDay(),
    });
    const next = buildNextRecurringTask(task);
    expect(new Date(next.startDate as any).getTime()).toBeGreaterThan(Date.now() - 86_400_000);
    expect(new Date(next.endDate as any).getTime())
      .toBeGreaterThanOrEqual(new Date(next.startDate as any).getTime());
  });

  it('normalises an already-corrupted parent instead of carrying the inversion', () => {
    // endDate 6 days before startDate — one of the 22 broken production rows.
    const task = baseTask({
      startDate: new Date('2026-08-16T22:00:00Z'),
      endDate: new Date('2026-08-10T18:00:00Z'),
    });
    const next = buildNextRecurringTask(task);
    expect(new Date(next.endDate as any).getTime())
      .toBeGreaterThanOrEqual(new Date(next.startDate as any).getTime());
  });
});

describe('completeTask — no duplicate cycle', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-08-09T12:00:00Z')); });
  afterEach(() => { vi.useRealTimers(); });

  const deps = (claimResults: boolean[]) => {
    const created: any[] = [];
    let i = 0;
    return {
      created,
      updates: [] as any[],
      createTask: async (d: any) => { created.push(d); return {}; },
      updateTask: async function (this: any, id: string, d: any) { return { id, d }; },
      claimNextCycle: async () => claimResults[i++] ?? false,
      releaseNextCycle: async () => {},
    };
  };

  it('creates exactly one cycle when the claim is won', async () => {
    const d = deps([true]);
    const outcome = await completeTask(baseTask(), d as any);
    expect(outcome.kind).toBe('recurring-created');
    expect(d.created).toHaveLength(1);
  });

  it('creates nothing when another completion already claimed the cycle', async () => {
    const d = deps([false]);
    const outcome = await completeTask(baseTask(), d as any);
    expect(outcome.kind).toBe('completed');
    expect(d.created).toHaveLength(0);
  });

  it('two concurrent completions of the same task produce one cycle', async () => {
    const d = deps([true, false]);
    const task = baseTask();
    const [a, b] = await Promise.all([completeTask(task, d as any), completeTask(task, d as any)]);
    expect(d.created).toHaveLength(1);
    expect([a.kind, b.kind].sort()).toEqual(['completed', 'recurring-created']);
  });

  it('releases the claim when creating the child fails', async () => {
    let released = false;
    const outcome = await completeTask(baseTask(), {
      createTask: async () => { throw new Error('offline'); },
      updateTask: async () => ({}),
      claimNextCycle: async () => true,
      releaseNextCycle: async () => { released = true; },
    } as any);
    expect(outcome.kind).toBe('error');
    expect(released).toBe(true);
  });

  it('still blocks completion when a dependency is open', async () => {
    const blocker = baseTask({ id: 'b1', status: 'Todo', isRecurring: false });
    const d = deps([true]);
    const outcome = await completeTask(baseTask({ dependsOn: ['b1'] }), { ...d, allTasks: [blocker] } as any);
    expect(outcome.kind).toBe('blocked');
    expect(d.created).toHaveLength(0);
  });
});

describe('recurrenceHasEnded', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-08-09T12:00:00Z')); });
  afterEach(() => { vi.useRealTimers(); });

  it('is false without a repeat-until date', () => {
    expect(recurrenceHasEnded(baseTask())).toBe(false);
  });

  it('is true once the next occurrence passes the repeat-until date', () => {
    expect(recurrenceHasEnded(baseTask({ recurringEndDate: new Date('2026-08-11T00:00:00Z') }))).toBe(true);
  });
});

// The recurrence day math used to read the HOST's timezone, so these answers
// changed with the machine: the browser (UTC+2) and the Vercel cron (UTC) built
// different next cycles from the same task, and this suite passed only on a
// UTC+2 laptop while CI (UTC) had been red since 2026-08-11.
describe('recurrence day math is timezone-independent', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-08-09T12:00:00Z')); });
  afterEach(() => { vi.useRealTimers(); });

  it('resolves the weekday in Europe/Tirane, not the host zone', () => {
    // 2026-08-03T22:00:00Z is TUESDAY 00:00 in Tirana but Monday 22:00 in UTC —
    // and that one-day difference used to change the whole answer. Reading UTC,
    // the base looked like the configured Monday already, so the rule advanced a
    // flat +7 days to Aug 10. In Tirana the base is Tuesday, so "weekly on
    // Monday" advances 7 days and then snaps forward to Monday Aug 17. Tirana is
    // the answer the user set the rule in, and now every host agrees on it.
    const next = addFrequency(new Date('2026-08-03T22:00:00Z'), 'weekly', 1, null, 1, null);
    expect(next.toISOString()).toBe('2026-08-16T22:00:00.000Z'); // Mon Aug 17, 00:00 Tirana
  });

  it('keeps the wall-clock time of day across the jump', () => {
    // 09:30 Tirana stays 09:30 Tirana a week later (07:30Z in summer DST).
    const next = addFrequency(new Date('2026-08-03T07:30:00Z'), 'weekly', 1, null, 1, null);
    expect(next.toISOString()).toBe('2026-08-10T07:30:00.000Z');
  });

  it('holds the wall clock across the DST boundary', () => {
    // Tirana leaves DST on 2026-10-25. A Monday 09:00 local task in October must
    // still be 09:00 local in November — the UTC instant shifts by an hour.
    const next = addFrequency(new Date('2026-10-19T07:00:00Z'), 'weekly', 1, null, 1, null);
    expect(next.toISOString()).toBe('2026-10-26T08:00:00.000Z'); // 09:00 +01:00
  });

  it('never snaps the weekly date backwards', () => {
    // A Friday base with "weekly on Monday" must land on the NEXT Monday, never
    // pulled back to an interval shorter than 7 days.
    const base = new Date('2026-08-07T10:00:00Z'); // Friday
    const next = addFrequency(base, 'weekly', 1, null, 1, null);
    expect(next.getTime()).toBeGreaterThan(base.getTime() + 6 * 86_400_000);
  });

  it('gives the same day boundary regardless of the input clock time', () => {
    // 00:30 and 23:30 Tirana on the same date are the same calendar day.
    const early = startOfRecurrenceDay(new Date('2026-08-09T22:30:00Z')); // Aug 10 00:30 local
    const late = startOfRecurrenceDay(new Date('2026-08-10T21:30:00Z'));  // Aug 10 23:30 local
    expect(early).toBe(late);
  });
});
