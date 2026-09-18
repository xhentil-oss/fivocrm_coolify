import React from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Lock, PackageX, ShieldAlert, Sparkles } from 'lucide-react';
import { Button } from './ui/button';
import { useModules } from '../hooks/useModules';
import { MODULE_BY_ID, requiredPlanLabel, PLAN_LABELS, type PlanKey } from '../lib/modules';

interface ModuleGateProps {
  /** Module id from src/lib/modules.ts (e.g. 'shop'). */
  moduleId: string;
  children: React.ReactNode;
}

const Shell: React.FC<{
  icon: React.ComponentType<{ className?: string }>;
  tone: 'muted' | 'warn' | 'primary';
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}> = ({ icon: Icon, tone, title, children, action }) => {
  const toneCls =
    tone === 'warn'
      ? 'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-300'
      : tone === 'primary'
        ? 'bg-accent-soft text-primary'
        : 'bg-muted text-muted-foreground';
  return (
    <div className="flex items-center justify-center min-h-[60vh] px-4">
      <div className="max-w-md w-full text-center space-y-4">
        <div className={`w-14 h-14 rounded-2xl flex items-center justify-center mx-auto ${toneCls}`}>
          <Icon className="w-7 h-7" />
        </div>
        <h2 className="text-h3 text-foreground">{title}</h2>
        <p className="text-body-sm text-muted-foreground">{children}</p>
        {action}
      </div>
    </div>
  );
};

/**
 * Route guard for a registered module. Enforces all three gates — role permission,
 * SaaS plan, per-tenant toggle — so a hidden nav item can't be reached by typing
 * its URL (the gap the Sidebar-only check left open).
 *
 * Use INSTEAD of <PermissionGate> for module routes: the permission check is part
 * of the module definition, so wrapping in both would duplicate it.
 */
const ModuleGate: React.FC<ModuleGateProps> = ({ moduleId, children }) => {
  const { blockReason, loading, plan } = useModules();
  const mod = MODULE_BY_ID[moduleId];

  if (!mod) {
    // A typo in a route definition must fail loudly in dev, not silently render.
    if (import.meta.env.DEV) console.error(`[ModuleGate] Unknown moduleId "${moduleId}"`);
    return <>{children}</>;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const reason = blockReason(mod.id);

  if (reason === 'permission') {
    return (
      <Shell icon={ShieldAlert} tone="warn" title="Akses i Kufizuar">
        Nuk keni leje për modulin <strong>{mod.label}</strong>. Kontaktoni administratorin e ekipit
        tuaj për të kërkuar akses.
      </Shell>
    );
  }

  if (reason === 'plan') {
    return (
      <Shell
        icon={Sparkles}
        tone="primary"
        title={`${mod.label} — plani ${requiredPlanLabel(mod)}`}
        action={
          <Button asChild className="bg-primary text-primary-foreground">
            <Link to="/app/settings">Shiko planet</Link>
          </Button>
        }
      >
        {mod.description} Ky modul përfshihet nga plani <strong>{requiredPlanLabel(mod)}</strong> e
        lart — plani aktual është <strong>{PLAN_LABELS[plan as PlanKey] || plan}</strong>.
      </Shell>
    );
  }

  if (reason === 'locked') {
    // Withheld by the platform: the owner's own switch cannot help here, so do not
    // send them to Cilësimet → Modulet like the `disabled` case does.
    return (
      <Shell icon={Lock} tone="muted" title={`${mod.label} nuk përfshihet në kontratën tuaj`}>
        {mod.description} Ky modul menaxhohet nga FivoCRM dhe nuk është aktiv për këtë workspace.
        Kontaktoni FivoCRM për ta shtuar.
      </Shell>
    );
  }

  if (reason === 'disabled') {
    return (
      <Shell
        icon={mod.id === 'shop' ? PackageX : Lock}
        tone="muted"
        title={`${mod.label} është i çaktivizuar`}
        action={
          <Button asChild variant="outline">
            <Link to="/app/settings">Menaxho modulet</Link>
          </Button>
        }
      >
        Ky modul është çaktivizuar për këtë workspace. Pronari i biznesit mund ta aktivizojë nga
        Cilësimet → Modulet.
      </Shell>
    );
  }

  return <>{children}</>;
};

export default ModuleGate;
