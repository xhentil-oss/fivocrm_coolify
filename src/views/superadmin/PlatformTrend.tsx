import React, { useMemo } from 'react';
import { TrendingUp, TrendingDown, Minus, UserPlus, Repeat, UserMinus } from 'lucide-react';
import { Card } from '../../components/ui/card';
import { useCollection } from '../../hooks/useFirestore';
import { summarizeTrend } from '../../lib/platformAdmin';
import type { PlatformMetrics } from '../../types';

/**
 * Growth, not just state.
 *
 * The tenant list can only ever answer "what is true now". This reads the monthly
 * `platformMetrics` documents written by the `platform-metrics-rollup` cron and answers
 * the operator's real questions: is MRR moving, how many signed up, how many of them
 * converted, how many left.
 *
 * Reads are cross-tenant by design (the collection is super-admin-only in the rules).
 */

/** Inline sparkline — no chart library, so this costs nothing on first paint. */
const Sparkline: React.FC<{ values: number[]; className?: string }> = ({ values, className }) => {
  if (values.length < 2) return null;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const W = 120;
  const H = 28;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * W;
    const y = H - ((v - min) / span) * H;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={className} width={W} height={H} aria-hidden="true" preserveAspectRatio="none">
      <polyline
        points={pts.join(' ')}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
};

const PlatformTrend: React.FC = () => {
  // Only the last 18 months are of any interest; the collection is one doc per month.
  const { data: metrics, loading } = useCollection<PlatformMetrics>('platformMetrics', {
    skipTeamFilter: true,
    skipBusinessFilter: true,
  });

  const trend = useMemo(() => summarizeTrend(metrics || [], 12), [metrics]);
  const hasHistory = trend.months.length > 0;

  if (loading) return null;

  if (!hasHistory) {
    return (
      <Card className="p-4 mb-5">
        <p className="text-sm font-medium mb-1">Trendi nuk është llogaritur ende</p>
        <p className="text-xs text-muted-foreground">
          Ekzekuto punën <span className="font-mono">platform-metrics-rollup</span> (Punët → Analitika)
          me <span className="font-mono">backfill</span> për të rindërtuar historikun nga data e regjistrimeve.
        </p>
      </Card>
    );
  }

  const DeltaIcon = trend.mrrDeltaEur === null || trend.mrrDeltaEur === 0
    ? Minus
    : trend.mrrDeltaEur > 0 ? TrendingUp : TrendingDown;
  const deltaCls = trend.mrrDeltaEur === null || trend.mrrDeltaEur === 0
    ? 'text-muted-foreground'
    : trend.mrrDeltaEur > 0 ? 'text-green-600 dark:text-green-400' : 'text-destructive';

  const cells = [
    {
      label: 'Regjistrime këtë muaj',
      value: String(trend.signupsThisMonth),
      sub: `${trend.activatedThisMonth} u konvertuan`,
      Icon: UserPlus,
    },
    {
      label: 'Konvertimi provë→paguaj',
      value: trend.conversionPct === null ? '—' : `${trend.conversionPct}%`,
      sub: 'mbi 12 muajt e fundit',
      Icon: Repeat,
    },
    {
      label: 'Churn këtë muaj',
      value: String(trend.churnedThisMonth),
      sub: trend.churnPct === null ? 'pa bazë krahasimi' : `${trend.churnPct}% e tenantëve`,
      Icon: UserMinus,
    },
  ];

  return (
    <Card className="p-4 mb-5">
      <div className="flex flex-wrap items-start gap-6">
        {/* MRR + sparkline */}
        <div className="min-w-[190px]">
          <p className="text-xs text-muted-foreground mb-1">MRR ({trend.months[trend.months.length - 1]})</p>
          <div className="flex items-end gap-3">
            <p className="text-2xl font-bold leading-none">€{trend.currentMrr.toLocaleString('sq-AL')}</p>
            <span className={`flex items-center gap-1 text-xs ${deltaCls}`}>
              <DeltaIcon className="h-3.5 w-3.5" />
              {trend.mrrDeltaEur === null
                ? 'muaji i parë'
                : `${trend.mrrDeltaEur > 0 ? '+' : ''}€${trend.mrrDeltaEur.toLocaleString('sq-AL')}${
                    trend.mrrDeltaPct === null ? '' : ` · ${trend.mrrDeltaPct > 0 ? '+' : ''}${trend.mrrDeltaPct}%`
                  }`}
            </span>
          </div>
          <Sparkline values={trend.mrrSeries} className="text-primary mt-2" />
        </div>

        {cells.map(({ label, value, sub, Icon }) => (
          <div key={label} className="min-w-[130px]">
            <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1.5">
              <Icon className="h-3.5 w-3.5" /> {label}
            </p>
            <p className="text-2xl font-bold leading-none">{value}</p>
            <p className="text-[11px] text-muted-foreground mt-1">{sub}</p>
          </div>
        ))}
      </div>
    </Card>
  );
};

export default PlatformTrend;
