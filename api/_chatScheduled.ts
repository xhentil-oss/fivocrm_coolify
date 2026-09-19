// ── JOB: chat-scheduled ─────────────────────────────────────────────────────
// Sends chat messages the user scheduled ("Programo") once they are due.
//
// Until Sep 2026 the ONLY sender was a 30-second poll inside ChatView: "Do të
// dërgohet pas 1 orë" happened only if a chat tab was still open at that hour —
// close the app and the message waited for the next visit, then went out late.
// The browser poll still exists (it claims the row first, so it and this job can
// never both send); this job is what makes the promise hold with the app closed.
//
// Cost: one single-field range read (`scheduledAt <= now`, an ISO string written
// by ChatView) over a collection that only ever holds a handful of pending rows;
// each due row costs the message write, the notification fan-out and a delete.
// Scheduled every 5 minutes from vps/server.ts — NOT in run-all.
import admin, { adminDb as db } from './_firebaseAdmin.js';
import { notifyUser } from './_push.js';

const MAX_PER_RUN = 100;
/** Mirrors MAX_FANOUT in api/_send-notification-email.ts. */
const MAX_GROUP_FANOUT = 200;

/** dmThreads doc id — mirrored from ChatView (`dmThreadId`). */
const dmThreadId = (a: string, b: string) => [a, b].sort().join('__');

async function displayNameFor(uid: string): Promise<string> {
  try {
    const p = await db.collection('userProfiles').where('userId', '==', uid).limit(1).get();
    const name = p.empty ? '' : String((p.docs[0].data() as any).displayName || '').trim();
    if (name) return name;
  } catch { /* fall through */ }
  try {
    const m = await db.collection('teamMembers').where('userId', '==', uid).limit(1).get();
    const d = m.empty ? null : (m.docs[0].data() as any);
    const name = String(d?.displayName || '').trim() || String(d?.email || '').split('@')[0];
    if (name) return name;
  } catch { /* fall through */ }
  return 'Koleg';
}

