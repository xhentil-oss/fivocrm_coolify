import { describe, it, expect } from 'vitest';
import {
  dayDiffFromToday, isOverdueDate, isDueTodayDate, isTaskOverdue, isTaskDueToday,
  isTaskCompletedToday, zonedDayRange, taskDeadline, todayKeyOf, localDateOfZonedDay,
  deadlineOnPickedDay,
} from './taskDue';
import { zonedParts } from './recurringUtils';

// 19 Oct 2026, 13:00 in Tirane (UTC+2, CEST) = 11:00Z.
const NOW = Date.parse('2026-10-19T11:00:00Z');

describe('taskDue — Europe/Tirane calendar days', () => {
  it('a deadline earlier TODAY is not overdue; yesterday is', () => {
    expect(isOverdueDate('2026-10-19T10:00:00+02:00', NOW)).toBe(false); // 12:00 local project endDate
    expect(isDueTodayDate('2026-10-19T10:00:00+02:00', NOW)).toBe(true);
    expect(isOverdueDate('2026-10-18T23:30:00+02:00', NOW)).toBe(true);
  });
  it('reads the day in Tirane, not UTC: 23:30Z on the 18th is already the 19th locally', () => {
    expect(isDueTodayDate('2026-10-18T22:30:00Z', NOW)).toBe(true);
    expect(isOverdueDate('2026-10-18T22:30:00Z', NOW)).toBe(false);
  });
  it('day diff is calendar days, not ceil(ms/24h)', () => {
    expect(dayDiffFromToday('2026-10-20T00:30:00+02:00', NOW)).toBe(1); // only 11.5h away
    expect(dayDiffFromToday('2026-10-19T23:59:00+02:00', NOW)).toBe(0);
    expect(dayDiffFromToday('2026-10-17T09:00:00+02:00', NOW)).toBe(-2);
    // Across the DST switch (25 Oct 2026): still whole days.
    expect(dayDiffFromToday('2026-10-26T09:00:00+01:00', NOW)).toBe(7);
    expect(dayDiffFromToday(null, NOW)).toBeNull();
    expect(dayDiffFromToday('garbage', NOW)).toBeNull();
  });
  it('task helpers ignore Done tasks and fall back to dueDate', () => {
    expect(isTaskOverdue({ status: 'Todo', endDate: '2026-10-18T09:00:00Z' } as any, NOW)).toBe(true);
    expect(isTaskOverdue({ status: 'Done', endDate: '2026-10-18T09:00:00Z' } as any, NOW)).toBe(false);
    expect(isTaskDueToday({ status: 'Todo', dueDate: '2026-10-19T15:00:00Z' } as any, NOW)).toBe(true);
    expect(isTaskOverdue({ status: 'Todo' } as any, NOW)).toBe(false);
  });
  it('completed today reads completedAt, not a later updatedAt', () => {
    expect(isTaskCompletedToday({ status: 'Done', completedAt: '2026-10-12T10:00:00Z', updatedAt: '2026-10-19T09:00:00Z' } as any, NOW)).toBe(false);
    expect(isTaskCompletedToday({ status: 'Done', completedAt: '2026-10-19T06:00:00Z' } as any, NOW)).toBe(true);
    expect(isTaskCompletedToday({ status: 'Todo', completedAt: '2026-10-19T06:00:00Z' } as any, NOW)).toBe(false);
  });
  it('taskDeadline is endDate, else the legacy dueDate, else null — one definition for every surface', () => {
    const end = new Date('2026-10-20T15:00:00Z');
    const due = new Date('2026-10-21T15:00:00Z');
    expect(taskDeadline({ endDate: end, dueDate: due } as any)).toBe(end);
    expect(taskDeadline({ dueDate: due } as any)).toBe(due);
    expect(taskDeadline({} as any)).toBeNull();
    // The chip/filter/row predicate and the grouping predicate agree on a dueDate-only task.
    expect(isTaskOverdue({ status: 'Todo', dueDate: '2026-10-18T09:00:00Z' } as any, NOW)).toBe(true);
    expect(isOverdueDate(taskDeadline({ dueDate: '2026-10-18T09:00:00Z' } as any), NOW)).toBe(true);
  });
  it('todayKeyOf is the Tirane day key (same form as startOfRecurrenceDay) and changes only at Tirane midnight', () => {
    expect(todayKeyOf(NOW)).toBe(Date.UTC(2026, 9, 19));
    // 23:59 Tirane on the 19th (21:59Z) is still the 19th; 22:00Z is the 20th there.
    expect(todayKeyOf(Date.parse('2026-10-19T21:59:00Z'))).toBe(todayKeyOf(NOW));
    expect(todayKeyOf(Date.parse('2026-10-19T22:00:00Z'))).toBe(Date.UTC(2026, 9, 20));
    // A day key is itself a valid `now` for every helper here (what the views
    // pass from useTodayKey): it resolves to the same day as the real instant.
    for (const v of ['2026-10-18T22:30:00Z', '2026-10-19T23:59:00+02:00', '2026-10-26T09:00:00+01:00', '2026-10-17T09:00:00+02:00']) {
      expect(dayDiffFromToday(v, todayKeyOf(NOW))).toBe(dayDiffFromToday(v, NOW));
    }
    expect(isTaskOverdue({ status: 'Todo', endDate: '2026-10-18T09:00:00Z' } as any, todayKeyOf(NOW))).toBe(true);
    expect(isTaskDueToday({ status: 'Todo', endDate: '2026-10-19T15:00:00Z' } as any, todayKeyOf(NOW))).toBe(true);
  });
  it('localDateOfZonedDay / deadlineOnPickedDay round-trip the Tirane day, whatever the machine zone', () => {
    // 23:30Z on the 19th = 20 Oct 01:30 Tirane → the picker must highlight the 20th.
    const sel = localDateOfZonedDay('2026-10-19T23:30:00Z')!;
    expect([sel.getFullYear(), sel.getMonth(), sel.getDate()]).toEqual([2026, 9, 20]);
    expect(localDateOfZonedDay(null)).toBeUndefined();
    // Picking the 22nd keeps the old deadline's Tirane time (01:30), not a local setHours.
    const moved = deadlineOnPickedDay(new Date(2026, 9, 22), '2026-10-19T23:30:00Z');
    expect(zonedParts(moved)).toMatchObject({ year: 2026, month: 9, day: 22, hours: 1, minutes: 30 });
    // An undated task lands at 17:00 Tirane (= 15:00Z in October).
    expect(deadlineOnPickedDay(new Date(2026, 9, 22), null).toISOString()).toBe('2026-10-22T15:00:00.000Z');
    // Across the DST switch the wall-clock hour is kept (26 Oct is UTC+1).
    expect(deadlineOnPickedDay(new Date(2026, 9, 26), null).toISOString()).toBe('2026-10-26T16:00:00.000Z');
  });
  it('zonedDayRange steps calendar days across DST at local midnight', () => {
    const days = zonedDayRange(new Date('2026-10-23T15:00:00Z'), 5);
    expect(days.map(d => zonedParts(d).day)).toEqual([23, 24, 25, 26, 27]);
    expect(days.every(d => zonedParts(d).hours === 0)).toBe(true);
  });
});
