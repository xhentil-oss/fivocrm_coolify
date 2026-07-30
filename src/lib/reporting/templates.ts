/**
 * Report templates — the seeded library and the instantiation rules.
 *
 * A template is a block list plus provenance. `instantiateTemplate()` copies the
 * blocks into a new report AND stamps `templateKey` + `templateVersion` on it, which
 * is what makes rule 11 true: editing a template later cannot rewrite a report that
 * was already generated from it, because the report carries its own copy.
 *
 * The library below covers the 15 default templates from §11. Each is data, so a
 * tenant can duplicate and edit any of them without touching code.
 */

import type {
  Report,
  ReportBlock,
  ReportFrequency,
  ReportKind,
  ReportPeriod,
  ReportService,
  ReportTemplate,
  ReportVisibility,
} from '../../types';
import { TABLE_PRESETS, createBlock, normaliseOrder } from './blocks';
import { formatPeriodLabel } from './period';

/** A template definition without tenant/doc fields — the seed shape. */
export interface TemplateSeed {
  key: string;
  name: string;
  description: string;
  kind: ReportKind;
  frequency: ReportFrequency;
  service?: ReportService;
  /** Compact block spec, expanded by `expandBlocks`. */
  blocks: BlockSpec[];
}

export interface BlockSpec {
  type: ReportBlock['type'];
  title?: string;
  description?: string;
  /** Defaults to `internal` — client visibility is always explicit. */
  v?: ReportVisibility;
  required?: boolean;
  /** Template-locked: the author may fill it but not delete it. */
  locked?: boolean;
  source?: ReportBlock['source'];
  columns?: keyof typeof TABLE_PRESETS;
  chart?: ReportBlock['chart'];
  comparePeriod?: ReportBlock['comparePeriod'];
  /** KPI catalog keys to prefill (resolved to ids at instantiation). */
  kpis?: string[];
  inPortal?: boolean;
  inPdf?: boolean;
}

const b = (type: ReportBlock['type'], title?: string, extra: Partial<BlockSpec> = {}): BlockSpec =>
  ({ type, title, ...extra });

// Shorthand for "the client sees this".
const C: ReportVisibility = 'client';
const M: ReportVisibility = 'management';

// ─────────────────────────────────────────────────────────────────────────────
// The seeded library (§11)
// ─────────────────────────────────────────────────────────────────────────────

