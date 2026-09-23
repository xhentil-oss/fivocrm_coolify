import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  User,
  signInWithPopup,
  signInWithCredential,
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from 'firebase/auth';
import { Capacitor } from '@capacitor/core';
import { auth, googleProvider } from '../lib/firebase';
import { clearPushToken } from '../hooks/usePushNotifications';

// Lazily loaded: `lib/sessionReset` reaches into `hooks/useFirestore`, which imports
// this context — a static import would be an ESM cycle. Failures are logged, never
// thrown: a storage error must not keep the user signed in.
async function resetTenantSession(): Promise<void> {
  try {
    const mod = await import('../lib/sessionReset');
    mod.resetTenantSession();
  } catch (err) {
    console.error('[auth] tenant session reset failed:', err);
  }
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  isAnonymous: boolean;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (email: string, password: string) => Promise<void>;
  login: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

/**
 * "The user closed the sign-in sheet" is not an error worth showing.
 *
 * On the web that is a Firebase `auth/popup-*` code, but on Android the flow goes
 * through Credential Manager (@capacitor-firebase/authentication), which reports a
 * cancellation as a plain plugin error — no `auth/` code at all. So dismissing the
 * Google sheet with a swipe showed "Gabim gjatë hyrjes me Google" in red on the
 * login screen, as if something had actually failed.
 */
const CANCEL_CODES = new Set([
  'auth/popup-closed-by-user',
  'auth/cancelled-popup-request',
  'auth/user-cancelled',
  '12501', // Google Play Services: SIGN_IN_CANCELLED
  '16', // Credential Manager: activity cancelled
]);

function isSignInCancellation(error: any): boolean {
  const code = error?.code != null ? String(error.code) : '';
  if (CANCEL_CODES.has(code)) return true;
  const message = String(error?.message ?? '').toLowerCase();
  return (
    message.includes('cancel') || // "canceled" / "cancelled" / "sign in canceled"
    message.includes('user closed') ||
    message.includes('no credential') // sheet dismissed with nothing chosen
  );
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      // No user (sign-out, expired/revoked session, a second tab logging out):
      // forget the previous tenant — in-memory scope, cached rows, storage keys.
      // Lazy import: `useFirestore` imports this context, a static import here
      // would be a cycle.
      if (!user) void resetTenantSession();
      setUser(user);
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  const signInWithGoogle = async () => {
    try {
      if (Capacitor.isNativePlatform()) {
        // Native: the Credential Manager UI returns a Google ID token, which we
        // exchange for a Firebase JS SDK session (popups don't work in a WebView).
        const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication');
        const result = await FirebaseAuthentication.signInWithGoogle();
        const idToken = result.credential?.idToken;
        if (!idToken) throw new Error('No Google ID token returned');
        const credential = GoogleAuthProvider.credential(idToken);
        await signInWithCredential(auth, credential);
      } else {
        await signInWithPopup(auth, googleProvider);
      }
    } catch (error: any) {
      if (!isSignInCancellation(error)) {
        console.error('Google sign-in error:', error);
        throw error;
      }
    }
  };

  const signInWithEmail = async (email: string, password: string) => {
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (error) {
      console.error('Error signing in with email:', error);
      throw error;
    }
  };

  const signUpWithEmail = async (email: string, password: string) => {
    try {
      await createUserWithEmailAndPassword(auth, email, password);
    } catch (error) {
      console.error('Error signing up:', error);
      throw error;
    }
  };

  const logout = async () => {
    try {
      // Unregister THIS device's push token BEFORE signing out — while we still have
      // both the uid and write permission. A token left behind kept delivering the
      // previous user's notifications to the device after someone else logged in.
      await clearPushToken(auth.currentUser?.uid);
      await signOut(auth);
      // Forget the tenant: global businessId/teamId, the collection cache, the
      // super-admin tenant pin, role preview and every tenant-derived storage key
      // (bank accounts, company profile, rates, stripe/cron settings, VPS host).
      await resetTenantSession();
    } catch (error) {
      console.error('Error signing out:', error);
      throw error;
    }
  };

  const value = {
    user,
    loading,
    isAnonymous: user?.isAnonymous ?? false,
    signInWithGoogle,
    signInWithEmail,
    signUpWithEmail,
    login: signInWithGoogle,
    logout
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
