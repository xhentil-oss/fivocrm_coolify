import React, { useMemo, useState } from 'react';
import { usePermissions } from '../contexts/PermissionsContext';
import { useAuth } from '../contexts/AuthContext';
import { useCollection, useMutation } from '../hooks/useFirestore';
import { useToast } from '../hooks/use-toast';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Wallet, RefreshCw, Search, Banknote, Landmark, CreditCard } from 'lucide-react';
import { formatALL, toAll, currencySymbol } from '../lib/utils';
import { parseDate } from '../lib/finance/financialAnalytics';
import { missingPayments, totalsByMethod, refundState, isFullyRefunded } from '../lib/finance/payments';
import type { Payment, Invoice, Customer } from '../types';

const METHOD_ICON: Record<string, React.ComponentType<any>> = {
  Cash: Banknote, Bank: Landmark, Stripe: CreditCard,
};

const PaymentsView: React.FC = () => {
  const permissions = usePermissions();
  const { user } = useAuth();
  const { toast } = useToast();
  const allowed = permissions.canAccessInvoices || permissions.isAdmin || permissions.isOwner || permissions.isSuperAdmin;

  const { data: payments, loading } = useCollection<Payment>('payments', { skipTeamFilter: true });
  const { data: invoices } = useCollection<Invoice>('invoices', { skipTeamFilter: true });
  const { data: customers } = useCollection<Customer>('customers', { skipTeamFilter: true });
  const paymentMutation = useMutation<Payment>('payments');

  const [search, setSearch] = useState('');
  const [method, setMethod] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [syncing, setSyncing] = useState(false);

  const customerName = useMemo(
    () => new Map((customers || []).map(c => [c.id, c.name || 'Pa klient'])),
    [customers],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const fromD = from ? new Date(from + 'T00:00:00') : null;
    const toD = to ? new Date(to + 'T23:59:59') : null;
    return (payments || [])
      .map(p => ({ ...p, _date: parseDate(p.paidAt) || parseDate(p.createdAt) }))
      .filter(p => {
        if (method !== 'all' && (p.method || 'Tjetër') !== method) return false;
        if (fromD && (!p._date || p._date < fromD)) return false;
        if (toD && (!p._date || p._date > toD)) return false;
        if (q) {
          const name = (p.customerId ? customerName.get(p.customerId) : '') || '';
          const hay = `${p.invoiceNumber || ''} ${name} ${p.note || ''}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => (b._date?.getTime() || 0) - (a._date?.getTime() || 0));
  }, [payments, method, from, to, search, customerName]);

  // A fully refunded receipt is money the business gave back: it stays VISIBLE in
  // the list (with a badge) but counts in no total. The Stripe webhook has always
  // stamped `refunded`/`refundedCents` here "so arkëtime reports can exclude
  // refunded receipts" — nothing read them until now.
  const methodTotals = useMemo(() => totalsByMethod(filtered), [filtered]);
  const counted = useMemo(() => filtered.filter(p => !isFullyRefunded(p)), [filtered]);
  const grandTotal = useMemo(() => counted.reduce((s, p) => s + toAll(p.amount || 0, p.currency), 0), [counted]);
  const refundedCount = filtered.length - counted.length;

  const methods = useMemo(() => {
    const set = new Set<string>();
    (payments || []).forEach(p => set.add(p.method || 'Tjetër'));
    return Array.from(set).sort();
  }, [payments]);

  const handleSync = async () => {
    if (!invoices) return;
    setSyncing(true);
    try {
      // A content signature so rows created without a sourceKey (legacy / Stripe
      // webhook / manual) are not duplicated by the derived backfill.
      // The currency is part of the signature: without it 100 EUR and 100 ALL on the
      // same invoice and day collapsed into one row and the second was never created.
      // Normalised to 'ALL' on BOTH sides: the Stripe webhook writes
      // `currency: inv.currency || 'ALL'` while a derived row from an ALL invoice
      // carries no currency at all, so `'' !== 'ALL'` re-created every webhook
      // payment as a duplicate on the next sync.
      const sig = (p: { invoiceId: string; amount: number; currency?: string; method?: string; paidAt?: any }) =>
        `${p.invoiceId}|${Math.round(p.amount || 0)}|${p.currency || 'ALL'}|${p.method || ''}|${(parseDate(p.paidAt) || new Date(0)).toISOString().slice(0, 10)}`;
      const existing = new Set((payments || []).map(p => p.sourceKey).filter(Boolean));
      const existingSigs = new Set((payments || []).map(sig));
      const missing = missingPayments(invoices, existing).filter(m => !existingSigs.has(sig(m)));
      if (missing.length === 0) {
        toast({ title: 'Gjithçka e sinkronizuar', description: 'Nuk ka arkëtime të reja për të shtuar.' });
        return;
      }
      let ok = 0;
      for (const m of missing) {
        try {
          await paymentMutation.create({ ...m, createdByUserId: user?.uid || null } as any);
          ok += 1;
        } catch (e) { console.error('[Payments] sync create failed:', e); }
      }
      toast({ title: 'Sinkronizim i përfunduar', description: `${ok} arkëtime u shtuan në regjistër.` });
    } finally {
      setSyncing(false);
    }
  };

  if (!allowed) {
    return <div className="p-8 text-center text-muted-foreground">Nuk ke akses te arkëtimet.</div>;
  }

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Wallet className="w-6 h-6 text-primary" /> Arkëtimet
          </h1>
          <p className="text-sm text-muted-foreground">Regjistri i të gjitha pagesave të marra, sipas metodës dhe periudhës.</p>
        </div>
        <Button variant="outline" onClick={handleSync} disabled={syncing}>
          <RefreshCw className={`w-4 h-4 mr-1.5 ${syncing ? 'animate-spin' : ''}`} />
          {syncing ? 'Duke sinkronizuar…' : 'Sinkronizo nga faturat'}
        </Button>
      </div>

      {/* Totals by method */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Total (periudha)</p>
          <p className="text-xl font-bold tabular-nums text-emerald-600">{formatALL(grandTotal)}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {counted.length} arkëtime{refundedCount > 0 ? ` · ${refundedCount} të rimbursuara (pa u numëruar)` : ''}
          </p>
        </Card>
        {methodTotals.slice(0, 3).map(m => {
          const Icon = METHOD_ICON[m.method] || Wallet;
          return (
            <Card key={m.method} className="p-4">
              <p className="text-xs text-muted-foreground flex items-center gap-1"><Icon className="w-3.5 h-3.5" /> {m.method}</p>
              <p className="text-xl font-bold tabular-nums">{formatALL(m.total)}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">{m.count} arkëtime</p>
            </Card>
          );
        })}
      </div>

      {/* Filters */}
      <Card className="p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Kërko faturë / klient / shënim" className="pl-8" />
          </div>
          <Select value={method} onValueChange={setMethod}>
            <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Të gjitha metodat</SelectItem>
              {methods.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="w-[150px]" />
          <Input type="date" value={to} onChange={e => setTo(e.target.value)} className="w-[150px]" />
        </div>
      </Card>

      {/* List */}
      <Card className="p-0 overflow-hidden">
        {loading ? (
          <p className="p-6 text-center text-muted-foreground">Duke ngarkuar…</p>
        ) : filtered.length === 0 ? (
          <p className="p-6 text-center text-muted-foreground">
            Asnjë arkëtim. Kliko <span className="font-medium">"Sinkronizo nga faturat"</span> për të mbushur regjistrin nga faturat ekzistuese.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[560px]">
              <thead>
                <tr className="text-xs text-muted-foreground border-b bg-muted/30">
                  <th className="text-left font-medium py-2.5 px-3">Data</th>
                  <th className="text-left font-medium py-2.5 px-3">Faturë</th>
                  <th className="text-left font-medium py-2.5 px-3">Klient</th>
                  <th className="text-left font-medium py-2.5 px-3">Metoda</th>
                  <th className="text-right font-medium py-2.5 px-3">Shuma</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(p => {
                  const refund = refundState(p);
                  return (
                  <tr key={p.id} className="border-b border-border/50 last:border-0 hover:bg-muted/20">
                    <td className="py-2.5 px-3 whitespace-nowrap">{p._date ? p._date.toLocaleDateString('sq-AL') : '—'}</td>
                    <td className="py-2.5 px-3 font-medium">{p.invoiceNumber || p.invoiceId.slice(0, 8)}</td>
                    <td className="py-2.5 px-3 truncate max-w-[160px]">{p.customerId ? (customerName.get(p.customerId) || 'Pa klient') : 'Pa klient'}</td>
                    <td className="py-2.5 px-3">
                      <span className="inline-flex items-center gap-1.5 flex-wrap">
                        {p.method || 'Tjetër'}
                        {refund !== 'none' && (
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300 whitespace-nowrap">
                            {refund === 'full' ? 'Rimbursuar' : 'Rimbursim i pjesshëm'}
                          </span>
                        )}
                      </span>
                    </td>
                    <td className={`py-2.5 px-3 text-right tabular-nums font-semibold ${refund === 'full' ? 'text-muted-foreground line-through' : ''}`}>
                      {(p.amount || 0).toLocaleString()} {currencySymbol(p.currency)}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
};

export default PaymentsView;
