/**
 * Department (position) daily-report templates.
 *
 * A SEO expert should report different numbers than an Ads or Design person. These
 * are ready-made, fixed question sets keyed by the member's `position` (already on
 * TeamMember). Pure data + helpers — no React.
 *
 * ── Why every template follows the same four movements ──────────────────────────
 *
 * The first version of this file asked each craft for a handful of counters, and a
 * counter is exactly the thing a CEO cannot act on: "backlinks: 5" says nothing about
 * which client got them, whether they helped, or what happens tomorrow. So each
 * template now runs Output → Impakt → Rrezik → Hapi tjetër:
 *
 *   output  — what came out, tied to the client wherever the work is client work
 *   impact  — what changed because of it (the question people skip when not asked)
 *   risk    — what could break, surfaced on the day it appears rather than the day
 *             it explodes
 *   next    — the concrete next move, which is also tomorrow's plan
 *
 * `perClient: true` marks a field asked once per client TOUCHED TODAY — the client
 * list is derived from the day's answered tasks (see dailyReportPlan.ts), never typed
 * again by hand. Those answers are stored under `"<key>.<customerId>"` inside the same
 * flat `customFields` record, so nothing about the stored shape changed and every
 * existing report still reads.
 *
 * Field keys are permanent: an existing key keeps its meaning so historical
 * `customFields` keep aggregating in the weekly totals. Add, don't rename.
 */

export type ReportFieldType = 'text' | 'number' | 'textarea' | 'url' | 'select';

/** The four movements, in the order they are rendered. */
export type ReportFieldKind = 'output' | 'impact' | 'risk' | 'next';

export const FIELD_KINDS: Array<{ key: ReportFieldKind; label: string; hint: string }> = [
  { key: 'output', label: 'Output',      hint: 'Çfarë doli konkretisht sot' },
  { key: 'impact', label: 'Impakt',      hint: 'Çfarë ndryshoi për klientin' },
  { key: 'risk',   label: 'Rrezik',      hint: 'Çfarë mund të prishet' },
  { key: 'next',   label: 'Hapi tjetër', hint: 'Çfarë ndodh nesër me këtë' },
];

export interface ReportField {
  key: string;
  label: string;
  type: ReportFieldType;
  /** Which movement this belongs to. Defaults to `output` for legacy fields. */
  kind?: ReportFieldKind;
  placeholder?: string;
  unit?: string;         // shown after the value (e.g. "€")
  summable?: boolean;    // numeric fields that make sense to sum over a week
  /** Blocks submission when empty. Used sparingly — see dailyReportQuality.ts. */
  required?: boolean;
  /** Minimum length for text/textarea answers, so "ok" cannot pass as an answer. */
  minChars?: number;
  /** Asked once per client touched today; stored as `"<key>.<customerId>"`. */
  perClient?: boolean;
  /** Choices for `type: 'select'`. */
  options?: string[];
}

export interface ReportTemplate {
  key: string;           // normalized position
  label: string;         // display name
  emoji: string;
  fields: ReportField[];
}

// ── tiny builders, so a template reads as its questions and not as punctuation ──
const N = (key: string, label: string, kind: ReportFieldKind = 'output', extra: Partial<ReportField> = {}): ReportField =>
  ({ key, label, type: 'number', kind, summable: true, ...extra });
const T = (key: string, label: string, kind: ReportFieldKind, extra: Partial<ReportField> = {}): ReportField =>
  ({ key, label, type: 'text', kind, ...extra });
const A = (key: string, label: string, kind: ReportFieldKind, extra: Partial<ReportField> = {}): ReportField =>
  ({ key, label, type: 'textarea', kind, ...extra });
const U = (key: string, label: string, kind: ReportFieldKind = 'output', extra: Partial<ReportField> = {}): ReportField =>
  ({ key, label, type: 'url', kind, placeholder: 'https://…', ...extra });
const S = (key: string, label: string, kind: ReportFieldKind, options: string[], extra: Partial<ReportField> = {}): ReportField =>
  ({ key, label, type: 'select', kind, options, ...extra });

