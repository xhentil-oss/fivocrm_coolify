import React, { useMemo } from 'react';
import { useCollection } from '../hooks/useFirestore';
import {
  BarChart as RBarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  AreaChart, Area, PieChart, Pie, Legend,
} from 'recharts';
import { Mail, Send, Eye, MousePointerClick, Zap, TrendingUp, Info } from 'lucide-react';
import type { EmailCampaign, CampaignEnrollment, WhatsAppBroadcast } from '../types';

// Brand palette (navy + cyan) — see brand tokens. Categorical hues in fixed order.
const CYAN = '#0EA5E9';
const NAVY = '#12468C';
const GREEN = '#22c55e';
const AMBER = '#f59e0b';
const SLATE = '#94a3b8';

const MONTHS_SQ = ['Jan', 'Shk', 'Mar', 'Pri', 'Maj', 'Qer', 'Kor', 'Gus', 'Sht', 'Tet', 'Nën', 'Dhj'];
const toMs = (v: any): number => (v?.toDate ? v.toDate().getTime() : v ? new Date(v).getTime() : 0);
const pct = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 1000) / 10 : 0);

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

const MarketingAnalytics: React.FC = () => {
  const { data: campaigns } = useCollection<EmailCampaign>('emailCampaigns', { orderBy: { field: 'createdAt', direction: 'desc' } });
  const { data: enrollments } = useCollection<CampaignEnrollment>('campaignEnrollments');
  const { data: broadcasts } = useCollection<WhatsAppBroadcast>('waBroadcasts');

  const m = useMemo(() => {
    const cs = campaigns || [];
    const sent = cs.reduce((a, c) => a + (c.sentCount || 0), 0);
    const delivered = cs.reduce((a, c) => a + (c.deliveredCount || 0), 0);
    const opens = cs.reduce((a, c) => a + (c.openCount || 0), 0);
    const clicks = cs.reduce((a, c) => a + (c.clickCount || 0), 0);
    const automations = cs.filter((c) => c.trigger === 'purchase');
    const activeAutomations = automations.filter((c) => c.status === 'active').length;
    const waSent = (broadcasts || []).reduce((a, b) => a + (b.sentCount || 0), 0);

    // Sent by month (last 6 months) keyed off createdAt.
    const now = new Date();
    const buckets: { key: string; label: string; value: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      buckets.push({ key: `${d.getFullYear()}-${d.getMonth()}`, label: MONTHS_SQ[d.getMonth()], value: 0 });
    }
    const byKey = new Map(buckets.map((b) => [b.key, b]));
    for (const c of cs) {
      const ms = toMs(c.createdAt);
      if (!ms) continue;
      const d = new Date(ms);
      const b = byKey.get(`${d.getFullYear()}-${d.getMonth()}`);
      if (b) b.value += c.sentCount || 0;
    }

    // Top campaigns by emails sent.
    const topSent = [...cs]
      .filter((c) => (c.sentCount || 0) > 0)
      .sort((a, b) => (b.sentCount || 0) - (a.sentCount || 0))
      .slice(0, 8)
      .map((c) => ({ label: c.name.length > 14 ? c.name.slice(0, 13) + '…' : c.name, value: c.sentCount || 0 }));

    // Enrollment funnel for automations.
    const en = enrollments || [];
    const enrollByStatus = [
      { label: 'Aktive', value: en.filter((e) => e.status === 'active').length, color: CYAN },
      { label: 'Përfunduar', value: en.filter((e) => e.status === 'completed').length, color: GREEN },
      { label: 'Ndaluar', value: en.filter((e) => e.status === 'stopped').length, color: SLATE },
    ].filter((s) => s.value > 0);

    // Engagement per campaign (only those that sent something).
    const perCampaign = cs
      .filter((c) => (c.sentCount || 0) > 0)
      .map((c) => ({
        id: c.id,
        name: c.name,
        purchase: c.trigger === 'purchase',
        sent: c.sentCount || 0,
        openRate: pct(c.openCount || 0, c.sentCount || 0),
        clickRate: pct(c.clickCount || 0, c.sentCount || 0),
      }));

    return {
      sent, delivered, opens, clicks, waSent,
      openRate: pct(opens, sent), clickRate: pct(clicks, sent), ctr: pct(clicks, opens),
      totalCampaigns: cs.length, activeAutomations, totalEnrollments: en.length,
      sentByMonth: buckets, topSent, enrollByStatus, perCampaign,
      hasTracking: opens + clicks > 0,
    };
  }, [campaigns, enrollments, broadcasts]);

  const empty = (campaigns || []).length === 0;

  return (
    <div className="space-y-5">
      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <StatTile icon={Send} label="Email dërguar" value={m.sent.toLocaleString()} sub={`${m.totalCampaigns} fushata`} tint={CYAN} />
        <StatTile icon={Eye} label="Rate hapjeje" value={`${m.openRate}%`} sub={`${m.opens.toLocaleString()} hapje`} tint={NAVY} />
        <StatTile icon={MousePointerClick} label="Rate klikimi" value={`${m.clickRate}%`} sub={`${m.clicks.toLocaleString()} klikime · CTR ${m.ctr}%`} tint={GREEN} />
        <StatTile icon={Zap} label="Automatizime" value={String(m.activeAutomations)} sub={`${m.totalEnrollments} regjistrime`} tint={AMBER} />
        <StatTile icon={Mail} label="WhatsApp dërguar" value={m.waSent.toLocaleString()} tint={SLATE} />
      </div>

      {empty && (
        <div className="border border-border rounded-lg p-8 text-center text-sm text-muted-foreground">
          Ende s’ka fushata. Krijo një fushatë te tab-i <strong>Fushata Email</strong> për të parë statistikat këtu.
        </div>
      )}

      {!empty && !m.hasTracking && (
        <div className="flex gap-2 text-[12px] px-3 py-2 rounded-md bg-muted/60 border border-border text-muted-foreground">
          <Info className="w-4 h-4 shrink-0 mt-0.5" />
          <span>Ende s’ka të dhëna hapjeje/klikimi. Konfiguro webhook-un e ofruesit (Resend/SendGrid/Mailgun) që open/click të regjistrohen automatikisht.</span>
        </div>
      )}

      {!empty && (
        <>
          <div className="grid lg:grid-cols-2 gap-4">
            {/* Emails sent by month */}
            <div className="border border-border rounded-xl p-4 bg-card">
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-1.5"><TrendingUp className="w-4 h-4 text-primary" /> Email të dërguar (6 muajt e fundit)</h3>
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={m.sentByMonth} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="mkt-grad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={CYAN} stopOpacity={0.3} />
                      <stop offset="100%" stopColor={CYAN} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={36} allowDecimals={false} />
                  <Tooltip formatter={(v: number) => [v.toLocaleString(), 'Dërguar']} />
                  <Area type="monotone" dataKey="value" stroke={CYAN} strokeWidth={2.5} fill="url(#mkt-grad)" dot={{ r: 3, fill: '#fff', stroke: CYAN, strokeWidth: 2 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {/* Automation funnel OR top campaigns */}
            <div className="border border-border rounded-xl p-4 bg-card">
              {m.enrollByStatus.length > 0 ? (
                <>
                  <h3 className="text-sm font-semibold mb-3 flex items-center gap-1.5"><Zap className="w-4 h-4 text-primary" /> Regjistrimet në automatizime</h3>
                  <div className="flex items-center gap-4">
                    <ResponsiveContainer width={150} height={150}>
                      <PieChart>
                        <Pie data={m.enrollByStatus} dataKey="value" nameKey="label" cx="50%" cy="50%" innerRadius="55%" outerRadius="90%" paddingAngle={2} strokeWidth={0}>
                          {m.enrollByStatus.map((s, i) => <Cell key={i} fill={s.color} />)}
                        </Pie>
                        <Tooltip formatter={(v: number) => v.toLocaleString()} />
                        <text x="50%" y="45%" textAnchor="middle" dominantBaseline="middle" className="fill-foreground text-lg font-bold">{m.totalEnrollments}</text>
                        <text x="50%" y="60%" textAnchor="middle" dominantBaseline="middle" className="fill-muted-foreground text-[10px]">Gjithsej</text>
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="space-y-1.5">
                      {m.enrollByStatus.map((s, i) => (
                        <div key={i} className="flex items-center gap-2 text-sm">
                          <div className="w-3 h-3 rounded-sm" style={{ background: s.color }} />
                          <span className="text-muted-foreground">{s.label}</span>
                          <span className="font-medium ml-auto">{s.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <h3 className="text-sm font-semibold mb-3 flex items-center gap-1.5"><Send className="w-4 h-4 text-primary" /> Fushatat kryesore (dërgime)</h3>
                  {m.topSent.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-8 text-center">Asnjë dërgim ende.</p>
                  ) : (
                    <ResponsiveContainer width="100%" height={200}>
                      <RBarChart data={m.topSent} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                        <XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} interval={0} angle={-15} textAnchor="end" height={44} />
                        <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={36} allowDecimals={false} />
                        <Tooltip formatter={(v: number) => [v.toLocaleString(), 'Dërguar']} />
                        <Bar dataKey="value" radius={[4, 4, 0, 0]} fill={CYAN} fillOpacity={0.85} />
                      </RBarChart>
                    </ResponsiveContainer>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Per-campaign engagement table */}
          {m.perCampaign.length > 0 && (
            <div className="border border-border rounded-xl bg-card overflow-hidden">
              <h3 className="text-sm font-semibold px-4 pt-4 pb-2">Angazhimi sipas fushatës</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[11px] uppercase text-muted-foreground border-b border-border">
                      <th className="text-left font-medium px-4 py-2">Fushata</th>
                      <th className="text-left font-medium px-4 py-2">Tipi</th>
                      <th className="text-right font-medium px-4 py-2">Dërguar</th>
                      <th className="text-right font-medium px-4 py-2">Hapje</th>
                      <th className="text-right font-medium px-4 py-2">Klikime</th>
                    </tr>
                  </thead>
                  <tbody>
                    {m.perCampaign.map((c) => (
                      <tr key={c.id} className="border-b border-border/60 last:border-0">
                        <td className="px-4 py-2 font-medium truncate max-w-[220px]">{c.name}</td>
                        <td className="px-4 py-2 text-muted-foreground">{c.purchase ? 'Automatike' : 'Manuale'}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{c.sent.toLocaleString()}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{c.openRate}%</td>
                        <td className="px-4 py-2 text-right tabular-nums">{c.clickRate}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default MarketingAnalytics;
