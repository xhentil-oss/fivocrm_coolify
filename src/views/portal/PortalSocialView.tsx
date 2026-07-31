import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Facebook, Globe, CheckCircle2, AlertCircle, X, Link2 } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useClientPortal } from '../../hooks/useClientPortal';
import { useCollection } from '../../hooks/useFirestore';
import type { SocialSnapshot } from '../../types';
import SocialAnalytics from '../../components/SocialAnalytics';

const PortalSocialView: React.FC = () => {
  const { user } = useAuth();
  const { customerId } = useClientPortal();
  const [params, setParams] = useSearchParams();
  const [busy, setBusy] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // Clients only ever read their OWN snapshots — scoped by customerId, never by
  // team/business (portal users have no businessId). Tokens live in the separate
  // socialAccounts collection which the portal cannot read.
  const { data: snapshots, loading } = useCollection<SocialSnapshot>('socialSnapshots', {
    skip: !customerId,
    where: [{ field: 'customerId', operator: '==', value: customerId || '' }],
    skipTeamFilter: true,
  });

  // Surface the OAuth redirect result (?connected=N / ?error=…) then clean the URL.
  useEffect(() => {
    const connected = params.get('connected');
    const error = params.get('error');
    if (connected) setBanner({ kind: 'ok', text: `${connected} llogari u lidhën. Raporti i parë do të shfaqet në fund të muajit.` });
    else if (error) setBanner({ kind: 'err', text: error });
    if (connected || error) { params.delete('connected'); params.delete('error'); setParams(params, { replace: true }); }
  }, [params, setParams]);

  const connect = useCallback(async (kind: 'meta' | 'google') => {
    if (!user) return;
    setBusy(kind);
    try {
      const token = await user.getIdToken();
      const action = kind === 'google' ? 'google-oauth-url' : 'oauth-url';
      const res = await fetch(`/api/social?action=${action}&portal=1`, { headers: { Authorization: `Bearer ${token}` } });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.url) throw new Error(json?.error || 'Lidhja dështoi');
      window.location.href = json.url; // hand off to Facebook / Google
    } catch (e) {
      setBanner({ kind: 'err', text: (e as Error).message });
      setBusy(null);
    }
  }, [user]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Rrjetet Sociale</h1>
        <p className="text-muted-foreground mt-1">
          Raporti mujor i performancës së Facebook, Instagram &amp; Google, i menaxhuar nga ekipi ynë.
        </p>
      </div>

      {banner && (
        <div className={`flex items-start gap-2 text-sm px-3 py-2 rounded-lg border ${banner.kind === 'ok' ? 'bg-green-500/10 border-green-500/30 text-green-700 dark:text-green-400' : 'bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-400'}`}>
          {banner.kind === 'ok' ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" /> : <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />}
          <span className="flex-1">{banner.text}</span>
          <button onClick={() => setBanner(null)} aria-label="Mbyll"><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* Client self-connect */}
      <div className="rounded-2xl border border-border bg-card p-5">
        <h2 className="text-base font-semibold flex items-center gap-2"><Link2 className="w-4 h-4 text-primary" /> Lidh llogaritë e tua</h2>
        <p className="text-sm text-muted-foreground mt-1 mb-3">
          Autorizo aksesin që ne të tërheqim statistikat automatikisht. Të dhënat përditësohen një herë në muaj dhe shfaqen këtu.
        </p>
        <div className="flex flex-col sm:flex-row gap-2">
          <button
            onClick={() => connect('meta')}
            disabled={busy !== null}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-gradient text-white px-4 py-2.5 text-sm font-semibold disabled:opacity-50"
          >
            <Facebook className="w-4 h-4" /> {busy === 'meta' ? 'Duke hapur…' : 'Lidh Facebook / Instagram'}
          </button>
          <button
            onClick={() => connect('google')}
            disabled={busy !== null}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-background px-4 py-2.5 text-sm font-semibold hover:bg-accent disabled:opacity-50"
          >
            <Globe className="w-4 h-4" /> {busy === 'google' ? 'Duke hapur…' : 'Lidh Google Search Console'}
          </button>
        </div>
      </div>

      <SocialAnalytics
        snapshots={snapshots || []}
        loading={loading || !customerId}
        emptyHint="Lidh llogaritë e tua më sipër — raporti i parë shfaqet në fund të muajit."
      />
    </div>
  );
};

export default PortalSocialView;
