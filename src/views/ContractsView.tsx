import React, { useState, useMemo } from 'react';
import { useCollection, useMutation, getGlobalTeamId } from '../hooks/useFirestore';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../hooks/use-toast';
import {
  ScrollText, Plus, Send, Eye, Pencil, Trash2, Loader2, FileText,
  User, Calendar, ChevronDown, ChevronUp, Download,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Separator } from '../components/ui/separator';
import type { Contract, Customer, Quote, Invoice } from '../types';

const STATUS_COLORS: Record<string, string> = {
  Draft: 'bg-gray-100 text-gray-700',
  Sent: 'bg-blue-100 text-blue-700',
  Signed: 'bg-green-100 text-green-700',
  Rejected: 'bg-red-100 text-red-700',
  Expired: 'bg-orange-100 text-orange-700',
};

const STATUS_LABELS: Record<string, string> = {
  Draft: 'Draft',
  Sent: 'Dërguar',
  Signed: 'Nënshkruar',
  Rejected: 'Refuzuar',
  Expired: 'Skaduar',
};

function defaultBody(clientName: string): string {
  return `Kjo kontratë shërbimi lidhet ndërmjet palëve:

OFRUESI I SHËRBIMIT: [Emri i Kompanisë]
KLIENTI: ${clientName}

SHËRBIMET E OFRUARA:
Sipas paketës së zgjedhur dhe çmimeve të aprovuara.

KUSHTET E PAGESËS:
Pagesat kryhen sipas faturave të lëshuara, brenda 15 ditëve nga data e faturës.

AFATI I KONTRATËS:
Kjo kontratë hyn në fuqi nga data e nënshkrimit dhe qëndron e vlefshme deri sa njëra palë ta ndërpresë me njoftim 30-ditor me shkrim.

DETYRIMET E PALËVE:
• Ofruesi zotohet të ofrojë shërbimet sipas cilësisë dhe afateve të dakordësuara.
• Klienti zotohet të kryejë pagesat sipas afateve dhe të ofrojë materialet e nevojshme në kohë.

KONFIDENCIALITETI:
Të dyja palët bien dakord të mbajnë konfidenciale të gjitha informacionet e ndarë gjatë bashkëpunimit.

NDËRPRERJA:
Secila palë ka të drejtë ta ndërpresë kontratën me njoftim 30-ditor me shkrim.

PRANIMI I KUSHTEVE:
Duke nënshkruar këtë kontratë, klienti konfirmon se ka lexuar, kuptuar dhe pranuar të gjitha kushtet e mësipërme.`;
}

