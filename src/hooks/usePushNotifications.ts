import { useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';

/**
 * Registers for push notifications on native platforms (Android/iOS).
 * Saves the FCM token to Firestore so the backend can send push alerts.
 * No-ops gracefully on web.
 */
export function usePushNotifications(userId?: string) {
  const userIdRef = useRef(userId);
  userIdRef.current = userId;

  useEffect(() => {
    if (!Capacitor.isNativePlatform() || !userId) return;

    let mounted = true;

    const register = async () => {
      const perm = await PushNotifications.requestPermissions();
      if (perm.receive !== 'granted') return;

      await PushNotifications.register();

      PushNotifications.addListener('registration', async (token) => {
        if (!mounted || !userIdRef.current) return;
        try {
          // Store token keyed by userId so cron jobs can look it up
          await setDoc(
            doc(db, 'userPushTokens', userIdRef.current),
            {
              token: token.value,
              platform: Capacitor.getPlatform(),
              updatedAt: serverTimestamp(),
            },
            { merge: true }
          );
        } catch (err) {
          console.error('[Push] Token opslaan mislukt:', err);
        }
      });

      PushNotifications.addListener('registrationError', (err) => {
        console.error('Push registration failed:', err);
      });

      PushNotifications.addListener('pushNotificationReceived', (notification) => {
        console.log('Push received:', notification);
      });

      PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
        console.log('Push action:', action);
      });
    };

    register();

    return () => {
      mounted = false;
      PushNotifications.removeAllListeners();
    };
  }, [userId]);
}
