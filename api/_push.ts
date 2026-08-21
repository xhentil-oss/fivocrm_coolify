/**
 * ONE server-side delivery path for notifications: Firestore doc → push → email.
 *
 * Why this file exists
 * --------------------
 * Delivery used to be split in two unequal halves. Anything created from the browser
 * went through `useMutation('notifications')` → `/api/send-notification-email`, which
 * pushed AND emailed while honouring every preference. Anything created on the server
 * — cron jobs, the Stripe webhook, the landing form, `/api/notify-staff`, the report
 * jobs — called `db.collection('notifications').add()` directly, so it produced a red
 * dot inside the app and nothing else. Twelve of ~18 cron notification sites had no
 * push and no email at all, including "your recurring billing is stopped".
 *
 * `notifyUser()` below is the single entry point. It writes the document, then pushes
 * and emails through the same gates the client path uses, so a notification behaves
 * the same no matter who created it.
 *
 * Two hard rules encoded here
 * ---------------------------
 *  1. DND is WALL-CLOCK time in the USER's zone. The window is typed into an
 *     `<input type="time">`, but every server evaluated it with getUTCHours(), so for
 *     Albania (UTC+2 in summer) "22:00–08:00" actually silenced 00:00–10:00 — pushes
 *     arrived at midnight and were swallowed all morning. `localMinutesFor()` rebuilds
 *     the user's local time from `dndTimeZone` (or `dndUtcOffsetMinutes`).
 *  2. A user has MANY devices. Tokens live in `userPushTokens/{uid}/tokens/{id}`;
 *     the old single-token doc `userPushTokens/{uid}` is still read as a fallback for
 *     clients that have not re-registered yet, and is pruned when it goes stale.
 */

import admin, { adminDb as db, adminMessaging, adminAuth } from './_firebaseAdmin.js';
import nodemailer from 'nodemailer';
import { isTypeMutedByPrefs, NOTIFICATION_TYPE_CATEGORY } from './_notificationTypes.js';

export const BASE_URL = (process.env.PUBLIC_BASE_URL || 'https://fivocrm.vercel.app').replace(/\/$/, '');

// ── Preferences ───────────────────────────────────────────────────────────────

export async function getUserPrefs(userId: string): Promise<any> {
  try {
    const snap = await db.collection('userPreferences').doc(String(userId)).get();
    return snap.exists ? (snap.data() as any) : {};
  } catch {
    return {}; // on a read failure default to DELIVERING, never to silence
  }
}

/**
 * Minutes since midnight in the user's own zone.
 *
 * Preference order: IANA zone → stored UTC offset → UTC (legacy records only).
 * A record written before the timezone fix has neither field; those keep the old
 * UTC behaviour rather than silently shifting, and the client stamps the zone onto
 * the document the next time the user opens the app.
 */
function localMinutesFor(prefs: any, now = new Date()): number {
  const zone = typeof prefs?.dndTimeZone === 'string' ? prefs.dndTimeZone : '';
  if (zone) {
    try {
      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: zone, hour: '2-digit', minute: '2-digit', hour12: false,
      }).formatToParts(now);
      const h = Number(parts.find(p => p.type === 'hour')?.value);
      const m = Number(parts.find(p => p.type === 'minute')?.value);
      if (Number.isFinite(h) && Number.isFinite(m)) return (h % 24) * 60 + m;
    } catch { /* unknown zone → fall through to the offset */ }
  }
  const offset = Number(prefs?.dndUtcOffsetMinutes);
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  if (Number.isFinite(offset)) return ((utcMinutes + offset) % 1440 + 1440) % 1440;
  return utcMinutes;
}

/** True when NOW falls inside the user's Do-Not-Disturb window, in THEIR zone. */
export function isDndActive(prefs: any, now = new Date()): boolean {
  if (!prefs?.dndEnabled || !prefs?.dndStart || !prefs?.dndEnd) return false;
  const cur = localMinutesFor(prefs, now);
  const [sh, sm] = String(prefs.dndStart).split(':').map(Number);
  const [eh, em] = String(prefs.dndEnd).split(':').map(Number);
  if (![sh, sm, eh, em].every(Number.isFinite)) return false;
  const s = sh * 60 + sm;
  const e = eh * 60 + em;
  // Equal start/end = "the whole day" (the window has no outside). `s <= e` alone
  // made e.g. 22:00–22:00 never active, delivering all day despite DND being on.
  if (s === e) return true;
  return s < e ? (cur >= s && cur < e) : (cur >= s || cur < e); // overnight window
}

