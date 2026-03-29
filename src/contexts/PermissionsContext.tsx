import React, { createContext, useContext } from 'react';
import { usePermissions as usePermissionsBase, UserPermissions } from '../hooks/usePermissions';

export type { UserPermissions };

// Shared context — computed once at the top of the app, consumed everywhere.
// This ensures a single Firestore subscription and guarantees all components
// see the same permissions at the same time (no race between independent subscribers).

const PermissionsContext = createContext<UserPermissions | null>(null);

export const PermissionsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const permissions = usePermissionsBase();
  return (
    <PermissionsContext.Provider value={permissions}>
      {children}
    </PermissionsContext.Provider>
  );
};

/** Read shared permissions. Falls back to computing directly if used outside provider. */
export function usePermissions(): UserPermissions {
  const ctx = useContext(PermissionsContext);
  if (ctx) return ctx;
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return usePermissionsBase();
}
