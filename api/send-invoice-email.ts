import type { VercelRequest, VercelResponse } from '@vercel/node';
import nodemailer from 'nodemailer';
import { buildInvoiceEmail } from './_invoiceEmail.js';
import admin, { adminDb as db } from './_firebaseAdmin.js';

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && !email.includes('\n') && !email.includes('\r');
}

/**
 * POST /api/send-invoice-email
 * Body: { invoiceId: string }
 * Header: Authorization: Bearer <Firebase ID token>
 *
 * Sends the initial invoice email to the customer and marks the invoice as
 * emailSent: true, status: 'Pending'.
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
  try {
    await admin.auth().verifyIdToken(authHeader.slice(7));
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }

  const { invoiceId, type: requestType } = req.body;
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

  // Mark invoice as sent + set Pending
  await invoiceDoc.ref.update({
    emailSent: true,
    status: 'Pending',
    updatedAt: admin.firestore.Timestamp.now(),
  });

  return res.status(200).json({ success: true });
}
