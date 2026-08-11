import type { VercelRequest, VercelResponse } from '@vercel/node';
import { adminDb, Timestamp } from './_firebaseAdmin.js';
import { FieldValue } from 'firebase-admin/firestore';
import { normContactEmail, findLeadForContact, findCustomerForContact, crossLinkLeadCustomer } from './_contactIdentity.js';
import { notifyUser } from './_push.js';

/**
 * Combined landing-page API (public, no auth).
 *
 * GET  /api/landing?category=SEO  → published services
 * POST /api/landing               → lead capture (inquiry → lead → task → notifications)
 */

// ── Rate limiting (POST only) ────────────────────────────────────────
const ipLimitMap = new Map<string, { count: number; resetAt: number }>();
const MAX_PER_HOUR = 5;

function checkIpRateLimit(ip: string): boolean {
  const now = Date.now();
  for (const [key, val] of ipLimitMap) {
    if (now > val.resetAt) ipLimitMap.delete(key);
  }
  const entry = ipLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    ipLimitMap.set(ip, { count: 1, resetAt: now + 3_600_000 });
    return true;
  }
  if (entry.count >= MAX_PER_HOUR) return false;
  entry.count++;
  return true;
}

function sanitize(val: unknown, maxLen = 500): string {
  if (typeof val !== 'string') return '';
  return val.trim().slice(0, maxLen);
}

/**
 * Resolve the tenant that owns landing-page submissions.
 *
 * `businessId` is THE isolation key: `leads`, `serviceInquiries` and `tasks` are
 * in `businessIsolatedAlways` (useFirestore.ts), so every client query forces
 * `where('businessId','==',active)`. A document written without it EXISTS in
 * Firestore but is invisible in the CRM — the submission is silently lost.
 *
 * Prefer the explicitly configured tenant (DEFAULT_TEAM_ID); otherwise fall back
 * to the first team. `businessId` is always read from the team document, never
 * guessed, because a team can never exist outside a business.
 */
async function resolveLandingTenant(): Promise<{ teamId: string | null; businessId: string | null }> {
  const envTeamId = (process.env.DEFAULT_TEAM_ID || process.env.VITE_DEFAULT_TEAM_ID || '').trim() || null;
  const envBusinessId = (process.env.DEFAULT_BUSINESS_ID || process.env.VITE_DEFAULT_BUSINESS_ID || '').trim() || null;

  let teamId: string | null = envTeamId;
  let businessId: string | null = null;

  try {
    if (teamId) {
      const teamDoc = await adminDb.collection('teams').doc(teamId).get();
      if (teamDoc.exists) businessId = (teamDoc.data()?.businessId as string) || null;
      else teamId = null; // configured team is gone — fall through to the first team
    }
    if (!teamId) {
      const teamsSnap = await adminDb.collection('teams').limit(1).get();
      if (!teamsSnap.empty) {
        teamId = teamsSnap.docs[0].id;
        businessId = (teamsSnap.docs[0].data()?.businessId as string) || null;
      }
    }
  } catch (err) {
    console.error('[landing] tenant resolution failed', err);
  }

  const resolved = businessId || envBusinessId;
  if (!resolved) {
    console.error('[landing] no businessId resolved — the lead will not appear in the CRM. Set DEFAULT_TEAM_ID or stamp businessId on teams/{id}.');
  }
  return { teamId, businessId: resolved };
}

/**
 * GET /api/landing?geo=1 → { country: 'IT' }
 *
 * The landing pages auto-pick their language. Browser language and time zone are
 * the fast signals, but neither follows the actual connection: a visitor on a VPN
 * (or an Albanian phone used in Milan) keeps reporting the old locale. Only the
 * request IP knows where the visitor really is, and Vercel already resolves it
 * into `x-vercel-ip-country` at the edge — no third-party geo service, no IP is
 * ever stored, and nothing here touches Firestore.
 */
