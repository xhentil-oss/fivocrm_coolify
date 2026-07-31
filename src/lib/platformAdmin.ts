import { auth } from './firebase';
import type { Business } from '../types';
import { PLANS } from './billing';

/**
 * Client side of the platform console's write path (`POST /api/platform-admin`).
 *
 * Every mutation here is a super-admin OVERRIDE of a tenant's commercial terms, so
 * none of it is written straight to Firestore even though the rules would allow it:
 * the server validates the values, records before/after in `auditLogs`, and reports
 * whether the change collides with a live Stripe subscription.
 */

export interface PlanUpdate {
  plan?: string;
  status?: string;
  /** ISO date, or null to clear. */
  trialEndsAt?: string | null;
  /** Negotiated seat override, or null to fall back to the plan's allowance. */
  seats?: number | null;
  note?: string;
}

async function post(payload: Record<string, unknown>): Promise<{ stripeManaged?: boolean }> {
  const user = auth.currentUser;
  if (!user) throw new Error('Nuk je i identifikuar.');
  const token = await user.getIdToken();
  const res = await fetch('/api/platform-admin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  let data: any = {};
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok || data?.error) {
    throw new Error(data?.error || `Gabim serveri (${res.status})`);
  }
  return data;
}

export function updateTenantPlan(businessId: string, update: PlanUpdate) {
  return post({ action: 'update-plan', businessId, ...update });
}

export function setTenantModules(businessId: string, disabledModules: string[]) {
  return post({ action: 'set-modules', businessId, disabledModules });
}

// ── Read-side helpers (pure — unit-testable, no Firestore) ───────────────────

/** Monthly recurring revenue in EUR for one tenant. 0 unless it is actually paying. */
export function tenantMrr(biz: Pick<Business, 'plan' | 'status'>): number {
  // Only a live subscription counts: a trial is not revenue, and a suspended or
  // canceled tenant has stopped paying even though the plan field still says "pro".
  if (biz.status !== 'active') return 0;
  return PLANS.find(p => p.key === biz.plan)?.monthlyEur ?? 0;
}

export interface PlatformStats {
  total: number;
  active: number;
  trialing: number;
  pastDue: number;
  suspended: number;
  canceled: number;
  mrr: number;
  arr: number;
  /** Tenants whose trial ends within the next 7 days (and are still trialing). */
  trialsEndingSoon: number;
}

export function platformStats(
  businesses: Array<Pick<Business, 'plan' | 'status' | 'trialEndsAt'>>,
  now = new Date(),
): PlatformStats {
  const s: PlatformStats = {
    total: businesses.length,
    active: 0, trialing: 0, pastDue: 0, suspended: 0, canceled: 0,
    mrr: 0, arr: 0, trialsEndingSoon: 0,
  };
  const weekOut = now.getTime() + 7 * 24 * 60 * 60 * 1000;
  for (const b of businesses) {
    switch (b.status) {
      case 'active': s.active++; break;
      case 'trialing': s.trialing++; break;
      case 'past_due': s.pastDue++; break;
      case 'suspended': s.suspended++; break;
      case 'canceled': s.canceled++; break;
      default: break;
    }
    s.mrr += tenantMrr(b);
    if (b.status === 'trialing' && b.trialEndsAt instanceof Date) {
      const t = b.trialEndsAt.getTime();
      if (t <= weekOut) s.trialsEndingSoon++;
    }
  }
  s.arr = s.mrr * 12;
  return s;
}

/** Days until a date — negative once it has passed. null when there is no date. */
export function daysUntil(date: unknown, now = new Date()): number | null {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  return Math.ceil((date.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
}
