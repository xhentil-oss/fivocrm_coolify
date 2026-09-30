import { describe, it, expect } from 'vitest';
import type { DailyTaskOutcome, TimeEntry } from '../../types';
import { dayKeyOf, dayKeyToNoon, entryDayKey, entryInPeriod, entryInstantMs, entryIsOpen, timeEntriesFromOutcomes, dailyReportEntryId, hoursByDay } from './timeEntries';

describe('day keys (Europe/Tirane)', () => {
  it('an evening UTC instant is still the local day', () => {
    // 22:30 UTC on the 9th = 00:30 local on the 10th (CEST)
    expect(dayKeyOf(new Date('2026-09-09T22:30:00Z'))).toBe('2026-09-10');
    expect(dayKeyToNoon('2026-09-10')!.toISOString()).toBe('2026-09-10T10:00:00.000Z');
    expect(dayKeyToNoon('nope')).toBeNull();
  });
  it('entryDayKey prefers the stored date', () => {
    expect(entryDayKey({ date: '2026-09-03', startTime: new Date('2026-09-10T08:00:00Z') })).toBe('2026-09-03');
    expect(entryDayKey({ startTime: new Date('2026-09-10T08:00:00Z') } as any)).toBe('2026-09-10');
    expect(entryDayKey({} as any)).toBeNull();
  });
  it('period membership and open timers', () => {
    const e = { startTime: new Date('2026-09-10T08:00:00Z') } as TimeEntry;
    expect(entryInPeriod(e, new Date('2026-09-01'), new Date('2026-09-30T23:59:59'))).toBe(true);
    expect(entryInPeriod(e, new Date('2026-10-01'), new Date('2026-10-31'))).toBe(false);
    expect(entryIsOpen({ endTime: undefined, duration: undefined })).toBe(true);
    expect(entryIsOpen({ endTime: undefined, duration: 30 })).toBe(false);
  });
});

describe('daily report → time entries', () => {
  const outcomes: DailyTaskOutcome[] = [
    { taskId: 't1', title: 'Reels', state: 'done', hours: 2.5, projectId: 'p1', customerId: 'c1' },
    { taskId: 't2', title: 'Brief', state: 'in_progress', reason: 'pritet klienti', projectId: 'p1' },
    { title: 'Takim i brendshëm', state: 'done', hours: 1, unplanned: true },
  ];
  const ctx = { userId: 'u1', dayKey: '2026-09-10', customerByProjectId: { p1: 'c1' }, costRole: 'SMM', teamId: 't', businessId: 'b' };
  it('one entry per row with hours, keyed deterministically, stamped with client and role', () => {
    const out = timeEntriesFromOutcomes(outcomes, ctx);
    expect(out).toHaveLength(2);
    expect(out[0].id).toBe(dailyReportEntryId('u1', 't1', '2026-09-10'));
    expect(out[0].data).toMatchObject({ userId: 'u1', taskId: 't1', projectId: 'p1', customerId: 'c1', duration: 150, isBillable: true, source: 'daily-report', date: '2026-09-10', costRole: 'SMM', businessId: 'b' });
    expect(out[0].data.endTime!.getTime() - out[0].data.startTime.getTime()).toBe(150 * 60_000);
    expect(out[1].id).toBe('u1_free-takim-i-brendshem_2026-09-10');
    expect(out[1].data.isBillable).toBe(false);
    expect(out[1].data.projectId).toBeUndefined();
  });
  it('re-submitting the same day yields the same ids (update, never duplicate)', () => {
    const a = timeEntriesFromOutcomes(outcomes, ctx).map(x => x.id);
    const b = timeEntriesFromOutcomes([{ ...outcomes[0], hours: 3 }, outcomes[2]], ctx).map(x => x.id);
    expect(a).toEqual(b);
  });
  it('hoursByDay sums the grid cells', () => {
    const entries = [
      { date: '2026-09-10', duration: 60 }, { date: '2026-09-10', duration: 90 }, { date: '2026-09-11', duration: 30 },
    ] as TimeEntry[];
    const m = hoursByDay(entries);
    expect(m.get('2026-09-10')).toBe(2.5);
    expect(m.get('2026-09-11')).toBe(0.5);
  });
});

// ── Sep 2026 audit: `date` IS the booking day ────────────────────────────────
describe('entryInstantMs books an entry on its `date`, not on its start instant', () => {
  it('a 13-hour daily-report row dated 1 Sep that STARTED 31 Aug 23:00 belongs to September', () => {
    // The daily report writes startTime = noon − minutes, so a row longer than
    // 12 h starts the day before. The rules' month lock is keyed on `date`;
    // every engine read `startTime` and booked the same row in August.
    const row = { date: '2026-09-01', startTime: new Date('2026-08-31T21:00:00Z'), endTime: new Date('2026-09-01T10:00:00Z'), duration: 13 * 60 } as TimeEntry;
    const sep = { start: new Date(2026, 8, 1), end: new Date(2026, 8, 30, 23, 59, 59, 999) };
    const aug = { start: new Date(2026, 7, 1), end: new Date(2026, 7, 31, 23, 59, 59, 999) };
    expect(new Date(entryInstantMs(row)!).toISOString()).toBe('2026-09-01T10:00:00.000Z'); // local noon, Europe/Tirane
    expect(entryInPeriod(row, sep.start, sep.end)).toBe(true);
    expect(entryInPeriod(row, aug.start, aug.end)).toBe(false);
    expect(entryDayKey(row)).toBe('2026-09-01');
  });
  it('falls back to startTime, then createdAt, and stays consistent with entryDayKey', () => {
    const byStart = { startTime: new Date('2026-09-10T08:00:00Z') } as TimeEntry;
    expect(entryInstantMs(byStart)).toBe(new Date('2026-09-10T08:00:00Z').getTime());
    expect(entryDayKey(byStart)).toBe('2026-09-10');
    const byCreated = { createdAt: new Date('2026-09-12T08:00:00Z') } as TimeEntry;
    expect(entryInstantMs(byCreated)).toBe(new Date('2026-09-12T08:00:00Z').getTime());
    expect(entryDayKey(byCreated)).toBe('2026-09-12');
    // A malformed `date` is ignored, not parsed.
    expect(entryInstantMs({ date: '10/09/2026', startTime: new Date('2026-09-10T08:00:00Z') } as any)).toBe(new Date('2026-09-10T08:00:00Z').getTime());
    expect(entryInstantMs({} as any)).toBeNull();
  });
});
