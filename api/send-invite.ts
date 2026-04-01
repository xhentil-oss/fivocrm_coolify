import type { VercelRequest, VercelResponse } from '@vercel/node';
import nodemailer from 'nodemailer';
import { adminAuth } from './_firebaseAdmin';

// Simple in-memory rate limiter (persists across warm Vercel invocations)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
function checkRateLimit(uid: string, maxPerHour = 20): boolean {
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

  // Rate limit: max 20 invites per hour per user
  if (!checkRateLimit(decodedToken.uid)) {
    return res.status(429).json({ error: 'Too many invitations. Please try again later.' });
  }

  const { to, teamName, inviteLink, senderName, directAdd } = req.body;

  if (!to || !teamName || !inviteLink) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Validate email format (prevents header injection)
  if (!isValidEmail(to)) {
    return res.status(400).json({ error: 'Invalid email address' });
  }

  // Validate inviteLink is a safe URL from an allowed domain
  try {
    const parsed = new URL(inviteLink);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return res.status(400).json({ error: 'Invalid invite link' });
    }
    const allowedHosts = (process.env.ALLOWED_HOSTS || 'fivoo.net,localhost').split(',').map(h => h.trim());
    if (!allowedHosts.some(h => parsed.hostname === h || parsed.hostname.endsWith('.' + h))) {
      return res.status(400).json({ error: 'Invalid invite link domain' });
    }
  } catch {
    return res.status(400).json({ error: 'Invalid invite link' });
  }

  // SMTP credentials must come from environment variables
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  if (!smtpUser || !smtpPass) {
    return res.status(500).json({ error: 'SMTP not configured' });
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'mail.fivoo.net',
    port: Number(process.env.SMTP_PORT) || 465,
    secure: true,
    auth: {
      user: smtpUser,
      pass: smtpPass,
    },
  });

  try {
    await transporter.sendMail({
      from: `"${escapeHtml((senderName || 'FivoCRM').replace(/["\n\r]/g, ''))}" <${smtpUser}>`,
      to,
      subject: directAdd
        ? `U shtove në ekipin "${String(teamName).replace(/["\n\r]/g, '')}"`
        : `Ftesë për tu bashkuar me ekipin "${String(teamName).replace(/["\n\r]/g, '')}"`,
      html: directAdd ? `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333;">U shtove në ekip!</h2>
          <p>Administratori <strong>${escapeHtml(String(senderName || 'FivoCRM'))}</strong> të shtoi direkt në ekipin <strong>${escapeHtml(String(teamName))}</strong> në FivoCRM.</p>
          <a href="${encodeURI(inviteLink)}"
             style="display: inline-block; padding: 12px 24px; background-color: #3b82f6; color: white; text-decoration: none; border-radius: 6px; margin: 20px 0;">
            Hyr në FivoCRM
          </a>
          <p style="color: #666; font-size: 14px;">Ose kopjo këtë link: ${escapeHtml(inviteLink)}</p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
          <p style="color: #999; font-size: 12px;">Nëse nuk e pret këtë email, kontakto administratorin.</p>
        </div>
      ` : `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333;">Ke marrë një ftesë!</h2>
          <p>Je ftuar të bashkohesh me ekipin <strong>${escapeHtml(String(teamName))}</strong> në FivoCRM.</p>
          <a href="${encodeURI(inviteLink)}" 
             style="display: inline-block; padding: 12px 24px; background-color: #3b82f6; color: white; text-decoration: none; border-radius: 6px; margin: 20px 0;">
            Prano Ftesën
          </a>
          <p style="color: #666; font-size: 14px;">Ose kopjo këtë link: ${escapeHtml(inviteLink)}</p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
          <p style="color: #999; font-size: 12px;">Nëse nuk e ke kërkuar këtë ftesë, injoroje këtë email.</p>
        </div>
      `,
    });

    return res.status(200).json({ success: true, message: 'Email sent successfully' });
  } catch (error: any) {
    console.error('Email error:', error);
    return res.status(500).json({ error: 'Failed to send email', details: error.message });
  }
}
