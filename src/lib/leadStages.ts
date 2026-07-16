import type { Lead } from '../types';

/**
 * Single source of truth for CRM lead stages — labels (sq-AL), probability,
 * board/funnel colors and accents. Previously duplicated (and inconsistent)
 * across PipelineBoard, CRMView (STAGE_PROBABILITY + getStatusLabel) and
 * LeadAnalytics. Mirrors the proven src/lib/dealStages.ts pattern.
 */
export type LeadStatus =
  | 'New' | 'Contacted' | 'Qualified' | 'Follow-up'
  | 'Proposal' | 'Won' | 'Converted' | 'Lost';

export const LEAD_STAGES: {
  key: LeadStatus;
  label: string;
  prob: number;
  color: string;   // solid bg for funnel/badges
  accent: string;  // left-border accent for board columns/cards
  kind: 'open' | 'won' | 'lost';
}[] = [
  { key: 'New',       label: 'I Ri',        prob: 10,  color: 'bg-blue-500',    accent: 'border-l-blue-400',    kind: 'open' },
  { key: 'Contacted', label: 'Kontaktuar',  prob: 20,  color: 'bg-navy-700',    accent: 'border-l-navy-700',    kind: 'open' },
  { key: 'Qualified', label: 'Kualifikuar', prob: 40,  color: 'bg-green-500',   accent: 'border-l-green-500',   kind: 'open' },
  { key: 'Proposal',  label: 'Propozim',    prob: 70,  color: 'bg-orange-500',  accent: 'border-l-orange-400',  kind: 'open' },
  { key: 'Follow-up', label: 'Në Ndjekje',  prob: 30,  color: 'bg-amber-500',   accent: 'border-l-yellow-500',  kind: 'open' },
  { key: 'Won',       label: 'Fituar',      prob: 100, color: 'bg-emerald-600', accent: 'border-l-emerald-600', kind: 'won' },
  { key: 'Converted', label: 'Konvertuar',  prob: 100, color: 'bg-emerald-600', accent: 'border-l-emerald-600', kind: 'won' },
  { key: 'Lost',      label: 'Humbur',      prob: 0,   color: 'bg-red-500',     accent: 'border-l-red-400',     kind: 'lost' },
];

// Columns shown on the Kanban pipeline board. Won/Lost are terminal states set
// via the lead drawer (Converted = closed-won), so they are not board columns.
export const PIPELINE_STAGES = LEAD_STAGES.filter(
  s => s.key !== 'Won' && s.key !== 'Lost'
);

// Selectable statuses in the table/drawer status dropdown (includes Lost, excludes Won).
export const SELECTABLE_STATUSES = LEAD_STAGES.filter(s => s.key !== 'Won');

// Open (in-flight) statuses — for analytics, SLA/stale filters and cron scoping.
export const OPEN_STATUSES: LeadStatus[] = LEAD_STAGES
  .filter(s => s.kind === 'open')
  .map(s => s.key);

const PROB: Record<string, number> = Object.fromEntries(LEAD_STAGES.map(s => [s.key, s.prob]));

export function leadStageProbability(lead: Pick<Lead, 'status' | 'probability'>): number {
  return lead.probability ?? PROB[lead.status] ?? 0;
}

export function leadStageLabel(status: string): string {
  return LEAD_STAGES.find(s => s.key === status)?.label || status;
}

export function leadStageMeta(status: string) {
  return LEAD_STAGES.find(s => s.key === status);
}
