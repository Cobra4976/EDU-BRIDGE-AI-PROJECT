// public/service-worker.js

const CACHE_NAME = 'student-dashboard-v1';
const RUNTIME_CACHE = 'student-dashboard-runtime-v1';

// List of URLs that are OK to fail when offline (don't log errors)
const EXPECTED_OFFLINE_URLS = [
  'googleapis.com',
  'gstatic.com',
  'google.com/images',
  'identitytoolkit.googleapis.com',
  'firestore.googleapis.com',
  'generativelanguage.googleapis.com'
];

// Helper to check if error is expected
const isExpectedOfflineError = (url) => {
  return EXPECTED_OFFLINE_URLS.some(domain => url.includes(domain));
};


// Assets to cache immediately on service worker installation
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  // Add your main JS and CSS files here if they have consistent names
];

// Install event - cache critical assets
self.addEventListener('install', (event) => {
  console.log('[Service Worker] Installing...');
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[Service Worker] Precaching app shell');
        return cache.addAll(PRECACHE_ASSETS);
      })
      .then(() => {
        console.log('[Service Worker] Installation complete');
        // Force the waiting service worker to become the active service worker
        return self.skipWaiting();
      })
      .catch((error) => {
        console.error('[Service Worker] Precaching failed:', error);
      })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[Service Worker] Activating...');
  
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => {
              // Delete old caches
              return name !== CACHE_NAME && name !== RUNTIME_CACHE;
            })
            .map((name) => {
              console.log('[Service Worker] Deleting old cache:', name);
              return caches.delete(name);
            })
        );
      })
      .then(() => {
        console.log('[Service Worker] Activation complete');
        // Take control of all pages immediately
        return self.clients.claim();
      })
  );
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }

  // Skip chrome extension requests
  if (url.protocol === 'chrome-extension:') {
    return;
  }

  // Handle different types of requests with different strategies
  
  // Strategy 1: Network-first for API calls (Firebase, Google AI)
  if (
    url.hostname === 'firestore.googleapis.com' ||
    url.hostname === 'generativelanguage.googleapis.com' ||
    url.pathname.includes('/api/')
  ) {
    event.respondWith(networkFirstStrategy(request));
    return;
  }

  // Strategy 2: Cache-first for static assets (JS, CSS, images)
  if (
    request.destination === 'script' ||
    request.destination === 'style' ||
    request.destination === 'image' ||
    request.destination === 'font'
  ) {
    event.respondWith(cacheFirstStrategy(request));
    return;
  }

  // Strategy 3: Stale-while-revalidate for HTML pages
  if (request.destination === 'document') {
    event.respondWith(staleWhileRevalidateStrategy(request));
    return;
  }

  // Default: Network-first
  event.respondWith(networkFirstStrategy(request));
});

/**
 * Network-first strategy
 * Try network first, fallback to cache if offline
 * Good for: API calls, dynamic content
 */

async function networkFirstStrategy(request) {
  const cache = await caches.open(RUNTIME_CACHE);

  try {
    const networkResponse = await fetch(request);
    
    if (networkResponse && networkResponse.status === 200) {
      cache.put(request, networkResponse.clone());
    }
    
    return networkResponse;
  } catch (error) {
    // IMPROVED: Only log unexpected errors
    if (!isExpectedOfflineError(request.url)) {
      console.log('[Service Worker] Network failed, trying cache:', request.url);
    }
    
    const cachedResponse = await cache.match(request);
    
    if (cachedResponse) {
      return cachedResponse;
    }
    
    // Return empty response for expected failures
    if (isExpectedOfflineError(request.url)) {
      return new Response('', { status: 200 });
    }
    
    return new Response('Offline - Content not available', {
      status: 503,
      statusText: 'Service Unavailable'
    });
  }
}


// async function networkFirstStrategy(request) {
//   const cache = await caches.open(RUNTIME_CACHE);

//   try {
//     // Try network first
//     const networkResponse = await fetch(request);
    
//     // Cache successful responses
//     if (networkResponse && networkResponse.status === 200) {
//       cache.put(request, networkResponse.clone());
//     }
    
//     return networkResponse;
//   } catch (error) {
//     // Network failed, try cache
//     console.log('[Service Worker] Network failed, trying cache:', request.url);
//     const cachedResponse = await cache.match(request);
    
//     if (cachedResponse) {
//       console.log('[Service Worker] Serving from cache:', request.url);
//       return cachedResponse;
//     }
    
