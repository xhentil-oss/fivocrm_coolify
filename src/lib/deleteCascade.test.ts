import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * The cascade's law: a task is deleted only after EVERY satellite write went
 * through. Logged hours the caller may not unlink (a colleague's row, a closed
 * month) stop it before anything is touched; any other refused satellite keeps
 * the task so the cascade can be re-run. And the satellites are looked up in
 * the TASK's business, not merely the active one.
 */

type Row = { id: string; col: string; data: Record<string, any> };
let rows: Row[] = [];
let denied: Set<string>; // "col/id" whose writes are refused
let deniedReads: Set<string>; // collections whose LIST is refused (rules are not filters)
const writes: string[] = [];
const reads: { col: string; wheres: { field: string; op: string; value: any }[] }[] = [];

const key = (col: string, id: string) => `${col}/${id}`;

vi.mock('./firebase', () => ({ db: {} }));
vi.mock('../hooks/useFirestore', () => ({ getGlobalBusinessId: () => 'bizActive' }));
vi.mock('firebase/firestore', () => ({
  arrayRemove: (v: unknown) => ({ __arrayRemove: v }),
  collection: (_db: unknown, col: string) => ({ col }),
  doc: (_db: unknown, col: string, id: string) => ({ col, id }),
  where: (field: string, op: string, value: unknown) => ({ field, op, value }),
  // `query(query(...), where(...))` nests: keep the inner clauses, like Firestore.
  query: (c: { col: string; wheres?: { field: string; op: string; value: any }[] }, ...wheres: { field: string; op: string; value: any }[]) =>
    ({ col: c.col, wheres: [...(c.wheres || []), ...wheres] }),
  getDoc: async (ref: { col: string; id: string }) => {
    const r = rows.find(x => x.col === ref.col && x.id === ref.id);
    return { exists: () => !!r, data: () => r?.data };
  },
  getDocs: async (q: { col: string; wheres: { field: string; op: string; value: any }[] }) => {
    reads.push(q);
    if (deniedReads.has(q.col)) throw new Error('permission-denied');
    const docs = rows
      .filter(r => r.col === q.col)
      .filter(r => q.wheres.every(w =>
        w.op === '==' ? r.data[w.field] === w.value
          : w.op === 'array-contains' ? (r.data[w.field] || []).includes(w.value)
          // Firestore's `!=` matches only documents that HAVE the field.
          : w.op === '!=' ? (w.field in r.data && r.data[w.field] !== w.value)
          : true))
      .map(r => ({ id: r.id, ref: { col: r.col, id: r.id }, data: () => r.data }));
    return { docs, size: docs.length };
  },
  updateDoc: async (ref: { col: string; id: string }) => {
    if (denied.has(key(ref.col, ref.id))) throw new Error('permission-denied');
    writes.push(`update ${key(ref.col, ref.id)}`);
  },
  deleteDoc: async (ref: { col: string; id: string }) => {
    if (denied.has(key(ref.col, ref.id))) throw new Error('permission-denied');
    writes.push(`delete ${key(ref.col, ref.id)}`);
    rows = rows.filter(r => !(r.col === ref.col && r.id === ref.id));
  },
}));

import { deleteProjectCascade, deleteTaskCascade, TIME_ENTRIES_UNLINK_DENIED } from './deleteCascade';

beforeEach(() => {
  denied = new Set();
  deniedReads = new Set();
  writes.length = 0;
  reads.length = 0;
  rows = [
    { col: 'tasks', id: 't1', data: { businessId: 'bizTask', title: 'Parent' } },
    { col: 'tasks', id: 's1', data: { businessId: 'bizTask', parentTaskId: 't1' } },
    { col: 'taskComments', id: 'c1', data: { businessId: 'bizTask', taskId: 't1' } },
    { col: 'taskCollaborators', id: 'k1', data: { businessId: 'bizTask', taskId: 't1' } },
    { col: 'timeEntries', id: 'e1', data: { businessId: 'bizTask', taskId: 't1', endTime: new Date() } },
  ];
});

