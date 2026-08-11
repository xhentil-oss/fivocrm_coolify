import type { Deal, DealStage } from '../types';
import { toAll, currencySymbol } from './utils';

export const DEAL_STAGES: { key: DealStage; label: string; prob: number; color: string; accent: string }[] = [
  { key: 'Qualification', label: 'Kualifikim', prob: 25, color: 'bg-blue-500',     accent: 'border-l-blue-400' },
  { key: 'Proposal',      label: 'Propozim',   prob: 50, color: 'bg-amber-500',    accent: 'border-l-amber-400' },
  { key: 'Negotiation',   label: 'Negocim',    prob: 75, color: 'bg-navy-700',   accent: 'border-l-navy-700' },
  { key: 'Won',           label: 'Fituar',     prob: 100, color: 'bg-emerald-600', accent: 'border-l-emerald-500' },
  { key: 'Lost',          label: 'Humbur',     prob: 0,  color: 'bg-red-500',      accent: 'border-l-red-400' },
];

export const OPEN_STAGES: DealStage[] = ['Qualification', 'Proposal', 'Negotiation'];

const PROB: Record<string, number> = Object.fromEntries(DEAL_STAGES.map(s => [s.key, s.prob]));

export function dealProbability(d: Pick<Deal, 'stage' | 'probability'>): number {
  return d.probability ?? PROB[d.stage] ?? 0;
}

export function dealWeighted(d: Pick<Deal, 'stage' | 'probability' | 'amount'>): number {
  return (d.amount || 0) * dealProbability(d) / 100;
}

// Currency-normalized variants (→ ALL) for aggregating mixed-currency deals.
// Per-deal cards keep their own currency; only totals/KPIs must normalize.
export function dealAmountAll(d: Pick<Deal, 'amount' | 'currency'>): number {
  return toAll(d.amount || 0, d.currency);
}

export function dealWeightedAll(d: Pick<Deal, 'stage' | 'probability' | 'amount' | 'currency'>): number {
  return dealAmountAll(d) * dealProbability(d) / 100;
}

export function stageLabel(stage: string): string {
  return DEAL_STAGES.find(s => s.key === stage)?.label || stage;
}

export function curSymbol(currency?: string): string {
  return currencySymbol(currency);
}
