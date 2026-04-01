import React, { useState, useEffect } from 'react';
import { User, Bell, Lock, Palette, Globe, CreditCard, Key, ExternalLink, CheckCircle2, AlertCircle, Clock, RefreshCw, Play, Zap, Shield, Check, ChevronDown } from 'lucide-react';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Switch } from '../components/ui/switch';
import { Separator } from '../components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Checkbox } from '../components/ui/checkbox';
import { Badge } from '../components/ui/badge';
import { useCollection, useMutation } from '../hooks/useFirestore';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../contexts/PermissionsContext';
import { getDocs, query, where, collection, writeBatch, doc, Timestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { toast } from '../hooks/use-toast';

// ─── CronJobCard sub-component ───────────────────────────────────────────────
interface CronJobCardProps {
  title: string;
  description: string;
  schedule: string;
  icon: React.ReactNode;
  enabled: boolean;
  onToggle: (val: boolean) => void;
  status?: string;
  onRun: () => void;
  lastRun?: { time: string; result: any };
}

const CronJobCard: React.FC<CronJobCardProps> = ({
  title, description, schedule, icon, enabled, onToggle, status, onRun, lastRun,
}) => (
  <Card className="p-6 space-y-4">
    <div className="flex items-start justify-between gap-4">
      <div className="flex items-start gap-3">
        <div className="p-2 bg-muted rounded-lg shrink-0">{icon}</div>
        <div>
          <h3 className="font-semibold text-foreground">{title}</h3>
          <p className="text-sm text-muted-foreground mt-1">{description}</p>
        </div>
      </div>
      <Switch checked={enabled} onCheckedChange={onToggle} />
    </div>
    <Separator />
    <div className="flex items-center justify-between gap-4 flex-wrap">
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock className="w-3 h-3" />
          <span>{schedule}</span>
        </div>
        {lastRun && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CheckCircle2 className="w-3 h-3 text-success" />
            <span>Fundit: {new Date(lastRun.time).toLocaleString('sq-AL')}</span>
            {lastRun.result && (
              <span className="text-success">
                ({Object.entries(lastRun.result)
                  .filter(([k]) => k !== 'success' && k !== 'timestamp')
                  .map(([k, v]) => `${k}: ${v}`)
                  .join(', ')})
              </span>
            )}
          </div>
        )}
      </div>
      <Button
        size="sm"
        variant="outline"
        className="gap-1.5 min-w-[138px]"
        onClick={onRun}
        disabled={status === 'running' || !enabled}
      >
        {status === 'running' ? (
          <><RefreshCw className="w-3 h-3 animate-spin" />Duke ekzekutuar...</>
        ) : status === 'success' ? (
          <><CheckCircle2 className="w-3 h-3 text-success" />U krye!</>
        ) : status === 'error' ? (
          <><AlertCircle className="w-3 h-3 text-destructive" />Gabim</>        ) : (
          <><Play className="w-3 h-3" />Ekzekuto Tani</>
        )}
      </Button>
    </div>
  </Card>
);

