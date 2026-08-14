import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Star,
  RefreshCw,
  Trash2,
  CheckCircle2,
  AlertCircle,
  X,
  Sparkles,
  Flag,
  CornerDownRight,
  Send,
  Settings,
  MessageSquareText,
  Megaphone,
  ExternalLink,
  Shield,
  Link2,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../contexts/PermissionsContext';
import { useCollection, getGlobalTeamId, getGlobalBusinessId } from '../hooks/useFirestore';
import { useTeamSettingsData, saveTeamSettings } from '../hooks/useTeamSettings';
import { saveTenantSecrets } from '../lib/tenantSecrets';
import type { GmbReview, GmbPost } from '../types';

/**
 * Google Reviews (Business Profile) — staff view.
 *
 * Data paths mirror SocialMediaView: the mirrored reviews/posts arrive realtime
 * through useCollection (business-scoped), while the token-bearing locations come
 * token-stripped from GET /api/gmb?action=list. Every mutation (reply, report
 * mark, post, sync) goes through /api/gmb — gmbReviews/gmbPosts deny client
 * writes so the mirror can never diverge from Google by a local edit.
 */

type Tab = 'reviews' | 'posts' | 'settings';

interface ApiAccount {
  id: string;
  name: string;
  address: string | null;
  customerId: string | null;
  connected: boolean;
  rating: number | null;
  reviewCount: number;
  starCounts: Record<string, number> | null;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
}

type Filter = 'all' | 'pending' | 'negative' | 'new' | 'reported';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'Të gjitha' },
  { key: 'pending', label: 'Pa përgjigje' },
  { key: 'negative', label: '≤ 3★' },
  { key: 'new', label: 'Të reja' },
  { key: 'reported', label: 'Të raportuara' },
];

const REPORT_REASONS = ['Spam / e rreme', 'Konflikt interesi', 'Gjuhë ofenduese', 'Jashtë teme'];

const CTA_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Pa buton' },
  { value: 'LEARN_MORE', label: 'Mëso më shumë' },
  { value: 'BOOK', label: 'Rezervo' },
  { value: 'ORDER', label: 'Porosit' },
  { value: 'SHOP', label: 'Bli' },
  { value: 'SIGN_UP', label: 'Regjistrohu' },
  { value: 'CALL', label: 'Telefono' },
];

const toDate = (v: any): Date | null => {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v?.toDate === 'function') return v.toDate();
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
};

