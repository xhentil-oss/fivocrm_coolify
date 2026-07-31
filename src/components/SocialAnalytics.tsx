import React, { useMemo, useState, useEffect } from 'react';
import {
  AreaChart, Area, BarChart as RBarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell,
} from 'recharts';
import {
  Facebook, Instagram, Users, Eye, Heart, TrendingUp, Activity,
  Image as ImageIcon, MapPin, Mail, Loader2, Globe, MousePointerClick, Percent, Search, FileText,
} from 'lucide-react';
import type { SocialSnapshot } from '../types';

// Brand palette (navy + cyan) — same fixed hues as MarketingAnalytics.
const CYAN = '#0EA5E9';
const NAVY = '#12468C';
const PINK = '#E1306C';   // Instagram accent
const GREEN = '#22c55e';
const AMBER = '#f59e0b';
const SLATE = '#94a3b8';

const MONTHS_SQ = ['Janar', 'Shkurt', 'Mars', 'Prill', 'Maj', 'Qershor', 'Korrik', 'Gusht', 'Shtator', 'Tetor', 'Nëntor', 'Dhjetor'];
const periodLabel = (p: string) => {
  const [y, m] = p.split('-').map(Number);
  return `${MONTHS_SQ[(m || 1) - 1]} ${y}`;
};
const fmt = (n?: number) => (n ?? 0).toLocaleString('sq-AL');
const toDate = (v: any): Date | null => (v?.toDate ? v.toDate() : v ? new Date(v) : null);

const StatTile: React.FC<{ icon: React.ComponentType<{ className?: string }>; label: string; value: string; sub?: string; tint?: string }> = ({ icon: Icon, label, value, sub, tint = CYAN }) => (
  <div className="border border-border rounded-xl p-4 bg-card">
    <div className="flex items-center gap-2 text-muted-foreground mb-1">
      <span className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: `${tint}1a`, color: tint }}>
        <Icon className="w-4 h-4" />
      </span>
      <span className="text-[11px] font-medium uppercase tracking-wide">{label}</span>
    </div>
    <p className="text-2xl font-bold text-foreground leading-tight">{value}</p>
    {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
  </div>
);

const PlatformIcon: React.FC<{ platform: string; className?: string }> = ({ platform, className }) =>
  platform === 'instagram' ? <Instagram className={className} />
  : platform === 'search-console' ? <Globe className={className} />
  : <Facebook className={className} />;

