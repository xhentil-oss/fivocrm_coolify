/**
 * Virtual sales agent ("Ana") — the IMPORT-FREE core.
 *
 * This file DECIDES; `api/_salesAgent.ts` / `api/_salesAgentJobs.ts` fetch facts and
 * execute. `api/_salesAgentCore.ts` is a byte-identical copy (test-enforced) because
 * `api/` never imports from `src/`.
 *
 * Laws (workspace/SALES_AGENT_PLAN.md §1):
 *   1. The agent PROPOSES; autonomy opens in levels (0 = suggestions only, default).
 *      Every level has guardrails here, not in the UI.
 *   3. Every non-action is a named `SalesAgentBlockReason` — never a silent skip.
 *   4. Numbers never come from the model: prices/hours/policies are FACTS injected
 *      via `renderSalesFacts()`; a price the facts do not state → handoff
 *      (`custom-price`), never an invented figure.
 *   7. Cold WhatsApp is allowed but metered PER SENDER NUMBER (`coldWaBlockReason`):
 *      ≤ perDay, ≥ minGap, office window, weekdays, warm-up, never on the day the
 *      prospect was registered, auto-pause on blocks.
 *   8. Transparency: the first message and any "are you a bot?" says "asistent/e
 *      virtual/e". `ensureDisclosure()` is applied server-side on every send.
 */

// ── Identity ────────────────────────────────────────────────────────────────

/** The bot uid used as `senderId` on rows the server writes. Never an Auth user. */
export const SALES_AGENT_UID = 'salesagent';
export const SALES_AGENT_DEFAULT_NAME = 'Ana';
export const SALES_AGENT_TITLE = 'Asistente virtuale e shitjeve';
export const SALES_AGENT_AVATAR_PATH = '/salesagent.svg';
export const salesAgentProfileDocId = (businessId: string): string => `salesagent_${businessId}`;
export const isSalesAgentUid = (uid: unknown): boolean => uid === SALES_AGENT_UID;

// ── Settings ────────────────────────────────────────────────────────────────

/** 0 suggestions · 1 simple answers · 2 qualifies + books · 3 standard offers. */
export type SalesAgentAutonomy = 0 | 1 | 2 | 3;
/** Platform cap for v1 (owner decision 31 Oct 2026): level 3 stays behind a platform flag. */
export const SALES_AGENT_MAX_AUTONOMY: SalesAgentAutonomy = 2;

export const AUTONOMY_LABELS: Record<SalesAgentAutonomy, { label: string; detail: string }> = {
  0: { label: 'Vetëm sugjerime', detail: 'Ana përgatit draft-e; çdo mesazh e dërgon një person.' },
  1: { label: 'Përgjigjet në pyetje të thjeshta', detail: 'Përgjigjet vetë vetëm pyetjeve nga FAQ/katalogu, jashtë orarit ose kur askush nuk përgjigjet.' },
  2: { label: 'Kualifikon dhe rezervon', detail: 'Bën pyetjet e kualifikimit, cakton hapin tjetër, propozon orare dhe dërgon email-et e sekuencës.' },
  3: { label: 'Dërgon oferta standarde', detail: 'Dërgon preventivin kur paketa është standarde (pa zbritje).' },
};

export type QualificationFieldKey = 'service' | 'city' | 'timeline' | 'budget' | 'decisionMaker';

export const QUALIFICATION_FIELDS: Record<QualificationFieldKey, { label: string; question: string }> = {
  service: { label: 'Shërbimi', question: 'Për cilin shërbim do të donit të flisnim?' },
  city: { label: 'Qyteti / sektori', question: 'Ku ndodhet biznesi juaj dhe në çfarë fushe punon?' },
  timeline: { label: 'Afati', question: 'Kur do të donit të fillonit?' },
  budget: { label: 'Buxheti', question: 'A keni një interval buxheti në mendje, sa për t\'ju orientuar drejt paketës së duhur?' },
  decisionMaker: { label: 'Vendimmarrësi', question: 'A jeni ju personi që vendos për këtë, apo duhet të përfshihet dikush tjetër?' },
};

export const QUALIFICATION_ORDER: readonly QualificationFieldKey[] = ['service', 'city', 'timeline', 'budget', 'decisionMaker'];
/** Collected fields needed before a lead counts as qualified. */
export const QUALIFIED_MIN_FIELDS = 3;

export interface SalesAgentPersona {
  name: string;
  /** Shown in the disclosure: "<name>, asistentja virtuale e <businessName>". */
  businessName: string;
  tone: 'formal' | 'friendly';
  /** ISO 639-1 codes the agent may answer in; the first is the default. */
  languages: string[];
}

export interface ColdWaSettings {
  enabled: boolean;
  /** Per sender NUMBER per local day. */
  perDay: number;
  /** Minimum minutes between two cold sends from the same number. */
  minGapMinutes: number;
  /** Local send window (HH:MM). */
  hoursFrom: string;
  hoursTo: string;
  weekdaysOnly: boolean;
  /** Warm-up: a sender number younger than `warmupDays` sends at most `warmupPerDay`. */
  warmupPerDay: number;
  warmupDays: number;
  /** Dedicated outreach account (`whatsappAccounts` id); null = the team's connected agent. */
  senderAgentId: string | null;
  /** First-message template; tokens {{name}} {{company}} {{agent}} {{business}} {{service}}. */
  template: string;
}

export interface SalesAgentIcp {
  categories: string[];
  cities: string[];
  minRating: number;
  minReviews: number;
  /** Agency sells web/SEO: a business WITHOUT a (secure) website scores higher. */
  preferNoWebsite: boolean;
  /** Keywords that mark chains/corporates we do not sell to. */
  excludeKeywords: string[];
}

export interface SalesAgentSettings {
  enabled: boolean;
  persona: SalesAgentPersona;
  autonomy: SalesAgentAutonomy;
  /** Office hours (local). Outside them level 1 answers on its own. */
  officeFrom: string;
  officeTo: string;
  /** Inside office hours, level 1 waits this long for a human before answering. */
  humanSilenceMinutes: number;
  /** A handoff nobody picks up within this many minutes escalates to managers. */
  handoffSlaMinutes: number;
  /** Turns without a new collected field before the agent hands off (`no-progress`). */
  maxTurnsWithoutProgress: number;
  channels: { whatsapp: boolean; email: boolean; portal: boolean; landingForm: boolean };
  qualificationFields: QualificationFieldKey[];
  meeting: { durationMin: number; slotsToOffer: number; hoursFrom: string; hoursTo: string };
  /** AI replies per tenant per local day. */
  dailyReplyCap: number;
  /** Google Places Text Search REQUESTS per month (each returns ≤ 20 businesses). */
  placesMonthlyBudget: number;
  icp: SalesAgentIcp;
  coldWa: ColdWaSettings;
  /** Max nudges to a silent prospect in `qualifying`. */
  maxNudges: number;
  nudgeAfterHours: number;
}

