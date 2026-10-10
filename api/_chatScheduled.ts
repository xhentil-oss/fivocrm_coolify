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
import { safeSenderAddress } from './_emailIdentity.js';
import nodemailer from 'nodemailer';

const MAX_PER_RUN = 100;
/** Mirrors MAX_FANOUT in api/_send-notification-email.ts. */
const MAX_GROUP_FANOUT = 200;

/** dmThreads doc id — mirrored from ChatView (`dmThreadId`). */
const dmThreadId = (a: string, b: string) => [a, b].sort().join('__');

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');

/**
 * Email fallback for a scheduled client-thread message when the customer has no
 * portal login — parity with the live send, which posts `notify-client` through
 * /api/send-invoice-email. The template mirrors that endpoint's.
 */
async function emailClientFallback(args: { to: string; name: string; senderName: string; preview: string }): Promise<boolean> {
  const smtpUser = safeSenderAddress(process.env.SMTP_USER);
  if (!smtpUser || !process.env.SMTP_PASS) return false;
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'mail.fivoo.net',
    port: Number(process.env.SMTP_PORT) || 465,
    secure: true,
    auth: { user: smtpUser, pass: process.env.SMTP_PASS },
  });
  const appUrl = process.env.VITE_APP_URL || 'https://app.fivoo.net';
  const name = escapeHtml(args.name || args.to.split('@')[0]);
  const from = escapeHtml(args.senderName.slice(0, 80) || 'Ekipi');
  const preview = escapeHtml(args.preview.slice(0, 200) || 'Keni një mesazh të ri.');
  await transporter.sendMail({
    from: `"FivoCRM" <${smtpUser}>`,
    to: args.to,
    subject: `Mesazh i ri nga ${from}`.replace(/[\n\r]/g, '').slice(0, 180),
    html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;background:#f9fafb;border-radius:8px;"><h2 style="color:#2563eb;margin-top:0;">Mesazh i ri</h2><p style="color:#374151;">Përshëndetje, <strong>${name}</strong>!</p><p style="color:#374151;"><strong>${from}</strong> ju ka dërguar një mesazh:</p><blockquote style="border-left:3px solid #2563eb;padding:10px 14px;background:#eff6ff;border-radius:4px;margin:16px 0;color:#1e40af;font-style:italic;">${preview}</blockquote><a href="${appUrl}/portal/chat" style="display:inline-block;background:#2563eb;color:#fff;padding:11px 24px;border-radius:6px;text-decoration:none;font-weight:bold;margin-top:8px;">Hap portalin</a><p style="color:#9ca3af;font-size:11px;margin-top:28px;border-top:1px solid #e5e7eb;padding-top:12px;">FivoCRM &mdash; Platforma juaj e biznesit</p></div>`,
  });
  return true;
}

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

/**
 * `opts.businessId` = a manual run from one tenant's Admin: rows of other tenants
 * — and rows that carry no businessId at all, which cannot be proven to be the
 * caller's — are left for the scheduled run. Applied in memory before the claim,
 * because the range read cannot take a businessId clause without a composite index.
 */
export async function runChatScheduled(opts?: { businessId?: string | null }) {
  const scopeId = opts?.businessId || null;
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
    if (scopeId && s.businessId !== scopeId) { block('out-of-scope'); continue; }
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

      // Resolve a GROUP target BEFORE writing anything, and prove the sender's
      // membership — defence in depth with the create rule: a row minted before
      // the rule (or into a since-deleted group, or with a foreign businessId next
      // to another tenant's channelId) must never be sent with nobody looking.
      let chSnap: FirebaseFirestore.DocumentSnapshot | null = null;
      let chData: any = null;
      let chMembers: string[] = [];
      if (channelId && !isClient) {
        chSnap = await db.collection('channels').doc(channelId).get();
        chData = chSnap.exists ? (chSnap.data() as any) : null;
        chMembers = Array.isArray(chData?.members) ? chData.members.filter((m: any) => typeof m === 'string') : [];
        if (chData?.isGroup && !chMembers.includes(senderId)) {
          block('not-a-member');
          await d.ref.update({ error: 'not-a-member' }).catch(() => {});
          continue;
        }
        if (chData?.businessId && s.businessId && chData.businessId !== s.businessId) {
          block('cross-tenant');
          await d.ref.update({ error: 'cross-tenant' }).catch(() => {});
          continue;
        }
      }
      // Tenant stamp: the channel's own businessId wins (groups), then the row's.
      const msgBusinessId = (chData?.businessId as string | undefined) || s.businessId || null;
      const msgTeamId = (chData?.teamId as string | undefined) || s.teamId || null;
      const mentionUids: string[] = (Array.isArray(s.mentions) ? s.mentions : [])
        .filter((u: any) => typeof u === 'string' && u && u !== senderId);

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
        ...(mentionUids.length > 0 && channelId && !isClient ? { mentions: mentionUids } : {}),
        businessId: msgBusinessId,
        teamId: msgTeamId,
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
          businessId: msgBusinessId,
          teamId: msgTeamId,
          actorUserId: senderId,
        }));
        // businessId only when the row carries one — a `businessId: null` in this
        // merge used to OVERWRITE the correct tenant key a prior live DM stamped.
        ops.push(db.collection('dmThreads').doc(dmThreadId(senderId, directUserId)).set({
          participants: [senderId, directUserId].sort(),
          ...(msgBusinessId ? { businessId: msgBusinessId } : {}),
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
        const custBusinessId = cust?.exists ? ((cust.data() as any)?.businessId || null) : null;
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
            businessId: custBusinessId || msgBusinessId,
            teamId: msgTeamId,
            customerId: custId || null,
            actorUserId: senderId,
          }));
        } else {
          // Parity with the live send: a customer with no portal login still gets
          // the direct email (the live path posts `notify-client`); "scheduled it,
          // nobody got anything" used to be just a tally.
          const custEmail = cust?.exists ? String((cust.data() as any)?.email || '').trim() : '';
          const paEmail = pa?.docs.map(x => x.data() as any).find(a => typeof a.email === 'string' && a.email)?.email || '';
          const to = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(custEmail) ? custEmail
            : (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(paEmail) ? paEmail : '');
          if (to) {
            ops.push(emailClientFallback({ to, name: custName, senderName, preview: content.slice(0, 200) })
              .then(ok => { if (!ok) block('client-email-unconfigured'); }));
          } else {
            block('client-without-portal');
          }
        }
      } else if (channelId) {
        if (chData?.isGroup && chSnap) {
          ops.push(chSnap.ref.update({ lastMessageAt: now, lastMessagePreview: content.slice(0, 140), lastMessageSenderId: senderId }));
        }
        // An @mention scheduled in a group keeps its `mention` row (live-send
        // parity) — the rest of the members get the plain channel_message.
        const mentionTargets = new Set(mentionUids.filter(uid => chMembers.includes(uid)));
        const targets = chMembers.filter(uid => uid !== senderId).slice(0, MAX_GROUP_FANOUT);
        targets.forEach(uid => ops.push(notifyUser({
          userId: uid,
          type: mentionTargets.has(uid) ? 'mention' : 'channel_message',
          title: mentionTargets.has(uid)
            ? `${senderName} ju përmendi`
            : `${senderName} · ${chData?.name || 'Kanali'}`,
          message: preview,
          linkTo: channelId,
          conversationKey: `ch:${channelId}`,
          messageId: msgRef.id,
          businessId: msgBusinessId,
          teamId: msgTeamId,
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
