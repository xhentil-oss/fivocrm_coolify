import type { VercelRequest, VercelResponse } from '@vercel/node';
import inviteHandler from './_send-invite.js';
import invoiceHandler from './_send-invoice-email.js';
import leadReminderHandler from './_send-lead-reminder-email.js';
import welcomeHandler from './_send-welcome-email.js';
import notificationHandler from './_send-notification-email.js';
import marketingWebhookHandler from './_marketing-webhook.js';

/**
 * Consolidated email dispatcher.
 *
 * Routes (via vercel.json rewrites that preserve the original client URL):
 *   /api/send-invite              -> ?type=invite
 *   /api/send-invoice-email       -> ?type=invoice
 *   /api/send-lead-reminder-email -> ?type=lead-reminder
 *   /api/send-welcome-email       -> ?type=welcome
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
  }

  switch (type) {
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
