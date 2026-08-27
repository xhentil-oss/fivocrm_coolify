import type { VercelRequest, VercelResponse } from '@vercel/node';
import { adminAuth, adminDb } from './_firebaseAdmin.js';
import { isTypeMutedByPrefs } from './_notificationTypes.js';
import {
  getUserPrefs, isDndActive, sendPushToUser, sendNotificationEmail,
  isViewingConversation, shouldThrottleCategoryEmail, notifyUser,
} from './_push.js';
import { checkPersistentRateLimit } from './_rateLimit.js';

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
  // drop, so a caller that fans out too fast can be seen doing it. The in-memory
  // check is only the fast local path — it is per-instance, so the Firestore-backed
  // counter is what actually enforces the ceiling across instances.
  if (!checkRateLimit(caller.uid) || !(await checkPersistentRateLimit('notifyEmail', caller.uid, RATE_LIMIT_PER_HOUR))) {
    return res.status(429).json({ error: 'Rate limited', limitPerHour: RATE_LIMIT_PER_HOUR, retryAfterSeconds: 3600 });
  }

  const { userId, type, title, message, actionUrl, actionLabel, imageUrl, conversationKey, channelFanout } = req.body || {};

  // ── Group-channel fan-out ───────────────────────────────────────────────────
  // The documented browser path is one notification document per recipient through
  // `useMutation('notifications')`, which relays once PER document. For a group
  // channel that is one relay call per member per message, and the rate limit above
  // is per CALLER — a chatty 25-person channel would exhaust a user's whole hourly
  // budget and then silently drop their task/invoice notifications too. So a channel
  // fan-out is ONE call: the server writes every document (notifyUser) and delivers
  // it, counting as a single rate-limit unit.
  //
  // It is also the safer half: membership is verified HERE against the channel
  // document, so a caller cannot address a channel they are not in, nor a member
  // list they made up.
  if (channelFanout) {
    return handleChannelFanout(req, res, caller);
  }

  if (!userId || !title) return res.status(400).json({ error: 'Missing userId or title' });

  // Don't notify someone about their own action.
  if (userId === caller.uid) return res.status(200).json({ skipped: 'self' });

  // Authorize: a caller may only notify a user in their OWN business — otherwise any
  // authenticated user could push/email arbitrary UIDs across tenants (spam/phishing).
  // FAIL-CLOSED. The old check only blocked when BOTH sides' users/{uid}.businessId
  // resolved — but that doc is user-writable and the rules allow saving it with the
  // businessId field ABSENT, so a caller could strip their own and the check fell
  // through to "allowed". The caller's business now comes from server-minted custom
  // claims first (bid = staff, pbid = portal client — not client-writable), with the
  // users doc only as a legacy-token fallback; a target with no users doc is accepted
  // only on membership proof (teamMembers / clientPortalAccess) in the SAME business.
  if (caller.superAdmin !== true) {
    try {
      let callerBiz: string | undefined =
        (typeof (caller as any).bid === 'string' && (caller as any).bid) ||
        (typeof (caller as any).pbid === 'string' && (caller as any).pbid) ||
        undefined;
      if (!callerBiz) {
        const callerSnap = await adminDb.collection('users').doc(caller.uid).get();
        callerBiz = callerSnap.exists ? (callerSnap.data() as any)?.businessId : undefined;
      }
      if (!callerBiz) return res.status(403).json({ error: 'Forbidden' });

      const targetSnap = await adminDb.collection('users').doc(String(userId)).get();
      let targetBiz: string | undefined = targetSnap.exists ? (targetSnap.data() as any)?.businessId : undefined;
      if (!targetBiz) {
        const [tm, pa] = await Promise.all([
          adminDb.collection('teamMembers')
            .where('userId', '==', String(userId)).where('businessId', '==', callerBiz).limit(1).get(),
          adminDb.collection('clientPortalAccess')
            .where('userId', '==', String(userId)).where('businessId', '==', callerBiz).limit(1).get(),
        ]);
        if (!tm.empty || !pa.empty) targetBiz = callerBiz;
      }
      if (targetBiz !== callerBiz) return res.status(403).json({ error: 'Forbidden' });
    } catch {
      // Fail closed: an authorization check that errors must not become a bypass.
      // The in-app notification document is already written by the caller — only
      // this delivery attempt is dropped, and the client logs the non-OK response.
      return res.status(503).json({ error: 'Authorization check failed' });
    }
  }

  // Load preferences once — they gate both channels.
  const prefs = await getUserPrefs(String(userId));

  // Shared gates: Do-Not-Disturb (evaluated in the USER's timezone, not UTC) and
  // category mute silence BOTH channels. The mute table is the shared registry, so
  // this can no longer disagree with what the bell shows.
  if (isDndActive(prefs)) return res.status(200).json({ skipped: 'dnd' });
  if (isTypeMutedByPrefs(type, prefs)) return res.status(200).json({ skipped: 'category-muted' });

  // The recipient is reading this very conversation (chat views stamp it onto the
  // same preferences document, so this is free). The in-app row already exists —
  // written by the caller before this relay — so nothing is lost by staying quiet.
  if (isViewingConversation(prefs, typeof conversationKey === 'string' ? conversationKey : null)) {
    return res.status(200).json({ skipped: 'recipient-in-conversation' });
  }

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
    // Chat categories are email-throttled (see shouldThrottleCategoryEmail): a live
    // conversation used to send one email per message, which also burned the relay's
    // hourly budget. The push above is never throttled.
    shouldThrottleCategoryEmail(String(userId), type ? String(type) : undefined).then(throttled =>
      throttled ? 'throttled' as const : sendNotificationEmail(String(userId), {
        title: String(title),
        message: message ? String(message) : undefined,
        actionUrl: url,
        actionLabel: actionLabel ? String(actionLabel) : undefined,
        type: type ? String(type) : undefined,
        prefs,
      })),
  ]);

  return res.status(200).json({
    success: true,
    push: push.skipped ?? `sent:${push.sent}${push.removed ? ` removed:${push.removed}` : ''}`,
    email,
  });
}

