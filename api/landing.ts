import type { VercelRequest, VercelResponse } from '@vercel/node';
import { adminDb, Timestamp } from './_firebaseAdmin.js';
import { FieldValue } from 'firebase-admin/firestore';

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

// ── Handler ──────────────────────────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
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
    const snap = await adminDb
      .collection('services')
      .where('category', '==', category)
      .get();

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
  const sEmail = sanitize(email, 200);
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
    let teamId: string | null = null;
    const teamsSnap = await adminDb.collection('teams').limit(1).get();
    if (!teamsSnap.empty) {
      teamId = teamsSnap.docs[0].id;
    }

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
      ...(teamId ? { teamId } : {}),
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
      ...(teamId ? { teamId } : {}),
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

    // Dedup: reuse an existing lead with the same email (or phone) in this team
    // instead of creating a duplicate on repeat landing-page submissions.
    let leadRef: FirebaseFirestore.DocumentReference | null = null;
    try {
      const normPhone = (sPhone || '').replace(/\D/g, '');
      let existing: FirebaseFirestore.QueryDocumentSnapshot | undefined;
      if (sEmail) {
        const q = await adminDb.collection('leads').where('email', '==', sEmail).get();
        existing = q.docs.find(d => !teamId || d.data().teamId === teamId);
      }
      if (!existing && normPhone.length >= 7) {
        const q = await adminDb.collection('leads').where('phoneNumber', '==', sPhone).get();
        existing = q.docs.find(d => !teamId || d.data().teamId === teamId);
      }
      if (existing) {
        leadRef = existing.ref;
        await existing.ref.update({
          serviceInquiryId: inquiryRef.id,
          updatedAt: now,
          notes: [existing.data()?.notes || '', `— Kërkesë e re nga ${sSource} (${new Date().toISOString().slice(0, 10)})`].filter(Boolean).join('\n'),
        });
      }
    } catch { /* non-blocking — fall through to create a new lead */ }
    if (!leadRef) {
      leadRef = await adminDb.collection('leads').add(leadData);
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
      ...(teamId ? { teamId } : {}),
      createdAt: now,
      updatedAt: now,
      createdByUserId: null,
    });

    // 5. Notifications to admin/sales
    if (teamId && teamMembersSnap) {
      const adminDocs = teamMembersSnap.docs.filter(d => ['Admin', 'Owner'].includes(d.data().role));

      const batch = adminDb.batch();
      adminDocs.forEach(m => {
        const nRef = adminDb.collection('notifications').doc();
        batch.set(nRef, {
          userId: m.data().userId,
          type: 'lead_created',
          title: `Lead i Ri ${sCategory} — Landing Page`,
          message: `${sName} dorëzoi kërkesë nga faqja ${sSource}${sPackageName ? ` (${sPackageName})` : ''}`,
          isRead: false,
          ...(teamId ? { teamId } : {}),
          createdAt: now,
          updatedAt: now,
        });
      });
      await batch.commit();
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
