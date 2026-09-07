import { safeSenderAddress, senderHeader } from './_emailIdentity.js';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import nodemailer from 'nodemailer';
import admin, { adminDb as db } from './_firebaseAdmin.js';

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && !email.includes('\n') && !email.includes('\r');
}

function buildReminderEmail(leadName: string, message: string, senderName: string): string {
  const safeMessage = message.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
  return `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
    <body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,sans-serif;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 0;">
        <tr><td align="center">
          <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.1);">
            <tr>
              <td style="background:#1a1a2e;padding:24px 32px;">
                <p style="margin:0;color:#ffffff;font-size:20px;font-weight:700;">FivoCRM</p>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                <p style="margin:0 0 16px;font-size:16px;color:#374151;">Përshëndetje <strong>${leadName.split(' ')[0]}</strong>,</p>
                <p style="margin:0 0 24px;font-size:15px;color:#4b5563;line-height:1.6;">${safeMessage}</p>
                <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
                <p style="margin:0;font-size:13px;color:#9ca3af;">Me respekt,<br><strong style="color:#374151;">${senderName}</strong></p>
              </td>
            </tr>
            <tr>
              <td style="background:#f9fafb;padding:16px 32px;border-top:1px solid #e5e7eb;">
                <p style="margin:0;font-size:11px;color:#9ca3af;text-align:center;">FivoCRM · Platforma e Menaxhimit të Biznesit</p>
              </td>
            </tr>
          </table>
        </td></tr>
      </table>
    </body>
    </html>
  `;
}

/**
 * POST /api/send-lead-reminder-email
 * Body: { leadId: string, message: string, subject?: string }
 * Header: Authorization: Bearer <Firebase ID token>
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });

  let decoded: admin.auth.DecodedIdToken;
  try {
    decoded = await admin.auth().verifyIdToken(authHeader.slice(7));
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }

  const { leadId, message, subject } = req.body;
  if (!leadId || typeof leadId !== 'string') return res.status(400).json({ error: 'Missing leadId' });
  if (!message || typeof message !== 'string' || !message.trim()) return res.status(400).json({ error: 'Missing message' });

  const smtpUser = safeSenderAddress(process.env.SMTP_USER);
  if (!smtpUser || !process.env.SMTP_PASS) return res.status(500).json({ error: 'SMTP not configured' });

  const leadDoc = await db.collection('leads').doc(leadId).get();
  if (!leadDoc.exists) return res.status(404).json({ error: 'Lead not found' });
  const lead = leadDoc.data()!;

  if (!lead.email || !isValidEmail(lead.email)) return res.status(422).json({ error: 'Lead has no valid email' });

  // Verify the caller is staff of the lead's team (or, for legacy null-teamId leads,
  // its business). Fail closed: a lead scoped to neither cannot be authorized and is
  // rejected — this closes the "auth-skip when teamId is missing" bypass.
  if (!lead.teamId && !lead.businessId) {
    return res.status(403).json({ error: 'Lead is not scoped to a team or business' });
  }
  {
    const [teamSnap, bizSnap] = await Promise.all([
      lead.teamId
        ? db.collection('teamMembers').where('teamId', '==', lead.teamId).where('userId', '==', decoded.uid).limit(1).get()
        : Promise.resolve({ empty: true } as any),
      lead.businessId
        ? db.collection('teamMembers').where('businessId', '==', lead.businessId).where('userId', '==', decoded.uid).limit(1).get()
        : Promise.resolve({ empty: true } as any),
    ]);
    if (teamSnap.empty && bizSnap.empty) return res.status(403).json({ error: 'Forbidden' });
  }

  // Resolve sender display name
  let senderName = 'Ekipi FivoCRM';
  try {
    const userRecord = await admin.auth().getUser(decoded.uid);
    if (userRecord.displayName) senderName = userRecord.displayName;
  } catch { /* best-effort */ }

  const emailSubject = subject?.trim() || `Mesazh nga ${senderName}`;
  const html = buildReminderEmail(lead.name || 'Klient', message.trim(), senderName);

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'mail.fivoo.net',
    port: Number(process.env.SMTP_PORT) || 465,
    secure: true,
    auth: { user: smtpUser, pass: process.env.SMTP_PASS },
  });

  await transporter.sendMail({
    from: senderHeader(`${senderName} via FivoCRM`, smtpUser),
    to: lead.email,
    subject: emailSubject,
    html,
  });

  // Update lastFollowUpDate on the lead
  await leadDoc.ref.update({
    lastFollowUpDate: admin.firestore.Timestamp.now(),
    updatedAt: admin.firestore.Timestamp.now(),
  });

  return res.status(200).json({ success: true });
}
