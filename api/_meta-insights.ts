/**
 * Meta Graph API helper — Facebook Pages + Instagram Business insights.
 *
 * Shared by:
 *   • api/social.ts          — OAuth connect flow + manual "sync now"
 *   • api/cron/run.ts        — monthly scheduled pull (runSocialMonthlySync)
 *
 * Design notes
 * ────────────
 * • ONE Graph call set per account per month → the caller writes ONE Firestore
 *   doc (socialSnapshots), so Firebase cost stays negligible (see CLAUDE.md).
 * • Meta deprecates/renames insight metrics often. Every optional metric fetch
 *   goes through `tryGraphGet` (null on failure) and every reducer tolerates
 *   missing data, so a removed metric degrades to 0 instead of throwing.
 * • Access tokens are long-lived Page tokens stored per-account in Firestore.
 */

// Match the version used elsewhere in the repo (meta-send.ts, meta-webhook.ts).
const GRAPH = 'https://graph.facebook.com/v21.0';

// Permissions required to read Page + Instagram insights on a client's behalf.
// These are "advanced" permissions → require Meta App Review + Business
// Verification before they work for accounts the developer doesn't own.
export const META_SCOPES = [
  'public_profile',
  'pages_show_list',
  'pages_read_engagement',
  'read_insights',
  'instagram_basic',
  'instagram_manage_insights',
  'business_management',
].join(',');

export interface MetaAccountLite {
  accessToken: string;
  externalId: string;              // FB Page id or IG business-account id
  platform: 'facebook' | 'instagram';
}

export interface SnapshotData {
  metrics: {
    reach: number;
    impressions: number;
    engagement: number;
    followers: number;
    followerGrowth: number;
    profileViews: number;
    postsCount: number;
    engagementRate: number;        // engagement / reach * 100, rounded to 1dp
  };
  daily: Array<{ date: string; reach: number; impressions: number; engagement: number }>;
  topPosts: Array<{
    id: string;
    caption?: string;
    permalink?: string;
    thumbnailUrl?: string;
    mediaType?: string;
    timestamp?: Date;
    likes: number;
    comments: number;
    shares: number;
    saves: number;
    reach: number;
    engagement: number;
  }>;
  demographics?: {
    age?: Record<string, number>;
    gender?: Record<string, number>;
    city?: Record<string, number>;
    country?: Record<string, number>;
  };
}

// ── low-level Graph helpers ──────────────────────────────────────────────────
async function graphGet(path: string, params: Record<string, string>): Promise<any> {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${GRAPH}/${path}?${qs}`);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json?.error?.message || `Graph API ${res.status} on ${path}`);
  }
  return json;
}

// Tolerant variant for optional/volatile metrics: returns null instead of throwing.
async function tryGraphGet(path: string, params: Record<string, string>): Promise<any | null> {
  try {
    return await graphGet(path, params);
  } catch (err) {
    console.warn(`[meta-insights] optional call failed (${path}):`, (err as Error)?.message);
    return null;
  }
}

// ── OAuth token exchange ─────────────────────────────────────────────────────
export async function exchangeCodeForToken(
  appId: string, appSecret: string, redirectUri: string, code: string,
): Promise<string> {
  const json = await graphGet('oauth/access_token', {
    client_id: appId, client_secret: appSecret, redirect_uri: redirectUri, code,
  });
  return json.access_token as string;
}

export async function exchangeForLongLived(
  appId: string, appSecret: string, shortToken: string,
): Promise<{ token: string; expiresIn?: number }> {
  const json = await graphGet('oauth/access_token', {
    grant_type: 'fb_exchange_token',
    client_id: appId, client_secret: appSecret, fb_exchange_token: shortToken,
  });
  return { token: json.access_token as string, expiresIn: json.expires_in };
}

export function buildLoginUrl(appId: string, redirectUri: string, state: string): string {
  const p = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    state,
    response_type: 'code',
    scope: META_SCOPES,
  });
  return `https://www.facebook.com/v21.0/dialog/oauth?${p.toString()}`;
}

// The Pages a user manages, each with its own long-lived Page token + any
// linked Instagram business account.  This is the raw material for connecting
// SocialAccount docs.
export interface ManagedAccount {
  pageId: string;
  name: string;
  pageAccessToken: string;
  picture?: string;
  instagram?: { id: string; username?: string; picture?: string };
}

export async function listManagedAccounts(userToken: string): Promise<ManagedAccount[]> {
  const json = await graphGet('me/accounts', {
    access_token: userToken,
    fields: 'id,name,access_token,picture{url},instagram_business_account{id,username,profile_picture_url}',
    limit: '100',
  });
  return (json.data || []).map((p: any) => ({
    pageId: p.id,
    name: p.name,
    pageAccessToken: p.access_token,
    picture: p.picture?.data?.url,
    instagram: p.instagram_business_account
      ? {
          id: p.instagram_business_account.id,
          username: p.instagram_business_account.username,
          picture: p.instagram_business_account.profile_picture_url,
        }
      : undefined,
  }));
}

