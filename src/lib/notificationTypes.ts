/**
 * THE registry of notification types — one table, every consumer.
 *
 * Before this file the same knowledge lived in four places that had already drifted:
 * `TYPE_CONFIG` (icons, NotificationsCenter), `CATEGORY_TYPES` (client mute),
 * a second `CATEGORY_TYPES` (server mute, api/_send-notification-email.ts) and the
 * `NotificationType` union in types/index.ts. Eleven live types existed in none of
 * them, so they rendered with a generic icon, disappeared behind every category chip
 * and — because an unmapped type has no category — could never be muted. Two more
 * (`invoice_sent`, `contract_sent`) were muted server-side but not client-side, so a
 * user with "Fatura" off got no email while the bell kept counting them.
 *
 * Rules for this file:
 *   • Emitting a type that is not listed here is a bug. `assertKnownType` in the
 *     unit tests scans every `type:` literal in the codebase against this table.
 *   • `api/_notificationTypes.ts` is the server mirror (Vercel bundles /api
 *     separately and must not pull the React module graph). The unit test
 *     `notificationTypes.test.ts` fails the build if the two ever diverge — that is
 *     what makes the mirror safe.
 *   • Adding a type = one line here + one line in the mirror. Nothing else.
 *
 * Dependency-free on purpose (no React, no Firebase) so both sides can import it.
 */

export type NotificationCategory =
  | 'tasks' | 'messages' | 'projects' | 'invoices' | 'reports' | 'system';

export type NotificationPriority =
  | 'critical' | 'warning' | 'success' | 'info' | 'neutral';

export interface NotificationTypeSpec {
  category: NotificationCategory;
  priority: NotificationPriority;
  /** Albanian plural used when several of the same type collapse into one row. */
  groupLabel?: string;
  /** Client-portal facing: a portal user can legitimately receive this type. */
  portal?: boolean;
}

