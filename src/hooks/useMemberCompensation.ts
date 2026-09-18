/**
 * Load a tenant's compensation documents and hand back the staff list with pay
 * merged in — the ONE place the browser resolves `teamMemberComp` against the
 * legacy `teamMembers` fields.
 *
 * WHY A SEPARATE HOOK, AND WHY NOT EVERYWHERE
 * -------------------------------------------
 * Salary is the most sensitive field in the product. A screen that only needs
 * names and roles (chat, mentions, assignee pickers, the command palette) must
 * NOT call this — loading pay it never displays is exactly the mistake that put
 * every colleague's salary in every employee's browser in the first place.
 * Call it only where a salary figure is actually computed or shown:
 * FinancesView, BonusView, TeamsView, ProjectDetailView's labour cost and the
 * expense form's salary hint.
 *
 * TWO QUERY SHAPES, ON PURPOSE
 * ----------------------------
 * Firestore rules are not filters: an unscoped — or unprovable — list over a
 * scoped collection is DENIED, not filtered (see "Firestore list = query shape"
 * in CLAUDE.md). The read rule grants the collection to an admin/manager of the
 * business and, row by row, to the member themselves, so:
 *
 *   • admin / owner / manager / super-admin → a LIST scoped by businessId
 *     (`useCollection` applies the tenant predicate automatically, which is what
 *     makes the rule's `isBusinessAdmin(resource.data.businessId)` clause
 *     provable from the query shape);
 *   • everyone else → a single-document read of their OWN
 *     `teamMemberComp/{teamId}_{uid}`. A list would be denied outright, and
 *     nobody else's pay is theirs to see.
 *
 * DUAL READ: until `backfill-member-compensation` has run, there are no comp
 * documents at all and this hook returns the member list untouched — the
 * legacy fields keep answering. That is deliberate: see
 * `src/lib/finance/compensation.ts`.
 */
import { useMemo } from 'react';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
// The CONTEXT, not the raw hook: it is what the rest of the app reads, and it
// is the copy that honours an admin's "Shiko si punonjës" role preview. Reading
// the raw hook here would have let a previewing admin still pull the whole
// tenant's pay while the screen around them claimed to be an employee's.
import { usePermissions } from '../contexts/PermissionsContext';
import { useCollection, useDocument } from './useFirestore';
import type { MemberCompensation, TeamMember } from '../types';
import {
  memberCompId,
  mergeMembersWithCompensation,
} from '../lib/finance/compensation';

export interface UseMemberCompensationResult<T extends TeamMember> {
  /** The members passed in, with their compensation merged over the legacy fields. */
  members: T[];
  /** The raw comp documents this user was allowed to read (may be empty). */
  compensation: (MemberCompensation & { id: string })[];
  /** True while the comp read is still in flight (the merge is not final yet). */
  loading: boolean;
  /** Whether this user may read the WHOLE tenant's pay, or only their own row. */
  canReadAll: boolean;
}

export function useMemberCompensation<T extends TeamMember>(
  members: T[] | null | undefined,
  options?: { skip?: boolean },
): UseMemberCompensationResult<T> {
  const { user } = useAuth();
  const permissions = usePermissions();
  const canReadAll = !!(permissions.isAdmin || permissions.isOwner || permissions.isManager || permissions.isSuperAdmin);
  const skip = !!options?.skip || !user;

  // Privileged: the tenant's whole compensation set (businessId predicate added
  // by useCollection, because teamMemberComp is in businessIsolatedAlways).
  const { data: allComp, loading: loadingAll } = useCollection<MemberCompensation>('teamMemberComp', {
    skip: skip || !canReadAll,
  });

  // Unprivileged: only their own row, by document id. `teamId` comes from their
  // own membership in the list they already hold; without it there is nothing to
  // read (and nothing they are allowed to read either).
  const ownTeamId = useMemo(
    () => (members || []).find(m => m.userId === user?.uid)?.teamId || permissions.teamId || '',
    [members, user?.uid, permissions.teamId],
  );
  const ownDocId = !skip && !canReadAll && ownTeamId && user?.uid
    ? memberCompId(ownTeamId, user.uid)
    : undefined;
  const { data: ownComp, loading: loadingOwn } = useDocument<MemberCompensation>('teamMemberComp', ownDocId);

  const compensation = useMemo(() => {
    if (canReadAll) return (allComp || []) as (MemberCompensation & { id: string })[];
    return ownComp ? [ownComp as MemberCompensation & { id: string }] : [];
  }, [canReadAll, allComp, ownComp]);

  const merged = useMemo(
    () => mergeMembersWithCompensation(members, compensation),
    [members, compensation],
  );

  return {
    members: merged,
    compensation,
    loading: skip ? false : (canReadAll ? loadingAll : (!!ownDocId && loadingOwn)),
    canReadAll,
  };
}

/**
 * Write a member's pay to `teamMemberComp/{teamId}_{userId}`.
 *
 * DUAL WRITE: TeamsView writes BOTH here and to the legacy `teamMembers`
 * fields. That is what makes this pass reversible and keeps the server-side
 * cron (and any reader that has not been migrated) correct until the legacy
 * fields are cleared — which is a separate step, after the backfill has run and
 * been verified. Do not drop one half without doing the other.
 *
 * `merge: true` because the document may not exist yet and because
 * `deleteField()` sentinels (an emptied salary box) are only legal on a merge
 * or an update — a plain `setDoc` would reject them.
 *
 * A failure here must never be swallowed: the caller reports it, because a
 * legacy-only write is a row the new collection does not know about.
 */
export async function saveMemberCompensation(params: {
  teamId: string;
  userId: string;
  businessId?: string;
  actorUserId?: string | null;
  /** monthlySalary / salaryHistory / hourlyCostRate — may carry deleteField(). */
  fields: Record<string, unknown>;
}): Promise<void> {
  const { teamId, userId, businessId, actorUserId, fields } = params;
  if (!teamId || !userId) throw new Error('teamMemberComp kërkon teamId dhe userId');
  await setDoc(
    doc(db, 'teamMemberComp', memberCompId(teamId, userId)),
    {
      teamId,
      userId,
      ...(businessId ? { businessId } : {}),
      ...fields,
      updatedAt: serverTimestamp(),
      updatedByUserId: actorUserId || null,
    },
    { merge: true },
  );
}
