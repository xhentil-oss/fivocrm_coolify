import React, { useState, useRef, useEffect } from 'react';
import { addDoc, collection, Timestamp } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useClientPortal } from '../../hooks/useClientPortal';
import { useAuth } from '../../contexts/AuthContext';
import { useCollection, useDocument } from '../../hooks/useFirestore';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Textarea } from '../../components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { ScrollArea } from '../../components/ui/scroll-area';

import {
  FolderKanban, ArrowLeft, CheckCircle2, Clock, Circle,
  MessageSquare, Send, DollarSign,
  CalendarDays, ChevronDown, ChevronRight, Loader2,
} from 'lucide-react';
import { useToast } from '../../hooks/use-toast';
import type { Project, Task, TaskComment } from '../../types';
import { notifyStaff } from '../../lib/notifyStaff';
import { compareTasksByDue } from '../../lib/taskSort';
import { useCommentFocus, COMMENT_FLASH_CLASS } from '../../hooks/useCommentFocus';
import { taskDeepLink, projectCommentDeepLink } from '../../lib/deepLinks';
import { currencySymbol } from '../../lib/utils';

interface ProjectComment {
  id: string;
  projectId: string;
  content: string;
  userId: string;
  senderType: 'client' | 'team';
  createdAt: Date;
  updatedAt: Date;
}

