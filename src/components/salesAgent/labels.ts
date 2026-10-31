import type { AgentStage, ColdWaBlockReason, HandoffReason, SalesAgentBlockReason } from '../../lib/salesAgent/core';
import { COLD_WA_BLOCK_LABELS, HANDOFF_LABELS, SALES_AGENT_BLOCK_LABELS } from '../../lib/salesAgent/core';
import type { ProspectSearchStatus, ProspectStatus } from '../../types';

export const STAGE_LABELS: Record<AgentStage, string> = {
  greeting: 'Përshëndetje',
  qualifying: 'Kualifikim',
  proposing: 'Propozim',
  booking: 'Rezervim takimi',
  handoff: 'Dorëzuar ekipit',
  closed: 'Mbyllur',
};

export const STAGE_BADGE_CLASS: Record<AgentStage, string> = {
  greeting: 'bg-sky-100 text-sky-800 border-0',
  qualifying: 'bg-indigo-100 text-indigo-800 border-0',
  proposing: 'bg-violet-100 text-violet-800 border-0',
  booking: 'bg-emerald-100 text-emerald-800 border-0',
  handoff: 'bg-amber-100 text-amber-800 border-0',
  closed: 'bg-muted text-muted-foreground border-0',
};

export const PROSPECT_STATUS_LABELS: Record<ProspectStatus, string> = {
  new: 'Për shqyrtim',
  approved: 'Aprovuar',
  rejected: 'Refuzuar',
  registered: 'Lead',
  duplicate: 'Dublikatë',
};

export const PROSPECT_STATUS_CLASS: Record<ProspectStatus, string> = {
  new: 'bg-sky-100 text-sky-800 border-0',
  approved: 'bg-indigo-100 text-indigo-800 border-0',
  rejected: 'bg-muted text-muted-foreground border-0',
  registered: 'bg-emerald-100 text-emerald-800 border-0',
  duplicate: 'bg-amber-100 text-amber-800 border-0',
};

export const SEARCH_STATUS_LABELS: Record<ProspectSearchStatus, string> = {
  queued: 'Në radhë',
  running: 'Duke kërkuar',
  done: 'Përfunduar',
  failed: 'Dështoi',
};

export const SEARCH_STATUS_CLASS: Record<ProspectSearchStatus, string> = {
  queued: 'bg-sky-100 text-sky-800 border-0',
  running: 'bg-indigo-100 text-indigo-800 border-0',
  done: 'bg-emerald-100 text-emerald-800 border-0',
  failed: 'bg-red-100 text-red-800 border-0',
};

/** Any reason key the run log may carry → Albanian. Unknown keys render as themselves. */
export function reasonLabel(key: string | null | undefined): string {
  if (!key) return '—';
  return (SALES_AGENT_BLOCK_LABELS as Record<string, string>)[key as SalesAgentBlockReason]
    || (HANDOFF_LABELS as Record<string, string>)[key as HandoffReason]
    || (COLD_WA_BLOCK_LABELS as Record<string, string>)[key as ColdWaBlockReason]
    || key;
}

export const DECISION_LABELS: Record<string, string> = {
  send: 'U dërgua',
  draft: 'Draft për një person',
  handoff: 'Dorëzim ekipit',
  silent: 'Heshtje',
  blocked: 'Bllokuar',
};

export function minutesSince(v: unknown, now = Date.now()): number | null {
  const d = v instanceof Date ? v : (v as any)?.toDate?.() instanceof Date ? (v as any).toDate() : typeof v === 'number' ? new Date(v) : null;
  if (!d) return null;
  return Math.max(0, Math.round((now - d.getTime()) / 60_000));
}

export function durationLabel(minutes: number | null): string {
  if (minutes === null) return '';
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  if (h < 48) return `${h} orë`;
  return `${Math.floor(h / 24)} ditë`;
}