export const REPORT_TEMPLATES: ReportTemplate[] = [
  {
    key: 'seo', label: 'SEO', emoji: '🔍',
    fields: [
      N('pagesOptimized', 'Faqe/URL të optimizuara', 'output', { perClient: true }),
      U('optimizedUrls', 'Linket e faqeve të prekura', 'output', { perClient: true }),
      N('backlinks', 'Backlinks të ndërtuar', 'output', { perClient: true }),
      N('backlinkQuality', 'Cilësia mesatare e tyre (DR)', 'output', { summable: false }),
      N('technicalFixes', 'Rregullime teknike', 'output'),
      T('technicalFixNotes', 'Çfarë ishin', 'output', { placeholder: 'p.sh. redirect chains, sitemap, Core Web Vitals' }),
      N('top3', 'Fjalë kyçe që hynë në top-3', 'impact'),
      N('top10', 'Fjalë kyçe që hynë në top-10', 'impact'),
      // Key kept from the first version so old reports keep their answer, but the
      // question changed from "shënime" to the one a CEO actually needs.
      A('rankingNotes', 'Çfarë do lëvizë renditjen muajin tjetër', 'impact', {
        required: true, minChars: 30,
        placeholder: 'Lidhe me punën e sotme — jo plan i përgjithshëm.',
      }),
      T('seoBlockers', 'Çfarë e ngadalëson progresin te ky klient', 'risk', { perClient: true }),
      T('nextStep', 'Hapi tjetër konkret nesër', 'next', { required: true }),
    ],
  },
  {
    key: 'ads', label: 'Ads / PPC', emoji: '🎯',
    fields: [
      N('campaigns', 'Fushata të menaxhuara', 'output'),
      N('adSpend', 'Shpenzim sot', 'output', { unit: '€', perClient: true }),
      N('leads', 'Leads të gjeneruara', 'output', { perClient: true }),
      A('changesMade', 'Ndryshimet që bëra sot', 'output', {
        required: true, minChars: 25,
        placeholder: 'p.sh. ndala ad-set-in me CPL 6€, dyfishova buxhetin e krijimtarisë B',
      }),
      N('cpl', 'CPL', 'impact', { unit: '€', summable: false }),
      N('roas', 'ROAS', 'impact', { summable: false }),
      N('conversions', 'Konvertime', 'impact'),
      T('campaignAtRisk', 'Fushatë në rrezik + arsyeja', 'risk', {
        placeholder: 'p.sh. Klienti A — CPL u trefishua pas ndryshimit të faqes',
      }),
      T('budgetRemaining', 'Buxheti i mbetur / kur mbaron', 'risk', { required: true }),
      T('nextStep', 'Çfarë do ndryshoj nesër', 'next', { required: true }),
    ],
  },
  {
    key: 'social', label: 'Social Media', emoji: '📱',
    fields: [
      N('posts', 'Postime', 'output', { perClient: true }),
      N('reels', 'Reels / Video', 'output', { perClient: true }),
      N('stories', 'Stories', 'output', { perClient: true }),
      N('reach', 'Reach', 'impact'),
      N('engagement', 'Engagement', 'impact'),
      N('newFollowers', 'Ndjekës të rinj', 'impact'),
      A('whatWorked', 'Çfarë funksionoi më mirë sot dhe pse', 'impact', {
        placeholder: 'Një fjali — kjo është ajo që përsëritet javën tjetër.',
      }),
      N('unansweredMessages', 'Komente/mesazhe pa përgjigje', 'risk', { required: true }),
      T('missingMaterials', 'Materialet që mungojnë nga klienti', 'risk', { perClient: true }),
      S('tomorrowCalendarReady', 'A është gati kalendari i nesërm', 'next',
        ['Po', 'Pjesërisht', 'Jo'], { required: true }),
    ],
  },
  {
    key: 'design', label: 'Design', emoji: '🎨',
    fields: [
      N('designs', 'Dizajne të përfunduara', 'output', { perClient: true }),
      N('revisions', 'Rishikime', 'output'),
      U('assetsLink', 'Link i materialeve', 'output', {
        required: true, placeholder: 'Drive, Figma ose folderi i klientit',
      }),
      T('campaignUse', 'Për cilën fushatë/kanal shkojnë', 'impact'),
      T('awaitingApproval', 'Çfarë pret aprovim', 'risk', { perClient: true }),
      T('nextStep', 'Çfarë dorëzoj nesër', 'next', { required: true }),
    ],
  },
  {
    key: 'dev', label: 'Development', emoji: '💻',
    fields: [
      N('features', 'Features/detyra të dorëzuara', 'output'),
      U('prLink', 'Link PR / deploy', 'output', { required: true, placeholder: 'https://github.com/…/pull/…' }),
      N('bugsFixed', 'Bug-e të rregulluar', 'output'),
      T('userImpact', 'Çfarë u përmirësua për përdoruesin', 'impact', {
        placeholder: 'Në gjuhë njerëzore, jo emra funksionesh.',
      }),
      S('readyForProd', 'A është gati për prodhim', 'impact', ['Po', 'Pas review', 'Jo']),
      T('releaseBlockers', 'Çfarë bllokon release-in', 'risk'),
      A('techDebt', 'Borxh teknik i hasur sot', 'risk', {
        placeholder: 'Shkruaje sot ose harrohet përgjithmonë.',
      }),
      T('nextStep', 'Çfarë marr nesër', 'next', { required: true }),
    ],
  },
  {
    key: 'content', label: 'Content', emoji: '✍️',
    fields: [
      N('articles', 'Artikuj/tekste të shkruar', 'output', { perClient: true }),
      N('words', 'Fjalë të shkruara', 'output'),
      T('topics', 'Tema të mbuluara', 'output'),
      T('publishTarget', 'Ku publikohet dhe çfarë synon', 'impact', {
        required: true, placeholder: 'p.sh. blogu i Klientit A — fjala kyçe "çmim paneli diellor"',
      }),
      T('awaitingApproval', 'Çfarë pret aprovim', 'risk', { perClient: true }),
      T('nextStep', 'Çfarë shkruaj nesër', 'next', { required: true }),
    ],
  },
  {
    key: 'sales', label: 'Sales', emoji: '📞',
    fields: [
      N('calls', 'Telefonata', 'output'),
      N('meetings', 'Takime', 'output'),
      N('proposals', 'Propozime të dërguara', 'output'),
      N('pipelineMoved', 'Vlera e pipeline-it të lëvizur', 'impact', { unit: '€' }),
      N('dealsWon', 'Marrëveshje të fituara', 'impact'),
      // The single most expensive piece of information an agency throws away daily.
      T('dealsLostReason', 'Të humbura + arsyeja e vërtetë', 'impact', {
        required: true, placeholder: 'Çmim, kohë, konkurrent, heshtje — ose "asnjë".',
      }),
      N('overdueFollowUps', 'Follow-up të vonuar', 'risk'),
      T('coolingDeal', 'Marrëveshja që rrezikon të ftohet', 'risk'),
      T('nextStep', 'Kë kontaktoj nesër', 'next', { required: true }),
    ],
  },
  // Web DESIGN is its own craft, not a flavour of development. It used to fall through
  // the `web → dev` synonym, so a designer was asked about bugs fixed and technical
  // notes instead of screens, prototypes and revision rounds.
  {
    key: 'web', label: 'Web Design', emoji: '🖥️',
    fields: [
      N('pagesDesigned', 'Faqe/seksione të dorëzuara', 'output', { perClient: true }),
      U('previewLink', 'Link i preview-t', 'output', {
        required: true, placeholder: 'Figma, staging ose shared link',
      }),
      N('prototypes', 'Prototipe/wireframe', 'output'),
      N('revisions', 'Raunde revizioni', 'output'),
      S('handedToDev', 'A kaloi te zhvillimi', 'impact', ['Po', 'Pjesërisht', 'Jo']),
      T('userProblemSolved', 'Çfarë u zgjidh për përdoruesin', 'impact', {
        placeholder: 'p.sh. formulari u shkurtua nga 9 fusha në 4',
      }),
      T('awaitingFromClient', 'Çfarë pres nga klienti', 'risk', {
        perClient: true, placeholder: 'p.sh. tekstet e shërbimeve, fotot e ekipit',
      }),
      T('nextRound', 'Raundi i radhës — çfarë dhe kur', 'next', { required: true }),
    ],
  },
  {
    key: 'photo-video', label: 'Foto & Video', emoji: '🎥',
    fields: [
      N('shoots', 'Seanca xhirimi/fotografimi', 'output', { perClient: true }),
      N('photosEdited', 'Foto të përpunuara', 'output'),
      N('videosEdited', 'Video të montuara', 'output'),
      N('footageMinutes', 'Minuta material të xhiruar', 'output', { unit: 'min' }),
      U('deliveryLink', 'Link i dorëzimit', 'output', { placeholder: 'Drive / WeTransfer' }),
      T('clientCampaign', 'Për cilin klient dhe cilën fushatë', 'impact', { required: true }),
      A('notShot', 'Çfarë mbeti pa xhiruar dhe pse', 'risk', {
        placeholder: 'Moti, lokacioni, mungesa e personazhit…',
      }),
      T('nextStep', 'Çfarë xhiroj/montoj nesër', 'next', { required: true }),
    ],
  },
  {
    key: 'regjia', label: 'Regjia', emoji: '🎬',
    fields: [
      N('scripts', 'Skenarë/koncepte', 'output', { perClient: true }),
      N('storyboards', 'Storyboard-e', 'output'),
      N('shootsDirected', 'Xhirime të drejtuara', 'output'),
      N('castingSessions', 'Takime kastingu/lokacioni', 'output'),
      S('conceptApproved', 'A u aprovua koncepti', 'impact',
        ['Po', 'Me ndryshime', 'Jo', 'Ende në pritje'], { required: true }),
      T('shootRisk', 'Çfarë rrezikon datën e xhirimit', 'risk'),
      T('nextDecision', 'Vendimi që duhet marrë nesër', 'next', { required: true }),
    ],
  },
  // Not everyone who logs in delivers client work. Once declaring a position became
  // mandatory, an owner/manager/accountant with no honest option would have had to
  // claim a craft they don't practise — and would then be asked about backlinks for
  // the rest of their life. Their day is coordination, so that is what it asks about.
  {
    key: 'management', label: 'Menaxhim / Administratë', emoji: '🧭',
    fields: [
      N('meetings', 'Takime', 'output'),
      N('decisions', 'Vendime të marra', 'output'),
      N('blockersRemoved', 'Pengesa të hequra ekipit', 'output'),
      N('clientsContacted', 'Klientë të kontaktuar', 'output', { perClient: true }),
      T('decisionImpact', 'Cili vendim ndryshoi diçka sot', 'impact'),
      A('portfolioRisks', 'Rreziqet e portofolit', 'risk', {
        required: true, minChars: 30,
        placeholder: 'Klientë të pakënaqur, projekte pa përparim, ngarkesë e çekuilibruar.',
      }),
      T('whoNeedsHelp', 'Kush ka nevojë për ndihmë nesër', 'next', { required: true }),
    ],
  },
];

