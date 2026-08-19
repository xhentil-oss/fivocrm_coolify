import type { Task } from '../types';

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
  const overdue = top.filter(t => {
    if (t.status === 'Done' || !t.endDate) return false;
    const end = new Date(t.endDate as any).getTime();
    return !isNaN(end) && end < now;
  }).length;
  return { total, done, overdue, pct: total ? Math.round((done / total) * 100) : 0 };
}
