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
/**
 * Allocate the next invoice number for a TENANT.
 *
 * `scopeId` MUST be the businessId, not a teamId: teams are departments inside
 * one business, so a per-team counter made every department restart at FAT-001
 * and issue colliding numbers (three different invoices all numbered FAT-006).
 * An invoice number has to be unique for the legal entity that issues it.
 * `fallbackMax` (highest number already in use across the business) self-heals a
 * counter that drifted low.
 */
export async function getNextInvoiceNumber(scopeId: string, fallbackMax = 0): Promise<string> {
  const counterRef = doc(db, 'counters', `invoices_${scopeId}`);
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

export interface InvoiceInstalment {
  amount: number;
  method?: string;
  note?: string;
  paidAt: Date;
}

export interface InvoiceInstalmentResult {
  /** Index this instalment took in `partialPayments` — the ledger `sourceKey` suffix. */
  index: number;
  paidAmount: number;
  remaining: number;
  isFullyPaid: boolean;
  status: string;
}

/**
 * Record a cash instalment against an invoice — the ONLY way to do it.
 *
 * This has to be a transaction. The view used to read the invoice from a React
 * snapshot and write `partialPayments: [...existingPayments, newPayment]` with
 * `paidAmount: alreadyPaid + amount`, deriving the ledger key from
 * `existingPayments.length`. Two people (or two tabs) recording a payment within
 * the same snapshot window therefore: lost one instalment entirely, under-counted
 * `paidAmount`, and wrote both ledger rows under the SAME `sourceKey` — silent
 * money loss with no error anywhere.
 *
 * Amounts are compared in the invoice's NATIVE currency; `toAll()` is for display
 * and aggregation only, never for payment logic. Over-payment is refused inside the
 * transaction, so a stale "Mbetet" figure on screen cannot push an invoice past its
 * total.
 */
export async function recordInvoicePartialPayment(
  invoiceId: string,
  instalment: InvoiceInstalment,
): Promise<InvoiceInstalmentResult> {
  const invoiceRef = doc(db, 'invoices', invoiceId);
  return runTransaction(db, async (transaction) => {
    const snap = await transaction.get(invoiceRef);
    if (!snap.exists()) throw new Error('Fatura nuk u gjet.');
    const inv = snap.data() as Record<string, any>;

    const total = Number(inv.total ?? inv.amount ?? 0) || 0;
    const existing: any[] = Array.isArray(inv.partialPayments) ? inv.partialPayments : [];
    // Trust the recorded instalments over the denormalised `paidAmount` when they
    // disagree (an older write path could leave the two out of step).
    const recorded = existing.reduce((s, p) => s + (Number(p?.amount) || 0), 0);
    const alreadyPaid = Math.max(Number(inv.paidAmount) || 0, recorded);
    const remainingBefore = total - alreadyPaid;

    if (!(instalment.amount > 0)) throw new Error('Shuma duhet të jetë pozitive.');
    if (instalment.amount > remainingBefore + 0.005) {
      const err = new Error(`Mbetet për t'u paguar vetëm ${remainingBefore.toLocaleString()}.`);
      (err as any).code = 'amount-exceeds-remaining';
      (err as any).remaining = remainingBefore;
      throw err;
    }

    const paidAmount = alreadyPaid + instalment.amount;
    // Tolerance, not `>=`: float arithmetic on Lek amounts can land a hair short.
    const isFullyPaid = paidAmount >= total - 0.005;
    const status = isFullyPaid ? 'Paid' : 'Partial';

    const patch: Record<string, any> = {
      partialPayments: [...existing, {
        amount: instalment.amount,
        paidAt: Timestamp.fromDate(instalment.paidAt),
        ...(instalment.method ? { method: instalment.method } : {}),
        ...(instalment.note ? { note: instalment.note } : {}),
      }],
      paidAmount,
      status,
      updatedAt: Timestamp.now(),
    };
    // `paidAt` is the settlement date, set once. The instalment history keeps the
    // per-payment dates, so cash-basis reporting stays month-accurate.
    if (isFullyPaid) patch.paidAt = Timestamp.fromDate(instalment.paidAt);
    transaction.update(invoiceRef, patch);

    return {
      index: existing.length,
      paidAmount,
      remaining: Math.max(0, total - paidAmount),
      isFullyPaid,
      status,
    };
  });
}

export default app;
