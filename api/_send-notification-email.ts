import type { VercelRequest, VercelResponse } from '@vercel/node';
import nodemailer from 'nodemailer';
import { adminAuth, adminDb } from './_firebaseAdmin.js';

// Simple in-memory per-caller rate limiter (best-effort; resets on cold start).
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
function checkRateLimit(uid: string, maxPerHour = 120): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(uid);
  if (entry && entry.resetAt > now) {
    if (entry.count >= maxPerHour) return false;
    entry.count++;
    return true;
  }
  rateLimitMap.set(uid, { count: 1, resetAt: now + 3_600_000 });
  return true;
}

function escapeHtml(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && !email.includes('\n') && !email.includes('\r');
}

// Notification type → category (mirrors NotificationsCenter CATEGORY_TYPES).
const CATEGORY_TYPES: Record<string, string[]> = {
  tasks:    ['task_overdue', 'task_due_soon', 'task_assigned', 'task_collaborator_added', 'task_mention', 'recurring_task_created', 'goal_overdue', 'goal_assigned', 'goal_achieved', 'blocker_reported'],
  messages: ['client_message', 'staff_message', 'project_comment', 'client_request'],
  projects: ['project_created', 'project_completed', 'project_open_reminder', 'project_cycle_reset', 'lead_converted', 'lead_assigned', 'lead_follow_up', 'guest_project_invited', 'guest_task_new', 'guest_task_update', 'project_status_changed'],
  invoices: ['invoice_overdue', 'invoice_paid', 'invoice_reminder_sent', 'auto_invoice_created', 'invoice_created', 'recurring_expense_created', 'expense_submitted', 'quote_accepted', 'quote_rejected'],
};
function categoryOf(type?: string): string | null {
  if (!type) return null;
  for (const [cat, types] of Object.entries(CATEGORY_TYPES)) if (types.includes(type)) return cat;
  return null;
}

// True when the current time is inside the user's Do-Not-Disturb window (UTC).
function isDndActive(prefs: any): boolean {
  if (!prefs?.dndEnabled || !prefs?.dndStart || !prefs?.dndEnd) return false;
  const now = new Date();
  const cur = now.getUTCHours() * 60 + now.getUTCMinutes();
  const [sh, sm] = String(prefs.dndStart).split(':').map(Number);
  const [eh, em] = String(prefs.dndEnd).split(':').map(Number);
  const s = sh * 60 + sm;
  const e = eh * 60 + em;
  return s <= e ? (cur >= s && cur < e) : (cur >= s || cur < e);
}

const BASE_URL = (process.env.PUBLIC_BASE_URL || 'https://fivocrm.vercel.app').replace(/\/$/, '');

/**
 * POST /api/send-notification-email  (dispatched via /api/email?type=notification)
 * Body: { userId, type?, title, message?, actionUrl?, actionLabel? }
 * Header: Authorization: Bearer <Firebase ID token>
 *
 * Emails the recipient about an in-app notification, honoring their
 * userPreferences (emailEnabled, category mute, Do-Not-Disturb). Best-effort:
 * called fire-and-forget from useMutation when a `notifications` doc is created.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Missing authorization header' });
  let caller;
  try {
    caller = await adminAuth.verifyIdToken(authHeader.split('Bearer ')[1]);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  if (!checkRateLimit(caller.uid)) return res.status(429).json({ error: 'Rate limited' });

  const { userId, type, title, message, actionUrl, actionLabel } = req.body || {};
  if (!userId || !title) return res.status(400).json({ error: 'Missing userId or title' });

  // Don't email someone about their own action.
  if (userId === caller.uid) return res.status(200).json({ skipped: 'self' });

  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  if (!smtpUser || !smtpPass) return res.status(200).json({ skipped: 'smtp-not-configured' });

  // Resolve the recipient's email + preferences.
  let email: string | undefined;
  try {
    const rec = await adminAuth.getUser(String(userId));
    email = rec.email || undefined;
  } catch {
    // userId might be stored as an email (legacy records)
    if (typeof userId === 'string' && userId.includes('@')) email = userId;
  }
  if (!email || !isValidEmail(email)) return res.status(200).json({ skipped: 'no-email' });

  // Preference checks: channel toggle, category mute, Do-Not-Disturb.
  try {
    const prefSnap = await adminDb.collection('userPreferences').doc(String(userId)).get();
    const prefs = prefSnap.exists ? (prefSnap.data() as any) : {};
    if (prefs?.emailEnabled === false) return res.status(200).json({ skipped: 'email-disabled' });
    if (isDndActive(prefs)) return res.status(200).json({ skipped: 'dnd' });
    const cat = categoryOf(type);
    if (cat && prefs?.categoryEnabled && prefs.categoryEnabled[cat] === false) {
      return res.status(200).json({ skipped: 'category-muted' });
    }
  } catch { /* on pref read failure, default to sending */ }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'mail.fivoo.net',
    port: Number(process.env.SMTP_PORT) || 465,
    secure: true,
    auth: { user: smtpUser, pass: smtpPass },
  });

  const safeTitle = escapeHtml(title);
  const safeMessage = message ? escapeHtml(message) : '';
  const link = actionUrl ? `${BASE_URL}${String(actionUrl).startsWith('/') ? '' : '/'}${actionUrl}` : BASE_URL;
  const safeLink = encodeURI(link);
  const safeBtn = escapeHtml(actionLabel || 'Hap në FivoCRM');

  try {
    await transporter.sendMail({
      from: `"FivoCRM" <${smtpUser}>`,
      to: email,
      subject: title.replace(/[\n\r]/g, '').slice(0, 180),
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; background: #f9fafb; border-radius: 8px;">
          <div style="background: #2563eb; padding: 18px 24px; border-radius: 6px 6px 0 0;">
            <h2 style="color: white; margin: 0; font-size: 18px;">🔔 ${safeTitle}</h2>
          </div>
          <div style="background: white; padding: 24px; border-radius: 0 0 6px 6px; border: 1px solid #e5e7eb;">
            ${safeMessage ? `<p style="color: #374151; margin-top: 0; font-size: 15px; line-height: 1.5;">${safeMessage}</p>` : ''}
            <div style="text-align: center; margin: 24px 0 8px;">
              <a href="${safeLink}" style="display: inline-block; padding: 12px 28px; background-color: #2563eb; color: white; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 15px;">
                ${safeBtn}
              </a>
            </div>
            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
            <p style="color: #9ca3af; font-size: 12px; margin: 0;">
              Po e merrni këtë sepse keni aktivizuar njoftimet me email. Mund t'i çaktivizoni te Cilësimet → Njoftimet.
            </p>
          </div>
          <p style="color: #9ca3af; font-size: 11px; text-align: center; margin-top: 16px;">FivoCRM — Njoftime</p>
        </div>
      `,
    });
    return res.status(200).json({ success: true });
  } catch (err: any) {
    console.error('[notify-email] send failed:', err?.message || err);
    return res.status(500).json({ error: 'send-failed' });
  }
}
