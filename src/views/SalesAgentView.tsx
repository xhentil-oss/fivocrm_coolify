/**
 * /app/sales-agent — Ana, the virtual sales agent (module `sales-agent`).
 *
 * Tabs (?tab=): today · prospects · conversations · settings. The page shows what
 * the agent did, where a human is needed, the Google Maps prospect inbox and the
 * owner's settings. Every write that sends, registers or hands off goes through
 * `salesAgentApi()` → POST /api/sales-agent; the browser never writes a run doc,
 * a prospect's status transition to `registered`, or `conversation.agent.*`.
 */
import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Bot, Hand, Search, Settings, Sun } from 'lucide-react';
import { Badge } from '../components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { usePermissions } from '../contexts/PermissionsContext';
import { useGlobalTeamId } from '../hooks/useFirestore';
import { useTeamSettingsData } from '../hooks/useTeamSettings';
import { AUTONOMY_LABELS, resolveSalesAgentSettings } from '../lib/salesAgent/core';
import TodayTab from '../components/salesAgent/TodayTab';
import ProspectsTab from '../components/salesAgent/ProspectsTab';
import ConversationsTab from '../components/salesAgent/ConversationsTab';
import AgentSettingsPanel from '../components/salesAgent/AgentSettingsPanel';

const TABS = ['today', 'prospects', 'conversations', 'settings'] as const;
type Tab = typeof TABS[number];

export default function SalesAgentView() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const tab: Tab = (TABS as readonly string[]).includes(tabParam || '') ? (tabParam as Tab) : 'today';
  const { isAdmin, isOwner, isSuperAdmin, isManager, teamId: permTeamId } = usePermissions();
  const globalTeamId = useGlobalTeamId();
  const teamId = permTeamId || globalTeamId;
  const settings = useTeamSettingsData();
  const agent = useMemo(() => resolveSalesAgentSettings(settings?.salesAgent), [settings?.salesAgent]);
  const canEditSettings = !!(isAdmin || isOwner || isSuperAdmin);
  const canAct = !!(isAdmin || isOwner || isSuperAdmin || isManager);
  const [usage, setUsage] = useState<{ repliesToday: number; placesRequestsMonth: number }>({ repliesToday: 0, placesRequestsMonth: 0 });
  const onUsage = useCallback((u: { repliesToday: number; placesRequestsMonth: number }) => setUsage(u), []);

  const setTab = (t: string) => {
    const next = new URLSearchParams(searchParams);
    if (t === 'today') next.delete('tab'); else next.set('tab', t);
    setSearchParams(next, { replace: true });
  };

  const lastRun = (settings?.salesAgent as any)?.lastRun as Record<string, unknown> | undefined;

  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center"><Bot className="w-5 h-5" /></div>
          <div>
            <h1 className="text-xl font-semibold leading-tight">{agent.persona.name} — agjentja e shitjeve</h1>
            <p className="text-xs text-muted-foreground">
              {agent.enabled ? <>Niveli {agent.autonomy}: {AUTONOMY_LABELS[agent.autonomy].label}</> : 'E fikur'}
              {agent.persona.businessName ? ` · ${agent.persona.businessName}` : ''}
            </p>
          </div>
        </div>
        <Badge className={agent.enabled ? 'bg-emerald-100 text-emerald-800 border-0' : 'bg-muted text-muted-foreground border-0'}>{agent.enabled ? 'Aktive' : 'E fikur'}</Badge>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="w-full sm:w-auto grid grid-cols-4 sm:inline-flex">
          <TabsTrigger value="today" className="gap-1.5"><Sun className="w-4 h-4" /><span className="hidden sm:inline">Sot</span></TabsTrigger>
          <TabsTrigger value="prospects" className="gap-1.5"><Search className="w-4 h-4" /><span className="hidden sm:inline">Prospektet</span></TabsTrigger>
          <TabsTrigger value="conversations" className="gap-1.5"><Hand className="w-4 h-4" /><span className="hidden sm:inline">Bisedat</span></TabsTrigger>
          <TabsTrigger value="settings" className="gap-1.5"><Settings className="w-4 h-4" /><span className="hidden sm:inline">Cilësimet</span></TabsTrigger>
        </TabsList>

        <TabsContent value="today" className="mt-4">
          <TodayTab enabled={agent.enabled} personaName={agent.persona.name} canEnable={canEditSettings} teamId={teamId}
            lastRun={lastRun} dailyReplyCap={agent.dailyReplyCap} placesBudget={agent.placesMonthlyBudget} onUsage={onUsage} />
        </TabsContent>
        <TabsContent value="prospects" className="mt-4">
          <ProspectsTab canEdit={canAct} coldWaEnabled={agent.coldWa.enabled} placesUsed={usage.placesRequestsMonth} placesBudget={agent.placesMonthlyBudget} />
        </TabsContent>
        <TabsContent value="conversations" className="mt-4">
          <ConversationsTab personaName={agent.persona.name} canAct={canAct} />
        </TabsContent>
        <TabsContent value="settings" className="mt-4">
          <AgentSettingsPanel teamId={teamId} settings={settings} canEdit={canEditSettings} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
