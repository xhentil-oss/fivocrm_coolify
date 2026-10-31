import { entryHours } from './finance/laborCost';
import type { TimeEntry } from '../types';

// ── Logged hours on the project page ────────────────────────────────────────
//
// `timeEntries.duration` is MINUTES (the timer and TimeLogDialog write
// `Math.floor(ms / 60000)`). ProjectDetailView summed it as if it were seconds
// (`duration / 60` → "minutes"), so a 120-minute row showed "2m" and every row
// with a duration counted 60× too small — while rows without one used the
// real span. Two units in one total, and a figure Financat (`laborForEntries`)
// disagreed with. The ONE hours definition is `entryHours` (span for timer /
// pomodoro rows, typed duration for manual / daily-report rows); this is a
// thin rollup over it, so the project page and the finance engine agree.

export interface ProjectHoursRollup {
  totalHours: number;
  /** Hours per `taskId` (rows with no task are in `totalHours` only). */
  hoursByTask: Map<string, number>;
}

export function projectHoursRollup(
  entries: ReadonlyArray<Pick<TimeEntry, 'taskId' | 'duration' | 'startTime' | 'endTime' | 'source'>> | null | undefined,
): ProjectHoursRollup {
  const hoursByTask = new Map<string, number>();
  let totalHours = 0;
  for (const e of entries || []) {
    const h = entryHours(e);
    if (h <= 0) continue;
    totalHours += h;
    if (e.taskId) hoursByTask.set(e.taskId, (hoursByTask.get(e.taskId) || 0) + h);
  }
  return { totalHours, hoursByTask };
}

/** "45m" under an hour, "2.5h" from one hour up — the list column format. */
export function formatHoursCompact(hours: number): string {
  if (!(hours > 0)) return '0m';
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  return `${hours.toFixed(1)}h`;
}
