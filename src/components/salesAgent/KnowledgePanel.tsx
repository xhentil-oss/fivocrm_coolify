import { useMemo, useState } from 'react';
import { BookOpen, Loader2, Plus, Trash2 } from 'lucide-react';
import { Card } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Switch } from '../ui/switch';
import { Badge } from '../ui/badge';
import { Textarea } from '../ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { useCollection, useMutation } from '../../hooks/useFirestore';
import { useToast } from '../../hooks/use-toast';
import { SALES_AGENT_LIMITS } from '../../lib/salesAgent/core';
import type { SalesKnowledgeItem, SalesKnowledgeKind } from '../../types';

/**
 * Cilësimet → Agjentja → "Njohuritë e Anës".
 *
 * Every row here is a FACT the agent may state (law 4: numbers never come from the
 * model). The server renders enabled rows into the prompt via `renderSalesFacts()`.
 */
const KIND_LABELS: Record<SalesKnowledgeKind, string> = {
  faq: 'Pyetje e shpeshtë',
  objection: 'Objeksion',
  policy: 'Politikë',
  'service-note': 'Shënim shërbimi',
};

const KIND_HINT: Record<SalesKnowledgeKind, { q: string; a: string }> = {
  faq: { q: 'P.sh. "Sa zgjat ndërtimi i një website-i?"', a: 'P.sh. "Zakonisht 3–4 javë nga miratimi i dizajnit."' },
  objection: { q: 'P.sh. "Jeni shumë shtrenjtë"', a: 'Si i përgjigjemi me respekt, pa zbritje: krahaso me vlerën e një klienti të ri…' },
  policy: { q: 'P.sh. "A ofroni rimbursim?"', a: 'Politika zyrtare — vetëm atë që e thoni edhe në kontratë.' },
  'service-note': { q: 'P.sh. "SEO lokal — çfarë përfshin?"', a: 'Detaje që nuk janë në katalog (procesi, raportimi, kohëzgjatja).' },
};

interface Props { canEdit: boolean }

export default function KnowledgePanel({ canEdit }: Props) {
  const { toast } = useToast();
  const { data: items, loading } = useCollection<SalesKnowledgeItem>('salesKnowledge');
  const { create, update, remove } = useMutation<SalesKnowledgeItem>('salesKnowledge');
  const [kind, setKind] = useState<SalesKnowledgeKind>('faq');
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<SalesKnowledgeKind | 'all'>('all');

  const sorted = useMemo(() => {
    const list = [...(items || [])].sort((a, b) => (a.kind > b.kind ? 1 : a.kind < b.kind ? -1 : a.question.localeCompare(b.question)));
    return filter === 'all' ? list : list.filter((i) => i.kind === filter);
  }, [items, filter]);
  const total = items?.length || 0;
  const full = total >= SALES_AGENT_LIMITS.knowledgeMaxItems;

  const add = async () => {
    if (!canEdit || !question.trim() || !answer.trim() || full) return;
    setBusy(true);
    try {
      await create({ kind, question: question.trim().slice(0, 300), answer: answer.trim().slice(0, 1200), enabled: true, serviceId: null } as any);
      setQuestion(''); setAnswer('');
      toast({ title: 'U shtua', description: 'Ana do ta përdorë nga përgjigja e radhës.' });
    } catch (err) {
      toast({ title: 'Nuk u shtua', description: (err as Error)?.message, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold flex items-center gap-2"><BookOpen className="w-4 h-4" />Njohuritë e Anës</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Faktet që Ana ka të drejtë t'i thotë: pyetje të shpeshta, objeksione, politika. Çmimet i merr nga katalogu i Shërbimeve; çdo gjë tjetër që mungon këtu, ia kalon një kolegu.
          </p>
        </div>
        <Badge variant="outline" className="shrink-0">{total}/{SALES_AGENT_LIMITS.knowledgeMaxItems}</Badge>
      </div>

      {canEdit && (
        <div className="grid gap-2 rounded-lg border p-3 bg-muted/30">
          <div className="grid sm:grid-cols-[180px_1fr] gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Lloji</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as SalesKnowledgeKind)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{(Object.keys(KIND_LABELS) as SalesKnowledgeKind[]).map((k) => <SelectItem key={k} value={k}>{KIND_LABELS[k]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Çfarë thotë klienti</Label>
              <Input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder={KIND_HINT[kind].q} maxLength={300} />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Çfarë mund të përgjigjet Ana</Label>
            <Textarea rows={2} value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder={KIND_HINT[kind].a} maxLength={1200} />
          </div>
          <div className="flex justify-end">
            <Button size="sm" onClick={add} disabled={busy || full || !question.trim() || !answer.trim()}>
              {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}Shto
            </Button>
          </div>
          {full && <p className="text-xs text-amber-700">Kufiri prej {SALES_AGENT_LIMITS.knowledgeMaxItems} rreshtave u arrit — fshi ose çaktivizo disa.</p>}
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {(['all', ...Object.keys(KIND_LABELS)] as Array<SalesKnowledgeKind | 'all'>).map((k) => (
          <button key={k} type="button" onClick={() => setFilter(k)}
            className={`text-xs px-2 py-1 rounded-full border ${filter === k ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-muted'}`}>
            {k === 'all' ? 'Të gjitha' : KIND_LABELS[k]}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Duke ngarkuar…</p>
      ) : sorted.length === 0 ? (
        <p className="text-sm text-muted-foreground">Asnjë rresht ende. Fillo me 5–10 pyetjet që klientët i bëjnë më shpesh.</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {sorted.map((it) => (
            <li key={it.id} className={`p-3 flex gap-3 items-start ${it.enabled === false ? 'opacity-60' : ''}`}>
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline" className="text-[10px]">{KIND_LABELS[it.kind] || it.kind}</Badge>
                  <span className="text-sm font-medium break-words">{it.question}</span>
                </div>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap break-words">{it.answer}</p>
              </div>
              {canEdit && (
                <div className="flex items-center gap-2 shrink-0">
                  <Switch checked={it.enabled !== false} onCheckedChange={(v) => { void update(it.id, { enabled: v } as any); }} aria-label="Aktiv" />
                  <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => { if (confirm('Të fshihet ky rresht?')) void remove(it.id); }} aria-label="Fshi">
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
