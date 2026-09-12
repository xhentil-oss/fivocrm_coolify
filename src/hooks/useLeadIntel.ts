import { useMemo } from 'react';
import type { Lead } from '../types';
import { leadTemperature, leadSla } from '../lib/leadIntel';
import { calculateLeadScore } from '../lib/leadScore';
import { resolveFollowUpConfig } from '../lib/crm/followUpConfig';
import { useTeamSettingsData } from './useTeamSettings';

export type LeadIntel = {
  score: number;
  temperature: ReturnType<typeof leadTemperature>;
  sla: ReturnType<typeof leadSla>;
};

/**
 * P1.1 / P3 — compute score/temperature/SLA ONCE per lead per snapshot (memoized
 * Map keyed by lead id), instead of recomputing inside sort comparators and per
 * row/card on every render. Returns the map plus per-lead getters with fallbacks
 * (optimistic-status clones keep the same id, so the map still resolves them).
 */
export function useLeadIntel(leads: Lead[] | null | undefined) {
  // SLA / stale thresholds are tenant settings (Cilësimet → Automatizime →
  // Ndjekja); until the doc arrives the defaults apply, same as the cron.
  const settings = useTeamSettingsData();
  const cfg = useMemo(() => resolveFollowUpConfig(settings), [settings]);

  const leadIntelMap = useMemo(() => {
    const map = new Map<string, LeadIntel>();
    for (const l of leads || []) {
      map.set(l.id, {
        score: (l as any).score ?? calculateLeadScore(l),
        temperature: leadTemperature(l),
        sla: leadSla(l, cfg),
      });
    }
    return map;
  }, [leads, cfg]);

  const getScore = (l: Lead) => leadIntelMap.get(l.id)?.score ?? (l as any).score ?? calculateLeadScore(l);
  const getTemp = (l: Lead) => leadIntelMap.get(l.id)?.temperature ?? leadTemperature(l);
  const getSla = (l: Lead) => leadIntelMap.get(l.id)?.sla ?? leadSla(l, cfg);

  return { leadIntelMap, getScore, getTemp, getSla };
}
