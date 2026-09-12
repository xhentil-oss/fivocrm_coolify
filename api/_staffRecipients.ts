import { adminDb } from './_firebaseAdmin.js';

/**
 * Who gets told when nobody owns something — THE resolver for "the managers of
 * this tenant" on the server.
 *
 * Extracted from `_gmb.ts` (businessManagerIds) and `cron/run.ts`
 * (getTeamAdmins), which had drifted: one filtered Inactive members and capped
 * at 5, the other read by teamId with no status filter and no cap. Every
 * server-side "notify the managers" now goes through this one function, so an
 * escalation reaches the same people whether it came from a review, a lead SLA
 * or an unanswered WhatsApp thread.
 *
 * Preference order: Admin/Manager/Owner of the SAME team first (a department's
 * own manager should see its threads before the company owner does), then the
 * rest of the business. Capped so a large tenant cannot fan out to 100 phones.
 */

const MANAGER_ROLES = new Set(['Admin', 'Manager', 'Owner', 'SuperAdmin']);
const DEFAULT_CAP = 20;
const READ_LIMIT = 200;

export interface ManagerIdsOptions {
  /** Maximum recipients (default 20). */
  cap?: number;
}

export async function managerIdsForBusiness(
  businessId?: string | null,
  teamId?: string | null,
  opts: ManagerIdsOptions = {},
): Promise<string[]> {
  const cap = Math.max(1, opts.cap ?? DEFAULT_CAP);
  if (!businessId && !teamId) return [];

  let docs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  try {
    if (businessId) {
      const snap = await adminDb.collection('teamMembers')
        .where('businessId', '==', businessId)
        .limit(READ_LIMIT)
        .get();
      docs = snap.docs;
    }
    // Legacy memberships without a businessId stamp (or a caller that only knows
    // the team): fall back to the team-scoped read.
    if (docs.length === 0 && teamId) {
      const snap = await adminDb.collection('teamMembers')
        .where('teamId', '==', teamId)
        .limit(READ_LIMIT)
        .get();
      docs = snap.docs;
    }
  } catch (err) {
    console.error('[staffRecipients] teamMembers read failed', { businessId, teamId, err });
    return [];
  }

  const sameTeam: string[] = [];
  const others: string[] = [];
  const seen = new Set<string>();
  for (const d of docs) {
    const m = d.data();
    const uid = typeof m.userId === 'string' ? m.userId.trim() : '';
    if (!uid || seen.has(uid)) continue;
    if ((m.status ?? 'Active') !== 'Active') continue;
    if (!MANAGER_ROLES.has(String(m.role || ''))) continue;
    seen.add(uid);
    if (teamId && m.teamId === teamId) sameTeam.push(uid);
    else others.push(uid);
  }
  return [...sameTeam, ...others].slice(0, cap);
}
