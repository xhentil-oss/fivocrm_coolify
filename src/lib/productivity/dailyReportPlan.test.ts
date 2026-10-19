import { describe, it, expect } from 'vitest';
import {
  isTaskForToday,
  tasksCompletedToday,
  buildPlannedOutcomes,
  unplannedOutcome,
  outcomeNeedsReason,
  outcomesMissingReason,
  outcomesMissingTitle,
  summariseOutcomes,
  customersTouched,
  projectsTouched,
  narrativeFromOutcomes,
  taskStatusUpdates,
  cleanOutcomesForSave,
  isoDay,
} from './dailyReportPlan';
import type { DailyTaskOutcome, Task } from '../../types';

const NOW = new Date(2026, 7, 11, 16, 50); // 11 Aug 2026, local
const day = (offset: number, h = 12) => new Date(2026, 7, 11 + offset, h);

function task(over: Partial<Task> & { id: string }): Task {
  return {
    title: `Detyra ${over.id}`,
    status: 'Todo',
    createdAt: day(-10),
    updatedAt: day(-10),
    ...over,
  } as Task;
}

describe('isTaskForToday', () => {
  it('includes a task due today', () => {
    expect(isTaskForToday(task({ id: 'a', endDate: day(0) }), NOW)).toBe(true);
  });

  it('includes an overdue task — the report must not hide slippage', () => {
    expect(isTaskForToday(task({ id: 'a', endDate: day(-3) }), NOW)).toBe(true);
  });

  it('includes anything In Progress regardless of dates', () => {
    expect(isTaskForToday(task({ id: 'a', status: 'In Progress' }), NOW)).toBe(true);
  });

  it('includes a task created today', () => {
    expect(isTaskForToday(task({ id: 'a', createdAt: day(0, 9) }), NOW)).toBe(true);
  });

  it('excludes a future task and anything already Done', () => {
    expect(isTaskForToday(task({ id: 'a', endDate: day(5) }), NOW)).toBe(false);
    expect(isTaskForToday(task({ id: 'b', status: 'Done', endDate: day(0) }), NOW)).toBe(false);
  });

  it('includes a started task whose deadline has not arrived', () => {
    expect(isTaskForToday(task({ id: 'a', startDate: day(-2), endDate: day(4) }), NOW)).toBe(true);
  });
});

describe('tasksCompletedToday', () => {
  it('counts only Done tasks touched today', () => {
    const list = [
      task({ id: 'a', status: 'Done', updatedAt: day(0, 10) }),
      task({ id: 'b', status: 'Done', updatedAt: day(-1) }),
      task({ id: 'c', status: 'In Progress', updatedAt: day(0, 10) }),
    ];
    expect(tasksCompletedToday(list, NOW).map(t => t.id)).toEqual(['a']);
  });

  it('reads completedAt, not updatedAt — an edit today does not make an old task "done today"', () => {
    const list = [
      task({ id: 'old', status: 'Done', completedAt: day(-6), updatedAt: day(0, 10) }),
      task({ id: 'new', status: 'Done', completedAt: day(0, 9), updatedAt: day(0, 9) }),
      task({ id: 'reopened', status: 'Todo', completedAt: null, updatedAt: day(0, 10) }),
    ];
    expect(tasksCompletedToday(list, NOW).map(t => t.id)).toEqual(['new']);
  });
});

describe('buildPlannedOutcomes', () => {
  const tasks = [
    task({ id: 'done', status: 'Done', updatedAt: day(0, 11), projectId: 'p1' }),
    task({ id: 'prog', status: 'In Progress', projectId: 'p1' }),
    task({ id: 'late', endDate: day(-2), projectId: 'p2' }),
    task({ id: 'future', endDate: day(6) }),
  ];

  it('pre-answers what the board already knows and defaults the rest to not_started', () => {
    const rows = buildPlannedOutcomes(tasks, NOW);
    const byId = Object.fromEntries(rows.map(r => [r.taskId, r.state]));
    expect(byId).toEqual({ done: 'done', prog: 'in_progress', late: 'not_started' });
  });

  it('never defaults an untouched task to in_progress', () => {
    const rows = buildPlannedOutcomes([task({ id: 'late', endDate: day(-2) })], NOW);
    expect(rows[0].state).toBe('not_started');
  });

  it('carries the client through from the project', () => {
    const rows = buildPlannedOutcomes(tasks, NOW, {
      customerByProjectId: { p1: 'cust-1', p2: 'cust-2' },
    });
    expect(rows.find(r => r.taskId === 'late')?.customerId).toBe('cust-2');
    expect(rows.find(r => r.taskId === 'done')?.customerId).toBe('cust-1');
  });

  it('snapshots the title rather than referencing the task', () => {
    const rows = buildPlannedOutcomes([task({ id: 'x', title: 'Titulli i sotëm', status: 'In Progress' })], NOW);
    expect(rows[0].title).toBe('Titulli i sotëm');
  });

  it('does not list a completed task twice', () => {
    const rows = buildPlannedOutcomes(
      [task({ id: 'done', status: 'Done', updatedAt: day(0, 11) })],
      NOW,
    );
    expect(rows).toHaveLength(1);
  });
});

