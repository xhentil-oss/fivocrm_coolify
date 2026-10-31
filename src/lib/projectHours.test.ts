import { describe, it, expect } from 'vitest';
import { projectHoursRollup, formatHoursCompact } from './projectHours';
import { entryHours } from './finance/laborCost';

const t = (h: number, m = 0) => new Date(Date.UTC(2026, 9, 5, h, m));

describe('projectHoursRollup', () => {
  it('reads duration as MINUTES for typed rows — a 120-minute row is 2 hours, not 2 minutes', () => {
    const r = projectHoursRollup([
      { taskId: 'a', duration: 120, source: 'manual', startTime: t(10), endTime: t(12) },
    ]);
    expect(r.totalHours).toBe(2);
    expect(r.hoursByTask.get('a')).toBe(2);
  });

  it('timer rows use the span, a stale duration may only shorten it, a running row is 0', () => {
    const r = projectHoursRollup([
      { taskId: 'a', duration: 3000, source: 'timer', startTime: t(9), endTime: t(10, 30) },
      { taskId: 'a', duration: 30, source: 'timer', startTime: t(11), endTime: t(12) },
      { taskId: 'b', source: 'timer', startTime: t(13) },
    ]);
    expect(r.hoursByTask.get('a')).toBe(2);
    expect(r.hoursByTask.has('b')).toBe(false);
    expect(r.totalHours).toBe(2);
  });

  it('is the finance engine\'s definition — same answer as entryHours row by row', () => {
    const rows = [
      { taskId: 'x', duration: 45, source: 'daily-report' as const, startTime: t(9), endTime: t(9, 45) },
      { taskId: 'y', source: 'pomodoro' as const, startTime: t(9), endTime: t(9, 25) },
      { duration: 60, source: 'manual' as const, startTime: t(9), endTime: t(10) },
    ];
    const r = projectHoursRollup(rows);
    expect(r.totalHours).toBeCloseTo(rows.reduce((s, e) => s + entryHours(e), 0), 10);
    expect(r.hoursByTask.get('x')).toBeCloseTo(0.75, 10);
  });
});

describe('formatHoursCompact', () => {
  it('minutes under an hour, one decimal from an hour up', () => {
    expect(formatHoursCompact(0.5)).toBe('30m');
    expect(formatHoursCompact(2)).toBe('2.0h');
    expect(formatHoursCompact(2.25)).toBe('2.3h');
    expect(formatHoursCompact(0)).toBe('0m');
  });
});
