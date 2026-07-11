import React, { useState, lazy, Suspense } from 'react';
import { Link } from 'react-router-dom';
import { Megaphone, Mail, MessageCircle, LayoutTemplate, Send, Info, CheckCircle2, Settings, BarChart3 } from 'lucide-react';
import EmailCampaigns from '../components/EmailCampaigns';
import EmailTemplateManager from '../components/EmailTemplateManager';
import MarketingAnalytics from '../components/MarketingAnalytics';
import { Button } from '../components/ui/button';
import { useTeamSettingsData } from '../hooks/useTeamSettings';

// Which provider the client can tell is configured (env-only setups read as
// "platform default" since the browser can't see server env vars).
const PROVIDER_LABEL: Record<string, string> = {
  resend: 'Resend', sendgrid: 'SendGrid', mailgun: 'Mailgun', smtp: 'SMTP',
};

// The WhatsApp broadcast composer already exists as a modal; reuse it as-is.
const WhatsappBroadcasts = lazy(() => import('../components/WhatsappBroadcasts'));

type Tab = 'analytics' | 'email' | 'whatsapp' | 'templates';

const TABS: { key: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: 'analytics', label: 'Analitika', icon: BarChart3 },
  { key: 'email', label: 'Fushata Email', icon: Mail },
  { key: 'whatsapp', label: 'Fushata WhatsApp', icon: MessageCircle },
  { key: 'templates', label: 'Shabllone', icon: LayoutTemplate },
];

const MarketingView: React.FC = () => {
  const [tab, setTab] = useState<Tab>('analytics');
  const [waOpen, setWaOpen] = useState(false);
  const settings = useTeamSettingsData();

  // Is an email provider configured in Settings? (SMTP needs host+user+pass.)
  const configuredProvider =
    settings?.emailProvider === 'smtp'
      ? (settings?.emailSmtpHost && settings?.emailSmtpUser && settings?.emailSmtpPass ? 'smtp' : null)
      : (settings?.emailApiKey ? (settings?.emailProvider || 'resend') : null);

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-5">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
          <Megaphone className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-bold">Marketing</h1>
          <p className="text-sm text-muted-foreground">Fushata email &amp; WhatsApp drejt lead-eve dhe klientëve.</p>
        </div>
      </div>

      {/* Config note — reflects the provider configured in Settings → Integrime */}
      {(tab === 'email' || tab === 'templates') && (
        configuredProvider ? (
          <div className="flex gap-2 text-[12px] px-3 py-2 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              Ofruesi i email-it: <strong>{PROVIDER_LABEL[configuredProvider] || configuredProvider}</strong>
              {settings?.emailFromEmail ? <> · dërgues <strong>{settings.emailFromEmail}</strong></> : null}.
              {' '}<Link to="/app/settings" className="underline">Ndrysho</Link>
            </span>
          </div>
        ) : (
          <div className="flex gap-2 text-[12px] px-3 py-2 rounded-md bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-400">
            <Info className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              Asnjë ofrues email i konfiguruar. Shko te{' '}
              <Link to="/app/settings" className="underline font-medium inline-flex items-center gap-0.5"><Settings className="w-3 h-3" /> Settings → Integrime</Link>
              {' '}dhe zgjidh një ofrues (Resend, SendGrid, Mailgun ose SMTP) që fushatat të dërgohen.
            </span>
          </div>
        )
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.key ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}>
            <t.icon className="w-4 h-4" /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'analytics' && <MarketingAnalytics />}
      {tab === 'email' && <EmailCampaigns />}
      {tab === 'templates' && <EmailTemplateManager />}
      {tab === 'whatsapp' && (
        <div className="border border-border rounded-lg p-6 text-center space-y-3">
          <MessageCircle className="w-8 h-8 mx-auto text-[#25D366]" />
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Fushatat WhatsApp dërgohen përmes template-ave zyrtare (Meta) ose numrit të lidhur (Baileys),
            duke përdorur të njëjtat segmente audiencash.
          </p>
          <Button onClick={() => setWaOpen(true)} className="bg-[#25D366] hover:bg-[#1da851] text-white">
            <Send className="w-4 h-4 mr-1.5" /> Hap fushatat WhatsApp
          </Button>
        </div>
      )}

      {waOpen && (
        <Suspense fallback={null}>
          <WhatsappBroadcasts onClose={() => setWaOpen(false)} />
        </Suspense>
      )}
    </div>
  );
};

export default MarketingView;