//     // If both fail, return offline page or error
//     return new Response('Offline - Content not available', {
//       status: 503,
//       statusText: 'Service Unavailable',
//       headers: new Headers({
//         'Content-Type': 'text/plain'
//       })
//     });
//   }
// }

/**
 * Cache-first strategy
 * Try cache first, fallback to network
 * Good for: Static assets (JS, CSS, images)
 * 
 */
async function cacheFirstStrategy(request) {
  const cache = await caches.open(CACHE_NAME);
  const cachedResponse = await cache.match(request);

  if (cachedResponse) {
    console.log('[Service Worker] Serving from cache:', request.url);
    return cachedResponse;
  }

  // Not in cache, fetch from network
  try {
    const networkResponse = await fetch(request);
    
    // Cache the new resource (only cache successful responses)
    if (networkResponse && networkResponse.status === 200) {
      cache.put(request, networkResponse.clone());
    }
    
    return networkResponse;
  } catch (error) {
    // IMPROVED: Only log warning, don't return error response for optional resources
    console.log('[Service Worker] Resource not available offline (expected):', request.url);
    
    // Return a minimal response instead of throwing
    return new Response('', {
      status: 200,
      statusText: 'OK (offline fallback)'
    });
  }
}


// async function cacheFirstStrategy(request) {
//   const cache = await caches.open(CACHE_NAME);
//   const cachedResponse = await cache.match(request);

//   if (cachedResponse) {
//     console.log('[Service Worker] Serving from cache:', request.url);
//     return cachedResponse;
//   }

//   // Not in cache, fetch from network
//   try {
//     const networkResponse = await fetch(request);
    
//     // Cache the new resource
//     if (networkResponse && networkResponse.status === 200) {
//       cache.put(request, networkResponse.clone());
//     }
    
//     return networkResponse;
//   } catch (error) {
//     console.error('[Service Worker] Fetch failed:', error);
//     return new Response('Resource not available offline', {
//       status: 503,
//       statusText: 'Service Unavailable'
//     });
//   }
// }

/**
 * Stale-while-revalidate strategy
 * Serve from cache immediately, update cache in background
 * Good for: HTML pages, content that changes occasionally
 */
async function staleWhileRevalidateStrategy(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cachedResponse = await cache.match(request);

  // Fetch from network in background
  const fetchPromise = fetch(request)
    .then((networkResponse) => {
      // Update cache with fresh response
      if (networkResponse && networkResponse.status === 200) {
        cache.put(request, networkResponse.clone());
      }
      return networkResponse;
    })
    .catch((error) => {
      console.log('[Service Worker] Background fetch failed:', error);
      return null;
    });

  // Return cached version immediately if available
  if (cachedResponse) {
    console.log('[Service Worker] Serving stale content:', request.url);
    return cachedResponse;
  }

  // No cache, wait for network
  return fetchPromise;
}

/**
 * Background Sync - sync data when connection is restored
 * This is triggered when the app queues sync operations
 */
self.addEventListener('sync', (event) => {
  console.log('[Service Worker] Background sync triggered:', event.tag);

  if (event.tag === 'sync-student-data') {
    event.waitUntil(
      // Notify the app to process sync queue
      self.clients.matchAll().then((clients) => {
        clients.forEach((client) => {
          client.postMessage({
            type: 'BACKGROUND_SYNC',
            tag: event.tag
          });
        });
      })
    );
  }
});

/**
 * Push notifications (optional - for future features)
 */
self.addEventListener('push', (event) => {
  console.log('[Service Worker] Push notification received');
  
  const options = {
    body: event.data ? event.data.text() : 'New update available',
    icon: '/icon-192x192.png',
    badge: '/badge-72x72.png',
    vibrate: [100, 50, 100],
    data: {
      dateOfArrival: Date.now(),
      primaryKey: 1
    }
  };

  event.waitUntil(
    self.registration.showNotification('Student Dashboard', options)
  );
});

/**
 * Notification click handler
 */
self.addEventListener('notificationclick', (event) => {
  console.log('[Service Worker] Notification clicked');
  event.notification.close();

  // Open the app
  event.waitUntil(
    self.clients.openWindow('/')
  );
});

/**
 * Message handler - communicate with the app
 */
self.addEventListener('message', (event) => {
  console.log('[Service Worker] Message received:', event.data);

  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  if (event.data && event.data.type === 'CLEAR_CACHE') {
    event.waitUntil(
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => caches.delete(cacheName))
        );
      })
    );
  }
});

console.log('[Service Worker] Script loaded');