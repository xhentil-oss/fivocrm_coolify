/**
 * KPI engine + the agency's metric catalog.
 *
 * Everything the spec lists under §4 (SEO, Web, Ads, Social, general marketing) is
 * DATA here, not UI. A tenant gets the catalog seeded into `reportKpis` on first
 * use and can then edit/extend it; the report blocks reference KPIs by id, so
 * adding a metric never touches a renderer.
 *
 * The functions are the whole comparison story: delta vs. previous period, target
 * attainment, and RAG state — all direction-aware (`higherIsBetter`), because "CPL
 * went down 20%" is good and "position went up 20" is bad.
 */

import type {
  ReportKpi,
  ReportKpiTarget,
  ReportKpiUnit,
  ReportKpiValue,
  ReportService,
} from '../../types';

// ─────────────────────────────────────────────────────────────────────────────
// Catalog
// ─────────────────────────────────────────────────────────────────────────────

/** A catalog entry — a KPI definition without the tenant/doc fields. */
export interface KpiSeed {
  key: string;
  name: string;
  service: ReportService;
  category: string;
  unit: ReportKpiUnit;
  higherIsBetter: boolean;
  /** Safe to show a client? Most performance metrics are; internal cost ones aren't. */
  clientVisible: boolean;
  financial?: boolean;
  decimals?: number;
  description?: string;
}

const K = (
  key: string,
  name: string,
  service: ReportService,
  category: string,
  unit: ReportKpiUnit,
  opts: Partial<KpiSeed> = {},
): KpiSeed => ({
  key, name, service, category, unit,
  higherIsBetter: opts.higherIsBetter ?? true,
  clientVisible: opts.clientVisible ?? true,
  ...opts,
});

/** SEO — §4.1 */
const SEO_KPIS: KpiSeed[] = [
  K('organic_users', 'Vizitorë organikë', 'seo', 'Trafik', 'number'),
  K('organic_sessions', 'Sesione organike', 'seo', 'Trafik', 'number'),
  K('organic_conversions', 'Konvertime organike', 'seo', 'Rezultate', 'number'),
  K('organic_leads', 'Leads organike', 'seo', 'Rezultate', 'number'),
  K('search_impressions', 'Impresione në kërkim', 'seo', 'Dukshmëri', 'number'),
  K('search_clicks', 'Klikime në kërkim', 'seo', 'Dukshmëri', 'number'),
  K('search_ctr', 'CTR mesatar', 'seo', 'Dukshmëri', 'percent', { decimals: 2 }),
  K('avg_position', 'Pozicioni mesatar', 'seo', 'Dukshmëri', 'number', { higherIsBetter: false, decimals: 1 }),
  K('keywords_improved', 'Fjalë kyçe në rritje', 'seo', 'Fjalë kyçe', 'number'),
  K('keywords_declined', 'Fjalë kyçe në ulje', 'seo', 'Fjalë kyçe', 'number', { higherIsBetter: false }),
  K('keywords_top3', 'Fjalë kyçe në Top 3', 'seo', 'Fjalë kyçe', 'number'),
  K('keywords_top10', 'Fjalë kyçe në Top 10', 'seo', 'Fjalë kyçe', 'number'),
  K('keywords_top20', 'Fjalë kyçe në Top 20', 'seo', 'Fjalë kyçe', 'number'),
  K('branded_traffic', 'Trafik i brendit', 'seo', 'Trafik', 'number'),
  K('non_branded_traffic', 'Trafik jo-brend', 'seo', 'Trafik', 'number'),
  K('pages_indexed', 'Faqe të indeksuara', 'seo', 'Teknike', 'number'),
  K('pages_excluded', 'Faqe të përjashtuara', 'seo', 'Teknike', 'number', { higherIsBetter: false }),
  K('technical_errors', 'Gabime teknike', 'seo', 'Teknike', 'number', { higherIsBetter: false }),
  K('cwv_lcp', 'LCP (Core Web Vitals)', 'seo', 'Teknike', 'number', { higherIsBetter: false, decimals: 2 }),
  K('cwv_cls', 'CLS (Core Web Vitals)', 'seo', 'Teknike', 'number', { higherIsBetter: false, decimals: 3 }),
  K('cwv_inp', 'INP (Core Web Vitals)', 'seo', 'Teknike', 'number', { higherIsBetter: false }),
  K('backlinks_gained', 'Backlinks të fituar', 'seo', 'Off-page', 'number'),
  K('backlinks_lost', 'Backlinks të humbur', 'seo', 'Off-page', 'number', { higherIsBetter: false }),
  K('referring_domains', 'Domain-e referuese', 'seo', 'Off-page', 'number'),
  K('domain_authority', 'Autoriteti i domain-it', 'seo', 'Off-page', 'score', { decimals: 1 }),
  K('local_visibility', 'Dukshmëri lokale', 'seo', 'Local SEO', 'percent', { decimals: 1 }),
  K('gbp_actions', 'Veprime në Google Business', 'seo', 'Local SEO', 'number'),
  K('gbp_calls', 'Telefonata nga GBP', 'seo', 'Local SEO', 'number'),
  K('gbp_directions', 'Kërkesa për drejtime', 'seo', 'Local SEO', 'number'),
  K('gbp_website_clicks', 'Klikime drejt faqes nga GBP', 'seo', 'Local SEO', 'number'),
];

