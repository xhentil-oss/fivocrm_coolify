import { safeSenderAddress, senderHeader } from './_emailIdentity.js';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import admin, { adminAuth, adminDb as db } from './_firebaseAdmin.js';
import { writeAudit } from './_audit.js';
import { getTeamConfig } from './_tenantConfig.js';
import { notifyUser } from './_push.js';
import nodemailer from 'nodemailer';

/**
 * POST /api/reports   (routed as /api/email?type=reports)
 *
 * The ONLY path that may write client-driven report state. Firestore rules deny a
 * portal client every write to `reports`, `reportApprovals` and `reportEvents`, so
 * "the client approved v3" cannot be forged from a browser — it has to come through
 * here, where the server re-checks:
 *
 *   1. the caller's identity (Firebase ID token),
 *   2. that the report BELONGS to that caller's customer,
 *   3. that the report is actually published (a draft cannot be approved),
 *   4. that the transition is legal for a client actor.
 *
 * Actions
 *   client  : view · pdf-downloaded · acknowledge · approve · reject · comment
 *   staff   : send-email  (delivers the client-safe PDF/summary + a portal link)
 *
 * The status machine is duplicated here in a deliberately minimal form rather than
 * imported from `src/lib/reporting/workflow.ts`: `/api` is bundled separately by
 * Vercel and must not pull the React-side module graph. The two are kept in step by
 * the shared table below, which mirrors `canTransition`'s client branch exactly.
 */

// Statuses that mean "the client has been given this report".
const PUBLISHED = new Set([
  'published', 'sent', 'viewed', 'acknowledged', 'client_approved', 'client_rejected',
]);

// Report kinds a client may ever interact with (mirrors isClientFacingKind).
const CLIENT_FACING_KINDS = new Set([
  'client-monthly', 'qbr', 'project-status', 'project-completion',
  'campaign-completion', 'website-launch', 'incident',
]);

// Client-driven target statuses, and the audit event each records.
const CLIENT_ACTIONS: Record<string, { status?: string; event: string; needsReason?: boolean }> = {
  view: { status: 'viewed', event: 'viewed' },
  'pdf-downloaded': { event: 'pdf-downloaded' },
  acknowledge: { status: 'acknowledged', event: 'client-acknowledged' },
  approve: { status: 'client_approved', event: 'client-approved' },
  reject: { status: 'client_rejected', event: 'client-rejected', needsReason: true },
  comment: { event: 'commented' },
};

interface Caller {
  uid: string;
  email?: string | null;
  /** Portal client's customerId (claim `cid`). */
  customerId?: string | null;
  /** Portal client's tenant (claim `pbid`). */
  portalBusinessId?: string | null;
  /** Staff businessId (claim `bid`). */
  businessId?: string | null;
  roles: string[];
  superAdmin: boolean;
}

async function authenticate(req: VercelRequest): Promise<Caller | null> {
  const header = req.headers.authorization as string | undefined;
  if (!header?.startsWith('Bearer ')) return null;
  try {
    const t = await adminAuth.verifyIdToken(header.slice(7));
    return {
      uid: t.uid,
      email: (t.email as string) || null,
      customerId: (t.cid as string) || null,
      portalBusinessId: (t.pbid as string) || null,
      businessId: (t.bid as string) || null,
      roles: Array.isArray(t.roles) ? (t.roles as string[]) : [],
      superAdmin: t.superAdmin === true,
    };
  } catch {
    return null;
  }
}

/**
 * Fallback identity resolution for tokens minted before the claims rollout.
 * Mirrors the Firestore rules' `users/{uid}` fallback, and is validated the same
 * way: the marker only counts when a real record backs it.
 */
async function resolveCustomerId(caller: Caller): Promise<string | null> {
  if (caller.customerId) return caller.customerId;
  try {
    const snap = await db.collection('users').doc(caller.uid).get();
    const cid = snap.exists ? (snap.data()?.customerId as string | undefined) : undefined;
    if (!cid) return null;
    // Confirm the customer really is this person (email match), exactly as the rules do.
    const cust = await db.collection('customers').doc(cid).get();
    const email = (cust.data()?.email as string | undefined)?.toLowerCase();
    if (!email || !caller.email || email !== caller.email.toLowerCase()) return null;
    return cid;
  } catch {
    return null;
  }
}

/** Is the caller staff of this business? */
async function isStaffOf(caller: Caller, businessId: string): Promise<boolean> {
  if (caller.superAdmin) return true;
  if (caller.businessId && caller.businessId === businessId) return true;
  try {
    const snap = await db.collection('teamMembers')
      .where('userId', '==', caller.uid)
      .where('businessId', '==', businessId)
      .limit(1)
      .get();
    return !snap.empty && snap.docs[0].data()?.status !== 'Inactive';
  } catch {
    return false;
  }
}

