// Task reminders ("Më kujto") — the Asana / Salesforce model.
//
// A task carries ONE reminder, stored two ways at once:
//   `reminderAt`            — the absolute instant the person is notified (what
//                             the cron queries on; a same-field range, no index).
//   `reminderOffsetMinutes` — when the reminder was chosen RELATIVE to the
//                             deadline ("1 orë para"), how far before `endDate`.
//                             null/undefined = a custom absolute date/time.
//   `reminderSentAt`        — idempotency: written by the cron once DELIVERED —
//                             never for a reminder nobody received.
//   `reminderSkippedAt` +   — the cron CONSUMED the reminder without sending it
//   `reminderSkippedReason`   ('task-done': the task was closed before the
//                             moment came; 'no-recipient': nobody to remind).
//                             A consumed reminder does not fire late when the
//                             task is reopened inside the look-back window, and
//                             the panel never says "U dërgua" for it.
//
// The offset is what makes a moved deadline behave like Asana: postponing the
// task carries the reminder with it (recomputed from the new `endDate`) and
// re-arms it. A custom absolute reminder is left where the person put it.
//
// Delivery is `task-reminders` in api/cron/run.ts (every 5 min from the VPS),
// through notifyUser() → bell + push (app + web) + email. The block-reason
// predicate below is MIRRORED there — api/ never imports from src/.

import type { Task } from '../types';

export interface ReminderPreset {
  key: string;
  /** Minutes BEFORE the deadline. 0 = at the deadline. */
  minutes: number;
  label: string;
}

export const REMINDER_PRESETS: readonly ReminderPreset[] = [
  { key: 'at_due', minutes: 0, label: 'Në afat' },
  { key: '30m', minutes: 30, label: '30 min para' },
  { key: '1h', minutes: 60, label: '1 orë para' },
  { key: '1d', minutes: 24 * 60, label: '1 ditë para' },
];

/** How far back the cron looks for reminders it has not delivered yet (a VPS
 *  outage shorter than this loses nothing; older ones are stale, not owed). */
export const REMINDER_LOOKBACK_MS = 48 * 60 * 60 * 1000;

export type ReminderBlockReason =
  | 'no-reminder'
  | 'invalid-date'
  | 'already-sent'
  /** Consumed by the cron without a send (`reminderSkippedReason` says why). */
  | 'skipped'
  | 'task-done'
  | 'not-yet'
  /** Older than the look-back window: missed by an outage, not owed any more.
   *  The cron never even reads it; without this reason the panel showed it as
   *  pending forever. */
  | 'stale';

/** Why the cron consumed a reminder instead of sending it. */
export type ReminderSkippedReason = 'task-done' | 'no-recipient';

/** The consumed-without-send fields (not on the shared Task type yet). */
export type ReminderSkipFields = { reminderSkippedAt?: unknown; reminderSkippedReason?: ReminderSkippedReason | string | null };

/** The patch that re-ARMS a reminder: nothing delivered, nothing consumed. */
const REARMED: { reminderSentAt: null; reminderSkippedAt: null; reminderSkippedReason: null } =
  { reminderSentAt: null, reminderSkippedAt: null, reminderSkippedReason: null };

export function parseTaskDate(v: unknown): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v
    : typeof (v as any)?.toDate === 'function' ? (v as any).toDate()
    : new Date(v as any);
  return isNaN(d.getTime()) ? null : d;
}

export function reminderAtFromOffset(endDate: Date, minutesBefore: number): Date {
  return new Date(endDate.getTime() - Math.max(0, minutesBefore) * 60_000);
}

/**
 * Patch to SET a reminder from the UI. Every write goes through here so the
 * fields never disagree:
 *  · `{ offsetMinutes }` — relative preset; needs a deadline to resolve against.
 *  · `{ at }`            — custom absolute date/time.
 *  · `null`              — clear the reminder.
 * `setByUserId` is the person who asked to be reminded ("Më kujto" is THEIR
 * reminder — the cron notifies them, not the assignee). Omitted = null = the
 * legacy behaviour (the assignee is reminded). Cleared with the reminder.
 * Explicit `null`s, never `undefined`: removeUndefined() strips undefined, so
 * only null actually clears a field on the document.
 */
export function setReminderPatch(
  task: Pick<Task, 'endDate'>,
  choice: { offsetMinutes: number } | { at: Date } | null,
  setByUserId?: string | null,
): Partial<Task> {
  const cleared: Partial<Task> = { reminderAt: null, reminderOffsetMinutes: null, ...REARMED, reminderSetByUserId: null };
  if (choice === null) return cleared;
  const by = setByUserId || null;
  if ('offsetMinutes' in choice) {
    const end = parseTaskDate(task.endDate);
    if (!end) return cleared;
    return {
      reminderAt: reminderAtFromOffset(end, choice.offsetMinutes),
      reminderOffsetMinutes: choice.offsetMinutes,
      ...REARMED,
      reminderSetByUserId: by,
    };
  }
  return { reminderAt: choice.at, reminderOffsetMinutes: null, ...REARMED, reminderSetByUserId: by };
}

