import React, { useEffect, useState } from 'react';
import { Flag, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { Checkbox } from '../ui/checkbox';
import { toast } from '../../hooks/use-toast';
import { useAuth } from '../../contexts/AuthContext';
import { REPORT_REASONS, REPORT_NOTE_MAX, type ReportReason } from '../../lib/chat/moderation';

interface Props {
  /** The message being reported; null closes the dialog. */
  message: { id: string; senderId?: string | null; content?: string } | null;
  senderName: string;
  onClose: () => void;
  /** Block the sender too ("Blloko gjithashtu") — handled by the caller's useBlockedUsers. */
  onBlock: (uid: string) => Promise<void>;
}

/**
 * "Raporto mesazhin" (App Store guideline 1.2). The report goes to
 * POST /api/report-content, which stores it, alerts the managers and emails the
 * platform; the reporter can block the sender in the same step.
 */
const ReportMessageDialog: React.FC<Props> = ({ message, senderName, onClose, onBlock }) => {
  const { user } = useAuth();
  const [reason, setReason] = useState<ReportReason>('inappropriate');
  const [note, setNote] = useState('');
  const [alsoBlock, setAlsoBlock] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (message) { setReason('inappropriate'); setNote(''); setAlsoBlock(true); setBusy(false); }
  }, [message?.id]);

  const submit = async () => {
    if (!message || !user) return;
    setBusy(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/report-content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ messageId: message.id, reason, note }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Raportimi dështoi.');
      if (alsoBlock && message.senderId) await onBlock(message.senderId);
      toast({
        title: 'Faleminderit — mesazhi u raportua',
        description: alsoBlock
          ? `${senderName} u bllokua. Raporti shqyrtohet brenda 24 orëve.`
          : 'Raporti shqyrtohet brenda 24 orëve.',
      });
      onClose();
    } catch (err) {
      toast({ title: 'Raportimi dështoi', description: (err as Error).message, variant: 'destructive' });
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!message} onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Flag className="h-4 w-4 text-destructive" /> Raporto mesazhin</DialogTitle>
          <DialogDescription>
            Raporti shkon te menaxherët e hapësirës dhe te ekipi i FivoCRM. {senderName} nuk njoftohet.
          </DialogDescription>
        </DialogHeader>

        {message?.content && (
          <p className="text-sm text-muted-foreground bg-muted/50 rounded-lg px-3 py-2 line-clamp-3">"{message.content}"</p>
        )}

        <div className="space-y-2" role="radiogroup" aria-label="Arsyeja">
          {REPORT_REASONS.map((r) => (
            <label key={r.key} className="flex items-center gap-3 rounded-lg border px-3 py-2.5 cursor-pointer has-[:checked]:border-primary has-[:checked]:bg-primary/5">
              <input
                type="radio"
                name="report-reason"
                value={r.key}
                checked={reason === r.key}
                onChange={() => setReason(r.key)}
                className="accent-primary"
              />
              <span className="text-sm">{r.label}</span>
            </label>
          ))}
        </div>

        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value.slice(0, REPORT_NOTE_MAX))}
          placeholder="Shënim (opsional)"
          rows={2}
          className="text-base sm:text-sm"
        />

        {message?.senderId && (
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <Checkbox checked={alsoBlock} onCheckedChange={(v) => setAlsoBlock(v === true)} />
            Blloko gjithashtu {senderName}
          </label>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>Anulo</Button>
          <Button variant="destructive" onClick={submit} disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Raporto
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ReportMessageDialog;