function handleGeo(req: VercelRequest, res: VercelResponse) {
  const raw = req.headers['x-vercel-ip-country'];
  const country = (Array.isArray(raw) ? raw[0] : raw || '').toUpperCase().slice(0, 2);
  // Per-visitor answer — never let a CDN hand one visitor's country to another.
  res.setHeader('Cache-Control', 'no-store, private');
  return res.status(200).json({ country: /^[A-Z]{2}$/.test(country) ? country : null });
}

// ── Handler ──────────────────────────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method === 'GET' && req.query.geo !== undefined) return handleGeo(req, res);
    if (req.method === 'GET') return await handleGetServices(req, res);
    if (req.method === 'POST') return await handlePostInquiry(req, res);
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err: any) {
    console.error('landing top-level error:', err);
    return res.status(500).json({ error: 'Internal server error', detail: err?.message });
  }
}

// ── GET: public services ─────────────────────────────────────────────
async function handleGetServices(_req: VercelRequest, res: VercelResponse) {
  const category = (_req.query.category as string) || 'SEO';

  try {
    // Admin SDK bypasses the rules, so an unscoped read here would publish EVERY
    // tenant's service catalogue on a public endpoint. Scope it to the landing
    // tenant; if that tenant has no stamped services yet (legacy docs), fall back
    // to the unscoped read so live landing pages keep working.
    const { businessId } = await resolveLandingTenant();
    const base = adminDb.collection('services').where('category', '==', category);
    let snap = await (businessId ? base.where('businessId', '==', businessId) : base).get();
    if (businessId && snap.empty) {
      console.warn('[landing] no services stamped with businessId — falling back to unscoped read');
      snap = await base.get();
    }

    const services = snap.docs.map(doc => {
      const d = doc.data();
      return {
        id: doc.id,
        title: d.title || d.name || '',
        description: d.description || '',
        price: d.price ?? 0,
        currency: d.currency || 'ALL',
        category: d.category || '',
      };
    }).sort((a, b) => a.price - b.price);

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');
    return res.status(200).json({ services });
  } catch (err: any) {
    console.error('landing GET error:', err);
    return res.status(500).json({ error: 'Failed to fetch services' });
  }
}

