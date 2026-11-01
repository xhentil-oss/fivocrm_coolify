// ── WhatsApp reminders for unpaid invoices — ONE engine for UI + cron ────────
//
// Sent by the `overdue-reminders` cron (api/cron/run.ts) every ~2 hours; edited
// in Cilësimet → Automatizime → "Kujtesa faturash në WhatsApp"
// (FollowUpSettingsPanel). Covers FivoCRM's own invoices AND the ones mirrored
// from WHMCS (`source: 'whmcs'`) — WHMCS only ever emails, so this is how a
// hosting client gets a WhatsApp nudge.
//
// Three stages, each with its own idempotency stamp on the invoice:
//   pre-due  → `preDueWaSentAt`   ("skadon për N ditë", once — or, for a WHMCS
//                                  invoice, the CADENCE below, counted in
//                                  `preDueWaCount`)
//   due      → `dueWaSentAt`      ("skadon sot", once)
//   overdue  → `overdueWaSentAt`  (after `overdueDays` late, repeated every
//                                  `renotifyDays`, at most `overdueMaxSends`
//                                  times — counted in `overdueWaCount`)
//
// EMAIL FIRST: the overdue stage waits for the overdue EMAIL (`overdueEmailSentAt`,
// written by the same cron, day ~1 late) whenever an email CAN go out
// (`emailChannelAvailable`, decided by the cron with the exact conditions its
// email part sends under). No address / WHMCS mails it itself / email off →
// WhatsApp goes anyway. Facts come from the doc snapshot BEFORE the tick, so the
// WhatsApp leg always lands on a later tick than the email, never alongside it.
// An email that FAILED (SMTP down, `overdueEmailFailedAt` newer than the last
// success) does not count as "can go out": the email gate must never hold the
// WhatsApp leg hostage to a broken mail server.
//
// WHMCS CADENCE (`whmcsCadence`, on by default): a WHMCS invoice is chased
// BEFORE its due date on a rhythm, not once — from `whmcsWindowDays` (20) days
// ahead every `whmcsEveryDays` (5), and from `whmcsUrgentDays` (10) days ahead
// every `whmcsUrgentEveryDays` (2); the due day itself always gets "skadon sot"
// once. Intervals are CALENDAR days in Europe/Tirane, never 24h blocks: the job
// ticks every ~2h inside a send window, so a 5×24h gap would slip a day every
// time the first send landed later in the window than the next tick.
// FivoCRM's own invoices keep the once-only `preDueDays` stage.
//
// Every non-send is a NAMED reason (never a silent `continue`), counted into
// `teamSettings.waInvoiceLastRun.blocked` so the panel can show "38 shqyrtuar →
// 5 dërguar, 20 jashtë orarit, 9 pa telefon".
//
// Pure — no Firebase, no React, no imports. `api/_invoiceWaReminders.ts` is a
// BYTE-IDENTICAL copy (api/ never imports from src/); `invoiceWaReminders.test.ts`
// reads both files and fails on any difference, so "keeping them in sync" means
// copying the file.

export const INVOICE_WA_DAY_MS = 86_400_000;
export const INVOICE_WA_DEFAULT_TZ = 'Europe/Tirane';

export type InvoiceWaSource = 'all' | 'whmcs' | 'fivocrm';
export type InvoiceWaChannel = 'meta' | 'baileys';
export type InvoiceWaStage = 'pre-due' | 'due' | 'overdue';

