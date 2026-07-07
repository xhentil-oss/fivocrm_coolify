import type { Task } from '../types';

export function addFrequency(
  date: Date,
  frequency: string,
  dayOfWeek?: number | null,
  dayOfMonth?: number | null,
  interval = 1,
  daysOfWeek?: number[] | null,
): Date {
  const d = new Date(date);
  const step = Math.max(1, Math.round(interval));

  if (frequency === 'daily') {
    d.setDate(d.getDate() + step);
    if (daysOfWeek && daysOfWeek.length > 0) {
      let tries = 0;
      while (!daysOfWeek.includes(d.getDay()) && tries < 7) {
        d.setDate(d.getDate() + 1);
        tries++;
      }
    }
  } else if (frequency === 'weekly') {
    d.setDate(d.getDate() + 7 * step);
    if (dayOfWeek != null) {
      const diff = dayOfWeek - d.getDay();
      if (diff !== 0) d.setDate(d.getDate() + diff);
    }
  } else if (frequency === 'monthly') {
    d.setMonth(d.getMonth() + step);
    if (dayOfMonth != null) {
      const maxDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      d.setDate(Math.min(dayOfMonth, maxDay));
    }
  } else if (frequency === 'yearly') {
    d.setFullYear(d.getFullYear() + step);
  }
  return d;
}

/** Build the data for the next cycle task from a completed recurring task. */
export function buildNextRecurringTask(task: Task): Omit<Task, 'id' | 'createdAt' | 'updatedAt'> {
  const parseDate = (d: any): Date => {
    if (!d) return new Date();
    if (d instanceof Date) return d;
    if (d.toDate) return d.toDate();
    return new Date(d);
  };

  const freq = task.recurringFrequency!;
  const interval = task.recurringInterval ?? 1;
  const dow = task.recurringDayOfWeek ?? null;
  const dom = task.recurringDayOfMonth ?? null;
  const dows = task.recurringDaysOfWeek ?? null;

  const baseStart = parseDate(task.startDate);
  const baseEnd = parseDate(task.endDate);
  const baseNext = task.nextRecurringDate ? parseDate(task.nextRecurringDate) : new Date();

  let newStart = addFrequency(baseStart, freq, dow, dom, interval, dows);
  let newEnd = addFrequency(baseEnd, freq, dow, dom, interval, dows);
  let newNext = addFrequency(baseNext, freq, dow, dom, interval, dows);

  // Roll forward so the next occurrence never lands in the past — matches how
  // Asana/Todoist behave when a recurring task is completed late: the next due
  // date is always the first *future* one, not blindly (previous due + interval).
  // All three dates advance in lockstep so the span and trigger offset are kept.
  const sod = (x: Date) => { const n = new Date(x); n.setHours(0, 0, 0, 0); return n.getTime(); };
  const todayMs = sod(new Date());
  let guard = 0;
  while (sod(newStart) < todayMs && guard++ < 500) {
    newStart = addFrequency(newStart, freq, dow, dom, interval, dows);
    newEnd = addFrequency(newEnd, freq, dow, dom, interval, dows);
    newNext = addFrequency(newNext, freq, dow, dom, interval, dows);
  }

  return {
    title: task.title,
    description: task.description ?? undefined,
    status: 'Todo',
    priority: task.priority ?? undefined,
    teamId: task.teamId ?? undefined,
    projectId: task.projectId ?? undefined,
    assignedToUserId: task.assignedToUserId ?? undefined,
    startDate: newStart,
    endDate: newEnd,
    parentTaskId: task.parentTaskId ?? undefined,
    dependsOn: task.dependsOn ?? undefined,
    estimatedHours: task.estimatedHours ?? undefined,
    isRecurring: true,
    recurringFrequency: freq,
    recurringInterval: interval,
    recurringDayOfWeek: dow ?? undefined,
    recurringDaysOfWeek: dows ?? undefined,
    recurringDayOfMonth: dom ?? undefined,
    recurringEndDate: task.recurringEndDate ?? undefined,
    nextRecurringDate: newNext,
    nextCycleCreated: false,
    dueNotificationSent: false,
    collaboratorIds: task.collaboratorIds ?? undefined,
    createdByUserId: task.createdByUserId,
  };
}

/** Result of a completion attempt — lets each caller render the right toast
 *  while the actual logic (blockers, recurrence, flags) lives in one place. */
export type CompleteTaskOutcome =
  | { kind: 'blocked'; blockers: number }
  | { kind: 'completed' }
  | { kind: 'recurring-created' }
  | { kind: 'recurring-ended' }
  | { kind: 'error'; error: unknown };

export interface CompleteTaskDeps {
  createTask: (data: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>) => Promise<unknown>;
  updateTask: (id: string, data: Partial<Task>) => Promise<unknown>;
  /** All tasks in scope — used to enforce the dependency (blocker) guard. */
  allTasks?: Task[];
}

/**
 * Single source of truth for completing a task, used by every surface that can
 * mark one Done (list toggle, list quick-action, detail panel, kanban drag).
 *
 * It enforces the dependency guard, spawns the next recurring cycle ("after
 * completion" model, unless the "repeat until" date has passed), and sets
 * `nextCycleCreated` so the cron backstop never produces a duplicate. Callers
 * map the returned outcome to their own toast.
 */
export async function completeTask(task: Task, deps: CompleteTaskDeps): Promise<CompleteTaskOutcome> {
  // Dependency guard: cannot complete a task whose blockers are still open.
  if (task.dependsOn && task.dependsOn.length > 0 && deps.allTasks) {
    const openBlockers = task.dependsOn.filter(depId => {
      const dep = deps.allTasks!.find(t => t.id === depId);
      return dep && dep.status !== 'Done';
    });
    if (openBlockers.length > 0) return { kind: 'blocked', blockers: openBlockers.length };
  }

  // "After completion" recurring: on Done, immediately spawn the next cycle
  // (unless the recurrence has ended) and flag the current one so cron skips it.
  if (task.isRecurring && task.recurringFrequency && !task.nextCycleCreated) {
    try {
      const ended = recurrenceHasEnded(task);
      if (!ended) {
        await deps.createTask(buildNextRecurringTask(task) as Omit<Task, 'id' | 'createdAt' | 'updatedAt'>);
      }
      await deps.updateTask(task.id, { status: 'Done', nextCycleCreated: true });
      return ended ? { kind: 'recurring-ended' } : { kind: 'recurring-created' };
    } catch (error) {
      // Best effort: still mark it Done so the user isn't stuck.
      await deps.updateTask(task.id, { status: 'Done' });
      return { kind: 'error', error };
    }
  }

  await deps.updateTask(task.id, { status: 'Done' });
  return { kind: 'completed' };
}

/** True when the next cycle would fall after the recurrence's "repeat until" date,
 *  i.e. the series is complete and no further occurrence should be created. */
export function recurrenceHasEnded(task: Task): boolean {
  if (!task.recurringEndDate || !task.recurringFrequency) return false;
  const parse = (d: any): Date => (d && d.toDate ? d.toDate() : new Date(d));
  const sod = (x: Date) => { const n = new Date(x); n.setHours(0, 0, 0, 0); return n.getTime(); };
  const next = buildNextRecurringTask(task);
  return sod(parse(next.startDate)) > sod(parse(task.recurringEndDate));
}
