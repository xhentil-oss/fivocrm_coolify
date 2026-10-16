import { describe, it, expect } from 'vitest';
// The engine answers in Europe/Tirane, so the assertions must read the same
// calendar. `Date#getDate()` reads the MACHINE's zone, which is exactly the
// dependency these tests exist to prove is gone (CI runs UTC, laptops UTC+2).
import { zonedParts } from '../recurringUtils';
import {
  expensePeriodKey,
  addMonthsClamped,
  nextExpenseOccurrence,
  firstGenerationDate,
  expenseGenerationBlockReason,
  isPermanentExpenseBlock,
  seedNextRecurringDate,
  healMissingNextDate,
  reenableRecurrencePlan,
  previousExpensePeriodKey,
  duplicateExpenseKey,
  findDuplicateExpenseGroups,
  totalDuplicateWaste,
  expenseRowKind,
  SUPPORTED_EXPENSE_FREQUENCIES,
  monthlyRecurringExpenseRate,
  isActiveRecurringParent,
  belongsToRecurringSeries,
} from './recurringExpenses';

const d = (s: string) => new Date(s + 'T10:00:00');

describe('expensePeriodKey', () => {
  it('keys monthly by calendar month', () => {
    expect(expensePeriodKey('monthly', d('2026-08-01'))).toBe('2026-08');
    expect(expensePeriodKey('monthly', d('2026-08-31'))).toBe('2026-08');
  });

  it('keys weekly on the Monday anchor, across a month boundary', () => {
    // Sun 2 Aug 2026 and Mon 27 Jul 2026 are the same week.
    expect(expensePeriodKey('weekly', d('2026-08-02'))).toBe(expensePeriodKey('weekly', d('2026-07-27')));
    expect(expensePeriodKey('weekly', d('2026-08-03'))).not.toBe(expensePeriodKey('weekly', d('2026-08-02')));
  });

  it('keys yearly by year', () => {
    expect(expensePeriodKey('yearly', d('2026-01-01'))).toBe('Y2026');
    expect(expensePeriodKey('yearly', d('2026-12-31'))).toBe('Y2026');
  });
});

describe('addMonthsClamped', () => {
  it('does not overflow a month-end date into the month after next', () => {
    // The bug: new Date(2026,0,31).setMonth(1) → 3 Mar, so February is skipped.
    expect(addMonthsClamped(d('2026-01-31'), 1).getMonth()).toBe(1);   // February
    expect(addMonthsClamped(d('2026-01-31'), 1).getDate()).toBe(28);
  });

  it('keeps the anchor day instead of degrading after a short month', () => {
    const feb = addMonthsClamped(d('2026-01-31'), 1);                   // 28 Feb
    const mar = addMonthsClamped(feb, 1, 31);                           // 31 Mar, not 28 Mar
    expect(mar.getMonth()).toBe(2);
    expect(mar.getDate()).toBe(31);
  });
});

describe('nextExpenseOccurrence', () => {
  it('advances a week, a clamped month and a year', () => {
    expect(nextExpenseOccurrence(d('2026-08-01'), 'weekly').getDate()).toBe(8);
    expect(nextExpenseOccurrence(d('2026-08-31'), 'monthly').getMonth()).toBe(8); // September
    expect(nextExpenseOccurrence(d('2026-08-31'), 'monthly').getDate()).toBe(30);
    expect(nextExpenseOccurrence(d('2026-08-01'), 'yearly').getFullYear()).toBe(2027);
  });

  it('never skips a month over a full year of month-end cycles', () => {
    let cur = d('2026-01-31');
    const months: number[] = [];
    for (let i = 0; i < 12; i++) {
      cur = nextExpenseOccurrence(cur, 'monthly', 31);
      months.push(cur.getMonth());
    }
    expect(months).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 0]);
  });
});

describe('firstGenerationDate', () => {
  it('starts next period when no date was picked', () => {
    const first = firstGenerationDate(d('2026-08-07'), 'monthly', null);
    expect(expensePeriodKey('monthly', first)).toBe('2026-09');
  });

  it('pushes a picked date out of the period the parent row already covers', () => {
    // Live case: parent created 17 Jul, user picked 30 Jul → both land in July.
    const first = firstGenerationDate(d('2026-07-17'), 'monthly', d('2026-07-30'));
    expect(expensePeriodKey('monthly', first)).toBe('2026-08');
    expect(zonedParts(first).day).toBe(30);  // the chosen day survives
  });

  it('leaves a date that is already in a later period alone', () => {
    const picked = d('2026-09-01');
    expect(firstGenerationDate(d('2026-08-07'), 'monthly', picked).getTime()).toBe(picked.getTime());
  });
});

