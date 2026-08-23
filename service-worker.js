const CACHE = 'miroku-la-v43';

// Install: activate immediately without waiting
self.addEventListener('install', () => self.skipWaiting());

// Activate: clear old caches and take control right away
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Fetch: network first, cache as fallback (offline support)
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then(response => {
        const copy = response.clone();
        caches.open(CACHE).then(cache => cache.put(e.request, copy));
        return response;
      })
      .catch(() => caches.match(e.request))
  );
});

// ── Web Push ──
// Payloads are sent by the scheduled GitHub Action (.github/workflows/push-notifications.yml).
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data && event.data.text() }; }

  const title = data.title || 'Miroku App';
  const options = {
    body:  data.body || '',
    icon:  data.icon || 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    tag:   data.tag || 'miroku',            // collapses duplicates
    renotify: false,
    data:  { url: data.url || './' }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Focus an existing window if the app is already open, otherwise open one.
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || './';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if ('focus' in client) return client.focus();
      }
      return self.clients.openWindow(target);
    })
  );
});

// Report the running cache version so the app can show it. Hardcoding the
// version in app.js meant the label drifted and reported a stale value.
self.addEventListener('message', event => {
  if (event.data === 'version' && event.source) {
    event.source.postMessage({ type: 'version', version: CACHE });
  }
});
