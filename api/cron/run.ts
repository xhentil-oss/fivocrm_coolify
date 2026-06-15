import type { VercelRequest, VercelResponse } from '@vercel/node';
import nodemailer from 'nodemailer';
import { buildInvoiceEmail } from '../_invoiceEmail.js';
import admin, { adminDb as db, adminMessaging, adminAuth } from '../_firebaseAdmin.js';
import { runWhmcsSync, runWhmcsClientSync } from '../_whmcsSync.js';

// ── Auth helper ───────────────────────────────────────────────────────────────
function authorize(req: VercelRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;
  return !!(cronSecret && req.headers.authorization === `Bearer ${cronSecret}`);
}

// Manual admin trigger: verify Firebase ID token + admin role
// Returns null on success, or an error string describing why auth failed.
async function authorizeManual(req: VercelRequest): Promise<string | null> {
  const authHeader = req.headers.authorization as string;
  if (!authHeader?.startsWith('Bearer ')) return 'Missing Authorization header';
  const token = authHeader.slice(7);
  let uid: string;
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    uid = decoded.uid;
  } catch (err: any) {
    const msg = err?.message || String(err);
    console.error('[manual-auth] verifyIdToken failed:', msg);
    return `Token invalid: ${msg}`;
  }
  try {
    const snap = await db.collection('teamMembers')
      .where('userId', '==', uid)
      .limit(10)
      .get();
    if (snap.empty) {
      console.warn(`[manual-auth] No teamMember for uid=${uid}`);
      return `No team membership for uid=${uid}`;
    }
    const roles = snap.docs.map(d => d.data().role as string);
    console.log(`[manual-auth] uid=${uid} roles=[${roles.join(', ')}]`);
    // Accept Admin OR Owner — matches the Settings tab gating (isAdmin || isOwner).
    if (!roles.some(r => r === 'Admin' || r === 'Owner')) {
      return `Role not Admin/Owner (found: ${roles.join(', ')})`;
    }
    return null; // authorized
  } catch (err: any) {
    const msg = err?.message || String(err);
    console.error('[manual-auth] Firestore query failed:', msg);
    return `Firestore error: ${msg}`;
  }
}

// ── settleAll: Promise.allSettled with error logging ─────────────────────────
async function settleAll(ops: Promise<any>[], jobName: string): Promise<void> {
  const results = await Promise.allSettled(ops);
  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      console.error(`[CRON:${jobName}] op[${i}] dështoi:`, r.reason);
    }
  });
}

// ── Notification preferences helpers ──────────────────────────────────────────
async function getUserPrefs(userId: string): Promise<any> {
  try {
    const d = await db.collection('userPreferences').doc(userId).get();
    return d.exists ? (d.data() as any) : {};
  } catch { return {}; }
}

// True when the current time falls inside the user's Do-Not-Disturb window.
function isDndActive(prefs: any): boolean {
  if (!prefs?.dndEnabled || !prefs?.dndStart || !prefs?.dndEnd) return false;
  const now = new Date();
  const cur = now.getUTCHours() * 60 + now.getUTCMinutes();
  const [sh, sm] = String(prefs.dndStart).split(':').map(Number);
  const [eh, em] = String(prefs.dndEnd).split(':').map(Number);
  const s = sh * 60 + sm;
  const e = eh * 60 + em;
  return s <= e ? (cur >= s && cur < e) : (cur >= s || cur < e); // overnight window
}