export const SALES_AGENT_LIMITS = {
  replyMaxChars: 400,
  burstMs: 60_000,
  historyLimit: 12,
  knowledgeMaxItems: 200,
  dailyReplyCapMax: 1000,
  placesBudgetMax: 2000,
  coldWaPerDayMax: 10,
  coldWaMinGapMinutesMin: 60,
  coldWaWarmupPerDayMax: 3,
  maxResultsPerSearch: 60,
  placesPageSize: 20,
  prospectTtlDays: 30,
  /** Cold-WA auto-pause length after 2+ blocks/failures in 24h. */
  coldWaPauseDays: 7,
} as const;

export const COLD_WA_DEFAULT_TEMPLATE =
  'Përshëndetje {{name}}! Jam {{agent}}, asistentja virtuale e {{business}}. Ju shkruaj sepse ndihmojmë biznese si {{company}} me {{service}}. A do të kishit 10 minuta këtë javë për një bisedë të shkurtër?';

export const SALES_AGENT_DEFAULTS: SalesAgentSettings = {
  enabled: false,
  persona: { name: SALES_AGENT_DEFAULT_NAME, businessName: '', tone: 'friendly', languages: ['sq', 'en'] },
  autonomy: 0,
  officeFrom: '09:00',
  officeTo: '18:00',
  humanSilenceMinutes: 10,
  handoffSlaMinutes: 30,
  maxTurnsWithoutProgress: 6,
  channels: { whatsapp: true, email: true, portal: true, landingForm: true },
  qualificationFields: ['service', 'city', 'timeline', 'budget', 'decisionMaker'],
  meeting: { durationMin: 30, slotsToOffer: 3, hoursFrom: '10:00', hoursTo: '17:00' },
  dailyReplyCap: 200,
  placesMonthlyBudget: 300,
  icp: { categories: [], cities: [], minRating: 3.5, minReviews: 5, preferNoWebsite: true, excludeKeywords: ['bank', 'ministri', 'bashkia', 'spital', 'universitet'] },
  coldWa: {
    enabled: false,
    perDay: 10,
    minGapMinutes: 60,
    hoursFrom: '09:00',
    hoursTo: '19:00',
    weekdaysOnly: true,
    warmupPerDay: 3,
    warmupDays: 7,
    senderAgentId: null,
    template: COLD_WA_DEFAULT_TEMPLATE,
  },
  maxNudges: 2,
  nudgeAfterHours: 24,
};

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const clampInt = (v: unknown, min: number, max: number, dflt: number): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, Math.round(n)));
};
const clampNum = (v: unknown, min: number, max: number, dflt: number): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, n));
};
const hhmm = (v: unknown, dflt: string): string => (typeof v === 'string' && HHMM_RE.test(v) ? v : dflt);
const strList = (v: unknown, max = 50): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim().slice(0, 80)).slice(0, max) : [];
const text = (v: unknown, max: number, dflt = ''): string => (typeof v === 'string' ? v.trim().slice(0, max) : dflt);

/** Tolerant reader of `teamSettings.salesAgent` — never throws, always complete. Autonomy is capped by the platform. */
export function resolveSalesAgentSettings(raw: unknown, opts: { maxAutonomy?: SalesAgentAutonomy } = {}): SalesAgentSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  const d = SALES_AGENT_DEFAULTS;
  const maxAutonomy = opts.maxAutonomy ?? SALES_AGENT_MAX_AUTONOMY;
  const persona = (r.persona && typeof r.persona === 'object' ? r.persona : {}) as Record<string, any>;
  const channels = (r.channels && typeof r.channels === 'object' ? r.channels : {}) as Record<string, any>;
  const meeting = (r.meeting && typeof r.meeting === 'object' ? r.meeting : {}) as Record<string, any>;
  const icp = (r.icp && typeof r.icp === 'object' ? r.icp : {}) as Record<string, any>;
  const cold = (r.coldWa && typeof r.coldWa === 'object' ? r.coldWa : {}) as Record<string, any>;
  const languages = strList(persona.languages, 5).map((l) => l.toLowerCase().slice(0, 2));
  const fields = strList(r.qualificationFields, 5).filter((f): f is QualificationFieldKey => f in QUALIFICATION_FIELDS);
  return {
    enabled: r.enabled === true,
    persona: {
      name: text(persona.name, 40, d.persona.name) || d.persona.name,
      businessName: text(persona.businessName, 80),
      tone: persona.tone === 'formal' ? 'formal' : 'friendly',
      languages: languages.length ? languages : [...d.persona.languages],
    },
    autonomy: Math.min(maxAutonomy, clampInt(r.autonomy, 0, 3, 0)) as SalesAgentAutonomy,
    officeFrom: hhmm(r.officeFrom, d.officeFrom),
    officeTo: hhmm(r.officeTo, d.officeTo),
    humanSilenceMinutes: clampInt(r.humanSilenceMinutes, 1, 240, d.humanSilenceMinutes),
    handoffSlaMinutes: clampInt(r.handoffSlaMinutes, 5, 1440, d.handoffSlaMinutes),
    maxTurnsWithoutProgress: clampInt(r.maxTurnsWithoutProgress, 2, 20, d.maxTurnsWithoutProgress),
    channels: {
      whatsapp: channels.whatsapp !== false,
      email: channels.email !== false,
      portal: channels.portal !== false,
      landingForm: channels.landingForm !== false,
    },
    qualificationFields: fields.length ? fields : [...d.qualificationFields],
    meeting: {
      durationMin: clampInt(meeting.durationMin, 15, 120, d.meeting.durationMin),
      slotsToOffer: clampInt(meeting.slotsToOffer, 1, 5, d.meeting.slotsToOffer),
      hoursFrom: hhmm(meeting.hoursFrom, d.meeting.hoursFrom),
      hoursTo: hhmm(meeting.hoursTo, d.meeting.hoursTo),
    },
    dailyReplyCap: clampInt(r.dailyReplyCap, 10, SALES_AGENT_LIMITS.dailyReplyCapMax, d.dailyReplyCap),
    placesMonthlyBudget: clampInt(r.placesMonthlyBudget, 0, SALES_AGENT_LIMITS.placesBudgetMax, d.placesMonthlyBudget),
    icp: {
      categories: strList(icp.categories),
      cities: strList(icp.cities),
      minRating: clampNum(icp.minRating, 0, 5, d.icp.minRating),
      minReviews: clampInt(icp.minReviews, 0, 10_000, d.icp.minReviews),
      preferNoWebsite: icp.preferNoWebsite !== false,
      excludeKeywords: 'excludeKeywords' in icp ? strList(icp.excludeKeywords) : [...d.icp.excludeKeywords],
    },
    coldWa: {
      enabled: cold.enabled === true,
      perDay: clampInt(cold.perDay, 1, SALES_AGENT_LIMITS.coldWaPerDayMax, d.coldWa.perDay),
      minGapMinutes: clampInt(cold.minGapMinutes, SALES_AGENT_LIMITS.coldWaMinGapMinutesMin, 1440, d.coldWa.minGapMinutes),
      hoursFrom: hhmm(cold.hoursFrom, d.coldWa.hoursFrom),
      hoursTo: hhmm(cold.hoursTo, d.coldWa.hoursTo),
      weekdaysOnly: cold.weekdaysOnly !== false,
      warmupPerDay: clampInt(cold.warmupPerDay, 1, SALES_AGENT_LIMITS.coldWaWarmupPerDayMax, d.coldWa.warmupPerDay),
      warmupDays: clampInt(cold.warmupDays, 0, 30, d.coldWa.warmupDays),
      senderAgentId: typeof cold.senderAgentId === 'string' && cold.senderAgentId ? cold.senderAgentId : null,
      template: text(cold.template, 600) || d.coldWa.template,
    },
    maxNudges: clampInt(r.maxNudges, 0, 5, d.maxNudges),
    nudgeAfterHours: clampInt(r.nudgeAfterHours, 1, 168, d.nudgeAfterHours),
  };
}