describe('seedNextRecurringDate', () => {
  it('lands a dead series on the CURRENT period, without backfilling the months it missed', () => {
    // Live case: a salary series created in March that never generated anything.
    // The old heal seeded September and claimed August — August was never
    // booked and never reported anywhere.
    const seeded = seedNextRecurringDate(d('2026-03-05'), d('2026-08-07'), 'monthly');
    expect(expensePeriodKey('monthly', seeded)).toBe('2026-08');
    expect(zonedParts(seeded).day).toBe(5);   // the original day-of-month is kept
  });

  it('respects a start date that is still in the future', () => {
    const seeded = seedNextRecurringDate(d('2026-12-01'), d('2026-08-07'), 'monthly');
    expect(expensePeriodKey('monthly', seeded)).toBe('2027-01');
  });
});

describe('expenseGenerationBlockReason', () => {
  const now = d('2026-08-07');
  const base = { isRecurring: true, recurringFrequency: 'monthly', nextRecurringDate: d('2026-08-01') };

  it('allows a due series', () => {
    expect(expenseGenerationBlockReason(base, now)).toBeNull();
    expect(expenseGenerationBlockReason({ ...base, status: 'Active' }, now)).toBeNull();
  });

  it('blocks a series switched off with status Inactive', () => {
    expect(expenseGenerationBlockReason({ ...base, status: 'Inactive' }, now)).toBe('inactive');
  });

  it('blocks non-recurring, children and paused series', () => {
    expect(expenseGenerationBlockReason({ ...base, isRecurring: false }, now)).toBe('not-recurring');
    expect(expenseGenerationBlockReason({ ...base, autoGenerated: true }, now)).toBe('auto-generated');
    expect(expenseGenerationBlockReason({ ...base, isRecurringPaused: true }, now)).toBe('paused');
  });

  it('blocks a missing or future due date', () => {
    expect(expenseGenerationBlockReason({ ...base, nextRecurringDate: null }, now)).toBe('no-next-date');
    expect(expenseGenerationBlockReason({ ...base, nextRecurringDate: d('2026-09-01') }, now)).toBe('not-due');
  });

  it('ends the series past its end date, permanently', () => {
    const reason = expenseGenerationBlockReason({ ...base, recurringEndDate: d('2026-07-01') }, now);
    expect(reason).toBe('series-ended');
    expect(isPermanentExpenseBlock(reason)).toBe(true);
  });

  it('blocks a period that was already generated', () => {
    expect(expenseGenerationBlockReason({ ...base, lastGeneratedPeriodKey: '2026-08' }, now)).toBe('already-generated');
    // A key from an earlier period must NOT block the current one.
    expect(expenseGenerationBlockReason({ ...base, lastGeneratedPeriodKey: '2026-07' }, now)).toBeNull();
  });

  it('a series that lags whole periods is stale — reported and advanced, never backfilled', () => {
    // The old timestamp guard killed a lagging series for good; the fix after it
    // generated one row per MISSED period — rewriting closed books, which is the
    // owner's call. A due date whose period is behind today's is `stale-period`:
    // not permanent, the cron skips it, reports it and moves the series forward.
    const lagging = { ...base, nextRecurringDate: d('2026-02-01'), lastGeneratedPeriodKey: '2026-01' };
    const reason = expenseGenerationBlockReason(lagging, now);
    expect(reason).toBe('stale-period');
    expect(isPermanentExpenseBlock(reason)).toBe(false);
  });

  it('stale-period is judged on the PERIOD key, per frequency, after the due-date checks', () => {
    // Same month, earlier day → due, not stale (now = 7 Aug).
    expect(expenseGenerationBlockReason({ ...base, nextRecurringDate: d('2026-08-01') }, now)).toBeNull();
    // Previous month → stale.
    expect(expenseGenerationBlockReason({ ...base, nextRecurringDate: d('2026-07-31') }, now)).toBe('stale-period');
    // Weekly: Mon 3 Aug is this week (now = Fri 7 Aug) → due; Mon 27 Jul → stale.
    expect(expenseGenerationBlockReason({ ...base, recurringFrequency: 'weekly', nextRecurringDate: d('2026-08-03') }, now)).toBeNull();
    expect(expenseGenerationBlockReason({ ...base, recurringFrequency: 'weekly', nextRecurringDate: d('2026-07-27') }, now)).toBe('stale-period');
    // Quarterly / yearly keys sort the same way.
    expect(expenseGenerationBlockReason({ ...base, recurringFrequency: 'quarterly', nextRecurringDate: d('2026-04-01') }, now)).toBe('stale-period');
    expect(expenseGenerationBlockReason({ ...base, recurringFrequency: 'yearly', nextRecurringDate: d('2025-08-01') }, now)).toBe('stale-period');
    // A future date is still `not-due`, and a missing one `no-next-date`, before staleness is asked.
    expect(expenseGenerationBlockReason({ ...base, nextRecurringDate: d('2026-09-01') }, now)).toBe('not-due');
    // A stale period that WAS generated keeps its claim: the idempotency answer wins.
    expect(expenseGenerationBlockReason({ ...base, nextRecurringDate: d('2026-07-01'), lastGeneratedPeriodKey: '2026-07' }, now)).toBe('already-generated');
  });
});