// ── sendPush: send FCM push to a user if they have a registered token ─────────
// Pass `prefs` to avoid a duplicate userPreferences read when the caller already has it.
async function sendPush(userId: string, title: string, body: string, data?: Record<string, string>, prefs?: any): Promise<void> {
  try {
    // Respect Do Not Disturb + the push channel toggle from userPreferences
    const p = prefs ?? await getUserPrefs(userId);
    if (p?.pushEnabled === false) return;
    if (isDndActive(p)) return;

    const tokenDoc = await db.collection('userPushTokens').doc(userId).get();
    if (!tokenDoc.exists) return;
    const token = tokenDoc.data()?.token;
    if (!token) return;
    await adminMessaging.send({
      token,
      notification: { title, body },
      data: data || {},
      android: { priority: 'high' },
      webpush: { notification: { icon: '/icon-192.png' }, fcmOptions: { link: data?.url || '/' } },
    });
  } catch (err) {
    console.error(`[Push] dërgimi për ${userId} dështoi:`, err);
  }
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

  // Fetch tasks not yet fully alerted. We use TWO stage flags so a task that was
  // alerted as "due soon" still gets a fresh "overdue" alert once it passes its
  // deadline (the old single `dueNotificationSent` flag suppressed that). Legacy
  // tasks (missing overdueNotificationSent) are caught for a one-time overdue alert.
  const tasksSnap = await db.collection('tasks').get();
  let notified = 0;
  const ops: Promise<any>[] = [];

  for (const doc of tasksSnap.docs) {
    const task = doc.data();
    if (!task.endDate || task.status === 'Done') continue;
    const recipientId = task.assignedToUserId || task.createdByUserId;
    if (!recipientId) continue;
    const endDate: Date = task.endDate?.toDate ? task.endDate.toDate() : new Date(task.endDate);
    if (isNaN(endDate.getTime())) continue;

    const isOverdue = endDate < now;
    const isDueSoon = endDate <= alertThreshold;
    if (!isOverdue && !isDueSoon) continue;

    const dueSent = task.dueNotificationSent === true;
    const overdueSent = task.overdueNotificationSent === true;
    // Decide which alert (if any) is owed: overdue takes priority and fires once
    // even if a due-soon alert was already sent.
    let stage: 'overdue' | 'due_soon' | null = null;
    if (isOverdue && !overdueSent) stage = 'overdue';
    else if (isDueSoon && !isOverdue && !dueSent) stage = 'due_soon';
    if (!stage) continue;

    const daysLeft = Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    const overdueByDays = Math.abs(daysLeft);
    const isOverdueAlert = stage === 'overdue';
    const notifTitle = isOverdueAlert ? `⚠️ Detyrë e skaduara: ${task.title}` : `⏰ Afati afrohet: ${task.title}`;
    const notifMessage = isOverdueAlert
      ? `Detyra "${task.title}" ka kaluar afatin prej ${overdueByDays} ditë.`
      : `Detyra "${task.title}" skadon ${daysLeft === 0 ? 'sot' : `për ${daysLeft} ditë`}.`;

    // In-app notification is always stored (the bell respects category mutes itself).
    ops.push(db.collection('notifications').add({ userId: recipientId, type: isOverdueAlert ? 'task_overdue' : 'task_due_soon', title: notifTitle, message: notifMessage, isRead: false, actionUrl: '/app/tasks', actionLabel: 'Shiko Detyrat', createdAt: admin.firestore.Timestamp.now() }));
    // Mark the stage(s) consumed. An overdue alert also implies due-soon is done.
    ops.push(doc.ref.update(isOverdueAlert ? { dueNotificationSent: true, overdueNotificationSent: true } : { dueNotificationSent: true }));

    // Push + email respect the user's channel toggles + Do-Not-Disturb window.
    const prefs = await getUserPrefs(recipientId);
    ops.push(sendPush(recipientId, notifTitle, notifMessage, undefined, prefs));

    if (transporter && smtpUser && prefs?.emailEnabled !== false && !isDndActive(prefs)) {
      try {
        const userRecord = await admin.auth().getUser(recipientId);
        if (userRecord.email) {
          ops.push(transporter.sendMail({ from: `"FivoCRM" <${smtpUser}>`, to: userRecord.email, subject: notifTitle, html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;"><h2 style="color:${isOverdueAlert ? '#ef4444' : '#f59e0b'}">${notifTitle}</h2><p>${notifMessage}</p><p style="color:#9ca3af;font-size:12px">FivoCRM – Njoftime automatike</p></div>` }));
        }
      } catch { /* skip */ }
    }
    notified++;
  }

  await settleAll(ops, 'task-deadline-alerts');
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

  const [pendingSnap, partialSnap] = await Promise.all([
    db.collection('invoices').where('status', '==', 'Pending').get(),
    db.collection('invoices').where('status', '==', 'Partial').get(),
  ]);
  const invoiceDocs = [...pendingSnap.docs, ...partialSnap.docs];
  let overdueMarked = 0, remindersSent = 0, reminder25Sent = 0, reminderLastDaySent = 0;
  const ops: Promise<any>[] = [];

  for (const doc of invoiceDocs) {
    const invoice = doc.data();
    if (!invoice.dueDate) continue;
    const dueDate: Date = invoice.dueDate.toDate ? invoice.dueDate.toDate() : new Date(invoice.dueDate);
    const invoiceLabel = invoice.invoiceNumber || doc.id.slice(0, 8).toUpperCase();

    if (dueDate < now) {
      ops.push(doc.ref.update({ status: 'Overdue', updatedAt: admin.firestore.Timestamp.now() }));
      overdueMarked++;
      if (invoice.createdByUserId) {
        const ovTitle = `🔴 Faturë e skaduara: #${invoiceLabel}`;
        const ovMsg = `Fatura #${invoiceLabel} ka kaluar afatin e pagesës.`;
        ops.push(db.collection('notifications').add({ userId: invoice.createdByUserId, type: 'invoice_overdue', title: ovTitle, message: ovMsg, isRead: false, actionUrl: '/app/invoices', actionLabel: 'Shiko Faturat', createdAt: admin.firestore.Timestamp.now() }));
        ops.push(sendPush(invoice.createdByUserId, ovTitle, ovMsg));
      }
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
      if (invoice.createdByUserId) ops.push(db.collection('notifications').add({ userId: invoice.createdByUserId, type: 'invoice_reminder_sent', title: `📧 Kujtesë u dërgua: Fatura #${invoiceLabel}`, message: `Kujtesa e pagesës u dërgua te klienti.`, isRead: false, actionUrl: '/app/invoices', actionLabel: 'Shiko Faturat', createdAt: admin.firestore.Timestamp.now() }));
    }
  }
  await settleAll(ops, 'invoice-reminders');

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
    await settleAll(reminderOps, 'invoice-reminders-recurring');
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
    // Skip if frontend already created the next cycle ("after completion" model)
    if (task.nextCycleCreated) continue;
    // Skip if the task hasn't been completed yet — no pile-up of duplicates
    if (task.status !== 'Done') continue;
    const nextRecurringDate: Date = task.nextRecurringDate?.toDate ? task.nextRecurringDate.toDate() : new Date(task.nextRecurringDate);
    if (isNaN(nextRecurringDate.getTime()) || nextRecurringDate > now) continue;
    if (!task.startDate || !task.endDate) continue;
    const startDate: Date = task.startDate?.toDate ? task.startDate.toDate() : new Date(task.startDate);
    const endDate: Date = task.endDate?.toDate ? task.endDate.toDate() : new Date(task.endDate);
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) continue;

    const newStart = addFrequency(startDate, task.recurringFrequency, task.recurringDayOfWeek, task.recurringDayOfMonth, task.recurringInterval, task.recurringDaysOfWeek);
    const newEnd = addFrequency(endDate, task.recurringFrequency, task.recurringDayOfWeek, task.recurringDayOfMonth, task.recurringInterval, task.recurringDaysOfWeek);
    const newNext = addFrequency(nextRecurringDate, task.recurringFrequency, task.recurringDayOfWeek, task.recurringDayOfMonth, task.recurringInterval, task.recurringDaysOfWeek);

    // Create new task ref first so we can reference its ID in the notification
    const newTaskRef = db.collection('tasks').doc();
    ops.push(newTaskRef.set({ title: task.title, description: task.description ?? null, status: 'Todo', priority: task.priority ?? null, projectId: task.projectId ?? null, assignedToUserId: task.assignedToUserId ?? null, startDate: admin.firestore.Timestamp.fromDate(newStart), endDate: admin.firestore.Timestamp.fromDate(newEnd), isRecurring: true, recurringFrequency: task.recurringFrequency, recurringInterval: task.recurringInterval ?? 1, recurringDayOfWeek: task.recurringDayOfWeek ?? null, recurringDayOfMonth: task.recurringDayOfMonth ?? null, recurringDaysOfWeek: task.recurringDaysOfWeek ?? null, nextRecurringDate: admin.firestore.Timestamp.fromDate(newNext), nextCycleCreated: false, dueNotificationSent: false, parentTaskId: task.parentTaskId ?? null, createdByUserId: task.createdByUserId ?? null, teamId: task.teamId ?? null, createdAt: admin.firestore.Timestamp.now(), updatedAt: admin.firestore.Timestamp.now() }));
    ops.push(doc.ref.update({ nextCycleCreated: true, nextRecurringDate: admin.firestore.Timestamp.fromDate(newNext), updatedAt: admin.firestore.Timestamp.now() }));
    const notifRecipient = task.assignedToUserId || task.createdByUserId;
    if (notifRecipient) {
      const freqLabel: Record<string, string> = { daily: 'ditore', weekly: 'javore', monthly: 'mujore', yearly: 'vjetore' };
      const taskUrl = task.projectId
        ? `/app/projects/${task.projectId}?task=${newTaskRef.id}`
        : `/app/tasks`;
      ops.push(db.collection('notifications').add({ userId: notifRecipient, type: 'recurring_task_created', title: `🔄 Detyrë e re periodike: ${task.title}`, message: `Detyra periodike "${task.title}" (${freqLabel[task.recurringFrequency] ?? task.recurringFrequency}) u krijua automatikisht.`, isRead: false, actionUrl: taskUrl, actionLabel: 'Hap Detyrën', createdAt: admin.firestore.Timestamp.now() }));
    }
    created++;
  }

  await settleAll(ops, 'recurring-tasks');
  return { created };
}

// ── helpers for recurring-invoices ───────────────────────────────────────────
function nextInvoiceDueDate(fromDate: Date, frequency: string): Date {
  // Preserve the original day-of-month, only clamp when it overflows the target month.
  // Strategy: set day=1 before advancing month to avoid JS date-overflow (e.g. Jan 31 + 1 month = March 3),
  // then restore the original day clamped to the last valid day of the target month.
  const originalDay = fromDate.getDate();
  const d = new Date(fromDate);
  d.setDate(1); // prevent overflow during month advance

  if (frequency === 'weekly') {
    // Weekly doesn't need day-preservation logic — just add 7 days from original
    const w = new Date(fromDate);
    w.setDate(w.getDate() + 7);
    return w;
  } else if (frequency === 'monthly') {
    d.setMonth(d.getMonth() + 1);
  } else if (frequency === 'quarterly') {
    d.setMonth(d.getMonth() + 3);
  } else if (frequency === 'yearly') {
    d.setFullYear(d.getFullYear() + 1);
  } else {
    d.setMonth(d.getMonth() + 1);
  }

  // Restore original day, clamped to the last valid day of the target month
  const lastDayOfMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(originalDay, lastDayOfMonth));
  return d;
}

