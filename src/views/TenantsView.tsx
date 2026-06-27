import React, { useMemo, useState } from 'react';
import { useCollection } from '../hooks/useFirestore';
import { usePermissions } from '../contexts/PermissionsContext';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../hooks/use-toast';
import { Card } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Building2, Search, Users, ShieldX, Loader2, Layers } from 'lucide-react';
import { getTimestampMs } from '../lib/utils';
import { setupBusinessLayer } from '../lib/businessMigration';
import type { Team, TeamMember, Business } from '../types';

// Super-admin "Relax CRM" panel: lists every tenant (team) — i.e. FivoCRM's own
// customers — across all workspaces. Read-only for now: editing a tenant's
// plan/status needs a server-side super-admin claim (Firestore rules only let a
// team's owner write its doc), which arrives with billing (Phase 4).

const statusMeta: Record<string, { label: string; cls: string }> = {
  trialing: { label: 'Provë', cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  active: { label: 'Aktiv', cls: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' },
  past_due: { label: 'Pa paguar', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
  suspended: { label: 'Pezulluar', cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' },
  canceled: { label: 'Anuluar', cls: 'bg-gray-200 text-gray-600 dark:bg-gray-800 dark:text-gray-400' },
};

const fmtDate = (d: any) => {
  const ms = getTimestampMs(d);
  return ms ? new Date(ms).toLocaleDateString('sq-AL', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
};

const TenantsView: React.FC = () => {
  const permissions = usePermissions();
  const { user } = useAuth();
  const { toast } = useToast();
  const { data: teams } = useCollection<Team>('teams', { skipTeamFilter: true });
  const { data: members } = useCollection<TeamMember>('teamMembers', { skipTeamFilter: true });
  const { data: businesses } = useCollection<Business>('businesses', { skipTeamFilter: true });
  const [search, setSearch] = useState('');
  const [migrating, setMigrating] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [backfillProgress, setBackfillProgress] = useState('');

  const linkedTeams = useMemo(() => (teams || []).filter(t => (t as any).businessId).length, [teams]);

  const runPhase1 = async () => {
    if (!user || migrating) return;
    setMigrating(true);
    try {
      const r = await setupBusinessLayer(user.uid, user.email || '');
      toast({
        title: 'Faza 1 u krye',
        description: `Biznesi ${r.businessCreated ? 'u krijua' : 'ekzistonte'}; ${r.teamsLinked}/${r.teamsTotal} ekipe u lidhën si departamente.`,
      });
    } catch (err: any) {
      toast({ title: 'Migrimi dështoi', description: err?.message || 'Provo përsëri.', variant: 'destructive' });
    } finally {
      setMigrating(false);
    }
  };

  const runPhase2 = async () => {
    if (backfilling || !user) return;
    setBackfilling(true);
    setBackfillProgress('po nis…');
    try {
      // Server-side (Admin SDK) bypasses Firestore rules. Process ONE collection per
      // request (client loops) so no single call hits the serverless timeout (504).
      const token = await user.getIdToken(true);
      const call = async (col: string) => {
        const res = await fetch(`/api/cron/run?job=backfill-businessid&manual=1&col=${encodeURIComponent(col)}`, {
          method: 'GET', headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `Gabim serveri (${res.status})`);
        if (data.error) throw new Error(data.error);
        return data;
      };
      const list = (await call('__list__')).collections as string[];
      let totalUpdated = 0;
      const failed: string[] = [];
      for (let i = 0; i < list.length; i++) {
        const col = list[i];
        setBackfillProgress(`${col} (${i + 1}/${list.length})`);
        try {
          const r = (await call(col)).results?.[0];
          if (r?.updated === -1) failed.push(col);
          else totalUpdated += r?.updated || 0;
        } catch { failed.push(col); }
      }
      toast({
        title: 'Faza 2 u krye (server)',
        description: `${totalUpdated} dokumente u stampuan me businessId${failed.length ? ` · dështuan: ${failed.join(', ')}` : ' · pa dështime'}.`,
      });
    } catch (err: any) {
      toast({ title: 'Backfill dështoi', description: err?.message || 'Provo përsëri.', variant: 'destructive' });
    } finally {
      setBackfilling(false);
      setBackfillProgress('');
    }
  };

  const memberCount = useMemo(() => {
    const m = new Map<string, number>();
    (members || []).forEach(x => {
      if (x.teamId && x.status === 'Active') m.set(x.teamId, (m.get(x.teamId) || 0) + 1);
    });
    return m;
  }, [members]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (teams || [])
      .filter(t => !q || (t.name || '').toLowerCase().includes(q) || ((t as any).ownerEmail || '').toLowerCase().includes(q))
      .sort((a, b) => getTimestampMs(b.createdAt) - getTimestampMs(a.createdAt));
  }, [teams, search]);

  const stats = useMemo(() => {
    const s = { total: (teams || []).length, trialing: 0, active: 0, other: 0 };
    (teams || []).forEach(t => {
      const st = (t as any).status;
      if (st === 'trialing') s.trialing++;
      else if (st === 'active') s.active++;
      else s.other++;
    });
    return s;
  }, [teams]);

  // Route is also gated, but guard here too.
  if (!permissions.isSuperAdmin) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center text-center">
        <ShieldX className="h-16 w-16 text-destructive mb-4" />
        <h2 className="text-2xl font-bold mb-2">Akses i Kufizuar</h2>
        <p className="text-muted-foreground">Vetëm super-admin mund të shohë tenant-ët.</p>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-3 mb-1">
        <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
          <Building2 className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-bold">Relax CRM</h1>
          <p className="text-sm text-muted-foreground">Klientët e FivoCRM — të gjithë tenant-ët</p>
        </div>
      </div>

      {/* Phase 1 migration — Business layer setup (additive, idempotent) */}
      <Card className="p-4 my-5 border-primary/20 bg-primary/[0.03]">
        <div className="flex items-start gap-3">
          <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
            <Layers className="h-4 w-4 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm">Faza 1 — Shtresa e Biznesit (Business &gt; Ekip)</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Krijon biznesin e agjencisë dhe lidh ekipet e tua si departamente (vendos <code>businessId</code>).
              Shtesë &amp; idempotent — s'ndryshon sjellje. {(businesses?.length || 0) > 0 && `${businesses?.length} biznes(e), `}{linkedTeams}/{teams?.length || 0} ekipe të lidhura.
            </p>
          </div>
          <Button size="sm" onClick={runPhase1} disabled={migrating} className="flex-shrink-0">
            {migrating ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> Po ekzekuton…</> : 'Ekzekuto Fazën 1'}
          </Button>
        </div>

        <div className="flex items-start gap-3 mt-4 pt-4 border-t border-border/50">
          <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
            <Layers className="h-4 w-4 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm">Faza 2 — Backfill i të dhënave</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Stampon <code>businessId</code> te çdo dokument sipas <code>teamId</code> → biznesit të ekipit.
              Të dhënat e departamenteve konsolidohen nën biznesin. Idempotent. {backfilling && backfillProgress && <span className="text-primary">Po përpunon: {backfillProgress}…</span>}
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={runPhase2} disabled={backfilling || migrating} className="flex-shrink-0">
            {backfilling ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> Po ekzekuton…</> : 'Ekzekuto Fazën 2'}
          </Button>
        </div>
      </Card>

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 my-5">
        {([['Gjithsej', stats.total], ['Provë', stats.trialing], ['Aktiv', stats.active], ['Të tjerë', stats.other]] as const).map(([label, val]) => (
          <Card key={label} className="p-4">
            <p className="text-2xl font-bold">{val}</p>
            <p className="text-xs text-muted-foreground">{label}</p>
          </Card>
        ))}
      </div>

      {/* Search */}
      <div className="relative mb-4 max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Kërko tenant ose owner..." className="pl-9" />
      </div>

      {/* List */}
      <Card className="divide-y divide-border/60">
        {rows.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">Asnjë tenant.</p>}
        {rows.map(t => {
          const st = (t as any).status as string | undefined;
          const meta = (st && statusMeta[st]) || { label: st || '—', cls: 'bg-muted text-muted-foreground' };
          return (
            <div key={t.id} className="flex items-center gap-3 p-4">
              <div className="h-9 w-9 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                <Building2 className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm truncate">{t.name || 'Pa emër'}</p>
                <p className="text-xs text-muted-foreground truncate">{(t as any).ownerEmail || '—'}</p>
              </div>
              <div className="hidden sm:flex items-center gap-1.5 text-xs text-muted-foreground w-20">
                <Users className="h-3.5 w-3.5" /> {memberCount.get(t.id) || 0}
              </div>
              <div className="hidden md:block text-xs text-muted-foreground w-28">{(t as any).plan || 'trial'}</div>
              <div className="hidden lg:block text-xs text-muted-foreground w-28">{fmtDate(t.createdAt)}</div>
              <Badge className={`${meta.cls} border-0 text-[10px] flex-shrink-0`}>{meta.label}</Badge>
            </div>
          );
        })}
      </Card>

      <p className="text-[11px] text-muted-foreground/60 mt-4">
        Vetëm-lexim. Menaxhimi i planit/statusit aktivizohet me billing-un (kërkon claim super-admin server-side).
      </p>
    </div>
  );
};

export default TenantsView;
