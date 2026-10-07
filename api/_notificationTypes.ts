/**
 * Server mirror of `src/lib/notificationTypes.ts`.
 *
 * Vercel bundles /api separately and the convention in this repo is that server code
 * never pulls the React-side module graph (see the note at the top of api/_reports.ts).
 * So the table is duplicated — but NOT left to drift: `src/lib/notificationTypes.test.ts`
 * parses this file and fails the test run if a single type or category differs from
 * the canonical table. That guard is the reason this duplication is acceptable; the
 * previous hand-maintained copy in api/_send-notification-email.ts had no guard and
 * had already diverged on three types.
 *
 * KEEP IN SYNC WITH src/lib/notificationTypes.ts (the test enforces it).
 */

export type NotificationCategory =
  | 'tasks' | 'messages' | 'projects' | 'invoices' | 'reports' | 'system';

/** type → category. Mirrors NOTIFICATION_TYPES[t].category exactly. */
export const NOTIFICATION_TYPE_CATEGORY: Record<string, NotificationCategory> = {
  // tasks
  task_assigned: 'tasks',
  task_completed: 'tasks',
  task_overdue: 'tasks',
  task_due_soon: 'tasks',
  task_reminder: 'tasks',
  task_mention: 'tasks',
  task_collaborator_added: 'tasks',
  task_comment: 'tasks',
  recurring_task_created: 'tasks',
  goal_assigned: 'tasks',
  goal_achieved: 'tasks',
  goal_overdue: 'tasks',
  blocker_reported: 'tasks',
  // messages
  client_message: 'messages',
  staff_message: 'messages',
  direct_message: 'messages',
  channel_message: 'messages',
  mention: 'messages',
  project_comment: 'messages',
  client_request: 'messages',
  gmb_negative_review: 'messages',
  whatsapp_message: 'messages',
  conversation_sla: 'messages',
  // projects
  project_created: 'projects',
  project_completed: 'projects',
  project_status_changed: 'projects',
  project_open_reminder: 'projects',
  project_cycle_reset: 'projects',
  project_budget_alert: 'projects',
  lead_created: 'projects',
  lead_assigned: 'projects',
  lead_converted: 'projects',
  new_client: 'projects',
  lead_follow_up: 'projects',
  customer_follow_up: 'projects',
  lead_cadence_step: 'projects',
  crm_automation: 'projects',
  guest_project_invited: 'projects',
  guest_task_new: 'projects',
  guest_task_update: 'projects',
  // invoices
  invoice_created: 'invoices',
  invoice_sent: 'invoices',
  invoice_paid: 'invoices',
  invoice_overdue: 'invoices',
  invoice_reminder_sent: 'invoices',
  invoice_reminder1_sent: 'invoices',
  invoice_reminder2_sent: 'invoices',
  auto_invoice_created: 'invoices',
  hosting_renewal_invoice: 'invoices',
  hosting_provisioned: 'system',
  hosting_provision_failed: 'system',
  hosting_suspended: 'system',
  hosting_terminated: 'system',
  domain_registered: 'system',
  domain_renewed: 'system',
  domain_expiring: 'system',
  domain_action_failed: 'system',
  hosting_staff_login: 'system',
  hosting_usage_alert: 'system',
  hosting_drift: 'system',
  hosting_expiry_report: 'system',
  hosting_backup_failed: 'system',
  hosting_upgrade_invoice: 'invoices',
  recurring_expense_created: 'invoices',
  expense_daily_reminder: 'invoices',
  expense_submitted: 'invoices',
  quote_sent: 'invoices',
  quote_accepted: 'invoices',
  quote_rejected: 'invoices',
  contract_sent: 'invoices',
  // reports
  report: 'reports',
  daily_report_due: 'reports',
  daily_report_missing: 'reports',
  client_profitability_report: 'reports',
  // system
  billing: 'system',
  recurring_project_no_budget: 'system',
  recurring_project_billing_misconfigured: 'system',
};

/** Category of a type, or null for a legacy/unknown value (never muted). */
export function categoryOf(type?: string | null): NotificationCategory | null {
  if (!type) return null;
  return NOTIFICATION_TYPE_CATEGORY[type] ?? null;
}

/**
 * Is this type silenced by the user's category preferences?
 * An UNKNOWN type is never muted — identical rule to the client.
 */
export function isTypeMutedByPrefs(type?: string | null, prefs?: any): boolean {
  const cat = categoryOf(type);
  if (!cat) return false;
  return prefs?.categoryEnabled?.[cat] === false;
}
