import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../contexts/PermissionsContext';
import { useCollection, useMutation } from '../hooks/useFirestore';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { Label } from './ui/label';
import { Input } from './ui/input';
import { Badge } from './ui/badge';
import {
  CheckCircle2, Clock, AlertTriangle, ArrowRight, Smile, Meh, Frown,
  Sparkles, Square, CheckSquare, TrendingUp, PhoneCall,
} from 'lucide-react';
import { toast } from '../hooks/use-toast';
import DepartmentReportFields, { useMyServiceLine } from './DepartmentReportFields';
import { normalizeServiceLine } from '../lib/productivity/reportTemplates';
import type { DailyReport, Project, Task, Lead, StandupEntry, TeamMember, Notification } from '../types';

const POPUP_HOUR = 16;
const POPUP_MINUTE = 45;
/**
 * Local hour the daily report is due. Drives `dueAt`/`wasLate`, which are what make
 * "late reports" and "average submission delay" measurable at all — before this the
 * accountability dashboard could only ever report 0 late reports.
 */
const DAILY_DUE_HOUR = 18;

function getTodayString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const DailyReportPopup: React.FC = () => {
  const { user } = useAuth();
  const permissions = usePermissions();
  const [open, setOpen] = useState(false);

  // Form state
  const [completedToday, setCompletedToday] = useState('');
  const [openItems, setOpenItems] = useState('');
  const [blockers, setBlockers] = useState('');
  const [planTomorrow, setPlanTomorrow] = useState('');
  const [hoursWorked, setHoursWorked] = useState<string>('8');
  const [mood, setMood] = useState<'great' | 'good' | 'neutral' | 'struggling'>('good');
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([]);
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
  const [customFields, setCustomFields] = useState<Record<string, string | number>>({});
  const [submitting, setSubmitting] = useState(false);
  // ── §3.1 accountability fields ──
  const [dailyStatus, setDailyStatus] = useState<NonNullable<DailyReport['dailyStatus']>>('on_track');
  const [workLocation, setWorkLocation] = useState<NonNullable<DailyReport['workLocation']>>('office');
  const [workingStatus, setWorkingStatus] = useState<NonNullable<DailyReport['workingStatus']>>('working');
  const [billableHours, setBillableHours] = useState<string>('');
  const [risks, setRisks] = useState('');
  const [helpNeeded, setHelpNeeded] = useState('');
  const [clientDependencies, setClientDependencies] = useState('');
  const [internalDependencies, setInternalDependencies] = useState('');
  const [mgmtNotes, setMgmtNotes] = useState('');
  // The extra section stays collapsed so the daily habit remains a 30-second job.
  const [showDetails, setShowDetails] = useState(false);

  const serviceLine = useMyServiceLine();
  const today = getTodayString();

  // User-scoped dismiss key — prevents cross-user interference on shared devices
  const storageKey = user ? `daily_report_dismissed_${user.uid}` : 'daily_report_dismissed';

  const { data: todayReports } = useCollection<DailyReport>('dailyReports', {
    where: [
      { field: 'userId', operator: '==', value: user?.uid || '__never__' },
      { field: 'date', operator: '==', value: today },
    ],
  });

  const { data: projects } = useCollection<Project>('projects');

  const { data: myTasks } = useCollection<Task>('tasks', {
    where: [{ field: 'assignedToUserId', operator: '==', value: user?.uid || '__never__' }],
  });

  // CRM leads assigned to this user (for SalesAgent / Sales / Admin)
  const { data: myLeads } = useCollection<Lead>('leads', {
    where: [{ field: 'assignedToUserId', operator: '==', value: user?.uid || '__never__' }],
    skip: !permissions.canAccessCRM,
  });

  // Today's standup (for plan vs reality comparison)
  const { data: todayStandups } = useCollection<StandupEntry>('standups', {
    where: [
      { field: 'userId', operator: '==', value: user?.uid || '__never__' },
      { field: 'date', operator: '==', value: today },
    ],
  });

  // Team members — needed to notify managers on blocker reports
  const { data: teamMembers } = useCollection<TeamMember>('teamMembers', {
    skipTeamFilter: true,
    skip: !permissions.teamId,
  });

  const reportMutation = useMutation<DailyReport>('dailyReports');
  const taskMutation = useMutation<Task>('tasks');
  const notificationMutation = useMutation<Notification>('notifications');

  // Tasks completed today (status=Done, updatedAt is today)
  const completedTodayTasks = useMemo(() => {
    if (!myTasks) return [];
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    return myTasks.filter(t => {
      if (t.status !== 'Done') return false;
      const updated = t.updatedAt instanceof Date ? t.updatedAt : new Date(t.updatedAt);
      return updated >= todayStart;
    });
  }, [myTasks]);

  // Tasks assigned for today: due today, overdue, in progress, or created today
  const todaysAssignedTasks = useMemo(() => {
    if (!myTasks) return [];
    const todayStr = getTodayString();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(todayStart);
    todayEnd.setDate(todayEnd.getDate() + 1);

    return myTasks.filter(t => {
      if (t.status === 'Done') return false;
      const due = t.endDate || t.dueDate;
      if (due) {
        const d = due instanceof Date ? due : new Date(due);
        const dStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        if (dStr === todayStr) return true;
        if (d < todayStart) return true;
      }
      if (t.startDate) {
        const s = t.startDate instanceof Date ? t.startDate : new Date(t.startDate);
        if (s <= todayEnd) {
          const due2 = t.endDate || t.dueDate;
          if (!due2 || new Date(due2) >= todayStart) return true;
        }
      }
      if (t.status === 'In Progress') return true;
      const created = t.createdAt instanceof Date ? t.createdAt : new Date(t.createdAt);
      if (created >= todayStart) return true;
      return false;
    });
  }, [myTasks]);

  const otherPendingTasks = useMemo(() => {
    if (!myTasks) return [];
    const todayIds = new Set(todaysAssignedTasks.map(t => t.id));
    return myTasks.filter(t => t.status !== 'Done' && !todayIds.has(t.id));
  }, [myTasks, todaysAssignedTasks]);

  // CRM: leads with follow-up due today or overdue
  const todayFollowUps = useMemo(() => {
    if (!myLeads) return [];
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);
    return myLeads.filter(l => {
      if (!l.nextFollowUpDate) return false;
      if (l.status === 'Won' || l.status === 'Lost') return false;
      const d = l.nextFollowUpDate instanceof Date ? l.nextFollowUpDate : new Date(l.nextFollowUpDate);
      return d <= todayEnd;
    });
  }, [myLeads]);

  // Standup plan for today
  const todayStandup = useMemo(() => {
    return todayStandups?.[0] || null;
  }, [todayStandups]);

  const alreadySubmitted = useMemo(() => {
    return (todayReports?.length || 0) > 0;
  }, [todayReports]);

  // Timer: check every minute if it's time to show popup
  useEffect(() => {
    if (!user || !permissions.teamId) return;

    const checkTime = () => {
      const now = new Date();
      const hour = now.getHours();
      const minute = now.getMinutes();
      const day = now.getDay(); // 0=Sun, 6=Sat

      if (day === 0 || day === 6) return;

      const dismissed = localStorage.getItem(storageKey);
      if (dismissed === today) return;
      if (alreadySubmitted) return;

      if (hour > POPUP_HOUR || (hour === POPUP_HOUR && minute >= POPUP_MINUTE)) {
        setOpen(true);
      }
    };

    checkTime();
    const interval = setInterval(checkTime, 60_000);
    return () => clearInterval(interval);
  }, [user, permissions.teamId, today, alreadySubmitted, storageKey]);

  const handleDismiss = () => {
    localStorage.setItem(storageKey, today);
    setOpen(false);
  };

  const handleClose = () => {
    setOpen(false);
  };

  const handleSubmit = async () => {
    if (!user || !permissions.teamId) return;
    if (!completedToday.trim()) {
      toast({ title: 'Plotëso "Çfarë përfundova sot"', variant: 'destructive' });
      return;
    }

    setSubmitting(true);
    try {
      // Mark selected pending tasks as Done
      const allCompletedIds = [
        ...completedTodayTasks.map(t => t.id),
        ...selectedTaskIds,
      ];
      for (const taskId of selectedTaskIds) {
        await taskMutation.update(taskId, { status: 'Done' } as any);
      }

      // The deadline is a real instant, so lateness is measurable rather than guessed.
      const now = new Date();
      const dueAt = new Date(now);
      dueAt.setHours(DAILY_DUE_HOUR, 0, 0, 0);

      const workedHours = parseFloat(hoursWorked) || 8;
      // Only send the split when the person actually typed it — an absent split must
      // stay ABSENT, so the dashboard shows "not measured" instead of a false 0h.
      const billable = billableHours.trim() === '' ? undefined
        : Math.max(0, Math.min(workedHours, parseFloat(billableHours) || 0));

      // Customers are DERIVED from the projects already selected, rather than asking
      // for the same information twice (the spec's "the system should suggest").
      const derivedCustomerIds = Array.from(new Set(
        selectedProjectIds
          .map(id => (projects || []).find(p => p.id === id)?.customerId)
          .filter((c): c is string => !!c),
      ));

      await reportMutation.create({
        userId: user.uid,
        date: today,
        completedToday: completedToday.trim(),
        openItems: openItems.trim(),
        blockers: blockers.trim(),
        planTomorrow: planTomorrow.trim(),
        hoursWorked: workedHours,
        projectIds: selectedProjectIds,
        completedTaskIds: allCompletedIds.length > 0 ? allCompletedIds : undefined,
        mood,
        serviceLine: normalizeServiceLine(serviceLine) || undefined,
        customFields: Object.keys(customFields).length ? customFields : undefined,
        // ── §3.1 accountability ──
        dailyStatus,
        workLocation,
        workingStatus,
        billableHours: billable,
        nonBillableHours: billable === undefined ? undefined : Math.max(0, workedHours - billable),
        customerIds: derivedCustomerIds.length ? derivedCustomerIds : undefined,
        risks: risks.trim() || undefined,
        helpNeeded: helpNeeded.trim() || undefined,
        clientDependencies: clientDependencies.trim() || undefined,
        internalDependencies: internalDependencies.trim() || undefined,
        notes: mgmtNotes.trim() || undefined,
        submittedAt: now,
        dueAt,
        wasLate: now.getTime() > dueAt.getTime(),
      } as any);

      // Notify admin/manager when blocker is reported
      if (blockers.trim() && teamMembers) {
        const submitterName = user.displayName || user.email?.split('@')[0] || 'Punonjësi';
        const managerRecipients = teamMembers.filter(m =>
          m.teamId === permissions.teamId &&
          m.status === 'Active' &&
          (m.role === 'Admin' || m.role === 'Manager') &&
          m.userId !== user.uid
        );
        for (const mgr of managerRecipients) {
          await notificationMutation.create({
            userId: mgr.userId,
            type: 'blocker_reported',
            title: 'Pengesa raportuar',
            message: `${submitterName}: "${blockers.trim().slice(0, 120)}"`,
            isRead: false,
            actionUrl: '/app/daily-reports',
            actionLabel: 'Shiko raportin',
          } as any);
        }
      }

      toast({ title: 'Raporti ditor u ruajt!', description: 'Faleminderit për raportimin.' });
      localStorage.setItem(storageKey, today);
      setOpen(false);
      setCompletedToday('');
      setOpenItems('');
      setBlockers('');
      setPlanTomorrow('');
      setHoursWorked('8');
      setMood('good');
      setSelectedProjectIds([]);
      setSelectedTaskIds([]);
      setCustomFields({});
    } catch (err) {
      console.error('Failed to submit daily report:', err);
      toast({ title: 'Gabim!', description: 'Nuk u ruajt raporti. Provo përsëri.', variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  const toggleProject = (id: string) => {
    setSelectedProjectIds(prev =>
      prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]
    );
  };

  const toggleTask = (id: string) => {
    setSelectedTaskIds(prev =>
      prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]
    );
  };

  if (alreadySubmitted) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            Raporti Ditor
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            Plotëso raportin e ditës para se të mbyllësh ditën.
          </p>
        </DialogHeader>

        <div className="space-y-4 pt-2">

          {/* ── Context Panel ─────────────────────────────────────── */}
          {(todayFollowUps.length > 0 || todayStandup) && (
            <div className="space-y-2">
              {/* Standup plan comparison */}
              {todayStandup && (
                <div className="bg-blue-50/60 dark:bg-blue-950/20 rounded-lg px-3 py-2 border border-blue-200/50 dark:border-blue-800/50">
                  <p className="text-[11px] font-medium text-blue-800 dark:text-blue-300 mb-0.5">
                    Plani i mëngjesit (standup)
                  </p>
                  <p className="text-xs text-muted-foreground line-clamp-2">{todayStandup.today}</p>
                  {todayStandup.blockers?.trim() && (
                    <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5 line-clamp-1">
                      ⚠ {todayStandup.blockers}
                    </p>
                  )}
                </div>
              )}

              {/* CRM follow-ups due today */}
              {todayFollowUps.length > 0 && (
                <div className="bg-amber-50/60 dark:bg-amber-950/20 rounded-lg px-3 py-2 border border-amber-200/50 dark:border-amber-800/50">
                  <p className="text-[11px] font-medium text-amber-800 dark:text-amber-300 flex items-center gap-1.5 mb-1">
                    <PhoneCall className="w-3 h-3" />
                    {todayFollowUps.length} lead me follow-up sot
                  </p>
                  <div className="space-y-0.5">
                    {todayFollowUps.slice(0, 4).map(lead => (
                      <p key={lead.id} className="text-xs text-muted-foreground truncate">
                        • {lead.name}
                        <span className="ml-1 text-[10px] text-muted-foreground/70">({lead.status})</span>
                      </p>
                    ))}
                    {todayFollowUps.length > 4 && (
                      <p className="text-[11px] text-muted-foreground/70">+{todayFollowUps.length - 4} të tjerë</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── 1. Completed today ─────────────────────────────────── */}
          <div>
            <Label className="flex items-center gap-2 mb-1.5">
              <CheckCircle2 className="w-4 h-4 text-success" />
              Çfarë përfundova sot *
            </Label>
            <Textarea
              value={completedToday}
              onChange={(e) => setCompletedToday(e.target.value)}
              placeholder="p.sh. Përfundova 3 postime për Klientin A, optimizova fushatën Meta Ads..."
              rows={3}
            />
          </div>

          {/* ── Tasks section ─────────────────────────────────────── */}
          {(completedTodayTasks.length > 0 || todaysAssignedTasks.length > 0 || otherPendingTasks.length > 0) && (
            <div className="space-y-3">
              <Label className="flex items-center gap-2">
                <CheckSquare className="w-4 h-4 text-primary" />
                Detyrat e sotme
              </Label>

              {todaysAssignedTasks.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground font-medium">
                    📋 Të caktuara për sot ({todaysAssignedTasks.length}):
                  </p>
                  {todaysAssignedTasks.map(task => {
                    const due = task.endDate || task.dueDate;
                    const isOverdue = due && new Date(due) < new Date(new Date().setHours(0, 0, 0, 0));
                    return (
                      <button
                        key={task.id}
                        type="button"
                        onClick={() => toggleTask(task.id)}
                        className={`flex items-center gap-2 p-2 rounded-lg text-sm w-full text-left transition-all ${
                          selectedTaskIds.includes(task.id)
                            ? 'bg-primary/10 border border-primary/30'
                            : isOverdue
                            ? 'bg-red-50 dark:bg-red-950/20 hover:bg-red-100 dark:hover:bg-red-950/30 border border-red-200 dark:border-red-800'
                            : 'bg-amber-50/50 dark:bg-amber-950/20 hover:bg-amber-100/50 dark:hover:bg-amber-950/30 border border-amber-200/50 dark:border-amber-800/50'
                        }`}
                      >
                        {selectedTaskIds.includes(task.id) ? (
                          <CheckSquare className="w-4 h-4 text-primary flex-shrink-0" />
                        ) : (
                          <Square className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                        )}
                        <span className={`truncate flex-1 ${selectedTaskIds.includes(task.id) ? 'line-through text-muted-foreground' : ''}`}>
                          {task.title}
                        </span>
                        {isOverdue && <Badge variant="destructive" className="text-[10px] ml-auto flex-shrink-0">Vonuar</Badge>}
                        {task.priority === 'urgent' && <Badge variant="destructive" className="text-[10px] ml-auto flex-shrink-0">Urgjent</Badge>}
                        {task.priority === 'high' && !isOverdue && <Badge className="text-[10px] ml-auto bg-orange-500 flex-shrink-0">E lartë</Badge>}
                        {task.status === 'In Progress' && <Badge variant="secondary" className="text-[10px] ml-auto flex-shrink-0">Në progres</Badge>}
                      </button>
                    );
                  })}
                </div>
              )}

              {completedTodayTasks.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">✅ Të përfunduara sot ({completedTodayTasks.length}):</p>
                  {completedTodayTasks.map(task => (
                    <div key={task.id} className="flex items-center gap-2 p-2 rounded-lg bg-success/10 text-sm">
                      <CheckCircle2 className="w-4 h-4 text-success flex-shrink-0" />
                      <span className="line-through text-muted-foreground truncate">{task.title}</span>
                    </div>
                  ))}
                </div>
              )}

              {otherPendingTasks.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Detyra të tjera aktive:</p>
                  {otherPendingTasks.slice(0, 8).map(task => (
                    <button
                      key={task.id}
                      type="button"
                      onClick={() => toggleTask(task.id)}
                      className={`flex items-center gap-2 p-2 rounded-lg text-sm w-full text-left transition-all ${
                        selectedTaskIds.includes(task.id)
                          ? 'bg-primary/10 border border-primary/30'
                          : 'bg-muted/50 hover:bg-muted border border-transparent'
                      }`}
                    >
                      {selectedTaskIds.includes(task.id) ? (
                        <CheckSquare className="w-4 h-4 text-primary flex-shrink-0" />
                      ) : (
                        <Square className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                      )}
                      <span className={`truncate ${selectedTaskIds.includes(task.id) ? 'line-through text-muted-foreground' : ''}`}>
                        {task.title}
                      </span>
                      {task.priority === 'urgent' && <Badge variant="destructive" className="text-[10px] ml-auto">Urgjent</Badge>}
                      {task.priority === 'high' && <Badge className="text-[10px] ml-auto bg-orange-500">E lartë</Badge>}
                    </button>
                  ))}
                  {otherPendingTasks.length > 8 && (
                    <p className="text-[11px] text-muted-foreground text-center py-1">
                      +{otherPendingTasks.length - 8} detyra të tjera
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── Department (serviceLine) fields ────────────────────── */}
          <DepartmentReportFields
            serviceLine={serviceLine}
            values={customFields}
            onChange={(k, v) => setCustomFields((prev) => ({ ...prev, [k]: v }))}
          />

          {/* ── Statusi i ditës (§3.1) ─────────────────────────────── */}
          <div className="grid sm:grid-cols-3 gap-3">
            <div className="sm:col-span-3">
              <Label className="mb-1.5">Statusi i ditës</Label>
              <div className="flex flex-wrap gap-1.5">
                {([
                  { key: 'on_track', label: 'Në rrugë', cls: 'border-success/40 bg-success/10 text-success' },
                  { key: 'needs_attention', label: 'Kërkon vëmendje', cls: 'border-warning/40 bg-warning/10 text-warning' },
                  { key: 'blocked', label: 'Bllokuar', cls: 'border-error/40 bg-error/10 text-error' },
                  { key: 'at_risk', label: 'Në rrezik', cls: 'border-error/40 bg-error/10 text-error' },
                  { key: 'completed', label: 'Përfunduar', cls: 'border-primary/40 bg-primary/10 text-primary' },
                ] as const).map(({ key, label, cls }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setDailyStatus(key)}
                    className={`text-xs px-2.5 py-1.5 rounded-lg border transition-all ${
                      dailyStatus === key ? cls : 'border-border text-muted-foreground hover:border-primary/40'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <Label className="mb-1.5 text-xs">Vendi i punës</Label>
              <select
                value={workLocation}
                onChange={(e) => setWorkLocation(e.target.value as typeof workLocation)}
                className="w-full h-9 rounded-md border border-border bg-background px-2 text-sm"
              >
                <option value="office">Zyrë</option>
                <option value="remote">Remote</option>
                <option value="client_site">Tek klienti</option>
                <option value="field">Në terren</option>
                <option value="travel">Udhëtim</option>
              </select>
            </div>
            <div>
              <Label className="mb-1.5 text-xs">Statusi i punës</Label>
              <select
                value={workingStatus}
                onChange={(e) => setWorkingStatus(e.target.value as typeof workingStatus)}
                className="w-full h-9 rounded-md border border-border bg-background px-2 text-sm"
              >
                <option value="working">Ditë normale pune</option>
                <option value="partial">Ditë e pjesshme</option>
                <option value="leave">Leje</option>
                <option value="sick">Sëmundje</option>
                <option value="holiday">Festë</option>
              </select>
            </div>
          </div>

          {/* ── 2. Open items ──────────────────────────────────────── */}
          <div>
            <Label className="flex items-center gap-2 mb-1.5">
              <Clock className="w-4 h-4 text-warning" />
              Çfarë mbeti hapur
            </Label>
            <Textarea
              value={openItems}
              onChange={(e) => setOpenItems(e.target.value)}
              placeholder="p.sh. Landing page për Klientin B, review i materialeve..."
              rows={2}
            />
          </div>

          {/* ── 3. Blockers ────────────────────────────────────────── */}
          <div>
            <Label className="flex items-center gap-2 mb-1.5">
              <AlertTriangle className="w-4 h-4 text-error" />
              Çfarë pengese kam
              {blockers.trim() && (
                <span className="ml-auto text-[10px] text-amber-600 dark:text-amber-400 font-normal">
                  Menaxheri do njoftohet
                </span>
              )}
            </Label>
            <Textarea
              value={blockers}
              onChange={(e) => setBlockers(e.target.value)}
              placeholder="p.sh. Mungojnë materialet nga klienti, pres miratim..."
              rows={2}
            />
          </div>

          {/* ── 4. Plan for tomorrow ───────────────────────────────── */}
          <div>
            <Label className="flex items-center gap-2 mb-1.5">
              <ArrowRight className="w-4 h-4 text-primary" />
              Çfarë kam plan nesër
            </Label>
            <Textarea
              value={planTomorrow}
              onChange={(e) => setPlanTomorrow(e.target.value)}
              placeholder="p.sh. Finalizoj landing page, nis A/B test..."
              rows={2}
            />
          </div>

          {/* ── Detaje shtesë (§3.1 pyetjet 5–7) ───────────────────── */}
          {/* Collapsed by default so the daily habit stays a 30-second job, but it
              opens ITSELF the moment a blocker is reported — that is exactly when
              management needs the risk, the dependency and the ask. */}
          <div className="rounded-lg border border-border">
            <button
              type="button"
              onClick={() => setShowDetails(v => !v)}
              className="w-full flex items-center justify-between px-3 py-2 text-sm"
            >
              <span className="flex items-center gap-2 text-muted-foreground">
                <TrendingUp className="w-4 h-4" />
                Detaje shtesë
                {(risks || helpNeeded || clientDependencies || internalDependencies || mgmtNotes) && (
                  <Badge variant="outline" className="text-[10px]">plotësuar</Badge>
                )}
              </span>
              <span className="text-xs text-muted-foreground">
                {showDetails || blockers.trim() ? 'mbyll' : 'hap'}
              </span>
            </button>

            {(showDetails || blockers.trim()) && (
              <div className="px-3 pb-3 space-y-3 border-t border-border pt-3">
                <div>
                  <Label className="mb-1.5 text-xs">A është ndonjë afat, klient apo projekt në rrezik?</Label>
                  <Textarea
                    value={risks}
                    onChange={(e) => setRisks(e.target.value)}
                    placeholder="p.sh. Dorëzimi i së mërkurës rrezikohet nëse materialet nuk vijnë nesër…"
                    rows={2}
                  />
                </div>
                <div>
                  <Label className="mb-1.5 text-xs">Kërkon aprovim apo ndihmë nga dikush?</Label>
                  <Textarea
                    value={helpNeeded}
                    onChange={(e) => setHelpNeeded(e.target.value)}
                    placeholder="p.sh. Duhet miratimi i buxhetit nga menaxheri…"
                    rows={2}
                  />
                </div>
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <Label className="mb-1.5 text-xs">Pres nga klienti</Label>
                    <Input
                      value={clientDependencies}
                      onChange={(e) => setClientDependencies(e.target.value)}
                      placeholder="p.sh. tekstet, aksesin"
                    />
                  </div>
                  <div>
                    <Label className="mb-1.5 text-xs">Pres nga ekipi</Label>
                    <Input
                      value={internalDependencies}
                      onChange={(e) => setInternalDependencies(e.target.value)}
                      placeholder="p.sh. dizajnin nga Ana"
                    />
                  </div>
                </div>
                <div>
                  <Label className="mb-1.5 text-xs flex items-center gap-1.5">
                    Çfarë duhet të dijë menaxhimi?
                    <span className="text-[10px] text-muted-foreground">(shihet vetëm nga menaxhimi)</span>
                  </Label>
                  <Textarea
                    value={mgmtNotes}
                    onChange={(e) => setMgmtNotes(e.target.value)}
                    rows={2}
                  />
                </div>
              </div>
            )}
          </div>

          {/* ── Hours + Mood ───────────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="mb-1.5">Sa orë punova</Label>
              <Input
                type="number"
                min="0"
                max="24"
                step="0.5"
                value={hoursWorked}
                onChange={(e) => setHoursWorked(e.target.value)}
              />
              <div className="mt-2">
                <Label className="mb-1 text-xs text-muted-foreground">
                  Nga këto, të faturueshme <span className="opacity-70">(opsionale)</span>
                </Label>
                <Input
                  type="number"
                  min="0"
                  max={hoursWorked || '24'}
                  step="0.5"
                  value={billableHours}
                  onChange={(e) => setBillableHours(e.target.value)}
                  placeholder="—"
                />
                {/* Left blank on purpose = "not measured". The dashboard shows a dash
                    rather than 0h, so nobody looks 100% non-billable by accident. */}
              </div>
            </div>
            <div>
              <Label className="mb-1.5">Si u ndjeva sot</Label>
              <div className="flex gap-2 mt-1">
                {([
                  { key: 'great', icon: Smile, color: 'text-success' },
                  { key: 'good',  icon: Smile, color: 'text-primary' },
                  { key: 'neutral', icon: Meh,  color: 'text-warning' },
                  { key: 'struggling', icon: Frown, color: 'text-error' },
                ] as const).map(({ key, icon: Icon, color }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setMood(key)}
                    className={`p-2 rounded-lg border transition-all ${
                      mood === key
                        ? 'border-primary bg-primary/10 scale-110'
                        : 'border-border hover:border-muted-foreground'
                    }`}
                  >
                    <Icon className={`w-5 h-5 ${color}`} />
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* ── Projects (hidden if user has no project access) ────── */}
          {permissions.canAccessProjects && projects && projects.length > 0 && (
            <div>
              <Label className="mb-1.5">Në cilat projekte punova</Label>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {projects.filter(p => p.status === 'Active' || p.status === 'In Review').map(p => (
                  <Badge
                    key={p.id}
                    variant={selectedProjectIds.includes(p.id) ? 'default' : 'outline'}
                    className="cursor-pointer transition-all"
                    onClick={() => toggleProject(p.id)}
                  >
                    {p.name}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* ── CRM: leads productivity summary ───────────────────── */}
          {permissions.canAccessCRM && myLeads && myLeads.length > 0 && (
            <div>
              <Label className="flex items-center gap-2 mb-1.5">
                <TrendingUp className="w-4 h-4 text-primary" />
                CRM — aktiviteti sot
              </Label>
              <div className="flex flex-wrap gap-2">
                <div className="text-xs bg-muted/50 rounded px-2 py-1">
                  <span className="text-muted-foreground">Gjithsej leads: </span>
                  <span className="font-medium">{myLeads.filter(l => l.status !== 'Won' && l.status !== 'Lost').length} aktiv</span>
                </div>
                {todayFollowUps.length > 0 && (
                  <div className="text-xs bg-amber-50 dark:bg-amber-950/20 rounded px-2 py-1 text-amber-700 dark:text-amber-300">
                    {todayFollowUps.length} follow-up sot
                  </div>
                )}
                {myLeads.filter(l => l.status === 'Proposal').length > 0 && (
                  <div className="text-xs bg-blue-50 dark:bg-blue-950/20 rounded px-2 py-1 text-blue-700 dark:text-blue-300">
                    {myLeads.filter(l => l.status === 'Proposal').length} në propozim
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Actions ────────────────────────────────────────────── */}
          <div className="flex justify-between pt-2">
            <Button variant="ghost" onClick={handleDismiss}>
              Më vonë
            </Button>
            <Button onClick={handleSubmit} disabled={submitting}>
              {submitting ? 'Duke ruajtur...' : 'Dërgo Raportin'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default DailyReportPopup;
