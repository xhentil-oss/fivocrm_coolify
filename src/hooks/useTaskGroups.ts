import { useMemo } from 'react';
import { startOfRecurrenceDay } from '../lib/recurringUtils';
import { compareTasksByDue, taskDueMs } from '../lib/taskSort';
import type { Task } from '../types';

export interface TaskGroup { key: string; label: string; sort: number; tasks: Task[]; total: number }

/**
 * ── Group by (Jira/Asana style) — purely client-side over the loaded tasks ──
 * Groups are built from the WHOLE ordered list, then the page window is applied
 * to the grouped sequence. Grouping only the current page made "Të vonuara"
 * show the overdue tasks that happened to sit in that window, and the same
 * group re-appear on page 2 with different members and a different count.
 * (Extracted verbatim from TasksView.)
 */
export function useTaskGroups(
  groupBy: 'none' | 'assignee' | 'priority' | 'project' | 'dueDate',
  orderedTasks: Task[],
  page: number,
  pageSize: number,
  getUserName: (userId?: string) => string,
  getProjectName: (projectId?: string) => string | null,
): TaskGroup[] {
  return useMemo(() => {
    if (groupBy === 'none') return [];
    const now = new Date();
    const todayMs = startOfRecurrenceDay(now);
    const PRIORITY_LABEL: Record<string, string> = { urgent: 'Urgjente', high: 'I lartë', medium: 'Mesatar', low: 'I ulët' };
    const PRIORITY_ORDER = ['urgent', 'high', 'medium', 'low'];
    const groups = new Map<string, TaskGroup>();
    const add = (key: string, label: string, sort: number, task: Task) => {
      let g = groups.get(key);
      if (!g) { g = { key, label, sort, tasks: [], total: 0 }; groups.set(key, g); }
      g.tasks.push(task);
      g.total++;
    };
    for (const task of orderedTasks) {
      if (groupBy === 'assignee') {
        const uid = task.assignedToUserId || '';
        add(uid || '__none__', uid ? getUserName(uid) : 'Pa caktuar', uid ? 0 : 1, task);
      } else if (groupBy === 'priority') {
        const p = task.priority || '';
        const idx = PRIORITY_ORDER.indexOf(p);
        add(p || '__none__', PRIORITY_LABEL[p] || 'Pa prioritet', idx < 0 ? 99 : idx, task);
      } else if (groupBy === 'project') {
        const pid = task.projectId || '';
        add(pid || '__none__', pid ? (getProjectName(pid) || 'Projekt pa emër') : 'Pa projekt', pid ? 0 : 1, task);
      } else if (groupBy === 'dueDate') {
        // `endDate || dueDate` (legacy rows), through one normaliser. A COMPLETED
        // task is its own bucket: a Done task dated last month used to fail the
        // overdue branch and fall through to "Më vonë".
        const dueMs = taskDueMs(task);
        if (task.status === 'Done') { add('e_done', 'Përfunduara', 4, task); continue; }
        if (dueMs === null) { add('z_none', 'Pa afat', 5, task); continue; }
        const dayMs = startOfRecurrenceDay(new Date(dueMs));
        const diff = Math.round((dayMs - todayMs) / 86400000);
        if (dayMs < todayMs) add('a_overdue', 'Të vonuara', 0, task);
        else if (diff === 0) add('b_today', 'Sot', 1, task);
        else if (diff > 0 && diff <= 7) add('c_week', 'Këtë javë', 2, task);
        else add('d_later', 'Më vonë', 3, task);
      }
    }
    const sorted = Array.from(groups.values()).sort((a, b) => a.sort - b.sort || a.label.localeCompare(b.label));
    // "Sipas afatit" orders INSIDE each bucket by deadline; the other groupings
    // keep the manual/createdAt order the flat list has.
    if (groupBy === 'dueDate') for (const g of sorted) g.tasks.sort(compareTasksByDue);
    // Page window over the grouped sequence; `total` keeps the real group size.
    const flat: Task[] = [];
    for (const g of sorted) flat.push(...g.tasks);
    const window = new Set(flat.slice(page * pageSize, page * pageSize + pageSize).map(t => t.id));
    return sorted
      .map(g => ({ ...g, tasks: g.tasks.filter(t => window.has(t.id)) }))
      .filter(g => g.tasks.length > 0);
  }, [groupBy, orderedTasks, page, pageSize, getUserName, getProjectName]);
}
