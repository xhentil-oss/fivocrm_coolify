import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { AlertTriangle, Lock, CreditCard } from 'lucide-react';
import { Card } from './ui/card';
import { Button } from './ui/button';
import { useSubscription } from '../hooks/useSubscription';
import { GRACE_DAYS } from '../lib/billing';

/**
 * Billing state, made visible.
 *
 * Firestore rules already freeze writes for a suspended tenant (`tenantActive()`), so
 * without this the app would just start failing with unexplained permission errors.
 * The gate turns that into an explicit state:
 *
 *   suspended → full-screen block with a payment CTA (the data is intact, read-only)
 *   past_due / trial ending → a banner, work continues
 *
 * `/app/billing` and `/app/settings` stay reachable while suspended so the owner can
 * actually pay.
 */

const ALWAYS_ALLOWED = ['/app/billing', '/app/settings', '/app/profile'];

export const SubscriptionBanner: React.FC = () => {
  const { status, trialDaysLeft, graceDaysLeft, needsAttention, isSuspended, loading } = useSubscription();
  if (loading || isSuspended || !needsAttention) return null;

  const message =
    status === 'past_due'
      ? (graceDaysLeft !== null && graceDaysLeft > 0
          ? `Pagesa dështoi — hapësira pezullohet pas ${graceDaysLeft} ditë${graceDaysLeft === 1 ? '' : 'ësh'}.`
          : `Pagesa dështoi — pezullimi ndodh brenda ${GRACE_DAYS} ditëve.`)
      : status === 'canceled'
        ? 'Abonimi u anulua. Aktivizo një plan për të vazhduar.'
        : trialDaysLeft !== null && trialDaysLeft > 0
          ? `Provja mbaron pas ${trialDaysLeft} ditë${trialDaysLeft === 1 ? '' : 'ësh'}.`
          : 'Provja ka mbaruar.';

  return (
    <div className="mx-3 sm:mx-6 mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 flex items-center justify-between gap-3">
      <p className="text-body-sm text-foreground flex items-center gap-2 min-w-0">
        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
        <span className="truncate">{message}</span>
      </p>
      <Button size="sm" asChild className="shrink-0">
        <Link to="/app/billing">Zgjidh plan</Link>
      </Button>
    </div>
  );
};

export const SubscriptionGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isSuspended, loading } = useSubscription();
  const location = useLocation();

  const allowed = ALWAYS_ALLOWED.some((p) => location.pathname.startsWith(p));
  if (loading || !isSuspended || allowed) return <>{children}</>;

  return (
    <div className="p-6 flex items-center justify-center min-h-[60vh]">
      <Card className="p-6 max-w-lg w-full space-y-4 text-center">
        <div className="w-12 h-12 rounded-xl bg-destructive/10 flex items-center justify-center mx-auto">
          <Lock className="w-6 h-6 text-destructive" />
        </div>
        <div className="space-y-1">
          <h2 className="text-heading-sm text-foreground">Hapësira është e pezulluar</h2>
          <p className="text-body-sm text-muted-foreground">
            Abonimi nuk është aktiv, ndaj shkrimet janë të bllokuara. Të dhënat janë të plota
            dhe kthehen menjëherë sapo pagesa aktivizohet.
          </p>
        </div>
        <Button asChild className="w-full">
          <Link to="/app/billing"><CreditCard className="w-4 h-4" /> Aktivizo abonimin</Link>
        </Button>
        <p className="text-xs text-muted-foreground">
          Nëse mendon se ky është gabim, shkruaji ekipit të suportit.
        </p>
      </Card>
    </div>
  );
};

export default SubscriptionGate;
