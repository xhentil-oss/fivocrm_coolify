import type { PlanKey } from './modules';
import { MODULES } from './modules';
import { auth } from './firebase';
import type { Business } from '../types';

/**
 * Single source of truth for the SaaS subscription model (pricing, seats, states).
 *
 * The catalogue below is DISPLAY data. The amount actually charged is whatever the
 * matching Stripe Price says — the server maps plan+interval → price id from env
 * (see api/_billingPlans.ts), so a price change in Stripe never needs a deploy.
 */

export type BillingInterval = 'month' | 'year';

export interface PlanDef {
  key: Exclude<PlanKey, 'trial'>;
  label: string;
  tagline: string;
  /** Monthly price in EUR (display only). Yearly is billed at 10× monthly. */
  monthlyEur: number;
  /** Seats included; extra members are blocked (see limitsForPlan). */
  seats: number;
  /** Highlights shown on the plan card. */
  highlights: string[];
  popular?: boolean;
}

export const PLANS: PlanDef[] = [
  {
    key: 'starter',
    label: 'Starter',
    tagline: 'Për ekipe të vogla që nisin me CRM dhe faturim.',
    monthlyEur: 29,
    seats: 3,
    highlights: ['CRM + Klientë', 'Projekte & Detyra', 'Fatura & Shpenzime', 'Chat i ekipit', 'Portal klienti'],
  },
  {
    key: 'pro',
    label: 'Pro',
    tagline: 'Për agjencitë në rritje: shitje, WhatsApp dhe automatizime.',
    monthlyEur: 79,
    seats: 10,
    highlights: ['Të gjitha e Starter', 'WhatsApp Inbox + Broadcast', 'Preventiva & Kontrata', 'Objektiva (OKR)', 'Dyqan & Produkte'],
    popular: true,
  },
  {
    key: 'business',
    label: 'Business',
    tagline: 'Për operacione të plota me marketing dhe raportim të thelluar.',
    monthlyEur: 149,
    seats: 25,
    highlights: ['Të gjitha e Pro', 'Marketing (email + drip)', 'Bonuset & Momentum', 'Raporte departamentesh', 'Prioritet në suport'],
  },
  {
    key: 'enterprise',
    label: 'Enterprise',
    tagline: 'Kontratë e dedikuar: SSO, DPA, limite të personalizuara.',
    monthlyEur: 0, // "Kontaktoni" — no self-serve checkout
    seats: 1000,
    highlights: ['Të gjitha e Business', 'SSO / SAML', 'DPA + eksport i të dhënave', 'SLA me kontratë', 'Onboarding i dedikuar'],
  },
];

export const PLAN_BY_KEY: Record<string, PlanDef> = Object.fromEntries(PLANS.map((p) => [p.key, p]));

/** Yearly = 10 months (2 free) — kept here so the UI and Stripe stay consistent. */
export const YEARLY_MONTHS_CHARGED = 10;

export function priceFor(plan: PlanDef, interval: BillingInterval): number {
  return interval === 'year' ? plan.monthlyEur * YEARLY_MONTHS_CHARGED : plan.monthlyEur;
}

/** Modules unlocked by a plan — derived from the module registry, never duplicated. */
export function modulesForPlan(plan: PlanKey): string[] {
  const order: PlanKey[] = ['starter', 'pro', 'business', 'enterprise'];
  const rank = order.indexOf(plan === 'trial' ? 'enterprise' : plan);
  return MODULES.filter((m) => order.indexOf(m.minPlan) <= rank).map((m) => m.label);
}

// ── Tenant lifecycle ────────────────────────────────────────────────────────
export type TenantStatus = NonNullable<Business['status']>;

/** Days a tenant keeps working after a failed payment / expired trial. */
export const GRACE_DAYS = 7;

export interface SubscriptionState {
  status: TenantStatus;
  plan: PlanKey;
  /** Days until the trial ends (negative = expired). null when not trialing. */
  trialDaysLeft: number | null;
  /** Days left of the past-due grace period before the tenant is suspended. */
  graceDaysLeft: number | null;
  /** Tenant is frozen: writes are denied by Firestore rules too. */
  isSuspended: boolean;
  /** Needs attention but still usable (trial ending, payment failed). */
  needsAttention: boolean;
  /** A paying subscription is active. */
  isPaying: boolean;
}

function daysBetween(from: Date, to: Date): number {
  return Math.ceil((to.getTime() - from.getTime()) / 86_400_000);
}

/**
 * Derive the whole billing UX state from the business document. Pure, so it is unit
 * tested — the UI never re-implements "is this tenant allowed to work".
 */
export function subscriptionState(business: Partial<Business> | null | undefined, now = new Date()): SubscriptionState {
  const plan = ((business?.plan as PlanKey) || 'trial') as PlanKey;
  const status = (business?.status || (business ? 'trialing' : 'active')) as TenantStatus;

  const trialEndsAt = business?.trialEndsAt ? new Date(business.trialEndsAt) : null;
  const trialDaysLeft = status === 'trialing' && trialEndsAt ? daysBetween(now, trialEndsAt) : null;

  const pastDueSince = (business as any)?.pastDueSince ? new Date((business as any).pastDueSince) : null;
  const graceDaysLeft =
    status === 'past_due' && pastDueSince
      ? GRACE_DAYS - Math.floor((now.getTime() - pastDueSince.getTime()) / 86_400_000)
      : null;

  const isSuspended = status === 'suspended';
  const isPaying = status === 'active';
  const needsAttention =
    status === 'past_due' ||
    status === 'canceled' ||
    (status === 'trialing' && trialDaysLeft !== null && trialDaysLeft <= 3);

  return { status, plan, trialDaysLeft, graceDaysLeft, isSuspended, needsAttention, isPaying };
}

/** Human-readable status label (Albanian UI). */
export function statusLabel(status: TenantStatus): string {
  switch (status) {
    case 'trialing': return 'Në provë';
    case 'active': return 'Aktiv';
    case 'past_due': return 'Pagesa dështoi';
    case 'suspended': return 'I pezulluar';
    case 'canceled': return 'I anuluar';
    default: return status;
  }
}

// ── Client → server calls ───────────────────────────────────────────────────

async function billingFetch(action: string, body: Record<string, any> = {}): Promise<any> {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Not authenticated');
  const res = await fetch(`/api/billing?action=${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || 'Kërkesa dështoi');
  return data;
}

/** Start a Stripe Checkout for a subscription; resolves to the redirect URL. */
export async function startSubscriptionCheckout(
  businessId: string,
  plan: Exclude<PlanKey, 'trial' | 'enterprise'>,
  interval: BillingInterval,
): Promise<string> {
  const { url } = await billingFetch('checkout', { businessId, plan, interval });
  if (!url) throw new Error('Stripe nuk kthehu një URL pagese');
  return url;
}

/** Open the Stripe Billing Portal (invoices, card, cancel) for this tenant. */
export async function openBillingPortal(businessId: string): Promise<string> {
  const { url } = await billingFetch('portal', { businessId });
  if (!url) throw new Error('Portali i faturimit nuk u hap');
  return url;
}
