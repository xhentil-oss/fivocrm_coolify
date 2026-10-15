import React from 'react';
import { Trash2, ExternalLink } from 'lucide-react';
import { Card } from './ui/card';
import { Button } from './ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from './ui/alert-dialog';
import { useAuth } from '../contexts/AuthContext';
import { openExternal } from '../lib/native';

/** Where deletion requests go — the same address the public page names. */
const DELETION_EMAIL = 'social@fivo.al';
const DELETION_PAGE = 'https://fivocrm.com/delete-account';

/**
 * "Fshi llogarinë" — account deletion initiated from INSIDE the app.
 *
 * App Store guideline 5.1.1(v): an app that lets people sign in must let them start
 * deleting their account from within the app; the public /delete-account page alone
 * (written for Google Play's Data Safety form) was linked from nowhere in the app.
 *
 * Deletion stays a request handled by Fivo, not an instant wipe: an account can own a
 * whole business (invoices, payroll history, other people's data), so the request
 * opens a pre-filled email carrying the uid, and the page explains what is deleted,
 * what is kept and the deadlines. Mounted on the staff profile and the portal profile.
 */
const DeleteAccountCard: React.FC = () => {
  const { user } = useAuth();
  if (!user) return null;

  const sendRequest = () => {
    const subject = encodeURIComponent('Kërkesë për fshirjen e llogarisë — FivoCRM');
    const body = encodeURIComponent(
      'Përshëndetje,\n\nKërkoj fshirjen e llogarisë sime dhe të të dhënave përkatëse në FivoCRM.\n\n'
      + `Email i llogarisë: ${user.email || '—'}\nID e llogarisë: ${user.uid}\n\nFaleminderit.`,
    );
    // mailto: leaves the WebView — Capacitor hands non-http schemes to the OS.
    window.location.href = `mailto:${DELETION_EMAIL}?subject=${subject}&body=${body}`;
  };

  return (
    <Card className="p-5 space-y-3 border-destructive/30">
      <div className="flex items-start gap-3">
        <Trash2 className="w-5 h-5 text-destructive mt-0.5 shrink-0" />
        <div className="space-y-1 min-w-0">
          <h3 className="text-body font-semibold text-foreground">Fshi llogarinë</h3>
          <p className="text-body-sm text-muted-foreground">
            Kërkoni fshirjen e përhershme të llogarisë suaj dhe të të dhënave personale.
            Kërkesa përpunohet brenda 30 ditëve.
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" size="sm">Fshi llogarinë</Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Të fshihet llogaria?</AlertDialogTitle>
              <AlertDialogDescription>
                Do hapet një email i gatshëm drejt {DELETION_EMAIL} me të dhënat e llogarisë suaj.
                Pasi ta dërgoni, llogaria dhe të dhënat personale fshihen brenda 30 ditëve dhe
                nuk mund të rikthehen. Faturat dhe dokumentet ligjore të biznesit ruhen aq sa
                kërkon ligji.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Anulo</AlertDialogCancel>
              <AlertDialogAction
                onClick={sendRequest}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Dërgo kërkesën
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => openExternal(DELETION_PAGE)}>
          <ExternalLink className="w-3.5 h-3.5" /> Çfarë fshihet
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Nëse email-i nuk hapet, shkruani te {DELETION_EMAIL} nga adresa e llogarisë.
      </p>
    </Card>
  );
};

export default DeleteAccountCard;
