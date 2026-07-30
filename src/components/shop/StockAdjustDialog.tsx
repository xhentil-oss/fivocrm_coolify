import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, PackageMinus, PackagePlus, SlidersHorizontal } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { useToast } from '../../hooks/use-toast';
import { nextBalance, totalStock, variantStock } from '../../lib/shop/inventory';
import { variantLabel } from '../../lib/shop/variants';
import type { Product, StockMovementType } from '../../types';

const NO_VARIANT = '__product__';

const TYPE_OPTIONS: { value: StockMovementType; label: string; hint: string }[] = [
  { value: 'in', label: 'Hyrje (blerje)', hint: 'Shtohet në stok' },
  { value: 'out', label: 'Dalje (humbje/dëmtim)', hint: 'Zbritet nga stoku' },
  { value: 'return', label: 'Kthim nga klienti', hint: 'Shtohet në stok' },
  { value: 'adjustment', label: 'Korrigjim (inventarizim)', hint: 'Sasi me shenjë: 5 ose -5' },
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: Product | null;
  /** Persists the movement + the product/variant stock patch. */
  onSubmit: (input: {
    product: Product;
    variantId?: string;
    type: StockMovementType;
    quantity: number;
    reason?: string;
    reference?: string;
    unitCost?: number;
  }) => Promise<void>;
}

/**
 * Records one inventory movement. Deliberately not a raw "set stock to N" field:
 * every change goes through the ledger, so the stock number always has an audit
 * trail behind it. An inventory count is expressed as an `adjustment` delta.
 */
const StockAdjustDialog: React.FC<Props> = ({ open, onOpenChange, product, onSubmit }) => {
  const { toast } = useToast();
  const [variantId, setVariantId] = useState<string>(NO_VARIANT);
  const [type, setType] = useState<StockMovementType>('in');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const [saving, setSaving] = useState(false);

  const variants = product?.variants || [];
  const optionNames = useMemo(() => (product?.options || []).map(o => o.name), [product]);

  // Reset when a different product is opened. Derives the variants inside so the
  // effect depends only on the product identity, not on a fresh array each render.
  useEffect(() => {
    if (!open) return;
    const first = product?.variants?.[0];
    setVariantId(first ? first.id : NO_VARIANT);
    setType('in');
    setQuantity('');
    setReason('');
    setReference('');
    setUnitCost('');
  }, [open, product]);

  if (!product) return null;

  const selectedVariant = variantId !== NO_VARIANT ? variants.find(v => v.id === variantId) : undefined;
  const current = selectedVariant ? variantStock(selectedVariant) : (variants.length ? totalStock(product) : (product.stockQty || 0));
  const qtyNum = Number(quantity);
  const validQty = Number.isFinite(qtyNum) && qtyNum !== 0;
  const projected = validQty ? nextBalance(current, type, qtyNum) : current;

  const submit = async () => {
    if (!validQty) {
      toast({ title: 'Sasia mungon', description: 'Shkruaj një sasi jo-zero.', variant: 'destructive' });
      return;
    }
    if (variants.length && variantId === NO_VARIANT) {
      toast({ title: 'Zgjidh variantin', description: 'Produkti ka variante — stoku mbahet për variant.', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      await onSubmit({
        product,
        variantId: selectedVariant?.id,
        type,
        quantity: qtyNum,
        reason: reason.trim() || undefined,
        reference: reference.trim() || undefined,
        unitCost: unitCost === '' ? undefined : Number(unitCost),
      });
      onOpenChange(false);
    } catch (err: any) {
      toast({ title: 'Ruajtja dështoi', description: err?.message || 'Provo përsëri.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const TypeIcon = type === 'in' || type === 'return' ? PackagePlus : type === 'out' ? PackageMinus : SlidersHorizontal;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Lëvizje stoku — {product.name}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {variants.length > 0 && (
            <div>
              <Label className="text-xs">Varianti</Label>
              <Select value={variantId} onValueChange={setVariantId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {variants.map(v => (
                    <SelectItem key={v.id} value={v.id}>
                      {variantLabel(v.optionValues, optionNames) || v.sku || v.id} · {variantStock(v)} në stok
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div>
            <Label className="text-xs">Tipi i lëvizjes</Label>
            <Select value={type} onValueChange={v => setType(v as StockMovementType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {TYPE_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground mt-1">
              {TYPE_OPTIONS.find(o => o.value === type)?.hint}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Sasia</Label>
              <Input
                type="number"
                step="1"
                value={quantity}
                onChange={e => setQuantity(e.target.value)}
                placeholder={type === 'adjustment' ? '-5 ose 5' : '10'}
                autoFocus
              />
            </div>
            <div>
              <Label className="text-xs">Kosto/njësi (opsionale)</Label>
              <Input type="number" step="0.01" min="0" value={unitCost} onChange={e => setUnitCost(e.target.value)} />
            </div>
          </div>

          <div>
            <Label className="text-xs">Referenca</Label>
            <Input value={reference} onChange={e => setReference(e.target.value)} placeholder="Fatura e furnizuesit, nr. porosie…" />
          </div>

          <div>
            <Label className="text-xs">Arsyeja</Label>
            <Input value={reason} onChange={e => setReason(e.target.value)} placeholder="p.sh. Inventarizim mujor" />
          </div>

          <div className="flex items-center gap-3 rounded-lg border p-3 bg-muted/20">
            <TypeIcon className="w-5 h-5 text-primary shrink-0" />
            <div className="text-sm">
              <span className="text-muted-foreground">Stoku:</span>{' '}
              <span className="font-semibold text-foreground">{current}</span>
              <span className="text-muted-foreground"> → </span>
              <span className="font-semibold text-foreground">{projected}</span>
              {validQty && projected === 0 && current > 0 && (
                <span className="text-xs text-amber-600 dark:text-amber-400 ml-2">(shkon në zero)</span>
              )}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Anulo</Button>
          <Button onClick={submit} disabled={saving || !validQty} className="bg-primary text-primary-foreground">
            {saving && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
            Regjistro lëvizjen
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default StockAdjustDialog;
