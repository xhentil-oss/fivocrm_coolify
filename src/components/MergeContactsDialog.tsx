import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeftRight, Check, Info, Loader2, Merge, Search, X } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Badge } from './ui/badge';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../hooks/use-toast';
import { findContactMatch, matchFieldLabel } from '../lib/contactIdentity';
import {
  buildFieldPlan, contactKindLabel, defaultChoices, mergeCollectionLabel,
  rankMergeCandidates, resolveMergedValues, totalMoved, visibleFieldPlan,
  type ContactKind, type FieldDecision, type MergeChoice,
} from '../lib/contactMerge';

export interface MergeableContact extends Record<string, any> {
  id: string;
  name?: string;
}

interface Props {
  kind: ContactKind;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Every record of this kind in the tenant — the pool the two sides are picked from. */
  records: MergeableContact[];
  /** Pre-selected survivor / absorbed record (from the duplicates list or a 2-row selection). */
  initialPrimaryId?: string;
  initialDuplicateId?: string;
  onMerged?: (info: { primaryId: string; duplicateId: string; total: number }) => void;
}

interface MergePreview {
  moved: Record<string, number>;
  total: number;
  truncated: boolean;
  warnings: string[];
}

/**
 * Manual merge of two duplicate contacts.
 *
 * Three decisions, in the order a human makes them: WHICH record survives, WHAT
 * each field ends up as, and — before anything is written — WHAT will be moved
 * onto the survivor (fetched as a dry run from the server, which is the only side
 * that can see every collection involved).
 */
