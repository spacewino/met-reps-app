const CACHE_NAME = 'metreps-cache-v1';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    }).catch(err => console.log('SW install cache error:', err))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            return caches.delete(cache);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Only intercept HTTP/HTTPS GET schemes to prevent failures on non-http protocols (like chrome-extension or data URLs)
  if (event.request.method !== 'GET' || !event.request.url.startsWith('http')) {
    return;
  }

  const isNavigation = event.request.mode === 'navigate';
  const url = new URL(event.request.url);
  const isCoreConfig = url.pathname === '/manifest.json' || url.pathname === '/sw.js';

  if (isNavigation || isCoreConfig) {
    // Network-First with Cache Fallback for navigation and core configs
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return response;
        })
        .catch(() => {
          // If network fails (offline), fall back to cached page
          return caches.match(isNavigation ? '/' : event.request)
            .then((cachedResponse) => {
              if (cachedResponse) {
                return cachedResponse;
              }
              // If no cache match, let the fetch fail naturally rather than throwing a SW crash error
              return fetch(event.request);
            });
        })
    );
  } else {
    // Cache-First with Network Fallback for static assets
    event.respondWith(
      caches.match(event.request)
        .then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          // Fetch from network if not in cache
          return fetch(event.request)
            .then((response) => {
              if (response && response.status === 200) {
                const responseClone = response.clone();
                caches.open(CACHE_NAME).then((cache) => {
                  cache.put(event.request, responseClone);
                });
              }
              return response;
            })
            .catch((err) => {
              console.warn('Service Worker static fetch failed for:', event.request.url, err);
              // Fallback: let the browser handle it or try to fetch again without interception
              return fetch(event.request);
            });
        })
        .catch((err) => {
          console.error('Service Worker cache match error:', err);
          return fetch(event.request);
        })
    );
  }
});
