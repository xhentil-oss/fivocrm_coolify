import type { VercelRequest, VercelResponse } from '@vercel/node';
import * as admin from 'firebase-admin';
import nodemailer from 'nodemailer';

// Initialize Firebase Admin (singleton pattern for serverless)
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
  // Authorize with CRON_SECRET
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

  // Window: projects that are Active or In Planning, not completed this week
  // "This week" = last 7 days
  const oneWeekAgo = new Date(now);
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

  // Fetch all non-completed projects that are Active or Planning
  const projectsSnap = await db.collection('projects')
    .where('status', 'in', ['Active', 'Planning', 'On Hold'])
    .get();

  if (projectsSnap.empty) {
    return res.status(200).json({ success: true, notified: 0, reason: 'No active projects' });
  }

  // Build map: responsibleUserId -> projects assigned to them (not completed)
  const userProjectMap = new Map<string, { id: string; name: string; status: string; updatedAt: Date }[]>();

  for (const doc of projectsSnap.docs) {
    const project = doc.data();
    const responsibleUserId: string | undefined = project.responsibleUserId;
    if (!responsibleUserId) continue;

    const updatedAt: Date = project.updatedAt?.toDate
      ? project.updatedAt.toDate()
      : project.updatedAt
        ? new Date(project.updatedAt)
        : new Date(0);

    const existing = userProjectMap.get(responsibleUserId) || [];
    existing.push({
      id: doc.id,
      name: project.name || 'Pa emër',
      status: project.status,
      updatedAt,
    });
    userProjectMap.set(responsibleUserId, existing);
  }

  let notified = 0;
  const ops: Promise<any>[] = [];

  for (const [userId, userProjects] of userProjectMap) {
    // Check if user closed ANY project in the last 7 days
    // A project is considered "closed this week" if it was moved to Completed recently
    // Since we only fetched non-completed projects, all projects here are still open
    // We just want to notify about all open projects once per week

    const projectListHtml = userProjects
      .map(p => `<li style="margin-bottom:8px;"><strong>${p.name}</strong> — <span style="color:#6b7280;">${p.status}</span></li>`)
      .join('');

    const projectListText = userProjects
      .map(p => `• ${p.name} (${p.status})`)
      .join('\n');

    // Create in-app notification
    ops.push(
      db.collection('notifications').add({
        userId,
        type: 'project_open_reminder',
        title: `📋 ${userProjects.length} projekt${userProjects.length > 1 ? 'e' : ''} akoma të hapura`,
        message: `Ke ${userProjects.length} projekt${userProjects.length > 1 ? 'e' : ''} të hapur${userProjects.length > 1 ? 'a' : ''} pa mbyllur këtë javë.`,
        isRead: false,
        createdAt: admin.firestore.Timestamp.now(),
      })
    );

    // Send email
    try {
      const userRecord = await admin.auth().getUser(userId);
      if (userRecord.email) {
        ops.push(
          transporter.sendMail({
            from: `"FivoCRM" <${smtpUser}>`,
            to: userRecord.email,
            subject: `📋 Kujtesë javore: ${userProjects.length} projekt${userProjects.length > 1 ? 'e' : ''} akoma të hapur${userProjects.length > 1 ? 'a' : ''}`,
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; background: #ffffff;">
                <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 24px; border-radius: 12px 12px 0 0; text-align: center;">
                  <h1 style="color: #ffffff; margin: 0; font-size: 20px;">📋 Kujtesë Javore e Projekteve</h1>
                </div>
                <div style="background: #f9fafb; padding: 24px; border-radius: 0 0 12px 12px; border: 1px solid #e5e7eb; border-top: none;">
                  <p style="color: #374151; font-size: 16px; margin-top: 0;">
                    Përshëndetje,
                  </p>
                  <p style="color: #374151; font-size: 15px;">
                    Kjo javë ka kaluar pa mbyllur projektet e mëposhtme. Ju kujtojmë t'i rishikoni dhe të përditësoni statusin e tyre:
                  </p>
                  <ul style="color: #374151; font-size: 14px; line-height: 1.8; background: #ffffff; padding: 16px 24px; border-radius: 8px; border: 1px solid #e5e7eb;">
                    ${projectListHtml}
                  </ul>
                  <p style="color: #6b7280; font-size: 14px; margin-top: 20px;">
                    Nëse një projekt është mbyllur, kalojeni në statusin <strong>"Completed"</strong> nga platformë.
                  </p>
                  <div style="text-align: center; margin-top: 24px;">
                    <a href="${process.env.APP_URL || 'https://app.fivoo.net'}/app/projects"
                       style="background: #667eea; color: #ffffff; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: bold;">
                      Shiko Projektet →
                    </a>
                  </div>
                  <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
                  <p style="color: #9ca3af; font-size: 12px; text-align: center; margin: 0;">
                    FivoCRM — Kujtesë automatike javore · Dërgohet çdo të hënë
                  </p>
                </div>
              </div>
            `,
            text: `Kujtesë Javore e Projekteve\n\nKe ${userProjects.length} projekt${userProjects.length > 1 ? 'e' : ''} të hapur${userProjects.length > 1 ? 'a' : ''} pa mbyllur:\n\n${projectListText}\n\nHyr në FivoCRM dhe përditëso statusin e tyre.\n\n---\nFivoCRM — Kujtesë automatike javore`,
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
    totalOpenProjects: projectsSnap.size,
    timestamp: new Date().toISOString(),
  });
}
