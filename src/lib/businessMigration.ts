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

// ── Phase 2: backfill businessId onto every data document ────────────────────
// Maps each doc's teamId → the businessId set on its team (Phase 1), then stamps
// businessId. The agency's teams all map to the one agency business, so their data
// consolidates while teamId is preserved as the department. Idempotent & batched.
//
// Only collections that allow read+update for isAuth() are included. whatsapp* are
// excluded (their rules require isTeamMember, so a cross-team client read/write
// would be denied) — they can be migrated per-team later if needed.
const PHASE2_COLLECTIONS = [
  'tasks', 'invoices', 'invoiceItems', 'customers', 'leads', 'deals', 'leadActivities',
  'services', 'expenses', 'goals', 'timeEntries', 'channels', 'messages', 'clientRequests',
  'taskComments', 'taskCollaborators', 'milestones', 'serviceInquiries', 'projectComments',
  'workspaceFolders', 'workspaceDriveFiles', 'projects', 'roleTemplates', 'dailyReports',
  'standups', 'quotes', 'contracts', 'customIndustries',
];

export interface BackfillResult {
  collection: string;
  scanned: number;
  updated: number;
  failed: boolean;
}

export async function backfillBusinessId(
  onProgress?: (col: string, i: number, total: number) => void
): Promise<BackfillResult[]> {
  // teamId → businessId from the teams linked in Phase 1.
  const teamsSnap = await getDocs(collection(db, 'teams'));
  const teamToBusiness = new Map<string, string>();
  teamsSnap.docs.forEach(d => {
    const b = (d.data() as any).businessId;
    if (b) teamToBusiness.set(d.id, b);
  });

  const results: BackfillResult[] = [];
  for (let c = 0; c < PHASE2_COLLECTIONS.length; c++) {
    const col = PHASE2_COLLECTIONS[c];
    onProgress?.(col, c, PHASE2_COLLECTIONS.length);
    try {
      const snap = await getDocs(collection(db, col));
      const toUpdate = snap.docs.filter(d => {
        const data = d.data() as any;
        const bid = data.teamId ? teamToBusiness.get(data.teamId) : undefined;
        return !!bid && data.businessId !== bid;
      });
      let updated = 0;
      for (let i = 0; i < toUpdate.length; i += 400) {
        const batch = writeBatch(db);
        toUpdate.slice(i, i + 400).forEach(d => {
          const bid = teamToBusiness.get((d.data() as any).teamId)!;
          batch.update(d.ref, { businessId: bid });
        });
        await batch.commit();
        updated += Math.min(400, toUpdate.length - i);
      }
      results.push({ collection: col, scanned: snap.size, updated, failed: false });
    } catch {
      results.push({ collection: col, scanned: 0, updated: 0, failed: true });
    }
  }
  return results;
}
