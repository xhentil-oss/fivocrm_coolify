import React, { useState, useMemo } from 'react';
import { useToast } from '../hooks/use-toast';
import { useNavigate } from 'react-router-dom';
import { useCollection, useMutation, useGlobalBusinessId, getGlobalTeamId } from '../hooks/useFirestore';
import { getNextInvoiceNumber, db } from '../lib/firebase';
import { doc, runTransaction, Timestamp } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../contexts/PermissionsContext';
import { canSeeFinancials, toAll, fromAll, currencySymbol, getRateToAll } from '../lib/utils';
import { projectBillingPeriodKey, projectBillingPeriodEnd, projectBillingAnchor, stopProjectBillingPatch, pauseProjectBillingPatch, projectBillingBlockLabel } from '../lib/finance/recurringBilling';
import { billingDueDate, billingPeriodStart, isAnchoredFrequency, reexpressBillingClaim, workCycleBlockLabel } from '../lib/finance/projectCycles';
import {
  cycleBudgetFromForm, cycleMonthsFor, defaultAnchorMonth, initialMonthlyFee, initialWorkCycle,
  parseAnchorMonthInput, parseDueDaysInput, parseMoneyInput, parsePctInput, parseWorkCycleInput,
} from '../lib/finance/projectBillingForm';
import { recurringOccurrenceId } from '../lib/finance/recurringInvoices';
import { normalizePlannedRoles, plannedFieldsPatch } from '../lib/finance/projectBudget';
import { buildRateCard } from '../lib/finance/costRates';
import { resolveFinanceSettings } from '../lib/finance/profitabilityCore';
import { projectInvoiceLines } from '../lib/finance/projectInvoiceLines';
import { cleanServiceMixInput, projectServiceMix, labelerFor } from '../lib/finance/serviceMix';
import { servicesTotalIn, serviceBudgetOverride, updateIdListValue } from '../lib/projectFormServices';
import { monthlyFeeOf } from '../lib/finance/projectPeriod';
import { updateValue } from '../lib/formValue';
import { useTeamSettingsData } from '../hooks/useTeamSettings';
import { useMemberCompensation } from '../hooks/useMemberCompensation';
import PlannedRolesEditor from '../components/projects/PlannedRolesEditor';
import {
  archiveConsequences,
  archiveProjectPatch,
  isProjectArchived,
  isTerminalProjectStatus,
  restoreProjectPatch,
  resumeRecurringBillingPatch,
  resumedBillingClaimPatch,
  resumeBillingToastLine,
} from '../lib/projectArchive';
import { deleteProjectCascade, projectCascadeToastParts } from '../lib/deleteCascade';
import { projectTaskProgress } from '../lib/projectProgress';
import { isOverdueDate } from '../lib/taskDue';
import { projectNextDeadlines, sortProjectsByDeadline } from '../lib/projectSort';
import {
  Search,
  Plus,
  List,
  Users,
  ChevronDown,
  Folder,
  Trash2,
  Edit,
  RefreshCw,
  Archive,
  ArchiveRestore,
  X,
} from 'lucide-react';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover';
import { Checkbox } from '../components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import { useActivityLogger } from '../hooks/useActivityLogger';
import { useFilteredProjects, useUniqueTeamMembers } from '../hooks/useRoleFilteredData';
import { useUserNames } from '../hooks/useUserNames';
import type { Project, Task, Team, TeamMember, Customer, Invoice, Service, InvoiceItem } from '../types';

/** Thrown inside the occurrence transaction when the period is already invoiced. */
const OCCURRENCE_EXISTS = '__invoice_occurrence_exists__';

/**
 * Write a retainer's FIRST invoice at the deterministic occurrence id, failing
 * (instead of overwriting) when that period is already invoiced.
 *
 * Why not `invoiceMutation.create(data, id)`: that path is a blind `setDoc`, and a
 * blind set at a deterministic id is worse than a random one — it would silently
 * rewrite an occurrence the cron had already issued (and possibly emailed, or that
 * the client had already paid).
 *
 * Why the id at all: the cron writes this same period's invoice at
 * `auto_<projectId>_<periodKey>` with `ref.create()` (api/cron/run.ts, Part 2). As
 * long as the UI used a random id the two could not collide, so the ONLY thing
 * stopping a second invoice for the period was the separate claim write below — a
 * rules denial, a closed tab or a dropped connection after the invoice and before
 * the claim meant the next hourly run billed the same period again AND emailed it
 * to the client. With the key in the id the database refuses the duplicate:
 * "the occurrence's document id IS the idempotency guarantee" (CLAUDE.md).
 *
 * The web SDK has no `create()`, so the transaction is the atomic equivalent:
 * read-then-set inside one transaction aborts if anything wrote the id meanwhile.
 * Returns true when this call created the invoice, false when it already existed.
 */
async function createInvoiceOccurrence(
  occurrenceId: string,
  data: Record<string, unknown>,
  scope: { teamId?: string; businessId?: string; createdByUserId?: string | null },
): Promise<boolean> {
  const ref = doc(db, 'invoices', occurrenceId);
  // The mutation layer stamps these for us; writing directly means doing it here.
  // `businessId` is not cosmetic — `canCreateBusinessDoc()` in firestore.rules
  // refuses a create without the caller's own tenant id.
  const payload: Record<string, unknown> = {
    ...data,
    teamId: scope.teamId,
    businessId: scope.businessId,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    createdByUserId: scope.createdByUserId ?? null,
  };
  // The SDK rejects `undefined` values outright — same reason the write layer runs
  // removeUndefined() on every document.
  for (const key of Object.keys(payload)) {
    if (payload[key] === undefined) delete payload[key];
  }
  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists()) throw new Error(OCCURRENCE_EXISTS);
      tx.set(ref, payload);
    });
    return true;
  } catch (err) {
    if (err instanceof Error && err.message === OCCURRENCE_EXISTS) return false;
    throw err;
  }
}

// "Kontrolli i fundit" — the cron stamps `billingLastBlock` + `billingLastCheckedAt`
// on every recurring project it evaluates (api/cron/run.ts, recurring-invoices
// Part 2). Shown read-only, in the row tooltip here and in the Faturimi panel of
// ProjectDetailView; the labels live next to the engine (recurringBilling.ts).
function billingCheckTooltip(project: Project): string {
  const raw: any = (project as any).billingLastCheckedAt;
  const at: Date | null = raw ? (raw?.toDate ? raw.toDate() : new Date(raw)) : null;
  const reason = (project as any).billingLastBlock as string | null | undefined;
  if (!at || isNaN(at.getTime())) return 'Faturim periodik — ende pa kontroll nga kroni';
  return `Kontrolli i fundit: ${at.toLocaleDateString('sq-AL')} — ${projectBillingBlockLabel(reason, project)}`;
}

