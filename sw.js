// ClayLog Service Worker — offline app-shell caching
// Bump CACHE_VERSION whenever you ship a new app version so old caches get replaced.
const CACHE_VERSION = 'claylog-v1.0.4';
const CACHE_NAME = `claylog-cache-${CACHE_VERSION}`;

// Core files + CDN dependencies needed to boot the app offline.
// IMPORTANT: keep this in sync with the <script>/<link> tags in the HTML head.
const PRECACHE_URLS = [
  './',
  './index.html',
  './logo.png',
  'https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=DM+Sans:wght@300;400;500;600&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/react/18.2.0/umd/react.production.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.2.0/umd/react-dom.production.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/babel-standalone/7.23.2/babel.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/qrious/4.0.2/qrious.min.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Use individual adds so one failing CDN request doesn't block the whole install
      return Promise.all(
        PRECACHE_URLS.map((url) =>
          cache.add(url).catch((err) => console.warn('[SW] precache failed for', url, err))
        )
      );
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith('claylog-cache-') && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Ignore non-http(s) requests (chrome-extension://, data:, etc.). The Cache API
  // can't store those, and trying to cache.put() them throws an uncaught error.
  if (!req.url.startsWith('http')) return;

  // Never cache/interfere with Supabase API calls — those need to hit the network
  // (or fail fast so the app's own offline-queue logic can take over).
  if (req.url.includes('supabase.co') || req.url.includes('workers.dev')) {
    return; // let it go straight to network, no SW handling
  }

  // Only handle GET requests; everything else passes through untouched.
  if (req.method !== 'GET') return;

  event.respondWith(
    caches.match(req).then((cached) => {
      // Cache-first for app shell + CDN assets: instant load, works offline.
      if (cached) {
        // Refresh cache in background when online (stale-while-revalidate)
        fetch(req)
          .then((fresh) => {
            if (fresh && fresh.ok) {
              caches.open(CACHE_NAME).then((cache) => cache.put(req, fresh.clone()));
            }
          })
          .catch(() => {}); // offline — ignore, cached version already returned
        return cached;
      }
      // Not cached yet — try network, fall back gracefully if offline
      return fetch(req)
        .then((fresh) => {
          if (fresh && fresh.ok) {
            const copy = fresh.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return fresh;
        })
        .catch(() => {
          // Navigation request offline and not cached: serve the app shell anyway
          if (req.mode === 'navigate') {
            return caches.match('./index.html');
          }
          return new Response('', { status: 504, statusText: 'Offline' });
        });
    })
  );
});