// ─── SettingsView ──────────────────────────────────────────────────────────────
const SettingsView: React.FC = () => {
  const [stripePublishableKey, setStripePublishableKey] = useState('');
  const [stripeWebhookSecret, setStripeWebhookSecret] = useState('');
  const [stripeMode, setStripeMode] = useState<'test' | 'live'>('test');
  const [stripeSaved, setStripeSaved] = useState(false);

  // ── Bank Transfer default settings ──
  const [defaultBankName, setDefaultBankName] = useState(() => localStorage.getItem('default_bank_name') || '');
  const [defaultBankIBAN, setDefaultBankIBAN] = useState(() => localStorage.getItem('default_bank_iban') || '');
  const [defaultBankSWIFT, setDefaultBankSWIFT] = useState(() => localStorage.getItem('default_bank_swift') || '');
  const [defaultBankAccountHolder, setDefaultBankAccountHolder] = useState(() => localStorage.getItem('default_bank_holder') || '');
  const [bankSaved, setBankSaved] = useState(false);

  // ── Cron / Automation settings (persisted in localStorage) ──
  const [cronSettings, setCronSettings] = useState<Record<string, any>>(() => {
    try { return JSON.parse(localStorage.getItem('cron_settings') || '{}'); } catch { return {}; }
  });
  const [cronRunStatus, setCronRunStatus] = useState<Record<string, string>>({});

  const getLastRun = (key: string) => {
    try { return JSON.parse(localStorage.getItem('cron_last_runs') || '{}')[key]; } catch { return undefined; }
  };

  const handleRunCron = async (path: string, key: string) => {
    setCronRunStatus(prev => ({ ...prev, [key]: 'running' }));
    try {
      const response = await fetch(path);
      const data = await response.json();
      if (response.ok) {
        setCronRunStatus(prev => ({ ...prev, [key]: 'success' }));
        const runs = JSON.parse(localStorage.getItem('cron_last_runs') || '{}');
        localStorage.setItem('cron_last_runs', JSON.stringify({ ...runs, [key]: { time: new Date().toISOString(), result: data } }));
      } else {
        setCronRunStatus(prev => ({ ...prev, [key]: 'error' }));
      }
    } catch {
      setCronRunStatus(prev => ({ ...prev, [key]: 'error' }));
    }
    setTimeout(() => setCronRunStatus(prev => ({ ...prev, [key]: 'idle' })), 4000);
  };

  const handleToggleCron = (key: string, value: boolean) => {
    const updated = { ...cronSettings, [key]: { ...(cronSettings[key] || {}), enabled: value } };
    setCronSettings(updated);
    localStorage.setItem('cron_settings', JSON.stringify(updated));
  };

  const handleSaveStripeSettings = () => {
    localStorage.setItem('stripe_publishable_key', stripePublishableKey);
    localStorage.setItem('stripe_mode', stripeMode);
    setStripeSaved(true);
    setTimeout(() => setStripeSaved(false), 3000);
  };

  const handleSaveBankSettings = () => {
    localStorage.setItem('default_bank_name', defaultBankName);
    localStorage.setItem('default_bank_iban', defaultBankIBAN);
    localStorage.setItem('default_bank_swift', defaultBankSWIFT);
    localStorage.setItem('default_bank_holder', defaultBankAccountHolder);
    setBankSaved(true);
    setTimeout(() => setBankSaved(false), 3000);
  };

  return (
    <div className="max-w-4xl space-y-8">
      <div>
        <h2 className="text-h2 text-foreground mb-2">Cilësimet</h2>
        <p className="text-body text-muted-foreground">
          Menaxho cilësimet e llogarisë dhe preferencat
        </p>
      </div>

      <Tabs defaultValue="profile" className="space-y-6">
        <TabsList className="bg-muted w-full overflow-x-auto flex-nowrap justify-start sm:justify-center">
          <TabsTrigger value="profile" className="data-[state=active]:bg-background data-[state=active]:text-primary min-w-fit">
            <User className="w-4 h-4 sm:mr-2" />
            <span className="hidden sm:inline">Profili</span>
          </TabsTrigger>
          <TabsTrigger value="notifications" className="data-[state=active]:bg-background data-[state=active]:text-primary min-w-fit">
            <Bell className="w-4 h-4 sm:mr-2" />
            <span className="hidden sm:inline">Njoftimet</span>
          </TabsTrigger>
          <TabsTrigger value="security" className="data-[state=active]:bg-background data-[state=active]:text-primary min-w-fit">
            <Lock className="w-4 h-4 sm:mr-2" />
            <span className="hidden sm:inline">Siguria</span>
          </TabsTrigger>
          <TabsTrigger value="appearance" className="data-[state=active]:bg-background data-[state=active]:text-primary min-w-fit">
            <Palette className="w-4 h-4 sm:mr-2" />
            <span className="hidden sm:inline">Pamja</span>
          </TabsTrigger>
          <TabsTrigger value="integrations" className="data-[state=active]:bg-background data-[state=active]:text-primary min-w-fit">
            <CreditCard className="w-4 h-4 sm:mr-2" />
            <span className="hidden sm:inline">Integrimet</span>
          </TabsTrigger>
          <TabsTrigger value="automation" className="data-[state=active]:bg-background data-[state=active]:text-primary min-w-fit">
            <Zap className="w-4 h-4 sm:mr-2" />
            <span className="hidden sm:inline">Automatizimi</span>
          </TabsTrigger>
          <TabsTrigger value="roles" className="data-[state=active]:bg-background data-[state=active]:text-primary min-w-fit">
            <Shield className="w-4 h-4 sm:mr-2" />
            <span className="hidden sm:inline">Rolet & Lejet</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="space-y-6">
          <Card className="p-6 space-y-6">
            <div>
              <h3 className="text-h4 text-foreground mb-4">Informacioni i Profilit</h3>
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-body-sm text-foreground font-medium">Emri</label>
                    <input
                      type="text"
                      placeholder="Emri"
                      className="w-full h-11 px-4 bg-background border border-border rounded-md text-body text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-body-sm text-foreground font-medium">Mbiemri</label>
                    <input
                      type="text"
                      placeholder="Mbiemri"
                      className="w-full h-11 px-4 bg-background border border-border rounded-md text-body text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-body-sm text-foreground font-medium">Email</label>
                  <input
                    type="email"
                    placeholder="email@shembull.com"
                    className="w-full h-11 px-4 bg-background border border-border rounded-md text-body text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-body-sm text-foreground font-medium">Bio</label>
                  <textarea
                    placeholder="Na trego për veten..."
                    rows={4}
                    className="w-full px-4 py-3 bg-background border border-border rounded-md text-body text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary resize-none"
                  />
                </div>
              </div>
            </div>
            <Separator />
            <div className="flex justify-end gap-3">
              <Button variant="outline" className="bg-background text-foreground border-border hover:bg-muted">
                Anulo
              </Button>
              <Button className="bg-primary text-primary-foreground hover:bg-primary-hover">
                Ruaj Ndryshimet
              </Button>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="notifications" className="space-y-6">
          <Card className="p-6 space-y-6">
            <div>
              <h3 className="text-h4 text-foreground mb-4">Preferencat e Njoftimeve</h3>
              <div className="space-y-4">
                <div className="flex items-center justify-between py-3">
                  <div className="space-y-1">
                    <p className="text-body text-foreground font-normal">Njoftimet me Email</p>
                    <p className="text-body-sm text-muted-foreground">
                      Merr përditësime me email për projektet
                    </p>
                  </div>
                  <Switch defaultChecked />
                </div>
                <Separator />
                <div className="flex items-center justify-between py-3">
                  <div className="space-y-1">
                    <p className="text-body text-foreground font-normal">Njoftimet Push</p>
                    <p className="text-body-sm text-muted-foreground">
                      Merr njoftime push në pajisjet e tua
                    </p>
                  </div>
                  <Switch defaultChecked />
                </div>
                <Separator />
                <div className="flex items-center justify-between py-3">
                  <div className="space-y-1">
                    <p className="text-body text-foreground font-normal">Kujtesa për Detyrat</p>
                    <p className="text-body-sm text-muted-foreground">
                      Merr kujtesa për detyrat e ardhshme
                    </p>
                  </div>
                  <Switch defaultChecked />
                </div>
                <Separator />
                <div className="flex items-center justify-between py-3">
                  <div className="space-y-1">
                    <p className="text-body text-foreground font-normal">Raportet Javore</p>
                    <p className="text-body-sm text-muted-foreground">
                      Merr përmbledhje javore të aktiviteteve
                    </p>
                  </div>
                  <Switch />
                </div>
              </div>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="security" className="space-y-6">
          <Card className="p-6 space-y-6">
            <div>
              <h3 className="text-h4 text-foreground mb-4">Cilësimet e Sigurisë</h3>
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-body-sm text-foreground font-medium">Fjalëkalimi Aktual</label>
                  <input
                    type="password"
                    placeholder="••••••••"
                    className="w-full h-11 px-4 bg-background border border-border rounded-md text-body text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-body-sm text-foreground font-medium">Fjalëkalimi i Ri</label>
                  <input
                    type="password"
                    placeholder="••••••••"
                    className="w-full h-11 px-4 bg-background border border-border rounded-md text-body text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-body-sm text-foreground font-medium">Konfirmo Fjalëkalimin e Ri</label>
                  <input
                    type="password"
                    placeholder="••••••••"
                    className="w-full h-11 px-4 bg-background border border-border rounded-md text-body text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                  />
                </div>
              </div>
            </div>
            <Separator />
            <div className="flex items-center justify-between py-3">
              <div className="space-y-1">
                <p className="text-body text-foreground font-normal">Autentifikimi me Dy Faktorë</p>
                <p className="text-body-sm text-muted-foreground">
                  Shto një shtresë shtesë sigurie në llogarinë tënde
                </p>
              </div>
              <Switch />
            </div>
            <Separator />
            <div className="flex justify-end gap-3">
              <Button variant="outline" className="bg-background text-foreground border-border hover:bg-muted">
                Anulo
              </Button>
              <Button className="bg-primary text-primary-foreground hover:bg-primary-hover">
                Përditëso Fjalëkalimin
              </Button>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="appearance" className="space-y-6">
          <Card className="p-6 space-y-6">
            <div>
              <h3 className="text-h4 text-foreground mb-4">Cilësimet e Pamjes</h3>
              <div className="space-y-4">
                <div className="flex items-center justify-between py-3">
                  <div className="space-y-1">
                    <p className="text-body text-foreground font-normal">Modaliteti i Errët</p>
                    <p className="text-body-sm text-muted-foreground">
                      Kalo në temën e errët
                    </p>
                  </div>
                  <Switch />
                </div>
                <Separator />
                <div className="space-y-2">
                  <label className="text-body-sm text-foreground font-medium">Gjuha</label>
                  <select className="w-full h-11 px-4 bg-background border border-border rounded-md text-body text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary">
                    <option>Shqip</option>
                    <option>English</option>
                    <option>Italiano</option>
                    <option>Deutsch</option>
                  </select>
                </div>
                <Separator />
                <div className="space-y-2">
                  <label className="text-body-sm text-foreground font-medium">Zona Kohore</label>
                  <select className="w-full h-11 px-4 bg-background border border-border rounded-md text-body text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary">
                    <option>UTC+1 (Tiranë)</option>
                    <option>UTC+0 (GMT)</option>
                    <option>UTC+2 (Evropa Lindore)</option>
                    <option>UTC-5 (Eastern Time)</option>
                  </select>
                </div>
              </div>
            </div>
            <Separator />
            <div className="flex justify-end gap-3">
              <Button variant="outline" className="bg-background text-foreground border-border hover:bg-muted">
                Anulo
              </Button>
              <Button className="bg-primary text-primary-foreground hover:bg-primary-hover">
                Ruaj Preferencat
              </Button>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="integrations" className="space-y-6">
          {/* Stripe Integration */}
          <Card className="p-6 space-y-6">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-[#635BFF]/10 rounded-lg">
                  <svg viewBox="0 0 60 25" className="w-12 h-5" fill="#635BFF">
                    <path d="M59.64 14.28h-8.06c.19 1.93 1.6 2.55 3.2 2.55 1.64 0 2.96-.37 4.05-.95v3.32a8.33 8.33 0 0 1-4.56 1.1c-4.01 0-6.83-2.5-6.83-7.48 0-4.19 2.39-7.52 6.3-7.52 3.92 0 5.96 3.28 5.96 7.5 0 .4-.02 1.04-.06 1.48zm-3.67-3.14c0-1.25-.5-2.7-2.1-2.7-1.52 0-2.22 1.38-2.32 2.7h4.42zM40.95 20.3c-1.44 0-2.32-.6-2.9-1.04l-.02 4.63-4.12.87V5.57h3.76l.08 1.02a4.7 4.7 0 0 1 3.23-1.29c2.9 0 5.62 2.6 5.62 7.4 0 5.23-2.7 7.6-5.65 7.6zM40 8.95c-.95 0-1.54.34-1.97.81l.02 6.12c.4.44.98.78 1.95.78 1.52 0 2.54-1.65 2.54-3.87 0-2.15-1.04-3.84-2.54-3.84zM28.24 5.57h4.13v14.44h-4.13V5.57zm0-5.13L32.37 0v3.77l-4.13.88V.44zm-4.32 9.35v10.22H19.8V5.57h3.7l.12 1.22c1-1.77 3.07-1.41 3.62-1.22v3.79c-.52-.17-2.29-.45-3.32.43zm-8.55 4.72c0 2.43 2.6 1.68 3.12 1.46v3.36c-.55.3-1.54.54-2.89.54a4.15 4.15 0 0 1-4.27-4.24l.01-13.17 4.02-.86v3.54h3.14V9.1h-3.13v5.41zm-4.91.7c0 3.05-2.84 4.74-6.36 4.74-1.97 0-4.14-.33-6.1-1.13V14.1c1.9.77 4.13 1.41 6.1 1.41 1.17 0 2.14-.24 2.14-1.15 0-2.2-8.24-1.26-8.24-6.63 0-3.03 2.36-4.87 5.96-4.87 1.67 0 3.7.27 5.38.87v4.65c-1.66-.69-3.68-1.16-5.27-1.16-1.25 0-1.96.3-1.96 1.08 0 2.04 8.35 1.26 8.35 6.91z"/>
                  </svg>
                </div>
                <div>
                  <h3 className="text-h4 text-foreground">Stripe Payments</h3>
                  <p className="text-body-sm text-muted-foreground">
                    Pranoni pagesa online për faturat tuaja
                  </p>
                </div>
              </div>
              <a 
                href="https://dashboard.stripe.com/apikeys" 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-primary hover:underline text-sm flex items-center gap-1"
              >
                Merr API Keys <ExternalLink className="w-3 h-3" />
              </a>
            </div>

            <Separator />

            {/* Mode Selection */}
            <div className="space-y-3">
              <label className="text-body-sm text-foreground font-medium">Mënyra</label>
              <div className="flex gap-4">
                <label className={`flex items-center gap-3 p-4 border rounded-lg cursor-pointer transition-all ${stripeMode === 'test' ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground'}`}>
                  <input
                    type="radio"
                    name="stripeMode"
                    value="test"
                    checked={stripeMode === 'test'}
                    onChange={() => setStripeMode('test')}
                    className="w-4 h-4 text-primary"
                  />
                  <div>
                    <p className="font-medium text-foreground">Modaliteti Test</p>
                    <p className="text-xs text-muted-foreground">Për zhvillim dhe testim</p>
                  </div>
                </label>
                <label className={`flex items-center gap-3 p-4 border rounded-lg cursor-pointer transition-all ${stripeMode === 'live' ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground'}`}>
                  <input
                    type="radio"
                    name="stripeMode"
                    value="live"
                    checked={stripeMode === 'live'}
                    onChange={() => setStripeMode('live')}
                    className="w-4 h-4 text-primary"
                  />
                  <div>
                    <p className="font-medium text-foreground">Modaliteti Live</p>
                    <p className="text-xs text-muted-foreground">Për pagesa reale</p>
                  </div>
                </label>
              </div>
              {stripeMode === 'live' && (
                <div className="flex items-center gap-2 p-3 bg-warning/10 border border-warning/20 rounded-lg">
                  <AlertCircle className="w-4 h-4 text-warning" />
                  <p className="text-sm text-warning">Kujdes: Live mode do të procesojë pagesa reale!</p>
                </div>
              )}
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-body-sm text-foreground font-medium flex items-center gap-2">
                  <Key className="w-4 h-4" />
                  Çelësi Publik (Publishable Key)
                </label>
                <input
                  type="text"
                  value={stripePublishableKey}
                  onChange={(e) => setStripePublishableKey(e.target.value)}
                  placeholder={stripeMode === 'test' ? 'pk_test_...' : 'pk_live_...'}
                  className="w-full h-11 px-4 bg-background border border-border rounded-md text-body text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  Kjo çelës përdoret në frontend për Stripe.js
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-body-sm text-foreground font-medium flex items-center gap-2">
                  <Lock className="w-4 h-4" />
                  Çelësi Sekret (Secret Key)
                </label>
                <div className="w-full h-11 px-4 bg-muted/50 border border-border rounded-md flex items-center text-body text-muted-foreground text-sm">
                  ⚠️ Konfigurohet vetëm në backend (STRIPE_SECRET_KEY env variable)
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-body-sm text-foreground font-medium flex items-center gap-2">
                  <Globe className="w-4 h-4" />
                  Webhook Secret (Opsional)
                </label>
                <input
                  type="password"
                  value={stripeWebhookSecret}
                  onChange={(e) => setStripeWebhookSecret(e.target.value)}
                  placeholder="whsec_..."
                  className="w-full h-11 px-4 bg-background border border-border rounded-md text-body text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  Për të verifikuar webhook events nga Stripe
                </p>
              </div>
            </div>

            <Separator />

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {stripeSaved && (
                  <div className="flex items-center gap-2 text-success">
                    <CheckCircle2 className="w-4 h-4" />
                    <span className="text-sm">Cilësimet u ruajtën!</span>
                  </div>
                )}
              </div>
              <div className="flex gap-3">
                <Button 
                  variant="outline" 
                  className="bg-background text-foreground border-border hover:bg-muted"
                  onClick={() => {
                    setStripePublishableKey('');
                    setStripeWebhookSecret('');
                  }}
                >
                  Pastro
                </Button>
                <Button 
                  className="bg-[#635BFF] text-white hover:bg-[#5851ea]"
                  onClick={handleSaveStripeSettings}
                  disabled={!stripePublishableKey}
                >
                  Ruaj Cilësimet Stripe
                </Button>
              </div>
            </div>
          </Card>

          {/* Bank Transfer Settings */}
          <Card className="p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-50 dark:bg-blue-500/10 rounded-lg">
                <svg viewBox="0 0 24 24" className="w-6 h-6 text-blue-600" fill="currentColor">
                  <path d="M20 4H4c-1.11 0-1.99.89-1.99 2L2 18c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V6c0-1.11-.89-2-2-2zm0 14H4v-6h16v6zm0-10H4V6h16v2z"/>
                </svg>
              </div>
              <div>
                <h3 className="text-h4 text-foreground">Transfertë Bankare</h3>
                <p className="text-xs text-muted-foreground">Detajet bankare që shfaqen në faturat me pagesë bankare</p>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>Emri i Bankës</Label>
                <Input placeholder="p.sh. Raiffeisen Bank" value={defaultBankName} onChange={(e) => setDefaultBankName(e.target.value)} />
              </div>
              <div>
                <Label>Mbajtësi i Llogarisë</Label>
                <Input placeholder="p.sh. FivoCRM SHPK" value={defaultBankAccountHolder} onChange={(e) => setDefaultBankAccountHolder(e.target.value)} />
              </div>
              <div>
                <Label>IBAN</Label>
                <Input placeholder="AL00 0000 0000 0000 0000 0000 0000" value={defaultBankIBAN} onChange={(e) => setDefaultBankIBAN(e.target.value)} />
              </div>
              <div>
                <Label>SWIFT / BIC</Label>
                <Input placeholder="p.sh. SGSBALTX" value={defaultBankSWIFT} onChange={(e) => setDefaultBankSWIFT(e.target.value)} />
              </div>
            </div>
            <div className="flex items-center justify-between">
              {bankSaved && (
                <div className="flex items-center gap-2 text-success">
                  <CheckCircle2 className="w-4 h-4" />
                  <span className="text-sm">Cilësimet bankare u ruajtën!</span>
                </div>
              )}
              <div className="ml-auto">
                <Button onClick={handleSaveBankSettings} disabled={!defaultBankIBAN}>
                  Ruaj Detajet Bankare
                </Button>
              </div>
            </div>
          </Card>

          {/* Other Integrations Placeholder */}
          <Card className="p-6 space-y-4">
            <h3 className="text-h4 text-foreground">Integrime të Tjera</h3>
            <div className="p-4 border border-dashed border-border rounded-lg flex items-center gap-4 opacity-60">
              <div className="p-2 bg-muted rounded-lg">
                <svg viewBox="0 0 24 24" className="w-6 h-6" fill="currentColor">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
                </svg>
              </div>
              <div>
                <p className="font-medium">PayPal</p>
                <p className="text-xs text-muted-foreground">Së shpejti...</p>
              </div>
            </div>
          </Card>
        </TabsContent>
        <TabsContent value="automation" className="space-y-6">
          {/* Info banner */}
          <div className="p-4 bg-primary/5 border border-primary/20 rounded-lg flex items-start gap-3">
            <Zap className="w-5 h-5 text-primary mt-0.5 shrink-0" />
            <div>
              <p className="font-medium text-foreground">Punë të Automatizuara (Cron Jobs)</p>
              <p className="text-sm text-muted-foreground mt-1">
                Këto procese ekzekutohen automatikisht çdo ditë nga Vercel. Mund t&apos;i testosh
                manualisht me butonin &quot;Ekzekuto Tani&quot;. Kërkon konfigurimin e variablave
                të mjedisit Firebase tek Vercel.
              </p>
            </div>
          </div>

          {/* Task Deadline Alerts */}
          <CronJobCard
            title="Njoftime Afatesh për Detyra"
            description="Çdo mëngjes kontrollon detyrat që skadojnë brenda 2 ditëve dhe dërgon njoftime email + in-app te anëtarët e caktuar. Shënon detyrën si të njoftuar për të shmangur dyfishimet."
            schedule="Çdo ditë në 08:00 UTC"
            icon={<Clock className="w-5 h-5 text-primary" />}
            enabled={cronSettings['task_alerts']?.enabled ?? true}
            onToggle={(v) => handleToggleCron('task_alerts', v)}
            status={cronRunStatus['task_alerts']}
            onRun={() => handleRunCron('/api/cron/task-deadline-alerts', 'task_alerts')}
            lastRun={getLastRun('task_alerts')}
          />

          {/* Invoice Reminders */}
          <CronJobCard
            title="Kujtesa & Vonesa Faturash"
            description="Çdo mëngjes shënon automatikisht faturat e kaluara afatit si 'Overdue' dhe dërgon kujtesë pagese me email tek klientët me fatura që skadojnë brenda 3 ditëve."
            schedule="Çdo ditë në 09:00 UTC"
            icon={<CreditCard className="w-5 h-5 text-warning" />}
            enabled={cronSettings['invoice_reminders']?.enabled ?? true}
            onToggle={(v) => handleToggleCron('invoice_reminders', v)}
            status={cronRunStatus['invoice_reminders']}
            onRun={() => handleRunCron('/api/cron/invoice-reminders', 'invoice_reminders')}
            lastRun={getLastRun('invoice_reminders')}
          />

          {/* Recurring Tasks */}
          <CronJobCard
            title="Detyra Periodike"
            description="Çdo mesnatë krijon automatikisht kopje të reja për detyrat periodike (javore, mujore, vjetore) kur mbërin data e planifikuar, dhe dërgon njoftim te anëtari i caktuar."
            schedule="Çdo ditë në 00:00 UTC"
            icon={<RefreshCw className="w-5 h-5 text-success" />}
            enabled={cronSettings['recurring_tasks']?.enabled ?? true}
            onToggle={(v) => handleToggleCron('recurring_tasks', v)}
            status={cronRunStatus['recurring_tasks']}
            onRun={() => handleRunCron('/api/cron/recurring-tasks', 'recurring_tasks')}
            lastRun={getLastRun('recurring_tasks')}
          />

          {/* Environment Variables Setup Guide */}
          <Card className="p-6 space-y-4">
            <h3 className="text-h4 text-foreground flex items-center gap-2">
              <Key className="w-4 h-4" />
              Konfigurimi i Vercel Environment Variables
            </h3>
            <p className="text-sm text-muted-foreground">
              Shto këto variabla në{' '}
              <strong>Vercel Dashboard → Project → Settings → Environment Variables</strong>:
            </p>
            <div className="space-y-2">
              {([
                ['FIREBASE_PROJECT_ID',    'ID e projektit Firebase (p.sh. my-project-123)'],
                ['FIREBASE_CLIENT_EMAIL',  'Email i Firebase Service Account'],
                ['FIREBASE_PRIVATE_KEY',   'Çelësi privat i Service Account (fillon me -----BEGIN)'],
                ['CRON_SECRET',            'Fjalëkalim sekret — Vercel e vendos automatikisht'],
              ] as [string, string][]).map(([key, desc]) => (
                <div key={key} className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                  <code className="text-xs font-mono text-primary bg-primary/10 px-2 py-1 rounded shrink-0">{key}</code>
                  <span className="text-xs text-muted-foreground">{desc}</span>
                </div>
              ))}
            </div>
            <div className="flex items-start gap-2 p-3 bg-info/10 border border-info/20 rounded-lg">
              <AlertCircle className="w-4 h-4 text-info shrink-0 mt-0.5" />
              <p className="text-xs text-info">
                Për të marrë Firebase credentials:{' '}
                <strong>Firebase Console → Project Settings → Service Accounts → Generate new private key</strong>.
                Shkarko JSON-in dhe kopjo fushat përkatëse.
              </p>
            </div>
          </Card>
        </TabsContent>
          {/* Roles & Permissions tab */}
          <TabsContent value="roles" className="space-y-6">
            <RoleTemplatesSection />
          </TabsContent>
        </Tabs>
    </div>
  );
};

// ─── Module list ─────────────────────────────────────────────────────────────
const MODULES: { key: string; label: string }[] = [
  { key: 'canAccessProjects',    label: 'Projektet' },
  { key: 'canAccessTasks',       label: 'Detyrat' },
  { key: 'canAccessGoals',       label: 'Objektivat' },
  { key: 'canAccessCRM',         label: 'CRM / Leads' },
  { key: 'canAccessCustomers',   label: 'Klientët' },
  { key: 'canAccessInvoices',    label: 'Faturat' },
  { key: 'canAccessServices',    label: 'Shërbimet' },
  { key: 'canAccessExpenses',    label: 'Shpenzimet' },
  { key: 'canAccessReports',     label: 'Raportet' },
  { key: 'canAccessTimeTracking',label: 'Orari' },
  { key: 'canAccessChat',        label: 'Chat' },
  { key: 'canAccessSettings',    label: 'Cilësimet' },
];

const ROLE_DESCRIPTIONS: Record<string, { color: string; label: string; description: string }> = {
  Sales: {
    color: 'bg-teal-100 text-teal-800',
    label: 'Shitje',
    description: 'Ekipi i shitjes. Akses i plotë tek klientët, CRM dhe shërbimet.',
  },
  Manager: {
    color: 'bg-blue-100 text-blue-800',
    label: 'Menaxher',
    description: "Menaxhon ekipin dhe projektet. Mund t'i caktojë detyra anëtarëve.",
  },
  Member: {
    color: 'bg-green-100 text-green-800',
    label: 'Anëtar',
    description: 'Anëtar i rregullt. Punon mbi detyrat dhe projektet e caktuara.',
  },
  Viewer: {
    color: 'bg-gray-100 text-gray-700',
    label: 'Shikues',
    description: 'Akseson vetëm si lexim. Nuk mund të krijojë ose ndryshojë asgjë.',
  },
};

type RoleKey = 'Sales' | 'Manager' | 'Member' | 'Viewer';
type TemplateMap = Record<string, boolean>;

const DEFAULT_TEMPLATES: Record<RoleKey, TemplateMap> = {
  Sales: {
    canAccessProjects: false, canAccessTasks: false, canAccessGoals: false,
    canAccessCRM: true, canAccessCustomers: true, canAccessInvoices: true,
    canAccessServices: true, canAccessExpenses: false, canAccessReports: true,
    canAccessTimeTracking: true, canAccessChat: true, canAccessSettings: false,
  },
  Manager: {
    canAccessProjects: true, canAccessTasks: true, canAccessGoals: true,
    canAccessCRM: false, canAccessCustomers: false, canAccessInvoices: false,
    canAccessServices: false, canAccessExpenses: false, canAccessReports: true,
    canAccessTimeTracking: true, canAccessChat: true, canAccessSettings: false,
  },
  Member: {
    canAccessProjects: true, canAccessTasks: true, canAccessGoals: true,
    canAccessCRM: false, canAccessCustomers: false, canAccessInvoices: false,
    canAccessServices: false, canAccessExpenses: false, canAccessReports: false,
    canAccessTimeTracking: true, canAccessChat: true, canAccessSettings: false,
  },
  Viewer: {
    canAccessProjects: true, canAccessTasks: true, canAccessGoals: false,
    canAccessCRM: false, canAccessCustomers: false, canAccessInvoices: false,
    canAccessServices: false, canAccessExpenses: false, canAccessReports: false,
    canAccessTimeTracking: false, canAccessChat: true, canAccessSettings: false,
  },
};

const RoleTemplatesSection: React.FC = () => {
  const { user } = useAuth();
  const { isOwner, isAdmin, teamId } = usePermissions();
  const canEdit = isOwner || isAdmin;

  // Load saved templates from Firestore (one doc per role)
  const { data: savedTemplates } = useCollection<any>('roleTemplates', { skipTeamFilter: false });
  const templateMutation = useMutation<any>('roleTemplates');

  // Local state: one TemplateMap per role
  const [templates, setTemplates] = useState<Record<RoleKey, TemplateMap>>({ ...DEFAULT_TEMPLATES });
  const [applying, setApplying] = useState<Record<RoleKey, boolean>>({ Sales: false, Manager: false, Member: false, Viewer: false });
  const [templateIds, setTemplateIds] = useState<Record<string, string>>({});

  // Hydrate from Firestore once loaded
  useEffect(() => {
    if (!savedTemplates || savedTemplates.length === 0) return;
    const next = { ...DEFAULT_TEMPLATES };
    const ids: Record<string, string> = {};
    savedTemplates.forEach((t: any) => {
      if (t.role && next[t.role as RoleKey]) {
        next[t.role as RoleKey] = { ...next[t.role as RoleKey], ...t };
        ids[t.role] = t.id;
      }
    });
    setTemplates(next);
    setTemplateIds(ids);
  }, [savedTemplates]);

  const handleToggle = (role: RoleKey, key: string, value: boolean) => {
    setTemplates(prev => ({
      ...prev,
      [role]: { ...prev[role], [key]: value },
    }));
  };

  const handleSaveTemplate = async (role: RoleKey) => {
    if (!canEdit) return;
    const data = { role, ...templates[role] };
    if (templateIds[role]) {
      await templateMutation.update(templateIds[role], data);
    } else {
      const created = await templateMutation.create(data as any);
      setTemplateIds(prev => ({ ...prev, [role]: created.id }));
    }
    toast({ title: `Template "${ROLE_DESCRIPTIONS[role].label}" u ruajt!` });
  };

  const handleApplyToAll = async (role: RoleKey) => {
    if (!canEdit) return;
    setApplying(prev => ({ ...prev, [role]: true }));
    try {
      const snap = await getDocs(
        query(collection(db, 'teamMembers'), where('role', '==', role))
      );
      if (snap.empty) {
        toast({ title: 'Nuk ka anëtarë me këtë rol.' });
        return;
      }
      const batch = writeBatch(db);
      const perms = templates[role];
      snap.docs.forEach(d => {
        batch.update(d.ref, { ...perms, updatedAt: Timestamp.now() });
      });
      await batch.commit();
      toast({
        title: `Lejet u përditësuan!`,
        description: `${snap.size} anëtarë me rolin "${ROLE_DESCRIPTIONS[role].label}" u përditësuan.`,
      });
    } catch (err: any) {
      toast({ title: 'Gabim gjatë përditësimit', description: err.message, variant: 'destructive' });
    } finally {
      setApplying(prev => ({ ...prev, [role]: false }));
    }
  };

  return (
    <div className="space-y-6">
      {/* Admin role — read-only info card */}
      <Card className="p-6 border-l-4 border-l-primary">
        <div className="flex items-center gap-3 mb-3">
          <Shield className="w-5 h-5 text-primary" />
          <h3 className="font-semibold text-foreground text-lg">Admin</h3>
          <Badge className="bg-primary/10 text-primary">Akses i plotë</Badge>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Admini ka akses të plotë në të gjitha modulet dhe nuk mund të kufizohet. Roli i adminit caktohet vetëm nga pronari i ekipit.
        </p>
        <div className="flex flex-wrap gap-2">
          {MODULES.map(m => (
            <span key={m.key} className="flex items-center gap-1 text-xs bg-primary/10 text-primary px-2 py-1 rounded-full">
              <Check className="w-3 h-3" /> {m.label}
            </span>
          ))}
        </div>
      </Card>

      {/* Configurable roles */}
      {(['Manager', 'Member', 'Viewer'] as RoleKey[]).map(role => {
        const meta = ROLE_DESCRIPTIONS[role];
        return (
          <Card key={role} className="p-6 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-semibold text-foreground text-lg">{meta.label}</h3>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${meta.color}`}>{role}</span>
                </div>
                <p className="text-sm text-muted-foreground">{meta.description}</p>
              </div>
              {canEdit && (
                <div className="flex gap-2 shrink-0">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleSaveTemplate(role)}
                  >
                    Ruaj Template
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => handleApplyToAll(role)}
                    disabled={applying[role]}
                  >
                    {applying[role] ? (
                      <><RefreshCw className="w-3 h-3 mr-1 animate-spin" />Duke aplikuar...</>
                    ) : (
                      'Apliko te të gjithë'
                    )}
                  </Button>
                </div>
              )}
            </div>

            <Separator />

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {MODULES.map(m => {
                const checked = !!templates[role][m.key];
                const isViewer = role === 'Viewer';
                const isSettingsModule = m.key === 'canAccessSettings';
                // Viewer can never edit, Settings always off for non-admin
                const disabled = !canEdit || isSettingsModule;
                return (
                  <label
                    key={m.key}
                    className={`flex items-center gap-2.5 p-3 rounded-lg border cursor-pointer transition-colors ${
                      checked
                        ? 'border-primary/40 bg-primary/5'
                        : 'border-border bg-muted/30'
                    } ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:border-primary/30'}`}
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={v => !disabled && handleToggle(role, m.key, !!v)}
                      disabled={disabled}
                    />
                    <span className="text-sm font-medium text-foreground select-none">{m.label}</span>
                  </label>
                );
              })}
            </div>

            {role === 'Viewer' && (
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <AlertCircle className="w-3 h-3 shrink-0" />
                Shikuesi gjithmonë ka akses vetëm-lexim — nuk mund të krijojë ose ndryshojë asgjë pavarësisht moduleve.
              </p>
            )}
          </Card>
        );
      })}

      {!canEdit && (
        <div className="flex items-start gap-2 p-4 bg-warning/10 border border-warning/20 rounded-lg">
          <AlertCircle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
          <p className="text-sm text-warning">Vetëm Admin ose Pronari i ekipit mund të ndryshojë template-t e roleve.</p>
        </div>
      )}
    </div>
  );
};

export default SettingsView;