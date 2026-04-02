import { useCollection, setGlobalTeamId } from './useFirestore';
import { useAuth } from '../contexts/AuthContext';
import { useMemo, useEffect, useRef } from 'react';
import { doc, updateDoc, Timestamp, collection, query, where, getDocs, writeBatch } from 'firebase/firestore';
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
  canAccessReports: boolean;
  canAccessSettings: boolean;
  canAccessGoals: boolean;
  canAccessTeams: boolean;
  canAccessChat: boolean;
  canAccessCustomers: boolean;
  canAccessServices: boolean;
  canAccessExpenses: boolean;
  canAccessProfile: boolean;
  canAccessTimeTracking: boolean;
  canEdit: boolean;
  canAssignTasks: boolean;
  canManageMembers: boolean;
  role: string | null;
  dataScope: DataScope;
  teamId: string | null;
  teamName: string | null;
  isAdmin: boolean;
  isOwner: boolean;
  isManager: boolean;
  isLoading: boolean;
};

// Full access for admin/owner
const fullAccessPermissions: Omit<UserPermissions, 'role' | 'dataScope' | 'teamId' | 'teamName' | 'isAdmin' | 'isOwner' | 'isManager' | 'isLoading'> = {
  canAccessProjects: true,
  canAccessTasks: true,
  canAccessCRM: true,
  canAccessInvoices: true,
  canAccessReports: true,
  canAccessSettings: true,
  canAccessGoals: true,
  canAccessTeams: true,
  canAccessChat: true,
  canAccessCustomers: true,
  canAccessServices: true,
  canAccessExpenses: true,
  canAccessProfile: true,
  canAccessTimeTracking: true,
  canEdit: true,
  canAssignTasks: true,
  canManageMembers: true,
};

// Minimal access for users not yet assigned to a team
const restrictedPermissions: Omit<UserPermissions, 'role' | 'dataScope' | 'teamId' | 'teamName' | 'isAdmin' | 'isOwner' | 'isManager' | 'isLoading'> = {
  canAccessProjects: false,
  canAccessTasks: false,
  canAccessCRM: false,
  canAccessInvoices: false,
  canAccessReports: false,
  canAccessSettings: false,
  canAccessGoals: false,
  canAccessTeams: false,
  canAccessChat: false,
  canAccessCustomers: false,
  canAccessServices: false,
  canAccessExpenses: false,
  canAccessProfile: true,
  canAccessTimeTracking: false,
  canEdit: false,
  canAssignTasks: false,
  canManageMembers: false,
};