describe('a yearly series keeps its anchor day across leap years', () => {
  it('29 Feb + 1 year is 28 Feb, and 29 Feb again when the anchor allows', () => {
    // `addZonedYears` overflowed 29 Feb 2028 into 1 Mar 2029, so the series
    // silently moved to March for good.
    const leap = new Date(2028, 1, 29, 10, 0, 0);
    const next = nextExpenseOccurrence(leap, 'yearly', 29);
    expect(zonedParts(next)).toMatchObject({ year: 2029, month: 1, day: 28 });
    const again = nextExpenseOccurrence(nextExpenseOccurrence(nextExpenseOccurrence(next, 'yearly', 29), 'yearly', 29), 'yearly', 29);
    expect(zonedParts(again)).toMatchObject({ year: 2032, month: 1, day: 29 });
    // Without an explicit anchor the date's own day is the anchor.
    expect(zonedParts(nextExpenseOccurrence(leap, 'yearly'))).toMatchObject({ year: 2029, month: 1, day: 28 });
  });
});

describe('findDuplicateExpenseGroups', () => {
  const rows = [
    { id: 'a', title: 'Qera', amount: 35000, currency: 'ALL', date: d('2026-06-26') },
    { id: 'b', title: ' qera ', amount: 35000, currency: 'ALL', date: d('2026-06-27') },
    { id: 'c', title: 'Qera', amount: 35000, currency: 'ALL', date: d('2026-06-28') },
    { id: 'd', title: 'Qera', amount: 35000, currency: 'ALL', date: d('2026-07-01') },  // other month
    { id: 'e', title: 'Internet', amount: 1900, currency: 'ALL', date: d('2026-06-26') },
  ];

  it('groups same title+amount+currency inside one month, ignoring case and spacing', () => {
    const groups = findDuplicateExpenseGroups(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0].expenses.map(e => e.id).sort()).toEqual(['a', 'b', 'c']);
    expect(groups[0].periodKey).toBe('2026-06');
  });

  it('counts the over-count as (n − 1) × amount', () => {
    const groups = findDuplicateExpenseGroups(rows);
    expect(groups[0].wasteAll).toBe(70000);
    expect(totalDuplicateWaste(groups)).toBe(70000);
  });

  it('ignores rejected rows — they never hit a total', () => {
    const withRejected = [...rows, { id: 'f', title: 'Internet', amount: 1900, currency: 'ALL', date: d('2026-06-27'), approvalStatus: 'Rejected' }];
    expect(findDuplicateExpenseGroups(withRejected).some(g => g.title === 'Internet')).toBe(false);
  });

  it('falls back to createdAt when no explicit date is set', () => {
    const groups = findDuplicateExpenseGroups([
      { id: 'x', title: 'Hosting', amount: 6200, currency: 'ALL', createdAt: d('2026-06-26') },
      { id: 'y', title: 'Hosting', amount: 6200, currency: 'ALL', createdAt: d('2026-06-30') },
    ]);
    expect(groups).toHaveLength(1);
  });

  it('does not group different amounts or currencies', () => {
    const groups = findDuplicateExpenseGroups([
      { id: 'x', title: 'Hosting', amount: 6200, currency: 'ALL', date: d('2026-06-26') },
      { id: 'y', title: 'Hosting', amount: 6300, currency: 'ALL', date: d('2026-06-27') },
      { id: 'z', title: 'Hosting', amount: 6200, currency: 'EUR', date: d('2026-06-27') },
    ]);
    expect(groups).toHaveLength(0);
  });
});

