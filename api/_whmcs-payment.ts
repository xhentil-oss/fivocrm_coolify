import type { VercelRequest, VercelResponse } from '@vercel/node';
import admin, { adminAuth, adminDb as db } from './_firebaseAdmin.js';
import { whmcsConfigured } from './_whmcs.js';
import { drainPendingWhmcsPayments } from './_whmcsSync.js';

/**
 * POST /api/whmcs-payment  { invoiceId }
 *
 * Posts every payment queued on `invoices/{id}.whmcsPendingPayments` to WHMCS
 * (AddInvoicePayment). The queue is written by the UI in the SAME update that
 * marks the invoice paid / records an instalment (src/lib/whmcsPayment.ts), so
 * this call is best-effort: if it never arrives, the next `whmcs-sync` drains
 * the queue itself and — until then — preserves the local status.
 *
 * Authorization: staff of the invoice's business (`bid` claim, or a teamMembers
 * membership for tokens that predate the claims rollout). A portal client
 * (`cid`) is refused whatever else the token carries. The server reads only the
 * invoice id from the body — amounts, keys and dates come from the document.
 *
 * Routed through api/email.ts (`?type=whmcs-payment`) — Vercel Hobby caps the
 * project at 12 functions.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization as string | undefined;
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  let decoded: admin.auth.DecodedIdToken;
  try {
    decoded = await adminAuth.verifyIdToken(authHeader.slice(7));
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
  if ((decoded as any).cid) return res.status(403).json({ error: 'Vetëm stafi mund të regjistrojë pagesa në WHMCS.' });

  const invoiceId = typeof req.body?.invoiceId === 'string' ? req.body.invoiceId.trim() : '';
  if (!invoiceId || !/^[\w-]{1,128}$/.test(invoiceId)) return res.status(400).json({ error: 'invoiceId mungon ose është i pavlefshëm' });

  const ref = db.collection('invoices').doc(invoiceId);
  const snap = await ref.get();
  if (!snap.exists) return res.status(404).json({ error: 'Fatura nuk u gjet' });
  const inv = snap.data() as Record<string, any>;

  if (inv.source !== 'whmcs' || !inv.whmcsInvoiceId) {
    return res.status(400).json({ error: 'Kjo faturë nuk vjen nga WHMCS — s’ka çfarë të pasqyrohet.' });
  }

  const businessId: string | null = inv.businessId || inv.teamId || null;
  if (!(await isBusinessStaff(decoded, businessId, inv.teamId || null))) {
    return res.status(403).json({ error: 'Nuk ke akses te kjo faturë.' });
  }

  if (!whmcsConfigured()) {
    return res.status(503).json({ error: 'WHMCS nuk është konfiguruar në server (WHMCS_API_URL / IDENTIFIER / SECRET).' });
  }

  const pending: any[] = Array.isArray(inv.whmcsPendingPayments) ? inv.whmcsPendingPayments : [];
  if (!pending.length) {
    // Nothing queued: the UI may have raced the sync, or the entry was already
    // drained. Report the state rather than inventing a payment.
    return res.status(200).json({ ok: true, alreadyRecorded: true, synced: [], remaining: 0 });
  }

  try {
    const r = await drainPendingWhmcsPayments(invoiceId, inv, { writeBack: true });
    if (r.failed.length) {
      console.error(`[whmcs-payment] invoice ${invoiceId}: ${r.failed.map((f) => `${f.key} → ${f.error}`).join('; ')}`);
      return res.status(502).json({
        error: `WHMCS refuzoi pagesën: ${r.failed[0].error}`,
        synced: r.synced,
        failed: r.failed,
        remaining: r.remaining,
      });
    }
    console.log(`[whmcs-payment] invoice ${invoiceId} (WHMCS #${inv.whmcsInvoiceId}): ${r.synced.join(', ')} recorded by ${decoded.uid}`);
    return res.status(200).json({ ok: true, synced: r.synced, remaining: 0 });
  } catch (err: any) {
    const msg = String(err?.message || err).slice(0, 500);
    console.error('[whmcs-payment] threw:', msg);
    await ref.update({ whmcsPaymentSyncError: msg }).catch(() => {});
    return res.status(500).json({ error: msg });
  }
}

/**
 * Any active STAFF member of the invoice's business. `bid` on the token is
 * proof of staff membership; a mismatching `bid` is a cross-tenant call.
 * Tokens minted before the claims rollout fall back to the membership doc.
 */
async function isBusinessStaff(decoded: admin.auth.DecodedIdToken, businessId: string | null, teamId: string | null): Promise<boolean> {
  if ((decoded as any).superAdmin === true) return true;
  if (!businessId) return false;
  const bid = (decoded as any).bid;
  if (typeof bid === 'string' && bid) return bid === businessId;
  try {
    const teamIds = new Set<string>();
    if (teamId) teamIds.add(teamId);
    const teams = await db.collection('teams').where('businessId', '==', businessId).limit(20).get();
    teams.docs.forEach((d) => teamIds.add(d.id));
    if (teams.docs.some((d) => (d.data() as any)?.createdByUserId === decoded.uid)) return true;
    for (const t of teamIds) {
      const m = await db.collection('teamMembers').doc(`${t}_${decoded.uid}`).get();
      if (m.exists && (m.data() as any)?.status !== 'Inactive') return true;
    }
  } catch (err) {
    console.error('[whmcs-payment] membership lookup failed:', (err as Error)?.message || err);
  }
  return false;
}
