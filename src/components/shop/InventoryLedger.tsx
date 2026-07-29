import React, { useMemo, useState } from 'react';
import { AlertTriangle, ArrowDownRight, ArrowUpRight, History, PackageSearch, SlidersHorizontal } from 'lucide-react';
import { Card } from '../ui/card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { formatCurrency, getTimestampMs, toAll } from '../../lib/utils';
import {
  inventoryValue, inventoryRetailValue, lowStockProducts, movementDelta,
  reorderSuggestion, stockState, totalStock,
} from '../../lib/shop/inventory';
import type { Product, StockMovement, StockMovementType } from '../../types';

const ALL = '__all__';

const TYPE_LABELS: Record<StockMovementType, string> = {
  in: 'Hyrje',
  out: 'Dalje',
  sale: 'Shitje',
  return: 'Kthim',
  adjustment: 'Korrigjim',
  transfer: 'Transferim',
};

const fmtDateTime = (d: any) => {
  const ms = getTimestampMs(d);
  return ms
    ? new Date(ms).toLocaleString('sq-AL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : '—';
};

interface Props {
  products: Product[];
  movements: StockMovement[];
  canEdit: boolean;
  onAdjust: (product: Product) => void;
}

/**
 * Inventory tab: valuation KPIs, a restock worklist, and the append-only movement
 * ledger. The ledger is the audit trail behind every stock number — stock is never
 * edited directly, only moved.
 */
const InventoryLedger: React.FC<Props> = ({ products, movements, canEdit, onAdjust }) => {
  const [typeFilter, setTypeFilter] = useState<string>(ALL);
  const [search, setSearch] = useState('');
  const [visible, setVisible] = useState(25);

  const tracked = useMemo(() => products.filter(p => p.trackInventory === true), [products]);
  const lowStock = useMemo(() => lowStockProducts(products), [products]);

  // A catalog can mix ALL/EUR prices, so valuation totals are normalized to ALL —
  // the same convention FinancesView uses. Summing raw amounts across currencies
  // would silently understate a EUR-priced catalog ~100×.
  const inAll = useMemo(
    () => products.map(p => ({
      ...p,
      price: toAll(p.price, p.currency),
      costPrice: p.costPrice != null ? toAll(p.costPrice, p.currency) : undefined,
      variants: p.variants?.map(v => ({
        ...v,
        price: v.price != null ? toAll(v.price, p.currency) : undefined,
        costPrice: v.costPrice != null ? toAll(v.costPrice, p.currency) : undefined,
      })),
    })),
    [products],
  );
  const atCost = useMemo(() => inventoryValue(inAll), [inAll]);
  const atRetail = useMemo(() => inventoryRetailValue(inAll), [inAll]);
  const unitsOnHand = useMemo(() => tracked.reduce((n, p) => n + totalStock(p), 0), [tracked]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return [...movements]
      .filter(m => (typeFilter === ALL ? true : m.type === typeFilter))
      .filter(m => !q || [m.productName, m.variantLabel, m.reference, m.reason].some(v => (v || '').toLowerCase().includes(q)))
      .sort((a, b) => getTimestampMs(b.createdAt) - getTimestampMs(a.createdAt));
  }, [movements, typeFilter, search]);

  const restockList = useMemo(
    () => tracked
      .map(p => ({ product: p, suggested: reorderSuggestion(p) }))
      .filter(r => r.suggested > 0)
      .sort((a, b) => totalStock(a.product) - totalStock(b.product)),
    [tracked],
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Vlera në kosto</p>
          <p className="text-xl font-bold text-foreground">{formatCurrency(atCost, 'ALL')}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Vlera në shitje</p>
          <p className="text-xl font-bold text-foreground">{formatCurrency(atRetail, 'ALL')}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Njësi në stok</p>
          <p className="text-xl font-bold text-foreground">{unitsOnHand}</p>
          <p className="text-[11px] text-muted-foreground">{tracked.length} produkte të gjurmuara</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Stok i ulët</p>
          <p className={`text-xl font-bold ${lowStock.length ? 'text-amber-600 dark:text-amber-400' : 'text-foreground'}`}>
            {lowStock.length}
          </p>
        </Card>
      </div>

      {restockList.length > 0 && (
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            <h3 className="text-sm font-semibold text-foreground">Për riporositje</h3>
            <Badge variant="outline" className="ml-auto">{restockList.length}</Badge>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="text-left py-1.5 font-medium">Produkti</th>
                  <th className="text-left py-1.5 font-medium">Në stok</th>
                  <th className="text-left py-1.5 font-medium">Sugjerim</th>
                  <th className="text-left py-1.5 font-medium">Furnizuesi</th>
                  {canEdit && <th className="py-1.5" />}
                </tr>
              </thead>
              <tbody>
                {restockList.slice(0, 12).map(({ product, suggested }) => (
                  <tr key={product.id} className="border-t">
                    <td className="py-2 pr-2 font-medium text-foreground">{product.name}</td>
                    <td className="py-2 pr-2">
                      <Badge className={stockState(product) === 'out'
                        ? 'bg-destructive/10 text-destructive'
                        : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'}>
                        {totalStock(product)}
                      </Badge>
                    </td>
                    <td className="py-2 pr-2 text-foreground">+{suggested}</td>
                    <td className="py-2 pr-2 text-muted-foreground">{product.supplierName || '—'}</td>
                    {canEdit && (
                      <td className="py-2 text-right">
                        <Button size="sm" variant="outline" onClick={() => onAdjust(product)}>
                          <SlidersHorizontal className="w-3.5 h-3.5 mr-1" /> Regjistro hyrje
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card className="p-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-3">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">Historiku i lëvizjeve</h3>
          </div>
          <div className="flex gap-2 sm:ml-auto">
            <Input
              value={search}
              onChange={e => { setSearch(e.target.value); setVisible(25); }}
              placeholder="Kërko produkt / referencë…"
              className="h-9 sm:w-56"
            />
            <Select value={typeFilter} onValueChange={v => { setTypeFilter(v); setVisible(25); }}>
              <SelectTrigger className="h-9 w-[150px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Të gjitha tipet</SelectItem>
                {(Object.keys(TYPE_LABELS) as StockMovementType[]).map(t => (
                  <SelectItem key={t} value={t}>{TYPE_LABELS[t]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="py-10 text-center">
            <PackageSearch className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">Pa lëvizje stoku deri tani.</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr>
                    <th className="text-left py-1.5 font-medium">Data</th>
                    <th className="text-left py-1.5 font-medium">Produkti</th>
                    <th className="text-left py-1.5 font-medium">Tipi</th>
                    <th className="text-left py-1.5 font-medium">Sasia</th>
                    <th className="text-left py-1.5 font-medium">Pas lëvizjes</th>
                    <th className="text-left py-1.5 font-medium">Referenca</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.slice(0, visible).map(m => {
                    const delta = movementDelta(m.type, m.quantity);
                    return (
                      <tr key={m.id} className="border-t">
                        <td className="py-2 pr-2 whitespace-nowrap text-muted-foreground">{fmtDateTime(m.createdAt)}</td>
                        <td className="py-2 pr-2">
                          <span className="font-medium text-foreground">{m.productName || '—'}</span>
                          {m.variantLabel && <span className="text-muted-foreground"> · {m.variantLabel}</span>}
                        </td>
                        <td className="py-2 pr-2 text-muted-foreground">{TYPE_LABELS[m.type] || m.type}</td>
                        <td className="py-2 pr-2">
                          <span className={`inline-flex items-center gap-0.5 font-medium ${delta >= 0 ? 'text-success' : 'text-destructive'}`}>
                            {delta >= 0 ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
                            {delta > 0 ? `+${delta}` : delta}
                          </span>
                        </td>
                        <td className="py-2 pr-2 text-foreground">{m.balanceAfter ?? '—'}</td>
                        <td className="py-2 pr-2 text-muted-foreground truncate max-w-[220px]" title={m.reference || m.reason || ''}>
                          {m.reference || m.reason || '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {filtered.length > visible && (
              <div className="pt-3 text-center">
                <Button variant="outline" size="sm" onClick={() => setVisible(v => v + 25)}>
                  Shfaq më shumë ({filtered.length - visible})
                </Button>
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
};

export default InventoryLedger;