export const TEMPLATE_SEEDS: TemplateSeed[] = [
  // ── 1. Weekly employee summary ──
  {
    key: 'weekly-employee',
    name: 'Përmbledhje javore e punonjësit',
    description: 'Arritjet, orët, bllokuesit dhe prioritetet për javën tjetër.',
    kind: 'weekly-staff',
    frequency: 'weekly',
    blocks: [
      b('executive-summary', 'Arritjet kryesore të javës', { required: true, locked: true }),
      b('task-list', 'Detyra të përfunduara', { source: 'auto:tasks', locked: true }),
      b('table', 'Projekte & klientë të punuar', { source: 'auto:daily-reports' }),
      b('kpi-cards', 'Orët', { source: 'auto:time-entries', kpis: ['hours_used'], locked: true }),
      b('blocker-list', 'Bllokues & problemet', { source: 'auto:blockers', locked: true }),
      b('rich-text', 'Zgjidhje të zbatuara'),
      b('rich-text', 'Suport i marrë / i nevojshëm'),
      b('rich-text', 'Çfarë mësova'),
      b('next-steps', 'Prioritetet për javën tjetër', { required: true, locked: true }),
      b('progress', 'Vetëvlerësim i performancës'),
      b('rich-text', 'Feedback i menaxherit', { v: M, locked: true }),
    ],
  },

  // ── 2. Weekly project status ──
  {
    key: 'weekly-project-status',
    name: 'Statusi javor i projektit',
    description: 'RAG, progres, punë e kryer, rreziqe dhe aprovime të pritura.',
    kind: 'project-status',
    frequency: 'weekly',
    blocks: [
      b('executive-summary', 'Përmbledhje e statusit', { v: C, required: true, locked: true }),
      b('progress', 'Progresi i projektit', { v: C, locked: true }),
      b('work-completed', 'Puna e kryer', { v: C, source: 'auto:tasks', required: true, locked: true }),
      b('task-list', 'Në progres', { v: C, source: 'auto:tasks' }),
      b('next-steps', 'Puna e planifikuar', { v: C, locked: true }),
      b('milestone-list', 'Milestone-t', { v: C, source: 'auto:milestones' }),
      b('risk-register', 'Rreziqe & vonesa', { v: C, columns: 'risks' }),
      b('blocker-list', 'Bllokues të brendshëm', { source: 'auto:blockers', locked: true }),
      b('client-action', 'Kërkohet nga klienti', { v: C, required: true, locked: true }),
      b('kpi-cards', 'Buxheti & orët', { v: C, source: 'auto:budget', kpis: ['budget_used', 'hours_used', 'hours_remaining'] }),
      b('kpi-cards', 'Ekonomia e projektit', { v: M, kpis: ['gross_margin'], locked: true }),
      b('rich-text', 'Ndryshime në qëllim', { v: C }),
      b('recommendation', 'Rekomandime', { v: C }),
    ],
  },

  // ── 3. Weekly client update (light touch) ──
  {
    key: 'weekly-client-update',
    name: 'Update javor për klientin',
    description: 'Version i shkurtër: çfarë bëmë, çfarë vjen, çfarë presim.',
    kind: 'project-status',
    frequency: 'weekly',
    blocks: [
      b('executive-summary', 'Përmbledhje', { v: C, required: true, locked: true }),
      b('work-completed', 'Çfarë bëmë këtë javë', { v: C, source: 'auto:tasks', required: true }),
      b('next-steps', 'Çfarë vjen', { v: C, required: true }),
      b('client-action', 'Çfarë presim nga ju', { v: C }),
    ],
  },

  // ── 4. Monthly SEO ──
  {
    key: 'monthly-seo',
    name: 'Raport mujor SEO',
    description: 'Trafik organik, fjalë kyçe, teknike, off-page dhe local SEO.',
    kind: 'client-monthly',
    frequency: 'monthly',
    service: 'seo',
    blocks: [
      b('executive-summary', 'Përmbledhje ekzekutive', { v: C, required: true, locked: true }),
      b('rich-text', 'Objektivat e periudhës', { v: C, locked: true }),
      b('kpi-cards', 'Treguesit kryesorë', {
        v: C, source: 'auto:kpis', required: true, locked: true,
        kpis: ['organic_users', 'organic_sessions', 'organic_conversions', 'organic_leads', 'search_clicks', 'search_ctr', 'avg_position'],
      }),
      b('comparison-cards', 'Krahasim me periudhën e mëparshme', { v: C, comparePeriod: 'previous', source: 'auto:kpis' }),
      b('goal-vs-actual', 'Arritja ndaj objektivave', { v: C, source: 'auto:kpis' }),
      b('chart', 'Trendi i trafikut organik', { v: C, chart: 'line', source: 'auto:kpis', kpis: ['organic_users'] }),
      b('kpi-cards', 'Dukshmëria e fjalëve kyçe', { v: C, kpis: ['keywords_top3', 'keywords_top10', 'keywords_top20', 'keywords_improved', 'keywords_declined'] }),
      b('table', 'Fjalët kyçe kryesore', { v: C, columns: 'keywords' }),
      b('table', 'Faqet me performancë më të mirë', { v: C, columns: 'landingPages' }),
      b('work-completed', 'Puna teknike SEO', { v: C, source: 'auto:tasks', required: true }),
      b('rich-text', 'SEO on-page', { v: C }),
      b('rich-text', 'Përmbajtja e prodhuar', { v: C }),
      b('kpi-cards', 'Off-page', { v: C, kpis: ['backlinks_gained', 'backlinks_lost', 'referring_domains', 'domain_authority'] }),
      b('kpi-cards', 'Local SEO', { v: C, kpis: ['gbp_actions', 'gbp_calls', 'gbp_directions', 'gbp_website_clicks', 'local_visibility'] }),
      b('kpi-cards', 'Shëndeti teknik', { v: C, kpis: ['pages_indexed', 'technical_errors', 'cwv_lcp', 'cwv_cls', 'cwv_inp'] }),
      b('risk-register', 'Problemet e zbuluara', { v: C, columns: 'risks' }),
      b('recommendation', 'Rekomandime strategjike', { v: C, required: true, locked: true }),
      b('next-steps', 'Plani për periudhën tjetër', { v: C, required: true, locked: true }),
      b('client-action', 'Veprime të kërkuara nga klienti', { v: C }),
      b('rich-text', 'Shënime të brendshme & rreziqe', { v: M, locked: true }),
      b('kpi-cards', 'Ekonomia e llogarisë', { v: M, kpis: ['gross_margin', 'hours_used', 'hours_remaining'], locked: true }),
    ],
  },

  // ── 5. Monthly social media ──
  {
    key: 'monthly-social',
    name: 'Raport mujor Social Media',
    description: 'Përmbajtja, audienca, angazhimi, video dhe komuniteti.',
    kind: 'client-monthly',
    frequency: 'monthly',
    service: 'social',
    blocks: [
      b('executive-summary', 'Përmbledhje ekzekutive', { v: C, required: true, locked: true }),
      b('kpi-cards', 'Përmbajtja e dorëzuar', { v: C, source: 'auto:social', required: true, kpis: ['posts_published', 'reels_published', 'stories_published', 'videos_published'] }),
      b('kpi-cards', 'Shtrirja & angazhimi', { v: C, source: 'auto:social', kpis: ['social_reach', 'social_impressions', 'engagement', 'engagement_rate'] }),
      b('comparison-cards', 'Krahasim me muajin e kaluar', { v: C, comparePeriod: 'previous', source: 'auto:social' }),
      b('kpi-cards', 'Rritja e audiencës', { v: C, source: 'auto:social', kpis: ['followers_gained', 'followers_lost', 'net_follower_growth'] }),
      b('chart', 'Trendi i ndjekësve', { v: C, chart: 'area', kpis: ['net_follower_growth'] }),
      b('kpi-cards', 'Performanca e videos', { v: C, kpis: ['video_views', 'avg_watch_time', 'completion_rate'] }),
      b('table', 'Përmbajtja më e mirë', { v: C, columns: 'content' }),
      b('table', 'Përmbajtja me performancë të dobët', { v: C, columns: 'content' }),
      b('kpi-cards', 'Komuniteti', { v: C, kpis: ['direct_messages', 'response_rate', 'response_time', 'sentiment'] }),
      b('kpi-cards', 'Leads & trafik', { v: C, kpis: ['social_leads', 'link_clicks', 'social_website_visits', 'profile_visits'] }),
      b('rich-text', 'Paguar kundrejt organik', { v: C }),
      b('recommendation', 'Mësimet & rekomandimet', { v: C, required: true, locked: true }),
      b('next-steps', 'Drejtimi i përmbajtjes për muajin tjetër', { v: C, required: true }),
      b('client-action', 'Materiale që presim nga klienti', { v: C }),
      b('rich-text', 'Shënime të brendshme', { v: M, locked: true }),
    ],
  },

  // ── 6. Monthly paid advertising ──
  {
    key: 'monthly-ads',
    name: 'Raport mujor Reklama të Paguara',
    description: 'Buxhet, rezultate biznesi, fushata, audienca, kreativë dhe teste.',
    kind: 'client-monthly',
    frequency: 'monthly',
    service: 'ads',
    blocks: [
      b('executive-summary', 'Përmbledhje ekzekutive', { v: C, required: true, locked: true }),
      b('kpi-cards', 'Pasqyra e buxhetit', { v: C, source: 'auto:kpis', required: true, kpis: ['ad_spend', 'budget_pacing'] }),
      b('kpi-cards', 'Rezultatet e biznesit', { v: C, source: 'auto:kpis', required: true, kpis: ['leads_ads', 'qualified_leads', 'conversions', 'ad_revenue', 'roas'] }),
      b('kpi-cards', 'Efikasiteti', { v: C, kpis: ['cost_per_lead', 'cost_per_qualified_lead', 'cost_per_acquisition', 'cpc', 'cpm', 'ctr'] }),
      b('comparison-cards', 'Krahasim me periudhën e mëparshme', { v: C, comparePeriod: 'previous' }),
      b('goal-vs-actual', 'Arritja ndaj objektivave', { v: C }),
      b('funnel', 'Funnel: impresione → konvertim', { v: C, kpis: ['impressions', 'clicks', 'leads_ads', 'conversions'] }),
      b('table', 'Performanca e fushatave', { v: C, columns: 'campaigns', required: true }),
      b('rich-text', 'Audiencat më të mira', { v: C }),
      b('rich-text', 'Kreativët më të mirë', { v: C }),
      b('rich-text', 'Fushatat me performancë të dobët', { v: C }),
      b('rich-text', 'Testet e kryera', { v: C }),
      b('work-completed', 'Optimizimet e kryera', { v: C, source: 'auto:tasks', required: true }),
      b('risk-register', 'Problemet e zbuluara', { v: C, columns: 'risks' }),
      b('kpi-cards', 'Higjiena e llogarisë', { kpis: ['ads_rejected', 'tracking_issues'], locked: true }),
      b('next-steps', 'Plani i testimit për periudhën tjetër', { v: C, required: true }),
      b('recommendation', 'Rekomandime për buxhetin', { v: C, required: true, locked: true }),
      b('client-action', 'Vendime që presim nga klienti', { v: C }),
    ],
  },

  // ── 7. Monthly web maintenance ──
  {
    key: 'monthly-maintenance',
    name: 'Raport mujor Mirëmbajtje Web',
    description: 'Uptime, shpejtësi, siguri, backup-e, përditësime dhe suport.',
    kind: 'client-monthly',
    frequency: 'monthly',
    service: 'maintenance',
    blocks: [
      b('executive-summary', 'Përmbledhje', { v: C, required: true, locked: true }),
      b('kpi-cards', 'Shëndeti i faqes', { v: C, required: true, kpis: ['uptime', 'page_speed', 'cwv_lcp', 'cwv_cls', 'cwv_inp'] }),
      b('kpi-cards', 'Mirëmbajtja e kryer', { v: C, kpis: ['backups_done', 'dependency_updates', 'security_scans'] }),
      b('table', 'Veprimet e mirëmbajtjes', { v: C, columns: 'maintenance', required: true }),
      b('kpi-cards', 'Suporti', { v: C, kpis: ['support_requests', 'support_resolved'] }),
      b('table', 'Problemet e zgjidhura', { v: C, columns: 'bugs' }),
      b('risk-register', 'Rreziqe teknike', { v: C, columns: 'risks' }),
      b('recommendation', 'Rekomandime', { v: C }),
      b('client-action', 'Aprovime të nevojshme', { v: C }),
    ],
  },

  // ── 8. Monthly full-service marketing ──
  {
    key: 'monthly-full-service',
    name: 'Raport mujor Marketing (full-service)',
    description: 'Pamje e plotë: funnel, kanale, atribuim dhe puna e dorëzuar.',
    kind: 'client-monthly',
    frequency: 'monthly',
    service: 'marketing',
    blocks: [
      b('executive-summary', 'Përmbledhje ekzekutive', { v: C, required: true, locked: true }),
      b('rich-text', 'Objektivat e periudhës', { v: C, locked: true }),
      b('kpi-cards', 'Funnel', { v: C, required: true, kpis: ['total_leads', 'qualified_leads_total', 'opportunities', 'customers_acquired', 'lead_conversion_rate'] }),
      b('kpi-cards', 'Rezultatet financiare', { v: C, kpis: ['attributed_revenue', 'cost_per_lead_total', 'marketing_roi'] }),
      b('comparison-cards', 'Krahasim me periudhën e mëparshme', { v: C, comparePeriod: 'previous' }),
      b('goal-vs-actual', 'Arritja ndaj objektivave', { v: C }),
      b('funnel', 'Rruga nga lead në klient', { v: C, kpis: ['total_leads', 'qualified_leads_total', 'opportunities', 'customers_acquired'] }),
      b('kpi-cards', 'Kanalet', { v: C, kpis: ['form_submissions', 'phone_calls', 'whatsapp_enquiries', 'email_open_rate', 'email_click_rate'] }),
      b('kpi-cards', 'SEO', { v: C, kpis: ['organic_users', 'organic_leads', 'search_clicks'] }),
      b('kpi-cards', 'Reklama', { v: C, kpis: ['ad_spend', 'leads_ads', 'cost_per_lead', 'roas'] }),
      b('kpi-cards', 'Social', { v: C, kpis: ['social_reach', 'engagement_rate', 'net_follower_growth'] }),
      b('work-completed', 'Puna e dorëzuar', { v: C, source: 'auto:tasks', required: true }),
      b('rich-text', 'Problemet & kufizimet', { v: C, required: true }),
      b('recommendation', 'Rekomandime strategjike', { v: C, required: true, locked: true }),
      b('next-steps', 'Plani i veprimit për muajin tjetër', { v: C, required: true, locked: true }),
      b('client-action', 'Veprime të kërkuara nga klienti', { v: C }),
      b('rich-text', 'Vlerësim i brendshëm i llogarisë', { v: M, locked: true }),
      b('kpi-cards', 'Ekonomia e llogarisë', { v: M, kpis: ['gross_margin', 'hours_used', 'hours_remaining', 'budget_used'], locked: true }),
    ],
  },

  // ── 9. Quarterly business review ──
  {
    key: 'qbr',
    name: 'Quarterly Business Review',
    description: 'Rishikim strategjik tremujor për takim me klientin.',
    kind: 'qbr',
    frequency: 'quarterly',
    blocks: [
      b('title', 'Quarterly Business Review', { v: C, locked: true }),
      b('executive-summary', 'Pasqyra ekzekutive', { v: C, required: true, locked: true }),
      b('rich-text', 'Objektivat e biznesit', { v: C, required: true }),
      b('kpi-cards', 'Performanca sipas shërbimit', { v: C, required: true }),
      b('chart', 'Trendi i KPI-ve kryesore', { v: C, chart: 'line' }),
      b('kpi-cards', 'Rezultate të lidhura me të ardhurat', { v: C, kpis: ['attributed_revenue', 'customers_acquired', 'marketing_roi'] }),
      b('funnel', 'Gjenerimi & konvertimi i lead-eve', { v: C, kpis: ['total_leads', 'qualified_leads_total', 'opportunities', 'customers_acquired'] }),
      b('kpi-cards', 'Fushatat', { v: C, kpis: ['ad_spend', 'roas', 'cost_per_lead'] }),
      b('kpi-cards', 'Rritja SEO', { v: C, kpis: ['organic_users', 'keywords_top10', 'referring_domains'] }),
      b('kpi-cards', 'Rritja në social', { v: C, kpis: ['net_follower_growth', 'engagement_rate'] }),
      b('kpi-cards', 'Performanca e faqes', { v: C, kpis: ['uptime', 'page_speed'] }),
      b('work-completed', 'Puna e dorëzuar gjatë tremujorit', { v: C, source: 'auto:tasks', required: true }),
      b('kpi-cards', 'Burimet & buxheti', { v: C, kpis: ['hours_used', 'budget_used'] }),
      b('rich-text', 'Oportunitete', { v: C, required: true }),
      b('risk-register', 'Rreziqe', { v: C, columns: 'risks' }),
      b('recommendation', 'Rekomandime strategjike', { v: C, required: true, locked: true }),
      b('next-steps', 'Prioritetet e tremujorit tjetër', { v: C, required: true, locked: true }),
      b('rich-text', 'Propozim për qëllim/buxhet', { v: C }),
      b('signature', 'Miratimi', { v: C }),
      b('rich-text', 'Strategjia e brendshme e llogarisë', { v: M, locked: true }),
    ],
  },

  // ── 10. Project completion ──
  {
    key: 'project-completion',
    name: 'Raport i përfundimit të projektit',
    description: 'Dorëzimi final, rezultatet, mësimet dhe hapat pas-lansimit.',
    kind: 'project-completion',
    frequency: 'ad-hoc',
    blocks: [
      b('executive-summary', 'Përmbledhje e projektit', { v: C, required: true, locked: true }),
      b('work-completed', 'Çfarë u dorëzua', { v: C, source: 'auto:tasks', required: true, locked: true }),
      b('milestone-list', 'Milestone-t', { v: C, source: 'auto:milestones' }),
      b('kpi-cards', 'Rezultatet', { v: C, kpis: ['project_completion', 'milestones_completed', 'dev_hours', 'design_hours'] }),
      b('kpi-cards', 'Buxheti & orët', { v: C, kpis: ['budget_used', 'hours_used'] }),
      b('rich-text', 'Ndryshimet në qëllim', { v: C }),
      b('rich-text', 'Mësimet e nxjerra', { v: C }),
      b('next-steps', 'Hapat pas dorëzimit', { v: C, required: true }),
      b('client-action', 'Miratimi final', { v: C, required: true }),
      b('signature', 'Nënshkrimi i dorëzimit', { v: C }),
      b('kpi-cards', 'Rezultati ekonomik', { v: M, kpis: ['gross_margin'], locked: true }),
      b('rich-text', 'Retrospektivë e brendshme', { v: M, locked: true }),
    ],
  },

  // ── 11. Website launch ──
  {
    key: 'website-launch',
    name: 'Raport i lansimit të faqes',
    description: 'Statusi i deploy-it, QA, performanca dhe siguria në lansim.',
    kind: 'website-launch',
    frequency: 'ad-hoc',
    service: 'web',
    blocks: [
      b('executive-summary', 'Përmbledhje e lansimit', { v: C, required: true, locked: true }),
      b('rich-text', 'Statusi i deploy-it (staging → production)', { v: C, required: true }),
      b('work-completed', 'Puna e dorëzuar', { v: C, source: 'auto:tasks', required: true }),
      b('table', 'Testimi & QA', { v: C, columns: 'bugs' }),
      b('kpi-cards', 'Performanca në lansim', { v: C, kpis: ['page_speed', 'cwv_lcp', 'cwv_cls', 'cwv_inp', 'uptime'] }),
      b('kpi-cards', 'Siguria & backup-et', { v: C, kpis: ['security_scans', 'backups_done'] }),
      b('risk-register', 'Çështje të hapura', { v: C, columns: 'risks' }),
      b('next-steps', 'Plani pas lansimit', { v: C, required: true }),
      b('client-action', 'Aprovimi final', { v: C }),
    ],
  },

  // ── 12. Campaign completion ──
  {
    key: 'campaign-completion',
    name: 'Raport i përfundimit të fushatës',
    description: 'Rezultatet përfundimtare, mësimet dhe rekomandimet e fushatës.',
    kind: 'campaign-completion',
    frequency: 'ad-hoc',
    service: 'ads',
    blocks: [
      b('executive-summary', 'Përmbledhje e fushatës', { v: C, required: true, locked: true }),
      b('kpi-cards', 'Rezultatet përfundimtare', { v: C, required: true, kpis: ['ad_spend', 'leads_ads', 'conversions', 'ad_revenue', 'roas', 'cost_per_lead'] }),
      b('goal-vs-actual', 'Arritja ndaj objektivave', { v: C, required: true }),
      b('table', 'Performanca sipas fushatës', { v: C, columns: 'campaigns' }),
      b('rich-text', 'Çfarë funksionoi', { v: C, required: true }),
      b('rich-text', 'Çfarë nuk funksionoi', { v: C, required: true }),
      b('recommendation', 'Rekomandime për fushatën tjetër', { v: C, required: true }),
    ],
  },

  // ── 13. Incident ──
  {
    key: 'incident',
    name: 'Raport incidenti',
    description: 'Çfarë ndodhi, ndikimi, zgjidhja dhe masat parandaluese.',
    kind: 'incident',
    frequency: 'ad-hoc',
    blocks: [
      b('executive-summary', 'Çfarë ndodhi', { v: C, required: true, locked: true }),
      b('timeline', 'Kronologjia e incidentit', { v: C, required: true, locked: true }),
      b('rich-text', 'Ndikimi tek klienti', { v: C, required: true }),
      b('rich-text', 'Shkaku rrënjësor', { v: C, required: true }),
      b('work-completed', 'Veprimet korrigjuese', { v: C, required: true }),
      b('next-steps', 'Masat parandaluese', { v: C, required: true, locked: true }),
      b('rich-text', 'Analizë e brendshme & përgjegjësi', { v: M, locked: true }),
    ],
  },

  // ── 14. Client risk (internal) ──
  {
    key: 'client-risk',
    name: 'Raport rreziku i klientit',
    description: 'Vetëm brenda: shëndeti i llogarisë, rreziku i largimit dhe plani.',
    kind: 'client-risk',
    frequency: 'ad-hoc',
    blocks: [
      b('executive-summary', 'Vlerësim i rrezikut', { v: M, required: true, locked: true }),
      b('kpi-cards', 'Shëndeti i llogarisë', { v: M, kpis: ['gross_margin', 'budget_used'], locked: true }),
      b('risk-register', 'Faktorët e rrezikut', { v: M, columns: 'risks', required: true }),
      b('rich-text', 'Historiku i komunikimit', { v: M }),
      b('recommendation', 'Plani i shpëtimit', { v: M, required: true, locked: true }),
      b('next-steps', 'Veprimet & përgjegjësit', { v: M, required: true }),
    ],
  },

  // ── 15. Daily employee report (mirrors the dailyReports form) ──
  {
    key: 'daily-employee',
    name: 'Raport ditor i punonjësit',
    description: 'Struktura e raportit ditor — burimi i vërtetësisë mbetet forma ditore.',
    kind: 'weekly-staff',
    frequency: 'daily',
    blocks: [
      b('rich-text', 'Çfarë përfundova sot', { required: true, locked: true }),
      b('rich-text', 'Mbi çfarë po punoj', { required: true, locked: true }),
      b('rich-text', 'Çfarë do punoj më pas', { required: true, locked: true }),
      b('blocker-list', 'Çfarë më bllokon', { source: 'auto:blockers', locked: true }),
      b('rich-text', 'Afate/klientë në rrezik'),
      b('rich-text', 'Kërkoj aprovim / suport'),
      b('rich-text', 'Çfarë duhet të dijë menaxhimi', { v: M }),
    ],
  },
];

