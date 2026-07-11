// Firebase/Firestore type definitions for the application

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
    assignedToUserId?: string;        // assignedToUserId (leads + customers)
    source?: string;                  // filter by origin (e.g. 'whmcs') — leads + customers
  };
  scheduledAt?: Date | null;
  status: 'draft' | 'queued' | 'sending' | 'completed' | 'failed';
  totalTargets?: number;
  sentCount?: number;
  sentPhones?: string[];              // idempotency: recipients already sent
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
  customerId?: string;
  budget?: number;
  spent?: number;
  responsibleUserId?: string;
  memberUserIds?: string[];
  guestUserIds?: string[];  // Users with read-only + comment access to this project
  sourceQuestionnaireId?: string; // ServiceInquiry that this project was created from
  // Recurring project support
  isRecurring?: boolean;
  recurringFrequency?: 'weekly' | 'monthly';
  nextRecurringDate?: Date;
  lastCompletedAt?: Date; // used for bonus calculation instead of updatedAt
  lastInvoiceGeneratedAt?: Date;
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
  /** Nav paths disabled for this tenant (super-admin toggles per business). */
  disabledModules?: string[];
  /** Portal subdomain for this tenant: `<portalSubdomain>.fivocrm.com/portal`.
   * Resolves hostname → businessId so this tenant's clients register/scope to it. */
  portalSubdomain?: string;
  createdAt: Date;
  updatedAt: Date;
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
  canAccessSettings?: boolean;
  canAccessWhatsapp?: boolean;
  canAccessGoals?: boolean;
  canAccessTeams?: boolean;
  canAccessChat?: boolean;
  canAccessCustomers?: boolean;
  canAccessServices?: boolean;
  canAccessExpenses?: boolean;
  canAccessProfile?: boolean;
  monthlySalary?: number;
  /** Internal labor cost per hour (ALL). Used to cost logged time into project
   *  spend & per-client P&L. If unset, derived from monthlySalary / 160. */
  hourlyCostRate?: number;
  /** Optional billing rate per hour (ALL) — what the client is charged for this
   *  member's time. Used for realization (billable value vs logged cost). */
  hourlyBillRate?: number;
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
  attachments?: string;
  collaboratorIds?: string[];
  createdAt: Date;
  updatedAt: Date;
  createdByUserId: string | null;
}

export interface Customer {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  company?: string;
  address?: string;
  teamId?: string;
  leadId?: string;
  assignedToUserId?: string;
  /** Set when the customer was imported/mirrored from WHMCS. */
  source?: 'whmcs' | string;
  /** WHMCS client id — idempotency key for the WHMCS → FivoCRM client sync. */
  whmcsClientId?: string;
  /** Opt-out: when true, this customer is NOT emailed/messaged about overdue invoices. */
  disableOverdueReminders?: boolean;
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
  parentInvoiceId?: string;
  autoGenerated?: boolean;
  stripeSessionId?: string;
  stripePaymentIntentId?: string;
  /** Origin of the invoice. 'whmcs' = mirrored one-way from WHMCS billing. */
  source?: 'whmcs' | 'manual' | 'stripe';
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
  createdAt: Date;
  updatedAt: Date;
  createdByUserId: string | null;
}

