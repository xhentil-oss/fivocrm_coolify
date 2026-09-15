// Firebase/Firestore type definitions for the application

// Enterprise Reporting & Accountability module. Kept in its own file (the barrel is
// already ~1700 lines) but re-exported here so consumers still import from '../types'.
export * from './reporting';
import type { DailyReportAccountability } from './reporting';

export interface WhatsAppAccount {
  id: string;
  teamId: string;
  label: string;
  assignedToUserId?: string | null;
  assignedToName?: string | null;
  enabled: boolean;
  connectedPhone?: string | null;
  lastConnectedAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface WhatsAppMessage {
  id: string;
  phone: string;
  jid?: string | null;
  direction: 'inbound' | 'outbound';
  message: string;
  leadId?: string | null;
  leadName?: string | null;
  pushName?: string | null;
  waMessageId?: string | null;
  teamId?: string;
  status: 'sent' | 'delivered' | 'read' | 'received' | 'failed';
  channel?: 'baileys' | 'meta';
  channelPhone?: string;
  metaPhoneNumberId?: string;
  isTemplate?: boolean;
  templateName?: string;
  broadcastId?: string;          // set when sent as part of a broadcast campaign
  sentByUid?: string;
  mediaType?: 'image' | 'video' | 'audio' | 'document' | 'sticker';
  mediaUrl?: string;
  createdAt: Date;
  updatedAt: Date;
}

// One service-specific message inside a campaign. The FIRST (most specific)
// variant whose tags match the contact wins; a variant with no tags is the
// fallback. Bodies use named tokens — {{name}}, {{company}}, {{notes}},
// {{service}}, {{link}} — rendered by `renderWaMessage`.
export interface WhatsAppMessageVariant {
  id: string;
  label?: string;                     // internal name, e.g. "SEO — riaktivizim"
  tags: string[];                     // service tags that select this variant ([] = fallback)
  body: string;
  landingUrl?: string;                // "more info" link for THIS service
}

// A bulk WhatsApp campaign (template-only, Meta channel).  The cron processor
// resolves the segment to leads at send time and logs each send to
// whatsappMessages tagged with broadcastId (for idempotency / resume).
export interface WhatsAppBroadcast {
  id: string;
  teamId: string;
  name: string;
  templateId: string;
  channel?: 'meta' | 'baileys';       // send channel (default 'meta')
  channelPhoneNumberId?: string;      // Meta: which channel sends
  agentId?: string;                   // Baileys: which agent sends
  segment: {
    audience?: ('leads' | 'customers')[]; // who to target (default ['leads'])
    statuses?: string[];              // Lead.status values (leads only)
    tags?: string[];                  // tags on leads/customers
    tagMatch?: 'any' | 'all';         // match ANY (default) or ALL selected tags
    tag?: string;                     // @deprecated single-tag (back-compat)
    categories?: string[];            // Lead.businessCategory values (ANY match); a customer
                                      // inherits the category of the lead it came from
    assignedToUserId?: string;        // assignedToUserId (leads + customers)
    source?: string;                  // filter by origin (e.g. 'whmcs') — leads + customers
    hasDomain?: boolean;              // only customers with a registered WHMCS domain
  };
  // ── Conditions layered on top of the segment (src/lib/marketing/waAutomation.ts) ──
  // Dormancy is what makes re-engagement possible: "leads we haven't touched in
  // 30 days". It also IS the cooldown for an evergreen rule — a contact we just
  // messaged has a fresh last-contact date and cannot be picked up again until
  // the window passes, which is why no per-person enrollment record exists.
  conditions?: {
    lastContactMinDays?: number;      // ≥ N days since the last contact (dormancy)
    lastContactMaxDays?: number;      // …and ≤ M days (skip ancient, dead contacts)
    requireContacted?: boolean;       // exclude contacts nobody ever touched
    requireNotes?: boolean;           // only contacts with notes (so {{notes}} isn't empty)
    dailyCap?: number;                // evergreen: max sends per run
  };
  // 'dormant' automations are EVERGREEN: they re-resolve the segment every run
  // and use active/paused instead of draft→queued→completed (mirrors the email
  // module's 'purchase' trigger).
  trigger?: 'manual' | 'dormant';
  // Per-service message variants. The variant is chosen by the CONTACT's tags,
  // so one rule serves "interested in SEO" and "interested in Ads" with
  // different text and different landing pages. Absent = use `templateId`.
  variants?: WhatsAppMessageVariant[];
  landingUrl?: string;                // default "more info" link (variants may override)
  utm?: { source?: string; medium?: string; campaign?: string; content?: string };
  scheduledAt?: Date | null;
  status: 'draft' | 'queued' | 'sending' | 'completed' | 'failed' | 'active' | 'paused';
  totalTargets?: number;
  sentCount?: number;
  sentPhones?: string[];              // idempotency: recipients already sent (one-shot only)
  /** Per-reason count of who the segment excluded on the last run (diagnostics). */
  lastRunBlocked?: Record<string, number>;
  lastRunAt?: Date;                   // evergreen: when the rule last evaluated
  error?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
  createdByUserId?: string | null;
}

// Per-conversation metadata managed from the WhatsApp Inbox (assignment,
// internal notes, status).  Doc id = `${teamId}_${phone}`.  Distinct from the
// server-owned `whatsappConversations` (which tracks the 24h window).
export interface WhatsAppThread {
  id: string;
  teamId: string;
  phone: string;
  assignedToUserId?: string | null;
  assignedToName?: string | null;
  internalNote?: string | null;
  status?: 'open' | 'pending' | 'closed';
  updatedAt?: Date;
  updatedByUserId?: string | null;
}

// Saved WhatsApp template (maps to a Meta-approved HSM template).  The body
// holds {{1}}, {{2}}… positional placeholders; paramFields maps each positional
// param to a Lead field key (e.g. 'name', 'company') or 'custom' for free input.
export interface WhatsAppTemplate {
  id: string;
  teamId: string;
  name: string;                 // human label shown in the picker
  metaTemplateName: string;     // the approved name registered in Meta
  language: string;             // e.g. 'sq', 'en_US'
  category?: string;            // MARKETING | UTILITY | etc. (informational)
  body: string;                 // preview text with {{1}}.. placeholders
  paramFields?: string[];       // per-positional-param Lead field key or 'custom'
  createdAt?: Date;
  updatedAt?: Date;
  createdByUserId?: string | null;
}

// ── Marketing module ─────────────────────────────────────────────────────────
// One email in a drip sequence. `delayDays` is the offset from enrollment
// (step 0 → day 0 = immediate). Body comes from a template or inline HTML.
export interface EmailStep {
  delayDays: number;
  subject?: string;       // falls back to campaign.subject / template subject
  templateId?: string;    // render from a saved EmailTemplate
  htmlBody?: string;      // inline HTML when no template
}

// A recipient enrolled in a (multi-step) campaign — the per-person progress
// tracker for drip sequences. Created by purchase automations; advanced by the
// campaign-steps cron.
export interface CampaignEnrollment {
  id: string;
  teamId: string;
  businessId?: string;
  campaignId: string;
  email: string;
  name?: string;
  company?: string;
  currentStep: number;              // next step index to send
  status: 'active' | 'completed' | 'stopped';
  enrolledAt?: Date;
  lastSentAt?: Date | null;
  nextSendAt?: Date | null;         // when currentStep is due
  sentSteps?: number[];             // idempotency: step indexes already sent
  sourceInvoiceId?: string;         // purchase enrollments
  createdAt?: Date;
  updatedAt?: Date;
}

// An email marketing campaign. Deliberately mirrors WhatsAppBroadcast so the
// segment builder, idempotency model and cron sender share the same shape.
export interface EmailCampaign {
  id: string;
  teamId: string;
  businessId?: string;
  name: string;                 // internal label ("Oferta e Marsit")
  subject: string;              // email subject line
  fromName?: string;            // display sender name (default team/brand name)
  preheader?: string;           // short preview text shown after the subject
  templateId?: string;          // optional: render from a saved EmailTemplate
  htmlBody?: string;            // inline HTML when no template is chosen
  segment: {
    audience?: ('leads' | 'customers')[]; // who to target (default ['leads'])
    statuses?: string[];              // Lead.status values (leads only)
    tags?: string[];                  // tags on leads/customers
    tagMatch?: 'any' | 'all';         // match ANY (default) or ALL selected tags
    assignedToUserId?: string;        // assignedToUserId (leads + customers)
    source?: string;                  // filter by origin (e.g. 'whmcs') — leads + customers
    hasDomain?: boolean;              // only customers with a registered WHMCS domain
  };
  // 'purchase' campaigns auto-fire when a customer buys a matching service.
  // Manual campaigns use draft→queued→sending→completed; purchase automations
  // are evergreen and use active/paused instead.
  trigger?: 'manual' | 'purchase';
  triggerServiceIds?: string[];       // purchase trigger: which services fire it (empty = any purchase)
  // Drip sequence (purchase automations). When present, buyers are enrolled and
  // each step is sent after its delayDays. Absent = single email (subject/body).
  steps?: EmailStep[];
  scheduledAt?: Date | null;
  status: 'draft' | 'queued' | 'sending' | 'completed' | 'failed' | 'active' | 'paused';
  totalTargets?: number;
  sentCount?: number;
  failedCount?: number;
  deliveredCount?: number;            // ESP webhook: delivered events
  openCount?: number;                 // ESP webhook: unique/total opens
  clickCount?: number;                // ESP webhook: link clicks
  sentEmails?: string[];              // idempotency: recipients already emailed
  error?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
  createdByUserId?: string | null;
}

// ── Social Media analytics (Meta: Facebook Pages + Instagram) ─────────────
// A connected social account whose analytics FivoCRM pulls on the client's
// behalf. The access token lives here — this is a STAFF-ONLY collection, never
// read by the portal. Clients only ever read the derived SocialSnapshot docs.
export interface SocialAccount {
  id: string;
  teamId: string;
  businessId?: string;
  customerId: string;            // CRM customer this account belongs to (drives portal scoping of snapshots)
  platform: 'facebook' | 'instagram' | 'search-console';
  name: string;                  // Page name / IG @handle / GSC site shown in the UI
  externalId: string;            // FB Page id, IG business account id, or GSC siteUrl (sc-domain:… / https://…)
  pageId?: string;               // instagram: the linked FB Page id (insights are page-mediated)
  username?: string;             // IG @handle / page vanity name
  pictureUrl?: string;           // avatar
  accessToken: string;           // Meta: long-lived Page token · GSC: Google refresh token (server-only, never sent to portal)
  tokenExpiresAt?: Date | null;  // null = never expires (system-user / refresh token)
  connected: boolean;            // false after a disconnect (row kept for history)
  lastSyncedAt?: Date | null;
  lastSyncError?: string | null;
  createdAt: Date;
  updatedAt: Date;
  createdByUserId: string | null;
}

export interface SocialMetrics {
  reach: number;                 // unique accounts reached
  impressions: number;           // total impressions / views
  engagement: number;            // reactions + comments + shares/saves
  followers: number;             // follower / fan count at period end
  followerGrowth: number;        // net change over the period
  profileViews?: number;
  postsCount?: number;           // posts published in the period
  linkClicks?: number;
  engagementRate?: number;       // engagement / reach (%), precomputed for the UI
}

export interface SocialDailyPoint {
  date: string;                  // 'YYYY-MM-DD'
  reach?: number;
  impressions?: number;
  engagement?: number;
  followers?: number;
}

export interface SocialPost {
  id: string;
  caption?: string;
  permalink?: string;
  thumbnailUrl?: string;
  mediaType?: string;            // IMAGE | VIDEO | CAROUSEL_ALBUM | REEL
  timestamp?: Date;
  likes?: number;
  comments?: number;
  shares?: number;
  saves?: number;
  reach?: number;
  engagement?: number;
}

export interface SocialDemographics {
  age?: Record<string, number>;     // e.g. { '18-24': 1200, '25-34': 3400, ... }
  gender?: Record<string, number>;  // e.g. { 'M': 1000, 'F': 900, 'U': 50 }
  city?: Record<string, number>;
  country?: Record<string, number>;
}

// ── Google Search Console (website search visibility) ──────────────────────
export interface SeoMetrics {
  clicks: number;
  impressions: number;
  ctr: number;        // click-through rate, 0-100 (%)
  position: number;   // average position (lower = better)
  clicksGrowth?: number; // vs the prior month, if computed
}
export interface SeoDailyPoint {
  date: string;       // 'YYYY-MM-DD'
  clicks: number;
  impressions: number;
}
export interface SeoRow {
  key: string;        // the query text or page URL
  clicks: number;
  impressions: number;
  ctr: number;        // %
  position: number;
}
export interface SeoSnapshot {
  metrics: SeoMetrics;
  daily: SeoDailyPoint[];
  topQueries: SeoRow[];
  topPages: SeoRow[];
  countries?: Record<string, number>; // clicks by country code
  devices?: Record<string, number>;   // clicks by device (DESKTOP/MOBILE/TABLET)
}

// ── Google Reviews (Business Profile / GMB) ────────────────────────────────
// A connected Google Business Profile location. The Google REFRESH token lives
// here — STAFF-ONLY, deny-all collection (like SocialAccount): the UI fetches a
// token-stripped list via GET /api/gmb?action=list, never through Firestore.
export interface GmbAccount {
  id: string;                       // `${businessId}_gmb_${locationId}` — idempotent connect
  teamId: string;
  businessId?: string;
  customerId?: string | null;       // optional CRM customer this profile belongs to (agency use)
  name: string;                     // business title on Google
  address?: string | null;
  accountName: string;              // Google resource: 'accounts/123'
  locationName: string;             // Google resource: 'locations/456'
  refreshToken: string;             // Google OAuth refresh token (server-only)
  oauthClientId?: string;           // OAuth client the refresh token was minted under (client-bound!)
  connected: boolean;               // false after disconnect (reviews kept for history)
  rating?: number | null;           // Google's own averageRating (not recomputed locally)
  reviewCount?: number;             // Google's totalReviewCount
  starCounts?: Record<string, number>; // distribution over the mirrored reviews ('1'..'5')
  starCountsComplete?: boolean;     // false → distribution covers only the newest mirrored reviews
  lastSyncedAt?: Date | null;
  lastSyncError?: string | null;
  createdAt: Date;
  updatedAt: Date;
  createdByUserId: string | null;
}

// One mirrored Google review. Written EXCLUSIVELY by the server sync/reply
// endpoints (client writes are denied) — replies go to Google first, then the
// doc is stamped, so the mirror never claims a reply Google doesn't have.
export interface GmbReview {
  id: string;                       // `${accountId}_${reviewId}` — idempotent upsert key
  teamId: string;
  businessId?: string;
  customerId?: string | null;
  accountId: string;                // ref → GmbAccount doc id
  locationTitle: string;            // denormalized for lists
  reviewId: string;                 // Google's review id (used for the reply call)
  author: string;
  authorPhotoUrl?: string | null;
  starRating: number;               // 1..5
  comment: string;                  // may be '' (stars-only review)
  googleCreateTime?: string | null; // ISO strings as returned by Google
  googleUpdateTime?: string | null;
  replyComment?: string | null;     // the public owner reply visible on Google
  replyTime?: string | null;
  repliedVia?: 'manual' | 'ai-auto' | null;
  repliedByUserId?: string | null;
  /** Cached AI drafts (generated once per review, on demand). */
  aiSuggestion?: string | null;
  aiReportAnalysis?: string | null;
  /** INTERNAL report mark — Google has no flag/report API; this tracks the manual filing. */
  reported?: { reason: string; argument?: string; reportedAt: Date; reportedByUserId: string } | null;
  firstSyncedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

// A local post published to the Google profile via the API (mirror of what went out).
export interface GmbPost {
  id: string;
  teamId: string;
  businessId?: string;
  accountId: string;
  locationTitle: string;
  summary: string;
  ctaType?: string | null;          // LEARN_MORE | BOOK | ORDER | SHOP | SIGN_UP | CALL
  ctaUrl?: string | null;
  mediaUrl?: string | null;
  googleName?: string | null;       // Google resource name of the created post
  state?: string;                   // LIVE | REJECTED | PROCESSING …
  searchUrl?: string | null;        // public link to the post
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
}

// A monthly analytics snapshot for one SocialAccount. Written once per month by
// the cron sync (one Graph API call per account → one doc), so Firebase cost is
// negligible. Holds headline metrics + a daily breakdown + top posts. This is
// the ONLY social collection the client portal reads (scoped by customerId).
export interface SocialSnapshot {
  id: string;                    // `${accountId}_${period}` — idempotent upsert key
  teamId: string;
  businessId?: string;
  customerId: string;            // portal scoping
  accountId: string;
  platform: 'facebook' | 'instagram' | 'search-console';
  accountName: string;           // denormalized (portal never reads SocialAccount)
  username?: string;
  pictureUrl?: string;
  period: string;                // 'YYYY-MM' — the reported month
  periodStart: Date;
  periodEnd: Date;
  // Social platforms fill these; a search-console snapshot fills `seo` instead.
  metrics?: SocialMetrics;
  daily?: SocialDailyPoint[];    // per-day breakdown within the month
  topPosts?: SocialPost[];       // best posts of the month
  demographics?: SocialDemographics; // audience split (IG business, ≥100 followers)
  seo?: SeoSnapshot;             // Google Search Console (platform === 'search-console')
  fetchedAt: Date;
  createdAt: Date;
  updatedAt: Date;
  createdByUserId: string | null;
}

// A reusable HTML email template. Body supports {{name}}, {{company}}, {{email}}
// merge tokens filled per-recipient by the sender.
export interface EmailTemplate {
  id: string;
  teamId: string;
  businessId?: string;
  name: string;                 // human label shown in the picker
  subject: string;              // default subject (campaign can override)
  html: string;                 // body HTML with {{token}} placeholders
  category?: string;            // 'marketing' | 'newsletter' | 'onboarding' | ...
  createdAt?: Date;
  updatedAt?: Date;
  createdByUserId?: string | null;
}

export interface Project {
  id: string;
  name: string;
  description?: string;
  status: 'Planning' | 'Active' | 'In Review' | 'On Hold' | 'Completed' | 'Archived' | 'Cancelled';
  teamId?: string;
  /** Tenant/isolation key — stamped on every project; the type was missing it
   *  even though the code (and the business-scoped queries) rely on it. */
  businessId?: string;
  customerId?: string;
  budget?: number;
  /** Monedha e `budget`/`spent`. Kur mungon, trajtohet si ALL (projektet legacy). */
  currency?: 'ALL' | 'EUR';
  // How `budget` is interpreted for profit/P&L. 'one-time' = a single deal value
  // (web build, branding). 'monthly' = a recurring monthly fee (SEO, social,
  // maintenance) — the P&L multiplies it by the months active in the period.
  // When unset, inferred from isRecurring (recurring → monthly, else one-time).
  billingType?: 'one-time' | 'monthly';
  /** Department / service line this project belongs to (e.g. "Social", "SEO",
   *  "Web"). Groups per-project profit into department P&L. Matches the service
   *  categories used by TeamMember.serviceLines. */
  department?: string;
  /** Day of month (1-31) a MONTHLY recurring project issues its invoice. Unset =
   *  bill as soon as the period opens (day 1, the legacy behaviour). Clamped to
   *  the last day in shorter months. Ignored for weekly/one-time projects. */
  billingDayOfMonth?: number;
  /** Expected/actual start date. Used by the next-month forecast to count a
   *  one-time project's budget as revenue in the month it kicks off. */
  startDate?: Date;
  spent?: number;
  responsibleUserId?: string;
  memberUserIds?: string[];
  guestUserIds?: string[];  // Users with read-only + comment access to this project
  // Manual revenue split among staff. When empty/unset, 100% of the project value
  // (budget) is credited to responsibleUserId. When set, percents should sum to 100.
  profitSplit?: Array<{ userId: string; percent: number }>;
  sourceQuestionnaireId?: string; // ServiceInquiry that this project was created from
  // Recurring project support
  isRecurring?: boolean;
  recurringFrequency?: 'weekly' | 'monthly';
  nextRecurringDate?: Date;
  lastCompletedAt?: Date; // used for bonus calculation instead of updatedAt
  /** Services attached to the project (used to price the auto-created invoice). */
  serviceIds?: string[];
  // ── Recurring BILLING (see src/lib/finance/recurringBilling.ts) ──
  /** Pauses automatic invoicing without ending the series. */
  isRecurringPaused?: boolean;
  /** "Repeat until" — the cron stops billing past this date and clears isRecurring. */
  recurringEndDate?: Date;
  /** Idempotency token: the billing period already invoiced ('2026-08' / 'W2026-08-03').
   *  Written by BOTH the UI (first invoice at creation) and the cron, so the same
   *  period can never be billed twice. */
  lastInvoicePeriodKey?: string;
  lastInvoiceGeneratedAt?: Date;
  /** Why automatic billing was switched off ('manual' = the owner, from the UI;
   *  'terminal-status' / 'series-ended' = the cron; 'archived' = the archive). */
  recurringBillingStoppedReason?: string;
  recurringBillingStoppedAt?: Date;
  /** Debounce for the "recurring project has no budget" warning (one per period). */
  zeroBudgetNoticePeriodKey?: string;
  /** Debounce for the "billing settings contradict each other" warning. */
  billingConfigNoticeKey?: string;
  // ── Archive (see src/lib/projectArchive.ts) ──
  /** When the project was last put in the archive. `status === 'Archived'` — not
   *  this field — is what "is archived" means. */
  archivedAt?: Date;
  archivedByUserId?: string | null;
  /** The status the project had before archiving, so restore puts it back where
   *  it was instead of flattening everything to 'Active'. */
  statusBeforeArchive?: Project['status'];
  /** It was a live retainer when archived — restore switches billing back on.
   *  Archiving always stops billing ('Archived' is a terminal billing status). */
  wasRecurringBeforeArchive?: boolean;
  // ── Written by the project-spend-rollup cron (never by the UI) ──
  laborCost?: number;
  billableValue?: number;
  loggedHours?: number;
  /** Last rollup pass. Separate from `updatedAt` on purpose — the P&L period
   *  falls back to `updatedAt`, so the rollup must not bump it. */
  spendRolledUpAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  createdByUserId: string | null;
}

/**
 * A Business is the tenant / isolation boundary (two-level model: Business > Team).
 * Teams become departments WITHIN a business and share the business's data.
 */
export interface Business {
  id: string;
  name: string;
  ownerId: string;            // uid of the owner (matches createdByUserId)
  ownerEmail?: string;
  plan?: 'trial' | 'starter' | 'pro' | 'business' | 'enterprise';
  status?: 'trialing' | 'active' | 'past_due' | 'suspended' | 'canceled';
  trialEndsAt?: Date;
  // ── Subscription billing (written ONLY by the Stripe webhook / lifecycle cron;
  // Firestore rules forbid a tenant from editing its own plan/status) ──
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  /** End of the paid period currently covered. */
  currentPeriodEnd?: Date;
  /** Set when a payment fails or a trial expires — starts the grace countdown. */
  pastDueSince?: Date;
  /** When the tenant was frozen (writes denied by rules). */
  suspendedAt?: Date;
  lastPaymentAt?: Date;
  cancelAtPeriodEnd?: boolean;
  /** Seats included by the plan (see api/_billingPlans.ts PLAN_SEATS). */
  seats?: number;
  /**
   * What Stripe ACTUALLY bills, normalised to one month, in cents — written by the
   * webhook from the subscription (yearly ÷ 12, quantity, coupons all applied). The
   * console prefers this over the price-list estimate. 0 once the tenant stops paying.
   */
  mrrCents?: number;
  billingCurrency?: string;
  /** 'month' | 'year' | '3month' … as billed. */
  billingInterval?: string;
  billingQuantity?: number;
  /** Stripe test vs live — decides which Stripe dashboard URL the console links to. */
  stripeLivemode?: boolean;
  /** Denormalised counts so the console never reads every tenant's members/teams. */
  memberCount?: number;
  teamCount?: number;
  /** A team of this business, used when entering the workspace from the console. */
  defaultTeamId?: string | null;
  /** Optional per-tenant overrides negotiated on an Enterprise contract. */
  limits?: {
    seats?: number;
    customers?: number;
    invoicesPerMonth?: number;
    storageMb?: number;
  };
  billingEmail?: string;
  /** First time this tenant ever became `active` — the trial→paid conversion moment. */
  activatedAt?: Date;
  /** When the subscription was canceled (used for churn cohorts). */
  canceledAt?: Date;
  /**
   * Engagement snapshot, written by the `tenant-usage-rollup` cron (never by the
   * tenant). Without it the console cannot tell a live trial from a dead one, nor
   * spot the tenant whose volume is driving platform cost.
   */
  usage?: {
    /** Most recent write seen across the tenant's signal collections. */
    lastActivityAt?: Date;
    /** Distinct staff users who did something in the last 7 days. */
    activeUsers7d?: number;
    /** Cheap `count()` aggregations per collection — volume, not content. */
    docCounts?: Record<string, number>;
    /** Sum of the counts above — the single number to sort/alert on. */
    docsTotal?: number;
    computedAt?: Date;
  };
  /** Nav paths disabled for this tenant (super-admin toggles per business). */
  disabledModules?: string[];
  /** Portal subdomain for this tenant: `<portalSubdomain>.fivocrm.com/portal`.
   * Resolves hostname → businessId so this tenant's clients register/scope to it. */
  portalSubdomain?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * One month of platform-level history (`platformMetrics/{YYYY-MM}`), written by the
 * `platform-metrics-rollup` cron and readable only by a platform super-admin.
 *
 * The tenant list answers "what is true now"; this answers "are we growing" —
 * signups, trial→paid conversion, churn and MRR over time.
 */
export interface PlatformMetrics {
  id: string;              // 'YYYY-MM'
  month: string;           // same as id, stored for queries
  tenantsTotal: number;
  tenantsActive: number;
  tenantsTrialing: number;
  tenantsPastDue: number;
  tenantsSuspended: number;
  tenantsCanceled: number;
  /** Businesses created during the month. */
  signups: number;
  /** Tenants whose FIRST activation happened during the month (converted). */
  activated: number;
  /** Tenants canceled or suspended during the month. */
  churned: number;
  /** MRR in EUR at the time of the rollup (end of month once the month is over). */
  mrr: number;
  arr: number;
  computedAt?: Date;
  updatedAt?: Date;
}

export interface Team {
  id: string;
  name: string;
  department?: string;
  /** Two-level tenancy: the business (tenant) this team/department belongs to. */
  businessId?: string;
  // ── SaaS tenant fields (self-serve signup) ──
  /** Owner's email at signup — convenience copy of the createdByUserId's email. */
  ownerEmail?: string;
  /** Subscription plan key. 'trial' until they pick a paid plan. */
  plan?: 'trial' | 'starter' | 'pro' | 'business' | 'enterprise';
  /** Tenant lifecycle status — gates access when not active/trialing. */
  status?: 'trialing' | 'active' | 'past_due' | 'suspended' | 'canceled';
  /** Trial expiry (set at signup). */
  trialEndsAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  createdByUserId: string | null;
}

export interface TeamMember {
  id: string;
  teamId: string;
  userId: string;
  email?: string;
  displayName?: string;
  role: 'Admin' | 'Sales' | 'SalesAgent' | 'Manager' | 'Member' | 'Viewer' | 'Guest';
  status: 'Active' | 'Inactive';
  canAccessProjects?: boolean;
  canAccessTasks?: boolean;
  canAccessCRM?: boolean;
  canAccessInvoices?: boolean;
  canAccessReports?: boolean;
  /**
   * Reporting capabilities (per-member overrides of the role defaults in
   * `src/lib/reporting/permissions.ts`). Undefined = use the role default, so
   * adding a capability later never silently revokes it for existing members.
   */
  canReviewReports?: boolean;
  canApproveReports?: boolean;
  canPublishReports?: boolean;
  canViewAllReports?: boolean;
  canViewConfidentialReports?: boolean;
  canManageReportTemplates?: boolean;
  canViewFinancialMetrics?: boolean;
  canAccessSettings?: boolean;
  canAccessWhatsapp?: boolean;
  canAccessGoals?: boolean;
  canAccessTeams?: boolean;
  canAccessChat?: boolean;
  canAccessCustomers?: boolean;
  canAccessServices?: boolean;
  /** Shop module (products, inventory, orders). */
  canAccessProducts?: boolean;
  /** Hosting & domains module. */
  canAccessHosting?: boolean;
  canAccessExpenses?: boolean;
  canAccessProfile?: boolean;
  /**
   * Per-member override of "may assign a task to someone else". Role defaults
   * (Admin/Manager/SalesAgent = yes, Member/Sales = no) live in usePermissions;
   * this flag lifts a single person above their role's default without promoting
   * them. Undefined = use the role default, so it can never silently revoke.
   */
  canAssignTasks?: boolean;
  monthlySalary?: number;
  /**
   * First day on payroll. Optional: when unset, `createdAt` is used instead
   * (see `memberStartDate` in lib/finance/salaryHistory.ts). It exists because
   * payroll used to be charged into every month back to the beginning of time,
   * inventing cost for months before the person was hired. Set it when someone
   * was employed BEFORE their record was created in the app.
   */
  hiredAt?: Date;
  /** Effective-dated salary changes, so historical months use the salary that
   *  applied then (not today's). Each entry = the monthly salary in effect from
   *  `effectiveFrom` until the next entry. When empty, `monthlySalary` is used
   *  for every month (backward-compatible). See lib/finance/salaryHistory.ts. */
  salaryHistory?: Array<{ monthlySalary: number; effectiveFrom: Date }>;
  /** Internal labor cost per hour (ALL). Used to cost logged time into project
   *  spend & per-client P&L. If unset, derived from monthlySalary / 160. */
  hourlyCostRate?: number;
  /** Optional billing rate per hour (ALL) — what the client is charged for this
   *  member's time. Used for realization (billable value vs logged cost). */
  hourlyBillRate?: number;
  /**
   * The member's CRAFT — what they actually do: 'social', 'design', 'web',
   * 'photo-video', 'regjia', 'seo', 'ads', 'dev', 'content', 'sales'.
   *
   * Deliberately separate from `role` (which is authorisation) and from
   * `serviceLines` (which is P&L cost allocation, drawn from the tenant's own
   * service categories). A Photo&Video person may have their salary charged to the
   * "Social Media" service while their craft — and therefore the questions their
   * daily report asks — is photo/video.
   *
   * Values are keys of REPORT_TEMPLATES (src/lib/productivity/reportTemplates.ts),
   * so the position and the daily-report fields it drives cannot drift apart.
   */
  position?: string;
  /** Service line(s) this member's labor belongs to (match service categories).
   *  Their salary is charged as a direct cost of these services in the P&L,
   *  split equally across them. `serviceLine` (singular) kept for back-compat. */
  serviceLine?: string;
  serviceLines?: string[];
  createdAt: Date;
  updatedAt: Date;
  createdByUserId: string | null;
}

export interface Task {
  id: string;
  title: string;
  description?: string;
  status: 'Todo' | 'In Progress' | 'Review' | 'Done';
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  teamId?: string;
  /** Tenant key — stamped on create; a task without it falls outside the
   *  business-scoped query and "disappears" from list & calendar. */
  businessId?: string;
  /** Derived from the parent project's customer; grants the portal client READ
   *  access to the task (rules) — re-derived whenever projectId or the
   *  project's customer changes. */
  customerId?: string;
  projectId?: string;
  assignedToUserId?: string;
  /** Optional label identifying which service this customer purchased */
  serviceLabel?: string;
  /** Optional linked service id from `services` collection */
  serviceId?: string;
  /** Whether the serviceLabel was set automatically */
  serviceAuto?: boolean;
  dueDate?: Date;
  startDate?: Date;
  endDate?: Date;
  parentTaskId?: string;
  dependsOn?: string[];
  /** Free-form colored labels/tags (Asana/Jira-style) for slicing tasks. */
  labels?: string[];
  /** Optional section/phase within a project (Asana sections), free-text. */
  section?: string;
  estimatedHours?: number;
  /** Optional billable value of this task, in the project's currency. Lets a
   *  project be priced task-by-task instead of (or alongside) a single budget. */
  value?: number;
  /** True once `value` has been added to the project's budget. Makes the increment
   *  idempotent: a backfill can tell which tasks are already counted. */
  valueAppliedToBudget?: boolean;
  isRecurring?: boolean;
  recurringFrequency?: 'daily' | 'weekly' | 'monthly' | 'yearly';
  recurringInterval?: number; // e.g. 2 = every 2 weeks/months
  recurringDayOfWeek?: number; // 0=Sunday, 1=Monday, ... 6=Saturday
  recurringDaysOfWeek?: number[]; // for daily: which weekdays to include (e.g. [1,2,3,4,5] = Mon-Fri)
  recurringDayOfMonth?: number; // 1-31
  recurringEndDate?: Date; // optional "repeat until" — no occurrences after this date
  nextRecurringDate?: Date;
  nextCycleCreated?: boolean;
  dueNotificationSent?: boolean;
  overdueNotificationSent?: boolean;
  /**
   * "Më kujto" (Asana/Salesforce-style reminder) — see src/lib/taskReminders.ts.
   * `reminderAt` is the absolute instant the cron (`task-reminders`) notifies the
   * assignee; `reminderOffsetMinutes` is set when it was chosen relative to the
   * deadline ("1 orë para") so a moved deadline carries the reminder with it;
   * `reminderSentAt` is the delivery idempotency mark. Cleared with explicit null.
   */
  reminderAt?: Date | null;
  reminderOffsetMinutes?: number | null;
  reminderSentAt?: Date | null;
  attachments?: string;
  collaboratorIds?: string[];
  createdAt: Date;
  updatedAt: Date;
  createdByUserId: string | null;
}

// ── Follow-up ("Ndjekja") — shared by Lead AND Customer ─────────────────────
// One pending NEXT STEP per contact, stored on the document itself. History is
// the timeline (`leadActivities` / `activities`); these fields only say what
// comes next and when the contact was last touched. All logic lives in
// `src/lib/crm/followUp.ts` — never hand-write these patches in a view.
export type FollowUpType = 'call' | 'whatsapp' | 'email' | 'meeting' | 'other';

export interface FollowUpFields {
  /** Day the next step is due (day granularity; compared in Europe/Tirane). */
  nextFollowUpDate?: Date | null;
  /** Channel of the next step — picks the row's primary action + the activity type on completion. */
  nextFollowUpType?: FollowUpType | null;
  /** One-line note for the next step ("diskuto çmimin", "dërgo ofertën"). */
  followUpNote?: string | null;
  /** Last time a follow-up was completed / the contact was deliberately touched. */
  lastFollowUpDate?: Date | null;
  /** Most recent activity of any kind (temperature / staleness basis). */
  lastActivityAt?: Date | null;
  /** Cron debounce: last "follow-up due" reminder sent to the owner. */
  lastReminderSentAt?: Date | null;
  /** Last inbound message from the contact (WhatsApp inbound handler). */
  lastInboundAt?: Date | null;
  /** The contact wrote to us and nobody has answered yet ("Presin përgjigje"). */
  awaitingReply?: boolean | null;
  /** Contact asked not to receive automated WhatsApp messages. */
  waOptOut?: boolean | null;
}

export type CustomerStatus = 'Active' | 'Inactive' | 'VIP' | 'Pending' | 'Suspended';

export interface Customer extends FollowUpFields {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  company?: string;
  address?: string;
  /** Optional client-editable profile fields (self-service portal). */
  website?: string;
  taxId?: string;
  avatarUrl?: string;
  teamId?: string;
  leadId?: string;
  assignedToUserId?: string;
  /** Set when the customer was imported/mirrored from WHMCS. */
  source?: 'whmcs' | string;
  /** WHMCS client id — idempotency key for the WHMCS → FivoCRM client sync. */
  whmcsClientId?: string;
  /** Opt-out: when true, this customer is NOT emailed/messaged about overdue invoices. */
  disableOverdueReminders?: boolean;
  // Back-office profile fields written by CustomersView's form (were `as any`).
  status?: CustomerStatus;
  tags?: string[];
  notes?: string;
  industry?: string;
  contactPerson?: string;
  creditLimit?: number;
  paymentTerms?: string;
  billingAddress?: string;
  shippingAddress?: string;
  createdAt: Date;
  updatedAt: Date;
  createdByUserId: string | null;
}

export interface Contract {
  id: string;
  teamId: string;
  customerId?: string;
  leadId?: string;
  invoiceId?: string;
  quoteId?: string;
  clientName: string;
  clientEmail?: string;
  title: string;
  body: string;
  packageSummary?: {
    label: string;
    currency: string;
    categories: { category: string; oneTime: number; monthly: number }[];
    totalOneTime: number;
    totalMonthly: number;
    grandTotal: number;
    discountLabel?: string;
    discountAmount?: number;
  };
  status: 'Draft' | 'Sent' | 'Signed' | 'Rejected' | 'Expired';
  sentAt?: Date;
  expiresAt?: Date;
  signedAt?: Date;
  signedByUserId?: string;
  signedByEmail?: string;
  signatureData?: string;
  signatureType?: 'drawn' | 'typed';
  rejectedAt?: Date;
  rejectionReason?: string;
  notes?: string;
  assignedToUserId?: string;
  assignedToName?: string;
  createdAt: Date;
  updatedAt: Date;
  createdByUserId: string | null;
}

export interface BankAccount {
  id: string;
  bankName: string;
  accountHolder: string;
  iban: string;
  swift?: string;
  country?: string;
}

export interface Invoice {
  id: string;
  invoiceNumber?: string;
  customerId?: string;
  projectId?: string;
  /** Set when this invoice was raised from a single task carrying a value. */
  taskId?: string;
  teamId?: string;
  amount: number;
  total?: number;
  subtotal?: number;
  discount?: number;
  discountType?: 'fixed' | 'percent';
  tax?: number;
  notes?: string;
  status: 'Draft' | 'Pending' | 'Paid' | 'Overdue' | 'Partial' | 'Cancelled';
  paymentMethod?: string;
  paymentUrl?: string;
  currency?: 'ALL' | 'EUR';
  bankName?: string;
  bankIBAN?: string;
  bankSWIFT?: string;
  bankAccountHolder?: string;
  bankCountry?: string;
  invoiceDate?: Date;
  dueDate?: Date;
  paidAt?: Date;
  paidAmount?: number;
  partialPayments?: { amount: number; paidAt: Date; method?: string; note?: string }[];
  emailSent?: boolean;
  reminderSent?: boolean;
  reminder25Sent?: boolean;
  reminderLastDaySent?: boolean;
  isRecurring?: boolean;
  isRecurringPaused?: boolean;
  recurringFrequency?: 'weekly' | 'monthly' | 'quarterly' | 'yearly';
  nextRecurringDate?: Date;
  /** Optional "repeat until" — cron stops generating past this date and clears
   *  isRecurring. Past invoices are never touched. */
  recurringEndDate?: Date;
  /**
   * Day-of-month the series bills on, fixed for its whole life. Derived from the
   * first `nextRecurringDate` and NEVER rewritten from a later (already clamped)
   * occurrence — that is how a 31st retainer silently became a 28th one.
   */
  recurringAnchorDay?: number;
  /** Idempotency token of the SERIES: the last period an occurrence was generated
   *  for ('2026-08' | 'W2026-08-03' | 'Q2026-3' | 'Y2026'). Claimed by the UI for
   *  the parent's OWN period at creation, then advanced by the cron. */
  lastGeneratedPeriodKey?: string;
  /** When the cron last generated an occurrence of this series. */
  lastGeneratedAt?: Date;
  /** On a CHILD: the period this occurrence covers (invoice-driven recurrence).
   *  `billingPeriodKey` is the project-driven equivalent. */
  periodKey?: string;
  /** Whole periods the series fell behind before the last run. Surfaced, never
   *  auto-backfilled — rewriting closed books is the owner's call. */
  recurringPeriodsSkipped?: number;
  recurringPeriodsSkippedAt?: Date;
  /** Why the cron switched the series off ('series-ended' | 'project-also-bills'). */
  recurringStoppedReason?: string;
  recurringStoppedAt?: Date;
  parentInvoiceId?: string;
  autoGenerated?: boolean;
  /** For project-driven recurrence: which billing period of the project this
   *  invoice covers ('2026-08' / 'W2026-08-03'). See Project.lastInvoicePeriodKey. */
  billingPeriodKey?: string;
  stripeSessionId?: string;
  stripePaymentIntentId?: string;
  /** Origin of the invoice. 'whmcs' = mirrored one-way from WHMCS billing. */
  source?: 'whmcs' | 'manual' | 'stripe' | 'hosting';
  /** Hosting & domains module: the order this invoice pays for (first invoice), or the
   *  subscription / domain it renews. Paying it triggers provisioning / renewal. */
  hostingOrderId?: string;
  subscriptionId?: string;
  domainId?: string;
  /** WHMCS invoice id — idempotency key for the WHMCS → FivoCRM sync. */
  whmcsInvoiceId?: string;
  /** WHMCS invoice line items (products/services billed). */
  lineItems?: { description: string; amount: number; type: string }[];
  /** Short product/services summary from line items. */
  productSummary?: string;
  /** Cron debounce: last overdue email + WhatsApp escalation sent to the customer. */
  overdueEmailSentAt?: Date;
  overdueWaSentAt?: Date;
  /** Set when a WHMCS-mirrored invoice was cancelled locally — the sync preserves
   *  this (won't revert status), so it stays out of revenue instead of resurrecting. */
  locallyCancelled?: boolean;
  // ── WHMCS payment write-back (payments recorded INSIDE FivoCRM) ──────────────
  // See src/lib/whmcsPayment.ts. Stripe payments are pushed by the webhook; a
  // manual "Paguar" / instalment is queued here and drained by
  // POST /api/whmcs-payment or by the next whmcs-sync. While the queue is
  // non-empty the sync PRESERVES the local status instead of reverting it.
  /** Payments awaiting WHMCS (`key` = idempotency token → WHMCS transid). */
  whmcsPendingPayments?: WhmcsPendingPayment[];
  /** Keys already recorded in WHMCS (dedup for re-marks). */
  whmcsSyncedPaymentKeys?: string[];
  /** When the oldest still-pending local payment was recorded. */
  whmcsPaymentPendingAt?: Date | null;
  /** Last successful write-back to WHMCS (Stripe or manual). */
  whmcsPaymentSyncedAt?: Date;
  /** Last write-back failure (WHMCS API message). Cleared on success. */
  whmcsPaymentSyncError?: string | null;
  // ── WhatsApp invoice reminders (overdue-reminders cron) ──────────────────────
  /** One-shot stages: "skadon për N ditë" and "skadon sot". */
  preDueWaSentAt?: Date;
  dueWaSentAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  createdByUserId: string | null;
}

/** A payment recorded in FivoCRM that still has to be posted to WHMCS. */
export interface WhmcsPendingPayment {
  /** 'full' (whole balance) or 'p<index>' (instalment index in partialPayments). */
  key: string;
  /** Amount in the invoice's currency; omitted for 'full' (WHMCS closes the balance). */
  amount?: number;
  /** FivoCRM payment method label ('Cash', 'Bank', 'Card', …) → WHMCS gateway. */
  method?: string;
  paidAt?: Date;
}

// ── Hosting & domains module ──
// A `Subscription` is a hosting ACCOUNT the customer pays for on a cycle; a `Domain`
// is a registered name. Both collections predate the module as WHMCS read-only
// mirrors (`source: 'whmcs'`); rows we sell and bill ourselves carry
// `source: 'fivocrm'`. The pure engine (`src/lib/hosting/engine.ts`, mirrored
// byte-for-byte in `api/_hostingEngine.ts`) decides every lifecycle step; the
// cron (`api/_hostingJobs.ts`) and the endpoint (`api/_hosting.ts`) only execute.

export type HostingBillingCycle =
  | 'monthly' | 'quarterly' | 'semiannually' | 'annually' | 'biennially' | 'triennially';

export type SubscriptionStatus = 'Pending' | 'Active' | 'Suspended' | 'Terminated' | 'Cancelled';
export type DomainStatus = 'Pending' | 'Active' | 'Grace' | 'Expired' | 'Cancelled' | 'Transferred Away';
export type ProvisionStatus = 'pending' | 'provisioned' | 'failed';

/** A cPanel/WHM server the tenant provisions accounts on. The API token lives in
 *  `hostingServerSecrets/{serverId}` (deny-all for clients) — the UI sees `hasApiToken`. */
export interface HostingServer {
  id: string;
  businessId?: string;
  teamId?: string;
  name: string;
  /** WHM hostname (no scheme), e.g. `srv1.shembull.al`. */
  hostname: string;
  /** WHM API port — 2087 by default. */
  port?: number;
  /** WHM API user (root or a reseller). */
  username: string;
  /** Nameservers handed to new accounts / registered domains. */
  nameservers?: string[];
  /** Public IP shown to the customer for A records. */
  ipAddress?: string;
  status: 'Active' | 'Inactive';
  hasApiToken?: boolean;
  /** Filled by "Testo lidhjen" / the sync job. */
  lastCheckedAt?: Date;
  lastCheckOk?: boolean;
  lastCheckError?: string | null;
  whmVersion?: string;
  accountsCount?: number;
  /** WHM packages seen on the last check (for the product form's picker). */
  packages?: string[];
  createdAt: Date;
  updatedAt: Date;
  createdByUserId: string | null;
}

/** A hosting PACKAGE for sale: maps a WHM package on a server to a price list. */
export interface HostingProduct {
  id: string;
  businessId?: string;
  teamId?: string;
  name: string;
  description?: string;
  serverId: string;
  /** Exact WHM package name (`plan` in createacct). */
  whmPackage: string;
  status: 'Active' | 'Archived';
  currency: 'ALL' | 'EUR';
  pricing: Partial<Record<HostingBillingCycle, { price: number; setupFee?: number }>>;
  features?: string[];
  diskGb?: number;
  bandwidthGb?: number;
  /** Shown in the client portal catalog. */
  portalVisible?: boolean;
  sortOrder?: number;
  createdAt: Date;
  updatedAt: Date;
  createdByUserId: string | null;
}

/** Sell prices for one TLD. `cost*` are what Dynadot charges us (display-only). */
export interface DomainTld {
  id: string;
  businessId?: string;
  teamId?: string;
  /** Without the dot: `com`, `al`, `co.uk`. */
  tld: string;
  currency: 'ALL' | 'EUR';
  registerPrice: number;
  renewPrice: number;
  transferPrice?: number;
  costRegister?: number;
  costRenew?: number;
  minYears?: number;
  maxYears?: number;
  status: 'Active' | 'Archived';
  portalVisible?: boolean;
  createdAt: Date;
  updatedAt: Date;
  createdByUserId: string | null;
}

/** Active hosting subscription. `source: 'whmcs'` rows are mirrored one-way from
 *  WHMCS and are never billed or provisioned by us; `'fivocrm'` rows are ours. */
export interface Subscription {
  id: string;
  businessId?: string;
  teamId?: string;
  customerId?: string;
  source: 'whmcs' | 'fivocrm';
  /** WHMCS service (client product) id — idempotency key of the mirror. */
  whmcsServiceId?: string;
  whmcsClientId?: string;
  productId?: string;
  productName: string;
  /** Primary domain of the account. */
  domain?: string;
  status: SubscriptionStatus;
  recurringAmount: number;
  currency?: 'ALL' | 'EUR';
  /** Ours: a `HostingBillingCycle`. Mirror: WHMCS's free-text cycle. */
  billingCycle?: HostingBillingCycle | string;
  nextDueDate?: Date;
  /** Day-of-month the series started on; the due date is clamped to it forever. */
  anchorDay?: number;
  registrationDate?: Date;
  // ── provisioning (cPanel/WHM) ──
  serverId?: string;
  whmPackage?: string;
  cpanelUsername?: string;
  provisionStatus?: ProvisionStatus;
  provisionError?: string | null;
  provisionedAt?: Date;
  // ── lifecycle ──
  /** Day key (`2026-09-25`) of the due date the last renewal invoice was issued FOR. */
  lastInvoicedDueKey?: string | null;
  /** The renewal invoice for the current due date. */
  currentInvoiceId?: string | null;
  cancelAtPeriodEnd?: boolean;
  /** Staff hold: the cron never auto-suspends/terminates while set. */
  lifecycleHold?: boolean;
  suspendedAt?: Date | null;
  suspendReason?: string | null;
  terminatedAt?: Date | null;
  /** Order that created it. */
  orderId?: string;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
  createdByUserId?: string | null;
}

/** A registered domain name. Same source split as `Subscription`. */
export interface Domain {
  id: string;
  businessId?: string;
  teamId?: string;
  customerId?: string;
  source: 'whmcs' | 'fivocrm';
  whmcsDomainId?: string;
  whmcsClientId?: string;
  domainName: string;
  tld?: string;
  status: DomainStatus | string;
  registrar?: 'dynadot' | 'manual' | string;
  registrationDate?: Date;
  expiryDate?: Date;
  years?: number;
  recurringAmount: number;
  currency?: 'ALL' | 'EUR';
  autoRenew?: boolean;
  nameservers?: string[];
  privacy?: boolean;
  locked?: boolean;
  /** Linked hosting account (the domain points at it). */
  subscriptionId?: string;
  provisionStatus?: ProvisionStatus;
  provisionError?: string | null;
  lastSyncAt?: Date;
  // ── lifecycle ──
  lastInvoicedExpiryKey?: string | null;
  currentInvoiceId?: string | null;
  /** Expiry key the registrar confirmed a renewal for (guards a double renew). */
  renewedAtRegistrarForKey?: string | null;
  lifecycleHold?: boolean;
  orderId?: string;
  createdAt: Date;
  updatedAt: Date;
  createdByUserId?: string | null;
}

export type HostingOrderStatus =
  | 'Pending'        // awaiting payment
  | 'Paid'           // invoice paid, provisioning not started
  | 'Provisioning'
  | 'Active'         // everything provisioned
  | 'Failed'         // at least one line failed — staff retries
  | 'Cancelled';

export interface HostingOrderLine {
  kind: 'hosting' | 'domain-register' | 'domain-transfer';
  description: string;
  productId?: string;
  productName?: string;
  cycle?: HostingBillingCycle;
  domainName?: string;
  years?: number;
  unitPrice: number;
  setupFee: number;
  total: number;
  currency: 'ALL' | 'EUR';
  /** Filled as the line is fulfilled. */
  subscriptionId?: string;
  domainId?: string;
  provisionStatus?: ProvisionStatus;
  provisionError?: string | null;
}

/** An order = one invoice + N lines. Provisioning starts when the invoice is Paid. */
export interface HostingOrder {
  id: string;
  businessId?: string;
  teamId?: string;
  orderNumber: string;
  customerId: string;
  source: 'portal' | 'staff';
  status: HostingOrderStatus;
  lines: HostingOrderLine[];
  subtotal: number;
  total: number;
  currency: 'ALL' | 'EUR';
  invoiceId?: string | null;
  paidAt?: Date | null;
  provisionedAt?: Date | null;
  lastError?: string | null;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
  createdByUserId: string | null;
}

/** Append-only audit of every provider call and lifecycle step (server-written). */
export interface HostingEvent {
  id: string;
  businessId?: string;
  teamId?: string;
  customerId?: string;
  subscriptionId?: string;
  domainId?: string;
  orderId?: string;
  type: string;
  ok: boolean;
  message: string;
  /** Redacted provider payload excerpt (never a password/token). */
  detail?: Record<string, unknown>;
  actorUserId?: string | null;
  createdAt: Date;
}

export interface Service {
  id: string;
  name?: string;
  title?: string;
  description?: string;
  price: number;
  category?: string;
  currency?: string;
  // Optional catalog-card fields (portal service catalog). All degrade gracefully.
  features?: string[];      // bullet points (e.g. "Monitorim live 24/7")
  duration?: string;        // delivery/term label (e.g. "1–2 ditë", "3 muaj")
  billingPeriod?: string;   // e.g. "në muaj", "një herë"
  featured?: boolean;       // highlight as "Më e zgjedhura"
  teamId?: string;
  createdAt: Date;
  updatedAt: Date;
  createdByUserId: string | null;
}

// ── Shop / Products module (enterprise catalog) ──
// A `Product` is a sellable good, unlike `Service` (an agency engagement): it has
// stock, variants, suppliers and shipping. The whole module is toggleable per
// tenant and plan-gated — see src/lib/modules.ts.

export type ProductType = 'physical' | 'digital' | 'service' | 'bundle';
export type ProductStatus = 'Draft' | 'Active' | 'Archived';
/** What happens when stock hits zero. */
export type StockPolicy = 'deny' | 'backorder' | 'preorder';

/** One configurable axis, e.g. "Madhësia" → ['S','M','L']. Max 3 axes in the UI. */
export interface ProductOption {
  name: string;
  values: string[];
}

/** A concrete sellable combination of option values. Stored inline on the product. */
export interface ProductVariant {
  /** Stable local id (crypto.randomUUID) — variants are an embedded array. */
  id: string;
  /** One value per option name, e.g. { 'Madhësia': 'M', 'Ngjyra': 'E zezë' }. */
  optionValues: Record<string, string>;
  sku?: string;
  barcode?: string;
  /** Overrides the product price when set; undefined → inherit from the product. */
  price?: number;
  compareAtPrice?: number;
  costPrice?: number;
  stockQty?: number;
  lowStockThreshold?: number;
  weightGrams?: number;
  imageUrl?: string;
  isActive?: boolean;
  position?: number;
}

/** Quantity break (B2B wholesale): ordering >= minQty drops the unit price. */
export interface ProductPriceTier {
  minQty: number;
  unitPrice: number;
  label?: string;
}

export interface ProductMedia {
  url: string;
  alt?: string;
  isPrimary?: boolean;
  position?: number;
}

/** Free-form spec row rendered in the portal spec table. */
export interface ProductAttribute {
  name: string;
  value: string;
}

export interface ProductDimensions {
  lengthCm?: number;
  widthCm?: number;
  heightCm?: number;
}

export interface Product {
  id: string;
  // ── Identity ──
  name: string;
  slug?: string;
  sku?: string;
  /** EAN/UPC/GTIN. */
  barcode?: string;
  type?: ProductType;
  status?: ProductStatus;
  /** Published to the client-portal shop. Draft/Archived never show regardless. */
  visibleInPortal?: boolean;
  shortDescription?: string;
  /** Rich HTML — always render through sanitizeHtml(). */
  description?: string;
  // ── Classification ──
  categoryId?: string;
  /** Denormalized so lists/CSV don't need a join. */
  categoryName?: string;
  brandId?: string;
  brandName?: string;
  tags?: string[];
  // ── Pricing ──
  price: number;
  /** "Was" price — drives the discount badge when higher than price. */
  compareAtPrice?: number;
  /** COGS — drives margin reporting. Never exposed to the portal. */
  costPrice?: number;
  currency?: 'ALL' | 'EUR' | 'USD' | 'GBP';
  /** VAT percent (Albania: 20). */
  taxRatePercent?: number;
  /** true → `price` already includes tax (gross pricing). */
  taxIncluded?: boolean;
  priceTiers?: ProductPriceTier[];
  /** Unit of measure label, e.g. 'copë', 'kg', 'litër'. */
  unit?: string;
  // ── Inventory ──
  trackInventory?: boolean;
  stockQty?: number;
  lowStockThreshold?: number;
  stockPolicy?: StockPolicy;
  warehouse?: string;
  supplierName?: string;
  supplierSku?: string;
  leadTimeDays?: number;
  reorderPoint?: number;
  reorderQty?: number;
  // ── Variants ──
  options?: ProductOption[];
  variants?: ProductVariant[];
  // ── Media ──
  images?: ProductMedia[];
  // ── Shipping / physical ──
  weightGrams?: number;
  dimensions?: ProductDimensions;
  requiresShipping?: boolean;
  // ── Digital ──
  downloadUrl?: string;
  downloadLimit?: number;
  licenseKeyRequired?: boolean;
  // ── Bundle (type === 'bundle') ──
  bundleItems?: { productId: string; quantity: number }[];
  // ── Merchandising ──
  featured?: boolean;
  position?: number;
  minOrderQty?: number;
  maxOrderQty?: number;
  relatedProductIds?: string[];
  warrantyMonths?: number;
  attributes?: ProductAttribute[];
  // ── SEO ──
  metaTitle?: string;
  metaDescription?: string;
  // ── Rollups (denormalized counters, written by order fulfilment) ──
  soldCount?: number;
  ratingAvg?: number;
  ratingCount?: number;
  publishedAt?: Date;
  teamId?: string;
  businessId?: string;
  createdAt: Date;
  updatedAt: Date;
  createdByUserId: string | null;
}

/** Catalog category. `parentId` makes it a tree (one level is enough in practice). */
export interface ProductCategory {
  id: string;
  name: string;
  slug?: string;
  parentId?: string;
  description?: string;
  imageUrl?: string;
  position?: number;
  teamId?: string;
  businessId?: string;
  createdAt: Date;
  updatedAt: Date;
  createdByUserId: string | null;
}

export interface ProductBrand {
  id: string;
  name: string;
  logoUrl?: string;
  website?: string;
  teamId?: string;
  businessId?: string;
  createdAt: Date;
  updatedAt: Date;
  createdByUserId: string | null;
}

export type StockMovementType = 'in' | 'out' | 'adjustment' | 'sale' | 'return' | 'transfer';

/** Append-only inventory ledger — every stock change is auditable. */
export interface StockMovement {
  id: string;
  productId: string;
  productName?: string;
  variantId?: string;
  variantLabel?: string;
  type: StockMovementType;
  /** Signed delta applied to stock (e.g. -3 for a sale). */
  quantity: number;
  /** Stock level right after this movement — lets the ledger be read standalone. */
  balanceAfter?: number;
  reason?: string;
  /** Free reference: order number, invoice number, supplier doc… */
  reference?: string;
  shopOrderId?: string;
  unitCost?: number;
  warehouse?: string;
  teamId?: string;
  businessId?: string;
  createdAt: Date;
  updatedAt: Date;
  createdByUserId: string | null;
}

export type ShopOrderStatus =
  | 'Pending' | 'Confirmed' | 'Processing' | 'Shipped' | 'Delivered' | 'Cancelled' | 'Refunded';
export type ShopPaymentStatus = 'Unpaid' | 'Partial' | 'Paid' | 'Refunded';

/** Order line — a price snapshot, so later catalog edits never rewrite history. */
export interface ShopOrderItem {
  productId: string;
  variantId?: string;
  name: string;
  variantLabel?: string;
  sku?: string;
  quantity: number;
  unitPrice: number;
  /** Absolute per-line discount in the order currency. */
  discount?: number;
  taxRatePercent?: number;
  taxAmount?: number;
  /** Net of discount, excluding tax. */
  total: number;
  imageUrl?: string;
}

export interface ShopAddress {
  fullName?: string;
  phone?: string;
  line1?: string;
  line2?: string;
  city?: string;
  postalCode?: string;
  country?: string;
  notes?: string;
}

export interface ShopOrder {
  id: string;
  /** Sequential human reference, e.g. 'POR-2026-0007'. */
  orderNumber: string;
  customerId?: string;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  items: ShopOrderItem[];
  currency: 'ALL' | 'EUR' | 'USD' | 'GBP';
  subtotal: number;
  discountTotal?: number;
  taxTotal?: number;
  shippingTotal?: number;
  total: number;
  status: ShopOrderStatus;
  paymentStatus?: ShopPaymentStatus;
  paymentMethod?: string;
  shippingAddress?: ShopAddress;
  shippingMethod?: string;
  trackingNumber?: string;
  shippedAt?: Date;
  deliveredAt?: Date;
  cancelledAt?: Date;
  cancelReason?: string;
  /** Set once converted to an invoice — prevents double billing. */
  invoiceId?: string;
  /** true after stock was decremented, so fulfilment stays idempotent. */
  stockApplied?: boolean;
  notes?: string;
  internalNotes?: string;
  /** 'portal' = placed by the client themselves; 'staff' = entered in the back office. */
  source?: 'portal' | 'staff';
  assignedToUserId?: string;
  teamId?: string;
  businessId?: string;
  createdAt: Date;
  updatedAt: Date;
  createdByUserId: string | null;
}

/** Frequencies the recurrence engine can actually generate. Kept next to the
 *  Expense type so a UI dropdown can never offer a cycle the cron will refuse
 *  (a `quarterly` series used to be accepted, blocked forever by the cron, and
 *  still counted by the cashflow alarm). */
export type ExpenseFrequency = 'weekly' | 'monthly' | 'quarterly' | 'yearly';

export interface Expense {
  id: string;
  title: string;
  description?: string;
  amount: number;
  currency?: string;
  category: string;
  /**
   * The date the expense is BOOKED on — the single input to every P&L, chart,
   * cashflow alarm and forecast (`getExpenseDate()` = `date || createdAt`).
   * Written by the form (defaulting to today) and by the recurrence engine,
   * which stamps the SCHEDULED date so a late cron run still lands the
   * occurrence in its planned month.
   */
  date?: Date;
  teamId?: string;
  projectId?: string;
  departmentId?: string;
  status?: string;
  approvalStatus?: 'Submitted' | 'Approved' | 'Rejected';
  approvedByUserId?: string;
  rejectionReason?: string;
  memberId?: string;       // for Salary expenses: links to TeamMember.userId
  isRecurring?: boolean;
  recurringFrequency?: ExpenseFrequency | string;
  nextRecurringDate?: Date;
  /** Optional "repeat until" — the cron stops generating after this date and
   *  auto-clears isRecurring. Past occurrences are never touched. */
  recurringEndDate?: Date;
  /** Temporarily halts generation without ending the series (resume later). */
  isRecurringPaused?: boolean;
  /**
   * The idempotency token of the recurrence engine, declared here so it is
   * type-checked rather than reached through `(e as any)`. Every one of these
   * used to be untyped, which is exactly how a period key could be written by
   * the UI and read by the cron with nobody noticing a rename.
   *
   * `lastGeneratedPeriodKey` — the last period this SERIES produced a row for
   * (set on the parent by both the UI at creation and the cron).
   * `periodKey` — the period a generated CHILD belongs to.
   * `recurringAnchorDay` — the day-of-month the series is pinned to, so a
   * month-end series (31st) does not degrade to the 28th after February.
   */
  lastGeneratedPeriodKey?: string;
  periodKey?: string;
  recurringAnchorDay?: number;
  /** Set on cron-generated occurrences; links a child back to its parent
   *  (mirrors invoices' parentInvoiceId/autoGenerated). */
  parentExpenseId?: string | null;
  autoGenerated?: boolean;
  businessId?: string;
  paidDate?: Date;
  createdAt: Date;
  updatedAt: Date;
  createdByUserId: string | null;
}

export interface Goal {
  id: string;
  title: string;
  description?: string;
  /** 'team' = shared team goal, 'individual' = personal member goal */
  scope: 'team' | 'individual';
  /** For individual goals: the assigned member's userId */
  ownerId?: string;
  /** Parent goal ID for cascading (team→individual breakdown) */
  parentGoalId?: string;
  progress: number; // 0-100
  startDate?: Date;
  dueDate?: Date;
  status: 'On Track' | 'At Risk' | 'Off Track' | 'Achieved';
  /** Linked CRM elements */
  linkedProjects?: string[];
  linkedLeads?: string[];
  linkedTasks?: string[];
  /** Metric tracking (legacy single-metric; superseded by keyResults) */
  targetValue?: number;
  currentValue?: number;
  metricUnit?: string; // e.g. "€", "leads", "projekte"
  /**
   * OKR Key Results (Measure What Matters). When present, the goal's progress is
   * DERIVED from the average of its KR progress rather than the manual `progress`
   * field. 'auto' KRs pull their currentValue live from CRM data.
   */
  keyResults?: KeyResult[];
  teamId?: string;
  createdAt: Date;
  updatedAt: Date;
  createdByUserId: string | null;
}

export type KeyResultType = 'metric' | 'milestone' | 'auto';

/** Data sources an 'auto' Key Result can derive its current value from. */
export type KeyResultAutoSource =
  | 'tasksCompleted'
  | 'projectsCompleted'
  | 'leadsWon'
  | 'revenue'
  | 'invoicesPaid';

export interface KeyResult {
  id: string;
  title: string;
  type: KeyResultType;
  /** Baseline value at the start of the cycle (progress measured from here). */
  startValue: number;
  /** Current value — hand-entered for 'metric', last computed for 'auto', unused for 'milestone'. */
  currentValue: number;
  targetValue: number;
  unit?: string; // €, leads, %, projekte…
  /** milestone type: is it done? */
  done?: boolean;
  /** auto type: which CRM metric to derive currentValue from. */
  autoSource?: KeyResultAutoSource;
}

export interface Milestone {
  id: string;
  goalId: string;
  title: string;
  description?: string;
  status: 'Pending' | 'In Progress' | 'Completed';
  completed?: boolean;
  dueDate?: Date;
  createdAt: Date;
  updatedAt: Date;
}

/** An uploaded file reference (VPS-hosted) attached to a CRM record. */
export interface FileAttachment {
  url: string;
  name: string;
  size?: number;   // bytes
  type?: string;   // mime type
}

export interface Lead extends FollowUpFields {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  phoneNumber?: string;
  company?: string;
  teamId?: string;
  jobTitle?: string;
  address?: string;
  website?: string;
  status: 'New' | 'Contacted' | 'Qualified' | 'Follow-up' | 'Proposal' | 'Won' | 'Converted' | 'Lost';
  source?: string;
  value?: number;
  score?: number;
  probability?: number;
  estimatedValue?: number;
  lostReason?: string;
  convertedAt?: Date;
  businessCategory?: string;
  notes?: string;
  attachments?: FileAttachment[]; // documents uploaded from the lead drawer (tab "Dokumente")
  // nextFollowUpDate / nextFollowUpType / followUpNote / lastFollowUpDate /
  // lastActivityAt / lastReminderSentAt / lastInboundAt / awaitingReply come
  // from FollowUpFields (shared with Customer).
  tags?: string[];
  serviceInquiryId?: string;
  assignedToUserId?: string;
  customerId?: string;          // set when converted (reverse link to the Customer)
  firstResponseAt?: Date;       // first outbound touch (for response-time/SLA)
  slaBreachNotified?: boolean;  // cron debounce: first-response SLA breach alerted
  staleNotifiedAt?: Date;       // cron debounce: last staleness alert
  waAutoReminderAt?: Date;      // cron debounce: last WhatsApp auto-reminder sent
  // Automated follow-up cadence: when active, the cron auto-creates a follow-up
  // task at each configured day-offset until the steps run out or the lead closes.
  cadenceActive?: boolean;
  cadenceStartedAt?: Date;
  cadenceStep?: number;         // next step index to fire (0-based)
  /** Follow-up playbook (label → steps → templates) the cadence follows; null = default day list. */
  playbookId?: string | null;
  /** Service the lead asked for (playbook name), stamped by the inbound WhatsApp handler. */
  serviceInterest?: string | null;
  createdAt: Date;
  updatedAt: Date;
  createdByUserId: string | null;
}

// ── Opportunities / Deals (qualified pipeline, split from Lead) ─────────────
export type DealStage = 'Qualification' | 'Proposal' | 'Negotiation' | 'Won' | 'Lost';

export interface Deal {
  id: string;
  title: string;
  customerId?: string;
  customerName?: string;        // denormalized for display
  leadId?: string;              // origin lead, if converted from one
  amount: number;
  currency?: string;            // 'EUR' | 'ALL' | 'USD'
  stage: DealStage;
  probability?: number;         // override; otherwise derived from stage
  expectedCloseDate?: Date;
  ownerId?: string;             // assigned rep
  notes?: string;
  lostReason?: string;
  wonAt?: Date;
  lostAt?: Date;
  teamId?: string;
  lastActivityAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  createdByUserId: string | null;
}

// ── Lead activity / audit timeline ──────────────────────────────────────────
// CRM automation rules (trigger → conditions → actions). The model lives with its
// pure engine so the api mirror stays self-contained; re-exported here for consumers.
export type { AutomationRule as CrmAutomationRule, AutomationRun as CrmAutomationRun } from '../lib/crm/automationRules';

export type LeadActivityType =
  | 'created' | 'status_changed' | 'assigned' | 'note' | 'call' | 'email'
  | 'whatsapp' | 'meeting' | 'followup_scheduled' | 'converted' | 'lost' | 'field_updated';

export interface LeadActivity {
  id: string;
  leadId: string;
  teamId?: string;
  type: LeadActivityType;
  title: string;                 // short human summary
  body?: string;                 // note text / call summary / details
  attachments?: FileAttachment[]; // files attached to this timeline entry
  meta?: Record<string, any>;    // { from, to, outcome, durationMin, channel }
  userId: string | null;         // actor
  userName?: string;
  createdAt: Date;
}

export interface ServiceInquiry {
  id: string;
  // 1. Basic Info
  businessName: string;
  contactName: string;
  email: string;
  phoneNumber: string;
  jobTitle?: string;
  industry: string;
  cityMarket?: string;
  website?: string;
  businessDescription?: string;
  instagramLink?: string;
  facebookLink?: string;
  tiktokLink?: string;
  linkedinLink?: string;
  // Business's own service/product catalog (title + description per item)
  businessServices?: { title: string; description: string }[];
  // Logo uploaded by the client (hosted on the VPS file server)
  logoUrl?: string;
  logoName?: string;
  // 2. Service Interest
  servicesInterestedIn: string[];
  mainGoal: string;
  projectNeedDescription: string;
  currentMainChallenge: string;
  hasWorkedWithAgency?: string;
  whatHaveYouTried?: string;
  // 3. Budget & Timeline
  budgetRange: string;
  timeline: string;
  isUrgent?: string;
  decisionMaker: string;
  preferredContactMethod?: string;
  // 4. Existing Materials
  hasExistingMaterials: string;
  googleDriveLink?: string;
  secondGoogleDriveLink?: string;
  folderIncludes?: string[];
  hasBrandGuidelines?: string;
  // Photos / files uploaded directly by the client (hosted on the VPS file server)
  materialFiles?: { url: string; name: string }[];
  // 5. Service-specific: Social Media
  smm_mainPlatforms?: string[];
  smm_organicOrAds?: string;
  smm_hasContent?: string;
  smm_postingFrequency?: string;
  smm_toneOfCommunication?: string;
  smm_contentTypes?: string[];
  // 5. Service-specific: Web Design
  web_hasExistingWebsite?: string;
  web_existingWebsiteLink?: string;
  web_mainPurpose?: string;
  web_estimatedPages?: string;
  web_hasTextsAndPhotos?: string;
  web_websitesYouLike?: string;
  web_features?: string[];
  // 5. Service-specific: Paid Ads
  ads_platforms?: string[];
  ads_mainConversionAction?: string;
  ads_monthlyBudget?: string;
  ads_hasRunAdsBefore?: string;
  ads_pastResults?: string;
  ads_hasLandingPage?: string;
  // 5. Service-specific: Branding
  brand_hasExistingLogo?: string;
  brand_whatYouNeed?: string[];
  brand_coreValues?: string;
  brand_targetAudience?: string;
  brand_competitors?: string;
  brand_preferredStyle?: string;
  // 5. Service-specific: Content Creation
  content_types?: string[];
  content_platforms?: string[];
  content_frequency?: string;
  content_hasModels?: string;
  content_visualStyle?: string;
  // 5. Service-specific: SEO
  seo_hasWebsite?: string;
  seo_websitePlatform?: string;
  seo_targetKeywords?: string;
  seo_targetMarket?: string;
  seo_hasDoneSEO?: string;
  seo_competitors?: string;
  // 5. Service-specific: E-commerce
  ecom_platform?: string;
  ecom_productsCount?: string;
  ecom_hasInventory?: string;
  ecom_paymentMethods?: string[];
  ecom_shippingNeeds?: string;
  ecom_hasProductPhotos?: string;
  ecom_productCategories?: string;
  ecom_existingShopLink?: string;
  ecom_features?: string[];
  ecom_products?: { name: string; category: string; price: string }[];
  // 5. Service-specific: Coaching
  coach_niche?: string;
  coach_targetAudience?: string;
  coach_deliveryMethod?: string[];
  coach_hasProgram?: string;
  coach_programDescription?: string;
  coach_needsBooking?: string;
  coach_needsPayment?: string;
  coach_contentNeeds?: string[];
  coach_socialPresence?: string;
  // Currency + separate ad spend
  currency?: 'EUR' | 'ALL';
  adBudget?: string;
  // SEO extra
  seo_hasGoogleBusiness?: string;
  seo_wantsBacklinks?: string;
  seo_wantsBlog?: string;
  seo_analyticsAccess?: string;
  // SMM extra
  smm_reelsPerMonth?: string;
  smm_shootDays?: string;
  smm_communityManagement?: string;
  // Web Design extra
  web_languages?: string[];
  web_needsCopywriting?: string;
  web_hasDomainHosting?: string;
  // Paid Ads extra
  ads_hasTracking?: string;
  ads_wantsRemarketing?: string;
  ads_targetMarket?: string;
  // Content extra
  content_scope?: string;
  content_location?: string;
  content_needsDrone?: string;
  content_quantity?: string;
  // Google Maps / Google Business Profile
  gmb_hasProfile?: string;
  gmb_locations?: string;
  gmb_needs?: string[];
  // Website Maintenance
  maint_hasWebsite?: string;
  maint_platform?: string;
  maint_needs?: string[];
  maint_supportLevel?: string;
  // Email / WhatsApp Marketing
  email_channels?: string[];
  email_hasList?: string;
  email_listSize?: string;
  email_frequency?: string;
  email_goalNote?: string;
  // Meta
  status: 'Draft' | 'New' | 'Reviewed' | 'Converted';
  isDraft?: boolean;
  lastSavedStep?: number;
  leadId?: string;
  customerId?: string;
  clientUserId?: string;
  createdAt: Date;
  updatedAt: Date;
  createdByUserId: string | null;
}

/**
 * A recorded payment (arkëtim) against an invoice. This is the real payment
 * ledger — invoices still carry partialPayments[] for backward compatibility,
 * but every payment is mirrored here with a stable `sourceKey` for idempotent
 * backfill/sync. See lib/finance/payments.ts.
 */
export interface Payment {
  id: string;
  invoiceId: string;
  invoiceNumber?: string;
  customerId?: string;
  amount: number;                 // in the invoice's native currency
  currency?: 'ALL' | 'EUR' | 'USD' | 'GBP';
  method?: string;                // 'Cash' | 'Bank' | 'Stripe' | …
  paidAt: Date;
  note?: string;
  teamId?: string;
  businessId?: string;
  source?: 'partial' | 'full' | 'backfill' | 'stripe';
  /** Idempotency key: `${invoiceId}#p{index}` | `#pfinal` | `#full`. */
  sourceKey: string;
  createdAt: Date;
  createdByUserId?: string | null;
}

export interface InvoiceItem {
  id: string;
  invoiceId: string;
  serviceId?: string;
  /** Free-text line description when the line isn't a catalogue service. */
  description?: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  /**
   * Tenancy + portal-visibility keys. These are NOT optional in practice: the
   * Firestore rule is `isBusinessMember(businessId) || isPortalClientFor(customerId)`
   * and `useCollection` forces a `businessId` filter, so a row missing both is
   * readable by nobody. Declared here so a write path cannot omit them by accident
   * (the recurring-invoice cron copied only `teamId` and produced exactly that).
   */
  businessId?: string;
  teamId?: string;
  /** Mirrored from the parent invoice — the portal reads line items by it. */
  customerId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface TaskComment {
  id: string;
  taskId: string;
  content: string;
  userId: string;
  teamId?: string;
  senderType?: 'client' | 'team';
  createdByUserId?: string;
  edited?: boolean;
  reactions?: Record<string, string[]>; // emoji -> userId[]
  createdAt: Date;
  updatedAt: Date;
}

export interface TaskCollaborator {
  id: string;
  taskId: string;
  userId: string;
  role?: string;
  createdAt: Date;
}

export interface ChatMessage {
  id: string;
  content: string;
  senderId: string;
  receiverId?: string;
  channelId?: string;
  taskId?: string;
  isRead?: boolean;
  readAt?: Date;
  attachmentUrl?: string;
  senderType?: 'staff' | 'client';
  replyToId?: string;
  replyToContent?: string;
  replyToSender?: string;
  editedAt?: Date;
  deletedAt?: Date;
  reactions?: Record<string, string[]>; // emoji -> userId[]
  createdAt: Date;
  updatedAt: Date;
}

export interface Channel {
  id: string;
  name: string;
  description?: string;
  teamId?: string;
  isPrivate?: boolean;
  /** True for user-created WhatsApp-style group chats (vs. the fixed default channels). */
  isGroup?: boolean;
  /** User IDs of group members — only these users see the group. */
  members?: string[];
  /** User IDs of group admins — can add/remove members and rename the group. */
  admins?: string[];
  /** Denormalized timestamp of the most recent message — for sorting by recency. */
  lastMessageAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  createdByUserId: string | null;
}

/**
 * A persistent client conversation thread (portal / WhatsApp / email), unified
 * under one doc so owner + watchers routing survives across channels. The doc id
 * IS the channelId of the underlying messages (`client-<customerId>[-project-…]`
 * for the portal, `wa-<teamId>-<phone>` for WhatsApp) so upserts are id-addressable.
 */
export interface Conversation {
  id: string;
  businessId?: string;
  teamId?: string;
  channel: 'portal' | 'whatsapp' | 'email';
  customerId?: string;
  leadId?: string;
  phone?: string;
  subject?: string;
  /** The responsible person for replying. Empty → unassigned. */
  ownerId?: string | null;
  /** Manager of the owner's team (supervision + can reassign). */
  managerId?: string | null;
  /** Sales agent linked to the customer, for continuity. */
  salesAgentId?: string | null;
  /**
   * Everyone who can see the conversation: owner + owner's team + manager +
   * sales agent + all admins (deduped). Also populated with manager+admins when
   * unassigned, so the single `watchers array-contains uid` query surfaces
   * ownerless threads to the people who must triage them.
   */
  watchers: string[];
  /** True while no ownerId is set — drives the "Pa përgjegjës" queue. */
  unassigned?: boolean;
  status?: 'open' | 'pending' | 'closed';
  lastMessageAt?: Date;
  /** First-response SLA target (Request 3 escalation cron consumes this). */
  slaFirstResponseDueAt?: Date;
  firstResponseAt?: Date;
  slaBreachNotified?: boolean;
  createdAt: Date;
  updatedAt: Date;
  createdByUserId?: string | null;
}

export interface TimeEntry {
  id: string;
  taskId?: string;
  projectId?: string;
  teamId?: string;
  userId: string;
  description?: string;
  startTime: Date;
  endTime?: Date;
  duration?: number;
  isBillable?: boolean;
  isPomodoroSession?: boolean;
  /** Billing rate captured on the entry (ALL/hr); falls back to the member rate. */
  hourlyRate?: number;
  tags?: string[];
  pomodoroCount?: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface TeamInvite {
  id: string;
  teamId: string;
  email: string;
  role: string;
  token?: string;
  expiresAt?: Date;
  invitedByUserId?: string;
  canAccessProjects?: boolean;
  canAccessTasks?: boolean;
  canAccessCRM?: boolean;
  canAccessInvoices?: boolean;
  canAccessReports?: boolean;
  /**
   * Reporting capabilities (per-member overrides of the role defaults in
   * `src/lib/reporting/permissions.ts`). Undefined = use the role default, so
   * adding a capability later never silently revokes it for existing members.
   */
  canReviewReports?: boolean;
  canApproveReports?: boolean;
  canPublishReports?: boolean;
  canViewAllReports?: boolean;
  canViewConfidentialReports?: boolean;
  canManageReportTemplates?: boolean;
  canViewFinancialMetrics?: boolean;
  canAccessSettings?: boolean;
  canAccessGoals?: boolean;
  canAccessTeams?: boolean;
  canAccessChat?: boolean;
  canAccessCustomers?: boolean;
  canAccessServices?: boolean;
  /** Shop module (products, inventory, orders). */
  canAccessProducts?: boolean;
  /** Hosting & domains module. */
  canAccessHosting?: boolean;
  canAccessExpenses?: boolean;
  canAccessProfile?: boolean;
  /** Carried onto the membership when the invite is accepted — see TeamMember. */
  canAssignTasks?: boolean;
  status: 'Pending' | 'Accepted' | 'Rejected' | 'Cancelled';
  createdAt: Date;
  updatedAt: Date;
}

export interface UserProfile {
  id: string;
  userId: string;
  displayName?: string;
  avatarUrl?: string;
  bio?: string;
  lastSeen?: Date;
  customStatus?: string;
  customStatusEmoji?: string;
  customStatusExpiresAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// The union is DERIVED from the registry in src/lib/notificationTypes.ts — it used
// to end in `| string`, which made every typo and every unregistered type compile
// cleanly. That is how eleven live types ended up with no icon, no category and no
// way to be muted. Adding a type now means adding it to the registry, full stop.
export type { NotificationType } from '../lib/notificationTypes';
import type { NotificationType as _NotificationType } from '../lib/notificationTypes';

export interface Notification {
  id: string;
  userId: string;
  /** A value outside the registry is a bug — see src/lib/notificationTypes.ts. */
  type: _NotificationType;
  title: string;
  message?: string;
  isRead?: boolean;
  teamId?: string;
  /** Tenant stamp. Required for GDPR export/delete to reach the document. */
  businessId?: string;
  actionType?: 'link' | 'approve' | 'view';
  actionUrl?: string;
  actionLabel?: string;
  /** Chat channel id (not a path) — the bell routes it to /app/chat. */
  linkTo?: string;
  /** Sender avatar shown inside the push notification. */
  imageUrl?: string;
  projectId?: string;
  customerId?: string;
  createdAt: Date;
}

export interface Activity {
  id: string;
  type: 'invoice_created' | 'invoice_updated' | 'invoice_paid' | 'lead_created' | 'lead_converted' | 'task_completed' | 'project_created' | 'project_updated' | 'project_deleted' | 'project_archived' | 'project_restored' | 'customer_created' | 'expense_added' | 'request_created' | 'meeting' | 'call' | 'email_sent' | 'note';
  title: string;
  description?: string;
  teamId?: string;
  entityType?: 'invoice' | 'lead' | 'task' | 'project' | 'customer' | 'expense' | 'request';
  entityId?: string;
  customerId?: string;
  userId: string;
  createdAt: Date;
}

// ── Client Portal Types ──

export interface ClientPortalAccess {
  id: string;
  customerId: string;
  userId: string; // Firebase Auth UID
  email: string;
  status: 'Active' | 'Suspended';
  createdAt: Date;
  updatedAt: Date;
  createdByUserId: string | null;
}

export interface ClientRequest {
  id: string;
  customerId: string;
  clientUserId: string; // Firebase Auth UID of the client
  title: string;
  description: string;
  category: 'Design' | 'Development' | 'Support' | 'Marketing' | 'Consulting' | 'Other';
  status: 'New' | 'In Review' | 'In Progress' | 'Completed' | 'Rejected' | 'Archived';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  projectId?: string;
  serviceId?: string;
  assignedTeamId?: string;
  assignedToUserId?: string;
  linkedTaskId?: string;
  attachmentUrl?: string;
  driveAttachments?: { id: string; name: string; mimeType: string; webViewLink: string }[];
  adminNotes?: string;
  createdAt: Date;
  updatedAt: Date;
  createdByUserId: string | null;
}

// ── Quotes / Preventiva ──

export interface Quote {
  id: string;
  leadId?: string;
  customerId?: string;
  leadName?: string;
  customerName?: string;
  label: string;
  currency: string;
  market: string;
  selections: Record<string, any>;
  result: {
    categories: { category: string; oneTime: number; monthly: number; items: any[] }[];
    subtotalOneTime: number;
    subtotalMonthly: number;
    totalOneTime: number;
    totalMonthly: number;
    grandTotal: number;
    suggestedLabel: string;
    enabledServicesCount: number;
    bundleDiscountAmount?: number;
    bundleDiscountLabel?: string;
    manualDiscountAmount?: number;
  };
  status: 'Draft' | 'Sent' | 'Accepted' | 'Rejected';
  validUntil?: Date;
  notes?: string;
  /** Revision number (1 = original). Higher = newer revision. */
  version?: number;
  /** Root quote this is a revision of (the first version's id). */
  parentQuoteId?: string;
  teamId?: string;
  createdAt: Date;
  updatedAt: Date;
  createdByUserId: string | null;
}

// ── Morning Standup ──

export interface StandupEntry {
  id: string;
  userId: string;
  teamId?: string;
  date: string; // YYYY-MM-DD
  yesterday: string;
  today: string;
  blockers?: string;
  createdAt: Date;
  updatedAt: Date;
}

// ── Daily Reports ──

/**
 * How one planned task actually went today.
 *
 * `not_started` and `in_progress` REQUIRE a `reason` — that requirement is the whole
 * point of the structure. See src/lib/productivity/dailyReportPlan.ts.
 */
export type TaskOutcomeState = 'done' | 'in_progress' | 'not_started';

export interface DailyTaskOutcome {
  /** Absent for unplanned work typed straight into the report. */
  taskId?: string;
  /** Snapshot of the title, so renaming the task later never rewrites history. */
  title: string;
  state: TaskOutcomeState;
  hours?: number;
  /** Mandatory when `state !== 'done'` and the row was planned. */
  reason?: string;
  projectId?: string;
  customerId?: string;
  /** Work that was not on today's plan — never owes an explanation. */
  unplanned?: boolean;
}

/**
 * Daily staff report. Extended by `DailyReportAccountability` (src/types/reporting.ts)
 * with the enterprise accountability fields — structured status, billable split,
 * dependencies, submission timing and manager review. Every added field is optional,
 * so legacy documents and every existing reader stay valid.
 */
export interface DailyReport extends DailyReportAccountability {
  id: string;
  userId: string;
  teamId?: string;
  date: string; // YYYY-MM-DD
  completedToday: string;
  openItems: string;
  blockers: string;
  planTomorrow: string;
  hoursWorked?: number;
  projectIds?: string[];
  completedTaskIds?: string[];
  mood?: 'great' | 'good' | 'neutral' | 'struggling';
  /**
   * The day's plan, answered task by task. `completedToday`/`openItems` stay as the
   * narrative version (generated from these, then editable), so every existing
   * reader keeps working.
   */
  taskOutcomes?: DailyTaskOutcome[];
  /** Department (serviceLine) this report was filled against, e.g. "seo". */
  serviceLine?: string;
  /** Department-specific fields (keys defined by the serviceLine template). */
  customFields?: Record<string, string | number>;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * "Bretkosa e Ditës" (Eat That Frog / The One Thing) — the single Most Important
 * Task a person commits to each day, decided in the morning and reviewed at night.
 * One doc per user per day (id convention: `${userId}_${date}`), so a re-commit
 * overwrites rather than duplicates.
 */
export interface DailyFocus {
  id: string;
  userId: string;
  teamId?: string;
  businessId?: string;
  date: string;          // YYYY-MM-DD
  title: string;         // the "frog" — what you'll eat first
  taskId?: string;       // optional link to a real Task
  done: boolean;         // eaten?
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  createdByUserId?: string | null;
}

/**
 * Per-team productivity targets — feed the Momentum score so each team is judged
 * against its own reality (a sales team's "throughput" ≠ a dev team's). One doc
 * per team (id convention: the teamId). Missing fields fall back to DEFAULT_TARGETS.
 */
export interface ProductivitySettings {
  id: string;
  teamId?: string;
  businessId?: string;
  targets: {
    focusHours?: number;
    deepWorkSessions?: number;
    reportDays?: number;
    throughput?: number;
    estimateCoverage?: number;   // 0–1
    minSessionMinutes?: number;
  };
  createdAt: Date;
  updatedAt: Date;
  createdByUserId?: string | null;
}

/**
 * Weekly Review (4DX cadence of accountability + GTD Weekly Review). One doc per
 * user per ISO week (id convention: `${userId}_${weekKey}`). Captures reflection
 * and the commitment (WIG / One Thing) for the coming week.
 */
export interface WeeklyReview {
  id: string;
  userId: string;
  teamId?: string;
  businessId?: string;
  weekKey: string;        // ISO week, e.g. "2026-W30"
  wins: string;           // what went well
  improve: string;        // what to improve
  nextWig: string;        // the One Thing / WIG for next week
  scoreSnapshot?: number; // productivity score at review time
  createdAt: Date;
  updatedAt: Date;
  createdByUserId?: string | null;
}