export const TEMPLATE_SEED_BY_KEY: Record<string, TemplateSeed> = Object.fromEntries(
  TEMPLATE_SEEDS.map(t => [t.key, t]),
);

/** Expand the compact spec into real blocks. `kpiResolver` maps catalog key → id. */
export function expandBlocks(
  specs: BlockSpec[],
  kpiResolver: (key: string) => string | undefined = k => k,
): ReportBlock[] {
  return normaliseOrder(specs.map((spec, i) => createBlock(spec.type, i, {
    id: `${spec.type}-${i}`,
    title: spec.title,
    description: spec.description,
    visibility: spec.v ?? 'internal',
    required: spec.required,
    locked: spec.locked,
    source: spec.source,
    chart: spec.chart,
    comparePeriod: spec.comparePeriod,
    columns: spec.columns ? TABLE_PRESETS[spec.columns] : undefined,
    rows: spec.columns ? [] : undefined,
    kpiIds: spec.kpis
      ? spec.kpis.map(k => kpiResolver(k)).filter((v): v is string => !!v)
      : undefined,
    inPortal: spec.inPortal,
    inPdf: spec.inPdf,
  })));
}

/** A full template document body (minus doc/tenant fields) from a seed. */
export function templateFromSeed(
  seed: TemplateSeed,
  kpiResolver?: (key: string) => string | undefined,
): Omit<ReportTemplate, 'id' | 'businessId' | 'createdAt' | 'updatedAt'> {
  return {
    key: seed.key,
    name: seed.name,
    description: seed.description,
    kind: seed.kind,
    frequency: seed.frequency,
    service: seed.service,
    version: 1,
    blocks: expandBlocks(seed.blocks, kpiResolver),
    isSystem: true,
    isDefault: false,
    usageCount: 0,
    archivedAt: null,
  };
}