/** Active hosting/product subscription mirrored one-way from WHMCS. */
export interface Subscription {
  id: string;
  /** WHMCS service (client product) id — idempotency key. */
  whmcsServiceId: string;
  whmcsClientId?: string;
  customerId?: string;
  teamId?: string;
  productName: string;
  domain?: string;
  status: 'Active' | 'Suspended' | 'Terminated' | 'Pending' | 'Cancelled';
  recurringAmount: number;
  currency?: 'ALL' | 'EUR';
  billingCycle?: string;
  nextDueDate?: Date;
  source: 'whmcs';
  createdAt: Date;
  updatedAt: Date;
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

export interface Expense {
  id: string;
  title: string;
  description?: string;
  amount: number;
  currency?: string;
  category: string;
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
  recurringFrequency?: string;
  nextRecurringDate?: Date;
  /** Optional "repeat until" — the cron stops generating after this date and
   *  auto-clears isRecurring. Past occurrences are never touched. */
  recurringEndDate?: Date;
  /** Temporarily halts generation without ending the series (resume later). */
  isRecurringPaused?: boolean;
  /** Set on cron-generated occurrences; links a child back to its parent
   *  (mirrors invoices' parentInvoiceId/autoGenerated). */
  parentExpenseId?: string;
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
  /** Metric tracking */
  targetValue?: number;
  currentValue?: number;
  metricUnit?: string; // e.g. "€", "leads", "projekte"
  teamId?: string;
  createdAt: Date;
  updatedAt: Date;
  createdByUserId: string | null;
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

export interface Lead {
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
  lastFollowUpDate?: Date;
  nextFollowUpDate?: Date;
  followUpNote?: string;
  lastReminderSentAt?: Date;
  tags?: string[];
  serviceInquiryId?: string;
  assignedToUserId?: string;
  customerId?: string;          // set when converted (reverse link to the Customer)
  firstResponseAt?: Date;       // first outbound touch (for response-time/SLA)
  lastActivityAt?: Date;        // most recent timeline activity (for temperature/staleness)
  slaBreachNotified?: boolean;  // cron debounce: first-response SLA breach alerted
  staleNotifiedAt?: Date;       // cron debounce: last staleness alert
  waAutoReminderAt?: Date;      // cron debounce: last WhatsApp auto-reminder sent
  // Automated follow-up cadence: when active, the cron auto-creates a follow-up
  // task at each configured day-offset until the steps run out or the lead closes.
  cadenceActive?: boolean;
  cadenceStartedAt?: Date;
  cadenceStep?: number;         // next step index to fire (0-based)
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

export interface InvoiceItem {
  id: string;
  invoiceId: string;
  serviceId?: string;
  description?: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
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
  canAccessSettings?: boolean;
  canAccessGoals?: boolean;
  canAccessTeams?: boolean;
  canAccessChat?: boolean;
  canAccessCustomers?: boolean;
  canAccessServices?: boolean;
  canAccessExpenses?: boolean;
  canAccessProfile?: boolean;
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

export type NotificationType =
  | 'task_assigned' | 'task_overdue' | 'task_due_soon' | 'task_mention' | 'task_collaborator_added'
  | 'project_completed' | 'project_created' | 'project_open_reminder' | 'project_cycle_reset'
  | 'invoice_paid' | 'invoice_overdue' | 'invoice_created' | 'invoice_reminder_sent'
  | 'invoice_reminder1_sent' | 'invoice_reminder2_sent' | 'auto_invoice_created'
  | 'lead_created' | 'lead_assigned' | 'lead_converted' | 'lead_follow_up'
  | 'quote_accepted' | 'quote_rejected'
  | 'goal_achieved' | 'goal_assigned' | 'goal_overdue'
  | 'client_message' | 'staff_message' | 'project_comment' | 'client_request'
  | 'recurring_task_created' | 'recurring_expense_created'
  | 'expense_submitted'
  | 'guest_project_invited' | 'guest_task_new' | 'guest_task_update'
  | 'project_status_changed'
  | 'blocker_reported'
  | string; // fallback for future types

export interface Notification {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  message?: string;
  isRead?: boolean;
  teamId?: string;
  actionType?: 'link' | 'approve' | 'view';
  actionUrl?: string;
  actionLabel?: string;
  linkTo?: string;
  createdAt: Date;
}

export interface Activity {
  id: string;
  type: 'invoice_created' | 'invoice_paid' | 'lead_created' | 'lead_converted' | 'task_completed' | 'project_created' | 'customer_created' | 'expense_added' | 'request_created' | 'meeting' | 'call' | 'email_sent' | 'note';
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

export interface DailyReport {
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
  createdAt: Date;
  updatedAt: Date;
}
