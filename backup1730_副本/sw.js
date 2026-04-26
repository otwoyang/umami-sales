// Umami Sales PWA - Service Worker (iOS Optimized)
const CACHE_NAME = 'umami-sales'; // Simple name for iOS compatibility

const STATIC_ASSETS = [
  '/',
  '/split.html',
  '/index.html',
  '/kitchen.html',
  '/styles.css',
  '/app.js',
  '/db.js',
  '/manifest.json',
  '/xlsx.full.min.js',
  '/html2canvas.min.js',
  '/icon-192.png',
  '/icon-512.png'
];

// Track if we've pre-cached everything
let isPreCached = false;

// Install - Cache ALL assets immediately
self.addEventListener('install', (event) => {
  console.log('SW: Installing...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(async (cache) => {
        console.log('SW: Caching all assets...');
        // Cache each asset one by one to ensure completion
        for (const url of STATIC_ASSETS) {
          try {
            await cache.add(url);
            console.log('SW: Cached:', url);
          } catch (err) {
            console.log('SW: Failed to cache:', url, err);
          }
        }
        isPreCached = true;
        console.log('SW: All assets cached!');
        return self.skipWaiting();
      })
      .catch((error) => {
        console.error('SW: Install failed:', error);
      })
  );
});

// Activate - Claim all clients immediately
self.addEventListener('activate', (event) => {
  console.log('SW: Activating...');
  event.waitUntil(
    Promise.all([
      // Clean up old caches
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => name !== CACHE_NAME)
            .map((name) => caches.delete(name))
        );
      }),
      // Claim all clients
      self.clients.claim()
    ]).then(() => {
      console.log('SW: Activated and ready!');
    })
  );
});

// Fetch - Always serve from cache first (for iOS reliability)
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // Handle navigation requests - Always cache first
  if (event.request.mode === 'navigate') {
    event.respondWith(
      caches.match(event.request)
        .then((cachedResponse) => {
          if (cachedResponse) {
            // Update cache in background
            fetch(event.request)
              .then((response) => {
                if (response && response.status === 200) {
                  caches.open(CACHE_NAME).then((cache) => {
                    cache.put(event.request, response);
                  });
                }
              })
              .catch(() => {});
            return cachedResponse;
          }

          // Not in cache, fetch and cache
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
            .catch(() => {
              // Offline fallback
              return caches.match('/split.html');
            });
        })
    );
    return;
  }

  // Handle all other requests - Cache First
  event.respondWith(
    caches.match(event.request)
      .then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }

        // Fetch and cache
        return fetch(event.request)
          .then((response) => {
            if (!response || response.status !== 200) {
              return response;
            }

            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone);
            });

            return response;
          })
          .catch(() => {
            // Return empty response on failure
            return new Response('', { status: 404 });
          });
      })
  );
});

// Handle messages from main thread
self.addEventListener('message', (event) => {
  console.log('SW: Message received:', event.data);
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }
  // Pre-cache all assets on request
  if (event.data === 'preCacheAll') {
    caches.open(CACHE_NAME).then(async (cache) => {
      for (const url of STATIC_ASSETS) {
        try {
          await cache.add(url);
        } catch (err) {
          console.log('SW: Pre-cache failed:', url);
        }
      }
      // Notify client
      event.ports[0].postMessage({ success: true });
    });
  }
});
