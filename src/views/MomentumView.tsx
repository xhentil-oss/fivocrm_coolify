import React, { useMemo, useState, useEffect } from 'react';
import { useCollection, useMutation, useGlobalTeamId, getGlobalTeamId } from '../hooks/useFirestore';
import { aiResponseError } from '../lib/aiClient';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../contexts/PermissionsContext';
import { useToast } from '../hooks/use-toast';
import { auth } from '../lib/firebase';
import { getTimestampMs } from '../lib/utils';
import { Card } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import {
  Trophy, Target, Clock, TrendingUp, TrendingDown, Zap, Brain,
  CheckCircle2, Sparkles, ChevronDown, Timer, Crown,
  Gauge as GaugeIcon, Loader2, Rocket, ListChecks, Settings2, Flame, Award, Lock,
} from 'lucide-react';
import type {
  Task, TimeEntry, DailyReport, StandupEntry, Goal, TeamMember, DailyFocus, ProductivitySettings,
} from '../types';
import {
  computeMomentum, computeMomentumTrend, DEFAULT_TARGETS,
  type MemberMetrics, type MomentumMember, type MemberStatus, type MomentumTargets,
} from '../lib/productivity/momentum';
import { computeGamification, computeStreakFromDays, type Gamification } from '../lib/productivity/gamification';
import FocusMode from '../components/FocusMode';
import WeeklyReviewPanel from '../components/WeeklyReviewPanel';

// ────────────────────────────────────────────────────────────────────────────
// Small presentational helpers
// ────────────────────────────────────────────────────────────────────────────

