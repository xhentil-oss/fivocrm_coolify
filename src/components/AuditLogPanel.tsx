import React, { useMemo, useState } from 'react';
import { ScrollText, ShieldCheck, Filter } from 'lucide-react';
import { Card } from './ui/card';
import { Badge } from './ui/badge';
import { useCollection } from '../hooks/useFirestore';

/**
 * Tenant audit trail — "who did what, when", inside this business only.
 *
 * `auditLogs` is append-only at the rules layer (`update, delete: if false`) and
 * readable only by a business admin, so this panel can display it verbatim: nobody —
 * including the owner — can rewrite history from the app.
 */

interface AuditEntry {
  id: string;
  action: string;
  actorEmail?: string | null;
  actorUid?: string | null;
  target?: string | null;
  meta?: Record<string, any>;
  createdAt?: Date;
}

/** Action → human label. Unknown actions fall back to the raw key (never hidden). */
const ACTION_LABELS: Record<string, string> = {
  'invite.accept': 'Pranoi ftesën',
  'claims.impersonate': 'Ndryshoi kontekstin e biznesit (platformë)',
  'secrets.update': 'Përditësoi kredencialet',
  'billing.checkout_started': 'Nisi pagesën e abonimit',
  'billing.portal_opened': 'Hapi portalin e faturimit',
  'billing.subscription_started': 'Abonimi u aktivizua',
  'billing.invoice_paid': 'Fatura e abonimit u pagua',
  'billing.payment_failed': 'Pagesa e abonimit dështoi',
  'billing.trial_expired': 'Provja mbaroi',
  'billing.suspended': 'Hapësira u pezullua',
  'tenant.export': 'Eksport i të dhënave',
  'tenant.delete': 'Fshirje e të dhënave',
  'platform.plan_change': 'Ndryshoi paketën/statusin (platformë)',
  'platform.modules_change': 'Ndryshoi modulet (platformë)',
};

const CATEGORY_OF = (action: string): 'billing' | 'security' | 'data' | 'other' => {
  if (action.startsWith('billing.')) return 'billing';
  if (action.startsWith('tenant.')) return 'data';
  // platform.* is a super-admin acting on the tenant from outside it — the same
  // "someone changed the boundary" category as secrets/claims, not routine billing.
  if (action.startsWith('secrets.') || action.startsWith('claims.') || action.startsWith('invite.') || action.startsWith('platform.')) return 'security';
  return 'other';
};

const CATEGORY_STYLE: Record<string, string> = {
  billing: 'bg-primary/15 text-primary',
  security: 'bg-amber-500/15 text-amber-600',
  data: 'bg-destructive/15 text-destructive',
  other: 'bg-muted text-muted-foreground',
};

const AuditLogPanel: React.FC = () => {
  const { data: entries, loading, error } = useCollection<AuditEntry>('auditLogs');
  const [category, setCategory] = useState<string>('all');

  const sorted = useMemo(() => {
    const list = [...(entries || [])].sort((a, b) => {
      const ta = a.createdAt instanceof Date ? a.createdAt.getTime() : 0;
      const tb = b.createdAt instanceof Date ? b.createdAt.getTime() : 0;
      return tb - ta;
    });
    return category === 'all' ? list : list.filter((e) => CATEGORY_OF(e.action) === category);
  }, [entries, category]);

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <ScrollText className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h3 className="text-body font-semibold text-foreground">Gjurma e auditit</h3>
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <ShieldCheck className="w-3 h-3" /> Vetëm-shtim: as pronari nuk mund t’i fshijë këto zapisa.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Filter className="w-3.5 h-3.5 text-muted-foreground" />
          {[
            { key: 'all', label: 'Të gjitha' },
            { key: 'security', label: 'Sigurí' },
            { key: 'billing', label: 'Faturim' },
            { key: 'data', label: 'Të dhëna' },
          ].map((f) => (
            <button
              key={f.key}
              onClick={() => setCategory(f.key)}
              className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                category === f.key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {loading && <p className="text-body-sm text-muted-foreground">Po ngarkohet…</p>}
      {error && (
        <p className="text-body-sm text-muted-foreground">
          Gjurma e auditit është e dukshme vetëm për administratorët e biznesit.
        </p>
      )}
      {!loading && !error && sorted.length === 0 && (
        <p className="text-body-sm text-muted-foreground">Nuk ka ende aktivitet të regjistruar.</p>
      )}

      {sorted.length > 0 && (
        <div className="divide-y divide-border -mx-1">
          {sorted.slice(0, 100).map((e) => {
            const cat = CATEGORY_OF(e.action);
            return (
              <div key={e.id} className="py-2.5 px-1 flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-0.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge className={`${CATEGORY_STYLE[cat]} text-xs`}>{cat}</Badge>
                    <span className="text-body-sm text-foreground">{ACTION_LABELS[e.action] || e.action}</span>
                  </div>
                  <p className="text-xs text-muted-foreground truncate">
                    {e.actorEmail || e.actorUid || 'sistemi'}
                    {e.target ? ` · ${e.target}` : ''}
                  </p>
                </div>
                <span className="text-xs text-muted-foreground shrink-0">
                  {e.createdAt instanceof Date ? e.createdAt.toLocaleString('sq-AL') : ''}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {sorted.length > 100 && (
        <p className="text-xs text-muted-foreground">
          Shfaqen 100 zapisat më të rinj nga {sorted.length}.
        </p>
      )}
    </Card>
  );
};

export default AuditLogPanel;