// ── Time helpers (zone-explicit, like Nazmije) ──────────────────────────────

export interface LocalParts { date: string; hhmm: string; weekday: number; hour: number; minute: number }

/** Local date/time parts for a zone. weekday: 0 = Sunday … 6 = Saturday. */
export function localParts(now: Date, timeZone: string): LocalParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short',
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || '';
  const hour = Number(get('hour')) % 24;
  const minute = Number(get('minute'));
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    hhmm: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
    weekday: weekdayMap[get('weekday')] ?? 0,
    hour,
    minute,
  };
}

/** True when `hhmm` is inside [from, to). A window that crosses midnight wraps. */
export function inWindow(hhmm: string, from: string, to: string): boolean {
  if (from === to) return true;
  if (from < to) return hhmm >= from && hhmm < to;
  return hhmm >= from || hhmm < to;
}

export const monthKeyOf = (dateKey: string): string => dateKey.slice(0, 7);

// ── Block reasons ───────────────────────────────────────────────────────────

export type SalesAgentBlockReason =
  | 'module-off'            // teamSettings.salesAgent.enabled is false
  | 'channel-off'           // this channel is switched off for the agent
  | 'no-ai-key'             // neither tenant nor platform key
  | 'no-text'               // media / reaction / empty — nothing to answer
  | 'opted-out'             // the contact said STOP/NDALO
  | 'not-a-person'          // group / newsletter / status jid
  | 'handoff-active'        // a human owns this thread now
  | 'closed'                // the conversation is closed
  | 'autonomy-draft'        // level 0: a draft was stored, nothing sent
  | 'low-confidence'        // the model was unsure → draft for a person
  | 'intent-not-allowed'    // this intent needs a higher level → draft
  | 'inside-hours-human'    // level 1 inside office hours, a human is around
  | 'daily-cap'             // tenant reply cap reached today
  | 'burst'                 // a reply/draft was produced < 60s ago for this thread
  | 'reply-to-automated'    // the contact answers one of our automated rows (invoice, campaign)
  | 'duplicate-run'         // run doc already exists (idempotency)
  | 'empty'                 // model returned nothing usable
  | 'error';

export const SALES_AGENT_BLOCK_LABELS: Record<SalesAgentBlockReason, string> = {
  'module-off': 'Agjentja është e çaktivizuar',
  'channel-off': 'Ky kanal është i fikur për agjenten',
  'no-ai-key': 'Mungon çelësi AI (Cilësimet → FivoAI)',
  'no-text': 'Mesazh pa tekst — s\'ka çfarë të përgjigjet',
  'opted-out': 'Kontakti ka kërkuar të mos marrë mesazhe automatike',
  'not-a-person': 'Nuk është një person (grup / kanal / status)',
  'handoff-active': 'Bisedën e ka marrë një person',
  'closed': 'Biseda është e mbyllur',
  'autonomy-draft': 'Niveli 0 — u ruajt vetëm draft',
  'low-confidence': 'Modeli nuk ishte i sigurt — draft për një person',
  'intent-not-allowed': 'Kjo kërkesë kërkon nivel më të lartë autonomie — draft',
  'inside-hours-human': 'Brenda orarit — pritet përgjigja e një personi',
  'daily-cap': 'Kuota ditore e përgjigjeve u arrit',
  'burst': 'U prodhua një përgjigje para pak sekondash',
  'reply-to-automated': 'Kontakti i përgjigjet një mesazhi tonë automatik (faturë/fushatë)',
  'duplicate-run': 'Ky mesazh u trajtua tashmë',
  'empty': 'Modeli nuk ktheu asgjë të përdorshme',
  'error': 'Gabim i brendshëm',
};

export type HandoffReason =
  | 'asked-for-human' | 'complaint' | 'sensitive-topic' | 'custom-price' | 'low-confidence'
  | 'no-progress' | 'unsupported-language' | 'booking-failed' | 'manual';

export const HANDOFF_LABELS: Record<HandoffReason, string> = {
  'asked-for-human': 'Klienti kërkoi një person',
  'complaint': 'Ankesë / pakënaqësi',
  'sensitive-topic': 'Temë e ndjeshme (ligjore, rimbursim, të dhëna)',
  'custom-price': 'Kërkoi çmim të personalizuar / zbritje',
  'low-confidence': 'Agjentja nuk ishte e sigurt',
  'no-progress': 'Shumë kthesa pa përparim',
  'unsupported-language': 'Gjuhë që agjentja nuk e mbulon',
  'booking-failed': 'Rezervimi i takimit dështoi',
  'manual': 'E mori një person',
};

// ── Intents & the decision ──────────────────────────────────────────────────

export type SalesIntent =
  | 'greeting' | 'question' | 'answer' | 'price' | 'booking' | 'complaint' | 'human'
  | 'off-topic' | 'opt-out' | 'bot-check' | 'other';

export const SALES_INTENTS: readonly SalesIntent[] = [
  'greeting', 'question', 'answer', 'price', 'booking', 'complaint', 'human', 'off-topic', 'opt-out', 'bot-check', 'other',
];

/** Intents each autonomy level may SEND on its own (everything else becomes a draft or a handoff). */
export function allowedIntentsForAutonomy(level: SalesAgentAutonomy): ReadonlySet<SalesIntent> {
  switch (level) {
    case 0: return new Set();
    case 1: return new Set<SalesIntent>(['greeting', 'question', 'bot-check', 'off-topic']);
    case 2: return new Set<SalesIntent>(['greeting', 'question', 'answer', 'price', 'booking', 'bot-check', 'off-topic', 'other']);
    case 3: return new Set<SalesIntent>(['greeting', 'question', 'answer', 'price', 'booking', 'bot-check', 'off-topic', 'other']);
    default: return new Set();
  }
}

export const CONFIDENCE_SEND_MIN = 0.8;
export const CONFIDENCE_DRAFT_MIN = 0.4;

