import React, { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Building2, Search, Users, LogIn, Loader2, ArrowUpDown, AlertTriangle, TrendingUp, Clock, Plus } from 'lucide-react';
import { Card } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Input } from '../../components/ui/input';
import { Button } from '../../components/ui/button';
import { useCollection } from '../../hooks/useFirestore';
import { useToast } from '../../hooks/use-toast';
import { getTimestampMs } from '../../lib/utils';
import {
  platformStats, tenantMrr, daysUntil, tenantHealth, lastSeenLabel, attentionList, HEALTH_META,
} from '../../lib/platformAdmin';
import PlatformTrend from './PlatformTrend';
import TenantAttentionList from './TenantAttentionList';
import CreateTenantDialog from './CreateTenantDialog';
import { syncTenantClaims } from '../../lib/tenantClaims';
import { setTenantOverride } from '../../lib/platformContext';
import { STATUS_META, PLAN_LABEL, fmtDate } from './tenantMeta';
import type { Business } from '../../types';

/**
 * Platform overview — every FivoCRM tenant, the money they represent, and the ones
 * that need attention. The row is a link into the tenant's admin page; "Hyr" is the
 * audited context switch into their workspace.
 *
 * All three reads here are deliberately cross-tenant (`skipBusinessFilter`) — this is
 * the console, the only surface allowed to look outside the active business.
 */

type SortKey = 'created' | 'name' | 'mrr' | 'members' | 'activity';

