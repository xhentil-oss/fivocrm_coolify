import React, { useMemo, useState } from 'react';
import { useCollection } from '../hooks/useFirestore';
import { usePermissions } from '../contexts/PermissionsContext';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../hooks/use-toast';
import { Card } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Building2, Search, Users, ShieldX, Loader2, Layers, SlidersHorizontal } from 'lucide-react';
import { doc, updateDoc, Timestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { getTimestampMs } from '../lib/utils';
import { setupBusinessLayer } from '../lib/businessMigration';
import type { Team, TeamMember, Business } from '../types';

// Modules that the super-admin can enable/disable per tenant (nav path → label).
const TOGGLEABLE_MODULES: { path: string; label: string }[] = [
  { path: '/app/projects', label: 'Projektet' },
  { path: '/app/crm', label: 'CRM Leads' },
  { path: '/app/deals', label: 'Marrëveshjet' },
  { path: '/app/customers', label: 'Klientët' },
  { path: '/app/tasks', label: 'Detyrat' },
  { path: '/app/goals', label: 'Objektivat' },
  { path: '/app/services', label: 'Shërbimet' },
  { path: '/app/invoices', label: 'Faturat' },
  { path: '/app/contracts', label: 'Kontratat' },
  { path: '/app/expenses', label: 'Shpenzimet' },
  { path: '/app/time-tracking', label: 'Orari' },
  { path: '/app/chat', label: 'Chat' },
  { path: '/app/whatsapp', label: 'WhatsApp' },
  { path: '/app/reports', label: 'Raportet' },
  { path: '/app/workload', label: 'Ngarkesa' },
  { path: '/app/price-calculator', label: 'Kalkulatori' },
  { path: '/app/landing-pages', label: 'Landing Pages' },
  { path: '/app/bonus', label: 'Bonuset' },
];

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
  // Cross-tenant: the platform console must see members across ALL businesses, so
  // it explicitly opts out of business scoping (the only place this is allowed).
  const { data: members } = useCollection<TeamMember>('teamMembers', { skipTeamFilter: true, skipBusinessFilter: true });
  const { data: businesses } = useCollection<Business>('businesses', { skipTeamFilter: true });
  const [search, setSearch] = useState('');
  const [migrating, setMigrating] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [backfillProgress, setBackfillProgress] = useState('');
  const [claiming, setClaiming] = useState(false);
  const [portalBackfilling, setPortalBackfilling] = useState(false);

  const runPortalBackfill = async () => {
    if (portalBackfilling || !user) return;
    setPortalBackfilling(true);
    try {
      const token = await user.getIdToken(true);
      const res = await fetch('/api/cron/run?job=backfill-portal-customerid&manual=1', {
        method: 'GET', headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || `Gabim (${res.status})`);
      toast({ title: 'Portal backfill u krye', description: `${data.updated}/${data.total} klientë portali u lidhën me customerId.` });
    } catch (err: any) {
      toast({ title: 'Dështoi', description: err?.message || 'Provo përsëri.', variant: 'destructive' });
    } finally {
      setPortalBackfilling(false);
    }
  };

  const runSetClaim = async () => {
    if (claiming || !user) return;
    setClaiming(true);
    try {
      const token = await user.getIdToken(true);
      const res = await fetch('/api/cron/run?job=set-superadmin-claim&manual=1', {
        method: 'GET', headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || `Gabim (${res.status})`);
      toast({ title: 'Claim u vendos', description: 'Dil dhe hyr sërish që të aktivizohet. Pastaj mund të shtrëngojmë rregullat.' });
    } catch (err: any) {
      toast({ title: 'Dështoi', description: err?.message || 'Provo përsëri.', variant: 'destructive' });
    } finally {
      setClaiming(false);
    }
  };

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
      // Resumable backfill (Admin SDK): each call processes a time-budgeted chunk and
      // returns what's left; loop until done. Completed collections are skipped, so
      // resuming costs no extra reads (matters on a quota-limited project).
      const token = await user.getIdToken(true);
      let totalUpdated = 0;
      const failedSet = new Set<string>();
      let remaining: string[] = [];
      let guard = 0;
      let quotaHit = false;
      let prevRemaining = Infinity;
      do {
        const res = await fetch('/api/cron/run?job=backfill-businessid&manual=1', {
          method: 'GET', headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (!res.ok || data.error) {
          if (String(data.error || '').includes('RESOURCE_EXHAUSTED') || res.status === 401) { quotaHit = true; break; }
          throw new Error(data.error || `Gabim serveri (${res.status})`);
        }
        totalUpdated += data.totalUpdated || 0;
        (data.results || []).filter((r: any) => r.updated === -1).forEach((r: any) => failedSet.add(`${r.collection}${r.error ? `: ${r.error}` : ''}`));
        remaining = data.remaining || [];
        setBackfillProgress(`${data.completed}/${data.total} koleksione · mbetur ${remaining.length}`);
        // Stop if a pass made no progress (a collection keeps erroring) — avoids
        // hammering a stuck/quota-limited collection 25× in a row.
        if (remaining.length >= prevRemaining) break;
        prevRemaining = remaining.length;
      } while (remaining.length > 0 && ++guard < 25);

      if (quotaHit) {
        toast({ title: 'Kuota e Firestore u rraskapit', description: 'Progresi u ruajt. Vazhdo pas reset-it ditor ose kalo te plani Blaze.', variant: 'destructive' });
      } else {
        toast({
          title: 'Faza 2 u krye (server)',
          description: `${totalUpdated} dokumente u stampuan${failedSet.size ? ` · dështuan: ${[...failedSet].join(', ')}` : ' · pa dështime'}.`,
        });
      }
    } catch (err: any) {
      toast({ title: 'Backfill dështoi', description: err?.message || 'Provo përsëri.', variant: 'destructive' });
    } finally {
      setBackfilling(false);
      setBackfillProgress('');
    }
  };

  // Members per business (members carry businessId after the Phase 2 backfill).
  const memberCount = useMemo(() => {
    const m = new Map<string, number>();
    (members || []).forEach(x => {
      const bid = (x as any).businessId;
      if (bid && x.status === 'Active') m.set(bid, (m.get(bid) || 0) + 1);
    });
    return m;
  }, [members]);

  // Tenants are BUSINESSES in the two-level model.
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (businesses || [])
      .filter(b => !q || (b.name || '').toLowerCase().includes(q) || (b.ownerEmail || '').toLowerCase().includes(q))
      .sort((a, b) => getTimestampMs(b.createdAt) - getTimestampMs(a.createdAt));
  }, [businesses, search]);

  const stats = useMemo(() => {
    const s = { total: (businesses || []).length, trialing: 0, active: 0, other: 0 };
    (businesses || []).forEach(b => {
      if (b.status === 'trialing') s.trialing++;
      else if (b.status === 'active') s.active++;
      else s.other++;
    });
    return s;
  }, [businesses]);

  const [expandedBiz, setExpandedBiz] = useState<string | null>(null);
  const toggleModule = async (biz: Business, path: string) => {
    const disabled = new Set(biz.disabledModules || []);
    if (disabled.has(path)) disabled.delete(path); else disabled.add(path);
    try {
      await updateDoc(doc(db, 'businesses', biz.id), { disabledModules: Array.from(disabled), updatedAt: Timestamp.now() });
    } catch (err: any) {
      toast({ title: 'Ndryshimi dështoi', description: err?.message || 'Provo përsëri.', variant: 'destructive' });
    }
  };

  // Assign this tenant's portal subdomain (<sub>.fivocrm.com/portal). Resolves
  // hostname → businessId so the tenant's clients register/scope to it.
  const saveSubdomain = async (biz: Business, raw: string) => {
    const sub = raw.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (sub === (biz.portalSubdomain || '')) return;
    try {
      await updateDoc(doc(db, 'businesses', biz.id), { portalSubdomain: sub || null, updatedAt: Timestamp.now() });
      toast({ title: 'Subdomain u ruajt', description: sub ? `${sub}.fivocrm.com/portal` : 'Subdomain u hoq.' });
    } catch (err: any) {
      toast({ title: 'Dështoi', description: err?.message || 'Provo përsëri.', variant: 'destructive' });
    }
  };

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

        <div className="flex items-start gap-3 mt-4 pt-4 border-t border-border/50">
          <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
            <Layers className="h-4 w-4 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm">Faza 4 — Aktivizo super-admin claim</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Vendos custom claim-in server-side që rregullat e shtrënguara të mos të bllokojnë. Pas kësaj: <strong>dil dhe hyr sërish</strong>.
            </p>
          </div>
          <div className="flex flex-col gap-1.5 flex-shrink-0">
            <Button size="sm" variant="outline" onClick={runSetClaim} disabled={claiming}>
              {claiming ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> …</> : 'Vendos claim-in'}
            </Button>
            <Button size="sm" variant="outline" onClick={runPortalBackfill} disabled={portalBackfilling}>
              {portalBackfilling ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> …</> : 'Backfill portali'}
            </Button>
          </div>
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
        {rows.map(b => {
          const st = b.status;
          const meta = (st && statusMeta[st]) || { label: st || '—', cls: 'bg-muted text-muted-foreground' };
          const disabled = new Set(b.disabledModules || []);
          const isExpanded = expandedBiz === b.id;
          return (
            <div key={b.id}>
              <div className="flex items-center gap-3 p-4">
                <div className="h-9 w-9 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                  <Building2 className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{b.name || 'Pa emër'}</p>
                  <p className="text-xs text-muted-foreground truncate">{b.ownerEmail || '—'}</p>
                </div>
                <div className="hidden sm:flex items-center gap-1.5 text-xs text-muted-foreground w-16">
                  <Users className="h-3.5 w-3.5" /> {memberCount.get(b.id) || 0}
                </div>
                <div className="hidden md:block text-xs text-muted-foreground w-24">{b.plan || 'trial'}</div>
                <div className="hidden lg:block text-xs text-muted-foreground w-24">{fmtDate(b.createdAt)}</div>
                <Badge className={`${meta.cls} border-0 text-[10px] flex-shrink-0`}>{meta.label}</Badge>
                <button
                  onClick={() => setExpandedBiz(isExpanded ? null : b.id)}
                  className="h-7 w-7 flex items-center justify-center rounded-md hover:bg-accent text-muted-foreground hover:text-foreground flex-shrink-0"
                  title="Modulet"
                >
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                </button>
              </div>
              {isExpanded && (
                <div className="px-4 pb-4 -mt-1">
                  <p className="text-[11px] text-muted-foreground mb-2">Modulet aktive për këtë tenant (kliko për të aktivizuar/çaktivizuar):</p>
                  <div className="flex flex-wrap gap-1.5">
                    {TOGGLEABLE_MODULES.map(m => {
                      const off = disabled.has(m.path);
                      return (
                        <button
                          key={m.path}
                          onClick={() => toggleModule(b, m.path)}
                          className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${
                            off
                              ? 'bg-muted text-muted-foreground border-border line-through'
                              : 'bg-primary/10 text-primary border-primary/20'
                          }`}
                        >
                          {m.label}
                        </button>
                      );
                    })}
                  </div>
                  <div className="mt-3 flex items-center gap-2 flex-wrap">
                    <span className="text-[11px] text-muted-foreground">Subdomain portali:</span>
                    <input
                      type="text"
                      defaultValue={b.portalSubdomain || ''}
                      placeholder="p.sh. acme"
                      onBlur={(e) => saveSubdomain(b, e.target.value)}
                      className="h-7 px-2 text-[11px] rounded border border-border bg-background w-28 focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                    <span className="text-[11px] text-muted-foreground">.fivocrm.com/portal</span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </Card>

      <p className="text-[11px] text-muted-foreground/60 mt-4">
        Kliko ikonën ⚙ te çdo tenant për të aktivizuar/çaktivizuar modulet. Plani/statusi menaxhohen me billing-un.
      </p>
    </div>
  );
};

export default TenantsView;