export interface InvoiceWaConfig {
  enabled: boolean;
  sources: InvoiceWaSource;
  channel: InvoiceWaChannel;
  /** Baileys agent id (whatsappAccounts); '' = the VPS picks a connected one. */
  agentId: string;
  /** Free-text body (Baileys). Tokens: see renderInvoiceWaText. */
  text: string;
  /** Meta: approved template + channel. */
  templateId: string;
  channelPhoneNumberId: string;
  /** 0 = stage off. */
  preDueDays: number;
  onDue: boolean;
  overdueDays: number;
  renotifyDays: number;
  /** Overdue-stage sends per invoice, then staff take over. */
  overdueMaxSends: number;
  /** Local send window [hourStart, hourEnd) in Europe/Tirane. */
  hourStart: number;
  hourEnd: number;
  /** Skip FivoCRM's weekly overdue EMAIL for WHMCS invoices (WHMCS mails them itself). */
  emailSkipWhmcs: boolean;
  /** WHMCS invoices: repeated pre-due reminders instead of the once-only `preDueDays`. */
  whmcsCadence: boolean;
  /** Start the cadence this many days before the due date. */
  whmcsWindowDays: number;
  /** …and repeat every N calendar days… */
  whmcsEveryDays: number;
  /** …until this many days are left (inclusive)… */
  whmcsUrgentDays: number;
  /** …from where it repeats every N calendar days. */
  whmcsUrgentEveryDays: number;
}

export const INVOICE_WA_DEFAULTS: Readonly<InvoiceWaConfig> = Object.freeze({
  enabled: false,
  sources: 'all',
  channel: 'meta',
  agentId: '',
  text: '',
  templateId: '',
  channelPhoneNumberId: '',
  preDueDays: 0,
  onDue: false,
  overdueDays: 4,
  renotifyDays: 7,
  overdueMaxSends: 3,
  hourStart: 9,
  hourEnd: 19,
  emailSkipWhmcs: false,
  whmcsCadence: true,
  whmcsWindowDays: 20,
  whmcsEveryDays: 5,
  whmcsUrgentDays: 10,
  whmcsUrgentEveryDays: 2,
});

export const INVOICE_WA_LIMITS = Object.freeze({
  preDueDays: { min: 0, max: 30 },
  overdueDays: { min: 1, max: 365 },
  renotifyDays: { min: 1, max: 90 },
  overdueMaxSends: { min: 1, max: 10 },
  hour: { min: 0, max: 23 },
  // The cron reads open invoices up to 30 days ahead (MAX_PRE_DUE_DAYS) — keep the window inside it.
  whmcsWindowDays: { min: 1, max: 30 },
  whmcsEveryDays: { min: 1, max: 30 },
  whmcsUrgentDays: { min: 0, max: 30 },
  whmcsUrgentEveryDays: { min: 1, max: 30 },
});

export const DEFAULT_INVOICE_WA_TEXT =
  'Përshëndetje {{firstName}}, fatura {{invoiceNumber}} ({{amount}} {{currency}}) {{dueText}}.\n'
  + 'Mund ta paguani këtu: {{link}}\n'
  + 'Faleminderit, {{company}}';

/** Finite integer inside [min, max], or null. Strings are accepted (forms round-trip through them). */
function intInRange(raw: unknown, min: number, max: number): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isFinite(n)) return null;
  const i = Math.round(n);
  if (i !== n || i < min || i > max) return null;
  return i;
}

