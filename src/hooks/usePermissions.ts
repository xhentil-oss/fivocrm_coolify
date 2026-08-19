import { useCollection, useDocument, setGlobalTeamId, setGlobalBusinessId, getGlobalBusinessId } from './useFirestore';
import { ensureTenantClaims } from '../lib/tenantClaims';
import { useTenantOverride } from '../lib/platformContext';
// Reporting capabilities are resolved in ONE place so every role branch below
// stays a single spread instead of seven hand-maintained booleans.
import { reportingCapabilitiesFor, NO_REPORTING_CAPABILITIES } from '../lib/reporting/permissions';
import { useAuth } from '../contexts/AuthContext';
import { useMemo, useEffect, useRef } from 'react';
import { doc, getDoc, updateDoc, setDoc, Timestamp, collection, query, where, getDocs, writeBatch } from 'firebase/firestore';
import { db } from '../lib/firebase';

// Data scope determines what data a user can see
// 'all' = everything (admin/owner)
// 'team' = everything in their team (manager)
// 'assigned' = only data assigned to them (member)
// 'readonly' = same as assigned but no edits (viewer)
export type DataScope = 'all' | 'team' | 'assigned' | 'readonly';

export type UserPermissions = {
  canAccessProjects: boolean;
  canAccessTasks: boolean;
  canAccessCRM: boolean;
  canAccessInvoices: boolean;
  /**
   * Reporting & accountability module. Every internal role has it (everyone files
   * their own daily/weekly report); what escalates by role are the six capability
   * flags below. Defaults + per-member overrides live in
   * `src/lib/reporting/permissions.ts` — do not hand-roll them per branch.
   */
  canAccessReports: boolean;
  canReviewReports?: boolean;
  canApproveReports?: boolean;
  canPublishReports?: boolean;
  canViewAllReports?: boolean;
  canViewConfidentialReports?: boolean;
  canManageReportTemplates?: boolean;
  canViewFinancialMetrics?: boolean;
  canAccessSettings: boolean;
  canAccessGoals: boolean;
  canAccessTeams: boolean;
  canAccessChat: boolean;
  canAccessWhatsapp: boolean;
  canAccessCustomers: boolean;
  canAccessServices: boolean;
  /** Shop module (products, inventory, orders). Optional so legacy teamMember
   *  records without the flag fall back to the service-catalog permission. */
  canAccessProducts?: boolean;
  canAccessExpenses: boolean;
  canAccessMarketing?: boolean;
  canAccessProfile: boolean;
  canAccessTimeTracking: boolean;
  canEdit: boolean;
  canComment: boolean;
  canAssignTasks: boolean;
  canManageMembers: boolean;
  role: string | null;
  dataScope: DataScope;
  teamId: string | null;
  teamName: string | null;
  isAdmin: boolean;
  isOwner: boolean;
  isManager: boolean;
  isGuest: boolean;
  isSuperAdmin: boolean;
  isLoading: boolean;
};

// Full access for admin/owner
const fullAccessPermissions: Omit<UserPermissions, 'role' | 'dataScope' | 'teamId' | 'teamName' | 'isAdmin' | 'isOwner' | 'isManager' | 'isGuest' | 'isLoading'> = {
  canAccessProjects: true,
  canAccessTasks: true,
  canAccessCRM: true,
  canAccessInvoices: true,
  canAccessReports: true,
  canAccessSettings: true,
  canAccessGoals: true,
  canAccessTeams: true,
  canAccessChat: true,
  canAccessWhatsapp: true,
  canAccessCustomers: true,
  canAccessServices: true,
  canAccessProducts: true,
  canAccessExpenses: true,
  canAccessMarketing: true,
  canAccessProfile: true,
  canAccessTimeTracking: true,
  canEdit: true,
  canComment: true,
  canAssignTasks: true,
  canManageMembers: true,
  ...reportingCapabilitiesFor('Admin'),
  isSuperAdmin: false,
};