describe('healMissingNextDate', () => {
  it('a due current period is generated by the engine right after the heal', () => {
    const now = d('2026-08-07');
    const heal = healMissingNextDate(d('2026-03-05'), now, 'monthly');
    expect(heal.claim).toBe('2026-03');   // never claims a period nobody booked
    const after = { isRecurring: true, recurringFrequency: 'monthly', nextRecurringDate: heal.next, lastGeneratedPeriodKey: heal.claim };
    expect(expenseGenerationBlockReason(after, now)).toBeNull();
  });

  it('a current period whose day is still ahead waits for its day', () => {
    const now = d('2026-08-03');
    const heal = healMissingNextDate(d('2026-03-05'), now, 'monthly');
    expect(expensePeriodKey('monthly', heal.next)).toBe('2026-08');
    const after = { isRecurring: true, recurringFrequency: 'monthly', nextRecurringDate: heal.next, lastGeneratedPeriodKey: heal.claim };
    expect(expenseGenerationBlockReason(after, now)).toBe('not-due');
  });

  it('a parent booked in the current period covers it — the series starts next period', () => {
    const heal = healMissingNextDate(d('2026-08-02'), d('2026-08-07'), 'monthly');
    expect(expensePeriodKey('monthly', heal.next)).toBe('2026-09');
    expect(heal.claim).toBe('2026-08');
  });

  it('a stored claim already on the current period is kept (moves forward only)', () => {
    const heal = healMissingNextDate(d('2026-03-05'), d('2026-08-07'), 'monthly', 5, '2026-08');
    expect(heal.claim).toBe('2026-08');
    expect(expensePeriodKey('monthly', heal.next)).toBe('2026-09');
  });
});

describe('a REJECTED parent', () => {
  it('stops generating (and is not permanent — re-approval resumes it)', () => {
    const now = d('2026-08-07');
    const base = { isRecurring: true, recurringFrequency: 'monthly', nextRecurringDate: d('2026-08-01') };
    const reason = expenseGenerationBlockReason({ ...base, approvalStatus: 'Rejected' }, now);
    expect(reason).toBe('rejected');
    expect(isPermanentExpenseBlock(reason)).toBe(false);
    expect(expenseGenerationBlockReason({ ...base, approvalStatus: 'Approved' }, now)).toBeNull();
    expect(expenseGenerationBlockReason({ ...base, approvalStatus: 'Submitted' }, now)).toBeNull();
  });
});

describe('previousExpensePeriodKey', () => {
  it('steps back one cycle in each frequency', () => {
    expect(previousExpensePeriodKey('monthly', d('2026-01-15'))).toBe('2025-12');
    expect(previousExpensePeriodKey('quarterly', d('2026-02-15'))).toBe('Q2025-4');
    expect(previousExpensePeriodKey('yearly', d('2026-02-15'))).toBe('Y2025');
    expect(previousExpensePeriodKey('weekly', d('2026-08-07'))).toBe(expensePeriodKey('weekly', d('2026-07-31')));
  });
});

