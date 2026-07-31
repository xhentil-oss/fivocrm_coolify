/**
 * Google Search Console helper — OAuth (offline / refresh-token) + Search
 * Analytics query. Mirrors _meta-insights.ts for the "search-console" platform.
 *
 * Reuses the existing Google Cloud OAuth client (VITE_GOOGLE_CLIENT_ID /
 * GOOGLE_CLIENT_ID) plus a server-side GOOGLE_CLIENT_SECRET. The stored
 * per-account credential is a Google REFRESH token (durable); each sync
 * exchanges it for a short-lived access token.
 */

export const GSC_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const WMS = 'https://www.googleapis.com/webmasters/v3';

export interface SeoData {
  metrics: { clicks: number; impressions: number; ctr: number; position: number };
  daily: Array<{ date: string; clicks: number; impressions: number }>;
  topQueries: Array<{ key: string; clicks: number; impressions: number; ctr: number; position: number }>;
  topPages: Array<{ key: string; clicks: number; impressions: number; ctr: number; position: number }>;
  countries?: Record<string, number>;
  devices?: Record<string, number>;
  errors?: string[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

// ── OAuth ────────────────────────────────────────────────────────────────────
export function buildGoogleAuthUrl(clientId: string, redirectUri: string, state: string): string {
  const p = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GSC_SCOPE,
    access_type: 'offline',      // ask for a refresh token
    prompt: 'consent',           // force refresh_token even on re-auth
    include_granted_scopes: 'true',
    state,
  });
  return `${AUTH_URL}?${p.toString()}`;
}

export async function exchangeGoogleCode(
  clientId: string, clientSecret: string, redirectUri: string, code: string,
): Promise<{ accessToken: string; refreshToken?: string; expiresIn?: number }> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, client_id: clientId, client_secret: clientSecret,
      redirect_uri: redirectUri, grant_type: 'authorization_code',
    }).toString(),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error_description || json?.error || `Google token ${res.status}`);
  return { accessToken: json.access_token, refreshToken: json.refresh_token, expiresIn: json.expires_in };
}

export async function refreshGoogleToken(
  clientId: string, clientSecret: string, refreshToken: string,
): Promise<string> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId, client_secret: clientSecret,
      refresh_token: refreshToken, grant_type: 'refresh_token',
    }).toString(),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error_description || json?.error || `Google refresh ${res.status}`);
  return json.access_token as string;
}

export interface GscSite { siteUrl: string; permissionLevel: string }
export async function listGscSites(accessToken: string): Promise<GscSite[]> {
  const res = await fetch(`${WMS}/sites`, { headers: { Authorization: `Bearer ${accessToken}` } });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error?.message || `Search Console sites ${res.status}`);
  // Only sites the user can actually read data for.
  return (json.siteEntry || []).filter((s: any) => s.permissionLevel && s.permissionLevel !== 'siteUnverifiedUser');
}

// ── Search Analytics ──────────────────────────────────────────────────────────
function monthDates(period: string): { startDate: string; endDate: string } {
  const [y, m] = period.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 0)); // day 0 of next month = last day of this month
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { startDate: iso(start), endDate: iso(end) };
}

// Pull a full monthly snapshot: totals + daily + top queries + top pages +
// country/device splits. GSC has no 30-day range limit, so one call per grouping.
export async function fetchSearchConsoleSnapshot(
  siteUrl: string, accessToken: string, period: string,
): Promise<SeoData> {
  const { startDate, endDate } = monthDates(period);
  const errors: string[] = [];
  const url = `${WMS}/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;

  const query = async (dimensions: string[] | undefined, rowLimit: number, label: string): Promise<any[]> => {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ startDate, endDate, ...(dimensions ? { dimensions } : {}), rowLimit, dataState: 'all' }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message || `HTTP ${res.status}`);
      return json.rows || [];
    } catch (err) {
      errors.push(`${label}: ${(err as Error)?.message || 'error'}`);
      return [];
    }
  };

  const [totalsRows, dailyRows, queryRows, pageRows, countryRows, deviceRows] = await Promise.all([
    query(undefined, 1, 'gsc-totals'),
    query(['date'], 90, 'gsc-daily'),
    query(['query'], 25, 'gsc-queries'),
    query(['page'], 25, 'gsc-pages'),
    query(['country'], 10, 'gsc-countries'),
    query(['device'], 5, 'gsc-devices'),
  ]);

  const t = totalsRows[0] || {};
  const metrics = {
    clicks: Math.round(t.clicks || 0),
    impressions: Math.round(t.impressions || 0),
    ctr: round1((t.ctr || 0) * 100),
    position: round1(t.position || 0),
  };

  const daily = dailyRows.map((r) => ({
    date: r.keys?.[0] || '',
    clicks: Math.round(r.clicks || 0),
    impressions: Math.round(r.impressions || 0),
  })).filter((d) => d.date).sort((a, b) => a.date.localeCompare(b.date));

  const mapRow = (r: any) => ({
    key: r.keys?.[0] || '',
    clicks: Math.round(r.clicks || 0),
    impressions: Math.round(r.impressions || 0),
    ctr: round1((r.ctr || 0) * 100),
    position: round2(r.position || 0),
  });
  const topQueries = queryRows.map(mapRow);
  const topPages = pageRows.map(mapRow);

  const toClickMap = (rows: any[]) => {
    const out: Record<string, number> = {};
    for (const r of rows) { const k = r.keys?.[0]; if (k) out[k] = Math.round(r.clicks || 0); }
    return Object.keys(out).length ? out : undefined;
  };

  return {
    metrics, daily, topQueries, topPages,
    countries: toClickMap(countryRows),
    devices: toClickMap(deviceRows),
    errors,
  };
}
