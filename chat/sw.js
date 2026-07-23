const CACHE_NAME = 'chat-cache-v6';
const ASSETS = [
  'index.html',
  'chat.css',
  'chat.js',
  'manifest.json',
  '../styles.css',
  '../auth-v2.css',
  '../auth-v2.js',
  '../assets/nszu-shield.svg',
  '../assets/icon-192.png',
  '../assets/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(ASSETS);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.map(key => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  // Bypass caching for third party API requests (Supabase, CDN) to prevent breaking API calls
  if (e.request.url.includes('supabase.co') || e.request.url.includes('jsdelivr.net')) {
    return;
  }
  
  e.respondWith(
    caches.match(e.request).then(cachedResponse => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(e.request).catch(() => {
        // Return default fallback if needed
      });
    })
  );
});
