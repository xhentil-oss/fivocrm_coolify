import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DAILY_ESCALATION,
  dueAtForSchedule,
  dueEscalations,
  dueLabel,
  dueReminders,
  firstWorkingDayOfMonth,
  generationKey,
  isOverdue,
  isWorkingDay,
  localIsoDate,
  nextRunAt,
  shouldRunNow,
  targetPeriodFor,
  utcOffsetHours,
} from './schedule';
import type { Report, ReportSchedule } from '../../types';

const sched = (over: Partial<ReportSchedule> = {}): ReportSchedule => ({
  id: 'sch1',
  businessId: 'biz1',
  name: 'Raport mujor',
  active: true,
  kind: 'client-monthly',
  frequency: 'monthly',
  hour: 9,
  timezone: 'Europe/Tirane',
  createdAt: new Date(),
  updatedAt: new Date(),
  ...over,
});

describe('timezone handling', () => {
  it('resolves the Tirana offset including DST', () => {
    expect(utcOffsetHours('Europe/Tirane', new Date('2026-01-15T12:00:00Z'))).toBe(1);
    expect(utcOffsetHours('Europe/Tirane', new Date('2026-07-15T12:00:00Z'))).toBe(2);
  });

  it('falls back to UTC for an unknown zone instead of guessing', () => {
    expect(utcOffsetHours('Mars/Olympus', new Date('2026-07-15T12:00:00Z'))).toBe(0);
  });

  it('rolls the local date forward across midnight', () => {
    // 23:30 UTC in July is 01:30 the next day in Tirana.
    expect(localIsoDate(new Date('2026-07-30T23:30:00Z'), 'Europe/Tirane')).toBe('2026-07-31');
  });
});

describe('targetPeriodFor — a report covers the period that just ENDED', () => {
  it('monthly on the 1st reports the previous month', () => {
    const p = targetPeriodFor(sched({ frequency: 'monthly' }), new Date('2026-08-01T08:00:00Z'));
    expect(p.key).toBe('2026-07');
  });

  it('weekly on Monday reports last week', () => {
    // 2026-08-03 is a Monday → the finished week is 2026-W31.
    const p = targetPeriodFor(sched({ frequency: 'weekly' }), new Date('2026-08-03T08:00:00Z'));
    expect(p.key).toBe('2026-W31');
  });

  it('daily reports yesterday', () => {
    const p = targetPeriodFor(sched({ frequency: 'daily' }), new Date('2026-07-30T08:00:00Z'));
    expect(p.key).toBe('2026-07-29');
  });

  it('quarterly in July reports Q2', () => {
    const p = targetPeriodFor(sched({ frequency: 'quarterly' }), new Date('2026-07-02T08:00:00Z'));
    expect(p.key).toBe('2026-Q2');
  });
});

describe('working days', () => {
  it('rejects weekends by default', () => {
    expect(isWorkingDay(sched(), '2026-07-30')).toBe(true);  // Thursday
    expect(isWorkingDay(sched(), '2026-08-01')).toBe(false); // Saturday
  });

  it('rejects configured holidays', () => {
    expect(isWorkingDay(sched({ holidays: ['2026-07-30'] }), '2026-07-30')).toBe(false);
  });

  it('finds the first working day of a month that starts on a weekend', () => {
    // 2026-08-01 is a Saturday → first working day is Monday the 3rd.
    expect(firstWorkingDayOfMonth(sched(), '2026-08-15')).toBe('2026-08-03');
  });
});

