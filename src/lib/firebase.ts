import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, runTransaction, doc, Timestamp } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { formatInvoiceNumber } from './invoiceNumber';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize services
export const auth = getAuth(app);

// Firestore with offline persistence (multi-tab safe).
//
// Transport: we FORCE long-polling instead of auto-detect. `experimentalAutoDetectLongPolling`
// probes the connection type on startup, but that probe is known to get stuck in restrictive
// networks (proxies, some mobile carriers) and — critically — inside the Capacitor Android
// WebView: the initial load succeeds but subsequent server pushes never stream, so onSnapshot
// listeners look "dead" until a full page refresh reopens the channel (real-time chat + live
// notification clearing appeared broken for exactly this reason). Forced long-polling keeps a
// held-open channel that delivers updates in real time and works reliably everywhere.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  experimentalForceLongPolling: true,
});

export const storage = getStorage(app);
export const googleProvider = new GoogleAuthProvider();

/**
 * Atomically generates the next sequential invoice number stored in Firebase.
 * Counter document: counters/invoices_{teamId} → { last: N }
 *
 * @param teamId      - The team the invoice belongs to.
 * @param fallbackMax - Seed value used ONLY when the counter document does not yet exist
 *                      (pass the highest existing FAT-XXX number so the sequence continues).
 */
export async function getNextInvoiceNumber(teamId: string, fallbackMax = 0): Promise<string> {
  const counterRef = doc(db, 'counters', `invoices_${teamId}`);
  const next = await runTransaction(db, async (transaction) => {
    const snap = await transaction.get(counterRef);
    const stored = snap.exists() ? (snap.data().last as number) : 0;
    // Always advance past BOTH the stored counter and the highest existing number.
    // If the counter ever drifted low (e.g. seeded before invoices had loaded), this
    // self-heals instead of reissuing a number that collides with an existing invoice.
    const newLast = Math.max(Number(stored) || 0, Number(fallbackMax) || 0) + 1;
    transaction.set(counterRef, { last: newLast, updatedAt: Timestamp.now() });
    return newLast;
  });
  return formatInvoiceNumber(next);
}

export default app;