/** `\b` is ASCII-only in JS, so a word that ends in ë/ç never matches — use Unicode lookarounds instead. */
const wordRe = (alts: string): RegExp => new RegExp(`(?<!\\p{L})(?:${alts})(?!\\p{L})`, 'iu');
const HUMAN_RE = wordRe('njeri|person|operator|operatore|punonj[eë]s|dikush|me nj[eë] njeri|human|real person|agent|someone real|flas me|dua t[eë] flas');
const COMPLAINT_RE = wordRe('ankes[eë]|ankohem|i pak[eë]naqur|e pak[eë]naqur|skandal|turp|mashtrim|hajdut|rimbursim|refund|complaint|avokat|lawyer|gjykat[eë]?|padi|polici');
const SENSITIVE_RE = wordRe('kart[eë] krediti|kart[eë]s s[eë] kreditit|numri i kart[eë]s|iban|fjal[eë]kalim|password|pin|id personale|numri personal|nipt');
const BOT_RE = wordRe('je robot|jeni robot|bot|ai|inteligjenc[eë] artificiale|chatgpt|njeri apo|are you (?:a )?bot|robot');
const PRICE_CUSTOM_RE = wordRe('zbritje|ulje|oferta speciale|discount|negoci|m[eë] lir[eë]|çmim m[eë] t[eë] mir[eë]|cmim me te mire');

/** Deterministic triggers the model cannot override (checked on the CLIENT's text, before the model). */
export function detectHandoffTrigger(clientText: string): HandoffReason | null {
  const t = (clientText || '').trim();
  if (!t) return null;
  if (COMPLAINT_RE.test(t)) return 'complaint';
  if (SENSITIVE_RE.test(t)) return 'sensitive-topic';
  if (HUMAN_RE.test(t)) return 'asked-for-human';
  return null;
}

export const looksLikeBotCheck = (clientText: string): boolean => BOT_RE.test(clientText || '');
export const asksForCustomPrice = (clientText: string): boolean => PRICE_CUSTOM_RE.test(clientText || '');

/** The structured part of the model's answer. */
export interface AgentModelOutput {
  reply: string;
  intent: SalesIntent;
  confidence: number;
  /** Fields the client answered in THIS message (merged by `mergeCollected`). */
  collected: Partial<Record<QualificationFieldKey, string>>;
  /** True only when the reply's figures all come from the facts. */
  priceFromFacts: boolean;
  handoff: HandoffReason | null;
  language: string;
}

/** Robust JSON extraction: the model is asked for JSON, but a bare sentence must still become a draft. */
export function parseAgentOutput(raw: unknown): AgentModelOutput {
  const fallback = (reply: string): AgentModelOutput => ({
    reply: sanitizeAgentReply(reply), intent: 'other', confidence: 0.3, collected: {}, priceFromFacts: false, handoff: null, language: 'sq',
  });
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s) return { ...fallback(''), confidence: 0 };
  let obj: any = null;
  const tryParse = (txt: string) => { try { return JSON.parse(txt); } catch { return null; } };
  obj = tryParse(s);
  if (!obj) {
    const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
    if (fence) obj = tryParse(fence[1].trim());
  }
  if (!obj) {
    const a = s.indexOf('{'); const b = s.lastIndexOf('}');
    if (a >= 0 && b > a) obj = tryParse(s.slice(a, b + 1));
  }
  if (!obj || typeof obj !== 'object' || typeof obj.reply !== 'string') return fallback(s);
  const intent: SalesIntent = SALES_INTENTS.includes(obj.intent) ? obj.intent : 'other';
  const conf = typeof obj.confidence === 'number' && Number.isFinite(obj.confidence) ? Math.min(1, Math.max(0, obj.confidence)) : 0.5;
  const collected: Partial<Record<QualificationFieldKey, string>> = {};
  if (obj.collected && typeof obj.collected === 'object') {
    for (const k of QUALIFICATION_ORDER) {
      const v = obj.collected[k];
      if (typeof v === 'string' && v.trim()) collected[k] = v.trim().slice(0, 120);
    }
  }
  const handoff: HandoffReason | null = typeof obj.handoff === 'string' && obj.handoff in HANDOFF_LABELS ? (obj.handoff as HandoffReason) : null;
  return {
    reply: sanitizeAgentReply(obj.reply),
    intent,
    confidence: conf,
    collected,
    priceFromFacts: obj.priceFromFacts === true,
    handoff,
    language: typeof obj.language === 'string' && obj.language.length >= 2 ? obj.language.slice(0, 2).toLowerCase() : 'sq',
  };
}

