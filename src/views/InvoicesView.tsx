import React, { useState, useEffect, useMemo } from 'react';
import { useCollection, useMutation, useGlobalTeamId } from '../hooks/useFirestore';
import { useTeamSettingsData } from '../hooks/useTeamSettings';
import { getNextInvoiceNumber } from '../lib/firebase';
import { useUnsavedChanges } from '../hooks/useUnsavedChanges';
import { usePermissions } from '../contexts/PermissionsContext';
import { useActivityLogger } from '../hooks/useActivityLogger';
import { useAuth } from '../contexts/AuthContext';
import { DollarSign, Plus, Calendar as CalendarIcon, CreditCard, Mail, Send, Building2, ShoppingCart, Trash2, Eye, Edit2, Check, X, ExternalLink, Loader2, MoreVertical, Download, ChevronsUpDown, RefreshCw } from 'lucide-react';
import ExportButton from '../components/ExportButton';
import { loadStripe } from '@stripe/stripe-js';
import { Card } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Calendar } from '../components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '../components/ui/command';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '../components/ui/alert-dialog';
import { Textarea } from '../components/ui/textarea';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import type { Invoice, Customer, Service, InvoiceItem, Project, ClientPortalAccess } from '../types';
import { useFilteredByOwner } from '../hooks/useRoleFilteredData';
import { toAll, getEurToAllRate } from '../lib/utils';
import { toast } from '../hooks/use-toast';
import { getStatusColor } from '../lib/statusColors';

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
  const [statusFilter, setStatusFilter] = useState<string>('__all__');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'date_desc' | 'date_asc' | 'amount_desc' | 'amount_asc'>('date_desc');
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [partialPaymentInvoice, setPartialPaymentInvoice] = useState<Invoice | null>(null);
  const [partialAmount, setPartialAmount] = useState('');
  const [partialMethod, setPartialMethod] = useState('Cash');
  const [partialNote, setPartialNote] = useState('');
  const [partialSaving, setPartialSaving] = useState(false);
  const [paidAtDate, setPaidAtDate] = useState('');
  const [triggeringRecurring, setTriggeringRecurring] = useState(false);

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
  const { data: allInvoiceItems } = useCollection<InvoiceItem>('invoiceItems', { skipTeamFilter: true });
  const invoiceMutation = useMutation<Invoice>('invoices');
  const invoiceItemMutationTop = useMutation<InvoiceItem>('invoiceItems');
  const notificationMutation = useMutation<any>('notifications');
  const { data: teamMembers } = useCollection<any>('teamMembers', {
    where: [{ field: 'status', operator: '==', value: 'Active' }],
  });

  const handleDeleteInvoice = async (id: string) => {
    try {
      await invoiceMutation.remove(id);
      const relatedItems = allInvoiceItems?.filter(item => (item as any).invoiceId === id) || [];
      await Promise.all(relatedItems.map(item => invoiceItemMutationTop.remove(item.id)));
      toast({ title: 'Fatura u fshi me sukses!' });
      setInvoiceToDelete(null);
    } catch {
      toast({ title: 'Gabim gjatë fshirjes së faturës', variant: 'destructive' });
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
      const token = await user.getIdToken();
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
          amount,
          currency: ((invoice as any).currency || 'EUR').toLowerCase(),
          customerEmail: customer?.email || undefined,
          customerName: customer?.name || undefined,
          successUrl: `${window.location.origin}/app/invoices?payment=success&invoice=${invoice.id}`,
          cancelUrl: `${window.location.origin}/app/invoices?payment=cancelled&invoice=${invoice.id}`,
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
            window.location.href = url;
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
      const recipients = teamMembers?.filter((m: any) => m.userId !== user?.uid && (m.role === 'Admin' || m.canAccessInvoices)) || [];
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
      if (isFullyPaid) {
        const recipients = teamMembers?.filter((m: any) => m.userId !== user?.uid && (m.role === 'Admin' || m.canAccessInvoices)) || [];
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

  const totalRevenue = invoices?.reduce((sum, inv) => {
    if (inv.status === 'Paid') return sum + toAll(inv.total ?? inv.amount ?? 0, (inv as any).currency);
    if (inv.status === 'Partial') return sum + toAll(inv.paidAmount ?? 0, (inv as any).currency);
    return sum;
  }, 0) || 0;

  // ── Revenue by Month ──
  const MONTH_LABELS = ['Jan', 'Shk', 'Mar', 'Pri', 'Maj', 'Qer', 'Kor', 'Gus', 'Sht', 'Tet', 'Nën', 'Dhj'];
  const revenueByMonth = useMemo(() => {
    if (!invoices) return MONTH_LABELS.map(label => ({ label, paid: 0, pending: 0, count: 0 }));
    return MONTH_LABELS.map((label, i) => {
      const paidInvs = invoices.filter(inv => {
        if (inv.status !== 'Paid') return false;
        const pd = inv.paidAt
          ? (inv.paidAt instanceof Date ? inv.paidAt : new Date(inv.paidAt as any))
          : (inv.updatedAt instanceof Date ? inv.updatedAt : new Date((inv.updatedAt ?? inv.createdAt) as any));
        return pd.getMonth() === i && pd.getFullYear() === selectedYear;
      });
      const pendingInvs = invoices.filter(inv => {
        if (inv.status !== 'Pending' && inv.status !== 'Overdue') return false;
        const cd = inv.createdAt instanceof Date ? inv.createdAt : new Date(inv.createdAt as any);
        return cd.getMonth() === i && cd.getFullYear() === selectedYear;
      });
      // Add partial payments that occurred in this month
      const partialForMonth = invoices
        .filter(inv => inv.status === 'Partial' && inv.partialPayments?.length)
        .reduce((s, inv) => {
          const monthPartials = (inv.partialPayments ?? []).filter(p => {
            const pd = p.paidAt instanceof Date ? p.paidAt : new Date(p.paidAt as any);
            return pd.getMonth() === i && pd.getFullYear() === selectedYear;
          });
          return s + monthPartials.reduce((ms, p) => ms + toAll(p.amount, (inv as any).currency), 0);
        }, 0);
      return {
        label,
        paid: paidInvs.reduce((s, inv) => s + toAll(inv.total ?? inv.amount ?? 0, (inv as any).currency), 0) + partialForMonth,
        pending: pendingInvs.reduce((s, inv) => s + toAll(inv.total ?? inv.amount ?? 0, (inv as any).currency), 0),
        count: paidInvs.length,
      };
    });
  }, [invoices, selectedYear]);
  const maxMonthRevenue = useMemo(() => Math.max(...revenueByMonth.map(m => m.paid), 1), [revenueByMonth]);
  const yearTotalRevenue = useMemo(() => revenueByMonth.reduce((s, m) => s + m.paid, 0), [revenueByMonth]);
  const currentMonth = new Date().getMonth();
  const currentYear = new Date().getFullYear();
  const availableYears = [currentYear, currentYear - 1, currentYear - 2, currentYear - 3];
  const paidInvoices = invoices?.filter(inv => inv.status === 'Paid' || inv.status === 'Partial').length || 0;
  const pendingAmount = invoices?.filter(inv => inv.status === 'Pending').reduce((sum, inv) => sum + toAll(inv.total ?? inv.amount ?? 0, (inv as any).currency), 0) || 0;
  const draftAmount = invoices?.filter(inv => inv.status === 'Draft').reduce((sum, inv) => sum + toAll(inv.total ?? inv.amount ?? 0, (inv as any).currency), 0) || 0;
  const partialRemainingAmount = invoices?.filter(inv => inv.status === 'Partial').reduce((sum, inv) => sum + Math.max(0, toAll(inv.total ?? inv.amount ?? 0, (inv as any).currency) - toAll(inv.paidAmount ?? 0, (inv as any).currency)), 0) || 0;
  const projectedRevenue = pendingAmount + draftAmount + partialRemainingAmount;

  // Filtered + sorted list used by both mobile cards and desktop table
  const filteredInvoices = React.useMemo(() => {
    let list = invoices ? [...invoices] : [];
    if (statusFilter !== '__all__') list = list.filter(inv => inv.status === statusFilter);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(inv => {
        const customer = customers?.find(c => c.id === inv.customerId);
        return (
          inv.invoiceNumber?.toLowerCase().includes(q) ||
          customer?.name?.toLowerCase().includes(q) ||
          customer?.company?.toLowerCase().includes(q)
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
  }, [invoices, statusFilter, searchQuery, sortBy, customers]);

  if (invoicesLoading) {
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
              onClick={handleTriggerRecurringInvoices}
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
            <p className="text-[10px] sm:text-body-sm text-muted-foreground">Të Ardhura</p>
            <div className="p-1 sm:p-2 bg-success/10 rounded-lg">
              <DollarSign className="w-3.5 h-3.5 sm:w-5 sm:h-5 text-success" />
            </div>
          </div>
          <p className="text-sm sm:text-h2 text-foreground font-medium animate-count-up">
            {totalRevenue.toLocaleString()} L
          </p>
          <p className="text-[10px] sm:text-xs text-success hidden sm:block">+12% nga muaji i kaluar</p>
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
            Pritje: {pendingAmount.toLocaleString()} · Draft: {draftAmount.toLocaleString()} L
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
            </p>
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
        <div className="grid grid-cols-6 sm:grid-cols-12 gap-1.5 sm:gap-2">
          {revenueByMonth.map((m, i) => {
            const barHeight = maxMonthRevenue > 0 ? Math.max((m.paid / maxMonthRevenue) * 100, m.paid > 0 ? 4 : 0) : 0;
            const isCurrentMonth = i === currentMonth && selectedYear === currentYear;
            const hasPending = m.pending > 0;
            return (
              <div key={m.label} className="flex flex-col items-center gap-1 group relative">
                <div className="w-full flex flex-col items-center justify-end" style={{ height: 64 }}>
                  {m.paid > 0 && (
                    <div
                      className={`w-full rounded-t-sm transition-all duration-500 ${isCurrentMonth ? 'bg-green-500' : 'bg-green-400/70'}`}
                      style={{ height: `${barHeight}%`, minHeight: m.paid > 0 ? 4 : 0 }}
                    />
                  )}
                  {hasPending && m.paid === 0 && (
                    <div className="w-full rounded-t-sm bg-amber-300/60" style={{ height: '8%', minHeight: 3 }} />
                  )}
                  {m.paid === 0 && !hasPending && (
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
          placeholder="Kërko faturë ose klient..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm flex-1 min-w-0 focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <div className="flex gap-2 flex-wrap">
          {(['__all__', 'Draft', 'Pending', 'Partial', 'Paid', 'Overdue'] as const).map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`h-8 px-3 text-xs rounded-full border font-medium transition-colors ${
                statusFilter === s
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-background border-input text-muted-foreground hover:bg-muted'
              }`}
            >
              {s === '__all__' ? 'Të gjitha' : s === 'Draft' ? 'Draft' : s === 'Pending' ? 'Pritje' : s === 'Partial' ? 'Pjesore' : s === 'Paid' ? 'Paguar' : 'Vonuar'}
              {s !== '__all__' && invoices && (
                <span className="ml-1 opacity-60">({invoices.filter(i => i.status === s).length})</span>
              )}
            </button>
          ))}
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
      {filteredInvoices.length === 0 && !invoicesLoading && (
        <p className="text-sm text-muted-foreground text-center py-6">Nuk u gjetën fatura.</p>
      )}

      {/* Mobile Card Layout */}
      <div className="sm:hidden space-y-3">
        {filteredInvoices.map((invoice) => {
          const customer = customers?.find(c => c.id === invoice.customerId);
          return (
            <Card key={invoice.id} className="p-3" onClick={() => setSelectedInvoice(invoice)}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="text-sm font-mono font-medium">{invoice.invoiceNumber || invoice.id.slice(0, 8)}</span>
                    <Badge className={`${getStatusColor(invoice.status)} text-[10px] px-1.5 py-0`}>{invoice.status}</Badge>
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
                    {invoice.status !== 'Paid' && (
                      <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleStripePayment(invoice); }}>
                        <CreditCard className="w-4 h-4 mr-2" /> Paguaj me Stripe
                      </DropdownMenuItem>
                    )}
                    {permissions.canEdit && invoice.status !== 'Paid' && (
                      <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setPartialPaymentInvoice(invoice); setPartialAmount(''); setPartialNote(''); setPartialMethod('Cash'); }}>
                        <DollarSign className="w-4 h-4 mr-2" /> Pagesë Pjesore
                      </DropdownMenuItem>
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
      </div>

      {/* Desktop Table Layout */}
      <Card className="overflow-hidden hidden sm:block">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-muted">
              <tr>
                <th className="px-4 py-3 text-left text-body-sm font-medium">Fatura #</th>
                <th className="px-4 py-3 text-left text-body-sm font-medium hidden md:table-cell">Klienti</th>
                <th className="px-4 py-3 text-left text-body-sm font-medium">Totali</th>
                <th className="px-4 py-3 text-left text-body-sm font-medium">Statusi</th>
                <th className="px-4 py-3 text-left text-body-sm font-medium hidden lg:table-cell">Data</th>
                <th className="px-4 py-3 text-left text-body-sm font-medium hidden lg:table-cell">Afati</th>
                <th className="px-4 py-3 text-left text-body-sm font-medium hidden md:table-cell">Pagesa</th>
                <th className="px-4 py-3 text-left text-body-sm font-medium">Veprime</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredInvoices.map((invoice) => {
                const customer = customers?.find(c => c.id === invoice.customerId);
                return (
                  <tr key={invoice.id} className="hover:bg-muted/50">
                    <td className="px-4 py-3 text-body-sm font-mono">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span>{invoice.invoiceNumber || invoice.id.slice(0, 8)}</span>
                        {(invoice as any).autoGenerated && (
                          <Badge variant="outline" className="text-[10px] px-1 py-0 border-blue-300 text-blue-600">Auto</Badge>
                        )}
                        {(invoice as any).isRecurring && !(invoice as any).autoGenerated && (
                          <Badge variant="outline" className={`text-[10px] px-1 py-0 ${(invoice as any).isRecurringPaused ? 'border-amber-300 text-amber-600' : 'border-green-300 text-green-600'}`}>
                            {(invoice as any).isRecurringPaused ? '⏸' : '↻'}
                          </Badge>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <div className="flex items-center gap-2">
                        <Building2 className="w-4 h-4 text-muted-foreground" />
                        <span className="truncate max-w-[150px]">{customer?.name || 'Unknown'}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-body font-medium">
                      {editingInvoiceId === invoice.id && editingField === 'total' ? (
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            className="w-24 px-2 py-1 border rounded"
                            autoFocus
                          />
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() => saveEdit(invoice.id, 'total')}
                          >
                            <Check className="w-4 h-4 text-success" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={cancelEditing}
                          >
                            <X className="w-4 h-4 text-error" />
                          </Button>
                        </div>
                      ) : (
                        <div 
                          className={`flex items-center gap-2 px-2 py-1 rounded ${permissions.canEdit ? 'cursor-pointer hover:bg-muted/50' : ''}`}
                          onClick={() => startEditing(invoice.id, 'total', invoice.total ?? invoice.amount ?? 0)}
                        >
                          <div>
                            <div>{((invoice.total ?? invoice.amount ?? 0)).toLocaleString()} {(invoice as any).currency === 'EUR' ? '€' : 'L'}</div>
                            {invoice.status === 'Partial' && invoice.paidAmount != null && (
                              <div className="text-[10px] text-cyan-600 font-medium">
                                {invoice.paidAmount.toLocaleString()} / {(invoice.total ?? invoice.amount ?? 0).toLocaleString()} {(invoice as any).currency === 'EUR' ? '€' : 'L'}
                              </div>
                            )}
                          </div>
                          <Edit2 className="w-3 h-3 opacity-0 group-hover:opacity-100" />
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {editingInvoiceId === invoice.id && editingField === 'status' ? (
                        <div className="flex flex-col gap-1.5">
                          <div className="flex items-center gap-2">
                            <select
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              className="px-2 py-1 border rounded"
                              autoFocus
                            >
                              <option value="Draft">Draft</option>
                              <option value="Pending">Pending</option>
                              <option value="Partial">Partial</option>
                              <option value="Paid">Paid</option>
                              <option value="Overdue">Overdue</option>
                            </select>
                            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => saveEdit(invoice.id, 'status')}>
                              <Check className="w-4 h-4 text-success" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={cancelEditing}>
                              <X className="w-4 h-4 text-error" />
                            </Button>
                          </div>
                          {editValue === 'Paid' && (
                            <div className="flex items-center gap-1.5">
                              <CalendarIcon className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                              <input
                                type="date"
                                value={paidAtDate}
                                onChange={e => setPaidAtDate(e.target.value)}
                                className="h-7 px-2 border rounded text-xs bg-background"
                              />
                            </div>
                          )}
                        </div>
                      ) : (
                        <div 
                          className={`px-2 py-1 rounded inline-block ${permissions.canEdit ? 'cursor-pointer hover:bg-muted/50' : ''}`}
                          onClick={() => startEditing(invoice.id, 'status', invoice.status)}
                        >
                          <Badge className={getStatusColor(invoice.status)}>{invoice.status}</Badge>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell">{invoice.invoiceDate ? new Date(invoice.invoiceDate).toLocaleDateString() : new Date(invoice.createdAt).toLocaleDateString()}</td>
                    <td className="px-4 py-3 hidden lg:table-cell">{invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString() : 'Pa afat'}</td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <Badge variant="outline" className="text-xs">
                        {invoice.paymentMethod === 'Bank' ? 'Transfer' : invoice.paymentMethod === 'Cash' ? 'Kesh' : invoice.paymentMethod || 'Stripe'}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1.5 flex-wrap">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setSelectedInvoice(invoice)}
                          title="Shiko"
                        >
                          <Eye className="w-4 h-4" />
                        </Button>
                        {permissions.canEdit && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setEditInvoice(invoice)}
                            title="Ndrysho"
                          >
                            <Edit2 className="w-4 h-4" />
                          </Button>
                        )}
                        {permissions.canEdit && !invoice.emailSent && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleSendEmail(invoice.id)}
                          >
                            <Mail className="w-4 h-4" />
                          </Button>
                        )}
                        {permissions.canEdit && invoice.status === 'Pending' && !invoice.reminderSent && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleSendReminder(invoice.id)}
                          >
                            <Send className="w-4 h-4" />
                          </Button>
                        )}
                        {invoice.status !== 'Paid' && (
                          <Button
                            size="sm"
                            className="bg-[#635BFF] hover:bg-[#5851ea] text-white"
                            onClick={() => handleStripePayment(invoice)}
                          >
                            <CreditCard className="w-4 h-4 mr-1" />
                            Paguaj
                          </Button>
                        )}
                        {permissions.canEdit && invoice.status !== 'Paid' && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-cyan-600 border-cyan-300 hover:bg-cyan-50 dark:hover:bg-cyan-950"
                            title="Regjistro Pagesë Pjesore"
                            onClick={() => { setPartialPaymentInvoice(invoice); setPartialAmount(''); setPartialNote(''); setPartialMethod('Cash'); }}
                          >
                            <DollarSign className="w-4 h-4 mr-1" />
                            Pjesore
                          </Button>
                        )}
                        {permissions.canEdit && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            onClick={() => setInvoiceToDelete(invoice.id)}
                            title="Fshi"
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

      {/* Delete Invoice Confirmation */}
      <Dialog open={!!invoiceToDelete} onOpenChange={(open) => { if (!open) setInvoiceToDelete(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Fshi Fatur\u00ebn</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Je i sigurt q\u00eb d\u00ebshiron t\u00eb fshish k\u00ebt\u00eb fatur\u00eb? Ky veprim nuk mund t\u00eb zhb\u00ebhet.</p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setInvoiceToDelete(null)}>Anulo</Button>
            <Button variant="destructive" onClick={() => invoiceToDelete && handleDeleteInvoice(invoiceToDelete)}>Fshi</Button>
          </div>
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
  const [lineItems, setLineItems] = useState<Array<{ serviceId: string; quantity: number }>>([]);
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

  // Auto-generate invoice number for new invoices using a Firebase atomic counter.
  // The counter doc (counters/invoices_{teamId}) is incremented transactionally to avoid duplicates.
  // On first use the current max FAT-XXX number from existing invoices is passed as the seed.
  const numberGenerated = React.useRef(false);
  React.useEffect(() => {
    if (!isEditing && !invoicesLoading && allInvoices && !numberGenerated.current && teamId) {
      numberGenerated.current = true;
      let maxNum = 0;
      const teamInvoices = allInvoices.filter(inv => (inv as any).teamId === teamId);
      for (const inv of teamInvoices) {
        const match = inv.invoiceNumber?.match(/^FAT-(\d+)$/i);
        if (match) {
          const n = parseInt(match[1], 10);
          if (n > maxNum) maxNum = n;
        }
      }
      getNextInvoiceNumber(teamId, maxNum)
        .then(setInvoiceNumber)
        .catch(() => {
          // Fallback to client-side if transaction fails
          setInvoiceNumber(`FAT-${String(maxNum + 1).padStart(3, '0')}`);
        });
    }
  }, [allInvoices, invoicesLoading, teamId]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const updateLineItem = (index: number, field: 'serviceId' | 'quantity', value: string | number) => {
    const updated = [...lineItems];
    updated[index] = { ...updated[index], [field]: value };
    setLineItems(updated);
    onDirtyChange?.(true);
  };

  // Convert a service price to the invoice currency, respecting the service's own currency.
  const toInvoiceCurrency = (servicePrice: number, serviceCurrency?: string) => {
    const svcCur = (serviceCurrency || 'ALL').toUpperCase();
    const rate = getEurToAllRate();
    if (svcCur === currency) return servicePrice;           // same currency → no conversion
    if (svcCur === 'EUR' && currency === 'ALL') return servicePrice * rate;   // EUR → ALL
    if (svcCur === 'ALL' && currency === 'EUR') return servicePrice / rate;   // ALL → EUR
    return servicePrice;
  };

  const calculateSubtotal = () => {
    return lineItems.reduce((sum, item) => {
      const service = services?.find(s => s.id === item.serviceId);
      return sum + toInvoiceCurrency(service?.price || 0, service?.currency) * item.quantity;
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
      // nextRecurringDate: user-set value takes priority; fallback to dueDate only for new invoices
      nextRecurringDate: isRecurring
        ? (nextRecurringDate || dueDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000))
        : undefined,
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
            serviceId: item.serviceId,
            quantity: item.quantity,
            unitPrice: toInvoiceCurrency(service.price, service.currency),
            totalPrice: toInvoiceCurrency(service.price * item.quantity, service.currency),
          });
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
      const invoiceRecipients = invoiceTeamMembers?.filter((m: any) => m.userId !== currentUser?.uid && (m.role === 'Admin' || m.canAccessInvoices)) || [];
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
            serviceId: item.serviceId,
            quantity: item.quantity,
            unitPrice: toInvoiceCurrency(service.price, service.currency),
            totalPrice: toInvoiceCurrency(service.price * item.quantity, service.currency),
          });
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
                            setSelectedCustomerId(customer.id);
                            setSelectedProjectId('');
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

      {/* Project Selector - shows projects linked to selected customer */}
      {selectedCustomerId && (() => {
        const customerProjects = projects?.filter(p => p.customerId === selectedCustomerId) || [];
        return customerProjects.length > 0 ? (
          <div>
            <Label>Projekti (lidh faturën me projektin)</Label>
            <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
              <SelectTrigger>
                <SelectValue placeholder="Zgjidh projektin (opsionale)" />
              </SelectTrigger>
              <SelectContent>
                {customerProjects.map(proj => (
                  <SelectItem key={proj.id} value={proj.id}>
                    {proj.name} — {proj.status}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null;
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
                  {(() => { const svc = services?.find(s => s.id === item.serviceId); return toInvoiceCurrency((svc?.price || 0) * item.quantity, svc?.currency).toFixed(2); })()} {currency === 'EUR' ? '€' : 'L'}
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
              <SelectItem value="Draft">Draft</SelectItem>
              <SelectItem value="Pending">Pending</SelectItem>
              <SelectItem value="Paid">Paid</SelectItem>
              <SelectItem value="Overdue">Overdue</SelectItem>
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
                <SelectTrigger className="w-[200px]">
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
          <div className="flex items-center justify-between p-3 border rounded-lg bg-background">
            <div>
              <Label className="text-sm">{isRecurringPaused ? '⏸ E Ndërprerë' : '▶ Aktive'}</Label>
              <p className="text-xs text-muted-foreground">{isRecurringPaused ? 'Gjenerimi është ndalur' : 'Gjenerimi automatik aktiv'}</p>
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
            <div><span className="text-muted-foreground">Statusi:</span> <Badge className={getStatusColor(invoice.status)}>{invoice.status}</Badge></div>
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

      {/* Bank Details */}
      {invoice.paymentMethod === 'Bank' && (invoice as any).bankIBAN && (
        <div className="p-4 border border-dashed border-border rounded-lg bg-muted/30">
          <h3 className="font-semibold mb-2 flex items-center gap-2">
            <Building2 className="w-4 h-4" />
            Detajet Bankare për Pagesë
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
            {(invoice as any).bankName && <p><span className="text-muted-foreground">Banka:</span> {(invoice as any).bankName}</p>}
            {(invoice as any).bankAccountHolder && <p><span className="text-muted-foreground">Mbajtësi:</span> {(invoice as any).bankAccountHolder}</p>}
            <p><span className="text-muted-foreground">IBAN:</span> <span className="font-mono">{(invoice as any).bankIBAN}</span></p>
            {(invoice as any).bankSWIFT && <p><span className="text-muted-foreground">SWIFT:</span> <span className="font-mono">{(invoice as any).bankSWIFT}</span></p>}
            {(invoice as any).bankCountry && <p><span className="text-muted-foreground">Shteti:</span> {(invoice as any).bankCountry}</p>}
          </div>
        </div>
      )}

      <div>
        <h3 className="font-semibold mb-2">Artikujt</h3>
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
          {invoice.tax && (
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
          <Button asChild className="w-full" variant="outline">
            <a href={invoice.paymentUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="w-4 h-4 mr-2" />
              Hap Linkun e Pagesës
            </a>
          </Button>
        )}
        
        {invoice.status !== 'Paid' && (
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
                    amount,
                    currency: (invoice as any).currency === 'EUR' ? 'eur' : 'all',
                    customerEmail: customer?.email || undefined,
                    customerName: customer?.name || undefined,
                    successUrl: `${window.location.origin}/app/invoices?payment=success&invoice=${invoice.id}`,
                    cancelUrl: `${window.location.origin}/app/invoices?payment=cancelled&invoice=${invoice.id}`,
                  }),
                });
                if (!response.ok) throw new Error('Gabim gjatë krijimit të sesionit');
                const { url } = await response.json();
                if (url) {
                  try {
                    const parsed = new URL(url);
                    if (parsed.hostname.endsWith('.stripe.com') || parsed.hostname === 'stripe.com') {
                      window.location.href = url;
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

            // Bank info — right column
            const pdfBankIBAN = (invoice as any).bankIBAN || localStorage.getItem('default_bank_iban') || '';
            const pdfBankName = (invoice as any).bankName || localStorage.getItem('default_bank_name') || '';
            const pdfBankSwift = (invoice as any).bankSWIFT || localStorage.getItem('default_bank_swift') || '';
            if (pdfBankIBAN) {
              let by = y - (5 * ([customer?.name, customer?.company, customer?.email, customer?.phone, customer?.address].filter(Boolean).length));
              doc.setFontSize(8);
              doc.setFont('helvetica', 'bold');
              doc.setTextColor(13, 148, 136);
              doc.text('DETAJET BANKARE', colMid, by); by += 5;
              doc.setFont('helvetica', 'normal');
              doc.setTextColor(50, 50, 50);
              doc.setFontSize(9);
              if (pdfBankName) { doc.text(pdfBankName, colMid, by); by += 5; }
              if (pdfBankHolder) { doc.text(`Mbajtësi: ${pdfBankHolder}`, colMid, by); by += 5; }
              doc.setFont('helvetica', 'bold');
              doc.text(`IBAN: ${pdfBankIBAN}`, colMid, by); by += 5;
              doc.setFont('helvetica', 'normal');
              if (pdfBankSwift) { doc.text(`SWIFT: ${pdfBankSwift}`, colMid, by); }
            }

            y = Math.max(y + 5, 90);

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

            doc.save(`Fatura-${invoice.invoiceNumber || invoice.id.slice(0, 8)}.pdf`);
            toast({ title: 'PDF u shkarkua' });
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
