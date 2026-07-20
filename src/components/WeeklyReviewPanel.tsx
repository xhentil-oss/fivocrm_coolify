import React, { useMemo, useState, useEffect } from 'react';
import { useCollection, useMutation } from '../hooks/useFirestore';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../hooks/use-toast';
import { getTimestampMs } from '../lib/utils';
import { Card } from './ui/card';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { CalendarCheck, ChevronDown, TrendingUp, TrendingDown, Trophy, AlertTriangle, Flag, Save, Brain, CheckCircle2, Flame } from 'lucide-react';
import type { Task, WeeklyReview } from '../types';
import type { MemberMetrics } from '../lib/productivity/momentum';
import type { Gamification } from '../lib/productivity/gamification';

/** ISO-8601 week key, e.g. "2026-W30". */
function isoWeekKey(ms: number): string {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7)); // Thursday decides the year
  const week1 = new Date(date.getFullYear(), 0, 4);
  const weekNo = 1 + Math.round(((date.getTime() - week1.getTime()) / 86_400_000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
  return `${date.getFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

/**
 * Weekly Review — the 4DX cadence of accountability + GTD weekly review, as a
 * ritual: auto-generated wins/risks from the week's data, three reflection
 * prompts, and next week's WIG. Persisted per user per ISO week.
 */
const WeeklyReviewPanel: React.FC<{
  metrics: MemberMetrics | null;
  gami: Gamification | null;
  tasks: (Task & { id: string })[];
  now: number;
  defaultOpen?: boolean;
}> = ({ metrics, gami, tasks, now, defaultOpen }) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [open, setOpen] = useState(!!defaultOpen);
  const weekKey = useMemo(() => isoWeekKey(now), [now]);

  const { data: reviews } = useCollection<WeeklyReview>('weeklyReviews', {
    skip: !user,
    where: user ? [{ field: 'userId', operator: '==', value: user.uid }] : undefined,
  });
  const reviewMutation = useMutation<WeeklyReview>('weeklyReviews');

  const current = useMemo(() => reviews?.find((r) => r.weekKey === weekKey), [reviews, weekKey]);
  const past = useMemo(
    () => (reviews || []).filter((r) => r.weekKey !== weekKey).sort((a, b) => b.weekKey.localeCompare(a.weekKey)).slice(0, 4),
    [reviews, weekKey],
  );

  const [wins, setWins] = useState('');
  const [improve, setImprove] = useState('');
  const [nextWig, setNextWig] = useState('');
  useEffect(() => {
    setWins(current?.wins || '');
    setImprove(current?.improve || '');
    setNextWig(current?.nextWig || '');
  }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Overdue tasks assigned to me (a headline risk).
  const overdue = useMemo(() => {
    if (!user) return 0;
    return (tasks || []).filter((t) => {
      if (t.assignedToUserId !== user.uid || t.status === 'Done' || t.parentTaskId) return false;
      const due = getTimestampMs((t as any).endDate) || getTimestampMs(t.dueDate);
      return due > 0 && due < now;
    }).length;
  }, [tasks, user, now]);

  if (!user || !metrics) return null;

  const throughputUp = metrics.tasksCompleted >= metrics.tasksCompletedPrev;

  const save = async () => {
    try {
      const payload = { wins, improve, nextWig, scoreSnapshot: metrics.productivityScore };
      if (current) await reviewMutation.update(current.id, payload as any);
      else await reviewMutation.create({ userId: user.uid, weekKey, ...payload } as any);
      toast({ title: '✅ Weekly Review u ruajt', description: 'Kadenca e llogaridhënies — vazhdo javë pas jave.' });
    } catch {
      toast({ title: 'Gabim', description: 'Nuk u ruajt review-i.', variant: 'destructive' });
    }
  };

  const wins_auto: { icon: React.ComponentType<{ className?: string }>; text: string }[] = [];
  if (metrics.tasksCompleted > 0) wins_auto.push({ icon: CheckCircle2, text: `${metrics.tasksCompleted} detyra të përfunduara${throughputUp ? ' (në rritje)' : ''}` });
  if (metrics.deepWorkHours >= 5) wins_auto.push({ icon: Brain, text: `${metrics.deepWorkHours}h punë e thellë` });
  if (gami && gami.streakDays >= 3) wins_auto.push({ icon: Flame, text: `${gami.streakDays} ditë rresht aktiv` });
  if (gami && gami.earnedCount > 0) wins_auto.push({ icon: Trophy, text: `${gami.earnedCount} distinktivë të fituar` });
  if (metrics.onTimeRate != null && metrics.onTimeRate >= 0.8) wins_auto.push({ icon: TrendingUp, text: `${Math.round(metrics.onTimeRate * 100)}% dorëzime në kohë` });

  const risks_auto: { icon: React.ComponentType<{ className?: string }>; text: string }[] = [];
  if (overdue > 0) risks_auto.push({ icon: AlertTriangle, text: `${overdue} detyra të vonuara` });
  if (metrics.reportDays < metrics.expectedReportDays) risks_auto.push({ icon: AlertTriangle, text: `Kadencë e ulët raportimi (${metrics.reportDays}/${metrics.expectedReportDays})` });
  if (metrics.wip > 5) risks_auto.push({ icon: AlertTriangle, text: `WIP i lartë (${metrics.wip}) — shumë punë njëkohësisht` });
  if (!throughputUp) risks_auto.push({ icon: TrendingDown, text: `Throughput në rënie vs java e kaluar` });
  if (metrics.estimationAccuracy != null && metrics.estimationAccuracy < 0.6) risks_auto.push({ icon: AlertTriangle, text: `Saktësi e ulët estimimi (${Math.round(metrics.estimationAccuracy * 100)}%)` });

  return (
    <Card className="overflow-hidden">
      <button onClick={() => setOpen((v) => !v)} className="w-full p-4 flex items-center justify-between hover:bg-muted/40 transition">
        <div className="flex items-center gap-2">
          <CalendarCheck className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">Weekly Review</h3>
          <span className="text-[11px] text-muted-foreground">{weekKey}</span>
          {current && <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">Ruajtur</span>}
        </div>
        <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="border-t p-4 space-y-5">
          {/* Auto summary */}
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <p className="text-xs font-semibold text-green-600 dark:text-green-400 mb-2 flex items-center gap-1.5"><Trophy className="w-3.5 h-3.5" /> Fitoret e javës</p>
              {wins_auto.length ? (
                <ul className="space-y-1.5">
                  {wins_auto.map((w, i) => (
                    <li key={i} className="flex items-center gap-2 text-sm text-foreground"><w.icon className="w-3.5 h-3.5 text-green-500 shrink-0" />{w.text}</li>
                  ))}
                </ul>
              ) : <p className="text-sm text-muted-foreground">Ende pa fitore të matshme këtë javë.</p>}
            </div>
            <div>
              <p className="text-xs font-semibold text-amber-600 dark:text-amber-400 mb-2 flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" /> Për t'u përmirësuar</p>
              {risks_auto.length ? (
                <ul className="space-y-1.5">
                  {risks_auto.map((r, i) => (
                    <li key={i} className="flex items-center gap-2 text-sm text-foreground"><r.icon className="w-3.5 h-3.5 text-amber-500 shrink-0" />{r.text}</li>
                  ))}
                </ul>
              ) : <p className="text-sm text-muted-foreground">Asnjë sinjal rreziku 🎉</p>}
            </div>
          </div>

          {/* Reflection */}
          <div className="space-y-3 pt-1">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Çfarë shkoi mirë?</label>
              <Textarea value={wins} onChange={(e) => setWins(e.target.value)} rows={2} placeholder="Reflekto mbi javën…" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Çfarë do përmirësoj?</label>
              <Textarea value={improve} onChange={(e) => setImprove(e.target.value)} rows={2} placeholder="Një ose dy gjëra konkrete…" />
            </div>
            <div>
              <label className="text-xs font-medium text-primary mb-1 flex items-center gap-1.5"><Flag className="w-3.5 h-3.5" /> THE ONE THING për javën tjetër (WIG)</label>
              <Textarea value={nextWig} onChange={(e) => setNextWig(e.target.value)} rows={2} placeholder="Objektivi më i rëndësishëm i javës që vjen…" className="border-primary/40" />
            </div>
            <Button onClick={save} className="gap-2"><Save className="w-4 h-4" /> Ruaj Weekly Review</Button>
          </div>

          {/* History */}
          {past.length > 0 && (
            <div className="pt-3 border-t">
              <p className="text-xs font-semibold text-muted-foreground mb-2">Review-t e mëparshme</p>
              <div className="space-y-2">
                {past.map((r) => (
                  <div key={r.id} className="text-xs p-2 rounded-lg bg-muted/40">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-foreground">{r.weekKey}</span>
                      {r.scoreSnapshot != null && <span className="text-muted-foreground">score {r.scoreSnapshot}</span>}
                    </div>
                    {r.nextWig && <p className="text-muted-foreground mt-0.5 flex items-start gap-1"><Flag className="w-3 h-3 mt-0.5 shrink-0 text-primary" />{r.nextWig}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
};

export default WeeklyReviewPanel;
