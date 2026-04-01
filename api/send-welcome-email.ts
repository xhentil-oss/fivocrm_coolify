import type { VercelRequest, VercelResponse } from '@vercel/node';
import nodemailer from 'nodemailer';
import { adminAuth } from './_firebaseAdmin';

// Simple in-memory rate limiter
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
function checkRateLimit(uid: string, maxPerHour = 30): boolean {
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
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && !email.includes('\n') && !email.includes('\r');
}

/**
 * POST /api/send-welcome-email
 * Body: { customerName: string, customerEmail: string, portalUrl: string, teamName?: string }
 * Header: Authorization: Bearer <Firebase ID token>
 *
 * Sends a welcome email to a newly created customer with a portal login button.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify Firebase Auth token
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization header' });
  }
  let decodedToken;
  try {
    decodedToken = await adminAuth.verifyIdToken(authHeader.split('Bearer ')[1]);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  if (!checkRateLimit(decodedToken.uid)) {
    return res.status(429).json({ error: 'Too many emails. Please try again later.' });
  }

  const { customerName, customerEmail, portalUrl, teamName } = req.body;

  if (!customerName || !customerEmail || !portalUrl) {
    return res.status(400).json({ error: 'Missing required fields: customerName, customerEmail, portalUrl' });
  }

  if (!isValidEmail(customerEmail)) {
    return res.status(400).json({ error: 'Invalid email address' });
  }

  // Validate portalUrl domain
  try {
    const parsed = new URL(portalUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return res.status(400).json({ error: 'Invalid portal URL' });
    }
    const allowedHosts = (process.env.ALLOWED_HOSTS || 'fivocrm.vercel.app,fivoo.net,localhost,vercel.app').split(',').map(h => h.trim());
    if (!allowedHosts.some(h => parsed.hostname === h || parsed.hostname.endsWith('.' + h))) {
      return res.status(400).json({ error: `Invalid portal URL domain: ${parsed.hostname}` });
    }
  } catch {
    return res.status(400).json({ error: 'Invalid portal URL' });
  }

  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  if (!smtpUser || !smtpPass) {
    return res.status(500).json({ error: 'SMTP not configured' });
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'mail.fivoo.net',
    port: Number(process.env.SMTP_PORT) || 465,
    secure: true,
    auth: { user: smtpUser, pass: smtpPass },
  });

  const safeName = escapeHtml(String(customerName));
  const safeTeam = escapeHtml(String(teamName || 'FivoCRM'));
  const safePortalUrl = encodeURI(portalUrl);

  try {
    await transporter.sendMail({
      from: `"${safeTeam}" <${smtpUser}>`,
      to: customerEmail,
      subject: `Mirë se vini në ${String(teamName || 'FivoCRM').replace(/["\n\r]/g, '')}!`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; background: #f9fafb; border-radius: 8px;">
          <div style="background: #10b981; padding: 20px 24px; border-radius: 6px 6px 0 0;">
            <h2 style="color: white; margin: 0; font-size: 20px;">🎉 Mirë se vini!</h2>
          </div>
          <div style="background: white; padding: 24px; border-radius: 0 0 6px 6px; border: 1px solid #e5e7eb;">
            <p style="color: #374151; margin-top: 0;">I/E dashur <strong>${safeName}</strong>,</p>
            <p style="color: #374151;">
              Jeni regjistruar si klient tek <strong>${safeTeam}</strong>. Tani keni akses në portalin tuaj personal ku mund të:
            </p>
            <ul style="color: #374151; padding-left: 20px;">
              <li>Shikoni faturat dhe statusin e pagesave</li>
              <li>Ndiqni progresin e projekteve</li>
              <li>Komunikoni direkt me ekipin tonë</li>
              <li>Dërgoni kërkesa dhe feedback</li>
            </ul>
            <div style="text-align: center; margin: 28px 0;">
              <a href="${safePortalUrl}"
                 style="display: inline-block; padding: 14px 32px; background-color: #10b981; color: white; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px;">
                Hyr në Portal
              </a>
            </div>
            <p style="color: #6b7280; font-size: 14px;">
              Ose kopjoni këtë link: <a href="${safePortalUrl}" style="color: #3b82f6;">${escapeHtml(portalUrl)}</a>
            </p>
            <p style="color: #6b7280; font-size: 14px;">
              Për tu identifikuar, përdorni email-in tuaj (<strong>${escapeHtml(customerEmail)}</strong>) me Google Sign-In.
            </p>
            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
            <p style="color: #9ca3af; font-size: 12px; margin: 0;">
              Nëse nuk e prisni këtë email ose keni pyetje, na kontaktoni.
            </p>
          </div>
          <p style="color: #9ca3af; font-size: 11px; text-align: center; margin-top: 16px;">
            ${safeTeam} — Powered by FivoCRM
          </p>
        </div>
      `,
    });

    return res.status(200).json({ success: true });
  } catch (err: any) {
    console.error('Failed to send welcome email:', err);
    return res.status(500).json({ error: 'Failed to send email' });
  }
}
