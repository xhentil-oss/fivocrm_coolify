import { describe, it, expect } from 'vitest';
import {
  archiveConsequences,
  archiveProjectPatch,
  isProjectArchived,
  isTerminalProjectStatus,
  projectPickerLabel,
  restoreProjectPatch,
  resumedBillingClaimPatch,
  resumeRecurringBillingPatch,
  recurringSeriesEnded,
  resumeBillingToastLine,
  sortArchivedLast,
} from './projectArchive';
import { projectBillingPeriodKey, projectPeriodsSkipped } from './finance/recurringBilling';
import type { Project } from '../types';

const AT = new Date('2026-08-11T10:00:00');

function project(over: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    name: 'Retainer',
    status: 'Active',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-08-01'),
    createdByUserId: 'u1',
    ...over,
  } as Project;
}

describe('isProjectArchived', () => {
  it('reads the status, not the archivedAt stamp', () => {
    expect(isProjectArchived(project({ status: 'Archived' }))).toBe(true);
    // A restored project keeps archivedAt as "last archived at" — it is not archived.
    expect(isProjectArchived(project({ status: 'Active', archivedAt: AT }))).toBe(false);
    expect(isProjectArchived(undefined)).toBe(false);
  });
});

describe('archiveProjectPatch', () => {
  it('archives and remembers the previous status', () => {
    const patch = archiveProjectPatch(project({ status: 'On Hold' }), { at: AT, byUserId: 'u2' });
    expect(patch.status).toBe('Archived');
    expect(patch.statusBeforeArchive).toBe('On Hold');
    expect(patch.archivedAt).toBe(AT);
    expect(patch.archivedByUserId).toBe('u2');
  });

  it('stops a live retainer — Archived is a terminal billing status', () => {
    const patch = archiveProjectPatch(
      project({ status: 'Active', isRecurring: true, recurringFrequency: 'monthly' }),
      { at: AT },
    );
    expect(patch.isRecurring).toBe(false);
    expect(patch.wasRecurringBeforeArchive).toBe(true);
    expect(patch.recurringBillingStoppedReason).toBe('archived');
    expect(patch.archivedByUserId).toBeNull();
  });

  it('leaves recurring fields alone for a one-off project', () => {
    const patch = archiveProjectPatch(project({ status: 'Completed' }), { at: AT });
    expect(patch).not.toHaveProperty('isRecurring');
    expect(patch).not.toHaveProperty('wasRecurringBeforeArchive');
  });

  it('re-archiving does not overwrite the remembered status with Archived', () => {
    const patch = archiveProjectPatch(
      project({ status: 'Archived', statusBeforeArchive: 'Planning' }),
      { at: AT },
    );
    expect(patch.statusBeforeArchive).toBe('Planning');
  });

  it('falls back to Active when there is nothing to remember', () => {
    const patch = archiveProjectPatch(project({ status: 'Archived' }), { at: AT });
    expect(patch.statusBeforeArchive).toBe('Active');
  });
});