/**
 * Who receives a reminder: the person who set it, else the assignee, else the
 * creator. MIRRORED in api/cron/run.ts (`runTaskReminders`) — keep in sync.
 */
export function taskReminderRecipient(
  task: Pick<Task, 'reminderSetByUserId' | 'assignedToUserId' | 'createdByUserId'>,
): { userId: string; selfRequested: boolean } | null {
  if (task.reminderSetByUserId) return { userId: task.reminderSetByUserId, selfRequested: true };
  const fallback = task.assignedToUserId || task.createdByUserId;
  return fallback ? { userId: fallback, selfRequested: false } : null;
}

/**
 * What a DEADLINE change must also write. A relative reminder follows the
 * deadline and is re-armed (Asana: "remind me 1h before" means before whatever
 * the deadline is now). A custom absolute one stays put — the person picked a
 * moment, not an offset. Returns `{}` when nothing needs to change, so callers
 * can spread it unconditionally.
 */
export function reminderPatchForDeadline(
  task: Pick<Task, 'reminderAt' | 'reminderOffsetMinutes' | 'reminderSentAt'>,
  newEndDate: Date,
): Partial<Task> {
  const offset = task.reminderOffsetMinutes;
  if (offset === null || offset === undefined || !parseTaskDate(task.reminderAt)) return {};
  const at = reminderAtFromOffset(newEndDate, offset);
  const current = parseTaskDate(task.reminderAt);
  if (current && current.getTime() === at.getTime()) return {};
  return { reminderAt: at, ...REARMED };
}

/**
 * Why this task should NOT be reminded right now; null = send it.
 * MIRRORED in api/cron/run.ts (`taskReminderBlockReason`) — keep in sync.
 */
export function taskReminderBlockReason(
  task: Pick<Task, 'reminderAt' | 'reminderSentAt' | 'status'> & ReminderSkipFields,
  now: Date = new Date(),
): ReminderBlockReason | null {
  if (task.reminderAt === null || task.reminderAt === undefined) return 'no-reminder';
  const at = parseTaskDate(task.reminderAt);
  if (!at) return 'invalid-date';
  if (task.status === 'Done') return 'task-done';
  if (task.reminderSentAt) return 'already-sent';
  if (task.reminderSkippedAt) return 'skipped';
  if (at.getTime() > now.getTime()) return 'not-yet';
  if (now.getTime() - at.getTime() > REMINDER_LOOKBACK_MS) return 'stale';
  return null;
}

/** The preset that produced this reminder, if any (for highlighting the chip). */
export function activeReminderPreset(task: Pick<Task, 'reminderAt' | 'reminderOffsetMinutes'>): ReminderPreset | null {
  if (!parseTaskDate(task.reminderAt)) return null;
  const offset = task.reminderOffsetMinutes;
  if (offset === null || offset === undefined) return null;
  return REMINDER_PRESETS.find(p => p.minutes === offset) ?? null;
}

const SQ_MONTHS = ['jan', 'shk', 'mar', 'pri', 'maj', 'qer', 'kor', 'gus', 'sht', 'tet', 'nën', 'dhj'];

/** "sot 15:00" / "nesër 09:00" / "12 sht 09:00" — for chips and notifications. */
export function formatReminderMoment(at: Date, now: Date = new Date()): string {
  const hm = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  if (sameDay(at, now)) return `sot ${hm}`;
  if (sameDay(at, tomorrow)) return `nesër ${hm}`;
  return `${at.getDate()} ${SQ_MONTHS[at.getMonth()]} ${hm}`;
}

/** One-line state of the reminder for the detail panel. */
export function describeReminder(
  task: Pick<Task, 'reminderAt' | 'reminderOffsetMinutes' | 'reminderSentAt'> & ReminderSkipFields,
  now: Date = new Date(),
): string {
  const at = parseTaskDate(task.reminderAt);
  if (!at) return 'Pa kujtesë';
  const when = formatReminderMoment(at, now);
  if (task.reminderSentAt) return `U dërgua ${when}`;
  // Consumed or missed — never "pending" for a moment that will not come.
  if (task.reminderSkippedAt) {
    return task.reminderSkippedReason === 'no-recipient'
      ? `Nuk u dërgua ${when} (pa marrës)`
      : `U anulua ${when} (detyra u mbyll)`;
  }
  if (now.getTime() - at.getTime() > REMINDER_LOOKBACK_MS) return `Kaloi pa u dërguar ${when}`;
  const preset = activeReminderPreset(task);
  return preset && preset.minutes > 0 ? `${preset.label} · ${when}` : when;
}
