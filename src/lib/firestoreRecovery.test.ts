import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * The recovery ladder is the whole feature: a poisoned Firestore client must be
 * reloaded away, but a client that keeps dying must NOT trap the user in a reload
 * loop — it has to degrade to a working (if slower) app instead.
 */

const terminate = vi.fn(async () => {});
const clearIndexedDbPersistence = vi.fn(async () => {});
vi.mock('firebase/firestore', () => ({ terminate, clearIndexedDbPersistence }));

const reload = vi.fn();
let addEventListener: ReturnType<typeof vi.spyOn>;

const FATAL = new Error(
  "FIRESTORE (12.11.0) INTERNAL ASSERTION FAILED: Unexpected state (ID: b815) CONTEXT: {\"Pc\":\"TypeError: Cannot read properties of null (reading 'Te')\"}",
);

/**
 * Recovery is asynchronous, and vi.waitFor's 1s default is not enough on a loaded
 * machine: in the full 56-file suite this file intermittently reported "reload called
 * 0 times" simply because the chain had not resolved yet. Run alone it always passed,
 * which is exactly how a too-short poll window presents.
 */
const WAIT = { timeout: 5000 } as const;

/** Fresh module instance — the "already recovering" latch lives at module scope. */
async function loadModule() {
  vi.resetModules();
  return import('./firestoreRecovery');
}

/** Pretend the previous recovery attempt happened `agoMs` ago at stage `stage`. */
function seedStage(stage: number, agoMs = 0) {
  localStorage.setItem('fs:recoveryStage', JSON.stringify({ stage, at: Date.now() - agoMs }));
}

beforeEach(() => {
  localStorage.clear();
  terminate.mockClear();
  clearIndexedDbPersistence.mockClear();
  reload.mockClear();
  Object.defineProperty(window, 'location', { value: { reload }, writable: true });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  // Each test loads a FRESH module instance; letting every one of them attach its
  // real window listeners leaks them across tests, and one stray error event then
  // makes several instances recover at once.
  addEventListener = vi.spyOn(window, 'addEventListener').mockImplementation(() => {});
});

afterEach(async () => {
  // Drain any recovery still in flight before the next test starts. `recover()` is
  // async and ends in window.location.reload(); vi.resetModules() hands each test a
  // fresh module instance, but a DISCARDED instance's pending recovery resolves
  // later and reads window.location.reload at call time — so it landed on the next
  // test's spy and made "reload called once" fail with 2. Only under load (the full
  // suite), which is why this file passed when run on its own.
  await new Promise(resolve => setTimeout(resolve, 0));
  vi.restoreAllMocks();
});

describe('isFirestoreFatalError', () => {
  it('matches the poisoned-queue assertion', async () => {
    const { isFirestoreFatalError } = await loadModule();
    expect(isFirestoreFatalError(FATAL)).toBe(true);
    expect(isFirestoreFatalError('INTERNAL UNHANDLED ERROR: boom')).toBe(true);
  });

  it('ignores ordinary Firestore errors — those belong to the caller', async () => {
    const { isFirestoreFatalError } = await loadModule();
    expect(isFirestoreFatalError(new Error('Missing or insufficient permissions.'))).toBe(false);
    expect(isFirestoreFatalError(new Error('The client is offline'))).toBe(false);
    expect(isFirestoreFatalError(undefined)).toBe(false);
  });
});

describe('reportFirestoreError', () => {
  it('does nothing for a non-fatal error', async () => {
    const mod = await loadModule();
    mod.reportFirestoreError(new Error('Missing or insufficient permissions.'));
    await vi.waitFor(() => expect(reload).not.toHaveBeenCalled(), WAIT);
  });

  it('stage 1: reloads without touching the cache, so offline writes survive', async () => {
    const mod = await loadModule();
    mod.installFirestoreCrashGuard({} as never);
    mod.reportFirestoreError(FATAL);
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1), WAIT);
    expect(clearIndexedDbPersistence).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem('fs:recoveryStage')!).stage).toBe(1);
  });

  it('stage 2: a repeat crash clears the local cache before reloading', async () => {
    seedStage(1);
    const mod = await loadModule();
    mod.installFirestoreCrashGuard({} as never);
    mod.reportFirestoreError(FATAL);
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1), WAIT);
    expect(terminate).toHaveBeenCalledTimes(1);
    expect(clearIndexedDbPersistence).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('fs:memoryCacheUntil')).toBeNull();
  });

  it('stage 3: still crashing → run without IndexedDB for a day', async () => {
    seedStage(2);
    const mod = await loadModule();
    mod.installFirestoreCrashGuard({} as never);
    mod.reportFirestoreError(FATAL);
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1), WAIT);
    expect(mod.shouldUseMemoryCache()).toBe(true);
  });

  it('stage 4: gives up instead of looping reloads at the user', async () => {
    seedStage(3);
    const mod = await loadModule();
    mod.installFirestoreCrashGuard({} as never);
    mod.reportFirestoreError(FATAL);
    await vi.waitFor(() => expect(JSON.parse(localStorage.getItem('fs:recoveryStage')!).stage).toBe(4), WAIT);
    expect(reload).not.toHaveBeenCalled();
  });

  it('an old crash is a NEW incident, not an escalation', async () => {
    seedStage(3, 60 * 60 * 1000);
    const mod = await loadModule();
    mod.installFirestoreCrashGuard({} as never);
    mod.reportFirestoreError(FATAL);
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1), WAIT);
    expect(clearIndexedDbPersistence).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem('fs:recoveryStage')!).stage).toBe(1);
  });

  it('also watches for the crashes no hook catches', async () => {
    const mod = await loadModule();
    mod.installFirestoreCrashGuard({} as never);
    const events = addEventListener.mock.calls.map(([name]) => name);
    expect(events).toContain('error');
    expect(events).toContain('unhandledrejection');
  });

  it('recovers once, however many hooks report the same crash', async () => {
    const mod = await loadModule();
    mod.installFirestoreCrashGuard({} as never);
    mod.reportFirestoreError(FATAL);
    mod.reportFirestoreError(FATAL);
    mod.reportFirestoreError(FATAL);
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1), WAIT);
  });
});

describe('shouldUseMemoryCache', () => {
  it('is off by default and expires on its own', async () => {
    const mod = await loadModule();
    expect(mod.shouldUseMemoryCache()).toBe(false);
    localStorage.setItem('fs:memoryCacheUntil', String(Date.now() + 60_000));
    expect(mod.shouldUseMemoryCache()).toBe(true);
    localStorage.setItem('fs:memoryCacheUntil', String(Date.now() - 1));
    expect(mod.shouldUseMemoryCache()).toBe(false);
    expect(localStorage.getItem('fs:memoryCacheUntil')).toBeNull();
  });
});
