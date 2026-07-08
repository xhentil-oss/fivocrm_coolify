import React, { useState, useRef, useEffect } from 'react';
import { addDoc, collection, Timestamp } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useClientPortal } from '../../hooks/useClientPortal';
import { useAuth } from '../../contexts/AuthContext';
import { useCollection, useMutation, useDocument } from '../../hooks/useFirestore';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Textarea } from '../../components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { ScrollArea } from '../../components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../../components/ui/dialog';

import {
  FolderKanban, ArrowLeft, CheckCircle2, Clock, Circle,
  MessageSquare, Send, ClipboardList, Plus, DollarSign,
  CalendarDays, ChevronDown, ChevronRight,
} from 'lucide-react';
import { useToast } from '../../hooks/use-toast';
import type { Project, Task, TaskComment, ClientRequest, Team, TeamMember } from '../../types';

interface ProjectComment {
  id: string;
  projectId: string;
  content: string;
  userId: string;
  senderType: 'client' | 'team';
  createdAt: Date;
  updatedAt: Date;
}

const CATEGORIES = [
  { value: 'Design', label: 'Dizajn' },
  { value: 'Development', label: 'Zhvillim' },
  { value: 'Support', label: 'Suport Teknik' },
  { value: 'Marketing', label: 'Marketing' },
  { value: 'Consulting', label: 'Konsulencë' },
  { value: 'Other', label: 'Tjetër' },
] as const;

const PRIORITIES = [
  { value: 'low', label: 'E Ulët' },
  { value: 'medium', label: 'Mesatare' },
  { value: 'high', label: 'E Lartë' },
  { value: 'urgent', label: 'Urgjente' },
] as const;