async function appendEvent(entry: {
  businessId: string;
  reportId: string;
  kind: string;
  version?: number;
  actorType: 'client' | 'staff' | 'system';
  actorUserId?: string | null;
  actorCustomerId?: string | null;
  customerId?: string | null;
  reason?: string;
  comment?: string;
  ip?: string | null;
  userAgent?: string | null;
  meta?: Record<string, unknown>;
}) {
  try {
    await db.collection('reportEvents').add({
      ...entry,
      createdAt: admin.firestore.Timestamp.now(),
      createdByUserId: entry.actorUserId || null,
    });
  } catch (err) {
    console.error('[reports] event append failed', err);
  }
}

/** Client IP as reported by Vercel's edge, for legally meaningful actions only. */
function clientIp(req: VercelRequest): string | null {
  const fwd = req.headers['x-forwarded-for'];
  const raw = Array.isArray(fwd) ? fwd[0] : fwd;
  return raw ? String(raw).split(',')[0].trim() : null;
}

function makeTransporter() {
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!user || !pass) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'mail.fivoo.net',
    port: Number(process.env.SMTP_PORT) || 465,
    secure: true,
    auth: { user, pass },
  });
}

const escapeHtml = (s: string) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const caller = await authenticate(req);
  if (!caller) return res.status(401).json({ error: 'Unauthorized' });

  const body = (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body) || {};
  const action = String(body.action || '');
  const reportId = String(body.reportId || '');
  if (!action || !reportId) return res.status(400).json({ error: 'action and reportId are required' });

  const ref = db.collection('reports').doc(reportId);
  const snap = await ref.get();
  if (!snap.exists) return res.status(404).json({ error: 'Report not found' });
  const report = snap.data() as any;
  const businessId: string = report.businessId;

  if (action === 'send-email') {
    return handleSendEmail({ req, res, caller, ref, report, businessId });
  }

  const spec = CLIENT_ACTIONS[action];
  if (!spec) return res.status(400).json({ error: `Unknown action "${action}"` });

  // ── client authorisation ──
  const customerId = await resolveCustomerId(caller);
  if (!customerId) return res.status(403).json({ error: 'Not a portal client' });
  if (!report.customerId || report.customerId !== customerId) {
    // Do not disclose that the report exists.
    return res.status(404).json({ error: 'Report not found' });
  }
  if (caller.portalBusinessId && caller.portalBusinessId !== businessId) {
    return res.status(404).json({ error: 'Report not found' });
  }
  if (report.deletedAt) return res.status(404).json({ error: 'Report not found' });
  if (!CLIENT_FACING_KINDS.has(String(report.kind))) {
    return res.status(403).json({ error: 'Report is not client-facing' });
  }
  if (!PUBLISHED.has(String(report.status))) {
    return res.status(409).json({ error: 'Report has not been published' });
  }
  if (spec.needsReason && !String(body.reason || '').trim()) {
    return res.status(400).json({ error: 'A reason is required' });
  }

  const now = admin.firestore.Timestamp.now();
  const version = Number(report.version || 1);
  const ip = clientIp(req);
  const userAgent = (req.headers['user-agent'] as string) || null;

  // ── comment ──
  if (action === 'comment') {
    const text = String(body.body || '').trim();
    if (!text) return res.status(400).json({ error: 'Comment body is required' });
    if (text.length > 5000) return res.status(400).json({ error: 'Comment is too long' });

    const commentRef = await db.collection('reportComments').add({
      businessId,
      reportId,
      customerId,
      parentId: body.parentId ? String(body.parentId) : null,
      blockId: body.blockId ? String(body.blockId) : null,
      body: text,
      // A client comment is NEVER internal — that is the whole boundary.
      internal: false,
      authorUserId: caller.uid,
      authorCustomerId: customerId,
      authorName: report.customerName || null,
      resolvedAt: null,
      createdAt: now,
      updatedAt: now,
      createdByUserId: caller.uid,
    });

    await appendEvent({
      businessId, reportId, kind: 'commented', version,
      actorType: 'client', actorUserId: caller.uid, actorCustomerId: customerId,
      customerId, comment: text.slice(0, 500),
    });
    await notifyStaffOfReport(businessId, report, 'Koment i re nga klienti',
      `${report.customerName || 'Klienti'}: ${text.slice(0, 140)}`, reportId);

    return res.status(200).json({ ok: true, commentId: commentRef.id });
  }

  // ── status-bearing actions ──
  const patch: Record<string, unknown> = { updatedAt: now };

  if (spec.status === 'viewed') {
    // Never regress a decided report back to "viewed" — a client re-reading an
    // approved report must not undo their own approval.
    if (report.status === 'published' || report.status === 'sent') patch.status = 'viewed';
    patch.lastViewedAt = now;
    patch.viewCount = admin.firestore.FieldValue.increment(1);
    if (!report.firstViewedAt) patch.firstViewedAt = now;
  } else if (spec.status === 'acknowledged') {
    if (report.status === 'client_approved' || report.status === 'client_rejected') {
      return res.status(409).json({ error: 'Report already decided' });
    }
    patch.status = 'acknowledged';
    patch.acknowledgedAt = now;
  } else if (spec.status === 'client_approved' || spec.status === 'client_rejected') {
    if (report.clientDecisionAt) return res.status(409).json({ error: 'Report already decided' });
    patch.status = spec.status;
    patch.clientDecisionAt = now;
    patch.clientDecisionByUserId = caller.uid;
    if (spec.status === 'client_approved') {
      // Sign-off always references the exact version (§38.9), and a signed-off
      // report becomes a record that cannot be hard-deleted (§38.8).
      patch.clientApprovedVersion = version;
      patch.legalHold = true;
    }
  }

  if (Object.keys(patch).length > 1) await ref.update(patch);

  // Decisions are evidence: append-only, version-pinned, with IP + user agent.
  if (spec.status === 'acknowledged' || spec.status === 'client_approved' || spec.status === 'client_rejected') {
    await db.collection('reportApprovals').add({
      businessId,
      reportId,
      version,
      step: 99, // the client is always the last link in the chain
      stage: 'client',
      decision: spec.status === 'client_approved' ? 'approved'
        : spec.status === 'client_rejected' ? 'rejected' : 'acknowledged',
      approverUserId: caller.uid,
      approverCustomerId: customerId,
      approverName: report.customerName || null,
      comment: String(body.reason || '').trim() || null,
      ip,
      userAgent,
      createdAt: now,
      createdByUserId: caller.uid,
    });
  }

  await appendEvent({
    businessId, reportId, kind: spec.event, version,
    actorType: 'client', actorUserId: caller.uid, actorCustomerId: customerId,
    customerId,
    reason: String(body.reason || '').trim() || undefined,
    // Recorded only for the actions where provenance matters legally.
    ip: spec.status && spec.status !== 'viewed' ? ip : null,
    userAgent: spec.status && spec.status !== 'viewed' ? userAgent : null,
  });

  if (spec.status && spec.status !== 'viewed') {
    const titles: Record<string, string> = {
      acknowledged: 'Klienti konfirmoi raportin',
      client_approved: 'Klienti aprovoi raportin',
      client_rejected: 'Klienti kërkoi sqarime',
    };
    await notifyStaffOfReport(
      businessId, report,
      titles[spec.status] || 'Veprim nga klienti',
      `${report.title}${body.reason ? ` — "${String(body.reason).slice(0, 140)}"` : ''}`,
      reportId,
    );
  }

  return res.status(200).json({ ok: true, status: patch.status || report.status });
}

