import React, { useMemo } from 'react';
import { Plus, X } from 'lucide-react';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import type { ProjectPlannedRole, TeamMember } from '../../types';
import { formatALL } from '../../lib/utils';
import { memberCostRole, roleCostRate, type RateCardRow } from '../../lib/finance/costRates';
import { plannedRolesSummary } from '../../lib/finance/projectBudget';
import { marginStatus, pct, suggestedPrice, type FinanceSettings } from '../../lib/finance/profitabilityCore';

/**
 * "Buxheti i orëve" — the project is budgeted BEFORE it is sold: hours per role
 * × the role's cost rate + other direct costs → planned margin at the asking
 * price, and the price the target margin would require. The cost rate is
 * SNAPSHOTTED into the row (a later raise must not rewrite an old quote); picking
 * a role fills it from the rate card, and it stays editable.
 */
interface Props {
  value: ProjectPlannedRole[];
  onChange: (next: ProjectPlannedRole[]) => void;
  rateCard: RateCardRow[];
  members?: TeamMember[] | null;
  settings: FinanceSettings;
  /** Asking price in ALL (already converted). */
  contractValueAll: number;
  directExpenses: string;
  onDirectExpensesChange: (v: string) => void;
  targetMarginPct: string;
  onTargetMarginChange: (v: string) => void;
  disabled?: boolean;
}

const STATUS_CLS = { healthy: 'text-emerald-600', watch: 'text-amber-600', investigate: 'text-red-600', none: 'text-muted-foreground' } as const;