/** ≤ 400 chars, no markdown, no leaked JSON, no trailing "— Ana" signature duplicates. */
export function sanitizeAgentReply(textIn: unknown): string {
  let t = typeof textIn === 'string' ? textIn : '';
  t = t.replace(/```[\s\S]*?```/g, ' ').replace(/[*_#>`]/g, '').replace(/\s*\n\s*\n+/g, '\n').replace(/[ \t]+/g, ' ').trim();
  if (t.length > SALES_AGENT_LIMITS.replyMaxChars) {
    const cut = t.slice(0, SALES_AGENT_LIMITS.replyMaxChars);
    const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '));
    t = (end > 120 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, '')).trim();
  }
  return t;
}

export type DeliveryMode = 'send' | 'draft' | 'handoff' | 'silent';

export interface DeliveryDecision {
  mode: DeliveryMode;
  blockReason: SalesAgentBlockReason | null;
  handoffReason: HandoffReason | null;
}

export interface DeliveryInput {
  settings: SalesAgentSettings;
  output: AgentModelOutput;
  /** Deterministic trigger from the client's text (before the model). */
  trigger: HandoffReason | null;
  clientText: string;
  insideOfficeHours: boolean;
  /** Minutes since the last STAFF (human) outbound message in this thread; null = never. */
  minutesSinceHumanReply: number | null;
  /** Minutes since the inbound we are answering. */
  minutesSinceInbound: number;
  turnsWithoutProgress: number;
  /** Whether this message collected anything new. */
  progressed: boolean;
}

/**
 * The one place that says SEND / DRAFT / HANDOFF. Order matters:
 *   deterministic triggers → model handoff → custom price → no-progress →
 *   autonomy 0 → inside-hours rule (level 1) → intent allow-list → confidence.
 */
export function decideDelivery(i: DeliveryInput): DeliveryDecision {
  const { settings: s, output: o } = i;
  const handoff = (handoffReason: HandoffReason): DeliveryDecision => ({ mode: 'handoff', blockReason: null, handoffReason });
  const draft = (blockReason: SalesAgentBlockReason): DeliveryDecision => ({ mode: 'draft', blockReason, handoffReason: null });

  if (i.trigger) return handoff(i.trigger);
  if (o.intent === 'complaint') return handoff('complaint');
  if (o.intent === 'human') return handoff('asked-for-human');
  if (o.handoff) return handoff(o.handoff);
  if (o.intent === 'opt-out') return { mode: 'silent', blockReason: 'opted-out', handoffReason: null };
  if (!s.persona.languages.includes(o.language) && o.language !== 'sq') return handoff('unsupported-language');
  if ((o.intent === 'price' && !o.priceFromFacts) || asksForCustomPrice(i.clientText)) return handoff('custom-price');
  const twp = i.progressed ? 0 : i.turnsWithoutProgress + 1;
  if (twp >= s.maxTurnsWithoutProgress) return handoff('no-progress');

  if (s.autonomy === 0) return draft('autonomy-draft');
  if (s.autonomy === 1 && i.insideOfficeHours) {
    const humanAround = i.minutesSinceHumanReply !== null && i.minutesSinceHumanReply < s.humanSilenceMinutes * 6;
    if (humanAround || i.minutesSinceInbound < s.humanSilenceMinutes) return draft('inside-hours-human');
  }
  if (!allowedIntentsForAutonomy(s.autonomy).has(o.intent)) return draft('intent-not-allowed');
  if (o.confidence < CONFIDENCE_DRAFT_MIN) return handoff('low-confidence');
  if (o.confidence < CONFIDENCE_SEND_MIN) return draft('low-confidence');
  if (!o.reply) return draft('empty');
  return { mode: 'send', blockReason: null, handoffReason: null };
}

// ── Pre-model gate ──────────────────────────────────────────────────────────

export interface GateInput {
  settings: SalesAgentSettings;
  channel: 'whatsapp' | 'email' | 'portal' | 'landingForm';
  hasAiKey: boolean;
  hasText: boolean;
  optedOut: boolean;
  isPerson: boolean;
  agentState: Pick<ConversationAgentLike, 'active' | 'stage' | 'lastReplyAt' | 'lastDraftAt'> | null;
  replyToAutomated: boolean;
  repliesToday: number;
  now: Date;
}

export interface ConversationAgentLike {
  active: boolean;
  stage: 'greeting' | 'qualifying' | 'proposing' | 'booking' | 'handoff' | 'closed';
  collected: Record<string, string>;
  turns: number;
  turnsWithoutProgress: number;
  lastReplyAt: Date | null;
  lastDraftAt: Date | null;
}

/** Everything that stops the agent BEFORE a model call (costs nothing). */
export function agentGateReason(i: GateInput): SalesAgentBlockReason | null {
  if (!i.settings.enabled) return 'module-off';
  if (!i.settings.channels[i.channel]) return 'channel-off';
  if (!i.isPerson) return 'not-a-person';
  if (!i.hasText) return 'no-text';
  if (i.optedOut) return 'opted-out';
  if (i.agentState && i.agentState.active === false && i.agentState.stage === 'handoff') return 'handoff-active';
  if (i.agentState && i.agentState.stage === 'closed') return 'closed';
  if (i.replyToAutomated) return 'reply-to-automated';
  if (!i.hasAiKey) return 'no-ai-key';
  if (i.repliesToday >= i.settings.dailyReplyCap) return 'daily-cap';
  const last = Math.max(i.agentState?.lastReplyAt?.getTime() ?? 0, i.agentState?.lastDraftAt?.getTime() ?? 0);
  if (last && i.now.getTime() - last < SALES_AGENT_LIMITS.burstMs) return 'burst';
  return null;
}

// ── Qualification state ─────────────────────────────────────────────────────

export interface QualificationProgress {
  answered: QualificationFieldKey[];
  missing: QualificationFieldKey[];
  qualified: boolean;
  nextQuestion: string | null;
  nextField: QualificationFieldKey | null;
}

export function mergeCollected(prev: Record<string, string> | null | undefined, add: Partial<Record<QualificationFieldKey, string>>): Record<string, string> {
  const out: Record<string, string> = { ...(prev || {}) };
  for (const k of QUALIFICATION_ORDER) {
    const v = add[k];
    if (typeof v === 'string' && v.trim()) out[k] = v.trim().slice(0, 120);
  }
  return out;
}

export function qualificationProgress(collected: Record<string, string> | null | undefined, fields: readonly QualificationFieldKey[]): QualificationProgress {
  const c = collected || {};
  const answered = fields.filter((f) => typeof c[f] === 'string' && c[f].trim().length > 0);
  const missing = fields.filter((f) => !answered.includes(f));
  const nextField = missing[0] ?? null;
  return {
    answered, missing,
    qualified: answered.length >= Math.min(QUALIFIED_MIN_FIELDS, fields.length),
    nextQuestion: nextField ? QUALIFICATION_FIELDS[nextField].question : null,
    nextField,
  };
}

export type AgentStage = ConversationAgentLike['stage'];

/** Stage transition after a turn. `handoff` wins; booking intent moves to booking only once qualified. */
export function nextStage(current: AgentStage, i: { decision: DeliveryDecision; intent: SalesIntent; progress: QualificationProgress; autonomy: SalesAgentAutonomy }): AgentStage {
  if (i.decision.mode === 'handoff') return 'handoff';
  if (current === 'closed') return 'closed';
  if (current === 'handoff') return 'handoff';
  if (i.autonomy < 2) return current === 'greeting' ? 'greeting' : current;
  if (i.intent === 'booking' && i.progress.qualified) return 'booking';
  if (current === 'booking') return 'booking';
  if (i.progress.qualified) return 'proposing';
  return 'qualifying';
}

/** 0–100: qualification completeness (60) + budget known (15) + timeline soon (15) + decision maker (10). */
export function leadAgentScore(collected: Record<string, string> | null | undefined, fields: readonly QualificationFieldKey[]): number {
  const c = collected || {};
  const p = qualificationProgress(c, fields);
  let score = Math.round((p.answered.length / Math.max(1, fields.length)) * 60);
  if (c.budget) score += 15;
  if (c.timeline && /\b(tani|sot|k[eë]t[eë] jav[eë]|k[eë]t[eë] muaj|menj[eë]her[eë]|urgjent|asap|now|this (week|month))\b/i.test(c.timeline)) score += 15;
  if (c.decisionMaker && /\b(po|un[eë]|jam un[eë]|vet[eë]|pronar|yes|me|owner|i am)\b/i.test(c.decisionMaker)) score += 10;
  return Math.min(100, score);
}

/** Three lines for the human, deterministic (no model). */
export function buildLeadSummary(name: string, collected: Record<string, string> | null | undefined): string {
  const c = collected || {};
  const line1 = `${name || 'Kontakti'} kërkon: ${c.service || 'shërbim i paspecifikuar'}${c.city ? ` (${c.city})` : ''}.`;
  const line2 = `Afati: ${c.timeline || 'i pacaktuar'} · Buxheti: ${c.budget || 'i pacaktuar'}.`;
  const line3 = `Vendimmarrësi: ${c.decisionMaker || 'i paqartë'}.`;
  return `${line1}\n${line2}\n${line3}`;
}

// ── Facts → prompt ──────────────────────────────────────────────────────────

export interface ServiceFact { name: string; category?: string | null; price?: number | null; currency?: string | null; unit?: string | null; description?: string | null; duration?: string | null; features?: string[] | null }
export interface KnowledgeFact { kind: 'faq' | 'objection' | 'policy' | 'service-note'; question: string; answer: string }

export interface SalesFacts {
  businessName: string;
  officeHours: string;
  services: ServiceFact[];
  knowledge: KnowledgeFact[];
  /** Free text from the owner (what we do, who we serve). Never a secret. */
  about: string;
}

export function renderSalesFacts(f: SalesFacts): string {
  const lines: string[] = [];
  lines.push(`BIZNESI: ${f.businessName || '—'}`);
  if (f.about) lines.push(`PËR NE: ${f.about.slice(0, 800)}`);
  lines.push(`ORARI: ${f.officeHours || '—'}`);
  if (f.services.length) {
    lines.push('SHËRBIMET DHE ÇMIMET (të vetmet shifra që mund të thuash):');
    for (const s of f.services.slice(0, 40)) {
      const price = typeof s.price === 'number' && s.price > 0 ? `${s.price} ${s.currency || 'EUR'}${s.unit ? `/${s.unit}` : ''}` : 'çmimi me ofertë';
      lines.push(`- ${s.name}${s.category ? ` [${s.category}]` : ''}: ${price}${s.description ? ` — ${s.description.slice(0, 140)}` : ''}`);
      if (s.duration) lines.push(`  · kohëzgjatja: ${s.duration.slice(0, 60)}`);
      const feats = (s.features || []).filter(Boolean).slice(0, 6);
      if (feats.length) lines.push(`  · përfshin: ${feats.map((x) => x.slice(0, 80)).join('; ')}`);
    }
  } else {
    lines.push('SHËRBIMET: (asnjë në katalog — mos thuaj çmime, ofro bisedë me kolegun)');
  }
  const byKind = (k: KnowledgeFact['kind'], title: string) => {
    const items = f.knowledge.filter((x) => x.kind === k).slice(0, 60);
    if (!items.length) return;
    lines.push(title);
    for (const it of items) lines.push(`- P: ${it.question.slice(0, 160)} → ${it.answer.slice(0, 300)}`);
  };
  byKind('faq', 'PYETJE TË SHPESHTA:');
  byKind('policy', 'POLITIKAT:');
  byKind('objection', 'SI U PËRGJIGJEMI OBJEKSIONEVE:');
  byKind('service-note', 'SHËNIME PËR SHËRBIMET:');
  return lines.join('\n');
}

export interface SalesPromptContext {
  settings: SalesAgentSettings;
  facts: SalesFacts;
  contactName: string;
  contactKind: 'lead' | 'customer' | 'unknown';
  leadStatus?: string | null;
  stage: AgentStage;
  collected: Record<string, string>;
  channel: 'whatsapp' | 'email' | 'portal' | 'landingForm';
  /** Local date/time label for the model ("e hënë, 3 nëntor 2026, 10:15"). */
  nowLabel: string;
  isFirstAgentMessage: boolean;
}

/**
 * The system prompt in two parts, for prompt caching (Anthropic):
 * - `stable`  = persona + hard rules + FACTS + JSON contract. Identical for every
 *   conversation of a tenant until the owner edits settings / catalogue /
 *   knowledge, so it is cached and re-read at ~10 % of the input price.
 * - `dynamic` = clock, channel, contact, stage, collected fields, this turn's hint.
 *   Changes on every call, so it goes AFTER the cache breakpoint. Never move
 *   anything volatile (time, names, ids) into `stable`: one changed byte there and
 *   every call becomes a cache write instead of a read.
 */
export function buildSalesAgentPromptParts(c: SalesPromptContext): { stable: string; dynamic: string } {
  const s = c.settings;
  const p = s.persona;
  const business = p.businessName || c.facts.businessName || 'biznesit';
  const progress = qualificationProgress(c.collected, s.qualificationFields);
  const tone = p.tone === 'formal' ? 'Ton formal, i përmbajtur, "ju".' : 'Ton i ngrohtë dhe profesional, "ju"; pa emoji përveç kur klienti i përdor.';
  const langs = p.languages.join(', ');
  const allowed = [...allowedIntentsForAutonomy(s.autonomy)].join(', ') || 'asnjë (vetëm draft)';
  const collectedLines = Object.entries(c.collected).map(([k, v]) => `- ${QUALIFICATION_FIELDS[k as QualificationFieldKey]?.label || k}: ${v}`).join('\n') || '- (asgjë ende)';
  const stageHint = (() => {
    if (s.autonomy < 2) return 'Përgjigju pyetjes së klientit; MOS bëj pyetje kualifikimi.';
    if (c.stage === 'booking') return `Propozo takim ${s.meeting.durationMin} min; pyet cila orë i përshtatet.`;
    if (progress.qualified) return 'Klienti është i kualifikuar: përmblidh çfarë kuptove dhe propozo një takim të shkurtër me kolegun.';
    return `Mblidh me natyrshmëri fushën tjetër: ${progress.nextField ? QUALIFICATION_FIELDS[progress.nextField].label : '—'} ("${progress.nextQuestion || ''}"). NJË pyetje për mesazh.`;
  })();
  const stable = [
    `Ti je ${p.name}, asistentja virtuale e shitjeve e ${business}. Punon në FivoCRM.`,
    `Gjuhët: ${langs}. Përgjigju në gjuhën e klientit (default shqip). ${tone}`,
    '',
    'RREGULLA TË PANEGOCIUESHME:',
    '1. Je asistente virtuale, jo njeri. Nëse të pyesin a je robot/AI, thuaj sinqerisht që je asistente virtuale dhe ofro një koleg.',
    '2. Shifrat (çmime, afate, zbritje) VETËM nga FAKTET më poshtë. Nëse fakti mungon: thuaj "këtë ua konfirmon kolegu im" dhe vendos handoff "custom-price". KURRË mos shpik çmim, mos premto afat, mos jep zbritje.',
    '3. Mos komento konkurrentët. Mos kërko të dhëna sensitive (karta, ID, fjalëkalime).',
    '4. Maksimumi 400 karaktere, NJË pyetje për mesazh, pa markdown, pa lista.',
    '5. Kur klienti ankohet, kërkon njeri, flet për ligj/rimbursim — handoff menjëherë me një fjali të sjellshme.',
    `6. Intent-et që mund t'i dërgosh vetë në këtë nivel: ${allowed}. Për të tjerat përgjigju normalisht — sistemi vendos nëse dërgohet.`,
    '',
    'FAKTET:',
    renderSalesFacts(c.facts),
    '',
    'FORMATI I PËRGJIGJES — VETËM JSON, pa tekst tjetër:',
    '{"reply": "teksti për klientin", "intent": "greeting|question|answer|price|booking|complaint|human|off-topic|opt-out|bot-check|other", "confidence": 0.0-1.0, "collected": {"service"?: "...", "city"?: "...", "timeline"?: "...", "budget"?: "...", "decisionMaker"?: "..."}, "priceFromFacts": true|false, "handoff": null|"asked-for-human"|"complaint"|"sensitive-topic"|"custom-price"|"low-confidence"|"unsupported-language", "language": "sq"}',
    '"collected" përmban VETËM fushat që klienti i tha në këtë mesazh. "confidence" = sa e sigurt je që përgjigja është e saktë dhe e mjaftueshme.',
  ].join('\n');
  const dynamic = [
    'GJENDJA E KËSAJ BISEDE:',
    `Sot: ${c.nowLabel}. Kanali: ${c.channel}.`,
    ...(c.isFirstAgentMessage ? [`Ky është mesazhi yt i parë këtu. Prezantohu në fjalinë e parë: "${p.name}, asistentja virtuale e ${business}".`] : []),
    `KONTAKTI: ${c.contactName || 'i panjohur'} (${c.contactKind}${c.leadStatus ? `, statusi ${c.leadStatus}` : ''}). Faza: ${c.stage}.`,
    'TË MBLEDHURA DERI TANI:',
    collectedLines,
    `UDHËZIM PËR KËTË KTHESË: ${stageHint}`,
  ].join('\n');
  return { stable, dynamic };
}

/** The whole system prompt as one string (audit copy on the run doc, non-caching providers). */
export function buildSalesAgentPrompt(c: SalesPromptContext): string {
  const { stable, dynamic } = buildSalesAgentPromptParts(c);
  return `${stable}\n\n${dynamic}`;
}

/** Guarantees the disclosure on the FIRST agent message of a thread (law 8), without doubling it. */
export function ensureDisclosure(reply: string, persona: SalesAgentPersona, businessName: string, isFirstAgentMessage: boolean): string {
  const r = (reply || '').trim();
  if (!isFirstAgentMessage) return r;
  const hasName = r.toLowerCase().includes(persona.name.toLowerCase());
  const hasVirtual = /virtual/i.test(r);
  if (hasName && hasVirtual) return r;
  // The name the owner typed for the persona wins; the tenant/team name in FivoCRM
  // ("Agjencia") is only the fallback when the persona field is empty.
  const biz = persona.businessName || businessName;
  const intro = `Jam ${persona.name}, asistentja virtuale e ${biz || 'ekipit'}.`;
  return sanitizeAgentReply(`${intro} ${r}`);
}

// ── Templates & cold WhatsApp ───────────────────────────────────────────────

/** `{{token}}` → value; an unknown or empty token renders EMPTY (never leak `{{foo}}`). */
export function renderTemplate(tpl: string, vars: Record<string, string | null | undefined>): string {
  return (tpl || '')
    .replace(/\{\{\s*([a-zA-Z_][\w.]*)\s*\}\}/g, (_, k: string) => (vars[k] ?? '').toString().trim())
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,.;!?])/g, '$1')
    .trim();
}

