import React, { useMemo, useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCollection, useMutation } from '../hooks/useFirestore';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../contexts/PermissionsContext';
import ActivationChecklist from '../components/ActivationChecklist';
import { useToast } from '../hooks/use-toast';
import { getPriorityColor, getStatusColor } from '../lib/statusColors';
import {
  CheckCircle2,
  Clock,
  AlertTriangle,
  Flame,
  Target,
  ArrowRight,
  Sparkles,
  Calendar,
  Zap,
  Flag,
  FolderKanban,
  MessageSquare,
  Users,
  ChevronRight,
  Timer,
  Coffee,
  Trophy,
  BarChart3,
  FileCheck,
} from 'lucide-react';
import { Card } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import type {
  Task, Project, Customer, Invoice, TimeEntry,
  Activity, Goal, DailyReport
} from '../types';
import { useFilteredTasks, useFilteredProjects, useFilteredByOwner } from '../hooks/useRoleFilteredData';
import MomentumWidget from '../components/MomentumWidget';


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
    const d = (a.createdAt as any)?.toDate?.() instanceof Date
      ? (a.createdAt as any).toDate()
      : (a.createdAt instanceof Date ? a.createdAt : new Date(a.createdAt as any));
    activeDays.add(d.toLocaleDateString('sv'));
  });

  let streak = 0;
  const checkDate = new Date(today);

  // Count consecutive days backward from today
  while (true) {
    const key = checkDate.toLocaleDateString('sv');
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
  const { isGuest, dataScope } = usePermissions(); // also ensures teamId is synced
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
  const { data: allTimeEntries } = useCollection<TimeEntry>('timeEntries');
  const { data: dailyReports } = useCollection<DailyReport>('dailyReports');
  const { data: userProfiles } = useCollection<any>('userProfiles');
  // Bounded on purpose: this feeds badge counts, not a feed. Without `limit` the
  // live listener downloaded the user's ENTIRE notification history on every mount —
  // and since the cleanup job was broken, that history only ever grew.
  const { data: allUserNotifs } = useCollection<any>('notifications', {
    skip: !user,
    where: user ? [{ field: 'userId', operator: '==', value: user.uid }] : undefined,
    orderBy: { field: 'createdAt', direction: 'desc' },
    limit: 100,
    skipTeamFilter: true,
  });

  // Role-based filtering
  const tasks = useFilteredTasks(rawTasks);
  const projects = useFilteredProjects(rawProjects, rawTasks);
  const customers = useFilteredByOwner(rawCustomers);
  const invoices = useFilteredByOwner(rawInvoices);
  const goals = useFilteredByOwner(rawGoals);

  const taskMutation = useMutation<Task>('tasks');

  // ── "Today" section: tasks due today OR overdue (open), grouped per person ──
  // Definition (Asana "Today" style): endDate (or dueDate) <= today AND not Done.
  // Role scope: Admin sees every member's tasks; Member sees their own; SalesAgent
  // sees tasks they created (incl. assigned to others) + assigned to them.
  // Admins additionally see across ALL teams where they are Admin (not just active).
  const canSeeTeamDay = !isGuest;

  // The current user's team memberships → all teams where they are Admin.
  const myMembershipsQuery = useMemo(() => ({
    where: user ? [{ field: 'userId', operator: '==' as const, value: user.uid }] : undefined,
    skipTeamFilter: true,
    skip: !user,
  }), [user?.uid]);
  const { data: myMemberships } = useCollection<any>('teamMembers', myMembershipsQuery);

  const adminTeamIds = useMemo(() => {
    if (dataScope !== 'all') return [];
    return (myMemberships || [])
      .filter((m: any) => m.role === 'Admin' && (m.status === 'Active' || !m.status))
      .map((m: any) => m.teamId)
      .filter(Boolean)
      .slice(0, 30); // Firestore 'in' supports up to 30 values
  }, [myMemberships, dataScope]);

  // For admins, pull tasks across all their admin teams (not just the active one).
  const crossTeamTasksQuery = useMemo(() => ({
    where: adminTeamIds.length ? [{ field: 'teamId', operator: 'in' as const, value: adminTeamIds }] : undefined,
    skipTeamFilter: true,
    skip: adminTeamIds.length === 0,
  }), [adminTeamIds]);
  const { data: crossTeamTasks } = useCollection<Task>('tasks', crossTeamTasksQuery);

  const teamDueTodayByPerson = useMemo(() => {
    if (!canSeeTeamDay) return [];
    // Admin → all tasks across their admin teams; otherwise the role-filtered set.
    const source: Task[] = (dataScope === 'all' && adminTeamIds.length > 0) ? (crossTeamTasks || []) : (tasks || []);
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfToday = new Date(startOfToday.getTime() + 86400000);
    const dueOf = (t: Task): Date | null => {
      const due: any = (t as any).endDate || (t as any).dueDate;
      if (!due) return null;
      if (typeof due?.toDate === 'function') return due.toDate();
      if (due instanceof Date) return due;
      const d = new Date(due);
      return isNaN(d.getTime()) ? null : d;
    };
    const UNASSIGNED = '__unassigned__';
    const groups = new Map<string, { userId: string; name: string; tasks: { task: Task; overdue: boolean }[]; overdue: number }>();
    for (const t of source) {
      if (t.status === 'Done') continue;            // open only
      const due = dueOf(t);
      if (!due || due >= endOfToday) continue;       // due today or earlier (overdue)
      const isOverdue = due < startOfToday;
      const uid = t.assignedToUserId || UNASSIGNED;
      if (!groups.has(uid)) {
        const profile = uid === UNASSIGNED ? null : userProfiles?.find((p: any) => p.userId === uid);
        const name = uid === UNASSIGNED ? 'Pa caktuar' : (profile?.displayName || profile?.name || 'Anonim');
        groups.set(uid, { userId: uid, name, tasks: [], overdue: 0 });
      }
      const g = groups.get(uid)!;
      g.tasks.push({ task: t, overdue: isOverdue });
      if (isOverdue) g.overdue++;
    }
    return Array.from(groups.values()).sort((a, b) => {
      if (a.userId === UNASSIGNED) return 1;
      if (b.userId === UNASSIGNED) return -1;
      return b.tasks.length - a.tasks.length;
    });
  }, [canSeeTeamDay, dataScope, adminTeamIds, crossTeamTasks, tasks, userProfiles]);

  const teamDueTodayTotal = useMemo(
    () => teamDueTodayByPerson.reduce((s, g) => s + g.tasks.length, 0),
    [teamDueTodayByPerson]
  );

  // ── Unread client messages: count from notifications ──
  const unreadClientMsgs = useMemo(
    () => allUserNotifs?.filter((n: any) => n.type === 'client_message' && !n.isRead).length || 0,
    [allUserNotifs]
  );

  // ── Toast when new client message arrives ──
  const prevClientMsgCountRef = useRef(0);
  const clientMsgFirstLoadRef = useRef(true);
  useEffect(() => {
    if (clientMsgFirstLoadRef.current) {
      clientMsgFirstLoadRef.current = false;
      prevClientMsgCountRef.current = unreadClientMsgs;
      return;
    }
    if (unreadClientMsgs > prevClientMsgCountRef.current) {
      toast({
        title: '🐦 Mesazh i ri nga klienti!',
        description: 'Klikoni zogun për të parë mesazhin.',
      });
    }
    prevClientMsgCountRef.current = unreadClientMsgs;
  }, [unreadClientMsgs]);

  // ── Computed data ──
  // teamMembers.userId (and therefore task.assignedToUserId) may be stored as the
  // Firebase UID *or* the user's email, so match against both — otherwise tasks
  // assigned by email are invisible on the dashboard while showing in the Tasks module.
  const myIds = useMemo(() => {
    if (!user) return [] as string[];
    return user.email ? [user.uid, user.email] : [user.uid];
  }, [user]);
  const isMine = (t: Task) => !!t.assignedToUserId && myIds.includes(t.assignedToUserId);

  const myTasks = useMemo(() => {
    if (!tasks || !user) return [];
    return tasks.filter(t => isMine(t) && t.status !== 'Done');
  }, [tasks, user, myIds]);

  const myCompletedToday = useMemo(() => {
    if (!tasks || !user) return [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return tasks.filter(t => {
      if (!isMine(t) || t.status !== 'Done') return false;
      const updated = t.updatedAt instanceof Date ? t.updatedAt : new Date(t.updatedAt);
      return updated >= today;
    });
  }, [tasks, user, myIds]);

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
    const todayStr = now.toLocaleDateString('sv');
    return myTasks.filter(t => {
      const due = t.endDate || t.dueDate;
      if (!due) return false;
      const d = (due as any)?.toDate?.() instanceof Date ? (due as any).toDate() : (due instanceof Date ? due : new Date(due as any));
      return d.toLocaleDateString('sv') === todayStr;
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

  // ── Daily Productivity ──
  const DAILY_TASK_TARGET = 5;

  const todayTrackedHours = useMemo(() => {
    if (!allTimeEntries || !user) return 0;
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    let totalMs = 0;
    allTimeEntries.forEach(e => {
      if (e.userId !== user.uid) return;
      const start = e.startTime instanceof Date ? e.startTime : new Date(e.startTime);
      if (start < todayStart) return;
      if (e.endTime) {
        const end = e.endTime instanceof Date ? e.endTime : new Date(e.endTime);
        totalMs += end.getTime() - start.getTime();
      } else {
        totalMs += Date.now() - start.getTime();
      }
    });
    return totalMs / 3600000; // convert to hours
  }, [allTimeEntries, user]);

  const todayReportSubmitted = useMemo(() => {
    if (!dailyReports || !user) return false;
    const todayStr = new Date().toLocaleDateString('sv');
    return dailyReports.some(r => r.userId === user.uid && r.date === todayStr);
  }, [dailyReports, user]);

  const dailyProductivityPct = useMemo(() => {
    const tasksPct = Math.min(100, (myCompletedToday.length / DAILY_TASK_TARGET) * 100);
    const hoursPct = Math.min(100, (todayTrackedHours / 8) * 100);
    const reportPct = todayReportSubmitted ? 100 : 0;
    // Weight: tasks 50%, hours 35%, report 15%
    return Math.round(tasksPct * 0.5 + hoursPct * 0.35 + reportPct * 0.15);
  }, [myCompletedToday, todayTrackedHours, todayReportSubmitted]);

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
    <>
      {/* <AdminTestPopup /> removed: popup feature no longer used */}
      <div className="max-w-6xl mx-auto space-y-6">

      {/* Activation path for a new tenant — hides itself once every step is done. */}
      <ActivationChecklist />

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
              <div className="text-xs text-muted-foreground">Detyrat e mia aktive</div>
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
          className="p-4 cursor-pointer hover:shadow-md transition-shadow border-l-4 border-l-primary"
          onClick={() => navigate('/app/projects')}
        >
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-accent-soft dark:bg-primary/10">
              <FolderKanban className="w-5 h-5 text-primary" />
            </div>
            <div>
              <div className="text-2xl font-bold text-foreground">{myProjects.length}</div>
              <div className="text-xs text-muted-foreground">Projekte aktive</div>
            </div>
          </div>
        </Card>
      </div>

      {/* ── ADMIN/MANAGER: Team tasks due today, per person ── */}
      {canSeeTeamDay && (
        <Card className="overflow-hidden">
          <div className="p-4 border-b flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30">
                <Users className="w-5 h-5 text-blue-500" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-foreground">Për sot · sipas personit</h2>
                <p className="text-xs text-muted-foreground">
                  Me afat sot ose të vonuara · {new Date().toLocaleDateString('sq-AL', { weekday: 'long', day: 'numeric', month: 'long' })}
                </p>
              </div>
            </div>
            <Badge variant="secondary">{teamDueTodayTotal} detyra</Badge>
          </div>
          <div className="p-4">
            {teamDueTodayByPerson.length === 0 ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-4 justify-center">
                <CheckCircle2 className="w-4 h-4 text-green-500" />
                Asnjë detyrë e hapur për sot apo e vonuar.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {teamDueTodayByPerson.map(group => (
                  <div key={group.userId} className="rounded-lg border p-3">
                    <div className="flex items-center justify-between mb-2 gap-2">
                      <span className="text-sm font-medium text-foreground truncate" title={group.name}>
                        {group.name}
                      </span>
                      <div className="flex items-center gap-1 shrink-0">
                        {group.overdue > 0 && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-destructive border-destructive/40">
                            {group.overdue} vonë
                          </Badge>
                        )}
                        <Badge variant="outline">{group.tasks.length}</Badge>
                      </div>
                    </div>
                    <ul className="space-y-1.5">
                      {group.tasks.map(({ task: t, overdue }) => (
                        <li
                          key={t.id}
                          className="flex items-center gap-2 text-xs cursor-pointer hover:bg-muted/50 rounded px-1 py-0.5"
                          onClick={() => navigate('/app/tasks')}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full shrink-0 ${overdue ? 'bg-destructive' : 'bg-muted-foreground/40'}`}
                            title={overdue ? 'E vonuar' : undefined}
                          />
                          <span className="truncate flex-1 text-foreground">
                            {t.title}
                          </span>
                          <Badge className={`shrink-0 text-[10px] px-1.5 py-0 ${getStatusColor(t.status)}`}>
                            {t.status}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>
      )}

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
                  <FolderKanban className="w-4 h-4 text-primary" />
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

          {/* Momentum snapshot — score, level, streak, frog */}
          <MomentumWidget tasks={tasks} timeEntries={allTimeEntries || []} dailyReports={dailyReports || []} />

          {/* Daily Productivity */}
          <Card className="overflow-hidden">
            <div className="p-3 border-b bg-accent-soft dark:bg-primary/10">
              <div className="flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-semibold text-foreground">Produktiviteti i Ditës</h3>
              </div>
            </div>
            <div className="p-4 space-y-4">
              {/* Circular Progress */}
              <div className="flex items-center justify-center">
                <div className="relative w-28 h-28">
                  <svg className="w-28 h-28 -rotate-90" viewBox="0 0 100 100">
                    <circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" strokeWidth="8"
                      className="text-muted/30" />
                    <circle cx="50" cy="50" r="42" fill="none" strokeWidth="8" strokeLinecap="round"
                      strokeDasharray={`${dailyProductivityPct * 2.64} 264`}
                      className={
                        dailyProductivityPct >= 80 ? 'text-green-500' :
                        dailyProductivityPct >= 50 ? 'text-blue-500' :
                        dailyProductivityPct >= 25 ? 'text-amber-500' : 'text-red-400'
                      }
                      style={{ transition: 'stroke-dasharray 0.6s ease' }}
                    />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-2xl font-bold text-foreground">{dailyProductivityPct}%</span>
                    <span className="text-[9px] text-muted-foreground uppercase tracking-wider">Progres</span>
                  </div>
                </div>
              </div>

              {/* Breakdown items */}
              <div className="space-y-2.5">
                {/* Tasks completed */}
                <div className="flex items-center gap-2.5">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                    myCompletedToday.length >= DAILY_TASK_TARGET
                      ? 'bg-green-100 dark:bg-green-900/30'
                      : 'bg-muted'
                  }`}>
                    <CheckCircle2 className={`w-4 h-4 ${
                      myCompletedToday.length >= DAILY_TASK_TARGET ? 'text-green-500' : 'text-muted-foreground'
                    }`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-foreground">Detyra të përfunduara</span>
                      <span className="text-xs font-bold text-foreground tabular-nums">
                        {myCompletedToday.length}/{DAILY_TASK_TARGET}
                      </span>
                    </div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden mt-1">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${
                          myCompletedToday.length >= DAILY_TASK_TARGET ? 'bg-green-500' : 'bg-blue-500'
                        }`}
                        style={{ width: `${Math.min(100, (myCompletedToday.length / DAILY_TASK_TARGET) * 100)}%` }}
                      />
                    </div>
                  </div>
                </div>

                {/* Hours tracked */}
                <div className="flex items-center gap-2.5">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                    todayTrackedHours >= 7 ? 'bg-green-100 dark:bg-green-900/30' : 'bg-muted'
                  }`}>
                    <Clock className={`w-4 h-4 ${
                      todayTrackedHours >= 7 ? 'text-green-500' : 'text-muted-foreground'
                    }`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-foreground">Orë të trakuara</span>
                      <span className="text-xs font-bold text-foreground tabular-nums">
                        {todayTrackedHours.toFixed(1)}/8h
                      </span>
                    </div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden mt-1">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${
                          todayTrackedHours >= 7 ? 'bg-green-500' : 'bg-primary'
                        }`}
                        style={{ width: `${Math.min(100, (todayTrackedHours / 8) * 100)}%` }}
                      />
                    </div>
                  </div>
                </div>

                {/* Daily report */}
                <div className="flex items-center gap-2.5">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                    todayReportSubmitted ? 'bg-green-100 dark:bg-green-900/30' : 'bg-muted'
                  }`}>
                    <FileCheck className={`w-4 h-4 ${
                      todayReportSubmitted ? 'text-green-500' : 'text-muted-foreground'
                    }`} />
                  </div>
                  <div className="flex-1">
                    <span className="text-xs font-medium text-foreground">Raporti ditor</span>
                  </div>
                  <Badge variant="secondary" className={`text-[10px] h-5 ${
                    todayReportSubmitted
                      ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400'
                      : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400'
                  }`}>
                    {todayReportSubmitted ? '✓ Dorëzuar' : 'Mungon'}
                  </Badge>
                </div>
              </div>

              {/* Motivational message */}
              <div className={`text-center text-[11px] px-2 py-1.5 rounded-lg ${
                dailyProductivityPct >= 80
                  ? 'bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-400'
                  : dailyProductivityPct >= 50
                  ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400'
                  : 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400'
              }`}>
                {dailyProductivityPct >= 80
                  ? '🔥 Shkëlqyeshëm! Dita po shkon shumë mirë!'
                  : dailyProductivityPct >= 50
                  ? '💪 Mirë po shkon! Vazhdo kështu!'
                  : dailyProductivityPct >= 25
                  ? '⚡ Ke filluar, vazhdo përpara!'
                  : '🚀 Koha për të filluar ditën!'}
              </div>
            </div>
          </Card>

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
          {goals && goals.filter(g => g.status !== 'Achieved').length > 0 && (
            <Card className="overflow-hidden">
              <div className="p-3 border-b bg-muted/30">
                <div className="flex items-center gap-2">
                  <Target className="w-4 h-4 text-emerald-500" />
                  <h3 className="text-sm font-semibold text-foreground">Objektivat</h3>
                </div>
              </div>
              <div className="divide-y">
                {goals
                  .filter(g => g.status !== 'Achieved')
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
                className={`justify-start text-xs h-9 relative ${unreadClientMsgs > 0 ? 'border-emerald-300 dark:border-emerald-700' : ''}`}
                onClick={() => navigate('/app/chat')}
              >
                <MessageSquare className={`w-3.5 h-3.5 mr-1.5 ${unreadClientMsgs > 0 ? 'text-emerald-500' : 'text-green-500'}`} />
                Chat
                {unreadClientMsgs > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 bg-red-500 rounded-full flex items-center justify-center text-white text-[9px] font-bold px-0.5">
                    {unreadClientMsgs > 9 ? '9+' : unreadClientMsgs}
                  </span>
                )}
              </Button>
            </div>
          </Card>

        </div>
      </div>
    </div>

    {/* ── Floating Bird Widget: unread client messages ── */}
    {unreadClientMsgs > 0 && (
      <button
        onClick={() => navigate('/app/chat')}
        className="fixed bottom-6 right-6 z-50 flex items-center gap-3 bg-white dark:bg-gray-900 rounded-2xl shadow-xl px-4 py-3 border border-emerald-200 dark:border-emerald-800 hover:shadow-lg hover:scale-105 transition-all duration-200 animate-bird-enter"
        title="Mesazh i ri nga klienti — klikoni për chat"
      >
        {/* Bird with pulse ring */}
        <div className="relative flex-shrink-0 w-9 h-9 flex items-center justify-center">
          <div className="absolute inset-0 rounded-full bg-emerald-400/25 animate-pulse-ring" />
          <span className="text-2xl block animate-bird-fly select-none">🐦</span>
          <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] bg-red-500 rounded-full flex items-center justify-center text-white text-[9px] font-bold px-0.5 shadow">
            {unreadClientMsgs > 9 ? '9+' : unreadClientMsgs}
          </span>
        </div>
        {/* Label */}
        <div className="text-left">
          <div className="text-xs font-semibold text-foreground whitespace-nowrap leading-tight">Mesazh nga klienti</div>
          <div className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium mt-0.5">
            {unreadClientMsgs} të palexuar · Hap chat →
          </div>
        </div>
      </button>
    )}
    </>
  );
};

export default StaffDashboard;