/**
 * Notify the report's owners inside the tenant. Never fans out beyond the report's
 * own business, and never reads another tenant's staff.
 */
async function notifyStaffOfReport(
  businessId: string,
  report: any,
  title: string,
  message: string,
  reportId: string,
) {
  const targets = new Set<string>(
    [report.authorUserId, report.accountManagerUserId, report.reviewerUserId, report.approverUserId]
      .filter((x: unknown): x is string => typeof x === 'string' && !!x),
  );
  if (targets.size === 0) {
    try {
      const admins = await db.collection('teamMembers')
        .where('businessId', '==', businessId)
        .where('role', 'in', ['Admin', 'Owner'])
        .limit(5)
        .get();
      for (const d of admins.docs) {
        const uid = d.data()?.userId;
        if (uid) targets.add(String(uid));
      }
    } catch { /* best effort */ }
  }
  // Doc + push + email. A client approving or rejecting a report is exactly the
  // kind of event staff should not have to discover by opening the app.
  await Promise.allSettled([...targets].map(uid => notifyUser({
    userId: uid,
    type: 'report',
    title,
    message,
    actionUrl: `/app/reports/${reportId}`,
    actionLabel: 'Hap raportin',
    businessId,
  })));
}

/**
 * Staff action: email the report to the client.
 *
 * The email carries a SUMMARY plus a portal link, never the internal narrative:
 * the authoritative, redacted document lives in the portal (and the PDF the portal
 * generates). That keeps §20's "do not expose internal data in emails" true by
 * construction rather than by careful template authoring.
 */
