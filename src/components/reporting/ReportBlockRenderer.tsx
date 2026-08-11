/**
 * Read-only block renderer — shared by the staff report view AND the client portal.
 *
 * It takes blocks that have ALREADY been redacted (`redactForAudience` /
 * `redactForClient`) and renders them. It deliberately has no idea who is looking:
 * one renderer means the portal can never accidentally render something the staff
 * view would have hidden, or vice versa.
 *
 * The only audience-aware thing it does is the `showVisibilityBadges` prop, which
 * staff use to see at a glance which sections the client will get.
 */

import React from 'react';
import {
  AlertTriangle, ArrowRight, BadgeCheck, CheckCircle2, Eye, EyeOff,
  Flag, Lightbulb, Lock, Paperclip, Sparkles, UserCheck, Video,
} from 'lucide-react';
import { LineChart, Line, BarChart, Bar, AreaChart, Area, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { Badge } from '../ui/badge';
import { Card } from '../ui/card';
import { isClientVisibility } from '../../lib/reporting/visibility';
import { formatKpiValue, kpiCardModel } from '../../lib/reporting/kpi';
import { isSafeUrl } from '../../lib/reporting/blocks';
import type { ReportBlock, ReportKpiValue } from '../../types';

const CHART_COLORS = ['#12468C', '#0EA5E9', '#22C55E', '#F59E0B', '#EF4444', '#8B5CF6'];

interface Props {
  blocks: ReportBlock[];
  kpiValues?: ReportKpiValue[];
  currency?: string;
  /** Staff-only affordance: label each block with who can see it. */
  showVisibilityBadges?: boolean;
  /** Print/PDF-ish layout (no cards, tighter spacing). */
  variant?: 'screen' | 'print';
  className?: string;
}

const ReportBlockRenderer: React.FC<Props> = ({
  blocks, kpiValues = [], currency = 'ALL', showVisibilityBadges = false, variant = 'screen', className = '',
}) => {
  const byId = new Map(kpiValues.map(k => [k.kpiId, k]));

  if (!blocks.length) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <Eye className="w-8 h-8 mx-auto mb-3 opacity-40" />
        <p className="text-sm">Nuk ka seksione për të shfaqur.</p>
      </div>
    );
  }

  return (
    <div className={`space-y-6 ${className}`}>
      {blocks.map(block => (
        <BlockShell key={block.id} block={block} showVisibilityBadges={showVisibilityBadges} variant={variant}>
          <BlockBody block={block} byId={byId} currency={currency} />
        </BlockShell>
      ))}
    </div>
  );
};

// ── shell ───────────────────────────────────────────────────────────────────────

