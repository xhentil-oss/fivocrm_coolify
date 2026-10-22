import React, { useState } from 'react';
import { Ban, Loader2 } from 'lucide-react';
import { useMutation } from '../hooks/useFirestore';
import { usePermissions } from '../contexts/PermissionsContext';
import { useToast } from '../hooks/use-toast';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from './ui/alert-dialog';

/**
 * `waOptOut` on a lead / customer: the contact asked not to receive WhatsApp.
 * Every automated sender (campaigns, automations, invoice reminders) already
 * honours it server-side — this is the only place staff can SEE it and set it.
 * Writing it is Admin/Manager work (permission flags, never role strings).
 */

export const WaOptOutBadge: React.FC<{ className?: string }> = ({ className = '' }) => (
  <span
    className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-red-500/10 text-red-700 dark:text-red-400 border border-red-500/20 whitespace-nowrap ${className}`}
    title="Kontakti ka kërkuar të mos marrë mesazhe WhatsApp — dërgimet automatike e anashkalojnë"
  >
    <Ban className="w-3 h-3" /> Ka refuzuar WhatsApp
  </span>
);

interface Props {
  kind: 'lead' | 'customer';
  id: string;
  optedOut: boolean;
  /** Hide the badge (the caller renders it elsewhere) and show only the toggle. */
  toggleOnly?: boolean;
  className?: string;
}

const WaOptOutControl: React.FC<Props> = ({ kind, id, optedOut, toggleOnly, className = '' }) => {
  const permissions = usePermissions();
  const canManage = !!(permissions.isAdmin || permissions.isManager || permissions.isOwner || permissions.isSuperAdmin);
  const mutation = useMutation<any>(kind === 'lead' ? 'leads' : 'customers');
  const { toast } = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const apply = async () => {
    setSaving(true);
    try {
      // Explicit boolean both ways: removeUndefined() strips `undefined`, so only a
      // real value changes the stored flag.
      await mutation.update(id, { waOptOut: !optedOut });
      toast({ title: optedOut ? 'Refuzimi i WhatsApp u hoq' : 'U shënua: ka refuzuar WhatsApp' });
    } catch (err) {
      toast({ title: 'Gabim', description: err instanceof Error ? err.message : 'Ruajtja dështoi', variant: 'destructive' });
    } finally {
      setSaving(false);
      setConfirmOpen(false);
    }
  };

  if (!optedOut && !canManage) return null;

  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`} onClick={(e) => e.stopPropagation()}>
      {optedOut && !toggleOnly && <WaOptOutBadge />}
      {canManage && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setConfirmOpen(true); }}
          disabled={saving}
          className="text-[10px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline disabled:opacity-50 whitespace-nowrap"
        >
          {saving ? <Loader2 className="w-3 h-3 animate-spin inline" /> : optedOut ? 'Hiq refuzimin' : 'Shëno: refuzon WhatsApp'}
        </button>
      )}
      <AlertDialog open={confirmOpen} onOpenChange={(o) => { if (!saving) setConfirmOpen(o); }}>
        <AlertDialogContent onClick={(e) => e.stopPropagation()}>
          <AlertDialogHeader>
            <AlertDialogTitle>{optedOut ? 'Hiq refuzimin e WhatsApp?' : 'Shëno që kontakti refuzon WhatsApp?'}</AlertDialogTitle>
            <AlertDialogDescription>
              {optedOut
                ? 'Fushatat, automatizimet dhe kujtesat e faturave do të mund t’i dërgojnë sërish mesazhe WhatsApp këtij kontakti. Bëje vetëm nëse kontakti e ka kërkuar vetë.'
                : 'Asnjë mesazh automatik WhatsApp (fushata, automatizime, kujtesa faturash) nuk do t’i dërgohet më këtij kontakti. Dërgimi manual kërkon konfirmim.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Anulo</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); void apply(); }} disabled={saving}>
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />}
              {optedOut ? 'Hiq refuzimin' : 'Shëno refuzimin'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </span>
  );
};

export default WaOptOutControl;
