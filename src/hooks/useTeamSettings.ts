import { useEffect, useState } from 'react';
import { doc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useGlobalTeamId, setGlobalWaEnabled } from './useFirestore';
import type { NazmijeSettings } from '../lib/nazmije/core';

export interface BankAccount {
  id: string;
  bankName: string;
  accountHolder: string;
  iban: string;
  swift: string;
  country: string;
}

export interface MetaChannel {
  id: string;
  label: string;
  phone: string;
  phoneNumberId: string;
  /** Only ever populated in the Settings form while typing a NEW token. The stored
   *  value lives in `teamSecrets.metaChannelTokens[phoneNumberId]` (server-only). */
  accessToken: string;
  businessAccountId?: string;
}

/**
 * NON-SECRET tenant configuration, stored at `teamSettings/{teamId}` and readable
 * by members of the team's business.
 *
 * Credentials are NOT here — they live in `teamSecrets/{teamId}`, which Firestore
 * rules deny to every client (see api/_tenantConfig.ts). The `has*` booleans below
 * are the only thing the UI learns about them. Write them via
 * `saveTenantSecrets()` (src/lib/tenantSecrets.ts), never `saveTeamSettings()`.
 */
export interface TeamSettings {
  // ── credential presence markers (mirrored by the server on vault writes) ──
  hasAiApiKey?: boolean;
  hasEmailApiKey?: boolean;
  hasEmailSmtpPass?: boolean;
  hasWhatsappVpsSecret?: boolean;
  hasMetaWebhookVerifyToken?: boolean;
  hasMetaChannelTokens?: boolean;
  hasGmbClientSecret?: boolean;
  hasDynadotApiKey?: boolean;
  // Company identity (used in contract templates)
  companyName?: string;
  companyAddress?: string;
  companyNipt?: string;
  companyRepresentative?: string;
  companyEmail?: string;
  companyPhone?: string;
  bankAccounts?: BankAccount[];
  eurAllRate?: string;
  usdAllRate?: string;
  whatsappEnabled?: boolean;
  whatsappVpsUrl?: string;
  /** @deprecated moved to teamSecrets — never read/written from the client. */
  whatsappVpsSecret?: string;
  metaEnabled?: boolean;
  metaChannels?: MetaChannel[];
  /** @deprecated moved to teamSecrets. */
  metaWebhookVerifyToken?: string;
  metaPhoneNumberIds?: string[];
  // WhatsApp automation (Faza 4)
  waAutoReplyEnabled?: boolean;
  waAutoReplyText?: string;
  waBusinessStart?: string;          // "HH:MM" (Europe/Tirane)
  waBusinessEnd?: string;            // "HH:MM"
  // ── Auto-reply v2 (api/_waAutoReply.ts; edited in Cilësimet → Automatizime →
  //    "Ndjekja & Përgjigjet automatike", FollowUpSettingsPanel) ──
  /** Working weekdays for the outside-hours reply: 0 = Sunday … 6 = Saturday. Default [1..5]. */
  waBusinessDays?: number[];
  /** First-contact greeting: auto-sent ONCE to a number with no history (see waGreetingAfterDays). */
  waGreetingEnabled?: boolean;
  waGreetingText?: string;
  /** A contact silent for this many days counts as "new" again and gets the greeting. Default 7. */
  waGreetingAfterDays?: number;
  /** Minimum hours between two auto-replies to the same contact. Default 6. */
  waAutoReplyDebounceHours?: number;
  /** AI assistant on inbound WhatsApp: 'off' | 'draft' ("AI propozon, njeriu dërgon").
   *  'auto' is deliberately NOT offered. */
  waAiAssist?: 'off' | 'draft';
  /** Free-text business context fed to the AI prompt (services, hours, price policy — never secrets). */
  waAiContext?: string;
  /** Max AI drafts per team per day (`aiDailyUsage`). Default 200. */
  waAiDailyCap?: number;
  /** Create a lead for an unknown inbound WhatsApp number. Default true. */
  waAutoCreateLead?: boolean;
  /** Max auto-created leads per team per day (`waInboundCounters`). Default 50. */
  waAutoCreateLeadDailyCap?: number;
  // ── Follow-up thresholds (src/lib/crm/followUpConfig.ts validates; defaults there) ──
  /** Unanswered inbound WhatsApp → `conversation_sla` after N minutes (15–1440). Default 120. */
  waResponseSlaMinutes?: number;
  /** First-response SLA on a new lead, hours (1–168). Default 24. */
  followUpSlaHours?: number;
  /** No activity for N days → lead "i ftohur" (1–365). Default 14. */
  followUpStaleDays?: number;
  waFollowUpEnabled?: boolean;
  waFollowUpTemplateId?: string;     // ref → waTemplates
  waFollowUpChannelPhoneNumberId?: string;
  // WhatsApp auto-reminder: nudge stale "waiting" leads after N days of silence
  waAutoReminderEnabled?: boolean;
  waAutoReminderDays?: number;            // default 7
  waAutoReminderStatuses?: string[];      // lead statuses to target (default Follow-up, Proposal)
  waAutoReminderTemplateId?: string;      // ref → waTemplates
  waAutoReminderChannelPhoneNumberId?: string;
  // ── WhatsApp invoice reminders (src/lib/finance/invoiceWaReminders.ts resolves;
  //    defaults there; sent by the `overdue-reminders` cron) ──
  /** Master switch (legacy name kept: it used to be "escalation after 60 days" only). */
  waOverdueEnabled?: boolean;
  /** Overdue stage fires after N days late (1–365). Default 60. */
  waOverdueDays?: number;
  waOverdueTemplateId?: string;           // ref → waTemplates (Meta channel)
  waOverdueChannelPhoneNumberId?: string;
  /** Which invoices: 'all' | 'whmcs' (mirrored from WHMCS) | 'fivocrm'. Default 'all'. */
  waInvoiceSources?: 'all' | 'whmcs' | 'fivocrm';
  /** 'meta' (approved template) | 'baileys' (free text via the team's VPS). Default 'meta'. */
  waInvoiceChannel?: 'meta' | 'baileys';
  /** Baileys agent (whatsappAccounts id); empty = the VPS picks a connected one. */
  waInvoiceAgentId?: string;
  /** Free-text body for Baileys; tokens {{name}} {{invoiceNumber}} {{amount}} {{dueDate}} {{link}} … */
  waInvoiceText?: string;
  /** "Skadon për N ditë" stage; 0 = off (0–30). Default 0. */
  waInvoicePreDueDays?: number;
  /** "Skadon sot" stage. Default false. */
  waInvoiceOnDue?: boolean;
  /** Repeat the overdue stage every N days (1–90). Default 14. */
  waInvoiceRenotifyDays?: number;
  /** Local send window (Europe/Tirane hours, 0–23). Default 9–19. */
  waInvoiceHourStart?: number;
  waInvoiceHourEnd?: number;
  /** Skip FivoCRM's weekly overdue EMAIL for WHMCS invoices (WHMCS mails them itself). Default false. */
  overdueEmailSkipWhmcs?: boolean;
  /** Written by the cron after each tick: { at, sent, blocked: {reason: n} }. */
  waInvoiceLastRun?: { at?: any; sent?: number; considered?: number; blocked?: Record<string, number> };
  leadAssignCursor?: number;              // round-robin cursor for landing-page auto-assignment
  cronSettings?: Record<string, any>;
  cronLastRuns?: Record<string, any>;
  stripePublishableKey?: string;
  stripeMode?: 'test' | 'live';
  taskListOrder?: string[];
  // AI Assistant (FivoAI) — configured per-team from Settings → Integrime
  aiProvider?: 'gemini' | 'openai';
  /** @deprecated moved to teamSecrets (server-only). */
  aiApiKey?: string;
  aiModel?: string;         // optional model override (e.g. gemini-2.5-flash, gpt-4o-mini)
  // Email marketing provider — configured per-team from Settings → Integrime.
  // Read server-side by api/_mailer.ts (via teamSettings) when sending campaigns.
  emailProvider?: 'resend' | 'sendgrid' | 'mailgun' | 'brevo' | 'smtp';
  /** @deprecated moved to teamSecrets (server-only). */
  emailApiKey?: string;
  emailFromEmail?: string;      // verified sender address (e.g. marketing@domain.com)
  emailFromName?: string;       // default display name
  emailMailgunDomain?: string;  // Mailgun only: sending domain
  emailMailgunRegion?: 'us' | 'eu'; // Mailgun only: API region (default 'us')
  emailSmtpHost?: string;       // custom SMTP (falls back to env SMTP_* if empty)
  emailSmtpPort?: number;
  emailSmtpUser?: string;
  /** @deprecated moved to teamSecrets (server-only). */
  emailSmtpPass?: string;
  // Auto-reminder e-mails to clients whose submitted questionnaire is still
  // missing materials (logo/photos/services/…). Handled by the cron job
  // `inquiry-materials-reminders`.
  inquiryMaterialsReminderEnabled?: boolean;
  inquiryMaterialsReminderDays?: number;   // wait N days before (re)sending; default 3
  // Automated lead follow-up cadence: day-offsets (from enrollment) at which a
  // follow-up task is auto-created. Default [1, 3, 7, 14].
  leadCadenceDays?: number[];
  // Follow-up playbooks: label (service interest) → cadence steps with templates.
  // Validated by src/lib/crm/playbooks.ts (`resolvePlaybooks`); mirror api/_playbooks.ts.
  followUpPlaybooks?: import('../lib/crm/playbooks').Playbook[];
  // ── Client & project profitability (src/lib/finance/profitabilityCore.ts) ──
  /** Cost-rate, margin and overhead rules; every field optional, validated by
   *  `resolveFinanceSettings` (defaults there). */
  financeSettings?: Partial<import('../lib/finance/profitabilityCore').FinanceSettings>;
  /** Internal rate card: role → default capacity + selling rate. Never shown to clients. */
  rateCard?: Array<{ role: string; defaultCapacityHours?: number; sellRate?: number }>;
  // Custom business categories typed in the lead form, merged with the built-in
  // list. Best-effort write (only admins may write teamSettings) — the category
  // also lives on the lead itself, so the dropdown re-derives it either way.
  leadCategories?: string[];
  // ── Google Reviews (GMB) module ──
  /** Google OAuth Client ID i tenant-it (jo sekret; sekreti → teamSecrets.gmbClientSecret). */
  gmbClientId?: string;
  // ── Hosting & domains module ──
  /** Lifecycle days (renewal invoice lead, suspend/terminate grace, domain window). */
  hostingLifecycle?: { invoiceDaysBefore?: number; suspendDaysAfter?: number; terminateDaysAfter?: number; domainInvoiceDaysBefore?: number; domainGraceDays?: number };
  /** Default nameservers written on a freshly registered domain (falls back to the server's). */
  hostingDefaultNameservers?: string[];
  /** Currency the Dynadot account is billed in (for wholesale cost display). */
  dynadotCurrency?: string;
  /** Margin % applied to Dynadot wholesale costs to propose TLD sell prices (default 40). */
  hostingTldMarginPct?: number;
  hostingTldCostsSyncedAt?: any;
  hostingTldCostsLastResult?: { updated?: number; unmatched?: string[]; belowCost?: string[] };
  /** Days between scheduled pkgacct backups per account (default 7, 0 = off). */
  hostingBackupIntervalDays?: number;
  /** Last weekly expiry digest counts (written by the cron). */
  hostingExpiryReport?: { at?: any; domains30?: number; domains60?: number; subsDue30?: number; unpaid?: number; suspended?: number };
  /** Last hosting-lifecycle run summary (written by the cron). */
  hostingLastRun?: { at?: any; invoiced?: number; suspended?: number; terminated?: number; provisioned?: number; renewed?: number; blocked?: Record<string, number>; errors?: number };
  /** Sinkronizim i orarit (cron every hour). Default true; manual sync always works. */
  gmbAutoSync?: boolean;
  /** Njofto Admin/Manager kur vjen review ≤ 2★. Default true. */
  gmbNotifyNegative?: boolean;
  /** Auto-përgjigje AI për reviews të reja: off (default) | positive (4-5★) | all. */
  gmbAutoReply?: 'off' | 'positive' | 'all';
  /** Kontekst i lirë për AI (ton, emri i markës, oraret…) — futet në prompt. */
  gmbAiContext?: string;
  // ── Nazmije (sekretarja virtuale) ──
  /** `enabled`/`channelId` are written by POST /api/nazmije (enable/disable); the rest by Cilësimet. Shape: NazmijeSettings. */
  nazmije?: Partial<NazmijeSettings>;
}

