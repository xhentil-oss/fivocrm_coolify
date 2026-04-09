import { useEffect, useRef, useState } from 'react';
import { useToast } from './use-toast';

// Synthesise a bird chirp using Web Audio API — no audio files needed
function playBirdChirp() {
  try {
    const Ctx = window.AudioContext ?? (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx: AudioContext = new Ctx();
    if (ctx.state === 'suspended') ctx.resume();

    const chirp = (t: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.type = 'sine';
      // Quick frequency sweep — chirp sound
      osc.frequency.setValueAtTime(2600, t);
      osc.frequency.exponentialRampToValueAtTime(4400, t + 0.06);
      osc.frequency.exponentialRampToValueAtTime(3000, t + 0.13);

      // Soft envelope
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.22, t + 0.02);
      gain.gain.setValueAtTime(0.22, t + 0.09);
      gain.gain.linearRampToValueAtTime(0, t + 0.13);

      osc.start(t);
      osc.stop(t + 0.13);
    };

    // Three chirps with ~280 ms gap between each
    const now = ctx.currentTime;
    chirp(now);
    chirp(now + 0.28);
    chirp(now + 0.56);

    setTimeout(() => ctx.close(), 1500);
  } catch {
    // Web Audio API unavailable — silently skip
  }
}

// Returns ms until the next break hour (8, 10, 12, 14, 16, 18)
function msUntilNextBreak(): number {
  const now = new Date();
  const breakHours = [8, 10, 12, 14, 16, 18];

  for (const bh of breakHours) {
    const candidate = new Date(now);
    candidate.setHours(bh, 0, 0, 0);
    const diff = candidate.getTime() - now.getTime();
    if (diff > 0) return diff;
  }

  // All today's breaks passed → schedule for 08:00 tomorrow
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(8, 0, 0, 0);
  return tomorrow.getTime() - now.getTime();
}

function fireBreakNotification(showToast: (opts: any) => void) {
  playBirdChirp();

  showToast({
    title: '🏃 Koha për lëvizje!',
    description: 'Ngrihu nga vendi — trupi jot të falënderon! 💪',

    duration: 12_000,
  });

  const notify = () =>
    new Notification('🏃 Koha për lëvizje!', {
      body: 'Ngrihu nga vendi — trupi jot të falënderon! 💪',
      icon: '/favicon.ico',
      tag: 'break-reminder', // replaces previous if user hasn't dismissed
    });

  if (Notification.permission === 'granted') {
    notify();
  } else if (Notification.permission !== 'denied') {
    Notification.requestPermission().then((p) => {
      if (p === 'granted') notify();
    });
  }
}

const STORAGE_KEY = 'break_reminder_enabled';

/** Returns true if the break reminder is enabled (default: true). */
export function isBreakReminderEnabled(): boolean {
  return localStorage.getItem(STORAGE_KEY) !== 'false';
}

/** Persist the break reminder preference. */
export function setBreakReminderEnabled(enabled: boolean): void {
  localStorage.setItem(STORAGE_KEY, enabled ? 'true' : 'false');
  // Notify same-tab listeners via storage event (cross-tab already fires natively)
  window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY, newValue: String(enabled) }));
}

/**
 * Fires a "get up and move" reminder (with bird sounds) at 08:00, 10:00,
 * 12:00, 14:00, 16:00, and 18:00 — every 2 hours from the start of the
 * work day. Uses precise setTimeout scheduling so it fires exactly on the
 * hour rather than drifting with an interval.
 *
 * Respects the `break_reminder_enabled` localStorage flag (default: true).
 * Call `setBreakReminderEnabled(false)` to silence it.
 */
export function useBreakReminder() {
  const { toast } = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const [enabled, setEnabled] = useState(isBreakReminderEnabled);

  // Keep in sync with localStorage changes (from SettingsView or other tabs)
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setEnabled(e.newValue !== 'false');
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  useEffect(() => {
    if (!enabled) return;

    let timeoutId: ReturnType<typeof setTimeout>;

    const schedule = () => {
      const delay = msUntilNextBreak();
      timeoutId = setTimeout(() => {
        fireBreakNotification(toastRef.current);
        schedule(); // schedule the one after
      }, delay);
    };

    schedule();
    return () => clearTimeout(timeoutId);
  }, [enabled]);
}
