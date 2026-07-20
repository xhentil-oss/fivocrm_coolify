import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCollection, useMutation, useGlobalTeamId } from '../hooks/useFirestore';
import { useAuth } from '../contexts/AuthContext';
import { getTimestampMs } from '../lib/utils';
import { Card } from './ui/card';
import { Button } from './ui/button';
import { Rocket, ArrowRight, Flame, Brain, CheckCircle2, ChevronRight } from 'lucide-react';
import type { Task, TimeEntry, DailyReport, DailyFocus, ProductivitySettings } from '../types';
import { computeMomentum, DEFAULT_TARGETS, type MomentumTargets } from '../lib/productivity/momentum';
import { computeGamification, computeStreakFromDays } from '../lib/productivity/gamification';
import FocusMode from './FocusMode';

/**
 * Compact Momentum snapshot for the dashboard — surfaces the productivity system
 * where people already look every day (adoption > features). Reuses the data the
 * dashboard already loaded (passed as props) and only self-loads the tiny extras
 * (today's frog + team targets) to avoid doubling Firestore reads on the busiest
 * page.
 */
const MomentumWidget: React.FC<{
  tasks: (Task & { id: string })[];
  timeEntries: (TimeEntry & { id: string })[];
  dailyReports: (DailyReport & { id: string })[];
}> = ({ tasks, timeEntries, dailyReports }) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const activeTeamId = useGlobalTeamId();
  const now = useMemo(() => Date.now(), []);
  const today = useMemo(() => new Date(now).toLocaleDateString('sv'), [now]);

  const { data: focusDocs } = useCollection<DailyFocus>('dailyFocus', {
    skip: !user,
    where: user ? [{ field: 'userId', operator: '==', value: user.uid }] : undefined,
  });
  const { data: settingsDocs } = useCollection<ProductivitySettings>('productivitySettings');
  const focusMutation = useMutation<DailyFocus>('dailyFocus');

  const [focusInput, setFocusInput] = useState('');
  const [focusOpen, setFocusOpen] = useState(false);

  const targets: MomentumTargets = useMemo(() => {
    const s = settingsDocs?.find((x) => x.teamId === activeTeamId);
    return { ...DEFAULT_TARGETS, ...(s?.targets || {}) };
  }, [settingsDocs, activeTeamId]);

  const metrics = useMemo(() => {
    if (!user) return null;
    const team = computeMomentum(
      {
        members: [{ userId: user.uid, name: user.displayName || 'Ti' }],
        tasks: tasks || [],
        timeEntries: timeEntries || [],
        dailyReports: dailyReports || [],
        rangeStart: now - 7 * 86_400_000 + 1,
        rangeEnd: now,
        targets,
      },
      now,
    );
    return team.members[0] || null;
  }, [user, tasks, timeEntries, dailyReports, targets, now]);

  const gami = useMemo(() => {
    if (!metrics || !user) return null;
    const days = new Set<string>();
    (timeEntries || []).forEach((e) => {
      if (e.userId !== user.uid) return;
      const ms = getTimestampMs(e.startTime);
      if (ms) days.add(new Date(ms).toLocaleDateString('sv'));
    });
    (dailyReports || []).forEach((r) => { if (r.userId === user.uid && r.date) days.add(r.date); });
    return computeGamification(metrics, computeStreakFromDays(days, now));
  }, [metrics, user, timeEntries, dailyReports, now]);

  const myFocus = useMemo(() => focusDocs?.find((f) => f.date === today), [focusDocs, today]);
  const isFriday = new Date(now).getDay() === 5;

  if (!user || !metrics || !gami) return null;

  const scoreColor = metrics.productivityScore >= 70 ? 'text-green-500' : metrics.productivityScore >= 50 ? 'text-amber-500' : 'text-red-400';
  const circ = 2 * Math.PI * 42;

  const saveFocus = async () => {
    const title = focusInput.trim();
    if (!title) return;
    try {
      if (myFocus) await focusMutation.update(myFocus.id, { title });
      else await focusMutation.create({ userId: user.uid, date: today, title, done: false } as any);
      setFocusInput('');
    } catch { /* ignore */ }
  };
  const toggleFocus = async () => {
    if (!myFocus) return;
    try { await focusMutation.update(myFocus.id, { done: !myFocus.done }); } catch { /* ignore */ }
  };

  return (
    <Card className="overflow-hidden">
      <button
        onClick={() => navigate('/app/momentum')}
        className="w-full p-3 border-b bg-accent-soft dark:bg-primary/10 flex items-center justify-between hover:bg-primary/15 transition"
      >
        <div className="flex items-center gap-2">
          <Rocket className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">Momentum</h3>
        </div>
        <ArrowRight className="w-4 h-4 text-muted-foreground" />
      </button>

      <div className="p-4 space-y-4">
        {/* Score + level + streak */}
        <div className="flex items-center gap-4">
          <div className="relative w-20 h-20 shrink-0">
            <svg className="w-20 h-20 -rotate-90" viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" strokeWidth="9" className="text-muted/30" />
              <circle
                cx="50" cy="50" r="42" fill="none" strokeWidth="9" strokeLinecap="round"
                strokeDasharray={`${(metrics.productivityScore / 100) * circ} ${circ}`}
                className={scoreColor}
                style={{ transition: 'stroke-dasharray 0.6s ease' }}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-xl font-bold text-foreground">{metrics.productivityScore}</span>
              <span className="text-[8px] text-muted-foreground uppercase">Score</span>
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground">Niveli {gami.level} · {gami.levelLabel}</p>
            <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1 text-orange-500"><Flame className="w-3.5 h-3.5" />{gami.streakDays} ditë</span>
              <span className="inline-flex items-center gap-1"><Brain className="w-3.5 h-3.5" />{metrics.deepWorkHours}h</span>
              <span className="inline-flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" />{metrics.tasksCompleted}</span>
            </div>
            {gami.earnedCount > 0 && (
              <div className="flex gap-1 mt-1.5">
                {gami.badges.filter((b) => b.earned).slice(0, 6).map((b) => <span key={b.key} title={b.label} className="text-base">{b.emoji}</span>)}
              </div>
            )}
          </div>
        </div>

        {/* Bretkosa e Ditës */}
        <div className="rounded-lg border border-green-500/30 bg-green-500/5 p-2.5">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-base">🐸</span>
            <span className="text-xs font-semibold text-foreground">Bretkosa e Ditës</span>
            <button onClick={() => setFocusOpen(true)} className="ml-auto text-[11px] text-primary inline-flex items-center gap-1 hover:underline">
              <Brain className="w-3.5 h-3.5" /> Focus
            </button>
          </div>
          {myFocus ? (
            <button
              onClick={toggleFocus}
              className={`flex items-center gap-2 text-sm w-full text-left ${myFocus.done ? 'text-green-600 dark:text-green-400 line-through' : 'text-foreground'}`}
            >
              <CheckCircle2 className={`w-4 h-4 shrink-0 ${myFocus.done ? 'text-green-500' : 'text-muted-foreground'}`} />
              <span className="truncate">{myFocus.title}</span>
            </button>
          ) : (
            <div className="flex items-center gap-1.5">
              <input
                value={focusInput}
                onChange={(e) => setFocusInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && saveFocus()}
                placeholder="Detyra #1 sot?"
                className="flex-1 h-8 px-2 rounded-md border bg-background text-sm text-base focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
              <Button size="sm" className="h-8" onClick={saveFocus} disabled={!focusInput.trim()}>OK</Button>
            </div>
          )}
        </div>

        {/* Friday weekly-review nudge (4DX cadence) */}
        {isFriday && (
          <button
            onClick={() => navigate('/app/momentum')}
            className="w-full flex items-center justify-between gap-2 rounded-lg bg-primary/10 text-primary p-2.5 text-sm font-medium hover:bg-primary/20 transition"
          >
            <span>🗓️ E premte — bëj Weekly Review-n</span>
            <ChevronRight className="w-4 h-4" />
          </button>
        )}
      </div>

      <FocusMode
        open={focusOpen}
        onClose={() => setFocusOpen(false)}
        taskTitle={myFocus?.title || 'Deep Work'}
        taskId={myFocus?.taskId}
      />
    </Card>
  );
};

export default MomentumWidget;
