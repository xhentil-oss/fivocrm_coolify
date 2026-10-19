import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { type DragStartEvent, type DragEndEvent } from '@dnd-kit/core';
import { completeTask, hasLiveSeriesSibling, startOfRecurrenceDay } from '../lib/recurringUtils';
import { claimTaskNextCycle, releaseTaskNextCycle } from '../lib/taskRecurrenceClaim';
import { useCollection, useMutation, useGlobalBusinessId } from '../hooks/useFirestore';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../contexts/PermissionsContext';
import { useActivityLogger } from '../hooks/useActivityLogger';
import { useFilteredTasks, useUniqueTeamMembers } from '../hooks/useRoleFilteredData';
import { useStableCallback } from '../hooks/useStableCallback';
import { useTaskListOrder } from '../hooks/useTaskListOrder';
import { useTaskGroups } from '../hooks/useTaskGroups';
import { useTaskBulkActions } from '../hooks/useTaskBulkActions';
import { useCreateTask } from '../hooks/useCreateTask';
import { useTaskCommentHandlers } from '../hooks/useTaskCommentHandlers';
import { toast } from '../hooks/use-toast';
import type { Task, TaskComment, Project, Notification, TaskCollaborator, UserProfile, TimeEntry, Customer, Invoice } from '../types';
import TaskDetailPanel from '../components/TaskDetailPanel';
import QuickTaskForm from '../components/QuickTaskForm';
import TaskDateConflictDialog from '../components/TaskDateConflictDialog';
import { reminderPatchForDeadline } from '../lib/taskReminders';
import { deleteTaskCascade } from '../lib/deleteCascade';
import { taskCompletedNotifications } from '../lib/taskNotifications';
import SmartSuggestions from '../components/SmartSuggestions';
import TaskTimeline from '../components/TaskTimeline';
import TaskRow from '../components/tasks/TaskRow';
import TaskListView, { TaskListSkeleton } from '../components/tasks/TaskListView';
import TaskBoardView from '../components/tasks/TaskBoardView';
import TaskCalendarView from '../components/tasks/TaskCalendarView';
import TaskPaginationBar from '../components/tasks/TaskPaginationBar';
import TaskBulkBar from '../components/tasks/TaskBulkBar';
import TaskListHeader, { type TaskViewMode } from '../components/tasks/TaskListHeader';
import TaskFilters, { type TaskGroupBy } from '../components/tasks/TaskFilters';
import { TaskDeleteConfirmDialog, TaskBulkDeleteDialog } from '../components/tasks/TaskDeleteDialogs';
import { useTaskDragSensors } from '../components/tasks/taskDnd';
import { TASKS_PAGE_SIZE as PAGE_SIZE, TASK_BOARD_COLUMNS as columns, isOverdueDate } from '../components/tasks/taskListUtils';

