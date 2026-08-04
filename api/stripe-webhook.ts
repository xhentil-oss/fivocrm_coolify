import type { VercelRequest, VercelResponse } from '@vercel/node';
import Stripe from 'stripe';
import admin, { adminDb as db } from './_firebaseAdmin.js';
import { whmcsConfigured, pushInvoicePayment } from './_whmcs.js';
import { planForPriceId, seatsForPlan, tenantStatusFromStripe, monthlyAmountCents } from './_billingPlans.js';
import { writeAudit } from './_audit.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-02-25.clover',
});

// Disable body parsing — Stripe needs the raw body for signature verification
export const config = {
  api: { bodyParser: false },
};

async function getRawBody(req: VercelRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!sig || !webhookSecret) {
    return res.status(400).json({ error: 'Missing signature or webhook secret' });
  }

  let event: Stripe.Event;

  try {
    const rawBody = await getRawBody(req);
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err: any) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const invoiceId = session.metadata?.invoiceId;

    // SECURITY: only act on genuinely-paid sessions. `checkout.session.completed`
    // also fires for async/delayed payment methods with payment_status 'unpaid';
    // acting on those would mark the invoice Paid (and post to WHMCS) before the
    // money actually arrives. The real confirmation for those arrives later via
    // `checkout.session.async_payment_succeeded`.
    if (invoiceId && session.payment_status !== 'paid') {
      console.warn(`[Stripe Webhook] session ${session.id} completed but payment_status=${session.payment_status}; not marking paid.`);
      return res.status(200).json({ received: true, skipped: 'payment_not_completed' });
    }

    if (invoiceId) {
      try {
        const invoiceRef = db.collection('invoices').doc(invoiceId);
        const invoiceSnap = await invoiceRef.get();

        if (invoiceSnap.exists) {
          await invoiceRef.update({
            status: 'Paid',
            paidAt: admin.firestore.FieldValue.serverTimestamp(),
            paymentMethod: 'Stripe',
            stripeSessionId: session.id,
            stripePaymentIntentId: session.payment_intent as string,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });

          // Create notification for invoice creator
          const invoiceData = invoiceSnap.data();
          if (invoiceData?.createdByUserId) {
            await db.collection('notifications').add({
              userId: invoiceData.createdByUserId,
              type: 'invoice_paid',
              title: 'Pagesë e Pranuar ✓',
              message: `Fatura ${invoiceData.invoiceNumber || invoiceId.slice(0, 8)} u pagua me Stripe — €${((session.amount_total || 0) / 100).toFixed(2)}`,
              isRead: false,
              actionUrl: '/app/invoices',
              actionLabel: 'Shiko Faturat',
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
            }).catch(err => console.error('[Stripe Webhook] notification dërgim dështoi:', err));
          }

          console.log(`Invoice ${invoiceId} marked as paid via Stripe`);

          // Write the payment back to WHMCS for WHMCS-sourced invoices (best-effort).
          // Never fail the Stripe webhook on a WHMCS error — the FivoCRM invoice is
          // already Paid; a 500 would make Stripe retry the whole event.
          // Idempotency: skip if this invoice's payment was already pushed to WHMCS
          // (Stripe can redeliver the same event). transId dedup is a second guard.
          const alreadySynced = !!invoiceData?.whmcsPaymentSyncedAt;
          if (invoiceData?.source === 'whmcs' && invoiceData?.whmcsInvoiceId && !alreadySynced && whmcsConfigured()) {
            try {
              // SECURITY: only send a numeric amount when the Stripe charge currency
              // matches the invoice currency. On a mismatch, omit it so WHMCS closes
              // the full balance in its own currency instead of recording a wrong sum.
              const invCurrency = String(invoiceData.currency || '').toLowerCase();
              const payCurrency = String(session.currency || '').toLowerCase();
              const currencyMatches = !!invCurrency && invCurrency === payCurrency;
              if (!currencyMatches) {
                console.warn(`[Stripe Webhook] currency mismatch (invoice=${invCurrency || '?'} stripe=${payCurrency || '?'}) for WHMCS invoice ${invoiceData.whmcsInvoiceId}; letting WHMCS close full balance.`);
              }
              const result = await pushInvoicePayment({
                whmcsInvoiceId: invoiceData.whmcsInvoiceId,
                transId: (session.payment_intent as string) || session.id,
                gateway: 'stripe',
                amount: currencyMatches ? (session.amount_total || 0) / 100 : undefined,
                date: new Date(),
              });
              if (result.ok) {
                console.log(`[Stripe Webhook] WHMCS invoice ${invoiceData.whmcsInvoiceId} payment recorded${result.alreadyRecorded ? ' (already existed)' : ''}`);
                await invoiceRef.update({
                  whmcsPaymentSyncedAt: admin.firestore.FieldValue.serverTimestamp(),
                  whmcsPaymentSyncError: admin.firestore.FieldValue.delete(),
                }).catch(() => {});
              } else {
                console.error(`[Stripe Webhook] WHMCS write-back failed for invoice ${invoiceData.whmcsInvoiceId}: ${result.message}`);
                await invoiceRef.update({ whmcsPaymentSyncError: result.message || 'unknown' }).catch(() => {});
              }
            } catch (err: any) {
              console.error('[Stripe Webhook] WHMCS write-back threw:', err?.message || err);
              await invoiceRef.update({ whmcsPaymentSyncError: String(err?.message || err).slice(0, 500) }).catch(() => {});
            }
          }
        }
      } catch (err: any) {
        console.error('Error updating invoice:', err.message);
        return res.status(500).json({ error: 'Failed to update invoice' });
      }
    }
  }

  // ── SaaS SUBSCRIPTION lifecycle (the tenant's own plan) ────────────────────
  // Distinct from the block above, which is a TENANT'S CLIENT paying an invoice
  // (mode: 'payment'). Here the FivoCRM tenant pays FivoCRM (mode: 'subscription').
  try {
    await handleSubscriptionEvent(event);
  } catch (err: any) {
    console.error('[Stripe Webhook] subscription handling failed:', err?.message || err);
    // A 500 makes Stripe retry, which is what we want for a transient write failure —
    // the handler is idempotent.
    return res.status(500).json({ error: 'Failed to apply subscription state' });
  }

  // Acknowledge the event
  return res.status(200).json({ received: true });
}

