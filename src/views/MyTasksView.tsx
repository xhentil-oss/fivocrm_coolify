import React, { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CheckCircle2, Circle, ChevronDown, ChevronRight, Clock, AlarmClock, Plus, CalendarDays,
  ClipboardCheck, AlertTriangle, ListChecks, Users, RotateCcw, ArrowRight, Flame,
} from 'lucide-react';
import { useCollection, useMutation } from '../hooks/useFirestore';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../contexts/PermissionsContext';
import { useToast } from '../hooks/use-toast';
import { useActivityLogger } from '../hooks/useActivityLogger';
import { ToastAction } from '../components/ui/toast';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import TaskDetailPanel from '../components/TaskDetailPanel';
import { openDailyReport } from '../components/DailyReportPopup';
import { getTodayString, isReportingDay } from '../components/DailyReportForm';
import { completeTask, reopenTaskPatch } from '../lib/recurringUtils';
import { claimTaskNextCycle, releaseTaskNextCycle } from '../lib/taskRecurrenceClaim';
import { taskCompletedNotifications } from '../lib/taskNotifications';
import { reminderPatchForDeadline } from '../lib/taskReminders';
import { taskDateMs } from '../lib/taskSort';
import { deleteTaskCascade } from '../lib/deleteCascade';
import {
  MY_TASK_BUCKETS, buildMyTasks, deadProjectIdsOf, myTaskIds, snoozeToTomorrowDate,
  quickAddDates, tiraneDayValue, dueLabel, type MyTaskBucket,
} from '../lib/myTasks';
import type { Task, Project, TaskComment, DailyReport, DailyFocus, Notification } from '../types';

const PRIORITY_DOT: Record<string, string> = {
  urgent: 'bg-red-500',
  high: 'bg-orange-500',
  medium: 'bg-sky-500',
  low: 'bg-slate-400',
};

const BUCKET_TONE: Partial<Record<MyTaskBucket, string>> = {
  overdue: 'text-red-600 dark:text-red-400',
  today: 'text-primary',
};

/**
 * "Detyrat e mia" — one person's day: what is late, what is due today, what is
 * next. Pure bucketing lives in src/lib/myTasks.ts; completion goes through
 * `completeTask` with the FULL business task list (the blocker guard needs
 * colleagues' tasks), the detail panel is the shared TaskDetailPanel and the
 * daily report is the single DailyReportPopup (opened, never re-mounted).
 */
