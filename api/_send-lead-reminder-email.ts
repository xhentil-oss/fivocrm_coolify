import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handleContactEmail } from './_contact-email.js';

/**
 * POST /api/send-lead-reminder-email  (?type=lead-reminder) — LEGACY ADAPTER.
 * Body: { leadId: string, message: string, subject?: string }
 *
 * The send itself moved to `api/_contact-email.ts` (tenant provider, From
 * "Staff - Company", Reply-To the staff member, server-side stamps). This shim
 * only maps the old body shape onto the new contract so the existing CRMView
 * "Dërgo Email" call keeps working.
 *
 * `skipActivityRow`: the legacy caller still logs the timeline row itself
 * (`followUp.logContact(...)` right after the fetch), so the server must not
 * write a second one here. New callers use `/api/contact-email` directly and
 * let the server log.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const body = (req.body && typeof req.body === 'object') ? req.body : {};
  const { leadId, message, subject } = body as { leadId?: unknown; message?: unknown; subject?: unknown };
  if (!leadId || typeof leadId !== 'string') return res.status(400).json({ error: 'Missing leadId' });
  if (!message || typeof message !== 'string' || !message.trim()) return res.status(400).json({ error: 'Missing message' });
  req.body = {
    leadId,
    subject: typeof subject === 'string' && subject.trim() ? subject.trim() : undefined,
    text: message.trim(),
    replyToSelf: true,
  };
  return handleContactEmail(req, res, { skipActivityRow: true, defaultSubject: true });
}
