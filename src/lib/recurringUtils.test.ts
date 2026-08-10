import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildNextRecurringTask, completeTask, recurrenceHasEnded } from './recurringUtils';
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
