/**
 * Client health dashboard.
 *
 * The rule the spec is emphatic about (§9) is enforced structurally here: **no score
 * is ever shown without its factors.** Each card expands into the full factor
 * breakdown — sub-score, weight and the points it contributed — and the "what to
 * fix" list is derived from the biggest point losses, not from whichever factor
 * happens to be lowest.
 *
 * Scores are computed live from CRM data so the dashboard is never stale; the
 * nightly `client-health-rollup` cron persists a snapshot per period into
 * `clientHealthScores` for trend history.
 */

import React, { useMemo, useState } from 'react';
import {
  AlertTriangle, ChevronDown, ChevronUp, HeartPulse, Info, Search, TrendingDown, TrendingUp,
} from 'lucide-react';
import { Card } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Input } from '../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { useCollection } from '../hooks/useFirestore';
import {
  CLIENT_HEALTH_CLASSES, CLIENT_HEALTH_LABELS, computeClientHealth, suggestProjectHealth,
} from '../lib/reporting/health';
import { PUBLISHED_STATUSES } from '../lib/reporting/workflow';
import { buildPeriod, isWithinPeriod, periodKeyFor } from '../lib/reporting/period';
import type {
  ClientHealthCategory, ClientHealthScore, Customer, Invoice, Project, Report, ClientRequest,
} from '../types';

