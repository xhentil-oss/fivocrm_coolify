import { getTimestampMs } from './utils';

export interface TimeEntryLike {
  startTime?: unknown;
  endTime?: unknown;
  /** Stored (denormalized) minutes. Not trusted for display — may be stale/corrupt. */
  duration?: number | null;
}

/**
 * Minutes for a single COMPLETED time entry.
 *
 * The duration is always derived from `endTime - startTime` (the source of
 * truth) rather than the denormalized `duration` field. A stale/corrupt stored
 * `duration` — e.g. one written against the wrong `startTime` when several
 * running timers overlapped — must never be able to inflate the displayed total.
 *
 * Running entries (no `endTime`) and invalid ranges return 0.
 */
export function entryDurationMinutes(entry: TimeEntryLike | null | undefined): number {
  if (!entry) return 0;
  const start = getTimestampMs(entry.startTime);
  const end = getTimestampMs(entry.endTime);
  if (!start || !end) return 0;            // running or missing timestamps → not counted
  const minutes = Math.floor((end - start) / 60000);
  return minutes > 0 ? minutes : 0;        // guard against clock skew / negative ranges
}

/** Sum of tracked minutes across all completed entries. */
export function totalTrackedMinutes(entries: readonly TimeEntryLike[] | null | undefined): number {
  if (!entries || entries.length === 0) return 0;
  return entries.reduce((sum, e) => sum + entryDurationMinutes(e), 0);
}
