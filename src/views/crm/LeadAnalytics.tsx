import React, { useMemo } from 'react';
import { Card } from '../../components/ui/card';
import { TrendingUp, Users, DollarSign, Target, Clock, Zap, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { getTimestampMs } from '../../lib/utils';
import { leadSla } from '../../lib/leadIntel';
import { PIPELINE_STAGES, OPEN_STATUSES, leadStageProbability } from '../../lib/leadStages';
import type { Lead } from '../../types';

// Funnel reuses the canonical board stages (New → … → Converted).
const FUNNEL = PIPELINE_STAGES.map(s => ({ key: s.key, label: s.label, color: s.color }));
const fmt = (n: number) => Math.round(n).toLocaleString('sq-AL');

const Kpi: React.FC<{ icon: React.ReactNode; label: string; value: string; sub?: string; tone?: string }> = ({ icon, label, value, sub, tone }) => (
  <Card className="p-4">
    <div className="flex items-center gap-2 text-muted-foreground mb-1">
      {icon}<span className="text-xs">{label}</span>
    </div>
    <p className={`text-2xl font-bold tabular-nums ${tone || 'text-foreground'}`}>{value}</p>
    {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
  </Card>
);

const Bar: React.FC<{ label: string; value: number; max: number; color: string; right?: string }> = ({ label, value, max, color, right }) => (
  <div className="flex items-center gap-3">
    <div className="w-28 shrink-0 text-xs text-muted-foreground truncate">{label}</div>
    <div className="flex-1 h-5 bg-muted rounded overflow-hidden">
      <div className={`h-full ${color} rounded transition-all`} style={{ width: `${max > 0 ? Math.max(2, (value / max) * 100) : 0}%` }} />
    </div>
    <div className="w-24 shrink-0 text-right text-xs font-medium tabular-nums">{right ?? fmt(value)}</div>
  </div>
);

const LeadAnalytics: React.FC<{
  leads: Lead[];
  teamMembers: { userId: string; name?: string; displayName?: string; email?: string }[];
  getName: (id?: string, fallback?: string) => string;
}> = ({ leads, getName }) => {
  const m = useMemo(() => {
    const all = leads || [];
    const open = all.filter(l => OPEN_STATUSES.includes(l.status));
    const converted = all.filter(l => l.status === 'Converted');
    const lost = all.filter(l => l.status === 'Lost');

    const pipelineValue = open.reduce((s, l) => s + (l.estimatedValue || 0), 0);
    const weighted = open.reduce((s, l) => s + (l.estimatedValue || 0) * (leadStageProbability(l) / 100), 0);
    const conversionRate = all.length ? (converted.length / all.length) * 100 : 0;

    // Avg time-to-convert (days)
    const convTimes = converted.map(l => {
      const c = getTimestampMs((l as any).convertedAt) || getTimestampMs(l.updatedAt);
      const created = getTimestampMs(l.createdAt);
      return c && created ? (c - created) / 86_400_000 : null;
    }).filter((x): x is number => x != null && x >= 0);
    const avgConvDays = convTimes.length ? convTimes.reduce((a, b) => a + b, 0) / convTimes.length : null;

    // Avg first-response (hours)
    const respTimes = all.map(l => {
      const fr = getTimestampMs(l.firstResponseAt);
      const created = getTimestampMs(l.createdAt);
      return fr && created ? (fr - created) / 3_600_000 : null;
    }).filter((x): x is number => x != null && x >= 0);
    const avgRespH = respTimes.length ? respTimes.reduce((a, b) => a + b, 0) / respTimes.length : null;

    const slaBreaches = open.filter(l => leadSla(l).breached).length;
    const staleCount = open.filter(l => leadSla(l).stale).length;

    // Funnel counts/value
    const funnel = FUNNEL.map(f => {
      const items = all.filter(l => l.status === f.key);
      return { ...f, count: items.length, value: items.reduce((s, l) => s + (l.estimatedValue || 0), 0) };
    });

    // By source
    const srcMap = new Map<string, { count: number; converted: number; value: number }>();
    all.forEach(l => {
      const k = l.source || 'Pa burim';
      const e = srcMap.get(k) || { count: 0, converted: 0, value: 0 };
      e.count++; e.value += l.estimatedValue || 0;
      if (l.status === 'Converted') e.converted++;
      srcMap.set(k, e);
    });
    const bySource = Array.from(srcMap.entries()).map(([k, v]) => ({ source: k, ...v, rate: v.count ? (v.converted / v.count) * 100 : 0 }))
      .sort((a, b) => b.count - a.count).slice(0, 8);

    // Leaderboard by assignee
    const repMap = new Map<string, { count: number; converted: number; value: number }>();
    all.forEach(l => {
      const k = l.assignedToUserId || '__none__';
      const e = repMap.get(k) || { count: 0, converted: 0, value: 0 };
      e.count++;
      if (OPEN_STATUSES.includes(l.status)) e.value += l.estimatedValue || 0;
      if (l.status === 'Converted') e.converted++;
      repMap.set(k, e);
    });
    const leaderboard = Array.from(repMap.entries()).map(([k, v]) => ({
      uid: k, name: k === '__none__' ? 'Pa caktuar' : getName(k), ...v, rate: v.count ? (v.converted / v.count) * 100 : 0,
    })).sort((a, b) => b.converted - a.converted || b.count - a.count).slice(0, 10);

    // Lost reasons
    const lostMap = new Map<string, number>();
    lost.forEach(l => { const k = l.lostReason || 'Pa arsye'; lostMap.set(k, (lostMap.get(k) || 0) + 1); });
    const lostReasons = Array.from(lostMap.entries()).map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count);

    return { all, open, converted, lost, pipelineValue, weighted, conversionRate, avgConvDays, avgRespH, slaBreaches, staleCount, funnel, bySource, leaderboard, lostReasons };
  }, [leads, getName]);

  const funnelMax = Math.max(1, ...m.funnel.map(f => f.count));
  const srcMax = Math.max(1, ...m.bySource.map(s => s.count));
  const lbMax = Math.max(1, ...m.leaderboard.map(r => r.count));
  const lostMax = Math.max(1, ...m.lostReasons.map(r => r.count));

  return (
    <div className="space-y-6 mt-4">
      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi icon={<Users className="w-4 h-4" />} label="Leads aktive" value={fmt(m.open.length)} sub={`${m.all.length} gjithsej`} />
        <Kpi icon={<DollarSign className="w-4 h-4" />} label="Vlera pipeline" value={`${fmt(m.pipelineValue)} L`} sub={`E ponderuar: ${fmt(m.weighted)} L`} />
        <Kpi icon={<Target className="w-4 h-4" />} label="Norma konvertimit" value={`${m.conversionRate.toFixed(1)}%`} sub={`${m.converted.length} konvertuara`} tone="text-emerald-600" />
        <Kpi icon={<TrendingUp className="w-4 h-4" />} label="Forecast i ponderuar" value={`${fmt(m.weighted)} L`} sub="Hapur × probabilitet" />
        <Kpi icon={<Clock className="w-4 h-4" />} label="Koha mesatare e konvertimit" value={m.avgConvDays != null ? `${m.avgConvDays.toFixed(0)} ditë` : '—'} />
        <Kpi icon={<Zap className="w-4 h-4" />} label="Përgjigja e parë (mes.)" value={m.avgRespH != null ? `${m.avgRespH.toFixed(0)} orë` : '—'} />
        <Kpi icon={<AlertTriangle className="w-4 h-4" />} label="SLA të shkelura" value={fmt(m.slaBreaches)} tone={m.slaBreaches ? 'text-red-600' : 'text-foreground'} sub="leads të hapura" />
        <Kpi icon={<CheckCircle2 className="w-4 h-4" />} label="Leads të ngrira" value={fmt(m.staleCount)} tone={m.staleCount ? 'text-amber-600' : 'text-foreground'} sub="14+ ditë pa aktivitet" />
      </div>

      {/* Funnel */}
      <Card className="p-5">
        <h3 className="text-sm font-semibold mb-4">Funnel-i i shitjeve</h3>
        <div className="space-y-2">
          {m.funnel.map(f => (
            <Bar key={f.key} label={f.label} value={f.count} max={funnelMax} color={f.color}
              right={`${f.count} · ${fmt(f.value)} L`} />
          ))}
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* By source */}
        <Card className="p-5">
          <h3 className="text-sm font-semibold mb-4">Sipas burimit (ROI)</h3>
          {m.bySource.length === 0 ? <p className="text-xs text-muted-foreground">Pa të dhëna</p> : (
            <div className="space-y-2">
              {m.bySource.map(s => (
                <Bar key={s.source} label={s.source} value={s.count} max={srcMax} color="bg-sky-500"
                  right={`${s.count} · ${s.rate.toFixed(0)}% konv.`} />
              ))}
            </div>
          )}
        </Card>

        {/* Leaderboard */}
        <Card className="p-5">
          <h3 className="text-sm font-semibold mb-4">Renditja e agjentëve</h3>
          {m.leaderboard.length === 0 ? <p className="text-xs text-muted-foreground">Pa të dhëna</p> : (
            <div className="space-y-2">
              {m.leaderboard.map(r => (
                <Bar key={r.uid} label={r.name} value={r.count} max={lbMax} color="bg-primary"
                  right={`${r.converted} konv. · ${r.rate.toFixed(0)}%`} />
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Lost reasons */}
      {m.lostReasons.length > 0 && (
        <Card className="p-5">
          <h3 className="text-sm font-semibold mb-4">Arsyet e humbjes ({m.lost.length})</h3>
          <div className="space-y-2">
            {m.lostReasons.map(r => (
              <Bar key={r.reason} label={r.reason} value={r.count} max={lostMax} color="bg-red-500" />
            ))}
          </div>
        </Card>
      )}
    </div>
  );
};

export default LeadAnalytics;