/** Web design & development / maintenance — §4.2 */
const WEB_KPIS: KpiSeed[] = [
  K('project_completion', 'Përfundimi i projektit', 'web', 'Progres', 'percent', { decimals: 0 }),
  K('milestones_completed', 'Milestone të përfunduar', 'web', 'Progres', 'number'),
  K('milestones_delayed', 'Milestone të vonuar', 'web', 'Progres', 'number', { higherIsBetter: false }),
  K('tasks_completed_web', 'Detyra të përfunduara', 'web', 'Progres', 'number'),
  K('bugs_opened', 'Bug-e të hapur', 'web', 'Cilësi', 'number', { higherIsBetter: false }),
  K('bugs_resolved', 'Bug-e të zgjidhur', 'web', 'Cilësi', 'number'),
  K('bugs_critical', 'Bug-e kritike', 'web', 'Cilësi', 'number', { higherIsBetter: false }),
  K('dev_hours', 'Orë zhvillimi', 'web', 'Burime', 'hours', { clientVisible: true, decimals: 1 }),
  K('design_hours', 'Orë dizajni', 'web', 'Burime', 'hours', { decimals: 1 }),
  K('revision_rounds', 'Raunde rishikimi', 'web', 'Cilësi', 'number', { higherIsBetter: false }),
  K('scope_changes', 'Ndryshime në qëllim', 'web', 'Qëllim', 'number', { higherIsBetter: false }),
  K('change_requests', 'Kërkesa për ndryshim', 'web', 'Qëllim', 'number', { higherIsBetter: false }),
  K('client_approvals', 'Aprovime nga klienti', 'web', 'Qëllim', 'number'),
  K('missing_materials', 'Materiale që mungojnë', 'web', 'Qëllim', 'number', { higherIsBetter: false }),
  K('uptime', 'Uptime i faqes', 'maintenance', 'Mirëmbajtje', 'percent', { decimals: 2 }),
  K('page_speed', 'PageSpeed score', 'maintenance', 'Mirëmbajtje', 'score', { decimals: 0 }),
  K('security_scans', 'Skanime sigurie', 'maintenance', 'Mirëmbajtje', 'number'),
  K('backups_done', 'Backup-e të kryera', 'maintenance', 'Mirëmbajtje', 'number'),
  K('dependency_updates', 'Përditësime plugin/dependency', 'maintenance', 'Mirëmbajtje', 'number'),
  K('support_requests', 'Kërkesa suporti', 'maintenance', 'Suport', 'number', { higherIsBetter: false }),
  K('support_resolved', 'Kërkesa suporti të zgjidhura', 'maintenance', 'Suport', 'number'),
];

