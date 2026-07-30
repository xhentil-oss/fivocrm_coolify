import { describe, expect, it } from 'vitest';
import {
  addDays,
  buildPeriod,
  datesInPeriod,
  daysBetween,
  dueAtFor,
  endOfMonth,
  formatPeriodLabel,
  fromIsoDate,
  isWithinPeriod,
  isoWeekKey,
  isoWeekParts,
  isoWeekday,
  parsePeriodKey,
  periodKeyFor,
  previousPeriod,
  quarterOf,
  startOfIsoWeek,
  toIsoDate,
  workingDaysInPeriod,
  yearAgoPeriod,
} from './period';

describe('iso date helpers', () => {
  it('round-trips a date', () => {
    expect(toIsoDate(fromIsoDate('2026-07-30'))).toBe('2026-07-30');
  });

  it('rejects malformed input', () => {
    expect(() => fromIsoDate('30/07/2026')).toThrow(/pavlefshme/);
  });

  it('adds days across month and year boundaries', () => {
    expect(addDays('2026-07-31', 1)).toBe('2026-08-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29'); // leap year
  });

  it('uses ISO weekdays (Mon=1, Sun=7)', () => {
    expect(isoWeekday('2026-07-30')).toBe(4); // Thursday
    expect(isoWeekday('2026-08-02')).toBe(7); // Sunday
  });

  it('finds the Monday of a week, including from a Sunday', () => {
    expect(startOfIsoWeek('2026-07-30')).toBe('2026-07-27');
    expect(startOfIsoWeek('2026-08-02')).toBe('2026-07-27');
    expect(startOfIsoWeek('2026-07-27')).toBe('2026-07-27');
  });

  it('computes end of month, including February', () => {
    expect(endOfMonth('2026-02-10')).toBe('2026-02-28');
    expect(endOfMonth('2028-02-10')).toBe('2028-02-29');
    expect(endOfMonth('2026-12-01')).toBe('2026-12-31');
  });

  it('computes quarters', () => {
    expect(quarterOf('2026-01-15')).toBe(1);
    expect(quarterOf('2026-03-31')).toBe(1);
    expect(quarterOf('2026-04-01')).toBe(2);
    expect(quarterOf('2026-07-30')).toBe(3);
    expect(quarterOf('2026-12-31')).toBe(4);
  });
});

describe('ISO week numbering', () => {
  it('handles the year boundary correctly', () => {
    // 2026-12-31 is a Thursday → still week 53 of 2026.
    expect(isoWeekKey('2026-12-31')).toBe('2026-W53');
    // 2027-01-01 is a Friday, same ISO week as 2026-12-31.
    expect(isoWeekKey('2027-01-01')).toBe('2026-W53');
    // 2026-01-01 is a Thursday → week 1 of 2026.
    expect(isoWeekKey('2026-01-01')).toBe('2026-W01');
  });

  it('keeps the week-year distinct from the calendar year', () => {
    expect(isoWeekParts('2027-01-01')).toEqual({ year: 2026, week: 53 });
  });

  it('round-trips a week key through parsePeriodKey', () => {
    const p = parsePeriodKey('2026-W31');
    expect(p.start).toBe('2026-07-27');
    expect(p.end).toBe('2026-08-02');
    expect(isoWeekKey(p.start)).toBe('2026-W31');
  });
});

describe('buildPeriod', () => {
  it('builds a weekly period from any day in it', () => {
    expect(buildPeriod('weekly', '2026-07-30')).toMatchObject({
      key: '2026-W31', start: '2026-07-27', end: '2026-08-02',
    });
  });

  it('builds a monthly period', () => {
    expect(buildPeriod('monthly', '2026-07-30')).toMatchObject({
      key: '2026-07', start: '2026-07-01', end: '2026-07-31',
    });
  });

  it('builds a quarterly period', () => {
    expect(buildPeriod('quarterly', '2026-07-30')).toMatchObject({
      key: '2026-Q3', start: '2026-07-01', end: '2026-09-30',
    });
  });

  it('builds a single-day period', () => {
    expect(buildPeriod('daily', '2026-07-30')).toMatchObject({
      key: '2026-07-30', start: '2026-07-30', end: '2026-07-30',
    });
  });
});

describe('periodKeyFor', () => {
  it('produces the canonical key per cadence', () => {
    expect(periodKeyFor('daily', '2026-07-30')).toBe('2026-07-30');
    expect(periodKeyFor('weekly', '2026-07-30')).toBe('2026-W31');
    expect(periodKeyFor('monthly', '2026-07-30')).toBe('2026-07');
    expect(periodKeyFor('quarterly', '2026-07-30')).toBe('2026-Q3');
  });
});

