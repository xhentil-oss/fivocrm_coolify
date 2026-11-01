import type { VercelRequest, VercelResponse } from '@vercel/node';
import admin, { adminDb as db, Timestamp } from './_firebaseAdmin.js';
import { normContactEmail, findLeadsForContact, crossLinkLeadCustomer, closeLeadsForClient, leadRouteFacts } from './_contactIdentity.js';
import { resolveContactRoute, reopenLeadPatch, clientDealDraft } from './_contactRoute.js';
import { verifiedEmail } from './_callerIdentity.js';

/**
 * POST /api/link-contact
 * Body: { customerId }                    — portal signup: pair the customer with its lead
 *       { customerId, serviceInquiryId, estimatedValue?, tags? }
 *                                         — portal service brief: a CLIENT gets a Deal,
 *                                           a prospect gets (or reuses / reopens) a lead
 * Header: Authorization: Bearer <Firebase ID token>
 *
 * `_contactRoute.ts` decides lead vs deal: a client (any customer status but
 * `Pending`) never gets an open lead — their open leads are closed here — and a
 * portal prospect (`Pending`) keeps exactly one lead in the pipeline.
 *
 * Why this lives on the server: Firestore rules only let business members write
 * to `leads` / `deals` (and only let a portal client read leads already stamped
 * with their own customerId). So a client cannot find, link or close their own
 * lead, nor open a deal — it has to be done with admin credentials.
 *
 * Authorization: the caller must own the customer record — its email must equal
 * the verified token email — and, for a brief, the inquiry must carry the
 * caller's uid as `clientUserId`. Staff never need this endpoint.
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

  const { customerId, serviceInquiryId, estimatedValue, tags } = (req.body || {}) as {
    customerId?: unknown; serviceInquiryId?: unknown; estimatedValue?: unknown; tags?: unknown;
  };
  if (!customerId || typeof customerId !== 'string') {
    return res.status(400).json({ error: 'Missing customerId' });
  }

  // Only a VERIFIED email is identity: a freshly-registered password account could
  // otherwise claim any customer's address and pair itself with that customer's lead.
  const callerEmail = normContactEmail(verifiedEmail(decoded));
  if (!callerEmail) return res.status(403).json({ error: 'Token has no verified email' });

  const customerSnap = await db.collection('customers').doc(customerId).get();
  if (!customerSnap.exists) return res.status(404).json({ error: 'Customer not found' });

  const customer = customerSnap.data() || {};
  if (normContactEmail(customer.email) !== callerEmail) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const now = Timestamp.now();
  // Tenant keys always come from the customer, so nothing can land outside their business.
  const tenant = {
    ...(customer.teamId ? { teamId: customer.teamId } : {}),
    ...(customer.businessId ? { businessId: customer.businessId } : {}),
  };
  const leadDocs = await findLeadsForContact(db, {
    email: customer.email,
    phone: customer.phone,
    teamId: customer.teamId || null,
    businessId: customer.businessId || null,
  });
  const customerFacts = { id: customerId, status: customer.status ?? null };

  // ── Portal service brief ("Pyetësori"): new business from this person ──────
  if (typeof serviceInquiryId === 'string' && serviceInquiryId) {
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(serviceInquiryId)) return res.status(400).json({ error: 'Bad serviceInquiryId' });
    const inqRef = db.collection('serviceInquiries').doc(serviceInquiryId);
    const inqSnap = await inqRef.get();
    const inq = inqSnap.exists ? (inqSnap.data() as any) : null;
    if (!inq || inq.clientUserId !== decoded.uid) return res.status(403).json({ error: 'Not your inquiry' });
    if (inq.businessId && customer.businessId && inq.businessId !== customer.businessId) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    // Idempotent: a resubmitted brief returns what the first one produced.
    if (inq.leadId || inq.dealId) {
      return res.status(200).json({ leadId: inq.leadId ?? null, dealId: inq.dealId ?? null, reused: true });
    }

    const services: string[] = Array.isArray(inq.servicesInterestedIn) ? inq.servicesInterestedIn.map(String).slice(0, 20) : [];
    const notes = [
      services.length ? `Shërbime: ${services.join(', ')}` : '',
      inq.mainGoal ? `Objektivi: ${inq.mainGoal}` : '',
      inq.budgetRange ? `Buxheti: ${inq.budgetRange}` : '',
      inq.timeline ? `Afati: ${inq.timeline}` : '',
      inq.projectNeedDescription ? `\nPërshkrimi: ${inq.projectNeedDescription}` : '',
      inq.currentMainChallenge ? `Sfida: ${inq.currentMainChallenge}` : '',
    ].filter(Boolean).join('\n').slice(0, 4000);
    const amount = Number(estimatedValue);
    const value = Number.isFinite(amount) && amount > 0 ? Math.min(amount, 1e10) : 0;

    const route = resolveContactRoute({ leads: leadRouteFacts(leadDocs), customer: customerFacts, intent: 'inquiry' });
    if (route.action === 'customer-deal') {
      // A client asking for more is a Deal on their record, never a lead again.
      await closeLeadsForClient(db, route.closeLeadIds, customerId);
      const dealRef = db.collection('deals').doc(`portal_inq_${serviceInquiryId}`);
      await dealRef.create({
        ...clientDealDraft({
          customer: { id: customerId, name: customer.name, status: customer.status ?? null, assignedToUserId: customer.assignedToUserId ?? null },
          subject: services.join(', ') || null,
          source: 'Service Questionnaire',
          notes,
          amount: value,
          at: now.toDate(),
        }),
        serviceInquiryId,
        ...tenant,
        createdAt: now,
        createdByUserId: null,
      }).catch((err: any) => {
        // The id IS the idempotency token — a racing resubmit already wrote it.
        if (!(err?.code === 6 || /ALREADY_EXISTS/i.test(String(err?.message || '')))) throw err;
      });
      await inqRef.update({ dealId: dealRef.id, customerId, updatedAt: now });
      return res.status(200).json({ leadId: null, dealId: dealRef.id, route: route.reason });
    }

    const tagList = Array.isArray(tags)
      ? tags.filter((t): t is string => typeof t === 'string').map(t => t.slice(0, 60)).slice(0, 10)
      : [];
    let leadId: string;
    if (route.leadId && (route.action === 'update-lead' || route.action === 'reopen-lead')) {
      const existing = leadDocs.find(d => d.id === route.leadId)!;
      leadId = existing.id;
      await existing.ref.update({
        ...(route.action === 'reopen-lead' ? { ...reopenLeadPatch(existing.data() as any, now.toDate()), reopenedAt: now } : {}),
        serviceInquiryId,
        ...(existing.data().customerId ? {} : { customerId }),
        notes: [existing.data().notes || '', `— Pyetësor i ri nga portali (${new Date().toISOString().slice(0, 10)})`, notes]
          .filter(Boolean).join('\n').slice(0, 8000),
        updatedAt: now,
      });
    } else {
      const created = await db.collection('leads').add({
        name: String(inq.contactName || customer.name || callerEmail).slice(0, 200),
        email: normContactEmail(customer.email),
        ...(inq.phoneNumber || customer.phone ? { phoneNumber: String(inq.phoneNumber || customer.phone).slice(0, 40) } : {}),
        ...(inq.businessName || customer.company ? { company: String(inq.businessName || customer.company).slice(0, 200) } : {}),
        ...(inq.jobTitle ? { jobTitle: String(inq.jobTitle).slice(0, 120) } : {}),
        ...(inq.website ? { website: String(inq.website).slice(0, 300) } : {}),
        status: 'New',
        source: 'Service Questionnaire',
        estimatedValue: value,
        tags: tagList,
        notes,
        serviceInquiryId,
        customerId,
        ...tenant,
        createdAt: now,
        updatedAt: now,
        createdByUserId: decoded.uid,
      });
      leadId = created.id;
    }
    if (!customer.leadId) await customerSnap.ref.update({ leadId, updatedAt: now }).catch(() => {});
    await inqRef.update({ leadId, updatedAt: now });
    return res.status(200).json({ leadId, dealId: null, route: route.reason });
  }

  // ── Portal signup: pair the customer with the lead for the same person ─────
  const route = resolveContactRoute({ leads: leadRouteFacts(leadDocs), customer: customerFacts, intent: 'register' });
  if (route.action === 'customer-touch') {
    // Already a client: their open leads close now; nothing new is created.
    const closed = await closeLeadsForClient(db, route.closeLeadIds, customerId);
    if (route.leadId && !customer.leadId) await crossLinkLeadCustomer(db, route.leadId, customerId);
    return res.status(200).json({ linked: !!route.leadId, created: false, closed, leadId: route.leadId });
  }

  // Already paired — nothing to do (and never overwrite a deliberate pairing).
  if (customer.leadId) return res.status(200).json({ linked: false, reason: 'already-linked' });

  if (route.leadId) {
    const existing = leadDocs.find(d => d.id === route.leadId)!;
    if (route.action === 'reopen-lead') {
      await existing.ref.update({ ...reopenLeadPatch(existing.data() as any, now.toDate()), reopenedAt: now, updatedAt: now }).catch(() => {});
    }
    await crossLinkLeadCustomer(db, existing.id, customerId);
    // crossLinkLeadCustomer only fills empty links; make sure the customer side
    // reflects this pairing even if the doc was written a moment ago.
    await customerSnap.ref.update({ leadId: existing.id, updatedAt: now }).catch(() => {});
    return res.status(200).json({ linked: true, created: false, leadId: existing.id });
  }

  // No lead for this person yet (a portal prospect) — create one so the signup
  // lands in the pipeline, already linked in both directions.
  const created = await db.collection('leads').add({
    name: customer.name || callerEmail,
    email: normContactEmail(customer.email),
    ...(customer.phone ? { phoneNumber: customer.phone } : {}),
    ...(customer.company ? { company: customer.company } : {}),
    status: 'New',
    source: 'Portal - Regjistrim',
    customerId,
    ...tenant,
    createdAt: now,
    updatedAt: now,
    createdByUserId: decoded.uid,
  });
  await customerSnap.ref.update({ leadId: created.id, updatedAt: now }).catch(() => {});

  return res.status(200).json({ linked: true, created: true, leadId: created.id });
}
