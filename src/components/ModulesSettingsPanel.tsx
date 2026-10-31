import React, { useMemo, useState } from 'react';
import { Info, Loader2, Lock, ShieldCheck, Sparkles } from 'lucide-react';
import { Card } from './ui/card';
import { Badge } from './ui/badge';
import { Switch } from './ui/switch';
import { useToast } from '../hooks/use-toast';
import { useModules } from '../hooks/useModules';
import { MODULES, MODULE_GROUP_ORDER, PLAN_LABELS, planIncludes, type ModuleDef, type PlanKey } from '../lib/modules';

/**
 * Tenant-facing module manager (Cilësimet → Modulet).
 *
 * Turning a module off hides it everywhere and blocks its routes — nothing is
 * deleted, so re-enabling brings the data straight back. Only the business OWNER
 * can write `businesses/{id}` per the Firestore rules, so anyone else sees the
 * same list read-only rather than a switch that silently fails.
 *
 * A module the PLATFORM withheld (`lockedModules`) is shown, not hidden: the owner
 * should know it exists and whom to ask — but its switch is inert, and the row says
 * so instead of pretending to be a setting.
 */
const ModulesSettingsPanel: React.FC = () => {
  const { toast } = useToast();
  const { plan, disabledModules, lockedModules, canManage, isEnabled, blockReason, setModuleEnabled, loading, moduleSetupPending } = useModules();
  const [pending, setPending] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const map = new Map<ModuleDef['group'], ModuleDef[]>();
    for (const mod of MODULES) {
      if (!map.has(mod.group)) map.set(mod.group, []);
      map.get(mod.group)!.push(mod);
    }
    return MODULE_GROUP_ORDER.filter(g => map.has(g)).map(g => ({ group: g, modules: map.get(g)! }));
  }, []);

  const activeCount = MODULES.filter(m => isEnabled(m.id)).length;
  const lockedCount = MODULES.filter(m => lockedModules.includes(m.path)).length;

  const toggle = async (mod: ModuleDef, next: boolean) => {
    setPending(mod.id);
    try {
      await setModuleEnabled(mod.id, next);
      toast({
        title: next ? `${mod.label} u aktivizua` : `${mod.label} u çaktivizua`,
        description: next
          ? 'Moduli shfaqet menjëherë në menu.'
          : 'Të dhënat ruhen — riaktivizoje kurdo.',
      });
    } catch (err: any) {
      toast({ title: 'Ndryshimi dështoi', description: err?.message || 'Provo përsëri.', variant: 'destructive' });
    } finally {
      setPending(null);
    }
  };

  if (loading) {
    return (
      <Card className="p-8 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="p-4 flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1">
          <h3 className="text-h4 text-foreground">Modulet</h3>
          <p className="text-body-sm text-muted-foreground">
            Aktivizo vetëm ato që përdor ekipi — menuja qëndron e pastër dhe rrugët e tjera bllokohen.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Badge className="bg-accent-soft text-primary">Plani {PLAN_LABELS[plan as PlanKey] || plan}</Badge>
          <Badge variant="outline">{activeCount}/{MODULES.length} aktive</Badge>
          {lockedCount > 0 && (
            <Badge variant="outline" className="gap-1 text-muted-foreground">
              <Lock className="w-3 h-3" />{lockedCount} jashtë kontratës
            </Badge>
          )}
        </div>
      </Card>

      {moduleSetupPending && (
        <div className="flex items-start gap-2 rounded-lg border border-primary/30 bg-accent-soft/40 p-3">
          <Lock className="w-4 h-4 text-primary mt-0.5 shrink-0" />
          <p className="text-xs text-foreground">
            Modulet e këtij workspace-i po aktivizohen nga FivoCRM sipas kontratës suaj. Derisa të
            përfundojë, çdo modul shfaqet si i kyçur — do të njoftoheni me email sapo të jenë gati.
          </p>
        </div>
      )}

      {!canManage && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
          <ShieldCheck className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
          <p className="text-xs text-amber-700 dark:text-amber-300">
            Vetëm pronari i biznesit mund të ndryshojë modulet. Kjo listë është vetëm për lexim.
          </p>
        </div>
      )}

      {grouped.map(({ group, modules }) => (
        <Card key={group} className="p-4">
          <h4 className="text-sm font-semibold text-foreground mb-3">{group}</h4>
          <div className="space-y-2">
            {modules.map(mod => {
              const reason = blockReason(mod.id);
              const locked = lockedModules.includes(mod.path);
              const planLocked = !planIncludes(plan, mod.minPlan);
              const off = disabledModules.includes(mod.path);
              const noPermission = reason === 'permission';
              return (
                <div
                  key={mod.id}
                  className={`flex items-start justify-between gap-3 rounded-lg border p-3 ${locked ? 'bg-muted/30' : ''}`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className={`text-sm font-medium ${locked ? 'text-muted-foreground' : 'text-foreground'}`}>{mod.label}</p>
                      {locked && (
                        <Badge variant="outline" className="gap-1 text-muted-foreground">
                          <Lock className="w-3 h-3" />E menaxhuar nga FivoCRM
                        </Badge>
                      )}
                      {planLocked && !locked && (
                        <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 gap-1">
                          <Sparkles className="w-3 h-3" />{PLAN_LABELS[mod.minPlan]}
                        </Badge>
                      )}
                      {!mod.optional && (
                        <Badge variant="outline" className="gap-1"><Lock className="w-3 h-3" />Bazë</Badge>
                      )}
                      {noPermission && !planLocked && !locked && (
                        <Badge variant="outline" className="gap-1">
                          <Info className="w-3 h-3" />Pa leje për rolin tuaj
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{mod.description}</p>
                    {locked ? (
                      <p className="text-[11px] text-muted-foreground mt-1">
                        Nuk përfshihet në kontratën tuaj — kontaktoni FivoCRM për ta shtuar.
                      </p>
                    ) : planLocked && !off ? (
                      <p className="text-[11px] text-amber-700 dark:text-amber-400 mt-1">
                        I aktivizuar, por i kyçur nga plani aktual — bëj upgrade për t'i hapur.
                      </p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2 shrink-0 pt-0.5">
                    {pending === mod.id && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
                    <Switch
                      checked={locked ? false : !off}
                      disabled={locked || !canManage || !mod.optional || pending === mod.id}
                      onCheckedChange={v => toggle(mod, v)}
                      aria-label={locked ? `${mod.label} — e menaxhuar nga FivoCRM` : `${mod.label} aktiv`}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      ))}
    </div>
  );
};

export default ModulesSettingsPanel;
