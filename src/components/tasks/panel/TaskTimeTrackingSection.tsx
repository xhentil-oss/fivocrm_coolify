import React, { useEffect, useRef, useState } from 'react';
import { Clock, Play, Square } from 'lucide-react';
import { useCollection, useMutation } from '../../../hooks/useFirestore';
import { useAuth } from '../../../contexts/AuthContext';
import { toast } from '../../../hooks/use-toast';
import { dayKeyOf as timeEntryDayKey } from '../../../lib/finance/timeEntries';
import { entryDurationMinutes, totalTrackedMinutes } from '../../../lib/timeTracking';
import { Button } from '../../ui/button';
import type { Task } from '../../../types';

const formatTime = (seconds: number) => {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

const formatDuration = (minutes: number) => {
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
};

/** "Koha" — live timer + entry log. Owns the 1-second tick, so a running timer
 *  re-renders this section only (it used to re-render the whole panel). */
const TaskTimeTrackingSection: React.FC<{
  task: Task;
  /** Every running entry of the business (`endTime == null`) — the panel's listener. */
  allActiveTimeEntries: any[] | undefined | null;
}> = ({ task, allActiveTimeEntries }) => {
  const { user } = useAuth();
  const timeEntryMutation = useMutation<any>('timeEntries');

  const { data: timeEntries } = useCollection<any>('timeEntries', {
    where: [{ field: 'taskId', operator: '==', value: task.id }],
    orderBy: { field: 'startTime', direction: 'desc' }
  });

  // Time tracking state
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Find running entry for this task
  const runningEntry = React.useMemo(() => {
    if (!timeEntries || !user) return null;
    return timeEntries.find(entry => !entry.endTime && entry.userId === user.uid);
  }, [timeEntries, user]);

  // Update elapsed time
  useEffect(() => {
    if (runningEntry) {
      const updateElapsed = () => {
        const elapsed = Math.floor((Date.now() - new Date(runningEntry.startTime).getTime()) / 1000);
        setElapsedSeconds(elapsed);
      };

      updateElapsed();
      timerIntervalRef.current = setInterval(updateElapsed, 1000);
    } else {
      setElapsedSeconds(0);
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
      }
    }

    return () => {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
      }
    };
  }, [runningEntry]);

  // Two clicks (or two devices) before the snapshot landed both passed the
  // "no running timer" check and both created an entry; the second ticked
  // invisibly until the next Start closed it.
  const timerBusyRef = useRef(false);
  const startTimer = async () => {
    if (!user || timerBusyRef.current) return;
    timerBusyRef.current = true;
    try {
    // Enforce a single running timer per user: close any entry left open from a
    // previous session/task first. Overlapping running timers were the root cause
    // of corrupt totals (a stop computed its duration against the wrong start).
    const myRunning = (allActiveTimeEntries || []).filter(
      (e: any) => e.userId === user.uid && !e.endTime,
    );
    let lockedOpen = 0;
    for (const e of myRunning) {
      const endTimeVal = new Date();
      const start = new Date(e.startTime?.toDate ? e.startTime.toDate() : e.startTime);
      const duration = Math.max(0, Math.floor((endTimeVal.getTime() - start.getTime()) / 60000));
      try {
        await timeEntryMutation.update(e.id, { endTime: endTimeVal, duration });
      } catch (err) {
        // A timer left running in a month that has since been CLOSED cannot be
        // written (rules: nothing in a closed month). It used to throw here,
        // before the create, so every Start failed silently forever.
        lockedOpen++;
        console.warn('[Timer] orë e hapur që s\'mund të mbyllet (muaj i mbyllur?):', e.id, err);
      }
    }
    if (lockedOpen) {
      toast({ title: 'Orë e hapur në muaj të mbyllur', description: `${lockedOpen} orë e vjetër mbeti e hapur dhe s'mund të mbyllet — njofto administratorin e financave.` });
    }

    await timeEntryMutation.create({
      userId: user.uid,
      taskId: task.id,
      // EXPLICIT null, never omitted: Firestore's `where('endTime','==',null)`
      // matches only documents that HAVE the field as null — a missing field is
      // invisible to it, which silently disabled the single-timer enforcement,
      // the "Duke punuar" badge and the running-timer views for every entry.
      endTime: null,
      projectId: task.projectId,
      // The client the hour serves, and whether it is client work at all. Both
      // writers used to hardcode `isBillable: false`, so utilisation and
      // billable value were structurally zero for every tenant.
      customerId: (task as any).customerId || undefined,
      description: `Working on: ${task.title}`,
      startTime: new Date(),
      date: timeEntryDayKey(new Date()),
      source: 'timer',
      isBillable: !!task.projectId && !!(task as any).customerId,
      isPomodoroSession: false,
    });
    } catch (err: any) {
      console.error('[Timer] nisja dështoi:', err);
      toast({ title: 'Timer-i nuk u nis', description: err?.message, variant: 'destructive' });
    } finally {
      timerBusyRef.current = false;
    }
  };

  const stopTimer = async () => {
    if (!runningEntry || !user) return;

    const endTimeVal = new Date();
    const duration = Math.max(0, Math.floor((endTimeVal.getTime() - new Date(runningEntry.startTime).getTime()) / 60000));

    try {
      await timeEntryMutation.update(runningEntry.id, {
        endTime: endTimeVal,
        duration,
      });
    } catch (err: any) {
      console.error('[Timer] ndalimi dështoi:', err);
      toast({ title: 'Timer-i nuk u ndal', description: err?.message || 'Ora mund të jetë në një muaj të mbyllur.', variant: 'destructive' });
    }
  };

  // Derive the total from each entry's start/end (source of truth) rather than the
  // stored `duration` field, which can be stale/corrupt when overlapping timers were
  // stopped against the wrong start (caused "2h log → 49h total"). See lib/timeTracking.
  const totalMinutes = totalTrackedMinutes(timeEntries);

  return (
    <div className="overflow-hidden rounded-[18px] border border-border bg-card px-4 py-3.5 shadow-[0_1px_2px_rgba(12,27,51,0.06)]">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-[11px] font-extrabold uppercase tracking-[0.06em] text-muted-foreground flex items-center gap-2">
          <Clock className="w-4 h-4" />
          Koha
        </h4>
        <span className="text-xs font-medium text-foreground">
          Total: {formatDuration(totalMinutes)}
        </span>
      </div>
      {/* Timer controls */}
      <div className="flex items-center gap-3 mb-3">
        <div className="text-xl font-mono font-bold tabular-nums">
          {formatTime(elapsedSeconds)}
        </div>
        {runningEntry ? (
          <Button onClick={stopTimer} variant="destructive" size="sm">
            <Square className="w-3 h-3 mr-1" />
            Stop
          </Button>
        ) : (
          <Button onClick={startTimer} size="sm" className="bg-success hover:bg-success/90">
            <Play className="w-3 h-3 mr-1" />
            Start
          </Button>
        )}
      </div>
      {/* Entry log */}
      {timeEntries && timeEntries.filter((e: any) => e.endTime).length > 0 && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground font-medium mb-1">Log</p>
          <div className="max-h-40 overflow-y-auto space-y-1">
            {timeEntries
              .filter((e: any) => e.endTime)
              .map((entry: any) => {
                const start = new Date(entry.startTime?.toDate ? entry.startTime.toDate() : entry.startTime);
                const end = new Date(entry.endTime?.toDate ? entry.endTime.toDate() : entry.endTime);
                // Same source of truth as the Total — never the stored `duration`.
                const dur = entryDurationMinutes(entry);
                return (
                  <div key={entry.id} className="flex items-center justify-between text-xs text-muted-foreground bg-muted/40 rounded px-2 py-1">
                    <span>{start.toLocaleDateString('sq-AL', { day: 'numeric', month: 'short' })}</span>
                    <span className="tabular-nums">
                      {start.toLocaleTimeString('sq-AL', { hour: '2-digit', minute: '2-digit' })}
                      {' → '}
                      {end.toLocaleTimeString('sq-AL', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <span className="font-medium text-foreground">{formatDuration(dur)}</span>
                  </div>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
};

export default TaskTimeTrackingSection;