describe('reenableRecurrencePlan', () => {
  const now = d('2026-10-16');

  it('a series stopped in February resumes in the current period, nothing reported as missed', () => {
    const plan = reenableRecurrencePlan({
      frequency: 'monthly', ownDate: d('2026-01-10'), occurrenceDates: [d('2026-02-10')],
      occurrenceKeys: ['2026-02'], anchorDay: 10, now,
    });
    expect(plan.claim).toBe('2026-09');                       // the PREVIOUS period
    expect(expensePeriodKey('monthly', plan.nextDate)).toBe('2026-10');
    expect(zonedParts(plan.nextDate).day).toBe(10);
    // The engine books October once and reports nothing as stale.
    const after = { isRecurring: true, recurringFrequency: 'monthly', nextRecurringDate: plan.nextDate, lastGeneratedPeriodKey: plan.claim };
    expect(expenseGenerationBlockReason(after, now)).toBeNull();
  });

  it('a current period that is already covered is not booked twice', () => {
    const plan = reenableRecurrencePlan({
      frequency: 'monthly', ownDate: d('2026-01-10'), occurrenceDates: [d('2026-10-02')], anchorDay: 10, now,
    });
    expect(plan.claim).toBe('2026-10');
    expect(expensePeriodKey('monthly', plan.nextDate)).toBe('2026-11');
  });

  it('a fresh row booked this period behaves like creation: next period', () => {
    const plan = reenableRecurrencePlan({ frequency: 'monthly', ownDate: d('2026-10-05'), now });
    expect(plan.claim).toBe('2026-10');
    expect(expensePeriodKey('monthly', plan.nextDate)).toBe('2026-11');
    expect(zonedParts(plan.nextDate).day).toBe(5);
  });

  it('a picked day survives and is the new anchor', () => {
    const plan = reenableRecurrencePlan({ frequency: 'monthly', ownDate: d('2026-01-10'), picked: d('2026-03-25'), now });
    expect(plan.anchorDay).toBe(25);
    expect(expensePeriodKey('monthly', plan.nextDate)).toBe('2026-10');
    expect(zonedParts(plan.nextDate).day).toBe(25);
  });

  it('ignores a stored claim of another frequency', () => {
    const plan = reenableRecurrencePlan({ frequency: 'monthly', ownDate: d('2026-01-10'), storedClaim: 'W2026-10-12', now });
    expect(plan.claim).toBe('2026-09');
  });
});

describe('duplicate identity includes who/where the cost is for', () => {
  const base = { title: 'Paga', amount: 60000, currency: 'ALL' as const, date: d('2026-06-10'), category: 'Salary' };

  it('two people on the same salary are NOT a duplicate', () => {
    const groups = findDuplicateExpenseGroups([
      { id: 'ana', ...base, memberId: 'u-ana' },
      { id: 'besa', ...base, memberId: 'u-besa' },
    ]);
    expect(groups).toHaveLength(0);
  });

  it('one cost on two projects, or in two categories, is NOT a duplicate', () => {
    expect(findDuplicateExpenseGroups([
      { id: 'a', ...base, category: 'Hosting', projectId: 'p1' },
      { id: 'b', ...base, category: 'Hosting', projectId: 'p2' },
    ])).toHaveLength(0);
    expect(findDuplicateExpenseGroups([
      { id: 'a', ...base, category: 'Hosting' },
      { id: 'b', ...base, category: 'Office' },
    ])).toHaveLength(0);
  });

  it('the same person twice in one month IS a duplicate, with the right period and amount', () => {
    const groups = findDuplicateExpenseGroups([
      { id: 'a', ...base, memberId: 'u-ana' },
      { id: 'b', ...base, memberId: 'u-ana', date: d('2026-06-28') },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].periodKey).toBe('2026-06');
    expect(groups[0].amountAll).toBe(60000);
    expect(groups[0].currency).toBe('ALL');
  });

  it('a title containing the separator does not corrupt the group fields', () => {
    const groups = findDuplicateExpenseGroups([
      { id: 'a', ...base, title: 'Paga | Ana' },
      { id: 'b', ...base, title: 'paga | ana' },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].periodKey).toBe('2026-06');
    expect(groups[0].wasteAll).toBe(60000);
  });

  it('duplicateExpenseKey refuses rows that can never be duplicates', () => {
    expect(duplicateExpenseKey({ id: 'x', ...base, approvalStatus: 'Rejected' })).toBeNull();
    expect(duplicateExpenseKey({ id: 'x', ...base, amount: 0 })).toBeNull();
    expect(duplicateExpenseKey({ id: 'x', ...base, title: '  ' })).toBeNull();
  });
});

describe('expenseRowKind', () => {
  it('separates a generated child from the series original', () => {
    expect(expenseRowKind({ autoGenerated: true })).toBe('auto');
    expect(expenseRowKind({ isRecurring: true })).toBe('parent');
    expect(expenseRowKind({})).toBe('manual');
  });
});

// ── Regressions found by the Aug 2026 expenses audit ────────────────────────

