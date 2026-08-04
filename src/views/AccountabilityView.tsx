/**
 * Team accountability dashboard.
 *
 * The product constraint from the spec (§8) is honoured literally: this screen leads
 * with CONTEXT and TRENDS, not with a ranking. The optional composite score is
 * behind a toggle, always displayed with `COMPOSITE_WARNING`, and never used to sort
 * people. What IS sorted is "who needs support", with the reasons written out — a
 * manager's actionable list rather than a leaderboard.
 *
 * Everything is computed from data the CRM already has (daily reports, tasks, time
 * entries), so there is nothing extra for anyone to fill in.
 */

import React, { useMemo, useState } from 'react';
import {
  AlertTriangle, ChevronLeft, ChevronRight, Clock, Info, TrendingDown, TrendingUp,
  Minus, Users,
} from 'lucide-react';
import { Card } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Switch } from '../components/ui/switch';
import { Label } from '../components/ui/label';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../contexts/PermissionsContext';
import { useCollection } from '../hooks/useFirestore';
import { useUserNames } from '../hooks/useUserNames';
import {
  COMPOSITE_WARNING, compositeScore, computeEmployeeMetrics, computeTrend,
  flagNeedsAttention, submissionRate, summariseTeam,
} from '../lib/reporting/accountability';
import { buildPeriod, formatPeriodLabel, previousPeriod } from '../lib/reporting/period';
import { canSeeEmployeeMetrics, reportingCapabilitiesFor } from '../lib/reporting/permissions';
import type { DailyReport, Report, Task, TeamMember, TimeEntry } from '../types';