// ── period + series utilities ────────────────────────────────────────────────
export function monthRange(period: string): { start: Date; end: Date; since: string; until: string } {
  const [y, m] = period.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0));
  const end = new Date(Date.UTC(y, m, 1, 0, 0, 0)); // 00:00 on the 1st of the next month
  return {
    start, end,
    since: String(Math.floor(start.getTime() / 1000)),
    until: String(Math.floor(end.getTime() / 1000)),
  };
}

// Turn an /insights response into { metricName: valuesObject }.
function indexInsights(res: any | null): Record<string, any> {
  const out: Record<string, any> = {};
  for (const item of res?.data || []) out[item.name] = item;
  return out;
}

const sumSeries = (metric: any): number =>
  (metric?.values || []).reduce((a: number, v: any) => a + (Number(v.value) || 0), 0);

// Merge several day-series into one sorted [{date,reach,impressions,engagement}] array.
function buildDailyFromInsights(byMetric: Record<string, any>, map: Record<string, string>) {
  const days = new Map<string, { date: string; reach: number; impressions: number; engagement: number }>();
  const ensure = (d: string) => {
    if (!days.has(d)) days.set(d, { date: d, reach: 0, impressions: 0, engagement: 0 });
    return days.get(d)!;
  };
  for (const [field, metricName] of Object.entries(map)) {
    for (const v of byMetric[metricName]?.values || []) {
      const d = String(v.end_time || '').slice(0, 10);
      if (!d) continue;
      (ensure(d) as any)[field] = Number(v.value) || 0;
    }
  }
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}

const round1 = (n: number) => Math.round(n * 10) / 10;

// ── Facebook Page snapshot ───────────────────────────────────────────────────
export async function fetchFacebookSnapshot(account: MetaAccountLite, period: string): Promise<SnapshotData> {
  const { since, until } = monthRange(period);
  const token = account.accessToken;
  const id = account.externalId;

  const byMetric = indexInsights(
    await tryGraphGet(`${id}/insights`, {
      access_token: token, period: 'day', since, until,
      metric: 'page_impressions,page_impressions_unique,page_post_engagements,page_views_total',
    }),
  );
  const impressions = sumSeries(byMetric['page_impressions']);
  const reach = sumSeries(byMetric['page_impressions_unique']);
  const engagement = sumSeries(byMetric['page_post_engagements']);
  const profileViews = sumSeries(byMetric['page_views_total']);

  const prof = await tryGraphGet(id, { access_token: token, fields: 'followers_count,fan_count' });
  const followers = Number(prof?.followers_count ?? prof?.fan_count ?? 0);

  const growth = indexInsights(
    await tryGraphGet(`${id}/insights`, {
      access_token: token, period: 'day', since, until,
      metric: 'page_fan_adds_unique,page_fan_removes_unique',
    }),
  );
  const followerGrowth = sumSeries(growth['page_fan_adds_unique']) - sumSeries(growth['page_fan_removes_unique']);

  const daily = buildDailyFromInsights(byMetric, {
    reach: 'page_impressions_unique',
    impressions: 'page_impressions',
    engagement: 'page_post_engagements',
  });

  const postsRes = await tryGraphGet(`${id}/published_posts`, {
    access_token: token, since, until, limit: '25',
    fields: 'id,message,permalink_url,created_time,full_picture,shares,likes.summary(true),comments.summary(true)',
  });
  const posts = (postsRes?.data || []).map((p: any) => {
    const likes = Number(p.likes?.summary?.total_count || 0);
    const comments = Number(p.comments?.summary?.total_count || 0);
    const shares = Number(p.shares?.count || 0);
    return {
      id: p.id,
      caption: p.message,
      permalink: p.permalink_url,
      thumbnailUrl: p.full_picture,
      mediaType: 'POST',
      timestamp: p.created_time ? new Date(p.created_time) : undefined,
      likes, comments, shares, saves: 0, reach: 0,
      engagement: likes + comments + shares,
    };
  });
  const topPosts = posts.sort((a: any, b: any) => b.engagement - a.engagement).slice(0, 10);

  return {
    metrics: {
      reach, impressions, engagement, followers, followerGrowth, profileViews,
      postsCount: posts.length,
      engagementRate: reach > 0 ? round1((engagement / reach) * 100) : 0,
    },
    daily,
    topPosts,
  };
}

