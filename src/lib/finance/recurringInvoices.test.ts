import { describe, it, expect } from 'vitest';
import {
  invoiceBillingPeriodKey,
  nextInvoiceOccurrence,
  billingDateFor,
  periodsSkipped,
  projectAlsoBills,
  invoiceBillingBlockReason,
  periodAlreadyCovered,
  resolveInvoiceAnchorDay,
  recurringOccurrenceId,
  PERMANENT_INVOICE_BLOCKS,
  resolveRecurringSchedule,
  previousInvoicePeriodStart,
  nextOccurrenceInOrAfterPeriod,
  resumedInvoiceClaimPatch,
} from './recurringInvoices';
import { zonedParts } from '../recurringUtils';

const d = (s: string) => new Date(s + 'T12:00:00');

describe('invoiceBillingPeriodKey', () => {
  it('keys monthly by calendar month', () => {
    expect(invoiceBillingPeriodKey('monthly', d('2026-08-01'))).toBe('2026-08');
    expect(invoiceBillingPeriodKey('monthly', d('2026-08-31'))).toBe('2026-08');
    expect(invoiceBillingPeriodKey('monthly', d('2026-09-01'))).toBe('2026-09');
  });

  it('keys weekly by the Monday of that week', () => {
    // 2026-08-17 is a Monday; the whole week shares its key.
    expect(invoiceBillingPeriodKey('weekly', d('2026-08-17'))).toBe('W2026-08-17');
    expect(invoiceBillingPeriodKey('weekly', d('2026-08-23'))).toBe('W2026-08-17'); // Sunday
    expect(invoiceBillingPeriodKey('weekly', d('2026-08-24'))).toBe('W2026-08-24');
  });

  it('keys quarterly and yearly', () => {
    expect(invoiceBillingPeriodKey('quarterly', d('2026-01-15'))).toBe('Q2026-1');
    expect(invoiceBillingPeriodKey('quarterly', d('2026-08-22'))).toBe('Q2026-3');
    expect(invoiceBillingPeriodKey('quarterly', d('2026-12-31'))).toBe('Q2026-4');
    expect(invoiceBillingPeriodKey('yearly', d('2026-03-01'))).toBe('Y2026');
  });

  it('pads single-digit months and days', () => {
    expect(invoiceBillingPeriodKey('monthly', d('2026-01-05'))).toBe('2026-01');
    expect(invoiceBillingPeriodKey('weekly', d('2026-01-05'))).toBe('W2026-01-05');
  });
});

describe('nextInvoiceOccurrence', () => {
  it('never overflows a month-end into the month after next', () => {
    // The whole point: setMonth(+1) on Jan 31 gives March 3.
    expect(nextInvoiceOccurrence(d('2026-01-31'), 'monthly').toISOString().slice(0, 10))
      .toBe('2026-02-28');
    expect(nextInvoiceOccurrence(d('2026-03-31'), 'monthly').toISOString().slice(0, 10))
      .toBe('2026-04-30');
  });

  it('restores the anchor day after a clamped month', () => {
    // Jan 31 → Feb 28 → (anchored on 31) March 31, not March 28.
    const feb = nextInvoiceOccurrence(d('2026-01-31'), 'monthly');
    expect(nextInvoiceOccurrence(feb, 'monthly', 31).toISOString().slice(0, 10))
      .toBe('2026-03-31');
  });

  it('adds 7 days for weekly', () => {
    expect(nextInvoiceOccurrence(d('2026-08-17'), 'weekly').toISOString().slice(0, 10))
      .toBe('2026-08-24');
  });

  it('adds 3 months for quarterly, clamped', () => {
    expect(nextInvoiceOccurrence(d('2026-11-30'), 'quarterly').toISOString().slice(0, 10))
      .toBe('2027-02-28');
  });

  it('handles Feb 29 on a yearly cycle', () => {
    expect(nextInvoiceOccurrence(d('2028-02-29'), 'yearly').toISOString().slice(0, 10))
      .toBe('2029-02-28');
  });
});

describe('billingDateFor', () => {
  it('keeps the scheduled date when the cron merely ran late inside the period', () => {
    const scheduled = d('2026-08-01');
    expect(billingDateFor(scheduled, 'monthly', d('2026-08-04'))).toBe(scheduled);
  });

  it('bills the CURRENT period when the series lagged whole periods', () => {
    const now = d('2026-08-22');
    // A January schedule must not produce a back-dated January invoice in August.
    expect(billingDateFor(d('2026-01-31'), 'monthly', now)).toBe(now);
  });
});