export const COLD_WA_OPT_OUT_LINE = 'Nëse nuk dëshironi mesazhe të tjera, shkruani NDALO.';

/** A cold message must disclose the agent and offer the exit. Appended/prepended only when missing. */
export function ensureColdWaCompliance(textIn: string, persona: SalesAgentPersona): string {
  let t = (textIn || '').trim();
  const biz = persona.businessName || 'ekipit';
  if (!t.toLowerCase().includes(persona.name.toLowerCase()) || !/virtual/i.test(t)) {
    t = `Përshëndetje! Jam ${persona.name}, asistentja virtuale e ${biz}. ${t}`;
  }
  if (!/\bNDALO\b/i.test(t)) t = `${t}\n\n${COLD_WA_OPT_OUT_LINE}`;
  return t.trim();
}

export type ColdWaBlockReason =
  | 'cold-wa-off' | 'cold-wa-paused' | 'no-sender' | 'no-phone' | 'not-on-whatsapp' | 'opted-out'
  | 'already-contacted' | 'same-day-registration' | 'weekend' | 'outside-window' | 'quota-reached' | 'min-gap' | 'budget-exhausted';

export const COLD_WA_BLOCK_LABELS: Record<ColdWaBlockReason, string> = {
  'cold-wa-off': 'Mesazhet e ftohta WhatsApp janë të fikura',
  'cold-wa-paused': 'Në pauzë automatike pas bllokimeve (7 ditë)',
  'no-sender': 'Asnjë numër WhatsApp i lidhur për dërgim',
  'no-phone': 'Prospekti nuk ka telefon',
  'not-on-whatsapp': 'Numri nuk është në WhatsApp',
  'opted-out': 'Kontakti ka kërkuar NDALO',
  'already-contacted': 'U kontaktua tashmë',
  'same-day-registration': 'U regjistrua sot — kontaktohet nga nesër',
  'weekend': 'Fundjavë — vetëm ditët e punës',
  'outside-window': 'Jashtë dritares së dërgimit',
  'quota-reached': 'Kuota ditore e numrit u arrit',
  'min-gap': 'Duhet të kalojë ≥ 1 orë nga dërgimi i fundit',
  'budget-exhausted': 'Kuota e dërgimeve është 0 (warm-up / bllokime)',
};

