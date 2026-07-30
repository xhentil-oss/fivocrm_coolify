/**
 * Server-side mapping between FivoCRM plans and Stripe Prices.
 *
 * Price ids come from env so pricing can change in Stripe without a deploy:
 *
 *   STRIPE_PRICE_STARTER_MONTH   STRIPE_PRICE_STARTER_YEAR
 *   STRIPE_PRICE_PRO_MONTH       STRIPE_PRICE_PRO_YEAR
 *   STRIPE_PRICE_BUSINESS_MONTH  STRIPE_PRICE_BUSINESS_YEAR
 *
 * The reverse map (price id → plan) is what the webhook uses to set
 * `businesses.plan`, so the tenant's tier always reflects what Stripe is billing —
 * never what the client claimed at checkout.
 */

export type BillablePlan = 'starter' | 'pro' | 'business';
export type BillingInterval = 'month' | 'year';

const ENV_KEYS: Record<BillablePlan, Record<BillingInterval, string>> = {
  starter: { month: 'STRIPE_PRICE_STARTER_MONTH', year: 'STRIPE_PRICE_STARTER_YEAR' },
  pro: { month: 'STRIPE_PRICE_PRO_MONTH', year: 'STRIPE_PRICE_PRO_YEAR' },
  business: { month: 'STRIPE_PRICE_BUSINESS_MONTH', year: 'STRIPE_PRICE_BUSINESS_YEAR' },
};

export function priceIdFor(plan: BillablePlan, interval: BillingInterval): string | null {
  const key = ENV_KEYS[plan]?.[interval];
  const value = key ? process.env[key] : undefined;
  return value && value.trim() ? value.trim() : null;
}

/** price id → plan key. Built lazily so a missing env var is simply absent. */
export function planForPriceId(priceId: string | null | undefined): BillablePlan | null {
  if (!priceId) return null;
  for (const plan of Object.keys(ENV_KEYS) as BillablePlan[]) {
    for (const interval of ['month', 'year'] as BillingInterval[]) {
      if (priceIdFor(plan, interval) === priceId) return plan;
    }
  }
  return null;
}

/** Seats included per plan — enforced server-side when inviting members. */
export const PLAN_SEATS: Record<string, number> = {
  trial: 5,
  starter: 3,
  pro: 10,
  business: 25,
  enterprise: 1000,
};

export function seatsForPlan(plan: string | undefined): number {
  return PLAN_SEATS[plan || 'trial'] ?? PLAN_SEATS.trial;
}

/** Map a Stripe subscription status onto the tenant lifecycle status. */
export function tenantStatusFromStripe(stripeStatus: string): 'active' | 'trialing' | 'past_due' | 'canceled' {
  switch (stripeStatus) {
    case 'active':
    case 'trialing':
      // A Stripe trial still means "paid plan attached" for our purposes: the
      // subscription exists, so the tenant is not on our own free trial any more.
      return stripeStatus === 'active' ? 'active' : 'trialing';
    case 'past_due':
    case 'unpaid':
      return 'past_due';
    case 'canceled':
    case 'incomplete_expired':
      return 'canceled';
    case 'incomplete':
    case 'paused':
    default:
      return 'past_due';
  }
}
