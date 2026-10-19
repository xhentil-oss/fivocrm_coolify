import React, { useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { startOfRecurrenceDay, recurringOccurrencesInMonth } from '../../lib/recurringUtils';
import { compareTasksByTimeOfDayThenPriority } from '../../lib/taskSort';
import type { Task, Project } from '../../types';

// Calendar View Component
const TaskCalendarView: React.FC<{
  tasks: Task[];
  /** For the recurrence ghosts: a series inside an archived/cancelled project
   *  projects nothing (the engine spawns nothing there). */
  projects?: Pick<Project, 'id' | 'status'>[] | null;
  onTaskClick: (task: Task) => void;
}> = ({ tasks, projects, onTaskClick }) => {
  const [currentDate, setCurrentDate] = useState(new Date());

  const daysInMonth = new Date(
    currentDate.getFullYear(),
    currentDate.getMonth() + 1,
    0
  ).getDate();

  // Monday-first week (Albanian convention): convert JS getDay() (0=Sun..6=Sat)
  // to a Monday-based index (Mon=0..Sun=6).
  const firstDay = (new Date(
    currentDate.getFullYear(),
    currentDate.getMonth(),
    1
  ).getDay() + 6) % 7;

  // Day keys in Europe/Tirane — the SAME keys recurringOccurrencesInMonth uses
  // for the recurring ghosts (machine-local midnight put a real task and its
  // projected sibling on different cells for a browser outside the zone).
  const sod = (x: Date) => startOfRecurrenceDay(x);
  const todayKey = startOfRecurrenceDay(new Date());

  // Tasks with no date at all can't be placed on a day — surface them in a bar so
  // they're never hidden. Clicking "+N" on a busy day opens the full day list.
  const undatedTasks = tasks.filter(t => !t.endDate && !t.startDate);
  const [dayDetail, setDayDetail] = useState<{ label: string; items: Task[] } | null>(null);

  // Projected recurring occurrences for the displayed month — ONE engine shared
  // with the project calendar (`recurringOccurrencesInMonth`): the tip's own day
  // plus the future cycles the spawning engine would produce; anchor day only for
  // old cycles and for series inside an archived/cancelled project.
  const projectionsByDay = React.useMemo(
    () => recurringOccurrencesInMonth(tasks, currentDate.getFullYear(), currentDate.getMonth(), { projects }),
    [tasks, projects, currentDate],
  );

  const days = [];
  for (let i = 0; i < firstDay; i++) {
    days.push(<div key={`empty-${i}`} className="min-h-[80px] bg-muted/20" />);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    // Noon, like the engine's cell keys: noon-local cannot flip across a day
    // boundary for any real browser offset.
    const date = new Date(currentDate.getFullYear(), currentDate.getMonth(), day, 12);
    const cell = sod(date);
    // A recurring task is a single-day occurrence on its due date (the "afat") —
    // the frequency, not a multi-day span, drives repetition. A non-recurring task
    // may span [startDate, endDate], capped so an over-long span doesn't paint
    // every single day (it then collapses to the due date).
    const SPAN_CAP_DAYS = 14;
    const dayTasks = tasks.filter(task => {
      // Anchor on the due date; fall back to the start date so a task with only a
      // start date still appears. Tasks with NO date at all go to the "Pa afat" bar.
      const anchor = task.endDate || task.startDate;
      if (!anchor) return false;
      if ((task as any).isRecurring) return false; // recurring → handled by projectionsByDay
      const end = sod(new Date(anchor));
      const start = task.startDate ? sod(new Date(task.startDate)) : end;
      const lo = Math.min(start, end), hi = Math.max(start, end);
      // ALWAYS show on the start day and the end day; fill the days in between only
      // for short spans (so a long task still marks both ends without painting
      // every single day).
      if (cell === lo || cell === hi) return true;
      if ((hi - lo) / 86400000 <= SPAN_CAP_DAYS) return cell > lo && cell < hi;
      return false;
    // Earliest time-of-day first, then priority — the two visible per cell used
    // to be whichever were created last (or last dragged), not the day's agenda.
    }).sort(compareTasksByTimeOfDayThenPriority);
    const isToday = cell === todayKey;
    // Projected recurring occurrences for this day (not real docs yet).
    const dayProjections = projectionsByDay.get(day) || [];
    const realShown = dayTasks.slice(0, 2);
    const projShown = dayProjections.slice(0, Math.max(0, 2 - realShown.length));
    const overflow = (dayTasks.length + dayProjections.length) - realShown.length - projShown.length;

    days.push(
      <div key={day} className={`min-h-[50px] sm:min-h-[80px] border p-0.5 sm:p-1 ${isToday ? 'border-primary border-2 bg-primary/5' : 'border-border bg-background'}`}>
        <div className={`font-medium text-[10px] sm:text-xs mb-0.5 sm:mb-1 ${isToday ? 'text-primary font-bold' : 'text-muted-foreground'}`}>
          {day}
        </div>
        <div className="space-y-0.5 sm:space-y-1">
          {realShown.map(task => {
            // Mark whether this cell is the task's start or end day (multi-day only)
            // so "fillon" and "mbaron" are both visible on the calendar.
            const tEnd = sod(new Date(task.endDate || task.startDate!));
            const tStart = task.startDate ? sod(new Date(task.startDate)) : tEnd;
            const multiDay = tStart !== tEnd && !(task as any).isRecurring;
            const isStart = multiDay && cell === tStart;
            const isEnd = multiDay && cell === tEnd;
            return (
              <div
                key={task.id}
                className={`text-[10px] sm:text-xs p-0.5 sm:p-1 bg-primary/10 rounded cursor-pointer hover:bg-primary/20 truncate ${isStart ? 'border-l-2 border-emerald-500' : isEnd ? 'border-l-2 border-primary' : ''}`}
                onClick={() => onTaskClick(task)}
                title={isStart ? `Fillon — ${task.title}` : isEnd ? `Afati — ${task.title}` : task.title}
              >
                {isStart && <span className="text-emerald-600 dark:text-emerald-400 font-semibold mr-0.5">▶</span>}
                {isEnd && <span className="text-primary font-semibold mr-0.5">■</span>}
                {task.title}
              </div>
            );
          })}
          {projShown.map((task, i) => (
            <div
              key={`proj-${task.id}-${i}`}
              className="text-[10px] sm:text-xs p-0.5 sm:p-1 rounded cursor-pointer truncate border border-dashed border-primary/30 text-primary dark:text-primary dark:border-primary/40 bg-accent-soft dark:bg-primary/10 hover:bg-accent-soft dark:hover:bg-primary/20 italic"
              title={`Përsëritet — ${task.title}`}
              onClick={() => onTaskClick(task)}
            >
              🔄 {task.title}
            </div>
          ))}
          {overflow > 0 && (
            <button
              type="button"
              className="text-[10px] sm:text-xs text-primary font-medium hover:underline"
              onClick={(e) => {
                e.stopPropagation();
                setDayDetail({
                  label: date.toLocaleDateString('sq-AL', { weekday: 'long', day: 'numeric', month: 'long' }),
                  items: [...dayTasks, ...dayProjections],
                });
              }}
            >
              +{overflow} më shumë
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="p-2 sm:p-4 space-y-3 sm:space-y-4">
      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1))}
        >
          Para
        </Button>
        <h2 className="text-xs sm:text-sm font-medium">
          {currentDate.toLocaleDateString('sq-AL', { month: 'long', year: 'numeric' })}
        </h2>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1))}
        >
          Pas
        </Button>
      </div>
      <div className="grid grid-cols-7 gap-px bg-border">
        {['Hë', 'Ma', 'Më', 'En', 'Pr', 'Sh', 'Di'].map(day => (
          <div key={day} className="bg-muted p-0.5 sm:p-1 text-center text-[10px] sm:text-xs font-medium">
            {day}
          </div>
        ))}
        {days}
      </div>

      {/* Tasks with no date at all — never hidden from the calendar. */}
      {undatedTasks.length > 0 && (
        <div className="rounded-xl border border-dashed border-border bg-muted/20 p-3">
          <div className="flex items-center gap-2 mb-2">
            <AlertCircle className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-xs font-semibold text-muted-foreground">Pa afat ({undatedTasks.length})</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {undatedTasks.map(task => (
              <button
                key={task.id}
                type="button"
                onClick={() => onTaskClick(task)}
                className="text-[11px] px-2 py-1 rounded-lg bg-background border hover:bg-accent-soft hover:border-primary/30 transition-colors truncate max-w-[220px]"
              >
                {task.title}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Day detail — opened from "+N më shumë"; lists every task for that day. */}
      <Dialog open={!!dayDetail} onOpenChange={(o) => { if (!o) setDayDetail(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="capitalize">{dayDetail?.label}</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5 max-h-[60vh] overflow-y-auto">
            {(dayDetail?.items || []).map((task, i) => (
              <button
                key={`${task.id}-${i}`}
                type="button"
                onClick={() => { onTaskClick(task); setDayDetail(null); }}
                className="w-full text-left text-sm px-3 py-2 rounded-lg bg-muted/50 hover:bg-accent-soft hover:text-primary transition-colors truncate"
              >
                {(task as any).isRecurring ? '🔄 ' : ''}{task.title}
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default TaskCalendarView;
