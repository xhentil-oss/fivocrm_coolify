import type { VercelRequest, VercelResponse } from '@vercel/node';
import { adminDb, Timestamp } from './_firebaseAdmin.js';

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

  const { name, email, phone, website, message, packageId, packageName, source, category } = req.body || {};

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
      status: 'New',
      source: sSource,
      estimatedValue: 0,
      tags,
      notes: [
        `Paketa: ${sPackageName || 'Pa zgjedhur'}`,
        sMessage ? `Mesazh: ${sMessage}` : '',
        sWebsite ? `Website: ${sWebsite}` : '',
      ].filter(Boolean).join('\n'),
      serviceInquiryId: inquiryRef.id,
      ...(teamId ? { teamId } : {}),
      createdAt: now,
      updatedAt: now,
      createdByUserId: null,
    };

    if (sPackageId) {
      try {
        const svcDoc = await adminDb.collection('services').doc(sPackageId).get();
        if (svcDoc.exists) {
          leadData.estimatedValue = svcDoc.data()?.price || 0;
        }
      } catch { /* non-blocking */ }
    }

    const leadRef = await adminDb.collection('leads').add(leadData);

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
      const adminDoc = teamMembersSnap.docs.find(d => ['Admin', 'Owner'].includes(d.data().role));
      if (adminDoc) {
        assigneeId = adminDoc.data().userId || '';
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