const AccountabilityView: React.FC = () => {
  const { user } = useAuth();
  const permissions = usePermissions();
  const [weekOffset, setWeekOffset] = useState(0);
  const [showComposite, setShowComposite] = useState(false);

  const { data: teamMembers } = useCollection<TeamMember>('teamMembers', { skipTeamFilter: true });
  const { data: dailyReports, loading } = useCollection<DailyReport>('dailyReports');
  const { data: tasks } = useCollection<Task>('tasks');
  const { data: timeEntries } = useCollection<TimeEntry>('timeEntries');
  const { data: reports } = useCollection<Report>('reports');
  const { getName } = useUserNames(teamMembers);

  const viewer = useMemo(() => ({
    userId: user?.uid || null,
    role: permissions.role,
    isManagement: permissions.isAdmin || permissions.isOwner || permissions.isManager || permissions.isSuperAdmin,
    capabilities: reportingCapabilitiesFor(permissions.role, permissions as any),
  }), [user?.uid, permissions]);

  const now = useMemo(() => new Date(), []);
  const period = useMemo(() => {
    const d = new Date(now);
    d.setDate(d.getDate() + weekOffset * 7);
    return buildPeriod('weekly', d.toISOString().slice(0, 10));
  }, [now, weekOffset]);
  const prev = useMemo(() => previousPeriod(period), [period]);

  /** Only people this viewer is allowed to see. A Member sees only themselves. */
  const members = useMemo(
    () => (teamMembers || [])
      .filter(m => m.status === 'Active' && m.teamId === permissions.teamId)
      .filter(m => canSeeEmployeeMetrics(m.userId, viewer)),
    [teamMembers, permissions.teamId, viewer],
  );

  const rows = useMemo(() => members.map(m => {
    const input = {
      userId: m.userId,
      dailyReports: dailyReports || [],
      reports: reports || [],
      tasks: (tasks || []).filter(t => t.assignedToUserId === m.userId),
      timeEntries: (timeEntries || []).filter(t => t.userId === m.userId),
      now: weekOffset < 0 ? new Date(`${period.end}T23:59:59Z`) : now,
    };
    return {
      member: m,
      metrics: computeEmployeeMetrics({ ...input, period }),
      previous: computeEmployeeMetrics({ ...input, period: prev, now: new Date(`${prev.end}T23:59:59Z`) }),
    };
  }), [members, dailyReports, reports, tasks, timeEntries, period, prev, now, weekOffset]);

  const team = useMemo(
    () => summariseTeam(rows.map(r => ({ userId: r.member.userId, metrics: r.metrics }))),
    [rows],
  );
  const flags = useMemo(
    () => flagNeedsAttention(rows.map(r => ({ userId: r.member.userId, metrics: r.metrics }))),
    [rows],
  );

  const submissionTrend = computeTrend(
    team.submissionRate,
    summariseTeam(rows.map(r => ({ userId: r.member.userId, metrics: r.previous }))).submissionRate,
    true,
  );

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-6xl mx-auto">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Përgjegjshmëria e ekipit</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Kontekst dhe trende — të kalkuluara nga raportet ditore, detyrat dhe orari.
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={() => setWeekOffset(w => w - 1)} aria-label="Java e mëparshme">
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <span className="text-sm font-medium text-foreground px-1 min-w-[190px] text-center">
            {formatPeriodLabel(period)}
          </span>
          <Button
            variant="ghost" size="icon" disabled={weekOffset >= 0}
            onClick={() => setWeekOffset(w => Math.min(0, w + 1))} aria-label="Java tjetër"
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Team summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile
          label="Norma e dorëzimit"
          value={team.submissionRate === null ? '—' : `${Math.round(team.submissionRate * 100)}%`}
          sub={`${team.submittedReports}/${team.expectedReports} raporte`}
          trend={submissionTrend.direction}
        />
        <Tile
          label="Mungojnë"
          value={String(team.missingReports)}
          sub={`${team.lateReports} të vonuara`}
          tone={team.missingReports > 0 ? 'error' : undefined}
        />
        <Tile
          label="Bllokues të pazgjidhur"
          value={String(team.unresolvedBlockers)}
          sub={`${team.overdueTasks} detyra vonuar`}
          tone={team.unresolvedBlockers > 0 ? 'warning' : undefined}
        />
        <Tile
          label="Orë të faturueshme"
          value={team.billableHours === null ? '—' : `${team.billableHours}h`}
          sub={team.billableHours === null
            ? `${team.totalHours}h gjithsej · ndarja nuk matet`
            : team.billableUtilisation === null
              ? `${team.totalHours}h gjithsej`
              : `${Math.round(team.billableUtilisation * 100)}% e ${team.totalHours}h`
              + (team.membersWithMeasuredHours < team.members
                ? ` · ${team.membersWithMeasuredHours}/${team.members} të matur` : '')}
        />
      </div>

      <Tabs defaultValue="attention">
        <TabsList>
          <TabsTrigger value="attention">Kërkojnë vëmendje ({flags.length})</TabsTrigger>
          <TabsTrigger value="people" className="gap-1.5">
            <Users className="w-3.5 h-3.5" /> Të gjithë ({rows.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="attention" className="mt-4 space-y-2">
          {flags.length === 0 && (
            <Card className="p-8 text-center">
              <p className="text-sm text-muted-foreground">
                Asnjë sinjal që kërkon vëmendje këtë javë.
              </p>
            </Card>
          )}
          {flags.map(f => (
            <Card key={f.userId} className={`p-4 border-l-4 ${
              f.severity === 'high' ? 'border-l-error' : 'border-l-warning'}`}>
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <p className="font-medium text-foreground">{getName(f.userId)}</p>
                  <ul className="mt-1.5 space-y-1">
                    {f.reasons.map((r, i) => (
                      <li key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                        <AlertTriangle className={`w-3 h-3 shrink-0 mt-0.5 ${
                          f.severity === 'high' ? 'text-error' : 'text-warning'}`} />
                        {r}
                      </li>
                    ))}
                  </ul>
                </div>
                <Badge variant="outline" className={`text-[10px] shrink-0 ${
                  f.severity === 'high'
                    ? 'bg-error/10 text-error border-error/30'
                    : 'bg-warning/10 text-warning border-warning/30'}`}>
                  {f.severity === 'high' ? 'prioritet' : 'vëzhgo'}
                </Badge>
              </div>
            </Card>
          ))}
          <Card className="p-3 bg-muted/30">
            <p className="text-[11px] text-muted-foreground flex items-start gap-1.5">
              <Info className="w-3 h-3 shrink-0 mt-0.5" />
              Kjo listë tregon sinjale, jo gjykime. Mbingarkesa dhe bllokuesit shpesh kërkojnë
              ndihmë nga menaxhimi, jo presion mbi personin.
            </p>
          </Card>
        </TabsContent>

        <TabsContent value="people" className="mt-4 space-y-3">
          {viewer.isManagement && (
            <div className="flex items-center gap-2">
              <Switch checked={showComposite} onCheckedChange={setShowComposite} id="composite" />
              <Label htmlFor="composite" className="text-xs cursor-pointer">
                Shfaq rezultatin e përbërë (opsional)
              </Label>
            </div>
          )}
          {showComposite && (
            <Card className="p-3 border-warning/40 bg-warning/5">
              <p className="text-[11px] text-warning flex items-start gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                {COMPOSITE_WARNING}
              </p>
            </Card>
          )}

          {loading && <Card className="h-24 animate-pulse bg-muted/40" />}

          {rows.map(({ member, metrics, previous }) => {
            const rate = submissionRate(metrics);
            const prevRate = submissionRate(previous);
            const trend = computeTrend(rate, prevRate, true);
            const composite = showComposite ? compositeScore(metrics) : null;
            return (
              <Card key={member.id} className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <p className="font-medium text-foreground">
                      {member.displayName || member.email || getName(member.userId)}
                    </p>
                    <p className="text-xs text-muted-foreground">{member.role}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <TrendIcon direction={trend.direction} />
                    <span className="text-sm font-semibold text-foreground tabular-nums">
                      {rate === null ? '—' : `${Math.round(rate * 100)}%`}
                    </span>
                    {composite !== null && (
                      <Badge variant="outline" className="text-[10px]">score {composite}</Badge>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  <Metric label="Raporte" value={`${metrics.submittedDailyReports}/${metrics.expectedDailyReports}`} />
                  <Metric label="Mungojnë" value={String(metrics.missingDailyReports)}
                    tone={metrics.missingDailyReports > 0 ? 'error' : undefined} />
                  <Metric label="Vonuar" value={String(metrics.lateDailyReports)} />
                  <Metric label="Detyra kryer" value={String(metrics.tasksCompleted)} />
                  <Metric label="Detyra vonuar" value={String(metrics.tasksOverdue)}
                    tone={metrics.tasksOverdue > 4 ? 'warning' : undefined} />
                  <Metric label="Orë" value={`${metrics.hoursWorked}h`} />
                  <Metric
                    label="Faturueshme"
                    value={metrics.billableHours === null ? '—' : `${metrics.billableHours}h`}
                  />
                  <Metric
                    label="Utilizim"
                    value={metrics.utilisationRate === null ? '—' : `${Math.round(metrics.utilisationRate * 100)}%`}
                    tone={metrics.utilisationRate !== null && metrics.utilisationRate > 1.1 ? 'warning' : undefined}
                  />
                  <Metric label="Bllokues" value={`${metrics.blockersUnresolved}/${metrics.blockersReported}`} />
                  <Metric
                    label="Zgjidhja e bllokuesve"
                    value={metrics.avgBlockerResolutionHours === null ? '—' : `${metrics.avgBlockerResolutionHours}h`}
                  />
                  <Metric label="Afate humbur" value={String(metrics.missedDeadlines)} />
                  <Metric
                    label="Vonesa dorëzimi"
                    value={metrics.avgSubmissionDelayMinutes === null ? '—'
                      : `${Math.round(metrics.avgSubmissionDelayMinutes)} min`}
                  />
                </div>
              </Card>
            );
          })}

          {rows.length === 0 && !loading && (
            <Card className="p-8 text-center text-sm text-muted-foreground">
              Pa anëtarë të dukshëm për ju.
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
};

const Tile: React.FC<{
  label: string;
  value: string;
  sub?: string;
  tone?: 'error' | 'warning';
  trend?: 'improving' | 'declining' | 'stable' | 'unknown';
}> = ({ label, value, sub, tone, trend }) => (
  <Card className="p-4">
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <p className={`text-xl font-bold tabular-nums ${
          tone === 'error' ? 'text-error' : tone === 'warning' ? 'text-warning' : 'text-foreground'}`}>
          {value}
        </p>
        <p className="text-xs text-muted-foreground mt-1">{label}</p>
        {sub && <p className="text-[11px] text-muted-foreground/80 mt-0.5 truncate">{sub}</p>}
      </div>
      {trend && <TrendIcon direction={trend} />}
    </div>
  </Card>
);

const TrendIcon: React.FC<{ direction: 'improving' | 'declining' | 'stable' | 'unknown' }> = ({ direction }) => {
  if (direction === 'improving') return <TrendingUp className="w-4 h-4 text-success shrink-0" aria-label="në përmirësim" />;
  if (direction === 'declining') return <TrendingDown className="w-4 h-4 text-error shrink-0" aria-label="në ulje" />;
  if (direction === 'stable') return <Minus className="w-4 h-4 text-muted-foreground shrink-0" aria-label="stabil" />;
  return <Clock className="w-4 h-4 text-muted-foreground/50 shrink-0" aria-label="pa të dhëna" />;
};

const Metric: React.FC<{ label: string; value: string; tone?: 'error' | 'warning' }> = ({ label, value, tone }) => (
  <div className="rounded-md bg-muted/40 px-2 py-1.5">
    <p className={`font-semibold tabular-nums ${
      tone === 'error' ? 'text-error' : tone === 'warning' ? 'text-warning' : 'text-foreground'}`}>
      {value}
    </p>
    <p className="text-[10px] text-muted-foreground truncate">{label}</p>
  </div>
);

export default AccountabilityView;
