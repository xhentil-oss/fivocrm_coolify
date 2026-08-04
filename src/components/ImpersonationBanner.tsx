import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Building2, LogOut, Clock, Plus, Loader2 } from 'lucide-react';
import {
  useTenantOverride, clearTenantOverride, extendTenantOverride, overrideMinutesLeft,
  IMPERSONATION_EXTEND_MINUTES,
} from '../lib/platformContext';
import { syncTenantClaims } from '../lib/tenantClaims';

/**
 * Shown inside /app while a super-admin is working INSIDE another tenant (entered
 * from the platform console). Without it the workspace is indistinguishable from
 * your own — which is exactly how data ends up in the wrong business.
 *
 * The session is TIME-BOXED (see platformContext): the countdown is visible, it can be
 * extended deliberately, and it ends on its own. Leaving re-mints the operator's own
 * tenant claims and records `claims.impersonate_end`, so the audit trail shows the exit
 * as well as the entry — previously an operator walked in and never came out.
 */
const ImpersonationBanner: React.FC = () => {
  const override = useTenantOverride();
  const navigate = useNavigate();
  const [leaving, setLeaving] = useState(false);

  if (!override) return null;

  const minutesLeft = overrideMinutesLeft();
  const expiringSoon = minutesLeft !== null && minutesLeft <= 5;

  const leave = async () => {
    if (leaving) return;
    setLeaving(true);
    const leftBusinessId = override.businessId;
    // Clear the UI scope FIRST, so nothing can be written into the tenant while the
    // claims are being re-minted, then hand authority back to the operator's own tenant.
    clearTenantOverride();
    try {
      await syncTenantClaims({ endImpersonation: true, businessId: leftBusinessId });
    } catch { /* usePermissions re-syncs on the next load anyway */ }
    setLeaving(false);
    navigate('/app/dashboard');
  };

  return (
    <div className="mb-4 flex items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
      <Building2 className="h-4 w-4 flex-shrink-0" />
      <p className="text-xs sm:text-sm min-w-0 flex-1">
        Po punon brenda tenantit <strong className="font-semibold">{override.name}</strong>.
        <span className="hidden sm:inline"> Çdo krijim ruhet te ky biznes.</span>
      </p>

      {minutesLeft !== null && (
        <span
          className={`flex items-center gap-1 text-xs tabular-nums flex-shrink-0 ${expiringSoon ? 'font-semibold' : ''}`}
          title="Sesioni mbyllet vetë; zgjate nëse ke nevojë"
        >
          <Clock className="h-3 w-3" />
          {minutesLeft}m
        </span>
      )}

      <button
        onClick={() => extendTenantOverride()}
        className="hidden sm:flex items-center gap-1 text-xs font-medium rounded-md border border-amber-400/60 px-2 py-1 hover:bg-amber-100 dark:hover:bg-amber-900/40 flex-shrink-0"
        title={`Zgjat me ${IMPERSONATION_EXTEND_MINUTES} minuta`}
      >
        <Plus className="h-3 w-3" />
        {IMPERSONATION_EXTEND_MINUTES}m
      </button>

      <Link
        to="/superadmin"
        className="text-xs font-medium underline underline-offset-2 hover:no-underline flex-shrink-0"
      >
        Konsola
      </Link>

      <button
        onClick={leave}
        disabled={leaving}
        className="flex items-center gap-1 text-xs font-medium rounded-md border border-amber-400/60 px-2 py-1 hover:bg-amber-100 dark:hover:bg-amber-900/40 flex-shrink-0 disabled:opacity-50"
      >
        {leaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <LogOut className="h-3 w-3" />}
        Dil
      </button>
    </div>
  );
};

export default ImpersonationBanner;
