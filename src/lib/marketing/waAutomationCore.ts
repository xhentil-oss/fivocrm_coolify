// ── WhatsApp campaign automation — the import-free CORE ─────────────────────
//
// The eligibility gate, the phone rule, variant selection, rendering, quiet
// hours and the per-phone failure ledger: everything the browser preview
// (`waAutomation.ts`, which re-exports this) and the cron
// (`whatsapp-broadcasts` / `whatsapp-automations` in api/cron/run.ts) must
// answer the SAME way.
//
// Pure — no Firebase, no React, no imports. `api/_waAutomationCore.ts` is a
// BYTE-IDENTICAL copy (api/ never imports from src/); `waAutomation.test.ts`
// reads both files and fails on any difference, so "keeping them in sync" means
// copying the file. Before this split run.ts carried a hand-written mirror whose
// phone rule had drifted ("069…" vs "35569…" were two people), so the dormancy
// cooldown never matched and a customer stored in local format was re-messaged
// by an evergreen rule every single day.
//
// LAW: the dormancy window IS the cooldown (see waAutomation.ts).

/** A lead or customer as the segment engine sees it (both shapes, loosely typed
 *  because customers carry `tags`/`notes` as untyped Firestore fields). */
export interface WaContact {
  id: string;
  name?: string;
  company?: string;
  phone?: string;
  phoneNumber?: string;
  email?: string;
  tags?: unknown;                 // string[] (leads) or comma string (customers)
  businessCategory?: string;      // lead's business category ("Makina me qera", …)
  notes?: string;
  status?: string;
  source?: string;
  assignedToUserId?: string;
  lastActivityAt?: unknown;       // Date | Firestore Timestamp | string
  lastFollowUpDate?: unknown;
  firstResponseAt?: unknown;
  createdAt?: unknown;
  [k: string]: unknown;
}

/** One service-specific message inside a campaign. The FIRST variant whose tags
 *  match the contact wins; a variant with no tags is the fallback. */
export interface WaMessageVariant {
  id: string;
  label?: string;                 // internal name, e.g. "SEO — riaktivizim"
  tags: string[];                 // service tags that select this variant ([] = fallback)
  body: string;                   // text with {{name}} / {{notes}} / {{link}} tokens
  landingUrl?: string;            // "more info" link for THIS service
}

/** The conditions layered on top of the existing segment filters. */
export interface WaConditions {
  /** Only contacts whose last contact is at least this many days old (dormancy). */
  lastContactMinDays?: number;
  /** …and at most this many days old (skip truly ancient, dead contacts). */
  lastContactMaxDays?: number;
  /** Require a real prior contact — excludes leads nobody ever touched. */
  requireContacted?: boolean;
  /** Only contacts that have notes (so `{{notes}}` never renders empty). */
  requireNotes?: boolean;
  /** Evergreen safety net: max sends per run. */
  dailyCap?: number;
}

/** The existing segment shape (unchanged) + the new conditions. */
export interface WaSegment {
  audience?: ('leads' | 'customers')[];
  statuses?: string[];
  tags?: string[];
  tagMatch?: 'any' | 'all';
  tag?: string;                   // @deprecated single-tag back-compat
  /** Lead business categories (`Lead.businessCategory`) — ANY match. */
  categories?: string[];
  assignedToUserId?: string;
  source?: string;
  hasDomain?: boolean;
}

export type WaBlockReason =
  | 'no-phone'
  | 'status-mismatch'
  | 'tag-mismatch'
  | 'category-mismatch'
  | 'assignee-mismatch'
  | 'source-mismatch'
  | 'domain-mismatch'
  | 'never-contacted'
  | 'contacted-too-recently'
  | 'contact-too-old'
  | 'no-notes'
  | 'no-variant'
  | 'already-sent'
  /** The contact said STOP (`waOptOut`, set by the inbound handler on every record with that phone). */
  | 'opted-out'
  /** A previous send to this exact number failed permanently (not on WhatsApp, invalid number, …). */
  | 'undeliverable'
  /** This campaign: the number failed permanently — never retried. */
  | 'failed-permanent'
  /** This campaign: the number failed WA_MAX_SEND_ATTEMPTS times (transient errors) — given up. */
  | 'retries-exhausted'
  /** This campaign: another run claimed the number and has not reported back yet. */
  | 'in-flight'
  /** Run-level: outside the 09:00–20:00 Europe/Tirane send window; nothing consumed. */
  | 'quiet-hours'
  /** Run-level: the sending number/VPS/Meta channel is down; the batch stopped, no attempt counted. */
  | 'channel-down';

