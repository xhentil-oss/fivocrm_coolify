import React, { useState } from 'react';
import Papa from 'papaparse';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Upload, Loader2, CheckCircle2 } from 'lucide-react';
import { useToast } from '../hooks/use-toast';

// Lead fields we can import into, with header-name synonyms for auto-mapping.
const FIELDS: { key: string; label: string; required?: boolean; synonyms: string[] }[] = [
  { key: 'name', label: 'Emri', required: true, synonyms: ['name', 'emri', 'full name', 'contact', 'kontakti'] },
  { key: 'email', label: 'Email', synonyms: ['email', 'e-mail', 'mail'] },
  { key: 'phoneNumber', label: 'Telefoni', synonyms: ['phone', 'telefoni', 'phonenumber', 'phone number', 'numri', 'mobile', 'cel'] },
  { key: 'company', label: 'Kompania', synonyms: ['company', 'kompania', 'biznesi', 'business'] },
  { key: 'jobTitle', label: 'Pozicioni', synonyms: ['jobtitle', 'job title', 'title', 'pozicioni', 'roli'] },
  { key: 'website', label: 'Website', synonyms: ['website', 'web', 'faqja', 'url'] },
  { key: 'source', label: 'Burimi', synonyms: ['source', 'burimi', 'kanali'] },
  { key: 'status', label: 'Statusi', synonyms: ['status', 'statusi', 'stage', 'faza'] },
  { key: 'estimatedValue', label: 'Vlera', synonyms: ['value', 'vlera', 'amount', 'estimatedvalue', 'deal'] },
  { key: 'businessCategory', label: 'Kategoria', synonyms: ['category', 'kategoria', 'industry', 'industria'] },
  { key: 'address', label: 'Adresa', synonyms: ['address', 'adresa'] },
  { key: 'notes', label: 'Shënime', synonyms: ['notes', 'shenime', 'shënime', 'note', 'comment'] },
];

const NONE = '__none__';

interface Props {
  open: boolean;
  onClose: () => void;
  onImport: (rows: Record<string, any>[]) => Promise<{ created: number; skipped: number; errors: number }>;
}

const LeadImportDialog: React.FC<Props> = ({ open, onClose, onImport }) => {
  const { toast } = useToast();
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, any>[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ created: number; skipped: number; errors: number } | null>(null);

  const reset = () => { setHeaders([]); setRows([]); setMapping({}); setResult(null); };

  const handleFile = (file: File) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        const hs = (res.meta.fields || []).filter(Boolean);
        setHeaders(hs);
        setRows(res.data as Record<string, any>[]);
        // Auto-map by synonym match
        const auto: Record<string, string> = {};
        FIELDS.forEach(f => {
          const hit = hs.find(h => f.synonyms.includes(h.toLowerCase().trim()));
          auto[f.key] = hit || NONE;
        });
        setMapping(auto);
        setResult(null);
      },
      error: () => toast({ title: 'Gabim', description: 'Skedari CSV nuk u lexua.', variant: 'destructive' }),
    });
  };

  const doImport = async () => {
    if (mapping.name === undefined || mapping.name === NONE) {
      toast({ title: 'Mungon Emri', description: 'Mapo kolonën e emrit (e detyrueshme).', variant: 'destructive' });
      return;
    }
    setImporting(true);
    try {
      const mapped = rows.map(r => {
        const lead: Record<string, any> = {};
        FIELDS.forEach(f => {
          const col = mapping[f.key];
          if (col && col !== NONE && r[col] != null && String(r[col]).trim() !== '') {
            lead[f.key] = String(r[col]).trim();
          }
        });
        return lead;
      }).filter(l => l.name);
      const res = await onImport(mapped);
      setResult(res);
      toast({ title: 'Importi përfundoi', description: `${res.created} të krijuara · ${res.skipped} dublikata · ${res.errors} gabime` });
    } finally {
      setImporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { reset(); onClose(); } }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Importo Leads nga CSV</DialogTitle></DialogHeader>

        {result ? (
          <div className="py-6 text-center space-y-3">
            <CheckCircle2 className="w-10 h-10 mx-auto text-emerald-500" />
            <p className="text-sm">
              <strong>{result.created}</strong> leads u krijuan ·{' '}
              <strong>{result.skipped}</strong> dublikata u anashkaluan ·{' '}
              <strong>{result.errors}</strong> gabime
            </p>
            <Button onClick={() => { reset(); onClose(); }}>Mbyll</Button>
          </div>
        ) : headers.length === 0 ? (
          <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-border rounded-lg py-10 cursor-pointer hover:bg-muted/40">
            <Upload className="w-8 h-8 text-muted-foreground" />
            <span className="text-sm font-medium">Kliko për të zgjedhur një skedar CSV</span>
            <span className="text-xs text-muted-foreground">Rreshti i parë duhet të jetë header-i (emrat e kolonave)</span>
            <input type="file" accept=".csv,text/csv" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
          </label>
        ) : (
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">
              U gjetën <strong>{rows.length}</strong> rreshta. Mapo kolonat e CSV-së me fushat e lead-it:
            </p>
            <div className="space-y-2">
              {FIELDS.map(f => (
                <div key={f.key} className="flex items-center gap-3">
                  <span className="w-28 shrink-0 text-sm">{f.label}{f.required && <span className="text-destructive"> *</span>}</span>
                  <Select value={mapping[f.key] || NONE} onValueChange={(v) => setMapping(prev => ({ ...prev, [f.key]: v }))}>
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
                {importing ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
                Importo {rows.length} leads
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default LeadImportDialog;
