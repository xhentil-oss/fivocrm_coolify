import type { VercelRequest, VercelResponse } from '@vercel/node';
import inviteHandler from './_send-invite.js';
import invoiceHandler from './_send-invoice-email.js';
import leadReminderHandler from './_send-lead-reminder-email.js';
import welcomeHandler from './_send-welcome-email.js';
import notificationHandler from './_send-notification-email.js';
import marketingWebhookHandler from './_marketing-webhook.js';
import acceptInviteHandler from './_accept-invite.js';
import socialHandler from './_social-api.js';
import gmbHandler from './_gmb-api.js';
import linkContactHandler from './_link-contact.js';
import mergeContactsHandler from './_merge-contacts.js';
import whmcsPaymentHandler from './_whmcs-payment.js';
import hostingHandler from './_hosting.js';
import syncClaimsHandler from './_sync-claims.js';
import notifyStaffHandler from './_notify-staff.js';
import tenantSecretsHandler from './_tenant-secrets.js';
import billingHandler from './_billing.js';
import reportsHandler from './_reports.js';
import platformAdminHandler from './_platformAdmin.js';
import waInboundHandler from './_waInbound.js';
import contactEmailHandler from './_contact-email.js';
import aiReplyHandler from './_ai-reply.js';
import nazmijeHandler from './_nazmije.js';
import salesAgentHandler from './_salesAgent.js';
import reportContentHandler from './_report-content.js';