const PortalProjectDetailView: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { customerId, businessId: portalBusinessId } = useClientPortal();
  const { toast } = useToast();
  // Arriving from a "përgjigje nga ekipi" notification: open the discussion tab and
  // scroll to that comment instead of dropping the client on the overview.
  const [searchParams] = useSearchParams();
  const focusCommentId = searchParams.get('comment');
  const { registerComment, isFlashing } = useCommentFocus(focusCommentId);
  const [activeTab, setActiveTab] = useState(() => (focusCommentId ? 'comments' : 'overview'));
  const [commentText, setCommentText] = useState('');
  const commentScrollRef = useRef<HTMLDivElement>(null);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [taskCommentTexts, setTaskCommentTexts] = useState<Record<string, string>>({});
  const [sendingTaskComment, setSendingTaskComment] = useState<string | null>(null);

  // Fetch project
  const { data: project, loading: projectLoading } = useDocument<Project>('projects', projectId || '');

  // Fetch tasks for this project, scoped by customerId so the RLS rule
  // (isPortalClientFor) holds for every returned doc. `skip` until customerId
  // resolves — the old projectId-only fallback was unprovable under the rule,
  // so every portal project open started with a denied listener.
  // Member-access (projects.memberUserIds, not the paying customer): the tasks
  // carry the OWNER's customerId, so the customerId-scoped query returned nothing
  // and every invited member saw "asnjë detyrë". The rules prove a projectId-only
  // query for a project member (isPortalProjectMember), so that is what they get.
  const isProjectMember = !!(user?.uid && project && Array.isArray((project as any).memberUserIds)
    && (project as any).memberUserIds.includes(user.uid));
  const isProjectCustomer = !!(customerId && project && project.customerId === customerId);
  const { data: rawTasks } = useCollection<Task>('tasks', {
    where: isProjectMember && !isProjectCustomer
      ? [{ field: 'projectId', operator: '==', value: projectId || '' }]
      : [
          { field: 'projectId', operator: '==', value: projectId || '' },
          { field: 'customerId', operator: '==', value: customerId || '' },
        ],
    skipTeamFilter: true,
    skip: !project || (!customerId && !isProjectMember),
  });
  const tasks = React.useMemo(() => {
    if (!rawTasks) return [];
    // Top-level only: subtasks are the agency's internal work breakdown — they
    // inflated "Detyra Totale" vs the staff view and rendered flat to the client.
    // Inside a status: earliest deadline first, then id — without the tie-breaker
    // the client saw the order change on every snapshot.
    return rawTasks.filter(t => !t.parentTaskId).sort((a, b) => {
      const statusOrder: Record<string, number> = { 'In Progress': 0, 'Todo': 1, 'Review': 2, 'Done': 3 };
      return ((statusOrder[a.status] ?? 4) - (statusOrder[b.status] ?? 4)) || compareTasksByDue(a, b);
    });
  }, [rawTasks]);

  // Task comments — scoped to this client's customerId (server-side RLS), then
  // filtered client-side to this project's tasks.
  const { data: rawTaskComments } = useCollection<TaskComment>('taskComments', {
    skip: !customerId,
    where: customerId ? [{ field: 'customerId', operator: '==', value: customerId }] : undefined,
    skipTeamFilter: true,
  });
  const projectTaskIds = React.useMemo(() => new Set(tasks.map(t => t.id)), [tasks]);
  const taskComments = React.useMemo(() => {
    if (!rawTaskComments) return [];
    return rawTaskComments.filter(c => projectTaskIds.has(c.taskId)).sort((a, b) => {
      const ta = a.createdAt instanceof Date ? a.createdAt.getTime() : 0;
      const tb = b.createdAt instanceof Date ? b.createdAt.getTime() : 0;
      return ta - tb;
    });
  }, [rawTaskComments, projectTaskIds]);

  // Project comments — scoped by projectId AND customerId so the RLS rule
  // (isPortalClientFor) holds for every returned doc. `skip` until customerId
  // resolves (a projectId-only query is unprovable → denied listener).
  const { data: rawComments } = useCollection<ProjectComment>('projectComments', {
    where: [
      { field: 'projectId', operator: '==', value: projectId || '' },
      { field: 'customerId', operator: '==', value: customerId || '' },
    ],
    skipTeamFilter: true,
    skip: !customerId,
  });
  const comments = React.useMemo(() => {
    if (!rawComments) return [];
    return [...rawComments].sort((a, b) => {
      const ta = a.createdAt instanceof Date ? a.createdAt.getTime() : 0;
      const tb = b.createdAt instanceof Date ? b.createdAt.getTime() : 0;
      return ta - tb;
    });
  }, [rawComments]);

  // The portal never reads `teamMembers` — notification recipients are resolved
  // server-side within the client's own business (/api/notify-staff).
  // Comment display names come from `userProfiles`, scoped to that same business.
  const { data: userProfiles } = useCollection<any>('userProfiles', {
    skip: !portalBusinessId,
    where: portalBusinessId ? [{ field: 'businessId', operator: '==', value: portalBusinessId }] : undefined,
    skipTeamFilter: true,
    skipBusinessFilter: true,
  });


  // Auto-scroll comments — skipped when a notification deep-links to a specific
  // comment, otherwise the jump-to-bottom would undo the scroll to that comment.
  useEffect(() => {
    if (focusCommentId) return;
    if (commentScrollRef.current) {
      commentScrollRef.current.scrollTop = commentScrollRef.current.scrollHeight;
    }
  }, [comments, focusCommentId]);

  // Task stats
  const taskStats = React.useMemo(() => {
    const total = tasks.length;
    const done = tasks.filter(t => t.status === 'Done').length;
    const inProgress = tasks.filter(t => t.status === 'In Progress').length;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    return { total, done, inProgress, pct };
  }, [tasks]);

  const getDisplayName = (userId: string, senderType?: string) => {
    if (userId === user?.uid) return 'Ju';
    const profile = userProfiles?.find((p: any) => p.userId === userId);
    if (profile?.displayName) return profile.displayName;
    if (senderType === 'team') return 'Ekipi';
    return 'Përdorues';
  };

  const getTaskStatusIcon = (status: string) => {
    switch (status) {
      case 'Done': return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case 'In Progress': return <Clock className="h-4 w-4 text-blue-500" />;
      case 'Review': return <Clock className="h-4 w-4 text-primary" />;
      default: return <Circle className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getTaskStatusLabel = (status: string) => {
    switch (status) {
      case 'Todo': return 'Për të bërë';
      case 'In Progress': return 'Në Progres';
      case 'Review': return 'Në Rishikim';
      case 'Done': return 'Përfunduar';
      default: return status;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Active': return 'bg-green-100 text-green-800';
      case 'Planning': return 'bg-blue-100 text-blue-800';
      case 'On Hold': return 'bg-yellow-100 text-yellow-800';
      case 'Completed': return 'bg-emerald-100 text-emerald-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'Active': return 'Aktiv';
      case 'Planning': return 'Planifikim';
      case 'On Hold': return 'Në Pritje';
      case 'Completed': return 'Përfunduar';
      default: return status;
    }
  };

  // Send comment
  const handleSendComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commentText.trim() || !user || !projectId) return;

    try {
      // Use addDoc — portal users can't use useMutation.create() on team-scoped collections
      const commentTeamId = (project as any)?.teamId || null;
      const createdRef = await addDoc(collection(db, 'projectComments'), {
        projectId,
        content: commentText.trim(),
        userId: user.uid,
        senderType: 'client',
        ...(commentTeamId ? { teamId: commentTeamId } : {}),
        // Isolation keys so both sides read it under RLS: customerId (portal) + businessId (staff).
        ...(customerId ? { customerId } : {}),
        ...((project as any)?.businessId ? { businessId: (project as any).businessId } : {}),
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
        createdByUserId: user.uid,
      });

      // Notify the project's staff — resolved server-side inside this tenant.
      if (project) {
        void notifyStaff({
          type: 'project_comment',
          title: `Koment i ri nga klienti — ${project.name}`,
          message: commentText.length > 100 ? commentText.slice(0, 100) + '...' : commentText,
          // Land on the comment itself, not just the project page.
          actionUrl: projectCommentDeepLink(projectId, createdRef.id),
          actionLabel: 'Shiko Komentin',
          projectId: projectId || undefined,
          responsibleUserId: (project as any).responsibleUserId || null,
        });
      }
      setCommentText('');
      toast({ title: 'Komenti u dërgua' });
    } catch {
      toast({ title: 'Gabim', description: 'Komenti nuk u dërgua.', variant: 'destructive' });
    }
  };

  // Add a comment to a specific task
  const handleAddTaskComment = async (taskId: string) => {
    const text = (taskCommentTexts[taskId] || '').trim();
    if (!text || !user || !projectId) return;

    setSendingTaskComment(taskId);
    try {
      const resolvedTeamId = (project as any)?.teamId || null;
      const createdRef = await addDoc(collection(db, 'taskComments'), {
        taskId,
        content: text,
        userId: user.uid,
        senderType: 'client',
        createdByUserId: user.uid,
        ...(resolvedTeamId ? { teamId: resolvedTeamId } : {}),
        // Isolation keys: customerId (portal client) + businessId (staff).
        ...(customerId ? { customerId } : {}),
        ...((project as any)?.businessId ? { businessId: (project as any).businessId } : {}),
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });

      // Notify the task assignee + the project's staff — resolved server-side inside
      // this tenant (the portal must not read the staff directory).
      const task = tasks.find(t => t.id === taskId);
      void notifyStaff({
        type: 'project_comment',
        title: `Koment klienti — ${task?.title || 'Detyrë'}`,
        message: text.length > 100 ? text.slice(0, 100) + '...' : text,
        // Opens the task panel on this comment (the old `?task=` param was never read).
        actionUrl: taskDeepLink(taskId, projectId, createdRef.id),
        actionLabel: 'Shiko Komentin',
        projectId: projectId || undefined,
        responsibleUserId: task?.assignedToUserId || (project as any)?.responsibleUserId || null,
      });

      setTaskCommentTexts(prev => ({ ...prev, [taskId]: '' }));
      toast({ title: 'Komenti u dërgua' });
    } catch {
      toast({ title: 'Gabim', description: 'Komenti nuk u dërgua.', variant: 'destructive' });
    } finally {
      setSendingTaskComment(null);
    }
  };

  if (projectLoading && !project) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" size="sm" onClick={() => navigate('/portal/projects')} className="gap-2">
          <ArrowLeft className="h-4 w-4" /> Kthehu te Projektet
        </Button>
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" size="sm" onClick={() => navigate('/portal/projects')} className="gap-2">
          <ArrowLeft className="h-4 w-4" /> Kthehu te Projektet
        </Button>
        <Card>
          <CardContent className="py-12 text-center">
            <FolderKanban className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">Projekti nuk u gjet</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <Button variant="ghost" size="sm" onClick={() => navigate('/portal/projects')} className="gap-2 self-start">
          <ArrowLeft className="h-4 w-4" /> Projektet
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">{project.name}</h1>
            <Badge className={getStatusColor(project.status)} variant="secondary">
              {getStatusLabel(project.status)}
            </Badge>
          </div>
          {project.description && (
            <p className="text-muted-foreground mt-1">{project.description}</p>
          )}
        </div>
        <div className="flex gap-2 self-start">
          <Link to={`/portal/chat`}>
            <Button variant="outline" size="sm" className="gap-2">
              <MessageSquare className="h-4 w-4" /> Chat
            </Button>
          </Link>
        </div>
      </div>

      {/* Progress + Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6 text-center">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-primary/10 mb-2">
              <span className="text-lg font-bold text-primary">{taskStats.pct}%</span>
            </div>
            <p className="text-sm text-muted-foreground">Progresi</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <p className="text-2xl font-bold">{taskStats.total}</p>
            <p className="text-sm text-muted-foreground">Detyra Totale</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <p className="text-2xl font-bold text-green-600">{taskStats.done}</p>
            <p className="text-sm text-muted-foreground">Përfunduara</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <p className="text-2xl font-bold text-blue-600">{taskStats.inProgress}</p>
            <p className="text-sm text-muted-foreground">Në Progres</p>
          </CardContent>
        </Card>
      </div>

      {/* Budget info — the agreed price ONLY. `project.spent` is the agency's
          INTERNAL cost rollup (salaries + expenses, see project-spend-rollup);
          rendering it here showed every client the agency's margin on them —
          with a red bar whenever the agency was losing money on the retainer. */}
      {project.budget != null && project.budget > 0 && (
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <DollarSign className="h-5 w-5 text-muted-foreground" />
                <span className="text-sm font-medium">Buxheti</span>
              </div>
              <span className="font-semibold">{project.budget.toLocaleString()} {currencySymbol(project.currency)}</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Progress bar */}
      <Card>
        <CardContent className="py-4">
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="font-medium">Progresi i Përgjithshëm</span>
            <span className="font-bold">{taskStats.pct}%</span>
          </div>
          <div className="w-full h-3 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all"
              style={{ width: `${taskStats.pct}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {taskStats.done} nga {taskStats.total} detyra të përfunduara
          </p>
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex flex-wrap">
          <TabsTrigger value="overview" className="gap-1.5">
            <FolderKanban className="h-4 w-4" /> Detyrat
          </TabsTrigger>
          <TabsTrigger value="comments" className="gap-1.5">
            <MessageSquare className="h-4 w-4" /> Komentet
            {comments.length > 0 && (
              <Badge variant="secondary" className="ml-1 text-[10px] px-1.5">
                {comments.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ── Tasks Tab ── */}
        <TabsContent value="overview" className="mt-4">
          {tasks.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center">
                <CheckCircle2 className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                <p className="text-muted-foreground">Nuk ka detyra akoma për këtë projekt</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {tasks.map(task => {
                const taskCommentList = taskComments.filter(c => c.taskId === task.id);
                const isExpanded = expandedTaskId === task.id;
                const commentCount = taskCommentList.length;

                return (
                  <Card key={task.id} className={isExpanded ? 'border-primary/30 shadow-sm' : ''}>
                    {/* Task header — clickable to expand/collapse comments */}
                    <CardContent
                      className="py-3 px-4 cursor-pointer select-none"
                      onClick={() => setExpandedTaskId(isExpanded ? null : task.id)}
                    >
                      <div className="flex items-center gap-3">
                        {getTaskStatusIcon(task.status)}
                        <div className="flex-1 min-w-0">
                          <p className={`font-medium text-sm ${task.status === 'Done' ? 'line-through text-muted-foreground' : ''}`}>
                            {task.title}
                          </p>
                          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                            <span className="text-xs text-muted-foreground">
                              {getTaskStatusLabel(task.status)}
                            </span>
                            {task.priority && (
                              <Badge
                                variant="secondary"
                                className={`text-[10px] ${
                                  task.priority === 'urgent' ? 'bg-red-100 text-red-800' :
                                  task.priority === 'high' ? 'bg-orange-100 text-orange-800' :
                                  task.priority === 'medium' ? 'bg-blue-100 text-blue-800' :
                                  'bg-gray-100 text-gray-800'
                                }`}
                              >
                                {task.priority}
                              </Badge>
                            )}
                            {task.dueDate && (
                              <span className="text-xs text-muted-foreground flex items-center gap-1">
                                <CalendarDays className="h-3 w-3" />
                                {task.dueDate instanceof Date ? task.dueDate.toLocaleDateString('sq-AL') : ''}
                              </span>
                            )}
                          </div>
                        </div>
                        {/* Comment count + expand chevron */}
                        <div className="flex items-center gap-1.5 flex-shrink-0 text-muted-foreground">
                          {commentCount > 0 && (
                            <span className="flex items-center gap-1 text-xs bg-muted rounded-full px-2 py-0.5">
                              <MessageSquare className="h-3 w-3" />
                              {commentCount}
                            </span>
                          )}
                          {isExpanded
                            ? <ChevronDown className="h-4 w-4" />
                            : <ChevronRight className="h-4 w-4" />
                          }
                        </div>
                      </div>
                    </CardContent>

                    {/* Expanded comments section */}
                    {isExpanded && (
                      <div className="border-t px-4 pb-4 pt-3 space-y-3">
                        {/* Existing comments */}
                        {taskCommentList.length === 0 ? (
                          <p className="text-xs text-muted-foreground text-center py-2 italic">
                            Ende nuk ka komente për këtë detyrë
                          </p>
                        ) : (
                          <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                            {taskCommentList.map(comment => {
                              const isOwn = comment.userId === user?.uid;
                              const isClient = comment.senderType === 'client';
                              const profile = userProfiles?.find((p: any) => p.userId === comment.userId);
                              const name = isOwn ? 'Ju' : (profile?.displayName || (isClient ? 'Klienti' : 'Ekipi'));
                              const createdAt = comment.createdAt instanceof Date
                                ? comment.createdAt
                                : new Date(comment.createdAt as any);

                              return (
                                <div key={comment.id} className={`flex gap-2 ${isOwn ? 'flex-row-reverse' : 'flex-row'}`}>
                                  <div className={`w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center text-[9px] font-bold
                                    ${isOwn ? 'bg-primary text-primary-foreground' : isClient ? 'bg-emerald-100 text-emerald-700' : 'bg-muted text-muted-foreground'}`}>
                                    {name.slice(0, 2).toUpperCase()}
                                  </div>
                                  <div className={`max-w-[75%] flex flex-col gap-0.5 ${isOwn ? 'items-end' : 'items-start'}`}>
                                    <span className="text-[10px] text-muted-foreground px-1 flex items-center gap-1">
                                      {name}
                                      {!isOwn && !isClient && (
                                        <span className="text-[9px] bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-1 rounded">Ekipi</span>
                                      )}
                                    </span>
                                    <div className={`px-3 py-2 rounded-2xl text-sm
                                      ${isOwn
                                        ? 'bg-primary text-primary-foreground rounded-tr-sm'
                                        : 'bg-muted text-foreground rounded-tl-sm'}`}>
                                      {comment.content}
                                    </div>
                                    <span className="text-[10px] text-muted-foreground px-1">
                                      {createdAt.toLocaleString('sq-AL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {/* New comment input */}
                        <form
                          onSubmit={e => { e.preventDefault(); handleAddTaskComment(task.id); }}
                          className="flex gap-2"
                          onClick={e => e.stopPropagation()}
                        >
                          <Input
                            value={taskCommentTexts[task.id] || ''}
                            onChange={e => setTaskCommentTexts(prev => ({ ...prev, [task.id]: e.target.value }))}
                            placeholder="Shkruani koment për këtë detyrë..."
                            className="flex-1 text-sm"
                            onClick={e => e.stopPropagation()}
                          />
                          <Button
                            type="submit"
                            size="icon"
                            disabled={!(taskCommentTexts[task.id] || '').trim() || sendingTaskComment === task.id}
                            onClick={e => e.stopPropagation()}
                          >
                            <Send className="h-4 w-4" />
                          </Button>
                        </form>
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* ── Comments Tab ── */}
        <TabsContent value="comments" className="mt-4">
          <Card className="flex flex-col h-[500px]">
            <CardHeader className="pb-3 border-b flex-shrink-0">
              <CardTitle className="text-base flex items-center gap-2">
                <MessageSquare className="h-5 w-5 text-primary" />
                Komentet e Projektit
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Lini komente dhe diskutoni rreth projektit me ekipin
              </p>
            </CardHeader>

            <CardContent className="flex-1 overflow-hidden p-0">
              <ScrollArea className="h-full">
                <div ref={commentScrollRef} className="p-4 space-y-4">
                  {comments.length === 0 ? (
                    <div className="text-center py-12">
                      <MessageSquare className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                      <p className="text-muted-foreground text-sm">Nuk ka komente akoma</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Shkruani komentin tuaj më poshtë për të filluar diskutimin.
                      </p>
                    </div>
                  ) : (
                    comments.map(comment => {
                      const isOwn = comment.userId === user?.uid;
                      return (
                        <div
                          key={comment.id}
                          ref={registerComment(comment.id)}
                          className={`flex scroll-mt-24 ${isOwn ? 'justify-end' : 'justify-start'} ${
                            isFlashing(comment.id) ? `${COMMENT_FLASH_CLASS} p-1` : ''
                          }`}
                        >
                          <div className={`max-w-[75%] rounded-2xl px-4 py-2.5 ${
                            isOwn
                              ? 'bg-primary text-primary-foreground rounded-br-md'
                              : 'bg-muted rounded-bl-md'
                          }`}>
                            {!isOwn && (
                              <p className="text-xs font-semibold mb-1">
                                {getDisplayName(comment.userId, comment.senderType)}
                              </p>
                            )}
                            <p className="text-sm whitespace-pre-wrap break-words">{comment.content}</p>
                            <p className={`text-[10px] mt-1 ${
                              isOwn ? 'text-primary-foreground/60' : 'text-muted-foreground'
                            }`}>
                              {comment.createdAt instanceof Date
                                ? comment.createdAt.toLocaleString('sq-AL', {
                                    day: '2-digit', month: '2-digit',
                                    hour: '2-digit', minute: '2-digit',
                                  })
                                : ''}
                            </p>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </ScrollArea>
            </CardContent>

            <div className="border-t p-3 flex-shrink-0">
              <form onSubmit={handleSendComment} className="flex items-end gap-2">
                <Textarea
                  value={commentText}
                  onChange={e => setCommentText(e.target.value)}
                  onInput={e => { const t = e.currentTarget; t.style.height = 'auto'; t.style.height = `${Math.min(t.scrollHeight, 160)}px`; }}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendComment(e as any); } }}
                  rows={1}
                  placeholder="Shkruani komentin tuaj..."
                  className="flex-1 min-h-[40px] max-h-40 resize-none leading-snug"
                />
                <Button type="submit" size="icon" disabled={!commentText.trim()} className="flex-shrink-0">
                  <Send className="h-4 w-4" />
                </Button>
              </form>
            </div>
          </Card>
        </TabsContent>

      </Tabs>
    </div>
  );
};

export default PortalProjectDetailView;
