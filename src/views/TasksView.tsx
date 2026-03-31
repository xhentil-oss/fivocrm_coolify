import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DndContext, DragOverlay, closestCorners, PointerSensor, useSensor, useSensors, type DragStartEvent, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useCollection, useMutation } from '../hooks/useFirestore';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../contexts/PermissionsContext';
import { Calendar as CalendarIcon, User, Flag, MoreVertical, Plus, MessageSquare, CalendarDays, Filter, List, LayoutGrid, Users, ChevronRight, ChevronDown, Target, Clock, Play, Pause, Square, Check, X, AlertCircle, CheckCircle2, CircleDot, ListChecks } from 'lucide-react';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import { useActivityLogger } from '../hooks/useActivityLogger';
import { useFilteredTasks } from '../hooks/useRoleFilteredData';
import type { Task, TaskComment, Project, Notification, TaskCollaborator, UserProfile, TimeEntry, Customer, Invoice } from '../types';
import TaskDetailPanel from '../components/TaskDetailPanel';
import SmartSuggestions from '../components/SmartSuggestions';

const TasksView: React.FC = () => {
  const { user } = useAuth();
  const permissions = usePermissions();
  const logActivity = useActivityLogger();
  const [viewMode, setViewMode] = useState<'board' | 'calendar' | 'list'>('list');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  // Fetch data — skipTeamFilter to avoid dependency on globalTeamId timing.
  // Team filtering is handled client-side below using permissions.teamId.
  const { data: rawTasks, loading: tasksLoading } = useCollection<Task>('tasks', {
    orderBy: { field: 'createdAt', direction: 'desc' },
    skipTeamFilter: true,
  });
  // Role-based filtering: Member/Viewer see only assigned tasks
  const allTasks = useFilteredTasks(
    // Client-side team filtering: show only tasks for this team (or legacy tasks without teamId)
    useMemo(() => {
      if (!rawTasks || !permissions.teamId) return rawTasks || [];
      return rawTasks.filter(t => (t as any).teamId === permissions.teamId || !(t as any).teamId);
    }, [rawTasks, permissions.teamId])
  );
  const { data: projects } = useCollection<Project>('projects');
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
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(t =>
        t.title.toLowerCase().includes(query) ||
        t.description?.toLowerCase().includes(query)
      );
    }
    return filtered;
  }, [allTasks, searchQuery]);

  // Final tasks list: additionally filtered by status for the displayed list
  const tasks = React.useMemo(() => {
    if (filterStatus === 'all') return baseTasksForStats;
    return baseTasksForStats.filter(t => t.status === filterStatus);
  }, [baseTasksForStats, filterStatus]);

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
      overdue: baseTasksForStats.filter(t => new Date(t.endDate) < now && t.status !== 'Done').length,
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

  const getPriorityColor = (priority?: string) => {
    switch (priority) {
      case 'urgent':
        return 'bg-error text-error-foreground';
      case 'high':
        return 'bg-warning text-warning-foreground';
      case 'medium':
        return 'bg-info text-info-foreground';
      case 'low':
        return 'bg-success text-success-foreground';
      default:
        return 'bg-muted text-muted-foreground';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Todo':
        return 'bg-gray-200 text-gray-700';
      case 'In Progress':
        return 'bg-tertiary text-tertiary-foreground';
      case 'Review':
        return 'bg-warning text-warning-foreground';
      case 'Done':
        return 'bg-success text-success-foreground';
      default:
        return 'bg-muted text-muted-foreground';
    }
  };

  const handleCreateTask = async (formData: FormData) => {
    const title = formData.get('title') as string;
    const description = formData.get('description') as string;
    const startDate = new Date(formData.get('startDate') as string);
    const endDate = new Date(formData.get('endDate') as string);
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
    const estimatedHoursRaw = formData.get('estimatedHours') as string;
    const dependsOnRaw = formData.get('dependsOn') as string;

    let dependsOn: string[] = [];
    try { dependsOn = dependsOnRaw ? JSON.parse(dependsOnRaw) : []; } catch { dependsOn = []; }
    let collaboratorIds: string[] = [];
    try { collaboratorIds = collaboratorIdsRaw ? JSON.parse(collaboratorIdsRaw) : []; } catch { collaboratorIds = []; }
    const isRecurring = isRecurringRaw === 'true';
    const recurringDayOfWeek = recurringDayOfWeekRaw ? parseInt(recurringDayOfWeekRaw) : undefined;
    const recurringDayOfMonth = recurringDayOfMonthRaw ? parseInt(recurringDayOfMonthRaw) : undefined;

    let nextRecurringDate: Date | undefined;
    if (isRecurring && recurringFrequency) {
      const now = new Date();
      if (recurringFrequency === 'daily') {
        // Next day
        nextRecurringDate = new Date(now);
        nextRecurringDate.setDate(nextRecurringDate.getDate() + 1);
        nextRecurringDate.setHours(9, 0, 0, 0);
      } else if (recurringFrequency === 'weekly' && recurringDayOfWeek !== undefined) {
        // Next occurrence of selected weekday
        nextRecurringDate = new Date(now);
        const currentDay = now.getDay();
        let daysUntil = recurringDayOfWeek - currentDay;
        if (daysUntil <= 0) daysUntil += 7;
        nextRecurringDate.setDate(nextRecurringDate.getDate() + daysUntil);
        nextRecurringDate.setHours(9, 0, 0, 0);
      } else if (recurringFrequency === 'monthly' && recurringDayOfMonth !== undefined) {
        // Next occurrence of selected day of month
        nextRecurringDate = new Date(now.getFullYear(), now.getMonth(), recurringDayOfMonth, 9, 0, 0);
        if (nextRecurringDate <= now) {
          nextRecurringDate.setMonth(nextRecurringDate.getMonth() + 1);
        }
      } else if (recurringFrequency === 'yearly') {
        const baseDate = new Date(endDate);
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
      dueNotificationSent: false,
      isRecurring,
      recurringFrequency: isRecurring ? recurringFrequency : undefined,
      recurringDayOfWeek: isRecurring && recurringFrequency === 'weekly' ? recurringDayOfWeek : undefined,
      recurringDayOfMonth: isRecurring && recurringFrequency === 'monthly' ? recurringDayOfMonth : undefined,
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
          title: 'Detyrë e Re e Caktuar',
          message: `Ju u caktuat te detyra: ${title}`,
          isRead: false,
        })
      );
    }
    for (const collabId of collaboratorIds) {
      if (collabId !== user?.uid) {
        notificationPromises.push(
          notificationMutation.create({
            userId: collabId,
            title: 'U shtuat si bashkëpunëtor',
            message: `U shtuat si bashkëpunëtor te detyra: ${title}`,
            isRead: false,
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

    const task = tasks.find(t => t.id === taskId);
    if (task && task.assignedToUserId !== user?.uid) {
      await notificationMutation.create({
        userId: task.assignedToUserId,
        title: 'Koment i Ri',
        message: `Koment i ri te detyra: ${task.title}`,
        isRead: false,
      });
    }
  };

  // --- @dnd-kit drag-and-drop for kanban ---
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);

  const handleDragStart = (event: DragStartEvent) => {
    setActiveTaskId(String(event.active.id));
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveTaskId(null);
    const { active, over } = event;
    if (!over) return;
    const taskId = String(active.id);
    // "over" can be a column id (status string) or another task card
    const overId = String(over.id);
    const targetStatus = columns.find(c => c.status === overId)?.status
      || columns.find(c => tasks.filter(t => t.status === c.status).some(t => t.id === overId))?.status;
    if (targetStatus) {
      const task = tasks.find(t => t.id === taskId);
      if (task && task.status !== targetStatus) {
        await taskMutation.update(taskId, { status: targetStatus });
      }
    }
  };

  const columns = [
    { id: 'Todo', title: 'Për të bërë', status: 'Todo' },
    { id: 'In Progress', title: 'Në progres', status: 'In Progress' },
    { id: 'Review', title: 'Rishikim', status: 'Review' },
    { id: 'Done', title: 'Përfunduar', status: 'Done' },
  ];

  // Format date compactly
  const formatDateCompact = (date: Date) => {
    if (!date || isNaN(new Date(date).getTime())) {
      return { text: 'Pa afat', className: 'text-muted-foreground' };
    }
    const now = new Date();
    const taskDate = new Date(date);
    const diffDays = Math.ceil((taskDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    
    if (diffDays < 0) {
      return { text: `${Math.abs(diffDays)} ditë më parë`, className: 'text-error' };
    }
    if (diffDays === 0) {
      return { text: 'Sot', className: 'text-warning font-medium' };
    }
    if (diffDays === 1) {
      return { text: 'Nesër', className: 'text-warning' };
    }
    
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return { text: `${months[taskDate.getMonth()]} ${taskDate.getDate()}`, className: 'text-muted-foreground' };
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
      <div className={`${selectedTask ? 'hidden lg:flex lg:flex-col lg:w-1/2 lg:border-r' : 'flex flex-col w-full'} transition-all duration-300`}>
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between p-4 border-b gap-3">
          <div>
            <h1 className="text-lg sm:text-xl font-semibold text-foreground">Detyrat</h1>
            <p className="text-xs sm:text-sm text-muted-foreground">
              {tasks.length} detyra · {myTasks.length} të miat
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as any)}>
              <TabsList className="h-8">
                <TabsTrigger value="list" className="text-xs px-2"><List className="w-3 h-3 sm:mr-1" /><span className="hidden sm:inline">Listë</span></TabsTrigger>
                <TabsTrigger value="board" className="text-xs px-2"><LayoutGrid className="w-3 h-3 sm:mr-1" /><span className="hidden sm:inline">Board</span></TabsTrigger>
                <TabsTrigger value="calendar" className="text-xs px-2"><CalendarDays className="w-3 h-3 sm:mr-1" /><span className="hidden sm:inline">Kalendar</span></TabsTrigger>
              </TabsList>
            </Tabs>

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
                  <TaskForm onSubmit={handleCreateTask} projects={projects || []} allTasks={tasks} />
                </DialogContent>
              </Dialog>
            )}
          </div>
        </div>

        {/* Stats Bar */}
        <div className="px-4 py-2 border-b bg-muted/20 flex items-center gap-2 overflow-x-auto">
          <button
            onClick={() => setFilterStatus('all')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors whitespace-nowrap ${
              filterStatus === 'all' ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80 text-muted-foreground'
            }`}
          >
            Të gjitha
            <span className="ml-0.5 tabular-nums">{baseTasksForStats.length}</span>
          </button>
          <button
            onClick={() => setFilterStatus('Todo')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors whitespace-nowrap ${
              filterStatus === 'Todo' ? 'bg-gray-500 text-white' : 'bg-gray-100 hover:bg-gray-200 text-gray-600 dark:bg-gray-800 dark:hover:bg-gray-700 dark:text-gray-300'
            }`}
          >
            <CircleDot className="w-3 h-3" />
            Për të bërë
            <span className="ml-0.5 tabular-nums">{taskStats.todo}</span>
          </button>
          <button
            onClick={() => setFilterStatus('In Progress')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors whitespace-nowrap ${
              filterStatus === 'In Progress' ? 'bg-blue-500 text-white' : 'bg-blue-50 hover:bg-blue-100 text-blue-600 dark:bg-blue-950 dark:hover:bg-blue-900 dark:text-blue-300'
            }`}
          >
            <Play className="w-3 h-3" />
            Në progres
            <span className="ml-0.5 tabular-nums">{taskStats.inProgress}</span>
          </button>
          <button
            onClick={() => setFilterStatus('Review')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors whitespace-nowrap ${
              filterStatus === 'Review' ? 'bg-amber-500 text-white' : 'bg-amber-50 hover:bg-amber-100 text-amber-600 dark:bg-amber-950 dark:hover:bg-amber-900 dark:text-amber-300'
            }`}
          >
            <Clock className="w-3 h-3" />
            Rishikim
            <span className="ml-0.5 tabular-nums">{taskStats.review}</span>
          </button>
          <button
            onClick={() => setFilterStatus('Done')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors whitespace-nowrap ${
              filterStatus === 'Done' ? 'bg-emerald-500 text-white' : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-600 dark:bg-emerald-950 dark:hover:bg-emerald-900 dark:text-emerald-300'
            }`}
          >
            <CheckCircle2 className="w-3 h-3" />
            Përfunduar
            <span className="ml-0.5 tabular-nums">{taskStats.done}</span>
          </button>
          {taskStats.overdue > 0 && (
            <button
              onClick={() => setFilterStatus('all')}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-300 whitespace-nowrap"
            >
              <AlertCircle className="w-3 h-3" />
              Vonuar
              <span className="ml-0.5 tabular-nums">{taskStats.overdue}</span>
            </button>
          )}
        </div>

        {/* Smart Suggestions Panel */}
        <SmartSuggestions
          tasks={allTasks || []}
          projects={projects || []}
          customers={customers || []}
          invoices={invoices || []}
          onTaskClick={(task) => setSelectedTask(task)}
          getUserName={getUserName}
        />

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
          {viewMode === 'list' && (
            <div className="divide-y">
              {tasks.map((task) => {
                const dateInfo = formatDateCompact(new Date(task.endDate));
                const isSelected = selectedTask?.id === task.id;
                const isOverdue = new Date(task.endDate) < new Date() && task.status !== 'Done';
                const projectName = getProjectName(task.projectId);
                const subtaskInfo = subtaskCounts[task.id];
                const isBeingWorkedOn = tasksBeingWorkedOn.has(task.id);
                const commentCount = comments?.filter(c => c.taskId === task.id).length || 0;
                
                return (
                  <div
                    key={task.id}
                    className={`group flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors ${
                      isSelected ? 'bg-primary/5 border-l-2 border-l-primary' : ''
                    } ${isOverdue ? 'bg-error/5' : ''}`}
                    onClick={() => setSelectedTask(task)}
                  >
                    <Checkbox 
                      checked={task.status === 'Done'}
                      onCheckedChange={async (checked) => {
                        await taskMutation.update(task.id, { 
                          status: checked ? 'Done' : 'Todo' 
                        });
                        if (checked) {
                          logActivity('task_completed', `Detyrë e përfunduar: ${task.title}`, { entityType: 'task', entityId: task.id });
                        }
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className={`mt-1 ${task.status === 'Done' ? 'bg-success border-success' : ''}`}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`text-sm font-medium ${task.status === 'Done' ? 'line-through text-muted-foreground' : ''}`}>
                          {task.title}
                        </span>
                        {isBeingWorkedOn && (
                          <span className="flex items-center gap-0.5 text-[10px] text-success bg-success/10 px-1.5 py-0.5 rounded-full">
                            <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
                            Duke punuar
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        {/* Priority badge */}
                        {task.priority && (
                          <Badge className={`text-[10px] px-1.5 py-0 h-4 ${getPriorityColor(task.priority)}`}>
                            {task.priority === 'urgent' ? 'Urgjent' : task.priority === 'high' ? 'Lartë' : task.priority === 'medium' ? 'Mesatar' : 'Ulët'}
                          </Badge>
                        )}
                        {/* Project name */}
                        {projectName && (
                          <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded flex items-center gap-1">
                            <Target className="w-2.5 h-2.5" />
                            {projectName}
                          </span>
                        )}
                        {/* Subtask count */}
                        {subtaskInfo && (
                          <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                            <ListChecks className="w-2.5 h-2.5" />
                            {subtaskInfo.done}/{subtaskInfo.total}
                          </span>
                        )}
                        {/* Comment count */}
                        {commentCount > 0 && (
                          <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                            <MessageSquare className="w-2.5 h-2.5" />
                            {commentCount}
                          </span>
                        )}
                      </div>
                    </div>
                    {/* Assignee */}
                    <div className="hidden sm:flex items-center gap-1.5 text-xs text-muted-foreground flex-shrink-0">
                      <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-semibold text-primary">
                        {getUserName(task.assignedToUserId).slice(0, 2).toUpperCase()}
                      </div>
                      <span className="max-w-[80px] truncate">
                        {getUserName(task.assignedToUserId)}
                      </span>
                    </div>
                    <span className={`text-xs whitespace-nowrap flex-shrink-0 mt-0.5 ${dateInfo.className}`}>
                      {dateInfo.text}
                    </span>
                  </div>
                );
              })}
              
              {tasks.length === 0 && (
                <div className="text-center py-12 text-muted-foreground">
                  <p>Asnjë detyrë</p>
                  <Button 
                    variant="link" 
                    className="mt-2"
                    onClick={() => setIsCreateDialogOpen(true)}
                  >
                    Krijo detyrën e parë
                  </Button>
                </div>
              )}
            </div>
          )}

          {viewMode === 'board' && (
            <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
              <div className="flex gap-3 sm:gap-4 p-3 sm:p-4 h-full overflow-x-auto pb-4">
                {columns.map((column) => {
                  const columnTasks = tasks.filter(task => task.status === column.status);
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
                            const isOverdue = new Date(task.endDate) < new Date() && task.status !== 'Done';
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
                                  {/* Title + Working indicator */}
                                  <div className="flex items-start justify-between gap-2 mb-2">
                                    <p className={`text-sm font-medium leading-snug ${task.status === 'Done' ? 'line-through text-muted-foreground' : ''}`}>
                                      {task.title}
                                    </p>
                                    {isBeingWorkedOn && (
                                      <span className="w-2 h-2 rounded-full bg-success animate-pulse flex-shrink-0 mt-1" />
                                    )}
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

          {viewMode === 'calendar' && (
            <CalendarView tasks={tasks} onTaskClick={setSelectedTask} />
          )}
        </div>
      </div>

      {/* Right Side - Task Detail Panel */}
      {selectedTask && (
        <div className="fixed inset-0 z-50 bg-background lg:relative lg:inset-auto lg:z-auto lg:w-1/2 h-full max-h-[100dvh] overflow-y-auto pt-[72px] lg:pt-0">
          <TaskDetailPanel
            task={selectedTask}
            onClose={() => setSelectedTask(null)}
            comments={comments?.filter(c => c.taskId === selectedTask.id) || []}
            onAddComment={handleAddComment}
            onUpdate={taskMutation.update}
            onDelete={taskMutation.remove}
            projects={projects}
            onSelectSubtask={(subtask) => setSelectedTask(subtask)}
          />
        </div>
      )}
    </div>
  );
};

// Task Form Component
const TaskForm: React.FC<{
  onSubmit: (data: FormData) => void;
  projects: Project[];
  initialData?: Task;
  allTasks?: Task[];
}> = ({ onSubmit, projects, initialData, allTasks = [] }) => {
  const [startDate, setStartDate] = useState<Date | undefined>(
    initialData?.startDate ? new Date(initialData.startDate) : new Date()
  );
  const [endDate, setEndDate] = useState<Date | undefined>(
    initialData?.endDate ? new Date(initialData.endDate) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
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
          <Label>Data e Fillimit</Label>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="w-full justify-start text-sm" type="button">
                <CalendarIcon className="mr-2 h-4 w-4" />
                {startDate ? startDate.toLocaleDateString() : "Zgjidh"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar 
                mode="single" 
                selected={startDate} 
                onSelect={setStartDate}
                initialFocus
              />
            </PopoverContent>
          </Popover>
        </div>

        <div>
          <Label>Afati</Label>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="w-full justify-start text-sm" type="button">
                <CalendarIcon className="mr-2 h-4 w-4" />
                {endDate ? endDate.toLocaleDateString() : "Zgjidh"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar 
                mode="single" 
                selected={endDate} 
                onSelect={setEndDate}
                initialFocus
              />
            </PopoverContent>
          </Popover>
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
        <Label htmlFor="assignedToUserId">Cakto te</Label>
        <Input 
          id="assignedToUserId" 
          name="assignedToUserId" 
          required 
          defaultValue={initialData?.assignedToUserId || (typeof window !== 'undefined' ? (window as any).__CURRENT_USER_ID__ : '')} 
          placeholder="User ID (lër bosh për veten)"
        />
        <p className="text-xs text-muted-foreground mt-1">
          Lër bosh për ta caktuar vetes
        </p>
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
                    {Array.from({ length: 28 }, (_, i) => i + 1).map(d => (
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

  const firstDay = new Date(
    currentDate.getFullYear(),
    currentDate.getMonth(),
    1
  ).getDay();

  const days = [];
  for (let i = 0; i < firstDay; i++) {
    days.push(<div key={`empty-${i}`} className="min-h-[80px] bg-muted/20" />);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(currentDate.getFullYear(), currentDate.getMonth(), day);
    const dayTasks = tasks.filter(task => {
      const taskDate = new Date(task.endDate);
      return taskDate.toDateString() === date.toDateString();
    });

    days.push(
      <div key={day} className="min-h-[50px] sm:min-h-[80px] border border-border p-0.5 sm:p-1 bg-background">
        <div className="font-medium text-[10px] sm:text-xs mb-0.5 sm:mb-1 text-muted-foreground">
          {day}
        </div>
        <div className="space-y-0.5 sm:space-y-1">
          {dayTasks.slice(0, 2).map(task => (
            <div
              key={task.id}
              className="text-[10px] sm:text-xs p-0.5 sm:p-1 bg-primary/10 rounded cursor-pointer hover:bg-primary/20 truncate"
              onClick={() => onTaskClick(task)}
            >
              {task.title}
            </div>
          ))}
          {dayTasks.length > 2 && (
            <div className="text-[10px] sm:text-xs text-muted-foreground">
              +{dayTasks.length - 2}
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
        {['Di', 'Hë', 'Ma', 'Më', 'En', 'Pr', 'Sh'].map(day => (
          <div key={day} className="bg-muted p-0.5 sm:p-1 text-center text-[10px] sm:text-xs font-medium">
            {day}
          </div>
        ))}
        {days}
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
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      {children}
    </div>
  );
}

export default TasksView;