/** Both shared gates in one call: Do-Not-Disturb and category mute. */
export function isSilenced(prefs: any, type?: string | null, now = new Date()): boolean {
  return isDndActive(prefs, now) || isTypeMutedByPrefs(type, prefs);
}

// ── Push tokens (multi-device) ────────────────────────────────────────────────

interface TokenEntry {
  token: string;
  ref: FirebaseFirestore.DocumentReference;
  /** Legacy single-token doc rather than a per-device entry. */
  legacy?: boolean;
}

/**
 * Every device registered for this user.
 *
 * Reads the per-device subcollection AND the legacy single-token document, because
 * a user who has not opened the app since the migration still only has the old one.
 * Deduped by token so a device present in both places is pushed once.
 */
export async function listPushTokens(userId: string): Promise<TokenEntry[]> {
  const out: TokenEntry[] = [];
  const seen = new Set<string>();
  try {
    // Newest devices first: a bare limit() returns docs by id (a token hash, i.e.
    // random), so a user with >25 accumulated rows could get ONLY dead ones and a
    // live phone would silently never ring. saveToken always writes updatedAt; the
    // unordered fallback covers any legacy row written before it existed (orderBy
    // excludes docs missing the field).
    const col = db.collection('userPushTokens').doc(String(userId)).collection('tokens');
    let sub = await col.orderBy('updatedAt', 'desc').limit(25).get();
    if (sub.empty) sub = await col.limit(25).get();
    for (const d of sub.docs) {
      const t = d.data()?.token;
      if (typeof t === 'string' && t && !seen.has(t)) {
        seen.add(t);
        out.push({ token: t, ref: d.ref });
      }
    }
  } catch { /* subcollection unreadable — fall back to the legacy doc */ }
  try {
    const legacyRef = db.collection('userPushTokens').doc(String(userId));
    const legacy = await legacyRef.get();
    const t = legacy.exists ? legacy.data()?.token : undefined;
    if (typeof t === 'string' && t && !seen.has(t)) {
      seen.add(t);
      out.push({ token: t, ref: legacyRef, legacy: true });
    }
  } catch { /* noop */ }
  return out;
}

/** Drop a dead token. For the legacy doc only the `token` field is cleared. */
async function dropToken(entry: TokenEntry): Promise<void> {
  try {
    if (entry.legacy) {
      await entry.ref.set({ token: admin.firestore.FieldValue.delete() }, { merge: true });
    } else {
      await entry.ref.delete();
    }
  } catch { /* noop */ }
}

export interface PushInput {
  title: string;
  body?: string;
  /** Deep-link path, e.g. `/app/tasks?taskId=…`. */
  url?: string;
  type?: string;
  imageUrl?: string;
  /** Pass when the caller already loaded them, to avoid a second read. */
  prefs?: any;
}

export interface PushResult {
  sent: number;
  removed: number;
  skipped?: 'push-disabled' | 'dnd' | 'category-muted' | 'no-token';
}

/**
 * Push to EVERY device the user has registered.
 *
 * Previously this sent to `userPushTokens/{uid}.token` — one device. Registering on
 * the desktop overwrote the phone's token and vice versa, so only the most recently
 * used device ever rang.
 */
export async function sendPushToUser(userId: string, input: PushInput): Promise<PushResult> {
  const prefs = input.prefs ?? await getUserPrefs(userId);
  if (prefs?.pushEnabled === false) return { sent: 0, removed: 0, skipped: 'push-disabled' };
  if (isDndActive(prefs)) return { sent: 0, removed: 0, skipped: 'dnd' };
  if (isTypeMutedByPrefs(input.type, prefs)) return { sent: 0, removed: 0, skipped: 'category-muted' };

  const tokens = await listPushTokens(userId);
  if (tokens.length === 0) return { sent: 0, removed: 0, skipped: 'no-token' };

  // Only https images are forwarded — a bad value makes FCM reject the whole send.
  const image = typeof input.imageUrl === 'string' && /^https:\/\//i.test(input.imageUrl)
    ? input.imageUrl
    : undefined;
  const url = input.url || '/';

  let sent = 0;
  let removed = 0;
  await Promise.all(tokens.map(async (entry) => {
    try {
      await adminMessaging.send({
        token: entry.token,
        notification: { title: input.title, body: input.body || '', ...(image ? { imageUrl: image } : {}) },
        data: { url, ...(input.type ? { type: String(input.type) } : {}) },
        android: {
          priority: 'high',
          notification: { icon: 'ic_stat_notify', color: '#0EA5E9', ...(image ? { imageUrl: image } : {}) },
        },
        webpush: {
          notification: { icon: '/icon-192.png', ...(image ? { image } : {}) },
          fcmOptions: { link: url },
        },
      });
      sent++;
    } catch (err: any) {
      const code = err?.errorInfo?.code || err?.code;
      // Stale device — stop retrying it forever. NOT invalid-argument: FCM returns
      // that for a malformed PAYLOAD too, and the payload is identical for every
      // device — treating it as a dead token deleted ALL of a user's tokens on one
      // bad send, permanently killing their push until they reopened the app.
      if (code === 'messaging/registration-token-not-registered'
        || code === 'messaging/invalid-registration-token') {
        await dropToken(entry);
        removed++;
      } else if (code === 'messaging/invalid-argument') {
        console.error('[push] rejected payload (token kept):', err?.message || err);
      } else {
        console.error('[push] send failed:', err?.message || err);
      }
    }
  }));

  return { sent, removed };
}

