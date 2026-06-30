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

  const newStart = addFrequency(baseStart, freq, dow, dom, interval, dows);
  const newEnd = addFrequency(baseEnd, freq, dow, dom, interval, dows);
  const newNext = addFrequency(baseNext, freq, dow, dom, interval, dows);

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

/** True when the next cycle would fall after the recurrence's "repeat until" date,
 *  i.e. the series is complete and no further occurrence should be created. */
export function recurrenceHasEnded(task: Task): boolean {
  if (!task.recurringEndDate || !task.recurringFrequency) return false;
  const parse = (d: any): Date => (d && d.toDate ? d.toDate() : new Date(d));
  const sod = (x: Date) => { const n = new Date(x); n.setHours(0, 0, 0, 0); return n.getTime(); };
  const next = buildNextRecurringTask(task);
  return sod(parse(next.startDate)) > sod(parse(task.recurringEndDate));
}
