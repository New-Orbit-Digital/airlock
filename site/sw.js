// Airlock used to live at the site root; the app now lives at /app/ with its own service worker.
// This root worker exists only to remove itself from browsers that still have the old one.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    await self.registration.unregister();
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => /matrix-shell|airlock-shell/.test(k)).map((k) => caches.delete(k)));
    const clients = await self.clients.matchAll({ type: 'window' });
    clients.forEach((c) => c.navigate(c.url));
  })());
});
