import { describe, it, expect } from 'vitest';
import {
  startOfBillingWeek,
  projectBillingPeriodKey,
  projectBillingPeriodEnd,
  periodAlreadyBilledLegacy,
  projectBillingBlockReason,
  isPermanentBillingBlock,
  billingDayForMonth,
  projectPeriodsSkipped,
  pauseProjectBillingPatch,
  resumeProjectBillingPatch,
  stopProjectBillingPatch,
} from './recurringBilling';

describe('startOfBillingWeek', () => {
  it('anchors on Monday for every day of the week', () => {
    // 2026-08-03 is a Monday.
    const monday = new Date(2026, 7, 3);
    for (let i = 0; i < 7; i++) {
      const d = new Date(2026, 7, 3 + i);
      expect(startOfBillingWeek(d).getTime()).toBe(monday.getTime());
    }
  });

  it('walks back across a month boundary from a Sunday', () => {
    // 2026-08-02 is a Sunday → its week started Monday 2026-07-27.
    expect(startOfBillingWeek(new Date(2026, 7, 2)).getTime()).toBe(new Date(2026, 6, 27).getTime());
  });
});

describe('projectBillingPeriodKey', () => {
  it('keys monthly by calendar month', () => {
    expect(projectBillingPeriodKey('monthly', new Date(2026, 7, 1))).toBe('2026-08');
    expect(projectBillingPeriodKey('monthly', new Date(2026, 7, 31))).toBe('2026-08');
    expect(projectBillingPeriodKey('monthly', new Date(2026, 8, 1))).toBe('2026-09');
  });

  it('defaults an unknown frequency to monthly', () => {
    expect(projectBillingPeriodKey('quarterly', new Date(2026, 7, 15))).toBe('2026-08');
  });

  it('keys weekly by the Monday, so a week spanning two months stays one period', () => {
    const sun = projectBillingPeriodKey('weekly', new Date(2026, 7, 2)); // Sun 2 Aug
    const wed = projectBillingPeriodKey('weekly', new Date(2026, 6, 29)); // Wed 29 Jul
    expect(sun).toBe(wed);
    expect(sun).toBe('W2026-07-27');
  });

  it('gives consecutive weeks distinct keys', () => {
    const w1 = projectBillingPeriodKey('weekly', new Date(2026, 7, 3));
    const w2 = projectBillingPeriodKey('weekly', new Date(2026, 7, 10));
    expect(w1).not.toBe(w2);
  });
});

describe('projectBillingPeriodEnd', () => {
  it('returns the last day of the month for monthly', () => {
    const end = projectBillingPeriodEnd('monthly', new Date(2026, 7, 5));
    expect(end.getMonth()).toBe(7);
    expect(end.getDate()).toBe(31);
  });

  it('handles February in a leap year', () => {
    const end = projectBillingPeriodEnd('monthly', new Date(2028, 1, 3));
    expect(end.getDate()).toBe(29);
  });

  it('returns the Sunday for weekly', () => {
    const end = projectBillingPeriodEnd('weekly', new Date(2026, 7, 5)); // Wed 5 Aug
    expect(end.getFullYear()).toBe(2026);
    expect(end.getMonth()).toBe(7);
    expect(end.getDate()).toBe(9); // Sunday
  });
});

describe('periodAlreadyBilledLegacy', () => {
  it('treats the same calendar month as billed', () => {
    expect(periodAlreadyBilledLegacy('monthly', new Date(2026, 7, 2), new Date(2026, 7, 28))).toBe(true);
  });

  it('treats the next month as unbilled', () => {
    expect(periodAlreadyBilledLegacy('monthly', new Date(2026, 7, 28), new Date(2026, 8, 1))).toBe(false);
  });

  it('treats a 6-day-later date in the same week as billed', () => {
    expect(periodAlreadyBilledLegacy('weekly', new Date(2026, 7, 3), new Date(2026, 7, 9))).toBe(true);
  });
});

const base = {
  status: 'Active' as const,
  isRecurring: true,
  recurringFrequency: 'monthly',
  billingType: 'monthly' as const,
};
const now = new Date(2026, 7, 6); // Thu 6 Aug 2026

