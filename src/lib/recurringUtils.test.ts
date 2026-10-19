import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildNextRecurringTask, completeTask, recurrenceHasEnded, addFrequency, startOfRecurrenceDay, projectRecurrenceBlockReason, RECURRENCE_STOPPING_PROJECT_STATUSES, hasLiveSeriesSibling, remapDependsOnForNextCycle, recurringOccurrencesInMonth, zonedParts, reopenTaskPatch, seriesAnchorDay } from './recurringUtils';
import { TERMINAL_PROJECT_STATUSES } from './finance/recurringBilling';
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

// Archiving a project keeps its tasks; a recurring one used to keep spawning
// cycles into the archive because nothing looked at the project. The guard runs
// BEFORE the claim so the tip is left re-armable: restoring the project makes
// the cron backstop resume the series.
describe('completeTask — archived / cancelled project stops the series', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-08-09T12:00:00Z')); });
  afterEach(() => { vi.useRealTimers(); });

  const harness = () => {
    const created: any[] = [];
    const updates: any[] = [];
    let claims = 0;
    return {
      created, updates, claims: () => claims,
      createTask: async (d: any) => { created.push(d); return {}; },
      updateTask: async (id: string, d: any) => { updates.push({ id, d }); return {}; },
      claimNextCycle: async () => { claims++; return true; },
      releaseNextCycle: async () => {},
    };
  };

  it('closes the task, spawns nothing and does NOT claim the cycle for an archived project', async () => {
    const h = harness();
    const outcome = await completeTask(baseTask({ projectId: 'p1' }), {
      ...h, projects: [{ id: 'p1', status: 'Archived' }],
    } as any);
    expect(outcome).toEqual({ kind: 'recurring-stopped', reason: 'project-archived' });
    expect(h.created).toHaveLength(0);
    expect(h.claims()).toBe(0);
    expect(h.updates).toEqual([{ id: 't1', d: { status: 'Done', completedAt: new Date('2026-08-09T12:00:00Z') } }]);
    // nextCycleCreated must stay false so a restored project can resume.
    expect(h.updates[0].d).not.toHaveProperty('nextCycleCreated');
  });

  it('a cancelled project stops it too, with its own reason', async () => {
    const h = harness();
    const outcome = await completeTask(baseTask({ projectId: 'p1' }), {
      ...h, projects: [{ id: 'p1', status: 'Cancelled' }],
    } as any);
    expect(outcome).toEqual({ kind: 'recurring-stopped', reason: 'project-cancelled' });
    expect(h.created).toHaveLength(0);
  });

  it('a live project still spawns the next cycle', async () => {
    const h = harness();
    const outcome = await completeTask(baseTask({ projectId: 'p1' }), {
      ...h, projects: [{ id: 'p1', status: 'Completed' }],
    } as any);
    expect(outcome.kind).toBe('recurring-created');
    expect(h.created).toHaveLength(1);
  });

  it('never blocks on an unknown project or a task without one (fail open)', async () => {
    expect(projectRecurrenceBlockReason({ projectId: 'ghost' }, [{ id: 'p1', status: 'Archived' }])).toBeNull();
    expect(projectRecurrenceBlockReason({ projectId: undefined }, [{ id: 'p1', status: 'Archived' }])).toBeNull();
    expect(projectRecurrenceBlockReason({ projectId: 'p1' }, undefined)).toBeNull();
    const h = harness();
    const outcome = await completeTask(baseTask({ projectId: 'ghost' }), { ...h, projects: [] } as any);
    expect(outcome.kind).toBe('recurring-created');
  });

  it('stops for exactly the statuses the billing engine calls terminal', () => {
    expect([...RECURRENCE_STOPPING_PROJECT_STATUSES].sort()).toEqual([...TERMINAL_PROJECT_STATUSES].sort());
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

// `setUTCMonth(+1)` overflowed BEFORE the clamp: 31 Jan → "31 Feb" = 3 Mar →
// clamped to 31 MAR. Every short month vanished from a month-end series and no
// test ever asked for a monthly step.
describe('addFrequency — monthly and yearly never overflow', () => {
  const day = (d: Date) => { const p = zonedParts(d); return `${p.year}-${String(p.month + 1).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`; };
  const jan31 = new Date('2026-01-31T09:00:00+01:00');

  it('31 Jan + 1 month is 28 Feb, and the series keeps its anchor day', () => {
    const feb = addFrequency(jan31, 'monthly', null, 31);
    expect(day(feb)).toBe('2026-02-28');
    const mar = addFrequency(feb, 'monthly', null, 31);
    expect(day(mar)).toBe('2026-03-31');
    const apr = addFrequency(mar, 'monthly', null, 31);
    expect(day(apr)).toBe('2026-04-30');
  });

  it('walks every month of the year exactly once (no skipped February)', () => {
    let d = jan31;
    const months: number[] = [];
    for (let i = 0; i < 11; i++) { d = addFrequency(d, 'monthly', null, 31); months.push(zonedParts(d).month + 1); }
    expect(months).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it('without an explicit day-of-month it still clamps instead of overflowing', () => {
    expect(day(addFrequency(new Date('2026-01-30T09:00:00+01:00'), 'monthly', null, null))).toBe('2026-02-28');
  });

  it('keeps the wall-clock time of day across the step', () => {
    const p = zonedParts(addFrequency(jan31, 'monthly', null, 31));
    expect([p.hours, p.minutes]).toEqual([9, 0]);
  });

  it('every 2 months from the 31st: Mar 31 → May 31, never Apr 30 → Jun 30 drift', () => {
    const d = addFrequency(new Date('2026-03-31T09:00:00+02:00'), 'monthly', null, 31, 2);
    expect(day(d)).toBe('2026-05-31');
  });

  it('29 Feb + 1 year is 28 Feb, not 1 Mar', () => {
    expect(day(addFrequency(new Date('2028-02-29T09:00:00+01:00'), 'yearly'))).toBe('2029-02-28');
  });

  it('a yearly 29 Feb series comes BACK to 29 Feb in the next leap year (anchor day)', () => {
    let d = new Date('2028-02-29T09:00:00+01:00');
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) { d = addFrequency(d, 'yearly', null, 29); seen.push(day(d)); }
    expect(seen).toEqual(['2029-02-28', '2030-02-28', '2031-02-28', '2032-02-29']);
  });

  it('a stale monthly day-of-month does not move a yearly series', () => {
    // "çdo muaj, ditën 15" switched to yearly on a 3 March task.
    expect(day(addFrequency(new Date('2026-03-03T09:00:00+01:00'), 'yearly', null, 15))).toBe('2027-03-03');
  });

  it('a monthly/yearly series without an explicit day is anchored on its start day', () => {
    expect(seriesAnchorDay('monthly', null, new Date('2026-01-31T09:00:00+01:00'))).toBe(31);
    expect(seriesAnchorDay('yearly', undefined, new Date('2028-02-29T09:00:00+01:00'))).toBe(29);
    expect(seriesAnchorDay('monthly', 15, new Date('2026-01-31T09:00:00+01:00'))).toBe(15);
    expect(seriesAnchorDay('weekly', null, new Date())).toBeNull();
  });
});

describe('series identity — sameSeries / hasLiveSeriesSibling / seriesId', () => {
  it('the child carries the root parent id as seriesId, and grandchildren keep it', () => {
    const child = buildNextRecurringTask(baseTask());
    expect(child.seriesId).toBe('t1');
    const grandchild = buildNextRecurringTask({ ...baseTask(), id: 'c1', seriesId: 't1' });
    expect(grandchild.seriesId).toBe('t1');
  });

  it('a frequency change on the tip does not disown its live child (no fork)', () => {
    const tip = baseTask({ status: 'Done', recurringFrequency: 'monthly' });
    const child = baseTask({ id: 'c1', status: 'Todo', recurringFrequency: 'weekly' });
    expect(hasLiveSeriesSibling(tip, [tip, child])).toBe(true);
  });

  it('seriesId wins over the legacy title match', () => {
    const a = baseTask({ id: 'a', seriesId: 'S1', status: 'Done' });
    const stranger = baseTask({ id: 'b', seriesId: 'S2', status: 'Todo' }); // same title, different series
    expect(hasLiveSeriesSibling(a, [a, stranger])).toBe(false);
    const sibling = baseTask({ id: 'c', seriesId: 'S1', status: 'Todo', title: 'renamed' });
    expect(hasLiveSeriesSibling(a, [a, sibling])).toBe(true);
  });
});

// `dependsOn` holds occurrence IDS: a copied list pointed at the blocker that was
// already Done, so a recurring blocker blocked only in cycle 1.
describe('remapDependsOnForNextCycle', () => {
  it('re-points a Done recurring blocker to its live sibling', () => {
    const blockerDone = baseTask({ id: 'b1', status: 'Done', title: 'Blocker', seriesId: 'B' });
    const blockerLive = baseTask({ id: 'b2', status: 'Todo', title: 'Blocker', seriesId: 'B' });
    const task = baseTask({ dependsOn: ['b1'] });
    expect(remapDependsOnForNextCycle(task, [blockerDone, blockerLive, task])).toEqual(['b2']);
  });

  it('drops a Done one-off blocker and keeps open / unknown ids', () => {
    const oneOff = baseTask({ id: 'o1', status: 'Done', isRecurring: false, title: 'Once' });
    const open = baseTask({ id: 'p1', status: 'Todo', isRecurring: false, title: 'Open' });
    const task = baseTask({ dependsOn: ['o1', 'p1', 'ghost'] });
    expect(remapDependsOnForNextCycle(task, [oneOff, open, task])).toEqual(['p1', 'ghost']);
  });

  it('without a task list the ids are copied as they are', () => {
    expect(remapDependsOnForNextCycle(baseTask({ dependsOn: ['x'] }), undefined)).toEqual(['x']);
    expect(buildNextRecurringTask(baseTask({ dependsOn: ['x'] })).dependsOn).toEqual(['x']);
  });
});

describe('recurringOccurrencesInMonth — one projection engine for both calendars', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-08-09T12:00:00Z')); });
  afterEach(() => { vi.useRealTimers(); });
  // Weekly on Monday, tip due Mon 3 Aug 2026 (Tirane).
  const tip = baseTask({ endDate: new Date('2026-08-03T09:00:00+02:00'), startDate: new Date('2026-08-03T08:00:00+02:00') });

  it('paints the anchor day and every later Monday of the month', () => {
    const m = recurringOccurrencesInMonth([tip], 2026, 7);
    expect([...m.keys()].sort((a, b) => a - b)).toEqual([3, 10, 17, 24, 31]);
  });

  it('an old cycle (nextCycleCreated) shows only its own day', () => {
    const m = recurringOccurrencesInMonth([{ ...tip, nextCycleCreated: true }], 2026, 7);
    expect([...m.keys()]).toEqual([3]);
  });

  it('a series inside an archived project shows its real day and promises nothing further', () => {
    const m = recurringOccurrencesInMonth([{ ...tip, projectId: 'p1' }], 2026, 7, { projects: [{ id: 'p1', status: 'Archived' }] });
    expect([...m.keys()]).toEqual([3]);
    const live = recurringOccurrencesInMonth([{ ...tip, projectId: 'p1' }], 2026, 7, { projects: [{ id: 'p1', status: 'Active' }] });
    expect(live.size).toBe(5);
  });

  it('a Done tip still projects forward (the series is alive) and stops at repeat-until', () => {
    const m = recurringOccurrencesInMonth([{ ...tip, status: 'Done', recurringEndDate: new Date('2026-08-17T00:00:00+02:00') }], 2026, 7);
    expect([...m.keys()].sort((a, b) => a - b)).toEqual([3, 10, 17]);
  });

  it('an interval-2 weekly series paints every OTHER week and a stale anchor fast-forwards', () => {
    const old = baseTask({ recurringInterval: 2, endDate: new Date('2025-01-06T09:00:00+01:00'), startDate: new Date('2025-01-06T08:00:00+01:00') });
    const m = recurringOccurrencesInMonth([old], 2026, 7);
    const days = [...m.keys()].sort((a, b) => a - b);
    expect(days.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < days.length; i++) expect(days[i] - days[i - 1]).toBe(14);
  });
});

describe('completedAt + re-open + carried series fields', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-08-09T12:00:00Z')); });
  afterEach(() => { vi.useRealTimers(); });

  const recorder = () => {
    const updates: Array<{ id: string; d: any }> = [];
    const created: any[] = [];
    return {
      updates, created,
      createTask: async (d: any) => { created.push(d); return {}; },
      updateTask: async (id: string, d: any) => { updates.push({ id, d }); return {}; },
      claimNextCycle: async () => true,
      releaseNextCycle: async () => {},
    };
  };

  it('every Done write stamps completedAt (one-off and recurring)', async () => {
    const one = recorder();
    await completeTask(baseTask({ isRecurring: false, recurringFrequency: undefined }), one as any);
    expect(one.updates[0].d.completedAt).toEqual(new Date('2026-08-09T12:00:00Z'));
    const rec = recorder();
    await completeTask(baseTask(), rec as any);
    expect(rec.updates[rec.updates.length - 1].d).toMatchObject({ status: 'Done', nextCycleCreated: true });
    expect(rec.updates[rec.updates.length - 1].d.completedAt).toBeInstanceOf(Date);
  });

  it('reopenTaskPatch clears completedAt and re-arms only a series with no live child', () => {
    const tip = baseTask({ status: 'Done', nextCycleCreated: true, seriesId: 's1' });
    const child = baseTask({ id: 't2', status: 'Todo', seriesId: 's1' });
    expect(reopenTaskPatch(tip, 'In Progress', [tip, child])).toEqual({ status: 'In Progress', completedAt: null });
    expect(reopenTaskPatch(tip, 'In Progress', [tip])).toEqual({ status: 'In Progress', completedAt: null, nextCycleCreated: false });
    // No list = cannot prove the child is gone = do not re-arm.
    expect(reopenTaskPatch(tip, 'Todo', undefined)).toEqual({ status: 'Todo', completedAt: null });
    // Not Done: just the status.
    expect(reopenTaskPatch(baseTask({ status: 'Todo' }), 'In Progress', [])).toEqual({ status: 'In Progress' });
  });

  it('the next cycle carries the series author and the reminder owner', () => {
    const next = buildNextRecurringTask(baseTask({ createdByUserId: 'completer', seriesCreatedByUserId: 'author', reminderOffsetMinutes: 60, reminderAt: new Date(), reminderSetByUserId: 'boss' } as any)) as any;
    expect(next.seriesCreatedByUserId).toBe('author');
    expect(next.reminderSetByUserId).toBe('boss');
    const root = buildNextRecurringTask(baseTask({ createdByUserId: 'u1' })) as any;
    expect(root.seriesCreatedByUserId).toBe('u1');
    expect(root.reminderSetByUserId).toBeUndefined();
  });
});

describe('recurringOccurrencesInMonth — projects like the engine (start + span)', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-08-09T12:00:00Z')); });
  afterEach(() => { vi.useRealTimers(); });

  it('a weekly-Monday task due Tuesday paints every Tuesday, matching the spawned cycles', () => {
    const tip = baseTask({ startDate: new Date('2026-08-03T09:00:00+02:00'), endDate: new Date('2026-08-04T17:00:00+02:00') });
    const m = recurringOccurrencesInMonth([tip], 2026, 7);
    expect([...m.keys()].sort((a, b) => a - b)).toEqual([4, 11, 18, 25]);
    // And the engine's own next cycle lands on one of those days.
    const next = buildNextRecurringTask(tip);
    expect(zonedParts(new Date(next.endDate as any)).day).toBe(11);
  });
});
