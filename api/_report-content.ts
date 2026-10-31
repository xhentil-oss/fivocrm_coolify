import type { VercelRequest, VercelResponse } from '@vercel/node';
import { adminDb as db, Timestamp } from './_firebaseAdmin.js';
import { authenticate } from './_callerIdentity.js';
import { checkPersistentRateLimit } from './_rateLimit.js';
import { managerIdsForBusiness } from './_staffRecipients.js';
import { notifyUser, makeTransporter } from './_push.js';
import { safeSenderAddress } from './_emailIdentity.js';
import { isReportReason, cleanReportNote, REPORT_REASON_LABELS } from './_chatModeration.js';

/**
 * POST /api/report-content — "Raporto mesazhin" (App Store guideline 1.2).
 *
 * Body: { messageId, reason: 'spam'|'abuse'|'inappropriate'|'other', note? }
 *
 * The caller must be able to SEE the message (a DM participant, a member of the
 * group channel, staff of the message's business, or the portal client of that
 * thread) — never trust the body for anything but the id. The report is stored in
 * `contentReports/{messageId}_{uid}` (server-only: no rule matches it, so the client
 * can neither read nor forge one) with `create()`, so a second report of the same
 * message by the same person is a no-op, not a second alarm.
 *
 * Then: every manager of the business gets a `content_reported` notification, and
 * the platform inbox (CONTENT_REPORT_EMAIL, default social@fivo.al) gets an email —
 * that is the "act within 24 hours" half of the guideline.
 */

const PLATFORM_INBOX = (process.env.CONTENT_REPORT_EMAIL || 'social@fivo.al').trim();
const REPORTS_PER_HOUR = 30;

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const caller = await authenticate(req);
  if (!caller) return res.status(401).json({ error: 'Unauthorized' });

  const { messageId, reason, note } = (req.body || {}) as Record<string, unknown>;
  if (typeof messageId !== 'string' || !/^[\w-]{1,200}$/.test(messageId)) {
    return res.status(400).json({ error: 'messageId mungon.' });
  }
  if (!isReportReason(reason)) return res.status(400).json({ error: 'Arsyeja e raportimit është e pavlefshme.' });

  if (!(await checkPersistentRateLimit('contentReport', caller.uid, REPORTS_PER_HOUR))) {
    return res.status(429).json({ error: 'Shumë raportime në pak kohë. Provo përsëri më vonë.' });
  }

  const msgSnap = await db.collection('messages').doc(messageId).get();
  if (!msgSnap.exists) return res.status(404).json({ error: 'Mesazhi nuk u gjet.' });
  const msg = msgSnap.data() as Record<string, any>;
  const businessId: string | null = typeof msg.businessId === 'string' ? msg.businessId : null;
  const senderId: string | null = typeof msg.senderId === 'string' ? msg.senderId : null;
  const channelId: string | null = typeof msg.channelId === 'string' ? msg.channelId : null;

  if (senderId && senderId === caller.uid) {
    return res.status(400).json({ error: 'Nuk mund të raportosh mesazhin tënd.' });
  }

  // ── May the caller see this message? ────────────────────────────────────────
  let allowed = caller.superAdmin
    || msg.receiverId === caller.uid
    || (!!businessId && caller.bid === businessId);
  if (!allowed && channelId) {
    // Portal client: their own thread inside their own tenant.
    if (caller.cid && caller.pbid && caller.pbid === businessId && channelId.includes(caller.cid)) allowed = true;
    if (!allowed) {
      const ch = await db.collection('channels').doc(channelId).get();
      const members = ch.exists ? (ch.data() as any)?.members : null;
      if (Array.isArray(members) && members.includes(caller.uid)) allowed = true;
    }
  }
  if (!allowed) return res.status(403).json({ error: 'Nuk ke qasje te ky mesazh.' });

  const cleanNote = cleanReportNote(note);
  const content = typeof msg.content === 'string' ? msg.content.slice(0, 1000) : '';
  const now = Timestamp.now();
  const reportRef = db.collection('contentReports').doc(`${messageId}_${caller.uid}`);
  try {
    await reportRef.create({
      messageId,
      channelId,
      businessId,
      teamId: typeof msg.teamId === 'string' ? msg.teamId : null,
      reportedUserId: senderId,
      reporterUserId: caller.uid,
      reporterEmail: caller.email,
      reason,
      note: cleanNote,
      contentSnapshot: content,
      attachmentUrl: typeof msg.attachmentUrl === 'string' ? msg.attachmentUrl : null,
      status: 'open',
      createdAt: now,
      updatedAt: now,
    });
  } catch (err: any) {
    // 6 = ALREADY_EXISTS: this person already reported this message.
    if (err?.code === 6 || /already exists/i.test(String(err?.message))) {
      return res.status(200).json({ success: true, duplicate: true });
    }
    console.error('[report-content] store failed:', err?.message || err);
    return res.status(500).json({ error: 'Raportimi nuk u ruajt. Provo përsëri.' });
  }

  const reasonLabel = REPORT_REASON_LABELS[reason];
  const preview = content.length > 140 ? `${content.slice(0, 140)}…` : content;

  // Managers of the business — a failed notification must never fail the report.
  try {
    const managers = (await managerIdsForBusiness(businessId, typeof msg.teamId === 'string' ? msg.teamId : null))
      .filter((uid) => uid !== caller.uid);
    await Promise.allSettled(managers.map((uid) => notifyUser({
      userId: uid,
      type: 'content_reported',
      title: `Mesazh i raportuar: ${reasonLabel}`,
      message: preview ? `"${preview}"` : 'Një mesazh në chat u raportua.',
      actionUrl: '/app/chat',
      actionLabel: 'Hap chat-in',
      businessId,
      teamId: typeof msg.teamId === 'string' ? msg.teamId : null,
      actorUserId: caller.uid,
      messageId,
    })));
  } catch (err: any) {
    console.error('[report-content] manager notify failed:', err?.message || err);
  }

  // Platform inbox — the operator reviews every report.
  try {
    const transporter = makeTransporter();
    const from = safeSenderAddress(process.env.SMTP_USER);
    if (transporter && from) {
      await transporter.sendMail({
        from: { name: 'FivoCRM', address: from },
        to: PLATFORM_INBOX,
        subject: `[FivoCRM] Mesazh i raportuar — ${reasonLabel}`,
        html: `
          <p><strong>Arsyeja:</strong> ${escapeHtml(reasonLabel)}</p>
          ${cleanNote ? `<p><strong>Shënimi:</strong> ${escapeHtml(cleanNote)}</p>` : ''}
          <p><strong>Mesazhi:</strong><br>${escapeHtml(content || '(pa tekst)')}</p>
          <p style="color:#6b7280;font-size:12px">
            Raporti: contentReports/${escapeHtml(reportRef.id)}<br>
            Biznesi: ${escapeHtml(businessId || '—')} · Kanali: ${escapeHtml(channelId || 'DM')}<br>
            Dërguesi: ${escapeHtml(senderId || '—')} · Raportuesi: ${escapeHtml(caller.uid)} (${escapeHtml(caller.email || 'pa email të verifikuar')})
          </p>`,
      });
    }
  } catch (err: any) {
    console.error('[report-content] platform email failed:', err?.message || err);
  }

  return res.status(200).json({ success: true });
}
