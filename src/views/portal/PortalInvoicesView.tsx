import React, { useState, useEffect, useRef } from 'react';
import { useClientPortal } from '../../hooks/useClientPortal';
import { useCollection, useDocument } from '../../hooks/useFirestore';
import { useAuth } from '../../contexts/AuthContext';
import { Card, CardContent } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { Separator } from '../../components/ui/separator';
import { FileText, Search, Eye, DollarSign, Calendar, CreditCard, Check, ExternalLink, Building2, Download } from 'lucide-react';
import { useToast } from '../../hooks/use-toast';
import { currencySymbol } from '../../lib/utils';
import { getInvoiceCollectedAll, getInvoiceOutstandingAll } from '../../lib/finance/financialAnalytics';
import { storedInvoiceTotals } from '../../lib/finance/invoiceTotals';
import { StatCardsSkeleton, ListCardSkeleton } from './PortalSkeletons';
import type { Invoice, InvoiceItem, Service, Customer } from '../../types';
import { appReturnUrl, openCheckout, openExternal, saveOrShareFile } from '../../lib/native';

const PortalInvoicesView: React.FC = () => {
  const { customerId, businessId: portalBusinessId } = useClientPortal();
  const { user } = useAuth();
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<string>('__all__');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const PAGE_SIZE = 15;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // Handle Stripe redirect params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const payment = params.get('payment');
    if (payment === 'success') {
      toast({ title: 'Pagesa u krye me sukses!' });
      window.history.replaceState({}, '', window.location.pathname);
    } else if (payment === 'cancelled') {
      toast({ title: 'Pagesa u anulua', variant: 'destructive' });
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const { data: rawInvoices, loading } = useCollection<Invoice>('invoices', {
    skip: !customerId,
    where: [{ field: 'customerId', operator: '==', value: customerId || '' }],
    skipTeamFilter: true,
  });

  // Deep link from the invoice email's "Paguaj Tani" button: ?invoice=<id> opens
  // that invoice's detail dialog (with its payment buttons) as soon as the list
  // loads, then drops the param so refresh/back doesn't re-open it.
  const deepLinkDoneRef = useRef(false);
  useEffect(() => {
    if (deepLinkDoneRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const target = params.get('invoice');
    if (!target) { deepLinkDoneRef.current = true; return; }
    const inv = rawInvoices?.find(i => i.id === target);
    if (inv) {
      setSelectedInvoice(inv);
    } else if (loading || !rawInvoices) {
      return; // list still loading — retry on the next snapshot
    }
    // Found (opened) or definitively absent (someone else's/deleted invoice —
    // the query only returns this client's own): stop and clean the param,
    // keeping any other params (e.g. ?payment=) intact.
    deepLinkDoneRef.current = true;
    params.delete('invoice');
    const qs = params.toString();
    window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''));
  }, [rawInvoices, loading]);

  // Sort client-side (avoids Firestore composite index requirement)
  const invoices = React.useMemo(() => {
    if (!rawInvoices) return [];
    return [...rawInvoices].sort((a, b) => {
      const ta = a.createdAt instanceof Date ? a.createdAt.getTime() : (a.createdAt as any)?.toMillis?.() ?? 0;
      const tb = b.createdAt instanceof Date ? b.createdAt.getTime() : (b.createdAt as any)?.toMillis?.() ?? 0;
      return tb - ta;
    });
  }, [rawInvoices]);

  const { data: invoiceItems } = useCollection<InvoiceItem>('invoiceItems', {
    skip: !customerId,
    where: [{ field: 'customerId', operator: '==', value: customerId || '' }],
    skipTeamFilter: true,
  });
  const { data: services } = useCollection<Service>('services', {
    // The service catalogue is tenant data: scope it to the client's OWN business.
    // Reading it unscoped (the old `skipTeamFilter` behaviour) returned every
    // tenant's catalogue and pricing to any signed-in client.
    skip: !portalBusinessId,
    where: portalBusinessId ? [{ field: 'businessId', operator: '==', value: portalBusinessId }] : undefined,
    skipTeamFilter: true,
    skipBusinessFilter: true,
  });
  // Read only the client's own customer doc (server-side RLS: isPortalClientDoc).
  const { data: customer } = useDocument<Customer>('customers', customerId || undefined);

  const handleStripePayment = async (invoice: Invoice) => {
    const stripeKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;
    
    if (!stripeKey) {
      toast({
        title: 'Pagesa nuk është e disponueshme',
        description: 'Kontaktoni ekipin për të marrë linkun e pagesës.',
        variant: 'destructive',
      });
      return;
    }

    const amount = invoice.total ?? invoice.amount ?? 0;
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
          currency: ((invoice as any).currency as string | undefined)?.toLowerCase() || 'eur',
          customerEmail: customer?.email || undefined,
          customerName: customer?.name || undefined,
          successUrl: appReturnUrl(`/portal/invoices?payment=success`),
          cancelUrl: appReturnUrl(`/portal/invoices?payment=cancelled`),
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
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Paid': return 'bg-green-100 text-green-800';
      case 'Pending': return 'bg-yellow-100 text-yellow-800';
      case 'Overdue': return 'bg-red-100 text-red-800';
      case 'Draft': return 'bg-gray-100 text-gray-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'Paid': return 'E Paguar';
      case 'Pending': return 'Në Pritje';
      case 'Overdue': return 'E Vonuar';
      case 'Draft': return 'Skicë';
      default: return status;
    }
  };

  // An invoice only exists for the client once it has been ISSUED. A Draft is still
  // being written (and auto-created project drafts start at 0 L), so it must never
  // reach the portal — the same rule the quote flow already applies to Draft quotes.
  // Payment of a draft is refused server-side too; this stops it being seen at all.
  const clientVisibleInvoices = React.useMemo(
    () => (invoices || []).filter(inv => inv.status !== 'Draft'),
    [invoices],
  );

  const filteredInvoices = React.useMemo(() => {
    return clientVisibleInvoices.filter(inv => {
      if (statusFilter !== '__all__' && inv.status !== statusFilter) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const num = inv.invoiceNumber || `INV-${inv.id.slice(0, 6)}`;
        if (!num.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [clientVisibleInvoices, statusFilter, searchQuery]);

  // Reset the visible window whenever the filter/search changes.
  useEffect(() => { setVisibleCount(PAGE_SIZE); }, [statusFilter, searchQuery]);
  const visibleInvoices = filteredInvoices.slice(0, visibleCount);
  const hasMoreInvoices = filteredInvoices.length > visibleCount;

  const selectedItems = invoiceItems?.filter(item => item.invoiceId === selectedInvoice?.id) || [];

  // `description` is the label for a free-text line (an invoice raised from a task
  // or a project budget carries no catalogue serviceId) — falling straight through
  // to 'Shërbim' hid what the client was actually billed for.
  const getServiceName = (serviceId?: string, description?: string) => {
    const service = serviceId ? services?.find(s => s.id === serviceId) : undefined;
    return service?.title || service?.name || description || 'Shërbim';
  };

  // Normalize each invoice to ALL before summing — invoices can be EUR or ALL, and
  // the summary cards render a fixed "ALL" label, so a raw mixed-currency sum lied.
  // Both sides use the canonical helpers, so a partially-paid invoice contributes
  // its settled part to "paid" and only its REMAINDER to "owed". Summing full totals
  // told a client who had already paid half that they still owed everything.
  const totalPaid = clientVisibleInvoices.reduce((s, i) => s + getInvoiceCollectedAll(i), 0);
  const totalPending = clientVisibleInvoices.reduce((s, i) => s + getInvoiceOutstandingAll(i), 0);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <div className="h-8 w-40 rounded-md bg-muted animate-pulse" />
          <div className="h-4 w-64 rounded-md bg-muted animate-pulse" />
        </div>
        <StatCardsSkeleton count={3} />
        <ListCardSkeleton rows={5} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Faturat</h1>
        <p className="text-muted-foreground mt-1">
          Shikoni dhe menaxhoni faturat tuaja
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-100 rounded-lg">
                <DollarSign className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">E Paguar</p>
                <p className="text-xl font-bold">{totalPaid.toLocaleString()} ALL</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-yellow-100 rounded-lg">
                <CreditCard className="h-5 w-5 text-yellow-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Në Pritje</p>
                <p className="text-xl font-bold">{totalPending.toLocaleString()} ALL</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-100 rounded-lg">
                <FileText className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Totale Fatura</p>
                <p className="text-xl font-bold">{invoices?.length || 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Kërko faturë..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-[180px]">
            <SelectValue placeholder="Statusi" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Të gjitha</SelectItem>
            <SelectItem value="Paid">E Paguar</SelectItem>
            <SelectItem value="Pending">Në Pritje</SelectItem>
            <SelectItem value="Overdue">E Vonuar</SelectItem>
            <SelectItem value="Partial">Pjesërisht e Paguar</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Invoices List */}
      {filteredInvoices.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">Nuk u gjet asnjë faturë</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {visibleInvoices.map(invoice => (
            <Card key={invoice.id} className="hover:shadow-md transition-shadow">
              <CardContent className="py-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-4">
                    <div className="p-2 bg-muted rounded-lg">
                      <FileText className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="font-semibold">
                        {invoice.invoiceNumber || `INV-${invoice.id.slice(0, 6)}`}
                      </p>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground mt-0.5">
                        <Calendar className="h-3.5 w-3.5" />
                        {invoice.createdAt instanceof Date
                          ? invoice.createdAt.toLocaleDateString('sq-AL')
                          : ''}
                        {invoice.dueDate && (
                          <>
                            <span>•</span>
                            <span>
                              Afati: {invoice.dueDate instanceof Date
                                ? invoice.dueDate.toLocaleDateString('sq-AL')
                                : ''}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-lg font-bold">
                      {(invoice.total || invoice.amount || 0).toLocaleString()} {currencySymbol((invoice as any).currency)}
                    </span>
                    <Badge className={getStatusColor(invoice.status)} variant="secondary">
                      {getStatusLabel(invoice.status)}
                    </Badge>
                    {invoice.paymentMethod && (
                      <Badge variant="outline" className="text-xs">
                        {invoice.paymentMethod === 'Bank' ? 'Transfer' : invoice.paymentMethod}
                      </Badge>
                    )}
                    {/* `Partial` is payable too — create-checkout-session charges the
                        remainder, and the staff table has always offered it. */}
                    {(invoice.status === 'Pending' || invoice.status === 'Overdue' || invoice.status === 'Partial') && (invoice.paymentMethod === 'Stripe' || !invoice.paymentMethod) && (
                      <Button
                        size="sm"
                        className="bg-[#635BFF] hover:bg-[#5851ea] text-white"
                        onClick={() => handleStripePayment(invoice)}
                      >
                        <CreditCard className="w-4 h-4 mr-1" />
                        Paguaj
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setSelectedInvoice(invoice)}
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}

          {hasMoreInvoices && (
            <div className="flex justify-center pt-2">
              <Button variant="outline" onClick={() => setVisibleCount(c => c + PAGE_SIZE)}>
                Shfaq më shumë ({filteredInvoices.length - visibleCount})
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Invoice Detail Dialog */}
      <Dialog open={!!selectedInvoice} onOpenChange={(open) => !open && setSelectedInvoice(null)}>
        <DialogContent className="w-full max-w-full sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Fatura {selectedInvoice?.invoiceNumber || `INV-${selectedInvoice?.id?.slice(0, 6)}`}
            </DialogTitle>
          </DialogHeader>
          {selectedInvoice && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">Data</p>
                  <p className="font-medium">
                    {selectedInvoice.createdAt instanceof Date
                      ? selectedInvoice.createdAt.toLocaleDateString('sq-AL')
                      : '-'}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Afati</p>
                  <p className="font-medium">
                    {selectedInvoice.dueDate instanceof Date
                      ? selectedInvoice.dueDate.toLocaleDateString('sq-AL')
                      : '-'}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Statusi</p>
                  <Badge className={getStatusColor(selectedInvoice.status)} variant="secondary">
                    {getStatusLabel(selectedInvoice.status)}
                  </Badge>
                </div>
                <div>
                  <p className="text-muted-foreground">Mënyra e Pagesës</p>
                  <p className="font-medium">{selectedInvoice.paymentMethod || '-'}</p>
                </div>
              </div>

              {customer && (
                <>
                  <Separator />
                  <div className="text-sm">
                    <p className="text-muted-foreground mb-1">Klienti</p>
                    <p className="font-medium">{customer.name}</p>
                    {customer.company && <p className="text-muted-foreground">{customer.company}</p>}
                    {customer.email && <p className="text-muted-foreground">{customer.email}</p>}
                  </div>
                </>
              )}

              {selectedItems.length > 0 && (
                <>
                  <Separator />
                  <div>
                    <p className="text-sm text-muted-foreground mb-2">Artikujt</p>
                    <div className="space-y-2">
                      {selectedItems.map(item => (
                        <div key={item.id} className="flex items-center justify-between text-sm py-1.5 border-b last:border-0">
                          <div>
                            <p className="font-medium">{getServiceName(item.serviceId, item.description)}</p>
                            <p className="text-muted-foreground">
                              {item.quantity} × {item.unitPrice.toLocaleString()} {currencySymbol((selectedInvoice as any)?.currency)}
                            </p>
                          </div>
                          <p className="font-semibold">{item.totalPrice.toLocaleString()} {currencySymbol((selectedInvoice as any)?.currency)}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}

              <Separator />
              <div className="flex items-center justify-between text-lg font-bold">
                <span>Totali</span>
                <span>{(selectedInvoice.total || selectedInvoice.amount || 0).toLocaleString()} {currencySymbol((selectedInvoice as any).currency)}</span>
              </div>

              {/* Bank Transfer Details */}
              {selectedInvoice.paymentMethod === 'Bank' && (selectedInvoice as any).bankIBAN && (
                <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg space-y-2">
                  <p className="font-semibold text-sm flex items-center gap-2 text-blue-800">
                    <Building2 className="w-4 h-4" />
                    Detajet Bankare për Pagesë
                  </p>
                  <div className="grid grid-cols-1 gap-1.5 text-sm">
                    {(selectedInvoice as any).bankName && (
                      <p><span className="text-muted-foreground">Banka:</span> <span className="font-medium">{(selectedInvoice as any).bankName}</span></p>
                    )}
                    {(selectedInvoice as any).bankAccountHolder && (
                      <p><span className="text-muted-foreground">Mbajtësi:</span> <span className="font-medium">{(selectedInvoice as any).bankAccountHolder}</span></p>
                    )}
                    <p><span className="text-muted-foreground">IBAN:</span> <span className="font-mono font-medium break-all">{(selectedInvoice as any).bankIBAN}</span></p>
                    {(selectedInvoice as any).bankSWIFT && (
                      <p><span className="text-muted-foreground">SWIFT / BIC:</span> <span className="font-mono font-medium">{(selectedInvoice as any).bankSWIFT}</span></p>
                    )}
                    {(selectedInvoice as any).bankCountry && (
                      <p><span className="text-muted-foreground">Shteti:</span> <span className="font-medium">{(selectedInvoice as any).bankCountry}</span></p>
                    )}
                  </div>
                  <p className="text-xs text-blue-700 mt-2">
                    Ju lutemi përdorni numrin e faturës <strong>#{selectedInvoice.invoiceNumber || selectedInvoice.id.slice(0, 8)}</strong> si referencë pagese.
                  </p>
                </div>
              )}

              {/* Payment Section — `Partial` is payable too (the checkout charges
                  the remainder); the list button has always offered it. */}
              {(selectedInvoice.status === 'Pending' || selectedInvoice.status === 'Overdue' || selectedInvoice.status === 'Partial') && (
                <div className="space-y-2 pt-2">
                  {(selectedInvoice as any).paymentUrl && (
                    <Button
                      className="w-full"
                      variant="outline"
                      onClick={() => openExternal((selectedInvoice as any).paymentUrl)}
                    >
                      <ExternalLink className="w-4 h-4 mr-2" />
                      Hap Linkun e Pagesës
                    </Button>
                  )}
                  {/* An invoice with no explicit payment method can still be paid
                      online — handleStripePayment falls back to a clear toast when
                      Stripe isn't configured for this deployment. */}
                  {(selectedInvoice.paymentMethod === 'Stripe' || !selectedInvoice.paymentMethod) && (
                    <Button
                      className="w-full bg-[#635BFF] hover:bg-[#5851ea] text-white"
                      onClick={() => handleStripePayment(selectedInvoice)}
                    >
                      <CreditCard className="w-4 h-4 mr-2" />
                      Paguaj me Stripe
                    </Button>
                  )}
                </div>
              )}

              {selectedInvoice.status === 'Paid' && (
                <div className="flex items-center justify-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg text-green-700">
                  <Check className="w-5 h-5" />
                  <span className="font-medium">Fatura është e paguar</span>
                </div>
              )}

              <Separator />
              <Button
                variant="outline"
                className="w-full"
                onClick={async () => {
                  const invoice = selectedInvoice;
                  const { default: jsPDF } = await import('jspdf');
                  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
                  const w = doc.internal.pageSize.getWidth();
                  const margin = 20;
                  let y = 20;
                  const cur = currencySymbol((invoice as any).currency);

                  // Header
                  doc.setFontSize(22); doc.setFont('helvetica', 'bold');
                  doc.text('FATURË', margin, y);
                  doc.setFontSize(10); doc.setFont('helvetica', 'normal');
                  doc.text(`# ${invoice.invoiceNumber || invoice.id.slice(0, 8)}`, w - margin, y, { align: 'right' });
                  y += 6;
                  doc.text(`Data: ${invoice.invoiceDate ? new Date(invoice.invoiceDate).toLocaleDateString('sq-AL') : new Date(invoice.createdAt).toLocaleDateString('sq-AL')}`, w - margin, y, { align: 'right' });
                  y += 5;
                  doc.text(`Afati: ${invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString('sq-AL') : 'Pa afat'}`, w - margin, y, { align: 'right' });
                  y += 5;
                  doc.text(`Statusi: ${invoice.status}`, w - margin, y, { align: 'right' });

                  y += 8; doc.setDrawColor(200); doc.line(margin, y, w - margin, y); y += 10;

                  // Customer
                  doc.setFontSize(11); doc.setFont('helvetica', 'bold'); doc.text('Klienti', margin, y); y += 6;
                  doc.setFontSize(10); doc.setFont('helvetica', 'normal');
                  if (customer?.name)    { doc.text(customer.name,    margin, y); y += 5; }
                  if (customer?.company) { doc.text(customer.company, margin, y); y += 5; }
                  if (customer?.email)   { doc.text(customer.email,   margin, y); y += 5; }
                  if (customer?.phone)   { doc.text(customer.phone,   margin, y); y += 5; }

                  // Bank details (right side — from invoice fields)
                  const bankIBAN = (invoice as any).bankIBAN || '';
                  if (bankIBAN) {
                    let by = 58; const bx = w / 2 + 10;
                    doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
                    doc.text('Detajet Bankare', bx, by); by += 6;
                    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
                    if ((invoice as any).bankName)           { doc.text(`Banka: ${(invoice as any).bankName}`, bx, by); by += 5; }
                    if ((invoice as any).bankAccountHolder)  { doc.text(`Mbajtësi: ${(invoice as any).bankAccountHolder}`, bx, by); by += 5; }
                    doc.text(`IBAN: ${bankIBAN}`, bx, by); by += 5;
                    if ((invoice as any).bankSWIFT)          { doc.text(`SWIFT: ${(invoice as any).bankSWIFT}`, bx, by); by += 5; }
                    doc.setFontSize(10);
                  }

                  y = Math.max(y, 100);

                  // Items table
                  doc.setFillColor(245, 245, 245);
                  doc.rect(margin, y, w - margin * 2, 8, 'F');
                  doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
                  doc.text('Shërbimi', margin + 2, y + 5.5);
                  doc.text('Sasia',   w - margin - 60, y + 5.5, { align: 'right' });
                  doc.text('Çmimi',   w - margin - 30, y + 5.5, { align: 'right' });
                  doc.text('Totali',  w - margin - 2,  y + 5.5, { align: 'right' });
                  y += 10;

                  doc.setFont('helvetica', 'normal');
                  for (const item of selectedItems) {
                    doc.text(getServiceName(item.serviceId, item.description), margin + 2, y + 4);
                    doc.text(String(item.quantity), w - margin - 60, y + 4, { align: 'right' });
                    doc.text(`${(item.unitPrice ?? 0).toFixed(2)} ${cur}`, w - margin - 30, y + 4, { align: 'right' });
                    doc.text(`${(item.totalPrice ?? 0).toFixed(2)} ${cur}`, w - margin - 2,  y + 4, { align: 'right' });
                    doc.setDrawColor(230); doc.line(margin, y + 7, w - margin, y + 7); y += 9;
                  }

                  // Totals — the same box the staff PDF prints (invoiceTotals.ts):
                  // the discount line was missing here, and a legacy invoice with
                  // no stored `subtotal` printed "0.00" above a non-zero total.
                  const totals = storedInvoiceTotals(invoice);
                  y += 5; doc.setDrawColor(200); doc.line(w - margin - 70, y, w - margin, y); y += 7;
                  doc.text('Nëntotali:', w - margin - 40, y, { align: 'right' });
                  doc.text(`${totals.subtotal.toFixed(2)} ${cur}`, w - margin - 2, y, { align: 'right' }); y += 6;
                  if (totals.discountAmount > 0) {
                    const discountLabel = invoice.discountType === 'percent'
                      ? `Zbritje (${Number(invoice.discount) || 0}%):`
                      : 'Zbritje:';
                    doc.text(discountLabel, w - margin - 40, y, { align: 'right' });
                    doc.text(`-${totals.discountAmount.toFixed(2)} ${cur}`, w - margin - 2, y, { align: 'right' }); y += 6;
                  }
                  if (totals.tax > 0) {
                    doc.text('Taksa:', w - margin - 40, y, { align: 'right' });
                    doc.text(`${totals.tax.toFixed(2)} ${cur}`, w - margin - 2, y, { align: 'right' }); y += 6;
                  }
                  doc.setFont('helvetica', 'bold'); doc.setFontSize(12);
                  doc.text('TOTALI:', w - margin - 40, y, { align: 'right' });
                  doc.text(`${totals.total.toFixed(2)} ${cur}`, w - margin - 2, y, { align: 'right' });

                  if (invoice.notes) {
                    y += 15; doc.setFontSize(9); doc.setFont('helvetica', 'bold');
                    doc.text('Shënime:', margin, y); y += 5;
                    doc.setFont('helvetica', 'normal');
                    doc.text(doc.splitTextToSize(invoice.notes, w - margin * 2), margin, y);
                  }

                  const fileName = `Fatura-${invoice.invoiceNumber || invoice.id.slice(0, 8)}.pdf`;
                  await saveOrShareFile(doc.output('blob'), fileName, { shareTitle: fileName });
                }}
              >
                <Download className="w-4 h-4 mr-2" />
                Shkarko PDF
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default PortalInvoicesView;