/**
 * Pick the template that best fits a report being created. Most specific wins:
 * customer-assigned > service+kind > kind default > kind.
 */
export function pickTemplate(
  templates: ReportTemplate[],
  criteria: { kind: ReportKind; frequency?: ReportFrequency; service?: ReportService; customerId?: string; department?: string },
): ReportTemplate | undefined {
  const live = templates.filter(t => !t.archivedAt && t.kind === criteria.kind);
  const score = (t: ReportTemplate): number => {
    let s = 0;
    if (criteria.customerId && (t.appliesToCustomerIds || []).includes(criteria.customerId)) s += 16;
    if (criteria.department && (t.appliesToDepartments || []).includes(criteria.department)) s += 8;
    if (criteria.service && t.service === criteria.service) s += 4;
    if (criteria.frequency && t.frequency === criteria.frequency) s += 2;
    if (t.isDefault) s += 1;
    return s;
  };
  return [...live].sort((a, b) => score(b) - score(a))[0];
}

/**
 * Create a report body from a template.
 *
 * The blocks are DEEP-COPIED and the template's key + version are stamped on the
 * report, so a later template edit can never rewrite this report (rule 11/15). The
 * `id` of each block is re-derived per report so two reports never share block ids.
 */
export function instantiateTemplate(
  template: Pick<ReportTemplate, 'id' | 'key' | 'version' | 'blocks' | 'kind' | 'service' | 'name'>,
  args: {
    businessId: string;
    teamId?: string;
    authorUserId: string;
    period: ReportPeriod;
    title?: string;
    customerId?: string;
    customerName?: string;
    projectId?: string;
    projectName?: string;
    subjectUserId?: string;
    department?: string;
    reviewerUserId?: string | null;
    approverUserId?: string | null;
    accountManagerUserId?: string | null;
    projectManagerUserId?: string | null;
    currency?: string;
    scheduleId?: string;
    generationKey?: string;
    dueAt?: Date;
  },
): Omit<Report, 'id' | 'createdAt' | 'updatedAt'> {
  const blocks = normaliseOrder((template.blocks || []).map((blk, i) => ({
    ...blk,
    // Structured clone of nested payloads so editing a report never mutates the
    // template document held in the same client-side cache.
    columns: blk.columns ? blk.columns.map(c => ({ ...c })) : undefined,
    rows: blk.rows ? blk.rows.map(r => ({ ...r })) : undefined,
    items: blk.items ? [...blk.items] : undefined,
    kpiIds: blk.kpiIds ? [...blk.kpiIds] : undefined,
    attachments: blk.attachments ? blk.attachments.map(a => ({ ...a })) : undefined,
    settings: blk.settings ? { ...blk.settings } : undefined,
    id: `${blk.type}-${i}`,
    order: i,
  })));

  const subjectLabel = args.customerName || args.projectName || '';
  const title = args.title
    || `${template.name}${subjectLabel ? ` — ${subjectLabel}` : ''} · ${formatPeriodLabel(args.period)}`;

  return {
    businessId: args.businessId,
    teamId: args.teamId,
    kind: template.kind,
    title,
    status: 'draft',
    period: args.period,
    service: template.service,
    customerId: args.customerId,
    customerName: args.customerName,
    projectId: args.projectId,
    projectName: args.projectName,
    subjectUserId: args.subjectUserId,
    department: args.department,
    authorUserId: args.authorUserId,
    reviewerUserId: args.reviewerUserId ?? null,
    approverUserId: args.approverUserId ?? null,
    accountManagerUserId: args.accountManagerUserId ?? null,
    projectManagerUserId: args.projectManagerUserId ?? null,
    blocks,
    kpiValues: [],
    currency: args.currency || 'EUR',
    templateId: template.id,
    templateKey: template.key,
    templateVersion: template.version,
    version: 1,
    revision: 1,
    viewCount: 0,
    dueAt: args.dueAt,
    scheduleId: args.scheduleId,
    generationKey: args.generationKey,
    deletedAt: null,
    remindersSent: [],
    escalationsSent: [],
  };
}

/**
 * Duplicate a template as a new editable copy (a tenant may not edit a system
 * template in place — history would silently change under existing reports).
 */
export function duplicateTemplate(
  source: ReportTemplate,
  name: string,
): Omit<ReportTemplate, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    businessId: source.businessId,
    teamId: source.teamId,
    key: `${source.key}-copy-${source.version}`,
    name,
    description: source.description,
    kind: source.kind,
    frequency: source.frequency,
    service: source.service,
    version: 1,
    blocks: source.blocks.map((b2, i) => ({ ...b2, id: `${b2.type}-${i}`, order: i })),
    appliesToDepartments: source.appliesToDepartments ? [...source.appliesToDepartments] : undefined,
    appliesToCustomerIds: source.appliesToCustomerIds ? [...source.appliesToCustomerIds] : undefined,
    appliesToProjectTypes: source.appliesToProjectTypes ? [...source.appliesToProjectTypes] : undefined,
    isDefault: false,
    isSystem: false,
    usageCount: 0,
    archivedAt: null,
  };
}
