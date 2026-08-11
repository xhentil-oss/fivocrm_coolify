import React, { useState, useMemo, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../contexts/PermissionsContext';
import { useCollection, useMutation } from '../hooks/useFirestore';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { Label } from './ui/label';
import { Input } from './ui/input';
import { Badge } from './ui/badge';
import {
  CheckCircle2, Clock, AlertTriangle, ArrowRight, Smile, Meh, Frown,
  TrendingUp, PhoneCall, Plus, X, ListChecks,
} from 'lucide-react';
import { toast } from '../hooks/use-toast';
import DepartmentReportFields from './DepartmentReportFields';
import { getReportTemplate, normalizeServiceLine } from '../lib/productivity/reportTemplates';
import {
  buildPlannedOutcomes,
  cleanOutcomesForSave,
  customersTouched,
  narrativeFromOutcomes,
  outcomeNeedsReason,
  projectsTouched,
  summariseOutcomes,
  taskStatusUpdates,
  unplannedOutcome,
} from '../lib/productivity/dailyReportPlan';
import { checkDailyReportQuality } from '../lib/productivity/dailyReportQuality';
import type {
  Customer, DailyReport, DailyTaskOutcome, Project, Task, Lead,
  StandupEntry, TaskOutcomeState, TeamMember, Notification,
} from '../types';

/** The three answers a planned task can get, in the order they are offered. */
const OUTCOME_STATES: Array<{ key: TaskOutcomeState; label: string; cls: string }> = [
  { key: 'done',        label: 'Përfunduar', cls: 'bg-success/15 text-success border-success/40' },
  { key: 'in_progress', label: 'Në progres', cls: 'bg-warning/15 text-warning border-warning/40' },
  { key: 'not_started', label: 'Nuk u prek', cls: 'bg-error/15 text-error border-error/40' },
];

/**
 * When the report opens, and when it is actually due — both local time.
 *
 * These two used to disagree: the popup appeared at 16:45 while `dueAt` was hard-coded
 * to 18:00, so virtually nothing was ever "late" and the accountability dashboard
 * reported 0 late reports forever. The window is now deliberate: prompted at 16:50,
 * owed by 17:30, with the escalation ladder starting after that.
 */
export const DAILY_PROMPT_HOUR = 16;
export const DAILY_PROMPT_MINUTE = 50;
export const DAILY_DUE_HOUR = 17;
export const DAILY_DUE_MINUTE = 30;

/** The instant today's report was owed, in the viewer's own timezone. */
export function dailyDueAt(now: Date = new Date()): Date {
  const due = new Date(now);
  due.setHours(DAILY_DUE_HOUR, DAILY_DUE_MINUTE, 0, 0);
  return due;
}

/** Weekends are not reporting days. */
export function isReportingDay(now: Date = new Date()): boolean {
  const day = now.getDay();
  return day !== 0 && day !== 6;
}

export function getTodayString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export interface DailyReportFormProps {
  /** Whose report this is. The popup passes the signed-in user's uid. */
  targetUserId: string;
  /**
   * Department template to render. The popup passes the signed-in user's own
   * position; the admin preview passes the position of the member being previewed
   * (or an arbitrary one, to inspect a craft nobody currently holds).
   */
  serviceLine?: string;
  /**
   * PREVIEW MODE — an admin looking at somebody else's form.
   *
   * Nothing is written: no report document, no task status change, no manager
   * notification. This is what keeps "shiko si punonjësi" from silently filing a
   * report in that person's name, which would corrupt the very compliance numbers
   * the feature exists to inspect.
   */
  preview?: boolean;
  /** Called after a real (non-preview) submit succeeds. */
  onSubmitted?: () => void;
  /** Rendered to the left of the submit button — the popup's "Më vonë". */
  secondaryAction?: React.ReactNode;
  /**
   * Override the CRM / projects sections. Defaults to the VIEWER's permissions,
   * which is right for the popup; the preview passes the TARGET's, otherwise a
   * designer's form would sprout a sales pipeline just because an admin opened it.
   */
  showCrmSection?: boolean;
  showProjectsSection?: boolean;
}

/**
 * The daily report form itself — the single rendering of these questions.
 *
 * Deliberately extracted from `DailyReportPopup`: the admin preview needs the exact
 * same form, and a second copy would drift the first time a field is added (the
 * preview would then show a form no employee ever sees, which is worse than no
 * preview at all). The popup owns the schedule and the dialog; this owns the questions.
 */
const DailyReportForm: React.FC<DailyReportFormProps> = ({
  targetUserId,
  serviceLine,
  preview = false,
  onSubmitted,
  secondaryAction,
  showCrmSection,
  showProjectsSection,
}) => {
  const { user } = useAuth();
  const permissions = usePermissions();

  const withCrm = showCrmSection ?? permissions.canAccessCRM;
  const withProjects = showProjectsSection ?? permissions.canAccessProjects;

  // Form state
  const [completedToday, setCompletedToday] = useState('');
  const [openItems, setOpenItems] = useState('');
  const [blockers, setBlockers] = useState('');
  const [planTomorrow, setPlanTomorrow] = useState('');
  const [hoursWorked, setHoursWorked] = useState<string>('8');
  const [mood, setMood] = useState<'great' | 'good' | 'neutral' | 'struggling'>('good');
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([]);
  const [customFields, setCustomFields] = useState<Record<string, string | number>>({});
  // The day's plan, answered. Seeded from the real tasks once they arrive.
  const [outcomes, setOutcomes] = useState<DailyTaskOutcome[]>([]);
  const [outcomesSeeded, setOutcomesSeeded] = useState(false);
  /**
   * Has the person edited the narrative by hand? Until they do, it is regenerated
   * from the answered rows — after they do, we never overwrite their words.
   */
  const [narrativeTouched, setNarrativeTouched] = useState(false);
  const [showIssues, setShowIssues] = useState(false);
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

  const today = getTodayString();

  // Always loaded, even when the projects picker is hidden: it is what maps a task
  // to the client it served, which is what the per-client questions are asked about.
  const { data: projects } = useCollection<Project>('projects');

  // Everything below is keyed on the TARGET, not the signed-in user — that is what
  // makes the preview honest: the admin sees the previewed person's real workload.
  const { data: myTasks } = useCollection<Task>('tasks', {
    where: [{ field: 'assignedToUserId', operator: '==', value: targetUserId || '__never__' }],
  });

  const { data: myLeads } = useCollection<Lead>('leads', {
    where: [{ field: 'assignedToUserId', operator: '==', value: targetUserId || '__never__' }],
    skip: !withCrm,
  });

  // Today's standup (for plan vs reality comparison)
  const { data: todayStandups } = useCollection<StandupEntry>('standups', {
    where: [
      { field: 'userId', operator: '==', value: targetUserId || '__never__' },
      { field: 'date', operator: '==', value: today },
    ],
  });

  // Team members — needed to notify managers on blocker reports
  const { data: teamMembers } = useCollection<TeamMember>('teamMembers', {
    skipTeamFilter: true,
    skip: preview || !permissions.teamId,
  });

  const reportMutation = useMutation<DailyReport>('dailyReports');
  const taskMutation = useMutation<Task>('tasks');
  const notificationMutation = useMutation<Notification>('notifications');

  const customerByProjectId = useMemo(() => {
    const map: Record<string, string | undefined> = {};
    for (const p of projects || []) map[p.id] = p.customerId;
    return map;
  }, [projects]);

  // ── Seed the plan, once ──
  // Only once: re-seeding on every task snapshot would wipe the reason somebody is
  // halfway through typing the moment a colleague touches an unrelated task.
  useEffect(() => {
    if (outcomesSeeded || !myTasks) return;
    setOutcomes(buildPlannedOutcomes(myTasks, new Date(), { customerByProjectId }));
    setOutcomesSeeded(true);
  }, [myTasks, outcomesSeeded, customerByProjectId]);

  const summary = useMemo(() => summariseOutcomes(outcomes), [outcomes]);
  const touchedCustomerIds = useMemo(() => customersTouched(outcomes), [outcomes]);

  // Names for the per-client questions. Skipped entirely until a client is actually
  // in play, so a report with no client work costs no extra read.
  const { data: customers } = useCollection<Customer>('customers', {
    skip: touchedCustomerIds.length === 0,
  });

  const customerOptions = useMemo(
    () => touchedCustomerIds.map(id => ({
      id,
      name: (customers || []).find(c => c.id === id)?.name || 'Klient',
    })),
    [touchedCustomerIds, customers],
  );

  // Keep the narrative in step with the rows until the person takes it over.
  useEffect(() => {
    if (narrativeTouched || !outcomesSeeded) return;
    const { completedToday: c, openItems: o } = narrativeFromOutcomes(outcomes);
    setCompletedToday(c);
    setOpenItems(o);
  }, [outcomes, narrativeTouched, outcomesSeeded]);

  // Projects follow the answered rows too — asking twice for what the tasks already
  // say is how the old form got half-empty project lists.
  useEffect(() => {
    if (!outcomesSeeded) return;
    setSelectedProjectIds(prev => {
      const derived = projectsTouched(outcomes);
      const merged = Array.from(new Set([...prev, ...derived]));
      return merged.length === prev.length && merged.every(id => prev.includes(id)) ? prev : merged;
    });
  }, [outcomes, outcomesSeeded]);

  const template = useMemo(() => getReportTemplate(serviceLine), [serviceLine]);

  const quality = useMemo(() => checkDailyReportQuality({
    completedToday,
    planTomorrow,
    blockers,
    hoursWorked: parseFloat(hoursWorked) || 0,
    outcomes,
    template,
    customFields,
    customerIds: touchedCustomerIds,
    workingStatus,
  }), [completedToday, planTomorrow, blockers, hoursWorked, outcomes, template, customFields, touchedCustomerIds, workingStatus]);

  const invalidFieldKeys = useMemo(
    () => quality.blockers.map(b => b.fieldKey).filter((k): k is string => !!k),
    [quality.blockers],
  );

  // ── outcome row helpers ──
  const patchOutcome = (index: number, patch: Partial<DailyTaskOutcome>) =>
    setOutcomes(prev => prev.map((o, i) => (i === index ? { ...o, ...patch } : o)));

  const addUnplanned = () => setOutcomes(prev => [...prev, unplannedOutcome('')]);

  const removeOutcome = (index: number) =>
    setOutcomes(prev => prev.filter((_, i) => i !== index));

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

  const todayStandup = useMemo(() => todayStandups?.[0] || null, [todayStandups]);

  const handleSubmit = async () => {
    // A preview must never reach Firestore. Guarded here as well as in the UI, so
    // the rule holds even if a future caller forgets to hide the button.
    if (preview) return;
    if (!user || !permissions.teamId) return;

    // One gate for everything: the same checker the person has been watching, so the
    // submit button never fails for a reason the form did not already show.
    if (!quality.canSubmit) {
      setShowIssues(true);
      toast({
        title: 'Raporti nuk është i plotë',
        description: quality.blockers[0]?.label,
        variant: 'destructive',
      });
      return;
    }

    setSubmitting(true);
    try {
      const savedOutcomes = cleanOutcomesForSave(outcomes);

      // Push the answers back onto the board, so the report and the tasks can never
      // tell two different stories about the same day.
      const statusUpdates = taskStatusUpdates(savedOutcomes);
      const statusResults = await Promise.allSettled(
        statusUpdates.map(u => taskMutation.update(u.taskId, { status: u.status } as any)),
      );
      const failedUpdates = statusResults.filter(r => r.status === 'rejected').length;

      const allCompletedIds = savedOutcomes
        .filter(o => o.state === 'done' && o.taskId)
        .map(o => o.taskId as string);

      // The deadline is a real instant, so lateness is measurable rather than guessed.
      const now = new Date();
      const dueAt = dailyDueAt(now);

      const workedHours = parseFloat(hoursWorked) || 8;
      // Only send the split when the person actually typed it — an absent split must
      // stay ABSENT, so the dashboard shows "not measured" instead of a false 0h.
      const billable = billableHours.trim() === '' ? undefined
        : Math.max(0, Math.min(workedHours, parseFloat(billableHours) || 0));

      // Customers are DERIVED — from the answered tasks first, then from any project
      // ticked by hand — rather than asking for the same information twice.
      const derivedCustomerIds = Array.from(new Set([
        ...touchedCustomerIds,
        ...selectedProjectIds
          .map(id => (projects || []).find(p => p.id === id)?.customerId)
          .filter((c): c is string => !!c),
      ]));

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
        taskOutcomes: savedOutcomes.length > 0 ? savedOutcomes : undefined,
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
        // Never `await` an un-caught notification here. The report is ALREADY saved
        // at this point, so a rejected notification (a manager without a `users`
        // document, an offline blip) fell into the outer catch and told the employee
        // "Nuk u ruajt raporti. Provo përsëri." — and they submitted a duplicate.
        await Promise.allSettled(managerRecipients.map(mgr =>
          notificationMutation.create({
            userId: mgr.userId,
            type: 'blocker_reported',
            title: 'Pengesa raportuar',
            message: `${submitterName}: "${blockers.trim().slice(0, 120)}"`,
            isRead: false,
            actionUrl: '/app/reports?side=internal&tab=daily',
            actionLabel: 'Shiko raportin',
          } as any)
        ));
      }

      toast({
        title: 'Raporti ditor u ruajt!',
        // A task that failed to move is worth saying out loud — the report is filed
        // either way, but the board is now one step behind it.
        description: failedUpdates
          ? `${failedUpdates} detyra nuk u përditësuan në tabelë — kontrolloji.`
          : 'Faleminderit për raportimin.',
      });
      setCompletedToday('');
      setOpenItems('');
      setBlockers('');
      setPlanTomorrow('');
      setHoursWorked('8');
      setMood('good');
      setSelectedProjectIds([]);
      setOutcomes([]);
      setNarrativeTouched(false);
      setCustomFields({});
      onSubmitted?.();
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

  return (
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

      {/* ── 1. The day's plan, answered ─────────────────────────── */}
      {/* This comes FIRST on purpose: the questions below are easier to answer once
          the day has been walked through, and the summary writes itself from here. */}
      <div className="space-y-2">
        <Label className="flex items-center gap-2">
          <ListChecks className="w-4 h-4 text-primary" />
          Detyrat e ditës
          {summary.planned > 0 && (
            <Badge variant="outline" className="text-[10px] ml-auto font-normal">
              {summary.done}/{summary.planned} të mbyllura
            </Badge>
          )}
        </Label>

        {outcomes.length === 0 && (
          <p className="text-xs text-muted-foreground border border-dashed border-border rounded-lg px-3 py-2">
            Nuk kishe detyra të planifikuara sot. Shto çfarë punove më poshtë.
          </p>
        )}

        {outcomes.map((o, i) => {
          const needsReason = outcomeNeedsReason(o);
          const blank = !(o.title || '').trim();
          return (
            <div
              key={o.taskId || `unplanned-${i}`}
              className={`rounded-lg border p-2 space-y-2 ${
                needsReason || (blank && showIssues)
                  ? 'border-error/50 bg-error/5'
                  : 'border-border bg-muted/30'
              }`}
            >
              <div className="flex items-start gap-2">
                {o.unplanned ? (
                  <Input
                    value={o.title}
                    onChange={(e) => patchOutcome(i, { title: e.target.value })}
                    placeholder="Çfarë ishte kjo punë?"
                    className="h-8 text-sm flex-1"
                  />
                ) : (
                  <span className="text-sm flex-1 pt-1 break-words">{o.title}</span>
                )}
                {o.unplanned && (
                  <button
                    type="button"
                    onClick={() => removeOutcome(i)}
                    className="text-muted-foreground hover:text-error p-1"
                    aria-label="Hiq rreshtin"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {OUTCOME_STATES.map(s => (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => patchOutcome(i, { state: s.key })}
                    className={`text-[11px] px-2.5 py-1 rounded-full border transition-all ${
                      o.state === s.key ? s.cls : 'border-border text-muted-foreground hover:border-primary/40'
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
                <Input
                  type="number"
                  min="0"
                  step="0.5"
                  value={o.hours ?? ''}
                  onChange={(e) => patchOutcome(i, { hours: e.target.value === '' ? undefined : parseFloat(e.target.value) })}
                  placeholder="orë"
                  className="h-7 w-16 text-xs ml-auto"
                />
              </div>

              {/* The reason is the whole point of the structure — see dailyReportPlan.ts. */}
              {!o.unplanned && o.state !== 'done' && (
                <Input
                  value={o.reason || ''}
                  onChange={(e) => patchOutcome(i, { reason: e.target.value })}
                  placeholder={o.state === 'in_progress' ? 'Sa mbeti dhe pse? (e detyrueshme)' : 'Pse nuk u prek? (e detyrueshme)'}
                  className={`h-8 text-sm ${needsReason ? 'border-error focus-visible:ring-error' : ''}`}
                />
              )}
            </div>
          );
        })}

        <Button type="button" variant="ghost" size="sm" onClick={addUnplanned} className="text-xs">
          <Plus className="w-3.5 h-3.5 mr-1.5" />
          Punë e paplanifikuar
        </Button>
      </div>

      {/* ── 2. The narrative, written for them ──────────────────── */}
      <div>
        <Label className="flex items-center gap-2 mb-1.5">
          <CheckCircle2 className="w-4 h-4 text-success" />
          Çfarë përfundova sot *
          {!narrativeTouched && outcomes.length > 0 && (
            <span className="text-[10px] text-muted-foreground font-normal ml-auto">
              plotësuar nga detyrat — redaktoje lirisht
            </span>
          )}
        </Label>
        <Textarea
          value={completedToday}
          onChange={(e) => { setNarrativeTouched(true); setCompletedToday(e.target.value); }}
          placeholder="p.sh. Përfundova 3 postime për Klientin A, optimizova fushatën Meta Ads..."
          rows={3}
        />
      </div>

      {/* ── Department (position) fields ───────────────────────── */}
      <DepartmentReportFields
        serviceLine={serviceLine}
        values={customFields}
        onChange={(k, v) => setCustomFields((prev) => ({ ...prev, [k]: v }))}
        customers={customerOptions}
        invalidKeys={showIssues ? invalidFieldKeys : []}
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
          onChange={(e) => { setNarrativeTouched(true); setOpenItems(e.target.value); }}
          placeholder="p.sh. Landing page për Klientin B, review i materialeve..."
          rows={2}
        />
      </div>

      {/* ── 3. Blockers ────────────────────────────────────────── */}
      <div>
        <Label className="flex items-center gap-2 mb-1.5">
          <AlertTriangle className="w-4 h-4 text-error" />
          Çfarë pengese kam
          {blockers.trim() && !preview && (
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
      {withProjects && projects && projects.length > 0 && (
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
      {withCrm && myLeads && myLeads.length > 0 && (
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

      {/* ── Quality ────────────────────────────────────────────── */}
      {/* Advisory by design: only the blockers stop a submission, and every one of
          them is a genuinely missing answer. See dailyReportQuality.ts. */}
      {!quality.waived && (quality.blockers.length > 0 || quality.suggestions.length > 0) && (
        <div className="rounded-lg border border-border overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 bg-muted/40">
            <span className="text-xs text-muted-foreground">Cilësia e raportit</span>
            <div className="flex-1 h-1.5 rounded-full bg-border overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  quality.score >= 80 ? 'bg-success' : quality.score >= 50 ? 'bg-warning' : 'bg-error'
                }`}
                style={{ width: `${quality.score}%` }}
              />
            </div>
            <span className="text-xs font-medium tabular-nums">{quality.score}</span>
          </div>

          {quality.blockers.length > 0 && (
            <ul className="px-3 py-2 space-y-1 border-t border-border">
              {quality.blockers.map(b => (
                <li key={b.key} className="text-xs text-error flex items-start gap-1.5">
                  <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                  <span>
                    {b.label}
                    {b.hint && <span className="text-muted-foreground"> — {b.hint}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {quality.suggestions.length > 0 && (
            <ul className="px-3 py-2 space-y-1 border-t border-border">
              {quality.suggestions.map(s => (
                <li key={s.key} className="text-xs text-muted-foreground flex items-start gap-1.5">
                  <span className="mt-px">•</span>
                  <span>
                    {s.label}
                    {s.hint && <span className="opacity-80"> — {s.hint}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* ── Actions ────────────────────────────────────────────── */}
      <div className="flex justify-between items-center gap-3 pt-2">
        {secondaryAction || <span />}
        {preview ? (
          <span className="text-xs text-muted-foreground text-right">
            Parapamje — asgjë nuk ruhet dhe askush nuk njoftohet.
          </span>
        ) : (
          <Button onClick={handleSubmit} disabled={submitting || !quality.canSubmit}>
            {submitting ? 'Duke ruajtur...' : 'Dërgo Raportin'}
          </Button>
        )}
      </div>
    </div>
  );
};

export default DailyReportForm;
