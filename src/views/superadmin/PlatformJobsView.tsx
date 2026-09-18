import React, { useMemo, useState } from 'react';
import { Layers, Loader2, ShieldX, BarChart3, History } from 'lucide-react';
import { Card } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../hooks/use-toast';
import { useCollection } from '../../hooks/useFirestore';
import { setupBusinessLayer } from '../../lib/businessMigration';
import type { Team, Business } from '../../types';

/**
 * Platform maintenance jobs — the migration/backfill runners that used to sit on top
 * of the tenant list. They are one-off or rarely-run operations over the WHOLE
 * platform, which is why they live in the console and not in any tenant's workspace.
 *
 * Every job is super-admin gated server-side and idempotent, so re-running is safe.
 */
const PlatformJobsView: React.FC = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  // Counts shown in the Phase 1 card. Cross-tenant on purpose (see TenantsView notes).
  const { data: teams } = useCollection<Team>('teams', { skipTeamFilter: true, skipBusinessFilter: true });
  const { data: businesses } = useCollection<Business>('businesses', { skipTeamFilter: true });

  const [migrating, setMigrating] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [backfillProgress, setBackfillProgress] = useState('');
  const [claiming, setClaiming] = useState(false);
  const [portalBackfilling, setPortalBackfilling] = useState(false);
  const [cidBackfilling, setCidBackfilling] = useState(false);
  const [cidProgress, setCidProgress] = useState('');
  const [hardeningJob, setHardeningJob] = useState<string | null>(null);
  const [analyticsJob, setAnalyticsJob] = useState<string | null>(null);
  /**
   * Every hardening/analytics job accepts `dryRun=1` server-side (it reports what it
   * WOULD change and writes nothing) — but until now the UI had no way to send it, so
   * the safe option existed and was unreachable.
   */
  const [dryRun, setDryRun] = useState(false);
  const [compBackfilling, setCompBackfilling] = useState(false);

  const linkedTeams = useMemo(() => (teams || []).filter(t => (t as any).businessId).length, [teams]);

  /** Fire-and-report a single cron job. Force-refreshes the token so a freshly
   *  granted super-admin claim is present on the request. */
  const runJob = async (job: string, label: string, describe: (data: any) => string) => {
    if (!user) return;
    try {
      const token = await user.getIdToken(true);
      const res = await fetch(`/api/cron/run?job=${job}&manual=1${dryRun ? '&dryRun=1' : ''}`, {
        method: 'GET', headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || `Gabim serveri (${res.status})`);
      toast({
        title: dryRun ? `${label} — provë (pa shkrime)` : `${label} u krye`,
        description: describe(data) || 'Pa ndryshime.',
      });
    } catch (err: any) {
      toast({ title: `${label} dështoi`, description: err?.message || 'Provo përsëri.', variant: 'destructive' });
    }
  };

  /**
   * Tenant-hardening migrations. Order matters on a first run:
   *   tenant-hierarchy → backfill-tenant-keys → migrate-team-secrets → sync-tenant-claims
   */
  const runHardeningJob = async (job: string, label: string) => {
    if (hardeningJob) return;
    setHardeningJob(job);
    await runJob(job, label, (data) => {
      const r = data.result || data;
      return [
        r.attached !== undefined && `${r.attached} ekipe u lidhën me biznes`,
        r.businessesCreated ? `${r.businessesCreated} biznese të krijuara` : null,
        r.subdomains !== undefined && `${r.subdomains} subdomain-e`,
        r.totalUpdated !== undefined && `${r.totalUpdated} dokumente u stampuan`,
        r.teamsTouched !== undefined && `${r.teamsTouched} ekipe · ${r.tokensMoved || 0} token-e në kasafortë`,
        r.synced !== undefined && `${r.synced}/${r.users} përdorues me claims`,
      ].filter(Boolean).join(' · ');
    });
    setHardeningJob(null);
  };

  /** Console analytics jobs (improvements #2 and #3) — read-only rollups, safe to re-run. */
  const runAnalyticsJob = async (job: string, label: string, describe: (r: any) => string) => {
    if (analyticsJob) return;
    setAnalyticsJob(job);
    await runJob(job, label, (data) => describe(data.result || data));
    setAnalyticsJob(null);
  };

  /**
   * Resumable backfill: each call processes a time-budgeted chunk and returns what is
   * left, so we loop until done. Completed collections are skipped, which means
   * resuming costs no extra reads (this matters on a quota-limited project).
   */
  const runResumableBackfill = async (
    job: string,
    label: string,
    setBusy: (v: boolean) => void,
    setProgress: (v: string) => void,
  ) => {
    if (!user) return;
    setBusy(true);
    setProgress('po nis…');
    try {
      const token = await user.getIdToken(true);
      let totalUpdated = 0;
      const failedSet = new Set<string>();
      let remaining: string[] = [];
      let guard = 0;
      let quotaHit = false;
      let prevRemaining = Infinity;
      do {
        const res = await fetch(`/api/cron/run?job=${job}&manual=1`, {
          method: 'GET', headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (!res.ok || data.error) {
          if (String(data.error || '').includes('RESOURCE_EXHAUSTED') || res.status === 401) { quotaHit = true; break; }
          throw new Error(data.error || `Gabim serveri (${res.status})`);
        }
        totalUpdated += data.totalUpdated || 0;
        (data.results || []).filter((r: any) => r.updated === -1)
          .forEach((r: any) => failedSet.add(`${r.collection}${r.error ? `: ${r.error}` : ''}`));
        remaining = data.remaining || [];
        setProgress(`${data.completed}/${data.total} koleksione · mbetur ${remaining.length}`);
        // Stop if a pass made no progress (a collection keeps erroring) — avoids
        // hammering a stuck/quota-limited collection 25× in a row.
        if (remaining.length >= prevRemaining) break;
        prevRemaining = remaining.length;
      } while (remaining.length > 0 && ++guard < 25);

      if (quotaHit) {
        toast({
          title: 'Kuota e Firestore u rraskapit',
          description: 'Progresi u ruajt. Vazhdo pas reset-it ditor ose kalo te plani Blaze.',
          variant: 'destructive',
        });
      } else {
        toast({
          title: `${label} u krye`,
          description: `${totalUpdated} dokumente u stampuan${failedSet.size ? ` · dështuan: ${[...failedSet].join(', ')}` : ' · pa dështime'}.`,
        });
      }
    } catch (err: any) {
      toast({ title: `${label} dështoi`, description: err?.message || 'Provo përsëri.', variant: 'destructive' });
    } finally {
      setBusy(false);
      setProgress('');
    }
  };

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

  const Row: React.FC<{ icon: React.ReactNode; title: string; children: React.ReactNode; actions: React.ReactNode; first?: boolean }> =
    ({ icon, title, children, actions, first }) => (
      <div className={`flex items-start gap-3 ${first ? '' : 'mt-4 pt-4 border-t border-border/50'}`}>
        <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">{icon}</div>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm">{title}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{children}</p>
        </div>
        <div className="flex flex-col gap-1.5 flex-shrink-0">{actions}</div>
      </div>
    );

  const spin = <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />;

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <h1 className="text-xl font-bold mb-1">Punët e platformës</h1>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <p className="text-sm text-muted-foreground max-w-xl">
          Migrime dhe backfill-e mbi të gjithë platformën. Të gjitha janë idempotente — ri-ekzekutimi është i sigurt.
        </p>
        <label
          className={`flex items-center gap-2 text-xs px-3 py-1.5 rounded-md border cursor-pointer select-none transition-colors ${
            dryRun ? 'border-amber-400 bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200' : 'border-border text-muted-foreground hover:text-foreground'
          }`}
          title="Ekzekuto pa shkruar asgjë — raporton vetëm çfarë do të ndryshonte"
        >
          <input type="checkbox" checked={dryRun} onChange={e => setDryRun(e.target.checked)} className="h-3.5 w-3.5" />
          Provë (dryRun)
        </label>
      </div>

      <Card className="p-4">
        <Row
          first
          icon={<Layers className="h-4 w-4 text-primary" />}
          title="Faza 1 — Shtresa e Biznesit (Business > Ekip)"
          actions={
            <Button size="sm" onClick={runPhase1} disabled={migrating}>
              {migrating ? <>{spin} Po ekzekuton…</> : 'Ekzekuto Fazën 1'}
            </Button>
          }
        >
          Krijon biznesin e agjencisë dhe lidh ekipet e tua si departamente (vendos <code>businessId</code>).
          Shtesë &amp; idempotent — s'ndryshon sjellje. {(businesses?.length || 0) > 0 && `${businesses?.length} biznes(e), `}
          {linkedTeams}/{teams?.length || 0} ekipe të lidhura.
        </Row>

        <Row
          icon={<Layers className="h-4 w-4 text-primary" />}
          title="Faza 2 — Backfill i të dhënave"
          actions={
            <Button
              size="sm"
              variant="outline"
              onClick={() => runResumableBackfill('backfill-businessid', 'Faza 2', setBackfilling, setBackfillProgress)}
              disabled={backfilling || migrating}
            >
              {backfilling ? <>{spin} Po ekzekuton…</> : 'Ekzekuto Fazën 2'}
            </Button>
          }
        >
          Stampon <code>businessId</code> te çdo dokument sipas <code>teamId</code> → biznesit të ekipit.
          Idempotent. {backfilling && backfillProgress && <span className="text-primary">Po përpunon: {backfillProgress}…</span>}
        </Row>

        <Row
          icon={<Layers className="h-4 w-4 text-primary" />}
          title="Pagat — kalimi te teamMemberComp"
          actions={
            <Button
              size="sm"
              variant="outline"
              disabled={compBackfilling}
              onClick={async () => {
                setCompBackfilling(true);
                await runJob('backfill-member-compensation', 'Backfill i pagave', (d) =>
                  `${d.written} të shkruara · ${d.skippedExisting} ekzistuese · ${d.skippedNoPay} pa pagë`
                  + (d.errors?.length ? ` · ${d.errors.length} gabime` : ''));
                setCompBackfilling(false);
              }}
            >
              {compBackfilling ? <>{spin} Po ekzekuton…</> : 'Ekzekuto backfill-in'}
            </Button>
          }
        >
          Kopjon <code>monthlySalary</code>, <code>salaryHistory</code> dhe <code>hourlyCostRate</code> nga
          <code>teamMembers</code> te <code>teamMemberComp</code>, të cilin e lexon vetëm vetë personi dhe një
          admin i atij biznesi. Fushat e vjetra NUK preken — leximi është i dyfishtë, ndaj shifrat duhet të
          mbeten identike. Idempotent. <strong>Pas ekzekutimit</strong>: hap Financat për një muaj pa pagesa
          rroge të regjistruara dhe kontrollo që shifra e pagave nuk ndryshoi. Vetëm atëherë mund të fshihen
          fushat e vjetra dhe të shtrëngohet rregulli i <code>teamMembers</code>.
        </Row>

        <Row
          icon={<Layers className="h-4 w-4 text-primary" />}
          title="Faza 4 — RLS server-side (parakushtet)"
          actions={
            <>
              <Button
                size="sm"
                variant="outline"
                disabled={claiming}
                onClick={async () => {
                  setClaiming(true);
                  await runJob('set-superadmin-claim', 'Claim', () => 'Dil dhe hyr sërish që të aktivizohet.');
                  setClaiming(false);
                }}
              >
                {claiming ? <>{spin} …</> : 'Vendos claim-in'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={portalBackfilling}
                onClick={async () => {
                  setPortalBackfilling(true);
                  await runJob('backfill-portal-customerid', 'Portal backfill',
                    (d) => `${d.updated}/${d.total} klientë portali u lidhën me customerId.`);
                  setPortalBackfilling(false);
                }}
              >
                {portalBackfilling ? <>{spin} …</> : 'Backfill portali'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={cidBackfilling}
                onClick={() => runResumableBackfill('backfill-customerid', 'Backfill customerId', setCidBackfilling, setCidProgress)}
              >
                {cidBackfilling ? <>{spin} …</> : 'Backfill customerId'}
              </Button>
            </>
          }
        >
          Vendos custom claim-in server-side që rregullat e shtrënguara të mos të bllokojnë (pas kësaj: <strong>dil dhe hyr sërish</strong>).
          "Backfill customerId" stampon child-records (invoiceItems/tasks/komente) që portali të mos prishet.
          {cidBackfilling && cidProgress && <span className="text-primary"> Po përpunon: {cidProgress}…</span>}
        </Row>

        <Row
          icon={<ShieldX className="h-4 w-4 text-primary" />}
          title="Izolimi enterprise — migrimet (ekzekuto me radhë)"
          actions={
            <>
              {([
                ['tenant-hierarchy', '1. Hierarkia'],
                ['backfill-tenant-keys', '2. Çelësat'],
                ['migrate-team-secrets', '3. Kasaforta'],
                ['sync-tenant-claims', '4. Claims'],
              ] as const).map(([job, label]) => (
                <Button key={job} size="sm" variant="outline" onClick={() => runHardeningJob(job, label)} disabled={!!hardeningJob}>
                  {hardeningJob === job ? <>{spin} …</> : label}
                </Button>
              ))}
            </>
          }
        >
          1) <strong>Hierarkia</strong>: çdo ekip brenda një biznesi real + harta publike e subdomain-eve.
          2) <strong>Çelësat</strong>: businessId në channels/userProfiles/portal-access.
          3) <strong>Kasaforta</strong>: kredencialet nga teamSettings → teamSecrets (klienti nuk i lexon më).
          4) <strong>Claims</strong>: bid/tid/roles në token-in e çdo anëtari (pas kësaj: <strong>dil dhe hyr sërish</strong>).
          Pastaj deploy-o rregullat — hapat në workspace/TENANT_ISOLATION_ENTERPRISE.md.
        </Row>

        <Row
          icon={<BarChart3 className="h-4 w-4 text-primary" />}
          title="Analitika e platformës"
          actions={
            <>
              <Button
                size="sm" variant="outline" disabled={!!analyticsJob}
                onClick={() => runAnalyticsJob('tenant-usage-rollup', 'Aktiviteti', (r) =>
                  `${r.updated}/${r.tenants} tenantë u matën`)}
              >
                {analyticsJob === 'tenant-usage-rollup' ? <>{spin} …</> : 'Mat aktivitetin'}
              </Button>
              <Button
                size="sm" variant="outline" disabled={!!analyticsJob}
                onClick={() => runAnalyticsJob('platform-metrics-rollup', 'Metrikat', (r) =>
                  `${(r.months || []).length} muaj u shkruan`)}
              >
                {analyticsJob === 'platform-metrics-rollup' ? <>{spin} …</> : 'Rifresko trendin'}
              </Button>
              <Button
                size="sm" variant="outline" disabled={!!analyticsJob}
                onClick={() => runAnalyticsJob('platform-metrics-rollup&backfill=1', 'Historiku', (r) =>
                  `${(r.months || []).length} muaj u rindërtuan`)}
              >
                {analyticsJob === 'platform-metrics-rollup&backfill=1' ? <>{spin} …</> : 'Rindërto historikun'}
              </Button>
            </>
          }
        >
          <strong>Mat aktivitetin</strong>: shkruan `businesses.usage` (aktiviteti i fundit, përdorues
          aktivë 7d, numërime dokumentesh me `count()`), që lista e tenantëve të tregojë shëndetin.
          <strong> Rifresko trendin</strong>: rillogarit muajin aktual në `platformMetrics`.
          <strong> Rindërto historikun</strong>: rikthen të gjithë muajt nga datat e regjistrimit/
          aktivizimit/anulimit — ekzekutohu një herë pas instalimit. Të dyja punët ekzekutohen
          automatikisht çdo ditë brenda `run-all`.
        </Row>
      </Card>

      <JobRunHistory />
    </div>
  );
};

