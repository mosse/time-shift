/**
 * encore.fm Service Worker
 * Enables offline caching and background audio playback
 */

const CACHE_NAME = 'encore-fm-v3';
const STATIC_ASSETS = [
  '/',
  '/css/styles.css',
  '/js/player.js',
  '/manifest.json'
];

/**
 * Install event - cache static assets
 */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Caching static assets');
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => {
        // Activate immediately without waiting
        return self.skipWaiting();
      })
  );
});

/**
 * Activate event - clean up old caches
 */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => name !== CACHE_NAME)
            .map((name) => {
              console.log('[SW] Deleting old cache:', name);
              return caches.delete(name);
            })
        );
      })
      .then(() => {
        // Take control of all clients immediately
        return self.clients.claim();
      })
  );
});

/**
 * Fetch event
 * - HLS segments, playlists, API and metadata are always network-only:
 *   they are time-sensitive, and caching /metadata/current froze the
 *   now-playing display at whatever loaded first
 * - Static assets are network-first with cache fallback, so UI updates
 *   reach installed PWAs while offline loads still work
 */
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (url.pathname.endsWith('.ts') ||
      url.pathname.endsWith('.m3u8') ||
      url.pathname.startsWith('/api/') ||
      url.pathname.startsWith('/metadata/') ||
      url.pathname.startsWith('/stream')) {
    event.respondWith(fetch(event.request));
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Don't cache non-successful responses
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }

        // Keep the latest copy for offline fallback
        const responseToCache = response.clone();
        caches.open(CACHE_NAME)
          .then((cache) => {
            cache.put(event.request, responseToCache);
          });

        return response;
      })
      .catch(() => {
        // Network unavailable: fall back to the last cached copy
        return caches.match(event.request);
      })
  );
});

/**
 * Message handler for client communication
 */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  if (event.data && event.data.type === 'GET_VERSION') {
    event.ports[0].postMessage({ version: CACHE_NAME });
  }
});

/**
 * Background sync for reconnecting after offline
 */
self.addEventListener('sync', (event) => {
  if (event.tag === 'reconnect-stream') {
    event.waitUntil(
      self.clients.matchAll()
        .then((clients) => {
          clients.forEach((client) => {
            client.postMessage({ type: 'RECONNECT' });
          });
        })
    );
  }
});
