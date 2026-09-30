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
// The claim (`lastInvoicePeriodKey`) is the billing engine's idempotency token, so
// restore has to speak the engine's own vocabulary rather than invent keys here.
import { projectBillingPeriodKey, TERMINAL_PROJECT_STATUSES } from './finance/recurringBilling';
import { addZonedDays, zonedDate, zonedParts } from './recurringUtils';

/** The subset an archive/restore decision actually needs. */
export type ArchivableProject = Pick<Project, 'status'> &
  Partial<
    Pick<
      Project,
      | 'isRecurring'
      | 'recurringFrequency'
      | 'lastInvoicePeriodKey'
      | 'statusBeforeArchive'
      | 'wasRecurringBeforeArchive'
      | 'recurringEndDate'
    >
  >;

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

/** True for the statuses the billing engine treats as the end of the series. */
export function isTerminalProjectStatus(status: Project['status'] | undefined | null): boolean {
  return !!status && (TERMINAL_PROJECT_STATUSES as ReadonlyArray<string>).includes(status);
}

/** Start of the period immediately before the one `at` falls in. */
function previousPeriodStart(frequency: string, at: Date): Date {
  if (frequency === 'weekly') return addZonedDays(at, -7);
  const p = zonedParts(at);
  // The 1st, so stepping back from the 31st cannot skip a short month.
  return zonedDate(p.year, p.month - 1, 1);
}

/**
 * Re-point a stale period claim so resuming billing does not raise a false alarm.
 *
 * `lastInvoicePeriodKey` is the billing engine's idempotency token AND the input
 * to `projectPeriodsSkipped()`. A project archived in August and restored in
 * October still carries `'2026-08'`, so the first run after the restore reports
 * "2 periudha pa faturë" and notifies the owner about periods that were
 * deliberately NOT billed — the project was in the archive, which is exactly
 * where a retainer goes to stop billing.
 *
 * The claim is therefore moved to the period BEFORE the current one, which is
 * the only value that says both true things at once: nothing was missed, and the
 * CURRENT period is still owed (the cron bills it on the next run). Re-stamping
 * the current period instead would silently skip the month the client is coming
 * back for.
 *
 * A claim that is already the current or the previous period is left untouched —
 * there is no gap to hide, and moving it back could re-open a period that was
 * already invoiced. (Even then the deterministic occurrence id would refuse the
 * duplicate, but the claim should not lie in the first place.)
 * `lastInvoiceGeneratedAt` is never touched: it stays the audit trail of when the
 * last invoice really was issued.
 */
export function resumedBillingClaimPatch(
  project: ArchivableProject,
  at: Date = new Date(),
): Record<string, unknown> {
  const claim = project.lastInvoicePeriodKey;
  if (!claim) return {};
  const frequency = project.recurringFrequency || 'monthly';
  if (claim === projectBillingPeriodKey(frequency, at)) return {};
  const previousKey = projectBillingPeriodKey(frequency, previousPeriodStart(frequency, at));
  if (claim === previousKey) return {};
  return { lastInvoicePeriodKey: previousKey };
}

/**
 * The BILLING half of a restore, on its own.
 *
 * Shared by `restoreProjectPatch` (un-archiving) and by the edit form when a
 * CANCELLED project is reopened: both are "a project leaving a terminal billing
 * status", and the cron marks both the same way — it writes
 * `wasRecurringBeforeArchive: true` next to `isRecurring: false` for ANY
 * permanent block (see api/cron/run.ts, PERMANENT_BILLING_BLOCKS). Honouring the
 * token only on the archive path meant reopening a cancelled retainer gave back a
 * project that silently never billed again.
 */
export function resumeRecurringBillingPatch(
  project: ArchivableProject,
  opts: { at?: Date } = {},
): Record<string, unknown> {
  if (!project.wasRecurringBeforeArchive) return {};
  // The cron writes `wasRecurringBeforeArchive` for EVERY permanent block —
  // `series-ended` included. Honouring the token blindly gave back
  // `isRecurring: true` with the old "repeat until" still in the past: the toast
  // said billing was back on, the engine refused it on the next run
  // (`series-ended`), and switched it off again. Nothing bills; only the
  // message lied. Leave the series ended and clear the token so the next
  // restore does not try again — the owner re-enables it with a new end date.
  if (recurringSeriesEnded(project, opts.at ?? new Date())) {
    return {
      wasRecurringBeforeArchive: false,
      recurringBillingStoppedReason: 'series-ended',
    };
  }
  return {
    isRecurring: true,
    wasRecurringBeforeArchive: false,
    // Clear the "why did billing stop" note — it stopped because of the archive
    // (or the cancellation), and that is over.
    recurringBillingStoppedReason: '',
    ...resumedBillingClaimPatch(project, opts.at ?? new Date()),
  };
}

/**
 * True when the project's "repeat until" lies in the past — the billing engine
 * would refuse the series with `series-ended`, so nothing may switch it back on
 * (see `resumeRecurringBillingPatch`). Callers use it to say WHY billing did not
 * resume. Same date coercion as the engine (Date | Timestamp | ISO).
 */
export function recurringSeriesEnded(
  project: Pick<ArchivableProject, 'recurringEndDate'>,
  at: Date = new Date(),
): boolean {
  const raw: unknown = project.recurringEndDate;
  if (!raw) return false;
  const ts = raw as { toDate?: () => Date };
  const end = raw instanceof Date ? raw
    : typeof ts.toDate === 'function' ? ts.toDate()
    : new Date(raw as string | number);
  return end instanceof Date && !isNaN(end.getTime()) && at > end;
}

/**
 * The line a restore/reopen toast should show for billing: what happened to
 * the retainer, or `undefined` for a project that never recurred.
 */
export function resumeBillingToastLine(
  project: ArchivableProject,
  at: Date = new Date(),
): string | undefined {
  if (!project.wasRecurringBeforeArchive) return undefined;
  if (recurringSeriesEnded(project, at)) {
    return 'Faturimi i përsëritur NUK u rihap: data e fundit e përsëritjes ka kaluar. Cakto një datë të re te "Modifiko".';
  }
  return 'Faturimi i përsëritur u aktivizua përsëri.';
}

/** Fields to write when taking a project back out of the archive. */
export function restoreProjectPatch(
  project: ArchivableProject,
  opts: { at?: Date } = {},
): Record<string, unknown> {
  const remembered = project.statusBeforeArchive;
  const status: Project['status'] =
    remembered && remembered !== 'Archived' ? remembered : DEFAULT_RESTORED_STATUS;

  // `statusBeforeArchive` is deliberately left in place: it is only ever READ
  // while a project is archived, and the next archive overwrites it from the
  // then-current status. Nothing has to be deleted for restore to be correct.
  return {
    status,
    ...resumeRecurringBillingPatch(project, opts),
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
