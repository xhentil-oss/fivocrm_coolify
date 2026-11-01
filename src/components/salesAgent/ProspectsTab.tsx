import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronUp, Copy, ExternalLink, Globe, Loader2, MapPin, Phone, Search, Star, UserPlus, X } from 'lucide-react';
import { Card } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Badge } from '../ui/badge';
import { Checkbox } from '../ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { useCollection } from '../../hooks/useFirestore';
import { useToast } from '../../hooks/use-toast';
import { getTimestampMs } from '../../lib/utils';
import { safeExternalUrl } from '../../lib/safeUrl';
import { cancelProspectSearch, createProspectSearch, describeSalesAgentError, registerProspects, rejectProspect, SalesAgentApiError } from '../../lib/salesAgent/api';
import { buildCallScript, buildFirstEmailDraft, estimateSearchRequests, prospectServiceLine, SEARCH_BLOCK_LABELS, PLACES_PAGE_SIZE, type SalesAgentPersona } from '../../lib/salesAgent/prospecting';
import type { Prospect, ProspectSearch } from '../../types';
import { PROSPECT_STATUS_CLASS, PROSPECT_STATUS_LABELS, SEARCH_STATUS_CLASS, SEARCH_STATUS_LABELS, reasonLabel } from './labels';

/**
 * Prospektet: run a Google Maps search (queued → the VPS cron executes it), review
 * the inbox with fit scores and reasons, register the good ones as leads (dedupe is
 * server-side through contactIdentity), reject the rest. Unregistered rows expire
 * after 30 days (Places terms).
 */
interface Props {
  canEdit: boolean;
  coldWaEnabled: boolean;
  placesUsed: number;
  placesBudget: number;
  /** Current persona: the drafts are re-rendered with it, never shown from the stale snapshot. */
  persona: SalesAgentPersona;
}

/** Drafts with TODAY's persona (a rename must reach them); the stored snapshot only when the service line is unknown. */
function liveDrafts(p: Prospect, persona: SalesAgentPersona): { email: string; call: string } {
  const serviceLine = prospectServiceLine(p);
  if (!serviceLine) return { email: p.firstMessageDraft || '', call: p.callScript || '' };
  const input = {
    prospect: { name: p.name || '', category: p.category ?? null, city: p.city ?? null, website: p.website ?? null, rating: p.rating ?? null, reviewCount: p.reviewCount ?? null },
    persona, serviceLine, senderName: null,
  };
  return { email: buildFirstEmailDraft(input).body, call: buildCallScript(input) };
}

