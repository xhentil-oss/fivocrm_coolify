/**
 * @vitest-environment node
 *
 * Node, not jsdom: the drift guard reads `api/_projectCycles.ts` off disk.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  billingBlockReason,
  billingDueDate,
  billingIssueDate,
  billingPeriodEnd,
  billingPeriodKey,
  billingPeriodsSkipped,
  billingPeriodStart,
  cycleFeeFromMonthly,
  materializeWorkCyclePatch,
  monthStartInZone,
  monthlyFeeFromCycleFee,
  projectWorkCycle,
  reexpressBillingClaim,
  resolveCycleAnchorDay,
  seedWorkPeriodKey,
  shiftByWorkCycles,
  taskPeriodsBehind,
  workCycleBlockReason,
  workCycleTaskAction,
  workPeriodsSince,
  zonedMonthValue,
} from './projectCycles';

/** Noon in Tirana on that day — never near a month boundary in any zone. */
const at = (ymd: string) => new Date(`${ymd}T12:00:00+02:00`);
const day = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Tirane' }).format(d);

describe('api/_projectCycles.ts', () => {
  it('is byte-identical to the canonical copy', () => {
    const root = resolve(__dirname, '../../..');
    expect(readFileSync(resolve(root, 'api/_projectCycles.ts'), 'utf8'))
      .toBe(readFileSync(resolve(root, 'src/lib/finance/projectCycles.ts'), 'utf8'));
  });
});

describe('billing period keys', () => {
  const march = monthStartInZone(2026, 2);

  it('keeps the legacy weekly / monthly keys', () => {
    expect(billingPeriodKey('monthly', at('2026-08-15'))).toBe('2026-08');
    expect(billingPeriodKey('weekly', at('2026-08-05'))).toBe('W2026-08-03');
  });

  it('anchors a yearly contract on its start month, not on January', () => {
    expect(billingPeriodKey('yearly', at('2026-03-01'), march)).toBe('Y2026-03');
    expect(billingPeriodKey('yearly', at('2026-12-20'), march)).toBe('Y2026-03');
    expect(billingPeriodKey('yearly', at('2027-02-28'), march)).toBe('Y2026-03');
    expect(billingPeriodKey('yearly', at('2027-03-01'), march)).toBe('Y2027-03');
    expect(day(billingPeriodEnd('yearly', at('2026-06-10'), march))).toBe('2027-02-28');
  });

  it('anchors quarters on the contract month too', () => {
    expect(billingPeriodKey('quarterly', at('2026-05-31'), march)).toBe('Q2026-03');
    expect(billingPeriodKey('quarterly', at('2026-06-01'), march)).toBe('Q2026-06');
    expect(billingPeriodKey('quarterly', at('2027-01-15'), march)).toBe('Q2026-12');
    expect(day(billingPeriodEnd('quarterly', at('2026-12-01'), march))).toBe('2027-02-28');
  });

  it('falls back to calendar years / quarters without an anchor', () => {
    expect(billingPeriodKey('yearly', at('2026-07-01'))).toBe('Y2026-01');
    expect(billingPeriodKey('quarterly', at('2026-08-15'))).toBe('Q2026-07');
  });

  it('never confuses keys of different frequencies', () => {
    const d = at('2026-03-10');
    const keys = ['weekly', 'monthly', 'quarterly', 'yearly'].map(f => billingPeriodKey(f, d, march));
    expect(new Set(keys).size).toBe(4);
  });

  it('counts missed long periods', () => {
    expect(billingPeriodsSkipped('yearly', 'Y2026-03', at('2027-04-01'), march)).toBe(0);
    expect(billingPeriodsSkipped('yearly', 'Y2025-03', at('2027-04-01'), march)).toBe(1);
    expect(billingPeriodsSkipped('quarterly', 'Q2026-03', at('2026-12-05'), march)).toBe(2);
  });

  it('re-expresses a monthly claim in the yearly grid', () => {
    // Billed monthly up to October, yearly from November: October sits in the
    // year that ENDS in October, so November opens a new period and bills.
    const nov = monthStartInZone(2026, 10);
    const key = reexpressBillingClaim('yearly', at('2026-10-05'), at('2026-10-16'), nov);
    expect(key).toBe('Y2025-11');
    expect(billingPeriodKey('yearly', at('2026-11-02'), nov)).not.toBe(key);
  });
});

