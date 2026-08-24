import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { DndContext, DragOverlay, closestCorners, MouseSensor, TouchSensor, useSensor, useSensors, useDroppable, type DragStartEvent, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { getStatusColor, getInvoiceStatusLabel } from '../lib/statusColors';
import { useCollection, useMutation, useDocument } from '../hooks/useFirestore';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../contexts/PermissionsContext';
import { useToast } from '../hooks/use-toast';
import { ArrowLeft, Plus, LayoutGrid, List, Calendar as CalendarIcon, Users, Settings, MoreVertical, Trash2, MessageSquare, CheckSquare, Filter, Search, UserPlus, Eye, ClipboardList, Wallet, CheckCircle2, CircleDollarSign, Archive, ArchiveRestore } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Checkbox } from '../components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog';
import { Tabs, TabsList, TabsTrigger } from '../components/ui/tabs';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import TaskDetailPanel from '../components/TaskDetailPanel';
import QuickTaskForm, { QUICK_TASK_DIALOG_CLASS } from '../components/QuickTaskForm';
import ProjectClientBrief from '../components/ProjectClientBrief';
import { useFilteredTasks, useUniqueTeamMembers } from '../hooks/useRoleFilteredData';
import { useUserNames } from '../hooks/useUserNames';
import { useCommentFocus, COMMENT_FLASH_CLASS } from '../hooks/useCommentFocus';
import { portalProjectCommentDeepLink, taskDeepLink } from '../lib/deepLinks';
import { taskCompletedNotifications } from '../lib/taskNotifications';
import { resolvePortalUserId } from '../lib/notifyClient';
import { addFrequency, completeTask } from '../lib/recurringUtils';
import { claimTaskNextCycle, releaseTaskNextCycle } from '../lib/taskRecurrenceClaim';
import { formatCurrency, formatCompactRange, toAll, canSeeFinancials, cn } from '../lib/utils';
import { computeProjectLabor } from '../lib/finance/laborCost';
import { applyValuedTaskSideEffects } from '../lib/finance/taskValue';
import {
  getInvoiceTotalAll,
  getInvoiceCollectedAll,
  getInvoiceOutstandingAll,
  sumProjectDirectExpenses,
} from '../lib/finance/financialAnalytics';
import { getInquiryCompleteness } from '../lib/inquiryBrief';
import { archiveProjectPatch, isProjectArchived, restoreProjectPatch } from '../lib/projectArchive';
import { deleteProjectCascade, deleteTaskCascade, projectCascadeToastParts } from '../lib/deleteCascade';
import { Receipt } from 'lucide-react';
import type { Task, Project, Team, TeamMember, TimeEntry, Expense, Invoice, Customer, ServiceInquiry } from '../types';

// ── Project page — rebuilt against the hifi reference "Projekti FivoCRM.dc.html" ──
//
// LAYOUT CONTRACT — the header used to carry the title, the progress bar, the
// budget burn-down, the billing panel AND the whole client questionnaire, so a
// project with an inquiry pushed its task list ~700px below the fold. The rules
// that keep it readable:
//   · ONE hero: progress. Money is four KPI tiles beside it, never a panel in
//     the header.
//   · Anything that is not "what is the state of this project" is a TAB.
//   · The task filters belong to the task views only — they must not sit above
//     Financat/Anketa/Diskutimi, where they scope nothing.
//   · Colours come from the `brand-*` Tailwind tokens, never inline hexes.

/** White panel: the one card shape on this page (shared with Financat). */
const CARD = 'rounded-[20px] border border-brand-line bg-white shadow-[0_1px_3px_rgba(8,24,58,.05)]';
/** Every money figure and count. */
const NUM = 'font-mono tabular-nums';

const TASK_STATUS_META: Record<string, { label: string; pill: string; dot: string }> = {
  'Todo': { label: 'Për të bërë', pill: 'bg-brand-chip text-brand-chip-ink', dot: 'bg-brand-muted-2' },
  'In Progress': { label: 'Në progres', pill: 'bg-brand-blue-tint text-brand-blue-hover', dot: 'bg-brand-blue' },
  'Review': { label: 'Rishikim', pill: 'bg-brand-warn-tint text-brand-warn-ink', dot: 'bg-brand-warn' },
  'Done': { label: 'Përfunduar', pill: 'bg-brand-pos-tint text-brand-pos', dot: 'bg-brand-pos' },
};

const PRIORITY_META: Record<string, { label: string; pill: string }> = {
  urgent: { label: 'Urgjente', pill: 'bg-brand-neg-tint text-brand-neg-ink' },
  high: { label: 'E lartë', pill: 'bg-brand-neg-tint text-brand-neg-ink' },
  medium: { label: 'Mesatare', pill: 'bg-brand-warn-tint text-brand-warn-ink' },
  low: { label: 'E ulët', pill: 'bg-brand-chip text-brand-chip-ink' },
};

const INVOICE_PILL: Record<string, string> = {
  Paid: 'bg-brand-pos-tint text-brand-pos',
  Overdue: 'bg-brand-neg-tint text-brand-neg-ink',
  Cancelled: 'bg-brand-neg-tint text-brand-neg-ink',
  Draft: 'bg-brand-chip text-brand-chip-ink',
  default: 'bg-brand-blue-tint text-brand-blue-hover',
};

/** The one column ruler for the task list — header and rows must agree. */
const TASK_COLS = 'grid grid-cols-[1fr_130px_150px_110px_70px] items-center gap-3';

/** Pill tab, styled to the reference: active = white on the chip track. */
const PillTab: React.FC<{
  value: string;
  icon?: React.ReactNode;
  badge?: number;
  children: React.ReactNode;
}> = ({ value, icon, badge, children }) => (
  <TabsTrigger
    value={value}
    className={cn(
      'gap-2 rounded-[11px] px-4 py-2 text-[13px] font-bold text-brand-muted transition-all',
      'data-[state=active]:bg-white data-[state=active]:text-brand-navy',
      'data-[state=active]:shadow-[0_2px_6px_rgba(8,24,58,.12)]',
    )}
  >
    {icon}
    {children}
    {badge != null && badge > 0 && (
      <span className="rounded-full bg-brand-neg px-1.5 py-px text-[10.5px] font-extrabold tabular-nums text-white">
        {badge}
      </span>
    )}
  </TabsTrigger>
);

/** One line of the hero's supporting stats. */
const HeroRow: React.FC<{
  label: string;
  value: string;
  tone?: 'default' | 'neg' | 'warn';
}> = ({ label, value, tone = 'default' }) => (
  <div className="flex items-center justify-between gap-3.5 border-t border-white/10 pt-2.5">
    <span className="min-w-0 text-[12.5px] font-semibold leading-tight text-[#b9c7e2]">{label}</span>
    <span className={cn(
      'shrink-0 whitespace-nowrap text-[12.5px] font-bold',
      NUM,
      tone === 'neg' && 'text-[#f2b8b8]',
      tone === 'warn' && 'text-[#f6d998]',
      tone === 'default' && 'text-white',
    )}>
      {value}
    </span>
  </div>
);

/** One of the four money measures beside the hero. */
const KpiTile: React.FC<{
  icon: React.ReactNode;
  iconBg: string;
  iconInk: string;
  dangerIconBg?: string;
  dangerIconInk?: string;
  label: string;
  value: string;
  valueInk?: string;
  sub: string;
  danger?: boolean;
}> = ({ icon, iconBg, iconInk, dangerIconBg, dangerIconInk, label, value, valueInk, sub, danger }) => (
  <div className={cn(
    'flex flex-col gap-1.5 rounded-[20px] border p-5 shadow-[0_1px_3px_rgba(8,24,58,.05)]',
    danger ? 'border-brand-neg-line bg-[#fdf7f7]' : 'border-brand-line bg-white',
  )}>
    <div className="flex items-center gap-2.5">
      <span
        aria-hidden="true"
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px]',
          danger ? (dangerIconBg || iconBg) : iconBg,
          danger ? (dangerIconInk || iconInk) : iconInk,
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 truncate text-xs font-bold text-brand-muted">{label}</span>
    </div>
    <p className={cn(
      'truncate text-2xl font-extrabold leading-tight tracking-[-0.01em]',
      NUM,
      danger ? 'text-brand-neg-ink' : valueInk || 'text-brand-navy',
    )}>
      {value}
    </p>
    <p className={cn('text-xs font-semibold', danger ? 'text-brand-neg-ink' : 'text-brand-muted')}>{sub}</p>
  </div>
);

/** Label + amount, the row shape shared by the two Financat cards. */
const MoneyRow: React.FC<{
  label: string;
  value: number;
  tone?: 'pos' | 'neg' | 'warn';
  hint?: string;
}> = ({ label, value, tone, hint }) => (
  <div className="flex items-center justify-between gap-3.5 border-t border-brand-line-softer pt-2.5">
    <span className="min-w-0 text-[12.5px] font-semibold text-brand-muted">{label}</span>
    <span className={cn(
      'shrink-0 whitespace-nowrap text-[12.5px] font-bold',
      NUM,
      tone === 'pos' && 'text-brand-pos',
      tone === 'neg' && 'text-brand-neg-ink',
      tone === 'warn' && 'text-brand-warn-ink',
      !tone && 'text-brand-ink',
    )}>
      {formatCurrency(value, 'ALL')}
      {hint && <span className="ml-1.5 font-semibold text-brand-muted">({hint})</span>}
    </span>
  </div>
);