/** Human labels for the UI breakdown (Albanian — this is user-facing copy). */
export const WA_BLOCK_LABELS: Record<WaBlockReason, string> = {
  'no-phone': 'pa numër telefoni',
  'status-mismatch': 'status jashtë filtrit',
  'tag-mismatch': 'pa etiketën e kërkuar',
  'category-mismatch': 'kategori tjetër biznesi',
  'assignee-mismatch': 'caktuar te tjetërkush',
  'source-mismatch': 'burim tjetër',
  'domain-mismatch': 'pa domain të regjistruar',
  'never-contacted': 'nuk është kontaktuar kurrë',
  'contacted-too-recently': 'kontaktuar së fundmi',
  'contact-too-old': 'kontakti shumë i vjetër',
  'no-notes': 'pa shënime',
  'no-variant': 'asnjë tekst për etiketat e tij',
  'already-sent': 'i dërguar më parë',
  'opted-out': 'ka refuzuar mesazhet WhatsApp',
  'undeliverable': 'numri nuk merr WhatsApp',
  'failed-permanent': 'dështoi përfundimisht',
  'retries-exhausted': 'dështoi 3 herë',
  'in-flight': 'në dërgim nga një ekzekutim tjetër',
  'quiet-hours': 'jashtë orarit të dërgimit (09–20)',
  'channel-down': 'numri WhatsApp / kanali nuk përgjigjej',
};

export const MS_PER_DAY = 86_400_000;

// ── Normalization helpers ────────────────────────────────────────────────────

/** Tags come as an array (leads) or a comma string (customers). One reader for
 *  both — this logic was duplicated in the view and the cron.
 *
 *  Takes `unknown` rather than `{ tags?: unknown }` on purpose: the latter is a
 *  WEAK type (every property optional), so TypeScript rejects a `Customer` —
 *  which declares no `tags` field at all — for having no properties in common,
 *  even though reading `.tags` off it is exactly the point. */
export function contactTags(e: unknown): string[] {
  const t = (e as { tags?: unknown } | null | undefined)?.tags;
  if (Array.isArray(t)) return t.map((x) => String(x).trim()).filter(Boolean);
  if (typeof t === 'string') return t.split(',').map((s) => s.trim()).filter(Boolean);
  return [];
}

/**
 * The contact's business category — the CRM's `Lead.businessCategory`
 * ("Makina me qera", "Hoteleri & Turizëm", …).
 *
 * `category`/`industry` are read as aliases because imported and landing-form
 * rows have historically written one of those instead; a customer row usually
 * carries none at all, which is what `buildCategoryIndex` fills in.
 */
export function contactCategory(e: unknown): string {
  const o = e as { businessCategory?: unknown; category?: unknown; industry?: unknown } | null | undefined;
  const raw = o?.businessCategory ?? o?.category ?? o?.industry;
  return String(raw ?? '').trim();
}

/** Case-insensitive membership — categories are free text typed by the user. */
export function categoryMatches(cat: string, want: string[]): boolean {
  if (!cat) return false;
  const c = cat.toLowerCase();
  return want.some((w) => String(w || '').trim().toLowerCase() === c);
}

/**
 * contactId → business category, so a CUSTOMER can be filtered by the category
 * of the lead it was converted from.
 *
 * The category lives on the lead only (`Customer` has no such field), yet the
 * same person is usually both — without this, "kategoria = Makina me qera"
 * silently dropped every existing client from the segment.
 */
export function buildCategoryIndex(leads: WaContact[] = [], customers: WaContact[] = []): Map<string, string> {
  const index = new Map<string, string>();
  for (const l of leads) {
    const cat = contactCategory(l);
    if (!cat) continue;
    index.set(String(l.id), cat);
    const linked = (l as { customerId?: unknown }).customerId;
    if (linked) index.set(String(linked), cat);
  }
  for (const c of customers) {
    const own = contactCategory(c);
    if (own) { index.set(String(c.id), own); continue; }
    const leadId = (c as { leadId?: unknown }).leadId;
    const fromLead = leadId ? index.get(String(leadId)) : undefined;
    if (fromLead) index.set(String(c.id), fromLead);
  }
  return index;
}

