import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Share2, Facebook, Instagram, Plus, RefreshCw, Trash2, CheckCircle2, AlertCircle, Link2, X,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../contexts/PermissionsContext';
import { useCollection, getGlobalTeamId, getGlobalBusinessId } from '../hooks/useFirestore';
import type { SocialSnapshot, Customer } from '../types';
import SocialAnalytics from '../components/SocialAnalytics';

type Tab = 'reports' | 'accounts';
const TABS: { key: Tab; label: string }[] = [
  { key: 'reports', label: 'Raportet' },
  { key: 'accounts', label: 'Llogaritë' },
];

interface ApiAccount {
  id: string;
  platform: 'facebook' | 'instagram';
  name: string;
  username: string | null;
  pictureUrl: string | null;
  customerId: string;
  connected: boolean;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
}

const SocialMediaView: React.FC = () => {
  const { user } = useAuth();
  const permissions = usePermissions();
  const canManage = permissions.isAdmin || permissions.isManager;
  const [tab, setTab] = useState<Tab>('reports');
  const [params, setParams] = useSearchParams();

  const { data: snapshots, loading } = useCollection<SocialSnapshot>('socialSnapshots');
  const { data: customers } = useCollection<Customer>('customers');

  const [accounts, setAccounts] = useState<ApiAccount[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState('');
  const [busy, setBusy] = useState<string | null>(null); // accountId being synced/disconnected, or 'connect'
  const [banner, setBanner] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const teamId = getGlobalTeamId();
  const businessId = getGlobalBusinessId();
  const scopeQs = `teamId=${encodeURIComponent(teamId || '')}&businessId=${encodeURIComponent(businessId || '')}`;
  const customerName = useCallback(
    (id: string) => customers?.find((c) => c.id === id)?.name || 'Klient',
    [customers],
  );

  const authFetch = useCallback(async (path: string, init?: RequestInit) => {
    const token = await user!.getIdToken();
    const res = await fetch(path, {
      ...init,
      headers: { ...(init?.headers || {}), Authorization: `Bearer ${token}`, ...(init?.body ? { 'Content-Type': 'application/json' } : {}) },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error || `Kërkesa dështoi (${res.status})`);
    return json;
  }, [user]);

  const loadAccounts = useCallback(async () => {
    if ((!teamId && !businessId) || !user) return;
    setAccountsLoading(true);
    try {
      const { accounts } = await authFetch(`/api/social?action=list&${scopeQs}`);
      setAccounts(accounts || []);
    } catch (e) {
      setBanner({ kind: 'err', text: (e as Error).message });
    } finally {
      setAccountsLoading(false);
    }
  }, [teamId, businessId, user, authFetch]);

  useEffect(() => { void loadAccounts(); }, [loadAccounts]);

  // Surface the OAuth redirect result (?connected=N / ?error=...) then clean the URL.
  useEffect(() => {
    const connected = params.get('connected');
    const error = params.get('error');
    if (connected) {
      setBanner({ kind: 'ok', text: `${connected} llogari u lidhën me sukses. Sinkronizo për të parë raportin e parë.` });
      setTab('accounts');
      void loadAccounts();
    } else if (error) {
      setBanner({ kind: 'err', text: error });
      setTab('accounts');
    }
    if (connected || error) {
      params.delete('connected'); params.delete('error');
      setParams(params, { replace: true });
    }
  }, [params, setParams, loadAccounts]);

  const handleConnect = async () => {
    if ((!teamId && !businessId) || !selectedCustomer) { setBanner({ kind: 'err', text: 'Zgjidhni një klient së pari.' }); return; }
    setBusy('connect');
    try {
      const { url } = await authFetch(`/api/social?action=oauth-url&${scopeQs}&customerId=${encodeURIComponent(selectedCustomer)}`);
      window.location.href = url; // hand off to Facebook Login
    } catch (e) {
      setBanner({ kind: 'err', text: (e as Error).message });
      setBusy(null);
    }
  };

  const handleSync = async (accountId?: string) => {
    if (!teamId && !businessId) return;
    setBusy(accountId || 'all');
    try {
      const { results } = await authFetch('/api/social?action=sync-now', {
        method: 'POST',
        body: JSON.stringify({ teamId, businessId, accountId }),
      });
      const failed = (results || []).filter((r: any) => r.error);
      setBanner(failed.length
        ? { kind: 'err', text: `${failed.length} llogari dështuan: ${failed[0].error}` }
        : { kind: 'ok', text: 'Sinkronizimi përfundoi. Raportet u përditësuan.' });
      await loadAccounts();
    } catch (e) {
      setBanner({ kind: 'err', text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const handleSendReport = async (customerId: string, period: string) => {
    try {
      const r = await authFetch('/api/social?action=send-report', {
        method: 'POST',
        body: JSON.stringify({ customerId, period }),
      });
      setBanner(r.success
        ? { kind: 'ok', text: 'Raporti u dërgua me email te klienti.' }
        : { kind: 'err', text: r.error || 'Dërgimi dështoi.' });
    } catch (e) {
      setBanner({ kind: 'err', text: (e as Error).message });
    }
  };

  const handleDisconnect = async (accountId: string) => {
    setBusy(accountId);
    try {
      await authFetch('/api/social?action=disconnect', { method: 'POST', body: JSON.stringify({ accountId }) });
      setAccounts((prev) => prev.filter((a) => a.id !== accountId));
    } catch (e) {
      setBanner({ kind: 'err', text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const sortedCustomers = useMemo(
    () => [...(customers || [])].sort((a, b) => (a.name || '').localeCompare(b.name || '')),
    [customers],
  );

  return (
    <div className="p-4 sm:p-6 w-full min-w-0 max-w-4xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
          <Share2 className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-xl font-bold">Rrjetet Sociale</h1>
          <p className="text-sm text-muted-foreground">Raporte nga Facebook &amp; Instagram për klientët që menaxhoni.</p>
        </div>
      </div>

      {banner && (
        <div className={`flex items-start gap-2 text-sm px-3 py-2 rounded-lg border ${banner.kind === 'ok' ? 'bg-green-500/10 border-green-500/30 text-green-700 dark:text-green-400' : 'bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-400'}`}>
          {banner.kind === 'ok' ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" /> : <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />}
          <span className="flex-1">{banner.text}</span>
          <button onClick={() => setBanner(null)} aria-label="Mbyll"><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === t.key ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'reports' && (
        <SocialAnalytics
          snapshots={snapshots || []}
          loading={loading}
          emptyHint={canManage ? 'Lidhni një llogari te tab-i "Llogaritë" dhe sinkronizoni për të parë raportin.' : undefined}
          onSendReport={canManage ? handleSendReport : undefined}
        />
      )}

      {tab === 'accounts' && (
        <div className="space-y-5">
          {/* Connect a new account */}
          {canManage && (
            <div className="border border-border rounded-xl p-4 bg-card space-y-3">
              <h3 className="text-sm font-semibold flex items-center gap-1.5"><Link2 className="w-4 h-4 text-primary" /> Lidh një llogari të re</h3>
              <p className="text-[13px] text-muted-foreground">
                Zgjidhni klientin, pastaj hyni me Facebook për të autorizuar aksesin te Faqja dhe llogaria Instagram e lidhur. Të dhënat merren automatikisht një herë në muaj.
              </p>
              <div className="flex flex-col sm:flex-row gap-2">
                <select
                  value={selectedCustomer}
                  onChange={(e) => setSelectedCustomer(e.target.value)}
                  className="flex-1 text-sm rounded-lg border border-border bg-background px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/40"
                >
                  <option value="">— Zgjidh klientin —</option>
                  {sortedCustomers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <button
                  onClick={handleConnect}
                  disabled={busy === 'connect' || !selectedCustomer}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm font-medium disabled:opacity-50"
                >
                  <Plus className="w-4 h-4" /> {busy === 'connect' ? 'Duke hapur…' : 'Lidh me Facebook'}
                </button>
              </div>
            </div>
          )}

          {/* Connected accounts list */}
          <div className="border border-border rounded-xl bg-card overflow-hidden">
            <div className="flex items-center justify-between px-4 pt-4 pb-2">
              <h3 className="text-sm font-semibold">Llogaritë e lidhura</h3>
              {accounts.length > 0 && canManage && (
                <button
                  onClick={() => handleSync()}
                  disabled={busy !== null}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${busy === 'all' ? 'animate-spin' : ''}`} /> Sinkronizo të gjitha
                </button>
              )}
            </div>
            {accountsLoading ? (
              <p className="text-sm text-muted-foreground px-4 py-8 text-center">Duke ngarkuar…</p>
            ) : accounts.length === 0 ? (
              <p className="text-sm text-muted-foreground px-4 py-8 text-center">Ende s'ka llogari të lidhura.</p>
            ) : (
              <div className="divide-y divide-border/60">
                {accounts.map((a) => (
                  <div key={a.id} className="flex items-center gap-3 px-4 py-3">
                    <span className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${a.platform === 'instagram' ? 'bg-pink-500/10 text-pink-500' : 'bg-blue-500/10 text-blue-600'}`}>
                      {a.platform === 'instagram' ? <Instagram className="w-4.5 h-4.5" /> : <Facebook className="w-4.5 h-4.5" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{a.name}</p>
                      <p className="text-[11px] text-muted-foreground truncate">
                        {customerName(a.customerId)}
                        {a.lastSyncError ? ' · ⚠ ' + a.lastSyncError : a.lastSyncedAt ? ' · sinkr. ' + new Date(a.lastSyncedAt).toLocaleDateString('sq-AL') : ' · ende pa sinkronizuar'}
                      </p>
                    </div>
                    {canManage && (
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button onClick={() => handleSync(a.id)} disabled={busy !== null} title="Sinkronizo" className="p-2 rounded-lg hover:bg-accent disabled:opacity-50">
                          <RefreshCw className={`w-4 h-4 ${busy === a.id ? 'animate-spin' : ''}`} />
                        </button>
                        <button onClick={() => handleDisconnect(a.id)} disabled={busy !== null} title="Shkëput" className="p-2 rounded-lg hover:bg-red-500/10 text-muted-foreground hover:text-red-500 disabled:opacity-50">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default SocialMediaView;