/** Paid advertising — §4.3 */
const ADS_KPIS: KpiSeed[] = [
  K('ad_spend', 'Shpenzim reklamash', 'ads', 'Buxhet', 'currency', { higherIsBetter: false, decimals: 0 }),
  K('impressions', 'Impresione', 'ads', 'Shtrirje', 'number'),
  K('reach', 'Shtrirje', 'ads', 'Shtrirje', 'number'),
  K('frequency', 'Frekuenca', 'ads', 'Shtrirje', 'ratio', { decimals: 2 }),
  K('clicks', 'Klikime', 'ads', 'Trafik', 'number'),
  K('ctr', 'CTR', 'ads', 'Trafik', 'percent', { decimals: 2 }),
  K('cpc', 'CPC', 'ads', 'Efikasitet', 'currency', { higherIsBetter: false, decimals: 2 }),
  K('cpm', 'CPM', 'ads', 'Efikasitet', 'currency', { higherIsBetter: false, decimals: 2 }),
  K('leads_ads', 'Leads', 'ads', 'Rezultate', 'number'),
  K('purchases', 'Blerje', 'ads', 'Rezultate', 'number'),
  K('conversions', 'Konvertime', 'ads', 'Rezultate', 'number'),
  K('conversion_rate', 'Norma e konvertimit', 'ads', 'Rezultate', 'percent', { decimals: 2 }),
  K('cost_per_lead', 'Kosto për lead', 'ads', 'Efikasitet', 'currency', { higherIsBetter: false, decimals: 2 }),
  K('cost_per_acquisition', 'Kosto për blerje (CPA)', 'ads', 'Efikasitet', 'currency', { higherIsBetter: false, decimals: 2 }),
  K('ad_revenue', 'Të ardhura nga reklama', 'ads', 'Rezultate', 'currency', { decimals: 0 }),
  K('roas', 'ROAS', 'ads', 'Rezultate', 'ratio', { decimals: 2 }),
  K('roi', 'ROI', 'ads', 'Rezultate', 'percent', { decimals: 1 }),
  K('lp_conversion_rate', 'Konvertim i landing page', 'ads', 'Rezultate', 'percent', { decimals: 2 }),
  K('form_completion_rate', 'Plotësim formularit', 'ads', 'Rezultate', 'percent', { decimals: 2 }),
  K('calls_generated', 'Telefonata të gjeneruara', 'ads', 'Rezultate', 'number'),
  K('qualified_leads', 'Leads të kualifikuara', 'ads', 'Rezultate', 'number'),
  K('cost_per_qualified_lead', 'Kosto për lead të kualifikuar', 'ads', 'Efikasitet', 'currency', { higherIsBetter: false, decimals: 2 }),
  K('budget_pacing', 'Ecuria e buxhetit', 'ads', 'Buxhet', 'percent', { decimals: 0 }),
  K('ads_rejected', 'Reklama të refuzuara', 'ads', 'Operacione', 'number', { higherIsBetter: false, clientVisible: false }),
  K('tracking_issues', 'Probleme me tracking', 'ads', 'Operacione', 'number', { higherIsBetter: false, clientVisible: false }),
];