describe('issue and due dates', () => {
  const march = monthStartInZone(2026, 2);

  it('issues a yearly invoice in the first month of its period on the billing day', () => {
    expect(day(billingIssueDate('yearly', at('2026-09-01'), march, 25))).toBe('2026-03-25');
    expect(day(billingIssueDate('monthly', at('2026-02-10'), null, 31))).toBe('2026-02-28');
  });

  it('gives a yearly invoice 15 days by default, never twelve months', () => {
    const end = billingPeriodEnd('yearly', at('2026-03-02'), march);
    expect(day(billingDueDate('yearly', at('2026-03-02'), end, null))).toBe('2026-03-17');
    expect(day(billingDueDate('yearly', at('2026-03-02'), end, 30))).toBe('2026-04-01');
  });

  it('keeps the legacy period-end due date for monthly when unset', () => {
    const end = billingPeriodEnd('monthly', at('2026-08-03'));
    expect(billingDueDate('monthly', at('2026-08-03'), end, null)).toEqual(end);
    expect(day(billingDueDate('monthly', at('2026-08-03'), end, 10))).toBe('2026-08-13');
  });
});

describe('billingBlockReason', () => {
  const base = { isRecurring: true, status: 'Active', billingType: 'monthly' };
  const march = monthStartInZone(2026, 2);

  it('bills a yearly retainer once per contract year', () => {
    const p = { ...base, recurringFrequency: 'yearly', billingAnchorAt: march };
    expect(billingBlockReason(p, at('2026-03-01'))).toBeNull();
    expect(billingBlockReason({ ...p, lastInvoicePeriodKey: 'Y2026-03' }, at('2026-11-01'))).toBe('already-billed');
    expect(billingBlockReason({ ...p, lastInvoicePeriodKey: 'Y2026-03' }, at('2027-03-01'))).toBeNull();
  });

  it('waits for the billing day in the anchor month only', () => {
    const p = { ...base, recurringFrequency: 'yearly', billingAnchorAt: march, billingDayOfMonth: 20 };
    expect(billingBlockReason(p, at('2026-03-10'))).toBe('before-billing-day');
    expect(billingBlockReason(p, at('2026-03-20'))).toBeNull();
    // A cron that missed March bills the period as soon as it runs again.
    expect(billingBlockReason(p, at('2026-04-02'))).toBeNull();
  });

  it('never bills a contract that starts in a later month', () => {
    const p = { ...base, recurringFrequency: 'yearly', billingAnchorAt: monthStartInZone(2026, 10) };
    expect(billingBlockReason(p, at('2026-10-16'))).toBe('before-contract-start');
    expect(billingBlockReason(p, at('2026-11-01'))).toBeNull();
  });

  it('still refuses an unknown frequency', () => {
    expect(billingBlockReason({ ...base, recurringFrequency: 'daily' }, at('2026-08-01'))).toBe('unsupported-frequency');
  });
});

describe('prices', () => {
  it('derives the cycle fee from the monthly fee and the prepay discount', () => {
    expect(cycleFeeFromMonthly(1000, 'yearly', 10)).toBe(10800);
    expect(cycleFeeFromMonthly(1000, 'quarterly', 0)).toBe(3000);
    expect(cycleFeeFromMonthly(1000, 'monthly', 10)).toBe(1000); // no discount on short cycles
  });

  it('earns a cycle fee per month', () => {
    expect(monthlyFeeFromCycleFee(10800, 'yearly')).toBe(900);
    expect(monthlyFeeFromCycleFee(3000, 'quarterly')).toBe(1000);
    expect(monthlyFeeFromCycleFee(100, 'weekly')).toBeCloseTo(100 * 52 / 12);
    expect(monthlyFeeFromCycleFee(500, 'daily')).toBe(500);
  });
});

