// ── WhatsApp campaign automation — the rules engine ──────────────────────────
//
// Pure logic ONLY (no Firestore, no fetch) so both the browser (segment preview
// in WhatsappBroadcasts) and the server (`whatsapp-broadcasts` /
// `whatsapp-automations` in api/cron/run.ts) can answer the same question the
// same way: *may we message this contact, and with what text?*
//
// Two things live here that used to be spread around:
//
//  1. **Eligibility** — `waSendBlockReason()` is the single gate. Every filter
//     (status, tag, assignee, source, domain, dormancy, notes, cooldown) returns
//     a NAMED reason instead of a silent `continue`, so the UI can explain
//     "1 240 matched, 900 contacted too recently" instead of showing 340 with no
//     account of the rest.
//
//  2. **The message** — a campaign carries VARIANTS, not one body. The variant
//     is chosen by the contact's own tags, so "leads interested in SEO" and
//     "leads interested in Ads" get different text from one rule, each with its
//     own landing page. Tokens are named (`{{name}}`, `{{notes}}`, `{{link}}`)
//     and the legacy positional `{{1}}` form still renders, so existing
//     `waTemplates` bodies keep working.
//
// LAW: the dormancy window IS the cooldown. A contact we messaged yesterday has
// a fresh last-contact date, so a `lastContactMinDays: 30` rule cannot pick them
// up again for 30 days. That is why an evergreen rule needs no per-person
// enrollment record (unlike email's `campaignEnrollments`) — the condition
// self-enforces. Do not "optimize" it into a permanent sent-list: that would
// make a re-engagement rule fire once per contact, ever.

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
  | 'already-sent';

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

/** Digits-only phone, matching the cron's `normalizeWaPhone`. */
export function normalizePhone(p?: unknown): string {
  return String(p ?? '').replace(/\D/g, '');
}

export function contactPhone(e: WaContact): string {
  return normalizePhone(e.phone || e.phoneNumber);
}

/** A phone we can actually deliver to. */
export function isSendablePhone(p?: unknown): boolean {
  return normalizePhone(p).length >= 7;
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
}

/**
 * The ONE answer to "may we message this contact?". Returns null when eligible,
 * otherwise the reason — checked cheapest-first so a big segment costs little.
 *
 * Mirrored in api/cron/run.ts (`waBlockReason`) — keep the two in sync.
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

// ── Segment evaluation (preview + send share this) ──────────────────────────

export interface WaResolvedTarget {
  contact: WaContact;
  phone: string;
  variant: WaMessageVariant | null;
  message: string;
  link: string;
}

export interface WaSegmentResult {
  /** EVERY eligible contact — not truncated by `dailyCap`. */
  targets: WaResolvedTarget[];
  /** How many contacts each reason removed — powers the UI breakdown. */
  blocked: Record<string, number>;
  /** Total contacts considered before any filter. */
  considered: number;
  /** Removed as a duplicate phone (same person as lead AND customer). */
  deduped: number;
  /**
   * How many of `targets` go out in the NEXT run, after `dailyCap`. Kept separate
   * from `targets.length` so the UI can say "50 qualify, 20 in this run" — a
   * truncated list would report 20 qualifying and hide the other 30.
   */
  sendableNow: number;
}

export interface WaEvaluateInput {
  leads?: WaContact[];
  customers?: WaContact[];
  segment: WaSegment;
  conditions?: WaConditions;
  variants?: WaMessageVariant[];
  /** Fallback body when no variants are configured (legacy template body). */
  fallbackBody?: string;
  defaultLandingUrl?: string;
  utm?: { source?: string; medium?: string; campaign?: string; content?: string };
  now: Date;
  lastMessageByPhone?: Map<string, Date>;
  sentPhones?: Set<string>;
  domainCustomerIds?: Set<string> | null;
  /** Override the derived category index (the cron builds its own). */
  categoryByContactId?: Map<string, string>;
}

/**
 * Resolve a segment to the exact list of messages that would go out, plus a
 * per-reason account of everyone who didn't. Deduped by phone (a person who is
 * both a lead and a customer is one WhatsApp conversation) — the lead wins,
 * because its `notes`/`status` are what the campaign is reasoning about.
 */
