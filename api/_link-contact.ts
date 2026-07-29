import type { VercelRequest, VercelResponse } from '@vercel/node';
import admin, { adminDb as db, Timestamp } from './_firebaseAdmin.js';
import { normContactEmail, findLeadForContact, crossLinkLeadCustomer } from './_contactIdentity.js';

/**
 * POST /api/link-contact
 * Body: { customerId: string }
 * Header: Authorization: Bearer <Firebase ID token>
 *
 * Pairs a customer record with the CRM lead for the same person, creating that
 * lead when none exists yet (a portal signup must still show up in the pipeline).
 *
 * Why this lives on the server: Firestore rules only let business members write
 * to `leads` (and only let a portal client read leads already stamped with their
 * own customerId). So a client signing into the portal for the first time cannot
 * find or link the lead that a landing-page submission created for them — the
 * link has to be made with admin credentials.
 *
 * Authorization: the caller must own the customer record — its email must equal
 * the verified token email. A portal client can therefore only ever link their
 * own contact, and staff never need this endpoint (they link via the CRM UI).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });

  let decoded: admin.auth.DecodedIdToken;
  try {
    decoded = await admin.auth().verifyIdToken(authHeader.slice(7));
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }

  const { customerId } = (req.body || {}) as { customerId?: unknown };
  if (!customerId || typeof customerId !== 'string') {
    return res.status(400).json({ error: 'Missing customerId' });
  }

  const callerEmail = normContactEmail(decoded.email);
  if (!callerEmail) return res.status(403).json({ error: 'Token has no email' });

  const customerSnap = await db.collection('customers').doc(customerId).get();
  if (!customerSnap.exists) return res.status(404).json({ error: 'Customer not found' });

  const customer = customerSnap.data() || {};
  if (normContactEmail(customer.email) !== callerEmail) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  // Already paired — nothing to do (and never overwrite a deliberate pairing).
  if (customer.leadId) return res.status(200).json({ linked: false, reason: 'already-linked' });

  const now = Timestamp.now();
  const lead = await findLeadForContact(db, {
    email: customer.email,
    phone: customer.phone,
    teamId: customer.teamId || null,
    businessId: customer.businessId || null,
  });

  if (lead) {
    await crossLinkLeadCustomer(db, lead.id, customerId);
    // crossLinkLeadCustomer only fills empty links; make sure the customer side
    // reflects this pairing even if the doc was written a moment ago.
    await customerSnap.ref.update({ leadId: lead.id, updatedAt: now }).catch(() => {});
    return res.status(200).json({ linked: true, created: false, leadId: lead.id });
  }

  // No lead for this person yet — create one so the portal signup lands in the
  // pipeline, already linked in both directions. Tenant keys are copied from the
  // customer so the lead can never land outside their business.
  const created = await db.collection('leads').add({
    name: customer.name || callerEmail,
    email: normContactEmail(customer.email),
    ...(customer.phone ? { phoneNumber: customer.phone } : {}),
    ...(customer.company ? { company: customer.company } : {}),
    status: 'New',
    source: 'Portal - Regjistrim',
    customerId,
    ...(customer.teamId ? { teamId: customer.teamId } : {}),
    ...(customer.businessId ? { businessId: customer.businessId } : {}),
    createdAt: now,
    updatedAt: now,
    createdByUserId: decoded.uid,
  });
  await customerSnap.ref.update({ leadId: created.id, updatedAt: now }).catch(() => {});

  return res.status(200).json({ linked: true, created: true, leadId: created.id });
}
