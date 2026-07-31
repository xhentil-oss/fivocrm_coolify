import React from 'react';
import { Routes, Route, NavLink, Navigate, Link } from 'react-router-dom';
import { ShieldX, Building2, ScrollText, ArrowLeft, Loader2, Wrench } from 'lucide-react';
import { usePermissions } from '../../contexts/PermissionsContext';
import { useAuth } from '../../contexts/AuthContext';
import { useTenantOverride } from '../../lib/platformContext';
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
