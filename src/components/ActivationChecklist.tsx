import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Circle, X, Rocket, ArrowRight } from 'lucide-react';
import { Card } from './ui/card';
import { Button } from './ui/button';
import { useCollection, useGlobalBusinessId } from '../hooks/useFirestore';
import { usePermissions } from '../contexts/PermissionsContext';
import { useSubscription } from '../hooks/useSubscription';
import { PURCHASES_ALLOWED } from '../lib/billing';

/**
 * Activation checklist — the "time to first value" path for a new tenant.
 *
 * A fresh workspace is empty, and the old onboarding was 4 informational slides that
 * left the owner staring at zeros. This tracks the steps that actually correlate with
 * a tenant sticking around, and it is DERIVED from real data (no extra bookkeeping to
 * drift): a step is done when the tenant genuinely has that thing.
 *
 * It hides itself once complete, and the owner can dismiss it permanently.
 */

const DISMISS_KEY = 'fivocrm_activation_dismissed';

interface Step {
  key: string;
  label: string;
  hint: string;
  to: string;
  done: boolean;
}

const ActivationChecklist: React.FC = () => {
  const businessId = useGlobalBusinessId();
  const permissions = usePermissions();
  const { plan, status } = useSubscription();
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISS_KEY) === '1');

  // These collections are business-scoped and already cached by other views, so the
  // checklist adds no meaningful read cost.
  const { data: customers } = useCollection<any>('customers');
  const { data: projects } = useCollection<any>('projects');
  const { data: invoices } = useCollection<any>('invoices');
  const { data: members } = useCollection<any>('teamMembers');
  const { data: services } = useCollection<any>('services');

  const steps: Step[] = useMemo(() => [
    {
      key: 'service',
      label: 'Shto shërbimet që shet',
      hint: 'Katalogu ushqen preventivat dhe faturat.',
      to: '/app/services',
      done: (services || []).length > 0,
    },
    {
      key: 'customer',
      label: 'Regjistro klientin e parë',
      hint: 'Kartela 360° mban historikun, faturat dhe bisedat.',
      to: '/app/customers',
      done: (customers || []).length > 0,
    },
    {
      key: 'project',
      label: 'Krijo projektin e parë',
      hint: 'Projektet mbajnë detyrat, buxhetin dhe përgjegjësin.',
      to: '/app/projects',
      done: (projects || []).length > 0,
    },
    {
      key: 'invoice',
      label: 'Lësho faturën e parë',
      hint: 'Fatura mund të dërgohet me email dhe të paguhet me Stripe.',
      to: '/app/invoices',
      done: (invoices || []).length > 0,
    },
    {
      key: 'team',
      label: 'Fto një koleg',
      hint: 'Rolet vendosin çfarë shikon secili.',
      to: '/app/teams',
      done: (members || []).filter((m: any) => m.status === 'Active').length > 1,
    },
    // Not offered in the iOS app — it may not point to a purchase (PURCHASES_ALLOWED).
    ...(PURCHASES_ALLOWED ? [{
      key: 'plan',
      label: 'Zgjidh planin',
      hint: 'Aktivizo abonimin përpara se provja të mbarojë.',
      to: '/app/billing',
      done: status === 'active',
    }] : []),
  ], [services, customers, projects, invoices, members, status]);

  const doneCount = steps.filter(s => s.done).length;
  const pct = Math.round((doneCount / steps.length) * 100);

  // Only the people who can actually do these steps see them.
  const relevant = permissions.isOwner || permissions.isAdmin;
  if (!relevant || !businessId || dismissed || doneCount === steps.length) return null;

  return (
    <Card className="p-5 space-y-4 border-primary/30">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <Rocket className="w-5 h-5 text-primary" />
          </div>
          <div className="min-w-0">
            <h3 className="text-body font-semibold text-foreground">Nisja e hapësirës</h3>
            <p className="text-xs text-muted-foreground">
              {doneCount} nga {steps.length} hapa · plani {plan}
            </p>
          </div>
        </div>
        <button
          onClick={() => { localStorage.setItem(DISMISS_KEY, '1'); setDismissed(true); }}
          className="text-muted-foreground hover:text-foreground p-1 rounded-md"
          aria-label="Mbyll listën e nisjes"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
        <div className="h-full bg-primary transition-all duration-500" style={{ width: `${pct}%` }} />
      </div>

      <div className="grid sm:grid-cols-2 gap-2">
        {steps.map((s) => (
          <Link
            key={s.key}
            to={s.to}
            className={`flex items-start gap-2.5 p-3 rounded-lg border transition-colors ${
              s.done
                ? 'border-transparent bg-success/5'
                : 'border-border hover:border-primary/40 hover:bg-primary/5'
            }`}
          >
            {s.done
              ? <CheckCircle2 className="w-4 h-4 text-success mt-0.5 shrink-0" />
              : <Circle className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />}
            <div className="min-w-0">
              <p className={`text-body-sm ${s.done ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
                {s.label}
              </p>
              {!s.done && <p className="text-xs text-muted-foreground">{s.hint}</p>}
            </div>
            {!s.done && <ArrowRight className="w-3.5 h-3.5 text-muted-foreground ml-auto mt-1 shrink-0" />}
          </Link>
        ))}
      </div>

      {PURCHASES_ALLOWED && status === 'trialing' && (
        <Button asChild size="sm" variant="outline" className="w-full sm:w-auto">
          <Link to="/app/billing">Shiko planet</Link>
        </Button>
      )}
    </Card>
  );
};

export default ActivationChecklist;
