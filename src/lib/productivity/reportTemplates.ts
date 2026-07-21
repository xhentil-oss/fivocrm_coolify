/**
 * Department (serviceLine) daily-report templates.
 *
 * A SEO expert should report different numbers than an Ads or Design person.
 * These are ready-made, fixed field sets keyed by the member's `serviceLine`
 * (already on TeamMember). Numeric fields marked `summable` roll up into the
 * weekly "what we achieved" totals. Pure data + helpers — no React.
 */

export type ReportFieldType = 'text' | 'number' | 'textarea';

export interface ReportField {
  key: string;
  label: string;
  type: ReportFieldType;
  placeholder?: string;
  unit?: string;         // shown after the value (e.g. "€")
  summable?: boolean;    // numeric fields that make sense to sum over a week
}

export interface ReportTemplate {
  key: string;           // normalized serviceLine
  label: string;         // display name
  emoji: string;
  fields: ReportField[];
}

const N = (key: string, label: string, extra: Partial<ReportField> = {}): ReportField =>
  ({ key, label, type: 'number', summable: true, ...extra });

export const REPORT_TEMPLATES: ReportTemplate[] = [
  {
    key: 'seo', label: 'SEO', emoji: '🔍',
    fields: [
      N('keywords', 'Fjalë kyçe të punuara'),
      N('backlinks', 'Backlinks të ndërtuar'),
      N('pagesOptimized', 'Faqe/artikuj të optimizuar'),
      N('technicalFixes', 'Rregullime teknike'),
      { key: 'rankingNotes', label: 'Shënime mbi renditjen', type: 'textarea', placeholder: 'p.sh. keyword X u ngjit në faqen 1…' },
    ],
  },
  {
    key: 'ads', label: 'Ads / PPC', emoji: '🎯',
    fields: [
      N('campaigns', 'Fushata të menaxhuara'),
      N('adSpend', 'Shpenzim reklamash', { unit: '€' }),
      N('leads', 'Leads të gjeneruara'),
      { key: 'ctr', label: 'CTR / performancë', type: 'text', placeholder: 'p.sh. CTR 3.2%, CPL 1.4€' },
      { key: 'optimizations', label: 'Optimizime', type: 'textarea', placeholder: 'p.sh. ndalova 2 ad-set me performancë të ulët…' },
    ],
  },
  {
    key: 'social', label: 'Social Media', emoji: '📱',
    fields: [
      N('posts', 'Postime'),
      N('reels', 'Reels / Video'),
      N('stories', 'Stories'),
      N('interactions', 'Komente/mesazhe të përgjigjura'),
      { key: 'contentNotes', label: 'Shënime mbi përmbajtjen', type: 'textarea' },
    ],
  },
  {
    key: 'design', label: 'Design', emoji: '🎨',
    fields: [
      N('designs', 'Dizajne të përfunduara'),
      N('revisions', 'Rishikime'),
      { key: 'assets', label: 'Materiale të dorëzuara', type: 'text', placeholder: 'p.sh. 3 banera, 1 logo' },
    ],
  },
  {
    key: 'dev', label: 'Development', emoji: '💻',
    fields: [
      N('features', 'Features/detyra të dorëzuara'),
      N('bugsFixed', 'Bug-e të rregulluar'),
      { key: 'devNotes', label: 'Shënime teknike', type: 'textarea' },
    ],
  },
  {
    key: 'content', label: 'Content', emoji: '✍️',
    fields: [
      N('articles', 'Artikuj/tekste të shkruar'),
      N('words', 'Fjalë të shkruara'),
      { key: 'topics', label: 'Tema të mbuluara', type: 'text' },
    ],
  },
  {
    key: 'sales', label: 'Sales', emoji: '📞',
    fields: [
      N('calls', 'Telefonata'),
      N('meetings', 'Takime'),
      N('proposals', 'Propozime të dërguara'),
      N('dealsWon', 'Marrëveshje të fituara'),
    ],
  },
];

const TEMPLATE_BY_KEY = new Map(REPORT_TEMPLATES.map((t) => [t.key, t]));

// Synonyms → normalized template key (Albanian + English variants).
const SYNONYMS: Record<string, string> = {
  seo: 'seo', 'search engine optimization': 'seo',
  ads: 'ads', ppc: 'ads', 'google ads': 'ads', 'meta ads': 'ads', reklama: 'ads', 'paid ads': 'ads',
  social: 'social', 'social media': 'social', smm: 'social', 'rrjete sociale': 'social', 'rrjetet sociale': 'social',
  design: 'design', graphic: 'design', 'graphic design': 'design', grafik: 'design', dizajn: 'design',
  dev: 'dev', development: 'dev', web: 'dev', 'web development': 'dev', programim: 'dev', zhvillim: 'dev',
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