describe('projectBillingBlockReason', () => {
  it('returns null for a live monthly retainer never billed', () => {
    expect(projectBillingBlockReason(base, now)).toBeNull();
  });

  it('blocks a non-recurring project', () => {
    expect(projectBillingBlockReason({ ...base, isRecurring: false }, now)).toBe('not-recurring');
  });

  it('blocks an unsupported frequency instead of silently billing monthly', () => {
    expect(projectBillingBlockReason({ ...base, recurringFrequency: 'quarterly' }, now)).toBe('unsupported-frequency');
  });

  it('allows weekly', () => {
    expect(projectBillingBlockReason({ ...base, recurringFrequency: 'weekly' }, now)).toBeNull();
  });

  it.each(['Cancelled', 'Archived'] as const)('blocks a %s retainer', status => {
    expect(projectBillingBlockReason({ ...base, status }, now)).toBe('terminal-status');
  });

  it('keeps billing a Completed recurring project (a finished cycle, not a finished engagement)', () => {
    expect(projectBillingBlockReason({ ...base, status: 'Completed' }, now)).toBeNull();
  });

  it('blocks an explicitly paused retainer', () => {
    expect(projectBillingBlockReason({ ...base, isRecurringPaused: true }, now)).toBe('paused');
  });

  it('blocks a one-time deal even when isRecurring is set', () => {
    expect(projectBillingBlockReason({ ...base, billingType: 'one-time' }, now)).toBe('one-time');
  });

  it('blocks once the repeat-until date has passed', () => {
    expect(projectBillingBlockReason({ ...base, recurringEndDate: new Date(2026, 6, 31) }, now)).toBe('series-ended');
  });

  it('still bills before the repeat-until date', () => {
    expect(projectBillingBlockReason({ ...base, recurringEndDate: new Date(2026, 11, 31) }, now)).toBeNull();
  });

  it('reports an expired series ahead of a pause, so it gets cleaned up', () => {
    const r = projectBillingBlockReason({ ...base, isRecurringPaused: true, recurringEndDate: new Date(2026, 6, 31) }, now);
    expect(r).toBe('series-ended');
    expect(isPermanentBillingBlock(r)).toBe(true);
  });

  it('blocks when this period is already billed via the period key', () => {
    expect(projectBillingBlockReason({ ...base, lastInvoicePeriodKey: '2026-08' }, now)).toBe('already-billed');
  });

  it('bills again once the period key moves on', () => {
    expect(projectBillingBlockReason({ ...base, lastInvoicePeriodKey: '2026-07' }, now)).toBeNull();
  });

  it('falls back to lastInvoiceGeneratedAt for pre-key projects', () => {
    expect(projectBillingBlockReason({ ...base, lastInvoiceGeneratedAt: new Date(2026, 7, 1) }, now)).toBe('already-billed');
    expect(projectBillingBlockReason({ ...base, lastInvoiceGeneratedAt: new Date(2026, 6, 1) }, now)).toBeNull();
  });

  it('prefers the period key over the legacy timestamp when both exist', () => {
    // Key says July (unbilled for August) while the timestamp says August — the key wins.
    expect(projectBillingBlockReason(
      { ...base, lastInvoicePeriodKey: '2026-07', lastInvoiceGeneratedAt: new Date(2026, 7, 1) },
      now,
    )).toBeNull();
  });

  it('accepts a Firestore-style Timestamp for the dates', () => {
    const ts = { toDate: () => new Date(2026, 7, 1) };
    expect(projectBillingBlockReason({ ...base, lastInvoiceGeneratedAt: ts }, now)).toBe('already-billed');
  });

  it('ignores an unparseable repeat-until date instead of blocking', () => {
    expect(projectBillingBlockReason({ ...base, recurringEndDate: 'not-a-date' }, now)).toBeNull();
  });
});

describe('billingDayForMonth', () => {
  it('clamps to the last day of a short month', () => {
    expect(billingDayForMonth(25, new Date(2026, 7, 10))).toBe(25);   // August → 25
    expect(billingDayForMonth(31, new Date(2026, 1, 10))).toBe(28);   // Feb 2026 → 28
    expect(billingDayForMonth(31, new Date(2026, 3, 10))).toBe(30);   // April → 30
    expect(billingDayForMonth(0, new Date(2026, 7, 10))).toBe(1);     // floor at 1
  });
});