/** Resolve the tenant a Stripe object belongs to, without trusting client input. */
async function resolveBusinessId(args: {
  metadataBusinessId?: string | null;
  customerId?: string | null;
}): Promise<string | null> {
  if (args.metadataBusinessId) return args.metadataBusinessId;
  if (!args.customerId) return null;
  const snap = await db.collection('businesses')
    .where('stripeCustomerId', '==', args.customerId).limit(1).get();
  return snap.empty ? null : snap.docs[0].id;
}

/**
 * Apply subscription state onto `businesses/{id}`.
 *
 * The PLAN is always derived from the Stripe Price actually being billed, never from
 * the checkout request — so a tampered request body cannot grant a higher tier. The
 * STATUS maps Stripe's subscription status onto the tenant lifecycle, which Firestore
 * rules then enforce (`tenantActive()` freezes writes for a suspended tenant).
 */
async function handleSubscriptionEvent(event: Stripe.Event): Promise<void> {
  const now = admin.firestore.Timestamp.now();

  // 1. Checkout finished → attach customer + subscription to the tenant.
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    if (session.mode !== 'subscription') return;
    const businessId = await resolveBusinessId({
      metadataBusinessId: session.metadata?.businessId || session.client_reference_id,
      customerId: typeof session.customer === 'string' ? session.customer : null,
    });
    if (!businessId) {
      console.warn('[Stripe Webhook] subscription checkout without a resolvable businessId');
      return;
    }
    const subscriptionId = typeof session.subscription === 'string' ? session.subscription : null;
    let plan: string | null = null;
    let periodEnd: number | null = null;
    let stripeStatus = 'active';
    let money: ReturnType<typeof monthlyAmountCents> = null;
    let livemode: boolean | null = null;
    if (subscriptionId) {
      const sub = await stripe.subscriptions.retrieve(subscriptionId);
      plan = planForPriceId(sub.items.data[0]?.price?.id) || (session.metadata?.plan as string) || null;
      periodEnd = ((sub as any).current_period_end as number) || null;
      stripeStatus = sub.status;
      // What Stripe actually bills, normalised to a month — the console's MRR.
      money = monthlyAmountCents(sub as any);
      livemode = (sub as any).livemode ?? null;
    }
    // `activatedAt` marks the trial→paid conversion, ONCE. The platform-metrics
    // rollup counts conversions by this stamp, so it must never be overwritten by a
    // later renewal (hence the read before the write).
    const bizBefore = await db.collection('businesses').doc(businessId).get();
    const alreadyActivated = !!(bizBefore.data() as any)?.activatedAt;
    const nextStatus = tenantStatusFromStripe(stripeStatus);

    await db.collection('businesses').doc(businessId).set({
      stripeCustomerId: typeof session.customer === 'string' ? session.customer : null,
      stripeSubscriptionId: subscriptionId,
      ...(!alreadyActivated && nextStatus === 'active' ? { activatedAt: now } : {}),
      canceledAt: admin.firestore.FieldValue.delete(),
      ...(plan ? { plan, seats: seatsForPlan(plan) } : {}),
      ...(money ? {
        mrrCents: money.mrrCents,
        billingCurrency: money.currency,
        billingInterval: money.interval,
        billingQuantity: money.quantity,
      } : {}),
      ...(livemode === null ? {} : { stripeLivemode: livemode }),
      status: tenantStatusFromStripe(stripeStatus),
      ...(periodEnd ? { currentPeriodEnd: admin.firestore.Timestamp.fromMillis(periodEnd * 1000) } : {}),
      pastDueSince: admin.firestore.FieldValue.delete(),
      suspendedAt: admin.firestore.FieldValue.delete(),
      updatedAt: now,
    }, { merge: true });
    await writeAudit({
      businessId, actorUid: null, action: 'billing.subscription_started',
      target: `plan:${plan || 'unknown'}`, meta: { subscriptionId },
    });
    return;
  }

  // 2. Subscription created/updated/deleted → keep plan + status in sync.
  if (event.type === 'customer.subscription.created'
    || event.type === 'customer.subscription.updated'
    || event.type === 'customer.subscription.deleted') {
    const sub = event.data.object as Stripe.Subscription;
    const businessId = await resolveBusinessId({
      metadataBusinessId: (sub.metadata?.businessId as string) || null,
      customerId: typeof sub.customer === 'string' ? sub.customer : null,
    });
    if (!businessId) return;

    const deleted = event.type === 'customer.subscription.deleted';
    const plan = planForPriceId(sub.items.data[0]?.price?.id);
    const status = deleted ? 'canceled' : tenantStatusFromStripe(sub.status);
    const periodEnd = (sub as any).current_period_end as number | undefined;

    const patch: Record<string, any> = {
      stripeSubscriptionId: deleted ? admin.firestore.FieldValue.delete() : sub.id,
      status,
      cancelAtPeriodEnd: !!sub.cancel_at_period_end,
      updatedAt: now,
    };
    // The tier is kept on cancellation so the owner still sees what they had; access
    // is governed by `status`, not `plan`.
    if (plan && !deleted) { patch.plan = plan; patch.seats = seatsForPlan(plan); }
    // MRR follows the subscription: a plan change, a seat change, a coupon or a switch
    // to yearly all land here. Cancellation zeroes it — the tenant stopped paying.
    if (deleted) {
      patch.mrrCents = 0;
    } else {
      const money = monthlyAmountCents(sub as any);
      if (money) {
        patch.mrrCents = money.mrrCents;
        patch.billingCurrency = money.currency;
        patch.billingInterval = money.interval;
        patch.billingQuantity = money.quantity;
      }
      if ((sub as any).livemode !== undefined) patch.stripeLivemode = (sub as any).livemode;
    }
    if (periodEnd) patch.currentPeriodEnd = admin.firestore.Timestamp.fromMillis(periodEnd * 1000);
    const snap = await db.collection('businesses').doc(businessId).get();
    const before = (snap.data() as any) || {};
    if (status === 'past_due') {
      // Start the grace clock only once (the cron suspends when it runs out).
      if (!before.pastDueSince) patch.pastDueSince = now;
    } else if (status === 'active') {
      patch.pastDueSince = admin.firestore.FieldValue.delete();
      patch.suspendedAt = admin.firestore.FieldValue.delete();
      patch.canceledAt = admin.firestore.FieldValue.delete();
      // First ever activation → the conversion moment the platform metrics count.
      if (!before.activatedAt) patch.activatedAt = now;
    } else if (status === 'canceled' && !before.canceledAt) {
      // Churn cohort stamp (kept even if the tenant later resubscribes: a new
      // activation clears it, so a month's churn count stays historically true).
      patch.canceledAt = now;
    }

    await db.collection('businesses').doc(businessId).set(patch, { merge: true });
    await writeAudit({
      businessId, actorUid: null, action: `billing.${event.type}`,
      target: `subscription:${sub.id}`, meta: { status, plan: plan || null },
    });
    return;
  }

  // 3. Invoice paid / failed → status + grace clock.
  if (event.type === 'invoice.paid' || event.type === 'invoice.payment_failed') {
    const invoice = event.data.object as Stripe.Invoice;
    // Only OUR subscription invoices matter here; a tenant's own client invoices are
    // one-off payments (handled above) and carry no subscription.
    const subscriptionId = (invoice as any).subscription;
    if (!subscriptionId) return;
    const businessId = await resolveBusinessId({
      metadataBusinessId: (invoice.metadata?.businessId as string) || null,
      customerId: typeof invoice.customer === 'string' ? invoice.customer : null,
    });
    if (!businessId) return;

    if (event.type === 'invoice.paid') {
      const paidSnap = await db.collection('businesses').doc(businessId).get();
      const paidBefore = (paidSnap.data() as any) || {};
      await db.collection('businesses').doc(businessId).set({
        status: 'active',
        pastDueSince: admin.firestore.FieldValue.delete(),
        suspendedAt: admin.firestore.FieldValue.delete(),
        canceledAt: admin.firestore.FieldValue.delete(),
        ...(paidBefore.activatedAt ? {} : { activatedAt: now }),
        lastPaymentAt: now,
        updatedAt: now,
      }, { merge: true });
      await writeAudit({ businessId, actorUid: null, action: 'billing.invoice_paid', target: `invoice:${invoice.id}` });
    } else {
      const snap = await db.collection('businesses').doc(businessId).get();
      const patch: Record<string, any> = { status: 'past_due', updatedAt: now };
      if (!(snap.data() as any)?.pastDueSince) patch.pastDueSince = now;
      await db.collection('businesses').doc(businessId).set(patch, { merge: true });
      await writeAudit({ businessId, actorUid: null, action: 'billing.payment_failed', target: `invoice:${invoice.id}` });
    }
  }
}
