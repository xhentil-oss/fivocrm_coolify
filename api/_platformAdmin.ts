import type { VercelRequest, VercelResponse } from '@vercel/node';
import admin, { adminAuth, adminDb as db } from './_firebaseAdmin.js';
import { writeAudit } from './_audit.js';
import { seatsForPlan } from './_billingPlans.js';

/**
 * POST /api/platform-admin — the platform console's write path.
 * Header: Authorization: Bearer <Firebase ID token of a super-admin>
 *
 * WHY A SERVER ENDPOINT AT ALL: Firestore rules would let a super-admin write
 * `businesses/{id}` directly, but a tenant's tier is the single most consequential
 * field in the product (it gates every module and every seat). Routing it through
 * here buys three things the client cannot provide:
 *   • validation against ONE list of plans/statuses instead of whatever the UI sent,
 *   • an audit entry with before/after — "who moved this tenant to Business, when",
 *   • a record of whether the change fights an active Stripe subscription.
 *
 * IMPORTANT — this is an OVERRIDE, not the billing source of truth. `plan`/`status`
 * are normally written only by `api/stripe-webhook.ts` (from the price actually
 * billed) and the `subscription-lifecycle` cron. A manual change to a tenant with a
 * live subscription will be overwritten by the next Stripe event; the response says
 * so and the audit entry records it.
 */

const PLANS = ['trial', 'starter', 'pro', 'business', 'enterprise'] as const;
const STATUSES = ['trialing', 'active', 'past_due', 'suspended', 'canceled'] as const;

type Plan = typeof PLANS[number];
type Status = typeof STATUSES[number];

const isPlan = (v: unknown): v is Plan => typeof v === 'string' && (PLANS as readonly string[]).includes(v);
const isStatus = (v: unknown): v is Status => typeof v === 'string' && (STATUSES as readonly string[]).includes(v);

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
  // The signed claim is the only accepted proof — never an email list from the body.
  if (decoded.superAdmin !== true) {
    return res.status(403).json({ error: 'Vetëm super-admin i platformës.' });
  }

  const body = (req.body || {}) as Record<string, any>;
  const action = typeof body.action === 'string' ? body.action : '';
  const businessId = typeof body.businessId === 'string' ? body.businessId.trim() : '';
  if (!businessId) return res.status(400).json({ error: 'businessId mungon.' });

  const ref = db.collection('businesses').doc(businessId);
  const snap = await ref.get();
  if (!snap.exists) return res.status(404).json({ error: 'Ky biznes nuk ekziston.' });
  const before = snap.data() as Record<string, any>;

  try {
    switch (action) {
      case 'update-plan':
        return await updatePlan(req, res, { ref, before, businessId, body, decoded });
      case 'set-modules':
        return await setModules(res, { ref, before, businessId, body, decoded });
      default:
        return res.status(400).json({ error: `Veprim i panjohur: ${action || '(bosh)'}` });
    }
  } catch (err: any) {
    console.error('[platform-admin] failed:', err?.message || err);
    return res.status(500).json({ error: 'Veprimi dështoi në server.' });
  }
}

interface Ctx {
  ref: FirebaseFirestore.DocumentReference;
  before: Record<string, any>;
  businessId: string;
  body: Record<string, any>;
  decoded: admin.auth.DecodedIdToken;
}

/** Plan / status / trial end / seat override — the commercial terms of a tenant. */
async function updatePlan(_req: VercelRequest, res: VercelResponse, ctx: Ctx) {
  const { ref, before, businessId, body, decoded } = ctx;
  const patch: Record<string, any> = {};

  if (body.plan !== undefined) {
    if (!isPlan(body.plan)) return res.status(400).json({ error: `Plan i pavlefshëm: ${body.plan}` });
    patch.plan = body.plan;
    // Seats follow the plan unless an explicit override is sent below — otherwise a
    // downgrade would leave the tenant with the old plan's seat count.
    patch.seats = seatsForPlan(body.plan);
  }

  if (body.status !== undefined) {
    if (!isStatus(body.status)) return res.status(400).json({ error: `Status i pavlefshëm: ${body.status}` });
    patch.status = body.status;
    // Keep the lifecycle timestamps consistent with the status, or the grace-period
    // cron would re-derive a state that contradicts what was just set by hand.
    if (body.status === 'suspended') {
      patch.suspendedAt = admin.firestore.Timestamp.now();
    } else {
      patch.suspendedAt = admin.firestore.FieldValue.delete();
      if (body.status !== 'past_due') patch.pastDueSince = admin.firestore.FieldValue.delete();
    }
  }

  if (body.trialEndsAt !== undefined) {
    if (body.trialEndsAt === null) {
      patch.trialEndsAt = admin.firestore.FieldValue.delete();
    } else {
      const d = new Date(body.trialEndsAt);
      if (Number.isNaN(d.getTime())) return res.status(400).json({ error: 'Data e provës është e pavlefshme.' });
      patch.trialEndsAt = admin.firestore.Timestamp.fromDate(d);
    }
  }

  // Negotiated seat count (Enterprise contracts). null clears it back to the plan's.
  if (body.seats !== undefined) {
    if (body.seats === null) {
      patch['limits.seats'] = admin.firestore.FieldValue.delete();
    } else {
      const n = Number(body.seats);
      if (!Number.isInteger(n) || n < 1 || n > 100000) {
        return res.status(400).json({ error: 'Numri i vendeve duhet të jetë 1–100000.' });
      }
      patch['limits.seats'] = n;
    }
  }

  if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'Asgjë për të ndryshuar.' });
  patch.updatedAt = admin.firestore.Timestamp.now();

  // A tenant with a live subscription is governed by Stripe: say so instead of
  // letting the operator believe a manual tier will stick.
  const stripeManaged = !!before.stripeSubscriptionId;

  await ref.update(patch);

  await writeAudit({
    businessId,
    actorUid: decoded.uid,
    actorEmail: decoded.email || null,
    action: 'platform.plan_change',
    target: `business:${businessId}`,
    meta: {
      before: { plan: before.plan ?? null, status: before.status ?? null, seats: before.limits?.seats ?? before.seats ?? null },
      after: { plan: patch.plan ?? before.plan ?? null, status: patch.status ?? before.status ?? null, seats: body.seats ?? null },
      note: typeof body.note === 'string' ? body.note.slice(0, 500) : null,
      stripeManaged,
    },
  });

  return res.status(200).json({ success: true, stripeManaged });
}

/** Per-tenant module toggles (the plan still gates what a toggle can unlock). */
async function setModules(res: VercelResponse, ctx: Ctx) {
  const { ref, before, businessId, body, decoded } = ctx;
  if (!Array.isArray(body.disabledModules) || body.disabledModules.some((p: any) => typeof p !== 'string')) {
    return res.status(400).json({ error: 'disabledModules duhet të jetë listë tekstesh.' });
  }
  const next = Array.from(new Set(body.disabledModules as string[])).slice(0, 200);

  await ref.update({ disabledModules: next, updatedAt: admin.firestore.Timestamp.now() });

  await writeAudit({
    businessId,
    actorUid: decoded.uid,
    actorEmail: decoded.email || null,
    action: 'platform.modules_change',
    target: `business:${businessId}`,
    meta: { before: before.disabledModules || [], after: next },
  });

  return res.status(200).json({ success: true });
}