/** Read the config off a `teamSettings` document; every invalid value falls back INDIVIDUALLY. */
export function resolveInvoiceWaConfig(settings: Record<string, any> | null | undefined): InvoiceWaConfig {
  const s = settings || {};
  const d = INVOICE_WA_DEFAULTS;
  const sources: InvoiceWaSource = s.waInvoiceSources === 'whmcs' || s.waInvoiceSources === 'fivocrm' ? s.waInvoiceSources : d.sources;
  const channel: InvoiceWaChannel = s.waInvoiceChannel === 'baileys' ? 'baileys' : d.channel;
  const hourStart = intInRange(s.waInvoiceHourStart, INVOICE_WA_LIMITS.hour.min, INVOICE_WA_LIMITS.hour.max) ?? d.hourStart;
  let hourEnd = intInRange(s.waInvoiceHourEnd, INVOICE_WA_LIMITS.hour.min, INVOICE_WA_LIMITS.hour.max + 1) ?? d.hourEnd;
  if (hourEnd <= hourStart) hourEnd = Math.min(24, hourStart + 1); // a zero-width window would silently send nothing
  const L = INVOICE_WA_LIMITS;
  const whmcsWindowDays = intInRange(s.waWhmcsWindowDays, L.whmcsWindowDays.min, L.whmcsWindowDays.max) ?? d.whmcsWindowDays;
  // The urgent band lives INSIDE the window; a bigger value would make the slow rhythm unreachable.
  const whmcsUrgentDays = Math.min(whmcsWindowDays, intInRange(s.waWhmcsUrgentDays, L.whmcsUrgentDays.min, L.whmcsUrgentDays.max) ?? d.whmcsUrgentDays);
  return {
    enabled: s.waOverdueEnabled === true,
    sources,
    channel,
    agentId: typeof s.waInvoiceAgentId === 'string' ? s.waInvoiceAgentId.trim() : d.agentId,
    text: typeof s.waInvoiceText === 'string' ? s.waInvoiceText : d.text,
    templateId: typeof s.waOverdueTemplateId === 'string' ? s.waOverdueTemplateId : d.templateId,
    channelPhoneNumberId: typeof s.waOverdueChannelPhoneNumberId === 'string' ? s.waOverdueChannelPhoneNumberId : d.channelPhoneNumberId,
    preDueDays: intInRange(s.waInvoicePreDueDays, INVOICE_WA_LIMITS.preDueDays.min, INVOICE_WA_LIMITS.preDueDays.max) ?? d.preDueDays,
    onDue: s.waInvoiceOnDue === true,
    overdueDays: intInRange(s.waOverdueDays, INVOICE_WA_LIMITS.overdueDays.min, INVOICE_WA_LIMITS.overdueDays.max) ?? d.overdueDays,
    renotifyDays: intInRange(s.waInvoiceRenotifyDays, INVOICE_WA_LIMITS.renotifyDays.min, INVOICE_WA_LIMITS.renotifyDays.max) ?? d.renotifyDays,
    overdueMaxSends: intInRange(s.waOverdueMaxSends, INVOICE_WA_LIMITS.overdueMaxSends.min, INVOICE_WA_LIMITS.overdueMaxSends.max) ?? d.overdueMaxSends,
    hourStart,
    hourEnd,
    emailSkipWhmcs: s.overdueEmailSkipWhmcs === true,
    whmcsCadence: s.waWhmcsCadenceEnabled !== false,
    whmcsWindowDays,
    whmcsEveryDays: intInRange(s.waWhmcsEveryDays, L.whmcsEveryDays.min, L.whmcsEveryDays.max) ?? d.whmcsEveryDays,
    whmcsUrgentDays,
    whmcsUrgentEveryDays: intInRange(s.waWhmcsUrgentEveryDays, L.whmcsUrgentEveryDays.min, L.whmcsUrgentEveryDays.max) ?? d.whmcsUrgentEveryDays,
  };
}

// ── Zone-aware day math (never setHours(0,0,0,0) — see recurring-utils law) ──
function zonedParts(ms: number, timeZone: string): { y: number; m: number; d: number; h: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit',
  });
  const parts = fmt.formatToParts(new Date(ms));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value || 0);
  return { y: get('year'), m: get('month'), d: get('day'), h: get('hour') % 24 };
}

/** Wall-clock hour (0–23) in the given zone. */
export function localHourIn(timeZone: string, ms: number): number {
  return zonedParts(ms, timeZone).h;
}

/** Calendar-day index (days since epoch) of `ms` as seen in the zone. */
export function zonedDayIndex(ms: number, timeZone: string): number {
  const { y, m, d } = zonedParts(ms, timeZone);
  return Math.floor(Date.UTC(y, m - 1, d) / INVOICE_WA_DAY_MS);
}

/** Whole calendar days `now` is past the due date (negative = still ahead). */
export function daysLateOn(dueMs: number, nowMs: number, timeZone: string): number {
  return zonedDayIndex(nowMs, timeZone) - zonedDayIndex(dueMs, timeZone);
}

