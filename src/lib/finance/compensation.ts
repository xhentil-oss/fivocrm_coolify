/**
 * Compensation resolution — the ONE place that answers "what does this member
 * cost", while the data lives in two places at once.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `teamMembers` carries `monthlySalary`, `salaryHistory` and `hourlyCostRate`,
 * and the Firestore rule grants a read of that collection to every
 * `isBusinessMember` — so until now every employee could issue one query and
 * read every colleague's salary. Hiding it in React is not access control.
 *
 * The fix moves compensation into its own collection, `teamMemberComp`, keyed
 * with the SAME document id shape as `teamMembers` (`{teamId}_{userId}`) so it
 * is derivable without a lookup, and readable only by the member themselves, an
 * admin/manager of the business, or a super-admin.
 *
 * THE ROLLOUT IS DUAL-READ AND MUST STAY A NO-OP UNTIL THE BACKFILL HAS RUN.
 * Nothing may read the new collection ALONE: a tenant whose compensation has
 * not been copied across yet would silently drop to zero payroll — every P&L,
 * bonus, forecast and project cost with it. So:
 *
 *     the comp document WINS, field by field, where it exists;
 *     the legacy `teamMembers` fields are the fallback.
 *
 * Every payroll engine (`salaryHistory.ts`, `payroll.ts`, `projectPnl.ts`,
 * `departmentPnl.ts`, `laborCost.ts`) keeps taking plain `TeamMember` objects
 * and is deliberately NOT changed — the merge happens where the data is LOADED
 * (`useMemberCompensation` in the browser, `project-spend-rollup` on the
 * server), so there is exactly one merge rule and no engine can forget it.
 *
 * Pure logic only: no Firestore, no React — so it is unit-testable and can be
 * mirrored server-side without dragging the client SDK in.
 */
import type { MemberCompensation, TeamMember } from '../../types';

/** The three fields that moved out of `teamMembers`. */
export const COMPENSATION_FIELDS = ['monthlySalary', 'salaryHistory', 'hourlyCostRate'] as const;

export type CompensationFields = Pick<TeamMember, 'monthlySalary' | 'salaryHistory' | 'hourlyCostRate'>;

/**
 * The compensation document id for a member. The SAME shape `teamMembers` uses
 * (`isTeamMember()` in firestore.rules resolves membership with `exists()` on
 * exactly that path), so a caller who holds a member never needs a lookup to
 * find its compensation — and the rules can pin `docId == teamId + '_' + userId`
 * the way they already do for the membership row itself.
 */
export function memberCompId(teamId?: string | null, userId?: string | null): string {
  return `${teamId || ''}_${userId || ''}`;
}

/** The compensation document id for a member record. */
export function memberCompIdFor(member: Pick<TeamMember, 'teamId' | 'userId'>): string {
  return memberCompId(member.teamId, member.userId);
}

/**
 * The compensation half of a member record — what the backfill copies across
 * and what the TeamsView write path mirrors into `teamMemberComp`.
 *
 * Fields that are absent stay absent (never written as `undefined`), so a
 * member with no salary does not get a document full of empty keys.
 */
export function compensationFieldsOf(member: Partial<CompensationFields>): CompensationFields {
  const out: CompensationFields = {};
  if (member.monthlySalary !== undefined) out.monthlySalary = member.monthlySalary;
  if (member.salaryHistory !== undefined) out.salaryHistory = member.salaryHistory;
  if (member.hourlyCostRate !== undefined) out.hourlyCostRate = member.hourlyCostRate;
  return out;
}

/** True when the record carries at least one compensation fact worth moving. */
export function hasCompensationData(member: Partial<CompensationFields>): boolean {
  return member.monthlySalary !== undefined
    || member.hourlyCostRate !== undefined
    || (Array.isArray(member.salaryHistory) && member.salaryHistory.length > 0);
}

/**
 * Field-level resolution. `undefined` on the comp document means "this document
 * says nothing about this field" → the legacy value stands. An explicit `null`
 * means "cleared" → the field is gone, and the legacy value must NOT resurrect
 * it (clearing a salary that keeps being charged forever is bug #30 of the
 * finance audit, and it must not come back through the fallback).
 */
function resolveField<V>(compValue: V | null | undefined, legacyValue: V | undefined): V | undefined {
  if (compValue === undefined) return legacyValue;
  if (compValue === null) return undefined;
  return compValue;
}

/**
 * A member merged with its compensation document. The comp document wins where
 * it speaks; `teamMembers` is the fallback. Returns the member unchanged when
 * there is no comp document — which is the whole tenant's state until the
 * backfill has run, and is exactly why this is safe to ship before it.
 */
export function mergeMemberCompensation<T extends TeamMember>(
  member: T,
  comp?: MemberCompensation | null,
): T {
  if (!comp) return member;
  const monthlySalary = resolveField(comp.monthlySalary, member.monthlySalary);
  const salaryHistory = resolveField(comp.salaryHistory, member.salaryHistory);
  const hourlyCostRate = resolveField(comp.hourlyCostRate, member.hourlyCostRate);
  const merged: any = { ...member };
  // Assign rather than spread so a resolved `undefined` REMOVES the key instead
  // of leaving the legacy value behind under a key that reads as present.
  if (monthlySalary === undefined) delete merged.monthlySalary; else merged.monthlySalary = monthlySalary;
  if (salaryHistory === undefined) delete merged.salaryHistory; else merged.salaryHistory = salaryHistory;
  if (hourlyCostRate === undefined) delete merged.hourlyCostRate; else merged.hourlyCostRate = hourlyCostRate;
  return merged as T;
}

/**
 * Index compensation documents so a member can find its own in O(1).
 *
 * Keyed BOTH by the document id and by `{teamId}_{userId}` rebuilt from the
 * document's own fields: legacy `teamMembers` rows created with `addDoc` carry
 * a random id (the `backfill-member-keys` cron exists to repair exactly that),
 * so neither key alone can be trusted to match.
 */
export function indexCompensation(
  comps: Array<MemberCompensation & { id?: string }> | null | undefined,
): Map<string, MemberCompensation> {
  const map = new Map<string, MemberCompensation>();
  for (const c of comps || []) {
    if (!c) continue;
    if (c.id) map.set(c.id, c);
    const derived = memberCompId(c.teamId, c.userId);
    if (derived !== '_' && !map.has(derived)) map.set(derived, c);
  }
  return map;
}

/** The compensation document belonging to a member, from an index. */
export function compensationForMember(
  member: Pick<TeamMember, 'id' | 'teamId' | 'userId'>,
  index: Map<string, MemberCompensation>,
): MemberCompensation | null {
  return index.get(memberCompIdFor(member)) || (member.id ? index.get(member.id) : undefined) || null;
}

/**
 * The list every payroll consumer should hold: members with their compensation
 * merged in. Identity-stable when there is nothing to merge, so a screen that
 * loads no comp documents (or is not allowed to) behaves exactly as before.
 */
export function mergeMembersWithCompensation<T extends TeamMember>(
  members: T[] | null | undefined,
  comps: Array<MemberCompensation & { id?: string }> | null | undefined,
): T[] {
  const list = members || [];
  if (!comps || comps.length === 0) return list;
  const index = indexCompensation(comps);
  return list.map(m => mergeMemberCompensation(m, compensationForMember(m, index)));
}