const PortalProjectDetailView: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { customerId } = useClientPortal();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState('overview');
  const [commentText, setCommentText] = useState('');
  const [isRequestOpen, setIsRequestOpen] = useState(false);
  const commentScrollRef = useRef<HTMLDivElement>(null);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [taskCommentTexts, setTaskCommentTexts] = useState<Record<string, string>>({});
  const [sendingTaskComment, setSendingTaskComment] = useState<string | null>(null);

  // Fetch project
  const { data: project } = useDocument<Project>('projects', projectId || '');

  // Fetch tasks for this project, scoped by customerId so the RLS rule
  // (isPortalClientFor) holds for every returned doc.
  const { data: rawTasks } = useCollection<Task>('tasks', {
    where: customerId
      ? [
          { field: 'projectId', operator: '==', value: projectId || '' },
          { field: 'customerId', operator: '==', value: customerId },
        ]
      : [{ field: 'projectId', operator: '==', value: projectId || '' }],
    skipTeamFilter: true,
  });
  const tasks = React.useMemo(() => {
    if (!rawTasks) return [];
    return [...rawTasks].sort((a, b) => {
      const statusOrder: Record<string, number> = { 'In Progress': 0, 'Todo': 1, 'Review': 2, 'Done': 3 };
      return (statusOrder[a.status] ?? 4) - (statusOrder[b.status] ?? 4);
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
  // (isPortalClientFor) holds for every returned doc.
  const { data: rawComments } = useCollection<ProjectComment>('projectComments', {
    where: customerId
      ? [
          { field: 'projectId', operator: '==', value: projectId || '' },
          { field: 'customerId', operator: '==', value: customerId },
        ]
      : [{ field: 'projectId', operator: '==', value: projectId || '' }],
    skipTeamFilter: true,
  });
  const comments = React.useMemo(() => {
    if (!rawComments) return [];
    return [...rawComments].sort((a, b) => {
      const ta = a.createdAt instanceof Date ? a.createdAt.getTime() : 0;
      const tb = b.createdAt instanceof Date ? b.createdAt.getTime() : 0;
      return ta - tb;
    });
  }, [rawComments]);

  // Requests linked to this project
  const { data: rawRequests } = useCollection<ClientRequest>('clientRequests', {
    where: [{ field: 'customerId', operator: '==', value: customerId || '' }],
    skipTeamFilter: true,
  });
  const projectRequests = React.useMemo(() => {
    if (!rawRequests) return [];
    return rawRequests
      .filter(r => (r as any).projectId === projectId)
      .sort((a, b) => {
        const ta = a.createdAt instanceof Date ? a.createdAt.getTime() : 0;
        const tb = b.createdAt instanceof Date ? b.createdAt.getTime() : 0;
        return tb - ta;
      });
  }, [rawRequests, projectId]);

  // Teams and members for notifications
  const { data: teams } = useCollection<Team>('teams');
  const { data: allTeamMembers } = useCollection<TeamMember>('teamMembers', {
    where: [{ field: 'status', operator: '==', value: 'Active' }],
    skipTeamFilter: true, // portal client has no businessId → avoids the loading-forever guard
  });

  // User profiles for comment display names
  const { data: userProfiles } = useCollection<any>('userProfiles');

  const notificationMutation = useMutation<any>('notifications');

  // Auto-scroll comments
  useEffect(() => {
    if (commentScrollRef.current) {
      commentScrollRef.current.scrollTop = commentScrollRef.current.scrollHeight;
    }
  }, [comments]);

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
      case 'Review': return <Clock className="h-4 w-4 text-purple-500" />;
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

  const getRequestStatusColor = (status: string) => {
    switch (status) {
      case 'New': return 'bg-blue-100 text-blue-800';
      case 'In Review': return 'bg-purple-100 text-purple-800';
      case 'In Progress': return 'bg-yellow-100 text-yellow-800';
      case 'Completed': return 'bg-green-100 text-green-800';
      case 'Rejected': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  // Send comment
  const handleSendComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commentText.trim() || !user || !projectId) return;

    try {
      // Use addDoc — portal users can't use useMutation.create() on team-scoped collections
      const commentTeamId = allTeamMembers?.find((m: any) => m.teamId)?.teamId || null;
      await addDoc(collection(db, 'projectComments'), {
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

      // Notify project team
      if (project?.teamId && allTeamMembers) {
        const projectTeamMembers = allTeamMembers.filter(
          m => m.teamId === project.teamId && m.status === 'Active'
        );
        for (const member of projectTeamMembers) {
          notificationMutation.create({
            userId: member.userId,
            type: 'project_comment',
            title: `Koment i ri nga klienti — ${project.name}`,
            message: commentText.length > 100 ? commentText.slice(0, 100) + '...' : commentText,
            isRead: false,
            actionType: 'navigate',
            actionUrl: `/app/projects/${projectId}`,
            actionLabel: 'Shiko Projektin',
          } as any).catch(err => console.error('[Notifications] project_comment dërgim dështoi:', err));
        }
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
      const resolvedTeamId = allTeamMembers?.find((m: any) => m.teamId)?.teamId || null;
      await addDoc(collection(db, 'taskComments'), {
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

      // Notify task assignee + project team members
      const task = tasks.find(t => t.id === taskId);
      if (project?.teamId && allTeamMembers) {
        const notifyIds = new Set<string>();
        // Task assignee
        if (task?.assignedToUserId) notifyIds.add(task.assignedToUserId);
        // All active team members of the project
        allTeamMembers
          .filter(m => m.teamId === project.teamId && m.status === 'Active')
          .forEach(m => notifyIds.add(m.userId));

        for (const uid of notifyIds) {
          notificationMutation.create({
            userId: uid,
            type: 'project_comment',
            title: `Koment klienti — ${task?.title || 'Detyrë'}`,
            message: text.length > 100 ? text.slice(0, 100) + '...' : text,
            isRead: false,
            actionUrl: `/app/tasks?task=${taskId}`,
            actionLabel: 'Shiko Detyrën',
          } as any).catch(() => {});
        }
      }

      setTaskCommentTexts(prev => ({ ...prev, [taskId]: '' }));
      toast({ title: 'Komenti u dërgua' });
    } catch {
      toast({ title: 'Gabim', description: 'Komenti nuk u dërgua.', variant: 'destructive' });
    } finally {
      setSendingTaskComment(null);
    }
  };

  // Smart routing for requests (same logic as PortalRequestsView)
  const getTeamForCategory = (category: string): string | undefined => {
    if (!teams) return undefined;
    const deptMap: Record<string, string[]> = {
      Design: ['design', 'dizajn', 'kreativ', 'creative'],
      Development: ['development', 'zhvillim', 'dev', 'it', 'tech', 'teknologji'],
      Support: ['support', 'suport', 'helpdesk'],
      Marketing: ['marketing'],
      Consulting: ['consulting', 'konsulencë', 'management', 'menaxhim'],
    };
    const keywords = deptMap[category] || [];
    const match = teams.find(team => {
      const dept = (team.department || '').toLowerCase();
      const name = (team.name || '').toLowerCase();
      return keywords.some(k => dept.includes(k) || name.includes(k));
    });
    return match?.id;
  };

  // Create support request linked to this project
  const handleCreateRequest = async (formData: FormData) => {
    const title = formData.get('title') as string;
    const description = formData.get('description') as string;
    const category = formData.get('category') as string;
    const priority = formData.get('priority') as string;

    if (!title || !description || !category || !priority || !user || !customerId || !projectId) return;

    const assignedTeamId = getTeamForCategory(category) || project?.teamId;

    // Use addDoc directly — portal users have getGlobalTeamId()=null which makes
    // useMutation.create() throw for team-scoped collections.
    const resolvedTeamId = allTeamMembers?.find((m: any) => m.teamId)?.teamId || null;
    await addDoc(collection(db, 'clientRequests'), {
      customerId,
      clientUserId: user.uid,
      title,
      description,
      category,
      status: 'New',
      priority,
      ...(assignedTeamId ? { assignedTeamId } : {}),
      projectId,
      ...(resolvedTeamId ? { teamId: resolvedTeamId } : {}),
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      createdByUserId: user.uid,
    });

    // Notify team — only admins of THIS project's tenant (allTeamMembers is read
    // cross-tenant, so scope by the project's businessId to avoid notifying other
    // tenants' admins / the platform super-admin).
    const projBiz = (project as any)?.businessId;
    const adminMembers = allTeamMembers?.filter(m => m.role === 'Admin' && (!projBiz || (m as any).businessId === projBiz)) || [];
    const assignedMembers = assignedTeamId
      ? allTeamMembers?.filter(m => m.teamId === assignedTeamId) || []
      : [];
    const notifyIds = new Set([...adminMembers.map(m => m.userId), ...assignedMembers.map(m => m.userId)]);

    for (const uid of notifyIds) {
      notificationMutation.create({
        userId: uid,
        type: 'client_request',
        title: `Kërkesë e re — ${project?.name || 'Projekt'}`,
        message: title,
        isRead: false,
        actionType: 'navigate',
        actionUrl: `/app/projects/${projectId}`,
        actionLabel: 'Shiko Projektin',
      } as any).catch(err => console.error('[Notifications] client_request dërgim dështoi:', err));
    }

    setIsRequestOpen(false);
    toast({
      title: 'Kërkesa u dërgua',
      description: 'Ekipi ynë do ta shqyrtojë kërkesën tuaj së shpejti.',
    });
  };

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

      {/* Budget info */}
      {project.budget != null && project.budget > 0 && (
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <DollarSign className="h-5 w-5 text-muted-foreground" />
                <span className="text-sm font-medium">Buxheti</span>
              </div>
              <div className="text-right">
                <span className="font-semibold">{(project.spent || 0).toLocaleString()}</span>
                <span className="text-muted-foreground"> / {project.budget.toLocaleString()} ALL</span>
              </div>
            </div>
            <div className="w-full h-2 bg-muted rounded-full overflow-hidden mt-2">
              <div
                className={`h-full rounded-full transition-all ${
                  (project.spent || 0) > project.budget ? 'bg-red-500' : 'bg-primary'
                }`}
                style={{ width: `${Math.min(100, Math.round(((project.spent || 0) / project.budget) * 100))}%` }}
              />
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
                        <div key={comment.id} className={`flex ${isOwn ? 'justify-end' : 'justify-start'}`}>
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
