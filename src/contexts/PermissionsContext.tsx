import React, { createContext, useContext, useState, useMemo } from 'react';
import { usePermissions as usePermissionsBase, UserPermissions } from '../hooks/usePermissions';

export type { UserPermissions };

export type PreviewRole = 'Admin' | 'Sales' | 'SalesAgent' | 'Manager' | 'Member' | 'Viewer' | 'Guest' | null;

export interface PermissionsContextValue extends UserPermissions {
  previewRole: PreviewRole;
  setPreviewRole: (role: PreviewRole) => void;
  // Admin "view as customer" — when set, the app renders the client portal as
  // this customer (read-only preview). Only applied for real staff (owner/admin).
  previewCustomerId: string | null;
  previewCustomerName: string | null;
  setPreviewCustomer: (id: string | null, name?: string | null) => void;
}

const SESSION_KEY = 'role_preview';
const CUSTOMER_PREVIEW_ID_KEY = 'customer_preview_id';
const CUSTOMER_PREVIEW_NAME_KEY = 'customer_preview_name';

/** Build simulated permissions for a given role (used by owner preview mode). */
function simulateRole(role: PreviewRole, base: UserPermissions): UserPermissions {
  if (!role) return base;

  switch (role) {
    case 'Admin':
      return {
        ...base,
        canAccessProjects: true, canAccessTasks: true, canAccessCRM: true,
        canAccessInvoices: true, canAccessReports: true, canAccessSettings: true,
        canAccessGoals: true, canAccessTeams: true, canAccessChat: true, canAccessWhatsapp: true,
        canAccessCustomers: true, canAccessServices: true, canAccessExpenses: true,
        canAccessMarketing: true,
        canAccessProfile: true, canAccessTimeTracking: true,
        canEdit: true, canComment: true, canAssignTasks: true, canManageMembers: true,
        role: 'Admin', dataScope: 'all', isAdmin: true, isOwner: false, isManager: false, isGuest: false,
      };
    case 'Sales':
      return {
        ...base,
        canAccessProjects: true, canAccessTasks: true, canAccessCRM: true,
        canAccessInvoices: true, canAccessReports: true, canAccessSettings: false,
        canAccessGoals: true, canAccessTeams: false, canAccessChat: true, canAccessWhatsapp: true,
        canAccessCustomers: true, canAccessServices: true, canAccessExpenses: false,
        canAccessMarketing: true,
        canAccessProfile: true, canAccessTimeTracking: true,
        canEdit: true, canComment: true, canAssignTasks: false, canManageMembers: false,
        role: 'Sales', dataScope: 'team', isAdmin: false, isOwner: false, isManager: false, isGuest: false,
      };
    case 'SalesAgent':
      return {
        ...base,
        canAccessProjects: false, canAccessTasks: true, canAccessCRM: true,
        canAccessInvoices: true, canAccessReports: false, canAccessSettings: false,
        canAccessGoals: false, canAccessTeams: false, canAccessChat: true, canAccessWhatsapp: true,
        canAccessCustomers: true, canAccessServices: true, canAccessExpenses: false,
        canAccessMarketing: true,
        canAccessProfile: true, canAccessTimeTracking: true,
        canEdit: true, canComment: true, canAssignTasks: true, canManageMembers: false,
        role: 'SalesAgent', dataScope: 'assigned', isAdmin: false, isOwner: false, isManager: false, isGuest: false,
      };
    case 'Manager':
      return {
        ...base,
        canAccessProjects: true, canAccessTasks: true, canAccessCRM: false,
        canAccessInvoices: false, canAccessReports: true, canAccessSettings: false,
        canAccessGoals: true, canAccessTeams: false, canAccessChat: true, canAccessWhatsapp: true,
        canAccessCustomers: false, canAccessServices: false, canAccessExpenses: false,
        canAccessProfile: true, canAccessTimeTracking: true,
        canEdit: true, canComment: true, canAssignTasks: true, canManageMembers: false,
        role: 'Manager', dataScope: 'team', isAdmin: false, isOwner: false, isManager: true, isGuest: false,
      };
    case 'Member':
      return {
        ...base,
        canAccessProjects: true, canAccessTasks: true, canAccessCRM: false,
        canAccessInvoices: false, canAccessReports: false, canAccessSettings: false,
        canAccessGoals: true, canAccessTeams: false, canAccessChat: true, canAccessWhatsapp: true,
        canAccessCustomers: false, canAccessServices: false, canAccessExpenses: false,
        canAccessProfile: true, canAccessTimeTracking: true,
        canEdit: true, canComment: true, canAssignTasks: false, canManageMembers: false,
        role: 'Member', dataScope: 'assigned', isAdmin: false, isOwner: false, isManager: false, isGuest: false,
      };
    case 'Viewer':
      return {
        ...base,
        canAccessProjects: true, canAccessTasks: true, canAccessCRM: false,
        canAccessInvoices: false, canAccessReports: false, canAccessSettings: false,
        canAccessGoals: false, canAccessTeams: false, canAccessChat: true, canAccessWhatsapp: true,
        canAccessCustomers: false, canAccessServices: false, canAccessExpenses: false,
        canAccessProfile: true, canAccessTimeTracking: false,
        canEdit: false, canComment: true, canAssignTasks: false, canManageMembers: false,
        role: 'Viewer', dataScope: 'readonly', isAdmin: false, isOwner: false, isManager: false, isGuest: false,
      };
    case 'Guest':
      return {
        ...base,
        canAccessProjects: true, canAccessTasks: true, canAccessCRM: false,
        canAccessInvoices: false, canAccessReports: false, canAccessSettings: false,
        canAccessGoals: false, canAccessTeams: false, canAccessChat: false, canAccessWhatsapp: false,
        canAccessCustomers: false, canAccessServices: false, canAccessExpenses: false,
        canAccessProfile: true, canAccessTimeTracking: false,
        canEdit: false, canComment: true, canAssignTasks: false, canManageMembers: false,
        role: 'Guest', dataScope: 'readonly', isAdmin: false, isOwner: false, isManager: false, isGuest: true,
      };
    default:
      return base;
  }
}

