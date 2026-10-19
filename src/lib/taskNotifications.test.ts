import { describe, it, expect } from 'vitest';
import { taskCompletionRecipients, taskCompletedNotifications } from './taskNotifications';
import type { Task } from '../types';

const task = (over: Partial<Task> = {}): Task => ({
  id: 't1',
  title: 'Dizajni i faqes',
  status: 'In Progress',
  createdByUserId: 'creator',
  assignedToUserId: 'assignee',
  ...over,
} as Task);

describe('taskCompletionRecipients', () => {
  it('notifies creator + assignee + collaborators, deduped', () => {
    const t = task({ collaboratorIds: ['collab1', 'collab2', 'assignee'] });
    expect(taskCompletionRecipients(t, 'someone-else').sort())
      .toEqual(['assignee', 'collab1', 'collab2', 'creator']);
  });

  it('includes the series author of a recurring occurrence (create() stamped the completer)', () => {
    const t = task({ createdByUserId: 'last-completer', seriesCreatedByUserId: 'author' } as any);
    expect(taskCompletionRecipients(t, 'assignee').sort()).toEqual(['author', 'last-completer']);
  });

  it('never notifies the actor themselves', () => {
    expect(taskCompletionRecipients(task(), 'assignee')).toEqual(['creator']);
    expect(taskCompletionRecipients(task(), 'creator')).toEqual(['assignee']);
  });

  it('is empty for a solo task closed by its own person', () => {
    const solo = task({ createdByUserId: 'me', assignedToUserId: 'me', collaboratorIds: [] });
    expect(taskCompletionRecipients(solo, 'me')).toEqual([]);
  });

  it('tolerates missing fields', () => {
    const bare = task({ createdByUserId: undefined, assignedToUserId: undefined, collaboratorIds: undefined });
    expect(taskCompletionRecipients(bare, 'me')).toEqual([]);
  });
});

describe('taskCompletedNotifications', () => {
  it('deep-links a project task to its project page', () => {
    const rows = taskCompletedNotifications(task({ projectId: 'p9' }), 'assignee');
    expect(rows).toHaveLength(1);
    expect(rows[0].actionUrl).toBe('/app/projects/p9?taskId=t1');
    expect(rows[0].type).toBe('task_completed');
  });

  it('deep-links a standalone task to Detyrat', () => {
    const rows = taskCompletedNotifications(task(), 'creator');
    expect(rows[0].actionUrl).toBe('/app/tasks?taskId=t1');
  });

  it('names the actor when known', () => {
    const rows = taskCompletedNotifications(task(), 'creator', 'Ana');
    expect(rows[0].message).toContain('Ana');
  });
});
