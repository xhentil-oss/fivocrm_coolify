import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCollection, useMutation } from '../hooks/useFirestore';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../contexts/PermissionsContext';
import { useToast } from '../hooks/use-toast';
import { getPriorityColor, getStatusColor } from '../lib/statusColors';
import {
  CheckCircle2, Clock, AlertTriangle, Flame, Target, TrendingUp,
  ArrowRight, Sparkles, Calendar, Zap, Flag,
  FolderKanban, MessageSquare, Users, ChevronRight, Timer, Coffee,
  Trophy
} from 'lucide-react';
import { Card } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import type {
  Task, Project, Customer, Invoice, TimeEntry,
  Activity, Goal
} from '../types';
import { useFilteredTasks, useFilteredProjects, useFilteredByOwner } from '../hooks/useRoleFilteredData';

// ── Greeting based on time of day ──
function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 6) return 'Natën e mirë';
  if (h < 12) return 'Mirëmëngjes';
  if (h < 17) return 'Mirëdita';
  if (h < 21) return 'Mirëmbrëmje';
  return 'Natën e mirë';
}

// ── Motivational quote rotation ──
const QUOTES = [
  { text: 'Suksesi nuk është përfundimtar, dështimi nuk është fatal: është guximi për të vazhduar që ka rëndësi.', author: 'W. Churchill' },
  { text: 'Puna e mirë nuk lind nga komoditeti, por nga përkushtimi.', author: 'Proverbë' },
  { text: 'Çdo ditë e re është mundësi e re.', author: 'Proverbë shqiptare' },
  { text: 'Fillo ku je, përdor çfarë ke, bëj çfarë mundesh.', author: 'Arthur Ashe' },
  { text: 'Kreativiteti kërkon guximin të lësh siguritë.', author: 'Erich Fromm' },
  { text: 'Planifiko punën, puno planin.', author: 'Proverbë' },
  { text: 'Përparimi nuk vjen nga përsosja, por nga përmirësimi.', author: 'Kaizen' },
];

function getDailyQuote() {
  const day = Math.floor(Date.now() / (1000 * 60 * 60 * 24));
  return QUOTES[day % QUOTES.length];
}

// ── Streak calculator ──
function calculateStreak(activities: (Activity & { id: string })[], userId: string): number {
  if (!activities || activities.length === 0) return 0;

  const userActivities = activities.filter(a => a.userId === userId);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Get unique days with activity
  const activeDays = new Set<string>();
  userActivities.forEach(a => {
    const d = a.createdAt instanceof Date ? a.createdAt : new Date(a.createdAt);
    activeDays.add(d.toISOString().split('T')[0]);
  });

  let streak = 0;
  const checkDate = new Date(today);

  // Count consecutive days backward from today
  while (true) {
    const key = checkDate.toISOString().split('T')[0];
    if (activeDays.has(key)) {
      streak++;
      checkDate.setDate(checkDate.getDate() - 1);
    } else {
      break;
    }
  }

  return streak;
}