/** Social media — §4.4 */
const SOCIAL_KPIS: KpiSeed[] = [
  K('posts_published', 'Postime të publikuara', 'social', 'Përmbajtje', 'number'),
  K('reels_published', 'Reels', 'social', 'Përmbajtje', 'number'),
  K('stories_published', 'Stories', 'social', 'Përmbajtje', 'number'),
  K('videos_published', 'Video', 'social', 'Përmbajtje', 'number'),
  K('social_reach', 'Shtrirje', 'social', 'Shtrirje', 'number'),
  K('social_impressions', 'Impresione', 'social', 'Shtrirje', 'number'),
  K('engagement', 'Interaksione', 'social', 'Angazhim', 'number'),
  K('engagement_rate', 'Norma e angazhimit', 'social', 'Angazhim', 'percent', { decimals: 2 }),
  K('likes', 'Pëlqime', 'social', 'Angazhim', 'number'),
  K('comments', 'Komente', 'social', 'Angazhim', 'number'),
  K('shares', 'Shpërndarje', 'social', 'Angazhim', 'number'),
  K('saves', 'Ruajtje', 'social', 'Angazhim', 'number'),
  K('profile_visits', 'Vizita në profil', 'social', 'Trafik', 'number'),
  K('link_clicks', 'Klikime në link', 'social', 'Trafik', 'number'),
  K('followers_gained', 'Ndjekës të fituar', 'social', 'Audienca', 'number'),
  K('followers_lost', 'Ndjekës të humbur', 'social', 'Audienca', 'number', { higherIsBetter: false }),
  K('net_follower_growth', 'Rritje neto e ndjekësve', 'social', 'Audienca', 'number'),
  K('video_views', 'Shikime video', 'social', 'Video', 'number'),
  K('avg_watch_time', 'Kohë mesatare shikimi', 'social', 'Video', 'number', { decimals: 1 }),
  K('completion_rate', 'Norma e përfundimit', 'social', 'Video', 'percent', { decimals: 1 }),
  K('direct_messages', 'Mesazhe direkte', 'social', 'Komunitet', 'number'),
  K('social_leads', 'Leads nga social', 'social', 'Rezultate', 'number'),
  K('social_website_visits', 'Vizita në faqe nga social', 'social', 'Trafik', 'number'),
  K('response_rate', 'Norma e përgjigjes', 'social', 'Komunitet', 'percent', { decimals: 1 }),
  K('response_time', 'Kohë përgjigjeje (orë)', 'social', 'Komunitet', 'hours', { higherIsBetter: false, decimals: 1 }),
  K('sentiment', 'Sentimenti', 'social', 'Komunitet', 'score', { decimals: 1 }),
];

/** General marketing — §4.5 */
const MARKETING_KPIS: KpiSeed[] = [
  K('total_leads', 'Leads gjithsej', 'marketing', 'Funnel', 'number'),
  K('qualified_leads_total', 'Leads të kualifikuara', 'marketing', 'Funnel', 'number'),
  K('opportunities', 'Oportunitete', 'marketing', 'Funnel', 'number'),
  K('customers_acquired', 'Klientë të fituar', 'marketing', 'Funnel', 'number'),
  K('lead_conversion_rate', 'Norma e konvertimit', 'marketing', 'Funnel', 'percent', { decimals: 2 }),
  K('attributed_revenue', 'Të ardhura të atribuara', 'marketing', 'Rezultate', 'currency', { decimals: 0 }),
  K('cost_per_lead_total', 'Kosto për lead', 'marketing', 'Efikasitet', 'currency', { higherIsBetter: false, decimals: 2 }),
  K('cac', 'Kosto e blerjes së klientit (CAC)', 'marketing', 'Efikasitet', 'currency', { higherIsBetter: false, decimals: 2, financial: true }),
  K('marketing_roi', 'ROI i marketingut', 'marketing', 'Rezultate', 'percent', { decimals: 1 }),
  K('form_submissions', 'Dërgime formularësh', 'marketing', 'Kanale', 'number'),
  K('phone_calls', 'Telefonata', 'marketing', 'Kanale', 'number'),
  K('whatsapp_enquiries', 'Kërkesa WhatsApp', 'marketing', 'Kanale', 'number'),
  K('email_open_rate', 'Norma e hapjes (email)', 'marketing', 'Kanale', 'percent', { decimals: 1 }),
  K('email_click_rate', 'Norma e klikimit (email)', 'marketing', 'Kanale', 'percent', { decimals: 1 }),
  K('pipeline_value', 'Vlera e pipeline-it', 'marketing', 'Funnel', 'currency', { decimals: 0, financial: true }),
  // Internal-only economics — never shown to the client.
  K('gross_margin', 'Marzhi bruto', 'other', 'Financa', 'percent', { decimals: 1, clientVisible: false, financial: true }),
  K('hours_used', 'Orë të konsumuara', 'other', 'Burime', 'hours', { decimals: 1, higherIsBetter: false }),
  K('hours_remaining', 'Orë të mbetura', 'other', 'Burime', 'hours', { decimals: 1 }),
  K('budget_used', 'Buxhet i konsumuar', 'other', 'Burime', 'percent', { decimals: 0, higherIsBetter: false }),
];

