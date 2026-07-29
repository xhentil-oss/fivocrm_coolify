import React, { useState } from 'react';
import Papa from 'papaparse';
import { CheckCircle2, Loader2, Upload } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { useToast } from '../../hooks/use-toast';
import { PRODUCT_IMPORT_FIELDS } from '../../lib/shop/product';

const NONE = '__none__';

export interface ImportResult {
  created: number;
  skipped: number;
  errors: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** Receives mapped raw rows; the caller validates + writes and reports counts. */
  onImport: (rows: Record<string, any>[]) => Promise<ImportResult>;
}

/**
 * CSV product importer. Mirrors LeadImportDialog: auto-maps headers by synonym,
 * then lets the user correct the mapping before anything is written. Rows land as
 * DRAFT products (never portal-visible) so a bad import can't reach clients.
 */
const ProductImportDialog: React.FC<Props> = ({ open, onClose, onImport }) => {
  const { toast } = useToast();
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, any>[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const reset = () => { setHeaders([]); setRows([]); setMapping({}); setResult(null); };

  const handleFile = (file: File) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: res => {
        const hs = (res.meta.fields || []).filter(Boolean) as string[];
        setHeaders(hs);
        setRows(res.data as Record<string, any>[]);
        const auto: Record<string, string> = {};
        PRODUCT_IMPORT_FIELDS.forEach(f => {
          auto[f.key] = hs.find(h => f.synonyms.includes(h.toLowerCase().trim())) || NONE;
        });
        setMapping(auto);
        setResult(null);
      },
      error: () => toast({ title: 'Gabim', description: 'Skedari CSV nuk u lexua.', variant: 'destructive' }),
    });
  };

  const doImport = async () => {
    const missing = PRODUCT_IMPORT_FIELDS.filter(f => f.required && (!mapping[f.key] || mapping[f.key] === NONE));
    if (missing.length) {
      toast({
        title: 'Mapim i paplotë',
        description: `Mapo kolonën: ${missing.map(f => f.label).join(', ')}.`,
        variant: 'destructive',
      });
      return;
    }
    setImporting(true);
    try {
      const mapped = rows
        .map(r => {
          const out: Record<string, any> = {};
          PRODUCT_IMPORT_FIELDS.forEach(f => {
            const col = mapping[f.key];
            if (col && col !== NONE && r[col] != null && String(r[col]).trim() !== '') {
              out[f.key] = String(r[col]).trim();
            }
          });
          return out;
        })
        .filter(r => r.name);
      const res = await onImport(mapped);
      setResult(res);
      toast({
        title: 'Importi përfundoi',
        description: `${res.created} të krijuara · ${res.skipped} anashkaluar · ${res.errors} gabime`,
      });
    } finally {
      setImporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) { reset(); onClose(); } }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Importo produkte nga CSV</DialogTitle></DialogHeader>

        {result ? (
          <div className="py-6 text-center space-y-3">
            <CheckCircle2 className="w-10 h-10 mx-auto text-emerald-500" />
            <p className="text-sm">
              <strong>{result.created}</strong> produkte u krijuan ·{' '}
              <strong>{result.skipped}</strong> u anashkaluan ·{' '}
              <strong>{result.errors}</strong> gabime
            </p>
            <p className="text-xs text-muted-foreground">
              Produktet e importuara janë <strong>Draft</strong> dhe jo në portal — aktivizoji pasi t'i kontrollosh.
            </p>
            <Button onClick={() => { reset(); onClose(); }}>Mbyll</Button>
          </div>
        ) : headers.length === 0 ? (
          <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-border rounded-lg py-10 cursor-pointer hover:bg-muted/40">
            <Upload className="w-8 h-8 text-muted-foreground" />
            <span className="text-sm font-medium">Kliko për të zgjedhur një skedar CSV</span>
            <span className="text-xs text-muted-foreground">Rreshti i parë duhet të jetë header-i (emrat e kolonave)</span>
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
            />
          </label>
        ) : (
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">
              U gjetën <strong>{rows.length}</strong> rreshta. Mapo kolonat me fushat e produktit:
            </p>
            <div className="space-y-2">
              {PRODUCT_IMPORT_FIELDS.map(f => (
                <div key={f.key} className="flex items-center gap-3">
                  <span className="w-28 shrink-0 text-sm">
                    {f.label}{f.required && <span className="text-destructive"> *</span>}
                  </span>
                  <Select value={mapping[f.key] || NONE} onValueChange={v => setMapping(prev => ({ ...prev, [f.key]: v }))}>
                    <SelectTrigger className="h-8 text-xs flex-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>— Asnjë —</SelectItem>
                      {headers.map(h => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={reset} disabled={importing}>Ndrysho skedarin</Button>
              <Button onClick={doImport} disabled={importing}>
                {importing && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
                Importo {rows.length} produkte
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default ProductImportDialog;