export const NOTIFICATION_TYPES = {
  // ── Detyra & objektiva ──────────────────────────────────────────────────────
  task_assigned:            { category: 'tasks',    priority: 'info',     groupLabel: 'caktime detyrash' },
  task_completed:           { category: 'tasks',    priority: 'success',  groupLabel: 'detyra të përfunduara' },
  task_overdue:             { category: 'tasks',    priority: 'critical', groupLabel: 'detyra të skaduara' },
  task_due_soon:            { category: 'tasks',    priority: 'warning',  groupLabel: 'detyra me afat' },
  // "Më kujto" — the person's own reminder on a task, delivered at the moment
  // they chose (task-reminders cron, every 5 min). Warning, not critical: it is
  // a nudge they asked for, not a missed deadline.
  task_reminder:            { category: 'tasks',    priority: 'warning',  groupLabel: 'kujtesa detyrash' },
  task_mention:             { category: 'tasks',    priority: 'info',     groupLabel: 'përmendje' },
  task_collaborator_added:  { category: 'tasks',    priority: 'info',     groupLabel: 'shtesa si bashkëpunëtor' },
  task_comment:             { category: 'tasks',    priority: 'info',     groupLabel: 'komente detyrash' },
  recurring_task_created:   { category: 'tasks',    priority: 'neutral',  groupLabel: 'detyra periodike' },
  goal_assigned:            { category: 'tasks',    priority: 'info' },
  goal_achieved:            { category: 'tasks',    priority: 'success' },
  goal_overdue:             { category: 'tasks',    priority: 'critical' },
  blocker_reported:         { category: 'tasks',    priority: 'warning',  groupLabel: 'pengesa të raportuara' },

  // ── Mesazhe & komunikim ─────────────────────────────────────────────────────
  client_message:           { category: 'messages', priority: 'info',     groupLabel: 'mesazhe klienti', portal: true },
  staff_message:            { category: 'messages', priority: 'info',     groupLabel: 'mesazhe stafi',   portal: true },
  direct_message:           { category: 'messages', priority: 'info',     groupLabel: 'mesazhe direkte' },
  // Message in a team/group channel. Sent to `channels.members` minus the sender —
  // before this existed a group message produced no bell row, no push and no email.
  channel_message:          { category: 'messages', priority: 'info',     groupLabel: 'mesazhe kanali' },
  mention:                  { category: 'messages', priority: 'info',     groupLabel: 'përmendje në chat' },
  project_comment:          { category: 'messages', priority: 'info',     groupLabel: 'komente projekti', portal: true },
  client_request:           { category: 'messages', priority: 'info',     groupLabel: 'kërkesa klientësh' },

  // Google Reviews (GMB): a fresh ≤2★ review is a client communication that needs
  // a same-day public answer — deliberately in `messages`, not `system`.
  gmb_negative_review:      { category: 'messages', priority: 'warning',  groupLabel: 'reviews negative në Google' },
  // Inbound WhatsApp (Meta + Baileys, one handler: api/_waInbound.ts) → the thread's
  // owner, else the tenant's managers. Burst-debounced server-side (2 min).
  whatsapp_message:         { category: 'messages', priority: 'info',     groupLabel: 'mesazhe WhatsApp' },
  // A WhatsApp thread waited past `waResponseSlaMinutes` with nobody answering
  // (cron `conversation-sla`, every 15 min). Critical: a potential client is leaving.
  conversation_sla:         { category: 'messages', priority: 'critical', groupLabel: 'SLA përgjigjeje' },

  // ── Projekte & CRM ──────────────────────────────────────────────────────────
  project_created:          { category: 'projects', priority: 'neutral',  portal: true },
  project_completed:        { category: 'projects', priority: 'success',  portal: true },
  project_status_changed:   { category: 'projects', priority: 'info' },
  project_open_reminder:    { category: 'projects', priority: 'warning',  groupLabel: 'kujtesa projektesh' },
  project_cycle_reset:      { category: 'projects', priority: 'neutral' },
  // Budget consumed crossed 70 / 85 / 100 % of the staffing plan (project-spend-rollup).
  project_budget_alert:     { category: 'projects', priority: 'warning',  groupLabel: 'alarme buxheti projektesh' },
  lead_created:             { category: 'projects', priority: 'info',     groupLabel: 'lead të rinj' },
  lead_assigned:            { category: 'projects', priority: 'info',     groupLabel: 'lead të caktuar' },
  lead_converted:           { category: 'projects', priority: 'success' },
  // Emitted through notifyStaff() when a portal client self-registers
  // (useClientPortal) — was live but unregistered, so it had no icon and no mute.
  new_client:               { category: 'projects', priority: 'success',  groupLabel: 'klientë të rinj' },
  lead_follow_up:           { category: 'projects', priority: 'warning',  groupLabel: 'rikontaktime lead' },
  // The customer counterpart of lead_follow_up: a scheduled next step on a CUSTOMER is due.
  customer_follow_up:       { category: 'projects', priority: 'warning',  groupLabel: 'rikontakte klientësh' },
  lead_cadence_step:        { category: 'projects', priority: 'warning',  groupLabel: 'hapa ndjekjeje' },
  // Fired by a CRM automation rule (src/lib/crm/automationRules.ts → cron `crm-automations`).
  crm_automation:           { category: 'projects', priority: 'info',     groupLabel: 'automatizime CRM' },
  guest_project_invited:    { category: 'projects', priority: 'info' },
  guest_task_new:           { category: 'projects', priority: 'neutral' },
  guest_task_update:        { category: 'projects', priority: 'neutral' },

  // ── Financa ─────────────────────────────────────────────────────────────────
  invoice_created:          { category: 'invoices', priority: 'neutral' },
  invoice_sent:             { category: 'invoices', priority: 'neutral',  portal: true },
  invoice_paid:             { category: 'invoices', priority: 'success',  groupLabel: 'pagesa faturash', portal: true },
  invoice_overdue:          { category: 'invoices', priority: 'critical', groupLabel: 'fatura të skaduara', portal: true },
  invoice_reminder_sent:    { category: 'invoices', priority: 'warning',  groupLabel: 'kujtesa faturash', portal: true },
  // Legacy variants written by older cron runs — kept so historical rows still
  // render, categorise and mute correctly. New runs emit invoice_reminder_sent.
  invoice_reminder1_sent:   { category: 'invoices', priority: 'warning',  groupLabel: 'kujtesa faturash' },
  invoice_reminder2_sent:   { category: 'invoices', priority: 'warning',  groupLabel: 'kujtesa faturash' },
  auto_invoice_created:     { category: 'invoices', priority: 'neutral',  groupLabel: 'fatura automatike' },
  // Hosting & domains module (cPanel/WHM + Dynadot)
  hosting_renewal_invoice:  { category: 'invoices', priority: 'info',     groupLabel: 'fatura rinovimi', portal: true },
  hosting_provisioned:      { category: 'system',   priority: 'success',  groupLabel: 'llogari hosting të aktivizuara', portal: true },
  hosting_provision_failed: { category: 'system',   priority: 'critical', groupLabel: 'aktivizime të dështuara' },
  hosting_suspended:        { category: 'system',   priority: 'warning',  groupLabel: 'llogari të pezulluara', portal: true },
  hosting_terminated:       { category: 'system',   priority: 'critical', groupLabel: 'llogari të terminuara', portal: true },
  domain_registered:        { category: 'system',   priority: 'success',  groupLabel: 'domain-e të regjistruara', portal: true },
  domain_renewed:           { category: 'system',   priority: 'success',  groupLabel: 'domain-e të rinovuara', portal: true },
  domain_expiring:          { category: 'system',   priority: 'warning',  groupLabel: 'domain-e që skadojnë', portal: true },
  domain_action_failed:     { category: 'system',   priority: 'critical', groupLabel: 'veprime domain të dështuara' },
  hosting_staff_login:      { category: 'system',   priority: 'info',     groupLabel: 'hyrje stafi në cPanel', portal: true },
  hosting_usage_alert:      { category: 'system',   priority: 'warning',  groupLabel: 'alarme përdorimi disku', portal: true },
  hosting_drift:            { category: 'system',   priority: 'warning',  groupLabel: 'mospërputhje WHM / kosto TLD' },
  hosting_expiry_report:    { category: 'system',   priority: 'info',     groupLabel: 'raporte javore hosting' },
  hosting_backup_failed:    { category: 'system',   priority: 'warning',  groupLabel: 'backup-e të dështuara' },
  hosting_upgrade_invoice:  { category: 'invoices', priority: 'info',     groupLabel: 'fatura upgrade', portal: true },
  recurring_expense_created:{ category: 'invoices', priority: 'neutral' },
  expense_submitted:        { category: 'invoices', priority: 'neutral',  groupLabel: 'shpenzime të reja' },
  quote_sent:               { category: 'invoices', priority: 'neutral',  portal: true },
  quote_accepted:           { category: 'invoices', priority: 'success' },
  quote_rejected:           { category: 'invoices', priority: 'warning' },
  contract_sent:            { category: 'invoices', priority: 'neutral',  portal: true },

  // ── Raporte ─────────────────────────────────────────────────────────────────
  report:                   { category: 'reports',  priority: 'info',     groupLabel: 'njoftime raportesh', portal: true },
  // The daily-report escalation ladder: the person first, their manager after.
  daily_report_due:         { category: 'reports',  priority: 'warning',  groupLabel: 'raporte në pritje' },
  daily_report_missing:     { category: 'reports',  priority: 'critical', groupLabel: 'raporte që mungojnë' },
  // Day 2 of the month: the client-profitability table for last month is ready to review/close.
  client_profitability_report: { category: 'reports', priority: 'info' },

  // ── Sistem (abonim + konfigurim i gabuar) ───────────────────────────────────
  // Deliberately its own category: these are "your account/setup is broken"
  // messages. Bundling them into `invoices` let a user mute their own billing
  // warnings by turning off invoice notifications.
  billing:                              { category: 'system', priority: 'warning' },
  recurring_project_no_budget:          { category: 'system', priority: 'warning' },
  recurring_project_billing_misconfigured: { category: 'system', priority: 'warning' },
} as const satisfies Record<string, NotificationTypeSpec>;