describe('restoreProjectPatch', () => {
  it('puts the project back on the status it had', () => {
    const patch = restoreProjectPatch(project({ status: 'Archived', statusBeforeArchive: 'In Review' }));
    expect(patch.status).toBe('In Review');
  });

  it('defaults to Active for a project archived before this existed', () => {
    expect(restoreProjectPatch(project({ status: 'Archived' })).status).toBe('Active');
  });

  it('switches a remembered retainer back on and clears the stop reason', () => {
    const patch = restoreProjectPatch(project({
      status: 'Archived',
      isRecurring: false,
      wasRecurringBeforeArchive: true,
      statusBeforeArchive: 'Active',
    }));
    expect(patch.isRecurring).toBe(true);
    expect(patch.wasRecurringBeforeArchive).toBe(false);
    expect(patch.recurringBillingStoppedReason).toBe('');
  });

  it('does not turn a one-off project into a retainer', () => {
    const patch = restoreProjectPatch(project({ status: 'Archived', statusBeforeArchive: 'Completed' }));
    expect(patch).not.toHaveProperty('isRecurring');
  });

  it('re-points a stale claim so restoring raises no false "periods missed" alarm', () => {
    // Archived in August, restored in October: the claim still says '2026-08', so
    // the first run after the restore reports September as an unbilled period and
    // notifies the owner about a month the project spent in the archive on purpose.
    const restoredAt = new Date('2026-10-14T09:00:00');
    const archived = project({
      status: 'Archived',
      statusBeforeArchive: 'Active',
      isRecurring: false,
      wasRecurringBeforeArchive: true,
      recurringFrequency: 'monthly',
      lastInvoicePeriodKey: '2026-08',
    });

    expect(projectPeriodsSkipped('monthly', archived.lastInvoicePeriodKey, restoredAt)).toBe(1);

    const patch = restoreProjectPatch(archived, { at: restoredAt });
    expect(patch.lastInvoicePeriodKey).toBe('2026-09');
    expect(projectPeriodsSkipped('monthly', patch.lastInvoicePeriodKey as string, restoredAt)).toBe(0);
    // ...and the CURRENT period is still owed: the claim is the previous one, so
    // the cron bills October rather than silently skipping the month the client
    // came back for.
    expect(patch.lastInvoicePeriodKey).not.toBe(projectBillingPeriodKey('monthly', restoredAt));
  });

  it('re-points a weekly claim in weeks', () => {
    const restoredAt = new Date('2026-10-14T09:00:00'); // Wednesday
    const patch = restoreProjectPatch(project({
      status: 'Archived',
      wasRecurringBeforeArchive: true,
      recurringFrequency: 'weekly',
      lastInvoicePeriodKey: 'W2026-08-03',
    }), { at: restoredAt });
    expect(patch.lastInvoicePeriodKey).toBe(
      projectBillingPeriodKey('weekly', new Date('2026-10-07T09:00:00')),
    );
  });

  it('leaves a claim that is already current or previous alone', () => {
    const at = new Date('2026-10-14T09:00:00');
    const base = { status: 'Archived' as const, wasRecurringBeforeArchive: true, recurringFrequency: 'monthly' as const };
    // Archived and restored inside the same month: the period was billed, and
    // moving the claim back would re-open a period that already has an invoice.
    expect(restoreProjectPatch(project({ ...base, lastInvoicePeriodKey: '2026-10' }), { at }))
      .not.toHaveProperty('lastInvoicePeriodKey');
    expect(restoreProjectPatch(project({ ...base, lastInvoicePeriodKey: '2026-09' }), { at }))
      .not.toHaveProperty('lastInvoicePeriodKey');
  });

  it('invents no claim for a project that never billed', () => {
    expect(resumedBillingClaimPatch(project({ status: 'Archived' }), new Date('2026-10-14')))
      .toEqual({});
  });

  it('touches the claim only when billing actually resumes', () => {
    // A one-off project archived in August: nothing to resume, nothing to re-point.
    const patch = restoreProjectPatch(project({
      status: 'Archived',
      statusBeforeArchive: 'Completed',
      lastInvoicePeriodKey: '2026-08',
    }), { at: new Date('2026-10-14T09:00:00') });
    expect(patch).not.toHaveProperty('lastInvoicePeriodKey');
    expect(patch).not.toHaveProperty('isRecurring');
  });

  it('archive → restore is a round trip for a retainer', () => {
    const original = project({ status: 'On Hold', isRecurring: true });
    const archived = { ...original, ...archiveProjectPatch(original, { at: AT }) } as Project;
    const restored = { ...archived, ...restoreProjectPatch(archived) } as Project;
    expect(restored.status).toBe('On Hold');
    expect(restored.isRecurring).toBe(true);
  });
});

describe('resumeRecurringBillingPatch (reopening a CANCELLED project)', () => {
  const at = new Date('2026-10-14T09:00:00');

  it('gives back a working retainer, not a dead one', () => {
    // What the cron writes when it stops a terminal-status retainer for good
    // (api/cron/run.ts: isRecurring false + wasRecurringBeforeArchive true).
    const cancelled = project({
      status: 'Cancelled',
      isRecurring: false,
      wasRecurringBeforeArchive: true,
      recurringBillingStoppedReason: 'terminal-status',
      recurringFrequency: 'monthly',
      lastInvoicePeriodKey: '2026-06',
    });
    const patch = resumeRecurringBillingPatch(cancelled, { at });
    expect(patch.isRecurring).toBe(true);
    expect(patch.wasRecurringBeforeArchive).toBe(false);
    expect(patch.recurringBillingStoppedReason).toBe('');
    expect(patch.lastInvoicePeriodKey).toBe('2026-09');
  });

  it('does not resurrect a project that never recurred', () => {
    expect(resumeRecurringBillingPatch(project({ status: 'Cancelled' }), { at })).toEqual({});
  });
});

describe('isTerminalProjectStatus', () => {
  it('matches the billing engine\'s terminal statuses', () => {
    expect(isTerminalProjectStatus('Cancelled')).toBe(true);
    expect(isTerminalProjectStatus('Archived')).toBe(true);
    expect(isTerminalProjectStatus('Active')).toBe(false);
    expect(isTerminalProjectStatus('Completed')).toBe(false);
    expect(isTerminalProjectStatus(undefined)).toBe(false);
  });
});

