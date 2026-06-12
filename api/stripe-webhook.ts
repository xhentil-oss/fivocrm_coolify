import type { VercelRequest, VercelResponse } from '@vercel/node';
import Stripe from 'stripe';
import admin, { adminDb as db } from './_firebaseAdmin.js';
import { whmcsConfigured, pushInvoicePayment } from './_whmcs.js';

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
          if (invoiceData?.source === 'whmcs' && invoiceData?.whmcsInvoiceId && whmcsConfigured()) {
            try {
              const result = await pushInvoicePayment({
                whmcsInvoiceId: invoiceData.whmcsInvoiceId,
                transId: (session.payment_intent as string) || session.id,
                gateway: 'stripe',
                amount: (session.amount_total || 0) / 100,
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

  // Acknowledge the event
  return res.status(200).json({ received: true });
}