/**
 * The last runs, from `platformJobRuns` (append-only, super-admin readable).
 * A toast answers "did it work?" for five seconds; this answers "when did the migration
 * run, who ran it, and what did it change?" — which is the question you actually have.
 */
const JobRunHistory: React.FC = () => {
  const { data: runs, loading, error } = useCollection<any>('platformJobRuns', {
    skipTeamFilter: true,
    skipBusinessFilter: true,
  });

  const rows = useMemo(() => {
    return [...(runs || [])]
      .sort((a, b) => (b.createdAt?.getTime?.() || 0) - (a.createdAt?.getTime?.() || 0))
      .slice(0, 25);
  }, [runs]);

  if (loading || error) return null;

  return (
    <Card className="p-4 mt-4">
      <div className="flex items-center gap-2 mb-3">
        <History className="h-4 w-4 text-primary" />
        <h2 className="font-semibold text-sm">Historiku i ekzekutimeve</h2>
        <span className="text-xs text-muted-foreground">{rows.length ? `${rows.length} të fundit` : ''}</span>
      </div>

      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Asnjë ekzekutim i regjistruar ende. Çdo punë (manuale ose cron) shkruan një zë këtu.
        </p>
      ) : (
        <div className="divide-y divide-border/60">
          {rows.map(r => (
            <div key={r.id} className="py-2 flex items-center gap-2 text-xs">
              <span className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${r.ok ? 'bg-green-500' : 'bg-red-500'}`} />
              <span className="font-mono truncate max-w-[38%]">{r.job}</span>
              {r.dryRun && <Badge variant="outline" className="text-[10px]">provë</Badge>}
              {!r.manual && <Badge variant="outline" className="text-[10px]">cron</Badge>}
              <span className="text-muted-foreground truncate flex-1">
                {r.ok
                  ? Object.entries(r.summary || {}).slice(0, 4).map(([k, v]) => `${k}: ${v}`).join(' · ')
                  : (r.error || 'dështoi')}
              </span>
              <span className="text-muted-foreground tabular-nums flex-shrink-0">
                {Math.round((r.durationMs || 0) / 100) / 10}s
              </span>
              <span className="text-muted-foreground flex-shrink-0 hidden sm:inline">
                {r.createdAt instanceof Date ? r.createdAt.toLocaleString('sq-AL') : ''}
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
};

export default PlatformJobsView;