/**
 * THE WhatsApp phone rule — same body as `toWaPhone` (src/lib/messaging/waPhone.ts;
 * copied because this module is import-free, pinned by a test): digits only, `00`
 * stripped, Albanian local forms ('069…', '69…', '3550…') → '355…', 8–15 digits
 * else ''. Digits-only used to make '0691234567' and '355691234567' two people,
 * so the dormancy lookup never matched a customer typed in local format.
 */
export function normalizePhone(p?: unknown): string {
  let digits = String(p ?? '').replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (/^3550[6-9]/.test(digits)) digits = '355' + digits.slice(4);
  else if (/^0[6-9]\d{7,8}$/.test(digits)) digits = '355' + digits.slice(1);
  else if (/^[6-9]\d{8}$/.test(digits)) digits = '355' + digits;
  return digits.length >= 8 && digits.length <= 15 ? digits : '';
}

export function contactPhone(e: WaContact): string {
  return normalizePhone(e.phone || e.phoneNumber);
}

/** A phone we can actually deliver to. */
export function isSendablePhone(p?: unknown): boolean {
  return normalizePhone(p) !== '';
}

/**
 * A permanent failure is recorded on the contact as the NUMBER it failed for
 * (`waUndeliverablePhone`), so editing the phone re-arms the contact by itself.
 */
export function isWaUndeliverable(e: unknown): boolean {
  const o = e as { waUndeliverablePhone?: unknown; phone?: unknown; phoneNumber?: unknown } | null | undefined;
  const bad = normalizePhone(o?.waUndeliverablePhone);
  return bad !== '' && bad === normalizePhone(o?.phone || o?.phoneNumber);
}

/** Firestore Timestamp | Date | ISO string | millis → Date | null. */
export function toDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  if (typeof v === 'object' && typeof (v as { toDate?: unknown }).toDate === 'function') {
    const d = (v as { toDate: () => Date }).toDate();
    return d instanceof Date && !isNaN(d.getTime()) ? d : null;
  }
  if (typeof v === 'number') { const d = new Date(v); return isNaN(d.getTime()) ? null : d; }
  if (typeof v === 'string') { const d = new Date(v); return isNaN(d.getTime()) ? null : d; }
  return null;
}

// ── "When did we last talk to this person?" ─────────────────────────────────

/**
 * The last time we touched this contact, across every signal we keep.
 *
 * `lastMessageAt` is the newest WhatsApp message for their phone (the cron looks
 * it up with a bounded range query; the browser passes what it already has).
 * `createdAt` is deliberately NOT a contact — a lead that was imported and never
 * touched must read as "never contacted", not "contacted on import day".
 *
 * Returns null when we have never actually reached out.
 */
export function resolveLastContactAt(e: WaContact, lastMessageAt?: Date | null): Date | null {
  const candidates = [
    toDate(lastMessageAt),
    toDate(e.lastActivityAt),
    toDate(e.lastFollowUpDate),
    toDate(e.firstResponseAt),
  ].filter((d): d is Date => !!d);
  if (!candidates.length) return null;
  return candidates.reduce((a, b) => (b.getTime() > a.getTime() ? b : a));
}

/** Whole days elapsed since `d`. Null in → null out ("never"). */
export function daysSince(d: Date | null, now: Date): number | null {
  if (!d) return null;
  return Math.floor((now.getTime() - d.getTime()) / MS_PER_DAY);
}

// ── Variant selection ───────────────────────────────────────────────────────

/**
 * Pick the message for this contact: the MOST SPECIFIC matching variant wins
 * (most matched tags first), falling back to a tagless variant.
 *
 * Specificity matters — a rule usually has "SEO", "Ads", and a generic catch-all.
 * Declaration order should not decide which of two matching services answers.
 */
export function pickVariant(e: WaContact, variants: WaMessageVariant[] | undefined): WaMessageVariant | null {
  const list = (variants || []).filter((v) => v && (v.body || '').trim());
  if (!list.length) return null;
  const tags = contactTags(e);
  let best: WaMessageVariant | null = null;
  let bestScore = -1;
  for (const v of list) {
    const want = (v.tags || []).filter(Boolean);
    if (!want.length) {                       // fallback variant: score 0
      if (bestScore < 0) { best = v; bestScore = 0; }
      continue;
    }
    const hits = want.filter((t) => tags.includes(t)).length;
    if (hits > 0 && hits > bestScore) { best = v; bestScore = hits; }
  }
  return best;
}

