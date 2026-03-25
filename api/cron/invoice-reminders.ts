import type { VercelRequest, VercelResponse } from '@vercel/node';
import * as admin from 'firebase-admin';
import nodemailer from 'nodemailer';

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  });
}

const db = admin.firestore();

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

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

  const now = new Date();

  // Send reminders for invoices due within 3 days
  const reminderThreshold = new Date(now);
  reminderThreshold.setDate(reminderThreshold.getDate() + 3);
  reminderThreshold.setHours(23, 59, 59, 999);

  // Fetch all pending invoices
  const invoicesSnap = await db.collection('invoices')
    .where('status', '==', 'Pending')
    .get();

  let overdueMarked = 0;
  let remindersSent = 0;
  const ops: Promise<any>[] = [];

  for (const doc of invoicesSnap.docs) {
    const invoice = doc.data();
    if (!invoice.dueDate) continue;

    const dueDate: Date = invoice.dueDate.toDate
      ? invoice.dueDate.toDate()
      : new Date(invoice.dueDate);

    const invoiceLabel = invoice.invoiceNumber || doc.id.slice(0, 8).toUpperCase();

    if (dueDate < now) {
      // ---- Mark as Overdue ----
      ops.push(
        doc.ref.update({
          status: 'Overdue',
          updatedAt: admin.firestore.Timestamp.now(),
        })
      );
      overdueMarked++;

      // Notify the invoice owner in-app
      if (invoice.createdByUserId) {
        ops.push(
          db.collection('notifications').add({
            userId: invoice.createdByUserId,
            type: 'invoice_overdue',
            title: `🔴 Faturë e skaduara: #${invoiceLabel}`,
            message: `Fatura #${invoiceLabel} me vlerë $${invoice.total?.toLocaleString() ?? 0} ka kaluar afatin e pagesës.`,
            isRead: false,
            createdAt: admin.firestore.Timestamp.now(),
          })
        );
      }
    } else if (dueDate <= reminderThreshold && !invoice.reminderSent) {
      // ---- Send 3-day payment reminder ----
      ops.push(
        doc.ref.update({
          reminderSent: true,
          updatedAt: admin.firestore.Timestamp.now(),
        })
      );
      remindersSent++;

      const daysLeft = Math.ceil((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

      // Get customer email from customers collection
      if (invoice.customerId) {
        const customerDoc = await db.collection('customers').doc(invoice.customerId).get();
        const customer = customerDoc.data();

        if (customer?.email) {
          ops.push(
            transporter.sendMail({
              from: `"FivoCRM" <${smtpUser}>`,
              to: customer.email,
              subject: `Kujtesë pagese: Fatura #${invoiceLabel}`,
              html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
                  <h2 style="color: #f59e0b; margin-bottom: 16px;">⏰ Kujtesë Pagese</h2>
                  <p style="color: #374151;">I dashur ${customer.name || 'Klient'},</p>
                  <p style="color: #374151; margin-top: 12px;">
                    Fatura juaj <strong>#${invoiceLabel}</strong> me vlerë
                    <strong> $${invoice.total?.toLocaleString() ?? 0}</strong>
                    skadon ${daysLeft === 0 ? 'sot' : `për ${daysLeft} ditë`}
                    (${dueDate.toLocaleDateString('sq-AL')}).
                  </p>
                  <p style="color: #374151; margin-top: 12px;">
                    Ju lutemi kryeni pagesën për të shmangur vonesat.
                  </p>
                  <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
                  <p style="color: #9ca3af; font-size: 12px;">FivoCRM — Njoftime automatike</p>
                </div>
              `,
            })
          );
        }
      }

      // Also notify the invoice owner in-app
      if (invoice.createdByUserId) {
        ops.push(
          db.collection('notifications').add({
            userId: invoice.createdByUserId,
            type: 'invoice_reminder_sent',
            title: `📧 Kujtesë u dërgua: Fatura #${invoiceLabel}`,
            message: `Kujtesa e pagesës u dërgua te klienti. Fatura skadon ${daysLeft === 0 ? 'sot' : `për ${daysLeft} ditë`}.`,
            isRead: false,
            createdAt: admin.firestore.Timestamp.now(),
          })
        );
      }
    }
  }

  await Promise.allSettled(ops);

  return res.status(200).json({
    success: true,
    overdueMarked,
    remindersSent,
    timestamp: new Date().toISOString(),
  });
}
