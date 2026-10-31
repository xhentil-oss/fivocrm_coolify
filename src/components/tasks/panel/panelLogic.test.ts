import { describe, it, expect } from 'vitest';
import {
  sanitizeTitleInput, titlePatch, isDueUrgent, duplicateTaskDraft, canDuplicateTask,
  shareOrigin, describeRecurrence, subtaskEditPatch, lastHumanEdit,
  canDriveTaskSeries, lockedStatusesFor,
} from './panelLogic';

describe('recurring series: who may drive it (rules Oct 2026)', () => {
  const t = { assignedToUserId: 'ana', createdByUserId: 'ben' };
  const staff = { isAdmin: false, isManager: false };
  it('assignee, creator, Admin/Manager — never another member', () => {
    expect(canDriveTaskSeries(t, { uid: 'ana', ...staff })).toBe(true);
    expect(canDriveTaskSeries(t, { uid: 'ben', ...staff })).toBe(true);
    expect(canDriveTaskSeries(t, { uid: 'eli', ...staff })).toBe(false);
    expect(canDriveTaskSeries(t, { uid: 'eli', isAdmin: false, isManager: true })).toBe(true);
    expect(canDriveTaskSeries(t, { uid: undefined, ...staff })).toBe(false);
  });
  it('locks Done on a live recurring tip and every re-open on a Done one; nothing otherwise', () => {
    const all = ['Todo', 'In Progress', 'Review', 'Done'];
    expect(lockedStatusesFor({ isRecurring: true, status: 'Todo' }, false, all)).toEqual(['Done']);
    expect(lockedStatusesFor({ isRecurring: true, status: 'Done' }, false, all)).toEqual(['Todo', 'In Progress', 'Review']);
    expect(lockedStatusesFor({ isRecurring: true, status: 'Todo' }, true, all)).toEqual([]);
    expect(lockedStatusesFor({ isRecurring: false, status: 'Todo' }, false, all)).toEqual([]);
  });
});
import type { Task } from '../../../types';

const now = new Date('2026-10-23T12:00:00');
const base = (o: Partial<Task> = {}): Task => ({ id: 't1', title: 'Detyra', status: 'Todo', ...o } as Task);

describe('title', () => {
  it('strips pasted line breaks', () => {
    expect(sanitizeTitleInput('Raporti\n mujor\r\nSEO')).toBe('Raporti mujor SEO');
  });
  it('writes the trimmed title only when it changed; empty reverts', () => {
    expect(titlePatch('  Detyra ', 'Detyra')).toBeNull();
    expect(titlePatch('   ', 'Detyra')).toBeNull();
    expect(titlePatch(' Detyra e re ', 'Detyra')).toEqual({ title: 'Detyra e re' });
  });
});

describe('deadline urgency (B2)', () => {
  const yesterday = new Date('2026-10-22T17:00:00');
  it('red for a live overdue/today task, never for Done', () => {
    expect(isDueUrgent(yesterday, 'Todo', now)).toBe(true);
    expect(isDueUrgent(new Date('2026-10-23T18:00:00'), 'In Progress', now)).toBe(true);
    expect(isDueUrgent(yesterday, 'Done', now)).toBe(false);
    expect(isDueUrgent(null, 'Todo', now)).toBe(false);
    expect(isDueUrgent(new Date('2026-10-30T17:00:00'), 'Todo', now)).toBe(false);
  });
});

describe('Dupliko (B3)', () => {
  it('drops past dates, keeps future ones, keeps the parent, never customerId on a subtask', () => {
    const d = duplicateTaskDraft(base({
      startDate: new Date('2026-10-01'), endDate: new Date('2026-10-10'),
      parentTaskId: 'parent', customerId: 'cust', assignedToUserId: 'u2', isRecurring: true, reminderAt: new Date(),
    } as any), now);
    expect(d.startDate).toBeUndefined();
    expect(d.endDate).toBeUndefined();
    expect(d.parentTaskId).toBe('parent');
    expect(d.customerId).toBeNull();
    expect(d.status).toBe('Todo');
    expect(d.title).toBe('Detyra (kopje)');
    expect('isRecurring' in d).toBe(false);
    expect('reminderAt' in d).toBe(false);
  });
  it('keeps a future deadline (and a past start is dropped on its own)', () => {
    const d = duplicateTaskDraft(base({ startDate: new Date('2026-10-20'), endDate: new Date('2026-11-05'), customerId: 'cust' }), now);
    expect(d.startDate).toBeUndefined();
    expect((d.endDate as Date).toISOString()).toBe(new Date('2026-11-05').toISOString());
    expect(d.customerId).toBe('cust');
  });
  it('is hidden when the copy would be assigned to someone else without canAssignTasks', () => {
    expect(canDuplicateTask({ assignedToUserId: 'u2' }, { readOnly: false, canAssignTasks: false, uid: 'me' })).toBe(false);
    expect(canDuplicateTask({ assignedToUserId: 'me' }, { readOnly: false, canAssignTasks: false, uid: 'me' })).toBe(true);
    expect(canDuplicateTask({}, { readOnly: false, canAssignTasks: false, uid: 'me' })).toBe(true);
    expect(canDuplicateTask({ assignedToUserId: 'u2' }, { readOnly: false, canAssignTasks: true, uid: 'me' })).toBe(true);
    expect(canDuplicateTask({}, { readOnly: true, canAssignTasks: true, uid: 'me' })).toBe(false);
  });
});

