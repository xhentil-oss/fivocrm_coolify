import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { collection, addDoc, Timestamp, query, onSnapshot, getDocs, where } from 'firebase/firestore';
import { createUserWithEmailAndPassword, updateProfile } from 'firebase/auth';
import { db, auth } from '../lib/firebase';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card } from '../components/ui/card';
import { Textarea } from '../components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Loader2, CheckCircle, UserPlus } from 'lucide-react';

interface ServiceOption {
  id: string;
  title?: string;
  name?: string;
  category?: string;
}

const RegisterView: React.FC = () => {
  const navigate = useNavigate();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [company, setCompany] = useState('');
  const [serviceInterested, setServiceInterested] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [services, setServices] = useState<ServiceOption[]>([]);

  // Fetch available services for the dropdown
  useEffect(() => {
    const q = query(collection(db, 'services'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const items = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data()
      })) as ServiceOption[];
      setServices(items);
    }, () => {
      // Services may be unavailable for unauthenticated users — silently ignore
    });
    return () => unsubscribe();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const fullName = `${firstName.trim()} ${lastName.trim()}`.trim();

    if (!fullName || !email.trim() || !password.trim()) {
      setError('Emri, email-i dhe fjalëkalimi janë të detyrueshme');
      setLoading(false);
      return;
    }

    if (password.length < 6) {
      setError('Fjalëkalimi duhet të ketë të paktën 6 karaktere');
      setLoading(false);
      return;
    }

    try {
      // 0. Block staff emails from registering as clients (case-insensitive)
      const normEmail = email.trim().toLowerCase();
      const [staffSnapExact, staffSnapLower] = await Promise.all([
        getDocs(query(collection(db, 'teamMembers'), where('email', '==', email.trim()))),
        getDocs(query(collection(db, 'teamMembers'), where('email', '==', normEmail))),
      ]);
      const isStaff = !staffSnapExact.empty || !staffSnapLower.empty ||
        [...staffSnapExact.docs, ...staffSnapLower.docs].some(d => d.data().email?.toLowerCase() === normEmail);
      if (isStaff) {
        setError('Ky email është i regjistruar si staf. Ju lutem hyni nga faqja e hyrjes.');
        setLoading(false);
        return;
      }

      // 1. Create Firebase Auth account
      const userCredential = await createUserWithEmailAndPassword(auth, email.trim(), password);
      const user = userCredential.user;

      // Set display name
      await updateProfile(user, { displayName: fullName });

      // Resolve teamId from existing team members so new documents are visible
      // to admins (team-scoped views filter by teamId).
      let teamId: string | null = null;
      try {
        const tmSnap = await getDocs(
          query(collection(db, 'teamMembers'), where('status', '==', 'Active'))
        );
        teamId = tmSnap.docs.find(d => d.data().teamId)?.data().teamId || null;
      } catch { /* non-critical */ }
      const teamIdField = teamId ? { teamId } : {};

      // 2. Create a Lead in Firestore
      await addDoc(collection(db, 'leads'), {
        ...teamIdField,
        name: fullName,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim(),
        phoneNumber: phone.trim() || null,
        company: company.trim() || null,
        serviceInterested: serviceInterested || null,
        notes: message.trim() || null,
        status: 'New',
        source: 'Regjistrim Online',
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
        createdByUserId: user.uid,
      });

      // 3. Create a Customer record
      let customerId: string | null = null;
      try {
        const customerDoc = await addDoc(collection(db, 'customers'), {
          ...teamIdField,
          name: fullName,
          email: email.trim(),
          phone: phone.trim() || null,
          company: company.trim() || null,
          status: 'Pending',
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
          createdByUserId: user.uid,
        });
        customerId = customerDoc.id;
      } catch {
        // Customer creation may fail if Firestore rules restrict it — not critical
      }

      // 4. Create portal access record
      if (customerId) {
        try {
          await addDoc(collection(db, 'clientPortalAccess'), {
            customerId,
            userId: user.uid,
            email: email.trim(),
            status: 'Active',
            createdAt: Timestamp.now(),
            updatedAt: Timestamp.now(),
            createdByUserId: user.uid,
          });
        } catch {
          // Portal access creation may fail — useClientPortal will auto-create later
        }
      }

      // 5. Create userProfile so display name is available for mentions
      try {
        await addDoc(collection(db, 'userProfiles'), {
          userId: user.uid,
          displayName: fullName,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
          createdByUserId: user.uid,
        });
      } catch {
        // Non-critical
      }

      setSuccess(true);
    } catch (err: any) {
      console.error('Registration error:', err);
      if (err?.code === 'auth/email-already-in-use') {
        setError('Ky email është tashmë i regjistruar. Provoni të hyni në llogari.');
      } else if (err?.code === 'auth/weak-password') {
        setError('Fjalëkalimi është shumë i dobët. Përdorni të paktën 6 karaktere.');
      } else if (err?.code === 'auth/invalid-email') {
        setError('Email-i nuk është i vlefshëm.');
      } else {
        setError('Ndodhi një gabim gjatë regjistrimit. Ju lutem provoni përsëri.');
      }
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md p-8 space-y-6 text-center">
          <CheckCircle className="w-16 h-16 text-green-500 mx-auto" />
          <h2 className="text-2xl font-bold text-foreground">Regjistrimi u krye me sukses!</h2>
          <p className="text-muted-foreground">
            Faleminderit për interesin tuaj. Tani mund të hyni në portalin tuaj.
          </p>
          <div className="pt-4 space-y-3">
            <Button
              className="w-full"
              onClick={() => navigate('/portal')}
            >
              Hyr në Portal
            </Button>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                setSuccess(false);
                setFirstName('');
                setLastName('');
                setEmail('');
                setPassword('');
                setPhone('');
                setCompany('');
                setServiceInterested('');
                setMessage('');
              }}
            >
              Regjistro dikë tjetër
            </Button>
            <Link to="/login" className="block">
              <Button variant="ghost" className="w-full text-primary">
                Hyr në llogari
              </Button>
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-lg p-8 space-y-6">
        {/* Logo / Title */}
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold text-gradient-primary">FivoCRM</h1>
          <p className="text-muted-foreground">
            Regjistrohu si klient ose lead
          </p>
        </div>

        {/* Error message */}
        {error && (
          <div className="bg-error/10 border border-error text-error px-4 py-3 rounded-lg text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* First Name & Last Name */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="firstName">Emri *</Label>
              <Input
                id="firstName"
                type="text"
                placeholder="Emri"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lastName">Mbiemri *</Label>
              <Input
                id="lastName"
                type="text"
                placeholder="Mbiemri"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                required
              />
            </div>
          </div>

          {/* Email */}
          <div className="space-y-2">
            <Label htmlFor="email">Email *</Label>
            <Input
              id="email"
              type="email"
              placeholder="email@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          {/* Password */}
          <div className="space-y-2">
            <Label htmlFor="password">Fjalëkalimi *</Label>
            <Input
              id="password"
              type="password"
              placeholder="Minimum 6 karaktere"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
            />
          </div>

          {/* Phone */}
          <div className="space-y-2">
            <Label htmlFor="phone">Numri i telefonit</Label>
            <Input
              id="phone"
              type="tel"
              placeholder="+355 6X XXX XXXX"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>

          {/* Company */}
          <div className="space-y-2">
            <Label htmlFor="company">Kompania</Label>
            <Input
              id="company"
              type="text"
              placeholder="Emri i kompanisë (opsionale)"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
            />
          </div>

          {/* Service Interested */}
          <div className="space-y-2">
            <Label htmlFor="service">Shërbimi që ju intereson</Label>
            <Select value={serviceInterested} onValueChange={setServiceInterested}>
              <SelectTrigger>
                <SelectValue placeholder="Zgjidhni një shërbim" />
              </SelectTrigger>
              <SelectContent>
                {services.map((service) => (
                  <SelectItem key={service.id} value={service.title || service.name || service.id}>
                    {service.title || service.name}
                    {service.category && ` — ${service.category}`}
                  </SelectItem>
                ))}
                <SelectItem value="Tjetër">Tjetër</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Message */}
          <div className="space-y-2">
            <Label htmlFor="message">Mesazh / Shënime</Label>
            <Textarea
              id="message"
              placeholder="Përshkruani nevojat tuaja ose lini një mesazh..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
            />
          </div>

          <Button type="submit" className="w-full h-12" disabled={loading}>
            {loading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <>
                <UserPlus className="w-5 h-5 mr-2" />
                Regjistrohu
              </>
            )}
          </Button>
        </form>

        {/* Link to login */}
        <div className="text-center text-sm">
          <span className="text-muted-foreground">Ke tashmë llogari? </span>
          <Link to="/login" className="text-primary hover:underline font-medium">
            Hyr
          </Link>
        </div>
      </Card>
    </div>
  );
};

export default RegisterView;
