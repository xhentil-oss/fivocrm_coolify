import React, { useState, useEffect } from 'react';
import { useCollection, useMutation } from '../hooks/useFirestore';
import { usePermissions } from '../contexts/PermissionsContext';
import { useActivityLogger } from '../hooks/useActivityLogger';
import { useAuth } from '../contexts/AuthContext';
import { DollarSign, Plus, Calendar as CalendarIcon, CreditCard, Mail, Send, Building2, ShoppingCart, Trash2, Eye, Edit2, Check, X, ExternalLink, Loader2, MoreVertical } from 'lucide-react';
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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog';
import { Textarea } from '../components/ui/textarea';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import type { Invoice, Customer, Service, InvoiceItem, Project, ClientPortalAccess } from '../types';
import { useFilteredByOwner } from '../hooks/useRoleFilteredData';
import { toast } from '../hooks/use-toast';

const getStatusColor = (status: string) => {
  switch (status) {
    case 'Paid':
      return 'bg-success text-success-foreground';
    case 'Pending':
      return 'bg-warning text-warning-foreground';
    case 'Overdue':
      return 'bg-error text-error-foreground';
    default:
      return 'bg-muted text-muted-foreground';
  }
};

const InvoicesView: React.FC = () => {
  const permissions = usePermissions();
  const logActivity = useActivityLogger();
  const { user } = useAuth();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [editInvoice, setEditInvoice] = useState<Invoice | null>(null);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [editingInvoiceId, setEditingInvoiceId] = useState<string | null>(null);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const [invoiceToDelete, setInvoiceToDelete] = useState<string | null>(null);

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
  const invoiceMutation = useMutation<Invoice>('invoices');

  const handleDeleteInvoice = async (id: string) => {
    await invoiceMutation.remove(id);
    toast({ title: 'Fatura u fshi me sukses!' });
    setInvoiceToDelete(null);
  };

  const handleSendEmail = async (invoiceId: string) => {
    await invoiceMutation.update(invoiceId, { emailSent: true });
    toast({ title: 'Fatura u shënua si e dërguar' });
  };

  const handleSendReminder = async (invoiceId: string) => {
    await invoiceMutation.update(invoiceId, { reminderSent: true });
    toast({ title: 'Kujtesa u shënua si e dërguar' });
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
          currency: 'eur',
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
      // When status is marked Paid, record paidAt timestamp
      if (field === 'status' && editValue === 'Paid') {
        updateData.paidAt = new Date();
      }
    }
    
    await invoiceMutation.update(invoiceId, updateData);
    cancelEditing();
  };

  const totalRevenue = invoices?.filter(inv => inv.status === 'Paid').reduce((sum, inv) => sum + (inv.total || 0), 0) || 0;
  const paidInvoices = invoices?.filter(inv => inv.status === 'Paid').length || 0;
  const pendingAmount = invoices?.filter(inv => inv.status === 'Pending').reduce((sum, inv) => sum + (inv.total || 0), 0) || 0;
  const draftAmount = invoices?.filter(inv => inv.status === 'Draft').reduce((sum, inv) => sum + (inv.total || 0), 0) || 0;
  const projectedRevenue = pendingAmount + draftAmount;

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
        <div className="grid grid-cols-3 gap-3 sm:gap-6">
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
            {invoices?.length || 0} fatura gjithsej
          </p>
        </div>
        <div className="flex gap-2">
          <ExportButton 
            data={invoices || []} 
            filename="invoices"
            columns={['invoiceNumber', 'customerId', 'total', 'status', 'dueDate', 'paymentMethod']}
          />
          {permissions.canEdit && (
            <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="bg-primary text-primary-foreground">
                  <Plus className="w-4 h-4 sm:mr-2" />
                  <span className="hidden sm:inline">Faturë e Re</span>
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Krijo Faturë të Re</DialogTitle>
                </DialogHeader>
                <InvoiceForm onClose={() => setIsCreateDialogOpen(false)} />
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      {/* Edit Invoice Dialog */}
      {editInvoice && (
        <Dialog open={!!editInvoice} onOpenChange={() => setEditInvoice(null)}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Ndrysho Faturën — {editInvoice.invoiceNumber || editInvoice.id.slice(0, 8)}</DialogTitle>
            </DialogHeader>
            <InvoiceForm onClose={() => setEditInvoice(null)} editInvoice={editInvoice} />
          </DialogContent>
        </Dialog>
      )}

      <div className="grid grid-cols-3 gap-3 sm:gap-6 stagger-children">
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

      {/* Mobile Card Layout */}
      <div className="sm:hidden space-y-3">
        {invoices?.map((invoice) => {
          const customer = customers?.find(c => c.id === invoice.customerId);
          return (
            <Card key={invoice.id} className="p-3" onClick={() => setSelectedInvoice(invoice)}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-mono font-medium">{invoice.invoiceNumber || invoice.id.slice(0, 8)}</span>
                    <Badge className={`${getStatusColor(invoice.status)} text-[10px] px-1.5 py-0`}>{invoice.status}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{customer?.name || 'Unknown'}</p>
                  <div className="flex items-center gap-3 mt-1.5">
                    <span className="text-sm font-semibold">{((invoice.total ?? invoice.amount ?? 0)).toLocaleString()} L</span>
                    <span className="text-[10px] text-muted-foreground">Afati: {new Date(invoice.dueDate).toLocaleDateString()}</span>
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
                    {invoice.status === 'Pending' && (
                      <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleStripePayment(invoice); }}>
                        <CreditCard className="w-4 h-4 mr-2" /> Paguaj me Stripe
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
                <th className="px-4 py-3 text-left text-body-sm font-medium hidden lg:table-cell">Afati</th>
                <th className="px-4 py-3 text-left text-body-sm font-medium">Veprime</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {invoices?.map((invoice) => {
                const customer = customers?.find(c => c.id === invoice.customerId);
                return (
                  <tr key={invoice.id} className="hover:bg-muted/50">
                    <td className="px-4 py-3 text-body-sm font-mono">
                      {invoice.invoiceNumber || invoice.id.slice(0, 8)}
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
                          className="flex items-center gap-2 cursor-pointer hover:bg-muted/50 px-2 py-1 rounded"
                          onClick={() => startEditing(invoice.id, 'total', invoice.total ?? invoice.amount ?? 0)}
                        >
                          {((invoice.total ?? invoice.amount ?? 0)).toLocaleString()} L
                          <Edit2 className="w-3 h-3 opacity-0 group-hover:opacity-100" />
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {editingInvoiceId === invoice.id && editingField === 'status' ? (
                        <div className="flex items-center gap-2">
                          <select
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            className="px-2 py-1 border rounded"
                            autoFocus
                          >
                            <option value="Pending">Pending</option>
                            <option value="Paid">Paid</option>
                            <option value="Overdue">Overdue</option>
                          </select>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() => saveEdit(invoice.id, 'status')}
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
                          className="cursor-pointer hover:bg-muted/50 px-2 py-1 rounded inline-block"
                          onClick={() => startEditing(invoice.id, 'status', invoice.status)}
                        >
                          <Badge className={getStatusColor(invoice.status)}>{invoice.status}</Badge>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell">{new Date(invoice.dueDate).toLocaleDateString()}</td>
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
                        {invoice.status === 'Pending' && (
                          <Button
                            size="sm"
                            className="bg-[#635BFF] hover:bg-[#5851ea] text-white"
                            onClick={() => handleStripePayment(invoice)}
                          >
                            <CreditCard className="w-4 h-4 mr-1" />
                            Paguaj
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
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Detajet e Faturës</DialogTitle>
            </DialogHeader>
            <InvoiceDetails invoice={selectedInvoice} />
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
    </div>
  );
};

const InvoiceForm: React.FC<{ onClose: () => void; editInvoice?: Invoice | null }> = ({ onClose, editInvoice }) => {
  const isEditing = !!editInvoice;
  const logActivity = useActivityLogger();
  const [dueDate, setDueDate] = useState<Date | undefined>(editInvoice?.dueDate ? new Date(editInvoice.dueDate) : undefined);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>(editInvoice?.customerId || '');
  const [selectedProjectId, setSelectedProjectId] = useState<string>(editInvoice?.projectId || '');
  const [lineItems, setLineItems] = useState<Array<{ serviceId: string; quantity: number }>>([]);
  const [tax, setTax] = useState<number>((editInvoice as any)?.tax || 0);
  const [invoiceNumber, setInvoiceNumber] = useState(editInvoice?.invoiceNumber || '');
  const [paymentMethod, setPaymentMethod] = useState(editInvoice?.paymentMethod || 'Stripe');
  const [status, setStatus] = useState(editInvoice?.status || 'Pending');
  const [notes, setNotes] = useState((editInvoice as any)?.notes || '');
  const [paymentUrl, setPaymentUrl] = useState((editInvoice as any)?.paymentUrl || '');
  const [isRecurring, setIsRecurring] = useState((editInvoice as any)?.isRecurring || false);
  const [recurringFrequency, setRecurringFrequency] = useState((editInvoice as any)?.recurringFrequency || 'monthly');
  const [loadedExistingItems, setLoadedExistingItems] = useState(false);

  const { data: customers } = useCollection<Customer>('customers', { skipTeamFilter: true });
  const { data: services } = useCollection<Service>('services', { skipTeamFilter: true });
  const { data: projects } = useCollection<Project>('projects', { skipTeamFilter: true });
  const { data: portalAccessList } = useCollection<ClientPortalAccess>('clientPortalAccess', { skipTeamFilter: true });
  const { data: existingItems } = useCollection<InvoiceItem>('invoiceItems', isEditing
    ? { where: [{ field: 'invoiceId', operator: '==', value: editInvoice!.id }], skipTeamFilter: true }
    : { skipTeamFilter: true }
  );
  const invoiceMutation = useMutation<Invoice>('invoices');
  const invoiceItemMutation = useMutation<InvoiceItem>('invoiceItems');
  const accessMutation = useMutation<ClientPortalAccess>('clientPortalAccess');

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
  };

  const removeLineItem = (index: number) => {
    setLineItems(lineItems.filter((_, i) => i !== index));
  };

  const updateLineItem = (index: number, field: 'serviceId' | 'quantity', value: string | number) => {
    const updated = [...lineItems];
    updated[index] = { ...updated[index], [field]: value };
    setLineItems(updated);
  };

  const calculateSubtotal = () => {
    return lineItems.reduce((sum, item) => {
      const service = services?.find(s => s.id === item.serviceId);
      return sum + (service?.price || 0) * item.quantity;
    }, 0);
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    const subtotal = calculateSubtotal();
    const total = subtotal + tax;

    const invoiceData: any = {
      customerId: selectedCustomerId,
      projectId: selectedProjectId || '',
      invoiceNumber,
      paymentMethod,
      status,
      dueDate: dueDate || new Date(),
      notes,
      subtotal,
      tax,
      total,
      amount: total,
      paymentUrl,
      isRecurring,
      recurringFrequency: isRecurring ? recurringFrequency : undefined,
    };

    if (isEditing) {
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
            unitPrice: service.price,
            totalPrice: service.price * item.quantity,
          });
        }
      }
    } else {
      // Create new invoice
      invoiceData.emailSent = false;
      invoiceData.reminderSent = false;

      const invoice = await invoiceMutation.create(invoiceData);

      const customerName = customers?.find(c => c.id === selectedCustomerId)?.name || '';
      logActivity('invoice_created', `Faturë e re: ${invoiceNumber || invoice.id.slice(0,8)}`, {
        entityType: 'invoice', entityId: invoice.id, customerId: selectedCustomerId,
        description: `${total.toLocaleString()} ALL — ${customerName}`
      });

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
            email: customer.email,
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
            unitPrice: service.price,
            totalPrice: service.price * item.quantity,
          });
        }
      }
    }

    onClose();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label htmlFor="invoiceNumber">Numri i Faturës</Label>
          <Input id="invoiceNumber" name="invoiceNumber" placeholder="FAT-001" value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} />
        </div>

        <div>
          <Label htmlFor="customerId">Klienti *</Label>
          <Select name="customerId" value={selectedCustomerId} onValueChange={(val) => { setSelectedCustomerId(val); setSelectedProjectId(''); }} required>
            <SelectTrigger>
              <SelectValue placeholder="Zgjidh klientin" />
            </SelectTrigger>
            <SelectContent>
              {customers?.map(customer => (
                <SelectItem key={customer.id} value={customer.id}>
                  {customer.name} {customer.company && `(${customer.company})`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
                        {service.title} - {service.price} L
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
                    value={item.quantity}
                    onChange={(e) => updateLineItem(index, 'quantity', parseInt(e.target.value))}
                    placeholder="Sasia"
                  />
                </div>
                <div className="w-20 sm:w-24 text-right text-sm font-medium">
                  {((services?.find(s => s.id === item.serviceId)?.price || 0) * item.quantity).toFixed(2)} L
                </div>
                <Button type="button" variant="outline" size="sm" onClick={() => removeLineItem(index)}>
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
        </div>
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
            <Calendar mode="single" selected={dueDate} onSelect={setDueDate} />
          </PopoverContent>
        </Popover>
      </div>

      {/* Recurring Invoice */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="flex items-center justify-between p-3 border rounded-lg">
          <div>
            <Label>Faturë Periodike</Label>
            <p className="text-xs text-muted-foreground">Gjenero automatikisht</p>
          </div>
          <input type="checkbox" checked={isRecurring} onChange={e => setIsRecurring(e.target.checked)} className="h-4 w-4 accent-primary" />
        </div>
        {isRecurring && (
          <div>
            <Label>Frekuenca</Label>
            <Select value={recurringFrequency} onValueChange={setRecurringFrequency}>
              <SelectTrigger><SelectValue /></SelectTrigger>
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

      <div>
        <Label htmlFor="tax">Taksa</Label>
        <Input
          id="tax"
          name="tax"
          type="number"
          step="0.01"
          value={tax}
          onChange={(e) => setTax(parseFloat(e.target.value) || 0)}
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
            <span className="font-medium">{calculateSubtotal().toFixed(2)} L</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Taksa:</span>
            <span className="font-medium">{tax.toFixed(2)} L</span>
          </div>
          <div className="flex justify-between text-lg font-bold">
            <span>Total:</span>
            <span>{(calculateSubtotal() + tax).toFixed(2)} L</span>
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
            <p><span className="text-muted-foreground">Afati:</span> {new Date(invoice.dueDate).toLocaleDateString('sq-AL')}</p>
            <p><span className="text-muted-foreground">Mënyra e Pagesës:</span> {invoice.paymentMethod}</p>
            {invoice.paidAt && <p><span className="text-muted-foreground">Paguar më:</span> {new Date(invoice.paidAt).toLocaleDateString('sq-AL')}</p>}
          </div>
        </div>
      </div>

      <div>
        <h3 className="font-semibold mb-2">Artikujt</h3>
        {/* Mobile: stacked cards */}
        <div className="sm:hidden space-y-2">
          {invoiceItems?.map((item) => (
            <div key={item.id} className="p-3 bg-muted/50 rounded-lg">
              <p className="text-sm font-medium">{services[item.serviceId]?.title || 'Duke ngarkuar...'}</p>
              <div className="flex items-center justify-between mt-1.5 text-xs text-muted-foreground">
                <span>Sasia: {item.quantity} × {(item.unitPrice ?? 0).toFixed(2)} L</span>
                <span className="font-semibold text-foreground text-sm">{(item.totalPrice ?? 0).toFixed(2)} L</span>
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
                  <td className="px-4 py-2 text-right">{(item.unitPrice ?? 0).toFixed(2)} L</td>
                  <td className="px-4 py-2 text-right font-medium">{(item.totalPrice ?? 0).toFixed(2)} L</td>
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
            <span className="font-medium">{(invoice.subtotal || 0).toFixed(2)} L</span>
          </div>
          {invoice.tax && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Taksa:</span>
              <span className="font-medium">{invoice.tax.toFixed(2)} L</span>
            </div>
          )}
          <div className="flex justify-between text-lg font-bold">
            <span>Totali:</span>
            <span>{(invoice.total || 0).toFixed(2)} L</span>
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
        
        {invoice.status === 'Pending' && (
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
                const response = await fetch('/api/create-checkout-session', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    invoiceId: invoice.id,
                    invoiceNumber: invoice.invoiceNumber || invoice.id.slice(0, 8),
                    amount,
                    currency: 'eur',
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
      </div>
    </div>
  );
};

export default InvoicesView;
