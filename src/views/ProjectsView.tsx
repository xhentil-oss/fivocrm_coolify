import React, { useState, useMemo } from 'react';
import { useToast } from '../hooks/use-toast';
import { useNavigate } from 'react-router-dom';
import { useCollection, useMutation, useGlobalBusinessId } from '../hooks/useFirestore';
import { getNextInvoiceNumber, db } from '../lib/firebase';
import { collection, deleteDoc, getDocs, query, updateDoc, where } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../contexts/PermissionsContext';
import { canSeeFinancials, toAll, fromAll } from '../lib/utils';
import { projectBillingPeriodKey, projectBillingPeriodEnd } from '../lib/finance/recurringBilling';
import { archiveConsequences, archiveProjectPatch, isProjectArchived, restoreProjectPatch } from '../lib/projectArchive';
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

const ProjectsView: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const permissions = usePermissions();
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
    // Archived projects are out of the portfolio: their leftover overdue tasks
    // must not keep the "në rrezik" counter red forever.
    (projects || []).filter(p => !isProjectArchived(p)).forEach(p => {
      const ts = (allTasks || []).filter(t => (t as any).projectId === p.id);
      const total = ts.length;
      const done = ts.filter(t => t.status === 'Done').length;
      const overdue = ts.filter(t => t.status !== 'Done' && (t as any).endDate && new Date((t as any).endDate).getTime() < now).length;
      const pct = total ? Math.round((done / total) * 100) : 0;
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
    
    return filtered;
  }, [projects, searchQuery, filterOwner, filterTeam, filterStatus, filterMembers, filterMonthly, showArchive, teamMembers]);

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
    const billingType = formData.get('billingType') === 'monthly' ? 'monthly' : 'one-time';
    const startDateStr = formData.get('startDate') as string;
    const startDate = startDateStr ? new Date(startDateStr + 'T12:00:00') : undefined;
    const department = (formData.get('department') as string) || undefined;
    const billingDayRaw = formData.get('billingDayOfMonth') as string;
    const billingDayNum = billingDayRaw ? parseInt(billingDayRaw, 10) : NaN;
    const billingDayOfMonth = !isNaN(billingDayNum) && billingDayNum >= 1 && billingDayNum <= 31
      ? billingDayNum : undefined;
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
    const profitSplitStr = formData.get('profitSplit') as string;
    let profitSplit: Array<{ userId: string; percent: number }> | undefined;
    if (profitSplitStr) {
      try {
        const parsed = JSON.parse(profitSplitStr);
        profitSplit = Array.isArray(parsed) && parsed.length > 0 ? parsed : undefined;
      } catch { profitSplit = undefined; }
    }

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
      memberUserIds: memberUserIds && memberUserIds.length > 0 ? memberUserIds : undefined,
      serviceIds: selectedServiceIds && selectedServiceIds.length > 0 ? selectedServiceIds : undefined,
      profitSplit: profitSplit && profitSplit.length > 0 ? profitSplit : undefined,
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

    if (billableTotal > 0) {
    if (isRecurring) {
      // The recurrence is PROJECT-driven (cron `recurring-invoices` Part 2), so this
      // first invoice covers the current billing period and must record which one —
      // otherwise the cron bills the same period again and mails the client twice.
      const billingFrequency = recurringFrequency || 'monthly';
      const periodKey = projectBillingPeriodKey(billingFrequency, now);
      const periodEnd = projectBillingPeriodEnd(billingFrequency, now);
      const invoiceLabel = invoiceScopeId
        ? await getNextInvoiceNumber(invoiceScopeId, maxInvNum)
        : `AUTO-${periodKey}-${newProject.id.slice(0, 6).toUpperCase()}`;
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
        notes: `Faturë e gjeneruar automatikisht për projektin periodik "${name}".`,
        // Issue date: accrual revenue is recognised on invoiceDate; without it the
        // engines fall back to createdAt and the UI shows an empty "Data" column.
        invoiceDate: now,
        dueDate: periodEnd,
        // The PROJECT drives the cycle, not this invoice — flagging it isRecurring
        // too would make it look like a second, competing series.
        isRecurring: false,
        autoGenerated: true,
        billingPeriodKey: periodKey,
        emailSent: false,
        reminderSent: false,
        reminder25Sent: false,
        reminderLastDaySent: false,
      } as any);

      // Claim the period on the project (same token the cron writes).
      await projectMutation.update(newProject.id, {
        lastInvoicePeriodKey: periodKey,
        lastInvoiceGeneratedAt: now,
      } as any);

      // Create invoiceItems for selected services. When the project is priced by
      // BUDGET (no services picked) we still write one line — otherwise the invoice
      // carries a total with nothing itemised and the detail/PDF renders empty.
      const pickedServices = (selectedServiceIds || [])
        .map(id => services?.find(s => s.id === id))
        .filter(Boolean) as typeof services;
      if (pickedServices && pickedServices.length > 0) {
        for (const service of pickedServices) {
          await invoiceItemMutation.create({
            invoiceId: (newInvoice as any).id,
            serviceId: service.id,
            quantity: 1,
            unitPrice: service.price || 0,
            totalPrice: service.price || 0,
          } as any);
        }
      } else {
        await invoiceItemMutation.create({
          invoiceId: (newInvoice as any).id,
          description: name,
          quantity: 1,
          unitPrice: billableTotal,
          totalPrice: billableTotal,
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
            body: JSON.stringify({ invoiceId: (newInvoice as any).id }),
          });
        } catch {
          // email failure is non-blocking
        }
      }
    } else {
      // Non-recurring project: create a plain Draft invoice
      const invoiceLabel = invoiceScopeId
        ? await getNextInvoiceNumber(invoiceScopeId, maxInvNum)
        : `DRAFT-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${newProject.id.slice(0, 6).toUpperCase()}`;
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

      // Create invoiceItems for selected services. When the project is priced by
      // BUDGET (no services picked) we still write one line — otherwise the invoice
      // carries a total with nothing itemised and the detail/PDF renders empty.
      const pickedServices = (selectedServiceIds || [])
        .map(id => services?.find(s => s.id === id))
        .filter(Boolean) as typeof services;
      if (pickedServices && pickedServices.length > 0) {
        for (const service of pickedServices) {
          await invoiceItemMutation.create({
            invoiceId: (newInvoice as any).id,
            serviceId: service.id,
            quantity: 1,
            unitPrice: service.price || 0,
            totalPrice: service.price || 0,
          } as any);
        }
      } else {
        await invoiceItemMutation.create({
          invoiceId: (newInvoice as any).id,
          description: name,
          quantity: 1,
          unitPrice: billableTotal,
          totalPrice: billableTotal,
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
      const linkedInvoices = (allInvoices || []).filter(i => i.projectId === id);
      // A draft auto-generated invoice was never sent and has no accounting value.
      const disposableInvoices = linkedInvoices.filter(i => i.status === 'Draft' && (i as any).autoGenerated);
      const keptInvoices = linkedInvoices.filter(i => !disposableInvoices.includes(i));

      const [expensesSnap, timeSnap, commentsSnap] = await Promise.all([
        getDocs(query(collection(db, 'expenses'), where('projectId', '==', id))),
        getDocs(query(collection(db, 'timeEntries'), where('projectId', '==', id))),
        getDocs(query(collection(db, 'projectComments'), where('projectId', '==', id))),
      ]);

      const projectTasks = (allTasks || []).filter(t => (t as any).projectId === id);

      // allSettled, not all: a single permission failure on one collection must not
      // abort the rest of the cascade (and leave a half-detached project behind).
      const results = await Promise.allSettled([
        // Delete what is meaningless without the project.
        ...projectTasks.map(t => taskMutation.remove(t.id)),
        ...disposableInvoices.map(i => invoiceMutation.remove(i.id)),
        ...commentsSnap.docs.map(d => deleteDoc(d.ref)),
        // Unlink what must survive, and say why in the notes.
        ...keptInvoices.map(i => invoiceMutation.update(i.id, {
          projectId: '',
          notes: `${i.notes ? `${i.notes}\n` : ''}[Projekti "${name}" u fshi më ${new Date().toLocaleDateString('sq-AL')} — fatura u shkëputur.]`,
        } as any)),
        ...expensesSnap.docs.map(d => updateDoc(d.ref, { projectId: '', updatedAt: new Date() })),
        ...timeSnap.docs.map(d => updateDoc(d.ref, { projectId: '', updatedAt: new Date() })),
      ]);
      const failed = results.filter(r => r.status === 'rejected');
      if (failed.length) console.warn('[ProjectsView] pjesë e kaskadës dështoi:', failed);

      await projectMutation.remove(id);
      logActivity('project_deleted', `Projekt i fshirë: ${name}`, { entityType: 'project', entityId: id });
      setProjectToDelete(null);

      const parts: string[] = [];
      if (projectTasks.length) parts.push(`${projectTasks.length} detyra u fshinë`);
      if (disposableInvoices.length) parts.push(`${disposableInvoices.length} fatura draft u fshinë`);
      if (keptInvoices.length) parts.push(`${keptInvoices.length} fatura u shkëputën (nuk u fshinë)`);
      const unlinkedCost = expensesSnap.size + timeSnap.size;
      if (unlinkedCost) parts.push(`${unlinkedCost} shpenzime/orë u shkëputën`);
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
        description: project.wasRecurringBeforeArchive
          ? 'Faturimi i përsëritur u aktivizua përsëri.'
          : undefined,
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
    const billingType = formData.get('billingType') === 'monthly' ? 'monthly' : 'one-time';
    const startDateStr = formData.get('startDate') as string;
    const startDate = startDateStr ? new Date(startDateStr + 'T12:00:00') : undefined;
    const department = (formData.get('department') as string) || undefined;
    const billingDayRaw = formData.get('billingDayOfMonth') as string;
    const billingDayNum = billingDayRaw ? parseInt(billingDayRaw, 10) : NaN;
    const billingDayOfMonth = !isNaN(billingDayNum) && billingDayNum >= 1 && billingDayNum <= 31
      ? billingDayNum : undefined;
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
    const profitSplitStr = formData.get('profitSplit') as string;
    let profitSplit: Array<{ userId: string; percent: number }> | undefined;
    if (profitSplitStr) {
      try {
        const parsed = JSON.parse(profitSplitStr);
        profitSplit = Array.isArray(parsed) && parsed.length > 0 ? parsed : undefined;
      } catch { profitSplit = undefined; }
    }

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
    const archiveTransition =
      status === 'Archived' && oldStatus !== 'Archived'
        ? archiveProjectPatch({ ...projectToEdit, isRecurring }, { at: new Date(), byUserId: user?.uid ?? null })
        : oldStatus === 'Archived' && status !== 'Archived'
          ? { ...restoreProjectPatch(projectToEdit), status }
          : {};

    await projectMutation.update(projectToEdit.id, {
      name,
      description,
      status,
      ...(completedNow ? { lastCompletedAt: new Date() } : {}),
      teamId: teamId && teamId !== '__none__' ? teamId : undefined,
      budget,
      currency,
      billingType,
      startDate,
      department,
      billingDayOfMonth,
      customerId: custId && custId !== '__none__' ? custId : undefined,
      responsibleUserId: resolvedResponsible,
      isRecurring: isRecurring || undefined,
      recurringFrequency: isRecurring && recurringFrequency ? recurringFrequency as any : undefined,
      memberUserIds: memberUserIds && memberUserIds.length > 0 ? memberUserIds : undefined,
      serviceIds: selectedServiceIds && selectedServiceIds.length > 0 ? selectedServiceIds : undefined,
      // Write [] (not undefined) so clearing a manual split resets to the default
      // "100% to responsible" instead of leaving the old split in place.
      profitSplit: profitSplit && profitSplit.length > 0 ? profitSplit : [],
      // Last, so the archive rules win over the plain form fields above.
      ...archiveTransition,
    } as any);

    logActivity(
      status === 'Archived' && oldStatus !== 'Archived' ? 'project_archived'
        : oldStatus === 'Archived' && status !== 'Archived' ? 'project_restored'
        : 'project_updated',
      `Projekt i përditësuar: ${name}`,
      { entityType: 'project', entityId: projectToEdit.id },
    );

    // Keep DRAFT invoices in step with the fee. A draft was never sent, so silently
    // leaving it on the old price (the previous behaviour) meant the number the
    // client eventually received had nothing to do with the agreed budget. Issued
    // invoices are never rewritten — the user is told to issue a difference instead.
    const oldBudget = Number(projectToEdit.budget) || 0;
    const newBudget = Number(budget) || 0;
    const budgetChanged = newBudget !== oldBudget || currency !== (projectToEdit.currency || 'ALL');
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
                    </div>
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
  const [memberUserIds, setMemberUserIds] = useState<string[]>(initialData?.memberUserIds || []);
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([]);
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
  // Manual revenue split among participants. Off → 100% to responsible (default).
  const [customSplit, setCustomSplit] = useState<boolean>(!!(initialData as any)?.profitSplit?.length);
  const [splitPct, setSplitPct] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {};
    ((initialData as any)?.profitSplit || []).forEach((e: any) => {
      if (e?.userId) init[e.userId] = Number(e.percent) || 0;
    });
    return init;
  });
  const { getName } = useUserNames(teamMembers || []);

  // Participants eligible for a split: responsible + selected members (deduped).
  const splitParticipants = React.useMemo(() => {
    const ids: string[] = [];
    if (responsibleUserId && responsibleUserId !== '__none__') ids.push(responsibleUserId);
    memberUserIds.forEach(id => { if (!ids.includes(id)) ids.push(id); });
    return ids;
  }, [responsibleUserId, memberUserIds]);

  const pctFor = (id: string) =>
    splitPct[id] !== undefined ? splitPct[id] : (id === responsibleUserId ? 100 : 0);
  const splitTotal = splitParticipants.reduce((s, id) => s + pctFor(id), 0);

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

  const serviceBudget = React.useMemo(() => {
    if (!services || selectedServiceIds.length === 0) return null;
    return services
      .filter(s => selectedServiceIds.includes(s.id))
      .reduce((sum, s) => sum + (s.price || 0), 0);
  }, [services, selectedServiceIds]);

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
    formData.set('billingType', billingType);
    if (startDateInput) formData.set('startDate', startDateInput);
    if (department && department !== '__none__') formData.set('department', department);
    if (billingDayOfMonth) formData.set('billingDayOfMonth', billingDayOfMonth);
    formData.set('memberUserIds', JSON.stringify(memberUserIds));
    formData.set('selectedServiceIds', JSON.stringify(selectedServiceIds));
    // Only persist a manual split when the toggle is on; otherwise leave it empty
    // so the default "100% to responsible" applies.
    if (customSplit && splitParticipants.length > 0) {
      const arr = splitParticipants
        .map(id => ({ userId: id, percent: pctFor(id) }))
        .filter(e => e.percent > 0);
      formData.set('profitSplit', JSON.stringify(arr));
    } else {
      formData.set('profitSplit', JSON.stringify([]));
    }
    // Override budget with computed service total if services are selected
    if (serviceBudget !== null) {
      formData.set('budget', String(serviceBudget));
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
                  <span className="text-sm text-primary font-medium shrink-0">{(s.price || 0).toLocaleString()} {s.currency || 'ALL'}</span>
                </div>
              </label>
            ))}
          </div>

          {selectedServiceIds.length > 0 && (
            <p className="text-xs text-primary font-medium mt-1">
              {selectedServiceIds.length} shërbim{selectedServiceIds.length !== 1 ? 'e' : ''} zgjedhur · Total: {serviceBudget?.toLocaleString()} {services[0]?.currency || 'ALL'}
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
            <SelectItem value="monthly">Mujore (tarifë çdo muaj)</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground mt-1">
          {billingType === 'monthly'
            ? 'Buxheti lart është tarifë mujore — fitimi shumëzon me muajt që projekti ka qenë aktiv.'
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

      {/* Billing day — only meaningful for a MONTHLY recurring retainer */}
      {billingType === 'monthly' && (isRecurring || recurringFrequency === 'monthly') && (
        <div>
          <Label htmlFor="billingDayOfMonth">Dita e faturimit (çdo muaj)</Label>
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
            Fatura mujore gjenerohet në këtë ditë (p.sh. 25). Bosh = në fillim të muajit.
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

      {/* Manual revenue split */}
      {splitParticipants.length > 0 && (
        <div className="border rounded-lg p-3 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Ndaj xhiron mes ekipit</p>
              <p className="text-xs text-muted-foreground">
                Pa këtë, 100% e vlerës i kalon përgjegjësit. Aktivizoje për ta ndarë manualisht.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={customSplit}
              onClick={() => setCustomSplit(!customSplit)}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${customSplit ? 'bg-primary' : 'bg-muted-foreground/30'}`}
            >
              <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${customSplit ? 'translate-x-4' : 'translate-x-1'}`} />
            </button>
          </div>
          {customSplit && (
            <div className="space-y-2">
              {splitParticipants.map(id => (
                <div key={id} className="flex items-center gap-2">
                  <span className="text-sm flex-1 truncate">
                    {getName(id)}
                    {id === responsibleUserId && <span className="text-[11px] text-muted-foreground ml-1">(përgjegjës)</span>}
                  </span>
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    value={pctFor(id)}
                    onChange={e => setSplitPct(prev => ({ ...prev, [id]: Math.max(0, Math.min(100, Number(e.target.value) || 0)) }))}
                    className="w-20 h-8 text-right"
                  />
                  <span className="text-sm text-muted-foreground w-4">%</span>
                </div>
              ))}
              <div className={`flex items-center justify-between text-xs pt-1 border-t ${splitTotal === 100 ? 'text-muted-foreground' : 'text-amber-600 dark:text-amber-400'}`}>
                <span>Totali</span>
                <span className="font-medium">{splitTotal}%{splitTotal !== 100 ? ' — duhet të jetë 100%' : ''}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Recurring Project */}
      <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-muted/40">
        <div>
          <p className="text-sm font-medium">Projekt Periodik</p>
          <p className="text-xs text-muted-foreground">Projekti ripërsëritet automatikisht çdo javë/muaj</p>
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
        <div>
          <Label>Frekuenca e Përsëritjes</Label>
          <Select value={recurringFrequency} onValueChange={setRecurringFrequency}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="weekly">Javore (çdo javë)</SelectItem>
              <SelectItem value="monthly">Mujore (çdo muaj)</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground mt-1">
            Kur të gjitha detyrat mbarojnë, projekti shënohet si kompletuar për atë periudhë dhe rifillon automatikisht.
          </p>
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
