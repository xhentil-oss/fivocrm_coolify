import React, { useMemo } from 'react';
import type { Task } from '../types';

// Lightweight Timeline / Gantt view (Jira/Monday/Asana Timeline-inspired).
// Renders each task as a horizontal bar from startDate→endDate across a day grid.
// Read-only positioning; click a bar to open the task.

const DAY = 24 * 60 * 60 * 1000;
const DAY_W = 44; // px per day
const ROW_H = 34;
const LABEL_W = 200; // px — fixed task-label column on the left

const startOfDay = (d: Date) => { const n = new Date(d); n.setHours(0, 0, 0, 0); return n; };
const daysBetween = (a: Date, b: Date) => Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / DAY);

function barColor(t: Task): string {
  if (t.status === 'Done') return 'bg-emerald-500';
  if (t.priority === 'urgent') return 'bg-rose-500';
  if (t.priority === 'high') return 'bg-orange-500';
  if (t.status === 'In Progress') return 'bg-blue-500';
  if (t.status === 'Review') return 'bg-amber-500';
  return 'bg-violet-500';
}

interface Props {
  tasks: Task[];
  onTaskClick: (task: Task) => void;
}

const TaskTimeline: React.FC<Props> = ({ tasks, onTaskClick }) => {
  const dated = useMemo(
    () => tasks
      .filter(t => t.startDate || t.endDate)
      .map(t => {
        const s = t.startDate ? new Date(t.startDate) : new Date(t.endDate!);
        const e = t.endDate ? new Date(t.endDate) : new Date(t.startDate!);
        return { task: t, start: s <= e ? s : e, end: e >= s ? e : s };
      })
      .sort((a, b) => a.start.getTime() - b.start.getTime()),
    [tasks]
  );

  const range = useMemo(() => {
    if (dated.length === 0) {
      const today = startOfDay(new Date());
      return { start: today, days: 14 };
    }
    let min = dated[0].start, max = dated[0].end;
    dated.forEach(d => { if (d.start < min) min = d.start; if (d.end > max) max = d.end; });
    const start = startOfDay(min);
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
  const contentW = LABEL_W + gridW;

  return (
    <div className="overflow-auto p-2">
      {/* Single coordinate origin: everything is positioned from the left edge of
          this `contentW`-wide track. Labels occupy [0, LABEL_W); the day grid
          occupies [LABEL_W, LABEL_W + gridW). Header, bars and the today marker
          all share that origin so they line up exactly. */}
      <div style={{ width: contentW }}>
        {/* Date header */}
        <div className="flex sticky top-0 z-10 bg-background">
          <div className="flex-shrink-0" style={{ width: LABEL_W }} />
          {cols.map((d, i) => {
            const isMonthStart = d.getDate() === 1 || i === 0;
            const isToday = startOfDay(d).getTime() === startOfDay(new Date()).getTime();
            const weekend = d.getDay() === 0 || d.getDay() === 6;
            return (
              <div key={i} style={{ width: DAY_W }} className={`flex-shrink-0 text-center border-l border-border/40 ${weekend ? 'bg-muted/30' : ''}`}>
                {isMonthStart && <div className="text-[10px] font-semibold text-muted-foreground truncate">{d.toLocaleDateString('sq-AL', { month: 'short' })}</div>}
                <div className={`text-[11px] ${isToday ? 'font-bold text-violet-600' : 'text-muted-foreground'}`}>{d.getDate()}</div>
              </div>
            );
          })}
        </div>

        {/* Rows */}
        <div className="relative">
          {/* Today marker — same origin as the bars (LABEL_W + offset days) */}
          {todayOffset >= 0 && todayOffset < range.days && (
            <div className="absolute top-0 bottom-0 w-px bg-violet-500/50 z-[5]" style={{ left: LABEL_W + todayOffset * DAY_W + DAY_W / 2 }} />
          )}
          {dated.map(({ task, start, end }) => {
            const left = LABEL_W + daysBetween(range.start, start) * DAY_W;
            const span = Math.max(1, daysBetween(start, end) + 1);
            const width = span * DAY_W - 6;
            return (
              <div key={task.id} className="relative border-b border-border/30" style={{ height: ROW_H }}>
                <div className="absolute left-0 top-1/2 -translate-y-1/2 pr-2 truncate text-xs text-foreground/80 z-[6] bg-background" style={{ width: LABEL_W }} title={task.title}>{task.title}</div>
                <button
                  onClick={() => onTaskClick(task)}
                  title={`${task.title} · ${start.toLocaleDateString('sq-AL')} → ${end.toLocaleDateString('sq-AL')}`}
                  className={`absolute top-1/2 -translate-y-1/2 h-5 rounded ${barColor(task)} ${task.status === 'Done' ? 'opacity-60' : ''} hover:ring-2 hover:ring-offset-1 hover:ring-violet-400 transition-all flex items-center px-1.5`}
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
