import React, { useEffect, useMemo, useState } from 'react';
import { collection, doc, setDoc, Timestamp } from 'firebase/firestore';
import {
  CheckCircle2, ChevronRight, Image as ImageIcon, Loader2, Minus, Package,
  PackageX, Plus, Search, ShoppingBag, ShoppingCart, Trash2, X,
} from 'lucide-react';
import { db } from '../../lib/firebase';
import { Card } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Textarea } from '../../components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { CardGridSkeleton } from './PortalSkeletons';
import { useAuth } from '../../contexts/AuthContext';
import { useClientPortal } from '../../hooks/useClientPortal';
import { useCollection } from '../../hooks/useFirestore';
import { useToast } from '../../hooks/use-toast';
import { formatCurrency, getTimestampMs, sanitizeHtml } from '../../lib/utils';
import { buildOrderItem, computeOrderTotals, discountPercent, grossUnitPrice } from '../../lib/shop/pricing';
import { canFulfill, stockState } from '../../lib/shop/inventory';
import { activeVariants, variantLabel } from '../../lib/shop/variants';
import { isPortalVisible, primaryImage } from '../../lib/shop/product';
import type {
  Product, ProductCategory, ProductVariant, ShopOrder, ShopOrderItem,
} from '../../types';

const ALL = '__all__';

interface CartLine {
  productId: string;
  variantId?: string;
  quantity: number;
}

const cartKey = (customerId: string | null) => `portal_cart_${customerId || 'anon'}`;

/**
 * Human-facing reference for a portal order, e.g. `POR-20260918-x7Kq2M`.
 *
 * It deliberately does NOT use `nextOrderNumber()`: a portal client can only read
 * their OWN orders (and must not be able to read anyone else's), so a sequence
 * derived from that list restarts at 0001 for every client — two clients ordering
 * in the same year produced the same number, which is also the stock movement's
 * `reference`. The Firestore document id is the uniqueness guarantee here; its
 * last six base62 characters are carried into the label, CASE INCLUDED — lower-
 * casing them would throw away half the entropy the id provides.
 *
 * Back-office numbering is untouched: `POR-<year>-<seq>` still parses, this shape
 * does not, so the staff sequence stays contiguous.
 */
function portalOrderNumber(docId: string, now: Date): string {
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const suffix = (docId || '').slice(-6) || String(now.getTime()).slice(-6);
  return `POR-${stamp}-${suffix}`;
}

const STATUS_LABELS: Record<string, string> = {
  Pending: 'Në pritje',
  Confirmed: 'Konfirmuar',
  Processing: 'Në përgatitje',
  Shipped: 'Dërguar',
  Delivered: 'Dorëzuar',
  Cancelled: 'Anuluar',
  Refunded: 'Rimbursuar',
};

/**
 * Client-facing shop. Reads only products this tenant published
 * (`businessId == mine && visibleInPortal`), then filters to Active client-side —
 * a Draft product can never reach a client even if the flag was left on.
 *
 * Orders are written with a direct setDoc (not useMutation) because portal users
 * have no global teamId; the tenant keys are resolved the same way
 * useStartInquiry does.
 *
 * The money this file writes is the CLIENT'S OWN ARITHMETIC and is therefore a
 * quote, not a price: the browser is not a trust boundary. ShopOrdersView
 * re-prices a `source: 'portal'` order from the live catalog before it bills it,
 * and never reads `paymentStatus` from here. Keep it that way — nothing in this
 * file may be the only thing standing between a client and a 0 L settled invoice.
 */
