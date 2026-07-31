import React, { useMemo, useState } from 'react';
import { Layers, Loader2, ShieldX } from 'lucide-react';
import { Card } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
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

  const linkedTeams = useMemo(() => (teams || []).filter(t => (t as any).businessId).length, [teams]);

  /** Fire-and-report a single cron job. Force-refreshes the token so a freshly
   *  granted super-admin claim is present on the request. */
  const runJob = async (job: string, label: string, describe: (data: any) => string) => {
    if (!user) return;
    try {
      const token = await user.getIdToken(true);
      const res = await fetch(`/api/cron/run?job=${job}&manual=1`, {
        method: 'GET', headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || `Gabim serveri (${res.status})`);
      toast({ title: `${label} u krye`, description: describe(data) || 'Pa ndryshime.' });
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
      <p className="text-sm text-muted-foreground mb-5">
        Migrime dhe backfill-e mbi të gjithë platformën. Të gjitha janë idempotente — ri-ekzekutimi është i sigurt.
      </p>

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
      </Card>
    </div>
  );
};

export default PlatformJobsView;
