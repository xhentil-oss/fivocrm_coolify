import { useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';

async function saveToken(userId: string, token: string, platform: string) {
  await setDoc(
    doc(db, 'userPushTokens', userId),
    { token, platform, updatedAt: serverTimestamp() },
    { merge: true }
  );
}

/**
 * Registers for push notifications on both native (Android/iOS via Capacitor)
 * and web (Firebase Messaging). Saves the FCM token to Firestore so cron jobs
 * can look it up for push delivery.
 */
export function usePushNotifications(userId?: string) {
  const userIdRef = useRef(userId);
  userIdRef.current = userId;

  // ── Native (Android / iOS via Capacitor) ──────────────────────────────────
  useEffect(() => {
    if (!Capacitor.isNativePlatform() || !userId) return;

    let mounted = true;

    const register = async () => {
      const perm = await PushNotifications.requestPermissions();
      if (perm.receive !== 'granted') return;
      await PushNotifications.register();

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

      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return;

      try {
        const { getMessaging, getToken, isSupported } = await import('firebase/messaging');
        const supported = await isSupported();
        if (!supported || !mounted) return;

        const { default: app } = await import('../lib/firebase');
        const messaging = getMessaging(app);
        const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined;
        if (!vapidKey) return; // VAPID key not configured

        // Register service worker for background messages
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