const PortalShopView: React.FC = () => {
  const { user } = useAuth();
  const { customerId, businessId, teamId: portalTeamId } = useClientPortal();
  const { toast } = useToast();

  const { data: rawProducts, loading } = useCollection<Product>('products', {
    skip: !businessId,
    where: [
      { field: 'businessId', operator: '==', value: businessId || '' },
      { field: 'visibleInPortal', operator: '==', value: true },
    ],
    skipTeamFilter: true,
  });
  const { data: categories } = useCollection<ProductCategory>('productCategories', {
    skip: !businessId,
    where: [{ field: 'businessId', operator: '==', value: businessId || '' }],
    skipTeamFilter: true,
  });
  const { data: myOrders } = useCollection<ShopOrder>('shopOrders', {
    skip: !customerId,
    where: [{ field: 'customerId', operator: '==', value: customerId || '' }],
    skipTeamFilter: true,
  });

  // Portal users have no active team — useClientPortal resolves the tenant's team
  // (from their own customer record / the subdomain tenant), so the order satisfies
  // the rules that require a teamId string. NOTE: reading `teamMembers` here would be
  // a cross-tenant read of another business's staff — never do that from the portal.
  const resolvedTeamId = portalTeamId || null;

  const products = useMemo(() => (rawProducts || []).filter(isPortalVisible), [rawProducts]);

  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState(ALL);
  const [detail, setDetail] = useState<Product | null>(null);
  const [detailVariantId, setDetailVariantId] = useState<string | undefined>();
  const [detailQty, setDetailQty] = useState(1);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [placedNumber, setPlacedNumber] = useState<string | null>(null);
  const [address, setAddress] = useState({ fullName: '', phone: '', line1: '', city: '', postalCode: '', country: 'Shqipëri' });
  const [notes, setNotes] = useState('');

  // Restore the cart per customer so a page reload doesn't lose it.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(cartKey(customerId));
      if (raw) setCart(JSON.parse(raw));
    } catch { /* ignore */ }
  }, [customerId]);

  useEffect(() => {
    try { localStorage.setItem(cartKey(customerId), JSON.stringify(cart)); } catch { /* ignore */ }
  }, [cart, customerId]);

  useEffect(() => {
    if (!detail) return;
    const variants = activeVariants(detail);
    setDetailVariantId(variants[0]?.id);
    setDetailQty(Math.max(1, detail.minOrderQty || 1));
  }, [detail]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter(p => {
      if (categoryFilter !== ALL && p.categoryId !== categoryFilter) return false;
      if (!q) return true;
      return [p.name, p.shortDescription, p.brandName, ...(p.tags || [])]
        .some(v => (v || '').toLowerCase().includes(q));
    }).sort((a, b) => Number(!!b.featured) - Number(!!a.featured));
  }, [products, search, categoryFilter]);

  const usedCategories = useMemo(
    () => (categories || []).filter(c => products.some(p => p.categoryId === c.id)),
    [categories, products],
  );

  const cartItems: ShopOrderItem[] = useMemo(
    () => cart.flatMap(line => {
      const product = products.find(p => p.id === line.productId);
      if (!product) return [];
      const variant = line.variantId ? product.variants?.find(v => v.id === line.variantId) : undefined;
      return [buildOrderItem(product, variant, line.quantity)];
    }),
    [cart, products],
  );

  const currency = (products.find(p => p.id === cart[0]?.productId)?.currency || 'ALL') as ShopOrder['currency'];
  const totals = computeOrderTotals(cartItems);
  const cartCount = cart.reduce((n, l) => n + l.quantity, 0);

  const addToCart = (product: Product, variant: ProductVariant | undefined, quantity: number) => {
    const check = canFulfill(product, variant, quantity);
    if (!check.ok) {
      toast({ title: 'Nuk mund të shtohet', description: check.reason, variant: 'destructive' });
      return;
    }
    // A cart holds one currency, because the order document holds one.
    if (cart.length && (product.currency || 'ALL') !== currency) {
      toast({
        title: 'Monedhë e ndryshme',
        description: 'Përfundo porosinë aktuale përpara se të shtosh produkte me monedhë tjetër.',
        variant: 'destructive',
      });
      return;
    }
    setCart(prev => {
      const i = prev.findIndex(l => l.productId === product.id && l.variantId === variant?.id);
      if (i === -1) return [...prev, { productId: product.id, variantId: variant?.id, quantity }];
      const next = [...prev];
      next[i] = { ...next[i], quantity: next[i].quantity + quantity };
      return next;
    });
    toast({ title: 'U shtua në shportë', description: product.name });
    setDetail(null);
  };

  const setQty = (index: number, quantity: number) => {
    setCart(prev => prev.map((l, i) => (i === index ? { ...l, quantity: Math.max(1, quantity) } : l)));
  };

  const placeOrder = async () => {
    if (!cartItems.length) return;
    if (!customerId) {
      toast({ title: 'Profili nuk u zgjidh', description: 'Rifresko faqen dhe provo përsëri.', variant: 'destructive' });
      return;
    }
    setPlacing(true);
    try {
      // Reserve the id BEFORE building the payload: the order number is derived
      // from it, so the reference can never collide with another client's.
      const orderRef = doc(collection(db, 'shopOrders'));
      const orderNumber = portalOrderNumber(orderRef.id, new Date());
      const payload = {
        orderNumber,
        customerId,
        customerName: address.fullName.trim() || user?.displayName || user?.email || 'Klient',
        customerEmail: user?.email || undefined,
        customerPhone: address.phone.trim() || undefined,
        items: cartItems,
        currency,
        subtotal: totals.subtotal,
        discountTotal: totals.discountTotal,
        taxTotal: totals.taxTotal,
        shippingTotal: totals.shippingTotal,
        total: totals.total,
        status: 'Pending' as const,
        paymentStatus: 'Unpaid' as const,
        source: 'portal' as const,
        shippingAddress: {
          fullName: address.fullName.trim() || undefined,
          phone: address.phone.trim() || undefined,
          line1: address.line1.trim() || undefined,
          city: address.city.trim() || undefined,
          postalCode: address.postalCode.trim() || undefined,
          country: address.country.trim() || undefined,
        },
        notes: notes.trim() || undefined,
        ...(resolvedTeamId ? { teamId: resolvedTeamId } : {}),
        // Stamp the tenant or the order falls outside the staff business-scoped
        // queries and would never appear in the back office.
        ...(businessId ? { businessId } : {}),
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
        createdByUserId: user?.uid || null,
      };
      const clean = Object.fromEntries(Object.entries(payload).filter(([, v]) => v !== undefined));
      await setDoc(orderRef, clean);
      setCart([]);
      setNotes('');
      setPlacedNumber(orderNumber);
    } catch {
      toast({
        title: 'Porosia dështoi',
        description: 'Provo përsëri ose shkruaj në chat me ekipin.',
        variant: 'destructive',
      });
    } finally {
      setPlacing(false);
    }
  };

  const detailVariant = detail ? activeVariants(detail).find(v => v.id === detailVariantId) : undefined;
  const detailState = detail ? stockState(detail, detailVariant) : 'untracked';

  if (loading) return <CardGridSkeleton />;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-h2 text-foreground">Dyqani</h1>
          <p className="text-body text-muted-foreground mt-1">{products.length} produkte të disponueshme</p>
        </div>
        <Button className="bg-primary text-primary-foreground relative" onClick={() => setCartOpen(true)}>
          <ShoppingCart className="w-4 h-4 mr-2" />Shporta
          {cartCount > 0 && (
            <Badge className="ml-2 bg-background text-primary">{cartCount}</Badge>
          )}
        </Button>
      </div>

      {products.length > 0 && (
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Kërko produkt…" className="pl-9" />
          </div>
          {usedCategories.length > 0 && (
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="sm:w-[200px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Të gjitha kategoritë</SelectItem>
                {usedCategories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
        </div>
      )}

      {filtered.length === 0 ? (
        <Card className="p-12 text-center">
          <ShoppingBag className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
          <p className="text-body text-foreground mb-1">
            {products.length === 0 ? 'Dyqani është bosh për momentin' : 'Asnjë produkt nuk përputhet'}
          </p>
          <p className="text-body-sm text-muted-foreground">
            {products.length === 0
              ? 'Ekipi po përgatit katalogun. Kontrollo më vonë.'
              : 'Provo një kërkim tjetër.'}
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map(p => {
            const img = primaryImage(p);
            const disc = discountPercent(p);
            const state = stockState(p);
            const soldOut = state === 'out' && p.stockPolicy !== 'backorder' && p.stockPolicy !== 'preorder';
            return (
              <Card
                key={p.id}
                className={`overflow-hidden flex flex-col transition-shadow hover:shadow-md ${p.featured ? 'ring-2 ring-primary/40' : ''}`}
              >
                <button
                  type="button"
                  onClick={() => setDetail(p)}
                  className="relative h-40 bg-muted flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  aria-label={`Shiko ${p.name}`}
                >
                  {img
                    ? <img src={img} alt={p.name} className="w-full h-full object-cover" loading="lazy" />
                    : <ImageIcon className="w-8 h-8 text-muted-foreground" />}
                  {p.featured && <Badge className="absolute top-2 left-2 bg-primary text-primary-foreground">Më e zgjedhura</Badge>}
                  {disc != null && <Badge className="absolute top-2 right-2 bg-success text-white">-{disc}%</Badge>}
                  {soldOut && (
                    <div className="absolute inset-0 bg-background/70 flex items-center justify-center">
                      <span className="text-sm font-medium text-foreground flex items-center gap-1">
                        <PackageX className="w-4 h-4" />Pa stok
                      </span>
                    </div>
                  )}
                </button>
                <div className="p-3 space-y-2 flex-1 flex flex-col">
                  <div className="min-w-0">
                    <h3 className="font-semibold text-foreground truncate" title={p.name}>{p.name}</h3>
                    {p.shortDescription && (
                      <p className="text-xs text-muted-foreground line-clamp-2">{p.shortDescription}</p>
                    )}
                  </div>
                  <div className="mt-auto space-y-2">
                    <div className="flex items-baseline gap-2">
                      <span className="text-lg font-bold text-foreground">
                        {formatCurrency(grossUnitPrice(p), p.currency || 'ALL')}
                      </span>
                      {p.compareAtPrice && p.compareAtPrice > p.price && (
                        <span className="text-xs text-muted-foreground line-through">
                          {formatCurrency(p.compareAtPrice, p.currency || 'ALL')}
                        </span>
                      )}
                      {p.unit && <span className="text-[11px] text-muted-foreground">/{p.unit}</span>}
                    </div>
                    <Button className="w-full" size="sm" disabled={soldOut} onClick={() => setDetail(p)}>
                      {soldOut ? 'Pa stok' : <>Shiko & shto<ChevronRight className="w-3.5 h-3.5 ml-1" /></>}
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* ── My orders ── */}
      {(myOrders?.length || 0) > 0 && (
        <Card className="p-4">
          <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
            <Package className="w-4 h-4 text-primary" />Porositë e mia
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="text-left py-1.5 font-medium">Nr.</th>
                  <th className="text-left py-1.5 font-medium">Data</th>
                  <th className="text-left py-1.5 font-medium">Totali</th>
                  <th className="text-left py-1.5 font-medium">Statusi</th>
                </tr>
              </thead>
              <tbody>
                {[...(myOrders || [])]
                  .sort((a, b) => getTimestampMs(b.createdAt) - getTimestampMs(a.createdAt))
                  .slice(0, 10)
                  .map(o => (
                    <tr key={o.id} className="border-t">
                      <td className="py-2 pr-2 font-medium text-foreground">{o.orderNumber}</td>
                      <td className="py-2 pr-2 text-muted-foreground">
                        {getTimestampMs(o.createdAt)
                          ? new Date(getTimestampMs(o.createdAt)).toLocaleDateString('sq-AL', { day: 'numeric', month: 'short', year: 'numeric' })
                          : '—'}
                      </td>
                      <td className="py-2 pr-2 text-foreground">{formatCurrency(o.total || 0, o.currency)}</td>
                      <td className="py-2 pr-2">
                        <Badge variant="outline">{STATUS_LABELS[o.status] || o.status}</Badge>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ── Product detail ── */}
      <Dialog open={!!detail} onOpenChange={o => { if (!o) setDetail(null); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          {detail && (
            <>
              <DialogHeader><DialogTitle>{detail.name}</DialogTitle></DialogHeader>
              <div className="space-y-4">
                {(detail.images?.length || 0) > 0 && (
                  <div className="grid grid-cols-3 gap-2">
                    {detail.images!.slice(0, 6).map(img => (
                      <img key={img.url} src={img.url} alt={img.alt || detail.name}
                        className="w-full h-24 object-cover rounded-md border" loading="lazy" />
                    ))}
                  </div>
                )}

                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="text-2xl font-bold text-foreground">
                    {formatCurrency(grossUnitPrice(detail, detailVariant, detailQty), detail.currency || 'ALL')}
                  </span>
                  {detail.compareAtPrice && detail.compareAtPrice > detail.price && (
                    <span className="text-sm text-muted-foreground line-through">
                      {formatCurrency(detail.compareAtPrice, detail.currency || 'ALL')}
                    </span>
                  )}
                  <Badge variant="outline">
                    {detailState === 'out' ? 'Pa stok' : detailState === 'low' ? 'Sasi e limituar' : 'Në stok'}
                  </Badge>
                </div>

                {detail.shortDescription && <p className="text-sm text-foreground">{detail.shortDescription}</p>}

                {activeVariants(detail).length > 0 && (
                  <div>
                    <Label className="text-xs">Varianti</Label>
                    <Select value={detailVariantId} onValueChange={setDetailVariantId}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {activeVariants(detail).map(v => (
                          <SelectItem key={v.id} value={v.id}>
                            {variantLabel(v.optionValues, (detail.options || []).map(o => o.name)) || v.sku || v.id}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {(detail.priceTiers?.length || 0) > 0 && (
                  <div className="rounded-lg border p-3 bg-muted/20">
                    <p className="text-xs font-medium text-muted-foreground mb-1">Çmime me shumicë</p>
                    {detail.priceTiers!.map((t, i) => (
                      <p key={i} className="text-xs text-foreground">
                        Nga {t.minQty} {detail.unit || 'copë'} → {formatCurrency(t.unitPrice, detail.currency || 'ALL')}/njësi
                      </p>
                    ))}
                  </div>
                )}

                <div className="flex items-center gap-3">
                  <Label className="text-xs">Sasia</Label>
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="outline" onClick={() => setDetailQty(q => Math.max(1, q - 1))} aria-label="Ul sasinë">
                      <Minus className="w-3.5 h-3.5" />
                    </Button>
                    <Input
                      type="number" min="1" value={detailQty}
                      onChange={e => setDetailQty(Math.max(1, Number(e.target.value) || 1))}
                      className="h-9 w-20 text-center"
                    />
                    <Button size="sm" variant="outline" onClick={() => setDetailQty(q => q + 1)} aria-label="Shto sasinë">
                      <Plus className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                  <Button
                    className="ml-auto bg-primary text-primary-foreground"
                    onClick={() => addToCart(detail, detailVariant, detailQty)}
                  >
                    <ShoppingCart className="w-4 h-4 mr-2" />Shto në shportë
                  </Button>
                </div>

                {detail.description && (
                  <div
                    className="text-sm text-muted-foreground prose prose-sm max-w-none dark:prose-invert"
                    dangerouslySetInnerHTML={{ __html: sanitizeHtml(detail.description) }}
                  />
                )}

                {(detail.attributes?.length || 0) > 0 && (
                  <div className="rounded-lg border overflow-hidden">
                    <table className="w-full text-sm">
                      <tbody>
                        {detail.attributes!.filter(a => a.name).map((a, i) => (
                          <tr key={i} className="border-t first:border-0">
                            <td className="px-3 py-1.5 text-muted-foreground w-1/3">{a.name}</td>
                            <td className="px-3 py-1.5 text-foreground">{a.value}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {!!detail.warrantyMonths && (
                  <p className="text-xs text-muted-foreground">Garanci: {detail.warrantyMonths} muaj</p>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Cart / checkout ── */}
      <Dialog open={cartOpen} onOpenChange={o => { setCartOpen(o); if (!o) setPlacedNumber(null); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Shporta</DialogTitle></DialogHeader>

          {placedNumber ? (
            <div className="py-6 text-center space-y-3">
              <CheckCircle2 className="w-12 h-12 mx-auto text-emerald-500" />
              <p className="text-body text-foreground">Porosia <strong>{placedNumber}</strong> u dërgua!</p>
              <p className="text-body-sm text-muted-foreground">
                Ekipi do t'ju kontaktojë për konfirmim dhe pagesë.
              </p>
              <Button onClick={() => { setCartOpen(false); setPlacedNumber(null); }}>Mbyll</Button>
            </div>
          ) : cart.length === 0 ? (
            <div className="py-10 text-center">
              <ShoppingCart className="w-10 h-10 mx-auto text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">Shporta është bosh.</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                {cart.map((line, i) => {
                  const product = products.find(p => p.id === line.productId);
                  const item = cartItems.find(
                    it => it.productId === line.productId && it.variantId === line.variantId,
                  );
                  if (!product || !item) {
                    return (
                      <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
                        Produkti nuk është më i disponueshëm.
                        <Button size="sm" variant="ghost" onClick={() => setCart(cart.filter((_, j) => j !== i))}>
                          <X className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    );
                  }
                  return (
                    <div key={`${line.productId}-${line.variantId || ''}`} className="flex items-center gap-2 py-2 border-b last:border-0">
                      <div className="w-10 h-10 rounded-md bg-muted shrink-0 overflow-hidden flex items-center justify-center">
                        {item.imageUrl
                          ? <img src={item.imageUrl} alt="" className="w-full h-full object-cover" />
                          : <ImageIcon className="w-4 h-4 text-muted-foreground" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground truncate">{item.name}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {item.variantLabel ? `${item.variantLabel} · ` : ''}
                          {formatCurrency(item.unitPrice, currency)}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button size="sm" variant="ghost" onClick={() => setQty(i, line.quantity - 1)} aria-label="Ul sasinë">
                          <Minus className="w-3.5 h-3.5" />
                        </Button>
                        <span className="text-sm w-6 text-center">{line.quantity}</span>
                        <Button size="sm" variant="ghost" onClick={() => setQty(i, line.quantity + 1)} aria-label="Shto sasinë">
                          <Plus className="w-3.5 h-3.5" />
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setCart(cart.filter((_, j) => j !== i))} aria-label="Hiq">
                          <Trash2 className="w-3.5 h-3.5 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="space-y-1 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Nëntotali</span><span>{formatCurrency(totals.subtotal, currency)}</span></div>
                {!!totals.taxTotal && <div className="flex justify-between"><span className="text-muted-foreground">TVSH</span><span>{formatCurrency(totals.taxTotal, currency)}</span></div>}
                <div className="flex justify-between pt-1 border-t font-semibold text-foreground">
                  <span>Totali</span><span>{formatCurrency(totals.total, currency)}</span>
                </div>
                <p className="text-[11px] text-muted-foreground">Transporti konfirmohet nga ekipi.</p>
              </div>

              <div className="rounded-lg border p-3 space-y-3 bg-muted/20">
                <p className="text-xs font-medium text-muted-foreground">Adresa e dërgesës</p>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">Emri i plotë</Label>
                    <Input value={address.fullName} onChange={e => setAddress(a => ({ ...a, fullName: e.target.value }))} className="h-9" />
                  </div>
                  <div>
                    <Label className="text-xs">Telefoni</Label>
                    <Input value={address.phone} onChange={e => setAddress(a => ({ ...a, phone: e.target.value }))} className="h-9" />
                  </div>
                </div>
                <div>
                  <Label className="text-xs">Adresa</Label>
                  <Input value={address.line1} onChange={e => setAddress(a => ({ ...a, line1: e.target.value }))} className="h-9" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">Qyteti</Label>
                    <Input value={address.city} onChange={e => setAddress(a => ({ ...a, city: e.target.value }))} className="h-9" />
                  </div>
                  <div>
                    <Label className="text-xs">Kodi postar</Label>
                    <Input value={address.postalCode} onChange={e => setAddress(a => ({ ...a, postalCode: e.target.value }))} className="h-9" />
                  </div>
                </div>
                <div>
                  <Label className="text-xs">Shënime</Label>
                  <Textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Orari i dorëzimit, kati…" />
                </div>
              </div>

              <Button
                className="w-full bg-primary text-primary-foreground"
                onClick={placeOrder}
                disabled={placing || !cartItems.length}
              >
                {placing && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Dërgo porosinë · {formatCurrency(totals.total, currency)}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default PortalShopView;
