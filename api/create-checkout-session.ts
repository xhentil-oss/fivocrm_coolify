import type { VercelRequest, VercelResponse } from '@vercel/node';
import Stripe from 'stripe';
import { adminAuth, adminDb as db } from './_firebaseAdmin.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-02-25.clover',
});

// Currencies Stripe supports here. Anything else is rejected rather than
// silently forwarded to Stripe (which would 400 late, or worse, charge wrong).
const ALLOWED_CURRENCIES = new Set(['eur', 'usd', 'gbp', 'all']);

// Same host allowlist convention used by the email endpoints (ALLOWED_HOSTS).
// We echo the request Origin only when its host is allowed — never a blanket
// `*`, which combined with credentials:true is a CORS misconfiguration.
const ALLOWED_HOSTS = (process.env.ALLOWED_HOSTS || 'fivoo.net,fivocrm.vercel.app,localhost,vercel.app')
  .split(',')
  .map(h => h.trim())
  .filter(Boolean);
const PRIMARY_ORIGIN = process.env.VITE_APP_URL || 'https://app.fivoo.net';

function resolveAllowedOrigin(origin: string | undefined): string | null {
  if (!origin) return null;
  try {
    const host = new URL(origin).hostname;
    const ok = ALLOWED_HOSTS.some(h => host === h || host.endsWith(`.${h}`));
    return ok ? origin : null;
  } catch {
    return null;
  }
}

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
  const allowedOrigin = resolveAllowedOrigin(req.headers.origin as string | undefined);
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin || PRIMARY_ORIGIN);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  // Credentials are only meaningful for an explicitly-allowed origin; never pair
  // with a wildcard/fallback origin.
  if (allowedOrigin) res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const uid = await verifyAuthToken(req.headers.authorization as string | undefined);
  if (!uid) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const { invoiceId, invoiceNumber, currency, customerEmail, customerName, successUrl, cancelUrl } = req.body;

    if (!invoiceId || !successUrl || !cancelUrl) {
      return res.status(400).json({ error: 'Missing required fields: invoiceId, successUrl, cancelUrl' });
    }

    try {
      const successParsed = new URL(successUrl);
      const cancelParsed = new URL(cancelUrl);
      if (!['http:', 'https:'].includes(successParsed.protocol) || !['http:', 'https:'].includes(cancelParsed.protocol)) {
        return res.status(400).json({ error: 'Invalid redirect URLs' });
      }
    } catch {
      return res.status(400).json({ error: 'Invalid redirect URLs' });
    }

    // Load invoice from Firestore — amount is authoritative here, never from the client
    const invoiceDoc = await db.collection('invoices').doc(invoiceId).get();
    if (!invoiceDoc.exists) return res.status(404).json({ error: 'Invoice not found' });

    const invoiceData = invoiceDoc.data()!;
    const invoiceTeamId = invoiceData.teamId as string | undefined;
    const invoiceBusinessId = invoiceData.businessId as string | undefined;

    // Authorize: staff member of the invoice's team/business OR the portal client for
    // this invoice's customer. Fail closed — an invoice scoped to neither a team nor a
    // business (and not owned by the calling portal client) is rejected, never skipped.
    // Recurring/legacy invoices set teamId=null but still carry businessId.
    {
      const [teamSnap, bizSnap, portalSnap] = await Promise.all([
        invoiceTeamId
          ? db.collection('teamMembers').where('teamId', '==', invoiceTeamId).where('userId', '==', uid).limit(1).get()
          : Promise.resolve({ empty: true } as any),
        invoiceBusinessId
          ? db.collection('teamMembers').where('businessId', '==', invoiceBusinessId).where('userId', '==', uid).limit(1).get()
          : Promise.resolve({ empty: true } as any),
        invoiceData.customerId
          ? db.collection('clientPortalAccess').where('userId', '==', uid).where('customerId', '==', invoiceData.customerId).limit(1).get()
          : Promise.resolve({ empty: true } as any),
      ]);
      if (teamSnap.empty && bizSnap.empty && portalSnap.empty) {
        return res.status(403).json({ error: 'Forbidden' });
      }
    }

    // Use server-side amount — never trust client-supplied amount
    const amount = invoiceData.total ?? invoiceData.amount ?? 0;
    if (typeof amount !== 'number' || amount <= 0) {
      return res.status(400).json({ error: 'Invoice has no payable amount' });
    }

    // Normalise currency: use invoice's stored currency, fall back to client hint, then EUR
    const invoiceCurrency = (invoiceData.currency as string | undefined)?.toLowerCase();
    const resolvedCurrency = invoiceCurrency === 'all' ? 'all' : (invoiceCurrency || (currency as string | undefined)?.toLowerCase() || 'eur');
    if (!ALLOWED_CURRENCIES.has(resolvedCurrency)) {
      return res.status(400).json({ error: `Unsupported currency: ${resolvedCurrency}` });
    }

    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: resolvedCurrency,
            product_data: {
              name: `Fatura ${invoiceNumber || invoiceData.invoiceNumber || invoiceId.slice(0, 8)}`,
              description: customerName ? `Pagesë nga ${customerName}` : undefined,
            },
            unit_amount: Math.round(amount * 100),
          },
          quantity: 1,
        },
      ],
      metadata: {
        invoiceId,
        invoiceNumber: invoiceNumber || invoiceData.invoiceNumber || '',
        requestedByUid: uid,
      },
      success_url: successUrl,
      cancel_url: cancelUrl,
    };

    if (customerEmail) sessionParams.customer_email = customerEmail;

    const session = await stripe.checkout.sessions.create(sessionParams);
    return res.status(200).json({ sessionId: session.id, url: session.url });
  } catch (err: any) {
    console.error('Stripe Checkout error:', err.message);
    return res.status(500).json({ error: 'Failed to create checkout session' });
  }
}
