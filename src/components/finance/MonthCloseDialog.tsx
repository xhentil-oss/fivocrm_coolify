import React, { useState } from 'react';
import { Lock } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { useToast } from '../../hooks/use-toast';

/**
 * "Mbyll muajin": the pre-close checklist, then the lock. Closing with open
 * checks is allowed — but they are written onto the close document, so a month
 * closed with 40 hours missing says so forever.
 */
interface Props {
  open: boolean;
  onClose: () => void;
  periodLabel: string;
  checks: string[];
  onConfirm: (acknowledgedWarnings: string[]) => Promise<void> | void;
}

const MonthCloseDialog: React.FC<Props> = ({ open, onClose, periodLabel, checks, onConfirm }) => {
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();
  // The write can legitimately be REFUSED (rules: admin of the business only,
  // tenant active) or fail on the network. A bare try/finally swallowed that:
  // the dialog closed as if the month were locked while nothing was written.
  // On failure the dialog stays open and the error code is shown.
  const confirm = async () => {
    setBusy(true);
    try {
      await onConfirm(checks);
      onClose();
    } catch (err: any) {
      console.error('[MonthClose] close failed:', err);
      toast({
        title: 'Muaji nuk u mbyll',
        description: `${err?.code ? `${err.code}: ` : ''}${err?.message || 'Nuk ke leje për këtë veprim ose ndodhi një gabim — provo përsëri.'}`,
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Lock className="h-4 w-4" /> Mbyll {periodLabel}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            Pas mbylljes, orët e këtij muaji nuk mund të shtohen, ndryshohen apo fshihen më, dhe tabela e klientëve ruhet siç është tani.
          </p>
          {checks.length > 0 ? (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-950/30">
              <p className="mb-1 font-semibold text-amber-800 dark:text-amber-300">Kontrollet që ende s'kalojnë</p>
              <ul className="list-disc space-y-1 pl-5 text-amber-900 dark:text-amber-200">
                {checks.map((c, i) => <li key={i}>{c}</li>)}
              </ul>
              <p className="mt-2 text-xs text-amber-800/80 dark:text-amber-300/80">Mund ta mbyllësh gjithsesi; këto shënime ruhen bashkë me mbylljen.</p>
            </div>
          ) : (
            <p className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">
              Të gjitha kontrollet kalojnë.
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>Anulo</Button>
            <Button disabled={busy} onClick={confirm}>
              {busy ? 'Duke mbyllur…' : 'Mbyll muajin'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default MonthCloseDialog;
