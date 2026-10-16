import { describe, it, expect } from 'vitest';
import {
  keyResultProgress, computeAutoKRValue, goalDerivedProgress, goalHealth, goalScore, hasKeyResults,
} from './okr';
import type { Goal, KeyResult, Task, Invoice, Lead } from '../../types';

const NOW = new Date('2026-07-20T12:00:00').getTime();
const d = (iso: string) => new Date(iso);

function goal(p: Partial<Goal>): Goal {
  return {
    id: 'g1',
    title: 'Objektiv',
    scope: 'team',
    progress: 0,
    status: 'On Track',
    createdAt: d('2026-07-01'),
    updatedAt: d('2026-07-01'),
    createdByUserId: 'u1',
    ...p,
  } as Goal;
}

function kr(p: Partial<KeyResult>): KeyResult {
  return { id: Math.random().toString(36).slice(2), title: 'KR', type: 'metric', startValue: 0, currentValue: 0, targetValue: 100, ...p } as KeyResult;
}

describe('keyResultProgress', () => {
  it('metric: linear from start→target', () => {
    expect(keyResultProgress(kr({ startValue: 0, currentValue: 25, targetValue: 100 }), goal({}), {})).toBe(25);
    expect(keyResultProgress(kr({ startValue: 100, currentValue: 150, targetValue: 200 }), goal({}), {})).toBe(50);
  });
  it('metric: clamps to 0–100', () => {
    expect(keyResultProgress(kr({ currentValue: 500, targetValue: 100 }), goal({}), {})).toBe(100);
    expect(keyResultProgress(kr({ startValue: 50, currentValue: 0, targetValue: 100 }), goal({}), {})).toBe(0);
  });
  it('milestone: binary', () => {
    expect(keyResultProgress(kr({ type: 'milestone', done: false }), goal({}), {})).toBe(0);
    expect(keyResultProgress(kr({ type: 'milestone', done: true }), goal({}), {})).toBe(100);
  });
});

describe('computeAutoKRValue', () => {
  const tasks: Task[] = [
    { id: 't1', title: '', status: 'Done', assignedToUserId: 'u1', projectId: 'p1', updatedAt: d('2026-07-10'), createdAt: d('2026-07-02'), createdByUserId: 'u1' } as Task,
    { id: 't2', title: '', status: 'Done', assignedToUserId: 'u2', projectId: 'p1', updatedAt: d('2026-07-11'), createdAt: d('2026-07-02'), createdByUserId: 'u1' } as Task,
    { id: 't3', title: '', status: 'Done', assignedToUserId: 'u1', updatedAt: d('2026-06-01'), createdAt: d('2026-05-02'), createdByUserId: 'u1' } as Task, // out of window
    { id: 't4', title: '', status: 'Todo', assignedToUserId: 'u1', updatedAt: d('2026-07-12'), createdAt: d('2026-07-02'), createdByUserId: 'u1' } as Task, // not done
  ];

  it('tasksCompleted counts Done tasks in the goal window', () => {
    const g = goal({ startDate: d('2026-07-01'), dueDate: d('2026-07-31') });
    expect(computeAutoKRValue('tasksCompleted', g, { tasks }, NOW)).toBe(2);
  });

  it('scopes to owner for individual goals', () => {
    const g = goal({ scope: 'individual', ownerId: 'u1', startDate: d('2026-07-01'), dueDate: d('2026-07-31') });
    expect(computeAutoKRValue('tasksCompleted', g, { tasks }, NOW)).toBe(1); // only u1's in-window
  });

  it('scopes to linked projects', () => {
    const g = goal({ startDate: d('2026-07-01'), dueDate: d('2026-07-31'), linkedProjects: ['pX'] });
    expect(computeAutoKRValue('tasksCompleted', g, { tasks }, NOW)).toBe(0); // none in pX
  });

  it('revenue sums paid invoices in window (total over amount)', () => {
    const invoices: Invoice[] = [
      { id: 'i1', status: 'Paid', amount: 100, total: 120, paidAt: d('2026-07-05'), updatedAt: d('2026-07-05') } as Invoice,
      { id: 'i2', status: 'Paid', amount: 200, paidAt: d('2026-07-06'), updatedAt: d('2026-07-06') } as Invoice,
      { id: 'i3', status: 'Pending', amount: 999, updatedAt: d('2026-07-06') } as Invoice,
    ];
    const g = goal({ startDate: d('2026-07-01'), dueDate: d('2026-07-31') });
    expect(computeAutoKRValue('revenue', g, { invoices }, NOW)).toBe(320);
    expect(computeAutoKRValue('invoicesPaid', g, { invoices }, NOW)).toBe(2);
  });

  it('revenue = cash collected in the goal window (instalments on their own dates, nothing after the goal ended)', () => {
    const invoices: Invoice[] = [
      { id: 'p', status: 'Partial', total: 1000, createdAt: d('2026-06-01'),
        partialPayments: [{ amount: 300, paidAt: d('2026-06-10') }, { amount: 200, paidAt: d('2026-06-25') }] } as any,
      // Paid after the goal ended — not progress on it, even though it is in the past.
      { id: 'late', status: 'Paid', total: 500, paidAt: d('2026-07-05'), updatedAt: d('2026-07-05') } as Invoice,
      // Paid on the due DAY itself (later than 00:00) counts.
      { id: 'dueDay', status: 'Paid', total: 50, paidAt: d('2026-06-30T15:00:00'), updatedAt: d('2026-06-30T15:00:00') } as Invoice,
    ];
    const ended = goal({ startDate: d('2026-06-01T00:00:00'), dueDate: d('2026-06-30T00:00:00') });
    expect(computeAutoKRValue('revenue', ended, { invoices }, NOW)).toBe(300 + 200 + 50);
  });

  it('leadsWon counts Won/Converted in window', () => {
    const leads: Lead[] = [
      { id: 'l1', status: 'Won', updatedAt: d('2026-07-05') } as Lead,
      { id: 'l2', status: 'Converted', updatedAt: d('2026-07-06') } as Lead,
      { id: 'l3', status: 'Lost', updatedAt: d('2026-07-06') } as Lead,
    ];
    const g = goal({ startDate: d('2026-07-01'), dueDate: d('2026-07-31') });
    expect(computeAutoKRValue('leadsWon', g, { leads }, NOW)).toBe(2);
  });
});

