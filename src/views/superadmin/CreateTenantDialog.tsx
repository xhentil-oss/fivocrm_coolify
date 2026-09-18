import React, { useState } from 'react';
import { Building2, Loader2, Copy, Check, Send, SlidersHorizontal } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { useToast } from '../../hooks/use-toast';
import { useAuth } from '../../contexts/AuthContext';
import { createTenantFromConsole, type CreateTenantResult } from '../../lib/platformAdmin';
import { defaultDisabledModulePaths } from '../../lib/modules';
import ModuleAccessEditor from './ModuleAccessEditor';
import { PLAN_LABEL } from './tenantMeta';

/**
 * Sales-assisted onboarding.
 *
 * A tenant could previously only be born from the self-serve `/signup` page, so
 * onboarding a customer over the phone or at a meeting was impossible. This creates the
 * business + its default team and INVITES the owner as Admin — it never pre-creates an
 * account or a password, because the invite flow is what proves the email is theirs.
 *
 * Module access is decided here too, in the platform's own layer (`lockedModules`):
 * what the contract includes. The owner's layer (`disabledModules`) starts at the
 * registry default (shop/hosting/… off until they opt in) and stays theirs to change.
 */
const CreateTenantDialog: React.FC<{ open: boolean; onOpenChange: (v: boolean) => void }> = ({ open, onOpenChange }) => {
  const { toast } = useToast();
  const { user } = useAuth();
  const [name, setName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [plan, setPlan] = useState('trial');
  const [trialDays, setTrialDays] = useState('14');
  // Layer 1 — nothing withheld by default: the plan is the ceiling, the contract may
  // narrow it further.
  const [locked, setLocked] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CreateTenantResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [sending, setSending] = useState(false);

  const toggleLocked = (path: string, nextLocked: boolean) => setLocked(prev => {
    const next = new Set(prev);
    if (nextLocked) next.add(path); else next.delete(path);
    return next;
  });

  const reset = () => {
    setName(''); setOwnerEmail(''); setPlan('trial'); setTrialDays('14');
    setLocked(new Set());
    setResult(null); setCopied(false);
  };

  const inviteLink = result?.inviteToken
    ? `${window.location.origin}/join/${result.inviteToken}`
    : null;

  const submit = async (force = false) => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await createTenantFromConsole({
        name: name.trim(),
        ownerEmail: ownerEmail.trim(),
        plan,
        trialDays: Number(trialDays) || 0,
        lockedModules: Array.from(locked),
        disabledModules: defaultDisabledModulePaths(),
        force,
      });
      setResult(res);
      toast({ title: 'Tenanti u krijua', description: 'Dërgoji pronarit linkun e ftesës për t\'u bërë Admin.' });
    } catch (err: any) {
      // A duplicate owner email is the common mistake, so it is offered as a choice
      // rather than a dead end.
      if (err?.existingBusinessId) {
        const go = window.confirm(`${err.message}\n\nKrijo gjithsesi një biznes të dytë?`);
        if (go) { setBusy(false); return submit(true); }
      } else {
        toast({ title: 'Krijimi dështoi', description: err?.message || 'Provo përsëri.', variant: 'destructive' });
      }
    } finally {
      setBusy(false);
    }
  };

  /** Send the invite through the existing invite mailer. */
  const sendInvite = async () => {
    if (!inviteLink || !user || sending) return;
    setSending(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/send-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          to: ownerEmail.trim(),
          teamName: name.trim(),
          inviteLink,
          senderName: 'FivoCRM',
        }),
      });
      if (!res.ok) throw new Error(`Gabim serveri (${res.status})`);
      toast({ title: 'Ftesa u dërgua', description: ownerEmail.trim() });
    } catch (err: any) {
      toast({
        title: 'Email-i nuk u dërgua',
        description: `${err?.message || 'Provo përsëri'} — linku mbetet i vlefshëm, dërgoje manualisht.`,
        variant: 'destructive',
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-primary" /> Krijo tenant
          </DialogTitle>
        </DialogHeader>

        {result ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Biznesi u krijua. Pronari bëhet Admin sapo pranon ftesën — deri atëherë tenanti
              nuk ka owner uid, dhe kjo është e vërteta e gjendjes.
            </p>
            <div className="rounded-md border border-border bg-muted/40 p-2.5 space-y-1.5">
              <p className="text-[11px] text-muted-foreground">Linku i ftesës (14 ditë)</p>
              <p className="text-xs font-mono break-all">{inviteLink}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={sendInvite} disabled={sending}>
                {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Send className="h-3.5 w-3.5 mr-1.5" />}
                Dërgo me email
              </Button>
              <Button
                size="sm" variant="outline"
                onClick={() => {
                  if (!inviteLink) return;
                  void navigator.clipboard.writeText(inviteLink).then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  });
                }}
              >
                {copied ? <Check className="h-3.5 w-3.5 mr-1.5" /> : <Copy className="h-3.5 w-3.5 mr-1.5" />}
                {copied ? 'U kopjua' : 'Kopjo linkun'}
              </Button>
              <Button size="sm" variant="ghost" onClick={reset}>Krijo një tjetër</Button>
            </div>
          </div>
        ) : (
          <form
            className="space-y-3"
            onSubmit={(e) => { e.preventDefault(); void submit(false); }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="ct-name">Emri i biznesit</Label>
              <Input id="ct-name" value={name} onChange={e => setName(e.target.value)} placeholder="Agjencia Shembull" required minLength={2} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ct-email">Email i pronarit</Label>
              <Input id="ct-email" type="email" value={ownerEmail} onChange={e => setOwnerEmail(e.target.value)} placeholder="pronari@shembull.com" required />
              <p className="text-[11px] text-muted-foreground">
                Merr një ftesë Admin. Nuk krijohet llogari me fjalëkalim.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="ct-plan">Paketa</Label>
                <select
                  id="ct-plan" value={plan} onChange={e => setPlan(e.target.value)}
                  className="h-9 px-2 rounded-md border border-border bg-background text-sm w-full"
                >
                  {['trial', 'starter', 'pro', 'business', 'enterprise'].map(p => (
                    <option key={p} value={p}>{PLAN_LABEL[p] || p}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ct-days">Ditë provë</Label>
                <Input id="ct-days" type="number" min={0} max={180} value={trialDays} onChange={e => setTrialDays(e.target.value)} />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Me 0 ditë provë tenanti krijohet <strong>aktiv</strong> — përdore vetëm për
              kontratë të nënshkruar, sepse asnjë pagesë nuk kërkohet nga Stripe.
            </p>

            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5">
                <SlidersHorizontal className="h-3.5 w-3.5 text-primary" /> Modulet e kontratës
              </Label>
              <ModuleAccessEditor
                compact
                plan={plan}
                locked={locked}
                onToggleLocked={toggleLocked}
                onReplaceLocked={setLocked}
              />
            </div>

            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Krijo tenantin
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default CreateTenantDialog;