describe('shouldRunNow', () => {
  it('skips an inactive schedule', () => {
    const r = shouldRunNow(sched({ active: false }), new Date('2026-08-03T08:00:00Z'));
    expect(r.run).toBe(false);
    expect(r.reason).toBe('jo aktiv');
  });

  it('waits for the configured local hour', () => {
    // 05:00 UTC = 07:00 Tirana, before the 09:00 slot.
    const r = shouldRunNow(sched({ frequency: 'monthly', dayOfMonth: 3 }), new Date('2026-08-03T05:00:00Z'));
    expect(r.run).toBe(false);
    expect(r.reason).toContain('ora');
  });

  it('still runs later the same day if the cron missed its slot', () => {
    // 20:00 UTC = 22:00 Tirana — well past 09:00, but the period is still owed.
    const r = shouldRunNow(sched({ frequency: 'monthly', dayOfMonth: 3 }), new Date('2026-08-03T20:00:00Z'));
    expect(r.run).toBe(true);
  });

  it('refuses to reproduce a period it already produced', () => {
    const r = shouldRunNow(
      sched({ frequency: 'monthly', dayOfMonth: 3, lastRunPeriodKey: '2026-07' }),
      new Date('2026-08-03T08:00:00Z'),
    );
    expect(r.run).toBe(false);
    expect(r.reason).toContain('është prodhuar');
  });

  it('honours the weekly day-of-week', () => {
    const monday = sched({ frequency: 'weekly', dayOfWeek: 1 });
    expect(shouldRunNow(monday, new Date('2026-08-03T08:00:00Z')).run).toBe(true);  // Monday
    expect(shouldRunNow(monday, new Date('2026-08-04T08:00:00Z')).run).toBe(false); // Tuesday
  });

  it('waits for the monthly target date', () => {
    const s = sched({ frequency: 'monthly', dayOfMonth: 5 });
    expect(shouldRunNow(s, new Date('2026-08-03T08:00:00Z')).run).toBe(false);
    expect(shouldRunNow(s, new Date('2026-08-05T08:00:00Z')).run).toBe(true);
  });

  it('uses the first WORKING day when dayOfMonth is 0', () => {
    const s = sched({ frequency: 'monthly', dayOfMonth: 0 });
    // Saturday 2026-08-01 is before the first working day (Monday the 3rd).
    expect(shouldRunNow(s, new Date('2026-08-01T08:00:00Z')).run).toBe(false);
    expect(shouldRunNow(s, new Date('2026-08-03T08:00:00Z')).run).toBe(true);
  });

  it('runs quarterly only in the quarter-opening months', () => {
    const s = sched({ frequency: 'quarterly', dayOfMonth: 5 });
    expect(shouldRunNow(s, new Date('2026-07-05T08:00:00Z')).run).toBe(true);
    expect(shouldRunNow(s, new Date('2026-08-05T08:00:00Z')).run).toBe(false);
  });

  it('skips a daily schedule on a non-working day', () => {
    const s = sched({ frequency: 'daily', hour: 8 });
    expect(shouldRunNow(s, new Date('2026-08-01T08:00:00Z')).reason).toBe('ditë pushimi');
  });

  it('never runs an ad-hoc schedule automatically', () => {
    expect(shouldRunNow(sched({ frequency: 'ad-hoc' }), new Date('2026-08-03T20:00:00Z')).run).toBe(false);
  });
});

describe('generationKey — the idempotency contract', () => {
  it('is stable for the same schedule and period', () => {
    expect(generationKey('sch1', '2026-07')).toBe('sch1:2026-07');
    expect(generationKey('sch1', '2026-07')).toBe(generationKey('sch1', '2026-07'));
  });

  it('separates per-member fan-out', () => {
    expect(generationKey('sch1', '2026-W31', 'u1')).not.toBe(generationKey('sch1', '2026-W31', 'u2'));
  });

  it('separates periods', () => {
    expect(generationKey('sch1', '2026-07')).not.toBe(generationKey('sch1', '2026-08'));
  });
});

describe('dueAtForSchedule', () => {
  it('applies the offset after the period end at the local hour', () => {
    const s = sched({ frequency: 'monthly', hour: 9, dueOffsetDays: 5 });
    const period = targetPeriodFor(s, new Date('2026-08-01T08:00:00Z')); // 2026-07
    const due = dueAtForSchedule(s, period, new Date('2026-08-01T08:00:00Z'));
    // 2026-07-31 + 5 days = 2026-08-05, 09:00 Tirana (UTC+2) = 07:00 UTC.
    expect(due.toISOString()).toBe('2026-08-05T07:00:00.000Z');
  });

  it('uses a sensible default offset per cadence', () => {
    const s = sched({ frequency: 'weekly', hour: 9 });
    const period = targetPeriodFor(s, new Date('2026-08-03T08:00:00Z'));
    const due = dueAtForSchedule(s, period, new Date('2026-08-03T08:00:00Z'));
    expect(due.toISOString().slice(0, 10)).toBe('2026-08-04'); // period end 08-02 + 2
  });
});

describe('nextRunAt', () => {
  it('finds the next monthly slot', () => {
    const s = sched({ frequency: 'monthly', dayOfMonth: 5, hour: 9 });
    const next = nextRunAt(s, new Date('2026-08-06T12:00:00Z'));
    expect(next?.toISOString().slice(0, 10)).toBe('2026-09-05');
  });

  it('returns null for an inactive or ad-hoc schedule', () => {
    expect(nextRunAt(sched({ active: false }), new Date())).toBeNull();
    expect(nextRunAt(sched({ frequency: 'ad-hoc' }), new Date())).toBeNull();
  });
});

// ── reminders / escalations ──

