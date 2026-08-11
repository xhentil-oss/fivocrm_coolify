import React, { useState, useMemo, useEffect } from 'react';
import { useCollection, useMutation } from '../hooks/useFirestore';
import { toAll, currencySymbol } from '../lib/utils';
import { projectPickerLabel, sortArchivedLast } from '../lib/projectArchive';
import { MONTH_LABELS_SQ, getExpenseDate } from '../lib/finance/financialAnalytics';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../contexts/PermissionsContext';
import { DollarSign, Plus, Calendar as CalendarIcon, Building2, Repeat, Trash2, Pencil, Search, Check, X, ThumbsUp, ThumbsDown, Clock, Pause, Play, CircleStop, AlertTriangle, Filter, RotateCcw, Download } from 'lucide-react';
import { Card } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog';
import { Textarea } from '../components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Calendar } from '../components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover';
import { Switch } from '../components/ui/switch';
import { useActivityLogger } from '../hooks/useActivityLogger';
import { useToast } from '../hooks/use-toast';
import { useFilteredByOwner, useUniqueTeamMembers } from '../hooks/useRoleFilteredData';
import {
  expensePeriodKey,
  firstGenerationDate,
  findDuplicateExpenseGroups,
  totalDuplicateWaste,
} from '../lib/finance/recurringExpenses';
import type { Expense, Team, Project, TeamMember } from '../types';

