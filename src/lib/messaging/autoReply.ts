/**
 * WhatsApp auto-reply decision — PURE (no Firebase, no env, no clock).
 *
 * The inbound handler (`api/_waInbound.ts`) fetches the facts and executes the
 * send; this module only answers "should we auto-reply, and with what?". Every
 * non-reply is a NAMED reason so the handler can record it and the settings
 * screen can explain "why did the customer get nothing at 23:00?".
 *
 * Two automatic messages exist, and ONLY these two are ever sent without a
 * person pressing send (owner decision, 12 Sep 2026 — "AI propozon, njeriu
 * dërgon"):
 *   - `outside-hours` — the office is closed (hour OR weekday); static text.
 *   - `greeting`      — first contact in `waGreetingAfterDays`; static text.
 * When both apply, outside-hours wins: it is the more informative one.
 *
 * `src/lib/messaging/autoReply.ts` is the browser MIRROR (the settings panel
 * previews the exact decision). `autoReply.test.ts` reads both files and fails
 * on any byte of difference — keep this file dependency-free so the mirror can
 * stay identical; "keeping them in sync" means copying the file.
 */

export type AutoReplyBlockReason =
  | 'disabled'             // neither auto-reply nor greeting is switched on
  | 'own-echo'             // the event is our own outbound message
  | 'auto-reply-echo'      // the event is an auto-reply echo
  | 'not-a-message'        // reaction / system event, nothing to answer
  | 'opted-out'            // the contact asked not to receive automatic messages
  | 'no-text-configured'   // the applicable feature is on but its text is empty
  | 'debounced'            // an auto-reply went to this conversation within the debounce window
  | 'inside-hours'         // office is open — a person will answer
  | 'not-first-contact'    // greeting only, and this contact was in touch recently
  | 'reply-to-automated'   // the contact is answering one of OUR automated messages (invoice reminder, campaign…)
  | 'no-phone'             // sender-side: only a WhatsApp LID is known, no deliverable phone yet
  | 'meta-window-closed'   // sender-side: Meta's 24h customer-service window is shut
  | 'no-channel'           // sender-side: no Meta token / VPS available to send with
  | 'agent-active';        // the virtual sales agent (Ana) owns this channel — she answers, not the static text

export interface AutoReplySettings {
  waAutoReplyEnabled?: boolean;
  waAutoReplyText?: string;
  /** "HH:MM" in `timeZone`. Both empty = always open = never "outside hours" (legacy semantics). */
  waBusinessStart?: string;
  waBusinessEnd?: string;
  /** JS weekday numbers (0 = Sunday … 6 = Saturday). Default Monday–Friday. */
  waBusinessDays?: number[];
  waGreetingEnabled?: boolean;
  waGreetingText?: string;
  /** A contact silent for this many days (in AND out) counts as a first contact again (default 7). */
  waGreetingAfterDays?: number;
  /** Hours between two auto-replies to the same conversation (default 6). */
  waAutoReplyDebounceHours?: number;
  /**
   * A message that arrives within this many hours of an AUTOMATED outbound
   * (reminder, campaign, automation) is a reply to it — no greeting / auto-reply
   * (default 72).
   */
  waReplyToAutomatedHours?: number;
}

export interface AutoReplyContact {
  firstName?: string;
  name?: string;
  company?: string;
  /** Set by the STOP/NDALO/HIQ keywords or by staff; blocks every automatic message. */
  waOptOut?: boolean;
}

export interface AutoReplyHistory {
  /** Newest inbound message BEFORE the one being processed (epoch ms), or null = none. */
  lastInboundBeforeMs: number | null;
  /** Newest outbound message from staff/automation (epoch ms), or null = none. */
  lastOutboundMs: number | null;
  /** `whatsappConversations.lastAutoReplyAt` (epoch ms), or null. */
  lastAutoReplyMs: number | null;
  /**
   * Newest outbound `whatsappMessages` row to this phone (epoch ms), or null.
   * Optional: absent = unknown = the reply-to-automated rule does not apply.
   */
  lastOutboundMessageMs?: number | null;
  /** Was that newest outbound row sent by automation (`automated: true` / a campaign / a reminder)? */
  lastOutboundMessageAutomated?: boolean;
}

export interface AutoReplyInput {
  channel: 'meta' | 'baileys';
  direction: 'inbound' | 'outbound';
  isAutoReply: boolean;
  kind: 'text' | 'media' | 'reaction' | 'system';
  settings: AutoReplySettings;
  contact: AutoReplyContact;
  history: AutoReplyHistory;
  nowMs: number;
  timeZone: string;
}

/** S2 name of the input type — kept so the handler's import keeps compiling. */
export type AutoReplyDecisionInput = AutoReplyInput;

export type AutoReplyDecision =
  | { kind: 'outside-hours' | 'greeting'; text: string }
  | { blocked: AutoReplyBlockReason };

