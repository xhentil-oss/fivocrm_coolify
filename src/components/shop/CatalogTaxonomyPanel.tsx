import React, { useState } from 'react';
import { Check, FolderTree, Loader2, Pencil, Plus, Tags, Trash2, X } from 'lucide-react';
import { Card } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import { useToast } from '../../hooks/use-toast';
import { slugify } from '../../lib/shop/product';
import type { Product, ProductBrand, ProductCategory } from '../../types';

interface Props {
  categories: ProductCategory[];
  brands: ProductBrand[];
  products: Product[];
  canEdit: boolean;
  onCreateCategory: (name: string) => Promise<unknown>;
  onRenameCategory: (id: string, name: string) => Promise<unknown>;
  onDeleteCategory: (id: string) => Promise<unknown>;
  onCreateBrand: (name: string) => Promise<unknown>;
  onRenameBrand: (id: string, name: string) => Promise<unknown>;
  onDeleteBrand: (id: string) => Promise<unknown>;
}

interface RowProps {
  id: string;
  name: string;
  count: number;
  canEdit: boolean;
  onRename: (name: string) => Promise<unknown>;
  onDelete: () => Promise<unknown>;
}

const TaxonomyRow: React.FC<RowProps> = ({ id, name, count, canEdit, onRename, onDelete }) => {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const next = value.trim();
    if (!next || next === name) { setEditing(false); setValue(name); return; }
    setBusy(true);
    try {
      await onRename(next);
      setEditing(false);
    } catch (err: any) {
      toast({ title: 'Ndryshimi dështoi', description: err?.message, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (count > 0) {
      toast({
        title: 'Nuk mund të fshihet',
        description: `${count} produkte e përdorin. Zhvendosi ato më parë.`,
        variant: 'destructive',
      });
      return;
    }
    setBusy(true);
    try {
      await onDelete();
    } catch (err: any) {
      toast({ title: 'Fshirja dështoi', description: err?.message, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-2 py-2 border-b last:border-0">
      {editing ? (
        <>
          <Input
            autoFocus
            value={value}
            onChange={e => setValue(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); save(); }
              if (e.key === 'Escape') { setEditing(false); setValue(name); }
            }}
            className="h-8"
          />
          <Button size="sm" variant="ghost" onClick={save} disabled={busy} aria-label="Ruaj">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4 text-success" />}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setValue(name); }} aria-label="Anulo">
            <X className="w-4 h-4" />
          </Button>
        </>
      ) : (
        <>
          <span className="flex-1 min-w-0 truncate text-sm text-foreground" title={name}>{name}</span>
          <Badge variant="outline" className="shrink-0">{count}</Badge>
          {canEdit && (
            <>
              <Button size="sm" variant="ghost" onClick={() => setEditing(true)} aria-label={`Ndrysho ${name}`}>
                <Pencil className="w-3.5 h-3.5" />
              </Button>
              <Button size="sm" variant="ghost" onClick={remove} disabled={busy} aria-label={`Fshi ${name}`}>
                <Trash2 className="w-3.5 h-3.5 text-destructive" />
              </Button>
            </>
          )}
        </>
      )}
      <span className="sr-only">{id}</span>
    </div>
  );
};

const AddRow: React.FC<{ placeholder: string; onAdd: (name: string) => Promise<unknown>; taken: string[] }> = ({
  placeholder, onAdd, taken,
}) => {
  const { toast } = useToast();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const duplicate = !!value.trim() && taken.some(t => t.toLowerCase() === value.trim().toLowerCase());

  const add = async () => {
    const name = value.trim();
    if (!name || duplicate) return;
    setBusy(true);
    try {
      await onAdd(name);
      setValue('');
    } catch (err: any) {
      toast({ title: 'Krijimi dështoi', description: err?.message, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-1 pt-2">
      <div className="flex gap-1.5">
        <Input
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          placeholder={placeholder}
          className="h-9"
        />
        <Button size="sm" className="shrink-0" onClick={add} disabled={busy || !value.trim() || duplicate}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
        </Button>
      </div>
      {duplicate && <p className="text-[11px] text-destructive">Ekziston tashmë.</p>}
      {!!value.trim() && !duplicate && (
        <p className="text-[11px] text-muted-foreground">URL: /{slugify(value)}</p>
      )}
    </div>
  );
};

/**
 * Categories + brands side by side. Both carry a usage count and refuse deletion
 * while products still reference them — otherwise a product's `categoryName`
 * denormalization would point at a category that no longer exists.
 */
const CatalogTaxonomyPanel: React.FC<Props> = ({
  categories, brands, products, canEdit,
  onCreateCategory, onRenameCategory, onDeleteCategory,
  onCreateBrand, onRenameBrand, onDeleteBrand,
}) => {
  const countByCategory = (id: string) => products.filter(p => p.categoryId === id).length;
  const countByBrand = (id: string) => products.filter(p => p.brandId === id).length;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <FolderTree className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">Kategoritë</h3>
          <Badge variant="outline" className="ml-auto">{categories.length}</Badge>
        </div>
        {categories.length === 0 && (
          <p className="text-xs text-muted-foreground py-2">Pa kategori. Shto të parën më poshtë.</p>
        )}
        {categories.map(c => (
          <TaxonomyRow
            key={c.id}
            id={c.id}
            name={c.name}
            count={countByCategory(c.id)}
            canEdit={canEdit}
            onRename={name => onRenameCategory(c.id, name)}
            onDelete={() => onDeleteCategory(c.id)}
          />
        ))}
        {canEdit && (
          <AddRow placeholder="Kategori e re…" onAdd={onCreateCategory} taken={categories.map(c => c.name)} />
        )}
      </Card>

      <Card className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <Tags className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">Markat</h3>
          <Badge variant="outline" className="ml-auto">{brands.length}</Badge>
        </div>
        {brands.length === 0 && (
          <p className="text-xs text-muted-foreground py-2">Pa marka. Opsionale, por ndihmojnë filtrimin.</p>
        )}
        {brands.map(b => (
          <TaxonomyRow
            key={b.id}
            id={b.id}
            name={b.name}
            count={countByBrand(b.id)}
            canEdit={canEdit}
            onRename={name => onRenameBrand(b.id, name)}
            onDelete={() => onDeleteBrand(b.id)}
          />
        ))}
        {canEdit && (
          <AddRow placeholder="Markë e re…" onAdd={onCreateBrand} taken={brands.map(b => b.name)} />
        )}
      </Card>
    </div>
  );
};

export default CatalogTaxonomyPanel;
