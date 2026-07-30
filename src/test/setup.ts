import '@testing-library/jest-dom';

/**
 * Placeholder Firebase config for the test run.
 *
 * `src/lib/firebase.ts` builds its config from `import.meta.env` and calls
 * `getAuth(app)` at MODULE SCOPE. So any unit test that transitively imports it —
 * e.g. `src/lib/billing.test.ts`, which only wants the pure pricing helpers but
 * pulls in `billing.ts` → `firebase.ts` → `auth` — crashes with
 * `auth/invalid-api-key` the moment the env vars are absent.
 *
 * Locally that never surfaces, because Vite loads `.env`. In CI there are no
 * secrets, so the suite failed there and only there. Stubbing the values here (as
 * opposed to mocking `./firebase` inside one test file) fixes the whole class of
 * problem in one place and keeps CI free of credentials.
 *
 * These are syntactically valid but entirely fake: nothing reaches the network
 * during a unit test — the SDK only validates the shape at init.
 */
const FIREBASE_TEST_ENV: Record<string, string> = {
  VITE_FIREBASE_API_KEY: 'AIzaSyTestOnlyNotARealKey0000000000000000',
  VITE_FIREBASE_AUTH_DOMAIN: 'test.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'fivocrm-test',
  VITE_FIREBASE_STORAGE_BUCKET: 'fivocrm-test.appspot.com',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '000000000000',
  VITE_FIREBASE_APP_ID: '1:000000000000:web:0000000000000000000000',
};

// Only fill what is MISSING, so a developer running the suite against their own
// `.env` keeps their real values.
for (const [key, value] of Object.entries(FIREBASE_TEST_ENV)) {
  if (!import.meta.env[key]) {
    (import.meta.env as Record<string, unknown>)[key] = value;
  }
}
