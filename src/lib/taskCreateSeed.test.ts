import { describe, it, expect } from 'vitest';
import { recurrenceSeedPatch, recurrenceSeedFromForm, recurringEndDateFromInput, isRecurringFrequency } from './taskCreateSeed';
import { zonedDate, zonedParts, startOfRecurrenceDay } from './recurringUtils';

/** A FormData stand-in — jsdom's FormData works too, but this keeps the shape explicit. */
function form(fields: Record<string, string>): Pick<FormData, 'get'> {
  return { get: (k: string) => (k in fields ? fields[k] : null) } as Pick<FormData, 'get'>;
}

describe('recurringEndDateFromInput', () => {
  it('is the END of the chosen day in Europe/Tirane, not local midnight', () => {
    const at = recurringEndDateFromInput('2026-08-11')!;
    const p = zonedParts(at);
    expect([p.year, p.month, p.day, p.hours, p.minutes]).toEqual([2026, 7, 11, 23, 59]);
    // The same calendar day as the engine's day comparison.
    expect(startOfRecurrenceDay(at)).toBe(startOfRecurrenceDay(zonedDate(2026, 7, 11, 12)));
  });

  it('rejects garbage', () => {
    expect(recurringEndDateFromInput('')).toBeNull();
    expect(recurringEndDateFromInput(null)).toBeNull();
    expect(recurringEndDateFromInput('11/08/2026')).toBeNull();
    expect(recurringEndDateFromInput('2026-13-01')).toBeNull();
  });
});

describe('recurrenceSeedPatch', () => {
  // Monday 2 Nov 2026 is "today"; the task is planned for Wednesday 11 Nov 09:00 Tirane.
  const now = zonedDate(2026, 10, 2, 10, 0);
  const start = zonedDate(2026, 10, 11, 9, 0);
  const end = zonedDate(2026, 10, 11, 11, 0);

  it('weekly: next cycle is the task\'s own start + 7 days — never before startDate', () => {
    const p = recurrenceSeedPatch({ frequency: 'weekly', dayOfWeek: 3, startDate: start, endDate: end, now });
    expect(p.nextRecurringDate!.getTime()).toBe(zonedDate(2026, 10, 18, 9, 0).getTime());
    expect(p.nextRecurringDate!.getTime()).toBeGreaterThan(start.getTime());
    expect(p.recurringDayOfWeek).toBe(3);
    expect(p.recurringInterval).toBe(1);
    expect(p.isRecurring).toBe(true);
  });

  it('weekly without a weekday stores the start day\'s weekday (zone-explicit)', () => {
    const p = recurrenceSeedPatch({ frequency: 'weekly', startDate: start, now });
    expect(p.recurringDayOfWeek).toBe(3);
    expect(p.nextRecurringDate!.getTime()).toBe(zonedDate(2026, 10, 18, 9, 0).getTime());
  });

  it('every 2 weeks steps 14 days', () => {
    const p = recurrenceSeedPatch({ frequency: 'weekly', interval: 2, dayOfWeek: 3, startDate: start, now });
    expect(p.nextRecurringDate!.getTime()).toBe(zonedDate(2026, 10, 25, 9, 0).getTime());
    expect(p.recurringInterval).toBe(2);
  });

  it('daily on Mon–Fri skips the weekend from a Friday start', () => {
    const fri = zonedDate(2026, 10, 6, 9, 0);
    const p = recurrenceSeedPatch({ frequency: 'daily', startDate: fri, now });
    expect(p.recurringDaysOfWeek).toEqual([1, 2, 3, 4, 5]);
    expect(p.nextRecurringDate!.getTime()).toBe(zonedDate(2026, 10, 9, 9, 0).getTime());
  });

  it('monthly on the 31st clamps to the short month and keeps the anchor', () => {
    const jan31 = zonedDate(2027, 0, 31, 9, 0);
    const p = recurrenceSeedPatch({ frequency: 'monthly', dayOfMonth: 31, startDate: jan31, now: zonedDate(2027, 0, 30) });
    expect(p.recurringDayOfMonth).toBe(31);
    expect(p.nextRecurringDate!.getTime()).toBe(zonedDate(2027, 1, 28, 9, 0).getTime());
  });

  it('yearly steps a year from the start', () => {
    const p = recurrenceSeedPatch({ frequency: 'yearly', startDate: start, now });
    expect(p.nextRecurringDate!.getTime()).toBe(zonedDate(2027, 10, 11, 9, 0).getTime());
  });

  it('a start already in the past seeds from now (the panel\'s rule) so the backstop does not spawn at once', () => {
    const old = zonedDate(2026, 9, 1, 9, 0);
    const p = recurrenceSeedPatch({ frequency: 'weekly', dayOfWeek: 4, startDate: old, now });
    expect(p.nextRecurringDate!.getTime()).toBeGreaterThan(now.getTime());
    expect(zonedParts(p.nextRecurringDate!).weekday).toBe(4);
  });

  it('carries the Tirane end-of-day "deri më"', () => {
    const p = recurrenceSeedPatch({ frequency: 'weekly', startDate: start, endDateRaw: '2026-12-31', now });
    expect(zonedParts(p.recurringEndDate!)).toMatchObject({ year: 2026, month: 11, day: 31, hours: 23, minutes: 59 });
  });
});

describe('recurrenceSeedFromForm', () => {
  const now = zonedDate(2026, 10, 2, 10, 0);
  const start = zonedDate(2026, 10, 11, 9, 0);

  it('returns null for a non-recurring or unknown-frequency form', () => {
    expect(recurrenceSeedFromForm(form({}), { startDate: start }, now)).toBeNull();
    expect(recurrenceSeedFromForm(form({ isRecurring: 'true', recurringFrequency: 'fortnightly' }), { startDate: start }, now)).toBeNull();
    expect(isRecurringFrequency('weekly')).toBe(true);
    expect(isRecurringFrequency('x')).toBe(false);
  });

  it('parses the quick form\'s fields exactly as it sends them', () => {
    const p = recurrenceSeedFromForm(form({
      isRecurring: 'true',
      recurringFrequency: 'daily',
      recurringInterval: '1',
      recurringDaysOfWeek: '[1,3,5]',
      recurringEndDate: '2026-11-30',
    }), { startDate: start }, now)!;
    expect(p.recurringFrequency).toBe('daily');
    expect(p.recurringDaysOfWeek).toEqual([1, 3, 5]);
    // Wed 11 Nov → Fri 13 Nov
    expect(p.nextRecurringDate!.getTime()).toBe(zonedDate(2026, 10, 13, 9, 0).getTime());
    expect(zonedParts(p.recurringEndDate!)).toMatchObject({ month: 10, day: 30, hours: 23 });
  });
});