const ClientHealthView: React.FC = () => {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data: customers, loading } = useCollection<Customer>('customers');
  const { data: projects } = useCollection<Project>('projects');
  const { data: invoices } = useCollection<Invoice>('invoices');
  const { data: reports } = useCollection<Report>('reports');
  const { data: requests } = useCollection<ClientRequest>('clientRequests');
  const { data: snapshots } = useCollection<ClientHealthScore>('clientHealthScores');

  const now = useMemo(() => new Date(), []);
  const period = useMemo(() => buildPeriod('monthly', now.toISOString().slice(0, 10)), [now]);
  const prevKey = useMemo(() => {
    const d = new Date(now);
    d.setMonth(d.getMonth() - 1);
    return periodKeyFor('monthly', d.toISOString().slice(0, 10));
  }, [now]);

  const rows = useMemo(() => (customers || []).map(customer => {
    const custProjects = (projects || []).filter(p => p.customerId === customer.id);
    const custInvoices = (invoices || []).filter(i => i.customerId === customer.id);
    const custReports = (reports || []).filter(r => r.customerId === customer.id);
    const custRequests = (requests || []).filter(r => r.customerId === customer.id);

    // Worst project RAG among active projects, using the same suggestion engine the
    // project-status report uses — one definition of "at risk" across the product.
    const projectHealths = custProjects
      .filter(p => (p.status || 'active') !== 'completed')
      .map(p => suggestProjectHealth({
        projectStatus: (p.status as any) === 'Completed' ? 'completed' : 'active',
        daysToDeadline: p.endDate
          ? Math.round((p.endDate.getTime() - now.getTime()) / 86_400_000)
          : undefined,
        budgetConsumed: p.budget && (p as any).spent ? (p as any).spent / p.budget : undefined,
      }).health);
    const worst = projectHealths.includes('red') ? 'red'
      : projectHealths.includes('yellow') ? 'yellow'
        : projectHealths.length ? 'green' : undefined;

    const overdueInvoices = custInvoices.filter(i =>
      i.status !== 'Paid' && i.dueDate && i.dueDate.getTime() < now.getTime()).length;

    const reportsInPeriod = custReports.filter(r => isWithinPeriod(r.period.start, period));
    const delivered = reportsInPeriod.filter(r => PUBLISHED_STATUSES.has(r.status)).length;

    // Client-visible KPI attainment across the client's most recent published report.
    const latestPublished = custReports
      .filter(r => PUBLISHED_STATUSES.has(r.status))
      .sort((a, b) => (b.publishedAt?.getTime() || 0) - (a.publishedAt?.getTime() || 0))[0];
    const attainments = (latestPublished?.kpiValues || [])
      .filter(k => k.clientVisible && typeof k.value === 'number' && typeof k.target === 'number' && k.target !== 0)
      .map(k => (k.higherIsBetter === false
        ? Math.min(2, (k.target as number) / Math.max(1e-9, k.value as number))
        : (k.value as number) / (k.target as number)));
    const kpiAttainment = attainments.length
      ? attainments.reduce((a, b) => a + b, 0) / attainments.length
      : null;

    const openRequests = custRequests.filter(r => (r.status || '') !== 'Completed').length;
    const pendingApprovals = custReports.filter(r =>
      PUBLISHED_STATUSES.has(r.status) && !r.acknowledgedAt && !r.clientDecisionAt).length;

    const health = computeClientHealth({
      status: 'active',
      kpiAttainment,
      reportsDelivered: delivered,
      reportsDue: reportsInPeriod.length || (custProjects.length ? 1 : 0),
      openIssues: openRequests,
      overdueClientApprovals: pendingApprovals,
      overdueInvoices,
      worstProjectHealth: worst as any,
      unansweredMessages: openRequests,
    });

    const prevSnapshot = (snapshots || []).find(s => s.customerId === customer.id && s.periodKey === prevKey);

    return { customer, health, previousScore: prevSnapshot?.score ?? null };
  }), [customers, projects, invoices, reports, requests, snapshots, now, period, prevKey]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .filter(r => !q || r.customer.name.toLowerCase().includes(q))
      .filter(r => categoryFilter === 'all' || r.health.category === categoryFilter)
      .sort((a, b) => a.health.score - b.health.score); // worst first — the actionable order
  }, [rows, search, categoryFilter]);

  const distribution = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of rows) counts[r.health.category] = (counts[r.health.category] || 0) + 1;
    return counts;
  }, [rows]);

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-6xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <HeartPulse className="w-6 h-6 text-primary" /> Shëndeti i klientëve
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Rezultati kalkulohet nga rezultatet, raportimi, aprovimet, pagesat dhe shëndeti i projekteve —
          dhe shfaqet gjithmonë me faktorët që e formuan.
        </p>
      </div>

      <div className="grid grid-cols-3 lg:grid-cols-6 gap-2">
        {(Object.keys(CLIENT_HEALTH_LABELS) as ClientHealthCategory[]).map(cat => (
          <button
            key={cat}
            type="button"
            onClick={() => setCategoryFilter(categoryFilter === cat ? 'all' : cat)}
            className={`rounded-lg border p-2.5 text-left transition-colors ${
              categoryFilter === cat ? 'ring-2 ring-primary' : ''} ${CLIENT_HEALTH_CLASSES[cat]}`}
          >
            <p className="text-lg font-bold tabular-nums leading-none">{distribution[cat] || 0}</p>
            <p className="text-[10px] mt-1 truncate">{CLIENT_HEALTH_LABELS[cat]}</p>
          </button>
        ))}
      </div>

      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Kërko klient…"
            className="pl-9 text-base sm:text-sm"
          />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Të gjitha kategoritë</SelectItem>
            {(Object.keys(CLIENT_HEALTH_LABELS) as ClientHealthCategory[]).map(c => (
              <SelectItem key={c} value={c}>{CLIENT_HEALTH_LABELS[c]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loading && <Card className="h-24 animate-pulse bg-muted/40" />}

      {!loading && filtered.length === 0 && (
        <Card className="p-8 text-center text-sm text-muted-foreground">Pa klientë që përputhen.</Card>
      )}

      <div className="space-y-2">
        {filtered.map(({ customer, health, previousScore }) => {
          const open = expanded === customer.id;
          const delta = previousScore === null ? null : health.score - previousScore;
          return (
            <Card key={customer.id} className="overflow-hidden">
              <button
                type="button"
                onClick={() => setExpanded(open ? null : customer.id)}
                className="w-full p-4 text-left"
              >
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium text-foreground truncate">{customer.name}</p>
                      <Badge variant="outline" className={`text-[10px] ${CLIENT_HEALTH_CLASSES[health.category]}`}>
                        {CLIENT_HEALTH_LABELS[health.category]}
                      </Badge>
                    </div>
                    {health.topRisks.length > 0 && (
                      <p className="text-xs text-muted-foreground mt-1 truncate">
                        Për të rregulluar: {health.topRisks.map(f => f.label).join(', ')}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {delta !== null && Math.abs(delta) >= 1 && (
                      <span className={`text-xs flex items-center gap-1 ${
                        delta > 0 ? 'text-success' : 'text-error'}`}>
                        {delta > 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                        {delta > 0 ? '+' : ''}{delta}
                      </span>
                    )}
                    <div className="text-right">
                      <p className="text-2xl font-bold text-foreground tabular-nums leading-none">{health.score}</p>
                      <p className="text-[10px] text-muted-foreground">nga 100</p>
                    </div>
                    {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" />
                      : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                  </div>
                </div>
              </button>

              {open && (
                <div className="border-t border-border p-4 bg-muted/20 space-y-3">
                  {health.factors.length === 0 ? (
                    <p className="text-sm text-muted-foreground flex items-start gap-2">
                      <Info className="w-4 h-4 shrink-0 mt-0.5" />
                      Pa të dhëna të mjaftueshme për ta kalkuluar shëndetin e këtij klienti.
                    </p>
                  ) : (
                    <>
                      <p className="text-xs text-muted-foreground">
                        Faktorët që formuan rezultatin (vetëm ato me të dhëna hyjnë në kalkulim):
                      </p>
                      <div className="space-y-2">
                        {[...health.factors].sort((a, b) => a.score - b.score).map(f => (
                          <div key={f.key} className="space-y-1">
                            <div className="flex justify-between gap-2 text-sm">
                              <span className="text-foreground truncate">
                                {f.label}
                                {f.detail && <span className="text-muted-foreground"> — {f.detail}</span>}
                              </span>
                              <span className="text-muted-foreground shrink-0 tabular-nums text-xs">
                                {Math.round(f.score * 100)}% · peshë {f.weight} · +{f.impact} pikë
                              </span>
                            </div>
                            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full ${
                                  f.score >= 0.8 ? 'bg-success' : f.score >= 0.5 ? 'bg-warning' : 'bg-error'}`}
                                style={{ width: `${Math.round(f.score * 100)}%` }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                      {health.topRisks.length > 0 && (
                        <div className="border-t border-border pt-3">
                          <p className="text-xs font-medium text-foreground mb-1.5">Prioritetet</p>
                          <ul className="space-y-1">
                            {health.topRisks.map(f => (
                              <li key={f.key} className="text-xs text-muted-foreground flex items-start gap-1.5">
                                <AlertTriangle className="w-3 h-3 text-warning shrink-0 mt-0.5" />
                                {f.label}{f.detail ? ` — ${f.detail}` : ''}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
};

export default ClientHealthView;