describe('firstGenerationDate never back-fills a closed period', () => {
  const createdAt = new Date(2026, 7, 22); // 22 Aug 2026

  it('pulls a PAST picked date forward, keeping the chosen day-of-month', () => {
    // The old `!==` check accepted any date in a "different" period — including
    // one 7 months in the past — and the cron then generated one row per missed
    // month, rewriting closed books. Reported live as a mistyped year.
    const picked = new Date(2026, 0, 5); // 5 Jan 2026
    const first = firstGenerationDate(createdAt, 'monthly', picked);
    expect(expensePeriodKey('monthly', first)).toBe('2026-09');
    expect(zonedParts(first).day).toBe(5); // the day the user chose survives
  });

  it('still pushes a same-period date one cycle forward', () => {
    const first = firstGenerationDate(createdAt, 'monthly', new Date(2026, 7, 30));
    expect(expensePeriodKey('monthly', first)).toBe('2026-09');
    expect(zonedParts(first).day).toBe(30);
  });

  it('leaves a genuinely future date alone', () => {
    const picked = new Date(2026, 10, 1);
    expect(firstGenerationDate(createdAt, 'monthly', picked).getTime()).toBe(picked.getTime());
  });

  it('keeps the chosen MONTH for a yearly series pulled forward', () => {
    const first = firstGenerationDate(createdAt, 'yearly', new Date(2020, 2, 15));
    expect(expensePeriodKey('yearly', first)).toBe('Y2027');
    expect(first.getMonth()).toBe(2);
    expect(first.getDate()).toBe(15);
  });
});

describe('quarterly is a first-class frequency', () => {
  it('is generated, not refused', () => {
    // It used to live only in cashflowAlarms' FREQ_TO_MONTHLY: costed by the
    // alarm, refused by the engine, invisible in the UI.
    expect(SUPPORTED_EXPENSE_FREQUENCIES).toContain('quarterly');
    expect(expenseGenerationBlockReason(
      { isRecurring: true, recurringFrequency: 'quarterly', nextRecurringDate: new Date(2026, 6, 1) },
      new Date(2026, 7, 22),
    )).toBeNull();
  });

  it('keys by quarter and advances three clamped months', () => {
    expect(expensePeriodKey('quarterly', new Date(2026, 0, 15))).toBe('Q2026-1');
    expect(expensePeriodKey('quarterly', new Date(2026, 8, 30))).toBe('Q2026-3');
    // 30 Nov + 3 months must be 28 Feb, never 2 Mar.
    const next = nextExpenseOccurrence(new Date(2026, 10, 30), 'quarterly', 30);
    expect(next.getMonth()).toBe(1);
    expect(next.getDate()).toBe(28);
  });
});

describe('monthlyRecurringExpenseRate', () => {
  const parent = (o: any) => ({
    isRecurring: true, amount: o.amount, currency: 'ALL',
    recurringFrequency: o.freq, category: o.category ?? 'Rent',
    isRecurringPaused: o.paused, autoGenerated: o.auto, approvalStatus: o.approval,
  });

  it('normalises each supported cycle to a monthly rate', () => {
    expect(monthlyRecurringExpenseRate([parent({ amount: 1200, freq: 'yearly' })])).toBe(100);
    expect(monthlyRecurringExpenseRate([parent({ amount: 300, freq: 'quarterly' })])).toBe(100);
    expect(monthlyRecurringExpenseRate([parent({ amount: 100, freq: 'monthly' })])).toBe(100);
  });

  it('an UNKNOWN frequency contributes nothing, never a default month', () => {
    // Defaulting to 1× invented a fixed cost the engine will never generate,
    // which is enough to raise the red "costs exceed income" alarm.
    expect(monthlyRecurringExpenseRate([parent({ amount: 5000, freq: 'fortnightly' })])).toBe(0);
  });

  it('skips paused parents, generated children, rejected rows and payroll', () => {
    expect(monthlyRecurringExpenseRate([parent({ amount: 100, freq: 'monthly', paused: true })])).toBe(0);
    expect(monthlyRecurringExpenseRate([parent({ amount: 100, freq: 'monthly', auto: true })])).toBe(0);
    expect(monthlyRecurringExpenseRate([parent({ amount: 100, freq: 'monthly', approval: 'Rejected' })])).toBe(0);
    expect(monthlyRecurringExpenseRate([parent({ amount: 100, freq: 'monthly', category: 'Salary' })])).toBe(0);
  });

  it('skips a series switched off with status Inactive', () => {
    // The switch used to change nothing: an "off" series still fed the gap alarm
    // and the profit forecast with money nobody intended to spend.
    expect(monthlyRecurringExpenseRate([
      { ...parent({ amount: 100, freq: 'monthly' }), status: 'Inactive' },
    ])).toBe(0);
    expect(monthlyRecurringExpenseRate([
      { ...parent({ amount: 100, freq: 'monthly' }), status: 'Active' },
    ])).toBe(100);
  });
});

