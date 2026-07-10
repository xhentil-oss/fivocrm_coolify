import React, { useState, lazy, Suspense } from 'react';
import { Megaphone, Mail, MessageCircle, LayoutTemplate, Send, Info } from 'lucide-react';
import EmailCampaigns from '../components/EmailCampaigns';
import EmailTemplateManager from '../components/EmailTemplateManager';
import { Button } from '../components/ui/button';

// The WhatsApp broadcast composer already exists as a modal; reuse it as-is.
const WhatsappBroadcasts = lazy(() => import('../components/WhatsappBroadcasts'));

type Tab = 'email' | 'whatsapp' | 'templates';

const TABS: { key: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: 'email', label: 'Fushata Email', icon: Mail },
  { key: 'whatsapp', label: 'Fushata WhatsApp', icon: MessageCircle },
  { key: 'templates', label: 'Shabllone', icon: LayoutTemplate },
];

const MarketingView: React.FC = () => {
  const [tab, setTab] = useState<Tab>('email');
  const [waOpen, setWaOpen] = useState(false);

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

      {/* Config note */}
      {tab !== 'whatsapp' && (
        <div className="flex gap-2 text-[12px] px-3 py-2 rounded-md bg-muted/60 border border-border text-muted-foreground">
          <Info className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            Dërgimi kërkon një shërbim email të konfiguruar në Vercel: <code>RESEND_API_KEY</code> + <code>MARKETING_FROM_EMAIL</code> (rekomandohet),
            ose kredencialet <code>SMTP_*</code> si alternativë. Fushatat dërgohen në grupe (batch) përmes cron-it.
          </span>
        </div>
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
