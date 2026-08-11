// Archiving a project — the reversible way to get a finished/dead project out of
// the way without destroying it.
//
// Why this is its own module and not two inline `update({ status: 'Archived' })`
// calls: 'Archived' is a TERMINAL billing status
// (`TERMINAL_PROJECT_STATUSES` in finance/recurringBilling.ts). Setting it by hand
// on a recurring retainer leaves `isRecurring: true` behind, and the cron then
// switches the series off on its own — so restoring the project later would give
// back a retainer that silently never bills again. Archiving therefore has to
// remember two things:
//
//   · the status the project came FROM (`statusBeforeArchive`), so restore does
//     not flatten every project into 'Active';
//   · whether it was a live retainer (`wasRecurringBeforeArchive`), so restore
//     can switch billing back on.
//
// Nothing here deletes fields: `project.status` is the single source of truth for
// "is this archived", and `archivedAt` is read as "last archived at". That keeps
// the patches plain objects (no `deleteField()` sentinels) and unit-testable.

import type { Project } from '../types';

/** The subset an archive/restore decision actually needs. */
export type ArchivableProject = Pick<Project, 'status'> &
  Partial<Pick<Project, 'isRecurring' | 'statusBeforeArchive' | 'wasRecurringBeforeArchive'>>;

/** Status a restored project falls back to when we have no memory of its past. */
export const DEFAULT_RESTORED_STATUS: Project['status'] = 'Active';

export function isProjectArchived(project: Pick<Project, 'status'> | null | undefined): boolean {
  return project?.status === 'Archived';
}

/**
 * Fields to write when archiving.
 *
 * A live retainer is stopped here rather than being left for the cron to stop:
 * the reason is recorded as `archived` so the Billing panel can say why, and
 * `wasRecurringBeforeArchive` is the token restore reads back.
 */
export function archiveProjectPatch(
  project: ArchivableProject,
  opts: { at: Date; byUserId?: string | null }
): Record<string, unknown> {
  // Re-archiving an already-archived project must not overwrite the remembered
  // status with 'Archived' (which would make restore meaningless).
  const previous = isProjectArchived(project) ? project.statusBeforeArchive : project.status;

  return {
    status: 'Archived' as Project['status'],
    archivedAt: opts.at,
    archivedByUserId: opts.byUserId ?? null,
    statusBeforeArchive: previous && previous !== 'Archived' ? previous : DEFAULT_RESTORED_STATUS,
    ...(project.isRecurring
      ? {
          isRecurring: false,
          wasRecurringBeforeArchive: true,
          recurringBillingStoppedReason: 'archived',
        }
      : {}),
  };
}

/** Fields to write when taking a project back out of the archive. */
export function restoreProjectPatch(project: ArchivableProject): Record<string, unknown> {
  const remembered = project.statusBeforeArchive;
  const status: Project['status'] =
    remembered && remembered !== 'Archived' ? remembered : DEFAULT_RESTORED_STATUS;

  // `statusBeforeArchive` is deliberately left in place: it is only ever READ
  // while a project is archived, and the next archive overwrites it from the
  // then-current status. Nothing has to be deleted for restore to be correct.
  return {
    status,
    ...(project.wasRecurringBeforeArchive
      ? {
          isRecurring: true,
          wasRecurringBeforeArchive: false,
          // Clear the "why did billing stop" note — it stopped because of the
          // archive, and the archive is over.
          recurringBillingStoppedReason: '',
        }
      : {}),
  };
}

/**
 * Same list, archived projects pushed to the bottom — order preserved otherwise.
 *
 * ProjectsView keeps the archive on its own shelf, but projects also appear in a
 * dozen pickers and side lists (task form, expense, invoice, daily report,
 * customer 360, portal…). Hiding archived ones there would break the rows that
 * still reference them ("no project" on a task of an archived project), so they
 * stay visible and simply stop competing for attention at the top.
 */
export function sortArchivedLast<T extends Pick<Project, 'status'>>(projects: readonly T[] | null | undefined): T[] {
  // Array.prototype.sort is stable in every engine we ship to, so a plain
  // archived-vs-live comparison keeps the caller's existing ordering intact.
  return [...(projects || [])].sort(
    (a, b) => Number(isProjectArchived(a)) - Number(isProjectArchived(b))
  );
}

/** Suffix for a project's name inside a picker, so "archived" is visible there too. */
export function projectPickerLabel(project: Pick<Project, 'name' | 'status'>): string {
  return isProjectArchived(project) ? `${project.name} (arkivuar)` : project.name;
}

/**
 * Human (Albanian) summary of what archiving will do, shown in the confirm step.
 * A retainer losing its billing cycle is the consequence people miss.
 */
export function archiveConsequences(project: ArchivableProject): string[] {
  const out: string[] = ['Projekti zhduket nga lista aktive dhe nga statistikat e portofolit.'];
  if (project.isRecurring) {
    out.push('Faturimi i përsëritur ndalon — nuk lëshohet më faturë automatike.');
  }
  out.push('Detyrat, faturat dhe orët e punës ruhen — asgjë nuk fshihet.');
  out.push('Mund ta kthesh në çdo moment nga skeda "Arkiva".');
  return out;
}
