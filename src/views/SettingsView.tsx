import React, { useState, useEffect, useCallback } from 'react';
import {
  User,
  Bell,
  Lock,
  Palette,
  Globe,
  CreditCard,
  Key,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  Clock,
  RefreshCw,
  Play,
  Zap,
  Shield,
  Check,
  Plus,
  Trash2,
  MessageSquare,
  Copy,
  Phone,
  Cloud,
  QrCode,
  Wifi,
  WifiOff,
  ScrollText,
  Sparkles,
  Mail,
  Boxes,
} from 'lucide-react';
import { WhatsAppAccount, TeamMember, UserProfile } from '../types';
import { MetaChannel } from '../hooks/useTeamSettings';
import { swiftKeyDown, ibanChange } from '../lib/utils';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Label } from '../components/ui/label';
import { Input } from '../components/ui/input';
import { Switch } from '../components/ui/switch';
import { Separator } from '../components/ui/separator';
import WhatsAppStatusBadge from '../components/WhatsAppStatusBadge';
import ModulesSettingsPanel from '../components/ModulesSettingsPanel';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Checkbox } from '../components/ui/checkbox';
import { Badge } from '../components/ui/badge';
import { useCollection, useMutation, setGlobalWaEnabled, useGlobalTeamId, getGlobalBusinessId } from '../hooks/useFirestore';
import { saveTeamSettings, useTeamSettingsData } from '../hooks/useTeamSettings';
import { saveTenantSecrets } from '../lib/tenantSecrets';
import { isBreakReminderEnabled, setBreakReminderEnabled } from '../hooks/useBreakReminder';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../contexts/PermissionsContext';
import { getDocs, getDoc, setDoc, query, where, collection, writeBatch, doc, Timestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { dndZoneStamp } from '../lib/notificationPrefs';
import { toast } from '../hooks/use-toast';
import { reportingCapabilitiesFor } from '../lib/reporting/permissions';

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
  const { teamId: permTeamId, isAdmin, isOwner } = usePermissions();
  // A super-admin has no permissions.teamId (null); fall back to the resolved
  // global active team so team-scoped saves here (WhatsApp, bank, Meta, Stripe)
  // still work for them.
  const globalActiveTeamId = useGlobalTeamId();
  const teamId = permTeamId || globalActiveTeamId;
  const firestoreSettings = useTeamSettingsData();
  const [breakReminderOn, setBreakReminderOn] = useState(isBreakReminderEnabled);
  const [stripePublishableKey, setStripePublishableKey] = useState('');
  const [stripeWebhookSecret, setStripeWebhookSecret] = useState('');
  const [stripeMode, setStripeMode] = useState<'test' | 'live'>('test');
  const [stripeSaved, setStripeSaved] = useState(false);

  // ── AI Assistant (FivoAI) ──
  const [aiProvider, setAiProvider] = useState<'gemini' | 'openai'>('gemini');
  const [aiApiKey, setAiApiKey] = useState('');
  const [aiModel, setAiModel] = useState('');
  // Auto-reminder for inquiries missing materials
  const [inquiryReminderOn, setInquiryReminderOn] = useState(false);
  const [inquiryReminderDays, setInquiryReminderDays] = useState('3');
  const [inquiryReminderSaved, setInquiryReminderSaved] = useState(false);
  const [aiSaved, setAiSaved] = useState(false);

  // ── Email marketing provider ──
  const [emailProvider, setEmailProvider] = useState<'resend' | 'sendgrid' | 'mailgun' | 'brevo' | 'smtp'>('resend');
  const [emailApiKey, setEmailApiKey] = useState('');
  const [emailFromEmail, setEmailFromEmail] = useState('');
  const [emailFromName, setEmailFromName] = useState('');
  const [emailMailgunDomain, setEmailMailgunDomain] = useState('');
  const [emailMailgunRegion, setEmailMailgunRegion] = useState<'us' | 'eu'>('us');
  const [emailSmtpHost, setEmailSmtpHost] = useState('');
  const [emailSmtpPort, setEmailSmtpPort] = useState('465');
  const [emailSmtpUser, setEmailSmtpUser] = useState('');
  const [emailSmtpPass, setEmailSmtpPass] = useState('');
  const [emailSaved, setEmailSaved] = useState(false);

  // ── Company info (used in contract templates) ──
  const [companyName, setCompanyName] = useState('');
  const [companyAddress, setCompanyAddress] = useState('');
  const [companyNipt, setCompanyNipt] = useState('');
  const [companyRep, setCompanyRep] = useState('');
  const [companyEmail, setCompanyEmail] = useState('');
  const [companyPhone, setCompanyPhone] = useState('');
  const [companySaved, setCompanySaved] = useState(false);

  // ── Bank Transfer default settings (multi-bank) ──
  const [bankAccounts, setBankAccounts] = useState<Array<{ id: string; bankName: string; accountHolder: string; iban: string; swift: string; country: string }>>([]);
  const [bankSaved, setBankSaved] = useState(false);
  const [bankLoaded, setBankLoaded] = useState(false);

  // Populate bank accounts from Firestore once (prefer Firestore over localStorage)
  useEffect(() => {
    if (bankLoaded) return;
    if (firestoreSettings === null) return; // still loading
    if (firestoreSettings.bankAccounts && firestoreSettings.bankAccounts.length > 0) {
      setBankAccounts(firestoreSettings.bankAccounts);
      setBankLoaded(true);
      return;
    }
    // Firestore has no data — fall back to localStorage
    try {
      const stored = localStorage.getItem('bank_accounts');
      if (stored) { setBankAccounts(JSON.parse(stored)); setBankLoaded(true); return; }
      const oldIban = localStorage.getItem('default_bank_iban');
      if (oldIban) {
        setBankAccounts([{ id: crypto.randomUUID(), bankName: localStorage.getItem('default_bank_name') || '', accountHolder: localStorage.getItem('default_bank_holder') || '', iban: oldIban, swift: localStorage.getItem('default_bank_swift') || '', country: '' }]);
      }
    } catch { /* ignore */ }
    setBankLoaded(true);
  }, [firestoreSettings, bankLoaded]);

  // Load all other settings from Firestore once (Firestore takes priority over localStorage)
  const otherSettingsLoaded = React.useRef(false);
  useEffect(() => {
    if (otherSettingsLoaded.current) return;
    if (firestoreSettings === null) return;
    otherSettingsLoaded.current = true;
    if (firestoreSettings.companyName) setCompanyName(firestoreSettings.companyName);
    if (firestoreSettings.companyAddress) setCompanyAddress(firestoreSettings.companyAddress);
    if (firestoreSettings.companyNipt) setCompanyNipt(firestoreSettings.companyNipt);
    if (firestoreSettings.companyRepresentative) setCompanyRep(firestoreSettings.companyRepresentative);
    if (firestoreSettings.companyEmail) setCompanyEmail(firestoreSettings.companyEmail);
    if (firestoreSettings.companyPhone) setCompanyPhone(firestoreSettings.companyPhone);
    if (firestoreSettings.eurAllRate) setEurAllRate(firestoreSettings.eurAllRate);
    if (firestoreSettings.usdAllRate) setUsdAllRate(firestoreSettings.usdAllRate);
    if (firestoreSettings.whatsappEnabled !== undefined) setWhatsappEnabled(firestoreSettings.whatsappEnabled);
    if (firestoreSettings.whatsappVpsUrl) setWhatsappVpsUrl(firestoreSettings.whatsappVpsUrl);
    // Credentials are NOT loaded back: they live in the server-only vault
    // (teamSecrets). The `has*` flags below tell the UI they are configured.
    if (firestoreSettings.cronSettings) setCronSettings(firestoreSettings.cronSettings);
    if (firestoreSettings.stripePublishableKey) setStripePublishableKey(firestoreSettings.stripePublishableKey);
    if (firestoreSettings.stripeMode) setStripeMode(firestoreSettings.stripeMode);
    // AI Assistant
    if (firestoreSettings.aiProvider) setAiProvider(firestoreSettings.aiProvider);
    if (firestoreSettings.aiModel) setAiModel(firestoreSettings.aiModel);
    if (firestoreSettings.emailProvider) setEmailProvider(firestoreSettings.emailProvider);
    if (firestoreSettings.emailFromEmail) setEmailFromEmail(firestoreSettings.emailFromEmail);
    if (firestoreSettings.emailFromName) setEmailFromName(firestoreSettings.emailFromName);
    if (firestoreSettings.emailMailgunDomain) setEmailMailgunDomain(firestoreSettings.emailMailgunDomain);
    if (firestoreSettings.emailMailgunRegion) setEmailMailgunRegion(firestoreSettings.emailMailgunRegion);
    if (firestoreSettings.emailSmtpHost) setEmailSmtpHost(firestoreSettings.emailSmtpHost);
    if (firestoreSettings.emailSmtpPort) setEmailSmtpPort(String(firestoreSettings.emailSmtpPort));
    if (firestoreSettings.emailSmtpUser) setEmailSmtpUser(firestoreSettings.emailSmtpUser);
    if (firestoreSettings.inquiryMaterialsReminderEnabled !== undefined) setInquiryReminderOn(firestoreSettings.inquiryMaterialsReminderEnabled);
    if (firestoreSettings.inquiryMaterialsReminderDays !== undefined) setInquiryReminderDays(String(firestoreSettings.inquiryMaterialsReminderDays));
    // Meta Cloud API
    if (firestoreSettings.metaEnabled !== undefined) setMetaEnabled(firestoreSettings.metaEnabled);
    if (firestoreSettings.metaChannels) setMetaChannels(firestoreSettings.metaChannels);
    // metaWebhookVerifyToken + per-channel access tokens are credentials → vault only.
    setMetaLoaded(true);
  }, [firestoreSettings]);

  // ── Foreign → ALL exchange rates (shared by CRM, invoices and the calculator) ──
  const [eurAllRate, setEurAllRate] = useState(() => localStorage.getItem('eur_all_rate') || '100');
  const [usdAllRate, setUsdAllRate] = useState(() => localStorage.getItem('usd_all_rate') || '92');
  const [rateSaved, setRateSaved] = useState(false);

  // ── WhatsApp integration settings ──
  const [whatsappEnabled, setWhatsappEnabled] = useState(() => localStorage.getItem('whatsapp_enabled') === 'true');
  const [whatsappVpsUrl, setWhatsappVpsUrl] = useState(() => localStorage.getItem('whatsapp_vps_url') || '');
  // Always starts empty: the stored secret lives in the server-only vault and is
  // never sent to the browser. Typing a value replaces it; leaving it blank keeps it.
  const [whatsappVpsSecret, setWhatsappVpsSecret] = useState('');
  const [whatsappSaved, setWhatsappSaved] = useState(false);

  // ── WhatsApp Accounts (multi-agent Baileys) ──
  const { data: whatsappAccounts } = useCollection<WhatsAppAccount>('whatsappAccounts');
  const { data: teamMembersForWa } = useCollection<TeamMember>('teamMembers');
  const waMutation = useMutation<WhatsAppAccount>('whatsappAccounts');
  const [newWaLabel, setNewWaLabel] = useState('');
  const [newWaUserId, setNewWaUserId] = useState('');
  const [waAdding, setWaAdding] = useState(false);

  // QR dialog state
  const [qrDialogAccount, setQrDialogAccount] = useState<WhatsAppAccount | null>(null);
  const [qrData, setQrData] = useState<{ status: string; qrDataUrl: string | null; connectedPhone: string | null } | null>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const qrPollRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const { user } = useAuth();

  // ── Profile (Cilësimet > Profili) ──
  const { data: myProfiles } = useCollection<UserProfile>('userProfiles', {
    skip: !user,
    where: user ? [{ field: 'userId', operator: '==', value: user.uid }] : undefined,
    skipTeamFilter: true,
  });
  const myProfile = myProfiles?.[0];
  const profileMutation = useMutation<UserProfile>('userProfiles');
  const [profileForm, setProfileForm] = useState({ firstName: '', lastName: '', bio: '' });
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);

  // Prefill from the saved profile (falls back to the auth display name).
  const fillProfileForm = useCallback(() => {
    const full = (myProfile?.displayName || user?.displayName || '').trim();
    const parts = full ? full.split(/\s+/) : [];
    setProfileForm({
      firstName: parts[0] || '',
      lastName: parts.slice(1).join(' '),
      bio: myProfile?.bio || '',
    });
  }, [myProfile?.displayName, myProfile?.bio, user?.displayName]);
  useEffect(() => { fillProfileForm(); }, [fillProfileForm]);

  const handleSaveProfile = async () => {
    if (!user) return;
    setProfileSaving(true);
    try {
      const displayName = `${profileForm.firstName} ${profileForm.lastName}`.trim();
      const data = { userId: user.uid, displayName, bio: profileForm.bio };
      if (myProfile) await profileMutation.update(myProfile.id, data);
      else await profileMutation.create(data as any);
      setProfileSaved(true);
      toast({ title: 'Profili u ruajt', description: 'Ndryshimet u ruajtën me sukses.' });
      setTimeout(() => setProfileSaved(false), 2500);
    } catch {
      toast({ title: 'Gabim', description: 'Ruajtja e profilit dështoi.', variant: 'destructive' });
    } finally {
      setProfileSaving(false);
    }
  };

  // ── Notification preferences (shared shape with NotificationsCenter / cron) ──
  const [notifPrefs, setNotifPrefs] = useState({
    emailEnabled: true,
    pushEnabled: true,
    soundEnabled: true,
    taskReminders: true, // maps to categoryEnabled.tasks
    dndEnabled: false,
    dndStart: '22:00',
    dndEnd: '08:00',
  });
  useEffect(() => {
    if (!user) return;
    getDoc(doc(db, 'userPreferences', user.uid)).then(snap => {
      if (!snap.exists()) return;
      const p = snap.data() as any;
      setNotifPrefs(prev => ({
        emailEnabled: p.emailEnabled ?? prev.emailEnabled,
        pushEnabled: p.pushEnabled ?? prev.pushEnabled,
        soundEnabled: p.soundEnabled ?? prev.soundEnabled,
        taskReminders: p.categoryEnabled?.tasks ?? prev.taskReminders,
        dndEnabled: p.dndEnabled ?? prev.dndEnabled,
        dndStart: p.dndStart ?? prev.dndStart,
        dndEnd: p.dndEnd ?? prev.dndEnd,
      }));
    }).catch(() => { /* offline */ });
  }, [user?.uid]);

  // Persist a partial change to userPreferences/{uid} (merge) and update local state.
  const saveNotifPref = (patch: Partial<typeof notifPrefs>) => {
    setNotifPrefs(prev => {
      const next = { ...prev, ...patch };
      if (user) {
        // Persist in the canonical shape the bell + cron read. The DND window is
        // wall-clock time in the user's zone — always stamp the zone alongside it,
        // or the server falls back to UTC and shifts the window by the full offset.
        const doc_: any = {
          emailEnabled: next.emailEnabled,
          pushEnabled: next.pushEnabled,
          soundEnabled: next.soundEnabled,
          dndEnabled: next.dndEnabled,
          dndStart: next.dndStart,
          dndEnd: next.dndEnd,
          ...dndZoneStamp(),
        };
        if ('taskReminders' in patch) doc_.categoryEnabled = { tasks: next.taskReminders };
        setDoc(doc(db, 'userPreferences', user.uid), doc_, { merge: true }).catch(() => { /* ignore */ });
        try { localStorage.removeItem(`notif_prefs_${user.uid}`); } catch { /* ignore */ }
      }
      return next;
    });
  };

  const fetchQrData = async (acc: WhatsAppAccount) => {
    try {
      const token = await user?.getIdToken();
      const res = await fetch(`/api/whatsapp?agentId=${enc(acc.id)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const d = await res.json();
      setQrData({ status: d.status, qrDataUrl: d.qrDataUrl || null, connectedPhone: d.connectedPhone || null });
      if (d.status === 'connected') {
        if (qrPollRef.current) { clearInterval(qrPollRef.current); qrPollRef.current = null; }
        await waMutation.update(acc.id, { connectedPhone: d.connectedPhone });
      }
    } catch { /* ignore */ }
  };

  const openQrDialog = async (acc: WhatsAppAccount) => {
    setQrDialogAccount(acc);
    setQrData(null);
    setQrLoading(true);
    // trigger hot-reload so VPS picks up newly-created agents
    try {
      const token = await user?.getIdToken();
      await fetch('/api/whatsapp?action=reload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch { /* non-critical */ }
    await fetchQrData(acc);
    setQrLoading(false);
    if (qrPollRef.current) clearInterval(qrPollRef.current);
    qrPollRef.current = setInterval(() => fetchQrData(acc), 4000);
  };

  const closeQrDialog = () => {
    setQrDialogAccount(null);
    setQrData(null);
    if (qrPollRef.current) { clearInterval(qrPollRef.current); qrPollRef.current = null; }
  };

  // helper to avoid import
  const enc = encodeURIComponent;

  const handleAddWaAccount = async () => {
    if (!newWaLabel.trim() || !teamId) return;
    setWaAdding(true);
    try {
      const assignedMember = teamMembersForWa?.find(m => m.userId === newWaUserId);
      await waMutation.create({
        teamId,
        label: newWaLabel.trim(),
        assignedToUserId: newWaUserId || null,
        assignedToName: assignedMember?.displayName || assignedMember?.email || null,
        enabled: true,
        connectedPhone: null,
      } as any);
      setNewWaLabel('');
      setNewWaUserId('');
    } catch {
      toast({ title: 'Gabim', description: 'Nuk u shtua llogaria.', variant: 'destructive' });
    }
    setWaAdding(false);
  };

  const handleToggleWaAccount = async (acc: WhatsAppAccount) => {
    await waMutation.update(acc.id, { enabled: !acc.enabled });
  };

  const handleDeleteWaAccount = async (id: string) => {
    try {
      await waMutation.remove(id);
      toast({ title: 'Llogaria u fshi' });
    } catch (err: any) {
      toast({ title: 'Fshirja dështoi', description: err?.message || 'Provo përsëri.', variant: 'destructive' });
    }
  };

  // ── Meta WhatsApp Cloud API settings ──
  const [metaEnabled, setMetaEnabled] = useState(false);
  const [metaChannels, setMetaChannels] = useState<MetaChannel[]>([]);
  const [metaWebhookVerifyToken, setMetaWebhookVerifyToken] = useState('');
  const [metaSaved, setMetaSaved] = useState(false);
  const [metaLoaded, setMetaLoaded] = useState(false);

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
      // Manual trigger: authenticate with the admin's Firebase ID token.
      // The cron endpoint accepts either CRON_SECRET (server) or manual=1 + token.
      const token = await user?.getIdToken();
      const url = path + (path.includes('?') ? '&' : '?') + 'manual=1';
      const response = await fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await response.json();
      if (response.ok) {
        setCronRunStatus(prev => ({ ...prev, [key]: 'success' }));
        const runs = JSON.parse(localStorage.getItem('cron_last_runs') || '{}');
        const updatedRuns = { ...runs, [key]: { time: new Date().toISOString(), result: data } };
        localStorage.setItem('cron_last_runs', JSON.stringify(updatedRuns));
        if (teamId) saveTeamSettings(teamId, { cronLastRuns: updatedRuns });
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
    if (teamId) saveTeamSettings(teamId, { cronSettings: updated });
  };

  const handleSaveStripeSettings = () => {
    localStorage.setItem('stripe_publishable_key', stripePublishableKey);
    localStorage.setItem('stripe_mode', stripeMode);
    if (teamId) saveTeamSettings(teamId, { stripePublishableKey, stripeMode });
    setStripeSaved(true);
    setTimeout(() => setStripeSaved(false), 3000);
  };

  const handleSaveAiSettings = async () => {
    if (!teamId) return;
    saveTeamSettings(teamId, {
      aiProvider,
      aiModel: aiModel.trim(),
    });
    // The API key goes to the server-only vault (never stored in teamSettings).
    if (aiApiKey.trim()) {
      try {
        await saveTenantSecrets(teamId, { aiApiKey: aiApiKey.trim() });
        setAiApiKey('');
      } catch (e) {
        toast({ title: 'Gabim', description: (e as Error).message, variant: 'destructive' });
        return;
      }
    }
    setAiSaved(true);
    setTimeout(() => setAiSaved(false), 3000);
  };

  const handleSaveEmailSettings = async () => {
    if (!teamId) return;
    saveTeamSettings(teamId, {
      emailProvider,
      emailFromEmail: emailFromEmail.trim(),
      emailFromName: emailFromName.trim(),
      emailMailgunDomain: emailMailgunDomain.trim(),
      emailMailgunRegion,
      emailSmtpHost: emailSmtpHost.trim(),
      emailSmtpPort: Number(emailSmtpPort) || 465,
      emailSmtpUser: emailSmtpUser.trim(),
    });
    // API key + SMTP password → server-only vault.
    try {
      await saveTenantSecrets(teamId, {
        ...(emailApiKey.trim() ? { emailApiKey: emailApiKey.trim() } : {}),
        ...(emailSmtpPass.trim() ? { emailSmtpPass: emailSmtpPass.trim() } : {}),
      });
      if (emailApiKey.trim()) setEmailApiKey('');
      if (emailSmtpPass.trim()) setEmailSmtpPass('');
    } catch (e) {
      toast({ title: 'Gabim', description: (e as Error).message, variant: 'destructive' });
      return;
    }
    setEmailSaved(true);
    setTimeout(() => setEmailSaved(false), 3000);
  };

  const handleSaveInquiryReminder = () => {
    if (!teamId) return;
    const days = Math.max(1, Math.min(30, Number(inquiryReminderDays) || 3));
    saveTeamSettings(teamId, {
      inquiryMaterialsReminderEnabled: inquiryReminderOn,
      inquiryMaterialsReminderDays: days,
    });
    setInquiryReminderDays(String(days));
    setInquiryReminderSaved(true);
    setTimeout(() => setInquiryReminderSaved(false), 3000);
  };

  const handleSaveCompanyInfo = () => {
    if (!teamId) return;
    saveTeamSettings(teamId, {
      companyName: companyName.trim(),
      companyAddress: companyAddress.trim(),
      companyNipt: companyNipt.trim(),
      companyRepresentative: companyRep.trim(),
      companyEmail: companyEmail.trim(),
      companyPhone: companyPhone.trim(),
    });
    setCompanySaved(true);
    setTimeout(() => setCompanySaved(false), 2500);
  };

  const handleSaveBankSettings = () => {
    localStorage.setItem('bank_accounts', JSON.stringify(bankAccounts));
    // Keep backward-compatible keys for first bank (used by invoice auto-fill)
    const first = bankAccounts[0];
    if (first) {
      localStorage.setItem('default_bank_name', first.bankName);
      localStorage.setItem('default_bank_iban', first.iban);
      localStorage.setItem('default_bank_swift', first.swift);
      localStorage.setItem('default_bank_holder', first.accountHolder);
      localStorage.setItem('default_bank_country', first.country);
    }
    if (teamId) saveTeamSettings(teamId, { bankAccounts });
    setBankSaved(true);
    setTimeout(() => setBankSaved(false), 3000);
  };

  const handleToggleWhatsapp = (val: boolean) => {
    setWhatsappEnabled(val);
    localStorage.setItem('whatsapp_enabled', String(val));
    setGlobalWaEnabled(val);
    if (teamId) saveTeamSettings(teamId, { whatsappEnabled: val });
  };

  const handleSaveWhatsappSettings = async () => {
    localStorage.setItem('whatsapp_enabled', String(whatsappEnabled));
    localStorage.setItem('whatsapp_vps_url', whatsappVpsUrl);
    if (teamId) saveTeamSettings(teamId, { whatsappEnabled, whatsappVpsUrl });
    // The VPS secret is a credential → server-only vault.
    if (teamId && whatsappVpsSecret.trim()) {
      try {
        await saveTenantSecrets(teamId, { whatsappVpsSecret: whatsappVpsSecret.trim() });
        setWhatsappVpsSecret('');
      } catch (e) {
        toast({ title: 'Gabim', description: (e as Error).message, variant: 'destructive' });
        return;
      }
    }
    setWhatsappSaved(true);
    setTimeout(() => setWhatsappSaved(false), 3000);
  };

  // ── Meta Cloud API handlers ──
  const handleToggleMeta = (val: boolean) => {
    setMetaEnabled(val);
    if (teamId) saveTeamSettings(teamId, { metaEnabled: val });
  };

  const handleSaveMetaSettings = async () => {
    if (!teamId) return;
    // Denormalize phoneNumberIds for Firestore array-contains querying in webhook
    const metaPhoneNumberIds = metaChannels.map(ch => ch.phoneNumberId).filter(Boolean);
    // Channel METADATA stays in teamSettings; the per-channel access token is a
    // credential and goes to the vault keyed by phoneNumberId.
    const channelMeta = metaChannels.map(({ accessToken: _t, ...rest }) => rest) as MetaChannel[];
    const metaChannelTokens: Record<string, string> = {};
    for (const ch of metaChannels) {
      if (ch.phoneNumberId && ch.accessToken?.trim()) metaChannelTokens[ch.phoneNumberId] = ch.accessToken.trim();
    }
    saveTeamSettings(teamId, { metaEnabled, metaChannels: channelMeta, metaPhoneNumberIds });
    try {
      await saveTenantSecrets(teamId, {
        ...(Object.keys(metaChannelTokens).length ? { metaChannelTokens } : {}),
        ...(metaWebhookVerifyToken.trim() ? { metaWebhookVerifyToken: metaWebhookVerifyToken.trim() } : {}),
      });
      setMetaChannels(prev => prev.map(ch => ({ ...ch, accessToken: '' })));
      setMetaWebhookVerifyToken('');
    } catch (e) {
      toast({ title: 'Gabim', description: (e as Error).message, variant: 'destructive' });
      return;
    }
    setMetaSaved(true);
    setTimeout(() => setMetaSaved(false), 3000);
  };

  const addMetaChannel = () => {
    setMetaChannels(prev => [...prev, { id: crypto.randomUUID(), label: '', phone: '', phoneNumberId: '', accessToken: '', businessAccountId: '' }]);
  };

  const updateMetaChannel = (id: string, field: keyof MetaChannel, value: string) => {
    setMetaChannels(prev => prev.map(ch => ch.id === id ? { ...ch, [field]: value } : ch));
  };

  const removeMetaChannel = (id: string) => {
    setMetaChannels(prev => prev.filter(ch => ch.id !== id));
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: 'U kopjua!', description: text.slice(0, 60) + '...' });
  };

  const addBankAccount = () => {
    setBankAccounts(prev => [...prev, { id: crypto.randomUUID(), bankName: '', accountHolder: '', iban: '', swift: '', country: '' }]);
  };

  const removeBankAccount = (id: string) => {
    setBankAccounts(prev => prev.filter(b => b.id !== id));
  };

  const updateBankAccount = (id: string, field: string, value: string) => {
    setBankAccounts(prev => prev.map(b => b.id === id ? { ...b, [field]: value } : b));
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
          {(isAdmin || isOwner) && (
            <TabsTrigger value="integrations" className="data-[state=active]:bg-background data-[state=active]:text-primary min-w-fit">
              <CreditCard className="w-4 h-4 sm:mr-2" />
              <span className="hidden sm:inline">Integrimet</span>
            </TabsTrigger>
          )}
          {(isAdmin || isOwner) && (
            <TabsTrigger value="automation" className="data-[state=active]:bg-background data-[state=active]:text-primary min-w-fit">
              <Zap className="w-4 h-4 sm:mr-2" />
              <span className="hidden sm:inline">Automatizimi</span>
            </TabsTrigger>
          )}
          {(isAdmin || isOwner) && (
            <TabsTrigger value="roles" className="data-[state=active]:bg-background data-[state=active]:text-primary min-w-fit">
              <Shield className="w-4 h-4 sm:mr-2" />
              <span className="hidden sm:inline">Rolet & Lejet</span>
            </TabsTrigger>
          )}
          {(isAdmin || isOwner) && (
            <TabsTrigger value="modules" className="data-[state=active]:bg-background data-[state=active]:text-primary min-w-fit">
              <Boxes className="w-4 h-4 sm:mr-2" />
              <span className="hidden sm:inline">Modulet</span>
            </TabsTrigger>
          )}
        </TabsList>

        {(isAdmin || isOwner) && (
          <TabsContent value="modules" className="space-y-6">
            <ModulesSettingsPanel />
          </TabsContent>
        )}

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
                      value={profileForm.firstName}
                      onChange={(e) => setProfileForm(f => ({ ...f, firstName: e.target.value }))}
                      className="w-full h-11 px-4 bg-background border border-border rounded-md text-body text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-body-sm text-foreground font-medium">Mbiemri</label>
                    <input
                      type="text"
                      placeholder="Mbiemri"
                      value={profileForm.lastName}
                      onChange={(e) => setProfileForm(f => ({ ...f, lastName: e.target.value }))}
                      className="w-full h-11 px-4 bg-background border border-border rounded-md text-body text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-body-sm text-foreground font-medium">Email</label>
                  <input
                    type="email"
                    placeholder="email@shembull.com"
                    value={user?.email || ''}
                    readOnly
                    title="Email-i menaxhohet nga llogaria (Firebase Auth) dhe nuk ndryshohet këtu."
                    className="w-full h-11 px-4 bg-muted border border-border rounded-md text-body text-muted-foreground cursor-not-allowed focus:outline-none"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-body-sm text-foreground font-medium">Bio</label>
                  <textarea
                    placeholder="Na trego për veten..."
                    rows={4}
                    value={profileForm.bio}
                    onChange={(e) => setProfileForm(f => ({ ...f, bio: e.target.value }))}
                    className="w-full px-4 py-3 bg-background border border-border rounded-md text-body text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary resize-none"
                  />
                </div>
              </div>
            </div>
            <Separator />
            <div className="flex flex-col sm:flex-row sm:justify-end gap-2 sm:gap-3">
              <Button
                variant="outline"
                className="bg-background text-foreground border-border hover:bg-muted w-full sm:w-auto"
                onClick={fillProfileForm}
                disabled={profileSaving}
              >
                Anulo
              </Button>
              <Button
                className="bg-primary text-primary-foreground hover:bg-primary-hover w-full sm:w-auto"
                onClick={handleSaveProfile}
                disabled={profileSaving}
              >
                {profileSaving ? 'Duke ruajtur...' : profileSaved ? 'U ruajt ✓' : 'Ruaj Ndryshimet'}
              </Button>
            </div>
          </Card>

          {/* WhatsApp personal connection — shown to any user with an assigned account */}
          {(() => {
            const myWaAccount = whatsappAccounts?.find(a => a.assignedToUserId === user?.uid);
            if (!myWaAccount) return null;
            const connected = Boolean(myWaAccount.connectedPhone);
            return (
              <Card className="p-6 space-y-4">
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-[#25D366]/10 rounded-lg">
                    <MessageSquare className="w-6 h-6 text-[#25D366]" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-h4 text-foreground">WhatsApp Personal</h3>
                    <p className="text-body-sm text-muted-foreground">
                      {connected ? `Lidhur: +${myWaAccount.connectedPhone}` : 'Llogaria jote WhatsApp — skano QR-in për t\'u lidhur'}
                    </p>
                  </div>
                  {connected
                    ? <div className="flex items-center gap-2 text-[#25D366]"><Wifi className="w-4 h-4" /><span className="text-sm font-medium">Aktiv</span></div>
                    : <Button className="bg-[#25D366] text-white hover:bg-[#1da851] gap-2" onClick={() => openQrDialog(myWaAccount)}>
                        <QrCode className="w-4 h-4" />Lidho WhatsApp
                      </Button>
                  }
                </div>
                {connected && (
                  <Button variant="outline" size="sm" className="gap-2" onClick={() => openQrDialog(myWaAccount)}>
                    <QrCode className="w-3.5 h-3.5" />Shiko Status
                  </Button>
                )}
              </Card>
            );
          })()}
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
                      Merr njoftime me email (afate detyrash, kujtesa)
                    </p>
                  </div>
                  <Switch checked={notifPrefs.emailEnabled} onCheckedChange={(v) => saveNotifPref({ emailEnabled: v })} />
                </div>
                <Separator />
                <div className="flex items-center justify-between py-3">
                  <div className="space-y-1">
                    <p className="text-body text-foreground font-normal">Njoftimet Push</p>
                    <p className="text-body-sm text-muted-foreground">
                      Merr njoftime push në pajisjet e tua
                    </p>
                  </div>
                  <Switch checked={notifPrefs.pushEnabled} onCheckedChange={(v) => saveNotifPref({ pushEnabled: v })} />
                </div>
                <Separator />
                <div className="flex items-center justify-between py-3">
                  <div className="space-y-1">
                    <p className="text-body text-foreground font-normal">Kujtesa për Detyrat</p>
                    <p className="text-body-sm text-muted-foreground">
                      Shfaq njoftime për detyrat (afate, caktim, përmendje)
                    </p>
                  </div>
                  <Switch checked={notifPrefs.taskReminders} onCheckedChange={(v) => saveNotifPref({ taskReminders: v })} />
                </div>
                <Separator />
                <div className="flex items-center justify-between py-3">
                  <div className="space-y-1">
                    <p className="text-body text-foreground font-normal">Tingull për Njoftime</p>
                    <p className="text-body-sm text-muted-foreground">
                      Luaj një tingull kur mbërrin një njoftim i ri
                    </p>
                  </div>
                  <Switch checked={notifPrefs.soundEnabled} onCheckedChange={(v) => saveNotifPref({ soundEnabled: v })} />
                </div>
                <Separator />
                <div className="py-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <p className="text-body text-foreground font-normal">Mos Shqetëso</p>
                      <p className="text-body-sm text-muted-foreground">
                        Hesht njoftimet push/email/tingull brenda një intervali kohor
                      </p>
                    </div>
                    <Switch checked={notifPrefs.dndEnabled} onCheckedChange={(v) => saveNotifPref({ dndEnabled: v })} />
                  </div>
                  {notifPrefs.dndEnabled && (
                    <div className="flex items-center gap-3 pl-1">
                      <div className="flex items-center gap-2">
                        <Label className="text-body-sm text-muted-foreground">Nga</Label>
                        <Input type="time" value={notifPrefs.dndStart} onChange={(e) => saveNotifPref({ dndStart: e.target.value })} className="h-9 w-32" />
                      </div>
                      <div className="flex items-center gap-2">
                        <Label className="text-body-sm text-muted-foreground">Deri</Label>
                        <Input type="time" value={notifPrefs.dndEnd} onChange={(e) => saveNotifPref({ dndEnd: e.target.value })} className="h-9 w-32" />
                      </div>
                    </div>
                  )}
                </div>
                <Separator />
                <div className="flex items-center justify-between py-3">
                  <div className="space-y-1">
                    <p className="text-body text-foreground font-normal">🐦 Kujtesa e Pushimit</p>
                    <p className="text-body-sm text-muted-foreground">
                      Dëgjo cicërim zogu çdo 2 orë (08:00–18:00) — ngriu e leviz!
                    </p>
                  </div>
                  <Switch
                    checked={breakReminderOn}
                    onCheckedChange={(v) => { setBreakReminderOn(v); setBreakReminderEnabled(v); }}
                  />
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
            <div className="flex flex-col sm:flex-row sm:justify-end gap-2 sm:gap-3">
              <Button variant="outline" className="bg-background text-foreground border-border hover:bg-muted w-full sm:w-auto">
                Anulo
              </Button>
              <Button className="bg-primary text-primary-foreground hover:bg-primary-hover w-full sm:w-auto">
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
            <div className="flex flex-col sm:flex-row sm:justify-end gap-2 sm:gap-3">
              <Button variant="outline" className="bg-background text-foreground border-border hover:bg-muted w-full sm:w-auto">
                Anulo
              </Button>
              <Button className="bg-primary text-primary-foreground hover:bg-primary-hover w-full sm:w-auto">
                Ruaj Preferencat
              </Button>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="integrations" className="space-y-6">
          {/* AI Assistant (FivoAI) */}
          <Card className="p-6 space-y-6">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-primary/10 rounded-lg">
                  <Sparkles className="w-6 h-6 text-primary" />
                </div>
                <div>
                  <h3 className="text-h4 text-foreground">Asistenti AI (FivoAI)</h3>
                  <p className="text-body-sm text-muted-foreground">
                    Zgjidhni ofruesin dhe vendosni çelësin API për asistentin inteligjent
                  </p>
                </div>
              </div>
              <a
                href={aiProvider === 'gemini'
                  ? 'https://aistudio.google.com/app/apikey'
                  : 'https://platform.openai.com/api-keys'}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline text-sm flex items-center gap-1 shrink-0"
              >
                Merr çelësin <ExternalLink className="w-3 h-3" />
              </a>
            </div>

            <Separator />

            {/* Provider selection */}
            <div className="space-y-3">
              <label className="text-body-sm text-foreground font-medium">Ofruesi</label>
              <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
                <label className={`flex items-center gap-3 p-4 border rounded-lg cursor-pointer transition-all ${aiProvider === 'gemini' ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground'}`}>
                  <input
                    type="radio"
                    name="aiProvider"
                    value="gemini"
                    checked={aiProvider === 'gemini'}
                    onChange={() => setAiProvider('gemini')}
                    className="w-4 h-4 text-primary"
                  />
                  <div>
                    <p className="font-medium text-foreground">Google Gemini</p>
                    <p className="text-xs text-success">Falas — rekomandohet</p>
                  </div>
                </label>
                <label className={`flex items-center gap-3 p-4 border rounded-lg cursor-pointer transition-all ${aiProvider === 'openai' ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground'}`}>
                  <input
                    type="radio"
                    name="aiProvider"
                    value="openai"
                    checked={aiProvider === 'openai'}
                    onChange={() => setAiProvider('openai')}
                    className="w-4 h-4 text-primary"
                  />
                  <div>
                    <p className="font-medium text-foreground">OpenAI</p>
                    <p className="text-xs text-muted-foreground">Me pagesë (GPT)</p>
                  </div>
                </label>
              </div>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-body-sm text-foreground font-medium flex items-center gap-2">
                  <Key className="w-4 h-4" />
                  Çelësi API
                </label>
                <input
                  type="password"
                  value={aiApiKey}
                  onChange={(e) => setAiApiKey(e.target.value)}
                  placeholder={aiProvider === 'gemini' ? 'AIza...' : 'sk-...'}
                  autoComplete="off"
                  className="w-full h-11 px-4 bg-background border border-border rounded-md text-body text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  {aiProvider === 'gemini'
                    ? 'Merreni falas te Google AI Studio (pa kartë krediti). Ruhet i sigurt dhe përdoret vetëm nga serveri.'
                    : 'Merreni te platform.openai.com. Ruhet i sigurt dhe përdoret vetëm nga serveri.'}
                </p>
                {firestoreSettings?.hasAiApiKey && (
                  <p className="text-xs text-success flex items-center gap-1"><Shield className="w-3 h-3" /> Kredencial i ruajtur në kasafortën e serverit — lëri bosh për të mos e ndryshuar.</p>
                )}
              </div>

              <div className="space-y-2">
                <label className="text-body-sm text-foreground font-medium">Modeli (opsional)</label>
                <input
                  type="text"
                  value={aiModel}
                  onChange={(e) => setAiModel(e.target.value)}
                  placeholder={aiProvider === 'gemini' ? 'gemini-2.5-flash (parazgjedhje)' : 'gpt-4o-mini (parazgjedhje)'}
                  className="w-full h-11 px-4 bg-background border border-border rounded-md text-body text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  Lëreni bosh për të përdorur modelin e parazgjedhur.
                </p>
              </div>
            </div>

            <div className="flex justify-end">
              <Button onClick={handleSaveAiSettings} disabled={!aiApiKey.trim()} className="gap-2">
                {aiSaved ? <><Check className="w-4 h-4" /> Ruajtur</> : 'Ruaj Konfigurimin'}
              </Button>
            </div>
          </Card>

          {/* Email Marketing provider */}
          <Card className="p-6 space-y-6">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-primary/10 rounded-lg">
                  <Mail className="w-6 h-6 text-primary" />
                </div>
                <div>
                  <h3 className="text-h4 text-foreground">Email Marketing</h3>
                  <p className="text-body-sm text-muted-foreground">
                    Zgjidhni ofruesin për dërgimin e fushatave email (moduli Marketing)
                  </p>
                </div>
              </div>
              <a
                href={
                  emailProvider === 'resend' ? 'https://resend.com/api-keys'
                    : emailProvider === 'sendgrid' ? 'https://app.sendgrid.com/settings/api_keys'
                    : emailProvider === 'mailgun' ? 'https://app.mailgun.com/settings/api_security/api_keys'
                    : emailProvider === 'brevo' ? 'https://app.brevo.com/settings/keys/api'
                    : 'https://fivocrm.vercel.app'
                }
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline text-sm flex items-center gap-1 shrink-0"
              >
                Merr çelësin <ExternalLink className="w-3 h-3" />
              </a>
            </div>

            <Separator />

            {/* Provider selection */}
            <div className="space-y-3">
              <label className="text-body-sm text-foreground font-medium">Ofruesi</label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {([
                  { value: 'resend', label: 'Resend', note: 'Rekomandohet' },
                  { value: 'sendgrid', label: 'SendGrid', note: 'API' },
                  { value: 'mailgun', label: 'Mailgun', note: 'API' },
                  { value: 'brevo', label: 'Brevo', note: 'API (SMTP)' },
                  { value: 'smtp', label: 'SMTP', note: 'Klasik' },
                ] as const).map((p) => (
                  <label key={p.value} className={`flex flex-col gap-0.5 p-3 border rounded-lg cursor-pointer transition-all ${emailProvider === p.value ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground'}`}>
                    <div className="flex items-center gap-2">
                      <input type="radio" name="emailProvider" value={p.value} checked={emailProvider === p.value}
                        onChange={() => setEmailProvider(p.value)} className="w-4 h-4 text-primary" />
                      <span className="font-medium text-foreground">{p.label}</span>
                    </div>
                    <span className="text-xs text-muted-foreground pl-6">{p.note}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-4">
              {emailProvider !== 'smtp' ? (
                <div className="space-y-2">
                  <label className="text-body-sm text-foreground font-medium flex items-center gap-2">
                    <Key className="w-4 h-4" /> Çelësi API
                  </label>
                  <input type="password" value={emailApiKey} onChange={(e) => setEmailApiKey(e.target.value)}
                    placeholder={emailProvider === 'resend' ? 're_...' : emailProvider === 'sendgrid' ? 'SG....' : emailProvider === 'brevo' ? 'xkeysib-...' : 'key-...'}
                    autoComplete="off"
                    className="w-full h-11 px-4 bg-background border border-border rounded-md text-body text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary font-mono text-sm" />
                  <p className="text-xs text-muted-foreground">Ruhet i sigurt dhe përdoret vetëm nga serveri gjatë dërgimit.</p>
                  {firestoreSettings?.hasEmailApiKey && (
                    <p className="text-xs text-success flex items-center gap-1"><Shield className="w-3 h-3" /> Kredencial i ruajtur në kasafortën e serverit — lëri bosh për të mos e ndryshuar.</p>
                  )}
                </div>
              ) : (
                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-body-sm text-foreground font-medium">SMTP Host</label>
                    <input type="text" value={emailSmtpHost} onChange={(e) => setEmailSmtpHost(e.target.value)} placeholder="mail.shembull.com"
                      className="w-full h-11 px-4 bg-background border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-body-sm text-foreground font-medium">Porta</label>
                    <input type="number" value={emailSmtpPort} onChange={(e) => setEmailSmtpPort(e.target.value)} placeholder="465"
                      className="w-full h-11 px-4 bg-background border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-body-sm text-foreground font-medium">Përdoruesi (email)</label>
                    <input type="text" value={emailSmtpUser} onChange={(e) => setEmailSmtpUser(e.target.value)} placeholder="marketing@shembull.com" autoComplete="off"
                      className="w-full h-11 px-4 bg-background border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-body-sm text-foreground font-medium">Fjalëkalimi</label>
                    <input type="password" value={emailSmtpPass} onChange={(e) => setEmailSmtpPass(e.target.value)} autoComplete="off"
                      className="w-full h-11 px-4 bg-background border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" />
                    {firestoreSettings?.hasEmailSmtpPass && (
                      <p className="text-xs text-success flex items-center gap-1"><Shield className="w-3 h-3" /> Kredencial i ruajtur në kasafortën e serverit — lëri bosh për të mos e ndryshuar.</p>
                    )}
                  </div>
                </div>
              )}

              {emailProvider === 'mailgun' && (
                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-body-sm text-foreground font-medium">Domain-i (Mailgun)</label>
                    <input type="text" value={emailMailgunDomain} onChange={(e) => setEmailMailgunDomain(e.target.value)} placeholder="mg.shembull.com"
                      className="w-full h-11 px-4 bg-background border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-body-sm text-foreground font-medium">Rajoni</label>
                    <select value={emailMailgunRegion} onChange={(e) => setEmailMailgunRegion(e.target.value as 'us' | 'eu')}
                      className="w-full h-11 px-4 bg-background border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary">
                      <option value="us">US</option>
                      <option value="eu">EU</option>
                    </select>
                  </div>
                </div>
              )}

              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-body-sm text-foreground font-medium">Email-i i dërguesit</label>
                  <input type="email" value={emailFromEmail} onChange={(e) => setEmailFromEmail(e.target.value)} placeholder="marketing@shembull.com"
                    className="w-full h-11 px-4 bg-background border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" />
                  <p className="text-xs text-muted-foreground">Duhet domain i verifikuar te ofruesi (SPF/DKIM).</p>
                </div>
                <div className="space-y-2">
                  <label className="text-body-sm text-foreground font-medium">Emri i dërguesit</label>
                  <input type="text" value={emailFromName} onChange={(e) => setEmailFromName(e.target.value)} placeholder="Ekipi FivoCRM"
                    className="w-full h-11 px-4 bg-background border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" />
                </div>
              </div>
            </div>

            <div className="flex justify-end">
              <Button
                onClick={handleSaveEmailSettings}
                disabled={emailProvider !== 'smtp' ? !emailApiKey.trim() : !(emailSmtpHost.trim() && emailSmtpUser.trim() && emailSmtpPass.trim())}
                className="gap-2"
              >
                {emailSaved ? <><Check className="w-4 h-4" /> Ruajtur</> : 'Ruaj Konfigurimin'}
              </Button>
            </div>
          </Card>

          {/* Auto-reminder: inquiries missing materials */}
          <Card className="p-6 space-y-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-primary/10 rounded-lg">
                  <Bell className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h3 className="text-h4 text-foreground">Kujtesë për materialet e anketës</h3>
                  <p className="text-body-sm text-muted-foreground">
                    Dërgo email automatik klientit nëse pas dërgimit të anketës mungojnë materiale (logo, foto, përshkrimi, etj.)
                  </p>
                </div>
              </div>
              <Switch checked={inquiryReminderOn} onCheckedChange={setInquiryReminderOn} />
            </div>
            {inquiryReminderOn && (
              <>
                <Separator />
                <div className="flex items-end gap-3 flex-wrap">
                  <div className="space-y-1.5">
                    <Label>Dërgo pas (ditë)</Label>
                    <Input
                      type="number"
                      min={1}
                      max={30}
                      value={inquiryReminderDays}
                      onChange={e => setInquiryReminderDays(e.target.value)}
                      className="w-28"
                    />
                    <p className="text-xs text-muted-foreground">Ripërsëritet çdo {inquiryReminderDays || '3'} ditë, maks. 3 herë.</p>
                  </div>
                </div>
              </>
            )}
            <div className="flex justify-end">
              <Button onClick={handleSaveInquiryReminder} className="gap-2">
                {inquiryReminderSaved ? <><Check className="w-4 h-4" /> Ruajtur</> : 'Ruaj'}
              </Button>
            </div>
          </Card>

          {/* Company Info — used in contract templates */}
          <Card className="p-6 space-y-5">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-primary/10 rounded-lg">
                <ScrollText className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h3 className="text-h4 text-foreground">Të Dhënat e Kompanisë</h3>
                <p className="text-body-sm text-muted-foreground">
                  Plotësohen automatikisht në çdo kontratë të re
                </p>
              </div>
            </div>
            <Separator />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Emri i Kompanisë</Label>
                <Input
                  value={companyName}
                  onChange={e => setCompanyName(e.target.value)}
                  placeholder="P.sh. Fivo Digital SH.P.K."
                />
              </div>
              <div className="space-y-1.5">
                <Label>Përfaqësuesi Ligjor</Label>
                <Input
                  value={companyRep}
                  onChange={e => setCompanyRep(e.target.value)}
                  placeholder="Emri i Drejtorit / Administratorit"
                />
              </div>
              <div className="space-y-1.5">
                <Label>NIPT</Label>
                <Input
                  value={companyNipt}
                  onChange={e => setCompanyNipt(e.target.value)}
                  placeholder="L12345678A"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Adresa</Label>
                <Input
                  value={companyAddress}
                  onChange={e => setCompanyAddress(e.target.value)}
                  placeholder="Rruga, Qyteti, Shqipëri"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Email Zyrtar</Label>
                <Input
                  type="email"
                  value={companyEmail}
                  onChange={e => setCompanyEmail(e.target.value)}
                  placeholder="info@kompania.al"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Telefon</Label>
                <Input
                  value={companyPhone}
                  onChange={e => setCompanyPhone(e.target.value)}
                  placeholder="+355 6X XXX XXXX"
                />
              </div>
            </div>
            <div className="flex justify-end">
              <Button onClick={handleSaveCompanyInfo} className="gap-2">
                {companySaved ? <><Check className="w-4 h-4" /> Ruajtur</> : 'Ruaj të Dhënat'}
              </Button>
            </div>
          </Card>

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
              <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
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

            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex items-center gap-2">
                {stripeSaved && (
                  <div className="flex items-center gap-2 text-success">
                    <CheckCircle2 className="w-4 h-4" />
                    <span className="text-sm">Cilësimet u ruajtën!</span>
                  </div>
                )}
              </div>
              <div className="flex gap-3 flex-wrap">
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
            <div className="flex items-center justify-between">
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
              <Button variant="outline" size="sm" onClick={addBankAccount}>
                <Plus className="w-4 h-4 mr-1" /> Shto Bankë
              </Button>
            </div>

            {bankAccounts.length === 0 && (
              <div className="text-center py-6 text-muted-foreground text-sm border border-dashed rounded-lg">
                Asnjë llogari bankare e shtuar. Kliko "Shto Bankë" për të filluar.
              </div>
            )}

            {bankAccounts.map((bank, index) => (
              <div key={bank.id} className="p-4 border border-border rounded-lg space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-foreground">Banka {index + 1}</h4>
                  {bankAccounts.length > 1 && (
                    <Button variant="ghost" size="sm" className="text-error hover:text-error" onClick={() => removeBankAccount(bank.id)}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  )}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <Label>Emri i Bankës</Label>
                    <Input placeholder="p.sh. Raiffeisen Bank" value={bank.bankName} onChange={(e) => updateBankAccount(bank.id, 'bankName', e.target.value)} />
                  </div>
                  <div>
                    <Label>Mbajtësi i Llogarisë</Label>
                    <Input placeholder="p.sh. FivoCRM SHPK" value={bank.accountHolder} onChange={(e) => updateBankAccount(bank.id, 'accountHolder', e.target.value)} />
                  </div>
                  <div>
                    <Label>IBAN</Label>
                    <Input
                      placeholder="AL00 0000 0000 0000 0000 0000 0000"
                      value={bank.iban}
                      maxLength={34}
                      onChange={(e) => ibanChange(e.target.value, (v) => updateBankAccount(bank.id, 'iban', v))}
                    />
                  </div>
                  <div>
                    <Label>SWIFT / BIC</Label>
                    <Input
                      placeholder="p.sh. SGSBALTX"
                      value={bank.swift}
                      maxLength={11}
                      onKeyDown={swiftKeyDown}
                      onChange={(e) => updateBankAccount(bank.id, 'swift', e.target.value.toUpperCase())}
                    />
                  </div>
                  <div>
                    <Label>Shteti</Label>
                    <Input placeholder="p.sh. Shqipëri" value={bank.country} onChange={(e) => updateBankAccount(bank.id, 'country', e.target.value)} />
                  </div>
                </div>
              </div>
            ))}

            <div className="flex items-center justify-between">
              {bankSaved && (
                <div className="flex items-center gap-2 text-success">
                  <CheckCircle2 className="w-4 h-4" />
                  <span className="text-sm">Cilësimet bankare u ruajtën!</span>
                </div>
              )}
              <div className="ml-auto">
                <Button onClick={handleSaveBankSettings} disabled={bankAccounts.length === 0 || !bankAccounts.some(b => b.iban)}>
                  Ruaj Detajet Bankare
                </Button>
              </div>
            </div>
          </Card>

          {/* EUR→ALL Exchange Rate */}
          <Card className="p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-emerald-50 dark:bg-emerald-500/10 rounded-lg">
                <Globe className="w-6 h-6 text-emerald-600" />
              </div>
              <div>
                <h3 className="text-h4 text-foreground">Kurset e Këmbimit → ALL</h3>
                <p className="text-xs text-muted-foreground">Burim i vetëm i kurseve — zbatohet te faturat, CRM dhe kalkulatori i ofertave.</p>
              </div>
            </div>
            <div className="flex items-center gap-4 max-w-md">
              <div className="flex-1">
                <Label>1 EUR =</Label>
                <div className="flex items-center gap-2">
                  <Input type="number" min="1" step="0.1" value={eurAllRate}
                    onChange={(e) => setEurAllRate(e.target.value)}
                    className="font-mono"
                  />
                  <span className="text-sm text-muted-foreground font-medium whitespace-nowrap">ALL</span>
                </div>
              </div>
              <div className="flex-1">
                <Label>1 USD =</Label>
                <div className="flex items-center gap-2">
                  <Input type="number" min="1" step="0.1" value={usdAllRate}
                    onChange={(e) => setUsdAllRate(e.target.value)}
                    className="font-mono"
                  />
                  <span className="text-sm text-muted-foreground font-medium whitespace-nowrap">ALL</span>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between">
              {rateSaved && (
                <div className="flex items-center gap-2 text-success">
                  <CheckCircle2 className="w-4 h-4" />
                  <span className="text-sm">Kurset u ruajtën!</span>
                </div>
              )}
              <div className="ml-auto">
                <Button onClick={() => {
                  const eur = parseFloat(eurAllRate);
                  const usd = parseFloat(usdAllRate);
                  if (eur > 0 && isFinite(eur)) {
                    localStorage.setItem('eur_all_rate', String(eur));
                    if (teamId) saveTeamSettings(teamId, { eurAllRate: String(eur) });
                  }
                  if (usd > 0 && isFinite(usd)) {
                    localStorage.setItem('usd_all_rate', String(usd));
                    if (teamId) saveTeamSettings(teamId, { usdAllRate: String(usd) });
                  }
                  setRateSaved(true);
                  setTimeout(() => setRateSaved(false), 3000);
                }} disabled={!eurAllRate || parseFloat(eurAllRate) <= 0}>
                  Ruaj Kurset
                </Button>
              </div>
            </div>
          </Card>

          {/* WhatsApp Integration */}
          <Card className="p-6 space-y-6">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-[#25D366]/10 rounded-lg">
                  <MessageSquare className="w-6 h-6 text-[#25D366]" />
                </div>
                <div>
                  <h3 className="text-h4 text-foreground">WhatsApp Business</h3>
                  <p className="text-body-sm text-muted-foreground">
                    Dërgo njoftime zyrtare WhatsApp për fatura, kujtesa dhe ftesa
                  </p>
                </div>
              </div>
              <Switch checked={whatsappEnabled} onCheckedChange={handleToggleWhatsapp} />
            </div>

            {whatsappEnabled && (
              <>
                <Separator />
                <div className="flex items-center justify-between gap-3 p-3 bg-background border border-border rounded-lg">
                  <div className="min-w-0">
                    <p className="text-body-sm font-medium text-foreground">Statusi i serverit Baileys</p>
                    <p className="text-xs text-muted-foreground">Po kontrollohet çdo 30 sekonda — kliko për rifreskim</p>
                  </div>
                  <WhatsAppStatusBadge variant="pill" />
                </div>
                <WhatsAppStatusBadge variant="banner" />
                <div className="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-lg">
                  <AlertCircle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    Kërkon një VPS të dedikuar me serverin Baileys aktiv. Vercel nuk e mbështet këtë integrim direkt.
                  </p>
                </div>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-body-sm text-foreground font-medium flex items-center gap-2">
                      <Globe className="w-4 h-4" />
                      URL e VPS (Baileys Server)
                    </label>
                    <input
                      type="url"
                      value={whatsappVpsUrl}
                      onChange={(e) => setWhatsappVpsUrl(e.target.value)}
                      placeholder="https://your-vps-ip:3001"
                      className="w-full h-11 px-4 bg-background border border-border rounded-md text-body text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary font-mono text-sm"
                    />
                    <p className="text-xs text-muted-foreground">Adresa HTTP/HTTPS e serverit tuaj Baileys në VPS</p>
                  </div>
                  <div className="space-y-2">
                    <label className="text-body-sm text-foreground font-medium flex items-center gap-2">
                      <Key className="w-4 h-4" />
                      API Secret Key
                    </label>
                    <input
                      type="password"
                      value={whatsappVpsSecret}
                      onChange={(e) => setWhatsappVpsSecret(e.target.value)}
                      placeholder="Çelësi sekret i serverit tuaj"
                      className="w-full h-11 px-4 bg-background border border-border rounded-md text-body text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary font-mono text-sm"
                    />
                    <p className="text-xs text-muted-foreground">
                      I njëjtë me <code className="bg-muted px-1 rounded text-xs">WHATSAPP_VPS_SECRET</code> në env variables të serverit VPS
                    </p>
                    {firestoreSettings?.hasWhatsappVpsSecret && (
                      <p className="text-xs text-success flex items-center gap-1"><Shield className="w-3 h-3" /> Kredencial i ruajtur në kasafortën e serverit — lëri bosh për të mos e ndryshuar.</p>
                    )}
                  </div>
                </div>
                <Separator />
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div className="flex items-center gap-2">
                    {whatsappSaved && (
                      <div className="flex items-center gap-2 text-success">
                        <CheckCircle2 className="w-4 h-4" />
                        <span className="text-sm">Cilësimet u ruajtën!</span>
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
                    <Button
                      variant="outline"
                      className="bg-background text-foreground border-border hover:bg-muted"
                      onClick={() => { setWhatsappVpsUrl(''); setWhatsappVpsSecret(''); }}
                    >
                      Pastro
                    </Button>
                    <Button
                      className="bg-[#25D366] text-white hover:bg-[#1da851]"
                      onClick={handleSaveWhatsappSettings}
                      disabled={!whatsappVpsUrl || !whatsappVpsSecret}
                    >
                      Ruaj Cilësimet WhatsApp
                    </Button>
                  </div>
                </div>
              </>
            )}
          </Card>

          {/* WhatsApp Agents — multi-account Baileys */}
          {whatsappEnabled && (isAdmin || isOwner) && (
            <Card className="p-6 space-y-6">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-[#25D366]/10 rounded-lg">
                  <QrCode className="w-6 h-6 text-[#25D366]" />
                </div>
                <div>
                  <h3 className="text-h4 text-foreground">Llogaritë WhatsApp (Agjentët)</h3>
                  <p className="text-body-sm text-muted-foreground">
                    Çdo agjent shitjesh mund të ketë sesionin e tij WhatsApp
                  </p>
                </div>
              </div>

              <Separator />

              {/* Existing accounts list */}
              {whatsappAccounts && whatsappAccounts.length > 0 ? (
                <div className="space-y-3">
                  {whatsappAccounts.map(acc => {
                    const isConnected = Boolean(acc.connectedPhone);
                    return (
                      <div key={acc.id} className="flex items-center gap-3 p-3 border border-border rounded-lg bg-muted/30">
                        <div className={`p-1.5 rounded-full ${isConnected ? 'bg-[#25D366]/10' : 'bg-muted'}`}>
                          {isConnected
                            ? <Wifi className="w-4 h-4 text-[#25D366]" />
                            : <WifiOff className="w-4 h-4 text-muted-foreground" />
                          }
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">{acc.label}</p>
                          <p className="text-xs text-muted-foreground truncate">
                            {isConnected
                              ? `Lidhur: +${acc.connectedPhone}`
                              : 'Jo i lidhur'
                            }
                            {acc.assignedToName && ` · ${acc.assignedToName}`}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {whatsappVpsUrl && (
                            <Button
                              size="sm"
                              variant={isConnected ? 'outline' : 'default'}
                              className={`gap-1.5 text-xs h-7 ${isConnected ? '' : 'bg-[#25D366] text-white hover:bg-[#1da851]'}`}
                              onClick={() => openQrDialog(acc)}
                            >
                              <QrCode className="w-3 h-3" />
                              {isConnected ? 'Status' : 'Lidhu'}
                            </Button>
                          )}
                          <Switch
                            checked={acc.enabled}
                            onCheckedChange={() => handleToggleWaAccount(acc)}
                          />
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                            onClick={() => handleDeleteWaAccount(acc.id)}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-4">
                  Nuk ka llogari WhatsApp. Shto një llogari më poshtë.
                </p>
              )}

              <Separator />

              {/* Add new account form */}
              <div className="space-y-3">
                <p className="text-sm font-medium text-foreground">Shto Llogari të Re</p>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    value={newWaLabel}
                    onChange={e => setNewWaLabel(e.target.value)}
                    placeholder="Emri i llogarisë (p.sh. Dori - Sales)"
                    className="flex-1 h-9 px-3 bg-background border border-border rounded-md text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                  />
                  <select
                    value={newWaUserId}
                    onChange={e => setNewWaUserId(e.target.value)}
                    className="sm:w-48 h-9 px-3 bg-background border border-border rounded-md text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                  >
                    <option value="">Pa caktim</option>
                    {teamMembersForWa?.filter(m => m.status === 'Active').map(m => (
                      <option key={m.userId} value={m.userId}>
                        {m.displayName || m.email || m.userId}
                      </option>
                    ))}
                  </select>
                  <Button
                    size="sm"
                    className="bg-[#25D366] text-white hover:bg-[#1da851] gap-1.5 h-9"
                    onClick={handleAddWaAccount}
                    disabled={waAdding || !newWaLabel.trim()}
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Shto
                  </Button>
                </div>
                {!whatsappVpsUrl && (
                  <p className="text-xs text-amber-600 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" />
                    Ruaj URL-në e VPS sipër për të shfaqur linqet QR
                  </p>
                )}
              </div>
            </Card>
          )}

          {/* QR Dialog */}
          <Dialog open={!!qrDialogAccount} onOpenChange={open => { if (!open) closeQrDialog(); }}>
            <DialogContent className="sm:max-w-sm">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-[#25D366]" />
                  {qrDialogAccount?.label}
                </DialogTitle>
              </DialogHeader>
              <div className="flex flex-col items-center gap-4 py-2">
                {qrLoading && (
                  <div className="flex flex-col items-center gap-2 py-8">
                    <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">Duke ngarkuar...</p>
                  </div>
                )}
                {!qrLoading && qrData?.status === 'connected' && (
                  <div className="flex flex-col items-center gap-3 py-6">
                    <div className="p-4 bg-[#25D366]/10 rounded-full">
                      <CheckCircle2 className="w-10 h-10 text-[#25D366]" />
                    </div>
                    <p className="text-base font-semibold text-foreground">I lidhur!</p>
                    {qrData.connectedPhone && (
                      <p className="text-sm text-muted-foreground">+{qrData.connectedPhone}</p>
                    )}
                  </div>
                )}
                {!qrLoading && qrData?.status === 'qr_ready' && qrData.qrDataUrl && (
                  <>
                    <img src={qrData.qrDataUrl} alt="QR Code" className="w-56 h-56 rounded-xl border border-border p-1" />
                    <div className="text-center space-y-1">
                      <p className="text-sm font-medium text-foreground">Skano me WhatsApp</p>
                      <p className="text-xs text-muted-foreground">
                        WhatsApp → <strong>Cilësimet</strong> → <strong>Pajisjet e lidhura</strong> → <strong>Lidh pajisje</strong>
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <RefreshCw className="w-3 h-3 animate-spin" />
                      Duke pritur skanim...
                    </div>
                  </>
                )}
                {!qrLoading && (qrData?.status === 'connecting' || qrData?.status === 'disconnected' || !qrData) && (
                  <div className="flex flex-col items-center gap-2 py-6">
                    <WifiOff className="w-8 h-8 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground text-center">
                      {qrData?.status === 'connecting' ? 'Duke u lidhur, prit...' : 'QR nuk është gati. Kontrollo VPS-in.'}
                    </p>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <RefreshCw className="w-3 h-3 animate-spin" />
                      Duke provuar...
                    </div>
                  </div>
                )}
              </div>
            </DialogContent>
          </Dialog>

          {/* Meta WhatsApp Cloud API */}
          <Card className="p-6 space-y-6">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-blue-500/10 rounded-lg">
                  <Cloud className="w-6 h-6 text-blue-500" />
                </div>
                <div>
                  <h3 className="text-h4 text-foreground">Meta WhatsApp Cloud API</h3>
                  <p className="text-body-sm text-muted-foreground">
                    Numra të shumtë WhatsApp me API zyrtare të Meta — pa VPS, numra realë 100%
                  </p>
                </div>
              </div>
              <Switch checked={metaEnabled} onCheckedChange={handleToggleMeta} />
            </div>

            {metaEnabled && (
              <>
                <Separator />
                <div className="flex items-start gap-2 p-3 bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20 rounded-lg">
                  <AlertCircle className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
                  <div className="text-xs text-blue-700 dark:text-blue-400 space-y-1">
                    <p>Kërkon një <strong>Meta Business Account</strong> me WhatsApp Business API të aktivizuar.</p>
                    <p>Krijo app në <a href="https://developers.facebook.com" target="_blank" rel="noopener noreferrer" className="underline">developers.facebook.com</a> → WhatsApp → API Setup.</p>
                  </div>
                </div>

                {/* Webhook URL info */}
                <div className="space-y-2">
                  <label className="text-body-sm text-foreground font-medium flex items-center gap-2">
                    <Globe className="w-4 h-4" />
                    Webhook URL (vendose në Meta Dashboard)
                  </label>
                  <div className="flex gap-2">
                    <input
                      readOnly
                      value={typeof window !== 'undefined' ? `${window.location.origin}/api/meta-webhook` : '/api/meta-webhook'}
                      className="w-full h-11 px-4 bg-muted border border-border rounded-md text-body text-foreground font-mono text-sm cursor-text"
                    />
                    <Button variant="outline" size="icon" className="shrink-0 h-11 w-11" onClick={() => copyToClipboard(`${window.location.origin}/api/meta-webhook`)}>
                      <Copy className="w-4 h-4" />
                    </Button>
                  </div>
                </div>

                {/* Webhook Verify Token */}
                <div className="space-y-2">
                  <label className="text-body-sm text-foreground font-medium flex items-center gap-2">
                    <Key className="w-4 h-4" />
                    Webhook Verify Token
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={metaWebhookVerifyToken}
                      onChange={(e) => setMetaWebhookVerifyToken(e.target.value)}
                      placeholder="Vendos një token unik verifikimi"
                      className="w-full h-11 px-4 bg-background border border-border rounded-md text-body text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary font-mono text-sm"
                    />
                    <Button variant="outline" size="icon" className="shrink-0 h-11 w-11" onClick={() => {
                      const token = crypto.randomUUID();
                      setMetaWebhookVerifyToken(token);
                    }}>
                      <RefreshCw className="w-4 h-4" />
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Vendos të njëjtin token edhe në <code className="bg-muted px-1 rounded text-xs">META_WEBHOOK_VERIFY_TOKEN</code> tek Vercel env variables
                  </p>
                </div>

                <Separator />

                {/* Meta Channels */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <label className="text-body-sm text-foreground font-medium flex items-center gap-2">
                      <Phone className="w-4 h-4" />
                      Numrat WhatsApp (Meta)
                    </label>
                    <Button variant="outline" size="sm" onClick={addMetaChannel}>
                      <Plus className="w-4 h-4 mr-1" /> Shto Numër
                    </Button>
                  </div>

                  {metaChannels.length === 0 && (
                    <div className="p-4 border border-dashed border-border rounded-lg text-center text-sm text-muted-foreground">
                      Asnjë numër Meta i konfiguruar. Kliko "Shto Numër" për të filluar.
                    </div>
                  )}

                  {metaChannels.map((ch, idx) => (
                    <Card key={ch.id} className="p-4 space-y-3 border-blue-200 dark:border-blue-500/20">
                      <div className="flex items-center justify-between">
                        <Badge variant="outline" className="text-blue-600 border-blue-300">
                          Numri #{idx + 1}
                        </Badge>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => removeMetaChannel(ch.id)}>
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <label className="text-xs text-muted-foreground">Emërtim (p.sh. "Shitje", "Mbështetje")</label>
                          <input
                            value={ch.label}
                            onChange={(e) => updateMetaChannel(ch.id, 'label', e.target.value)}
                            placeholder="Emërtimi i numrit"
                            className="w-full h-9 px-3 bg-background border border-border rounded-md text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs text-muted-foreground">Numri i telefonit</label>
                          <input
                            value={ch.phone}
                            onChange={(e) => updateMetaChannel(ch.id, 'phone', e.target.value)}
                            placeholder="+355 6x xxx xxxx"
                            className="w-full h-9 px-3 bg-background border border-border rounded-md text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary font-mono"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs text-muted-foreground">Phone Number ID (nga Meta Dashboard)</label>
                          <input
                            value={ch.phoneNumberId}
                            onChange={(e) => updateMetaChannel(ch.id, 'phoneNumberId', e.target.value)}
                            placeholder="1234567890"
                            className="w-full h-9 px-3 bg-background border border-border rounded-md text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary font-mono"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs text-muted-foreground">Business Account ID (opsionale)</label>
                          <input
                            value={ch.businessAccountId || ''}
                            onChange={(e) => updateMetaChannel(ch.id, 'businessAccountId', e.target.value)}
                            placeholder="1234567890"
                            className="w-full h-9 px-3 bg-background border border-border rounded-md text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary font-mono"
                          />
                        </div>
                        <div className="space-y-1 md:col-span-2">
                          <label className="text-xs text-muted-foreground">Access Token (Permanent)</label>
                          <input
                            type="password"
                            value={ch.accessToken}
                            onChange={(e) => updateMetaChannel(ch.id, 'accessToken', e.target.value)}
                            placeholder="EAAxxxxxxx..."
                            className="w-full h-9 px-3 bg-background border border-border rounded-md text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary font-mono"
                          />
                          {firestoreSettings?.hasMetaChannelTokens && (
                            <p className="text-xs text-success flex items-center gap-1"><Shield className="w-3 h-3" /> Kredencial i ruajtur në kasafortën e serverit — lëri bosh për të mos e ndryshuar.</p>
                          )}
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>

                <Separator />
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div className="flex items-center gap-2">
                    {metaSaved && (
                      <div className="flex items-center gap-2 text-success">
                        <CheckCircle2 className="w-4 h-4" />
                        <span className="text-sm">Cilësimet Meta u ruajtën!</span>
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
                    <Button
                      variant="outline"
                      className="bg-background text-foreground border-border hover:bg-muted"
                      onClick={() => { setMetaChannels([]); setMetaWebhookVerifyToken(''); }}
                    >
                      Pastro
                    </Button>
                    <Button
                      className="bg-blue-500 text-white hover:bg-blue-600"
                      onClick={handleSaveMetaSettings}
                      disabled={metaChannels.length === 0}
                    >
                      Ruaj Cilësimet Meta
                    </Button>
                  </div>
                </div>
              </>
            )}
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
            onRun={() => handleRunCron('/api/cron/run?job=task-deadline-alerts', 'task_alerts')}
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
            onRun={() => handleRunCron('/api/cron/run?job=invoice-reminders', 'invoice_reminders')}
            lastRun={getLastRun('invoice_reminders')}
          />

          {/* WHMCS Sync */}
          <CronJobCard
            title="Sinkronizim WHMCS"
            description="Tërheq klientët, faturat, pagesat dhe shërbimet/abonimet aktive nga WHMCS në FivoCRM. Klientët shkojnë te lista e Klientëve. Sinkronizimi është idempotent (pa dublime); pjesët pa leje në WHMCS API thjesht anashkalohen. Kliko 'Ekzekuto Tani' për një backfill të plotë."
            schedule="Çdo ditë (brenda 'run-all') + kohë reale via webhook"
            icon={<Cloud className="w-5 h-5 text-primary" />}
            enabled={cronSettings['whmcs_sync']?.enabled ?? true}
            onToggle={(v) => handleToggleCron('whmcs_sync', v)}
            status={cronRunStatus['whmcs_sync']}
            onRun={() => handleRunCron('/api/cron/run?job=whmcs-sync', 'whmcs_sync')}
            lastRun={getLastRun('whmcs_sync')}
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
            onRun={() => handleRunCron('/api/cron/run?job=recurring-tasks', 'recurring_tasks')}
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
                ['WHMCS_API_URL',          'URL bazë e WHMCS (p.sh. https://billing.example.com)'],
                ['WHMCS_API_IDENTIFIER',   'API credential identifier nga WHMCS'],
                ['WHMCS_API_SECRET',       'API credential secret nga WHMCS'],
                ['WHMCS_WEBHOOK_SECRET',   'Sekret i përbashkët për firmosjen HMAC të webhook-ut'],
                ['WHMCS_TEAM_ID',          '(Opsionale) teamId ku ngjiten të dhënat e WHMCS'],
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
  { key: 'canAccessProducts',    label: 'Dyqani & Produktet' },
  { key: 'canAccessExpenses',    label: 'Shpenzimet' },
  { key: 'canAccessReports',     label: 'Raportimi' },
  // Reporting capabilities. `canAccessReports` above is the module gate (everyone
  // files their own reports); these escalate what a role may do with OTHERS' work.
  { key: 'canReviewReports',          label: '↳ Shqyrto raporte' },
  { key: 'canApproveReports',         label: '↳ Aprovo brenda' },
  { key: 'canPublishReports',         label: '↳ Publiko & dërgo te klienti' },
  { key: 'canViewAllReports',         label: '↳ Shiko të gjitha raportet' },
  { key: 'canViewConfidentialReports',label: '↳ Seksione konfidenciale' },
  { key: 'canManageReportTemplates',  label: '↳ Menaxho template & KPI' },
  { key: 'canViewFinancialMetrics',   label: '↳ Metrika financiare' },
  { key: 'canAccessTimeTracking',label: 'Orari' },
  // Not a module gate: this one decides whether the person may hand a task to a
  // COLLEAGUE. Admin/Manager/SalesAgent have it from the role; for Member and
  // Sales it is this flag (or the per-member checkbox in Ekipet) or nothing.
  { key: 'canAssignTasks',       label: 'Cakto detyra te të tjerët' },
  { key: 'canAccessChat',        label: 'Chat' },
  { key: 'canAccessWhatsapp',    label: 'WhatsApp' },
  { key: 'canAccessSettings',    label: 'Cilësimet' },
];

const ROLE_DESCRIPTIONS: Record<string, { color: string; label: string; description: string }> = {
  Sales: {
    color: 'bg-teal-100 text-teal-800',
    label: 'Shitje',
    description: 'Ekipi i shitjes. Akses i plotë tek klientët, CRM dhe shërbimet.',
  },
  SalesAgent: {
    color: 'bg-cyan-100 text-cyan-800',
    label: 'Agjent Shitje',
    description: 'Agjent shitjesh. Akses tek CRM, faturat, klientët dhe shërbimet (vetëm të vetat).',
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

type RoleKey = 'Sales' | 'SalesAgent' | 'Manager' | 'Member' | 'Viewer';
type TemplateMap = Record<string, boolean>;

const DEFAULT_TEMPLATES: Record<RoleKey, TemplateMap> = {
  Sales: {
    canAccessProjects: false, canAccessTasks: false, canAccessGoals: false,
    canAccessCRM: true, canAccessCustomers: true, canAccessInvoices: true,
    canAccessServices: true, canAccessProducts: true, canAccessExpenses: false,
    canAccessTimeTracking: true, canAccessChat: true, canAccessWhatsapp: true, canAccessSettings: false,
    // Reporting defaults come from the module's own resolver, so the template shown
    // here can never drift from what usePermissions actually grants.
    canAssignTasks: false,
    ...reportingCapabilitiesFor('Sales'),
  },
  SalesAgent: {
    canAccessProjects: false, canAccessTasks: true, canAccessGoals: false,
    canAccessCRM: true, canAccessCustomers: true, canAccessInvoices: true,
    canAccessServices: true, canAccessProducts: true, canAccessExpenses: false,
    canAccessTimeTracking: true, canAccessChat: true, canAccessWhatsapp: true, canAccessSettings: false,
    canAssignTasks: true,
    ...reportingCapabilitiesFor('SalesAgent'),
  },
  Manager: {
    canAccessProjects: true, canAccessTasks: true, canAccessGoals: true,
    canAccessCRM: false, canAccessCustomers: false, canAccessInvoices: false,
    canAccessServices: false, canAccessProducts: false, canAccessExpenses: false,
    canAccessTimeTracking: true, canAccessChat: true, canAccessWhatsapp: true, canAccessSettings: false,
    canAssignTasks: true,
    ...reportingCapabilitiesFor('Manager'),
  },
  Member: {
    canAccessProjects: true, canAccessTasks: true, canAccessGoals: true,
    canAccessCRM: false, canAccessCustomers: false, canAccessInvoices: false,
    canAccessServices: false, canAccessProducts: false, canAccessExpenses: false,
    canAccessTimeTracking: true, canAccessChat: true, canAccessWhatsapp: true, canAccessSettings: false,
    canAssignTasks: false,
    ...reportingCapabilitiesFor('Member'),
  },
  Viewer: {
    canAccessProjects: true, canAccessTasks: true, canAccessGoals: false,
    canAccessCRM: false, canAccessCustomers: false, canAccessInvoices: false,
    canAccessServices: false, canAccessProducts: false, canAccessExpenses: false,
    canAccessTimeTracking: false, canAccessChat: true, canAccessWhatsapp: true, canAccessSettings: false,
    canAssignTasks: false,
    ...reportingCapabilitiesFor('Viewer'),
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
  const [applying, setApplying] = useState<Record<RoleKey, boolean>>({ Sales: false, SalesAgent: false, Manager: false, Member: false, Viewer: false });
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
      // businessId makes the query provable under the teamMembers read rule —
      // a role-only list was denied for every non-super-admin admin.
      const applyBid = getGlobalBusinessId();
      const snap = await getDocs(
        query(
          collection(db, 'teamMembers'),
          ...(applyBid ? [where('businessId', '==', applyBid)] : []),
          where('role', '==', role),
        )
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
      {(['Sales', 'SalesAgent', 'Manager', 'Member', 'Viewer'] as RoleKey[]).map(role => {
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