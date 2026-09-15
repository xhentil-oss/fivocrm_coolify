/**
 * Hosting & domains — the pure engine (no Firestore, no React, no imports).
 *
 * This is the ONE place that answers:
 *   • what a billing cycle is worth and when the next due date falls,
 *   • whether a subscription should be invoiced / suspended / terminated TODAY,
 *   • whether a domain should be invoiced / renewed / marked expired,
 *   • what a domain name is (sld + tld), what it costs, and whether it is valid,
 *   • which cPanel username an account gets.
 *
 * `api/_hostingEngine.ts` is a BYTE-IDENTICAL copy of this file (the test reads
 * both off disk and fails on any difference). "Keeping them in sync" means
 * copying the file — the cron (`api/_hostingJobs.ts`) only fetches facts and
 * executes actions; it never decides on its own whether something happens.
 *
 * Laws (same as the recurring-billing engines):
 *   • Every non-action is a NAMED reason, never a silent `continue`.
 *   • The idempotency token of a renewal invoice is its DUE DATE (day key),
 *     baked into a deterministic document id — never a timestamp.
 *   • Day math is UTC-day based; due dates are stored at 12:00 UTC so a DST
 *     shift in any zone can never move them across a midnight.
 */

// ── Billing cycles ─────────────────────────────────────────────────────────────

export type BillingCycle =
  | 'monthly'
  | 'quarterly'
  | 'semiannually'
  | 'annually'
  | 'biennially'
  | 'triennially';

export const BILLING_CYCLES: readonly BillingCycle[] = [
  'monthly',
  'quarterly',
  'semiannually',
  'annually',
  'biennially',
  'triennially',
] as const;

export const CYCLE_MONTHS: Record<BillingCycle, number> = {
  monthly: 1,
  quarterly: 3,
  semiannually: 6,
  annually: 12,
  biennially: 24,
  triennially: 36,
};

export const CYCLE_LABELS: Record<BillingCycle, string> = {
  monthly: 'Mujore',
  quarterly: '3-mujore',
  semiannually: '6-mujore',
  annually: 'Vjetore',
  biennially: '2-vjeçare',
  triennially: '3-vjeçare',
};

export function isBillingCycle(v: unknown): v is BillingCycle {
  return typeof v === 'string' && (BILLING_CYCLES as readonly string[]).includes(v);
}

/** WHMCS cycle names (the mirror) → ours. Unknown → null, never a default. */
export function cycleFromWhmcs(raw: string | undefined | null): BillingCycle | null {
  const s = String(raw || '').toLowerCase().replace(/[\s_-]/g, '');
  const map: Record<string, BillingCycle> = {
    monthly: 'monthly',
    quarterly: 'quarterly',
    semiannually: 'semiannually',
    semiannual: 'semiannually',
    annually: 'annually',
    annual: 'annually',
    yearly: 'annually',
    biennially: 'biennially',
    biennial: 'biennially',
    triennially: 'triennially',
    triennial: 'triennially',
  };
  return map[s] ?? null;
}

export const MS_PER_DAY = 86_400_000;

/** Midday UTC of the calendar day that contains `d` (in UTC). */
export function utcNoon(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12, 0, 0, 0));
}

/** `'2026-09-15'` for the UTC calendar day of `d`. */
export function dayKey(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Whole calendar days from `from` to `to` (UTC days); negative when `to` is in the past. */
export function daysBetween(from: Date, to: Date): number {
  const a = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const b = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  return Math.round((b - a) / MS_PER_DAY);
}

/**
 * Add `months` to `date`, clamped to the month's length, keeping the ANCHOR day
 * (the day the series started on). Never `setMonth(+1)`: the 31st overflows
 * into the month after next. Result is at 12:00 UTC.
 */
export function addMonthsClamped(date: Date, months: number, anchorDay?: number): Date {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + months;
  const anchor = anchorDay && anchorDay >= 1 && anchorDay <= 31 ? anchorDay : date.getUTCDate();
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(anchor, lastDay), 12, 0, 0, 0));
}

/** The due date that follows `due` for `cycle`. */
export function nextDueDate(due: Date, cycle: BillingCycle, anchorDay?: number): Date {
  return addMonthsClamped(due, CYCLE_MONTHS[cycle], anchorDay);
}

/** Domain terms are whole years; result at 12:00 UTC, clamped for 29 Feb. */
export function addYearsClamped(date: Date, years: number): Date {
  return addMonthsClamped(date, years * 12);
}

// ── Products & pricing ─────────────────────────────────────────────────────────

export type Currency = 'ALL' | 'EUR';

export interface CyclePrice {
  price: number;
  setupFee?: number;
}

export type ProductPricing = Partial<Record<BillingCycle, CyclePrice>>;

/** Cycles a product actually sells (price defined and ≥ 0), in canonical order. */
export function availableCycles(pricing: ProductPricing | undefined | null): BillingCycle[] {
  if (!pricing) return [];
  return BILLING_CYCLES.filter((c) => {
    const p = pricing[c];
    return !!p && typeof p.price === 'number' && Number.isFinite(p.price) && p.price >= 0;
  });
}

export function cyclePrice(pricing: ProductPricing | undefined | null, cycle: BillingCycle): CyclePrice | null {
  const p = pricing?.[cycle];
  if (!p || typeof p.price !== 'number' || !Number.isFinite(p.price) || p.price < 0) return null;
  return { price: round2(p.price), setupFee: p.setupFee ? round2(p.setupFee) : 0 };
}

