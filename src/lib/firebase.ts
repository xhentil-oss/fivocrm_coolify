import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, runTransaction, doc, Timestamp } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

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

// Firestore with offline persistence (multi-tab safe)
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  experimentalAutoDetectLongPolling: true,
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
    const newLast = snap.exists() ? (snap.data().last as number) + 1 : fallbackMax + 1;
    transaction.set(counterRef, { last: newLast, updatedAt: Timestamp.now() });
    return newLast;
  });
  return `FAT-${String(next).padStart(3, '0')}`;
}

export default app;
