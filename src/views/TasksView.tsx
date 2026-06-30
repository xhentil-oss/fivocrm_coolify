import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DndContext, DragOverlay, closestCorners, PointerSensor, useSensor, useSensors, type DragStartEvent, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { getStatusColor, getPriorityColor } from '../lib/statusColors';
import { addFrequency } from '../lib/recurringUtils';
import { useCollection, useMutation, useGlobalTeamId, useGlobalBusinessId } from '../hooks/useFirestore';
import { useTeamSettingsData, saveTeamSettings } from '../hooks/useTeamSettings';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../contexts/PermissionsContext';
import { Calendar as CalendarIcon, User, Flag, MoreVertical, Plus, MessageSquare, CalendarDays, Filter, List, LayoutGrid, Users, ChevronLeft, ChevronRight, ChevronDown, Target, Clock, Play, Pause, Square, Check, X, AlertCircle, CheckCircle2, CircleDot, ListChecks, Maximize2, Minimize2, Edit2, Trash2, AlertTriangle, GripVertical } from 'lucide-react';
import { Card } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Checkbox } from '../components/ui/checkbox';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import RichTextEditor from '../components/RichTextEditor';
import { Calendar } from '../components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import { useActivityLogger } from '../hooks/useActivityLogger';
import { useFilteredTasks } from '../hooks/useRoleFilteredData';
import { toast } from '../hooks/use-toast';
import type { Task, TaskComment, Project, Notification, TaskCollaborator, UserProfile, TimeEntry, Customer, Invoice } from '../types';
import TaskDetailPanel from '../components/TaskDetailPanel';
import SmartSuggestions from '../components/SmartSuggestions';
import { TaskLabels, LabelEditor } from '../components/TaskLabels';
import TaskTimeline from '../components/TaskTimeline';
import { GanttChart } from 'lucide-react';

/** A task is overdue only if its due DAY is before today (calendar-day, ignoring
 * time-of-day) — consistent with the "Sot/Nesër" labels now that tasks carry
 * intra-day times. Undated/invalid → not overdue. */
function isOverdueDate(endDate: any): boolean {
  if (!endDate) return false;
  const d = new Date(endDate);
  if (isNaN(d.getTime())) return false;
  const sod = (x: Date) => { const n = new Date(x); n.setHours(0, 0, 0, 0); return n.getTime(); };
  return sod(d) < sod(new Date());
}

/** Generate a deterministic HSL background colour from a name string */
function hashColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  const h = Math.abs(hash) % 360;
  return `hsl(${h}, 55%, 42%)`;
}