// ── JOB: recurring-invoices ──────────────────────────────────────────────────
async function runRecurringInvoices() {
  const transporter = makeTransporter();
  const smtpUser = process.env.SMTP_USER;
  const now = new Date();
  let created = 0, skipped = 0;
  const ops: Promise<any>[] = [];

  // ── Part 1: Invoice-based recurrence (user-created recurring invoices) ──────
  const invoicesSnap = await db.collection('invoices').where('isRecurring', '==', true).get();

  for (const doc of invoicesSnap.docs) {
    const invoice = doc.data();
    // Skip auto-generated children — only parent originals drive recurrence
    if (invoice.autoGenerated) { skipped++; continue; }
    if (!invoice.nextRecurringDate || !invoice.recurringFrequency) { skipped++; continue; }
    // Skip paused recurring invoices
    if (invoice.isRecurringPaused) { skipped++; continue; }

    const nextDate: Date = invoice.nextRecurringDate?.toDate ? invoice.nextRecurringDate.toDate() : new Date(invoice.nextRecurringDate);
    if (isNaN(nextDate.getTime()) || nextDate > now) { skipped++; continue; }

    // Idempotency: skip if a child was already created after the last trigger date
    const existingChildSnap = await db.collection('invoices')
      .where('parentInvoiceId', '==', doc.id)
      .where('autoGenerated', '==', true)
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get();
    if (!existingChildSnap.empty) {
      const lastChildCreatedAt: Date = existingChildSnap.docs[0].data().createdAt?.toDate
        ? existingChildSnap.docs[0].data().createdAt.toDate()
        : new Date(existingChildSnap.docs[0].data().createdAt);
      if (lastChildCreatedAt >= nextDate) { skipped++; continue; }
    }

    const freq: string = invoice.recurringFrequency;
    const newDueDate = nextInvoiceDueDate(nextDate, freq);
    // Next trigger = newDueDate (i.e. generate again when that period ends)
    const nextTrigger = new Date(newDueDate);

    // Use the scheduled date (nextDate) for invoice numbering & invoiceDate,
    // NOT today — keeps periodic invoices aligned with their planned schedule
    // even if the cron runs late or is triggered manually.
    const scheduledYear = nextDate.getFullYear();
    const scheduledMonth = nextDate.getMonth();
    const invoiceNumber = `REC-${scheduledYear}-${String(scheduledMonth + 1).padStart(2, '0')}-${doc.id.slice(0, 6).toUpperCase()}`;
    const newInvoiceRef = db.collection('invoices').doc();

    ops.push(newInvoiceRef.set({
      invoiceNumber,
      customerId: invoice.customerId || null,
      projectId: invoice.projectId || null,
      teamId: invoice.teamId || null,
      amount: invoice.amount || 0,
      subtotal: invoice.subtotal || 0,
      total: invoice.total || 0,
      tax: invoice.tax || 0,
      discount: invoice.discount || 0,
      // 'percentage' is not a valid value — frontend uses 'fixed' | 'percent'
      discountType: invoice.discountType === 'percent' ? 'percent' : 'fixed',
      currency: invoice.currency || 'ALL',
      paymentMethod: invoice.paymentMethod || null,
      bankName: invoice.bankName || null,
      bankIBAN: invoice.bankIBAN || null,
      bankSWIFT: invoice.bankSWIFT || null,
      bankAccountHolder: invoice.bankAccountHolder || null,
      bankCountry: invoice.bankCountry || null,
      notes: invoice.notes || null,
      status: 'Pending',
      invoiceDate: admin.firestore.Timestamp.fromDate(nextDate),
      dueDate: admin.firestore.Timestamp.fromDate(newDueDate),
      isRecurring: false,   // children don't recurse — parent drives the cycle
      autoGenerated: true,
      parentInvoiceId: doc.id,
      emailSent: false,
      reminderSent: false,
      reminder25Sent: false,
      reminderLastDaySent: false,
      createdByUserId: invoice.createdByUserId || null,
      createdAt: admin.firestore.Timestamp.now(),
      updatedAt: admin.firestore.Timestamp.now(),
    }));

    // Copy line items from parent (preserve serviceId so analytics stay linked)
    const itemsSnap = await db.collection('invoiceItems').where('invoiceId', '==', doc.id).get();
    for (const itemDoc of itemsSnap.docs) {
      const item = itemDoc.data();
      ops.push(db.collection('invoiceItems').doc().set({
        invoiceId: newInvoiceRef.id,
        serviceId: item.serviceId || null,
        description: item.description || '',
        quantity: item.quantity || 1,
        unitPrice: item.unitPrice || 0,
        totalPrice: item.totalPrice || 0,
        teamId: item.teamId || null,
        createdAt: admin.firestore.Timestamp.now(),
        updatedAt: admin.firestore.Timestamp.now(),
      }));
    }

    // Advance nextRecurringDate on parent
    ops.push(doc.ref.update({
      nextRecurringDate: admin.firestore.Timestamp.fromDate(nextTrigger),
      updatedAt: admin.firestore.Timestamp.now(),
    }));

    // Send invoice email to customer
    if (transporter && smtpUser && invoice.customerId) {
      try {
        const customerDoc = await db.collection('customers').doc(invoice.customerId).get();
        const customer = customerDoc.data();
        if (customer?.email) {
          let projectName = 'Shërbim';
          if (invoice.projectId) {
            const projDoc = await db.collection('projects').doc(invoice.projectId).get();
            if (projDoc.exists) projectName = projDoc.data()?.name || projectName;
          }
          const { subject, html } = buildInvoiceEmail({
            customerName: customer.name || 'Klient',
            invoiceNumber,
            amount: invoice.total || invoice.amount || 0,
            dueDate: newDueDate,
            projectName,
            type: 'initial',
            currency: invoice.currency || 'ALL',
            paymentMethod: invoice.paymentMethod,
            bankName: invoice.bankName,
            bankIBAN: invoice.bankIBAN,
            bankSWIFT: invoice.bankSWIFT,
            bankAccountHolder: invoice.bankAccountHolder,
            bankCountry: invoice.bankCountry,
          });
          ops.push(transporter.sendMail({
            from: `"FivoCRM" <${smtpUser}>`,
            to: customer.email,
            subject,
            html,
          }).then(() => newInvoiceRef.update({ emailSent: true, updatedAt: admin.firestore.Timestamp.now() })));
        }
      } catch { /* skip email on error */ }
    }

    // Notification to creator
    if (invoice.createdByUserId) {
      const freqLabel: Record<string, string> = { weekly: 'javore', monthly: 'mujore', quarterly: 'tremujore', yearly: 'vjetore' };
      ops.push(db.collection('notifications').add({
        userId: invoice.createdByUserId,
        type: 'auto_invoice_created',
        title: `🧾 Faturë e re periodike: #${invoiceNumber}`,
        message: `Fatura ${freqLabel[freq] || freq} u gjenerua automatikisht (${(invoice.total || invoice.amount || 0).toLocaleString('sq-AL')} ${invoice.currency || 'ALL'}).`,
        isRead: false,
        actionUrl: '/app/invoices',
        actionLabel: 'Shiko Faturat',
        createdAt: admin.firestore.Timestamp.now(),
      }));
    }

    created++;
  }

  await settleAll(ops, 'recurring-invoices');

  // ── Part 2: Legacy project-based recurrence (backwards compatibility) ────────
  const legacyOps: Promise<any>[] = [];
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();
  const legacyDueDate = new Date(currentYear, currentMonth + 1, 0);

  const projectsSnap = await db.collection('projects').where('isRecurring', '==', true).get();
  let legacyCreated = 0;

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

    legacyOps.push(invoiceRef.set({ invoiceNumber: invoiceLabel, projectId: projectDoc.id, customerId: project.customerId || null, teamId: project.teamId || null, amount: budget, subtotal: budget, total: budget, tax: 0, discount: 0, discountType: 'fixed', currency: project.currency || 'ALL', status: 'Pending', notes: `Faturë e gjeneruar automatikisht për projektin periodik "${project.name}" – ${monthName}.`, invoiceDate: admin.firestore.Timestamp.now(), dueDate: admin.firestore.Timestamp.fromDate(legacyDueDate), isRecurring: false, autoGenerated: true, emailSent: false, reminderSent: false, reminder25Sent: false, reminderLastDaySent: false, createdByUserId: project.createdByUserId || null, createdAt: admin.firestore.Timestamp.now(), updatedAt: admin.firestore.Timestamp.now() }));
    legacyOps.push(db.collection('invoiceItems').doc().set({ invoiceId: invoiceRef.id, description: `${project.name} – shërbime mujore`, quantity: 1, unitPrice: budget, totalPrice: budget, teamId: project.teamId || null, createdAt: admin.firestore.Timestamp.now(), updatedAt: admin.firestore.Timestamp.now() }));

    if (transporter && smtpUser && project.customerId) {
      try {
        const customerDoc = await db.collection('customers').doc(project.customerId).get();
        const customer = customerDoc.data();
        if (customer?.email) {
          const { subject, html } = buildInvoiceEmail({ customerName: customer.name || 'Klient', invoiceNumber: invoiceLabel, amount: budget, dueDate: legacyDueDate, projectName: project.name, type: 'initial', currency: project.currency || 'ALL', paymentMethod: project.paymentMethod, bankName: project.bankName, bankIBAN: project.bankIBAN, bankSWIFT: project.bankSWIFT, bankAccountHolder: project.bankAccountHolder, bankCountry: project.bankCountry });
          legacyOps.push(transporter.sendMail({ from: `"FivoCRM" <${smtpUser}>`, to: customer.email, subject, html }).then(() => invoiceRef.update({ emailSent: true, updatedAt: admin.firestore.Timestamp.now() })));
        }
      } catch { /* skip */ }
    }

    legacyOps.push(projectDoc.ref.update({ lastInvoiceGeneratedAt: admin.firestore.Timestamp.now(), updatedAt: admin.firestore.Timestamp.now() }));
    if (project.createdByUserId) legacyOps.push(db.collection('notifications').add({ userId: project.createdByUserId, type: 'auto_invoice_created', title: `🧾 Faturë e re automatike: ${project.name}`, message: `Fatura #${invoiceLabel} (${budget.toLocaleString('sq-AL')} L) u gjenerua automatikisht.`, isRead: false, createdAt: admin.firestore.Timestamp.now() }));

    legacyCreated++;
  }

  await settleAll(legacyOps, 'recurring-invoices-legacy');
  return { created, legacyCreated, skipped };
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

  await settleAll(ops, 'project-completion-reminder');
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
    if (project.responsibleUserId) ops.push(db.collection('notifications').add({ userId: project.responsibleUserId, type: 'project_cycle_reset', title: `🔄 Projekti "${project.name}" u riaktivizua`, message: `Cikli i ri ka filluar. Të gjitha detyrat janë rivendosur te "Për të bërë".`, isRead: false, actionUrl: '/app/projects', actionLabel: 'Shiko Projektet', createdAt: admin.firestore.Timestamp.now() }));
    resetCount++;
  }

  await settleAll(ops, 'recurring-project-reset');
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

  await settleAll(ops, 'recurring-expenses');
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

  await settleAll(ops, 'expire-invitations');
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
    const goalTitle = `⚠️ Objektiv i Vonuar: "${goal.title || 'Pa titull'}"`;
    const goalMsg = `Ky objektiv ka kaluar afatin prej më shumë se 2 javësh dhe ende nuk është arritur.`;
    ops.push(db.collection('notifications').add({
      userId: recipientId,
      type: 'goal_overdue',
      title: goalTitle,
      message: goalMsg,
      isRead: false,
      actionUrl: '/app/goals',
      actionLabel: 'Shiko Objektivat',
      createdAt: admin.firestore.Timestamp.now(),
    }));
    ops.push(sendPush(recipientId, goalTitle, goalMsg));
    notified++;
  }

  await settleAll(ops, 'goal-overdue-alerts');
  return { notified };
}