describe('parsePeriodKey', () => {
  it('parses every canonical shape', () => {
    expect(parsePeriodKey('2026-07').start).toBe('2026-07-01');
    expect(parsePeriodKey('2026-Q2')).toMatchObject({ start: '2026-04-01', end: '2026-06-30' });
    expect(parsePeriodKey('2026-07-30').frequency).toBe('daily');
  });

  it('rejects nonsense', () => {
    expect(() => parsePeriodKey('korrik 2026')).toThrow(/panjohur/);
  });
});

describe('previousPeriod', () => {
  it('steps back one week', () => {
    expect(previousPeriod(buildPeriod('weekly', '2026-07-30')).key).toBe('2026-W30');
  });

  it('steps back one month across a year boundary', () => {
    expect(previousPeriod(buildPeriod('monthly', '2026-01-15')).key).toBe('2025-12');
  });

  it('steps back one quarter across a year boundary', () => {
    expect(previousPeriod(buildPeriod('quarterly', '2026-01-15')).key).toBe('2025-Q4');
  });

  it('shifts an ad-hoc range by its own length', () => {
    const adhoc = { frequency: 'ad-hoc' as const, key: 'x', start: '2026-07-10', end: '2026-07-19' };
    const prev = previousPeriod(adhoc);
    expect(prev.start).toBe('2026-06-30');
    expect(prev.end).toBe('2026-07-09');
  });
});

describe('yearAgoPeriod', () => {
  it('shifts a month back a year', () => {
    expect(yearAgoPeriod(buildPeriod('monthly', '2026-07-15')).key).toBe('2025-07');
  });

  it('shifts a week by week NUMBER, clamped to the previous year length', () => {
    expect(yearAgoPeriod(buildPeriod('weekly', '2026-07-30')).key).toBe('2025-W31');
  });

  it('clamps W53 to the last week of a 52-week year', () => {
    // 2026 has 53 ISO weeks; 2025 has 52. W53 must clamp, not produce W53 of 2025.
    const p = parsePeriodKey('2026-W53');
    expect(yearAgoPeriod(p).key).toBe('2025-W52');
  });
});

describe('date ranges', () => {
  it('counts days inclusively', () => {
    expect(daysBetween('2026-07-01', '2026-07-31')).toBe(30);
    expect(datesInPeriod({ start: '2026-07-01', end: '2026-07-03' })).toEqual(
      ['2026-07-01', '2026-07-02', '2026-07-03'],
    );
  });

  it('refuses absurd ranges rather than allocating', () => {
    expect(datesInPeriod({ start: '2020-01-01', end: '2026-01-01' })).toEqual([]);
  });

  it('tests membership inclusively', () => {
    const p = buildPeriod('monthly', '2026-07-15');
    expect(isWithinPeriod('2026-07-01', p)).toBe(true);
    expect(isWithinPeriod('2026-07-31', p)).toBe(true);
    expect(isWithinPeriod('2026-08-01', p)).toBe(false);
  });
});

describe('workingDaysInPeriod', () => {
  it('excludes weekends by default', () => {
    // 2026-07-27 (Mon) … 2026-08-02 (Sun)
    const week = buildPeriod('weekly', '2026-07-30');
    expect(workingDaysInPeriod(week)).toHaveLength(5);
  });

  it('excludes holidays that fall on working days', () => {
    const week = buildPeriod('weekly', '2026-07-30');
    expect(workingDaysInPeriod(week, [1, 2, 3, 4, 5], ['2026-07-29'])).toHaveLength(4);
  });

  it('honours a six-day working week', () => {
    const week = buildPeriod('weekly', '2026-07-30');
    expect(workingDaysInPeriod(week, [1, 2, 3, 4, 5, 6])).toHaveLength(6);
  });
});

describe('dueAtFor', () => {
  it('resolves a local hour into a UTC instant', () => {
    // 09:00 at UTC+2 == 07:00 UTC, on the day 5 days after period end.
    const due = dueAtFor({ end: '2026-07-31' }, 5, 9, 2);
    expect(due.toISOString()).toBe('2026-08-05T07:00:00.000Z');
  });

  it('treats a negative offset as zero', () => {
    const due = dueAtFor({ end: '2026-07-31' }, -3, 9, 0);
    expect(toIsoDate(due)).toBe('2026-07-31');
  });
});

describe('formatPeriodLabel', () => {
  it('labels each cadence in Albanian', () => {
    expect(formatPeriodLabel(buildPeriod('monthly', '2026-07-15'))).toBe('Korrik 2026');
    expect(formatPeriodLabel(buildPeriod('quarterly', '2026-07-15'))).toBe('Tremujori 3 2026');
    expect(formatPeriodLabel(buildPeriod('daily', '2026-07-30'))).toBe('30/07/2026');
    expect(formatPeriodLabel(buildPeriod('weekly', '2026-07-30'))).toContain('Java 31, 2026');
  });
});
