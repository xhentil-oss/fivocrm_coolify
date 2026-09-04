import React, { useMemo, useState, useEffect } from 'react';
import type { Task } from '../types';
import { taskDateMs, compareTaskIds } from '../lib/taskSort';

// Lightweight Timeline / Gantt view (Jira/Monday/Asana Timeline-inspired).
// Renders each task as a horizontal bar from startDate→endDate across a day grid.
// Read-only positioning; click a bar to open the task.

const DAY = 24 * 60 * 60 * 1000;
const DAY_W = 44; // px per day
const ROW_H = 34;
// Task-label column width. Narrow on phones so the day grid isn't crushed; wider
// on ≥sm where there's room. Kept as a hook so it reacts to rotation/resize.
function useLabelWidth(): number {
  const get = () => (typeof window !== 'undefined' && window.innerWidth < 640 ? 116 : 200);
  const [w, setW] = useState(get);
  useEffect(() => {
    const onResize = () => setW(get());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return w;
}

const startOfDay = (d: Date) => { const n = new Date(d); n.setHours(0, 0, 0, 0); return n; };
const daysBetween = (a: Date, b: Date) => Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / DAY);

function barColor(t: Task): string {
  if (t.status === 'Done') return 'bg-emerald-500';
  if (t.priority === 'urgent') return 'bg-rose-500';
  if (t.priority === 'high') return 'bg-orange-500';
  if (t.status === 'In Progress') return 'bg-blue-500';
  if (t.status === 'Review') return 'bg-amber-500';
  return 'bg-primary';
}

interface Props {
  tasks: Task[];
  onTaskClick: (task: Task) => void;
}

const TaskTimeline: React.FC<Props> = ({ tasks, onTaskClick }) => {
  const labelW = useLabelWidth();
  const dated = useMemo(
    () => tasks
      .map(t => {
        // Normalise through taskDateMs: `new Date(timestampObject)` is Invalid
        // Date, whose NaN getTime() made the comparator (and the grid range) undefined.
        const sMs = taskDateMs(t.startDate), eMs = taskDateMs(t.endDate);
        if (sMs === null && eMs === null) return null;
        const s = new Date(sMs ?? eMs!), e = new Date(eMs ?? sMs!);
        return { task: t, start: s <= e ? s : e, end: e >= s ? e : s };
      })
      .filter((d): d is { task: Task; start: Date; end: Date } => d !== null)
      .sort((a, b) => a.start.getTime() - b.start.getTime() || a.end.getTime() - b.end.getTime() || compareTaskIds(a.task, b.task)),
    [tasks]
  );

  const range = useMemo(() => {
    if (dated.length === 0) {
      const today = startOfDay(new Date());
      return { start: today, days: 14 };
    }
    let min = dated[0].start, max = dated[0].end;
    dated.forEach(d => { if (d.start < min) min = d.start; if (d.end > max) max = d.end; });
    // Anchor around TODAY, not the oldest task: one stale year-old task used to
    // pin the window start so far back that the 370-day cap ran out before
    // today — the today marker vanished and current bars rendered past the grid.
    const floor = startOfDay(new Date());
    floor.setDate(floor.getDate() - 60);
    const start = startOfDay(min < floor ? floor : min);
    // Cap the window so a far-future task can't render thousands of day columns.
    const days = Math.min(370, Math.max(7, daysBetween(start, max) + 2));
    return { start, days };
  }, [dated]);

  const todayOffset = daysBetween(range.start, new Date());

  if (dated.length === 0) {
    return <div className="text-center py-12 text-muted-foreground text-sm">Asnjë detyrë me datë për të shfaqur në timeline.</div>;
  }

  const cols = Array.from({ length: range.days }, (_, i) => new Date(range.start.getTime() + i * DAY));
  const gridW = range.days * DAY_W;
  const contentW = labelW + gridW;

  // Top axis tier: group consecutive days by calendar month so the Gantt has a
  // clear month reference above the day numbers.
  const monthGroups: { label: string; days: number }[] = [];
  cols.forEach(d => {
    const label = d.toLocaleDateString('sq-AL', { month: 'long', year: '2-digit' });
    const last = monthGroups[monthGroups.length - 1];
    if (last && last.label === label) last.days += 1;
    else monthGroups.push({ label, days: 1 });
  });

  return (
    // Own the vertical scroll (h-full) so the sticky axis stays pinned while the
    // task rows scroll — otherwise the parent scroller carries the axis off-screen.
    <div className="h-full overflow-auto p-2">
      {/* Single coordinate origin: everything is positioned from the left edge of
          this `contentW`-wide track. Labels occupy [0, LABEL_W); the day grid
          occupies [LABEL_W, LABEL_W + gridW). Header, bars and the today marker
          all share that origin so they line up exactly. */}
      <div style={{ width: contentW }}>
        {/* Two-tier date axis (months on top, days below) — sticky above the bars. */}
        <div className="sticky top-0 z-10 bg-background border-b border-border">
          {/* Month tier */}
          <div className="flex">
            <div className="flex-shrink-0 sticky left-0 z-20 bg-background" style={{ width: labelW }} />
            {monthGroups.map((g, i) => (
              <div
                key={i}
                style={{ width: g.days * DAY_W }}
                className="flex-shrink-0 border-l border-border/60 px-1 text-[11px] font-semibold text-foreground/70 capitalize truncate"
              >
                {g.label}
              </div>
            ))}
          </div>
          {/* Day tier (weekday initial + date), week starts marked stronger */}
          <div className="flex">
            <div className="flex-shrink-0 sticky left-0 z-20 bg-background border-r border-border/40 flex items-end px-1 pb-0.5 text-[10px] font-medium text-muted-foreground" style={{ width: labelW }}>
              Detyra
            </div>
            {cols.map((d, i) => {
              const isToday = startOfDay(d).getTime() === startOfDay(new Date()).getTime();
              const weekend = d.getDay() === 0 || d.getDay() === 6;
              const isWeekStart = d.getDay() === 1; // Monday
              return (
                <div
                  key={i}
                  style={{ width: DAY_W }}
                  className={`flex-shrink-0 text-center ${isWeekStart ? 'border-l border-border' : 'border-l border-border/30'} ${weekend ? 'bg-muted/30' : ''}`}
                >
                  <div className="text-[9px] uppercase text-muted-foreground/70">{d.toLocaleDateString('sq-AL', { weekday: 'narrow' })}</div>
                  <div className={`text-[11px] ${isToday ? 'font-bold text-primary' : 'text-muted-foreground'}`}>{d.getDate()}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Rows */}
        <div className="relative">
          {/* Today marker — same origin as the bars (LABEL_W + offset days) */}
          {todayOffset >= 0 && todayOffset < range.days && (
            <div className="absolute top-0 bottom-0 w-px bg-primary/50 z-[5]" style={{ left: labelW + todayOffset * DAY_W + DAY_W / 2 }} />
          )}
          {dated.map(({ task, start, end }) => {
            // Clamp into the visible window: a bar starting before the anchored
            // range.start (or ending past the cap) must not paint outside the
            // labeled grid into a dateless void.
            const startIdx = Math.max(0, Math.min(range.days - 1, daysBetween(range.start, start)));
            const endIdx = Math.max(startIdx, Math.min(range.days - 1, daysBetween(range.start, end)));
            const left = labelW + startIdx * DAY_W;
            const span = Math.max(1, endIdx - startIdx + 1);
            const width = span * DAY_W - 6;
            return (
              <div key={task.id} className="relative flex items-center border-b border-border/30" style={{ height: ROW_H }}>
                {/* Sticky-left so the task name stays visible while scrolling the grid. */}
                <div className="sticky left-0 shrink-0 z-[6] pr-2 truncate text-xs text-foreground/80 bg-background border-r border-border/40" style={{ width: labelW }} title={task.title}>{task.title}</div>
                <button
                  onClick={() => onTaskClick(task)}
                  title={`${task.title} · ${start.toLocaleDateString('sq-AL')} → ${end.toLocaleDateString('sq-AL')}`}
                  className={`absolute top-1/2 -translate-y-1/2 h-5 rounded ${barColor(task)} ${task.status === 'Done' ? 'opacity-60' : ''} hover:ring-2 hover:ring-offset-1 hover:ring-primary transition-all flex items-center px-1.5`}
                  style={{ left, width: Math.max(width, 12) }}
                >
                  <span className="text-[10px] text-white truncate">{task.title}</span>
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default TaskTimeline;
