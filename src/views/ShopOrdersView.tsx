import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft, Ban, CheckCircle2, FileText, Loader2, Package, PackageCheck, Plus,
  Receipt, Search, ShoppingCart, Trash2, Truck, User as UserIcon,
} from 'lucide-react';
import { Card } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { SkeletonLoader } from '../components/PageSkeleton';
import { useCollection, useMutation } from '../hooks/useFirestore';
import { usePermissions } from '../contexts/PermissionsContext';
import { useToast } from '../hooks/use-toast';
import { formatCurrency, getTimestampMs, toAll } from '../lib/utils';
import { buildOrderItem, computeOrderTotals } from '../lib/shop/pricing';
import { allocationsForOrder, applyStockToProduct, canFulfill } from '../lib/shop/inventory';
import { nextOrderNumber } from '../lib/shop/product';
import { variantLabel } from '../lib/shop/variants';
import type {
  Customer, Invoice, Product, ShopOrder, ShopOrderItem, ShopOrderStatus, StockMovement,
} from '../types';

const ALL = '__all__';
const NONE = '__none__';

const STATUS_META: Record<ShopOrderStatus, { label: string; cls: string }> = {
  Pending: { label: 'Në pritje', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
  Confirmed: { label: 'Konfirmuar', cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  Processing: { label: 'Në përgatitje', cls: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300' },
  Shipped: { label: 'Dërguar', cls: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300' },
  Delivered: { label: 'Dorëzuar', cls: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' },
  Cancelled: { label: 'Anuluar', cls: 'bg-gray-200 text-gray-600 dark:bg-gray-800 dark:text-gray-400' },
  Refunded: { label: 'Rimbursuar', cls: 'bg-destructive/10 text-destructive' },
};

const PAYMENT_META: Record<string, { label: string; cls: string }> = {
  Unpaid: { label: 'E papaguar', cls: 'bg-destructive/10 text-destructive' },
  Partial: { label: 'Pjesërisht', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
  Paid: { label: 'Paguar', cls: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' },
  Refunded: { label: 'Rimbursuar', cls: 'bg-muted text-muted-foreground' },
};

/** Allowed forward transitions — keeps the lifecycle from going backwards. */
const NEXT_STATUS: Record<ShopOrderStatus, ShopOrderStatus[]> = {
  Pending: ['Confirmed', 'Cancelled'],
  Confirmed: ['Processing', 'Cancelled'],
  Processing: ['Shipped', 'Cancelled'],
  Shipped: ['Delivered'],
  Delivered: ['Refunded'],
  Cancelled: [],
  Refunded: [],
};

const fmtDate = (d: any) => {
  const ms = getTimestampMs(d);
  return ms ? new Date(ms).toLocaleDateString('sq-AL', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
};

const ShopOrdersView: React.FC = () => {
  const permissions = usePermissions();
  const { toast } = useToast();
  const canEdit = permissions.canEdit === true;

  const { data: orders, loading } = useCollection<ShopOrder>('shopOrders', {
    orderBy: { field: 'createdAt', direction: 'desc' },
  });
  const { data: products } = useCollection<Product>('products');
  const { data: customers } = useCollection<Customer>('customers');

  const orderMutation = useMutation<ShopOrder>('shopOrders');
  const productMutation = useMutation<Product>('products');
  const movementMutation = useMutation<StockMovement>('stockMovements');
  const invoiceMutation = useMutation<Invoice>('invoices');

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState(ALL);
  const [paymentFilter, setPaymentFilter] = useState(ALL);
  const [selected, setSelected] = useState<ShopOrder | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [visibleCount, setVisibleCount] = useState(25);

  // Memoized so the `|| []` fallback keeps a stable identity between renders.
  const all = useMemo(() => orders || [], [orders]);

  const stats = useMemo(() => {
    const open = all.filter(o => ['Pending', 'Confirmed', 'Processing'].includes(o.status)).length;
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const monthOrders = all.filter(o => {
      const ms = getTimestampMs(o.createdAt);
      return ms >= startOfMonth.getTime() && !['Cancelled', 'Refunded'].includes(o.status);
    });
    const revenue = monthOrders.reduce((s, o) => s + toAll(o.total || 0, o.currency), 0);
    const avg = monthOrders.length ? revenue / monthOrders.length : 0;
    return { open, revenue, avg, monthCount: monthOrders.length };
  }, [all]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all.filter(o => {
      if (statusFilter !== ALL && o.status !== statusFilter) return false;
      if (paymentFilter !== ALL && (o.paymentStatus || 'Unpaid') !== paymentFilter) return false;
      if (!q) return true;
      return [o.orderNumber, o.customerName, o.customerEmail, o.customerPhone, o.trackingNumber]
        .some(v => (v || '').toLowerCase().includes(q));
    });
  }, [all, search, statusFilter, paymentFilter]);

  const visible = filtered.slice(0, visibleCount);

  // ── Fulfilment: decrement stock exactly once per order ──
  const applyStock = async (order: ShopOrder) => {
    if (order.stockApplied) return;
    const allocations = allocationsForOrder(order.items || [], products || []);
    for (const alloc of allocations) {
      const product = (products || []).find(p => p.id === alloc.productId);
      if (!product) continue;
      const { patch, balanceAfter } = applyStockToProduct(product, alloc.variantId, 'sale', alloc.quantity);
      await productMutation.update(product.id, patch as any);
      await movementMutation.create({
        productId: product.id,
        productName: product.name,
        variantId: alloc.variantId,
        variantLabel: alloc.variantLabel,
        type: 'sale',
        quantity: alloc.quantity,
        balanceAfter,
        reference: order.orderNumber,
        shopOrderId: order.id,
      } as any);
    }
    // stockApplied is the idempotency guard — set it even when nothing was tracked,
    // so re-confirming an order can never double-decrement.
    await orderMutation.update(order.id, { stockApplied: true } as any);
  };

  const changeStatus = async (order: ShopOrder, status: ShopOrderStatus) => {
    setBusy(true);
    try {
      const patch: Partial<ShopOrder> = { status };
      if (status === 'Shipped') patch.shippedAt = new Date();
      if (status === 'Delivered') patch.deliveredAt = new Date();
      if (status === 'Cancelled') patch.cancelledAt = new Date();
      if (status === 'Refunded') patch.paymentStatus = 'Refunded';
      await orderMutation.update(order.id, patch as any);
      // Confirming is the point of no return for inventory.
      if (status === 'Confirmed') await applyStock(order);
      setSelected(prev => (prev && prev.id === order.id ? { ...prev, ...patch } as ShopOrder : prev));
      toast({ title: `Porosia ${order.orderNumber}`, description: STATUS_META[status].label });
    } catch (err: any) {
      toast({ title: 'Ndryshimi dështoi', description: err?.message, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const markPaid = async (order: ShopOrder) => {
    setBusy(true);
    try {
      await orderMutation.update(order.id, { paymentStatus: 'Paid' } as any);
      setSelected(prev => (prev && prev.id === order.id ? { ...prev, paymentStatus: 'Paid' } : prev));
      toast({ title: 'Shënuar si e paguar', description: order.orderNumber });
    } finally {
      setBusy(false);
    }
  };

  const convertToInvoice = async (order: ShopOrder) => {
    if (order.invoiceId) {
      toast({ title: 'Fatura ekziston', description: 'Kjo porosi është faturuar më parë.' });
      return;
    }
    setBusy(true);
    try {
      // Written as inline lineItems (the same shape WHMCS-mirrored invoices use), so
      // InvoicesView renders it without needing an invoiceItems subcollection.
      const created = await invoiceMutation.create({
        customerId: order.customerId,
        amount: order.total,
        total: order.total,
        subtotal: order.subtotal,
        tax: order.taxTotal,
        discount: order.discountTotal,
        currency: (order.currency === 'ALL' || order.currency === 'EUR' ? order.currency : 'ALL'),
        status: order.paymentStatus === 'Paid' ? 'Paid' : 'Pending',
        invoiceDate: new Date(),
        notes: `Porosi ${order.orderNumber}`,
        lineItems: (order.items || []).map(i => ({
          description: [i.name, i.variantLabel].filter(Boolean).join(' · ') + ` × ${i.quantity}`,
          amount: i.total,
          type: 'product',
        })),
        productSummary: (order.items || []).map(i => i.name).join(', ').slice(0, 200),
      } as any);
      await orderMutation.update(order.id, { invoiceId: (created as any).id } as any);
      setSelected(prev => (prev && prev.id === order.id ? { ...prev, invoiceId: (created as any).id } : prev));
      toast({ title: 'Fatura u krijua', description: `Nga porosia ${order.orderNumber}` });
    } catch (err: any) {
      toast({ title: 'Faturimi dështoi', description: err?.message, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const createOrder = async (input: {
    customerId?: string;
    items: ShopOrderItem[];
    currency: ShopOrder['currency'];
    shipping: number;
    orderDiscount: number;
    notes?: string;
  }) => {
    const customer = (customers || []).find(c => c.id === input.customerId);
    const totals = computeOrderTotals(input.items, { shipping: input.shipping, orderDiscount: input.orderDiscount });
    await orderMutation.create({
      orderNumber: nextOrderNumber(all.map(o => o.orderNumber), new Date().getFullYear()),
      customerId: input.customerId,
      customerName: customer?.name,
      customerEmail: (customer as any)?.email,
      customerPhone: (customer as any)?.phoneNumber || (customer as any)?.phone,
      items: input.items,
      currency: input.currency,
      subtotal: totals.subtotal,
      discountTotal: totals.discountTotal,
      taxTotal: totals.taxTotal,
      shippingTotal: totals.shippingTotal,
      total: totals.total,
      status: 'Pending',
      paymentStatus: 'Unpaid',
      source: 'staff',
      notes: input.notes,
    } as any);
    toast({ title: 'Porosia u krijua' });
  };

  if (loading) return <SkeletonLoader />;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm" className="px-2">
              <Link to="/app/products"><ArrowLeft className="w-4 h-4" /></Link>
            </Button>
            <h1 className="text-h2 text-foreground">Porositë</h1>
          </div>
          <p className="text-body text-muted-foreground mt-1">{all.length} porosi gjithsej</p>
        </div>
        {canEdit && (
          <Button className="bg-primary text-primary-foreground" onClick={() => setCreateOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />Porosi e Re
          </Button>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Të hapura</p>
          <p className="text-xl font-bold text-foreground">{stats.open}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Porosi këtë muaj</p>
          <p className="text-xl font-bold text-foreground">{stats.monthCount}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Xhiro këtë muaj</p>
          <p className="text-xl font-bold text-foreground">{formatCurrency(stats.revenue, 'ALL')}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Vlera mesatare</p>
          <p className="text-xl font-bold text-foreground">{formatCurrency(stats.avg, 'ALL')}</p>
        </Card>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => { setSearch(e.target.value); setVisibleCount(25); }}
            placeholder="Kërko nr. porosie, klient, tracking…"
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={v => { setStatusFilter(v); setVisibleCount(25); }}>
          <SelectTrigger className="sm:w-[170px]"><SelectValue placeholder="Statusi" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Të gjitha statuset</SelectItem>
            {(Object.keys(STATUS_META) as ShopOrderStatus[]).map(s => (
              <SelectItem key={s} value={s}>{STATUS_META[s].label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={paymentFilter} onValueChange={v => { setPaymentFilter(v); setVisibleCount(25); }}>
          <SelectTrigger className="sm:w-[160px]"><SelectValue placeholder="Pagesa" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Çdo pagesë</SelectItem>
            {Object.keys(PAYMENT_META).map(s => (
              <SelectItem key={s} value={s}>{PAYMENT_META[s].label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {filtered.length === 0 ? (
        <Card className="p-12 text-center">
          <ShoppingCart className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
          <p className="text-body text-foreground mb-1">Pa porosi</p>
          <p className="text-body-sm text-muted-foreground">
            Porositë e klientëve nga portali shfaqen automatikisht këtu.
          </p>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Nr.</th>
                  <th className="text-left px-3 py-2 font-medium">Klienti</th>
                  <th className="text-left px-3 py-2 font-medium hidden md:table-cell">Data</th>
                  <th className="text-left px-3 py-2 font-medium">Artikuj</th>
                  <th className="text-left px-3 py-2 font-medium">Totali</th>
                  <th className="text-left px-3 py-2 font-medium">Statusi</th>
                  <th className="text-left px-3 py-2 font-medium hidden sm:table-cell">Pagesa</th>
                </tr>
              </thead>
              <tbody>
                {visible.map(o => (
                  <tr
                    key={o.id}
                    onClick={() => setSelected(o)}
                    className="border-t hover:bg-muted/30 cursor-pointer"
                  >
                    <td className="px-3 py-2 font-medium text-foreground whitespace-nowrap">{o.orderNumber}</td>
                    <td className="px-3 py-2">
                      <p className="text-foreground truncate max-w-[180px]">{o.customerName || '—'}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {o.source === 'portal' ? 'Portal' : 'Back-office'}
                      </p>
                    </td>
                    <td className="px-3 py-2 hidden md:table-cell text-muted-foreground whitespace-nowrap">
                      {fmtDate(o.createdAt)}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {(o.items || []).reduce((n, i) => n + (i.quantity || 0), 0)}
                    </td>
                    <td className="px-3 py-2 font-semibold text-foreground whitespace-nowrap">
                      {formatCurrency(o.total || 0, o.currency)}
                    </td>
                    <td className="px-3 py-2">
                      <Badge className={STATUS_META[o.status]?.cls}>{STATUS_META[o.status]?.label || o.status}</Badge>
                    </td>
                    <td className="px-3 py-2 hidden sm:table-cell">
                      <Badge className={PAYMENT_META[o.paymentStatus || 'Unpaid']?.cls}>
                        {PAYMENT_META[o.paymentStatus || 'Unpaid']?.label}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {filtered.length > visibleCount && (
        <div className="text-center">
          <Button variant="outline" onClick={() => setVisibleCount(c => c + 25)}>
            Shfaq më shumë ({filtered.length - visibleCount})
          </Button>
        </div>
      )}

      {/* ── Order detail ── */}
      <Dialog open={!!selected} onOpenChange={o => { if (!o) setSelected(null); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 flex-wrap">
                  Porosia {selected.orderNumber}
                  <Badge className={STATUS_META[selected.status]?.cls}>{STATUS_META[selected.status]?.label}</Badge>
                  <Badge className={PAYMENT_META[selected.paymentStatus || 'Unpaid']?.cls}>
                    {PAYMENT_META[selected.paymentStatus || 'Unpaid']?.label}
                  </Badge>
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground flex items-center gap-1 mb-1">
                      <UserIcon className="w-3 h-3" />Klienti
                    </p>
                    <p className="text-sm font-medium text-foreground">{selected.customerName || '—'}</p>
                    {selected.customerEmail && <p className="text-xs text-muted-foreground">{selected.customerEmail}</p>}
                    {selected.customerPhone && <p className="text-xs text-muted-foreground">{selected.customerPhone}</p>}
                    {selected.customerId && (
                      <Link to={`/app/customers/${selected.customerId}`} className="text-xs text-primary hover:underline">
                        Hap kartelën →
                      </Link>
                    )}
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground flex items-center gap-1 mb-1">
                      <Truck className="w-3 h-3" />Dërgesa
                    </p>
                    {selected.shippingAddress ? (
                      <p className="text-sm text-foreground">
                        {[selected.shippingAddress.line1, selected.shippingAddress.city, selected.shippingAddress.country]
                          .filter(Boolean).join(', ') || '—'}
                      </p>
                    ) : <p className="text-sm text-muted-foreground">Pa adresë</p>}
                    {selected.trackingNumber && (
                      <p className="text-xs text-muted-foreground">Tracking: {selected.trackingNumber}</p>
                    )}
                    <p className="text-xs text-muted-foreground">Krijuar: {fmtDate(selected.createdAt)}</p>
                  </div>
                </div>

                <div className="rounded-lg border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-xs text-muted-foreground">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium">Artikulli</th>
                        <th className="text-left px-3 py-2 font-medium">Sasia</th>
                        <th className="text-left px-3 py-2 font-medium">Çmimi</th>
                        <th className="text-right px-3 py-2 font-medium">Totali</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(selected.items || []).map((item, i) => (
                        <tr key={`${item.productId}-${item.variantId || i}`} className="border-t">
                          <td className="px-3 py-2">
                            <p className="text-foreground">{item.name}</p>
                            {item.variantLabel && <p className="text-[11px] text-muted-foreground">{item.variantLabel}</p>}
                            {item.sku && <p className="text-[11px] text-muted-foreground">{item.sku}</p>}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">{item.quantity}</td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {formatCurrency(item.unitPrice, selected.currency)}
                          </td>
                          <td className="px-3 py-2 text-right font-medium text-foreground">
                            {formatCurrency(item.total, selected.currency)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="space-y-1 text-sm">
                  <div className="flex justify-between"><span className="text-muted-foreground">Nëntotali</span><span>{formatCurrency(selected.subtotal || 0, selected.currency)}</span></div>
                  {!!selected.discountTotal && <div className="flex justify-between text-success"><span>Zbritje</span><span>-{formatCurrency(selected.discountTotal, selected.currency)}</span></div>}
                  {!!selected.taxTotal && <div className="flex justify-between"><span className="text-muted-foreground">TVSH</span><span>{formatCurrency(selected.taxTotal, selected.currency)}</span></div>}
                  {!!selected.shippingTotal && <div className="flex justify-between"><span className="text-muted-foreground">Transporti</span><span>{formatCurrency(selected.shippingTotal, selected.currency)}</span></div>}
                  <div className="flex justify-between pt-1 border-t font-semibold text-foreground">
                    <span>Totali</span><span>{formatCurrency(selected.total || 0, selected.currency)}</span>
                  </div>
                </div>

                {selected.notes && (
                  <div className="rounded-lg border p-3 bg-muted/20">
                    <p className="text-xs text-muted-foreground mb-1">Shënime nga klienti</p>
                    <p className="text-sm text-foreground whitespace-pre-wrap">{selected.notes}</p>
                  </div>
                )}

                {selected.stockApplied && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <PackageCheck className="w-3.5 h-3.5 text-success" />Stoku është zbritur për këtë porosi.
                  </p>
                )}

                {canEdit && (
                  <div className="flex flex-wrap gap-2 pt-2 border-t">
                    {(NEXT_STATUS[selected.status] || []).map(next => (
                      <Button
                        key={next}
                        size="sm"
                        variant={next === 'Cancelled' ? 'outline' : 'default'}
                        disabled={busy}
                        onClick={() => changeStatus(selected, next)}
                        className={next === 'Cancelled' ? '' : 'bg-primary text-primary-foreground'}
                      >
                        {busy && <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />}
                        {next === 'Cancelled' ? <Ban className="w-3.5 h-3.5 mr-1" /> : <CheckCircle2 className="w-3.5 h-3.5 mr-1" />}
                        {STATUS_META[next].label}
                      </Button>
                    ))}
                    {selected.paymentStatus !== 'Paid' && selected.status !== 'Cancelled' && (
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => markPaid(selected)}>
                        <Receipt className="w-3.5 h-3.5 mr-1" />Shëno paguar
                      </Button>
                    )}
                    {selected.invoiceId ? (
                      <Button asChild size="sm" variant="outline">
                        <Link to="/app/invoices"><FileText className="w-3.5 h-3.5 mr-1" />Shiko faturën</Link>
                      </Button>
                    ) : (
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => convertToInvoice(selected)}>
                        <FileText className="w-3.5 h-3.5 mr-1" />Krijo faturë
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <NewOrderDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        products={products || []}
        customers={customers || []}
        onSubmit={createOrder}
      />
    </div>
  );
};

// ── Manual order entry (back office) ────────────────────────────────────────

interface Line { productId: string; variantId?: string; quantity: number }

const NewOrderDialog: React.FC<{
  open: boolean;
  onOpenChange: (o: boolean) => void;
  products: Product[];
  customers: Customer[];
  onSubmit: (input: {
    customerId?: string;
    items: ShopOrderItem[];
    currency: ShopOrder['currency'];
    shipping: number;
    orderDiscount: number;
    notes?: string;
  }) => Promise<void>;
}> = ({ open, onOpenChange, products, customers, onSubmit }) => {
  const { toast } = useToast();
  const [customerId, setCustomerId] = useState(NONE);
  const [lines, setLines] = useState<Line[]>([]);
  const [shipping, setShipping] = useState('');
  const [discount, setDiscount] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const sellable = useMemo(
    () => products.filter(p => p.status !== 'Archived').sort((a, b) => a.name.localeCompare(b.name, 'sq')),
    [products],
  );

  React.useEffect(() => {
    if (!open) return;
    setCustomerId(NONE); setLines([]); setShipping(''); setDiscount(''); setNotes('');
  }, [open]);

  // All lines must share one currency — the order total has a single currency field.
  const currency = (products.find(p => p.id === lines[0]?.productId)?.currency || 'ALL') as ShopOrder['currency'];
  const mixedCurrency = lines.some(l => {
    const p = products.find(x => x.id === l.productId);
    return p && (p.currency || 'ALL') !== currency;
  });

  const items: ShopOrderItem[] = useMemo(
    () => lines.flatMap(l => {
      const product = products.find(p => p.id === l.productId);
      if (!product) return [];
      const variant = l.variantId ? product.variants?.find(v => v.id === l.variantId) : undefined;
      return [buildOrderItem(product, variant, l.quantity)];
    }),
    [lines, products],
  );

  const totals = computeOrderTotals(items, {
    shipping: Number(shipping) || 0,
    orderDiscount: Number(discount) || 0,
  });

  const stockWarnings = useMemo(
    () => lines.flatMap(l => {
      const product = products.find(p => p.id === l.productId);
      if (!product) return [];
      const variant = l.variantId ? product.variants?.find(v => v.id === l.variantId) : undefined;
      const res = canFulfill(product, variant, l.quantity);
      return res.ok ? [] : [`${product.name}: ${res.reason}`];
    }),
    [lines, products],
  );

  const submit = async () => {
    if (!items.length) {
      toast({ title: 'Pa artikuj', description: 'Shto të paktën një produkt.', variant: 'destructive' });
      return;
    }
    if (mixedCurrency) {
      toast({ title: 'Monedha të përziera', description: 'Të gjithë artikujt duhet të kenë të njëjtën monedhë.', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      await onSubmit({
        customerId: customerId === NONE ? undefined : customerId,
        items,
        currency,
        shipping: Number(shipping) || 0,
        orderDiscount: Number(discount) || 0,
        notes: notes.trim() || undefined,
      });
      onOpenChange(false);
    } catch (err: any) {
      toast({ title: 'Krijimi dështoi', description: err?.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Porosi e Re</DialogTitle></DialogHeader>

        <div className="space-y-4">
          <div>
            <Label className="text-xs">Klienti</Label>
            <Select value={customerId} onValueChange={setCustomerId}>
              <SelectTrigger><SelectValue placeholder="Zgjidh klientin" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Pa klient (shitje banaku)</SelectItem>
                {customers.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Artikujt</Label>
              <Button type="button" size="sm" variant="outline"
                onClick={() => setLines([...lines, { productId: sellable[0]?.id || '', quantity: 1 }])}
                disabled={!sellable.length}>
                <Plus className="w-4 h-4 mr-1" />Artikull
              </Button>
            </div>

            {lines.length === 0 && (
              <p className="text-xs text-muted-foreground italic flex items-center gap-1">
                <Package className="w-3.5 h-3.5" />Pa artikuj deri tani.
              </p>
            )}

            {lines.map((line, i) => {
              const product = products.find(p => p.id === line.productId);
              const variants = product?.variants || [];
              const optionNames = (product?.options || []).map(o => o.name);
              return (
                <div key={i} className="grid grid-cols-12 gap-2 items-end">
                  <div className="col-span-6 sm:col-span-5">
                    <Select
                      value={line.productId}
                      onValueChange={v => setLines(lines.map((l, j) => (j === i ? { productId: v, quantity: l.quantity } : l)))}
                    >
                      <SelectTrigger className="h-9"><SelectValue placeholder="Produkt" /></SelectTrigger>
                      <SelectContent>
                        {sellable.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-6 sm:col-span-4">
                    {variants.length > 0 ? (
                      <Select
                        value={line.variantId || ''}
                        onValueChange={v => setLines(lines.map((l, j) => (j === i ? { ...l, variantId: v } : l)))}
                      >
                        <SelectTrigger className="h-9"><SelectValue placeholder="Varianti" /></SelectTrigger>
                        <SelectContent>
                          {variants.filter(v => v.isActive !== false).map(v => (
                            <SelectItem key={v.id} value={v.id}>
                              {variantLabel(v.optionValues, optionNames) || v.sku || v.id}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <p className="text-xs text-muted-foreground h-9 flex items-center px-1">
                        {formatCurrency(product?.price || 0, product?.currency || 'ALL')}
                      </p>
                    )}
                  </div>
                  <div className="col-span-8 sm:col-span-2">
                    <Input
                      type="number" min="1" step="1" value={line.quantity}
                      onChange={e => setLines(lines.map((l, j) => (j === i ? { ...l, quantity: Math.max(1, Number(e.target.value) || 1) } : l)))}
                      className="h-9"
                    />
                  </div>
                  <div className="col-span-4 sm:col-span-1 flex justify-end">
                    <Button type="button" size="sm" variant="ghost"
                      onClick={() => setLines(lines.filter((_, j) => j !== i))} aria-label="Hiq artikullin">
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>

          {stockWarnings.length > 0 && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2 space-y-0.5">
              {stockWarnings.map(w => <p key={w} className="text-xs text-amber-700 dark:text-amber-300">{w}</p>)}
            </div>
          )}
          {mixedCurrency && (
            <p className="text-xs text-destructive">Artikujt kanë monedha të ndryshme — porosia mban vetëm një monedhë.</p>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Transporti ({currency})</Label>
              <Input type="number" min="0" step="0.01" value={shipping} onChange={e => setShipping(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Zbritje ({currency})</Label>
              <Input type="number" min="0" step="0.01" value={discount} onChange={e => setDiscount(e.target.value)} />
            </div>
          </div>

          <div>
            <Label className="text-xs">Shënime</Label>
            <Textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
          </div>

          <div className="rounded-lg border p-3 space-y-1 text-sm bg-muted/20">
            <div className="flex justify-between"><span className="text-muted-foreground">Nëntotali</span><span>{formatCurrency(totals.subtotal, currency)}</span></div>
            {!!totals.discountTotal && <div className="flex justify-between text-success"><span>Zbritje</span><span>-{formatCurrency(totals.discountTotal, currency)}</span></div>}
            {!!totals.taxTotal && <div className="flex justify-between"><span className="text-muted-foreground">TVSH</span><span>{formatCurrency(totals.taxTotal, currency)}</span></div>}
            {!!totals.shippingTotal && <div className="flex justify-between"><span className="text-muted-foreground">Transporti</span><span>{formatCurrency(totals.shippingTotal, currency)}</span></div>}
            <div className="flex justify-between pt-1 border-t font-semibold text-foreground">
              <span>Totali</span><span>{formatCurrency(totals.total, currency)}</span>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Anulo</Button>
          <Button onClick={submit} disabled={saving || !items.length} className="bg-primary text-primary-foreground">
            {saving && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}Krijo porosinë
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ShopOrdersView;