const rep = (over: Partial<Report> = {}): Report => ({
  id: 'r1',
  businessId: 'biz1',
  kind: 'client-monthly',
  title: 'Raport',
  status: 'in_progress',
  period: { frequency: 'monthly', key: '2026-07', start: '2026-07-01', end: '2026-07-31' },
  authorUserId: 'u1',
  blocks: [],
  version: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...over,
});

const DUE = new Date('2026-08-05T07:00:00Z');

describe('dueReminders', () => {
  it('fires the 1-day reminder inside the window', () => {
    const r = rep({ dueAt: DUE });
    const out = dueReminders(r, [5, 3, 1], new Date('2026-08-04T08:00:00Z'));
    expect(out).toEqual([{ offsetDays: 1 }]);
  });

  it('fires only the closest un-sent rung, never a burst', () => {
    const r = rep({ dueAt: DUE, remindersSent: [] });
    const out = dueReminders(r, [5, 3, 1], new Date('2026-08-04T08:00:00Z'));
    expect(out).toHaveLength(1);
  });

  it('does not repeat a rung already sent', () => {
    const r = rep({ dueAt: DUE, remindersSent: [1] });
    expect(dueReminders(r, [1], new Date('2026-08-04T08:00:00Z'))).toEqual([]);
  });

  it('is silent long before the deadline', () => {
    const r = rep({ dueAt: DUE });
    expect(dueReminders(r, [1], new Date('2026-07-20T08:00:00Z'))).toEqual([]);
  });

  it('is silent once overdue (escalation takes over)', () => {
    const r = rep({ dueAt: DUE });
    expect(dueReminders(r, [1], new Date('2026-08-06T08:00:00Z'))).toEqual([]);
  });

  it('is silent for a report that is no longer open', () => {
    const r = rep({ dueAt: DUE, status: 'published' });
    expect(dueReminders(r, [1], new Date('2026-08-04T08:00:00Z'))).toEqual([]);
  });
});

describe('dueEscalations', () => {
  it('fires the rung whose threshold has passed', () => {
    const r = rep({ dueAt: DUE });
    const out = dueEscalations(r, DEFAULT_DAILY_ESCALATION, new Date('2026-08-05T07:45:00Z'));
    expect(out).toHaveLength(1);
    expect(out[0].rule.notify).toBe('team_leader'); // 30 min rung
    expect(out[0].overdueMinutes).toBe(45);
  });

  it('jumps straight to the highest reached rung after an outage', () => {
    const r = rep({ dueAt: DUE });
    const out = dueEscalations(r, DEFAULT_DAILY_ESCALATION, new Date('2026-08-05T20:00:00Z'));
    expect(out).toHaveLength(1);
    expect(out[0].rule.notify).toBe('management');
    expect(out[0].rule.markMissing).toBe(true);
  });

  it('never repeats a rung', () => {
    const r = rep({ dueAt: DUE, escalationsSent: [0, 30] });
    const out = dueEscalations(r, DEFAULT_DAILY_ESCALATION, new Date('2026-08-05T07:45:00Z'));
    expect(out).toEqual([]);
  });

  it('is silent before the deadline', () => {
    const r = rep({ dueAt: DUE });
    expect(dueEscalations(r, DEFAULT_DAILY_ESCALATION, new Date('2026-08-05T06:00:00Z'))).toEqual([]);
  });

  it('is silent for a submitted-and-approved report', () => {
    const r = rep({ dueAt: DUE, status: 'internally_approved' });
    expect(dueEscalations(r, DEFAULT_DAILY_ESCALATION, new Date('2026-08-06T06:00:00Z'))).toEqual([]);
  });
});

describe('overdue helpers', () => {
  it('detects overdue open reports only', () => {
    expect(isOverdue(rep({ dueAt: DUE }), new Date('2026-08-06T00:00:00Z'))).toBe(true);
    expect(isOverdue(rep({ dueAt: DUE }), new Date('2026-08-04T00:00:00Z'))).toBe(false);
    expect(isOverdue(rep({ dueAt: DUE, status: 'published' }), new Date('2026-08-06T00:00:00Z'))).toBe(false);
    expect(isOverdue(rep({}), new Date())).toBe(false);
  });

  it('labels the distance to the deadline in Albanian', () => {
    expect(dueLabel(DUE, new Date('2026-08-05T06:00:00Z'))).toBe('Afati sot');
    expect(dueLabel(DUE, new Date('2026-08-04T06:00:00Z'))).toBe('Afati nesër');
    expect(dueLabel(DUE, new Date('2026-08-08T06:00:00Z'))).toContain('e vonuar');
    expect(dueLabel(undefined, new Date())).toBe('—');
  });
});