export function evaluateWaSegment(input: WaEvaluateInput): WaSegmentResult {
  const {
    segment, conditions = {}, variants, fallbackBody, defaultLandingUrl, utm, now,
    lastMessageByPhone, sentPhones, domainCustomerIds,
  } = input;
  // Only pay for the lead↔customer category index when the filter is on.
  const categoryByContactId = segment.categories?.length
    ? (input.categoryByContactId || buildCategoryIndex(input.leads, input.customers))
    : undefined;
  const audience = segment.audience?.length ? segment.audience : ['leads'];
  const blocked: Record<string, number> = {};
  const bump = (r: WaBlockReason) => { blocked[r] = (blocked[r] || 0) + 1; };

  const byPhone = new Map<string, WaResolvedTarget>();
  let considered = 0;
  let deduped = 0;

  // A link depends only on the variant, not the contact — build each one once
  // instead of parsing a URL per contact on every keystroke of the preview.
  const linkCache = new Map<string, string>();
  const linkFor = (raw: string | undefined) => {
    const key = raw || '';
    let v = linkCache.get(key);
    if (v === undefined) { v = withUtm(key, utm); linkCache.set(key, v); }
    return v;
  };

  const consider = (e: WaContact, kind: 'lead' | 'customer') => {
    considered++;
    const reason = waSendBlockReason(e, segment, conditions, {
      now, lastMessageByPhone, sentPhones, domainCustomerIds, kind, categoryByContactId,
    }, variants);
    if (reason) { bump(reason); return; }

    const phone = contactPhone(e);
    if (byPhone.has(phone)) { deduped++; return; }

    const variant = pickVariant(e, variants);
    const body = variant?.body || fallbackBody || '';
    const link = linkFor(variant?.landingUrl || defaultLandingUrl);
    const service = variantServiceLabel(e, variant);
    byPhone.set(phone, {
      contact: e, phone, variant,
      message: renderWaMessage(body, e, { link, service }),
      link,
    });
  };

  if (audience.includes('leads')) for (const l of input.leads || []) consider(l, 'lead');
  if (audience.includes('customers')) for (const c of input.customers || []) consider(c, 'customer');

  const targets = Array.from(byPhone.values());
  const cap = Number(conditions.dailyCap) || 0;
  const sendableNow = cap > 0 ? Math.min(targets.length, cap) : targets.length;
  return { targets, blocked, considered, deduped, sendableNow };
}

/**
 * Validation for the campaign builder. Returns user-facing Albanian errors —
 * an automation that can't produce text for anyone is the failure mode we most
 * want caught BEFORE it's queued.
 */
export function validateWaCampaign(input: {
  variants?: WaMessageVariant[];
  templateId?: string;
  conditions?: WaConditions;
  trigger?: 'manual' | 'dormant';
}): string[] {
  const errors: string[] = [];
  const variants = (input.variants || []).filter((v) => (v.body || '').trim());
  if (!variants.length && !input.templateId) {
    errors.push('Shto të paktën një tekst (variant) ose zgjidh një template.');
  }
  for (const v of variants) {
    if (v.landingUrl && !/^https?:\/\//i.test(v.landingUrl.trim())) {
      errors.push(`Linku i variantit "${v.label || v.tags.join(', ') || 'pa emër'}" duhet të fillojë me http(s)://`);
    }
  }
  const c = input.conditions || {};
  if (c.lastContactMinDays != null && c.lastContactMaxDays != null && c.lastContactMinDays > c.lastContactMaxDays) {
    errors.push('“Të pakontaktuar prej” duhet të jetë më i vogël se “por jo më vjetër se”.');
  }
  const numeric: [number | undefined, string][] = [
    [c.lastContactMinDays, 'Të pakontaktuar prej'],
    [c.lastContactMaxDays, 'Por jo më vjetër se'],
    [c.dailyCap, 'Limiti ditor'],
  ];
  for (const [v, label] of numeric) {
    if (v != null && (!Number.isFinite(v) || v < 0)) errors.push(`“${label}” duhet të jetë numër pozitiv.`);
  }
  if (input.trigger === 'dormant') {
    if (c.lastContactMinDays == null) {
      errors.push('Një automatizim i vazhdueshëm kërkon kushtin “Të pakontaktuar prej X ditësh”.');
    }
    if (!c.dailyCap) {
      errors.push('Vendos një limit ditor — pa të, automatizimi mund të dërgojë gjithë listën në një ekzekutim.');
    }
  }
  return errors;
}
