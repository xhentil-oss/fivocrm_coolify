/**
 * Google Maps prospecting — the pure part (no Firestore, no fetch).
 *
 * `api/_placesClient.ts` talks to Places API (New); the cron `sales-agent-prospecting`
 * runs a `prospectSearches` row by calling it, then pushes every raw place through
 * `normalizePlace()` → `fitScore()` → `dedupeKeysFor()` and writes `prospects`.
 *
 * Phone normalisation is INJECTED (`normalizePhone`) so this file stays import-free
 * (the api copy must be byte-identical) and still uses the ONE phone rule
 * (`toWaPhone` / `api/_waPhone.ts`) — never a second normaliser.
 *
 * Places terms (plan §1 law 10): only `placeId` may be stored indefinitely; an
 * unregistered prospect expires after `PROSPECT_TTL_DAYS`.
 */

// Structural copies of the core's ICP/persona shapes, so this file has NO imports
// (the api mirror must be byte-identical and lives in a different folder).
export interface SalesAgentIcp {
  categories: string[];
  cities: string[];
  minRating: number;
  minReviews: number;
  preferNoWebsite: boolean;
  excludeKeywords: string[];
}
export interface SalesAgentPersona {
  name: string;
  businessName: string;
  tone: 'formal' | 'friendly';
  languages: string[];
}

export const PROSPECT_TTL_DAYS = 30;
export const PLACES_PAGE_SIZE = 20;
export const PLACES_MAX_PAGES = 3;
export const PLACES_MAX_RESULTS = PLACES_PAGE_SIZE * PLACES_MAX_PAGES;

/** Field mask for `places:searchText` — everything we need in ONE request (Enterprise SKU). */
export const PLACES_TEXT_SEARCH_FIELD_MASK = [
  'places.id', 'places.displayName', 'places.formattedAddress', 'places.addressComponents',
  'places.rating', 'places.userRatingCount', 'places.primaryType', 'places.primaryTypeDisplayName',
  'places.websiteUri', 'places.nationalPhoneNumber', 'places.internationalPhoneNumber', 'places.businessStatus',
  'nextPageToken',
].join(',');

/** The subset of a Places API (New) `Place` we read. */
export interface PlaceLike {
  id?: string;
  displayName?: { text?: string } | string;
  formattedAddress?: string;
  addressComponents?: Array<{ longText?: string; shortText?: string; types?: string[] }>;
  rating?: number;
  userRatingCount?: number;
  primaryType?: string;
  primaryTypeDisplayName?: { text?: string } | string;
  websiteUri?: string;
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  businessStatus?: string;
}

export interface ProspectDraft {
  placeId: string;
  name: string;
  category: string | null;
  address: string | null;
  city: string | null;
  phone: string | null;
  website: string | null;
  rating: number | null;
  reviewCount: number | null;
  operational: boolean;
}

const textOf = (v: { text?: string } | string | undefined): string => (typeof v === 'string' ? v : v?.text || '').trim();

/** Humanise `dental_clinic` → `dental clinic`. */
export const humanizePlaceType = (t: string | null | undefined): string | null => (t ? t.replace(/_/g, ' ').trim() : null);