/**
 * The crafts a member can hold, in the order they appear in the picker.
 *
 * This IS the report-template registry — deliberately not a second list. A position
 * and the daily-report questions that position is asked are the same decision, so a
 * separate catalogue would drift the moment someone added a role here and forgot the
 * template (which is exactly how Regjia and Foto&Video ended up with blank daily
 * reports: they existed as job titles in people's heads but nowhere in the code).
 */
export function positionOptions(): Array<{ key: string; label: string; emoji: string }> {
  return REPORT_TEMPLATES.map((t) => ({ key: t.key, label: t.label, emoji: t.emoji }));
}

/** Human label for a stored position key ('web' → 'Web Design'). */
export function positionLabel(key?: string | null): string | null {
  const norm = normalizeServiceLine(key);
  if (!norm) return null;
  const t = TEMPLATE_BY_KEY.get(norm);
  return t ? `${t.emoji} ${t.label}` : null;
}

const TEMPLATE_BY_KEY = new Map(REPORT_TEMPLATES.map((t) => [t.key, t]));

// Synonyms → normalized template key (Albanian + English variants).
const SYNONYMS: Record<string, string> = {
  seo: 'seo', 'search engine optimization': 'seo',
  ads: 'ads', ppc: 'ads', 'google ads': 'ads', 'meta ads': 'ads', reklama: 'ads', 'paid ads': 'ads',
  social: 'social', 'social media': 'social', smm: 'social', 'rrjete sociale': 'social', 'rrjetet sociale': 'social',
  design: 'design', graphic: 'design', 'graphic design': 'design', grafik: 'design', dizajn: 'design',
  // `web` used to alias to `dev`. It is now its own craft (Web Design); development
  // keeps the programming variants.
  dev: 'dev', development: 'dev', 'web development': 'dev', programim: 'dev', zhvillim: 'dev',
  web: 'web', 'web design': 'web', 'ux': 'web', 'ui': 'web', 'ui/ux': 'web', 'dizajn web': 'web',
  'photo-video': 'photo-video', photo: 'photo-video', video: 'photo-video', 'foto video': 'photo-video',
  'foto/video': 'photo-video', 'foto & video': 'photo-video', foto: 'photo-video', montazh: 'photo-video',
  regjia: 'regjia', regji: 'regjia', director: 'regjia', directing: 'regjia', 'film director': 'regjia',
  management: 'management', menaxhim: 'management', menaxher: 'management', administrate: 'management',
  administration: 'management', admin: 'management', 'project management': 'management',
  content: 'content', 'content writing': 'content', copywriting: 'content', permbajtje: 'content', përmbajtje: 'content',
  sales: 'sales', shitje: 'sales', 'sales agent': 'sales',
};