export const DEFAULT_AUTO_REPLY_DEBOUNCE_HOURS = 6;
export const DEFAULT_REPLY_TO_AUTOMATED_HOURS = 72;
export const DEFAULT_GREETING_AFTER_DAYS = 7;
export const DEFAULT_BUSINESS_DAYS: readonly number[] = [1, 2, 3, 4, 5];
export const DEFAULT_WA_TIMEZONE = 'Europe/Tirane';

/** Opt-out keywords: a whole-message match (case-insensitive) sets `waOptOut`. */
export const WA_OPT_OUT_RE = /^\s*(stop|ndalo|hiq|unsubscribe)\s*[.!]?\s*$/i;
export const isOptOutMessage = (text: string | null | undefined): boolean =>
  typeof text === 'string' && WA_OPT_OUT_RE.test(text);

/** Resubscribe keywords: a whole-message START / FILLO / RIFILLO clears `waOptOut`. */
export const WA_OPT_IN_RE = /^\s*(start|fillo|rifillo)\s*[.!]?\s*$/i;
export const isOptInMessage = (text: string | null | undefined): boolean =>
  typeof text === 'string' && WA_OPT_IN_RE.test(text);

export const AUTO_REPLY_BLOCK_LABELS: Record<AutoReplyBlockReason, string> = {
  'disabled': 'Përgjigjet automatike janë të çaktivizuara',
  'own-echo': 'Mesazh i dërguar nga ne (jo nga klienti)',
  'auto-reply-echo': 'Jehonë e një përgjigjeje automatike',
  'not-a-message': 'Reagim ose ngjarje sistemi — s\'ka çfarë të përgjigjet',
  'opted-out': 'Kontakti ka kërkuar të mos marrë mesazhe automatike',
  'no-text-configured': 'Funksioni është aktiv, por teksti i mesazhit është bosh',
  'debounced': 'U dërgua tashmë një përgjigje automatike së fundmi',
  'inside-hours': 'Brenda orarit të punës — përgjigjet një person',
  'not-first-contact': 'Kontakt i njohur — përshëndetja dërgohet vetëm herën e parë',
  'reply-to-automated': 'Klienti po i përgjigjet një mesazhi tonë automatik (kujtesë, fushatë) — përgjigjet një person',
  'no-phone': 'Numri i telefonit nuk dihet ende (vetëm LID e WhatsApp)',
  'meta-window-closed': 'Dritarja 24-orëshe e Meta është e mbyllur',
  'no-channel': 'S\'ka kanal dërgimi (token Meta / VPS) të konfiguruar',
  'agent-active': 'Agjentja virtuale e shitjeve (Ana) është aktive për WhatsApp — përgjigjet ajo, jo teksti statik',
};

const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

// ── Time in the office's zone ─────────────────────────────────────────────────

/** Minutes since midnight of `nowMs` in `timeZone`. */
function minutesOfDayInZone(nowMs: number, timeZone: string): number {
  const hhmm = new Intl.DateTimeFormat('en-GB', {
    timeZone, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(nowMs));
  const [h, m] = hhmm.split(':').map(Number);
  // Intl can emit "24" for midnight in some engines.
  return ((h || 0) % 24) * 60 + (m || 0);
}

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** JS weekday (0 = Sunday) of `nowMs` in `timeZone`. */
function weekdayInZone(nowMs: number, timeZone: string): number {
  const wd = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(new Date(nowMs));
  return WEEKDAY_INDEX[wd] ?? new Date(nowMs).getUTCDay();
}

function parseHHMM(s?: string): number | null {
  if (!s || typeof s !== 'string') return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h > 24 || min > 59) return null;
  return h * 60 + min;
}

/** A valid, non-empty list of weekdays 0–6, else the Monday–Friday default. */
function normalizeBusinessDays(days?: number[]): number[] {
  if (!Array.isArray(days)) return [...DEFAULT_BUSINESS_DAYS];
  const clean = Array.from(new Set(days.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)));
  return clean.length ? clean : [...DEFAULT_BUSINESS_DAYS];
}

/**
 * Is `nowMs` outside the configured business hours?
 * An empty/invalid hours configuration means "always open" → false (no reply),
 * which is the legacy meta-webhook behaviour. Supports an overnight window
 * (22:00–06:00). A day that is not in `days` is outside hours all day long.
 */
export function isOutsideBusinessHours(
  nowMs: number,
  timeZone: string,
  startStr?: string,
  endStr?: string,
  days?: number[],
): boolean {
  const start = parseHHMM(startStr);
  const end = parseHHMM(endStr);
  if (start === null || end === null) return false;
  const tz = timeZone || DEFAULT_WA_TIMEZONE;
  if (!normalizeBusinessDays(days).includes(weekdayInZone(nowMs, tz))) return true;
  const cur = minutesOfDayInZone(nowMs, tz);
  if (start <= end) return cur < start || cur >= end;
  return cur >= end && cur < start;
}