// Minimal access for users not yet assigned to a team
const restrictedPermissions: Omit<UserPermissions, 'role' | 'dataScope' | 'teamId' | 'teamName' | 'isAdmin' | 'isOwner' | 'isManager' | 'isGuest' | 'isLoading'> = {
  canAccessProjects: false,
  canAccessTasks: false,
  canAccessCRM: false,
  canAccessInvoices: false,
  canAccessReports: false,
  canAccessSettings: false,
  canAccessGoals: false,
  canAccessTeams: false,
  canAccessChat: false,
  canAccessWhatsapp: false,
  canAccessCustomers: false,
  canAccessServices: false,
  canAccessProducts: false,
  canAccessExpenses: false,
  canAccessMarketing: false,
  canAccessProfile: true,
  canAccessTimeTracking: false,
  canEdit: false,
  canComment: false,
  canAssignTasks: false,
  canManageMembers: false,
  // No team yet → no reporting surface at all (fail-closed).
  ...NO_REPORTING_CAPABILITIES,
  isSuperAdmin: false,
};

export function usePermissions(): UserPermissions {
  const { user, loading: userLoading } = useAuth();
  
  // Primary query: by userId field.
  //
  // `userId == uid`, NOT `userId in [uid, email]`. Firestore expands an `in` into one
  // sub-query per value and must authorize EACH from the query shape alone. The read
  // rule proves `resource.data.userId == request.auth.uid` for the uid branch, but
  // NOTHING can prove the `userId == <email>` branch — so the whole query was denied
  // and every session logged "Error fetching teamMembers: Missing or insufficient
  // permissions". A legacy row that stored the email in `userId` still carries the
  // `email` field, so the by-email query below covers it (and auto-links the uid).
  const { data: rawTeamMembers, loading: membersLoading, error: membersError } = useCollection<any>('teamMembers', {
    where: [{ field: 'userId', operator: '==', value: user?.uid || '__never__' }],
    skipTeamFilter: true,
    skipBusinessFilter: true, // identity resolution must read unscoped to find the business
  });

  // Fallback query: by email field — catches members added manually where userId wasn't set to the Firebase UID
  const { data: rawTeamMembersByEmail, loading: membersByEmailLoading, error: membersByEmailError } = useCollection<any>('teamMembers', {
    where: user?.email
      ? [{ field: 'email', operator: '==', value: user.email.toLowerCase() }]
      : [{ field: 'email', operator: '==', value: '__never__' }],
    skipTeamFilter: true,
    skipBusinessFilter: true, // identity resolution must read unscoped to find the business
  });

  // Merge both queries, deduplicate by id, prefer records already having the correct userId
  const teamMembers = useMemo(() => {
    const merged = new Map<string, any>();
    for (const m of rawTeamMembers || []) merged.set(m.id, m);
    for (const m of rawTeamMembersByEmail || []) if (!merged.has(m.id)) merged.set(m.id, m);
    return Array.from(merged.values()).filter((m: any) => m.status === 'Active');
  }, [rawTeamMembers, rawTeamMembersByEmail]);

  // Auto-link: when found by email but userId doesn't match current UID, update Firestore so future queries work
  const linkedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!user) return;
    for (const m of rawTeamMembersByEmail || []) {
      if (m.userId !== user.uid && !linkedRef.current.has(m.id)) {
        linkedRef.current.add(m.id);
        console.warn(`[usePermissions] Auto-linking teamMember ${m.id} (email: ${m.email}) to UID ${user.uid}`);
        updateDoc(doc(db, 'teamMembers', m.id), { userId: user.uid, updatedAt: Timestamp.now() }).catch(console.error);
      }
    }
  }, [user, rawTeamMembersByEmail]);

  // Super admin: full cross-tenant access for emails listed in VITE_SUPER_ADMIN_EMAILS.
  // Computed before the queries below because it decides whether `teams` may be read
  // unscoped (platform console) or must stay scoped (every normal user).
  // Tenant pinned from the platform console, if any (see lib/platformContext).
  const tenantOverride = useTenantOverride();

  const isSuperAdmin = useMemo(() => {
    if (!user?.email) return false;
    const raw = (import.meta.env.VITE_SUPER_ADMIN_EMAILS as string) || '';
    return raw.split(',').map(e => e.trim().toLowerCase()).filter(Boolean).includes(user.email.toLowerCase());
  }, [user]);

  // A TEAM LIVES INSIDE A BUSINESS, so a team is never read across tenants:
  //   • owned teams  → constrained by createdByUserId (the only cross-business read a
  //     normal user needs, and one the hardened `teams` rule allows per-document),
  //   • the ACTIVE team → a single document read, authorized by membership.
  // Reading the whole `teams` collection (the previous behaviour) is now impossible
  // for a normal user: Firestore rules are not filters, so an unscoped query that
  // touches another tenant's team is denied outright.
  const { data: ownedTeams, loading: ownedTeamsLoading, error: ownedTeamsError } = useCollection<any>('teams', {
    skip: !user || isSuperAdmin,
    where: user ? [{ field: 'createdByUserId', operator: '==', value: user.uid }] : undefined,
    skipTeamFilter: true,
    skipBusinessFilter: true,
  });

  // Platform console (Relax CRM) — a super-admin legitimately enumerates all tenants.
  const { data: allTeams, loading: allTeamsLoading, error: allTeamsError } = useCollection<any>('teams', {
    skip: !isSuperAdmin,
    skipTeamFilter: true,
    skipBusinessFilter: true,
  });

  // Best membership (highest authority) — resolved before the permissions memo so the
  // active team's document can be fetched by id.
  const bestMembership = useMemo(() => {
    if (!teamMembers.length) return null;
    const order: Record<string, number> = { Admin: 0, Manager: 1, Sales: 2, SalesAgent: 3, Member: 4, Viewer: 5, Guest: 6 };
    return [...teamMembers].sort((a, b) => (order[a.role] ?? 99) - (order[b.role] ?? 99))[0];
  }, [teamMembers]);

  const activeTeamId = (isSuperAdmin ? null : (ownedTeams?.[0]?.id || bestMembership?.teamId)) || undefined;
  const { data: activeTeamDoc, loading: activeTeamLoading } = useDocument<any>('teams', activeTeamId);

  // The team list handed to the permission resolver: only teams this user may see.
  const teams = useMemo(() => {
    if (isSuperAdmin) return allTeams || [];
    const list: any[] = [...(ownedTeams || [])];
    if (activeTeamDoc && !list.some(t => t.id === activeTeamDoc.id)) list.push(activeTeamDoc);
    return list;
  }, [isSuperAdmin, allTeams, ownedTeams, activeTeamDoc]);

  const teamsLoading = isSuperAdmin ? allTeamsLoading : (ownedTeamsLoading || (!!activeTeamId && activeTeamLoading));
  const teamsError = isSuperAdmin ? allTeamsError : ownedTeamsError;

  // Check if the current user is the creator/owner of any team
  const isOwner = useMemo(() => {
    if (!user || isSuperAdmin) return false;
    return (ownedTeams || []).length > 0;
  }, [user, isSuperAdmin, ownedTeams]);

  // Don't stay stuck loading forever if Firebase returns an error.
  // On error, isLoading becomes false but we still show restrictedPermissions (fail-safe).
  const isLoading = userLoading || ((membersLoading || membersByEmailLoading) && !membersError && !membersByEmailError) || (teamsLoading && !teamsError);
  const hasError = !!(membersError || membersByEmailError || teamsError);

  const permissions = useMemo((): UserPermissions => {
    // Super admin: bypass all team scoping, full access to every team's data
    if (isSuperAdmin && user) {
      return {
        ...fullAccessPermissions,
        role: 'SuperAdmin',
        dataScope: 'all',
        teamId: null,
        teamName: 'Të gjitha ekipet',
        isAdmin: true,
        isOwner: false,
        isManager: false,
        isGuest: false,
        isSuperAdmin: true,
        isLoading: false,
      };
    }

    // While loading, return restricted permissions with loading flag
    if (!user || isLoading) {
      return {
        ...restrictedPermissions,
        role: null,
        dataScope: 'assigned',
        teamId: null,
        teamName: null,
        isAdmin: false,
        isOwner: false,
        isManager: false,
        isGuest: false,
        isSuperAdmin: false,
        isLoading: isLoading,
      };
    }

    // OWNER: User who created a team gets full admin access.
    if (isOwner) {
      // Find the team this user owns, then its membership record — avoids picking a
      // membership from a different team when the user belongs to multiple teams.
      const ownedTeam = teams?.find((t: any) => t.createdByUserId === user?.uid);
      const ownerMembership = ownedTeam
        ? (teamMembers.find(m => m.teamId === ownedTeam.id) || teamMembers[0])
        : teamMembers[0] || null;
      const ownerTeamId = ownedTeam?.id || ownerMembership?.teamId || null;
      const ownerTeam = ownedTeam || (ownerTeamId ? teams?.find((t: any) => t.id === ownerTeamId) : null);
      return {
        ...fullAccessPermissions,
        role: ownerMembership?.role || 'Admin',
        dataScope: 'all',
        teamId: ownerTeamId,
        teamName: ownerTeam?.name || null,
        isAdmin: true,
        isOwner: true,
        isManager: false,
        isGuest: false,
        isSuperAdmin: false,
        isLoading: false,
      };
    }

    // On Firestore error (and not owner), fall back to restricted permissions
    if (hasError) {
      return {
        ...restrictedPermissions,
        role: null,
        dataScope: 'assigned',
        teamId: null,
        teamName: null,
        isAdmin: false,
        isOwner: false,
        isManager: false,
        isGuest: false,
        isSuperAdmin: false,
        isLoading: false,
      };
    }

    // NO TEAM MEMBERSHIP and NOT OWNER: restricted access
    if (!teamMembers || teamMembers.length === 0) {
      return {
        ...restrictedPermissions,
        role: null,
        dataScope: 'assigned',
        teamId: null,
        teamName: null,
        isAdmin: false,
        isOwner: false,
        isManager: false,
        isGuest: false,
        isSuperAdmin: false,
        isLoading: false,
      };
    }

    // Has team membership — use role-based permissions (highest authority wins).
    const membership = bestMembership!;
    const team = teams?.find((t: any) => t.id === membership.teamId);
    const memberIsAdmin = membership.role === 'Admin';
    const memberIsManager = membership.role === 'Manager';

    // Admin role gets full access with 'all' data scope
    if (memberIsAdmin) {
      return {
        ...fullAccessPermissions,
        role: membership.role,
        dataScope: 'all',
        teamId: membership.teamId,
        teamName: team?.name || null,
        isAdmin: true,
        isOwner: false,
        isManager: false,
        isGuest: false,
        isSuperAdmin: false,
        isLoading: false,
      };
    }

    // Guest role: read-only + comment access, only to explicitly invited projects
    if (membership.role === 'Guest') {
      return {
        canAccessProjects: true,
        canAccessTasks: true,
        canAccessCRM: false,
        canAccessInvoices: false,
        canAccessReports: false,
        canAccessSettings: false,
        canAccessGoals: false,
        canAccessTeams: false,
        canAccessChat: false,
        canAccessCustomers: false,
        canAccessServices: false,
        canAccessProducts: false,
        canAccessExpenses: false,
        canAccessProfile: true,
        canAccessTimeTracking: false,
        canEdit: false,
        canComment: true,
        canAssignTasks: false,
        canManageMembers: false,
        // Reporting capabilities: role defaults + per-member overrides, resolved in
        // one place. Spread AFTER the literals so an override always wins.
        ...reportingCapabilitiesFor(membership.role, membership),
        role: 'Guest',
        dataScope: 'readonly',
        teamId: membership.teamId,
        teamName: team?.name || null,
        isAdmin: false,
        isOwner: false,
        isManager: false,
        isGuest: true,
        isSuperAdmin: false,
        isLoading: false,
      };
    }

    // Sales role: access to customers, CRM, invoices, services within team
    if (membership.role === 'Sales') {
      return {
        canAccessProjects: membership.canAccessProjects === true,
        canAccessTasks: membership.canAccessTasks === true,
        canAccessCRM: true,
        canAccessInvoices: membership.canAccessInvoices === true,
        canAccessReports: true,
        canAccessSettings: false,
        canAccessGoals: membership.canAccessGoals === true,
        canAccessTeams: false,
        canAccessChat: true,
        canAccessCustomers: true,
        canAccessServices: true,
        // Sales sells whatever the tenant sells — services and products alike.
        canAccessProducts: true,
        canAccessExpenses: membership.canAccessExpenses === true,
        canAccessMarketing: true,
        canAccessProfile: true,
        canAccessTimeTracking: membership.canAccessTasks === true,
        canEdit: true,
        canComment: true,
        canAssignTasks: false,
        canManageMembers: false,
        // Reporting capabilities: role defaults + per-member overrides, resolved in
        // one place. Spread AFTER the literals so an override always wins.
        ...reportingCapabilitiesFor(membership.role, membership),
        role: membership.role,
        dataScope: 'team',
        teamId: membership.teamId,
        teamName: team?.name || null,
        isAdmin: false,
        isOwner: false,
        isManager: false,
        isGuest: false,
        isSuperAdmin: false,
        isLoading: false,
      };
    }

    // Manager role: full module access within team, can assign tasks/manage members
    if (memberIsManager) {
      return {
        canAccessProjects: true,
        canAccessTasks: true,
        canAccessCRM: membership.canAccessCRM === true,
        canAccessInvoices: membership.canAccessInvoices === true,
        canAccessReports: true,
        canAccessSettings: false,
        canAccessGoals: true,
        canAccessTeams: false,
        canAccessChat: true,
        canAccessCustomers: membership.canAccessCustomers === true || membership.canAccessCRM === true,
        canAccessServices: membership.canAccessServices === true || membership.canAccessInvoices === true,
        canAccessProducts: membership.canAccessProducts === true || membership.canAccessServices === true,
        canAccessExpenses: membership.canAccessExpenses === true || membership.canAccessInvoices === true,
        canAccessProfile: true,
        canAccessTimeTracking: true,
        canEdit: true,
        canComment: true,
        canAssignTasks: true,
        canManageMembers: false,
        // Reporting capabilities: role defaults + per-member overrides, resolved in
        // one place. Spread AFTER the literals so an override always wins.
        ...reportingCapabilitiesFor(membership.role, membership),
        role: membership.role,
        dataScope: 'team',
        teamId: membership.teamId,
        teamName: team?.name || null,
        isAdmin: false,
        isOwner: false,
        isManager: true,
        isGuest: false,
        isSuperAdmin: false,
        isLoading: false,
      };
    }

    // SalesAgent: access to CRM, Customers, Invoices, Services — only own data
    if (membership.role === 'SalesAgent') {
      return {
        canAccessProjects: true,
        canAccessTasks: true,
        canAccessCRM: true,
        canAccessInvoices: true,
        canAccessReports: false,
        canAccessSettings: false,
        canAccessGoals: false,
        canAccessTeams: false,
        canAccessChat: true,
        canAccessWhatsapp: true,
        canAccessCustomers: true,
        canAccessServices: true,
        canAccessProducts: true,
        canAccessExpenses: false,
        canAccessMarketing: true,
        canAccessProfile: true,
        canAccessTimeTracking: true,
        canEdit: true,
        canComment: true,
        canAssignTasks: true,
        canManageMembers: false,
        // Reporting capabilities: role defaults + per-member overrides, resolved in
        // one place. Spread AFTER the literals so an override always wins.
        ...reportingCapabilitiesFor(membership.role, membership),
        role: membership.role,
        dataScope: 'assigned',
        teamId: membership.teamId,
        teamName: team?.name || null,
        isAdmin: false,
        isOwner: false,
        isManager: false,
        isGuest: false,
        isSuperAdmin: false,
        isLoading: false,
      };
    }

    // Viewer role: read-only access to assigned items only
    // Member role: access to assigned items with edit rights
    const isViewer = membership.role === 'Viewer';

    return {
      canAccessProjects: membership.canAccessProjects === true,
      canAccessTasks: !isViewer ? true : membership.canAccessTasks === true,
      canAccessCRM: membership.canAccessCRM === true,
      canAccessInvoices: membership.canAccessInvoices === true,
      canAccessReports: false,
      canAccessSettings: membership.canAccessSettings === true,
      canAccessGoals: membership.canAccessGoals === true || !isViewer,
      canAccessTeams: false,
      canAccessChat: true,
      canAccessWhatsapp: membership.canAccessWhatsapp === true || membership.canAccessChat === true,
      canAccessCustomers: membership.canAccessCustomers === true || membership.canAccessCRM === true,
      canAccessServices: membership.canAccessServices === true || membership.canAccessInvoices === true,
      canAccessProducts: membership.canAccessProducts === true || membership.canAccessServices === true,
      canAccessExpenses: membership.canAccessExpenses === true || membership.canAccessInvoices === true,
      canAccessProfile: true,
      canAccessTimeTracking: !isViewer ? true : membership.canAccessTasks === true,
      canEdit: !isViewer,
      canComment: true,
      canAssignTasks: false,
      canManageMembers: false,
      // Reporting capabilities: role defaults + per-member overrides, resolved in
      // one place. Spread AFTER the literals so an override always wins.
      ...reportingCapabilitiesFor(membership.role, membership),
      role: membership.role,
      dataScope: isViewer ? 'readonly' : 'assigned',
      teamId: membership.teamId,
      teamName: team?.name || null,
      isAdmin: false,
      isOwner: false,
      isManager: false,
      isGuest: false,
      isSuperAdmin: false,
      isLoading: false,
    };
  }, [user, teamMembers, teams, bestMembership, isOwner, isLoading, isSuperAdmin, hasError]);

  // One-time normalization: if teamMember.userId is stored as email instead of UID,
  // update it and reassign any tasks/records that reference the old email-based userId.
  const normalizedRef = useRef(false);
  useEffect(() => {
    if (normalizedRef.current || !user || !user.email || !teamMembers || teamMembers.length === 0) return;

    const emailMember = teamMembers.find(
      (m: any) => m.userId === user.email && m.userId !== user.uid
    );
    if (!emailMember) return;

    normalizedRef.current = true;

    // Update the teamMember record to use the actual Firebase Auth UID.
    // (The rules now carry a dedicated self-heal branch: an email-keyed row whose
    // email matches the signer may re-point userId to their own uid — the old
    // self-branch required userId == uid, false for exactly these rows, so this
    // repair was denied every session for the members who needed it.)
    (async () => {
      try {
        const memberRef = doc(db, 'teamMembers', emailMember.id);
        await updateDoc(memberRef, { userId: user.uid, updatedAt: Timestamp.now() });

        // Also update any tasks assigned to the old email-based userId.
        // businessId makes the query PROVABLE under the tasks read rule — the
        // email-only filter was denied for every non-super-admin.
        const bid = (emailMember as any).businessId || getGlobalBusinessId();
        const tasksSnap = await getDocs(
          query(
            collection(db, 'tasks'),
            ...(bid ? [where('businessId', '==', bid)] : []),
            where('assignedToUserId', '==', user.email),
          )
        );
        if (!tasksSnap.empty) {
          const batch = writeBatch(db);
          tasksSnap.docs.forEach(d => {
            batch.update(d.ref, { assignedToUserId: user.uid, updatedAt: Timestamp.now() });
          });
          await batch.commit();
        }
      } catch {
        // Non-blocking — RBAC filters already handle both uid and email
      }
    })();
  }, [user, teamMembers]);

  // Sync resolved teamId to global state via useEffect (safe, no side effects during render).
  // Guard 1: only fire when fully loaded.
  // Guard 2: only update with a non-null teamId — a usePermissions instance that resolves
  //   with teamId=null (e.g. a non-member component that loaded before its data arrived)
  //   must NOT reset globalTeamId back to null and wipe out team-scoped collection data.
  const persistedTeamIdRef = useRef<string | null>(null);
  useEffect(() => {
    // A super-admin resolves with teamId=null (they belong to the platform, not to a
    // department), so the branch below gives them a concrete ACTIVE team/business.
    // Reads are scoped to it exactly like anyone else's — since the console can enter
    // a tenant explicitly, there is no cross-tenant read mode any more — and writes
    // need it too, or every team-scoped create throws "without an active team".
    // Context-aware creates (e.g. a task inside a project) still pass an explicit
    // teamId, which takes precedence.
    if (isSuperAdmin) {
      // The platform console can pin an explicit tenant ("Hyr" in /superadmin). That
      // choice WINS over the heuristic below — entering a tenant is the whole point.
      // users/{uid} is deliberately not touched here: that marker describes the
      // super-admin's OWN home business, not the one they are visiting.
      if (tenantOverride) {
        setGlobalTeamId(tenantOverride.teamId);
        setGlobalBusinessId(tenantOverride.businessId);
        void ensureTenantClaims({ teamId: tenantOverride.teamId, businessId: tenantOverride.businessId });
        return;
      }
      // Candidate active teams: the super-admin's own memberships, else all teams.
      const candidates = (teamMembers.length ? teamMembers.map((m: any) => m.teamId) : (teams || []).map((t: any) => t.id))
        .filter(Boolean) as string[];
      if (candidates.length === 0) return;
      let cancelled = false;
      (async () => {
        // Prefer a team that has WhatsApp enabled so per-team features (WhatsApp,
        // bank/rate/Stripe settings) resolve to a configured team rather than an
        // arbitrary one. Falls back to the first candidate.
        let chosen = candidates[0];
        try {
          for (const tid of candidates) {
            const s = await getDoc(doc(db, 'teamSettings', tid));
            if (s.exists() && (s.data() as any).whatsappEnabled) { chosen = tid; break; }
          }
        } catch { /* ignore — keep the first candidate */ }
        if (cancelled) return;
        setGlobalTeamId(chosen);
        // Resolve the active business (two-level model). Falls back to the teamId
        // when the team isn't linked to a business yet (pre-migration safe default).
        const chosenBiz = (teams || []).find((t: any) => t.id === chosen)?.businessId || chosen;
        setGlobalBusinessId(chosenBiz);
        if (user && persistedTeamIdRef.current !== chosen) {
          persistedTeamIdRef.current = chosen;
          setDoc(doc(db, 'users', user.uid), { teamId: chosen, businessId: chosenBiz, updatedAt: Timestamp.now() }, { merge: true }).catch(() => {});
        }
        // Keep the signed claims aligned with the console's active tenant.
        void ensureTenantClaims({ teamId: chosen, businessId: chosenBiz });
      })();
      return () => { cancelled = true; };
    }
    if (!permissions.isLoading && permissions.teamId !== null) {
      setGlobalTeamId(permissions.teamId);
      // Resolve the active business — the tenant this team belongs to. Priority:
      // the membership's own businessId (server-written on invite accept), then the
      // team document, then the teamId itself for legacy teams with no business layer.
      const activeBiz =
        (bestMembership?.teamId === permissions.teamId ? bestMembership?.businessId : null)
        || (teams || []).find((t: any) => t.id === permissions.teamId)?.businessId
        || permissions.teamId;
      setGlobalBusinessId(activeBiz);
      // Persist the active teamId + businessId to users/{uid} — the FALLBACK path for
      // rules while a session has no tenant claims yet (the write is itself validated
      // against a real membership by the `users` rule).
      if (user && persistedTeamIdRef.current !== permissions.teamId) {
        persistedTeamIdRef.current = permissions.teamId;
        setDoc(
          doc(db, 'users', user.uid),
          { teamId: permissions.teamId, businessId: activeBiz, updatedAt: Timestamp.now() },
          { merge: true }
        ).catch(() => {});
      }
      // Reconcile the SIGNED tenant identity (custom claims) with what we resolved.
      // This is the authoritative boundary for Firestore rules; no-op when it matches.
      void ensureTenantClaims({ teamId: permissions.teamId, businessId: activeBiz });
    }
  }, [isSuperAdmin, tenantOverride, permissions.isLoading, permissions.teamId, user, teamMembers, teams, bestMembership]);

  return permissions;
}
