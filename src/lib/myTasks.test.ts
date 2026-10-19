import { describe, it, expect } from 'vitest';
import type { Task } from '../types';
import {
  bucketOf, buildMyTasks, daysLeftInWeek, deadProjectIdsOf, isAssignedToMe, isCollaborationOnly,
  myTaskIds, snoozeToTomorrowDate, quickAddDates, tiraneDayValue, dueLabel,
} from './myTasks';
import { zonedParts } from './recurringUtils';

// Monday 19 Oct 2026, 13:00 in Tirane (UTC+2, CEST) = 11:00Z.
const NOW = Date.parse('2026-10-19T11:00:00Z');
const ME = 'u1';
const IDS = myTaskIds({ uid: ME, email: 'me@x.al' });

let seq = 0;
const task = (over: Partial<Task> = {}): Task => ({
  id: over.id ?? `t${++seq}`,
  title: 'x',
  status: 'Todo',
  assignedToUserId: ME,
  createdAt: new Date(NOW),
  updatedAt: new Date(NOW),
  createdByUserId: ME,
  ...over,
} as Task);

describe('myTasks — identity', () => {
  it('matches uid and legacy email assignees', () => {
    expect(IDS).toEqual(['u1', 'me@x.al']);
    expect(isAssignedToMe({ assignedToUserId: 'me@x.al' }, IDS)).toBe(true);
    expect(isAssignedToMe({ assignedToUserId: 'u2' }, IDS)).toBe(false);
    expect(myTaskIds(null)).toEqual([]);
  });
  it('collaboration only when not the assignee', () => {
    expect(isCollaborationOnly({ assignedToUserId: 'u2', collaboratorIds: ['u1'] }, IDS)).toBe(true);
    expect(isCollaborationOnly({ assignedToUserId: 'u1', collaboratorIds: ['u1'] }, IDS)).toBe(false);
    expect(isCollaborationOnly({ assignedToUserId: 'u2' }, IDS)).toBe(false);
  });
});

describe('myTasks — buckets in Tirane days', () => {
  it('Monday: overdue / today / tomorrow / this week / later / no date', () => {
    expect(daysLeftInWeek(NOW)).toBe(6);
    expect(bucketOf({ endDate: '2026-10-18T20:00:00+02:00' as any }, NOW)).toBe('overdue');
    expect(bucketOf({ endDate: '2026-10-19T09:00:00+02:00' as any }, NOW)).toBe('today'); // earlier today is NOT overdue
    expect(bucketOf({ endDate: '2026-10-18T22:30:00Z' as any }, NOW)).toBe('today'); // 00:30 local on the 19th
    expect(bucketOf({ endDate: '2026-10-20T17:00:00+02:00' as any }, NOW)).toBe('tomorrow');
    expect(bucketOf({ endDate: '2026-10-25T17:00:00+01:00' as any }, NOW)).toBe('thisWeek'); // Sunday, after DST switch
    expect(bucketOf({ endDate: '2026-10-26T09:00:00+01:00' as any }, NOW)).toBe('later'); // next Monday
    expect(bucketOf({}, NOW)).toBe('noDate');
    expect(bucketOf({ dueDate: '2026-10-17T09:00:00+02:00' as any }, NOW)).toBe('overdue'); // legacy dueDate
  });
  it('Saturday: Sunday is "tomorrow", nothing is "this week"; Sunday has 0 days left', () => {
    const SAT = Date.parse('2026-10-24T10:00:00Z');
    expect(daysLeftInWeek(SAT)).toBe(1);
    expect(bucketOf({ endDate: '2026-10-25T12:00:00+01:00' as any }, SAT)).toBe('tomorrow');
    expect(bucketOf({ endDate: '2026-10-26T12:00:00+01:00' as any }, SAT)).toBe('later');
    expect(daysLeftInWeek(Date.parse('2026-10-25T10:00:00Z'))).toBe(0);
  });
});

