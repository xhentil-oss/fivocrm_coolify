import React from 'react';
import { usePermissions, UserPermissions } from '../hooks/usePermissions';
import { ShieldX, Loader2 } from 'lucide-react';

interface PermissionGateProps {
  permissionKey: keyof UserPermissions;
  children: React.ReactNode;
}

/**
 * Route-level permission guard.
 * Checks if the user has the required permission before rendering children.
 * Shows access denied page if not allowed, redirects to profile if no access at all.
 */
const PermissionGate: React.FC<PermissionGateProps> = ({ permissionKey, children }) => {
  const permissions = usePermissions();

  if (permissions.isLoading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const hasAccess = permissions[permissionKey] === true;

  if (!hasAccess) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center text-center">
        <ShieldX className="h-16 w-16 text-destructive mb-4" />
        <h2 className="text-2xl font-bold text-foreground mb-2">Akses i Kufizuar</h2>
        <p className="text-muted-foreground max-w-md">
          Nuk keni leje për të aksesuar këtë modul. Kontaktoni administratorin e ekipit tuaj për të kërkuar akses.
        </p>
        {permissions.role && (
          <p className="text-sm text-muted-foreground mt-4">
            Roli juaj: <span className="font-medium">{permissions.role}</span>
          </p>
        )}
        {!permissions.role && !permissions.isOwner && (
          <p className="text-sm text-muted-foreground mt-4">
            Nuk jeni anëtar i asnjë ekipi. Prisni ftesën nga administratori.
          </p>
        )}
      </div>
    );
  }

  return <>{children}</>;
};

export default PermissionGate;
