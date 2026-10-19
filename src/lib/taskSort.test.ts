import { describe, it, expect } from 'vitest';
import {
  taskDateMs, taskDueMs, compareTasksByDue, compareTasksByPriorityThenDue,
  compareTasksBySectionThenDue, compareTasksByTimeOfDayThenPriority,
  sortByManualOrder, pruneManualOrder, doneLast,
} from './taskSort';
import type { Task } from '../types';

const t = (id: string, over: Partial<Task> = {}): Task => ({
  id, title: id, status: 'Todo', createdAt: new Date(0), updatedAt: new Date(0), createdByUserId: 'u', ...over,
} as Task);

describe('taskDateMs — every shape a date arrives in', () => {
  const ms = Date.parse('2026-09-10T15:00:00Z');
  it('Date, Timestamp-like, ISO string and number all agree', () => {
    expect(taskDateMs(new Date(ms))).toBe(ms);
    expect(taskDateMs({ toMillis: () => ms, toDate: () => new Date(ms) })).toBe(ms);
    expect(taskDateMs({ toDate: () => new Date(ms) })).toBe(ms);
    expect(taskDateMs('2026-09-10T15:00:00Z')).toBe(ms);
    expect(taskDateMs(ms)).toBe(ms);
  });
  it('absent or invalid is null, never NaN or the epoch', () => {
    expect(taskDateMs(undefined)).toBeNull();
    expect(taskDateMs(null)).toBeNull();
    expect(taskDateMs('')).toBeNull();
    expect(taskDateMs('nope')).toBeNull();
    expect(taskDateMs(new Date('nope'))).toBeNull();
  });
  it('falls back to the legacy dueDate', () => {
    expect(taskDueMs({ dueDate: new Date(ms) } as Task)).toBe(ms);
    expect(taskDueMs({ endDate: new Date(ms + 1), dueDate: new Date(ms) } as Task)).toBe(ms + 1);
  });
});

describe('compareTasksByDue', () => {
  it('earliest first, undated LAST, mixed shapes compare correctly', () => {
    const a = t('a', { endDate: '2026-09-12T09:00:00Z' as any });
    const b = t('b', { endDate: new Date('2026-09-10T09:00:00Z') });
    const c = t('c');
    const d = t('d', { endDate: { toMillis: () => Date.parse('2026-09-11T09:00:00Z') } as any });
    expect([a, c, b, d].sort(compareTasksByDue).map(x => x.id)).toEqual(['b', 'd', 'a', 'c']);
  });
  it('is deterministic for equal deadlines (tie by id)', () => {
    const same = new Date('2026-09-10T09:00:00Z');
    const arr = [t('z', { endDate: same }), t('a', { endDate: same }), t('m', { endDate: same })];
    expect([...arr].sort(compareTasksByDue).map(x => x.id)).toEqual(['a', 'm', 'z']);
    expect([...arr].reverse().sort(compareTasksByDue).map(x => x.id)).toEqual(['a', 'm', 'z']);
  });
});

describe('compareTasksByPriorityThenDue', () => {
  it('urgent before high before medium before low; unknown = medium', () => {
    const arr = [t('low', { priority: 'low' }), t('none'), t('urg', { priority: 'urgent' }), t('high', { priority: 'high' }), t('weird', { priority: 'p0' as any })];
    expect(arr.sort(compareTasksByPriorityThenDue).map(x => x.id)).toEqual(['urg', 'high', 'none', 'weird', 'low']);
  });
});

describe('compareTasksBySectionThenDue', () => {
  it('puts tasks WITHOUT a section last (the ~~~ sentinel put them first)', () => {
    const arr = [t('n1'), t('d', { section: 'Design' }), t('n2'), t('a', { section: 'analiza' }), t('c', { section: 'Çështje' })];
    expect(arr.sort(compareTasksBySectionThenDue).map(x => x.id)).toEqual(['a', 'c', 'd', 'n1', 'n2']);
  });
  it('orders by deadline inside a section', () => {
    const arr = [
      t('late', { section: 'S', endDate: new Date('2026-09-20') }),
      t('soon', { section: 'S', endDate: new Date('2026-09-05') }),
      t('undated', { section: 'S' }),
    ];
    expect(arr.sort(compareTasksBySectionThenDue).map(x => x.id)).toEqual(['soon', 'late', 'undated']);
  });
});

describe('compareTasksByTimeOfDayThenPriority (calendar cells)', () => {
  it('09:00 before 14:00 regardless of priority; same time → priority', () => {
    const arr = [
      t('pm-urgent', { priority: 'urgent', endDate: new Date(2026, 8, 10, 14, 0) }),
      t('am-low', { priority: 'low', endDate: new Date(2026, 8, 10, 9, 0) }),
      t('am-high', { priority: 'high', endDate: new Date(2026, 8, 10, 9, 0) }),
    ];
    expect(arr.sort(compareTasksByTimeOfDayThenPriority).map(x => x.id)).toEqual(['am-high', 'am-low', 'pm-urgent']);
  });
});

describe('manual order', () => {
  it('unknown (newly created) tasks go FIRST and keep their incoming order', () => {
    const order = new Map([['b', 0], ['a', 1]]);
    const incoming = [t('new2'), t('new1'), t('a'), t('b')]; // createdAt desc from the query
    expect(sortByManualOrder(incoming, order).map(x => x.id)).toEqual(['new2', 'new1', 'b', 'a']);
  });
  it('an empty order is a no-op (same reference)', () => {
    const arr = [t('a')];
    expect(sortByManualOrder(arr, new Map())).toBe(arr);
  });
  it('pruning drops ids of deleted tasks and keeps the order', () => {
    expect(pruneManualOrder(['gone', 'b', 'a', 'gone2'], [t('a'), t('b')])).toEqual(['b', 'a']);
  });
});

describe('doneLast', () => {
  it('sinks completed tasks below open ones, keeping each side in order', () => {
    const arr = [t('a', { status: 'Done' }), t('b'), t('c', { status: 'Done' }), t('d', { status: 'In Progress' })];
    expect(doneLast(arr).map(x => x.id)).toEqual(['b', 'd', 'a', 'c']);
  });
  it('a completed task goes last inside its own section', () => {
    const arr = [t('a', { section: 'S', status: 'Done' }), t('b', { section: 'S' }), t('c')];
    expect([...arr].sort(compareTasksBySectionThenDue).map(x => x.id)).toEqual(['b', 'a', 'c']);
  });
});
