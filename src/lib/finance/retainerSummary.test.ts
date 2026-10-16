import { describe, expect, it } from 'vitest';
import type { Invoice, Project } from '../../types';
import { monthStartInZone } from './projectCycles';
import { retainerSummary } from './retainerSummary';

const at = (ymd: string) => new Date(`${ymd}T12:00:00+02:00`);
const day = (d: Date | null) => (d ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Tirane' }).format(d) : null);

const yearly = (over: Partial<Project> = {}): Project => ({
  id: 'p1', name: 'SEO', status: 'Active', isRecurring: true, billingType: 'monthly',
  recurringFrequency: 'yearly', billingAnchorAt: monthStartInZone(2026, 2), budget: 12_000,
  createdAt: at('2026-02-20'), updatedAt: at('2026-02-20'), createdByUserId: 'u1', ...over,
} as Project);

describe('retainerSummary', () => {
  it('shows the deferred part of a year paid up front', () => {
    const inv = { id: 'i1', projectId: 'p1', status: 'Paid', billingPeriodKey: 'Y2026-03' } as Invoice;
    const s = retainerSummary(yearly(), [inv], at('2026-07-10'))!;
    expect(s.monthlyFee).toBe(1000);
    expect(s.currentPeriodBilled).toBe(true);
    expect(s.monthsServed).toBe(5); // Mar..Jul
    expect(s.deferred).toBe(7000);
    expect(day(s.nextInvoiceAt)).toBe('2027-03-01');
  });

  it('expects the invoice now when the period is not billed yet', () => {
    const s = retainerSummary(yearly({ billingDayOfMonth: 20 }), [], at('2026-03-05'))!;
    expect(s.currentPeriodBilled).toBe(false);
    expect(s.deferred).toBe(0);
    expect(day(s.nextInvoiceAt)).toBe('2026-03-20');
  });

  it('points a future contract at its first month', () => {
    const s = retainerSummary(yearly({ billingAnchorAt: monthStartInZone(2026, 10) }), [], at('2026-10-16'))!;
    expect(day(s.nextInvoiceAt)).toBe('2026-11-01');
    expect(s.deferred).toBeNull();
  });

  it('has no next invoice for a paused series', () => {
    expect(retainerSummary(yearly({ isRecurringPaused: true }), [], at('2026-07-10'))!.nextInvoiceAt).toBeNull();
  });

  it('ignores drafts and cancelled invoices', () => {
    const inv = { id: 'i1', projectId: 'p1', status: 'Draft', billingPeriodKey: 'Y2026-03' } as Invoice;
    expect(retainerSummary(yearly(), [inv], at('2026-07-10'))!.currentPeriodBilled).toBe(false);
  });
});
