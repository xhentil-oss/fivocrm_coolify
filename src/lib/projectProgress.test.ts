import { describe, it, expect } from 'vitest';
import { projectTaskProgress } from './projectProgress';

const NOW = Date.parse('2026-10-19T11:00:00Z'); // 13:00 Tirane

describe('projectTaskProgress', () => {
  it('counts top-level tasks only; overdue is by Tirane day', () => {
    const tasks = [
      { projectId: 'p', status: 'Done' },
      { projectId: 'p', status: 'Todo', endDate: '2026-10-19T08:00:00Z' }, // earlier today → not overdue
      { projectId: 'p', status: 'Todo', endDate: '2026-10-18T08:00:00Z' }, // yesterday → overdue
      { projectId: 'p', status: 'Todo', endDate: '2026-10-01T08:00:00Z', parentTaskId: 'x' }, // subtask
      { projectId: 'q', status: 'Todo', endDate: '2026-10-01T08:00:00Z' },
    ] as any[];
    expect(projectTaskProgress(tasks, 'p', NOW)).toEqual({ total: 3, done: 1, overdue: 1, pct: 33 });
  });
  it('handles an empty list', () => {
    expect(projectTaskProgress(null, 'p', NOW)).toEqual({ total: 0, done: 0, overdue: 0, pct: 0 });
  });
});
