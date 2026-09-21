import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation } from '../hooks/useFirestore';
import { useAuth } from '../contexts/AuthContext';
import { Button } from './ui/button';
import { X, Play, Pause, RotateCcw, Check, Brain } from 'lucide-react';
import type { TimeEntry } from '../types';
import { dayKeyOf } from '../lib/finance/timeEntries';

/**
 * Focus Mode — Deep Work (Cal Newport) + Pomodoro, tied to the day's frog.
 *
 * A distraction-free countdown. When the session ends (or you stop it), the
 * focused minutes are written as a COMPLETED `timeEntry` with `isPomodoroSession`
 * so they count as deep-work in the Momentum score. We deliberately log on finish
 * rather than keeping a running Firestore doc open, so a closed tab never leaves a
 * dangling timer.
 */

const PRESETS = [
  { min: 25, label: 'Pomodoro' },
  { min: 50, label: 'Deep Work' },
  { min: 90, label: 'Deep Work +' },
];

const pad = (n: number) => String(n).padStart(2, '0');

const FocusMode: React.FC<{
  open: boolean;
  onClose: () => void;
  taskTitle?: string;
  taskId?: string;
  /** The task's project/client, so the session reaches the project P&L. */
  projectId?: string;
  customerId?: string;
  onLogged?: (minutes: number) => void;
}> = ({ open, onClose, taskTitle, taskId, projectId, customerId, onLogged }) => {
  const { user } = useAuth();
  const timeEntryMutation = useMutation<TimeEntry>('timeEntries');

  const [durationMin, setDurationMin] = useState(25);
  const [secondsLeft, setSecondsLeft] = useState(25 * 60);
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);
  const loggedRef = useRef(false);

  // Reset when (re)opened.
  useEffect(() => {
    if (open) {
      setDurationMin(25);
      setSecondsLeft(25 * 60);
      setRunning(false);
      setFinished(false);
      loggedRef.current = false;
    }
  }, [open]);

  // Countdown tick.
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          clearInterval(id);
          setRunning(false);
          setFinished(true);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [running]);

  const focusedSeconds = durationMin * 60 - secondsLeft;

  const logSession = async () => {
    if (loggedRef.current || !user) return;
    const secs = durationMin * 60 - secondsLeft;
    if (secs < 60) return; // ignore <1 min
    loggedRef.current = true;
    const mins = Math.round(secs / 60);
    try {
      await timeEntryMutation.create({
        userId: user.uid,
        taskId: taskId || undefined,
        projectId: projectId || undefined,
        customerId: customerId || undefined,
        description: taskTitle || 'Focus session',
        startTime: new Date(Date.now() - secs * 1000),
        endTime: new Date(),
        duration: mins,
        date: dayKeyOf(new Date()),
        source: 'pomodoro',
        isBillable: !!projectId && !!customerId,
        isPomodoroSession: true,
      } as any);
      onLogged?.(mins);
    } catch { /* ignore */ }
  };

  // Auto-log when the countdown completes.
  useEffect(() => {
    if (finished) void logSession();
    // eslint-disable-line react-hooks/exhaustive-deps
  }, [finished]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  const total = durationMin * 60;
  const pct = total > 0 ? secondsLeft / total : 0;
  const r = 46;
  const circ = 2 * Math.PI * r;
  const mm = Math.floor(secondsLeft / 60);
  const ss = secondsLeft % 60;

  const handleEndAndLog = async () => { await logSession(); onClose(); };
  const handleClose = async () => { await logSession(); onClose(); };

  return createPortal(
    <div className="fixed inset-0 z-[100] bg-background/97 backdrop-blur-sm flex flex-col items-center justify-center p-6">
      <button onClick={handleClose} className="absolute top-5 right-5 text-muted-foreground hover:text-foreground" aria-label="Mbyll">
        <X className="w-6 h-6" />
      </button>

      <div className="flex items-center gap-2 text-primary mb-1">
        <Brain className="w-5 h-5" />
        <span className="text-sm font-semibold uppercase tracking-wider">Focus Mode</span>
      </div>
      <p className="text-lg font-medium text-foreground text-center max-w-md mb-8 flex items-center gap-2">
        {taskTitle ? <><span>🐸</span> {taskTitle}</> : 'Punë e thellë pa ndërprerje'}
      </p>

      {/* Countdown ring */}
      <div className="relative w-72 h-72 mb-8">
        <svg className="w-72 h-72 -rotate-90" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r={r} fill="none" stroke="currentColor" strokeWidth="4" className="text-muted/30" />
          <circle
            cx="50" cy="50" r={r} fill="none" strokeWidth="4" strokeLinecap="round"
            strokeDasharray={`${pct * circ} ${circ}`}
            className={finished ? 'text-green-500' : 'text-primary'}
            style={{ transition: 'stroke-dasharray 1s linear' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {finished ? (
            <>
              <Check className="w-12 h-12 text-green-500 mb-2" />
              <span className="text-lg font-semibold text-foreground">Sesioni mbaroi!</span>
              <span className="text-xs text-muted-foreground">{durationMin} min deep work u regjistruan 🎉</span>
            </>
          ) : (
            <>
              <span className="text-6xl font-bold tabular-nums text-foreground">{pad(mm)}:{pad(ss)}</span>
              <span className="text-xs text-muted-foreground uppercase tracking-wider mt-1">
                {running ? 'Fokusohu…' : focusedSeconds > 0 ? 'Në pauzë' : 'Gati'}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Presets (only before starting) */}
      {focusedSeconds === 0 && !finished && (
        <div className="flex gap-2 mb-6">
          {PRESETS.map((p) => (
            <button
              key={p.min}
              onClick={() => { setDurationMin(p.min); setSecondsLeft(p.min * 60); }}
              className={`px-4 py-2 rounded-lg text-sm border transition ${durationMin === p.min ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {p.min}m · {p.label}
            </button>
          ))}
        </div>
      )}

      {/* Controls */}
      <div className="flex items-center gap-3">
        {finished ? (
          <>
            <Button variant="outline" onClick={() => { setSecondsLeft(durationMin * 60); setFinished(false); loggedRef.current = false; }}>
              <RotateCcw className="w-4 h-4 mr-2" /> Sesion tjetër
            </Button>
            <Button onClick={onClose}>Mbaro</Button>
          </>
        ) : (
          <>
            <Button size="lg" onClick={() => setRunning((v) => !v)} className="gap-2 min-w-[140px]">
              {running ? <><Pause className="w-5 h-5" /> Pauzë</> : <><Play className="w-5 h-5" /> {focusedSeconds > 0 ? 'Vazhdo' : 'Fillo'}</>}
            </Button>
            {focusedSeconds > 0 && (
              <Button variant="outline" size="lg" onClick={handleEndAndLog} className="gap-2">
                <Check className="w-5 h-5" /> Mbaro & Regjistro
              </Button>
            )}
          </>
        )}
      </div>
    </div>,
    document.body,
  );
};

export default FocusMode;