// ── JOB: lead-follow-up-reminders ────────────────────────────────────────────
async function runLeadFollowUpReminders() {
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  // 23-hour debounce: don't re-notify if we already notified today
  const twentyThreeHoursAgo = new Date(now.getTime() - 23 * 60 * 60 * 1000);

  const leadsSnap = await db.collection('leads').get();
  if (leadsSnap.empty) return { notified: 0 };

  let notified = 0;
  let waSent = 0;
  const ops: Promise<any>[] = [];

  // Per-run caches so we read each team's settings / template only once.
  const tsCache = new Map<string, any>();
  const tplCache = new Map<string, any>();
  const getTeamSettings = async (teamId: string) => {
    if (!teamId) return null;
    if (tsCache.has(teamId)) return tsCache.get(teamId);
    const doc = await db.collection('teamSettings').doc(teamId).get();
    const data = doc.exists ? doc.data() : null;
    tsCache.set(teamId, data);
    return data;
  };
  const getTemplate = async (id: string) => {
    if (!id) return null;
    if (tplCache.has(id)) return tplCache.get(id);
    const doc = await db.collection('waTemplates').doc(id).get();
    const data = doc.exists ? doc.data() : null;
    tplCache.set(id, data);
    return data;
  };

  for (const leadDoc of leadsSnap.docs) {
    const lead = leadDoc.data();

    if (!lead.nextFollowUpDate) continue;
    if (lead.status === 'Won' || lead.status === 'Lost') continue;

    const followUpDate: Date = lead.nextFollowUpDate?.toDate?.()
      ? lead.nextFollowUpDate.toDate()
      : new Date(lead.nextFollowUpDate);
    followUpDate.setHours(0, 0, 0, 0);

    // Only trigger for today or overdue
    if (followUpDate > todayStart) continue;

    // Debounce: skip if already notified in the last 23h
    if (lead.lastReminderSentAt) {
      const lastSent: Date = lead.lastReminderSentAt?.toDate?.()
        ? lead.lastReminderSentAt.toDate()
        : new Date(lead.lastReminderSentAt);
      if (lastSent >= twentyThreeHoursAgo) continue;
    }

    const assignedUserId = lead.assignedToUserId || lead.createdByUserId;
    if (!assignedUserId) continue;

    const isOverdue = followUpDate < todayStart;
    const dateLabel = isOverdue
      ? `Vonuar (${followUpDate.toLocaleDateString('sq-AL')})`
      : 'Sot';

    const followTitle = isOverdue ? `⚠ Rikontaktim i vonuar: ${lead.name}` : `🔔 Rikontaktim sot: ${lead.name}`;
    const followMsg = lead.followUpNote
      ? `${dateLabel} · ${lead.followUpNote}`
      : `${dateLabel} · Është koha të rikontaktoni këtë lead.`;

    ops.push(
      db.collection('notifications').add({
        userId: assignedUserId,
        type: 'lead_follow_up',
        title: followTitle,
        message: followMsg,
        isRead: false,
        actionType: 'link',
        actionUrl: '/app/crm',
        actionLabel: 'Shko tek CRM',
        createdAt: admin.firestore.Timestamp.now(),
      })
    );
    ops.push(sendPush(assignedUserId, followTitle, followMsg));

    // Update lastReminderSentAt to debounce future runs
    ops.push(
      leadDoc.ref.update({ lastReminderSentAt: admin.firestore.Timestamp.now() })
    );

    notified++;

    // Optional: send a WhatsApp follow-up template if the team enabled it.
    const phone = lead.phone || lead.phoneNumber;
    if (phone && lead.teamId) {
      const settings = await getTeamSettings(lead.teamId);
      if (settings?.waFollowUpEnabled && settings?.waFollowUpTemplateId && settings?.metaEnabled) {
        const tpl = await getTemplate(settings.waFollowUpTemplateId);
        const channels: any[] = settings.metaChannels || [];
        const channel = channels.find((c) => c.phoneNumberId === settings.waFollowUpChannelPhoneNumberId) || channels[0];
        if (tpl && channel?.accessToken && channel?.phoneNumberId) {
          const params: string[] = (tpl.paramFields || []).map((f: string) =>
            f && f !== 'custom' && lead[f] != null ? String(lead[f]) : ''
          );
          ops.push(
            sendMetaBroadcastMessage(channel, normalizeWaPhone(phone), tpl, params, lead.teamId, null, { id: leadDoc.id, name: lead.name })
              .catch((e) => console.error('[follow-up-wa]', e))
          );
          waSent++;
        }
      }
    }
  }

  await settleAll(ops, 'lead-follow-up-reminders');
  return { notified, waSent };
}

