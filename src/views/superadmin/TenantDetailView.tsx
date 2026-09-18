import React, { useMemo, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Building2, Loader2, LogIn, Save, Users, CreditCard, SlidersHorizontal,
  Globe, AlertTriangle, Download, Trash2, ShieldAlert, Activity,
  CalendarPlus, PauseCircle, PlayCircle, Mail, Bug,
} from 'lucide-react';
import { Card } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { useCollection, useDocument } from '../../hooks/useFirestore';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../hooks/use-toast';
import { doc, setDoc, updateDoc, deleteDoc, Timestamp } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import ModuleAccessEditor from './ModuleAccessEditor';
import {
  updateTenantPlan, setTenantModules, tenantMrr, daysUntil, tenantHealth, lastSeenLabel, HEALTH_META,
} from '../../lib/platformAdmin';
import { syncTenantClaims } from '../../lib/tenantClaims';
import { setTenantOverride } from '../../lib/platformContext';
import { STATUS_META, PLAN_LABEL, PLAN_SEATS, fmtDate, toDateInput } from './tenantMeta';
import type { Team, TeamMember, Business } from '../../types';

/**
 * One tenant, everything the platform can do to it.
 *
 * The commercial fields (plan/status/trial/seats) are NOT written from here straight
 * to Firestore even though the rules would allow a super-admin to: they go through
 * `POST /api/platform-admin`, which validates them against one list and records
 * before/after in the audit trail. Module toggles take the same path.
 */

const PLAN_KEYS = ['trial', 'starter', 'pro', 'business', 'enterprise'] as const;
const STATUS_KEYS = ['trialing', 'active', 'past_due', 'suspended', 'canceled'] as const;

