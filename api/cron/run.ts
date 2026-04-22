import type { VercelRequest, VercelResponse } from '@vercel/node';
import nodemailer from 'nodemailer';
import { buildInvoiceEmail } from '../_invoiceEmail.js';
import admin, { adminDb as db } from '../_firebaseAdmin.js';

// ── Auth helper ───────────────────────────────────────────────────────────────
function authorize(req: VercelRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;
  return !!(cronSecret && req.headers.authorization === `Bearer ${cronSecret}`);
}

// ── SMTP helper ───────────────────────────────────────────────────────────────
function makeTransporter() {
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  if (!smtpUser || !smtpPass) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'mail.fivoo.net',
    port: Number(process.env.SMTP_PORT) || 465,
    secure: true,
    auth: { user: smtpUser, pass: smtpPass },
  });
}

// ── addFrequency (for recurring tasks) ───────────────────────────────────────
function addFrequency(date: Date, frequency: string, dayOfWeek?: number, dayOfMonth?: number, interval = 1, daysOfWeek?: number[]): Date {
  const d = new Date(date);
  const step = Math.max(1, Math.round(interval));
  if (frequency === 'daily') {
    d.setDate(d.getDate() + step);
    // If specific weekdays are configured, advance until we land on one
    if (daysOfWeek && daysOfWeek.length > 0) {
      let tries = 0;
      while (!daysOfWeek.includes(d.getDay()) && tries < 7) {
        d.setDate(d.getDate() + 1);
        tries++;
      }
    }
  } else if (frequency === 'weekly') {
    d.setDate(d.getDate() + 7 * step);
    if (dayOfWeek !== undefined && dayOfWeek !== null) {
      const diff = dayOfWeek - d.getDay();
      if (diff !== 0) d.setDate(d.getDate() + diff);
    }
  } else if (frequency === 'monthly') {
    d.setMonth(d.getMonth() + step);
    if (dayOfMonth !== undefined && dayOfMonth !== null) {
      const maxDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      d.setDate(Math.min(dayOfMonth, maxDay));
    }
  } else if (frequency === 'yearly') {
    d.setFullYear(d.getFullYear() + step);
  }
  return d;
}