const TasksView: React.FC = () => {
  const { user } = useAuth();
  // Rows are memoized, so "Sot/Nesër/vonuar" labels would freeze across
  // midnight on a page left open: remount the list once per Tirane day.
  const [todayKey, setTodayKey] = useState(() => startOfRecurrenceDay(new Date()));
  useEffect(() => {
    const id = window.setInterval(() => {
      const k = startOfRecurrenceDay(new Date());
      setTodayKey(prev => (prev === k ? prev : k));
    }, 60_000);
    return () => window.clearInterval(id);
  }, []);
  const permissions = usePermissions();
  const logActivity = useActivityLogger();
  // Persisted view preferences (Asana-style: the view/filter you left is remembered).
  const [viewMode, setViewMode] = useState<TaskViewMode>(() => (localStorage.getItem('tasks_viewMode') as any) || 'list');
  const [filterStatus, setFilterStatus] = useState<string>(() => localStorage.getItem('tasks_filterStatus') || 'all');
  // Filter by assignee (a teamMember userId, 'all', or 'unassigned'). Applies to
  // every view — list, board, calendar and timeline — so e.g. picking Elton shows
  // exactly what Elton has to do, including on the calendar.
  const [filterAssignee, setFilterAssignee] = useState<string>(() => localStorage.getItem('tasks_filterAssignee') || 'all');
  const [groupBy, setGroupBy] = useState<TaskGroupBy>(() => (localStorage.getItem('tasks_groupBy') as any) || 'none');
  // Label filter ('all' = off) — `allLabels` powered an autocomplete but no
  // filter existed anywhere, despite its own comment claiming one.
  const [filterLabel, setFilterLabel] = useState<string>(() => localStorage.getItem('tasks_filterLabel') || 'all');
  useEffect(() => { localStorage.setItem('tasks_filterLabel', filterLabel); }, [filterLabel]);
  useEffect(() => {
    localStorage.setItem('tasks_viewMode', viewMode);
    localStorage.setItem('tasks_filterStatus', filterStatus);
    localStorage.setItem('tasks_filterAssignee', filterAssignee);
    localStorage.setItem('tasks_groupBy', groupBy);
  }, [viewMode, filterStatus, filterAssignee, groupBy]);
  const [page, setPage] = useState(0);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  // Comment to scroll to inside the panel — set only when a notification deep-links
  // here. Tagged with its task so it never leaks onto another task you open next.
  const [focusComment, setFocusComment] = useState<{ taskId: string; commentId: string } | null>(null);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [panelExpanded, setPanelExpanded] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const businessId = useGlobalBusinessId();
  const [searchParams, setSearchParams] = useSearchParams();

  // Fetch data — skipTeamFilter to avoid dependency on globalTeamId timing.
  // Team filtering is handled client-side below using permissions.teamId.
  const { data: rawTasks, loading: tasksLoading } = useCollection<Task>('tasks', {
    orderBy: { field: 'createdAt', direction: 'desc' },
    skipTeamFilter: true,
  });
  // Workspace-wide tasks (Asana/Monday-style): tasks are already scoped to the
  // active business server-side (businessIsolatedAlways), so all departments/teams
  // in the business share them — no extra per-team filter. Role-based filtering
  // still narrows Member/Viewer to their assigned tasks.
  const allTasks = useFilteredTasks(rawTasks || []);
  // All labels used across the workspace — powers the label autocomplete + filter.
  const allLabels = useMemo(() => {
    const s = new Set<string>();
    (allTasks || []).forEach(t => ((t as any).labels as string[] | undefined)?.forEach(l => s.add(l)));
    return Array.from(s).sort();
  }, [allTasks]);
  const { data: projects, loading: projectsLoading } = useCollection<Project>('projects');
  const { data: customers } = useCollection<Customer>('customers');
  const { data: invoices } = useCollection<Invoice>('invoices');
  const { data: comments } = useCollection<TaskComment>('taskComments');
  // (No full `taskCollaborators` listener here — it was a live subscription over
  // an entire collection whose data was never read.)
  const { data: userProfiles } = useCollection<UserProfile>('userProfiles');
  const { data: teamMembers } = useCollection<any>('teamMembers', {
    where: [{ field: 'status', operator: '==', value: 'Active' }],
    skipTeamFilter: true,
  });
  // One record per (user, team) — dedupe by userId for any assignee selector so a
  // person who belongs to several teams isn't listed (or rendered) multiple times.
  const uniqueTeamMembers = useUniqueTeamMembers(teamMembers);

  // Get all active time entries to show who's working on what
  const { data: activeTimeEntries } = useCollection<TimeEntry>('timeEntries', {
    where: [{ field: 'endTime', operator: '==', value: null }]
  });

  // Get tasks that are currently being worked on
  const tasksBeingWorkedOn = React.useMemo(() => {
    if (!activeTimeEntries) return new Set<string>();
    return new Set(activeTimeEntries.map(entry => entry.taskId).filter(Boolean));
  }, [activeTimeEntries]);

  // Lookup maps for userId → display name. FIRST match wins, exactly like the
  // `.find()` calls they replace (a row render used to scan both arrays per row).
  const profileByUserId = useMemo(() => {
    const map = new Map<string, UserProfile>();
    for (const p of userProfiles || []) {
      if (p.userId && !map.has(p.userId)) map.set(p.userId, p);
      if (p.id && !map.has(p.id)) map.set(p.id, p);
    }
    return map;
  }, [userProfiles]);
  const memberByUserId = useMemo(() => {
    const map = new Map<string, any>();
    for (const m of teamMembers || []) if (m.userId && !map.has(m.userId)) map.set(m.userId, m);
    return map;
  }, [teamMembers]);

  // Helper: resolve userId to display name
  const getUserName = React.useCallback((userId?: string) => {
    if (!userId) return 'Pa caktuar';
    if (userId === user?.uid) return user?.displayName || 'Ti';
    const profile = profileByUserId.get(userId);
    if (profile?.displayName) return profile.displayName;
    const member = memberByUserId.get(userId);
    if (member?.displayName) return member.displayName;
    if (member?.email) return member.email.split('@')[0];
    return userId.includes('@') ? userId.split('@')[0] : userId.slice(0, 8);
  }, [user, profileByUserId, memberByUserId]);

  // Helper: get subtask counts per task
  const subtaskCounts = useMemo(() => {
    if (!allTasks) return {};
    const counts: Record<string, { total: number; done: number }> = {};
    for (const t of allTasks) {
      if (t.parentTaskId) {
        if (!counts[t.parentTaskId]) counts[t.parentTaskId] = { total: 0, done: 0 };
        counts[t.parentTaskId].total++;
        if (t.status === 'Done') counts[t.parentTaskId].done++;
      }
    }
    return counts;
  }, [allTasks]);

  // Compute which tasks are blocked (have unfinished dependsOn).
  // The blocker lookup uses the UNFILTERED workspace list: for Member/Viewer the
  // role filter hides a colleague's blocker, which would make the blocked task
  // look free (no 🔒) even though completing it is refused by the guard.
  const blockedTaskIds = useMemo(() => {
    if (!allTasks) return new Set<string>();
    const blocked = new Set<string>();
    const taskMap = new Map((rawTasks || allTasks).map(t => [t.id, t]));
    for (const t of allTasks) {
      if (t.dependsOn?.length && t.status !== 'Done') {
        const hasUnfinished = t.dependsOn.some(depId => {
          const dep = taskMap.get(depId);
          return dep && dep.status !== 'Done';
        });
        if (hasUnfinished) blocked.add(t.id);
      }
    }
    return blocked;
  }, [allTasks, rawTasks]);

  // Helper: get project name (first match by id, like the `.find()` it replaces)
  const projectNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of projects || []) if (!map.has(p.id)) map.set(p.id, p.name);
    return map;
  }, [projects]);
  const getProjectName = React.useCallback((projectId?: string) => {
    if (!projectId || !projects) return null;
    return projectNameById.get(projectId) || null;
  }, [projects, projectNameById]);

  // Mutations
  const taskMutation = useMutation<Task>('tasks');
  const notificationMutation = useMutation<Notification>('notifications');
  const collaboratorMutation = useMutation<TaskCollaborator>('taskCollaborators');

  // Filter tasks - exclude subtasks from main list
  // Base list: parentTasks + searchQuery (used for stats AND for filtered display)
  const baseTasksForStats = React.useMemo(() => {
    if (!allTasks) return [];
    let filtered = allTasks.filter(t => !t.parentTaskId);
    // Assignee filter applies before stats so the status counts (and every view)
    // reflect the selected person — picking Elton shows Elton's tasks broken down
    // by status, on the list, board, calendar and timeline alike.
    if (filterAssignee !== 'all') {
      filtered = filterAssignee === 'unassigned'
        ? filtered.filter(t => !t.assignedToUserId)
        : filtered.filter(t => t.assignedToUserId === filterAssignee);
    }
    if (filterLabel !== 'all') {
      filtered = filtered.filter(t => ((t as any).labels as string[] | undefined)?.includes(filterLabel));
    }
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      // Search matches labels and the project name too, not just title/description.
      filtered = filtered.filter(t =>
        t.title.toLowerCase().includes(query) ||
        t.description?.toLowerCase().includes(query) ||
        ((t as any).labels as string[] | undefined)?.some(l => l.toLowerCase().includes(query)) ||
        (getProjectName(t.projectId) || '').toLowerCase().includes(query)
      );
    }
    return filtered;
  }, [allTasks, searchQuery, filterAssignee, filterLabel, getProjectName]);

  // Final tasks list: additionally filtered by status for the displayed list.
  // 'overdue' is a computed pseudo-status (past due date and not yet Done).
  const tasks = React.useMemo(() => {
    if (filterStatus === 'all') return baseTasksForStats;
    if (filterStatus === 'overdue') {
      return baseTasksForStats.filter(t => isOverdueDate(t.endDate) && t.status !== 'Done');
    }
    return baseTasksForStats.filter(t => t.status === filterStatus);
  }, [baseTasksForStats, filterStatus]);

  // Assignee filter options — team members of the active business, labelled by
  // display name (falling back to the email local-part), sorted alphabetically.
  const assigneeOptions = React.useMemo(() => {
    return (teamMembers || [])
      .filter((m: any) => m.userId && (!businessId || !m.businessId || m.businessId === businessId))
      .map((m: any) => ({
        userId: m.userId as string,
        label: m.displayName || (m.email ? m.email.split('@')[0] : m.userId),
        email: m.email || '',
      }))
      .filter((m: any, i: number, arr: any[]) => arr.findIndex(x => x.userId === m.userId) === i)
      .sort((a: any, b: any) => a.label.localeCompare(b.label));
  }, [teamMembers, businessId]);

  const myTasks = React.useMemo(() => {
    if (!user || !allTasks) return [];
    // uid AND email: legacy teamMembers rows keyed by email leaked email values
    // into assignedToUserId (useRoleFilteredData matches both for the same
    // reason) — uid-only made "Detyrat e mia" empty for those members.
    const myIds = new Set([user.uid, user.email].filter(Boolean) as string[]);
    return allTasks.filter(t => !!t.assignedToUserId && myIds.has(t.assignedToUserId) && !t.parentTaskId);
  }, [allTasks, user]);

  // Task stats always computed from baseTasksForStats (NOT filtered by status)
  // so filter buttons always show correct totals regardless of active filter
  const taskStats = useMemo(() => {
    if (!baseTasksForStats.length && !allTasks?.length) return { todo: 0, inProgress: 0, review: 0, done: 0, overdue: 0 };
    return {
      todo: baseTasksForStats.filter(t => t.status === 'Todo').length,
      inProgress: baseTasksForStats.filter(t => t.status === 'In Progress').length,
      review: baseTasksForStats.filter(t => t.status === 'Review').length,
      done: baseTasksForStats.filter(t => t.status === 'Done').length,
      overdue: baseTasksForStats.filter(t => isOverdueDate(t.endDate) && t.status !== 'Done').length,
    };
  }, [baseTasksForStats, allTasks]);

  // Open task from URL param (Dashboard link, or a comment notification which also
  // carries `comment=<id>` so the panel can scroll straight to that comment).
  // `task` is the legacy param name still present in older notifications.
  useEffect(() => {
    const taskIdParam = searchParams.get('taskId') || searchParams.get('task');
    if (!taskIdParam) return;
    // Fall back to the unfiltered list: a task you were @mentioned on may be
    // filtered out of `allTasks` by the role filter, and the link must still open.
    const taskToSelect = (allTasks || []).find(t => t.id === taskIdParam)
      || (rawTasks || []).find(t => t.id === taskIdParam);
    if (!taskToSelect) return;
    setSelectedTask(taskToSelect);
    const commentParam = searchParams.get('comment');
    setFocusComment(commentParam ? { taskId: taskToSelect.id, commentId: commentParam } : null);
    // Clean up the URL params after selecting
    setSearchParams({}, { replace: true });
  }, [searchParams, allTasks, rawTasks, setSearchParams]);

  // `?new=1` (Command palette "Krijo Detyrë të Re") opens the create form, then
  // drops ONLY that param. Waits for the permission bootstrap: the form exists
  // only for `canEdit`, and a read-only role just lands on the list.
  useEffect(() => {
    if (searchParams.get('new') !== '1') return;
    if (permissions.isLoading) return;
    if (permissions.canEdit) setIsCreateDialogOpen(true);
    const next = new URLSearchParams(searchParams);
    next.delete('new');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, permissions.isLoading, permissions.canEdit]);

  // Keep selectedTask in sync with live Firestore data. From the RAW list: a
  // task opened by deep link outside the role filter (rawTasks fallback) never
  // re-synced from the filtered one, so the panel showed pre-edit values.
  useEffect(() => {
    if (selectedTask && rawTasks) {
      const updated = rawTasks.find(t => t.id === selectedTask.id);
      if (updated && JSON.stringify(updated) !== JSON.stringify(selectedTask)) {
        setSelectedTask(updated);
      }
    }
  }, [rawTasks, selectedTask]);

  // "Detyrë e Re" submission (same-day check, recurrence seed, valued-task
  // invoice, collaborators, notifications) — src/hooks/useCreateTask.ts.
  const { handleCreateTask, handleConfirmDateConflict, dateConflict, setDateConflict } = useCreateTask({
    rawTasks,
    projects,
    getUserName,
    taskMutation,
    collaboratorMutation,
    notificationMutation,
    onCreated: (newTask, options) => {
      // "Krijo & shto tjetër" keeps the dialog open for the next entry — the form
      // resets itself and shows its own confirmation, so don't steal focus either.
      if (!options?.createAnother) {
        setIsCreateDialogOpen(false);
        setSelectedTask(newTask);
      }
    },
  });

  // Comment callbacks for the panel (src/hooks/useTaskCommentHandlers.ts).
  const { handleAddComment, handleEditComment, handleDeleteComment, handleToggleReaction } = useTaskCommentHandlers(rawTasks, comments);

  // --- @dnd-kit drag-and-drop for list + kanban ---
  const sensors = useTaskDragSensors();
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);

  const handleDragStart = (event: DragStartEvent) => {
    setActiveTaskId(String(event.active.id));
  };

  // Manual (drag) order: shared team order for writers, personal for the rest.
  const { sortByOrder, applyReorder } = useTaskListOrder(allTasks, rawTasks);

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveTaskId(null);
    // Read-only roles: dragging must not write (reorder is team-shared state,
    // and a board drop is a status mutation).
    if (!permissions.canEdit) return;
    const { active, over } = event;
    if (!over) return;
    const taskId = String(active.id);
    const overId = String(over.id);

    if (viewMode === 'list') {
      if (taskId !== overId) void applyReorder(taskId, overId);
      return;
    }

    // Board: dropped either over a column (empty area) or over another card.
    const overTask = tasks.find(t => t.id === overId);
    const targetStatus = overTask?.status
      || columns.find(c => c.status === overId)?.status;
    if (!targetStatus) return;

    // Persist manual order within the column when dropped over a specific card,
    // so cards keep their position instead of jumping to the end.
    if (overTask && taskId !== overId) void applyReorder(taskId, overId);

    const task = tasks.find(t => t.id === taskId);
    if (task && task.status !== targetStatus) {
      if (targetStatus === 'Done') {
        // Dropping a card into "Përfunduar" IS a completion — it must run the
        // blocker guard and spawn the next recurring cycle, not just flip the
        // status (a raw status write silently killed recurring series).
        await markTaskDone(task);
      } else {
        await taskMutation.update(taskId, reopenPatch(task, targetStatus as Task['status']));
      }
    }
  };

  // Closing a task by someone else was a silent mutation — creator, assignee and
  // collaborators (minus the actor) now hear about it, from EVERY completion
  // surface (checkbox, quick-action, kanban drag; the detail panel notifies itself).
  const notifyTaskClosed = (task: Task) => {
    if (!user?.uid) return;
    taskCompletedNotifications(task, user.uid, user.displayName || undefined).forEach(n =>
      notificationMutation.create(n as any).catch(err => console.error('[Notifications] task_completed dërgim dështoi:', err)));
  };

  // Single completion entry point for this view: every surface that can close a
  // task (checkbox, quick-action, kanban drag, bulk bar) must go through here so
  // the blocker guard, the recurring next-cycle spawn and follower notifications
  // can never be skipped. Returns true when the task actually closed.
  const markTaskDone = React.useCallback(async (task: Task, opts?: { silent?: boolean }) => {
    const outcome = await completeTask(task, {
      createTask: (data) => taskMutation.create(data as any),
      updateTask: (id, data) => taskMutation.update(id, data),
      // The blocker guard must see the FULL workspace (rawTasks): the role
      // filter narrows Member/Viewer to their own tasks, so a blocker assigned
      // to a colleague would look "missing" — i.e. closed — to the guard.
      allTasks: rawTasks || [],
      // An archived/cancelled project stops the series (no next cycle).
      projects: projects || [],
      claimNextCycle: claimTaskNextCycle,
      releaseNextCycle: releaseTaskNextCycle,
    });
    if (outcome.kind === 'blocked') {
      toast({ title: '⛔ Detyrë e Bllokuar', description: `Ka ${outcome.blockers} varësi të pakryera para se ta mbyllësh këtë.`, variant: 'destructive' });
      return false;
    }
    notifyTaskClosed(task);
    if (!opts?.silent) {
      if (outcome.kind === 'recurring-created') {
        toast({ title: '✅ Detyrë e kryer + cikli i ri!', description: `"${task.title}" u rigjenerua automatikisht.` });
      } else if (outcome.kind === 'recurring-ended') {
        toast({ title: '✅ Detyrë e kryer', description: 'Cikli i fundit i përsëritjes — nuk u krijua tjetër.' });
      } else if (outcome.kind === 'recurring-stopped') {
        toast({ title: '✅ Detyrë e kryer', description: outcome.reason === 'project-archived' ? 'Projekti është i arkivuar — përsëritja ndalon derisa të kthehet nga Arkiva.' : 'Projekti është anuluar — nuk u krijua cikël tjetër.' });
      } else {
        toast({ title: 'Statusi u ndryshua ✓', description: `"${task.title}" → Përfunduar` });
      }
    }
    logActivity('task_completed', `Detyrë e përfunduar: ${task.title}`, { entityType: 'task', entityId: task.id });
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawTasks, projects, taskMutation, user]);

  // Re-opening a Done task: a recurring tip gets its spawn flag back ONLY when
  // the series has no live occurrence left (child deleted by mistake → revive).
  // Re-arming while the child is alive would double the series on re-complete.
  // `completedAt: null` (explicit — removeUndefined would strip undefined): an
  // open task must not keep counting as "completed today" via taskCompletedMs().
  const reopenPatch = (task: Task, status: Task['status']): Partial<Task> =>
    task.status === 'Done' && task.isRecurring && !hasLiveSeriesSibling(task, rawTasks)
      ? { status, nextCycleCreated: false, completedAt: null }
      : { status, completedAt: null };

  // Apply saved manual order for the list view
  const orderedTasks = useMemo(() => sortByOrder(tasks), [tasks, sortByOrder]);

  // Board columns, memoized — filtering + sorting inline per column re-ran on
  // every render for all four columns.
  const boardColumns = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const c of ['Todo', 'In Progress', 'Review', 'Done']) {
      map.set(c, sortByOrder(tasks.filter(t => t.status === c)));
    }
    return map;
  }, [tasks, sortByOrder]);

  // Comment counts per task, in one pass — `comments.filter(...)` inside every
  // row render was O(rows × all comments) per render.
  const commentCountByTask = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of comments || []) {
      if (c.taskId) map.set(c.taskId, (map.get(c.taskId) || 0) + 1);
    }
    return map;
  }, [comments]);

  // Page-based pagination (50 per page) — applies to both flat and grouped views.
  const totalPages = Math.max(1, Math.ceil(orderedTasks.length / PAGE_SIZE));
  // Reset to first page whenever the underlying set changes.
  React.useEffect(() => { setPage(0); }, [filterStatus, filterAssignee, filterLabel, searchQuery, groupBy]);
  // Clamp if the current page falls out of range (e.g. after deletions).
  React.useEffect(() => { if (page > totalPages - 1) setPage(totalPages - 1); }, [page, totalPages]);
  const visibleTasks = useMemo(
    () => orderedTasks.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE),
    [orderedTasks, page]
  );

  // Groups over the WHOLE ordered list, then the page window (useTaskGroups).
  const taskGroups = useTaskGroups(groupBy, orderedTasks, page, PAGE_SIZE, getUserName, getProjectName);

  // Bulk multi-select (Asana/Monday) — list view — and the ONE delete rule for
  // the row menu and the bulk bar (src/hooks/useTaskBulkActions.ts).
  const {
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
  } = useTaskBulkActions({
    rawTasks,
    viewMode,
    selectedTask,
    setSelectedTask,
    markTaskDone,
    reopenPatch,
    taskMutation,
    notificationMutation,
    getUserName,
  });
  const confirmSingleDelete = async () => {
    if (deleteConfirmId) {
      try {
        const s = await deleteTaskCascade(deleteConfirmId);
        if (selectedTask?.id === deleteConfirmId) setSelectedTask(null);
        const extra = s.tasks > 1 ? ` (${s.tasks - 1} nën-detyra u fshinë bashkë)` : '';
        toast({ title: `Detyra u fshi${extra}`, description: s.failed ? `${s.failed} veprime lidhëse dështuan` : undefined });
      } catch (err: any) {
        console.error('[Tasks] fshirja dështoi:', err);
        toast({ title: 'Detyra nuk u fshi', description: err?.message, variant: 'destructive' });
      }
    }
    setDeleteConfirmId(null);
  };

  // ── Row/card handlers ──
  // STABLE identities (useStableCallback) so the memoized TaskRow / board card
  // re-renders only when its own data changes, while every handler still runs
  // against the current render's state.
  const onRowSelect = useStableCallback((task: Task) => setSelectedTask(task));
  const onRowToggleChecked = useStableCallback((id: string) => toggleSelect(id));
  const onRowToggleDone = useStableCallback(async (task: Task) => {
    const checked = task.status !== 'Done';
    if (!checked) {
      // Un-completing — flip back to Todo (and re-arm a recurring tip).
      await taskMutation.update(task.id, reopenPatch(task, 'Todo'));
      toast({ title: 'Statusi u ndryshua ✓', description: `"${task.title}" → Për të bërë` });
      return;
    }
    await markTaskDone(task);
  });
  const onRowMarkDone = useStableCallback((task: Task) => markTaskDone(task));
  const onRowSetPriority = useStableCallback((task: Task, priority: NonNullable<Task['priority']>) => {
    void taskMutation.update(task.id, { priority });
  });
  const onRowReschedule = useStableCallback(async (task: Task, d: Date) => {
    const nd = new Date(d);
    const cur = task.endDate ? new Date(task.endDate) : null;
    nd.setHours(cur?.getHours() ?? 9, cur?.getMinutes() ?? 0, 0, 0);
    // A moved deadline re-arms the due/overdue alerts (the cron
    // skips flagged tasks, so a postponed task never alerted again)
    // and carries a relative "Më kujto" reminder with it.
    await taskMutation.update(task.id, { endDate: nd, dueNotificationSent: false, overdueNotificationSent: false, ...reminderPatchForDeadline(task, nd) });
  });
  const onRowCopy = useStableCallback(async (task: Task) => {
    // Strip everything a copy must NOT inherit: recurrence & its
    // bookkeeping (nextCycleCreated!), the billing idempotency flag
    // (a copy's value was never invoiced/applied), collaborator ids
    // (their taskCollaborators rows belong to the original),
    // notification flags, and the reminder — a copied "1 orë para"
    // made the cron fire two identical reminders (and its owner,
    // reminderSetByUserId, goes with it). The work-cycle carry-over
    // stamps and the completion instant describe the ORIGINAL's
    // history — a fresh copy was never carried and is not done.
    const { id, isRecurring, recurringFrequency, recurringInterval, recurringDayOfWeek, recurringDayOfMonth, recurringDaysOfWeek, recurringEndDate, nextRecurringDate, nextCycleCreated, seriesId, recurringSkippedReason, dueNotificationSent, overdueNotificationSent, reminderAt, reminderOffsetMinutes, reminderSentAt, reminderSetByUserId, carriedOverFromPeriod, carriedOverCount, completedAt, parentTaskId, dependsOn, attachments, value, valueAppliedToBudget, collaboratorIds, createdByUserId, seriesCreatedByUserId, cycleAnchorStartDay, cycleAnchorEndDay, clientApproval, clientApprovalHistory, assigneeSeenAt, assigneeSeenFor, ...rest } = task as any;
    // The copy is MINE (rules: created as yourself), and without the
    // assign right it can only be assigned to me — the rules refuse
    // handing a colleague work through a copy.
    if (!permissions.canAssignTasks && rest.assignedToUserId && rest.assignedToUserId !== user?.uid) {
      rest.assignedToUserId = user?.uid ?? null;
    }
    await taskMutation.create({ ...rest, title: rest.title + ' (kopje)', status: 'Todo' });
    toast({ title: 'Detyrë u kopjua' });
  });
  const onRowRequestDelete = useStableCallback((id: string) => setDeleteConfirmId(id));

  // Viewer (canEdit=false) is read-only: the rules currently accept any
  // business member's write, so the UI must not advertise mutations the role
  // isn't meant to have. Delete additionally requires manager rank or owning
  // the task (creator/assignee).
  const renderTaskRow = (task: Task) => {
    const subtaskInfo = subtaskCounts[task.id];
    return (
      <TaskRow
        task={task}
        isSelected={selectedTask?.id === task.id}
        isChecked={selectedIds.has(task.id)}
        selectionActive={selectedIds.size > 0}
        isBlocked={blockedTaskIds.has(task.id)}
        isBeingWorkedOn={tasksBeingWorkedOn.has(task.id)}
        projectName={getProjectName(task.projectId)}
        subtaskDone={subtaskInfo?.done}
        subtaskTotal={subtaskInfo?.total}
        commentCount={commentCountByTask.get(task.id) || 0}
        assigneeName={getUserName(task.assignedToUserId)}
        canEdit={permissions.canEdit}
        canDelete={!!canDeleteTask(task)}
        onSelect={onRowSelect}
        onToggleChecked={onRowToggleChecked}
        onToggleDone={onRowToggleDone}
        onMarkDone={onRowMarkDone}
        onSetPriority={onRowSetPriority}
        onReschedule={onRowReschedule}
        onCopy={onRowCopy}
        onRequestDelete={onRowRequestDelete}
      />
    );
  };

  const boardCardPropsFor = (task: Task) => {
    const subtaskInfo = subtaskCounts[task.id];
    return {
      isSelected: selectedTask?.id === task.id,
      isBlocked: blockedTaskIds.has(task.id),
      isBeingWorkedOn: tasksBeingWorkedOn.has(task.id),
      projectName: getProjectName(task.projectId),
      subtaskDone: subtaskInfo?.done,
      subtaskTotal: subtaskInfo?.total,
      assigneeName: getUserName(task.assignedToUserId),
    };
  };

  const activeDragTitle = activeTaskId ? tasks.find(t => t.id === activeTaskId)?.title : null;

  if (tasksLoading) return <TaskListSkeleton />;

  return (
    // Fill the route wrapper (App.tsx gives it a definite height + its own scroll)
    // instead of guessing the viewport minus a hardcoded 120px of chrome. That
    // guess ignored the top nav, the wrapper's own padding and any banner, so the
    // page overflowed its container: dead space plus a second, pointless scrollbar.
    <div className="h-full min-h-[24rem] w-full min-w-0 flex flex-col lg:flex-row">
      {/* Left Side - Task List */}
      <div className={`${
        selectedTask
          ? `hidden lg:flex lg:flex-col lg:border-r ${panelExpanded ? 'lg:w-1/3 lg:min-w-[400px]' : 'lg:w-1/2'}`
          : 'flex flex-col w-full'
      } min-w-0 transition-all duration-300`}>
        {/* ── Header ── */}
        <TaskListHeader
          taskCount={tasks.length}
          myTaskCount={myTasks.length}
          canEdit={permissions.canEdit}
          createOpen={isCreateDialogOpen}
          onCreateOpenChange={(open) => { setIsCreateDialogOpen(open); if (!open) setDateConflict(null); }}
          createForm={
            <QuickTaskForm
              // The quick form shows the same-day warning inline (non-blocking,
              // "krijohet gjithsesi") so the parked-confirmation dialog is skipped.
              onSubmit={(fd, opts) => handleCreateTask(fd, { skipDateConflictCheck: true, createAnother: opts?.createAnother })}
              projects={projects || []}
              conflictTasks={rawTasks || []}
              teamMembers={teamMembers?.filter((m: any) => !businessId || !m.businessId || m.businessId === businessId) || []}
              canAssignTasks={permissions.canAssignTasks}
              currentUserId={user?.uid || ''}
              allLabels={allLabels}
            />
          }
          viewMode={viewMode}
          onViewMode={setViewMode}
        />

        {/* ── Search + filters ── */}
        <TaskFilters
          searchQuery={searchQuery}
          onSearch={setSearchQuery}
          totalCount={baseTasksForStats.length}
          stats={taskStats}
          filterStatus={filterStatus}
          onFilterStatus={setFilterStatus}
          currentUserId={user?.uid}
          filterAssignee={filterAssignee}
          onFilterAssignee={setFilterAssignee}
          assigneeOptions={assigneeOptions}
          showGroupBy={viewMode === 'list'}
          groupBy={groupBy}
          onGroupBy={setGroupBy}
          allLabels={allLabels}
          filterLabel={filterLabel}
          onFilterLabel={setFilterLabel}
        />

        {/* Smart Suggestions Panel — only in list view (it eats vertical space and
            pushes Board/Calendar below the fold otherwise) */}
        {viewMode === 'list' && (
          <SmartSuggestions
            tasks={allTasks || []}
            projects={projects || []}
            customers={customers || []}
            invoices={invoices || []}
            onTaskClick={(task) => setSelectedTask(task)}
            getUserName={getUserName}
          />
        )}

        {/* Task List Content */}
        <div className="flex-1 min-w-0 overflow-y-auto">
          {viewMode === 'list' && (
            <TaskListView
              key={todayKey}
              groupBy={groupBy}
              visibleTasks={visibleTasks}
              taskGroups={taskGroups}
              isEmpty={tasks.length === 0}
              sensors={sensors}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              dragOverlayTitle={activeDragTitle}
              showOverlay={!!activeTaskId && viewMode === 'list'}
              onCreateFirst={() => setIsCreateDialogOpen(true)}
              renderRow={renderTaskRow}
            />
          )}

          {/* Bulk action bar (floating) — list view only, where the checkboxes are */}
          {viewMode === 'list' && selectedIds.size > 0 && (
            <TaskBulkBar
              count={selectedIds.size}
              canAssignTasks={permissions.canAssignTasks}
              members={uniqueTeamMembers.filter((m: any) => !businessId || !m.businessId || m.businessId === businessId)}
              getUserName={getUserName}
              onUpdate={bulkUpdate}
              onDelete={bulkDelete}
              onClear={clearSelection}
            />
          )}

          {viewMode === 'board' && (
            <TaskBoardView
              key={todayKey}
              boardColumns={boardColumns}
              sensors={sensors}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              dragOverlayTitle={activeDragTitle}
              showOverlay={!!activeTaskId}
              cardPropsFor={boardCardPropsFor}
              onSelect={onRowSelect}
            />
          )}

          {viewMode === 'timeline' && (
            <TaskTimeline tasks={tasks} onTaskClick={setSelectedTask} />
          )}

          {viewMode === 'calendar' && (
            <TaskCalendarView tasks={tasks} projects={projects} onTaskClick={setSelectedTask} />
          )}
        </div>

        {/* Persistent pagination footer (list view) — always visible, below the scroll area */}
        {viewMode === 'list' && (
          <TaskPaginationBar
            page={page}
            totalPages={totalPages}
            totalItems={orderedTasks.length}
            pageSize={PAGE_SIZE}
            onPage={setPage}
          />
        )}
      </div>

      {/* Right Side - Task Detail Panel (side panel on desktop, bottom sheet on mobile) */}
      {selectedTask && (
        <div className={`
          fixed bottom-0 left-0 right-0 z-50 rounded-t-[22px] overflow-hidden
          sm:fixed sm:inset-0 sm:rounded-none sm:pt-[72px]
          lg:relative lg:inset-auto lg:z-auto lg:rounded-none lg:pt-0
          bg-background
          ${panelExpanded ? 'lg:flex-1' : 'lg:w-1/2'}
          h-[88dvh] sm:h-full
          max-h-[100dvh] flex flex-col
          shadow-2xl lg:shadow-none border-t lg:border-t-0 lg:border-l
        `}>
          <TaskDetailPanel
            key={selectedTask.id}
            task={selectedTask}
            onClose={() => { setSelectedTask(null); setPanelExpanded(false); setFocusComment(null); }}
            onExpand={() => setPanelExpanded(p => !p)}
            isExpanded={panelExpanded}
            comments={comments?.filter(c => c.taskId === selectedTask.id) || []}
            onAddComment={handleAddComment}
            focusCommentId={focusComment?.taskId === selectedTask.id ? focusComment.commentId : null}
            onEditComment={handleEditComment}
            onDeleteComment={handleDeleteComment}
            onToggleReaction={handleToggleReaction}
            onUpdate={taskMutation.update}
            onDelete={(id) => deleteTaskCascade(id).catch(err => {
              console.error('[Tasks] fshirja dështoi:', err);
              toast({ title: 'Detyra nuk u fshi', description: err?.message, variant: 'destructive' });
            })}
            projects={projects}
            projectsLoading={projectsLoading}
            // The FULL workspace list, not the role-filtered one: the blocker
            // guard and the dependency picker must see colleagues' tasks.
            allTasks={rawTasks || []}
            onSelectSubtask={(subtask) => setSelectedTask(subtask)}
          />
        </div>
      )}

      {/* Delete confirmation modal */}
      <TaskDeleteConfirmDialog
        open={!!deleteConfirmId}
        onCancel={() => setDeleteConfirmId(null)}
        onConfirm={confirmSingleDelete}
      />

      {/* Bulk delete confirmation — only the rows the user may delete are deleted */}
      <TaskBulkDeleteDialog
        open={bulkDeleteOpen}
        deleting={bulkDeleting}
        allowedCount={bulkDeletePlan.allowed.length}
        skipped={bulkDeletePlan.skipped}
        onClose={() => setBulkDeleteOpen(false)}
        onConfirm={confirmBulkDelete}
      />

      {/* Same-day warning: the assignee already has work on the chosen date */}
      <TaskDateConflictDialog
        open={!!dateConflict}
        onOpenChange={(open) => { if (!open) setDateConflict(null); }}
        assigneeName={dateConflict?.assigneeName || ''}
        date={dateConflict?.date}
        tasks={dateConflict?.tasks || []}
        onConfirm={handleConfirmDateConflict}
        confirmLabel="Po, hape gjithsesi"
        loading={taskMutation.loading}
      />
    </div>
  );
};

export default TasksView;
