import { describe, it, expect } from 'vitest';
import {
  subscriptionState, statusLabel, priceFor, PLAN_BY_KEY, PLANS,
  YEARLY_MONTHS_CHARGED, GRACE_DAYS,
} from './billing';

const NOW = new Date('2026-07-29T12:00:00Z');
const daysFromNow = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

describe('subscriptionState', () => {
  it('treats a missing business as active (legacy/agency data is never frozen)', () => {
    const s = subscriptionState(null, NOW);
    expect(s.status).toBe('active');
    expect(s.isSuspended).toBe(false);
    expect(s.needsAttention).toBe(false);
  });

  it('counts trial days left and stays quiet while there is time', () => {
    const s = subscriptionState({ status: 'trialing', plan: 'trial', trialEndsAt: daysFromNow(10) } as any, NOW);
    expect(s.trialDaysLeft).toBe(10);
    expect(s.needsAttention).toBe(false);
    expect(s.isPaying).toBe(false);
  });

  it('raises attention in the last 3 days of the trial', () => {
    const s = subscriptionState({ status: 'trialing', trialEndsAt: daysFromNow(3) } as any, NOW);
    expect(s.trialDaysLeft).toBe(3);
    expect(s.needsAttention).toBe(true);
  });

  it('reports an expired trial with a negative countdown', () => {
    const s = subscriptionState({ status: 'trialing', trialEndsAt: daysFromNow(-2) } as any, NOW);
    expect(s.trialDaysLeft).toBe(-2);
    expect(s.needsAttention).toBe(true);
    expect(s.isSuspended).toBe(false); // grace, not frozen yet
  });

  it('computes the remaining grace period after a failed payment', () => {
    const s = subscriptionState({ status: 'past_due', pastDueSince: daysFromNow(-2) } as any, NOW);
    expect(s.graceDaysLeft).toBe(GRACE_DAYS - 2);
    expect(s.needsAttention).toBe(true);
    expect(s.isSuspended).toBe(false);
  });

  it('reports a consumed grace period as 0 or negative', () => {
    const s = subscriptionState({ status: 'past_due', pastDueSince: daysFromNow(-GRACE_DAYS - 1) } as any, NOW);
    expect(s.graceDaysLeft!).toBeLessThanOrEqual(0);
  });

  it('marks a suspended tenant as frozen and not paying', () => {
    const s = subscriptionState({ status: 'suspended', plan: 'pro' } as any, NOW);
    expect(s.isSuspended).toBe(true);
    expect(s.isPaying).toBe(false);
    expect(s.plan).toBe('pro');
  });

  it('marks an active subscription as paying with nothing to action', () => {
    const s = subscriptionState({ status: 'active', plan: 'business' } as any, NOW);
    expect(s.isPaying).toBe(true);
    expect(s.needsAttention).toBe(false);
    expect(s.trialDaysLeft).toBeNull();
    expect(s.graceDaysLeft).toBeNull();
  });

  it('flags a canceled subscription for attention', () => {
    const s = subscriptionState({ status: 'canceled', plan: 'pro' } as any, NOW);
    expect(s.needsAttention).toBe(true);
    expect(s.isPaying).toBe(false);
  });

  it('defaults an unknown plan to trial so nothing is accidentally locked', () => {
    expect(subscriptionState({ status: 'active' } as any, NOW).plan).toBe('trial');
  });
});

describe('pricing catalogue', () => {
  it('bills a year as 10 months (2 free)', () => {
    const pro = PLAN_BY_KEY.pro;
    expect(priceFor(pro, 'month')).toBe(pro.monthlyEur);
    expect(priceFor(pro, 'year')).toBe(pro.monthlyEur * YEARLY_MONTHS_CHARGED);
  });

  it('has strictly increasing price and seats across the self-serve tiers', () => {
    const selfServe = PLANS.filter(p => p.key !== 'enterprise');
    for (let i = 1; i < selfServe.length; i++) {
      expect(selfServe[i].monthlyEur).toBeGreaterThan(selfServe[i - 1].monthlyEur);
      expect(selfServe[i].seats).toBeGreaterThan(selfServe[i - 1].seats);
    }
  });

  it('prices Enterprise on contract (no self-serve checkout)', () => {
    expect(PLAN_BY_KEY.enterprise.monthlyEur).toBe(0);
  });

  it('labels every lifecycle status in Albanian', () => {
    for (const s of ['trialing', 'active', 'past_due', 'suspended', 'canceled'] as const) {
      expect(statusLabel(s)).toBeTruthy();
      expect(statusLabel(s)).not.toBe(s);
    }
  });
});