const ProjectsView: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const permissions = usePermissions();
  // Admin/Manager: the only roles the rules let write a project's money,
  // billing, bank and staffing-plan keys (projectFinanceKeys in firestore.rules).
  const canManageProjectFinance = canSeeFinancials(permissions);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<{ id: string; name: string } | null>(null);
  const [projectToEdit, setProjectToEdit] = useState<Project | null>(null);
  const [projectToArchive, setProjectToArchive] = useState<Project | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Filters
  const [filterOwner, setFilterOwner] = useState<string>('all');
  const [filterTeam, setFilterTeam] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterMembers, setFilterMembers] = useState<string[]>([]);
  // Show only projects that bill/repeat every month (recurring monthly retainers).
  const [filterMonthly, setFilterMonthly] = useState(false);
  // The archive is a separate shelf, not a status you scroll past: the list shows
  // live projects, and archived ones only when this is on.
  const [showArchive, setShowArchive] = useState(false);

  // Firebase hooks
  const { data: rawProjects, loading: projectsLoading } = useCollection<Project>('projects', {
    orderBy: { field: 'updatedAt', direction: 'desc' },
    skipTeamFilter: true,
  });
  const { data: allTasks } = useCollection<Task>('tasks');
  // Role-based filtering: Member/Viewer see only projects they're involved in
  const projects = useFilteredProjects(rawProjects, allTasks);
  // Portfolio health (Monday-style): per-project progress + RAG, and aggregate.
  const projectHealth = useMemo(() => {
    const map = new Map<string, { total: number; done: number; overdue: number; pct: number; health: 'on' | 'risk' | 'off' }>();
    const now = Date.now();
    // Archived AND cancelled projects are out of the portfolio: their leftover
    // overdue tasks must not keep the "në rrezik" counter red forever (Cancelled
    // used to slip through and colour the portfolio red exactly like the
    // pre-archive bug this comment describes).
    (projects || []).filter(p => !isProjectArchived(p) && p.status !== 'Cancelled').forEach(p => {
      // Shared progress definition (src/lib/projectProgress.ts): top-level tasks
      // only, same as ProjectDetailView — the two used to disagree.
      const { total, done, overdue, pct } = projectTaskProgress(allTasks, p.id, now);
      const health: 'on' | 'risk' | 'off' = (overdue >= 3 || (total > 0 && overdue / total > 0.3)) ? 'off' : overdue > 0 ? 'risk' : 'on';
      map.set(p.id, { total, done, overdue, pct, health });
    });
    return map;
  }, [projects, allTasks]);
  const portfolio = useMemo(() => {
    let total = 0, done = 0, overdue = 0, atRisk = 0;
    projectHealth.forEach(h => { total += h.total; done += h.done; overdue += h.overdue; if (h.health !== 'on') atRisk++; });
    // projectHealth already excludes the archive, so its size is the live count.
    return { activeProjects: projectHealth.size, avgPct: total ? Math.round((done / total) * 100) : 0, overdue, atRisk };
  }, [projectHealth]);
  const archivedCount = useMemo(
    () => (projects || []).filter(p => isProjectArchived(p)).length,
    [projects]
  );
  const { data: teams } = useCollection<Team>('teams');
  const { data: rawTeamMembers } = useCollection<TeamMember>('teamMembers', {
    where: [{ field: 'status', operator: '==', value: 'Active' }]
  });
  const teamMembers = useUniqueTeamMembers(rawTeamMembers);
  // Defence in depth: reads are already business-scoped, but the member/responsible
  // pickers re-check businessId so no foreign person can reach the form.
  const activeBusinessId = useGlobalBusinessId();
  const formTeamMembers = useMemo(
    () => (teamMembers || []).filter((m: any) => !activeBusinessId || !m.businessId || m.businessId === activeBusinessId),
    [teamMembers, activeBusinessId]
  );
  const { data: customers } = useCollection<Customer>('customers', { skipTeamFilter: true });
  const { data: services } = useCollection<Service>('services', { skipTeamFilter: true });
  const { data: allInvoices } = useCollection<Invoice>('invoices', { skipTeamFilter: true });
  
  const projectMutation = useMutation<Project>('projects');
  const taskMutation = useMutation<Task>('tasks');
  const invoiceMutation = useMutation<Invoice>('invoices');
  const invoiceItemMutation = useMutation<InvoiceItem>('invoiceItems');
  const notificationMutation = useMutation<any>('notifications');
  const logActivity = useActivityLogger();

  const { getName, getInitials } = useUserNames(teamMembers || []);

  // Get unique owners from projects
  const owners = React.useMemo(() => {
    if (!projects) return [];
    const ownerIds = [...new Set(projects.map(p => p.createdByUserId).filter(Boolean))];
    return ownerIds;
  }, [projects]);

  // Next deadline per project (src/lib/projectSort.ts) — drives the list order.
  const projectDeadlines = React.useMemo(
    () => projectNextDeadlines(projects || [], allTasks),
    [projects, allTasks]
  );

  // Filter projects
  const filteredProjects = React.useMemo(() => {
    if (!projects) return [];
    
    let filtered = [...projects];

    // Archive split, applied first: the list is either the live portfolio or the
    // archive, never a mix. Picking "Arkivuar" in the status filter is the same
    // request, so it opens the archive too.
    const archiveOnly = showArchive || filterStatus === 'Archived';
    filtered = filtered.filter(p => isProjectArchived(p) === archiveOnly);

    // Search filter
    if (searchQuery) {
      filtered = filtered.filter(p => 
        p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.description?.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }
    
    // Owner filter
    if (filterOwner !== 'all') {
      filtered = filtered.filter(p => p.createdByUserId === filterOwner);
    }
    
    // Team filter
    if (filterTeam !== 'all') {
      filtered = filtered.filter(p => p.teamId === filterTeam);
    }
    
    // Status filter
    if (filterStatus !== 'all') {
      filtered = filtered.filter(p => p.status === filterStatus);
    }

    // Monthly recurring: isRecurring with a monthly cycle (monthly is the default
    // frequency when a project is recurring), or an explicit monthly billingType.
    if (filterMonthly) {
      filtered = filtered.filter(p =>
        (p.isRecurring === true && (p.recurringFrequency ?? 'monthly') === 'monthly')
        || p.billingType === 'monthly'
      );
    }

    // Members filter — checks memberUserIds first, falls back to team membership
    if (filterMembers.length > 0 && teamMembers) {
      filtered = filtered.filter(p => {
        const explicit = (p.memberUserIds as string[] | undefined);
        if (explicit && explicit.length > 0) {
          return filterMembers.some(id => explicit.includes(id));
        }
        // fallback: any member of the project's team
        if (!p.teamId) return false;
        const projectTeamMembers = teamMembers.filter(m => m.teamId === p.teamId);
        return filterMembers.some(memberId => projectTeamMembers.some(m => m.userId === memberId));
      });
    }
    
    // What is due next comes first: earliest unfinished-task deadline, then the
    // project's own end date; undated projects keep the updatedAt order below.
    return sortProjectsByDeadline(filtered, projectDeadlines);
  }, [projects, searchQuery, filterOwner, filterTeam, filterStatus, filterMembers, filterMonthly, showArchive, teamMembers, projectDeadlines]);

  // Get members for a project:
  //  - if memberUserIds is set → show exactly those people
  //  - otherwise fall back to everyone on the project's team
  const getProjectMembers = (project: Project) => {
    if (!teamMembers) return [];
    const explicit = (project.memberUserIds as string[] | undefined);
    if (explicit && explicit.length > 0) {
      return teamMembers.filter(m => explicit.includes(m.userId));
    }
    if (!project.teamId) return [];
    return teamMembers.filter(m => m.teamId === project.teamId);
  };

  // Get team name
  const getTeamName = (teamId?: string) => {
    if (!teamId || !teams) return null;
    return teams.find(t => t.id === teamId);
  };

  // Format relative time
  const formatRelativeTime = (date: Date) => {
    if (!date) return 'Pa kohë';
    const now = new Date();
    const dateObj = new Date(date);
    if (isNaN(dateObj.getTime())) return 'Pa kohë';
    const diff = now.getTime() - dateObj.getTime();
    if (diff < 0) return 'në të ardhmen';
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor(diff / (1000 * 60));
    
    if (minutes < 60) return `${minutes} min më parë`;
    if (hours < 24) return `${hours} orë më parë`;
    if (days === 1) return 'Dje';
    if (days < 7) return `${days} ditë më parë`;
    return new Date(date).toLocaleDateString('sq-AL');
  };

  const handleCreateProject = async (formData: FormData) => {
    const name = formData.get('name') as string;
    const description = formData.get('description') as string;
    const status = formData.get('status') as string;
    const teamId = formData.get('teamId') as string;
    const budgetStr = formData.get('budget') as string;
    const custId = formData.get('customerId') as string;
    const responsibleUserId = formData.get('responsibleUserId') as string;
    const isRecurring = formData.get('isRecurring') === 'true';
    const recurringFrequency = formData.get('recurringFrequency') as string;
    const isRecurringPaused = formData.get('isRecurringPaused') === 'true';
    const recurringEndStr = formData.get('recurringEndDate') as string;
    // End of that day, so "deri më 30 shtator" still bills September's own cycle.
    const recurringEndDate = recurringEndStr ? new Date(recurringEndStr + 'T23:59:59') : undefined;
    const billingType = formData.get('billingType') === 'monthly' ? 'monthly' : 'one-time';
    const startDateStr = formData.get('startDate') as string;
    const startDate = startDateStr ? new Date(startDateStr + 'T12:00:00') : undefined;
    const department = (formData.get('department') as string) || undefined;
    const billingDayRaw = formData.get('billingDayOfMonth') as string;
    const billingDayNum = billingDayRaw ? parseInt(billingDayRaw, 10) : NaN;
    const billingDayOfMonth = !isNaN(billingDayNum) && billingDayNum >= 1 && billingDayNum <= 31
      ? billingDayNum : undefined;
    // Work cycle (tasks) and the long-cycle billing inputs (projectBillingForm.ts).
    const workCycle = parseWorkCycleInput(formData.get('workCycle'));
    const longCycle = isRecurring && isAnchoredFrequency(recurringFrequency || 'monthly');
    const billingAnchorAt = longCycle ? parseAnchorMonthInput(formData.get('billingAnchorMonth')) : null;
    const invoiceDueDays = isRecurring ? parseDueDaysInput(formData.get('invoiceDueDays')) : null;
    const listMonthlyFee = longCycle ? parseMoneyInput(formData.get('listMonthlyFee')) : null;
    const prepayDiscountPct = longCycle ? parsePctInput(formData.get('prepayDiscountPct')) : null;
    const memberUserIdsStr = formData.get('memberUserIds') as string;
    let memberUserIds: string[] | undefined;
    if (memberUserIdsStr) {
      try { memberUserIds = JSON.parse(memberUserIdsStr); } catch { memberUserIds = undefined; }
    }
    const selectedServiceIdsStr = formData.get('selectedServiceIds') as string;
    let selectedServiceIds: string[] | undefined;
    if (selectedServiceIdsStr) {
      try { selectedServiceIds = JSON.parse(selectedServiceIdsStr); } catch { selectedServiceIds = undefined; }
    }
    // Explicit split across service lines (department P&L); empty = derived.
    let serviceMix: Array<{ line: string; pct: number }> = [];
    try { serviceMix = cleanServiceMixInput(JSON.parse((formData.get('serviceMix') as string) || '[]')); } catch { serviceMix = []; }
    // Staffing budget (hours per role), engagement end and recognition method —
    // see src/lib/finance/projectBudget.ts / revenueRecognition.ts.
    let plannedRoles: ReturnType<typeof normalizePlannedRoles> = [];
    try { plannedRoles = normalizePlannedRoles(JSON.parse((formData.get('plannedRoles') as string) || '[]')); } catch { plannedRoles = []; }
    const plannedDirectRaw = parseFloat((formData.get('plannedDirectExpenses') as string) || '');
    const plannedDirectExpenses = Number.isFinite(plannedDirectRaw) && plannedDirectRaw > 0 ? plannedDirectRaw : undefined;
    const targetMarginRaw = parseFloat((formData.get('targetMarginPct') as string) || '');
    const targetMarginPct = Number.isFinite(targetMarginRaw) && targetMarginRaw > 0 ? Math.min(95, targetMarginRaw) : undefined;
    const endDateStr = formData.get('endDate') as string;
    const endDate = endDateStr ? new Date(endDateStr + 'T12:00:00') : undefined;
    const recognitionRaw = (formData.get('recognitionMethod') as string) || '';
    const recognitionMethod = (['effort', 'straight-line', 'on-completion'] as const).find(m => m === recognitionRaw);

    const budgetRaw = budgetStr ? parseFloat(budgetStr) : undefined;
    const budget = budgetRaw !== undefined && !isNaN(budgetRaw) ? budgetRaw : undefined;
    const currency: 'ALL' | 'EUR' = (formData.get('currency') as string) === 'EUR' ? 'EUR' : 'ALL';
    const resolvedCustomerId = custId && custId !== '__none__' ? custId : undefined;
    const resolvedTeamId = teamId && teamId !== '__none__' ? teamId : undefined;
    const resolvedResponsible = responsibleUserId && responsibleUserId !== '__none__' ? responsibleUserId : undefined;

    // Mandatory owner: a project needs a responsible lead for accountability.
    if (!resolvedResponsible) {
      toast({ title: 'Cakto një përgjegjës', description: 'Projekti duhet të ketë një person përgjegjës.', variant: 'destructive' });
      return;
    }

    const newProject = await projectMutation.create({
      name,
      description,
      status,
      teamId: resolvedTeamId,
      budget,
      currency,
      billingType,
      startDate,
      department,
      billingDayOfMonth,
      spent: 0,
      customerId: resolvedCustomerId,
      responsibleUserId: resolvedResponsible,
      isRecurring: isRecurring || undefined,
      recurringFrequency: isRecurring && recurringFrequency ? recurringFrequency as any : undefined,
      isRecurringPaused: isRecurring && isRecurringPaused ? true : undefined,
      recurringEndDate: isRecurring ? recurringEndDate : undefined,
      // Written explicitly on every new project — the legacy fallback
      // (work cycle follows isRecurring) is for old rows only.
      workCycle,
      billingAnchorAt: billingAnchorAt ?? undefined,
      invoiceDueDays: invoiceDueDays ?? undefined,
      listMonthlyFee: listMonthlyFee ?? undefined,
      prepayDiscountPct: prepayDiscountPct ?? undefined,
      memberUserIds: memberUserIds && memberUserIds.length > 0 ? memberUserIds : undefined,
      serviceIds: selectedServiceIds && selectedServiceIds.length > 0 ? selectedServiceIds : undefined,
      endDate,
      // Explicit split, recognition method, target margin and the staffing plan
      // are Admin/Manager input (projCreateFinanceOk in firestore.rules) — a
      // Member's create OMITS them instead of sending empty placeholders.
      ...(canManageProjectFinance
        ? {
            serviceMix: serviceMix.length > 0 ? serviceMix : undefined,
            recognitionMethod,
            targetMarginPct,
            ...plannedFieldsPatch(plannedRoles, plannedDirectExpenses),
          }
        : {}),
    });

    // Only auto-create an invoice when there is something to bill: an explicit
    // budget, or selected services with a price. A project with neither would
    // otherwise spawn a 0.00 invoice — and, if recurring, email the client a blank
    // "Pending" invoice. A billable total also fixes the old bug where the invoice
    // total was `budget || 0` (0) even when priced services were attached.
    const now = new Date();
    const dueDate = new Date(now.getFullYear(), now.getMonth() + 1, 0); // last day of month

    // Services carry their OWN currency — summing raw prices turned a €500 service
    // on an ALL project into a 500 L invoice. Normalise to ALL, then express the
    // total in the project's currency (the invoice is stamped with that currency).
    const servicesTotalAll = (selectedServiceIds || []).reduce((sum, id) => {
      const s = services?.find(x => x.id === id);
      return sum + toAll(s?.price || 0, (s as any)?.currency);
    }, 0);
    const servicesTotal = fromAll(servicesTotalAll, currency);
    const billableTotal = budget && budget > 0 ? budget : servicesTotal;

    // Invoice numbers are unique per BUSINESS (teams are departments inside it), so
    // both the counter scope and this seed span the whole business — a per-team
    // counter used to restart at FAT-001 in every department and collide.
    const invoiceScopeId = activeBusinessId || resolvedTeamId;
    let maxInvNum = 0;
    if (allInvoices && invoiceScopeId) {
      const scoped = activeBusinessId
        ? allInvoices.filter(i => !(i as any).businessId || (i as any).businessId === activeBusinessId)
        : allInvoices.filter(i => (i as any).teamId === resolvedTeamId);
      for (const inv of scoped) {
        const m = inv.invoiceNumber?.match(/^FAT-(\d+)$/i);
        if (m) { const n = parseInt(m[1], 10); if (n > maxInvNum) maxInvNum = n; }
      }
    }

    // The counter is a Firestore transaction on `counters/invoices_{businessId}`.
    // Its failure used to escape this handler AFTER the project document existed,
    // so the first invoice and the period claim were never written — and the cron
    // then billed the period as if nothing had. Fall back to a label and say so:
    // the occurrence + claim are what must not be lost.
    const nextInvoiceLabel = async (fallback: string): Promise<string> => {
      if (!invoiceScopeId) return fallback;
      try {
        return await getNextInvoiceNumber(invoiceScopeId, maxInvNum);
      } catch (err: any) {
        console.error('[ProjectsView] numëratori atomik i faturave dështoi:', err?.code || err);
        toast({
          title: 'Numri u caktua pa numërator atomik — kontrollo dublikatët',
          description: `Fatura e projektit mori numrin ${fallback} (${err?.code || err?.message || 'gabim'}).`,
          variant: 'destructive',
        });
        return fallback;
      }
    };

    // A quarterly / yearly contract that starts in a LATER month has nothing to
    // bill today: the cron issues its first invoice when that month arrives
    // (`before-contract-start`). Claiming "now" would be claiming last year.
    const createdBillingFrequency = recurringFrequency || 'monthly';
    const createdAnchor = isRecurring
      ? projectBillingAnchor({ recurringFrequency: createdBillingFrequency as any, billingAnchorAt, startDate, createdAt: now })
      : null;
    const contractStartsLater = !!createdAnchor
      && now < billingPeriodStart(createdBillingFrequency, createdAnchor, createdAnchor);

    if (billableTotal > 0 && !(isRecurring && contractStartsLater)) {
    if (isRecurring) {
      // The recurrence is PROJECT-driven (cron `recurring-invoices` Part 2), so this
      // first invoice covers the current billing period and must record which one —
      // otherwise the cron bills the same period again and mails the client twice.
      const billingFrequency = createdBillingFrequency;
      const periodKey = projectBillingPeriodKey(billingFrequency, now, createdAnchor);
      const periodEnd = projectBillingPeriodEnd(billingFrequency, now, createdAnchor);
      const firstDueDate = billingDueDate(billingFrequency, now, periodEnd, invoiceDueDays);
      // Same id the cron computes for this (project, period) — see
      // createInvoiceOccurrence above and api/cron/run.ts Part 2.
      const occurrenceId = recurringOccurrenceId('auto', newProject.id, periodKey);
      const invoiceLabel = await nextInvoiceLabel(`AUTO-${periodKey}-${newProject.id.slice(0, 6).toUpperCase()}`);
      const occurrenceCreated = await createInvoiceOccurrence(occurrenceId, {
        invoiceNumber: invoiceLabel,
        projectId: newProject.id,
        customerId: resolvedCustomerId,
        teamId: resolvedTeamId,
        amount: billableTotal,
        subtotal: billableTotal,
        total: billableTotal,
        currency,
        tax: 0,
        // ISSUED, like every later occurrence the cron writes. As a Draft, period
        // 1 of a retainer was in no revenue figure (Draft is excluded from both
        // the accrual and the cash basis) and invisible in the client portal,
        // while periods 2..n were issued AND emailed — so the first month of
        // every retainer quietly fell out of the books. It is not auto-emailed:
        // the owner sends it with "Dërgo" once they have checked it.
        status: 'Pending',
        notes: `Faturë e gjeneruar automatikisht për projektin periodik "${name}".`,
        // Issue date: accrual revenue is recognised on invoiceDate; without it the
        // engines fall back to createdAt and the UI shows an empty "Data" column.
        invoiceDate: now,
        dueDate: firstDueDate,
        // The PROJECT drives the cycle, not this invoice — flagging it isRecurring
        // too would make it look like a second, competing series.
        isRecurring: false,
        autoGenerated: true,
        billingPeriodKey: periodKey,
        billingFrequency,
        billingPeriodStart: billingPeriodStart(billingFrequency, now, createdAnchor),
        billingPeriodEnd: periodEnd,
        emailSent: false,
        reminderSent: false,
        reminder25Sent: false,
        reminderLastDaySent: false,
      }, {
        // What the mutation layer's autoScope would have stamped.
        teamId: resolvedTeamId || getGlobalTeamId() || undefined,
        businessId: activeBusinessId || resolvedTeamId || getGlobalTeamId() || undefined,
        createdByUserId: user?.uid ?? null,
      });

      // Claim the period on the project (same token the cron writes) — ALSO when
      // the occurrence already existed: "already exists" means this period is
      // covered, so the honest record is the claim, not a second invoice.
      await projectMutation.update(newProject.id, {
        lastInvoicePeriodKey: periodKey,
        lastInvoiceGeneratedAt: now,
      } as any);

      if (!occurrenceCreated) {
        // Nothing left to do: the period's invoice (and its lines) already exist,
        // and re-sending the email would dun the client twice.
        toast({
          title: 'Fatura e periudhës ekzistonte',
          description: 'Kjo periudhë ishte faturuar tashmë — nuk u krijua faturë e dytë.',
        });
      } else {
      // One line per service, the invoice TOTAL split across them (explicit
      // serviceMix, else catalogue price) so the lines add up to the invoice and
      // the department P&L can put each service's share in its own department.
      // Same function as the recurring cron (api/_projectInvoiceLines.ts).
      for (const line of projectInvoiceLines({
        total: billableTotal, projectName: name,
        serviceIds: selectedServiceIds, serviceMix, services: services || [], rateToAll: getRateToAll,
      })) {
        await invoiceItemMutation.create({
          invoiceId: occurrenceId,
          ...(line.serviceId ? { serviceId: line.serviceId } : {}),
          ...(line.serviceLine ? { serviceLine: line.serviceLine } : {}),
          description: line.description,
          quantity: 1,
          unitPrice: line.amount,
          totalPrice: line.amount,
        } as any);
      }

      // Send invoice email to customer via API (sets status → Pending)
      if (resolvedCustomerId) {
        try {
          const authToken = await user?.getIdToken();
          await fetch('/api/send-invoice-email', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
            },
            body: JSON.stringify({ invoiceId: occurrenceId }),
          });
        } catch {
          // email failure is non-blocking
        }
      }
      } // end: only when THIS call created the period's occurrence
    } else {
      // Non-recurring project: create a plain Draft invoice
      const invoiceLabel = await nextInvoiceLabel(`DRAFT-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${newProject.id.slice(0, 6).toUpperCase()}`);
      const newInvoice = await invoiceMutation.create({
        invoiceNumber: invoiceLabel,
        projectId: newProject.id,
        customerId: resolvedCustomerId,
        teamId: resolvedTeamId,
        amount: billableTotal,
        subtotal: billableTotal,
        total: billableTotal,
        currency,
        tax: 0,
        status: 'Draft',
        notes: `Faturë draft e krijuar automatikisht për projektin "${name}".`,
        invoiceDate: now,
        dueDate,
      } as any);

      // One line per service, the invoice TOTAL split across them (explicit
      // serviceMix, else catalogue price) so the lines add up to the invoice and
      // the department P&L can put each service's share in its own department.
      // Same function as the recurring cron (api/_projectInvoiceLines.ts).
      for (const line of projectInvoiceLines({
        total: billableTotal, projectName: name,
        serviceIds: selectedServiceIds, serviceMix, services: services || [], rateToAll: getRateToAll,
      })) {
        await invoiceItemMutation.create({
          invoiceId: (newInvoice as any).id,
          ...(line.serviceId ? { serviceId: line.serviceId } : {}),
          ...(line.serviceLine ? { serviceLine: line.serviceLine } : {}),
          description: line.description,
          quantity: 1,
          unitPrice: line.amount,
          totalPrice: line.amount,
        } as any);
      }
    }
    } // end: only when billableTotal > 0

    logActivity('project_created', `Projekt i ri: ${name}`, { entityType: 'project', entityId: newProject.id });

    // Notify responsible user and project members (exclude creator)
    const notifyUids = new Set<string>();
    if (responsibleUserId && responsibleUserId !== '__none__' && responsibleUserId !== user?.uid) {
      notifyUids.add(responsibleUserId);
    }
    if (memberUserIds) {
      memberUserIds.forEach(uid => { if (uid !== user?.uid) notifyUids.add(uid); });
    }
    if (notifyUids.size > 0) {
      await Promise.all([...notifyUids].map(uid =>
        notificationMutation.create({
          userId: uid,
          type: 'project_created',
          title: `Projekt i Ri: ${name}`,
          message: `Ju u shtuat si pjesëtar i projektit "${name}".`,
          isRead: false,
          actionUrl: `/app/projects/${(newProject as any).id}`,
          actionLabel: 'Shiko Projektin',
        })
      )).catch(err => console.error('[Notifications] project_created dërgim dështoi:', err));
    }

    setIsCreateDialogOpen(false);
    navigate(`/app/projects/${newProject.id}`);
  };

  // Everything that references the project, so deleting one no longer leaves
  // invoices/expenses/time pointing at an id that does not exist. Financial records
  // are UNLINKED, never deleted: an issued invoice is an accounting document and a
  // logged hour is payroll history — only the project-scoped, never-sent leftovers
  // (draft auto-invoices, comments, tasks) are actually removed.
  const handleDeleteProject = async (id: string, name: string) => {
    try {
      // Shared implementation (src/lib/deleteCascade.ts) — the same cascade the
      // project detail page runs, with businessId-scoped queries the rules can
      // actually prove (a projectId-only query is denied for non-super-admins).
      const summary = await deleteProjectCascade({ id, name });
      if (summary.failed) console.warn('[ProjectsView] pjesë e kaskadës dështoi:', summary);

      logActivity('project_deleted', `Projekt i fshirë: ${name}`, { entityType: 'project', entityId: id });
      setProjectToDelete(null);

      const parts = projectCascadeToastParts(summary);
      toast({
        title: `Projekti "${name}" u fshi`,
        description: parts.length ? parts.join(' · ') : undefined,
      });
    } catch (err) {
      console.error('[ProjectsView] fshirja e projektit dështoi:', err);
      toast({ title: 'Gabim gjatë fshirjes së projektit', variant: 'destructive' });
    }
  };

  // Tell the people on the project that its status moved. Same recipients as the
  // edit dialog's status-change notice, so archiving is not a silent event.
  const notifyStatusChange = async (project: Project, title: string, message: string) => {
    const recipientIds = new Set<string>([
      ...(project.memberUserIds || []),
      ...(project.responsibleUserId ? [project.responsibleUserId] : []),
    ]);
    recipientIds.delete(user?.uid || '');
    if (!recipientIds.size) return;
    await Promise.all([...recipientIds].map(uid =>
      notificationMutation.create({
        userId: uid,
        type: 'project_status_changed',
        title,
        message,
        isRead: false,
        actionUrl: `/app/projects/${project.id}`,
        actionLabel: 'Shiko Projektin',
      }).catch(() => {})
    ));
  };

  // Archive = the reversible alternative to delete. Nothing is removed; the
  // project leaves the live list and (if it was a retainer) stops billing.
  const handleArchiveProject = async (project: Project) => {
    try {
      await projectMutation.update(project.id, archiveProjectPatch(project, {
        at: new Date(),
        byUserId: user?.uid ?? null,
      }) as any);
      logActivity('project_archived', `Projekt i arkivuar: ${project.name}`, { entityType: 'project', entityId: project.id });
      await notifyStatusChange(
        project,
        `🗄️ "${project.name}" u arkivua`,
        'Projekti u kalua në arkivë. Të dhënat ruhen dhe mund të kthehet në çdo moment.',
      );
      setProjectToArchive(null);
      toast({
        title: `Projekti "${project.name}" u arkivua`,
        description: project.isRecurring
          ? 'Faturimi i përsëritur ndaloi. E gjen te skeda "Arkiva".'
          : 'E gjen te skeda "Arkiva".',
      });
    } catch (err) {
      console.error('[ProjectsView] arkivimi i projektit dështoi:', err);
      toast({ title: 'Gabim gjatë arkivimit', variant: 'destructive' });
    }
  };

  const handleRestoreProject = async (project: Project) => {
    try {
      const patch = restoreProjectPatch(project);
      await projectMutation.update(project.id, patch as any);
      logActivity('project_restored', `Projekt i kthyer nga arkiva: ${project.name}`, { entityType: 'project', entityId: project.id });
      await notifyStatusChange(
        project,
        `♻️ "${project.name}" u kthye nga arkiva`,
        `Projekti është aktiv përsëri (statusi: ${patch.status}).`,
      );
      toast({
        title: `Projekti "${project.name}" u kthye`,
        // A series whose "repeat until" has passed is NOT switched back on
        // (restoreProjectPatch) — the toast must not claim otherwise.
        description: resumeBillingToastLine(project),
      });
    } catch (err) {
      console.error('[ProjectsView] kthimi nga arkiva dështoi:', err);
      toast({ title: 'Gabim gjatë kthimit nga arkiva', variant: 'destructive' });
    }
  };

  const handleEditProject = async (formData: FormData) => {
    if (!projectToEdit) return;
    const name = formData.get('name') as string;
    const description = formData.get('description') as string;
    const status = formData.get('status') as string;
    const teamId = formData.get('teamId') as string;
    const budgetStr = formData.get('budget') as string;
    const custId = formData.get('customerId') as string;
    const responsibleUserId = formData.get('responsibleUserId') as string;
    const isRecurring = formData.get('isRecurring') === 'true';
    const recurringFrequency = formData.get('recurringFrequency') as string;
    const isRecurringPaused = formData.get('isRecurringPaused') === 'true';
    const recurringEndStr = formData.get('recurringEndDate') as string;
    // End of that day, so "deri më 30 shtator" still bills September's own cycle.
    const recurringEndDate = recurringEndStr ? new Date(recurringEndStr + 'T23:59:59') : undefined;
    const billingType = formData.get('billingType') === 'monthly' ? 'monthly' : 'one-time';
    const startDateStr = formData.get('startDate') as string;
    const startDate = startDateStr ? new Date(startDateStr + 'T12:00:00') : undefined;
    // "Pa departament" must CLEAR the field: null, not undefined (formValue.ts).
    const department = updateValue(formData.get('department'));
    const billingDayRaw = formData.get('billingDayOfMonth') as string;
    const billingDayNum = billingDayRaw ? parseInt(billingDayRaw, 10) : NaN;
    const billingDayOfMonth = !isNaN(billingDayNum) && billingDayNum >= 1 && billingDayNum <= 31
      ? billingDayNum : undefined;
    // Work cycle (tasks) and the long-cycle billing inputs (projectBillingForm.ts).
    const workCycle = parseWorkCycleInput(formData.get('workCycle'));
    const longCycle = isRecurring && isAnchoredFrequency(recurringFrequency || 'monthly');
    const billingAnchorAt = longCycle ? parseAnchorMonthInput(formData.get('billingAnchorMonth')) : null;
    const invoiceDueDays = isRecurring ? parseDueDaysInput(formData.get('invoiceDueDays')) : null;
    const listMonthlyFee = longCycle ? parseMoneyInput(formData.get('listMonthlyFee')) : null;
    const prepayDiscountPct = longCycle ? parsePctInput(formData.get('prepayDiscountPct')) : null;
    // `[]` CLEARS an emptied list (undefined would be stripped and keep the old ids
    // — and with them the derived service split and the recurring invoice lines);
    // `undefined` only when the form did not send the list at all.
    const memberUserIds = updateIdListValue(formData.get('memberUserIds'));
    const selectedServiceIds = updateIdListValue(formData.get('selectedServiceIds'));
    // Explicit split across service lines (department P&L). Only sent by a form
    // that showed the editor (canSeeBudget) — absent means "leave it as it is".
    const serviceMixSent = formData.has('serviceMix');
    let serviceMix: Array<{ line: string; pct: number }> = [];
    try { serviceMix = cleanServiceMixInput(JSON.parse((formData.get('serviceMix') as string) || '[]')); } catch { serviceMix = []; }
    // Staffing budget (hours per role), engagement end and recognition method —
    // see src/lib/finance/projectBudget.ts / revenueRecognition.ts.
    let plannedRoles: ReturnType<typeof normalizePlannedRoles> = [];
    try { plannedRoles = normalizePlannedRoles(JSON.parse((formData.get('plannedRoles') as string) || '[]')); } catch { plannedRoles = []; }
    const plannedDirectRaw = parseFloat((formData.get('plannedDirectExpenses') as string) || '');
    const plannedDirectExpenses = Number.isFinite(plannedDirectRaw) && plannedDirectRaw > 0 ? plannedDirectRaw : undefined;
    const targetMarginRaw = parseFloat((formData.get('targetMarginPct') as string) || '');
    const targetMarginPct = Number.isFinite(targetMarginRaw) && targetMarginRaw > 0 ? Math.min(95, targetMarginRaw) : undefined;
    const endDateStr = formData.get('endDate') as string;
    const endDate = endDateStr ? new Date(endDateStr + 'T12:00:00') : undefined;
    const recognitionRaw = (formData.get('recognitionMethod') as string) || '';
    const recognitionMethod = (['effort', 'straight-line', 'on-completion'] as const).find(m => m === recognitionRaw);

    const budgetRaw = budgetStr ? parseFloat(budgetStr) : undefined;
    const budget = budgetRaw !== undefined && !isNaN(budgetRaw) ? budgetRaw : undefined;
    const currency: 'ALL' | 'EUR' = (formData.get('currency') as string) === 'EUR' ? 'EUR' : 'ALL';

    const resolvedResponsible = responsibleUserId && responsibleUserId !== '__none__' ? responsibleUserId : undefined;
    // Mandatory owner: keep the responsible lead set on edit too.
    if (!resolvedResponsible) {
      toast({ title: 'Cakto një përgjegjës', description: 'Projekti duhet të ketë një person përgjegjës.', variant: 'destructive' });
      return;
    }

    const oldStatus = projectToEdit.status;

    // Stamp the completion date when the project is marked Completed by hand
    // (the auto-close path already does this). Revenue for a one-time project is
    // recognised in the month it was COMPLETED, so this date must be stable —
    // without it the P&L falls back to updatedAt and the revenue drifts months.
    const completedNow = status === 'Completed' && oldStatus !== 'Completed'
      && !(projectToEdit as any).lastCompletedAt;

    // Picking 'Arkivuar' in this form must archive exactly like the Arkivo button
    // does (remember the old status, stop the retainer) — and picking anything
    // else on an archived project must restore it the same way. Otherwise the two
    // paths disagree and a hand-archived retainer keeps `isRecurring` until the
    // cron notices and switches it off for good.
    const editedAt = new Date();

    // A frequency change must RE-EXPRESS the period claim, never keep it: a weekly
    // key ('W2026-09-14') can never equal a monthly one ('2026-09'), so the stale
    // claim stops blocking anything and `already-billed` goes dead — the cron then
    // bills a period that was already invoiced and emails it to the client. Same
    // law the invoice form obeys (InvoicesView, `resolvedPeriodClaim`). The last
    // occurrence's DATE is what gets re-expressed; with no date recorded we fall
    // back to now, which is the conservative end (it blocks the current period
    // rather than risking a second invoice for it).
    const previousFrequency = projectToEdit.recurringFrequency || 'monthly';
    const nextFrequency = (recurringFrequency || 'monthly') as NonNullable<Project['recurringFrequency']>;
    const rawLastGenerated: any = (projectToEdit as any).lastInvoiceGeneratedAt;
    const lastGeneratedAt: Date | null = rawLastGenerated
      ? (rawLastGenerated?.toDate ? rawLastGenerated.toDate() : new Date(rawLastGenerated))
      : null;
    // A long cycle is anchored on the contract month; a changed anchor is a
    // changed period grid too, so it re-expresses the claim just like a new frequency.
    const nextAnchor = isRecurring
      ? projectBillingAnchor({ ...projectToEdit, recurringFrequency: nextFrequency, billingAnchorAt: billingAnchorAt ?? projectToEdit.billingAnchorAt } as any)
      : null;
    const previousAnchor = projectBillingAnchor(projectToEdit as any);
    const anchorChanged = (nextAnchor?.getTime() ?? null) !== (previousAnchor?.getTime() ?? null);
    const reExpressedClaim =
      isRecurring
        && projectToEdit.lastInvoicePeriodKey
        && (previousFrequency !== nextFrequency || anchorChanged)
        ? {
            lastInvoicePeriodKey: reexpressBillingClaim(
              nextFrequency,
              lastGeneratedAt && !isNaN(lastGeneratedAt.getTime()) ? lastGeneratedAt : null,
              editedAt,
              nextAnchor,
            ),
          }
        : {};

    // What archive/restore must reason about is the project AS SAVED — restoring
    // and switching the cycle in the same save has to re-point the claim in the
    // NEW frequency, not the one being replaced.
    const billingSubject = {
      ...projectToEdit,
      recurringFrequency: isRecurring ? nextFrequency : projectToEdit.recurringFrequency,
      ...reExpressedClaim,
    } as Project;

    const archiveTransition =
      status === 'Archived' && oldStatus !== 'Archived'
        ? archiveProjectPatch({ ...billingSubject, isRecurring }, { at: editedAt, byUserId: user?.uid ?? null })
        : oldStatus === 'Archived' && status !== 'Archived'
          ? { ...restoreProjectPatch(billingSubject, { at: editedAt }), status }
          // REOPENING a Cancelled project is the same event as un-archiving one:
          // the cron marks BOTH with `wasRecurringBeforeArchive` when it stops a
          // terminal-status retainer for good (api/cron/run.ts,
          // PERMANENT_BILLING_BLOCKS). Honouring the token only on the archive
          // path meant a cancelled-then-reopened client came back as a project
          // that silently never billed again — the form's own "Projekt Periodik"
          // switch is OFF by then, because the cron switched it off.
          : isTerminalProjectStatus(oldStatus) && !isTerminalProjectStatus(status as Project['status'])
            ? resumeRecurringBillingPatch(billingSubject, { at: editedAt })
            : {};

    // Money / billing / bank / plan keys (`projectFinanceKeys()` in
    // firestore.rules) are Admin/Manager input. For anyone else they are OMITTED
    // from the patch — only the SAFE billing moves the rules allow a Member are
    // sent: stopping a running series and pausing it (the archive/restore/resume
    // patches below go through projectArchive and are kept as they are).
    const financeFields: Record<string, unknown> = {
      budget,
      currency,
      billingType,
      // Explicit null CLEARS the field (removeUndefined strips undefined, so an
      // emptied billing day used to keep the old one forever).
      billingDayOfMonth: billingDayOfMonth ?? null,
      // `isRecurring || undefined` was the whole bug: the write layer strips
      // undefined (src/lib/formValue.ts), so switching "Projekt Periodik" OFF
      // wrote NOTHING and the retainer kept billing — the owner's only real
      // levers were archiving or cancelling the client. Off now goes through
      // stopProjectBillingPatch, the same one-module law as the archive.
      ...(isRecurring
        ? {
            isRecurring: true,
            recurringFrequency: (recurringFrequency || 'monthly') as any,
            isRecurringPaused,
            // null CLEARS a removed end date; undefined would silently keep it.
            recurringEndDate: recurringEndDate ?? null,
            // Re-enabling a stopped series wipes the stop record.
            ...(projectToEdit.isRecurring ? {} : { recurringBillingStoppedReason: null, recurringBillingStoppedAt: null }),
            // Leaving a manual stop OR a pause re-points a stale claim, exactly
            // like a restore from the archive does: otherwise the first run after
            // the switch reports every paused month as "pa faturë" and notifies
            // the owner about periods that were deliberately not billed.
            ...((!projectToEdit.isRecurring || (projectToEdit.isRecurringPaused && !isRecurringPaused))
              ? resumedBillingClaimPatch(billingSubject, editedAt)
              : {}),
          }
        : (projectToEdit.isRecurring
            ? { ...stopProjectBillingPatch(editedAt, projectToEdit), recurringEndDate: null }
            : { isRecurring: false })),
      // null CLEARS an emptied split; not sent at all (no editor shown) = untouched.
      ...(serviceMixSent ? { serviceMix: serviceMix.length > 0 ? serviceMix : null } : {}),
      // Long-cycle inputs: explicit null CLEARS them when the cycle is no longer
      // quarterly / yearly (removeUndefined would keep the stale values).
      billingAnchorAt: billingAnchorAt ?? null,
      invoiceDueDays: invoiceDueDays ?? null,
      listMonthlyFee: listMonthlyFee ?? null,
      prepayDiscountPct: prepayDiscountPct ?? null,
      // Explicit null CLEARS (removeUndefined strips undefined — see formValue.ts).
      recognitionMethod: recognitionMethod ?? null,
      targetMarginPct: targetMarginPct ?? null,
      ...plannedFieldsPatch(plannedRoles, plannedDirectExpenses),
      // The claim re-expressed in the frequency being saved (no-op unless the
      // frequency actually changed).
      ...reExpressedClaim,
    };
    const memberBillingFields: Record<string, unknown> =
      projectToEdit.isRecurring && !isRecurring
        ? { ...stopProjectBillingPatch(editedAt, projectToEdit), recurringEndDate: null }
        : projectToEdit.isRecurring && isRecurring && isRecurringPaused && !projectToEdit.isRecurringPaused
          ? pauseProjectBillingPatch()
          : {};
    // A Member who switched a series ON, resumed a pause or changed the cycle
    // is told why it did not stick, instead of a silent no-op.
    if (!canManageProjectFinance && (
      (!projectToEdit.isRecurring && isRecurring)
      || (projectToEdit.isRecurring && isRecurring && projectToEdit.isRecurringPaused && !isRecurringPaused)
      || (projectToEdit.isRecurring && isRecurring && previousFrequency !== nextFrequency)
    )) {
      toast({
        title: 'Faturimi nuk u ndryshua',
        description: 'Aktivizimi, rifillimi ose ndryshimi i ciklit të faturimit bëhet vetëm nga Admin ose Manager.',
      });
    }

    await projectMutation.update(projectToEdit.id, {
      name,
      description,
      status,
      ...(completedNow ? { lastCompletedAt: new Date() } : {}),
      teamId: teamId && teamId !== '__none__' ? teamId : undefined,
      startDate,
      department,
      // '' (not undefined): the mutation layer strips undefined, so "Pa klient"
      // silently kept the OLD customer — and with it the old client's portal
      // access to the project and its tasks.
      customerId: custId && custId !== '__none__' ? custId : '',
      responsibleUserId: resolvedResponsible,
      ...(canManageProjectFinance ? financeFields : memberBillingFields),
      // The WORK cycle is not money: every editor may set it. Written after the
      // billing patches so the form's choice wins over a stop's materialisation.
      workCycle,
      memberUserIds,
      serviceIds: selectedServiceIds,
      endDate: endDate ?? null,
      // The manual revenue split is retired: staff are cost allocated by logged
      // hours (laborAllocation.ts), not shareholders of a project's revenue.
      profitSplit: [],
      // Last, so the archive rules win over the plain form fields above — and so a
      // restore's own claim re-point wins over the frequency one (it was computed
      // from it).
      ...archiveTransition,
    } as any);

    logActivity(
      status === 'Archived' && oldStatus !== 'Archived' ? 'project_archived'
        : oldStatus === 'Archived' && status !== 'Archived' ? 'project_restored'
        : 'project_updated',
      `Projekt i përditësuar: ${name}`,
      { entityType: 'project', entityId: projectToEdit.id },
    );

    // customerId rides on the project's tasks too (it is what grants the portal
    // client read access to them). Changing or clearing the project's customer
    // must therefore re-stamp every task, or the OLD client keeps reading tasks
    // that now belong to someone else — and the NEW client sees none of them.
    const oldCustomerId = (projectToEdit as any).customerId || '';
    const newCustomerId = custId && custId !== '__none__' ? custId : '';
    if (oldCustomerId !== newCustomerId) {
      const projectTasks = (allTasks || []).filter(t => (t as any).projectId === projectToEdit.id);
      const restamp = await Promise.allSettled(
        projectTasks.map(t => taskMutation.update(t.id, { customerId: newCustomerId } as any)),
      );
      const failedRestamp = restamp.filter(r => r.status === 'rejected').length;
      if (failedRestamp) console.warn(`[ProjectsView] ${failedRestamp} detyra nuk u ri-vulosën me klientin e ri`);
    }

    // Keep DRAFT invoices in step with the fee. A draft was never sent, so silently
    // leaving it on the old price (the previous behaviour) meant the number the
    // client eventually received had nothing to do with the agreed budget. Issued
    // invoices are never rewritten — the user is told to issue a difference instead.
    const oldBudget = Number(projectToEdit.budget) || 0;
    const newBudget = Number(budget) || 0;
    const budgetChanged = canManageProjectFinance
      && (newBudget !== oldBudget || currency !== (projectToEdit.currency || 'ALL'));
    if (budgetChanged) {
      const linked = (allInvoices || []).filter(i => i.projectId === projectToEdit.id);
      const drafts = linked.filter(i => i.status === 'Draft');
      const issued = linked.filter(i => i.status !== 'Draft' && i.status !== 'Cancelled');

      if (newBudget > 0 && drafts.length > 0) {
        await Promise.all(drafts.map(i => invoiceMutation.update(i.id, {
          amount: newBudget, subtotal: newBudget, total: newBudget, currency,
        } as any)));
      }

      if (drafts.length > 0 || issued.length > 0) {
        const parts: string[] = [];
        if (newBudget > 0 && drafts.length) parts.push(`${drafts.length} faturë draft u përditësua në ${newBudget.toLocaleString('sq-AL')} ${currency}`);
        if (issued.length) parts.push(`${issued.length} faturë të lëshuara NUK u prekën — lësho një faturë diference nëse duhet`);
        if (parts.length) toast({ title: 'Buxheti ndryshoi', description: parts.join(' · ') });
      }
    }

    // Notify members when project status changes
    if (oldStatus && status && oldStatus !== status) {
      const STATUS_LABELS: Record<string, string> = {
        Active: 'Aktiv', Planning: 'Planifikim', 'On Hold': 'Pezulluar',
        Completed: 'Përfunduar', Archived: 'Arkivuar', Cancelled: 'Anuluar',
      };
      const recipientIds = new Set<string>([
        ...(projectToEdit.memberUserIds || []),
        ...(responsibleUserId && responsibleUserId !== '__none__' ? [responsibleUserId] : []),
        ...(projectToEdit.responsibleUserId ? [projectToEdit.responsibleUserId] : []),
      ]);
      recipientIds.delete(user?.uid || '');
      await Promise.all([...recipientIds].map(uid =>
        notificationMutation.create({
          userId: uid,
          type: 'project_status_changed',
          title: `📋 "${name}" → ${STATUS_LABELS[status] || status}`,
          message: `Statusi i projektit ndryshoi nga ${STATUS_LABELS[oldStatus] || oldStatus} në ${STATUS_LABELS[status] || status}.`,
          isRead: false,
          actionUrl: `/app/projects/${projectToEdit.id}`,
          actionLabel: 'Shiko Projektin',
        }).catch(() => {})
      ));
    }

    setProjectToEdit(null);
  };

  if (projectsLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="h-8 w-48 skeleton rounded" />
          <div className="h-10 w-32 skeleton rounded" />
        </div>
        <div className="h-10 w-full skeleton rounded" />
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-16 w-full skeleton rounded" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h1 className="text-xl sm:text-2xl font-semibold text-foreground">Shfleto projektet</h1>
        {permissions.canEdit && (
          <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button className="bg-primary text-primary-foreground w-full sm:w-auto">
                <Plus className="w-4 h-4 mr-2" />
                Krijo projekt
              </Button>
            </DialogTrigger>
            <DialogContent className="w-full max-w-full sm:max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Krijo Projekt të Ri</DialogTitle>
              </DialogHeader>
              <ProjectForm key={isCreateDialogOpen ? 'open' : 'closed'} onSubmit={handleCreateProject} teams={teams || []} customers={customers || []} teamMembers={formTeamMembers} services={services || []} />
            </DialogContent>
          </Dialog>
        )}
      </div>

      {/* Search Bar */}
      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Gjej një projekt"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10 h-10"
        />
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Owner Filter */}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-8">
              Pronari
              <ChevronDown className="w-3 h-3 ml-1" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-48 p-2" align="start">
            <div className="space-y-1">
              <button
                className={`w-full text-left px-2 py-1.5 text-sm rounded hover:bg-muted ${filterOwner === 'all' ? 'bg-muted' : ''}`}
                onClick={() => setFilterOwner('all')}
              >
                Të gjithë
              </button>
              {user && (
                <button
                  className={`w-full text-left px-2 py-1.5 text-sm rounded hover:bg-muted ${filterOwner === user.uid ? 'bg-muted' : ''}`}
                  onClick={() => setFilterOwner(user.uid)}
                >
                  Unë
                </button>
              )}
            </div>
          </PopoverContent>
        </Popover>

        {/* Members Filter */}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-8">
              Anëtarët
              <ChevronDown className="w-3 h-3 ml-1" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-56 p-2" align="start">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground px-2 py-1">Filtro sipas anëtarëve</p>
              {teamMembers?.slice(0, 30).map(member => (
                <div key={member.id} className="flex items-center gap-2 px-2 py-1.5">
                  <Checkbox
                    checked={filterMembers.includes(member.userId)}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        setFilterMembers([...filterMembers, member.userId]);
                      } else {
                        setFilterMembers(filterMembers.filter(id => id !== member.userId));
                      }
                    }}
                  />
                  <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-xs">
                    {getInitials(member.userId)}
                  </div>
                  <span className="text-sm truncate">{getName(member.userId)}</span>
                </div>
              ))}
            </div>
          </PopoverContent>
        </Popover>

        {/* Teams Filter */}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-8">
              Ekipet
              <ChevronDown className="w-3 h-3 ml-1" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-48 p-2" align="start">
            <div className="space-y-1">
              <button
                className={`w-full text-left px-2 py-1.5 text-sm rounded hover:bg-muted ${filterTeam === 'all' ? 'bg-muted' : ''}`}
                onClick={() => setFilterTeam('all')}
              >
                Të gjitha
              </button>
              {teams?.map(team => (
                <button
                  key={team.id}
                  className={`w-full text-left px-2 py-1.5 text-sm rounded hover:bg-muted ${filterTeam === team.id ? 'bg-muted' : ''}`}
                  onClick={() => setFilterTeam(team.id)}
                >
                  {team.name}
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>

        {/* Monthly-recurring toggle: show only projects that repeat every month */}
        <Button
          variant={filterMonthly ? 'default' : 'outline'}
          size="sm"
          className="h-8"
          onClick={() => setFilterMonthly(v => !v)}
          aria-pressed={filterMonthly}
          title="Shfaq vetëm projektet që përsëriten çdo muaj"
        >
          <RefreshCw className="w-3 h-3 mr-1.5" />
          Mujore
        </Button>

        {/* Status Filter */}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-8">
              Statusi
              <ChevronDown className="w-3 h-3 ml-1" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-40 p-2" align="start">
            <div className="space-y-1">
              <button
                className={`w-full text-left px-2 py-1.5 text-sm rounded hover:bg-muted ${filterStatus === 'all' ? 'bg-muted' : ''}`}
                onClick={() => setFilterStatus('all')}
              >
                Të gjitha
              </button>
              {['Active', 'Planning', 'In Review', 'On Hold', 'Completed', 'Archived', 'Cancelled'].map(status => (
                <button
                  key={status}
                  className={`w-full text-left px-2 py-1.5 text-sm rounded hover:bg-muted ${filterStatus === status ? 'bg-muted' : ''}`}
                  onClick={() => setFilterStatus(status)}
                >
                  {status}
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>

        {/* Archive shelf: live projects vs. archived ones (never mixed) */}
        <Button
          variant={showArchive || filterStatus === 'Archived' ? 'default' : 'outline'}
          size="sm"
          className="h-8"
          onClick={() => {
            const archiveOpen = showArchive || filterStatus === 'Archived';
            // Leaving the archive also drops a lingering "Arkivuar" status filter,
            // which would otherwise keep the archive open.
            if (filterStatus === 'Archived') setFilterStatus('all');
            setShowArchive(!archiveOpen);
          }}
          aria-pressed={showArchive || filterStatus === 'Archived'}
          title="Projektet e arkivuara"
        >
          <Archive className="w-3 h-3 mr-1.5" />
          Arkiva
          {archivedCount > 0 && (
            <span className="ml-1.5 text-xs opacity-70">{archivedCount}</span>
          )}
        </Button>

        {/* Clear Filters */}
        {(filterOwner !== 'all' || filterTeam !== 'all' || filterStatus !== 'all' || filterMembers.length > 0) && (
          <Button 
            variant="ghost" 
            size="sm" 
            className="h-8 text-muted-foreground"
            onClick={() => {
              setFilterOwner('all');
              setFilterTeam('all');
              setFilterStatus('all');
              setFilterMembers([]);
            }}
          >
            Pastro filtrat
          </Button>
        )}
      </div>

      {/* Portfolio summary (health dashboard) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        {[
          { label: 'Projekte', val: String(portfolio.activeProjects), cls: '' },
          { label: 'Progres mesatar', val: `${portfolio.avgPct}%`, cls: 'text-primary' },
          { label: 'Detyra vonë', val: String(portfolio.overdue), cls: portfolio.overdue > 0 ? 'text-destructive' : '' },
          { label: 'Projekte në rrezik', val: String(portfolio.atRisk), cls: portfolio.atRisk > 0 ? 'text-amber-600' : '' },
        ].map(s => (
          <div key={s.label} className="p-3 rounded-lg border bg-card">
            <p className={`text-2xl font-bold ${s.cls}`}>{s.val}</p>
            <p className="text-xs text-muted-foreground">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Projects Table */}
      <div className="border rounded-lg overflow-hidden">
        {/* Table Header — hidden on mobile */}
        <div className="hidden md:grid grid-cols-12 gap-4 px-4 py-3 bg-muted/50 border-b text-sm font-medium text-muted-foreground">
          <div className="col-span-5">Emri</div>
          <div className="col-span-2">Anëtarët</div>
          <div className="col-span-3">Ekipet dhe portfoliot</div>
          <div className="col-span-2 text-right">Modifikuar</div>
        </div>

        {/* Table Body */}
        <div className="divide-y">
          {filteredProjects.map((project) => {
            const members = getProjectMembers(project);
            const team = getTeamName(project.teamId);
            const isJoined = members.some(m => m.userId === user?.uid);
            const isGuestOnProject = Array.isArray(project.guestUserIds) && project.guestUserIds.includes(user?.uid);
            const archived = isProjectArchived(project);

            return (
              <div
                key={project.id}
                className="px-4 py-3 hover:bg-muted/30 cursor-pointer transition-colors group md:grid md:grid-cols-12 md:gap-4 md:items-center"
                onClick={() => navigate(`/app/projects/${project.id}`)}
              >
                {/* Name Column */}
                <div className="md:col-span-5 flex items-center gap-3">
                  <div className="w-8 h-8 rounded bg-pink-100 flex items-center justify-center flex-shrink-0">
                    <List className="w-4 h-4 text-pink-600" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-foreground truncate">{project.name}</span>
                      {archived && (
                        <Badge variant="secondary" className="gap-1 text-[10px] px-1.5 py-0 h-4 border-0">
                          <Archive className="w-2.5 h-2.5" />
                          Arkivuar
                        </Badge>
                      )}
                      {isGuestOnProject && (
                        <Badge className="text-[10px] px-1.5 py-0 h-4 bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400 border-0">
                          Guest
                        </Badge>
                      )}
                      {project.isRecurring && !archived && (
                        <Badge
                          variant="outline"
                          className="gap-1 text-[10px] px-1.5 py-0 h-4 cursor-help"
                          title={billingCheckTooltip(project)}
                        >
                          <RefreshCw className="w-2.5 h-2.5" />
                          Periodik
                        </Badge>
                      )}
                    </div>
                    {(() => {
                      const due = projectDeadlines.get(project.id);
                      if (due === undefined || archived) return null;
                      // By Europe/Tirane DAY: a project endDate stored at 12:00 is
                      // not "Vonuar" on its own day (src/lib/taskDue.ts).
                      const overdue = isOverdueDate(due);
                      return (
                        <span className={`text-xs mr-2 ${overdue ? 'text-destructive font-medium' : 'text-muted-foreground'}`}>
                          {overdue ? 'Vonuar · ' : 'Afati · '}{new Date(due).toLocaleDateString('sq-AL', { day: 'numeric', month: 'short' })}
                        </span>
                      );
                    })()}
                    {isJoined && !isGuestOnProject && (
                      <span className="text-xs text-success">Joined</span>
                    )}
                  </div>
                  {/* Mobile-only: action buttons inline */}
                  <div className="flex items-center gap-1 md:hidden">
                    {permissions.canEdit && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        onClick={(e) => { e.stopPropagation(); setProjectToEdit(project); }}
                      >
                        <Edit className="w-3.5 h-3.5" />
                      </Button>
                    )}
                    {permissions.canEdit && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        aria-label={archived ? 'Kthe nga arkiva' : 'Arkivo projektin'}
                        onClick={(e) => {
                          e.stopPropagation();
                          archived ? handleRestoreProject(project) : setProjectToArchive(project);
                        }}
                      >
                        {archived
                          ? <ArchiveRestore className="w-3.5 h-3.5" />
                          : <Archive className="w-3.5 h-3.5" />}
                      </Button>
                    )}
                    {permissions.canEdit && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive h-7 w-7 p-0"
                        onClick={(e) => { e.stopPropagation(); setProjectToDelete({ id: project.id, name: project.name }); }}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </div>
                </div>

                {/* Mobile meta row */}
                <div className="flex items-center gap-3 mt-2 md:hidden text-xs text-muted-foreground">
                  {members.length > 0 && (
                    <div className="flex -space-x-1.5">
                      {members.slice(0, 3).map((member) => (
                        <div
                          key={member.id}
                          className="w-5 h-5 rounded-full bg-primary/20 border border-background flex items-center justify-center text-[10px] font-medium"
                        >
                          {getInitials(member.userId)}
                        </div>
                      ))}
                      {members.length > 3 && <span className="ml-1">+{members.length - 3}</span>}
                    </div>
                  )}
                  {team && (
                    <Badge variant="secondary" className="text-[10px] font-normal py-0">
                      {team.name}
                    </Badge>
                  )}
                  <span className="ml-auto">{formatRelativeTime(project.updatedAt)}</span>
                </div>

                {/* Members Column — desktop only */}
                <div className="col-span-2 hidden md:block">
                  <div className="flex items-center">
                    <div className="flex -space-x-2">
                      {members.slice(0, 3).map((member, idx) => (
                        <div
                          key={member.id}
                          className="w-7 h-7 rounded-full bg-primary/20 border-2 border-background flex items-center justify-center text-xs font-medium"
                          title={getName(member.userId)}
                        >
                          {getInitials(member.userId)}
                        </div>
                      ))}
                    </div>
                    {members.length > 3 && (
                      <span className="ml-1 text-xs text-muted-foreground">
                        ...
                      </span>
                    )}
                    {members.length === 0 && (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </div>
                </div>

                {/* Teams Column — desktop only */}
                <div className="col-span-3 hidden md:block">
                  {team ? (
                    <div className="flex items-center gap-2">
                      <Users className="w-4 h-4 text-muted-foreground" />
                      <Badge variant="secondary" className="text-xs font-normal">
                        {team.name}
                      </Badge>
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </div>

                {/* Last Modified Column — desktop only */}
                <div className="col-span-2 text-right hidden md:flex items-center justify-end gap-1">
                  <span className="text-sm text-muted-foreground">
                    {formatRelativeTime(project.updatedAt)}
                  </span>
                  {permissions.canEdit && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={(e) => { e.stopPropagation(); setProjectToEdit(project); }}
                      title="Modifiko projektin"
                    >
                      <Edit className="w-3.5 h-3.5" />
                    </Button>
                  )}
                  {permissions.canEdit && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={(e) => {
                        e.stopPropagation();
                        archived ? handleRestoreProject(project) : setProjectToArchive(project);
                      }}
                      title={archived ? 'Kthe nga arkiva' : 'Arkivo projektin'}
                    >
                      {archived
                        ? <ArchiveRestore className="w-3.5 h-3.5" />
                        : <Archive className="w-3.5 h-3.5" />}
                    </Button>
                  )}
                  {permissions.canEdit && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive h-7 w-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={(e) => { e.stopPropagation(); setProjectToDelete({ id: project.id, name: project.name }); }}
                      title="Fshi projektin"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}

          {filteredProjects.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              {showArchive || filterStatus === 'Archived' ? (
                <>
                  <Archive className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>Arkiva është bosh</p>
                  <p className="text-xs mt-1">Arkivo një projekt për ta hequr nga lista pa fshirë të dhënat.</p>
                </>
              ) : (
                <>
                  <Folder className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>Asnjë projekt u gjet</p>
                </>
              )}
              {searchQuery && (
                <Button 
                  variant="link" 
                  className="mt-2"
                  onClick={() => setSearchQuery('')}
                >
                  Pastro kërkimin
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Results Count */}
      <div className="text-sm text-muted-foreground">
        {filteredProjects.length} projekt{filteredProjects.length !== 1 ? 'e' : ''}
        {(showArchive || filterStatus === 'Archived') && ' në arkivë'}
      </div>

      {/* Archive Project Confirmation — reversible, so it explains rather than warns */}
      <Dialog open={!!projectToArchive} onOpenChange={(open) => { if (!open) setProjectToArchive(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Arkivo Projektin</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Arkivo projektin <span className="font-semibold">"{projectToArchive?.name}"</span>?
          </p>
          {projectToArchive && (
            <ul className="space-y-1 text-xs text-muted-foreground list-disc pl-4">
              {archiveConsequences(projectToArchive).map(line => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setProjectToArchive(null)}>Anulo</Button>
            <Button onClick={() => projectToArchive && handleArchiveProject(projectToArchive)}>
              <Archive className="w-4 h-4 mr-2" />
              Arkivo
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Project Confirmation */}
      <Dialog open={!!projectToDelete} onOpenChange={(open) => { if (!open) setProjectToDelete(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Fshi Projektin</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Je i sigurt që dëshiron të fshish projektin <span className="font-semibold">"{projectToDelete?.name}"</span>? Të gjitha detyrat e lidhura do të fshihen gjithashtu.</p>
          {(() => {
            if (!projectToDelete) return null;
            const linked = (allInvoices || []).filter(i => i.projectId === projectToDelete.id);
            const drafts = linked.filter(i => i.status === 'Draft' && (i as any).autoGenerated).length;
            const kept = linked.length - drafts;
            if (!linked.length) return null;
            return (
              <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-2.5 text-xs space-y-1">
                <p className="font-medium text-amber-900 dark:text-amber-200">Faturat e lidhura</p>
                {kept > 0 && <p className="text-amber-800 dark:text-amber-300">{kept} faturë të lëshuara <strong>nuk fshihen</strong> — do të shkëputen nga projekti dhe mbeten në kontabilitet.</p>}
                {drafts > 0 && <p className="text-amber-800 dark:text-amber-300">{drafts} faturë draft automatike (të padërguara) do të fshihen.</p>}
              </div>
            );
          })()}
          {/* Deleting is the irreversible option — offer the reversible one here. */}
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-md border p-2.5 text-left text-xs text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
            onClick={() => {
              const target = (projects || []).find(p => p.id === projectToDelete?.id);
              setProjectToDelete(null);
              if (target) setProjectToArchive(target);
            }}
          >
            <Archive className="w-4 h-4 shrink-0" />
            <span><strong>Arkivoje</strong> në vend të fshirjes — hiqet nga lista, të dhënat ruhen.</span>
          </button>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setProjectToDelete(null)}>Anulo</Button>
            <Button variant="destructive" onClick={() => projectToDelete && handleDeleteProject(projectToDelete.id, projectToDelete.name)}>Fshi</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Project Dialog */}
      <Dialog open={!!projectToEdit} onOpenChange={(open) => { if (!open) setProjectToEdit(null); }}>
        <DialogContent className="w-full max-w-full sm:max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Modifiko Projektin</DialogTitle>
          </DialogHeader>
          {projectToEdit && (
            <ProjectForm
              key={projectToEdit.id}
              onSubmit={handleEditProject}
              teams={teams || []}
              customers={customers || []}
              teamMembers={formTeamMembers}
              services={services || []}
              initialData={projectToEdit}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

// Project Form Component
const ProjectForm: React.FC<{
  onSubmit: (data: FormData) => void;
  teams: Team[];
  customers?: Customer[];
  teamMembers?: import('../types').TeamMember[];
  services?: Service[];
  initialData?: Project;
}> = ({ onSubmit, teams, customers, teamMembers, services, initialData }) => {
  const permissions = usePermissions();
  const canSeeBudget = canSeeFinancials(permissions);
  const [teamId, setTeamId] = useState(initialData?.teamId || '__none__');
  const [custId, setCustId] = useState((initialData as any)?.customerId || '__none__');
  const [responsibleUserId, setResponsibleUserId] = useState(initialData?.responsibleUserId || '__none__');
  const [isRecurring, setIsRecurring] = useState(initialData?.isRecurring || false);
  const [recurringFrequency, setRecurringFrequency] = useState(initialData?.recurringFrequency || 'monthly');
  const [isRecurringPaused, setIsRecurringPaused] = useState(!!(initialData as any)?.isRecurringPaused);
  // WORK cycle (tasks) — independent of the billing cycle below.
  const [workCycle, setWorkCycle] = useState<'none' | 'weekly' | 'monthly'>(() => initialWorkCycle(initialData));
  // Quarterly / yearly: monthly fee × months − prepay discount, anchored on the
  // contract's start month (projectBillingForm.ts).
  const [monthlyFeeInput, setMonthlyFeeInput] = useState<string>(() => initialMonthlyFee(initialData));
  const [prepayDiscountInput, setPrepayDiscountInput] = useState<string>(
    initialData?.prepayDiscountPct != null ? String(initialData.prepayDiscountPct) : '',
  );
  const [anchorMonthInput, setAnchorMonthInput] = useState<string>('');
  const [invoiceDueDaysInput, setInvoiceDueDaysInput] = useState<string>(
    initialData?.invoiceDueDays != null ? String(initialData.invoiceDueDays) : '',
  );
  const [recurringEndInput, setRecurringEndInput] = useState(() => {
    const d = (initialData as any)?.recurringEndDate ? new Date((initialData as any).recurringEndDate) : null;
    return d && !isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : '';
  });
  const [memberUserIds, setMemberUserIds] = useState<string[]>(initialData?.memberUserIds || []);
  // Preloaded from the record: the edit path now writes this list back verbatim
  // (an emptied list CLEARS serviceIds), so starting from [] would wipe the
  // project's services on every edit.
  const initialServiceIds = React.useMemo<string[]>(
    () => (Array.isArray((initialData as any)?.serviceIds) ? (initialData as any).serviceIds : []),
    [initialData],
  );
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>(initialServiceIds);
  const [budgetInput, setBudgetInput] = useState(initialData?.budget ? String(initialData.budget) : '');
  const [currency, setCurrency] = useState<'ALL' | 'EUR'>((initialData as any)?.currency === 'EUR' ? 'EUR' : 'ALL');
  const [billingType, setBillingType] = useState<'one-time' | 'monthly'>(
    initialData?.billingType || (initialData?.isRecurring ? 'monthly' : 'one-time'),
  );
  const [startDateInput, setStartDateInput] = useState(() => {
    const d = initialData?.startDate ? new Date(initialData.startDate as any) : null;
    return d && !isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : '';
  });
  const [department, setDepartment] = useState<string>(initialData?.department || '__none__');
  const [billingDayOfMonth, setBillingDayOfMonth] = useState<string>(
    initialData?.billingDayOfMonth ? String(initialData.billingDayOfMonth) : '',
  );
  const [serviceCategory, setServiceCategory] = useState<string>('__all__');
  // Explicit split of the fee across service lines (SEO 40 / Ads 60) — what the
  // department P&L and the invoice lines use. Empty = derived from the services.
  const [serviceMixRows, setServiceMixRows] = useState<Array<{ line: string; pct: string }>>(
    () => ((initialData as any)?.serviceMix || []).map((r: { line: string; pct: number }) => ({ line: r.line, pct: String(r.pct) })),
  );
  const { getName } = useUserNames(teamMembers || []);

  // ── Staffing budget, engagement end, recognition (client profitability) ──
  const [endDateInput, setEndDateInput] = useState(() => {
    const d = (initialData as any)?.endDate ? new Date((initialData as any).endDate) : null;
    return d && !isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : '';
  });
  const [recognitionMethod, setRecognitionMethod] = useState<string>((initialData as any)?.recognitionMethod || '__auto__');
  const [plannedRoles, setPlannedRoles] = useState<import('../types').ProjectPlannedRole[]>(
    () => normalizePlannedRoles((initialData as any)?.plannedRoles || []),
  );
  const [plannedDirectExpenses, setPlannedDirectExpenses] = useState<string>(
    (initialData as any)?.plannedDirectExpenses ? String((initialData as any).plannedDirectExpenses) : '',
  );
  const [targetMarginPct, setTargetMarginPct] = useState<string>(
    (initialData as any)?.targetMarginPct ? String((initialData as any).targetMarginPct) : '',
  );
  const tenantSettings = useTeamSettingsData();
  const financeSettings = React.useMemo(() => resolveFinanceSettings(tenantSettings?.financeSettings), [tenantSettings?.financeSettings]);
  // Rates come from the pay records (teamMemberComp), which the budget editor may read
  // because it is only rendered for canSeeBudget (Manager/Admin).
  const { members: compMembers } = useMemberCompensation(teamMembers, { skip: !canSeeBudget });
  const rateCard = React.useMemo(
    () => buildRateCard(compMembers, financeSettings, new Date(), tenantSettings?.rateCard),
    [compMembers, financeSettings, tenantSettings?.rateCard],
  );

  const serviceCategories = React.useMemo(() => {
    if (!services) return [];
    const cats = [...new Set(services.map(s => s.category).filter(Boolean))] as string[];
    return cats.sort();
  }, [services]);

  const filteredServices = React.useMemo(() => {
    if (!services) return [];
    if (serviceCategory === '__all__') return services;
    return services.filter(s => s.category === serviceCategory);
  }, [services, serviceCategory]);

  // Catalogue total of the picked services, each converted into the PROJECT's
  // currency (a €500 service on an ALL project is not 500 L).
  const servicesTotal = React.useMemo(
    () => servicesTotalIn(services as any, selectedServiceIds, currency),
    [services, selectedServiceIds, currency],
  );
  // On CREATE the total always sets the budget (a Member/Sales who cannot see the
  // field would otherwise save 0 and the recurring cron would bill 0). On EDIT it
  // REPLACES the budget only for someone who may see the budget, and only when they
  // changed the selection — an untouched edit keeps the negotiated fee.
  const isCreate = !initialData;
  const serviceBudget = React.useMemo(
    () => serviceBudgetOverride({
      canSeeBudget, services: services as any, selectedIds: selectedServiceIds,
      initialIds: initialServiceIds, currency, isCreate,
    }),
    [canSeeBudget, services, selectedServiceIds, initialServiceIds, currency, isCreate],
  );

  // Quarterly / yearly retainer: the cycle fee is DERIVED from the monthly fee.
  // A Member editing (no budget field) never re-derives it — the rules refuse a
  // money change from them, and a rounding difference would read as one.
  const anchoredBilling = isRecurring && isAnchoredFrequency(recurringFrequency);
  const cycleMonths = cycleMonthsFor(recurringFrequency);
  const monthlyFeeSource = serviceBudget !== null ? serviceBudget : parseMoneyInput(monthlyFeeInput);
  const cycleBudget = anchoredBilling && (canSeeBudget || isCreate)
    ? cycleBudgetFromForm(recurringFrequency, monthlyFeeSource, parsePctInput(prepayDiscountInput))
    : null;
  const effectiveAnchorMonth = anchorMonthInput || defaultAnchorMonth(initialData, startDateInput);
  const cycleNoun = recurringFrequency === 'yearly' ? 'vit' : 'tremujor';

  // What the split would be WITHOUT explicit rows — shown as the placeholder, so
  // the owner sees what "automatik" means before overriding it.
  const derivedMix = React.useMemo(() => {
    const dept = department !== '__none__' ? department : undefined;
    return projectServiceMix(
      { id: 'draft', serviceIds: selectedServiceIds, department: dept } as Project,
      new Map((services || []).map(s => [s.id, s])),
      labelerFor(services, []),
    );
  }, [selectedServiceIds, department, services]);
  const serviceMixTotal = serviceMixRows.reduce((t, r) => t + (parseFloat(r.pct) || 0), 0);
  const serviceMixLineOptions = React.useMemo(
    () => [...new Set([...serviceCategories, ...serviceMixRows.map(r => r.line).filter(Boolean)])],
    [serviceCategories, serviceMixRows],
  );

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    if (teamId && teamId !== '__none__') {
      formData.set('teamId', teamId);
    }
    if (custId && custId !== '__none__') {
      formData.set('customerId', custId);
    }
    if (responsibleUserId && responsibleUserId !== '__none__') {
      formData.set('responsibleUserId', responsibleUserId);
    }
    formData.set('isRecurring', isRecurring ? 'true' : 'false');
    if (isRecurring) formData.set('recurringFrequency', recurringFrequency);
    formData.set('workCycle', workCycle);
    if (isRecurring) formData.set('invoiceDueDays', invoiceDueDaysInput);
    if (anchoredBilling) {
      formData.set('billingAnchorMonth', effectiveAnchorMonth);
      if (monthlyFeeSource !== null) formData.set('listMonthlyFee', String(monthlyFeeSource));
      formData.set('prepayDiscountPct', prepayDiscountInput);
    }
    formData.set('isRecurringPaused', isRecurring && isRecurringPaused ? 'true' : 'false');
    if (isRecurring && recurringEndInput) formData.set('recurringEndDate', recurringEndInput);
    formData.set('billingType', billingType);
    if (startDateInput) formData.set('startDate', startDateInput);
    if (department && department !== '__none__') formData.set('department', department);
    if (billingDayOfMonth) formData.set('billingDayOfMonth', billingDayOfMonth);
    formData.set('memberUserIds', JSON.stringify(memberUserIds));
    formData.set('selectedServiceIds', JSON.stringify(selectedServiceIds));
    if (canSeeBudget) {
      formData.set('serviceMix', JSON.stringify(serviceMixRows.map(r => ({ line: r.line, pct: parseFloat(r.pct) }))));
    }
    if (endDateInput) formData.set('endDate', endDateInput);
    if (billingType === 'one-time' && recognitionMethod !== '__auto__') formData.set('recognitionMethod', recognitionMethod);
    formData.set('plannedRoles', JSON.stringify(normalizePlannedRoles(plannedRoles)));
    if (plannedDirectExpenses) formData.set('plannedDirectExpenses', plannedDirectExpenses);
    if (targetMarginPct) formData.set('targetMarginPct', targetMarginPct);
    // Override budget with the computed service total — only when serviceBudgetOverride
    // allows it (create, or canSeeBudget AND the selection changed); otherwise the budget field
    // (or the hidden one for users who cannot see it) is sent as it is.
    if (serviceBudget !== null) {
      formData.set('budget', String(serviceBudget));
    }
    // Long cycle: the budget is the whole quarter / year (monthly × months − discount).
    if (cycleBudget !== null) {
      formData.set('budget', String(cycleBudget));
    }
    onSubmit(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <Label htmlFor="name">Emri i Projektit</Label>
        <Input id="name" name="name" required defaultValue={initialData?.name} placeholder="p.sh. Website Redesign" />
      </div>

      <div>
        <Label htmlFor="description">Përshkrimi</Label>
        <Textarea id="description" name="description" defaultValue={initialData?.description} placeholder="Përshkruaj projektin..." rows={3} />
      </div>

      <div>
        <Label htmlFor="status">Statusi</Label>
        <Select name="status" defaultValue={initialData?.status || 'Planning'}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="Planning">Planifikim</SelectItem>
            <SelectItem value="Active">Aktiv</SelectItem>
            <SelectItem value="In Review">Nën Vlerësim</SelectItem>
            <SelectItem value="On Hold">Në pritje</SelectItem>
            <SelectItem value="Completed">Përfunduar</SelectItem>
            <SelectItem value="Archived">Arkivuar</SelectItem>
            <SelectItem value="Cancelled">Anuluar</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label htmlFor="teamId">Ekipi</Label>
        <Select value={teamId} onValueChange={setTeamId}>
          <SelectTrigger>
            <SelectValue placeholder="Zgjidh ekipin" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">Asnjë ekip</SelectItem>
            {teams.map(team => (
              <SelectItem key={team.id} value={team.id}>{team.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Customer */}
      <div>
        <Label htmlFor="customerId">Klienti</Label>
        <Select value={custId} onValueChange={setCustId}>
          <SelectTrigger>
            <SelectValue placeholder="Zgjidh klientin" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">Asnjë klient</SelectItem>
            {customers?.map(c => (
              <SelectItem key={c.id} value={c.id}>{c.name} {c.company && `(${c.company})`}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Services → Budget */}
      {services && services.length > 0 && (
        <div>
          <Label>Shërbimet e Projektit</Label>
          <p className="text-xs text-muted-foreground mb-2">Zgjidh kategorinë dhe mëpas shërbimet — totali llogaritet automatikisht si buxhet</p>

          {/* Category filter pills */}
          {serviceCategories.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              <button
                type="button"
                onClick={() => setServiceCategory('__all__')}
                className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                  serviceCategory === '__all__'
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-muted text-muted-foreground border-border hover:bg-muted/70'
                }`}
              >
                Të gjitha
              </button>
              {serviceCategories.map(cat => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setServiceCategory(cat)}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                    serviceCategory === cat
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-muted text-muted-foreground border-border hover:bg-muted/70'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          )}

          {/* Services list filtered by category */}
          <div className="space-y-1.5 max-h-44 overflow-y-auto border rounded-md p-2">
            {filteredServices.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2 text-center">Nuk ka shërbime në këtë kategori</p>
            ) : filteredServices.map(s => (
              <label key={s.id} className="flex items-center gap-2 cursor-pointer hover:bg-muted/50 px-2 py-1 rounded">
                <input
                  type="checkbox"
                  className="w-4 h-4 accent-primary"
                  checked={selectedServiceIds.includes(s.id)}
                  onChange={(e) => {
                    setSelectedServiceIds(prev =>
                      e.target.checked ? [...prev, s.id] : prev.filter(id => id !== s.id)
                    );
                  }}
                />
                <div className="flex-1 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <span className="text-sm font-medium">{s.name || s.title}</span>
                    {s.category && serviceCategory === '__all__' && (
                      <span className="ml-1.5 text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{s.category}</span>
                    )}
                  </div>
                  <span className="text-sm text-primary font-medium shrink-0">{(s.price || 0).toLocaleString()} {currencySymbol(s.currency)}</span>
                </div>
              </label>
            ))}
          </div>

          {selectedServiceIds.length > 0 && (
            <p className="text-xs text-primary font-medium mt-1">
              {selectedServiceIds.length} shërbim{selectedServiceIds.length !== 1 ? 'e' : ''} zgjedhur · Total: {servicesTotal?.toLocaleString()} {currencySymbol(currency)}
              {canSeeBudget && serviceBudget === null && servicesTotal !== null && initialData && (
                <span className="text-muted-foreground font-normal"> · buxheti mbetet siç është (shërbimet s'u ndryshuan)</span>
              )}
            </p>
          )}
        </div>
      )}

      {/* Budget + currency — vetëm Manager/Admin/SuperAdmin. Të tjerët s'e shohin;
          input-et e fshehura ruajnë vlerat ekzistuese që editimi të mos i fshijë. */}
      {!canSeeBudget ? (
        <>
          <input type="hidden" name="budget" value={initialData?.budget != null ? String(initialData.budget) : ''} />
          <input type="hidden" name="currency" value={(initialData as any)?.currency || 'ALL'} />
        </>
      ) : anchoredBilling ? (
      <div className="space-y-2">
        <Label htmlFor="monthlyFee">Tarifa mujore</Label>
        <div className="flex gap-2">
          <Input
            id="monthlyFee"
            type="number"
            step="0.01"
            min="0"
            value={serviceBudget !== null ? String(serviceBudget) : monthlyFeeInput}
            onChange={serviceBudget !== null ? undefined : (e) => setMonthlyFeeInput(e.target.value)}
            readOnly={serviceBudget !== null}
            placeholder="0.00"
            className={`flex-1 ${serviceBudget !== null ? 'bg-muted cursor-not-allowed' : ''}`}
          />
          <input type="hidden" name="budget" value={cycleBudget !== null ? String(cycleBudget) : (initialData?.budget != null ? String(initialData.budget) : '')} />
          <input type="hidden" name="currency" value={currency} />
          <Select value={currency} onValueChange={(v) => setCurrency(v as 'ALL' | 'EUR')}>
            <SelectTrigger className="w-28 shrink-0"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">L (Lekë)</SelectItem>
              <SelectItem value="EUR">€ (Euro)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-2 items-end">
          <div>
            <Label htmlFor="prepayDiscount">Zbritje për pagesë përpara (%)</Label>
            <Input
              id="prepayDiscount"
              type="number"
              step="0.1"
              min="0"
              max="100"
              value={prepayDiscountInput}
              onChange={(e) => setPrepayDiscountInput(e.target.value)}
              placeholder="p.sh. 10"
            />
          </div>
          <div className="rounded-lg bg-muted/40 px-3 py-2 text-sm">
            <p className="text-xs text-muted-foreground">Fatura për {cycleNoun}</p>
            <p className="font-semibold tabular-nums">
              {cycleBudget !== null ? `${cycleBudget.toLocaleString('sq-AL')} ${currencySymbol(currency)}` : '—'}
            </p>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Tarifa mujore × {cycleMonths} muaj − zbritja. Fatura del një herë në {cycleNoun}; fitimi njihet 1/{cycleMonths} çdo muaj,
          pjesa tjetër shfaqet si “paguar përpara”.
        </p>
      </div>
      ) : (
      <div>
        <Label htmlFor="budget">Buxheti / Të Ardhurat e Projektit</Label>
        <div className="flex gap-2">
          <Input
            id="budget"
            name="budget"
            type="number"
            step="0.01"
            min="0"
            value={serviceBudget !== null ? String(serviceBudget) : budgetInput}
            onChange={serviceBudget !== null ? undefined : (e) => setBudgetInput(e.target.value)}
            placeholder="0.00"
            readOnly={serviceBudget !== null}
            className={`flex-1 ${serviceBudget !== null ? 'bg-muted cursor-not-allowed' : ''}`}
          />
          <input type="hidden" name="currency" value={currency} />
          <Select value={currency} onValueChange={(v) => setCurrency(v as 'ALL' | 'EUR')}>
            <SelectTrigger className="w-28 shrink-0"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">L (Lekë)</SelectItem>
              <SelectItem value="EUR">€ (Euro)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          {serviceBudget !== null ? 'Llogaritet automatikisht nga shërbimet e zgjedhura' : 'Shuma që projekti gjeneron si të ardhura'}
        </p>
      </div>
      )}

      {/* Billing type — how the budget above is read in the P&L */}
      <div>
        <Label htmlFor="billingType">Lloji i faturimit</Label>
        <Select value={billingType} onValueChange={(v) => setBillingType(v as 'one-time' | 'monthly')}>
          <SelectTrigger id="billingType">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="one-time">Njëherëshe (vlerë totale)</SelectItem>
            <SelectItem value="monthly">Periodike (tarifë çdo cikël)</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground mt-1">
          {billingType === 'monthly'
            ? (anchoredBilling
              ? `Tarifa e ciklit (${cycleNoun}) faturohet përpara; fitimi njihet çdo muaj (1/${cycleMonths}).`
              : 'Buxheti lart është tarifë mujore — fitimi shumëzon me muajt që projekti ka qenë aktiv.')
            : 'Buxheti lart është vlerë totale njëherëshe (p.sh. ndërtim web, branding).'}
        </p>
      </div>

      {/* Start date — used by the next-month forecast for one-time projects */}
      <div>
        <Label htmlFor="startDate">Data e fillimit</Label>
        <Input
          id="startDate"
          name="startDate"
          type="date"
          value={startDateInput}
          onChange={(e) => setStartDateInput(e.target.value)}
        />
        <p className="text-xs text-muted-foreground mt-1">
          {billingType === 'one-time'
            ? 'Nëse projekti fillon muajin që vjen, buxheti hyn te "Fitimi i parashikuar".'
            : 'Opsionale — kur nisi/do nisë projekti.'}
        </p>
      </div>

      {/* End date + how the fee becomes EARNED revenue over time (revenueRecognition.ts) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <Label htmlFor="endDate">Data e mbarimit</Label>
          <Input id="endDate" type="date" value={endDateInput} onChange={(e) => setEndDateInput(e.target.value)} />
          <p className="text-xs text-muted-foreground mt-1">Fundi i angazhimit — kufiri tjetër i njohjes lineare.</p>
        </div>
        {billingType === 'one-time' && canSeeBudget && (
          <div>
            <Label htmlFor="recognitionMethod">Si fitohen të ardhurat</Label>
            <Select value={recognitionMethod} onValueChange={setRecognitionMethod}>
              <SelectTrigger id="recognitionMethod"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__auto__">Automatik (sipas të dhënave)</SelectItem>
                <SelectItem value="effort">Sipas punës së kryer (orë / orë të planifikuara)</SelectItem>
                <SelectItem value="straight-line">Lineare nga fillimi te mbarimi</SelectItem>
                <SelectItem value="on-completion">Në muajin e mbylljes</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">
              Automatik: me buxhet orësh → sipas punës; me datë fillimi+mbarimi → lineare; ndryshe në mbyllje.
            </p>
          </div>
        )}
      </div>

      {canSeeBudget && (
        <PlannedRolesEditor
          value={plannedRoles}
          onChange={setPlannedRoles}
          rateCard={rateCard}
          members={compMembers}
          settings={financeSettings}
          contractValueAll={(() => {
            // A retainer's plan is priced against its MONTHLY fee (weekly × 52/12),
            // the same figure plannedEconomics / the engines use.
            const fee = parseFloat(serviceBudget !== null ? String(serviceBudget) : budgetInput) || 0;
            const monthly = billingType === 'monthly' ? monthlyFeeOf({ budget: fee, recurringFrequency } as any) : fee;
            return toAll(monthly, currency);
          })()}
          directExpenses={plannedDirectExpenses}
          onDirectExpensesChange={setPlannedDirectExpenses}
          targetMarginPct={targetMarginPct}
          onTargetMarginChange={setTargetMarginPct}
        />
      )}

      {/* Department / service line — groups profit in the Department P&L */}
      <div>
        <Label htmlFor="department">Departamenti (service line)</Label>
        <Select value={department} onValueChange={setDepartment}>
          <SelectTrigger id="department">
            <SelectValue placeholder="Zgjidh departamentin" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">Pa departament</SelectItem>
            {serviceCategories.map((c: string) => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground mt-1">
          P.sh. Social, SEO, Web — përdoret te "Fitimi sipas departamentit" për të parë sa fiton nga secili.
        </p>
      </div>

      {/* Split across service lines — one project, several departments */}
      {canSeeBudget && serviceMixLineOptions.length > 0 && (
        <div>
          <Label>Ndarja sipas shërbimit</Label>
          <p className="text-xs text-muted-foreground mb-2">
            Kur projekti ka disa shërbime (p.sh. SEO + Ads), secili departament merr pjesën e vet
            të të ardhurave dhe të kostove. Bosh = automatik
            {derivedMix.length > 0 && (
              <> ({derivedMix.map(m => `${m.line} ${Math.round(m.weight * 100)}%`).join(' · ')})</>
            )}.
          </p>
          <div className="space-y-2">
            {serviceMixRows.map((row, i) => (
              <div key={i} className="flex items-center gap-2">
                <Select
                  value={row.line || undefined}
                  onValueChange={(v) => setServiceMixRows(rows => rows.map((r, j) => (j === i ? { ...r, line: v } : r)))}
                >
                  <SelectTrigger className="flex-1" aria-label="Linja e shërbimit">
                    <SelectValue placeholder="Zgjidh shërbimin" />
                  </SelectTrigger>
                  <SelectContent>
                    {serviceMixLineOptions.map(c => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="relative w-24 shrink-0">
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    inputMode="decimal"
                    aria-label="Përqindja"
                    value={row.pct}
                    onChange={(e) => setServiceMixRows(rows => rows.map((r, j) => (j === i ? { ...r, pct: e.target.value } : r)))}
                    className="pr-6 text-base sm:text-sm"
                  />
                  <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Hiq rreshtin"
                  onClick={() => setServiceMixRows(rows => rows.filter((_, j) => j !== i))}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
          <div className="mt-2 flex items-center justify-between gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setServiceMixRows(rows => (rows.length === 0 && derivedMix.length > 1
                // Start from the automatic split, so the owner adjusts rather than retypes.
                ? derivedMix.map(m => ({ line: m.line, pct: String(Math.round(m.weight * 100)) }))
                : [...rows, { line: '', pct: '' }]))}
            >
              <Plus className="mr-1 h-3.5 w-3.5" /> Shto ndarje
            </Button>
            {serviceMixRows.length > 0 && (
              <span className={`text-xs font-medium ${Math.round(serviceMixTotal) === 100 ? 'text-muted-foreground' : 'text-amber-600'}`}>
                Totali {Math.round(serviceMixTotal * 100) / 100}%
                {Math.round(serviceMixTotal) !== 100 && ' — do të përshtatet në 100%'}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Billing day — only meaningful for a MONTHLY recurring retainer */}
      {billingType === 'monthly' && (!isRecurring || recurringFrequency !== 'weekly') && (
        <div>
          <Label htmlFor="billingDayOfMonth">{anchoredBilling ? 'Dita e faturimit (në muajin e nisjes)' : 'Dita e faturimit (çdo muaj)'}</Label>
          <Input
            id="billingDayOfMonth"
            name="billingDayOfMonth"
            type="number"
            min="1"
            max="31"
            value={billingDayOfMonth}
            onChange={(e) => setBillingDayOfMonth(e.target.value)}
            placeholder="p.sh. 25"
          />
          <p className="text-xs text-muted-foreground mt-1">
            {anchoredBilling
              ? 'Fatura e ciklit gjenerohet në këtë ditë të muajit të parë të ciklit. Bosh = në fillim të muajit.'
              : 'Fatura mujore gjenerohet në këtë ditë (p.sh. 25). Bosh = në fillim të muajit.'}
            Në muajt më të shkurtër zbret te dita e fundit (p.sh. 31 → 28 Shkurt).
          </p>
        </div>
      )}

      {/* Responsible Person */}
      {teamMembers && teamMembers.length > 0 && (
        <div>
          <Label htmlFor="responsibleUserId">Përgjegjësi i Projektit</Label>
          <Select value={responsibleUserId} onValueChange={setResponsibleUserId}>
            <SelectTrigger>
              <SelectValue placeholder="Zgjidh punonjësin" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">Asnjë i caktuar</SelectItem>
              {teamMembers.map(m => (
                <SelectItem key={m.id} value={m.userId}>
                  {getName(m.userId)} ({m.role})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground mt-1">Punonjësi që merr kredit për këtë projekt në llogaritjen e bonusit</p>
        </div>
      )}

      {/* Project Members */}
      {teamMembers && teamMembers.length > 0 && (
        <div>
          <Label>Anëtarët e Projektit</Label>
          <p className="text-xs text-muted-foreground mb-2">Zgjidh personat që do të marrin pjesë në këtë projekt</p>
          <div className="space-y-2 max-h-48 overflow-y-auto border rounded-md p-2">
            {teamMembers.map(m => (
              <label key={m.id} className="flex items-center gap-2 cursor-pointer hover:bg-muted/50 px-2 py-1 rounded">
                <input
                  type="checkbox"
                  className="w-4 h-4 accent-primary"
                  checked={memberUserIds.includes(m.userId)}
                  onChange={(e) => {
                    setMemberUserIds(prev =>
                      e.target.checked ? [...prev, m.userId] : prev.filter(id => id !== m.userId)
                    );
                  }}
                />
                <div className="flex items-center gap-2 flex-1">
                  <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-xs font-medium text-primary">
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
          {memberUserIds.length > 0 && (
            <p className="text-xs text-primary mt-1">{memberUserIds.length} person{memberUserIds.length !== 1 ? 'a' : ''} të zgjedhur</p>
          )}
        </div>
      )}

      {/* WORK cycle — the tasks; independent of billing (projectCycles.ts) */}
      <div>
        <Label htmlFor="workCycle">Cikli i punës (detyrat)</Label>
        <Select value={workCycle} onValueChange={(v) => setWorkCycle(v as 'none' | 'weekly' | 'monthly')}>
          <SelectTrigger id="workCycle"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Pa cikël (projekt i vetëm)</SelectItem>
            <SelectItem value="monthly">Çdo muaj</SelectItem>
            <SelectItem value="weekly">Çdo javë</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground mt-1">
          {workCycle === 'none'
            ? 'Detyrat bëhen një herë.'
            : `Në fillim të çdo ${workCycle === 'weekly' ? 'jave' : 'muaji'} detyrat e kryera rihapen; të papërfunduarat mbarten te cikli i ri me shënimin “mbartur”. I pavarur nga faturimi.`}
        </p>
        {initialData && (initialData as any).workCycleLastBlock && workCycle !== 'none' && (
          <p className="text-xs text-muted-foreground mt-1">Kontrolli i fundit: {workCycleBlockLabel((initialData as any).workCycleLastBlock)}</p>
        )}
      </div>

      {/* Recurring BILLING */}
      <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-muted/40">
        <div>
          <p className="text-sm font-medium">Faturim periodik</p>
          <p className="text-xs text-muted-foreground">Fatura krijohet automatikisht çdo cikël (javë / muaj / tremujor / vit)</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={isRecurring}
          onClick={() => {
            const next = !isRecurring;
            setIsRecurring(next);
            // "Periodik" + "faturim një-herësh" is a contradiction: the fee would be
            // either billed once for an endless engagement, or a single deal value
            // multiplied every cycle. Automatic billing refuses that combination, so
            // keep the two settings consistent here instead of failing silently later.
            if (next && billingType === 'one-time') setBillingType('monthly');
            // A new retainer usually repeats its work too — suggest it, never force it.
            if (next && isCreate && workCycle === 'none') setWorkCycle(recurringFrequency === 'weekly' ? 'weekly' : 'monthly');
          }}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
            isRecurring ? 'bg-primary' : 'bg-muted-foreground/30'
          }`}
        >
          <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
            isRecurring ? 'translate-x-4' : 'translate-x-1'
          }`} />
        </button>
      </div>

      {isRecurring && (
        <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-muted/40">
          <div>
            <p className="text-sm font-medium">{isRecurringPaused ? '⏸ Faturimi në pauzë' : '▶ Faturimi aktiv'}</p>
            <p className="text-xs text-muted-foreground">
              {isRecurringPaused
                ? 'Nuk gjenerohet asnjë faturë derisa ta rifillosh — seria ruhet.'
                : 'Fatura gjenerohet automatikisht çdo periudhë.'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setIsRecurringPaused(v => !v)}
            className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${isRecurringPaused ? 'bg-amber-100 text-amber-700 hover:bg-amber-200' : 'bg-green-100 text-green-700 hover:bg-green-200'}`}
          >
            {isRecurringPaused ? 'Rifillo' : 'Pauzo'}
          </button>
        </div>
      )}

      {isRecurring && (
        <div>
          <Label htmlFor="recurringEndInput">Fatura deri më (opsionale)</Label>
          <Input
            id="recurringEndInput"
            type="date"
            value={recurringEndInput}
            onChange={(e) => setRecurringEndInput(e.target.value)}
          />
          <p className="text-xs text-muted-foreground mt-1">
            Pas kësaj date seria mbyllet vetë — asnjë faturë e re, të lëshuarat mbeten. Bosh = pa fund.
          </p>
        </div>
      )}

      {isRecurring && (
        <div>
          <Label>Cikli i faturimit</Label>
          <Select
            value={recurringFrequency}
            onValueChange={(v) => {
              // Switching between monthly and a long cycle keeps the MONTHLY price:
              // the long-cycle editor starts from the monthly fee being replaced.
              if (isAnchoredFrequency(v) && !isAnchoredFrequency(recurringFrequency)) {
                setMonthlyFeeInput(serviceBudget !== null ? String(serviceBudget) : budgetInput);
              }
              if (!isAnchoredFrequency(v) && isAnchoredFrequency(recurringFrequency) && monthlyFeeSource !== null) {
                setBudgetInput(String(monthlyFeeSource));
              }
              setRecurringFrequency(v as any);
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="weekly">Javore (çdo javë)</SelectItem>
              <SelectItem value="monthly">Mujore (çdo muaj)</SelectItem>
              <SelectItem value="quarterly">Tremujore (çdo 3 muaj)</SelectItem>
              <SelectItem value="yearly">Vjetore (një herë në vit)</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground mt-1">
            {anchoredBilling
              ? `Fatura del në muajin e nisjes së kontratës dhe përsëritet çdo ${recurringFrequency === 'yearly' ? '12' : '3'} muaj. Puna ndjek “Ciklin e punës” më lart.`
              : 'Sa shpesh faturohet klienti. Puna ndjek “Ciklin e punës” më lart.'}
          </p>
          {anchoredBilling && (
            <div className="mt-2">
              <Label htmlFor="billingAnchorMonth">Muaji i nisjes së kontratës</Label>
              <Input
                id="billingAnchorMonth"
                type="month"
                value={effectiveAnchorMonth}
                onChange={(e) => setAnchorMonthInput(e.target.value)}
              />
            </div>
          )}
          <div className="mt-2">
            <Label htmlFor="invoiceDueDays">Afati i pagesës (ditë)</Label>
            <Input
              id="invoiceDueDays"
              type="number"
              min="0"
              max="120"
              value={invoiceDueDaysInput}
              onChange={(e) => setInvoiceDueDaysInput(e.target.value)}
              placeholder={anchoredBilling ? '15' : 'fundi i periudhës'}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Ditë nga lëshimi i faturës. Bosh = {anchoredBilling ? '15 ditë' : 'fundi i periudhës'}.
            </p>
          </div>
          {billingType === 'one-time' && (
            <p className="text-xs text-amber-600 mt-1">
              ⚠ Lloji i faturimit është “një-herësh”, ndaj faturimi automatik periodik NUK do të gjenerojë fatura. Zgjidh “mujore” për të faturuar çdo cikël.
            </p>
          )}
        </div>
      )}

      <Button type="submit" className="w-full">
        {initialData ? 'Ruaj Ndryshimet' : 'Krijo Projektin'}
      </Button>
    </form>
  );
};

export default ProjectsView;