const ContractsView: React.FC = () => {
  const { user } = useAuth();
  const { toast } = useToast();

  const { data: contracts, loading } = useCollection<Contract>('contracts');
  const { data: customers } = useCollection<Customer>('customers', { skipTeamFilter: true });
  const { data: quotes } = useCollection<Quote>('quotes', { skipTeamFilter: true });
  const { data: invoices } = useCollection<Invoice>('invoices', { skipTeamFilter: true });
  const contractMutation = useMutation<Contract>('contracts');

  const [statusFilter, setStatusFilter] = useState<string>('__all__');
  const [searchQ, setSearchQ] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [viewContract, setViewContract] = useState<Contract | null>(null);
  const [editContract, setEditContract] = useState<Contract | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Create form state
  const [formCustomerId, setFormCustomerId] = useState('');
  const [formQuoteId, setFormQuoteId] = useState('__none__');
  const [formInvoiceId, setFormInvoiceId] = useState('__none__');
  const [formTitle, setFormTitle] = useState('');
  const [formBody, setFormBody] = useState('');
  const [formExpiry, setFormExpiry] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const filteredContracts = useMemo(() => {
    let list = contracts || [];
    if (statusFilter !== '__all__') list = list.filter(c => c.status === statusFilter);
    if (searchQ.trim()) {
      const q = searchQ.toLowerCase();
      list = list.filter(c =>
        c.title.toLowerCase().includes(q) ||
        c.clientName.toLowerCase().includes(q) ||
        (c.clientEmail || '').toLowerCase().includes(q)
      );
    }
    return [...list].sort((a, b) => {
      const ta = a.createdAt instanceof Date ? a.createdAt.getTime() : (a.createdAt as any)?.toDate?.()?.getTime() ?? 0;
      const tb = b.createdAt instanceof Date ? b.createdAt.getTime() : (b.createdAt as any)?.toDate?.()?.getTime() ?? 0;
      return tb - ta;
    });
  }, [contracts, statusFilter, searchQ]);

  const customerQuotes = useMemo(() => {
    if (!formCustomerId || !quotes) return [];
    return quotes.filter(q => q.customerId === formCustomerId || q.leadId);
  }, [formCustomerId, quotes]);

  const customerInvoices = useMemo(() => {
    if (!formCustomerId || !invoices) return [];
    return invoices.filter(inv => inv.customerId === formCustomerId);
  }, [formCustomerId, invoices]);

  const onCustomerChange = (cid: string) => {
    setFormCustomerId(cid);
    setFormQuoteId('__none__');
    setFormInvoiceId('__none__');
    const cust = customers?.find(c => c.id === cid);
    if (cust) {
      setFormTitle(`Kontratë Shërbimi — ${cust.name}`);
      setFormBody(defaultBody(cust.name));
    }
  };

  const onQuoteChange = (qid: string) => {
    setFormQuoteId(qid);
    if (qid === '__none__') return;
    const q = quotes?.find(x => x.id === qid);
    if (!q) return;
    const cur = q.currency === 'EUR' ? '€' : q.currency === 'USD' ? '$' : 'L';
    const pkgLines = (q.result?.categories || [])
      .filter(c => c.oneTime > 0 || c.monthly > 0)
      .map(c => `  • ${c.category}: ${c.oneTime > 0 ? `${c.oneTime.toLocaleString()}${cur} (one-time)` : ''} ${c.monthly > 0 ? `${c.monthly.toLocaleString()}${cur}/muaj` : ''}`.trim())
      .join('\n');

    const custName = customers?.find(c => c.id === formCustomerId)?.name || formCustomerId;
    const label = q.label || q.result?.suggestedLabel || 'Paketa';
    setFormTitle(`Kontratë — ${label} — ${custName}`);
    setFormBody(
      defaultBody(custName) +
      `\n\n---\nPAKETA E ZGJEDHUR: ${label}\n${pkgLines}\n\nTotali One-time: ${(q.result?.totalOneTime ?? 0).toLocaleString()} ${cur}\nTotali Mujor: ${(q.result?.totalMonthly ?? 0).toLocaleString()} ${cur}/muaj${q.result?.grandTotal ? `\nGrand Total: ${q.result.grandTotal.toLocaleString()} ${cur}` : ''}`
    );
  };

  const resetForm = () => {
    setFormCustomerId('');
    setFormQuoteId('__none__');
    setFormInvoiceId('__none__');
    setFormTitle('');
    setFormBody('');
    setFormExpiry('');
    setFormNotes('');
  };

  const openEdit = (c: Contract) => {
    setEditContract(c);
    setFormCustomerId(c.customerId || '');
    setFormQuoteId(c.quoteId || '__none__');
    setFormInvoiceId(c.invoiceId || '__none__');
    setFormTitle(c.title);
    setFormBody(c.body);
    setFormExpiry(c.expiresAt instanceof Date ? c.expiresAt.toISOString().split('T')[0] : (c.expiresAt as any)?.toDate?.()?.toISOString().split('T')[0] || '');
    setFormNotes(c.notes || '');
  };

  const handleSave = async () => {
    if (!formCustomerId || !formTitle.trim() || !formBody.trim()) {
      toast({ title: 'Plotëso fushat e detyrueshme', variant: 'destructive' });
      return;
    }
    setSaving(true);
    const cust = customers?.find(c => c.id === formCustomerId);
    const q = formQuoteId !== '__none__' ? quotes?.find(x => x.id === formQuoteId) : null;
    const inv = formInvoiceId !== '__none__' ? invoices?.find(x => x.id === formInvoiceId) : null;
    const teamId = getGlobalTeamId() || '';

    const packageSummary = q ? {
      label: q.label || q.result?.suggestedLabel || 'Paketa',
      currency: q.currency || 'EUR',
      categories: (q.result?.categories || []).map(cat => ({
        category: cat.category,
        oneTime: cat.oneTime || 0,
        monthly: cat.monthly || 0,
      })),
      totalOneTime: q.result?.totalOneTime ?? 0,
      totalMonthly: q.result?.totalMonthly ?? 0,
      grandTotal: q.result?.grandTotal ?? 0,
      discountLabel: q.result?.bundleDiscountLabel,
      discountAmount: q.result?.bundleDiscountAmount,
    } : undefined;

    try {
      if (editContract) {
        await contractMutation.update(editContract.id, {
          customerId: formCustomerId,
          clientName: cust?.name || formCustomerId,
          clientEmail: cust?.email || undefined,
          quoteId: formQuoteId !== '__none__' ? formQuoteId : undefined,
          invoiceId: formInvoiceId !== '__none__' ? formInvoiceId : undefined,
          title: formTitle.trim(),
          body: formBody.trim(),
          notes: formNotes.trim() || undefined,
          expiresAt: formExpiry ? new Date(formExpiry) : undefined,
          packageSummary,
          updatedAt: new Date(),
        } as any);
        toast({ title: '✅ Kontrata u përditësua!' });
        setEditContract(null);
      } else {
        await contractMutation.create({
          teamId,
          customerId: formCustomerId,
          clientName: cust?.name || formCustomerId,
          clientEmail: cust?.email || undefined,
          leadId: cust?.leadId || undefined,
          quoteId: formQuoteId !== '__none__' ? formQuoteId : undefined,
          invoiceId: formInvoiceId !== '__none__' ? formInvoiceId : undefined,
          title: formTitle.trim(),
          body: formBody.trim(),
          notes: formNotes.trim() || undefined,
          expiresAt: formExpiry ? new Date(formExpiry) : undefined,
          packageSummary,
          status: 'Draft',
          createdByUserId: user?.uid || null,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as any);
        toast({ title: '✅ Kontrata u krijua!' });
        setShowCreate(false);
      }
      resetForm();
    } catch {
      toast({ title: 'Gabim', description: 'Ndodhi një gabim', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleSend = async (c: Contract) => {
    setSendingId(c.id);
    try {
      await contractMutation.update(c.id, { status: 'Sent', sentAt: new Date(), updatedAt: new Date() } as any);
      toast({ title: '✅ Kontrata u dërgua te klienti!' });
    } catch {
      toast({ title: 'Gabim', variant: 'destructive' });
    } finally {
      setSendingId(null);
    }
  };

  const handleDelete = async (c: Contract) => {
    if (!confirm(`Fshi kontratën "${c.title}"?`)) return;
    setDeletingId(c.id);
    try {
      await contractMutation.remove(c.id);
      toast({ title: 'Kontrata u fshi' });
    } catch {
      toast({ title: 'Gabim', variant: 'destructive' });
    } finally {
      setDeletingId(null);
    }
  };

  const formatDate = (d: any) => {
    if (!d) return '—';
    const date = d instanceof Date ? d : d?.toDate?.();
    if (!date) return '—';
    return date.toLocaleDateString('sq-AL', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  const isFormOpen = showCreate || !!editContract;

  const stats = useMemo(() => ({
    total: contracts?.length ?? 0,
    sent: contracts?.filter(c => c.status === 'Sent').length ?? 0,
    signed: contracts?.filter(c => c.status === 'Signed').length ?? 0,
    pending: contracts?.filter(c => c.status === 'Draft').length ?? 0,
  }), [contracts]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ScrollText className="w-6 h-6" /> Kontratat
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Krijoni, dërgoni dhe monitoroni kontratat e klientëve
          </p>
        </div>
        <Button onClick={() => { resetForm(); setShowCreate(true); }}>
          <Plus className="w-4 h-4 mr-1.5" /> Kontratë e Re
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Gjithsej', value: stats.total, color: 'text-foreground' },
          { label: 'Draft', value: stats.pending, color: 'text-gray-600' },
          { label: 'Dërguar', value: stats.sent, color: 'text-blue-600' },
          { label: 'Nënshkruar', value: stats.signed, color: 'text-green-600' },
        ].map(s => (
          <Card key={s.label} className="py-3">
            <CardContent className="px-4 py-0">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <Input
          placeholder="Kërko kontratë..."
          value={searchQ}
          onChange={e => setSearchQ(e.target.value)}
          className="max-w-xs"
        />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Të gjitha</SelectItem>
            <SelectItem value="Draft">Draft</SelectItem>
            <SelectItem value="Sent">Dërguar</SelectItem>
            <SelectItem value="Signed">Nënshkruar</SelectItem>
            <SelectItem value="Rejected">Refuzuar</SelectItem>
            <SelectItem value="Expired">Skaduar</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Contract List */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : filteredContracts.length === 0 ? (
            <div className="text-center py-16 space-y-3">
              <FileText className="w-12 h-12 mx-auto text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">
                {contracts?.length === 0 ? 'Nuk ka kontratat ende. Krijoni të parën!' : 'Nuk u gjet asnjë kontratë.'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted border-b">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">Titulli</th>
                    <th className="px-4 py-3 text-left font-medium">Klienti</th>
                    <th className="px-4 py-3 text-left font-medium">Statusi</th>
                    <th className="px-4 py-3 text-left font-medium">Data</th>
                    <th className="px-4 py-3 text-left font-medium">Dërguar</th>
                    <th className="px-4 py-3 text-left font-medium">Nënshkruar</th>
                    <th className="px-4 py-3 text-center font-medium">Veprime</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredContracts.map(c => (
                    <tr key={c.id} className="hover:bg-muted/40 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-medium max-w-[220px] truncate">{c.title}</div>
                        {c.packageSummary && (
                          <div className="text-xs text-muted-foreground">{c.packageSummary.label}</div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <User className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                          <span className="truncate max-w-[140px]">{c.clientName}</span>
                        </div>
                        {c.clientEmail && (
                          <div className="text-xs text-muted-foreground truncate max-w-[160px]">{c.clientEmail}</div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="secondary" className={STATUS_COLORS[c.status] || ''}>
                          {STATUS_LABELS[c.status] || c.status}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{formatDate(c.createdAt)}</td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{c.sentAt ? formatDate(c.sentAt) : '—'}</td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                        {c.signedAt ? (
                          <span className="text-green-600 font-medium">{formatDate(c.signedAt)}</span>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-1">
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setViewContract(c)} title="Shiko">
                            <Eye className="w-3.5 h-3.5" />
                          </Button>
                          {c.status === 'Draft' && (
                            <>
                              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => openEdit(c)} title="Edito">
                                <Pencil className="w-3.5 h-3.5" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0 text-blue-600 hover:text-blue-700"
                                onClick={() => handleSend(c)}
                                disabled={sendingId === c.id}
                                title="Dërgo te klienti"
                              >
                                {sendingId === c.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0 text-red-500 hover:text-red-600"
                                onClick={() => handleDelete(c)}
                                disabled={deletingId === c.id}
                                title="Fshi"
                              >
                                {deletingId === c.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                              </Button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create / Edit Dialog */}
      <Dialog open={isFormOpen} onOpenChange={(open) => { if (!open) { setShowCreate(false); setEditContract(null); resetForm(); } }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editContract ? 'Edito Kontratën' : 'Kontratë e Re'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            {/* Customer */}
            <div className="space-y-1.5">
              <Label>Klienti <span className="text-red-500">*</span></Label>
              <Select value={formCustomerId} onValueChange={onCustomerChange} disabled={!!editContract}>
                <SelectTrigger>
                  <SelectValue placeholder="Zgjidh klientin..." />
                </SelectTrigger>
                <SelectContent>
                  {customers?.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.name}{c.email ? ` — ${c.email}` : ''}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Quote link */}
            {formCustomerId && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Lidhja me Preventivë (opsionale)</Label>
                  <Select value={formQuoteId} onValueChange={onQuoteChange}>
                    <SelectTrigger>
                      <SelectValue placeholder="Asnjë" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Asnjë</SelectItem>
                      {quotes?.filter(q => q.customerId === formCustomerId || q.leadId).map(q => (
                        <SelectItem key={q.id} value={q.id}>
                          {q.label || q.result?.suggestedLabel || q.id} ({q.status})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Lidhja me Faturë (opsionale)</Label>
                  <Select value={formInvoiceId} onValueChange={setFormInvoiceId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Asnjë" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Asnjë</SelectItem>
                      {customerInvoices.map(inv => (
                        <SelectItem key={inv.id} value={inv.id}>
                          {inv.invoiceNumber || inv.id} — {inv.amount?.toLocaleString()} {inv.currency}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            {/* Title */}
            <div className="space-y-1.5">
              <Label>Titulli i Kontratës <span className="text-red-500">*</span></Label>
              <Input value={formTitle} onChange={e => setFormTitle(e.target.value)} placeholder="Kontratë Shërbimi — Emri i Klientit" />
            </div>

            {/* Body */}
            <div className="space-y-1.5">
              <Label>Teksti i Kontratës <span className="text-red-500">*</span></Label>
              <Textarea
                value={formBody}
                onChange={e => setFormBody(e.target.value)}
                rows={14}
                className="font-mono text-xs"
                placeholder="Shkruani tekstin e kontratës..."
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              {/* Expiry */}
              <div className="space-y-1.5">
                <Label>Data e Skadimit (opsionale)</Label>
                <Input type="date" value={formExpiry} onChange={e => setFormExpiry(e.target.value)} />
              </div>
              {/* Notes */}
              <div className="space-y-1.5">
                <Label>Shënime (opsionale)</Label>
                <Input value={formNotes} onChange={e => setFormNotes(e.target.value)} placeholder="Shënime interne..." />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => { setShowCreate(false); setEditContract(null); resetForm(); }}>Anulo</Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : null}
                {editContract ? 'Ruaj Ndryshimet' : 'Krijo Kontratën'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* View / Preview Dialog */}
      <Dialog open={!!viewContract} onOpenChange={(open) => { if (!open) setViewContract(null); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          {viewContract && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <ScrollText className="w-4 h-4" />
                  {viewContract.title}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-2">
                {/* Meta */}
                <div className="flex flex-wrap gap-3 text-sm">
                  <div>
                    <span className="text-muted-foreground">Klienti: </span>
                    <span className="font-medium">{viewContract.clientName}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Statusi: </span>
                    <Badge variant="secondary" className={STATUS_COLORS[viewContract.status] || ''}>
                      {STATUS_LABELS[viewContract.status]}
                    </Badge>
                  </div>
                  {viewContract.sentAt && (
                    <div>
                      <span className="text-muted-foreground">Dërguar: </span>
                      <span>{formatDate(viewContract.sentAt)}</span>
                    </div>
                  )}
                  {viewContract.signedAt && (
                    <div>
                      <span className="text-muted-foreground">Nënshkruar: </span>
                      <span className="text-green-600 font-medium">{formatDate(viewContract.signedAt)}</span>
                    </div>
                  )}
                </div>

                {/* Package summary */}
                {viewContract.packageSummary && (
                  <>
                    <Separator />
                    <div className="space-y-2">
                      <p className="text-sm font-medium">Paketa: {viewContract.packageSummary.label}</p>
                      <div className="bg-muted/50 rounded-lg p-3 space-y-1.5">
                        {viewContract.packageSummary.categories.map((cat, i) => (
                          <div key={i} className="flex justify-between text-sm">
                            <span>{cat.category}</span>
                            <span className="text-muted-foreground">
                              {cat.oneTime > 0 && `${cat.oneTime.toLocaleString()} ${viewContract.packageSummary!.currency}`}
                              {cat.oneTime > 0 && cat.monthly > 0 && ' + '}
                              {cat.monthly > 0 && `${cat.monthly.toLocaleString()} ${viewContract.packageSummary!.currency}/muaj`}
                            </span>
                          </div>
                        ))}
                        <Separator />
                        <div className="flex justify-between text-sm font-semibold">
                          <span>Grand Total</span>
                          <span>{viewContract.packageSummary.grandTotal.toLocaleString()} {viewContract.packageSummary.currency}</span>
                        </div>
                      </div>
                    </div>
                  </>
                )}

                <Separator />

                {/* Contract body */}
                <div className="bg-muted/30 rounded-lg p-4">
                  <pre className="text-sm whitespace-pre-wrap font-sans leading-relaxed">{viewContract.body}</pre>
                </div>

                {/* Signature display */}
                {viewContract.status === 'Signed' && viewContract.signatureData && (
                  <>
                    <Separator />
                    <div className="space-y-2">
                      <p className="text-sm font-medium text-green-700">✓ Nënshkruar nga klienti</p>
                      {viewContract.signatureType === 'drawn' ? (
                        <img src={viewContract.signatureData} alt="Firma" className="h-16 border rounded bg-white p-1" />
                      ) : (
                        <p className="font-serif text-2xl italic border rounded p-2 bg-white inline-block">
                          {viewContract.signatureData}
                        </p>
                      )}
                      {viewContract.signedByEmail && (
                        <p className="text-xs text-muted-foreground">{viewContract.signedByEmail} — {formatDate(viewContract.signedAt)}</p>
                      )}
                    </div>
                  </>
                )}

                {viewContract.status === 'Rejected' && (
                  <>
                    <Separator />
                    <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
                      <strong>Refuzuar:</strong> {viewContract.rejectionReason || 'Pa arsye'}
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ContractsView;
