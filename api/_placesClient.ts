/**
 * Google Places API (New) — Text Search only. Knows NOTHING about Firestore.
 *
 *   POST https://places.googleapis.com/v1/places:searchText
 *   headers: X-Goog-Api-Key, X-Goog-FieldMask
 *
 * Billing is PER REQUEST (≤ 20 places each); phone + website put the request in the
 * Enterprise SKU (1 000 free requests / month / Google project, then ≈ $35 per
 * 1 000). `placesTextSearchAll` therefore pages at most `PLACES_MAX_PAGES` times
 * and reports how many requests it spent so the caller can meter the tenant.
 *
 * Key resolution (`resolvePlacesKey`): the tenant's `teamSecrets.googlePlacesApiKey`
 * (merged into getTeamConfig()) wins; the platform env `GOOGLE_PLACES_API_KEY` is the
 * fallback. Every failure is a `PlacesError` with a named code and an Albanian
 * sentence — never an opaque 500.
 */
import {
  PLACES_MAX_PAGES, PLACES_PAGE_SIZE, PLACES_TEXT_SEARCH_FIELD_MASK, type PlaceLike,
} from './_salesAgentProspecting.js';

const ENDPOINT = 'https://places.googleapis.com/v1/places:searchText';
const TIMEOUT_MS = 15_000;

export type PlacesErrorCode = 'not-configured' | 'invalid-key' | 'quota' | 'bad-request' | 'timeout' | 'upstream';

export class PlacesError extends Error {
  code: PlacesErrorCode;
  status: number;
  constructor(code: PlacesErrorCode, message: string, status = 502) {
    super(message);
    this.name = 'PlacesError';
    this.code = code;
    this.status = status;
  }
}

export const PLACES_ERROR_LABELS: Record<PlacesErrorCode, string> = {
  'not-configured': 'Çelësi i Google Places nuk është konfiguruar (Cilësimet → Agjentja e shitjeve)',
  'invalid-key': 'Google nuk e pranon çelësin Places (i pavlefshëm, i kufizuar për API tjetër, ose Places API (New) nuk është aktivizuar në projekt)',
  'quota': 'Kuota e Google Places u tejkalua ose faturimi nuk është aktiv në projektin Google',
  'bad-request': 'Google refuzoi kërkesën (parametra të pavlefshëm)',
  'timeout': 'Google Places nuk u përgjigj në kohë',
  'upstream': 'Google Places ktheu një gabim',
};

export interface PlacesKey { key: string; source: 'tenant' | 'env' | null }

export function resolvePlacesKey(cfg: Record<string, any> | null | undefined): PlacesKey {
  const tenant = typeof cfg?.googlePlacesApiKey === 'string' ? cfg.googlePlacesApiKey.trim() : '';
  if (tenant) return { key: tenant, source: 'tenant' };
  const env = (process.env.GOOGLE_PLACES_API_KEY || '').trim();
  if (env) return { key: env, source: 'env' };
  return { key: '', source: null };
}

export interface TextSearchOptions {
  regionCode?: string;
  languageCode?: string;
  pageSize?: number;
  pageToken?: string | null;
  fieldMask?: string;
}

export interface TextSearchPage { places: PlaceLike[]; nextPageToken: string | null }

function classify(status: number, body: any): PlacesError {
  const msg: string = String(body?.error?.message || body?.error?.status || '').slice(0, 300);
  const reason: string = String(body?.error?.details?.[0]?.reason || body?.error?.status || '');
  if (status === 400 && /API key not valid|API_KEY_INVALID/i.test(`${msg} ${reason}`)) return new PlacesError('invalid-key', `${PLACES_ERROR_LABELS['invalid-key']}: ${msg}`, 502);
  if (status === 403) {
    if (/billing|BILLING|quota|QUOTA|RESOURCE_EXHAUSTED/i.test(`${msg} ${reason}`)) return new PlacesError('quota', `${PLACES_ERROR_LABELS.quota}: ${msg}`, 502);
    return new PlacesError('invalid-key', `${PLACES_ERROR_LABELS['invalid-key']}: ${msg}`, 502);
  }
  if (status === 429) return new PlacesError('quota', `${PLACES_ERROR_LABELS.quota}: ${msg}`, 429);
  if (status === 400) return new PlacesError('bad-request', `${PLACES_ERROR_LABELS['bad-request']}: ${msg}`, 502);
  return new PlacesError('upstream', `${PLACES_ERROR_LABELS.upstream} (${status}): ${msg}`, 502);
}

