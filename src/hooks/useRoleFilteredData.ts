import { useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions, DataScope } from './usePermissions';
import type { Task, Project } from '../types';

// Helper: check if a value matches the current user's uid or email
// (teamMembers.userId can be stored as email instead of Firebase Auth UID)
function useUserIdentifiers(): string[] {
  const { user } = useAuth();
  return useMemo(() => {
    if (!user) return [];
    const ids = [user.uid];
    if (user.email) ids.push(user.email);
    return ids;
  }, [user]);
}

function matchesUser(value: string | null | undefined, identifiers: string[]): boolean {
  if (!value) return false;
  return identifiers.includes(value);
}

/**
 * Hook that filters tasks based on the user's data scope:
 * - 'all': Admin/Owner sees everything
 * - 'team': Manager sees all team tasks
 * - 'assigned'/'readonly': Member/Viewer sees only assigned tasks or tasks they created
 */
export function useFilteredTasks<T extends Partial<Task> & { id: string }>(
  tasks: T[] | undefined
): T[] {
  const { user } = useAuth();
  const { dataScope } = usePermissions();
  const userIds = useUserIdentifiers();

  return useMemo(() => {
    if (!tasks) return [];
    if (!user) return [];

    // Admin/Owner: see everything
    if (dataScope === 'all') return tasks;

    // Manager: see all team tasks (already filtered by teamId via useCollection)
    if (dataScope === 'team') return tasks;

    // Member/Viewer: see only tasks assigned to them, created by them, or where they're collaborators
    return tasks.filter(t => {
      if (matchesUser(t.assignedToUserId, userIds)) return true;
      if (matchesUser(t.createdByUserId, userIds)) return true;
      // Check collaboratorIds
      if (t.collaboratorIds) {
        const ids: string[] = Array.isArray(t.collaboratorIds)
          ? t.collaboratorIds
          : [];
        if (ids.some(id => userIds.includes(id))) return true;
      }
      return false;
    });
  }, [tasks, user, userIds, dataScope]);
}

/**
 * Hook that filters projects based on the user's data scope:
 * - 'all': Admin/Owner sees everything
 * - 'team': Manager sees all team projects
 * - 'assigned'/'readonly': Member/Viewer sees only projects where they have assigned tasks
 */
export function useFilteredProjects<T extends Partial<Project> & { id: string }>(
  projects: T[] | undefined,
  tasks?: (Partial<Task> & { id: string })[]
): T[] {
  const { user } = useAuth();
  const { dataScope } = usePermissions();
  const userIds = useUserIdentifiers();

  return useMemo(() => {
    if (!projects) return [];
    if (!user) return [];

    if (dataScope === 'all' || dataScope === 'team') return projects;

    // Member/Viewer: see projects they created, are a member of, or have tasks in
    const myProjectIds = new Set<string>();

    // Projects they created
    projects.forEach(p => {
      if (matchesUser(p.createdByUserId, userIds)) myProjectIds.add(p.id);
    });

    // Projects where they are explicitly listed as a member
    projects.forEach(p => {
      if (Array.isArray(p.memberUserIds) && p.memberUserIds.some(id => userIds.includes(id))) {
        myProjectIds.add(p.id);
      }
    });

    // Projects where they have assigned tasks
    if (tasks) {
      tasks.forEach(t => {
        if (!t.projectId) return;
        if (matchesUser(t.assignedToUserId, userIds) || matchesUser(t.createdByUserId, userIds)) {
          myProjectIds.add(t.projectId);
        }
        if (t.collaboratorIds) {
          const ids: string[] = Array.isArray(t.collaboratorIds)
            ? t.collaboratorIds
            : [];
          if (ids.some(id => userIds.includes(id))) {
            myProjectIds.add(t.projectId!);
          }
        }
      });
    }

    return projects.filter(p => myProjectIds.has(p.id));
  }, [projects, tasks, user, userIds, dataScope]);
}

/**
 * Generic filter for records that have a createdByUserId.
 * - 'all'/'team': see everything
 * - 'assigned'/'readonly': see only own records
 */
export function useFilteredByOwner<T extends { id: string; createdByUserId?: string | null; ownerId?: string }>(
  data: T[] | undefined
): T[] {
  const { user } = useAuth();
  const { dataScope } = usePermissions();
  const userIds = useUserIdentifiers();

  return useMemo(() => {
    if (!data) return [];
    if (!user) return [];
    if (dataScope === 'all' || dataScope === 'team') return data;
    return data.filter(d =>
      matchesUser(d.createdByUserId, userIds) || matchesUser(d.ownerId, userIds)
    );
  }, [data, user, userIds, dataScope]);
}

/**
 * Filter time entries: member/viewer sees only their own entries
 */
export function useFilteredTimeEntries<T extends { id: string; userId?: string }>(
  entries: T[] | undefined
): T[] {
  const { user } = useAuth();
  const { dataScope } = usePermissions();
  const userIds = useUserIdentifiers();

  return useMemo(() => {
    if (!entries) return [];
    if (!user) return [];
    if (dataScope === 'all' || dataScope === 'team') return entries;
    return entries.filter(e => matchesUser(e.userId, userIds));
  }, [entries, user, userIds, dataScope]);
}

/**
 * Utility: check if current user can see all data
 */
export function useScopeIsAll(): boolean {
  const { dataScope } = usePermissions();
  return dataScope === 'all' || dataScope === 'team';
}