// ── Instagram business snapshot ──────────────────────────────────────────────
export async function fetchInstagramSnapshot(account: MetaAccountLite, period: string): Promise<SnapshotData> {
  const { start, end, since, until } = monthRange(period);
  const token = account.accessToken;
  const id = account.externalId;

  const byMetric = indexInsights(
    await tryGraphGet(`${id}/insights`, {
      access_token: token, period: 'day', since, until,
      metric: 'reach,impressions,profile_views',
    }),
  );
  const reach = sumSeries(byMetric['reach']);
  const impressions = sumSeries(byMetric['impressions']);
  const profileViews = sumSeries(byMetric['profile_views']);

  const prof = await tryGraphGet(id, { access_token: token, fields: 'followers_count,media_count' });
  const followers = Number(prof?.followers_count || 0);

  const fc = indexInsights(
    await tryGraphGet(`${id}/insights`, {
      access_token: token, period: 'day', since, until, metric: 'follower_count',
    }),
  );
  const followerGrowth = sumSeries(fc['follower_count']);

  // Media published in the month → engagement + top posts + per-day engagement.
  const mediaRes = await tryGraphGet(`${id}/media`, {
    access_token: token, since, until, limit: '50',
    fields: 'id,caption,permalink,media_type,media_product_type,thumbnail_url,media_url,timestamp,like_count,comments_count',
  });
  const startMs = start.getTime(), endMs = end.getTime();
  const media = (mediaRes?.data || []).filter((m: any) => {
    const t = m.timestamp ? new Date(m.timestamp).getTime() : 0;
    return t >= startMs && t < endMs;
  });

  const engagementByDay = new Map<string, number>();
  let engagement = 0;
  const posts = media.map((m: any) => {
    const likes = Number(m.like_count || 0);
    const comments = Number(m.comments_count || 0);
    const eng = likes + comments;
    engagement += eng;
    const day = String(m.timestamp || '').slice(0, 10);
    if (day) engagementByDay.set(day, (engagementByDay.get(day) || 0) + eng);
    return {
      id: m.id,
      caption: m.caption,
      permalink: m.permalink,
      thumbnailUrl: m.thumbnail_url || m.media_url,
      mediaType: m.media_product_type === 'REELS' ? 'REEL' : m.media_type,
      timestamp: m.timestamp ? new Date(m.timestamp) : undefined,
      likes, comments, shares: 0, saves: 0, reach: 0,
      engagement: eng,
    };
  });
  const topPosts = posts.sort((a: any, b: any) => b.engagement - a.engagement).slice(0, 10);

  const daily = buildDailyFromInsights(byMetric, { reach: 'reach', impressions: 'impressions' });
  for (const d of daily) d.engagement = engagementByDay.get(d.date) || 0;
  // days that had posts but no insight row
  for (const [day, eng] of engagementByDay) {
    if (!daily.find((d) => d.date === day)) daily.push({ date: day, reach: 0, impressions: 0, engagement: eng });
  }
  daily.sort((a, b) => a.date.localeCompare(b.date));

  const demographics = parseDemographics(
    await tryGraphGet(`${id}/insights`, {
      access_token: token, period: 'lifetime',
      metric: 'audience_gender_age,audience_city,audience_country',
    }),
  );

  return {
    metrics: {
      reach, impressions, engagement, followers, followerGrowth, profileViews,
      postsCount: media.length,
      engagementRate: reach > 0 ? round1((engagement / reach) * 100) : 0,
    },
    daily,
    topPosts,
    demographics,
  };
}

// Split IG audience_gender_age ("M.25-34" → gender + age buckets) and the
// city/country maps. Returns undefined when Meta gave us nothing (accounts with
// <100 followers get no demographics).
function parseDemographics(res: any | null): SnapshotData['demographics'] | undefined {
  const byMetric = indexInsights(res);
  const ga = byMetric['audience_gender_age']?.values?.[0]?.value;
  const city = byMetric['audience_city']?.values?.[0]?.value;
  const country = byMetric['audience_country']?.values?.[0]?.value;
  if (!ga && !city && !country) return undefined;

  const age: Record<string, number> = {};
  const gender: Record<string, number> = {};
  if (ga) {
    for (const [k, v] of Object.entries(ga)) {
      const [g, bucket] = k.split('.');
      const n = Number(v) || 0;
      if (bucket) age[bucket] = (age[bucket] || 0) + n;
      if (g) gender[g] = (gender[g] || 0) + n;
    }
  }
  return {
    age: Object.keys(age).length ? age : undefined,
    gender: Object.keys(gender).length ? gender : undefined,
    city: city || undefined,
    country: country || undefined,
  };
}

// Orchestrator used by both the cron job and the manual sync.
export async function fetchSnapshot(account: MetaAccountLite, period: string): Promise<SnapshotData> {
  return account.platform === 'instagram'
    ? fetchInstagramSnapshot(account, period)
    : fetchFacebookSnapshot(account, period);
}
