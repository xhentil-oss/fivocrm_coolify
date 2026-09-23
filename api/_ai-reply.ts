import type { VercelRequest, VercelResponse } from '@vercel/node';
import { adminAuth } from './_firebaseAdmin.js';
import { activeMembership } from './_callerIdentity.js';
import { checkPersistentRateLimit } from './_rateLimit.js';
import { normContactPhone } from './_contactIdentity.js';
import { draftWaReply } from './_aiReply.js';

/**
 * POST /api/ai-reply  (?type=ai-reply) — on-demand "Sugjerim AI" for a WhatsApp thread.
 *
 * Body:    { teamId: string; phone: string }
 * Header:  Authorization: Bearer <Firebase ID token>
 * Returns: 200 { suggestedReply, model, conversationId, forMessageId }
 *          409 { error, blocked: 'no-messages' | 'no-conversation' | 'empty' | 'off' }
 *          429 { error, blocked: 'daily-cap' }        503 { error, blocked: 'no-key' }
 *
 * The suggestion is ALSO stored on `conversations/wa-{teamId}-{phone}`
 * (`suggestedReply`, `suggestedAt`, `suggestedForMessageId`, `suggestedModel`),
 * so the panel's listener sees the same text the response carries. Nothing is
 * sent — a person presses "Dërgo".
 *
 * Auth: Firebase ID token + membership of `teamId` (same gate as meta-send).
 * Limit: 30 per user per hour (persistent, survives cold starts).
 */
const AI_REPLY_PER_HOUR = 30;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  let uid: string;
  try {
    uid = (await adminAuth.verifyIdToken(authHeader.slice(7))).uid;
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }

  let body: any = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Invalid JSON' }); }
  }
  const teamId = typeof body?.teamId === 'string' ? body.teamId.trim() : '';
  const phone = normContactPhone(typeof body?.phone === 'string' ? body.phone : '');
  if (!teamId) return res.status(400).json({ error: 'teamId mungon' });
  if (!phone) return res.status(400).json({ error: 'Numri i telefonit është i pavlefshëm' });

  // Verify the caller belongs to the requested team — prevents using another
  // team's AI key/budget and reading another tenant's thread.
  // An Inactive membership (removed employee) grants nothing.
  if (!(await activeMembership(uid, { teamId }))) return res.status(403).json({ error: 'Forbidden: nuk jeni anëtar i këtij ekipi' });

  if (!(await checkPersistentRateLimit('aiReply', uid, AI_REPLY_PER_HOUR))) {
    return res.status(429).json({ error: 'Limiti i sugjerimeve AI u arrit. Provoni përsëri pas pak.', limitPerHour: AI_REPLY_PER_HOUR, retryAfterSeconds: 3600 });
  }

  const conversationId = `wa-${teamId}-${phone}`;
  const result = await draftWaReply(teamId, conversationId, { force: true, byUid: uid });
  if (result.ok) {
    return res.status(200).json({
      suggestedReply: result.suggestedReply,
      model: result.model,
      conversationId: result.conversationId,
      forMessageId: result.forMessageId,
    });
  }

  const messages: Record<string, string> = {
    'off': 'Asistenti AI është i çaktivizuar për këtë ekip (Cilësimet → Automatizime).',
    'no-key': 'AI nuk është konfiguruar (vendos çelësin te Cilësimet → Integrime).',
    'burst': 'Një sugjerim u gjenerua para pak sekondash.',
    'daily-cap': 'Kufiri ditor i sugjerimeve AI për ekipin u arrit.',
    'no-conversation': 'Biseda nuk u gjet.',
    'no-messages': 'S\'ka mesazh hyrës për t\'iu përgjigjur.',
    'empty': 'AI nuk ktheu një përgjigje të përdorshme. Provoni përsëri.',
    'error': 'Gjenerimi dështoi.',
  };
  const status = result.blocked === 'daily-cap' ? 429
    : result.blocked === 'no-key' ? 503
    : result.blocked === 'error' ? 502
    : 409;
  return res.status(status).json({ error: messages[result.blocked] || 'Gjenerimi dështoi.', blocked: result.blocked, ...(result.error ? { detail: result.error } : {}) });
}
