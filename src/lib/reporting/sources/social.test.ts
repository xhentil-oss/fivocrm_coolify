import { describe, expect, it } from 'vitest';
import {
  SOCIAL_KPI_KEYS,
  countFilled,
  mapSocialSnapshotsToKpis,
  socialKpisByCustomer,
} from './social';
import { KPI_SEED_BY_KEY } from '../kpi';
import type { SocialMetrics, SocialSnapshot } from '../../../types';

const snap = (
  over: Partial<SocialSnapshot> & { metrics?: Partial<SocialMetrics> } = {},
): SocialSnapshot => ({
  id: over.id || 'snap1',
  teamId: 'team1',
  businessId: 'biz1',
  customerId: over.customerId ?? 'cust1',
  accountId: over.accountId || 'acc1',
  platform: over.platform || 'instagram',
  accountName: 'Klienti',
  period: over.period || '2026-07',
  periodStart: new Date('2026-07-01'),
  periodEnd: new Date('2026-07-31'),
  metrics: {
    reach: 0, impressions: 0, engagement: 0, followers: 0, followerGrowth: 0,
    ...(over.metrics || {}),
  } as SocialMetrics,
  daily: [],
  topPosts: [],
  fetchedAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
  createdByUserId: null,
  ...over,
} as SocialSnapshot);

describe('catalog alignment', () => {
  // If a key here is not in the catalog, the seeded reportKpis document does not
  // exist and the value would be written against nothing.
  it('every mapped key exists in the KPI catalog', () => {
    for (const key of SOCIAL_KPI_KEYS) {
      expect(KPI_SEED_BY_KEY[key], key).toBeDefined();
    }
  });

  it('every mapped key belongs to the social service', () => {
    for (const key of SOCIAL_KPI_KEYS) {
      // `engagement`/`profile_visits`/`link_clicks` are social-service KPIs too.
      expect(KPI_SEED_BY_KEY[key].service, key).toBe('social');
    }
  });

  it('followers_lost is marked lower-is-better in the catalog', () => {
    expect(KPI_SEED_BY_KEY.followers_lost.higherIsBetter).toBe(false);
  });
});

describe('mapSocialSnapshotsToKpis', () => {
  it('sums across platforms — that is what "reach this month" means to a client', () => {
    const v = mapSocialSnapshotsToKpis([
      snap({ platform: 'instagram', metrics: { reach: 1000, impressions: 3000, engagement: 200 } }),
      snap({ platform: 'facebook', id: 's2', metrics: { reach: 500, impressions: 1500, engagement: 100 } }),
    ]);
    expect(v.social_reach).toBe(1500);
    expect(v.social_impressions).toBe(4500);
    expect(v.engagement).toBe(300);
  });

  it('recomputes engagement rate from the SUMS, not by averaging two ratios', () => {
    // IG: 200/1000 = 20%. FB: 100/500 = 20%. Averaging also gives 20% here, so use
    // asymmetric numbers to prove the sums are used: 300/1500 = 20%.
    const v = mapSocialSnapshotsToKpis([
      snap({ metrics: { reach: 1000, engagement: 300 } }),                 // 30%
      snap({ id: 's2', platform: 'facebook', metrics: { reach: 3000, engagement: 300 } }), // 10%
    ]);
    // Averaging the ratios would give 20%; the correct blended rate is 600/4000 = 15%.
    expect(v.engagement_rate).toBe(15);
  });

  it('splits net follower growth into gained and lost by sign', () => {
    const v = mapSocialSnapshotsToKpis([
      snap({ metrics: { followerGrowth: 120 } }),
      snap({ id: 's2', platform: 'facebook', metrics: { followerGrowth: -30 } }),
    ]);
    expect(v.followers_gained).toBe(120);
    expect(v.followers_lost).toBe(30);
    expect(v.net_follower_growth).toBe(90);
  });

  // The same rule as the accountability metrics: a metric the platform did not
  // return is unknown, and a false 0 reads as a finding rather than a gap.
  it('leaves an unreported metric null, never zero', () => {
    const v = mapSocialSnapshotsToKpis([snap({ metrics: { reach: 100 } })]);
    expect(v.social_reach).toBe(100);
    expect(v.profile_visits).toBeNull();   // profileViews absent
    expect(v.link_clicks).toBeNull();      // linkClicks absent
    expect(v.posts_published).toBeNull();  // postsCount absent
  });

  it('reports a genuine zero as zero when the platform did return it', () => {
    const v = mapSocialSnapshotsToKpis([snap({ metrics: { reach: 100, linkClicks: 0 } })]);
    expect(v.link_clicks).toBe(0);
  });

  it('returns nothing for no snapshots', () => {
    expect(mapSocialSnapshotsToKpis([])).toEqual({});
  });

  it('cannot divide by zero reach', () => {
    const v = mapSocialSnapshotsToKpis([snap({ metrics: { reach: 0, engagement: 50 } })]);
    expect(v.engagement_rate).toBeNull();
  });
});

describe('socialKpisByCustomer', () => {
  it('groups by customer and ignores other periods', () => {
    const map = socialKpisByCustomer([
      snap({ customerId: 'a', metrics: { reach: 100 } }),
      snap({ id: 's2', customerId: 'a', platform: 'facebook', metrics: { reach: 50 } }),
      snap({ id: 's3', customerId: 'b', metrics: { reach: 700 } }),
      snap({ id: 's4', customerId: 'a', period: '2026-06', metrics: { reach: 9999 } }),
    ], '2026-07');

    expect([...map.keys()].sort()).toEqual(['a', 'b']);
    expect(map.get('a')!.social_reach).toBe(150);   // 9999 excluded (wrong period)
    expect(map.get('b')!.social_reach).toBe(700);
  });

  it('skips a customer whose every metric is null', () => {
    // A snapshot exists but the API returned nothing usable. Writing that row would
    // claim "we measured and found nothing", which is not what happened.
    const empty = snap({ customerId: 'c' });
    empty.metrics = {} as SocialMetrics;
    const map = socialKpisByCustomer([empty], '2026-07');
    expect(map.has('c')).toBe(false);
  });

  it('ignores snapshots with no customer', () => {
    const orphan = snap({ id: 'o' });
    (orphan as any).customerId = '';
    expect(socialKpisByCustomer([orphan], '2026-07').size).toBe(0);
  });
});

describe('countFilled', () => {
  it('counts only real numbers', () => {
    const v = mapSocialSnapshotsToKpis([snap({ metrics: { reach: 10, engagement: 2 } })]);
    // reach, impressions(0 default), engagement, engagement_rate, and the three
    // follower fields (followerGrowth defaults to 0) are numbers; the rest are null.
    expect(countFilled(v)).toBeGreaterThan(0);
    expect(countFilled({})).toBe(0);
    expect(countFilled({ social_reach: null })).toBe(0);
  });
});