describe('Kopjo lidhjen origin (B4)', () => {
  it('uses the public origin on native, the window origin on the web', () => {
    expect(shareOrigin(true, 'https://localhost', 'https://fivocrm.vercel.app')).toBe('https://fivocrm.vercel.app');
    expect(shareOrigin(false, 'https://app.fivocrm.com', 'https://fivocrm.vercel.app')).toBe('https://app.fivocrm.com');
    expect(shareOrigin(false, 'capacitor://localhost', 'https://fivocrm.vercel.app/')).toBe('https://fivocrm.vercel.app');
  });
});

describe('describeRecurrence (B10)', () => {
  it('a weekly series without a weekday does not claim Diel', () => {
    expect(describeRecurrence(base({ isRecurring: true, recurringFrequency: 'weekly' }))).toBe('Çdo javë');
    expect(describeRecurrence(base({ isRecurring: true, recurringFrequency: 'weekly', recurringDayOfWeek: 0 } as any))).toBe('Çdo javë, Diel');
    expect(describeRecurrence(base({ isRecurring: true, recurringFrequency: 'weekly', recurringDayOfWeek: 1, recurringInterval: 2 } as any))).toBe('Çdo 2 javë, Hënë');
  });
  it('daily with a subset of days lists them', () => {
    expect(describeRecurrence(base({ isRecurring: true, recurringFrequency: 'daily', recurringDaysOfWeek: [1, 3] } as any))).toBe('Çdo Hën, Mër');
  });
});

describe('subtask edit (C15)', () => {
  const sub = base({ id: 's1', title: 'Nën', status: 'Todo', assignedToUserId: 'u1' });
  const form = { title: 'Nën', description: '', status: 'Todo', priority: 'medium', startDate: null, endDate: null, assignedToUserId: 'u1' };
  it('writes only the changed fields — a title edit on an undated subtask writes no dates', () => {
    expect(subtaskEditPatch(sub, { ...form, title: ' Nën e re ' })).toEqual({ title: 'Nën e re', priority: 'medium' });
    expect(subtaskEditPatch({ ...sub, priority: 'medium' }, { ...form, title: ' Nën e re ' })).toEqual({ title: 'Nën e re' });
  });
  it('a cleared date is null and a cleared assignee is null, never today / ""', () => {
    const dated = { ...sub, startDate: new Date('2026-10-01'), endDate: new Date('2026-10-10'), priority: 'medium' } as Task;
    expect(subtaskEditPatch(dated, { ...form, assignedToUserId: '' })).toEqual({ startDate: null, endDate: null, assignedToUserId: null });
  });
  it('an unchanged date is not rewritten; a moved one is', () => {
    const dated = { ...sub, endDate: new Date('2026-10-10'), priority: 'medium' } as Task;
    expect(subtaskEditPatch(dated, { ...form, endDate: new Date('2026-10-10') })).toEqual({});
    expect(subtaskEditPatch(dated, { ...form, endDate: new Date('2026-10-12') })).toEqual({ endDate: new Date('2026-10-12') });
  });
});

describe('footer "Ndryshuar" (B12)', () => {
  const createdAt = new Date('2026-10-01T09:00:00');
  it('prefers updatedByUserId, then the newest human activity', () => {
    expect(lastHumanEdit({ createdAt, updatedAt: new Date('2026-10-05'), updatedByUserId: 'u1' }, [])).toEqual({ byUserId: 'u1', at: new Date('2026-10-05') });
    const acts = [
      { createdByUserId: null, createdAt: new Date('2026-10-09') },
      { createdByUserId: 'u2', createdAt: new Date('2026-10-03') },
      { createdByUserId: 'u3', createdAt: new Date('2026-10-02') },
    ];
    expect(lastHumanEdit({ createdAt, updatedAt: new Date('2026-10-09') }, acts)).toEqual({ byUserId: 'u2', at: new Date('2026-10-03') });
  });
  it('an activity logged at creation is not an edit', () => {
    expect(lastHumanEdit({ createdAt, updatedAt: new Date('2026-10-09') }, [{ createdByUserId: 'u1', createdAt: createdAt }])).toBeNull();
  });
  it('with no signal at all keeps the legacy heuristic', () => {
    expect(lastHumanEdit({ createdAt, updatedAt: new Date('2026-10-09') }, [])).toEqual({ byUserId: null, at: new Date('2026-10-09') });
    expect(lastHumanEdit({ createdAt, updatedAt: new Date('2026-10-01T09:00:30') }, [])).toBeNull();
  });
});