// ── Decision ─────────────────────────────────────────────────────────────────
export interface InvoiceWaInvoiceFacts {
  status: string;
  source?: string | null;
  dueDateMs: number | null;
  total: number;
  paidAmount: number;
  /** The LAST pre-due send (the cadence repeats from it). */
  preDueWaSentAtMs?: number | null;
  dueWaSentAtMs?: number | null;
  overdueWaSentAtMs?: number | null;
  /** Overdue-stage WhatsApp sends so far. */
  overdueWaCount?: number | null;
  /** When the overdue EMAIL went out (null = not yet). */
  overdueEmailSentAtMs?: number | null;
  /** An overdue email can reach this client (address, not opted out, not WHMCS-skipped). */
  emailChannelAvailable?: boolean;
  /** When the last overdue email send THREW (null = never). Newer than the last success = email is broken. */
  overdueEmailFailedAtMs?: number | null;
}

export interface InvoiceWaCustomerFacts {
  phone?: string | null;
  waOptOut?: boolean | null;
  disableOverdueReminders?: boolean | null;
  /** The number a previous send failed PERMANENTLY for (not on WhatsApp / invalid). */
  waUndeliverablePhone?: string | null;
}

export interface InvoiceWaContext {
  nowMs: number;
  timeZone?: string;
  /** The team has a usable channel of the configured kind (Meta creds / VPS + secret). */
  hasChannel: boolean;
  /** Meta only: the configured template document exists. */
  hasTemplate: boolean;
}

export type InvoiceWaBlockReason =
  | 'disabled'
  | 'source-mismatch'
  | 'settled'
  | 'zero-balance'
  | 'no-due-date'
  | 'not-due'
  | 'awaiting-email'
  | 'max-sends-reached'
  | 'already-sent'
  | 'no-customer'
  | 'customer-opt-out'
  | 'wa-opt-out'
  | 'no-phone'
  | 'undeliverable'
  | 'outside-hours'
  | 'no-channel'
  | 'no-template'
  /** Tallied by the cron when the provider refused the send (nothing stamped, nothing counted). */
  | 'send-failed';

export const INVOICE_WA_BLOCK_LABELS: Record<InvoiceWaBlockReason, string> = {
  'disabled': 'çaktivizuar',
  'source-mismatch': 'burim tjetër (WHMCS/FivoCRM)',
  'settled': 'e paguar / anuluar / draft',
  'zero-balance': 'pa balancë',
  'no-due-date': 'pa afat',
  'not-due': 'ende jo në fazë',
  'awaiting-email': 'pret email-in e vonesës',
  'max-sends-reached': 'u arrit numri maksimal i kujtesave',
  'already-sent': 'dërguar tashmë',
  'no-customer': 'pa klient',
  'customer-opt-out': 'klienti ka fikur kujtesat',
  'wa-opt-out': 'klienti ka refuzuar WhatsApp',
  'no-phone': 'pa numër telefoni',
  'undeliverable': 'numri nuk merr WhatsApp',
  'outside-hours': 'jashtë orarit',
  'no-channel': 'kanali WhatsApp mungon',
  'no-template': 'template mungon',
  'send-failed': 'dërgimi dështoi',
};

export type InvoiceWaDecision =
  | { ok: true; stage: InvoiceWaStage; daysLate: number }
  | { ok: false; reason: InvoiceWaBlockReason };

export function invoiceMatchesSource(sources: InvoiceWaSource, invSource: string | null | undefined): boolean {
  if (sources === 'all') return true;
  const isWhmcs = invSource === 'whmcs';
  return sources === 'whmcs' ? isWhmcs : !isWhmcs;
}

export const SETTLED_STATUSES = new Set(['Paid', 'Cancelled', 'Draft']);

/**
 * May the email-first gate wait for the email? Only when an email CAN go out
 * AND the last attempt did not fail after the last success. A failed SMTP send
 * stamps `overdueEmailFailedAt`; without this the WhatsApp leg waited forever
 * for an email that was never going to arrive.
 */
export function invoiceEmailUsable(inv: InvoiceWaInvoiceFacts): boolean {
  if (!inv.emailChannelAvailable) return false;
  const failed = inv.overdueEmailFailedAtMs || 0;
  return !(failed && failed > (inv.overdueEmailSentAtMs || 0));
}

