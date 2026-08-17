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

/**
 * Normalised monthly revenue for a Stripe subscription, in cents.
 *
 * The console's MRR used to be derived from our own price catalogue
 * (`PLANS[plan].monthlyEur`), which silently ignores everything that makes a real
 * invoice differ from the list price:
 *   - yearly billing (10 months charged → MRR is annual ÷ 12, not the monthly price),
 *   - `interval_count` (quarterly / every-6-months plans),
 *   - quantity (per-seat subscriptions),
 *   - coupons (`percent_off` / `amount_off`).
 *
 * Everything here comes from the subscription object itself, so what the console shows
 * is what Stripe bills. Returns null when the amount cannot be determined (metered
 * prices with no unit_amount), so callers can fall back to the catalogue estimate.
 */
export function monthlyAmountCents(sub: {
  items?: { data?: Array<any> };
  discount?: any;
  discounts?: any[];
  currency?: string;
}): { mrrCents: number; currency: string; interval: string; quantity: number } | null {
  const item = sub?.items?.data?.[0];
  const price = item?.price;
  const unit = typeof price?.unit_amount === 'number' ? price.unit_amount : null;
  if (unit === null) return null;

  const quantity = typeof item?.quantity === 'number' && item.quantity > 0 ? item.quantity : 1;
  const interval: string = price?.recurring?.interval || 'month';
  const intervalCount: number = price?.recurring?.interval_count || 1;

  // Months covered by one charge → the divisor that turns it into a monthly figure.
  const monthsPerCharge =
    (interval === 'year' ? 12 : interval === 'week' ? 1 / 4.345 : interval === 'day' ? 1 / 30 : 1) * intervalCount;

  let gross = unit * quantity;

  // Coupons are part of what the tenant actually pays. `discount` (singular) was
  // REMOVED from the Subscription object in newer Stripe API versions in favour of
  // `discounts[]`, so read both shapes. Array entries are only usable when expanded
  // to objects (unexpanded id strings are skipped — MRR then shows gross, never NaN).
  const discountEntries: any[] = [
    ...(sub?.discount ? [sub.discount] : []),
    ...(Array.isArray(sub?.discounts) ? sub.discounts : []),
  ].filter(d => d && typeof d === 'object' && d.coupon);
  const applied = new Set<string>();
  for (const d of discountEntries) {
    const coupon = d.coupon;
    const key = String(d.id || coupon.id || JSON.stringify(coupon));
    if (applied.has(key)) continue; // legacy `discount` and `discounts[0]` are the same object
    applied.add(key);
    if (typeof coupon.percent_off === 'number' && coupon.percent_off > 0) {
      gross = gross * (1 - coupon.percent_off / 100);
    } else if (typeof coupon.amount_off === 'number' && coupon.amount_off > 0) {
      gross = Math.max(0, gross - coupon.amount_off);
    }
  }

  const mrrCents = Math.round(gross / (monthsPerCharge || 1));
  return {
    mrrCents,
    currency: (price?.currency || sub?.currency || 'eur').toLowerCase(),
    interval: intervalCount > 1 ? `${intervalCount}${interval}` : interval,
    quantity,
  };
}

/**
 * Map a Stripe subscription status onto the tenant lifecycle status.
 * Returns null for statuses that are NOT a tenant transition and must be ignored.
 */
export function tenantStatusFromStripe(stripeStatus: string): 'active' | 'trialing' | 'past_due' | 'canceled' | null {
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
      // Checkout not finished (3DS pending / abandoned). Mapping this to past_due
      // used to start the 7-day grace clock on a tenant whose own trial was still
      // valid — an abandoned checkout must not change the tenant's state at all.
      return null;
    case 'paused':
    default:
      return 'past_due';
  }
}

/**
 * `current_period_end` was REMOVED from the Subscription object in newer Stripe API
 * versions (≥ 2025-03-31 "basil") — it now lives on each subscription item. Read the
 * new shape first, keep the old one as a fallback for older webhook payloads.
 */
export function subscriptionPeriodEnd(sub: any): number | null {
  const fromItem = sub?.items?.data?.[0]?.current_period_end;
  if (typeof fromItem === 'number') return fromItem;
  const legacy = sub?.current_period_end;
  return typeof legacy === 'number' ? legacy : null;
}

/**
 * `Invoice.subscription` was likewise moved to `invoice.parent.subscription_details`
 * in newer Stripe API versions. Handles both shapes, string id or expanded object.
 */
export function invoiceSubscriptionId(invoice: any): string | null {
  const raw = invoice?.subscription
    ?? invoice?.parent?.subscription_details?.subscription
    ?? null;
  if (!raw) return null;
  return typeof raw === 'string' ? raw : (raw.id || null);
}