/**
 * Consolidated dispatcher (named "email" for historical reasons — it also routes
 * several non-email actions: marketing-webhook, accept-invite, and social).
 *
 * Routes (via vercel.json rewrites that preserve the original client URL + query):
 *   /api/send-invite              -> ?type=invite
 *   /api/send-invoice-email       -> ?type=invoice
 *   /api/send-lead-reminder-email -> ?type=lead-reminder
 *   /api/send-welcome-email       -> ?type=welcome
 *   /api/accept-invite            -> ?type=accept-invite
 *   /api/social                   -> ?type=social  (sub-dispatches on ?action=)
 *   /api/gmb                      -> ?type=gmb     (Google Reviews; sub-dispatches on ?action=)
 *   /api/link-contact             -> ?type=link-contact
 *   /api/merge-contacts           -> ?type=merge-contacts  (manual duplicate merge)
 *   /api/sync-claims              -> ?type=sync-claims     (tenant custom claims)
 *   /api/notify-staff             -> ?type=notify-staff    (portal → own tenant's staff)
 *   /api/tenant-secrets           -> ?type=tenant-secrets  (write-only credential vault)
 *   /api/billing                  -> ?type=billing         (Stripe subscription checkout/portal)
 *   /api/reports                  -> ?type=reports         (client report actions + email delivery)
 *   /api/platform-admin           -> ?type=platform-admin  (super-admin tenant administration)
 *   /api/wa-inbound               -> ?type=wa-inbound      (VPS → inbound WhatsApp event, Bearer CRON_SECRET)
 *   /api/contact-email            -> ?type=contact-email   (1:1 email to a lead/customer, logged + Reply-To staff)
 *   /api/ai-reply                 -> ?type=ai-reply        (on-demand WhatsApp reply suggestion — AI proposes, a person sends)
 *   /api/nazmije                  -> ?type=nazmije         (virtual secretary: ask / enable / disable — staff only)
 *   /api/report-content           -> ?type=report-content  ("Raporto mesazhin" — App Store 1.2)
 *
 * Created to stay under Vercel Hobby's 12-function limit.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const rawType = req.query.type;
  let type = Array.isArray(rawType) ? rawType[0] : rawType;

  // Fallback: derive from req.url path if query param is absent (defensive).
  if (!type && typeof req.url === 'string') {
    if (req.url.includes('send-invite')) type = 'invite';
    else if (req.url.includes('send-invoice-email')) type = 'invoice';
    else if (req.url.includes('send-lead-reminder-email')) type = 'lead-reminder';
    else if (req.url.includes('send-welcome-email')) type = 'welcome';
    else if (req.url.includes('send-notification-email')) type = 'notification';
    else if (req.url.includes('marketing-webhook')) type = 'marketing-webhook';
    else if (req.url.includes('accept-invite')) type = 'accept-invite';
    else if (req.url.includes('/api/social')) type = 'social';
    else if (req.url.includes('/api/gmb')) type = 'gmb';
    else if (req.url.includes('merge-contacts')) type = 'merge-contacts';
    else if (req.url.includes('whmcs-payment')) type = 'whmcs-payment';
    else if (req.url.includes('/api/hosting')) type = 'hosting';
    else if (req.url.includes('link-contact')) type = 'link-contact';
    else if (req.url.includes('sync-claims')) type = 'sync-claims';
    else if (req.url.includes('notify-staff')) type = 'notify-staff';
    else if (req.url.includes('tenant-secrets')) type = 'tenant-secrets';
    else if (req.url.includes('/api/billing')) type = 'billing';
    else if (req.url.includes('/api/reports')) type = 'reports';
    else if (req.url.includes('platform-admin')) type = 'platform-admin';
    else if (req.url.includes('wa-inbound')) type = 'wa-inbound';
    else if (req.url.includes('contact-email')) type = 'contact-email';
    else if (req.url.includes('ai-reply')) type = 'ai-reply';
    else if (req.url.includes('/api/nazmije')) type = 'nazmije';
    else if (req.url.includes('/api/sales-agent')) type = 'sales-agent';
    else if (req.url.includes('report-content')) type = 'report-content';
  }

  switch (type) {
    case 'report-content':
      // Chat "Raporto": stores the report server-side, notifies managers, emails the platform.
      return reportContentHandler(req, res);
    case 'sales-agent':
      // Ana, the virtual sales agent: prospecting searches, prospect registration,
      // handoff/resume, simulation, drafts, enable/disable (api/_salesAgent.ts).
      return salesAgentHandler(req, res);
    case 'nazmije':
      // Nazmije, the team's virtual secretary: replies to a DM / @mention, and the
      // Admin's enable/disable. Every row she sends is written here (api/_nazmije.ts).
      return nazmijeHandler(req, res);
    case 'contact-email':
      // 1:1 email from the CRM to a lead/customer through the tenant's provider;
      // the server writes the timeline row + contact stamps (the client must not).
      return contactEmailHandler(req, res);
    case 'ai-reply':
      // "Sugjerim AI" for a WhatsApp thread, on demand (Rigjenero). Stored on the
      // conversation doc; never sent by itself.
      return aiReplyHandler(req, res);
    case 'wa-inbound':
      // Baileys VPS → one inbound handler for both WhatsApp channels (identity,
      // conversation, notification, auto-reply). Authenticated with CRON_SECRET.
      return waInboundHandler(req, res);
    case 'platform-admin':
      // Platform console writes (tenant plan/status/seats/modules). Super-admin only,
      // validated + audited server-side — see api/_platformAdmin.ts.
      return platformAdminHandler(req, res);
    case 'sync-claims':
      // Materialises server-authoritative tenant claims (bid/tid/roles/cid).
      return syncClaimsHandler(req, res);
    case 'notify-staff':
      // Portal client → the staff of their OWN tenant (recipients resolved server-side).
      return notifyStaffHandler(req, res);
    case 'tenant-secrets':
      // Write-only credential vault (teamSecrets is deny-all for clients).
      return tenantSecretsHandler(req, res);
    case 'reports':
      // Reporting module: client view/ack/approve/reject/comment + staff email send.
      // The client's own writes are denied by Firestore rules, so this is the only
      // way a client decision can be recorded — and it re-checks ownership.
      return reportsHandler(req, res);
    case 'billing':
      // SaaS subscription: Stripe Checkout (mode=subscription) + Billing Portal.
      return billingHandler(req, res);
    case 'link-contact':
      // Pairs a customer with the CRM lead for the same person (portal bootstrap).
      return linkContactHandler(req, res);
    case 'merge-contacts':
      // Manual duplicate merge: moves invoices/projects/quotes/chat/... onto the
      // surviving record. Admin/Manager of the tenant only, archived + audited.
      return mergeContactsHandler(req, res);
    case 'whmcs-payment':
      // Posts a payment recorded inside FivoCRM (manual "Paguar" / instalment) to
      // WHMCS. Staff of the invoice's business only; idempotent per payment key.
      return whmcsPaymentHandler(req, res);
    case 'hosting':
      // Hosting & domains module — sub-dispatches on body.action (cPanel/WHM +
      // Dynadot drivers, orders, provisioning). Staff of the tenant; a portal client
      // only for its own subscriptions/domains.
      return hostingHandler(req, res);
    case 'social':
      // Social Media module — sub-dispatches on ?action= (oauth/list/sync/...).
      return socialHandler(req, res);
    case 'gmb':
      // Google Reviews (Business Profile) module — sub-dispatches on ?action=.
      return gmbHandler(req, res);
    case 'accept-invite':
      return acceptInviteHandler(req, res);
    case 'marketing-webhook':
      // Inbound ESP event (open/click) — no Firebase auth (called by the ESP).
      return marketingWebhookHandler(req, res);
    case 'invite':
      return inviteHandler(req, res);
    case 'invoice':
      return invoiceHandler(req, res);
    case 'lead-reminder':
      // Legacy adapter → contact-email (kept for the CRMView "Dërgo Email" call).
      return leadReminderHandler(req, res);
    case 'welcome':
      return welcomeHandler(req, res);
    case 'notification':
      return notificationHandler(req, res);
    default:
      return res.status(400).json({
        error: 'Unknown email type',
        detail: 'Expected ?type=invite|invoice|lead-reminder|welcome|notification|reports',
      });
  }
}
