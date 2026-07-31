import { describe, it, expect } from 'vitest';
import { tenantMrr, platformStats, daysUntil } from './platformAdmin';

describe('tenantMrr', () => {
  it('counts only tenants that are actually paying', () => {
    expect(tenantMrr({ plan: 'pro', status: 'active' })).toBe(79);
    // A trial is not revenue even though the plan field is set.
    expect(tenantMrr({ plan: 'pro', status: 'trialing' })).toBe(0);
    // Neither is a tenant that stopped paying — the plan field survives suspension.
    expect(tenantMrr({ plan: 'business', status: 'suspended' })).toBe(0);
    expect(tenantMrr({ plan: 'business', status: 'past_due' })).toBe(0);
    expect(tenantMrr({ plan: 'business', status: 'canceled' })).toBe(0);
  });

  it('treats enterprise as 0 — it is contract-priced, not list-priced', () => {
    expect(tenantMrr({ plan: 'enterprise', status: 'active' })).toBe(0);
  });

  it('is 0 for an unknown or missing plan instead of NaN', () => {
    expect(tenantMrr({ plan: undefined, status: 'active' })).toBe(0);
    expect(tenantMrr({ plan: 'legacy' as any, status: 'active' })).toBe(0);
  });
});

describe('platformStats', () => {
  const now = new Date('2026-07-31T12:00:00Z');
  const day = 24 * 60 * 60 * 1000;

  it('counts every lifecycle state and sums revenue', () => {
    const s = platformStats([
      { plan: 'pro', status: 'active' },
      { plan: 'business', status: 'active' },
      { plan: 'trial', status: 'trialing', trialEndsAt: new Date(now.getTime() + 3 * day) },
      { plan: 'trial', status: 'trialing', trialEndsAt: new Date(now.getTime() + 30 * day) },
      { plan: 'starter', status: 'past_due' },
      { plan: 'starter', status: 'suspended' },
      { plan: 'pro', status: 'canceled' },
    ], now);

    expect(s.total).toBe(7);
    expect(s.active).toBe(2);
    expect(s.trialing).toBe(2);
    expect(s.pastDue).toBe(1);
    expect(s.suspended).toBe(1);
    expect(s.canceled).toBe(1);
    expect(s.mrr).toBe(79 + 149);
    expect(s.arr).toBe((79 + 149) * 12);
    // Only the trial ending within a week counts.
    expect(s.trialsEndingSoon).toBe(1);
  });

  it('counts an already-expired trial as ending soon (it needs attention now)', () => {
    const s = platformStats(
      [{ plan: 'trial', status: 'trialing', trialEndsAt: new Date(now.getTime() - 2 * day) }],
      now,
    );
    expect(s.trialsEndingSoon).toBe(1);
  });

  it('survives a missing status and a missing trial date', () => {
    const s = platformStats([{ plan: 'pro' }, { plan: 'trial', status: 'trialing' }], now);
    expect(s.total).toBe(2);
    expect(s.mrr).toBe(0);
    expect(s.trialsEndingSoon).toBe(0);
  });

  it('is all zeros for no tenants', () => {
    expect(platformStats([], now)).toMatchObject({ total: 0, mrr: 0, arr: 0, trialsEndingSoon: 0 });
  });
});

describe('daysUntil', () => {
  const now = new Date('2026-07-31T00:00:00Z');
  it('returns whole days, negative once past', () => {
    expect(daysUntil(new Date('2026-08-05T00:00:00Z'), now)).toBe(5);
    expect(daysUntil(new Date('2026-07-29T00:00:00Z'), now)).toBe(-2);
  });
  it('returns null for anything that is not a usable date', () => {
    expect(daysUntil(undefined, now)).toBeNull();
    expect(daysUntil('2026-08-05', now)).toBeNull();
    expect(daysUntil(new Date('nope'), now)).toBeNull();
  });
});
