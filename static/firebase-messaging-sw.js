// Firebase Cloud Messaging Service Worker
// Handles background push notifications when the app is not in the foreground.
// Served at /firebase-messaging-sw.js via Vite's publicDir (static/).

importScripts('https://www.gstatic.com/firebasejs/10.13.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.13.2/firebase-messaging-compat.js');

let messagingInstance = null;

function initFirebase(config) {
  try {
    if (!config || !config.apiKey) return;
    const apps = firebase.getApps ? firebase.getApps() : [];
    const app = apps.length > 0 ? apps[0] : firebase.initializeApp(config);
    messagingInstance = firebase.messaging(app);

    messagingInstance.onBackgroundMessage((payload) => {
      const title = payload.notification?.title || 'FivoCRM';
      const body  = payload.notification?.body  || '';
      const url   = payload.data?.url || '/';

      self.registration.showNotification(title, {
        body,
        icon: '/icon-192.png',
        badge: '/icon-72.png',
        data: { url },
        requireInteraction: false,
      });
    });
  } catch (err) {
    console.error('[FCM-SW] init error:', err);
  }
}

// Accept config injected by the main app via postMessage
self.addEventListener('message', (event) => {
  if (event.data?.type === 'FIREBASE_CONFIG' && !messagingInstance) {
    initFirebase(event.data.config);
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if ('focus' in client) {
          client.focus();
          if ('navigate' in client) client.navigate(url);
          return;
        }
      }
      return clients.openWindow(url);
    })
  );
});
