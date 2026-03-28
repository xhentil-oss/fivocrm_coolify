import type { VercelRequest, VercelResponse } from '@vercel/node';
import * as admin from 'firebase-admin';

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

// ─── Recurring Project Reset Logic ───────────────────────────────────────────
//
//  STRATEGY: "Cycle-Complete without losing history"
//
//  For recurring projects (isRecurring: true):
//    - When ALL tasks are Done → lastCompletedAt is set (done client-side)
//    - This cron runs daily and checks: if a recurring project had ALL tasks Done
//      AND the next cycle date has arrived → reset all tasks to Todo
//    - The project stays Active (never becomes Completed)
//    - BonusView reads lastCompletedAt (not status) to count recurring completions
//
//  Cycle timing:
//    - weekly:  reset 7 days after lastCompletedAt
//    - monthly: reset on the 1st of the next month after lastCompletedAt
//
// ─────────────────────────────────────────────────────────────────────────────

function getNextCycleDate(lastCompletedAt: Date, frequency: string): Date {
  const d = new Date(lastCompletedAt);
  if (frequency === 'weekly') {
    d.setDate(d.getDate() + 7);
  } else {
    // monthly: 1st of next month
    // IMPORTANT: set date to 1 BEFORE setMonth to avoid JS overflow
    // e.g. Jan 31 → setMonth(1) → March 3, not Feb 1
    d.setDate(1);
    d.setMonth(d.getMonth() + 1);
    d.setHours(0, 0, 0, 0);
  }
  return d;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Authorize with CRON_SECRET
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const now = new Date();

  // Fetch all recurring projects that have been completed at least once
  const projectsSnap = await db.collection('projects')
    .where('isRecurring', '==', true)
    .get();

  if (projectsSnap.empty) {
    return res.status(200).json({ success: true, reset: 0, reason: 'No recurring projects' });
  }

  let resetCount = 0;
  const ops: Promise<any>[] = [];

  for (const projectDoc of projectsSnap.docs) {
    const project = projectDoc.data();

    const lastCompletedAt: Date | null = project.lastCompletedAt?.toDate
      ? project.lastCompletedAt.toDate()
      : project.lastCompletedAt
        ? new Date(project.lastCompletedAt)
        : null;

    if (!lastCompletedAt) continue; // Never completed — skip

    const frequency: string = project.recurringFrequency || 'monthly';
    const nextCycle = getNextCycleDate(lastCompletedAt, frequency);

    // Only reset if the next cycle date has arrived
    if (now < nextCycle) continue;

    // Fetch all tasks for this project
    const tasksSnap = await db.collection('tasks')
      .where('projectId', '==', projectDoc.id)
      .get();

    if (tasksSnap.empty) continue;

    // Check if all tasks are Done (project was fully completed)
    const allDone = tasksSnap.docs.every(t => t.data().status === 'Done');
    if (!allDone) continue; // Incomplete — don't reset yet

    // Reset all tasks to Todo
    for (const taskDoc of tasksSnap.docs) {
      ops.push(
        taskDoc.ref.update({
          status: 'Todo',
          updatedAt: admin.firestore.Timestamp.now(),
          dueNotificationSent: false, // re-enable deadline alerts
        })
      );
    }

    // Update project: clear lastCompletedAt flags but keep lastCompletedAt for history
    // nextRecurringDate signals when next cycle starts
    ops.push(
      projectDoc.ref.update({
        status: 'Active',
        nextRecurringDate: nextCycle,
        updatedAt: admin.firestore.Timestamp.now(),
      })
    );

    // Notify the responsible user
    if (project.responsibleUserId) {
      ops.push(
        db.collection('notifications').add({
          userId: project.responsibleUserId,
          type: 'project_cycle_reset',
          title: `🔄 Projekti "${project.name}" u riaktivizua`,
          message: `Cikli i ri ka filluar. Të gjitha detyrat janë rivendosur te "Për të bërë".`,
          isRead: false,
          createdAt: admin.firestore.Timestamp.now(),
        })
      );
    }

    resetCount++;
  }

  await Promise.allSettled(ops);

  return res.status(200).json({
    success: true,
    reset: resetCount,
    timestamp: new Date().toISOString(),
  });
}
