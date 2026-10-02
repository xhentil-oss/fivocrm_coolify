/**
 * Per-member capability overrides that live on `teamMembers` rows.
 *
 * `canAssignTasks` ("may hand work to a colleague") is role-derived for
 * Admin/Manager/SalesAgent and a PER-MEMBER override for Member/Sales
 * (ticked in Ekipet → Ndrysho Lejet, or granted by the role template).
 *
 * usePermissions resolves the user's role from ONE membership row — the one
 * with the highest role — but a person on several teams of the same business
 * has one row PER TEAM, and the row an admin ticked is not necessarily the one
 * the sort put first (ties between equal roles are decided by fetch order).
 * The grant therefore has to be read across every active row of that business:
 * if any of them grants it, the person has it. A Viewer/Guest row never grants
 * anything (the role is read-only), and rows from another business never count.
 */

export interface MembershipLike {
  teamId?: string | null;
  businessId?: string | null;
  role?: string | null;
  status?: string | null;
  canAssignTasks?: boolean | null;
}

const READ_ONLY_ROLES = new Set(['Viewer', 'Guest']);

/** Is `row` a row of the same tenant as `anchor`? Legacy rows without a
 *  businessId are matched by team instead, so they still count for their team. */
export function sameTenant(row: MembershipLike, anchor: MembershipLike): boolean {
  if (anchor.businessId && row.businessId) return row.businessId === anchor.businessId;
  return !!anchor.teamId && row.teamId === anchor.teamId;
}

/**
 * True when at least one active, non-read-only membership row of the anchor's
 * business grants `canAssignTasks`. The anchor itself is included.
 */
export function grantsCanAssignTasks(
  memberships: readonly MembershipLike[] | null | undefined,
  anchor: MembershipLike | null | undefined,
): boolean {
  if (!anchor) return false;
  if (READ_ONLY_ROLES.has(anchor.role || '')) return false;
  const rows = memberships && memberships.length ? memberships : [anchor];
  for (const row of rows) {
    if (row.canAssignTasks !== true) continue;
    if (row.status && row.status !== 'Active') continue;
    if (READ_ONLY_ROLES.has(row.role || '')) continue;
    if (row !== anchor && !sameTenant(row, anchor)) continue;
    return true;
  }
  return false;
}