const fmtDate = (v: any): string => {
  const d = toDate(v);
  return d ? d.toLocaleDateString('sq-AL', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
};

const initials = (n: string) => n.split(' ').filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase() || 'G';

const Stars: React.FC<{ n: number; className?: string }> = ({ n, className }) => (
  <span className={`text-amber-500 tracking-wider text-[13px] ${className || ''}`} aria-label={`${n} yje`}>
    {'★'.repeat(Math.max(0, Math.min(5, n)))}
    <span className="text-muted-foreground/40">{'★'.repeat(5 - Math.max(0, Math.min(5, n)))}</span>
  </span>
);

const GmbReviewsView: React.FC = () => {
  const { user } = useAuth();
  const permissions = usePermissions();
  const canManage = permissions.isAdmin || permissions.isManager;
  const [tab, setTab] = useState<Tab>('reviews');
  const [params, setParams] = useSearchParams();
  const settings = useTeamSettingsData();

  const { data: reviews, loading: reviewsLoading } = useCollection<GmbReview>('gmbReviews');
  const { data: posts } = useCollection<GmbPost>('gmbPosts');

  const [accounts, setAccounts] = useState<ApiAccount[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [starFilter, setStarFilter] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ kind: 'ok' | 'err'; text: string; link?: string } | null>(null);

  // Reply / report editors (one open at a time each)
  const [replyingId, setReplyingId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [aiDrafts, setAiDrafts] = useState<Record<string, string>>({});
  const [reportingId, setReportingId] = useState<string | null>(null);
  const [reportDrafts, setReportDrafts] = useState<Record<string, string>>({});
  const [reportReasons, setReportReasons] = useState<Record<string, string>>({});
  const [aiReports, setAiReports] = useState<Record<string, string>>({});

  // Posts tab form
  const [postSummary, setPostSummary] = useState('');
  const [postCta, setPostCta] = useState('');
  const [postCtaUrl, setPostCtaUrl] = useState('');
  const [postMediaUrl, setPostMediaUrl] = useState('');

  // Settings tab form
  const [clientIdInput, setClientIdInput] = useState('');
  const [clientSecretInput, setClientSecretInput] = useState('');
  const [aiContextInput, setAiContextInput] = useState('');
  const [settingsSeeded, setSettingsSeeded] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  const teamId = getGlobalTeamId();
  const businessId = getGlobalBusinessId();
  const scopeQs = `teamId=${encodeURIComponent(teamId || '')}&businessId=${encodeURIComponent(businessId || '')}`;

  useEffect(() => {
    if (settings && !settingsSeeded) {
      setClientIdInput(settings.gmbClientId || '');
      setAiContextInput(settings.gmbAiContext || '');
      setSettingsSeeded(true);
    }
  }, [settings, settingsSeeded]);

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
      const { accounts } = await authFetch(`/api/gmb?action=list&${scopeQs}`);
      setAccounts(accounts || []);
      setSelectedId((prev) => prev && (accounts || []).some((a: ApiAccount) => a.id === prev) ? prev : (accounts?.[0]?.id ?? null));
    } catch (e) {
      setBanner({ kind: 'err', text: (e as Error).message });
    } finally {
      setAccountsLoading(false);
    }
  }, [teamId, businessId, user, authFetch, scopeQs]);

  useEffect(() => { void loadAccounts(); }, [loadAccounts]);

  // Surface the OAuth redirect result (?connected=N / ?error=...) then clean the URL.
  useEffect(() => {
    const connected = params.get('connected');
    const error = params.get('error');
    if (connected) {
      setBanner({ kind: 'ok', text: `${connected} profile u lidhën me sukses. Po sinkronizojmë reviews…` });
      void loadAccounts();
      void authFetch('/api/gmb?action=sync-now', { method: 'POST', body: JSON.stringify({ teamId, businessId }) })
        .then(() => loadAccounts())
        .catch(() => {});
    } else if (error) {
      setBanner({ kind: 'err', text: error });
    }
    if (connected || error) {
      params.delete('connected'); params.delete('error');
      setParams(params, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, setParams]);

  const handleConnect = async () => {
    if (!teamId && !businessId) return;
    setBusy('connect');
    try {
      const { url } = await authFetch(`/api/gmb?action=oauth-url&${scopeQs}`);
      window.location.href = url; // hand off to Google consent
    } catch (e) {
      setBanner({ kind: 'err', text: (e as Error).message });
      setBusy(null);
    }
  };

  const handleSync = async (accountId?: string) => {
    setBusy(accountId || 'sync-all');
    try {
      const { results } = await authFetch('/api/gmb?action=sync-now', {
        method: 'POST',
        body: JSON.stringify({ teamId, businessId, accountId }),
      });
      const failed = (results || []).filter((r: any) => r.error);
      setBanner(failed.length
        ? { kind: 'err', text: `${failed.length} profile dështuan: ${failed[0].error}` }
        : { kind: 'ok', text: 'Sinkronizimi përfundoi.' });
      await loadAccounts();
    } catch (e) {
      setBanner({ kind: 'err', text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const handleDisconnect = async (accountId: string) => {
    setBusy(accountId);
    try {
      await authFetch('/api/gmb?action=disconnect', { method: 'POST', body: JSON.stringify({ accountId }) });
      setAccounts((prev) => prev.filter((a) => a.id !== accountId));
    } catch (e) {
      setBanner({ kind: 'err', text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const handleAiSuggest = async (r: GmbReview, kind: 'reply' | 'report') => {
    setBusy(`ai-${r.id}`);
    try {
      const { text } = await authFetch('/api/gmb?action=ai-suggest', {
        method: 'POST',
        body: JSON.stringify({ reviewDocId: r.id, kind }),
      });
      if (kind === 'reply') setAiDrafts((p) => ({ ...p, [r.id]: text }));
      else setAiReports((p) => ({ ...p, [r.id]: text }));
    } catch (e) {
      setBanner({ kind: 'err', text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const handleSendReply = async (r: GmbReview) => {
    const text = (drafts[r.id] || '').trim();
    if (!text) return;
    setBusy(`reply-${r.id}`);
    try {
      await authFetch('/api/gmb?action=reply', {
        method: 'POST',
        body: JSON.stringify({ reviewDocId: r.id, comment: text }),
      });
      setReplyingId(null);
      setBanner({ kind: 'ok', text: 'Përgjigjja u publikua në Google.' });
    } catch (e) {
      setBanner({ kind: 'err', text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const handleSendReport = async (r: GmbReview) => {
    const reason = reportReasons[r.id] || REPORT_REASONS[0];
    setBusy(`report-${r.id}`);
    try {
      const { googleReportUrl } = await authFetch('/api/gmb?action=report', {
        method: 'POST',
        body: JSON.stringify({ reviewDocId: r.id, reason, argument: reportDrafts[r.id] || aiReports[r.id] || '' }),
      });
      setReportingId(null);
      setBanner({
        kind: 'ok',
        text: 'U shënua si i raportuar. Google s\'ka API raportimi — dërgojeni te vegla zyrtare me argumentimin e përgatitur.',
        link: googleReportUrl,
      });
      if (googleReportUrl) window.open(googleReportUrl, '_blank', 'noopener');
    } catch (e) {
      setBanner({ kind: 'err', text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const handleCreatePost = async () => {
    if (!selectedId || !postSummary.trim()) return;
    setBusy('create-post');
    try {
      const r = await authFetch('/api/gmb?action=create-post', {
        method: 'POST',
        body: JSON.stringify({
          accountId: selectedId,
          summary: postSummary.trim(),
          ctaType: postCta || undefined,
          ctaUrl: postCtaUrl || undefined,
          mediaUrl: postMediaUrl || undefined,
        }),
      });
      setPostSummary(''); setPostCta(''); setPostCtaUrl(''); setPostMediaUrl('');
      setBanner({ kind: 'ok', text: `Postimi u publikua në profilin Google (${r.state || 'LIVE'}).`, link: r.searchUrl || undefined });
    } catch (e) {
      setBanner({ kind: 'err', text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const handleTest = async () => {
    setBusy('test');
    setTestResult(null);
    try {
      const r = await authFetch(`/api/gmb?action=test&${scopeQs}`);
      setTestResult(r.ok
        ? `✓ Lidhja OK — ${r.locations} profile${r.ms ? ` (${r.ms} ms)` : ''}${r.note ? ` · ${r.note}` : ''}${r.source === 'env' ? ' · kredencialet e platformës' : ''}`
        : `✗ ${r.error || 'Testi dështoi'}`);
    } catch (e) {
      setTestResult(`✗ ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const handleSaveCredentials = async () => {
    if (!teamId) return;
    setBusy('save-creds');
    try {
      await saveTeamSettings(teamId, { gmbClientId: clientIdInput.trim() });
      if (clientSecretInput.trim()) {
        await saveTenantSecrets(teamId, { gmbClientSecret: clientSecretInput.trim() });
        setClientSecretInput('');
      }
      setBanner({ kind: 'ok', text: 'Kredencialet u ruajtën. Sekreti qëndron vetëm në kasafortën e serverit.' });
    } catch (e) {
      setBanner({ kind: 'err', text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const handleSaveBehavior = async (patch: Record<string, any>) => {
    if (!teamId) return;
    try {
      await saveTeamSettings(teamId, patch);
    } catch (e) {
      setBanner({ kind: 'err', text: (e as Error).message });
    }
  };

  // ── Derived data ──────────────────────────────────────────────────────────────
  const selected = accounts.find((a) => a.id === selectedId) || null;

  const reviewsByAccount = useMemo(() => {
    const map = new Map<string, GmbReview[]>();
    for (const r of reviews || []) {
      const list = map.get(r.accountId) || [];
      list.push(r);
      map.set(r.accountId, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => (b.googleCreateTime || '').localeCompare(a.googleCreateTime || ''));
    }
    return map;
  }, [reviews]);

  const isNewReview = (r: GmbReview) => {
    const d = toDate(r.firstSyncedAt);
    return !!d && Date.now() - d.getTime() < 7 * 24 * 3600 * 1000 && !r.replyComment && !r.reported;
  };

  const selReviews = selected ? (reviewsByAccount.get(selected.id) || []) : [];
  const shown = selReviews.filter((r) => {
    if (starFilter) return r.starRating === starFilter;
    if (filter === 'pending') return !r.replyComment && !r.reported;
    if (filter === 'negative') return r.starRating > 0 && r.starRating <= 3;
    if (filter === 'new') return isNewReview(r);
    if (filter === 'reported') return !!r.reported;
    return true;
  });

  const dist = useMemo(() => {
    const counts = [5, 4, 3, 2, 1].map((s) =>
      selected?.starCounts ? (selected.starCounts[String(s)] || 0) : selReviews.filter((r) => r.starRating === s).length);
    const max = Math.max(...counts, 1);
    return [5, 4, 3, 2, 1].map((s, i) => ({ star: s, n: counts[i], pct: (counts[i] / max) * 100 }));
  }, [selected, selReviews]);

  const replyRate = selReviews.length
    ? Math.round((selReviews.filter((r) => r.replyComment).length / selReviews.length) * 100)
    : 0;

  const kpis = useMemo(() => {
    const all = reviews || [];
    const totalCount = accounts.reduce((a, c) => a + (c.reviewCount || 0), 0);
    const weighted = accounts.reduce((a, c) => a + (c.rating || 0) * (c.reviewCount || 0), 0);
    const avg = totalCount ? (weighted / totalCount).toFixed(1) : '—';
    const pending = all.filter((r) => !r.replyComment && !r.reported).length;
    const reported = all.filter((r) => !!r.reported).length;
    return { avg, totalCount, pending, reported };
  }, [reviews, accounts]);

  const sortedPosts = useMemo(
    () => [...(posts || [])].sort((a, b) => (toDate(b.createdAt)?.getTime() || 0) - (toDate(a.createdAt)?.getTime() || 0)),
    [posts],
  );

  const pendingFor = (accId: string) => (reviewsByAccount.get(accId) || []).filter((r) => !r.replyComment && !r.reported).length;

  // ── UI ────────────────────────────────────────────────────────────────────────
  return (
    <div className="p-4 sm:p-6 w-full min-w-0 max-w-6xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
          <Star className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-[220px]">
          <h1 className="text-xl font-bold">Google Reviews</h1>
          <p className="text-sm text-muted-foreground">Lidh profilin Google Business — përgjigju, raporto dhe posto direkt nga CRM.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex bg-muted rounded-lg p-0.5 gap-0.5">
            {([
              { key: 'reviews', label: 'Reviews', icon: MessageSquareText },
              { key: 'posts', label: 'Postime', icon: Megaphone },
              { key: 'settings', label: 'Cilësimet API', icon: Settings },
            ] as { key: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[]).map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${tab === t.key ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
              >
                <t.icon className="w-3.5 h-3.5" /> {t.label}
              </button>
            ))}
          </div>
          {canManage && (
            <button
              onClick={handleConnect}
              disabled={busy !== null}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary text-primary-foreground px-3 py-2 text-xs font-semibold disabled:opacity-50 whitespace-nowrap"
            >
              <Link2 className="w-3.5 h-3.5" /> {busy === 'connect' ? 'Duke hapur…' : 'Lidh profil Google'}
            </button>
          )}
        </div>
      </div>

      {banner && (
        <div className={`flex items-start gap-2 text-sm px-3 py-2 rounded-lg border ${banner.kind === 'ok' ? 'bg-green-500/10 border-green-500/30 text-green-700 dark:text-green-400' : 'bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-400'}`}>
          {banner.kind === 'ok' ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" /> : <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />}
          <span className="flex-1">
            {banner.text}
            {banner.link && (
              <a href={banner.link} target="_blank" rel="noopener noreferrer" className="ml-1 underline inline-flex items-center gap-0.5">
                Hape te Google <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </span>
          <button onClick={() => setBanner(null)} aria-label="Mbyll"><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* ═══ REVIEWS TAB ═══ */}
      {tab === 'reviews' && (
        <>
          {/* KPI row */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { label: 'Vlerësimi mesatar', value: kpis.avg === '—' ? '—' : `${kpis.avg} ★`, tone: '' },
              { label: 'Reviews gjithsej', value: String(kpis.totalCount), tone: '' },
              { label: 'Pa përgjigje', value: String(kpis.pending), tone: kpis.pending ? 'text-red-500' : 'text-emerald-600' },
              { label: 'Të raportuara', value: String(kpis.reported), tone: '' },
            ].map((k) => (
              <div key={k.label} className="bg-card border border-border rounded-xl px-4 py-3">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{k.label}</p>
                <p className={`text-xl font-mono font-bold mt-1 ${k.tone}`}>{k.value}</p>
              </div>
            ))}
          </div>

          <div className="grid lg:grid-cols-[300px,1fr] gap-4 items-start">
            {/* Locations list */}
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-border/60 flex items-center justify-between">
                <span className="text-sm font-bold">Profilet e lidhura</span>
                <span className="text-[10px] font-mono text-muted-foreground">{accounts.length} të lidhur</span>
              </div>
              {accountsLoading ? (
                <p className="text-sm text-muted-foreground px-4 py-8 text-center">Duke ngarkuar…</p>
              ) : accounts.length === 0 ? (
                <div className="px-5 py-10 text-center space-y-2">
                  <span className="w-12 h-12 rounded-xl bg-primary/10 text-primary text-xl font-extrabold flex items-center justify-center mx-auto">G</span>
                  <p className="text-sm font-semibold">Asnjë profil i lidhur</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Autorizo me llogarinë Google që menaxhon profilin e biznesit — reviews sinkronizohen automatikisht çdo orë.
                  </p>
                  {canManage && (
                    <button onClick={handleConnect} disabled={busy !== null} className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-primary text-primary-foreground px-4 py-2 text-xs font-semibold disabled:opacity-50">
                      Lidh me Google OAuth
                    </button>
                  )}
                </div>
              ) : (
                <div className="flex flex-col divide-y divide-border/40">
                  {accounts.map((a) => {
                    const pending = pendingFor(a.id);
                    const active = a.id === selectedId;
                    return (
                      <button
                        key={a.id}
                        onClick={() => { setSelectedId(a.id); setFilter('all'); setStarFilter(null); setReplyingId(null); setReportingId(null); }}
                        className={`flex items-center gap-3 px-3.5 py-3 text-left border-l-2 transition-colors ${active ? 'border-l-primary bg-primary/5' : 'border-l-transparent hover:bg-accent/50'}`}
                      >
                        <span className="w-9 h-9 rounded-lg bg-primary text-primary-foreground text-[11px] font-extrabold flex items-center justify-center shrink-0">
                          {initials(a.name)}
                        </span>
                        <span className="flex-1 min-w-0">
                          <span className="block text-sm font-semibold truncate">{a.name}</span>
                          <span className="block text-[11px] text-muted-foreground">
                            {a.rating != null ? `★ ${a.rating.toFixed(1)} · ${a.reviewCount} reviews` : 'Ende pa sinkronizim'}
                          </span>
                        </span>
                        {pending > 0 && (
                          <span className="text-[9px] font-mono font-bold text-white bg-red-500 rounded-full px-1.5 py-0.5 shrink-0">{pending}</span>
                        )}
                        <span
                          title={a.lastSyncError ? `Gabim: ${a.lastSyncError}` : a.lastSyncedAt ? `Sinkronizuar ${fmtDate(a.lastSyncedAt)}` : 'Pa sinkronizim'}
                          className={`w-1.5 h-1.5 rounded-full shrink-0 ${a.lastSyncError ? 'bg-red-500' : a.lastSyncedAt ? 'bg-emerald-500' : 'bg-border'}`}
                        />
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Selected location */}
            {selected ? (
              <div className="space-y-4 min-w-0">
                {/* Summary strip */}
                <div className="bg-card border border-border rounded-xl px-5 py-4 flex flex-wrap gap-5 items-center">
                  <div className="flex flex-col items-center gap-0.5 pr-5 border-r border-border/60">
                    <span className="text-3xl font-mono font-bold leading-none">{selected.rating != null ? selected.rating.toFixed(1) : '—'}</span>
                    <Stars n={Math.round(selected.rating || 0)} />
                    <span className="text-[10px] font-semibold text-muted-foreground">{selected.reviewCount} reviews gjithsej</span>
                  </div>
                  <div className="flex-1 min-w-[200px] flex flex-col gap-1">
                    {dist.map((d) => (
                      <button
                        key={d.star}
                        onClick={() => { setStarFilter(starFilter === d.star ? null : d.star); setFilter('all'); }}
                        title={`Filtro reviews me ${d.star} yje`}
                        className={`flex items-center gap-2 rounded-md px-1.5 py-0.5 transition-colors ${starFilter === d.star ? 'bg-primary/10' : 'hover:bg-accent/60'}`}
                      >
                        <span className={`text-[10px] font-mono font-bold w-6 text-left ${starFilter === d.star ? 'text-primary' : 'text-muted-foreground'}`}>{d.star}★</span>
                        <span className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                          <span
                            className={`block h-full rounded-full ${d.star >= 4 ? 'bg-emerald-500' : d.star === 3 ? 'bg-amber-400' : 'bg-red-500'}`}
                            style={{ width: `${d.pct}%` }}
                          />
                        </span>
                        <span className={`text-[10px] font-mono font-bold w-6 text-right ${starFilter === d.star ? 'text-primary' : 'text-muted-foreground'}`}>{d.n}</span>
                      </button>
                    ))}
                  </div>
                  <div className="flex flex-col gap-1 pl-5 border-l border-border/60">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Norma e përgjigjes</span>
                    <span className={`text-xl font-mono font-bold ${replyRate >= 80 ? 'text-emerald-600' : replyRate >= 50 ? 'text-amber-500' : 'text-red-500'}`}>{replyRate}%</span>
                    {canManage && (
                      <button onClick={() => handleSync(selected.id)} disabled={busy !== null} className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline disabled:opacity-50">
                        <RefreshCw className={`w-3 h-3 ${busy === selected.id ? 'animate-spin' : ''}`} /> Sinkronizo tani
                      </button>
                    )}
                  </div>
                </div>

                {/* Filters */}
                <div className="flex items-center gap-2 flex-wrap">
                  {FILTERS.map((f) => {
                    const active = filter === f.key && !starFilter;
                    return (
                      <button
                        key={f.key}
                        onClick={() => { setFilter(f.key); setStarFilter(null); }}
                        className={`rounded-full px-3 py-1.5 text-[11.5px] font-semibold border transition-colors ${active ? 'bg-foreground text-background border-foreground' : 'bg-card text-foreground border-border hover:border-primary'}`}
                      >
                        {f.label}
                      </button>
                    );
                  })}
                  <span className="flex-1" />
                  <span className="text-[11px] font-semibold text-muted-foreground">{shown.length} reviews</span>
                </div>

                {/* Review cards */}
                {reviewsLoading ? (
                  <p className="text-sm text-muted-foreground py-8 text-center">Duke ngarkuar reviews…</p>
                ) : shown.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-8 text-center bg-card border border-dashed border-border rounded-xl">
                    {selReviews.length === 0 ? 'Ende pa reviews të sinkronizuara — kliko "Sinkronizo tani".' : 'Asnjë review nuk përputhet me filtrin.'}
                  </p>
                ) : (
                  <div className="space-y-3">
                    {shown.map((r) => {
                      const replied = !!r.replyComment;
                      const reported = r.reported;
                      const replying = replyingId === r.id;
                      const reporting = reportingId === r.id;
                      return (
                        <div key={r.id} className={`bg-card border rounded-xl px-4 py-4 sm:px-5 ${reported ? 'border-amber-300/60' : !replied && r.starRating <= 2 ? 'border-red-300/60' : 'border-border'}`}>
                          <div className="flex items-start gap-3">
                            {r.authorPhotoUrl ? (
                              <img src={r.authorPhotoUrl} alt="" className="w-9 h-9 rounded-full object-cover shrink-0" referrerPolicy="no-referrer" />
                            ) : (
                              <span className="w-9 h-9 rounded-full bg-muted-foreground/70 text-white text-[11px] font-extrabold flex items-center justify-center shrink-0">{initials(r.author)}</span>
                            )}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm font-bold">{r.author}</span>
                                <Stars n={r.starRating} />
                                <span className="text-[10.5px] font-semibold text-muted-foreground/70">{fmtDate(r.googleCreateTime)}</span>
                                {isNewReview(r) && (
                                  <span className="text-[9px] font-extrabold uppercase tracking-wider text-primary bg-primary/10 rounded px-1.5 py-0.5">E re</span>
                                )}
                                {r.repliedVia === 'ai-auto' && (
                                  <span className="text-[9px] font-extrabold uppercase tracking-wider text-violet-600 bg-violet-500/10 rounded px-1.5 py-0.5">✦ Auto-AI</span>
                                )}
                                {reported && (
                                  <span className="text-[9px] font-extrabold uppercase tracking-wider text-amber-700 bg-amber-500/10 rounded px-1.5 py-0.5">⚑ Raportuar — {reported.reason}</span>
                                )}
                              </div>
                              {r.comment && <p className="text-[13px] text-foreground/80 leading-relaxed mt-1.5">{r.comment}</p>}

                              {/* Existing public reply */}
                              {replied && (
                                <div className="mt-2.5 bg-muted/50 rounded-lg px-3 py-2.5 flex gap-2">
                                  <CornerDownRight className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" />
                                  <div className="min-w-0">
                                    <p className="text-[10.5px] font-extrabold text-primary">Përgjigjja juaj{r.replyTime ? ` · ${fmtDate(r.replyTime)}` : ''}</p>
                                    <p className="text-xs text-foreground/80 leading-relaxed mt-0.5">{r.replyComment}</p>
                                  </div>
                                </div>
                              )}

                              {/* Reply editor */}
                              {replying && (
                                <div className="mt-2.5 space-y-2">
                                  {aiDrafts[r.id] ? (
                                    <button
                                      onClick={() => setDrafts((p) => ({ ...p, [r.id]: aiDrafts[r.id] }))}
                                      className="block w-full text-left border border-dashed border-primary/40 bg-primary/5 rounded-lg px-3 py-2 hover:border-primary"
                                    >
                                      <span className="text-[10px] font-extrabold uppercase tracking-wider text-primary">✦ Sugjerim AI — kliko për ta përdorur</span>
                                      <span className="block text-xs text-foreground/80 leading-relaxed mt-0.5">{aiDrafts[r.id]}</span>
                                    </button>
                                  ) : (
                                    <button
                                      onClick={() => handleAiSuggest(r, 'reply')}
                                      disabled={busy !== null}
                                      className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-primary border border-dashed border-primary/40 rounded-lg px-3 py-1.5 hover:border-primary disabled:opacity-50"
                                    >
                                      <Sparkles className={`w-3.5 h-3.5 ${busy === `ai-${r.id}` ? 'animate-pulse' : ''}`} />
                                      {busy === `ai-${r.id}` ? 'Duke gjeneruar…' : 'Gjenero sugjerim AI'}
                                    </button>
                                  )}
                                  <textarea
                                    value={drafts[r.id] || ''}
                                    onChange={(e) => setDrafts((p) => ({ ...p, [r.id]: e.target.value }))}
                                    placeholder="Shkruaj përgjigjen publike…"
                                    className="w-full min-h-[64px] text-base sm:text-sm rounded-lg border border-border bg-background px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y"
                                  />
                                  <div className="flex gap-2">
                                    <button
                                      onClick={() => handleSendReply(r)}
                                      disabled={busy !== null || !(drafts[r.id] || '').trim()}
                                      className="inline-flex items-center gap-1.5 rounded-lg bg-primary text-primary-foreground px-3.5 py-1.5 text-xs font-bold disabled:opacity-50"
                                    >
                                      <Send className="w-3 h-3" /> {busy === `reply-${r.id}` ? 'Duke publikuar…' : 'Publiko përgjigjen'}
                                    </button>
                                    <button onClick={() => setReplyingId(null)} className="rounded-lg border border-border px-3 py-1.5 text-xs font-bold text-muted-foreground">Anulo</button>
                                  </div>
                                </div>
                              )}

                              {/* Report editor */}
                              {reporting && (
                                <div className="mt-2.5 border border-amber-300/60 bg-amber-500/5 rounded-xl px-3.5 py-3 space-y-2.5">
                                  <p className="text-[11px] font-extrabold text-amber-700 flex items-center gap-1"><Flag className="w-3 h-3" /> Raporto këtë review te Google</p>
                                  <div className="flex gap-1.5 flex-wrap">
                                    {REPORT_REASONS.map((reason) => {
                                      const on = (reportReasons[r.id] || REPORT_REASONS[0]) === reason;
                                      return (
                                        <button
                                          key={reason}
                                          onClick={() => setReportReasons((p) => ({ ...p, [r.id]: reason }))}
                                          className={`rounded-full px-2.5 py-1 text-[10.5px] font-bold border ${on ? 'bg-amber-600 text-white border-amber-600' : 'bg-card text-amber-700 border-amber-300/60'}`}
                                        >
                                          {reason}
                                        </button>
                                      );
                                    })}
                                  </div>
                                  {aiReports[r.id] ? (
                                    <button
                                      onClick={() => setReportDrafts((p) => ({ ...p, [r.id]: aiReports[r.id] }))}
                                      className="block w-full text-left border border-dashed border-amber-400/60 bg-amber-500/5 rounded-lg px-3 py-2 hover:border-amber-500"
                                    >
                                      <span className="text-[10px] font-extrabold uppercase tracking-wider text-amber-700">✦ Analizë AI — kliko për ta përdorur si argumentim</span>
                                      <span className="block text-xs text-foreground/80 leading-relaxed mt-0.5">{aiReports[r.id]}</span>
                                    </button>
                                  ) : (
                                    <button
                                      onClick={() => handleAiSuggest(r, 'report')}
                                      disabled={busy !== null}
                                      className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-amber-700 border border-dashed border-amber-400/60 rounded-lg px-3 py-1.5 hover:border-amber-500 disabled:opacity-50"
                                    >
                                      <Sparkles className={`w-3.5 h-3.5 ${busy === `ai-${r.id}` ? 'animate-pulse' : ''}`} />
                                      {busy === `ai-${r.id}` ? 'Duke analizuar…' : 'Analizë AI (a ka bazë raportimi?)'}
                                    </button>
                                  )}
                                  <textarea
                                    value={reportDrafts[r.id] || ''}
                                    onChange={(e) => setReportDrafts((p) => ({ ...p, [r.id]: e.target.value }))}
                                    placeholder="Argumentimi për Google (rrit shanset e heqjes)…"
                                    className="w-full min-h-[54px] text-base sm:text-sm rounded-lg border border-amber-300/60 bg-background px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400/40 resize-y"
                                  />
                                  <p className="text-[10.5px] text-muted-foreground leading-relaxed">
                                    Google s'ofron API raportimi — pas shënimit hapet vegla zyrtare e Google ku e dërgon me argumentimin e përgatitur.
                                  </p>
                                  <div className="flex gap-2">
                                    <button
                                      onClick={() => handleSendReport(r)}
                                      disabled={busy !== null}
                                      className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 text-white px-3.5 py-1.5 text-xs font-bold disabled:opacity-50"
                                    >
                                      <Flag className="w-3 h-3" /> {busy === `report-${r.id}` ? 'Duke shënuar…' : 'Shëno + hap te Google'}
                                    </button>
                                    <button onClick={() => setReportingId(null)} className="rounded-lg border border-border px-3 py-1.5 text-xs font-bold text-muted-foreground">Anulo</button>
                                  </div>
                                </div>
                              )}
                            </div>

                            {/* Right-side actions */}
                            <div className="flex flex-col items-end gap-1.5 shrink-0">
                              {!replied && !replying && !reporting && !reported && (
                                <span className="text-[9px] font-extrabold uppercase tracking-wider text-red-500 bg-red-500/10 rounded px-1.5 py-0.5">Pa përgjigje</span>
                              )}
                              {!replied && !replying && !reporting && canManage && (
                                <button
                                  onClick={() => { setReplyingId(r.id); setReportingId(null); if (r.aiSuggestion) setAiDrafts((p) => ({ ...p, [r.id]: r.aiSuggestion! })); }}
                                  className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-bold text-primary hover:border-primary whitespace-nowrap"
                                >
                                  <CornerDownRight className="w-3 h-3" /> Përgjigju
                                </button>
                              )}
                              {!reported && !reporting && !replying && canManage && (
                                <button
                                  onClick={() => { setReportingId(r.id); setReplyingId(null); if (r.aiReportAnalysis) setAiReports((p) => ({ ...p, [r.id]: r.aiReportAnalysis! })); }}
                                  className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-bold text-amber-700 hover:border-amber-500 whitespace-nowrap"
                                >
                                  <Flag className="w-3 h-3" /> Raporto
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : !accountsLoading && accounts.length > 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">Zgjidh një profil nga lista.</p>
            ) : null}
          </div>
        </>
      )}

      {/* ═══ POSTS TAB ═══ */}
      {tab === 'posts' && (
        <div className="grid lg:grid-cols-[1fr,340px] gap-4 items-start">
          <div className="space-y-3">
            <h3 className="text-sm font-bold">Postimet e publikuara</h3>
            {sortedPosts.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center bg-card border border-dashed border-border rounded-xl">
                Ende pa postime. Krijo të parin nga paneli djathtas.
              </p>
            ) : (
              <div className="space-y-2.5">
                {sortedPosts.map((p) => (
                  <div key={p.id} className="bg-card border border-border rounded-xl px-4 py-3.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-bold">{p.locationTitle}</span>
                      <span className="text-[10px] text-muted-foreground">{fmtDate(p.createdAt)}</span>
                      <span className={`text-[9px] font-extrabold uppercase tracking-wider rounded px-1.5 py-0.5 ${p.state === 'REJECTED' ? 'text-red-600 bg-red-500/10' : 'text-emerald-700 bg-emerald-500/10'}`}>{p.state || 'LIVE'}</span>
                      {p.searchUrl && (
                        <a href={p.searchUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] text-primary inline-flex items-center gap-0.5 hover:underline">
                          Shiko në Google <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                      )}
                    </div>
                    <p className="text-[13px] text-foreground/80 leading-relaxed mt-1.5 whitespace-pre-wrap">{p.summary}</p>
                    {p.ctaType && <p className="text-[11px] text-muted-foreground mt-1">Butoni: {CTA_OPTIONS.find((c) => c.value === p.ctaType)?.label || p.ctaType}{p.ctaUrl ? ` → ${p.ctaUrl}` : ''}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-card border border-border rounded-xl p-4 space-y-3">
            <h3 className="text-sm font-bold flex items-center gap-1.5"><Megaphone className="w-4 h-4 text-primary" /> Postim i ri në Google</h3>
            <select
              value={selectedId || ''}
              onChange={(e) => setSelectedId(e.target.value || null)}
              className="w-full text-sm rounded-lg border border-border bg-background px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              <option value="">— Zgjidh profilin —</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <textarea
              value={postSummary}
              onChange={(e) => setPostSummary(e.target.value)}
              placeholder="Teksti i postimit (max 1500 karaktere)…"
              maxLength={1500}
              className="w-full min-h-[110px] text-base sm:text-sm rounded-lg border border-border bg-background px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y"
            />
            <div className="grid grid-cols-2 gap-2">
              <select value={postCta} onChange={(e) => setPostCta(e.target.value)} className="text-sm rounded-lg border border-border bg-background px-3 py-2">
                {CTA_OPTIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
              <input
                value={postCtaUrl}
                onChange={(e) => setPostCtaUrl(e.target.value)}
                placeholder="URL e butonit"
                disabled={!postCta || postCta === 'CALL'}
                className="text-sm rounded-lg border border-border bg-background px-3 py-2 disabled:opacity-50"
              />
            </div>
            <input
              value={postMediaUrl}
              onChange={(e) => setPostMediaUrl(e.target.value)}
              placeholder="URL e fotos (https, opsionale)"
              className="w-full text-sm rounded-lg border border-border bg-background px-3 py-2"
            />
            <button
              onClick={handleCreatePost}
              disabled={busy !== null || !selectedId || !postSummary.trim() || !canManage}
              className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm font-bold disabled:opacity-50"
            >
              <Send className="w-3.5 h-3.5" /> {busy === 'create-post' ? 'Duke publikuar…' : 'Publiko në Google'}
            </button>
            <p className="text-[10.5px] text-muted-foreground leading-relaxed">
              Postimi shfaqet te profili i biznesit në Google Search &amp; Maps. Fotoja duhet të jetë URL publike https.
            </p>
          </div>
        </div>
      )}

      {/* ═══ SETTINGS TAB ═══ */}
      {tab === 'settings' && (
        <div className="grid lg:grid-cols-[1fr,340px] gap-4 items-start">
          <div className="space-y-4">
            {/* Credentials */}
            <div className="bg-card border border-border rounded-xl p-5 space-y-4">
              <div className="flex items-center gap-3">
                <span className="w-9 h-9 rounded-lg bg-primary/10 text-primary font-extrabold flex items-center justify-center">G</span>
                <div className="flex-1">
                  <h3 className="text-sm font-bold">Google Business Profile API</h3>
                  <p className="text-[11.5px] text-muted-foreground">Kredencialet OAuth të tenant-it tuaj — Google jep akses te reviews vetëm me OAuth, jo me API key.</p>
                </div>
                <span className={`inline-flex items-center gap-1.5 text-[10.5px] font-extrabold rounded-full px-2.5 py-1 ${settings?.hasGmbClientSecret || accounts.length ? 'text-emerald-700 bg-emerald-500/10' : 'text-muted-foreground bg-muted'}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${settings?.hasGmbClientSecret || accounts.length ? 'bg-emerald-500' : 'bg-muted-foreground/50'}`} />
                  {settings?.hasGmbClientSecret ? 'E konfiguruar' : accounts.length ? 'Përmes platformës' : 'E pakonfiguruar'}
                </span>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[10.5px] font-extrabold text-foreground/70 block mb-1">OAuth Client ID</label>
                  <input
                    value={clientIdInput}
                    onChange={(e) => setClientIdInput(e.target.value)}
                    placeholder="xxxx.apps.googleusercontent.com"
                    disabled={!canManage}
                    className="w-full text-sm font-mono rounded-lg border border-border bg-background px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-60"
                  />
                </div>
                <div>
                  <label className="text-[10.5px] font-extrabold text-foreground/70 block mb-1">OAuth Client Secret</label>
                  <input
                    type="password"
                    value={clientSecretInput}
                    onChange={(e) => setClientSecretInput(e.target.value)}
                    placeholder={settings?.hasGmbClientSecret ? '••••••••••••  (i ruajtur)' : 'GOCSPX-…'}
                    disabled={!canManage}
                    className="w-full text-sm font-mono rounded-lg border border-border bg-background px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-60"
                  />
                  {settings?.hasGmbClientSecret && (
                    <p className="text-[10.5px] text-emerald-600 flex items-center gap-1 mt-1">
                      <Shield className="w-3 h-3" /> Kredencial i ruajtur në kasafortën e serverit — lëre bosh për të mos e ndryshuar.
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {canManage && (
                  <button onClick={handleSaveCredentials} disabled={busy !== null} className="rounded-lg bg-primary text-primary-foreground px-4 py-2 text-xs font-bold disabled:opacity-50">
                    {busy === 'save-creds' ? 'Duke ruajtur…' : 'Ruaj kredencialet'}
                  </button>
                )}
                <button onClick={handleTest} disabled={busy !== null} className="rounded-lg border border-border px-4 py-2 text-xs font-bold hover:border-primary disabled:opacity-50">
                  {busy === 'test' ? 'Duke testuar…' : 'Testo lidhjen'}
                </button>
                {testResult && (
                  <span className={`text-[11.5px] font-semibold ${testResult.startsWith('✓') ? 'text-emerald-600' : 'text-red-500'}`}>{testResult}</span>
                )}
              </div>
              <p className="text-[10.5px] text-muted-foreground leading-relaxed">
                Krijo një projekt në Google Cloud Console, aktivizo <strong>Business Profile API</strong> (kërkon aprovim nga Google),
                shto redirect URI <code className="font-mono bg-muted px-1 rounded">{`${window.location.origin}/api/gmb?action=oauth-callback`}</code> dhe
                vendos këtu Client ID + Secret. Pa to, përdoren kredencialet e përbashkëta të platformës (nëse janë vendosur).
              </p>
            </div>

            {/* Behavior */}
            <div className="bg-card border border-border rounded-xl p-5 space-y-1">
              <h3 className="text-sm font-bold mb-2">Sinkronizimi &amp; automatizimi</h3>
              {[
                {
                  key: 'gmbAutoSync', label: 'Sinkronizim automatik', desc: 'Thirr API-në çdo orë për reviews të reja',
                  value: settings?.gmbAutoSync !== false,
                },
                {
                  key: 'gmbNotifyNegative', label: 'Njoftim për reviews negative', desc: 'Email + njoftim për Admin/Manager kur vjen review ≤ 2★',
                  value: settings?.gmbNotifyNegative !== false,
                },
              ].map((s) => (
                <div key={s.key} className="flex items-center gap-3 py-2.5 border-b border-border/40">
                  <div className="flex-1">
                    <p className="text-xs font-bold">{s.label}</p>
                    <p className="text-[11px] text-muted-foreground">{s.desc}</p>
                  </div>
                  <button
                    onClick={() => canManage && handleSaveBehavior({ [s.key]: !s.value })}
                    disabled={!canManage}
                    role="switch"
                    aria-checked={s.value}
                    aria-label={s.label}
                    className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${s.value ? 'bg-primary' : 'bg-muted-foreground/30'} disabled:opacity-50`}
                  >
                    <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${s.value ? 'left-[18px]' : 'left-0.5'}`} />
                  </button>
                </div>
              ))}
              <div className="flex items-center gap-3 py-2.5 border-b border-border/40">
                <div className="flex-1">
                  <p className="text-xs font-bold">Auto-përgjigje me AI</p>
                  <p className="text-[11px] text-muted-foreground">Cron-i publikon vetë përgjigjen AI për reviews të reja pa përgjigje</p>
                </div>
                <select
                  value={settings?.gmbAutoReply || 'off'}
                  onChange={(e) => handleSaveBehavior({ gmbAutoReply: e.target.value })}
                  disabled={!canManage}
                  className="text-xs rounded-lg border border-border bg-background px-2.5 py-1.5 disabled:opacity-50"
                >
                  <option value="off">Fikur (vetëm sugjerime)</option>
                  <option value="positive">Vetëm 4-5★</option>
                  <option value="all">Të gjitha (kujdes!)</option>
                </select>
              </div>
              <div className="py-2.5">
                <p className="text-xs font-bold mb-1">Konteksti për AI</p>
                <textarea
                  value={aiContextInput}
                  onChange={(e) => setAiContextInput(e.target.value)}
                  onBlur={() => canManage && aiContextInput !== (settings?.gmbAiContext || '') && handleSaveBehavior({ gmbAiContext: aiContextInput })}
                  placeholder="P.sh.: Klinikë dentare në Tiranë; toni i ngrohtë; firmos 'Ekipi i Klinikës'; oraret 9-18…"
                  disabled={!canManage}
                  className="w-full min-h-[64px] text-base sm:text-sm rounded-lg border border-border bg-background px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y disabled:opacity-60"
                />
                <p className="text-[10.5px] text-muted-foreground mt-1">Futet në çdo prompt të AI — përdor çelësin e FivoAI nga Cilësimet → Integrime.</p>
              </div>
            </div>
          </div>

          {/* Sync registry */}
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold">Regjistri i sinkronizimeve</h3>
              {canManage && accounts.length > 0 && (
                <button onClick={() => handleSync()} disabled={busy !== null} className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline disabled:opacity-50">
                  <RefreshCw className={`w-3 h-3 ${busy === 'sync-all' ? 'animate-spin' : ''}`} /> Sinkronizo të gjitha
                </button>
              )}
            </div>
            {accounts.length === 0 ? (
              <p className="text-xs text-muted-foreground py-6 text-center">Asnjë profil i lidhur ende.</p>
            ) : (
              <div className="divide-y divide-border/40 mt-1">
                {accounts.map((a) => (
                  <div key={a.id} className="flex items-center gap-2.5 py-2.5">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${a.lastSyncError ? 'bg-red-500' : a.lastSyncedAt ? 'bg-emerald-500' : 'bg-amber-400'}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[11.5px] font-bold truncate">{a.name}</p>
                      <p className="text-[10px] text-muted-foreground truncate">
                        {a.lastSyncError
                          ? `⚠ ${a.lastSyncError}`
                          : a.lastSyncedAt
                            ? `Sinkronizuar ${new Date(a.lastSyncedAt).toLocaleString('sq-AL')}`
                            : 'Në pritje të sinkronizimit të parë'}
                      </p>
                    </div>
                    {canManage && (
                      <button onClick={() => handleDisconnect(a.id)} disabled={busy !== null} title="Shkëput profilin" className="p-1.5 rounded-lg hover:bg-red-500/10 text-muted-foreground hover:text-red-500 disabled:opacity-50">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
            <p className="text-[10.5px] text-muted-foreground mt-3 leading-relaxed">
              Sinkronizimi automatik ekzekutohet çdo orë nga serveri. Shkëputja ruan historikun e reviews por ndal sinkronizimin.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default GmbReviewsView;
