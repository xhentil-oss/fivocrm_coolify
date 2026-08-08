import { describe, it, expect } from 'vitest';
import { findSameDayTasks, startOfDay, type SchedulableTask } from './taskConflicts';

const d = (iso: string) => new Date(iso);

const tasks: SchedulableTask[] = [
  { id: 't1', title: 'SEO raport', status: 'Todo', assignedToUserId: 'elton', startDate: d('2026-08-10T09:00:00'), endDate: d('2026-08-10T11:00:00') },
  { id: 't2', title: 'Fushatë Ads', status: 'In Progress', assignedToUserId: 'elton', startDate: d('2026-08-09T09:00:00'), endDate: d('2026-08-12T17:00:00') },
  { id: 't3', title: 'E kryer', status: 'Done', assignedToUserId: 'elton', startDate: d('2026-08-10T09:00:00'), endDate: d('2026-08-10T10:00:00') },
  { id: 't4', title: 'Detyra e Anës', status: 'Todo', assignedToUserId: 'ana', endDate: d('2026-08-10T12:00:00') },
  { id: 't5', title: 'Pa datë', status: 'Todo', assignedToUserId: 'elton' },
  { id: 't6', title: 'Ditë tjetër', status: 'Todo', assignedToUserId: 'elton', endDate: d('2026-08-13T09:00:00') },
];

describe('startOfDay', () => {
  it('normalises Date / ISO string / ms to local midnight', () => {
    const expected = new Date(2026, 7, 10).getTime();
    expect(startOfDay(d('2026-08-10T23:59:00'))).toBe(expected);
    expect(startOfDay(new Date(2026, 7, 10, 8, 30).toISOString())).toBe(expected);
    expect(startOfDay(new Date(2026, 7, 10, 8, 30).getTime())).toBe(expected);
  });

  it('returns null for missing or invalid values', () => {
    expect(startOfDay(null)).toBeNull();
    expect(startOfDay(undefined)).toBeNull();
    expect(startOfDay('')).toBeNull();
    expect(startOfDay('jo-datë')).toBeNull();
  });
});

describe('findSameDayTasks', () => {
  it('finds the assignee’s tasks on that calendar day, ignoring time-of-day', () => {
    const found = findSameDayTasks(tasks, { assigneeId: 'elton', date: d('2026-08-10T16:45:00') });
    expect(found.map(t => t.id)).toEqual(['t1', 't2']);
  });

  it('counts a multi-day task on every day it spans', () => {
    const found = findSameDayTasks(tasks, { assigneeId: 'elton', date: d('2026-08-11T09:00:00') });
    expect(found.map(t => t.id)).toEqual(['t2']);
  });

  it('ignores other people, completed, undated and other-day tasks', () => {
    const found = findSameDayTasks(tasks, { assigneeId: 'elton', date: d('2026-08-10T09:00:00') });
    expect(found.map(t => t.id)).not.toContain('t3'); // Done
    expect(found.map(t => t.id)).not.toContain('t4'); // another assignee
    expect(found.map(t => t.id)).not.toContain('t5'); // no dates
    expect(found.map(t => t.id)).not.toContain('t6'); // another day
  });

  it('counts completed tasks when includeDone is set', () => {
    const found = findSameDayTasks(tasks, { assigneeId: 'elton', date: d('2026-08-10T09:00:00'), includeDone: true });
    expect(found.map(t => t.id)).toContain('t3');
  });

  it('never conflicts with the task being edited', () => {
    const found = findSameDayTasks(tasks, { assigneeId: 'elton', date: d('2026-08-10T09:00:00'), excludeTaskId: 't1' });
    expect(found.map(t => t.id)).toEqual(['t2']);
  });

  it('matches a task that only has a start date', () => {
    const onlyStart: SchedulableTask[] = [{ id: 's1', assignedToUserId: 'elton', startDate: d('2026-08-10T09:00:00') }];
    expect(findSameDayTasks(onlyStart, { assigneeId: 'elton', date: d('2026-08-10T18:00:00') })).toHaveLength(1);
  });

  it('returns nothing without an assignee, without a date, or on an empty list', () => {
    expect(findSameDayTasks(tasks, { assigneeId: '', date: d('2026-08-10T09:00:00') })).toEqual([]);
    expect(findSameDayTasks(tasks, { assigneeId: 'elton', date: undefined })).toEqual([]);
    expect(findSameDayTasks(null, { assigneeId: 'elton', date: d('2026-08-10T09:00:00') })).toEqual([]);
  });
});
