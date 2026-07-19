import type { VercelRequest, VercelResponse } from '@vercel/node';
import nodemailer from 'nodemailer';
import { buildInvoiceEmail } from './_invoiceEmail.js';
import admin, { adminDb as db } from './_firebaseAdmin.js';

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && !email.includes('\n') && !email.includes('\r');
}

function escapeHtml(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

// Fail-closed staff authorization: the caller must be a member of the doc's team
// OR (for recurring/legacy docs with a null teamId) its business. A doc carrying
// NEITHER key cannot be authorized and is denied — never skipped. This closes the
// "auth-skip when teamId is missing" bypass (recurring-invoice children set teamId
// to null but still carry businessId).
async function callerIsStaff(
  uid: string,
  teamId: string | undefined | null,
  businessId: string | undefined | null,
): Promise<boolean> {
  if (teamId) {
    const s = await db.collection('teamMembers')
      .where('teamId', '==', teamId).where('userId', '==', uid).limit(1).get();
    if (!s.empty) return true;
  }
  if (businessId) {
    const s = await db.collection('teamMembers')
      .where('businessId', '==', businessId).where('userId', '==', uid).limit(1).get();
    if (!s.empty) return true;
  }
  return false;
}

// In-memory rate limit for client chat notifications: 1 email per (email+channelId) per 10 min
const notifyRateLimit = new Map<string, number>();
const NOTIFY_RATE_MS = 10 * 60 * 1000;

/**
 * POST /api/send-invoice-email
 *
 * Two actions depending on `type` in the request body:
 *
 * type == 'notify-client'  →  Send a chat notification email to a portal client.
 *   Body: { type, recipientEmail, recipientName?, channelId, senderName?, messagePreview? }
 *
 * type == anything else    →  Send an invoice email (original behaviour).
 *   Body: { invoiceId, type? }
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify Firebase auth token
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  let decodedToken: admin.auth.DecodedIdToken;
  try {
    decodedToken = await admin.auth().verifyIdToken(authHeader.slice(7));
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }

  const { invoiceId, type: requestType } = req.body;

  // ── Client chat notification ──────────────────────────────────────────────
  if (requestType === 'notify-client') {
    const { channelId, senderName, messagePreview } = req.body;
    // channelId is `client-<customerId>` (optionally `-project-<pid>`). The
    // recipient and authorization are BOTH derived from it — the client-supplied
    // recipientEmail is ignored, so this can no longer be used as an open relay to
    // an arbitrary address.
    if (!channelId || typeof channelId !== 'string' || !channelId.startsWith('client-')) {
      return res.status(400).json({ error: 'Invalid channelId' });
    }
    const customerId = channelId.split('-')[1];
    if (!customerId) {
      return res.status(400).json({ error: 'Invalid channelId' });
    }

    // Resolve the customer this channel belongs to.
    const customerDoc = await db.collection('customers').doc(customerId).get();
    if (!customerDoc.exists) {
      return res.status(404).json({ error: 'Customer not found' });
    }
    const customer = customerDoc.data()!;

    // Authorize: the caller must be a staff member of the customer's team/business.
    // (Only staff notify a client of a new message; a portal client never calls this.)
    const authorized = await callerIsStaff(decodedToken.uid, customer.teamId, customer.businessId);
    if (!authorized) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // Recipient is the customer's own address — never an attacker-chosen one.
    let recipientEmail: string | undefined = typeof customer.email === 'string' ? customer.email : undefined;
    if (!recipientEmail || !isValidEmail(recipientEmail)) {
      // Fall back to the portal-access record's login email.
      const paSnap = await db.collection('clientPortalAccess')
        .where('customerId', '==', customerId).limit(1).get();
      const paEmail = paSnap.empty ? undefined : (paSnap.docs[0].data() as any).email;
      recipientEmail = typeof paEmail === 'string' ? paEmail : undefined;
    }
    if (!recipientEmail || !isValidEmail(recipientEmail)) {
      return res.status(422).json({ error: 'Customer has no valid email' });
    }

    // Rate limit — silently skip
    const key = `${recipientEmail}:${channelId}`;
    const lastSent = notifyRateLimit.get(key) || 0;
    if (Date.now() - lastSent < NOTIFY_RATE_MS) {
      return res.status(200).json({ ok: true, skipped: true });
    }
    notifyRateLimit.set(key, Date.now());

    const smtpUser = process.env.SMTP_USER;
    if (!smtpUser || !process.env.SMTP_PASS) {
      return res.status(500).json({ error: 'SMTP not configured' });
    }
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'mail.fivoo.net',
      port: Number(process.env.SMTP_PORT) || 465,
      secure: true,
      auth: { user: smtpUser, pass: process.env.SMTP_PASS },
    });
    const appUrl = process.env.VITE_APP_URL || 'https://app.fivoo.net';
    // All interpolated values are HTML-escaped to prevent injection into the email body.
    const name = escapeHtml(customer.name || recipientEmail.split('@')[0]);
    const from = escapeHtml(senderName ? String(senderName).slice(0, 80) : 'Ekipi');
    const preview = escapeHtml(messagePreview ? String(messagePreview).slice(0, 200) : 'Keni një mesazh të ri.');
    try {
      await transporter.sendMail({
        from: `"FivoCRM" <${smtpUser}>`,
        to: recipientEmail,
        subject: `Mesazh i ri nga ${from}`.replace(/[\n\r]/g, '').slice(0, 180),
        html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;background:#f9fafb;border-radius:8px;"><h2 style="color:#2563eb;margin-top:0;">Mesazh i ri</h2><p style="color:#374151;">Përshëndetje, <strong>${name}</strong>!</p><p style="color:#374151;"><strong>${from}</strong> ju ka dërguar një mesazh:</p><blockquote style="border-left:3px solid #2563eb;padding:10px 14px;background:#eff6ff;border-radius:4px;margin:16px 0;color:#1e40af;font-style:italic;">${preview}</blockquote><a href="${appUrl}/portal/chat" style="display:inline-block;background:#2563eb;color:#fff;padding:11px 24px;border-radius:6px;text-decoration:none;font-weight:bold;margin-top:8px;">Hap portalin</a><p style="color:#9ca3af;font-size:11px;margin-top:28px;border-top:1px solid #e5e7eb;padding-top:12px;">FivoCRM &mdash; Platforma juaj e biznesit</p></div>`,
      });
      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error('[notify-client] email error:', err);
      return res.status(500).json({ error: 'Failed to send email' });
    }
  }
  // ─────────────────────────────────────────────────────────────────────────
  if (!invoiceId || typeof invoiceId !== 'string') {
    return res.status(400).json({ error: 'Missing invoiceId' });
  }

  const smtpUser = process.env.SMTP_USER;
  if (!smtpUser || !process.env.SMTP_PASS) {
    return res.status(500).json({ error: 'SMTP not configured' });
  }

  // Fetch invoice
  const invoiceDoc = await db.collection('invoices').doc(invoiceId).get();
  if (!invoiceDoc.exists) {
    return res.status(404).json({ error: 'Invoice not found' });
  }
  const invoice = invoiceDoc.data()!;

  // Verify the caller is staff of the invoice's team (or, for recurring/legacy
  // null-teamId invoices, its business). Fail closed: an invoice with neither key
  // cannot be authorized and is rejected rather than silently skipping the check.
  if (!invoice.teamId && !invoice.businessId) {
    return res.status(403).json({ error: 'Invoice is not scoped to a team or business' });
  }
  if (!(await callerIsStaff(decodedToken.uid, invoice.teamId, invoice.businessId))) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  // Fetch customer
  if (!invoice.customerId) {
    return res.status(422).json({ error: 'Invoice has no customerId — cannot send email' });
  }
  const customerDoc = await db.collection('customers').doc(invoice.customerId).get();
  const customer = customerDoc.data();
  if (!customer?.email || !isValidEmail(customer.email)) {
    return res.status(422).json({ error: 'Customer has no valid email address' });
  }

  // Fetch project name for the email body
  let projectName = 'Shërbim';
  if (invoice.projectId) {
    const projDoc = await db.collection('projects').doc(invoice.projectId).get();
    if (projDoc.exists) projectName = projDoc.data()?.name || projectName;
  }

  const dueDate: Date = invoice.dueDate?.toDate
    ? invoice.dueDate.toDate()
    : invoice.dueDate ? new Date(invoice.dueDate) : new Date();

  const { subject, html } = buildInvoiceEmail({
    customerName: customer.name || 'Klient',
    invoiceNumber: invoice.invoiceNumber || invoiceId.slice(0, 8).toUpperCase(),
    amount: invoice.total || invoice.amount || 0,
    dueDate,
    projectName,
    type: requestType === 'reminder' ? 'reminder1' : 'initial',
    currency: invoice.currency || 'ALL',
    paymentMethod: invoice.paymentMethod,
    bankName: invoice.bankName,
    bankIBAN: invoice.bankIBAN,
    bankSWIFT: invoice.bankSWIFT,
    bankAccountHolder: invoice.bankAccountHolder,
    bankCountry: invoice.bankCountry,
  });

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'mail.fivoo.net',
    port: Number(process.env.SMTP_PORT) || 465,
    secure: true,
    auth: { user: smtpUser, pass: process.env.SMTP_PASS },
  });

  await transporter.sendMail({
    from: `"FivoCRM" <${smtpUser}>`,
    to: customer.email,
    subject,
    html,
  });

  // Mark invoice as sent. Only upgrade Draft→Pending; never downgrade Paid/Partial/Overdue.
  const currentStatus = invoice.status;
  const shouldSetPending = !requestType || requestType !== 'reminder';
  const newStatus = shouldSetPending && currentStatus === 'Draft' ? 'Pending' : currentStatus;
  await invoiceDoc.ref.update({
    emailSent: true,
    status: newStatus,
    updatedAt: admin.firestore.Timestamp.now(),
  });

  return res.status(200).json({ success: true });
}
