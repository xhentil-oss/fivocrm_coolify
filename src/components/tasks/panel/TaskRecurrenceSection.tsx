import React, { useState } from 'react';
import { addFrequency, recurrenceDayOfWeek, recurrenceDayOfMonth, hasLiveSeriesSibling, recurrenceHasEnded } from '../../../lib/recurringUtils';
import { parseTaskDate } from '../../../lib/taskReminders';
import { toast } from '../../../hooks/use-toast';
import { Button } from '../../ui/button';
import type { Task } from '../../../types';
import { chipCls, rowCls, rowLabelCls } from './panelShared';

interface TaskRecurrenceSectionProps {
  task: Task;
  readOnly: boolean;
  allTasks?: Task[];
  onUpdate: (id: string, data: any) => Promise<any>;
}

const WEEK_CHIPS = [{ v: 1, l: 'Hën' }, { v: 2, l: 'Mar' }, { v: 3, l: 'Mër' }, { v: 4, l: 'Enj' }, { v: 5, l: 'Pre' }, { v: 6, l: 'Sht' }, { v: 0, l: 'Die' }];

/** "Përsërit." row — frequency chips, day editor and "Deri më". Always mounted
 *  (renders nothing when hidden) so its draft state survives like it did when
 *  it lived in the panel. */