const BlockShell: React.FC<{
  block: ReportBlock;
  showVisibilityBadges: boolean;
  variant: 'screen' | 'print';
  children: React.ReactNode;
}> = ({ block, showVisibilityBadges, variant, children }) => {
  if (block.type === 'page-break') {
    return <div className="border-t-2 border-dashed border-border my-8" aria-hidden />;
  }
  if (block.type === 'title') {
    return (
      <div className="pt-2">
        <h2 className="text-2xl font-bold text-foreground">{block.title || block.text}</h2>
        {block.description && <p className="text-sm text-muted-foreground mt-1">{block.description}</p>}
      </div>
    );
  }
  if (block.type === 'subtitle') {
    return <h3 className="text-lg font-semibold text-foreground pt-2">{block.title || block.text}</h3>;
  }

  const clientVisible = isClientVisibility(block.visibility);
  const Wrapper = variant === 'print' ? 'div' : Card;

  return (
    <Wrapper className={variant === 'print' ? 'space-y-3' : 'p-5 space-y-3'}>
      {(block.title || showVisibilityBadges) && (
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {block.title && <h4 className="font-semibold text-foreground">{block.title}</h4>}
            {block.description && <p className="text-xs text-muted-foreground mt-0.5">{block.description}</p>}
          </div>
          {showVisibilityBadges && (
            <div className="flex items-center gap-1.5 shrink-0">
              {block.aiSuggested && !block.aiApprovedByUserId && (
                <Badge variant="outline" className="text-[10px] gap-1 bg-warning/10 text-warning border-warning/30">
                  <Sparkles className="w-3 h-3" /> AI — pa aprovuar
                </Badge>
              )}
              <Badge
                variant="outline"
                className={`text-[10px] gap-1 ${clientVisible
                  ? 'bg-primary/10 text-primary border-primary/30'
                  : 'bg-muted text-muted-foreground border-border'}`}
              >
                {clientVisible ? <Eye className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
                {clientVisible ? 'Klienti' : 'Brenda'}
              </Badge>
            </div>
          )}
        </div>
      )}
      {children}
    </Wrapper>
  );
};

// ── body ────────────────────────────────────────────────────────────────────────

const BlockBody: React.FC<{
  block: ReportBlock;
  byId: Map<string, ReportKpiValue>;
  currency: string;
}> = ({ block, byId, currency }) => {
  const kpis = (block.kpiIds || []).map(id => byId.get(id)).filter((k): k is ReportKpiValue => !!k);

  switch (block.type) {
    case 'executive-summary':
    case 'rich-text':
      return <Prose text={block.text} />;

    case 'recommendation':
      return (
        <Callout icon={Lightbulb} tone="info">
          <Prose text={block.text} />
          <ItemList items={block.items} />
        </Callout>
      );

    case 'next-steps':
      return (
        <Callout icon={ArrowRight} tone="neutral">
          <Prose text={block.text} />
          <ItemList items={block.items} />
        </Callout>
      );

    case 'client-action':
      return (
        <Callout icon={UserCheck} tone="warning">
          <Prose text={block.text} />
          <ItemList items={block.items} />
        </Callout>
      );

    case 'work-completed':
      return (
        <div className="space-y-2">
          <Prose text={block.text} />
          <ul className="space-y-1.5">
            {(block.items || []).map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <CheckCircle2 className="w-4 h-4 text-success shrink-0 mt-0.5" />
                <span className="text-foreground">{item}</span>
              </li>
            ))}
          </ul>
        </div>
      );

    case 'task-list':
    case 'milestone-list':
      return (
        <div className="space-y-1.5">
          {(block.items || []).map((item, i) => (
            <div key={i} className="flex items-start gap-2 text-sm">
              <Flag className="w-4 h-4 text-primary shrink-0 mt-0.5" />
              <span className="text-foreground">{item}</span>
            </div>
          ))}
          {block.rows?.length ? <DataTable block={block} currency={currency} /> : null}
        </div>
      );

    case 'timeline':
      return (
        <ol className="relative border-l border-border ml-2 space-y-4">
          {(block.items || []).map((item, i) => (
            <li key={i} className="ml-4">
              <span className="absolute -left-1.5 w-3 h-3 rounded-full bg-primary" aria-hidden />
              <p className="text-sm text-foreground">{item}</p>
            </li>
          ))}
        </ol>
      );

    case 'blocker-list':
      return (block.items || []).length || (block.rows || []).length ? (
        <div className="space-y-2">
          {(block.items || []).map((item, i) => (
            <div key={i} className="flex items-start gap-2 text-sm">
              <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
              <span className="text-foreground">{item}</span>
            </div>
          ))}
          {block.rows?.length ? <DataTable block={block} currency={currency} /> : null}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Pa bllokues të raportuar.</p>
      );

    case 'risk-register':
      return <DataTable block={block} currency={currency} />;

    case 'table':
      return <DataTable block={block} currency={currency} />;

    case 'kpi-cards':
      return <KpiGrid kpis={kpis} currency={currency} />;

    case 'comparison-cards':
      return <KpiGrid kpis={kpis} currency={currency} showComparison />;

    case 'goal-vs-actual':
      return <GoalVsActual kpis={kpis} currency={currency} />;

    case 'progress':
      return <ProgressBar value={block.progress ?? 0} />;

    case 'chart':
      return <ChartBlock block={block} kpis={kpis} />;

    case 'funnel':
      return <Funnel kpis={kpis} currency={currency} />;

    case 'image':
      return block.url && isSafeUrl(block.url)
        ? <img src={block.url} alt={block.title || 'Imazh'} className="rounded-lg border border-border max-w-full" />
        : <p className="text-sm text-muted-foreground">Imazh i pavlefshëm.</p>;

    case 'gallery':
      return (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {(block.attachments || []).filter(a => isSafeUrl(a.url)).map(a => (
            <img key={a.id} src={a.url} alt={a.name} className="rounded-lg border border-border w-full h-32 object-cover" />
          ))}
        </div>
      );

    case 'video-link':
      return block.url && isSafeUrl(block.url) ? (
        <a href={block.url} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-2 text-sm text-primary hover:underline">
          <Video className="w-4 h-4" /> {block.title || 'Shiko videon'}
        </a>
      ) : null;

    case 'attachment':
      return (
        <ul className="space-y-1.5">
          {(block.attachments || []).filter(a => isSafeUrl(a.url)).map(a => (
            <li key={a.id}>
              <a href={a.url} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-sm text-primary hover:underline">
                <Paperclip className="w-4 h-4" /> {a.name}
              </a>
            </li>
          ))}
        </ul>
      );

    case 'approval':
      return (
        <Callout icon={BadgeCheck} tone="info">
          <Prose text={block.text || 'Ky raport kërkon aprovimin tuaj.'} />
        </Callout>
      );

    case 'signature':
      return (
        <div className="pt-6">
          <div className="border-b border-foreground/40 w-64" />
          <p className="text-xs text-muted-foreground mt-1">{block.title || 'Nënshkrimi'}</p>
        </div>
      );

    case 'custom-html':
      // Never reached in a client payload (the redactor strips it). For staff we show
      // the source rather than executing it — rendering tenant-authored HTML would be
      // a stored-XSS vector for everyone else in the tenant.
      return (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs text-warning">
            <EyeOff className="w-3.5 h-3.5" /> HTML i papërpunuar — shfaqet si tekst.
          </div>
          <pre className="text-xs bg-muted p-3 rounded-lg overflow-x-auto whitespace-pre-wrap break-all">
            {block.html}
          </pre>
        </div>
      );

    default:
      return <Prose text={block.text} />;
  }
};