export async function runChatScheduled() {
  const now = admin.firestore.Timestamp.now();
  const nowIso = new Date().toISOString();
  const snap = await db.collection('chatScheduledMessages')
    .where('scheduledAt', '<=', nowIso)
    .limit(MAX_PER_RUN)
    .get();

  const suspended = new Set<string>();
  try {
    const s = await db.collection('businesses').where('status', '==', 'suspended').get();
    s.docs.forEach(d => suspended.add(d.id));
  } catch { /* treat none as suspended */ }

  let sent = 0;
  const blocked: Record<string, number> = {};
  const block = (r: string) => { blocked[r] = (blocked[r] || 0) + 1; };

  for (const d of snap.docs) {
    const s = d.data() as any;
    if (s.sent) { block('already-sent'); continue; }
    if (s.businessId && suspended.has(s.businessId)) { block('tenant-suspended'); continue; }
    const senderId = typeof s.senderId === 'string' ? s.senderId : '';
    const channelId = typeof s.channelId === 'string' && s.channelId ? s.channelId : null;
    const directUserId = typeof s.directUserId === 'string' && s.directUserId ? s.directUserId : null;
    if (!senderId || (!channelId && !directUserId)) {
      block('malformed');
      await d.ref.update({ sent: true, sentAt: now, sentBy: 'cron', error: 'malformed' }).catch(() => {});
      continue;
    }

    // Claim BEFORE sending: the browser poll marks `sent` first as well, so whoever
    // wins the transaction is the only sender.
    const claimed = await db.runTransaction(async (tx) => {
      const fresh = await tx.get(d.ref);
      if (!fresh.exists || (fresh.data() as any)?.sent) return false;
      tx.update(d.ref, { sent: true, sentAt: now, sentBy: 'cron' });
      return true;
    }).catch(() => false);
    if (!claimed) { block('claimed-elsewhere'); continue; }

    try {
      const content = String(s.content || '📎 Bashkëngjitje');
      const attachmentUrl = typeof s.attachmentUrl === 'string' && s.attachmentUrl ? s.attachmentUrl : null;
      const isClient = !!channelId && channelId.startsWith('client-');
      const msgRef = db.collection('messages').doc();
      await msgRef.set({
        content,
        senderId,
        // `isRead` is the STAFF-side flag; a staff→client row is read by the client via
        // `readAt`, so it starts read (same as ChatView's send path).
        isRead: isClient,
        ...(attachmentUrl ? { attachmentUrl } : {}),
        ...(channelId ? { channelId } : { receiverId: directUserId }),
        ...(isClient ? { senderType: 'staff' } : {}),
        businessId: s.businessId || null,
        teamId: s.teamId || null,
        scheduledFromId: d.id,
        createdAt: now,
        updatedAt: now,
        createdByUserId: senderId,
      });
      const senderName = await displayNameFor(senderId);
      const preview = content.slice(0, 100);
      const ops: Promise<any>[] = [];

      if (directUserId) {
        ops.push(notifyUser({
          userId: directUserId,
          type: 'direct_message',
          title: senderName,
          message: preview,
          actionUrl: `/app/chat?directUserId=${senderId}`,
          conversationKey: `dm:${senderId}`,
          messageId: msgRef.id,
          businessId: s.businessId || null,
          teamId: s.teamId || null,
          actorUserId: senderId,
        }));
        ops.push(db.collection('dmThreads').doc(dmThreadId(senderId, directUserId)).set({
          participants: [senderId, directUserId].sort(),
          businessId: s.businessId || null,
          lastMessage: { content: content.slice(0, 140), senderId, createdAt: now, attachment: !!attachmentUrl },
          updatedAt: now,
        }, { merge: true }));
      } else if (isClient && channelId) {
        const custId = channelId.split('-')[1];
        const projId = channelId.match(/-project-(.+)$/)?.[1];
        const cust = custId ? await db.collection('customers').doc(custId).get() : null;
        const custName = cust?.exists ? String((cust.data() as any)?.name || '') : '';
        if (cust?.exists) ops.push(cust.ref.update({ lastClientMessageAt: now }));
        const pa = custId
          ? await db.collection('clientPortalAccess').where('customerId', '==', custId).limit(5).get()
          : null;
        const portalUid = pa?.docs.map(x => x.data() as any).find(a => a.userId && a.status !== 'Inactive')?.userId;
        if (portalUid) {
          ops.push(notifyUser({
            userId: portalUid,
            type: 'staff_message',
            title: `Mesazh i ri nga stafi - ${custName || 'Biseda'}`,
            message: preview,
            actionUrl: projId ? `/portal/chat?project=${encodeURIComponent(projId)}` : '/portal/chat',
            linkTo: channelId,
            conversationKey: `ch:${channelId}`,
            messageId: msgRef.id,
            businessId: s.businessId || null,
            teamId: s.teamId || null,
            customerId: custId || null,
            actorUserId: senderId,
          }));
        } else {
          block('client-without-portal');
        }
      } else if (channelId) {
        const ch = await db.collection('channels').doc(channelId).get();
        const chData = ch.exists ? (ch.data() as any) : null;
        const members: string[] = Array.isArray(chData?.members) ? chData.members.filter((m: any) => typeof m === 'string') : [];
        if (chData?.isGroup) {
          ops.push(ch.ref.update({ lastMessageAt: now, lastMessagePreview: content.slice(0, 140), lastMessageSenderId: senderId }));
        }
        const targets = members.filter(uid => uid !== senderId).slice(0, MAX_GROUP_FANOUT);
        targets.forEach(uid => ops.push(notifyUser({
          userId: uid,
          type: 'channel_message',
          title: `${senderName} · ${chData?.name || 'Kanali'}`,
          message: preview,
          linkTo: channelId,
          conversationKey: `ch:${channelId}`,
          messageId: msgRef.id,
          businessId: chData?.businessId || s.businessId || null,
          teamId: chData?.teamId || s.teamId || null,
          actorUserId: senderId,
        })));
      }

      const results = await Promise.allSettled(ops);
      results.forEach((r, i) => { if (r.status === 'rejected') console.error(`[CRON:chat-scheduled] side-effect[${i}] failed`, r.reason); });
      await d.ref.delete().catch(() => {});
      sent++;
    } catch (err) {
      console.error('[CRON:chat-scheduled] send failed', d.id, err);
      // Leave the claim in place: an ambiguous "did it send?" must never retry.
      await d.ref.update({ error: err instanceof Error ? err.message : String(err) }).catch(() => {});
      block('send-failed');
    }
  }

  return { scanned: snap.size, sent, blocked };
}
