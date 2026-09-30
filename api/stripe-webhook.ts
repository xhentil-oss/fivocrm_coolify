import type { VercelRequest, VercelResponse } from '@vercel/node';
import Stripe from 'stripe';
import admin, { adminDb as db } from './_firebaseAdmin.js';
import { whmcsConfigured } from './_whmcs.js';
import { drainPendingWhmcsPayments } from './_whmcsSync.js';
import { managerIdsForBusiness } from './_staffRecipients.js';
import {
  planForPriceId, seatsForPlan, tenantStatusFromStripe, monthlyAmountCents,
  subscriptionPeriodEnd, invoiceSubscriptionId,
} from './_billingPlans.js';
import { writeAudit } from './_audit.js';
import { notifyUser } from './_push.js';
import { onHostingInvoicePaid } from './_hostingJobs.js';

// Lazy init: constructing Stripe at MODULE LOAD with a missing STRIPE_SECRET_KEY
// crashes the function on every request — Stripe's retries then hit a dead endpoint.
let stripeSingleton: Stripe | null = null;
function stripeClient(): Stripe {
  if (!stripeSingleton) {
    if (!process.env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY is not configured');
    stripeSingleton = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2026-02-25.clover' });
  }
  return stripeSingleton;
}

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

/** Human-readable amount in the currency Stripe actually charged — never a hardcoded €. */
function formatAmount(cents: number, currency?: string | null): string {
  const value = (cents / 100).toFixed(2);
  const cur = (currency || 'eur').toLowerCase();
  if (cur === 'eur') return `€${value}`;
  if (cur === 'usd') return `$${value}`;
  if (cur === 'gbp') return `£${value}`;
  if (cur === 'all') return `${value} L`;
  return `${value} ${cur.toUpperCase()}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!sig || !webhookSecret || !process.env.STRIPE_SECRET_KEY) {
    console.error('[Stripe Webhook] missing configuration (signature/webhook secret/secret key)');
    return res.status(400).json({ error: 'Missing signature or webhook secret' });
  }

  let event: Stripe.Event;

  try {
    const rawBody = await getRawBody(req);
    event = stripeClient().webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err: any) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  // A tenant's CLIENT paying an invoice (mode: 'payment'). Card payments confirm via
  // `checkout.session.completed`; async/delayed methods (bank transfers etc.) complete
  // later via `checkout.session.async_payment_succeeded` — both land here.
  if (event.type === 'checkout.session.completed'
    || event.type === 'checkout.session.async_payment_succeeded') {
    const session = event.data.object as Stripe.Checkout.Session;
    const invoiceId = session.metadata?.invoiceId;

    // SECURITY: only act on genuinely-paid sessions. `checkout.session.completed`
    // also fires for async/delayed payment methods with payment_status 'unpaid';
    // acting on those would mark the invoice Paid (and post to WHMCS) before the
    // money actually arrives. The real confirmation for those arrives later via
    // `checkout.session.async_payment_succeeded`, handled by this same branch.
    if (invoiceId && session.payment_status !== 'paid') {
      console.warn(`[Stripe Webhook] session ${session.id} completed but payment_status=${session.payment_status}; not marking paid.`);
      return res.status(200).json({ received: true, skipped: 'payment_not_completed' });
    }

    if (invoiceId) {
      try {
        await handleInvoiceCheckoutPaid(session, invoiceId);
      } catch (err: any) {
        console.error('Error updating invoice:', err.message);
        return res.status(500).json({ error: 'Failed to update invoice' });
      }
    }
  }

  // A refund on a client-invoice charge (issued from the Stripe Dashboard, e.g. for
  // the double-payment case). The invoice is stamped and the creator notified — the
  // STATUS is deliberately left alone: whether a refunded invoice reopens is an
  // accounting decision, never an automatic one.
  if (event.type === 'charge.refunded') {
    try {
      await handleChargeRefunded(event.data.object as Stripe.Charge);
    } catch (err: any) {
      console.error('[Stripe Webhook] refund handling failed:', err?.message || err);
      return res.status(500).json({ error: 'Failed to record refund' });
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

/**
 * A paid Checkout session for a tenant-client invoice → mark it Paid.
 *
 * ALL guards and writes run inside ONE transaction: two different sessions paying
 * the same invoice within seconds used to both read `Pending`, both pass the
 * guards and both commit — the double payment never escalated and the ledger
 * double-counted. The transaction serialises them: the second one re-reads `Paid`
 * and lands in the duplicate branch. Guard order:
 *  1. redelivery of the same session → no-op (no duplicate notification/WHMCS push);
 *  2. a DIFFERENT session paying an already-Paid invoice → double payment: never
 *     overwritten, recorded + escalated for a manual refund;
 *  3. paid amount ≠ current remainder (invoice edited after the link was created)
 *     → payment recorded but the invoice is NOT marked fully Paid; a human reconciles.
 * Side effects (notifications, WHMCS) run AFTER the commit — a transaction may retry.
 */
async function handleInvoiceCheckoutPaid(session: Stripe.Checkout.Session, invoiceId: string): Promise<void> {
  const invoiceRef = db.collection('invoices').doc(invoiceId);
  const nowTs = admin.firestore.Timestamp.now();
  // Deterministic ledger id keyed on the session → redeliveries and retries
  // overwrite the same row instead of double-counting a receipt.
  const ledgerRef = db.collection('payments').doc(`${invoiceId}_stripe_${session.id}`);

  const paidCents = session.amount_total ?? 0;
  const payCurrency = String(session.currency || '').toLowerCase();
  const fxRate = Number(session.metadata?.fxRate) || 1;
  const snapCurrency = String(session.metadata?.invoiceCurrency || '').toLowerCase();

  type Outcome =
    | { kind: 'missing' }
    | { kind: 'redelivery' }
    | { kind: 'duplicate'; inv: Record<string, any> }
    | { kind: 'mismatch'; inv: Record<string, any>; expectedCents: number; receivedNative: number; settles: boolean; whmcsQueued: boolean }
    | { kind: 'paid'; inv: Record<string, any>; invCurrency: string; whmcsQueued: boolean };

  const outcome = await db.runTransaction<Outcome>(async (tx) => {
    const [snap, ledgerSnap] = await Promise.all([tx.get(invoiceRef), tx.get(ledgerRef)]);
    if (!snap.exists) return { kind: 'missing' };
    const inv = snap.data()!;

    // 1. Idempotency: Stripe redelivers events. The ledger row is keyed by the
    // SESSION, so its existence proves this delivery was already processed —
    // whatever it did to the status (Paid, Partial on a mismatch). The legacy
    // guard below covers invoices settled before the ledger existed.
    if (ledgerSnap.exists) return { kind: 'redelivery' };
    if (inv.status === 'Paid' && inv.stripeSessionId === session.id) {
      return { kind: 'redelivery' };
    }

    // 2. A different payment on an already-Paid invoice is a DOUBLE PAYMENT (stale
    // tab, a concurrent second session, or paid by bank in the meantime). Stripe took
    // the money, so surface it loudly for a manual refund — never silently overwrite
    // the original payment record.
    if (inv.status === 'Paid') {
      tx.update(invoiceRef, {
        duplicateStripeSessionIds: admin.firestore.FieldValue.arrayUnion(session.id),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return { kind: 'duplicate', inv };
    }

    // 3. The session snapshotted the invoice at link-creation time — including the
    // ALL→EUR conversion rate for Lek invoices (metadata.fxRate; Stripe can't charge
    // 'all') and the REMAINDER for partially-paid ones. Recompute what the CURRENT
    // invoice should cost through that same rate: a difference means the invoice
    // changed under the link — record the payment but leave the status alone so a
    // human reconciles instead of closing a wrong total.
    const invoiceTotal = Number(inv.total ?? inv.amount ?? 0);
    const alreadyPaidRaw = Number(inv.paidAmount || 0);
    const alreadyPaid = Number.isFinite(alreadyPaidRaw) && alreadyPaidRaw > 0 ? alreadyPaidRaw : 0;
    const remainderNative = invoiceTotal - alreadyPaid;
    const expectedCents = Math.round((remainderNative / fxRate) * 100);
    const rawInvCurrency = String(inv.currency || '').toLowerCase();
    // Same house-currency aliasing as checkout — older invoices carry 'LEK'/'Lekë'.
    const invCurrency = rawInvCurrency === 'lek' || rawInvCurrency === 'lekë' ? 'all' : rawInvCurrency;
    const currentCurrency = invCurrency || 'all'; // no currency set = Lek (house currency)
    // A Lek invoice is LEGITIMATELY paid in EUR, so "currency changed" is judged
    // against the invoice currency the server snapshotted at link creation, not the
    // charge currency. Pre-metadata sessions fall back to the raw comparison,
    // skipping 'all'/'' (the house currency, which always charges as EUR).
    const currencyMismatch = snapCurrency
      ? currentCurrency !== snapCurrency
      : (currentCurrency !== 'all' && !!payCurrency && currentCurrency !== payCurrency);
    const ledgerRow = (amountNative: number) => ({
      invoiceId,
      invoiceNumber: inv.invoiceNumber || null,
      customerId: inv.customerId ?? null,
      amount: amountNative,
      currency: inv.currency || 'ALL',
      method: 'Stripe',
      paidAt: nowTs,
      teamId: inv.teamId ?? null,
      businessId: inv.businessId ?? null,
      source: 'stripe',
      sourceKey: `${invoiceId}#stripe:${session.id}`,
      stripeSessionId: session.id,
      stripePaymentIntentId: (session.payment_intent as string) || null,
      chargedCents: paidCents,
      chargedCurrency: payCurrency || null,
    });
    const instalmentIndex = Array.isArray(inv.partialPayments) ? inv.partialPayments.length : 0;

    if (paidCents !== expectedCents || currencyMismatch) {
      // The money is REAL: Stripe took it. Book what was actually received (a
      // ledger row, `paidAmount`, an instalment entry) and set the status the
      // arithmetic supports — Partial below the total, Paid at or above it — and
      // keep `stripePaymentMismatch` for the operator. Recording NOTHING used to
      // leave a paid-for invoice Pending, dunned by every reminder job, with the
      // receipt visible only in the Stripe dashboard.
      const receivedNative = Math.round((paidCents / 100) * fxRate * 100) / 100;
      const newPaid = Math.round((alreadyPaid + receivedNative) * 100) / 100;
      const settles = invoiceTotal > 0 && newPaid >= invoiceTotal - 0.005;
      const whmcsQ = whmcsPendingPatchFor(inv, settles
        ? { key: 'full', method: 'Stripe', paidAt: nowTs }
        : { key: `p${instalmentIndex}`, amount: receivedNative, method: 'Stripe', paidAt: nowTs });
      tx.update(invoiceRef, {
        status: settles ? 'Paid' : 'Partial',
        ...(settles ? { paidAt: admin.firestore.FieldValue.serverTimestamp() } : {}),
        paymentMethod: 'Stripe',
        paidAmount: newPaid,
        partialPayments: admin.firestore.FieldValue.arrayUnion({
          amount: receivedNative,
          method: 'Stripe',
          note: 'Stripe Checkout (shuma nuk përputhet me faturën)',
          paidAt: nowTs,
        }),
        stripeSessionId: session.id,
        stripePaymentIntentId: (session.payment_intent as string) || null,
        stripePaymentMismatch: {
          paidCents,
          expectedCents,
          fxRate,
          paidCurrency: payCurrency || null,
          invoiceCurrency: currentCurrency,
          receivedNative,
          at: nowTs,
        },
        ...(whmcsQ || {}),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      tx.set(ledgerRef, ledgerRow(receivedNative), { merge: true });
      return { kind: 'mismatch', inv, expectedCents, receivedNative, settles, whmcsQueued: !!whmcsQ };
    }

    // Mark Paid AND mirror into the payment ledger (arkëtime) atomically: staff
    // instalments write a `payments` row, so online payments must too or the ledger
    // under-reports — and a retry can never mark Paid without the row.
    const hasInstalments = alreadyPaid > 0 || Array.isArray(inv.partialPayments);
    // WHMCS mirror: the write-back is QUEUED in this same update (mirror of
    // `whmcsPendingPatch`, src/lib/whmcsPayment.ts). The webhook used to push to
    // WHMCS directly and, on failure, write only `whmcsPaymentSyncError` — which
    // `upsertInvoice` ignores, so the next sync rewrote the invoice to Pending
    // with `paidAt: null`. A non-empty queue is what makes the sync preserve the
    // local Paid until WHMCS confirms. `full` closes the balance in WHMCS's own
    // currency, so a Lek invoice charged in EUR never posts a wrong sum.
    const whmcsQ = whmcsPendingPatchFor(inv, { key: 'full', method: 'Stripe', paidAt: nowTs });
    tx.update(invoiceRef, {
      status: 'Paid',
      paidAt: admin.firestore.FieldValue.serverTimestamp(),
      paymentMethod: 'Stripe',
      stripeSessionId: session.id,
      stripePaymentIntentId: session.payment_intent as string,
      // A partially-paid invoice closes: bring its instalment bookkeeping up to date
      // so `paidAmount` never reads less than a Paid invoice's total.
      ...(hasInstalments ? {
        paidAmount: invoiceTotal,
        partialPayments: admin.firestore.FieldValue.arrayUnion({
          amount: remainderNative,
          method: 'Stripe',
          note: 'Stripe Checkout',
          paidAt: nowTs,
        }),
      } : {}),
      ...(whmcsQ || {}),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    tx.set(ledgerRef, ledgerRow(remainderNative), { merge: true });
    return { kind: 'paid', inv, invCurrency, whmcsQueued: !!whmcsQ };
  });

  if (outcome.kind === 'missing') return;
  if (outcome.kind === 'redelivery') {
    console.log(`[Stripe Webhook] invoice ${invoiceId} already paid by session ${session.id}; skipping redelivery.`);
    return;
  }

  const invoiceData = outcome.inv;
  const invoiceLabel = invoiceData.invoiceNumber || invoiceId.slice(0, 8);
  const paidPretty = formatAmount(paidCents, session.currency);

  const notifyCreator = (title: string, message: string) => notifyInvoiceStakeholders(invoiceData, title, message);

  if (outcome.kind === 'duplicate') {
    console.error(`[Stripe Webhook] DOUBLE PAYMENT: invoice ${invoiceId} already Paid (session ${invoiceData.stripeSessionId || '?'}) but session ${session.id} paid it again.`);
    await notifyCreator(
      'Pagesë e dyfishtë ⚠️',
      `Fatura ${invoiceLabel} ishte tashmë e paguar, por u pagua sërish me Stripe (${paidPretty}). Nevojitet rimbursim manual nga Stripe Dashboard.`,
    );
    return;
  }

  if (outcome.kind === 'mismatch') {
    console.error(`[Stripe Webhook] AMOUNT MISMATCH on invoice ${invoiceId}: paid ${paidCents} ${payCurrency || '?'}, expected ${outcome.expectedCents} (fxRate=${fxRate}); booked ${outcome.receivedNative} as ${outcome.settles ? 'Paid' : 'Partial'}.`);
    await notifyCreator(
      'Pagesë me shumë të ndryshuar ⚠️',
      `Fatura ${invoiceLabel} u pagua me Stripe (${paidPretty}), por totali i faturës nuk përputhet me shumën e paguar (${formatAmount(outcome.expectedCents, payCurrency)} e pritur). U regjistrua shuma e marrë dhe fatura u shënua "${outcome.settles ? 'Paguar' : 'Pjesërisht'}" — kontrolloje manualisht.`,
    );
    if (outcome.whmcsQueued) await drainWhmcsQueue(invoiceRef, invoiceId);
    return;
  }

  const invCurrency = outcome.invCurrency;

  await notifyCreator(
    'Pagesë e Pranuar ✓',
    `Fatura ${invoiceLabel} u pagua me Stripe — ${paidPretty}`,
  );

  console.log(`Invoice ${invoiceId} marked as paid via Stripe${invCurrency !== payCurrency ? ` (charged in ${payCurrency || '?'})` : ''}`);

  // Hosting & domains: a paid order → provision; a paid renewal → advance the due
  // date / renew at the registrar. Best-effort and idempotent (the hourly
  // `hosting-lifecycle` job is the backstop) — never fail the webhook on it.
  if (invoiceData?.source === 'hosting') {
    try {
      const r = await onHostingInvoicePaid(invoiceId, null);
      console.log(`[Stripe Webhook] hosting invoice ${invoiceId}: ${r.handled.join(', ') || 'nothing to do'}`);
    } catch (err) {
      console.error('[Stripe Webhook] hosting post-payment failed:', err);
    }
  }

  // Write the payment back to WHMCS for WHMCS-sourced invoices (best-effort).
  // The entry was queued inside the transaction; draining it now is the fast
  // path, the sync is the backstop. Dedupe is per payment KEY (queued / synced
  // keys), not "was anything ever synced": a Stripe remainder after a cash
  // instalment that had set `whmcsPaymentSyncedAt` used to be skipped forever.
  if (outcome.whmcsQueued) await drainWhmcsQueue(invoiceRef, invoiceId);
}

/**
 * Mirror of `whmcsPendingPatch` (src/lib/whmcsPayment.ts) for server-side writes:
 * the fields to spread into the SAME update that records a payment on a
 * WHMCS-mirrored invoice, or null when the invoice is not WHMCS-sourced or the
 * key is already queued / synced. transid is derived from the key by the drain
 * (`manualPaymentTransId`), so a redelivery can never double-post.
 */
function whmcsPendingPatchFor(
  inv: Record<string, any>,
  entry: { key: string; amount?: number; method: string; paidAt: admin.firestore.Timestamp },
): Record<string, any> | null {
  if (inv.source !== 'whmcs' || !inv.whmcsInvoiceId) return null;
  const existing: any[] = Array.isArray(inv.whmcsPendingPayments) ? inv.whmcsPendingPayments : [];
  const synced: string[] = Array.isArray(inv.whmcsSyncedPaymentKeys) ? inv.whmcsSyncedPaymentKeys : [];
  if (existing.some((p) => p?.key === entry.key) || synced.includes(entry.key)) return null;
  const row: Record<string, any> = { key: entry.key, method: entry.method, paidAt: entry.paidAt };
  if (typeof entry.amount === 'number' && entry.amount > 0) row.amount = entry.amount;
  return { whmcsPendingPayments: [...existing, row], whmcsPaymentPendingAt: entry.paidAt };
}

/** Post the queued WHMCS payment(s) now. A failure leaves the queue non-empty, which is what keeps the sync from reverting the local status. */
async function drainWhmcsQueue(invoiceRef: FirebaseFirestore.DocumentReference, invoiceId: string): Promise<void> {
  if (!whmcsConfigured()) return;
  try {
    const fresh = (await invoiceRef.get()).data() || {};
    const r = await drainPendingWhmcsPayments(invoiceId, fresh, { writeBack: true });
    if (r.failed.length) console.error(`[Stripe Webhook] WHMCS write-back failed for invoice ${fresh.whmcsInvoiceId}: ${r.failed.map((f) => `${f.key}: ${f.error}`).join(' | ')}`);
    else if (r.synced.length) console.log(`[Stripe Webhook] WHMCS invoice ${fresh.whmcsInvoiceId} payment recorded (${r.synced.join(', ')})`);
  } catch (err: any) {
    console.error('[Stripe Webhook] WHMCS write-back threw:', err?.message || err);
  }
}

/**
 * Who hears about a payment event on this invoice. The creator when there is
 * one; otherwise the tenant's owner + Admins/Managers. WHMCS, hosting and cron
 * invoices carry `createdByUserId: null`, so double-payment, mismatch and refund
 * escalations on them used to reach NOBODY.
 */
async function notifyInvoiceStakeholders(invoiceData: Record<string, any>, title: string, message: string): Promise<void> {
  const recipients = new Set<string>();
  if (invoiceData.createdByUserId) {
    recipients.add(String(invoiceData.createdByUserId));
  } else {
    const businessId = invoiceData.businessId ? String(invoiceData.businessId) : null;
    if (businessId) {
      try {
        const biz = (await db.collection('businesses').doc(businessId).get()).data() as any;
        if (biz?.ownerId) recipients.add(String(biz.ownerId));
      } catch { /* fall through to the managers */ }
    }
    try {
      for (const uid of await managerIdsForBusiness(businessId, invoiceData.teamId ? String(invoiceData.teamId) : null, { cap: 5 })) recipients.add(uid);
    } catch { /* recipients stay as-is */ }
  }
  if (!recipients.size) {
    console.warn(`[Stripe Webhook] no recipient for invoice event "${title}" (business ${invoiceData.businessId || '?'})`);
    return;
  }
  await Promise.allSettled([...recipients].map((userId) => notifyUser({
    userId,
    type: 'invoice_paid',
    title,
    message,
    actionUrl: '/app/invoices',
    actionLabel: 'Shiko Faturat',
    businessId: invoiceData.businessId ?? null,
    teamId: invoiceData.teamId ?? null,
    customerId: invoiceData.customerId ?? null,
  }).catch((err) => console.error('[Stripe Webhook] notification dërgim dështoi:', err))));
}

/**
 * A charge tied to a client invoice was refunded (fully or partially) in Stripe.
 * Stamps the invoice + its ledger row and notifies the invoice creator. Idempotent:
 * re-stamping the same amounts is a no-op in effect, and notifications key off a
 * change in the refunded amount.
 */
async function handleChargeRefunded(charge: Stripe.Charge): Promise<void> {
  const pi = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id;
  if (!pi) return;
  const snap = await db.collection('invoices').where('stripePaymentIntentId', '==', pi).limit(1).get();
  if (snap.empty) {
    // E.g. the refund of a DOUBLE payment: the duplicate session's PI is not the one
    // stored on the invoice. Nothing to stamp — the duplicate was already escalated.
    console.log(`[Stripe Webhook] refund for PI ${pi} matches no invoice; ignoring.`);
    return;
  }
  const invoiceRef = snap.docs[0].ref;
  const invoiceData = snap.docs[0].data();
  const refundedCents = charge.amount_refunded ?? 0;
  const alreadyStamped = Number(invoiceData.stripeRefundedCents || 0);
  if (refundedCents <= alreadyStamped) return; // redelivery / older event

  const fullyRefunded = charge.refunded === true || refundedCents >= (charge.amount ?? 0);
  await invoiceRef.update({
    stripeRefundedCents: refundedCents,
    stripeRefundedAt: admin.firestore.Timestamp.now(),
    ...(fullyRefunded ? { stripeFullyRefunded: true } : {}),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  // Mirror onto the ledger row so arkëtime reports can exclude refunded receipts.
  const ledger = await db.collection('payments').where('stripePaymentIntentId', '==', pi).limit(5).get();
  for (const d of ledger.docs) {
    await d.ref.update({
      refundedCents,
      refundedAt: admin.firestore.Timestamp.now(),
      ...(fullyRefunded ? { refunded: true } : {}),
    }).catch(() => {});
  }

  {
    const label = invoiceData.invoiceNumber || invoiceRef.id.slice(0, 8);
    await notifyInvoiceStakeholders(
      invoiceData,
      fullyRefunded ? 'Pagesa u rimbursua ⚠️' : 'Rimbursim i pjesshëm ⚠️',
      `Fatura ${label}: u rimbursuan ${formatAmount(refundedCents, charge.currency)} në Stripe. Statusi i faturës nuk u ndryshua — përditësoje manualisht nëse duhet.`,
    );
  }
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
      const sub = await stripeClient().subscriptions.retrieve(subscriptionId);
      plan = planForPriceId(sub.items.data[0]?.price?.id) || (session.metadata?.plan as string) || null;
      periodEnd = subscriptionPeriodEnd(sub);
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
    const nextStatus = tenantStatusFromStripe(stripeStatus); // null = not a transition
    // The grace clock is only cleared for a genuinely healthy subscription; a checkout
    // that resolves to past_due (or no transition at all) must not reset dunning.
    const clearsDunning = nextStatus === 'active' || nextStatus === 'trialing';

    await db.collection('businesses').doc(businessId).set({
      // Never write null over an existing stripeCustomerId — resolveBusinessId
      // depends on it for every later event that has no metadata.
      ...(typeof session.customer === 'string' ? { stripeCustomerId: session.customer } : {}),
      stripeSubscriptionId: subscriptionId,
      ...(!alreadyActivated && nextStatus === 'active' ? { activatedAt: now } : {}),
      ...(plan ? { plan, seats: seatsForPlan(plan) } : {}),
      ...(money ? {
        mrrCents: money.mrrCents,
        billingCurrency: money.currency,
        billingInterval: money.interval,
        billingQuantity: money.quantity,
      } : {}),
      ...(livemode === null ? {} : { stripeLivemode: livemode }),
      ...(nextStatus ? { status: nextStatus } : {}),
      ...(clearsDunning ? {
        canceledAt: admin.firestore.FieldValue.delete(),
        pastDueSince: admin.firestore.FieldValue.delete(),
        suspendedAt: admin.firestore.FieldValue.delete(),
      } : {}),
      ...(periodEnd ? { currentPeriodEnd: admin.firestore.Timestamp.fromMillis(periodEnd * 1000) } : {}),
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
    if (!status) {
      // 'incomplete': the checkout was never finished — not a tenant transition.
      console.log(`[Stripe Webhook] subscription ${sub.id} is '${sub.status}'; ignoring.`);
      return;
    }
    const periodEnd = subscriptionPeriodEnd(sub);

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
      // A tenant the cron already SUSPENDED stays suspended: Stripe keeps sending
      // `past_due` updates (each retry attempt), and writing past_due back
      // re-enabled the tenant's writes until the next lifecycle tick. Only a
      // genuinely healthy subscription (active / trialing) lifts a suspension.
      if (before.status === 'suspended') patch.status = 'suspended';
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
    const subscriptionId = invoiceSubscriptionId(invoice);
    if (!subscriptionId) return;
    const businessId = await resolveBusinessId({
      metadataBusinessId: (invoice.metadata?.businessId as string) || null,
      customerId: typeof invoice.customer === 'string' ? invoice.customer : null,
    });
    if (!businessId) return;

    if (event.type === 'invoice.paid') {
      // A €0 "paid" invoice (100% coupon, Stripe-trial start) is not a payment: it
      // must neither flip the tenant active nor stamp the trial→paid conversion —
      // `customer.subscription.updated` already keeps the status truthful.
      const amountPaid = (invoice as any).amount_paid ?? 0;
      if (amountPaid <= 0) {
        console.log(`[Stripe Webhook] invoice ${invoice.id} paid with amount 0; not treating as a payment.`);
        return;
      }
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
      const failedBefore = (snap.data() as any) || {};
      // Same law as above: a failed retry on a suspended tenant does not un-suspend it.
      const patch: Record<string, any> = { status: failedBefore.status === 'suspended' ? 'suspended' : 'past_due', updatedAt: now };
      if (!failedBefore.pastDueSince) patch.pastDueSince = now;
      await db.collection('businesses').doc(businessId).set(patch, { merge: true });
      await writeAudit({ businessId, actorUid: null, action: 'billing.payment_failed', target: `invoice:${invoice.id}` });
    }
  }
}