describe('belongsToRecurringSeries', () => {
  it('recognises the parent, the generated child and a linked child', () => {
    expect(belongsToRecurringSeries({ isRecurring: true })).toBe(true);
    expect(belongsToRecurringSeries({ autoGenerated: true })).toBe(true);
    expect(belongsToRecurringSeries({ parentExpenseId: 'p1' })).toBe(true);
    expect(belongsToRecurringSeries({})).toBe(false);
  });
});

// ── The period key must not depend on where the code runs ───────────────────
//
// The UI computes the key in Europe/Tirane and claims it; the cron body runs on
// Vercel in UTC and compares against that claim. While both used the MACHINE's
// getters, a bill dated the 1st keyed as '2026-08' in the browser and '2026-07'
// on the server: the series either blocked forever (`already-generated` against
// a key the client never wrote) or booked the same month twice.
describe('period keys are answered in the business zone, not the machine zone', () => {
  // 2026-07-31T22:00Z IS 1 August 00:00 in Europe/Tirane.
  const localMidnightFirstOfAugust = new Date('2026-07-31T22:00:00.000Z');

  it('keys a local-midnight 1 August as August whatever the host zone is', () => {
    expect(expensePeriodKey('monthly', localMidnightFirstOfAugust)).toBe('2026-08');
    expect(expensePeriodKey('quarterly', localMidnightFirstOfAugust)).toBe('Q2026-3');
  });

  it('keys a local-midnight 1 January as the new year', () => {
    // 2026-12-31T23:00Z = 1 Jan 2027 00:00 in Tirane (winter, UTC+1).
    const localMidnightNewYear = new Date('2026-12-31T23:00:00.000Z');
    expect(expensePeriodKey('yearly', localMidnightNewYear)).toBe('Y2027');
    expect(expensePeriodKey('monthly', localMidnightNewYear)).toBe('2027-01');
  });

  it('anchors a weekly series on the Monday of the business week', () => {
    // 2026-08-02T22:00Z = Monday 3 Aug 00:00 in Tirane.
    const localMidnightMonday = new Date('2026-08-02T22:00:00.000Z');
    expect(expensePeriodKey('weekly', localMidnightMonday)).toBe('W2026-08-03');
  });

  it('keeps a month-end series on its anchor day across a short month', () => {
    const jan31 = new Date('2026-01-30T23:00:00.000Z'); // 31 Jan 00:00 Tirane
    const feb = addMonthsClamped(jan31, 1, 31);
    expect(zonedParts(feb).day).toBe(28);
    const mar = addMonthsClamped(feb, 1, 31);
    expect(zonedParts(mar).day).toBe(31); // back to the anchor, never degraded
  });
});

// ── A series past its "repeat until" date commits nothing ────────────────────
describe('isActiveRecurringParent respects the end date', () => {
  const base = { isRecurring: true, recurringFrequency: 'monthly' as const, amount: 1000, currency: 'ALL' };

  it('stops counting a series whose repeat-until date has passed', () => {
    const ended = {
      ...base,
      recurringEndDate: new Date('2026-06-30T12:00:00.000Z'),
      nextRecurringDate: new Date('2026-07-01T12:00:00.000Z'),
    };
    expect(isActiveRecurringParent(ended, new Date('2026-09-18T12:00:00.000Z'))).toBe(false);
    expect(monthlyRecurringExpenseRate([ended], new Date('2026-09-18T12:00:00.000Z'))).toBe(0);
  });

  it('still counts a series whose end date is ahead', () => {
    const live = {
      ...base,
      recurringEndDate: new Date('2027-06-30T12:00:00.000Z'),
      nextRecurringDate: new Date('2026-10-01T12:00:00.000Z'),
    };
    expect(isActiveRecurringParent(live, new Date('2026-09-18T12:00:00.000Z'))).toBe(true);
    expect(monthlyRecurringExpenseRate([live], new Date('2026-09-18T12:00:00.000Z'))).toBe(1000);
  });

  it('stops a series with a passed end date and NO next date (it never self-clears)', () => {
    const stale = { ...base, recurringEndDate: new Date('2026-06-30T12:00:00.000Z') };
    expect(isActiveRecurringParent(stale, new Date('2026-09-18T12:00:00.000Z'))).toBe(false);
  });
});
