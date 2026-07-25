import React, { useState } from 'react';
import { useClientPortal } from '../../hooks/useClientPortal';
import { useCollection, useDocument, useMutation } from '../../hooks/useFirestore';
import { Card, CardContent } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { FileText, Calculator, CheckCircle2, XCircle, ChevronDown, ChevronUp, Search, Clock } from 'lucide-react';
import { CardGridSkeleton } from './PortalSkeletons';
import { useToast } from '../../hooks/use-toast';
import type { Quote, Customer, Lead, Notification } from '../../types';

const statusMap: Record<string, { label: string; class: string }> = {
  Draft: { label: 'Draft', class: 'bg-gray-100 text-gray-700' },
  Sent: { label: 'Dërguar', class: 'bg-blue-100 text-blue-700' },
  Accepted: { label: 'Pranuar', class: 'bg-green-100 text-green-700' },
  Rejected: { label: 'Refuzuar', class: 'bg-red-100 text-red-700' },
  Expired: { label: 'Skaduar', class: 'bg-gray-100 text-gray-500' },
};

const STATUS_FILTERS = [
  { value: 'all', label: 'Të gjitha' },
  { value: 'Sent', label: 'Në pritje' },
  { value: 'Accepted', label: 'Pranuara' },
  { value: 'Rejected', label: 'Refuzuara' },
];

// A quote is expired if it was only Sent (never answered) and its validity date has passed.
const isQuoteExpired = (q: Quote): boolean => {
  if (q.status !== 'Sent' || !q.validUntil) return false;
  const d = q.validUntil instanceof Date ? q.validUntil : (q.validUntil as any)?.toDate?.() ?? null;
  if (!d) return false;
  const end = new Date(d);
  end.setHours(23, 59, 59, 999);
  return end.getTime() < Date.now();
};

