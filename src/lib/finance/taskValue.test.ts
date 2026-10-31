import { describe, it, expect, vi } from 'vitest';

vi.mock('../firebase', () => ({ db: {}, getNextInvoiceNumber: async () => 'INV-1' }));
vi.mock('../../hooks/useFirestore', () => ({ getGlobalBusinessId: () => 'biz' }));
vi.mock('firebase/firestore', () => ({
  addDoc: async () => ({ id: 'x' }),
  collection: () => ({}),
  doc: () => ({}),
  increment: (n: number) => ({ __increment: n }),
  updateDoc: async () => undefined,
}));

import { taskInvoiceDueDate, taskValueDecision } from './taskValue';
import { zonedDate, zonedParts } from '../recurringUtils';

describe('taskInvoiceDueDate', () => {
  it('is the last instant of the issue month in Europe/Tirane, not the machine\'s month end', () => {
    // 31 Oct 23:30 Tirane = 21:30Z — still October in the zone.
    const issued = zonedDate(2026, 9, 31, 23, 30);
    const p = zonedParts(taskInvoiceDueDate(issued));
    expect([p.year, p.month, p.day, p.hours, p.minutes, p.seconds]).toEqual([2026, 9, 31, 23, 59, 59]);
  });

  it('1 Nov 00:30 Tirane (31 Oct 22:30Z) is due end of NOVEMBER', () => {
    const issued = zonedDate(2026, 10, 1, 0, 30);
    expect(issued.toISOString()).toBe('2026-10-31T23:30:00.000Z');
    const p = zonedParts(taskInvoiceDueDate(issued));
    expect([p.month, p.day]).toEqual([10, 30]);
  });

  it('February clamps to its real last day', () => {
    const p = zonedParts(taskInvoiceDueDate(zonedDate(2028, 1, 3)));
    expect([p.month, p.day]).toEqual([1, 29]);
  });
});

describe('taskValueDecision', () => {
  it('a recurring project gets the draft invoice but never a budget bump', () => {
    expect(taskValueDecision(100, { billingType: 'monthly' })).toMatchObject({ createDraftInvoice: true, applyToBudget: false, budgetBlockReason: 'recurring-project' });
    expect(taskValueDecision(100, { billingType: 'one-time' })).toMatchObject({ createDraftInvoice: true, applyToBudget: true });
    expect(taskValueDecision(0, { billingType: 'one-time' })).toMatchObject({ createDraftInvoice: false });
  });
});
