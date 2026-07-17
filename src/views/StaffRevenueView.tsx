import React, { useMemo, useState } from 'react';
import { TrendingUp, Users, ChevronDown, ChevronUp, Wallet, AlertTriangle } from 'lucide-react';
import { Card } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { SkeletonLoader } from '../components/PageSkeleton';
import { useCollection } from '../hooks/useFirestore';
import { usePermissions } from '../contexts/PermissionsContext';
import type { Project, TeamMember, Expense } from '../types';
import { computeStaffRevenue } from '../lib/finance/staffRevenue';

type PeriodKey = '1m' | '3m' | '6m' | '12m' | 'all';
const PERIODS: { key: PeriodKey; label: string; months: number }[] = [
  { key: '1m', label: 'Muaji', months: 1 },
  { key: '3m', label: '3 Muaj', months: 3 },
  { key: '6m', label: '6 Muaj', months: 6 },
  { key: '12m', label: '12 Muaj', months: 12 },
  { key: 'all', label: 'Gjithë kohën', months: 12 },
];

const StaffRevenueView: React.FC = () => {
  const permissions = usePermissions();
  const { data: projects, loading: pl } = useCollection<Project>('projects', { skipTeamFilter: true });
  const { data: teamMembers, loading: ml } = useCollection<TeamMember>('teamMembers', { skipTeamFilter: true });
  const { data: expenses, loading: el } = useCollection<Expense>('expenses', { skipTeamFilter: true });

  const [period, setPeriod] = useState<PeriodKey>('1m');
  const [mode, setMode] = useState<'all' | 'completed'>('all');
  const [expanded, setExpanded] = useState<string | null>(null);

  const result = useMemo(() => {
    const cfg = PERIODS.find(p => p.key === period)!;
    if (period === 'all') {
      return computeStaffRevenue(projects, teamMembers, expenses, { mode, allTime: true, months: 12 });
    }
    const end = new Date();
    const start = new Date();
    start.setMonth(start.getMonth() - cfg.months);
    start.setHours(0, 0, 0, 0);
    return computeStaffRevenue(projects, teamMembers, expenses, {
      mode, range: { start, end }, months: cfg.months,
    });
  }, [projects, teamMembers, expenses, mode, period]);

  const loading = pl || ml || el;
  const canSeeCost = permissions.isAdmin || permissions.isManager || permissions.isOwner;

  const fmt = (n: number) => Math.round(n).toLocaleString();

  if (loading) return <SkeletonLoader />;

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <TrendingUp className="h-6 w-6 text-primary" /> Xhiro sipas Punonjësi
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Sa lek/xhiro sjell çdo punonjës nga vlera e projekteve. Çdo projekt i kalon 100%
            <span className="font-medium"> përgjegjësit</span>, përveçse kur e ndan manualisht mes ekipit.
          </p>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="inline-flex rounded-md border border-border overflow-hidden text-sm">
          {PERIODS.map(p => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              className={`px-3 py-1.5 ${period === p.key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
            >{p.label}</button>
          ))}
        </div>
        <div className="inline-flex rounded-md border border-border overflow-hidden text-sm">
          <button onClick={() => setMode('all')} className={`px-3 py-1.5 ${mode === 'all' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}>Të gjitha</button>
          <button onClick={() => setMode('completed')} className={`px-3 py-1.5 ${mode === 'completed' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}>Vetëm të mbyllura</button>
        </div>
      </div>

      {/* Summary tiles */}
      <div className={`grid gap-3 ${canSeeCost ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-1'}`}>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><TrendingUp className="h-4 w-4" /> Xhiro totale</div>
          <p className="text-2xl font-bold mt-1">{fmt(result.totalValue)} <span className="text-sm font-normal text-muted-foreground">ALL</span></p>
        </Card>
        {canSeeCost && (
          <Card className="p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground"><Wallet className="h-4 w-4" /> Kosto totale</div>
            <p className="text-2xl font-bold mt-1 text-red-600">−{fmt(result.totalCost)} <span className="text-sm font-normal text-muted-foreground">ALL</span></p>
          </Card>
        )}
        {canSeeCost && (
          <Card className="p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground"><Users className="h-4 w-4" /> Fitim neto</div>
            <p className={`text-2xl font-bold mt-1 ${result.totalProfit >= 0 ? 'text-primary' : 'text-red-600'}`}>{fmt(result.totalProfit)} <span className="text-sm font-normal text-muted-foreground">ALL</span></p>
          </Card>
        )}
      </div>

      {/* Data-quality warnings */}
      {result.missingBudget.count > 0 && (
        <div className="text-sm rounded-md bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20 px-3 py-2 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            {result.missingBudget.count} projekt(e) pa vlerë (buxhet) — nuk numërohen në xhiro. Vendos vlerën te projekti:
            {' '}<span className="font-medium">{result.missingBudget.names.slice(0, 4).join(', ')}{result.missingBudget.names.length > 4 ? '…' : ''}</span>
          </span>
        </div>
      )}
      {result.unattributed.value > 0 && (
        <div className="text-sm rounded-md bg-muted/50 text-muted-foreground border border-border px-3 py-2">
          {fmt(result.unattributed.value)} ALL nga {result.unattributed.count} projekt(e) të paatribuara — përgjegjësi nuk është anëtar aktiv i ekipit.
        </div>
      )}

      {/* Table */}
      {result.rows.length === 0 ? (
        <Card className="p-10 text-center text-muted-foreground">
          Ende s'ka të dhëna. Sigurohu që projektet kanë <span className="font-medium">vlerë (buxhet)</span> dhe <span className="font-medium">përgjegjës</span>.
        </Card>
      ) : (
        <Card className="p-0 overflow-hidden">
          <div className="w-full overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground border-b bg-muted/30">
                  <th className="text-left font-medium py-3 px-4">Punonjësi</th>
                  <th className="text-right font-medium py-3 px-2">Projekte</th>
                  <th className="text-right font-medium py-3 px-2">Xhiro</th>
                  {canSeeCost && <th className="text-right font-medium py-3 px-2">Kosto</th>}
                  {canSeeCost && <th className="text-right font-medium py-3 px-4">Fitimi</th>}
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {result.rows.map(r => {
                  const isOpen = expanded === r.key;
                  return (
                    <React.Fragment key={r.key}>
                      <tr
                        className="border-b border-border/50 hover:bg-muted/30 cursor-pointer"
                        onClick={() => setExpanded(isOpen ? null : r.key)}
                      >
                        <td className="py-3 px-4">
                          <span className="font-medium">{r.name}</span>
                          <span className="text-[11px] text-muted-foreground ml-2">{r.role}</span>
                        </td>
                        <td className="text-right tabular-nums px-2">{r.projects}</td>
                        <td className="text-right tabular-nums px-2 font-semibold">{fmt(r.value)}</td>
                        {canSeeCost && <td className="text-right tabular-nums px-2 text-red-600">−{fmt(r.cost)}</td>}
                        {canSeeCost && (
                          <td className={`text-right tabular-nums px-4 font-semibold ${r.profit >= 0 ? 'text-primary' : 'text-red-600'}`}>{fmt(r.profit)}</td>
                        )}
                        <td className="pr-3 text-muted-foreground">
                          {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="bg-muted/20">
                          <td colSpan={canSeeCost ? 6 : 4} className="px-4 py-3">
                            <p className="text-xs font-medium text-muted-foreground mb-2">Projektet që formojnë xhiron</p>
                            <div className="space-y-1">
                              {r.projectLines
                                .sort((a, b) => b.value - a.value)
                                .map(pl => (
                                  <div key={pl.id} className="flex items-center justify-between text-xs gap-2">
                                    <span className="truncate">
                                      {pl.name}
                                      {pl.isResponsible
                                        ? <Badge variant="secondary" className="ml-2 text-[10px]">përgjegjës</Badge>
                                        : <span className="ml-2 text-muted-foreground">({pl.percent}%)</span>}
                                    </span>
                                    <span className="tabular-nums font-medium shrink-0">{fmt(pl.value)} ALL</span>
                                  </div>
                                ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="font-semibold border-t bg-muted/30">
                  <td className="py-3 px-4">Totali</td>
                  <td />
                  <td className="text-right tabular-nums px-2">{fmt(result.totalValue)}</td>
                  {canSeeCost && <td className="text-right tabular-nums px-2 text-red-600">−{fmt(result.totalCost)}</td>}
                  {canSeeCost && (
                    <td className={`text-right tabular-nums px-4 ${result.totalProfit >= 0 ? 'text-primary' : 'text-red-600'}`}>{fmt(result.totalProfit)}</td>
                  )}
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
};

export default StaffRevenueView;
