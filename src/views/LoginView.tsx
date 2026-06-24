import React, { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card } from '../components/ui/card';
import { Loader2 } from 'lucide-react';

const LoginView: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const rawRedirect = searchParams.get('redirect');
  // Validate redirect is a safe relative path (prevent open redirect)
  const redirectTo = rawRedirect && rawRedirect.startsWith('/') && !rawRedirect.includes('://') ? rawRedirect : '/';
  const { signInWithGoogle, signInWithEmail, signUpWithEmail } = useAuth();
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGoogleSignIn = async () => {
    setLoading(true);
    setError(null);
    try {
      await signInWithGoogle();
      try { sessionStorage.removeItem('role_preview'); } catch { /* ignore */ }
      navigate(redirectTo);
    } catch (err: any) {
      setError(err.message || 'Gabim gjatë hyrjes me Google');
    } finally {
      setLoading(false);
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    
    try {
      if (isSignUp) {
        await signUpWithEmail(email, password);
      } else {
        await signInWithEmail(email, password);
      }
      try { sessionStorage.removeItem('role_preview'); } catch { /* ignore */ }
      navigate(redirectTo);
    } catch (err: any) {
      // Handle Firebase auth errors
      if (err.code === 'auth/user-not-found') {
        setError('Përdoruesi nuk ekziston');
      } else if (err.code === 'auth/wrong-password') {
        setError('Fjalëkalimi i gabuar');
      } else if (err.code === 'auth/email-already-in-use') {
        setError('Email-i është tashmë i regjistruar');
      } else if (err.code === 'auth/weak-password') {
        setError('Fjalëkalimi duhet të ketë të paktën 6 karaktere');
      } else if (err.code === 'auth/invalid-email') {
        setError('Email i pavlefshëm');
      } else {
        setError(err.message || 'Gabim gjatë autentifikimit');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4 overflow-x-hidden">
      <Card className="w-full max-w-md min-w-0 p-6 sm:p-8 space-y-6">
        {/* Logo / Title */}
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold text-gradient-primary">FivoCRM</h1>
          <p className="text-muted-foreground">
            Platforma e menaxhimit të biznesit
          </p>
        </div>

        {/* Error message */}
        {error && (
          <div className="bg-error/10 border border-error text-error px-4 py-3 rounded-lg text-sm">
            {error}
          </div>
        )}

        {/* Google Sign In */}
        <Button
          variant="outline"
          className="w-full h-12 flex items-center justify-center gap-3"
          onClick={handleGoogleSignIn}
          disabled={loading}
        >
          {loading ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <>
              <svg className="h-5 w-5" viewBox="0 0 24 24">
                <path
                  fill="currentColor"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="currentColor"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="currentColor"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                />
                <path
                  fill="currentColor"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
              </svg>
              Vazhdo me Google
            </>
          )}
        </Button>

        {/* Divider */}
        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-card px-2 text-muted-foreground">Ose</span>
          </div>
        </div>

        {/* Email/Password Form */}
        <form onSubmit={handleEmailAuth} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="email@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="password">Fjalëkalimi</Label>
            <Input
              id="password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
            />
          </div>

          <Button type="submit" className="w-full h-12" disabled={loading}>
            {loading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : isSignUp ? (
              'Regjistrohu'
            ) : (
              'Hyr'
            )}
          </Button>
        </form>

        {/* Toggle Sign Up / Sign In */}
        <div className="text-center text-sm">
          <span className="text-muted-foreground">
            {isSignUp ? 'Ke tashmë llogari? ' : 'Nuk ke llogari? '}
          </span>
          <button
            type="button"
            className="text-primary hover:underline font-medium"
            onClick={() => setIsSignUp(!isSignUp)}
          >
            {isSignUp ? 'Hyr' : 'Regjistrohu'}
          </button>
        </div>

        {/* External Registration */}
        <div className="text-center text-sm border-t pt-4">
          <span className="text-muted-foreground">Jeni klient ose i interesuar? </span>
          <a
            href="/register"
            className="text-primary hover:underline font-medium"
          >
            Regjistrohu si Lead/Klient
          </a>
        </div>
      </Card>
    </div>
  );
};

export default LoginView;