const TasksView: React.FC = () => {
  const { user } = useAuth();
  const permissions = usePermissions();
  const logActivity = useActivityLogger();
  // Persisted view preferences (Asana-style: the view/filter you left is remembered).
  const [viewMode, setViewMode] = useState<'board' | 'calendar' | 'list' | 'timeline'>(() => (localStorage.getItem('tasks_viewMode') as any) || 'list');
  const [filterStatus, setFilterStatus] = useState<string>(() => localStorage.getItem('tasks_filterStatus') || 'all');
  // Filter by assignee (a teamMember userId, 'all', or 'unassigned'). Applies to
  // every view — list, board, calendar and timeline — so e.g. picking Elton shows
  // exactly what Elton has to do, including on the calendar.
  const [filterAssignee, setFilterAssignee] = useState<string>(() => localStorage.getItem('tasks_filterAssignee') || 'all');
  const [groupBy, setGroupBy] = useState<'none' | 'assignee' | 'priority' | 'project' | 'dueDate'>(() => (localStorage.getItem('tasks_groupBy') as any) || 'none');
  useEffect(() => {
    localStorage.setItem('tasks_viewMode', viewMode);
    localStorage.setItem('tasks_filterStatus', filterStatus);
    localStorage.setItem('tasks_filterAssignee', filterAssignee);
    localStorage.setItem('tasks_groupBy', groupBy);
  }, [viewMode, filterStatus, filterAssignee, groupBy]);
  const PAGE_SIZE = 50;
  const [page, setPage] = useState(0);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [panelExpanded, setPanelExpanded] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [listOrder, setListOrder] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('tasks_list_order') || '[]'); } catch { return []; }
  });
  const teamId = useGlobalTeamId();
  const businessId = useGlobalBusinessId();
  const teamSettingsData = useTeamSettingsData();
  const listOrderLoaded = React.useRef(false);
  // Load task list order from Firestore once (Firestore takes priority over localStorage)
  useEffect(() => {
    if (listOrderLoaded.current) return;
    if (teamSettingsData === null) return;
    listOrderLoaded.current = true;
    if (teamSettingsData.taskListOrder && teamSettingsData.taskListOrder.length > 0) {
      setListOrder(teamSettingsData.taskListOrder);
    }
  }, [teamSettingsData]);
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
  const { data: collaborators } = useCollection<TaskCollaborator>('taskCollaborators');
  const { data: userProfiles } = useCollection<UserProfile>('userProfiles');
  const { data: teamMembers } = useCollection<any>('teamMembers', {
    where: [{ field: 'status', operator: '==', value: 'Active' }],
    skipTeamFilter: true,
  });
  
  // Get all active time entries to show who's working on what
  const { data: activeTimeEntries } = useCollection<TimeEntry>('timeEntries', {
    where: [{ field: 'endTime', operator: '==', value: null }]
  });

  // Get tasks that are currently being worked on
  const tasksBeingWorkedOn = React.useMemo(() => {
    if (!activeTimeEntries) return new Set<string>();
    return new Set(activeTimeEntries.map(entry => entry.taskId).filter(Boolean));
  }, [activeTimeEntries]);

  // Helper: resolve userId to display name
  const getUserName = React.useCallback((userId?: string) => {
    if (!userId) return 'Pa caktuar';
    if (userId === user?.uid) return user?.displayName || 'Ti';
    const profile = userProfiles?.find(p => p.userId === userId || p.id === userId);
    if (profile?.displayName) return profile.displayName;
    const member = teamMembers?.find((m: any) => m.userId === userId);
    if (member?.displayName) return member.displayName;
    if (member?.email) return member.email.split('@')[0];
    return userId.includes('@') ? userId.split('@')[0] : userId.slice(0, 8);
  }, [user, userProfiles, teamMembers]);

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

  // Compute which tasks are blocked (have unfinished dependsOn)
  const blockedTaskIds = useMemo(() => {
    if (!allTasks) return new Set<string>();
    const blocked = new Set<string>();
    const taskMap = new Map(allTasks.map(t => [t.id, t]));
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
  }, [allTasks]);

  // Helper: get project name
  const getProjectName = React.useCallback((projectId?: string) => {
    if (!projectId || !projects) return null;
    return projects.find(p => p.id === projectId)?.name || null;
  }, [projects]);

  // Mutations
  const taskMutation = useMutation<Task>('tasks');
  const commentMutation = useMutation<TaskComment>('taskComments');
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
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(t =>
        t.title.toLowerCase().includes(query) ||
        t.description?.toLowerCase().includes(query)
      );
    }
    return filtered;
  }, [allTasks, searchQuery, filterAssignee]);

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
    return allTasks.filter(t => t.assignedToUserId === user.uid && !t.parentTaskId);
  }, [allTasks, user]);

  // Task stats always computed from baseTasksForStats (NOT filtered by status)
  // so filter buttons always show correct totals regardless of active filter
  const taskStats = useMemo(() => {
    if (!baseTasksForStats.length && !allTasks?.length) return { todo: 0, inProgress: 0, review: 0, done: 0, overdue: 0 };
    const now = new Date();
    return {
      todo: baseTasksForStats.filter(t => t.status === 'Todo').length,
      inProgress: baseTasksForStats.filter(t => t.status === 'In Progress').length,
      review: baseTasksForStats.filter(t => t.status === 'Review').length,
      done: baseTasksForStats.filter(t => t.status === 'Done').length,
      overdue: baseTasksForStats.filter(t => isOverdueDate(t.endDate) && t.status !== 'Done').length,
    };
  }, [baseTasksForStats, allTasks]);

  // Open task from URL param (e.g. navigated from Dashboard)
  useEffect(() => {
    const taskIdParam = searchParams.get('taskId');
    if (taskIdParam && allTasks && allTasks.length > 0) {
      const taskToSelect = allTasks.find(t => t.id === taskIdParam);
      if (taskToSelect) {
        setSelectedTask(taskToSelect);
        // Clean up the URL param after selecting
        setSearchParams({}, { replace: true });
      }
    }
  }, [searchParams, allTasks]);

  // Keep selectedTask in sync with live Firestore data
  useEffect(() => {
    if (selectedTask && allTasks) {
      const updated = allTasks.find(t => t.id === selectedTask.id);
      if (updated && JSON.stringify(updated) !== JSON.stringify(selectedTask)) {
        setSelectedTask(updated);
      }
    }
  }, [allTasks, selectedTask]);



  const handleCreateTask = async (formData: FormData) => {
    const title = formData.get('title') as string;
    const description = formData.get('description') as string;
    // Dates are optional (only the title is required) — guard against Invalid Date.
    const startRaw = formData.get('startDate') as string;
    const endRaw = formData.get('endDate') as string;
    const sd = startRaw ? new Date(startRaw) : null;
    const ed = endRaw ? new Date(endRaw) : null;
    const startDate = sd && !isNaN(sd.getTime()) ? sd : undefined;
    const endDate = ed && !isNaN(ed.getTime()) ? ed : undefined;
    // Default to current user if not specified
    const assignedToUserId = (formData.get('assignedToUserId') as string) || user?.uid || '';
    const projectId = formData.get('projectId') as string;
    const priority = formData.get('priority') as string;
    const status = formData.get('status') as string;
    const parentTaskId = formData.get('parentTaskId') as string;
    const collaboratorIdsRaw = formData.get('collaboratorIds') as string;
    const isRecurringRaw = formData.get('isRecurring') as string;
    const recurringFrequency = formData.get('recurringFrequency') as string;
    const recurringDayOfWeekRaw = formData.get('recurringDayOfWeek') as string;
    const recurringDayOfMonthRaw = formData.get('recurringDayOfMonth') as string;
    const recurringDaysOfWeekRaw = formData.get('recurringDaysOfWeek') as string;
    const estimatedHoursRaw = formData.get('estimatedHours') as string;
    const dependsOnRaw = formData.get('dependsOn') as string;

    let dependsOn: string[] = [];
    try { dependsOn = dependsOnRaw ? JSON.parse(dependsOnRaw) : []; } catch { dependsOn = []; }
    let collaboratorIds: string[] = [];
    try { collaboratorIds = collaboratorIdsRaw ? JSON.parse(collaboratorIdsRaw) : []; } catch { collaboratorIds = []; }
    const labelsRaw = formData.get('labels') as string;
    let labels: string[] = [];
    try { labels = labelsRaw ? JSON.parse(labelsRaw) : []; } catch { labels = []; }
    const isRecurring = isRecurringRaw === 'true';
    const recurringDayOfWeek = recurringDayOfWeekRaw ? parseInt(recurringDayOfWeekRaw) : undefined;
    const recurringDayOfMonth = recurringDayOfMonthRaw ? parseInt(recurringDayOfMonthRaw) : undefined;

    let nextRecurringDate: Date | undefined;
    if (isRecurring && recurringFrequency) {
      const now = new Date();
      if (recurringFrequency === 'daily') {
        // Next day that is in the selected days-of-week list (default Mon-Fri)
        const activeDays = recurringDaysOfWeekRaw ? JSON.parse(recurringDaysOfWeekRaw) as number[] : [1,2,3,4,5];
        nextRecurringDate = new Date(now);
        nextRecurringDate.setDate(nextRecurringDate.getDate() + 1);
        nextRecurringDate.setHours(9, 0, 0, 0);
        if (activeDays.length > 0) {
          let tries = 0;
          while (!activeDays.includes(nextRecurringDate.getDay()) && tries < 7) {
            nextRecurringDate.setDate(nextRecurringDate.getDate() + 1);
            tries++;
          }
        }
      } else if (recurringFrequency === 'weekly' && recurringDayOfWeek !== undefined) {
        // Next occurrence of selected weekday
        nextRecurringDate = new Date(now);
        const currentDay = now.getDay();
        let daysUntil = recurringDayOfWeek - currentDay;
        if (daysUntil <= 0) daysUntil += 7;
        nextRecurringDate.setDate(nextRecurringDate.getDate() + daysUntil);
        nextRecurringDate.setHours(9, 0, 0, 0);
      } else if (recurringFrequency === 'monthly' && recurringDayOfMonth !== undefined) {
        // Next occurrence of selected day of month, clamped to the month's last
        // day (e.g. day 31 in February becomes the 28th/29th, not March 3rd).
        const buildMonthly = (year: number, month: number) => {
          const lastDay = new Date(year, month + 1, 0).getDate();
          return new Date(year, month, Math.min(recurringDayOfMonth, lastDay), 9, 0, 0);
        };
        nextRecurringDate = buildMonthly(now.getFullYear(), now.getMonth());
        if (nextRecurringDate <= now) {
          nextRecurringDate = buildMonthly(now.getFullYear(), now.getMonth() + 1);
        }
      } else if (recurringFrequency === 'yearly') {
        const baseDate = new Date(endDate || now);
        nextRecurringDate = new Date(baseDate.setFullYear(baseDate.getFullYear() + 1));
      }
    }

    const newTask = await taskMutation.create({
      title,
      description,
      startDate,
      endDate,
      assignedToUserId,
      projectId: projectId || undefined,
      status,
      priority,
      parentTaskId: parentTaskId || undefined,
      collaboratorIds: collaboratorIds,
      labels: labels.length > 0 ? labels : undefined,
      dueNotificationSent: false,
      isRecurring,
      recurringFrequency: isRecurring ? recurringFrequency : undefined,
      recurringDayOfWeek: isRecurring && recurringFrequency === 'weekly' ? recurringDayOfWeek : undefined,
      recurringDayOfMonth: isRecurring && recurringFrequency === 'monthly' ? recurringDayOfMonth : undefined,
      recurringDaysOfWeek: isRecurring && recurringFrequency === 'daily' && recurringDaysOfWeekRaw
        ? (() => { try { return JSON.parse(recurringDaysOfWeekRaw); } catch { return [1,2,3,4,5]; } })()
        : undefined,
      nextRecurringDate,
      estimatedHours: estimatedHoursRaw ? (v => !isNaN(v) ? v : undefined)(parseFloat(estimatedHoursRaw)) : undefined,
      dependsOn: dependsOn.length > 0 ? dependsOn : undefined,
    });

    // Create collaborator records in parallel
    await Promise.all(
      collaboratorIds.map(collabId =>
        collaboratorMutation.create({
          taskId: newTask.id,
          userId: collabId,
          role: 'collaborator',
        })
      )
    );

    // Send notifications in parallel
    const notificationPromises: Promise<any>[] = [];
    if (assignedToUserId && assignedToUserId !== user?.uid) {
      notificationPromises.push(
        notificationMutation.create({
          userId: assignedToUserId,
          type: 'task_assigned',
          title: 'Detyrë e Re e Caktuar',
          message: `Ju u caktuat te detyra: ${title}`,
          isRead: false,
          actionUrl: '/app/tasks',
          actionLabel: 'Shiko Detyrat',
        })
      );
    }
    for (const collabId of collaboratorIds) {
      if (collabId !== user?.uid) {
        notificationPromises.push(
          notificationMutation.create({
            userId: collabId,
            type: 'task_collaborator_added',
            title: 'U shtuat si bashkëpunëtor',
            message: `U shtuat si bashkëpunëtor te detyra: ${title}`,
            isRead: false,
            actionUrl: '/app/tasks',
            actionLabel: 'Shiko Detyrat',
          })
        );
      }
    }
    await Promise.all(notificationPromises);

    setIsCreateDialogOpen(false);
    setSelectedTask(newTask);
  };

  const handleAddComment = async (taskId: string, content: string) => {
    await commentMutation.create({
      taskId,
      content,
    });
  };

  // --- @dnd-kit drag-and-drop for kanban ---
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);

  const handleDragStart = (event: DragStartEvent) => {
    setActiveTaskId(String(event.active.id));
  };

  // Reorder against the FULL workspace task list (not just the filtered/paginated
  // subset), so a manual move while a filter or search is active doesn't drop the
  // order of every hidden task to the end.
  const applyReorder = (taskId: string, overId: string) => {
    const full = listOrder.length ? [...listOrder] : [];
    for (const t of allTasks) if (!full.includes(t.id)) full.push(t.id);
    const oldIndex = full.indexOf(taskId);
    const newIndex = full.indexOf(overId);
    if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return;
    const reordered = arrayMove(full, oldIndex, newIndex);
    setListOrder(reordered);
    localStorage.setItem('tasks_list_order', JSON.stringify(reordered));
    if (teamId) saveTeamSettings(teamId, { taskListOrder: reordered });
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveTaskId(null);
    const { active, over } = event;
    if (!over) return;
    const taskId = String(active.id);
    const overId = String(over.id);

    if (viewMode === 'list') {
      if (taskId !== overId) applyReorder(taskId, overId);
      return;
    }

    // Board: dropped either over a column (empty area) or over another card.
    const overTask = tasks.find(t => t.id === overId);
    const targetStatus = overTask?.status
      || columns.find(c => c.status === overId)?.status;
    if (!targetStatus) return;

    // Persist manual order within the column when dropped over a specific card,
    // so cards keep their position instead of jumping to the end.
    if (overTask && taskId !== overId) applyReorder(taskId, overId);

    const task = tasks.find(t => t.id === taskId);
    if (task && task.status !== targetStatus) {
      await taskMutation.update(taskId, { status: targetStatus });
    }
  };

  const columns = [
    { id: 'Todo', title: 'Për të bërë', status: 'Todo' },
    { id: 'In Progress', title: 'Në progres', status: 'In Progress' },
    { id: 'Review', title: 'Rishikim', status: 'Review' },
    { id: 'Done', title: 'Përfunduar', status: 'Done' },
  ];

  // Shared manual-order map (used by both the list view and board columns).
  const orderMap = useMemo(() => new Map(listOrder.map((id, i) => [id, i])), [listOrder]);
  const sortByOrder = React.useCallback((arr: Task[]) => {
    if (!listOrder.length) return arr;
    return [...arr].sort((a, b) => {
      const ai = orderMap.has(a.id) ? orderMap.get(a.id)! : 99999;
      const bi = orderMap.has(b.id) ? orderMap.get(b.id)! : 99999;
      return ai - bi;
    });
  }, [listOrder, orderMap]);

  // Apply saved manual order for the list view
  const orderedTasks = useMemo(() => sortByOrder(tasks), [tasks, sortByOrder]);

  // Page-based pagination (50 per page) — applies to both flat and grouped views.
  const totalPages = Math.max(1, Math.ceil(orderedTasks.length / PAGE_SIZE));
  // Reset to first page whenever the underlying set changes.
  React.useEffect(() => { setPage(0); }, [filterStatus, filterAssignee, searchQuery, groupBy]);
  // Clamp if the current page falls out of range (e.g. after deletions).
  React.useEffect(() => { if (page > totalPages - 1) setPage(totalPages - 1); }, [page, totalPages]);
  const visibleTasks = useMemo(
    () => orderedTasks.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE),
    [orderedTasks, page]
  );

  // Format date compactly — always show actual date; flag overdue with ⚠️
  const formatDateCompact = (date: Date) => {
    if (!date || isNaN(new Date(date).getTime())) {
      return { text: 'Pa afat', overdue: false, className: 'text-muted-foreground' };
    }
    const now = new Date();
    const taskDate = new Date(date);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const dateStr = `${months[taskDate.getMonth()]} ${taskDate.getDate()}`;
    // Compare CALENDAR days (ignore time-of-day) so a task due later today isn't
    // labeled "Nesër" — intra-day times made the hour-based diff round up.
    const sod = (d: Date) => { const n = new Date(d); n.setHours(0, 0, 0, 0); return n.getTime(); };
    const diffDays = Math.round((sod(taskDate) - sod(now)) / (1000 * 60 * 60 * 24));
    if (diffDays < 0) return { text: dateStr, overdue: true, className: 'text-destructive font-medium' };
    if (diffDays === 0) return { text: 'Sot · ' + dateStr, overdue: false, className: 'text-warning font-medium' };
    if (diffDays === 1) return { text: 'Nesër · ' + dateStr, overdue: false, className: 'text-warning' };
    return { text: dateStr, overdue: false, className: 'text-muted-foreground' };
  };

  // ── Group by (Jira/Asana style) — purely client-side over the loaded tasks ──
  const taskGroups = useMemo(() => {
    if (groupBy === 'none') return [];
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const PRIORITY_LABEL: Record<string, string> = { urgent: 'Urgjente', high: 'I lartë', medium: 'Mesatar', low: 'I ulët' };
    const PRIORITY_ORDER = ['urgent', 'high', 'medium', 'low'];
    const groups = new Map<string, { key: string; label: string; sort: number; tasks: Task[] }>();
    const add = (key: string, label: string, sort: number, task: Task) => {
      let g = groups.get(key);
      if (!g) { g = { key, label, sort, tasks: [] }; groups.set(key, g); }
      g.tasks.push(task);
    };
    for (const task of visibleTasks) {
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
        const raw = task.endDate ? new Date(task.endDate) : null;
        if (!raw || isNaN(raw.getTime())) { add('z_none', 'Pa afat', 5, task); continue; }
        const day = new Date(raw.getFullYear(), raw.getMonth(), raw.getDate());
        const diff = Math.round((day.getTime() - startOfToday.getTime()) / 86400000);
        if (day < startOfToday && task.status !== 'Done') add('a_overdue', 'Të vonuara', 0, task);
        else if (diff === 0) add('b_today', 'Sot', 1, task);
        else if (diff > 0 && diff <= 7) add('c_week', 'Këtë javë', 2, task);
        else add('d_later', 'Më vonë', 3, task);
      }
    }
    return Array.from(groups.values()).sort((a, b) => a.sort - b.sort || a.label.localeCompare(b.label));
  }, [groupBy, visibleTasks, getUserName, getProjectName]);

  // Single task row — shared by the flat (drag-sortable) list and the grouped view.
  // Bulk multi-select (Asana/Monday) — list view.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const toggleSelect = (id: string) => setSelectedIds(prev => { const s = new Set(prev); if (s.has(id)) s.delete(id); else s.add(id); return s; });
  const clearSelection = () => setSelectedIds(new Set());
  const bulkUpdate = async (patch: Partial<Task>) => {
    const ids = [...selectedIds];
    if (!ids.length) return;
    const results = await Promise.allSettled(ids.map(id => taskMutation.update(id, patch)));
    const failed = results.filter(r => r.status === 'rejected').length;
    toast(failed
      ? { title: `${ids.length - failed}/${ids.length} u përditësuan`, description: `${failed} dështuan`, variant: 'destructive' }
      : { title: `${ids.length} detyra u përditësuan` });
    clearSelection();
  };
  const bulkDelete = async () => {
    const ids = [...selectedIds];
    if (!ids.length) return;
    const results = await Promise.allSettled(ids.map(id => taskMutation.remove(id)));
    const failed = results.filter(r => r.status === 'rejected').length;
    toast(failed
      ? { title: `${ids.length - failed}/${ids.length} u fshinë`, description: `${failed} dështuan`, variant: 'destructive' }
      : { title: `${ids.length} detyra u fshinë` });
    clearSelection();
  };

  const renderTaskRow = (task: Task) => {
    const dateInfo = formatDateCompact(new Date(task.endDate));
    const isSelected = selectedTask?.id === task.id;
    const isOverdue = isOverdueDate(task.endDate) && task.status !== 'Done';
    const isBlocked = blockedTaskIds.has(task.id);
    const projectName = getProjectName(task.projectId);
    const subtaskInfo = subtaskCounts[task.id];
    const isBeingWorkedOn = tasksBeingWorkedOn.has(task.id);
    const commentCount = comments?.filter(c => c.taskId === task.id).length || 0;
    const assigneeName = getUserName(task.assignedToUserId);
    const initials = assigneeName.slice(0, 2).toUpperCase();
    const initialsColor = hashColor(assigneeName);
    const priorityFlagColor = task.priority === 'urgent' || task.priority === 'high'
      ? '#EF4444' : task.priority === 'medium' ? '#F97316' : '#9CA3AF';
    return (
      <div
        className={`group relative flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors ${
          isSelected ? 'bg-primary/5 border-l-2 border-l-primary' : ''
        } ${isOverdue ? 'bg-destructive/5' : ''}`}
        onClick={() => setSelectedTask(task)}
      >
        {/* Bulk-select checkbox (shows on hover or when a selection is active) */}
        <div
          onClick={(e) => e.stopPropagation()}
          className={`flex items-center pt-1 flex-shrink-0 transition-opacity ${selectedIds.size > 0 ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
        >
          <Checkbox checked={selectedIds.has(task.id)} onCheckedChange={() => toggleSelect(task.id)} aria-label="Përzgjidh detyrën" />
        </div>
        {/* Drag handle */}
        <div className="mt-1.5 cursor-grab opacity-0 group-hover:opacity-30 hover:!opacity-70 text-muted-foreground flex-shrink-0 hidden sm:block">
          <GripVertical className="w-3.5 h-3.5" />
        </div>
        <Checkbox
          checked={task.status === 'Done'}
          onCheckedChange={async (checked) => {
            const newStatus = checked ? 'Done' : 'Todo';
            await taskMutation.update(task.id, { status: newStatus });
            toast({ title: 'Statusi u ndryshua ✓', description: `"${task.title}" → ${checked ? 'Përfunduar' : 'Për të bërë'}` });
            if (checked) logActivity('task_completed', `Detyrë e përfunduar: ${task.title}`, { entityType: 'task', entityId: task.id });
          }}
          onClick={(e) => e.stopPropagation()}
          className={`mt-1 flex-shrink-0 ${task.status === 'Done' ? 'bg-success border-success' : ''}`}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {/* Priority flag — inline change */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button onClick={(e) => e.stopPropagation()} title="Ndrysho prioritetin" className="flex-shrink-0 hover:opacity-70">
                  <Flag className="w-3 h-3" style={{ color: priorityFlagColor }} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" onClick={(e) => e.stopPropagation()}>
                {(([['urgent', 'Urgjent'], ['high', 'I lartë'], ['medium', 'Mesatar'], ['low', 'I ulët']]) as const).map(([p, label]) => (
                  <DropdownMenuItem key={p} onClick={() => taskMutation.update(task.id, { priority: p })}>{label}</DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <span className={`text-sm font-medium ${task.status === 'Done' ? 'line-through text-muted-foreground' : ''}`}>
              {task.title}
            </span>
            {isBeingWorkedOn && (
              <span className="flex items-center gap-0.5 text-[10px] text-success bg-success/10 px-1.5 py-0.5 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
                Duke punuar
              </span>
            )}
            {isBlocked && (
              <span className="flex items-center gap-0.5 text-[10px] text-orange-600 bg-orange-50 dark:bg-orange-950 dark:text-orange-300 px-1.5 py-0.5 rounded-full border border-orange-200 dark:border-orange-800">
                🔒 Bllokuar
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            {/* Status badge */}
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
              task.status === 'Done' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
              : task.status === 'In Progress' ? 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300'
              : task.status === 'Review' ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
              : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
            }`}>
              {task.status === 'Todo' ? 'Për të bërë' : task.status === 'In Progress' ? 'Në progres' : task.status === 'Review' ? 'Rishikim' : 'Përfunduar'}
            </span>
            {/* Project name */}
            {projectName && (
              <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded flex items-center gap-1">
                <Target className="w-2.5 h-2.5" />{projectName}
              </span>
            )}
            {/* Comment count */}
            {commentCount > 0 && (
              <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                <MessageSquare className="w-2.5 h-2.5" />{commentCount}
              </span>
            )}
            {/* Labels */}
            <TaskLabels labels={(task as any).labels} max={4} />
          </div>
          {/* Subtask progress bar */}
          {subtaskInfo && (
            <div className="mt-1.5">
              <div className="flex items-center gap-1.5 mb-0.5">
                <ListChecks className="w-2.5 h-2.5 text-muted-foreground" />
                <span className="text-[10px] text-muted-foreground">{subtaskInfo.done}/{subtaskInfo.total}</span>
              </div>
              <div className="h-1 bg-muted rounded-full overflow-hidden w-24">
                <div className="h-full bg-primary rounded-full transition-all"
                  style={{ width: `${subtaskInfo.total > 0 ? (subtaskInfo.done / subtaskInfo.total) * 100 : 0}%` }} />
              </div>
            </div>
          )}
        </div>
        {/* Assignee initials — 28px, hash color, tooltip */}
        <div
          className="hidden sm:flex items-center gap-1.5 flex-shrink-0"
          title={assigneeName}
        >
          <div
            className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0"
            style={{ backgroundColor: initialsColor }}
          >
            {initials}
          </div>
        </div>
        {/* Date — inline reschedule (preserves time-of-day) */}
        <Popover>
          <PopoverTrigger asChild>
            <button
              onClick={(e) => e.stopPropagation()}
              title="Ndrysho afatin"
              className={`flex items-center gap-1 text-xs whitespace-nowrap flex-shrink-0 mt-0.5 hover:bg-muted rounded px-1 py-0.5 transition-colors ${dateInfo.className}`}
            >
              {dateInfo.overdue && <AlertTriangle className="w-3 h-3" />}
              {dateInfo.text}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="end" onClick={(e) => e.stopPropagation()}>
            <Calendar
              mode="single"
              selected={task.endDate ? new Date(task.endDate) : undefined}
              onSelect={async (d) => {
                if (!d) return;
                const nd = new Date(d);
                const cur = task.endDate ? new Date(task.endDate) : null;
                nd.setHours(cur?.getHours() ?? 9, cur?.getMinutes() ?? 0, 0, 0);
                await taskMutation.update(task.id, { endDate: nd });
              }}
            />
          </PopoverContent>
        </Popover>
        {/* Hover quick actions */}
        <div
          className="absolute right-4 top-2.5 hidden group-hover:flex items-center gap-0.5 bg-background border border-border rounded-md shadow-sm px-0.5 py-0.5 z-10"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Mark Done */}
          <button
            title="Shëno si Përfunduar"
            className="px-1.5 py-1 rounded text-xs hover:bg-muted text-emerald-600"
            onClick={async (e) => {
              e.stopPropagation();
              if (task.status !== 'Done') {
                await taskMutation.update(task.id, { status: 'Done' });
                toast({ title: 'Statusi u ndryshua ✓', description: `"${task.title}" → Përfunduar` });
                logActivity('task_completed', `Detyrë e përfunduar: ${task.title}`, { entityType: 'task', entityId: task.id });
              }
            }}
          >
            <Check className="w-3.5 h-3.5" />
          </button>
          {/* Edit */}
          <button
            title="Edito"
            className="px-1.5 py-1 rounded text-xs hover:bg-muted text-foreground"
            onClick={(e) => { e.stopPropagation(); setSelectedTask(task); }}
          >
            <Edit2 className="w-3.5 h-3.5" />
          </button>
          {/* More */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="px-1.5 py-1 rounded text-xs hover:bg-muted text-foreground">
                <MoreVertical className="w-3.5 h-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="text-sm">
              <DropdownMenuItem onClick={async () => {
                const { id, isRecurring, recurringFrequency, recurringDayOfWeek, recurringDayOfMonth, recurringDaysOfWeek, nextRecurringDate, dueNotificationSent, overdueNotificationSent, parentTaskId, dependsOn, attachments, ...rest } = task as any;
                await taskMutation.create({ ...rest, title: rest.title + ' (kopje)', status: 'Todo' });
                toast({ title: 'Detyrë u kopjua' });
              }}>
                Kopjo
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive"
                onClick={() => setDeleteConfirmId(task.id)}
              >
                Fshi
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    );
  };

  if (tasksLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <div className="h-8 w-32 skeleton rounded" />
            <div className="h-4 w-48 skeleton rounded" />
          </div>
          <div className="flex gap-3">
            <div className="h-10 w-48 skeleton rounded" />
            <div className="h-10 w-32 skeleton rounded" />
          </div>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {[1, 2, 3, 4].map((col) => (
            <div key={col} className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="h-5 w-24 skeleton rounded" />
                <div className="h-5 w-8 skeleton rounded-full" />
              </div>
              <div className="space-y-3">
                {[1, 2, 3].map((card) => (
                  <div key={card} className="p-4 bg-card rounded-lg border space-y-3">
                    <div className="h-5 w-3/4 skeleton rounded" />
                    <div className="h-4 w-full skeleton rounded" />
                    <div className="flex gap-2">
                      <div className="h-5 w-16 skeleton rounded" />
                      <div className="h-5 w-20 skeleton rounded" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-120px)] flex flex-col lg:flex-row">
      {/* Left Side - Task List */}
      <div className={`${
        selectedTask
          ? `hidden lg:flex lg:flex-col lg:border-r ${panelExpanded ? 'lg:w-1/3 lg:min-w-[400px]' : 'lg:w-1/2'}`
          : 'flex flex-col w-full'
      } transition-all duration-300`}>
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between p-4 border-b gap-3">
          <div>
            <h1 className="text-lg sm:text-xl font-semibold text-foreground">Detyrat</h1>
            <p className="text-xs sm:text-sm text-muted-foreground">
              {tasks.length} detyra · {myTasks.length} të miat
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {/* View switcher — plain buttons (reliable onClick) instead of Radix Tabs */}
            <div className="inline-flex h-8 items-center rounded-lg bg-muted p-0.5">
              {([
                { v: 'list' as const, label: 'Listë', Icon: List },
                { v: 'board' as const, label: 'Board', Icon: LayoutGrid },
                { v: 'timeline' as const, label: 'Timeline', Icon: GanttChart },
                { v: 'calendar' as const, label: 'Kalendar', Icon: CalendarDays },
              ]).map(({ v, label, Icon }) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setViewMode(v)}
                  className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                    viewMode === v ? 'bg-background text-foreground shadow' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Icon className="w-3 h-3 sm:mr-0.5" />
                  <span className="hidden sm:inline">{label}</span>
                </button>
              ))}
            </div>

            {viewMode === 'list' && (
              <Select value={groupBy} onValueChange={(v) => setGroupBy(v as any)}>
                <SelectTrigger className="h-8 text-xs w-full sm:w-[140px]">
                  <Users className="w-3 h-3 mr-1 shrink-0" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Pa grupim</SelectItem>
                  <SelectItem value="assignee">Sipas personit</SelectItem>
                  <SelectItem value="priority">Sipas prioritetit</SelectItem>
                  <SelectItem value="project">Sipas projektit</SelectItem>
                  <SelectItem value="dueDate">Sipas afatit</SelectItem>
                </SelectContent>
              </Select>
            )}

            {permissions.canEdit && (
              <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" className="bg-primary text-primary-foreground">
                    <Plus className="w-4 h-4 sm:mr-1" />
                    <span className="hidden sm:inline">Detyrë e Re</span>
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>Krijo Detyrë të Re</DialogTitle>
                  </DialogHeader>
                  <TaskForm
                    onSubmit={handleCreateTask}
                    projects={projects || []}
                    allTasks={tasks}
                    teamMembers={teamMembers?.filter((m: any) => !businessId || !m.businessId || m.businessId === businessId) || []}
                    canAssignTasks={permissions.canAssignTasks}
                    currentUserId={user?.uid || ''}
                    allLabels={allLabels}
                  />
                </DialogContent>
              </Dialog>
            )}
          </div>
        </div>

        {/* Stats Bar — pill filters on ≥sm, dropdown on mobile */}
        <div className="px-4 py-2 border-b bg-muted/20">
          {/* Mobile: single Select dropdown */}
          <div className="sm:hidden">
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Të gjitha ({baseTasksForStats.length})</SelectItem>
                <SelectItem value="Todo">Për të bërë ({taskStats.todo})</SelectItem>
                <SelectItem value="In Progress">Në progres ({taskStats.inProgress})</SelectItem>
                <SelectItem value="Review">Rishikim ({taskStats.review})</SelectItem>
                <SelectItem value="Done">Përfunduar ({taskStats.done})</SelectItem>
                {taskStats.overdue > 0 && (
                  <SelectItem value="overdue">Vonuar ({taskStats.overdue})</SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>
          {/* Desktop: pill buttons */}
          <div className="hidden sm:flex items-center gap-2 flex-wrap">
            <button onClick={() => setFilterStatus('all')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                filterStatus === 'all' ? 'bg-slate-500 text-white' : 'bg-slate-100 hover:bg-slate-200 text-slate-600 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-300'}`}>
              Të gjitha <span className="tabular-nums">{baseTasksForStats.length}</span>
            </button>
            <button onClick={() => setFilterStatus('Todo')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                filterStatus === 'Todo' ? 'bg-slate-600 text-white' : 'bg-slate-100 hover:bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>
              <CircleDot className="w-3 h-3" />Për të bërë <span className="tabular-nums">{taskStats.todo}</span>
            </button>
            <button onClick={() => setFilterStatus('In Progress')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                filterStatus === 'In Progress' ? 'bg-blue-500 text-white' : 'bg-blue-50 hover:bg-blue-100 text-blue-600 dark:bg-blue-950 dark:text-blue-300'}`}>
              <Play className="w-3 h-3" />Në progres <span className="tabular-nums">{taskStats.inProgress}</span>
            </button>
            <button onClick={() => setFilterStatus('Review')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                filterStatus === 'Review' ? 'bg-amber-500 text-white' : 'bg-amber-50 hover:bg-amber-100 text-amber-600 dark:bg-amber-950 dark:text-amber-300'}`}>
              <Clock className="w-3 h-3" />Rishikim <span className="tabular-nums">{taskStats.review}</span>
            </button>
            <button onClick={() => setFilterStatus('Done')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                filterStatus === 'Done' ? 'bg-emerald-500 text-white' : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-300'}`}>
              <CheckCircle2 className="w-3 h-3" />Përfunduar <span className="tabular-nums">{taskStats.done}</span>
            </button>
            {taskStats.overdue > 0 && (
              <button onClick={() => setFilterStatus('overdue')}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                  filterStatus === 'overdue' ? 'bg-red-500 text-white' : 'bg-red-50 hover:bg-red-100 text-red-600 dark:bg-red-950 dark:text-red-300'}`}>
                <AlertTriangle className="w-3 h-3" />Vonuar <span className="tabular-nums">{taskStats.overdue}</span>
              </button>
            )}
          </div>
          {/* Assignee filter — applies to every view (list, board, calendar, timeline) */}
          <div className="flex items-center gap-2 mt-2">
            <User className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
            <Select value={filterAssignee} onValueChange={setFilterAssignee}>
              <SelectTrigger className="h-8 text-xs w-full sm:w-[240px]">
                <SelectValue placeholder="Filtro sipas personit" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Të gjithë personat</SelectItem>
                <SelectItem value="unassigned">Pa caktuar</SelectItem>
                {assigneeOptions.map((m: any) => (
                  <SelectItem key={m.userId} value={m.userId}>
                    {m.label}{m.email ? ` · ${m.email}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {filterAssignee !== 'all' && (
              <button
                onClick={() => setFilterAssignee('all')}
                className="text-xs text-muted-foreground hover:text-foreground underline whitespace-nowrap"
              >
                Pastro
              </button>
            )}
          </div>
        </div>

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

        {/* Search Bar */}
        <div className="px-4 py-2 border-b bg-muted/30">
          <div className="relative">
            <input
              type="text"
              placeholder="Kërko detyra..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full h-8 pl-8 pr-3 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
            <svg className="w-4 h-4 absolute left-2.5 top-2 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            {searchQuery && (
              <button 
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-2 text-muted-foreground hover:text-foreground"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Task List Content */}
        <div className="flex-1 overflow-y-auto">
          {viewMode === 'list' && groupBy === 'none' && (
            <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
              <SortableContext items={visibleTasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
                <div className="divide-y">
                  {visibleTasks.map((task) => (
                    <SortableListItem key={task.id} id={task.id}>
                      {renderTaskRow(task)}
                    </SortableListItem>
                  ))}

                  {tasks.length === 0 && (
                    <div className="text-center py-12 text-muted-foreground">
                      <p>Asnjë detyrë</p>
                      <Button variant="link" className="mt-2" onClick={() => setIsCreateDialogOpen(true)}>
                        Krijo detyrën e parë
                      </Button>
                    </div>
                  )}
                </div>
              </SortableContext>
              <DragOverlay>
                {activeTaskId && viewMode === 'list' ? (
                  <div className="flex items-center gap-3 px-4 py-3 bg-background border shadow-xl rounded-md opacity-95">
                    <div className="w-4 h-4 rounded-full bg-muted-foreground/20" />
                    <span className="text-sm font-medium">{tasks.find(t => t.id === activeTaskId)?.title}</span>
                  </div>
                ) : null}
              </DragOverlay>
            </DndContext>
          )}

          {viewMode === 'list' && groupBy !== 'none' && (
            <div>
              {taskGroups.map(group => (
                <div key={group.key}>
                  <div className="sticky top-0 z-[1] flex items-center gap-2 px-4 py-1.5 bg-muted/60 backdrop-blur border-b">
                    <ChevronDown className="w-3 h-3 text-muted-foreground" />
                    <span className="text-xs font-semibold text-foreground">{group.label}</span>
                    <span className="text-xs text-muted-foreground">{group.tasks.length}</span>
                  </div>
                  <div className="divide-y">
                    {group.tasks.map(task => (
                      <div key={task.id}>{renderTaskRow(task)}</div>
                    ))}
                  </div>
                </div>
              ))}
              {tasks.length === 0 && (
                <div className="text-center py-12 text-muted-foreground">
                  <p>Asnjë detyrë</p>
                </div>
              )}
            </div>
          )}

          {/* Bulk action bar (floating) */}
          {selectedIds.size > 0 && (
            <div className="fixed bottom-20 sm:bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-3 py-2 rounded-xl bg-card border shadow-lg flex-wrap max-w-[95vw]">
              <span className="text-sm font-medium px-1">{selectedIds.size} të zgjedhura</span>
              <Select onValueChange={(v) => bulkUpdate({ status: v as any })}>
                <SelectTrigger className="h-8 w-[120px] text-xs"><SelectValue placeholder="Statusi" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Todo">Për të bërë</SelectItem>
                  <SelectItem value="In Progress">Në progres</SelectItem>
                  <SelectItem value="Review">Rishikim</SelectItem>
                  <SelectItem value="Done">Përfunduar</SelectItem>
                </SelectContent>
              </Select>
              <Select onValueChange={(v) => bulkUpdate({ priority: v as any })}>
                <SelectTrigger className="h-8 w-[110px] text-xs"><SelectValue placeholder="Prioriteti" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">I ulët</SelectItem>
                  <SelectItem value="medium">Mesatar</SelectItem>
                  <SelectItem value="high">I lartë</SelectItem>
                  <SelectItem value="urgent">Urgjent</SelectItem>
                </SelectContent>
              </Select>
              {permissions.canAssignTasks && (
                <Select onValueChange={(v) => bulkUpdate({ assignedToUserId: v })}>
                  <SelectTrigger className="h-8 w-[120px] text-xs"><SelectValue placeholder="Cakto te" /></SelectTrigger>
                  <SelectContent>
                    {(teamMembers || []).filter((m: any) => !businessId || !m.businessId || m.businessId === businessId).map((m: any) => (
                      <SelectItem key={m.userId} value={m.userId}>{getUserName(m.userId)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Button variant="destructive" size="sm" className="h-8" onClick={bulkDelete}><Trash2 className="w-3.5 h-3.5 mr-1" />Fshi</Button>
              <Button variant="ghost" size="sm" className="h-8 px-2" onClick={clearSelection}><X className="w-4 h-4" /></Button>
            </div>
          )}

          {viewMode === 'board' && (
            <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
              <div className="flex gap-3 sm:gap-4 p-3 sm:p-4 h-full overflow-x-auto pb-4">
                {columns.map((column) => {
                  const columnTasks = sortByOrder(tasks.filter(task => task.status === column.status));
                  const columnColor = column.status === 'Todo' ? 'bg-gray-400' : column.status === 'In Progress' ? 'bg-blue-500' : column.status === 'Review' ? 'bg-amber-500' : 'bg-emerald-500';
                  
                  return (
                    <KanbanColumn key={column.id} id={column.status}>
                      <div className="flex items-center gap-2 mb-3">
                        <div className={`w-2 h-2 rounded-full ${columnColor}`} />
                        <h3 className="text-sm font-medium text-foreground">{column.title}</h3>
                        <Badge variant="secondary" className="text-xs ml-auto">
                          {columnTasks.length}
                        </Badge>
                      </div>

                      <SortableContext items={columnTasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
                        <div className="space-y-2 flex-1 overflow-y-auto min-h-[60px]">
                          {columnTasks.map((task) => {
                            const dateInfo = formatDateCompact(new Date(task.endDate));
                            const isOverdue = isOverdueDate(task.endDate) && task.status !== 'Done';
                            const isBlocked = blockedTaskIds.has(task.id);
                            const projectName = getProjectName(task.projectId);
                            const subtaskInfo = subtaskCounts[task.id];
                            const isBeingWorkedOn = tasksBeingWorkedOn.has(task.id);
                            const priorityBorder = task.priority === 'urgent' ? 'border-l-red-500' : task.priority === 'high' ? 'border-l-orange-500' : task.priority === 'medium' ? 'border-l-blue-400' : 'border-l-gray-300';

                            return (
                              <SortableTaskCard key={task.id} id={task.id}>
                                <Card
                                  className={`p-3 cursor-grab active:cursor-grabbing hover:shadow-md transition-all border-l-[3px] ${priorityBorder} ${
                                    selectedTask?.id === task.id ? 'ring-2 ring-primary shadow-md' : ''
                                  } ${isOverdue ? 'bg-error/5' : ''}`}
                                  onClick={() => setSelectedTask(task)}
                                >
                                  {/* Title + Working / Blocked indicator */}
                                  <div className="flex items-start justify-between gap-2 mb-2">
                                    <p className={`text-sm font-medium leading-snug ${task.status === 'Done' ? 'line-through text-muted-foreground' : ''}`}>
                                      {task.title}
                                    </p>
                                    <div className="flex items-center gap-1 flex-shrink-0 mt-0.5">
                                      {isBeingWorkedOn && (
                                        <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
                                      )}
                                      {isBlocked && (
                                        <span className="text-[9px] text-orange-600 bg-orange-50 dark:bg-orange-950 px-1 py-0.5 rounded-full border border-orange-200 dark:border-orange-800">🔒</span>
                                      )}
                                    </div>
                                  </div>

                                  {/* Project badge */}
                                  {projectName && (
                                    <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded mb-2">
                                      <Target className="w-2.5 h-2.5" />
                                      {projectName}
                                    </span>
                                  )}

                                  {/* Subtask progress bar */}
                                  {subtaskInfo && (
                                    <div className="mb-2">
                                      <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-0.5">
                                        <span className="flex items-center gap-1">
                                          <ListChecks className="w-2.5 h-2.5" />
                                          Nën-detyra
                                        </span>
                                        <span>{subtaskInfo.done}/{subtaskInfo.total}</span>
                                      </div>
                                      <div className="h-1 bg-muted rounded-full overflow-hidden">
                                        <div 
                                          className="h-full bg-primary rounded-full transition-all"
                                          style={{ width: `${subtaskInfo.total > 0 ? (subtaskInfo.done / subtaskInfo.total) * 100 : 0}%` }}
                                        />
                                      </div>
                                    </div>
                                  )}

                                  {/* Footer: Assignee + Date */}
                                  <div className="flex items-center justify-between mt-2 pt-2 border-t border-border/50">
                                    <div className="flex items-center gap-1.5">
                                      <div className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center text-[9px] font-semibold text-primary">
                                        {getUserName(task.assignedToUserId).slice(0, 2).toUpperCase()}
                                      </div>
                                      <span className="text-xs text-muted-foreground max-w-[80px] truncate">
                                        {getUserName(task.assignedToUserId)}
                                      </span>
                                    </div>
                                    <span className={`text-[11px] ${dateInfo.className}`}>
                                      {dateInfo.text}
                                    </span>
                                  </div>
                                </Card>
                              </SortableTaskCard>
                            );
                          })}
                        </div>
                      </SortableContext>
                    </KanbanColumn>
                  );
                })}
              </div>
              <DragOverlay>
                {activeTaskId ? (
                  <Card className="p-3 shadow-xl rotate-2 opacity-90 border-l-[3px] border-l-primary">
                    <p className="text-sm font-medium">{tasks.find(t => t.id === activeTaskId)?.title}</p>
                  </Card>
                ) : null}
              </DragOverlay>
            </DndContext>
          )}

          {viewMode === 'timeline' && (
            <TaskTimeline tasks={tasks} onTaskClick={setSelectedTask} />
          )}

          {viewMode === 'calendar' && (
            <CalendarView tasks={tasks} onTaskClick={setSelectedTask} />
          )}
        </div>

        {/* Persistent pagination footer (list view) — always visible, below the scroll area */}
        {viewMode === 'list' && (
          <PaginationBar
            page={page}
            totalPages={totalPages}
            totalItems={orderedTasks.length}
            pageSize={PAGE_SIZE}
            onPage={setPage}
          />
        )}
      </div>

      {/* Right Side - Task Detail Panel */}
      {selectedTask && (
        <div className={`
          fixed bottom-0 left-0 right-0 z-50 rounded-t-2xl
          sm:fixed sm:inset-0 sm:rounded-none sm:pt-[72px]
          lg:relative lg:inset-auto lg:z-auto lg:rounded-none lg:pt-0
          bg-background
          ${panelExpanded ? 'lg:flex-1' : 'lg:w-1/2'}
          h-[80dvh] sm:h-full
          max-h-[100dvh] overflow-y-auto flex flex-col
          shadow-2xl lg:shadow-none border-t lg:border-t-0 lg:border-l
        `}>
          <TaskDetailPanel
            task={selectedTask}
            onClose={() => { setSelectedTask(null); setPanelExpanded(false); }}
            onExpand={() => setPanelExpanded(p => !p)}
            isExpanded={panelExpanded}
            comments={comments?.filter(c => c.taskId === selectedTask.id) || []}
            onAddComment={handleAddComment}
            onUpdate={taskMutation.update}
            onDelete={taskMutation.remove}
            projects={projects}
            projectsLoading={projectsLoading}
            allTasks={allTasks || []}
            onSelectSubtask={(subtask) => setSelectedTask(subtask)}
          />
        </div>
      )}

      {/* Delete confirmation modal */}
      <Dialog open={!!deleteConfirmId} onOpenChange={(open) => { if (!open) setDeleteConfirmId(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Fshi Detyrën</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            A jeni i sigurt që doni të fshini këtë detyrë? Ky veprim nuk mund të zhbëhet.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setDeleteConfirmId(null)}>Anulo</Button>
            <Button variant="destructive" onClick={async () => {
              if (deleteConfirmId) {
                await taskMutation.remove(deleteConfirmId);
                if (selectedTask?.id === deleteConfirmId) setSelectedTask(null);
                toast({ title: 'Detyra u fshi' });
              }
              setDeleteConfirmId(null);
            }}>Fshi, jam i sigurt</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

// Task Form Component
const TaskForm: React.FC<{
  onSubmit: (data: FormData) => void;
  projects: Project[];
  initialData?: Task;
  allTasks?: Task[];
  teamMembers?: any[];
  canAssignTasks?: boolean;
  currentUserId?: string;
  allLabels?: string[];
}> = ({ onSubmit, projects, initialData, allTasks = [], teamMembers = [], canAssignTasks = false, currentUserId = '', allLabels = [] }) => {
  const [labels, setLabels] = useState<string[]>((initialData as any)?.labels || []);
  const [startDate, setStartDate] = useState<Date | undefined>(
    initialData?.startDate ? new Date(initialData.startDate) : new Date()
  );
  const [endDate, setEndDate] = useState<Date | undefined>(
    // Default to the same day as start — many tasks are done within a day. Extend if needed.
    initialData?.endDate ? new Date(initialData.endDate) : new Date()
  );
  const [status, setStatus] = useState(initialData?.status || 'Todo');
  const [descriptionHtml, setDescriptionHtml] = useState(initialData?.description || '');
  const [priority, setPriority] = useState(initialData?.priority || 'medium');
  const [projectId, setProjectId] = useState(initialData?.projectId || '__none__');
  const [isRecurring, setIsRecurring] = useState(initialData?.isRecurring || false);
  const [recurringFrequency, setRecurringFrequency] = useState(initialData?.recurringFrequency || 'weekly');
  const [recurringDayOfWeek, setRecurringDayOfWeek] = useState<number>(
    (initialData as any)?.recurringDayOfWeek ?? 1
  );
  const [recurringDayOfMonth, setRecurringDayOfMonth] = useState<number>(
    (initialData as any)?.recurringDayOfMonth ?? 1
  );
  // For daily recurrence: which days of the week (default Mon-Fri)
  const [recurringDaysOfWeek, setRecurringDaysOfWeek] = useState<number[]>(
    (initialData as any)?.recurringDaysOfWeek ?? [1, 2, 3, 4, 5]
  );
  const toggleDayOfWeek = (day: number) => {
    setRecurringDaysOfWeek(prev =>
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day].sort((a, b) => a - b)
    );
  };
  const [dependsOn, setDependsOn] = useState<string[]>(initialData?.dependsOn || []);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    
    if (startDate) {
      formData.set('startDate', startDate.toISOString());
    }
    if (endDate) {
      formData.set('endDate', endDate.toISOString());
    }
    
    formData.set('status', status);
    formData.set('priority', priority);
    const cleanDesc = descriptionHtml === '<p></p>' ? '' : descriptionHtml;
    formData.set('description', cleanDesc);
    
    if (projectId && projectId !== '__none__') {
      formData.set('projectId', projectId);
    }
    
    if (dependsOn.length > 0) {
      formData.set('dependsOn', JSON.stringify(dependsOn));
    }
    onSubmit(formData);
  };

  // Date+time helpers so a task can be scheduled within a single day (e.g. 09:00–11:00).
  const timeStr = (d?: Date) => d ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : '';
  const pickDateKeepTime = (setter: (d?: Date) => void, prev?: Date) => (d?: Date) => {
    if (!d) { setter(undefined); return; }
    const nd = new Date(d);
    if (prev) nd.setHours(prev.getHours(), prev.getMinutes(), 0, 0);
    else nd.setHours(9, 0, 0, 0);
    setter(nd);
  };
  const setTimeOnDate = (setter: (d?: Date) => void, prev?: Date) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const [h, m] = e.target.value.split(':').map(Number);
    const nd = prev ? new Date(prev) : new Date();
    nd.setHours(h || 0, m || 0, 0, 0);
    setter(nd);
  };

  const availableTasks = allTasks.filter(t => t.id !== initialData?.id);

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <Label htmlFor="title">Titulli</Label>
        <Input id="title" name="title" required defaultValue={initialData?.title} placeholder="Emri i detyrës" />
      </div>

      <div>
        <Label htmlFor="description">Përshkrimi</Label>
        <RichTextEditor
          content={descriptionHtml}
          onChange={setDescriptionHtml}
          placeholder="Përshkruaj detyrën..."
          minHeight="100px"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label>Data/ora e fillimit</Label>
          <div className="flex gap-2">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="flex-1 justify-start text-sm" type="button">
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {startDate ? startDate.toLocaleDateString() : "Zgjidh"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="single" selected={startDate} onSelect={pickDateKeepTime(setStartDate, startDate)} initialFocus />
              </PopoverContent>
            </Popover>
            <Input type="time" value={timeStr(startDate)} onChange={setTimeOnDate(setStartDate, startDate)} className="w-[110px] text-sm" />
          </div>
        </div>

        <div>
          <Label>Data/ora e afatit</Label>
          <div className="flex gap-2">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="flex-1 justify-start text-sm" type="button">
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {endDate ? endDate.toLocaleDateString() : "Zgjidh"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="single" selected={endDate} onSelect={pickDateKeepTime(setEndDate, endDate)} initialFocus />
              </PopoverContent>
            </Popover>
            <Input type="time" value={timeStr(endDate)} onChange={setTimeOnDate(setEndDate, endDate)} className="w-[110px] text-sm" />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label htmlFor="status">Statusi</Label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Todo">Për të bërë</SelectItem>
              <SelectItem value="In Progress">Në progres</SelectItem>
              <SelectItem value="Review">Rishikim</SelectItem>
              <SelectItem value="Done">Përfunduar</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label htmlFor="priority">Prioriteti</Label>
          <Select value={priority} onValueChange={setPriority}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="low">I ulët</SelectItem>
              <SelectItem value="medium">Mesatar</SelectItem>
              <SelectItem value="high">I lartë</SelectItem>
              <SelectItem value="urgent">Urgjent</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div>
        <Label>Etiketat</Label>
        <input type="hidden" name="labels" value={JSON.stringify(labels)} />
        <LabelEditor value={labels} onChange={setLabels} suggestions={allLabels} />
      </div>

      <div>
        <Label htmlFor="assignedToUserId">Cakto te</Label>
        {canAssignTasks ? (
          <Select name="assignedToUserId" defaultValue={initialData?.assignedToUserId || currentUserId}>
            <SelectTrigger id="assignedToUserId">
              <SelectValue placeholder="Zgjidh anëtarin" />
            </SelectTrigger>
            <SelectContent>
              {teamMembers.map((m: any) => (
                <SelectItem key={m.userId} value={m.userId}>
                  {m.displayName || m.email?.split('@')[0] || m.userId}
                  {m.userId === currentUserId ? ' (ti)' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <>
            <input type="hidden" name="assignedToUserId" value={currentUserId} />
            <div className="flex items-center h-9 px-3 rounded-md border bg-muted text-sm text-muted-foreground">
              {teamMembers.find((m: any) => m.userId === currentUserId)?.displayName ||
               teamMembers.find((m: any) => m.userId === currentUserId)?.email?.split('@')[0] ||
               'Ti'} <span className="ml-1 text-xs">(vetëm ti)</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">Vetëm Admin/Manager mund të caktojnë te anëtarë të tjerë.</p>
          </>
        )}
      </div>

      <div>
        <Label htmlFor="projectId">Projekti (Opsional)</Label>
        <Select value={projectId} onValueChange={setProjectId}>
          <SelectTrigger>
            <SelectValue placeholder="Zgjidh projektin" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">Asnjë</SelectItem>
            {projects.map(p => (
              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-4 border-t pt-4">
        <div>
          <Label htmlFor="estimatedHours">Orë të Vlerësuara</Label>
          <Input id="estimatedHours" name="estimatedHours" type="number" step="0.5" min="0" placeholder="p.sh. 4" defaultValue={(initialData as any)?.estimatedHours || ''} />
        </div>
        <div className="flex items-center gap-2">
          <Checkbox 
            id="isRecurring" 
            checked={isRecurring}
            onCheckedChange={(checked) => setIsRecurring(checked as boolean)}
          />
          <Label htmlFor="isRecurring" className="cursor-pointer text-sm">
            Detyrë e përsëritur
          </Label>
        </div>

        {isRecurring && (
          <div className="space-y-3 pl-6 border-l-2 border-primary/20">
            <div>
              <Label htmlFor="recurringFrequency">Frekuenca</Label>
              <Select value={recurringFrequency} onValueChange={setRecurringFrequency}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Çdo ditë</SelectItem>
                  <SelectItem value="weekly">Çdo javë</SelectItem>
                  <SelectItem value="monthly">Çdo muaj</SelectItem>
                  <SelectItem value="yearly">Çdo vit</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {recurringFrequency === 'daily' && (
              <div>
                <Label>Ditët e javës</Label>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {[
                    { value: 1, label: 'Hën' },
                    { value: 2, label: 'Mar' },
                    { value: 3, label: 'Mër' },
                    { value: 4, label: 'Enj' },
                    { value: 5, label: 'Pre' },
                    { value: 6, label: 'Sht' },
                    { value: 0, label: 'Die' },
                  ].map(day => (
                    <button
                      key={day.value}
                      type="button"
                      onClick={() => toggleDayOfWeek(day.value)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${
                        recurringDaysOfWeek.includes(day.value)
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'bg-background text-foreground border-border hover:bg-muted'
                      }`}
                    >
                      {day.label}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground mt-1.5">
                  {recurringDaysOfWeek.length === 0 ? 'Zgjidh të paktën një ditë' : `${recurringDaysOfWeek.length} ditë të zgjedhura`}
                </p>
              </div>
            )}

            {recurringFrequency === 'weekly' && (
              <div>
                <Label>Dita e javës</Label>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {[
                    { value: 1, label: 'Hën' },
                    { value: 2, label: 'Mar' },
                    { value: 3, label: 'Mër' },
                    { value: 4, label: 'Enj' },
                    { value: 5, label: 'Pre' },
                    { value: 6, label: 'Sht' },
                    { value: 0, label: 'Diel' },
                  ].map(day => (
                    <button
                      key={day.value}
                      type="button"
                      onClick={() => setRecurringDayOfWeek(day.value)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${
                        recurringDayOfWeek === day.value
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'bg-background text-foreground border-border hover:bg-muted'
                      }`}
                    >
                      {day.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {recurringFrequency === 'monthly' && (
              <div>
                <Label>Dita e muajit</Label>
                <Select value={String(recurringDayOfMonth)} onValueChange={(v) => setRecurringDayOfMonth(Number(v))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 31 }, (_, i) => i + 1).map(d => (
                      <SelectItem key={d} value={String(d)}>
                        {d}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <input type="hidden" name="isRecurring" value={isRecurring.toString()} />
            <input type="hidden" name="recurringFrequency" value={recurringFrequency} />
            <input type="hidden" name="recurringDayOfWeek" value={String(recurringDayOfWeek)} />
            <input type="hidden" name="recurringDayOfMonth" value={String(recurringDayOfMonth)} />
            {recurringFrequency === 'daily' && (
              <input type="hidden" name="recurringDaysOfWeek" value={JSON.stringify(recurringDaysOfWeek)} />
            )}
          </div>
        )}
      </div>

      {/* Task Dependencies */}
      {availableTasks.length > 0 && (
        <div>
          <Label>Varet nga (detyra paraprake)</Label>
          <div className="max-h-32 overflow-y-auto border rounded-md p-2 space-y-1 mt-1">
            {availableTasks.map(t => (
              <label key={t.id} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted/50 rounded px-1 py-0.5">
                <Checkbox
                  checked={dependsOn.includes(t.id)}
                  onCheckedChange={(checked) => {
                    setDependsOn(prev => checked ? [...prev, t.id] : prev.filter(id => id !== t.id));
                  }}
                />
                <span className="truncate">{t.title}</span>
                <Badge variant="outline" className="text-[10px] ml-auto flex-shrink-0">{t.status}</Badge>
              </label>
            ))}
          </div>
          {dependsOn.length > 0 && (
            <p className="text-xs text-muted-foreground mt-1">{dependsOn.length} varësi të zgjedhura</p>
          )}
        </div>
      )}

      <Button type="submit" className="w-full">
        {initialData ? 'Ruaj Ndryshimet' : 'Krijo Detyrën'}
      </Button>
    </form>
  );
};

// Calendar View Component
const CalendarView: React.FC<{
  tasks: Task[];
  onTaskClick: (task: Task) => void;
}> = ({ tasks, onTaskClick }) => {
  const [currentDate, setCurrentDate] = useState(new Date());

  const daysInMonth = new Date(
    currentDate.getFullYear(),
    currentDate.getMonth() + 1,
    0
  ).getDate();

  // Monday-first week (Albanian convention): convert JS getDay() (0=Sun..6=Sat)
  // to a Monday-based index (Mon=0..Sun=6).
  const firstDay = (new Date(
    currentDate.getFullYear(),
    currentDate.getMonth(),
    1
  ).getDay() + 6) % 7;

  const sod = (x: Date) => { const n = new Date(x); n.setHours(0, 0, 0, 0); return n.getTime(); };
  const todayStr = new Date().toDateString();

  // Projected recurring occurrences for the displayed month. Recurring tasks
  // materialise one cycle at a time (only when the current one is completed), so
  // future cycles have no doc yet and wouldn't otherwise appear on the calendar.
  // Here we project the "tip" of each series (nextCycleCreated !== true) forward
  // from its endDate using the same recurrence rule and show those dates as
  // lightweight ghosts — so e.g. a monthly task is visible in July before it's
  // generated. Clicking opens the source task.
  const monthStart = sod(new Date(currentDate.getFullYear(), currentDate.getMonth(), 1));
  const monthEnd = sod(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0));
  const projectionsByDay = React.useMemo(() => {
    const map = new Map<number, Task[]>();
    tasks.forEach((task) => {
      const t = task as any;
      if (!t.isRecurring || !t.recurringFrequency || t.nextCycleCreated === true || !task.endDate) return;
      let d = new Date(task.endDate);
      let guard = 0;
      while (guard++ < 500) {
        d = addFrequency(d, t.recurringFrequency, t.recurringDayOfWeek, t.recurringDayOfMonth, t.recurringInterval, t.recurringDaysOfWeek);
        const ds = sod(d);
        if (ds > monthEnd) break;
        if (ds >= monthStart) {
          const dayNum = new Date(ds).getDate();
          if (!map.has(dayNum)) map.set(dayNum, []);
          map.get(dayNum)!.push(task);
        }
      }
    });
    return map;
  }, [tasks, monthStart, monthEnd]);

  const days = [];
  for (let i = 0; i < firstDay; i++) {
    days.push(<div key={`empty-${i}`} className="min-h-[80px] bg-muted/20" />);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(currentDate.getFullYear(), currentDate.getMonth(), day);
    const cell = sod(date);
    // A recurring task is a single-day occurrence on its due date (the "afat") —
    // the frequency, not a multi-day span, drives repetition. A non-recurring task
    // may span [startDate, endDate], capped so an over-long span doesn't paint
    // every single day (it then collapses to the due date).
    const SPAN_CAP_DAYS = 14;
    const dayTasks = tasks.filter(task => {
      if (!task.endDate) return false;
      const end = sod(new Date(task.endDate));
      let start = task.startDate ? sod(new Date(task.startDate)) : end;
      if ((task as any).isRecurring) start = end;
      else if (Math.abs(end - start) / 86400000 > SPAN_CAP_DAYS) start = end;
      return cell >= Math.min(start, end) && cell <= Math.max(start, end);
    });
    const isToday = date.toDateString() === todayStr;
    // Projected recurring occurrences for this day (not real docs yet).
    const dayProjections = projectionsByDay.get(day) || [];
    const realShown = dayTasks.slice(0, 2);
    const projShown = dayProjections.slice(0, Math.max(0, 2 - realShown.length));
    const overflow = (dayTasks.length + dayProjections.length) - realShown.length - projShown.length;

    days.push(
      <div key={day} className={`min-h-[50px] sm:min-h-[80px] border p-0.5 sm:p-1 ${isToday ? 'border-primary border-2 bg-primary/5' : 'border-border bg-background'}`}>
        <div className={`font-medium text-[10px] sm:text-xs mb-0.5 sm:mb-1 ${isToday ? 'text-primary font-bold' : 'text-muted-foreground'}`}>
          {day}
        </div>
        <div className="space-y-0.5 sm:space-y-1">
          {realShown.map(task => (
            <div
              key={task.id}
              className="text-[10px] sm:text-xs p-0.5 sm:p-1 bg-primary/10 rounded cursor-pointer hover:bg-primary/20 truncate"
              onClick={() => onTaskClick(task)}
            >
              {task.title}
            </div>
          ))}
          {projShown.map((task, i) => (
            <div
              key={`proj-${task.id}-${i}`}
              className="text-[10px] sm:text-xs p-0.5 sm:p-1 rounded cursor-pointer truncate border border-dashed border-violet-300 text-violet-600 dark:text-violet-300 dark:border-violet-700 bg-violet-50/50 dark:bg-violet-950/30 hover:bg-violet-100 dark:hover:bg-violet-900/40 italic"
              title={`Përsëritet — ${task.title}`}
              onClick={() => onTaskClick(task)}
            >
              🔄 {task.title}
            </div>
          ))}
          {overflow > 0 && (
            <div className="text-[10px] sm:text-xs text-muted-foreground">
              +{overflow}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="p-2 sm:p-4 space-y-3 sm:space-y-4">
      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1))}
        >
          Para
        </Button>
        <h2 className="text-xs sm:text-sm font-medium">
          {currentDate.toLocaleDateString('sq-AL', { month: 'long', year: 'numeric' })}
        </h2>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1))}
        >
          Pas
        </Button>
      </div>
      <div className="grid grid-cols-7 gap-px bg-border">
        {['Hë', 'Ma', 'Më', 'En', 'Pr', 'Sh', 'Di'].map(day => (
          <div key={day} className="bg-muted p-0.5 sm:p-1 text-center text-[10px] sm:text-xs font-medium">
            {day}
          </div>
        ))}
        {days}
      </div>
    </div>
  );
};

// Numbered pagination footer (Prev / "Faqja x / y" / Next). Hidden when single page.
const PaginationBar: React.FC<{
  page: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  onPage: (p: number) => void;
}> = ({ page, totalPages, totalItems, pageSize, onPage }) => {
  if (totalPages <= 1) return null;
  const from = page * pageSize + 1;
  const to = Math.min((page + 1) * pageSize, totalItems);
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-t bg-background shrink-0">
      <span className="text-xs text-muted-foreground tabular-nums">
        {from}–{to} nga {totalItems}
      </span>
      <div className="flex items-center gap-1">
        <Button variant="outline" size="sm" disabled={page === 0} onClick={() => onPage(page - 1)}>
          <ChevronLeft className="w-4 h-4 sm:mr-1" />
          <span className="hidden sm:inline">Para</span>
        </Button>
        <span className="text-xs text-muted-foreground px-2 tabular-nums whitespace-nowrap">
          Faqja {page + 1} / {totalPages}
        </span>
        <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => onPage(page + 1)}>
          <span className="hidden sm:inline">Pas</span>
          <ChevronRight className="w-4 h-4 sm:ml-1" />
        </Button>
      </div>
    </div>
  );
};

// --- @dnd-kit helper components ---
import { useDroppable } from '@dnd-kit/core';

function KanbanColumn({ id, children }: { id: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col min-w-[260px] sm:min-w-[300px] flex-shrink-0 transition-colors rounded-lg p-1 ${isOver ? 'bg-primary/5 ring-1 ring-primary/30' : ''}`}
    >
      {children}
    </div>
  );
}

function SortableTaskCard({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 };
  return <div ref={setNodeRef} style={style} {...attributes} {...listeners}>{children}</div>;
}

function SortableListItem({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1, zIndex: isDragging ? 50 : undefined };
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      {children}
    </div>
  );
}

export default TasksView;