// ── Tokens ────────────────────────────────────────────────────────────────────

function firstNameOf(c: AutoReplyContact): string {
  const explicit = typeof c.firstName === 'string' ? c.firstName.trim() : '';
  if (explicit) return explicit;
  const name = typeof c.name === 'string' ? c.name.trim() : '';
  // A phone number saved as the name is not a first name.
  if (!name || /^\+?\d[\d\s-]*$/.test(name)) return '';
  return name.split(/\s+/)[0];
}

/**
 * `{{firstName}} {{name}} {{company}}` (case-insensitive, spaces tolerated).
 * An unknown token renders EMPTY — never leak `{{foo}}` to a customer. Runs of
 * spaces left by an empty token are collapsed and a dangling " ," is healed.
 */
export function renderAutoReplyTokens(text: string, contact: AutoReplyContact): string {
  const c = contact || {};
  const vars: Record<string, string> = {
    firstname: firstNameOf(c),
    name: typeof c.name === 'string' ? c.name.trim() : '',
    company: typeof c.company === 'string' ? c.company.trim() : '',
  };
  return String(text ?? '')
    .replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, key: string) => vars[key.toLowerCase()] ?? '')
    .replace(/[ \t]+([,.!?;:])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .split('\n').map((l) => l.trim()).join('\n')
    .trim();
}

// ── Decision ──────────────────────────────────────────────────────────────────

const positiveNumber = (v: unknown, fallback: number): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const cleanText = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** Nothing in or out within `afterDays` (both null = brand-new contact). */
function isFirstContact(h: AutoReplyHistory, nowMs: number, afterDays: number): boolean {
  const windowMs = afterDays * MS_PER_DAY;
  const recent = (t: number | null) => typeof t === 'number' && t > 0 && nowMs - t < windowMs;
  return !recent(h?.lastInboundBeforeMs ?? null) && !recent(h?.lastOutboundMs ?? null);
}

/** First rule that applies wins — the order IS the specification. */
export function decideAutoReply(input: AutoReplyInput): AutoReplyDecision {
  if (input.direction === 'outbound') return { blocked: 'own-echo' };
  if (input.isAutoReply) return { blocked: 'auto-reply-echo' };
  if (input.kind === 'reaction' || input.kind === 'system') return { blocked: 'not-a-message' };

  const contact = input.contact || {};
  if (contact.waOptOut === true) return { blocked: 'opted-out' };

  const s = input.settings || {};
  const autoOn = s.waAutoReplyEnabled === true;
  const greetOn = s.waGreetingEnabled === true;
  if (!autoOn && !greetOn) return { blocked: 'disabled' };

  // "E pagova sot" in answer to an invoice reminder must not get "Mirë se vini!".
  const h = input.history;
  const lastOutMsg = h?.lastOutboundMessageMs ?? null;
  const automatedHours = positiveNumber(s.waReplyToAutomatedHours, DEFAULT_REPLY_TO_AUTOMATED_HOURS);
  if (
    h?.lastOutboundMessageAutomated === true
    && typeof lastOutMsg === 'number' && lastOutMsg > 0
    && input.nowMs - lastOutMsg < automatedHours * MS_PER_HOUR
  ) {
    return { blocked: 'reply-to-automated' };
  }

  const debounceHours = positiveNumber(s.waAutoReplyDebounceHours, DEFAULT_AUTO_REPLY_DEBOUNCE_HOURS);
  const lastAuto = input.history?.lastAutoReplyMs ?? null;
  if (typeof lastAuto === 'number' && lastAuto > 0 && input.nowMs - lastAuto < debounceHours * MS_PER_HOUR) {
    return { blocked: 'debounced' };
  }

  const tz = input.timeZone || DEFAULT_WA_TIMEZONE;
  const outside = autoOn && isOutsideBusinessHours(input.nowMs, tz, s.waBusinessStart, s.waBusinessEnd, s.waBusinessDays);
  const autoText = cleanText(s.waAutoReplyText);
  if (outside && autoText) return { kind: 'outside-hours', text: renderAutoReplyTokens(autoText, contact) };

  const afterDays = positiveNumber(s.waGreetingAfterDays, DEFAULT_GREETING_AFTER_DAYS);
  const first = greetOn && isFirstContact(input.history, input.nowMs, afterDays);
  const greetText = cleanText(s.waGreetingText);
  if (first && greetText) return { kind: 'greeting', text: renderAutoReplyTokens(greetText, contact) };

  // Nothing to send — name the most specific reason.
  if (outside && !autoText) return { blocked: 'no-text-configured' };
  if (first && !greetText) return { blocked: 'no-text-configured' };
  if (greetOn && !first) return { blocked: 'not-first-contact' };
  if (autoOn) return { blocked: 'inside-hours' };
  return { blocked: 'disabled' };
}
