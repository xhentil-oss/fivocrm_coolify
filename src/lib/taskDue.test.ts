import { describe, it, expect } from 'vitest';
import {
  dayDiffFromToday, isOverdueDate, isDueTodayDate, isTaskOverdue, isTaskDueToday,
  isTaskCompletedToday, zonedDayRange,
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
  it('zonedDayRange steps calendar days across DST at local midnight', () => {
    const days = zonedDayRange(new Date('2026-10-23T15:00:00Z'), 5);
    expect(days.map(d => zonedParts(d).day)).toEqual([23, 24, 25, 26, 27]);
    expect(days.every(d => zonedParts(d).hours === 0)).toBe(true);
  });
});