const ProjectDetailView: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const permissions = usePermissions();
  const { toast } = useToast();

  // The budget, the billing panel and the client questionnaire used to live in
  // the header, stacked above the task list. They are tabs now.
  const [viewMode, setViewMode] = useState<
    'list' | 'board' | 'calendar' | 'finances' | 'brief' | 'discussion'
  >('list');
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  // Deep links from comment notifications: which task comment / project comment to
  // scroll to. Tagged with the task so it never leaks onto the next task opened.
  const [focusComment, setFocusComment] = useState<{ taskId: string; commentId: string } | null>(null);
  const [focusProjectCommentId, setFocusProjectCommentId] = useState<string | null>(null);
  const [isCreateTaskOpen, setIsCreateTaskOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isGuestDialogOpen, setIsGuestDialogOpen] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deletingProject, setDeletingProject] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  // Filter by assignee (a member userId, 'all', or 'unassigned'). Applies to every
  // view in this project — list, board and calendar.
  const [filterAssignee, setFilterAssignee] = useState<string>('all');
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
  // ALL the business's tasks — fetched only while the create dialog is open. The
  // quick form's capacity bars need the assignee's booked hours across EVERY
  // project; rawProjectTasks (scoped to this project) would under-report them.
  const { data: capacityTasks } = useCollection<Task>('tasks', {
    skip: !isCreateTaskOpen,
    skipTeamFilter: true,
  });
  // Workspace-wide label set for the quick form's label chips.
  const allLabels = React.useMemo(() => {
    const s = new Set<string>();
    (capacityTasks || allTasks || []).forEach(t => ((t as any).labels as string[] | undefined)?.forEach(l => s.add(l)));
    return Array.from(s).sort();
  }, [capacityTasks, allTasks]);
  const { data: teams } = useCollection<Team>('teams');
  const { data: rawTeamMembers } = useCollection<TeamMember>('teamMembers', {
    where: [{ field: 'status', operator: '==', value: 'Active' }]
  });
  const teamMembers = useUniqueTeamMembers(rawTeamMembers);
  // Team-scoped (not skipTeamFilter) so we don't download every team's comments
  // from the whole database; comments are then matched per task client-side.
  const { data: comments } = useCollection<any>('taskComments');
  // Project-level discussion with the client (the portal writes into the same
  // collection). Staff had no view of these at all, so a "koment i ri nga klienti"
  // notification had nowhere to land. Sorted client-side to avoid a composite index.
  const { data: rawProjectComments } = useCollection<any>('projectComments', {
    where: projectId ? [{ field: 'projectId', operator: '==', value: projectId }] : undefined,
    skip: !projectId,
    skipTeamFilter: true,
  });
  const projectComments = React.useMemo(() => {
    const tms = (v: any) => (v instanceof Date ? v.getTime() : v?.toMillis?.() ?? 0);
    return [...(rawProjectComments || [])].sort((a, b) => tms(a.createdAt) - tms(b.createdAt));
  }, [rawProjectComments]);

  const projectMutation = useMutation<Project>('projects');
  const taskMutation = useMutation<Task>('tasks');
  const commentMutation = useMutation<any>('taskComments');
  const projectCommentMutation = useMutation<any>('projectComments');
  const notificationMutation = useMutation<any>('notifications');

  // Time entries for this project — used to show logged hours
  const { data: timeEntries } = useCollection<TimeEntry>('timeEntries', {
    where: projectId ? [{ field: 'projectId', operator: '==', value: projectId }] : undefined,
    skip: !projectId,
    skipTeamFilter: true,
  });

  // Project expenses (for budget burn-down = labor cost + expenses).
  // The `where` is applied CLIENT-side for a business-scoped collection, so it
  // never reduced what was downloaded — it only gave this view its own cache key
  // and therefore its own extra listener over the whole collection. Subscribe
  // with the shared options and filter here instead.
  const { data: allExpenses } = useCollection<Expense>('expenses', { skipTeamFilter: true });
  const projectExpenses = React.useMemo(
    () => (allExpenses || []).filter(e => e.projectId === projectId),
    [allExpenses, projectId],
  );

  // Invoices for this project. The view previously showed ONLY the cost side (labor
  // + expenses) — the revenue side was invisible here, so nothing ever surfaced that
  // a project was billed for more or less than its agreed budget.
  const { data: projectInvoices } = useCollection<Invoice>('invoices', {
    where: projectId ? [{ field: 'projectId', operator: '==', value: projectId }] : undefined,
    skip: !projectId,
    skipTeamFilter: true,
  });

  const billingStats = React.useMemo(() => {
    const list = projectInvoices || [];
    const budget = toAll(Number(project?.budget) || 0, project?.currency);
    // Drafts are not billed yet; cancelled invoices never were.
    const issued = list.filter(i => i.status !== 'Draft' && i.status !== 'Cancelled');
    const drafts = list.filter(i => i.status === 'Draft');
    const billed = issued.reduce((s, i) => s + getInvoiceTotalAll(i), 0);
    const collected = issued.reduce((s, i) => s + getInvoiceCollectedAll(i), 0);
    const outstanding = issued.reduce((s, i) => s + getInvoiceOutstandingAll(i), 0);
    const draftValue = drafts.reduce((s, i) => s + getInvoiceTotalAll(i), 0);
    // Monthly retainers legitimately bill their fee many times over, so an
    // over/under-billed comparison against a single fee is meaningless for them.
    const billingType = project?.billingType || (project?.isRecurring ? 'monthly' : 'one-time');
    const comparable = billingType === 'one-time' && budget > 0;
    const diff = billed - budget;
    return {
      budget, billed, collected, outstanding, draftValue,
      invoiceCount: list.length, issuedCount: issued.length, draftCount: drafts.length,
      comparable,
      pct: budget > 0 ? Math.round((billed / budget) * 100) : 0,
      overBilled: comparable && diff > 0.5,
      underBilled: comparable && diff < -0.5,
      diff,
    };
  }, [projectInvoices, project?.budget, project?.currency, project?.billingType, project?.isRecurring]);

  // Budget burn-down: labor cost (logged hours × member cost-rate) + expenses,
  // compared to the project budget. Plus realization (billable value vs cost).
  const budgetStats = React.useMemo(() => {
    // Normalizo buxhetin në ALL (puna + shpenzimet janë në ALL) që krahasimi/marzhi
    // të jenë të saktë edhe kur projekti është në EUR.
    const budget = toAll(Number(project?.budget) || 0, project?.currency);
    const membersByUserId = new Map<string, TeamMember>();
    (teamMembers || []).forEach(m => { if (m.userId) membersByUserId.set(m.userId, m); });
    const labor = computeProjectLabor(timeEntries || [], membersByUserId);
    // The SHARED predicate — a plain reduce here counted rejected rows and
    // Salary-category rows, so this page disagreed with `project.spent` (written
    // by the project-spend-rollup cron) and with projectPnl's directCost on the
    // Financat screen: three different answers to "what did this project cost".
    const expensesTotal = sumProjectDirectExpenses(projectExpenses, projectId);
    const spent = labor.cost + expensesTotal;
    const pct = budget > 0 ? Math.round((spent / budget) * 100) : 0;
    // Optional per-task pricing: when tasks carry a `value`, their sum is an
    // alternative read of what the project is worth (and what is already earned
    // via Done tasks) next to the single project budget.
    const valued = (allTasks || []).filter((t: any) => Number(t.value) > 0);
    const taskValueTotal = valued.reduce((s: number, t: any) => s + toAll(Number(t.value) || 0, project?.currency), 0);
    const taskValueDone = valued
      .filter((t: any) => t.status === 'Done')
      .reduce((s: number, t: any) => s + toAll(Number(t.value) || 0, project?.currency), 0);

    return {
      budget, laborCost: labor.cost, expensesTotal, spent, pct,
      overBudget: budget > 0 && spent > budget,
      remaining: budget - spent,
      billableValue: labor.billableValue,
      billableHours: labor.billableHours,
      margin: budget > 0 ? budget - spent : labor.billableValue - spent,
      taskValueTotal, taskValueDone, valuedTaskCount: valued.length,
    };
  }, [project?.budget, project?.currency, teamMembers, timeEntries, projectExpenses, allTasks]);

  // Total hours logged for the project and per task
  const { totalHours, hoursByTask } = React.useMemo(() => {
    if (!timeEntries) return { totalHours: 0, hoursByTask: new Map<string, number>() };
    let total = 0;
    const byTask = new Map<string, number>();
    for (const e of timeEntries) {
      const mins = e.duration
        ? e.duration / 60
        : e.startTime && e.endTime
          ? (new Date(e.endTime).getTime() - new Date(e.startTime).getTime()) / 60000
          : 0;
      total += mins;
      if (e.taskId) byTask.set(e.taskId, (byTask.get(e.taskId) || 0) + mins);
    }
    return { totalHours: total / 60, hoursByTask: byTask };
  }, [timeEntries]);

  const { getName, getInitials } = useUserNames(teamMembers || []);

  // Filter tasks — applies to list, board AND calendar.
  const tasks = React.useMemo(() => {
    if (!allTasks) return [];
    let filtered = allTasks.filter(t => !t.parentTaskId);

    if (filterAssignee !== 'all') {
      filtered = filterAssignee === 'unassigned'
        ? filtered.filter(t => !t.assignedToUserId)
        : filtered.filter(t => t.assignedToUserId === filterAssignee);
    }

    if (filterStatus !== 'all') {
      filtered = filtered.filter(t => t.status === filterStatus);
    }

    if (searchQuery) {
      filtered = filtered.filter(t =>
        t.title.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    return filtered;
  }, [allTasks, filterStatus, filterAssignee, searchQuery]);

  const team = teams?.find(t => t.id === project?.teamId);
  // Respect explicit memberUserIds; fall back to full team
  const projectMembers = React.useMemo(() => {
    if (!teamMembers) return [];
    if (project?.memberUserIds && project.memberUserIds.length > 0) {
      return teamMembers.filter(m => project.memberUserIds!.includes(m.userId));
    }
    return teamMembers.filter(m => m.teamId === project?.teamId);
  }, [teamMembers, project]);

  // Is the current user a guest on this project? (read-only + comments, no editing)
  const isGuestOnProject = React.useMemo(() => {
    if (!user || !project) return false;
    const guestIds: string[] = project.guestUserIds || [];
    return guestIds.includes(user.uid);
  }, [user, project]);

  // Deep links from notifications: `?taskId=…&comment=…` opens the task panel on
  // that comment, `?projectComment=…` focuses the client discussion below the list.
  useEffect(() => {
    const projectCommentParam = searchParams.get('projectComment');
    const taskIdParam = searchParams.get('taskId');
    if (!projectCommentParam && !taskIdParam) return;
    if (projectCommentParam) {
      setFocusProjectCommentId(projectCommentParam);
      // The client discussion is a tab now, so the notification link has to
      // open it — otherwise it lands on the task list and the comment it
      // promised is nowhere on screen.
      setViewMode('discussion');
    }
    if (taskIdParam) {
      // Fall back to the raw list: a task you were @mentioned on can be hidden by
      // the role filter, and the notification link must still open it.
      const target = (allTasks || []).find(t => t.id === taskIdParam)
        || (rawProjectTasks || []).find(t => t.id === taskIdParam);
      if (!target) return; // tasks still loading — retry on the next snapshot
      setSelectedTask(target);
      const commentParam = searchParams.get('comment');
      setFocusComment(commentParam ? { taskId: target.id, commentId: commentParam } : null);
    }
    setSearchParams({}, { replace: true });
  }, [searchParams, allTasks, rawProjectTasks, setSearchParams]);

  // Keep selectedTask in sync with live Firestore data
  useEffect(() => {
    if (selectedTask && allTasks) {
      const updated = allTasks.find(t => t.id === selectedTask.id);
      if (updated && JSON.stringify(updated) !== JSON.stringify(selectedTask)) {
        setSelectedTask(updated);
      }
    }
  }, [allTasks, selectedTask]);

  // Progress uses ALL top-level tasks from the RAW (unfiltered) project tasks —
  // the role-filtered `allTasks` would make a Member who only sees their own Done
  // task read as 100% complete. Mirrors the auto-complete check below.
  const allTopLevelTasks = React.useMemo(() =>
    (rawProjectTasks || []).filter(t => !t.parentTaskId),
    [rawProjectTasks]
  );
  const completedTasks = allTopLevelTasks.filter(t => t.status === 'Done').length;
  const totalTasks = allTopLevelTasks.length;
  const progress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  // ── Header / hero context ──

  // Client name for the header subtitle. `useDocument` no-ops on an empty id.
  const { data: customer } = useDocument<Customer>('customers', project?.customerId || '');

  // The questionnaire is fetched HERE, not inside <ProjectClientBrief>, because
  // the tab badge needs its completeness count before the tab is ever opened.
  const { data: inquiry } = useDocument<ServiceInquiry>(
    'serviceInquiries',
    project?.sourceQuestionnaireId || '',
  );
  const briefMissingCount = React.useMemo(
    () => (inquiry ? getInquiryCompleteness(inquiry).missing.length : 0),
    [inquiry],
  );

  const overdueTaskCount = React.useMemo(() => {
    const now = Date.now();
    return allTopLevelTasks.filter(t => {
      if (t.status === 'Done' || !t.endDate) return false;
      const end = new Date(t.endDate as any).getTime();
      return !isNaN(end) && end < now;
    }).length;
  }, [allTopLevelTasks]);

  /**
   * A project has no deadline field of its own, so it is derived: for a
   * recurring project the next cycle date, otherwise the latest due date among
   * the tasks still open. Null when there is nothing to promise.
   */
  const deadline = React.useMemo(() => {
    if (project?.isRecurring && project.nextRecurringDate) {
      const d = new Date(project.nextRecurringDate as any);
      return isNaN(d.getTime()) ? null : { date: d, recurring: true };
    }
    let latest: Date | null = null;
    for (const t of allTopLevelTasks) {
      if (t.status === 'Done' || !t.endDate) continue;
      const d = new Date(t.endDate as any);
      if (isNaN(d.getTime())) continue;
      if (!latest || d > latest) latest = d;
    }
    return latest ? { date: latest, recurring: false } : null;
  }, [project?.isRecurring, project?.nextRecurringDate, allTopLevelTasks]);

  /**
   * Client messages still awaiting a reply = the trailing run of client
   * comments. Anything before the team's last answer has been dealt with.
   */
  const unansweredClientComments = React.useMemo(() => {
    let count = 0;
    for (let i = projectComments.length - 1; i >= 0; i--) {
      if (projectComments[i].senderType === 'client') count++;
      else break;
    }
    return count;
  }, [projectComments]);

  /** The single worst outstanding invoice — the sub-line of the "Pa arkëtuar" tile. */
  const mostOverdueInvoice = React.useMemo(() => {
    let worst: { label: string; days: number } | null = null;
    const now = Date.now();
    for (const inv of projectInvoices || []) {
      if (getInvoiceOutstandingAll(inv) <= 0) continue;
      if (!inv.dueDate) continue;
      const due = new Date(inv.dueDate as any).getTime();
      if (isNaN(due)) continue;
      const days = Math.floor((now - due) / 86_400_000);
      if (days <= 0) continue;
      if (!worst || days > worst.days) {
        worst = { label: inv.invoiceNumber || inv.id.slice(0, 8), days };
      }
    }
    return worst;
  }, [projectInvoices]);

  const showFinancials = canSeeFinancials(permissions);
  const hasBrief = !!inquiry;
  /** The filters scope the task views only — see the layout contract. */
  const isTaskView = viewMode === 'list' || viewMode === 'board' || viewMode === 'calendar';



  const handleCreateTask = async (formData: FormData, opts?: { createAnother?: boolean }) => {
    const title = formData.get('title') as string;
    if (!title || !title.trim()) return;
    const description = formData.get('description') as string;
    const startDateStr = formData.get('startDate') as string;
    const endDateStr = formData.get('endDate') as string;
    const startDate = startDateStr ? new Date(startDateStr) : new Date();
    const endDate = endDateStr ? new Date(endDateStr) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    if (startDate > endDate) {
      toast({ title: 'Datat e pavlefshme', description: 'Data e fillimit nuk mund të jetë pas datës së mbarimit.', variant: 'destructive' });
      return;
    }
    const assignedToUserId = formData.get('assignedToUserId') as string || user?.uid || '';
    const section = (formData.get('section') as string || '').trim();
    const priority = formData.get('priority') as string || 'medium';
    const status = formData.get('status') as string || 'Todo';
    const isRecurring = formData.get('isRecurring') === 'true';
    const recurringFrequency = formData.get('recurringFrequency') as string || 'weekly';
    const recurringInterval = parseInt(formData.get('recurringInterval') as string) || 1;
    const recurringDayOfWeek = formData.get('recurringDayOfWeek') !== null ? parseInt(formData.get('recurringDayOfWeek') as string) : undefined;
    const recurringDayOfMonth = formData.get('recurringDayOfMonth') !== null ? parseInt(formData.get('recurringDayOfMonth') as string) : undefined;
    const recurringDaysOfWeekRaw = formData.get('recurringDaysOfWeek') as string;
    const recurringDaysOfWeekParsed: number[] | undefined = recurringDaysOfWeekRaw
      ? (() => { try { return JSON.parse(recurringDaysOfWeekRaw); } catch { return [1,2,3,4,5]; } })()
      : undefined;
    // The quick form's time window doubles as the estimate — it feeds the
    // capacity load bars, so it must be persisted like TasksView does.
    const estimatedHoursRaw = formData.get('estimatedHours') as string;
    const estimatedHours = estimatedHoursRaw ? parseFloat(estimatedHoursRaw) : NaN;
    const labelsRaw = formData.get('labels') as string;
    let labels: string[] = [];
    try { labels = labelsRaw ? JSON.parse(labelsRaw) : []; } catch { labels = []; }

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
      ...(!isNaN(estimatedHours) && estimatedHours > 0 ? { estimatedHours } : {}),
      ...(labels.length > 0 ? { labels } : {}),
      ...(section ? { section } : {}),
      // Optional billable value for this task (left blank when it doesn't apply).
      ...(() => {
        const raw = formData.get('value') as string;
        const v = raw ? parseFloat(raw) : NaN;
        return !isNaN(v) && v >= 0 ? { value: v } : {};
      })(),
      // Stamp the project's team so creation works even when there's no global
      // active team (e.g. a super-admin viewing across teams).
      ...(project?.teamId ? { teamId: project.teamId } : {}),
      // Carry the business/tenant scope too — without businessId the task falls
      // outside the business-scoped task query and vanishes from list & calendar.
      ...(project?.businessId ? { businessId: project.businessId } : {}),
    };

    if (isRecurring) {
      taskData.isRecurring = true;
      taskData.recurringFrequency = recurringFrequency;
      taskData.recurringInterval = recurringInterval;
      // "Përsërit deri" — the quick form sends YYYY-MM-DD (same as TasksView's
      // handler; this one used to drop it, so repeat-until never stuck here).
      const recurringEndDateRaw = formData.get('recurringEndDate') as string;
      if (recurringEndDateRaw) {
        const [ry, rm, rd] = recurringEndDateRaw.split('-').map(Number);
        if (ry && rm && rd) taskData.recurringEndDate = new Date(ry, rm - 1, rd);
      }
      taskData.dueNotificationSent = false;

      // Calculate nextRecurringDate from the selected day-of-week / days-of-week
      const now = new Date();
      if (recurringFrequency === 'weekly' && recurringDayOfWeek !== undefined && !isNaN(recurringDayOfWeek)) {
        taskData.recurringDayOfWeek = recurringDayOfWeek;
        // Compute next occurrence of the selected weekday
        const next = new Date(now);
        const currentDay = now.getDay();
        let daysUntil = recurringDayOfWeek - currentDay;
        if (daysUntil <= 0) daysUntil += 7;
        next.setDate(next.getDate() + daysUntil);
        next.setHours(9, 0, 0, 0);
        taskData.nextRecurringDate = next;
      } else if (recurringFrequency === 'daily') {
        const activeDays = recurringDaysOfWeekParsed ?? [1,2,3,4,5];
        taskData.recurringDaysOfWeek = activeDays;
        // Compute next weekday in the active list
        const next = new Date(now);
        next.setDate(next.getDate() + 1);
        next.setHours(9, 0, 0, 0);
        let tries = 0;
        while (activeDays.length > 0 && !activeDays.includes(next.getDay()) && tries < 7) {
          next.setDate(next.getDate() + 1);
          tries++;
        }
        taskData.nextRecurringDate = next;
      } else if (recurringFrequency === 'monthly' && recurringDayOfMonth !== undefined && !isNaN(recurringDayOfMonth)) {
        taskData.recurringDayOfMonth = recurringDayOfMonth;
        // Clamp to the month's last day (same as TasksView's buildMonthly) —
        // `new Date(y, m, 31)` overflows into the NEXT month (Feb 31 → Mar 3),
        // which pushed the cron's due-gate days late for day-29/30/31 series.
        const buildMonthly = (year: number, month: number) => {
          const lastDay = new Date(year, month + 1, 0).getDate();
          return new Date(year, month, Math.min(recurringDayOfMonth, lastDay), 9, 0, 0);
        };
        let next = buildMonthly(now.getFullYear(), now.getMonth());
        if (next <= now) next = buildMonthly(now.getFullYear(), now.getMonth() + 1);
        taskData.nextRecurringDate = next;
      } else {
        // yearly or fallback: use endDate
        taskData.nextRecurringDate = new Date(endDate);
      }
    }

    const newTask = await taskMutation.create(taskData);

    // A task created with a monetary value gets its own invoice, as a DRAFT: a
    // draft never counts as revenue, so it can never collide with the project's
    // own budget billing. Review it in Faturat and send it when it's right.
    const taskValue = Number(taskData.value) || 0;
    if (taskValue > 0) {
      try {
        // Shared side-effects (src/lib/finance/taskValue.ts): draft invoice +
        // line item, budget increment ONLY for one-time projects (a recurring
        // project's budget is its per-period fee — growing it would raise every
        // future auto-invoice and double-bill the same work), idempotency flag.
        const result = await applyValuedTaskSideEffects({
          taskId: (newTask as any).id,
          taskTitle: title,
          value: taskValue,
          project: project ? { ...(project as any), id: projectId! } : null,
        });
        toast({
          title: 'Detyra u krijua + faturë Draft ✓',
          description: result.appliedToBudget
            ? `${result.invoiceNumber} për ${taskValue.toLocaleString()} · buxheti i projektit u rrit me ${taskValue.toLocaleString()}.`
            : `${result.invoiceNumber} për ${taskValue.toLocaleString()} · tarifa periodike e projektit nuk u prek (faturohet vetëm një herë).`,
        });
      } catch (err: any) {
        console.error('[Tasks] draft invoice for valued task failed:', err);
        toast({
          title: 'Detyra u ruajt, fatura jo',
          description: err?.message || 'Fatura nuk u krijua — provo ta shtosh manualisht.',
          variant: 'destructive',
        });
      }
    }

    if (assignedToUserId && assignedToUserId !== user?.uid) {
      await notificationMutation.create({
        userId: assignedToUserId,
        type: 'task_assigned',
        title: 'Detyrë e Re e Caktuar',
        message: `Ju u caktuat te detyra: ${title}`,
        isRead: false,
        // Land on the task itself (opens the panel), not just the project page.
        actionUrl: taskDeepLink((newTask as any).id, projectId),
        actionLabel: 'Shiko Detyrën',
      }).catch(err => console.error('[Notifications] task_assigned dërgim dështoi:', err));
    }

    // Notify guests about the new task
    if (project) {
      const guestIds: string[] = project.guestUserIds || [];
      await Promise.all(
        guestIds
          // Skip the assignee too — they already got task_assigned above, and a
          // guest-assignee received two notifications for the same task.
          .filter(id => id !== user?.uid && id !== assignedToUserId)
          .map(guestId =>
            notificationMutation.create({
              userId: guestId,
              type: 'guest_task_new',
              title: `➕ ${project.name}: detyrë e re`,
              message: `"${title}" u shtua në projekt.`,
              isRead: false,
              actionUrl: taskDeepLink((newTask as any).id, projectId),
              actionLabel: 'Shiko Detyrën',
            }).catch(err => console.error('[Notifications] guest_task_new dërgim dështoi:', err))
          )
      );
    }

    // "Krijo & shto tjetër" keeps the dialog open for batch entry.
    if (!opts?.createAnother) {
      setIsCreateTaskOpen(false);
      setSelectedTask(newTask);
    }
  };

  const handleAddComment = async (taskId: string, content: string, opts?: { visibleToClient?: boolean }) => {
    // Return the created doc — the panel needs its id to deep-link the notifications.
    // customerId is the client-visibility switch — stamped only on request.
    const customerId = opts?.visibleToClient ? (project as any)?.customerId : undefined;
    return commentMutation.create({
      taskId,
      content,
      ...(customerId ? { customerId, senderType: 'team' } : {}),
    } as any);
  };

  // Reply to the client in the project-level discussion. The client's notification
  // links back to this exact comment in the portal.
  const handleAddProjectComment = async (content: string) => {
    const text = content.trim();
    if (!text || !projectId) return;
    const created = await projectCommentMutation.create({
      projectId,
      content: text,
      userId: user?.uid || null,
      senderType: 'team',
      ...(project?.customerId ? { customerId: project.customerId } : {}),
    } as any);
    const uid = await resolvePortalUserId(project?.customerId);
    if (uid) {
      await notificationMutation.create({
        userId: uid,
        type: 'project_comment',
        title: `💬 Përgjigje nga ekipi — ${project?.name || 'Projekti'}`,
        message: text.slice(0, 120),
        isRead: false,
        actionUrl: portalProjectCommentDeepLink(projectId, (created as any)?.id),
        actionLabel: 'Shiko Komentin',
      }).catch(() => { /* non-blocking */ });
    }
  };

  const handleEditComment = async (commentId: string, content: string) => {
    await commentMutation.update(commentId, { content, edited: true });
  };

  const handleDeleteComment = async (commentId: string) => {
    await commentMutation.remove(commentId);
  };

  const handleToggleReaction = async (commentId: string, emoji: string) => {
    if (!user?.uid) return;
    const c = comments?.find((x: any) => x.id === commentId);
    const current: Record<string, string[]> = { ...((c as any)?.reactions || {}) };
    const arr = Array.isArray(current[emoji]) ? [...current[emoji]] : [];
    const i = arr.indexOf(user.uid);
    if (i >= 0) arr.splice(i, 1); else arr.push(user.uid);
    if (arr.length) current[emoji] = arr; else delete current[emoji];
    await commentMutation.update(commentId, { reactions: current } as any);
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
    // Guests cannot change task status or other fields
    if (isGuestOnProject) return;
    await taskMutation.update(taskId, data);

    // Notify guests when a task status changes
    if (data.status && project) {
      const guestIds: string[] = project.guestUserIds || [];
      const task = rawProjectTasks?.find(t => t.id === taskId);
      if (task && guestIds.length > 0) {
        const statusLabel: Record<string, string> = { 'Done': 'Përfunduar', 'In Progress': 'Në progres', 'Review': 'Rishikim', 'Todo': 'Për të bërë' };
        await Promise.all(
          guestIds
            .filter(id => id !== user?.uid)
            .map(guestId =>
              notificationMutation.create({
                userId: guestId,
                type: 'guest_task_update',
                title: `📋 ${project.name}: "${task.title}"`,
                message: `Statusi ndryshoi → ${statusLabel[data.status] ?? data.status}`,
                isRead: false,
                actionUrl: `/app/projects/${projectId}`,
                actionLabel: 'Shiko Projektin',
              }).catch(err => console.error('[Notifications] guest_task_update dërgim dështoi:', err))
            )
        );
      }
    }

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
      // Notify creator (skip if it's the same person who just updated)
      if (project.createdByUserId && project.createdByUserId !== user?.uid) {
        // .catch, never await-throw: the task and project are already written by
        // now — a failed notification must not surface as a failed status change.
        await notificationMutation.create({
          userId: project.createdByUserId,
          type: 'project_completed',
          title: `✅ Projekti "${project.name}" u mbyll automatikisht`,
          message: 'Të gjitha detyrat u shënuan si Përfunduar.',
          isRead: false,
          actionUrl: `/app/projects/${project.id}`,
          actionLabel: 'Shiko Projektin',
        }).catch(err => console.error('[Notifications] project_completed dërgim dështoi:', err));
      }
    }
  }, [taskMutation, project, rawProjectTasks, projectMutation, notificationMutation, user]);

  // ── Archive / restore ──
  // The reversible alternative to deleting: the project and everything hanging off
  // it stay in place, it just leaves the live list. Rules (remember the previous
  // status, stop a retainer) live in lib/projectArchive.ts so this page and
  // ProjectsView cannot drift apart.
  const archived = isProjectArchived(project);

  const handleArchiveToggle = React.useCallback(async () => {
    if (!project) return;
    const goingToArchive = !isProjectArchived(project);
    try {
      if (goingToArchive) {
        await projectMutation.update(project.id, archiveProjectPatch(project, {
          at: new Date(),
          byUserId: user?.uid ?? null,
        }) as any);
        toast({
          title: `"${project.name}" u arkivua`,
          description: project.isRecurring
            ? 'Faturimi i përsëritur ndaloi. E gjen te Projektet → Arkiva.'
            : 'E gjen te Projektet → Arkiva.',
        });
      } else {
        await projectMutation.update(project.id, restoreProjectPatch(project) as any);
        toast({
          title: `"${project.name}" u kthye nga arkiva`,
          description: project.wasRecurringBeforeArchive
            ? 'Faturimi i përsëritur u aktivizua përsëri.'
            : undefined,
        });
      }
    } catch (err) {
      console.error('[ProjectDetailView] arkivimi/kthimi dështoi:', err);
      toast({ title: goingToArchive ? 'Gabim gjatë arkivimit' : 'Gabim gjatë kthimit', variant: 'destructive' });
    }
  }, [project, projectMutation, toast, user]);

  // --- @dnd-kit drag-and-drop for kanban ---
  // Mouse drags on a small move; touch drags only after a 200ms hold so scrolling
  // the board on a phone isn't hijacked into a drag.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);

  const handleDragStart = (event: DragStartEvent) => {
    setActiveTaskId(String(event.active.id));
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveTaskId(null);
    // Guests are view+comment only. The guard used to live only inside
    // handleTaskUpdate (which silently no-ops), so a guest's drag-to-Done still
    // ran completeTask: the claim wrote `nextCycleCreated: true` (guests ARE
    // business members, rules accept it), the next cycle spawned, the status
    // write no-opped — a corrupted, still-open series plus false notifications.
    if (isGuestOnProject) return;
    const { active, over } = event;
    if (!over) return;
    const taskId = String(active.id);
    const overId = String(over.id);
    // Use allTasks (unfiltered) so drag works even when filters are active
    const allTasksFlat = allTasks || [];
    const targetStatus = columns.find(c => c.status === overId)?.status
      ?? columns.find(c => allTasksFlat.filter(t => t.status === c.status).some(t => t.id === overId))?.status;
    if (!targetStatus) return;
    const task = allTasksFlat.find(t => t.id === taskId);
    if (!task || task.status === targetStatus) return;

    // Completing via kanban drag goes through the shared completeTask() so the
    // dependency guard and "after completion" recurrence behave exactly as in
    // the list and detail panel.
    if (targetStatus === 'Done') {
      const outcome = await completeTask(task, {
        createTask: (data) => taskMutation.create(data as any),
        updateTask: (id, data) => handleTaskUpdate(id, data),
        allTasks: allTasksFlat,
        claimNextCycle: claimTaskNextCycle,
        releaseNextCycle: releaseTaskNextCycle,
      });
      if (outcome.kind === 'blocked') {
        toast({ title: '⛔ Detyrë e Bllokuar', description: `Ka ${outcome.blockers} varësi të pakryera para se ta mbyllësh këtë.`, variant: 'destructive' });
      } else if (outcome.kind === 'error') {
        console.error('[Recurring] krijimi i ciklit tjetër dështoi (drag):', outcome.error);
      }
      // Any non-blocked outcome closed the task — tell creator/assignee/collaborators.
      if (outcome.kind !== 'blocked' && user?.uid) {
        taskCompletedNotifications(task, user.uid, user.displayName || undefined).forEach(n =>
          notificationMutation.create(n as any).catch(err => console.error('[Notifications] task_completed dërgim dështoi:', err)));
      }
    } else {
      await handleTaskUpdate(taskId, { status: targetStatus });
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
    /* The app shell owns the ground colour and the page padding, so this view
       only claims its own max width. */
    <div className="pb-6">
      <div className="mx-auto max-w-[1140px]">

        {/* ── Header ── */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3.5">
            <button
              type="button"
              onClick={() => navigate('/app/projects')}
              className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[12.5px] font-bold text-brand-muted transition-colors hover:text-brand-navy"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Projektet
            </button>

            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[17px] font-extrabold text-white shadow-[0_4px_12px_rgba(8,24,58,.25)]"
              style={{ background: 'linear-gradient(135deg, #0c2456, #08183A)' }}
              aria-hidden="true"
            >
              {project.name?.trim()?.charAt(0)?.toUpperCase() || 'P'}
            </div>

            <div className="min-w-0">
              <div className="flex items-center gap-2.5">
                <h1 className="truncate text-[18px] font-extrabold tracking-[-0.01em] text-brand-navy">
                  {project.name}
                </h1>
                <Badge className={`${getStatusColor(project.status)} shrink-0 rounded-full text-[11px] font-extrabold`}>
                  {project.status}
                </Badge>
                {isGuestOnProject && (
                  <Badge className="shrink-0 gap-1 rounded-full border-0 bg-brand-warn-tint text-[11px] font-extrabold text-brand-warn-ink">
                    <Eye className="h-3 w-3" />
                    Guest
                  </Badge>
                )}
              </div>
              <p className="mt-0.5 truncate text-xs font-semibold text-brand-muted">
                {[customer?.name, team?.name].filter(Boolean).join(' · ') || 'Pa klient'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {projectMembers.length > 0 && (
              <div className="flex">
                {projectMembers.slice(0, 4).map((member, idx) => (
                  <div
                    key={member.id}
                    title={getName(member.userId)}
                    className={cn(
                      'flex h-8 w-8 items-center justify-center rounded-full border-2 border-background bg-brand-blue-tint text-[11px] font-extrabold text-brand-blue-hover',
                      idx > 0 && '-ml-2',
                    )}
                  >
                    {getInitials(member.userId)}
                  </div>
                ))}
                {projectMembers.length > 4 && (
                  <div className="-ml-2 flex h-8 w-8 items-center justify-center rounded-full border-2 border-background bg-brand-chip text-[11px] font-extrabold text-brand-chip-ink">
                    +{projectMembers.length - 4}
                  </div>
                )}
              </div>
            )}

            {!isGuestOnProject && (
              <button
                type="button"
                onClick={() => setIsSettingsOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-[#d7dfeb] bg-white px-4 py-2 text-[13px] font-bold text-brand-ink transition-colors hover:border-brand-blue hover:text-brand-blue"
              >
                <Settings className="h-3.5 w-3.5" />
                Cilësimet
              </button>
            )}

            {!isGuestOnProject && (
              <Dialog open={isCreateTaskOpen} onOpenChange={setIsCreateTaskOpen}>
                <DialogTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 rounded-xl bg-brand-blue px-4 py-2.5 text-[13px] font-bold text-white shadow-[0_4px_12px_rgba(47,111,224,.3)] transition-all hover:-translate-y-px hover:bg-brand-blue-hover"
                  >
                    <Plus className="h-4 w-4" />
                    Detyrë e re
                  </button>
                </DialogTrigger>
                <DialogContent className={QUICK_TASK_DIALOG_CLASS}>
                  <DialogTitle className="sr-only">Detyrë e re</DialogTitle>
                  {/* The same quick form as TasksView (design v3) — the project
                      is fixed to this one, so it renders as a locked pill. */}
                  <QuickTaskForm
                    onSubmit={(fd, opts) => handleCreateTask(fd, opts)}
                    projects={project ? [project] : []}
                    conflictTasks={capacityTasks || rawProjectTasks || []}
                    teamMembers={projectMembers.length > 0 ? projectMembers : (teamMembers || [])}
                    canAssignTasks={permissions.canAssignTasks}
                    currentUserId={user?.uid || ''}
                    allLabels={allLabels}
                    defaultProjectId={projectId}
                    lockProject
                  />
                </DialogContent>
              </Dialog>
            )}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" aria-label="Më shumë veprime">
                  <MoreVertical className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {permissions.canEdit && !isGuestOnProject && (
                  <DropdownMenuItem onClick={() => setIsGuestDialogOpen(true)}>
                    <UserPlus className="w-4 h-4 mr-2" />
                    Menaxho Guestët
                  </DropdownMenuItem>
                )}
                {permissions.canEdit && !isGuestOnProject && (
                  <DropdownMenuItem onClick={handleArchiveToggle}>
                    {archived ? (
                      <>
                        <ArchiveRestore className="w-4 h-4 mr-2" />
                        Kthe nga Arkiva
                      </>
                    ) : (
                      <>
                        <Archive className="w-4 h-4 mr-2" />
                        Arkivo Projektin
                      </>
                    )}
                  </DropdownMenuItem>
                )}
                {permissions.canEdit && !isGuestOnProject && (
                  <DropdownMenuItem
                    className="text-error"
                    onClick={() => setShowDeleteConfirm(true)}
                  >
                    <Trash2 className="w-4 h-4 mr-2" />
                    Fshi Projektin
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Archived projects stay fully usable — but nobody should read this page
            as the live state of the business without knowing it is on the shelf. */}
        {archived && (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-[#d7dfeb] bg-brand-chip px-4 py-3">
            <Archive className="h-4 w-4 shrink-0 text-brand-muted" />
            <p className="min-w-0 flex-1 text-[12.5px] font-semibold text-brand-ink">
              Ky projekt është në arkivë
              {project.archivedAt && ` (${new Date(project.archivedAt as any).toLocaleDateString('sq-AL')})`}
              {project.wasRecurringBeforeArchive && ' · faturimi i përsëritur është ndalur'}
            </p>
            {permissions.canEdit && !isGuestOnProject && (
              <button
                type="button"
                onClick={handleArchiveToggle}
                className="inline-flex items-center gap-1.5 rounded-xl border border-[#d7dfeb] bg-white px-3.5 py-1.5 text-[12.5px] font-bold text-brand-ink transition-colors hover:border-brand-blue hover:text-brand-blue"
              >
                <ArchiveRestore className="h-3.5 w-3.5" />
                Kthe nga arkiva
              </button>
            )}
          </div>
        )}

        {/* ── Hero (progress) + KPI band ── */}
        {/* Tablet gets hero-full-width + a 2×2 KPI block; desktop puts the KPIs
            in two columns beside the hero, which then spans both rows. */}
        <div className={cn(
          'mt-5 grid gap-4',
          showFinancials && 'sm:grid-cols-2 lg:grid-cols-[1.15fr_1fr_1fr]',
        )}>
          <div
            className={cn(
              'flex flex-col rounded-[20px] p-6 text-white shadow-[0_12px_32px_rgba(8,24,58,.28)] sm:p-7',
              showFinancials && 'sm:col-span-2 lg:col-span-1 lg:row-span-2',
            )}
            style={{ background: 'linear-gradient(150deg, #0d2a63 0%, #08183A 65%)' }}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-bold uppercase tracking-[.12em] text-[#93a9d1]">
                Progresi
              </span>
              {deadline && (
                <span className="shrink-0 rounded-full bg-white/[.08] px-3 py-1 text-[11.5px] font-bold text-[#93a9d1]">
                  {deadline.recurring ? 'Cikli tjetër: ' : 'Afati: '}
                  {deadline.date.toLocaleDateString('sq-AL', { day: 'numeric', month: 'short' })}
                </span>
              )}
            </div>

            <p className="mt-4 text-[44px] font-extrabold leading-none tracking-[-0.02em] tabular-nums">
              {progress}%
            </p>

            <div className="mt-3.5 h-2 overflow-hidden rounded-full bg-white/[.12]">
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{ width: `${progress}%`, background: 'linear-gradient(90deg, #2f6fe0, #6ea0f2)' }}
              />
            </div>
            <p className="mt-2.5 text-[12.5px] font-semibold text-[#93a9d1]">
              {completedTasks} nga {totalTasks} {totalTasks === 1 ? 'detyrë' : 'detyra'} të përfunduara
            </p>

            <div className="mt-auto flex flex-col gap-2.5 pt-6">
              <HeroRow
                label="Orë të regjistruara"
                value={totalHours < 1 ? `${Math.round(totalHours * 60)}m` : `${totalHours.toFixed(1)}h`}
              />
              <HeroRow
                label="Detyra me vonesë"
                value={String(overdueTaskCount)}
                tone={overdueTaskCount > 0 ? 'neg' : 'default'}
              />
              <HeroRow
                label="Komente pa përgjigje"
                value={String(unansweredClientComments)}
                tone={unansweredClientComments > 0 ? 'warn' : 'default'}
              />
            </div>
          </div>

          {/* Money is four tiles beside the hero — never a panel in the header. */}
          {showFinancials && (
            <>
              <KpiTile
                icon={<Wallet className="h-4 w-4" />}
                iconBg="bg-brand-blue-tint"
                iconInk="text-brand-blue-hover"
                dangerIconBg="bg-brand-neg-tint"
                dangerIconInk="text-brand-neg-ink"
                label="Buxheti i shpenzuar"
                value={budgetStats.budget > 0
                  ? formatCompactRange(budgetStats.spent, budgetStats.budget)
                  : formatCurrency(budgetStats.spent, 'ALL')}
                sub={budgetStats.budget > 0
                  ? `${budgetStats.pct}% e buxhetit${budgetStats.overBudget ? ' — tejkaluar!' : ''}`
                  : 'pa buxhet të caktuar'}
                danger={budgetStats.overBudget}
              />
              <KpiTile
                icon={<Receipt className="h-4 w-4" />}
                iconBg="bg-brand-pos-tint"
                iconInk="text-brand-pos"
                label="Faturuar"
                value={billingStats.comparable
                  ? formatCompactRange(billingStats.billed, billingStats.budget)
                  : formatCurrency(billingStats.billed, 'ALL')}
                sub={billingStats.invoiceCount === 0
                  ? 'asnjë faturë e lidhur'
                  : `${billingStats.issuedCount} të lëshuara${billingStats.draftCount ? ` · ${billingStats.draftCount} draft` : ''}`}
              />
              <KpiTile
                icon={<CheckCircle2 className="h-4 w-4" />}
                iconBg="bg-brand-pos-tint"
                iconInk="text-brand-pos"
                label="Arkëtuar"
                value={formatCurrency(billingStats.collected, 'ALL')}
                valueInk="text-brand-pos"
                sub={billingStats.billed > 0
                  ? `${Math.round((billingStats.collected / billingStats.billed) * 100)}% e të faturuarës`
                  : 'ende pa arkëtime'}
              />
              <KpiTile
                icon={<CircleDollarSign className="h-4 w-4" />}
                iconBg="bg-brand-pos-tint"
                iconInk="text-brand-pos"
                dangerIconBg="bg-brand-neg-tint"
                dangerIconInk="text-brand-neg-ink"
                label="Pa arkëtuar"
                value={formatCurrency(billingStats.outstanding, 'ALL')}
                sub={mostOverdueInvoice
                  ? `${mostOverdueInvoice.label} vonesë ${mostOverdueInvoice.days} ditë`
                  : billingStats.outstanding > 0 ? 'ende brenda afatit' : 'gjithçka e arkëtuar 👍'}
                danger={billingStats.outstanding > 0}
              />
            </>
          )}
        </div>

        {/* ── Tab bar + the filters that scope ONLY the task views ── */}
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as any)}>
            <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto rounded-[14px] bg-brand-chip p-1 sm:w-fit">
              <PillTab value="list" icon={<List className="h-3.5 w-3.5" />}>Lista</PillTab>
              <PillTab value="board" icon={<LayoutGrid className="h-3.5 w-3.5" />}>Bordi</PillTab>
              <PillTab value="calendar" icon={<CalendarIcon className="h-3.5 w-3.5" />}>Kalendar</PillTab>
              {showFinancials && (
                <PillTab value="finances" icon={<Receipt className="h-3.5 w-3.5" />}>Financat</PillTab>
              )}
              {hasBrief && (
                <PillTab value="brief" icon={<ClipboardList className="h-3.5 w-3.5" />} badge={briefMissingCount}>
                  Anketa
                </PillTab>
              )}
              <PillTab
                value="discussion"
                icon={<MessageSquare className="h-3.5 w-3.5" />}
                badge={unansweredClientComments}
              >
                Diskutimi
              </PillTab>
            </TabsList>
          </Tabs>

          <div className="flex flex-wrap items-center gap-2">
            {isGuestOnProject && (
              <Badge variant="outline" className="flex items-center gap-1 rounded-full border-brand-warn-line text-xs text-brand-warn-ink">
                <Eye className="w-3 h-3" />
                Vetëm shikimi + komente
              </Badge>
            )}
            {isTaskView && (
              <>
                <div className="relative min-w-[150px] flex-1 sm:flex-none">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-muted-2" />
                  <Input
                    placeholder="Kërko detyrë…"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="h-9 w-full rounded-xl border-[#d7dfeb] pl-9 text-sm font-semibold sm:w-48"
                  />
                </div>
                <Select value={filterStatus} onValueChange={setFilterStatus}>
                  <SelectTrigger className="h-9 w-full rounded-xl border-[#d7dfeb] text-xs font-bold sm:w-[135px]">
                    <Filter className="mr-1 h-3 w-3" />
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
                {/* Assignee filter — applies to list, board and calendar */}
                <Select value={filterAssignee} onValueChange={setFilterAssignee}>
                  <SelectTrigger className="h-9 w-full rounded-xl border-[#d7dfeb] text-xs font-bold sm:w-[180px]">
                    <Users className="mr-1 h-3 w-3" />
                    <SelectValue placeholder="Personi" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Të gjithë personat</SelectItem>
                    <SelectItem value="unassigned">Pa caktuar</SelectItem>
                    {projectMembers.map((m) => (
                      <SelectItem key={m.userId} value={m.userId}>
                        {getName(m.userId)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </>
            )}
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

      {/* Guest Management Dialog */}
      <Dialog open={isGuestDialogOpen} onOpenChange={setIsGuestDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="w-5 h-5 text-amber-600" />
              Menaxho Guestët
            </DialogTitle>
          </DialogHeader>
          <ProjectGuestForm
            key={isGuestDialogOpen ? 'open' : 'closed'}
            project={project}
            teamMembers={teamMembers || []}
            user={user}
            onSave={async (guestUserIds) => {
              // Capture before update so we can detect newly added guests
              const prevGuests: string[] = project.guestUserIds || [];
              const newGuests = guestUserIds.filter(id => !prevGuests.includes(id));
              await projectMutation.update(project.id, { guestUserIds });
              await Promise.all(
                newGuests.map(guestId =>
                  notificationMutation.create({
                    userId: guestId,
                    type: 'guest_project_invited',
                    title: `👋 U shtove si Guest: "${project.name}"`,
                    message: `Tani mund të shikosh dhe komentosh detyrat e këtij projekti.`,
                    isRead: false,
                    actionUrl: `/app/projects/${projectId}`,
                    actionLabel: 'Shiko Projektin',
                  }).catch(err => console.error('[Notifications] guest_invited dërgim dështoi:', err))
                )
              );
              setIsGuestDialogOpen(false);
            }}
          />
        </DialogContent>
      </Dialog>

        {/* ── Tab content ── */}
        <div className="mt-4">

          {/* Lista — one row per task, on one column ruler */}
          {viewMode === 'list' && (
            <div className={cn(CARD, 'overflow-hidden')}>
              {tasks.length === 0 ? (
                <div className="px-6 py-14 text-center">
                  <CheckSquare className="mx-auto mb-3 h-10 w-10 text-brand-muted-2" />
                  <p className="text-sm font-semibold text-brand-muted">Asnjë detyrë në këtë projekt</p>
                  {!isGuestOnProject && (
                    <button
                      type="button"
                      onClick={() => setIsCreateTaskOpen(true)}
                      className="mt-2 text-[13px] font-bold text-brand-blue hover:underline"
                    >
                      Krijo detyrën e parë
                    </button>
                  )}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <div className="min-w-[760px]">
                    <div className={cn(TASK_COLS, 'border-b border-brand-line-soft px-6 pb-2.5 pt-3.5 text-[11px] font-extrabold uppercase tracking-[.08em] text-brand-muted-2')}>
                      <span>Detyra</span>
                      <span>Statusi</span>
                      <span>Përgjegjësi</span>
                      <span>Afati</span>
                      <span className="text-right">Orë</span>
                    </div>

                    {/* Sorted by section so related tasks stay adjacent; each row
                        states its own section, which replaces the sticky group
                        headers the old list used. */}
                    {[...tasks]
                      .sort((a, b) => ((a as any).section || '~~~').localeCompare((b as any).section || '~~~'))
                      .map(task => {
                        const dateInfo = formatDateCompact(new Date(task.endDate));
                        const meta = TASK_STATUS_META[task.status] || TASK_STATUS_META['Todo'];
                        const done = task.status === 'Done';
                        const mins = hoursByTask.get(task.id);
                        return (
                          <div
                            key={task.id}
                            onClick={() => setSelectedTask(task)}
                            className={cn(
                              TASK_COLS,
                              'cursor-pointer border-b border-brand-line-softer px-6 py-3 transition-colors hover:bg-brand-surface',
                              selectedTask?.id === task.id && 'bg-brand-blue-tint/40',
                            )}
                          >
                            <div className="flex min-w-0 items-center gap-3">
                              <Checkbox
                                checked={done}
                                disabled={isGuestOnProject}
                                onCheckedChange={async (checked) => {
                                  if (isGuestOnProject) return;
                                  await handleTaskUpdate(task.id, { status: checked ? 'Done' : 'Todo' });
                                }}
                                onClick={(e) => e.stopPropagation()}
                                className={cn('shrink-0', done && 'border-brand-pos bg-brand-pos')}
                              />
                              <div className="min-w-0">
                                <p className={cn(
                                  'truncate text-[13.5px] font-bold text-brand-ink',
                                  done && 'text-brand-muted line-through',
                                )}>
                                  {task.title}
                                </p>
                                <p className="truncate text-[11.5px] font-semibold text-brand-muted-2">
                                  {(task as any).section || 'Pa seksion'}
                                </p>
                              </div>
                            </div>

                            <span className={cn(
                              'justify-self-start whitespace-nowrap rounded-full px-3 py-1 text-[11px] font-extrabold',
                              meta.pill,
                            )}>
                              {meta.label}
                            </span>

                            {task.assignedToUserId ? (
                              <div className="flex min-w-0 items-center gap-2">
                                <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-brand-blue-tint text-[10px] font-extrabold text-brand-blue-hover">
                                  {getInitials(task.assignedToUserId)}
                                </span>
                                <span className="truncate text-xs font-semibold text-brand-muted">
                                  {getName(task.assignedToUserId)}
                                </span>
                              </div>
                            ) : (
                              <span className="flex items-center gap-1 text-xs font-bold text-brand-warn-ink">
                                <Users className="h-3.5 w-3.5" />
                                Pa caktuar
                              </span>
                            )}

                            <span className={cn('whitespace-nowrap text-xs font-bold', done ? 'text-brand-muted-2' : dateInfo.className)}>
                              {dateInfo.text}
                            </span>

                            <span className={cn('text-right text-xs font-bold text-brand-muted', NUM)}>
                              {mins == null ? '—' : mins / 60 < 1 ? `${Math.round(mins)}m` : `${(mins / 60).toFixed(1)}h`}
                            </span>
                          </div>
                        );
                      })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Bordi */}
          {viewMode === 'board' && (
            <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
              <div className="flex items-start gap-3.5 overflow-x-auto pb-2 md:grid md:grid-cols-4 md:overflow-visible">
                {columns.map((column) => {
                  const columnTasks = tasks.filter(task => task.status === column.status);
                  return (
                    <ProjectKanbanColumn key={column.id} id={column.status}>
                      <div className="flex min-w-[262px] flex-col gap-2.5 rounded-2xl bg-brand-board p-3 md:min-w-0">
                        <div className="flex items-center justify-between px-1.5 py-0.5">
                          <span className="text-xs font-extrabold text-brand-navy">{column.title}</span>
                          <span className={cn('rounded-full bg-white px-2.5 py-0.5 text-[11px] font-extrabold text-brand-muted', NUM)}>
                            {columnTasks.length}
                          </span>
                        </div>

                        <SortableContext items={columnTasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
                          <div className="flex min-h-[60px] flex-col gap-2.5">
                            {columnTasks.map((task) => {
                              const prio = PRIORITY_META[(task as any).priority || 'medium'] || PRIORITY_META.medium;
                              return (
                                <ProjectSortableCard key={task.id} id={task.id}>
                                  <div
                                    onClick={() => setSelectedTask(task)}
                                    className={cn(
                                      'cursor-grab rounded-[13px] border border-brand-line bg-white px-3.5 py-3 shadow-[0_1px_3px_rgba(8,24,58,.06)] transition-all active:cursor-grabbing',
                                      'hover:-translate-y-px hover:shadow-[0_4px_12px_rgba(8,24,58,.12)]',
                                      selectedTask?.id === task.id && 'ring-2 ring-brand-blue',
                                    )}
                                  >
                                    <p className="text-[13px] font-bold leading-[1.35] text-brand-ink">{task.title}</p>
                                    <div className="mt-2.5 flex items-center justify-between gap-2">
                                      <span className={cn('rounded-full px-2.5 py-0.5 text-[10px] font-extrabold', prio.pill)}>
                                        {prio.label}
                                      </span>
                                      {task.assignedToUserId ? (
                                        <span
                                          title={getName(task.assignedToUserId)}
                                          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-blue-tint text-[9.5px] font-extrabold text-brand-blue-hover"
                                        >
                                          {getInitials(task.assignedToUserId)}
                                        </span>
                                      ) : (
                                        <Users className="h-3.5 w-3.5 text-brand-warn" />
                                      )}
                                    </div>
                                  </div>
                                </ProjectSortableCard>
                              );
                            })}
                          </div>
                        </SortableContext>
                      </div>
                    </ProjectKanbanColumn>
                  );
                })}
              </div>
              <DragOverlay>
                {activeTaskId ? (
                  <div className="rotate-2 rounded-[13px] border border-brand-line bg-white px-3.5 py-3 opacity-90 shadow-xl">
                    <p className="text-[13px] font-bold text-brand-ink">{tasks.find(t => t.id === activeTaskId)?.title}</p>
                  </div>
                ) : null}
              </DragOverlay>
            </DndContext>
          )}

          {/* Kalendar */}
          {viewMode === 'calendar' && (
            <div className={cn(CARD, 'overflow-hidden')}>
              <ProjectCalendarView tasks={tasks} onTaskClick={setSelectedTask} />
            </div>
          )}

          {/* Financat — the budget and the billing panel that used to crowd the header */}
          {viewMode === 'finances' && showFinancials && (
            <div className="grid gap-4 lg:grid-cols-2">
              <section className={cn(CARD, 'px-6 py-5', budgetStats.overBudget && 'border-brand-neg-line')}>
                <div className="flex items-baseline justify-between gap-2.5">
                  <h2 className="text-[15px] font-extrabold text-brand-navy">Buxheti</h2>
                  <span className={cn('text-[12.5px] font-bold', NUM, budgetStats.overBudget ? 'text-brand-neg-ink' : 'text-brand-ink')}>
                    {formatCurrency(budgetStats.spent, 'ALL')}
                    {budgetStats.budget > 0 && ` / ${formatCurrency(budgetStats.budget, 'ALL')} (${budgetStats.pct}%)`}
                  </span>
                </div>

                {budgetStats.budget > 0 && (
                  <div className="mt-3.5 h-2 overflow-hidden rounded-full bg-brand-line-soft">
                    <div
                      className={cn(
                        'h-full rounded-full transition-all',
                        budgetStats.overBudget ? 'bg-brand-neg' : budgetStats.pct >= 80 ? 'bg-brand-warn' : 'bg-brand-blue',
                      )}
                      style={{ width: `${Math.min(100, budgetStats.pct)}%` }}
                    />
                  </div>
                )}

                <div className="mt-4 flex flex-col gap-2.5">
                  <MoneyRow label="Punë (orë × kosto)" value={budgetStats.laborCost} />
                  <MoneyRow label="Shpenzime" value={budgetStats.expensesTotal} />
                  {budgetStats.billableValue > 0 && (
                    <MoneyRow label="Vlerë e faturueshme" value={budgetStats.billableValue} />
                  )}
                  {budgetStats.valuedTaskCount > 0 && (
                    <MoneyRow
                      label={`Vlera e detyrave (${budgetStats.valuedTaskCount})`}
                      value={budgetStats.taskValueTotal}
                      hint={`kryer ${formatCurrency(budgetStats.taskValueDone, 'ALL')}`}
                    />
                  )}
                  <MoneyRow
                    label="Marzhi"
                    value={budgetStats.margin}
                    tone={budgetStats.margin < 0 ? 'neg' : 'pos'}
                  />
                </div>

                {budgetStats.overBudget && (
                  <p className="mt-3.5 rounded-xl border border-brand-neg-line bg-brand-neg-tint px-3.5 py-2.5 text-[12.5px] font-bold leading-relaxed text-brand-neg-ink">
                    ⚠ Projekti ka kaluar buxhetin me {formatCurrency(budgetStats.spent - budgetStats.budget, 'ALL')}.
                  </p>
                )}
              </section>

              <section className={cn(CARD, 'px-6 py-5')}>
                <div className="flex items-baseline justify-between gap-2.5">
                  <h2 className="text-[15px] font-extrabold text-brand-navy">Faturimi</h2>
                  <button
                    type="button"
                    onClick={() => navigate(`/app/invoices?project=${projectId}`)}
                    className="text-[12.5px] font-bold text-brand-blue hover:underline"
                  >
                    Hap faturat →
                  </button>
                </div>

                {billingStats.comparable && (
                  <>
                    <div className="mt-3.5 h-2 overflow-hidden rounded-full bg-brand-line-soft">
                      <div
                        className={cn(
                          'h-full rounded-full transition-all',
                          billingStats.overBilled ? 'bg-brand-neg' : billingStats.pct >= 100 ? 'bg-brand-pos' : 'bg-brand-blue',
                        )}
                        style={{ width: `${Math.min(100, billingStats.pct)}%` }}
                      />
                    </div>
                    <p className="mt-2 text-xs font-bold text-brand-muted">
                      Faturuar ndaj tarifës:{' '}
                      <span className={cn(NUM, billingStats.overBilled ? 'text-brand-neg-ink' : billingStats.underBilled ? 'text-brand-warn-ink' : 'text-brand-pos')}>
                        {formatCurrency(billingStats.billed, 'ALL')} / {formatCurrency(billingStats.budget, 'ALL')} ({billingStats.pct}%)
                      </span>
                    </p>
                  </>
                )}

                <div className="mt-4 flex flex-col gap-2.5">
                  <MoneyRow label="Faturuar" value={billingStats.billed} />
                  <MoneyRow label="Arkëtuar" value={billingStats.collected} tone="pos" />
                  {billingStats.outstanding > 0 && (
                    <MoneyRow label="Pa arkëtuar" value={billingStats.outstanding} tone="warn" />
                  )}
                  {billingStats.draftValue > 0 && (
                    <MoneyRow label="Draft (pa lëshuar)" value={billingStats.draftValue} />
                  )}
                </div>

                {billingStats.invoiceCount > 0 && (
                  <div className="mt-4 flex flex-col gap-2">
                    {(projectInvoices || [])
                      .slice()
                      .sort((a, b) => new Date(b.createdAt as any).getTime() - new Date(a.createdAt as any).getTime())
                      .slice(0, 6)
                      .map(inv => (
                        <button
                          key={inv.id}
                          type="button"
                          onClick={() => navigate(`/app/invoices?project=${projectId}`)}
                          className="flex items-center justify-between gap-3 rounded-xl border border-brand-line-soft px-3.5 py-2.5 text-left transition-all hover:border-brand-blue hover:bg-brand-surface"
                        >
                          <span className={cn('truncate text-xs font-bold text-brand-ink', NUM)}>
                            {inv.invoiceNumber || inv.id.slice(0, 8)}
                          </span>
                          <span className="flex shrink-0 items-center gap-2.5">
                            <span className={cn('rounded-full px-2.5 py-0.5 text-[10.5px] font-extrabold', INVOICE_PILL[inv.status] || INVOICE_PILL.default)}>
                              {getInvoiceStatusLabel(inv.status)}
                            </span>
                            <span className={cn('text-xs font-bold text-brand-ink', NUM)}>
                              {formatCurrency(getInvoiceTotalAll(inv), 'ALL')}
                            </span>
                          </span>
                        </button>
                      ))}
                    {billingStats.invoiceCount > 6 && (
                      <p className="px-1 text-[11px] font-semibold text-brand-muted">
                        +{billingStats.invoiceCount - 6} të tjera
                      </p>
                    )}
                  </div>
                )}

                {billingStats.overBilled && (
                  <p className="mt-3.5 rounded-xl border border-brand-neg-line bg-brand-neg-tint px-3.5 py-2.5 text-[12.5px] font-bold leading-relaxed text-brand-neg-ink">
                    ⚠ Klienti është faturuar {formatCurrency(billingStats.diff, 'ALL')} më shumë sesa tarifa e projektit.
                  </p>
                )}
                {billingStats.underBilled && (
                  <p className="mt-3.5 rounded-xl border border-brand-warn-line bg-brand-warn-tint px-3.5 py-2.5 text-[12.5px] font-bold leading-relaxed text-brand-warn-ink">
                    ⚠ Mbeten {formatCurrency(-billingStats.diff, 'ALL')} pa faturuar nga tarifa e projektit.
                  </p>
                )}
                {billingStats.budget > 0 && billingStats.invoiceCount === 0 && (
                  <p className="mt-3.5 rounded-xl border border-brand-warn-line bg-brand-warn-tint px-3.5 py-2.5 text-[12.5px] font-bold leading-relaxed text-brand-warn-ink">
                    ⚠ Projekti ka tarifë {formatCurrency(billingStats.budget, 'ALL')} por asnjë faturë të lidhur.
                  </p>
                )}
                {!billingStats.comparable && billingStats.budget > 0 && billingStats.invoiceCount > 0 && (
                  <p className="mt-3.5 text-[11.5px] leading-relaxed text-brand-muted">
                    Tarifë periodike ({formatCurrency(billingStats.budget, 'ALL')}/cikël) — totali i faturuar rritet me çdo
                    cikël, ndaj nuk krahasohet me një vlerë të vetme.
                  </p>
                )}
              </section>
            </div>
          )}

          {/* Anketa e klientit */}
          {viewMode === 'brief' && inquiry && <ProjectClientBrief inquiry={inquiry} />}

          {/* Diskutimi me klientin */}
          {viewMode === 'discussion' && (
            <ProjectClientDiscussion
              comments={projectComments}
              currentUserId={user?.uid}
              getName={getName}
              getInitials={getInitials}
              focusCommentId={focusProjectCommentId}
              onSend={handleAddProjectComment}
              canReply={!isGuestOnProject}
            />
          )}
        </div>
      </div>

      {/* Task detail — a right-hand drawer on desktop (the page stays visible
          behind), a bottom sheet on mobile. */}
      {selectedTask && (
        <div
          className="fixed inset-0 z-50 flex flex-col justify-end bg-brand-navy/20 lg:flex-row lg:justify-end"
          onClick={() => { setSelectedTask(null); setFocusComment(null); }}
        >
          <div
            className="flex h-[88dvh] w-full flex-col overflow-hidden rounded-t-[22px] bg-background shadow-2xl lg:h-full lg:w-[620px] lg:rounded-none lg:border-l"
            onClick={(e) => e.stopPropagation()}
          >
            <TaskDetailPanel
              key={selectedTask.id}
              task={selectedTask}
              onClose={() => { setSelectedTask(null); setFocusComment(null); }}
              comments={comments?.filter(c => c.taskId === selectedTask.id) || []}
              onAddComment={handleAddComment}
              focusCommentId={focusComment?.taskId === selectedTask.id ? focusComment.commentId : null}
              onEditComment={handleEditComment}
              onDeleteComment={handleDeleteComment}
              onToggleReaction={handleToggleReaction}
              onUpdate={handleTaskUpdate}
              onDelete={(id) => deleteTaskCascade(id).catch(err => {
                console.error('[Tasks] fshirja dështoi:', err);
                toast({ title: 'Detyra nuk u fshi', description: err?.message, variant: 'destructive' });
              })}
              projects={project ? [project] : undefined}
              onSelectSubtask={(subtask) => setSelectedTask(subtask)}
              isProjectGuest={isGuestOnProject}
            />
          </div>
        </div>
      )}

      {/* Delete Project Confirmation */}
      <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Fshi Projektin</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Jeni i sigurt që dëshironi të fshini këtë projekt? Ky veprim nuk mund të zhbëhet.</p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" disabled={deletingProject} onClick={() => setShowDeleteConfirm(false)}>Anulo</Button>
            <Button
              variant="destructive"
              disabled={deletingProject}
              onClick={async () => {
                if (!projectId) return;
                setDeletingProject(true);
                try {
                  // Same cascade as ProjectsView (src/lib/deleteCascade.ts): a
                  // bare remove() left every task, comment and draft invoice
                  // dangling on a project id that no longer exists.
                  const summary = await deleteProjectCascade({ id: projectId, name: project?.name || '' });
                  const parts = projectCascadeToastParts(summary);
                  toast({ title: `Projekti u fshi`, description: parts.length ? parts.join(' · ') : undefined });
                  navigate('/app/projects');
                } catch {
                  setDeletingProject(false);
                  setShowDeleteConfirm(false);
                  toast({ title: 'Gabim', description: 'Projekti nuk u fshi. Provo sërish.', variant: 'destructive' });
                }
              }}
            >
              {deletingProject ? 'Duke fshirë...' : 'Fshi'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

/**
 * Project-level discussion with the client.
 *
 * The portal has always let a client comment on the project, and staff got a
 * notification for it — but there was no staff-side view, so the notification led
 * to a page that didn't contain the comment. This is that view, and it is also the
 * landing spot for the `?projectComment=<id>` deep link.
 */
const ProjectClientDiscussion: React.FC<{
  comments: any[];
  currentUserId?: string;
  getName: (userId: string) => string;
  getInitials: (userId: string) => string;
  focusCommentId?: string | null;
  onSend: (content: string) => Promise<void>;
  canReply: boolean;
}> = ({ comments, currentUserId, getName, getInitials, focusCommentId, onSend, canReply }) => {
  const { registerComment, isFlashing } = useCommentFocus(focusCommentId);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      await onSend(body);
      setText('');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className={cn(CARD, 'max-w-[760px] px-6 py-5')}>
      <h2 className="text-[15px] font-extrabold text-brand-navy">Diskutimi me klientin</h2>
      <p className="mt-0.5 text-[12.5px] text-brand-muted">Klienti i sheh këto mesazhe në portalin e tij.</p>

      {comments.length === 0 ? (
        <p className="mt-5 rounded-xl border border-dashed border-brand-line px-4 py-6 text-center text-[13px] text-brand-muted">
          Ende pa mesazhe. Shkruaj i pari — klienti e merr njoftimin në portal.
        </p>
      ) : (
        <div className="mt-5 flex flex-col gap-3.5">
          {comments.map(c => {
            const fromClient = c.senderType === 'client';
            const authorName = fromClient ? 'Klienti' : (c.userId === currentUserId ? 'Ti' : getName(c.userId));
            const at = c.createdAt instanceof Date ? c.createdAt : c.createdAt?.toDate?.();
            return (
              <div
                key={c.id}
                ref={registerComment(c.id)}
                className={cn(
                  'flex scroll-mt-24 gap-2.5 rounded-lg',
                  fromClient ? 'flex-row' : 'flex-row-reverse',
                  isFlashing(c.id) && COMMENT_FLASH_CLASS,
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full text-[10.5px] font-extrabold',
                    fromClient ? 'bg-brand-warn-tint text-brand-warn-ink' : 'bg-brand-navy text-white',
                  )}
                >
                  {fromClient ? 'KL' : (c.userId ? getInitials(c.userId) : 'EK')}
                </span>
                <div className="max-w-[78%]">
                  <div className={cn(
                    'rounded-[14px] px-4 py-3 text-[13px] font-semibold leading-[1.45]',
                    fromClient ? 'bg-[#f2f5f9] text-brand-ink' : 'bg-brand-navy-mid text-white',
                  )}>
                    <p className="whitespace-pre-line break-words">{c.content}</p>
                  </div>
                  <p className={cn(
                    'mt-1 text-[11px] font-semibold text-brand-muted-2',
                    fromClient ? 'text-left' : 'text-right',
                  )}>
                    {authorName}
                    {at && ` · ${at.toLocaleDateString('sq-AL', { day: '2-digit', month: 'short' })} ${at.toLocaleTimeString('sq-AL', { hour: '2-digit', minute: '2-digit' })}`}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {canReply && (
        <div className="mt-5 flex items-end gap-2.5">
          <Textarea
            value={text}
            onChange={e => setText(e.target.value)}
            rows={2}
            placeholder="Shkruaj një përgjigje…"
            className="min-h-[46px] resize-none rounded-xl border-[#d7dfeb] bg-brand-surface text-base font-semibold focus-visible:bg-white sm:text-sm"
            onKeyDown={e => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); void send(); }
            }}
          />
          <button
            type="button"
            onClick={send}
            disabled={!text.trim() || sending}
            className="shrink-0 rounded-xl bg-brand-blue px-5 py-2.5 text-[13px] font-bold text-white transition-colors hover:bg-brand-blue-hover disabled:opacity-50"
          >
            {sending ? 'Duke dërguar…' : 'Dërgo'}
          </button>
        </div>
      )}
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

// Guest Management Form Component
const ProjectGuestForm: React.FC<{
  project: Project;
  teamMembers: import('../types').TeamMember[];
  user: import('firebase/auth').User | null;
  onSave: (guestUserIds: string[]) => Promise<void>;
}> = ({ project, teamMembers, user, onSave }) => {
  const { getName } = useUserNames(teamMembers);
  const currentGuestIds: string[] = project.guestUserIds || [];
  const [selected, setSelected] = useState<string[]>(currentGuestIds);
  const [saving, setSaving] = useState(false);

  // Only users with role='Guest' can be project guests — admins/managers already have full access
  const eligibleMembers = teamMembers.filter(m => {
    if (m.userId === user?.uid) return false;
    return m.role === 'Guest';
  });

  const toggle = (userId: string) => {
    setSelected(prev =>
      prev.includes(userId) ? prev.filter(id => id !== userId) : [...prev, userId]
    );
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(selected);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Zgjidhni anëtarët që do të kenë akses vetëm-lexim + komente në këtë projekt.
      </p>
      {eligibleMembers.length === 0 ? (
        <p className="text-sm text-center text-muted-foreground py-4">Nuk ka anëtarë të tjerë.</p>
      ) : (
        <div className="space-y-1 max-h-64 overflow-y-auto border rounded-md p-2">
          {eligibleMembers.map(m => {
            const isGuest = selected.includes(m.userId);
            return (
              <label key={m.id} className="flex items-center gap-3 cursor-pointer hover:bg-muted/50 px-2 py-1.5 rounded">
                <input
                  type="checkbox"
                  className="w-4 h-4 accent-amber-500"
                  checked={isGuest}
                  onChange={() => toggle(m.userId)}
                />
                <div className="flex items-center gap-2 flex-1">
                  <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center text-xs font-semibold text-amber-700">
                    {getName(m.userId).charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="text-sm font-medium">{getName(m.userId)}</p>
                    <p className="text-xs text-muted-foreground">{m.role}</p>
                  </div>
                </div>
                {isGuest && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-medium">Guest</span>
                )}
              </label>
            );
          })}
        </div>
      )}
      {selected.length > 0 && (
        <p className="text-xs text-amber-600 mt-1">{selected.length} guest{selected.length !== 1 ? 'ë' : ''} të zgjedhur</p>
      )}
      <Button className="w-full" onClick={handleSave} disabled={saving}>
        {saving ? 'Duke ruajtur...' : 'Ruaj Guestët'}
      </Button>
    </div>
  );
};

// Calendar View
const ProjectCalendarView: React.FC<{
  tasks: Task[];
  onTaskClick: (task: Task) => void;
}> = ({ tasks, onTaskClick }) => {
  const [currentDate, setCurrentDate] = useState(new Date());

  const daysInMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0).getDate();
  // Monday-first (matches the Tasks calendar and Albanian convention).
  const firstDay = (new Date(currentDate.getFullYear(), currentDate.getMonth(), 1).getDay() + 6) % 7;

  const sod = (x: Date) => { const n = new Date(x); n.setHours(0, 0, 0, 0); return n.getTime(); };
  const monthStart = sod(new Date(currentDate.getFullYear(), currentDate.getMonth(), 1));
  const monthEnd = sod(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0));
  // Project future recurring occurrences (which materialise only on completion) so
  // they're visible on the calendar ahead of time — see TasksView for the rationale.
  const projectionsByDay = React.useMemo(() => {
    const map = new Map<number, Task[]>();
    tasks.forEach((task) => {
      const t = task as any;
      if (!t.isRecurring || !t.recurringFrequency || t.nextCycleCreated === true || task.status === 'Done' || !task.endDate) return;
      const recEnd = t.recurringEndDate ? sod(new Date(t.recurringEndDate)) : null;
      let d = new Date(task.endDate);
      let guard = 0;
      while (guard++ < 500) {
        d = addFrequency(d, t.recurringFrequency, t.recurringDayOfWeek, t.recurringDayOfMonth, t.recurringInterval, t.recurringDaysOfWeek);
        const ds = sod(d);
        if (ds > monthEnd) break;
        if (recEnd && ds > recEnd) break; // stop at the "repeat until" date
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
    days.push(<div key={`empty-${i}`} className="min-h-[56px] sm:min-h-[80px] bg-muted/20" />);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(currentDate.getFullYear(), currentDate.getMonth(), day);
    const dayTasks = tasks.filter(task => {
      const taskDate = new Date(task.endDate);
      return taskDate.toDateString() === date.toDateString();
    });
    const dayProjections = projectionsByDay.get(day) || [];
    const realShown = dayTasks.slice(0, 2);
    const projShown = dayProjections.slice(0, Math.max(0, 2 - realShown.length));
    const overflow = (dayTasks.length + dayProjections.length) - realShown.length - projShown.length;

    days.push(
      <div key={day} className="min-h-[56px] sm:min-h-[80px] border border-border p-1 bg-background">
        <div className="font-medium text-xs mb-1 text-muted-foreground">{day}</div>
        <div className="space-y-1">
          {realShown.map(task => (
            <div
              key={task.id}
              className="text-xs p-1 bg-primary/10 rounded cursor-pointer hover:bg-primary/20 truncate"
              onClick={() => onTaskClick(task)}
            >
              {task.title}
            </div>
          ))}
          {projShown.map((task, i) => (
            <div
              key={`proj-${task.id}-${i}`}
              className="text-xs p-1 rounded cursor-pointer truncate border border-dashed border-primary/30 text-primary dark:text-primary dark:border-primary/30 bg-accent-soft dark:bg-primary/10 hover:bg-accent dark:hover:bg-primary/20 italic"
              title={`Përsëritet — ${task.title}`}
              onClick={() => onTaskClick(task)}
            >
              🔄 {task.title}
            </div>
          ))}
          {overflow > 0 && (
            <div className="text-xs text-muted-foreground">+{overflow} më shumë</div>
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
        {['Hën', 'Mar', 'Mër', 'Enj', 'Pre', 'Sht', 'Diel'].map(day => (
          <div key={day} className="bg-muted p-1 text-center text-[10px] sm:text-xs font-medium">
            <span className="sm:hidden">{day.slice(0, 2)}</span>
            <span className="hidden sm:inline">{day}</span>
          </div>
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
