import type { Lead } from '../types';
import { getTimestampMs } from './utils';

// SLA / staleness thresholds (kept in sync with the cron in api/cron/run.ts).
export const SLA_FIRST_RESPONSE_HOURS = 24;
export const STALE_DAYS = 14;

export type Temperature = 'hot' | 'warm' | 'cold';

/** Most recent signal of activity on a lead (activity log, follow-up, or update). */
export function leadLastActivityMs(lead: Lead): number {
  return Math.max(
    getTimestampMs((lead as any).lastActivityAt) || 0,
    getTimestampMs(lead.lastFollowUpDate) || 0,
    getTimestampMs(lead.updatedAt) || 0,
  );
}

/**
 * Live engagement temperature derived from recency, stage, value and quality
 * score. Lost/Converted are always cold. Recomputed in the UI (not stored).
 */
export function leadTemperature(lead: Lead): Temperature {
  if (lead.status === 'Lost' || lead.status === 'Converted') return 'cold';
  const lastMs = leadLastActivityMs(lead);
  const days = lastMs ? (Date.now() - lastMs) / 86_400_000 : Infinity;
  let pts = 0;
  if (days <= 2) pts += 3; else if (days <= 7) pts += 2; else if (days <= 14) pts += 1;
  if (lead.status === 'Proposal' || lead.status === 'Qualified') pts += 2;
  else if (lead.status === 'Contacted' || lead.status === 'Follow-up') pts += 1;
  if ((lead.estimatedValue || 0) >= 5000) pts += 1;
  if ((lead.score || 0) >= 70) pts += 1;
  return pts >= 4 ? 'hot' : pts >= 2 ? 'warm' : 'cold';
}

/** SLA breach (no first response in time) + staleness (no recent activity). */
export function leadSla(lead: Lead): { breached: boolean; stale: boolean } {
  if (lead.status === 'Lost' || lead.status === 'Converted') return { breached: false, stale: false };
  const createdMs = getTimestampMs(lead.createdAt) || 0;
  const hoursSinceCreated = createdMs ? (Date.now() - createdMs) / 3_600_000 : 0;
  const breached = !lead.firstResponseAt && hoursSinceCreated > SLA_FIRST_RESPONSE_HOURS;
  const lastMs = leadLastActivityMs(lead);
  const staleDays = lastMs ? (Date.now() - lastMs) / 86_400_000 : Infinity;
  const stale = staleDays > STALE_DAYS;
  return { breached, stale };
}

export const TEMP_META: Record<Temperature, { label: string; emoji: string; className: string }> = {
  hot:  { label: 'I nxehtë',  emoji: '🔥', className: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300' },
  warm: { label: 'I ngrohtë', emoji: '🌤️', className: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300' },
  cold: { label: 'I ftohtë',  emoji: '❄️', className: 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300' },
};
