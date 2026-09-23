import { safeSenderAddress, safeSenderName } from './_emailIdentity.js';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import nodemailer from 'nodemailer';
import { adminDb as db } from './_firebaseAdmin.js';
import { checkPersistentRateLimit } from './_rateLimit.js';
import { authenticate, isPortalOnlyToken, resolveStaffTenant, isPlatformUrl } from './_callerIdentity.js';

const WELCOME_PER_HOUR = 30;

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254 && !email.includes('\n') && !email.includes('\r');
}

/**
 * POST /api/send-welcome-email
 * Body: { customerName: string, customerEmail: string, portalUrl: string, teamName?: string, customerId?: string }
 * Header: Authorization: Bearer <Firebase ID token>
 *
 * Sends a welcome email to a newly created customer with a portal login button.
 *
 * Audit Sep 2026: any signed-in account could mail any address a "welcome" with an
 * arbitrary `*.vercel.app` link — an open phishing relay from the platform's own
 * sender. Now the caller must be STAFF (claims / active membership), the customer
 * is looked up INSIDE the caller's business (by `customerId`, or by the given
 * email), and the recipient is `customers/{id}.email` — never the body's address.
 * The portal link must point at a platform host.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const c = await authenticate(req);
  if (!c) return res.status(401).json({ error: 'Invalid or expired token' });
  if (isPortalOnlyToken(c)) return res.status(403).json({ error: 'Forbidden' });
  const tenant = await resolveStaffTenant(c);
  if (!tenant || !tenant.bid) return res.status(403).json({ error: 'Forbidden' });

  if (!(await checkPersistentRateLimit('welcomeEmail', c.uid, WELCOME_PER_HOUR))) {
    return res.status(429).json({ error: 'Too many emails. Please try again later.' });
  }

  const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
  const customerName = typeof body.customerName === 'string' ? body.customerName.trim().slice(0, 120) : '';
  const customerEmail = typeof body.customerEmail === 'string' ? body.customerEmail.trim() : '';
  const portalUrl = typeof body.portalUrl === 'string' ? body.portalUrl.trim() : '';
  const teamName = typeof body.teamName === 'string' ? body.teamName.trim().slice(0, 120) : '';
  const customerId = typeof body.customerId === 'string' ? body.customerId.trim() : '';

  if (!customerName || !customerEmail || !portalUrl) {
    return res.status(400).json({ error: 'Missing required fields: customerName, customerEmail, portalUrl' });
  }
  if (!isValidEmail(customerEmail)) {
    return res.status(400).json({ error: 'Invalid email address' });
  }
  if (portalUrl.length > 2000 || !isPlatformUrl(portalUrl)) {
    return res.status(400).json({ error: 'Invalid portal URL' });
  }

  // ── The customer must exist in the caller's business; the recipient is ITS email ──
  let customer: Record<string, any> | null = null;
  try {
    if (customerId) {
      const snap = await db.collection('customers').doc(customerId).get();
      const d = snap.exists ? (snap.data() as any) : null;
      if (d && d.businessId === tenant.bid) customer = d;
    } else {
      const lower = customerEmail.toLowerCase();
      const col = db.collection('customers').where('businessId', '==', tenant.bid);
      const [a, b] = await Promise.all([
        col.where('email', '==', lower).limit(1).get(),
        lower !== customerEmail ? col.where('email', '==', customerEmail).limit(1).get() : Promise.resolve(null),
      ]);
      const doc = a.docs[0] || b?.docs[0];
      if (doc) customer = doc.data() as any;
    }
  } catch (err: any) {
    console.error('[send-welcome-email] customer lookup failed:', err?.message || err);
    return res.status(503).json({ error: 'Customer lookup failed' });
  }
  if (!customer) return res.status(404).json({ error: 'Klienti nuk u gjet në biznesin tuaj' });

  const recipient = typeof customer.email === 'string' ? customer.email.trim() : '';
  if (!recipient || !isValidEmail(recipient)) {
    return res.status(422).json({ error: 'Klienti nuk ka një email të vlefshëm' });
  }

  const smtpUser = safeSenderAddress(process.env.SMTP_USER);
  const smtpPass = process.env.SMTP_PASS;
  if (!smtpUser || !smtpPass) {
    return res.status(503).json({ error: 'SMTP not configured' });
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'mail.fivoo.net',
    port: Number(process.env.SMTP_PORT) || 465,
    secure: true,
    auth: { user: smtpUser, pass: smtpPass },
  });

  const safeName = escapeHtml(String(customer.name || customerName));
  const safeTeam = escapeHtml(String(teamName || 'FivoCRM'));
  const safePortalUrl = encodeURI(portalUrl);
  // Header-safe display name (NOT HTML-escaped — entities like &#x27; trip
  // Gmail's "abnormal characters" warning). Object form lets nodemailer
  // RFC-2047-encode non-ASCII names.
  const fromName = safeSenderName(teamName);

  try {
    await transporter.sendMail({
      from: { name: fromName, address: smtpUser },
      to: recipient,
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
              Për tu identifikuar, përdorni email-in tuaj (<strong>${escapeHtml(recipient)}</strong>) me Google Sign-In.
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
    console.error('[send-welcome-email] SMTP send failed:', err?.message || err);
    return res.status(502).json({ error: 'Failed to send email' });
  }
}
