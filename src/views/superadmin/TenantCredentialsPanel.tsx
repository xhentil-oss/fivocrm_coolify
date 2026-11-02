import React, { useState } from 'react';
import { KeyRound, Loader2, ShieldCheck, Trash2, Zap, CheckCircle2, AlertCircle, BellRing } from 'lucide-react';
import { Card } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Switch } from '../../components/ui/switch';
import { useToast } from '../../hooks/use-toast';
import { auth } from '../../lib/firebase';
import { saveTenantSecrets, CREDENTIAL_LABELS } from '../../lib/tenantSecrets';
import { setTenantAiPolicy } from '../../lib/platformAdmin';
import { AI_PROVIDER_META, testAiConnection, type AiConnectionTest, type AiProviderName } from '../../lib/aiClient';
import { fmtDate } from './tenantMeta';
import type { Business, TenantCredentialField, TenantCredentialStatus } from '../../types';

/**
 * The platform's control of ONE tenant's credentials and AI policy.
 *
 * Credentials belong to the tenant (business), never to a team, and only the
 * super-admin sets them: values go to `businessSecrets/{bid}` through
 * `POST /api/tenant-secrets` and are never read back — this panel shows only the
 * status the server records on `businesses.credentials` (last 4, fingerprint,
 * who/when). Every change is audited and the tenant's owner is notified.
 */

/** Edited here as a single string. metaChannelTokens is a per-channel map, set from
 *  the tenant's Cilësimet → Meta form (as super-admin) — here only status / clear. */
const STRING_FIELDS: TenantCredentialField[] = [
  'emailApiKey', 'emailSmtpPass', 'whatsappVpsSecret', 'metaWebhookVerifyToken',
  'gmbClientSecret', 'dynadotApiKey', 'googlePlacesApiKey',
];

function StatusBadge({ s }: { s?: TenantCredentialStatus }) {
  if (!s?.configured) return <Badge variant="outline" className="text-muted-foreground">Pa konfiguruar</Badge>;
  return (
    <Badge variant="outline" className="border-success/40 text-success gap-1">
      <ShieldCheck className="h-3 w-3" />
      {s.count != null ? `${s.count} kanale` : s.last4 ? `••••${s.last4}` : 'Konfiguruar'}
    </Badge>
  );
}

function StatusMeta({ s }: { s?: TenantCredentialStatus }) {
  if (!s?.updatedAt) return null;
  return (
    <p className="text-[11px] text-muted-foreground">
      {s.configured ? 'Vendosur' : 'Hequr'} {fmtDate(s.updatedAt)}{s.updatedBy ? ` nga ${s.updatedBy}` : ''}
      {s.fingerprint ? <> · gjurma <span className="font-mono">{s.fingerprint}</span></> : null}
    </p>
  );
}

interface Props {
  businessId: string;
  biz: Business;
  /** A team of the tenant — the AI test runs through /api/ai-chat with it. */
  testTeamId: string | null;
}