const ExpensesView: React.FC = () => {
  const { user } = useAuth();
  const permissions = usePermissions();
  const logActivity = useActivityLogger();
  const { toast } = useToast();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [selectedExpense, setSelectedExpense] = useState<Expense | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  // Delete flow: a recurring parent opens a choice dialog (stop / delete one /
  // delete whole series); everything else deletes directly with a confirm.
  const [deleteTarget, setDeleteTarget] = useState<Expense | null>(null);
  const [deleteMode, setDeleteMode] = useState<'stop' | 'one' | 'series'>('stop');
  const [deleteBusy, setDeleteBusy] = useState(false);

  const { data: rawExpenses, loading: expensesLoading } = useCollection<Expense>('expenses', {
    orderBy: { field: 'createdAt', direction: 'desc' },
    skipTeamFilter: true,
  });
  // Role-based filtering: Member/Viewer see only their own expenses
  const expenses = useFilteredByOwner(rawExpenses);
  const { data: teams } = useCollection<Team>('teams');
  const { data: projects } = useCollection<Project>('projects', { skipTeamFilter: true });
  const { data: rawTeamMembers } = useCollection<TeamMember>('teamMembers', {
    where: [{ field: 'status', operator: '==', value: 'Active' }]
  });
  const teamMembers = useUniqueTeamMembers(rawTeamMembers);
  const expenseMutation = useMutation<Expense>('expenses');
  const notificationMutation = useMutation<any>('notifications');

  const handleCreateExpense = async (formData: FormData) => {
    const title = formData.get('title') as string;
    const description = formData.get('description') as string;
    const amount = parseFloat(formData.get('amount') as string);
    if (!title || !title.trim()) {
      toast({ title: 'Titulli mungon', description: 'Shkruaj një titull për shpenzimin.', variant: 'destructive' });
      return;
    }
    if (isNaN(amount) || amount < 0) {
      toast({ title: 'Shuma e pavlefshme', description: 'Shkruaj një shumë pozitive.', variant: 'destructive' });
      return;
    }
    const currency = formData.get('currency') as string;
    const category = formData.get('category') as string;
    const departmentId = formData.get('departmentId') as string;
    const isRecurring = formData.get('isRecurring') === 'true';
    const recurringFrequency = formData.get('recurringFrequency') as string;
    const nextRecurringDate = formData.get('nextRecurringDate') as string;
    const recurringEndDate = formData.get('recurringEndDate') as string;
    const status = formData.get('status') as string;
    const paidDate = formData.get('paidDate') as string;
    const projectId = formData.get('projectId') as string;

    const memberId = formData.get('memberId') as string;

    // Same title + amount + currency already recorded this month? Likely a double
    // entry — but we DON'T block the save with a native confirm() (unreliable in
    // the mobile webview, and a false return silently dropped the expense). We save
    // and warn; duplicates are also surfaced by the banner/badge/"Dublikatat" filter.
    const now = new Date();
    const thisPeriod = expensePeriodKey('monthly', now);
    const clash = (rawExpenses || []).some(e => {
      if ((e as any).approvalStatus === 'Rejected') return false;
      if ((e.title || '').trim().toLowerCase() !== title.trim().toLowerCase()) return false;
      if (Number(e.amount) !== amount) return false;
      if (((e as any).currency || 'ALL') !== (currency || 'ALL')) return false;
      const d = getExpenseDate(e);
      return !!d && expensePeriodKey('monthly', d) === thisPeriod;
    });

    // A recurring PARENT is itself a real row that counts in its own month, so the
    // first generated occurrence must land in the NEXT period — otherwise the cron
    // adds a second row for a month that is already covered. The chosen day survives.
    const freq = recurringFrequency || 'monthly';
    const pickedNext = nextRecurringDate ? new Date(nextRecurringDate) : null;
    const firstNext = isRecurring ? firstGenerationDate(now, freq, pickedNext) : null;

    const isAdminOrManager = permissions.isAdmin || permissions.isManager || permissions.isOwner || permissions.isSuperAdmin;
    try {
      await expenseMutation.create({
        title,
        description: description || undefined,
        amount,
        currency: currency || 'ALL',
        category,
        departmentId: departmentId || undefined,
        isRecurring,
        recurringFrequency: isRecurring ? freq : undefined,
        nextRecurringDate: firstNext || undefined,
        recurringAnchorDay: firstNext ? firstNext.getDate() : undefined,
        // This row IS the current period's expense — recording the key stops the cron
        // from generating a second one for it.
        lastGeneratedPeriodKey: isRecurring ? expensePeriodKey(freq, now) : undefined,
        recurringEndDate: isRecurring && recurringEndDate ? new Date(recurringEndDate) : undefined,
        status: status || 'Active',
        approvalStatus: isAdminOrManager ? 'Approved' : 'Submitted',
        approvedByUserId: isAdminOrManager ? user?.uid : undefined,
        paidDate: paidDate ? new Date(paidDate) : undefined,
        projectId: projectId && projectId !== '__none__' ? projectId : undefined,
        memberId: memberId && memberId !== '__none__' ? memberId : undefined,
      } as any);
    } catch (err: any) {
      console.error('[Expenses] create failed:', err);
      toast({ title: 'Shpenzimi nuk u ruajt', description: err?.message || 'Ndodhi një gabim — provo përsëri.', variant: 'destructive' });
      return; // keep the dialog open so the entry isn't lost
    }

    logActivity('expense_added', `Shpenzim: ${title}`, { entityType: 'expense', description: `${amount} ${currencySymbol(currency)}` });

    // Notify Admins and Managers about new expense (exclude submitter)
    const adminManagers = (teamMembers || []).filter(m =>
      m.userId !== user?.uid && (m.role === 'Admin' || m.role === 'Manager')
    );
    if (adminManagers.length > 0) {
      await Promise.all(adminManagers.map(m =>
        notificationMutation.create({
          userId: m.userId,
          type: 'expense_submitted',
          title: 'Shpenzim i Ri i Shtuar',
          message: `${title} — ${amount} ${currencySymbol(currency)}`,
          isRead: false,
          actionUrl: '/app/expenses',
          actionLabel: 'Shiko Shpenzimet',
        })
      )).catch(err => console.error('[Notifications] expense_submitted dërgim dështoi:', err));
    }

    setIsCreateDialogOpen(false);
    toast({
      title: 'Shpenzimi u ruajt ✓',
      description: clash ? '⚠ Duket dublikatë e këtij muaji — kontrollo te banner-i i dublikatave.' : undefined,
    });
  };

  const handleUpdateExpense = async (formData: FormData) => {
    if (!selectedExpense) return;

    const title = formData.get('title') as string;
    const description = formData.get('description') as string;
    const amount = parseFloat(formData.get('amount') as string);
    if (!title || !title.trim()) {
      toast({ title: 'Titulli mungon', description: 'Shkruaj një titull për shpenzimin.', variant: 'destructive' });
      return;
    }
    if (isNaN(amount) || amount < 0) {
      toast({ title: 'Shuma e pavlefshme', description: 'Shkruaj një shumë pozitive.', variant: 'destructive' });
      return;
    }
    const currency = formData.get('currency') as string;
    const category = formData.get('category') as string;
    const departmentId = formData.get('departmentId') as string;
    const isRecurring = formData.get('isRecurring') === 'true';
    const recurringFrequency = formData.get('recurringFrequency') as string;
    const nextRecurringDate = formData.get('nextRecurringDate') as string;
    const recurringEndDate = formData.get('recurringEndDate') as string;
    const status = formData.get('status') as string;
    const paidDate = formData.get('paidDate') as string;
    const projectId = formData.get('projectId') as string;

    const memberId = formData.get('memberId') as string;

    const freq = recurringFrequency || 'monthly';
    const picked = nextRecurringDate ? new Date(nextRecurringDate) : null;
    const wasRecurring = !!selectedExpense.isRecurring;
    // Turning recurrence ON behaves like creating one: the series starts in the
    // period AFTER the one this row already covers. An existing series keeps the
    // date the user typed — they are editing the schedule deliberately.
    const ownDate = getExpenseDate(selectedExpense) || new Date();
    const nextDate = !isRecurring ? null
      : wasRecurring ? picked
      : firstGenerationDate(ownDate, freq, picked);

    try {
      await expenseMutation.update(selectedExpense.id, {
        title,
        description: description || undefined,
        amount,
        currency: currency || 'ALL',
        category,
        departmentId: departmentId || undefined,
        isRecurring,
        recurringFrequency: isRecurring ? freq : undefined,
        nextRecurringDate: nextDate,
        recurringAnchorDay: nextDate ? nextDate.getDate() : null,
        lastGeneratedPeriodKey: isRecurring
          ? ((selectedExpense as any).lastGeneratedPeriodKey || expensePeriodKey(freq, ownDate))
          : null,
        // Turning recurrence off clears the schedule fields so a stale end-date/pause
        // can't silently resurrect the series later.
        recurringEndDate: isRecurring ? (recurringEndDate ? new Date(recurringEndDate) : null) : null,
        isRecurringPaused: isRecurring ? ((selectedExpense as any).isRecurringPaused ?? false) : false,
        status: status || 'Active',
        paidDate: paidDate ? new Date(paidDate) : undefined,
        projectId: projectId && projectId !== '__none__' ? projectId : undefined,
        memberId: memberId && memberId !== '__none__' ? memberId : undefined,
      } as any);
    } catch (err: any) {
      console.error('[Expenses] update failed:', err);
      toast({ title: 'Ndryshimet nuk u ruajtën', description: err?.message || 'Ndodhi një gabim — provo përsëri.', variant: 'destructive' });
      return;
    }

    setIsEditDialogOpen(false);
    setSelectedExpense(null);
    toast({ title: 'Shpenzimi u përditësua ✓' });
  };

  // Pause/resume generation without ending the series.
  const handleTogglePause = async (expense: Expense) => {
    await expenseMutation.update(expense.id, {
      isRecurringPaused: !(expense as any).isRecurringPaused,
    } as any);
  };

  // Stop recurrence for good: keep this record and all past occurrences, just
  // never generate again. This is the correct "interrupt" — no history is lost.
  const handleStopRecurrence = async (expense: Expense) => {
    await expenseMutation.update(expense.id, {
      isRecurring: false,
      isRecurringPaused: false,
      nextRecurringDate: null,
    } as any);
  };

  const handleApproveExpense = async (id: string) => {
    await expenseMutation.update(id, { approvalStatus: 'Approved', approvedByUserId: user?.uid } as any);
  };

  const handleRejectExpense = async (id: string) => {
    await expenseMutation.update(id, { approvalStatus: 'Rejected', approvedByUserId: user?.uid } as any);
  };

  // Count of auto-generated occurrences for a parent (drives the delete dialog copy).
  const childrenOf = (parentId: string) =>
    (rawExpenses || []).filter(e => (e as any).parentExpenseId === parentId);

  const handleDeleteExpense = async (expense: Expense) => {
    const isRecurringParent = expense.isRecurring && !(expense as any).autoGenerated;
    const hasChildren = childrenOf(expense.id).length > 0;
    // A recurring parent (or one that already spawned occurrences) needs the
    // choice dialog; a plain/one-off/child entry just confirms.
    if (isRecurringParent || hasChildren) {
      setDeleteTarget(expense);
      setDeleteMode(expense.isRecurring ? 'stop' : 'one');
      return;
    }
    if (confirm('Je i sigurt që dëshiron të fshish këtë shpenzim?')) {
      await expenseMutation.remove(expense.id);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    try {
      if (deleteMode === 'stop') {
        // Interrupt only: keep the record + all past occurrences.
        await handleStopRecurrence(deleteTarget);
      } else if (deleteMode === 'one') {
        // Remove just this record; past/future occurrences are untouched.
        await expenseMutation.remove(deleteTarget.id);
      } else {
        // Destructive: remove the parent AND every generated occurrence (history included).
        const kids = childrenOf(deleteTarget.id);
        await Promise.all(kids.map(k => expenseMutation.remove(k.id)));
        await expenseMutation.remove(deleteTarget.id);
      }
      setDeleteTarget(null);
    } finally {
      setDeleteBusy(false);
    }
  };

  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'Salary':
        return 'bg-blue-100 text-blue-800';
      case 'Rent':
        return 'bg-accent-soft text-primary';
      case 'Utilities':
        return 'bg-yellow-100 text-yellow-800';
      case 'Office':
        return 'bg-green-100 text-green-800';
      case 'Hosting':
        return 'bg-navy-700/10 text-navy-700';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getCategoryLabel = (category: string) => {
    switch (category) {
      case 'Salary': return 'Paga';
      case 'Rent': return 'Qira';
      case 'Utilities': return 'Shërbime (Ujë, Dritë)';
      case 'Office': return 'Zyrë';
      case 'Hosting': return 'Hosting & Software';
      case 'Marketing': return 'Marketing';
      case 'Travel': return 'Udhëtim';
      case 'Other': return 'Tjetër';
      default: return category;
    }
  };

  // Rejected expenses are shown in the list but must not hit any total.
  const countable = (exp: any) => exp.approvalStatus !== 'Rejected';

  // ── Shpenzime sipas muajve (për vitin e zgjedhur) ──
  const currentYr = new Date().getFullYear();
  const [byMonthYear, setByMonthYear] = useState(currentYr);

  // ── Filtrat e listës ──────────────────────────────────────────────────────
  // Everything below the chart (KPI cards, mobile cards, desktop table) renders
  // `filteredExpenses`, so a filter narrows the numbers AND the rows together —
  // otherwise a filtered table under an unfiltered total reads as a bug.
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('__all__');
  const [statusFilter, setStatusFilter] = useState('__all__');
  const [approvalFilter, setApprovalFilter] = useState('__all__');
  const [recurringFilter, setRecurringFilter] = useState('__all__');
  const [departmentFilter, setDepartmentFilter] = useState('__all__');
  const [projectFilter, setProjectFilter] = useState('__all__');
  const [monthFilter, setMonthFilter] = useState('__all__');
  const [yearFilter, setYearFilter] = useState('__all__');
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');
  const [sortBy, setSortBy] = useState('date_desc');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [duplicatesOnly, setDuplicatesOnly] = useState(false);

  // Same title + amount + currency inside one month — the failure mode that
  // actually costs money, since every duplicate inflates the P&L and the cashflow
  // alarms. Detection only suggests; nothing is removed automatically.
  const duplicateGroups = useMemo(() => findDuplicateExpenseGroups(expenses), [expenses]);
  const duplicateIds = useMemo(() => {
    const ids = new Set<string>();
    duplicateGroups.forEach(g => g.expenses.forEach(e => ids.add(e.id)));
    return ids;
  }, [duplicateGroups]);
  const duplicateWaste = useMemo(() => totalDuplicateWaste(duplicateGroups), [duplicateGroups]);
  const groupSizeById = useMemo(() => {
    const m = new Map<string, number>();
    duplicateGroups.forEach(g => g.expenses.forEach(e => m.set(e.id, g.expenses.length)));
    return m;
  }, [duplicateGroups]);

  const projectById = useMemo(
    () => new Map((projects || []).map(p => [p.id, p])),
    [projects]
  );

  // Categories come from the data (custom ones live in `expenseCategories`), so the
  // dropdown never offers a category with zero rows behind it.
  const categoryOptions = useMemo(() => {
    const counts = new Map<string, number>();
    (expenses || []).forEach(e => {
      if (e.category) counts.set(e.category, (counts.get(e.category) || 0) + 1);
    });
    return Array.from(counts.entries())
      .map(([value, count]) => ({ value, count, label: getCategoryLabel(value) }))
      .sort((a, b) => a.label.localeCompare(b.label, 'sq'));
  }, [expenses]);

  const activeFilterCount = [
    searchQuery.trim() !== '',
    categoryFilter !== '__all__',
    statusFilter !== '__all__',
    approvalFilter !== '__all__',
    recurringFilter !== '__all__',
    departmentFilter !== '__all__',
    projectFilter !== '__all__',
    monthFilter !== '__all__',
    yearFilter !== '__all__',
    minAmount !== '',
    maxAmount !== '',
    duplicatesOnly,
  ].filter(Boolean).length;

  const resetFilters = () => {
    setDuplicatesOnly(false);
    setSearchQuery('');
    setCategoryFilter('__all__');
    setStatusFilter('__all__');
    setApprovalFilter('__all__');
    setRecurringFilter('__all__');
    setDepartmentFilter('__all__');
    setProjectFilter('__all__');
    setMonthFilter('__all__');
    setYearFilter('__all__');
    setMinAmount('');
    setMaxAmount('');
  };

  const filteredExpenses = useMemo(() => {
    let list = expenses ? [...expenses] : [];
    if (duplicatesOnly) list = list.filter(e => duplicateIds.has(e.id));

    const q = searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter(e => {
        const proj = (e as any).projectId ? projectById.get((e as any).projectId) : undefined;
        return (
          (e.title || '').toLowerCase().includes(q) ||
          (e.description || '').toLowerCase().includes(q) ||
          getCategoryLabel(e.category || '').toLowerCase().includes(q) ||
          (proj?.name || '').toLowerCase().includes(q)
        );
      });
    }
    if (categoryFilter !== '__all__') list = list.filter(e => e.category === categoryFilter);
    if (statusFilter !== '__all__') list = list.filter(e => e.status === statusFilter);
    if (approvalFilter !== '__all__') {
      list = list.filter(e => ((e as any).approvalStatus || 'Approved') === approvalFilter);
    }
    if (recurringFilter === 'recurring') list = list.filter(e => !!e.isRecurring);
    else if (recurringFilter === 'paused') list = list.filter(e => !!e.isRecurring && !!(e as any).isRecurringPaused);
    else if (recurringFilter === 'auto') list = list.filter(e => !!(e as any).autoGenerated);
    else if (recurringFilter === 'onetime') list = list.filter(e => !e.isRecurring && !(e as any).autoGenerated);

    if (departmentFilter === '__none__') list = list.filter(e => !e.departmentId);
    else if (departmentFilter !== '__all__') list = list.filter(e => e.departmentId === departmentFilter);

    if (projectFilter === '__none__') list = list.filter(e => !(e as any).projectId);
    else if (projectFilter !== '__all__') list = list.filter(e => (e as any).projectId === projectFilter);

    if (monthFilter !== '__all__' || yearFilter !== '__all__') {
      list = list.filter(e => {
        const d = getExpenseDate(e);
        if (!d) return false;
        if (monthFilter !== '__all__' && d.getMonth() !== Number(monthFilter)) return false;
        if (yearFilter !== '__all__' && d.getFullYear() !== Number(yearFilter)) return false;
        return true;
      });
    }

    // Amount bounds are compared in ALL so a EUR row is judged on the same scale
    // as the totals above it.
    const min = minAmount.trim() === '' ? null : Number(minAmount);
    const max = maxAmount.trim() === '' ? null : Number(maxAmount);
    if (min !== null && !isNaN(min)) list = list.filter(e => toAll(e.amount ?? 0, (e as any).currency) >= min);
    if (max !== null && !isNaN(max)) list = list.filter(e => toAll(e.amount ?? 0, (e as any).currency) <= max);

    const dateMs = (e: Expense) => getExpenseDate(e)?.getTime() ?? 0;
    list.sort((a, b) => {
      // In duplicate mode the rows only make sense next to each other.
      if (duplicatesOnly) {
        const byTitle = (a.title || '').localeCompare(b.title || '', 'sq');
        if (byTitle !== 0) return byTitle;
        return dateMs(a) - dateMs(b);
      }
      if (sortBy === 'date_asc') return dateMs(a) - dateMs(b);
      if (sortBy === 'amount_desc') return toAll(b.amount ?? 0, (b as any).currency) - toAll(a.amount ?? 0, (a as any).currency);
      if (sortBy === 'amount_asc') return toAll(a.amount ?? 0, (a as any).currency) - toAll(b.amount ?? 0, (b as any).currency);
      if (sortBy === 'title_asc') return (a.title || '').localeCompare(b.title || '', 'sq');
      return dateMs(b) - dateMs(a);
    });
    return list;
  }, [expenses, searchQuery, categoryFilter, statusFilter, approvalFilter, recurringFilter,
      departmentFilter, projectFilter, monthFilter, yearFilter, minAmount, maxAmount, sortBy,
      projectById, duplicatesOnly, duplicateIds]);

  // Cap rendered rows — an unfiltered tenant can carry hundreds of generated occurrences.
  const [visibleCount, setVisibleCount] = useState(50);
  useEffect(() => { setVisibleCount(50); }, [searchQuery, categoryFilter, statusFilter, approvalFilter,
    recurringFilter, departmentFilter, projectFilter, monthFilter, yearFilter, minAmount, maxAmount, sortBy, duplicatesOnly]);
  const visibleExpenses = useMemo(() => filteredExpenses.slice(0, visibleCount), [filteredExpenses, visibleCount]);

  const totalExpenses = filteredExpenses.reduce((sum, exp) => countable(exp) ? sum + toAll(exp.amount ?? 0, (exp as any).currency) : sum, 0);
  const activeExpenses = filteredExpenses.filter(e => e.status === 'Active').length;
  const recurringExpenses = filteredExpenses.filter(e => e.isRecurring).length;

  // Breakdown of the current selection — the answer to "ku po shkojnë paratë".
  const categoryBreakdown = useMemo(() => {
    const totals = new Map<string, number>();
    filteredExpenses.forEach(exp => {
      if (!countable(exp)) return;
      const key = exp.category || 'Other';
      totals.set(key, (totals.get(key) || 0) + toAll(exp.amount ?? 0, (exp as any).currency));
    });
    return Array.from(totals.entries())
      .map(([category, value]) => ({ category, value }))
      .sort((a, b) => b.value - a.value);
  }, [filteredExpenses]);

  const exportCsv = () => {
    const rows = [
      ['Titulli', 'Kategoria', 'Shuma', 'Monedha', 'Shuma (ALL)', 'Departamenti', 'Projekti', 'Data', 'Periodike', 'Statusi', 'Miratimi'],
      ...filteredExpenses.map(e => {
        const d = getExpenseDate(e);
        return [
          e.title || '',
          getCategoryLabel(e.category || ''),
          String(e.amount ?? 0),
          (e as any).currency || 'ALL',
          String(Math.round(toAll(e.amount ?? 0, (e as any).currency))),
          teams?.find(t => t.id === e.departmentId)?.name || '',
          ((e as any).projectId ? projectById.get((e as any).projectId)?.name : '') || '',
          d ? d.toLocaleDateString('sq-AL') : '',
          e.isRecurring ? getFreqLabel(e.recurringFrequency) : ((e as any).autoGenerated ? 'Auto' : 'Njëherësh'),
          e.status || '',
          (e as any).approvalStatus || '',
        ];
      }),
    ];
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `shpenzime-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const monthlyExpenses = useMemo(() => {
    const totals = new Array(12).fill(0) as number[];
    (expenses || []).forEach(exp => {
      if ((exp as any).approvalStatus === 'Rejected') return;
      const d = getExpenseDate(exp);
      if (!d || d.getFullYear() !== byMonthYear) return;
      totals[d.getMonth()] += toAll(exp.amount ?? 0, (exp as any).currency);
    });
    return totals;
  }, [expenses, byMonthYear]);
  const monthlyMax = Math.max(...monthlyExpenses, 1);
  const yearTotal = monthlyExpenses.reduce((s, v) => s + v, 0);
  const expenseYears = useMemo(() => {
    const ys = new Set<number>([currentYr]);
    (expenses || []).forEach(exp => { const d = getExpenseDate(exp); if (d) ys.add(d.getFullYear()); });
    return Array.from(ys).sort((a, b) => b - a);
  }, [expenses, currentYr]);
  const pendingApprovalCount = expenses?.filter(e => (e as any).approvalStatus === 'Submitted').length || 0;
  const isAdminOrManager = permissions.isAdmin || permissions.isManager || permissions.isOwner || permissions.isSuperAdmin;

  if (expensesLoading) {
    return <div className="flex items-center justify-center h-96">Duke ngarkuar shpenzimet...</div>;
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-h2 text-foreground">Shpenzimet</h1>
          <p className="text-body text-muted-foreground mt-1">
            {activeFilterCount > 0 ? (
              <>Duke shfaqur <span className="font-medium text-foreground">{filteredExpenses.length}</span> nga {expenses?.length || 0} shpenzime</>
            ) : (
              <>{expenses?.length || 0} shpenzime totale · {activeExpenses} aktive · {recurringExpenses} periodike</>
            )}
            {isAdminOrManager && pendingApprovalCount > 0 && (
              <span className="ml-2 inline-flex items-center gap-1 text-amber-600 font-medium">
                <Clock className="w-3.5 h-3.5" />
                {pendingApprovalCount} në pritje miratimi
              </span>
            )}
          </p>
        </div>
        {permissions.canEdit && (
          <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button className="bg-primary text-primary-foreground w-full sm:w-auto">
                <Plus className="w-4 h-4 mr-2" />
                Shpenzim i Ri
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Krijo Shpenzim të Ri</DialogTitle>
              </DialogHeader>
              <ExpenseForm onSubmit={handleCreateExpense} teams={teams || []} projects={projects || []} />
            </DialogContent>
          </Dialog>
        )}
      </div>

      {/* A duplicate inside one month is money counted twice in the P&L, the
          cashflow alarms and every "sa shpenzuam" number — surface it, never
          delete it automatically. */}
      {duplicateGroups.length > 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-3 text-sm flex items-center justify-between gap-3 flex-wrap">
          <span className="text-amber-900 dark:text-amber-200 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>
              <strong>{duplicateGroups.length} grupe me dublikatë</strong> brenda të njëjtit muaj
              (i njëjti titull, shumë dhe monedhë) — rreth{' '}
              <strong>{Math.round(duplicateWaste).toLocaleString()} ALL</strong> të numëruara dy herë.
            </span>
          </span>
          <button
            onClick={() => setDuplicatesOnly(v => !v)}
            className="h-8 px-3 rounded-md border border-amber-400 bg-background text-amber-900 dark:text-amber-200 font-medium hover:bg-amber-100 dark:hover:bg-amber-900/30 shrink-0"
          >
            {duplicatesOnly ? 'Shfaq të gjitha' : 'Shiko dublikatat'}
          </button>
        </div>
      )}

      {/* ── Filtrat ── everything below reacts to these */}
      <Card className="p-3 sm:p-4 space-y-3">
        <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Kërko titull, përshkrim, kategori ose projekt..."
              className="h-9 w-full rounded-md border border-input bg-background pl-8 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Pastro kërkimin"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <div className="flex gap-2 items-center">
            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value)}
              className="h-9 px-2 text-xs rounded-md border border-input bg-background text-muted-foreground focus:outline-none"
              title="Renditja"
            >
              <option value="date_desc">Data ↓</option>
              <option value="date_asc">Data ↑</option>
              <option value="amount_desc">Shuma ↓</option>
              <option value="amount_asc">Shuma ↑</option>
              <option value="title_asc">Titulli A-Z</option>
            </select>
            <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={exportCsv} disabled={filteredExpenses.length === 0}>
              <Download className="w-3.5 h-3.5" /> <span className="hidden sm:inline">CSV</span>
            </Button>
            {activeFilterCount > 0 && (
              <Button variant="ghost" size="sm" className="h-9 gap-1.5 text-muted-foreground" onClick={resetFilters}>
                <RotateCcw className="w-3.5 h-3.5" /> Pastro ({activeFilterCount})
              </Button>
            )}
          </div>
        </div>

        <div className="flex gap-2 flex-wrap">
          <select
            value={categoryFilter}
            onChange={e => setCategoryFilter(e.target.value)}
            className="h-8 px-2 text-xs rounded-md border border-input bg-background text-muted-foreground focus:outline-none max-w-[190px]"
            title="Filtro sipas kategorisë"
          >
            <option value="__all__">Çdo kategori</option>
            {categoryOptions.map(c => (
              <option key={c.value} value={c.value}>{c.label} ({c.count})</option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="h-8 px-2 text-xs rounded-md border border-input bg-background text-muted-foreground focus:outline-none"
            title="Filtro sipas statusit"
          >
            <option value="__all__">Çdo status</option>
            <option value="Active">Aktiv</option>
            <option value="Inactive">Joaktiv</option>
            <option value="Cancelled">Anuluar</option>
          </select>
          <select
            value={recurringFilter}
            onChange={e => setRecurringFilter(e.target.value)}
            className="h-8 px-2 text-xs rounded-md border border-input bg-background text-muted-foreground focus:outline-none"
            title="Filtro sipas llojit"
          >
            <option value="__all__">Çdo lloj</option>
            <option value="recurring">Vetëm periodike</option>
            <option value="paused">Periodike në pauzë</option>
            <option value="auto">Gjeneruar automatikisht</option>
            <option value="onetime">Vetëm njëherësh</option>
          </select>
          <select
            value={monthFilter}
            onChange={e => setMonthFilter(e.target.value)}
            className="h-8 px-2 text-xs rounded-md border border-input bg-background text-muted-foreground focus:outline-none"
            title="Filtro sipas muajit"
          >
            <option value="__all__">Çdo muaj</option>
            {MONTH_NAMES_SQ.map((m, i) => <option key={m} value={i}>{m}</option>)}
          </select>
          <select
            value={yearFilter}
            onChange={e => setYearFilter(e.target.value)}
            className="h-8 px-2 text-xs rounded-md border border-input bg-background text-muted-foreground focus:outline-none"
            title="Filtro sipas vitit"
          >
            <option value="__all__">Çdo vit</option>
            {expenseYears.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <button
            type="button"
            onClick={() => setShowAdvanced(v => !v)}
            className={`h-8 px-3 text-xs rounded-md border font-medium inline-flex items-center gap-1.5 transition-colors ${
              showAdvanced ? 'bg-muted border-input text-foreground' : 'bg-background border-input text-muted-foreground hover:bg-muted'
            }`}
          >
            <Filter className="w-3.5 h-3.5" /> Më shumë
          </button>
        </div>

        {showAdvanced && (
          <div className="flex gap-2 flex-wrap items-center pt-1 border-t border-border/40">
            <select
              value={departmentFilter}
              onChange={e => setDepartmentFilter(e.target.value)}
              className="h-8 px-2 text-xs rounded-md border border-input bg-background text-muted-foreground focus:outline-none max-w-[190px]"
              title="Filtro sipas departamentit"
            >
              <option value="__all__">Çdo departament</option>
              <option value="__none__">Pa departament</option>
              {(teams || []).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <select
              value={projectFilter}
              onChange={e => setProjectFilter(e.target.value)}
              className="h-8 px-2 text-xs rounded-md border border-input bg-background text-muted-foreground focus:outline-none max-w-[190px]"
              title="Filtro sipas projektit"
            >
              <option value="__all__">Çdo projekt</option>
              <option value="__none__">Pa projekt</option>
              {/* Alphabetical, then the archive at the bottom (sortArchivedLast is
                  stable, so it only moves archived rows down). */}
              {sortArchivedLast(
                (projects || []).slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''))
              ).map(p => <option key={p.id} value={p.id}>{projectPickerLabel(p)}</option>)}
            </select>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">Shuma (ALL)</span>
              <input
                type="number"
                min="0"
                value={minAmount}
                onChange={e => setMinAmount(e.target.value)}
                placeholder="nga"
                className="h-8 w-24 px-2 text-xs rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <span className="text-xs text-muted-foreground">—</span>
              <input
                type="number"
                min="0"
                value={maxAmount}
                onChange={e => setMaxAmount(e.target.value)}
                placeholder="deri"
                className="h-8 w-24 px-2 text-xs rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>
        )}

        {/* Approval chips — the daily job for an Admin/Manager is "çfarë pret miratim" */}
        <div className="flex gap-2 flex-wrap">
          {(['__all__', 'Submitted', 'Approved', 'Rejected'] as const).map(s => {
            const count = s === '__all__'
              ? (expenses?.length || 0)
              : (expenses || []).filter(e => ((e as any).approvalStatus || 'Approved') === s).length;
            return (
              <button
                key={s}
                onClick={() => setApprovalFilter(s)}
                className={`h-8 px-3 text-xs rounded-full border font-medium transition-colors ${
                  approvalFilter === s
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background border-input text-muted-foreground hover:bg-muted'
                }`}
              >
                {s === '__all__' ? 'Të gjitha' : s === 'Submitted' ? 'Në pritje' : s === 'Approved' ? 'Aprovuar' : 'Refuzuar'}
                <span className="ml-1 opacity-60">({count})</span>
              </button>
            );
          })}
        </div>
      </Card>

      <div className="grid grid-cols-3 gap-3 sm:gap-6">
        <Card className="p-3 sm:p-6 space-y-1 sm:space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs sm:text-body-sm text-muted-foreground">
              {activeFilterCount > 0 ? 'Totali i filtruar' : 'Shpenzime Totale'}
            </p>
            <DollarSign className="w-4 h-4 sm:w-5 sm:h-5 text-error" />
          </div>
          <p className="text-lg sm:text-h2 text-foreground font-medium">
            {totalExpenses.toLocaleString()} ALL
          </p>
        </Card>

        <Card className="p-3 sm:p-6 space-y-1 sm:space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs sm:text-body-sm text-muted-foreground">Aktive</p>
            <Building2 className="w-4 h-4 sm:w-5 sm:h-5 text-primary" />
          </div>
          <p className="text-lg sm:text-h2 text-foreground font-medium">
            {activeExpenses}
          </p>
        </Card>

        <Card className="p-3 sm:p-6 space-y-1 sm:space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs sm:text-body-sm text-muted-foreground">Periodike</p>
            <Repeat className="w-4 h-4 sm:w-5 sm:h-5 text-tertiary" />
          </div>
          <p className="text-lg sm:text-h2 text-foreground font-medium">
            {recurringExpenses}
          </p>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
      {/* Shpenzime sipas muajve */}
      <Card className="p-4 sm:p-6 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CalendarIcon className="w-4 h-4 text-muted-foreground" />
            <div>
              <h3 className="text-body font-medium text-foreground">Shpenzime sipas Muajve</h3>
              <p className="text-[11px] text-muted-foreground">Kliko një muaj për ta filtruar listën</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setByMonthYear(y => y - 1)} aria-label="Viti i mëparshëm">‹</Button>
            <Select value={String(byMonthYear)} onValueChange={(v) => setByMonthYear(Number(v))}>
              <SelectTrigger className="h-7 w-full sm:w-[84px] text-body-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                {expenseYears.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button variant="ghost" size="icon" className="h-7 w-7" disabled={byMonthYear >= currentYr} onClick={() => setByMonthYear(y => Math.min(currentYr, y + 1))} aria-label="Viti pasardhës">›</Button>
          </div>
        </div>
        <div className="space-y-2">
          {MONTH_LABELS_SQ.map((label, i) => {
            const val = monthlyExpenses[i];
            const pct = Math.round((val / monthlyMax) * 100);
            // Selected = the list is currently narrowed to exactly this month+year.
            const isSelected = monthFilter === String(i) && yearFilter === String(byMonthYear);
            return (
              <button
                key={label}
                type="button"
                aria-pressed={isSelected}
                onClick={() => {
                  if (isSelected) { setMonthFilter('__all__'); setYearFilter('__all__'); }
                  else { setMonthFilter(String(i)); setYearFilter(String(byMonthYear)); }
                }}
                className={`w-full flex items-center gap-3 rounded-md px-1 py-0.5 text-left transition-colors hover:bg-muted/50 ${
                  isSelected ? 'bg-muted' : ''
                }`}
                title={`Filtro ${MONTH_NAMES_SQ[i]} ${byMonthYear}`}
              >
                <span className={`text-xs w-8 shrink-0 ${isSelected ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>{label}</span>
                <div className="flex-1 h-5 bg-muted/40 rounded-md overflow-hidden">
                  <div className={`h-full rounded-md transition-all ${isSelected ? 'bg-error' : 'bg-error/70'}`} style={{ width: `${pct}%` }} />
                </div>
                <span className="text-xs font-medium text-foreground w-28 text-right tabular-nums">
                  {val > 0 ? `${Math.round(val).toLocaleString()} ALL` : '—'}
                </span>
              </button>
            );
          })}
        </div>
        <div className="flex items-center justify-between pt-2 border-t border-border/40">
          <span className="text-body-sm text-muted-foreground">Totali {byMonthYear}</span>
          <span className="text-body font-semibold text-foreground">{Math.round(yearTotal).toLocaleString()} ALL</span>
        </div>
      </Card>

      {/* Shpenzime sipas kategorive — follows the active filters, and each row is
          itself a filter shortcut. */}
      <Card className="p-4 sm:p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-muted-foreground" />
          <div>
            <h3 className="text-body font-medium text-foreground">Sipas Kategorive</h3>
            <p className="text-[11px] text-muted-foreground">
              {activeFilterCount > 0 ? 'Nga rezultatet e filtruara' : 'Të gjitha shpenzimet'} · kliko për të filtruar
            </p>
          </div>
        </div>
        {categoryBreakdown.length === 0 ? (
          <p className="text-body-sm text-muted-foreground py-6 text-center">Asnjë shpenzim për këtë përzgjedhje.</p>
        ) : (
          <div className="space-y-2">
            {categoryBreakdown.slice(0, 12).map(({ category, value }) => {
              const max = categoryBreakdown[0].value || 1;
              const pct = Math.round((value / max) * 100);
              const share = totalExpenses > 0 ? Math.round((value / totalExpenses) * 100) : 0;
              const isSelected = categoryFilter === category;
              return (
                <button
                  key={category}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => setCategoryFilter(isSelected ? '__all__' : category)}
                  className={`w-full flex items-center gap-3 rounded-md px-1 py-0.5 text-left transition-colors hover:bg-muted/50 ${
                    isSelected ? 'bg-muted' : ''
                  }`}
                >
                  <span className={`text-xs w-28 shrink-0 truncate ${isSelected ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
                    {getCategoryLabel(category)}
                  </span>
                  <div className="flex-1 h-5 bg-muted/40 rounded-md overflow-hidden">
                    <div className={`h-full rounded-md transition-all ${isSelected ? 'bg-primary' : 'bg-primary/60'}`} style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-xs font-medium text-foreground w-28 text-right tabular-nums">
                    {Math.round(value).toLocaleString()} ALL
                    <span className="text-muted-foreground font-normal ml-1">{share}%</span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </Card>
      </div>

      {filteredExpenses.length === 0 && (
        <Card className="p-10 text-center space-y-3">
          <p className="text-body text-muted-foreground">Nuk u gjet asnjë shpenzim me këto filtra.</p>
          {activeFilterCount > 0 && (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={resetFilters}>
              <RotateCcw className="w-3.5 h-3.5" /> Pastro filtrat
            </Button>
          )}
        </Card>
      )}

      {/* Mobile card layout */}
      <div className="sm:hidden space-y-3">
        {visibleExpenses.map((expense) => {
          const team = teams?.find(t => t.id === expense.departmentId);
          const project = (expense as any).projectId ? projectById.get((expense as any).projectId) : undefined;
          const expDate = getExpenseDate(expense);
          return (
            <Card key={expense.id} className="p-4 space-y-3">
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-foreground truncate">{expense.title}</p>
                  {groupSizeById.has(expense.id) && (
                    <Badge className="bg-amber-100 text-amber-800 text-[10px] py-0 mt-1">
                      <AlertTriangle className="w-2.5 h-2.5 mr-0.5" />
                      Dublikatë ×{groupSizeById.get(expense.id)}
                    </Badge>
                  )}
                  {expense.description && (
                    <p className="text-sm text-muted-foreground line-clamp-1 mt-0.5">{expense.description}</p>
                  )}
                </div>
                <Badge variant={expense.status === 'Active' ? 'default' : 'secondary'} className="ml-2 shrink-0">
                  {expense.status === 'Active' ? 'Aktiv' : expense.status === 'Inactive' ? 'Joaktiv' : expense.status}
                </Badge>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge className={getCategoryColor(expense.category)}>
                  {getCategoryLabel(expense.category)}
                </Badge>
                <span className="font-semibold text-foreground">
                  {expense.amount.toLocaleString()} {currencySymbol(expense.currency)}
                </span>
                {team && <span className="text-xs text-muted-foreground">· {team.name}</span>}
              </div>
              {(expDate || project) && (
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {expDate && <span className="inline-flex items-center gap-1"><CalendarIcon className="w-3 h-3" />{expDate.toLocaleDateString('sq-AL')}</span>}
                  {project && <span className="truncate">· {project.name}</span>}
                </div>
              )}
              {expense.isRecurring && (
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  <Repeat className="w-3 h-3 text-tertiary" />
                  Periodike: {getFreqLabel(expense.recurringFrequency)}
                  {(expense as any).recurringEndDate && (
                    <span>· deri më {new Date((expense as any).recurringEndDate).toLocaleDateString()}</span>
                  )}
                  {(expense as any).isRecurringPaused && (
                    <Badge className="bg-amber-100 text-amber-800 text-[10px] py-0"><Pause className="w-2.5 h-2.5 mr-0.5" />Në pauzë</Badge>
                  )}
                </div>
              )}
              {(expense as any).autoGenerated && (
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Repeat className="w-3 h-3" /> Gjeneruar automatikisht
                </div>
              )}
              {(expense as any).approvalStatus && (
                <div className="flex items-center gap-1">
                  {(expense as any).approvalStatus === 'Submitted' && <Badge className="bg-amber-100 text-amber-800 text-xs"><Clock className="w-3 h-3 mr-1" />Në Pritje</Badge>}
                  {(expense as any).approvalStatus === 'Approved' && <Badge className="bg-green-100 text-green-800 text-xs"><Check className="w-3 h-3 mr-1" />Aprovuar</Badge>}
                  {(expense as any).approvalStatus === 'Rejected' && <Badge className="bg-red-100 text-red-800 text-xs"><X className="w-3 h-3 mr-1" />Refuzuar</Badge>}
                </div>
              )}
              {permissions.canEdit && (
                <div className="flex gap-2 pt-1 border-t">
                  <Button variant="outline" size="sm" className="flex-1 gap-1" onClick={() => { setSelectedExpense(expense); setIsEditDialogOpen(true); }}>
                    <Pencil className="w-3.5 h-3.5" /> Ndrysho
                  </Button>
                  {expense.isRecurring && !(expense as any).autoGenerated && (
                    <Button
                      variant="outline" size="sm"
                      className="text-amber-600 hover:text-amber-700 border-amber-200"
                      title={(expense as any).isRecurringPaused ? 'Rifillo përsëritjen' : 'Pauzo përsëritjen'}
                      onClick={() => handleTogglePause(expense)}
                    >
                      {(expense as any).isRecurringPaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
                    </Button>
                  )}
                  {isAdminOrManager && (expense as any).approvalStatus === 'Submitted' && (
                    <>
                      <Button variant="outline" size="sm" className="text-green-600 hover:text-green-700 border-green-200" onClick={() => handleApproveExpense(expense.id)}>
                        <ThumbsUp className="w-3.5 h-3.5" />
                      </Button>
                      <Button variant="outline" size="sm" className="text-red-600 hover:text-red-700 border-red-200" onClick={() => handleRejectExpense(expense.id)}>
                        <ThumbsDown className="w-3.5 h-3.5" />
                      </Button>
                    </>
                  )}
                  <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => handleDeleteExpense(expense)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              )}
            </Card>
          );
        })}
      </div>

      {/* Desktop table */}
      <Card className={`overflow-hidden hidden ${filteredExpenses.length > 0 ? 'sm:block' : ''}`}>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-muted">
              <tr>
                <th className="px-6 py-4 text-left text-body-sm font-medium text-foreground">
                  Shpenzimi
                </th>
                <th className="px-6 py-4 text-left text-body-sm font-medium text-foreground">
                  Kategoria
                </th>
                <th className="px-6 py-4 text-left text-body-sm font-medium text-foreground">
                  Shuma
                </th>
                <th className="px-6 py-4 text-left text-body-sm font-medium text-foreground">
                  Data
                </th>
                <th className="px-6 py-4 text-left text-body-sm font-medium text-foreground">
                  Departamenti
                </th>
                <th className="px-6 py-4 text-left text-body-sm font-medium text-foreground">
                  Periodike
                </th>
                <th className="px-6 py-4 text-left text-body-sm font-medium text-foreground">
                  Statusi
                </th>
                <th className="px-6 py-4 text-left text-body-sm font-medium text-foreground">
                  Veprime
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {visibleExpenses.map((expense) => {
                const team = teams?.find(t => t.id === expense.departmentId);
                const project = (expense as any).projectId ? projectById.get((expense as any).projectId) : undefined;
                const expDate = getExpenseDate(expense);

                return (
                  <tr
                    key={expense.id}
                    className="hover:bg-muted/50 transition-colors duration-fast"
                  >
                    <td className="px-6 py-4">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <p className="text-body font-normal text-foreground">{expense.title}</p>
                          {groupSizeById.has(expense.id) && (
                            <Badge
                              className="bg-amber-100 text-amber-800 text-[10px] py-0"
                              title={`${groupSizeById.get(expense.id)} regjistrime identike në të njëjtin muaj`}
                            >
                              <AlertTriangle className="w-2.5 h-2.5 mr-0.5" />
                              Dublikatë ×{groupSizeById.get(expense.id)}
                            </Badge>
                          )}
                        </div>
                        {expense.description && (
                          <p className="text-body-sm text-muted-foreground line-clamp-1">
                            {expense.description}
                          </p>
                        )}
                        {project && (
                          <p className="text-[11px] text-muted-foreground truncate max-w-[240px]">
                            Projekt: {project.name}
                          </p>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <Badge className={getCategoryColor(expense.category)}>
                        {getCategoryLabel(expense.category)}
                      </Badge>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-1">
                        <span className="text-body font-semibold text-foreground">
                          {expense.amount.toLocaleString()}
                        </span>
                        <span className="text-body-sm text-muted-foreground">
                          {currencySymbol(expense.currency)}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-body-sm text-muted-foreground whitespace-nowrap">
                      {expDate ? expDate.toLocaleDateString('sq-AL') : '-'}
                    </td>
                    <td className="px-6 py-4 text-body text-foreground">
                      {team ? team.name : '-'}
                    </td>
                    <td className="px-6 py-4">
                      {expense.isRecurring ? (
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-2">
                            <Repeat className="w-4 h-4 text-tertiary" />
                            <span className="text-body-sm text-foreground">
                              {getFreqLabel(expense.recurringFrequency)}
                            </span>
                            {(expense as any).isRecurringPaused && (
                              <Badge className="bg-amber-100 text-amber-800 text-[10px] py-0"><Pause className="w-2.5 h-2.5 mr-0.5" />Pauzë</Badge>
                            )}
                          </div>
                          {(expense as any).recurringEndDate && (
                            <span className="text-[11px] text-muted-foreground">deri më {new Date((expense as any).recurringEndDate).toLocaleDateString()}</span>
                          )}
                          {/* No due date = the series has never generated anything.
                              The cron seeds one on its next run; flag it until then. */}
                          {!(expense as any).nextRecurringDate && !(expense as any).isRecurringPaused && (
                            <span className="text-[11px] text-amber-600 inline-flex items-center gap-1">
                              <AlertTriangle className="w-3 h-3" /> pa datë — nuk gjeneron
                            </span>
                          )}
                        </div>
                      ) : (expense as any).autoGenerated ? (
                        <span className="text-body-sm text-muted-foreground flex items-center gap-1"><Repeat className="w-3.5 h-3.5" />Auto</span>
                      ) : (
                        <span className="text-body-sm text-muted-foreground">Njëherësh</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col gap-1">
                        <Badge variant={expense.status === 'Active' ? 'default' : 'secondary'}>
                          {expense.status === 'Active' ? 'Aktiv' : expense.status === 'Inactive' ? 'Joaktiv' : expense.status}
                        </Badge>
                        {(expense as any).approvalStatus === 'Submitted' && <Badge className="bg-amber-100 text-amber-800 text-xs w-fit"><Clock className="w-3 h-3 mr-1" />Në Pritje</Badge>}
                        {(expense as any).approvalStatus === 'Approved' && <Badge className="bg-green-100 text-green-800 text-xs w-fit"><Check className="w-3 h-3 mr-1" />Aprovuar</Badge>}
                        {(expense as any).approvalStatus === 'Rejected' && <Badge className="bg-red-100 text-red-800 text-xs w-fit"><X className="w-3 h-3 mr-1" />Refuzuar</Badge>}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex gap-2 flex-wrap">
                        {permissions.canEdit && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setSelectedExpense(expense);
                              setIsEditDialogOpen(true);
                            }}
                          >
                            Ndrysho
                          </Button>
                        )}
                        {permissions.canEdit && expense.isRecurring && !(expense as any).autoGenerated && (
                          <Button
                            variant="outline" size="sm"
                            className="text-amber-600 hover:text-amber-700 border-amber-200 gap-1"
                            onClick={() => handleTogglePause(expense)}
                          >
                            {(expense as any).isRecurringPaused ? <><Play className="w-3.5 h-3.5" /> Rifillo</> : <><Pause className="w-3.5 h-3.5" /> Pauzo</>}
                          </Button>
                        )}
                        {isAdminOrManager && (expense as any).approvalStatus === 'Submitted' && (
                          <>
                            <Button variant="outline" size="sm" className="text-green-600 hover:text-green-700 border-green-200 gap-1" onClick={() => handleApproveExpense(expense.id)}>
                              <ThumbsUp className="w-3.5 h-3.5" /> Aprovo
                            </Button>
                            <Button variant="outline" size="sm" className="text-red-600 hover:text-red-700 border-red-200 gap-1" onClick={() => handleRejectExpense(expense.id)}>
                              <ThumbsDown className="w-3.5 h-3.5" /> Refuzo
                            </Button>
                          </>
                        )}
                        {permissions.canEdit && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            onClick={() => handleDeleteExpense(expense)}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {filteredExpenses.length > visibleExpenses.length && (
        <div className="flex flex-col items-center gap-2">
          <p className="text-body-sm text-muted-foreground">
            {visibleExpenses.length} nga {filteredExpenses.length} shpenzime
          </p>
          <Button variant="outline" onClick={() => setVisibleCount(c => c + 50)}>
            Shfaq më shumë
          </Button>
        </div>
      )}

      {selectedExpense && (
        <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Ndrysho Shpenzimin</DialogTitle>
            </DialogHeader>
            <ExpenseForm onSubmit={handleUpdateExpense} teams={teams || []} projects={projects || []} initialData={selectedExpense} />
          </DialogContent>
        </Dialog>
      )}

      {/* Recurring-aware delete: stop vs delete-one vs delete-whole-series */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Fshi / ndërprit shpenzimin periodik</DialogTitle>
          </DialogHeader>
          {deleteTarget && (() => {
            const kids = childrenOf(deleteTarget.id).length;
            return (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">{deleteTarget.title}</span> është periodik
                  {kids > 0 && <> me <span className="font-medium text-foreground">{kids}</span> regjistrime të gjeneruara</>}.
                  Zgjidh çfarë të bëhet:
                </p>

                <div className="space-y-2">
                  {deleteTarget.isRecurring && (
                    <label className={`flex gap-3 rounded-lg border p-3 cursor-pointer ${deleteMode === 'stop' ? 'border-primary bg-primary/5' : ''}`}>
                      <input type="radio" name="delmode" className="mt-1" checked={deleteMode === 'stop'} onChange={() => setDeleteMode('stop')} />
                      <div>
                        <div className="text-sm font-medium flex items-center gap-1.5"><CircleStop className="w-4 h-4 text-emerald-600" /> Ndërprit përsëritjen <Badge className="bg-emerald-100 text-emerald-800 text-[10px] py-0">Rekomanduar</Badge></div>
                        <p className="text-xs text-muted-foreground mt-0.5">Nuk gjenerohen më muaj të rinj. Ky regjistrim dhe të gjithë muajt e kaluar mbeten të paprekur.</p>
                      </div>
                    </label>
                  )}

                  <label className={`flex gap-3 rounded-lg border p-3 cursor-pointer ${deleteMode === 'one' ? 'border-primary bg-primary/5' : ''}`}>
                    <input type="radio" name="delmode" className="mt-1" checked={deleteMode === 'one'} onChange={() => setDeleteMode('one')} />
                    <div>
                      <div className="text-sm font-medium flex items-center gap-1.5"><Trash2 className="w-4 h-4" /> Fshi vetëm këtë regjistrim</div>
                      <p className="text-xs text-muted-foreground mt-0.5">Fshihet vetëm ky zë. {deleteTarget.isRecurring && 'Përsëritja vazhdon dhe muajt e gjeneruar mbeten.'}</p>
                    </div>
                  </label>

                  <label className={`flex gap-3 rounded-lg border p-3 cursor-pointer ${deleteMode === 'series' ? 'border-destructive bg-destructive/5' : ''}`}>
                    <input type="radio" name="delmode" className="mt-1" checked={deleteMode === 'series'} onChange={() => setDeleteMode('series')} />
                    <div>
                      <div className="text-sm font-medium flex items-center gap-1.5 text-destructive"><AlertTriangle className="w-4 h-4" /> Fshi gjithë serinë</div>
                      <p className="text-xs text-muted-foreground mt-0.5">Fshihet ky zë <span className="font-medium text-foreground">dhe të gjithë muajt e kaluar</span> ({kids}). Kjo prek raportet dhe P&L-në e së kaluarës — s'ka kthim.</p>
                    </div>
                  </label>
                </div>

                <div className="flex justify-end gap-2 pt-1">
                  <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleteBusy}>Anulo</Button>
                  <Button
                    className={deleteMode === 'series' ? 'bg-destructive hover:bg-destructive/90' : ''}
                    onClick={confirmDelete}
                    disabled={deleteBusy}
                  >
                    {deleteBusy ? 'Duke ruajtur…' : deleteMode === 'stop' ? 'Ndërprit' : 'Fshi'}
                  </Button>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
};

const MONTH_NAMES_SQ = [
  'Janar', 'Shkurt', 'Mars', 'Prill', 'Maj', 'Qershor',
  'Korrik', 'Gusht', 'Shtator', 'Tetor', 'Nëntor', 'Dhjetor',
];

const FREQ_LABELS: Record<string, string> = {
  weekly: 'Javore',
  monthly: 'Mujore',
  yearly: 'Vjetore',
};
const getFreqLabel = (f?: string) => (f ? (FREQ_LABELS[f] || f) : '');

const DEFAULT_CATEGORIES: { value: string; label: string }[] = [
  { value: 'Salary', label: 'Paga' },
  { value: 'Rent', label: 'Qira' },
  { value: 'Utilities', label: 'Shërbime (Ujë, Dritë)' },
  { value: 'Office', label: 'Furnizime Zyre' },
  { value: 'Hosting', label: 'Hosting & Software' },
  { value: 'Marketing', label: 'Marketing' },
  { value: 'Travel', label: 'Udhëtim' },
  { value: 'Other', label: 'Tjetër' },
];

const ExpenseForm: React.FC<{
  onSubmit: (data: FormData) => void | Promise<void>;
  teams: Team[];
  projects?: Project[];
  initialData?: Expense;
}> = ({ onSubmit, teams, projects, initialData }) => {
  const [isRecurring, setIsRecurring] = useState(initialData?.isRecurring || false);
  // Without this, a second click while the create is in flight writes the expense twice.
  const [submitting, setSubmitting] = useState(false);
  const [projectSearch, setProjectSearch] = useState('');
  const [selectedMemberId, setSelectedMemberId] = useState<string>((initialData as any)?.memberId || '__none__');
  const { data: rawTeamMembersForm } = useCollection<TeamMember>('teamMembers', {
    where: [{ field: 'status', operator: '==', value: 'Active' }],
    skipTeamFilter: true,
  });
  const teamMembers = useUniqueTeamMembers(rawTeamMembersForm);

  // Custom categories stored in Firestore
  const { data: customCategoryDocs } = useCollection<{ id: string; label: string }>('expenseCategories');
  const categoryMutation = useMutation<{ label: string }>('expenseCategories');
  const [selectedCategory, setSelectedCategory] = useState(initialData?.category || 'Office');
  const [newCategoryInput, setNewCategoryInput] = useState('');
  const [isAddingCategory, setIsAddingCategory] = useState(false);

  const allCategories = [
    ...DEFAULT_CATEGORIES,
    ...(customCategoryDocs || []).map(d => ({ value: d.label, label: d.label })),
  ];

  const handleAddCategory = async () => {
    const trimmed = newCategoryInput.trim();
    if (!trimmed) return;
    const alreadyExists = allCategories.some(c => c.value.toLowerCase() === trimmed.toLowerCase());
    if (!alreadyExists) {
      await categoryMutation.create({ label: trimmed });
    }
    setSelectedCategory(trimmed);
    setIsAddingCategory(false);
    setNewCategoryInput('');
  };
  const [selectedProjectId, setSelectedProjectId] = useState<string>((initialData as any)?.projectId || '__none__');
  const [nextRecurringDate, setNextRecurringDate] = useState<Date | undefined>(
    initialData?.nextRecurringDate ? new Date(initialData.nextRecurringDate) : undefined
  );
  const [recurringEndDate, setRecurringEndDate] = useState<Date | undefined>(
    (initialData as any)?.recurringEndDate ? new Date((initialData as any).recurringEndDate) : undefined
  );
  const [paidDate, setPaidDate] = useState<Date | undefined>(
    initialData?.paidDate ? new Date(initialData.paidDate) : undefined
  );

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (submitting) return;
    const formData = new FormData(e.currentTarget);
    formData.set('isRecurring', isRecurring.toString());
    if (nextRecurringDate) {
      formData.set('nextRecurringDate', nextRecurringDate.toISOString());
    }
    if (recurringEndDate) {
      formData.set('recurringEndDate', recurringEndDate.toISOString());
    }
    if (paidDate) {
      formData.set('paidDate', paidDate.toISOString());
    }
    setSubmitting(true);
    try {
      await onSubmit(formData);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-h-[70vh] overflow-y-auto px-1">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label htmlFor="title">Titulli i Shpenzimit *</Label>
          <Input id="title" name="title" required defaultValue={initialData?.title} />
        </div>

        <div>
          <Label htmlFor="category">Kategoria *</Label>
          {/* Hidden input so FormData always carries the value */}
          <input type="hidden" name="category" value={selectedCategory} />
          <Select value={selectedCategory} onValueChange={v => { if (v !== '__add__') setSelectedCategory(v); }}>
            <SelectTrigger>
              <SelectValue placeholder="Zgjidh kategorinë" />
            </SelectTrigger>
            <SelectContent>
              {allCategories.map(cat => (
                <SelectItem key={cat.value} value={cat.value}>{cat.label}</SelectItem>
              ))}
              {/* Inline add new category */}
              <div className="border-t mt-1 pt-1">
                {isAddingCategory ? (
                  <div className="flex items-center gap-1 px-2 py-1.5" onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
                    <input
                      autoFocus
                      className="flex-1 text-sm bg-transparent outline-none border-b border-border placeholder:text-muted-foreground"
                      placeholder="Emri i kategorisë..."
                      value={newCategoryInput}
                      onChange={e => setNewCategoryInput(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddCategory(); } if (e.key === 'Escape') { setIsAddingCategory(false); setNewCategoryInput(''); } }}
                    />
                    <button type="button" onClick={handleAddCategory} className="p-0.5 text-green-600 hover:text-green-700"><Check className="h-3.5 w-3.5" /></button>
                    <button type="button" onClick={() => { setIsAddingCategory(false); setNewCategoryInput(''); }} className="p-0.5 text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="w-full flex items-center gap-2 px-2 py-1.5 text-sm text-primary hover:bg-muted/50 rounded-sm"
                    onClick={e => { e.preventDefault(); e.stopPropagation(); setIsAddingCategory(true); }}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Shto kategori të re...
                  </button>
                )}
              </div>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label htmlFor="amount">Shuma *</Label>
          <Input
            id="amount"
            name="amount"
            type="number"
            step="0.01"
            min="0"
            required
            defaultValue={initialData?.amount}
          />
        </div>

        <div>
          <Label htmlFor="currency">Monedha *</Label>
          <Select name="currency" defaultValue={initialData?.currency || 'ALL'}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">ALL (Albanian Lek)</SelectItem>
              <SelectItem value="EUR">EUR (Euro)</SelectItem>
              <SelectItem value="USD">USD (US Dollar)</SelectItem>
              <SelectItem value="GBP">GBP (British Pound)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div>
        <Label htmlFor="departmentId">Departamenti (Opsionale)</Label>
        <Select name="departmentId" defaultValue={initialData?.departmentId}>
          <SelectTrigger>
            <SelectValue placeholder="Zgjidh departamentin" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">Asnjë</SelectItem>
            {teams.map(team => (
              <SelectItem key={team.id} value={team.id}>
                {team.name} {team.department ? `(${team.department})` : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {selectedCategory === 'Salary' && (
        <div>
          <Label htmlFor="memberId">Anëtar i stafit (Opsionale)</Label>
          <input type="hidden" name="memberId" value={selectedMemberId} />
          <Select value={selectedMemberId} onValueChange={setSelectedMemberId}>
            <SelectTrigger>
              <SelectValue placeholder="Zgjidh anëtarin..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">Pa lidhje me anëtar</SelectItem>
              {(teamMembers || []).map(m => (
                <SelectItem key={m.userId} value={m.userId}>
                  {m.name || m.email || m.userId}
                  {m.monthlySalary ? ` — ${m.monthlySalary.toLocaleString('sq-AL')} L/muaj` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div>
        <Label htmlFor="projectId">Projekti (Opsionale)</Label>
        {/* Hidden input so FormData picks up the value */}
        <input type="hidden" name="projectId" value={selectedProjectId} />
        <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
          <SelectTrigger>
            <SelectValue placeholder="Lidh me projekt" />
          </SelectTrigger>
          <SelectContent>
            {/* Search box inside dropdown */}
            <div className="flex items-center gap-1.5 px-2 py-1.5 border-b">
              <Search className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
              <input
                className="flex-1 text-sm bg-transparent outline-none placeholder:text-muted-foreground"
                placeholder="Kërko projekt..."
                value={projectSearch}
                onChange={e => setProjectSearch(e.target.value)}
                onClick={e => e.stopPropagation()}
                onKeyDown={e => e.stopPropagation()}
              />
            </div>
            <SelectItem value="__none__">Asnjë projekt</SelectItem>
            {sortArchivedLast(
              (projects || []).filter(p => p.name.toLowerCase().includes(projectSearch.toLowerCase()))
            ).map(p => (
              <SelectItem key={p.id} value={p.id}>{projectPickerLabel(p)}</SelectItem>
            ))}
            {projects?.filter(p => p.name.toLowerCase().includes(projectSearch.toLowerCase())).length === 0 && (
              <div className="px-3 py-2 text-sm text-muted-foreground">Asnjë rezultat</div>
            )}
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label htmlFor="description">Përshkrimi</Label>
        <Textarea id="description" name="description" rows={3} defaultValue={initialData?.description} />
      </div>

      <div className="flex items-center space-x-2">
        <Switch
          id="isRecurring"
          checked={isRecurring}
          onCheckedChange={setIsRecurring}
        />
        <Label htmlFor="isRecurring">Shpenzim Periodik</Label>
      </div>

      {isRecurring && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="recurringFrequency">Frekuenca *</Label>
            <Select name="recurringFrequency" defaultValue={initialData?.recurringFrequency || 'monthly'}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="weekly">Javore</SelectItem>
                <SelectItem value="monthly">Mujore</SelectItem>
                <SelectItem value="yearly">Vjetore</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Data e Ardhshme Periodike</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full justify-start">
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {nextRecurringDate ? nextRecurringDate.toLocaleDateString() : "Zgjidh datën"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0">
                <Calendar mode="single" selected={nextRecurringDate} onSelect={setNextRecurringDate} />
              </PopoverContent>
            </Popover>
            {!initialData && (
              <p className="text-[11px] text-muted-foreground mt-1">
                Ky regjistrim vlen për periudhën aktuale. Gjenerimi automatik fillon nga
                periudha pasardhëse — ndryshe muaji do të numërohej dy herë.
              </p>
            )}
          </div>

          <div>
            <Label>Përsërit deri më (opsionale)</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full justify-start">
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {recurringEndDate ? recurringEndDate.toLocaleDateString() : "Pa fund (deri e ndërpret)"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0">
                <Calendar mode="single" selected={recurringEndDate} onSelect={setRecurringEndDate} />
                {recurringEndDate && (
                  <div className="p-2 border-t">
                    <Button type="button" variant="ghost" size="sm" className="w-full text-xs" onClick={() => setRecurringEndDate(undefined)}>
                      Hiq datën e fundit
                    </Button>
                  </div>
                )}
              </PopoverContent>
            </Popover>
            <p className="text-[11px] text-muted-foreground mt-1">Pas kësaj date, sistemi ndalon automatikisht gjenerimin. Muajt e kaluar mbeten.</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label htmlFor="status">Statusi *</Label>
          <Select name="status" defaultValue={initialData?.status || 'Active'}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Active">Aktiv</SelectItem>
              <SelectItem value="Inactive">Joaktiv</SelectItem>
              <SelectItem value="Cancelled">Anuluar</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label>Data e Pagesës (Opsionale)</Label>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="w-full justify-start">
                <CalendarIcon className="mr-2 h-4 w-4" />
                {paidDate ? paidDate.toLocaleDateString() : "Zgjidh datën"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0">
              <Calendar mode="single" selected={paidDate} onSelect={setPaidDate} />
            </PopoverContent>
          </Popover>
        </div>
      </div>

      <Button type="submit" className="w-full" disabled={submitting}>
        {submitting ? 'Duke ruajtur…' : initialData ? 'Përditëso Shpenzimin' : 'Krijo Shpenzimin'}
      </Button>
    </form>
  );
};

export default ExpensesView;
