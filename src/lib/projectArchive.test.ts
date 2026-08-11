import { describe, it, expect } from 'vitest';
import {
  archiveConsequences,
  archiveProjectPatch,
  isProjectArchived,
  projectPickerLabel,
  restoreProjectPatch,
  sortArchivedLast,
} from './projectArchive';
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

  it('archive → restore is a round trip for a retainer', () => {
    const original = project({ status: 'On Hold', isRecurring: true });
    const archived = { ...original, ...archiveProjectPatch(original, { at: AT }) } as Project;
    const restored = { ...archived, ...restoreProjectPatch(archived) } as Project;
    expect(restored.status).toBe('On Hold');
    expect(restored.isRecurring).toBe(true);
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