/** Normalize a raw serviceLine string to a template key, or null if unknown. */
export function normalizeServiceLine(raw?: string | null): string | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase();
  if (TEMPLATE_BY_KEY.has(s)) return s;
  return SYNONYMS[s] || null;
}

/** Get the report template for a serviceLine, or null (→ standard fields only). */
export function getReportTemplate(serviceLine?: string | null): ReportTemplate | null {
  const key = normalizeServiceLine(serviceLine);
  return key ? TEMPLATE_BY_KEY.get(key) || null : null;
}

/** Numeric fields of a template that should be summed for weekly totals. */
export function summableFields(t: ReportTemplate): ReportField[] {
  return t.fields.filter((f) => f.type === 'number' && f.summable);
}

/** Fields of one movement, in declaration order. */
export function fieldsByKind(t: ReportTemplate, kind: ReportFieldKind): ReportField[] {
  return t.fields.filter((f) => (f.kind || 'output') === kind);
}

/** Fields that block submission when left empty. */
export function requiredFields(t: ReportTemplate): ReportField[] {
  return t.fields.filter((f) => f.required);
}

// ── per-client storage ────────────────────────────────────────────────────────
// A per-client answer lives at `"<key>.<customerId>"` in the SAME flat customFields
// record. Keeping one record (rather than nesting a map per client) is what lets every
// existing reader — the weekly rollup, the export, the detail dialog — keep working
// without knowing this feature exists.

