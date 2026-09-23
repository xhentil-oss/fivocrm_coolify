import type { VercelRequest, VercelResponse } from '@vercel/node';
import admin, { adminAuth, adminDb } from './_firebaseAdmin.js';
import { getTeamConfig } from './_tenantConfig.js';
import { sendBulkEmail, resolveProvider, type MailerConfig } from './_mailer.js';
import { safeSenderAddress, safeSenderName } from './_emailIdentity.js';
import { checkPersistentRateLimit } from './_rateLimit.js';

/**
 * POST /api/contact-email  (?type=contact-email) — 1:1 email from the CRM to a lead
 * or a customer, sent through the TENANT's email provider and logged.
 *
 * Body:
 *   { leadId?: string; customerId?: string;   // exactly one
 *     subject: string;                        // ≤ 200 chars
 *     text?: string; html?: string;           // at least one; text → escaped + <br>
 *     replyToSelf?: boolean }                 // default true: Reply-To = the staff member
 * Header:  Authorization: Bearer <Firebase ID token>
 * Returns: 200 { success: true, provider, activityId, to }
 *          400 bad body · 401 token · 403 not staff of the contact's team/business
 *          404 contact · 422 contact has no valid email · 429 rate limit (60/h/user)
 *          503 no email provider configured · 502 provider rejected the send
 *
 * Sender identity (Gmail-safe, see api/_emailIdentity.ts):
 *   From:     "<Staff name> - <Company>" <tenant/platform verified address>
 *   Reply-To: the staff member's own login email (unless replyToSelf === false)
 *
 * The SERVER writes the timeline row and the contact stamps here, because this is
 * the one outbound touch that happens server-side — the client must NOT log again:
 *   lead     → leadActivities { type:'email', … } + { lastActivityAt, lastFollowUpDate,
 *              awaitingReply:false, firstResponseAt (once), updatedAt }
 *   customer → activities { type:'email_sent', entityType:'customer', … } +
 *              { lastActivityAt, lastFollowUpDate, awaitingReply:false, updatedAt }
 *
 * `?type=lead-reminder` (api/_send-lead-reminder-email.ts) is a thin adapter onto
 * `handleContactEmail` with `skipActivityRow` — that legacy caller logs client-side.
 */

const CONTACT_EMAIL_PER_HOUR = 60;
const SUBJECT_MAX = 200;
const TEXT_MAX = 10_000;
const HTML_MAX = 60_000;
const ACTIVITY_BODY_LEN = 500;

export interface ContactEmailHandlerOptions {
  /** Legacy adapter: the caller writes its own timeline row. Stamps are still written. */
  skipActivityRow?: boolean;
  /** Legacy adapter: allow a missing subject ("Mesazh nga <staff>"). */
  defaultSubject?: boolean;
}

