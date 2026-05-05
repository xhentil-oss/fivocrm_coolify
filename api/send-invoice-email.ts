import type { VercelRequest, VercelResponse } from '@vercel/node';
import nodemailer from 'nodemailer';
import { buildInvoiceEmail } from './_invoiceEmail.js';
import admin, { adminDb as db } from './_firebaseAdmin.js';

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && !email.includes('\n') && !email.includes('\r');
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
    const { recipientEmail, recipientName, channelId, senderName, messagePreview } = req.body;
    if (!recipientEmail || typeof recipientEmail !== 'string' || !channelId) {
      return res.status(400).json({ error: 'Missing recipientEmail or channelId' });
    }
    if (!isValidEmail(recipientEmail)) {
      return res.status(400).json({ error: 'Invalid email' });
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
    const name = recipientName || recipientEmail.split('@')[0];
    const from = senderName || 'Ekipi';
    const preview = messagePreview ? String(messagePreview).slice(0, 200) : 'Keni një mesazh të ri.';
    try {
      await transporter.sendMail({
        from: `"FivoCRM" <${smtpUser}>`,
        to: recipientEmail,
        subject: `Mesazh i ri nga ${from}`,
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

  // Verify the caller belongs to the same team as the invoice
  if (invoice.teamId) {
    const memberSnap = await db.collection('teamMembers')
      .where('teamId', '==', invoice.teamId)
      .where('userId', '==', decodedToken.uid)
      .limit(1)
      .get();
    if (memberSnap.empty) {
      return res.status(403).json({ error: 'Forbidden' });
    }
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