describe('deleteTaskCascade', () => {
  it('deletes satellites, unlinks hours, then subtasks and the task — in the task\'s own business', async () => {
    const s = await deleteTaskCascade('t1');
    expect(s.tasks).toBe(2);
    expect(s.comments).toBe(1);
    expect(s.timeEntriesUnlinked).toBe(1);
    expect(writes).toContain('update timeEntries/e1');
    expect(writes).toContain('delete taskComments/c1');
    expect(writes[writes.length - 1]).toBe('delete tasks/t1');
  });

  it('refuses to delete when hours cannot be unlinked — and touches nothing else', async () => {
    denied.add('timeEntries/e1');
    await expect(deleteTaskCascade('t1')).rejects.toThrow(TIME_ENTRIES_UNLINK_DENIED);
    expect(writes).toEqual([]);
    expect(rows.some(r => r.id === 't1')).toBe(true);
    expect(rows.some(r => r.id === 'c1')).toBe(true);
  });

  it('keeps the task when another satellite write is refused', async () => {
    denied.add('taskComments/c1');
    await expect(deleteTaskCascade('t1')).rejects.toThrow(/detyra nuk u fshi/);
    expect(rows.some(r => r.id === 't1')).toBe(true);
    expect(rows.some(r => r.id === 's1')).toBe(true);
  });

  it('keeps the parent when a subtask cannot be deleted', async () => {
    denied.add('tasks/s1');
    await expect(deleteTaskCascade('t1')).rejects.toThrow(/nën-detyra/);
    expect(rows.some(r => r.id === 't1')).toBe(true);
  });

  it('deletes the task\'s chat rows (messages with taskId), business-scoped', async () => {
    rows.push({ col: 'messages', id: 'm1', data: { businessId: 'bizTask', taskId: 't1', isRead: false } });
    rows.push({ col: 'messages', id: 'm2', data: { businessId: 'bizTask', taskId: 'other' } });
    const s = await deleteTaskCascade('t1');
    expect(s.chatMessages).toBe(1);
    expect(writes).toContain('delete messages/m1');
    expect(writes).not.toContain('delete messages/m2');
    const chatRead = reads.find(q => q.col === 'messages')!;
    expect(chatRead.wheres).toEqual(expect.arrayContaining([
      { field: 'businessId', op: '==', value: 'bizTask' },
      { field: 'taskId', op: '==', value: 't1' },
    ]));
  });

  it('a denied chat read degrades (rows stay) instead of blocking the delete', async () => {
    rows.push({ col: 'messages', id: 'm1', data: { businessId: 'bizTask', taskId: 't1' } });
    deniedReads.add('messages');
    const s = await deleteTaskCascade('t1');
    expect(s.chatMessages).toBe(0);
    expect(s.tasks).toBe(2);
    expect(writes[writes.length - 1]).toBe('delete tasks/t1');
  });
});

describe('deleteProjectCascade — expenses query shape', () => {
  beforeEach(() => {
    rows = [
      { col: 'projects', id: 'p1', data: { businessId: 'bizTask', name: 'P' } },
      { col: 'tasks', id: 't1', data: { businessId: 'bizTask', projectId: 'p1' } },
      { col: 'expenses', id: 'x-travel', data: { businessId: 'bizTask', projectId: 'p1', category: 'Travel' } },
      { col: 'expenses', id: 'x-nocat', data: { businessId: 'bizTask', projectId: 'p1' } },
      { col: 'expenses', id: 'x-salary', data: { businessId: 'bizTask', projectId: 'p1', category: 'Salary' } },
    ];
  });

  it('non-approver: the provable `category != Salary` list — uncategorised rows are out of reach', async () => {
    const s = await deleteProjectCascade({ id: 'p1', name: 'P' }, { businessId: 'bizTask' });
    expect(s.expensesUnlinked).toBe(1);
    expect(writes).toContain('update expenses/x-travel');
    expect(writes).not.toContain('update expenses/x-nocat');
    const q = reads.find(r => r.col === 'expenses')!;
    expect(q.wheres).toEqual(expect.arrayContaining([{ field: 'category', op: '!=', value: 'Salary' }]));
    expect(writes[writes.length - 1]).toBe('delete projects/p1');
  });

  it('approver: an unconstrained list unlinks every row, uncategorised and Salary alike', async () => {
    const s = await deleteProjectCascade({ id: 'p1', name: 'P' }, { businessId: 'bizTask', isExpenseApprover: true });
    expect(s.expensesUnlinked).toBe(3);
    expect(writes).toContain('update expenses/x-nocat');
    expect(writes).toContain('update expenses/x-salary');
    const q = reads.find(r => r.col === 'expenses')!;
    expect(q.wheres.some(w => w.field === 'category')).toBe(false);
    expect(q.wheres).toEqual(expect.arrayContaining([{ field: 'businessId', op: '==', value: 'bizTask' }]));
  });

  it('removes the tasks\' chat rows with the tasks', async () => {
    rows.push({ col: 'messages', id: 'm1', data: { businessId: 'bizTask', taskId: 't1' } });
    const s = await deleteProjectCascade({ id: 'p1', name: 'P' }, { businessId: 'bizTask' });
    expect(s.chatMessages).toBe(1);
    expect(writes).toContain('delete messages/m1');
  });
});
