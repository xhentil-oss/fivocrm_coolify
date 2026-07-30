import React, { useMemo, useState } from 'react';
import { Plus, Sparkles, Trash2, X } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Badge } from '../ui/badge';
import {
  MAX_OPTIONS,
  MAX_VARIANTS,
  buildVariantMatrix,
  normalizeOptions,
  variantCount,
  variantLabel,
} from '../../lib/shop/variants';
import type { ProductOption, ProductVariant } from '../../types';

interface Props {
  options: ProductOption[];
  variants: ProductVariant[];
  onChange: (patch: { options?: ProductOption[]; variants?: ProductVariant[] }) => void;
  currency: string;
  trackInventory: boolean;
}

/**
 * Option axes + the generated variant matrix.
 *
 * Regeneration is explicit (a button) rather than automatic on every keystroke:
 * a half-typed option value would otherwise churn the matrix and throw away rows
 * the user had already filled in. buildVariantMatrix still preserves matching
 * rows, so pressing it after adding a value is non-destructive.
 */
const VariantMatrixEditor: React.FC<Props> = ({ options, variants, onChange, currency, trackInventory }) => {
  const [newValue, setNewValue] = useState<Record<number, string>>({});

  const optionNames = useMemo(() => normalizeOptions(options).map(o => o.name), [options]);
  const expected = variantCount(options);
  const isStale = expected > 0 && expected !== variants.length;

  const setOptions = (next: ProductOption[]) => onChange({ options: next });

  const addOption = () => {
    if (options.length >= MAX_OPTIONS) return;
    setOptions([...options, { name: '', values: [] }]);
  };

  const removeOption = (index: number) => {
    const next = options.filter((_, i) => i !== index);
    // Dropping an axis invalidates every combination — rebuild from what's left.
    onChange({ options: next, variants: buildVariantMatrix(next, variants) });
  };

  const renameOption = (index: number, name: string) => {
    setOptions(options.map((o, i) => (i === index ? { ...o, name } : o)));
  };

  const addValue = (index: number) => {
    const raw = (newValue[index] || '').trim();
    if (!raw) return;
    // Accept a comma-separated paste in one go ("S, M, L").
    const incoming = raw.split(',').map(v => v.trim()).filter(Boolean);
    const existing = options[index]?.values || [];
    const merged = [...existing];
    for (const v of incoming) {
      if (!merged.some(e => e.toLowerCase() === v.toLowerCase())) merged.push(v);
    }
    setOptions(options.map((o, i) => (i === index ? { ...o, values: merged } : o)));
    setNewValue(prev => ({ ...prev, [index]: '' }));
  };

  const removeValue = (index: number, value: string) => {
    setOptions(options.map((o, i) => (i === index ? { ...o, values: o.values.filter(v => v !== value) } : o)));
  };

  const regenerate = () => onChange({ variants: buildVariantMatrix(options, variants) });

  const patchVariant = (id: string, patch: Partial<ProductVariant>) => {
    onChange({ variants: variants.map(v => (v.id === id ? { ...v, ...patch } : v)) });
  };

  const numOrUndef = (raw: string): number | undefined => {
    if (raw === '') return undefined;
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  };

  return (
    <div className="space-y-5">
      <div className="rounded-lg border p-3 space-y-3 bg-muted/20">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-sm font-medium text-foreground">Opsionet</p>
            <p className="text-xs text-muted-foreground">
              Deri në {MAX_OPTIONS} akse (p.sh. Madhësia, Ngjyra). Kombinimet krijohen automatikisht.
            </p>
          </div>
          <Button type="button" size="sm" variant="outline" onClick={addOption} disabled={options.length >= MAX_OPTIONS}>
            <Plus className="w-4 h-4 mr-1" /> Opsion
          </Button>
        </div>

        {options.length === 0 && (
          <p className="text-xs text-muted-foreground italic">
            Pa opsione, produkti shitet si një SKU e vetme.
          </p>
        )}

        {options.map((opt, index) => (
          <div key={index} className="rounded-md border bg-background p-3 space-y-2">
            <div className="flex items-center gap-2">
              <Input
                placeholder="Emri i opsionit (p.sh. Madhësia)"
                value={opt.name}
                onChange={e => renameOption(index, e.target.value)}
                className="h-9"
              />
              <Button type="button" size="sm" variant="ghost" onClick={() => removeOption(index)} aria-label="Fshi opsionin">
                <Trash2 className="w-4 h-4 text-destructive" />
              </Button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {opt.values.map(v => (
                <Badge key={v} variant="secondary" className="gap-1">
                  {v}
                  <button type="button" onClick={() => removeValue(index, v)} aria-label={`Hiq ${v}`}>
                    <X className="w-3 h-3" />
                  </button>
                </Badge>
              ))}
            </div>
            <div className="flex gap-1.5">
              <Input
                placeholder="Shto vlerë (ose S, M, L)"
                value={newValue[index] || ''}
                onChange={e => setNewValue(prev => ({ ...prev, [index]: e.target.value }))}
                onKeyDown={e => {
                  if (e.key === 'Enter') { e.preventDefault(); addValue(index); }
                }}
                className="h-9"
              />
              <Button type="button" size="sm" variant="outline" className="shrink-0" onClick={() => addValue(index)}>
                <Plus className="w-4 h-4" />
              </Button>
            </div>
          </div>
        ))}
      </div>

      {expected > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <Label className="text-sm">Variantet</Label>
              <Badge variant="outline">{variants.length}/{expected}</Badge>
              {expected > MAX_VARIANTS && (
                <span className="text-xs text-destructive">Maksimumi {MAX_VARIANTS} kombinime.</span>
              )}
            </div>
            <Button type="button" size="sm" variant={isStale ? 'default' : 'outline'} onClick={regenerate}>
              <Sparkles className="w-4 h-4 mr-1" />
              {isStale ? 'Rigjenero kombinimet' : 'Rifresko'}
            </Button>
          </div>

          {isStale && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Opsionet kanë ndryshuar — rigjenero për t'i sinkronizuar variantet (të dhënat e mbushura ruhen).
            </p>
          )}

          {variants.length > 0 && (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs text-muted-foreground">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">Varianti</th>
                    <th className="text-left px-3 py-2 font-medium">SKU</th>
                    <th className="text-left px-3 py-2 font-medium">Çmimi ({currency})</th>
                    {trackInventory && <th className="text-left px-3 py-2 font-medium">Stok</th>}
                    <th className="text-left px-3 py-2 font-medium">Aktiv</th>
                  </tr>
                </thead>
                <tbody>
                  {variants.map(v => (
                    <tr key={v.id} className="border-t">
                      <td className="px-3 py-2 whitespace-nowrap font-medium text-foreground">
                        {variantLabel(v.optionValues, optionNames) || '—'}
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          value={v.sku || ''}
                          onChange={e => patchVariant(v.id, { sku: e.target.value })}
                          className="h-8 min-w-[110px]"
                          placeholder="opsionale"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          value={v.price ?? ''}
                          onChange={e => patchVariant(v.id, { price: numOrUndef(e.target.value) })}
                          className="h-8 min-w-[100px]"
                          placeholder="trashëgo"
                        />
                      </td>
                      {trackInventory && (
                        <td className="px-3 py-2">
                          <Input
                            type="number"
                            step="1"
                            value={v.stockQty ?? ''}
                            onChange={e => patchVariant(v.id, { stockQty: numOrUndef(e.target.value) })}
                            className="h-8 min-w-[80px]"
                            placeholder="0"
                          />
                        </td>
                      )}
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={v.isActive !== false}
                          onChange={e => patchVariant(v.id, { isActive: e.target.checked })}
                          className="h-4 w-4 rounded border-input"
                          aria-label="Aktiv"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Çmimi bosh = trashëgohet nga produkti. Çmimi 0 është çmim real (falas).
          </p>
        </div>
      )}
    </div>
  );
};

export default VariantMatrixEditor;