// ── primitives ──────────────────────────────────────────────────────────────────

/**
 * Plain-text paragraphs. Deliberately NOT HTML: report narrative is authored in
 * textareas, so rendering it as markup would turn every report into an XSS surface
 * for the client portal.
 */
const Prose: React.FC<{ text?: string }> = ({ text }) => {
  if (!text?.trim()) return <p className="text-sm text-muted-foreground italic">Bosh.</p>;
  return (
    <div className="space-y-2">
      {text.split(/\n\s*\n/).map((para, i) => (
        <p key={i} className="text-sm text-foreground whitespace-pre-line leading-relaxed">{para}</p>
      ))}
    </div>
  );
};

const ItemList: React.FC<{ items?: string[] }> = ({ items }) => {
  if (!items?.length) return null;
  return (
    <ul className="list-disc pl-5 space-y-1 mt-2">
      {items.map((it, i) => <li key={i} className="text-sm text-foreground">{it}</li>)}
    </ul>
  );
};

const TONE_CLASSES = {
  info: 'bg-primary/5 border-primary/20 text-primary',
  warning: 'bg-warning/5 border-warning/20 text-warning',
  neutral: 'bg-muted/50 border-border text-muted-foreground',
} as const;

const Callout: React.FC<{
  icon: React.ComponentType<{ className?: string }>;
  tone: keyof typeof TONE_CLASSES;
  children: React.ReactNode;
}> = ({ icon: Icon, tone, children }) => (
  <div className={`rounded-lg border p-3 ${TONE_CLASSES[tone]}`}>
    <div className="flex gap-2.5">
      <Icon className="w-4 h-4 shrink-0 mt-0.5" />
      <div className="min-w-0 flex-1 text-foreground">{children}</div>
    </div>
  </div>
);