describe('outcomeNeedsReason', () => {
  const base: DailyTaskOutcome = { taskId: 't', title: 'X', state: 'not_started' };

  it('demands a reason for planned work that did not finish', () => {
    expect(outcomeNeedsReason(base)).toBe(true);
    expect(outcomeNeedsReason({ ...base, state: 'in_progress' })).toBe(true);
  });

  it('is satisfied by a real reason, not whitespace', () => {
    expect(outcomeNeedsReason({ ...base, reason: '   ' })).toBe(true);
    expect(outcomeNeedsReason({ ...base, reason: 'Pres materialet' })).toBe(false);
  });

  it('never demands one for finished or unplanned work', () => {
    expect(outcomeNeedsReason({ ...base, state: 'done' })).toBe(false);
    expect(outcomeNeedsReason({ ...base, unplanned: true })).toBe(false);
  });
});

describe('validation helpers', () => {
  it('lists the rows that block submission', () => {
    const rows: DailyTaskOutcome[] = [
      { title: 'A', state: 'done' },
      { title: 'B', state: 'not_started' },
      { title: 'C', state: 'in_progress', reason: 'pres dizajnin' },
    ];
    expect(outcomesMissingReason(rows).map(r => r.title)).toEqual(['B']);
  });

  it('catches an empty unplanned line', () => {
    expect(outcomesMissingTitle([unplannedOutcome(''), { title: 'A', state: 'done' }])).toHaveLength(1);
  });
});

describe('summariseOutcomes', () => {
  const rows: DailyTaskOutcome[] = [
    { title: 'A', state: 'done', hours: 2 },
    { title: 'B', state: 'done', hours: 1.5 },
    { title: 'C', state: 'in_progress', reason: 'r' },
    { title: 'D', state: 'not_started', reason: 'r' },
    { title: 'E', state: 'done', unplanned: true, hours: 1 },
  ];

  it('separates planned from unplanned work', () => {
    const s = summariseOutcomes(rows);
    expect(s.planned).toBe(4);
    expect(s.unplanned).toBe(1);
    expect(s.done).toBe(2);
    expect(s.inProgress).toBe(1);
    expect(s.notStarted).toBe(1);
  });

  it('sums hours across both', () => {
    expect(summariseOutcomes(rows).hoursLogged).toBe(4.5);
  });

  it('reports an unknown completion rate rather than 0% when nothing was planned', () => {
    expect(summariseOutcomes([{ title: 'X', state: 'done', unplanned: true }]).completionRate).toBeNull();
    expect(summariseOutcomes(rows).completionRate).toBe(0.5);
  });
});

describe('customersTouched / projectsTouched', () => {
  it('returns each client and project once', () => {
    const rows: DailyTaskOutcome[] = [
      { title: 'A', state: 'done', customerId: 'c1', projectId: 'p1' },
      { title: 'B', state: 'done', customerId: 'c1', projectId: 'p1' },
      { title: 'C', state: 'not_started', reason: 'r', customerId: 'c2', projectId: 'p2' },
      { title: 'D', state: 'done' },
    ];
    expect(customersTouched(rows)).toEqual(['c1', 'c2']);
    expect(projectsTouched(rows)).toEqual(['p1', 'p2']);
  });
});

describe('narrativeFromOutcomes', () => {
  const rows: DailyTaskOutcome[] = [
    { title: 'Optimizova faqen', state: 'done' },
    { title: 'Raporti mujor', state: 'in_progress', reason: 'mbeti grafiku' },
    { title: 'Auditi teknik', state: 'not_started', reason: 'pa akses' },
    { title: 'Thirrje urgjente', state: 'done', unplanned: true },
  ];

  it('splits finished from unfinished', () => {
    const { completedToday, openItems } = narrativeFromOutcomes(rows);
    expect(completedToday).toContain('• Optimizova faqen');
    expect(completedToday).not.toContain('Auditi teknik');
    expect(openItems).toContain('• Raporti mujor — në progres: mbeti grafiku');
    expect(openItems).toContain('• Auditi teknik — nuk u prek: pa akses');
  });

  it('marks unplanned work as such', () => {
    expect(narrativeFromOutcomes(rows).completedToday).toContain('Thirrje urgjente (e paplanifikuar)');
  });

  it('skips blank rows', () => {
    expect(narrativeFromOutcomes([{ title: '  ', state: 'done' }]).completedToday).toBe('');
  });
});

describe('taskStatusUpdates', () => {
  it('maps answers to board statuses and ignores unplanned rows', () => {
    const rows: DailyTaskOutcome[] = [
      { taskId: 't1', title: 'A', state: 'done' },
      { taskId: 't2', title: 'B', state: 'in_progress', reason: 'r' },
      { taskId: 't3', title: 'C', state: 'not_started', reason: 'r' },
      { title: 'D', state: 'done', unplanned: true },
    ];
    expect(taskStatusUpdates(rows)).toEqual([
      { taskId: 't1', status: 'Done' },
      { taskId: 't2', status: 'In Progress' },
    ]);
  });
});

describe('cleanOutcomesForSave', () => {
  it('drops blank rows and every undefined key', () => {
    const saved = cleanOutcomesForSave([
      { title: '  ', state: 'done' },
      { taskId: 't1', title: ' A ', state: 'not_started', reason: '  pres  ', hours: undefined, projectId: undefined },
    ]);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toEqual({ taskId: 't1', title: 'A', state: 'not_started', reason: 'pres' });
    expect(Object.values(saved[0]).some(v => v === undefined)).toBe(false);
  });

  it('keeps zero hours out but real hours in', () => {
    const [a, b] = cleanOutcomesForSave([
      { title: 'A', state: 'done', hours: 0 },
      { title: 'B', state: 'done', hours: 2.5 },
    ]);
    expect('hours' in a).toBe(false);
    expect(b.hours).toBe(2.5);
  });
});

describe('isoDay', () => {
  it('pads and stays local', () => {
    expect(isoDay(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05');
  });
});