/** Does the WHMCS pre-due cadence (not the once-only `preDueDays`) govern this invoice? */
export function usesWhmcsCadence(inv: Pick<InvoiceWaInvoiceFacts, 'source'>, cfg: InvoiceWaConfig): boolean {
  return cfg.whmcsCadence && inv.source === 'whmcs';
}

/** Calendar days (in the zone) to wait after the last pre-due send, given the days still left. */
export function whmcsCadenceInterval(daysLeft: number, cfg: InvoiceWaConfig): number {
  return daysLeft <= cfg.whmcsUrgentDays ? cfg.whmcsUrgentEveryDays : cfg.whmcsEveryDays;
}

/** Which stage (if any) the invoice is in RIGHT NOW, honouring the stamps. */
export function invoiceWaStage(inv: InvoiceWaInvoiceFacts, cfg: InvoiceWaConfig, ctx: InvoiceWaContext): InvoiceWaDecision {
  if (inv.dueDateMs == null || !Number.isFinite(inv.dueDateMs)) return { ok: false, reason: 'no-due-date' };
  const tz = ctx.timeZone || INVOICE_WA_DEFAULT_TZ;
  const daysLate = daysLateOn(inv.dueDateMs, ctx.nowMs, tz);

  if (daysLate > 0) {
    if (daysLate < cfg.overdueDays) return { ok: false, reason: 'not-due' };
    if (invoiceEmailUsable(inv) && !inv.overdueEmailSentAtMs) return { ok: false, reason: 'awaiting-email' };
    if ((inv.overdueWaCount || 0) >= cfg.overdueMaxSends) return { ok: false, reason: 'max-sends-reached' };
    const last = inv.overdueWaSentAtMs || 0;
    if (last && ctx.nowMs - last < cfg.renotifyDays * INVOICE_WA_DAY_MS) return { ok: false, reason: 'already-sent' };
    return { ok: true, stage: 'overdue', daysLate };
  }
  const cadence = usesWhmcsCadence(inv, cfg);
  if (daysLate === 0) {
    if (!cfg.onDue && !cadence) return { ok: false, reason: 'not-due' };
    if (inv.dueWaSentAtMs) return { ok: false, reason: 'already-sent' };
    return { ok: true, stage: 'due', daysLate };
  }
  // Ahead of the due date.
  if (cadence) {
    const daysLeft = -daysLate;
    if (daysLeft > cfg.whmcsWindowDays) return { ok: false, reason: 'not-due' };
    const last = inv.preDueWaSentAtMs || 0;
    if (last && zonedDayIndex(ctx.nowMs, tz) - zonedDayIndex(last, tz) < whmcsCadenceInterval(daysLeft, cfg)) {
      return { ok: false, reason: 'already-sent' };
    }
    return { ok: true, stage: 'pre-due', daysLate };
  }
  if (cfg.preDueDays <= 0 || -daysLate > cfg.preDueDays) return { ok: false, reason: 'not-due' };
  if (inv.preDueWaSentAtMs) return { ok: false, reason: 'already-sent' };
  return { ok: true, stage: 'pre-due', daysLate };
}

/**
 * The ONLY gate. Checks are ordered cheapest-first and by "whose fault": config,
 * then the invoice, then the customer, then the moment, then the channel.
 */
export function invoiceWaDecision(
  inv: InvoiceWaInvoiceFacts,
  customer: InvoiceWaCustomerFacts | null | undefined,
  cfg: InvoiceWaConfig,
  ctx: InvoiceWaContext,
): InvoiceWaDecision {
  if (!cfg.enabled) return { ok: false, reason: 'disabled' };
  if (!invoiceMatchesSource(cfg.sources, inv.source)) return { ok: false, reason: 'source-mismatch' };
  if (SETTLED_STATUSES.has(inv.status)) return { ok: false, reason: 'settled' };
  if (!(inv.total - (inv.paidAmount || 0) > 0)) return { ok: false, reason: 'zero-balance' };

  const stage = invoiceWaStage(inv, cfg, ctx);
  if (!stage.ok) return stage;

  if (!customer) return { ok: false, reason: 'no-customer' };
  if (customer.disableOverdueReminders) return { ok: false, reason: 'customer-opt-out' };
  if (customer.waOptOut) return { ok: false, reason: 'wa-opt-out' };
  const phone = normalizeInvoiceWaPhone(customer.phone);
  if (!phone) return { ok: false, reason: 'no-phone' };
  // A permanent failure for THIS number (editing the phone re-arms the customer).
  if (customer.waUndeliverablePhone && normalizeInvoiceWaPhone(customer.waUndeliverablePhone) === phone) {
    return { ok: false, reason: 'undeliverable' };
  }

  const hour = localHourIn(ctx.timeZone || INVOICE_WA_DEFAULT_TZ, ctx.nowMs);
  if (hour < cfg.hourStart || hour >= cfg.hourEnd) return { ok: false, reason: 'outside-hours' };

  if (!ctx.hasChannel) return { ok: false, reason: 'no-channel' };
  if (cfg.channel === 'meta' && !ctx.hasTemplate) return { ok: false, reason: 'no-template' };
  return stage;
}

