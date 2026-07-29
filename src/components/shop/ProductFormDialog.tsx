import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle, Image as ImageIcon, Layers, Loader2, Package, Plus, Search,
  Settings2, Star, Tag, Trash2, Truck, Upload,
} from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import { Badge } from '../ui/badge';
import { Switch } from '../ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import RichTextEditor from '../RichTextEditor';
import VariantMatrixEditor from './VariantMatrixEditor';
import { useFileUpload } from '../../hooks/useFileUpload';
import { useToast } from '../../hooks/use-toast';
import { marginPercent, discountPercent, grossUnitPrice } from '../../lib/shop/pricing';
import { slugify, suggestSku, validateProduct } from '../../lib/shop/product';
import { formatCurrency } from '../../lib/utils';
import type {
  Product, ProductBrand, ProductCategory, ProductMedia, ProductOption,
  ProductPriceTier, ProductVariant,
} from '../../types';

const NONE = '__none__';
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const CURRENCIES: Product['currency'][] = ['ALL', 'EUR', 'USD', 'GBP'];
const UNITS = ['copë', 'kg', 'g', 'litër', 'm', 'm²', 'm³', 'orë', 'paketë', 'set'];

type Draft = Partial<Product>;

const emptyDraft = (): Draft => ({
  name: '',
  price: 0,
  currency: 'ALL',
  type: 'physical',
  status: 'Draft',
  visibleInPortal: false,
  requiresShipping: true,
  trackInventory: true,
  stockQty: 0,
  unit: 'copë',
  taxRatePercent: 20,
  taxIncluded: false,
  options: [],
  variants: [],
  images: [],
  attributes: [],
  priceTiers: [],
  tags: [],
});

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null → create mode. */
  initial: Product | null;
  categories: ProductCategory[];
  brands: ProductBrand[];
  onSave: (draft: Draft) => Promise<void>;
  onCreateCategory?: (name: string) => Promise<string | undefined>;
}