function isValidEmail(email: unknown): email is string {
  return typeof email === 'string'
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    && !email.includes('\n') && !email.includes('\r');
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Plain text → paragraphs with <br>; the only HTML we generate from staff text. */
export function textToHtml(text: string): string {
  const body = escapeHtml(text.trim()).replace(/\r\n?/g, '\n').replace(/\n/g, '<br>');
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#1f2937;white-space:normal">${body}</div>`;
}

/** Best-effort plain text of an html body, for the timeline excerpt. */
function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function mailerConfig(ts: Record<string, any>): MailerConfig {
  return {
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
}

export async function handleContactEmail(req: VercelRequest, res: VercelResponse, opts: ContactEmailHandlerOptions = {}) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // ── Auth ──
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  let decoded: admin.auth.DecodedIdToken;
  try {
    decoded = await adminAuth.verifyIdToken(authHeader.slice(7));
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }

  // ── Body ──
  let body: any = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Invalid JSON' }); }
  }
  if (!body || typeof body !== 'object') return res.status(400).json({ error: 'Trupi i kërkesës mungon' });
  const leadId = typeof body.leadId === 'string' && body.leadId.trim() ? body.leadId.trim() : null;
  const customerId = typeof body.customerId === 'string' && body.customerId.trim() ? body.customerId.trim() : null;
  if ((leadId ? 1 : 0) + (customerId ? 1 : 0) !== 1) {
    return res.status(400).json({ error: 'Jep saktësisht një nga leadId ose customerId' });
  }
  let subject = typeof body.subject === 'string' ? body.subject.replace(/[\r\n]+/g, ' ').trim() : '';
  if (!subject && !opts.defaultSubject) return res.status(400).json({ error: 'Subjekti mungon' });
  if (subject.length > SUBJECT_MAX) return res.status(400).json({ error: `Subjekti është shumë i gjatë (max ${SUBJECT_MAX})` });
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  const html = typeof body.html === 'string' ? body.html.trim() : '';
  if (!text && !html) return res.status(400).json({ error: 'Teksti i mesazhit mungon' });
  if (text.length > TEXT_MAX) return res.status(400).json({ error: `Mesazhi është shumë i gjatë (max ${TEXT_MAX} karaktere)` });
  if (html.length > HTML_MAX) return res.status(400).json({ error: `HTML është shumë i gjatë (max ${HTML_MAX} karaktere)` });
  const replyToSelf = body.replyToSelf !== false;

  // ── Contact ──
  const entity: 'lead' | 'customer' = leadId ? 'lead' : 'customer';
  const ref = adminDb.collection(leadId ? 'leads' : 'customers').doc((leadId || customerId) as string);
  const snap = await ref.get();
  if (!snap.exists) return res.status(404).json({ error: entity === 'lead' ? 'Lead not found' : 'Klienti nuk u gjet' });
  const contact = snap.data() as Record<string, any>;
  const to: unknown = contact.email || contact.contactEmail;
  if (!isValidEmail(to)) return res.status(422).json({ error: 'Kontakti nuk ka një email të vlefshëm' });

  // ── Membership (fail closed) ──
  // Staff of the contact's team, or of its business (legacy rows scoped only one way).
  const contactTeamId: string | null = typeof contact.teamId === 'string' && contact.teamId ? contact.teamId : null;
  const contactBusinessId: string | null = typeof contact.businessId === 'string' && contact.businessId ? contact.businessId : null;
  if (!contactTeamId && !contactBusinessId) {
    return res.status(403).json({ error: 'Kontakti nuk i përket asnjë ekipi ose biznesi' });
  }
  const [teamSnap, bizSnap] = await Promise.all([
    contactTeamId
      ? adminDb.collection('teamMembers').where('teamId', '==', contactTeamId).where('userId', '==', decoded.uid).limit(5).get()
      : Promise.resolve(null),
    contactBusinessId
      ? adminDb.collection('teamMembers').where('businessId', '==', contactBusinessId).where('userId', '==', decoded.uid).limit(5).get()
      : Promise.resolve(null),
  ]);
  // Only an ACTIVE membership authorizes (legacy rows without `status` count as Active).
  const firstActive = (snap: FirebaseFirestore.QuerySnapshot | null) =>
    snap?.docs.find((d) => (d.data() as any)?.status !== 'Inactive') || null;
  const memberDoc = firstActive(teamSnap) || firstActive(bizSnap);
  if (!memberDoc) return res.status(403).json({ error: 'Forbidden' });
  const member = memberDoc.data() as Record<string, any>;
  // The provider config is per TEAM: the contact's team, else the caller's team in that business.
  const teamId: string = contactTeamId || (typeof member.teamId === 'string' ? member.teamId : '');
  const businessId: string | null = contactBusinessId || (typeof member.businessId === 'string' ? member.businessId : null);

  // ── Rate limit ──
  if (!(await checkPersistentRateLimit('contactEmail', decoded.uid, CONTACT_EMAIL_PER_HOUR))) {
    return res.status(429).json({ error: 'Limiti i dërgimeve u arrit. Provoni përsëri pas pak.', limitPerHour: CONTACT_EMAIL_PER_HOUR, retryAfterSeconds: 3600 });
  }

  // ── Sender identity ──
  const cfg = teamId ? await getTeamConfig(teamId) : {};
  const provider = resolveProvider(mailerConfig(cfg));
  if (provider === 'none') {
    return res.status(503).json({ error: 'Asnjë ofrues email i konfiguruar (Cilësimet → Integrime)' });
  }
  let staffName = '';
  try {
    const userRecord = await adminAuth.getUser(decoded.uid);
    staffName = (userRecord.displayName || '').trim();
  } catch { /* best-effort */ }
  if (!staffName) staffName = String(member.name || member.displayName || decoded.name || '').trim();
  if (!staffName && decoded.email) staffName = decoded.email.split('@')[0];
  let companyName = String(cfg.companyName || cfg.emailFromName || '').trim();
  if (!companyName && businessId) {
    try { companyName = String(((await adminDb.collection('businesses').doc(businessId).get()).data() as any)?.name || '').trim(); } catch { /* optional */ }
  }
  // `·` is not header-safe (it is stripped to a space), so the two halves are joined
  // with a plain hyphen. safeSenderName() falls back to the platform name if empty.
  const fromName = safeSenderName(
    staffName && companyName ? `${staffName} - ${companyName}` : (companyName || staffName),
    safeSenderName(companyName || 'FivoCRM'),
  );
  const replyTo = replyToSelf ? safeSenderAddress(decoded.email) : undefined;
  if (!subject) subject = `Mesazh nga ${staffName || companyName || 'FivoCRM'}`;

  // ── Send ──
  const finalHtml = html || textToHtml(text);
  const excerpt = (text || htmlToText(html)).slice(0, ACTIVITY_BODY_LEN);
  const [result] = await sendBulkEmail([{ to, subject, html: finalHtml, ...(replyTo ? { replyTo } : {}) }], mailerConfig(cfg), fromName);
  if (!result?.ok) {
    return res.status(502).json({ error: result?.error || 'Dërgimi dështoi', provider });
  }

  // ── Log + stamps (best-effort; the mail is already out) ──
  const now = admin.firestore.Timestamp.now();
  let activityId: string | null = null;
  const ops: Promise<unknown>[] = [];
  if (entity === 'lead') {
    const patch: Record<string, any> = {
      lastActivityAt: now,
      lastFollowUpDate: now,
      awaitingReply: false,
      updatedAt: now,
    };
    if (!contact.firstResponseAt) patch.firstResponseAt = now;
    ops.push(ref.update(patch));
    if (!opts.skipActivityRow) {
      const actRef = adminDb.collection('leadActivities').doc();
      activityId = actRef.id;
      ops.push(actRef.set({
        leadId,
        type: 'email',
        title: subject,
        body: excerpt,
        meta: { to, provider, replyTo: replyTo ?? null, channel: 'email', direction: 'outbound' },
        userId: decoded.uid,
        userName: staffName || null,
        businessId,
        teamId: teamId || null,
        createdAt: now,
      }));
    }
  } else {
    ops.push(ref.set({
      lastActivityAt: now,
      lastFollowUpDate: now,
      awaitingReply: false,
      updatedAt: now,
    }, { merge: true }));
    if (!opts.skipActivityRow) {
      const actRef = adminDb.collection('activities').doc();
      activityId = actRef.id;
      ops.push(actRef.set({
        type: 'email_sent',
        title: subject,
        description: excerpt,
        entityType: 'customer',
        entityId: customerId,
        customerId,
        meta: { to, provider, replyTo: replyTo ?? null },
        userId: decoded.uid,
        userName: staffName || null,
        teamId: teamId || null,
        businessId,
        createdAt: now,
      }));
    }
  }
  (await Promise.allSettled(ops)).forEach((r) => {
    if (r.status === 'rejected') console.error('[contact-email] post-send write failed', r.reason);
  });

  return res.status(200).json({ success: true, provider, activityId, to });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  return handleContactEmail(req, res);
}
