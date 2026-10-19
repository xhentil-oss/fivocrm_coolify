import { describe, it, expect } from 'vitest';
import {
  REMINDER_PRESETS,
  setReminderPatch,
  reminderPatchForDeadline,
  taskReminderBlockReason,
  activeReminderPreset,
  describeReminder,
  reminderAtFromOffset,
  taskReminderRecipient,
} from './taskReminders';
import type { Task } from '../types';

const end = new Date('2026-09-10T15:00:00');
const task = (over: Partial<Task> = {}): Task => ({
  id: 't1', title: 'Thirr klientin', status: 'Todo',
  endDate: end, createdAt: end, updatedAt: end, createdByUserId: 'u1',
  ...over,
} as Task);

describe('setReminderPatch', () => {
  it('a preset resolves against the deadline and records the offset', () => {
    const p = setReminderPatch(task(), { offsetMinutes: 60 });
    expect(p.reminderAt).toEqual(new Date('2026-09-10T14:00:00'));
    expect(p.reminderOffsetMinutes).toBe(60);
    expect(p.reminderSentAt).toBeNull();
  });

  it('"Në afat" is the deadline itself', () => {
    expect(setReminderPatch(task(), { offsetMinutes: 0 }).reminderAt).toEqual(end);
  });

  it('a custom moment stores no offset', () => {
    const at = new Date('2026-09-09T09:30:00');
    const p = setReminderPatch(task(), { at });
    expect(p).toEqual({ reminderAt: at, reminderOffsetMinutes: null, reminderSentAt: null, reminderSetByUserId: null });
  });

  it('clearing writes explicit nulls (undefined would be stripped and clear nothing)', () => {
    expect(setReminderPatch(task(), null)).toEqual({ reminderAt: null, reminderOffsetMinutes: null, reminderSentAt: null, reminderSetByUserId: null });
  });

  it('records who asked for the reminder, and clears it with the reminder', () => {
    expect(setReminderPatch(task(), { offsetMinutes: 60 }, 'boss').reminderSetByUserId).toBe('boss');
    expect(setReminderPatch(task(), { at: new Date() }, 'boss').reminderSetByUserId).toBe('boss');
    expect(setReminderPatch(task(), null).reminderSetByUserId).toBeNull();
  });

  it('a preset on a task with no deadline cannot resolve — it clears instead of writing Invalid Date', () => {
    const p = setReminderPatch(task({ endDate: undefined }), { offsetMinutes: 60 });
    expect(p.reminderAt).toBeNull();
  });

  it('accepts a Firestore-Timestamp-shaped endDate', () => {
    const ts = { toDate: () => end } as any;
    expect(setReminderPatch({ endDate: ts }, { offsetMinutes: 30 }).reminderAt).toEqual(reminderAtFromOffset(end, 30));
  });
});

describe('reminderPatchForDeadline — a moved deadline carries a RELATIVE reminder with it', () => {
  it('recomputes and re-arms a preset reminder', () => {
    const t = task({ reminderAt: new Date('2026-09-10T14:00:00'), reminderOffsetMinutes: 60, reminderSentAt: new Date() });
    const p = reminderPatchForDeadline(t, new Date('2026-09-12T10:00:00'));
    expect(p).toEqual({ reminderAt: new Date('2026-09-12T09:00:00'), reminderSentAt: null });
  });

  it('leaves a custom absolute reminder where the person put it', () => {
    const t = task({ reminderAt: new Date('2026-09-09T09:30:00'), reminderOffsetMinutes: null });
    expect(reminderPatchForDeadline(t, new Date('2026-09-12T10:00:00'))).toEqual({});
  });

  it('is a no-op without a reminder, so callers can spread it blindly', () => {
    expect(reminderPatchForDeadline(task(), new Date())).toEqual({});
  });

  it('does not re-arm when the deadline change lands on the same instant', () => {
    const t = task({ reminderAt: new Date('2026-09-10T14:00:00'), reminderOffsetMinutes: 60, reminderSentAt: new Date() });
    expect(reminderPatchForDeadline(t, end)).toEqual({});
  });
});