/** Monthly-equivalent for "from X/month" labels and MRR. */
export function monthlyEquivalent(pricing: ProductPricing | undefined | null, cycle: BillingCycle): number | null {
  const p = cyclePrice(pricing, cycle);
  if (!p) return null;
  return round2(p.price / CYCLE_MONTHS[cycle]);
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// ── Domains ────────────────────────────────────────────────────────────────────

export interface DomainParts {
  /** Full lower-cased ASCII name, e.g. `shembull.com`. */
  name: string;
  /** Second-level label, e.g. `shembull`. */
  sld: string;
  /** TLD WITHOUT the dot, e.g. `com` or `co.uk`. */
  tld: string;
}

/** Multi-label public suffixes we sell; anything else is the last label. */
export const MULTI_LABEL_TLDS: readonly string[] = [
  'co.uk', 'org.uk', 'me.uk', 'com.au', 'net.au', 'org.au', 'co.nz', 'com.br',
  'com.mx', 'co.za', 'com.tr', 'co.in', 'com.al', 'net.al', 'org.al', 'edu.al',
  'gov.al', 'com.mk', 'org.mk', 'net.mk', 'co.il', 'com.ua', 'com.pl',
] as const;

const LABEL_RE = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

/**
 * Lower-case, strip protocol/path/whitespace/trailing dot, split into sld + tld.
 * Returns null when the result is not a registrable second-level name
 * (a bare TLD, a label with illegal characters, or a third level like
 * `www.shembull.com` — which we normalise by DROPPING `www.` only).
 */
export function parseDomain(input: string | undefined | null): DomainParts | null {
  if (!input) return null;
  let s = String(input).trim().toLowerCase();
  s = s.replace(/^[a-z]+:\/\//, '').split(/[/?#\s]/)[0] || '';
  s = s.replace(/\.+$/, '');
  if (s.startsWith('www.')) s = s.slice(4);
  if (!s || !s.includes('.')) return null;
  const labels = s.split('.');
  if (labels.some((l) => !LABEL_RE.test(l))) return null;
  let tld = labels[labels.length - 1];
  let rest = labels.slice(0, -1);
  if (labels.length >= 3) {
    const two = labels.slice(-2).join('.');
    if (MULTI_LABEL_TLDS.includes(two)) {
      tld = two;
      rest = labels.slice(0, -2);
    }
  }
  if (rest.length !== 1) return null;
  const sld = rest[0];
  if (sld.length < 1) return null;
  return { name: `${sld}.${tld}`, sld, tld };
}

export function normalizeTld(raw: string | undefined | null): string {
  return String(raw || '').trim().toLowerCase().replace(/^\.+/, '');
}

export type DomainPriceKind = 'register' | 'renew' | 'transfer';

export interface TldPricing {
  tld: string;
  currency: Currency;
  registerPrice: number;
  renewPrice: number;
  transferPrice?: number;
  minYears?: number;
  maxYears?: number;
  status?: 'Active' | 'Archived' | string;
}

export function findTld<T extends TldPricing>(tlds: readonly T[], tld: string): T | null {
  const key = normalizeTld(tld);
  return tlds.find((t) => normalizeTld(t.tld) === key) ?? null;
}

export function clampYears(t: Pick<TldPricing, 'minYears' | 'maxYears'> | null | undefined, years: number): number {
  const min = Math.max(1, Math.floor(t?.minYears ?? 1));
  const max = Math.max(min, Math.floor(t?.maxYears ?? 10));
  const y = Math.floor(Number.isFinite(years) ? years : min);
  return Math.min(max, Math.max(min, y));
}

/** Price for `years` of `kind` on `tld`; null when we do not sell that TLD. */
export function domainPrice(
  tlds: readonly TldPricing[],
  tld: string,
  years: number,
  kind: DomainPriceKind = 'register',
): { amount: number; currency: Currency; years: number } | null {
  const t = findTld(tlds, tld);
  if (!t || (t.status && t.status !== 'Active')) return null;
  const y = clampYears(t, years);
  const unit = kind === 'renew' ? t.renewPrice : kind === 'transfer' ? (t.transferPrice ?? t.registerPrice) : t.registerPrice;
  if (typeof unit !== 'number' || !Number.isFinite(unit) || unit < 0) return null;
  return { amount: round2(unit * y), currency: t.currency, years: y };
}

/**
 * Registrar → our margin. Suggested sell price from a wholesale cost:
 * cost × (1 + margin) rounded UP to .99 — the classic hosting price shape.
 */
export function suggestSellPrice(cost: number, marginPct: number): number {
  if (!Number.isFinite(cost) || cost <= 0) return 0;
  const raw = cost * (1 + Math.max(0, marginPct) / 100);
  return Math.max(0.99, Math.ceil(raw) - 0.01);
}

// ── cPanel username ────────────────────────────────────────────────────────────

export const CPANEL_USERNAME_MAX = 16;
const RESERVED_USERS = new Set([
  'root', 'admin', 'test', 'user', 'www', 'mail', 'ftp', 'cpanel', 'whm', 'mysql',
  'nobody', 'daemon', 'bin', 'sys', 'sync', 'games', 'lp', 'news', 'uucp', 'proxy',
  'backup', 'list', 'irc', 'gnats', 'apache', 'nginx', 'postgres', 'redis',
]);

/**
 * Derive a cPanel username from the domain: letters/digits only, starts with a
 * letter, ≤ 8 chars (short usernames avoid MySQL prefix truncation), unique
 * among `taken` (appends a counter, trimming the stem to make room).
 */
export function deriveCpanelUsername(domainName: string, taken: Iterable<string> = []): string {
  const parts = parseDomain(domainName);
  let stem = (parts?.sld ?? String(domainName)).toLowerCase().replace(/[^a-z0-9]/g, '');
  stem = stem.replace(/^[0-9]+/, '');
  if (stem.length < 3) stem = `${stem}web`.slice(0, 8);
  stem = stem.slice(0, 8);
  const used = new Set(Array.from(taken, (u) => String(u).toLowerCase()));
  const isFree = (u: string) => !used.has(u) && !RESERVED_USERS.has(u);
  if (isFree(stem)) return stem;
  for (let i = 1; i < 1000; i++) {
    const suffix = String(i);
    const candidate = `${stem.slice(0, Math.max(1, 8 - suffix.length))}${suffix}`;
    if (isFree(candidate)) return candidate;
  }
  return `${stem.slice(0, 4)}${Date.now().toString(36).slice(-4)}`;
}

/** A password cPanel accepts: 16 chars, upper/lower/digit/symbol guaranteed. Uses `random` (0..1). */
export function generateAccountPassword(random: () => number = Math.random, length = 16): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnpqrstuvwxyz';
  const digits = '23456789';
  const symbols = '!@#$%^*-_=+';
  const all = upper + lower + digits + symbols;
  const pick = (set: string) => set[Math.floor(random() * set.length)] ?? set[0];
  const chars = [pick(upper), pick(lower), pick(digits), pick(symbols)];
  while (chars.length < Math.max(12, length)) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

// ── Lifecycle ──────────────────────────────────────────────────────────────────

export type SubscriptionStatus = 'Pending' | 'Active' | 'Suspended' | 'Terminated' | 'Cancelled';
export type DomainStatus =
  | 'Pending'
  | 'Active'
  | 'Grace'
  | 'Expired'
  | 'Cancelled'
  | 'Transferred Away';

export interface LifecycleConfig {
  /** Days BEFORE the due date the renewal invoice is issued. */
  invoiceDaysBefore: number;
  /** Days AFTER an unpaid due date the account is suspended. */
  suspendDaysAfter: number;
  /** Days AFTER an unpaid due date the account is terminated (0 = never).
   *  Default 0: termination DELETES the customer's files, so it is opt-in per tenant,
   *  and the executor takes a `pkgacct` backup first and refuses to delete without one. */
  terminateDaysAfter: number;
  /** Days BEFORE expiry a domain renewal invoice is issued. */
  domainInvoiceDaysBefore: number;
  /** Days AFTER expiry we still let the customer renew at the normal price. */
  domainGraceDays: number;
}

export const DEFAULT_LIFECYCLE: LifecycleConfig = {
  invoiceDaysBefore: 14,
  suspendDaysAfter: 7,
  terminateDaysAfter: 0,
  domainInvoiceDaysBefore: 30,
  domainGraceDays: 30,
};

export function normalizeLifecycleConfig(raw: Partial<LifecycleConfig> | null | undefined): LifecycleConfig {
  const num = (v: unknown, d: number, min: number, max: number) => {
    const n = typeof v === 'number' ? v : Number(v);
    if (!Number.isFinite(n)) return d;
    return Math.min(max, Math.max(min, Math.floor(n)));
  };
  return {
    invoiceDaysBefore: num(raw?.invoiceDaysBefore, DEFAULT_LIFECYCLE.invoiceDaysBefore, 0, 90),
    suspendDaysAfter: num(raw?.suspendDaysAfter, DEFAULT_LIFECYCLE.suspendDaysAfter, 0, 365),
    terminateDaysAfter: num(raw?.terminateDaysAfter, DEFAULT_LIFECYCLE.terminateDaysAfter, 0, 730),
    domainInvoiceDaysBefore: num(raw?.domainInvoiceDaysBefore, DEFAULT_LIFECYCLE.domainInvoiceDaysBefore, 0, 90),
    domainGraceDays: num(raw?.domainGraceDays, DEFAULT_LIFECYCLE.domainGraceDays, 0, 90),
  };
}

/** Everything the engine needs to know about a subscription — never the Firestore doc itself. */
export interface SubscriptionFacts {
  id: string;
  status: SubscriptionStatus | string;
  /** `'fivocrm'` = we bill it. `'whmcs'` = mirrored, WHMCS bills it. */
  source?: string;
  billingCycle?: BillingCycle | string | null;
  nextDueDate: Date | null;
  recurringAmount: number;
  /** Day key of the due date the last renewal invoice was issued FOR. */
  lastInvoicedDueKey?: string | null;
  /** The renewal invoice for the CURRENT due date, when we know its state. */
  currentInvoice?: { status: string; paidAt?: Date | null } | null;
  /** Explicit stop: the customer asked to cancel at end of term. */
  cancelAtPeriodEnd?: boolean;
  /** Staff hold: never auto-suspend/terminate (e.g. a dispute). */
  lifecycleHold?: boolean;
  /** Set when provisioning has not finished — there is nothing to suspend yet. */
  provisionStatus?: 'pending' | 'provisioned' | 'failed' | string | null;
  suspendedAt?: Date | null;
}

export type SubscriptionAction =
  | 'issue-renewal-invoice'
  | 'suspend'
  | 'terminate'
  | 'cancel-at-period-end';

export type SubscriptionBlockReason =
  | 'not-ours'
  | 'terminal-status'
  | 'pending-provisioning'
  | 'no-due-date'
  | 'unsupported-cycle'
  | 'zero-amount'
  | 'lifecycle-hold'
  | 'not-yet-due-for-invoice'
  | 'already-invoiced'
  | 'invoice-paid'
  | 'within-grace'
  | 'already-suspended'
  | 'termination-disabled'
  | 'not-yet-terminate';

export interface SubscriptionDecision {
  action: SubscriptionAction | null;
  reason: SubscriptionBlockReason | null;
  /** How many days until (positive) or since (negative) the due date. */
  daysToDue: number | null;
}

export const SUBSCRIPTION_BLOCK_LABELS: Record<SubscriptionBlockReason, string> = {
  'not-ours': 'Faturohet nga WHMCS',
  'terminal-status': 'Status përfundimtar',
  'pending-provisioning': 'Në pritje të aktivizimit',
  'no-due-date': 'Pa datë afati',
  'unsupported-cycle': 'Cikël i papërkrahur',
  'zero-amount': 'Shumë 0',
  'lifecycle-hold': 'Në pritje (hold nga stafi)',
  'not-yet-due-for-invoice': 'Ende herët për faturë',
  'already-invoiced': 'Fatura e lëshuar',
  'invoice-paid': 'Fatura e paguar',
  'within-grace': 'Brenda periudhës së tolerancës',
  'already-suspended': 'Tashmë i pezulluar',
  'termination-disabled': 'Terminimi automatik i fikur',
  'not-yet-terminate': 'Ende herët për terminim',
};

const PAID_STATUSES = new Set(['Paid', 'paid']);

/**
 * What should happen to this subscription TODAY. Exactly one action or one
 * reason. Order of evaluation is the order of the checks below and is part of
 * the contract (the UI explains the same reason the cron logged).
 */
export function decideSubscription(
  s: SubscriptionFacts,
  now: Date,
  cfgIn: Partial<LifecycleConfig> | null | undefined = DEFAULT_LIFECYCLE,
): SubscriptionDecision {
  const cfg = normalizeLifecycleConfig(cfgIn);
  const none = (reason: SubscriptionBlockReason, daysToDue: number | null = null): SubscriptionDecision =>
    ({ action: null, reason, daysToDue });

  if (s.source && s.source !== 'fivocrm') return none('not-ours');
  if (s.status === 'Terminated' || s.status === 'Cancelled') return none('terminal-status');
  if (s.status === 'Pending' || (s.provisionStatus && s.provisionStatus !== 'provisioned')) {
    return none('pending-provisioning');
  }
  if (!s.nextDueDate || Number.isNaN(s.nextDueDate.getTime())) return none('no-due-date');
  if (!isBillingCycle(s.billingCycle)) return none('unsupported-cycle');
  const daysToDue = daysBetween(now, s.nextDueDate);
  if (s.lifecycleHold) return none('lifecycle-hold', daysToDue);

  const dueKey = dayKey(s.nextDueDate);
  const invoiced = s.lastInvoicedDueKey === dueKey;
  const paid = !!s.currentInvoice && PAID_STATUSES.has(s.currentInvoice.status);

  // 1. Renewal invoice, `invoiceDaysBefore` days ahead, once per due date.
  if (!invoiced) {
    if (s.cancelAtPeriodEnd) {
      // No invoice: the term simply ends. Terminate on the due date itself.
      return daysToDue <= 0
        ? { action: 'cancel-at-period-end', reason: null, daysToDue }
        : none('not-yet-due-for-invoice', daysToDue);
    }
    if (!(s.recurringAmount > 0)) return none('zero-amount', daysToDue);
    if (daysToDue > cfg.invoiceDaysBefore) return none('not-yet-due-for-invoice', daysToDue);
    return { action: 'issue-renewal-invoice', reason: null, daysToDue };
  }

  // 2. Invoiced. Paid → the renewal handler moves the due date; nothing to do here.
  if (paid) return none('invoice-paid', daysToDue);
  if (daysToDue > 0) return none('already-invoiced', daysToDue);
  const overdueDays = -daysToDue;

  // 3. Unpaid past due → suspend after the grace, terminate after the long grace.
  if (s.status !== 'Suspended') {
    if (overdueDays < cfg.suspendDaysAfter) return none('within-grace', daysToDue);
    return { action: 'suspend', reason: null, daysToDue };
  }
  if (cfg.terminateDaysAfter <= 0) return none('termination-disabled', daysToDue);
  if (overdueDays < cfg.terminateDaysAfter) return none('not-yet-terminate', daysToDue);
  return { action: 'terminate', reason: null, daysToDue };
}

/**
 * Deterministic invoice id for the renewal of `subscriptionId` due on `due`.
 * The database refuses a second document with the same id, so a died run or a
 * manual trigger racing the cron cannot bill the same period twice.
 */
export function renewalInvoiceId(kind: 'sub' | 'dom', entityId: string, due: Date): string {
  return `hst_${kind}_${entityId}_${dayKey(due)}`;
}

/** Patch to apply to a subscription once its renewal invoice for `due` is PAID. */
export function renewSubscriptionPatch(
  s: Pick<SubscriptionFacts, 'billingCycle' | 'nextDueDate'> & { anchorDay?: number | null },
  paidFor: Date,
): { nextDueDate: Date; status: 'Active'; suspendedAt: null; suspendReason: null } | null {
  if (!isBillingCycle(s.billingCycle)) return null;
  const base = utcNoon(paidFor);
  return {
    nextDueDate: nextDueDate(base, s.billingCycle, s.anchorDay ?? undefined),
    status: 'Active',
    suspendedAt: null,
    suspendReason: null,
  };
}

// ── Domain lifecycle ───────────────────────────────────────────────────────────

export interface DomainFacts {
  id: string;
  status: DomainStatus | string;
  source?: string;
  registrar?: string | null;
  expiryDate: Date | null;
  years?: number;
  recurringAmount: number;
  autoRenew?: boolean;
  lastInvoicedExpiryKey?: string | null;
  currentInvoice?: { status: string } | null;
  lifecycleHold?: boolean;
  /** `true` once the registrar confirmed the renewal for `currentInvoice`. */
  renewedAtRegistrarForKey?: string | null;
}

export type DomainAction = 'issue-renewal-invoice' | 'renew-at-registrar' | 'mark-grace' | 'mark-expired';

export type DomainBlockReason =
  | 'not-ours'
  | 'terminal-status'
  | 'pending-registration'
  | 'no-expiry'
  | 'zero-amount'
  | 'lifecycle-hold'
  | 'auto-renew-off'
  | 'not-yet-due-for-invoice'
  | 'already-invoiced'
  | 'already-renewed'
  | 'awaiting-payment'
  | 'within-grace-marked';

export interface DomainDecision {
  action: DomainAction | null;
  reason: DomainBlockReason | null;
  daysToExpiry: number | null;
}

export const DOMAIN_BLOCK_LABELS: Record<DomainBlockReason, string> = {
  'not-ours': 'Menaxhohet nga WHMCS',
  'terminal-status': 'Status përfundimtar',
  'pending-registration': 'Në pritje të regjistrimit',
  'no-expiry': 'Pa datë skadence',
  'zero-amount': 'Shumë 0',
  'lifecycle-hold': 'Në pritje (hold nga stafi)',
  'auto-renew-off': 'Rinovimi automatik i fikur',
  'not-yet-due-for-invoice': 'Ende herët për faturë',
  'already-invoiced': 'Fatura e lëshuar',
  'already-renewed': 'I rinovuar te regjistruesi',
  'awaiting-payment': 'Në pritje të pagesës',
  'within-grace-marked': 'Në periudhë tolerance',
};

export function decideDomain(
  d: DomainFacts,
  now: Date,
  cfgIn: Partial<LifecycleConfig> | null | undefined = DEFAULT_LIFECYCLE,
): DomainDecision {
  const cfg = normalizeLifecycleConfig(cfgIn);
  const none = (reason: DomainBlockReason, daysToExpiry: number | null = null): DomainDecision =>
    ({ action: null, reason, daysToExpiry });

  if (d.source && d.source !== 'fivocrm') return none('not-ours');
  if (d.status === 'Cancelled' || d.status === 'Transferred Away' || d.status === 'Expired') {
    return none('terminal-status');
  }
  if (d.status === 'Pending') return none('pending-registration');
  if (!d.expiryDate || Number.isNaN(d.expiryDate.getTime())) return none('no-expiry');
  const daysToExpiry = daysBetween(now, d.expiryDate);
  if (d.lifecycleHold) return none('lifecycle-hold', daysToExpiry);

  const expiryKey = dayKey(d.expiryDate);
  const invoiced = d.lastInvoicedExpiryKey === expiryKey;
  const paid = !!d.currentInvoice && PAID_STATUSES.has(d.currentInvoice.status);

  if (paid) {
    if (d.renewedAtRegistrarForKey === expiryKey) return none('already-renewed', daysToExpiry);
    return { action: 'renew-at-registrar', reason: null, daysToExpiry };
  }

  if (!invoiced) {
    if (d.autoRenew === false) {
      // Customer chose to let it lapse: only the status bookkeeping happens.
      if (daysToExpiry > 0) return none('auto-renew-off', daysToExpiry);
      return -daysToExpiry >= cfg.domainGraceDays
        ? { action: 'mark-expired', reason: null, daysToExpiry }
        : d.status === 'Grace'
          ? none('within-grace-marked', daysToExpiry)
          : { action: 'mark-grace', reason: null, daysToExpiry };
    }
    if (!(d.recurringAmount > 0)) return none('zero-amount', daysToExpiry);
    if (daysToExpiry > cfg.domainInvoiceDaysBefore) return none('not-yet-due-for-invoice', daysToExpiry);
    return { action: 'issue-renewal-invoice', reason: null, daysToExpiry };
  }

  // Invoiced, unpaid.
  if (daysToExpiry > 0) return none('already-invoiced', daysToExpiry);
  const overdue = -daysToExpiry;
  if (overdue >= cfg.domainGraceDays) return { action: 'mark-expired', reason: null, daysToExpiry };
  if (d.status === 'Grace') return none('awaiting-payment', daysToExpiry);
  return { action: 'mark-grace', reason: null, daysToExpiry };
}

// ── Orders ─────────────────────────────────────────────────────────────────────

export interface OrderLineInput {
  kind: 'hosting' | 'domain-register' | 'domain-transfer';
  /** hosting: product id; domain: ignored */
  productId?: string;
  productName?: string;
  cycle?: BillingCycle;
  pricing?: ProductPricing | null;
  /** hosting: the primary domain of the account; domain: the name to register */
  domainName?: string;
  years?: number;
  /** transfer: EPP / auth code */
  authCode?: string;
  /** hosting: TLDs (no dot) the package gives away for the FIRST year… */
  freeDomainTlds?: string[] | null;
  /** …when bought on at least this cycle (default annually). */
  freeDomainMinCycle?: BillingCycle | null;
}

export interface OrderLine {
  kind: OrderLineInput['kind'];
  description: string;
  productId?: string;
  productName?: string;
  cycle?: BillingCycle;
  domainName?: string;
  years?: number;
  unitPrice: number;
  setupFee: number;
  /** Promotions (free first-year domain, coupon) — already subtracted from `total`. */
  discount?: number;
  discountReason?: string;
  total: number;
  currency: Currency;
  authCode?: string;
}

export type OrderValidationError =
  | 'empty'
  | 'mixed-currency'
  | 'hosting-without-product'
  | 'hosting-without-cycle'
  | 'hosting-cycle-not-sold'
  | 'hosting-without-domain'
  | 'invalid-domain'
  | 'tld-not-sold'
  | 'duplicate-domain'
  | 'domain-zero-price'
  | 'transfer-without-auth-code';

export interface PricedOrder {
  lines: OrderLine[];
  /** Sum of line totals BEFORE promotions. */
  subtotal: number;
  /** Free-domain + coupon discounts, total. */
  discountTotal: number;
  couponCode?: string;
  couponDiscount?: number;
  total: number;
  currency: Currency;
}

export function priceOrder(
  inputs: readonly OrderLineInput[],
  tlds: readonly TldPricing[],
  fallbackCurrency: Currency = 'EUR',
): { ok: true; order: PricedOrder } | { ok: false; error: OrderValidationError; index?: number } {
  if (!inputs.length) return { ok: false, error: 'empty' };
  const lines: OrderLine[] = [];
  const seenDomains = new Set<string>();
  const freeDomainRules: Array<{ tlds: string[]; minCycle: BillingCycle; cycle: BillingCycle }> = [];
  for (let i = 0; i < inputs.length; i++) {
    const inp = inputs[i];
    if (inp.kind === 'hosting') {
      if (!inp.productId) return { ok: false, error: 'hosting-without-product', index: i };
      if (!inp.cycle || !isBillingCycle(inp.cycle)) return { ok: false, error: 'hosting-without-cycle', index: i };
      const p = cyclePrice(inp.pricing, inp.cycle);
      if (!p) return { ok: false, error: 'hosting-cycle-not-sold', index: i };
      const dom = parseDomain(inp.domainName);
      if (!inp.domainName) return { ok: false, error: 'hosting-without-domain', index: i };
      if (!dom) return { ok: false, error: 'invalid-domain', index: i };
      const currency = (inp.pricing && (inp.pricing as any).currency) || fallbackCurrency;
      lines.push({
        kind: 'hosting',
        description: `${inp.productName || 'Hosting'} — ${dom.name} (${CYCLE_LABELS[inp.cycle]})`,
        productId: inp.productId,
        productName: inp.productName,
        cycle: inp.cycle,
        domainName: dom.name,
        unitPrice: p.price,
        setupFee: p.setupFee ?? 0,
        total: round2(p.price + (p.setupFee ?? 0)),
        currency,
      });
      freeDomainRules.push({ tlds: (inp.freeDomainTlds || []).map(normalizeTld).filter(Boolean), minCycle: inp.freeDomainMinCycle || 'annually', cycle: inp.cycle });
    } else {
      const dom = parseDomain(inp.domainName);
      if (!dom) return { ok: false, error: 'invalid-domain', index: i };
      if (seenDomains.has(dom.name)) return { ok: false, error: 'duplicate-domain', index: i };
      seenDomains.add(dom.name);
      const kind = inp.kind === 'domain-transfer' ? 'transfer' : 'register';
      if (kind === 'transfer' && !inp.authCode?.trim()) return { ok: false, error: 'transfer-without-auth-code', index: i };
      const priced = domainPrice(tlds, dom.tld, inp.years ?? 1, kind);
      if (!priced) return { ok: false, error: 'tld-not-sold', index: i };
      // A registration costs US money at the registrar: a 0 sell price is always a
      // misconfiguration (a TLD saved without a price), never a legitimate free domain.
      if (!(priced.amount > 0)) return { ok: false, error: 'domain-zero-price', index: i };
      lines.push({
        kind: inp.kind,
        description: `${kind === 'transfer' ? 'Transferim domain' : 'Regjistrim domain'} ${dom.name} (${priced.years} ${priced.years === 1 ? 'vit' : 'vjet'})`,
        domainName: dom.name,
        years: priced.years,
        unitPrice: priced.amount,
        setupFee: 0,
        total: priced.amount,
        currency: priced.currency,
        authCode: kind === 'transfer' ? inp.authCode?.trim() : undefined,
      });
    }
  }
  const currency = lines[0].currency;
  if (lines.some((l) => l.currency !== currency)) return { ok: false, error: 'mixed-currency' };
  const subtotal = round2(lines.reduce((s, l) => s + l.total, 0));

  // Promotion: "domain falas me hosting vjetor". ONE domain-register line, first
  // year only, when a hosting line in the same order carries a rule whose TLD list
  // contains it and whose cycle is long enough. Renewals bill the normal price.
  for (const rule of freeDomainRules) {
    if (!rule.tlds.length || CYCLE_MONTHS[rule.cycle] < CYCLE_MONTHS[rule.minCycle]) continue;
    const target = lines.find((l) => l.kind === 'domain-register' && !l.discount && rule.tlds.includes(parseDomain(l.domainName)?.tld || ''));
    if (!target) continue;
    const firstYear = round2(target.unitPrice / Math.max(1, target.years || 1));
    target.discount = firstYear;
    target.discountReason = 'free-domain';
    target.total = round2(target.total - firstYear);
    break;
  }
  const discountTotal = round2(lines.reduce((s, l) => s + (l.discount || 0), 0));
  const total = round2(lines.reduce((s, l) => s + l.total, 0));
  return { ok: true, order: { lines, subtotal, discountTotal, total, currency } };
}

// ── Coupons ────────────────────────────────────────────────────────────────────

export interface CouponFacts {
  code: string;
  type: 'percent' | 'fixed';
  value: number;
  currency?: Currency | null;
  /** Which lines it discounts. */
  appliesTo: 'all' | 'hosting' | 'domains';
  status?: 'Active' | 'Archived' | string;
  validFrom?: Date | null;
  validUntil?: Date | null;
  maxUses?: number | null;
  uses?: number;
  minTotal?: number | null;
}

export type CouponError =
  | 'coupon-not-found'
  | 'coupon-inactive'
  | 'coupon-not-started'
  | 'coupon-expired'
  | 'coupon-exhausted'
  | 'coupon-min-total'
  | 'coupon-currency'
  | 'coupon-not-applicable';

export const COUPON_ERROR_LABELS: Record<CouponError, string> = {
  'coupon-not-found': 'Kuponi nuk ekziston',
  'coupon-inactive': 'Kuponi nuk është aktiv',
  'coupon-not-started': 'Kuponi nuk ka filluar ende',
  'coupon-expired': 'Kuponi ka skaduar',
  'coupon-exhausted': 'Kuponi është përdorur maksimalisht',
  'coupon-min-total': 'Porosia nuk arrin minimumin e kuponit',
  'coupon-currency': 'Kuponi është në monedhë tjetër',
  'coupon-not-applicable': 'Kuponi nuk vlen për këta artikuj',
};

export function normalizeCouponCode(raw: string | undefined | null): string {
  return String(raw || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 32);
}

/** Apply a coupon to a priced order. Percent/fixed over eligible lines, first invoice only. */
export function applyCoupon(order: PricedOrder, coupon: CouponFacts | null | undefined, now: Date): { ok: true; order: PricedOrder } | { ok: false; error: CouponError } {
  if (!coupon) return { ok: false, error: 'coupon-not-found' };
  if (coupon.status && coupon.status !== 'Active') return { ok: false, error: 'coupon-inactive' };
  if (coupon.validFrom && now < coupon.validFrom) return { ok: false, error: 'coupon-not-started' };
  if (coupon.validUntil && now > coupon.validUntil) return { ok: false, error: 'coupon-expired' };
  if (coupon.maxUses != null && coupon.maxUses > 0 && (coupon.uses || 0) >= coupon.maxUses) return { ok: false, error: 'coupon-exhausted' };
  if (coupon.type === 'fixed' && coupon.currency && coupon.currency !== order.currency) return { ok: false, error: 'coupon-currency' };
  if (coupon.minTotal != null && order.total < coupon.minTotal) return { ok: false, error: 'coupon-min-total' };
  const eligible = order.lines.filter((l) =>
    coupon.appliesTo === 'all' || (coupon.appliesTo === 'hosting' ? l.kind === 'hosting' : l.kind !== 'hosting'));
  const base = round2(eligible.reduce((s, l) => s + l.total, 0));
  if (!eligible.length || base <= 0) return { ok: false, error: 'coupon-not-applicable' };
  const raw = coupon.type === 'percent' ? base * Math.min(100, Math.max(0, coupon.value)) / 100 : Math.max(0, coupon.value);
  const discount = round2(Math.min(base, raw));
  if (discount <= 0) return { ok: false, error: 'coupon-not-applicable' };
  // Spread proportionally so each line's total stays honest (invoice items mirror them).
  let left = discount;
  const lines = order.lines.map((l, i) => {
    if (!eligible.includes(l)) return l;
    const isLast = eligible[eligible.length - 1] === l;
    const share = isLast ? left : round2(discount * (l.total / base));
    left = round2(left - share);
    void i;
    return { ...l, discount: round2((l.discount || 0) + share), discountReason: l.discountReason ? `${l.discountReason}+coupon` : 'coupon', total: round2(l.total - share) };
  });
  return {
    ok: true,
    order: {
      ...order, lines, couponCode: normalizeCouponCode(coupon.code), couponDiscount: discount,
      discountTotal: round2(order.discountTotal + discount), total: round2(order.total - discount),
    },
  };
}

// ── Proration (package upgrade mid-period) ─────────────────────────────────────

export interface ProrationInput {
  oldPrice: number;
  newPrice: number;
  cycle: BillingCycle;
  nextDueDate: Date;
  now: Date;
}

export interface ProrationQuote {
  daysRemaining: number;
  daysInPeriod: number;
  fraction: number;
  /** Positive = the customer owes this now; ≤ 0 = downgrade, nothing to bill. */
  amount: number;
}

/**
 * Charge the price DIFFERENCE for the days left in the current period. The period
 * is reconstructed from the due date minus one cycle. Never negative-bills: a
 * downgrade applies from the next invoice and refunds nothing (WHMCS default).
 */
export function prorationQuote(inp: ProrationInput): ProrationQuote {
  const due = utcNoon(inp.nextDueDate);
  const periodStart = addMonthsClamped(due, -CYCLE_MONTHS[inp.cycle]);
  const daysInPeriod = Math.max(1, daysBetween(periodStart, due));
  const daysRemaining = Math.min(daysInPeriod, Math.max(0, daysBetween(inp.now, due)));
  const fraction = daysRemaining / daysInPeriod;
  const diff = (inp.newPrice || 0) - (inp.oldPrice || 0);
  const amount = diff > 0 ? round2(diff * fraction) : 0;
  return { daysRemaining, daysInPeriod, fraction: Math.round(fraction * 10000) / 10000, amount };
}

// ── Provisioning retry (exponential backoff) ───────────────────────────────────

export const PROVISION_RETRY_DELAYS_MS: readonly number[] = [15 * 60_000, 60 * 60_000, 4 * 3_600_000, 12 * 3_600_000, 24 * 3_600_000];

/** Delay before retry number `attempt` (1-based); null = give up, a human must act. */
export function nextRetryDelayMs(attempt: number): number | null {
  if (!Number.isFinite(attempt) || attempt < 1) return PROVISION_RETRY_DELAYS_MS[0];
  return attempt > PROVISION_RETRY_DELAYS_MS.length ? null : PROVISION_RETRY_DELAYS_MS[attempt - 1];
}

// ── Usage alarms ───────────────────────────────────────────────────────────────

export type UsageAlertLevel = 'warning' | 'critical' | null;

/** ≥ 90 % of the quota = warning, ≥ 97 % = critical; unlimited or unknown = none. */
export function usageAlertLevel(usedMb: number | null | undefined, limitMb: number | null | undefined): UsageAlertLevel {
  if (!usedMb || !limitMb || limitMb <= 0) return null;
  const pct = usedMb / limitMb;
  if (pct >= 0.97) return 'critical';
  if (pct >= 0.9) return 'warning';
  return null;
}

// ── Expiry report (weekly digest) ──────────────────────────────────────────────

export interface ExpiryReportRow {
  id: string;
  name: string;
  customerId?: string | null;
  date: Date;
  daysLeft: number;
  amount: number;
  currency?: string | null;
}

export interface ExpiryReport {
  domainsWithin30: ExpiryReportRow[];
  domainsWithin60: ExpiryReportRow[];
  subscriptionsDueWithin30: ExpiryReportRow[];
  unpaidRenewals: ExpiryReportRow[];
  suspended: ExpiryReportRow[];
  total: number;
}

export function buildExpiryReport(
  subs: ReadonlyArray<{ id: string; source?: string; status: string; domain?: string | null; productName?: string; customerId?: string | null; nextDueDate: Date | null; recurringAmount?: number; currency?: string | null; currentInvoiceId?: string | null }>,
  domains: ReadonlyArray<{ id: string; source?: string; status: string; domainName: string; customerId?: string | null; expiryDate: Date | null; recurringAmount?: number; currency?: string | null }>,
  now: Date,
): ExpiryReport {
  const r: ExpiryReport = { domainsWithin30: [], domainsWithin60: [], subscriptionsDueWithin30: [], unpaidRenewals: [], suspended: [], total: 0 };
  for (const d of domains) {
    if (d.source && d.source !== 'fivocrm') continue;
    if (!d.expiryDate || ['Expired', 'Cancelled', 'Transferred Away'].includes(d.status)) continue;
    const daysLeft = daysBetween(now, d.expiryDate);
    const row: ExpiryReportRow = { id: d.id, name: d.domainName, customerId: d.customerId ?? null, date: d.expiryDate, daysLeft, amount: d.recurringAmount || 0, currency: d.currency ?? null };
    if (daysLeft <= 30) r.domainsWithin30.push(row);
    else if (daysLeft <= 60) r.domainsWithin60.push(row);
  }
  for (const s of subs) {
    if (s.source && s.source !== 'fivocrm') continue;
    if (['Terminated', 'Cancelled', 'Pending'].includes(s.status)) continue;
    const name = s.domain || s.productName || s.id;
    if (s.status === 'Suspended') {
      r.suspended.push({ id: s.id, name, customerId: s.customerId ?? null, date: s.nextDueDate || now, daysLeft: s.nextDueDate ? daysBetween(now, s.nextDueDate) : 0, amount: s.recurringAmount || 0, currency: s.currency ?? null });
    }
    if (!s.nextDueDate) continue;
    const daysLeft = daysBetween(now, s.nextDueDate);
    const row: ExpiryReportRow = { id: s.id, name, customerId: s.customerId ?? null, date: s.nextDueDate, daysLeft, amount: s.recurringAmount || 0, currency: s.currency ?? null };
    if (s.currentInvoiceId && daysLeft < 0) r.unpaidRenewals.push(row);
    else if (daysLeft >= 0 && daysLeft <= 30) r.subscriptionsDueWithin30.push(row);
  }
  const byDays = (a: ExpiryReportRow, b: ExpiryReportRow) => a.daysLeft - b.daysLeft;
  r.domainsWithin30.sort(byDays); r.domainsWithin60.sort(byDays); r.subscriptionsDueWithin30.sort(byDays); r.unpaidRenewals.sort(byDays);
  r.total = r.domainsWithin30.length + r.domainsWithin60.length + r.subscriptionsDueWithin30.length + r.unpaidRenewals.length + r.suspended.length;
  return r;
}

export const ORDER_ERROR_LABELS: Record<OrderValidationError, string> = {
  empty: 'Porosia është bosh',
  'mixed-currency': 'Të gjitha rreshtat duhet të kenë të njëjtën monedhë',
  'hosting-without-product': 'Zgjidh një paketë hosting',
  'hosting-without-cycle': 'Zgjidh ciklin e faturimit',
  'hosting-cycle-not-sold': 'Kjo paketë nuk shitet me këtë cikël',
  'hosting-without-domain': 'Shkruaj domain-in kryesor të llogarisë',
  'invalid-domain': 'Emër domain-i i pavlefshëm',
  'tld-not-sold': 'Këtë prapashtesë (TLD) nuk e shesim',
  'duplicate-domain': 'I njëjti domain dy herë në porosi',
  'domain-zero-price': 'Kjo prapashtesë (TLD) nuk ka çmim të vendosur — nuk mund të shitet me 0',
  'transfer-without-auth-code': 'Transferimi kërkon kodin EPP/Auth',
};

// ── WHM account status mapping ─────────────────────────────────────────────────

/** WHM `listaccts` row → our status. */
export function statusFromWhmAccount(acct: { suspended?: number | boolean | string } | null | undefined): SubscriptionStatus {
  if (!acct) return 'Terminated';
  const s = acct.suspended;
  const suspended = s === true || s === 1 || s === '1';
  return suspended ? 'Suspended' : 'Active';
}

/** Dynadot `domain_info` status/expiry → ours. */
export function statusFromRegistrar(expiry: Date | null, now: Date, graceDays: number): DomainStatus {
  if (!expiry) return 'Active';
  const days = daysBetween(now, expiry);
  if (days >= 0) return 'Active';
  return -days < graceDays ? 'Grace' : 'Expired';
}