describe('billingDayOfMonth (bill on the 25th)', () => {
  const monthly = { isRecurring: true, recurringFrequency: 'monthly', billingType: 'monthly' as const, billingDayOfMonth: 25 };

  it('holds the invoice before the chosen day', () => {
    expect(projectBillingBlockReason(monthly, new Date(2026, 7, 1))).toBe('before-billing-day');
    expect(projectBillingBlockReason(monthly, new Date(2026, 7, 24))).toBe('before-billing-day');
  });

  it('bills on and after the chosen day', () => {
    expect(projectBillingBlockReason(monthly, new Date(2026, 7, 25))).toBeNull();
    expect(projectBillingBlockReason(monthly, new Date(2026, 7, 28))).toBeNull();
  });

  it('clamps in short months (31 → last day of February)', () => {
    const p = { ...monthly, billingDayOfMonth: 31 };
    expect(projectBillingBlockReason(p, new Date(2026, 1, 27))).toBe('before-billing-day');
    expect(projectBillingBlockReason(p, new Date(2026, 1, 28))).toBeNull(); // Feb 28 = last day
  });

  it('does not apply to weekly projects', () => {
    const weekly = { ...monthly, recurringFrequency: 'weekly' };
    expect(projectBillingBlockReason(weekly, new Date(2026, 7, 3))).toBeNull();
  });

  it('never overrides already-billed for the same period', () => {
    const p = { ...monthly, lastInvoicePeriodKey: '2026-08' };
    expect(projectBillingBlockReason(p, new Date(2026, 7, 26))).toBe('already-billed');
  });

  it('is a transient block (must not clear isRecurring)', () => {
    expect(isPermanentBillingBlock('before-billing-day')).toBe(false);
  });
});

describe('isPermanentBillingBlock', () => {
  it('marks terminal status and expired series as permanent', () => {
    expect(isPermanentBillingBlock('terminal-status')).toBe(true);
    expect(isPermanentBillingBlock('series-ended')).toBe(true);
  });

  it('marks transient blocks as non-permanent', () => {
    expect(isPermanentBillingBlock('paused')).toBe(false);
    expect(isPermanentBillingBlock('already-billed')).toBe(false);
    expect(isPermanentBillingBlock(null)).toBe(false);
  });
});


describe('projectPeriodsSkipped', () => {
  const at = (iso: string) => new Date(iso + 'T12:00:00');

  it('is 0 when the retainer billed the previous period', () => {
    expect(projectPeriodsSkipped('monthly', '2026-07', at('2026-08-03'))).toBe(0);
    expect(projectPeriodsSkipped('weekly', 'W2026-07-27', at('2026-08-05'))).toBe(0);
  });

  it('is 0 when this period is already billed', () => {
    expect(projectPeriodsSkipped('monthly', '2026-08', at('2026-08-03'))).toBe(0);
  });

  it('counts the whole months a retainer never billed', () => {
    // Last billed June, billing now in September → July and August were lost.
    expect(projectPeriodsSkipped('monthly', '2026-06', at('2026-09-01'))).toBe(2);
  });

  it('steps back from the 31st without skipping a short month', () => {
    expect(projectPeriodsSkipped('monthly', '2026-01', at('2026-03-31'))).toBe(1); // February
  });

  it('never guesses: no key, or a key older than the window, reports nothing', () => {
    expect(projectPeriodsSkipped('monthly', undefined, at('2026-09-01'))).toBe(0);
    expect(projectPeriodsSkipped('monthly', '2015-01', at('2026-09-01'))).toBe(0);
    expect(projectPeriodsSkipped('monthly', 'W2026-07-27', at('2026-09-01'))).toBe(0);
  });
});


describe('billing control patches (pause / stop, without archiving the client)', () => {
  it('pause halts invoicing without touching the series config', () => {
    const patch = pauseProjectBillingPatch();
    expect(patch).toEqual({ isRecurringPaused: true });
    expect(projectBillingBlockReason(
      { isRecurring: true, recurringFrequency: 'monthly', ...patch },
      new Date('2026-09-26T12:00:00'),
    )).toBe('paused');
  });

  it('resume lifts exactly the pause', () => {
    expect(resumeProjectBillingPatch()).toEqual({ isRecurringPaused: false });
  });

  it('stop ends the series, records who and keeps the frequency for a restart', () => {
    const at = new Date('2026-09-01T10:00:00');
    const patch = stopProjectBillingPatch(at);
    expect(patch.isRecurring).toBe(false);
    expect(patch.isRecurringPaused).toBe(false); // no leftover pause under a stopped series
    expect(patch.recurringBillingStoppedReason).toBe('manual');
    expect(patch.recurringBillingStoppedAt).toBe(at);
    expect('recurringFrequency' in patch).toBe(false); // kept, so re-enabling remembers the cycle
    expect(projectBillingBlockReason(
      { recurringFrequency: 'monthly', ...patch },
      new Date('2026-09-26T12:00:00'),
    )).toBe('not-recurring');
  });
});