/** The service label to put in `{{service}}` — the variant's matched tag. */
export function variantServiceLabel(e: WaContact, v: WaMessageVariant | null): string {
  if (!v) return '';
  const tags = contactTags(e);
  const matched = (v.tags || []).find((t) => tags.includes(t));
  return matched || v.label || '';
}

// ── Link building ───────────────────────────────────────────────────────────

/**
 * Append UTM parameters to a landing-page URL, preserving any query it already
 * has. Returns the input untouched when it isn't a usable http(s) URL — a broken
 * link is better than a thrown cron.
 */
export function withUtm(
  url: string | undefined,
  utm?: { source?: string; medium?: string; campaign?: string; content?: string },
): string {
  const raw = (url || '').trim();
  if (!raw) return '';
  if (!/^https?:\/\//i.test(raw)) return raw;
  try {
    const u = new URL(raw);
    const map: Record<string, string | undefined> = {
      utm_source: utm?.source,
      utm_medium: utm?.medium,
      utm_campaign: utm?.campaign,
      utm_content: utm?.content,
    };
    for (const [k, v] of Object.entries(map)) {
      if (v && !u.searchParams.has(k)) u.searchParams.set(k, v);
    }
    return u.toString();
  } catch {
    return raw;
  }
}

// ── Message rendering ───────────────────────────────────────────────────────

/** First name only — "Përshëndetje Ardit" reads human, the full legal name doesn't. */
export function firstName(name?: string): string {
  return String(name || '').trim().split(/\s+/)[0] || '';
}

/**
 * Trim a lead's notes down to something quotable inside a WhatsApp message.
 * Notes are an internal scratchpad: multi-line, sometimes with a leading date or
 * a "—" bullet. We take the FIRST meaningful line, strip bullet/date noise and
 * cap the length, because the whole point is a one-clause callback
 * ("…për faqen e-commerce që diskutuam"), not a paste of the CRM.
 */
export function summarizeNotes(notes?: string, maxLen = 160): string {
  const firstLine = String(notes || '')
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-•*]|\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?\s*[:-]?)\s*/, '').trim())
    .find((l) => l.length > 0);
  if (!firstLine) return '';
  if (firstLine.length <= maxLen) return firstLine;
  // Cut on a word boundary so the quote doesn't end mid-word.
  const cut = firstLine.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > maxLen * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[,;:.\s]+$/, '')}…`;
}

export interface RenderContext {
  link?: string;                  // already UTM-tagged
  service?: string;
  extra?: Record<string, string>; // campaign-level custom tokens
}

/**
 * Render a variant body. Named tokens are case-insensitive; unknown tokens
 * render EMPTY (never the literal `{{foo}}` — a customer must not receive our
 * template syntax). Positional `{{1}}`-style tokens are left to the legacy
 * `paramFields` renderer in the cron, so old templates are untouched here.
 *
 * When the body has no `{{link}}` but a link exists, it is appended on its own
 * line — that's the common case ("…more info: <url>") and forgetting the token
 * shouldn't silently drop the link.
 */
export function renderWaMessage(body: string, e: WaContact, ctx: RenderContext = {}): string {
  const vars: Record<string, string> = {
    name: firstName(e.name),
    fullname: String(e.name || '').trim(),
    company: String(e.company || '').trim(),
    notes: summarizeNotes(e.notes),
    link: ctx.link || '',
    service: ctx.service || '',
    ...Object.fromEntries(Object.entries(ctx.extra || {}).map(([k, v]) => [k.toLowerCase(), v])),
  };
  const hadLinkToken = /\{\{\s*link\s*\}\}/i.test(body || '');
  let out = String(body || '').replace(/\{\{\s*([a-zA-Z_][\w.]*)\s*\}\}/g, (_m, key: string) => {
    const v = vars[String(key).toLowerCase()];
    return v == null ? '' : v;
  });
  // Collapse the blank space a missing token leaves behind.
  out = out.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  if (!hadLinkToken && ctx.link) out = `${out}\n\n${ctx.link}`;
  return out;
}

// ── The gate ────────────────────────────────────────────────────────────────

export interface WaEligibilityContext {
  now: Date;
  /** Newest WhatsApp message per normalized phone (bounded lookup upstream). */
  lastMessageByPhone?: Map<string, Date>;
  /** One-shot campaigns: phones already sent (from `sentPhones`). */
  sentPhones?: Set<string>;
  /** `hasDomain` filter: customerIds owning a domain. Null = filter is off. */
  domainCustomerIds?: Set<string> | null;
  /** Leads can never own a domain, so `hasDomain` excludes them wholesale. */
  kind: 'lead' | 'customer';
  /** contactId → category, for contacts whose own doc carries none (customers). */
  categoryByContactId?: Map<string, string>;
  /** One-shot campaigns: per-phone failure ledger (`failedPhones` on the campaign doc). */
  failedPhones?: Map<string, WaFailedPhone>;
  /** Phones another run has claimed and not yet reported (`inFlightPhones`, fresh only). */
  inFlightPhones?: Set<string>;
}

/**
 * The ONE answer to "may we message this contact?". Returns null when eligible,
 * otherwise the reason — checked cheapest-first so a big segment costs little.
 *
 * The cron imports the byte-identical copy (api/_waAutomationCore.ts).
 */
export function waSendBlockReason(
  e: WaContact,
  segment: WaSegment,
  conditions: WaConditions,
  ctx: WaEligibilityContext,
  variants?: WaMessageVariant[],
): WaBlockReason | null {
  const phone = contactPhone(e);
  if (!isSendablePhone(phone)) return 'no-phone';
  // STOP is absolute — before any segment filter, so the breakdown shows it.
  if ((e as { waOptOut?: unknown }).waOptOut === true) return 'opted-out';
  if (isWaUndeliverable(e)) return 'undeliverable';

  // ── the existing segment filters ──
  if (ctx.kind === 'lead' && segment.statuses?.length && !segment.statuses.includes(String(e.status || ''))) {
    return 'status-mismatch';
  }
  const wantTags = segment.tags?.length ? segment.tags : (segment.tag ? [segment.tag] : []);
  if (wantTags.length) {
    const has = contactTags(e);
    const ok = segment.tagMatch === 'all'
      ? wantTags.every((t) => has.includes(t))
      : wantTags.some((t) => has.includes(t));
    if (!ok) return 'tag-mismatch';
  }
  const wantCategories = (segment.categories || []).filter(Boolean);
  if (wantCategories.length) {
    const cat = contactCategory(e) || ctx.categoryByContactId?.get(String(e.id)) || '';
    if (!categoryMatches(cat, wantCategories)) return 'category-mismatch';
  }
  if (segment.assignedToUserId && e.assignedToUserId !== segment.assignedToUserId) return 'assignee-mismatch';
  if (segment.source && String(e.source || '') !== segment.source) return 'source-mismatch';
  if (segment.hasDomain) {
    if (ctx.kind === 'lead') return 'domain-mismatch';
    if (ctx.domainCustomerIds && !ctx.domainCustomerIds.has(String(e.id))) return 'domain-mismatch';
  }

  if (ctx.sentPhones?.has(phone)) return 'already-sent';
  const failure = waFailureBlock(ctx.failedPhones?.get(phone));
  if (failure) return failure;
  if (ctx.inFlightPhones?.has(phone)) return 'in-flight';

  // ── the new conditions ──
  if (conditions.requireNotes && !summarizeNotes(e.notes)) return 'no-notes';

  const hasDormancyRule =
    conditions.lastContactMinDays != null ||
    conditions.lastContactMaxDays != null ||
    !!conditions.requireContacted;
  if (hasDormancyRule) {
    const lastAt = resolveLastContactAt(e, ctx.lastMessageByPhone?.get(phone) || null);
    const age = daysSince(lastAt, ctx.now);
    if (age == null) {
      // Never contacted. That is maximally dormant, so a min-days rule is
      // satisfied — but an explicit `requireContacted`, or a window CEILING
      // (which is a statement about a real past contact), excludes them.
      if (conditions.requireContacted) return 'never-contacted';
      if (conditions.lastContactMaxDays != null) return 'never-contacted';
    } else {
      if (conditions.lastContactMinDays != null && age < conditions.lastContactMinDays) {
        return 'contacted-too-recently';
      }
      if (conditions.lastContactMaxDays != null && age > conditions.lastContactMaxDays) {
        return 'contact-too-old';
      }
    }
  }

  // A variant-driven campaign must actually have text for THIS contact.
  if (variants?.length && !pickVariant(e, variants)) return 'no-variant';

  return null;
}

// ── Per-phone failure ledger (one-shot campaigns + evergreen rules) ──────────

/** Transient failures per number before a campaign gives up on it. */
export const WA_MAX_SEND_ATTEMPTS = 3;

/** One entry of `failedPhones` on a campaign doc (keyed by normalised phone). */
export interface WaFailedPhone {
  count: number;
  permanent?: boolean;
  error?: string;
  at?: unknown;
}

/** Why a recorded failure keeps this number out of the next batch (null = retry it). */
export function waFailureBlock(f: WaFailedPhone | null | undefined): 'failed-permanent' | 'retries-exhausted' | null {
  if (!f) return null;
  if (f.permanent) return 'failed-permanent';
  if ((Number(f.count) || 0) >= WA_MAX_SEND_ATTEMPTS) return 'retries-exhausted';
  return null;
}

/** `failedPhones` map off a Firestore doc → Map keyed by normalised phone. */
export function readFailedPhones(raw: unknown): Map<string, WaFailedPhone> {
  const out = new Map<string, WaFailedPhone>();
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const phone = normalizePhone(k);
    if (!phone || !v || typeof v !== 'object') continue;
    const o = v as { count?: unknown; permanent?: unknown; error?: unknown; at?: unknown };
    out.set(phone, { count: Number(o.count) || 0, permanent: o.permanent === true, error: typeof o.error === 'string' ? o.error : undefined, at: o.at });
  }
  return out;
}

/** In-flight claims older than this belong to a run that died; they become a failed attempt. */
export const WA_IN_FLIGHT_STALE_MS = 15 * 60 * 1000;

/**
 * Split `inFlightPhones` (phone → claimed-at) into the FRESH claims (another run is
 * sending — skip) and the STALE ones (that run died mid-send — the caller records
 * an attempt, never a silent retry).
 */
export function splitInFlight(raw: unknown, nowMs: number): { fresh: Set<string>; stale: string[] } {
  const fresh = new Set<string>();
  const stale: string[] = [];
  if (!raw || typeof raw !== 'object') return { fresh, stale };
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const phone = normalizePhone(k);
    if (!phone) continue;
    const at = toDate(v);
    if (at && nowMs - at.getTime() < WA_IN_FLIGHT_STALE_MS) fresh.add(phone);
    else stale.push(phone);
  }
  return { fresh, stale };
}

// ── Quiet hours (broadcasts + evergreen rules) ───────────────────────────────

export const WA_QUIET_TZ = 'Europe/Tirane';
export const WA_SEND_HOUR_START = 9;
export const WA_SEND_HOUR_END = 20;

/** Wall-clock hour (0–23) in the zone — never the machine's own zone. */
export function waLocalHour(nowMs: number, timeZone: string = WA_QUIET_TZ): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', hour: '2-digit' }).formatToParts(new Date(nowMs));
  return Number(parts.find((p) => p.type === 'hour')?.value || 0) % 24;
}

/** 'quiet-hours' outside [09:00, 20:00) Europe/Tirane, else null. Marketing never wakes anyone. */
export function waQuietHoursBlock(nowMs: number, timeZone: string = WA_QUIET_TZ): 'quiet-hours' | null {
  const h = waLocalHour(nowMs, timeZone);
  return h < WA_SEND_HOUR_START || h >= WA_SEND_HOUR_END ? 'quiet-hours' : null;
}

/** YYYY-MM-DD of `nowMs` in the zone (idempotency keys are per LOCAL day). */
export function waLocalDayKey(nowMs: number, timeZone: string = WA_QUIET_TZ): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(nowMs));
  const get = (t: string) => parts.find((p) => p.type === t)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

// ── Deterministic idempotency keys (the VPS refuses a repeat within 24h) ─────

export function waBroadcastIdempotencyKey(broadcastId: string, phone: string): string {
  return `bc_${broadcastId}_${normalizePhone(phone) || phone}`;
}

export function waAutomationIdempotencyKey(ruleId: string, phone: string, dayKey: string): string {
  return `auto_${ruleId}_${normalizePhone(phone) || phone}_${dayKey}`;
}
