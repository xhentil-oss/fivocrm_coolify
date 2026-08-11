import React, { useState, useEffect, useMemo } from 'react';
import { useCollection, useMutation, useGlobalTeamId, useGlobalBusinessId } from '../hooks/useFirestore';
import { useTeamSettingsData } from '../hooks/useTeamSettings';
import { getNextInvoiceNumber } from '../lib/firebase';
import { useUnsavedChanges } from '../hooks/useUnsavedChanges';
import { usePermissions } from '../contexts/PermissionsContext';
import { useActivityLogger } from '../hooks/useActivityLogger';
import { useAuth } from '../contexts/AuthContext';
import {
  DollarSign,
  Plus,
  Calendar as CalendarIcon,
  CreditCard,
  Mail,
  Send,
  Building2,
  Trash2,
  Eye,
  Edit2,
  Check,
  X,
  ExternalLink,
  Loader2,
  MoreVertical,
  Download,
  ChevronsUpDown,
  RefreshCw,
  Pause,
  Play,
  CircleStop,
  AlertTriangle,
  Folder,
} from 'lucide-react';
import ExportButton from '../components/ExportButton';
import { Card } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Calendar } from '../components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '../components/ui/select';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '../components/ui/command';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '../components/ui/alert-dialog';
import { Textarea } from '../components/ui/textarea';
import {
  buildRevenueByMonthByBasis,
  getInvoiceCollectedBetween,
  type AccountingBasis,
} from '../lib/finance/financialAnalytics';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import type { Invoice, Customer, Service, InvoiceItem, Project, ClientPortalAccess, Payment } from '../types';
import { useFilteredByOwner } from '../hooks/useRoleFilteredData';
import { toAll, getRateToAll, getTimestampMs, canSeeFinancials } from '../lib/utils';
import { toast } from '../hooks/use-toast';
import { getStatusColor, getInvoiceStatusLabel } from '../lib/statusColors';
import { projectPickerLabel, sortArchivedLast } from '../lib/projectArchive';
import { appReturnUrl, openCheckout, openExternal, saveOrShareFile } from '../lib/native';
import { resolvePortalUserId } from '../lib/notifyClient';