/** Max recipients per fan-out call — mirrors MAX_CHANNEL_NOTIFY in ChatView. */
const MAX_FANOUT = 25;

/**
 * Notify the members of a chat channel about one message.
 *
 * Trust model: the CHANNEL is the authority, not the request. The caller must be a
 * member, every target must be a member, and the tenant comes from the channel
 * document — so the worst a malicious body can do is notify people who are already
 * in a conversation with the caller.
 */
async function handleChannelFanout(req: VercelRequest, res: VercelResponse, caller: any) {
  const f = req.body.channelFanout || {};
  const channelId = typeof f.channelId === 'string' ? f.channelId : '';
  const title = typeof f.title === 'string' ? f.title.slice(0, 200) : '';
  if (!channelId || !title) return res.status(400).json({ error: 'Missing channelId or title' });
  if (!Array.isArray(f.userIds) || f.userIds.length === 0) {
    return res.status(400).json({ error: 'Missing userIds' });
  }

  let channel: any;
  try {
    const snap = await adminDb.collection('channels').doc(channelId).get();
    if (!snap.exists) return res.status(404).json({ error: 'Channel not found' });
    channel = snap.data();
  } catch {
    return res.status(503).json({ error: 'Channel lookup failed' }); // fail closed
  }

  const members: string[] = Array.isArray(channel.members) ? channel.members.filter((m: any) => typeof m === 'string') : [];
  if (caller.superAdmin !== true && !members.includes(caller.uid)) {
    return res.status(403).json({ error: 'Not a member of this channel' });
  }

  // Intersect with the real member list and drop the sender. A target the channel
  // does not contain is silently dropped rather than notified — that is the whole
  // point of resolving the audience server-side.
  const requested = f.userIds.filter((u: any) => typeof u === 'string');
  const targets = requested
    .filter((uid: string) => uid !== caller.uid && members.includes(uid))
    .slice(0, MAX_FANOUT);
  const dropped = requested.length - targets.length;
  if (targets.length === 0) return res.status(200).json({ success: true, notified: 0, dropped });

  const results = await Promise.allSettled(targets.map((uid: string) => notifyUser({
    userId: uid,
    type: typeof f.type === 'string' ? f.type : 'channel_message',
    title,
    message: typeof f.message === 'string' ? f.message.slice(0, 500) : undefined,
    linkTo: channelId,
    imageUrl: typeof f.imageUrl === 'string' ? f.imageUrl : undefined,
    conversationKey: typeof f.conversationKey === 'string' ? f.conversationKey : undefined,
    messageId: typeof f.messageId === 'string' ? f.messageId : undefined,
    // The tenant stamp comes from the CHANNEL, never from the request body — a wrong
    // businessId would hide the row from GDPR export/delete.
    businessId: channel.businessId || null,
    teamId: channel.teamId || null,
    actorUserId: caller.uid,
  })));

  const notified = results.filter(r => r.status === 'fulfilled' && (r.value as any)?.written).length;
  results.forEach(r => {
    if (r.status === 'rejected') console.error('[fanout] notifyUser failed:', r.reason);
  });
  return res.status(200).json({ success: true, notified, dropped });
}
