import type { VercelRequest, VercelResponse } from '@vercel/node';
import nodemailer from 'nodemailer';
import { buildInvoiceEmail } from '../_invoiceEmail.js';
import admin, { adminDb as db, adminMessaging, adminAuth } from '../_firebaseAdmin.js';
import { runWhmcsSync, runWhmcsClientSync } from '../_whmcsSync.js';
import { sendBulkEmail, renderMergeTokens } from '../_mailer.js';

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
    const roles = snap.docs.map(d => d.data().role as string);
    console.log(`[manual-auth] uid=${uid} roles=[${roles.join(', ') || 'none'}]`);
    // Accept Admin OR Owner — matches the Settings tab gating (isAdmin || isOwner).
    if (roles.some(r => r === 'Admin' || r === 'Owner')) return null;
    // Fallback: a team OWNER (createdByUserId) is privileged even without an Admin
    // teamMember role (or any teamMember doc) — covers the agency super-admin.
    const ownedTeam = await db.collection('teams').where('createdByUserId', '==', uid).limit(1).get();
    if (!ownedTeam.empty) return null;
    return `Not Admin/Owner and owns no team (roles: ${roles.join(', ') || 'none'})`;
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

// ── JOB: overdue-reminders ───────────────────────────────────────────────────
// Emails the CUSTOMER about overdue invoices (weekly, unless the customer opted
// out via disableOverdueReminders), and escalates to WhatsApp once an invoice is
// more than waOverdueDays (default 60 ≈ 2 months) overdue.
async function runOverdueReminders() {
  const transporter = makeTransporter();
  const smtpUser = process.env.SMTP_USER;
  const now = Date.now();
  const ms = (v: any): number => (v?.toDate ? v.toDate().getTime() : (v ? new Date(v).getTime() : 0));
  const EMAIL_RENOTIFY_DAYS = 7;
  const WA_RENOTIFY_DAYS = 14;

  const snap = await db.collection('invoices').where('status', '==', 'Overdue').get();
  if (snap.empty) return { emailsSent: 0, waSent: 0 };

  const custCache = new Map<string, any>();
  const tsCache = new Map<string, any>();
  const tplCache = new Map<string, any>();
  const getCustomer = async (id: string) => {
    if (custCache.has(id)) return custCache.get(id);
    const d = await db.collection('customers').doc(id).get();
    const data = d.exists ? d.data() : null;
    custCache.set(id, data);
    return data;
  };
  const getTeamSettings = async (teamId: string) => {
    if (tsCache.has(teamId)) return tsCache.get(teamId);
    const d = await db.collection('teamSettings').doc(teamId).get();
    const data = d.exists ? d.data() : null;
    tsCache.set(teamId, data);
    return data;
  };
  const getTemplate = async (id: string) => {
    if (tplCache.has(id)) return tplCache.get(id);
    const d = await db.collection('waTemplates').doc(id).get();
    const data = d.exists ? d.data() : null;
    tplCache.set(id, data);
    return data;
  };

  let emailsSent = 0, waSent = 0;
  const ops: Promise<any>[] = [];

  for (const doc of snap.docs) {
    const inv = doc.data();
    if (!inv.customerId) continue;
    const customer = await getCustomer(inv.customerId);
    if (!customer || customer.disableOverdueReminders) continue; // opt-out

    const dueMs = ms(inv.dueDate);
    const daysOverdue = dueMs ? Math.floor((now - dueMs) / 86_400_000) : 0;
    const invoiceLabel = inv.invoiceNumber || doc.id.slice(0, 8).toUpperCase();

    // 1) Weekly overdue email to the customer
    const lastEmail = ms(inv.overdueEmailSentAt);
    if (transporter && smtpUser && customer.email && (!lastEmail || (now - lastEmail) / 86_400_000 >= EMAIL_RENOTIFY_DAYS)) {
      const dueDate = dueMs ? new Date(dueMs) : new Date();
      const { html } = buildInvoiceEmail({
        customerName: customer.name || 'Klient', invoiceNumber: invoiceLabel,
        amount: inv.total || inv.amount || 0, dueDate, projectName: '', type: 'reminder2',
        currency: inv.currency || 'ALL', paymentMethod: inv.paymentMethod,
        bankName: inv.bankName, bankIBAN: inv.bankIBAN, bankSWIFT: inv.bankSWIFT,
        bankAccountHolder: inv.bankAccountHolder, bankCountry: inv.bankCountry,
      });
      ops.push(
        transporter.sendMail({ from: `"FivoCRM" <${smtpUser}>`, to: customer.email, subject: `⚠️ Faturë e papaguar #${invoiceLabel} (${daysOverdue} ditë vonesë)`, html })
          .then(() => doc.ref.update({ overdueEmailSentAt: admin.firestore.Timestamp.now() }))
          .catch((e) => console.error('[overdue-email]', e))
      );
      emailsSent++;
    }

    // 2) WhatsApp escalation after waOverdueDays (default 60)
    if (inv.teamId) {
      const settings = await getTeamSettings(inv.teamId);
      const waDays = Number(settings?.waOverdueDays) || 60;
      const lastWa = ms(inv.overdueWaSentAt);
      if (settings?.waOverdueEnabled && settings?.metaEnabled && settings?.waOverdueTemplateId && customer.phone
          && daysOverdue >= waDays && (!lastWa || (now - lastWa) / 86_400_000 >= WA_RENOTIFY_DAYS)) {
        const tpl = await getTemplate(settings.waOverdueTemplateId);
        const channels: any[] = settings.metaChannels || [];
        const channel = channels.find((c) => c.phoneNumberId === settings.waOverdueChannelPhoneNumberId) || channels[0];
        if (tpl && channel?.accessToken && channel?.phoneNumberId) {
          const ctx: Record<string, any> = { name: customer.name, invoiceNumber: invoiceLabel, amount: inv.total || inv.amount || 0, total: inv.total || inv.amount || 0, daysOverdue };
          const params: string[] = (tpl.paramFields || []).map((f: string) => f && f !== 'custom' && ctx[f] != null ? String(ctx[f]) : '');
          ops.push(
            sendMetaBroadcastMessage(channel, normalizeWaPhone(customer.phone), tpl, params, inv.teamId, null, { id: doc.id, name: customer.name })
              .catch((e) => console.error('[overdue-wa]', e))
          );
          ops.push(doc.ref.update({ overdueWaSentAt: admin.firestore.Timestamp.now() }));
          waSent++;
        }
      }
    }
  }

  await settleAll(ops, 'overdue-reminders');
  return { emailsSent, waSent };
}

