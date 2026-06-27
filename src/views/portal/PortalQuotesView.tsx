import React, { useState } from 'react';
import { useClientPortal } from '../../hooks/useClientPortal';
import { useCollection, useMutation } from '../../hooks/useFirestore';
import { Card, CardContent } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { FileText, Calculator, CheckCircle2, XCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { useToast } from '../../hooks/use-toast';
import type { Quote, Customer, Lead, Notification } from '../../types';

const statusMap: Record<string, { label: string; class: string }> = {
  Draft: { label: 'Draft', class: 'bg-gray-100 text-gray-700' },
  Sent: { label: 'Dërguar', class: 'bg-blue-100 text-blue-700' },
  Accepted: { label: 'Pranuar', class: 'bg-green-100 text-green-700' },
  Rejected: { label: 'Refuzuar', class: 'bg-red-100 text-red-700' },
};

const PortalQuotesView: React.FC = () => {
  const { customerId } = useClientPortal();
  const { toast } = useToast();
  const quoteMutation = useMutation<Quote>('quotes');
  const notificationMutation = useMutation<Notification>('notifications');
  const [respondingId, setRespondingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Active staff members — used to notify the team when a client responds to a quote.
  const { data: allTeamMembers } = useCollection<any>('teamMembers', {
    where: [{ field: 'status', operator: '==', value: 'Active' }],
    skipTeamFilter: true,
  });

  const { data: quotes, loading } = useCollection<Quote>('quotes', {
    skip: !customerId,
    skipTeamFilter: true,
  });

  const { data: customers } = useCollection<Customer>('customers', {
    skip: !customerId,
    skipTeamFilter: true,
  });

  // Find leads that belong to this customer (lead.customerId or lead.email match)
  const { data: leads } = useCollection<Lead>('leads', {
    skip: !customerId,
    skipTeamFilter: true,
  });

  const customer = customers?.find(c => c.id === customerId);
  const customerLeadId = (customer as any)?.leadId;
  const customerEmail = customer?.email?.toLowerCase();

  // Collect all lead IDs linked to this customer
  const linkedLeadIds = React.useMemo(() => {
    const ids = new Set<string>();
    if (customerLeadId) ids.add(customerLeadId);
    if (leads && customerId) {
      leads.forEach(l => {
        // Lead was created with customerId pointing to this customer
        if ((l as any).customerId === customerId) ids.add(l.id);
        // Lead email matches customer email
        if (customerEmail && l.email?.toLowerCase() === customerEmail) ids.add(l.id);
      });
    }
    return ids;
  }, [leads, customerId, customerLeadId, customerEmail]);

  const myQuotes = React.useMemo(() => {
    if (!quotes) return [];
    return quotes
      .filter(q =>
        q.customerId === customerId ||
        (q.leadId && linkedLeadIds.has(q.leadId))
      )
      .filter(q => q.status !== 'Draft') // Don't show drafts to clients
      .sort((a, b) => {
        const ta = a.createdAt instanceof Date ? a.createdAt.getTime() : (a.createdAt as any)?.toMillis?.() ?? 0;
        const tb = b.createdAt instanceof Date ? b.createdAt.getTime() : (b.createdAt as any)?.toMillis?.() ?? 0;
        return tb - ta;
      });
  }, [quotes, customerId, linkedLeadIds]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
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
      ) : (
        <div className="space-y-6">
          {myQuotes.map(q => {
            const cur = q.currency === 'EUR' ? '€' : q.currency === 'USD' ? '$' : 'L';
            const st = statusMap[q.status] || statusMap.Draft;
            const categories = q.result?.categories || [];
            const isExpanded = expandedId === q.id;
            const isPending = q.status === 'Sent';

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
                                    {(item.oneTime || item.monthly) && (
                                      <span className="text-muted-foreground tabular-nums shrink-0 text-xs">
                                        {item.oneTime > 0 && `${(item.oneTime).toLocaleString()} ${cur}`}
                                        {item.oneTime > 0 && item.monthly > 0 && ' + '}
                                        {item.monthly > 0 && `${(item.monthly).toLocaleString()} ${cur}/muaj`}
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
                      disabled={!!respondingId}
                      onClick={() => handleRespond('Accepted')}
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      {respondingId === q.id + 'Accepted' ? 'Duke pranuar...' : 'Prano Ofertën'}
                    </Button>
                    <Button
                      className="flex-1 gap-2"
                      variant="outline"
                      disabled={!!respondingId}
                      onClick={() => handleRespond('Rejected')}
                    >
                      <XCircle className="w-4 h-4 text-red-500" />
                      {respondingId === q.id + 'Rejected' ? 'Duke refuzuar...' : 'Mos Prano'}
                    </Button>
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