const MyTasksView: React.FC = () => {
  const { user } = useAuth();
  const permissions = usePermissions();
  const { canEdit } = permissions;
  const navigate = useNavigate();
  const { toast } = useToast();
  const logActivity = useActivityLogger();

  // Same query shape as TasksView (shares its cache): the whole business, so the
  // blocker guard and the series checks see every task, not just mine.
  const { data: rawTasks, loading: tasksLoading } = useCollection<Task>('tasks', {
    orderBy: { field: 'createdAt', direction: 'desc' },
    skipTeamFilter: true,
  });
  const { data: projects, loading: projectsLoading } = useCollection<Project>('projects');
  const today = getTodayString();
  const { data: todayReports } = useCollection<DailyReport>('dailyReports', {
    where: [
      { field: 'userId', operator: '==', value: user?.uid || '__never__' },
      { field: 'date', operator: '==', value: today },
    ],
    skip: !user,
  });
  const { data: focusDocs } = useCollection<DailyFocus>('dailyFocus', {
    skip: !user,
    where: user ? [{ field: 'userId', operator: '==', value: user.uid }] : undefined,
  });

  const taskMutation = useMutation<Task>('tasks');
  const notificationMutation = useMutation<Notification>('notifications');
  const commentMutation = useMutation<TaskComment>('taskComments');
  const focusMutation = useMutation<DailyFocus>('dailyFocus');

  const [showCollaborations, setShowCollaborations] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);
  const [collapsed, setCollapsed] = useState<Partial<Record<MyTaskBucket, boolean>>>({ later: true });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panelExpanded, setPanelExpanded] = useState(false);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [newTitle, setNewTitle] = useState('');
  const [newDay, setNewDay] = useState<string>(() => tiraneDayValue(0));
  const [adding, setAdding] = useState(false);

  const allTasks = useMemo(() => rawTasks || [], [rawTasks]);
  const myIds = useMemo(() => myTaskIds(user), [user]);
  const deadProjectIds = useMemo(() => deadProjectIdsOf(projects), [projects]);
  const projectName = useMemo(() => {
    const m = new Map<string, string>();
    (projects || []).forEach(p => m.set(p.id, p.name));
    return m;
  }, [projects]);

  const view = useMemo(
    () => buildMyTasks(allTasks, { myIds, deadProjectIds, includeCollaborations: showCollaborations }),
    [allTasks, myIds, deadProjectIds, showCollaborations],
  );

  const reportSubmitted = (todayReports?.length || 0) > 0;
  const reportingDay = isReportingDay(new Date());
  const frog = useMemo(
    () => focusDocs?.find(f => f.date === new Date().toLocaleDateString('sv')),
    [focusDocs],
  );

  const selectedTask = selectedId ? allTasks.find(t => t.id === selectedId) || null : null;
  const { data: selectedComments } = useCollection<TaskComment>('taskComments', {
    where: [{ field: 'taskId', operator: '==', value: selectedId || '__none__' }],
    skip: !selectedId,
  });

  const setBusy = (id: string, on: boolean) => setBusyIds(prev => {
    const next = new Set(prev);
    if (on) next.add(id); else next.delete(id);
    return next;
  });

  // ── Reopen (Undo + "Përfunduar sot") ─────────────────────────────────────
  const reopen = useCallback(async (task: Task, status: Task['status'] = 'Todo') => {
    try {
      // The snapshot may predate the completion — the patch is computed for a Done task.
      const doneTask = { ...task, status: 'Done' } as Task;
      await taskMutation.update(task.id, reopenTaskPatch(doneTask, status === 'Done' ? 'Todo' : status, rawTasks || []));
    } catch (err: any) {
      toast({ title: 'Detyra nuk u rihap', description: err?.message, variant: 'destructive' });
    }
  }, [taskMutation, rawTasks, toast]);

  // ── Complete ─────────────────────────────────────────────────────────────
  const handleComplete = async (task: Task) => {
    if (!canEdit || busyIds.has(task.id)) return;
    const previousStatus = task.status;
    setBusy(task.id, true);
    try {
      const outcome = await completeTask(task, {
        createTask: (data) => taskMutation.create(data as any),
        updateTask: (id, data) => taskMutation.update(id, data),
        // FULL business list — the role filter would hide a colleague's blocker.
        allTasks: rawTasks || [],
        projects: projects || [],
        claimNextCycle: claimTaskNextCycle,
        releaseNextCycle: releaseTaskNextCycle,
      });
      if (outcome.kind === 'blocked') {
        toast({ title: '⛔ Detyrë e Bllokuar', description: `Ka ${outcome.blockers} varësi të pakryera para se ta mbyllësh këtë.`, variant: 'destructive' });
        return;
      }
      if (user?.uid) {
        taskCompletedNotifications(task, user.uid, user.displayName || undefined).forEach(n =>
          notificationMutation.create(n as any).catch(err => console.error('[Notifications] task_completed dërgim dështoi:', err)));
      }
      logActivity('task_completed', `Detyrë e përfunduar: ${task.title}`, { entityType: 'task', entityId: task.id });

      // Undo re-opens the task. Not offered when a new cycle was spawned: the
      // child already exists, so re-opening the tip would leave two live
      // occurrences of the same series.
      const undo = outcome.kind !== 'recurring-created'
        ? <ToastAction altText="Zhbëj" onClick={() => { void reopen(task, previousStatus); }}>Zhbëj</ToastAction>
        : undefined;
      const description =
        outcome.kind === 'recurring-created' ? `"${task.title}" u rigjenerua automatikisht.`
        : outcome.kind === 'recurring-ended' ? 'Cikli i fundit i përsëritjes — nuk u krijua tjetër.'
        : outcome.kind === 'recurring-stopped'
          ? (outcome.reason === 'project-archived' ? 'Projekti është i arkivuar — përsëritja ndalon derisa të kthehet nga Arkiva.' : 'Projekti është anuluar — nuk u krijua cikël tjetër.')
        : outcome.kind === 'error' ? 'Detyra u mbyll, por cikli i ri nuk u krijua — do ta krijojë sistemi automatikisht.'
        : `"${task.title}"`;
      toast({
        title: outcome.kind === 'recurring-created' ? '✅ Detyrë e kryer + cikli i ri!' : '✅ Detyrë e përfunduar',
        description,
        action: undo,
      });
    } catch (err: any) {
      toast({ title: 'Detyra nuk u mbyll', description: err?.message, variant: 'destructive' });
    } finally {
      setBusy(task.id, false);
    }
  };

  // ── "Shtyje → nesër" ─────────────────────────────────────────────────────
  const handleSnooze = async (task: Task) => {
    if (!canEdit || busyIds.has(task.id)) return;
    const nd = snoozeToTomorrowDate(task);
    const prevEndMs = taskDateMs(task.endDate);
    const startMs = taskDateMs(task.startDate);
    const patch: Partial<Task> = {
      endDate: nd,
      // Re-arm the deadline alerts for the new day (same as every other deadline edit).
      dueNotificationSent: false,
      overdueNotificationSent: false,
      // A relative "Më kujto" follows the deadline.
      ...reminderPatchForDeadline(task, nd),
      ...(startMs !== null && startMs > nd.getTime() ? { startDate: nd } : {}),
    };
    setBusy(task.id, true);
    try {
      await taskMutation.update(task.id, patch);
      const undoPatch: Partial<Task> = {
        endDate: (prevEndMs === null ? null : new Date(prevEndMs)) as any,
        dueNotificationSent: !!task.dueNotificationSent,
        overdueNotificationSent: !!task.overdueNotificationSent,
        ...(prevEndMs !== null ? reminderPatchForDeadline({ ...task, ...patch } as Task, new Date(prevEndMs)) : {}),
        ...('startDate' in patch ? { startDate: task.startDate } : {}),
      };
      toast({
        title: 'U shty për nesër',
        description: `"${task.title}" → ${dueLabel({ endDate: nd })}`,
        action: (
          <ToastAction altText="Zhbëj" onClick={() => {
            taskMutation.update(task.id, undoPatch).catch(err =>
              toast({ title: 'Nuk u zhbë', description: err?.message, variant: 'destructive' }));
          }}>Zhbëj</ToastAction>
        ),
      });
    } catch (err: any) {
      toast({ title: 'Afati nuk u ndryshua', description: err?.message, variant: 'destructive' });
    } finally {
      setBusy(task.id, false);
    }
  };

  // ── Quick add ────────────────────────────────────────────────────────────
  const handleQuickAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const title = newTitle.trim();
    if (!title || !user?.uid || !canEdit || adding) return;
    setAdding(true);
    try {
      await taskMutation.create({
        title,
        status: 'Todo',
        priority: 'medium',
        assignedToUserId: user.uid,
        dueNotificationSent: false,
        ...quickAddDates(newDay),
      } as any);
      setNewTitle('');
      toast({ title: 'Detyra u shtua', description: newDay ? dueLabel({ endDate: quickAddDates(newDay).endDate }) || title : 'Pa afat' });
    } catch (err: any) {
      toast({ title: 'Detyra nuk u krijua', description: err?.message, variant: 'destructive' });
    } finally {
      setAdding(false);
    }
  };

  const toggleFrog = async () => {
    if (!frog) return;
    try {
      await focusMutation.update(frog.id, { done: !frog.done, completedAt: !frog.done ? new Date() : null } as any);
    } catch { /* non-critical */ }
  };

  // ── Panel comment handlers (same writes as TasksView) ────────────────────
  const handleAddComment = async (taskId: string, content: string, opts?: { visibleToClient?: boolean }) => {
    const task = allTasks.find(t => t.id === taskId);
    const customerId = opts?.visibleToClient ? (task as any)?.customerId : undefined;
    return commentMutation.create({
      taskId,
      content,
      ...(customerId ? { customerId, senderType: 'team' } : {}),
    } as any);
  };
  const handleToggleReaction = async (commentId: string, emoji: string) => {
    if (!user?.uid) return;
    const c = selectedComments?.find(x => x.id === commentId);
    const current: Record<string, string[]> = { ...((c as any)?.reactions || {}) };
    const arr = Array.isArray(current[emoji]) ? [...current[emoji]] : [];
    const i = arr.indexOf(user.uid);
    if (i >= 0) arr.splice(i, 1); else arr.push(user.uid);
    if (arr.length) current[emoji] = arr; else delete current[emoji];
    try {
      await commentMutation.update(commentId, { reactions: current } as any);
    } catch (err: any) {
      toast({ title: 'Reagimi nuk u ruajt', description: err?.message || 'Provo përsëri.', variant: 'destructive' });
    }
  };

  const openCount = MY_TASK_BUCKETS.reduce((n, b) => n + view.buckets[b.key].length, 0);
  const dateHeading = new Date().toLocaleDateString('sq-AL', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Tirane' });

  // ── Row ──────────────────────────────────────────────────────────────────
  const renderRow = (task: Task, bucket: MyTaskBucket | 'done') => {
    const done = bucket === 'done';
    const busy = busyIds.has(task.id);
    const isCollab = view.collaborationIds.has(task.id);
    const pName = task.projectId ? projectName.get(task.projectId) : '';
    const label = dueLabel(task);
    const canSnooze = !done && canEdit && (bucket === 'overdue' || bucket === 'today');
    return (
      <li
        key={task.id}
        className={`flex items-start gap-2.5 px-3 py-2.5 border-b last:border-b-0 ${selectedId === task.id ? 'bg-primary/5' : ''}`}
      >
        <button
          type="button"
          disabled={!canEdit || busy}
          onClick={() => (done ? reopen(task, 'Todo') : handleComplete(task))}
          aria-label={done ? `Rihap: ${task.title}` : `Përfundo: ${task.title}`}
          className="mt-0.5 flex-shrink-0 h-7 w-7 -m-1 flex items-center justify-center rounded-full disabled:opacity-50"
        >
          {done
            ? <CheckCircle2 className="h-5 w-5 text-green-600" />
            : <Circle className={`h-5 w-5 ${busy ? 'animate-pulse text-primary' : 'text-muted-foreground hover:text-primary'}`} />}
        </button>
        <button
          type="button"
          onClick={() => setSelectedId(task.id)}
          className="flex-1 min-w-0 text-left"
        >
          <div className={`text-sm font-medium leading-snug break-words ${done ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
            {task.title}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            {!done && task.priority && (
              <span className="inline-flex items-center gap-1">
                <span className={`h-1.5 w-1.5 rounded-full ${PRIORITY_DOT[task.priority] || 'bg-slate-400'}`} />
              </span>
            )}
            {!done && label && (
              <span className={bucket === 'overdue' ? 'text-red-600 dark:text-red-400 font-medium' : ''}>{label}</span>
            )}
            {pName && <span className="truncate max-w-[12rem]">{pName}</span>}
            {!done && !!task.estimatedHours && task.estimatedHours > 0 && (
              <span className="inline-flex items-center gap-0.5"><Clock className="h-3 w-3" />{task.estimatedHours}h</span>
            )}
            {task.parentTaskId && <span>Nën-detyrë</span>}
            {task.isRecurring && <span title="Detyrë që përsëritet">🔄</span>}
            {isCollab && <span className="inline-flex items-center gap-0.5"><Users className="h-3 w-3" />Bashkëpunim</span>}
          </div>
        </button>
        {canSnooze && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => handleSnooze(task)}
            className="h-8 px-2 text-xs flex-shrink-0"
            title="Shtyje afatin për nesër"
          >
            <AlarmClock className="h-3.5 w-3.5 mr-1" />Nesër
          </Button>
        )}
        {done && canEdit && (
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => reopen(task, 'Todo')} className="h-8 px-2 text-xs flex-shrink-0">
            <RotateCcw className="h-3.5 w-3.5 mr-1" />Rihap
          </Button>
        )}
      </li>
    );
  };

  return (
    <div className="flex h-full min-h-0">
      <div className="flex-1 min-w-0 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-3 sm:px-6 py-4 sm:py-6 space-y-4 pb-[calc(1.5rem+var(--safe-area-bottom))]">
          {/* Header */}
          <div className="flex items-end justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-2xl font-bold text-foreground">Detyrat e mia</h1>
              <p className="text-sm text-muted-foreground first-letter:uppercase">{dateHeading}</p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => navigate('/app/tasks')} className="flex-shrink-0 text-xs">
              Të gjitha <ArrowRight className="h-3.5 w-3.5 ml-1" />
            </Button>
          </div>

          {/* Summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <SummaryTile icon={<CalendarDays className="h-4 w-4" />} value={view.summary.today} label="sot" />
            <SummaryTile icon={<AlertTriangle className="h-4 w-4" />} value={view.summary.overdue} label="vonuar" tone={view.summary.overdue > 0 ? 'danger' : undefined} />
            <SummaryTile icon={<Clock className="h-4 w-4" />} value={`${view.summary.estimatedHoursToday}h`} label="të vlerësuara sot" />
            <SummaryTile icon={<CheckCircle2 className="h-4 w-4" />} value={view.summary.completedToday} label="përfunduar sot" tone={view.summary.completedToday > 0 ? 'success' : undefined} />
          </div>

          {/* Frog of the day (Momentum) */}
          {frog && (
            <Card className="p-3 flex items-center gap-3">
              <span className="text-2xl" aria-hidden="true">🐸</span>
              <div className="flex-1 min-w-0">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">Bretkosa e Ditës</div>
                <div className={`text-sm font-medium break-words ${frog.done ? 'line-through text-muted-foreground' : 'text-foreground'}`}>{frog.title}</div>
              </div>
              <Button variant={frog.done ? 'outline' : 'default'} size="sm" onClick={toggleFrog} className="flex-shrink-0">
                {frog.done ? 'Ngrënë ✓' : 'Hëngra'}
              </Button>
            </Card>
          )}

          {/* Daily report */}
          {(reportingDay || reportSubmitted) && (
            <Card className={`p-3 flex items-center gap-3 ${reportSubmitted ? '' : 'border-warning/60'}`}>
              {reportSubmitted
                ? <ClipboardCheck className="h-5 w-5 text-green-600 flex-shrink-0" />
                : <Flame className="h-5 w-5 text-warning flex-shrink-0" />}
              <div className="flex-1 min-w-0 text-sm">
                <div className="font-medium text-foreground">
                  {reportSubmitted ? 'Raporti i sotëm u dorëzua' : 'Raporti i sotëm nuk është dorëzuar'}
                </div>
                {!reportSubmitted && <div className="text-xs text-muted-foreground">Detyrat e sotme dalin vetë në raport.</div>}
              </div>
              {reportSubmitted ? (
                <Button variant="outline" size="sm" className="flex-shrink-0" onClick={() => navigate('/app/reports?side=internal&tab=daily')}>Shiko</Button>
              ) : (
                <Button size="sm" className="flex-shrink-0" onClick={openDailyReport}>Plotëso raportin</Button>
              )}
            </Card>
          )}

          {/* Quick add */}
          {canEdit && (
            <form onSubmit={handleQuickAdd} className="space-y-2">
              <div className="flex gap-2">
                <Input
                  value={newTitle}
                  onChange={e => setNewTitle(e.target.value)}
                  placeholder="Shto një detyrë për veten…"
                  aria-label="Titulli i detyrës së re"
                  className="text-base sm:text-sm"
                  maxLength={300}
                />
                <Button type="submit" disabled={!newTitle.trim() || adding} className="flex-shrink-0" aria-label="Shto detyrën">
                  <Plus className="h-4 w-4 sm:mr-1" /><span className="hidden sm:inline">Shto</span>
                </Button>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                {[
                  { v: tiraneDayValue(0), l: 'Sot' },
                  { v: tiraneDayValue(1), l: 'Nesër' },
                  { v: '', l: 'Pa afat' },
                ].map(o => (
                  <button
                    key={o.l}
                    type="button"
                    onClick={() => setNewDay(o.v)}
                    className={`px-2.5 py-1 rounded-full border transition-colors ${newDay === o.v ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground hover:bg-muted'}`}
                  >{o.l}</button>
                ))}
                <input
                  type="date"
                  value={newDay}
                  onChange={e => setNewDay(e.target.value)}
                  aria-label="Data e afatit"
                  className="px-2 py-1 rounded-md border bg-background text-foreground text-base sm:text-xs"
                />
              </div>
            </form>
          )}

          {/* Collaboration toggle */}
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs text-muted-foreground inline-flex items-center gap-1">
              <ListChecks className="h-3.5 w-3.5" />{openCount} të hapura
            </div>
            <button
              type="button"
              onClick={() => setShowCollaborations(v => !v)}
              aria-pressed={showCollaborations}
              className={`text-xs px-2.5 py-1 rounded-full border inline-flex items-center gap-1 transition-colors ${showCollaborations ? 'bg-primary/10 text-primary border-primary/40' : 'text-muted-foreground hover:bg-muted'}`}
            >
              <Users className="h-3.5 w-3.5" />Bashkëpunime{view.collaborationCount > 0 ? ` (${view.collaborationCount})` : ''}
            </button>
          </div>

          {/* Buckets */}
          {tasksLoading && !rawTasks ? (
            <Card className="p-6 text-center text-sm text-muted-foreground">Duke ngarkuar…</Card>
          ) : openCount === 0 ? (
            <Card className="p-6 text-center">
              <div className="text-3xl mb-1" aria-hidden="true">🎉</div>
              <div className="text-sm font-medium text-foreground">Asnjë detyrë e hapur</div>
              <div className="text-xs text-muted-foreground mt-0.5">Shto një më lart, ose shiko të gjitha detyrat.</div>
            </Card>
          ) : (
            MY_TASK_BUCKETS.map(({ key, label }) => {
              const rows = view.buckets[key];
              if (!rows.length) return null;
              const isCollapsed = !!collapsed[key];
              return (
                <section key={key}>
                  <button
                    type="button"
                    onClick={() => setCollapsed(c => ({ ...c, [key]: !isCollapsed }))}
                    aria-expanded={!isCollapsed}
                    className="w-full flex items-center gap-1.5 py-1.5 text-sm font-semibold"
                  >
                    {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    <span className={BUCKET_TONE[key] || 'text-foreground'}>{label}</span>
                    <span className="text-xs font-normal text-muted-foreground">{rows.length}</span>
                  </button>
                  {!isCollapsed && (
                    <Card className="overflow-hidden">
                      <ul>{rows.map(t => renderRow(t, key))}</ul>
                    </Card>
                  )}
                </section>
              );
            })
          )}

          {/* Completed today */}
          {view.completedToday.length > 0 && (
            <section>
              <button
                type="button"
                onClick={() => setShowCompleted(v => !v)}
                aria-expanded={showCompleted}
                className="w-full flex items-center gap-1.5 py-1.5 text-sm font-semibold text-muted-foreground"
              >
                {showCompleted ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                Përfunduar sot
                <span className="text-xs font-normal">{view.completedToday.length}</span>
              </button>
              {showCompleted && (
                <Card className="overflow-hidden">
                  <ul>{view.completedToday.map(t => renderRow(t, 'done'))}</ul>
                </Card>
              )}
            </section>
          )}
        </div>
      </div>

      {/* Task detail — bottom sheet on mobile, side panel on desktop. */}
      {selectedTask && (
        <>
          <div className="fixed inset-0 z-40 bg-black/30" onClick={() => { setSelectedId(null); setPanelExpanded(false); }} />
          <div
            className={`fixed z-50 bg-background shadow-2xl flex flex-col overflow-hidden
              bottom-0 left-0 right-0 h-[88dvh] rounded-t-[22px] border-t
              sm:inset-y-0 sm:left-auto sm:right-0 sm:h-full sm:rounded-none sm:border-t-0 sm:border-l
              ${panelExpanded ? 'sm:w-full lg:w-[min(100%,1100px)]' : 'sm:w-[min(100%,640px)]'}`}
            style={{ paddingBottom: 'var(--safe-area-bottom)' }}
          >
            <div className="hidden sm:block" style={{ height: 'var(--safe-area-top)' }} />
            <TaskDetailPanel
              key={selectedTask.id}
              task={selectedTask}
              onClose={() => { setSelectedId(null); setPanelExpanded(false); }}
              onExpand={() => setPanelExpanded(p => !p)}
              isExpanded={panelExpanded}
              comments={selectedComments || []}
              onAddComment={handleAddComment}
              onEditComment={(id, content) => commentMutation.update(id, { content, edited: true } as any)}
              onDeleteComment={(id) => commentMutation.remove(id)}
              onToggleReaction={handleToggleReaction}
              onUpdate={taskMutation.update}
              onDelete={(id) => deleteTaskCascade(id)
                .then(() => setSelectedId(null))
                .catch(err => {
                  console.error('[MyTasks] fshirja dështoi:', err);
                  toast({ title: 'Detyra nuk u fshi', description: err?.message, variant: 'destructive' });
                })}
              projects={projects || []}
              projectsLoading={projectsLoading}
              // FULL business list: the blocker guard / dependency picker need it.
              allTasks={allTasks}
              onSelectSubtask={(sub) => setSelectedId(sub.id)}
            />
          </div>
        </>
      )}
    </div>
  );
};

const SummaryTile: React.FC<{ icon: React.ReactNode; value: React.ReactNode; label: string; tone?: 'danger' | 'success' }> = ({ icon, value, label, tone }) => (
  <Card className="p-3">
    <div className={`flex items-center gap-1.5 ${tone === 'danger' ? 'text-red-600 dark:text-red-400' : tone === 'success' ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground'}`}>
      {icon}
      <span className="text-lg font-bold leading-none">{value}</span>
    </div>
    <div className="text-[11px] text-muted-foreground mt-1">{label}</div>
  </Card>
);

export default MyTasksView;
