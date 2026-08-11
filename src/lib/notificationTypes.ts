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
  task_overdue:             { category: 'tasks',    priority: 'critical', groupLabel: 'detyra të skaduara' },
  task_due_soon:            { category: 'tasks',    priority: 'warning',  groupLabel: 'detyra me afat' },
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
  mention:                  { category: 'messages', priority: 'info',     groupLabel: 'përmendje në chat' },
  project_comment:          { category: 'messages', priority: 'info',     groupLabel: 'komente projekti', portal: true },
  client_request:           { category: 'messages', priority: 'info',     groupLabel: 'kërkesa klientësh' },

  // ── Projekte & CRM ──────────────────────────────────────────────────────────
  project_created:          { category: 'projects', priority: 'neutral',  portal: true },
  project_completed:        { category: 'projects', priority: 'success',  portal: true },
  project_status_changed:   { category: 'projects', priority: 'info' },
  project_open_reminder:    { category: 'projects', priority: 'warning',  groupLabel: 'kujtesa projektesh' },
  project_cycle_reset:      { category: 'projects', priority: 'neutral' },
  lead_created:             { category: 'projects', priority: 'info',     groupLabel: 'lead të rinj' },
  lead_assigned:            { category: 'projects', priority: 'info',     groupLabel: 'lead të caktuar' },
  lead_converted:           { category: 'projects', priority: 'success' },
  lead_follow_up:           { category: 'projects', priority: 'warning',  groupLabel: 'rikontaktime lead' },
  lead_cadence_step:        { category: 'projects', priority: 'warning',  groupLabel: 'hapa ndjekjeje' },
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
  recurring_expense_created:{ category: 'invoices', priority: 'neutral' },
  expense_submitted:        { category: 'invoices', priority: 'neutral',  groupLabel: 'shpenzime të reja' },
  quote_sent:               { category: 'invoices', priority: 'neutral',  portal: true },
  quote_accepted:           { category: 'invoices', priority: 'success' },
  quote_rejected:           { category: 'invoices', priority: 'warning' },
  contract_sent:            { category: 'invoices', priority: 'neutral',  portal: true },

  // ── Raporte ─────────────────────────────────────────────────────────────────
  report:                   { category: 'reports',  priority: 'info',     groupLabel: 'njoftime raportesh', portal: true },

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