/** Number input → number | undefined, so an empty field never becomes 0. */
const numOrUndef = (raw: string): number | undefined => {
  if (raw === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
};

const Field: React.FC<{ label: string; hint?: string; children: React.ReactNode; className?: string }> = ({
  label, hint, children, className,
}) => (
  <div className={className}>
    <Label className="text-xs">{label}</Label>
    {children}
    {hint && <p className="text-[11px] text-muted-foreground mt-1">{hint}</p>}
  </div>
);

const ToggleRow: React.FC<{
  label: string; description?: string; checked: boolean; onChange: (v: boolean) => void;
}> = ({ label, description, checked, onChange }) => (
  <div className="flex items-start justify-between gap-3 rounded-md border p-3">
    <div className="min-w-0">
      <p className="text-sm font-medium text-foreground">{label}</p>
      {description && <p className="text-xs text-muted-foreground">{description}</p>}
    </div>
    <Switch checked={checked} onCheckedChange={onChange} />
  </div>
);

/**
 * The full product editor. Tabbed rather than one long scroll: a product carries
 * ~50 fields, and grouping them keeps each concern (price, stock, variants, media,
 * SEO) reviewable on its own. State is a single `draft` object so validation and
 * derived numbers (margin, gross price) recompute from one source.
 */
const ProductFormDialog: React.FC<Props> = ({
  open, onOpenChange, initial, categories, brands, onSave, onCreateCategory,
}) => {
  const { toast } = useToast();
  const { upload, uploading } = useFileUpload();
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState('general');
  const [showErrors, setShowErrors] = useState(false);
  const [newCategory, setNewCategory] = useState('');
  const [tagInput, setTagInput] = useState('');
  // Only auto-fill the slug while the user hasn't taken it over.
  const [slugTouched, setSlugTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDraft(initial ? { ...emptyDraft(), ...initial } : emptyDraft());
    setTab('general');
    setShowErrors(false);
    setSlugTouched(!!initial?.slug);
    setTagInput('');
    setNewCategory('');
  }, [open, initial]);

  const set = (patch: Draft) => setDraft(prev => ({ ...prev, ...patch }));

  const errors = useMemo(() => validateProduct(draft), [draft]);
  const price = Number(draft.price) || 0;
  const margin = marginPercent(draft as Product);
  const discount = discountPercent(draft as Product);
  const gross = grossUnitPrice(draft as Product);
  const currency = draft.currency || 'ALL';

  const handleName = (name: string) => {
    set({ name, ...(slugTouched ? {} : { slug: slugify(name) }) });
  };

  const addTag = () => {
    const raw = tagInput.trim();
    if (!raw) return;
    const incoming = raw.split(',').map(t => t.trim()).filter(Boolean);
    const merged = [...(draft.tags || [])];
    for (const t of incoming) if (!merged.some(e => e.toLowerCase() === t.toLowerCase())) merged.push(t);
    set({ tags: merged });
    setTagInput('');
  };

  const handleUpload = async (files: FileList | null) => {
    if (!files?.length) return;
    const accepted: ProductMedia[] = [];
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) {
        toast({ title: 'Vetëm imazhe', description: `${file.name} nuk është imazh.`, variant: 'destructive' });
        continue;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        toast({ title: 'Imazh shumë i madh', description: `${file.name} kalon 5MB.`, variant: 'destructive' });
        continue;
      }
      try {
        const res = await upload(file, 'products');
        accepted.push({ url: res.url, alt: draft.name || file.name, position: (draft.images?.length || 0) + accepted.length });
      } catch {
        toast({ title: 'Ngarkimi dështoi', description: file.name, variant: 'destructive' });
      }
    }
    if (accepted.length) {
      const images = [...(draft.images || []), ...accepted];
      // First image uploaded becomes the primary one automatically.
      if (!images.some(i => i.isPrimary)) images[0] = { ...images[0], isPrimary: true };
      set({ images });
    }
  };

  const setPrimaryImage = (url: string) => {
    set({ images: (draft.images || []).map(i => ({ ...i, isPrimary: i.url === url })) });
  };

  const removeImage = (url: string) => {
    const images = (draft.images || []).filter(i => i.url !== url);
    if (images.length && !images.some(i => i.isPrimary)) images[0] = { ...images[0], isPrimary: true };
    set({ images });
  };

  const patchTier = (index: number, patch: Partial<ProductPriceTier>) => {
    set({ priceTiers: (draft.priceTiers || []).map((t, i) => (i === index ? { ...t, ...patch } : t)) });
  };

  const patchAttribute = (index: number, patch: Partial<{ name: string; value: string }>) => {
    set({ attributes: (draft.attributes || []).map((a, i) => (i === index ? { ...a, ...patch } : a)) });
  };

  const handleCreateCategory = async () => {
    const name = newCategory.trim();
    if (!name || !onCreateCategory) return;
    const id = await onCreateCategory(name);
    if (id) set({ categoryId: id, categoryName: name });
    setNewCategory('');
  };

  const submit = async () => {
    if (errors.length) {
      setShowErrors(true);
      toast({ title: 'Kontrollo fushat', description: errors[0], variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      await onSave(draft);
      onOpenChange(false);
    } catch (err: any) {
      toast({ title: 'Ruajtja dështoi', description: err?.message || 'Provo përsëri.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const variantsPatch = (patch: { options?: ProductOption[]; variants?: ProductVariant[] }) => set(patch);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initial ? 'Ndrysho produktin' : 'Produkt i Ri'}</DialogTitle>
        </DialogHeader>

        {showErrors && errors.length > 0 && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 space-y-1">
            {errors.map(e => (
              <p key={e} className="text-xs text-destructive flex items-start gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />{e}
              </p>
            ))}
          </div>
        )}

        <Tabs value={tab} onValueChange={setTab} className="space-y-4">
          <TabsList className="bg-muted w-full overflow-x-auto flex-nowrap justify-start">
            <TabsTrigger value="general" className="min-w-fit"><Package className="w-4 h-4 sm:mr-1.5" /><span className="hidden sm:inline">Të përgjithshme</span></TabsTrigger>
            <TabsTrigger value="pricing" className="min-w-fit"><Tag className="w-4 h-4 sm:mr-1.5" /><span className="hidden sm:inline">Çmimi</span></TabsTrigger>
            <TabsTrigger value="inventory" className="min-w-fit"><Layers className="w-4 h-4 sm:mr-1.5" /><span className="hidden sm:inline">Inventari</span></TabsTrigger>
            <TabsTrigger value="variants" className="min-w-fit"><Settings2 className="w-4 h-4 sm:mr-1.5" /><span className="hidden sm:inline">Variantet</span></TabsTrigger>
            <TabsTrigger value="media" className="min-w-fit"><ImageIcon className="w-4 h-4 sm:mr-1.5" /><span className="hidden sm:inline">Fotot</span></TabsTrigger>
            <TabsTrigger value="shipping" className="min-w-fit"><Truck className="w-4 h-4 sm:mr-1.5" /><span className="hidden sm:inline">Transporti</span></TabsTrigger>
            <TabsTrigger value="seo" className="min-w-fit"><Search className="w-4 h-4 sm:mr-1.5" /><span className="hidden sm:inline">SEO</span></TabsTrigger>
          </TabsList>

          {/* ── Të përgjithshme ── */}
          <TabsContent value="general" className="space-y-4 mt-0">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Emri i produktit *" className="sm:col-span-2">
                <Input value={draft.name || ''} onChange={e => handleName(e.target.value)} placeholder="p.sh. Karrige Zyre Ergonomike" />
              </Field>
              <Field label="SKU" hint="Kodi unik i artikullit">
                <div className="flex gap-1.5">
                  <Input value={draft.sku || ''} onChange={e => set({ sku: e.target.value })} placeholder="KAR-ZYR" />
                  <Button type="button" variant="outline" size="sm" className="shrink-0"
                    onClick={() => set({ sku: suggestSku(draft.name || '') })} disabled={!draft.name}>
                    Auto
                  </Button>
                </div>
              </Field>
              <Field label="Barkod (EAN/UPC)">
                <Input value={draft.barcode || ''} onChange={e => set({ barcode: e.target.value })} placeholder="5901234123457" />
              </Field>
              <Field label="Tipi">
                <Select value={draft.type || 'physical'} onValueChange={v => set({ type: v as Product['type'] })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="physical">Fizik</SelectItem>
                    <SelectItem value="digital">Digjital</SelectItem>
                    <SelectItem value="service">Shërbim</SelectItem>
                    <SelectItem value="bundle">Paketë (bundle)</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Statusi">
                <Select value={draft.status || 'Draft'} onValueChange={v => set({ status: v as Product['status'] })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Draft">Draft</SelectItem>
                    <SelectItem value="Active">Aktiv</SelectItem>
                    <SelectItem value="Archived">Arkivuar</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Kategoria">
                <Select
                  value={draft.categoryId || NONE}
                  onValueChange={v => {
                    if (v === NONE) return set({ categoryId: undefined, categoryName: undefined });
                    set({ categoryId: v, categoryName: categories.find(c => c.id === v)?.name });
                  }}
                >
                  <SelectTrigger><SelectValue placeholder="Zgjidh kategorinë" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Pa kategori</SelectItem>
                    {categories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                {onCreateCategory && (
                  <div className="flex gap-1.5 mt-1.5">
                    <Input
                      value={newCategory}
                      onChange={e => setNewCategory(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleCreateCategory(); } }}
                      placeholder="Kategori e re…"
                      className="h-8 text-xs"
                    />
                    <Button type="button" size="sm" variant="outline" className="h-8 shrink-0"
                      onClick={handleCreateCategory} disabled={!newCategory.trim()}>
                      <Plus className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                )}
              </Field>
              <Field label="Marka">
                <Select
                  value={draft.brandId || NONE}
                  onValueChange={v => {
                    if (v === NONE) return set({ brandId: undefined, brandName: undefined });
                    set({ brandId: v, brandName: brands.find(b => b.id === v)?.name });
                  }}
                >
                  <SelectTrigger><SelectValue placeholder="Zgjidh markën" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Pa markë</SelectItem>
                    {brands.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
            </div>

            <Field label="Etiketa">
              <div className="flex flex-wrap gap-1.5 mb-1.5">
                {(draft.tags || []).map(t => (
                  <Badge key={t} variant="secondary" className="gap-1">
                    {t}
                    <button type="button" onClick={() => set({ tags: (draft.tags || []).filter(x => x !== t) })} aria-label={`Hiq ${t}`}>×</button>
                  </Badge>
                ))}
              </div>
              <div className="flex gap-1.5">
                <Input
                  value={tagInput}
                  onChange={e => setTagInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
                  placeholder="p.sh. zbritje, sezonale"
                  className="h-9"
                />
                <Button type="button" size="sm" variant="outline" className="shrink-0" onClick={addTag}>
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
            </Field>

            <Field label="Përshkrim i shkurtër" hint="Një rresht që shfaqet në kartelën e produktit.">
              <Textarea
                rows={2}
                value={draft.shortDescription || ''}
                onChange={e => set({ shortDescription: e.target.value })}
                placeholder="Karrige ergonomike me mbështetje lumbare të rregullueshme."
              />
            </Field>

            <div>
              <Label className="text-xs mb-1.5 block">Përshkrimi i plotë</Label>
              <RichTextEditor
                content={draft.description || ''}
                onChange={html => set({ description: html })}
                placeholder="Detajet, materialet, garancia…"
                minHeight="160px"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <ToggleRow
                label="Shfaq në portalin e klientit"
                description="Vetëm produktet Aktive shfaqen, edhe kur kjo është ndezur."
                checked={draft.visibleInPortal === true}
                onChange={v => set({ visibleInPortal: v })}
              />
              <ToggleRow
                label="Produkt i zgjedhur"
                description="Theksohet me flamur në dyqan."
                checked={draft.featured === true}
                onChange={v => set({ featured: v })}
              />
            </div>
          </TabsContent>

          {/* ── Çmimi ── */}
          <TabsContent value="pricing" className="space-y-4 mt-0">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Field label="Çmimi *">
                <Input type="number" step="0.01" min="0" value={draft.price ?? ''} onChange={e => set({ price: numOrUndef(e.target.value) ?? 0 })} />
              </Field>
              <Field label="Çmimi i vjetër" hint="Për badge zbritje">
                <Input type="number" step="0.01" min="0" value={draft.compareAtPrice ?? ''} onChange={e => set({ compareAtPrice: numOrUndef(e.target.value) })} />
              </Field>
              <Field label="Kosto (COGS)" hint="Nuk shfaqet te klienti">
                <Input type="number" step="0.01" min="0" value={draft.costPrice ?? ''} onChange={e => set({ costPrice: numOrUndef(e.target.value) })} />
              </Field>
              <Field label="Monedha">
                <Select value={currency} onValueChange={v => set({ currency: v as Product['currency'] })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{CURRENCIES.map(c => <SelectItem key={c} value={c!}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <Field label="TVSH %">
                <Input type="number" step="0.01" min="0" max="100" value={draft.taxRatePercent ?? ''} onChange={e => set({ taxRatePercent: numOrUndef(e.target.value) })} />
              </Field>
              <Field label="Njësia">
                <Select value={draft.unit || 'copë'} onValueChange={v => set({ unit: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{UNITS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <div className="flex items-end">
                <ToggleRow
                  label="Çmimi me TVSH"
                  checked={draft.taxIncluded === true}
                  onChange={v => set({ taxIncluded: v })}
                />
              </div>
            </div>

            {/* Live derived numbers — the reason margin mistakes get caught before saving. */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <div className="rounded-md border p-3">
                <p className="text-[11px] text-muted-foreground">Çmimi me TVSH</p>
                <p className="text-lg font-semibold text-foreground">{formatCurrency(gross, currency)}</p>
              </div>
              <div className="rounded-md border p-3">
                <p className="text-[11px] text-muted-foreground">Marzhi</p>
                <p className={`text-lg font-semibold ${margin != null && margin < 0 ? 'text-destructive' : 'text-foreground'}`}>
                  {margin != null ? `${margin}%` : '—'}
                </p>
              </div>
              <div className="rounded-md border p-3">
                <p className="text-[11px] text-muted-foreground">Zbritja</p>
                <p className="text-lg font-semibold text-foreground">{discount != null ? `-${discount}%` : '—'}</p>
              </div>
            </div>

            <div className="rounded-lg border p-3 space-y-2 bg-muted/20">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground">Çmime me shumicë</p>
                  <p className="text-xs text-muted-foreground">Çmim më i lirë kur sasia arrin nivelin.</p>
                </div>
                <Button type="button" size="sm" variant="outline"
                  onClick={() => set({ priceTiers: [...(draft.priceTiers || []), { minQty: 10, unitPrice: price }] })}>
                  <Plus className="w-4 h-4 mr-1" /> Nivel
                </Button>
              </div>
              {(draft.priceTiers || []).map((tier, i) => (
                <div key={i} className="flex items-end gap-2">
                  <Field label="Nga sasia" className="flex-1">
                    <Input type="number" min="2" step="1" value={tier.minQty ?? ''} onChange={e => patchTier(i, { minQty: numOrUndef(e.target.value) ?? 2 })} className="h-9" />
                  </Field>
                  <Field label={`Çmimi/njësi (${currency})`} className="flex-1">
                    <Input type="number" min="0" step="0.01" value={tier.unitPrice ?? ''} onChange={e => patchTier(i, { unitPrice: numOrUndef(e.target.value) ?? 0 })} className="h-9" />
                  </Field>
                  <Button type="button" size="sm" variant="ghost" className="mb-0.5"
                    onClick={() => set({ priceTiers: (draft.priceTiers || []).filter((_, j) => j !== i) })} aria-label="Fshi nivelin">
                    <Trash2 className="w-4 h-4 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          </TabsContent>

          {/* ── Inventari ── */}
          <TabsContent value="inventory" className="space-y-4 mt-0">
            <ToggleRow
              label="Gjurmo inventarin"
              description="Kur është e fikur, produkti shitet pa limit stoku."
              checked={draft.trackInventory === true}
              onChange={v => set({ trackInventory: v })}
            />

            {draft.trackInventory && (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <Field label="Stoku" hint="Ignorohet kur ka variante">
                    <Input type="number" step="1" value={draft.stockQty ?? ''} onChange={e => set({ stockQty: numOrUndef(e.target.value) })} />
                  </Field>
                  <Field label="Kufiri i stokut të ulët">
                    <Input type="number" step="1" min="0" value={draft.lowStockThreshold ?? ''} onChange={e => set({ lowStockThreshold: numOrUndef(e.target.value) })} placeholder="5" />
                  </Field>
                  <Field label="Pika e riporositjes">
                    <Input type="number" step="1" min="0" value={draft.reorderPoint ?? ''} onChange={e => set({ reorderPoint: numOrUndef(e.target.value) })} />
                  </Field>
                  <Field label="Sasia e riporositjes">
                    <Input type="number" step="1" min="0" value={draft.reorderQty ?? ''} onChange={e => set({ reorderQty: numOrUndef(e.target.value) })} />
                  </Field>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="Kur mbaron stoku">
                    <Select value={draft.stockPolicy || 'deny'} onValueChange={v => set({ stockPolicy: v as Product['stockPolicy'] })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="deny">Ndalo shitjen</SelectItem>
                        <SelectItem value="backorder">Lejo backorder</SelectItem>
                        <SelectItem value="preorder">Lejo preorder</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Depo / lokacion">
                    <Input value={draft.warehouse || ''} onChange={e => set({ warehouse: e.target.value })} placeholder="p.sh. Depo Tiranë" />
                  </Field>
                </div>
              </>
            )}

            <div className="rounded-lg border p-3 space-y-3 bg-muted/20">
              <p className="text-xs font-medium text-muted-foreground">Furnizuesi</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Field label="Emri i furnizuesit">
                  <Input value={draft.supplierName || ''} onChange={e => set({ supplierName: e.target.value })} />
                </Field>
                <Field label="SKU i furnizuesit">
                  <Input value={draft.supplierSku || ''} onChange={e => set({ supplierSku: e.target.value })} />
                </Field>
                <Field label="Ditë deri në dorëzim">
                  <Input type="number" min="0" step="1" value={draft.leadTimeDays ?? ''} onChange={e => set({ leadTimeDays: numOrUndef(e.target.value) })} />
                </Field>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Sasia minimale për porosi">
                <Input type="number" min="1" step="1" value={draft.minOrderQty ?? ''} onChange={e => set({ minOrderQty: numOrUndef(e.target.value) })} />
              </Field>
              <Field label="Sasia maksimale për porosi">
                <Input type="number" min="1" step="1" value={draft.maxOrderQty ?? ''} onChange={e => set({ maxOrderQty: numOrUndef(e.target.value) })} />
              </Field>
            </div>
          </TabsContent>

          {/* ── Variantet ── */}
          <TabsContent value="variants" className="mt-0">
            <VariantMatrixEditor
              options={draft.options || []}
              variants={draft.variants || []}
              onChange={variantsPatch}
              currency={currency}
              trackInventory={draft.trackInventory === true}
            />
          </TabsContent>

          {/* ── Fotot ── */}
          <TabsContent value="media" className="space-y-3 mt-0">
            <label className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 cursor-pointer hover:bg-muted/40 transition-colors">
              {uploading ? <Loader2 className="w-6 h-6 animate-spin text-primary" /> : <Upload className="w-6 h-6 text-muted-foreground" />}
              <span className="text-sm text-foreground">Kliko për të ngarkuar foto</span>
              <span className="text-xs text-muted-foreground">JPG/PNG/WebP · max 5MB për foto</span>
              <input type="file" accept="image/*" multiple className="hidden" onChange={e => { handleUpload(e.target.files); e.target.value = ''; }} />
            </label>

            {(draft.images || []).length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {(draft.images || []).map(img => (
                  <div key={img.url} className="relative group rounded-lg border overflow-hidden bg-muted/30">
                    <img src={img.url} alt={img.alt || ''} className="w-full h-28 object-cover" />
                    {img.isPrimary && (
                      <Badge className="absolute top-1 left-1 bg-primary text-primary-foreground text-[10px]">Kryesore</Badge>
                    )}
                    <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                      {!img.isPrimary && (
                        <button type="button" onClick={() => setPrimaryImage(img.url)}
                          className="p-1 rounded bg-background/90 hover:bg-background" aria-label="Bëj kryesore">
                          <Star className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button type="button" onClick={() => removeImage(img.url)}
                        className="p-1 rounded bg-background/90 hover:bg-background" aria-label="Fshi foton">
                        <Trash2 className="w-3.5 h-3.5 text-destructive" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="rounded-lg border p-3 space-y-2 bg-muted/20">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-foreground">Specifikimet</p>
                <Button type="button" size="sm" variant="outline"
                  onClick={() => set({ attributes: [...(draft.attributes || []), { name: '', value: '' }] })}>
                  <Plus className="w-4 h-4 mr-1" /> Rresht
                </Button>
              </div>
              {(draft.attributes || []).map((attr, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input value={attr.name} onChange={e => patchAttribute(i, { name: e.target.value })} placeholder="Materiali" className="h-9" />
                  <Input value={attr.value} onChange={e => patchAttribute(i, { value: e.target.value })} placeholder="Alumin" className="h-9" />
                  <Button type="button" size="sm" variant="ghost"
                    onClick={() => set({ attributes: (draft.attributes || []).filter((_, j) => j !== i) })} aria-label="Fshi rreshtin">
                    <Trash2 className="w-4 h-4 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          </TabsContent>

          {/* ── Transporti / digjital ── */}
          <TabsContent value="shipping" className="space-y-4 mt-0">
            <ToggleRow
              label="Kërkon transport"
              description="Fiko për shërbime dhe produkte digjitale."
              checked={draft.requiresShipping === true}
              onChange={v => set({ requiresShipping: v })}
            />
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Field label="Pesha (gram)">
                <Input type="number" min="0" step="1" value={draft.weightGrams ?? ''} onChange={e => set({ weightGrams: numOrUndef(e.target.value) })} />
              </Field>
              <Field label="Gjatësia (cm)">
                <Input type="number" min="0" step="0.1" value={draft.dimensions?.lengthCm ?? ''} onChange={e => set({ dimensions: { ...draft.dimensions, lengthCm: numOrUndef(e.target.value) } })} />
              </Field>
              <Field label="Gjerësia (cm)">
                <Input type="number" min="0" step="0.1" value={draft.dimensions?.widthCm ?? ''} onChange={e => set({ dimensions: { ...draft.dimensions, widthCm: numOrUndef(e.target.value) } })} />
              </Field>
              <Field label="Lartësia (cm)">
                <Input type="number" min="0" step="0.1" value={draft.dimensions?.heightCm ?? ''} onChange={e => set({ dimensions: { ...draft.dimensions, heightCm: numOrUndef(e.target.value) } })} />
              </Field>
            </div>
            <Field label="Garancia (muaj)">
              <Input type="number" min="0" step="1" value={draft.warrantyMonths ?? ''} onChange={e => set({ warrantyMonths: numOrUndef(e.target.value) })} className="sm:max-w-[200px]" />
            </Field>

            {draft.type === 'digital' && (
              <div className="rounded-lg border p-3 space-y-3 bg-muted/20">
                <p className="text-xs font-medium text-muted-foreground">Produkt digjital</p>
                <Field label="Link-u i shkarkimit">
                  <Input value={draft.downloadUrl || ''} onChange={e => set({ downloadUrl: e.target.value })} placeholder="https://…" />
                </Field>
                <Field label="Limiti i shkarkimeve">
                  <Input type="number" min="0" step="1" value={draft.downloadLimit ?? ''} onChange={e => set({ downloadLimit: numOrUndef(e.target.value) })} className="sm:max-w-[200px]" />
                </Field>
              </div>
            )}
          </TabsContent>

          {/* ── SEO ── */}
          <TabsContent value="seo" className="space-y-3 mt-0">
            <Field label="Slug (URL)" hint="Krijohet automatikisht nga emri derisa ta ndryshosh.">
              <Input
                value={draft.slug || ''}
                onChange={e => { setSlugTouched(true); set({ slug: slugify(e.target.value) }); }}
                placeholder="karrige-zyre-ergonomike"
              />
            </Field>
            <Field label="Meta title" hint={`${(draft.metaTitle || '').length}/60 karaktere`}>
              <Input value={draft.metaTitle || ''} onChange={e => set({ metaTitle: e.target.value })} maxLength={70} />
            </Field>
            <Field label="Meta description" hint={`${(draft.metaDescription || '').length}/160 karaktere`}>
              <Textarea rows={3} value={draft.metaDescription || ''} onChange={e => set({ metaDescription: e.target.value })} maxLength={200} />
            </Field>
          </TabsContent>
        </Tabs>

        <div className="flex items-center justify-between gap-2 pt-2 border-t sticky bottom-0 bg-background">
          <p className="text-xs text-muted-foreground">
            {errors.length > 0 ? `${errors.length} fusha për t'u rregulluar` : 'Gati për ruajtje'}
          </p>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Anulo</Button>
            <Button type="button" onClick={submit} disabled={saving || uploading} className="bg-primary text-primary-foreground">
              {saving && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
              {initial ? 'Ruaj ndryshimet' : 'Krijo produktin'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ProductFormDialog;
