const CACHE = 'nudo-hub-v1';
const ASSETS = [
  '/Nudo-hub/',
  '/Nudo-hub/index.html',
  '/Nudo-hub/app.html',
  '/Nudo-hub/live.html',
  '/Nudo-hub/manifest.json',
  '/Nudo-hub/reglas.html',
  '/Nudo-hub/guia.html',
  '/Nudo-hub/contactos.html'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  // Network-first for navigation, cache-first for assets
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).catch(() => caches.match('/Nudo-hub/app.html')));
    return;
  }
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).then(resp => {
      const copy = resp.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return resp;
    }).catch(() => cached))
  );
});

// ---- PUSH NOTIFICATIONS ----
self.addEventListener('push', e => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch (_) {}
  const title = data.title || 'Nudo Hub';
  const options = {
    body: data.body || '',
    icon: '/Nudo-hub/icon-192.png',
    badge: '/Nudo-hub/icon-192.png',
    data: { url: data.url || '/Nudo-hub/app.html' },
    vibrate: [100, 50, 100]
  };
  e.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/Nudo-hub/app.html';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if (client.url.includes('/Nudo-hub/') && 'focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});