export function perClientKey(fieldKey: string, customerId: string): string {
  return `${fieldKey}.${customerId}`;
}

/** `'backlinks.cust-1'` → `{ fieldKey: 'backlinks', customerId: 'cust-1' }`. */
export function parseFieldKey(storedKey: string): { fieldKey: string; customerId?: string } {
  const dot = storedKey.indexOf('.');
  if (dot === -1) return { fieldKey: storedKey };
  return { fieldKey: storedKey.slice(0, dot), customerId: storedKey.slice(dot + 1) };
}

/**
 * Total for one field across a report, per-client answers included.
 *
 * Without this the weekly rollup silently reports 0 for every per-client field: the
 * plain key `backlinks` no longer exists once the answer is split per client.
 */
export function sumFieldValue(customFields: Record<string, string | number> | undefined, fieldKey: string): number {
  if (!customFields) return 0;
  let total = 0;
  for (const [k, raw] of Object.entries(customFields)) {
    if (parseFieldKey(k).fieldKey !== fieldKey) continue;
    const v = Number(raw);
    if (!isNaN(v)) total += v;
  }
  return total;
}

/** Every value stored for one field, keyed by client (`''` = the non-per-client one). */
export function valuesByCustomer(
  customFields: Record<string, string | number> | undefined,
  fieldKey: string,
): Array<{ customerId: string; value: string | number }> {
  if (!customFields) return [];
  const out: Array<{ customerId: string; value: string | number }> = [];
  for (const [k, value] of Object.entries(customFields)) {
    const parsed = parseFieldKey(k);
    if (parsed.fieldKey !== fieldKey) continue;
    if (value === '' || value === undefined || value === null) continue;
    out.push({ customerId: parsed.customerId || '', value });
  }
  return out;
}
