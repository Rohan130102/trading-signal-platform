/* eslint-disable no-undef */
// Service worker. Private data is never cached here: API responses are not touched, so nothing a
// subscriber loses access to can linger on the device. The only cached file is the offline page.
const OFFLINE_CACHE = 'sd-offline-v1';
const OFFLINE_URL = '/offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(OFFLINE_CACHE).then((cache) => cache.add(OFFLINE_URL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== OFFLINE_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return;
  event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE_URL)));
});

self.addEventListener('push', (event) => {
  let message = { title: 'New update', body: 'Open the app to read it.', url: '/app', tag: 'update', urgent: false };
  try {
    message = { ...message, ...event.data.json() };
  } catch {
    // Show the generic text rather than dropping the notification.
  }
  event.waitUntil(
    self.registration.showNotification(message.title, {
      body: message.body,
      tag: message.tag,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: message.url },
      requireInteraction: Boolean(message.urgent),
      renotify: false,
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.url ?? '/app';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client && new URL(client.url).origin === self.location.origin) {
          client.navigate(target);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
