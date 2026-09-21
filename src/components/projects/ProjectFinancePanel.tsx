import React, { useMemo, useState } from 'react';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import type { Invoice, Project, TeamMember, TimeEntry } from '../../types';
import { cn, formatALL } from '../../lib/utils';
import { laborForEntries } from '../../lib/finance/laborAllocation';
import { planVsActual, plannedEconomics, projectEac } from '../../lib/finance/projectBudget';
import { projectWip, RECOGNITION_METHOD_LABELS } from '../../lib/finance/revenueRecognition';
import { resolveFinanceSettings, type FinanceSettings } from '../../lib/finance/profitabilityCore';
import type { RateCardRole } from '../../lib/finance/costRates';

/**
 * Projekti → Financat: the four figures (contract / earned / invoiced / collected),
 * plan vs actual per role, the budget-consumed bar with the 70/85/100 marks and
 * the estimate at completion. "Përditëso orët e mbetura" is the PM's one input:
 * it stretches the EAC and the effort-based revenue denominator.
 */
interface Props {
  project: Project;
  entries: TimeEntry[] | null | undefined;
  members: TeamMember[] | null | undefined;
  directExpensesToDate: number;
  invoices: Invoice[] | null | undefined;
  settings?: Partial<FinanceSettings> | null;
  rateCard?: RateCardRole[] | null;
  canEdit: boolean;
  onUpdateRemainingHours?: (hours: number | null) => Promise<void> | void;
}

const CARD = 'rounded-[20px] border border-brand-line bg-white shadow-[0_1px_3px_rgba(8,24,58,.05)]';
const NUM = 'font-mono tabular-nums';
const h1 = (h: number) => (Math.round(h * 10) / 10).toLocaleString('sq-AL');
const pctTxt = (v: number | null) => (v == null ? '—' : `${Math.round(v)} %`);