export function normalizePlace(p: PlaceLike, opts: { fallbackCity?: string | null; normalizePhone: (raw: string) => string }): ProspectDraft | null {
  const placeId = typeof p.id === 'string' ? p.id.trim() : '';
  const name = textOf(p.displayName);
  if (!placeId || !name) return null;
  const rawPhone = (p.internationalPhoneNumber || p.nationalPhoneNumber || '').trim();
  const phone = rawPhone ? opts.normalizePhone(rawPhone) || null : null;
  const cityComp = (p.addressComponents || []).find((c) => (c.types || []).includes('locality'))
    || (p.addressComponents || []).find((c) => (c.types || []).includes('administrative_area_level_1'));
  const city = (cityComp?.longText || cityComp?.shortText || opts.fallbackCity || '').trim() || null;
  const website = normalizeWebsite(p.websiteUri);
  const category = textOf(p.primaryTypeDisplayName) || humanizePlaceType(p.primaryType);
  return {
    placeId,
    name: name.slice(0, 160),
    category: category ? category.slice(0, 80) : null,
    address: p.formattedAddress ? p.formattedAddress.trim().slice(0, 240) : null,
    city: city ? city.slice(0, 80) : null,
    phone,
    website,
    rating: typeof p.rating === 'number' && Number.isFinite(p.rating) ? p.rating : null,
    reviewCount: typeof p.userRatingCount === 'number' && Number.isFinite(p.userRatingCount) ? p.userRatingCount : null,
    operational: !p.businessStatus || p.businessStatus === 'OPERATIONAL',
  };
}

/** `https://www.Example.com/path?utm=1` → `https://www.example.com/path`; non-http → null. */
export function normalizeWebsite(raw: string | undefined | null): string | null {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    u.hash = ''; u.search = '';
    const s = u.toString().replace(/\/$/, '');
    return s.slice(0, 200);
  } catch {
    return null;
  }
}

/** Host without `www.` — the dedupe key for websites. Facebook/Instagram pages are NOT a website of their own. */
export function websiteHost(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const h = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    if (/(^|\.)(facebook|instagram|fb|linktr|tiktok|wa)\.(com|me|ee)$/.test(h)) return null;
    return h || null;
  } catch {
    return null;
  }
}

export const isSocialOnlyWebsite = (url: string | null | undefined): boolean => !!url && websiteHost(url) === null;