describe('periodsSkipped', () => {
  it('is 0 for a series on schedule', () => {
    expect(periodsSkipped(d('2026-08-01'), 'monthly', d('2026-08-04'))).toBe(0);
    expect(periodsSkipped(d('2026-09-01'), 'monthly', d('2026-08-04'))).toBe(0);
  });

  it('counts whole periods missed between the schedule and now', () => {
    // Feb..Jul are missed; August is the one being billed.
    expect(periodsSkipped(d('2026-01-15'), 'monthly', d('2026-08-15'))).toBe(6);
  });

  it('terminates on absurdly stale data instead of hanging', () => {
    expect(periodsSkipped(d('1990-01-01'), 'weekly', d('2026-08-22'))).toBeLessThanOrEqual(600);
  });
});

describe('projectAlsoBills', () => {
  it('is false without a project', () => {
    expect(projectAlsoBills(null)).toBe(false);
    expect(projectAlsoBills(undefined)).toBe(false);
    expect(projectAlsoBills({})).toBe(false);
  });

  it('is true for a live recurring retainer', () => {
    expect(projectAlsoBills({ isRecurring: true, status: 'Active' })).toBe(true);
  });

  it('is false when the project engine is not actually billing', () => {
    expect(projectAlsoBills({ isRecurring: true, isRecurringPaused: true })).toBe(false);
    expect(projectAlsoBills({ isRecurring: true, status: 'Cancelled' })).toBe(false);
    expect(projectAlsoBills({ isRecurring: true, status: 'Archived' })).toBe(false);
    expect(projectAlsoBills({ isRecurring: true, billingType: 'one-time' })).toBe(false);
  });
});

describe('invoiceBillingBlockReason', () => {
  const now = d('2026-08-22');
  const due = {
    isRecurring: true,
    recurringFrequency: 'monthly',
    nextRecurringDate: d('2026-08-01'),
  };

  it('returns null when the series is due', () => {
    expect(invoiceBillingBlockReason(due, now)).toBeNull();
  });

  it('names each blocking condition', () => {
    expect(invoiceBillingBlockReason({ ...due, isRecurring: false }, now)).toBe('not-recurring');
    expect(invoiceBillingBlockReason({ ...due, autoGenerated: true }, now)).toBe('auto-generated');
    expect(invoiceBillingBlockReason({ ...due, isRecurringPaused: true }, now)).toBe('paused');
    expect(invoiceBillingBlockReason({ ...due, recurringFrequency: 'daily' }, now)).toBe('unsupported-frequency');
    expect(invoiceBillingBlockReason({ ...due, recurringFrequency: undefined }, now)).toBe('unsupported-frequency');
    expect(invoiceBillingBlockReason({ ...due, nextRecurringDate: null }, now)).toBe('no-next-date');
    expect(invoiceBillingBlockReason({ ...due, nextRecurringDate: d('2026-09-01') }, now)).toBe('not-due');
  });

  it('stops a series past its end date', () => {
    expect(invoiceBillingBlockReason({ ...due, recurringEndDate: d('2026-07-31') }, now))
      .toBe('series-ended');
  });

  it('still bills on the last period before the end date', () => {
    expect(invoiceBillingBlockReason({ ...due, recurringEndDate: d('2026-08-31') }, now))
      .toBeNull();
  });

  it('is idempotent within a period via the period key', () => {
    expect(invoiceBillingBlockReason({ ...due, lastGeneratedPeriodKey: '2026-08' }, now))
      .toBe('already-generated');
    // A key from a previous period does NOT block.
    expect(invoiceBillingBlockReason({ ...due, lastGeneratedPeriodKey: '2026-07' }, now))
      .toBeNull();
  });

  it('REGRESSION: a series that lagged a cycle still bills', () => {
    // The old guard compared the newest child's createdAt ("now") against every
    // remaining past due date and stayed true forever. With a period key, a
    // January schedule seen in August bills August and moves on.
    const lagging = { ...due, nextRecurringDate: d('2026-01-31'), lastGeneratedPeriodKey: '2026-01' };
    expect(invoiceBillingBlockReason(lagging, now)).toBeNull();
  });

  it('REGRESSION: does not bill twice for one period after a catch-up', () => {
    const caughtUp = { ...due, nextRecurringDate: d('2026-01-31'), lastGeneratedPeriodKey: '2026-08' };
    expect(invoiceBillingBlockReason(caughtUp, now)).toBe('already-generated');
  });

  it('refuses to bill when the linked project bills the same retainer', () => {
    expect(invoiceBillingBlockReason(due, now, { isRecurring: true, status: 'Active' }))
      .toBe('project-also-bills');
    // Reported even while paused, so resuming cannot quietly resume the overlap.
    expect(invoiceBillingBlockReason({ ...due, isRecurringPaused: true }, now, { isRecurring: true }))
      .toBe('project-also-bills');
  });

  it('classifies unrecoverable blocks as permanent', () => {
    expect(PERMANENT_INVOICE_BLOCKS).toContain('series-ended');
    expect(PERMANENT_INVOICE_BLOCKS).toContain('project-also-bills');
    expect(PERMANENT_INVOICE_BLOCKS).not.toContain('paused');
    expect(PERMANENT_INVOICE_BLOCKS).not.toContain('not-due');
  });

  it('accepts Firestore Timestamp-shaped dates', () => {
    const ts = { toDate: () => d('2026-08-01') };
    expect(invoiceBillingBlockReason({ ...due, nextRecurringDate: ts }, now)).toBeNull();
    const secs = { seconds: Math.floor(d('2026-09-05').getTime() / 1000) };
    expect(invoiceBillingBlockReason({ ...due, nextRecurringDate: secs }, now)).toBe('not-due');
  });
});