const STATUS_META: Record<MemberStatus, { label: string; ring: string; text: string; bg: string }> = {
  winning: { label: 'Po fiton', ring: 'text-green-500', text: 'text-green-600 dark:text-green-400', bg: 'bg-green-100 dark:bg-green-900/30' },
  ontrack: { label: 'Në rrugë', ring: 'text-amber-500', text: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-100 dark:bg-amber-900/30' },
  behind: { label: 'Mbrapa', ring: 'text-red-400', text: 'text-red-600 dark:text-red-400', bg: 'bg-red-100 dark:bg-red-900/30' },
};

function scoreColor(score: number): string {
  if (score >= 70) return 'text-green-500';
  if (score >= 50) return 'text-amber-500';
  return 'text-red-400';
}

/** Circular gauge (same idiom as StaffDashboard). */
const ScoreGauge: React.FC<{ value: number; size?: number; label?: string }> = ({ value, size = 112, label }) => {
  const r = 42;
  const circ = 2 * Math.PI * r;
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg className="-rotate-90" width={size} height={size} viewBox="0 0 100 100">
        <circle cx="50" cy="50" r={r} fill="none" stroke="currentColor" strokeWidth="8" className="text-muted/30" />
        <circle
          cx="50" cy="50" r={r} fill="none" strokeWidth="8" strokeLinecap="round"
          strokeDasharray={`${(value / 100) * circ} ${circ}`}
          className={scoreColor(value)}
          style={{ transition: 'stroke-dasharray 0.6s ease' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold text-foreground">{value}</span>
        {label && <span className="text-[9px] text-muted-foreground uppercase tracking-wider">{label}</span>}
      </div>
    </div>
  );
};

const StatTile: React.FC<{
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  accent?: string;
}> = ({ icon: Icon, label, value, sub, accent = 'text-primary' }) => (
  <Card className="p-4">
    <div className="flex items-start gap-3">
      <div className={`w-9 h-9 rounded-lg bg-muted flex items-center justify-center shrink-0 ${accent}`}>
        <Icon className="w-4 h-4" />
      </div>
      <div className="min-w-0">
        <p className="text-2xl font-bold text-foreground leading-tight">{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
        {sub && <p className="text-[11px] mt-0.5">{sub}</p>}
      </div>
    </div>
  </Card>
);

/** A single 4DX lead-measure bar: green when on target, red when behind. */
const LeadBar: React.FC<{ label: string; value: number; target: number; unit: string; pct: number; onTarget: boolean }> = ({
  label, value, target, unit, pct, onTarget,
}) => (
  <div>
    <div className="flex items-center justify-between text-xs mb-1">
      <span className="text-muted-foreground">{label}</span>
      <span className={onTarget ? 'text-green-600 dark:text-green-400 font-semibold' : 'text-foreground font-medium'}>
        {value}{unit && unit !== '%' ? ` ${unit}` : unit} <span className="text-muted-foreground">/ {target}{unit === '%' ? '%' : ''}</span>
      </span>
    </div>
    <div className="h-2 rounded-full bg-muted overflow-hidden">
      <div
        className={`h-full rounded-full transition-all ${onTarget ? 'bg-green-500' : pct >= 60 ? 'bg-amber-500' : 'bg-red-400'}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  </div>
);

function fmtPct(v: number | null): string {
  return v == null ? '—' : `${Math.round(v * 100)}%`;
}
function trendArrow(now: number, prev: number) {
  if (now > prev) return { icon: TrendingUp, cls: 'text-green-500', text: `+${now - prev}` };
  if (now < prev) return { icon: TrendingDown, cls: 'text-red-400', text: `${now - prev}` };
  return { icon: TrendingUp, cls: 'text-muted-foreground', text: '±0' };
}

// ────────────────────────────────────────────────────────────────────────────
// View
// ────────────────────────────────────────────────────────────────────────────

const MomentumView: React.FC = () => {
  const { user } = useAuth();
  const permissions = usePermissions();
  const { toast } = useToast();
  const activeTeamId = useGlobalTeamId();
  const isLeader = permissions.isAdmin || permissions.isManager || permissions.isOwner;

  const [range, setRange] = useState<'week' | 'month'>('week');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiText, setAiText] = useState<string | null>(null);
  const [focusInput, setFocusInput] = useState('');
  const [focusOpen, setFocusOpen] = useState(false);

  const now = useMemo(() => Date.now(), []);
  const today = useMemo(() => new Date(now).toLocaleDateString('sv'), [now]);

  // ── Data ──
  const { data: rawTasks } = useCollection<Task>('tasks');
  const { data: rawEntries } = useCollection<TimeEntry>('timeEntries');
  const { data: dailyReports } = useCollection<DailyReport>('dailyReports');
  const { data: standups } = useCollection<StandupEntry>('standups');
  const { data: goals } = useCollection<Goal>('goals');
  const { data: userProfiles } = useCollection<any>('userProfiles');
  // Business-scoped (the scoreboard is per-tenant anyway): an unscoped teamMembers
  // read is denied by the hardened rules because it would touch other tenants' staff.
  const { data: teamMembers } = useCollection<TeamMember>('teamMembers', {
    where: [{ field: 'status', operator: '==', value: 'Active' }],
    skipTeamFilter: true,
  });
  const { data: focusDocs } = useCollection<DailyFocus>('dailyFocus', {
    skip: !user,
    where: user ? [{ field: 'userId', operator: '==', value: user.uid }] : undefined,
  });
  const focusMutation = useMutation<DailyFocus>('dailyFocus');
  const { data: settingsDocs } = useCollection<ProductivitySettings>('productivitySettings');
  const settingsMutation = useMutation<ProductivitySettings>('productivitySettings');

  // ── Members (active team; non-leaders see only themselves) ──
  const members: MomentumMember[] = useMemo(() => {
    const getName = (uid: string): string => {
      if (uid === user?.uid) return user?.displayName || 'Ti';
      const p = userProfiles?.find((x: any) => x.userId === uid || x.id === uid);
      if (p?.displayName) return p.displayName;
      const m = teamMembers?.find((x) => x.userId === uid);
      return m?.displayName || m?.email?.split('@')[0] || uid.slice(0, 6);
    };
    let list = (teamMembers || []).filter((m) => m.teamId === activeTeamId);
    if (!isLeader && user) list = list.filter((m) => m.userId === user.uid);
    return list
      .filter((m) => m.userId)
      .map((m) => ({ userId: m.userId, name: getName(m.userId), role: m.role }));
  }, [teamMembers, activeTeamId, isLeader, user, userProfiles]);

  // ── Configurable per-team targets ──
  const teamSettings = useMemo(() => settingsDocs?.find((s) => s.teamId === activeTeamId), [settingsDocs, activeTeamId]);
  const targets: MomentumTargets = useMemo(
    () => ({ ...DEFAULT_TARGETS, ...(teamSettings?.targets || {}) }),
    [teamSettings],
  );

  // ── Window ──
  const { rangeStart, rangeEnd } = useMemo(() => {
    const days = range === 'week' ? 7 : 30;
    return { rangeStart: now - days * 86_400_000 + 1, rangeEnd: now };
  }, [range, now]);

  // ── Momentum ──
  const team = useMemo(
    () =>
      computeMomentum(
        {
          members,
          tasks: rawTasks || [],
          timeEntries: rawEntries || [],
          dailyReports: dailyReports || [],
          standups: standups || [],
          goals: goals || [],
          rangeStart,
          rangeEnd,
          targets,
        },
        now,
      ),
    [members, rawTasks, rawEntries, dailyReports, standups, goals, rangeStart, rangeEnd, now, targets],
  );

  const trend = useMemo(
    () =>
      computeMomentumTrend(
        { members, tasks: rawTasks || [], timeEntries: rawEntries || [], dailyReports: dailyReports || [], standups: standups || [], goals: goals || [], targets },
        now,
        6,
        now,
      ),
    [members, rawTasks, rawEntries, dailyReports, standups, goals, now, targets],
  );

  // ── Streaks (active days across time entries + reports + standups) ──
  const streakByUser = useMemo(() => {
    const map = new Map<string, Set<string>>();
    const add = (uid: string | undefined, key: string | null) => {
      if (!uid || !key) return;
      let s = map.get(uid);
      if (!s) { s = new Set(); map.set(uid, s); }
      s.add(key);
    };
    (rawEntries || []).forEach((e) => {
      const ms = getTimestampMs(e.startTime);
      add(e.userId, ms ? new Date(ms).toLocaleDateString('sv') : null);
    });
    (dailyReports || []).forEach((r) => add(r.userId, r.date || null));
    (standups || []).forEach((s) => add(s.userId, s.date || null));
    return map;
  }, [rawEntries, dailyReports, standups]);

  // ── Gamification per member (Atomic Habits) ──
  const gamiByUser = useMemo(() => {
    const map = new Map<string, Gamification>();
    team.members.forEach((m) => {
      const days = streakByUser.get(m.userId) || new Set<string>();
      map.set(m.userId, computeGamification(m, computeStreakFromDays(days, now)));
    });
    return map;
  }, [team, streakByUser, now]);

  const myMetrics = useMemo(() => team.members.find((m) => m.userId === user?.uid), [team, user]);
  const myGami = user ? gamiByUser.get(user.uid) : undefined;
  const myFocus = useMemo(() => focusDocs?.find((f) => f.date === today), [focusDocs, today]);
  // A frog linked to a real task books its pomodoro on that task's project /
  // client, so the focus hours land in the profitability engine instead of as
  // unattributed internal time.
  const focusTask = useMemo(
    () => (myFocus?.taskId ? (rawTasks || []).find((t) => t.id === myFocus.taskId) : undefined),
    [myFocus?.taskId, rawTasks],
  );

  // ── Bretkosa e Ditës (Eat That Frog) ──
  const saveFocus = async () => {
    const title = focusInput.trim();
    if (!title || !user) return;
    try {
      if (myFocus) await focusMutation.update(myFocus.id, { title });
      else await focusMutation.create({ userId: user.uid, date: today, title, done: false } as any);
      setFocusInput('');
      toast({ title: '🐸 Bretkosa u vendos', description: 'Nise ditën me detyrën më të vështirë.' });
    } catch {
      toast({ title: 'Gabim', description: 'Nuk u ruajt.', variant: 'destructive' });
    }
  };
  const saveTargets = async (t: MomentumTargets) => {
    if (!activeTeamId) return;
    try {
      if (teamSettings) await settingsMutation.update(teamSettings.id, { targets: t } as any);
      else await settingsMutation.create({ teamId: activeTeamId, targets: t } as any);
      toast({ title: '✅ Targetet u ruajtën', description: 'Score-i rillogaritet me targetet e reja.' });
    } catch {
      toast({ title: 'Gabim', description: 'Nuk u ruajtën targetet.', variant: 'destructive' });
    }
  };

  const toggleFocus = async () => {
    if (!myFocus) return;
    try {
      // Un-eating the frog CLEARS completedAt with an explicit null —
      // `undefined` is stripped by removeUndefined(), so the old stamp stayed.
      await focusMutation.update(myFocus.id, { done: !myFocus.done, completedAt: !myFocus.done ? new Date() : null } as any);
      if (!myFocus.done) toast({ title: '🎉 E hëngre bretkosën!', description: 'Pjesa më e vështirë e ditës mbaroi.' });
    } catch { /* ignore */ }
  };

  // ── AI Coach (4DX / The One Thing) ──
  const runCoach = async () => {
    setAiLoading(true);
    setAiText(null);
    try {
      const lines = team.members
        .map(
          (m) =>
            `- ${m.name}: score ${m.productivityScore}/100 (${STATUS_META[m.status].label}); deep work ${m.deepWorkHours}h/${DEFAULT_TARGETS.focusHours}h, sesione ${m.deepWorkSessions}, detyra ${m.tasksCompleted} (javë e kaluar ${m.tasksCompletedPrev}), on-time ${fmtPct(m.onTimeRate)}, cycle ${m.cycleTimeDays ?? '—'}d, saktësi estimimi ${fmtPct(m.estimationAccuracy)}, WIP ${m.wip}, kadencë ${m.reportDays}/${m.expectedReportDays}`,
        )
        .join('\n');
      const content = `Je një koç produktiviteti ekspert (baza: 4 Disciplines of Execution, Deep Work, Atomic Habits). Analizo scoreboard-in e ekipit dhe jep në shqip: (1) 2-3 pika ku ekipi po fiton, (2) rreziku #1 kryesor, (3) "THE ONE THING" — një veprim i vetëm konkret që do rriste produktivitetin këtë javë. Ji i shkurtër dhe i drejtpërdrejtë.\n\nScore ekipi: ${team.teamScore}/100. Anëtarë:\n${lines}`;
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/ai-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ messages: [{ role: 'user', content }], teamId: getGlobalTeamId() }),
      });
      if (!res.ok) throw await aiResponseError(res);
      const data = await res.json();
      setAiText(data.reply || data.message || 'Nuk mund të gjeneroj analizë.');
    } catch (err: any) {
      console.error('[MomentumView] AI coach failed', err);
      toast({ title: 'Gabim AI', description: err?.message || 'Nuk u lidha me AI-n.', variant: 'destructive' });
    } finally {
      setAiLoading(false);
    }
  };

  const throughputTrend = trendArrow(team.totalCompleted, team.totalCompletedPrev);
  const winPct = members.length ? Math.round((team.winningCount / members.length) * 100) : 0;

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-10">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Rocket className="w-6 h-6 text-primary" /> Momentum
          </h1>
          <p className="text-sm text-muted-foreground">
            Qendra e produktivitetit — lead vs lag measures (4DX) · {range === 'week' ? '7 ditët e fundit' : '30 ditët e fundit'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border p-0.5">
            {(['week', 'month'] as const).map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`px-3 py-1.5 text-xs rounded-md transition ${range === r ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >
                {r === 'week' ? 'Javë' : 'Muaj'}
              </button>
            ))}
          </div>
          {isLeader && (
            <Button size="sm" onClick={runCoach} disabled={aiLoading} className="gap-1.5">
              {aiLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Brain className="w-4 h-4" />}
              Koçi AI
            </Button>
          )}
          {isLeader && <TargetsPopover targets={targets} onSave={saveTargets} />}
        </div>
      </div>

      {/* ── "A po fitojmë?" team hero ── */}
      <Card className="overflow-hidden">
        <div className={`p-5 flex flex-col sm:flex-row items-center gap-5 ${team.teamScore >= 70 ? 'bg-green-50 dark:bg-green-950/20' : team.teamScore >= 50 ? 'bg-amber-50 dark:bg-amber-950/20' : 'bg-red-50 dark:bg-red-950/20'}`}>
          <ScoreGauge value={team.teamScore} size={128} label="Ekipi" />
          <div className="flex-1 text-center sm:text-left">
            <div className="flex items-center justify-center sm:justify-start gap-2">
              <GaugeIcon className={`w-5 h-5 ${scoreColor(team.teamScore)}`} />
              <h2 className="text-xl font-bold text-foreground">
                {team.teamScore >= 70 ? 'Po fitojmë 🚀' : team.teamScore >= 50 ? 'Në rrugë të mirë' : 'Duhet fokus'}
              </h2>
            </div>
            <p className="text-sm text-muted-foreground mt-1 max-w-xl">
              {team.winningCount} nga {members.length} anëtarë po e godasin objektivin ({winPct}%). Rezultati llogaritet nga <b>lead measures</b> (orë fokusi, kadencë, planifikim) që ti i kontrollon çdo ditë — dhe <b>lag measures</b> (detyra, on-time) që vijnë pas.
            </p>
          </div>
        </div>
      </Card>

      {/* ── Key measures grid ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile
          icon={Brain} accent="text-indigo-500" label="Orë Deep Work"
          value={`${team.totalDeepWorkHours}h`}
          sub={<span className="text-muted-foreground">nga {team.totalTrackedHours}h të gjurmuara</span>}
        />
        <StatTile
          icon={CheckCircle2} accent="text-green-500" label="Detyra të përfunduara"
          value={team.totalCompleted}
          sub={<span className={throughputTrend.cls + ' inline-flex items-center gap-0.5'}><throughputTrend.icon className="w-3 h-3" />{throughputTrend.text} vs javë e kaluar</span>}
        />
        <StatTile
          icon={Clock} accent="text-blue-500" label="On-time delivery"
          value={fmtPct(team.avgOnTimeRate)}
          sub={<span className="text-muted-foreground">cycle time {team.avgCycleTimeDays ?? '—'} ditë</span>}
        />
        <StatTile
          icon={Target} accent="text-pink-500" label="Saktësi Estimimi"
          value={fmtPct(team.avgEstimationAccuracy)}
          sub={<span className="text-muted-foreground">WIP total: {team.totalWip}</span>}
        />
      </div>

      {/* ── My "Bretkosa e Ditës" (Eat That Frog) ── */}
      {user && (
        <Card className="p-4 border-l-4 border-l-green-500">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-2xl">🐸</span>
              <div>
                <h3 className="text-sm font-semibold text-foreground">Bretkosa e Ditës</h3>
                <p className="text-[11px] text-muted-foreground">Detyra #1 më e rëndësishme — bëje të parën (Eat That Frog · The One Thing)</p>
              </div>
            </div>
            {myFocus ? (
              <button
                onClick={toggleFocus}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition ${myFocus.done ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 line-through' : 'bg-muted hover:bg-muted/70 text-foreground'}`}
              >
                <CheckCircle2 className={`w-4 h-4 ${myFocus.done ? 'text-green-500' : 'text-muted-foreground'}`} />
                {myFocus.title}
              </button>
            ) : (
              <div className="flex items-center gap-2 flex-1 min-w-[220px] max-w-md">
                <input
                  value={focusInput}
                  onChange={(e) => setFocusInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && saveFocus()}
                  placeholder="Cila është bretkosa jote sot?"
                  className="flex-1 h-9 px-3 rounded-lg border bg-background text-sm text-base focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
                <Button size="sm" onClick={saveFocus} disabled={!focusInput.trim()}>Vendos</Button>
              </div>
            )}
            <Button size="sm" variant="outline" className="gap-1.5 shrink-0" onClick={() => setFocusOpen(true)}>
              <Brain className="w-4 h-4" /> Focus Mode
            </Button>
          </div>
        </Card>
      )}

      {/* ── My gamification (Atomic Habits) ── */}
      {myMetrics && myGami && (
        <Card className="p-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-3">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary/20 to-indigo-500/20 flex flex-col items-center justify-center shrink-0">
                <span className="text-[8px] uppercase tracking-wider text-muted-foreground">Niveli</span>
                <span className="text-xl font-bold text-primary leading-none">{myGami.level}</span>
              </div>
              <div>
                <p className="font-semibold text-foreground">{myGami.levelLabel}</p>
                <p className="text-xs text-muted-foreground">
                  {myGami.points} pikë · {myGami.toNextLevel > 0 ? `${myGami.toNextLevel} për nivelin tjetër` : 'niveli maksimal'}
                </p>
                <div className="w-40 h-1.5 bg-muted rounded-full mt-1 overflow-hidden">
                  <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${myGami.progressToNext}%` }} />
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-orange-100 dark:bg-orange-900/30">
              <Flame className="w-5 h-5 text-orange-500" />
              <div>
                <p className="text-lg font-bold leading-none text-foreground">{myGami.streakDays}</p>
                <p className="text-[10px] text-muted-foreground">ditë rresht</p>
              </div>
            </div>
            <div className="flex-1 min-w-[200px]">
              <p className="text-[11px] text-muted-foreground mb-1 flex items-center gap-1">
                <Award className="w-3.5 h-3.5" /> Distinktivët ({myGami.earnedCount}/{myGami.badges.length})
              </p>
              <div className="flex flex-wrap gap-2">
                {myGami.badges.map((b) => (
                  <span
                    key={b.key}
                    title={`${b.label} — ${b.hint}`}
                    className={`text-xl transition ${b.earned ? '' : 'opacity-25 grayscale'}`}
                  >
                    {b.emoji}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* ── Weekly Review (4DX cadence of accountability) ── */}
      {myMetrics && (
        <WeeklyReviewPanel
          metrics={myMetrics}
          gami={myGami || null}
          tasks={rawTasks || []}
          now={now}
          defaultOpen={new Date(now).getDay() === 5}
        />
      )}

      {/* ── Trend chart ── */}
      <Card className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <TrendingUp className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">Trendi javor (6 javë)</h3>
        </div>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={trend} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} className="text-muted-foreground" />
              <YAxis tick={{ fontSize: 11 }} className="text-muted-foreground" />
              <Tooltip
                contentStyle={{ fontSize: 12, borderRadius: 8 }}
                formatter={(v: any, n: any) => [v, n === 'teamScore' ? 'Score ekipi' : n === 'completed' ? 'Detyra' : 'Deep work (h)']}
              />
              <Line type="monotone" dataKey="teamScore" stroke="#0EA5E9" strokeWidth={2.5} dot={{ r: 3 }} name="teamScore" />
              <Line type="monotone" dataKey="completed" stroke="#22c55e" strokeWidth={2} dot={{ r: 2 }} name="completed" />
              <Line type="monotone" dataKey="deepWorkHours" stroke="#6366f1" strokeWidth={2} dot={{ r: 2 }} name="deepWorkHours" strokeDasharray="4 3" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* ── AI Coach panel ── */}
      {aiText && (
        <Card className="p-4 border-l-4 border-l-primary bg-primary/5">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">Koçi i Produktivitetit</h3>
          </div>
          <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">{aiText}</p>
        </Card>
      )}

      {/* ── Leaderboard / scoreboard ── */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Trophy className="w-4 h-4 text-amber-500" />
          <h3 className="text-sm font-semibold text-foreground">
            {isLeader ? 'Scoreboard i Ekipit' : 'Scoreboard Personal'}
          </h3>
        </div>
        {team.members.length === 0 ? (
          <Card className="p-8 text-center text-muted-foreground text-sm">
            Nuk ka anëtarë aktivë për të shfaqur. Sigurohu që ekipi ka staf aktiv.
          </Card>
        ) : (
          <div className="space-y-2">
            {team.members.map((m, i) => (
              <MemberCard
                key={m.userId}
                m={m}
                gami={gamiByUser.get(m.userId)}
                rank={i + 1}
                isMe={m.userId === user?.uid}
                expanded={expanded === m.userId}
                onToggle={() => setExpanded(expanded === m.userId ? null : m.userId)}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Formula footnote (transparency) ── */}
      <p className="text-[11px] text-muted-foreground leading-relaxed">
        <b>Formula (0–100):</b> Fokus 22% · Kadencë 18% · Deep Work 15% · Estimim 15% · On-time 15% · Throughput 15%.
        Ndarja lead/lag ndjek <i>The 4 Disciplines of Execution</i>; orët e fokusit <i>Deep Work</i>; kadenca <i>Atomic Habits</i>; cycle time & WIP <i>Kanban / Little's Law</i>.
      </p>

      {/* Focus Mode overlay (Deep Work) */}
      <FocusMode
        open={focusOpen}
        onClose={() => setFocusOpen(false)}
        taskTitle={myFocus?.title || 'Deep Work'}
        taskId={myFocus?.taskId}
        projectId={focusTask?.projectId || undefined}
        customerId={focusTask?.customerId || (focusTask as any)?.relatedCustomerId || undefined}
      />
    </div>
  );
};

// ────────────────────────────────────────────────────────────────────────────
// Member card (collapsed row + expandable detail)
// ────────────────────────────────────────────────────────────────────────────

const RANK_ICON = [Crown, Trophy, Trophy];

const MemberCard: React.FC<{
  m: MemberMetrics;
  gami?: Gamification;
  rank: number;
  isMe: boolean;
  expanded: boolean;
  onToggle: () => void;
}> = ({ m, gami, rank, isMe, expanded, onToggle }) => {
  const meta = STATUS_META[m.status];
  const RankIcon = rank <= 3 ? RANK_ICON[rank - 1] : null;
  const tp = trendArrow(m.tasksCompleted, m.tasksCompletedPrev);

  return (
    <Card className={`overflow-hidden transition ${isMe ? 'ring-2 ring-primary/40' : ''}`}>
      <button onClick={onToggle} className="w-full p-3 sm:p-4 flex items-center gap-3 text-left hover:bg-muted/40 transition">
        {/* Rank */}
        <div className="w-8 text-center shrink-0">
          {RankIcon ? (
            <RankIcon className={`w-5 h-5 mx-auto ${rank === 1 ? 'text-amber-500' : rank === 2 ? 'text-slate-400' : 'text-orange-400'}`} />
          ) : (
            <span className="text-sm font-semibold text-muted-foreground">{rank}</span>
          )}
        </div>

        {/* Gauge */}
        <div className="shrink-0">
          <ScoreGauge value={m.productivityScore} size={56} />
        </div>

        {/* Name + status */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-foreground truncate">{m.name}</span>
            {isMe && <Badge variant="secondary" className="text-[10px]">Ti</Badge>}
            <span className={`text-[11px] px-2 py-0.5 rounded-full ${meta.bg} ${meta.text} font-medium`}>{meta.label}</span>
            {gami && <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">Niv {gami.level}</span>}
          </div>
          <div className="flex items-center gap-3 mt-1 text-[11px] text-muted-foreground flex-wrap">
            <span className="inline-flex items-center gap-1"><Brain className="w-3 h-3" />{m.deepWorkHours}h</span>
            <span className="inline-flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />{m.tasksCompleted}</span>
            <span className={`inline-flex items-center gap-1 ${tp.cls}`}><tp.icon className="w-3 h-3" />{tp.text}</span>
            <span className="inline-flex items-center gap-1"><Clock className="w-3 h-3" />{fmtPct(m.onTimeRate)}</span>
            <span className="inline-flex items-center gap-1"><Timer className="w-3 h-3" />WIP {m.wip}</span>
            {gami && gami.streakDays > 0 && (
              <span className="inline-flex items-center gap-1 text-orange-500"><Flame className="w-3 h-3" />{gami.streakDays}</span>
            )}
            {gami && gami.earnedCount > 0 && (
              <span className="inline-flex items-center gap-0.5">{gami.badges.filter(b => b.earned).slice(0, 4).map(b => <span key={b.key}>{b.emoji}</span>)}</span>
            )}
          </div>
        </div>

        <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>

      {expanded && (
        <div className="border-t p-4 grid md:grid-cols-2 gap-5 bg-muted/20">
          {/* 4DX lead-measure scoreboard */}
          <div>
            <h4 className="text-xs font-semibold text-foreground mb-3 flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5 text-amber-500" /> Lead measures — çfarë kontrollon
            </h4>
            <div className="space-y-3">
              {m.leadMeasures.map((l) => (
                <LeadBar key={l.key} label={l.label} value={l.value} target={l.target} unit={l.unit} pct={l.pct} onTarget={l.onTarget} />
              ))}
            </div>
          </div>

          {/* Lag / measurability */}
          <div>
            <h4 className="text-xs font-semibold text-foreground mb-3 flex items-center gap-1.5">
              <ListChecks className="w-3.5 h-3.5 text-blue-500" /> Lag measures — rezultatet
            </h4>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <Metric label="Detyra (javë)" value={`${m.tasksCompleted}`} sub={`para: ${m.tasksCompletedPrev}`} />
              <Metric label="On-time" value={fmtPct(m.onTimeRate)} />
              <Metric label="Cycle time" value={m.cycleTimeDays != null ? `${m.cycleTimeDays} ditë` : '—'} />
              <Metric label="Saktësi estimimi" value={fmtPct(m.estimationAccuracy)} sub={m.avgEstimatedHours != null ? `${m.avgEstimatedHours}h → ${m.avgActualHours}h` : undefined} />
              <Metric label="Focus ratio" value={m.focusRatio != null ? `${Math.round(m.focusRatio * 100)}%` : '—'} />
              <Metric label="WIP tani" value={`${m.wip}`} sub={m.wip > 5 ? '⚠ mbingarkesë' : undefined} />
            </div>
            {/* Sub-score breakdown */}
            <div className="mt-4 pt-3 border-t">
              <p className="text-[11px] text-muted-foreground mb-2">Zbërthimi i score-it</p>
              <div className="flex flex-wrap gap-1.5">
                <SubScore label="Fokus" v={m.scoreFocus} />
                <SubScore label="Kadencë" v={m.scoreConsistency} />
                <SubScore label="Deep Work" v={m.scoreDeepWork} />
                <SubScore label="On-time" v={m.scoreOnTime} />
                <SubScore label="Throughput" v={m.scoreThroughput} />
                <SubScore label="Estimim" v={m.scoreEstimation} />
              </div>
            </div>
          </div>

          {/* Badges & level (gamification) */}
          {gami && (
            <div className="md:col-span-2 pt-3 border-t">
              <p className="text-xs font-semibold text-foreground mb-2 flex items-center gap-1.5">
                <Award className="w-3.5 h-3.5 text-amber-500" /> Niveli {gami.level} · {gami.levelLabel} · {gami.points} pikë
              </p>
              <div className="flex flex-wrap gap-1.5">
                {gami.badges.map((b) => (
                  <span
                    key={b.key}
                    title={b.hint}
                    className={`inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border ${b.earned ? 'bg-muted text-foreground' : 'opacity-45 text-muted-foreground'}`}
                  >
                    <span className={b.earned ? '' : 'grayscale'}>{b.emoji}</span> {b.label}
                    {!b.earned && <Lock className="w-2.5 h-2.5" />}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
};

const Metric: React.FC<{ label: string; value: string; sub?: string }> = ({ label, value, sub }) => (
  <div>
    <p className="text-lg font-bold text-foreground leading-tight">{value}</p>
    <p className="text-[11px] text-muted-foreground">{label}</p>
    {sub && <p className="text-[10px] text-muted-foreground/80">{sub}</p>}
  </div>
);

const SubScore: React.FC<{ label: string; v: number }> = ({ label, v }) => (
  <span className={`text-[10px] px-2 py-1 rounded-md font-medium ${v >= 70 ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' : v >= 50 ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400' : 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400'}`}>
    {label} {v}
  </span>
);

// ────────────────────────────────────────────────────────────────────────────
// Per-team targets editor (admins) — makes the score fair to each team's reality
// ────────────────────────────────────────────────────────────────────────────

const TargetsPopover: React.FC<{ targets: MomentumTargets; onSave: (t: MomentumTargets) => void }> = ({ targets, onSave }) => {
  const [t, setT] = useState<MomentumTargets>(targets);
  useEffect(() => setT(targets), [targets]);

  const fields: { key: keyof MomentumTargets; label: string }[] = [
    { key: 'focusHours', label: 'Orë fokusi / javë' },
    { key: 'deepWorkSessions', label: 'Sesione deep work / javë' },
    { key: 'reportDays', label: 'Ditë raportimi / javë' },
    { key: 'throughput', label: 'Detyra / javë' },
    { key: 'minSessionMinutes', label: 'Min. minuta për sesion' },
  ];

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5">
          <Settings2 className="w-4 h-4" /> Targetet
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72" align="end">
        <p className="text-sm font-semibold text-foreground mb-1">Targetet e ekipit</p>
        <p className="text-[11px] text-muted-foreground mb-3">
          Score-i i produktivitetit llogaritet kundrejt këtyre vlerave. Përshtati sipas realitetit të ekipit tënd.
        </p>
        <div className="space-y-2">
          {fields.map((f) => (
            <div key={f.key} className="flex items-center justify-between gap-2">
              <Label className="text-xs">{f.label}</Label>
              <Input
                type="number"
                className="h-8 w-20"
                value={t[f.key] as number}
                onChange={(e) => setT((prev) => ({ ...prev, [f.key]: e.target.value === '' ? 0 : parseFloat(e.target.value) || 0 }))}
              />
            </div>
          ))}
          <div className="flex items-center justify-between gap-2">
            <Label className="text-xs">Mbulim estimimi (%)</Label>
            <Input
              type="number"
              className="h-8 w-20"
              value={Math.round((t.estimateCoverage || 0) * 100)}
              onChange={(e) => setT((prev) => ({ ...prev, estimateCoverage: Math.max(0, Math.min(1, (parseFloat(e.target.value) || 0) / 100)) }))}
            />
          </div>
        </div>
        <Button size="sm" className="w-full mt-3" onClick={() => onSave(t)}>Ruaj Targetet</Button>
      </PopoverContent>
    </Popover>
  );
};

export default MomentumView;
