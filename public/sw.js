/* Yorikado service worker.
 * Caches ONLY the public shell: offline page, logo/icons, fonts, manifest.
 * Never caches /api, /auth, /m, /o, attachments, settlement CSV, QR data or
 * any authenticated response. Voucher acceptance is never queued offline. */
const CACHE = 'yorikado-shell-v1';
const SHELL = [
  '/offline.html',
  '/manifest.webmanifest',
  '/brand/logo_horizontal.png',
  '/brand/logo_mark.png',
  '/brand/pwa_icon_192.png',
  '/brand/apple_touch_icon_180.png',
  '/brand/favicon_32.png',
  '/fonts/BIZUDPGothic-Regular.woff2',
  '/fonts/BIZUDPGothic-Bold.woff2',
];
const CACHEABLE = /^\/(brand|fonts)\/|^\/offline\.html$|^\/manifest\.webmanifest$/;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // never touch POST/PUT/PATCH (no offline queue)
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (CACHEABLE.test(url.pathname)) {
    event.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
    return;
  }
  if (req.mode === 'navigate') {
    // Network only for pages; show the offline notice when there is no connection.
    event.respondWith(fetch(req).catch(() => caches.match('/offline.html')));
  }
  // Everything else (including /api/*) goes straight to the network, uncached.
});
