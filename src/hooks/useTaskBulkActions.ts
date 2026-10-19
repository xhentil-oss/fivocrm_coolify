import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../contexts/PermissionsContext';
import { toast } from './use-toast';
import { deleteTaskCascade } from '../lib/deleteCascade';
import { taskAssignedNotifications } from '../lib/taskNotifications';
import type { Task } from '../types';

interface UseTaskBulkActionsArgs {
  rawTasks: Task[] | undefined | null;
  viewMode: string;
  selectedTask: Task | null;
  setSelectedTask: (t: Task | null) => void;
  /** The view's single completion entry point (blockers, recurrence, notifications). */
  markTaskDone: (task: Task, opts?: { silent?: boolean }) => Promise<boolean>;
  reopenPatch: (task: Task, status: Task['status']) => Partial<Task>;
  taskMutation: { update: (id: string, data: any) => Promise<any> };
  notificationMutation: { create: (data: any) => Promise<any> };
  getUserName: (userId?: string) => string;
}

/**
 * Bulk multi-select (Asana/Monday) for the Tasks list + the ONE delete rule
 * shared by the row menu and the bulk bar — extracted verbatim from TasksView.
 */
export function useTaskBulkActions({
  rawTasks,
  viewMode,
  selectedTask,
  setSelectedTask,
  markTaskDone,
  reopenPatch,
  taskMutation,
  notificationMutation,
  getUserName,
}: UseTaskBulkActionsArgs) {
  const { user } = useAuth();
  const permissions = usePermissions();

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const toggleSelect = (id: string) => setSelectedIds(prev => { const s = new Set(prev); if (s.has(id)) s.delete(id); else s.add(id); return s; });
  const clearSelection = () => setSelectedIds(new Set());
  // A selection must never outlive its rows: a task deleted from its own menu
  // (or by a colleague) stayed counted in "N të zgjedhura" and the next bulk
  // action failed on it. Leaving the list view drops the selection too — the
  // floating bar used to hover over the board with no checkboxes in sight.
  useEffect(() => {
    setSelectedIds(prev => {
      if (prev.size === 0) return prev;
      const live = new Set((rawTasks || []).map(t => t.id));
      const next = new Set([...prev].filter(id => live.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [rawTasks]);
  useEffect(() => { setSelectedIds(new Set()); }, [viewMode]);
  const bulkUpdate = async (patch: Partial<Task>) => {
    const ids = [...selectedIds];
    if (!ids.length) return;
    const byId = new Map((rawTasks || []).map(t => [t.id, t]));
    let blocked = 0;
    const results = await Promise.allSettled(ids.map(id => {
      const t = byId.get(id);
      // Bulk "Përfunduar" is a completion — route through the shared flow so
      // blockers, recurrence and follower notifications aren't bypassed.
      if (patch.status === 'Done' && t && t.status !== 'Done') {
        return markTaskDone(t, { silent: true }).then(done => {
          if (!done) { blocked++; throw new Error('blocked'); }
        });
      }
      if (patch.status && patch.status !== 'Done' && t) {
        return taskMutation.update(id, { ...patch, ...reopenPatch(t, patch.status) });
      }
      // Bulk "Cakto te" is a reassignment like any other: the new assignee and
      // the previous one hear about it (the panel's assignTo already did; the
      // bar reassigned in silence). Notification failures never fail the update.
      if (patch.assignedToUserId && t && user?.uid && patch.assignedToUserId !== t.assignedToUserId) {
        // …and has not seen it yet: the previous "Parë" mark is cleared.
        return taskMutation.update(id, { ...patch, assigneeSeenAt: null, assigneeSeenFor: null }).then(res => {
          taskAssignedNotifications(t, patch.assignedToUserId as string, user.uid, {
            actorName: user.displayName || undefined,
            newAssigneeName: getUserName(patch.assignedToUserId as string),
          }).forEach(n => notificationMutation.create(n as any).catch(err => console.error('[Notifications] task_assigned (bulk) dërgim dështoi:', err)));
          return res;
        });
      }
      return taskMutation.update(id, patch);
    }));
    const failed = results.filter(r => r.status === 'rejected').length;
    toast(failed
      ? {
          title: `${ids.length - failed}/${ids.length} u përditësuan`,
          description: blocked ? `${blocked} të bllokuara nga varësi të pakryera` : `${failed} dështuan`,
          variant: 'destructive',
        }
      : { title: `${ids.length} detyra u përditësuan` });
    clearSelection();
  };
  // ONE delete rule for the row menu and the bulk bar: edit rights, plus manager
  // rank or owning the task (creator/assignee). The bulk bar used to delete
  // every selected row with no check at all — and no confirmation.
  const canDeleteTask = (task: Task) => permissions.canEdit && (
    permissions.isAdmin || permissions.isManager
    || task.createdByUserId === user?.uid || task.assignedToUserId === user?.uid
  );
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const bulkDeletePlan = useMemo(() => {
    if (!bulkDeleteOpen) return { allowed: [] as string[], skipped: 0 };
    const byId = new Map((rawTasks || []).map(t => [t.id, t]));
    const allowed: string[] = [];
    let skipped = 0;
    for (const id of selectedIds) {
      const t = byId.get(id);
      if (t && canDeleteTask(t)) allowed.push(id); else skipped++;
    }
    return { allowed, skipped };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bulkDeleteOpen, selectedIds, rawTasks, permissions, user]);
  const bulkDelete = () => {
    if (!selectedIds.size) return;
    setBulkDeleteOpen(true);
  };
  const confirmBulkDelete = async () => {
    const { allowed: ids, skipped } = bulkDeletePlan;
    if (!ids.length) { setBulkDeleteOpen(false); return; }
    setBulkDeleting(true);
    try {
      // Cascade per task: subtasks, comments, collaborator records, draft invoice;
      // logged hours are unlinked, never deleted (src/lib/deleteCascade.ts).
      const results = await Promise.allSettled(ids.map(id => deleteTaskCascade(id)));
      const failed = results.filter(r => r.status === 'rejected').length;
      if (selectedTask && ids.includes(selectedTask.id)) setSelectedTask(null);
      const skippedNote = skipped ? `${skipped} u anashkaluan (pa të drejtë fshirjeje)` : undefined;
      toast(failed
        ? { title: `${ids.length - failed}/${ids.length} u fshinë`, description: [`${failed} dështuan`, skippedNote].filter(Boolean).join(' · '), variant: 'destructive' }
        : { title: `${ids.length} detyra u fshinë`, description: skippedNote });
      clearSelection();
    } finally {
      setBulkDeleting(false);
      setBulkDeleteOpen(false);
    }
  };


  return {
    selectedIds,
    toggleSelect,
    clearSelection,
    bulkUpdate,
    canDeleteTask,
    bulkDeleteOpen,
    setBulkDeleteOpen,
    bulkDeleting,
    bulkDeletePlan,
    bulkDelete,
    confirmBulkDelete,
  };
}