export function usePermissions(): UserPermissions {
  const { user, loading: userLoading } = useAuth();
  
  // Query team members for this specific user (by uid or email) instead of ALL members
  const userIds = useMemo(() => {
    if (!user) return [];
    const ids = [user.uid];
    if (user.email) ids.push(user.email);
    return ids;
  }, [user]);

  // Primary query: by userId field (covers UID or email stored as userId)
  const { data: rawTeamMembers, loading: membersLoading, error: membersError } = useCollection<any>('teamMembers', {
    where: userIds.length > 0
      ? [{ field: 'userId', operator: 'in', value: userIds }]
      : [{ field: 'userId', operator: '==', value: '__never__' }],
    skipTeamFilter: true,
  });

  // Fallback query: by email field — catches members added manually where userId wasn't set to the Firebase UID
  const { data: rawTeamMembersByEmail, loading: membersByEmailLoading, error: membersByEmailError } = useCollection<any>('teamMembers', {
    where: user?.email
      ? [{ field: 'email', operator: '==', value: user.email }]
      : [{ field: 'email', operator: '==', value: '__never__' }],
    skipTeamFilter: true,
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

  const { data: teams, loading: teamsLoading, error: teamsError } = useCollection<any>('teams', {
    skipTeamFilter: true,
  });

  // Check if the current user is the creator/owner of any team
  const isOwner = useMemo(() => {
    if (!user || !teams) return false;
    return teams.some((t: any) => t.createdByUserId === user.uid);
  }, [user, teams]);

  // Don't stay stuck loading forever if Firebase returns an error.
  // On error, isLoading becomes false but we still show restrictedPermissions (fail-safe).
  const isLoading = userLoading || ((membersLoading || membersByEmailLoading) && !membersError && !membersByEmailError) || (teamsLoading && !teamsError);
  const hasError = !!(membersError || membersByEmailError || teamsError);

  const permissions = useMemo((): UserPermissions => {
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
        isLoading: isLoading,
      };
    }

    // OWNER: User who created a team gets full admin access.
    // Check owner BEFORE hasError so that owners are never locked out
    // when teamMembers queries fail.
    if (isOwner) {
      // Check if owner also has a team membership (for teamId/teamName)
      const ownerMembership = teamMembers.length > 0 ? teamMembers[0] : null;
      let ownerTeamId = ownerMembership?.teamId || null;
      let ownerTeam = ownerTeamId ? teams?.find((t: any) => t.id === ownerTeamId) : null;

      // Fallback: if no teamMembers record, derive teamId from owned team directly
      if (!ownerTeamId && teams && teams.length > 0) {
        const ownedTeam = teams.find((t: any) => t.createdByUserId === user?.uid);
        if (ownedTeam) {
          ownerTeamId = ownedTeam.id;
          ownerTeam = ownedTeam;
        }
      }

      return {
        ...fullAccessPermissions,
        role: ownerMembership?.role || 'Admin',
        dataScope: 'all',
        teamId: ownerTeamId,
        teamName: ownerTeam?.name || null,
        isAdmin: true,
        isOwner: true,
        isManager: false,
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
        isLoading: false,
      };
    }

    // Has team membership — use role-based permissions
    // Sort by role priority for deterministic selection when user has multiple teams
    const roleOrder: Record<string, number> = { Admin: 0, Manager: 1, Sales: 2, SalesAgent: 3, Member: 4, Viewer: 5 };
    const membership = [...teamMembers].sort((a, b) => (roleOrder[a.role] ?? 99) - (roleOrder[b.role] ?? 99))[0];
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
        canAccessExpenses: membership.canAccessExpenses === true,
        canAccessProfile: true,
        canAccessTimeTracking: membership.canAccessTasks === true,
        canEdit: true,
        canAssignTasks: false,
        canManageMembers: false,
        role: membership.role,
        dataScope: 'team',
        teamId: membership.teamId,
        teamName: team?.name || null,
        isAdmin: false,
        isOwner: false,
        isManager: false,
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
        canAccessExpenses: membership.canAccessExpenses === true || membership.canAccessInvoices === true,
        canAccessProfile: true,
        canAccessTimeTracking: true,
        canEdit: true,
        canAssignTasks: true,
        canManageMembers: false,
        role: membership.role,
        dataScope: 'team',
        teamId: membership.teamId,
        teamName: team?.name || null,
        isAdmin: false,
        isOwner: false,
        isManager: true,
        isLoading: false,
      };
    }

    // SalesAgent: access to CRM, Customers, Invoices, Services — only own data
    if (membership.role === 'SalesAgent') {
      return {
        canAccessProjects: false,
        canAccessTasks: true,
        canAccessCRM: true,
        canAccessInvoices: true,
        canAccessReports: false,
        canAccessSettings: false,
        canAccessGoals: false,
        canAccessTeams: false,
        canAccessChat: true,
        canAccessCustomers: true,
        canAccessServices: true,
        canAccessExpenses: false,
        canAccessProfile: true,
        canAccessTimeTracking: true,
        canEdit: true,
        canAssignTasks: false,
        canManageMembers: false,
        role: membership.role,
        dataScope: 'assigned',
        teamId: membership.teamId,
        teamName: team?.name || null,
        isAdmin: false,
        isOwner: false,
        isManager: false,
        isLoading: false,
      };
    }

    // Viewer role: read-only access to assigned items only
    // Member role: access to assigned items with edit rights
    const isViewer = membership.role === 'Viewer';
    
    return {
      canAccessProjects: membership.canAccessProjects === true,
      canAccessTasks: membership.canAccessTasks === true,
      canAccessCRM: membership.canAccessCRM === true,
      canAccessInvoices: membership.canAccessInvoices === true,
      canAccessReports: true,
      canAccessSettings: membership.canAccessSettings === true,
      canAccessGoals: membership.canAccessGoals === true || membership.canAccessTasks === true,
      canAccessTeams: false, // Only admin/owner can manage teams
      canAccessChat: true,
      canAccessCustomers: membership.canAccessCustomers === true || membership.canAccessCRM === true,
      canAccessServices: membership.canAccessServices === true || membership.canAccessInvoices === true,
      canAccessExpenses: membership.canAccessExpenses === true || membership.canAccessInvoices === true,
      canAccessProfile: true,
      canAccessTimeTracking: membership.canAccessTasks === true,
      canEdit: !isViewer, // Viewers can only read, Members can edit
      canAssignTasks: false, // Members can't assign to others
      canManageMembers: false,
      role: membership.role,
      dataScope: isViewer ? 'readonly' : 'assigned',
      teamId: membership.teamId,
      teamName: team?.name || null,
      isAdmin: false,
      isOwner: false,
      isManager: false,
      isLoading: false,
    };
  }, [user, teamMembers, teams, isOwner, isLoading]);

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

    // Update the teamMember record to use the actual Firebase Auth UID
    (async () => {
      try {
        const memberRef = doc(db, 'teamMembers', emailMember.id);
        await updateDoc(memberRef, { userId: user.uid, updatedAt: Timestamp.now() });

        // Also update any tasks assigned to the old email-based userId
        const tasksSnap = await getDocs(
          query(collection(db, 'tasks'), where('assignedToUserId', '==', user.email))
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
  useEffect(() => {
    if (!permissions.isLoading && permissions.teamId !== null) {
      setGlobalTeamId(permissions.teamId);
    }
  }, [permissions.isLoading, permissions.teamId]);

  return permissions;
}
