import type { VercelRequest, VercelResponse } from '@vercel/node';
import nodemailer from 'nodemailer';
import { adminDb as db } from '../_firebaseAdmin';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Authorize with CRON_SECRET (Vercel sets this automatically for cron jobs)
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

  // Alert threshold: 2 days ahead
  const alertThreshold = new Date(now);
  alertThreshold.setDate(alertThreshold.getDate() + 2);
  alertThreshold.setHours(23, 59, 59, 999);

  // Fetch all tasks not yet notified about their due date
  const tasksSnap = await db.collection('tasks')
    .where('dueNotificationSent', '==', false)
    .get();

  let notified = 0;
  const ops: Promise<any>[] = [];

  for (const doc of tasksSnap.docs) {
    const task = doc.data();

    if (!task.endDate || !task.assignedToUserId) continue;
    if (task.status === 'Done') continue;

    const endDate: Date = task.endDate.toDate
      ? task.endDate.toDate()
      : new Date(task.endDate);

    const isOverdue = endDate < now;
    const isDueSoon = endDate <= alertThreshold;

    if (!isOverdue && !isDueSoon) continue;

    const daysLeft = Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    const overdueByDays = Math.abs(daysLeft);

    const notifTitle = isOverdue
      ? `⚠️ Detyrë e skaduara: ${task.title}`
      : `⏰ Afati afrohet: ${task.title}`;

    const notifMessage = isOverdue
      ? `Detyra "${task.title}" ka kaluar afatin prej ${overdueByDays} ditë.`
      : `Detyra "${task.title}" skadon ${daysLeft === 0 ? 'sot' : `për ${daysLeft} ditë`}.`;

    // Create in-app notification
    ops.push(
      db.collection('notifications').add({
        userId: task.assignedToUserId,
        type: isOverdue ? 'task_overdue' : 'task_due_soon',
        title: notifTitle,
        message: notifMessage,
        isRead: false,
        createdAt: admin.firestore.Timestamp.now(),
      })
    );

    // Mark task as notified to prevent duplicate notifications
    ops.push(doc.ref.update({ dueNotificationSent: true }));

    // Send email notification to the assigned user
    try {
      const userRecord = await admin.auth().getUser(task.assignedToUserId);
      if (userRecord.email) {
        ops.push(
          transporter.sendMail({
            from: `"FivoCRM" <${smtpUser}>`,
            to: userRecord.email,
            subject: notifTitle,
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
                <h2 style="color: ${isOverdue ? '#ef4444' : '#f59e0b'}; margin-bottom: 16px;">${notifTitle}</h2>
                <p style="color: #374151; font-size: 16px;">${notifMessage}</p>
                <p style="color: #6b7280; font-size: 14px; margin-top: 24px;">
                  Hyr në FivoCRM për të menaxhuar detyrat e tua.
                </p>
                <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
                <p style="color: #9ca3af; font-size: 12px;">FivoCRM — Njoftime automatike</p>
              </div>
            `,
          })
        );
      }
    } catch {
      // User not found or no email — skip silently
    }

    notified++;
  }

  await Promise.allSettled(ops);

  return res.status(200).json({
    success: true,
    notified,
    timestamp: new Date().toISOString(),
  });
}
