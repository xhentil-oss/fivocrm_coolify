import type { Lead } from '../types';
import { getTimestampMs } from './utils';
import { calculateLeadScore } from './leadScore';
import { DEFAULT_FOLLOW_UP_CONFIG, type FollowUpConfig } from './crm/followUpConfig';

// SLA / staleness thresholds now come from `teamSettings` through
// `resolveFollowUpConfig()` (src/lib/crm/followUpConfig.ts, mirrored by
// api/_followUpConfig.ts for the cron). The constants below are the DEFAULTS only.
/** @deprecated use `resolveFollowUpConfig(settings).followUpSlaHours` */
export const SLA_FIRST_RESPONSE_HOURS = DEFAULT_FOLLOW_UP_CONFIG.followUpSlaHours;
/** @deprecated use `resolveFollowUpConfig(settings).followUpStaleDays` */
export const STALE_DAYS = DEFAULT_FOLLOW_UP_CONFIG.followUpStaleDays;

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
export function leadTemperature(lead: Lead, score?: number): Temperature {
  if (lead.status === 'Lost' || lead.status === 'Converted') return 'cold';
  const lastMs = leadLastActivityMs(lead);
  const days = lastMs ? (Date.now() - lastMs) / 86_400_000 : Infinity;
  // Prefer the resolved score passed by the caller (useLeadIntel) so temperature
  // matches the score shown in the UI. When absent, resolve it the SAME way the UI
  // does (stored score ?? computed) instead of silently treating it as 0.
  const resolvedScore = score ?? lead.score ?? calculateLeadScore(lead);
  let pts = 0;
  if (days <= 2) pts += 3; else if (days <= 7) pts += 2; else if (days <= 14) pts += 1;
  if (lead.status === 'Proposal' || lead.status === 'Qualified') pts += 2;
  else if (lead.status === 'Contacted' || lead.status === 'Follow-up') pts += 1;
  if ((lead.estimatedValue || 0) >= 5000) pts += 1;
  if (resolvedScore >= 70) pts += 1;
  return pts >= 4 ? 'hot' : pts >= 2 ? 'warm' : 'cold';
}

/**
 * SLA breach (no first response in time) + staleness (no recent activity).
 * `cfg` is the tenant's resolved thresholds; callers without settings at hand
 * get the defaults. Mirrored by `runLeadSlaAndStaleAlerts` in api/cron/run.ts.
 */
export function leadSla(
  lead: Lead,
  cfg: Pick<FollowUpConfig, 'followUpSlaHours' | 'followUpStaleDays'> = DEFAULT_FOLLOW_UP_CONFIG,
): { breached: boolean; stale: boolean } {
  if (lead.status === 'Lost' || lead.status === 'Converted') return { breached: false, stale: false };
  const createdMs = getTimestampMs(lead.createdAt) || 0;
  const hoursSinceCreated = createdMs ? (Date.now() - createdMs) / 3_600_000 : 0;
  const breached = !lead.firstResponseAt && hoursSinceCreated > cfg.followUpSlaHours;
  const lastMs = leadLastActivityMs(lead);
  const staleDays = lastMs ? (Date.now() - lastMs) / 86_400_000 : Infinity;
  const stale = staleDays > cfg.followUpStaleDays;
  return { breached, stale };
}

export const TEMP_META: Record<Temperature, { label: string; emoji: string; className: string }> = {
  hot:  { label: 'I nxehtë',  emoji: '🔥', className: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300' },
  warm: { label: 'I ngrohtë', emoji: '🌤️', className: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300' },
  cold: { label: 'I ftohtë',  emoji: '❄️', className: 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300' },
};
