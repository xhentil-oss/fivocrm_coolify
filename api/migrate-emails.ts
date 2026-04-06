import type { VercelRequest, VercelResponse } from '@vercel/node';
import { adminAuth, adminDb } from './_firebaseAdmin.js';

/**
 * One-time migration: normalize email fields to lowercase in
 * clientPortalAccess and customers collections.
 * 
 * Call once: POST /api/migrate-emails  (with valid Admin Firebase Bearer token)
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Require valid Firebase token
  const token = req.headers.authorization?.replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  let uid: string;
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    uid = decoded.uid;
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }

  const results = { clientPortalAccess: 0, customers: 0, leads: 0, errors: 0 };

  const normalize = async (collectionName: string, field: string) => {
    const snap = await adminDb.collection(collectionName).get();
    const batch = adminDb.batch();
    let count = 0;
    for (const doc of snap.docs) {
      const val: string = doc.data()[field];
      if (typeof val === 'string' && val !== val.toLowerCase().trim()) {
        batch.update(doc.ref, { [field]: val.toLowerCase().trim() });
        count++;
        // Firestore batch limit is 500
        if (count % 490 === 0) {
          await batch.commit();
        }
      }
    }
    if (count % 490 !== 0) await batch.commit();
    return count;
  };

  try {
    results.clientPortalAccess = await normalize('clientPortalAccess', 'email');
    results.customers = await normalize('customers', 'email');
    results.leads = await normalize('leads', 'email');
  } catch (e) {
    results.errors++;
    console.error('[migrate-emails] error:', e);
  }

  console.log(`[migrate-emails] uid=${uid} results=`, results);
  return res.status(200).json({ success: true, updated: results });
}