const MergeContactsDialog: React.FC<Props> = ({
  kind, open, onOpenChange, records, initialPrimaryId, initialDuplicateId, onMerged,
}) => {
  const { user } = useAuth();
  const { toast } = useToast();

  const [primaryId, setPrimaryId] = useState(initialPrimaryId || '');
  const [duplicateId, setDuplicateId] = useState(initialDuplicateId || '');
  const [choices, setChoices] = useState<Record<string, MergeChoice>>({});
  const [search, setSearch] = useState('');
  const [pickerFor, setPickerFor] = useState<'primary' | 'duplicate' | null>(null);
  const [preview, setPreview] = useState<MergePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [merging, setMerging] = useState(false);

  const byId = useMemo(() => new Map(records.map(r => [r.id, r])), [records]);
  const primary = primaryId ? byId.get(primaryId) : undefined;
  const duplicate = duplicateId ? byId.get(duplicateId) : undefined;

  // Reset to the caller's selection each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setPrimaryId(initialPrimaryId || '');
    setDuplicateId(initialDuplicateId || '');
    setSearch('');
    setPickerFor(initialPrimaryId && initialDuplicateId ? null : 'duplicate');
    setPreview(null);
  }, [open, initialPrimaryId, initialDuplicateId]);

  const plan = useMemo<FieldDecision[]>(
    () => (primary && duplicate ? visibleFieldPlan(buildFieldPlan(kind, primary, duplicate)) : []),
    [kind, primary, duplicate],
  );

  // Field choices follow the pair — swapping the sides re-suggests everything.
  useEffect(() => {
    setChoices(defaultChoices(plan));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [primaryId, duplicateId, plan.length]);

  // Dry run: what the server would move. Re-run whenever the absorbed record changes.
  useEffect(() => {
    if (!open || !primaryId || !duplicateId || !user) { setPreview(null); return; }
    let cancelled = false;
    setPreviewLoading(true);
    setPreview(null);
    (async () => {
      try {
        const token = await user.getIdToken();
        const res = await fetch('/api/merge-contacts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ kind, primaryId, duplicateId, dryRun: true }),
        });
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          toast({ title: 'Parashikimi dështoi', description: json?.error || 'Provo përsëri.', variant: 'destructive' });
          return;
        }
        setPreview({
          moved: json.moved || {},
          total: json.total || 0,
          truncated: !!json.truncated,
          warnings: json.warnings || [],
        });
      } catch {
        if (!cancelled) toast({ title: 'Parashikimi dështoi', description: 'Nuk u lidh me serverin.', variant: 'destructive' });
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, kind, primaryId, duplicateId, user]);

  const filteredRecords = useMemo(() => {
    const exclude = pickerFor === 'primary' ? duplicateId : primaryId;
    const q = search.trim().toLowerCase();
    const pool = rankMergeCandidates(records.filter(r => r.id !== exclude) as any) as MergeableContact[];
    const matched = q
      ? pool.filter(r => [r.name, r.email, r.phone, r.phoneNumber, r.company]
        .some(v => String(v || '').toLowerCase().includes(q)))
      : pool;
    return matched.slice(0, 40);
  }, [records, search, pickerFor, primaryId, duplicateId]);

  /** Not identity-matched → a manual merge is allowed, but flag it loudly. */
  const identityWarning = useMemo(() => {
    if (!primary || !duplicate) return null;
    const match = findContactMatch(duplicate as any, [primary as any]);
    return match
      ? `Përputhen: ${matchFieldLabel(match.on)}.`
      : 'Këta dy rekorde NUK kanë email apo telefon të njëjtë — sigurohu që është vërtet i njëjti person.';
  }, [primary, duplicate]);

  const swap = () => {
    setPrimaryId(duplicateId);
    setDuplicateId(primaryId);
  };

  const handleMerge = async () => {
    if (!primary || !duplicate || !user) return;
    setMerging(true);
    try {
      const fields = resolveMergedValues(kind, primary, duplicate, choices);
      const token = await user.getIdToken();
      const res = await fetch('/api/merge-contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ kind, primaryId, duplicateId, fields }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast({ title: 'Bashkimi dështoi', description: json?.error || 'Provo përsëri.', variant: 'destructive' });
        return;
      }
      const moved = totalMoved(json.moved);
      const cascadeMoved = json.cascade ? totalMoved(json.cascade.moved) : 0;
      toast({
        title: json.truncated ? 'Bashkim i pjesshëm' : 'Rekordet u bashkuan',
        description: json.truncated
          ? `${moved} rekorde u zhvendosën, por dublikata nuk u fshi — ekzekutoje përsëri.`
          : `${moved + cascadeMoved} rekorde (fatura, projekte, preventiva, …) i kaluan "${primary.name || 'rekordit'}".`,
        variant: json.truncated ? 'destructive' : undefined,
      });
      (json.warnings || []).slice(0, 3).forEach((w: string) =>
        toast({ title: 'Kujdes', description: w, variant: 'destructive' }));
      onMerged?.({ primaryId, duplicateId, total: moved });
      onOpenChange(false);
    } catch {
      toast({ title: 'Bashkimi dështoi', description: 'Nuk u lidh me serverin.', variant: 'destructive' });
    } finally {
      setMerging(false);
    }
  };

  const kindLabel = contactKindLabel(kind);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full max-w-full sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Merge className="w-5 h-5" /> Bashko {kind === 'customer' ? 'klientë' : 'lead'} dublikatë
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          {/* ── which record survives ── */}
          <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr] items-stretch">
            <ContactSide
              title="Mbetet (rekordi kryesor)"
              tone="primary"
              record={primary}
              onPick={() => { setPickerFor('primary'); setSearch(''); }}
            />
            <div className="flex sm:flex-col items-center justify-center gap-2">
              <Button
                type="button" variant="outline" size="sm"
                className="gap-1"
                disabled={!primary || !duplicate}
                onClick={swap}
                title="Ndërro anët"
              >
                <ArrowLeftRight className="w-3.5 h-3.5" />
                <span className="sm:hidden">Ndërro</span>
              </Button>
            </div>
            <ContactSide
              title="Fshihet (bashkohet brenda)"
              tone="duplicate"
              record={duplicate}
              onPick={() => { setPickerFor('duplicate'); setSearch(''); }}
            />
          </div>

          {/* ── record picker ── */}
          {pickerFor && (
            <div className="rounded-lg border border-border p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">
                  Zgjidh {pickerFor === 'primary' ? 'rekordin që mbetet' : `${kindLabel}in që bashkohet brenda`}
                </p>
                <Button type="button" variant="ghost" size="sm" onClick={() => setPickerFor(null)}>
                  <X className="w-4 h-4" />
                </Button>
              </div>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  autoFocus
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Kërko me emër, email, telefon ose kompani…"
                  className="pl-8"
                />
              </div>
              <div className="max-h-56 overflow-y-auto divide-y divide-border rounded-md border border-border">
                {filteredRecords.length === 0 && (
                  <p className="p-3 text-sm text-muted-foreground">Asnjë rekord.</p>
                )}
                {filteredRecords.map(r => (
                  <button
                    key={r.id}
                    type="button"
                    className="w-full text-left px-3 py-2 hover:bg-muted/60 transition-colors"
                    onClick={() => {
                      if (pickerFor === 'primary') setPrimaryId(r.id); else setDuplicateId(r.id);
                      setPickerFor(null);
                    }}
                  >
                    <p className="text-sm font-medium truncate">{r.name || '(pa emër)'}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {[r.email, r.phone || r.phoneNumber, r.company].filter(Boolean).join(' · ') || '—'}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {primary && duplicate && (
            <>
              {identityWarning && (
                <div className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${
                  identityWarning.startsWith('Përputhen')
                    ? 'border-border bg-muted/40 text-muted-foreground'
                    : 'border-warning/40 bg-warning/10 text-foreground'
                }`}>
                  {identityWarning.startsWith('Përputhen')
                    ? <Info className="w-4 h-4 mt-0.5 shrink-0" />
                    : <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-warning" />}
                  <span>{identityWarning}</span>
                </div>
              )}

              {/* ── field-by-field resolution ── */}
              <div className="space-y-2">
                <p className="text-sm font-medium">Të dhënat që mbeten</p>
                {plan.length === 0 && (
                  <p className="text-sm text-muted-foreground">Të dyja rekordet kanë të njëjtat të dhëna.</p>
                )}
                <div className="space-y-2">
                  {plan.map(d => (
                    <FieldRow
                      key={d.key}
                      decision={d}
                      choice={choices[d.key] || d.suggested}
                      onChoose={(c) => setChoices(prev => ({ ...prev, [d.key]: c }))}
                    />
                  ))}
                </div>
              </div>

              {/* ── what moves ── */}
              <div className="rounded-lg border border-border p-3">
                <p className="text-sm font-medium mb-2">Çfarë kalon te rekordi kryesor</p>
                {previewLoading && (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> Po llogaritet…
                  </p>
                )}
                {!previewLoading && preview && preview.total === 0 && (
                  <p className="text-sm text-muted-foreground">
                    Rekordi dublikat nuk ka fatura, projekte ose të dhëna të lidhura.
                  </p>
                )}
                {!previewLoading && preview && preview.total > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(preview.moved)
                      .filter(([, n]) => n > 0)
                      .sort((a, b) => b[1] - a[1])
                      .map(([coll, n]) => (
                        <Badge key={coll} variant="secondary" className="font-normal">
                          {mergeCollectionLabel(coll)}: {n}
                        </Badge>
                      ))}
                  </div>
                )}
                {!previewLoading && preview?.truncated && (
                  <p className="mt-2 text-xs text-warning">
                    Ka shumë rekorde lidhur — bashkimi do të bëhet në disa hapa dhe dublikata fshihet vetëm në fund.
                  </p>
                )}
                {!previewLoading && preview?.warnings?.length ? (
                  <ul className="mt-2 space-y-0.5">
                    {preview.warnings.slice(0, 4).map((w, i) => (
                      <li key={i} className="text-xs text-muted-foreground">· {w}</li>
                    ))}
                  </ul>
                ) : null}
                <p className="mt-2 text-xs text-muted-foreground">
                  Rekordi që fshihet ruhet i plotë në historikun e bashkimeve, që gabimi të mund të rikthehet.
                </p>
              </div>
            </>
          )}
        </div>

        <div className="flex flex-col sm:flex-row justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={merging}>
            Anulo
          </Button>
          <Button
            type="button"
            onClick={handleMerge}
            disabled={!primary || !duplicate || merging || previewLoading}
            className="gap-2"
          >
            {merging ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            Bashko dhe fshi dublikatën
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

const ContactSide: React.FC<{
  title: string;
  tone: 'primary' | 'duplicate';
  record?: MergeableContact;
  onPick: () => void;
}> = ({ title, tone, record, onPick }) => (
  <div className={`rounded-lg border p-3 ${
    tone === 'primary' ? 'border-primary/50 bg-primary/5' : 'border-destructive/40 bg-destructive/5'
  }`}>
    <div className="flex items-center justify-between gap-2">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{title}</p>
      <Button type="button" variant="ghost" size="sm" className="h-6 text-xs" onClick={onPick}>
        Ndrysho
      </Button>
    </div>
    {record ? (
      <>
        <p className="mt-1 font-medium truncate">{record.name || '(pa emër)'}</p>
        <p className="text-xs text-muted-foreground truncate">
          {[record.email, record.phone || record.phoneNumber, record.company].filter(Boolean).join(' · ') || '—'}
        </p>
      </>
    ) : (
      <button type="button" onClick={onPick} className="mt-1 text-sm text-primary hover:underline">
        Zgjidh rekordin
      </button>
    )}
  </div>
);

/** Pretty-print any stored value for the comparison row. */
function displayValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (Array.isArray(v)) return v.length ? v.join(', ') : '—';
  if (typeof v === 'number') return String(v);
  const s = String(v).trim();
  return s === '' ? '—' : s;
}

const FieldRow: React.FC<{
  decision: FieldDecision;
  choice: MergeChoice;
  onChoose: (c: MergeChoice) => void;
}> = ({ decision, choice, onChoose }) => {
  const options: { value: MergeChoice; label: string; preview: string }[] = [
    { value: 'primary', label: 'Kryesori', preview: displayValue(decision.primaryValue) },
    { value: 'secondary', label: 'Dublikata', preview: displayValue(decision.secondaryValue) },
  ];
  const canKeepBoth = decision.mode === 'tags' || decision.mode === 'long';
  if (canKeepBoth) options.push({ value: 'both', label: 'Të dyja', preview: 'bashkohen' });

  const isConflict = decision.status === 'conflict';

  return (
    <div className={`rounded-md border p-2.5 ${isConflict ? 'border-warning/40 bg-warning/5' : 'border-border'}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium">{decision.label}</p>
        {isConflict && <span className="text-[10px] uppercase tracking-wide text-warning">konflikt</span>}
      </div>
      <div className="mt-1.5 grid gap-1.5" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
        {options.map(opt => {
          const selected = choice === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChoose(opt.value)}
              aria-pressed={selected}
              className={`text-left rounded-md border px-2 py-1.5 transition-colors ${
                selected ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted/60'
              }`}
            >
              <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">{opt.label}</span>
              <span className="block text-xs truncate" title={opt.preview}>{opt.preview}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default MergeContactsDialog;
