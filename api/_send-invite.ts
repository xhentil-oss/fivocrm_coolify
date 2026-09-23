import { safeSenderAddress, safeSenderName } from './_emailIdentity.js';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import nodemailer from 'nodemailer';
import { adminDb as db } from './_firebaseAdmin.js';
import { checkPersistentRateLimit } from './_rateLimit.js';
import {
  authenticate, isPortalOnlyToken, activeMembership, isBusinessOwner, businessIdOfTeam, isPlatformUrl,
  type CallerIdentity,
} from './_callerIdentity.js';

/**
 * POST /api/send-invite
 * Body: { to, teamName, inviteLink, senderName?, directAdd? }
 *
 * Mails the join link of a `teamInvites` row (or the "you were added" notice of a
 * direct add). Audit Sep 2026: this was an open relay — any signed-in account could
 * mail any address any `inviteLink` on `*.vercel.app` or `localhost`, with any
 * "team name". Now:
 *   - the caller must be Admin/Owner of the invite's team (a Manager may mail
 *     non-Admin invites), or a platform super-admin (console-created tenants);
 *   - `to` must be the pending invite's own email — the token is read from the link
 *     itself (`/join/<token>`), so the row is the authority for BOTH fields;
 *   - for `directAdd`, `to` must be the email of an active membership in a team the
 *     caller administers;
 *   - the link host must be a platform host (`isPlatformUrl`): no `localhost` in
 *     production, no `vercel.app` wildcard, no same-origin shortcut.
 */

const INVITES_PER_HOUR = 20;

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254 && !email.includes('\n') && !email.includes('\r');
}

