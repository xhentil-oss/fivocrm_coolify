/**
 * Social media → reporting KPI bridge.
 *
 * `socialSnapshots` already holds monthly Facebook/Instagram numbers per account.
 * This maps them onto the reporting module's KPI catalog keys so the monthly client
 * report can carry real social figures instead of hand-typed ones.
 *
 * Two things this deliberately does NOT do:
 *
 *   • It does not replace `/app/social`. That screen keeps sending its own monthly
 *     email exactly as before — the owner chose to keep it (decision (b)), so no
 *     client sees a change. This is purely additive.
 *   • It does not invent numbers. A metric the Meta API did not return stays `null`,
 *     never 0 — the same rule the accountability metrics follow, for the same
 *     reason: a false zero reads as a finding, not as a gap.
 *
 * Pure functions over already-fetched snapshots, so the same code runs in the report
 * editor (pull-on-demand) and in the monthly cron.
 */

import type { SocialSnapshot } from '../../../types';

/**
 * Catalog keys this bridge can fill. Every one of them exists in `KPI_CATALOG`
 * (`src/lib/reporting/kpi.ts`) under service `social`, so the seeded `reportKpis`
 * documents already carry the right unit, direction and client-visibility.
 */
export const SOCIAL_KPI_KEYS = [
  'social_reach',
  'social_impressions',
  'engagement',
  'engagement_rate',
  'followers_gained',
  'followers_lost',
  'net_follower_growth',
  'profile_visits',
  'link_clicks',
  'posts_published',
] as const;

export type SocialKpiKey = typeof SOCIAL_KPI_KEYS[number];

/** kpiKey → value. `null` means "the platform did not report it". */
export type SocialKpiValues = Partial<Record<SocialKpiKey, number | null>>;

/** Sum a field across snapshots, returning null when NO snapshot reported it. */
function sumOrNull(
  snapshots: SocialSnapshot[],
  pick: (m: SocialSnapshot['metrics']) => number | undefined,
): number | null {
  let total = 0;
  let seen = false;
  for (const s of snapshots) {
    const v = pick(s.metrics);
    if (typeof v === 'number' && Number.isFinite(v)) {
      total += v;
      seen = true;
    }
  }
  return seen ? total : null;
}

/**
 * Map one period's snapshots (all accounts of one customer) onto KPI values.
 *
 * A client typically has both a Facebook page and an Instagram account, so figures
 * are SUMMED across platforms — that is what "reach this month" means to the client.
 * The two exceptions:
 *
 *   • `engagement_rate` is a ratio, so it is recomputed from the summed engagement
 *     and reach rather than averaged. Averaging two ratios over different audience
 *     sizes gives a number that describes neither account.
 *   • `followers_gained` / `followers_lost` are derived from the NET growth each
 *     platform reports, because the API exposes net change, not the two directions.
 *     Splitting a net figure into gross gains and losses would be invention, so each
 *     platform's net contributes to whichever side it falls on.
 */
export function mapSocialSnapshotsToKpis(snapshots: SocialSnapshot[]): SocialKpiValues {
  if (!snapshots.length) return {};

  const reach = sumOrNull(snapshots, m => m.reach);
  const impressions = sumOrNull(snapshots, m => m.impressions);
  const engagement = sumOrNull(snapshots, m => m.engagement);

  // Net growth per platform; split into gained/lost by sign.
  let gained = 0;
  let lost = 0;
  let net = 0;
  let growthSeen = false;
  for (const s of snapshots) {
    const g = s.metrics.followerGrowth;
    if (typeof g !== 'number' || !Number.isFinite(g)) continue;
    growthSeen = true;
    net += g;
    if (g >= 0) gained += g;
    else lost += Math.abs(g);
  }

  return {
    social_reach: reach,
    social_impressions: impressions,
    engagement,
    // Recomputed from the sums, as a percentage, to match the KPI's `percent` unit.
    engagement_rate: engagement !== null && reach !== null && reach > 0
      ? round2((engagement / reach) * 100)
      : null,
    followers_gained: growthSeen ? gained : null,
    followers_lost: growthSeen ? lost : null,
    net_follower_growth: growthSeen ? net : null,
    profile_visits: sumOrNull(snapshots, m => m.profileViews),
    link_clicks: sumOrNull(snapshots, m => m.linkClicks),
    posts_published: sumOrNull(snapshots, m => m.postsCount),
  };
}

/**
 * Group snapshots by customer for one period, then map each group. Returns only
 * customers that actually have data, so the caller never writes empty metric sets.
 */
export function socialKpisByCustomer(
  snapshots: SocialSnapshot[],
  periodKey: string,
): Map<string, SocialKpiValues> {
  const byCustomer = new Map<string, SocialSnapshot[]>();
  for (const s of snapshots) {
    if (s.period !== periodKey) continue;
    if (!s.customerId) continue;
    byCustomer.set(s.customerId, [...(byCustomer.get(s.customerId) || []), s]);
  }

  const out = new Map<string, SocialKpiValues>();
  for (const [customerId, list] of byCustomer) {
    const values = mapSocialSnapshotsToKpis(list);
    // Skip a customer whose every metric came back null — writing that row would
    // claim "we measured and found nothing", which is not what happened.
    if (Object.values(values).some(v => v !== null && v !== undefined)) {
      out.set(customerId, values);
    }
  }
  return out;
}

/** How many of the mappable KPIs actually carry a number. For the UI's "3/10" hint. */
export function countFilled(values: SocialKpiValues): number {
  return Object.values(values).filter(v => typeof v === 'number').length;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