describe('work cycle', () => {
  it('is independent of billing when set, legacy-coupled when not', () => {
    expect(projectWorkCycle({ workCycle: 'monthly', isRecurring: false })).toBe('monthly');
    expect(projectWorkCycle({ workCycle: null, isRecurring: true })).toBeNull();
    expect(projectWorkCycle({ isRecurring: true, recurringFrequency: 'yearly' })).toBe('monthly');
    expect(projectWorkCycle({ isRecurring: true, recurringFrequency: 'weekly' })).toBe('weekly');
    expect(projectWorkCycle({ isRecurring: false })).toBeNull();
  });

  it('writes the legacy cycle down before billing is switched off', () => {
    expect(materializeWorkCyclePatch({ isRecurring: true })).toEqual({ workCycle: 'monthly' });
    expect(materializeWorkCyclePatch({ isRecurring: true, workCycle: null })).toEqual({});
  });

  it('seeds the current period without reopening anything mid-month', () => {
    const p = { workCycle: 'monthly', status: 'Active' };
    expect(workCycleBlockReason(p, at('2026-10-16'))).toBe('seeded');
    expect(seedWorkPeriodKey('monthly', p, at('2026-10-16'))).toBe('2026-10');
  });

  it('keeps the old reset for a project completed in an earlier month', () => {
    const p = { workCycle: 'monthly', status: 'Completed', lastCompletedAt: at('2026-09-28') };
    expect(seedWorkPeriodKey('monthly', p, at('2026-10-16'))).toBe('2026-09');
    expect(workCycleBlockReason(p, at('2026-10-16'))).toBeNull();
  });

  it('opens a new period once, and names every other decision', () => {
    const p = { workCycle: 'monthly', status: 'Active', workCycleLastPeriodKey: '2026-09' };
    expect(workCycleBlockReason(p, at('2026-10-01'))).toBeNull();
    expect(workCycleBlockReason({ ...p, workCycleLastPeriodKey: '2026-10' }, at('2026-10-20'))).toBe('already-cycled');
    expect(workCycleBlockReason({ ...p, status: 'On Hold' }, at('2026-10-01'))).toBe('on-hold');
    expect(workCycleBlockReason({ ...p, status: 'Archived' }, at('2026-10-01'))).toBe('terminal-status');
    expect(workCycleBlockReason({ ...p, status: 'Planning' }, at('2026-10-01'))).toBe('not-started');
    // Not blocked by unfinished tasks any more — "Completed" is not required.
    expect(workCycleBlockReason({ ...p, status: 'In Review' }, at('2026-10-01'))).toBeNull();
  });

  it('carries unfinished tasks and leaves recurring tasks to their own engine', () => {
    expect(workCycleTaskAction({ status: 'Done' })).toBe('reopen');
    expect(workCycleTaskAction({ status: 'In Progress' })).toBe('carry');
    expect(workCycleTaskAction({ status: 'Todo' })).toBe('carry');
    expect(workCycleTaskAction({ status: 'Done', isRecurring: true })).toBe('own-series');
  });

  it('moves dates by the number of periods that passed, month-end clamped', () => {
    expect(workPeriodsSince('monthly', '2026-08', at('2026-10-01'))).toBe(2);
    expect(workPeriodsSince('weekly', 'W2026-09-28', at('2026-10-14'))).toBe(2);
    expect(workPeriodsSince('monthly', 'W2026-09-28', at('2026-10-14'))).toBeNull();
    expect(day(shiftByWorkCycles(at('2026-01-31'), 'monthly', 1)!)).toBe('2026-02-28');
    expect(day(shiftByWorkCycles(at('2026-01-31'), 'monthly', 2)!)).toBe('2026-03-31');
    expect(day(shiftByWorkCycles(at('2026-10-05'), 'weekly', 2)!)).toBe('2026-10-19');
  });

  it('keeps a month-end task on its anchor day across clamps', () => {
    // 31 Jan -> 28 Feb -> 31 Mar, not -> 28 Mar forever.
    const feb = shiftByWorkCycles(at('2026-01-31'), 'monthly', 1, 31)!;
    expect(day(feb)).toBe('2026-02-28');
    const anchor = resolveCycleAnchorDay(feb, 31);
    expect(anchor).toBe(31);
    expect(day(shiftByWorkCycles(feb, 'monthly', 1, anchor)!)).toBe('2026-03-31');
    // A date moved by hand re-anchors on its new day.
    expect(resolveCycleAnchorDay(at('2026-02-20'), 31)).toBe(20);
    expect(resolveCycleAnchorDay(null, 31)).toBeNull();
  });

  it('moves a task by ITS OWN lag, and leaves current/future tasks alone', () => {
    const now = at('2026-10-02');
    expect(taskPeriodsBehind({ endDate: at('2026-09-25') }, 'monthly', now)).toBe(1);
    expect(taskPeriodsBehind({ endDate: at('2026-07-10') }, 'monthly', now)).toBe(3);
    expect(taskPeriodsBehind({ endDate: at('2026-10-20') }, 'monthly', now)).toBe(0);
    expect(taskPeriodsBehind({ endDate: at('2026-11-05') }, 'monthly', now)).toBe(0);
    // Deadline wins over start: started last month, due this month -> not moved.
    expect(taskPeriodsBehind({ startDate: at('2026-09-28'), endDate: at('2026-10-03') }, 'monthly', now)).toBe(0);
    expect(taskPeriodsBehind({ startDate: at('2026-09-01') }, 'monthly', now)).toBe(1);
    expect(taskPeriodsBehind({}, 'monthly', now)).toBe(0);
    expect(taskPeriodsBehind({ endDate: at('2026-09-23') }, 'weekly', at('2026-10-07'))).toBe(2);
  });

  it('formats the month input in the business zone', () => {
    expect(zonedMonthValue(monthStartInZone(2026, 10))).toBe('2026-11');
    expect(day(billingPeriodStart('monthly', at('2026-10-31')))).toBe('2026-10-01');
  });
});
