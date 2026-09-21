import React, { useMemo, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, Download, Lock, Printer } from 'lucide-react';
import { cn, formatALL } from '../../lib/utils';
import { saveOrShareFile } from '../../lib/native';
import type { ClientProfitabilityResult, ClientRow, ClientProjectLine } from '../../lib/finance/clientProfitability';
import { RECOGNITION_METHOD_LABELS } from '../../lib/finance/revenueRecognition';
import type { BudgetAlertLevel, MarginStatus } from '../../lib/finance/profitabilityCore';

/**
 * Financat → Fitimi (tabela e klientëve). The table the owner opens on the 1st of the month:
 * earned · direct cost · GROSS PROFIT · overhead · net · hours · L/h · cash.
 * Gross margin is the decision figure and carries the colour; cash is a separate
 * column set. Every row unfolds to its projects (method, plan vs actual alarm,
 * EAC margin) and every project to the roles and people whose hours it cost.
 *
 * `basis` is always shown: with no logged hours the table is an estimate and
 * says so — never a silent fallback.
 */
interface Props {
  result: ClientProfitabilityResult;
  periodLabel: string;
  /** `YYYY-MM` when the period is one month (enables "Mbyll muajin"). */
  monthKey: string | null;
  closeState?: { locked: boolean; closedAt?: Date | null } | null;
  canClose: boolean;
  onCloseMonth?: () => void;
  onOpenCustomer?: (customerId: string) => void;
}

const NUM = 'font-mono tabular-nums';
const STATUS_INK: Record<MarginStatus, string> = {
  healthy: 'text-[#0f8a5f]', watch: 'text-[#9a6b0a]', investigate: 'text-[#d64545]', none: 'text-[#7286a3]',
};
const STATUS_DOT: Record<MarginStatus, string> = { healthy: '🟢', watch: '🟡', investigate: '🔴', none: '⚪' };
const ALERT_LABEL: Record<BudgetAlertLevel, string> = { ok: '', warning: '70 %', review: '85 %', stop: '100 %' };
const ALERT_CLS: Record<BudgetAlertLevel, string> = {
  ok: '', warning: 'bg-amber-50 text-amber-800 border-amber-200', review: 'bg-orange-50 text-orange-800 border-orange-200', stop: 'bg-red-50 text-red-700 border-red-200',
};
const CAT_TITLE: Record<string, string> = {
  A: 'Marzh i lartë, pak fërkim — mbaje dhe rrite', B: 'Marzh i lartë, shumë orë — strategjik, ruaj kohën',
  C: 'Marzh i ulët, pak fërkim — rrit çmimin', D: 'Marzh i ulët, shumë orë — rinegocio ose largohu',
};
const pctTxt = (v: number | null) => (v == null ? '—' : `${Math.round(v)} %`);
const h1 = (h: number) => (Math.round(h * 10) / 10).toLocaleString('sq-AL');

type SortKey = 'netProfit' | 'grossProfit' | 'earned' | 'hours' | 'grossMarginPct' | 'outstanding' | 'effectiveHourlyRevenue';

