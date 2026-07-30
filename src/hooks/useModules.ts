import { useCallback, useMemo } from 'react';
import { doc, updateDoc, Timestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../contexts/PermissionsContext';
import { useDocument, useGlobalBusinessId } from './useFirestore';
import {
  MODULES,
  MODULE_BY_ID,
  findModuleForPath,
  moduleBlockReason,
  type ModuleBlockReason,
  type ModuleDef,
  type PlanKey,
} from '../lib/modules';
import type { Business } from '../types';

export interface ModuleAccess {
  /** The tenant's subscription tier. Defaults to 'trial' while unknown. */
  plan: PlanKey;
  status?: Business['status'];
  disabledModules: string[];
  loading: boolean;
  /**
   * Whether this user may flip module toggles. Firestore rules only let the
   * business OWNER (or a super-admin) write `businesses/{id}`, so an Admin who
   * isn't the owner gets a read-only module manager rather than a failing write.
   */
  canManage: boolean;
  modules: ModuleDef[];
  isEnabled: (idOrPath: string) => boolean;
  blockReason: (idOrPath: string) => ModuleBlockReason;
  setModuleEnabled: (moduleId: string, enabled: boolean) => Promise<void>;
}

/** Resolve a module from either its id ('shop') or a route ('/app/products'). */
function resolveModule(idOrPath: string): ModuleDef | undefined {
  return MODULE_BY_ID[idOrPath] || findModuleForPath(idOrPath);
}

/**
 * Single entry point for module availability: role permission + SaaS plan +
 * per-tenant toggle, resolved against `businesses/{businessId}`.
 *
 * The Sidebar, <ModuleGate> and the module manager in Cilësimet all read from
 * here, so nav visibility and route access can't diverge.
 */
export function useModules(): ModuleAccess {
  const permissions = usePermissions();
  const { user } = useAuth();
  const businessId = useGlobalBusinessId();
  const { data: business, loading } = useDocument<Business>('businesses', businessId || undefined);

  const plan = ((business as any)?.plan as PlanKey) || 'trial';
  const disabledModules = useMemo(
    () => ((business as any)?.disabledModules as string[] | undefined) || [],
    [business],
  );

  const isSuperAdmin = permissions.isSuperAdmin === true;
  const canManage = isSuperAdmin || (!!user && (business as any)?.ownerId === user.uid);

  const blockReason = useCallback(
    (idOrPath: string): ModuleBlockReason => {
      const mod = resolveModule(idOrPath);
      if (!mod) return null; // unregistered route → not module-gated
      return moduleBlockReason(mod, {
        plan,
        disabledModules,
        isSuperAdmin,
        permissions: permissions as unknown as Record<string, any>,
      });
    },
    [plan, disabledModules, isSuperAdmin, permissions],
  );

  const isEnabled = useCallback((idOrPath: string) => blockReason(idOrPath) === null, [blockReason]);

  const setModuleEnabled = useCallback(
    async (moduleId: string, enabled: boolean) => {
      const mod = MODULE_BY_ID[moduleId];
      if (!mod) throw new Error(`Moduli "${moduleId}" nuk njihet.`);
      if (!mod.optional) throw new Error(`Moduli "${mod.label}" është bazë dhe nuk çaktivizohet.`);
      if (!businessId) throw new Error('Nuk u zgjidh biznesi aktiv.');
      const next = new Set(disabledModules);
      if (enabled) next.delete(mod.path);
      else next.add(mod.path);
      await updateDoc(doc(db, 'businesses', businessId), {
        disabledModules: Array.from(next),
        updatedAt: Timestamp.now(),
      });
    },
    [businessId, disabledModules],
  );

  return {
    plan,
    status: (business as any)?.status,
    disabledModules,
    // A super-admin has no active business doc to read — never keep them waiting.
    loading: isSuperAdmin ? false : (permissions.isLoading || (!!businessId && loading)),
    canManage,
    modules: MODULES,
    isEnabled,
    blockReason,
    setModuleEnabled,
  };
}

export default useModules;
