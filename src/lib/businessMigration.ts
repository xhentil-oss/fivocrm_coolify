import { collection, getDocs, query, where, doc, setDoc, writeBatch, Timestamp } from 'firebase/firestore';
import { db } from './firebase';

/**
 * Phase 1 of the two-level tenancy migration (Business > Team).
 *
 * Additive and behavior-preserving: creates a single "business" (tenant) for the
 * current owner and stamps `businessId` on every team they own (the agency's teams
 * become departments of one business). Nothing reads `businessId` yet, so this
 * changes no behavior and is reversible. Idempotent — re-running only links teams
 * that aren't linked yet.
 *
 * Writable under current rules: a user may update only teams where
 * createdByUserId == their uid, which is exactly the set we touch here.
 */
export interface BusinessSetupResult {
  businessId: string;
  businessCreated: boolean;
  teamsLinked: number;
  teamsTotal: number;
}

export async function setupBusinessLayer(uid: string, email: string, businessName = 'Agjencia'): Promise<BusinessSetupResult> {
  const now = Timestamp.now();

  // Find (or create) the owner's business — keyed by ownerId so it's idempotent.
  const bizSnap = await getDocs(query(collection(db, 'businesses'), where('ownerId', '==', uid)));
  let businessId: string;
  let businessCreated = false;
  if (!bizSnap.empty) {
    businessId = bizSnap.docs[0].id;
  } else {
    const ref = doc(collection(db, 'businesses'));
    await setDoc(ref, {
      name: businessName,
      ownerId: uid,
      ownerEmail: email.toLowerCase(),
      plan: 'business',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    });
    businessId = ref.id;
    businessCreated = true;
  }

  // Stamp businessId on every team this user owns that isn't linked yet.
  const teamsSnap = await getDocs(query(collection(db, 'teams'), where('createdByUserId', '==', uid)));
  const toLink = teamsSnap.docs.filter(d => d.data().businessId !== businessId);
  let teamsLinked = 0;
  for (let i = 0; i < toLink.length; i += 400) {
    const batch = writeBatch(db);
    toLink.slice(i, i + 400).forEach(d => batch.update(d.ref, { businessId, updatedAt: now }));
    await batch.commit();
    teamsLinked += Math.min(400, toLink.length - i);
  }

  return { businessId, businessCreated, teamsLinked, teamsTotal: teamsSnap.size };
}
