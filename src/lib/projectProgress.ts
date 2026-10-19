import type { Task } from '../types';
import { isOverdueDate } from './taskDue';

// ── One definition of project progress ────────────────────────────────────────
//
// ProjectsView used to count EVERY task (subtasks included) while
// ProjectDetailView counted top-level tasks only, so the list card and the
// detail hero routinely showed two different percentages for the same project.
//
// The shared definition: TOP-LEVEL tasks only. A subtask is a checklist line of
// its parent — the parent's own Done/undone status is what represents that work
// at project altitude, and its progress bar already rolls the subtasks up.

export interface ProjectProgress {
  total: number;
  done: number;
  overdue: number;
  pct: number;
}

export function projectTaskProgress(
  tasks: Array<Pick<Task, 'projectId' | 'parentTaskId' | 'status' | 'endDate'>> | undefined | null,
  projectId: string,
  now: number = Date.now(),
): ProjectProgress {
  const top = (tasks || []).filter(t => (t as any).projectId === projectId && !t.parentTaskId);
  const total = top.length;
  const done = top.filter(t => t.status === 'Done').length;
  // Overdue = the deadline's Europe/Tirane DAY has passed (a task due today at
  // 12:00 is not late at 13:00) — the same rule as TasksView's "Vonuar".
  const overdue = top.filter(t => t.status !== 'Done' && isOverdueDate(t.endDate, now)).length;
  return { total, done, overdue, pct: total ? Math.round((done / total) * 100) : 0 };
}
