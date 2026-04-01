import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { DndContext, DragOverlay, closestCorners, PointerSensor, useSensor, useSensors, useDroppable, type DragStartEvent, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useCollection, useMutation, useDocument } from '../hooks/useFirestore';
import { useAuth } from '../contexts/AuthContext';
import { ArrowLeft, Plus, LayoutGrid, List, Calendar as CalendarIcon, Users, Settings, MoreVertical, Upload, Download, Trash2, FileText, MessageSquare, CheckSquare, Filter, Search } from 'lucide-react';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Checkbox } from '../components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs';
import { Calendar } from '../components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import TaskDetailPanel from '../components/TaskDetailPanel';
import { useFilteredTasks } from '../hooks/useRoleFilteredData';
import { useUserNames } from '../hooks/useUserNames';
import type { Task, Project, Team, TeamMember } from '../types';

const ProjectDetailView: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  
  const [viewMode, setViewMode] = useState<'list' | 'board' | 'calendar'>('list');
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [isCreateTaskOpen, setIsCreateTaskOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Fetch project data
  const { data: projectData, loading: projectLoading } = useDocument<Project>('projects', projectId || '');
  const project = projectData;
  const { data: rawProjectTasks } = useCollection<Task>('tasks', {
    where: projectId ? [{ field: 'projectId', operator: '==', value: projectId }] : undefined,
    orderBy: { field: 'createdAt', direction: 'desc' },
    skipTeamFilter: true,
  });
  // Role-based filtering: Member/Viewer see only their assigned tasks within this project
  const allTasks = useFilteredTasks(rawProjectTasks);
  const { data: teams } = useCollection<Team>('teams');
  const { data: teamMembers } = useCollection<TeamMember>('teamMembers', {
    where: [{ field: 'status', operator: '==', value: 'Active' }]
  });
  const { data: comments } = useCollection<any>('taskComments', { skipTeamFilter: true });

  const projectMutation = useMutation<Project>('projects');
  const taskMutation = useMutation<Task>('tasks');
  const commentMutation = useMutation<any>('taskComments');
  const notificationMutation = useMutation<any>('notifications');

  const { getName, getInitials } = useUserNames(teamMembers || []);

  // Filter tasks
  const tasks = React.useMemo(() => {
    if (!allTasks) return [];
    let filtered = allTasks.filter(t => !t.parentTaskId);
    
    if (filterStatus !== 'all') {
      filtered = filtered.filter(t => t.status === filterStatus);
    }
    
    if (searchQuery) {
      filtered = filtered.filter(t => 
        t.title.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }
    
    return filtered;
  }, [allTasks, filterStatus, searchQuery]);

  const team = teams?.find(t => t.id === project?.teamId);
  const projectMembers = teamMembers?.filter(m => m.teamId === project?.teamId) || [];

  // Keep selectedTask in sync with live Firestore data
  useEffect(() => {
    if (selectedTask && allTasks) {
      const updated = allTasks.find(t => t.id === selectedTask.id);
      if (updated && JSON.stringify(updated) !== JSON.stringify(selectedTask)) {
        setSelectedTask(updated);
      }
    }
  }, [allTasks, selectedTask]);

  // Progress uses ALL top-level tasks (unfiltered), not the search/status-filtered view
  const allTopLevelTasks = React.useMemo(() =>
    (allTasks || []).filter(t => !t.parentTaskId),
    [allTasks]
  );
  const completedTasks = allTopLevelTasks.filter(t => t.status === 'Done').length;
  const totalTasks = allTopLevelTasks.length;
  const progress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Active': return 'bg-success text-success-foreground';
      case 'Planning': return 'bg-info text-info-foreground';
      case 'Completed': return 'bg-gray-500 text-white';
      case 'On Hold': return 'bg-warning text-warning-foreground';
      case 'In Review': return 'bg-purple-500 text-white';
      case 'Archived': return 'bg-slate-500 text-white';
      case 'Cancelled': return 'bg-destructive text-destructive-foreground';
      default: return 'bg-muted text-muted-foreground';
    }
  };

  const handleCreateTask = async (formData: FormData) => {
    const title = formData.get('title') as string;
    const description = formData.get('description') as string;
    const startDateStr = formData.get('startDate') as string;
    const endDateStr = formData.get('endDate') as string;
    const startDate = startDateStr ? new Date(startDateStr) : new Date();
    const endDate = endDateStr ? new Date(endDateStr) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const assignedToUserId = formData.get('assignedToUserId') as string || user?.uid || '';
    const priority = formData.get('priority') as string || 'medium';
    const status = formData.get('status') as string || 'Todo';
    const isRecurring = formData.get('isRecurring') === 'true';
    const recurringFrequency = formData.get('recurringFrequency') as string || 'weekly';
    const recurringInterval = parseInt(formData.get('recurringInterval') as string) || 1;
    const recurringDayOfWeek = formData.get('recurringDayOfWeek') !== null ? parseInt(formData.get('recurringDayOfWeek') as string) : undefined;
    const recurringDayOfMonth = formData.get('recurringDayOfMonth') !== null ? parseInt(formData.get('recurringDayOfMonth') as string) : undefined;

    const taskData: any = {
      title,
      description,
      startDate,
      endDate,
      assignedToUserId,
      projectId,
      status,
      priority,
      collaboratorIds: [],
    };

    if (isRecurring) {
      taskData.isRecurring = true;
      taskData.recurringFrequency = recurringFrequency;
      taskData.recurringInterval = recurringInterval;
      taskData.nextRecurringDate = endDate;
      if (recurringFrequency === 'weekly' && recurringDayOfWeek !== undefined && !isNaN(recurringDayOfWeek)) {
        taskData.recurringDayOfWeek = recurringDayOfWeek;
      }
      if (recurringFrequency === 'monthly' && recurringDayOfMonth !== undefined && !isNaN(recurringDayOfMonth)) {
        taskData.recurringDayOfMonth = recurringDayOfMonth;
      }
    }

    const newTask = await taskMutation.create(taskData);

    if (assignedToUserId && assignedToUserId !== user?.uid) {
      await notificationMutation.create({
        userId: assignedToUserId,
        title: 'Detyrë e Re e Caktuar',
        message: `Ju u caktuat te detyra: ${title}`,
        isRead: false,
      });
    }

    setIsCreateTaskOpen(false);
    setSelectedTask(newTask);
  };

  const handleAddComment = async (taskId: string, content: string) => {
    await commentMutation.create({ taskId, content });
  };

  const formatDateCompact = (date: Date) => {
    if (!date || isNaN(new Date(date).getTime())) {
      return { text: 'Pa afat', className: 'text-muted-foreground' };
    }
    const now = new Date();
    const taskDate = new Date(date);
    const diffDays = Math.ceil((taskDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    
    if (diffDays < 0) return { text: `${Math.abs(diffDays)} ditë më parë`, className: 'text-error' };
    if (diffDays === 0) return { text: 'Sot', className: 'text-warning font-medium' };
    if (diffDays === 1) return { text: 'Nesër', className: 'text-warning' };
    
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return { text: `${months[taskDate.getMonth()]} ${taskDate.getDate()}`, className: 'text-muted-foreground' };
  };

  const columns = [
    { id: 'Todo', title: 'Për të bërë', status: 'Todo' },
    { id: 'In Progress', title: 'Në progres', status: 'In Progress' },
    { id: 'Review', title: 'Rishikim', status: 'Review' },
    { id: 'Done', title: 'Përfunduar', status: 'Done' },
  ];

  // Auto-complete project when every task is marked Done
  const handleTaskUpdate = React.useCallback(async (taskId: string, data: any) => {
    await taskMutation.update(taskId, data);
    // Only check when a task is being set to Done
    if (data.status !== 'Done') return;
    if (!project || project.status === 'Completed' || project.status === 'Archived' || project.status === 'Cancelled' || !rawProjectTasks?.length) return;
    // Use RAW (unfiltered) tasks so Members/Viewers can't trigger auto-complete
    // based on only their own visible subset of tasks
    const topLevelTasks = rawProjectTasks.filter(t => !t.parentTaskId);
    if (topLevelTasks.length === 0) return;
    // Optimistically check: the task we just updated + the rest
    const updatedStatuses = topLevelTasks.map(t =>
      t.id === taskId ? 'Done' : t.status
    );
    const allDone = updatedStatuses.every(s => s === 'Done');
    if (allDone) {
      const now = new Date();
      // For recurring projects: keep Active, just record lastCompletedAt
      if ((project as any).isRecurring) {
        await projectMutation.update(project.id, { lastCompletedAt: now });
      } else {
        await projectMutation.update(project.id, {
          status: 'Completed',
          lastCompletedAt: now,
        });
      }
      await notificationMutation.create({
        userId: project.createdByUserId || user?.uid,
        type: 'project_completed',
        title: `✅ Projekti "${project.name}" u mbyll automatikisht`,
        message: 'Të gjitha detyrat u shënuan si Përfunduar.',
        isRead: false,
        createdAt: now,
      });
    }
  }, [taskMutation, project, rawProjectTasks, projectMutation, notificationMutation, user]);

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
    const overId = String(over.id);
    const targetStatus = columns.find(c => c.status === overId)?.status
      || columns.find(c => tasks.filter(t => t.status === c.status).some(t => t.id === overId))?.status;
    if (targetStatus) {
      const task = tasks.find(t => t.id === taskId);
      if (task && task.status !== targetStatus) {
        await handleTaskUpdate(taskId, { status: targetStatus });
      }
    }
  };

  if (projectLoading || !project) {
    return (
      <div className="h-[calc(100vh-120px)] flex items-center justify-center">
        <div className="text-muted-foreground">Duke ngarkuar projektin...</div>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-120px)] flex flex-col">
      {/* Project Header */}
      <div className="border-b bg-background">
        <div className="flex items-center gap-4 px-6 py-4">
          <Button variant="ghost" size="sm" onClick={() => navigate('/app/projects')}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Projektet
          </Button>
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-pink-100 flex items-center justify-center">
                <List className="w-5 h-5 text-pink-600" />
              </div>
              <div>
                <h1 className="text-xl font-semibold">{project.name}</h1>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Badge className={getStatusColor(project.status)}>{project.status}</Badge>
                  {team && (
                    <span className="flex items-center gap-1">
                      <Users className="w-3 h-3" />
                      {team.name}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
          
          {/* Project Members Avatars */}
          <div className="flex items-center gap-2">
            <div className="flex -space-x-2">
              {projectMembers.slice(0, 4).map((member, idx) => (
                <div
                  key={member.id}
                  className="w-8 h-8 rounded-full bg-primary/20 border-2 border-background flex items-center justify-center text-xs font-medium"
                  title={getName(member.userId)}
                >
                  {getInitials(member.userId)}
                </div>
              ))}
              {projectMembers.length > 4 && (
                <div className="w-8 h-8 rounded-full bg-muted border-2 border-background flex items-center justify-center text-xs">
                  +{projectMembers.length - 4}
                </div>
              )}
            </div>
            <Button variant="outline" size="sm">
              <Plus className="w-4 h-4" />
            </Button>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm">
                <MoreVertical className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setIsSettingsOpen(true)}>
                <Settings className="w-4 h-4 mr-2" />
                Cilësimet
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-error"
                onClick={async () => {
                  setShowDeleteConfirm(true);
                }}
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Fshi Projektin
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Progress Bar */}
        <div className="px-6 pb-4">
          <div className="flex items-center gap-4">
            <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
              <div 
                className="h-full bg-gradient-primary transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="text-sm text-muted-foreground">
              {completedTasks}/{totalTasks} detyra ({progress}%)
            </span>
          </div>
        </div>

        {/* Tabs and Actions */}
        <div className="flex items-center justify-between px-6 pb-2">
          <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as any)}>
            <TabsList className="h-8">
              <TabsTrigger value="list" className="text-xs px-3">
                <List className="w-3 h-3 mr-1" />
                List
              </TabsTrigger>
              <TabsTrigger value="board" className="text-xs px-3">
                <LayoutGrid className="w-3 h-3 mr-1" />
                Board
              </TabsTrigger>
              <TabsTrigger value="calendar" className="text-xs px-3">
                <CalendarIcon className="w-3 h-3 mr-1" />
                Calendar
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Kërko detyra..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 h-8 w-48 text-sm"
              />
            </div>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-[130px] h-8 text-xs">
                <Filter className="w-3 h-3 mr-1" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Të gjitha</SelectItem>
                <SelectItem value="Todo">Për të bërë</SelectItem>
                <SelectItem value="In Progress">Në progres</SelectItem>
                <SelectItem value="Review">Rishikim</SelectItem>
                <SelectItem value="Done">Përfunduar</SelectItem>
              </SelectContent>
            </Select>
            <Dialog open={isCreateTaskOpen} onOpenChange={setIsCreateTaskOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="bg-primary text-primary-foreground">
                  <Plus className="w-4 h-4 mr-1" />
                  Detyrë e Re
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Krijo Detyrë të Re</DialogTitle>
                </DialogHeader>
                <TaskForm 
                  onSubmit={handleCreateTask} 
                  projects={project ? [project] : []} 
                  defaultProjectId={projectId}
                  teamMembers={teamMembers || []}
                />
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </div>

      {/* Settings Dialog */}
      <Dialog open={isSettingsOpen} onOpenChange={setIsSettingsOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Cilësimet e Projektit</DialogTitle>
          </DialogHeader>
          <ProjectSettingsForm
            project={project}
            teamMembers={teamMembers || []}
            onSave={async (memberUserIds) => {
              await projectMutation.update(project.id, { memberUserIds });
              setIsSettingsOpen(false);
            }}
          />
        </DialogContent>
      </Dialog>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Task List/Board */}
        <div className={`${selectedTask ? 'hidden lg:flex lg:flex-col lg:w-1/2 lg:border-r' : 'flex flex-col w-full'} transition-all duration-300 overflow-hidden`}>
          {viewMode === 'list' && (
            <div className="flex-1 overflow-y-auto">
              <div className="divide-y">
                {tasks.map((task) => {
                  const dateInfo = formatDateCompact(new Date(task.endDate));
                  const isSelected = selectedTask?.id === task.id;
                  const isOverdue = new Date(task.endDate) < new Date() && task.status !== 'Done';
                  
                  return (
                    <div
                      key={task.id}
                      className={`flex items-center gap-3 px-6 py-3 cursor-pointer hover:bg-muted/50 transition-colors ${
                        isSelected ? 'bg-primary/5 border-l-2 border-l-primary' : ''
                      } ${isOverdue ? 'bg-error/5' : ''}`}
                      onClick={() => setSelectedTask(task)}
                    >
                      <Checkbox 
                        checked={task.status === 'Done'}
                        onCheckedChange={async (checked) => {
                          await handleTaskUpdate(task.id, { 
                            status: checked ? 'Done' : 'Todo' 
                          });
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className={task.status === 'Done' ? 'bg-success border-success' : ''}
                      />
                      <div className="flex-1 min-w-0">
                        <span className={`text-sm ${task.status === 'Done' ? 'line-through text-muted-foreground' : ''}`}>
                          {task.title}
                        </span>
                      </div>
                      {task.assignedToUserId && (
                        <div className="flex items-center gap-2 px-2 py-1 bg-muted/50 rounded-full">
                          <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-xs font-medium">
                            {getInitials(task.assignedToUserId)}
                          </div>
                          <span className="text-xs text-muted-foreground max-w-[100px] truncate">
                            {getName(task.assignedToUserId)}
                          </span>
                        </div>
                      )}
                      {!task.assignedToUserId && (
                        <div className="flex items-center gap-1 px-2 py-1 bg-warning/10 rounded-full">
                          <Users className="w-4 h-4 text-warning" />
                          <span className="text-xs text-warning">Pa caktuar</span>
                        </div>
                      )}
                      <span className={`text-xs ${dateInfo.className}`}>
                        {dateInfo.text}
                      </span>
                    </div>
                  );
                })}
                
                {tasks.length === 0 && (
                  <div className="text-center py-12 text-muted-foreground">
                    <CheckSquare className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p>Asnjë detyrë në këtë projekt</p>
                    <Button 
                      variant="link" 
                      className="mt-2"
                      onClick={() => setIsCreateTaskOpen(true)}
                    >
                      Krijo detyrën e parë
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}

          {viewMode === 'board' && (
            <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
              <div className="grid grid-cols-4 gap-4 p-4 h-full overflow-x-auto">
                {columns.map((column) => {
                  const columnTasks = tasks.filter(task => task.status === column.status);
                  
                  return (
                    <ProjectKanbanColumn key={column.id} id={column.status}>
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-medium text-muted-foreground">{column.title}</h3>
                        <Badge variant="secondary" className="text-xs">
                          {columnTasks.length}
                        </Badge>
                      </div>

                      <SortableContext items={columnTasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
                        <div className="space-y-2 flex-1 overflow-y-auto min-h-[60px]">
                          {columnTasks.map((task) => (
                            <ProjectSortableCard key={task.id} id={task.id}>
                              <Card
                                className={`p-3 cursor-grab active:cursor-grabbing hover:shadow-md transition-shadow ${
                                  selectedTask?.id === task.id ? 'ring-2 ring-primary' : ''
                                }`}
                                onClick={() => setSelectedTask(task)}
                              >
                                <p className="text-sm font-medium mb-2">{task.title}</p>
                                <div className="flex items-center justify-between text-xs text-muted-foreground">
                                  {task.assignedToUserId ? (
                                    <div className="flex items-center gap-1.5" title={getName(task.assignedToUserId)}>
                                      <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-xs font-medium">
                                        {getInitials(task.assignedToUserId)}
                                      </div>
                                      <span className="max-w-[80px] truncate">
                                        {getName(task.assignedToUserId)}
                                      </span>
                                    </div>
                                  ) : (
                                    <span className="text-warning flex items-center gap-1">
                                      <Users className="w-3 h-3" />
                                      Pa caktuar
                                    </span>
                                  )}
                                  <span>{formatDateCompact(new Date(task.endDate)).text}</span>
                                </div>
                              </Card>
                            </ProjectSortableCard>
                          ))}
                        </div>
                      </SortableContext>
                    </ProjectKanbanColumn>
                  );
                })}
              </div>
              <DragOverlay>
                {activeTaskId ? (
                  <Card className="p-3 shadow-xl rotate-2 opacity-90">
                    <p className="text-sm font-medium">{tasks.find(t => t.id === activeTaskId)?.title}</p>
                  </Card>
                ) : null}
              </DragOverlay>
            </DndContext>
          )}

          {viewMode === 'calendar' && (
            <ProjectCalendarView tasks={tasks} onTaskClick={setSelectedTask} />
          )}
        </div>

        {/* Task Detail Panel */}
        {selectedTask && (
          <div className="fixed inset-0 z-50 bg-background lg:relative lg:inset-auto lg:z-auto lg:w-1/2 h-full max-h-[100dvh] overflow-y-auto pt-[72px] lg:pt-0">
            <TaskDetailPanel
              task={selectedTask}
              onClose={() => setSelectedTask(null)}
              comments={comments?.filter(c => c.taskId === selectedTask.id) || []}
              onAddComment={handleAddComment}
              onUpdate={handleTaskUpdate}
              onDelete={taskMutation.remove}
              projects={project ? [project] : undefined}
              onSelectSubtask={(subtask) => setSelectedTask(subtask)}
            />
          </div>
        )}
      </div>

      {/* Delete Project Confirmation */}
      <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Fshi Projektin</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Jeni i sigurt që dëshironi të fshini këtë projekt? Ky veprim nuk mund të zhbëhet.</p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setShowDeleteConfirm(false)}>Anulo</Button>
            <Button variant="destructive" onClick={async () => { setShowDeleteConfirm(false); await projectMutation.remove(projectId!); navigate('/app/projects'); }}>Fshi</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

// Project Settings Form
const ProjectSettingsForm: React.FC<{
  project: Project;
  teamMembers: import('../types').TeamMember[];
  onSave: (memberUserIds: string[]) => void;
}> = ({ project, teamMembers, onSave }) => {
  const { getName } = useUserNames(teamMembers);
  const [selected, setSelected] = React.useState<string[]>(project.memberUserIds || []);

  const toggle = (userId: string) => {
    setSelected(prev => prev.includes(userId) ? prev.filter(id => id !== userId) : [...prev, userId]);
  };

  return (
    <div className="space-y-4">
      <div>
        <Label>Anëtarët e Projektit</Label>
        <p className="text-xs text-muted-foreground mb-2">Zgjidh personat që do të marrin pjesë në këtë projekt</p>
        {teamMembers.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">Nuk ka anëtarë të disponueshëm</p>
        ) : (
          <div className="space-y-2 max-h-64 overflow-y-auto border rounded-md p-2">
            {teamMembers.map(m => (
              <label key={m.id} className="flex items-center gap-3 cursor-pointer hover:bg-muted/50 px-2 py-1.5 rounded">
                <input
                  type="checkbox"
                  className="w-4 h-4 accent-primary"
                  checked={selected.includes(m.userId)}
                  onChange={() => toggle(m.userId)}
                />
                <div className="flex items-center gap-2 flex-1">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary">
                    {getName(m.userId).charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="text-sm font-medium">{getName(m.userId)}</p>
                    <p className="text-xs text-muted-foreground">{m.role}</p>
                  </div>
                </div>
              </label>
            ))}
          </div>
        )}
        {selected.length > 0 && (
          <p className="text-xs text-primary mt-1">{selected.length} person{selected.length !== 1 ? 'a' : ''} të zgjedhur</p>
        )}
      </div>
      <Button className="w-full" onClick={() => onSave(selected)}>
        Ruaj Ndryshimet
      </Button>
    </div>
  );
};

// Task Form Component - Same as TasksView
const TaskForm: React.FC<{
  onSubmit: (data: FormData) => void;
  projects: Project[];
  initialData?: Task;
  defaultProjectId?: string;
  teamMembers?: import('../types').TeamMember[];
}> = ({ onSubmit, projects, initialData, defaultProjectId, teamMembers }) => {
  const { getName } = useUserNames(teamMembers || []);
  const [startDate, setStartDate] = useState<Date | undefined>(
    initialData?.startDate ? new Date(initialData.startDate) : new Date()
  );
  const [endDate, setEndDate] = useState<Date | undefined>(
    initialData?.endDate ? new Date(initialData.endDate) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  );
  const [status, setStatus] = useState(initialData?.status || 'Todo');
  const [priority, setPriority] = useState(initialData?.priority || 'medium');
  const [projectId, setProjectId] = useState(initialData?.projectId || defaultProjectId || '__none__');
  const [assignedUserId, setAssignedUserId] = useState(initialData?.assignedToUserId || '__none__');
  const [isRecurring, setIsRecurring] = useState(initialData?.isRecurring || false);
  const [recurringFrequency, setRecurringFrequency] = useState(initialData?.recurringFrequency || 'weekly');
  const [recurringInterval, setRecurringInterval] = useState(initialData?.recurringInterval || 1);
  const [recurringDayOfWeek, setRecurringDayOfWeek] = useState(initialData?.recurringDayOfWeek ?? 1);
  const [recurringDayOfMonth, setRecurringDayOfMonth] = useState(initialData?.recurringDayOfMonth ?? 1);

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
    
    if (projectId && projectId !== '__none__') {
      formData.set('projectId', projectId);
    }
    
    if (assignedUserId && assignedUserId !== '__none__') {
      formData.set('assignedToUserId', assignedUserId);
    }
    
    if (isRecurring) {
      formData.set('isRecurring', 'true');
      formData.set('recurringFrequency', recurringFrequency);
      formData.set('recurringInterval', String(recurringInterval));
      if (recurringFrequency === 'weekly') {
        formData.set('recurringDayOfWeek', String(recurringDayOfWeek));
      }
      if (recurringFrequency === 'monthly') {
        formData.set('recurringDayOfMonth', String(recurringDayOfMonth));
      }
    }
    
    onSubmit(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <Label htmlFor="title">Titulli</Label>
        <Input id="title" name="title" required defaultValue={initialData?.title} placeholder="Emri i detyrës" />
      </div>

      <div>
        <Label htmlFor="description">Përshkrimi</Label>
        <Textarea id="description" name="description" defaultValue={initialData?.description} placeholder="Përshkruaj detyrën..." rows={3} />
      </div>

      <div className="grid grid-cols-2 gap-4">
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

      <div className="grid grid-cols-2 gap-4">
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
        <Select value={assignedUserId} onValueChange={setAssignedUserId}>
          <SelectTrigger id="assignedToUserId">
            <SelectValue placeholder="Zgjidh anëtarin" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">I pacaktuar</SelectItem>
            {(teamMembers || []).map(m => (
              <SelectItem key={m.id} value={m.userId}>{getName(m.userId)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label htmlFor="projectId">Projekti</Label>
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
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
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

              <div>
                <Label>Çdo sa?</Label>
                <Select value={String(recurringInterval)} onValueChange={(v) => setRecurringInterval(Number(v))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[1, 2, 3, 4, 6, 8, 12].map(n => (
                      <SelectItem key={n} value={String(n)}>
                        {n === 1 ? 'Çdo' : `Çdo ${n}`} {recurringFrequency === 'daily' ? (n === 1 ? 'ditë' : 'ditë') : recurringFrequency === 'weekly' ? (n === 1 ? 'javë' : 'javë') : recurringFrequency === 'monthly' ? (n === 1 ? 'muaj' : 'muaj') : (n === 1 ? 'vit' : 'vite')}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {recurringFrequency === 'weekly' && (
              <div>
                <Label>Dita e javës</Label>
                <Select value={String(recurringDayOfWeek)} onValueChange={(v) => setRecurringDayOfWeek(Number(v))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">E Hënë</SelectItem>
                    <SelectItem value="2">E Martë</SelectItem>
                    <SelectItem value="3">E Mërkurë</SelectItem>
                    <SelectItem value="4">E Enjte</SelectItem>
                    <SelectItem value="5">E Premte</SelectItem>
                    <SelectItem value="6">E Shtunë</SelectItem>
                    <SelectItem value="0">E Diel</SelectItem>
                  </SelectContent>
                </Select>
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
                      <SelectItem key={d} value={String(d)}>Dita {d}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              {`Përsëritet çdo ${recurringInterval > 1 ? recurringInterval + ' ' : ''}${recurringFrequency === 'daily' ? 'ditë' : recurringFrequency === 'weekly' ? 'javë' : recurringFrequency === 'monthly' ? 'muaj' : 'vit'}${
                recurringFrequency === 'weekly' ? `, ditën e ${['Diel','Hënë','Martë','Mërkurë','Enjte','Premte','Shtunë'][recurringDayOfWeek]}s` :
                recurringFrequency === 'monthly' ? `, në ditën ${recurringDayOfMonth}` : ''
              }`}
            </p>
          </div>
        )}
      </div>

      <Button type="submit" className="w-full">
        {initialData ? 'Ruaj Ndryshimet' : 'Krijo Detyrën'}
      </Button>
    </form>
  );
};

// Calendar View
const ProjectCalendarView: React.FC<{
  tasks: Task[];
  onTaskClick: (task: Task) => void;
}> = ({ tasks, onTaskClick }) => {
  const [currentDate, setCurrentDate] = useState(new Date());

  const daysInMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0).getDate();
  const firstDay = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1).getDay();

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
      <div key={day} className="min-h-[80px] border border-border p-1 bg-background">
        <div className="font-medium text-xs mb-1 text-muted-foreground">{day}</div>
        <div className="space-y-1">
          {dayTasks.slice(0, 2).map(task => (
            <div
              key={task.id}
              className="text-xs p-1 bg-primary/10 rounded cursor-pointer hover:bg-primary/20 truncate"
              onClick={() => onTaskClick(task)}
            >
              {task.title}
            </div>
          ))}
          {dayTasks.length > 2 && (
            <div className="text-xs text-muted-foreground">+{dayTasks.length - 2} më shumë</div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <Button variant="outline" size="sm" onClick={() => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1))}>
          Para
        </Button>
        <h2 className="text-sm font-medium">
          {currentDate.toLocaleDateString('sq-AL', { month: 'long', year: 'numeric' })}
        </h2>
        <Button variant="outline" size="sm" onClick={() => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1))}>
          Pas
        </Button>
      </div>
      <div className="grid grid-cols-7 gap-px bg-border">
        {['Diel', 'Hën', 'Mar', 'Mër', 'Enj', 'Pre', 'Sht'].map(day => (
          <div key={day} className="bg-muted p-1 text-center text-xs font-medium">{day}</div>
        ))}
        {days}
      </div>
    </div>
  );
};

// --- @dnd-kit helper components ---
function ProjectKanbanColumn({ id, children }: { id: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={`flex flex-col min-w-[250px] transition-colors rounded-lg p-1 ${isOver ? 'bg-primary/5 ring-1 ring-primary/30' : ''}`}>
      {children}
    </div>
  );
}

function ProjectSortableCard({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 };
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      {children}
    </div>
  );
}

export default ProjectDetailView;
