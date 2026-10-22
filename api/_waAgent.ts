/**
 * Which Baileys agent sends an AUTOMATED WhatsApp for this business, and through
 * which VPS — one answer for invoice reminders, campaigns, evergreen rules and any
 * future cron sender.
 *
 * A team is a DEPARTMENT inside the business, and the WhatsApp number often lives
 * on another one (e.g. "Ekipi i Shitjeve" while the invoice / campaign belongs to
 * "Ekipi Social Media"). The VPS refuses a teamId that has no agent of its own, so
 * a teamId-only send failed for every such record. The agent is therefore resolved
 * HERE, from `whatsappAccounts`, and must belong to the record's BUSINESS (the
 * tenant boundary); the caller then sends with the AGENT's id + the AGENT's
 * teamId, which the VPS re-checks.
 *
 * Ranking (lower wins): (connected ? 0 : 2) + (same team ? 0 : 1). A configured
 * (preferred) agent wins only when it is connected — a dead preferred number used
 * to swallow every reminder while a live one sat next to it. Legacy accounts
 * written before `businessId` was stamped are included when their `teamId`
 * belongs to the business.
 */
import { adminDb as db } from './_firebaseAdmin.js';
import { getTeamConfig } from './_tenantConfig.js';
import { pickWaAgent, isConnectedWaStatus, type WaAgentRef } from './_waSend.js';

// The pure ranking lives in _waSend.ts (import-free of Firestore, unit-tested).
export { pickWaAgent, isConnectedWaStatus, type WaAgentRef } from './_waSend.js';

export interface WaRelay {
  vpsUrl: string;
  vpsSecret: string;
}

/**
 * Per-run resolver with caches (one read of the business's accounts, one config
 * read per team). Pass the job's own team-settings getter to share its cache.
 */
export function makeWaAgentResolver(getTeamSettings?: (teamId: string) => Promise<any>) {
  const agentsByBusiness = new Map<string, WaAgentRef[]>();
  const cfgCache = new Map<string, any>();
  const settingsFor = async (teamId: string): Promise<any> => {
    if (!teamId) return null;
    if (getTeamSettings) return getTeamSettings(teamId);
    if (cfgCache.has(teamId)) return cfgCache.get(teamId);
    const cfg = await getTeamConfig(teamId).catch(() => null);
    cfgCache.set(teamId, cfg);
    return cfg;
  };

  const agentsFor = async (businessId: string): Promise<WaAgentRef[]> => {
    const cached = agentsByBusiness.get(businessId);
    if (cached) return cached;
    const byId = new Map<string, any>();
    try {
      const snap = await db.collection('whatsappAccounts').where('businessId', '==', businessId).get();
      snap.docs.forEach((d) => byId.set(d.id, d.data()));
      // Legacy rows without businessId: find them through the business's teams.
      const teams = await db.collection('teams').where('businessId', '==', businessId).get();
      const teamIds = teams.docs.map((d) => d.id);
      for (let i = 0; i < teamIds.length; i += 30) {
        const chunk = teamIds.slice(i, i + 30);
        const legacy = await db.collection('whatsappAccounts').where('teamId', 'in', chunk).get();
        legacy.docs.forEach((d) => {
          const data = d.data() as any;
          // Never adopt an account stamped with ANOTHER business.
          if (!data.businessId || data.businessId === businessId) byId.set(d.id, data);
        });
      }
    } catch (e) {
      console.error('[waAgent] whatsappAccounts lookup failed', (e as Error)?.message || e);
    }
    const list: WaAgentRef[] = [...byId.entries()]
      .filter(([, a]) => a.enabled !== false && typeof a.teamId === 'string' && a.teamId)
      .map(([id, a]) => ({ id, teamId: a.teamId as string, connected: isConnectedWaStatus(a.connectionStatus) }));
    agentsByBusiness.set(businessId, list);
    return list;
  };

  return {
    agentsFor,
    async resolve(businessId: string | null | undefined, teamId: string | null | undefined, preferredId?: string | null): Promise<WaAgentRef | null> {
      if (!businessId) return null;
      return pickWaAgent(await agentsFor(businessId), teamId, preferredId);
    },
    /**
     * VPS credentials: the record's team → the agent's team (same business, same
     * VPS) → the platform env (`WHATSAPP_VPS_URL` / `WHATSAPP_VPS_SECRET`, the
     * names api/whatsapp.ts and api/_waInbound.ts use).
     */
    async relayFor(teamId: string | null | undefined, agentTeamId: string | null | undefined): Promise<WaRelay> {
      for (const t of [teamId, agentTeamId]) {
        if (!t) continue;
        const s = await settingsFor(t);
        if (s?.whatsappVpsUrl && s?.whatsappVpsSecret) return { vpsUrl: String(s.whatsappVpsUrl), vpsSecret: String(s.whatsappVpsSecret) };
      }
      return { vpsUrl: process.env.WHATSAPP_VPS_URL || '', vpsSecret: process.env.WHATSAPP_VPS_SECRET || '' };
    },
  };
}