const ProgressBar: React.FC<{ value: number }> = ({ value }) => {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-sm">
        <span className="text-muted-foreground">Progresi</span>
        <span className="font-semibold text-foreground">{Math.round(pct)}%</span>
      </div>
      <div className="h-2.5 bg-muted rounded-full overflow-hidden">
        <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
};

const DataTable: React.FC<{ block: ReportBlock; currency: string }> = ({ block, currency }) => {
  const columns = block.columns || [];
  const rows = block.rows || [];
  if (!columns.length || !rows.length) {
    return <p className="text-sm text-muted-foreground italic">Pa të dhëna.</p>;
  }
  const fmt = (v: string | number | null, format?: string) => {
    if (v === null || v === undefined || v === '') return '—';
    if (typeof v !== 'number') return String(v);
    switch (format) {
      case 'currency': return formatKpiValue(v, 'currency', { decimals: 0, currency });
      case 'percent': return formatKpiValue(v, 'percent', { decimals: 1 });
      case 'hours': return formatKpiValue(v, 'hours', { decimals: 1 });
      case 'number': return formatKpiValue(v, 'number', { decimals: 0 });
      default: return String(v);
    }
  };
  // Wide tables scroll inside their own container so the page never scrolls sideways.
  return (
    <div className="overflow-x-auto -mx-1 px-1">
      <table className="w-full text-sm min-w-[420px]">
        <thead>
          <tr className="border-b border-border">
            {columns.map(c => (
              <th key={c.key}
                className={`py-2 px-2 font-semibold text-muted-foreground text-xs uppercase tracking-wide ${
                  c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left'}`}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-border/50 last:border-0">
              {columns.map(c => (
                <td key={c.key}
                  className={`py-2 px-2 text-foreground ${
                    c.align === 'right' ? 'text-right tabular-nums' : c.align === 'center' ? 'text-center' : 'text-left'}`}>
                  {fmt(row[c.key], c.format)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export const KpiGrid: React.FC<{
  kpis: ReportKpiValue[];
  currency: string;
  showComparison?: boolean;
}> = ({ kpis, currency, showComparison }) => {
  if (!kpis.length) return <p className="text-sm text-muted-foreground italic">Pa KPI të caktuara.</p>;
  return (
    <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
      {kpis.map(kpi => {
        const m = kpiCardModel({ ...kpi, currency: kpi.currency || currency });
        const favourable = m.delta.favourable;
        return (
          <div key={kpi.kpiId} className="rounded-lg border border-border p-3 bg-card">
            <p className="text-xs text-muted-foreground truncate" title={kpi.label}>{kpi.label}</p>
            <p className="text-xl font-bold text-foreground mt-1 tabular-nums">{m.display}</p>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              {(showComparison || m.delta.absolute !== null) && (
                <span className={`text-xs font-medium ${
                  favourable === null ? 'text-muted-foreground'
                    : favourable ? 'text-success' : 'text-error'}`}>
                  {m.deltaLabel}
                </span>
              )}
              {m.targetLabel && (
                <span className="text-[11px] text-muted-foreground">objektiv {m.targetLabel}</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

const GoalVsActual: React.FC<{ kpis: ReportKpiValue[]; currency: string }> = ({ kpis, currency }) => {
  const withTargets = kpis.filter(k => k.target !== null && k.target !== undefined);
  if (!withTargets.length) {
    return <p className="text-sm text-muted-foreground italic">Pa objektiva të caktuara për këto KPI.</p>;
  }
  return (
    <div className="space-y-3">
      {withTargets.map(kpi => {
        const m = kpiCardModel({ ...kpi, currency: kpi.currency || currency });
        const pct = Math.max(0, Math.min(100, (m.attainment ?? 0) * 100));
        const bar = m.rag === 'green' ? 'bg-success' : m.rag === 'yellow' ? 'bg-warning' : m.rag === 'red' ? 'bg-error' : 'bg-muted-foreground';
        return (
          <div key={kpi.kpiId} className="space-y-1">
            <div className="flex justify-between text-sm gap-2">
              <span className="text-foreground truncate">{kpi.label}</span>
              <span className="text-muted-foreground shrink-0 tabular-nums">
                {m.display} / {m.targetLabel}
              </span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div className={`h-full rounded-full ${bar}`} style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
};

const Funnel: React.FC<{ kpis: ReportKpiValue[]; currency: string }> = ({ kpis, currency }) => {
  const stages = kpis.filter(k => typeof k.value === 'number');
  if (!stages.length) return <p className="text-sm text-muted-foreground italic">Pa të dhëna funnel.</p>;
  const max = Math.max(...stages.map(s => Number(s.value)));
  return (
    <div className="space-y-2">
      {stages.map((s, i) => {
        const width = max > 0 ? (Number(s.value) / max) * 100 : 0;
        const prev = i > 0 ? Number(stages[i - 1].value) : null;
        const rate = prev && prev > 0 ? (Number(s.value) / prev) * 100 : null;
        return (
          <div key={s.kpiId} className="space-y-1">
            <div className="flex justify-between text-sm gap-2">
              <span className="text-foreground truncate">{s.label}</span>
              <span className="text-muted-foreground shrink-0 tabular-nums">
                {formatKpiValue(s.value, s.unit, { decimals: s.decimals ?? 0, currency })}
                {rate !== null && <span className="ml-2 text-xs">({rate.toFixed(1)}%)</span>}
              </span>
            </div>
            <div className="h-6 bg-muted rounded overflow-hidden">
              <div className="h-full bg-primary/80 rounded" style={{ width: `${width}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
};

const ChartBlock: React.FC<{ block: ReportBlock; kpis: ReportKpiValue[] }> = ({ block, kpis }) => {
  const data = kpis
    .filter(k => typeof k.value === 'number')
    .map(k => ({
      name: k.label.length > 18 ? `${k.label.slice(0, 17)}…` : k.label,
      Aktuale: k.value as number,
      ...(typeof k.previousValue === 'number' ? { 'E mëparshme': k.previousValue } : {}),
    }));

  if (!data.length) return <p className="text-sm text-muted-foreground italic">Pa të dhëna për grafik.</p>;

  const axis = { stroke: 'currentColor', fontSize: 11, className: 'text-muted-foreground' };
  const common = (
    <>
      <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
      <XAxis dataKey="name" {...axis} />
      <YAxis {...axis} />
      <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
      <Legend wrapperStyle={{ fontSize: 12 }} />
    </>
  );

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        {block.chart === 'bar' ? (
          <BarChart data={data}>
            {common}
            <Bar dataKey="Aktuale" fill={CHART_COLORS[0]} radius={[4, 4, 0, 0]} />
            {data[0]['E mëparshme'] !== undefined && <Bar dataKey="E mëparshme" fill={CHART_COLORS[1]} radius={[4, 4, 0, 0]} />}
          </BarChart>
        ) : block.chart === 'area' ? (
          <AreaChart data={data}>
            {common}
            <Area type="monotone" dataKey="Aktuale" stroke={CHART_COLORS[0]} fill={CHART_COLORS[1]} fillOpacity={0.25} />
          </AreaChart>
        ) : block.chart === 'pie' || block.chart === 'doughnut' ? (
          <PieChart>
            <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Pie
              data={data} dataKey="Aktuale" nameKey="name"
              innerRadius={block.chart === 'doughnut' ? 50 : 0} outerRadius={85}
            >
              {data.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
            </Pie>
          </PieChart>
        ) : (
          <LineChart data={data}>
            {common}
            <Line type="monotone" dataKey="Aktuale" stroke={CHART_COLORS[0]} strokeWidth={2} dot />
            {data[0]['E mëparshme'] !== undefined && (
              <Line type="monotone" dataKey="E mëparshme" stroke={CHART_COLORS[1]} strokeWidth={2} strokeDasharray="4 4" dot={false} />
            )}
          </LineChart>
        )}
      </ResponsiveContainer>
    </div>
  );
};

export default ReportBlockRenderer;
