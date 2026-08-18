import type { VercelRequest, VercelResponse } from '@vercel/node';
import Stripe from 'stripe';
import { adminAuth, adminDb as db } from './_firebaseAdmin.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-02-25.clover',
});

// Currencies this endpoint will forward to Stripe. ALL (Lek) is deliberately NOT
// here: Stripe rejects it for this account (session creation 500s), so Lek
// invoices are converted to EUR server-side below.
const ALLOWED_CURRENCIES = new Set(['eur', 'usd', 'gbp']);

// Fallback EUR→ALL rate — mirrors DEFAULT_RATES.EUR in src/lib/utils.ts. Only used
// when no team of the invoice's tenant has set teamSettings.eurAllRate.
const DEFAULT_EUR_ALL_RATE = 100;

/**
 * The tenant's own EUR→ALL rate. `teamSettings/{teamId}.eurAllRate` is the same
 * value the UI mirrors into localStorage (useTeamSettingsSync), so the server and
 * the client always convert with one rate. Bounded to a sanity window so a
 * corrupted setting can never divide a charge into pennies.
 */
async function eurToAllRate(teamId?: string, businessId?: string): Promise<number> {
  const valid = (raw: any): number | null => {
    const v = Number(raw);
    return Number.isFinite(v) && v >= 50 && v <= 500 ? v : null;
  };
  try {
    if (teamId) {
      const snap = await db.collection('teamSettings').doc(teamId).get();
      const v = valid((snap.data() as any)?.eurAllRate);
      if (v) return v;
    }
    if (businessId) {
      // Legacy invoices carry teamId=null but still a businessId — any team of the
      // business that has configured a rate will do.
      const teams = await db.collection('teams').where('businessId', '==', businessId).limit(5).get();
      for (const t of teams.docs) {
        const snap = await db.collection('teamSettings').doc(t.id).get();
        const v = valid((snap.data() as any)?.eurAllRate);
        if (v) return v;
      }
    }
  } catch (err: any) {
    console.warn('[create-checkout-session] eurAllRate lookup failed, using default:', err?.message || err);
  }
  return DEFAULT_EUR_ALL_RATE;
}

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
    // NOTE: the client also sends `amount` and `currency`; both are deliberately
    // ignored — the invoice document is the only authority on what is charged.
    const { invoiceId, invoiceNumber, customerEmail, customerName, successUrl, cancelUrl } = req.body;

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

    // An invoice that is already settled or voided must never be payable again —
    // a stale portal tab would double-charge the client. The webhook guards this
    // too (a paid session on a Paid invoice is escalated, not overwritten), but
    // refusing here stops the charge before Stripe ever takes the money.
    if (invoiceData.status === 'Paid') {
      return res.status(409).json({ error: 'Fatura është paguar tashmë.' });
    }
    if (invoiceData.status === 'Cancelled') {
      return res.status(409).json({ error: 'Fatura është anuluar dhe nuk mund të paguhet.' });
    }

    // Use server-side amount — never trust client-supplied amount. A partially-paid
    // invoice (staff records cash instalments as `paidAmount`/`partialPayments`)
    // charges only the REMAINDER — charging `total` again made the client pay the
    // already-settled part twice.
    const invoiceTotal = invoiceData.total ?? invoiceData.amount ?? 0;
    const alreadyPaidRaw = Number(invoiceData.paidAmount || 0);
    const alreadyPaid = Number.isFinite(alreadyPaidRaw) && alreadyPaidRaw > 0 ? alreadyPaidRaw : 0;
    const amount = invoiceTotal - alreadyPaid;
    if (typeof invoiceTotal !== 'number' || amount <= 0) {
      return res.status(400).json({ error: 'Invoice has no payable amount' });
    }

    // ── Currency & conversion ────────────────────────────────────────────────
    // The house currency is ALL (Lek): an invoice with NO explicit currency is Lek,
    // the same rule the UI applies. Defaulting it to EUR here once charged a
    // 120,000 L invoice as €120,000 (face value, unconverted). Stripe rejects 'all'
    // as a charge currency, so Lek invoices are charged in EUR, converted HERE with
    // the tenant's own rate — the client's pre-converted amount is never trusted.
    const invoiceCurrency = ((invoiceData.currency as string | undefined) || 'all').toLowerCase();
    let chargeCurrency = invoiceCurrency;
    let chargeAmount = amount;
    let fxRate = 1;
    if (invoiceCurrency === 'all') {
      fxRate = await eurToAllRate(invoiceTeamId, invoiceBusinessId);
      chargeCurrency = 'eur';
      chargeAmount = amount / fxRate;
    }
    if (!ALLOWED_CURRENCIES.has(chargeCurrency)) {
      return res.status(400).json({ error: `Unsupported currency: ${chargeCurrency}` });
    }

    const unitAmount = Math.round(chargeAmount * 100);
    // Stripe enforces a ~0.50 minimum per charge; failing here gives a clear 400
    // instead of a generic 500 from Stripe's rejection.
    if (unitAmount < 50) {
      return res.status(400).json({ error: 'Shuma e mbetur është nën minimumin e pagesës online (0.50).' });
    }

    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: chargeCurrency,
            product_data: {
              name: `Fatura ${invoiceNumber || invoiceData.invoiceNumber || invoiceId.slice(0, 8)}`,
              description: customerName ? `Pagesë nga ${customerName}` : undefined,
            },
            unit_amount: unitAmount,
          },
          quantity: 1,
        },
      ],
      metadata: {
        invoiceId,
        invoiceNumber: invoiceNumber || invoiceData.invoiceNumber || '',
        requestedByUid: uid,
        // Conversion snapshot: lets the webhook recompute what the CURRENT invoice
        // should cost through the SAME rate, so its amount-mismatch guard doesn't
        // misfire on Lek invoices legitimately charged in EUR.
        invoiceCurrency,
        fxRate: String(fxRate),
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
