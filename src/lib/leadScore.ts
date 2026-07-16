import type { Lead } from '../types';

/**
 * Lead scoring: 0–100 based on data completeness & value.
 * Pure function extracted from CRMView (P3 step 1) so it can be reused and tested.
 */
export function calculateLeadScore(lead: Partial<Lead> & Record<string, any>): number {
  let score = 0;
  if (lead.name) score += 10;
  if (lead.email) score += 15;
  if (lead.phoneNumber || lead.phone) score += 10;
  if (lead.company) score += 15;
  if (lead.website) score += 5;
  if (lead.source) score += 5;
  if (lead.estimatedValue && lead.estimatedValue > 0) {
    score += Math.min(30, Math.round(lead.estimatedValue / 1000) * 5);
  }
  if (lead.lastFollowUpDate) score += 10;
  return Math.min(100, score);
}