export interface ColdWaQuotaInput {
  settings: ColdWaSettings;
  /** When this sender number first sent a cold message; null = never (fresh). */
  senderWarmupStartedAt: Date | null;
  /** Blocks/failures attributed to this sender in the last 24h. */
  failures24h: number;
  now: Date;
}

/** Daily quota for a sender: warm-up cap for a young number; halved after 1 failure, 0 (pause) after 2+. */
export function coldWaDailyQuota(i: ColdWaQuotaInput): number {
  const s = i.settings;
  let quota = s.perDay;
  const ageDays = i.senderWarmupStartedAt ? (i.now.getTime() - i.senderWarmupStartedAt.getTime()) / 86_400_000 : 0;
  if (ageDays < s.warmupDays) quota = Math.min(quota, s.warmupPerDay);
  if (i.failures24h >= 2) return 0;
  if (i.failures24h === 1) quota = Math.floor(quota / 2);
  return Math.max(0, quota);
}

export interface ColdWaGateInput extends ColdWaQuotaInput {
  timeZone: string;
  senderAgentId: string | null;
  pausedUntil: Date | null;
  sentTodayBySender: number;
  lastSentAtBySender: Date | null;
  prospect: {
    phone: string | null;
    waVerified: boolean | null;
    optedOut: boolean;
    registeredAt: Date | null;
    contactedAt: Date | null;
  };
}

/** Law 7 in one function. Order: config → sender → prospect → calendar → quota → gap. */
export function coldWaBlockReason(i: ColdWaGateInput): ColdWaBlockReason | null {
  const s = i.settings;
  if (!s.enabled) return 'cold-wa-off';
  if (i.pausedUntil && i.pausedUntil.getTime() > i.now.getTime()) return 'cold-wa-paused';
  if (!i.senderAgentId) return 'no-sender';
  const p = i.prospect;
  if (!p.phone) return 'no-phone';
  if (p.waVerified === false) return 'not-on-whatsapp';
  if (p.optedOut) return 'opted-out';
  if (p.contactedAt) return 'already-contacted';
  const lp = localParts(i.now, i.timeZone);
  if (p.registeredAt && localParts(p.registeredAt, i.timeZone).date === lp.date) return 'same-day-registration';
  if (s.weekdaysOnly && (lp.weekday === 0 || lp.weekday === 6)) return 'weekend';
  if (!inWindow(lp.hhmm, s.hoursFrom, s.hoursTo)) return 'outside-window';
  const quota = coldWaDailyQuota(i);
  if (quota === 0) return 'budget-exhausted';
  if (i.sentTodayBySender >= quota) return 'quota-reached';
  if (i.lastSentAtBySender && i.now.getTime() - i.lastSentAtBySender.getTime() < s.minGapMinutes * 60_000) return 'min-gap';
  return null;
}

