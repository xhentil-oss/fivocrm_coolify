import React, { useEffect, useRef, useState } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { updatePassword, reauthenticateWithCredential, EmailAuthProvider, sendPasswordResetEmail } from 'firebase/auth';
import { db, auth } from '../../lib/firebase';
import { dndZoneStamp } from '../../lib/notificationPrefs';
import { useClientPortal } from '../../hooks/useClientPortal';
import { useAuth } from '../../contexts/AuthContext';
import { useDocument, useMutation } from '../../hooks/useFirestore';
import { useFileUpload } from '../../hooks/useFileUpload';
import { useToast } from '../../hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Switch } from '../../components/ui/switch';
import { User, Bell, Lock, Camera, Loader2, Save } from 'lucide-react';
import type { Customer } from '../../types';

type Prefs = {
  pushEnabled: boolean;
  emailEnabled: boolean;
  categoryEnabled: { messages: boolean; invoices: boolean };
  dndEnabled: boolean;
  dndStart: string;
  dndEnd: string;
};

const DEFAULT_PREFS: Prefs = {
  pushEnabled: true,
  emailEnabled: true,
  categoryEnabled: { messages: true, invoices: true },
  dndEnabled: false,
  dndStart: '22:00',
  dndEnd: '08:00',
};

const PortalProfileView: React.FC = () => {
  const { customerId } = useClientPortal();
  const { user } = useAuth();
  const { toast } = useToast();
  const { data: customer, loading } = useDocument<Customer>('customers', customerId || undefined);
  const customerMutation = useMutation<Customer>('customers');
  const { upload, uploading } = useFileUpload();
  const fileRef = useRef<HTMLInputElement | null>(null);

  // ── Profile form ──
  const [form, setForm] = useState({ name: '', phone: '', company: '', website: '', taxId: '', address: '', avatarUrl: '' });
  const [savingProfile, setSavingProfile] = useState(false);
  useEffect(() => {
    if (!customer) return;
    setForm({
      name: customer.name || '',
      phone: customer.phone || '',
      company: customer.company || '',
      website: (customer as any).website || '',
      taxId: (customer as any).taxId || '',
      address: customer.address || '',
      avatarUrl: (customer as any).avatarUrl || '',
    });
  }, [customer]);

  const saveProfile = async () => {
    if (!customerId) return;
    setSavingProfile(true);
    try {
      await customerMutation.update(customerId, {
        name: form.name.trim(),
        phone: form.phone.trim(),
        company: form.company.trim(),
        website: form.website.trim(),
        taxId: form.taxId.trim(),
        address: form.address.trim(),
      } as any);
      toast({ title: 'Profili u ruajt' });
    } catch {
      toast({ title: 'Gabim', description: 'Nuk u ruajt dot profili.', variant: 'destructive' });
    } finally {
      setSavingProfile(false);
    }
  };

  const handleAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !customerId) return;
    if (!file.type.startsWith('image/')) { toast({ title: 'Vetëm imazhe lejohen', variant: 'destructive' }); return; }
    try {
      const res = await upload(file, 'avatars');
      await customerMutation.update(customerId, { avatarUrl: res.url } as any);
      setForm(f => ({ ...f, avatarUrl: res.url }));
      toast({ title: 'Fotoja u përditësua' });
    } catch {
      toast({ title: 'Gabim', description: 'Ngarkimi dështoi.', variant: 'destructive' });
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  // ── Notification preferences ──
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  useEffect(() => {
    if (!user) return;
    getDoc(doc(db, 'userPreferences', user.uid)).then(snap => {
      if (!snap.exists()) return;
      const p = snap.data() as any;
      setPrefs(prev => ({
        pushEnabled: p.pushEnabled ?? prev.pushEnabled,
        emailEnabled: p.emailEnabled ?? prev.emailEnabled,
        categoryEnabled: {
          messages: p.categoryEnabled?.messages ?? prev.categoryEnabled.messages,
          invoices: p.categoryEnabled?.invoices ?? prev.categoryEnabled.invoices,
        },
        dndEnabled: p.dndEnabled ?? prev.dndEnabled,
        dndStart: p.dndStart ?? prev.dndStart,
        dndEnd: p.dndEnd ?? prev.dndEnd,
      }));
    }).catch(() => { /* defaults */ });
  }, [user]);

  const savePrefs = (next: Prefs) => {
    setPrefs(next);
    if (!user) return;
    // Stamp the client's timezone alongside the DND window: portal users never
    // mount the staff bell (which used to be the only place that stamped it), so
    // their DND hours were read as UTC and the window shifted by the full offset.
    setDoc(doc(db, 'userPreferences', user.uid), { ...next, ...dndZoneStamp() }, { merge: true }).catch(() => {
      toast({ title: 'Gabim', description: 'Preferencat nuk u ruajtën.', variant: 'destructive' });
    });
  };

  // ── Password ──
  const providerId = auth.currentUser?.providerData?.[0]?.providerId;
  const isPasswordUser = providerId === 'password';
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [savingPw, setSavingPw] = useState(false);

  const changePassword = async () => {
    const cur = auth.currentUser;
    if (!cur || !cur.email) return;
    if (pw.next.length < 6) { toast({ title: 'Fjalëkalimi duhet të ketë të paktën 6 karaktere', variant: 'destructive' }); return; }
    if (pw.next !== pw.confirm) { toast({ title: 'Fjalëkalimet nuk përputhen', variant: 'destructive' }); return; }
    setSavingPw(true);
    try {
      await reauthenticateWithCredential(cur, EmailAuthProvider.credential(cur.email, pw.current));
      await updatePassword(cur, pw.next);
      setPw({ current: '', next: '', confirm: '' });
      toast({ title: 'Fjalëkalimi u ndryshua' });
    } catch (err: any) {
      const msg = err?.code === 'auth/wrong-password' ? 'Fjalëkalimi aktual është i gabuar.' : 'Nuk u ndryshua dot fjalëkalimi.';
      toast({ title: 'Gabim', description: msg, variant: 'destructive' });
    } finally {
      setSavingPw(false);
    }
  };

  const resetPassword = async () => {
    if (!user?.email) return;
    try {
      await sendPasswordResetEmail(auth, user.email);
      toast({ title: 'Email-i u dërgua', description: 'Kontrolloni email-in për të rivendosur fjalëkalimin.' });
    } catch {
      toast({ title: 'Gabim', variant: 'destructive' });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const initials = (form.name || user?.email || 'K').slice(0, 2).toUpperCase();

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Profili im</h1>
        <p className="text-muted-foreground mt-1">Menaxhoni të dhënat, njoftimet dhe sigurinë e llogarisë</p>
      </div>

      {/* Profile info */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2"><User className="h-5 w-5 text-primary" /> Të dhënat e kompanisë</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Avatar */}
          <div className="flex items-center gap-4">
            <div className="relative">
              {form.avatarUrl ? (
                <img src={form.avatarUrl} alt="Avatar" className="h-16 w-16 rounded-full object-cover border" />
              ) : (
                <div className="h-16 w-16 rounded-full bg-brand-gradient flex items-center justify-center text-white font-bold text-lg">{initials}</div>
              )}
              <button
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="absolute -bottom-1 -right-1 h-7 w-7 rounded-full bg-primary text-white flex items-center justify-center shadow-md hover:opacity-90 disabled:opacity-60"
                aria-label="Ndrysho foton"
              >
                {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
              </button>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleAvatar} />
            </div>
            <div>
              <p className="font-medium">{form.name || 'Klient'}</p>
              <p className="text-sm text-muted-foreground">{user?.email}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Emri</Label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Emri juaj" />
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input value={user?.email || ''} disabled className="opacity-70" />
            </div>
            <div className="space-y-1.5">
              <Label>Telefoni</Label>
              <Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="+355 ..." />
            </div>
            <div className="space-y-1.5">
              <Label>Kompania</Label>
              <Input value={form.company} onChange={e => setForm(f => ({ ...f, company: e.target.value }))} placeholder="Emri i biznesit" />
            </div>
            <div className="space-y-1.5">
              <Label>Website</Label>
              <Input value={form.website} onChange={e => setForm(f => ({ ...f, website: e.target.value }))} placeholder="https://..." />
            </div>
            <div className="space-y-1.5">
              <Label>NIPT / Tax ID</Label>
              <Input value={form.taxId} onChange={e => setForm(f => ({ ...f, taxId: e.target.value }))} placeholder="L..." />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Adresa</Label>
              <Input value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} placeholder="Rruga, qyteti" />
            </div>
          </div>

          <div className="flex justify-end">
            <Button onClick={saveProfile} disabled={savingProfile} className="gap-2">
              {savingProfile ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Ruaj ndryshimet
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Notification preferences */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2"><Bell className="h-5 w-5 text-primary" /> Njoftimet</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <PrefRow label="Njoftime push" desc="Merrni njoftime në pajisje/browser"
            checked={prefs.pushEnabled} onChange={v => savePrefs({ ...prefs, pushEnabled: v })} />
          <PrefRow label="Njoftime me email" desc="Merrni njoftime edhe me email"
            checked={prefs.emailEnabled} onChange={v => savePrefs({ ...prefs, emailEnabled: v })} />
          <div className="h-px bg-border" />
          <PrefRow label="Mesazhe nga ekipi" desc="Përgjigje dhe mesazhe të reja"
            checked={prefs.categoryEnabled.messages}
            onChange={v => savePrefs({ ...prefs, categoryEnabled: { ...prefs.categoryEnabled, messages: v } })} />
          <PrefRow label="Fatura, preventiva & kontrata" desc="Dokumente të reja dhe kujtesa pagesash"
            checked={prefs.categoryEnabled.invoices}
            onChange={v => savePrefs({ ...prefs, categoryEnabled: { ...prefs.categoryEnabled, invoices: v } })} />
          <div className="h-px bg-border" />
          <PrefRow label="Mos shqetëso (orar)" desc="Hesht njoftimet gjatë një intervali"
            checked={prefs.dndEnabled} onChange={v => savePrefs({ ...prefs, dndEnabled: v })} />
          {prefs.dndEnabled && (
            <div className="flex items-center gap-3 pl-1">
              <div className="space-y-1">
                <Label className="text-xs">Nga</Label>
                <Input type="time" value={prefs.dndStart} onChange={e => savePrefs({ ...prefs, dndStart: e.target.value })} className="w-32" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Deri</Label>
                <Input type="time" value={prefs.dndEnd} onChange={e => savePrefs({ ...prefs, dndEnd: e.target.value })} className="w-32" />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Security */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2"><Lock className="h-5 w-5 text-primary" /> Siguria</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {isPasswordUser ? (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <Label>Fjalëkalimi aktual</Label>
                  <Input type="password" value={pw.current} onChange={e => setPw(p => ({ ...p, current: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label>Fjalëkalimi i ri</Label>
                  <Input type="password" value={pw.next} onChange={e => setPw(p => ({ ...p, next: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label>Konfirmo</Label>
                  <Input type="password" value={pw.confirm} onChange={e => setPw(p => ({ ...p, confirm: e.target.value }))} />
                </div>
              </div>
              <div className="flex justify-end">
                <Button onClick={changePassword} disabled={savingPw || !pw.current || !pw.next} variant="outline" className="gap-2">
                  {savingPw ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
                  Ndrysho fjalëkalimin
                </Button>
              </div>
            </>
          ) : (
            <div className="flex items-center justify-between gap-4">
              <p className="text-sm text-muted-foreground">
                Jeni identifikuar me llogari të jashtme (p.sh. Google). Për të vendosur një fjalëkalim, dërgoni një email rivendosjeje.
              </p>
              <Button onClick={resetPassword} variant="outline" className="flex-shrink-0">Dërgo email</Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

const PrefRow: React.FC<{ label: string; desc: string; checked: boolean; onChange: (v: boolean) => void }> = ({ label, desc, checked, onChange }) => (
  <div className="flex items-center justify-between gap-4">
    <div className="min-w-0">
      <p className="text-sm font-medium">{label}</p>
      <p className="text-xs text-muted-foreground">{desc}</p>
    </div>
    <Switch checked={checked} onCheckedChange={onChange} />
  </div>
);

export default PortalProfileView;
