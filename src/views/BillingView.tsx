import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  CreditCard, Check, AlertTriangle, ShieldCheck, ExternalLink, Loader2, Users, Sparkles,
} from 'lucide-react';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { toast } from '../hooks/use-toast';
import { useSubscription } from '../hooks/useSubscription';
import { useCollection } from '../hooks/useFirestore';
import {
  PLANS, PLAN_BY_KEY, priceFor, statusLabel, GRACE_DAYS,
  startSubscriptionCheckout, openBillingPortal, type BillingInterval,
} from '../lib/billing';
import type { TeamMember } from '../types';

/**
 * Abonimi — the tenant's own subscription (plan, seats, invoices).
 *
 * Everything here is read-only state written by Stripe: the plan comes from the price
 * being billed and the status from the subscription/invoice events, so this page never
 * writes `plan`/`status` itself (Firestore rules forbid it anyway).
 */
const BillingView: React.FC = () => {
  const [params] = useSearchParams();
  const {
    business, businessId, plan, status, trialDaysLeft, graceDaysLeft,
    isSuspended, isPaying, canManageBilling, seats, loading,
  } = useSubscription();
  const { data: members } = useCollection<TeamMember>('teamMembers');
  const [interval, setInterval] = useState<BillingInterval>('month');
  const [busy, setBusy] = useState<string | null>(null);

  const activeMembers = (members || []).filter(m => m.status === 'Active').length;
  const checkoutResult = params.get('checkout');

  const go = async (fn: () => Promise<string>, key: string) => {
    setBusy(key);
    try {
      window.location.href = await fn();
    } catch (err) {
      toast({ title: 'Gabim', description: (err as Error).message, variant: 'destructive' });
      setBusy(null);
    }
  };

  if (loading) {
    return <div className="p-6 flex items-center gap-2 text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Po ngarkohet abonimi…</div>;
  }

  return (
    <div className="p-4 sm:p-6 w-full min-w-0 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
          <CreditCard className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-heading-lg text-foreground">Abonimi</h1>
          <p className="text-body-sm text-muted-foreground">Plani, vendet dhe faturat e hapësirës tuaj.</p>
        </div>
      </div>

      {checkoutResult === 'success' && (
        <Card className="p-4 border-success/40 bg-success/5 flex items-start gap-3">
          <ShieldCheck className="w-5 h-5 text-success mt-0.5 shrink-0" />
          <div className="text-body-sm">
            <p className="font-medium text-foreground">Pagesa u pranua</p>
            <p className="text-muted-foreground">Plani aktivizohet brenda disa sekondash — rifresko faqen nëse statusi nuk është ndryshuar.</p>
          </div>
        </Card>
      )}

      {/* ── Current state ─────────────────────────────────────────────── */}
      <Card className="p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-heading-sm text-foreground">{PLAN_BY_KEY[plan]?.label || 'Provë'}</span>
              <Badge className={
                isSuspended ? 'bg-destructive/15 text-destructive'
                  : isPaying ? 'bg-success/15 text-success'
                  : 'bg-amber-500/15 text-amber-600'
              }>{statusLabel(status)}</Badge>
            </div>
            <p className="text-body-sm text-muted-foreground">
              {status === 'trialing' && trialDaysLeft !== null && (
                trialDaysLeft > 0
                  ? `Provja mbaron pas ${trialDaysLeft} ditë${trialDaysLeft === 1 ? '' : 'ësh'}.`
                  : 'Provja ka mbaruar.'
              )}
              {status === 'past_due' && (
                graceDaysLeft !== null && graceDaysLeft > 0
                  ? `Pagesa dështoi. Hapësira pezullohet pas ${graceDaysLeft} ditë${graceDaysLeft === 1 ? '' : 'ësh'}.`
                  : `Pagesa dështoi. Pezullimi ndodh brenda ${GRACE_DAYS} ditëve.`
              )}
              {status === 'active' && business?.currentPeriodEnd && (
                `Periudha aktuale mbaron më ${new Date(business.currentPeriodEnd).toLocaleDateString('sq-AL')}.`
              )}
              {isSuspended && 'Shkrimet janë të bllokuara. Të dhënat ruhen të plota.'}
              {status === 'canceled' && 'Abonimi u anulua.'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {business?.stripeCustomerId && canManageBilling && (
              <Button variant="outline" onClick={() => go(() => openBillingPortal(businessId!), 'portal')} disabled={busy === 'portal'}>
                {busy === 'portal' ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />}
                Faturat & karta
              </Button>
            )}
          </div>
        </div>

        <div className="grid sm:grid-cols-3 gap-3 pt-2 border-t border-border">
          <div className="space-y-0.5">
            <p className="text-xs text-muted-foreground flex items-center gap-1"><Users className="w-3 h-3" /> Vendet</p>
            <p className="text-body font-medium text-foreground">
              {activeMembers} / {seats}
              {activeMembers > seats && <span className="text-destructive text-xs ml-2">tejkaluar</span>}
            </p>
          </div>
          <div className="space-y-0.5">
            <p className="text-xs text-muted-foreground">Cikli</p>
            <p className="text-body font-medium text-foreground">
              {business?.cancelAtPeriodEnd ? 'Anulohet në fund të periudhës' : isPaying ? 'Aktiv' : '—'}
            </p>
          </div>
          <div className="space-y-0.5">
            <p className="text-xs text-muted-foreground">Pagesa e fundit</p>
            <p className="text-body font-medium text-foreground">
              {business?.lastPaymentAt ? new Date(business.lastPaymentAt).toLocaleDateString('sq-AL') : '—'}
            </p>
          </div>
        </div>
      </Card>

      {!canManageBilling && (
        <Card className="p-4 flex items-start gap-3 border-amber-500/40 bg-amber-500/5">
          <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
          <p className="text-body-sm text-muted-foreground">
            Vetëm pronari i hapësirës mund të blejë ose ndryshojë abonimin.
          </p>
        </Card>
      )}

      {/* ── Plans ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-heading-sm text-foreground">Planet</h2>
        <div className="inline-flex rounded-lg border border-border p-0.5">
          {(['month', 'year'] as BillingInterval[]).map((iv) => (
            <button
              key={iv}
              onClick={() => setInterval(iv)}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                interval === iv ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {iv === 'month' ? 'Mujor' : 'Vjetor (−2 muaj)'}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {PLANS.map((p) => {
          const isCurrent = plan === p.key && (isPaying || status === 'past_due');
          const isEnterprise = p.key === 'enterprise';
          return (
            <Card key={p.key} className={`p-5 flex flex-col gap-4 ${p.popular ? 'border-primary/50 ring-1 ring-primary/20' : ''}`}>
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-body font-semibold text-foreground">{p.label}</span>
                  {p.popular && <Badge className="bg-primary/15 text-primary text-xs"><Sparkles className="w-3 h-3 mr-1" />Popullor</Badge>}
                  {isCurrent && <Badge className="bg-success/15 text-success text-xs">Aktual</Badge>}
                </div>
                <p className="text-xs text-muted-foreground min-h-[32px]">{p.tagline}</p>
              </div>

              <div>
                {isEnterprise ? (
                  <p className="text-heading-sm text-foreground">Me kontratë</p>
                ) : (
                  <p className="text-foreground">
                    <span className="text-heading-lg font-semibold">€{priceFor(p, interval)}</span>
                    <span className="text-body-sm text-muted-foreground">/{interval === 'month' ? 'muaj' : 'vit'}</span>
                  </p>
                )}
                <p className="text-xs text-muted-foreground mt-0.5">{p.seats} vende përfshihen</p>
              </div>

              <ul className="space-y-1.5 flex-1">
                {p.highlights.map((h) => (
                  <li key={h} className="flex items-start gap-2 text-body-sm text-muted-foreground">
                    <Check className="w-3.5 h-3.5 text-success mt-1 shrink-0" /> {h}
                  </li>
                ))}
              </ul>

              {isEnterprise ? (
                <Button variant="outline" asChild>
                  <a href="mailto:shitje@fivo.al?subject=Enterprise%20—%20FivoCRM">Kontaktoni</a>
                </Button>
              ) : (
                <Button
                  variant={p.popular ? 'default' : 'outline'}
                  disabled={!canManageBilling || busy === p.key || (isCurrent && interval === 'month')}
                  onClick={() => go(() => startSubscriptionCheckout(businessId!, p.key as 'starter' | 'pro' | 'business', interval), p.key)}
                >
                  {busy === p.key ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  {isCurrent ? 'Ndrysho ciklin' : isPaying ? 'Kalo në këtë plan' : 'Zgjidh planin'}
                </Button>
              )}
            </Card>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground">
        Pagesat procesohen nga Stripe. Nuk ruajmë të dhëna karte. Fatura dhe anulimi bëhen nga
        “Faturat &amp; karta”.
      </p>
    </div>
  );
};

export default BillingView;
