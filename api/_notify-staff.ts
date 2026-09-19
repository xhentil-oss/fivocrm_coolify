import type { VercelRequest, VercelResponse } from '@vercel/node';
import admin, { adminAuth, adminDb as db } from './_firebaseAdmin.js';
import { notifyUser } from './_push.js';
import { NOTIFICATION_TYPE_CATEGORY } from './_notificationTypes.js';
import { checkPersistentRateLimit } from './_rateLimit.js';

// Each call fans out (doc + push to every device + email) to every Admin/Manager/
// CRM-capable member of the tenant, and can create a task — so the ceiling is per
// CALLER, not per recipient. A legitimately chatty client sends well under this.
const NOTIFY_STAFF_PER_HOUR = 120;

/**
 * POST /api/notify-staff
 * Header: Authorization: Bearer <Firebase ID token of a PORTAL CLIENT>
 * Body: { type, title, message, actionUrl?, actionLabel?, linkTo?, projectId?,
 *         responsibleUserId? }
 *
 * Lets a portal client notify the staff of THEIR OWN tenant without reading the
 * tenant's staff directory from the browser.
 *
 * Before this endpoint, every portal view read `teamMembers` with
 * `skipTeamFilter: true` — i.e. every tenant's staff records (including salary
 * fields) were readable by any logged-in client, and the recipient list was
 * filtered client-side. Recipients are now resolved server-side from the client's
 * own customer → businessId, so:
 *   - the portal never reads `teamMembers` (that rule can be locked to the tenant),
 *   - notifications can never fan out to another tenant's admins.
 */
const ADMIN_ROLES = new Set(['Admin', 'Owner', 'SuperAdmin']);
const FIRST_RESPONSE_SLA_HOURS = 2;

interface RoutingMember {
  userId: string; teamId?: string; role?: string; status?: string; businessId?: string; canAccessCRM?: boolean;
}

/**
 * Server mirror of src/lib/conversationRouting.ts. Owner → owner's team → that
 * team's manager → the customer's sales agent → all admins of the business.
 * Never crosses the tenant boundary: `members` is already business-filtered.
 */
