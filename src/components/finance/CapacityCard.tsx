import React, { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { CapacityResult, CapacityRow } from '../../lib/finance/capacity';
import type { UtilizationStatus } from '../../lib/finance/profitabilityCore';

/**
 * Kapaciteti i ekipit — per role, then per person: capacity, client hours,
 * utilisation. Answers "where do I have spare people, where do I need to hire or
 * outsource" from the same hours the P&L costs.
 */
const NUM = 'font-mono tabular-nums';
const STATUS: Record<UtilizationStatus, { label: string; cls: string; bar: string }> = {
  idle: { label: 'kapacitet i lirë', cls: 'text-[#2258bb]', bar: 'bg-[#7fb2f4]' },
  ok: { label: 'në rregull', cls: 'text-[#0f8a5f]', bar: 'bg-[#0f8a5f]' },
  overloaded: { label: 'i mbingarkuar', cls: 'text-[#d64545]', bar: 'bg-[#d64545]' },
  none: { label: '—', cls: 'text-[#94a5bd]', bar: 'bg-[#e3e9f2]' },
};
const h1 = (h: number) => (Math.round(h * 10) / 10).toLocaleString('sq-AL');

const Row: React.FC<{ r: CapacityRow; depth?: number; expandable?: boolean; open?: boolean; onToggle?: () => void }> = ({ r, depth = 0, expandable, open, onToggle }) => {
  const st = STATUS[r.status];
  const pctW = r.utilizationPct == null ? 0 : Math.min(100, r.utilizationPct);
  return (
    <div className={cn('grid grid-cols-[1.4fr_.7fr_.7fr_.7fr_1.2fr] items-center gap-2 border-b border-[#eef2f8] py-2 text-[12.5px] last:border-0', depth > 0 && 'bg-[#f9fbfe]')} style={{ paddingLeft: depth * 16 }}>
      <div className="flex items-center gap-1.5">
        {expandable ? (
          <button type="button" onClick={onToggle} className="text-[#94a5bd]">{open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}</button>
        ) : <span className="w-3.5" />}
        <span className={cn('font-bold text-[#08183A]', depth > 0 && 'font-semibold')}>{r.name}</span>
        {depth === 0 && r.headcount > 0 && <span className="text-[#94a5bd]">· {r.headcount}</span>}
      </div>
      <span className={cn('text-right', NUM)}>{h1(r.capacityHours)}</span>
      <span className={cn('text-right', NUM)}>{h1(r.clientHours)}</span>
      <span className={cn('text-right text-[#7286a3]', NUM)}>{h1(r.internalHours)}</span>
      <div className="flex items-center gap-2">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-[#eef2f8]"><div className={cn('h-full rounded-full', st.bar)} style={{ width: `${pctW}%` }} /></div>
        <span className={cn('w-20 text-right text-[11.5px] font-extrabold', NUM, st.cls)}>{r.utilizationPct == null ? '—' : `${Math.round(r.utilizationPct)} %`}</span>
      </div>
    </div>
  );
};

const CapacityCard: React.FC<{ capacity: CapacityResult; periodLabel: string; bands: { low: number; high: number } }> = ({ capacity, periodLabel, bands }) => {
  const [open, setOpen] = useState<string | null>(null);
  const t = capacity.totals;
  return (
    <section className="rounded-[20px] border border-[#e3e9f2] bg-white px-5 py-5 shadow-[0_1px_3px_rgba(8,24,58,.05)] sm:px-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-base font-extrabold text-[#08183A]">Kapaciteti i ekipit</h2>
          <p className="mt-0.5 text-[12.5px] text-[#7286a3]">{periodLabel} · utilizim = orë klientësh ÷ kapacitet praktik · nën {bands.low} % kapacitet i lirë, mbi {bands.high} % mbingarkesë</p>
        </div>
        <p className={cn('text-[13px] font-extrabold', NUM, STATUS[t.utilizationPct == null ? 'none' : t.utilizationPct < bands.low ? 'idle' : t.utilizationPct > bands.high ? 'overloaded' : 'ok'].cls)}>
          {t.utilizationPct == null ? '—' : `${Math.round(t.utilizationPct)} %`} <span className="font-semibold text-[#7286a3]">· {h1(t.clientHours)} / {h1(t.capacityHours)} h</span>
        </p>
      </div>
      <div className="mt-3 grid grid-cols-[1.4fr_.7fr_.7fr_.7fr_1.2fr] gap-2 border-b border-[#eef2f8] pb-1.5 text-[10.5px] font-extrabold uppercase tracking-[.08em] text-[#94a5bd]">
        <span className="pl-5">Roli / personi</span><span className="text-right">Kapacitet</span><span className="text-right">Klientë</span><span className="text-right">Brendshme</span><span>Utilizim</span>
      </div>
      {capacity.roles.length === 0 && <p className="py-4 text-center text-[12.5px] text-[#7286a3]">Asnjë anëtar në listëpagesë për këtë periudhë.</p>}
      {capacity.roles.map(r => (
        <React.Fragment key={r.key}>
          <Row r={r} expandable open={open === r.key} onToggle={() => setOpen(open === r.key ? null : r.key)} />
          {open === r.key && (r.members || []).map(m => <Row key={m.key} r={m} depth={1} />)}
        </React.Fragment>
      ))}
      {t.idleHours > 0 && (
        <p className="mt-3 text-[11.5px] text-[#7286a3]">
          {h1(t.idleHours)} orë kapaciteti pa asnjë orë të regjistruar (as klient, as e brendshme) — ose kapacitet i lirë, ose orë të paregjistruara. Kostoja e tyre është në overhead.
        </p>
      )}
    </section>
  );
};

export default CapacityCard;