const TenantCredentialsPanel: React.FC<Props> = ({ businessId, biz, testTeamId }) => {
  const { toast } = useToast();
  const creds = biz.credentials || {};
  const policy = biz.aiPolicy || {};

  const [aiKey, setAiKey] = useState('');
  const [drafts, setDrafts] = useState<Partial<Record<TenantCredentialField, string>>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [test, setTest] = useState<AiConnectionTest | null>(null);

  // Policy draft — falls back to the stored policy until edited.
  const [provider, setProvider] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [fallback, setFallback] = useState<boolean | null>(null);
  const [aiOff, setAiOff] = useState<boolean | null>(null);
  const providerVal = provider ?? (policy.provider || '');
  const modelVal = model ?? (policy.model || '');
  const fallbackVal = fallback ?? policy.allowPlatformFallback !== false;
  const aiOffVal = aiOff ?? policy.disabled === true;
  const policyDirty = provider !== null || model !== null || fallback !== null || aiOff !== null;

  const requestedAt = biz.credentialsChangeRequestedAt ? new Date(biz.credentialsChangeRequestedAt as any).getTime() : 0;
  const updatedAt = biz.credentialsUpdatedAt ? new Date(biz.credentialsUpdatedAt as any).getTime() : 0;
  const openRequest = requestedAt > updatedAt ? biz.credentialsChangeRequest : null;

  const run = async (key: string, fn: () => Promise<void>, done: string) => {
    if (busy) return;
    setBusy(key);
    try {
      await fn();
      toast({ title: done, description: 'U regjistrua në audit; pronari u njoftua.' });
    } catch (e: any) {
      toast({ title: 'Veprimi dështoi', description: e?.message || 'Provo përsëri.', variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  const saveField = (field: TenantCredentialField, value: string) =>
    run(field, async () => {
      await saveTenantSecrets({ businessId }, { [field]: value });
      if (field === 'aiApiKey') { setAiKey(''); setTest(null); }
      else setDrafts((d) => ({ ...d, [field]: '' }));
    }, value ? `${CREDENTIAL_LABELS[field]} u ruajt` : `${CREDENTIAL_LABELS[field]} u hoq`);

  const clearField = (field: TenantCredentialField) => {
    if (!window.confirm(`Të hiqet "${CREDENTIAL_LABELS[field]}" për "${biz.name}"? Funksionet që e përdorin ndalen menjëherë.`)) return;
    void saveField(field, '');
  };

  const runTest = async () => {
    if (busy || !testTeamId) return;
    setBusy('test');
    setTest(null);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('Nuk je i identifikuar.');
      setTest(await testAiConnection(token, testTeamId));
    } catch (e: any) {
      setTest({ ok: false, status: 0, message: e?.message || 'Gabim i papritur' });
    } finally {
      setBusy(null);
    }
  };

  const savePolicy = () =>
    run('policy', async () => {
      await setTenantAiPolicy(businessId, {
        provider: (providerVal || null) as AiProviderName | null,
        model: modelVal.trim() || null,
        allowPlatformFallback: fallbackVal,
        disabled: aiOffVal,
      });
      setProvider(null); setModel(null); setFallback(null); setAiOff(null);
    }, 'Politika e AI-së u ruajt');

  const modelOptions = providerVal ? AI_PROVIDER_META[providerVal as AiProviderName].models : [];

  return (
    <Card className="p-4 space-y-4">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <KeyRound className="h-4 w-4 text-primary" />
          <h2 className="font-semibold text-sm">Kredencialet &amp; AI</h2>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Një çelës për tenant, i njëjtë për të gjitha ekipet e tij. Vetëm platforma i vendos; tenant-i sheh
          vetëm statusin. Vlerat nuk lexohen më kurrë pas ruajtjes.
        </p>
      </div>

      {openRequest && (
        <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40 p-2.5">
          <BellRing className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
          <p className="text-[11px] text-amber-900 dark:text-amber-200">
            <strong>Kërkesë e hapur</strong> nga {openRequest.byEmail || 'administratori'} ({fmtDate(biz.credentialsChangeRequestedAt)}):{' '}
            {openRequest.field ? CREDENTIAL_LABELS[openRequest.field] : 'kredencialet'}
            {openRequest.note ? ` — "${openRequest.note}"` : ''}
          </p>
        </div>
      )}

      {/* ── AI ── */}
      <div className="rounded-lg border p-3 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <Label className="text-sm font-medium">{CREDENTIAL_LABELS.aiApiKey}</Label>
          <StatusBadge s={creds.aiApiKey} />
        </div>
        <StatusMeta s={creds.aiApiKey} />
        <div className="flex flex-col sm:flex-row gap-2">
          <Input
            type="password"
            autoComplete="off"
            value={aiKey}
            onChange={(e) => setAiKey(e.target.value)}
            placeholder={creds.aiApiKey?.configured ? 'Çelës i ri (rrotullim)…' : 'sk-ant-… / AIza… / sk-…'}
            className="font-mono text-sm"
          />
          <Button size="sm" disabled={!aiKey.trim() || !!busy} onClick={() => saveField('aiApiKey', aiKey.trim())}>
            {busy === 'aiApiKey' ? <Loader2 className="h-4 w-4 animate-spin" /> : creds.aiApiKey?.configured ? 'Rrotullo' : 'Ruaj'}
          </Button>
          <Button size="sm" variant="outline" disabled={!!busy || !testTeamId} onClick={runTest} className="gap-1">
            {busy === 'test' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />} Testo
          </Button>
          {creds.aiApiKey?.configured && (
            <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => clearField('aiApiKey')} className="text-destructive gap-1">
              <Trash2 className="h-4 w-4" /> Hiq
            </Button>
          )}
        </div>
        {test && (
          <div className={`rounded-md border p-2 text-xs ${test.ok ? 'border-success/40 bg-success/5' : 'border-destructive/40 bg-destructive/5'}`} role="status">
            {test.ok ? (
              <p className="flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-success" /> Funksionon — {test.provider} · <span className="font-mono">{test.model}</span></p>
            ) : (
              <p className="flex items-start gap-1.5"><AlertCircle className="h-3.5 w-3.5 text-destructive mt-0.5" />
                <span>{test.message}{test.code ? ` (${test.code})` : ''}{test.detail ? ` — ${test.detail}` : ''}</span></p>
            )}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2 pt-1">
          <div className="space-y-1">
            <Label className="text-xs">Ofruesi</Label>
            <select
              value={providerVal}
              onChange={(e) => { setProvider(e.target.value); setModel(''); }}
              className="w-full h-9 px-2 bg-background border border-border rounded-md text-sm"
            >
              <option value="">Sipas çelësit (automatik)</option>
              {(Object.keys(AI_PROVIDER_META) as AiProviderName[]).map((p) => (
                <option key={p} value={p}>{AI_PROVIDER_META[p].label}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Modeli</Label>
            <Input
              list={`ai-models-${businessId}`}
              value={modelVal}
              onChange={(e) => setModel(e.target.value)}
              placeholder={providerVal ? `Parazgjedhja — ${AI_PROVIDER_META[providerVal as AiProviderName].defaultModel}` : 'Parazgjedhja e ofruesit'}
              className="h-9 font-mono text-sm"
            />
            <datalist id={`ai-models-${businessId}`}>
              {modelOptions.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </datalist>
          </div>
        </div>
        <label className="flex items-center justify-between gap-3 text-sm">
          <span>
            Lejo çelësin e platformës si rezervë
            <span className="block text-[11px] text-muted-foreground">Kur tenant-i nuk ka çelës të vetin, AI punon me çelësin e FivoCRM (kosto jona).</span>
          </span>
          <Switch checked={fallbackVal} onCheckedChange={(v) => setFallback(!!v)} />
        </label>
        <label className="flex items-center justify-between gap-3 text-sm">
          <span>
            Çaktivizo AI-në për këtë tenant
            <span className="block text-[11px] text-muted-foreground">FivoAI, Ana, Nazmije, draftet WhatsApp dhe përgjigjet GMB ndalen.</span>
          </span>
          <Switch checked={aiOffVal} onCheckedChange={(v) => setAiOff(!!v)} />
        </label>
        {policy.updatedAt && (
          <p className="text-[11px] text-muted-foreground">Politika: ndryshuar {fmtDate(policy.updatedAt)}{policy.updatedBy ? ` nga ${policy.updatedBy}` : ''}</p>
        )}
        <div className="flex justify-end">
          <Button size="sm" disabled={!policyDirty || !!busy} onClick={savePolicy}>
            {busy === 'policy' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Ruaj politikën'}
          </Button>
        </div>
      </div>

      {/* ── Other credentials ── */}
      <div className="divide-y rounded-lg border">
        {STRING_FIELDS.map((field) => (
          <div key={field} className="p-3 space-y-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <Label className="text-sm">{CREDENTIAL_LABELS[field]}</Label>
              <StatusBadge s={creds[field]} />
            </div>
            <StatusMeta s={creds[field]} />
            <div className="flex flex-col sm:flex-row gap-2">
              <Input
                type="password"
                autoComplete="off"
                value={drafts[field] || ''}
                onChange={(e) => setDrafts((d) => ({ ...d, [field]: e.target.value }))}
                placeholder={creds[field]?.configured ? 'Vlerë e re (zëvendëson të vjetrën)…' : 'Vendos vlerën…'}
                className="font-mono text-sm"
              />
              <Button size="sm" disabled={!(drafts[field] || '').trim() || !!busy} onClick={() => saveField(field, (drafts[field] || '').trim())}>
                {busy === field ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Ruaj'}
              </Button>
              {creds[field]?.configured && (
                <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => clearField(field)} className="text-destructive gap-1">
                  <Trash2 className="h-4 w-4" /> Hiq
                </Button>
              )}
            </div>
          </div>
        ))}
        <div className="p-3 space-y-1">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <Label className="text-sm">{CREDENTIAL_LABELS.metaChannelTokens}</Label>
            <div className="flex items-center gap-2">
              <StatusBadge s={creds.metaChannelTokens} />
              {creds.metaChannelTokens?.configured && (
                <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => clearField('metaChannelTokens')} className="text-destructive gap-1">
                  <Trash2 className="h-4 w-4" /> Hiq të gjithë
                </Button>
              )}
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Token-at vendosen për kanal te Cilësimet → Meta, brenda workspace-it të tenant-it (si super-admin).
          </p>
        </div>
      </div>
    </Card>
  );
};

export default TenantCredentialsPanel;