// Google Search Console report body (website search visibility).
const SeoReport: React.FC<{ seo: NonNullable<SocialSnapshot['seo']> }> = ({ seo }) => {
  const m = seo.metrics;
  const daily = (seo.daily || []).map((d) => ({ ...d, label: d.date.slice(8) }));
  const topCountries = seo.countries ? Object.entries(seo.countries).sort(([, a], [, b]) => b - a).slice(0, 6) : [];
  const Table: React.FC<{ icon: React.ComponentType<{ className?: string }>; title: string; rows: NonNullable<SocialSnapshot['seo']>['topQueries']; keyLabel: string }> = ({ icon: Icon, title, rows, keyLabel }) => (
    <div className="border border-border rounded-xl bg-card overflow-hidden">
      <h3 className="text-sm font-semibold px-4 pt-4 pb-2 flex items-center gap-1.5"><Icon className="w-4 h-4 text-primary" /> {title}</h3>
      {rows.length === 0 ? <p className="text-sm text-muted-foreground px-4 pb-4">S'ka të dhëna.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase text-muted-foreground border-b border-border">
                <th className="text-left font-medium px-4 py-2">{keyLabel}</th>
                <th className="text-right font-medium px-4 py-2">Klikime</th>
                <th className="text-right font-medium px-4 py-2">Shfaqje</th>
                <th className="text-right font-medium px-4 py-2">CTR</th>
                <th className="text-right font-medium px-4 py-2">Poz.</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 10).map((r, i) => (
                <tr key={i} className="border-b border-border/60 last:border-0">
                  <td className="px-4 py-2 truncate max-w-[260px]" title={r.key}>{r.key}</td>
                  <td className="px-4 py-2 text-right tabular-nums font-medium">{fmt(r.clicks)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{fmt(r.impressions)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{r.ctr}%</td>
                  <td className="px-4 py-2 text-right tabular-nums">{r.position}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile icon={MousePointerClick} label="Klikime" value={fmt(m.clicks)} tint={CYAN} />
        <StatTile icon={Eye} label="Shfaqje" value={fmt(m.impressions)} tint={NAVY} />
        <StatTile icon={Percent} label="CTR" value={`${m.ctr}%`} tint={GREEN} />
        <StatTile icon={TrendingUp} label="Pozicioni mesatar" value={String(m.position)} sub="më i ulët = më mirë" tint={AMBER} />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="border border-border rounded-xl p-4 bg-card">
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-1.5"><MousePointerClick className="w-4 h-4 text-primary" /> Klikime ditore</h3>
          {daily.length ? (
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={daily} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="seo-clicks" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={CYAN} stopOpacity={0.3} />
                    <stop offset="100%" stopColor={CYAN} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} interval={4} />
                <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={40} allowDecimals={false} />
                <Tooltip formatter={(v: number) => [fmt(v), 'Klikime']} labelFormatter={(l) => `Dita ${l}`} />
                <Area type="monotone" dataKey="clicks" stroke={CYAN} strokeWidth={2.5} fill="url(#seo-clicks)" />
              </AreaChart>
            </ResponsiveContainer>
          ) : <p className="text-sm text-muted-foreground py-10 text-center">S'ka të dhëna ditore.</p>}
        </div>
        <div className="border border-border rounded-xl p-4 bg-card">
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-1.5"><Eye className="w-4 h-4 text-primary" /> Shfaqje ditore</h3>
          {daily.length ? (
            <ResponsiveContainer width="100%" height={200}>
              <RBarChart data={daily} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} interval={4} />
                <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={40} allowDecimals={false} />
                <Tooltip formatter={(v: number) => [fmt(v), 'Shfaqje']} labelFormatter={(l) => `Dita ${l}`} />
                <Bar dataKey="impressions" radius={[3, 3, 0, 0]} fill={NAVY} fillOpacity={0.85} />
              </RBarChart>
            </ResponsiveContainer>
          ) : <p className="text-sm text-muted-foreground py-10 text-center">S'ka të dhëna ditore.</p>}
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Table icon={Search} title="Fjalët kyçe kryesore" rows={seo.topQueries || []} keyLabel="Kërkimi" />
        <Table icon={FileText} title="Faqet kryesore" rows={seo.topPages || []} keyLabel="Faqja" />
      </div>

      {topCountries.length > 0 && (
        <div className="border border-border rounded-xl p-4 bg-card">
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-1.5"><MapPin className="w-4 h-4 text-primary" /> Klikime sipas shtetit</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {topCountries.map(([c, n], i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground uppercase">{c}</span>
                <span className="font-medium ml-auto tabular-nums">{fmt(n)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

interface Props {
  snapshots: (SocialSnapshot & { id: string })[];
  loading?: boolean;
  /** Compact = portal (bigger headings handled by caller). */
  emptyHint?: string;
  /** Staff-only: when provided, shows a "Dërgo me email" button for the client. */
  onSendReport?: (customerId: string, period: string) => Promise<void> | void;
}

const SocialAnalytics: React.FC<Props> = ({ snapshots, loading, emptyHint, onSendReport }) => {
  const [sending, setSending] = useState(false);
  // Group snapshots by account so the user can switch between connected profiles.
  const accounts = useMemo(() => {
    const map = new Map<string, { accountId: string; customerId: string; name: string; platform: string; pictureUrl?: string | null; periods: string[] }>();
    for (const s of snapshots) {
      if (!map.has(s.accountId)) {
        map.set(s.accountId, { accountId: s.accountId, customerId: s.customerId, name: s.accountName, platform: s.platform, pictureUrl: s.pictureUrl, periods: [] });
      }
      map.get(s.accountId)!.periods.push(s.period);
    }
    for (const a of map.values()) a.periods.sort((x, y) => y.localeCompare(x)); // newest first
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [snapshots]);

  const [accountId, setAccountId] = useState<string>('');
  const [period, setPeriod] = useState<string>('');

  // Keep the selection valid as data arrives / changes.
  useEffect(() => {
    if (!accounts.length) return;
    const acc = accounts.find((a) => a.accountId === accountId) || accounts[0];
    if (acc.accountId !== accountId) setAccountId(acc.accountId);
    if (!acc.periods.includes(period)) setPeriod(acc.periods[0]);
  }, [accounts, accountId, period]);

  const current = useMemo(
    () => snapshots.find((s) => s.accountId === accountId && s.period === period),
    [snapshots, accountId, period],
  );
  const activeAccount = accounts.find((a) => a.accountId === accountId);

  if (loading) {
    return <div className="border border-border rounded-xl p-10 text-center text-sm text-muted-foreground">Duke ngarkuar raportet…</div>;
  }
  if (!snapshots.length) {
    return (
      <div className="border border-border rounded-xl p-10 text-center">
        <div className="w-12 h-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mx-auto mb-3">
          <Activity className="w-6 h-6" />
        </div>
        <p className="text-sm font-medium text-foreground mb-1">Ende s'ka raporte</p>
        <p className="text-sm text-muted-foreground">{emptyHint || 'Raportet e rrjeteve sociale gjenerohen automatikisht në fund të çdo muaji.'}</p>
      </div>
    );
  }

  const m = current?.metrics;
  const daily = (current?.daily || []).map((d) => ({ ...d, label: d.date.slice(8) })); // day-of-month
  const demo = current?.demographics;

  const genderData = demo?.gender
    ? Object.entries(demo.gender).map(([k, v]) => ({
        label: k === 'M' ? 'Meshkuj' : k === 'F' ? 'Femra' : 'Tjetër', value: v,
        color: k === 'M' ? NAVY : k === 'F' ? PINK : SLATE,
      })).filter((x) => x.value > 0)
    : [];
  const ageData = demo?.age
    ? Object.entries(demo.age).sort(([a], [b]) => a.localeCompare(b)).map(([label, value]) => ({ label, value }))
    : [];
  const topCities = demo?.city
    ? Object.entries(demo.city).sort(([, a], [, b]) => b - a).slice(0, 6)
    : [];

  return (
    <div className="space-y-5">
      {/* Account + period selectors */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5">
          {accounts.map((a) => (
            <button
              key={a.accountId}
              onClick={() => { setAccountId(a.accountId); setPeriod(a.periods[0]); }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                a.accountId === accountId ? 'bg-primary text-primary-foreground border-primary' : 'bg-card border-border text-muted-foreground hover:text-foreground'
              }`}
            >
              <PlatformIcon platform={a.platform} className="w-3.5 h-3.5" />
              <span className="max-w-[140px] truncate">{a.name}</span>
            </button>
          ))}
        </div>
        {activeAccount && activeAccount.periods.length > 0 && (
          <div className="ml-auto flex items-center gap-2">
            {onSendReport && (
              <button
                onClick={async () => {
                  if (!activeAccount || sending) return;
                  setSending(true);
                  try { await onSendReport(activeAccount.customerId, period); }
                  finally { setSending(false); }
                }}
                disabled={sending}
                className="inline-flex items-center gap-1.5 text-sm rounded-lg border border-border bg-card px-3 py-1.5 hover:bg-accent disabled:opacity-50"
                title="Dërgo raportin e këtij muaji te klienti me email"
              >
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
                Dërgo me email
              </button>
            )}
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className="text-sm rounded-lg border border-border bg-card px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary/40"
              aria-label="Zgjidh muajin"
            >
              {activeAccount.periods.map((p) => (
                <option key={p} value={p}>{periodLabel(p)}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {!current ? (
        <div className="border border-border rounded-xl p-8 text-center text-sm text-muted-foreground">
          S'ka të dhëna për këtë muaj.
        </div>
      ) : current.platform === 'search-console' ? (
        current.seo
          ? <SeoReport seo={current.seo} />
          : <div className="border border-border rounded-xl p-8 text-center text-sm text-muted-foreground">S'ka të dhëna për këtë muaj.</div>
      ) : !m ? (
        <div className="border border-border rounded-xl p-8 text-center text-sm text-muted-foreground">
          S'ka të dhëna për këtë muaj.
        </div>
      ) : (
        <>
          {/* KPI row */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatTile icon={Users} label="Ndjekës" value={fmt(m.followers)} sub={`${m.followerGrowth >= 0 ? '+' : ''}${fmt(m.followerGrowth)} këtë muaj`} tint={current.platform === 'instagram' ? PINK : NAVY} />
            <StatTile icon={Eye} label="Reach" value={fmt(m.reach)} sub={`${fmt(m.impressions)} shfaqje`} tint={CYAN} />
            <StatTile icon={Heart} label="Angazhim" value={fmt(m.engagement)} sub={`${m.engagementRate ?? 0}% rate`} tint={GREEN} />
            <StatTile icon={ImageIcon} label="Postime" value={fmt(m.postsCount)} sub={m.profileViews ? `${fmt(m.profileViews)} vizita profili` : undefined} tint={AMBER} />
          </div>

          {/* Trend charts */}
          <div className="grid lg:grid-cols-2 gap-4">
            <div className="border border-border rounded-xl p-4 bg-card">
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-1.5"><TrendingUp className="w-4 h-4 text-primary" /> Reach ditor</h3>
              {daily.length ? (
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={daily} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="soc-reach" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={CYAN} stopOpacity={0.3} />
                        <stop offset="100%" stopColor={CYAN} stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} interval={4} />
                    <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={40} allowDecimals={false} />
                    <Tooltip formatter={(v: number) => [fmt(v), 'Reach']} labelFormatter={(l) => `Dita ${l}`} />
                    <Area type="monotone" dataKey="reach" stroke={CYAN} strokeWidth={2.5} fill="url(#soc-reach)" />
                  </AreaChart>
                </ResponsiveContainer>
              ) : <p className="text-sm text-muted-foreground py-10 text-center">S'ka të dhëna ditore.</p>}
            </div>

            <div className="border border-border rounded-xl p-4 bg-card">
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-1.5"><Activity className="w-4 h-4 text-primary" /> Angazhim ditor</h3>
              {daily.length ? (
                <ResponsiveContainer width="100%" height={200}>
                  <RBarChart data={daily} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} interval={4} />
                    <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={40} allowDecimals={false} />
                    <Tooltip formatter={(v: number) => [fmt(v), 'Angazhim']} labelFormatter={(l) => `Dita ${l}`} />
                    <Bar dataKey="engagement" radius={[3, 3, 0, 0]} fill={GREEN} fillOpacity={0.85} />
                  </RBarChart>
                </ResponsiveContainer>
              ) : <p className="text-sm text-muted-foreground py-10 text-center">S'ka të dhëna ditore.</p>}
            </div>
          </div>

          {/* Demographics */}
          {(genderData.length > 0 || ageData.length > 0 || topCities.length > 0) && (
            <div className="grid lg:grid-cols-3 gap-4">
              {genderData.length > 0 && (
                <div className="border border-border rounded-xl p-4 bg-card">
                  <h3 className="text-sm font-semibold mb-3">Gjinia e audiencës</h3>
                  <div className="flex items-center gap-4">
                    <ResponsiveContainer width={120} height={120}>
                      <PieChart>
                        <Pie data={genderData} dataKey="value" nameKey="label" cx="50%" cy="50%" innerRadius="55%" outerRadius="90%" paddingAngle={2} strokeWidth={0}>
                          {genderData.map((s, i) => <Cell key={i} fill={s.color} />)}
                        </Pie>
                        <Tooltip formatter={(v: number) => fmt(v)} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="space-y-1.5">
                      {genderData.map((s, i) => (
                        <div key={i} className="flex items-center gap-2 text-sm">
                          <span className="w-3 h-3 rounded-sm" style={{ background: s.color }} />
                          <span className="text-muted-foreground">{s.label}</span>
                          <span className="font-medium ml-auto">{fmt(s.value)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {ageData.length > 0 && (
                <div className="border border-border rounded-xl p-4 bg-card">
                  <h3 className="text-sm font-semibold mb-3">Mosha e audiencës</h3>
                  <ResponsiveContainer width="100%" height={120}>
                    <RBarChart data={ageData} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
                      <XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                      <YAxis hide />
                      <Tooltip formatter={(v: number) => [fmt(v), 'Ndjekës']} />
                      <Bar dataKey="value" radius={[3, 3, 0, 0]} fill={NAVY} fillOpacity={0.85} />
                    </RBarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {topCities.length > 0 && (
                <div className="border border-border rounded-xl p-4 bg-card">
                  <h3 className="text-sm font-semibold mb-3 flex items-center gap-1.5"><MapPin className="w-4 h-4 text-primary" /> Qytetet kryesore</h3>
                  <div className="space-y-1.5">
                    {topCities.map(([city, count], i) => (
                      <div key={i} className="flex items-center gap-2 text-sm">
                        <span className="text-muted-foreground truncate">{city}</span>
                        <span className="font-medium ml-auto tabular-nums">{fmt(count)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Top posts */}
          {(current.topPosts || []).length > 0 && (
            <div className="border border-border rounded-xl bg-card overflow-hidden">
              <h3 className="text-sm font-semibold px-4 pt-4 pb-2">Postimet kryesore të muajit</h3>
              <div className="divide-y divide-border/60">
                {current.topPosts.slice(0, 6).map((p) => {
                  const d = toDate(p.timestamp);
                  return (
                    <a
                      key={p.id}
                      href={p.permalink || '#'}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-3 px-4 py-3 hover:bg-accent/50 transition-colors"
                    >
                      {p.thumbnailUrl ? (
                        <img src={p.thumbnailUrl} alt="" className="w-12 h-12 rounded-lg object-cover flex-shrink-0 bg-muted" loading="lazy" />
                      ) : (
                        <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center flex-shrink-0"><ImageIcon className="w-5 h-5 text-muted-foreground" /></div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm truncate">{p.caption || 'Pa përshkrim'}</p>
                        <p className="text-[11px] text-muted-foreground">{d ? d.toLocaleDateString('sq-AL') : ''}{p.mediaType ? ` · ${p.mediaType}` : ''}</p>
                      </div>
                      <div className="flex items-center gap-3 text-[12px] text-muted-foreground flex-shrink-0">
                        <span className="flex items-center gap-1"><Heart className="w-3.5 h-3.5" /> {fmt(p.likes)}</span>
                        <span className="hidden sm:flex items-center gap-1"><Activity className="w-3.5 h-3.5" /> {fmt(p.engagement)}</span>
                      </div>
                    </a>
                  );
                })}
              </div>
            </div>
          )}

          <p className="text-[11px] text-muted-foreground text-center">
            Të dhënat nga Meta (Facebook &amp; Instagram) · përditësuar {toDate(current.fetchedAt)?.toLocaleDateString('sq-AL') || '—'}
          </p>
        </>
      )}
    </div>
  );
};

export default SocialAnalytics;
