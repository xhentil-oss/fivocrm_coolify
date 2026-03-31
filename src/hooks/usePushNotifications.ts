import { useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';

/**
 * Registers for push notifications on native platforms (Android/iOS).
 * Returns the FCM token via the onToken callback.
 * No-ops gracefully on web.
 */
export function usePushNotifications(onToken?: (token: string) => void) {
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let mounted = true;

    const register = async () => {
      const perm = await PushNotifications.requestPermissions();
      if (perm.receive !== 'granted') return;

      await PushNotifications.register();

      PushNotifications.addListener('registration', (token) => {
        if (mounted && onTokenRef.current) {
          onTokenRef.current(token.value);
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
  }, []);
}