// ── Email ─────────────────────────────────────────────────────────────────────

export function makeTransporter() {
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

export function escapeHtml(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && !email.includes('\n') && !email.includes('\r');
}

export function notificationEmailHtml(opts: {
  title: string;
  message?: string;
  actionUrl?: string;
  actionLabel?: string;
}): string {
  const safeTitle = escapeHtml(opts.title);
  const safeMessage = opts.message ? escapeHtml(opts.message) : '';
  const link = opts.actionUrl
    ? `${BASE_URL}${String(opts.actionUrl).startsWith('/') ? '' : '/'}${opts.actionUrl}`
    : BASE_URL;
  const safeLink = encodeURI(link);
  const safeBtn = escapeHtml(opts.actionLabel || 'Hap në FivoCRM');
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; background: #f9fafb; border-radius: 8px;">
      <div style="background: #12468C; padding: 18px 24px; border-radius: 6px 6px 0 0;">
        <h2 style="color: white; margin: 0; font-size: 18px;">🔔 ${safeTitle}</h2>
      </div>
      <div style="background: white; padding: 24px; border-radius: 0 0 6px 6px; border: 1px solid #e5e7eb;">
        ${safeMessage ? `<p style="color: #374151; margin-top: 0; font-size: 15px; line-height: 1.5;">${safeMessage}</p>` : ''}
        <div style="text-align: center; margin: 24px 0 8px;">
          <a href="${safeLink}" style="display: inline-block; padding: 12px 28px; background-color: #12468C; color: white; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 15px;">
            ${safeBtn}
          </a>
        </div>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
        <p style="color: #9ca3af; font-size: 12px; margin: 0;">
          Po e merrni këtë sepse keni aktivizuar njoftimet me email. Mund t'i çaktivizoni te Cilësimet → Njoftimet.
        </p>
      </div>
      <p style="color: #9ca3af; font-size: 11px; text-align: center; margin-top: 16px;">FivoCRM — Njoftime</p>
    </div>
  `;
}

/** Email one notification, honouring `emailEnabled` + the shared silence gates. */
export async function sendNotificationEmail(
  userId: string,
  input: { title: string; message?: string; actionUrl?: string; actionLabel?: string; type?: string; prefs?: any },
): Promise<'sent' | 'error' | 'no-email' | 'email-disabled' | 'smtp-not-configured' | 'silenced'> {
  const prefs = input.prefs ?? await getUserPrefs(userId);
  if (prefs?.emailEnabled === false) return 'email-disabled';
  if (isSilenced(prefs, input.type)) return 'silenced';

  const transporter = makeTransporter();
  const smtpUser = process.env.SMTP_USER;
  if (!transporter || !smtpUser) return 'smtp-not-configured';

  let email: string | undefined;
  try {
    email = (await adminAuth.getUser(String(userId))).email || undefined;
  } catch {
    if (typeof userId === 'string' && userId.includes('@')) email = userId; // legacy records
  }
  if (!email || !isValidEmail(email)) return 'no-email';

  try {
    await transporter.sendMail({
      from: `"FivoCRM" <${smtpUser}>`,
      to: email,
      subject: input.title.replace(/[\n\r]/g, '').slice(0, 180),
      html: notificationEmailHtml(input),
    });
    return 'sent';
  } catch (err: any) {
    console.error('[notify-email] send failed:', err?.message || err);
    return 'error';
  }
}

// ── The single entry point ────────────────────────────────────────────────────

export interface NotifyUserInput {
  userId: string | null | undefined;
  /** Must be a registered type — see api/_notificationTypes.ts. */
  type: string;
  title: string;
  message?: string;
  actionUrl?: string;
  actionLabel?: string;
  /** Chat channel id (not a path). */
  linkTo?: string;
  imageUrl?: string;
  /** Tenant stamp — REQUIRED for GDPR export/delete to ever reach this document. */
  businessId?: string | null;
  teamId?: string | null;
  customerId?: string | null;
  projectId?: string | null;
  /** Skip when this user triggered the action themselves. */
  actorUserId?: string | null;
  /** Reuse already-loaded preferences (saves a read in fan-out loops). */
  prefs?: any;
  /** Set false for purely informational rows that should not ring a phone. */
  push?: boolean;
  /** Set false when the caller already sends its own, richer email. */
  email?: boolean;
}

export interface NotifyUserResult {
  written: boolean;
  push?: PushResult;
  email?: string;
  skipped?: 'no-user' | 'self';
}

/**
 * Write the in-app notification AND deliver it over push + email.
 *
 * The document is always written even when both channels are silenced — the bell is
 * the durable record; push and email are the transports. That ordering also means a
 * transport failure can never lose the notification.
 */
export async function notifyUser(input: NotifyUserInput): Promise<NotifyUserResult> {
  let userId = input.userId ? String(input.userId) : '';
  if (!userId) return { written: false, skipped: 'no-user' };

  // Legacy identity guard: `teamMembers.userId` was sometimes an EMAIL, and the
  // pickers copied it verbatim into assignedToUserId — so a notification keyed
  // on it reached nobody (the bell reads by uid, push tokens live at
  // userPushTokens/{uid}, prefs at userPreferences/{uid}). Resolve it to the
  // real uid here, at the single delivery choke point.
  if (userId.includes('@')) {
    try {
      const auth = await admin.auth().getUserByEmail(userId.trim().toLowerCase());
      userId = auth.uid;
    } catch {
      console.error(`[notifyUser] recipient "${userId}" is an email with no auth user — notification dropped`);
      return { written: false, skipped: 'no-user' };
    }
  }
  if (input.actorUserId && input.actorUserId === userId) return { written: false, skipped: 'self' };

  // Both are contract violations by the CALLER, surfaced loudly instead of silently
  // degrading: an unregistered type can never be muted (fail-open) and gets no icon;
  // a missing businessId makes the row invisible to GDPR export/delete.
  if (!Object.prototype.hasOwnProperty.call(NOTIFICATION_TYPE_CATEGORY, input.type)) {
    console.error(`[notifyUser] unregistered notification type "${input.type}" — add it to _notificationTypes.ts + src/lib/notificationTypes.ts`);
  }
  if (!input.businessId) {
    console.error(`[notifyUser] missing businessId on type "${input.type}" for user ${userId} — this row will escape GDPR export/delete`);
  }

  const now = admin.firestore.Timestamp.now();
  const doc: Record<string, any> = {
    userId,
    type: input.type,
    title: input.title,
    message: input.message || '',
    isRead: false,
    createdAt: now,
    updatedAt: now,
  };
  if (input.actionUrl) doc.actionUrl = input.actionUrl;
  if (input.actionLabel) doc.actionLabel = input.actionLabel;
  if (input.linkTo) doc.linkTo = input.linkTo;
  if (input.imageUrl) doc.imageUrl = input.imageUrl;
  if (input.businessId) doc.businessId = input.businessId;
  if (input.teamId) doc.teamId = input.teamId;
  if (input.customerId) doc.customerId = input.customerId;
  if (input.projectId) doc.projectId = input.projectId;

  await db.collection('notifications').add(doc);

  const prefs = input.prefs ?? await getUserPrefs(userId);
  const result: NotifyUserResult = { written: true };

  // Deep-link target: an explicit actionUrl wins; a linkTo that is not a path is a
  // chat channel id, so open the chat on it (mirrors the bell's click behaviour).
  const rawLink = input.actionUrl ?? input.linkTo;
  const url = rawLink
    ? (String(rawLink).startsWith('/') ? String(rawLink) : `/app/chat?channel=${encodeURIComponent(String(rawLink))}`)
    : '/';

  if (input.push !== false) {
    result.push = await sendPushToUser(userId, {
      title: input.title,
      body: input.message,
      url,
      type: input.type,
      imageUrl: input.imageUrl,
      prefs,
    });
  }

  if (input.email !== false) {
    result.email = await sendNotificationEmail(userId, {
      title: input.title,
      message: input.message,
      actionUrl: url,
      actionLabel: input.actionLabel,
      type: input.type,
      prefs,
    });
  }

  return result;
}