const TenantDetailView: React.FC = () => {
  const { businessId = '' } = useParams();
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const { data: biz, loading } = useDocument<Business>('businesses', businessId);
  const { data: allTeams } = useCollection<Team>('teams', { skipTeamFilter: true, skipBusinessFilter: true });
  const { data: allMembers } = useCollection<TeamMember>('teamMembers', { skipTeamFilter: true, skipBusinessFilter: true });

  const teams = useMemo(() => (allTeams || []).filter((t: any) => t.businessId === businessId), [allTeams, businessId]);
  const members = useMemo(() => (allMembers || []).filter((m: any) => m.businessId === businessId), [allMembers, businessId]);
  const activeMembers = members.filter(m => m.status === 'Active').length;

  // Draft state for the plan form — only committed on "Ruaj".
  const [plan, setPlan] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  // Module path whose access is being written right now (spinner + no double-clicks).
  const [modulePending, setModulePending] = useState<string | null>(null);
  const [trialDate, setTrialDate] = useState<string | null>(null);
  const [seats, setSeats] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  // Fall back to the stored values until the operator edits a field.
  const planVal = plan ?? biz?.plan ?? 'trial';
  const statusVal = status ?? biz?.status ?? 'trialing';
  const trialVal = trialDate ?? toDateInput(biz?.trialEndsAt);
  const seatsVal = seats ?? (biz?.limits?.seats != null ? String(biz.limits.seats) : '');
  const dirty = plan !== null || status !== null || trialDate !== null || seats !== null;

  if (loading) {
    return <div className="p-10 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }
  if (!biz) {
    return (
      <div className="p-6 max-w-3xl mx-auto text-center">
        <p className="text-muted-foreground mb-3">Ky tenant nuk u gjet.</p>
        <Link to="/superadmin" className="text-primary hover:underline text-sm">Kthehu te lista</Link>
      </div>
    );
  }

  const meta = STATUS_META[biz.status || ''] || { label: biz.status || '—', cls: 'bg-muted text-muted-foreground' };
  const trialLeft = daysUntil(biz.trialEndsAt);
  const effectiveSeats = biz.limits?.seats ?? PLAN_SEATS[biz.plan || 'trial'] ?? 5;
  const disabled = new Set(biz.disabledModules || []);
  const health = tenantHealth(biz);

  const savePlan = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const res = await updateTenantPlan(businessId, {
        plan: planVal,
        status: statusVal,
        trialEndsAt: trialVal ? new Date(`${trialVal}T00:00:00`).toISOString() : null,
        seats: seatsVal.trim() === '' ? null : Number(seatsVal),
        note: note.trim() || undefined,
      });
      setPlan(null); setStatus(null); setTrialDate(null); setSeats(null); setNote('');
      toast({
        title: 'Paketa u ruajt',
        description: res.stripeManaged
          ? 'Kujdes: ky tenant ka abonim aktiv në Stripe — ngjarja e radhës e Stripe do ta rishkruajë planin.'
          : 'Ndryshimi u regjistrua në audit.',
        variant: res.stripeManaged ? 'destructive' : undefined,
      });
    } catch (err: any) {
      toast({ title: 'Ruajtja dështoi', description: err?.message || 'Provo përsëri.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const locked = new Set(biz.lockedModules || []);

  /** Write one of the two module layers through the audited endpoint. */
  const writeModules = async (
    path: string,
    patch: { lockedModules?: string[]; disabledModules?: string[] },
    done: string,
  ) => {
    if (modulePending) return;
    setModulePending(path);
    try {
      await setTenantModules(businessId, patch);
      toast({ title: done, description: 'Ndryshimi u regjistrua në audit.' });
    } catch (err: any) {
      toast({ title: 'Ndryshimi dështoi', description: err?.message || 'Provo përsëri.', variant: 'destructive' });
    } finally {
      setModulePending(null);
    }
  };

  /** Layer 1 — the platform withholds / grants a module. */
  const setLocked = (path: string, nextLocked: boolean) => {
    const next = new Set(locked);
    if (nextLocked) next.add(path); else next.delete(path);
    void writeModules(path, { lockedModules: Array.from(next) }, nextLocked ? 'Moduli u kyç' : 'Moduli u hap');
  };

  const replaceLocked = (next: Set<string>) => {
    void writeModules('*', { lockedModules: Array.from(next) }, 'Modulet u përditësuan');
  };

  /** Layer 2, as a support assist — clear the owner's own "off" for one module. */
  const enableForOwner = (path: string) => {
    const next = new Set(disabled);
    next.delete(path);
    void writeModules(path, { disabledModules: Array.from(next) }, 'Moduli u ndez për pronarin');
  };

  /**
   * Portal subdomain. Written directly (not via the endpoint) because it also has to
   * maintain `publicTenants/{subdomain}` — the minimal PUBLIC map the portal uses to
   * resolve <sub>.fivocrm.com → tenant without reading `businesses`.
   */
  const saveSubdomain = async (raw: string) => {
    const sub = raw.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (sub === (biz.portalSubdomain || '')) return;
    try {
      await updateDoc(doc(db, 'businesses', businessId), { portalSubdomain: sub || null, updatedAt: Timestamp.now() });
      const prev = (biz.portalSubdomain || '').trim().toLowerCase();
      if (prev && prev !== sub) await deleteDoc(doc(db, 'publicTenants', prev)).catch(() => { /* may not exist */ });
      if (sub) {
        await setDoc(doc(db, 'publicTenants', sub), {
          businessId, teamId: teams[0]?.id || null, name: biz.name || null, portalSubdomain: sub, updatedAt: Timestamp.now(),
        }, { merge: true });
      }
      toast({ title: 'Subdomain u ruajt', description: sub ? `${sub}.fivocrm.com/portal` : 'Subdomain u hoq.' });
    } catch (err: any) {
      toast({ title: 'Dështoi', description: err?.message || 'Provo përsëri.', variant: 'destructive' });
    }
  };

  /**
   * Quick actions — the operations an operator repeats all day. Each one previously
   * meant editing a field and pressing Ruaj (or leaving the app to find the customer in
   * Stripe), which is how mistakes happen on the wrong tenant.
   *
   * They go through the SAME audited endpoint as the form, so nothing here is a
   * shortcut around validation or the audit trail.
   */
  const quickAction = async (
    key: string,
    update: Parameters<typeof updateTenantPlan>[1],
    successTitle: string,
  ) => {
    if (busy) return;
    setBusy(key);
    try {
      await updateTenantPlan(businessId, update);
      toast({ title: successTitle, description: 'Ndryshimi u regjistrua në audit.' });
    } catch (err: any) {
      toast({ title: 'Dështoi', description: err?.message || 'Provo përsëri.', variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  const extendTrial = (days: number) => {
    // Extend from the CURRENT end date when it is still in the future, otherwise from
    // today — extending an expired trial by 7 days must mean "7 days from now".
    const current = biz.trialEndsAt instanceof Date ? biz.trialEndsAt : null;
    const base = current && current.getTime() > Date.now() ? current : new Date();
    const next = new Date(base.getTime() + days * 86_400_000);
    return quickAction(`trial-${days}`, {
      plan: biz.plan || 'trial',
      status: 'trialing',
      trialEndsAt: next.toISOString(),
      note: `+${days} ditë provë nga konsola`,
    }, `Provja u zgjat me ${days} ditë`);
  };

  /** Stripe dashboard link — test vs live decided by what the webhook recorded. */
  const stripeUrl = biz.stripeCustomerId
    ? `https://dashboard.stripe.com/${biz.stripeLivemode === false ? 'test/' : ''}customers/${biz.stripeCustomerId}`
    : null;

  // Sentry issues for THIS tenant only — possible because errors are tagged with the
  // businessId. Hidden unless the org/project are configured.
  const sentryOrg = import.meta.env.VITE_SENTRY_ORG as string | undefined;
  const sentryProject = import.meta.env.VITE_SENTRY_PROJECT as string | undefined;
  const sentryUrl = sentryOrg && sentryProject
    ? `https://${sentryOrg}.sentry.io/issues/?query=${encodeURIComponent(`tenant:${businessId}`)}&statsPeriod=14d`
    : null;

  const enterTenant = async () => {
    if (busy) return;
    setBusy('enter');
    try {
      const teamId = teams[0]?.id || null;
      const claims = await syncTenantClaims({ teamId, businessId });
      if (!claims || claims.bid !== businessId) {
        throw new Error('Serveri nuk e ndryshoi kontekstin. Dil dhe hyr sërish, pastaj provo përsëri.');
      }
      setTenantOverride({ businessId, teamId, name: biz.name || 'Tenant' });
      navigate('/app/dashboard');
    } catch (err: any) {
      toast({ title: 'Hyrja dështoi', description: err?.message || 'Provo përsëri.', variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  /** GDPR jobs (super-admin gated server-side). Delete demands a typed confirmation. */
  const runTenantJob = async (job: 'tenant-export' | 'tenant-delete') => {
    if (busy || !user) return;
    if (job === 'tenant-delete') {
      const typed = window.prompt(`Kjo FSHIN përgjithmonë të gjitha të dhënat e "${biz.name}". Shkruaj emrin e tenantit për ta konfirmuar:`);
      if (typed !== biz.name) {
        if (typed !== null) toast({ title: 'Anuluar', description: 'Emri nuk përputhej.', variant: 'destructive' });
        return;
      }
    }
    setBusy(job);
    try {
      const token = await user.getIdToken(true);
      // The server demands confirm=<businessId>; the operator typed the NAME, which is
      // the part a human can actually verify. Two different keys on purpose.
      const confirm = job === 'tenant-delete' ? `&confirm=${encodeURIComponent(businessId)}` : '';
      const call = async () => {
        const res = await fetch(`/api/cron/run?job=${job}&businessId=${businessId}&manual=1${confirm}`, {
          method: 'GET', headers: { Authorization: `Bearer ${token}` },
        });
        const json = await res.json();
        if (!res.ok || json.error) throw new Error(json.error || `Gabim serveri (${res.status})`);
        return json;
      };
      let data = await call();
      if (job === 'tenant-delete') {
        // Deletion is time-budgeted and resumable: one call can run out of budget with
        // documents still standing (`complete: false`). Keep going, or the tenant is
        // left half-erased — the opposite of what a DPA request asks for.
        let guard = 0;
        while ((data.result || data)?.complete === false && ++guard < 30) {
          data = await call();
        }
        if ((data.result || data)?.complete === false) {
          throw new Error('Fshirja s\'përfundoi brenda 30 kalimeve. Ekzekutoje sërish.');
        }
      }
      if (job === 'tenant-export') {
        // Hand the operator a file rather than a wall of JSON in a toast.
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `tenant-${biz.name || businessId}-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        toast({ title: 'Eksporti u shkarkua' });
      } else {
        toast({ title: 'Tenanti u fshi', description: 'Të dhënat u hoqën.' });
        navigate('/superadmin');
      }
    } catch (err: any) {
      toast({ title: 'Dështoi', description: err?.message || 'Provo përsëri.', variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  const field = 'h-9 px-2 rounded-md border border-border bg-background text-sm w-full';

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-4">
      <Link to="/superadmin" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Të gjithë tenantët
      </Link>

      {/* Header */}
      <Card className="p-4 flex items-center gap-3 flex-wrap">
        <div className="h-11 w-11 rounded-xl bg-muted flex items-center justify-center flex-shrink-0">
          <Building2 className="h-5 w-5 text-muted-foreground" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-lg font-bold truncate">{biz.name || 'Pa emër'}</h1>
            <Badge className={`${meta.cls} border-0 text-[10px]`}>{meta.label}</Badge>
            <Badge variant="outline" className="text-[10px]">{PLAN_LABEL[biz.plan || 'trial'] || biz.plan}</Badge>
          </div>
          <p className="text-xs text-muted-foreground truncate">
            {biz.ownerEmail || '—'} · krijuar {fmtDate(biz.createdAt)} · {teams.length} ekipe · {activeMembers}/{effectiveSeats} vende
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={enterTenant} disabled={busy === 'enter'}>
          {busy === 'enter' ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <LogIn className="h-3.5 w-3.5 mr-1.5" />}
          Hyr në hapësirë
        </Button>
      </Card>

      {/* Quick actions — one click each, all audited server-side. */}
      <Card className="p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-muted-foreground mr-1">Veprime të shpejta:</span>

          {(biz.status === 'trialing' || biz.status === 'past_due' || !biz.status) && (
            <Button size="sm" variant="outline" onClick={() => extendTrial(7)} disabled={!!busy}>
              {busy === 'trial-7' ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <CalendarPlus className="h-3.5 w-3.5 mr-1.5" />}
              +7 ditë provë
            </Button>
          )}

          {biz.status === 'suspended' ? (
            <Button
              size="sm" variant="outline" disabled={!!busy}
              onClick={() => quickAction('reactivate', { plan: biz.plan || 'trial', status: 'active', note: 'Riaktivizim nga konsola' }, 'Tenanti u riaktivizua')}
            >
              {busy === 'reactivate' ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <PlayCircle className="h-3.5 w-3.5 mr-1.5" />}
              Riaktivizo
            </Button>
          ) : (
            <Button
              size="sm" variant="outline" disabled={!!busy}
              onClick={() => {
                if (!window.confirm(`Pezullimi bllokon SHKRIMET për "${biz.name}" (rregullat e Firestore). Vazhdon?`)) return;
                void quickAction('suspend', { plan: biz.plan || 'trial', status: 'suspended', note: 'Pezullim nga konsola' }, 'Tenanti u pezullua');
              }}
            >
              {busy === 'suspend' ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <PauseCircle className="h-3.5 w-3.5 mr-1.5" />}
              Pezullo
            </Button>
          )}

          {stripeUrl && (
            <Button size="sm" variant="outline" asChild>
              <a href={stripeUrl} target="_blank" rel="noopener noreferrer">
                <CreditCard className="h-3.5 w-3.5 mr-1.5" />
                Stripe{biz.stripeLivemode === false ? ' (test)' : ''}
              </a>
            </Button>
          )}

          {biz.ownerEmail && (
            <Button size="sm" variant="outline" asChild>
              <a href={`mailto:${biz.ownerEmail}?subject=${encodeURIComponent(`FivoCRM — ${biz.name || 'hapësira juaj'}`)}`}>
                <Mail className="h-3.5 w-3.5 mr-1.5" /> Email pronarit
              </a>
            </Button>
          )}

          {sentryUrl && (
            <Button size="sm" variant="outline" asChild>
              <a href={sentryUrl} target="_blank" rel="noopener noreferrer">
                <Bug className="h-3.5 w-3.5 mr-1.5" /> Gabimet (Sentry)
              </a>
            </Button>
          )}
        </div>
      </Card>

      {/* Plan & lifecycle */}
      <Card className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <CreditCard className="h-4 w-4 text-primary" />
          <h2 className="font-semibold text-sm">Paketa &amp; abonimi</h2>
          {tenantMrr(biz) > 0 && <Badge variant="outline" className="text-[10px]">€{tenantMrr(biz)}/muaj</Badge>}
        </div>

        {biz.stripeSubscriptionId && (
          <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40 p-2.5 mb-3">
            <ShieldAlert className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
            <p className="text-[11px] text-amber-900 dark:text-amber-200">
              Ky tenant ka abonim aktiv në Stripe. Plani vendoset normalisht nga çmimi që faturohet —
              një ndryshim manual këtu do të rishkruhet nga ngjarja e radhës e Stripe. Përdore për raste kontrate/kompensimi.
            </p>
          </div>
        )}

        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Plani</Label>
            <select className={field} value={planVal} onChange={e => setPlan(e.target.value)}>
              {PLAN_KEYS.map(k => <option key={k} value={k}>{PLAN_LABEL[k]}</option>)}
            </select>
            <p className="text-[11px] text-muted-foreground mt-1">Vendet e paketës: {PLAN_SEATS[planVal]}</p>
          </div>
          <div>
            <Label className="text-xs">Statusi</Label>
            <select className={field} value={statusVal} onChange={e => setStatus(e.target.value)}>
              {STATUS_KEYS.map(k => <option key={k} value={k}>{STATUS_META[k].label}</option>)}
            </select>
            <p className="text-[11px] text-muted-foreground mt-1">
              "Pezulluar" ndalon çdo shkrim të tenantit (rregullat e Firestore).
            </p>
          </div>
          <div>
            <Label className="text-xs">Provja mbaron</Label>
            <input type="date" className={field} value={trialVal} onChange={e => setTrialDate(e.target.value)} />
            {trialLeft !== null && (
              <p className={`text-[11px] mt-1 ${trialLeft < 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
                {trialLeft < 0 ? `skadoi ${-trialLeft} ditë më parë` : `edhe ${trialLeft} ditë`}
              </p>
            )}
          </div>
          <div>
            <Label className="text-xs">Vende (override kontrate)</Label>
            <Input
              type="number" min={1} placeholder={`${PLAN_SEATS[planVal]} (nga paketa)`}
              value={seatsVal} onChange={e => setSeats(e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground mt-1">Bosh = sa jep paketa. Përdoret {activeMembers} nga {effectiveSeats}.</p>
          </div>
        </div>

        <div className="mt-3">
          <Label className="text-xs">Shënim (shkon në audit)</Label>
          <Input value={note} onChange={e => setNote(e.target.value)} placeholder="p.sh. kontratë vjetore, zbritje e rënë dakord" />
        </div>

        <div className="flex justify-end mt-3">
          <Button size="sm" onClick={savePlan} disabled={!dirty || saving}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
            Ruaj paketën
          </Button>
        </div>
      </Card>

      {/* Modules */}
      <Card className="p-4">
        <div className="flex items-center gap-2 mb-1">
          <SlidersHorizontal className="h-4 w-4 text-primary" />
          <h2 className="font-semibold text-sm">Modulet</h2>
        </div>
        <p className="text-[11px] text-muted-foreground mb-3">
          Çfarë përfshin kontrata e këtij tenanti. Një modul i kyçur këtu nuk mund të hapet nga
          pronari; një modul mbi planin mbetet i mbyllur edhe i disponueshëm — plani e vendos tavanin.
        </p>
        <ModuleAccessEditor
          plan={planVal}
          locked={locked}
          disabled={disabled}
          pending={modulePending}
          onToggleLocked={setLocked}
          onReplaceLocked={replaceLocked}
          onEnableForOwner={enableForOwner}
        />
      </Card>

      {/* Engagement — written by the tenant-usage-rollup cron, so the console never
          has to read the tenant's own data to answer "are they using it?". */}
      <Card className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <Activity className="h-4 w-4 text-primary" />
          <h2 className="font-semibold text-sm">Aktiviteti &amp; volumi</h2>
          <span className={`ml-1 inline-flex items-center gap-1.5 text-[11px] ${HEALTH_META[health].cls}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${HEALTH_META[health].dot}`} />
            {HEALTH_META[health].label}
          </span>
          {biz.usage?.computedAt && (
            <span className="ml-auto text-[11px] text-muted-foreground">
              matur {lastSeenLabel(biz.usage.computedAt)}
            </span>
          )}
        </div>

        {!biz.usage ? (
          <p className="text-xs text-muted-foreground">
            Nuk është matur ende. Ekzekuto punën <span className="font-mono">tenant-usage-rollup</span> (Punët → Analitika).
          </p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <p className="text-[11px] text-muted-foreground">Aktiviteti i fundit</p>
              <p className="text-sm font-medium">{lastSeenLabel(biz.usage.lastActivityAt)}</p>
            </div>
            <div>
              <p className="text-[11px] text-muted-foreground">Përdorues aktivë (7d)</p>
              <p className="text-sm font-medium">{biz.usage.activeUsers7d ?? 0}</p>
            </div>
            <div>
              <p className="text-[11px] text-muted-foreground">Dokumente gjithsej</p>
              <p className="text-sm font-medium tabular-nums">{(biz.usage.docsTotal ?? 0).toLocaleString('sq-AL')}</p>
            </div>
            <div>
              <p className="text-[11px] text-muted-foreground">Vendet</p>
              <p className="text-sm font-medium">{activeMembers}/{effectiveSeats}</p>
            </div>
            {biz.usage.docCounts && (
              <div className="col-span-2 sm:col-span-4 flex flex-wrap gap-1.5 pt-1">
                {Object.entries(biz.usage.docCounts).map(([coll, n]) => (
                  <Badge key={coll} variant="outline" className="text-[10px] font-normal">
                    {coll}: {n < 0 ? '—' : n.toLocaleString('sq-AL')}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        )}
      </Card>

      {/* People + portal */}
      <div className="grid sm:grid-cols-2 gap-4">
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <Users className="h-4 w-4 text-primary" />
            <h2 className="font-semibold text-sm">Ekipi</h2>
          </div>
          {members.length === 0 && <p className="text-xs text-muted-foreground">Asnjë anëtar.</p>}
          <ul className="space-y-1.5">
            {members.slice(0, 12).map(m => (
              <li key={m.id} className="flex items-center gap-2 text-xs">
                <span className="truncate flex-1">{(m as any).displayName || m.email}</span>
                <Badge variant="outline" className="text-[10px]">{m.role}</Badge>
                {m.status !== 'Active' && <span className="text-[10px] text-muted-foreground">{m.status}</span>}
              </li>
            ))}
          </ul>
          {members.length > 12 && <p className="text-[11px] text-muted-foreground mt-2">+{members.length - 12} të tjerë</p>}
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <Globe className="h-4 w-4 text-primary" />
            <h2 className="font-semibold text-sm">Portali i klientëve</h2>
          </div>
          <Label className="text-xs">Subdomain</Label>
          <div className="flex items-center gap-2">
            <Input
              defaultValue={biz.portalSubdomain || ''}
              placeholder="p.sh. acme"
              onBlur={(e) => saveSubdomain(e.target.value)}
              className="w-32"
            />
            <span className="text-[11px] text-muted-foreground">.fivocrm.com/portal</span>
          </div>
          <p className="text-[11px] text-muted-foreground mt-2">
            Ekipet: {teams.map(t => t.name).join(', ') || '—'}
          </p>
        </Card>
      </div>

      {/* Danger zone */}
      <Card className="p-4 border-destructive/30">
        <div className="flex items-center gap-2 mb-1">
          <AlertTriangle className="h-4 w-4 text-destructive" />
          <h2 className="font-semibold text-sm text-destructive">Zona e rrezikut</h2>
        </div>
        <p className="text-[11px] text-muted-foreground mb-3">
          Të dyja janë veprime GDPR, të kufizuara te super-admin nga serveri. Fshirja është e pakthyeshme.
        </p>
        <div className="flex gap-2 flex-wrap">
          <Button size="sm" variant="outline" onClick={() => runTenantJob('tenant-export')} disabled={!!busy}>
            {busy === 'tenant-export' ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Download className="h-3.5 w-3.5 mr-1.5" />}
            Eksporto të dhënat
          </Button>
          <Button size="sm" variant="destructive" onClick={() => runTenantJob('tenant-delete')} disabled={!!busy}>
            {busy === 'tenant-delete' ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Trash2 className="h-3.5 w-3.5 mr-1.5" />}
            Fshi tenantin
          </Button>
        </div>
      </Card>
    </div>
  );
};

export default TenantDetailView;
