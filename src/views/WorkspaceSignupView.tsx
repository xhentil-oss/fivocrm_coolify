import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createUserWithEmailAndPassword, updateProfile, sendEmailVerification } from 'firebase/auth';
import { auth } from '../lib/firebase';
import { createTenant } from '../lib/createTenant';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card } from '../components/ui/card';
import { Loader2, Building2 } from 'lucide-react';

/**
 * Self-serve SaaS workspace signup. Distinct from RegisterView (which captures a
 * public lead into the agency's own CRM): this creates a NEW isolated tenant
 * (team + owner membership + default settings) owned by the registrant.
 */
const WorkspaceSignupView: React.FC = () => {
  const navigate = useNavigate();
  const [companyName, setCompanyName] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!companyName.trim() || !fullName.trim() || !email.trim() || !password) {
      setError('Plotëso emrin e biznesit, emrin tënd, email-in dhe fjalëkalimin.');
      return;
    }
    if (password.length < 6) {
      setError('Fjalëkalimi duhet të ketë të paktën 6 karaktere.');
      return;
    }
    if (password !== confirm) {
      setError('Fjalëkalimet nuk përputhen.');
      return;
    }

    setLoading(true);
    try {
      // 1. Create the owner's auth account (auto-signs them in).
      const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
      await updateProfile(cred.user, { displayName: fullName.trim() }).catch(() => {});
      sendEmailVerification(cred.user).catch(() => {});

      // 2. Provision their isolated workspace (team + membership + settings).
      await createTenant({
        uid: cred.user.uid,
        companyName: companyName.trim(),
        ownerName: fullName.trim(),
        ownerEmail: email.trim(),
      });

      // 3. Into the app — usePermissions resolves them as owner of the new tenant.
      navigate('/app');
    } catch (err: any) {
      const code = err?.code as string | undefined;
      // eslint-disable-next-line no-console
      console.error('[signup] failed:', code, err?.message);
      if (code === 'auth/email-already-in-use') {
        setError('Ky email është tashmë i regjistruar. Hyr nga faqja e hyrjes.');
      } else if (code === 'auth/invalid-email') {
        setError('Email-i nuk është i vlefshëm.');
      } else if (code === 'auth/weak-password' || code === 'auth/password-does-not-meet-requirements') {
        setError('Fjalëkalimi nuk i plotëson kërkesat (provo një më të gjatë/të fortë).');
      } else if (code === 'auth/operation-not-allowed') {
        setError('Regjistrimi me email/fjalëkalim nuk është aktiv. Aktivizoje te Firebase Console → Authentication → Sign-in method → Email/Password.');
      } else {
        setError(`Krijimi dështoi${code ? ` (${code})` : ''}: ${err?.message || 'provo përsëri.'}`);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/5 via-background to-background p-4">
      <Card className="w-full max-w-md p-8">
        <div className="flex flex-col items-center text-center mb-6">
          <div className="h-12 w-12 rounded-2xl bg-primary/10 flex items-center justify-center mb-3">
            <Building2 className="h-6 w-6 text-primary" />
          </div>
          <h1 className="text-xl font-bold">Krijo workspace-in tënd</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Provë falas 14 ditë. Pa kartë krediti.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="company">Emri i biznesit</Label>
            <Input id="company" value={companyName} onChange={e => setCompanyName(e.target.value)}
              placeholder="p.sh. GPS Rental Albania" className="mt-1" autoFocus disabled={loading} />
          </div>
          <div>
            <Label htmlFor="name">Emri yt i plotë</Label>
            <Input id="name" value={fullName} onChange={e => setFullName(e.target.value)}
              placeholder="Emër Mbiemër" className="mt-1" disabled={loading} />
          </div>
          <div>
            <Label htmlFor="email">Email pune</Label>
            <Input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)}
              placeholder="ti@biznesi.com" className="mt-1" disabled={loading} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="pass">Fjalëkalimi</Label>
              <Input id="pass" type="password" value={password} onChange={e => setPassword(e.target.value)}
                placeholder="Min. 6 karaktere" className="mt-1" disabled={loading} />
            </div>
            <div>
              <Label htmlFor="confirm">Konfirmo</Label>
              <Input id="confirm" type="password" value={confirm} onChange={e => setConfirm(e.target.value)}
                placeholder="Përsërite" className="mt-1" disabled={loading} />
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Po krijohet…</> : 'Krijo workspace-in'}
          </Button>
        </form>

        <p className="text-center text-sm text-muted-foreground mt-6">
          Ke tashmë llogari?{' '}
          <Link to="/login" className="text-primary font-medium hover:underline">Hyr</Link>
        </p>
      </Card>
    </div>
  );
};

export default WorkspaceSignupView;
