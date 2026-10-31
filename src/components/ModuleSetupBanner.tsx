import React from 'react';
import { Hourglass } from 'lucide-react';
import { useModules } from '../hooks/useModules';

/**
 * Shown on every page while `businesses.moduleSetup === 'pending'`: a self-serve
 * workspace is born with every module locked (src/lib/createTenant.ts) until the
 * platform opens the agreed set from the super-admin console. Without this line
 * the new owner sees a sidebar with Dashboard and Cilësimet and nothing else, and
 * has no idea whether the product is broken or waiting.
 */
const ModuleSetupBanner: React.FC = () => {
  const { moduleSetupPending, loading } = useModules();
  if (loading || !moduleSetupPending) return null;
  return (
    <div className="mx-3 sm:mx-6 mt-3 rounded-lg border border-primary/30 bg-accent-soft/40 px-4 py-2.5 flex items-center gap-2">
      <Hourglass className="w-4 h-4 text-primary shrink-0" />
      <p className="text-body-sm text-foreground min-w-0">
        Workspace-i u krijua. FivoCRM po aktivizon modulet e kontratës suaj — do të njoftoheni me
        email sapo të jenë gati.
      </p>
    </div>
  );
};

export default ModuleSetupBanner;
