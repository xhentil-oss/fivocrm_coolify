import { initializeApp, getApps, cert, App } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { getStorage } from 'firebase-admin/storage';
import { getMessaging } from 'firebase-admin/messaging';

let app: App;

if (!getApps().length) {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  // Accept either FIREBASE_SERVICE_ACCOUNT_JSON (current) or FIREBASE_SERVICE_ACCOUNT (legacy name in docs)
  const serviceAccountJson =
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON || process.env.FIREBASE_SERVICE_ACCOUNT;

  if (projectId && clientEmail && privateKey) {
    app = initializeApp({
      credential: cert({ projectId, clientEmail, privateKey }),
    });
    // Diagnostic: log non-secret identifiers + private_key shape so mismatches are obvious.
    const emailDomain = clientEmail.split('@')[1] || '';
    const pkStartsOK = privateKey.startsWith('-----BEGIN PRIVATE KEY-----');
    const pkEndsOK = privateKey.trimEnd().endsWith('-----END PRIVATE KEY-----');
    const pkLines = privateKey.split('\n').length;
    console.log(
      `[firebaseAdmin] initialized via FIREBASE_PROJECT_ID/CLIENT_EMAIL/PRIVATE_KEY ` +
      `projectId=${projectId} clientEmailDomain=${emailDomain} ` +
      `pkLen=${privateKey.length} pkLines=${pkLines} pkStartsOK=${pkStartsOK} pkEndsOK=${pkEndsOK}`
    );
  } else if (serviceAccountJson) {
    let sa: any;
    try {
      sa = JSON.parse(serviceAccountJson);
    } catch (e: any) {
      console.error('[firebaseAdmin] Failed to parse service account JSON:', e?.message || e);
      throw new Error(
        'Invalid FIREBASE_SERVICE_ACCOUNT_JSON: not valid JSON. Make sure newlines in private_key are escaped as \\n.'
      );
    }
    app = initializeApp({ credential: cert(sa) });
    console.log('[firebaseAdmin] initialized via FIREBASE_SERVICE_ACCOUNT_JSON');
  } else {
    throw new Error(
      'Missing Firebase Admin credentials. Set either:\n' +
      '  • FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY, OR\n' +
      '  • FIREBASE_SERVICE_ACCOUNT_JSON (full service account JSON as a single string).'
    );
  }
} else {
  app = getApps()[0]!;
}

export const adminDb = getFirestore(app);
export const adminAuth = getAuth(app);
export const adminStorage = getStorage(app);
export const adminMessaging = getMessaging(app);

// Re-export a compatible admin-like object for code that uses admin.firestore.Timestamp etc.
export { Timestamp } from 'firebase-admin/firestore';

import admin from 'firebase-admin';
export default admin;