const fmtDate = (v: unknown) => { const ms = getTimestampMs(v); return ms ? new Date(ms).toLocaleString('sq-AL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''; };

function FitBar({ score }: { score: number }) {
  const color = score >= 70 ? 'bg-emerald-500' : score >= 45 ? 'bg-amber-500' : 'bg-muted-foreground/40';
  return (
    <div className="flex items-center gap-2 min-w-[110px]" title={`Përshtatje ${score}/100`}>
      <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden"><div className={`h-full ${color}`} style={{ width: `${score}%` }} /></div>
      <span className="text-xs tabular-nums w-7 text-right">{score}</span>
    </div>
  );
}

export default function ProspectsTab({ canEdit, coldWaEnabled, placesUsed, placesBudget, persona }: Props) {
  const { toast } = useToast();
  const { data: searches } = useCollection<ProspectSearch>('prospectSearches', { orderBy: { field: 'createdAt', direction: 'desc' } });
  const { data: prospects, loading } = useCollection<Prospect>('prospects', { orderBy: { field: 'fitScore', direction: 'desc' } });

  const [query, setQuery] = useState('');
  const [city, setCity] = useState('');
  const [maxResults, setMaxResults] = useState(40);
  const [creating, setCreating] = useState(false);
  const [searchFilter, setSearchFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('new');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [sendWa, setSendWa] = useState(false);
  const [sendEmail, setSendEmail] = useState(true);
  const [busy, setBusy] = useState(false);

  const estimated = estimateSearchRequests(maxResults);
  const overBudget = placesUsed + estimated > placesBudget;

  const rows = useMemo(() => (prospects || [])
    .filter((p) => searchFilter === 'all' || p.searchId === searchFilter)
    .filter((p) => statusFilter === 'all' || p.status === statusFilter), [prospects, searchFilter, statusFilter]);

  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const selectAllVisible = () => setSelected(new Set(rows.filter((r) => r.status === 'new' || r.status === 'approved').map((r) => r.id)));

  const runSearch = async () => {
    setCreating(true);
    try {
      const r = await createProspectSearch({ query: query.trim(), city: city.trim(), maxResults });
      toast({ title: 'Kërkimi u vu në radhë', description: `Deri në ${estimated} kërkesa Places. Rezultatet shfaqen brenda ~15 minutash.` });
      setQuery('');
      setSearchFilter(r.id);
    } catch (err) {
      const br = err instanceof SalesAgentApiError ? err.blockReason : null;
      toast({ title: 'Kërkimi nuk u krijua', description: (br && (SEARCH_BLOCK_LABELS as Record<string, string>)[br]) || describeSalesAgentError(err), variant: 'destructive' });
    } finally {
      setCreating(false);
    }
  };

  const doRegister = async () => {
    if (!selected.size) return;
    setBusy(true);
    try {
      const r = await registerProspects([...selected], { wa: coldWaEnabled && sendWa, email: sendEmail });
      const waBlocked = (r.outreach?.wa || []).filter((x) => x.blocked).length;
      toast({
        title: `${r.created.length} lead të rinj · ${r.linked.length} të lidhur me ekzistues`,
        description: [r.skipped.length ? `${r.skipped.length} u kapërcyen` : '', waBlocked ? `${waBlocked} WhatsApp u bllokuan nga kufijtë (shih "Pse nuk veproi")` : ''].filter(Boolean).join(' · ') || undefined,
      });
      setSelected(new Set()); setRegisterOpen(false);
    } catch (err) {
      toast({ title: 'Regjistrimi dështoi', description: describeSalesAgentError(err), variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const doReject = async (p: Prospect) => {
    const reason = prompt(`Pse refuzohet "${p.name}"? (opsionale)`) ?? undefined;
    try { await rejectProspect(p.id, reason || undefined); } catch (err) { toast({ title: 'Nuk u refuzua', description: describeSalesAgentError(err), variant: 'destructive' }); }
  };

  const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); toast({ title: 'U kopjua' }); } catch { /* ignore */ } };

  return (
    <div className="space-y-4">
      {/* New search */}
      <Card className="p-4 space-y-3">
        <h3 className="font-semibold flex items-center gap-2"><Search className="w-4 h-4" />Kërkim i ri në Google Maps</h3>
        <div className="grid sm:grid-cols-[1fr_1fr_140px_auto] gap-2 items-end">
          <div className="space-y-1"><Label className="text-xs">Çfarë kërkon</Label><Input value={query} disabled={!canEdit} placeholder='p.sh. "klinika dentare", "restorant", "agjenci imobiliare"' onChange={(e) => setQuery(e.target.value)} /></div>
          <div className="space-y-1"><Label className="text-xs">Qyteti</Label><Input value={city} disabled={!canEdit} placeholder="Tiranë" onChange={(e) => setCity(e.target.value)} /></div>
          <div className="space-y-1">
            <Label className="text-xs">Rezultate</Label>
            <Select value={String(maxResults)} onValueChange={(v) => setMaxResults(Number(v))} disabled={!canEdit}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{[20, 40, 60].map((n) => <SelectItem key={n} value={String(n)}>deri në {n}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <Button onClick={runSearch} disabled={!canEdit || creating || !query.trim() || !city.trim() || overBudget}>{creating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Search className="w-4 h-4 mr-2" />}Kërko</Button>
        </div>
        <p className={`text-xs ${overBudget ? 'text-red-700' : 'text-muted-foreground'}`}>
          Kosto: {estimated} kërkesë/a Places (deri në {estimated * PLACES_PAGE_SIZE} biznese) · kuota mujore: {placesUsed}/{placesBudget} kërkesa{overBudget ? ' — buxheti do të tejkalohej' : ''}. Të dhënat e Google ruhen vetëm për prospektet që i regjistron; të tjerat fshihen pas 30 ditësh.
        </p>
      </Card>

      {/* Searches list */}
      {(searches || []).length > 0 && (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setSearchFilter('all')} className={`text-xs px-2.5 py-1.5 rounded-full border ${searchFilter === 'all' ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-muted'}`}>Të gjitha kërkimet</button>
          {(searches || []).slice(0, 20).map((s) => (
            <button key={s.id} type="button" onClick={() => setSearchFilter(s.id)} className={`text-xs px-2.5 py-1.5 rounded-full border flex items-center gap-1.5 ${searchFilter === s.id ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-muted'}`} title={`${fmtDate(s.createdAt)} · ${s.counts?.found ?? 0} gjetur, ${s.counts?.new ?? 0} të reja, ${s.counts?.duplicate ?? 0} dublikata${s.error ? ` · ${s.error}` : ''}`}>
              <span className="truncate max-w-[180px]">{s.query} · {s.city}</span>
              <Badge className={`${SEARCH_STATUS_CLASS[s.status] || ''} text-[10px] px-1.5 py-0`}>{SEARCH_STATUS_LABELS[s.status] || s.status}{s.status === 'running' && <Loader2 className="w-3 h-3 ml-1 animate-spin inline" />}</Badge>
              {s.status === 'queued' && canEdit && <X className="w-3 h-3 opacity-70 hover:opacity-100" onClick={(e) => { e.stopPropagation(); void cancelProspectSearch(s.id).catch((err) => toast({ title: 'Nuk u anulua', description: describeSalesAgentError(err), variant: 'destructive' })); }} />}
            </button>
          ))}
        </div>
      )}

      {/* Inbox */}
      <Card className="p-0 overflow-hidden">
        <div className="p-3 border-b flex flex-wrap gap-2 items-center justify-between">
          <div className="flex items-center gap-2">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-44 h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="new">Për shqyrtim</SelectItem>
                <SelectItem value="registered">Të regjistruar</SelectItem>
                <SelectItem value="duplicate">Dublikata</SelectItem>
                <SelectItem value="rejected">Të refuzuar</SelectItem>
                <SelectItem value="all">Të gjithë</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground">{rows.length} prospekte</span>
          </div>
          {canEdit && (
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" className="h-8 text-xs" onClick={selectAllVisible} disabled={!rows.length}>Zgjidh të dukshmet</Button>
              <Button size="sm" className="h-8 text-xs" onClick={() => setRegisterOpen(true)} disabled={!selected.size}><UserPlus className="w-3.5 h-3.5 mr-1" />Regjistro si lead ({selected.size})</Button>
            </div>
          )}
        </div>
        {loading ? (
          <p className="p-6 text-sm text-muted-foreground">Duke ngarkuar…</p>
        ) : rows.length === 0 ? (
          <p className="p-8 text-sm text-muted-foreground text-center">{statusFilter === 'new' ? 'Asnjë prospekt për shqyrtim. Nis një kërkim më lart — rezultatet vijnë brenda ~15 minutash.' : 'Asnjë prospekt me këtë filtër.'}</p>
        ) : (
          <ul className="divide-y">
            {rows.map((p) => {
              const open = expanded === p.id;
              const selectable = p.status === 'new' || p.status === 'approved';
              const site = safeExternalUrl(p.website || '');
              return (
                <li key={p.id} className="p-3">
                  <div className="flex items-start gap-3">
                    {canEdit && <Checkbox className="mt-1" checked={selected.has(p.id)} disabled={!selectable} onCheckedChange={() => toggle(p.id)} aria-label={`Zgjidh ${p.name}`} />}
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium truncate">{p.name}</span>
                        <Badge className={`${PROSPECT_STATUS_CLASS[p.status] || ''} text-[10px]`}>{PROSPECT_STATUS_LABELS[p.status] || p.status}</Badge>
                        {p.category && <span className="text-xs text-muted-foreground">{p.category}</span>}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground mt-1">
                        {p.city && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{p.city}</span>}
                        {p.rating !== null && p.rating !== undefined && <span className="flex items-center gap-1"><Star className="w-3 h-3 text-amber-500" />{p.rating}{p.reviewCount ? ` (${p.reviewCount})` : ''}</span>}
                        {p.phone && <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{p.phone}</span>}
                        {site && <a href={site} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:text-foreground"><Globe className="w-3 h-3" />website</a>}
                        {p.status === 'duplicate' && p.matchedContactId && (
                          <Link to={p.matchedContactKind === 'customer' ? `/app/customers?customer=${p.matchedContactId}` : `/app/crm?lead=${p.matchedContactId}`} className="text-primary hover:underline flex items-center gap-1">Hap kontaktin ekzistues <ExternalLink className="w-3 h-3" /></Link>
                        )}
                        {p.status === 'registered' && p.leadId && <Link to={`/app/crm?lead=${p.leadId}`} className="text-primary hover:underline flex items-center gap-1">Hap lead-in <ExternalLink className="w-3 h-3" /></Link>}
                      </div>
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {(p.fitReasons || []).slice(0, 5).map((r) => <span key={r} className="text-[10px] px-1.5 py-0.5 rounded bg-muted">{r}</span>)}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2 shrink-0">
                      <FitBar score={p.fitScore ?? 0} />
                      <div className="flex items-center gap-1">
                        {canEdit && selectable && <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => doReject(p)}>Refuzo</Button>}
                        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setExpanded(open ? null : p.id)}>{open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}</Button>
                      </div>
                    </div>
                  </div>
                  {open && (() => { const d = liveDrafts(p, persona); return (
                    <div className="mt-3 grid lg:grid-cols-2 gap-3">
                      <div className="rounded-md border p-3 bg-muted/20">
                        <div className="flex items-center justify-between mb-1"><span className="text-xs font-semibold">Mesazhi i parë (draft)</span>{d.email && <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => copy(d.email)}><Copy className="w-3 h-3 mr-1" />Kopjo</Button>}</div>
                        <p className="text-xs whitespace-pre-wrap">{d.email || 'Gjenerohet kur prospekti regjistrohet.'}</p>
                      </div>
                      <div className="rounded-md border p-3 bg-muted/20">
                        <div className="flex items-center justify-between mb-1"><span className="text-xs font-semibold">Skripti i telefonatës</span>{d.call && <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => copy(d.call)}><Copy className="w-3 h-3 mr-1" />Kopjo</Button>}</div>
                        <p className="text-xs whitespace-pre-wrap">{d.call || '—'}</p>
                      </div>
                      {p.address && <p className="text-xs text-muted-foreground lg:col-span-2">{p.address}{p.rejectReason ? ` · Arsyeja e refuzimit: ${reasonLabel(p.rejectReason)}` : ''}</p>}
                    </div>
                  ); })()}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Dialog open={registerOpen} onOpenChange={setRegisterOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Regjistro {selected.size} prospekt(e) si lead</DialogTitle>
            <DialogDescription>Secili kalon kontrollin e dublikatave (telefon, website, emër + qytet). Një kontakt ekzistues lidhet, nuk krijohet dy herë. Çdo lead i ri merr hapin tjetër "Kontakt i parë".</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <label className="flex items-start gap-2 text-sm"><Checkbox checked={sendEmail} onCheckedChange={(v) => setSendEmail(!!v)} className="mt-0.5" /><span>Përgatit email-in e parë (dërgohet sipas nivelit të autonomisë; në nivelin 0–1 mbetet draft)</span></label>
            {coldWaEnabled ? (
              <label className="flex items-start gap-2 text-sm"><Checkbox checked={sendWa} onCheckedChange={(v) => setSendWa(!!v)} className="mt-0.5" /><span>Dërgo mesazh të parë në WhatsApp <span className="text-muted-foreground">(brenda kufijve: ≤ 10/ditë, 1/orë, nga nesër, vetëm ditët e punës)</span></span></label>
            ) : (
              <p className="text-xs text-muted-foreground">Mesazhet e ftohta WhatsApp janë të fikura (Cilësimet → Mesazhi i parë në WhatsApp).</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRegisterOpen(false)} disabled={busy}>Anulo</Button>
            <Button onClick={doRegister} disabled={busy}>{busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <UserPlus className="w-4 h-4 mr-2" />}Regjistro</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
