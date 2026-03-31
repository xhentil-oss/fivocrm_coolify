import type { VercelRequest, VercelResponse } from '@vercel/node';
import { adminDb as db } from '../_firebaseAdmin';

function addFrequency(date: Date, frequency: string, dayOfWeek?: number, dayOfMonth?: number): Date {
  const d = new Date(date);
  if (frequency === 'daily') {
    d.setDate(d.getDate() + 1);
  } else if (frequency === 'weekly') {
    // Advance to the next occurrence of the specified weekday
    if (dayOfWeek !== undefined && dayOfWeek !== null) {
      const currentDay = d.getDay();
      let daysUntil = dayOfWeek - currentDay;
      if (daysUntil <= 0) daysUntil += 7;
      d.setDate(d.getDate() + daysUntil);
    } else {
      d.setDate(d.getDate() + 7);
    }
  } else if (frequency === 'monthly') {
    // Advance to the specified day of the next month
    if (dayOfMonth !== undefined && dayOfMonth !== null) {
      d.setMonth(d.getMonth() + 1);
      const maxDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      d.setDate(Math.min(dayOfMonth, maxDay));
    } else {
      d.setMonth(d.getMonth() + 1);
    }
  } else if (frequency === 'yearly') {
    d.setFullYear(d.getFullYear() + 1);
  }
  return d;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const now = new Date();

  // Fetch all recurring tasks
  const tasksSnap = await db.collection('tasks')
    .where('isRecurring', '==', true)
    .get();

  let created = 0;
  const ops: Promise<any>[] = [];

  for (const doc of tasksSnap.docs) {
    const task = doc.data();

    if (!task.nextRecurringDate || !task.recurringFrequency) continue;

    const nextRecurringDate: Date = task.nextRecurringDate.toDate
      ? task.nextRecurringDate.toDate()
      : new Date(task.nextRecurringDate);

    // Only process tasks whose recurrence date has passed
    if (nextRecurringDate > now) continue;

    const startDate: Date = task.startDate?.toDate
      ? task.startDate.toDate()
      : new Date(task.startDate || now);

    const endDate: Date = task.endDate?.toDate
      ? task.endDate.toDate()
      : new Date(task.endDate || now);

    const newStartDate = addFrequency(startDate, task.recurringFrequency, task.recurringDayOfWeek, task.recurringDayOfMonth);
    const newEndDate = addFrequency(endDate, task.recurringFrequency, task.recurringDayOfWeek, task.recurringDayOfMonth);
    const newNextRecurring = addFrequency(nextRecurringDate, task.recurringFrequency, task.recurringDayOfWeek, task.recurringDayOfMonth);

    // Create the new task copy (reset status and notification flag)
    ops.push(
      db.collection('tasks').add({
        title: task.title,
        description: task.description ?? null,
        status: 'To Do',
        priority: task.priority ?? null,
        projectId: task.projectId ?? null,
        assignedToUserId: task.assignedToUserId ?? null,
        startDate: admin.firestore.Timestamp.fromDate(newStartDate),
        endDate: admin.firestore.Timestamp.fromDate(newEndDate),
        isRecurring: true,
        recurringFrequency: task.recurringFrequency,
        recurringDayOfWeek: task.recurringDayOfWeek ?? null,
        recurringDayOfMonth: task.recurringDayOfMonth ?? null,
        nextRecurringDate: admin.firestore.Timestamp.fromDate(newNextRecurring),
        dueNotificationSent: false,
        parentTaskId: task.parentTaskId ?? null,
        createdByUserId: task.createdByUserId ?? null,
        createdAt: admin.firestore.Timestamp.now(),
        updatedAt: admin.firestore.Timestamp.now(),
      })
    );

    // Update the original task's nextRecurringDate so it doesn't re-trigger
    ops.push(
      doc.ref.update({
        nextRecurringDate: admin.firestore.Timestamp.fromDate(newNextRecurring),
        updatedAt: admin.firestore.Timestamp.now(),
      })
    );

    // Notify the assigned user in-app
    if (task.assignedToUserId) {
      const freqLabel: Record<string, string> = {
        weekly: 'javore',
        monthly: 'mujore',
        yearly: 'vjetore',
      };
      ops.push(
        db.collection('notifications').add({
          userId: task.assignedToUserId,
          type: 'recurring_task_created',
          title: `🔄 Detyrë e re periodike: ${task.title}`,
          message: `Detyra periodike "${task.title}" (${freqLabel[task.recurringFrequency] ?? task.recurringFrequency}) u krijua automatikisht dhe është caktuar për ${newEndDate.toLocaleDateString('sq-AL')}.`,
          isRead: false,
          createdAt: admin.firestore.Timestamp.now(),
        })
      );
    }

    created++;
  }

  await Promise.allSettled(ops);

  return res.status(200).json({
    success: true,
    created,
    timestamp: new Date().toISOString(),
  });
}