describe('periodAlreadyCovered', () => {
  it('matches on an explicit periodKey', () => {
    expect(periodAlreadyCovered('monthly', '2026-08', [{ periodKey: '2026-08' }])).toBe(true);
    expect(periodAlreadyCovered('monthly', '2026-08', [{ periodKey: '2026-07' }])).toBe(false);
  });

  it('falls back to the occurrence date for pre-migration children', () => {
    expect(periodAlreadyCovered('monthly', '2026-08', [{ invoiceDate: d('2026-08-03') }])).toBe(true);
    expect(periodAlreadyCovered('monthly', '2026-08', [{ createdAt: d('2026-07-03') }])).toBe(false);
  });

  it('is false with no children at all', () => {
    expect(periodAlreadyCovered('monthly', '2026-08', [])).toBe(false);
  });
});


describe('recurringAnchorDay (the 31st must stay the 31st)', () => {
  it('keeps the stored anchor instead of the last, already-clamped occurrence', () => {
    expect(resolveInvoiceAnchorDay({ recurringAnchorDay: 31 }, d('2026-02-28'))).toBe(31);
  });

  it('falls back to the occurrence when the series has no anchor', () => {
    expect(resolveInvoiceAnchorDay({}, d('2026-02-28'))).toBe(28);
    expect(resolveInvoiceAnchorDay({ recurringAnchorDay: 0 }, d('2026-02-28'))).toBe(28);
    expect(resolveInvoiceAnchorDay({ recurringAnchorDay: 99 }, d('2026-02-28'))).toBe(28);
    expect(resolveInvoiceAnchorDay({ recurringAnchorDay: null }, d('2026-03-15'))).toBe(15);
  });

  it('REGRESSION: a 31st series does not drift to the 28th after February', () => {
    // What the engine used to do: re-derive the anchor from each occurrence.
    let drifting = d('2026-01-31');
    const drifted: number[] = [];
    for (let i = 0; i < 4; i++) {
      drifting = nextInvoiceOccurrence(drifting, 'monthly', drifting.getDate());
      drifted.push(drifting.getDate());
    }
    expect(drifted).toEqual([28, 28, 28, 28]); // February clamped the series for good

    // With a stored anchor, February is the only short month affected.
    const series = { recurringAnchorDay: 31 };
    let anchored = d('2026-01-31');
    const days: number[] = [];
    for (let i = 0; i < 4; i++) {
      anchored = nextInvoiceOccurrence(anchored, 'monthly', resolveInvoiceAnchorDay(series, anchored));
      days.push(anchored.getDate());
    }
    expect(days).toEqual([28, 31, 30, 31]); // Feb, Mar, Apr, May
  });

  it('applies to quarterly and yearly series too', () => {
    expect(nextInvoiceOccurrence(d('2026-02-28'), 'quarterly', 31).getDate()).toBe(31); // May
    expect(nextInvoiceOccurrence(d('2028-02-29'), 'yearly', 29).getDate()).toBe(28);    // 2029, not leap
  });

  it('periodsSkipped walks the series on its anchor, not the clamped date', () => {
    // Scheduled 28 Feb (a clamped 31st), now 30 April: March was missed.
    expect(periodsSkipped(d('2026-02-28'), 'monthly', d('2026-04-30'), 31)).toBe(1);
  });
});

