import type { VercelRequest, VercelResponse } from '@vercel/node';
import nodemailer from 'nodemailer';
import admin from './_firebaseAdmin.js';

// In-memory rate limit: 1 email per (email + channelId) per 10 minutes
const rateLimitMap = new Map<string, number>();
const RATE_LIMIT_MS = 10 * 60 * 1000;

/**
 * POST /api/notify-client
 * Sends an email notification to a portal client when the team sends a message.
 * Auth required (staff-side call).
 * Body: { recipientEmail, recipientName?, channelId, senderName?, messagePreview? }
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  try {
    await admin.auth().verifyIdToken(authHeader.slice(7));
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }

  const { recipientEmail, recipientName, channelId, senderName, messagePreview } = req.body || {};
  if (!recipientEmail || typeof recipientEmail !== 'string' || !channelId) {
    return res.status(400).json({ error: 'Missing recipientEmail or channelId' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) {
    return res.status(400).json({ error: 'Invalid email' });
  }

  // Rate limit check — silently skip, not an error
  const key = `${recipientEmail}:${channelId}`;
  const lastSent = rateLimitMap.get(key) || 0;
  if (Date.now() - lastSent < RATE_LIMIT_MS) {
    return res.status(200).json({ ok: true, skipped: true });
  }
  rateLimitMap.set(key, Date.now());

  const smtpUser = process.env.SMTP_USER;
  if (!smtpUser || !process.env.SMTP_PASS) {
    return res.status(500).json({ error: 'SMTP not configured' });
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: false,
    auth: { user: smtpUser, pass: process.env.SMTP_PASS },
  });

  const appUrl = process.env.VITE_APP_URL || 'https://app.fivoo.net';
  const portalUrl = `${appUrl}/portal/chat`;
  const name = recipientName || recipientEmail.split('@')[0];
  const from = senderName || 'Ekipi';
  const preview = messagePreview ? messagePreview.slice(0, 200) : 'Keni një mesazh të ri.';

  try {
    await transporter.sendMail({
      from: `"FivoCRM" <${smtpUser}>`,
      to: recipientEmail,
      subject: `Mesazh i ri nga ${from}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;background:#f9fafb;border-radius:8px;">
          <h2 style="color:#2563eb;margin-top:0;">Mesazh i ri</h2>
          <p style="color:#374151;">Përshëndetje, <strong>${name}</strong>!</p>
          <p style="color:#374151;"><strong>${from}</strong> ju ka dërguar një mesazh:</p>
          <blockquote style="border-left:3px solid #2563eb;padding:10px 14px;background:#eff6ff;border-radius:4px;margin:16px 0;color:#1e40af;font-style:italic;">
            ${preview}
          </blockquote>
          <a href="${portalUrl}" style="display:inline-block;background:#2563eb;color:#fff;padding:11px 24px;border-radius:6px;text-decoration:none;font-weight:bold;margin-top:8px;">
            Hap portalin
          </a>
          <p style="color:#9ca3af;font-size:11px;margin-top:28px;border-top:1px solid #e5e7eb;padding-top:12px;">
            FivoCRM &mdash; Platforma juaj e biznesit
          </p>
        </div>
      `,
    });
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[notify-client] email error:', err);
    return res.status(500).json({ error: 'Failed to send email' });
  }
}