/** Every type the product may emit. A value outside this union is a bug. */
export type NotificationType = keyof typeof NOTIFICATION_TYPES;

export const ALL_NOTIFICATION_TYPES = Object.keys(NOTIFICATION_TYPES) as NotificationType[];

export const NOTIFICATION_CATEGORIES: NotificationCategory[] =
  ['tasks', 'messages', 'projects', 'invoices', 'reports', 'system'];

export const CATEGORY_LABELS: Record<NotificationCategory, string> = {
  tasks:    'Detyra',
  messages: 'Mesazhe',
  projects: 'Projekte',
  invoices: 'Fatura',
  reports:  'Raporte',
  system:   'Sistemi',
};

export const CATEGORY_DESCRIPTIONS: Record<NotificationCategory, string> = {
  tasks:    'Detyra, afate, objektiva, pengesa',
  messages: 'Chat, DM, komente, kërkesa klientësh',
  projects: 'Projekte, leads, status, guests',
  invoices: 'Fatura, pagesa, oferta, shpenzime',
  reports:  'Raporte, aprovime, komente raportesh',
  system:   'Abonimi dhe paralajmërime konfigurimi',
};

/** Types grouped by category — the shape the old CATEGORY_TYPES tables had. */
export const CATEGORY_TYPES: Record<NotificationCategory, NotificationType[]> =
  NOTIFICATION_CATEGORIES.reduce((acc, cat) => {
    acc[cat] = ALL_NOTIFICATION_TYPES.filter(t => NOTIFICATION_TYPES[t].category === cat);
    return acc;
  }, {} as Record<NotificationCategory, NotificationType[]>);

export function isKnownNotificationType(type?: string | null): type is NotificationType {
  return !!type && Object.prototype.hasOwnProperty.call(NOTIFICATION_TYPES, type);
}

/** Category of a type, or null for a legacy/unknown value (never muted). */
export function categoryOf(type?: string | null): NotificationCategory | null {
  return isKnownNotificationType(type) ? NOTIFICATION_TYPES[type].category : null;
}

export function priorityOf(type?: string | null): NotificationPriority {
  return isKnownNotificationType(type) ? NOTIFICATION_TYPES[type].priority : 'neutral';
}

export function groupLabelOf(type?: string | null): string {
  if (!isKnownNotificationType(type)) return 'njoftime';
  // `satisfies` keeps the literal types, so `groupLabel` is absent (not optional)
  // on the entries that don't declare one — read it through the wider spec type.
  const spec: NotificationTypeSpec = NOTIFICATION_TYPES[type];
  return spec.groupLabel || 'njoftime';
}

/**
 * Is this type silenced by the user's category preferences?
 *
 * An UNKNOWN type is never muted — losing a notification because it postdates the
 * table is worse than showing one the user filtered out. Same rule on both sides.
 */
export function isTypeMutedByPrefs(
  type: string | undefined | null,
  categoryEnabled?: Partial<Record<NotificationCategory, boolean>> | null,
): boolean {
  const cat = categoryOf(type);
  if (!cat || !categoryEnabled) return false;
  return categoryEnabled[cat] === false;
}