describe('sortArchivedLast', () => {
  const list = [
    project({ id: 'a', name: 'A', status: 'Archived' }),
    project({ id: 'b', name: 'B', status: 'Active' }),
    project({ id: 'c', name: 'C', status: 'Archived' }),
    project({ id: 'd', name: 'D', status: 'On Hold' }),
  ];

  it('moves archived projects to the bottom', () => {
    expect(sortArchivedLast(list).map(p => p.id)).toEqual(['b', 'd', 'a', 'c']);
  });

  it('is stable — the caller\'s ordering survives inside each group', () => {
    const alpha = [
      project({ id: 'z', name: 'Zebra', status: 'Active' }),
      project({ id: 'x', name: 'Alfa', status: 'Archived' }),
      project({ id: 'y', name: 'Beta', status: 'Active' }),
    ];
    expect(sortArchivedLast(alpha).map(p => p.id)).toEqual(['z', 'y', 'x']);
  });

  it('does not mutate the input and tolerates null', () => {
    const input = [...list];
    sortArchivedLast(input);
    expect(input.map(p => p.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(sortArchivedLast(null)).toEqual([]);
  });
});

describe('projectPickerLabel', () => {
  it('marks archived projects inside a picker', () => {
    expect(projectPickerLabel(project({ name: 'SEO', status: 'Archived' }))).toBe('SEO (arkivuar)');
    expect(projectPickerLabel(project({ name: 'SEO', status: 'Active' }))).toBe('SEO');
  });
});

describe('archiveConsequences', () => {
  it('warns about billing only when there is a live cycle', () => {
    const withCycle = archiveConsequences(project({ isRecurring: true })).join(' ');
    const without = archiveConsequences(project()).join(' ');
    expect(withCycle).toContain('Faturimi i përsëritur ndalon');
    expect(without).not.toContain('Faturimi i përsëritur ndalon');
  });

  it('always says the data survives and the move is reversible', () => {
    const lines = archiveConsequences(project()).join(' ');
    expect(lines).toContain('asgjë nuk fshihet');
    expect(lines).toContain('Arkiva');
  });
});

describe('series-ended retainers are not resurrected', () => {
  const ended = project({
    status: 'Archived',
    statusBeforeArchive: 'Active',
    isRecurring: false,
    wasRecurringBeforeArchive: true, // the cron stamps this for series-ended too
    recurringEndDate: new Date('2026-06-30T23:59:59'),
    lastInvoicePeriodKey: '2026-06',
    recurringBillingStoppedReason: 'series-ended',
  });

  it('recurringSeriesEnded reads the end date against `at`', () => {
    expect(recurringSeriesEnded(ended, AT)).toBe(true);
    expect(recurringSeriesEnded(ended, new Date('2026-05-01'))).toBe(false);
    expect(recurringSeriesEnded(project(), AT)).toBe(false);
  });

  it('restore keeps isRecurring OFF, clears the token and re-points nothing', () => {
    const patch = restoreProjectPatch(ended, { at: AT });
    expect(patch.status).toBe('Active');
    expect(patch.isRecurring).toBeUndefined();
    expect(patch.wasRecurringBeforeArchive).toBe(false);
    expect(patch.recurringBillingStoppedReason).toBe('series-ended');
    expect(patch.lastInvoicePeriodKey).toBeUndefined();
  });

  it('reopening a cancelled ended series behaves the same', () => {
    const patch = resumeRecurringBillingPatch({ ...ended, status: 'Cancelled' }, { at: AT });
    expect(patch.isRecurring).toBeUndefined();
    expect(patch.wasRecurringBeforeArchive).toBe(false);
  });

  it('still resumes when the end date is ahead', () => {
    const patch = restoreProjectPatch({ ...ended, recurringEndDate: new Date('2027-01-31') }, { at: AT });
    expect(patch.isRecurring).toBe(true);
    expect(patch.wasRecurringBeforeArchive).toBe(false);
  });

  it('the toast says why billing did not come back', () => {
    expect(resumeBillingToastLine(ended, AT)).toMatch(/NUK u rihap/);
    expect(resumeBillingToastLine({ ...ended, recurringEndDate: undefined }, AT)).toBe('Faturimi i përsëritur u aktivizua përsëri.');
    expect(resumeBillingToastLine(project(), AT)).toBeUndefined();
  });
});
