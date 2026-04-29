// Firebase Messaging Service Worker — handles background push notifications
// This file is served at /firebase-messaging-sw.js by Vite's static assets.
//
// Fill in FIREBASE_CONFIG below with your Firebase project values.
// These are public values (safe to commit) — find them in Firebase Console → Project Settings.

importScripts('https://www.gstatic.com/firebasejs/10.14.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.0/firebase-messaging-compat.js');

// ── Firebase config (public values — fill these in) ──────────────────────────
const FIREBASE_CONFIG = self.__FIREBASE_CONFIG || {
  apiKey:            '',
  authDomain:        '',
  projectId:         '',
  storageBucket:     '',
  messagingSenderId: '',
  appId:             '',
};

firebase.initializeApp(FIREBASE_CONFIG);
const messaging = firebase.messaging();

// ── Background message handler ────────────────────────────────────────────────
messaging.onBackgroundMessage(payload => {
  const { title = 'FivoCRM', body = '' } = payload.notification || {};
  const url = payload.data?.url || '/';

  self.registration.showNotification(title, {
    body,
    icon: '/icon-192.png',
    badge: '/icon-72.png',
    data: { url },
    requireInteraction: false,
  });
});

// ── Deep-link on notification click ──────────────────────────────────────────
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      // If app is already open, focus it and navigate
      for (const client of windowClients) {
        if ('focus' in client) {
          client.focus();
          if ('navigate' in client) client.navigate(url);
          return;
        }
      }
      // Otherwise open a new window
      return clients.openWindow(url);
    })
  );
});