// ── JOB: recurring-tasks ─────────────────────────────────────────────────────
async function runRecurringTasks() {
  const now = new Date();
  const tasksSnap = await db.collection('tasks').where('isRecurring', '==', true).get();
  let created = 0;
  const ops: Promise<any>[] = [];

  const bizCache = new Map<string, string | null>();
  for (const doc of tasksSnap.docs) {
    const task = doc.data();
    // Self-heal: a recurring task must carry businessId or it disappears from the
    // business-scoped list & calendar. If it's missing, derive it from the project
    // (or team) and patch the source so it (and every future cycle) stays visible.
    if (!task.businessId) {
      let bid: string | null = null;
      if (task.projectId) {
        if (!bizCache.has('p:' + task.projectId)) {
          const p = await db.collection('projects').doc(task.projectId).get();
          bizCache.set('p:' + task.projectId, p.exists ? (p.data()!.businessId ?? null) : null);
        }
        bid = bizCache.get('p:' + task.projectId) ?? null;
      }
      if (!bid && task.teamId) {
        if (!bizCache.has('t:' + task.teamId)) {
          const tm = await db.collection('teamMembers').where('teamId', '==', task.teamId).limit(1).get();
          bizCache.set('t:' + task.teamId, tm.empty ? null : (tm.docs[0].data().businessId ?? null));
        }
        bid = bizCache.get('t:' + task.teamId) ?? null;
      }
      if (bid) {
        task.businessId = bid;
        ops.push(doc.ref.update({ businessId: bid, updatedAt: admin.firestore.Timestamp.now() }));
      }
    }
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

    let newStart = addFrequency(startDate, task.recurringFrequency, task.recurringDayOfWeek, task.recurringDayOfMonth, task.recurringInterval, task.recurringDaysOfWeek);
    let newEnd = addFrequency(endDate, task.recurringFrequency, task.recurringDayOfWeek, task.recurringDayOfMonth, task.recurringInterval, task.recurringDaysOfWeek);
    let newNext = addFrequency(nextRecurringDate, task.recurringFrequency, task.recurringDayOfWeek, task.recurringDayOfMonth, task.recurringInterval, task.recurringDaysOfWeek);

    const startOfDayMs = (x: Date) => { const n = new Date(x); n.setHours(0, 0, 0, 0); return n.getTime(); };
    // Roll forward so a task completed (or picked up) late never spawns an
    // already-overdue occurrence — the next due date is always the first future
    // one (same behaviour as the client-side buildNextRecurringTask / Asana).
    const todayMs = startOfDayMs(now);
    let rollGuard = 0;
    while (startOfDayMs(newStart) < todayMs && rollGuard++ < 500) {
      newStart = addFrequency(newStart, task.recurringFrequency, task.recurringDayOfWeek, task.recurringDayOfMonth, task.recurringInterval, task.recurringDaysOfWeek);
      newEnd = addFrequency(newEnd, task.recurringFrequency, task.recurringDayOfWeek, task.recurringDayOfMonth, task.recurringInterval, task.recurringDaysOfWeek);
      newNext = addFrequency(newNext, task.recurringFrequency, task.recurringDayOfWeek, task.recurringDayOfMonth, task.recurringInterval, task.recurringDaysOfWeek);
    }

    // Honor "repeat until": if the next occurrence is past recurringEndDate, stop
    // the series (mark done so it isn't reprocessed) without creating a new cycle.
    const recEnd: Date | null = task.recurringEndDate ? (task.recurringEndDate.toDate ? task.recurringEndDate.toDate() : new Date(task.recurringEndDate)) : null;
    if (recEnd && !isNaN(recEnd.getTime()) && startOfDayMs(newStart) > startOfDayMs(recEnd)) {
      ops.push(doc.ref.update({ nextCycleCreated: true, updatedAt: admin.firestore.Timestamp.now() }));
      continue;
    }

    // Create new task ref first so we can reference its ID in the notification
    const newTaskRef = db.collection('tasks').doc();
    ops.push(newTaskRef.set({ title: task.title, description: task.description ?? null, status: 'Todo', priority: task.priority ?? null, projectId: task.projectId ?? null, assignedToUserId: task.assignedToUserId ?? null, startDate: admin.firestore.Timestamp.fromDate(newStart), endDate: admin.firestore.Timestamp.fromDate(newEnd), isRecurring: true, recurringFrequency: task.recurringFrequency, recurringInterval: task.recurringInterval ?? 1, recurringDayOfWeek: task.recurringDayOfWeek ?? null, recurringDayOfMonth: task.recurringDayOfMonth ?? null, recurringDaysOfWeek: task.recurringDaysOfWeek ?? null, recurringEndDate: recEnd ? admin.firestore.Timestamp.fromDate(recEnd) : null, nextRecurringDate: admin.firestore.Timestamp.fromDate(newNext), nextCycleCreated: false, dueNotificationSent: false, parentTaskId: task.parentTaskId ?? null, createdByUserId: task.createdByUserId ?? null, teamId: task.teamId ?? null, businessId: task.businessId ?? null, customerId: task.customerId ?? null, createdAt: admin.firestore.Timestamp.now(), updatedAt: admin.firestore.Timestamp.now() }));
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

    // "Repeat until": if this occurrence falls after the end date, the series is
    // complete — stop generating and clear the recurrence. Past invoices stay.
    if (invoice.recurringEndDate) {
      const endDate: Date = invoice.recurringEndDate?.toDate ? invoice.recurringEndDate.toDate() : new Date(invoice.recurringEndDate);
      if (!isNaN(endDate.getTime()) && nextDate > endDate) {
        ops.push(doc.ref.update({ isRecurring: false, nextRecurringDate: null, updatedAt: admin.firestore.Timestamp.now() }));
        skipped++; continue;
      }
    }

    // Idempotency: skip if a child was already created after the last trigger date.
    // NOTE: equality-only filters (no orderBy) so this needs no composite index —
    // adding orderBy('createdAt') here previously required a missing index and made
    // the whole job fail. We compute the latest child createdAt client-side instead.
    const existingChildSnap = await db.collection('invoices')
      .where('parentInvoiceId', '==', doc.id)
      .where('autoGenerated', '==', true)
      .get();
    if (!existingChildSnap.empty) {
      const lastChildCreatedAt: Date = existingChildSnap.docs.reduce((max, d) => {
        const raw = d.data().createdAt;
        const t = raw?.toDate ? raw.toDate() : new Date(raw);
        return (t instanceof Date && !isNaN(t.getTime()) && t > max) ? t : max;
      }, new Date(0));
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

  // Dedup window: don't send a second open-projects reminder while the user still
  // has a recent unread one (guards against the job running more than once/week).
  const DEDUP_MS = 3 * 24 * 60 * 60 * 1000; // 3 days
  const cutoffMs = now.getTime() - DEDUP_MS;

  for (const [userId, userProjects] of userProjectMap) {
    // Query by userId only (index-free) and filter type/read/recency in memory.
    const existing = await db.collection('notifications').where('userId', '==', userId).get();
    const hasRecentReminder = existing.docs.some(d => {
      const n = d.data();
      if (n.type !== 'project_open_reminder' || n.isRead) return false;
      const ms = typeof n.createdAt?.toMillis === 'function' ? n.createdAt.toMillis() : 0;
      return ms >= cutoffMs;
    });
    if (hasRecentReminder) continue;

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
    // Only parent originals drive recurrence — skip auto-generated children and paused series.
    if (expense.autoGenerated) continue;
    if (expense.isRecurringPaused) continue;
    if (!expense.nextRecurringDate || !expense.recurringFrequency) continue;
    const nextDate: Date = expense.nextRecurringDate?.toDate ? expense.nextRecurringDate.toDate() : new Date(expense.nextRecurringDate);
    if (isNaN(nextDate.getTime()) || nextDate > now) continue;

    // "Repeat until": if this occurrence falls after the end date, the series is
    // complete — stop generating and clear the recurrence. Past entries stay.
    if (expense.recurringEndDate) {
      const endDate: Date = expense.recurringEndDate?.toDate ? expense.recurringEndDate.toDate() : new Date(expense.recurringEndDate);
      if (!isNaN(endDate.getTime()) && nextDate > endDate) {
        ops.push(doc.ref.update({ isRecurring: false, nextRecurringDate: null, updatedAt: admin.firestore.Timestamp.now() }));
        continue;
      }
    }

    // Idempotency: skip if a child was already generated for this trigger date.
    // Equality-only filters (no orderBy) so no composite index is needed; the
    // latest child createdAt is computed client-side.
    const existingChildSnap = await db.collection('expenses')
      .where('parentExpenseId', '==', doc.id)
      .where('autoGenerated', '==', true)
      .get();
    if (!existingChildSnap.empty) {
      const lastChildCreatedAt: Date = existingChildSnap.docs.reduce((max, d) => {
        const raw = d.data().createdAt;
        const t = raw?.toDate ? raw.toDate() : new Date(raw);
        return (t instanceof Date && !isNaN(t.getTime()) && t > max) ? t : max;
      }, new Date(0));
      if (lastChildCreatedAt >= nextDate) { continue; }
    }

    // Calculate the next occurrence
    const next = new Date(nextDate);
    if (expense.recurringFrequency === 'weekly') next.setDate(next.getDate() + 7);
    else if (expense.recurringFrequency === 'monthly') next.setMonth(next.getMonth() + 1);
    else if (expense.recurringFrequency === 'yearly') next.setFullYear(next.getFullYear() + 1);
    else next.setMonth(next.getMonth() + 1); // default monthly

    // Create a new expense entry for this cycle. Use the SCHEDULED date (nextDate),
    // not today, so the occurrence lands in its planned month even if cron runs late.
    ops.push(db.collection('expenses').add({
      title: expense.title,
      description: expense.description || null,
      amount: expense.amount,
      currency: expense.currency || 'ALL',
      category: expense.category,
      teamId: expense.teamId || null,
      // Carry tenant scope forward so business-scoped queries don't drop the entry.
      businessId: expense.businessId || null,
      projectId: expense.projectId || null,
      departmentId: expense.departmentId || null,
      memberId: expense.memberId || null,
      isRecurring: false, // child entries are not recurring themselves
      autoGenerated: true,
      parentExpenseId: doc.id,
      status: expense.status || 'Active',
      approvalStatus: 'Submitted',
      createdByUserId: expense.createdByUserId || null,
      date: admin.firestore.Timestamp.fromDate(nextDate),
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

// ── JOB: lead-sla-stale-alerts ───────────────────────────────────────────────
// Flags leads that breached the first-response SLA (no outbound touch within
// SLA_HOURS) and leads that went stale (no activity for STALE_DAYS), notifying
// the owner (or team admins if unassigned). Debounced via per-lead flags.
async function runLeadSlaAndStaleAlerts() {
  const SLA_HOURS = 24;
  const STALE_DAYS = 14;
  const STALE_RENOTIFY_DAYS = 7;
  const now = Date.now();
  const ms = (v: any): number => (v?.toDate ? v.toDate().getTime() : (v ? new Date(v).getTime() : 0));

  const leadsSnap = await db.collection('leads').get();
  const adminsByTeam: Record<string, string[]> = {};
  const getTeamAdmins = async (teamId?: string): Promise<string[]> => {
    if (!teamId) return [];
    if (adminsByTeam[teamId]) return adminsByTeam[teamId];
    const snap = await db.collection('teamMembers').where('teamId', '==', teamId).get();
    const ids = snap.docs
      .filter(d => ['Admin', 'Manager', 'Owner'].includes(d.data().role))
      .map(d => d.data().userId).filter(Boolean);
    adminsByTeam[teamId] = ids;
    return ids;
  };

  let slaBreaches = 0, staleLeads = 0;
  const ops: Promise<any>[] = [];

  for (const doc of leadsSnap.docs) {
    const lead = doc.data();
    if (lead.status === 'Lost' || lead.status === 'Converted') continue;

    const recipients = lead.assignedToUserId ? [lead.assignedToUserId] : await getTeamAdmins(lead.teamId);
    if (recipients.length === 0) continue;

    // First-response SLA breach — notify once.
    const createdMs = ms(lead.createdAt);
    const hoursSinceCreated = createdMs ? (now - createdMs) / 3_600_000 : 0;
    if (!lead.firstResponseAt && hoursSinceCreated > SLA_HOURS && !lead.slaBreachNotified) {
      const title = `⏰ SLA: lead pa përgjigje — ${lead.name}`;
      const message = `Lead-i "${lead.name}" nuk ka marrë përgjigje brenda ${SLA_HOURS}h nga krijimi.`;
      for (const uid of recipients) {
        ops.push(db.collection('notifications').add({ userId: uid, type: 'lead_follow_up', title, message, isRead: false, actionUrl: '/app/crm', actionLabel: 'Shiko CRM', createdAt: admin.firestore.Timestamp.now() }));
        ops.push(sendPush(uid, title, message, { url: '/app/crm' }));
      }
      ops.push(doc.ref.update({ slaBreachNotified: true }));
      slaBreaches++;
    }

    // Staleness — re-notify at most every STALE_RENOTIFY_DAYS.
    const lastMs = Math.max(ms(lead.lastActivityAt), ms(lead.lastFollowUpDate), ms(lead.updatedAt));
    const staleDays = lastMs ? (now - lastMs) / 86_400_000 : Infinity;
    const sinceStaleNotif = ms(lead.staleNotifiedAt) ? (now - ms(lead.staleNotifiedAt)) / 86_400_000 : Infinity;
    if (staleDays > STALE_DAYS && sinceStaleNotif > STALE_RENOTIFY_DAYS) {
      const title = `💤 Lead i ftohur — ${lead.name}`;
      const message = `Lead-i "${lead.name}" s'ka aktivitet prej ${Math.floor(staleDays)} ditësh.`;
      for (const uid of recipients) {
        ops.push(db.collection('notifications').add({ userId: uid, type: 'lead_follow_up', title, message, isRead: false, actionUrl: '/app/crm', actionLabel: 'Shiko CRM', createdAt: admin.firestore.Timestamp.now() }));
        ops.push(sendPush(uid, title, message, { url: '/app/crm' }));
      }
      ops.push(doc.ref.update({ staleNotifiedAt: admin.firestore.Timestamp.now() }));
      staleLeads++;
    }
  }

  await settleAll(ops, 'lead-sla-stale-alerts');
  return { slaBreaches, staleLeads };
}

// ── JOB: lead-wa-auto-reminders ──────────────────────────────────────────────
// Sends an automatic WhatsApp template to "waiting" leads (configured statuses)
// that have had no communication for waAutoReminderDays (default 7). Requires the
// team to enable it + configure a template/channel (Settings → WhatsApp automation).
async function runLeadWhatsappAutoReminders() {
  const now = Date.now();
  const ms = (v: any): number => (v?.toDate ? v.toDate().getTime() : (v ? new Date(v).getTime() : 0));

  const leadsSnap = await db.collection('leads').get();
  if (leadsSnap.empty) return { sent: 0 };

  const tsCache = new Map<string, any>();
  const tplCache = new Map<string, any>();
  const getTeamSettings = async (teamId: string) => {
    if (tsCache.has(teamId)) return tsCache.get(teamId);
    const doc = await db.collection('teamSettings').doc(teamId).get();
    const data = doc.exists ? doc.data() : null;
    tsCache.set(teamId, data);
    return data;
  };
  const getTemplate = async (id: string) => {
    if (tplCache.has(id)) return tplCache.get(id);
    const doc = await db.collection('waTemplates').doc(id).get();
    const data = doc.exists ? doc.data() : null;
    tplCache.set(id, data);
    return data;
  };

  let sent = 0;
  const ops: Promise<any>[] = [];

  for (const leadDoc of leadsSnap.docs) {
    const lead = leadDoc.data();
    if (['Won', 'Lost', 'Converted'].includes(lead.status)) continue;
    const phone = lead.phone || lead.phoneNumber;
    if (!phone || !lead.teamId) continue;

    const settings = await getTeamSettings(lead.teamId);
    if (!settings?.waAutoReminderEnabled || !settings?.metaEnabled || !settings?.waAutoReminderTemplateId) continue;

    const statuses: string[] = settings.waAutoReminderStatuses?.length ? settings.waAutoReminderStatuses : ['Follow-up', 'Proposal'];
    if (!statuses.includes(lead.status)) continue;

    const days = Number(settings.waAutoReminderDays) || 7;
    const lastComm = Math.max(ms(lead.lastActivityAt), ms(lead.lastFollowUpDate)) || ms(lead.createdAt);
    const daysSince = lastComm ? (now - lastComm) / 86_400_000 : Infinity;
    if (daysSince < days) continue;

    // Debounce: re-send at most once per `days` window.
    const lastAuto = ms(lead.waAutoReminderAt);
    if (lastAuto && (now - lastAuto) / 86_400_000 < days) continue;

    const tpl = await getTemplate(settings.waAutoReminderTemplateId);
    const channels: any[] = settings.metaChannels || [];
    const channel = channels.find((c) => c.phoneNumberId === settings.waAutoReminderChannelPhoneNumberId) || channels[0];
    if (!tpl || !channel?.accessToken || !channel?.phoneNumberId) continue;

    const params: string[] = (tpl.paramFields || []).map((f: string) =>
      f && f !== 'custom' && lead[f] != null ? String(lead[f]) : ''
    );
    ops.push(
      sendMetaBroadcastMessage(channel, normalizeWaPhone(phone), tpl, params, lead.teamId, null, { id: leadDoc.id, name: lead.name })
        .catch((e) => console.error('[wa-auto-reminder]', e))
    );
    ops.push(db.collection('leadActivities').add({
      leadId: leadDoc.id, teamId: lead.teamId, type: 'whatsapp',
      title: 'WhatsApp automatik (rikujtues)',
      body: `Rikujtues pas ${Math.floor(daysSince)} ditësh pa komunikim.`,
      userId: null, userName: 'Sistemi', createdAt: admin.firestore.Timestamp.now(),
    }));
    ops.push(leadDoc.ref.update({
      waAutoReminderAt: admin.firestore.Timestamp.now(),
      lastFollowUpDate: admin.firestore.Timestamp.now(),
      lastActivityAt: admin.firestore.Timestamp.now(),
    }));
    const assignee = lead.assignedToUserId || lead.createdByUserId;
    if (assignee) {
      ops.push(db.collection('notifications').add({
        userId: assignee, type: 'lead_follow_up',
        title: `📲 Rikujtues WhatsApp u dërgua — ${lead.name}`,
        message: `Rikujtues automatik WhatsApp u dërgua te ${lead.name} (${Math.floor(daysSince)} ditë pa komunikim).`,
        isRead: false, actionUrl: '/app/crm', actionLabel: 'Shiko CRM', createdAt: admin.firestore.Timestamp.now(),
      }));
    }
    sent++;
  }

  await settleAll(ops, 'lead-wa-auto-reminders');
  return { sent };
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
      // "Has a registered domain" filter → set of customerIds owning a domain.
      const domainCustomerIds: Set<string> | null = seg.hasDomain
        ? new Set((await db.collection('domains').get()).docs.map(d => d.data().customerId).filter(Boolean).map(String))
        : null;

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
          if (seg.source && String(l.source || '') !== seg.source) continue;
          if (domainCustomerIds) continue; // leads never own a domain
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
          if (seg.source && String(c.source || '') !== seg.source) continue;
          if (domainCustomerIds && !domainCustomerIds.has(String(d.id))) continue;
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

// ── JOB: email-campaigns ─────────────────────────────────────────────────────
// Bulk email marketing sends via the ESP (Resend) or SMTP fallback. Mirrors the
// WhatsApp broadcast model: idempotent & resumable — already-emailed addresses
// are tracked on `sentEmails` and skipped, so re-runs continue where they left
// off. Processes up to PER_RUN recipients per campaign per invocation.
function normalizeEmail(e: string): string {
  return String(e || '').trim().toLowerCase();
}
const isValidCampaignEmail = (e: string): boolean =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && !e.includes('\n') && !e.includes('\r');

async function runEmailCampaigns() {
  const PER_RUN = 100; // matches Resend batch limit; safe for SMTP too
  const now = new Date();
  const snap = await db.collection('emailCampaigns')
    .where('status', 'in', ['queued', 'sending'])
    .get();

  let processed = 0;
  let sent = 0;

  for (const cDoc of snap.docs) {
    const c = cDoc.data() as any;
    try {
      // Respect scheduling.
      if (c.scheduledAt?.toDate && c.scheduledAt.toDate() > now) continue;

      // Resolve the email body: saved template or inline HTML.
      let subject: string = c.subject || '';
      let bodyHtml: string = c.htmlBody || '';
      if (c.templateId) {
        const tplDoc = await db.collection('emailTemplates').doc(c.templateId).get();
        if (tplDoc.exists) {
          const tpl = tplDoc.data() as any;
          bodyHtml = tpl.html || bodyHtml;
          if (!subject) subject = tpl.subject || '';
        } else if (!bodyHtml) {
          await cDoc.ref.update({ status: 'failed', error: 'Template mungon', updatedAt: now });
          continue;
        }
      }
      if (!bodyHtml || !subject) {
        await cDoc.ref.update({ status: 'failed', error: 'Subjekti ose përmbajtja mungon', updatedAt: now });
        continue;
      }

      // Per-team email provider config (Settings → Integrime); falls back to env.
      const tsDoc = await db.collection('teamSettings').doc(c.teamId).get();
      const ts = (tsDoc.data() as any) || {};
      const mailerConfig = {
        emailProvider: ts.emailProvider,
        emailApiKey: ts.emailApiKey,
        emailFromEmail: ts.emailFromEmail,
        emailFromName: ts.emailFromName,
        emailMailgunDomain: ts.emailMailgunDomain,
        emailMailgunRegion: ts.emailMailgunRegion,
        emailSmtpHost: ts.emailSmtpHost,
        emailSmtpPort: ts.emailSmtpPort,
        emailSmtpUser: ts.emailSmtpUser,
        emailSmtpPass: ts.emailSmtpPass,
      };

      // Resolve segment → recipients from leads and/or customers (filtered in
      // memory, matching the WhatsApp broadcast approach), deduped by email.
      const seg = c.segment || {};
      const audience: string[] = seg.audience?.length ? seg.audience : ['leads'];
      // "Has a registered domain" filter → set of customerIds owning a domain.
      const domainCustomerIds: Set<string> | null = seg.hasDomain
        ? new Set((await db.collection('domains').get()).docs.map(d => d.data().customerId).filter(Boolean).map(String))
        : null;
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

      const byEmail = new Map<string, { id: string; name?: string; company?: string; email: string }>();
      if (audience.includes('leads')) {
        const leadsSnap = await db.collection('leads').get();
        for (const d of leadsSnap.docs) {
          const l = d.data() as any;
          const email = normalizeEmail(l.email);
          if (!isValidCampaignEmail(email)) continue;
          if (seg.statuses?.length && !seg.statuses.includes(l.status)) continue;
          if (!matchesTags(l)) continue;
          if (seg.assignedToUserId && l.assignedToUserId !== seg.assignedToUserId) continue;
          if (seg.source && String(l.source || '') !== seg.source) continue;
          if (domainCustomerIds) continue; // leads never own a domain
          if (!byEmail.has(email)) byEmail.set(email, { id: d.id, name: l.name, company: l.company, email });
        }
      }
      if (audience.includes('customers')) {
        const custSnap = await db.collection('customers').get();
        for (const d of custSnap.docs) {
          const cu = d.data() as any;
          const email = normalizeEmail(cu.email);
          if (!isValidCampaignEmail(email)) continue;
          if (!matchesTags(cu)) continue;
          if (seg.assignedToUserId && cu.assignedToUserId !== seg.assignedToUserId) continue;
          if (seg.source && String(cu.source || '') !== seg.source) continue;
          if (domainCustomerIds && !domainCustomerIds.has(String(d.id))) continue;
          if (!byEmail.has(email)) byEmail.set(email, { id: d.id, name: cu.name, company: cu.company, email });
        }
      }

      // Idempotency: skip recipients already emailed.
      const alreadySent = new Set<string>((c.sentEmails || []).map((e: string) => normalizeEmail(e)));
      const total = byEmail.size;
      const targets = Array.from(byEmail.values()).filter((t) => !alreadySent.has(t.email));
      const batch = targets.slice(0, PER_RUN);

      const messages = batch.map((t) => ({
        to: t.email,
        subject: renderMergeTokens(subject, { name: t.name || '', company: t.company || '', email: t.email }),
        html: renderMergeTokens(bodyHtml, { name: t.name || '', company: t.company || '', email: t.email }),
      }));
      const results = messages.length ? await sendBulkEmail(messages, mailerConfig, c.fromName, cDoc.id) : [];
      const succeeded = results.filter((r) => r.ok).map((r) => normalizeEmail(r.to));
      const failed = results.filter((r) => !r.ok).length;
      sent += succeeded.length;

      const newSentTotal = alreadySent.size + succeeded.length;
      const remaining = total - newSentTotal;
      const lastError = results.find((r) => !r.ok)?.error || null;
      await cDoc.ref.update({
        totalTargets: total,
        sentCount: newSentTotal,
        failedCount: (c.failedCount || 0) + failed,
        ...(succeeded.length ? { sentEmails: admin.firestore.FieldValue.arrayUnion(...succeeded) } : {}),
        status: remaining > 0 ? 'sending' : 'completed',
        error: remaining > 0 ? lastError : (succeeded.length === 0 && failed > 0 ? lastError : null),
        updatedAt: new Date(),
      });
      processed++;
    } catch (err: any) {
      console.error(`[CRON:email-campaigns] campaign ${cDoc.id} dështoi:`, err);
      await cDoc.ref.update({ status: 'failed', error: err?.message || 'Gabim', updatedAt: new Date() }).catch(() => {});
    }
  }

  return { processed, sent };
}

// Per-team email provider config (Settings → Integrime) → MailerConfig, cached.
function makeTeamSettingsCache() {
  const cache = new Map<string, any>();
  const get = async (teamId: string) => {
    if (!teamId) return {};
    if (!cache.has(teamId)) cache.set(teamId, (await db.collection('teamSettings').doc(teamId).get()).data() || {});
    return cache.get(teamId);
  };
  const cfgFor = async (teamId: string) => {
    const ts = await get(teamId);
    return {
      emailProvider: ts.emailProvider, emailApiKey: ts.emailApiKey, emailFromEmail: ts.emailFromEmail,
      emailFromName: ts.emailFromName, emailMailgunDomain: ts.emailMailgunDomain, emailMailgunRegion: ts.emailMailgunRegion,
      emailSmtpHost: ts.emailSmtpHost, emailSmtpPort: ts.emailSmtpPort, emailSmtpUser: ts.emailSmtpUser, emailSmtpPass: ts.emailSmtpPass,
    };
  };
  return { cfgFor };
}

// Normalize a campaign to a list of drip steps. A campaign with no explicit
// `steps` is a single day-0 email built from its subject/template/htmlBody.
function campaignSteps(c: any): { delayDays: number; subject?: string; templateId?: string; htmlBody?: string }[] {
  if (Array.isArray(c.steps) && c.steps.length) {
    return c.steps.map((s: any, i: number) => ({
      delayDays: Number(s.delayDays) || (i === 0 ? 0 : 0),
      subject: s.subject, templateId: s.templateId, htmlBody: s.htmlBody,
    }));
  }
  return [{ delayDays: 0, subject: c.subject, templateId: c.templateId, htmlBody: c.htmlBody }];
}

// ── JOB: purchase-campaigns ──────────────────────────────────────────────────
// Evergreen automations: when a customer PAYS an invoice, ENROLL them into any
// matching 'purchase' campaign (service filter empty = any purchase). Covers all
// payment paths (Stripe/WHMCS/manual) by scanning Paid invoices. Idempotent: the
// enrollment is recorded on the invoice's `marketingCampaignsSent`; only invoices
// paid AFTER the campaign was created are eligible (so activating an automation
// never blasts old buyers). The actual emails are delivered by runCampaignSteps.
async function runPurchaseCampaigns() {
  const now = new Date();
  const LOOKBACK_MS = 60 * 24 * 3600 * 1000; // safety cap: ignore purchases older than 60d
  const MAX_INVOICES = 300;                   // bound Firestore reads per run

  // Single-field query (no composite index); filter status in memory.
  const campSnap = await db.collection('emailCampaigns').where('trigger', '==', 'purchase').get();
  const campaigns = campSnap.docs
    .map((d) => ({ id: d.id, ...(d.data() as any) }))
    .filter((c) => c.status === 'active')
    .map((c) => ({
      ...c,
      _createdAt: c.createdAt?.toDate ? c.createdAt.toDate() : new Date(0),
      _wants: new Set<string>((c.triggerServiceIds || []).filter(Boolean)),
    }));
  if (campaigns.length === 0) return { campaigns: 0, enrolled: 0 };

  const invSnap = await db.collection('invoices').where('status', '==', 'Paid').limit(MAX_INVOICES).get();

  let enrolled = 0;
  for (const invDoc of invSnap.docs) {
    const inv = invDoc.data() as any;
    const paidAt = inv.paidAt?.toDate ? inv.paidAt.toDate() : (inv.updatedAt?.toDate ? inv.updatedAt.toDate() : null);
    if (!paidAt || now.getTime() - paidAt.getTime() > LOOKBACK_MS) continue;

    const already = new Set<string>(inv.marketingCampaignsSent || []);
    const candidates = campaigns.filter((c) => c.teamId === inv.teamId && !already.has(c.id) && paidAt >= c._createdAt);
    if (candidates.length === 0 || !inv.customerId) continue;

    const custDoc = await db.collection('customers').doc(inv.customerId).get();
    const email = normalizeEmail(custDoc.data()?.email);
    if (!isValidCampaignEmail(email)) continue;

    // Which services were on this invoice (only if a candidate filters by service).
    let serviceIds: Set<string> | null = null;
    if (candidates.some((c) => c._wants.size > 0)) {
      const itemsSnap = await db.collection('invoiceItems').where('invoiceId', '==', invDoc.id).get();
      serviceIds = new Set<string>(itemsSnap.docs.map((d) => (d.data() as any).serviceId).filter(Boolean));
    }

    for (const c of candidates) {
      if (c._wants.size > 0 && !(serviceIds && [...c._wants].some((id) => serviceIds!.has(id)))) continue;
      // Enroll the buyer; step 0 is due immediately (runCampaignSteps sends it).
      await db.collection('campaignEnrollments').add({
        teamId: inv.teamId,
        ...(inv.businessId ? { businessId: inv.businessId } : {}),
        campaignId: c.id,
        email,
        name: custDoc.data()?.name || '',
        company: custDoc.data()?.company || '',
        currentStep: 0,
        status: 'active',
        enrolledAt: admin.firestore.Timestamp.fromDate(now),
        nextSendAt: admin.firestore.Timestamp.fromDate(now),
        lastSentAt: null,
        sentSteps: [],
        sourceInvoiceId: invDoc.id,
        createdAt: admin.firestore.Timestamp.fromDate(now),
        updatedAt: admin.firestore.Timestamp.fromDate(now),
      });
      await invDoc.ref.update({ marketingCampaignsSent: admin.firestore.FieldValue.arrayUnion(c.id) }).catch(() => {});
      enrolled++;
    }
  }

  return { campaigns: campaigns.length, enrolled };
}

// ── JOB: campaign-steps ──────────────────────────────────────────────────────
// Delivers due drip-sequence steps for active enrollments. For each enrollment
// whose nextSendAt has passed: send the current step, advance to the next (with
// its delayDays from enrollment), or complete. Idempotent via `sentSteps`.
async function runCampaignSteps() {
  const now = new Date();
  const MAX = 200; // recipients processed per run
  const snap = await db.collection('campaignEnrollments').where('status', '==', 'active').limit(MAX).get();
  if (snap.empty) return { processed: 0, sent: 0 };

  const { cfgFor } = makeTeamSettingsCache();
  const campCache = new Map<string, any>();
  const getCampaign = async (id: string) => {
    if (!campCache.has(id)) campCache.set(id, (await db.collection('emailCampaigns').doc(id).get()).data() || null);
    return campCache.get(id);
  };
  const tplCache = new Map<string, any>();
  const getTpl = async (id: string) => {
    if (!tplCache.has(id)) tplCache.set(id, (await db.collection('emailTemplates').doc(id).get()).data() || null);
    return tplCache.get(id);
  };

  let processed = 0, sent = 0;
  for (const eDoc of snap.docs) {
    const e = eDoc.data() as any;
    const due = e.nextSendAt?.toDate ? e.nextSendAt.toDate() : now;
    if (due > now) continue;

    try {
      const camp = await getCampaign(e.campaignId);
      if (!camp || (camp.status !== 'active' && camp.status !== 'paused')) {
        await eDoc.ref.update({ status: 'stopped', updatedAt: now }); continue;
      }
      if (camp.status === 'paused') continue; // hold; resume when reactivated

      const steps = campaignSteps(camp);
      const idx: number = e.currentStep || 0;
      if (idx >= steps.length) { await eDoc.ref.update({ status: 'completed', updatedAt: now }); continue; }
      const step = steps[idx];
      const alreadySent = new Set<number>(e.sentSteps || []);

      // Resolve this step's subject + HTML (step → template → campaign fallback).
      let subject = step.subject || camp.subject || '';
      let html = step.htmlBody || '';
      if (step.templateId) {
        const tpl = await getTpl(step.templateId);
        if (tpl) { html = tpl.html || html; if (!subject) subject = tpl.subject || ''; }
      } else if (!html && camp.templateId) {
        const tpl = await getTpl(camp.templateId);
        if (tpl) { html = tpl.html || html; if (!subject) subject = tpl.subject || ''; }
      }
      if (!html) html = camp.htmlBody || '';

      let stepOk = alreadySent.has(idx); // if already sent, just advance
      if (!stepOk && subject && html) {
        const cfg = await cfgFor(e.teamId);
        const vars = { name: e.name || '', company: e.company || '', email: e.email };
        const results = await sendBulkEmail(
          [{ to: e.email, subject: renderMergeTokens(subject, vars), html: renderMergeTokens(html, vars) }],
          cfg, camp.fromName, e.campaignId,
        );
        stepOk = !!results[0]?.ok;
        if (stepOk) {
          sent++;
          await db.collection('emailCampaigns').doc(e.campaignId).update({
            sentCount: admin.firestore.FieldValue.increment(1),
            sentEmails: admin.firestore.FieldValue.arrayUnion(e.email),
            updatedAt: now,
          }).catch(() => {});
        }
      }

      if (stepOk) {
        const nextIdx = idx + 1;
        const enrolledAt = e.enrolledAt?.toDate ? e.enrolledAt.toDate() : now;
        if (nextIdx >= steps.length) {
          await eDoc.ref.update({
            status: 'completed', currentStep: nextIdx, lastSentAt: now,
            sentSteps: admin.firestore.FieldValue.arrayUnion(idx), updatedAt: now,
          });
        } else {
          const nextDue = new Date(enrolledAt.getTime() + (Number(steps[nextIdx].delayDays) || 0) * 86_400_000);
          await eDoc.ref.update({
            currentStep: nextIdx, lastSentAt: now,
            nextSendAt: admin.firestore.Timestamp.fromDate(nextDue),
            sentSteps: admin.firestore.FieldValue.arrayUnion(idx), updatedAt: now,
          });
        }
        processed++;
      }
    } catch (err: any) {
      console.error(`[CRON:campaign-steps] enrollment ${eDoc.id} dështoi:`, err);
    }
  }

  return { processed, sent };
}

// ── JOB: backfill-businessid (two-level tenancy, Phase 2) ────────────────────
// Stamps businessId onto every team-scoped doc via Admin SDK (bypasses rules, so
// it covers activities/messages/comments the client can't touch). Idempotent.
const BACKFILL_COLLECTIONS = [
  'tasks', 'invoices', 'invoiceItems', 'customers', 'leads', 'deals', 'leadActivities',
  'services', 'expenses', 'goals', 'timeEntries', 'channels', 'messages', 'activities',
  'clientRequests', 'taskComments', 'taskCollaborators', 'customIndustries', 'directMessages',
  'milestones', 'serviceInquiries', 'projectComments', 'workspaceFolders', 'workspaceDriveFiles',
  'projects', 'roleTemplates', 'dailyReports', 'standups', 'quotes', 'contracts', 'chatSnippets',
  // Identity/structure collections that are now business-scoped on read:
  'teamMembers', 'teamInvites',
  // WhatsApp collections excluded: their reads use skipTeamFilter (unaffected by the
  // Phase 3b businessId flip) and the owner doesn't need them tagged with businessId.
];

async function runBackfillBusinessId(opts?: { reset?: boolean }) {
  // Resumable + time-budgeted: each call processes as many collections as fit in the
  // budget, records completed ones in a state doc, and returns what's left. The client
  // calls repeatedly until done. Completed collections are SKIPPED (not re-read), so a
  // resumed run costs no extra Firestore reads — important on a quota-limited project.
  const stateRef = db.collection('migrations').doc('businessIdBackfill');
  const stateSnap = await stateRef.get();
  const done: string[] = (opts?.reset || !stateSnap.exists) ? [] : (stateSnap.data()?.done || []);

  const teamsSnap = await db.collection('teams').get();
  const teamToBusiness = new Map<string, string>();
  teamsSnap.docs.forEach(d => { const b = (d.data() as any).businessId; if (b) teamToBusiness.set(d.id, b); });
  if (teamToBusiness.size === 0) return { error: 'No teams linked to a business yet — run Phase 1 first.' };

  const pending = BACKFILL_COLLECTIONS.filter(c => !done.includes(c));
  const started = Date.now();
  const BUDGET_MS = 45000; // leave margin under the 60s function limit
  let totalUpdated = 0;
  const results: { collection: string; scanned: number; updated: number; error?: string }[] = [];

  for (const col of pending) {
    if (Date.now() - started > BUDGET_MS) break;
    let scanned = 0, updated = 0;
    try {
      const snap = await db.collection(col).get();
      scanned = snap.size;
      const toUpdate = snap.docs.filter(d => {
        const data = d.data() as any;
        const bid = data.teamId ? teamToBusiness.get(data.teamId) : undefined;
        return !!bid && data.businessId !== bid;
      });
      for (let i = 0; i < toUpdate.length; i += 400) {
        const batch = db.batch();
        toUpdate.slice(i, i + 400).forEach(d => batch.update(d.ref, { businessId: teamToBusiness.get((d.data() as any).teamId)! }));
        await batch.commit();
        updated += Math.min(400, toUpdate.length - i);
      }
      totalUpdated += updated;
      done.push(col);
      results.push({ collection: col, scanned, updated });
    } catch (err: any) {
      const msg = String(err?.message || err);
      console.error(`[backfill] ${col} failed:`, msg);
      results.push({ collection: col, scanned, updated: -1, error: msg.slice(0, 300) });
      // Stop on quota errors — there's no point hammering an exhausted project.
      if (msg.includes('RESOURCE_EXHAUSTED')) break;
    }
  }

  await stateRef.set({ done, updatedAt: admin.firestore.Timestamp.now() }, { merge: true });
  const remaining = BACKFILL_COLLECTIONS.filter(c => !done.includes(c));
  return { totalUpdated, businesses: teamToBusiness.size, results, completed: done.length, total: BACKFILL_COLLECTIONS.length, remaining };
}

// ── JOB: backfill-portal-customerid ──────────────────────────────────────────
// Mirrors each portal user's customerId onto users/{uid}.customerId so the
// isPortalClientFor() rule can grant them read access once reads are hardened.
async function runBackfillPortalCustomerId() {
  const snap = await db.collection('clientPortalAccess').get();
  const seen = new Set<string>();
  let updated = 0;
  for (const d of snap.docs) {
    const data = d.data() as any;
    const uid = data.userId; const cid = data.customerId;
    if (!uid || !cid || seen.has(uid)) continue;
    seen.add(uid);
    try {
      await db.collection('users').doc(uid).set({ customerId: cid, updatedAt: admin.firestore.Timestamp.now() }, { merge: true });
      updated++;
    } catch (err: any) { console.error(`[portal-backfill] ${uid} failed:`, err?.message || err); }
  }
  return { updated, total: snap.size };
}

// ── JOB: backfill-customerid (Phase 4.3b Wave 3) ─────────────────────────────
// Stamps customerId onto parent-linked child records so portal clients can read
// their own data under server-side RLS (isPortalClientFor). Staff isolation uses
// businessId; the portal needs customerId on these collections, which carry none of
// their own — derived from the parent invoice / project / task. Resumable +
// time-budgeted, mirroring backfill-businessid. Order matters: tasks before
// taskComments (a comment's customerId comes from its task's, derived here too).
const CUSTOMERID_BACKFILL_COLLECTIONS = ['invoiceItems', 'tasks', 'projectComments', 'taskComments'];

async function runBackfillCustomerId(opts?: { reset?: boolean }) {
  const stateRef = db.collection('migrations').doc('customerIdBackfill');
  const stateSnap = await stateRef.get();
  const done: string[] = (opts?.reset || !stateSnap.exists) ? [] : (stateSnap.data()?.done || []);

  const pending = CUSTOMERID_BACKFILL_COLLECTIONS.filter(c => !done.includes(c));
  const started = Date.now();
  const BUDGET_MS = 45000;
  let totalUpdated = 0;
  const results: { collection: string; scanned: number; updated: number; error?: string }[] = [];

  // Parent → customerId maps, loaded once and cached across collections.
  let invoiceCustomer: Map<string, string> | null = null;
  let projectCustomer: Map<string, string> | null = null;
  let taskCustomer: Map<string, string> | null = null;

  const loadInvoices = async () => {
    if (!invoiceCustomer) {
      invoiceCustomer = new Map();
      (await db.collection('invoices').get()).docs.forEach(d => {
        const c = (d.data() as any).customerId; if (c) invoiceCustomer!.set(d.id, c);
      });
    }
    return invoiceCustomer;
  };
  const loadProjects = async () => {
    if (!projectCustomer) {
      projectCustomer = new Map();
      (await db.collection('projects').get()).docs.forEach(d => {
        const c = (d.data() as any).customerId; if (c) projectCustomer!.set(d.id, c);
      });
    }
    return projectCustomer;
  };
  const loadTasks = async () => {
    if (!taskCustomer) {
      const projMap = await loadProjects();
      taskCustomer = new Map();
      (await db.collection('tasks').get()).docs.forEach(d => {
        const data = d.data() as any;
        const c = data.customerId || (data.projectId ? projMap.get(data.projectId) : undefined);
        if (c) taskCustomer!.set(d.id, c);
      });
    }
    return taskCustomer;
  };

  for (const col of pending) {
    if (Date.now() - started > BUDGET_MS) break;
    let scanned = 0, updated = 0;
    try {
      // Preload the parent map this collection needs.
      let lookup: Map<string, string>; let parentKey: string;
      if (col === 'invoiceItems') { lookup = await loadInvoices(); parentKey = 'invoiceId'; }
      else if (col === 'taskComments') { lookup = await loadTasks(); parentKey = 'taskId'; }
      else { lookup = await loadProjects(); parentKey = 'projectId'; } // tasks, projectComments

      const snap = await db.collection(col).get();
      scanned = snap.size;
      const toUpdate: { ref: any; customerId: string }[] = [];
      snap.docs.forEach(d => {
        const data = d.data() as any;
        if (data.customerId) return;
        const pid = data[parentKey];
        const cid = pid ? lookup.get(pid) : undefined;
        if (cid) toUpdate.push({ ref: d.ref, customerId: cid });
      });
      for (let i = 0; i < toUpdate.length; i += 400) {
        const batch = db.batch();
        toUpdate.slice(i, i + 400).forEach(u => batch.update(u.ref, { customerId: u.customerId }));
        await batch.commit();
        updated += Math.min(400, toUpdate.length - i);
      }
      totalUpdated += updated;
      done.push(col);
      results.push({ collection: col, scanned, updated });
    } catch (err: any) {
      const msg = String(err?.message || err);
      console.error(`[backfill-customerid] ${col} failed:`, msg);
      results.push({ collection: col, scanned, updated: -1, error: msg.slice(0, 300) });
      if (msg.includes('RESOURCE_EXHAUSTED')) break;
    }
  }

  await stateRef.set({ done, updatedAt: admin.firestore.Timestamp.now() }, { merge: true });
  const remaining = CUSTOMERID_BACKFILL_COLLECTIONS.filter(c => !done.includes(c));
  return { totalUpdated, results, completed: done.length, total: CUSTOMERID_BACKFILL_COLLECTIONS.length, remaining };
}

// ── JOB: set-superadmin-claim ────────────────────────────────────────────────
// Sets a Firebase custom claim { superAdmin: true } on the caller IF their email
// is in the super-admin allowlist (server reads the same env the client uses).
// Needed before hardening rules so the super-admin's cross-tenant reads (and the
// isSuperAdmin() rule) keep working. Caller must sign out/in afterwards to refresh.
async function runSetSuperAdminClaim(req: VercelRequest) {
  const token = (req.headers.authorization as string | undefined)?.slice(7) || '';
  let decoded: any;
  try { decoded = await adminAuth.verifyIdToken(token); }
  catch (err: any) { return { error: `Token invalid: ${err?.message || err}` }; }
  const email = String(decoded.email || '').toLowerCase();
  const allow = String(process.env.SUPER_ADMIN_EMAILS || process.env.VITE_SUPER_ADMIN_EMAILS || '')
    .split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  if (!allow.includes(email)) {
    return { error: `Email "${email}" is not in the super-admin allowlist.` };
  }
  await adminAuth.setCustomUserClaims(decoded.uid, { superAdmin: true });
  return { success: true, uid: decoded.uid, email, note: 'Dil dhe hyr sërish që token-i të marrë claim-in.' };
}

// ── JOB: inquiry-materials-reminders ─────────────────────────────────────────
// Emails the CLIENT a gentle reminder listing the materials still missing from
// their submitted questionnaire (logo, photos, business services, description,
// website, socials). Opt-in per team via teamSettings.inquiryMaterialsReminderEnabled;
// re-sends every N days (default 3), up to 3 times. Mirrors the completeness
// logic in src/lib/inquiryBrief.ts (getInquiryCompleteness) — keep in sync.
function inquiryMissingMaterials(q: any): { key: string; label: string }[] {
  const isEmpty = (v: any) =>
    v == null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);
  const hasServices = Array.isArray(q.businessServices)
    && q.businessServices.some((s: any) => s && String(s.title || '').trim());
  const hasMaterials = (Array.isArray(q.materialFiles) && q.materialFiles.length > 0)
    || !isEmpty(q.googleDriveLink)
    || (Array.isArray(q.folderIncludes) && q.folderIncludes.length > 0);
  const hasSocial = !isEmpty(q.instagramLink) || !isEmpty(q.facebookLink)
    || !isEmpty(q.tiktokLink) || !isEmpty(q.linkedinLink);
  const items = [
    { key: 'logo', label: 'Logo e biznesit', done: !isEmpty(q.logoUrl) },
    { key: 'photos', label: 'Foto / materiale', done: hasMaterials },
    { key: 'services', label: 'Shërbimet e biznesit', done: hasServices },
    { key: 'description', label: 'Përshkrimi i biznesit', done: !isEmpty(q.businessDescription) },
    { key: 'website', label: 'Website', done: !isEmpty(q.website) },
    { key: 'social', label: 'Rrjetet sociale', done: hasSocial },
  ];
  return items.filter((i) => !i.done).map(({ key, label }) => ({ key, label }));
}

function buildInquiryMaterialsEmail(firstName: string, missingLabels: string[], link: string): string {
  const items = missingLabels.map((l) => `<li style="margin:4px 0;">${l}</li>`).join('');
  return `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#ffffff;">
      <h2 style="color:#12468C;margin:0 0 8px;">Plotësoni materialet e projektit tuaj</h2>
      <p style="font-size:15px;color:#374151;">Përshëndetje <strong>${firstName}</strong>,</p>
      <p style="font-size:15px;color:#4b5563;line-height:1.6;">
        Faleminderit që dërguat anketën! Për të nisur punën sa më mirë për ju, na mungojnë ende disa materiale:
      </p>
      <ul style="font-size:15px;color:#111827;padding-left:20px;">${items}</ul>
      <p style="margin:24px 0;">
        <a href="${link}" style="background:#0EA5E9;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;display:inline-block;">
          Plotëso tani
        </a>
      </p>
      <p style="font-size:13px;color:#9ca3af;">Nuk është e detyrueshme, por sa më shumë të dimë, aq më mirë punojmë për ju.</p>
      <p style="font-size:12px;color:#9ca3af;border-top:1px solid #e5e7eb;padding-top:12px;margin-top:24px;">FivoCRM — Kujtesë automatike</p>
    </div>
  `;
}

async function runInquiryMaterialsReminders() {
  const transporter = makeTransporter();
  const smtpUser = process.env.SMTP_USER;
  if (!transporter || !smtpUser) return { sent: 0, skipped: 0 };

  const now = Date.now();
  const MAX_REMINDERS = 3;
  const PORTAL_BASE = process.env.APP_URL || 'https://fivocrm.com';
  const isValidEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && !e.includes('\n') && !e.includes('\r');
  const ms = (v: any): number => (v?.toDate ? v.toDate().getTime() : (v ? new Date(v).getTime() : 0));
  const daysSince = (t: number) => (t ? (now - t) / 86_400_000 : Infinity);

  const snap = await db.collection('serviceInquiries').get();
  if (snap.empty) return { sent: 0, skipped: 0 };

  const tsCache = new Map<string, any>();
  const getTeamSettings = async (teamId: string) => {
    if (tsCache.has(teamId)) return tsCache.get(teamId);
    const d = await db.collection('teamSettings').doc(teamId).get();
    const data = d.exists ? d.data() : null;
    tsCache.set(teamId, data);
    return data;
  };

  let sent = 0, skipped = 0;
  const ops: Promise<any>[] = [];

  for (const doc of snap.docs) {
    const q = doc.data();
    // Only submitted, still-open inquiries with a team + valid client email
    if (q.isDraft === true) { skipped++; continue; }
    if (q.status !== 'New' && q.status !== 'Reviewed') { skipped++; continue; }
    if (!q.teamId || !q.email || !isValidEmail(q.email)) { skipped++; continue; }

    const settings = await getTeamSettings(q.teamId);
    if (!settings?.inquiryMaterialsReminderEnabled) { skipped++; continue; }
    const days = Math.max(1, Number(settings.inquiryMaterialsReminderDays) || 3);

    const missing = inquiryMissingMaterials(q);
    if (missing.length === 0) { skipped++; continue; }

    const count = Number(q.materialsReminderCount) || 0;
    if (count >= MAX_REMINDERS) { skipped++; continue; }

    // Wait `days` since last activity (updatedAt) AND since the previous reminder.
    const lastActivity = ms(q.updatedAt) || ms(q.createdAt);
    const lastReminder = ms(q.materialsReminderSentAt);
    if (daysSince(lastActivity) < days) { skipped++; continue; }
    if (lastReminder && daysSince(lastReminder) < days) { skipped++; continue; }

    const firstName = String(q.contactName || q.businessName || 'Klient').split(' ')[0];
    const link = `${PORTAL_BASE}/portal/projects/inquiry/${doc.id}`;
    const html = buildInquiryMaterialsEmail(firstName, missing.map((m) => m.label), link);

    ops.push(
      transporter.sendMail({
        from: `"FivoCRM" <${smtpUser}>`,
        to: q.email,
        subject: 'Kujtesë: plotësoni materialet e projektit tuaj',
        html,
      })
        // Only touch the reminder fields — do NOT bump updatedAt (that would
        // reset the activity clock and delay the next reminder indefinitely).
        .then(() => doc.ref.update({
          materialsReminderSentAt: admin.firestore.Timestamp.now(),
          materialsReminderCount: count + 1,
        }))
        .catch((e) => console.error('[inquiry-materials-reminder]', e))
    );
    sent++;
  }

  await settleAll(ops, 'inquiry-materials-reminders');
  return { sent, skipped };
}

// ── JOB: lead-cadence-steps ──────────────────────────────────────────────────
// Automated follow-up sequences: for each lead with cadenceActive, create a
// follow-up task for the assigned rep at each configured day-offset (from
// cadenceStartedAt), advancing cadenceStep. Stops when steps run out or the
// lead reaches a terminal status (Won/Converted/Lost).
async function runLeadCadenceSteps() {
  const now = Date.now();
  const ms = (v: any): number => (v?.toDate ? v.toDate().getTime() : (v ? new Date(v).getTime() : 0));
  const TERMINAL = ['Won', 'Converted', 'Lost'];

  const tsCache = new Map<string, number[]>();
  const cadenceDays = async (teamId: string): Promise<number[]> => {
    if (!teamId) return [1, 3, 7, 14];
    if (tsCache.has(teamId)) return tsCache.get(teamId)!;
    let days = [1, 3, 7, 14];
    try {
      const d = await db.collection('teamSettings').doc(teamId).get();
      const raw = d.exists ? (d.data() as any).leadCadenceDays : null;
      if (Array.isArray(raw) && raw.length) days = raw.map((n: any) => Number(n)).filter((n: number) => n >= 0).sort((a, b) => a - b);
    } catch { /* default */ }
    tsCache.set(teamId, days);
    return days;
  };

  const snap = await db.collection('leads').where('cadenceActive', '==', true).get();
  if (snap.empty) return { created: 0, completed: 0 };

  let created = 0, completed = 0;
  const ops: Promise<any>[] = [];

  for (const doc of snap.docs) {
    const lead = doc.data();
    if (TERMINAL.includes(lead.status)) {
      ops.push(doc.ref.update({ cadenceActive: false, updatedAt: admin.firestore.Timestamp.now() }));
      completed++;
      continue;
    }
    const days = await cadenceDays(lead.teamId);
    const step = Number(lead.cadenceStep) || 0;
    if (step >= days.length) {
      ops.push(doc.ref.update({ cadenceActive: false, updatedAt: admin.firestore.Timestamp.now() }));
      completed++;
      continue;
    }
    const startedMs = ms(lead.cadenceStartedAt) || ms(lead.createdAt);
    const dueMs = startedMs + days[step] * 86_400_000;
    if (now < dueMs) continue; // not due yet

    const recipientId = lead.assignedToUserId || lead.createdByUserId;
    const due = admin.firestore.Timestamp.fromDate(new Date(now));
    ops.push(db.collection('tasks').add({
      title: `Ndjekje ${step + 1}: ${lead.name || 'Lead'}`,
      description: `Hapi ${step + 1}/${days.length} i sekuencës së ndjekjes. Rikontakto lead-in.`,
      status: 'Todo',
      priority: 'medium',
      assignedToUserId: recipientId || null,
      createdByUserId: lead.createdByUserId || null,
      teamId: lead.teamId || null,
      businessId: lead.businessId || null,
      startDate: due,
      endDate: due,
      dueDate: due,
      dueNotificationSent: false,
      relatedLeadId: doc.id,
      createdAt: admin.firestore.Timestamp.now(),
      updatedAt: admin.firestore.Timestamp.now(),
    }));
    if (recipientId) {
      ops.push(db.collection('notifications').add({
        userId: recipientId,
        type: 'lead_cadence_step',
        title: `🔁 Ndjekje: ${lead.name || 'Lead'}`,
        message: `Hapi ${step + 1}/${days.length} i sekuencës — koha për rikontakt.`,
        isRead: false,
        actionUrl: '/app/crm',
        actionLabel: 'Shiko CRM',
        createdAt: admin.firestore.Timestamp.now(),
      }));
    }
    const nextStep = step + 1;
    ops.push(doc.ref.update({
      cadenceStep: nextStep,
      cadenceActive: nextStep < days.length,
      nextFollowUpDate: due,
      updatedAt: admin.firestore.Timestamp.now(),
    }));
    created++;
    if (nextStep >= days.length) completed++;
  }

  await settleAll(ops, 'lead-cadence-steps');
  return { created, completed };
}

// ── JOB: project-spend-rollup ────────────────────────────────────────────────
// Rolls logged time (hours × member cost-rate) + project-tagged expenses into
// each project's `spent`, so Reports/Customer360 margins reflect real labor cost
// instead of the stale creation-time 0. Also stores laborCost/billableValue/
// loggedHours for realization. Mirrors src/lib/finance/laborCost.ts — keep in sync.
async function runProjectSpendRollup() {
  const SERVER_RATES: Record<string, number> = { EUR: 100, USD: 92, GBP: 118, ALL: 1, LEK: 1 };
  const toAllServer = (amount: number, currency?: string) =>
    (amount || 0) * (SERVER_RATES[(currency || 'ALL').toUpperCase()] ?? 1);
  const ms = (v: any): number => (v?.toDate ? v.toDate().getTime() : (v ? new Date(v).getTime() : 0));
  const entryHours = (e: any): number => {
    if (typeof e.duration === 'number' && e.duration > 0) return e.duration / 60;
    const s = ms(e.startTime), en = ms(e.endTime);
    return (s && en && en > s) ? (en - s) / 3_600_000 : 0;
  };

  const [projectsSnap, entriesSnap, membersSnap, expensesSnap] = await Promise.all([
    db.collection('projects').get(),
    db.collection('timeEntries').get(),
    db.collection('teamMembers').get(),
    db.collection('expenses').get(),
  ]);

  const costByUser = new Map<string, number>();
  for (const m of membersSnap.docs) {
    const d = m.data();
    const rate = (d.hourlyCostRate && d.hourlyCostRate > 0)
      ? d.hourlyCostRate
      : (d.monthlySalary && d.monthlySalary > 0 ? d.monthlySalary / 160 : 0);
    if (d.userId) costByUser.set(d.userId, rate);
  }
  const billByUser = new Map<string, number>();
  for (const m of membersSnap.docs) {
    const d = m.data();
    if (d.userId) billByUser.set(d.userId, (d.hourlyBillRate && d.hourlyBillRate > 0) ? d.hourlyBillRate : (costByUser.get(d.userId) || 0));
  }

  const labor = new Map<string, { cost: number; billableValue: number; hours: number }>();
  for (const doc of entriesSnap.docs) {
    const e = doc.data();
    if (!e.projectId) continue;
    const h = entryHours(e);
    if (h <= 0) continue;
    const agg = labor.get(e.projectId) || { cost: 0, billableValue: 0, hours: 0 };
    agg.cost += h * (costByUser.get(e.userId) || 0);
    agg.hours += h;
    if (e.isBillable) agg.billableValue += h * ((e.hourlyRate && e.hourlyRate > 0) ? e.hourlyRate : (billByUser.get(e.userId) || 0));
    labor.set(e.projectId, agg);
  }

  const expByProject = new Map<string, number>();
  for (const doc of expensesSnap.docs) {
    const x = doc.data();
    if (!x.projectId) continue;
    expByProject.set(x.projectId, (expByProject.get(x.projectId) || 0) + toAllServer(Number(x.amount) || 0, x.currency));
  }

  const now = admin.firestore.Timestamp.now();
  let updated = 0;
  const ops: Promise<any>[] = [];
  for (const doc of projectsSnap.docs) {
    const p = doc.data();
    const l = labor.get(doc.id) || { cost: 0, billableValue: 0, hours: 0 };
    const spent = Math.round(l.cost + (expByProject.get(doc.id) || 0));
    const laborCost = Math.round(l.cost);
    const billableValue = Math.round(l.billableValue);
    const loggedHours = Math.round(l.hours * 10) / 10;
    if ((p.spent || 0) !== spent || (p.laborCost || 0) !== laborCost || (p.billableValue || 0) !== billableValue) {
      ops.push(doc.ref.update({ spent, laborCost, billableValue, loggedHours, updatedAt: now }));
      updated++;
    }
  }
  await settleAll(ops, 'project-spend-rollup');
  return { updated, projects: projectsSnap.size };
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
      case 'backfill-businessid':
        result = await runBackfillBusinessId({ reset: req.query.reset === '1' });
        break;
      case 'set-superadmin-claim':
        result = await runSetSuperAdminClaim(req);
        break;
      case 'backfill-portal-customerid':
        result = await runBackfillPortalCustomerId();
        break;
      case 'backfill-customerid':
        result = await runBackfillCustomerId({ reset: req.query.reset === '1' });
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
      case 'email-campaigns':
        result = await runEmailCampaigns();
        break;
      case 'purchase-campaigns':
        result = await runPurchaseCampaigns();
        break;
      case 'campaign-steps':
        result = await runCampaignSteps();
        break;
      case 'lead-sla-stale-alerts':
        result = await runLeadSlaAndStaleAlerts();
        break;
      case 'lead-wa-auto-reminders':
        result = await runLeadWhatsappAutoReminders();
        break;
      case 'overdue-reminders':
        result = await runOverdueReminders();
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
      case 'inquiry-materials-reminders':
        result = await runInquiryMaterialsReminders();
        break;
      case 'project-spend-rollup':
        result = await runProjectSpendRollup();
        break;
      case 'lead-cadence-steps':
        result = await runLeadCadenceSteps();
        break;
      case 'run-all': {
        // Single daily cron that runs all jobs — works within Vercel Hobby 2-cron limit
        const [tasks, invoiceRem, overdueRem, recurTasks, recurInv, projCompl, projReset, goals, expenses, invites, leads, leadSla, leadWaAuto, digest, waBroadcasts, emailCampaigns, purchaseCampaigns, campaignSteps, whmcs, inquiryReminders, projectRollup, leadCadence] = await Promise.allSettled([
          runTaskDeadlineAlerts(),
          runInvoiceReminders(),
          runOverdueReminders(),
          runRecurringTasks(),
          runRecurringInvoices(),
          runProjectCompletionReminder(),
          runRecurringProjectReset(),
          runGoalOverdueAlerts(),
          runRecurringExpenses(),
          runExpireInvitations(),
          runLeadFollowUpReminders(),
          runLeadSlaAndStaleAlerts(),
          runLeadWhatsappAutoReminders(),
          runNotificationDigest(),
          runWhatsappBroadcasts(),
          runEmailCampaigns(),
          runPurchaseCampaigns(),
          runCampaignSteps(),
          runWhmcsSync(),
          runInquiryMaterialsReminders(),
          runProjectSpendRollup(),
          runLeadCadenceSteps(),
        ]);
        const settled = (r: PromiseSettledResult<any>) =>
          r.status === 'fulfilled' ? r.value : { error: (r.reason as Error)?.message || 'failed' };
        result = {
          tasks: settled(tasks),
          invoiceReminders: settled(invoiceRem),
          overdueReminders: settled(overdueRem),
          recurringTasks: settled(recurTasks),
          recurringInvoices: settled(recurInv),
          projectCompletionReminder: settled(projCompl),
          projectReset: settled(projReset),
          goalAlerts: settled(goals),
          recurringExpenses: settled(expenses),
          invites: settled(invites),
          leadReminders: settled(leads),
          leadSlaStale: settled(leadSla),
          leadWaAutoReminders: settled(leadWaAuto),
          digest: settled(digest),
          whatsappBroadcasts: settled(waBroadcasts),
          emailCampaigns: settled(emailCampaigns),
          purchaseCampaigns: settled(purchaseCampaigns),
          campaignSteps: settled(campaignSteps),
          whmcsSync: settled(whmcs),
          inquiryMaterialsReminders: settled(inquiryReminders),
          projectSpendRollup: settled(projectRollup),
          leadCadenceSteps: settled(leadCadence),
        };
        break;
      }
      default:
        return res.status(400).json({ error: `Job i panjohur: "${job}". Vlerat e vlefshme: run-all, task-deadline-alerts, invoice-reminders, recurring-tasks, recurring-invoices, project-completion-reminder, recurring-project-reset, notification-digest, whatsapp-broadcasts, email-campaigns, purchase-campaigns, campaign-steps, whmcs-sync, whmcs-clients` });
    }

    return res.status(200).json({ success: true, job, ...result, timestamp: new Date().toISOString() });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Gabim i panjohur';
    console.error(`[CRON] Gabim në job "${job}":`, err);
    return res.status(500).json({ error: msg, job });
  }
}
