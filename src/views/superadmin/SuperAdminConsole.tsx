import React, { useEffect, useState } from 'react';
import { Routes, Route, NavLink, Navigate, Link } from 'react-router-dom';
import { ShieldX, Building2, ScrollText, ArrowLeft, Loader2, Wrench, KeyRound, RefreshCw } from 'lucide-react';
import { usePermissions } from '../../contexts/PermissionsContext';
import { useAuth } from '../../contexts/AuthContext';
import { useTenantOverride } from '../../lib/platformContext';
import { readTenantClaims } from '../../lib/tenantClaims';
import AuditLogPanel from '../../components/AuditLogPanel';
import PlatformDashboard from './PlatformDashboard';
import TenantDetailView from './TenantDetailView';
import PlatformJobsView from './PlatformJobsView';

/**
 * The PLATFORM console (/superadmin) — FivoCRM as a SaaS operator.
 *
 * Deliberately outside the /app shell: /app is ONE tenant's workspace and must look
 * and behave like it, while this console is cross-tenant. Mixing them is what made
 * other tenants' departments show up in the agency's own team list.
 *
 * Access is gated here AND at the route, and every cross-tenant read below still
 * goes through an explicit `skipBusinessFilter` in TenantsView — this shell grants
 * no data access by itself.
 */

const NAV = [
  { to: '/superadmin', end: true, label: 'Tenantët', Icon: Building2 },
  { to: '/superadmin/jobs', end: false, label: 'Punët', Icon: Wrench },
  { to: '/superadmin/audit', end: false, label: 'Audit', Icon: ScrollText },
];

/**
 * The console renders from `permissions.isSuperAdmin`, which comes from the build-time
 * `VITE_SUPER_ADMIN_EMAILS` list — but every cross-tenant READ is authorized by the
 * server-minted `superAdmin` custom claim. When the claim is missing or the ID token
 * predates it, the console used to render normally and every list came back EMPTY with
 * no explanation. This detects that mismatch and says what to do about it.
 */
const ClaimGuard: React.FC = () => {
  const [state, setState] = useState<'checking' | 'ok' | 'missing'>('checking');
  const [refreshing, setRefreshing] = useState(false);

  const check = React.useCallback(async (force = false) => {
    const claims = await readTenantClaims(force);
    setState(claims?.superAdmin ? 'ok' : 'missing');
  }, []);

  useEffect(() => { void check(false); }, [check]);

  if (state !== 'missing') return null;

  return (
    <div className="mx-4 sm:mx-6 mt-4 rounded-lg border border-amber-400/60 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40 p-3">
      <div className="flex items-start gap-2">
        <KeyRound className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
            Token-i nuk mban claim-in <span className="font-mono">superAdmin</span>
          </p>
          <p className="text-[11px] text-amber-900/80 dark:text-amber-200/80">
            Emaili i yt është në listën e super-adminëve, por autoriteti real vjen nga claim-i i
            firmosur nga serveri. Pa të, leximet ndër-tenant kthejnë <strong>bosh</strong> — jo gabim.
            Provo së pari rifreskimin e token-it; nëse mbetet, ekzekuto punën
            <span className="font-mono"> set-superadmin-claim</span> dhe dil-hyr sërish.
          </p>
        </div>
        <button
          onClick={async () => { setRefreshing(true); await check(true); setRefreshing(false); }}
          disabled={refreshing}
          className="flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1.5 rounded-md border border-amber-400/70 text-amber-900 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900/40 flex-shrink-0 disabled:opacity-50"
        >
          {refreshing ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          Rifresko token-in
        </button>
      </div>
    </div>
  );
};

const SuperAdminConsole: React.FC = () => {
  const permissions = usePermissions();
  const { user } = useAuth();
  const override = useTenantOverride();

  if (permissions.isLoading) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!permissions.isSuperAdmin) {
    return (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center text-center gap-3 bg-background p-6">
        <ShieldX className="h-14 w-14 text-destructive" />
        <h1 className="text-2xl font-bold">Akses i kufizuar</h1>
        <p className="text-muted-foreground max-w-sm">
          Kjo është konsola e platformës. Vetëm super-admin ka akses.
        </p>
        <Link to="/app/dashboard" className="text-primary hover:underline text-sm mt-2">
          Kthehu te aplikacioni
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background">
      {/* A visually distinct bar (slate, not the brand navy/cyan) so it is never
          ambiguous whether you are in the console or in a tenant's workspace. */}
      <header
        className="bg-slate-900 text-slate-100 border-b border-slate-800"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3 flex-wrap">
          <div className="h-8 w-8 rounded-lg bg-amber-400/15 flex items-center justify-center flex-shrink-0">
            <Building2 className="h-4 w-4 text-amber-400" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-sm leading-tight">Konsola e Platformës</p>
            <p className="text-[11px] text-slate-400 truncate">{user?.email || 'super-admin'}</p>
          </div>
          <Link
            to="/app/dashboard"
            className="flex items-center gap-1.5 text-xs text-slate-300 hover:text-white px-2.5 py-1.5 rounded-md hover:bg-slate-800 transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {override ? `Vazhdo te ${override.name}` : 'Kthehu te FivoCRM'}
          </Link>
        </div>
        <nav className="max-w-6xl mx-auto px-4 sm:px-6 flex gap-1">
          {NAV.map(({ to, end, label, Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
                  isActive
                    ? 'border-amber-400 text-white'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`
              }
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </NavLink>
          ))}
        </nav>
      </header>

      {/* Silent-failure guard: env says super-admin, the token may disagree. */}
      <ClaimGuard />

      <main className="flex-1 min-h-0 overflow-y-auto">
        <Routes>
          <Route index element={<PlatformDashboard />} />
          <Route path="tenants/:businessId" element={<TenantDetailView />} />
          <Route path="jobs" element={<PlatformJobsView />} />
          <Route
            path="audit"
            element={
              <div className="p-4 sm:p-6 max-w-6xl mx-auto">
                {/* auditLogs is business-scoped by the rules, so this shows the trail of
                    the ACTIVE tenant — switch tenant to read someone else's. */}
                <p className="text-xs text-muted-foreground mb-3">
                  Gjurma e tenantit aktiv{override ? `: ${override.name}` : ''}. Për një tenant tjetër, hyr në të nga lista.
                </p>
                <AuditLogPanel />
              </div>
            }
          />
          <Route path="*" element={<Navigate to="/superadmin" replace />} />
        </Routes>
      </main>
    </div>
  );
};

export default SuperAdminConsole;
