import type { VercelRequest, VercelResponse } from '@vercel/node';
import { adminDb as db, adminAuth } from './_firebaseAdmin.js';

// Phase 2 (server-side): backfill businessId onto every team-scoped document using
// the Admin SDK, which BYPASSES Firestore rules. Needed because some collections
// (activities = update:false, messages/comments = owner-only) reject client writes.
// This is the "privileged admin path" — gated to Admin/Owner via Firebase ID token.

const COLLECTIONS = [
  'tasks', 'invoices', 'invoiceItems', 'customers', 'leads', 'deals', 'leadActivities',
  'services', 'expenses', 'goals', 'timeEntries', 'channels', 'messages', 'activities',
  'clientRequests', 'taskComments', 'taskCollaborators', 'customIndustries', 'directMessages',
  'milestones', 'serviceInquiries', 'projectComments', 'workspaceFolders', 'workspaceDriveFiles',
  'projects', 'roleTemplates', 'dailyReports', 'standups', 'quotes', 'contracts', 'chatSnippets',
  // whatsapp data too, for full consistency (admin bypasses their isTeamMember rules):
  'whatsappAccounts', 'whatsappThreads', 'whatsappMessages', 'waTemplates', 'waBroadcasts',
];

async function authorize(req: VercelRequest): Promise<string | null> {
  const authHeader = req.headers.authorization as string | undefined;
  if (!authHeader?.startsWith('Bearer ')) return 'Missing Authorization header';
  let uid: string;
  try {
    uid = (await adminAuth.verifyIdToken(authHeader.slice(7))).uid;
  } catch (err: any) {
    return `Token invalid: ${err?.message || err}`;
  }
  const snap = await db.collection('teamMembers').where('userId', '==', uid).limit(10).get();
  const roles = snap.docs.map(d => d.data().role as string);
  if (!roles.some(r => r === 'Admin' || r === 'Owner')) {
    return `Role not Admin/Owner (found: ${roles.join(', ') || 'none'})`;
  }
  return null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const authError = await authorize(req);
  if (authError) return res.status(401).json({ error: `Unauthorized: ${authError}` });

  try {
    // teamId → businessId map (from teams linked in Phase 1).
    const teamsSnap = await db.collection('teams').get();
    const teamToBusiness = new Map<string, string>();
    teamsSnap.docs.forEach(d => {
      const b = (d.data() as any).businessId;
      if (b) teamToBusiness.set(d.id, b);
    });
    if (teamToBusiness.size === 0) {
      return res.status(400).json({ error: 'No teams are linked to a business yet — run Phase 1 first.' });
    }

    const results: { collection: string; scanned: number; updated: number }[] = [];
    let totalUpdated = 0;

    for (const col of COLLECTIONS) {
      let scanned = 0;
      let updated = 0;
      try {
        const snap = await db.collection(col).get();
        scanned = snap.size;
        const toUpdate = snap.docs.filter(d => {
          const data = d.data() as any;
          const bid = data.teamId ? teamToBusiness.get(data.teamId) : undefined;
          return !!bid && data.businessId !== bid;
        });
        for (let i = 0; i < toUpdate.length; i += 400) {
          const batch = db.batch();
          toUpdate.slice(i, i + 400).forEach(d => {
            const bid = teamToBusiness.get((d.data() as any).teamId)!;
            batch.update(d.ref, { businessId: bid });
          });
          await batch.commit();
          updated += Math.min(400, toUpdate.length - i);
        }
      } catch (err: any) {
        results.push({ collection: col, scanned, updated: -1 });
        console.error(`[backfill] ${col} failed:`, err?.message || err);
        continue;
      }
      totalUpdated += updated;
      results.push({ collection: col, scanned, updated });
    }

    return res.status(200).json({ success: true, totalUpdated, businesses: teamToBusiness.size, results });
  } catch (err: any) {
    console.error('[admin-backfill-businessid] failed:', err?.message || err);
    return res.status(500).json({ error: err?.message || 'Backfill failed' });
  }
}