const TaskRecurrenceSection: React.FC<TaskRecurrenceSectionProps> = ({ task, readOnly, allTasks, onUpdate }) => {
  // Recurring edit state
  const [editingRecurring, setEditingRecurring] = useState(false);
  const [recurringDayOfWeek, setRecurringDayOfWeek] = useState<number>((task as any).recurringDayOfWeek ?? 1);
  const [recurringDaysOfWeek, setRecurringDaysOfWeek] = useState<number[]>((task as any).recurringDaysOfWeek ?? [1,2,3,4,5]);
  const toggleRecurringDay = (day: number) => {
    setRecurringDaysOfWeek(prev =>
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day].sort((a, b) => a - b)
    );
  };
  const saveRecurring = async () => {
    if (task.recurringFrequency === 'weekly') {
      await onUpdate(task.id, { recurringDayOfWeek });
    } else if (task.recurringFrequency === 'daily') {
      await onUpdate(task.id, { recurringDaysOfWeek });
    }
    setEditingRecurring(false);
  };
  // Turn an existing (non-recurring) task into a recurring one. Anchors on the
  // task's START date (falling back to the due date, then today) and seeds the
  // day-of-week/month + next occurrence. The engine (buildNextRecurringTask)
  // snaps ONLY startDate to the rule and re-derives endDate by offset, so a
  // weekday taken from the due date disagreed with the series whenever the two
  // sat on different days (Mon start / Wed deadline → "çdo të mërkurë" that the
  // engine then applied to the Monday start).
  const enableRecurring = async (freq: 'daily' | 'weekly' | 'monthly' | 'yearly') => {
    const base = parseTaskDate(task.startDate) ?? parseTaskDate(task.endDate) ?? new Date();
    // Zone-explicit getters: a browser outside Europe/Tirane would otherwise
    // store a weekday/day the recurrence engine disagrees with.
    const dow = recurrenceDayOfWeek(base);
    const dom = recurrenceDayOfMonth(base);
    const defaultDays = [1, 2, 3, 4, 5];
    // Seed the next occurrence in the FUTURE: for an old/Done tip the naive
    // (base + frequency) lands in the past, and the cron backstop would spawn
    // immediately — forking a second series next to the already-spawned child.
    const rawNext = addFrequency(base, freq, dow, dom, 1, defaultDays);
    const next = rawNext.getTime() < Date.now()
      ? addFrequency(new Date(), freq, dow, dom, 1, defaultDays)
      : rawNext;
    // Re-arm the spawn flag only when the series has no live occurrence —
    // same guard as re-opening (see hasLiveSeriesSibling).
    const mayRearm = task.status !== 'Done' || !hasLiveSeriesSibling(task, allTasks);
    await onUpdate(task.id, {
      isRecurring: true,
      recurringFrequency: freq,
      recurringInterval: 1,
      ...(freq === 'weekly' ? { recurringDayOfWeek: dow } : {}),
      ...(freq === 'monthly' ? { recurringDayOfMonth: dom } : {}),
      ...(freq === 'daily' ? { recurringDaysOfWeek: defaultDays } : {}),
      // Recurrence needs BOTH date anchors: the cron backstop refuses a tip
      // missing startDate or endDate, so backfilling only endDate produced
      // series the cron could never rescue.
      ...(task.endDate ? {} : { endDate: base }),
      ...(task.startDate ? {} : { startDate: base }),
      nextRecurringDate: next,
      ...(mayRearm ? { nextCycleCreated: false } : {}),
    } as any);
  };
  // "Përsërit deri" — extending (or removing) the end of a series that had
  // already ENDED must revive it. The ended tip is Done with
  // `nextCycleCreated: true` and no child, so the cron skips it forever; it is
  // re-armed only when it really was the series' end under the OLD date and
  // is no longer the end under the NEW one (an older Done occurrence, whose
  // next cycle exists, is never re-armed — that would fork the series).
  const changeRecurringEndDate = async (nd: Date | null) => {
    const extendsEndedSeries = task.status === 'Done'
      && !!task.isRecurring
      && task.nextCycleCreated === true
      && !hasLiveSeriesSibling(task, allTasks)
      && recurrenceHasEnded(task)
      && !recurrenceHasEnded({ ...task, recurringEndDate: nd } as Task);
    try {
      await onUpdate(task.id, {
        recurringEndDate: nd,
        ...(extendsEndedSeries ? { nextCycleCreated: false } : {}),
      } as any);
      if (extendsEndedSeries) {
        toast({ title: 'Përsëritja vazhdon', description: 'Cikli i ardhshëm do të krijohet automatikisht.' });
      }
    } catch (err: any) {
      toast({ title: 'Data nuk u ruajt', description: err?.message, variant: 'destructive' });
    }
  };

  if (!(task.isRecurring || !readOnly)) return null;

  return (
    <div className={`${rowCls} items-start`}>
      <span className={`${rowLabelCls} pt-1`}>Përsërit.</span>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            disabled={readOnly}
            onClick={() => task.isRecurring && onUpdate(task.id, { isRecurring: false } as any)}
            className={chipCls(!task.isRecurring)}
          >
            Asnjëherë
          </button>
          {([['daily', 'Çdo ditë'], ['weekly', 'Çdo javë'], ['monthly', 'Çdo muaj']] as const).map(([k, l]) => (
            <button
              key={k}
              type="button"
              disabled={readOnly}
              onClick={() => (!task.isRecurring || task.recurringFrequency !== k) && enableRecurring(k)}
              className={chipCls(!!task.isRecurring && task.recurringFrequency === k)}
            >
              ↻ {l}
            </button>
          ))}
          {task.isRecurring && <span className="text-[11px] text-muted-foreground">Europe/Tirane</span>}
        </div>
        {task.isRecurring && (
          <>
            {!editingRecurring ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                  🔄 {task.recurringFrequency === 'daily'
                       ? (() => {
                           const days = (task as any).recurringDaysOfWeek as number[] | undefined;
                           const names = ['Die', 'Hën', 'Mar', 'Mër', 'Enj', 'Pre', 'Sht'];
                           return days && days.length > 0 ? `Çdo ${days.map(d => names[d]).join(', ')}` : 'Çdo ditë';
                         })()
                       : task.recurringFrequency === 'weekly'
                       ? `Çdo ${(task.recurringInterval ?? 1) > 1 ? (task.recurringInterval ?? 1) + ' javë' : 'javë'}, ${['Diel', 'Hënë', 'Martë', 'Mërkurë', 'Enjte', 'Premte', 'Shtunë'][(task as any).recurringDayOfWeek ?? 0]}`
                       : task.recurringFrequency === 'monthly'
                       ? `Çdo ${(task.recurringInterval ?? 1) > 1 ? (task.recurringInterval ?? 1) + ' muaj' : 'muaj'}, ditën ${(task as any).recurringDayOfMonth ?? 1}`
                       : `Çdo ${(task.recurringInterval ?? 1) > 1 ? (task.recurringInterval ?? 1) + ' vite' : 'vit'}`}
                </span>
                {!readOnly && (task.recurringFrequency === 'weekly' || task.recurringFrequency === 'daily') && (
                  <button
                    type="button"
                    onClick={() => setEditingRecurring(true)}
                    className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                  >
                    Ndrysho
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                {task.recurringFrequency === 'weekly' && (
                  <div className="flex flex-wrap gap-1.5">
                    {WEEK_CHIPS.map(day => (
                      <button key={day.v} type="button" onClick={() => setRecurringDayOfWeek(day.v)} className={chipCls(recurringDayOfWeek === day.v)}>
                        {day.l}
                      </button>
                    ))}
                  </div>
                )}
                {task.recurringFrequency === 'daily' && (
                  <div className="flex flex-wrap gap-1.5">
                    {WEEK_CHIPS.map(day => (
                      <button key={day.v} type="button" onClick={() => toggleRecurringDay(day.v)} className={chipCls(recurringDaysOfWeek.includes(day.v))}>
                        {day.l}
                      </button>
                    ))}
                  </div>
                )}
                <div className="flex gap-2">
                  <Button size="sm" className="h-7 text-xs" onClick={saveRecurring}>Ruaj</Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setEditingRecurring(false)}>Anulo</Button>
                </div>
              </div>
            )}
            {/* Repeat-until — bounds the recurrence */}
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-muted-foreground">Deri më:</span>
              <input
                type="date"
                defaultValue={(task as any).recurringEndDate ? (() => { const d = new Date((task as any).recurringEndDate); const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; })() : ''}
                disabled={readOnly}
                onChange={(e) => { const v = e.target.value; const nd = v ? (() => { const [y, mo, dd] = v.split('-').map(Number); return new Date(y, mo - 1, dd); })() : null; changeRecurringEndDate(nd); }}
                className="h-6 rounded border border-border/50 bg-muted/40 px-1.5 text-[11px] text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-60"
              />
              {(task as any).recurringEndDate
                ? (!readOnly && <button type="button" onClick={() => changeRecurringEndDate(null)} className="text-[11px] text-muted-foreground underline hover:text-foreground">Hiq</button>)
                : <span className="text-[11px] text-muted-foreground/70">pa fund</span>}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default TaskRecurrenceSection;
