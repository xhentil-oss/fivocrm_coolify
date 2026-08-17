import { useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { doc, setDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';

/**
 * Push registration for native (Capacitor) and web (Firebase Messaging).
 *
 * Tokens are stored PER DEVICE at `userPushTokens/{uid}/tokens/{deviceKey}`.
 * They used to live in a single field on `userPushTokens/{uid}`, which meant a user
 * had exactly one push destination: registering on the desktop overwrote the phone's
 * token and vice versa, so only the most recently opened device ever rang. Worse, the
 * token survived logout — so if someone else signed in on that device, the previous
 * user's notifications kept arriving there. `clearPushToken()` (called from logout)
 * now removes this device's entry.
 */

// Deterministic per-token document id. The raw FCM token cannot be a document id
// (length + reserved patterns), so we combine a hash of the whole token with its
// sanitised tail — stable across reloads, so re-registering updates the same row
// instead of accumulating a new one every session.
function deviceKeyFor(token: string): string {
  let h = 0x811c9dc5; // FNV-1a
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${h.toString(36)}_${token.slice(-32).replace(/[^A-Za-z0-9_-]/g, '')}`;
}

// Remembered so logout can delete exactly the entry this device created.
const LAST_TOKEN_KEY = 'fivocrm_push_device_key';

async function saveToken(userId: string, token: string, platform: string) {
  const key = deviceKeyFor(token);
  try { localStorage.setItem(LAST_TOKEN_KEY, key); } catch { /* private mode */ }
  await setDoc(
    doc(db, 'userPushTokens', userId, 'tokens', key),
    { token, platform, updatedAt: serverTimestamp() },
    { merge: true },
  );
}

/**
 * Remove THIS device's push token. Call before signing out, otherwise the device
 * keeps receiving the previous user's notifications after someone else logs in.
 */
export async function clearPushToken(userId?: string | null): Promise<void> {
  if (!userId) return;
  let key: string | null = null;
  try { key = localStorage.getItem(LAST_TOKEN_KEY); } catch { /* noop */ }
  if (!key) return;
  try {
    await deleteDoc(doc(db, 'userPushTokens', userId, 'tokens', key));
  } catch { /* best-effort — a stale token is dropped server-side on first failure */ }
  try { localStorage.removeItem(LAST_TOKEN_KEY); } catch { /* noop */ }
}

export function usePushNotifications(userId?: string) {
  const userIdRef = useRef(userId);
  userIdRef.current = userId;

  // ── Native (Android / iOS via Capacitor) ──────────────────────────────────
  useEffect(() => {
    if (!Capacitor.isNativePlatform() || !userId) return;

    let mounted = true;

    const register = async () => {
      // Listeners BEFORE register() — Capacitor documents this order. The
      // `registration` event can fire as soon as register() resolves; a listener
      // attached afterwards races it, and a lost registration event means the
      // token is never persisted and this device stays permanently silent.
      PushNotifications.addListener('registration', async (tokenData) => {
        if (!mounted || !userIdRef.current) return;
        try {
          await saveToken(userIdRef.current, tokenData.value, Capacitor.getPlatform());
        } catch (err) {
          console.error('[Push] token save failed:', err);
        }
      });

      PushNotifications.addListener('registrationError', (err) => {
        console.error('[Push] registration failed:', err);
      });

      // Deep-link: navigate to the URL embedded in the notification data
      PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
        const url: string | undefined = (action.notification.data as any)?.url;
        if (url) {
          // HashRouter is used on Capacitor — update hash directly
          window.location.hash = url.startsWith('#') ? url : `#${url}`;
        }
      });

      const perm = await PushNotifications.requestPermissions();
      if (perm.receive !== 'granted') return;
      await PushNotifications.register();
    };

    register();
    return () => {
      mounted = false;
      PushNotifications.removeAllListeners();
    };
  }, [userId]);

  // ── Web (Firebase Messaging) ───────────────────────────────────────────────
  useEffect(() => {
    if (Capacitor.isNativePlatform() || !userId) return;

    let mounted = true;

    const registerWeb = async () => {
      if (!('Notification' in window) || !('serviceWorker' in navigator)) return;

      // Never re-prompt a denial (browsers punish repeat prompts from the origin).
      if (Notification.permission === 'denied') return;
      // On the client portal, the prompt belongs to the explicit "Aktivizo" banner
      // (PortalPushPrompt) — it must come from a real user gesture (Safari/iOS
      // reject a cold prompt outright), and the banner only renders while
      // permission is still 'default', so prompting here made it unreachable.
      const isPortal = `${window.location.pathname}${window.location.hash}`.includes('/portal');
      if (Notification.permission !== 'granted' && isPortal) return;

      const permission = Notification.permission === 'granted'
        ? 'granted'
        : await Notification.requestPermission();
      if (permission !== 'granted') return;

      try {
        const { getMessaging, getToken, isSupported } = await import('firebase/messaging');
        const supported = await isSupported();
        if (!supported || !mounted) return;

        const { default: app } = await import('../lib/firebase');
        const messaging = getMessaging(app);
        const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined;
        if (!vapidKey) {
          // Without a VAPID key no web FCM token can be minted, so NO web push is
          // ever delivered (staff AND portal clients). This fails silently, so log
          // it loudly — set VITE_FIREBASE_VAPID_KEY in the Vercel env to enable it.
          console.warn('[Push] VITE_FIREBASE_VAPID_KEY is not set — web push notifications are disabled.');
          return;
        }

        // The service worker is generated at build time WITH the Firebase config
        // baked in (scripts/generate-sw-config.mjs), so it can show a background
        // notification on a cold start. It previously waited for a postMessage from
        // the page, which never arrives when the app is closed — exactly when a
        // background push matters — so those notifications were simply dropped.
        const swReg = await navigator.serviceWorker.register('/firebase-messaging-sw.js');

        const token = await getToken(messaging, { vapidKey, serviceWorkerRegistration: swReg });
        if (token && mounted && userIdRef.current) {
          await saveToken(userIdRef.current, token, 'web');
        }
      } catch (err) {
        // Non-fatal: web push is optional
        console.warn('[Push] web FCM registration skipped:', err);
      }
    };

    registerWeb();
    return () => { mounted = false; };
  }, [userId]);
}
