// ── WhatsApp reminders for unpaid invoices — ONE engine for UI + cron ────────
//
// Sent by the `overdue-reminders` cron (api/cron/run.ts) every ~2 hours; edited
// in Cilësimet → Automatizime → "Kujtesa faturash në WhatsApp"
// (FollowUpSettingsPanel). Covers FivoCRM's own invoices AND the ones mirrored
// from WHMCS (`source: 'whmcs'`) — WHMCS only ever emails, so this is how a
// hosting client gets a WhatsApp nudge.
//
// Three stages, each with its own idempotency stamp on the invoice:
//   pre-due  → `preDueWaSentAt`   ("skadon për N ditë", once)
//   due      → `dueWaSentAt`      ("skadon sot", once)
//   overdue  → `overdueWaSentAt`  (after `overdueDays` late, repeated every
//                                  `renotifyDays`)
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
  /** Local send window [hourStart, hourEnd) in Europe/Tirane. */
  hourStart: number;
  hourEnd: number;
  /** Skip FivoCRM's weekly overdue EMAIL for WHMCS invoices (WHMCS mails them itself). */
  emailSkipWhmcs: boolean;
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
  overdueDays: 60,
  renotifyDays: 14,
  hourStart: 9,
  hourEnd: 19,
  emailSkipWhmcs: false,
});

export const INVOICE_WA_LIMITS = Object.freeze({
  preDueDays: { min: 0, max: 30 },
  overdueDays: { min: 1, max: 365 },
  renotifyDays: { min: 1, max: 90 },
  hour: { min: 0, max: 23 },
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
    hourStart,
    hourEnd,
    emailSkipWhmcs: s.overdueEmailSkipWhmcs === true,
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
  preDueWaSentAtMs?: number | null;
  dueWaSentAtMs?: number | null;
  overdueWaSentAtMs?: number | null;
}

export interface InvoiceWaCustomerFacts {
  phone?: string | null;
  waOptOut?: boolean | null;
  disableOverdueReminders?: boolean | null;
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
  | 'already-sent'
  | 'no-customer'
  | 'customer-opt-out'
  | 'wa-opt-out'
  | 'no-phone'
  | 'outside-hours'
  | 'no-channel'
  | 'no-template';

export const INVOICE_WA_BLOCK_LABELS: Record<InvoiceWaBlockReason, string> = {
  'disabled': 'çaktivizuar',
  'source-mismatch': 'burim tjetër (WHMCS/FivoCRM)',
  'settled': 'e paguar / anuluar / draft',
  'zero-balance': 'pa balancë',
  'no-due-date': 'pa afat',
  'not-due': 'ende jo në fazë',
  'already-sent': 'dërguar tashmë',
  'no-customer': 'pa klient',
  'customer-opt-out': 'klienti ka fikur kujtesat',
  'wa-opt-out': 'klienti ka refuzuar WhatsApp',
  'no-phone': 'pa numër telefoni',
  'outside-hours': 'jashtë orarit',
  'no-channel': 'kanali WhatsApp mungon',
  'no-template': 'template mungon',
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

/** Which stage (if any) the invoice is in RIGHT NOW, honouring the stamps. */
export function invoiceWaStage(inv: InvoiceWaInvoiceFacts, cfg: InvoiceWaConfig, ctx: InvoiceWaContext): InvoiceWaDecision {
  if (inv.dueDateMs == null || !Number.isFinite(inv.dueDateMs)) return { ok: false, reason: 'no-due-date' };
  const tz = ctx.timeZone || INVOICE_WA_DEFAULT_TZ;
  const daysLate = daysLateOn(inv.dueDateMs, ctx.nowMs, tz);

  if (daysLate > 0) {
    if (daysLate < cfg.overdueDays) return { ok: false, reason: 'not-due' };
    const last = inv.overdueWaSentAtMs || 0;
    if (last && ctx.nowMs - last < cfg.renotifyDays * INVOICE_WA_DAY_MS) return { ok: false, reason: 'already-sent' };
    return { ok: true, stage: 'overdue', daysLate };
  }
  if (daysLate === 0) {
    if (!cfg.onDue) return { ok: false, reason: 'not-due' };
    if (inv.dueWaSentAtMs) return { ok: false, reason: 'already-sent' };
    return { ok: true, stage: 'due', daysLate };
  }
  // Ahead of the due date.
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
  if (!normalizeInvoiceWaPhone(customer.phone)) return { ok: false, reason: 'no-phone' };

  const hour = localHourIn(ctx.timeZone || INVOICE_WA_DEFAULT_TZ, ctx.nowMs);
  if (hour < cfg.hourStart || hour >= cfg.hourEnd) return { ok: false, reason: 'outside-hours' };

  if (!ctx.hasChannel) return { ok: false, reason: 'no-channel' };
  if (cfg.channel === 'meta' && !ctx.hasTemplate) return { ok: false, reason: 'no-template' };
  return stage;
}

/** Digits only; anything shorter than 8 digits is not a reachable number. */
export function normalizeInvoiceWaPhone(phone: string | null | undefined): string {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.length >= 8 ? digits : '';
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

/** Count block reasons for the per-team run summary. */
export function tallyInvoiceWaBlocked(reasons: InvoiceWaBlockReason[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of reasons) out[r] = (out[r] || 0) + 1;
  return out;
}