describe('the parent invoice covers its own period', () => {
  const now = d('2026-09-20');

  it('BUG: without a period claim, a next-date inside the parent month re-bills it', () => {
    // Invoice issued 5 Sept, user picks "generate again on the 20th".
    const parent = {
      isRecurring: true,
      recurringFrequency: 'monthly',
      nextRecurringDate: d('2026-09-20'),
    };
    expect(invoiceBillingBlockReason(parent, now)).toBeNull(); // → a SECOND September invoice
  });

  it('claiming the parent period blocks it, and October still bills', () => {
    const parent = {
      isRecurring: true,
      recurringFrequency: 'monthly',
      nextRecurringDate: d('2026-09-20'),
      // What the form now stamps at creation: the period the invoice itself covers.
      lastGeneratedPeriodKey: invoiceBillingPeriodKey('monthly', d('2026-09-05')),
    };
    expect(invoiceBillingBlockReason(parent, now)).toBe('already-generated');
    // Once the month rolls over the series resumes normally — no period is lost.
    expect(invoiceBillingBlockReason(parent, d('2026-10-01'))).toBeNull();
    // ...and that catch-up is not reported as a missed period.
    expect(periodsSkipped(d('2026-09-20'), 'monthly', d('2026-10-01'), 20)).toBe(0);
  });
});


describe('recurringOccurrenceId (a duplicate must be impossible, not unlikely)', () => {
  it('is stable for the same series and period', () => {
    expect(recurringOccurrenceId('rec', 'abc123', '2026-09'))
      .toBe(recurringOccurrenceId('rec', 'abc123', '2026-09'));
  });

  it('differs per period, per parent and per engine', () => {
    const a = recurringOccurrenceId('rec', 'abc123', '2026-09');
    expect(a).not.toBe(recurringOccurrenceId('rec', 'abc123', '2026-10'));
    expect(a).not.toBe(recurringOccurrenceId('rec', 'zzz999', '2026-09'));
    expect(a).not.toBe(recurringOccurrenceId('auto', 'abc123', '2026-09'));
  });

  it('produces a legal Firestore document id for every period key shape', () => {
    for (const key of ['2026-09', 'W2026-08-03', 'Q2026-3', 'Y2026']) {
      const id = recurringOccurrenceId('rec', 'aBcDeF1234567890xyz', key);
      expect(id).not.toContain('/');   // '/' would make it a subcollection path
      expect(id).not.toMatch(/^\.\.?$/);
      expect(id.length).toBeLessThan(1500);
    }
  });
});

