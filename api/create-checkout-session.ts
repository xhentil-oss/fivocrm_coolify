import type { VercelRequest, VercelResponse } from '@vercel/node';
import Stripe from 'stripe';
import { adminAuth, adminDb as db } from './_firebaseAdmin.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-02-25.clover',
});

async function verifyAuthToken(authHeader: string | undefined): Promise<string | null> {
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    return decoded.uid;
  } catch {
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Require authenticated user
  const uid = await verifyAuthToken(req.headers.authorization as string | undefined);
  if (!uid) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { invoiceId, invoiceNumber, amount, currency, customerEmail, customerName, successUrl, cancelUrl } = req.body;

    if (!invoiceId || !amount || !successUrl || !cancelUrl) {
      return res.status(400).json({ error: 'Missing required fields: invoiceId, amount, successUrl, cancelUrl' });
    }

    if (typeof amount !== 'number' || amount <= 0) {
      return res.status(400).json({ error: 'Amount must be a positive number' });
    }

    // Validate successUrl and cancelUrl are safe origins
    try {
      const successParsed = new URL(successUrl);
      const cancelParsed = new URL(cancelUrl);
      if (!['http:', 'https:'].includes(successParsed.protocol) || !['http:', 'https:'].includes(cancelParsed.protocol)) {
        return res.status(400).json({ error: 'Invalid redirect URLs' });
      }
    } catch {
      return res.status(400).json({ error: 'Invalid redirect URLs' });
    }

    // Verify the caller belongs to the invoice's team
    const invoiceDoc = await db.collection('invoices').doc(invoiceId).get();
    if (!invoiceDoc.exists) {
      return res.status(404).json({ error: 'Invoice not found' });
    }
    const invoiceTeamId = invoiceDoc.data()?.teamId;
    if (invoiceTeamId) {
      const memberSnap = await db.collection('teamMembers')
        .where('teamId', '==', invoiceTeamId)
        .where('userId', '==', uid)
        .limit(1)
        .get();
      if (memberSnap.empty) {
        return res.status(403).json({ error: 'Forbidden' });
      }
    }

    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: currency || 'eur',
            product_data: {
              name: `Fatura ${invoiceNumber || invoiceId.slice(0, 8)}`,
              description: customerName ? `Pagesë nga ${customerName}` : undefined,
            },
            unit_amount: Math.round(amount * 100), // Stripe uses cents
          },
          quantity: 1,
        },
      ],
      metadata: {
        invoiceId,
        invoiceNumber: invoiceNumber || '',
        requestedByUid: uid,
      },
      success_url: successUrl,
      cancel_url: cancelUrl,
    };

    if (customerEmail) {
      sessionParams.customer_email = customerEmail;
    }

    const session = await stripe.checkout.sessions.create(sessionParams);

    return res.status(200).json({
      sessionId: session.id,
      url: session.url,
    });
  } catch (err: any) {
    console.error('Stripe Checkout error:', err.message);
    return res.status(500).json({ error: 'Failed to create checkout session' });
  }
}
