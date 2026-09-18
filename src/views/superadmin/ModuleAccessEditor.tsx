import React, { useMemo } from 'react';
import { Loader2, Lock, LockOpen, EyeOff, Sparkles } from 'lucide-react';
import { Switch } from '../../components/ui/switch';
import { MODULES, PLAN_LABELS, groupedOptionalModules, planIncludes, type ModuleDef } from '../../lib/modules';

/**
 * The platform's side of module access — ONE control per module: "is it available
 * to this tenant?" (checked = not in `lockedModules`).
 *
 * Two layers, two owners:
 *   • the switch here is the VENDOR's decision (entitlement, `businesses.lockedModules`,
 *     server-written, the owner cannot undo it);
 *   • what the OWNER did with an available module (`disabledModules`) is shown as
 *     information — "Fikur nga pronari" — with an optional one-click assist, because
 *     that is a support action, not a licensing one.
 *
 * Used by the tenant page and the create-tenant dialog, so the two never drift.
 */
export interface ModuleAccessEditorProps {
  plan: string;
  /** Layer 1 — module paths withheld by the platform. */
  locked: Set<string>;
  /** Layer 2 — module paths the owner switched off (informational). */
  disabled?: Set<string>;
  onToggleLocked: (path: string, nextLocked: boolean) => void;
  /** Support assist: clear the owner's own "off" for this module. Omit to hide. */
  onEnableForOwner?: (path: string) => void;
  /** Path currently being written — shows a spinner and blocks double-clicks. */
  pending?: string | null;
  /** Bulk preset: replace the whole locked set at once. Omit to hide the presets. */
  onReplaceLocked?: (nextLocked: Set<string>) => void;
  /** Tighter rows for the create dialog. */
  compact?: boolean;
}

const PLAN_TONE_ABOVE = 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800';
const PLAN_TONE_OK = 'text-muted-foreground border-border';

const ModuleAccessEditor: React.FC<ModuleAccessEditorProps> = ({
  plan, locked, disabled, onToggleLocked, onEnableForOwner, pending, onReplaceLocked, compact,
}) => {
  const groups = useMemo(() => groupedOptionalModules(), []);
  const optional = useMemo(() => MODULES.filter(m => m.optional), []);
  const availableCount = optional.filter(m => !locked.has(m.path)).length;
  const abovePlanAvailable = optional.filter(m => !locked.has(m.path) && !planIncludes(plan, m.minPlan));

  const preset = (fn: (m: ModuleDef) => boolean) => {
    if (!onReplaceLocked) return;
    onReplaceLocked(new Set(optional.filter(fn).map(m => m.path)));
  };

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      {/* Header: the one number that matters + presets */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2 bg-muted/40 border-b border-border">
        <div className="flex items-center gap-2">
          <LockOpen className="h-3.5 w-3.5 text-primary" />
          <span className="text-xs font-semibold">Të disponueshme</span>
          <span className="text-xs tabular-nums text-muted-foreground">{availableCount}/{optional.length}</span>
        </div>
        {onReplaceLocked && (
          <div className="ml-auto flex items-center gap-1 text-[11px]">
            <button type="button" className="text-primary hover:underline" onClick={() => preset(() => false)}>
              Hap të gjitha
            </button>
            <span className="text-muted-foreground">·</span>
            <button
              type="button"
              className="text-primary hover:underline"
              title="Kyç vetëm modulet mbi paketën e zgjedhur — ato hapen vetëm me upgrade të vetëdijshëm."
              onClick={() => preset(m => !planIncludes(plan, m.minPlan))}
            >
              Sipas paketës
            </button>
            <span className="text-muted-foreground">·</span>
            <button type="button" className="text-primary hover:underline" onClick={() => preset(() => true)}>
              Kyç të gjitha
            </button>
          </div>
        )}
      </div>

      <div className={`${compact ? 'max-h-72' : ''} overflow-y-auto divide-y divide-border`}>
        {groups.map(({ group, modules }) => (
          <section key={group} className={compact ? 'px-3 py-2' : 'px-3 py-2.5'}>
            <h4 className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">{group}</h4>
            <ul className={compact ? 'space-y-1' : 'space-y-1.5'}>
              {modules.map(m => {
                const isLocked = locked.has(m.path);
                const abovePlan = !planIncludes(plan, m.minPlan);
                const ownerOff = !isLocked && !!disabled?.has(m.path);
                const busy = pending === m.path;
                return (
                  <li
                    key={m.path}
                    className={`flex items-center gap-3 rounded-md ${compact ? 'py-0.5' : 'py-1'} ${isLocked ? 'opacity-70' : ''}`}
                  >
                    {busy
                      ? <Loader2 className="h-4 w-9 shrink-0 animate-spin text-muted-foreground" />
                      : (
                        <Switch
                          checked={!isLocked}
                          onCheckedChange={v => onToggleLocked(m.path, !v)}
                          disabled={!!pending}
                          aria-label={`${isLocked ? 'Hap' : 'Kyç'} ${m.label}`}
                        />
                      )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className={`text-xs font-medium truncate ${isLocked ? 'text-muted-foreground' : 'text-foreground'}`}>
                          {m.label}
                        </span>
                        <span
                          className={`inline-flex items-center gap-1 text-[10px] rounded-full px-1.5 py-px border shrink-0 ${abovePlan ? PLAN_TONE_ABOVE : PLAN_TONE_OK}`}
                          title={abovePlan ? `Kërkon paketën ${PLAN_LABELS[m.minPlan]} — plani e mban të mbyllur edhe kur është e disponueshme.` : `Përfshihet nga paketa ${PLAN_LABELS[m.minPlan]}`}
                        >
                          {abovePlan && <Sparkles className="h-2.5 w-2.5" />}
                          {PLAN_LABELS[m.minPlan]}
                        </span>
                      </div>
                      {!compact && (
                        <p className="text-[11px] text-muted-foreground truncate" title={m.description}>{m.description}</p>
                      )}
                    </div>
                    <div className="shrink-0 flex items-center gap-1.5 text-[11px]">
                      {isLocked && (
                        <span className="inline-flex items-center gap-1 text-muted-foreground">
                          <Lock className="h-3 w-3" /> E kyçur
                        </span>
                      )}
                      {ownerOff && (
                        <>
                          <span className="inline-flex items-center gap-1 text-muted-foreground" title="Pronari e ka fikur nga Cilësimet → Modulet. E disponueshme, por e padukshme për ekipin.">
                            <EyeOff className="h-3 w-3" /> Fikur nga pronari
                          </span>
                          {onEnableForOwner && (
                            <button
                              type="button"
                              className="text-primary hover:underline disabled:opacity-50"
                              disabled={!!pending}
                              onClick={() => onEnableForOwner(m.path)}
                            >
                              Ndize
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      <div className="px-3 py-2 border-t border-border bg-muted/20 space-y-1">
        <p className="text-[11px] text-muted-foreground">
          Çelësi = e përfshirë në kontratën e tenantit. Pronari zgjedh më pas çfarë shfaq nga
          Cilësimet → Modulet, por nuk mund të hapë një modul të kyçur.
        </p>
        {abovePlanAvailable.length > 0 && (
          <p className="text-[11px] text-amber-700 dark:text-amber-300">
            {abovePlanAvailable.length} modul{abovePlanAvailable.length === 1 ? '' : 'e'} të disponueshme janë mbi paketën{' '}
            <strong>{PLAN_LABELS[plan as keyof typeof PLAN_LABELS] || plan}</strong> — hapen vetë sapo plani ngrihet.
          </p>
        )}
      </div>
    </div>
  );
};

export default ModuleAccessEditor;