async function upsertConversation(args: {
  channelId: string; channel: string; businessId: string; teamId: string | null;
  customerId: string; subject: string | null; ownerId: string | null; salesAgentId: string | null;
  members: RoutingMember[]; actorUserId: string; now: admin.firestore.Timestamp;
}) {
  const active = args.members.filter((m) => (m.status ?? 'Active') === 'Active');
  const ownerMember = args.ownerId ? active.find((m) => m.userId === args.ownerId) : undefined;
  const teamId = ownerMember?.teamId || args.teamId || null;

  const managerId = (teamId
    ? active.find((m) => m.teamId === teamId && m.role === 'Manager')?.userId
    : undefined) || null;
  const teamMemberIds = teamId ? active.filter((m) => m.teamId === teamId).map((m) => m.userId) : [];
  const adminIds = active.filter((m) => !!m.role && ADMIN_ROLES.has(m.role)).map((m) => m.userId);
  const fallbackManagers = !args.ownerId && !managerId
    ? active.filter((m) => m.role === 'Manager' || (m.role && ADMIN_ROLES.has(m.role))).map((m) => m.userId)
    : [];

  const watchers = Array.from(new Set([
    args.ownerId, ...teamMemberIds, managerId, args.salesAgentId, ...adminIds, ...fallbackManagers,
  ].filter((x): x is string => !!x)));

  const ref = db.collection('conversations').doc(args.channelId);
  const snap = await ref.get();

  if (!snap.exists) {
    await ref.set({
      channel: args.channel,
      businessId: args.businessId,
      teamId,
      customerId: args.customerId,
      leadId: null,
      phone: null,
      subject: args.subject,
      ownerId: args.ownerId,
      managerId,
      salesAgentId: args.salesAgentId,
      watchers,
      unassigned: !args.ownerId,
      status: 'open',
      slaFirstResponseDueAt: admin.firestore.Timestamp.fromMillis(
        args.now.toMillis() + FIRST_RESPONSE_SLA_HOURS * 3600_000,
      ),
      slaBreachNotified: false,
      lastMessageAt: args.now,
      createdAt: args.now,
      updatedAt: args.now,
      createdByUserId: args.actorUserId,
    });
    return;
  }

  const existing = snap.data() as any;
  const patch: Record<string, any> = { lastMessageAt: args.now, updatedAt: args.now };
  // Upgrade an ownerless thread as soon as an owner can be resolved; never clobber a
  // manual reassignment.
  if (existing.unassigned && args.ownerId) {
    Object.assign(patch, {
      ownerId: args.ownerId,
      teamId,
      managerId,
      salesAgentId: args.salesAgentId,
      watchers: Array.from(new Set([...(existing.watchers || []), ...watchers])),
      unassigned: false,
    });
  }
  await ref.update(patch);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });

  let decoded: admin.auth.DecodedIdToken;
  try {
    decoded = await adminAuth.verifyIdToken(authHeader.slice(7));
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }

  const {
    type, title, message, actionUrl, actionLabel, linkTo, projectId, responsibleUserId,
    // Chat only: lets delivery skip push+email while the recipient is reading this
    // very thread, and lets the reader dismiss the row when the message is deleted.
    conversationKey, messageId,
    // Optional: also upsert the persistent conversation thread (owner + watchers).
    conversation,
    // Optional: create a follow-up task for the tenant's sales staff (portal
    // questionnaire → "contact this lead"). Assignment needs the staff list, so it
    // happens here rather than in the browser.
    task,
  } = (req.body || {}) as Record<string, any>;

  if (!type || !title) return res.status(400).json({ error: 'Missing type/title' });

  // This endpoint had NO rate limit: a hostile/buggy portal client could flood the
  // whole management team with pushes/emails/tasks in a loop.
  if (!(await checkPersistentRateLimit('notifyStaff', decoded.uid, NOTIFY_STAFF_PER_HOUR))) {
    return res.status(429).json({ error: 'Rate limited', limitPerHour: NOTIFY_STAFF_PER_HOUR, retryAfterSeconds: 3600 });
  }

  const clean = (v: any, max = 500) => (typeof v === 'string' ? v.slice(0, max) : undefined);

  // actionUrl is CLIENT-supplied and lands in staff notifications, whose bell
  // navigates to it on tap — allow only in-app staff paths. (The portal bell has the
  // mirror check with '/portal'; every legitimate caller sends '/app/…'.)
  const safeActionUrl = (() => {
    const u = clean(actionUrl, 500);
    return u && u.startsWith('/app/') && !u.startsWith('//') ? u : undefined;
  })();

  // ── Resolve the caller's customer (portal identity) ──
  let customerId: string | null = null;
  try {
    const u = await db.collection('users').doc(decoded.uid).get();
    customerId = (u.exists ? (u.data() as any)?.customerId : null) || null;
  } catch { /* fall through */ }
  if (!customerId) {
    try {
      const pa = await db.collection('clientPortalAccess').where('userId', '==', decoded.uid).limit(5).get();
      const active = pa.docs.map((d) => d.data() as any).find((a) => a.status === 'Active' && a.customerId);
      customerId = active?.customerId || null;
    } catch { /* fall through */ }
  }
  if (!customerId) return res.status(403).json({ error: 'No portal client identity for this account' });

  // ── The tenant is the customer's business — never taken from the request ──
  let businessId: string | null = null;
  let teamId: string | null = null;
  try {
    const c = await db.collection('customers').doc(customerId).get();
    if (!c.exists) return res.status(404).json({ error: 'Customer not found' });
    const cd = c.data() as any;
    businessId = cd.businessId || null;
    teamId = cd.teamId || null;
    // Sanity: the caller must actually own this customer record.
    const callerEmail = (decoded.email || '').toLowerCase();
    const customerEmail = (cd.email || '').toLowerCase();
    if (callerEmail && customerEmail && callerEmail !== customerEmail) {
      // users/{uid}.customerId is rules-validated by email, but re-check here since
      // this endpoint bypasses rules.
      const pa = await db.collection('clientPortalAccess')
        .where('userId', '==', decoded.uid).where('customerId', '==', customerId).limit(1).get();
      if (pa.empty) return res.status(403).json({ error: 'Not your customer record' });
    }
  } catch {
    return res.status(500).json({ error: 'Could not resolve tenant' });
  }
  if (!businessId) return res.status(422).json({ error: 'Customer has no businessId (tenant unresolved)' });

  // ── Recipients: staff of THIS business only ──
  const recipients = new Set<string>();
  let members: Array<{ userId: string; teamId?: string; role?: string; status?: string; businessId?: string; canAccessCRM?: boolean }> = [];
  try {
    const snap = await db.collection('teamMembers').where('businessId', '==', businessId).get();
    members = snap.docs.map((d) => d.data() as any);
    for (const m of members) {
      if (m.status === 'Inactive' || !m.userId) continue;
      const isLead = m.role === 'Admin' || m.role === 'Manager' || m.canAccessCRM === true;
      if (isLead) recipients.add(m.userId);
    }
    // The explicitly responsible person (project owner) — only if in this business.
    if (typeof responsibleUserId === 'string' && responsibleUserId) {
      if (members.some((m) => m.userId === responsibleUserId)) recipients.add(responsibleUserId);
    }
  } catch {
    return res.status(500).json({ error: 'Could not resolve recipients' });
  }

  const now = admin.firestore.Timestamp.now();

  // ── Optional: conversation thread routing (owner + watchers) ──
  // Done here, server-side, because computing watchers needs the tenant's staff list
  // — which the portal must not read. Mirrors src/lib/conversationRouting.ts.
  if (conversation && typeof conversation.channelId === 'string' && conversation.channelId) {
    try {
      await upsertConversation({
        channelId: conversation.channelId,
        channel: typeof conversation.channel === 'string' ? conversation.channel : 'portal',
        businessId,
        teamId: typeof conversation.teamId === 'string' ? conversation.teamId : teamId,
        customerId,
        subject: clean(conversation.subject, 200) || null,
        ownerId: members.some((m) => m.userId === responsibleUserId) ? responsibleUserId : null,
        salesAgentId: typeof conversation.salesAgentId === 'string' ? conversation.salesAgentId : null,
        members,
        actorUserId: decoded.uid,
        now,
      });
    } catch { /* never block the notification on routing */ }
  }

  // ── Optional: follow-up task for sales staff of this tenant ──
  let taskId: string | null = null;
  if (task && typeof task.title === 'string' && task.title.trim()) {
    try {
      const salesStaff = members.filter(
        (m) => m.status !== 'Inactive' && m.userId && (m.role === 'Admin' || m.canAccessCRM === true),
      );
      const assignee = salesStaff[0]?.userId || null;
      const dueDate = typeof task.dueInDays === 'number' && task.dueInDays >= 0
        ? admin.firestore.Timestamp.fromMillis(now.toMillis() + task.dueInDays * 86_400_000)
        : admin.firestore.Timestamp.fromMillis(now.toMillis() + 86_400_000);
      const ref = db.collection('tasks').doc();
      await ref.set({
        title: clean(task.title, 300),
        description: clean(task.description, 4000) || '',
        status: 'Todo',
        priority: ['low', 'medium', 'high', 'urgent'].includes(task.priority) ? task.priority : 'high',
        startDate: now,
        endDate: dueDate,
        dueDate,
        assignedToUserId: assignee || '',
        ...(clean(task.leadId, 200) ? { leadId: clean(task.leadId, 200) } : {}),
        businessId,
        ...(salesStaff[0]?.teamId ? { teamId: salesStaff[0].teamId } : (teamId ? { teamId } : {})),
        customerId,
        createdAt: now,
        updatedAt: now,
        createdByUserId: decoded.uid,
      });
      taskId = ref.id;
    } catch { /* never block on task creation */ }
  }

  // Thread routing: when the conversation already has an OWNER, route to the owner
  // and its watchers instead of every lead in the business (the watchers list was
  // computed above by upsertConversation and already contains the managers/admins
  // who should see it). Threads without an owner keep the broad audience.
  if (conversation && typeof conversation.channelId === 'string' && conversation.channelId) {
    try {
      const conv = await db.collection('conversations').doc(conversation.channelId).get();
      const cd = conv.exists ? (conv.data() as any) : null;
      const memberIds = new Set(members.filter((m) => m.status !== 'Inactive' && m.userId).map((m) => m.userId));
      if (cd?.ownerId && memberIds.has(cd.ownerId)) {
        const routed = new Set<string>([cd.ownerId]);
        (Array.isArray(cd.watchers) ? cd.watchers : []).forEach((w: any) => { if (typeof w === 'string' && memberIds.has(w)) routed.add(w); });
        recipients.clear();
        routed.forEach((uid) => recipients.add(uid));
      }
    } catch { /* keep the broad audience */ }
  }

  if (recipients.size === 0) return res.status(200).json({ success: true, notified: 0, taskId });

  // Doc + push + email per recipient. This was a plain batched write, so the single
  // most time-critical direction in the product — a CLIENT contacting the team (new
  // message, new request, a quote decision) — produced nothing but a red dot that
  // staff only saw if they already had the app open.
  // The type is client-supplied and MUST be registered: an unknown value fails OPEN
  // through every category mute (that fail-open exists for legacy rows), so an
  // unvalidated type would let the portal send notifications staff can never mute.
  const rawType = clean(type, 60) || 'client_request';
  const safeType = Object.prototype.hasOwnProperty.call(NOTIFICATION_TYPE_CATEGORY, rawType)
    ? rawType
    : 'client_request';

  const results = await Promise.allSettled([...recipients].map(uid => notifyUser({
    userId: uid,
    type: safeType,
    title: clean(title, 200) || 'Njoftim i ri',
    message: clean(message, 1000) || '',
    actionUrl: safeActionUrl,
    actionLabel: clean(actionLabel, 60) || undefined,
    linkTo: clean(linkTo, 200) || undefined,
    projectId: clean(projectId, 200) || undefined,
    businessId,
    teamId: teamId || null,
    customerId,
    actorUserId: decoded.uid,
    conversationKey: typeof conversationKey === 'string' ? conversationKey.slice(0, 200) : undefined,
    messageId: typeof messageId === 'string' ? messageId.slice(0, 200) : undefined,
  })));
  const notified = results.filter(r => r.status === 'fulfilled' && (r.value as any)?.written).length;

  return res.status(200).json({ success: true, notified, taskId });
}
