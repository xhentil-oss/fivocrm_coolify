import { describe, it, expect } from 'vitest';
import {
  tenantMrr, platformStats, daysUntil, tenantHealth, lastSeenLabel, attentionList,
  monthKey, summarizeTrend, isMrrExact,
} from './platformAdmin';

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

// ── Tenant health (console improvement #3) ───────────────────────────────────
describe('tenantHealth', () => {
  const now = new Date('2026-07-31T12:00:00Z');
  const withActivity = (daysAgo: number) => ({
    usage: { lastActivityAt: new Date(now.getTime() - daysAgo * 86_400_000) },
    createdAt: new Date('2026-01-01T00:00:00Z'),
  }) as any;

  it('classifies by how long ago the tenant last wrote anything', () => {
    expect(tenantHealth(withActivity(0), now)).toBe('engaged');
    expect(tenantHealth(withActivity(3), now)).toBe('engaged');
    expect(tenantHealth(withActivity(7), now)).toBe('quiet');
    expect(tenantHealth(withActivity(30), now)).toBe('idle');
    expect(tenantHealth(withActivity(90), now)).toBe('dormant');
  });

  it('does not call a brand-new tenant abandoned just because no rollup ran yet', () => {
    const created = { createdAt: new Date(now.getTime() - 86_400_000) } as any;
    expect(tenantHealth(created, now)).toBe('unknown');
  });

  it('is dormant when a rollup exists but found no activity at all', () => {
    const measuredEmpty = {
      usage: { activeUsers7d: 0 },
      createdAt: new Date('2026-01-01T00:00:00Z'),
    } as any;
    expect(tenantHealth(measuredEmpty, now)).toBe('dormant');
  });

  it('is unknown for a missing business', () => {
    expect(tenantHealth(null, now)).toBe('unknown');
    expect(tenantHealth(undefined, now)).toBe('unknown');
  });
});

describe('lastSeenLabel', () => {
  const now = new Date('2026-07-31T12:00:00Z');
  it('reads like a human wrote it', () => {
    expect(lastSeenLabel(new Date('2026-07-31T09:00:00Z'), now)).toBe('sot');
    expect(lastSeenLabel(new Date('2026-07-30T09:00:00Z'), now)).toBe('dje');
    expect(lastSeenLabel(new Date('2026-07-25T12:00:00Z'), now)).toBe('6 ditë më parë');
    expect(lastSeenLabel(new Date('2026-06-20T12:00:00Z'), now)).toBe('1 muaj më parë');
    expect(lastSeenLabel(undefined, now)).toBe('—');
  });
});

describe('attentionList', () => {
  const now = new Date('2026-07-31T12:00:00Z');
  const biz = (over: Record<string, any>) => ({
    id: over.id || 'b1', name: over.name || 'Tenant',
    createdAt: new Date('2026-01-01T00:00:00Z'), updatedAt: now,
    ...over,
  }) as any;

  it('puts a self-serve signup waiting for its modules at the top, whatever its billing state', () => {
    const items = attentionList([
      biz({ id: 'ending', status: 'trialing', trialEndsAt: new Date('2026-08-01T00:00:00Z') }),
      biz({ id: 'fresh', status: 'trialing', moduleSetup: 'pending', trialEndsAt: new Date('2026-08-14T00:00:00Z') }),
      biz({ id: 'console-made', status: 'trialing', moduleSetup: 'done', trialEndsAt: new Date('2026-08-14T00:00:00Z') }),
    ], now);
    const fresh = items.filter(i => i.businessId === 'fresh');
    expect(fresh).toHaveLength(1);
    expect(fresh[0].severity).toBe('high');
    expect(fresh[0].reason).toContain('modulet');
    expect(items.some(i => i.businessId === 'console-made')).toBe(false);
  });

  it('ranks a paying-but-silent tenant as high severity', () => {
    const items = attentionList([
      biz({ id: 'paying-dead', status: 'active', usage: { lastActivityAt: new Date('2026-05-01T00:00:00Z') } }),
    ], now);
    expect(items).toHaveLength(1);
    expect(items[0].severity).toBe('high');
    expect(items[0].reason).toContain('Paguan');
  });

  it('lists unpaid and suspended tenants first', () => {
    const items = attentionList([
      biz({ id: 'trial', status: 'trialing', trialEndsAt: new Date('2026-08-02T00:00:00Z') }),
      biz({ id: 'susp', status: 'suspended' }),
    ], now);
    expect(items[0].businessId).toBe('susp');
  });

  it('says whether an ending trial is engaged (worth a call) or not', () => {
    const engaged = attentionList([biz({
      id: 't1', status: 'trialing', trialEndsAt: new Date('2026-08-02T00:00:00Z'),
      usage: { lastActivityAt: now },
    })], now);
    expect(engaged[0].reason).toContain('shanse konvertimi');

    const cold = attentionList([biz({
      id: 't2', status: 'trialing', trialEndsAt: new Date('2026-08-02T00:00:00Z'),
      usage: { lastActivityAt: new Date('2026-06-01T00:00:00Z') },
    })], now);
    expect(cold[0].reason).toContain('pa aktivitet');
    expect(cold[0].severity).toBe('medium');
  });

  it('leaves a healthy paying tenant out of the queue', () => {
    expect(attentionList([biz({ status: 'active', usage: { lastActivityAt: now } })], now)).toHaveLength(0);
  });
});

