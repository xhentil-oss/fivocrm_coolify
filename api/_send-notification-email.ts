import type { VercelRequest, VercelResponse } from '@vercel/node';
import { adminAuth, adminDb } from './_firebaseAdmin.js';
import { isTypeMutedByPrefs } from './_notificationTypes.js';
import { getUserPrefs, isDndActive, sendPushToUser, sendNotificationEmail } from './_push.js';

// Simple in-memory per-caller rate limiter (best-effort; resets on cold start).
// A fan-out (e.g. "goal achieved" → every active member) issues one call PER
// recipient, so the ceiling is generous — and when it does bite the response says so
// explicitly instead of the caller silently believing the push went out.
const RATE_LIMIT_PER_HOUR = 300;
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
function checkRateLimit(uid: string, maxPerHour = RATE_LIMIT_PER_HOUR): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(uid);
  if (entry && entry.resetAt > now) {
    if (entry.count >= maxPerHour) return false;
    entry.count++;
    return true;
  }
  rateLimitMap.set(uid, { count: 1, resetAt: now + 3_600_000 });
  return true;
}

/**
 * POST /api/send-notification-email  (dispatched via /api/email?type=notification)
 * Body: { userId, type?, title, message?, actionUrl?, actionLabel?, imageUrl? }
 * Header: Authorization: Bearer <Firebase ID token>
 *
 * Delivers an ALREADY-WRITTEN in-app notification over two channels: an FCM push
 * (every registered device, so it arrives with the app closed) and an email. Called
 * fire-and-forget from `useMutation('notifications').create`, which is the choke
 * point for every browser-side notification.
 *
 * Server-created notifications do NOT come through here — they call `notifyUser()`
 * in api/_push.ts directly, which writes the document and runs the same two
 * transports. Both paths therefore share one set of gates (pushEnabled /
 * emailEnabled / Do-Not-Disturb / category mute) and one token store.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Missing authorization header' });
  let caller;
  try {
    caller = await adminAuth.verifyIdToken(authHeader.split('Bearer ')[1]);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  // Rate limited responses are explicit (429 + retryAfter) rather than a silent
  // drop, so a caller that fans out too fast can be seen doing it.
  if (!checkRateLimit(caller.uid)) {
    return res.status(429).json({ error: 'Rate limited', limitPerHour: RATE_LIMIT_PER_HOUR, retryAfterSeconds: 3600 });
  }

  const { userId, type, title, message, actionUrl, actionLabel, imageUrl } = req.body || {};
  if (!userId || !title) return res.status(400).json({ error: 'Missing userId or title' });

  // Don't notify someone about their own action.
  if (userId === caller.uid) return res.status(200).json({ skipped: 'self' });

  // Authorize: a caller may only notify a user in their OWN business — otherwise any
  // authenticated user could push/email arbitrary UIDs across tenants (spam/phishing).
  // Resolved from users/{uid}.businessId, which both staff and portal clients carry.
  // Best-effort: if either side's business can't be resolved (legacy record) we fall
  // through rather than drop a legitimate notification; super-admins bypass.
  if (caller.superAdmin !== true) {
    try {
      const [callerSnap, targetSnap] = await Promise.all([
        adminDb.collection('users').doc(caller.uid).get(),
        adminDb.collection('users').doc(String(userId)).get(),
      ]);
      const callerBiz = callerSnap.exists ? (callerSnap.data() as any)?.businessId : undefined;
      const targetBiz = targetSnap.exists ? (targetSnap.data() as any)?.businessId : undefined;
      if (callerBiz && targetBiz && callerBiz !== targetBiz) {
        return res.status(403).json({ error: 'Forbidden' });
      }
    } catch { /* best-effort: don't block a legitimate notification on a lookup error */ }
  }

  // Load preferences once — they gate both channels.
  const prefs = await getUserPrefs(String(userId));

  // Shared gates: Do-Not-Disturb (evaluated in the USER's timezone, not UTC) and
  // category mute silence BOTH channels. The mute table is the shared registry, so
  // this can no longer disagree with what the bell shows.
  if (isDndActive(prefs)) return res.status(200).json({ skipped: 'dnd' });
  if (isTypeMutedByPrefs(type, prefs)) return res.status(200).json({ skipped: 'category-muted' });

  const url = actionUrl ? String(actionUrl) : '/';

  // Both transports run even if one fails — they are independent channels.
  const [push, email] = await Promise.all([
    sendPushToUser(String(userId), {
      title: String(title),
      body: message ? String(message) : '',
      url,
      type: type ? String(type) : undefined,
      imageUrl: typeof imageUrl === 'string' ? imageUrl : undefined,
      prefs,
    }),
    sendNotificationEmail(String(userId), {
      title: String(title),
      message: message ? String(message) : undefined,
      actionUrl: url,
      actionLabel: actionLabel ? String(actionLabel) : undefined,
      type: type ? String(type) : undefined,
      prefs,
    }),
  ]);

  return res.status(200).json({
    success: true,
    push: push.skipped ?? `sent:${push.sent}${push.removed ? ` removed:${push.removed}` : ''}`,
    email,
  });
}