const ymd = (x: Date) => x.toISOString().slice(0, 10);
// Business-zone calendar day, for instants that sit at local midnight.
const zymd = (x: Date) => {
  const p = zonedParts(x);
  return `${p.year}-${String(p.month + 1).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
};

describe('resolveRecurringSchedule (what the form saves)', () => {
  it('an UNTOUCHED picker anchors on the invoice date, not the due date', () => {
    // Net-30 from 31 Jan: the form used to copy the due date (2 Mar) into the
    // picker and read it back as a pick → anchor 2, next 2 Mar, February gone.
    const r = resolveRecurringSchedule({ frequency: 'monthly', invoiceDate: d('2026-01-31'), pickedNext: null });
    expect(r.anchorDay).toBe(31);
    expect(ymd(r.nextRecurringDate)).toBe('2026-02-28');
  });

  it('a date the user actually picked wins for both anchor and next date', () => {
    const r = resolveRecurringSchedule({ frequency: 'monthly', invoiceDate: d('2026-01-31'), pickedNext: d('2026-03-02') });
    expect(r.anchorDay).toBe(2);
    expect(ymd(r.nextRecurringDate)).toBe('2026-03-02');
  });

  it('on edit, keeps the stored anchor and next date while untouched', () => {
    const r = resolveRecurringSchedule({
      frequency: 'monthly', invoiceDate: d('2026-01-05'),
      storedAnchorDay: '31', storedNext: d('2026-03-31'),
    });
    expect(r.anchorDay).toBe(31);
    expect(ymd(r.nextRecurringDate)).toBe('2026-03-31');
  });
});

describe('previousInvoicePeriodStart', () => {
  it('steps back one period from the 1st, never from the 31st', () => {
    expect(zymd(previousInvoicePeriodStart('monthly', d('2026-03-31')))).toBe('2026-02-01');
    expect(zymd(previousInvoicePeriodStart('quarterly', d('2026-08-15')))).toBe('2026-04-01');
    expect(zymd(previousInvoicePeriodStart('yearly', d('2026-08-15')))).toBe('2025-01-01');
    // 2026-08-19 is a Wednesday → previous Monday-week starts 2026-08-10.
    expect(zymd(previousInvoicePeriodStart('weekly', d('2026-08-19')))).toBe('2026-08-10');
  });
});

describe('nextOccurrenceInOrAfterPeriod', () => {
  it('leaves a next date that is already current or ahead alone', () => {
    const cur = d('2026-09-05');
    expect(nextOccurrenceInOrAfterPeriod('monthly', d('2026-09-30'), cur, 5)).toBe(cur);
    const ahead = d('2026-11-05');
    expect(nextOccurrenceInOrAfterPeriod('monthly', d('2026-09-30'), ahead, 5)).toBe(ahead);
  });

  it('walks a lagging date forward, restoring the anchor day', () => {
    // Paused with next = 28 Feb (clamped), anchor 31, resumed mid-September → 30 Sep.
    const r = nextOccurrenceInOrAfterPeriod('monthly', d('2026-09-15'), d('2026-02-28'), 31);
    expect(ymd(r)).toBe('2026-09-30');
    const q = nextOccurrenceInOrAfterPeriod('quarterly', d('2026-09-15'), d('2025-10-10'), 10);
    expect(ymd(q)).toBe('2026-07-10');
  });

  it('seeds on the anchor day of the current month when there is no next date', () => {
    expect(ymd(nextOccurrenceInOrAfterPeriod('monthly', d('2026-02-10'), null, 31))).toBe('2026-02-28');
    expect(ymd(nextOccurrenceInOrAfterPeriod('monthly', d('2026-09-10'), null, 15))).toBe('2026-09-15');
  });
});

describe('resumedInvoiceClaimPatch', () => {
  const at = d('2026-09-14');

  it('re-points a stale claim to the previous period and the next date into the current one', () => {
    const patch = resumedInvoiceClaimPatch({
      isRecurring: true, recurringFrequency: 'monthly',
      nextRecurringDate: d('2026-04-05'), lastGeneratedPeriodKey: '2026-03', recurringAnchorDay: 5,
    }, at);
    expect(patch.lastGeneratedPeriodKey).toBe('2026-08');
    expect(ymd(patch.nextRecurringDate as Date)).toBe('2026-09-05');
    // …so the engine bills September once, and reports nothing skipped.
    expect(periodsSkipped(patch.nextRecurringDate as Date, 'monthly', at, 5)).toBe(0);
    expect(invoiceBillingBlockReason({
      isRecurring: true, recurringFrequency: 'monthly',
      nextRecurringDate: patch.nextRecurringDate, lastGeneratedPeriodKey: patch.lastGeneratedPeriodKey as string,
    }, at)).toBeNull();
  });

  it('a current-period claim pushes the next date into the NEXT period', () => {
    const patch = resumedInvoiceClaimPatch({
      isRecurring: true, recurringFrequency: 'monthly',
      nextRecurringDate: d('2026-04-05'), lastGeneratedPeriodKey: '2026-09', recurringAnchorDay: 5,
    }, at);
    expect(patch.lastGeneratedPeriodKey).toBeUndefined();
    expect(ymd(patch.nextRecurringDate as Date)).toBe('2026-10-05');
  });

  it('is a no-op for a series that is on schedule', () => {
    expect(resumedInvoiceClaimPatch({
      isRecurring: true, recurringFrequency: 'monthly',
      nextRecurringDate: d('2026-10-05'), lastGeneratedPeriodKey: '2026-09', recurringAnchorDay: 5,
    }, at)).toEqual({});
    expect(resumedInvoiceClaimPatch({
      isRecurring: true, recurringFrequency: 'monthly',
      nextRecurringDate: d('2026-09-20'), lastGeneratedPeriodKey: '2026-08',
    }, at)).toEqual({});
  });

  it('seeds a stopped series (next date nulled) without inventing a claim', () => {
    const patch = resumedInvoiceClaimPatch({
      isRecurring: true, recurringFrequency: 'monthly', nextRecurringDate: null, recurringAnchorDay: 31,
    }, at);
    expect(patch.lastGeneratedPeriodKey).toBeUndefined();
    expect(ymd(patch.nextRecurringDate as Date)).toBe('2026-09-30');
  });

  it('handles weekly in weeks', () => {
    // 2026-09-14 is a Monday. Next = a Wednesday months back → the Wednesday of this week.
    const patch = resumedInvoiceClaimPatch({
      isRecurring: true, recurringFrequency: 'weekly',
      nextRecurringDate: d('2026-03-04'), lastGeneratedPeriodKey: 'W2026-02-23',
    }, at);
    expect(patch.lastGeneratedPeriodKey).toBe('W2026-09-07');
    expect(ymd(patch.nextRecurringDate as Date)).toBe('2026-09-16');
  });
});
