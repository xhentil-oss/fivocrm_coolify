import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Archive, Copy, Download, Eye, EyeOff, Filter, Grid3x3, Image as ImageIcon, LayoutList,
  Package, PackageCheck, Pencil, Plus, Search, ShoppingCart, SlidersHorizontal, Trash2,
  TrendingUp, Upload, X,
} from 'lucide-react';
import { Card } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Checkbox } from '../components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '../components/ui/alert-dialog';
import { SkeletonLoader } from '../components/PageSkeleton';
import ProductFormDialog from '../components/shop/ProductFormDialog';
import ProductImportDialog from '../components/shop/ProductImportDialog';
import CatalogTaxonomyPanel from '../components/shop/CatalogTaxonomyPanel';
import InventoryLedger from '../components/shop/InventoryLedger';
import StockAdjustDialog from '../components/shop/StockAdjustDialog';
import { useCollection, useMutation } from '../hooks/useFirestore';
import { usePermissions } from '../contexts/PermissionsContext';
import { useToast } from '../hooks/use-toast';
import { formatCurrency, toAll } from '../lib/utils';
import { discountPercent, marginPercent } from '../lib/shop/pricing';
import { applyStockToProduct, stockState, totalStock } from '../lib/shop/inventory';
import {
  PRODUCT_CSV_HEADERS, PRODUCT_STATUS_LABELS, primaryImage, productFromCsvRow,
  productHaystack, productToCsvRow, uniqueSlug, validateProduct,
} from '../lib/shop/product';
import { saveOrShareFile } from '../lib/native';
import type {
  Product, ProductBrand, ProductCategory, StockMovement, StockMovementType,
} from '../types';

const ALL = '__all__';

const STATUS_STYLES: Record<string, string> = {
  Draft: 'bg-muted text-muted-foreground',
  Active: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  Archived: 'bg-gray-200 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
};

const STOCK_STYLES: Record<string, string> = {
  in_stock: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  low: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  out: 'bg-destructive/10 text-destructive',
  untracked: 'bg-muted text-muted-foreground',
};

const STOCK_LABELS: Record<string, string> = {
  in_stock: 'Në stok',
  low: 'Stok i ulët',
  out: 'Pa stok',
  untracked: 'Pa gjurmim',
};

/** Fields never copied onto a new document (Firestore/audit-owned). */
const stripMeta = (product: Product) => {
  const {
    id: _id, createdAt: _createdAt, updatedAt: _updatedAt,
    createdByUserId: _createdBy, teamId: _teamId, businessId: _businessId,
    ...rest
  } = product as any;
  return rest as Partial<Product>;
};

