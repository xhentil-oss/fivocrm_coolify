import { describe, it, expect } from 'vitest';
import { projectNextDeadlines, sortProjectsByDeadline } from './projectSort';

const p = (id: string, over: any = {}) => ({ id, status: 'Active', ...over });
const t = (projectId: string, endDate: string | null, status = 'Todo') => ({ projectId, status, endDate } as any);

describe('projects by deadline', () => {
  it('orders by the earliest unfinished task, then project endDate, undated last', () => {
    const projects = [p('none'), p('late'), p('soon'), p('own', { endDate: '2026-10-25' })];
    const tasks = [
      t('late', '2026-11-30'), t('late', '2026-10-01', 'Done'),
      t('soon', '2026-10-20'), t('soon', '2026-12-01'),
    ];
    const d = projectNextDeadlines(projects as any, tasks);
    expect(sortProjectsByDeadline(projects, d).map(x => x.id)).toEqual(['soon', 'own', 'late', 'none']);
  });
  it('an overdue open task puts the project first; a completed project ignores its endDate', () => {
    const projects = [p('a'), p('b', { status: 'Completed', endDate: '2026-01-01' }), p('c')];
    const d = projectNextDeadlines(projects as any, [t('a', '2026-12-01'), t('c', '2026-09-01')]);
    expect(sortProjectsByDeadline(projects, d).map(x => x.id)).toEqual(['c', 'a', 'b']);
  });
});