const PortalQuotesView: React.FC = () => {
  const { customerId } = useClientPortal();
  const { toast } = useToast();
  const quoteMutation = useMutation<Quote>('quotes');
  const notificationMutation = useMutation<Notification>('notifications');
  const [respondingId, setRespondingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  // Active staff members — used to notify the team when a client responds to a quote.
  const { data: allTeamMembers } = useCollection<any>('teamMembers', {
    where: [{ field: 'status', operator: '==', value: 'Active' }],
    skipTeamFilter: true,
  });

  // Read only the client's own customer doc (server-side RLS: isPortalClientDoc).
  const { data: customer } = useDocument<Customer>('customers', customerId || undefined);

  // Leads linked to this customer — server-side scoped to customerId (server RLS
  // only authorizes leads stamped with the client's own customerId).
  const { data: leads, loading: leadsLoading } = useCollection<Lead>('leads', {
    skip: !customerId,
    where: [{ field: 'customerId', operator: '==', value: customerId || '' }],
    skipTeamFilter: true,
  });
  // Only leads we can prove belong to this customer (each carries customerId == mine),
  // capped at 10 for the Firestore `in` query below.
  const leadIdList = React.useMemo(
    () => (leads || []).map(l => l.id).slice(0, 10),
    [leads]
  );

  // Quotes are read with two narrowed queries the server RLS authorizes:
  // by the client's customerId, and by leadId for their own leads.
  const { data: quotesByCustomer, loading: loadingByCustomer } = useCollection<Quote>('quotes', {
    skip: !customerId,
    where: [{ field: 'customerId', operator: '==', value: customerId || '' }],
    skipTeamFilter: true,
  });
  const { data: quotesByLead, loading: loadingByLead } = useCollection<Quote>('quotes', {
    skip: leadIdList.length === 0,
    where: [{ field: 'leadId', operator: 'in', value: leadIdList }],
    skipTeamFilter: true,
  });
  // Wait for the lead-based path too, otherwise the empty state flashes before the
  // leads (and their quotes) have loaded.
  const loading = loadingByCustomer || leadsLoading || loadingByLead;

  const myQuotes = React.useMemo(() => {
    const merged = [...(quotesByCustomer || []), ...(quotesByLead || [])];
    const seen = new Set<string>();
    return merged
      .filter(q => { if (seen.has(q.id)) return false; seen.add(q.id); return true; })
      .filter(q => q.status !== 'Draft') // Don't show drafts to clients
      .sort((a, b) => {
        const ta = a.createdAt instanceof Date ? a.createdAt.getTime() : (a.createdAt as any)?.toMillis?.() ?? 0;
        const tb = b.createdAt instanceof Date ? b.createdAt.getTime() : (b.createdAt as any)?.toMillis?.() ?? 0;
        return tb - ta;
      });
  }, [quotesByCustomer, quotesByLead]);

  const filteredQuotes = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    return myQuotes.filter(quote => {
      if (statusFilter !== 'all' && quote.status !== statusFilter) return false;
      if (q) {
        const hay = `${quote.label || ''} ${quote.result?.suggestedLabel || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [myQuotes, search, statusFilter]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <div className="h-7 w-40 rounded-md bg-muted animate-pulse" />
          <div className="h-4 w-72 rounded-md bg-muted animate-pulse" />
        </div>
        <CardGridSkeleton count={3} cols="" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Preventiva</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Shikoni ofertat dhe preventivet e krijuara për ju.
        </p>
      </div>

      {/* Search + status filter */}
      {myQuotes.length > 0 && (
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Kërko preventivë..."
              className="pl-9"
            />
          </div>
          <div className="flex gap-1.5 overflow-x-auto pb-1 -mb-1">
            {STATUS_FILTERS.map(f => (
              <button
                key={f.value}
                onClick={() => setStatusFilter(f.value)}
                className={`px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
                  statusFilter === f.value
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:bg-muted/70'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {myQuotes.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <FileText className="w-12 h-12 mx-auto text-muted-foreground/40 mb-4" />
            <p className="text-muted-foreground font-medium">Nuk ka preventiva për momentin</p>
            <p className="text-sm text-muted-foreground mt-1">
              Kur ekipi ynë krijon një preventivë për ju, do shfaqet këtu.
            </p>
          </CardContent>
        </Card>
      ) : filteredQuotes.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Search className="w-10 h-10 mx-auto text-muted-foreground/40 mb-3" />
            <p className="text-muted-foreground font-medium">Asnjë preventivë nuk përputhet me kërkimin</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {filteredQuotes.map(q => {
            const cur = q.currency === 'EUR' ? '€' : q.currency === 'USD' ? '$' : 'L';
            const expired = isQuoteExpired(q);
            const st = expired ? statusMap.Expired : (statusMap[q.status] || statusMap.Draft);
            const categories = q.result?.categories || [];
            const isExpanded = expandedId === q.id;
            const isPending = q.status === 'Sent' && !expired;

            const handleRespond = async (status: 'Accepted' | 'Rejected') => {
              setRespondingId(q.id + status);
              try {
                await quoteMutation.update(q.id, { status });

                // Notify the staff: the quote's creator + Admin/Manager/Sales of its team.
                const clientName = customer?.name || q.customerName || 'Klienti';
                const recipientIds = new Set<string>();
                if (q.createdByUserId) recipientIds.add(q.createdByUserId);
                (allTeamMembers || []).forEach((m: any) => {
                  if (m.teamId === q.teamId && ['Admin', 'Manager', 'Sales'].includes(m.role)) {
                    if (m.userId) recipientIds.add(m.userId);
                  }
                });
                const accepted = status === 'Accepted';
                await Promise.all(
                  [...recipientIds].map(uid =>
                    notificationMutation.create({
                      userId: uid,
                      type: accepted ? 'quote_accepted' : 'quote_rejected',
                      title: accepted ? '✅ Preventiva u pranua' : '❌ Preventiva u refuzua',
                      message: `${clientName} ${accepted ? 'pranoi' : 'refuzoi'} preventivën "${q.label || 'pa emër'}".`,
                      isRead: false,
                      actionUrl: '/app/customers',
                      actionLabel: 'Shiko Klientin',
                    }).catch(() => { /* non-critical */ })
                  )
                );

                toast({
                  title: status === 'Accepted' ? '✅ Preventiva u pranua!' : '❌ Preventiva u refuzua.',
                  description: status === 'Accepted'
                    ? 'Faleminderit! Ekipi ynë do ju kontaktojë së shpejti.'
                    : 'E kemi shënuar. Mund të na kontaktoni për çdo pyetje.',
                });
              } catch {
                toast({ title: 'Gabim', description: 'Ndodhi një gabim. Provoni përsëri.', variant: 'destructive' });
              } finally {
                setRespondingId(null);
              }
            };

            return (
              <Card key={q.id} className={`overflow-hidden border-2 transition-colors ${
                expired ? 'border-border opacity-60' :
                q.status === 'Accepted' ? 'border-green-200' :
                q.status === 'Rejected' ? 'border-red-200' :
                'border-border'
              }`}>
                {/* Header */}
                <div className="px-6 py-4 border-b flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <Calculator className="w-5 h-5 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-semibold truncate">{q.label || q.result?.suggestedLabel || 'Preventivë'}</h3>
                      <p className="text-xs text-muted-foreground">
                        {q.createdAt instanceof Date ? q.createdAt.toLocaleDateString('sq-AL', { day: 'numeric', month: 'long', year: 'numeric' }) : ''}
                        {q.result?.enabledServicesCount ? ` · ${q.result.enabledServicesCount} shërbime` : ''}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant="secondary" className={st.class}>{st.label}</Badge>
                    <button
                      className="text-muted-foreground hover:text-foreground transition-colors p-1"
                      onClick={() => setExpandedId(isExpanded ? null : q.id)}
                    >
                      {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Grand Total always visible */}
                <div className="px-6 py-4 flex items-center justify-between">
                  <div className="space-y-0.5">
                    {(q.result?.totalOneTime ?? 0) > 0 && (
                      <p className="text-sm text-muted-foreground">
                        Pagesë njëherëshe: <span className="font-medium text-foreground">{(q.result?.totalOneTime ?? 0).toLocaleString()} {cur}</span>
                      </p>
                    )}
                    {(q.result?.totalMonthly ?? 0) > 0 && (
                      <p className="text-sm text-muted-foreground">
                        Pagesë mujore: <span className="font-medium text-foreground">{(q.result?.totalMonthly ?? 0).toLocaleString()} {cur}/muaj</span>
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-muted-foreground">Grand Total</p>
                    <p className="text-2xl font-bold tabular-nums text-primary">{(q.result?.grandTotal ?? 0).toLocaleString()} {cur}</p>
                  </div>
                </div>

                {/* Expanded: full service breakdown */}
                {isExpanded && categories.length > 0 && (
                  <div className="border-t px-6 py-4 bg-muted/20">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Detajet e Paketës</p>
                    <div className="space-y-4">
                      {categories.map((cat, i) => {
                        const oneTime = cat.oneTime || 0;
                        const monthly = cat.monthly || 0;
                        const items: any[] = cat.items || [];
                        return (
                          <div key={i} className="rounded-lg border bg-background p-4">
                            <div className="flex items-center justify-between mb-2">
                              <p className="font-semibold text-sm">{cat.category}</p>
                              <span className="text-sm text-muted-foreground tabular-nums">
                                {oneTime > 0 && `${oneTime.toLocaleString()} ${cur}`}
                                {oneTime > 0 && monthly > 0 && ' + '}
                                {monthly > 0 && `${monthly.toLocaleString()} ${cur}/muaj`}
                              </span>
                            </div>
                            {items.length > 0 && (
                              <ul className="space-y-1.5">
                                {items.map((item: any, j: number) => (
                                  <li key={j} className="flex items-start justify-between text-sm gap-4">
                                    <div className="flex items-start gap-2 min-w-0">
                                      <CheckCircle2 className="w-3.5 h-3.5 text-green-500 mt-0.5 shrink-0" />
                                      <span className="text-foreground">{item.name || item.label || item.title || JSON.stringify(item)}</span>
                                    </div>
                                    {item.amount > 0 && (
                                      <span className="text-muted-foreground tabular-nums shrink-0 text-xs">
                                        {item.amount.toLocaleString()} {cur}{item.type === 'monthly' ? '/muaj' : ''}
                                      </span>
                                    )}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {/* Discounts */}
                    {(q.result?.bundleDiscountAmount ?? 0) > 0 && (
                      <div className="flex items-center justify-between text-sm mt-3 text-green-600">
                        <span>🎁 {q.result?.bundleDiscountLabel || 'Zbritje pakete'}</span>
                        <span className="tabular-nums font-medium">-{(q.result?.bundleDiscountAmount ?? 0).toLocaleString()} {cur}</span>
                      </div>
                    )}
                    {(q.result?.manualDiscountAmount ?? 0) > 0 && (
                      <div className="flex items-center justify-between text-sm mt-1 text-green-600">
                        <span>✂️ Zbritje manuale</span>
                        <span className="tabular-nums font-medium">-{(q.result?.manualDiscountAmount ?? 0).toLocaleString()} {cur}</span>
                      </div>
                    )}

                    {q.notes && (
                      <div className="mt-4 p-3 rounded-lg bg-yellow-50 border border-yellow-200 text-sm text-yellow-800">
                        <p className="font-medium mb-1">Shënim nga ekipi:</p>
                        <p>{q.notes}</p>
                      </div>
                    )}

                    {q.validUntil && (
                      <p className="text-xs text-muted-foreground mt-3">
                        ⏳ Kjo ofertë është e vlefshme deri më:{' '}
                        <span className="font-medium">
                          {q.validUntil instanceof Date ? q.validUntil.toLocaleDateString('sq-AL') : ''}
                        </span>
                      </p>
                    )}
                  </div>
                )}

                {/* Accept / Reject buttons — only for Sent quotes */}
                {isPending && (
                  <div className="px-6 py-4 border-t bg-muted/10 flex flex-col sm:flex-row gap-3">
                    <Button
                      className="flex-1 bg-green-600 hover:bg-green-700 text-white gap-2"
                      disabled={respondingId === q.id + 'Accepted' || respondingId === q.id + 'Rejected'}
                      onClick={() => handleRespond('Accepted')}
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      {respondingId === q.id + 'Accepted' ? 'Duke pranuar...' : 'Prano Ofertën'}
                    </Button>
                    <Button
                      className="flex-1 gap-2"
                      variant="outline"
                      disabled={respondingId === q.id + 'Accepted' || respondingId === q.id + 'Rejected'}
                      onClick={() => handleRespond('Rejected')}
                    >
                      <XCircle className="w-4 h-4 text-red-500" />
                      {respondingId === q.id + 'Rejected' ? 'Duke refuzuar...' : 'Mos Prano'}
                    </Button>
                  </div>
                )}

                {/* Expired notice */}
                {expired && (
                  <div className="px-6 py-3 bg-muted/40 border-t flex items-center gap-2 text-muted-foreground text-sm">
                    <Clock className="w-4 h-4 shrink-0" />
                    <span>
                      Kjo ofertë ka skaduar
                      {q.validUntil instanceof Date ? ` më ${q.validUntil.toLocaleDateString('sq-AL')}` : ''}.
                      Na kontaktoni për një ofertë të re.
                    </span>
                  </div>
                )}

                {/* Accepted / Rejected confirmation message */}
                {q.status === 'Accepted' && (
                  <div className="px-6 py-3 bg-green-50 border-t border-green-200 flex items-center gap-2 text-green-700 text-sm">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>Ju e pranuat këtë ofertë. Ekipi ynë do ju kontaktojë së shpejti.</span>
                  </div>
                )}
                {q.status === 'Rejected' && (
                  <div className="px-6 py-3 bg-red-50 border-t border-red-200 flex items-center gap-2 text-red-700 text-sm">
                    <XCircle className="w-4 h-4 shrink-0" />
                    <span>Ju e refuzuat këtë ofertë. Na kontaktoni nëse keni pyetje.</span>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default PortalQuotesView;