// ── JOB: notification-digest ─────────────────────────────────────────────────
async function runNotificationDigest() {
  const transporter = makeTransporter();
  const smtpUser = process.env.SMTP_USER;
  if (!transporter || !smtpUser) return { sent: 0, skipped: 'no SMTP config' };

  // Only send to users who have ≥3 unread notifications (avoid noise)
  const snap = await db.collection('notifications').where('isRead', '==', false).get();
  if (snap.empty) return { sent: 0 };

  // Group by userId
  const byUser = new Map<string, { title: string; message?: string; type?: string }[]>();
  for (const d of snap.docs) {
    const n = d.data();
    if (!n.userId) continue;
    const existing = byUser.get(n.userId) || [];
    existing.push({ title: n.title, message: n.message, type: n.type });
    byUser.set(n.userId, existing);
  }

  let sent = 0;
  const ops: Promise<any>[] = [];

  for (const [userId, notifs] of byUser) {
    if (notifs.length < 3) continue;

    // Check if digest already sent today
    const prefsDoc = await db.collection('userPreferences').doc(userId).get();
    const prefs = prefsDoc.exists ? prefsDoc.data() as any : {};
    if (prefs?.digestSentAt) {
      const last: Date = prefs.digestSentAt?.toDate ? prefs.digestSentAt.toDate() : new Date(prefs.digestSentAt);
      const dayAgo = new Date(Date.now() - 23 * 60 * 60 * 1000);
      if (last > dayAgo) continue;
    }

    try {
      const userRecord = await admin.auth().getUser(userId);
      if (!userRecord.email) continue;

      const criticalCount = notifs.filter(n => ['task_overdue', 'invoice_overdue', 'goal_overdue'].includes(n.type || '')).length;
      const listHtml = notifs.slice(0, 10).map(n =>
        `<li style="margin-bottom:6px"><strong>${n.title}</strong>${n.message ? `<br><span style="color:#6b7280;font-size:13px">${n.message}</span>` : ''}</li>`
      ).join('');
      const moreCount = notifs.length > 10 ? `<p style="color:#6b7280;font-size:13px">... dhe ${notifs.length - 10} njoftime të tjera</p>` : '';

      ops.push(transporter.sendMail({
        from: `"FivoCRM" <${smtpUser}>`,
        to: userRecord.email,
        subject: `📬 Digest i njoftimeve: ${notifs.length} të palexuara${criticalCount > 0 ? ` (${criticalCount} urgjente)` : ''}`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px">
            <h2 style="color:#667eea">📬 Njoftime të Palexuara</h2>
            <p>Keni <strong>${notifs.length}</strong> njoftime të palexuara${criticalCount > 0 ? `, nga të cilat <strong style="color:#ef4444">${criticalCount} janë urgjente</strong>` : ''}.</p>
            <ul style="padding-left:16px;line-height:1.6">${listHtml}</ul>
            ${moreCount}
            <a href="${process.env.VITE_APP_URL || 'https://app.fivoo.net'}/app" style="display:inline-block;margin-top:16px;padding:10px 20px;background:#667eea;color:white;border-radius:6px;text-decoration:none">Hap FivoCRM</a>
            <p style="color:#9ca3af;font-size:12px;margin-top:24px">FivoCRM – Digest ditor automatik</p>
          </div>
        `,
      }).then(() => {
        return db.collection('userPreferences').doc(userId).set(
          { digestSentAt: admin.firestore.Timestamp.now() },
          { merge: true }
        );
      }));
      sent++;
    } catch { /* skip user */ }
  }

  await settleAll(ops, 'notification-digest');
  return { sent };
}

// ── JOB: cleanup-old-notifications ───────────────────────────────────────────
async function runCleanupOldNotifications() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 60);
  const cutoffTs = admin.firestore.Timestamp.fromDate(cutoff);

  // Only delete read notifications older than 60 days (keep all unread)
  const snap = await db.collection('notifications')
    .where('isRead', '==', true)
    .where('createdAt', '<', cutoffTs)
    .get();

  if (snap.empty) return { deleted: 0 };

  let deleted = 0;
  const BATCH_SIZE = 400;
  const docs = snap.docs;

  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const chunk = docs.slice(i, i + BATCH_SIZE);
    for (const d of chunk) batch.delete(d.ref);
    await batch.commit();
    deleted += chunk.length;
  }

  console.log(`[CRON:cleanup-old-notifications] fshirë ${deleted} njoftime të vjetra`);
  return { deleted };
}

// ── JOB: whatsapp-broadcasts ─────────────────────────────────────────────────
// Template-only bulk sends via Meta Cloud API.  Idempotent & resumable: each
// send is logged to whatsappMessages tagged with broadcastId; already-sent
// phones are skipped, so re-runs continue where they left off.  Processes up to
// PER_RUN targets per broadcast per invocation (function-timeout safety).
function normalizeWaPhone(p: string): string {
  return (p || '').replace(/\D/g, '');
}

async function sendMetaBroadcastMessage(
  channel: any,
  phone: string,
  tpl: any,
  params: string[],
  teamId: string,
  broadcastId: string | null,
  lead: { id: string; name?: string }
): Promise<void> {
  const components = params.length
    ? [{ type: 'body', parameters: params.map((p) => ({ type: 'text', text: p && p.trim() ? p : '-' })) }]
    : [];
  const payload = {
    messaging_product: 'whatsapp',
    to: phone,
    type: 'template',
    template: {
      name: tpl.metaTemplateName,
      language: { code: tpl.language || 'sq' },
      ...(components.length ? { components } : {}),
    },
  };
  const resp = await fetch(`https://graph.facebook.com/v21.0/${channel.phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${channel.accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data: any = await resp.json().catch(() => ({}));
  const waMessageId = data?.messages?.[0]?.id || null;
  const ok = resp.ok && !!waMessageId;
  // Render a display body by filling {{n}} placeholders for the inbox.
  const display = (tpl.body || tpl.metaTemplateName || '').replace(/\{\{(\d+)\}\}/g, (_m: string, n: string) => params[Number(n) - 1] || `{{${n}}}`);
  await db.collection('whatsappMessages').add({
    phone,
    jid: `${phone}@s.whatsapp.net`,
    direction: 'outbound',
    message: display,
    leadId: lead.id,
    leadName: lead.name || null,
    teamId,
    status: ok ? 'sent' : 'failed',
    channel: 'meta',
    channelPhone: channel.phone || null,
    metaPhoneNumberId: channel.phoneNumberId,
    isTemplate: true,
    templateName: tpl.metaTemplateName,
    ...(broadcastId ? { broadcastId } : {}),
    waMessageId,
    createdAt: admin.firestore.Timestamp.now(),
    updatedAt: admin.firestore.Timestamp.now(),
  });
  if (!ok) {
    throw new Error(`Meta send failed for ${phone}: ${data?.error?.message || resp.status}`);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Render a template body's {{n}} placeholders with the given params (free text,
// used for Baileys which has no template concept).
function renderTemplateBody(body: string, params: string[]): string {
  return (body || '').replace(/\{\{(\d+)\}\}/g, (_m, n: string) => params[Number(n) - 1] || '');
}

// Send one Baileys broadcast message via the team's VPS /send endpoint.  The
// VPS writes its own whatsappMessages doc (channel:'baileys'), so we don't.
// Returns true on success.
async function sendBaileysBroadcastMessage(
  vpsUrl: string,
  vpsSecret: string,
  agentId: string,
  phone: string,
  message: string,
  teamId: string,
  lead: { id: string; name?: string }
): Promise<boolean> {
  try {
    const resp = await fetch(`${vpsUrl.replace(/\/$/, '')}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': vpsSecret },
      body: JSON.stringify({ to: phone, message, teamId, agentId, leadId: lead.id, leadName: lead.name || null }),
      signal: AbortSignal.timeout(15_000),
    });
    return resp.ok;
  } catch (e) {
    console.error('[broadcast-baileys] send failed', e);
    return false;
  }
}

async function runWhatsappBroadcasts() {
  const PER_RUN_META = 200;     // Meta: high throughput, parallel, safe
  const PER_RUN_BAILEYS = 8;    // Baileys: tiny batch + paced to limit ban risk
  const now = new Date();
  const snap = await db.collection('waBroadcasts')
    .where('status', 'in', ['queued', 'sending'])
    .get();

  let processed = 0;
  let sent = 0;

  for (const bDoc of snap.docs) {
    const b = bDoc.data() as any;
    try {
      // Respect scheduling.
      if (b.scheduledAt?.toDate && b.scheduledAt.toDate() > now) continue;

      const tplDoc = await db.collection('waTemplates').doc(b.templateId).get();
      if (!tplDoc.exists) { await bDoc.ref.update({ status: 'failed', error: 'Template mungon', updatedAt: now }); continue; }
      const tpl = tplDoc.data() as any;

      const tsDoc = await db.collection('teamSettings').doc(b.teamId).get();
      const settings = (tsDoc.data() as any) || {};
      const useBaileys = b.channel === 'baileys';

      // Resolve channel credentials up front.
      let metaChannel: any = null;
      let vpsUrl = '';
      let vpsSecret = '';
      if (useBaileys) {
        vpsUrl = settings.whatsappVpsUrl || '';
        vpsSecret = settings.whatsappVpsSecret || '';
        if (!vpsUrl || !vpsSecret || !b.agentId) {
          await bDoc.ref.update({ status: 'failed', error: 'Konfigurimi i Baileys/VPS mungon', updatedAt: now });
          continue;
        }
      } else {
        const channels: any[] = settings.metaChannels || [];
        metaChannel = channels.find((c) => c.phoneNumberId === b.channelPhoneNumberId) || channels[0];
        if (!metaChannel?.accessToken || !metaChannel?.phoneNumberId) {
          await bDoc.ref.update({ status: 'failed', error: 'Kanali Meta mungon', updatedAt: now });
          continue;
        }
      }

      // Resolve segment → recipients from leads and/or customers (filtered in
      // memory to avoid composite indexes), then merge + dedupe by phone.
      const seg = b.segment || {};
      const audience: string[] = seg.audience?.length ? seg.audience : ['leads'];
      const byPhone = new Map<string, { id: string; name?: string; phone: string; [k: string]: any }>();

      // Tag filtering (normalize array/comma-string; support ANY/ALL + legacy single tag).
      const wantTags: string[] = seg.tags?.length ? seg.tags : (seg.tag ? [seg.tag] : []);
      const tagMatchAll = seg.tagMatch === 'all';
      const entityTags = (e: any): string[] => {
        const t = e?.tags;
        if (Array.isArray(t)) return t.map((x: any) => String(x).trim()).filter(Boolean);
        if (typeof t === 'string') return t.split(',').map((s: string) => s.trim()).filter(Boolean);
        return [];
      };
      const matchesTags = (e: any): boolean => {
        if (!wantTags.length) return true;
        const et = entityTags(e);
        return tagMatchAll ? wantTags.every((t) => et.includes(t)) : wantTags.some((t) => et.includes(t));
      };

      if (audience.includes('leads')) {
        // Leads aren't team-isolated in this app (loaded app-wide with
        // skipTeamFilter, rules: read if isAuth), so include them all — matching
        // the /app/crm view — then narrow by the segment filters.
        const leadsSnap = await db.collection('leads').get();
        for (const d of leadsSnap.docs) {
          const l = d.data() as any;
          const rawPhone = l.phone || l.phoneNumber;
          if (!rawPhone) continue;
          if (seg.statuses?.length && !seg.statuses.includes(l.status)) continue;
          if (!matchesTags(l)) continue;
          if (seg.assignedToUserId && l.assignedToUserId !== seg.assignedToUserId) continue;
          const phone = normalizeWaPhone(rawPhone);
          if (phone.length >= 7 && !byPhone.has(phone)) byPhone.set(phone, { ...l, id: d.id, phone });
        }
      }
      if (audience.includes('customers')) {
        // Customers aren't team-isolated in this app (read: isAuth, no reliable
        // teamId), so we include them all — matching the /app/customers view.
        const custSnap = await db.collection('customers').get();
        for (const d of custSnap.docs) {
          const c = d.data() as any;
          if (!c.phone) continue;
          if (!matchesTags(c)) continue;
          if (seg.assignedToUserId && c.assignedToUserId !== seg.assignedToUserId) continue;
          const phone = normalizeWaPhone(c.phone);
          if (phone.length >= 7 && !byPhone.has(phone)) byPhone.set(phone, { ...c, id: d.id, phone });
        }
      }

      // Idempotency: skip recipients already sent (tracked on the broadcast doc,
      // channel-agnostic so it works for both Meta and Baileys).
      const alreadySent = new Set<string>((b.sentPhones || []).map((p: string) => normalizeWaPhone(p)));
      const total = byPhone.size;
      let targets = Array.from(byPhone.values()).filter((t) => !alreadySent.has(t.phone));

      const perRun = useBaileys ? PER_RUN_BAILEYS : PER_RUN_META;
      const batch = targets.slice(0, perRun);
      const succeeded: string[] = [];

      if (useBaileys) {
        // Sequential + randomized pacing to look human and respect the VPS
        // 30/min per-agent limit (reduces — does not eliminate — ban risk).
        for (const t of batch) {
          const phone = normalizeWaPhone(t.phone || t.phoneNumber);
          const params: string[] = (tpl.paramFields || []).map((f: string) =>
            f && f !== 'custom' && t[f] != null ? String(t[f]) : ''
          );
          const ok = await sendBaileysBroadcastMessage(
            vpsUrl, vpsSecret, b.agentId, phone, renderTemplateBody(tpl.body, params), b.teamId, { id: t.id, name: t.name }
          );
          if (ok) { succeeded.push(phone); sent++; }
          await sleep(1500 + Math.floor(Math.random() * 2500)); // 1.5–4s between sends
        }
      } else {
        // Meta: parallel template sends; collect the ones that succeeded.
        const results = await Promise.allSettled(
          batch.map((t) => {
            const phone = normalizeWaPhone(t.phone || t.phoneNumber);
            const params: string[] = (tpl.paramFields || []).map((f: string) =>
              f && f !== 'custom' && t[f] != null ? String(t[f]) : ''
            );
            return sendMetaBroadcastMessage(metaChannel, phone, tpl, params, b.teamId, bDoc.id, { id: t.id, name: t.name })
              .then(() => phone);
          })
        );
        for (const r of results) {
          if (r.status === 'fulfilled') { succeeded.push(r.value); sent++; }
        }
      }

      const newSentTotal = alreadySent.size + succeeded.length;
      const remaining = total - newSentTotal;
      await bDoc.ref.update({
        totalTargets: total,
        sentCount: newSentTotal,
        // arrayUnion requires ≥1 element — only include when something succeeded.
        ...(succeeded.length ? { sentPhones: admin.firestore.FieldValue.arrayUnion(...succeeded) } : {}),
        status: remaining > 0 ? 'sending' : 'completed',
        error: null,
        updatedAt: new Date(),
      });
      processed++;
    } catch (err: any) {
      console.error(`[CRON:whatsapp-broadcasts] broadcast ${bDoc.id} dështoi:`, err);
      await bDoc.ref.update({ status: 'failed', error: err?.message || 'Gabim', updatedAt: new Date() }).catch(() => {});
    }
  }

  return { processed, sent };
}

// ── Main handler ──────────────────────────────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const isManual = req.query.manual === '1';
  if (isManual) {
    const authError = await authorizeManual(req);
    if (authError) return res.status(401).json({ error: `Unauthorized: ${authError}` });
  } else {
    if (!authorize(req)) return res.status(401).json({ error: 'Unauthorized' });
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
      case 'lead-follow-up-reminders':
        result = await runLeadFollowUpReminders();
        break;
      case 'whatsapp-broadcasts':
        result = await runWhatsappBroadcasts();
        break;
      case 'whmcs-sync':
        result = await runWhmcsSync();
        break;
      case 'whmcs-clients':
        result = await runWhmcsClientSync();
        break;
      case 'cleanup-old-notifications':
        result = await runCleanupOldNotifications();
        break;
      case 'notification-digest':
        result = await runNotificationDigest();
        break;
      case 'run-all': {
        // Single daily cron that runs all jobs — works within Vercel Hobby 2-cron limit
        const [tasks, invoiceRem, recurTasks, recurInv, projCompl, projReset, goals, expenses, invites, leads, digest, waBroadcasts, whmcs] = await Promise.allSettled([
          runTaskDeadlineAlerts(),
          runInvoiceReminders(),
          runRecurringTasks(),
          runRecurringInvoices(),
          runProjectCompletionReminder(),
          runRecurringProjectReset(),
          runGoalOverdueAlerts(),
          runRecurringExpenses(),
          runExpireInvitations(),
          runLeadFollowUpReminders(),
          runNotificationDigest(),
          runWhatsappBroadcasts(),
          runWhmcsSync(),
        ]);
        const settled = (r: PromiseSettledResult<any>) =>
          r.status === 'fulfilled' ? r.value : { error: (r.reason as Error)?.message || 'failed' };
        result = {
          tasks: settled(tasks),
          invoiceReminders: settled(invoiceRem),
          recurringTasks: settled(recurTasks),
          recurringInvoices: settled(recurInv),
          projectCompletionReminder: settled(projCompl),
          projectReset: settled(projReset),
          goalAlerts: settled(goals),
          recurringExpenses: settled(expenses),
          invites: settled(invites),
          leadReminders: settled(leads),
          digest: settled(digest),
          whatsappBroadcasts: settled(waBroadcasts),
          whmcsSync: settled(whmcs),
        };
        break;
      }
      default:
        return res.status(400).json({ error: `Job i panjohur: "${job}". Vlerat e vlefshme: run-all, task-deadline-alerts, invoice-reminders, recurring-tasks, recurring-invoices, project-completion-reminder, recurring-project-reset, notification-digest, whatsapp-broadcasts, whmcs-sync, whmcs-clients` });
    }

    return res.status(200).json({ success: true, job, ...result, timestamp: new Date().toISOString() });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Gabim i panjohur';
    console.error(`[CRON] Gabim në job "${job}":`, err);
    return res.status(500).json({ error: msg, job });
  }
}
