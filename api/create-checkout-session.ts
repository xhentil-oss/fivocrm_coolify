import type { VercelRequest, VercelResponse } from '@vercel/node';
import Stripe from 'stripe';
import { adminAuth, adminDb as db } from './_firebaseAdmin.js';

// Lazy init (same pattern as api/_billing.ts): constructing Stripe at MODULE LOAD
// with a missing STRIPE_SECRET_KEY crashes the whole function — every request,
// even OPTIONS, then 500s with an empty body and no reachable error path.
let stripeSingleton: Stripe | null = null;
function stripeClient(): Stripe {
  if (!stripeSingleton) {
    if (!process.env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY is not configured');
    stripeSingleton = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2026-02-25.clover' });
  }
  return stripeSingleton;
}

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
// NOTE: fivocrm.com is the PRIMARY domain — the public /pay page lives there, and
// its success/cancel redirects go through the host allowlist below. Leaving it out
// 400'd ("Invalid redirect URLs") every public-link payment.
const ALLOWED_HOSTS = (process.env.ALLOWED_HOSTS || 'fivocrm.com,fivoo.net,fivocrm.vercel.app,localhost,vercel.app')
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

  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(503).json({ error: 'Pagesat online nuk janë konfiguruar (STRIPE_SECRET_KEY mungon në server).' });
  }

  // Auth is OPTIONAL here: a request may instead carry a `payToken` matching the
  // invoice's `publicPayToken` — the shareable "pay without logging in" link. The
  // token is minted by staff (random 48 hex chars, stored on the invoice), so
  // possession of the link is the authorization, exactly like a Stripe invoice link.
  const uid = await verifyAuthToken(req.headers.authorization as string | undefined);

  try {
    // NOTE: the client also sends `amount` and `currency`; both are deliberately
    // ignored — the invoice document is the only authority on what is charged.
    const { invoiceId, invoiceNumber, customerEmail, customerName, successUrl, cancelUrl, payToken, info } = req.body;
    const wantsInfo = info === true;

    if (!invoiceId || (!wantsInfo && (!successUrl || !cancelUrl))) {
      return res.status(400).json({ error: 'Missing required fields: invoiceId, successUrl, cancelUrl' });
    }

    if (!wantsInfo) {
      // Host-allowlisted, not merely protocol-checked. A public pay link is
      // authorized by possession of the token, so anyone holding one could
      // otherwise have Stripe bounce the paying client to an arbitrary site
      // after payment — a ready-made phishing hop off a legitimate checkout.
      const redirectAllowed = (raw: string): boolean => {
        try {
          const u = new URL(raw);
          if (!['http:', 'https:'].includes(u.protocol)) return false;
          return ALLOWED_HOSTS.some(h => u.hostname === h || u.hostname.endsWith(`.${h}`));
        } catch {
          return false;
        }
      };
      if (!redirectAllowed(successUrl) || !redirectAllowed(cancelUrl)) {
        return res.status(400).json({ error: 'Invalid redirect URLs' });
      }
    }

    // Load invoice from Firestore — amount is authoritative here, never from the client
    const invoiceDoc = await db.collection('invoices').doc(invoiceId).get();
    if (!invoiceDoc.exists) return res.status(404).json({ error: 'Invoice not found' });

    const invoiceData = invoiceDoc.data()!;
    const invoiceTeamId = invoiceData.teamId as string | undefined;
    const invoiceBusinessId = invoiceData.businessId as string | undefined;

    // Public-link authorization: an unguessable token minted by staff and stored on
    // THIS invoice. Length-gated so an empty/short token in the data can never match.
    const publicOk = typeof payToken === 'string'
      && payToken.length >= 32
      && typeof invoiceData.publicPayToken === 'string'
      && invoiceData.publicPayToken.length >= 32
      && payToken === invoiceData.publicPayToken;

    // Authorize: valid public pay link, OR staff member of the invoice's team/business,
    // OR the portal client for this invoice's customer. Fail closed — an invoice scoped
    // to neither a team nor a business (and not owned by the calling portal client) is
    // rejected, never skipped. Recurring/legacy invoices set teamId=null but still
    // carry businessId.
    if (!publicOk) {
      if (!uid) return res.status(401).json({ error: 'Unauthorized' });
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

    // Line items — used by BOTH the info payload (the /pay page lists them) and
    // Stripe Checkout (real per-article lines instead of one opaque total). Names
    // resolve like the portal does: free-text description, else the catalogue
    // service's title.
    const itemsSnap = await db.collection('invoiceItems')
      .where('invoiceId', '==', invoiceId).limit(50).get().catch(() => null);
    const rawItems = (itemsSnap?.docs || []).map(d => d.data() as any);
    const serviceIds: string[] = [...new Set(
      rawItems.filter(it => !String(it.description || '').trim() && it.serviceId).map(it => String(it.serviceId)),
    )].slice(0, 20);
    const serviceNames = new Map<string, string>();
    await Promise.all(serviceIds.map(async (sid) => {
      const s = await db.collection('services').doc(sid).get().catch(() => null);
      const nm = (s?.data() as any)?.title || (s?.data() as any)?.name;
      if (nm) serviceNames.set(sid, String(nm));
    }));
    const lineItems = rawItems.map(it => ({
      name: String(String(it.description || '').trim() || serviceNames.get(String(it.serviceId)) || 'Shërbim').slice(0, 200),
      quantity: Number(it.quantity) > 0 ? Number(it.quantity) : 1,
      totalPrice: Number(it.totalPrice) || 0,
    }));

    // Info mode: the public /pay page asks what to render BEFORE offering payment.
    // Returns only the fields that belong on a payment receipt — never the full
    // invoice document — and reports paid/cancelled states instead of 409-ing, so
    // the page can show "e paguar" rather than an error.
    if (wantsInfo) {
      const infoTotal = Number(invoiceData.total ?? invoiceData.amount ?? 0) || 0;
      const infoPaidRaw = Number(invoiceData.paidAmount || 0);
      const infoPaid = Number.isFinite(infoPaidRaw) && infoPaidRaw > 0 ? infoPaidRaw : 0;
      const remainder = Math.max(0, infoTotal - infoPaid);
      let businessName: string | null = null;
      if (invoiceBusinessId) {
        const biz = await db.collection('businesses').doc(invoiceBusinessId).get().catch(() => null);
        businessName = (biz?.data() as any)?.name || null;
      }
      const status = (invoiceData.status as string) || 'Pending';
      return res.status(200).json({
        invoiceNumber: invoiceData.invoiceNumber || invoiceId.slice(0, 8),
        status,
        currency: (invoiceData.currency as string) || 'ALL',
        total: infoTotal,
        remainder,
        businessName,
        items: lineItems,
        payable: status !== 'Paid' && status !== 'Cancelled' && status !== 'Draft' && remainder > 0,
      });
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
    // The staff UI never offers payment on a draft ("financial guard, not just UX"),
    // but the guard has to live HERE: the portal lists a client's drafts too, and a
    // direct API call could otherwise pay an unsent, still-being-edited invoice.
    if (invoiceData.status === 'Draft') {
      return res.status(409).json({ error: 'Fatura është ende draft — dërgojeni para se të pranohet pagesë.' });
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
    const rawCurrency = ((invoiceData.currency as string | undefined) || 'all').toLowerCase();
    // Data aliases for the house currency — older invoices carry 'LEK'/'Lekë'.
    const invoiceCurrency = rawCurrency === 'lek' || rawCurrency === 'lekë' ? 'all' : rawCurrency;
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

    // ── Stripe line items ────────────────────────────────────────────────────
    // Show the client WHAT they're paying for: one Stripe line per invoice article.
    // Only when the articles sum EXACTLY to the invoice total (no discount/tax gap)
    // and nothing was pre-paid — the webhook's amount guard compares the session
    // total to the cent, so per-line conversion rounding is pinned onto the last
    // line to keep the sum identical to the authoritative unitAmount.
    let stripeLineItems: Stripe.Checkout.SessionCreateParams.LineItem[] | null = null;
    const itemsSum = lineItems.reduce((s, it) => s + it.totalPrice, 0);
    if (alreadyPaid === 0
      && lineItems.length > 0 && lineItems.length <= 20
      && Math.abs(itemsSum - invoiceTotal) < 0.01) {
      const centsPerLine = lineItems.map(it => Math.round((it.totalPrice / fxRate) * 100));
      centsPerLine[centsPerLine.length - 1] += unitAmount - centsPerLine.reduce((s, c) => s + c, 0);
      if (centsPerLine.every(c => c > 0)) {
        stripeLineItems = lineItems.map((it, i) => ({
          price_data: {
            currency: chargeCurrency,
            product_data: { name: it.quantity > 1 ? `${it.quantity} × ${it.name}` : it.name },
            unit_amount: centsPerLine[i],
          },
          quantity: 1,
        }));
      }
    }
    if (!stripeLineItems) {
      // Fallback: one line for the whole (remaining) amount. Listing the article
      // names in the description still tells the client what this is for.
      const itemNames = lineItems.slice(0, 4).map(it => it.name).join(', ');
      stripeLineItems = [
        {
          price_data: {
            currency: chargeCurrency,
            product_data: {
              name: `Fatura ${invoiceNumber || invoiceData.invoiceNumber || invoiceId.slice(0, 8)}`,
              description: (itemNames || (customerName ? `Pagesë nga ${customerName}` : '')).slice(0, 250) || undefined,
            },
            unit_amount: unitAmount,
          },
          quantity: 1,
        },
      ];
    }

    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: stripeLineItems,
      metadata: {
        invoiceId,
        invoiceNumber: invoiceNumber || invoiceData.invoiceNumber || '',
        requestedByUid: uid || 'public-link',
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

    const session = await stripeClient().checkout.sessions.create(sessionParams);
    return res.status(200).json({ sessionId: session.id, url: session.url });
  } catch (err: any) {
    console.error('Stripe Checkout error:', err.message);
    // Stripe's own rejections (bad currency, sub-minimum amount, key issues) carry
    // the actionable detail — surface them; anything else stays generic.
    const msg = typeof err?.type === 'string' && err.type.startsWith('Stripe')
      ? `Stripe: ${err.message}`
      : 'Failed to create checkout session';
    return res.status(500).json({ error: msg });
  }
}