async function handleSendEmail(args: {
  req: VercelRequest;
  res: VercelResponse;
  caller: Caller;
  ref: admin.firestore.DocumentReference;
  report: any;
  businessId: string;
}) {
  const { req, res, caller, ref, report, businessId } = args;

  if (!(await isStaffOf(caller, businessId))) {
    return res.status(403).json({ error: 'Not a member of this tenant' });
  }
  if (!PUBLISHED.has(String(report.status))) {
    return res.status(409).json({ error: 'Publish the report before sending it' });
  }

  const body = (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body) || {};
  const recipients: string[] = Array.isArray(body.to)
    ? body.to.map((x: unknown) => String(x).trim().toLowerCase()).filter(Boolean)
    : [];
  const cc: string[] = Array.isArray(body.cc)
    ? body.cc.map((x: unknown) => String(x).trim().toLowerCase()).filter(Boolean)
    : [];

  if (!recipients.length) return res.status(400).json({ error: 'At least one recipient is required' });
  const invalid = [...recipients, ...cc].find(e => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
  if (invalid) return res.status(400).json({ error: `Invalid email: ${invalid}` });

  const transporter = makeTransporter();
  if (!transporter) return res.status(503).json({ error: 'SMTP is not configured' });
  const fromAddress = safeSenderAddress(process.env.SMTP_USER);
  if (!fromAddress) return res.status(503).json({ error: 'SMTP_USER is not a valid sender address' });

  const config = await getTeamConfig(report.teamId || businessId).catch(() => ({} as any));
  const brand = (config as any)?.companyName || 'FivoCRM';
  const portalUrl = `${process.env.PUBLIC_APP_URL || 'https://fivocrm.vercel.app'}/portal/reports`;
  const subject = String(body.subject || `${report.title} — ${brand}`).slice(0, 200);
  const note = String(body.message || '').slice(0, 2000);

  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f5f7fb;font-family:Segoe UI,Roboto,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px">
    <table role="presentation" width="100%" style="max-width:560px;background:#fff;border-radius:12px;overflow:hidden">
      <tr><td style="background:#12468C;padding:20px 24px;color:#fff">
        <div style="font-size:13px;opacity:.85">${escapeHtml(brand)}</div>
        <div style="font-size:19px;font-weight:700;margin-top:4px">${escapeHtml(report.title)}</div>
      </td></tr>
      <tr><td style="padding:24px;color:#111827;font-size:14px;line-height:1.6">
        <p style="margin:0 0 12px">Përshëndetje${report.customerName ? ` ${escapeHtml(report.customerName)}` : ''},</p>
        <p style="margin:0 0 12px">Raporti i periudhës është gati për ju.</p>
        ${note ? `<p style="margin:0 0 16px;white-space:pre-line">${escapeHtml(note)}</p>` : ''}
        <p style="margin:20px 0">
          <a href="${escapeHtml(portalUrl)}" style="background:#0EA5E9;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;display:inline-block;font-weight:600">Hap raportin në portal</a>
        </p>
        <p style="margin:0;color:#6b7280;font-size:12px">
          Në portal mund ta shkarkoni PDF-in, të lini komente dhe të aprovoni raportin.
        </p>
      </td></tr>
      <tr><td style="padding:14px 24px;background:#f9fafb;color:#9ca3af;font-size:11px">
        ${escapeHtml(brand)} · Ky email u dërgua sepse jeni kontakt i llogarisë.
      </td></tr>
    </table>
  </td></tr></table></body></html>`;

  try {
    await transporter.sendMail({
      from: senderHeader(brand, fromAddress),
      to: recipients.join(', '),
      ...(cc.length ? { cc: cc.join(', ') } : {}),
      subject,
      html,
    });
  } catch (err: any) {
    await appendEvent({
      businessId, reportId: ref.id, kind: 'email-failed',
      version: Number(report.version || 1), actorType: 'staff', actorUserId: caller.uid,
      meta: { error: String(err?.message || err).slice(0, 300) },
    });
    return res.status(502).json({ error: 'Email delivery failed', detail: String(err?.message || err) });
  }

  const now = admin.firestore.Timestamp.now();
  await ref.update({
    status: report.status === 'published' ? 'sent' : report.status,
    sentAt: now,
    updatedAt: now,
  });

  await appendEvent({
    businessId, reportId: ref.id, kind: 'emailed',
    version: Number(report.version || 1),
    actorType: 'staff', actorUserId: caller.uid,
    customerId: report.customerId || null,
    // Recipients are recorded for the delivery log (§16), addresses only.
    meta: { to: recipients, cc },
  });

  await writeAudit({
    businessId,
    actorUid: caller.uid,
    actorEmail: caller.email,
    action: 'report.email',
    target: `report:${ref.id}`,
    meta: { recipients: recipients.length, cc: cc.length },
  });

  return res.status(200).json({ ok: true, sent: recipients.length });
}