// Presentation-only status pill: a subtle tinted pill + a small coloured dot.
// Reuses the existing semantic tokens (success/warning/error/muted + brand cyan)
// and getInvoiceStatusLabel for the fallback label.
type StatusPill = { dotClass: string; label: string; pillClass: string };
const statusPill = (status: string | null | undefined): StatusPill => {
  switch (status) {
    case 'Paid':
      return { dotClass: 'bg-success', label: 'Paguar', pillClass: 'bg-success/10 text-success' };
    case 'Pending':
      return { dotClass: 'bg-warning', label: 'Në pritje', pillClass: 'bg-warning/10 text-warning' };
    case 'Overdue':
      return { dotClass: 'bg-error', label: 'Vonuar', pillClass: 'bg-error/10 text-error' };
    case 'Partial':
      return { dotClass: 'bg-cyan-500', label: 'Pjesore', pillClass: 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-400' };
    case 'Draft':
      return { dotClass: 'bg-muted-foreground/60', label: 'Draft', pillClass: 'bg-muted text-muted-foreground' };
    case 'Cancelled':
      return { dotClass: 'bg-muted-foreground/60', label: 'Anuluar', pillClass: 'bg-muted text-muted-foreground' };
    default:
      return { dotClass: 'bg-muted-foreground/60', label: getInvoiceStatusLabel(status), pillClass: 'bg-muted text-muted-foreground' };
  }
};

// Initials for the client avatar (first + last word initial).
const initialsOf = (name?: string | null): string => {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

const InvoicesView: React.FC = () => {
  const permissions = usePermissions();
  const logActivity = useActivityLogger();
  const { user } = useAuth();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [editInvoice, setEditInvoice] = useState<Invoice | null>(null);
  const { setDirty, isDirtyRef, discardOpen, requestClose, confirmDiscard, cancelDiscard } = useUnsavedChanges();
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [editingInvoiceId, setEditingInvoiceId] = useState<string | null>(null);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const [invoiceToDelete, setInvoiceToDelete] = useState<string | null>(null);
  // Quick project link straight from the list — the companion to the "Pa projekt"
  // filter, so fixing a batch of unlinked invoices doesn't mean opening the full
  // edit form (and re-saving every other field) once per invoice.
  const [linkProjectInvoice, setLinkProjectInvoice] = useState<Invoice | null>(null);
  const [linkProjectSearch, setLinkProjectSearch] = useState('');
  const [linkProjectSaving, setLinkProjectSaving] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('__all__');
  // '__all__' | '__none__' (invoices with no project — the ones that fall out of the
  // per-project P&L) | a concrete projectId.
  const [projectFilter, setProjectFilter] = useState<string>('__all__');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'date_desc' | 'date_asc' | 'amount_desc' | 'amount_asc'>('date_desc');
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  // Filter the list by a specific month ('__all__' = no month filter). Combined
  // with selectedYear, so choosing a month narrows to that month of that year.
  const [monthFilter, setMonthFilter] = useState<string>('__all__');
  // Accounting basis: Accrual (date of invoice) vs Cash (date of payment).
  // Default = Accrual (IFRS/GAAP standard for proper P&L reporting).
  const [accountingBasis, setAccountingBasis] = useState<AccountingBasis>('accrual');
  const [partialPaymentInvoice, setPartialPaymentInvoice] = useState<Invoice | null>(null);
  const [partialAmount, setPartialAmount] = useState('');
  const [partialMethod, setPartialMethod] = useState('Cash');
  const [partialNote, setPartialNote] = useState('');
  const [partialSaving, setPartialSaving] = useState(false);
  const [paidAtDate, setPaidAtDate] = useState('');
  const [triggeringRecurring, setTriggeringRecurring] = useState(false);
  const [showRecurringConfirm, setShowRecurringConfirm] = useState(false);
  // Recurring-aware delete: a parent opens a choice (stop / delete one / series).
  const [deleteMode, setDeleteMode] = useState<'stop' | 'one' | 'series'>('stop');
  const [deleteBusy, setDeleteBusy] = useState(false);
  // Right-side quick-edit drawer (presentation): row click opens it, seeded from the
  // clicked invoice. Saves via the existing invoiceMutation.update — no new data path.
  const [drawerInvoice, setDrawerInvoice] = useState<Invoice | null>(null);
  const [drawerCustomer, setDrawerCustomer] = useState('');
  const [drawerProject, setDrawerProject] = useState('');
  const [drawerTotal, setDrawerTotal] = useState('');
  const [drawerDue, setDrawerDue] = useState('');
  const [drawerStatus, setDrawerStatus] = useState('');
  const [drawerSaving, setDrawerSaving] = useState(false);

  const { data: rawInvoices, loading: invoicesLoading } = useCollection<Invoice>('invoices', {
    orderBy: { field: 'createdAt', direction: 'desc' },
    skipTeamFilter: true,
  });
  // Role-based filtering: Member/Viewer see only invoices they created
  const invoices = useFilteredByOwner(rawInvoices);

  // Handle Stripe redirect params — verify actual invoice status before showing success
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const payment = params.get('payment');
    const invoiceId = params.get('invoice');
    if (payment === 'success' && invoiceId) {
      // Wait for invoices to load then verify the invoice is actually paid
      const checkStatus = () => {
        const inv = rawInvoices?.find(i => i.id === invoiceId);
        if (inv) {
          if (inv.status === 'Paid') {
            toast({ title: 'Pagesa u krye me sukses!', description: `Fatura u shënua si e paguar.` });
          } else {
            // Payment may still be processing via webhook
            toast({ title: 'Pagesa në procesim', description: 'Pagesa u pranua dhe po verifikohet. Statusi do të përditësohet së shpejti.' });
          }
        } else {
          toast({ title: 'Pagesa u pranua', description: 'Statusi i faturës po verifikohet.' });
        }
      };
      // Small delay to allow Firestore data to load
      const timer = setTimeout(checkStatus, 1500);
      window.history.replaceState({}, '', window.location.pathname);
      return () => clearTimeout(timer);
    } else if (payment === 'cancelled') {
      toast({ title: 'Pagesa u anulua', variant: 'destructive' });
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [rawInvoices]);
  const { data: customers } = useCollection<Customer>('customers', { skipTeamFilter: true });
  // Projects are needed in the LIST, not just the form: the invoice↔project link was
  // write-only, so nobody could see (or fix) which invoices were unlinked — and an
  // unlinked invoice silently drops out of the per-project P&L.
  const { data: allProjects } = useCollection<Project>('projects', { skipTeamFilter: true });
  const projectById = React.useMemo(
    () => new Map((allProjects || []).map(p => [p.id, p] as const)),
    [allProjects],
  );
  const { data: allInvoiceItems } = useCollection<InvoiceItem>('invoiceItems', { skipTeamFilter: true });
  const invoiceMutation = useMutation<Invoice>('invoices');
  const invoiceItemMutationTop = useMutation<InvoiceItem>('invoiceItems');
  const notificationMutation = useMutation<any>('notifications');
  const paymentMutation = useMutation<Payment>('payments');
  const { data: teamMembers } = useCollection<any>('teamMembers', {
    where: [{ field: 'status', operator: '==', value: 'Active' }],
  });
  // Defence in depth: reads are already business-scoped, but notification recipients
  // re-check businessId — marking an invoice paid must never email another tenant.
  const activeBusinessId = useGlobalBusinessId();
  const scopedMembers = useMemo(
    () => (teamMembers || []).filter((m: any) => !activeBusinessId || !m.businessId || m.businessId === activeBusinessId),
    [teamMembers, activeBusinessId]
  );

  // Auto-generated occurrences of a recurring parent invoice.
  const childrenOfInvoice = (parentId: string) =>
    (rawInvoices || []).filter(i => (i as any).parentInvoiceId === parentId);

  // Hard-remove one invoice doc and its line items.
  const removeInvoiceWithItems = async (id: string) => {
    await invoiceMutation.remove(id);
    const relatedItems = allInvoiceItems?.filter(item => (item as any).invoiceId === id) || [];
    await Promise.all(relatedItems.map(item => invoiceItemMutationTop.remove(item.id)));
  };

  // Pause/resume generation without ending the series.
  const handleToggleInvoicePause = async (invoice: Invoice) => {
    await invoiceMutation.update(invoice.id, { isRecurringPaused: !(invoice as any).isRecurringPaused } as any);
    toast({ title: (invoice as any).isRecurringPaused ? 'Përsëritja u rifillua' : 'Përsëritja u pauzua' });
  };

  // Link (or unlink) an invoice to a project without touching any other field.
  const handleLinkProject = async (invoice: Invoice, projectId: string) => {
    setLinkProjectSaving(true);
    try {
      await invoiceMutation.update(invoice.id, { projectId } as any);
      const projectName = projectId ? projectById.get(projectId)?.name : undefined;
      logActivity(
        'invoice_updated',
        projectId
          ? `Fatura ${invoice.invoiceNumber || invoice.id.slice(0, 8)} u lidh me projektin "${projectName || projectId}"`
          : `Fatura ${invoice.invoiceNumber || invoice.id.slice(0, 8)} u shkëput nga projekti`,
        { entityType: 'invoice', entityId: invoice.id },
      );
      toast({ title: projectId ? `U lidh me "${projectName || 'projektin'}"` : 'Lidhja me projektin u hoq' });
      setLinkProjectInvoice(null);
      setLinkProjectSearch('');
    } catch (err) {
      console.error('[InvoicesView] lidhja me projektin dështoi:', err);
      toast({ title: 'Lidhja me projektin dështoi', variant: 'destructive' });
    } finally {
      setLinkProjectSaving(false);
    }
  };

  // Stop recurrence for good: keep this invoice + all past ones, never generate again.
  const handleStopInvoiceRecurrence = async (invoice: Invoice) => {
    await invoiceMutation.update(invoice.id, {
      isRecurring: false,
      isRecurringPaused: false,
      nextRecurringDate: null,
    } as any);
  };

  // Default the delete dialog to "stop" for recurring parents, else "delete one".
  useEffect(() => {
    if (!invoiceToDelete) return;
    const t = rawInvoices?.find(i => i.id === invoiceToDelete);
    const isParent = !!t && (t as any).isRecurring && !(t as any).autoGenerated;
    setDeleteMode(isParent ? 'stop' : 'one');
  }, [invoiceToDelete, rawInvoices]);

  const handleDeleteInvoice = async (id: string) => {
    try {
      const target = invoices?.find(inv => inv.id === id);
      // WHMCS invoices are mirror copies — hard-deleting them just lets the next
      // sync re-create them (and revenue comes back). Cancel instead: mark
      // Cancelled + locallyCancelled (sync preserves it, excluded from revenue).
      if (target?.source === 'whmcs') {
        await invoiceMutation.update(id, { status: 'Cancelled', locallyCancelled: true } as any);
        toast({ title: 'Fatura WHMCS u anulua', description: 'Nuk numërohet më te të ardhurat dhe nuk rikthehet nga sinkronizimi.' });
        setInvoiceToDelete(null);
        return;
      }
      await removeInvoiceWithItems(id);
      toast({ title: 'Fatura u fshi me sukses!' });
      setInvoiceToDelete(null);
    } catch {
      toast({ title: 'Gabim gjatë fshirjes së faturës', variant: 'destructive' });
    }
  };

  // Executes the choice from the recurring-aware delete dialog.
  const confirmInvoiceDelete = async () => {
    const target = rawInvoices?.find(i => i.id === invoiceToDelete);
    if (!target) return;
    setDeleteBusy(true);
    try {
      if (deleteMode === 'stop') {
        await handleStopInvoiceRecurrence(target);
        toast({ title: 'Përsëritja u ndërpre', description: 'Faturat e kaluara mbeten të paprekura.' });
      } else if (deleteMode === 'series') {
        const kids = childrenOfInvoice(target.id);
        await Promise.all(kids.map(k => removeInvoiceWithItems(k.id)));
        await removeInvoiceWithItems(target.id);
        toast({ title: 'Seria u fshi', description: `${kids.length + 1} fatura u hoqën.` });
      } else {
        await removeInvoiceWithItems(target.id);
        toast({ title: 'Fatura u fshi me sukses!' });
      }
      setInvoiceToDelete(null);
    } catch {
      toast({ title: 'Gabim gjatë fshirjes', variant: 'destructive' });
    } finally {
      setDeleteBusy(false);
    }
  };

  const handleSendEmail = async (invoiceId: string) => {
    try {
      const authToken = await user?.getIdToken();
      const response = await fetch('/api/send-invoice-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({ invoiceId }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Dërgimi dështoi');
      }
      // Also push an in-app notification to the portal client (auto push + email
      // via the notification choke point), so they see it inside the portal too.
      const inv = invoices?.find(i => i.id === invoiceId);
      const uid = await resolvePortalUserId(inv?.customerId);
      if (uid) {
        const num = inv?.invoiceNumber || `INV-${invoiceId.slice(0, 6)}`;
        await notificationMutation.create({
          userId: uid,
          type: 'invoice_sent',
          title: '🧾 Faturë e re',
          message: `Keni një faturë të re: ${num}`,
          isRead: false,
          actionUrl: '/portal/invoices',
          actionLabel: 'Shiko Faturën',
        } as any).catch(() => { /* non-blocking */ });
      }
      toast({ title: 'Fatura u dërgua me email me sukses!' });
    } catch (err: any) {
      toast({ title: 'Gabim gjatë dërgimit', description: err.message, variant: 'destructive' });
    }
  };

  const handleSendReminder = async (invoiceId: string) => {
    try {
      const authToken = await user?.getIdToken();
      const response = await fetch('/api/send-invoice-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({ invoiceId, type: 'reminder' }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Dërgimi i kujtesës dështoi');
      }
      await invoiceMutation.update(invoiceId, { reminderSent: true });
      toast({ title: 'Kujtesa u dërgua me email me sukses!' });
    } catch (err: any) {
      toast({ title: 'Gabim gjatë dërgimit të kujtesës', description: err.message, variant: 'destructive' });
    }
  };

  const handleTriggerRecurringInvoices = async () => {
    if (!user || triggeringRecurring) return;
    setTriggeringRecurring(true);
    try {
      const token = await user.getIdToken(/* forceRefresh */ true);
      const res = await fetch('/api/cron/run?job=recurring-invoices&manual=1', {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gabim serveri');
      const created = data.created ?? 0;
      const skipped = data.skipped ?? 0;
      toast({
        title: created > 0 ? `✅ ${created} faturë u gjenerua!` : '✓ Nuk ka fatura për gjenerim',
        description: created > 0
          ? `${skipped} u kaluan (nuk e kanë arritur datën ose janë në pauzë).`
          : 'Të gjitha faturat periodike janë aktualizuara ose nuk e kanë arritur datën e tyre.',
      });
    } catch (err: any) {
      toast({ title: 'Gabim gjatë gjenerimit', description: err.message, variant: 'destructive' });
    } finally {
      setTriggeringRecurring(false);
    }
  };

  const handleStripePayment = async (invoice: Invoice) => {
    const stripeKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;
    
    if (!stripeKey) {
      toast({ title: 'Stripe nuk është konfiguruar!', description: 'Vendosni VITE_STRIPE_PUBLISHABLE_KEY në .env', variant: 'destructive' });
      return;
    }

    const customer = customers?.find(c => c.id === invoice.customerId);
    const amount = invoice.total || invoice.amount || 0;

    if (amount <= 0) {
      toast({ title: 'Shuma e faturës është 0', variant: 'destructive' });
      return;
    }

    try {
      toast({ title: 'Duke hapur Stripe Checkout...' });

      // Stripe does not support ALL (Albanian Lek) — convert an ALL invoice to EUR
      // for checkout. Other currencies (EUR/USD/GBP) are passed through as-is.
      // ALL is the house currency, so an invoice with no currency set is Lek. This
      // used to default to EUR, which charged a 120,000 L invoice as €120,000
      // (face value, unconverted) instead of ~€1,200.
      const invCur = ((invoice as any).currency || 'ALL').toUpperCase();
      const stripeCurrency = invCur === 'ALL' ? 'eur' : invCur.toLowerCase();
      const stripeAmount = invCur === 'ALL' ? amount / getRateToAll('EUR') : amount;

      const authToken = await user?.getIdToken();
      const response = await fetch('/api/create-checkout-session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber || invoice.id.slice(0, 8),
          amount: stripeAmount,
          currency: stripeCurrency,
          customerEmail: customer?.email || undefined,
          customerName: customer?.name || undefined,
          successUrl: appReturnUrl(`/app/invoices?payment=success&invoice=${invoice.id}`),
          cancelUrl: appReturnUrl(`/app/invoices?payment=cancelled&invoice=${invoice.id}`),
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || 'Gabim gjatë krijimit të sesionit');
      }

      const { url } = await response.json();

      if (url) {
        try {
          const parsed = new URL(url);
          if (parsed.hostname.endsWith('.stripe.com') || parsed.hostname === 'stripe.com') {
            await openCheckout(url);
          } else {
            throw new Error('URL e pagesës nuk është e vlefshme');
          }
        } catch {
          throw new Error('URL e pagesës nuk është e vlefshme');
        }
      } else {
        throw new Error('Nuk u krijua URL-ja e pagesës');
      }
    } catch (err: any) {
      console.error('Stripe payment error:', err);
      toast({ title: 'Gabim me Stripe', description: err.message, variant: 'destructive' });
    }
  };

  const startEditing = (invoiceId: string, field: string, currentValue: any) => {
    if (!permissions.canEdit) return;
    setEditingInvoiceId(invoiceId);
    setEditingField(field);
    setEditValue(String(currentValue || ''));
    if (field === 'status') {
      // Pre-fill paidAt date with today
      setPaidAtDate(new Date().toISOString().slice(0, 10));
    }
  };

  const cancelEditing = () => {
    setEditingInvoiceId(null);
    setEditingField(null);
    setEditValue('');
  };

  const saveEdit = async (invoiceId: string, field: string) => {
    const updateData: any = {};
    
    if (field === 'total' || field === 'amount') {
      const parsed = parseFloat(editValue);
      if (isNaN(parsed) || parsed < 0) {
        toast({ title: 'Vlerë e pavlefshme', description: 'Shuma duhet të jetë një numër pozitiv.', variant: 'destructive' });
        return;
      }
      updateData[field] = parsed;
    } else {
      updateData[field] = editValue;
      // When status is marked Paid, record paidAt from the user-selected date
      if (field === 'status' && editValue === 'Paid') {
        updateData.paidAt = paidAtDate ? new Date(paidAtDate + 'T12:00:00') : new Date();
      }
    }

    await invoiceMutation.update(invoiceId, updateData);

    // Notify Admin/finance team when invoice marked Paid
    if (field === 'status' && editValue === 'Paid') {
      const invoice = invoices?.find(i => i.id === invoiceId);
      const recipients = scopedMembers.filter((m: any) => m.userId !== user?.uid && (m.role === 'Admin' || m.canAccessInvoices));
      await Promise.all(recipients.map((m: any) => notificationMutation.create({
        userId: m.userId,
        type: 'invoice_paid',
        title: 'Faturë e Paguar ✓',
        message: `Fatura${invoice?.invoiceNumber ? ` ${invoice.invoiceNumber}` : ''} u shënua si e paguar.`,
        isRead: false,
        actionUrl: '/app/invoices',
        actionLabel: 'Shiko Faturat',
      }))).catch(err => console.error('[Notifications] invoice_paid dërgim dështoi:', err));
    }

    cancelEditing();
  };

  const handleRecordPartialPayment = async () => {
    if (!partialPaymentInvoice) return;
    const amount = parseFloat(partialAmount);
    if (isNaN(amount) || amount <= 0) {
      toast({ title: 'Shumë e pavlefshme', description: 'Shkruaj një shumë pozitive.', variant: 'destructive' });
      return;
    }
    // Compare in the invoice's native currency (EUR or ALL) to avoid mismatch
    // toAll() is only for display/aggregation, NOT for payment logic
    const invoiceCurrency = (partialPaymentInvoice as any).currency || 'ALL';
    const invoiceTotalNative = partialPaymentInvoice.total ?? partialPaymentInvoice.amount ?? 0;
    const alreadyPaid = partialPaymentInvoice.paidAmount ?? 0;
    const remaining = invoiceTotalNative - alreadyPaid;
    if (amount > remaining) {
      toast({ title: 'Shumë e madhe', description: `Mbetet për t'u paguar: ${remaining.toLocaleString()} ${invoiceCurrency}`, variant: 'destructive' });
      return;
    }
    setPartialSaving(true);
    try {
      const newPayment = { amount, paidAt: new Date(), method: partialMethod, note: partialNote || undefined };
      const existingPayments = partialPaymentInvoice.partialPayments ?? [];
      const newPaidAmount = alreadyPaid + amount;
      const isFullyPaid = newPaidAmount >= invoiceTotalNative;
      const updateData: any = {
        partialPayments: [...existingPayments, newPayment],
        paidAmount: newPaidAmount,
        status: isFullyPaid ? 'Paid' : 'Partial',
      };
      if (isFullyPaid) updateData.paidAt = new Date();
      await invoiceMutation.update(partialPaymentInvoice.id, updateData);

      // Mirror into the payment ledger (same sourceKey scheme as the backfill).
      const paymentIndex = existingPayments.length;
      await paymentMutation.create({
        invoiceId: partialPaymentInvoice.id,
        invoiceNumber: partialPaymentInvoice.invoiceNumber,
        customerId: partialPaymentInvoice.customerId,
        amount,
        currency: invoiceCurrency,
        method: partialMethod,
        note: partialNote || undefined,
        paidAt: newPayment.paidAt,
        teamId: partialPaymentInvoice.teamId,
        businessId: (partialPaymentInvoice as any).businessId,
        source: 'partial',
        sourceKey: `${partialPaymentInvoice.id}#p${paymentIndex}`,
      } as any).catch((err) => console.error('[Payments] ledger write failed:', err));
      if (isFullyPaid) {
        const recipients = scopedMembers.filter((m: any) => m.userId !== user?.uid && (m.role === 'Admin' || m.canAccessInvoices));
        await Promise.all(recipients.map((m: any) => notificationMutation.create({
          userId: m.userId,
          type: 'invoice_paid',
          title: 'Faturë e Paguar Plotësisht ✓',
          message: `Fatura${partialPaymentInvoice.invoiceNumber ? ` ${partialPaymentInvoice.invoiceNumber}` : ''} u pagua plotësisht.`,
          isRead: false,
          actionUrl: '/app/invoices',
          actionLabel: 'Shiko Faturat',
        }))).catch(() => {});
      }
      toast({ title: isFullyPaid ? 'Fatura u pagua plotësisht! ✓' : `Pagesë e regjistruar: ${amount.toLocaleString()} ${invoiceCurrency}`, description: isFullyPaid ? undefined : `Mbetet: ${(invoiceTotalNative - newPaidAmount).toLocaleString()} ${invoiceCurrency}` });
      setPartialPaymentInvoice(null);
      setPartialAmount('');
      setPartialNote('');
      setPartialMethod('Cash');
    } finally {
      setPartialSaving(false);
    }
  };

  // Seed the drawer's editable fields whenever a new invoice is opened.
  useEffect(() => {
    if (!drawerInvoice) return;
    setDrawerCustomer(drawerInvoice.customerId || '');
    setDrawerProject(drawerInvoice.projectId || '');
    setDrawerTotal(String(drawerInvoice.total ?? drawerInvoice.amount ?? 0));
    const raw = drawerInvoice.dueDate ? new Date(drawerInvoice.dueDate) : null;
    setDrawerDue(raw && !isNaN(raw.getTime()) ? raw.toISOString().slice(0, 10) : '');
    setDrawerStatus(drawerInvoice.status || 'Pending');
  }, [drawerInvoice]);

  // Close the drawer on Escape.
  useEffect(() => {
    if (!drawerInvoice) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDrawerInvoice(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerInvoice]);

  // Save the drawer edits via the existing mutation (no new fields / no new path).
  const handleSaveDrawer = async () => {
    if (!drawerInvoice) return;
    setDrawerSaving(true);
    try {
      // Deliberately does NOT write `total`: the total is derived from the invoice's
      // services/line items, so editing it here would desync the composition. Amounts
      // and services are edited via the full invoice form (setEditInvoice).
      await invoiceMutation.update(drawerInvoice.id, {
        customerId: drawerCustomer,
        projectId: drawerProject,
        dueDate: drawerDue ? new Date(drawerDue + 'T12:00:00') : null,
        status: drawerStatus,
      } as any);
      toast({ title: 'Ndryshimet u ruajtën' });
      setDrawerInvoice(null);
    } catch {
      toast({ title: 'Gabim gjatë ruajtjes', variant: 'destructive' });
    } finally {
      setDrawerSaving(false);
    }
  };

  const totalRevenue = invoices?.reduce((sum, inv) => {
    if (inv.status === 'Paid') return sum + toAll(inv.total ?? inv.amount ?? 0, (inv as any).currency);
    if (inv.status === 'Partial') return sum + toAll(inv.paidAmount ?? 0, (inv as any).currency);
    return sum;
  }, 0) || 0;

  // Real month-over-month collected-revenue delta (was a hardcoded "+12%").
  const revenueMoM = useMemo(() => {
    const now = new Date();
    const curStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const curEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    const prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
    const prevEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
    const inv = invoices || [];
    const cur = inv.reduce((s, i) => s + getInvoiceCollectedBetween(i, curStart, curEnd), 0);
    const prev = inv.reduce((s, i) => s + getInvoiceCollectedBetween(i, prevStart, prevEnd), 0);
    const pct = prev > 0 ? ((cur - prev) / prev) * 100 : (cur > 0 ? 100 : 0);
    return { cur, prev, pct, hasPrev: prev > 0 };
  }, [invoices]);

  // ── Revenue by Month ──
  // Uses centralised helper from financialAnalytics so accrual/cash toggle
  // stays consistent with ReportsView. Default is accrual (IFRS/GAAP).
  const MONTH_LABELS = ['Jan', 'Shk', 'Mar', 'Pri', 'Maj', 'Qer', 'Kor', 'Gus', 'Sht', 'Tet', 'Nën', 'Dhj'];
  const revenueByMonth = useMemo(() => {
    return buildRevenueByMonthByBasis(accountingBasis, invoices, selectedYear, MONTH_LABELS);
  }, [accountingBasis, invoices, selectedYear]);
  // Bar scales to collected + outstanding (a stacked bar); the year total uses
  // `value` (billed for accrual, collected for cash) so it matches the basis.
  const maxMonthRevenue = useMemo(() => Math.max(...revenueByMonth.map(m => m.paid + m.pending), 1), [revenueByMonth]);
  const yearTotalRevenue = useMemo(() => revenueByMonth.reduce((s, m) => s + m.value, 0), [revenueByMonth]);
  const currentMonth = new Date().getMonth();
  const currentYear = new Date().getFullYear();
  const availableYears = [currentYear, currentYear - 1, currentYear - 2, currentYear - 3];
  // "Të përfunduara" = fully paid only (a Partial invoice isn't completed).
  const paidInvoices = invoices?.filter(inv => inv.status === 'Paid').length || 0;
  const pendingAmount = invoices?.filter(inv => inv.status === 'Pending').reduce((sum, inv) => sum + toAll(inv.total ?? inv.amount ?? 0, (inv as any).currency), 0) || 0;
  const draftAmount = invoices?.filter(inv => inv.status === 'Draft').reduce((sum, inv) => sum + toAll(inv.total ?? inv.amount ?? 0, (inv as any).currency), 0) || 0;
  const overdueAmount = invoices?.filter(inv => inv.status === 'Overdue').reduce((sum, inv) => sum + Math.max(0, toAll(inv.total ?? inv.amount ?? 0, (inv as any).currency) - toAll(inv.paidAmount ?? 0, (inv as any).currency)), 0) || 0;
  const partialRemainingAmount = invoices?.filter(inv => inv.status === 'Partial').reduce((sum, inv) => sum + Math.max(0, toAll(inv.total ?? inv.amount ?? 0, (inv as any).currency) - toAll(inv.paidAmount ?? 0, (inv as any).currency)), 0) || 0;
  // Money genuinely owed to us: issued-but-unpaid (Pending), overdue balances,
  // and the unpaid remainder of partial invoices. Drafts are NOT issued → excluded.
  const projectedRevenue = pendingAmount + overdueAmount + partialRemainingAmount;

  // Recurring invoices whose next-generation date has arrived (and not paused) — an
  // estimate shown in the confirm dialog before the manual "Gjenero Periodike" run.
  const dueRecurringCount = useMemo(() => {
    const now = Date.now();
    return (invoices || []).filter(inv => {
      if (!(inv as any).isRecurring || (inv as any).isRecurringPaused) return false;
      const ms = getTimestampMs((inv as any).nextRecurringDate);
      return ms > 0 && ms <= now;
    }).length;
  }, [invoices]);

  // Filtered + sorted list used by both mobile cards and desktop table
  const filteredInvoices = React.useMemo(() => {
    let list = invoices ? [...invoices] : [];
    if (statusFilter !== '__all__') list = list.filter(inv => inv.status === statusFilter);
    if (projectFilter === '__none__') list = list.filter(inv => !inv.projectId);
    else if (projectFilter !== '__all__') list = list.filter(inv => inv.projectId === projectFilter);
    if (monthFilter !== '__all__') {
      const m = Number(monthFilter);
      list = list.filter(inv => {
        const d = inv.invoiceDate ? new Date(inv.invoiceDate as any) : (inv.createdAt ? new Date(inv.createdAt as any) : null);
        return d && !isNaN(d.getTime()) && d.getMonth() === m && d.getFullYear() === selectedYear;
      });
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(inv => {
        const customer = customers?.find(c => c.id === inv.customerId);
        return (
          inv.invoiceNumber?.toLowerCase().includes(q) ||
          customer?.name?.toLowerCase().includes(q) ||
          customer?.company?.toLowerCase().includes(q) ||
          (inv.projectId ? projectById.get(inv.projectId)?.name?.toLowerCase().includes(q) : false)
        );
      });
    }
    list.sort((a, b) => {
      if (sortBy === 'date_desc') return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      if (sortBy === 'date_asc') return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      if (sortBy === 'amount_desc') return (b.total ?? b.amount ?? 0) - (a.total ?? a.amount ?? 0);
      if (sortBy === 'amount_asc') return (a.total ?? a.amount ?? 0) - (b.total ?? b.amount ?? 0);
      return 0;
    });
    return list;
  }, [invoices, statusFilter, projectFilter, monthFilter, selectedYear, searchQuery, sortBy, customers, projectById]);

  // Deep link from a project's "Faturimi" panel: /app/invoices?project=<id>
  // (and ?project=none for the unlinked set).
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get('project');
    if (!p) return;
    setProjectFilter(p === 'none' ? '__none__' : p);
    window.history.replaceState({}, '', window.location.pathname);
  }, []);

  // How many issued invoices carry no project — the exact set that vanishes from the
  // "Faturuar" basis of the per-project P&L while overhead is still allocated.
  const unlinkedCount = React.useMemo(
    () => (invoices || []).filter(i => !i.projectId && i.status !== 'Draft' && i.status !== 'Cancelled').length,
    [invoices],
  );

  // Cap rendered rows to avoid mounting hundreds of invoice rows at once on mobile.
  const [visibleCount, setVisibleCount] = useState(50);
  useEffect(() => { setVisibleCount(50); }, [statusFilter, projectFilter, monthFilter, selectedYear, searchQuery, sortBy]);
  const visibleInvoices = useMemo(
    () => filteredInvoices.slice(0, visibleCount),
    [filteredInvoices, visibleCount]
  );

  // Gate on BOTH the invoice snapshot AND permission resolution. `useFilteredByOwner`
  // depends on dataScope, which resolves asynchronously — rendering the KPIs before it
  // settles paints an intermediate owner-scoped total (e.g. 343 / 4,097,049 L) that then
  // jumps to the final value (386 / 4,127,287 L), which reads as "numbers change on reload".
  if (invoicesLoading || permissions.isLoading) {
    return (
      <div className="space-y-8">
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <div className="h-8 w-32 skeleton rounded" />
            <div className="h-4 w-40 skeleton rounded" />
          </div>
          <div className="flex gap-2">
            <div className="h-10 w-24 skeleton rounded" />
            <div className="h-10 w-32 skeleton rounded" />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-6">
          {[1, 2, 3].map((i) => (
            <div key={i} className="p-6 bg-card rounded-lg border space-y-3">
              <div className="flex justify-between">
                <div className="h-4 w-28 skeleton rounded" />
                <div className="h-5 w-5 skeleton rounded" />
              </div>
              <div className="h-8 w-24 skeleton rounded" />
            </div>
          ))}
        </div>
        <div className="bg-card rounded-lg border overflow-hidden">
          <div className="h-12 w-full skeleton" />
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-14 w-full skeleton border-t" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-lg sm:text-h2 text-foreground">Faturat</h1>
          <p className="text-xs sm:text-body text-muted-foreground mt-0.5 sm:mt-1">
            {filteredInvoices.length !== (invoices?.length ?? 0)
              ? `${filteredInvoices.length} nga ${invoices?.length || 0} fatura`
              : `${invoices?.length || 0} fatura gjithsej`}
          </p>
        </div>
        <div className="flex gap-2">
          <ExportButton
            data={invoices || []}
            filename="invoices"
            columns={['invoiceNumber', 'customerId', 'total', 'status', 'dueDate', 'paymentMethod']}
          />
          {permissions.isAdmin && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowRecurringConfirm(true)}
              disabled={triggeringRecurring}
              title="Gjenero faturat periodike manualisht"
              className="gap-1.5 border-primary/30 text-primary hover:bg-primary/5"
            >
              {triggeringRecurring
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <RefreshCw className="w-3.5 h-3.5" />}
              <span className="hidden sm:inline">Gjenero Periodike</span>
            </Button>
          )}
          {permissions.canEdit && (
            <Dialog open={isCreateDialogOpen} onOpenChange={(open) => {
              if (open) { setDirty(false); setIsCreateDialogOpen(true); }
              else requestClose(() => setIsCreateDialogOpen(false));
            }}>
              <DialogTrigger asChild>
                <Button size="sm" className="bg-primary text-primary-foreground">
                  <Plus className="w-4 h-4 sm:mr-2" />
                  <span className="hidden sm:inline">Faturë e Re</span>
                </Button>
              </DialogTrigger>
              <DialogContent
                className="w-full max-w-full sm:max-w-4xl max-h-[90vh] overflow-y-auto"
                onInteractOutside={(e) => {
                  if (isDirtyRef.current) {
                    e.preventDefault();
                    requestClose(() => setIsCreateDialogOpen(false));
                  }
                }}
                onEscapeKeyDown={(e) => {
                  if (isDirtyRef.current) {
                    e.preventDefault();
                    requestClose(() => setIsCreateDialogOpen(false));
                  }
                }}
              >
                <DialogHeader>
                  <DialogTitle>Krijo Faturë të Re</DialogTitle>
                </DialogHeader>
                <InvoiceForm onClose={() => { setDirty(false); setIsCreateDialogOpen(false); }} onDirtyChange={setDirty} />
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      {/* Edit Invoice Dialog */}
      {editInvoice && (
        <Dialog open={!!editInvoice} onOpenChange={(open) => {
          if (open) { setDirty(false); }
          else requestClose(() => setEditInvoice(null));
        }}>
          <DialogContent
            className="w-full max-w-full sm:max-w-4xl max-h-[90vh] overflow-y-auto"
            onInteractOutside={(e) => {
              if (isDirtyRef.current) {
                e.preventDefault();
                requestClose(() => setEditInvoice(null));
              }
            }}
            onEscapeKeyDown={(e) => {
              if (isDirtyRef.current) {
                e.preventDefault();
                requestClose(() => setEditInvoice(null));
              }
            }}
          >
            <DialogHeader>
              <DialogTitle>Ndrysho Faturën — {editInvoice.invoiceNumber || editInvoice.id.slice(0, 8)}</DialogTitle>
            </DialogHeader>
            <InvoiceForm onClose={() => { setDirty(false); setEditInvoice(null); }} editInvoice={editInvoice} onDirtyChange={setDirty} />
          </DialogContent>
        </Dialog>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-6 stagger-children">
        <Card className="p-3 sm:p-6 space-y-1 sm:space-y-2 card-hover metric-card-success border-l-4 border-l-success">
          <div className="flex items-center justify-between">
            <p className="text-[10px] sm:text-body-sm text-muted-foreground">Të Ardhura (këtë muaj)</p>
            <div className="p-1 sm:p-2 bg-success/10 rounded-lg">
              <DollarSign className="w-3.5 h-3.5 sm:w-5 sm:h-5 text-success" />
            </div>
          </div>
          <p className="text-sm sm:text-h2 text-foreground font-medium animate-count-up">
            {Math.round(revenueMoM.cur).toLocaleString()} L
          </p>
          <p className={`text-[10px] sm:text-xs hidden sm:block ${revenueMoM.pct >= 0 ? 'text-success' : 'text-red-600'}`}>
            {revenueMoM.hasPrev
              ? `${revenueMoM.pct >= 0 ? '+' : ''}${Math.round(revenueMoM.pct)}% nga muaji i kaluar`
              : revenueMoM.cur > 0 ? 'Arkëtim i ri këtë muaj' : 'Pa arkëtim këtë muaj'}
          </p>
        </Card>

        <Card className="p-3 sm:p-6 space-y-1 sm:space-y-2 card-hover metric-card-primary border-l-4 border-l-primary">
          <div className="flex items-center justify-between">
            <p className="text-[10px] sm:text-body-sm text-muted-foreground">Të Paguara</p>
            <div className="p-1 sm:p-2 bg-primary/10 rounded-lg">
              <CreditCard className="w-3.5 h-3.5 sm:w-5 sm:h-5 text-primary" />
            </div>
          </div>
          <p className="text-sm sm:text-h2 text-foreground font-medium animate-count-up">
            {paidInvoices}
          </p>
          <p className="text-[10px] sm:text-xs text-primary hidden sm:block">Të përfunduara</p>
        </Card>

        <Card className="p-3 sm:p-6 space-y-1 sm:space-y-2 card-hover metric-card-warning border-l-4 border-l-warning">
          <div className="flex items-center justify-between">
            <p className="text-[10px] sm:text-body-sm text-muted-foreground">Parashikuara</p>
            <div className="p-1 sm:p-2 bg-warning/10 rounded-lg">
              <CalendarIcon className="w-3.5 h-3.5 sm:w-5 sm:h-5 text-warning" />
            </div>
          </div>
          <p className="text-sm sm:text-h2 text-foreground font-medium animate-count-up">
            {projectedRevenue.toLocaleString()} L
          </p>
          <p className="text-[10px] sm:text-xs text-muted-foreground hidden sm:block">
            Pritje: {pendingAmount.toLocaleString()} · Vonuar: {overdueAmount.toLocaleString()} · Mbetje: {partialRemainingAmount.toLocaleString()} L
          </p>
        </Card>
      </div>

      {/* Monthly Revenue Breakdown */}
      <Card className="p-4 sm:p-6 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h3 className="text-sm sm:text-base font-semibold text-foreground">Të Ardhurat sipas Muajit</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Gjithsej {selectedYear}: <span className="font-semibold text-green-600">{yearTotalRevenue.toLocaleString()} L</span>
              <span className="ml-2 text-[10px] uppercase tracking-wide opacity-70">
                ({accountingBasis === 'accrual' ? 'Akruale · data e faturës' : 'Arkë · data e pagesës'})
              </span>
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="inline-flex rounded-full border border-input bg-background p-0.5 text-[11px] font-medium">
              <button
                onClick={() => setAccountingBasis('accrual')}
                className={`h-6 px-2.5 rounded-full transition-colors ${accountingBasis === 'accrual' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}
                title="Të ardhurat njihen në muajin e faturës (standardi kontabël)"
              >
                Akruale
              </button>
              <button
                onClick={() => setAccountingBasis('cash')}
                className={`h-6 px-2.5 rounded-full transition-colors ${accountingBasis === 'cash' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}
                title="Të ardhurat njihen në muajin e pagesës (paratë reale)"
              >
                Arkë
              </button>
            </div>
            <div className="flex gap-1">
              {availableYears.map(y => (
                <button
                  key={y}
                  onClick={() => setSelectedYear(y)}
                  className={`h-7 px-3 text-xs rounded-full border font-medium transition-colors ${
                    selectedYear === y
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-background border-input text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {y}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-6 md:grid-cols-12 gap-1.5 sm:gap-2">
          {revenueByMonth.map((m, i) => {
            // Stacked bar: paid (green) below, pending/outstanding (amber) on top.
            const paidPct = maxMonthRevenue > 0 ? (m.paid / maxMonthRevenue) * 100 : 0;
            const pendingPct = maxMonthRevenue > 0 ? (m.pending / maxMonthRevenue) * 100 : 0;
            const isCurrentMonth = i === currentMonth && selectedYear === currentYear;
            const hasPending = m.pending > 0;
            const nothing = m.paid === 0 && !hasPending;
            return (
              <div key={m.label} className="flex flex-col items-center gap-1 group relative">
                <div className="w-full flex flex-col items-center justify-end" style={{ height: 64 }}>
                  {hasPending && (
                    <div className="w-full bg-amber-300/60" style={{ height: `${pendingPct}%`, minHeight: 3 }} />
                  )}
                  {m.paid > 0 && (
                    <div
                      className={`w-full transition-all duration-500 ${hasPending ? '' : 'rounded-t-sm'} ${isCurrentMonth ? 'bg-green-500' : 'bg-green-400/70'}`}
                      style={{ height: `${paidPct}%`, minHeight: 4 }}
                    />
                  )}
                  {nothing && (
                    <div className="w-full rounded-t-sm bg-muted" style={{ height: '4%', minHeight: 2 }} />
                  )}
                </div>
                <span className={`text-[9px] sm:text-[10px] font-medium ${isCurrentMonth ? 'text-green-600' : 'text-muted-foreground'}`}>
                  {m.label}
                </span>
                {/* Tooltip */}
                <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 hidden group-hover:flex flex-col items-center pointer-events-none z-10">
                  <div className="bg-popover border border-border rounded-md shadow-lg px-2.5 py-1.5 text-xs whitespace-nowrap min-w-[110px]">
                    <p className="font-semibold text-foreground">{m.label} {selectedYear}</p>
                    <p className="text-green-600">{m.paid.toLocaleString()} L paguar</p>
                    {m.pending > 0 && <p className="text-amber-500">{m.pending.toLocaleString()} L pritje</p>}
                    <p className="text-muted-foreground">{m.count} fatura</p>
                  </div>
                  <div className="w-2 h-2 bg-popover border-r border-b border-border rotate-45 -mt-1" />
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-4 pt-1 border-t">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <div className="w-3 h-3 rounded-sm bg-green-400/70" />
            <span>E paguar</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <div className="w-3 h-3 rounded-sm bg-amber-300/60" />
            <span>Në pritje</span>
          </div>
        </div>
      </Card>

      {/* Filter + Search Bar */}
      <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
        <input
          type="text"
          placeholder="Kërko faturë, klient ose projekt..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm flex-1 min-w-0 focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <div className="flex gap-2 flex-wrap">
          <select
            value={projectFilter}
            onChange={e => setProjectFilter(e.target.value)}
            className="h-8 px-2 text-xs rounded-md border border-input bg-background text-muted-foreground focus:outline-none max-w-[190px]"
            title="Filtro sipas projektit"
          >
            <option value="__all__">Çdo projekt</option>
            <option value="__none__">Pa projekt{unlinkedCount ? ` (${unlinkedCount})` : ''}</option>
            {/* Alphabetical, archive last (sortArchivedLast is stable). */}
            {sortArchivedLast(
              (allProjects || []).slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''))
            ).map(p => <option key={p.id} value={p.id}>{projectPickerLabel(p)}</option>)}
          </select>
          <select
            value={monthFilter}
            onChange={e => setMonthFilter(e.target.value)}
            className="h-8 px-2 text-xs rounded-md border border-input bg-background text-muted-foreground focus:outline-none"
            title="Filtro sipas muajit"
          >
            <option value="__all__">Çdo muaj</option>
            {MONTH_LABELS.map((m, i) => <option key={i} value={i}>{m}</option>)}
          </select>
          <select
            value={selectedYear}
            onChange={e => setSelectedYear(Number(e.target.value))}
            className="h-8 px-2 text-xs rounded-md border border-input bg-background text-muted-foreground focus:outline-none"
            title="Filtro sipas vitit"
          >
            {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <select
            value={sortBy}
            onChange={e => setSortBy(e.target.value as any)}
            className="h-8 px-2 text-xs rounded-md border border-input bg-background text-muted-foreground focus:outline-none"
          >
            <option value="date_desc">Data ↓</option>
            <option value="date_asc">Data ↑</option>
            <option value="amount_desc">Shuma ↓</option>
            <option value="amount_asc">Shuma ↑</option>
          </select>
        </div>
      </div>
      {/* Unlinked invoices are the single biggest source of wrong per-project profit:
          they are excluded from the "Faturuar" revenue basis while the full overhead
          pool is still spread over the projects. Make it visible and one click to fix. */}
      {unlinkedCount > 0 && projectFilter !== '__none__' && canSeeFinancials(permissions) && (
        <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-2.5 text-xs flex items-center justify-between gap-3 flex-wrap">
          <span className="text-amber-900 dark:text-amber-200">
            <strong>{unlinkedCount} faturë</strong> pa projekt të lidhur — nuk numërohen te “Fitimi sipas projekti” me bazën “Faturuar”.
          </span>
          <button
            onClick={() => setProjectFilter('__none__')}
            className="h-7 px-2.5 rounded-md border border-amber-400 bg-background text-amber-900 dark:text-amber-200 font-medium hover:bg-amber-100 dark:hover:bg-amber-900/30"
          >
            Shfaqi
          </button>
        </div>
      )}
      {filteredInvoices.length === 0 && !invoicesLoading && (
        <p className="text-sm text-muted-foreground text-center py-6">Nuk u gjetën fatura.</p>
      )}

      {/* Mobile Card Layout */}
      <div className="sm:hidden space-y-3">
        {visibleInvoices.map((invoice) => {
          const customer = customers?.find(c => c.id === invoice.customerId);
          return (
            <Card key={invoice.id} className="p-3" onClick={() => setSelectedInvoice(invoice)}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="text-sm font-mono font-medium">{invoice.invoiceNumber || invoice.id.slice(0, 8)}</span>
                    <Badge className={`${getStatusColor(invoice.status)} text-[10px] px-1.5 py-0`}>{getInvoiceStatusLabel(invoice.status)}</Badge>
                    {(invoice as any).autoGenerated && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-blue-300 text-blue-600">Auto</Badge>
                    )}
                    {(invoice as any).isRecurring && !(invoice as any).autoGenerated && (
                      <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${(invoice as any).isRecurringPaused ? 'border-amber-300 text-amber-600' : 'border-green-300 text-green-600'}`}>
                        {(invoice as any).isRecurringPaused ? '⏸' : '↻'}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{customer?.name || 'Unknown'}</p>
                  {(() => {
                    const proj = invoice.projectId ? projectById.get(invoice.projectId) : undefined;
                    if (proj) {
                      return (
                        <p className="text-[11px] text-muted-foreground/80 truncate flex items-center gap-1">
                          <Folder className="w-3 h-3 shrink-0" />{proj.name}
                        </p>
                      );
                    }
                    if (invoice.projectId) {
                      return <p className="text-[11px] text-amber-600">projekt i fshirë</p>;
                    }
                    return null;
                  })()}
                  {invoice.productSummary && (
                    <p className="text-[11px] text-muted-foreground/80 truncate" title={invoice.productSummary}>📦 {invoice.productSummary}</p>
                  )}
                  <div className="flex items-center gap-3 mt-1.5">
                    <span className="text-sm font-semibold">{((invoice.total ?? invoice.amount ?? 0)).toLocaleString()} {(invoice as any).currency === 'EUR' ? '€' : 'L'}</span>
                    {invoice.status === 'Partial' && invoice.paidAmount != null && (
                      <span className="text-[10px] text-cyan-600 font-medium">Paguar: {invoice.paidAmount.toLocaleString()} {(invoice as any).currency === 'EUR' ? '€' : 'L'}</span>
                    )}
                    <span className="text-[10px] text-muted-foreground">Afati: {invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString() : 'Pa afat'}</span>
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                      {invoice.paymentMethod === 'Bank' ? 'Transfer' : invoice.paymentMethod === 'Cash' ? 'Kesh' : invoice.paymentMethod || 'Stripe'}
                    </Badge>
                  </div>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={(e) => e.stopPropagation()}>
                      <MoreVertical className="w-4 h-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setSelectedInvoice(invoice); }}>
                      <Eye className="w-4 h-4 mr-2" /> Shiko
                    </DropdownMenuItem>
                    {permissions.canEdit && (
                      <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setEditInvoice(invoice); }}>
                        <Edit2 className="w-4 h-4 mr-2" /> Ndrysho
                      </DropdownMenuItem>
                    )}
                    {permissions.canEdit && (
                      <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setLinkProjectInvoice(invoice); }}>
                        <Folder className="w-4 h-4 mr-2" /> {invoice.projectId ? 'Ndrysho projektin' : 'Lidh me projekt'}
                      </DropdownMenuItem>
                    )}
                    {permissions.canEdit && !invoice.emailSent && (
                      <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleSendEmail(invoice.id); }}>
                        <Mail className="w-4 h-4 mr-2" /> Shëno si Dërguar
                      </DropdownMenuItem>
                    )}
                    {permissions.canEdit && invoice.status === 'Pending' && !invoice.reminderSent && (
                      <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleSendReminder(invoice.id); }}>
                        <Send className="w-4 h-4 mr-2" /> Shëno Kujtesën
                      </DropdownMenuItem>
                    )}
                    {invoice.status !== 'Paid' && invoice.status !== 'Draft' && (invoice.total ?? invoice.amount ?? 0) > 0 && (
                      <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleStripePayment(invoice); }}>
                        <CreditCard className="w-4 h-4 mr-2" /> Paguaj me Stripe
                      </DropdownMenuItem>
                    )}
                    {permissions.canEdit && invoice.status !== 'Paid' && invoice.status !== 'Draft' && (
                      <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setPartialPaymentInvoice(invoice); setPartialAmount(''); setPartialNote(''); setPartialMethod('Cash'); }}>
                        <DollarSign className="w-4 h-4 mr-2" /> Pagesë Pjesore
                      </DropdownMenuItem>
                    )}
                    {permissions.canEdit && (invoice as any).isRecurring && !(invoice as any).autoGenerated && (
                      <>
                        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleToggleInvoicePause(invoice); }}>
                          {(invoice as any).isRecurringPaused
                            ? <><Play className="w-4 h-4 mr-2" /> Rifillo përsëritjen</>
                            : <><Pause className="w-4 h-4 mr-2" /> Pauzo përsëritjen</>}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleStopInvoiceRecurrence(invoice); }}>
                          <CircleStop className="w-4 h-4 mr-2" /> Ndërprit përsëritjen
                        </DropdownMenuItem>
                      </>
                    )}
                    {permissions.canEdit && (
                      <DropdownMenuItem className="text-destructive" onClick={(e) => { e.stopPropagation(); setInvoiceToDelete(invoice.id); }}>
                        <Trash2 className="w-4 h-4 mr-2" /> Fshi
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </Card>
          );
        })}
        {filteredInvoices.length > visibleCount && (
          <Button variant="outline" className="w-full" onClick={() => setVisibleCount((c) => c + 50)}>
            Shfaq më shumë ({filteredInvoices.length - visibleCount})
          </Button>
        )}
      </div>

      {/* Status filter pills (client-side on the current list) */}
      <div className="hidden sm:flex flex-wrap gap-2 mb-3">
        {([
          { value: '__all__', label: 'Të gjitha' },
          { value: 'Pending', label: 'Në pritje' },
          { value: 'Overdue', label: 'Vonuar' },
          { value: 'Paid', label: 'Paguar' },
          { value: 'Draft', label: 'Draft' },
          { value: 'Cancelled', label: 'Anuluar' },
        ] as { value: string; label: string }[]).map((p) => {
          const count = p.value === '__all__' ? invoices.length : invoices.filter((i) => i.status === p.value).length;
          const active = statusFilter === p.value;
          return (
            <button
              key={p.value}
              onClick={() => setStatusFilter(p.value)}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium border transition-colors ${active ? 'bg-foreground text-background border-foreground' : 'bg-card text-muted-foreground border-border hover:bg-muted'}`}
            >
              {p.label}
              <span className={active ? 'text-background/70' : 'text-muted-foreground/60'}>{count}</span>
            </button>
          );
        })}
      </div>

      {/* Desktop Table Layout */}
      <Card className="overflow-hidden hidden sm:block border border-border shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[940px]">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="px-4 py-3 text-left text-[11px] uppercase tracking-wide font-semibold text-muted-foreground">Fatura #</th>
                <th className="px-4 py-3 text-left text-[11px] uppercase tracking-wide font-semibold text-muted-foreground">Klienti</th>
                <th className="px-4 py-3 text-right text-[11px] uppercase tracking-wide font-semibold text-muted-foreground">Totali</th>
                <th className="px-4 py-3 text-left text-[11px] uppercase tracking-wide font-semibold text-muted-foreground">Statusi</th>
                <th className="px-4 py-3 text-left text-[11px] uppercase tracking-wide font-semibold text-muted-foreground">Afati</th>
                <th className="px-4 py-3 text-right text-[11px] uppercase tracking-wide font-semibold text-muted-foreground">Veprime</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {visibleInvoices.map((invoice) => {
                const customer = customers?.find((c) => c.id === invoice.customerId);
                const proj = invoice.projectId ? projectById.get(invoice.projectId) : undefined;
                const pill = statusPill(invoice.status);
                const total = invoice.total ?? invoice.amount ?? 0;
                const cur = (invoice as any).currency === 'EUR' ? '€' : 'L';
                const canPay = (invoice.status === 'Pending' || invoice.status === 'Overdue') && total > 0;
                const due = invoice.dueDate ? new Date(invoice.dueDate) : null;
                let dueCtx: { text: string; cls: string } | null = null;
                if (invoice.status === 'Draft') {
                  dueCtx = { text: 'pa dërguar', cls: 'text-muted-foreground' };
                } else if (due && !isNaN(due.getTime()) && invoice.status !== 'Paid' && invoice.status !== 'Cancelled') {
                  const days = Math.ceil((due.getTime() - Date.now()) / 86400000);
                  if (days < 0) dueCtx = { text: `${Math.abs(days)} ditë vonesë`, cls: 'text-error' };
                  else if (days === 0) dueCtx = { text: 'sot', cls: 'text-warning' };
                  else dueCtx = { text: `edhe ${days} ditë`, cls: 'text-muted-foreground' };
                }
                return (
                  <tr
                    key={invoice.id}
                    onClick={() => setDrawerInvoice(invoice)}
                    className="hover:bg-muted/40 cursor-pointer transition-colors"
                  >
                    {/* Fatura # */}
                    <td className="px-4 py-4 align-top">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-mono text-body-sm">{invoice.invoiceNumber || invoice.id.slice(0, 8)}</span>
                        {(invoice as any).autoGenerated && (
                          <span className="text-[9px] font-semibold tracking-wide px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">AUTO</span>
                        )}
                        {(invoice as any).isRecurring && !(invoice as any).autoGenerated && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${(invoice as any).isRecurringPaused ? 'bg-warning/10 text-warning' : 'bg-success/10 text-success'}`}>
                            {(invoice as any).isRecurringPaused ? '⏸' : '↻'}
                          </span>
                        )}
                      </div>
                    </td>
                    {/* Klienti + projekti */}
                    <td className="px-4 py-4 align-top">
                      <div className="flex items-center gap-2.5">
                        <span className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[11px] font-semibold">
                          {initialsOf(customer?.name)}
                        </span>
                        <div className="min-w-0">
                          <div className="truncate max-w-[190px] font-medium text-body-sm">{customer?.name || 'I panjohur'}</div>
                          {proj ? (
                            <div className="truncate max-w-[190px] text-xs text-muted-foreground">{proj.name}</div>
                          ) : invoice.projectId ? (
                            <div className="text-xs text-amber-600">projekt i fshirë</div>
                          ) : permissions.canEdit ? (
                            <button
                              onClick={(e) => { e.stopPropagation(); setLinkProjectInvoice(invoice); }}
                              className="text-xs text-muted-foreground/70 hover:text-primary hover:underline"
                            >
                              + lidh projekt
                            </button>
                          ) : (
                            <div className="text-xs text-muted-foreground/60">—</div>
                          )}
                        </div>
                      </div>
                    </td>
                    {/* Totali */}
                    <td className="px-4 py-4 align-top text-right">
                      <div className="font-mono font-semibold text-body-sm">{total.toLocaleString()} {cur}</div>
                      {invoice.status === 'Partial' && invoice.paidAmount != null && (
                        <div className="text-[10px] text-cyan-600 font-medium">
                          {invoice.paidAmount.toLocaleString()} / {total.toLocaleString()} {cur}
                        </div>
                      )}
                    </td>
                    {/* Statusi */}
                    <td className="px-4 py-4 align-top">
                      <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${pill.pillClass}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${pill.dotClass}`} />
                        {pill.label}
                      </span>
                    </td>
                    {/* Afati */}
                    <td className="px-4 py-4 align-top">
                      <div className="text-body-sm">{due && !isNaN(due.getTime()) ? due.toLocaleDateString() : 'Pa afat'}</div>
                      {dueCtx && <div className={`text-[11px] ${dueCtx.cls}`}>{dueCtx.text}</div>}
                    </td>
                    {/* Veprime — clicks must not open the drawer */}
                    <td className="px-4 py-4 align-top text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1.5">
                        {canPay && (
                          <Button
                            size="sm"
                            className="bg-[#635BFF] hover:bg-[#5851ea] text-white"
                            onClick={() => handleStripePayment(invoice)}
                          >
                            <CreditCard className="w-4 h-4 mr-1" />
                            Paguaj
                          </Button>
                        )}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8" title="Më shumë veprime">
                              <MoreVertical className="w-4 h-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => setSelectedInvoice(invoice)}>
                              <Eye className="w-4 h-4 mr-2" /> Shiko detajet (shërbimet)
                            </DropdownMenuItem>
                            {permissions.canEdit && (
                              <DropdownMenuItem onClick={() => setEditInvoice(invoice)}>
                                <Edit2 className="w-4 h-4 mr-2" /> Ndrysho faturën (shërbimet)
                              </DropdownMenuItem>
                            )}
                            {permissions.canEdit && (
                              <DropdownMenuItem onClick={() => handleSendEmail(invoice.id)}>
                                <Mail className="w-4 h-4 mr-2" /> Dërgo me email
                              </DropdownMenuItem>
                            )}
                            {permissions.canEdit && invoice.status !== 'Paid' && invoice.status !== 'Draft' && (
                              <DropdownMenuItem onClick={() => { setPartialPaymentInvoice(invoice); setPartialAmount(''); setPartialNote(''); setPartialMethod('Cash'); }}>
                                <DollarSign className="w-4 h-4 mr-2" /> Pagesë e pjesshme
                              </DropdownMenuItem>
                            )}
                            {permissions.canEdit && (invoice as any).isRecurring && !(invoice as any).autoGenerated && (
                              <DropdownMenuItem onClick={() => handleToggleInvoicePause(invoice)}>
                                {(invoice as any).isRecurringPaused ? <Play className="w-4 h-4 mr-2" /> : <Pause className="w-4 h-4 mr-2" />}
                                {(invoice as any).isRecurringPaused ? 'Rifillo përsëritjen' : 'Pauzo përsëritjen'}
                              </DropdownMenuItem>
                            )}
                            {permissions.canEdit && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  onClick={() => setInvoiceToDelete(invoice.id)}
                                  className="text-destructive focus:text-destructive"
                                >
                                  <Trash2 className="w-4 h-4 mr-2" /> Fshi
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {/* Footer: count + pagination */}
        <div className="flex items-center justify-between gap-3 p-3 border-t border-border">
          <span className="text-sm text-muted-foreground">{filteredInvoices.length} fatura</span>
          {filteredInvoices.length > visibleCount && (
            <Button variant="outline" size="sm" onClick={() => setVisibleCount((c) => c + 50)}>
              Shfaq më shumë ({filteredInvoices.length - visibleCount})
            </Button>
          )}
        </div>
      </Card>

      {/* Quick view/edit drawer (row click) */}
      {drawerInvoice && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDrawerInvoice(null)} />
          <div className="absolute top-0 right-0 h-full w-[400px] max-w-[90vw] bg-card border-l border-border shadow-xl flex flex-col animate-in slide-in-from-right duration-200">
            {/* Header */}
            <div className="flex items-start justify-between gap-2 p-4 border-b border-border">
              <div className="min-w-0">
                <div className="font-mono text-body-sm font-semibold truncate">{drawerInvoice.invoiceNumber || drawerInvoice.id.slice(0, 8)}</div>
                <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                  {(() => { const p = statusPill(drawerStatus); return (
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${p.pillClass}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${p.dotClass}`} /> {p.label}
                    </span>
                  ); })()}
                  <span className="font-mono text-sm font-semibold">
                    {(drawerInvoice.total ?? drawerInvoice.amount ?? 0).toLocaleString()} {(drawerInvoice as any).currency === 'EUR' ? '€' : 'L'}
                  </span>
                </div>
              </div>
              <Button variant="ghost" size="icon" className="h-8 w-8 flex-shrink-0" onClick={() => setDrawerInvoice(null)} title="Mbyll">
                <X className="w-4 h-4" />
              </Button>
            </div>
            {/* Body */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Klienti</label>
                <select value={drawerCustomer} onChange={(e) => setDrawerCustomer(e.target.value)} disabled={!permissions.canEdit} className="mt-1 w-full h-9 px-2 border border-border rounded-md bg-background text-sm">
                  <option value="">— Zgjidh klientin —</option>
                  {(customers || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Projekti</label>
                <select value={drawerProject} onChange={(e) => setDrawerProject(e.target.value)} disabled={!permissions.canEdit} className="mt-1 w-full h-9 px-2 border border-border rounded-md bg-background text-sm">
                  <option value="">Pa projekt</option>
                  {Array.from(projectById.values()).map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Totali</label>
                <div className="mt-1 w-full h-9 px-2 flex items-center border border-border rounded-md bg-muted/40 text-sm font-mono font-semibold">
                  {(drawerInvoice.total ?? drawerInvoice.amount ?? 0).toLocaleString()} {(drawerInvoice as any).currency === 'EUR' ? '€' : 'L'}
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">Totali vjen nga shërbimet e faturës. Për të ndryshuar shërbimet, hap faturën e plotë më poshtë.</p>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Afati</label>
                <input type="date" value={drawerDue} onChange={(e) => setDrawerDue(e.target.value)} disabled={!permissions.canEdit} className="mt-1 w-full h-9 px-2 border border-border rounded-md bg-background text-sm" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Statusi</label>
                <select value={drawerStatus} onChange={(e) => setDrawerStatus(e.target.value)} disabled={!permissions.canEdit} className="mt-1 w-full h-9 px-2 border border-border rounded-md bg-background text-sm">
                  {['Draft', 'Pending', 'Partial', 'Paid', 'Overdue', 'Cancelled'].map((s) => <option key={s} value={s}>{getInvoiceStatusLabel(s)}</option>)}
                </select>
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
                  Mënyra e pagesës:&nbsp;<span className="font-medium text-foreground">{drawerInvoice.paymentMethod === 'Bank' ? 'Transfer' : drawerInvoice.paymentMethod === 'Cash' ? 'Kesh' : drawerInvoice.paymentMethod || 'Stripe'}</span>
                </span>
                <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
                  Data e lëshimit:&nbsp;<span className="font-medium text-foreground">{drawerInvoice.invoiceDate ? new Date(drawerInvoice.invoiceDate).toLocaleDateString() : new Date(drawerInvoice.createdAt).toLocaleDateString()}</span>
                </span>
              </div>
            </div>
            {/* Footer */}
            <div className="p-4 border-t border-border space-y-2">
              {permissions.canEdit && (
                <Button variant="outline" className="w-full" onClick={() => { const inv = drawerInvoice; setDrawerInvoice(null); setEditInvoice(inv); }}>
                  <Edit2 className="w-4 h-4 mr-1" /> Ndrysho faturën e plotë (shërbimet)
                </Button>
              )}
              <div className="flex gap-2">
                {permissions.canEdit && (
                  <Button className="flex-1" onClick={handleSaveDrawer} disabled={drawerSaving}>
                    {drawerSaving ? 'Duke ruajtur…' : 'Ruaj ndryshimet'}
                  </Button>
                )}
                <Button variant="outline" className={permissions.canEdit ? '' : 'flex-1'} onClick={() => handleSendEmail(drawerInvoice.id)}>
                  <Mail className="w-4 h-4 mr-1" /> Dërgo
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {selectedInvoice && (
        <Dialog open={!!selectedInvoice} onOpenChange={() => setSelectedInvoice(null)}>
          <DialogContent className="w-full max-w-full sm:max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Detajet e Faturës</DialogTitle>
            </DialogHeader>
            <InvoiceDetails invoice={selectedInvoice} />
          </DialogContent>
        </Dialog>
      )}

      {/* Partial Payment Dialog */}
      {partialPaymentInvoice && (
        <Dialog open={!!partialPaymentInvoice} onOpenChange={(open) => { if (!open) { setPartialPaymentInvoice(null); setPartialAmount(''); setPartialNote(''); } }}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Pagesë Pjesore</DialogTitle>
            </DialogHeader>
            {(() => {
              const inv = partialPaymentInvoice;
              const invCur = (inv as any).currency || 'ALL';
              const curSymbol = invCur === 'EUR' ? '€' : 'L';
              const total = inv.total ?? inv.amount ?? 0;
              const alreadyPaid = inv.paidAmount ?? 0;
              const remaining = total - alreadyPaid;
              return (
                <div className="space-y-4">
                  <div className="bg-muted rounded-lg p-3 space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Totali i faturës</span>
                      <span className="font-semibold">{total.toLocaleString()} {curSymbol}</span>
                    </div>
                    {alreadyPaid > 0 && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Paguar deri tani</span>
                        <span className="font-semibold text-green-600">{alreadyPaid.toLocaleString()} {curSymbol}</span>
                      </div>
                    )}
                    <div className="flex justify-between border-t pt-1 mt-1">
                      <span className="text-muted-foreground">Mbetet për t'u paguar</span>
                      <span className="font-bold text-amber-600">{remaining.toLocaleString()} {curSymbol}</span>
                    </div>
                    {/* Progress bar */}
                    {alreadyPaid > 0 && (
                      <div className="w-full h-2 bg-background rounded-full overflow-hidden mt-2">
                        <div className="h-full bg-green-500 rounded-full" style={{ width: `${Math.min((alreadyPaid / total) * 100, 100)}%` }} />
                      </div>
                    )}
                  </div>
                  {inv.partialPayments && inv.partialPayments.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-muted-foreground">Pagesat e kaluara</p>
                      {inv.partialPayments.map((p, i) => (
                        <div key={i} className="flex justify-between text-xs border rounded px-2 py-1">
                          <span className="text-muted-foreground">{new Date(p.paidAt).toLocaleDateString()} · {p.method || '-'}{p.note ? ` · ${p.note}` : ''}</span>
                          <span className="font-medium text-green-600">+{p.amount.toLocaleString()} {curSymbol}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="space-y-3">
                    <div>
                      <Label className="text-sm">Shuma e pagesës *</Label>
                      <div className="flex gap-2 mt-1">
                        <Input
                          type="number"
                          value={partialAmount}
                          onChange={e => setPartialAmount(e.target.value)}
                          placeholder={`max ${remaining.toLocaleString()}`}
                          min={1}
                          max={remaining}
                          autoFocus
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          className="whitespace-nowrap"
                          onClick={() => setPartialAmount(String(Math.round(remaining / 2)))}
                        >
                          50%
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setPartialAmount(String(remaining))}
                        >
                          Gjithçka
                        </Button>
                      </div>
                    </div>
                    <div>
                      <Label className="text-sm">Mënyra e pagesës</Label>
                      <select
                        value={partialMethod}
                        onChange={e => setPartialMethod(e.target.value)}
                        className="mt-1 w-full h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                      >
                        <option value="Cash">Kesh</option>
                        <option value="Bank">Transfer Bankar</option>
                        <option value="Stripe">Stripe</option>
                        <option value="Crypto">Crypto</option>
                        <option value="Other">Tjetër</option>
                      </select>
                    </div>
                    <div>
                      <Label className="text-sm">Shënim (opsional)</Label>
                      <Input
                        value={partialNote}
                        onChange={e => setPartialNote(e.target.value)}
                        placeholder="p.sh. Paradhënie, këst i parë..."
                        className="mt-1"
                      />
                    </div>
                  </div>
                  <div className="flex justify-end gap-2 pt-2">
                    <Button variant="outline" onClick={() => { setPartialPaymentInvoice(null); setPartialAmount(''); }}>Anulo</Button>
                    <Button onClick={handleRecordPartialPayment} disabled={partialSaving || !partialAmount}>
                      {partialSaving ? 'Duke ruajtur...' : 'Regjistro Pagesën'}
                    </Button>
                  </div>
                </div>
              );
            })()}
          </DialogContent>
        </Dialog>
      )}

      {/* Quick "link to project" — updates ONLY projectId, so it is safe to use on an
          issued invoice without re-saving amounts, dates or bank details. */}
      <Dialog
        open={!!linkProjectInvoice}
        onOpenChange={(open) => { if (!open) { setLinkProjectInvoice(null); setLinkProjectSearch(''); } }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              Lidh faturën me projekt
              {linkProjectInvoice && (
                <span className="block text-xs font-normal text-muted-foreground mt-0.5 font-mono">
                  {linkProjectInvoice.invoiceNumber || linkProjectInvoice.id.slice(0, 8)}
                </span>
              )}
            </DialogTitle>
          </DialogHeader>
          {linkProjectInvoice && (() => {
            const inv = linkProjectInvoice;
            const q = linkProjectSearch.trim().toLowerCase();
            const all = (allProjects || []).filter(p => !q || (p.name || '').toLowerCase().includes(q));
            // The customer's own projects first — that is the link the user almost
            // always wants — but every other project stays reachable below.
            // Inside each group, archived projects sink to the bottom.
            const ofCustomer = sortArchivedLast(inv.customerId ? all.filter(p => p.customerId === inv.customerId) : []);
            const others = sortArchivedLast(all.filter(p => !inv.customerId || p.customerId !== inv.customerId));
            const current = inv.projectId ? projectById.get(inv.projectId) : undefined;

            const row = (p: Project) => (
              <button
                key={p.id}
                disabled={linkProjectSaving}
                onClick={() => handleLinkProject(inv, p.id)}
                className={`w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-md text-left text-sm hover:bg-muted disabled:opacity-50 ${
                  p.id === inv.projectId ? 'bg-muted' : ''
                }`}
              >
                <span className="flex items-center gap-2 min-w-0">
                  <Folder className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <span className="truncate">{projectPickerLabel(p)}</span>
                </span>
                <span className="flex items-center gap-2 shrink-0">
                  {p.id === inv.projectId && <Check className="w-3.5 h-3.5 text-success" />}
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">{p.status}</Badge>
                </span>
              </button>
            );

            return (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  Klienti: <strong>{customers?.find(c => c.id === inv.customerId)?.name || 'pa klient'}</strong>
                  {current ? <> · aktualisht: <strong>{current.name}</strong></> : null}
                  {inv.projectId && !current ? <> · <span className="text-amber-600">projekt i fshirë</span></> : null}
                </p>
                <Input
                  autoFocus
                  placeholder="Kërko projekt..."
                  value={linkProjectSearch}
                  onChange={e => setLinkProjectSearch(e.target.value)}
                  className="h-8 text-sm"
                />
                <div className="max-h-[46vh] overflow-y-auto space-y-1 -mx-1 px-1">
                  {ofCustomer.length > 0 && (
                    <>
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground px-2 pt-1">Projektet e klientit</p>
                      {ofCustomer.map(row)}
                    </>
                  )}
                  {others.length > 0 && (
                    <>
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground px-2 pt-1">
                        {inv.customerId ? 'Projekte të tjera' : 'Të gjitha projektet'}
                      </p>
                      {others.map(row)}
                    </>
                  )}
                  {all.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-4">Nuk u gjet projekt.</p>
                  )}
                </div>
                <div className="flex justify-between gap-2 pt-1 border-t">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!inv.projectId || linkProjectSaving}
                    onClick={() => handleLinkProject(inv, '')}
                  >
                    Hiq lidhjen
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => { setLinkProjectInvoice(null); setLinkProjectSearch(''); }}>
                    Mbyll
                  </Button>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Delete Invoice Confirmation */}
      <Dialog open={!!invoiceToDelete} onOpenChange={(open) => { if (!open) setInvoiceToDelete(null); }}>
        <DialogContent className="max-w-md">
          {(() => {
            const target = rawInvoices?.find(i => i.id === invoiceToDelete);
            const isWhmcs = target?.source === 'whmcs';
            const isRecurringParent = !!target && (target as any).isRecurring && !(target as any).autoGenerated;
            const kids = target ? childrenOfInvoice(target.id).length : 0;

            // WHMCS or plain one-off invoice \u2192 simple confirm.
            if (isWhmcs || (!isRecurringParent && kids === 0)) {
              return (<>
                <DialogHeader><DialogTitle>{isWhmcs ? 'Anulo Fatur\u00ebn' : 'Fshi Fatur\u00ebn'}</DialogTitle></DialogHeader>
                <p className="text-sm text-muted-foreground">
                  {isWhmcs
                    ? 'Kjo fatur\u00eb vjen nga WHMCS. Do sh\u00ebnohet si e Anuluar (nuk num\u00ebrohet te t\u00eb ardhurat) \u2014 nuk fshihet, q\u00eb t\u00eb mos rikthehet nga sinkronizimi.'
                    : 'Je i sigurt q\u00eb d\u00ebshiron t\u00eb fshish k\u00ebt\u00eb fatur\u00eb? Ky veprim nuk mund t\u00eb zhb\u00ebhet.'}
                </p>
                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" onClick={() => setInvoiceToDelete(null)}>Mbyll</Button>
                  <Button variant="destructive" onClick={() => invoiceToDelete && handleDeleteInvoice(invoiceToDelete)}>{isWhmcs ? 'Anulo Fatur\u00ebn' : 'Fshi'}</Button>
                </div>
              </>);
            }

            // Recurring parent (or one that spawned occurrences) \u2192 choice dialog.
            return (<>
              <DialogHeader><DialogTitle>Fshi / nd\u00ebrprit fatur\u00ebn periodike</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Kjo fatur\u00eb \u00ebsht\u00eb periodike{kids > 0 && <> me <span className="font-medium text-foreground">{kids}</span> fatura t\u00eb gjeneruara</>}. Zgjidh \u00e7far\u00eb t\u00eb b\u00ebhet:
                </p>
                <div className="space-y-2">
                  {(target as any)?.isRecurring && (
                    <label className={`flex gap-3 rounded-lg border p-3 cursor-pointer ${deleteMode === 'stop' ? 'border-primary bg-primary/5' : ''}`}>
                      <input type="radio" name="invdel" className="mt-1" checked={deleteMode === 'stop'} onChange={() => setDeleteMode('stop')} />
                      <div>
                        <div className="text-sm font-medium flex items-center gap-1.5"><CircleStop className="w-4 h-4 text-emerald-600" /> Nd\u00ebrprit p\u00ebrs\u00ebritjen <Badge className="bg-emerald-100 text-emerald-800 text-[10px] py-0">Rekomanduar</Badge></div>
                        <p className="text-xs text-muted-foreground mt-0.5">Nuk gjenerohen m\u00eb fatura t\u00eb reja. Kjo fatur\u00eb dhe t\u00eb gjitha t\u00eb kaluarat mbeten t\u00eb paprekura.</p>
                      </div>
                    </label>
                  )}
                  <label className={`flex gap-3 rounded-lg border p-3 cursor-pointer ${deleteMode === 'one' ? 'border-primary bg-primary/5' : ''}`}>
                    <input type="radio" name="invdel" className="mt-1" checked={deleteMode === 'one'} onChange={() => setDeleteMode('one')} />
                    <div>
                      <div className="text-sm font-medium flex items-center gap-1.5"><Trash2 className="w-4 h-4" /> Fshi vet\u00ebm k\u00ebt\u00eb fatur\u00eb</div>
                      <p className="text-xs text-muted-foreground mt-0.5">Fshihet vet\u00ebm kjo. {(target as any)?.isRecurring && 'P\u00ebrs\u00ebritja vazhdon dhe faturat e gjeneruara mbeten.'}</p>
                    </div>
                  </label>
                  <label className={`flex gap-3 rounded-lg border p-3 cursor-pointer ${deleteMode === 'series' ? 'border-destructive bg-destructive/5' : ''}`}>
                    <input type="radio" name="invdel" className="mt-1" checked={deleteMode === 'series'} onChange={() => setDeleteMode('series')} />
                    <div>
                      <div className="text-sm font-medium flex items-center gap-1.5 text-destructive"><AlertTriangle className="w-4 h-4" /> Fshi gjith\u00eb serin\u00eb</div>
                      <p className="text-xs text-muted-foreground mt-0.5">Fshihet kjo <span className="font-medium text-foreground">dhe t\u00eb gjitha faturat e kaluara</span> ({kids}). Prek t\u00eb ardhurat/P&L-n\u00eb e s\u00eb kaluar\u00ebs \u2014 s'ka kthim.</p>
                    </div>
                  </label>
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <Button variant="outline" onClick={() => setInvoiceToDelete(null)} disabled={deleteBusy}>Anulo</Button>
                  <Button
                    className={deleteMode === 'series' ? 'bg-destructive hover:bg-destructive/90 text-destructive-foreground' : ''}
                    onClick={confirmInvoiceDelete}
                    disabled={deleteBusy}
                  >
                    {deleteBusy ? 'Duke ruajtur\u2026' : deleteMode === 'stop' ? 'Nd\u00ebrprit' : 'Fshi'}
                  </Button>
                </div>
              </div>
            </>);
          })()}
        </DialogContent>
      </Dialog>

      {/* Unsaved Changes Confirmation */}
      <AlertDialog open={discardOpen} onOpenChange={(open) => { if (!open) cancelDiscard(); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>T\u00eb dh\u00ebnat nuk u ruajt\u00ebn</AlertDialogTitle>
            <AlertDialogDescription>
              Ke ndryshime t\u00eb paruajtura. A je i sigurt q\u00eb d\u00ebshiron t\u00eb mbyll\u00ebsh pa ruajtur?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={cancelDiscard}>Kthehu</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDiscard} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Hiq Ndryshimet
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirm before manually generating recurring invoices */}
      <AlertDialog open={showRecurringConfirm} onOpenChange={setShowRecurringConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Gjenero faturat periodike?</AlertDialogTitle>
            <AlertDialogDescription>
              {dueRecurringCount > 0
                ? `Do të gjenerohen deri në ${dueRecurringCount} faturë të reja për abonimet periodike që kanë arritur datën e tyre. Klientët përkatës mund të njoftohen me email.`
                : 'Do të kontrollohen të gjitha faturat periodike. Aktualisht asnjë nuk e ka arritur datën e gjenerimit, ndaj ka gjasa të mos krijohet asnjë faturë e re.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={triggeringRecurring}>Anulo</AlertDialogCancel>
            <AlertDialogAction
              disabled={triggeringRecurring}
              onClick={(e) => {
                // Keep the dialog logic; run after closing. The button below also
                // shows a spinner via `triggeringRecurring`.
                e.preventDefault();
                setShowRecurringConfirm(false);
                handleTriggerRecurringInvoices();
              }}
            >
              {triggeringRecurring ? 'Duke gjeneruar...' : 'Gjenero'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

const InvoiceForm: React.FC<{ onClose: () => void; editInvoice?: Invoice | null; onDirtyChange?: (dirty: boolean) => void }> = ({ onClose, editInvoice, onDirtyChange }) => {
  const isEditing = !!editInvoice;
  const logActivity = useActivityLogger();
  const [invoiceDate, setInvoiceDate] = useState<Date | undefined>(editInvoice?.invoiceDate ? new Date(editInvoice.invoiceDate) : new Date());
  const [dueDate, setDueDate] = useState<Date | undefined>(editInvoice?.dueDate ? new Date(editInvoice.dueDate) : undefined);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>(editInvoice?.customerId || '');
  const [selectedProjectId, setSelectedProjectId] = useState<string>(editInvoice?.projectId || '');
  const [customerSearchOpen, setCustomerSearchOpen] = useState(false);
  const [customerSearch, setCustomerSearch] = useState('');
  // A line is either a catalogue service (serviceId) or a free-text line carrying
  // its own description + unitPrice (invoices raised from a task or a project
  // budget). Both must survive an edit: the form used to keep only serviceId, so
  // opening such an invoice and saving wiped its lines and zeroed the total.
  const [lineItems, setLineItems] = useState<Array<{ serviceId: string; quantity: number; description?: string; unitPrice?: number }>>([]);
  const [tax, setTax] = useState<number>((editInvoice as any)?.tax || 0);
  const [discount, setDiscount] = useState<number>((editInvoice as any)?.discount || 0);
  const [discountType, setDiscountType] = useState<'fixed' | 'percent'>((editInvoice as any)?.discountType || 'fixed');
  const [invoiceNumber, setInvoiceNumber] = useState(editInvoice?.invoiceNumber || '');
  const [paymentMethod, setPaymentMethod] = useState(editInvoice?.paymentMethod || 'Stripe');
  const [currency, setCurrency] = useState<'ALL' | 'EUR'>((editInvoice as any)?.currency || 'ALL');
  const [bankName, setBankName] = useState((editInvoice as any)?.bankName || '');
  const [bankIBAN, setBankIBAN] = useState((editInvoice as any)?.bankIBAN || '');
  const [bankSWIFT, setBankSWIFT] = useState((editInvoice as any)?.bankSWIFT || '');
  const [bankAccountHolder, setBankAccountHolder] = useState((editInvoice as any)?.bankAccountHolder || '');
  const [bankCountry, setBankCountry] = useState((editInvoice as any)?.bankCountry || '');
  const teamSettingsData = useTeamSettingsData();
  const savedBankAccounts = teamSettingsData?.bankAccounts ?? (() => {
    try { return JSON.parse(localStorage.getItem('bank_accounts') || '[]'); } catch { return []; }
  })();
  const [status, setStatus] = useState(editInvoice?.status || 'Pending');
  const [paidAtDateForm, setPaidAtDateForm] = useState<string>(
    editInvoice?.paidAt
      ? new Date(editInvoice.paidAt).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10)
  );
  const [notes, setNotes] = useState((editInvoice as any)?.notes || '');
  const [paymentUrl, setPaymentUrl] = useState((editInvoice as any)?.paymentUrl || '');
  const [isRecurring, setIsRecurring] = useState((editInvoice as any)?.isRecurring || false);
  const [isRecurringPaused, setIsRecurringPaused] = useState((editInvoice as any)?.isRecurringPaused || false);
  const [recurringFrequency, setRecurringFrequency] = useState((editInvoice as any)?.recurringFrequency || 'monthly');
  const [nextRecurringDate, setNextRecurringDate] = useState<Date | undefined>(() => {
    const raw = (editInvoice as any)?.nextRecurringDate;
    if (!raw) return undefined;
    return raw?.toDate ? raw.toDate() : new Date(raw);
  });
  const [recurringEndDate, setRecurringEndDate] = useState<Date | undefined>(() => {
    const raw = (editInvoice as any)?.recurringEndDate;
    if (!raw) return undefined;
    return raw?.toDate ? raw.toDate() : new Date(raw);
  });
  const [loadedExistingItems, setLoadedExistingItems] = useState(false);

  const teamId = useGlobalTeamId();
  const { data: rawFormCustomers } = useCollection<Customer>('customers', { skipTeamFilter: true });
  // SalesAgent/Member see only their assigned customers in the dropdown
  const customers = useFilteredByOwner(rawFormCustomers);
  const { data: services } = useCollection<Service>('services', { skipTeamFilter: true });
  const { data: projects } = useCollection<Project>('projects', { skipTeamFilter: true });
  const { data: portalAccessList } = useCollection<ClientPortalAccess>('clientPortalAccess', { skipTeamFilter: true });
  const { data: allInvoices, loading: invoicesLoading } = useCollection<Invoice>('invoices', { skipTeamFilter: true });
  const { data: existingItems } = useCollection<InvoiceItem>('invoiceItems', isEditing
    ? { where: [{ field: 'invoiceId', operator: '==', value: editInvoice!.id }], skipTeamFilter: true }
    : undefined
  );
  const { user: currentUser } = useAuth();
  const invoiceMutation = useMutation<Invoice>('invoices');
  const invoiceItemMutation = useMutation<InvoiceItem>('invoiceItems');
  const accessMutation = useMutation<ClientPortalAccess>('clientPortalAccess');
  const invoiceNotifMutation = useMutation<any>('notifications');
  const { data: invoiceTeamMembers } = useCollection<any>('teamMembers', {
    where: [{ field: 'status', operator: '==', value: 'Active' }],
  });
  // Scope notification recipients to the ACTIVE business (super-admins read all tenants'
  // teamMembers), so creating an invoice doesn't notify other tenants' admins.
  const activeBusinessId = useGlobalBusinessId();
  const scopedInvoiceMembers = useMemo(
    () => (invoiceTeamMembers || []).filter((m: any) => !activeBusinessId || !m.businessId || m.businessId === activeBusinessId),
    [invoiceTeamMembers, activeBusinessId]
  );

  // Auto-generate invoice number for new invoices using a Firebase atomic counter.
  // Scoped to the BUSINESS (counters/invoices_{businessId}), not the team: teams are
  // departments inside one business, so a per-team counter restarted at FAT-001 in
  // every department and issued colliding numbers. The seed is the highest FAT-XXX
  // in use across the whole business.
  const numberGenerated = React.useRef(false);
  React.useEffect(() => {
    const scopeId = activeBusinessId || teamId;
    if (!isEditing && !invoicesLoading && allInvoices && !numberGenerated.current && scopeId) {
      numberGenerated.current = true;
      let maxNum = 0;
      const scopeInvoices = activeBusinessId
        ? allInvoices.filter(inv => !(inv as any).businessId || (inv as any).businessId === activeBusinessId)
        : allInvoices.filter(inv => (inv as any).teamId === teamId);
      for (const inv of scopeInvoices) {
        const match = inv.invoiceNumber?.match(/^FAT-(\d+)$/i);
        if (match) {
          const n = parseInt(match[1], 10);
          if (n > maxNum) maxNum = n;
        }
      }
      getNextInvoiceNumber(scopeId, maxNum)
        .then(setInvoiceNumber)
        .catch(() => {
          // Fallback to client-side if transaction fails
          setInvoiceNumber(`FAT-${String(maxNum + 1).padStart(3, '0')}`);
        });
    }
  }, [allInvoices, invoicesLoading, teamId, activeBusinessId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-fill bank defaults from settings when creating a new invoice
  React.useEffect(() => {
    if (isEditing) return; // don't overwrite when editing existing invoice
    if (bankIBAN) return;  // already has a value
    // Try Firestore data first, then localStorage fallback
    const accounts = teamSettingsData?.bankAccounts ?? (() => {
      try { return JSON.parse(localStorage.getItem('bank_accounts') || '[]'); } catch { return []; }
    })();
    if (accounts.length > 0) {
      const first = accounts[0];
      setBankName(first.bankName || '');
      setBankIBAN(first.iban || '');
      setBankSWIFT(first.swift || '');
      setBankAccountHolder(first.accountHolder || '');
      setBankCountry(first.country || '');
      return;
    }
    // Legacy single-bank keys
    const legacyIban = localStorage.getItem('default_bank_iban');
    if (legacyIban) {
      setBankName(localStorage.getItem('default_bank_name') || '');
      setBankIBAN(legacyIban);
      setBankSWIFT(localStorage.getItem('default_bank_swift') || '');
      setBankAccountHolder(localStorage.getItem('default_bank_holder') || '');
      setBankCountry(localStorage.getItem('default_bank_country') || '');
    }
  }, [teamSettingsData]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load existing line items when editing
  React.useEffect(() => {
    if (isEditing && existingItems && existingItems.length > 0 && !loadedExistingItems) {
      setLineItems(existingItems.map(item => ({
        serviceId: item.serviceId || '',
        quantity: item.quantity,
        description: (item as any).description || undefined,
        unitPrice: typeof item.unitPrice === 'number' ? item.unitPrice : undefined,
      })));
      setLoadedExistingItems(true);
    }
  }, [isEditing, existingItems, loadedExistingItems]);

  const addLineItem = () => {
    setLineItems([...lineItems, { serviceId: '', quantity: 1 }]);
    onDirtyChange?.(true);
  };

  const removeLineItem = (index: number) => {
    setLineItems(lineItems.filter((_, i) => i !== index));
    onDirtyChange?.(true);
  };

  const updateLineItem = (index: number, field: 'serviceId' | 'quantity' | 'description' | 'unitPrice', value: string | number) => {
    const updated = [...lineItems];
    updated[index] = { ...updated[index], [field]: value };
    setLineItems(updated);
    onDirtyChange?.(true);
  };

  // Convert a service price to the invoice currency, respecting the service's own currency.
  const toInvoiceCurrency = (servicePrice: number, serviceCurrency?: string) => {
    const svcCur = (serviceCurrency || 'ALL').toUpperCase();
    if (svcCur === currency) return servicePrice;           // same currency → no conversion
    // Convert source → ALL, then ALL → target. Handles any currency (EUR/USD/GBP),
    // not just EUR↔ALL, so USD/GBP service prices no longer bill at face value.
    const inAll = servicePrice * getRateToAll(svcCur);
    return inAll / getRateToAll(currency);
  };

  const calculateSubtotal = () => {
    return lineItems.reduce((sum, item) => {
      const service = services?.find(s => s.id === item.serviceId);
      if (service) return sum + toInvoiceCurrency(service.price, service.currency) * item.quantity;
      // Free-text line: its own price is the source of truth (a task/budget line
      // has no catalogue service, and returning 0 here zeroed the invoice).
      return sum + (Number(item.unitPrice) || 0) * item.quantity;
    }, 0);
  };

  const calculateDiscountAmount = (subtotal: number) => {
    if (!discount || discount <= 0) return 0;
    if (discountType === 'percent') return subtotal * (Math.min(discount, 100) / 100);
    return Math.min(discount, subtotal);
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    // Validate paymentUrl — only allow http/https to prevent XSS via javascript: scheme
    if (paymentUrl && !/^https?:\/\//i.test(paymentUrl)) {
      toast({ title: 'URL e pagesës e pavlefshme', description: 'URL duhet të fillojë me http:// ose https://', variant: 'destructive' });
      return;
    }

    if (isRecurring && !recurringFrequency) {
      toast({ title: 'Zgjidh frekuencën', description: 'Duhet të zgjidhni frekuencën për faturë periodike.', variant: 'destructive' });
      return;
    }

    const subtotal = calculateSubtotal();
    // When editing and items haven't loaded yet, preserve the original subtotal
    // to avoid overwriting with 0 before line items are populated.
    const resolvedSubtotal = (isEditing && !loadedExistingItems && subtotal === 0)
      ? (editInvoice?.subtotal || editInvoice?.total || editInvoice?.amount || 0)
      : subtotal;
    const discountAmount = calculateDiscountAmount(resolvedSubtotal);
    const total = resolvedSubtotal - discountAmount + tax;

    // Default next-recurrence = ONE cycle after this (first) invoice's due date,
    // so the mother covers period 1 and the first auto-generated child starts
    // period 2 (instead of duplicating period 1). Explicit user value wins.
    const defaultNextRecurring = () => {
      const d = new Date(dueDate || invoiceDate || new Date());
      if (recurringFrequency === 'weekly') d.setDate(d.getDate() + 7);
      else if (recurringFrequency === 'quarterly') d.setMonth(d.getMonth() + 3);
      else if (recurringFrequency === 'yearly') d.setFullYear(d.getFullYear() + 1);
      else d.setMonth(d.getMonth() + 1); // monthly
      return d;
    };

    const invoiceData: any = {
      customerId: selectedCustomerId,
      projectId: selectedProjectId || '',
      invoiceNumber,
      paymentMethod,
      currency,
      bankName: bankName || '',
      bankIBAN: bankIBAN || '',
      bankSWIFT: bankSWIFT || '',
      bankAccountHolder: bankAccountHolder || '',
      bankCountry: bankCountry || '',
      status,
      invoiceDate: invoiceDate || new Date(),
      dueDate: dueDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      notes,
      subtotal: resolvedSubtotal,
      discount,
      discountType,
      tax,
      total,
      paymentUrl,
      isRecurring,
      isRecurringPaused: isRecurring ? isRecurringPaused : false,
      recurringFrequency: isRecurring ? recurringFrequency : undefined,
      // nextRecurringDate: user-set value takes priority; else default to one
      // full cycle after the due date so the first child doesn't re-bill period 1.
      nextRecurringDate: isRecurring
        ? (nextRecurringDate || defaultNextRecurring())
        : null,
      // "Repeat until" — cleared when recurrence is off so a stale end-date can't linger.
      recurringEndDate: isRecurring ? (recurringEndDate || null) : null,
    };

    if (isEditing) {
      // Set paidAt when manually marking as Paid via the full edit form
      if (status === 'Paid' && editInvoice?.status !== 'Paid') {
        invoiceData.paidAt = paidAtDateForm ? new Date(paidAtDateForm + 'T12:00:00') : new Date();
      } else if (status === 'Paid' && editInvoice?.status === 'Paid') {
        // Keep existing paidAt but allow updating it via the date field
        invoiceData.paidAt = paidAtDateForm ? new Date(paidAtDateForm + 'T12:00:00') : editInvoice.paidAt;
      }
      // Do NOT reset emailSent/reminderSent flags on edit — cron uses them to avoid duplicate sends

      // Update existing invoice
      await invoiceMutation.update(editInvoice!.id, invoiceData);

      // Delete old line items and recreate
      if (existingItems) {
        for (const old of existingItems) {
          await invoiceItemMutation.remove(old.id);
        }
      }

      for (const item of lineItems) {
        const service = services?.find(s => s.id === item.serviceId);
        if (service) {
          await invoiceItemMutation.create({
            invoiceId: editInvoice!.id,
            customerId: editInvoice!.customerId, // portal RLS (isPortalClientFor)
            serviceId: item.serviceId,
            quantity: item.quantity,
            unitPrice: toInvoiceCurrency(service.price, service.currency),
            totalPrice: toInvoiceCurrency(service.price * item.quantity, service.currency),
          });
        } else if (Number(item.unitPrice) > 0 || item.description) {
          // Free-text line (task/budget invoice): keep it instead of dropping it.
          await invoiceItemMutation.create({
            invoiceId: editInvoice!.id,
            customerId: editInvoice!.customerId,
            description: item.description || '',
            quantity: item.quantity,
            unitPrice: Number(item.unitPrice) || 0,
            totalPrice: (Number(item.unitPrice) || 0) * item.quantity,
          } as any);
        }
      }
    } else {
      // Create new invoice — set email flags to false (not yet sent)
      invoiceData.emailSent = false;
      invoiceData.reminderSent = false;
      invoiceData.reminder25Sent = false;
      invoiceData.reminderLastDaySent = false;

      const invoice = await invoiceMutation.create(invoiceData);

      const customerName = customers?.find(c => c.id === selectedCustomerId)?.name || '';
      logActivity('invoice_created', `Faturë e re: ${invoiceNumber || invoice.id.slice(0,8)}`, {
        entityType: 'invoice', entityId: invoice.id, customerId: selectedCustomerId,
        description: `${total.toLocaleString()} ALL — ${customerName}`
      });

      // Notify Admin/finance members about the new invoice
      const invoiceRecipients = scopedInvoiceMembers.filter((m: any) => m.userId !== currentUser?.uid && (m.role === 'Admin' || m.canAccessInvoices));
      await Promise.all(invoiceRecipients.map((m: any) => invoiceNotifMutation.create({
        userId: m.userId,
        type: 'invoice_created',
        title: 'Faturë e Re',
        message: `Faturë e re${invoiceNumber ? ` ${invoiceNumber}` : ''} për ${customerName || 'klient'} — ${total.toLocaleString()} ${invoiceData.currency || 'ALL'}.`,
        isRead: false,
        actionUrl: '/app/invoices',
        actionLabel: 'Shiko Faturat',
      }))).catch(err => console.error('[Notifications] invoice_created dërgim dështoi:', err));

      // Auto-create portal access for this customer if it doesn't exist
      if (selectedCustomerId) {
        const customer = customers?.find(c => c.id === selectedCustomerId);
        const existingAccess = portalAccessList?.find(
          a => a.customerId === selectedCustomerId && a.status === 'Active'
        );
        if (customer?.email && !existingAccess) {
          await accessMutation.create({
            customerId: selectedCustomerId,
            userId: '',
            email: customer.email.toLowerCase().trim(),
            status: 'Active',
          }).catch(() => { /* non-blocking */ });
        }
      }

      for (const item of lineItems) {
        const service = services?.find(s => s.id === item.serviceId);
        if (service) {
          await invoiceItemMutation.create({
            invoiceId: invoice.id,
            customerId: selectedCustomerId, // portal RLS (isPortalClientFor)
            serviceId: item.serviceId,
            quantity: item.quantity,
            unitPrice: toInvoiceCurrency(service.price, service.currency),
            totalPrice: toInvoiceCurrency(service.price * item.quantity, service.currency),
          });
        } else if (Number(item.unitPrice) > 0 || item.description) {
          await invoiceItemMutation.create({
            invoiceId: invoice.id,
            customerId: selectedCustomerId,
            description: item.description || '',
            quantity: item.quantity,
            unitPrice: Number(item.unitPrice) || 0,
            totalPrice: (Number(item.unitPrice) || 0) * item.quantity,
          } as any);
        }
      }
    }

    onDirtyChange?.(false);
    onClose();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6" onInput={() => onDirtyChange?.(true)}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label htmlFor="invoiceNumber">Numri i Faturës</Label>
          <Input id="invoiceNumber" name="invoiceNumber" placeholder="FAT-001" value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} />
        </div>

        <div>
          <Label>Klienti *</Label>
          <Popover open={customerSearchOpen} onOpenChange={setCustomerSearchOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                role="combobox"
                className="w-full justify-between font-normal"
              >
                {selectedCustomerId
                  ? (() => { const c = customers?.find(x => x.id === selectedCustomerId); return c ? `${c.name}${c.company ? ` (${c.company})` : ''}` : 'Zgjidh klientin'; })()
                  : 'Zgjidh klientin'}
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
              <Command shouldFilter={false}>
                <CommandInput
                  placeholder="Kërko klient..."
                  value={customerSearch}
                  onValueChange={setCustomerSearch}
                />
                <CommandList>
                  <CommandEmpty>Nuk u gjet asnjë klient.</CommandEmpty>
                  <CommandGroup>
                    {customers
                      ?.filter(c =>
                        c.name?.toLowerCase().includes(customerSearch.toLowerCase()) ||
                        c.company?.toLowerCase().includes(customerSearch.toLowerCase())
                      )
                      .map(customer => (
                        <CommandItem
                          key={customer.id}
                          value={customer.id}
                          onSelect={() => {
                            // Only drop the project link when the customer actually
                            // CHANGES — re-picking the same one must not silently
                            // unlink the project of an invoice being edited.
                            if (customer.id !== selectedCustomerId) setSelectedProjectId('');
                            setSelectedCustomerId(customer.id);
                            setCustomerSearch('');
                            setCustomerSearchOpen(false);
                            onDirtyChange?.(true);
                          }}
                        >
                          <Check className={`mr-2 h-4 w-4 ${selectedCustomerId === customer.id ? 'opacity-100' : 'opacity-0'}`} />
                          {customer.name}{customer.company ? ` (${customer.company})` : ''}
                        </CommandItem>
                      ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {/* Project link. Always rendered — the old version only appeared when a customer
          was selected AND that customer already had projects, so an invoice with no
          customer (or one linked to a project belonging to someone else) could never be
          re-linked or UNLINKED, and the link stayed invisible. */}
      {(() => {
        const all = projects || [];
        const linked = selectedProjectId ? all.find(p => p.id === selectedProjectId) : undefined;
        // Archived projects stay linkable (an old invoice belongs to one) but sit at
        // the bottom of their group; the status is already spelled out per row.
        const customerProjects = sortArchivedLast(
          selectedCustomerId ? all.filter(p => p.customerId === selectedCustomerId) : []
        );
        // Projects of other customers (or with none) stay reachable under a separate
        // group instead of being silently unavailable.
        const otherProjects = sortArchivedLast(all
          .filter(p => !selectedCustomerId || p.customerId !== selectedCustomerId)
          .sort((a, b) => (a.name || '').localeCompare(b.name || '')));
        const mismatch = !!linked && !!selectedCustomerId && !!linked.customerId && linked.customerId !== selectedCustomerId;

        return (
          <div>
            <Label>Projekti (lidh faturën me projektin)</Label>
            <Select
              value={selectedProjectId || '__none__'}
              onValueChange={v => { setSelectedProjectId(v === '__none__' ? '' : v); onDirtyChange?.(true); }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Pa projekt (opsionale)" />
              </SelectTrigger>
              <SelectContent>
                {/* An explicit "no project" entry — clearing the link was impossible before. */}
                <SelectItem value="__none__">Pa projekt</SelectItem>
                {customerProjects.length > 0 && (
                  <SelectGroup>
                    <SelectLabel>Projektet e klientit</SelectLabel>
                    {customerProjects.map(proj => (
                      <SelectItem key={proj.id} value={proj.id}>
                        {proj.name} — {proj.status}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )}
                {otherProjects.length > 0 && (
                  <SelectGroup>
                    <SelectLabel>{selectedCustomerId ? 'Projekte të tjera' : 'Të gjitha projektet'}</SelectLabel>
                    {otherProjects.map(proj => (
                      <SelectItem key={proj.id} value={proj.id}>
                        {proj.name} — {proj.status}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )}
              </SelectContent>
            </Select>
            {/* A projectId whose project is gone must not read as "not linked". */}
            {selectedProjectId && !linked && (
              <p className="text-xs text-amber-600 mt-1">
                ⚠ Projekti i lidhur nuk ekziston më. Zgjidh një projekt tjetër ose “Pa projekt”.
              </p>
            )}
            {mismatch && (
              <p className="text-xs text-amber-600 mt-1">
                ⚠ Ky projekt i përket një klienti tjetër ({customers?.find(c => c.id === linked!.customerId)?.name || 'i panjohur'}).
              </p>
            )}
            {!selectedProjectId && (
              <p className="text-xs text-muted-foreground mt-1">
                Pa projekt, fatura nuk numërohet te “Fitimi sipas projekti” me bazën “Faturuar”.
              </p>
            )}
          </div>
        );
      })()}

      <div>
        <div className="flex items-center justify-between mb-2">
          <Label>Artikujt *</Label>
          <Button type="button" variant="outline" size="sm" onClick={addLineItem}>
            <Plus className="w-4 h-4 mr-2" />
            Shto Artikull
          </Button>
        </div>
        <div className="space-y-2">
          {lineItems.map((item, index) => (
            <div key={index} className="flex flex-col sm:flex-row gap-2 sm:items-end p-2 sm:p-0 bg-muted/30 sm:bg-transparent rounded-lg sm:rounded-none">
              <div className="flex-1">
                {/* A free-text line (raised from a task or a project budget) has no
                    catalogue service: edit its description + price directly, so it
                    survives an edit instead of being replaced by an empty select. */}
                {!item.serviceId && (item.description !== undefined || Number(item.unitPrice) > 0) ? (
                  <div className="flex gap-2">
                    <Input
                      value={item.description || ''}
                      onChange={(e) => updateLineItem(index, 'description', e.target.value)}
                      placeholder="Përshkrimi"
                      className="flex-1"
                    />
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={item.unitPrice ?? ''}
                      onChange={(e) => updateLineItem(index, 'unitPrice', parseFloat(e.target.value) || 0)}
                      placeholder="Çmimi"
                      className="w-24 sm:w-32"
                    />
                  </div>
                ) : (
                  <Select
                    value={item.serviceId || "placeholder"}
                    onValueChange={(value) => {
                      if (value !== "placeholder") {
                        updateLineItem(index, 'serviceId', value);
                      }
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Zgjidh shërbimin" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="placeholder" disabled>Zgjidh shërbimin</SelectItem>
                      {services?.map(service => (
                        <SelectItem key={service.id} value={service.id}>
                          {service.title || service.name} - {service.price} {(service.currency || 'ALL') === 'EUR' ? '€' : 'L'}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              <div className="flex items-center gap-2">
                <div className="w-20 sm:w-24">
                  <Input
                    type="number"
                    min="1"
                    step="1"
                    value={item.quantity}
                    onChange={(e) => updateLineItem(index, 'quantity', Math.max(1, parseInt(e.target.value) || 1))}
                    placeholder="Sasia"
                  />
                </div>
                <div className="w-20 sm:w-24 text-right text-sm font-medium">
                  {(() => {
                    const svc = services?.find(s => s.id === item.serviceId);
                    if (svc) return toInvoiceCurrency(svc.price * item.quantity, svc.currency).toFixed(2);
                    return ((Number(item.unitPrice) || 0) * item.quantity).toFixed(2);
                  })()} {currency === 'EUR' ? '€' : 'L'}
                </div>
                <Button type="button" variant="outline" size="sm" onClick={() => removeLineItem(index)}>
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <Label htmlFor="paymentMethod">Mënyra e Pagesës</Label>
          <Select name="paymentMethod" value={paymentMethod} onValueChange={setPaymentMethod}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Stripe">Stripe</SelectItem>
              <SelectItem value="Cash">Kesh</SelectItem>
              <SelectItem value="Bank">Transfer Bankar</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label htmlFor="currency">Monedha</Label>
          <Select name="currency" value={currency} onValueChange={(v) => setCurrency(v as 'ALL' | 'EUR')}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Lekë (ALL)</SelectItem>
              <SelectItem value="EUR">Euro (EUR)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label htmlFor="status">Statusi</Label>
          <Select name="status" value={status} onValueChange={setStatus}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Draft">{getInvoiceStatusLabel('Draft')}</SelectItem>
              <SelectItem value="Pending">{getInvoiceStatusLabel('Pending')}</SelectItem>
              <SelectItem value="Paid">{getInvoiceStatusLabel('Paid')}</SelectItem>
              <SelectItem value="Overdue">{getInvoiceStatusLabel('Overdue')}</SelectItem>
            </SelectContent>
          </Select>
          {status === 'Paid' && (
            <div className="mt-2">
              <Label className="text-xs text-muted-foreground">Data e Pagesës</Label>
              <input
                type="date"
                value={paidAtDateForm}
                onChange={e => setPaidAtDateForm(e.target.value)}
                className="mt-1 w-full h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          )}
        </div>
      </div>

      {/* Bank Details — shown when payment method is Bank Transfer */}
      {paymentMethod === 'Bank' && (
        <div className="space-y-3 p-4 border border-dashed border-border rounded-lg bg-muted/30">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold flex items-center gap-2">
              <Building2 className="w-4 h-4" />
              Detajet Bankare
            </h4>
            {savedBankAccounts.length > 1 && (
              <Select onValueChange={(bankId) => {
                const bank = savedBankAccounts.find(b => b.id === bankId);
                if (bank) {
                  setBankName(bank.bankName);
                  setBankIBAN(bank.iban);
                  setBankSWIFT(bank.swift);
                  setBankAccountHolder(bank.accountHolder);
                  setBankCountry(bank.country);
                }
              }}>
                <SelectTrigger className="w-full sm:w-[200px]">
                  <SelectValue placeholder="Zgjidh bankën" />
                </SelectTrigger>
                <SelectContent>
                  {savedBankAccounts.map(b => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.bankName || b.iban.slice(0, 12)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="bankName">Emri i Bankës</Label>
              <Input id="bankName" placeholder="p.sh. Raiffeisen Bank" value={bankName} onChange={(e) => setBankName(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="bankAccountHolder">Mbajtësi i Llogarisë</Label>
              <Input id="bankAccountHolder" placeholder="p.sh. FivoCRM SHPK" value={bankAccountHolder} onChange={(e) => setBankAccountHolder(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="bankIBAN">IBAN</Label>
              <Input id="bankIBAN" placeholder="AL00 0000 0000 0000 0000 0000 0000" value={bankIBAN} onChange={(e) => setBankIBAN(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="bankSWIFT">SWIFT / BIC</Label>
              <Input id="bankSWIFT" placeholder="p.sh. SGSBALTX" value={bankSWIFT} onChange={(e) => setBankSWIFT(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="bankCountry">Shteti</Label>
              <Input id="bankCountry" placeholder="p.sh. Shqipëri" value={bankCountry} onChange={(e) => setBankCountry(e.target.value)} />
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label>Data e Faturës *</Label>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="w-full justify-start">
                <CalendarIcon className="mr-2 h-4 w-4" />
                {invoiceDate ? invoiceDate.toLocaleDateString() : "Zgjidh datën"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0">
              <Calendar mode="single" selected={invoiceDate} onSelect={(d) => { setInvoiceDate(d); onDirtyChange?.(true); }} />
            </PopoverContent>
          </Popover>
        </div>
        <div>
          <Label>Afati *</Label>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="w-full justify-start">
                <CalendarIcon className="mr-2 h-4 w-4" />
                {dueDate ? dueDate.toLocaleDateString() : "Zgjidh datën"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0">
              <Calendar mode="single" selected={dueDate} onSelect={(d) => { setDueDate(d); onDirtyChange?.(true); }} />
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {/* Recurring Invoice */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="flex items-center justify-between p-3 border rounded-lg">
          <div>
            <Label>Faturë Periodike</Label>
            <p className="text-xs text-muted-foreground">Gjenero automatikisht</p>
          </div>
          <input type="checkbox" checked={isRecurring} onChange={e => {
            setIsRecurring(e.target.checked);
            if (e.target.checked && !nextRecurringDate) setNextRecurringDate(dueDate || undefined);
            onDirtyChange?.(true);
          }} className="h-4 w-4 accent-primary" />
        </div>
        {isRecurring && (
          <div>
            <Label>Frekuenca *</Label>
            <Select value={recurringFrequency} onValueChange={v => { setRecurringFrequency(v); onDirtyChange?.(true); }}>
              <SelectTrigger><SelectValue placeholder="Zgjidh frekuencën" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="weekly">Javore</SelectItem>
                <SelectItem value="monthly">Mujore</SelectItem>
                <SelectItem value="quarterly">Tremujore</SelectItem>
                <SelectItem value="yearly">Vjetore</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
      {isRecurring && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-3 border rounded-lg bg-muted/30">
          <div>
            <Label className="text-xs text-muted-foreground mb-1 block">Data e gjenerimit tjetër</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="w-full justify-start text-sm">
                  <CalendarIcon className="mr-2 h-3.5 w-3.5" />
                  {nextRecurringDate ? nextRecurringDate.toLocaleDateString() : 'Zgjidh datën'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0">
                <Calendar mode="single" selected={nextRecurringDate} onSelect={d => { setNextRecurringDate(d); onDirtyChange?.(true); }} />
              </PopoverContent>
            </Popover>
            <p className="text-[10px] text-muted-foreground mt-1">Kroni do gjenerojë faturën e re në këtë datë</p>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground mb-1 block">Përsërit deri më (opsionale)</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="w-full justify-start text-sm">
                  <CalendarIcon className="mr-2 h-3.5 w-3.5" />
                  {recurringEndDate ? recurringEndDate.toLocaleDateString() : 'Pa fund (deri e ndërpret)'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0">
                <Calendar mode="single" selected={recurringEndDate} onSelect={d => { setRecurringEndDate(d); onDirtyChange?.(true); }} />
                {recurringEndDate && (
                  <div className="p-2 border-t">
                    <Button type="button" variant="ghost" size="sm" className="w-full text-xs" onClick={() => { setRecurringEndDate(undefined); onDirtyChange?.(true); }}>
                      Hiq datën e fundit
                    </Button>
                  </div>
                )}
              </PopoverContent>
            </Popover>
            <p className="text-[10px] text-muted-foreground mt-1">Pas kësaj date, gjenerimi ndalon vetë. Të kaluarat mbeten.</p>
          </div>
          <div className="flex items-center justify-between p-3 border rounded-lg bg-background">
            <div>
              <Label className="text-sm">{isRecurringPaused ? '⏸ Në pauzë' : '▶ Aktive'}</Label>
              <p className="text-xs text-muted-foreground">{isRecurringPaused ? 'Gjenerimi është ndalur përkohësisht' : 'Gjenerimi automatik aktiv'}</p>
            </div>
            <button
              type="button"
              onClick={() => { setIsRecurringPaused(p => !p); onDirtyChange?.(true); }}
              className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${isRecurringPaused ? 'bg-amber-100 text-amber-700 hover:bg-amber-200' : 'bg-green-100 text-green-700 hover:bg-green-200'}`}
            >
              {isRecurringPaused ? 'Rifillo' : 'Ndalo'}
            </button>
          </div>
        </div>
      )}

      <div>
        <Label>Zbritje</Label>
        <div className="flex gap-2">
          <div className="flex rounded-md border overflow-hidden text-sm">
            <button
              type="button"
              onClick={() => setDiscountType('fixed')}
              className={`px-3 py-2 transition-colors ${discountType === 'fixed' ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-muted'}`}
            >
              {currency === 'EUR' ? '€' : 'L'}
            </button>
            <button
              type="button"
              onClick={() => setDiscountType('percent')}
              className={`px-3 py-2 transition-colors ${discountType === 'percent' ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-muted'}`}
            >
              %
            </button>
          </div>
          <Input
            type="number"
            step="0.01"
            min="0"
            max={discountType === 'percent' ? 100 : undefined}
            placeholder="0"
            value={discount || ''}
            onChange={(e) => setDiscount(Math.max(0, parseFloat(e.target.value) || 0))}
          />
        </div>
      </div>

      <div>
        <Label htmlFor="tax">Taksa</Label>
        <Input
          id="tax"
          name="tax"
          type="number"
          step="0.01"
          min="0"
          value={tax}
          onChange={(e) => setTax(Math.max(0, parseFloat(e.target.value) || 0))}
        />
      </div>

      <div>
        <Label htmlFor="paymentUrl">URL e Pagesës Online</Label>
        <Input
          id="paymentUrl"
          name="paymentUrl"
          type="url"
          placeholder="https://payment.example.com/invoice/..."
          value={paymentUrl}
          onChange={(e) => setPaymentUrl(e.target.value)}
        />
      </div>

      <div>
        <Label htmlFor="notes">Shënime</Label>
        <Textarea id="notes" name="notes" rows={3} placeholder="Shënime shtesë..." value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      <div className="border-t pt-4">
        <div className="space-y-2 text-right">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Nëntotali:</span>
            <span className="font-medium">{calculateSubtotal().toFixed(2)} {currency === 'EUR' ? '€' : 'L'}</span>
          </div>
          {discount > 0 && (
            <div className="flex justify-between text-red-500">
              <span>Zbritje {discountType === 'percent' ? `(${discount}%)` : ''}:</span>
              <span>−{calculateDiscountAmount(calculateSubtotal()).toFixed(2)} {currency === 'EUR' ? '€' : 'L'}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-muted-foreground">Taksa:</span>
            <span className="font-medium">{tax.toFixed(2)} {currency === 'EUR' ? '€' : 'L'}</span>
          </div>
          <div className="flex justify-between text-lg font-bold">
            <span>Total:</span>
            <span>{(calculateSubtotal() - calculateDiscountAmount(calculateSubtotal()) + tax).toFixed(2)} {currency === 'EUR' ? '€' : 'L'}</span>
          </div>
        </div>
      </div>

      <Button type="submit" className="w-full">
        {isEditing ? 'Ruaj Ndryshimet' : 'Krijo Faturën'}
      </Button>
    </form>
  );
};

const InvoiceDetails: React.FC<{ invoice: Invoice }> = ({ invoice }) => {
  const { user } = useAuth();
  const { data: allCustomers } = useCollection<Customer>('customers', { skipTeamFilter: true });
  const customer = allCustomers?.find(c => c.id === invoice.customerId);
  const { data: invoiceItems } = useCollection<InvoiceItem>('invoiceItems', {
    where: [{ field: 'invoiceId', operator: '==', value: invoice.id }],
    skipTeamFilter: true,
  });
  const { data: allServices } = useCollection<Service>('services', { skipTeamFilter: true });

  const services = React.useMemo(() => {
    if (!allServices) return {};
    return allServices.reduce((acc, s) => ({ ...acc, [s.id]: s }), {} as Record<string, Service>);
  }, [allServices]);

  const cur = (invoice as any).currency === 'EUR' ? '€' : 'L';

  // Never offer payment on a draft or a zero/negative invoice (auto-created project
  // drafts can have no line items and a 0.00 total). Financial guard, not just UX.
  const payableTotal = invoice.total ?? invoice.amount ?? 0;
  const canPay = invoice.status !== 'Paid' && invoice.status !== 'Draft' && payableTotal > 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        <div>
          <h3 className="font-semibold mb-2">Informacioni i Klientit</h3>
          <div className="space-y-1 text-sm">
            <p className="font-medium">{customer?.name}</p>
            {customer?.company && <p className="text-muted-foreground">{customer.company}</p>}
            {customer?.email && <p>{customer.email}</p>}
            {customer?.phone && <p>{customer.phone}</p>}
            {customer?.address && <p className="text-muted-foreground">{customer.address}</p>}
          </div>
        </div>

        <div>
          <h3 className="font-semibold mb-2">Detajet e Faturës</h3>
          <div className="space-y-1 text-sm">
            <p><span className="text-muted-foreground">Fatura #:</span> {invoice.invoiceNumber || invoice.id.slice(0, 8)}</p>
            <div><span className="text-muted-foreground">Statusi:</span> <Badge className={getStatusColor(invoice.status)}>{getInvoiceStatusLabel(invoice.status)}</Badge></div>
            <p><span className="text-muted-foreground">Data e Faturës:</span> {invoice.invoiceDate ? new Date(invoice.invoiceDate).toLocaleDateString('sq-AL') : new Date(invoice.createdAt).toLocaleDateString('sq-AL')}</p>
            <p><span className="text-muted-foreground">Afati:</span> {invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString('sq-AL') : 'Pa afat'}</p>
            <p><span className="text-muted-foreground">Mënyra e Pagesës:</span> {invoice.paymentMethod}</p>
            <p><span className="text-muted-foreground">Monedha:</span> {(invoice as any).currency === 'EUR' ? 'Euro (EUR)' : 'Lekë (ALL)'}</p>
            {invoice.paidAt && <p><span className="text-muted-foreground">Paguar më:</span> {new Date(invoice.paidAt).toLocaleDateString('sq-AL')}</p>}
            {(invoice as any).isRecurring && (
              <>
                <div className="mt-2 pt-2 border-t border-dashed">
                  <p className="text-xs font-semibold text-green-700 mb-1">↻ Faturë Periodike</p>
                  <p><span className="text-muted-foreground">Frekuenca:</span> {{ weekly: 'Javore', monthly: 'Mujore', quarterly: 'Tremujore', yearly: 'Vjetore' }[(invoice as any).recurringFrequency] || (invoice as any).recurringFrequency}</p>
                  {(invoice as any).nextRecurringDate && <p><span className="text-muted-foreground">Gjenerimi tjetër:</span> {new Date((invoice as any).nextRecurringDate?.toDate ? (invoice as any).nextRecurringDate.toDate() : (invoice as any).nextRecurringDate).toLocaleDateString('sq-AL')}</p>}
                  <p><span className="text-muted-foreground">Statusi:</span> {(invoice as any).isRecurringPaused ? <span className="text-amber-600 font-medium">⏸ Ndërprerë</span> : <span className="text-green-600 font-medium">▶ Aktive</span>}</p>
                </div>
              </>
            )}
            {(invoice as any).autoGenerated && (invoice as any).parentInvoiceId && (
              <div className="mt-2 pt-2 border-t border-dashed">
                <p className="text-xs font-semibold text-blue-700 mb-1">Auto-gjeneruar</p>
                <p className="text-xs text-muted-foreground">Nga fatura periodike: <span className="font-mono text-blue-600">{(invoice as any).parentInvoiceId.slice(0, 8)}</span></p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bank Details — all accounts configured in Settings (falls back to the invoice's own bank) */}
      {(() => {
        let banks: { bankName?: string; accountHolder?: string; iban?: string; swift?: string; country?: string }[] = [];
        try { banks = JSON.parse(localStorage.getItem('bank_accounts') || '[]'); } catch { banks = []; }
        banks = banks.filter(b => b.iban);
        if (banks.length === 0 && (invoice as any).bankIBAN) {
          banks = [{
            bankName: (invoice as any).bankName, accountHolder: (invoice as any).bankAccountHolder,
            iban: (invoice as any).bankIBAN, swift: (invoice as any).bankSWIFT, country: (invoice as any).bankCountry,
          }];
        }
        if (banks.length === 0) return null;
        return (
          <div className="p-4 border border-dashed border-border rounded-lg bg-muted/30">
            <h3 className="font-semibold mb-2 flex items-center gap-2">
              <Building2 className="w-4 h-4" />
              Detajet Bankare për Pagesë
            </h3>
            <div className="space-y-3">
              {banks.map((b, i) => (
                <div key={i} className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm border-b border-border/50 last:border-0 pb-2 last:pb-0">
                  {b.bankName && <p><span className="text-muted-foreground">Banka:</span> {b.bankName}</p>}
                  {b.accountHolder && <p><span className="text-muted-foreground">Mbajtësi:</span> {b.accountHolder}</p>}
                  <p><span className="text-muted-foreground">IBAN:</span> <span className="font-mono break-all">{b.iban}</span></p>
                  {b.swift && <p><span className="text-muted-foreground">SWIFT:</span> <span className="font-mono">{b.swift}</span></p>}
                  {b.country && <p><span className="text-muted-foreground">Shteti:</span> {b.country}</p>}
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      <div>
        <h3 className="font-semibold mb-2">Artikujt</h3>
        {/* WHMCS invoices carry their line items inline (products/services billed) */}
        {invoice.lineItems && invoice.lineItems.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-muted">
                <tr>
                  <th className="px-4 py-2 text-left text-sm">Produkti / Shërbimi</th>
                  <th className="px-4 py-2 text-right text-sm">Shuma</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {invoice.lineItems.map((item, i) => (
                  <tr key={i}>
                    <td className="px-4 py-2 text-sm">{item.description}</td>
                    <td className="px-4 py-2 text-right font-medium whitespace-nowrap">{(item.amount ?? 0).toFixed(2)} {cur}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (invoiceItems && invoiceItems.length > 0) ? (<>
        {/* Mobile: stacked cards */}
        <div className="sm:hidden space-y-2">
          {invoiceItems?.map((item) => (
            <div key={item.id} className="p-3 bg-muted/50 rounded-lg">
              <p className="text-sm font-medium">{services[item.serviceId]?.title || 'Duke ngarkuar...'}</p>
              <div className="flex items-center justify-between mt-1.5 text-xs text-muted-foreground">
                <span>Sasia: {item.quantity} × {(item.unitPrice ?? 0).toFixed(2)} {cur}</span>
                <span className="font-semibold text-foreground text-sm">{(item.totalPrice ?? 0).toFixed(2)} {cur}</span>
              </div>
            </div>
          ))}
        </div>
        {/* Desktop: table */}
        <div className="hidden sm:block overflow-x-auto">
          <table className="w-full">
            <thead className="bg-muted">
              <tr>
                <th className="px-4 py-2 text-left text-sm">Shërbimi</th>
                <th className="px-4 py-2 text-right text-sm">Sasia</th>
                <th className="px-4 py-2 text-right text-sm">Çmimi</th>
                <th className="px-4 py-2 text-right text-sm">Totali</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {invoiceItems?.map((item) => (
                <tr key={item.id}>
                  <td className="px-4 py-2">{services[item.serviceId]?.title || 'Duke ngarkuar...'}</td>
                  <td className="px-4 py-2 text-right">{item.quantity}</td>
                  <td className="px-4 py-2 text-right">{(item.unitPrice ?? 0).toFixed(2)} {cur}</td>
                  <td className="px-4 py-2 text-right font-medium">{(item.totalPrice ?? 0).toFixed(2)} {cur}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>) : (
          <p className="text-sm text-muted-foreground text-center py-4 border rounded-lg border-dashed">
            Nuk ka artikuj në këtë faturë.
          </p>
        )}
      </div>

      <div className="border-t pt-4">
        <div className="space-y-2 text-right">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Nëntotali:</span>
            <span className="font-medium">{(invoice.subtotal || 0).toFixed(2)} {cur}</span>
          </div>
          {invoice.discount != null && invoice.discount > 0 && (
            <div className="flex justify-between text-red-500">
              <span>Zbritje {invoice.discountType === 'percent' ? `(${invoice.discount}%)` : ''}:</span>
              <span>−{(invoice.discountType === 'percent'
                ? (invoice.subtotal || 0) * (invoice.discount / 100)
                : invoice.discount).toFixed(2)} {cur}</span>
            </div>
          )}
          {invoice.tax != null && invoice.tax > 0 && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Taksa:</span>
              <span className="font-medium">{invoice.tax.toFixed(2)} {cur}</span>
            </div>
          )}
          <div className="flex justify-between text-lg font-bold">
            <span>Totali:</span>
            <span>{(invoice.total || 0).toFixed(2)} {cur}</span>
          </div>
        </div>
      </div>

      {invoice.notes && (
        <div>
          <h3 className="font-semibold mb-2">Shënime</h3>
          <p className="text-sm text-muted-foreground">{invoice.notes}</p>
        </div>
      )}

      <div className="space-y-3">
        {invoice.paymentUrl && (
          <Button
            className="w-full"
            variant="outline"
            onClick={() => openExternal(invoice.paymentUrl!)}
          >
            <ExternalLink className="w-4 h-4 mr-2" />
            Hap Linkun e Pagesës
          </Button>
        )}
        
        {invoice.status === 'Draft' && (
          <div className="w-full text-center text-sm text-muted-foreground p-3 bg-muted/40 border border-dashed rounded-lg">
            Faturë draft — shto të paktën një artikull dhe dërgoje para se të pranohet pagesë.
          </div>
        )}
        {canPay && (
          <Button
            className="w-full bg-[#635BFF] hover:bg-[#5851ea] text-white"
            onClick={async () => {
              const stripeKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;
              if (!stripeKey) {
                toast({ title: 'Stripe nuk është konfiguruar!', variant: 'destructive' });
                return;
              }
              const amount = invoice.total || invoice.amount || 0;
              if (amount <= 0) {
                toast({ title: 'Shuma e faturës është 0', variant: 'destructive' });
                return;
              }
              try {
                toast({ title: 'Duke hapur Stripe Checkout...' });
                // Stripe does not support ALL (Albanian Lek) — convert an ALL invoice
                // to EUR for checkout. Other currencies are passed through as-is.
                // No currency set = Lek (the house currency); defaulting to EUR here
                // charged the Lek face value as euros.
                const invCur = ((invoice as any).currency || 'ALL').toUpperCase();
                const stripeCurrency = invCur === 'ALL' ? 'eur' : invCur.toLowerCase();
                const stripeAmount = invCur === 'ALL' ? amount / getRateToAll('EUR') : amount;
                const authToken = await user?.getIdToken();
                const response = await fetch('/api/create-checkout-session', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {}),
                  },
                  body: JSON.stringify({
                    invoiceId: invoice.id,
                    invoiceNumber: invoice.invoiceNumber || invoice.id.slice(0, 8),
                    amount: stripeAmount,
                    currency: stripeCurrency,
                    customerEmail: customer?.email || undefined,
                    customerName: customer?.name || undefined,
                    successUrl: appReturnUrl(`/app/invoices?payment=success&invoice=${invoice.id}`),
                    cancelUrl: appReturnUrl(`/app/invoices?payment=cancelled&invoice=${invoice.id}`),
                  }),
                });
                if (!response.ok) throw new Error('Gabim gjatë krijimit të sesionit');
                const { url } = await response.json();
                if (url) {
                  try {
                    const parsed = new URL(url);
                    if (parsed.hostname.endsWith('.stripe.com') || parsed.hostname === 'stripe.com') {
                      await openCheckout(url);
                    } else {
                      throw new Error('URL e pagesës nuk është e vlefshme');
                    }
                  } catch {
                    throw new Error('URL e pagesës nuk është e vlefshme');
                  }
                }
              } catch (err: any) {
                toast({ title: 'Gabim me Stripe', description: err.message, variant: 'destructive' });
              }
            }}
          >
            <svg viewBox="0 0 60 25" className="w-10 h-4 mr-2" fill="currentColor">
              <path d="M59.64 14.28h-8.06c.19 1.93 1.6 2.55 3.2 2.55 1.64 0 2.96-.37 4.05-.95v3.32a8.33 8.33 0 0 1-4.56 1.1c-4.01 0-6.83-2.5-6.83-7.48 0-4.19 2.39-7.52 6.3-7.52 3.92 0 5.96 3.28 5.96 7.5 0 .4-.02 1.04-.06 1.48zm-3.67-3.14c0-1.25-.5-2.7-2.1-2.7-1.52 0-2.22 1.38-2.32 2.7h4.42z"/>
            </svg>
            Paguaj me Stripe
          </Button>
        )}

        {invoice.status === 'Paid' && (
          <div className="flex items-center justify-center gap-2 p-3 bg-success/10 border border-success/20 rounded-lg text-success">
            <Check className="w-5 h-5" />
            <span className="font-medium">Fatura është e paguar</span>
          </div>
        )}

        <Button
          variant="outline"
          className="w-full"
          onClick={async () => {
            const { default: jsPDF } = await import('jspdf');
            const doc = new jsPDF({ unit: 'mm', format: 'a4' });
            const w = doc.internal.pageSize.getWidth();
            const h = doc.internal.pageSize.getHeight();
            const margin = 20;
            const isEUR = (invoice as any).currency === 'EUR';
            const cur = isEUR ? '€' : 'L';
            const fmt = (n: number) => `${n.toFixed(2)} ${cur}`;

            // ── Accent bar ──────────────────────────────────────────────────
            doc.setFillColor(13, 148, 136); // teal-600
            doc.rect(0, 0, w, 5, 'F');

            // ── Header ──────────────────────────────────────────────────────
            let y = 18;
            doc.setFontSize(26);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(13, 148, 136);
            doc.text('FATURË', margin, y);

            // Issuer name below title
            const pdfBankHolder = (invoice as any).bankAccountHolder || localStorage.getItem('default_bank_holder') || '';
            if (pdfBankHolder) {
              doc.setFontSize(10);
              doc.setFont('helvetica', 'normal');
              doc.setTextColor(80, 80, 80);
              doc.text(pdfBankHolder, margin, y + 7);
            }

            // Invoice meta (top right)
            doc.setTextColor(50, 50, 50);
            doc.setFontSize(10);
            doc.setFont('helvetica', 'bold');
            doc.text(`# ${invoice.invoiceNumber || invoice.id.slice(0, 8)}`, w - margin, y - 2, { align: 'right' });
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(9);
            doc.setTextColor(100, 100, 100);
            y += 14;
            doc.text(`Data:   ${invoice.invoiceDate ? new Date(invoice.invoiceDate).toLocaleDateString('sq-AL') : new Date(invoice.createdAt).toLocaleDateString('sq-AL')}`, w - margin, y - 11, { align: 'right' });
            doc.text(`Afati:  ${invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString('sq-AL') : 'Pa afat'}`, w - margin, y - 6, { align: 'right' });

            // Status badge
            const statusColors: Record<string, [number, number, number]> = {
              Paid: [22, 163, 74], Pending: [234, 179, 8], Overdue: [220, 38, 38],
              Draft: [107, 114, 128], Partial: [59, 130, 246],
            };
            const [sr, sg, sb] = statusColors[invoice.status] || [100, 100, 100];
            doc.setFillColor(sr, sg, sb);
            doc.roundedRect(w - margin - 28, y - 3, 28, 6, 1, 1, 'F');
            doc.setTextColor(255, 255, 255);
            doc.setFontSize(8);
            doc.setFont('helvetica', 'bold');
            doc.text(invoice.status, w - margin - 14, y + 1, { align: 'center' });
            doc.setTextColor(50, 50, 50);

            // ── Divider ─────────────────────────────────────────────────────
            y += 8;
            doc.setDrawColor(13, 148, 136);
            doc.setLineWidth(0.4);
            doc.line(margin, y, w - margin, y);
            doc.setLineWidth(0.2);
            y += 10;

            // ── Client + Bank (two columns) ──────────────────────────────────
            const colMid = w / 2 + 5;

            doc.setFontSize(8);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(13, 148, 136);
            doc.text('KLIENTI', margin, y);
            y += 5;
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(50, 50, 50);
            doc.setFontSize(9);
            if (customer?.name) { doc.setFont('helvetica', 'bold'); doc.text(customer.name, margin, y); doc.setFont('helvetica', 'normal'); y += 5; }
            if (customer?.company) { doc.text(customer.company, margin, y); y += 5; }
            if (customer?.email) { doc.text(customer.email, margin, y); y += 5; }
            if (customer?.phone) { doc.text(customer.phone, margin, y); y += 5; }
            if (customer?.address) { doc.text(customer.address, margin, y); y += 5; }

            // Bank info — right column: show ALL bank accounts configured in Settings.
            let pdfBanks: { bankName?: string; accountHolder?: string; iban?: string; swift?: string }[] = [];
            try { pdfBanks = JSON.parse(localStorage.getItem('bank_accounts') || '[]'); } catch { pdfBanks = []; }
            // Legacy fallback: a single default bank (or the invoice's own bank fields).
            if (pdfBanks.length === 0) {
              const legacyIban = (invoice as any).bankIBAN || localStorage.getItem('default_bank_iban') || '';
              if (legacyIban) pdfBanks = [{
                bankName: (invoice as any).bankName || localStorage.getItem('default_bank_name') || '',
                accountHolder: pdfBankHolder,
                iban: legacyIban,
                swift: (invoice as any).bankSWIFT || localStorage.getItem('default_bank_swift') || '',
              }];
            }
            let by = y - (5 * ([customer?.name, customer?.company, customer?.email, customer?.phone, customer?.address].filter(Boolean).length));
            const validBanks = pdfBanks.filter(b => b.iban);
            if (validBanks.length > 0) {
              doc.setFontSize(8);
              doc.setFont('helvetica', 'bold');
              doc.setTextColor(13, 148, 136);
              doc.text('DETAJET BANKARE', colMid, by); by += 5;
              doc.setTextColor(50, 50, 50);
              validBanks.forEach((b, idx) => {
                if (idx > 0) by += 2; // gap between accounts
                doc.setFontSize(9);
                doc.setFont('helvetica', 'normal');
                if (b.bankName) { doc.setFont('helvetica', 'bold'); doc.text(String(b.bankName), colMid, by); doc.setFont('helvetica', 'normal'); by += 4.5; }
                if (b.accountHolder) { doc.text(`Mbajtësi: ${b.accountHolder}`, colMid, by); by += 4.5; }
                doc.setFont('helvetica', 'bold');
                doc.text(`IBAN: ${b.iban}`, colMid, by); by += 4.5;
                doc.setFont('helvetica', 'normal');
                if (b.swift) { doc.text(`SWIFT: ${b.swift}`, colMid, by); by += 4.5; }
              });
            }

            // Start the items table below whichever column (customer / banks) is taller.
            y = Math.max(y + 5, by + 2, 90);

            // ── Items table ──────────────────────────────────────────────────
            // Table header
            doc.setFillColor(13, 148, 136);
            doc.rect(margin, y, w - margin * 2, 8, 'F');
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(9);
            doc.setTextColor(255, 255, 255);
            doc.text('Shërbimi', margin + 3, y + 5.5);
            doc.text('Sasia', w - margin - 58, y + 5.5, { align: 'right' });
            doc.text('Çmimi', w - margin - 28, y + 5.5, { align: 'right' });
            doc.text('Totali', w - margin - 2, y + 5.5, { align: 'right' });
            y += 10;

            // Rows
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(9);
            let rowAlt = false;
            for (const item of invoiceItems || []) {
              const svc = services[item.serviceId];
              if (rowAlt) { doc.setFillColor(245, 253, 251); doc.rect(margin, y - 1, w - margin * 2, 9, 'F'); }
              doc.setTextColor(30, 30, 30);
              doc.text(svc?.title || svc?.name || 'Shërbim', margin + 3, y + 5);
              doc.text(String(item.quantity), w - margin - 58, y + 5, { align: 'right' });
              doc.text(fmt(item.unitPrice ?? 0), w - margin - 28, y + 5, { align: 'right' });
              doc.setFont('helvetica', 'bold');
              doc.text(fmt(item.totalPrice ?? 0), w - margin - 2, y + 5, { align: 'right' });
              doc.setFont('helvetica', 'normal');
              doc.setDrawColor(220, 220, 220);
              doc.line(margin, y + 8, w - margin, y + 8);
              y += 9;
              rowAlt = !rowAlt;
            }

            // ── Totals box ───────────────────────────────────────────────────
            y += 6;
            const totBoxX = w - margin - 80;
            const totBoxW = 80;

            const subtotal = invoice.subtotal || invoice.total || 0;
            const discAmt = invoice.discount != null && invoice.discount > 0
              ? (invoice.discountType === 'percent' ? subtotal * (invoice.discount / 100) : invoice.discount)
              : 0;
            const taxAmt = invoice.tax || 0;
            const totalVal = invoice.total || 0;

            // Calculate box height
            let boxLines = 1; // subtotal
            if (discAmt > 0) boxLines++;
            if (taxAmt > 0) boxLines++;
            boxLines++; // total
            const boxH = boxLines * 8 + 8;

            doc.setFillColor(240, 253, 250);
            doc.setDrawColor(13, 148, 136);
            doc.setLineWidth(0.3);
            doc.roundedRect(totBoxX, y, totBoxW, boxH, 2, 2, 'FD');
            doc.setLineWidth(0.2);

            let ty = y + 7;
            doc.setFontSize(9);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(80, 80, 80);
            doc.text('Nëntotali:', totBoxX + 4, ty);
            doc.setTextColor(30, 30, 30);
            doc.text(fmt(subtotal), totBoxX + totBoxW - 4, ty, { align: 'right' });
            ty += 8;

            if (discAmt > 0) {
              doc.setTextColor(220, 38, 38);
              const discLabel = invoice.discountType === 'percent' ? `Zbritje (${invoice.discount}%):` : 'Zbritje:';
              doc.text(discLabel, totBoxX + 4, ty);
              doc.text(`-${fmt(discAmt)}`, totBoxX + totBoxW - 4, ty, { align: 'right' });
              doc.setTextColor(80, 80, 80);
              ty += 8;
            }

            if (taxAmt > 0) {
              doc.setTextColor(80, 80, 80);
              doc.text('Taksa (TVSh):', totBoxX + 4, ty);
              doc.setTextColor(30, 30, 30);
              doc.text(fmt(taxAmt), totBoxX + totBoxW - 4, ty, { align: 'right' });
              ty += 8;
            }

            // Total line
            doc.setDrawColor(13, 148, 136);
            doc.line(totBoxX + 4, ty - 2, totBoxX + totBoxW - 4, ty - 2);
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(11);
            doc.setTextColor(13, 148, 136);
            doc.text('TOTALI:', totBoxX + 4, ty + 4);
            doc.text(fmt(totalVal), totBoxX + totBoxW - 4, ty + 4, { align: 'right' });

            // ── Notes ────────────────────────────────────────────────────────
            if (invoice.notes) {
              y = ty + 16;
              doc.setFontSize(8);
              doc.setFont('helvetica', 'bold');
              doc.setTextColor(100, 100, 100);
              doc.text('SHËNIME', margin, y);
              y += 4;
              doc.setFont('helvetica', 'normal');
              doc.setTextColor(60, 60, 60);
              const noteLines = doc.splitTextToSize(invoice.notes, w - margin * 2);
              doc.text(noteLines, margin, y);
            }

            // ── Footer ───────────────────────────────────────────────────────
            const footerY = h - 18;
            doc.setDrawColor(13, 148, 136);
            doc.setLineWidth(0.3);
            doc.line(margin, footerY - 4, w - margin, footerY - 4);
            doc.setLineWidth(0.2);
            doc.setFontSize(8);
            doc.setFont('helvetica', 'italic');
            doc.setTextColor(100, 100, 100);
            doc.text('Faleminderit për besimin tuaj!', w / 2, footerY, { align: 'center' });
            if (invoice.paymentMethod) {
              const payLabel = invoice.paymentMethod === 'Bank' ? 'Transfer Bankar' : invoice.paymentMethod === 'Cash' ? 'Kesh' : invoice.paymentMethod;
              doc.setFont('helvetica', 'normal');
              doc.text(`Mënyra e pagesës: ${payLabel}`, margin, footerY);
            }
            doc.setFont('helvetica', 'normal');
            doc.text(`Faqe 1 / 1`, w - margin, footerY, { align: 'right' });

            // Bottom accent bar
            doc.setFillColor(13, 148, 136);
            doc.rect(0, h - 4, w, 4, 'F');

            const fileName = `Fatura-${invoice.invoiceNumber || invoice.id.slice(0, 8)}.pdf`;
            await saveOrShareFile(doc.output('blob'), fileName, { shareTitle: fileName });
            toast({ title: 'PDF u ruajt' });
          }}
        >
          <Download className="w-4 h-4 mr-2" />
          Shkarko PDF
        </Button>
      </div>
    </div>
  );
};

export default InvoicesView;