// ── JOB: task-deadline-alerts ─────────────────────────────────────────────────
async function runTaskDeadlineAlerts() {
  const transporter = makeTransporter();
  const smtpUser = process.env.SMTP_USER;
  const now = new Date();
  const alertThreshold = new Date(now);
  alertThreshold.setDate(alertThreshold.getDate() + 2);
  alertThreshold.setHours(23, 59, 59, 999);

  const tasksSnap = await db.collection('tasks').where('dueNotificationSent', '==', false).get();
  let notified = 0;
  const ops: Promise<any>[] = [];

  for (const doc of tasksSnap.docs) {
    const task = doc.data();
    if (!task.endDate || !task.assignedToUserId || task.status === 'Done') continue;
    const endDate: Date = task.endDate?.toDate ? task.endDate.toDate() : new Date(task.endDate);
    if (isNaN(endDate.getTime())) continue;

    const isOverdue = endDate < now;
    const isDueSoon = endDate <= alertThreshold;
    if (!isOverdue && !isDueSoon) continue;

    const daysLeft = Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    const overdueByDays = Math.abs(daysLeft);
    const notifTitle = isOverdue ? `⚠️ Detyrë e skaduara: ${task.title}` : `⏰ Afati afrohet: ${task.title}`;
    const notifMessage = isOverdue
      ? `Detyra "${task.title}" ka kaluar afatin prej ${overdueByDays} ditë.`
      : `Detyra "${task.title}" skadon ${daysLeft === 0 ? 'sot' : `për ${daysLeft} ditë`}.`;

    ops.push(db.collection('notifications').add({ userId: task.assignedToUserId, type: isOverdue ? 'task_overdue' : 'task_due_soon', title: notifTitle, message: notifMessage, isRead: false, createdAt: admin.firestore.Timestamp.now() }));
    ops.push(doc.ref.update({ dueNotificationSent: true }));

    if (transporter && smtpUser) {
      try {
        const userRecord = await admin.auth().getUser(task.assignedToUserId);
        if (userRecord.email) {
          ops.push(transporter.sendMail({ from: `"FivoCRM" <${smtpUser}>`, to: userRecord.email, subject: notifTitle, html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;"><h2 style="color:${isOverdue ? '#ef4444' : '#f59e0b'}">${notifTitle}</h2><p>${notifMessage}</p><p style="color:#9ca3af;font-size:12px">FivoCRM – Njoftime automatike</p></div>` }));
        }
      } catch { /* skip */ }
    }
    notified++;
  }

  await Promise.allSettled(ops);
  return { notified };
}

// ── JOB: invoice-reminders ───────────────────────────────────────────────────
async function runInvoiceReminders() {
  const transporter = makeTransporter();
  const smtpUser = process.env.SMTP_USER;
  const now = new Date();
  const reminderThreshold = new Date(now);
  reminderThreshold.setDate(reminderThreshold.getDate() + 3);
  reminderThreshold.setHours(23, 59, 59, 999);

  const invoicesSnap = await db.collection('invoices').where('status', '==', 'Pending').get();
  let overdueMarked = 0, remindersSent = 0, reminder25Sent = 0, reminderLastDaySent = 0;
  const ops: Promise<any>[] = [];

  for (const doc of invoicesSnap.docs) {
    const invoice = doc.data();
    if (!invoice.dueDate) continue;
    const dueDate: Date = invoice.dueDate.toDate ? invoice.dueDate.toDate() : new Date(invoice.dueDate);
    const invoiceLabel = invoice.invoiceNumber || doc.id.slice(0, 8).toUpperCase();

    if (dueDate < now) {
      ops.push(doc.ref.update({ status: 'Overdue', updatedAt: admin.firestore.Timestamp.now() }));
      overdueMarked++;
      if (invoice.createdByUserId) ops.push(db.collection('notifications').add({ userId: invoice.createdByUserId, type: 'invoice_overdue', title: `🔴 Faturë e skaduara: #${invoiceLabel}`, message: `Fatura #${invoiceLabel} ka kaluar afatin e pagesës.`, isRead: false, createdAt: admin.firestore.Timestamp.now() }));
    } else if (dueDate <= reminderThreshold && !invoice.reminderSent) {
      ops.push(doc.ref.update({ reminderSent: true, updatedAt: admin.firestore.Timestamp.now() }));
      remindersSent++;
      const daysLeft = Math.ceil((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      if (transporter && smtpUser && invoice.customerId) {
        const customerDoc = await db.collection('customers').doc(invoice.customerId).get();
        const customer = customerDoc.data();
        if (customer?.email) {
          ops.push(transporter.sendMail({ from: `"FivoCRM" <${smtpUser}>`, to: customer.email, subject: `Kujtesë pagese: Fatura #${invoiceLabel}`, html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;"><h2 style="color:#f59e0b">⏰ Kujtesë Pagese</h2><p>Fatura juaj <strong>#${invoiceLabel}</strong> skadon ${daysLeft === 0 ? 'sot' : `për ${daysLeft} ditë`}.</p><p style="color:#9ca3af;font-size:12px">FivoCRM – Njoftime automatike</p></div>` }));
        }
      }
      if (invoice.createdByUserId) ops.push(db.collection('notifications').add({ userId: invoice.createdByUserId, type: 'invoice_reminder_sent', title: `📧 Kujtesë u dërgua: Fatura #${invoiceLabel}`, message: `Kujtesa e pagesës u dërgua te klienti.`, isRead: false, createdAt: admin.firestore.Timestamp.now() }));
    }
  }
  await Promise.allSettled(ops);

  // 25th/last-day recurring invoice reminders
  const todayDate = now.getDate();
  const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const is25th = todayDate === 25;
  const isLastDay = todayDate === lastDayOfMonth;

  if (is25th || isLastDay) {
    const flagField = is25th ? 'reminder25Sent' : 'reminderLastDaySent';
    const type = is25th ? 'reminder1' : 'reminder2';
    const recurringSnap = await db.collection('invoices').where('autoGenerated', '==', true).where('status', '==', 'Pending').where(flagField, '==', false).get();
    const reminderOps: Promise<any>[] = [];

    for (const doc of recurringSnap.docs) {
      const invoice = doc.data();
      if (!invoice.customerId) continue;
      const invoiceLabel = invoice.invoiceNumber || doc.id.slice(0, 8).toUpperCase();
      const customerDoc = await db.collection('customers').doc(invoice.customerId).get();
      const customer = customerDoc.data();
      if (!customer?.email) continue;
      let projectName = 'Shërbim';
      if (invoice.projectId) { const pd = await db.collection('projects').doc(invoice.projectId).get(); if (pd.exists) projectName = pd.data()?.name || projectName; }
      const dueDate: Date = invoice.dueDate?.toDate ? invoice.dueDate.toDate() : invoice.dueDate ? new Date(invoice.dueDate) : now;
      const { subject, html } = buildInvoiceEmail({ customerName: customer.name || 'Klient', invoiceNumber: invoiceLabel, amount: invoice.total || invoice.amount || 0, dueDate, projectName, type, currency: invoice.currency || 'ALL', paymentMethod: invoice.paymentMethod, bankName: invoice.bankName, bankIBAN: invoice.bankIBAN, bankSWIFT: invoice.bankSWIFT, bankAccountHolder: invoice.bankAccountHolder, bankCountry: invoice.bankCountry });
      if (transporter && smtpUser) reminderOps.push(transporter.sendMail({ from: `"FivoCRM" <${smtpUser}>`, to: customer.email, subject, html }).then(() => doc.ref.update({ [flagField]: true, updatedAt: admin.firestore.Timestamp.now() })));
      if (invoice.createdByUserId) reminderOps.push(db.collection('notifications').add({ userId: invoice.createdByUserId, type: `invoice_${type}_sent`, title: `📧 Kujtesë dërguar (${is25th ? '25' : 'dita e fundit'}): #${invoiceLabel}`, message: `Kujtesa e pagesës u dërgua te ${customer.name || 'klienti'}.`, isRead: false, createdAt: admin.firestore.Timestamp.now() }));
      is25th ? reminder25Sent++ : reminderLastDaySent++;
    }
    await Promise.allSettled(reminderOps);
  }

  return { overdueMarked, remindersSent, reminder25Sent, reminderLastDaySent };
}

// ── JOB: recurring-tasks ─────────────────────────────────────────────────────
async function runRecurringTasks() {
  const now = new Date();
  const tasksSnap = await db.collection('tasks').where('isRecurring', '==', true).get();
  let created = 0;
  const ops: Promise<any>[] = [];

  for (const doc of tasksSnap.docs) {
    const task = doc.data();
    if (!task.nextRecurringDate || !task.recurringFrequency) continue;
    const nextRecurringDate: Date = task.nextRecurringDate?.toDate ? task.nextRecurringDate.toDate() : new Date(task.nextRecurringDate);
    if (isNaN(nextRecurringDate.getTime()) || nextRecurringDate > now) continue;
    if (!task.startDate || !task.endDate) continue;
    const startDate: Date = task.startDate?.toDate ? task.startDate.toDate() : new Date(task.startDate);
    const endDate: Date = task.endDate?.toDate ? task.endDate.toDate() : new Date(task.endDate);
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) continue;

    const newStart = addFrequency(startDate, task.recurringFrequency, task.recurringDayOfWeek, task.recurringDayOfMonth, task.recurringInterval, task.recurringDaysOfWeek);
    const newEnd = addFrequency(endDate, task.recurringFrequency, task.recurringDayOfWeek, task.recurringDayOfMonth, task.recurringInterval, task.recurringDaysOfWeek);
    const newNext = addFrequency(nextRecurringDate, task.recurringFrequency, task.recurringDayOfWeek, task.recurringDayOfMonth, task.recurringInterval, task.recurringDaysOfWeek);

    ops.push(db.collection('tasks').add({ title: task.title, description: task.description ?? null, status: 'Todo', priority: task.priority ?? null, projectId: task.projectId ?? null, assignedToUserId: task.assignedToUserId ?? null, startDate: admin.firestore.Timestamp.fromDate(newStart), endDate: admin.firestore.Timestamp.fromDate(newEnd), isRecurring: true, recurringFrequency: task.recurringFrequency, recurringInterval: task.recurringInterval ?? 1, recurringDayOfWeek: task.recurringDayOfWeek ?? null, recurringDayOfMonth: task.recurringDayOfMonth ?? null, recurringDaysOfWeek: task.recurringDaysOfWeek ?? null, nextRecurringDate: admin.firestore.Timestamp.fromDate(newNext), dueNotificationSent: false, parentTaskId: task.parentTaskId ?? null, createdByUserId: task.createdByUserId ?? null, teamId: task.teamId ?? null, createdAt: admin.firestore.Timestamp.now(), updatedAt: admin.firestore.Timestamp.now() }));
    ops.push(doc.ref.update({ nextRecurringDate: admin.firestore.Timestamp.fromDate(newNext), updatedAt: admin.firestore.Timestamp.now() }));
    if (task.assignedToUserId) {
      const freqLabel: Record<string, string> = { weekly: 'javore', monthly: 'mujore', yearly: 'vjetore' };
      ops.push(db.collection('notifications').add({ userId: task.assignedToUserId, type: 'recurring_task_created', title: `🔄 Detyrë e re periodike: ${task.title}`, message: `Detyra periodike "${task.title}" (${freqLabel[task.recurringFrequency] ?? task.recurringFrequency}) u krijua automatikisht.`, isRead: false, createdAt: admin.firestore.Timestamp.now() }));
    }
    created++;
  }

  await Promise.allSettled(ops);
  return { created };
}

// ── JOB: recurring-invoices ──────────────────────────────────────────────────
async function runRecurringInvoices() {
  const transporter = makeTransporter();
  const smtpUser = process.env.SMTP_USER;
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();
  const dueDate = new Date(currentYear, currentMonth + 1, 0);

  const projectsSnap = await db.collection('projects').where('isRecurring', '==', true).get();
  let created = 0, skipped = 0;
  const ops: Promise<any>[] = [];

  for (const projectDoc of projectsSnap.docs) {
    const project = projectDoc.data();
    if (project.recurringFrequency !== 'monthly') continue;
    if (project.lastInvoiceGeneratedAt) {
      const last: Date = project.lastInvoiceGeneratedAt.toDate ? project.lastInvoiceGeneratedAt.toDate() : new Date(project.lastInvoiceGeneratedAt);
      if (last.getFullYear() === currentYear && last.getMonth() === currentMonth) { skipped++; continue; }
    }

    const budget = project.budget || 0;
    const monthName = now.toLocaleDateString('sq-AL', { month: 'long', year: 'numeric' });
    const invoiceLabel = `AUTO-${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${projectDoc.id.slice(0, 6).toUpperCase()}`;
    const invoiceRef = db.collection('invoices').doc();

    ops.push(invoiceRef.set({ invoiceNumber: invoiceLabel, projectId: projectDoc.id, customerId: project.customerId || null, teamId: project.teamId || null, amount: budget, subtotal: budget, total: budget, tax: 0, status: 'Pending', notes: `Faturë e gjeneruar automatikisht për projektin periodik "${project.name}" – ${monthName}.`, dueDate: admin.firestore.Timestamp.fromDate(dueDate), isRecurring: true, recurringFrequency: 'monthly', autoGenerated: true, emailSent: false, reminderSent: false, reminder25Sent: false, reminderLastDaySent: false, createdByUserId: project.createdByUserId || null, createdAt: admin.firestore.Timestamp.now(), updatedAt: admin.firestore.Timestamp.now() }));
    ops.push(db.collection('invoiceItems').doc().set({ invoiceId: invoiceRef.id, description: `${project.name} – shërbime mujore`, quantity: 1, unitPrice: budget, totalPrice: budget, createdAt: admin.firestore.Timestamp.now(), updatedAt: admin.firestore.Timestamp.now() }));

    if (transporter && smtpUser && project.customerId) {
      const customerDoc = await db.collection('customers').doc(project.customerId).get();
      const customer = customerDoc.data();
      if (customer?.email) {
        const { subject, html } = buildInvoiceEmail({ customerName: customer.name || 'Klient', invoiceNumber: invoiceLabel, amount: budget, dueDate, projectName: project.name, type: 'initial', currency: project.currency || 'ALL', paymentMethod: project.paymentMethod, bankName: project.bankName, bankIBAN: project.bankIBAN, bankSWIFT: project.bankSWIFT, bankAccountHolder: project.bankAccountHolder, bankCountry: project.bankCountry });
        ops.push(transporter.sendMail({ from: `"FivoCRM" <${smtpUser}>`, to: customer.email, subject, html }).then(() => invoiceRef.update({ emailSent: true, updatedAt: admin.firestore.Timestamp.now() })));
      }
    }

    ops.push(projectDoc.ref.update({ lastInvoiceGeneratedAt: admin.firestore.Timestamp.now(), updatedAt: admin.firestore.Timestamp.now() }));
    if (project.createdByUserId) ops.push(db.collection('notifications').add({ userId: project.createdByUserId, type: 'auto_invoice_created', title: `🧾 Faturë e re automatike: ${project.name}`, message: `Fatura #${invoiceLabel} (${budget.toLocaleString('sq-AL')} L) u gjenerua automatikisht.`, isRead: false, createdAt: admin.firestore.Timestamp.now() }));

    created++;
  }

  await Promise.allSettled(ops);
  return { created, skipped };
}

// ── JOB: project-completion-reminder ─────────────────────────────────────────
async function runProjectCompletionReminder() {
  const transporter = makeTransporter();
  const smtpUser = process.env.SMTP_USER;
  const now = new Date();

  const projectsSnap = await db.collection('projects').where('status', 'in', ['Active', 'Planning', 'On Hold']).get();
  if (projectsSnap.empty) return { notified: 0 };

  const userProjectMap = new Map<string, { name: string; status: string }[]>();
  for (const doc of projectsSnap.docs) {
    const p = doc.data();
    if (!p.responsibleUserId) continue;
    const existing = userProjectMap.get(p.responsibleUserId) || [];
    existing.push({ name: p.name || 'Pa emër', status: p.status });
    userProjectMap.set(p.responsibleUserId, existing);
  }

  let notified = 0;
  const ops: Promise<any>[] = [];

  for (const [userId, userProjects] of userProjectMap) {
    ops.push(db.collection('notifications').add({ userId, type: 'project_open_reminder', title: `📋 ${userProjects.length} projekt${userProjects.length > 1 ? 'e' : ''} akoma të hapura`, message: `Ke ${userProjects.length} projekt${userProjects.length > 1 ? 'e' : ''} të hapur${userProjects.length > 1 ? 'a' : ''} pa mbyllur këtë javë.`, isRead: false, createdAt: admin.firestore.Timestamp.now() }));
    if (transporter && smtpUser) {
      try {
        const userRecord = await admin.auth().getUser(userId);
        if (userRecord.email) {
          const projectListHtml = userProjects.map(p => `<li><strong>${p.name}</strong> – <span style="color:#6b7280">${p.status}</span></li>`).join('');
          ops.push(transporter.sendMail({ from: `"FivoCRM" <${smtpUser}>`, to: userRecord.email, subject: `📋 Kujtesë javore: ${userProjects.length} projekt të hapur`, html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px"><h2 style="color:#667eea">📋 Kujtesë Javore e Projekteve</h2><ul>${projectListHtml}</ul><p style="color:#9ca3af;font-size:12px">FivoCRM – Kujtesë automatike javore</p></div>` }));
        }
      } catch { /* skip */ }
    }
    notified++;
  }

  await Promise.allSettled(ops);
  return { notified, totalOpenProjects: projectsSnap.size };
}

// ── JOB: recurring-project-reset ─────────────────────────────────────────────
async function runRecurringProjectReset() {
  const now = new Date();
  const projectsSnap = await db.collection('projects').where('isRecurring', '==', true).get();
  if (projectsSnap.empty) return { reset: 0 };

  let resetCount = 0;
  const ops: Promise<any>[] = [];

  for (const projectDoc of projectsSnap.docs) {
    const project = projectDoc.data();
    const lastCompletedAt: Date | null = project.lastCompletedAt?.toDate ? project.lastCompletedAt.toDate() : project.lastCompletedAt ? new Date(project.lastCompletedAt) : null;
    if (!lastCompletedAt) continue;

    const frequency = project.recurringFrequency || 'monthly';
    const d = new Date(lastCompletedAt);
    let nextCycle: Date;
    if (frequency === 'weekly') { d.setDate(d.getDate() + 7); nextCycle = d; }
    else { d.setDate(1); d.setMonth(d.getMonth() + 1); d.setHours(0, 0, 0, 0); nextCycle = d; }

    if (now < nextCycle) continue;

    const tasksSnap = await db.collection('tasks').where('projectId', '==', projectDoc.id).get();
    if (tasksSnap.empty) continue;
    if (!tasksSnap.docs.every(t => t.data().status === 'Done')) continue;

    for (const taskDoc of tasksSnap.docs) ops.push(taskDoc.ref.update({ status: 'Todo', updatedAt: admin.firestore.Timestamp.now(), dueNotificationSent: false }));
    ops.push(projectDoc.ref.update({ status: 'Active', nextRecurringDate: nextCycle, updatedAt: admin.firestore.Timestamp.now() }));
    if (project.responsibleUserId) ops.push(db.collection('notifications').add({ userId: project.responsibleUserId, type: 'project_cycle_reset', title: `🔄 Projekti "${project.name}" u riaktivizua`, message: `Cikli i ri ka filluar. Të gjitha detyrat janë rivendosur te "Për të bërë".`, isRead: false, createdAt: admin.firestore.Timestamp.now() }));
    resetCount++;
  }

  await Promise.allSettled(ops);
  return { reset: resetCount };
}

// ── JOB: recurring-expenses ──────────────────────────────────────────────────
async function runRecurringExpenses() {
  const now = new Date();
  const expensesSnap = await db.collection('expenses').where('isRecurring', '==', true).get();
  if (expensesSnap.empty) return { created: 0 };

  let created = 0;
  const ops: Promise<any>[] = [];

  for (const doc of expensesSnap.docs) {
    const expense = doc.data();
    if (!expense.nextRecurringDate || !expense.recurringFrequency) continue;
    const nextDate: Date = expense.nextRecurringDate?.toDate ? expense.nextRecurringDate.toDate() : new Date(expense.nextRecurringDate);
    if (isNaN(nextDate.getTime()) || nextDate > now) continue;

    // Calculate the next occurrence
    const next = new Date(nextDate);
    if (expense.recurringFrequency === 'weekly') next.setDate(next.getDate() + 7);
    else if (expense.recurringFrequency === 'monthly') next.setMonth(next.getMonth() + 1);
    else if (expense.recurringFrequency === 'yearly') next.setFullYear(next.getFullYear() + 1);
    else next.setMonth(next.getMonth() + 1); // default monthly

    // Create a new expense entry for this cycle
    ops.push(db.collection('expenses').add({
      title: expense.title,
      description: expense.description || null,
      amount: expense.amount,
      currency: expense.currency || 'ALL',
      category: expense.category,
      teamId: expense.teamId || null,
      projectId: expense.projectId || null,
      departmentId: expense.departmentId || null,
      memberId: expense.memberId || null,
      isRecurring: false, // child entries are not recurring themselves
      status: expense.status || 'Active',
      approvalStatus: 'Submitted',
      createdByUserId: expense.createdByUserId || null,
      date: admin.firestore.Timestamp.fromDate(now),
      createdAt: admin.firestore.Timestamp.now(),
      updatedAt: admin.firestore.Timestamp.now(),
    }));

    // Update nextRecurringDate on the parent
    ops.push(doc.ref.update({ nextRecurringDate: admin.firestore.Timestamp.fromDate(next), updatedAt: admin.firestore.Timestamp.now() }));

    // Notify the creator
    if (expense.createdByUserId) {
      ops.push(db.collection('notifications').add({
        userId: expense.createdByUserId,
        type: 'recurring_expense_created',
        title: `🔄 Shpenzim periodik: ${expense.title}`,
        message: `Shpenzimi periodik "${expense.title}" (${expense.amount} ${expense.currency || 'ALL'}) u krijua automatikisht.`,
        isRead: false,
        actionUrl: '/app/expenses',
        actionLabel: 'Shiko Shpenzimet',
        createdAt: admin.firestore.Timestamp.now(),
      }));
    }
    created++;
  }

  await Promise.allSettled(ops);
  return { created };
}

// ── JOB: expire-invitations ───────────────────────────────────────────────────
async function runExpireInvitations() {
  const now = admin.firestore.Timestamp.fromDate(new Date());
  const invitesSnap = await db.collection('teamInvites').where('status', '==', 'Pending').get();
  if (invitesSnap.empty) return { expired: 0 };

  let expired = 0;
  const ops: Promise<any>[] = [];

  for (const doc of invitesSnap.docs) {
    const invite = doc.data();
    if (!invite.expiresAt) continue;
    const expiresAt: Date = invite.expiresAt?.toDate ? invite.expiresAt.toDate() : new Date(invite.expiresAt);
    if (isNaN(expiresAt.getTime()) || expiresAt > new Date()) continue;

    ops.push(doc.ref.update({ status: 'Expired', updatedAt: now }));
    expired++;
  }

  await Promise.allSettled(ops);
  return { expired };
}

// ── JOB: goal-overdue-alerts ─────────────────────────────────────────────────
async function runGoalOverdueAlerts() {
  const now = new Date();
  const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  const goalsSnap = await db.collection('goals').get();
  if (goalsSnap.empty) return { notified: 0 };

  let notified = 0;
  const ops: Promise<any>[] = [];

  for (const goalDoc of goalsSnap.docs) {
    const goal = goalDoc.data();

    // Skip if already achieved or already notified
    if (goal.status === 'Achieved') continue;
    if (goal.goalOverdueSent) continue;

    // Determine the reference date (dueDate preferred, fall back to createdAt)
    const refDate: Date | null =
      goal.dueDate?.toDate?.() ? goal.dueDate.toDate()
      : goal.dueDate ? new Date(goal.dueDate)
      : goal.createdAt?.toDate?.() ? goal.createdAt.toDate()
      : goal.createdAt ? new Date(goal.createdAt)
      : null;

    if (!refDate || refDate > twoWeeksAgo) continue;

    const recipientId = goal.ownerId || goal.createdByUserId;
    if (!recipientId) continue;

    ops.push(goalDoc.ref.update({
      goalOverdueSent: true,
      updatedAt: admin.firestore.Timestamp.now(),
    }));
    ops.push(db.collection('notifications').add({
      userId: recipientId,
      type: 'goal_overdue',
      title: `⚠️ Objektiv i Vonuar: "${goal.title || 'Pa titull'}"`,
      message: `Ky objektiv ka kaluar afatin prej më shumë se 2 javësh dhe ende nuk është arritur.`,
      isRead: false,
      actionUrl: '/app/goals',
      actionLabel: 'Shiko Objektivat',
      createdAt: admin.firestore.Timestamp.now(),
    }));
    notified++;
  }

  await Promise.allSettled(ops);
  return { notified };
}

// ── Main handler ──────────────────────────────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!authorize(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const job = req.query.job as string;

  try {
    let result: Record<string, unknown>;

    switch (job) {
      case 'task-deadline-alerts':
        result = await runTaskDeadlineAlerts();
        break;
      case 'invoice-reminders':
        result = await runInvoiceReminders();
        break;
      case 'recurring-tasks':
        result = await runRecurringTasks();
        break;
      case 'recurring-invoices':
        result = await runRecurringInvoices();
        break;
      case 'project-completion-reminder':
        result = await runProjectCompletionReminder();
        break;
      case 'recurring-project-reset':
        result = await runRecurringProjectReset();
        break;
      case 'goal-overdue-alerts':
        result = await runGoalOverdueAlerts();
        break;
      case 'recurring-expenses':
        result = await runRecurringExpenses();
        break;
      case 'expire-invitations':
        result = await runExpireInvitations();
        break;
      default:
        return res.status(400).json({ error: `Job i panjohur: "${job}". Vlerat e vlefshme: task-deadline-alerts, invoice-reminders, recurring-tasks, recurring-invoices, project-completion-reminder, recurring-project-reset` });
    }

    return res.status(200).json({ success: true, job, ...result, timestamp: new Date().toISOString() });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Gabim i panjohur';
    console.error(`[CRON] Gabim në job "${job}":`, err);
    return res.status(500).json({ error: msg, job });
  }
}