describe('goalDerivedProgress', () => {
  it('averages KR progress', () => {
    const g = goal({
      keyResults: [
        kr({ currentValue: 100, targetValue: 100 }), // 100
        kr({ currentValue: 0, targetValue: 100 }),   // 0
        kr({ type: 'milestone', done: true }),         // 100
      ],
    });
    expect(goalDerivedProgress(g, {}, NOW)).toBe(67); // (100+0+100)/3
  });
  it('falls back to manual progress when no KRs', () => {
    expect(goalDerivedProgress(goal({ progress: 42 }), {}, NOW)).toBe(42);
    expect(hasKeyResults(goal({ progress: 42 }))).toBe(false);
  });
  it('derives from an auto KR', () => {
    const tasks: Task[] = [
      { id: 't1', title: '', status: 'Done', updatedAt: d('2026-07-10'), createdAt: d('2026-07-01'), createdByUserId: 'u1' } as Task,
      { id: 't2', title: '', status: 'Done', updatedAt: d('2026-07-11'), createdAt: d('2026-07-01'), createdByUserId: 'u1' } as Task,
    ];
    const g = goal({
      startDate: d('2026-07-01'), dueDate: d('2026-07-31'),
      keyResults: [kr({ type: 'auto', autoSource: 'tasksCompleted', startValue: 0, targetValue: 4 })],
    });
    expect(goalDerivedProgress(g, { tasks }, NOW)).toBe(50); // 2 of 4
  });
});

describe('goalHealth (pace)', () => {
  it('Achieved at 100', () => {
    expect(goalHealth(goal({}), 100, NOW)).toBe('Achieved');
  });
  it('On Track when ahead of pace', () => {
    // window 20 days, 10 elapsed → expected 50%. progress 60 → on track.
    const g = goal({ startDate: d('2026-07-10'), dueDate: d('2026-07-30') });
    expect(goalHealth(g, 60, NOW)).toBe('On Track');
  });
  it('Off Track when far behind pace', () => {
    const g = goal({ startDate: d('2026-07-10'), dueDate: d('2026-07-30') });
    expect(goalHealth(g, 10, NOW)).toBe('Off Track'); // expected ~50, 10 << 25 behind
  });
});

describe('goalScore', () => {
  it('maps 0–100 → 0.0–1.0', () => {
    expect(goalScore(70)).toBe(0.7);
    expect(goalScore(0)).toBe(0);
    expect(goalScore(150)).toBe(1);
  });
});
