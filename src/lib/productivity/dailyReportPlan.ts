/**
 * The daily report's spine: the day's PLAN, answered.
 *
 * Before this, the report asked an open question ("çfarë përfundova sot") and showed
 * the day's tasks as checkboxes beside it. Anything the person did not tick simply
 * vanished — a task could sit unfinished for a week and no report ever recorded why.
 * The plan and the reality were two lists that never met.
 *
 * Here they meet: every task the day planned gets one of three answers, and the two
 * that are not "done" REQUIRE a reason. That single rule is what turns a daily report
 * from a diary into something a manager can act on — you no longer learn that work
 * slipped, you learn why it slipped, on the day it slipped.
 *
 * Pure functions over already-fetched arrays: the same code drives the form, the
 * manager view and the tests. No React, no Firestore.
 */

import type { DailyTaskOutcome, Task, TaskOutcomeState } from '../../types';

/** Local YYYY-MM-DD. Deliberately local, not UTC: "today" is the user's today. */
export function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Is this task part of today's plan?
 *
 * Lifted verbatim out of the report popup, where it was trapped inside a `useMemo`
 * and therefore untestable and unshareable. "Today" is generous on purpose — due
 * today, already overdue, in progress, started and not yet due, or created today —
 * because a report that omits an overdue task is exactly the report that hides the
 * problem.
 */
export function isTaskForToday(task: Task, now: Date): boolean {
  if (task.status === 'Done') return false;

  const todayStr = isoDay(now);
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(todayStart);
  todayEnd.setDate(todayEnd.getDate() + 1);

  const due = task.endDate || task.dueDate;
  if (due) {
    const d = due instanceof Date ? due : new Date(due);
    if (isoDay(d) === todayStr) return true;
    if (d < todayStart) return true;
  }
  if (task.startDate) {
    const s = task.startDate instanceof Date ? task.startDate : new Date(task.startDate);
    if (s <= todayEnd) {
      const due2 = task.endDate || task.dueDate;
      if (!due2 || new Date(due2) >= todayStart) return true;
    }
  }
  if (task.status === 'In Progress') return true;

  const created = task.createdAt instanceof Date ? task.createdAt : new Date(task.createdAt);
  return created >= todayStart;
}

/** Tasks this person closed today — `status: 'Done'` with `updatedAt` inside today. */
export function tasksCompletedToday(tasks: Task[], now: Date): Task[] {
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  return tasks.filter(t => {
    if (t.status !== 'Done') return false;
    const updated = t.updatedAt instanceof Date ? t.updatedAt : new Date(t.updatedAt);
    return updated >= todayStart;
  });
}

export interface BuildOutcomesOptions {
  /** projectId → customerId, so each answered task carries the client it served. */
  customerByProjectId?: Record<string, string | undefined>;
}

/**
 * The starting rows of the report: everything today planned, pre-answered where the
 * system already knows the answer.
 *
 * A task already marked Done today starts as `done` — nobody should have to re-declare
 * what the board already records. Everything else starts as `not_started`, NOT as
 * `in_progress`: an optimistic default is a lie the person has to notice and correct,
 * and most people will not.
 */
export function buildPlannedOutcomes(tasks: Task[], now: Date, opts: BuildOutcomesOptions = {}): DailyTaskOutcome[] {
  const customerOf = (t: Task) =>
    (t.projectId ? opts.customerByProjectId?.[t.projectId] : undefined) || undefined;

  const row = (t: Task, state: TaskOutcomeState): DailyTaskOutcome => ({
    taskId: t.id,
    // A snapshot, not a reference: renaming a task next month must not rewrite what
    // this report says was worked on today.
    title: t.title,
    state,
    projectId: t.projectId,
    customerId: customerOf(t),
  });

  const done = tasksCompletedToday(tasks, now).map(t => row(t, 'done'));
  const doneIds = new Set(done.map(o => o.taskId));

  const open = tasks
    .filter(t => isTaskForToday(t, now) && !doneIds.has(t.id))
    .map(t => row(t, t.status === 'In Progress' ? 'in_progress' : 'not_started'));

  return [...done, ...open];
}

/** A blank row for work that was not on the plan. */
export function unplannedOutcome(title = ''): DailyTaskOutcome {
  return { title, state: 'done', unplanned: true };
}

/**
 * Does this row still owe an explanation?
 *
 * Only unfinished PLANNED work does. Unplanned work needs no excuse — it was never
 * promised — and finished work speaks for itself.
 */