const ProductsView: React.FC = () => {
  const permissions = usePermissions();
  const { toast } = useToast();
  const canEdit = permissions.canEdit === true;

  const { data: products, loading } = useCollection<Product>('products', {
    orderBy: { field: 'createdAt', direction: 'desc' },
  });
  const { data: categories } = useCollection<ProductCategory>('productCategories', {
    orderBy: { field: 'name', direction: 'asc' },
  });
  const { data: brands } = useCollection<ProductBrand>('productBrands', {
    orderBy: { field: 'name', direction: 'asc' },
  });
  const { data: movements } = useCollection<StockMovement>('stockMovements', {
    orderBy: { field: 'createdAt', direction: 'desc' },
  });

  const productMutation = useMutation<Product>('products');
  const categoryMutation = useMutation<ProductCategory>('productCategories');
  const brandMutation = useMutation<ProductBrand>('productBrands');
  const movementMutation = useMutation<StockMovement>('stockMovements');

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState(ALL);
  const [categoryFilter, setCategoryFilter] = useState(ALL);
  const [brandFilter, setBrandFilter] = useState(ALL);
  const [stockFilter, setStockFilter] = useState(ALL);
  const [sortBy, setSortBy] = useState<'recent' | 'name' | 'price' | 'stock'>('recent');
  const [showFilters, setShowFilters] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'table'>(() => {
    try { return (localStorage.getItem('products_view') as 'grid' | 'table') || 'table'; } catch { return 'table'; }
  });
  const [visibleCount, setVisibleCount] = useState(24);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [stockTarget, setStockTarget] = useState<Product | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);

  // Memoized so the `|| []` fallback doesn't produce a new array each render and
  // invalidate every downstream useMemo.
  const all = useMemo(() => products || [], [products]);

  const setView = (mode: 'grid' | 'table') => {
    setViewMode(mode);
    try { localStorage.setItem('products_view', mode); } catch { /* ignore */ }
  };

  // ── Derived KPIs ──
  const stats = useMemo(() => {
    const active = all.filter(p => p.status === 'Active').length;
    const inPortal = all.filter(p => p.visibleInPortal && p.status === 'Active').length;
    const lowOrOut = all.filter(p => {
      const s = stockState(p);
      return s === 'low' || s === 'out';
    }).length;
    // Normalized to ALL so a mixed-currency catalog totals correctly.
    const retail = all.reduce((sum, p) => sum + toAll(p.price || 0, p.currency) * (p.trackInventory ? totalStock(p) : 0), 0);
    return { total: all.length, active, inPortal, lowOrOut, retail };
  }, [all]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let items = all.filter(p => {
      if (q && !productHaystack(p).includes(q)) return false;
      if (statusFilter !== ALL && (p.status || 'Draft') !== statusFilter) return false;
      if (categoryFilter !== ALL && p.categoryId !== categoryFilter) return false;
      if (brandFilter !== ALL && p.brandId !== brandFilter) return false;
      if (stockFilter !== ALL && stockState(p) !== stockFilter) return false;
      return true;
    });
    items = [...items].sort((a, b) => {
      switch (sortBy) {
        case 'name': return (a.name || '').localeCompare(b.name || '', 'sq');
        case 'price': return toAll(b.price || 0, b.currency) - toAll(a.price || 0, a.currency);
        case 'stock': return totalStock(a) - totalStock(b);
        default: return 0; // already createdAt desc from the query
      }
    });
    return items;
  }, [all, search, statusFilter, categoryFilter, brandFilter, stockFilter, sortBy]);

  const visible = filtered.slice(0, visibleCount);
  const activeFilters = [statusFilter, categoryFilter, brandFilter, stockFilter].filter(f => f !== ALL).length;

  const clearFilters = () => {
    setStatusFilter(ALL); setCategoryFilter(ALL); setBrandFilter(ALL); setStockFilter(ALL); setSearch('');
  };

  // ── Writes ──
  const saveProduct = async (draft: Partial<Product>) => {
    const errors = validateProduct(draft);
    if (errors.length) throw new Error(errors[0]);

    const slug = draft.slug || uniqueSlug(
      draft.name || '',
      all.filter(p => p.id !== editing?.id).map(p => p.slug),
    );
    const payload: Partial<Product> = {
      ...draft,
      slug,
      // publishedAt is set the first time a product goes Active, never reset.
      ...(draft.status === 'Active' && !editing?.publishedAt ? { publishedAt: new Date() } : {}),
    };

    if (editing) {
      await productMutation.update(editing.id, payload as any);
      toast({ title: 'Produkti u përditësua', description: draft.name });
    } else {
      await productMutation.create(payload as any);
      toast({ title: 'Produkti u krijua', description: draft.name });
    }
    setEditing(null);
  };

  const duplicate = async (product: Product) => {
    try {
      const copy = stripMeta(product);
      const name = `${product.name} (kopje)`;
      await productMutation.create({
        ...copy,
        name,
        slug: uniqueSlug(name, all.map(p => p.slug)),
        // A copy must never inherit live visibility, stock or a sales history —
        // it's a different physical item that nobody has counted yet.
        status: 'Draft',
        visibleInPortal: false,
        sku: product.sku ? `${product.sku}-COPY` : undefined,
        stockQty: 0,
        variants: (product.variants || []).map(v => ({ ...v, stockQty: 0, sku: v.sku ? `${v.sku}-COPY` : undefined })),
        soldCount: 0,
        publishedAt: undefined,
      } as any);
      toast({ title: 'Produkti u kopjua', description: name });
    } catch (err: any) {
      toast({ title: 'Kopjimi dështoi', description: err?.message, variant: 'destructive' });
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await productMutation.remove(deleteTarget.id);
      toast({ title: 'Produkti u fshi', description: deleteTarget.name });
    } catch (err: any) {
      toast({ title: 'Fshirja dështoi', description: err?.message, variant: 'destructive' });
    } finally {
      setDeleteTarget(null);
    }
  };

  const recordMovement = async (input: {
    product: Product;
    variantId?: string;
    type: StockMovementType;
    quantity: number;
    reason?: string;
    reference?: string;
    unitCost?: number;
  }) => {
    const { patch, balanceAfter } = applyStockToProduct(input.product, input.variantId, input.type, input.quantity);
    // Stock first, ledger second: a failed ledger write leaves stock correct and
    // visibly un-audited, which is recoverable. The reverse would double-count.
    await productMutation.update(input.product.id, patch as any);
    await movementMutation.create({
      productId: input.product.id,
      productName: input.product.name,
      variantId: input.variantId,
      type: input.type,
      quantity: input.quantity,
      balanceAfter,
      reason: input.reason,
      reference: input.reference,
      unitCost: input.unitCost,
      warehouse: input.product.warehouse,
    } as any);
    toast({ title: 'Lëvizja u regjistrua', description: `${input.product.name} → ${balanceAfter}` });
  };

  // ── Bulk actions ──
  const toggleSelect = (id: string) => setSelectedIds(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const clearSelection = () => setSelectedIds(new Set());

  const bulkPatch = async (patch: Partial<Product>, label: string) => {
    const ids = [...selectedIds];
    const res = await Promise.allSettled(ids.map(id => productMutation.update(id, patch as any)));
    const failed = res.filter(r => r.status === 'rejected').length;
    toast(failed
      ? { title: `${ids.length - failed}/${ids.length} u përditësuan`, description: `${failed} dështuan.`, variant: 'destructive' }
      : { title: `${ids.length} produkte: ${label}` });
    clearSelection();
  };

  const bulkDelete = async () => {
    const ids = [...selectedIds];
    const res = await Promise.allSettled(ids.map(id => productMutation.remove(id)));
    const failed = res.filter(r => r.status === 'rejected').length;
    toast(failed
      ? { title: `${ids.length - failed}/${ids.length} u fshinë`, variant: 'destructive' }
      : { title: `${ids.length} produkte u fshinë` });
    clearSelection();
    setBulkDeleteOpen(false);
  };

  // ── CSV ──
  const exportCsv = async () => {
    const esc = (v: any) => {
      let s = String(v ?? '');
      // Neutralize spreadsheet formula injection before quoting.
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [
      PRODUCT_CSV_HEADERS.join(','),
      ...filtered.map(p => productToCsvRow(p).map(esc).join(',')),
    ];
    const csv = '\ufeff' + lines.join('\n'); // BOM so Excel reads UTF-8
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    await saveOrShareFile(blob, `produkte-${new Date().toISOString().slice(0, 10)}.csv`);
  };

  const importRows = async (rows: Record<string, any>[]) => {
    let created = 0, skipped = 0, errors = 0;
    const existingSkus = new Set(all.map(p => (p.sku || '').toLowerCase()).filter(Boolean));
    const slugs = all.map(p => p.slug);
    for (const row of rows) {
      const draft = productFromCsvRow(row);
      const sku = (draft.sku || '').toLowerCase();
      if (sku && existingSkus.has(sku)) { skipped += 1; continue; }
      if (validateProduct(draft).length) { errors += 1; continue; }
      try {
        const slug = uniqueSlug(draft.name || '', slugs);
        slugs.push(slug);
        // Match the category/brand by name so imported rows join the taxonomy.
        const category = categories?.find(c => c.name.toLowerCase() === (draft.categoryName || '').toLowerCase());
        const brand = brands?.find(b => b.name.toLowerCase() === (draft.brandName || '').toLowerCase());
        await productMutation.create({
          ...draft,
          slug,
          ...(category ? { categoryId: category.id, categoryName: category.name } : {}),
          ...(brand ? { brandId: brand.id, brandName: brand.name } : {}),
        } as any);
        if (sku) existingSkus.add(sku);
        created += 1;
      } catch {
        errors += 1;
      }
    }
    return { created, skipped, errors };
  };

  // ── Taxonomy writes ──
  const createCategory = async (name: string) => {
    const ref = await categoryMutation.create({ name, slug: uniqueSlug(name, (categories || []).map(c => c.slug)) } as any);
    return (ref as any)?.id as string | undefined;
  };
  const renameCategory = async (id: string, name: string) => {
    await categoryMutation.update(id, { name } as any);
    // Keep the denormalized categoryName on products in sync.
    const affected = all.filter(p => p.categoryId === id);
    await Promise.allSettled(affected.map(p => productMutation.update(p.id, { categoryName: name } as any)));
  };
  const createBrand = async (name: string) => {
    const ref = await brandMutation.create({ name } as any);
    return (ref as any)?.id as string | undefined;
  };
  const renameBrand = async (id: string, name: string) => {
    await brandMutation.update(id, { name } as any);
    const affected = all.filter(p => p.brandId === id);
    await Promise.allSettled(affected.map(p => productMutation.update(p.id, { brandName: name } as any)));
  };

  if (loading) return <SkeletonLoader />;

  const renderPrice = (p: Product) => {
    const disc = discountPercent(p);
    const margin = marginPercent(p);
    return (
      <div className="flex flex-col">
        <span className="font-semibold text-foreground">{formatCurrency(p.price || 0, p.currency || 'ALL')}</span>
        <span className="text-[11px] text-muted-foreground">
          {disc != null && <span className="text-success mr-1.5">-{disc}%</span>}
          {margin != null && <span>marzh {margin}%</span>}
        </span>
      </div>
    );
  };

  const renderStockBadge = (p: Product) => {
    const state = stockState(p);
    return (
      <Badge className={STOCK_STYLES[state]}>
        {state === 'untracked' ? STOCK_LABELS[state] : `${totalStock(p)} · ${STOCK_LABELS[state]}`}
      </Badge>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-h2 text-foreground">Dyqani & Produktet</h1>
          <p className="text-body text-muted-foreground mt-1">
            {stats.total} produkte · {stats.inPortal} në portal
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" className="flex-1 sm:flex-none">
            <Link to="/app/shop-orders"><ShoppingCart className="w-4 h-4 mr-2" />Porositë</Link>
          </Button>
          {canEdit && (
            <>
              <Button variant="outline" onClick={() => setImportOpen(true)}>
                <Upload className="w-4 h-4 mr-2" />Importo
              </Button>
              <Button variant="outline" onClick={exportCsv} disabled={filtered.length === 0}>
                <Download className="w-4 h-4 mr-2" />Eksporto
              </Button>
              <Button
                className="bg-primary text-primary-foreground flex-1 sm:flex-none"
                onClick={() => { setEditing(null); setFormOpen(true); }}
              >
                <Plus className="w-4 h-4 mr-2" />Produkt i Ri
              </Button>
            </>
          )}
        </div>
      </div>

      <Tabs defaultValue="catalog" className="space-y-4">
        <TabsList className="bg-muted w-full overflow-x-auto flex-nowrap justify-start sm:justify-center">
          <TabsTrigger value="catalog" className="min-w-fit"><Package className="w-4 h-4 sm:mr-2" /><span className="hidden sm:inline">Katalogu</span></TabsTrigger>
          <TabsTrigger value="inventory" className="min-w-fit"><PackageCheck className="w-4 h-4 sm:mr-2" /><span className="hidden sm:inline">Inventari</span></TabsTrigger>
          <TabsTrigger value="taxonomy" className="min-w-fit"><SlidersHorizontal className="w-4 h-4 sm:mr-2" /><span className="hidden sm:inline">Kategoritë & Markat</span></TabsTrigger>
        </TabsList>

        {/* ── Katalogu ── */}
        <TabsContent value="catalog" className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Card className="p-4">
              <p className="text-xs text-muted-foreground">Gjithsej</p>
              <p className="text-xl font-bold text-foreground">{stats.total}</p>
            </Card>
            <Card className="p-4">
              <p className="text-xs text-muted-foreground">Aktive</p>
              <p className="text-xl font-bold text-foreground">{stats.active}</p>
            </Card>
            <Card className="p-4">
              <p className="text-xs text-muted-foreground">Stok i ulët / pa stok</p>
              <p className={`text-xl font-bold ${stats.lowOrOut ? 'text-amber-600 dark:text-amber-400' : 'text-foreground'}`}>
                {stats.lowOrOut}
              </p>
            </Card>
            <Card className="p-4">
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <TrendingUp className="w-3 h-3" />Vlera e stokut
              </p>
              <p className="text-xl font-bold text-foreground">{formatCurrency(stats.retail, 'ALL')}</p>
            </Card>
          </div>

          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={e => { setSearch(e.target.value); setVisibleCount(24); }}
                placeholder="Kërko emër, SKU, barkod, etiketë…"
                className="pl-9"
              />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setShowFilters(v => !v)}>
                <Filter className="w-4 h-4 mr-2" />Filtra
                {activeFilters > 0 && <Badge className="ml-2 bg-primary text-primary-foreground">{activeFilters}</Badge>}
              </Button>
              <Button variant="outline" size="icon" onClick={() => setView(viewMode === 'grid' ? 'table' : 'grid')}
                aria-label={viewMode === 'grid' ? 'Shfaq si tabelë' : 'Shfaq si kartela'}>
                {viewMode === 'grid' ? <LayoutList className="w-4 h-4" /> : <Grid3x3 className="w-4 h-4" />}
              </Button>
            </div>
          </div>

          {showFilters && (
            <Card className="p-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
                <Select value={statusFilter} onValueChange={v => { setStatusFilter(v); setVisibleCount(24); }}>
                  <SelectTrigger><SelectValue placeholder="Statusi" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>Të gjitha statuset</SelectItem>
                    {Object.entries(PRODUCT_STATUS_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={categoryFilter} onValueChange={v => { setCategoryFilter(v); setVisibleCount(24); }}>
                  <SelectTrigger><SelectValue placeholder="Kategoria" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>Të gjitha kategoritë</SelectItem>
                    {(categories || []).map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={brandFilter} onValueChange={v => { setBrandFilter(v); setVisibleCount(24); }}>
                  <SelectTrigger><SelectValue placeholder="Marka" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>Të gjitha markat</SelectItem>
                    {(brands || []).map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={stockFilter} onValueChange={v => { setStockFilter(v); setVisibleCount(24); }}>
                  <SelectTrigger><SelectValue placeholder="Stoku" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>Çdo stok</SelectItem>
                    {Object.entries(STOCK_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={sortBy} onValueChange={v => setSortBy(v as any)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="recent">Më të rejat</SelectItem>
                    <SelectItem value="name">Emri A–Z</SelectItem>
                    <SelectItem value="price">Çmimi (i lartë)</SelectItem>
                    <SelectItem value="stock">Stoku (i ulët)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {activeFilters > 0 && (
                <button onClick={clearFilters} className="text-xs text-primary hover:underline mt-2">
                  Pastro filtrat
                </button>
              )}
            </Card>
          )}

          {filtered.length === 0 ? (
            <Card className="p-12 text-center">
              <Package className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
              <p className="text-body text-foreground mb-1">
                {all.length === 0 ? 'Pa produkte' : 'Asnjë produkt nuk përputhet'}
              </p>
              <p className="text-body-sm text-muted-foreground mb-4">
                {all.length === 0
                  ? 'Shto produktin e parë ose importo katalogun nga CSV.'
                  : 'Provo të pastrosh filtrat.'}
              </p>
              {all.length === 0
                ? canEdit && (
                  <Button onClick={() => { setEditing(null); setFormOpen(true); }}>
                    <Plus className="w-4 h-4 mr-2" />Produkt i Ri
                  </Button>
                )
                : <Button variant="outline" onClick={clearFilters}>Pastro filtrat</Button>}
            </Card>
          ) : viewMode === 'grid' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {visible.map(p => {
                const img = primaryImage(p);
                return (
                  <Card key={p.id} className="overflow-hidden flex flex-col">
                    <div className="relative h-36 bg-muted flex items-center justify-center">
                      {img
                        ? <img src={img} alt={p.name} className="w-full h-full object-cover" loading="lazy" />
                        : <ImageIcon className="w-8 h-8 text-muted-foreground" />}
                      <div className="absolute top-2 left-2 flex gap-1">
                        <Badge className={STATUS_STYLES[p.status || 'Draft']}>
                          {PRODUCT_STATUS_LABELS[p.status || 'Draft']}
                        </Badge>
                        {p.visibleInPortal && p.status === 'Active' && (
                          <Badge className="bg-primary/10 text-primary"><Eye className="w-3 h-3" /></Badge>
                        )}
                      </div>
                      {canEdit && (
                        <div className="absolute top-2 right-2">
                          <Checkbox
                            checked={selectedIds.has(p.id)}
                            onCheckedChange={() => toggleSelect(p.id)}
                            aria-label={`Zgjidh ${p.name}`}
                            className="bg-background"
                          />
                        </div>
                      )}
                    </div>
                    <div className="p-3 space-y-2 flex-1 flex flex-col">
                      <div className="min-w-0">
                        <h3 className="font-semibold text-foreground truncate" title={p.name}>{p.name}</h3>
                        <p className="text-xs text-muted-foreground truncate">
                          {[p.sku, p.categoryName, p.brandName].filter(Boolean).join(' · ') || '—'}
                        </p>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        {renderPrice(p)}
                        {renderStockBadge(p)}
                      </div>
                      {canEdit && (
                        <div className="flex gap-1 pt-2 mt-auto border-t">
                          <Button size="sm" variant="ghost" onClick={() => { setEditing(p); setFormOpen(true); }} aria-label="Ndrysho">
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setStockTarget(p)} aria-label="Stok">
                            <SlidersHorizontal className="w-3.5 h-3.5" />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => duplicate(p)} aria-label="Kopjo">
                            <Copy className="w-3.5 h-3.5" />
                          </Button>
                          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setDeleteTarget(p)} aria-label="Fshi">
                            <Trash2 className="w-3.5 h-3.5 text-destructive" />
                          </Button>
                        </div>
                      )}
                    </div>
                  </Card>
                );
              })}
            </div>
          ) : (
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs text-muted-foreground">
                    <tr>
                      {canEdit && (
                        <th className="px-3 py-2 w-8">
                          <Checkbox
                            checked={visible.length > 0 && visible.every(p => selectedIds.has(p.id))}
                            onCheckedChange={v => setSelectedIds(v ? new Set(visible.map(p => p.id)) : new Set())}
                            aria-label="Zgjidh të gjithë"
                          />
                        </th>
                      )}
                      <th className="text-left px-3 py-2 font-medium">Produkti</th>
                      <th className="text-left px-3 py-2 font-medium hidden md:table-cell">Kategoria</th>
                      <th className="text-left px-3 py-2 font-medium">Çmimi</th>
                      <th className="text-left px-3 py-2 font-medium">Stoku</th>
                      <th className="text-left px-3 py-2 font-medium hidden sm:table-cell">Statusi</th>
                      {canEdit && <th className="px-3 py-2" />}
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map(p => {
                      const img = primaryImage(p);
                      return (
                        <tr key={p.id} className="border-t hover:bg-muted/30">
                          {canEdit && (
                            <td className="px-3 py-2">
                              <Checkbox
                                checked={selectedIds.has(p.id)}
                                onCheckedChange={() => toggleSelect(p.id)}
                                aria-label={`Zgjidh ${p.name}`}
                              />
                            </td>
                          )}
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <div className="w-9 h-9 rounded-md bg-muted shrink-0 overflow-hidden flex items-center justify-center">
                                {img
                                  ? <img src={img} alt="" className="w-full h-full object-cover" loading="lazy" />
                                  : <ImageIcon className="w-4 h-4 text-muted-foreground" />}
                              </div>
                              <div className="min-w-0">
                                <p className="font-medium text-foreground truncate max-w-[220px]" title={p.name}>{p.name}</p>
                                <p className="text-[11px] text-muted-foreground truncate">
                                  {p.sku || '—'}
                                  {(p.variants?.length || 0) > 0 && ` · ${p.variants!.length} variante`}
                                </p>
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-2 hidden md:table-cell text-muted-foreground">
                            {p.categoryName || '—'}
                          </td>
                          <td className="px-3 py-2">{renderPrice(p)}</td>
                          <td className="px-3 py-2">{renderStockBadge(p)}</td>
                          <td className="px-3 py-2 hidden sm:table-cell">
                            <div className="flex items-center gap-1.5">
                              <Badge className={STATUS_STYLES[p.status || 'Draft']}>
                                {PRODUCT_STATUS_LABELS[p.status || 'Draft']}
                              </Badge>
                              <span title={p.visibleInPortal && p.status === 'Active' ? 'Në portal' : 'Jo në portal'}>
                                {p.visibleInPortal && p.status === 'Active'
                                  ? <Eye className="w-3.5 h-3.5 text-primary" />
                                  : <EyeOff className="w-3.5 h-3.5 text-muted-foreground" />}
                              </span>
                            </div>
                          </td>
                          {canEdit && (
                            <td className="px-3 py-2">
                              <div className="flex justify-end gap-1">
                                <Button size="sm" variant="ghost" onClick={() => { setEditing(p); setFormOpen(true); }} aria-label="Ndrysho">
                                  <Pencil className="w-3.5 h-3.5" />
                                </Button>
                                <Button size="sm" variant="ghost" onClick={() => setStockTarget(p)} aria-label="Stok">
                                  <SlidersHorizontal className="w-3.5 h-3.5" />
                                </Button>
                                <Button size="sm" variant="ghost" onClick={() => duplicate(p)} aria-label="Kopjo">
                                  <Copy className="w-3.5 h-3.5" />
                                </Button>
                                <Button size="sm" variant="ghost" onClick={() => setDeleteTarget(p)} aria-label="Fshi">
                                  <Trash2 className="w-3.5 h-3.5 text-destructive" />
                                </Button>
                              </div>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {filtered.length > visibleCount && (
            <div className="text-center">
              <Button variant="outline" onClick={() => setVisibleCount(c => c + 24)}>
                Shfaq më shumë ({filtered.length - visibleCount})
              </Button>
            </div>
          )}
        </TabsContent>

        {/* ── Inventari ── */}
        <TabsContent value="inventory">
          <InventoryLedger
            products={all}
            movements={movements || []}
            canEdit={canEdit}
            onAdjust={setStockTarget}
          />
        </TabsContent>

        {/* ── Kategoritë & Markat ── */}
        <TabsContent value="taxonomy">
          <CatalogTaxonomyPanel
            categories={categories || []}
            brands={brands || []}
            products={all}
            canEdit={canEdit}
            onCreateCategory={createCategory}
            onRenameCategory={renameCategory}
            onDeleteCategory={id => categoryMutation.remove(id)}
            onCreateBrand={createBrand}
            onRenameBrand={renameBrand}
            onDeleteBrand={id => brandMutation.remove(id)}
          />
        </TabsContent>
      </Tabs>

      {/* Floating bulk bar */}
      {selectedIds.size > 0 && canEdit && (
        <div className="fixed bottom-20 sm:bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-3 py-2 rounded-xl bg-card border shadow-lg flex-wrap max-w-[95vw]">
          <span className="text-sm font-medium px-1">{selectedIds.size} të zgjedhur</span>
          <Select onValueChange={v => bulkPatch({ status: v as Product['status'] }, `statusi ${v}`)}>
            <SelectTrigger className="h-8 w-[130px] text-xs"><SelectValue placeholder="Statusi" /></SelectTrigger>
            <SelectContent>
              {Object.entries(PRODUCT_STATUS_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" className="h-8 text-xs"
            onClick={() => bulkPatch({ visibleInPortal: true }, 'në portal')}>
            <Eye className="w-3.5 h-3.5 mr-1" />Publiko
          </Button>
          <Button size="sm" variant="outline" className="h-8 text-xs"
            onClick={() => bulkPatch({ visibleInPortal: false }, 'jashtë portalit')}>
            <EyeOff className="w-3.5 h-3.5 mr-1" />Hiq
          </Button>
          <Button size="sm" variant="outline" className="h-8 text-xs"
            onClick={() => bulkPatch({ status: 'Archived', visibleInPortal: false }, 'arkivuar')}>
            <Archive className="w-3.5 h-3.5 mr-1" />Arkivo
          </Button>
          <Button size="sm" variant="destructive" className="h-8 text-xs" onClick={() => setBulkDeleteOpen(true)}>
            <Trash2 className="w-3.5 h-3.5 mr-1" />Fshi
          </Button>
          <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={clearSelection}>
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
      )}

      <ProductFormDialog
        open={formOpen}
        onOpenChange={o => { setFormOpen(o); if (!o) setEditing(null); }}
        initial={editing}
        categories={categories || []}
        brands={brands || []}
        onSave={saveProduct}
        onCreateCategory={createCategory}
      />

      <ProductImportDialog open={importOpen} onClose={() => setImportOpen(false)} onImport={importRows} />

      <StockAdjustDialog
        open={!!stockTarget}
        onOpenChange={o => { if (!o) setStockTarget(null); }}
        product={stockTarget}
        onSubmit={recordMovement}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={o => { if (!o) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Fshi produktin?</AlertDialogTitle>
            <AlertDialogDescription>
              "{deleteTarget?.name}" do të fshihet përgjithmonë. Porositë e kaluara ruajnë çmimin dhe emrin,
              kështu që historiku nuk prishet. Për t'i hequr nga dyqani pa fshirë, përdor <strong>Arkivo</strong>.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Anulo</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground">
              Fshi
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Fshi {selectedIds.size} produkte?</AlertDialogTitle>
            <AlertDialogDescription>Ky veprim nuk kthehet.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Anulo</AlertDialogCancel>
            <AlertDialogAction onClick={bulkDelete} className="bg-destructive text-destructive-foreground">
              Fshi
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default ProductsView;