const PlannedRolesEditor: React.FC<Props> = ({
  value, onChange, rateCard, members, settings, contractValueAll, directExpenses, onDirectExpensesChange, targetMarginPct, onTargetMarginChange, disabled,
}) => {
  const roles = useMemo(() => Array.from(new Set([...rateCard.map(r => r.role), ...value.map(r => r.role)])).sort(), [rateCard, value]);
  const summary = plannedRolesSummary(value);
  const direct = Math.max(0, parseFloat(directExpenses) || 0);
  const plannedCost = summary.laborCost + direct;
  const plannedProfit = contractValueAll - plannedCost;
  const marginPct = pct(plannedProfit, contractValueAll);
  const status = marginStatus(marginPct, settings.marginThresholds);
  const target = parseFloat(targetMarginPct);
  const price = target > 0 && plannedCost > 0 ? suggestedPrice(plannedCost, target) : 0;

  const patch = (i: number, p: Partial<ProjectPlannedRole>) => {
    const next = value.map((r, idx) => (idx === i ? { ...r, ...p } : r));
    onChange(next);
  };
  const setRole = (i: number, role: string) => {
    const rate = roleCostRate(rateCard, role);
    patch(i, { role, ...(rate > 0 ? { costRate: rate } : {}) });
  };
  const setPerson = (i: number, userId: string) => {
    const m = (members || []).find(x => x.userId === userId);
    if (!m) { patch(i, { userId: undefined }); return; }
    const role = memberCostRole(m);
    const rate = roleCostRate(rateCard, role);
    patch(i, { userId, role: value[i].role || role, ...(rate > 0 && !value[i].costRate ? { costRate: rate } : {}) });
  };

  return (
    <div className="rounded-lg border p-3 space-y-3">
      <div>
        <p className="text-sm font-medium">Buxheti i orëve (plani i ekipit)</p>
        <p className="text-xs text-muted-foreground">
          Orë për rol × kosto/orë. Kjo është kostoja që projekti duhet të mbajë; realja krahasohet me këtë çdo ditë.
        </p>
      </div>

      {value.length > 0 && (
        <div className="space-y-2">
          <div className="hidden sm:grid grid-cols-[1.3fr_1.2fr_.7fr_.9fr_.9fr_24px] gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
            <span>Roli</span><span>Personi (ops.)</span><span className="text-right">Orë</span><span className="text-right">Kosto/orë</span><span className="text-right">Kosto</span><span />
          </div>
          {value.map((r, i) => (
            <div key={i} className="grid grid-cols-2 sm:grid-cols-[1.3fr_1.2fr_.7fr_.9fr_.9fr_24px] gap-2 items-center">
              <Input list="planned-roles" value={r.role} disabled={disabled} placeholder="p.sh. SMM"
                onChange={e => setRole(i, e.target.value)} className="h-8 text-sm" />
              <select value={r.userId || ''} disabled={disabled} onChange={e => setPerson(i, e.target.value)}
                className="h-8 rounded-md border border-input bg-background px-2 text-sm">
                <option value="">— cilido —</option>
                {(members || []).filter(m => m.status === 'Active').map(m => (
                  <option key={m.userId} value={m.userId}>{m.displayName || m.email} · {memberCostRole(m)}</option>
                ))}
              </select>
              <Input type="number" min="0" step="0.5" value={r.plannedHours || ''} disabled={disabled} placeholder="orë"
                onChange={e => patch(i, { plannedHours: parseFloat(e.target.value) || 0 })} className="h-8 text-right text-sm" />
              <Input type="number" min="0" step="1" value={r.costRate || ''} disabled={disabled} placeholder="L/orë"
                onChange={e => patch(i, { costRate: parseFloat(e.target.value) || 0 })} className="h-8 text-right text-sm" />
              <span className="text-right font-mono text-sm tabular-nums">{formatALL(Math.round((r.plannedHours || 0) * (r.costRate || 0)))}</span>
              <button type="button" disabled={disabled} onClick={() => onChange(value.filter((_, idx) => idx !== i))}
                className="text-muted-foreground hover:text-red-600 justify-self-end" aria-label="Hiq rreshtin"><X className="h-4 w-4" /></button>
            </div>
          ))}
          <datalist id="planned-roles">{roles.map(r => <option key={r} value={r} />)}</datalist>
        </div>
      )}

      <button type="button" disabled={disabled}
        onClick={() => onChange([...value, { role: '', plannedHours: 0, costRate: 0 }])}
        className="flex items-center gap-1 text-xs font-medium text-primary hover:underline">
        <Plus className="h-3.5 w-3.5" /> Shto rol
      </button>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Kosto të tjera direkte (L)</Label>
          <Input type="number" min="0" step="100" value={directExpenses} disabled={disabled} placeholder="freelancer, transport…"
            onChange={e => onDirectExpensesChange(e.target.value)} className="h-8 text-sm" />
        </div>
        <div>
          <Label className="text-xs">Marzh objektiv (%)</Label>
          <Input type="number" min="0" max="95" step="1" value={targetMarginPct} disabled={disabled} placeholder={String(settings.marginThresholds.healthy)}
            onChange={e => onTargetMarginChange(e.target.value)} className="h-8 text-sm" />
        </div>
      </div>

      {(value.length > 0 || direct > 0) && (
        <div className="rounded-md bg-muted/40 px-3 py-2 text-xs space-y-1">
          <div className="flex justify-between"><span>Orë të planifikuara</span><span className="font-mono tabular-nums">{summary.hours} h</span></div>
          <div className="flex justify-between"><span>Kosto e punës + direkte</span><span className="font-mono tabular-nums">{formatALL(Math.round(plannedCost))}</span></div>
          {contractValueAll > 0 && (
            <div className={`flex justify-between font-semibold ${STATUS_CLS[status]}`}>
              <span>Marzhi i planifikuar me çmimin aktual</span>
              <span className="font-mono tabular-nums">{marginPct == null ? '—' : `${Math.round(marginPct * 10) / 10} %`} ({formatALL(Math.round(plannedProfit))})</span>
            </div>
          )}
          {price > 0 && (
            <div className="flex justify-between text-foreground">
              <span>Çmimi për {target} % marzh</span>
              <span className="font-mono font-semibold tabular-nums">{formatALL(Math.round(price))}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default PlannedRolesEditor;