/** The full seeded catalog (≈110 KPIs across every service line). */
export const KPI_CATALOG: KpiSeed[] = [
  ...SEO_KPIS, ...WEB_KPIS, ...ADS_KPIS, ...SOCIAL_KPIS, ...MARKETING_KPIS,
];

export const KPI_SEED_BY_KEY: Record<string, KpiSeed> = Object.fromEntries(
  KPI_CATALOG.map(k => [k.key, k]),
);

/** Catalog entries for one service line, for the "add KPI" picker. */
export function catalogForService(service: ReportService): KpiSeed[] {
  return KPI_CATALOG.filter(k => k.service === service);
}

/** Distinct categories within a service, in catalog order. */
export function categoriesForService(service: ReportService): string[] {
  const out: string[] = [];
  for (const k of catalogForService(service)) if (!out.includes(k.category)) out.push(k.category);
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Formatting
// ─────────────────────────────────────────────────────────────────────────────

const CURRENCY_SYMBOL: Record<string, string> = { EUR: '€', USD: '$', ALL: 'L', GBP: '£' };

/**
 * Albanian number formatting, done explicitly rather than via `toLocaleString`.
 *
 * The same value is rendered in the browser, in the jsPDF export and in the Node
 * cron/email path. `Intl` gives different answers for `sq-AL` depending on which
 * ICU data the runtime was built with (this project's Node returns un-grouped
 * digits), which would make a PDF disagree with the screen it was generated from.
 * Numbers in a client report must be byte-identical everywhere, so the grouping
 * (`.`) and decimal (`,`) separators are applied here.
 */
export function formatNumberSq(value: number, decimals: number): string {
  const negative = value < 0;
  const fixed = Math.abs(value).toFixed(Math.max(0, Math.min(20, decimals)));
  const [intPart, fracPart] = fixed.split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${negative ? '−' : ''}${grouped}${fracPart ? `,${fracPart}` : ''}`;
}

/** Format a KPI value in the product locale (sq-AL). Null → an em dash. */
export function formatKpiValue(
  value: number | null | undefined,
  unit: ReportKpiUnit,
  opts: { decimals?: number; currency?: string } = {},
): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const decimals = opts.decimals ?? defaultDecimals(unit);
  const n = formatNumberSq(value, decimals);
  switch (unit) {
    case 'percent': return `${n}%`;
    case 'currency': return `${n} ${CURRENCY_SYMBOL[opts.currency || 'EUR'] || opts.currency || '€'}`;
    case 'hours': return `${n} h`;
    case 'days': return `${n} ditë`;
    case 'ratio': return `${n}×`;
    case 'score':
    case 'number':
    default: return n;
  }
}

function defaultDecimals(unit: ReportKpiUnit): number {
  if (unit === 'percent' || unit === 'ratio') return 2;
  if (unit === 'currency' || unit === 'hours' || unit === 'days' || unit === 'score') return 1;
  return 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Comparison
// ─────────────────────────────────────────────────────────────────────────────

export interface KpiDelta {
  /** Absolute change (current − previous). Null when either side is missing. */
  absolute: number | null;
  /** Relative change as a fraction (0.12 = +12%). Null when previous is 0/missing. */
  relative: number | null;
  /** Direction of the raw number, independent of whether that is good. */
  direction: 'up' | 'down' | 'flat';
  /** Is the change GOOD, given `higherIsBetter`? */
  favourable: boolean | null;
}

/**
 * Delta vs. the comparison value, direction-aware.
 *
 * The `favourable` flag is the point: a 20% drop in CPL and a 20% rise in leads are
 * both good news, and the UI must colour them the same way. Callers must never
 * derive "green" from `direction` alone.
 */
export function kpiDelta(
  current: number | null | undefined,
  previous: number | null | undefined,
  higherIsBetter = true,
): KpiDelta {
  if (current === null || current === undefined || previous === null || previous === undefined) {
    return { absolute: null, relative: null, direction: 'flat', favourable: null };
  }
  const absolute = current - previous;
  const relative = previous === 0 ? null : absolute / Math.abs(previous);
  const direction: KpiDelta['direction'] = absolute > 0 ? 'up' : absolute < 0 ? 'down' : 'flat';
  const favourable = absolute === 0 ? null : higherIsBetter ? absolute > 0 : absolute < 0;
  return { absolute, relative, direction, favourable };
}

/** Format a delta for a card: `+12.4%`, `−3` or `—`. */
export function formatDelta(delta: KpiDelta, unit: ReportKpiUnit, opts: { decimals?: number; currency?: string } = {}): string {
  if (delta.relative !== null) {
    const pct = formatNumberSq(Math.abs(delta.relative * 100), 1);
    return `${delta.absolute! > 0 ? '+' : delta.absolute! < 0 ? '−' : ''}${pct}%`;
  }
  if (delta.absolute !== null) {
    const abs = formatKpiValue(Math.abs(delta.absolute), unit, opts);
    return `${delta.absolute > 0 ? '+' : delta.absolute < 0 ? '−' : ''}${abs}`;
  }
  return '—';
}

/**
 * Target attainment as a fraction of the target (1 = exactly on target).
 *
 * For `higherIsBetter: false` metrics the ratio is INVERTED, so 0.8 spend against a
 * 1.0 budget scores 1.25 (beating the target) rather than 0.8 (missing it).
 */
export function targetAttainment(
  value: number | null | undefined,
  target: number | null | undefined,
  higherIsBetter = true,
): number | null {
  if (value === null || value === undefined || target === null || target === undefined) return null;
  if (target === 0) return null;
  if (higherIsBetter) return value / target;
  // Lower-is-better: hitting 0 against a positive target is unboundedly good, so
  // the ratio is capped rather than returned as Infinity (which no chart can plot).
  if (value === 0) return ATTAINMENT_CAP;
  return Math.min(target / value, ATTAINMENT_CAP);
}

/** Ceiling for attainment ratios, so "infinitely better than target" stays plottable. */
export const ATTAINMENT_CAP = 2;

export type KpiRag = 'green' | 'yellow' | 'red' | 'grey';

/**
 * RAG state from attainment. `warnAt`/`criticalAt` are fractions of the target
 * (defaults: below 90% → yellow, below 70% → red).
 */
export function kpiRag(
  attainment: number | null,
  warnAt = 0.9,
  criticalAt = 0.7,
): KpiRag {
  if (attainment === null) return 'grey';
  if (attainment < criticalAt) return 'red';
  if (attainment < warnAt) return 'yellow';
  return 'green';
}

/**
 * Resolve the applicable target for a KPI in a scope. Narrowest scope wins:
 * project > customer > service > global; a period-specific target beats an
 * always-on one at the same level.
 */
export function resolveTarget(
  kpi: Pick<ReportKpi, 'targets'>,
  scope: { customerId?: string; projectId?: string; service?: ReportService; periodKey?: string },
): number | null {
  const targets = kpi.targets || [];
  const score = (t: ReportKpiTarget): number => {
    let s = 0;
    if (t.projectId) {
      if (t.projectId !== scope.projectId) return -1;
      s += 8;
    }
    if (t.customerId) {
      if (t.customerId !== scope.customerId) return -1;
      s += 4;
    }
    if (t.service) {
      if (t.service !== scope.service) return -1;
      s += 2;
    }
    if (t.periodKey) {
      if (t.periodKey !== scope.periodKey) return -1;
      s += 1;
    }
    return s;
  };
  let best: { value: number; s: number } | null = null;
  for (const t of targets) {
    const s = score(t);
    if (s < 0) continue;
    if (!best || s > best.s) best = { value: t.value, s };
  }
  return best ? best.value : null;
}

/**
 * Build the snapshot values a report carries, from a metric set + the KPI
 * definitions. Snapshotting is what makes rule 15 (historical reports keep their
 * original numbers) true: the report never re-reads `reportMetrics` after publish.
 */
export function buildKpiValues(
  kpis: ReportKpi[],
  current: Record<string, number | null>,
  previous: Record<string, number | null> = {},
  scope: { customerId?: string; projectId?: string; service?: ReportService; periodKey?: string } = {},
  origins: Record<string, string> = {},
): ReportKpiValue[] {
  return kpis.map(k => ({
    kpiId: k.id || k.key,
    label: k.name,
    unit: k.unit,
    value: current[k.key] ?? null,
    previousValue: previous[k.key] ?? null,
    target: resolveTarget(k, { ...scope, service: scope.service ?? k.service }),
    higherIsBetter: k.higherIsBetter,
    decimals: k.decimals,
    currency: k.currency,
    financial: k.financial,
    clientVisible: k.clientVisible,
    origin: origins[k.key] || k.source || 'manual',
  }));
}

/** Everything a KPI card needs, computed once. */
export interface KpiCardModel {
  kpi: ReportKpiValue;
  display: string;
  delta: KpiDelta;
  deltaLabel: string;
  attainment: number | null;
  rag: KpiRag;
  targetLabel: string | null;
}

export function kpiCardModel(value: ReportKpiValue, warnAt?: number, criticalAt?: number): KpiCardModel {
  const higherIsBetter = value.higherIsBetter !== false;
  const delta = kpiDelta(value.value, value.previousValue, higherIsBetter);
  const attainment = targetAttainment(value.value, value.target, higherIsBetter);
  const fmt = { decimals: value.decimals, currency: value.currency };
  return {
    kpi: value,
    display: formatKpiValue(value.value, value.unit, fmt),
    delta,
    deltaLabel: formatDelta(delta, value.unit, fmt),
    attainment,
    rag: kpiRag(attainment, warnAt, criticalAt),
    targetLabel: value.target === null || value.target === undefined
      ? null
      : formatKpiValue(value.target, value.unit, fmt),
  };
}

/**
 * Contradiction check used by the quality panel: numbers that cannot all be true.
 * Cheap, high-signal sanity rules — not an exhaustive model.
 */
export function findMetricContradictions(values: ReportKpiValue[]): string[] {
  const by = new Map<string, number>();
  for (const v of values) if (typeof v.value === 'number') by.set(v.kpiId, v.value);
  const get = (k: string) => by.get(k);
  const issues: string[] = [];

  const clicks = get('clicks');
  const impressions = get('impressions');
  if (clicks !== undefined && impressions !== undefined && clicks > impressions) {
    issues.push('Klikimet janë më shumë se impresionet.');
  }
  const conv = get('conversions');
  if (conv !== undefined && clicks !== undefined && conv > clicks) {
    issues.push('Konvertimet janë më shumë se klikimet.');
  }
  const spend = get('ad_spend');
  const leads = get('leads_ads');
  const cpl = get('cost_per_lead');
  if (spend !== undefined && leads !== undefined && leads > 0 && cpl !== undefined) {
    const implied = spend / leads;
    if (implied > 0 && Math.abs(implied - cpl) / implied > 0.25) {
      issues.push(`Kosto për lead (${cpl}) nuk përputhet me shpenzim/leads (${implied.toFixed(2)}).`);
    }
  }
  const searchClicks = get('search_clicks');
  const searchImpr = get('search_impressions');
  if (searchClicks !== undefined && searchImpr !== undefined && searchClicks > searchImpr) {
    issues.push('Klikimet në kërkim tejkalojnë impresionet.');
  }
  const gained = get('followers_gained');
  const lost = get('followers_lost');
  const net = get('net_follower_growth');
  if (gained !== undefined && lost !== undefined && net !== undefined && Math.abs((gained - lost) - net) > 1) {
    issues.push('Rritja neto e ndjekësve nuk përputhet me fituar − humbur.');
  }
  const rate = get('conversion_rate');
  if (rate !== undefined && (rate < 0 || rate > 100)) issues.push('Norma e konvertimit është jashtë 0–100%.');
  return issues;
}
