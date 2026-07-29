import type { VercelRequest, VercelResponse } from '@vercel/node';
import inviteHandler from './_send-invite.js';
import invoiceHandler from './_send-invoice-email.js';
import leadReminderHandler from './_send-lead-reminder-email.js';
import welcomeHandler from './_send-welcome-email.js';
import notificationHandler from './_send-notification-email.js';
import marketingWebhookHandler from './_marketing-webhook.js';
import acceptInviteHandler from './_accept-invite.js';
import socialHandler from './_social-api.js';
import linkContactHandler from './_link-contact.js';
import syncClaimsHandler from './_sync-claims.js';
import notifyStaffHandler from './_notify-staff.js';
import tenantSecretsHandler from './_tenant-secrets.js';
import billingHandler from './_billing.js';

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
 *   /api/link-contact             -> ?type=link-contact
 *   /api/sync-claims              -> ?type=sync-claims     (tenant custom claims)
 *   /api/notify-staff             -> ?type=notify-staff    (portal → own tenant's staff)
 *   /api/tenant-secrets           -> ?type=tenant-secrets  (write-only credential vault)
 *   /api/billing                  -> ?type=billing         (Stripe subscription checkout/portal)
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
    else if (req.url.includes('link-contact')) type = 'link-contact';
    else if (req.url.includes('sync-claims')) type = 'sync-claims';
    else if (req.url.includes('notify-staff')) type = 'notify-staff';
    else if (req.url.includes('tenant-secrets')) type = 'tenant-secrets';
    else if (req.url.includes('/api/billing')) type = 'billing';
  }

  switch (type) {
    case 'sync-claims':
      // Materialises server-authoritative tenant claims (bid/tid/roles/cid).
      return syncClaimsHandler(req, res);
    case 'notify-staff':
      // Portal client → the staff of their OWN tenant (recipients resolved server-side).
      return notifyStaffHandler(req, res);
    case 'tenant-secrets':
      // Write-only credential vault (teamSecrets is deny-all for clients).
      return tenantSecretsHandler(req, res);
    case 'billing':
      // SaaS subscription: Stripe Checkout (mode=subscription) + Billing Portal.
      return billingHandler(req, res);
    case 'link-contact':
      // Pairs a customer with the CRM lead for the same person (portal bootstrap).
      return linkContactHandler(req, res);
    case 'social':
      // Social Media module — sub-dispatches on ?action= (oauth/list/sync/...).
      return socialHandler(req, res);
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
      return leadReminderHandler(req, res);
    case 'welcome':
      return welcomeHandler(req, res);
    case 'notification':
      return notificationHandler(req, res);
    default:
      return res.status(400).json({
        error: 'Unknown email type',
        detail: 'Expected ?type=invite|invoice|lead-reminder|welcome|notification',
      });
  }
}