/** Credential fields that must never be written to `teamSettings` (see tenantSecrets). */
const SECRET_FIELDS = [
  'aiApiKey', 'emailApiKey', 'emailSmtpPass', 'whatsappVpsSecret', 'metaWebhookVerifyToken',
  'gmbClientSecret',
] as const;

/**
 * Write partial teamSettings to Firestore (merge, not overwrite).
 *
 * Credential fields are stripped defensively: `teamSettings` is readable by every
 * member of the business, so a secret written here would be exposed. Use
 * `saveTenantSecrets()` for those.
 */
export async function saveTeamSettings(teamId: string, partial: Partial<TeamSettings>): Promise<void> {
  const safe: Record<string, any> = { ...partial };
  for (const f of SECRET_FIELDS) {
    if (f in safe) {
      console.warn(`[teamSettings] refusing to store credential "${f}" — use saveTenantSecrets()`);
      delete safe[f];
    }
  }
  if (Array.isArray(safe.metaChannels)) {
    safe.metaChannels = safe.metaChannels.map(({ accessToken: _t, ...rest }: any) => rest);
  }
  const docRef = doc(db, 'teamSettings', teamId);
  await setDoc(docRef, { ...safe, updatedAt: serverTimestamp() }, { merge: true });
}

/**
 * Subscribe to teamSettings/{teamId} and sync values to localStorage on every
 * Firestore update. This keeps all existing synchronous localStorage consumers
 * (getEurToAllRate, whatsapp_enabled check, bank auto-fill, etc.) working
 * correctly across devices without requiring a large refactor.
 *
 * Must be called inside a component that is a child of PermissionsProvider.
 */
