// Offline shell cache: app files served cache-first, data always goes to Supabase directly.
const CACHE = 'airlock-shell-v8';
const SHELL = ['./', 'index.html', 'renderer.js', 'store.js', 'config.js', 'vendor/supabase.js', 'manifest.json', 'icon.svg', 'icon.png', 'icon-180.png', 'airlock-ping.wav'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin || e.request.method !== 'GET') return;   // Supabase etc. pass straight through
  // network-first for the shell so deploys show up on next load; fall back to cache offline
  e.respondWith(fetch(e.request).then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return res; })
    .catch(() => caches.match(e.request)));
});