/** Caller's authority over a team: 'owner' | 'Admin' | 'Manager' | null. */
async function callerAuthority(c: CallerIdentity, teamId: string): Promise<'owner' | 'Admin' | 'Manager' | null> {
  if (c.superAdmin) return 'owner';
  const bid = await businessIdOfTeam(teamId);
  if (await isBusinessOwner(c.uid, bid)) return 'owner';
  const m = await activeMembership(c.uid, { teamId });
  if (m?.role === 'Admin' || m?.role === 'Owner') return 'Admin';
  if (m?.role === 'Manager') return 'Manager';
  // A business-level Admin (another department of the same business).
  const biz = await activeMembership(c.uid, { businessId: bid });
  if (biz?.role === 'Admin' || biz?.role === 'Owner') return 'Admin';
  return null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const c = await authenticate(req);
    if (!c) return res.status(401).json({ error: 'Invalid or expired token' });
    if (isPortalOnlyToken(c)) return res.status(403).json({ error: 'Forbidden' });

    if (!(await checkPersistentRateLimit('sendInvite', c.uid, INVITES_PER_HOUR))) {
      return res.status(429).json({ error: 'Too many invitations. Please try again later.' });
    }

    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
    const to = typeof body.to === 'string' ? body.to.trim() : '';
    const teamName = typeof body.teamName === 'string' ? body.teamName.trim().slice(0, 120) : '';
    const inviteLink = typeof body.inviteLink === 'string' ? body.inviteLink.trim() : '';
    const senderName = typeof body.senderName === 'string' ? body.senderName : '';
    const directAdd = body.directAdd === true;

    if (!to || !teamName || !inviteLink) return res.status(400).json({ error: 'Missing required fields' });
    if (!isValidEmail(to)) return res.status(400).json({ error: 'Invalid email address' });
    if (inviteLink.length > 2000 || !isPlatformUrl(inviteLink)) {
      return res.status(400).json({ error: 'Invalid invite link' });
    }
    const toLower = to.toLowerCase();

    // ── Authorization: the recipient must be a real invitee / member of a team the caller administers ──
    let teamId: string | null = null;
    if (directAdd) {
      const snaps = await Promise.all([
        db.collection('teamMembers').where('email', '==', toLower).limit(10).get(),
        toLower !== to ? db.collection('teamMembers').where('email', '==', to).limit(10).get() : Promise.resolve(null),
      ]);
      const rows = [...snaps[0].docs, ...(snaps[1]?.docs || [])].map((d) => d.data() as any)
        .filter((m) => m.status !== 'Inactive' && typeof m.teamId === 'string' && m.teamId);
      for (const m of rows) {
        const auth = await callerAuthority(c, m.teamId);
        if (auth === 'owner' || auth === 'Admin' || (auth === 'Manager' && m.role !== 'Admin')) { teamId = m.teamId; break; }
      }
      if (!teamId) return res.status(403).json({ error: 'Forbidden' });
    } else {
      // The token is IN the link — the invite row is the authority for team + email.
      let token = '';
      try {
        const m = /\/join\/([A-Za-z0-9_-]{6,256})\/?$/.exec(new URL(inviteLink).pathname);
        token = m ? m[1] : '';
      } catch { /* invalid */ }
      if (!token) return res.status(400).json({ error: 'Invalid invite link' });

      const inviteSnap = await db.collection('teamInvites').where('token', '==', token).limit(1).get();
      const invite = inviteSnap.empty ? null : (inviteSnap.docs[0].data() as any);
      if (!invite || (invite.status && invite.status !== 'Pending')) {
        return res.status(404).json({ error: 'Invite not found' });
      }
      if (String(invite.email || '').toLowerCase() !== toLower) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      if (typeof invite.teamId !== 'string' || !invite.teamId) return res.status(422).json({ error: 'Invite has no team' });
      const auth = await callerAuthority(c, invite.teamId);
      if (!auth || (auth === 'Manager' && invite.role === 'Admin')) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      teamId = invite.teamId;
    }

    // SMTP credentials must come from environment variables
    const smtpUser = safeSenderAddress(process.env.SMTP_USER);
    const smtpPass = process.env.SMTP_PASS;
    if (!smtpUser || !smtpPass) {
      console.error('[send-invite] SMTP not configured', { hasUser: !!smtpUser, hasPass: !!smtpPass });
      return res.status(503).json({ error: 'SMTP not configured' });
    }

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'mail.fivoo.net',
      port: Number(process.env.SMTP_PORT) || 465,
      secure: true,
      auth: { user: smtpUser, pass: smtpPass },
    });

    // Sanitize the From display name for the HEADER (NOT escapeHtml — that injects
    // HTML entities like &#x27; which Gmail flags as "abnormal characters"). Pass an
    // object so nodemailer RFC-2047-encodes any non-ASCII (e.g. Albanian) name.
    const fromName = safeSenderName(senderName);
    const subjectTeam = teamName.replace(/["\n\r]/g, '');

    try {
      await transporter.sendMail({
        from: { name: fromName, address: smtpUser },
        to,
        subject: directAdd
          ? `U shtove në ekipin "${subjectTeam}"`
          : `Ftesë për tu bashkuar me ekipin "${subjectTeam}"`,
        html: directAdd ? `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333;">U shtove në ekip!</h2>
          <p>Administratori <strong>${escapeHtml(String(senderName || 'FivoCRM'))}</strong> të shtoi direkt në ekipin <strong>${escapeHtml(teamName)}</strong> në FivoCRM.</p>
          <a href="${encodeURI(inviteLink)}"
             style="display: inline-block; padding: 12px 24px; background-color: #3b82f6; color: white; text-decoration: none; border-radius: 6px; margin: 20px 0;">
            Hyr në FivoCRM
          </a>
          <p style="color: #666; font-size: 14px;">Ose kopjo këtë link: ${escapeHtml(inviteLink)}</p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
          <p style="color: #999; font-size: 12px;">Nëse nuk e pret këtë email, kontakto administratorin.</p>
        </div>
      ` : `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333;">Ke marrë një ftesë!</h2>
          <p>Je ftuar të bashkohesh me ekipin <strong>${escapeHtml(teamName)}</strong> në FivoCRM.</p>
          <a href="${encodeURI(inviteLink)}"
             style="display: inline-block; padding: 12px 24px; background-color: #3b82f6; color: white; text-decoration: none; border-radius: 6px; margin: 20px 0;">
            Prano Ftesën
          </a>
          <p style="color: #666; font-size: 14px;">Ose kopjo këtë link: ${escapeHtml(inviteLink)}</p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
          <p style="color: #999; font-size: 12px;">Nëse nuk e ke kërkuar këtë ftesë, injoroje këtë email.</p>
        </div>
      `,
      });

      return res.status(200).json({ success: true, message: 'Email sent successfully', teamId });
    } catch (error: any) {
      console.error('[send-invite] SMTP send failed:', error?.message || error);
      return res.status(502).json({ error: 'Failed to send email' });
    }
  } catch (fatal: any) {
    console.error('[send-invite] fatal crash:', fatal?.message, fatal?.stack);
    return res.status(500).json({ error: 'Server error' });
  }
}
