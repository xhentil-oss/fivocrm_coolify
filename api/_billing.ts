import type { VercelRequest, VercelResponse } from '@vercel/node';
import Stripe from 'stripe';
import admin, { adminAuth, adminDb as db } from './_firebaseAdmin.js';
import { priceIdFor, type BillablePlan, type BillingInterval } from './_billingPlans.js';
import { writeAudit } from './_audit.js';

/**
 * POST /api/billing?action=checkout|portal
 * Header: Authorization: Bearer <Firebase ID token>
 *
 *  checkout → Stripe Checkout Session in `mode: 'subscription'` for the tenant.
 *  portal   → Stripe Billing Portal session (card, invoices, cancel).
 *
 * ONLY the business owner may start or manage a subscription. The plan the tenant
 * ends up on is never taken from the client: the webhook derives it from the Stripe
 * Price that is actually being billed (see api/_billingPlans.ts + stripe-webhook.ts),
 * so tampering with the request body cannot upgrade a tenant for free.
 */

function stripeClient(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY is not configured');
  return new Stripe(key, { apiVersion: '2026-02-25.clover' });
}

function appBaseUrl(req: VercelRequest): string {
  const envUrl = process.env.APP_BASE_URL || process.env.VITE_APP_BASE_URL;
  if (envUrl) return envUrl.replace(/\/$/, '');
  const origin = (req.headers.origin as string) || '';
  if (origin) return origin.replace(/\/$/, '');
  const host = (req.headers['x-forwarded-host'] || req.headers.host) as string;
  return host ? `https://${host}` : 'https://fivocrm.vercel.app';
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

  const rawAction = req.query.action;
  const action = (Array.isArray(rawAction) ? rawAction[0] : rawAction) || '';
  const { businessId, plan, interval } = (req.body || {}) as {
    businessId?: string; plan?: string; interval?: string;
  };
  if (!businessId || typeof businessId !== 'string') return res.status(400).json({ error: 'Missing businessId' });

  // ── authorize: owner of THIS business (super-admin may act on any tenant) ──
  const bizRef = db.collection('businesses').doc(businessId);
  const bizSnap = await bizRef.get();
  if (!bizSnap.exists) return res.status(404).json({ error: 'Business not found' });
  const biz = bizSnap.data() as any;
  const isOwner = biz.ownerId === decoded.uid;
  if (!isOwner && decoded.superAdmin !== true) {
    return res.status(403).json({ error: 'Vetëm pronari i biznesit mund të menaxhojë abonimin.' });
  }

  let stripe: Stripe;
  try {
    stripe = stripeClient();
  } catch (err: any) {
    return res.status(503).json({ error: 'Faturimi nuk është konfiguruar (STRIPE_SECRET_KEY mungon).' });
  }

  // ── Stripe customer, created once per tenant and remembered ──
  const ensureCustomer = async (): Promise<string> => {
    if (biz.stripeCustomerId) return biz.stripeCustomerId as string;
    const customer = await stripe.customers.create({
      name: biz.name || undefined,
      email: biz.billingEmail || biz.ownerEmail || decoded.email || undefined,
      // The tenant id travels with the customer so every webhook can find its way
      // back to exactly one business, even for events without a session.
      metadata: { businessId },
    });
    await bizRef.set({ stripeCustomerId: customer.id, updatedAt: admin.firestore.Timestamp.now() }, { merge: true });
    biz.stripeCustomerId = customer.id;
    return customer.id;
  };

  try {
    if (action === 'checkout') {
      const wantedPlan = plan as BillablePlan;
      const wantedInterval = (interval === 'year' ? 'year' : 'month') as BillingInterval;
      if (!['starter', 'pro', 'business'].includes(wantedPlan)) {
        return res.status(400).json({ error: 'Plan i pavlefshëm (starter|pro|business).' });
      }
      const priceId = priceIdFor(wantedPlan, wantedInterval);
      if (!priceId) {
        return res.status(503).json({
          error: `Çmimi për planin ${wantedPlan}/${wantedInterval} nuk është konfiguruar në Stripe (env STRIPE_PRICE_*).`,
        });
      }

      const customerId = await ensureCustomer();
      const base = appBaseUrl(req);
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        customer: customerId,
        line_items: [{ price: priceId, quantity: 1 }],
        client_reference_id: businessId,
        // Both the session AND the subscription carry businessId, so the webhook can
        // resolve the tenant from any subscription/invoice event later on.
        metadata: { businessId, plan: wantedPlan, interval: wantedInterval },
        subscription_data: { metadata: { businessId, plan: wantedPlan } },
        allow_promotion_codes: true,
        success_url: `${base}/app/billing?checkout=success`,
        cancel_url: `${base}/app/billing?checkout=cancel`,
      });

      await writeAudit({
        businessId, actorUid: decoded.uid, actorEmail: decoded.email || null,
        action: 'billing.checkout_started', target: `plan:${wantedPlan}`,
        meta: { interval: wantedInterval, sessionId: session.id },
      });
      return res.status(200).json({ url: session.url });
    }

    if (action === 'portal') {
      if (!biz.stripeCustomerId) {
        return res.status(409).json({ error: 'Nuk ka abonim aktiv për të menaxhuar.' });
      }
      const base = appBaseUrl(req);
      const session = await stripe.billingPortal.sessions.create({
        customer: biz.stripeCustomerId,
        return_url: `${base}/app/billing`,
      });
      await writeAudit({
        businessId, actorUid: decoded.uid, actorEmail: decoded.email || null,
        action: 'billing.portal_opened', target: `business:${businessId}`,
      });
      return res.status(200).json({ url: session.url });
    }

    return res.status(400).json({ error: 'Unknown action (checkout|portal)' });
  } catch (err: any) {
    console.error('[billing] failed:', err?.message || err);
    return res.status(500).json({ error: err?.message || 'Faturimi dështoi' });
  }
}