// ── POST: lead capture ───────────────────────────────────────────────
async function handlePostInquiry(req: VercelRequest, res: VercelResponse) {
  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || 'unknown';
  if (!checkIpRateLimit(ip)) {
    return res.status(429).json({ error: 'Keni arritur limitin e kërkesave. Provoni përsëri pas pak.' });
  }

  const { name, email, phone, website, message, packageId, packageName, source, category, company, estimatedValue } = req.body || {};

  const sName = sanitize(name, 100);
  // Lowercased at the door: dedup queries are exact-match, so a "Alba@x.al"
  // submission must not slip past an existing "alba@x.al" lead/customer.
  const sEmail = normContactEmail(sanitize(email, 200));
  if (!sName || !sEmail) {
    return res.status(400).json({ error: 'Emri dhe email janë të detyrueshëm.' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sEmail)) {
    return res.status(400).json({ error: 'Email i pavlefshëm.' });
  }

  const sPhone = sanitize(phone, 30);
  const sWebsite = sanitize(website, 300);
  const sMessage = sanitize(message, 2000);
  const sPackageId = sanitize(packageId, 100);
  const sPackageName = sanitize(packageName, 100);
  const sCompany = sanitize(company, 120);
  // Client-provided estimated value (e.g. selected package price). Clamp to a sane range.
  const sEstimatedValue = Number(estimatedValue);
  const estimatedValueNum = Number.isFinite(sEstimatedValue) && sEstimatedValue > 0 ? Math.min(sEstimatedValue, 1_000_000) : 0;
  const sSource = sanitize(source, 100) || 'SEO Landing Page';
  const sCategory = sanitize(category, 100) || 'SEO';

  try {
    const { teamId, businessId } = await resolveLandingTenant();
    // Stamped on every document below — without it the record is invisible in the CRM.
    const tenantStamp = {
      ...(businessId ? { businessId } : {}),
      ...(teamId ? { teamId } : {}),
    };

    const now = Timestamp.now();

    // 1. ServiceInquiry
    const inquiryData: Record<string, any> = {
      businessName: '',
      contactName: sName,
      email: sEmail,
      phoneNumber: sPhone,
      website: sWebsite,
      industry: '',
      servicesInterestedIn: [sCategory],
      mainGoal: `${sCategory} - Kërkim nga landing page`,
      projectNeedDescription: sMessage || `Kërkim nga faqja ${sSource}${sPackageName ? ` — Paketa: ${sPackageName}` : ''}`,
      currentMainChallenge: '',
      budgetRange: '',
      timeline: '',
      decisionMaker: 'Po',
      hasExistingMaterials: 'Jo',
      seo_hasWebsite: sWebsite ? 'Po' : 'Jo',
      seo_targetMarket: 'Shqipëri',
      status: 'New',
      isDraft: false,
      source: sSource,
      ...tenantStamp,
      createdAt: now,
      updatedAt: now,
      createdByUserId: null,
    };

    const inquiryRef = await adminDb.collection('serviceInquiries').add(inquiryData);

    // 2. Lead linked to the inquiry
    const tags = [`${sCategory} Lead`, 'Landing Page'];
    if (sPackageName) tags.push(sPackageName);

    const leadData: Record<string, any> = {
      name: sName,
      email: sEmail,
      phoneNumber: sPhone,
      website: sWebsite,
      ...(sCompany ? { company: sCompany } : {}),
      status: 'New',
      source: sSource,
      estimatedValue: estimatedValueNum,
      tags,
      notes: [
        `Paketa: ${sPackageName || 'Pa zgjedhur'}`,
        sCompany ? `Biznesi: ${sCompany}` : '',
        sMessage ? `Mesazh: ${sMessage}` : '',
        sWebsite ? `Website: ${sWebsite}` : '',
      ].filter(Boolean).join('\n'),
      serviceInquiryId: inquiryRef.id,
      ...tenantStamp,
      createdAt: now,
      updatedAt: now,
      createdByUserId: null,
    };

    // If a service id was provided and no explicit value came through, use the service price.
    if (sPackageId && !estimatedValueNum) {
      try {
        const svcDoc = await adminDb.collection('services').doc(sPackageId).get();
        if (svcDoc.exists) {
          leadData.estimatedValue = svcDoc.data()?.price || 0;
        }
      } catch { /* non-blocking */ }
    }

    // Identity resolution: reuse an existing lead for this person instead of
    // creating a duplicate on repeat submissions, AND link to their customer
    // record when they're already a client — an existing client asking for a
    // new service is a real lead, but it must never become an orphan record
    // sitting next to their client profile.
    let leadRef: FirebaseFirestore.DocumentReference | null = null;
    let existingCustomerId: string | null = null;
    try {
      const lookup = { email: sEmail, phone: sPhone, teamId, businessId };
      const [existingLead, existingCustomer] = await Promise.all([
        findLeadForContact(adminDb, lookup),
        findCustomerForContact(adminDb, lookup),
      ]);
      existingCustomerId = existingCustomer?.id ?? null;
      if (existingLead) {
        leadRef = existingLead.ref;
        await existingLead.ref.update({
          serviceInquiryId: inquiryRef.id,
          updatedAt: now,
          ...(existingCustomerId && !existingLead.data()?.customerId ? { customerId: existingCustomerId } : {}),
          notes: [existingLead.data()?.notes || '', `— Kërkesë e re nga ${sSource} (${new Date().toISOString().slice(0, 10)})`].filter(Boolean).join('\n'),
        });
      }
    } catch (err) {
      // Non-blocking — fall through to create a new lead rather than lose the submission.
      console.error('[landing] contact identity lookup failed', err);
    }
    if (!leadRef) {
      leadRef = await adminDb.collection('leads').add({
        ...leadData,
        ...(existingCustomerId ? { customerId: existingCustomerId } : {}),
      });
    }
    // Reverse link (customer → lead) so the client profile shows this inquiry.
    if (existingCustomerId) {
      await crossLinkLeadCustomer(adminDb, leadRef.id, existingCustomerId);
    }

    // 3. Link inquiry → lead
    await inquiryRef.update({ leadId: leadRef.id });

    // 4. Follow-up task
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    let assigneeId = '';
    let teamMembersSnap: any = null;
    if (teamId) {
      teamMembersSnap = await adminDb
        .collection('teamMembers')
        .where('teamId', '==', teamId)
        .get();
      // Round-robin among eligible sales reps (CRM-capable roles), fallback to Admin/Owner.
      const eligible = teamMembersSnap.docs.filter((d: any) => {
        const m = d.data();
        if (m.status && m.status !== 'Active') return false;
        return ['Sales', 'SalesAgent', 'Manager', 'Admin', 'Owner'].includes(m.role) || m.canAccessCRM === true;
      });
      if (eligible.length > 0) {
        let cursor = 1;
        try {
          const tsRef = adminDb.collection('teamSettings').doc(teamId);
          await tsRef.set({ leadAssignCursor: FieldValue.increment(1) }, { merge: true });
          const tsSnap = await tsRef.get();
          cursor = (tsSnap.data()?.leadAssignCursor as number) || 1;
        } catch { /* keep cursor=1 */ }
        assigneeId = eligible[(cursor - 1) % eligible.length].data().userId || '';
      }
      // Assign the lead to the chosen rep if it has no owner yet (dedup-reused
      // leads keep their existing owner, and the task follows that owner).
      if (assigneeId) {
        try {
          const leadSnap = await leadRef.get();
          const existingOwner = leadSnap.data()?.assignedToUserId;
          if (existingOwner) assigneeId = existingOwner;
          else await leadRef.update({ assignedToUserId: assigneeId, updatedAt: now });
        } catch { /* non-blocking */ }
      }
    }

    await adminDb.collection('tasks').add({
      title: `Kontakto lead ${sCategory}: ${sName}`,
      description: [
        `Lead i ri nga faqja ${sSource}.`,
        `Email: ${sEmail}`,
        sPhone ? `Telefon: ${sPhone}` : '',
        sWebsite ? `Website: ${sWebsite}` : '',
        sPackageName ? `Paketa e interesuar: ${sPackageName}` : '',
        sMessage ? `\nMesazhi: ${sMessage}` : '',
      ].filter(Boolean).join('\n'),
      status: 'Todo',
      priority: 'high',
      startDate: new Date(),
      endDate: tomorrow,
      dueDate: tomorrow,
      assignedToUserId: assigneeId,
      ...tenantStamp,
      createdAt: now,
      updatedAt: now,
      createdByUserId: null,
    });

    // 5. Notifications to admin/sales
    if (teamId && teamMembersSnap) {
      const adminDocs = teamMembersSnap.docs.filter((d: any) => ['Admin', 'Owner'].includes(d.data().role));

      // A fresh inbound lead is time-critical, so it goes out over push + email
      // too. It used to be a batched document write only: the sales team saw a red
      // dot the next time somebody opened the CRM, and nothing before that.
      await Promise.allSettled(adminDocs.map((m: any) => notifyUser({
        userId: m.data().userId,
        type: 'lead_created',
        title: `Lead i Ri ${sCategory} — Landing Page`,
        message: `${sName} dorëzoi kërkesë nga faqja ${sSource}${sPackageName ? ` (${sPackageName})` : ''}`,
        actionUrl: '/app/crm',
        actionLabel: 'Shiko CRM',
        businessId: (tenantStamp as any).businessId ?? null,
        teamId: (tenantStamp as any).teamId ?? null,
      })));
    }

    return res.status(200).json({
      success: true,
      leadId: leadRef.id,
      inquiryId: inquiryRef.id,
    });
  } catch (err: any) {
    console.error('landing POST error:', err);
    return res.status(500).json({ error: 'Diçka shkoi keq. Ju lutem provoni përsëri.' });
  }
}