const ClientProfitabilityPanel: React.FC<Props> = ({ result, periodLabel, monthKey, closeState, canClose, onCloseMonth, onOpenCustomer }) => {
  const [open, setOpen] = useState<string | null>(null);
  const [openProject, setOpenProject] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>('netProfit');
  const [onlyRisk, setOnlyRisk] = useState(false);
  const T = result.totals;
  const C = result.company;
  const s = result.settings;

  const rows = useMemo(() => {
    const list = onlyRisk ? result.rows.filter(r => r.status === 'investigate' || r.netProfit < 0 || r.projectsOverBudget > 0) : result.rows;
    return [...list].sort((a, b) => ((b[sort] ?? -Infinity) as number) - ((a[sort] ?? -Infinity) as number));
  }, [result.rows, sort, onlyRisk]);

  const exportCsv = () => {
    const head = ['Klienti', 'Kategori', 'Të ardhura të fituara', 'Pass-through', 'Punë direkte', 'Orë', 'Kosto direkte', 'Fitimi bruto', 'Marzhi bruto %', 'Overhead', 'Fitimi neto', 'Marzhi neto %', 'L/orë', 'Faturuar', 'Arkëtuar', 'Pa arkëtuar', 'Punë e pafaturuar'];
    const body = result.rows.map(r => [
      r.name, r.category || '', Math.round(r.earned), Math.round(r.passThrough), Math.round(r.directLabor), h1(r.hours), Math.round(r.directExpenses),
      Math.round(r.grossProfit), r.grossMarginPct == null ? '' : Math.round(r.grossMarginPct), Math.round(r.overhead), Math.round(r.netProfit),
      r.netMarginPct == null ? '' : Math.round(r.netMarginPct), r.effectiveHourlyRevenue == null ? '' : Math.round(r.effectiveHourlyRevenue),
      Math.round(r.invoiced), Math.round(r.collected), Math.round(r.outstanding), Math.round(r.unbilledEarned),
    ]);
    const tot = ['Gjithsej', '', Math.round(T.earned), Math.round(T.passThrough), Math.round(T.directLabor), h1(T.hours), Math.round(T.directExpenses), Math.round(T.grossProfit), T.grossMarginPct == null ? '' : Math.round(T.grossMarginPct), Math.round(T.overhead), Math.round(T.netProfit), T.netMarginPct == null ? '' : Math.round(T.netMarginPct), '', Math.round(T.invoiced), Math.round(T.collected), Math.round(T.outstanding), Math.round(T.unbilledEarned)];
    const csv = [head, ...body, tot].map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
    void saveOrShareFile(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' }), `fitimi-klientet-${periodLabel.replace(/\s+/g, '-').toLowerCase()}.csv`, { shareTitle: 'Fitimi për klient - FivoCRM' });
  };

  const basisNote = result.basis === 'none'
    ? 'Asnjë orë e regjistruar në këtë periudhë — puna direkte është 0 dhe gjithë pagat janë overhead. Tabela është vlerësim.'
    : `${h1(T.hours)} orë klientësh · pagat ${C.payrollBasis === 'recorded' ? 'nga pagesat e regjistruara' : C.payrollBasis === 'profile' ? 'nga plani (asgjë e regjistruar)' : C.payrollBasis === 'mixed' ? 'të përziera' : 'mungojnë'} · overhead sipas ${result.overheadBasis === 'labor-hours' ? 'orëve' : 'të ardhurave'}`;

  return (
    <div className="space-y-3.5">
      {/* ── Company line: the whole period, including what no client carries ── */}
      <section className="rounded-[20px] border border-[#e3e9f2] bg-white px-5 py-4 shadow-[0_1px_3px_rgba(8,24,58,.05)] sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-extrabold text-[#08183A]">Fitimi për klient · {periodLabel}</h2>
            <p className={cn('mt-0.5 text-[12.5px]', result.basis === 'none' ? 'font-semibold text-[#9a6b0a]' : 'text-[#7286a3]')}>{basisNote}</p>
          </div>
          <div className="flex items-center gap-2">
            {closeState?.locked ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-[#e3e9f2] bg-[#f4f7fb] px-2.5 py-1 text-[11.5px] font-bold text-[#08183A]">
                <Lock className="h-3 w-3" /> Muaj i mbyllur{closeState.closedAt ? ` · ${closeState.closedAt.toLocaleDateString('sq-AL')}` : ''}
              </span>
            ) : monthKey && canClose && onCloseMonth ? (
              <button type="button" onClick={onCloseMonth} className="inline-flex items-center gap-1.5 rounded-lg border border-[#08183A] px-3 py-1.5 text-xs font-bold text-[#08183A] hover:bg-[#08183A] hover:text-white">
                <Lock className="h-3.5 w-3.5" /> Mbyll muajin
              </button>
            ) : null}
            <button type="button" onClick={exportCsv} className="inline-flex items-center gap-1.5 rounded-lg border border-[#e3e9f2] px-3 py-1.5 text-xs font-bold text-[#08183A] hover:bg-[#f4f7fb]">
              <Download className="h-3.5 w-3.5" /> CSV
            </button>
            <button type="button" onClick={() => window.print()} className="hidden items-center gap-1.5 rounded-lg border border-[#e3e9f2] px-3 py-1.5 text-xs font-bold text-[#08183A] hover:bg-[#f4f7fb] sm:inline-flex">
              <Printer className="h-3.5 w-3.5" /> Printo
            </button>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          <Tile label={result.revenueBasis === 'collected' ? 'Të ardhura (arkëtuar)' : 'Të ardhura të fituara'} value={T.earned} />
          <Tile label="Kosto direkte" value={T.directLabor + T.directExpenses} sub={`punë ${formatALL(Math.round(T.directLabor))}`} />
          <Tile label="Fitimi bruto" value={T.grossProfit} sub={pctTxt(T.grossMarginPct)} tone={T.grossProfit >= 0 ? 'pos' : 'neg'} strong />
          <Tile label="Overhead" value={T.overhead} sub={C.unallocatedOverhead > 0 ? `pa alokuar ${formatALL(Math.round(C.unallocatedOverhead))}` : `pool ${formatALL(Math.round(C.overheadPool))}`} />
          <Tile label="Fitimi neto" value={T.netProfit} sub={pctTxt(T.netMarginPct)} tone={T.netProfit >= 0 ? 'pos' : 'neg'} strong />
          <Tile label="Punë e pafaturuar" value={T.unbilledEarned} sub="e fituar, jo në faturë" />
          <Tile label="Pa arkëtuar (gjithsej)" value={T.outstanding} sub="borxhi total, jo vetëm periudha" tone={T.outstanding > 0 ? 'warn' : undefined} />
        </div>
        <details className="mt-3 text-[12.5px] text-[#7286a3]">
          <summary className="cursor-pointer font-semibold text-[#08183A]">Si lidhet me Financat (rezultati operativ i periudhës)</summary>
          <div className="mt-2 grid gap-1 sm:grid-cols-2">
            <Line k="Pagat e periudhës" v={C.payroll} />
            <Line k="— të absorbuara nga orët e klientëve" v={-C.absorbedLabor} />
            <Line k="— punë e paabsorbuar (bench, mbledhje, pa orë) → overhead" v={-C.unabsorbedLabor} />
            <Line k="Shpenzime pa projekt → overhead" v={C.otherFixed} />
            {C.internalProjectLabor > 0 && <Line k="Punë në projekte të brendshme" v={C.internalProjectLabor} />}
            {C.overAbsorbedLabor > 0 && <Line k="⚠ Orët × tarifat mbi pagën reale" v={C.overAbsorbedLabor} />}
            <Line k="Fitimi operativ i kompanisë" v={C.operatingProfit} strong />
          </div>
          <p className="mt-2">Σ fitimi neto i klientëve + overhead i paalokuar + puna e brendshme = fitimi operativ. Kur çdo orë është orë klienti, dy shifrat përputhen.</p>
        </details>
      </section>

      {/* ── Warnings ── */}
      {(result.warnings.membersWithoutRate.length > 0 || result.warnings.projectsWithoutPlan.length > 0 || result.warnings.unlinkedInvoices.count > 0 || result.warnings.hoursWithoutProject > 0) && (
        <section className="rounded-[14px] border border-amber-200 bg-amber-50 px-4 py-3 text-[12.5px] text-amber-900">
          <p className="mb-1 flex items-center gap-1.5 font-bold"><AlertTriangle className="h-3.5 w-3.5" /> Çfarë e bën tabelën më pak të saktë</p>
          <ul className="list-disc space-y-0.5 pl-5">
            {result.warnings.membersWithoutRate.length > 0 && <li>Pa kosto/orë (vendos pagën te Ekipet): {result.warnings.membersWithoutRate.join(', ')}.</li>}
            {result.warnings.projectsWithoutPlan.length > 0 && <li>Projekte me orë por pa buxhet orësh: {result.warnings.projectsWithoutPlan.slice(0, 4).join(', ')}{result.warnings.projectsWithoutPlan.length > 4 ? '…' : ''}.</li>}
            {result.warnings.hoursWithoutProject > 0 && <li>{h1(result.warnings.hoursWithoutProject)} orë pa projekt (kosto e brendshme, në overhead).</li>}
            {result.warnings.unlinkedInvoices.count > 0 && <li>{result.warnings.unlinkedInvoices.count} fatura pa projekt ({formatALL(Math.round(result.warnings.unlinkedInvoices.amount))}) — faturuar, por asnjë projekt nuk i "fiton".</li>}
          </ul>
        </section>
      )}

      {/* ── Table ── */}
      <section className="overflow-hidden rounded-[20px] border border-[#e3e9f2] bg-white shadow-[0_1px_3px_rgba(8,24,58,.05)]">
        <div className="flex flex-wrap items-center gap-2 px-5 py-3 sm:px-6">
          <span className="text-[11px] font-extrabold uppercase tracking-[.1em] text-[#7286a3]">Rendit sipas</span>
          {([['netProfit', 'Neto'], ['grossProfit', 'Bruto'], ['grossMarginPct', 'Marzh %'], ['earned', 'Të ardhura'], ['hours', 'Orë'], ['effectiveHourlyRevenue', 'L/orë'], ['outstanding', 'Pa arkëtuar']] as const).map(([k, l]) => (
            <button key={k} type="button" onClick={() => setSort(k)}
              className={cn('rounded-lg px-2.5 py-1 text-xs font-bold', sort === k ? 'bg-[#e3ecfb] text-[#2258bb]' : 'text-[#7286a3] hover:bg-[#f4f7fb]')}>{l}</button>
          ))}
          <label className="ml-auto flex items-center gap-1.5 text-xs font-semibold text-[#7286a3]">
            <input type="checkbox" checked={onlyRisk} onChange={e => setOnlyRisk(e.target.checked)} /> Vetëm problematikët
          </label>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-[13px]">
            <thead>
              <tr className="border-y border-[#eef2f8] text-[11px] font-extrabold uppercase tracking-[.08em] text-[#94a5bd]">
                <th className="px-5 py-2.5 text-left sm:px-6">Klienti</th>
                <th className="px-2 py-2.5 text-right">Të ardhura</th>
                <th className="px-2 py-2.5 text-right">Orë</th>
                <th className="px-2 py-2.5 text-right">Kosto direkte</th>
                <th className="px-2 py-2.5 text-right">Fitimi bruto</th>
                <th className="px-2 py-2.5 text-right">GM</th>
                <th className="px-2 py-2.5 text-right">Overhead</th>
                <th className="px-2 py-2.5 text-right">Neto</th>
                <th className="px-2 py-2.5 text-right">L/orë</th>
                <th className="px-2 py-2.5 text-right">Faturuar</th>
                <th className="px-2 py-2.5 text-right">Arkëtuar</th>
                <th className="px-5 py-2.5 text-right sm:px-6" title="Borxhi i klientit sot, gjithë kohës">Pa arkëtuar Σ</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={12} className="px-6 py-8 text-center text-[#7286a3]">Asnjë klient me punë, të ardhura apo fatura në këtë periudhë.</td></tr>
              )}
              {rows.map(r => (
                <React.Fragment key={r.customerId}>
                  <tr className={cn('border-b border-[#eef2f8] hover:bg-[#f9fbfe]', open === r.customerId && 'bg-[#f9fbfe]')}>
                    <td className="px-5 py-2.5 sm:px-6">
                      <button type="button" onClick={() => setOpen(open === r.customerId ? null : r.customerId)} className="flex items-center gap-2 text-left">
                        {open === r.customerId ? <ChevronDown className="h-3.5 w-3.5 text-[#94a5bd]" /> : <ChevronRight className="h-3.5 w-3.5 text-[#94a5bd]" />}
                        <span>{STATUS_DOT[r.status]}</span>
                        <span className="font-bold text-[#08183A]">{r.name}</span>
                        {r.category && <span title={CAT_TITLE[r.category]} className="rounded-md border border-[#e3e9f2] px-1.5 py-px text-[10.5px] font-extrabold text-[#7286a3]">{r.category}</span>}
                        {r.projectsOverBudget > 0 && <span className="rounded-md border border-red-200 bg-red-50 px-1.5 py-px text-[10.5px] font-extrabold text-red-700">{r.projectsOverBudget} mbi buxhet</span>}
                      </button>
                      {onOpenCustomer && <button type="button" onClick={() => onOpenCustomer(r.customerId)} className="ml-7 text-[11px] font-semibold text-[#2f6fe0] hover:underline">kartela →</button>}
                    </td>
                    <Cell v={r.earned} sub={r.passThrough > 0 ? `− ${formatALL(Math.round(r.passThrough))} pass-through` : undefined} />
                    <td className={cn('px-2 py-2.5 text-right', NUM)}>{h1(r.hours)}</td>
                    <Cell v={r.directLabor + r.directExpenses} sub={r.directExpenses > 0 ? `punë ${formatALL(Math.round(r.directLabor))}` : undefined} />
                    <Cell v={r.grossProfit} tone={r.grossProfit >= 0 ? 'pos' : 'neg'} strong />
                    <td className={cn('px-2 py-2.5 text-right font-extrabold', NUM, STATUS_INK[r.status])}>{pctTxt(r.grossMarginPct)}</td>
                    <Cell v={r.overhead} muted />
                    <Cell v={r.netProfit} tone={r.netProfit >= 0 ? 'pos' : 'neg'} strong sub={pctTxt(r.netMarginPct)} />
                    <td className={cn('px-2 py-2.5 text-right', NUM)}>{r.effectiveHourlyRevenue == null ? '—' : formatALL(Math.round(r.effectiveHourlyRevenue))}</td>
                    <Cell v={r.invoiced} muted sub={r.unbilledEarned > 0 ? `+${formatALL(Math.round(r.unbilledEarned))} pa faturuar` : r.deferred > 0 ? `${formatALL(Math.round(r.deferred))} përpara punës` : undefined} />
                    <Cell v={r.collected} muted />
                    <td className={cn('px-5 py-2.5 text-right sm:px-6', NUM, r.outstanding > 0 ? 'font-bold text-[#9a6b0a]' : 'text-[#94a5bd]')}>{formatALL(Math.round(r.outstanding))}</td>
                  </tr>
                  {open === r.customerId && (
                    <tr className="bg-[#f9fbfe]">
                      <td colSpan={12} className="px-5 pb-4 pt-1 sm:px-6">
                        <ClientDetail row={r} openProject={openProject} setOpenProject={setOpenProject} thresholds={s.marginThresholds} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
            {rows.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-[#e3e9f2] bg-[#f4f7fb] text-[13px] font-extrabold text-[#08183A]">
                  <td className="px-5 py-2.5 sm:px-6">Gjithsej ({rows.length})</td>
                  <td className={cn('px-2 py-2.5 text-right', NUM)}>{formatALL(Math.round(T.earned))}</td>
                  <td className={cn('px-2 py-2.5 text-right', NUM)}>{h1(T.hours)}</td>
                  <td className={cn('px-2 py-2.5 text-right', NUM)}>{formatALL(Math.round(T.directLabor + T.directExpenses))}</td>
                  <td className={cn('px-2 py-2.5 text-right', NUM, T.grossProfit >= 0 ? 'text-[#0f8a5f]' : 'text-[#d64545]')}>{formatALL(Math.round(T.grossProfit))}</td>
                  <td className={cn('px-2 py-2.5 text-right', NUM)}>{pctTxt(T.grossMarginPct)}</td>
                  <td className={cn('px-2 py-2.5 text-right', NUM)}>{formatALL(Math.round(T.overhead))}</td>
                  <td className={cn('px-2 py-2.5 text-right', NUM, T.netProfit >= 0 ? 'text-[#0f8a5f]' : 'text-[#d64545]')}>{formatALL(Math.round(T.netProfit))}</td>
                  <td className={cn('px-2 py-2.5 text-right', NUM)}>{T.hours > 0 ? formatALL(Math.round(T.netRevenue / T.hours)) : '—'}</td>
                  <td className={cn('px-2 py-2.5 text-right', NUM)}>{formatALL(Math.round(T.invoiced))}</td>
                  <td className={cn('px-2 py-2.5 text-right', NUM)}>{formatALL(Math.round(T.collected))}</td>
                  <td className={cn('px-5 py-2.5 text-right sm:px-6', NUM)}>{formatALL(Math.round(T.outstanding))}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        <p className="px-5 py-3 text-[11.5px] leading-relaxed text-[#7286a3] sm:px-6">
          {result.revenueBasis === 'collected'
            ? 'Të ardhura = paraja e ARKËTUAR në periudhë për çdo projekt (baza "Arkëtuar").'
            : 'Të ardhura = puna e FITUAR në periudhë (retainer: tarifa mujore; projekt fiks: sipas orëve të kryera ndaj planit), jo faturimi.'}
          {' '}«Pa arkëtuar Σ» është borxhi i klientit sot, gjithë kohës — jo i periudhës.
          Kosto direkte = orë × kosto/orë e personit (pagë e ngarkuar ÷ kapacitet) + shpenzime të lidhura me projektin.
          Fitimi bruto ≥ {s.marginThresholds.healthy} % 🟢 · ≥ {s.marginThresholds.watch} % 🟡 · më poshtë 🔴. A–D: marzh × fërkim (L/orë ndaj mesatares).
        </p>
      </section>
    </div>
  );
};

const Tile: React.FC<{ label: string; value: number; sub?: string; tone?: 'pos' | 'neg' | 'warn'; strong?: boolean }> = ({ label, value, sub, tone, strong }) => (
  <div className="rounded-[14px] border border-[#eef2f8] px-3 py-2.5">
    <p className="text-[10.5px] font-extrabold uppercase tracking-[.08em] text-[#94a5bd]">{label}</p>
    <p className={cn('mt-0.5 text-[15px] font-extrabold', NUM, tone === 'pos' ? 'text-[#0f8a5f]' : tone === 'neg' ? 'text-[#d64545]' : tone === 'warn' ? 'text-[#9a6b0a]' : 'text-[#08183A]', strong && 'text-[17px]')}>
      {formatALL(Math.round(value))}
    </p>
    {sub && <p className="text-[11px] text-[#7286a3]">{sub}</p>}
  </div>
);

const Line: React.FC<{ k: string; v: number; strong?: boolean }> = ({ k, v, strong }) => (
  <div className={cn('flex justify-between gap-3', strong && 'font-extrabold text-[#08183A]')}>
    <span>{k}</span><span className={NUM}>{v < 0 ? '−' : ''}{formatALL(Math.round(Math.abs(v)))}</span>
  </div>
);

const Cell: React.FC<{ v: number; sub?: string; tone?: 'pos' | 'neg'; strong?: boolean; muted?: boolean }> = ({ v, sub, tone, strong, muted }) => (
  <td className={cn('px-2 py-2.5 text-right', NUM, tone === 'pos' ? 'text-[#0f8a5f]' : tone === 'neg' ? 'text-[#d64545]' : muted ? 'text-[#7286a3]' : 'text-[#08183A]', strong && 'font-extrabold')}>
    {formatALL(Math.round(v))}
    {sub && <span className="block text-[10.5px] font-normal text-[#94a5bd]">{sub}</span>}
  </td>
);

const ClientDetail: React.FC<{ row: ClientRow; openProject: string | null; setOpenProject: (id: string | null) => void; thresholds: { healthy: number; watch: number } }> = ({ row, openProject, setOpenProject }) => (
  <div className="grid gap-3 lg:grid-cols-[1fr_300px]">
    <div className="rounded-[14px] border border-[#e3e9f2] bg-white">
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="border-b border-[#eef2f8] text-[10.5px] font-extrabold uppercase tracking-[.08em] text-[#94a5bd]">
            <th className="px-3 py-2 text-left">Projekti</th>
            <th className="px-2 py-2 text-right">Të ardhura</th>
            <th className="px-2 py-2 text-right">Orë</th>
            <th className="px-2 py-2 text-right">Punë</th>
            <th className="px-2 py-2 text-right">Bruto</th>
            <th className="px-2 py-2 text-right">Plani</th>
            <th className="px-3 py-2 text-right">EAC</th>
          </tr>
        </thead>
        <tbody>
          {row.projects.map(p => (
            <React.Fragment key={p.id}>
              <tr className="border-b border-[#eef2f8] last:border-0">
                <td className="px-3 py-2">
                  <button type="button" onClick={() => setOpenProject(openProject === p.id ? null : p.id)} className="flex items-center gap-1.5 text-left">
                    {openProject === p.id ? <ChevronDown className="h-3 w-3 text-[#94a5bd]" /> : <ChevronRight className="h-3 w-3 text-[#94a5bd]" />}
                    <span className="font-bold text-[#08183A]">{p.name}</span>
                  </button>
                  <span className="ml-[18px] block text-[10.5px] text-[#94a5bd]">{p.billingType === 'monthly' ? 'retainer' : 'fiks'} · {RECOGNITION_METHOD_LABELS[p.method]}</span>
                </td>
                <td className={cn('px-2 py-2 text-right', NUM)}>{formatALL(Math.round(p.earned))}</td>
                <td className={cn('px-2 py-2 text-right', NUM)}>{h1(p.hours)}</td>
                <td className={cn('px-2 py-2 text-right', NUM)}>{formatALL(Math.round(p.laborCost))}</td>
                <td className={cn('px-2 py-2 text-right font-bold', NUM, p.grossProfit >= 0 ? 'text-[#0f8a5f]' : 'text-[#d64545]')}>{formatALL(Math.round(p.grossProfit))} <span className="font-normal text-[#94a5bd]">{pctTxt(p.grossMarginPct)}</span></td>
                <td className="px-2 py-2 text-right">
                  {p.plannedHours > 0 ? (
                    <span className={cn('rounded-md border px-1.5 py-px text-[10.5px] font-extrabold', p.alertLevel === 'ok' ? 'border-[#e3e9f2] text-[#7286a3]' : ALERT_CLS[p.alertLevel])}>
                      {p.consumedPct == null ? '—' : `${Math.round(p.consumedPct)} %`}{p.alertLevel !== 'ok' ? ` · ${ALERT_LABEL[p.alertLevel]}` : ''}
                    </span>
                  ) : p.billingType === 'one-time' && p.hours > 0 ? <span className="text-[10.5px] font-bold text-[#9a6b0a]">pa plan</span> : <span className="text-[#94a5bd]">—</span>}
                </td>
                <td className={cn('px-3 py-2 text-right', NUM)}>{p.eacMarginPct == null ? '—' : <span className={p.eacMarginPct < 0 ? 'text-[#d64545] font-bold' : ''}>{pctTxt(p.eacMarginPct)}</span>}</td>
              </tr>
              {openProject === p.id && (
                <tr className="bg-[#f4f7fb]"><td colSpan={7} className="px-3 py-2"><ProjectPeople line={p} /></td></tr>
              )}
            </React.Fragment>
          ))}
          {row.unlinkedInvoiced > 0 && (
            <tr><td colSpan={7} className="px-3 py-2 text-[11.5px] text-[#9a6b0a]">+ {formatALL(Math.round(row.unlinkedInvoiced))} faturuar pa projekt (nuk hyn te të ardhurat e fituara).</td></tr>
          )}
        </tbody>
      </table>
    </div>
    <div className="rounded-[14px] border border-[#e3e9f2] bg-white p-3">
      <p className="text-[10.5px] font-extrabold uppercase tracking-[.08em] text-[#94a5bd]">Punë sipas rolit</p>
      {Object.keys(row.byRole).length === 0 ? <p className="mt-1 text-[12px] text-[#7286a3]">Asnjë orë.</p> : (
        <ul className="mt-1 space-y-1">
          {Object.entries(row.byRole).sort((a, b) => b[1].cost - a[1].cost).map(([role, v]) => (
            <li key={role} className="flex items-center justify-between text-[12.5px]">
              <span className="text-[#08183A]">{role} <span className="text-[#94a5bd]">{h1(v.hours)} h</span></span>
              <span className={cn(NUM, 'font-bold')}>{formatALL(Math.round(v.cost))}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-[10.5px] font-extrabold uppercase tracking-[.08em] text-[#94a5bd]">Kontrata</p>
      <p className={cn('text-[12.5px]', NUM)}>{formatALL(Math.round(row.contractValue))} <span className="text-[#94a5bd]">vlerë · </span>{formatALL(Math.round(row.earned))} <span className="text-[#94a5bd]">fituar në periudhë</span></p>
    </div>
  </div>
);

const ProjectPeople: React.FC<{ line: ClientProjectLine }> = ({ line }) => (
  <div className="flex flex-wrap gap-2 text-[12px]">
    {line.byMember.length === 0 && <span className="text-[#7286a3]">Asnjë orë e regjistruar.</span>}
    {line.byMember.map(m => (
      <span key={m.userId} className="rounded-lg border border-[#e3e9f2] bg-white px-2 py-1">
        <b className="text-[#08183A]">{m.name}</b> <span className="text-[#94a5bd]">{m.role}</span> · {h1(m.hours)} h · <span className={NUM}>{formatALL(Math.round(m.cost))}</span>
      </span>
    ))}
    {line.deferred > 0 && <span className="rounded-lg border border-[#e3e9f2] bg-white px-2 py-1 text-[#7286a3]">Faturuar përpara punës: {formatALL(Math.round(line.deferred))}</span>}
    {line.unbilledEarned > 0 && <span className="rounded-lg border border-[#e3e9f2] bg-white px-2 py-1 text-[#7286a3]">Punë e pafaturuar: {formatALL(Math.round(line.unbilledEarned))}</span>}
  </div>
);

export default ClientProfitabilityPanel;