describe('buildMyTasks', () => {
  const projects = [
    { id: 'pLive', status: 'Active' },
    { id: 'pArch', status: 'Archived' },
    { id: 'pCanc', status: 'Cancelled' },
  ];
  const dead = deadProjectIdsOf(projects);

  it('dead projects are archived + cancelled only', () => {
    expect([...dead].sort()).toEqual(['pArch', 'pCanc']);
  });

  it('buckets my open tasks, drops others, dead projects, and old Done rows', () => {
    const rows = [
      task({ id: 'a', endDate: '2026-10-19T15:00:00+02:00' as any, estimatedHours: 2 }),
      task({ id: 'b', endDate: '2026-10-19T10:00:00+02:00' as any, estimatedHours: 1.5, priority: 'urgent' }),
      task({ id: 'c', endDate: '2026-10-15T10:00:00+02:00' as any }),
      task({ id: 'd', endDate: '2026-10-19T10:00:00+02:00' as any, projectId: 'pArch' }),
      task({ id: 'e', endDate: '2026-10-19T10:00:00+02:00' as any, assignedToUserId: 'u2' }),
      task({ id: 'f', status: 'Done', completedAt: new Date(NOW - 3600_000) }),
      task({ id: 'g', status: 'Done', completedAt: new Date(NOW - 3 * 86_400_000) }),
      task({ id: 'h' }),
      task({ id: 'i', endDate: '2026-10-19T12:00:00+02:00' as any, projectId: 'pLive' }),
    ];
    const r = buildMyTasks(rows, { myIds: IDS, deadProjectIds: dead, now: NOW });
    // Today: urgent first, then by deadline.
    expect(r.buckets.today.map(t => t.id)).toEqual(['b', 'i', 'a']);
    expect(r.buckets.overdue.map(t => t.id)).toEqual(['c']);
    expect(r.buckets.noDate.map(t => t.id)).toEqual(['h']);
    expect(r.completedToday.map(t => t.id)).toEqual(['f']);
    expect(r.summary).toEqual({ today: 3, overdue: 1, estimatedHoursToday: 3.5, completedToday: 1 });
  });

  it('collaborations are hidden behind the toggle and never move the summary', () => {
    const rows = [
      task({ id: 'mine', endDate: '2026-10-19T15:00:00+02:00' as any }),
      task({ id: 'col', assignedToUserId: 'u2', collaboratorIds: [ME], endDate: '2026-10-19T15:00:00+02:00' as any, estimatedHours: 4 }),
      task({ id: 'colDone', assignedToUserId: 'u2', collaboratorIds: [ME], status: 'Done', completedAt: new Date(NOW - 60_000) }),
    ];
    const off = buildMyTasks(rows, { myIds: IDS, now: NOW });
    expect(off.buckets.today.map(t => t.id)).toEqual(['mine']);
    expect(off.collaborationCount).toBe(1);
    expect(off.completedToday).toEqual([]);
    const on = buildMyTasks(rows, { myIds: IDS, now: NOW, includeCollaborations: true });
    expect(on.buckets.today.map(t => t.id).sort()).toEqual(['col', 'mine']);
    expect(on.collaborationIds.has('col')).toBe(true);
    expect(on.completedToday.map(t => t.id)).toEqual(['colDone']);
    expect(on.summary).toEqual(off.summary);
    expect(on.summary.today).toBe(1);
  });

  it('completed today is newest first; legacy Done rows fall back to updatedAt', () => {
    const rows = [
      task({ id: 'old', status: 'Done', completedAt: new Date(NOW - 5 * 3600_000) }),
      task({ id: 'new', status: 'Done', completedAt: new Date(NOW - 60_000) }),
      task({ id: 'legacy', status: 'Done', updatedAt: new Date(NOW - 2 * 3600_000) }),
    ];
    expect(buildMyTasks(rows, { myIds: IDS, now: NOW }).completedToday.map(t => t.id)).toEqual(['new', 'legacy', 'old']);
  });

  it('tolerates null input', () => {
    const r = buildMyTasks(null, { myIds: IDS, now: NOW });
    expect(r.summary.today).toBe(0);
    expect(r.buckets.later).toEqual([]);
  });
});

describe('date helpers', () => {
  it('snooze keeps the time of day and lands on tomorrow in Tirane', () => {
    const d = snoozeToTomorrowDate({ endDate: '2026-10-15T14:30:00+02:00' as any }, NOW);
    const p = zonedParts(d);
    expect([p.year, p.month + 1, p.day, p.hours, p.minutes]).toEqual([2026, 10, 20, 14, 30]);
    const u = zonedParts(snoozeToTomorrowDate({}, NOW));
    expect([u.day, u.hours]).toEqual([20, 17]);
  });
  it('snooze across the DST switch keeps the wall-clock hour', () => {
    const SAT = Date.parse('2026-10-24T10:00:00Z');
    const p = zonedParts(snoozeToTomorrowDate({ endDate: '2026-10-24T09:00:00+02:00' as any }, SAT));
    expect([p.day, p.hours]).toEqual([25, 9]);
  });
  it('quick-add dates are 09:00–17:00 Tirane; empty/invalid = undated', () => {
    const r = quickAddDates('2026-10-21');
    expect(zonedParts(r.startDate!).hours).toBe(9);
    expect(zonedParts(r.endDate!).hours).toBe(17);
    expect(zonedParts(r.endDate!).day).toBe(21);
    expect(quickAddDates('')).toEqual({});
    expect(quickAddDates('21/10/2026')).toEqual({});
  });
  it('day values and labels', () => {
    expect(tiraneDayValue(0, NOW)).toBe('2026-10-19');
    expect(tiraneDayValue(1, NOW)).toBe('2026-10-20');
    expect(dueLabel({ endDate: '2026-10-19T17:00:00+02:00' as any }, NOW)).toBe('Sot 17:00');
    expect(dueLabel({ endDate: '2026-10-17T17:00:00+02:00' as any }, NOW)).toBe('2d vonuar');
    expect(dueLabel({ endDate: '2026-10-20T17:00:00+02:00' as any }, NOW)).toBe('Nesër 17:00');
    expect(dueLabel({ endDate: '2026-10-24T17:00:00+02:00' as any }, NOW)).toBe('24 tet');
    expect(dueLabel({}, NOW)).toBe('');
  });
});

describe('legacy collaboratorIds shapes', () => {
  it('a non-array collaboratorIds never throws and never matches', () => {
    for (const bad of ['u1', { u1: true }, 42, null]) {
      expect(isCollaborationOnly({ assignedToUserId: 'u2', collaboratorIds: bad as any }, IDS)).toBe(false);
    }
  });
});
