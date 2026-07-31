import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Building2, LogOut } from 'lucide-react';
import { useTenantOverride, clearTenantOverride } from '../lib/platformContext';

/**
 * Shown inside /app while a super-admin is working INSIDE another tenant (entered
 * from the platform console). Without it the workspace is indistinguishable from
 * your own — which is exactly how data ends up in the wrong business.
 *
 * Leaving only clears the override: usePermissions then re-resolves the operator's
 * own business and re-mints the tenant claims to match.
 */
const ImpersonationBanner: React.FC = () => {
  const override = useTenantOverride();
  const navigate = useNavigate();

  if (!override) return null;

  return (
    <div className="mb-4 flex items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
      <Building2 className="h-4 w-4 flex-shrink-0" />
      <p className="text-xs sm:text-sm min-w-0 flex-1">
        Po punon brenda tenantit <strong className="font-semibold">{override.name}</strong>.
        <span className="hidden sm:inline"> Çdo krijim ruhet te ky biznes.</span>
      </p>
      <Link
        to="/superadmin"
        className="text-xs font-medium underline underline-offset-2 hover:no-underline flex-shrink-0"
      >
        Konsola
      </Link>
      <button
        onClick={() => { clearTenantOverride(); navigate('/app/dashboard'); }}
        className="flex items-center gap-1 text-xs font-medium rounded-md border border-amber-400/60 px-2 py-1 hover:bg-amber-100 dark:hover:bg-amber-900/40 flex-shrink-0"
      >
        <LogOut className="h-3 w-3" />
        Dil
      </button>
    </div>
  );
};

export default ImpersonationBanner;