export function outcomeNeedsReason(o: DailyTaskOutcome): boolean {
  if (o.unplanned) return false;
  if (o.state === 'done') return false;
  return !(o.reason || '').trim();
}

/** Rows that block submission, in the order they appear in the form. */
export function outcomesMissingReason(outcomes: DailyTaskOutcome[]): DailyTaskOutcome[] {
  return outcomes.filter(outcomeNeedsReason);
}

/** An unplanned row with no title is an empty line the person forgot to fill in. */
export function outcomesMissingTitle(outcomes: DailyTaskOutcome[]): DailyTaskOutcome[] {
  return outcomes.filter(o => !(o.title || '').trim());
}

export interface OutcomeSummary {
  planned: number;
  done: number;
  inProgress: number;
  notStarted: number;
  unplanned: number;
  hoursLogged: number;
  /** done ÷ planned. Null when nothing was planned — never a misleading 0%. */
  completionRate: number | null;
}

export function summariseOutcomes(outcomes: DailyTaskOutcome[]): OutcomeSummary {
  const planned = outcomes.filter(o => !o.unplanned);
  const done = planned.filter(o => o.state === 'done').length;
  return {
    planned: planned.length,
    done,
    inProgress: planned.filter(o => o.state === 'in_progress').length,
    notStarted: planned.filter(o => o.state === 'not_started').length,
    unplanned: outcomes.filter(o => o.unplanned).length,
    hoursLogged: Math.round(outcomes.reduce((s, o) => s + (Number(o.hours) || 0), 0) * 10) / 10,
    completionRate: planned.length ? Math.round((done / planned.length) * 100) / 100 : null,
  };
}

/** Distinct clients served today, derived from the answered rows. */
export function customersTouched(outcomes: DailyTaskOutcome[]): string[] {
  const set = new Set<string>();
  for (const o of outcomes) if (o.customerId) set.add(o.customerId);
  return Array.from(set);
}

/** Distinct projects worked on today. */
export function projectsTouched(outcomes: DailyTaskOutcome[]): string[] {
  const set = new Set<string>();
  for (const o of outcomes) if (o.projectId) set.add(o.projectId);
  return Array.from(set);
}

/**
 * Turn the answered rows into the narrative fields the rest of the app already reads
 * (`completedToday` / `openItems`).
 *
 * Generated, but never locked: the person can rewrite it. The point is that nobody
 * types the same information twice — asking for a summary of a list the system is
 * holding is how you teach people to write "punova" and move on.
 */
export function narrativeFromOutcomes(outcomes: DailyTaskOutcome[]): { completedToday: string; openItems: string } {
  const named = outcomes.filter(o => (o.title || '').trim());

  const completed = named
    .filter(o => o.state === 'done')
    .map(o => `• ${o.title.trim()}${o.unplanned ? ' (e paplanifikuar)' : ''}`);

  const open = named
    .filter(o => o.state !== 'done')
    .map(o => {
      const label = o.state === 'in_progress' ? 'në progres' : 'nuk u prek';
      const why = (o.reason || '').trim();
      return `• ${o.title.trim()} — ${label}${why ? `: ${why}` : ''}`;
    });

  return { completedToday: completed.join('\n'), openItems: open.join('\n') };
}

/** Task ids to flip to Done / In Progress when the report is filed. */
export function taskStatusUpdates(outcomes: DailyTaskOutcome[]): Array<{ taskId: string; status: Task['status'] }> {
  const out: Array<{ taskId: string; status: Task['status'] }> = [];
  for (const o of outcomes) {
    if (!o.taskId) continue;
    if (o.state === 'done') out.push({ taskId: o.taskId, status: 'Done' });
    else if (o.state === 'in_progress') out.push({ taskId: o.taskId, status: 'In Progress' });
  }
  return out;
}

/** Strip empty rows and undefined keys — Firestore rejects `undefined`. */
export function cleanOutcomesForSave(outcomes: DailyTaskOutcome[]): DailyTaskOutcome[] {
  return outcomes
    .filter(o => (o.title || '').trim())
    .map(o => {
      const clean: DailyTaskOutcome = { title: o.title.trim(), state: o.state };
      if (o.taskId) clean.taskId = o.taskId;
      if (o.projectId) clean.projectId = o.projectId;
      if (o.customerId) clean.customerId = o.customerId;
      if (o.unplanned) clean.unplanned = true;
      if (typeof o.hours === 'number' && !isNaN(o.hours) && o.hours > 0) clean.hours = o.hours;
      const reason = (o.reason || '').trim();
      if (reason) clean.reason = reason;
      return clean;
    });
}
