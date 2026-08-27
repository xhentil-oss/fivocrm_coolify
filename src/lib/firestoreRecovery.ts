import { terminate, clearIndexedDbPersistence, type Firestore } from 'firebase/firestore';

/**
 * Recovery from a POISONED Firestore client.
 *
 * The Firestore JS SDK runs every operation on one internal AsyncQueue. The first
 * time an operation throws, the queue records the error and `verifyNotFailed()`
 * re-throws it — as `INTERNAL ASSERTION FAILED: Unexpected state (ID: b815)`, with
 * the ORIGINAL error under `CONTEXT: {"Pc": …}` — for every call made afterwards.
 * There is no way back: the client stays dead until the page reloads.
 *
 * The failure we hit in production (`TypeError: Cannot read properties of null
 * (reading 'Te')` inside `getTargetData`) is an SDK bug in the MULTI-TAB code path
 * and still exists in the latest release: when a tab becomes primary,
 * `synchronizeQueryViewsAndRaiseSnapshots()` looks up every targetId the shared
 * (localStorage) client state still advertises as active, and passes the result
 * straight into `localStoreAllocateTarget()` — including the `null` returned for a
 * targetId whose row is no longer in the IndexedDB target cache (a tab that was
 * killed without cleanup, an evicted/cleared cache). `canonifyTarget(null)` then
 * throws and takes the whole client with it.
 *
 * What makes this bad for us specifically: `useCollection` swallows a synchronous
 * `onSnapshot` throw (see its `.catch`), so a poisoned client does not show an
 * error — every screen just renders empty, as if the tenant had no data.
 *
 * So we detect it and reload, escalating if it comes straight back:
 *   1. plain reload            — cheapest, and it keeps unsent offline writes
 *                                (the mutation queue survives in IndexedDB; a
 *                                dead client would never flush them anyway).
 *   2. clear the local cache   — drops the stale target rows that cause it.
 *   3. run without IndexedDB   — memory cache for 24h; the app works, it just
 *                                re-reads from the server.
 *   4. give up and report      — never loop reloads at a user.
 */

const RECOVERY_KEY = 'fs:recoveryStage';
const MEMORY_UNTIL_KEY = 'fs:memoryCacheUntil';
/** A crash later than this is a NEW incident, not the previous one repeating. */
const INCIDENT_WINDOW_MS = 10 * 60 * 1000;
const MEMORY_FALLBACK_MS = 24 * 60 * 60 * 1000;

type RecoveryState = { stage: number; at: number };

function readState(): RecoveryState | null {
  try {
    const raw = localStorage.getItem(RECOVERY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RecoveryState;
    return typeof parsed?.stage === 'number' && typeof parsed?.at === 'number' ? parsed : null;
  } catch { return null; }
}

function writeState(stage: number): void {
  try { localStorage.setItem(RECOVERY_KEY, JSON.stringify({ stage, at: Date.now() })); } catch { /* private mode */ }
}

/**
 * True while we are inside the post-crash cooldown and must not touch IndexedDB.
 * Read by `firebase.ts` BEFORE `initializeFirestore` — this is the only place the
 * cache mode is decided.
 */
export function shouldUseMemoryCache(): boolean {
  try {
    const until = Number(localStorage.getItem(MEMORY_UNTIL_KEY) || 0);
    if (!until) return false;
    if (Date.now() >= until) { localStorage.removeItem(MEMORY_UNTIL_KEY); return false; }
    return true;
  } catch { return false; }
}

/** Matches both the poisoned-queue error and the original assertion that caused it. */
export function isFirestoreFatalError(err: unknown): boolean {
  const msg = err instanceof Error ? `${err.message}` : typeof err === 'string' ? err : '';
  return msg.includes('INTERNAL ASSERTION FAILED') || msg.includes('INTERNAL UNHANDLED ERROR');
}

let db: Firestore | null = null;
let recovering = false;

/**
 * Handle a Firestore error from anywhere in the app. Non-fatal errors (permission
 * denied, unavailable, …) are ignored — those are the caller's business.
 */
export function reportFirestoreError(err: unknown): void {
  if (!isFirestoreFatalError(err) || recovering) return;
  recovering = true;
  void recover(err);
}

async function recover(err: unknown): Promise<void> {
  const previous = readState();
  const repeat = previous && Date.now() - previous.at < INCIDENT_WINDOW_MS;
  const stage = repeat ? previous!.stage + 1 : 1;

  console.error(`[firestore] client poisoned — recovery stage ${stage}`, err);
  try {
    const { Sentry } = await import('./sentry');
    Sentry.captureException(err instanceof Error ? err : new Error(String(err)), {
      tags: { firestore_recovery: `stage-${stage}` },
    });
  } catch { /* telemetry must never break recovery */ }

  writeState(stage);

  if (stage >= 4) {
    // Already tried everything within one incident window. Reloading again would
    // just trap the user in a loop — leave the page up and let Sentry carry it.
    return;
  }

  if (stage >= 3) {
    try { localStorage.setItem(MEMORY_UNTIL_KEY, String(Date.now() + MEMORY_FALLBACK_MS)); } catch { /* private mode */ }
  }

  if (stage >= 2 && db) {
    // terminate() first — clearIndexedDbPersistence() refuses to run on a live
    // client, and both can legitimately fail (another tab still holds the cache),
    // in which case the reload alone is the recovery.
    try { await terminate(db); } catch { /* already dead */ }
    try { await clearIndexedDbPersistence(db); } catch { /* another tab owns it */ }
  }

  window.location.reload();
}

/**
 * Install the last-resort net: the SDK re-throws queue failures asynchronously, so
 * anything our own `catch` blocks miss lands here as an uncaught error.
 */
export function installFirestoreCrashGuard(instance: Firestore): void {
  db = instance;
  if (typeof window === 'undefined') return;
  window.addEventListener('error', (e) => reportFirestoreError(e.error ?? e.message));
  window.addEventListener('unhandledrejection', (e) => reportFirestoreError(e.reason));
}
