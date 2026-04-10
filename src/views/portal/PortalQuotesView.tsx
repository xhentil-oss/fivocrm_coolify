import React from 'react';
import { useClientPortal } from '../../hooks/useClientPortal';
import { useCollection } from '../../hooks/useFirestore';
import { Card, CardContent } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { FileText, Calculator } from 'lucide-react';
import type { Quote, Customer } from '../../types';

const statusMap: Record<string, { label: string; class: string }> = {
  Draft: { label: 'Draft', class: 'bg-gray-100 text-gray-700' },
  Sent: { label: 'Dërguar', class: 'bg-blue-100 text-blue-700' },
  Accepted: { label: 'Pranuar', class: 'bg-green-100 text-green-700' },
  Rejected: { label: 'Refuzuar', class: 'bg-red-100 text-red-700' },
};

const PortalQuotesView: React.FC = () => {
  const { customerId } = useClientPortal();

  const { data: quotes, loading } = useCollection<Quote>('quotes', {
    skip: !customerId,
    skipTeamFilter: true,
  });

  const { data: customers } = useCollection<Customer>('customers', {
    skip: !customerId,
    skipTeamFilter: true,
  });

  const customer = customers?.find(c => c.id === customerId);
  const leadId = (customer as any)?.leadId;

  const myQuotes = React.useMemo(() => {
    if (!quotes) return [];
    return quotes
      .filter(q => q.customerId === customerId || (leadId && q.leadId === leadId))
      .filter(q => q.status !== 'Draft') // Don't show drafts to clients
      .sort((a, b) => {
        const ta = a.createdAt instanceof Date ? a.createdAt.getTime() : (a.createdAt as any)?.toMillis?.() ?? 0;
        const tb = b.createdAt instanceof Date ? b.createdAt.getTime() : (b.createdAt as any)?.toMillis?.() ?? 0;
        return tb - ta;
      });
  }, [quotes, customerId, leadId]);

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
        <div className="space-y-4">
          {myQuotes.map(q => {
            const cur = q.currency === 'EUR' ? '€' : q.currency === 'USD' ? '$' : 'L';
            const st = statusMap[q.status] || statusMap.Draft;
            const categories = q.result?.categories || [];
            return (
              <Card key={q.id} className="overflow-hidden">
                {/* Header */}
                <div className="px-6 py-4 border-b flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                      <Calculator className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <h3 className="font-semibold">{q.label || q.result?.suggestedLabel || 'Preventivë'}</h3>
                      <p className="text-xs text-muted-foreground">
                        {q.createdAt instanceof Date ? q.createdAt.toLocaleDateString('sq-AL', { day: 'numeric', month: 'long', year: 'numeric' }) : ''}
                        {q.result?.enabledServicesCount ? ` · ${q.result.enabledServicesCount} shërbime` : ''}
                      </p>
                    </div>
                  </div>
                  <Badge variant="secondary" className={st.class}>{st.label}</Badge>
                </div>

                {/* Service breakdown */}
                {categories.length > 0 && (
                  <div className="px-6 py-3 bg-muted/30">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Shërbimet e përfshira</p>
                    <div className="space-y-1.5">
                      {categories.map((cat, i) => {
                        const oneTime = cat.oneTime || 0;
                        const monthly = cat.monthly || 0;
                        return (
                          <div key={i} className="flex items-center justify-between text-sm">
                            <span className="text-foreground">{cat.category}</span>
                            <span className="text-muted-foreground tabular-nums">
                              {oneTime > 0 && `${oneTime.toLocaleString()} ${cur}`}
                              {oneTime > 0 && monthly > 0 && ' + '}
                              {monthly > 0 && `${monthly.toLocaleString()} ${cur}/muaj`}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Totals */}
                <div className="px-6 py-4 space-y-2">
                  {(q.result?.totalOneTime ?? 0) > 0 && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Pagesë njëherëshe</span>
                      <span className="font-medium tabular-nums">{(q.result?.totalOneTime ?? 0).toLocaleString()} {cur}</span>
                    </div>
                  )}
                  {(q.result?.totalMonthly ?? 0) > 0 && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Pagesë mujore</span>
                      <span className="font-medium tabular-nums">{(q.result?.totalMonthly ?? 0).toLocaleString()} {cur}/muaj</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between pt-2 border-t">
                    <span className="font-semibold">Grand Total (muaji i parë)</span>
                    <span className="text-lg font-bold tabular-nums">{(q.result?.grandTotal ?? 0).toLocaleString()} {cur}</span>
                  </div>
                </div>

                {q.notes && (
                  <div className="px-6 py-3 border-t bg-muted/20">
                    <p className="text-sm text-muted-foreground">{q.notes}</p>
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
