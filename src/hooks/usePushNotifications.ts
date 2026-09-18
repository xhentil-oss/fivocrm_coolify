import { useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { doc, setDoc, deleteDoc, deleteField, serverTimestamp } from 'firebase/firestore';
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

/**
 * Android 8+ delivers every notification through a channel, and the CHANNEL owns
 * sound, vibration and whether it shows as a heads-up banner — the payload cannot
 * override that. With no channel of our own, FCM used its fallback
 * ("Miscellaneous"), which several OEM skins create at low importance: pushes
 * arrived silently and with no banner.
 *
 * Must match PUSH_CHANNEL_ID in scripts/android-configure.cjs, which points the
 * manifest's `default_notification_channel_id` at it. iOS ignores channels.
 */
const PUSH_CHANNEL_ID = 'fivocrm_default';

async function ensureAndroidChannel(): Promise<void> {
  if (Capacitor.getPlatform() !== 'android') return;
  try {
    await PushNotifications.createChannel({
      id: PUSH_CHANNEL_ID,
      name: 'Njoftime FivoCRM',
      description: 'Detyra, mesazhe, fatura dhe kujtesa',
      importance: 5, // IMPORTANCE_HIGH → heads-up banner + sound
      visibility: 1, // VISIBILITY_PUBLIC → readable on the lock screen
      sound: 'default',
      vibration: true,
      lights: true,
    });
  } catch (err) {
    // Creating a channel that already exists is a no-op; anything else here must
    // not stop registration — a push with a bad channel still beats no push.
    console.warn('[Push] channel setup skipped:', err);
  }
}

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
 *
 * `opts.legacy: false` limits the cleanup to this origin's own subcollection row —
 * used by the canonical-host gate below, which must not touch the shared legacy
 * token (it could still be an old NATIVE device's only delivery target).
 */
export async function clearPushToken(userId?: string | null, opts?: { legacy?: boolean }): Promise<void> {
  if (!userId) return;
  let key: string | null = null;
  try { key = localStorage.getItem(LAST_TOKEN_KEY); } catch { /* noop */ }
  if (key) {
    try {
      await deleteDoc(doc(db, 'userPushTokens', userId, 'tokens', key));
    } catch { /* best-effort — a stale token is dropped server-side on first failure */ }
    try { localStorage.removeItem(LAST_TOKEN_KEY); } catch { /* noop */ }
  }
  if (opts?.legacy === false) return;
  // The LEGACY single-token field on the parent doc is still a delivery target
  // (listPushTokens reads it), and nothing else ever clears it — so a user who
  // registered pre-migration kept receiving pushes on this device after logout,
  // even for the NEXT account that signed in. Clear it unconditionally: if this
  // device didn't own that token it belongs to an even older session of the same
  // user, and the current device re-registers into the subcollection on login.
  try {
    await setDoc(doc(db, 'userPushTokens', userId), { token: deleteField() }, { merge: true });
  } catch { /* best-effort */ }
}

// Web push is PER-ORIGIN: a token minted on fivocrm.vercel.app and one minted on
// fivocrm.com are two independent subscriptions for the same person, and the server
// pushes to every stored token — so anyone who had visited both domains received
// every notification once per domain. Only the canonical production host may mint
// web tokens; any other host (the .vercel.app alias, preview deployments) instead
// deletes the token it may have registered before this gate existed. localhost
// stays allowed for development. Native (Capacitor) registration is not origin-
// bound and is unaffected.
const CANONICAL_PUSH_HOSTS = new Set(['fivocrm.com', 'www.fivocrm.com', 'localhost', '127.0.0.1']);

/** True when this origin is allowed to mint web push tokens (see above). */
export function isCanonicalPushHost(): boolean {
  return typeof window !== 'undefined' && CANONICAL_PUSH_HOSTS.has(window.location.hostname);
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

      // Before register(): the channel must exist by the time the first push
      // lands, and Android silently drops a notification aimed at a channel id
      // that was never created.
      await ensureAndroidChannel();

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
      // Non-canonical origin: never mint a token here (it would double every push),
      // and drop the one this origin registered before the gate — otherwise
      // fivocrm.vercel.app keeps ringing alongside fivocrm.com until FCM happens
      // to expire its token.
      if (!isCanonicalPushHost()) {
        void clearPushToken(userIdRef.current, { legacy: false });
        return;
      }
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