// Shared context — computed once at the top of the app, consumed everywhere.
// This ensures a single Firestore subscription and guarantees all components
// see the same permissions at the same time (no race between independent subscribers).

const PermissionsContext = createContext<PermissionsContextValue | null>(null);

export const PermissionsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const realPermissions = usePermissionsBase();

  const [previewRole, setPreviewRoleState] = useState<PreviewRole>(() => {
    try {
      const stored = sessionStorage.getItem(SESSION_KEY);
      const validRoles: (string | null)[] = ['Admin', 'Sales', 'SalesAgent', 'Manager', 'Member', 'Viewer', 'Guest'];
      return validRoles.includes(stored) ? (stored as PreviewRole) : null;
    } catch {
      return null;
    }
  });

  const setPreviewRole = (role: PreviewRole) => {
    try {
      if (role) sessionStorage.setItem(SESSION_KEY, role);
      else sessionStorage.removeItem(SESSION_KEY);
    } catch { /* ignore */ }
    setPreviewRoleState(role);
  };

  const [previewCustomerId, setPreviewCustomerIdState] = useState<string | null>(() => {
    try { return sessionStorage.getItem(CUSTOMER_PREVIEW_ID_KEY) || null; } catch { return null; }
  });
  const [previewCustomerName, setPreviewCustomerNameState] = useState<string | null>(() => {
    try { return sessionStorage.getItem(CUSTOMER_PREVIEW_NAME_KEY) || null; } catch { return null; }
  });

  const setPreviewCustomer = (id: string | null, name: string | null = null) => {
    try {
      if (id) {
        sessionStorage.setItem(CUSTOMER_PREVIEW_ID_KEY, id);
        if (name) sessionStorage.setItem(CUSTOMER_PREVIEW_NAME_KEY, name);
        else sessionStorage.removeItem(CUSTOMER_PREVIEW_NAME_KEY);
      } else {
        sessionStorage.removeItem(CUSTOMER_PREVIEW_ID_KEY);
        sessionStorage.removeItem(CUSTOMER_PREVIEW_NAME_KEY);
      }
    } catch { /* ignore */ }
    setPreviewCustomerIdState(id);
    setPreviewCustomerNameState(id ? name : null);
  };

  const permissions = useMemo((): PermissionsContextValue => {
    // Only the real owner can preview roles; while loading, never apply preview
    const effective =
      realPermissions.isOwner && previewRole && !realPermissions.isLoading
        ? simulateRole(previewRole, realPermissions)
        : realPermissions;

    return { ...effective, previewRole, setPreviewRole, previewCustomerId, previewCustomerName, setPreviewCustomer };
  }, [realPermissions, previewRole, previewCustomerId, previewCustomerName]);

  return (
    <PermissionsContext.Provider value={permissions}>
      {children}
    </PermissionsContext.Provider>
  );
};

/** Read shared permissions. Falls back to computing directly if used outside provider. */
export function usePermissions(): PermissionsContextValue {
  const ctx = useContext(PermissionsContext);
  if (ctx) return ctx;
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const base = usePermissionsBase();
  return { ...base, previewRole: null, setPreviewRole: () => {}, previewCustomerId: null, previewCustomerName: null, setPreviewCustomer: () => {} };
}
