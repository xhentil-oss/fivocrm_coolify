import { useState } from 'react';
import { sendEmailVerification, type User } from 'firebase/auth';
import { MailCheck, Loader2, RefreshCw } from 'lucide-react';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { useAuth } from '../contexts/AuthContext';

/**
 * Shown instead of the tenant bootstrap to a PASSWORD user whose address is not yet
 * verified and who has no membership keyed by their uid. Until the address is
 * verified the app never matches them to a `teamMembers` row by email (see
 * usePermissions) — otherwise anyone could type a colleague's address at sign-up and
 * inherit their seat. Verified users and uid-linked members never see this screen.
 */
export function needsEmailVerification(user: User | null | undefined): boolean {
  if (!user || !user.email || user.emailVerified) return false;
  const providers = user.providerData.map((p) => p.providerId);
  // Only a password account can be unverified in practice; a federated provider
  // (Google, Apple) vouches for the address itself.
  return providers.length === 0 || providers.every((p) => p === 'password');
}

export default function VerifyEmailScreen({ user }: { user: User }) {
  const { logout } = useAuth();
  const [sending, setSending] = useState(false);
  const [checking, setChecking] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const resend = async () => {
    setSending(true);
    setNotice(null);
    try {
      await sendEmailVerification(user);
      setNotice({ kind: 'ok', text: `Email-i i verifikimit u dërgua te ${user.email}. Kontrollo edhe dosjen Spam.` });
    } catch (err: any) {
      const code = err?.code as string | undefined;
      setNotice({
        kind: 'error',
        text: code === 'auth/too-many-requests'
          ? 'Shumë kërkesa. Prit pak minuta dhe provo përsëri.'
          : `Dërgimi dështoi${code ? ` (${code})` : ''}. Provo përsëri.`,
      });
    } finally {
      setSending(false);
    }
  };

  const recheck = async () => {
    setChecking(true);
    setNotice(null);
    try {
      await user.reload();
      if (user.emailVerified) {
        // Force a fresh ID token (the server mints claims from the verified flag) and
        // re-enter the app: the User object is mutated in place, so a state update
        // alone would not re-run the membership queries.
        await user.getIdToken(true).catch(() => {});
        window.location.replace('/');
        return;
      }
      setNotice({ kind: 'error', text: 'Email-i nuk është verifikuar ende. Kliko lidhjen në email dhe provo përsëri.' });
    } catch (err: any) {
      setNotice({ kind: 'error', text: `Kontrolli dështoi${err?.code ? ` (${err.code})` : ''}. Provo përsëri.` });
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md p-8 space-y-6">
        <div className="text-center space-y-2">
          <div className="mx-auto w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
            <MailCheck className="w-7 h-7 text-primary" />
          </div>
          <h1 className="text-2xl font-bold">Verifiko email-in</h1>
          <p className="text-sm text-muted-foreground">
            Të dërguam një lidhje verifikimi te <span className="font-medium text-foreground">{user.email}</span>.
            Hape dhe kliko lidhjen, pastaj kthehu këtu.
          </p>
        </div>

        {notice && (
          <div
            role={notice.kind === 'error' ? 'alert' : 'status'}
            className={`rounded-lg border p-3 text-sm ${
              notice.kind === 'ok'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200'
                : 'border-destructive/30 bg-destructive/10 text-destructive'
            }`}
          >
            {notice.text}
          </div>
        )}

        <div className="space-y-2">
          <Button onClick={recheck} disabled={checking || sending} className="w-full">
            {checking ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
            Kontrollo përsëri
          </Button>
          <Button onClick={resend} disabled={sending || checking} variant="outline" className="w-full">
            {sending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            Ridërgo email-in e verifikimit
          </Button>
        </div>

        <p className="text-center text-xs text-muted-foreground">
          Email i gabuar?{' '}
          <button type="button" onClick={() => { void logout(); }} className="underline hover:text-foreground">
            Dil dhe hyr me një llogari tjetër
          </button>
        </p>
      </Card>
    </div>
  );
}
