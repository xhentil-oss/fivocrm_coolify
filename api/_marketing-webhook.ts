import type { VercelRequest, VercelResponse } from '@vercel/node';
import admin, { adminDb as db } from './_firebaseAdmin.js';

// Inbound ESP event webhook (open/click/delivered tracking) for email marketing.
// Not a standalone Vercel function — dispatched from api/email.ts (?type=
// marketing-webhook) to stay under the Hobby 12-function limit.
//
// Configure the webhook URL at your ESP dashboard as:
//   https://<domain>/api/email?type=marketing-webhook&secret=<MARKETING_WEBHOOK_SECRET>
// Supports Resend, SendGrid and Mailgun payload shapes. Each outgoing marketing
// email is tagged with its campaignId (see api/_mailer.ts), which these events
// carry back so we can attribute opens/clicks to the right campaign.

type EventKind = 'delivered' | 'open' | 'click';

function tagValue(tags: any, key: string): string | undefined {
  if (!tags) return undefined;
  if (Array.isArray(tags)) {
    const t = tags.find((x) => x?.name === key);
    return t?.value;
  }
  if (typeof tags === 'object') return tags[key];
  return undefined;
}

// Map each provider's payload → a flat list of { campaignId, kind } events.
function parseEvents(body: any): { campaignId: string; kind: EventKind }[] {
  const out: { campaignId: string; kind: EventKind }[] = [];
  const push = (campaignId: any, kind: EventKind) => {
    if (campaignId && typeof campaignId === 'string') out.push({ campaignId, kind });
  };

  // SendGrid: an array of event objects; custom_args merged as top-level fields.
  if (Array.isArray(body)) {
    for (const ev of body) {
      const cid = ev?.campaignId;
      const type = ev?.event;
      if (type === 'delivered') push(cid, 'delivered');
      else if (type === 'open') push(cid, 'open');
      else if (type === 'click') push(cid, 'click');
    }
    return out;
  }

  // Mailgun: { 'event-data': { event, 'user-variables': { campaignId } } }
  if (body?.['event-data']) {
    const ed = body['event-data'];
    const cid = ed?.['user-variables']?.campaignId;
    const type = ed?.event;
    if (type === 'delivered') push(cid, 'delivered');
    else if (type === 'opened') push(cid, 'open');
    else if (type === 'clicked') push(cid, 'click');
    return out;
  }

  // Resend: { type: 'email.opened'|'email.clicked'|'email.delivered', data: { tags } }
  if (typeof body?.type === 'string') {
    const cid = tagValue(body?.data?.tags, 'campaignId');
    if (body.type === 'email.delivered') push(cid, 'delivered');
    else if (body.type === 'email.opened') push(cid, 'open');
    else if (body.type === 'email.clicked') push(cid, 'click');
  }
  return out;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Lightweight shared-secret guard (full per-provider signature verification is
  // out of scope). If the env secret is set, the query secret must match.
  const secret = process.env.MARKETING_WEBHOOK_SECRET;
  if (secret) {
    const q = Array.isArray(req.query.secret) ? req.query.secret[0] : req.query.secret;
    if (q !== secret) return res.status(401).json({ error: 'Unauthorized' });
  }

  // ESPs sometimes verify the endpoint with a GET.
  if (req.method === 'GET') return res.status(200).json({ ok: true });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body: any = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }

  const events = parseEvents(body);
  if (events.length === 0) return res.status(200).json({ ok: true, counted: 0 });

  // Aggregate per campaign, then one increment write each.
  const perCampaign = new Map<string, { deliveredCount: number; openCount: number; clickCount: number }>();
  for (const e of events) {
    const agg = perCampaign.get(e.campaignId) || { deliveredCount: 0, openCount: 0, clickCount: 0 };
    if (e.kind === 'delivered') agg.deliveredCount++;
    else if (e.kind === 'open') agg.openCount++;
    else if (e.kind === 'click') agg.clickCount++;
    perCampaign.set(e.campaignId, agg);
  }

  await Promise.allSettled(
    [...perCampaign.entries()].map(([campaignId, agg]) => {
      const update: Record<string, any> = { updatedAt: admin.firestore.Timestamp.now() };
      if (agg.deliveredCount) update.deliveredCount = admin.firestore.FieldValue.increment(agg.deliveredCount);
      if (agg.openCount) update.openCount = admin.firestore.FieldValue.increment(agg.openCount);
      if (agg.clickCount) update.clickCount = admin.firestore.FieldValue.increment(agg.clickCount);
      return db.collection('emailCampaigns').doc(campaignId).update(update);
    }),
  );

  return res.status(200).json({ ok: true, counted: events.length });
}