const ProjectFinancePanel: React.FC<Props> = ({ project, entries, members, directExpensesToDate, invoices, settings: raw, rateCard, canEdit, onUpdateRemainingHours }) => {
  const settings = useMemo(() => resolveFinanceSettings(raw), [raw]);
  const labor = useMemo(() => laborForEntries(entries, members, settings, rateCard, project.id), [entries, members, settings, rateCard, project.id]);
  const plan = useMemo(() => plannedEconomics(project, settings), [project, settings]);
  const pva = useMemo(() => planVsActual(project, labor, settings), [project, labor, settings]);
  const eac = useMemo(() => projectEac(project, labor, directExpensesToDate, settings), [project, labor, directExpensesToDate, settings]);
  const wip = useMemo(() => projectWip(project, entries, invoices, new Date()), [project, entries, invoices]);
  const [remaining, setRemaining] = useState(project.remainingHoursEstimate != null ? String(project.remainingHoursEstimate) : '');
  const [saving, setSaving] = useState(false);
  const oneTime = (project.billingType || (project.isRecurring ? 'monthly' : 'one-time')) === 'one-time';
  const consumed = pva.consumedPct;
  const marks = settings.budgetAlertThresholds;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* Four figures */}
      <section className={cn(CARD, 'px-6 py-5')}>
        <h2 className="text-[15px] font-extrabold text-brand-navy">Kontrata · Fituar · Faturuar · Arkëtuar</h2>
        <p className="mt-0.5 text-xs text-brand-muted">Njohja: {RECOGNITION_METHOD_LABELS[wip.method]}</p>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Fig label={oneTime ? 'Vlera e kontratës' : 'Fituar deri sot (tarifa × muaj)'} v={wip.contractValue} />
          <Fig label="Të ardhura të fituara" v={wip.earnedToDate} sub={wip.percentComplete == null ? undefined : `${Math.round(wip.percentComplete)} % e punës`} tone="navy" />
          <Fig label="Faturuar" v={wip.billedToDate} sub={wip.unbilledEarned > 0 ? `${formatALL(Math.round(wip.unbilledEarned))} punë e pafaturuar` : wip.deferred > 0 ? `${formatALL(Math.round(wip.deferred))} faturuar përpara punës` : undefined} />
          <Fig label="Arkëtuar" v={wip.collectedToDate} tone="pos" sub={wip.billedToDate - wip.collectedToDate > 0 ? `${formatALL(Math.round(wip.billedToDate - wip.collectedToDate))} pa arkëtuar` : undefined} />
        </div>
      </section>

      {/* Plan vs actual + EAC */}
      <section className={cn(CARD, 'px-6 py-5', pva.level === 'stop' && 'border-brand-neg-line')}>
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-[15px] font-extrabold text-brand-navy">Plani vs realja</h2>
          <span className={cn('text-[12.5px] font-bold', NUM, pva.level === 'stop' ? 'text-brand-neg-ink' : pva.level === 'review' ? 'text-orange-700' : pva.level === 'warning' ? 'text-brand-warn-ink' : 'text-brand-ink')}>
            {consumed == null ? `${h1(labor.hours)} h` : `${Math.round(consumed)} % e buxhetit`}
          </span>
        </div>
        {plan.plannedHours === 0 ? (
          <p className="mt-3 rounded-xl border border-brand-warn-line bg-brand-warn-tint px-3.5 py-2.5 text-[12.5px] font-bold text-brand-warn-ink">
            Projekti s'ka buxhet orësh. Pa plan nuk ka "mbi buxhet", nuk ka EAC dhe të ardhurat e projektit fiks njihen vetëm në mbyllje. Shto rolet dhe orët te "Ndrysho projektin".
          </p>
        ) : (
          <>
            <div className="relative mt-3.5 h-2.5 overflow-visible rounded-full bg-brand-line-soft">
              <div className={cn('h-full rounded-full transition-all', pva.level === 'stop' ? 'bg-brand-neg' : pva.level !== 'ok' ? 'bg-brand-warn' : 'bg-brand-blue')} style={{ width: `${Math.min(100, consumed || 0)}%` }} />
              {marks.filter(m => m <= 100).map(m => (
                <span key={m} className="absolute -top-1 h-4 w-px bg-brand-navy/40" style={{ left: `${m}%` }} title={`${m} %`} />
              ))}
            </div>
            <div className="mt-1 flex justify-between text-[10.5px] text-brand-muted">
              <span>0</span>{marks.filter(m => m <= 100).map(m => <span key={m}>{m} %</span>)}
            </div>
            <table className="mt-3 w-full text-[12.5px]">
              <thead>
                <tr className="text-[10.5px] font-extrabold uppercase tracking-[.08em] text-brand-muted">
                  <th className="py-1 text-left">Roli</th><th className="py-1 text-right">Plan</th><th className="py-1 text-right">Real</th><th className="py-1 text-right">Kosto</th>
                </tr>
              </thead>
              <tbody>
                {pva.roles.map(r => (
                  <tr key={r.role} className="border-t border-brand-line-soft">
                    <td className="py-1.5 font-semibold text-brand-ink">{r.role}{r.over && <span className="ml-1 text-brand-neg-ink">⚠</span>}</td>
                    <td className={cn('py-1.5 text-right', NUM)}>{r.plannedHours ? `${h1(r.plannedHours)} h` : '—'}</td>
                    <td className={cn('py-1.5 text-right font-bold', NUM, r.over ? 'text-brand-neg-ink' : 'text-brand-ink')}>{h1(r.actualHours)} h{r.consumedPct != null && <span className="ml-1 font-normal text-brand-muted">({Math.round(r.consumedPct)} %)</span>}</td>
                    <td className={cn('py-1.5 text-right', NUM)}>{formatALL(Math.round(r.actualCost))}<span className="text-brand-muted"> / {formatALL(Math.round(r.plannedCost))}</span></td>
                  </tr>
                ))}
                <tr className="border-t-2 border-brand-line font-extrabold text-brand-navy">
                  <td className="py-1.5">Gjithsej</td>
                  <td className={cn('py-1.5 text-right', NUM)}>{h1(pva.plannedHours)} h</td>
                  <td className={cn('py-1.5 text-right', NUM, pva.actualHours > pva.plannedHours && 'text-brand-neg-ink')}>{h1(pva.actualHours)} h</td>
                  <td className={cn('py-1.5 text-right', NUM)}>{formatALL(Math.round(pva.actualCost))}<span className="text-brand-muted"> / {formatALL(Math.round(pva.plannedCost))}</span></td>
                </tr>
              </tbody>
            </table>
            {pva.overrunRoles.length > 0 && (
              <p className="mt-2 text-[12px] font-bold text-brand-neg-ink">Mbi plan: {pva.overrunRoles.join(', ')} — problemi është këtu, jo te çmimi.</p>
            )}

            {oneTime && (
              <div className="mt-4 rounded-xl border border-brand-line-soft bg-brand-surface px-3.5 py-3">
                <p className="text-[10.5px] font-extrabold uppercase tracking-[.08em] text-brand-muted">Parashikimi në mbyllje (EAC)</p>
                <div className="mt-1.5 grid grid-cols-2 gap-2 text-[12.5px]">
                  <span className="text-brand-muted">Kosto deri sot</span><span className={cn('text-right', NUM)}>{formatALL(Math.round(labor.cost + directExpensesToDate))}</span>
                  <span className="text-brand-muted">+ {h1(eac.remainingHours)} h të mbetura</span><span className={cn('text-right', NUM)}>{formatALL(Math.round(eac.remainingCost))}</span>
                  <span className="font-bold text-brand-ink">= Kosto në mbyllje</span><span className={cn('text-right font-bold', NUM)}>{formatALL(Math.round(eac.eacCost))}</span>
                  <span className="font-bold text-brand-ink">Fitimi i pritur</span>
                  <span className={cn('text-right font-extrabold', NUM, eac.expectedProfit >= 0 ? 'text-brand-pos' : 'text-brand-neg-ink')}>{formatALL(Math.round(eac.expectedProfit))} <span className="font-semibold">({pctTxt(eac.expectedMarginPct)})</span></span>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <label className="text-[12px] text-brand-muted" htmlFor="remaining-h">Orë të mbetura (vlerësimi i PM-së)</label>
                  <Input id="remaining-h" type="number" min="0" step="1" value={remaining} disabled={!canEdit || saving} onChange={e => setRemaining(e.target.value)} className="h-8 w-24 text-right" placeholder={String(Math.max(0, plan.plannedHours - labor.hours))} />
                  {canEdit && onUpdateRemainingHours && (
                    <Button size="sm" variant="outline" disabled={saving} onClick={async () => {
                      setSaving(true);
                      try { await onUpdateRemainingHours(remaining.trim() === '' ? null : Math.max(0, parseFloat(remaining) || 0)); } finally { setSaving(false); }
                    }}>Përditëso</Button>
                  )}
                  {project.remainingHoursUpdatedAt && <span className="text-[11px] text-brand-muted">përditësuar {new Date(project.remainingHoursUpdatedAt as any).toLocaleDateString('sq-AL')}</span>}
                </div>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
};

const Fig: React.FC<{ label: string; v: number; sub?: string; tone?: 'pos' | 'navy' }> = ({ label, v, sub, tone }) => (
  <div className="rounded-xl border border-brand-line-soft px-3.5 py-2.5">
    <p className="text-[10.5px] font-extrabold uppercase tracking-[.08em] text-brand-muted">{label}</p>
    <p className={cn('mt-0.5 text-[15px] font-extrabold', NUM, tone === 'pos' ? 'text-brand-pos' : 'text-brand-navy')}>{formatALL(Math.round(v))}</p>
    {sub && <p className="text-[11px] text-brand-muted">{sub}</p>}
  </div>
);

export default ProjectFinancePanel;
