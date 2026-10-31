import React, { useMemo, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { startOfRecurrenceDay, recurringOccurrencesInMonth } from '../../lib/recurringUtils';
import { compareTasksByTimeOfDayThenPriority, taskDateMs } from '../../lib/taskSort';
import { taskDeadline } from '../../lib/taskDue';
import { useTodayKey } from '../../hooks/useTodayKey';
import type { Task, Project } from '../../types';

/**
 * A series the ENGINE drives (projected as 🔄 ghosts by
 * `recurringOccurrencesInMonth`). A task flagged `isRecurring` with no
 * `recurringFrequency` is nothing the engine can repeat — the engine skips it,
 * so the calendar must place it like any dated task (or in "Pa afat"), not
 * drop it from both.
 */
const isEngineRecurring = (t: Task) => !!t.isRecurring && !!t.recurringFrequency;

const DAY_MS = 86_400_000;
// A non-recurring task may span [startDate, endDate], capped so an over-long
// span doesn't paint every single day (it then marks only its two ends).
const SPAN_CAP_DAYS = 14;

// Calendar View Component
const TaskCalendarView: React.FC<{
  tasks: Task[];
  /** For the recurrence ghosts: a series inside an archived/cancelled project
   *  projects nothing (the engine spawns nothing there). */
  projects?: Pick<Project, 'id' | 'status'>[] | null;
  onTaskClick: (task: Task) => void;
}> = ({ tasks, projects, onTaskClick }) => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const daysInMonth = new Date(year, month + 1, 0).getDate();

  // Monday-first week (Albanian convention): convert JS getDay() (0=Sun..6=Sat)
  // to a Monday-based index (Mon=0..Sun=6).
  const firstDay = (new Date(year, month, 1).getDay() + 6) % 7;

  // Today in Europe/Tirane, re-evaluated at the Tirane midnight (a calendar
  // left open overnight kept yesterday's cell highlighted).
  const todayKey = useTodayKey();

  // Tasks with no date at all can't be placed on a day — surface them in a bar so
  // they're never hidden. Clicking "+N" on a busy day opens the full day list.
  const undatedTasks = useMemo(() => tasks.filter(t => !taskDeadline(t) && !t.startDate), [tasks]);
  const [dayDetail, setDayDetail] = useState<{ label: string; items: Task[] } | null>(null);

  // Projected recurring occurrences for the displayed month — ONE engine shared
  // with the project calendar (`recurringOccurrencesInMonth`): the tip's own day
  // plus the future cycles the spawning engine would produce; anchor day only for
  // old cycles and for series inside an archived/cancelled project.
  const projectionsByDay = useMemo(
    () => recurringOccurrencesInMonth(tasks, year, month, { projects }),
    [tasks, projects, year, month],
  );

  // Day keys in Europe/Tirane — the SAME keys recurringOccurrencesInMonth uses
  // for the recurring ghosts (machine-local midnight put a real task and its
  // projected sibling on different cells for a browser outside the zone) — and
  // the real tasks of every cell, placed and sorted ONCE per month/data change.
  // Filtering + sorting the whole list inside the 31-cell render loop re-ran
  // on every render (every snapshot, every hover-driven state change).
  const { cellKeys, tasksByDay } = useMemo(() => {
    // Noon, like the engine's cell keys: noon-local cannot flip across a day
    // boundary for any real browser offset.
    const keys = Array.from({ length: daysInMonth }, (_, i) => startOfRecurrenceDay(new Date(year, month, i + 1, 12)));
    const dayOfKey = new Map<number, number>(keys.map((k, i) => [k, i + 1]));
    const firstKey = keys[0];
    const lastKey = keys[daysInMonth - 1];
    const byDay = new Map<number, Task[]>();
    const push = (day: number, task: Task) => {
      let arr = byDay.get(day);
      if (!arr) { arr = []; byDay.set(day, arr); }
      arr.push(task);
    };
    for (const task of tasks) {
      // Anchor on the deadline (`endDate ?? dueDate`); fall back to the start
      // date so a task with only a start date still appears. Tasks with NO date
      // at all go to the "Pa afat" bar.
      const anchorMs = taskDateMs(taskDeadline(task)) ?? taskDateMs(task.startDate);
      if (anchorMs === null) continue;
      // An engine-driven series is a single-day occurrence on its due date (the
      // "afat") — the frequency, not a multi-day span, drives repetition, and
      // projectionsByDay paints it.
      if (isEngineRecurring(task)) continue;
      const end = startOfRecurrenceDay(new Date(anchorMs));
      const startMs = taskDateMs(task.startDate);
      const start = startMs === null ? end : startOfRecurrenceDay(new Date(startMs));
      const lo = Math.min(start, end), hi = Math.max(start, end);
      if (hi < firstKey || lo > lastKey) continue;
      // ALWAYS show on the start day and the end day; fill the days in between only
      // for short spans (so a long task still marks both ends without painting
      // every single day).
      const loDay = dayOfKey.get(lo);
      const hiDay = dayOfKey.get(hi);
      if (loDay !== undefined) push(loDay, task);
      if (hi !== lo && hiDay !== undefined) push(hiDay, task);
      if (hi !== lo && (hi - lo) / DAY_MS <= SPAN_CAP_DAYS) {
        for (let d = (loDay ?? 0) + 1; d <= (hiDay ?? daysInMonth + 1) - 1; d++) {
          const k = keys[d - 1];
          if (k > lo && k < hi) push(d, task);
        }
      }
    }
    // Earliest time-of-day first, then priority — the two visible per cell used
    // to be whichever were created last (or last dragged), not the day's agenda.
    for (const arr of byDay.values()) arr.sort(compareTasksByTimeOfDayThenPriority);
    return { cellKeys: keys, tasksByDay: byDay };
  }, [tasks, year, month, daysInMonth]);

  const sod = (x: Date) => startOfRecurrenceDay(x);

  const days = [];
  for (let i = 0; i < firstDay; i++) {
    days.push(<div key={`empty-${i}`} className="min-h-[80px] bg-muted/20" />);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month, day, 12);
    const cell = cellKeys[day - 1];
    const dayTasks = tasksByDay.get(day) || [];
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
            const tEnd = sod(new Date((taskDateMs(taskDeadline(task)) ?? taskDateMs(task.startDate))!));
            const tStartMs = taskDateMs(task.startDate);
            const tStart = tStartMs === null ? tEnd : sod(new Date(tStartMs));
            const multiDay = tStart !== tEnd && !isEngineRecurring(task);
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
          onClick={() => setCurrentDate(new Date(year, month - 1))}
        >
          Para
        </Button>
        <h2 className="text-xs sm:text-sm font-medium">
          {currentDate.toLocaleDateString('sq-AL', { month: 'long', year: 'numeric' })}
        </h2>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setCurrentDate(new Date(year, month + 1))}
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
                {isEngineRecurring(task) ? '🔄 ' : ''}{task.title}
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default TaskCalendarView;
