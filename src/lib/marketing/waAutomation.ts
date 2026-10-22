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

//
// The pure gate, phone rule, variants, rendering, quiet hours and failure
// ledger live in `waAutomationCore.ts` (import-free; the cron runs its
// byte-identical copy `api/_waAutomationCore.ts`). This module re-exports them
// and adds the browser-side segment evaluation + builder validation.

export * from './waAutomationCore';
import {
  buildCategoryIndex, contactPhone, pickVariant, renderWaMessage, variantServiceLabel,
  waSendBlockReason, withUtm,
  type WaBlockReason, type WaConditions, type WaContact, type WaMessageVariant, type WaSegment,
  type WaFailedPhone,
} from './waAutomationCore';

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
  /** One-shot campaigns: per-phone failure ledger, so the preview counts what the cron will skip. */
  failedPhones?: Map<string, WaFailedPhone>;
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
    lastMessageByPhone, sentPhones, domainCustomerIds, failedPhones,
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
      now, lastMessageByPhone, sentPhones, domainCustomerIds, kind, categoryByContactId, failedPhones,
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