const StaffDashboard: React.FC = () => {
  const { user } = useAuth();
  usePermissions(); // ensures teamId is synced
  const navigate = useNavigate();
  const { toast } = useToast();
  const [showAllMyTasks, setShowAllMyTasks] = useState(false);

  // ── Data fetching ──
  const { data: rawTasks } = useCollection<Task>('tasks');
  const { data: rawProjects } = useCollection<Project>('projects');
  const { data: rawCustomers } = useCollection<Customer>('customers');
  const { data: rawInvoices } = useCollection<Invoice>('invoices');
  const { data: rawGoals } = useCollection<Goal>('goals');
  const { data: activities } = useCollection<Activity>('activities');
  const { data: activeTimeEntries } = useCollection<TimeEntry>('timeEntries', {
    where: [{ field: 'endTime', operator: '==', value: null }]
  });
  const { data: userProfiles } = useCollection<any>('userProfiles');

  // Role-based filtering
  const tasks = useFilteredTasks(rawTasks);
  const projects = useFilteredProjects(rawProjects, rawTasks);
  const customers = useFilteredByOwner(rawCustomers);
  const invoices = useFilteredByOwner(rawInvoices);
  const goals = useFilteredByOwner(rawGoals);

  const taskMutation = useMutation<Task>('tasks');

  // ── Computed data ──
  const myTasks = useMemo(() => {
    if (!tasks || !user) return [];
    return tasks.filter(t => t.assignedToUserId === user.uid && t.status !== 'Done');
  }, [tasks, user]);

  const myCompletedToday = useMemo(() => {
    if (!tasks || !user) return [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return tasks.filter(t => {
      if (t.assignedToUserId !== user.uid || t.status !== 'Done') return false;
      const updated = t.updatedAt instanceof Date ? t.updatedAt : new Date(t.updatedAt);
      return updated >= today;
    });
  }, [tasks, user]);

  const myOverdueTasks = useMemo(() => {
    const now = new Date();
    return myTasks.filter(t => {
      const due = t.endDate || t.dueDate;
      if (!due) return false;
      const d = due instanceof Date ? due : new Date(due);
      return d < now;
    });
  }, [myTasks]);

  const myDueToday = useMemo(() => {
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    return myTasks.filter(t => {
      const due = t.endDate || t.dueDate;
      if (!due) return false;
      const d = due instanceof Date ? due : new Date(due);
      return d.toISOString().split('T')[0] === todayStr;
    });
  }, [myTasks]);

  const myDueThisWeek = useMemo(() => {
    const now = new Date();
    const weekEnd = new Date(now);
    weekEnd.setDate(weekEnd.getDate() + 7);
    return myTasks.filter(t => {
      const due = t.endDate || t.dueDate;
      if (!due) return false;
      const d = due instanceof Date ? due : new Date(due);
      return d >= now && d <= weekEnd;
    }).sort((a, b) => {
      const da = (a.endDate || a.dueDate) as Date;
      const db = (b.endDate || b.dueDate) as Date;
      return (da?.getTime() || 0) - (db?.getTime() || 0);
    });
  }, [myTasks]);

  // Smart task prioritization
  const prioritizedTasks = useMemo(() => {
    if (myTasks.length === 0) return [];

    // Build customer revenue map
    const customerRevenue = new Map<string, number>();
    invoices?.forEach(inv => {
      if (inv.customerId && (inv.status === 'Paid' || inv.status === 'Pending')) {
        customerRevenue.set(inv.customerId, (customerRevenue.get(inv.customerId) || 0) + (inv.total ?? inv.amount ?? 0));
      }
    });

    const projectMap = new Map<string, Project & { id: string }>();
    projects?.forEach(p => projectMap.set(p.id, p));

    return [...myTasks].sort((a, b) => {
      let scoreA = 0, scoreB = 0;

      // Priority weight
      const pw: Record<string, number> = { urgent: 40, high: 30, medium: 15, low: 5 };
      scoreA += pw[a.priority || 'medium'] || 15;
      scoreB += pw[b.priority || 'medium'] || 15;

      // Deadline proximity
      const now = Date.now();
      const dueA = (a.endDate || a.dueDate) as Date | undefined;
      const dueB = (b.endDate || b.dueDate) as Date | undefined;
      if (dueA) {
        const days = (new Date(dueA).getTime() - now) / 86400000;
        scoreA += days < 0 ? 35 : days < 1 ? 30 : days < 3 ? 20 : days < 7 ? 10 : 0;
      }
      if (dueB) {
        const days = (new Date(dueB).getTime() - now) / 86400000;
        scoreB += days < 0 ? 35 : days < 1 ? 30 : days < 3 ? 20 : days < 7 ? 10 : 0;
      }

      // Client revenue value
      if (a.projectId) {
        const proj = projectMap.get(a.projectId);
        if (proj?.customerId) scoreA += Math.min(15, (customerRevenue.get(proj.customerId) || 0) / 2000);
      }
      if (b.projectId) {
        const proj = projectMap.get(b.projectId);
        if (proj?.customerId) scoreB += Math.min(15, (customerRevenue.get(proj.customerId) || 0) / 2000);
      }

      // In Progress boost
      if (a.status === 'In Progress') scoreA += 5;
      if (b.status === 'In Progress') scoreB += 5;

      return scoreB - scoreA;
    });
  }, [myTasks, invoices, projects]);

  // My active timer
  const myActiveTimer = useMemo(() => {
    if (!activeTimeEntries || !user) return null;
    return activeTimeEntries.find(e => e.userId === user.uid) || null;
  }, [activeTimeEntries, user]);

  // Streak
  const streak = useMemo(() => {
    if (!activities || !user) return 0;
    return calculateStreak(activities, user.uid);
  }, [activities, user]);

  // My active projects
  const myProjects = useMemo(() => {
    if (!projects || !tasks || !user) return [];
    const myProjectIds = new Set(
      tasks.filter(t => t.assignedToUserId === user.uid && t.projectId).map(t => t.projectId!)
    );
    return projects
      .filter(p => myProjectIds.has(p.id) && p.status === 'Active')
      .slice(0, 4);
  }, [projects, tasks, user]);

  // Team activity: who's working on what right now
  const teamActivity = useMemo(() => {
    if (!activeTimeEntries || !tasks || !userProfiles) return [];
    return activeTimeEntries
      .filter(e => e.userId !== user?.uid)
      .map(entry => {
        const task = tasks.find(t => t.id === entry.taskId);
        const profile = userProfiles.find((p: any) => p.userId === entry.userId);
        return {
          userName: profile?.displayName || profile?.name || 'Anonim',
          taskTitle: task?.title || 'Detyrë e panjohur',
          userId: entry.userId,
        };
      })
      .slice(0, 5);
  }, [activeTimeEntries, tasks, userProfiles, user]);

  // Get project name for a task
  const getProjectName = (projectId?: string) => {
    if (!projectId || !projects) return '';
    return projects.find(p => p.id === projectId)?.name || '';
  };



  const formatDate = (date?: Date) => {
    if (!date) return '';
    const d = date instanceof Date ? date : new Date(date);
    const now = new Date();
    const diff = Math.ceil((d.getTime() - now.getTime()) / 86400000);
    if (diff < 0) return `${Math.abs(diff)}d vonuar`;
    if (diff === 0) return 'Sot';
    if (diff === 1) return 'Nesër';
    if (diff <= 7) return `${diff} ditë`;
    return d.toLocaleDateString('sq-AL', { day: 'numeric', month: 'short' });
  };

  const quote = getDailyQuote();
  const displayName = user?.displayName || user?.email?.split('@')[0] || 'Përdorues';
  const tasksToShow = showAllMyTasks ? prioritizedTasks : prioritizedTasks.slice(0, 6);

  // Quick complete task
  const handleQuickComplete = async (taskId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await taskMutation.update(taskId, { status: 'Done' });
    toast({ title: '✅ Detyrë e përfunduar!' });
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">

      {/* ── Hero: Greeting + Stats ── */}
      <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-primary/10 via-primary/5 to-transparent border border-primary/10 p-4 sm:p-6">
        <div className="relative z-10">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-foreground">
                {getGreeting()}, {displayName}! 👋
              </h1>
              <p className="text-sm text-muted-foreground mt-1 italic">
                "{quote.text}" — <span className="font-medium">{quote.author}</span>
              </p>
            </div>
            
            {/* Streak & quick stats */}
            <div className="flex items-center gap-3">
              {streak > 0 && (
                <div className="flex items-center gap-1.5 px-3 py-2 bg-orange-100 dark:bg-orange-900/30 rounded-lg">
                  <Flame className="w-5 h-5 text-orange-500" />
                  <div>
                    <div className="text-lg font-bold text-orange-600 dark:text-orange-400">{streak}</div>
                    <div className="text-[10px] text-orange-600/70 dark:text-orange-400/70 uppercase">ditë rresht</div>
                  </div>
                </div>
              )}
              {myCompletedToday.length > 0 && (
                <div className="flex items-center gap-1.5 px-3 py-2 bg-green-100 dark:bg-green-900/30 rounded-lg">
                  <Trophy className="w-5 h-5 text-green-500" />
                  <div>
                    <div className="text-lg font-bold text-green-600 dark:text-green-400">{myCompletedToday.length}</div>
                    <div className="text-[10px] text-green-600/70 dark:text-green-400/70 uppercase">sot</div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Background decoration */}
        <div className="absolute top-0 right-0 -mt-8 -mr-8 w-40 h-40 rounded-full bg-primary/5" />
        <div className="absolute bottom-0 right-16 -mb-6 w-24 h-24 rounded-full bg-primary/3" />
      </div>

      {/* ── Quick Stats Row ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card
          className="p-4 cursor-pointer hover:shadow-md transition-shadow border-l-4 border-l-blue-500"
          onClick={() => navigate('/app/tasks')}
        >
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30">
              <Target className="w-5 h-5 text-blue-500" />
            </div>
            <div>
              <div className="text-2xl font-bold text-foreground">{myTasks.length}</div>
              <div className="text-xs text-muted-foreground">Detyra aktive</div>
            </div>
          </div>
        </Card>
        <Card
          className={`p-4 cursor-pointer hover:shadow-md transition-shadow border-l-4 ${myOverdueTasks.length > 0 ? 'border-l-red-500' : 'border-l-green-500'}`}
          onClick={() => navigate('/app/tasks')}
        >
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${myOverdueTasks.length > 0 ? 'bg-red-100 dark:bg-red-900/30' : 'bg-green-100 dark:bg-green-900/30'}`}>
              {myOverdueTasks.length > 0 ? (
                <AlertTriangle className="w-5 h-5 text-red-500" />
              ) : (
                <CheckCircle2 className="w-5 h-5 text-green-500" />
              )}
            </div>
            <div>
              <div className="text-2xl font-bold text-foreground">{myOverdueTasks.length}</div>
              <div className="text-xs text-muted-foreground">
                {myOverdueTasks.length > 0 ? 'Vonuar!' : 'Asnjë vonuar'}
              </div>
            </div>
          </div>
        </Card>
        <Card
          className="p-4 cursor-pointer hover:shadow-md transition-shadow border-l-4 border-l-amber-500"
          onClick={() => navigate('/app/tasks')}
        >
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900/30">
              <Calendar className="w-5 h-5 text-amber-500" />
            </div>
            <div>
              <div className="text-2xl font-bold text-foreground">{myDueToday.length}</div>
              <div className="text-xs text-muted-foreground">Afat sot</div>
            </div>
          </div>
        </Card>
        <Card
          className="p-4 cursor-pointer hover:shadow-md transition-shadow border-l-4 border-l-purple-500"
          onClick={() => navigate('/app/projects')}
        >
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-900/30">
              <FolderKanban className="w-5 h-5 text-purple-500" />
            </div>
            <div>
              <div className="text-2xl font-bold text-foreground">{myProjects.length}</div>
              <div className="text-xs text-muted-foreground">Projekte aktive</div>
            </div>
          </div>
        </Card>
      </div>

      {/* ── Main Content: Two Column Layout ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* ── LEFT: My Tasks (Priority Ordered) ── */}
        <div className="lg:col-span-2 space-y-4">

          {/* Active Timer Banner */}
          {myActiveTimer && (
            <Card className="p-4 border-green-200 dark:border-green-800 bg-green-50/50 dark:bg-green-950/20">
              <div className="flex items-center gap-3">
                <div className="relative">
                  <Timer className="w-6 h-6 text-green-500" />
                  <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-green-500 rounded-full animate-pulse" />
                </div>
                <div className="flex-1">
                  <div className="text-sm font-medium text-green-700 dark:text-green-300">Duke punuar tani</div>
                  <div className="text-xs text-green-600 dark:text-green-400">
                    {tasks?.find(t => t.id === myActiveTimer.taskId)?.title || 'Detyrë aktive'}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="border-green-300 text-green-700 hover:bg-green-100 dark:border-green-700 dark:text-green-300"
                  onClick={() => navigate('/app/time-tracking')}
                >
                  <Clock className="w-3.5 h-3.5 mr-1" />
                  Shiko timer
                </Button>
              </div>
            </Card>
          )}

          {/* Priority Tasks Section */}
          <Card className="overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b bg-muted/30">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-amber-500" />
                <h2 className="font-semibold text-foreground">Çfarë duhet të bësh sot</h2>
                <Badge variant="secondary" className="text-[10px] h-5">
                  {prioritizedTasks.length} detyra
                </Badge>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate('/app/tasks')}
                className="text-xs text-muted-foreground"
              >
                Shiko të gjitha <ArrowRight className="w-3 h-3 ml-1" />
              </Button>
            </div>

            {prioritizedTasks.length === 0 ? (
              <div className="p-8 text-center">
                <Coffee className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
                <p className="text-sm font-medium text-foreground">Asnjë detyrë aktive!</p>
                <p className="text-xs text-muted-foreground mt-1">Koha për të marrë detyra të reja ose për pushim ☕</p>
              </div>
            ) : (
              <div className="divide-y">
                {tasksToShow.map((task, i) => {
                  const due = task.endDate || task.dueDate;
                  const isOverdue = due && new Date(due) < new Date();
                  const projectName = getProjectName(task.projectId);

                  return (
                    <div
                      key={task.id}
                      className={`flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-muted/40 transition-colors group ${
                        isOverdue ? 'bg-red-50/50 dark:bg-red-950/10' : ''
                      }`}
                      onClick={() => {
                        navigate(`/app/tasks?taskId=${task.id}`);
                      }}
                    >
                      {/* Quick complete button */}
                      <button
                        onClick={(e) => handleQuickComplete(task.id, e)}
                        className="mt-0.5 w-5 h-5 rounded-full border-2 border-gray-300 dark:border-gray-600 hover:border-green-500 hover:bg-green-50 dark:hover:bg-green-900/30 transition-colors flex items-center justify-center group/check"
                      >
                        <CheckCircle2 className="w-3 h-3 text-transparent group-hover/check:text-green-500 transition-colors" />
                      </button>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-foreground truncate">{task.title}</span>
                          {i === 0 && (
                            <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400 text-[9px] px-1 h-4">
                              <Zap className="w-2.5 h-2.5 mr-0.5" /> Fillo këtu
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          {task.priority && (
                            <Badge variant="secondary" className={`text-[10px] px-1.5 h-4 ${getPriorityColor(task.priority)}`}>
                              <Flag className="w-2.5 h-2.5 mr-0.5" />
                              {task.priority === 'urgent' ? 'Urgjent' : task.priority === 'high' ? 'I lartë' : task.priority === 'medium' ? 'Mesatar' : 'I ulët'}
                            </Badge>
                          )}
                          {projectName && (
                            <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                              {projectName}
                            </span>
                          )}
                          <Badge
                            variant="secondary"
                            className={`text-[10px] h-4 ${getStatusColor(task.status)}`}
                          >
                            {task.status === 'In Progress' ? 'Në progres' : task.status === 'Review' ? 'Rishikim' : 'Për të bërë'}
                          </Badge>
                        </div>
                      </div>

                      {/* Due date */}
                      {due && (
                        <span className={`text-[11px] font-medium whitespace-nowrap mt-1 ${
                          isOverdue ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground'
                        }`}>
                          {isOverdue && <AlertTriangle className="w-3 h-3 inline mr-0.5" />}
                          {formatDate(due as Date)}
                        </span>
                      )}
                    </div>
                  );
                })}

                {prioritizedTasks.length > 6 && (
                  <button
                    onClick={() => setShowAllMyTasks(!showAllMyTasks)}
                    className="w-full px-4 py-2.5 text-xs text-primary hover:bg-muted/40 transition-colors font-medium"
                  >
                    {showAllMyTasks ? 'Shfaq më pak' : `Shfaq ${prioritizedTasks.length - 6} të tjera`}
                  </button>
                )}
              </div>
            )}
          </Card>

          {/* My Projects Quick View */}
          {myProjects.length > 0 && (
            <Card className="overflow-hidden">
              <div className="flex items-center justify-between p-4 border-b bg-muted/30">
                <div className="flex items-center gap-2">
                  <FolderKanban className="w-4 h-4 text-purple-500" />
                  <h2 className="font-semibold text-foreground">Projektet e mia</h2>
                </div>
                <Button variant="ghost" size="sm" onClick={() => navigate('/app/projects')} className="text-xs text-muted-foreground">
                  Të gjitha <ArrowRight className="w-3 h-3 ml-1" />
                </Button>
              </div>
              <div className="divide-y">
                {myProjects.map(project => {
                  const projectTasks = tasks?.filter(t => t.projectId === project.id) || [];
                  const doneTasks = projectTasks.filter(t => t.status === 'Done').length;
                  const totalTasks = projectTasks.length;
                  const pct = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;
                  const customer = customers?.find(c => c.id === project.customerId);

                  return (
                    <div
                      key={project.id}
                      className="flex items-center gap-4 px-4 py-3 cursor-pointer hover:bg-muted/40 transition-colors"
                      onClick={() => navigate(`/app/projects/${project.id}`)}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-foreground truncate">{project.name}</span>
                          {customer && (
                            <span className="text-[10px] text-muted-foreground">• {customer.name}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-1.5">
                          <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${
                                pct >= 80 ? 'bg-green-500' : pct >= 40 ? 'bg-blue-500' : 'bg-amber-500'
                              }`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="text-[10px] text-muted-foreground tabular-nums">{pct}%</span>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs font-medium text-foreground">{doneTasks}/{totalTasks}</div>
                        <div className="text-[10px] text-muted-foreground">detyra</div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                    </div>
                  );
                })}
              </div>
            </Card>
          )}
        </div>

        {/* ── RIGHT SIDEBAR ── */}
        <div className="space-y-4">

          {/* Due This Week */}
          {myDueThisWeek.length > 0 && (
            <Card className="overflow-hidden">
              <div className="p-3 border-b bg-amber-50/50 dark:bg-amber-950/20">
                <div className="flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-amber-500" />
                  <h3 className="text-sm font-semibold text-foreground">Afate këtë javë</h3>
                  <Badge variant="secondary" className="text-[10px] h-4 bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">
                    {myDueThisWeek.length}
                  </Badge>
                </div>
              </div>
              <div className="divide-y">
                {myDueThisWeek.slice(0, 5).map(task => (
                  <div
                    key={task.id}
                    className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-muted/40 text-sm"
                    onClick={() => navigate(`/app/tasks?taskId=${task.id}`)}
                  >
                    <Flag className={`w-3 h-3 flex-shrink-0 ${
                      task.priority === 'urgent' ? 'text-red-500' :
                      task.priority === 'high' ? 'text-orange-500' :
                      task.priority === 'medium' ? 'text-blue-500' : 'text-green-500'
                    }`} />
                    <span className="flex-1 truncate text-xs">{task.title}</span>
                    <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                      {formatDate((task.endDate || task.dueDate) as Date)}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Team Activity: Who's working on what */}
          {teamActivity.length > 0 && (
            <Card className="overflow-hidden">
              <div className="p-3 border-b bg-muted/30">
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-blue-500" />
                  <h3 className="text-sm font-semibold text-foreground">Ekipi tani</h3>
                </div>
              </div>
              <div className="divide-y">
                {teamActivity.map((activity, i) => (
                  <div key={i} className="flex items-center gap-2.5 px-3 py-2.5">
                    <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-bold text-primary flex-shrink-0">
                      {activity.userName.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-foreground truncate">{activity.userName}</div>
                      <div className="text-[10px] text-muted-foreground truncate flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse flex-shrink-0" />
                        {activity.taskTitle}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Goals Progress */}
          {goals && goals.filter(g => g.status !== 'Completed').length > 0 && (
            <Card className="overflow-hidden">
              <div className="p-3 border-b bg-muted/30">
                <div className="flex items-center gap-2">
                  <Target className="w-4 h-4 text-emerald-500" />
                  <h3 className="text-sm font-semibold text-foreground">Objektivat</h3>
                </div>
              </div>
              <div className="divide-y">
                {goals
                  .filter(g => g.status !== 'Completed')
                  .slice(0, 3)
                  .map(goal => {
                    const pct = goal.targetValue && goal.currentValue
                      ? Math.round((goal.currentValue / goal.targetValue) * 100)
                      : 0;
                    return (
                      <div key={goal.id} className="px-3 py-2.5">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium text-foreground truncate">{goal.title}</span>
                          <span className="text-[10px] text-muted-foreground">{pct}%</span>
                        </div>
                        <div className="h-1.5 bg-muted rounded-full overflow-hidden mt-1.5">
                          <div
                            className={`h-full rounded-full ${
                              pct >= 80 ? 'bg-emerald-500' : pct >= 50 ? 'bg-blue-500' : 'bg-amber-500'
                            }`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
              </div>
            </Card>
          )}

          {/* Quick Navigation */}
          <Card className="p-3">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Veprime të shpejta</h3>
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                size="sm"
                className="justify-start text-xs h-9"
                onClick={() => navigate('/app/tasks')}
              >
                <CheckCircle2 className="w-3.5 h-3.5 mr-1.5 text-blue-500" />
                Detyrat
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="justify-start text-xs h-9"
                onClick={() => navigate('/app/chat')}
              >
                <MessageSquare className="w-3.5 h-3.5 mr-1.5 text-green-500" />
                Chat
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="justify-start text-xs h-9"
                onClick={() => navigate('/app/time-tracking')}
              >
                <Timer className="w-3.5 h-3.5 mr-1.5 text-purple-500" />
                Kohë
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="justify-start text-xs h-9"
                onClick={() => navigate('/app/reports')}
              >
                <TrendingUp className="w-3.5 h-3.5 mr-1.5 text-amber-500" />
                Raportet
              </Button>
            </div>
          </Card>

        </div>
      </div>
    </div>
  );
};

export default StaffDashboard;