describe('taskReminderBlockReason (mirrored in api/cron/run.ts)', () => {
  const now = new Date('2026-09-10T14:05:00');
  it('sends a due, unsent reminder on an open task', () => {
    expect(taskReminderBlockReason(task({ reminderAt: new Date('2026-09-10T14:00:00') }), now)).toBeNull();
  });
  it('names every block', () => {
    expect(taskReminderBlockReason(task(), now)).toBe('no-reminder');
    expect(taskReminderBlockReason(task({ reminderAt: null }), now)).toBe('no-reminder');
    expect(taskReminderBlockReason(task({ reminderAt: new Date('nope') }), now)).toBe('invalid-date');
    expect(taskReminderBlockReason(task({ reminderAt: new Date('2026-09-10T14:00:00'), status: 'Done' }), now)).toBe('task-done');
    expect(taskReminderBlockReason(task({ reminderAt: new Date('2026-09-10T14:00:00'), reminderSentAt: now }), now)).toBe('already-sent');
    expect(taskReminderBlockReason(task({ reminderAt: new Date('2026-09-10T14:10:00') }), now)).toBe('not-yet');
  });
  it('a reminder exactly at "now" is due (not "not-yet")', () => {
    expect(taskReminderBlockReason(task({ reminderAt: now }), now)).toBeNull();
  });
});

describe('presentation', () => {
  const now = new Date('2026-09-10T08:00:00');
  it('recognises the preset that produced the reminder', () => {
    const t = task({ reminderAt: new Date('2026-09-10T14:00:00'), reminderOffsetMinutes: 60 });
    expect(activeReminderPreset(t)?.key).toBe('1h');
    expect(activeReminderPreset(task({ reminderAt: new Date(), reminderOffsetMinutes: null }))).toBeNull();
    expect(activeReminderPreset(task({ reminderAt: new Date(), reminderOffsetMinutes: 7 }))).toBeNull();
  });
  it('describes the state in one line', () => {
    expect(describeReminder(task(), now)).toBe('Pa kujtesë');
    expect(describeReminder(task({ reminderAt: new Date('2026-09-10T14:00:00'), reminderOffsetMinutes: 60 }), now)).toBe('1 orë para · sot 14:00');
    expect(describeReminder(task({ reminderAt: new Date('2026-09-10T15:00:00'), reminderOffsetMinutes: 0 }), now)).toBe('sot 15:00');
    expect(describeReminder(task({ reminderAt: new Date('2026-09-11T09:00:00'), reminderOffsetMinutes: null }), now)).toBe('nesër 09:00');
    expect(describeReminder(task({ reminderAt: new Date('2026-09-20T09:00:00'), reminderSentAt: now }), now)).toBe('U dërgua 20 sht 09:00');
  });
  it('presets stay a short, unique list', () => {
    expect(new Set(REMINDER_PRESETS.map(p => p.minutes)).size).toBe(REMINDER_PRESETS.length);
    expect(REMINDER_PRESETS.length).toBeLessThanOrEqual(5);
  });
});

describe('taskReminderRecipient', () => {
  it('reminds the person who set it, not the assignee', () => {
    expect(taskReminderRecipient(task({ assignedToUserId: 'a', reminderSetByUserId: 'boss' })))
      .toEqual({ userId: 'boss', selfRequested: true });
  });
  it('falls back to the assignee, then the creator (legacy rows)', () => {
    expect(taskReminderRecipient(task({ assignedToUserId: 'a' }))).toEqual({ userId: 'a', selfRequested: false });
    expect(taskReminderRecipient(task({}))).toEqual({ userId: 'u1', selfRequested: false });
    expect(taskReminderRecipient(task({ createdByUserId: undefined }))).toBeNull();
  });
});