export function useTeamSettingsSync(): void {
  const teamId = useGlobalTeamId();

  useEffect(() => {
    if (!teamId) return;

    const docRef = doc(db, 'teamSettings', teamId);
    const unsub = onSnapshot(docRef, (snap) => {
      if (!snap.exists()) return;
      const settings = snap.data() as TeamSettings;

      if (settings.bankAccounts !== undefined) {
        localStorage.setItem('bank_accounts', JSON.stringify(settings.bankAccounts));
        const first = settings.bankAccounts[0];
        if (first) {
          localStorage.setItem('default_bank_name', first.bankName);
          localStorage.setItem('default_bank_iban', first.iban);
          localStorage.setItem('default_bank_swift', first.swift);
          localStorage.setItem('default_bank_holder', first.accountHolder);
          localStorage.setItem('default_bank_country', first.country || '');
        }
      }

      if (settings.eurAllRate !== undefined) {
        localStorage.setItem('eur_all_rate', settings.eurAllRate);
      }

      if (settings.usdAllRate !== undefined) {
        localStorage.setItem('usd_all_rate', settings.usdAllRate);
      }

      if (settings.whatsappEnabled !== undefined) {
        localStorage.setItem('whatsapp_enabled', String(settings.whatsappEnabled));
        setGlobalWaEnabled(settings.whatsappEnabled);
      }

      if (settings.whatsappVpsUrl !== undefined) {
        localStorage.setItem('whatsapp_vps_url', settings.whatsappVpsUrl);
      }

      if (settings.cronSettings !== undefined) {
        localStorage.setItem('cron_settings', JSON.stringify(settings.cronSettings));
      }

      if (settings.cronLastRuns !== undefined) {
        localStorage.setItem('cron_last_runs', JSON.stringify(settings.cronLastRuns));
      }

      if (settings.stripePublishableKey !== undefined) {
        localStorage.setItem('stripe_publishable_key', settings.stripePublishableKey);
      }

      if (settings.stripeMode !== undefined) {
        localStorage.setItem('stripe_mode', settings.stripeMode);
      }

      if (settings.taskListOrder !== undefined) {
        localStorage.setItem('tasks_list_order', JSON.stringify(settings.taskListOrder));
      }
    });

    return unsub;
  }, [teamId]);
}

/**
 * Returns teamSettings as reactive React state, refreshed whenever Firestore
 * updates. Returns null until the first snapshot arrives (teamId not yet
 * resolved or document not yet loaded).
 */
export function useTeamSettingsData(): TeamSettings | null {
  const [settings, setSettings] = useState<TeamSettings | null>(null);
  const teamId = useGlobalTeamId();

  useEffect(() => {
    if (!teamId) return;
    const docRef = doc(db, 'teamSettings', teamId);
    const unsub = onSnapshot(docRef, (snap) => {
      setSettings(snap.exists() ? (snap.data() as TeamSettings) : {});
    });
    return unsub;
  }, [teamId]);

  return settings;
}
