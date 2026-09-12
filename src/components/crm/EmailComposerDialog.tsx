import React, { useEffect, useMemo, useState } from 'react';
import { Mail, Send } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../hooks/use-toast';
import { useTeamSettingsData } from '../../hooks/useTeamSettings';
import { safeSenderName, safeSenderAddress } from '../../lib/emailIdentity';
import type { FollowUpEntity } from '../../lib/crm/followUp';

export interface EmailTarget {
  kind: FollowUpEntity;
  id: string;
  name: string;
  email: string;
  company?: string | null;
}

interface Props {
  target: EmailTarget | null;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful send (the server already logged the timeline row + stamped the contact). */
  onSent?: (target: EmailTarget) => void;
}

const firstNameOf = (name: string) => name.trim().split(/\s+/)[0] || name;

const TEMPLATES: { key: string; label: string; subject: string; body: (firstName: string, company: string) => string }[] = [
  {
    key: 'follow', label: 'Ndjekje',
    subject: 'Vazhdim i bisedës sonë',
    body: (fn, co) => `Përshëndetje ${fn},\n\nDoja të vazhdoja bisedën tonë të fundit${co ? ` për ${co}` : ''}. A keni mundësi për një telefonatë të shkurtër këtë javë?\n\nFaleminderit,`,
  },
  {
    key: 'offer', label: 'Oferta',
    subject: 'Oferta jonë për ju',
    body: (fn) => `Përshëndetje ${fn},\n\nSiç biseduam, ju dërgoj ofertën tonë. Jam në dispozicion për çdo pyetje apo përshtatje.\n\nFaleminderit,`,
  },
  {
    key: 'thanks', label: 'Falënderim',
    subject: 'Faleminderit për takimin',
    body: (fn) => `Përshëndetje ${fn},\n\nFaleminderit për kohën tuaj sot. Do t'ju dërgoj hapat e ardhshëm brenda ditës.\n\nMe respekt,`,
  },
];

/** True when the tenant can send from the CRM (a provider is configured). */
export function useContactEmailAvailable(): boolean {
  const settings = useTeamSettingsData();
  return !!(settings && (settings.emailProvider || settings.hasEmailApiKey || settings.emailSmtpHost));
}

/**
 * 1:1 email from the CRM, sent with the BUSINESS identity and Reply-To the staff
 * member — replaces `mailto:` (which left the conversation in a personal mailbox
 * the CRM never saw). The server logs the activity + stamps the contact.
 */
const EmailComposerDialog: React.FC<Props> = ({ target, onOpenChange, onSent }) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const settings = useTeamSettingsData();
  const [subject, setSubject] = useState('');
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  const staffName = user?.displayName || user?.email?.split('@')[0] || 'Stafi';
  const companyName = settings?.companyName || settings?.emailFromName || 'FivoCRM';
  const fromPreview = useMemo(() => safeSenderName(`${staffName} · ${companyName}`), [staffName, companyName]);
  const replyToPreview = safeSenderAddress(user?.email) || '';

  useEffect(() => {
    if (!target) return;
    setSubject('');
    setText(`Përshëndetje ${firstNameOf(target.name)},\n\n\n\nFaleminderit,\n${staffName}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.id]);

  const applyTemplate = (key: string) => {
    if (!target) return;
    const t = TEMPLATES.find(x => x.key === key);
    if (!t) return;
    setSubject(t.subject);
    setText(`${t.body(firstNameOf(target.name), target.company || '')}\n${staffName}`);
  };

  const send = async () => {
    if (!target || !user || sending) return;
    if (!subject.trim() || !text.trim()) {
      toast({ title: 'Plotëso subjektin dhe mesazhin', variant: 'destructive' });
      return;
    }
    setSending(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/contact-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          ...(target.kind === 'lead' ? { leadId: target.id } : { customerId: target.id }),
          subject: subject.trim(),
          text: text.trim(),
          replyToSelf: true,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Dërgimi dështoi');
      toast({ title: 'Email u dërgua', description: `${target.name} · ${target.email}` });
      onSent?.(target);
      onOpenChange(false);
    } catch (err: unknown) {
      toast({ title: 'Gabim email', description: err instanceof Error ? err.message : 'Dërgimi dështoi', variant: 'destructive' });
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={!!target} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Mail className="w-4 h-4" /> Email për {target?.name}</DialogTitle>
        </DialogHeader>
        {target && (
          <div className="space-y-3">
            <div className="text-xs text-muted-foreground space-y-0.5 rounded-md bg-muted/40 p-2">
              <p><span className="font-medium text-foreground">Për:</span> {target.email}</p>
              <p><span className="font-medium text-foreground">Nga:</span> {fromPreview}{settings?.emailFromEmail ? ` <${settings.emailFromEmail}>` : ''}</p>
              {replyToPreview && <p><span className="font-medium text-foreground">Përgjigjet te:</span> {replyToPreview}</p>}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {TEMPLATES.map(t => (
                <button key={t.key} type="button" onClick={() => applyTemplate(t.key)}
                  className="h-7 rounded-full border text-xs px-2.5 hover:bg-muted transition-colors">
                  {t.label}
                </button>
              ))}
            </div>
            <div>
              <Label htmlFor="ce-subject" className="text-xs text-muted-foreground">Subjekti</Label>
              <Input id="ce-subject" value={subject} onChange={(e) => setSubject(e.target.value)} className="mt-1" maxLength={150} />
            </div>
            <div>
              <Label htmlFor="ce-text" className="text-xs text-muted-foreground">Mesazhi</Label>
              <Textarea id="ce-text" value={text} onChange={(e) => setText(e.target.value)} rows={9} className="mt-1 text-sm" />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={sending}>Anulo</Button>
              <Button size="sm" onClick={send} disabled={sending || !subject.trim() || !text.trim()}>
                <Send className="w-4 h-4 mr-1.5" />{sending ? 'Duke dërguar…' : 'Dërgo'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default EmailComposerDialog;