/** After a cold send fails with a block-like error: when should the sender pause? */
export function coldWaPauseAfterFailure(failures24hIncludingThis: number, now: Date): Date | null {
  if (failures24hIncludingThis < 2) return null;
  return new Date(now.getTime() + SALES_AGENT_LIMITS.coldWaPauseDays * 86_400_000);
}

// ── Nudges, handoff SLA, digest ─────────────────────────────────────────────

export type NudgeBlockReason = 'not-qualifying' | 'agent-inactive' | 'max-nudges' | 'too-soon' | 'client-replied' | 'quiet-hours';

export interface NudgeInput {
  settings: SalesAgentSettings;
  agent: ConversationAgentLike & { nudgesSent?: number; lastNudgeAt?: Date | null };
  lastInboundAt: Date | null;
  lastOutboundAt: Date | null;
  now: Date;
  timeZone: string;
}

/** A silent prospect in `qualifying` gets at most `maxNudges`, each ≥ `nudgeAfterHours` after the last outbound, inside office hours. */
export function nudgeBlockReason(i: NudgeInput): NudgeBlockReason | null {
  const a = i.agent;
  if (!a.active) return 'agent-inactive';
  if (a.stage !== 'qualifying' && a.stage !== 'booking') return 'not-qualifying';
  if ((a.nudgesSent || 0) >= i.settings.maxNudges) return 'max-nudges';
  const lastOut = Math.max(i.lastOutboundAt?.getTime() ?? 0, a.lastNudgeAt?.getTime() ?? 0);
  if (i.lastInboundAt && lastOut && i.lastInboundAt.getTime() > lastOut) return 'client-replied';
  if (!lastOut || i.now.getTime() - lastOut < i.settings.nudgeAfterHours * 3_600_000) return 'too-soon';
  const lp = localParts(i.now, i.timeZone);
  if (lp.weekday === 0 || lp.weekday === 6 || !inWindow(lp.hhmm, i.settings.officeFrom, i.settings.officeTo)) return 'quiet-hours';
  return null;
}

export function buildNudgeText(persona: SalesAgentPersona, contactName: string, nudgeIndex: number, progress: QualificationProgress): string {
  const name = contactName ? ` ${contactName.split(' ')[0]}` : '';
  if (nudgeIndex === 0) {
    return progress.nextQuestion
      ? `Përshëndetje${name}, ${persona.name} këtu. Vetëm për të vazhduar bisedën: ${progress.nextQuestion.charAt(0).toLowerCase()}${progress.nextQuestion.slice(1)}`
      : `Përshëndetje${name}, ${persona.name} këtu. A dëshironi të vazhdojmë bisedën kur t'ju vijë mirë?`;
  }
  return `Përshëndetje${name}, nuk dua t'ju bezdis — nëse momenti nuk është i duhuri, më shkruani kur të jetë. Ju uroj ditë të mbarë!`;
}

export function handoffOverdue(handoffAt: Date | null, resumedAt: Date | null, slaMinutes: number, now: Date): boolean {
  if (!handoffAt || resumedAt) return false;
  return now.getTime() - handoffAt.getTime() > slaMinutes * 60_000;
}

export interface SalesDigestFacts {
  date: string;
  prospectsNew: number;
  prospectsRegistered: number;
  conversationsHeld: number;
  qualified: Array<{ name: string; summary: string }>;
  meetingsBooked: number;
  handoffsOpen: Array<{ name: string; reason: HandoffReason; minutesOpen: number }>;
  coldWaSent: number;
  coldEmailSent: number;
  blocked: Partial<Record<SalesAgentBlockReason | ColdWaBlockReason, number>>;
  aiCalls: number;
  placesRequests: number;
}

/** Deterministic morning digest. `null` = nothing happened → silence (never "asgjë sot"). */
export function buildSalesDigest(f: SalesDigestFacts, persona: SalesAgentPersona): string | null {
  const any = f.prospectsNew + f.prospectsRegistered + f.conversationsHeld + f.qualified.length + f.meetingsBooked + f.handoffsOpen.length + f.coldWaSent + f.coldEmailSent;
  if (!any) return null;
  const lines: string[] = [`📣 ${persona.name} — dje në shitje`];
  if (f.handoffsOpen.length) {
    lines.push(`⚠️ ${f.handoffsOpen.length} bisedë(a) presin një person:`);
    for (const h of f.handoffsOpen.slice(0, 5)) lines.push(`   • ${h.name} — ${HANDOFF_LABELS[h.reason]} (${Math.round(h.minutesOpen / 60)} orë)`);
  }
  if (f.qualified.length) {
    lines.push(`✅ ${f.qualified.length} lead të kualifikuar:`);
    for (const q of f.qualified.slice(0, 5)) lines.push(`   • ${q.name}: ${q.summary.split('\n')[0]}`);
  }
  if (f.meetingsBooked) lines.push(`📅 ${f.meetingsBooked} takim(e) të rezervuara`);
  if (f.conversationsHeld) lines.push(`💬 ${f.conversationsHeld} biseda të mbajtura`);
  if (f.prospectsNew || f.prospectsRegistered) lines.push(`🔎 ${f.prospectsNew} prospekte të reja · ${f.prospectsRegistered} të regjistruara si lead`);
  if (f.coldWaSent || f.coldEmailSent) lines.push(`✉️ Kontakt i parë: ${f.coldWaSent} WhatsApp · ${f.coldEmailSent} email`);
  const blockedTotal = Object.values(f.blocked).reduce((a, b) => a + (b || 0), 0);
  if (blockedTotal) {
    const top = Object.entries(f.blocked).sort((a, b) => (b[1] || 0) - (a[1] || 0)).slice(0, 3)
      .map(([k, v]) => `${(SALES_AGENT_BLOCK_LABELS as Record<string, string>)[k] || (COLD_WA_BLOCK_LABELS as Record<string, string>)[k] || k} ×${v}`);
    lines.push(`⏸ Nuk veprova ${blockedTotal} herë: ${top.join('; ')}`);
  }
  lines.push(`💰 ${f.aiCalls} thirrje AI · ${f.placesRequests} kërkesa Places`);
  return lines.join('\n');
}

// ── Ids ─────────────────────────────────────────────────────────────────────

export const salesAgentRunId = (businessId: string, kind: string, entityId: string, key: string): string =>
  `${businessId}_${kind}_${entityId}_${key}`.replace(/[^A-Za-z0-9_\-:.]/g, '-').slice(0, 1400);

export const salesDigestDocId = (businessId: string, dateKey: string): string => `${businessId}_${dateKey}`;
