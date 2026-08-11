// Firebase Cloud Messaging Service Worker — TEMPLATE.
//
// This file is NOT served as-is. The `firebase-messaging-sw-config` plugin in
// vite.config.ts substitutes the placeholder on the FIREBASE_CONFIG line below with
// the real config and emits the result as /firebase-messaging-sw.js (in dev and in
// the build). It lives outside `static/` on purpose so the un-substituted template
// is never copied into dist and served by accident.
//
// The placeholder token is deliberately not spelled out anywhere else in this file:
// the substitution replaces every occurrence, so a mention in prose would be
// rewritten into a config object too.
//
// Why the config is baked in rather than posted from the page:
// a service worker is torn down when idle and restarted BY the push event. With the
// app closed there is no page to postMessage the config, so `onBackgroundMessage`
// was never registered and the notification was dropped — exactly the case push
// exists for. Registering the handler at top level fixes cold starts.

importScripts('https://www.gstatic.com/firebasejs/10.13.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.13.2/firebase-messaging-compat.js');

var FIREBASE_CONFIG = __FIREBASE_CONFIG__;

(function initFirebase() {
  try {
    if (!FIREBASE_CONFIG || !FIREBASE_CONFIG.apiKey) {
      console.warn('[FCM-SW] no Firebase config baked in — background push disabled.');
      return;
    }
    var apps = firebase.getApps ? firebase.getApps() : [];
    var app = apps.length > 0 ? apps[0] : firebase.initializeApp(FIREBASE_CONFIG);
    var messaging = firebase.messaging(app);

    messaging.onBackgroundMessage(function (payload) {
      var title = (payload.notification && payload.notification.title) || 'FivoCRM';
      var body = (payload.notification && payload.notification.body) || '';
      var url = (payload.data && payload.data.url) || '/';
      var image = (payload.notification && payload.notification.image)
        || (payload.data && payload.data.image);

      self.registration.showNotification(title, {
        body: body,
        icon: '/icon-192.png',
        badge: '/icon-72.png',
        image: image || undefined,
        // Collapse repeated notifications about the same destination instead of
        // stacking a dozen identical rows in the tray.
        tag: url,
        renotify: true,
        data: { url: url },
        requireInteraction: false,
      });
    });
  } catch (err) {
    console.error('[FCM-SW] init error:', err);
  }
})();

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var url = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (windowClients) {
      for (var i = 0; i < windowClients.length; i++) {
        var client = windowClients[i];
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