/** One Text Search request (one billable event). */
export async function placesTextSearch(apiKey: string, textQuery: string, opts: TextSearchOptions = {}): Promise<TextSearchPage> {
  if (!apiKey) throw new PlacesError('not-configured', PLACES_ERROR_LABELS['not-configured'], 503);
  const body: Record<string, any> = {
    textQuery,
    regionCode: opts.regionCode || 'AL',
    languageCode: opts.languageCode || 'sq',
    pageSize: Math.max(1, Math.min(PLACES_PAGE_SIZE, opts.pageSize ?? PLACES_PAGE_SIZE)),
  };
  if (opts.pageToken) body.pageToken = opts.pageToken;
  let resp: Response;
  try {
    resp = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': opts.fieldMask || PLACES_TEXT_SEARCH_FIELD_MASK,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err: any) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') throw new PlacesError('timeout', PLACES_ERROR_LABELS.timeout, 504);
    throw new PlacesError('upstream', `${PLACES_ERROR_LABELS.upstream}: ${String(err?.message || err).slice(0, 200)}`, 502);
  }
  const raw = await resp.text();
  let data: any = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = {}; }
  if (!resp.ok) throw classify(resp.status, data);
  return {
    places: Array.isArray(data?.places) ? (data.places as PlaceLike[]) : [],
    nextPageToken: typeof data?.nextPageToken === 'string' && data.nextPageToken ? data.nextPageToken : null,
  };
}

/** Pages up to `maxResults` (≤ 60) and reports the requests spent — even when a later page fails. */
export async function placesTextSearchAll(
  apiKey: string,
  textQuery: string,
  maxResults: number,
  opts: Omit<TextSearchOptions, 'pageToken' | 'pageSize'> = {},
): Promise<{ places: PlaceLike[]; requests: number; error: PlacesError | null }> {
  const want = Math.max(1, Math.min(PLACES_PAGE_SIZE * PLACES_MAX_PAGES, Math.round(maxResults || PLACES_PAGE_SIZE)));
  const out: PlaceLike[] = [];
  let token: string | null = null;
  let requests = 0;
  let error: PlacesError | null = null;
  for (let page = 0; page < PLACES_MAX_PAGES && out.length < want; page++) {
    if (page > 0 && !token) break;
    try {
      requests++;
      const r = await placesTextSearch(apiKey, textQuery, { ...opts, pageToken: token, pageSize: Math.min(PLACES_PAGE_SIZE, want - out.length) });
      out.push(...r.places);
      token = r.nextPageToken;
    } catch (err) {
      error = err instanceof PlacesError ? err : new PlacesError('upstream', String((err as Error)?.message || err));
      break;
    }
  }
  return { places: out.slice(0, want), requests, error };
}

/** Free probe (IDs-only SKU): proves the key works without spending a paid request. */
export async function placesKeyProbe(apiKey: string): Promise<{ ok: boolean; code?: PlacesErrorCode; error?: string }> {
  try {
    await placesTextSearch(apiKey, 'kafe Tiranë', { pageSize: 1, fieldMask: 'places.id' });
    return { ok: true };
  } catch (err) {
    const e = err instanceof PlacesError ? err : new PlacesError('upstream', String((err as Error)?.message || err));
    return { ok: false, code: e.code, error: e.message };
  }
}
