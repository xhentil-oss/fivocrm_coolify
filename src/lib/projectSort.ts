import type { Project, Task } from '../types';
import { taskDateMs, taskDueMs } from './taskSort';

// ── Projects ordered by what is due next ──────────────────────────────────────
//
// A project's deadline is the EARLIEST deadline among its unfinished tasks
// (overdue ones included — they are the most urgent), falling back to the
// project's own `endDate` while it is still open. Projects with nothing dated
// go last and keep their incoming order (the list's `updatedAt desc`).

const CLOSED_PROJECT = new Set(['Completed', 'Cancelled', 'Archived']);

export function projectNextDeadlines(
  projects: Array<Pick<Project, 'id' | 'status' | 'endDate'>>,
  tasks: Array<Pick<Task, 'projectId' | 'status' | 'endDate' | 'dueDate'>> | undefined | null,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const t of tasks || []) {
    const pid = (t as any).projectId as string | undefined;
    if (!pid || t.status === 'Done') continue;
    const due = taskDueMs(t);
    if (due === null) continue;
    const cur = out.get(pid);
    if (cur === undefined || due < cur) out.set(pid, due);
  }
  for (const p of projects) {
    if (out.has(p.id) || CLOSED_PROJECT.has(p.status as string)) continue;
    const end = taskDateMs(p.endDate);
    if (end !== null) out.set(p.id, end);
  }
  return out;
}

/** Earliest deadline first; undated last, stable on ties. */
export function sortProjectsByDeadline<T extends Pick<Project, 'id'>>(arr: T[], deadlines: Map<string, number>): T[] {
  return [...arr].sort((a, b) => {
    const da = deadlines.get(a.id), db = deadlines.get(b.id);
    if (da === undefined && db === undefined) return 0;
    if (da === undefined) return 1;
    if (db === undefined) return -1;
    return da - db;
  });
}