const PlatformDashboard: React.FC = () => {
  const { toast } = useToast();
  const navigate = useNavigate();
  // ONE cross-tenant read. This used to also pull every tenant's `teamMembers` and
  // `teams` on each page view — thousands of documents at scale, including staff salary
  // fields — purely to show a member count and find a team to enter. Both now come
  // denormalised on the business (maintained by tenant-usage-rollup + accept-invite).
  const { data: businesses, loading } = useCollection<Business>('businesses', { skipTeamFilter: true });

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [sortKey, setSortKey] = useState<SortKey>('created');
  const [entering, setEntering] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const stats = useMemo(() => platformStats(businesses || []), [businesses]);
  const attention = useMemo(() => attentionList((businesses || []) as any), [businesses]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = (businesses || []).filter(b => {
      if (statusFilter !== 'all' && (b.status || 'trialing') !== statusFilter) return false;
      if (!q) return true;
      return (b.name || '').toLowerCase().includes(q) || (b.ownerEmail || '').toLowerCase().includes(q);
    });
    const by: Record<SortKey, (a: Business, b: Business) => number> = {
      created: (a, b) => getTimestampMs(b.createdAt) - getTimestampMs(a.createdAt),
      name: (a, b) => (a.name || '').localeCompare(b.name || '', 'sq'),
      mrr: (a, b) => tenantMrr(b) - tenantMrr(a),
      members: (a, b) => (b.memberCount || 0) - (a.memberCount || 0),
      // Stalest first: the tenants most likely to churn are the ones to look at.
      activity: (a, b) => getTimestampMs(a.usage?.lastActivityAt) - getTimestampMs(b.usage?.lastActivityAt),
    };
    return [...list].sort(by[sortKey]);
  }, [businesses, search, statusFilter, sortKey]);

  /**
   * Enter a tenant's workspace ("view as tenant").
   *
   * Order matters: mint the claims FIRST (server-side, super-admin only, audited as
   * `claims.impersonate`), and only pin the UI override once the token really carries
   * the new `bid`. The other way round the app would scope its reads to a tenant the
   * token has no claim for, and every listener would fail permission-denied.
   */
  const enterTenant = async (biz: Business) => {
    if (entering) return;
    setEntering(biz.id);
    try {
      // `defaultTeamId` is maintained by the rollup; without it the console would have
      // to read every tenant's teams just to enter one.
      const teamId = biz.defaultTeamId || null;
      const claims = await syncTenantClaims({ teamId, businessId: biz.id });
      if (!claims || claims.bid !== biz.id) {
        throw new Error('Serveri nuk e ndryshoi kontekstin. Dil dhe hyr sërish, pastaj provo përsëri.');
      }
      setTenantOverride({ businessId: biz.id, teamId, name: biz.name || 'Tenant' });
      navigate('/app/dashboard');
    } catch (err: any) {
      toast({ title: 'Hyrja dështoi', description: err?.message || 'Provo përsëri.', variant: 'destructive' });
    } finally {
      setEntering(null);
    }
  };

  const tiles = [
    { label: 'MRR', value: `€${stats.mrr.toLocaleString('sq-AL')}`, sub: `ARR €${stats.arr.toLocaleString('sq-AL')}`, Icon: TrendingUp },
    { label: 'Tenantë aktivë', value: String(stats.active), sub: `${stats.total} gjithsej`, Icon: Building2 },
    { label: 'Në provë', value: String(stats.trialing), sub: `${stats.trialsEndingSoon} mbarojnë brenda 7 ditësh`, Icon: Clock },
    { label: 'Kërkojnë vëmendje', value: String(stats.pastDue + stats.suspended), sub: `${stats.pastDue} pa paguar · ${stats.suspended} pezulluar`, Icon: AlertTriangle },
  ];

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl font-bold mb-1">Tenantët</h1>
          <p className="text-sm text-muted-foreground">Klientët e FivoCRM dhe gjendja e tyre komerciale.</p>
        </div>
        {/* Sales-assisted onboarding — a tenant no longer has to come through /signup. */}
        <Button size="sm" onClick={() => setCreating(true)} className="flex-shrink-0">
          <Plus className="h-3.5 w-3.5 mr-1.5" /> Krijo tenant
        </Button>
      </div>

      <CreateTenantDialog open={creating} onOpenChange={setCreating} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        {tiles.map(({ label, value, sub, Icon }) => (
          <Card key={label} className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Icon className="h-3.5 w-3.5" />
              <span className="text-xs">{label}</span>
            </div>
            <p className="text-2xl font-bold leading-tight">{value}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>
          </Card>
        ))}
      </div>

      {/* Growth over time (platformMetrics) — the question the tiles above cannot answer. */}
      <PlatformTrend />

      {/* Who to act on today: commercial state crossed with real engagement. */}
      <TenantAttentionList items={attention} />

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Kërko tenant ose owner…" className="pl-9" />
        </div>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="h-9 px-2 rounded-md border border-border bg-background text-sm"
          aria-label="Filtro sipas statusit"
        >
          <option value="all">Të gjitha statuset</option>
          {Object.entries(STATUS_META).map(([key, m]) => <option key={key} value={key}>{m.label}</option>)}
        </select>
        <button
          onClick={() => setSortKey(k => (k === 'created' ? 'mrr' : k === 'mrr' ? 'members' : k === 'members' ? 'activity' : k === 'activity' ? 'name' : 'created'))}
          className="h-9 px-3 flex items-center gap-1.5 rounded-md border border-border text-sm hover:bg-accent"
        >
          <ArrowUpDown className="h-3.5 w-3.5" />
          {{ created: 'Më të rinjtë', mrr: 'MRR', members: 'Anëtarë', activity: 'Më të qetët', name: 'Emri' }[sortKey]}
        </button>
      </div>

      <Card className="divide-y divide-border/60">
        {loading && <p className="p-6 text-center text-sm text-muted-foreground">Po ngarkohet…</p>}
        {!loading && rows.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">Asnjë tenant.</p>}
        {rows.map(b => {
          const meta = STATUS_META[b.status || ''] || { label: b.status || '—', cls: 'bg-muted text-muted-foreground' };
          const trialLeft = b.status === 'trialing' ? daysUntil(b.trialEndsAt) : null;
          const mrr = tenantMrr(b);
          const health = tenantHealth(b);
          return (
            <div key={b.id} className="flex items-center gap-3 p-4 hover:bg-accent/40 transition-colors">
              <Link to={`/superadmin/tenants/${b.id}`} className="flex items-center gap-3 min-w-0 flex-1">
                <div className="h-9 w-9 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                  <Building2 className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-sm truncate flex items-center gap-1.5">
                    {/* Engagement at a glance: paying and silent is the expensive case. */}
                    <span
                      className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${HEALTH_META[health].dot}`}
                      title={`${HEALTH_META[health].label} · aktiviteti i fundit: ${lastSeenLabel(b.usage?.lastActivityAt)}`}
                    />
                    <span className="truncate">{b.name || 'Pa emër'}</span>
                  </p>
                  <p className="text-xs text-muted-foreground truncate">{b.ownerEmail || '—'}</p>
                </div>
                <div className="hidden sm:flex items-center gap-1.5 text-xs text-muted-foreground w-14" title="Anëtarë aktivë">
                  <Users className="h-3.5 w-3.5" /> {b.memberCount ?? '—'}
                </div>
                <div className="hidden md:block text-xs w-20">{PLAN_LABEL[b.plan || 'trial'] || b.plan}</div>
                <div className="hidden md:block text-xs text-muted-foreground w-16 tabular-nums">
                  {mrr ? `€${mrr}` : '—'}
                </div>
                <div className={`hidden lg:block text-xs w-28 ${HEALTH_META[health].cls}`} title="Aktiviteti i fundit">
                  {lastSeenLabel(b.usage?.lastActivityAt)}
                </div>
                <div className="hidden xl:block text-xs text-muted-foreground w-24">{fmtDate(b.createdAt)}</div>
                <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
                  <Badge className={`${meta.cls} border-0 text-[10px]`}>{meta.label}</Badge>
                  {trialLeft !== null && (
                    <span className={`text-[10px] ${trialLeft < 0 ? 'text-destructive' : trialLeft <= 7 ? 'text-amber-600' : 'text-muted-foreground'}`}>
                      {trialLeft < 0 ? `skadoi ${-trialLeft}d më parë` : `${trialLeft}d provë`}
                    </span>
                  )}
                </div>
              </Link>
              <button
                onClick={() => enterTenant(b)}
                disabled={entering === b.id}
                className="h-7 px-2 flex items-center gap-1 rounded-md text-[11px] font-medium border border-border hover:bg-accent text-muted-foreground hover:text-foreground flex-shrink-0 disabled:opacity-50"
                title={`Hyr në hapësirën e ${b.name || 'këtij tenanti'}`}
              >
                {entering === b.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <LogIn className="h-3 w-3" />}
                <span className="hidden sm:inline">Hyr</span>
              </button>
            </div>
          );
        })}
      </Card>
    </div>
  );
};

export default PlatformDashboard;
