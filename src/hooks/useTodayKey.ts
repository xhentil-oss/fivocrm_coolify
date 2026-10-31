import { useEffect, useState } from 'react';
import { todayKeyOf } from '../lib/taskDue';

/**
 * Start of TODAY's Europe/Tirane day (ms), as React state that changes exactly
 * when the Tirane day does.
 *
 * Every "is this overdue / due today" memo must take this as a dependency and
 * pass it as `now` to the taskDue helpers. A memo that reads `new Date()`
 * inside without it is computed once per data change: a page left open past
 * midnight kept describing yesterday — the Vonuar chip, the `overdue` filter,
 * the "Sot / Të vonuara" groups and the MyTasks summary all went stale.
 *
 * Re-checked once a minute and whenever the tab becomes visible or focused
 * again (a phone that slept through midnight gets the new day on wake, not up
 * to a minute later), and only ever SETS a new value — same-day ticks are no-ops.
 */
export function useTodayKey(): number {
  const [key, setKey] = useState(() => todayKeyOf());
  useEffect(() => {
    const check = () => {
      const k = todayKeyOf();
      setKey(prev => (prev === k ? prev : k));
    };
    const onVisibility = () => { if (document.visibilityState === 'visible') check(); };
    const id = window.setInterval(check, 60_000);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', check);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', check);
    };
  }, []);
  return key;
}
