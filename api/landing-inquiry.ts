import type { VercelRequest, VercelResponse } from '@vercel/node';
import { adminDb, Timestamp } from './_firebaseAdmin.js';

/**
 * POST /api/landing-inquiry
 * Public endpoint for landing page lead capture.
 * Creates: ServiceInquiry → Lead → Task → Notifications
 */

// Basic rate limiting per IP (in-memory, cleaned on each check)
const ipLimitMap = new Map<string, { count: number; resetAt: number }>();
const MAX_PER_HOUR = 5;

function checkIpRateLimit(ip: string): boolean {
  const now = Date.now();
  // Purge expired
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Rate limit by IP
  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || 'unknown';
  if (!checkIpRateLimit(ip)) {
    return res.status(429).json({ error: 'Keni arritur limitin e kërkesave. Provoni përsëri pas pak.' });
  }

  const { name, email, phone, website, message, packageId, packageName } = req.body || {};

  // Validate required fields
  const sName = sanitize(name, 100);
  const sEmail = sanitize(email, 200);
  if (!sName || !sEmail) {
    return res.status(400).json({ error: 'Emri dhe email janë të detyrueshëm.' });
  }
  // Basic email format check
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sEmail)) {
    return res.status(400).json({ error: 'Email i pavlefshëm.' });
  }

  const sPhone = sanitize(phone, 30);
  const sWebsite = sanitize(website, 300);
  const sMessage = sanitize(message, 2000);
  const sPackageId = sanitize(packageId, 100);
  const sPackageName = sanitize(packageName, 100);

  try {
    // Resolve teamId: pick the first team that has services
    let teamId: string | null = null;
    const teamsSnap = await adminDb.collection('teams').limit(1).get();
    if (!teamsSnap.empty) {
      teamId = teamsSnap.docs[0].id;
    }

    const now = Timestamp.now();

    // 1. Create ServiceInquiry
    const inquiryData: Record<string, any> = {
      businessName: '',
      contactName: sName,
      email: sEmail,
      phoneNumber: sPhone,
      website: sWebsite,
      industry: '',
      servicesInterestedIn: ['SEO'],
      mainGoal: 'SEO - Rritje e trafikut organik',
      projectNeedDescription: sMessage || `Kërkim nga faqja SEO landing page${sPackageName ? ` — Paketa: ${sPackageName}` : ''}`,
      currentMainChallenge: '',
      budgetRange: '',
      timeline: '',
      decisionMaker: 'Po',
      hasExistingMaterials: 'Jo',
      // SEO-specific
      seo_hasWebsite: sWebsite ? 'Po' : 'Jo',
      seo_targetMarket: 'Shqipëri',
      status: 'New',
      isDraft: false,
      source: 'SEO Landing Page',
      ...(teamId ? { teamId } : {}),
      createdAt: now,
      updatedAt: now,
      createdByUserId: null,
    };

    const inquiryRef = await adminDb.collection('serviceInquiries').add(inquiryData);

    // 2. Create Lead linked to the inquiry
    const tags = ['SEO Lead', 'Landing Page'];
    if (sPackageName) tags.push(sPackageName);

    const leadData: Record<string, any> = {
      name: sName,
      email: sEmail,
      phoneNumber: sPhone,
      website: sWebsite,
      status: 'New',
      source: 'SEO Landing Page',
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

    // Try to estimate value from service price
    if (sPackageId) {
      try {
        const svcDoc = await adminDb.collection('services').doc(sPackageId).get();
        if (svcDoc.exists) {
          leadData.estimatedValue = svcDoc.data()?.price || 0;
        }
      } catch { /* non-blocking */ }
    }

    const leadRef = await adminDb.collection('leads').add(leadData);

    // 3. Link inquiry to lead
    await inquiryRef.update({ leadId: leadRef.id });

    // 4. Create follow-up task
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Find admin/sales team members for assignment
    let assigneeId = '';
    if (teamId) {
      const membersSnap = await adminDb
        .collection('teamMembers')
        .where('teamId', '==', teamId)
        .where('role', 'in', ['Admin', 'Owner'])
        .limit(1)
        .get();
      if (!membersSnap.empty) {
        assigneeId = membersSnap.docs[0].data().userId || '';
      }
    }

    await adminDb.collection('tasks').add({
      title: `Kontakto lead SEO: ${sName}`,
      description: [
        `Lead i ri nga faqja SEO landing page.`,
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

    // 5. Send notification to admin/sales members
    if (teamId) {
      const allAdmins = await adminDb
        .collection('teamMembers')
        .where('teamId', '==', teamId)
        .where('role', 'in', ['Admin', 'Owner'])
        .get();

      const batch = adminDb.batch();
      allAdmins.docs.forEach(m => {
        const nRef = adminDb.collection('notifications').doc();
        batch.set(nRef, {
          userId: m.data().userId,
          type: 'lead_created',
          title: 'Lead i Ri SEO — Landing Page',
          message: `${sName} dorëzoi kërkesë nga faqja SEO${sPackageName ? ` (${sPackageName})` : ''}`,
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
    console.error('landing-inquiry error:', err);
    return res.status(500).json({ error: 'Diçka shkoi keq. Ju lutem provoni përsëri.' });
  }
}
