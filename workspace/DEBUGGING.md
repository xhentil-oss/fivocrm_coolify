# Debugging Records & Issue Tracking

*This file is the single source of truth for debugging sessions, issues, and troubleshooting history in this project.*

## Purpose

Records debugging sessions, error patterns, root causes, solutions, and recurring issues. This file enables systematic problem-solving, prevents re-solving the same bugs, and provides context for future debugging efforts. It supports Roo Code's Debug Mode by maintaining a persistent record of diagnostic work.

## When to Update This File

Update this file when:
- Encountering a new error, bug, or unexpected behavior
- Identifying a root cause during investigation
- Applying a fix or workaround (successful or not)
- Noticing a recurring issue pattern
- During systematic debugging sessions (e.g., in Debug Mode)
- Discovering performance issues, edge cases, or race conditions
- After verifying a fix works across relevant scenarios

**Do not** log transient one-liners or obvious typos. Focus on issues requiring investigation or likely to recur.

## Format

Each entry follows this structure:

```
### [YYYY-MM-DD HH:MM] — [Short Issue Title]

**Status:** Open | Investigating | Fixed | Recurring | Won't Fix
**Symptoms:** What went wrong. Error messages, stack traces, reproduction steps.
**Environment:** dependencies, affected files.
**Root Cause:** (if found) What caused it.
**Investigation Steps:**
- Step 1: What was tried, results.
- Step 2: etc.
**Solution:** What fixed it (code changes, config, workaround).
**Prevention:** How to avoid this in future (patterns, tests, docs).
**Related:** Links to DECISIONS.md entries, commits, or tickets.
```

Mark as **Recurring** if the issue returns.

If this file gets corrupted, re-create it. 
CRITICAL: Keep this file under 300 lines. You are allowed to summarize, change the format, delete entries, etc., in order to keep it under the limit.

---

## Current Issues

<!-- Newest debugging entries first. Closed issues move to "Resolved Issues" below. -->

## Resolved Issues

<!-- Historical debugging records -->

### [2026-08-26] — Firestore "INTERNAL ASSERTION FAILED (ID: b815)" kills the client

**Status:** Fixed (mitigated — the SDK bug itself is upstream and still open in 12.18.0)
**Symptoms:** In production (fivocrm.com):
`FIRESTORE (12.11.0) INTERNAL ASSERTION FAILED: Unexpected state (ID: b815)
CONTEXT: {"Pc":"TypeError: Cannot read properties of null (reading 'Te')" … getTargetData …}`
After it, every screen renders empty — no error toast, no red state — until the user reloads.
**Environment:** firebase 12.11.0 (@firebase/firestore 4.13.0), browser (multi-tab), `src/lib/firebase.ts`.
**Root Cause:** Two layers.
1. `0xb815 = 47125` is `AsyncQueue.verifyNotFailed()`. The Firestore SDK runs everything on ONE
   queue; the first operation that throws is recorded and re-thrown for every call afterwards.
   So b815 is the symptom — the real failure is the `CONTEXT.Pc` TypeError.
2. That TypeError is an SDK bug on the MULTI-TAB path: when a tab becomes primary,
   `synchronizeQueryViewsAndRaiseSnapshots()` passes `localStoreGetCachedTarget()`'s result
   straight into `localStoreAllocateTarget()`, `null` included — and `null` is exactly what a
   targetId that the shared (localStorage) client state still advertises returns once its row is
   gone from the IndexedDB target cache (tab killed without cleanup, cache evicted/cleared).
   `canonifyTarget(null)` then reads `.Te` off null. Same code in 4.17.1 — upgrading does not fix it.
   Our own `useCollection` made it invisible: it swallows a synchronous `onSnapshot` throw.
**Solution:** `src/lib/firestoreRecovery.ts` — detect the poisoned client (from the hooks' catch
blocks and from `window` error/unhandledrejection) and escalate: reload → clear the local cache
and reload → run on `memoryLocalCache()` for 24h → stop and report to Sentry (never a reload loop).
`firebase.ts` reads that last flag before `initializeFirestore`.
**Prevention:** Never swallow a Firestore error without passing it to `reportFirestoreError()`.
If Sentry shows `firestore_recovery` stages 2+ recurring, drop `persistentMultipleTabManager()`
for `persistentSingleTabManager()` — that removes the buggy code path entirely, at the cost of
extra reads in secondary tabs (they fall back to a memory cache automatically).
**Related:** `src/lib/firestoreRecovery.test.ts`, upstream firebase-js-sdk multi-tab target sync.