/**
 * Digits only, in international form; 8–15 digits or ''. Albanian numbers are
 * stored every which way in the CRM ("069…", "69…", "+355 069…", "00355…");
 * WhatsApp needs "355…", and a bare "699249702" became the jid
 * 699249702@s.whatsapp.net — a send that can only fail.
 *
 * SAME RULES as `toWaPhone` (src/lib/messaging/waPhone.ts) — copied, not
 * imported, because this module is import-free; the test pins the two together.
 */
export function normalizeInvoiceWaPhone(phone: string | null | undefined): string {
  let digits = String(phone ?? '').replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (/^3550[6-9]/.test(digits)) digits = '355' + digits.slice(4);
  else if (/^0[6-9]\d{7,8}$/.test(digits)) digits = '355' + digits.slice(1);
  else if (/^[6-9]\d{8}$/.test(digits)) digits = '355' + digits;
  return digits.length >= 8 && digits.length <= 15 ? digits : '';
}

/**
 * Deterministic idempotency key for one reminder send: the VPS refuses a second
 * send with the same key within 24h, so a died run or a racing manual trigger
 * cannot WhatsApp the same reminder twice. `n` = the send number of that stage
 * (1-based: `overdueWaCount + 1` / `preDueWaCount + 1`); the due stage is
 * once-only, so n = 1. A once-only pre-due send has count 0 → n = 1, as before.
 */
export function invoiceWaIdempotencyKey(invoiceId: string, stage: InvoiceWaStage, n: number): string {
  return `inv_${invoiceId}_${stage}_${stage === 'due' ? 1 : Math.max(1, Math.floor(n))}`;
}

/** The stamp field a successful send of `stage` must write. */
export function invoiceWaStageField(stage: InvoiceWaStage): 'preDueWaSentAt' | 'dueWaSentAt' | 'overdueWaSentAt' {
  return stage === 'pre-due' ? 'preDueWaSentAt' : stage === 'due' ? 'dueWaSentAt' : 'overdueWaSentAt';
}

// ── Text ─────────────────────────────────────────────────────────────────────
/** "skadon për 3 ditë" / "skadon sot" / "ka 12 ditë vonesë". */
export function invoiceWaDueText(stage: InvoiceWaStage, daysLate: number): string {
  if (stage === 'due') return 'skadon sot';
  if (stage === 'pre-due') {
    const n = Math.abs(daysLate);
    return n === 1 ? 'skadon nesër' : `skadon për ${n} ditë`;
  }
  return daysLate === 1 ? 'ka 1 ditë vonesë' : `ka ${daysLate} ditë vonesë`;
}

/** Amount for a message: thousands with a space, no trailing .00. */
export function formatInvoiceWaAmount(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const rounded = Math.round(n * 100) / 100;
  const [int, frac] = rounded.toFixed(2).split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return frac === '00' ? grouped : `${grouped}.${frac}`;
}

export interface InvoiceWaTextContext {
  name?: string | null;
  firstName?: string | null;
  company?: string | null;
  invoiceNumber?: string | null;
  amount?: number | string | null;
  currency?: string | null;
  dueDate?: string | null;
  dueText?: string | null;
  daysLate?: number | null;
  link?: string | null;
  whmcsLink?: string | null;
  [key: string]: string | number | null | undefined;
}