// ── Platform trend (console improvement #2) ──────────────────────────────────
describe('monthKey', () => {
  it('formats as YYYY-MM in UTC', () => {
    expect(monthKey(new Date('2026-07-31T23:30:00Z'))).toBe('2026-07');
    expect(monthKey(new Date('2026-01-01T00:00:00Z'))).toBe('2026-01');
  });
});

describe('summarizeTrend', () => {
  const rows = [
    { month: '2026-05', mrr: 100, signups: 4, activated: 1, churned: 0, tenantsTotal: 8 },
    { month: '2026-06', mrr: 150, signups: 6, activated: 3, churned: 1, tenantsTotal: 12 },
    { month: '2026-07', mrr: 300, signups: 5, activated: 2, churned: 2, tenantsTotal: 15 },
  ];

  it('computes MRR delta against the previous month', () => {
    const t = summarizeTrend(rows);
    expect(t.currentMrr).toBe(300);
    expect(t.mrrDeltaEur).toBe(150);
    expect(t.mrrDeltaPct).toBe(100);
  });

  it('sorts by month regardless of input order', () => {
    const t = summarizeTrend([...rows].reverse());
    expect(t.months).toEqual(['2026-05', '2026-06', '2026-07']);
    expect(t.mrrSeries).toEqual([100, 150, 300]);
  });

  it('reports conversion over the whole window and churn against the month start', () => {
    const t = summarizeTrend(rows);
    // activated 1+3+2 = 6 of signups 4+6+5 = 15
    expect(t.conversionPct).toBe(40);
    // churned 2 of the 12 tenants that existed when the month began
    expect(t.churnPct).toBe(16.7);
  });

  it('handles a first month with no history', () => {
    const t = summarizeTrend([rows[0]]);
    expect(t.mrrDeltaEur).toBeNull();
    expect(t.mrrDeltaPct).toBeNull();
  });

  it('treats growth from zero as +100% rather than dividing by zero', () => {
    const t = summarizeTrend([
      { month: '2026-06', mrr: 0, signups: 1, activated: 0, churned: 0, tenantsTotal: 1 },
      { month: '2026-07', mrr: 79, signups: 1, activated: 1, churned: 0, tenantsTotal: 2 },
    ]);
    expect(t.mrrDeltaPct).toBe(100);
  });

  it('ignores malformed month keys instead of poisoning the series', () => {
    const t = summarizeTrend([{ month: 'nope', mrr: 999 } as any, rows[2]]);
    expect(t.months).toEqual(['2026-07']);
    expect(t.currentMrr).toBe(300);
  });

  it('returns an empty summary for no data', () => {
    const t = summarizeTrend([]);
    expect(t.months).toEqual([]);
    expect(t.currentMrr).toBe(0);
    expect(t.conversionPct).toBeNull();
  });
});

// ── MRR from Stripe rather than the price list (console improvement #1) ──────
describe('tenantMrr with a real billed amount', () => {
  it('prefers mrrCents over the plan catalogue', () => {
    // A yearly Pro subscription bills 790/year → 65.83/month, NOT the 79 list price.
    expect(tenantMrr({ plan: 'pro', status: 'active', mrrCents: 6583 })).toBeCloseTo(65.83, 2);
  });

  it('reflects a discount the catalogue knows nothing about', () => {
    expect(tenantMrr({ plan: 'business', status: 'active', mrrCents: 11175 })).toBeCloseTo(111.75, 2);
  });

  it('still returns 0 for a tenant that is not paying, whatever mrrCents says', () => {
    expect(tenantMrr({ plan: 'pro', status: 'suspended', mrrCents: 7900 })).toBe(0);
    expect(tenantMrr({ plan: 'pro', status: 'trialing', mrrCents: 7900 })).toBe(0);
  });

  it('falls back to the list price when no amount was recorded', () => {
    expect(tenantMrr({ plan: 'pro', status: 'active' })).toBe(79);
    expect(tenantMrr({ plan: 'pro', status: 'active', mrrCents: 0 })).toBe(79);
  });

  it('flags whether a figure is exact or an estimate', () => {
    expect(isMrrExact({ mrrCents: 6583 })).toBe(true);
    expect(isMrrExact({ mrrCents: 0 })).toBe(false);
    expect(isMrrExact({})).toBe(false);
  });

  it('sums the exact amounts in platform totals', () => {
    const stats = platformStats([
      { plan: 'pro', status: 'active', mrrCents: 6583 },
      { plan: 'starter', status: 'active' },            // no amount → list price 29
      { plan: 'business', status: 'trialing', mrrCents: 14900 }, // not paying → 0
    ] as any, new Date('2026-07-31T00:00:00Z'));
    expect(stats.mrr).toBeCloseTo(65.83 + 29, 2);
  });
});