export function normalizeName(name: string): string {
  return (name || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\b(sh\.?p\.?k\.?|shpk|sh\.?a\.?|ltd|llc|d\.?o\.?o\.?|studio|salon|salloni|klinika|clinic|dental|dentare)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export interface DedupeKeys {
  phone: string | null;
  host: string | null;
  nameCity: string;
}

export function dedupeKeysFor(d: Pick<ProspectDraft, 'phone' | 'website' | 'name' | 'city'>): DedupeKeys {
  return {
    phone: d.phone || null,
    host: websiteHost(d.website),
    nameCity: `${normalizeName(d.name)}|${(d.city || '').toLowerCase().trim()}`,
  };
}

export interface ExistingContactKey {
  id: string;
  kind: 'lead' | 'customer' | 'prospect';
  phone?: string | null;
  website?: string | null;
  name?: string | null;
  city?: string | null;
}

/** First existing record that shares a phone, a website host, or (name + city). */
export function findDuplicate(d: ProspectDraft, existing: readonly ExistingContactKey[]): ExistingContactKey | null {
  const k = dedupeKeysFor(d);
  for (const e of existing) {
    if (k.phone && e.phone && e.phone === k.phone) return e;
    const eh = websiteHost(e.website);
    if (k.host && eh && eh === k.host) return e;
    if (e.name && k.nameCity.split('|')[0] && `${normalizeName(e.name)}|${(e.city || d.city || '').toLowerCase().trim()}` === k.nameCity) return e;
  }
  return null;
}

// ── Fit score ───────────────────────────────────────────────────────────────

export interface FitResult { score: number; reasons: string[] }

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * 0–100, deterministic, explained. Tuned for an agency selling web/SEO/ads:
 * category∈ICP +30 · city∈ICP +15 · rating in the "has clients, room to grow" band
 * +15 · no/weak website +20 (when preferNoWebsite) · phone +10 · social-only site +10
 * · excluded keyword −40 · not operational −60 · too few reviews −10.
 */
export function fitScore(d: ProspectDraft, icp: SalesAgentIcp): FitResult {
  const reasons: string[] = [];
  let score = 10;
  const cat = norm(d.category || '');
  const name = norm(d.name);
  if (icp.categories.length && icp.categories.some((c) => cat.includes(norm(c)) || name.includes(norm(c)))) { score += 30; reasons.push('Kategori në ICP'); }
  else if (!icp.categories.length) { score += 15; }
  if (icp.cities.length && d.city && icp.cities.some((c) => norm(c) === norm(d.city || ''))) { score += 15; reasons.push(`Qyteti ${d.city}`); }
  else if (!icp.cities.length && d.city) { score += 5; }
  if (d.rating !== null && d.reviewCount !== null) {
    if (d.reviewCount < icp.minReviews) { score -= 10; reasons.push(`Vetëm ${d.reviewCount} vlerësime`); }
    else if (d.rating >= 3.5 && d.rating <= 4.6) { score += 15; reasons.push(`${d.rating}★ / ${d.reviewCount} vlerësime — ka klientë, ka vend për rritje`); }
    else if (d.rating > 4.6) { score += 8; reasons.push(`${d.rating}★ / ${d.reviewCount} vlerësime`); }
    else { score += 3; reasons.push(`${d.rating}★ — reputacion për t'u përmirësuar`); }
    if (d.rating < icp.minRating) { score -= 10; }
  } else {
    reasons.push('Pa vlerësime në Google');
  }
  if (icp.preferNoWebsite) {
    if (!d.website) { score += 20; reasons.push('Pa website'); }
    else if (isSocialOnlyWebsite(d.website)) { score += 10; reasons.push('Vetëm faqe sociale, pa website'); }
    else if (d.website.startsWith('http://')) { score += 8; reasons.push('Website pa HTTPS'); }
  }
  if (d.phone) { score += 10; reasons.push('Telefon i disponueshëm'); } else { reasons.push('Pa telefon'); }
  const bad = icp.excludeKeywords.find((k) => k && (name.includes(norm(k)) || cat.includes(norm(k))));
  if (bad) { score -= 40; reasons.push(`Përjashtuar: "${bad}"`); }
  if (!d.operational) { score -= 60; reasons.push('Jo operativ sipas Google'); }
  return { score: Math.max(0, Math.min(100, Math.round(score))), reasons };
}

// ── Cost ────────────────────────────────────────────────────────────────────

/** Places bills per REQUEST (≤ 20 results each), max 3 pages per search. */
export function estimateSearchRequests(maxResults: number): number {
  const n = Math.max(1, Math.min(PLACES_MAX_RESULTS, Math.round(maxResults || PLACES_PAGE_SIZE)));
  return Math.min(PLACES_MAX_PAGES, Math.ceil(n / PLACES_PAGE_SIZE));
}

export type SearchBlockReason = 'empty-query' | 'empty-city' | 'budget-exceeded' | 'too-many-queued';

export function searchBlockReason(i: { query: string; city: string; maxResults: number; requestsUsedThisMonth: number; monthlyBudget: number; queuedCount: number }): SearchBlockReason | null {
  if (!i.query.trim()) return 'empty-query';
  if (!i.city.trim()) return 'empty-city';
  if (i.queuedCount >= 10) return 'too-many-queued';
  if (i.requestsUsedThisMonth + estimateSearchRequests(i.maxResults) > i.monthlyBudget) return 'budget-exceeded';
  return null;
}

export const SEARCH_BLOCK_LABELS: Record<SearchBlockReason, string> = {
  'empty-query': 'Shkruani çfarë kërkoni (p.sh. "klinika dentare")',
  'empty-city': 'Zgjidhni qytetin',
  'budget-exceeded': 'Buxheti mujor i kërkimeve Places do të tejkalohej',
  'too-many-queued': 'Ka tashmë 10 kërkime në radhë',
};

export function prospectExpiresAt(createdAt: Date): Date {
  return new Date(createdAt.getTime() + PROSPECT_TTL_DAYS * 86_400_000);
}

// ── First-contact drafts (deterministic; the model is not needed for a first line) ──

export interface FirstContactInput {
  prospect: Pick<ProspectDraft, 'name' | 'category' | 'city' | 'website' | 'rating' | 'reviewCount'>;
  persona: SalesAgentPersona;
  /** What the agency sells to this kind of business ("website profesional", "SEO lokal"). */
  serviceLine: string;
  senderName?: string | null;
}

/** Email first message: specific observation → one-line value → one small ask. */
export function buildFirstEmailDraft(i: FirstContactInput): { subject: string; body: string } {
  const p = i.prospect;
  const biz = i.persona.businessName || 'ekipi ynë';
  const observation = !p.website
    ? `pashë që ${p.name} nuk ka ende një website ku klientët t'ju gjejnë jashtë Google Maps`
    : isSocialOnlyWebsite(p.website)
      ? `pashë që ${p.name} është e pranishme vetëm në rrjete sociale, pa një faqe të vetën`
      : p.rating !== null && p.rating < 4.3
        ? `pashë vlerësimet tuaja në Google (${p.rating}★) dhe mendoj se ka vend për më shumë klientë të kënaqur`
        : `pashë profilin tuaj në Google Maps${p.reviewCount ? ` (${p.reviewCount} vlerësime)` : ''}`;
  const subject = `${p.name} — një ide për ${i.serviceLine}`;
  const body = [
    `Përshëndetje,`,
    ``,
    `Jam ${i.persona.name}, asistentja virtuale e ${biz}. Ju shkruaj sepse ${observation}.`,
    ``,
    `Ndihmojmë biznese si juaji${p.category ? ` (${p.category.toLowerCase()})` : ''}${p.city ? ` në ${p.city}` : ''} me ${i.serviceLine}.`,
    ``,
    `A do të kishit 10 minuta këtë javë për një bisedë të shkurtër me ${i.senderName || 'kolegun tim'}? Mjafton një "po" dhe ju propozoj dy orare.`,
    ``,
    `Nëse nuk dëshironi të kontaktoheni, përgjigjuni me "Jo, faleminderit" dhe nuk do t'ju shkruajmë më.`,
    ``,
    `${i.persona.name}`,
    biz,
  ].join('\n');
  return { subject, body };
}

/** The script a HUMAN reads when calling. Never sent anywhere. */
export function buildCallScript(i: FirstContactInput): string {
  const p = i.prospect;
  const biz = i.persona.businessName || 'ekipi ynë';
  return [
    `HAPJA: "Përshëndetje, jam ${i.senderName || '[emri]'} nga ${biz}. A po flas me pronarin ose menaxherin e ${p.name}?"`,
    `ARSYEJA: "Ju gjeta në Google Maps${p.rating !== null ? ` — ${p.rating}★${p.reviewCount ? ` me ${p.reviewCount} vlerësime` : ''}` : ''}. ${!p.website ? 'Vura re që nuk keni website.' : 'Vura re website-in tuaj.'} Ndihmojmë biznese si juaji me ${i.serviceLine}."`,
    `PYETJA: "Si i gjeni sot klientët e rinj — kryesisht nga rekomandimet apo edhe online?"`,
    `MBYLLJA: "Nuk dua t'ju marr kohë tani. A mund t'ju dërgoj dy rreshta në WhatsApp/email dhe të caktojmë 15 minuta javën tjetër?"`,
    `NËSE JO: Falënderoni, shënoni arsyen në CRM, mos insistoni.`,
  ].join('\n');
}

export function buildColdWaDraft(template: string, i: FirstContactInput, renderTemplate: (tpl: string, vars: Record<string, string | null | undefined>) => string): string {
  const p = i.prospect;
  const first = p.name.split(/\s+/)[0] || p.name;
  return renderTemplate(template, {
    name: first,
    company: p.name,
    agent: i.persona.name,
    business: i.persona.businessName || 'ekipit tonë',
    service: i.serviceLine,
    city: p.city || '',
  });
}