/**
 * Render a Baileys body. An unknown token renders EMPTY (never leak `{{foo}}` to
 * a client); a body without `{{link}}` gets the pay link appended on its own
 * line — dropping the one thing that lets them pay is the worst failure mode.
 */
export function renderInvoiceWaText(text: string, ctx: InvoiceWaTextContext): string {
  const body = (text && text.trim()) ? text : DEFAULT_INVOICE_WA_TEXT;
  const hasLinkToken = /\{\{\s*link\s*\}\}/.test(body);
  const out = body.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, key: string) => {
    const v = ctx[key];
    if (v === null || v === undefined) return '';
    if (key === 'amount' && typeof v === 'number') return formatInvoiceWaAmount(v);
    return String(v);
  }).replace(/[ \t]+\n/g, '\n').replace(/ {2,}/g, ' ').trim();
  if (!hasLinkToken && ctx.link) return `${out}\n${ctx.link}`;
  return out;
}

/** First word of a display name — "Arben Hoxha" → "Arben"; a company name stays whole if it has no space. */
export function invoiceWaFirstName(name: string | null | undefined): string {
  const n = String(name || '').trim();
  if (!n) return '';
  return n.split(/\s+/)[0];
}

// ── Meta template parameters ─────────────────────────────────────────────────
/**
 * Fields a Meta template's `paramFields` may name for an INVOICE reminder
 * ({{1}}, {{2}}, … are filled in this order). The UI picker lists exactly these.
 *
 *   invoiceNumber  — "INV-2026-014" (or the short doc id)
 *   amount         — balance still owed, formatted ("12 500")
 *   balanceDue     — same as amount (explicit name)
 *   total          — invoice gross total, formatted
 *   currency       — "ALL" / "EUR"
 *   dueDate        — "14.09.2026" (Europe/Tirane)
 *   dueText        — "skadon sot" / "ka 5 ditë vonesë"
 *   daysLate       — whole days late (0 before/at the due day)
 *   customerName   — the customer's full name
 *   firstName      — first word of the customer's name
 *   companyName    — OUR company name (teamSettings.companyName)
 *   paymentLink    — the public pay link (same as `link`)
 *   whmcsLink      — WHMCS viewinvoice link (WHMCS invoices only)
 *
 * Legacy aliases still accepted: name, company, link, daysOverdue.
 */
export const INVOICE_WA_PARAM_FIELDS = [
  'invoiceNumber', 'amount', 'balanceDue', 'total', 'currency', 'dueDate', 'dueText', 'daysLate',
  'customerName', 'firstName', 'companyName', 'paymentLink', 'whmcsLink',
] as const;

const INVOICE_WA_PARAM_ALIASES: Record<string, string> = {
  balanceDue: 'amount', customerName: 'name', companyName: 'company', paymentLink: 'link', daysOverdue: 'daysLate',
};

/** Positional params for a Meta template from its `paramFields`; unknown/'custom' → ''. */
export function invoiceWaTemplateParams(paramFields: unknown, ctx: InvoiceWaTextContext): string[] {
  const fields = Array.isArray(paramFields) ? paramFields : [];
  return fields.map((raw) => {
    const f = typeof raw === 'string' ? raw.trim() : '';
    if (!f || f === 'custom') return '';
    const key = INVOICE_WA_PARAM_ALIASES[f] || f;
    const v = ctx[key];
    if (v === null || v === undefined) return '';
    if ((key === 'amount' || key === 'total') && (typeof v === 'number' || /^-?\d+(\.\d+)?$/.test(String(v)))) {
      return formatInvoiceWaAmount(Number(v));
    }
    if (key === 'daysLate') return String(Math.max(0, Number(v) || 0));
    return String(v);
  });
}

/** Count block reasons for the per-team run summary. */
export function tallyInvoiceWaBlocked(reasons: InvoiceWaBlockReason[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of reasons) out[r] = (out[r] || 0) + 1;
  return out;
}
